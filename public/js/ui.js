// ===== GAME COORDINATOR =====
// Ties together: player board, bots, input, rendering, specials, teams, events

// ===== READ CONFIG =====
const cfg = JSON.parse(sessionStorage.getItem('gameConfig') || '{}');
const PLAYER_NAME    = cfg.playerName || 'JOGADOR_1';
const GAME_MODE      = cfg.mode || 'ffa';
const BOT_COUNT      = Math.max(1, Math.min(5, cfg.botCount || 3));
const BOT_DIFF       = cfg.botDifficulty || 2;
const IS_MULTIPLAYER = !!(cfg.isMultiplayer && typeof SERVER_URL !== 'undefined' && SERVER_URL);
const IS_HOST        = !!(cfg.isHost);
const IS_SPECTATOR   = !!(cfg.isSpectator && IS_MULTIPLAYER);
const ROOM_CODE      = cfg.roomCode || null;
const MY_PLAYER_ID   = cfg.playerId || null; // socket.id from lobby, used to identify self in mp events

// ===== MULTIPLAYER SOCKET =====
// remotePlayers: id → { id, name, board, alive, team }
const remotePlayers = {};
let mpSocket = null;

if (IS_MULTIPLAYER && socketClient) {
  mpSocket = socketClient.socket;

  // Join the game's socket.io room (new socket after page navigation from lobby)
  if (ROOM_CODE && MY_PLAYER_ID) {
    socketClient.joinGame({ roomCode: ROOM_CODE, playerName: PLAYER_NAME, playerId: MY_PLAYER_ID });
  }

  // Save game socket.id so lobby.html can correctly cancel pending leave when returning from game
  mpSocket.on('game_joined', ({ playerId }) => {
    const ld = JSON.parse(sessionStorage.getItem('tetrinet_lobby') || '{}');
    ld.playerId = playerId;
    sessionStorage.setItem('tetrinet_lobby', JSON.stringify(ld));

    // Init voice chat (playerId = novo socket.id nesta página)
    if (typeof voiceManager !== 'undefined' && socketClient) {
      voiceManager.init(playerId, socketClient, (sid, speaking) => {
        const entry = cardMap[sid];
        if (entry) entry.el.classList.toggle('speaking', speaking);
      }).then(ok => {
        if (!ok) return;
        const micBtn = document.getElementById('micBtn');
        if (micBtn) micBtn.classList.remove('hidden');
        // Anuncia presença para peers na sala reconectarem
        socketClient.sendVoiceHello(PLAYER_NAME);
      });
    }
  });

  // Receive board updates from remote players
  mpSocket.on('board_update', ({ boards }) => {
    boards.forEach(({ id, grid, score, lines, level }) => {
      if (id === MY_PLAYER_ID || id === 'player') return; // ignore self echoes
      if (remotePlayers[id]) {
        remotePlayers[id].board.grid = grid;
        if (score !== undefined) remotePlayers[id].score = score;
        if (lines !== undefined) remotePlayers[id].lines = lines;
        if (level !== undefined) remotePlayers[id].level = level;
        renderer.drawMini(id, remotePlayers[id].board, null);
      }
    });
  });

  // Receive specials from remote attackers
  mpSocket.on('use_special', ({ attackerId, targetId, special }) => {
    if (attackerId === MY_PLAYER_ID || attackerId === 'player') return; // ignore own echoes
    // Translate targetId: if it's our socket.id, the local player is the target
    const localTargetId = (MY_PLAYER_ID && targetId === MY_PLAYER_ID) ? 'player' : targetId;
    applySpecial(attackerId, localTargetId, special);
  });

  // Remote player died
  mpSocket.on('player_dead', ({ playerId }) => {
    if (remotePlayers[playerId]) {
      remotePlayers[playerId].alive = false;
      markBotDead(playerId);
      // Redireciona foco do espectador se o player assistido morreu
      if (spectatorFocusId === playerId) {
        Object.values(cardMap).forEach(c => c.el.classList.remove('spectator-focus'));
        spectatorFocusId = null;
        const nextAlive = alivePlayers().find(p => p.id !== 'player');
        if (nextAlive) {
          spectatorFocusId = nextAlive.id;
          cardMap[nextAlive.id]?.el.classList.add('spectator-focus');
        }
      }
      checkGameOver();
    }
  });

  // Remote game over (non-host receives)
  mpSocket.on('game_over', ({ winners, finalScores }) => {
    applyFinalScores(finalScores);
    showGameOver(winners);
  });

  // Narrator comments broadcast from other players
  mpSocket.on('narrator_comment', ({ text }) => {
    logEvent(text, 'narrator'); // logEvent direto — não re-emite em cascata
  });
}

// ===== PIECE SEQUENCE (shared) =====
const SHARED_SEQUENCE = generateSequence(1000);
let seqIndex = 0;
function nextPieceType() {
  return SHARED_SEQUENCE[seqIndex++ % SHARED_SEQUENCE.length];
}

// ===== PLAYER STATE =====
const player = {
  id: 'player',
  name: PLAYER_NAME,
  board: new Board(),
  inventory: [],
  alive: true,
  score: 0,
  lines: 0,
  level: 1,
  team: 0,
  currentPiece: null,
  nextPieceType: null,
};

// ===== BOTS =====
const BOT_NAMES = ['ALPHA','BETA','GAMMA','DELTA','EPSILON'];
const bots = [];

