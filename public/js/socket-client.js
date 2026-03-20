// ===== SOCKET CLIENT =====
// Drop-in replacement for MockServer when SERVER_URL is set.
// Wraps Socket.io with the same API as MockServer.

class SocketClient {
  constructor(serverUrl) {
    this._handlers = {};
    this._playerId = null;
    this._roomCode = null;
    this._isHost   = false;
    this._socket   = io(serverUrl);

    // Forward all server events to local handlers
    const SERVER_EVENTS = [
      'room_created','room_joined','player_joined','player_left',
      'room_updated','host_changed','chat_message','error_msg',
      'game_starting','board_update','use_special','player_dead','game_over',
    ];
    SERVER_EVENTS.forEach(ev => {
      this._socket.on(ev, data => this._emit(ev, data));
    });

    // Capture playerId and roomCode from room events
    this._socket.on('room_created', ({ code, playerId }) => {
      this._roomCode = code;
      this._playerId = playerId;
      this._isHost   = true;
    });
    this._socket.on('room_joined', ({ code, playerId }) => {
      this._roomCode = code;
      this._playerId = playerId;
      this._isHost   = false;
    });
    this._socket.on('host_changed', ({ newHostId }) => {
      if (newHostId === this._playerId) this._isHost = true;
    });
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
    (this._handlers[event] || []).forEach(cb => cb(data));
  }

  // ===== CLIENT ACTIONS =====
  createRoom({ playerName, mode, botDifficulty }) {
    this._socket.emit('create_room', { playerName, mode, botDifficulty });
  }

  joinRoom({ code, playerName }) {
    this._socket.emit('join_room', { code: code.toUpperCase(), playerName });
  }

  addBot({ difficulty }) {
    this._socket.emit('add_bot', { difficulty });
  }

  removeBot({ botId }) {
    this._socket.emit('remove_bot', { botId });
  }

  updateRoomConfig({ mode, botDifficulty }) {
    this._socket.emit('update_config', { mode, botDifficulty });
  }

  sendChat({ message, playerName }) {
    this._socket.emit('chat_message', { message, playerName });
  }

  startGame(slots) {
    this._socket.emit('start_game', { slots });
  }

  leaveRoom() {
    this._socket.emit('leave_room');
    this._roomCode = null;
    this._isHost   = false;
  }

  // ===== IN-GAME =====
  sendBoardUpdate(boards) {
    this._socket.emit('board_update', { boards });
  }

  sendSpecial(attackerId, targetId, special) {
    this._socket.emit('use_special', { attackerId, targetId, special });
  }

  sendPlayerDead(playerId) {
    this._socket.emit('player_dead', { playerId });
  }

  sendGameOver(winners) {
    this._socket.emit('game_over', { winners });
  }

  get socket()   { return this._socket; }
  get playerId() { return this._playerId; }
  get roomCode() { return this._roomCode; }
  get isHost()   { return this._isHost; }
}

// Instantiate only if SERVER_URL is set
const socketClient = (typeof SERVER_URL !== 'undefined' && SERVER_URL)
  ? new SocketClient(SERVER_URL)
  : null;

// Unified server accessor used by index.html, lobby.html, game.html
const server = socketClient || mockServer;
