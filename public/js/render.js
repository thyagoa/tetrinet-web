// ===== RENDERER =====
// Draws the main player board and mini boards for opponents

// ===== PARTICLE SYSTEM =====
class Particle {
  constructor(x, y, color, vx, vy, life, size) {
    this.x = x; this.y = y;
    this.color = color;
    this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life;
    this.size = size;
  }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += 0.0008 * dt; // gravity
    this.life -= dt;
  }
  get alive() { return this.life > 0; }
  get alpha() { return Math.max(0, this.life / this.maxLife); }
}

// ===== BOMB EFFECT PALETTE =====
// Each special has a distinct color and intensity multiplier
const BOMB_EFFECT_COLORS = {
  a: '#ff1744',  // Add Line     — red (bad, aggressive)
  c: '#00e676',  // Clear Line   — green (good, helpful)
  b: '#40c4ff',  // Clear Spec.  — light blue (neutral clear)
  r: '#ff9100',  // Random Clear — orange (chaotic)
  o: '#ff6d00',  // Block Bomb   — deep orange (explosion)
  q: '#e040fb',  // Blockquake   — purple (chaotic)
  g: '#64dd17',  // Gravity      — lime (structural)
  s: '#00e5ff',  // Switch       — cyan (swap)
  n: '#ffffff',  // Nuke         — white (devastating)
};

const BOMB_EFFECT_INTENSITY = {
  a: 0.8,
  c: 0.6,
  b: 0.6,
  r: 0.9,
  o: 1.0,
  q: 1.2,
  g: 0.7,
  s: 1.0,
  n: 1.5,   // Nuke — maximum intensity
};

class Renderer {
  constructor(mainCanvas, nextCanvas) {
    this.main = mainCanvas;
    this.mctx = mainCanvas.getContext('2d');
    this.next = nextCanvas;
    this.nctx = nextCanvas.getContext('2d');

    // ===== EFFECTS STATE =====
    this.particles = [];          // active particles on main canvas
    this.mainFlash = null;        // { color, alpha, decay } flash overlay on main canvas
    this.shakeOffset = { x: 0, y: 0 };
    this.shakeTimer = 0;
    this.shakeMagnitude = 0;
    this.miniFlashes = {};        // id -> { color, alpha }

    // Calculate cell size to fit available space
    // Desconta: header(48) + padding top(12) + gap(8) + bomb panel(44) + padding bottom(12)
    const availH = window.innerHeight - 124;
    const availW = window.innerWidth - 180 - 240 - 24;
    const cellByH = Math.floor(availH / ROWS);
    const cellByW = Math.floor(availW / COLS);
    this.cell = Math.max(16, Math.min(CELL, cellByH, cellByW));

    // Inform CSS of exact field column width so the layout centers correctly
    document.documentElement.style.setProperty('--field-col-w', (COLS * this.cell + 24) + 'px');

    // Setup main canvas
    this.main.width  = COLS * this.cell;
    this.main.height = ROWS * this.cell;

    // Setup next canvas — always uses base CELL size
    this.next.width  = 6 * CELL;
    this.next.height = 5 * CELL;

    this.miniCanvases = {};   // id -> canvas
    this.lastEffectTime = performance.now();
  }

  registerMiniCanvas(id, canvas) {
    canvas.width  = COLS * MINI_CELL;
    canvas.height = ROWS * MINI_CELL;
    this.miniCanvases[id] = canvas;
  }

  // ===== EFFECTS UPDATE =====
  updateEffects(now) {
    const dt = now - this.lastEffectTime;
    this.lastEffectTime = now;

    // Update particles
    this.particles = this.particles.filter(p => { p.update(dt); return p.alive; });

    // Decay main flash
    if (this.mainFlash) {
      this.mainFlash.alpha -= dt * this.mainFlash.decay;
      if (this.mainFlash.alpha <= 0) this.mainFlash = null;
    }

    // Decay shake
    if (this.shakeTimer > 0) {
      this.shakeTimer -= dt;
      if (this.shakeTimer <= 0) {
        this.shakeTimer = 0;
        this.shakeOffset = { x: 0, y: 0 };
      } else {
        const prog = this.shakeTimer / 400;
        const mag  = this.shakeMagnitude * prog;
        this.shakeOffset = {
          x: (Math.random() * 2 - 1) * mag,
          y: (Math.random() * 2 - 1) * mag,
        };
      }
    }

    // Decay mini flashes
    for (const id in this.miniFlashes) {
      this.miniFlashes[id].alpha -= dt * 0.005;
      if (this.miniFlashes[id].alpha <= 0) delete this.miniFlashes[id];
    }
  }