if (IS_MULTIPLAYER) {
  // Multiplayer: build bots from cfg.players (only if host runs them)
  const cfgBots = (cfg.players || []).filter(p => p.isBot);
  if (IS_HOST) {
    cfgBots.forEach((bp, i) => {
      const bot = new BotPlayer(bp.id, bp.name, bp.difficulty || BOT_DIFF, i+1);
      bot.sequence = SHARED_SEQUENCE;
      bot.pieceIndex = 0;
      bots.push(bot);
    });
  }
  // Remote human players (filter out self and spectators)
  (cfg.players || []).filter(p => !p.isBot && !p.isSpectator && p.id !== MY_PLAYER_ID).forEach(rp => {
    remotePlayers[rp.id] = { id: rp.id, name: rp.name, board: new Board(), alive: true, team: 0, score: 0, lines: 0, level: 1 };
  });
  // Guests don't run bots locally — add bots to remotePlayers so their mini boards update via board_update
  if (!IS_HOST) {
    (cfg.players || []).filter(p => p.isBot).forEach(bp => {
      remotePlayers[bp.id] = { id: bp.id, name: bp.name, board: new Board(), alive: true, team: 0, isBot: true, score: 0, lines: 0, level: 1 };
    });
  }
} else {
  // Single-player / mock: build bots normally
  for (let i = 0; i < BOT_COUNT; i++) {
    const bot = new BotPlayer('bot_'+i, 'BOT_'+BOT_NAMES[i], BOT_DIFF, i+1);
    bot.sequence = SHARED_SEQUENCE;
    bot.pieceIndex = 0;
    bots.push(bot);
  }
}

// ===== ALL PLAYERS =====
function allPlayers() { return [player, ...bots, ...Object.values(remotePlayers)]; }
function alivePlayers() { return allPlayers().filter(p=>p.alive); }

// ===== TEAMS =====
const allP = allPlayers();
const teams = buildTeams(allP, GAME_MODE);
allP.forEach(p => p.team = teams[p.id]);

const TEAM_COLORS = ['#7c4dff','#ff1744','#00e676','#ffea00','#00e5ff','#ff6d00'];

// ===== RENDERER =====
const mainCanvas   = document.getElementById('gameCanvas');
const nextCanvas   = document.getElementById('nextCanvas');
const renderer     = new Renderer(mainCanvas, nextCanvas);

// ===== PLAYERS PANEL (mini boards + target selection) =====
const playersPanel = document.getElementById('playersPanel');
const cardMap = {}; // id -> { el, canvas, bombCountEl }
let selectedTarget   = bots[0]?.id || null;
let spectatorFocusId = null; // id do player cujo board é exibido no canvas principal
let isSpectating     = IS_SPECTATOR;

function buildPlayersPanel() {
  playersPanel.innerHTML = '';
  Object.keys(cardMap).forEach(k => delete cardMap[k]);

  allPlayers().forEach((p) => {
    const isSelf = p.id === 'player';
    const teamColor = TEAM_COLORS[p.team] || '#888888';

    const card = document.createElement('div');
    card.className = 'player-card'
      + (p.id === selectedTarget ? ' active' : '')
      + (isSelf ? ' self' : '')
      + (!p.alive ? ' dead' : '');
    if (!isSelf && GAME_MODE !== 'ffa' && p.team === player.team)
      card.classList.add('ally');
    card.id = 'mini_' + p.id;

    // Header: name + bomb count
    const header = document.createElement('div');
    header.className = 'player-card-header';

    const nameEl = document.createElement('span');
    nameEl.className = 'player-card-name';
    nameEl.textContent = isSelf ? p.name + ' ★' : p.name;
    nameEl.style.color = teamColor;

    const bombCountEl = document.createElement('span');
    bombCountEl.className = 'player-bomb-count';
    const bombCount = isSelf ? player.inventory.length : (bots.find(b => b.id === p.id)?.inventory?.length ?? 0);
    bombCountEl.textContent = bombCount > 0 ? '●' + bombCount : '';

    header.appendChild(nameEl);
    header.appendChild(bombCountEl);

    const cv = document.createElement('canvas');
    renderer.registerMiniCanvas(p.id, cv);

    if (GAME_MODE !== 'ffa') card.style.borderBottomColor = teamColor;

    const stamp = document.createElement('div');
    stamp.className = 'target-stamp';
    stamp.textContent = 'ALVO';

    card.appendChild(header);
    card.appendChild(cv);
    card.appendChild(stamp);
    if (isSpectating && !isSelf) {
      card.addEventListener('click', () => {
        spectatorFocusId = p.id;
        Object.values(cardMap).forEach(c => c.el.classList.remove('spectator-focus'));
        cardMap[p.id]?.el.classList.add('spectator-focus');
      });
    }

    playersPanel.appendChild(card);
    cardMap[p.id] = { el: card, canvas: cv, bombCountEl };
  });
}

function selectTarget(id) {
  selectedTarget = id;
  Object.entries(cardMap).forEach(([cardId, { el }]) => {
    el.classList.toggle('active', cardId === id);
  });
  updateNextBombPanel();
}

function navigateTarget(dir) {
  const list = allPlayers().filter(p => p.alive);
  let idx = list.findIndex(p => p.id === selectedTarget);
  if (idx === -1) idx = 0;
  if (dir === 'next') idx = Math.min(idx + 1, list.length - 1);
  else                idx = Math.max(idx - 1, 0);
  selectTarget(list[idx].id);
}

// Botões de navegação de alvo
document.getElementById('btnTargetSelf')?.addEventListener('click', () => selectTarget('player'));
document.getElementById('btnTargetNext')?.addEventListener('click', () => navigateTarget('next'));
document.getElementById('btnTargetPrev')?.addEventListener('click', () => navigateTarget('prev'));

function updateBombCount(id) {
  const entry = cardMap[id];
  if (!entry) return;
  const count = id === 'player'
    ? player.inventory.length
    : (bots.find(b => b.id === id)?.inventory?.length ?? 0);
  entry.bombCountEl.textContent = count > 0 ? '●' + count : '';
}

