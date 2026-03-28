const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

app.use(express.static(path.join(__dirname, 'public')));

// Rota de convite do Bombardeiro — /b/:token serve bomber.html (token opaco)
app.get('/b/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tt', 'bomber.html'));
});

// ===== ROOM STORE =====
const rooms = {}; // code → room

// ===== BOMBER LINKS (Tag Team) =====
const bomberLinks   = {}; // moverId → bomberSocketId
const moverOfBomber = {}; // bomberSocketId → moverId

// ===== BOMBER INVITE TOKENS =====
const bomberTokens = {}; // token → { roomCode, slotIdx, expires }
setInterval(() => {
  const now = Date.now();
  for (const t in bomberTokens) {
    if (bomberTokens[t].expires < now) delete bomberTokens[t];
  }
}, 5 * 60 * 1000);

const BOT_NAMES_POOL = ['ALPHA','BETA','GAMMA','DELTA','EPSILON','ZETA'];

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function maxPlayers(mode) {
  return { ffa:6, '1v1':2, '2v2':4, '3v3':6, '2v2v2':6 }[mode] || 6;
}

function safeRoom(room) {
  return {
    code:          room.code,
    mode:          room.mode,
    botDifficulty: room.botDifficulty,
    host:          room.host,
    players:       room.players,
    started:       room.started,
    maxPlayers:    maxPlayers(room.mode),
    slots:         room.slots || [],
  };
}

// ===== GRACE PERIOD FOR PAGE-NAVIGATION RECONNECTIONS =====
const LEAVE_GRACE_MS = 8000;
const pendingLeaves = {};

function scheduleLeave(socket) {
  if (pendingLeaves[socket.id]) return;
  pendingLeaves[socket.id] = setTimeout(() => {
    delete pendingLeaves[socket.id];
    handleLeave(socket);
  }, LEAVE_GRACE_MS);
}

function cancelLeave(socketId) {
  if (pendingLeaves[socketId]) {
    clearTimeout(pendingLeaves[socketId]);
    delete pendingLeaves[socketId];
  }
}

