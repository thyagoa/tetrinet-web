// ===== BOT AI =====
// Simulates a TetriNET player using heuristic column evaluation.
// Difficulty 1 = easy (random + slow), 2 = medium, 3 = hard (optimal + fast)

class BotPlayer {
  constructor(id, name, difficulty, teamIndex) {
    this.id = id;
    this.name = name;
    this.difficulty = difficulty; // 1,2,3
    this.team = teamIndex;

    this.board = new Board();
    this.inventory = [];
    this.alive = true;
    this.score = 0;
    this.lines = 0;
    this.level = 1;

    this.currentPiece = null;
    this.pieceIndex = 0;
    this.sequence = [];

    // Bot timing
    this.thinkTimer = 0;
    this.thinkInterval = this.getThinkInterval();
    this.dropTimer = 0;
    this.dropInterval = this.getDropInterval();

    this.targetMove = null; // {col, rot}
    this.movesExecuted = 0;

    this.onBoardUpdate = null; // callback
    this.onDead = null;
    this.onSpecialCaptured = null;
  }

  getThinkInterval() {
    return [0, 800, 400, 150][this.difficulty];
  }

  getDropInterval() {
    return [0, 600, 350, 200][this.difficulty];
  }

  setSequence(seq) {
    this.sequence = seq;
    this.spawnPiece();
  }

  spawnPiece() {
    if (!this.alive) return;
    const type = this.sequence[this.pieceIndex % this.sequence.length];
    this.pieceIndex++;
    this.currentPiece = new Piece(type);
    this.targetMove = null;
    this.movesExecuted = 0;

    if (!this.board.isValid(this.currentPiece.shape, this.currentPiece.row, this.currentPiece.col)) {
      this.die();
    }
  }

  die() {
    this.alive = false;
    if (this.onDead) this.onDead(this.id);
  }

  // Main update tick - called every frame with delta ms
  update(delta) {
    if (!this.alive || !this.currentPiece) return;

    this.thinkTimer += delta;
    this.dropTimer += delta;

    // Think: calculate best move
    if (this.thinkTimer >= this.thinkInterval && !this.targetMove) {
      this.thinkTimer = 0;
      this.targetMove = this.calcBestMove();
      this.movesExecuted = 0;
    }

    // Execute move step by step
    if (this.targetMove && this.thinkTimer >= this.thinkInterval * 0.3) {
      this.executeNextMove();
    }

    // Drop
    if (this.dropTimer >= this.dropInterval) {
      this.dropTimer = 0;
      if (!this.currentPiece.moveDown(this.board)) {
        this.lockPiece();
      } else {
        this.notifyUpdate();
      }
    }
  }

  executeNextMove() {
    if (!this.targetMove || !this.currentPiece) return;
    const { col, rot } = this.targetMove;

    // First rotate
    const currentRot = this.currentPiece.rotIndex;
    const targetRot = rot % PIECE_SHAPES[this.currentPiece.type].length;
    if (currentRot !== targetRot) {
      this.currentPiece.rotate(this.board);
      return;
    }

    // Then move horizontally
    if (this.currentPiece.col < col) {
      this.currentPiece.moveRight(this.board);
    } else if (this.currentPiece.col > col) {
      this.currentPiece.moveLeft(this.board);
    }
  }

  lockPiece() {
    const p = this.currentPiece;
    this.board.place(p.shape, p.row, p.col, p.type);

    const { cleared, specials } = this.board.clearLines();

    if (cleared > 0) {
      this.lines += cleared;
      this.level = Math.floor(this.lines / 10) + 1;
      this.score += calcScore(cleared, this.level);

      // Inject specials into board
      const spCount = specialsForLines(cleared);
      if (spCount > 0) this.board.injectSpecials(spCount);

      // Capture specials from cleared lines
      specials.forEach(sp => {
        if (this.inventory.length < MAX_INVENTORY) {
          this.inventory.push(sp);
          if (this.onSpecialCaptured) this.onSpecialCaptured(this.id, sp);
        }
      });

      // Bot uses specials occasionally
      if (this.difficulty >= 2 && this.inventory.length > 3 && Math.random() < 0.3) {
        this.useSpecial();
      }
    }

    if (this.board.isGameOver()) {
      this.die();
      return;
    }

    this.notifyUpdate();
    this.spawnPiece();
  }