// ===== NEXT BOMB PANEL =====
function updateNextBombPanel() {
  const keyEl    = document.getElementById('nextBombKey');
  const nameEl   = document.getElementById('nextBombName');
  const targetEl = document.getElementById('nextBombTarget');
  if (!keyEl) return;

  const inv = player.inventory;
  const idx = selectedSpecialIdx !== null ? selectedSpecialIdx : (inv.length > 0 ? 0 : null);
  const sp  = idx !== null ? inv[idx] : null;

  if (!sp) {
    keyEl.textContent  = '—';
    keyEl.className    = 'nb-key empty';
    nameEl.textContent = i18n.t('game.noBombs');
    nameEl.className   = 'nb-name empty';
    targetEl.textContent = '';
    return;
  }

  if (typeof bombTheme !== 'undefined' && bombTheme === 'icons') {
    keyEl.innerHTML = '';
    keyEl.appendChild(makeBombIconEl(sp, 22));
  } else {
    keyEl.textContent = sp.toUpperCase();
  }
  keyEl.className    = 'nb-key';
  nameEl.textContent = i18n.specialName(sp);
  nameEl.className   = 'nb-name';

  if (!selectedTarget) {
    targetEl.textContent = i18n.t('game.noTarget');
  } else if (selectedTarget === 'player') {
    targetEl.textContent = i18n.t('game.onYou');
  } else {
    const t = allPlayers().find(p => p.id === selectedTarget);
    targetEl.textContent = t ? i18n.t('game.onTarget', { name: t.name }) : '';
  }
}

// ===== SPECIALS INVENTORY UI =====
const invEl = document.getElementById('specialsInventory');
let selectedSpecialIdx = null;

// SPECIAL_DESCS now sourced from i18n
const SPECIAL_DESCS = {};
SPECIALS_LIST.forEach(sp => { SPECIAL_DESCS[sp] = () => i18n.specialDesc(sp); });

function renderInventory() {
  invEl.innerHTML = '';
  const inv = player.inventory;
  for (let i = 0; i < MAX_INVENTORY; i++) {
    const slot = document.createElement('div');
    slot.className = 'inv-slot';
    if (inv[i]) {
      slot.classList.add('filled');
      if (typeof bombTheme !== 'undefined' && bombTheme === 'icons') {
        slot.appendChild(makeBombIconEl(inv[i], 18));
      } else {
        slot.textContent = inv[i].toUpperCase();
      }
      slot.title = SPECIAL_NAMES[inv[i]] || inv[i];
      if (i === selectedSpecialIdx) slot.classList.add('selected');
      slot.addEventListener('click', () => {
        selectedSpecialIdx = (selectedSpecialIdx === i) ? null : i;
        renderInventory();
        updateGlossary();
        updateNextBombPanel();
      });
    }
    invEl.appendChild(slot);
  }
  updateGlossary();
  updateNextBombPanel();
  updateBombCount('player');
}

function updateGlossary() {
  const el = document.getElementById('glossaryList');
  if (!el) return;
  el.innerHTML = '';
  const inv = player.inventory;
  const selectedSpecial = selectedSpecialIdx !== null ? inv[selectedSpecialIdx] : null;

  SPECIALS_LIST.forEach(sp => {
    const hasBomb = inv.includes(sp);
    const isSelected = sp === selectedSpecial;
    const isNuke = sp === 'n';

    const item = document.createElement('div');
    item.className = 'glossary-item'
      + (hasBomb   ? ' has-bomb'    : '')
      + (isSelected ? ' is-selected' : '')
      + (isNuke    ? ' is-nuke'     : '');

    const key  = document.createElement('span');
    key.className = 'g-key';
    if (typeof bombTheme !== 'undefined' && bombTheme === 'icons') {
      key.appendChild(makeBombIconEl(sp, 14));
    } else {
      key.textContent = sp.toUpperCase();
    }

    const name = document.createElement('span');
    name.className = 'g-name';
    name.textContent = i18n.specialName(sp);

    const tip = document.createElement('span');
    tip.className = 'g-tooltip';
    tip.textContent = i18n.specialDesc(sp);

    item.appendChild(key);
    item.appendChild(name);
    item.appendChild(tip);
    el.appendChild(item);
  });
}

// ===== EVENT LOG =====
const eventLog = document.getElementById('eventLog');
const MAX_LOG = 6;

function logEvent(msg, type='') {
  const entry = document.createElement('div');
  entry.className = 'event-entry' + (type ? ' '+type : '');
  entry.textContent = msg;
  eventLog.appendChild(entry);
  while (eventLog.children.length > MAX_LOG) eventLog.removeChild(eventLog.firstChild);
}

function narratorLog(msg) {
  logEvent(msg, 'narrator');
  if (IS_MULTIPLAYER && socketClient) {
    socketClient.sendNarratorComment({ text: msg });
  }
}

// ===== FLOATING BOMB LABELS =====
const BOMB_LABEL_COLORS = {
  a:'#ff1744', c:'#00e676', b:'#40c4ff', r:'#ff9100',
  o:'#ff6d00', q:'#e040fb', g:'#64dd17', s:'#00e5ff', n:'#ffffff'
};

function spawnFloatLabel(anchorEl, special, isSelf) {
  if (!anchorEl) return;
  const container = document.querySelector('.game-page') || document.body;
  const rect = anchorEl.getBoundingClientRect();
  const wrapRect = container.getBoundingClientRect();

  const label = document.createElement('div');
  label.className = 'float-label';
  const bombName = i18n?.specialName?.(special) || special.toUpperCase();
  label.textContent = isSelf ? `⚡ ${bombName}` : `💥 ${bombName}`;
  label.style.color  = BOMB_LABEL_COLORS[special] || '#fff';
  label.style.left   = (rect.left - wrapRect.left + rect.width / 2 - 30) + 'px';
  label.style.top    = (rect.top  - wrapRect.top  + rect.height / 2) + 'px';
  container.appendChild(label);
  setTimeout(() => label.remove(), 950);
}

function triggerMiniDOMEffect(id, special) {
  const el = document.getElementById('mini_' + id);
  if (!el) return;
  const color = BOMB_LABEL_COLORS[special] || '#ff1744';
  el.style.setProperty('--impact-color', color);
  el.classList.remove('bomb-hit');
  void el.offsetWidth; // force reflow
  el.classList.add('bomb-hit');
  setTimeout(() => el.classList.remove('bomb-hit'), 450);
  spawnFloatLabel(el, special, false);
}