  // ===== MAIN BOARD =====
  drawMain(board, piece, ghost, now = performance.now()) {
    this.updateEffects(now);

    const ctx = this.mctx;
    const S = this.cell;
    const w = this.main.width;
    const h = this.main.height;

    ctx.save();
    ctx.translate(this.shakeOffset.x, this.shakeOffset.y);

    // Background
    ctx.fillStyle = '#060610';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 0.5;
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath(); ctx.moveTo(0, r*S); ctx.lineTo(w, r*S); ctx.stroke();
    }
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath(); ctx.moveTo(c*S, 0); ctx.lineTo(c*S, h); ctx.stroke();
    }

    // Board cells
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = board.grid[r][c];
        if (cell !== 0) {
          this.drawCell(ctx, c, r, cell, S);
        }
      }
    }

    // Ghost piece
    if (ghost !== null && piece) {
      const ghostColor = this.getColor(piece.type);
      const shape = piece.shape;
      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (!shape[r][c]) continue;
          this.drawGhostCell(ctx, piece.col + c, ghost + r, S, ghostColor);
        }
      }
    }

    // Active piece
    if (piece) {
      const shape = piece.shape;
      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (!shape[r][c]) continue;
          this.drawCell(ctx, piece.col + c, piece.row + r, piece.type, S);
        }
      }
    }

    // Flash overlay on main board
    if (this.mainFlash) {
      const f = this.mainFlash;
      ctx.fillStyle = f.color;
      ctx.globalAlpha = Math.min(f.alpha, 0.55);
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    // Particles
    this.particles.forEach(p => {
      ctx.globalAlpha = p.alpha * 0.9;
      ctx.fillStyle = p.color;
      const s = p.size * p.alpha;
      ctx.fillRect(p.x - s/2, p.y - s/2, s, s);
    });
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  drawCell(ctx, col, row, type, size) {
    const x = col * size;
    const y = row * size;
    const color = this.getColor(type);
    const pad = size > 10 ? 1 : 0;

    // Main fill
    ctx.fillStyle = color;
    ctx.fillRect(x + pad, y + pad, size - pad*2, size - pad*2);

    if (size > 8) {
      // Highlight (top-left)
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x + pad, y + pad, size - pad*2, 2);
      ctx.fillRect(x + pad, y + pad, 2, size - pad*2);

      // Shadow (bottom-right)
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x + pad, y + size - pad - 2, size - pad*2, 2);
      ctx.fillRect(x + size - pad - 2, y + pad, 2, size - pad*2);

      // Special label / icon
      if (typeof type === 'string' && type.startsWith('sp:')) {
        const sp = type.slice(3);
        if (typeof bombTheme !== 'undefined' && bombTheme === 'icons') {
          const img = getBombImg(sp);
          const pad2 = Math.round(size * 0.12);
          const iSize = size - pad2 * 2;
          if (img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, x + pad2, y + pad2, iSize, iSize);
          } else {
            img.onload = () => {}; // image will be ready on next frame
          }
        } else {
          ctx.fillStyle = '#000';
          ctx.font = `bold ${Math.floor(size * 0.5)}px "Share Tech Mono", monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(sp.toUpperCase(), x + size/2, y + size/2);
        }
      }
    }
  }

  drawGhostCell(ctx, col, row, size, color) {
    const x = col * size;
    const y = row * size;
    // Colored fill at low opacity so ghost is visible against black background
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = color || '#ffffff';
    ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
    ctx.globalAlpha = 1;
    // Slightly brighter border
    ctx.strokeStyle = (color || '#ffffff') + '88';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
  }

  getColor(type) {
    if (typeof type === 'string' && type.startsWith('sp:')) {
      if (typeof bombTheme !== 'undefined' && bombTheme === 'icons') {
        const sp = type.slice(3);
        return (BOMB_ICON_BG && BOMB_ICON_BG[sp]) || '#333355';
      }
      return COLORS.sp;
    }
    if (type === 'G') return '#444466'; // garbage
    return COLORS[type] || '#888888';
  }

  // ===== NEXT PIECE =====
  drawNext(pieceType) {
    const ctx = this.nctx;
    ctx.clearRect(0, 0, this.next.width, this.next.height);
    ctx.fillStyle = '#060610';
    ctx.fillRect(0, 0, this.next.width, this.next.height);

    if (!pieceType) return;
    const shape = PIECE_SHAPES[pieceType][0];
    const offX = Math.floor((6 - shape[0].length) / 2);
    const offY = Math.floor((5 - shape.length) / 2);

    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        this.drawCell(ctx, offX + c, offY + r, pieceType, CELL);
      }
    }
  }

  // ===== MINI BOARD =====
  drawMini(id, board, piece) {
    const canvas = this.miniCanvases[id];
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const S = MINI_CELL;

    ctx.fillStyle = '#060610';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Board cells
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = board.grid[r][c];
        if (cell !== 0) {
          ctx.fillStyle = this.getColor(cell);
          ctx.fillRect(c*S, r*S, S-0.5, S-0.5);
        }
      }
    }

    // Active piece
    if (piece) {
      const shape = piece.shape;
      ctx.fillStyle = COLORS[piece.type] || '#888';
      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (!shape[r][c]) continue;
          ctx.fillRect((piece.col+c)*S, (piece.row+r)*S, S-0.5, S-0.5);
        }
      }
    }

    // Mini flash overlay
    const flash = this.miniFlashes[id];
    if (flash) {
      ctx.fillStyle = flash.color;
      ctx.globalAlpha = Math.min(flash.alpha, 0.6);
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;

      // Bright border
      ctx.strokeStyle = flash.color;
      ctx.globalAlpha = Math.min(flash.alpha, 0.9);
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
      ctx.globalAlpha = 1;
    }
  }

  // Flash effect on a mini canvas (attack received / sent)
  flashMini(id, color = '#ff1744') {
    this.miniFlashes[id] = { color, alpha: 1.0, decay: 0.004 };
  }

  // Draw lock delay border glow on main canvas
  drawLockBorder(progress) {
    // progress: 0..1 where 1 = about to lock
    const ctx = this.mctx;
    const w = this.main.width;
    const h = this.main.height;
    const alpha = 0.25 + progress * 0.55;
    const pulse = Math.sin(Date.now() / 80) * 0.5 + 0.5;
    const finalAlpha = alpha * (0.6 + pulse * 0.4);
    ctx.strokeStyle = `rgba(255, 200, 0, ${finalAlpha})`;
    ctx.lineWidth = 3 + progress * 3;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  }

  // ===== PUBLIC EFFECT TRIGGERS =====

  // Call when the PLAYER'S board is attacked or uses a bomb on themselves
  triggerMainBombEffect(special, isSelf = false) {
    const color = BOMB_EFFECT_COLORS[special] || '#ffffff';
    const intensity = BOMB_EFFECT_INTENSITY[special] || 1;

    // Flash
    this.mainFlash = { color, alpha: 0.7 * intensity, decay: 0.003 };

    // Shake — only for impactful bombs
    const shakers = ['a', 'q', 'g', 'n', 's'];
    if (shakers.includes(special)) {
      this.shakeTimer = 400;
      this.shakeMagnitude = special === 'n' ? 10 : special === 'q' ? 8 : 5;
    }

    // Particles from center of the board
    const cx = this.main.width  / 2;
    const cy = this.main.height / 2;
    this.spawnParticles(cx, cy, color, 28 * intensity, isSelf ? 0.08 : 0.12);
  }

  // Call when a BOT's board is attacked (flash + particles on their mini)
  triggerMiniBombEffect(id, special) {
    const color = BOMB_EFFECT_COLORS[special] || '#ffffff';
    this.flashMini(id, color);
    // Spawn a few particles inside the mini canvas world (visual in main canvas near mini)
    // We don't draw particles on mini canvases — the flash border is enough
  }

  // Spawn burst of square particles from (cx, cy)
  spawnParticles(cx, cy, color, count = 20, speed = 0.1) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const mag   = speed * (0.5 + Math.random() * 1.5);
      const vx    = Math.cos(angle) * mag;
      const vy    = Math.sin(angle) * mag - speed * 0.5;
      const life  = 400 + Math.random() * 600;
      const size  = 3 + Math.random() * 6;
      this.particles.push(new Particle(cx, cy, color, vx, vy, life, size));
    }
  }
}