  useSpecial() {
    // Bot picks a random special from inventory and fires at a random enemy
    // This is handled by the main game coordinator
    if (this.onUseSpecial && this.inventory.length > 0) {
      const idx = Math.floor(Math.random() * this.inventory.length);
      const sp = this.inventory.splice(idx, 1)[0];
      this.onUseSpecial(this.id, sp);
    }
  }

  notifyUpdate() {
    if (this.onBoardUpdate) this.onBoardUpdate(this.id, this.board, this.currentPiece);
  }

  // ===== HEURISTIC AI =====
  calcBestMove() {
    if (!this.currentPiece) return null;

    const type = this.currentPiece.type;
    const rotations = PIECE_SHAPES[type];

    // Difficulty 1: random placement
    if (this.difficulty === 1) {
      const rot = Math.floor(Math.random() * rotations.length);
      const shape = rotations[rot];
      const maxCol = COLS - shape[0].length;
      const col = Math.floor(Math.random() * (maxCol + 1));
      return { col, rot };
    }

    let best = null;
    let bestScore = -Infinity;

    for (let rot = 0; rot < rotations.length; rot++) {
      const shape = rotations[rot];
      const maxCol = COLS - shape[0].length;
      for (let col = 0; col <= maxCol; col++) {
        const testBoard = this.board.clone();
        const testPiece = new Piece(type);
        testPiece.rotIndex = rot;
        testPiece.shape = shape;
        testPiece.col = col;
        testPiece.row = 0;

        if (!testBoard.isValid(shape, 0, col)) continue;
        testPiece.hardDrop(testBoard);
        testBoard.place(shape, testPiece.row, col, type);

        const score = this.evaluate(testBoard);
        if (score > bestScore) {
          bestScore = score;
          best = { col, rot };
        }
      }
    }

    return best || { col: this.currentPiece.col, rot: 0 };
  }

  evaluate(board) {
    const grid = board.grid;
    let score = 0;

    // 1. Complete lines (huge positive)
    let lines = 0;
    for (let r = 0; r < ROWS; r++) {
      if (grid[r].every(c => c !== 0)) lines++;
    }
    score += lines * 800;

    // 2. Aggregate height (negative)
    let totalHeight = 0;
    const heights = [];
    for (let c = 0; c < COLS; c++) {
      let h = 0;
      for (let r = 0; r < ROWS; r++) {
        if (grid[r][c] !== 0) { h = ROWS - r; break; }
      }
      heights.push(h);
      totalHeight += h;
    }
    score -= totalHeight * (this.difficulty === 3 ? 0.5 : 0.3);

    // 3. Holes (very negative)
    let holes = 0;
    for (let c = 0; c < COLS; c++) {
      let blockFound = false;
      for (let r = 0; r < ROWS; r++) {
        if (grid[r][c] !== 0) blockFound = true;
        else if (blockFound) holes++;
      }
    }
    score -= holes * (this.difficulty === 3 ? 8 : 5);

    // 4. Bumpiness (negative)
    let bumpiness = 0;
    for (let c = 0; c < COLS - 1; c++) {
      bumpiness += Math.abs(heights[c] - heights[c+1]);
    }
    score -= bumpiness * (this.difficulty === 3 ? 0.4 : 0.2);

    // 5. Max height penalty
    const maxH = Math.max(...heights);
    if (maxH > 15) score -= (maxH - 15) * 20;

    return score;
  }

  // Apply a special from an attacker
  receiveSpecial(special, attackerBoard) {
    switch(special) {
      case 'a': this.board.applyAddLine(); break;
      case 'c': this.board.applyClearLine(); break;
      case 'b': this.board.applyClearSpecials(); break;
      case 'r': this.board.applyRandomClear(); break;
      case 'o': this.board.applyBlockBomb(); break;
      case 'q': this.board.applyBlockquake(); break;
      case 'g': this.board.applyGravity(); break;
      case 's':
        if (attackerBoard) {
          const temp = this.board.grid.map(r=>[...r]);
          this.board.grid = attackerBoard.grid.map(r=>[...r]);
          attackerBoard.grid = temp;
        }
        break;
      case 'n': this.board.applyNuke(); break;
    }
    this.notifyUpdate();
    if (this.board.isGameOver()) this.die();
  }
}