// ===== SOCKET HANDLERS =====
io.on('connection', socket => {
  console.log('connect', socket.id);

  // ----- CREATE ROOM -----
  socket.on('create_room', ({ playerName, mode, botDifficulty }) => {
    let code;
    do { code = generateCode(); } while (rooms[code]);

    const playerId = socket.id;
    const room = {
      code,
      mode:          mode || 'ffa',
      botDifficulty: botDifficulty || 2,
      host:          playerId,
      players: [{
        id:     playerId,
        name:   playerName,
        isHost: true,
        isBot:  false,
        alive:  true,
      }],
      started: false,
      slots:   [],
    };

    rooms[code] = room;
    socket.join(code);
    socket.data.roomCode  = code;
    socket.data.playerId  = playerId;

    socket.emit('room_created', {
      code,
      playerId,
      isHost: true,
      room:   safeRoom(room),
    });
  });

  // ----- JOIN ROOM -----
  socket.on('join_room', ({ code, playerName }) => {
    code = code.toUpperCase();
    const room = rooms[code];

    if (!room) {
      socket.emit('error_msg', { message: 'Sala não encontrada. Verifique o código.' });
      return;
    }
    if (room.started) {
      socket.emit('error_msg', { message: 'Esta partida já começou.' });
      return;
    }
    if (room.players.filter(p => !p.isBot).length >= maxPlayers(room.mode)) {
      socket.emit('error_msg', { message: 'Sala cheia.' });
      return;
    }

    const playerId = socket.id;
    const newPlayer = { id: playerId, name: playerName, isHost: false, isBot: false, alive: true };
    room.players.push(newPlayer);

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = playerId;

    socket.emit('room_joined', { code, playerId, isHost: false, room: safeRoom(room) });
    socket.to(code).emit('player_joined', { player: newPlayer });
  });

  // ----- ADD BOT -----
  socket.on('add_bot', ({ difficulty, code: clientCode }) => {
    const code = socket.data.roomCode || clientCode;
    const room = rooms[code];
    if (!room) {
      socket.emit('error_msg', { message: 'Sala não encontrada. Recarregue a página.' });
      return;
    }
    if (room.host !== socket.id) {
      socket.emit('error_msg', { message: 'Apenas o host pode adicionar bots.' });
      return;
    }

    if (room.players.length >= maxPlayers(room.mode)) {
      socket.emit('error_msg', { message: 'Sala cheia.' });
      return;
    }

    const usedNames = room.players.map(p => p.name);
    const availName = BOT_NAMES_POOL.find(n => !usedNames.includes('BOT_'+n)) || 'BOT_X';
    const botId = 'bot_' + Math.random().toString(36).substr(2,4);
    const bot = {
      id: botId, name: 'BOT_'+availName,
      isHost: false, isBot: true,
      difficulty: difficulty || room.botDifficulty || 2,
      alive: true,
    };

    room.players.push(bot);

    // Assign bot to first available game slot (server-authoritative to avoid client race conditions)
    const gameTotal = maxPlayers(room.mode); // maxPlayers == gameSlotCount for all modes
    if (!room.slots || room.slots.length < 6) {
      room.slots = Array.from({ length: 6 }, (_, i) => (room.slots || [])[i] ?? null);
    }
    const slotIdx = room.slots.findIndex((s, i) => s === null && i < gameTotal);
    if (slotIdx !== -1) {
      room.slots[slotIdx] = { playerId: bot.id, playerName: bot.name, isBot: true };
    }

    io.to(code).emit('player_joined', { player: bot });
    io.to(code).emit('room_updated', { room: safeRoom(room) });
  });

  // ----- REMOVE BOT -----
  socket.on('remove_bot', ({ botId }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;

    room.players = room.players.filter(p => p.id !== botId);
    if (room.slots) {
      room.slots = room.slots.map(s => (s && s.playerId === botId) ? null : s);
    }
    io.to(code).emit('player_left', { playerId: botId });
    io.to(code).emit('room_updated', { room: safeRoom(room) });
  });

  // ----- UPDATE CONFIG -----
  socket.on('update_config', ({ mode, botDifficulty, clearBots }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;

    room.mode = mode;
    room.botDifficulty = botDifficulty;
    if (clearBots) {
      const removed = room.players.filter(p => p.isBot);
      room.players = room.players.filter(p => !p.isBot);
      room.slots = [];
      removed.forEach(bot => io.to(code).emit('player_left', { playerId: bot.id }));
    }
    io.to(code).emit('room_updated', { room: safeRoom(room) });
  });

  // ----- CHAT -----
  socket.on('chat_message', ({ message, playerName }) => {
    const code = socket.data.roomCode;
    if (!rooms[code]) return;

    const entry = {
      id:         Date.now(),
      playerId:   socket.id,
      playerName,
      message,
      time:       new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }),
    };
    io.to(code).emit('chat_message', entry);
  });

  // ----- WEBRTC SIGNALING (relay P2P dentro da mesma sala) -----
  ['webrtc_offer', 'webrtc_answer', 'webrtc_ice_candidate'].forEach(ev => {
    socket.on(ev, ({ targetPlayerId, payload }) => {
      const target = io.sockets.sockets.get(targetPlayerId);
      if (target && target.data.roomCode === socket.data.roomCode) {
        target.emit(ev, { fromPlayerId: socket.id, payload });
      }
    });
  });

  socket.on('voice_hello', ({ playerName }) => {
    const code = socket.data.roomCode;
    if (code) socket.to(code).emit('voice_hello', { fromPlayerId: socket.id, playerName });
  });

  // ----- START GAME -----
  socket.on('start_game', ({ slots }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;

    room.started = true;

    // Enriquecer players com isSpectator (via cross-ref com slots)
    const slotsArr = slots || [];
    const enrichedPlayers = room.players.map(p => ({
      ...p,
      isSpectator: !!(slotsArr.find(s => s?.playerId === p.id)?.isSpectator),
    }));

    const config = {
      mode:          room.mode,
      botDifficulty: room.botDifficulty,
      roomCode:      code,
      players:       enrichedPlayers,
      slots:         slotsArr,
      isMultiplayer: true,
    };

    // Send personalized config to each player (so they know their own name + isSpectator)
    room.players.filter(p => !p.isBot).forEach(p => {
      const playerSocket = io.sockets.sockets.get(p.id);
      if (playerSocket) {
        const isSpectator = !!(slotsArr.find(s => s?.playerId === p.id)?.isSpectator);
        playerSocket.emit('game_starting', {
          config: { ...config, playerName: p.name, playerId: p.id, isHost: p.id === room.host, isSpectator },
        });
      }
    });
  });

  // ----- IN-GAME EVENTS (relay) -----
  socket.on('board_update', ({ boards }) => {
    const code = socket.data.roomCode;
    if (!code) return;
    socket.to(code).emit('board_update', { boards });
  });

  socket.on('use_special', ({ attackerId, targetId, special }) => {
    const code = socket.data.roomCode;
    if (!code) return;
    // Relay to everyone in the room (including sender so all apply)
    io.to(code).emit('use_special', { attackerId, targetId, special, fromBomber: !!socket.data.isBomber });
  });

  socket.on('player_dead', ({ playerId }) => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms[code];
    if (room) {
      const p = room.players.find(p => p.id === playerId);
      if (p) p.alive = false;
    }
    io.to(code).emit('player_dead', { playerId });
  });

  socket.on('game_over', ({ winners, finalScores }) => {
    const code = socket.data.roomCode;
    if (!code) return;
    socket.to(code).emit('game_over', { winners, finalScores });
  });

  // ----- GENERATE BOMBER TOKEN (Tag Team) -----
  socket.on('generate_bomber_token', ({ slotIdx }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) { socket.emit('error_msg', { message: 'Sala não encontrada.' }); return; }
    const slot = (room.slots || [])[slotIdx];
    if (!slot) { socket.emit('error_msg', { message: 'Slot inválido.' }); return; }

    const token = Math.random().toString(36).substr(2, 8)
                + Math.random().toString(36).substr(2, 8);
    bomberTokens[token] = { roomCode: code, slotIdx, expires: Date.now() + 10 * 60 * 1000 };
    socket.emit('bomber_token_ready', { token });
  });

  // ----- BOMBER JOIN (Tag Team) -----
  socket.on('bomber_join', ({ token, bomberName }) => {
    const entry = bomberTokens[token];
    if (!entry) { socket.emit('error_msg', { message: 'Link inválido ou expirado.' }); return; }
    if (entry.expires < Date.now()) {
      delete bomberTokens[token];
      socket.emit('error_msg', { message: 'Link expirado. Peça um novo convite.' }); return;
    }
    const { roomCode, slotIdx } = entry;
    delete bomberTokens[token]; // uso único

    const room = rooms[roomCode];
    if (!room) { socket.emit('error_msg', { message: 'Sala não encontrada.' }); return; }

    const slot = (room.slots || [])[slotIdx];
    if (!slot) { socket.emit('error_msg', { message: 'Slot inválido.' }); return; }

    const moverPlayer = room.players.find(p => p.id === slot.playerId && !slot.isBot);
    if (!moverPlayer) { socket.emit('error_msg', { message: 'Movedor não encontrado.' }); return; }

    bomberLinks[moverPlayer.id] = socket.id;
    moverOfBomber[socket.id]    = moverPlayer.id;

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.isBomber   = true;
    socket.data.moverId    = moverPlayer.id;
    socket.data.bomberName = bomberName;

    socket.emit('bomber_linked', {
      mover:         { id: moverPlayer.id, name: moverPlayer.name },
      inventoryData: [],
      boards:        [],
      players:       room.players,
    });

    const moverSocket = io.sockets.sockets.get(moverPlayer.id);
    if (moverSocket) moverSocket.emit('bomber_linked_ack', { bomberName });
  });

  // ----- INVENTORY UPDATE (Tag Team) -----
  socket.on('inventory_update_tt', ({ moverId, inventory }) => {
    const bomberSocketId = bomberLinks[moverId];
    if (!bomberSocketId) return;
    const bomberSock = io.sockets.sockets.get(bomberSocketId);
    if (bomberSock) bomberSock.emit('inventory_update', { inventory });
  });

  socket.on('narrator_comment', ({ text }) => {
    const code = socket.data.roomCode;
    if (!code || !text) return;
    socket.to(code).emit('narrator_comment', { text });
  });

  socket.on('leave_room', () => {
    cancelLeave(socket.id);
    handleLeave(socket);
  });

  // ----- UPDATE SLOTS -----
  socket.on('update_slots', ({ slots }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    room.slots = slots || [];
    // Notify others (not self — they already updated locally)
    socket.to(code).emit('room_updated', { room: safeRoom(room) });
  });

  // ----- JOIN GAME (reconnect after lobby → game page navigation) -----
  socket.on('join_game', ({ roomCode, playerName, playerId: oldPlayerId }) => {
    const room = rooms[roomCode];
    if (!room) return;

    cancelLeave(oldPlayerId);

    let player = room.players.find(p => p.id === oldPlayerId)
              || room.players.find(p => p.name === playerName && !p.isBot);

    if (player) {
      const wasHost = player.id === room.host;
      player.id = socket.id;
      if (wasHost) room.host = socket.id;
    }

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerId = socket.id;

    // Tag Team: se este jogador tinha bombardeiro vinculado, atualiza mappings e re-emite ack
    if (bomberLinks[oldPlayerId]) {
      const bomberSocketId = bomberLinks[oldPlayerId];
      bomberLinks[socket.id] = bomberSocketId;   // nova chave (disconnect cleanup)
      // chave antiga mantida para inventory_update_tt (usa MY_PLAYER_ID = old socket ID)
      moverOfBomber[bomberSocketId] = socket.id;
      const bomberSock = io.sockets.sockets.get(bomberSocketId);
      if (bomberSock) {
        bomberSock.data.moverId = socket.id;
        socket.emit('bomber_linked_ack', { bomberName: bomberSock.data.bomberName || 'BOMBARDEIRO' });
        // Notifica bombardeiro do novo socket ID do mover e da lista atualizada de jogadores
        bomberSock.emit('bomber_game_start', { newMoverId: socket.id, players: room.players });
      }
    }

    socket.emit('game_joined', { playerId: socket.id });
  });

  // ----- REJOIN ROOM (page navigation reconnect) -----
  socket.on('rejoin_room', ({ code, playerName, oldPlayerId }) => {
    code = (code || '').toUpperCase();
    const room = rooms[code];
    if (!room) {
      socket.emit('error_msg', { message: 'Sala não encontrada.' });
      return;
    }

    // Cancel pending leave for old socket (race condition: disconnect fired before this)
    cancelLeave(oldPlayerId);

    // Find player by old socket id, or by name as fallback
    let player = room.players.find(p => p.id === oldPlayerId)
              || room.players.find(p => p.name === playerName && !p.isBot);

    if (player) {
      const wasHost = player.id === room.host;
      player.id = socket.id;
      if (wasHost) room.host = socket.id;
    } else {
      // Player was removed (race condition) — re-add
      if (room.started) {
        socket.emit('error_msg', { message: 'A partida já começou.' });
        return;
      }
      player = { id: socket.id, name: playerName, isHost: false, isBot: false, alive: true };
      room.players.push(player);
    }

    // Allow restarting the game after everyone returns to lobby
    // Clear all slots and remove bots so everyone can choose fresh
    if (room.started) {
      room.slots = [];
      room.players = room.players.filter(p => !p.isBot);
    }
    room.started = false;

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = socket.id;

    socket.emit('room_joined', {
      code,
      playerId: socket.id,
      isHost: player.id === room.host,
      room: safeRoom(room),
    });
    // Notify others that the player is back (updates their player list)
    socket.to(code).emit('room_updated', { room: safeRoom(room) });
  });

  // ----- DISCONNECT -----
  socket.on('disconnect', () => {
    console.log('disconnect', socket.id);

    // Bombardeiro: limpar vínculo sem grace period
    if (socket.data.isBomber) {
      const mid = moverOfBomber[socket.id];
      if (mid) {
        delete bomberLinks[mid];
        const moverSock = io.sockets.sockets.get(mid);
        if (moverSock) moverSock.emit('bomber_disconnected');
      }
      delete moverOfBomber[socket.id];
      return;
    }

    // Use grace period to allow page-navigation reconnections
    if (socket.data.roomCode) {
      scheduleLeave(socket);
    }
  });

  function handleLeave(socket) {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;

    // Limpar vínculo do Bombardeiro se este era o Movedor
    const bomberSockId = bomberLinks[socket.id];
    if (bomberSockId) {
      delete moverOfBomber[bomberSockId];
      delete bomberLinks[socket.id];
      const bomberSock = io.sockets.sockets.get(bomberSockId);
      if (bomberSock) bomberSock.emit('game_over', {});
    }

    room.players = room.players.filter(p => p.id !== socket.id);
    socket.leave(code);
    socket.data.roomCode = null;

    io.to(code).emit('player_left', { playerId: socket.id });

    if (room.players.filter(p => !p.isBot).length === 0) {
      // No real players left — delete room
      delete rooms[code];
      return;
    }

    // Transfer host if needed
    if (room.host === socket.id) {
      const newHost = room.players.find(p => !p.isBot);
      if (newHost) {
        room.host = newHost.id;
        newHost.isHost = true;
        io.to(code).emit('host_changed', { newHostId: newHost.id });
        io.to(code).emit('room_updated', { room: safeRoom(room) });
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`TetriNET server running on port ${PORT}`));
