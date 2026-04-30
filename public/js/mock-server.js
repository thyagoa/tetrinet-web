// ===== MOCK SERVER =====
// Simulates Socket.io + Node.js server behavior entirely in the browser.
// When real multiplayer is implemented, replace MockServer usage with:
//   const socket = io('https://your-app.onrender.com');
// Everything else stays the same.

const BOT_NAMES_POOL = ['ALPHA','BETA','GAMMA','DELTA','EPSILON','ZETA'];
const MOCK_CHAT_MSGS = [
  'Boa sorte a todos!',
  'Vamos nessa!',
  'Prontos?',
  'Alguém sabe jogar aqui? rsrs',
];

class MockServer {
  constructor() {
    this._handlers = {};

    // Restore session state persisted across page navigations
    const saved = (() => {
      try { return JSON.parse(sessionStorage.getItem('bricknet_mock_session') || 'null'); } catch(e) { return null; }
    })();

    if (saved) {
      this._playerId = saved.playerId;
      this._roomCode = saved.roomCode;
      this._isHost   = saved.isHost;
    } else {
      this._playerId = 'player_' + Math.random().toString(36).substr(2,6);
      this._roomCode = null;
      this._isHost   = false;
    }

    this._rooms = {}; // always rehydrated from localStorage on demand
  }

  // Persist session state to survive page navigation
  _saveSession() {
    try {
      sessionStorage.setItem('bricknet_mock_session', JSON.stringify({
        playerId: this._playerId,
        roomCode: this._roomCode,
        isHost:   this._isHost,
      }));
    } catch(e) {}
  }