function triggerMainDOMEffect(special, isSelf) {
  const el = document.getElementById('gameCanvas');
  if (!el) return;
  el.classList.remove('bomb-shake');
  void el.offsetWidth;
  if (['a','n','q','s'].includes(special)) {
    el.classList.add('bomb-shake');
    setTimeout(() => el.classList.remove('bomb-shake'), 400);
  }
  spawnFloatLabel(el, special, isSelf);
}

// ===== TIMER =====
let gameStartTime = null;
const timerEl = document.getElementById('gameTimer');

function updateTimer() {
  if (!gameStartTime) return;
  const s = Math.floor((Date.now() - gameStartTime) / 1000);
  const m = Math.floor(s/60);
  timerEl.textContent = String(m).padStart(2,'0') + ':' + String(s%60).padStart(2,'0');
}

// ===== HUD =====
function updateHUD() {
  document.getElementById('scoreDisplay').textContent = player.score.toLocaleString();
  document.getElementById('linesDisplay').textContent = player.lines;
  document.getElementById('levelDisplay').textContent = player.level;
  document.getElementById('modeLabel').textContent = i18n.t(`game.${GAME_MODE}`) || GAME_MODE.toUpperCase();
}

// ===== PLAYER PIECE MANAGEMENT =====
function spawnPlayerPiece() {
  const type = nextPieceType();
  player.currentPiece = new Piece(type);
  player.nextPieceType = SHARED_SEQUENCE[seqIndex % SHARED_SEQUENCE.length];
  renderer.drawNext(player.nextPieceType);

  // Reset lock delay for new piece
  lockDelayActive = false;
  lockTimer = 0;
  lockResets = 0;

  if (!player.board.isValid(player.currentPiece.shape, 0, player.currentPiece.col)) {
    playerDie();
  }
}

function playerDie() {
  player.alive = false;
  player.currentPiece = null;
  isSpectating = true;
  // Auto-foca o primeiro player vivo ao morrer
  const firstAlive = alivePlayers().find(p => p.id !== 'player');
  if (firstAlive) {
    spectatorFocusId = firstAlive.id;
    Object.values(cardMap).forEach(c => c.el.classList.remove('spectator-focus'));
    cardMap[firstAlive.id]?.el.classList.add('spectator-focus');
  }
  SFX.death();
  document.getElementById('deadOverlay').classList.remove('hidden');
  logEvent(i18n.t('game.youEliminated'), 'attack');
  const _goMsg = narrator.event('gameOver');
  if (_goMsg) narratorLog(_goMsg);
  if (IS_MULTIPLAYER && socketClient) {
    socketClient.sendPlayerDead(MY_PLAYER_ID || 'player');
  }
  checkGameOver();
}

function playerLockPiece() {
  const p = player.currentPiece;
  if (!p) return;
  player.board.place(p.shape, p.row, p.col, p.type);
  const { cleared, specials } = player.board.clearLines();

  SFX.lock();

  if (cleared > 0) {
    player.lines += cleared;
    player.level = Math.floor(player.lines / 10) + 1;
    player.score += calcScore(cleared, player.level);

    SFX.linesCleared(cleared);

    if (cleared >= 4) {
      const _msg = narrator.event('tetris');
      if (_msg) narratorLog(_msg);
    } else {
      const _msg = narrator.event('linesCleared', 5000);
      if (_msg) narratorLog(_msg);
    }

    const spCount = specialsForLines(cleared);
    if (spCount > 0) {
      player.board.injectSpecials(spCount);
      logEvent(i18n.t('game.bombsCaptured', { n: spCount }), 'success');
    }

    const _invBefore = player.inventory.length;
    specials.forEach(sp => {
      if (player.inventory.length < MAX_INVENTORY) {
        player.inventory.push(sp);
        SFX.bombCapture();
      }
    });
    if (player.inventory.length > _invBefore) {
      const _msg = narrator.event('bombCaptured', 4000);
      if (_msg) narratorLog(_msg);
    }

    updateHUD();
    renderInventory();
    logEvent(i18n.t('game.linesCleared', { n: cleared }), 'info');
  }

  // Near-death check
  const _topFilled = player.board.grid.slice(0, 4).some(row => row.some(c => c !== 0));
  if (_topFilled && !player.board.isGameOver()) {
    const _msg = narrator.event('nearDeath', 8000);
    if (_msg) narratorLog(_msg);
  }

  // Update player's own mini board
  renderer.drawMini('player', player.board, player.currentPiece);

  if (player.board.isGameOver()) { playerDie(); return; }
  spawnPlayerPiece();
}

// ===== NARRATOR CONTEXT HELPER =====
function getBombContext(attackerId, targetId) {
  if (attackerId === targetId) return 'self';
  const atk = allPlayers().find(p => p.id === attackerId);
  const tgt = allPlayers().find(p => p.id === targetId);
  if (atk && tgt && atk.team === tgt.team) return 'ally';
  return 'enemy';
}

// ===== APPLY SPECIAL =====
function applySpecial(attackerId, targetId, special) {
  const attacker = allPlayers().find(p=>p.id===attackerId);
  const target   = allPlayers().find(p=>p.id===targetId);
  if (!target || !target.alive) return;

  const attackerBoard = attacker?.board || null;

  if (target.id === 'player') {
    const methodMap = {
      a:'AddLine', c:'ClearLine', b:'ClearSpecials', r:'RandomClear',
      o:'BlockBomb', q:'Blockquake', g:'Gravity', n:'Nuke'
    };
    if (special !== 's') {
      player.board['apply' + methodMap[special]]?.();
    } else if (attackerBoard && attackerId !== 'player') {
      // Switch: swap player board with attacker
      const temp = player.board.grid.map(r=>[...r]);
      player.board.grid = attackerBoard.grid.map(r=>[...r]);
      attackerBoard.grid = temp;
    }
    // Self-switch: no effect

    if (player.board.isGameOver()) playerDie();
    renderer.drawMini('player', player.board, player.currentPiece);

    // ===== VISUAL EFFECT =====
    const isSelf = attackerId === 'player';
    renderer.triggerMainBombEffect(special, isSelf);
    renderer.flashMini('player', isSelf ? BOMB_EFFECT_COLORS[special] : '#ff1744');
    triggerMainDOMEffect(special, isSelf);
    SFX.bombReceived(special);

    const selfMsg = attackerId === 'player';
    logEvent(selfMsg
      ? i18n.t('game.usedOnSelf', { bomb: i18n.specialName(special) })
      : i18n.t('game.receivedBomb', { attacker: attacker?.name||'?', bomb: i18n.specialName(special) }),
      selfMsg ? 'info' : 'attack');
    // Narrator only for self here — bot→player narrator is handled in onUseSpecial after botUsedBomb
    if (selfMsg) {
      const _nm1 = narrator.bomb(special, 'self');
      if (_nm1) narratorLog(_nm1);
    }
  } else {
    const bot = bots.find(b=>b.id===targetId);
    if (bot) {
      bot.receiveSpecial(special, attackerBoard);
      // ===== VISUAL EFFECT on bot's mini board =====
      renderer.triggerMiniBombEffect(targetId, special);
      triggerMiniDOMEffect(targetId, special);
      if (!bot.alive) {
        markBotDead(bot.id);
        SFX.botEliminated();
        logEvent(i18n.t('game.botEliminated', { name: bot.name }), 'attack');
        const _em = narrator.event('botEliminated');
        if (_em) narratorLog(_em);
      }
    }
  }
}

// ===== USE PLAYER SPECIAL =====
function usePlayerSpecial() {
  if (!player.alive) return;
  if (player.inventory.length === 0) { logEvent(i18n.t('game.noInventory')); return; }
  if (!selectedTarget) { logEvent(i18n.t('game.noTarget2')); return; }

  const idx = selectedSpecialIdx !== null ? selectedSpecialIdx : 0;
  if (!player.inventory[idx]) return;

  const special = player.inventory.splice(idx, 1)[0];
  selectedSpecialIdx = null;
  renderInventory();
  SFX.bombUse();

  // applySpecial handles all logging including self-targeting
  applySpecial('player', selectedTarget, special);

  // In multiplayer, notify server so other clients can apply the special too
  if (IS_MULTIPLAYER && socketClient) {
    socketClient.sendSpecial(MY_PLAYER_ID || 'player', selectedTarget, special);
  }

  // Only log here if targeting a bot (self-targeting is logged inside applySpecial)
  if (selectedTarget !== 'player') {
    const targetName = allPlayers().find(p=>p.id===selectedTarget)?.name || '?';
    logEvent(i18n.t('game.usedOnTarget', { bomb: i18n.specialName(special), name: targetName }), 'success');
    const _ctx = getBombContext('player', selectedTarget);
    const _nm = narrator.bomb(special, _ctx);
    if (_nm) narratorLog(_nm);
  }
}

// ===== BOT CALLBACKS =====
bots.forEach(bot => {
  bot.onBoardUpdate = (id, board, piece) => {
    renderer.drawMini(id, board, piece);
  };
  bot.onDead = (id) => {
    markBotDead(id);
    const b = bots.find(b=>b.id===id);
    logEvent(i18n.t('game.botEliminated', { name: b?.name||id }), 'attack');
    checkGameOver();
  };
  bot.onSpecialCaptured = (id, sp) => { updateBombCount(id); };
  bot.onUseSpecial = (id, sp) => {
    const botObj = bots.find(b=>b.id===id);
    const enemies = allPlayers().filter(p => p.alive && p.team !== botObj.team);
    if (enemies.length === 0) return;
    const t = enemies[Math.floor(Math.random()*enemies.length)];
    applySpecial(id, t.id, sp);
    logEvent(i18n.t('game.botUsedBomb', { name: botObj.name, bomb: i18n.specialName(sp) }), 'attack');
    const _ctx = getBombContext(id, t.id);
    const _nm = narrator.bomb(sp, _ctx);
    if (_nm) narratorLog(_nm);
  };
});

function markBotDead(id) {
  const entry = cardMap[id];
  if (entry) entry.el.classList.add('dead');
  selectTarget(selectedTarget);
}

// ===== FINAL SCORES SYNC =====
function applyFinalScores(finalScores) {
  if (!finalScores) return;
  finalScores.forEach(({ id, score, lines, level }) => {
    if (remotePlayers[id]) {
      remotePlayers[id].score = score;
      remotePlayers[id].lines = lines;
      remotePlayers[id].level = level;
    }
    // Atualiza bots locais do host (estão em bots[], não remotePlayers)
    const bot = bots.find(b => b.id === id);
    if (bot) {
      bot.score = score;
      bot.lines = lines;
      bot.level = level;
    }
    // player.score (score local) nunca é sobrescrito aqui
  });
}

// ===== WIN/LOSE CHECK =====
function checkGameOver() {
  const result = checkTeamWinner(allPlayers(), teams, GAME_MODE);
  if (result !== false) {
    showGameOver(result);
  }
}