  // ===== EVENT SYSTEM =====
  on(event, cb) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(cb);
  }

  off(event, cb) {
    if (!this._handlers[event]) return;
    this._handlers[event] = this._handlers[event].filter(h => h !== cb);
  }

  _emit(event, data) {
    // Simulate network delay (20-80ms)
    const delay = 20 + Math.random() * 60;
    setTimeout(() => {
      (this._handlers[event] || []).forEach(cb => cb(data));
    }, delay);
  }

  // ===== CLIENT ACTIONS =====

  createRoom({ playerName, mode, botDifficulty }) {
    const code = this._generateCode();
    this._roomCode = code;
    this._isHost   = true;

    this._rooms[code] = {
      code,
      mode,
      botDifficulty,
      host: this._playerId,
      players: [{
        id: this._playerId,
        name: playerName,
        isHost: true,
        isBot: false,
        alive: true,
      }],
      bots: [],
      chat: [],
      started: false,
    };

    this._emit('room_created', {
      code,
      playerId: this._playerId,
      isHost: true,
      room: this._safeRoom(code),
    });

    this._saveSession();
    this._saveRoom(code);
  }

  joinRoom({ code, playerName }) {
    code = code.toUpperCase();
    const room = this._loadRoom(code);

    if (!room) {
      this._emit('error_msg', { message: 'Sala não encontrada. Verifique o código.' });
      return;
    }
    if (room.started) {
      this._emit('error_msg', { message: 'Esta partida já começou.' });
      return;
    }
    if (room.players.filter(p => !p.isBot).length >= this._maxPlayers(room.mode)) {
      this._emit('error_msg', { message: 'Sala cheia.' });
      return;
    }

    this._roomCode = code;
    this._isHost   = false;

    const newPlayer = {
      id: this._playerId,
      name: playerName,
      isHost: false,
      isBot: false,
      alive: true,
    };

    room.players.push(newPlayer);
    this._saveSession();
    this._saveRoom(code);

    this._emit('room_joined', {
      code,
      playerId: this._playerId,
      isHost: false,
      room: this._safeRoom(code),
    });

    // Notify others (simulated — in real server this goes to other sockets)
    this._emit('player_joined', { player: newPlayer });
  }

  addBot({ difficulty }) {
    if (!this._isHost) return;
    const room = this._loadRoom(this._roomCode);
    if (!room) return;

    const maxP = this._maxPlayers(room.mode);
    if (room.players.length >= maxP) {
      this._emit('error_msg', { message: 'Sala cheia. Não é possível adicionar mais bots.' });
      return;
    }

    const usedNames = room.players.map(p => p.name);
    const availName = BOT_NAMES_POOL.find(n => !usedNames.includes('BOT_'+n)) || 'BOT_X';
    const botId = 'bot_' + Math.random().toString(36).substr(2,4);

    const bot = {
      id: botId,
      name: 'BOT_' + availName,
      isHost: false,
      isBot: true,
      difficulty: difficulty || room.botDifficulty || 2,
      alive: true,
    };

    room.players.push(bot);
    this._rooms[this._roomCode] = room;
    this._saveRoom(this._roomCode);

    this._emit('player_joined', { player: bot });
    this._emit('room_updated', { room: this._safeRoom(this._roomCode) });
  }

  removeBot({ botId }) {
    if (!this._isHost) return;
    const room = this._loadRoom(this._roomCode);
    if (!room) return;

    room.players = room.players.filter(p => p.id !== botId);
    this._rooms[this._roomCode] = room;
    this._saveRoom(this._roomCode);

    this._emit('player_left', { playerId: botId });
    this._emit('room_updated', { room: this._safeRoom(this._roomCode) });
  }

  updateRoomConfig({ mode, botDifficulty, clearBots }) {
    if (!this._isHost) return;
    const room = this._loadRoom(this._roomCode);
    if (!room) return;

    room.mode = mode;
    room.botDifficulty = botDifficulty;
    if (clearBots) {
      const removed = room.players.filter(p => p.isBot);
      room.players = room.players.filter(p => !p.isBot);
      removed.forEach(bot => this._emit('player_left', { playerId: bot.id }));
    }
    this._rooms[this._roomCode] = room;
    this._saveRoom(this._roomCode);
    this._emit('room_updated', { room: this._safeRoom(this._roomCode) });
  }

  sendChat({ message, playerName }) {
    const room = this._loadRoom(this._roomCode);
    if (!room) return;

    const entry = {
      id: Date.now(),
      playerId: this._playerId,
      playerName,
      message,
      time: new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }),
    };

    room.chat.push(entry);
    this._saveRoom(this._roomCode);
    this._emit('chat_message', entry);

    // Simulate occasional bot chat responses
    if (Math.random() < 0.25) {
      const bots = room.players.filter(p => p.isBot);
      if (bots.length > 0) {
        const bot = bots[Math.floor(Math.random() * bots.length)];
        const responses = ['👍', 'boa!', 'vamos!', 'rsrs', 'game on!', '🎮'];
        setTimeout(() => {
          const botEntry = {
            id: Date.now() + 1,
            playerId: bot.id,
            playerName: bot.name,
            message: responses[Math.floor(Math.random() * responses.length)],
            time: new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }),
            isBot: true,
          };
          room.chat.push(botEntry);
          this._saveRoom(this._roomCode);
          this._emit('chat_message', botEntry);
        }, 800 + Math.random() * 1500);
      }
    }
  }

  startGame() {
    if (!this._isHost) return;
    const room = this._loadRoom(this._roomCode);
    if (!room) return;
    if (room.players.filter(p => !p.isBot).length < 1) return;

    room.started = true;
    this._saveRoom(this._roomCode);

    // Build game config from room
    const config = {
      playerName: room.players.find(p => p.id === this._playerId)?.name || 'JOGADOR',
      mode: room.mode,
      botCount: room.players.filter(p => p.isBot).length,
      botDifficulty: room.botDifficulty || 2,
      roomCode: this._roomCode,
      players: room.players,
    };

    this._emit('game_starting', { config });
  }

  leaveRoom() {
    const room = this._loadRoom(this._roomCode);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== this._playerId);

    // If host leaves, assign new host
    if (this._isHost && room.players.length > 0) {
      const newHost = room.players.find(p => !p.isBot);
      if (newHost) {
        newHost.isHost = true;
        this._emit('host_changed', { newHostId: newHost.id });
      }
    }

    this._saveRoom(this._roomCode);
    this._emit('player_left', { playerId: this._playerId });
    this._roomCode = null;
    this._isHost   = false;
    this._saveSession();
  }

  // ===== HELPERS =====

  _generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  _maxPlayers(mode) {
    return { ffa: 6, '1v1': 2, '2v2': 4, '3v3': 6, '2v2v2': 6 }[mode] || 6;
  }

  _safeRoom(code) {
    const r = this._rooms[code] || this._loadRoom(code);
    if (!r) return null;
    return {
      code: r.code,
      mode: r.mode,
      botDifficulty: r.botDifficulty,
      host: r.host,
      players: r.players,
      chat: r.chat,
      started: r.started,
      maxPlayers: this._maxPlayers(r.mode),
    };
  }

  _saveRoom(code) {
    const room = this._rooms[code];
    if (room) {
      try { localStorage.setItem('bricknet_room_' + code, JSON.stringify(room)); } catch(e) {}
    }
  }

  _loadRoom(code) {
    if (this._rooms[code]) return this._rooms[code];
    try {
      const raw = localStorage.getItem('bricknet_room_' + code);
      if (raw) {
        this._rooms[code] = JSON.parse(raw);
        return this._rooms[code];
      }
    } catch(e) {}
    return null;
  }

  get playerId() { return this._playerId; }
  get roomCode() { return this._roomCode; }
  get isHost()   { return this._isHost; }
}

// Global singleton
const mockServer = new MockServer();