function buildScoreboard(winnerIds) {
  const tbody = document.getElementById('scoreboardBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const isActualTeamMode = ['2v2', '3v3', '2v2v2'].includes(GAME_MODE);

  // Mostrar/ocultar coluna TIME
  const teamHeader = document.getElementById('sbTeamHeader');
  if (teamHeader) teamHeader.classList.toggle('hidden', !isActualTeamMode);

  // Sort: ranking puramente por score decrescente
  const sorted = [...allPlayers()].sort((a, b) => b.score - a.score);

  sorted.forEach((p, idx) => {
    const rank    = idx + 1;
    const isWin   = winnerIds.includes(p.id);
    const isYou   = p.id === 'player' || p.id === MY_PLAYER_ID;
    const isDead  = !p.alive && !isWin;

    const tr = document.createElement('tr');
    if (isWin) tr.classList.add('sb-winner');
    if (isYou) tr.classList.add('sb-you');
    if (isDead) tr.classList.add('sb-dead');
    tr.style.animationDelay = (idx * 0.07) + 's';

    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
    const rankClass = rank <= 3 ? `sb-rank-${rank}` : '';

    const teamCell = isActualTeamMode
      ? `<td><span class="sb-team-dot" style="background:${TEAM_COLORS[(p.team ?? 0) % TEAM_COLORS.length]}"></span></td>`
      : '';

    // Troféu antes do nome do vencedor em FFA/1v1
    const displayName = (!isActualTeamMode && isWin ? '🏆 ' : '') + p.name;

    tr.innerHTML = `
      <td class="${rankClass}">${medal}</td>
      <td>${displayName}</td>
      ${teamCell}
      <td>${p.score.toLocaleString()}</td>
      <td>${p.lines}</td>
      <td>${p.level}</td>
    `;
    tbody.appendChild(tr);
  });
}

function showGameOver(winners) {
  gameRunning = false;
  const el    = document.getElementById('gameOverOverlay');
  const title = document.getElementById('gameOverTitle');
  const wt    = document.getElementById('winnerText');
  const sub   = document.getElementById('winnerSub');
  el.classList.remove('hidden');
  document.getElementById('deadOverlay').classList.add('hidden');

  // Reset de estilos inline (pode ter sido setado por partida anterior)
  wt.style.color         = '';
  wt.style.textShadow    = '';
  title.style.color      = '';
  title.style.textShadow = '';

  // Helper: aplica estilo de derrota no título
  function _setDefeatTitle() {
    title.style.color      = 'var(--danger, #ff1744)';
    title.style.textShadow = '0 0 16px rgba(255,23,68,0.5)';
  }

  let winnerIds = [];

  if (!winners) {
    title.textContent = i18n.t('game.draw');
    wt.textContent    = '';
    sub.textContent   = '';
  } else if (Array.isArray(winners)) {
    winnerIds = winners.map(w => w.id);
    const playerWon = winnerIds.includes('player') || (MY_PLAYER_ID && winnerIds.includes(MY_PLAYER_ID));

    if (playerWon) {
      title.textContent = i18n.t('game.victory');
    } else {
      title.textContent = i18n.t('game.defeat');
      _setDefeatTitle();
    }

    const isActualTeamMode = ['2v2', '3v3', '2v2v2'].includes(GAME_MODE);
    if (isActualTeamMode) {
      const winTeam   = teams[winnerIds[0]] ?? 0;
      const teamColor = TEAM_COLORS[winTeam % TEAM_COLORS.length];
      const teamLabel = i18n.t('game.team', { n: winTeam + 1 });
      wt.textContent      = playerWon
        ? i18n.t('game.youWon')
        : i18n.t('game.teamWins', { label: teamLabel });
      wt.style.color      = teamColor;
      wt.style.textShadow = `0 0 16px ${teamColor}80`;
      sub.textContent     = i18n.t('game.teamMembers', { names: winners.map(w => w.name).join(' & ') });
    } else {
      wt.textContent  = playerWon ? i18n.t('game.youWon') : i18n.t('game.playerWins', { name: winners.map(w => w.name).join(', ') });
      sub.textContent = i18n.t('game.winners', { names: winners.map(w => w.name).join(', ') });
    }
  } else {
    winnerIds = [winners.id];
    const playerWon = winners.id === 'player' || winners.id === MY_PLAYER_ID;

    if (playerWon) {
      title.textContent = i18n.t('game.victory');
    } else {
      title.textContent = i18n.t('game.defeat');
      _setDefeatTitle();
    }
    wt.textContent  = playerWon ? i18n.t('game.youWon') : i18n.t('game.playerWins', { name: winners.name });
    sub.textContent = i18n.t('game.winner', { name: winners.name });
  }

  if (IS_MULTIPLAYER && IS_HOST && socketClient) {
    const finalScores = allPlayers().map(p => ({
      id: p.id, score: p.score, lines: p.lines, level: p.level
    }));
    applyFinalScores(finalScores); // host aplica também para consistência local
    socketClient.sendGameOver(winners, finalScores);
  }

  buildScoreboard(winnerIds);

  const playerWon = winnerIds.includes('player') || (MY_PLAYER_ID && winnerIds.includes(MY_PLAYER_ID));
  if (playerWon) {
    const _vm = narrator.event('victory');
    if (_vm) narratorLog(_vm);
  }
  setTimeout(() => playerWon ? SFX.victory() : SFX.gameOver(), 300);
}

// ===== MULTIPLAYER BOARD SYNC =====
let mpSyncTimer = 0;
const MP_SYNC_RATE = 100; // ms

function sendBoardSync(delta) {
  if (!IS_MULTIPLAYER || !mpSocket) return;
  mpSyncTimer += delta;
  if (mpSyncTimer < MP_SYNC_RATE) return;
  mpSyncTimer = 0;

  const boards = [{ id: MY_PLAYER_ID || 'player', grid: player.board.grid, score: player.score, lines: player.lines, level: player.level }];
  if (IS_HOST) {
    bots.forEach(b => boards.push({ id: b.id, grid: b.board.grid, score: b.score, lines: b.lines, level: b.level }));
  }
  socketClient.sendBoardUpdate(boards);
}

// ===== GRAVITY (DROP TIMER) =====
let dropInterval = 800; // ms between auto-drops, decreases over time
let dropTimer = 0;
let speedTimer = 0;
const SPEED_INTERVAL = 30000; // speed up every 30s
const SPEED_FACTOR   = 0.85;
const MIN_DROP       = 100;

// ===== LOCK DELAY =====
const LOCK_DELAY    = 500;  // ms before piece locks after landing
const MAX_RESETS    = 15;   // max move/rotate resets per piece
let lockDelayActive = false;
let lockTimer       = 0;
let lockResets      = 0;

// ===== INPUT =====
const keys = {};
let softDropActive = false;
let moveRepeatKey  = null;
const MOVE_INITIAL_DELAY = 180;
const MOVE_REPEAT_RATE   = 60;
let moveHeld = 0;


document.addEventListener('keydown', e => {
  const code   = e.code;
  const action = getActionForKey(code);

  // M = toggle mute (always active, regardless of game state)
  if (code === 'KeyM') {
    SFX.setEnabled(!SFX.isEnabled());
    updateSfxButton();
    return;
  }

  // Always prevent default for bound keys
  if (action) e.preventDefault();

  if (!gameRunning || !player.alive) return;
  if (!action) return;

  switch(action) {
    case 'moveLeft':
    case 'moveRight':
      if (!keys[code]) {
        keys[code] = true;
        moveRepeatKey = code;
        moveHeld = 0;
        handleMove(action);
      }
      break;

    case 'rotate': {
      const rotated = player.currentPiece?.rotate(player.board);
      if (rotated) { resetLockDelay(); SFX.rotate(); }
      break;
    }

    case 'softDrop':
      softDropActive = true;
      break;

    case 'hardDrop':
      lockDelayActive = false;
      lockTimer  = 0;
      lockResets = 0;
      player.currentPiece?.hardDrop(player.board);
      SFX.hardDrop();
      playerLockPiece();
      dropTimer = 0;
      break;

    case 'useBomb':
      usePlayerSpecial();
      break;

    case 'discardBomb':
      discardPlayerSpecial();
      break;

    case 'targetSelf': selectTarget('player'); break;
    case 'targetNext': navigateTarget('next'); break;
    case 'targetPrev': navigateTarget('prev'); break;
  }
});

document.addEventListener('keyup', e => {
  const code   = e.code;
  const action = getActionForKey(code);
  keys[code] = false;
  if (action === 'softDrop') softDropActive = false;
  if (code === moveRepeatKey) { moveRepeatKey = null; moveHeld = 0; }
});

function handleMove(action) {
  if (!player.currentPiece) return;
  let moved = false;
  if (action === 'moveLeft')  moved = player.currentPiece.moveLeft(player.board);
  if (action === 'moveRight') moved = player.currentPiece.moveRight(player.board);
  if (moved) { resetLockDelay(); SFX.move(); }
}

function resetLockDelay() {
  if (lockDelayActive && lockResets < MAX_RESETS) {
    lockTimer  = 0;
    lockResets++;
  }
}

// ===== DISCARD BOMB =====
function discardPlayerSpecial() {
  if (!player.alive) return;
  const idx = selectedSpecialIdx !== null ? selectedSpecialIdx : (player.inventory.length > 0 ? 0 : null);
  if (idx === null || !player.inventory[idx]) {
    logEvent(i18n.t('game.noBombDiscard')); return;
  }
  const sp = player.inventory.splice(idx, 1)[0];
  selectedSpecialIdx = null;
  renderInventory();
  logEvent(i18n.t('game.bombDiscarded', { name: i18n.specialName(sp) }), 'info');
  const _dm = narrator.event('bombDiscarded');
  if (_dm) narratorLog(_dm);
}

// ===== WATCH / LEAVE BUTTONS =====
document.getElementById('watchBtn').addEventListener('click', () => {
  document.getElementById('deadOverlay').classList.add('hidden');
  isSpectating = true; // playerDie já setou, mas garante
  logEvent(i18n.t('game.watching'), 'info');
});

document.getElementById('leaveBtn').addEventListener('click', () => {
  const confirmed = confirm(i18n.t('game.leaveConfirm'));
  if (confirmed) {
    if (typeof voiceManager !== 'undefined') voiceManager.destroy();
    sessionStorage.removeItem('tetrinet_mock_session');
    sessionStorage.removeItem('tetrinet_lobby');
    window.location.href = 'index.html';
  }
});

// ===== GAME LOOP =====
let gameRunning = false;
let lastTime = 0;

function gameLoop(ts) {
  if (!gameRunning) return;
  const delta = ts - lastTime;
  lastTime = ts;

  updateTimer();
  sendBoardSync(delta);

  // Speed up over time
  speedTimer += delta;
  if (speedTimer >= SPEED_INTERVAL) {
    speedTimer = 0;
    dropInterval = Math.max(MIN_DROP, dropInterval * SPEED_FACTOR);
    bots.forEach(b => {
      b.dropInterval = Math.max(80, b.dropInterval * SPEED_FACTOR);
    });
    SFX.speedUp();
  }

  // Player movement repeat
  if (moveRepeatKey && keys[moveRepeatKey]) {
    moveHeld += delta;
    if (moveHeld >= MOVE_INITIAL_DELAY) {
      if ((moveHeld - MOVE_INITIAL_DELAY) % MOVE_REPEAT_RATE < delta) {
        handleMove(getActionForKey(moveRepeatKey));
      }
    }
  }

  // Player drop + lock delay
  const effectiveDrop = softDropActive ? Math.min(60, dropInterval * 0.1) : dropInterval;
  dropTimer += delta;
  if (dropTimer >= effectiveDrop) {
    dropTimer = 0;
    if (player.alive && player.currentPiece) {
      const canMoveDown = player.currentPiece.moveDown(player.board);
      if (canMoveDown) {
        // Piece moved down — cancel any active lock delay
        lockDelayActive = false;
        lockTimer = 0;
        lockResets = 0;
      } else {
        // Piece is on the ground — start or continue lock delay
        if (!lockDelayActive) {
          lockDelayActive = true;
          lockTimer = 0;
          lockResets = 0;
        }
      }
    }
  }

  // Tick lock delay
  if (lockDelayActive && player.alive && player.currentPiece) {
    lockTimer += delta;
    if (lockTimer >= LOCK_DELAY || lockResets >= MAX_RESETS) {
      lockDelayActive = false;
      lockTimer = 0;
      lockResets = 0;
      playerLockPiece();
    } else {
      // Draw lock border pulse
      renderer.drawLockBorder(lockTimer / LOCK_DELAY);
    }
  }

  // Update bots
  bots.forEach(bot => {
    if (bot.alive) bot.update(delta);
  });

  // Render — modo espectador: mostra board do player focado
  if (isSpectating && spectatorFocusId) {
    const focusTarget = allPlayers().find(p => p.id === spectatorFocusId);
    if (focusTarget?.board) {
      renderer.drawMain(focusTarget.board, focusTarget.currentPiece ?? null, null, ts);
    }
  } else if (player.alive && player.currentPiece) {
    const ghost = player.currentPiece.ghostRow(player.board);
    renderer.drawMain(player.board, player.currentPiece, ghost, ts);
  } else if (!player.alive) {
    renderer.drawMain(player.board, null, null, ts);
  }

  requestAnimationFrame(gameLoop);
}

// ===== COUNTDOWN & START =====
function doCountdown(n, cb) {
  const el = document.getElementById('countdownNum');
  const ov = document.getElementById('countdownOverlay');
  el.textContent = n;
  // force reflow for animation restart
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = '';

  if (n <= 0) {
    ov.classList.add('hidden');
    SFX.countdownGo();
    cb();
    return;
  }
  SFX.countdownBeep();
  setTimeout(() => doCountdown(n-1, cb), 1000);
}

function startGame() {
  // Reset player
  player.board    = new Board();
  player.inventory = [];
  player.alive    = true;
  player.score    = 0;
  player.lines    = 0;
  player.level    = 1;
  seqIndex        = 0;

  // Reset bots
  bots.forEach(bot => {
    bot.board       = new Board();
    bot.inventory   = [];
    bot.alive       = true;
    bot.score       = 0;
    bot.lines       = 0;
    bot.level       = 1;
    bot.pieceIndex  = 0;
    bot.sequence    = SHARED_SEQUENCE;
    bot.currentPiece = null;
    bot.targetMove  = null;
    bot.thinkTimer  = 0;
    bot.dropTimer   = 0;
    bot.dropInterval = bot.getDropInterval();
    // Remove dead class from mini boards
    const el = document.getElementById('mini_'+bot.id);
    if (el) el.classList.remove('dead');
    bot.spawnPiece();
  });

  dropInterval    = 800;
  dropTimer       = 0;
  speedTimer      = 0;
  gameStartTime   = Date.now();

  spawnPlayerPiece();
  updateHUD();
  renderInventory();
  buildPlayersPanel();

  // Aplica filtro de voz por time (somente modos com times reais: 2v2, 3v3, 2v2v2)
  if (typeof voiceManager !== 'undefined' && ['2v2', '3v3', '2v2v2'].includes(GAME_MODE)) {
    const socketTeamMap = {};
    allPlayers().forEach(p => { if (p.id) socketTeamMap[p.id] = p.team; });
    voiceManager.setTeamFilter(player.team, socketTeamMap);
  }

  document.getElementById('gameOverOverlay').classList.add('hidden');
  document.getElementById('deadOverlay').classList.add('hidden');
  document.getElementById('eventLog').innerHTML = '';

  logEvent(i18n.t('game.gameStarted'), 'info');

  gameRunning = true;
  lastTime    = performance.now();
  requestAnimationFrame(gameLoop);
}

// ===== MIC BUTTON =====
document.getElementById('micBtn')?.addEventListener('click', () => {
  if (typeof voiceManager === 'undefined') return;
  const muted = voiceManager.toggleMute();
  const btn = document.getElementById('micBtn');
  if (btn) { btn.textContent = muted ? '🔇' : '🎤'; btn.classList.toggle('muted', muted); }
});

// ===== BUTTONS =====
document.getElementById('lobbyBtn').addEventListener('click', () => {
  const winnerSub  = document.getElementById('winnerSub').textContent;
  const winnerText = document.getElementById('winnerText').textContent;
  const result     = winnerSub || winnerText;
  const msg        = i18n.t('lobby.matchEnded', { result });
  sessionStorage.setItem('tetrinet_lobby_msg', msg);

  const lobbyData = JSON.parse(sessionStorage.getItem('tetrinet_lobby') || '{}');
  if (lobbyData.code) {
    try {
      const raw = localStorage.getItem('tetrinet_room_' + lobbyData.code);
      if (raw) {
        const room = JSON.parse(raw);
        room.started = false;
        localStorage.setItem('tetrinet_room_' + lobbyData.code, JSON.stringify(room));
      }
    } catch(e) {}
  }

  if (typeof voiceManager !== 'undefined') voiceManager.destroy();
  window.location.href = 'lobby.html';
});

document.getElementById('menuBtn').addEventListener('click', () => {
  if (typeof voiceManager !== 'undefined') voiceManager.destroy();
  sessionStorage.removeItem('tetrinet_mock_session');
  sessionStorage.removeItem('tetrinet_lobby');
  window.location.href = 'index.html';
});

// ===== SFX BUTTON =====
function updateSfxButton() {
  const btn = document.getElementById('sfxToggle');
  if (!btn) return;
  btn.textContent = SFX.isEnabled() ? '🔊' : '🔇';
  btn.title = SFX.isEnabled() ? i18n.t('game.sfxOn') : i18n.t('game.sfxOff');
}

document.getElementById('sfxToggle')?.addEventListener('click', () => {
  SFX.setEnabled(!SFX.isEnabled());
  updateSfxButton();
});

// ===== INIT =====
i18n.load().then(() => {
  i18n.applyToDOM();
  updateHUD();
  buildPlayersPanel();
  updateGlossary();
  updateNextBombPanel();
  updateSfxButton();

  if (IS_SPECTATOR) {
    // Espectador: não joga, entra direto em modo assistir após countdown
    player.alive = false;
    isSpectating  = true;
    doCountdown(3, () => {
      gameRunning = true;
      const firstAlive = alivePlayers()[0];
      if (firstAlive) {
        spectatorFocusId = firstAlive.id;
        Object.values(cardMap).forEach(c => c.el.classList.remove('spectator-focus'));
        cardMap[firstAlive.id]?.el.classList.add('spectator-focus');
      }
      lastTime = performance.now();
      requestAnimationFrame(gameLoop);
    });
  } else {
    doCountdown(3, startGame);
  }
});
