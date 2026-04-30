// ===== CONSTANTS =====
const COLS = 12;
const ROWS = 22;
const CELL = 28; // px per cell on main board
const MINI_CELL = 5; // px per cell on mini boards

const COLORS = {
  I: '#00e5ff', O: '#ffea00', T: '#d500f9',
  L: '#ff6d00', J: '#2979ff', S: '#00e676', Z: '#ff1744',
  sp: '#ffffff', empty: '#000000'
};

const PIECE_SHAPES = {
  I: [[[1],[1],[1],[1]], [[1,1,1,1]]],
  O: [[[1,1],[1,1]]],
  T: [[[1,1,1],[0,1,0]], [[1,0],[1,1],[1,0]], [[0,1,0],[1,1,1]], [[0,1],[1,1],[0,1]]],
  L: [[[1,0],[1,0],[1,1]], [[1,1,1],[1,0,0]], [[1,1],[0,1],[0,1]], [[0,0,1],[1,1,1]]],
  J: [[[0,1],[0,1],[1,1]], [[1,0,0],[1,1,1]], [[1,1],[1,0],[1,0]], [[1,1,1],[0,0,1]]],
  S: [[[0,1,1],[1,1,0]], [[1,0],[1,1],[0,1]]],
  Z: [[[1,1,0],[0,1,1]], [[0,1],[1,1],[1,0]]]
};

const PIECES_LIST = ['I','O','T','L','J','S','Z'];
const SPECIALS_LIST = ['a','c','b','r','o','q','g','s','n'];
const SPECIAL_WEIGHTS = [18,12,10,10,8,8,8,6,5];
const SPECIAL_NAMES = {
  a:'Add Line', c:'Clear Line', b:'Clear Specials',
  r:'Random Clear', o:'Block Bomb', q:'Blockquake',
  g:'Gravity', s:'Switch Fields', n:'Nuke Field'
};

// How many specials can a player hold
const MAX_INVENTORY = 18;

// Piece spawn column
function spawnCol(type, rotation) {
  const shape = PIECE_SHAPES[type][rotation % PIECE_SHAPES[type].length];
  return Math.floor((COLS - shape[0].length) / 2);
}

// ===== BOARD CLASS =====
class Board {
  constructor() {
    // Each cell: 0 = empty, string = piece type or 'sp:X' for special
    this.grid = this.createEmpty();
  }

  createEmpty() {
    return Array.from({length: ROWS}, () => Array(COLS).fill(0));
  }

  clone() {
    const b = new Board();
    b.grid = this.grid.map(r => [...r]);
    return b;
  }

  isValid(shape, r, c) {
    for (let row = 0; row < shape.length; row++) {
      for (let col = 0; col < shape[row].length; col++) {
        if (!shape[row][col]) continue;
        const nr = r + row, nc = c + col;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return false;
        if (this.grid[nr][nc] !== 0) return false;
      }
    }
    return true;
  }

  place(shape, r, c, type) {
    for (let row = 0; row < shape.length; row++) {
      for (let col = 0; col < shape[row].length; col++) {
        if (!shape[row][col]) continue;
        this.grid[r + row][c + col] = type;
      }
    }
  }

  // Returns cleared line count and array of specials captured
  clearLines() {
    const specials = [];
    let cleared = 0;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.grid[r].every(c => c !== 0)) {
        // Collect specials from this line
        this.grid[r].forEach(cell => {
          if (typeof cell === 'string' && cell.startsWith('sp:')) {
            specials.push(cell.slice(3));
          }
        });
        this.grid.splice(r, 1);
        this.grid.unshift(Array(COLS).fill(0));
        cleared++;
        r++; // recheck same index
      }
    }
    return { cleared, specials };
  }

  // Place specials randomly in existing blocks after clearing
  injectSpecials(count) {
    // find all filled cells
    const filled = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (this.grid[r][c] !== 0 && !(typeof this.grid[r][c] === 'string' && this.grid[r][c].startsWith('sp:')))
          filled.push([r,c]);
    // pick random cells and add special marker
    for (let i = 0; i < count && filled.length > 0; i++) {
      const idx = Math.floor(Math.random() * filled.length);
      const [r,c] = filled.splice(idx, 1)[0];
      const sp = randomSpecial();
      this.grid[r][c] = 'sp:' + sp;
    }
  }

  isGameOver() {
    return this.grid[0].some(c => c !== 0) || this.grid[1].some(c => c !== 0);
  }

  // ===== SPECIAL EFFECTS =====

  applyAddLine() {
    // Remove top row, add garbage at bottom
    this.grid.shift();
    const garbage = Array(COLS).fill('G');
    // leave one hole
    garbage[Math.floor(Math.random() * COLS)] = 0;
    this.grid.push(garbage);
  }

  applyClearLine() {
    // Find lowest non-empty row and remove it
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.grid[r].some(c => c !== 0)) {
        this.grid.splice(r, 1);
        this.grid.unshift(Array(COLS).fill(0));
        return;
      }
    }
  }

  applyClearSpecials() {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (typeof this.grid[r][c] === 'string' && this.grid[r][c].startsWith('sp:'))
          this.grid[r][c] = 'G'; // becomes normal block
  }

  applyRandomClear() {
    const filled = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (this.grid[r][c] !== 0) filled.push([r,c]);
    const count = Math.floor(filled.length * 0.2) + 5;
    for (let i = 0; i < count && filled.length > 0; i++) {
      const idx = Math.floor(Math.random() * filled.length);
      const [r,c] = filled.splice(idx,1)[0];
      this.grid[r][c] = 0;
    }
  }

  applyBlockBomb() {
    // Find all O-piece cells and explode 3x3 around them
    const toExplode = new Set();
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (this.grid[r][c] === 'O' || this.grid[r][c] === 'G')
          for (let dr = -1; dr <= 1; dr++)
            for (let dc = -1; dc <= 1; dc++) {
              const nr = r+dr, nc = c+dc;
              if (nr>=0 && nr<ROWS && nc>=0 && nc<COLS)
                toExplode.add(nr*COLS+nc);
            }
    toExplode.forEach(idx => {
      this.grid[Math.floor(idx/COLS)][idx%COLS] = 0;
    });
  }

  applyBlockquake() {
    // Find the topmost row that has any block
    let topRow = ROWS - 1;
    for (let r = 0; r < ROWS; r++) {
      if (this.grid[r].some(c => c !== 0)) { topRow = r; break; }
    }

    // Extract all rows in the active zone (topRow..ROWS-1)
    const activeRows = [];
    for (let r = topRow; r < ROWS; r++) {
      activeRows.push([...this.grid[r]]);
    }

    // Shuffle the rows themselves (like original BrickNet)
    for (let i = activeRows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [activeRows[i], activeRows[j]] = [activeRows[j], activeRows[i]];
    }

    // Within each row, also shuffle individual cells for extra chaos
    activeRows.forEach(row => {
      for (let i = row.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [row[i], row[j]] = [row[j], row[i]];
      }
    });

    // Write shuffled rows back — rows above topRow stay empty
    for (let r = topRow; r < ROWS; r++) {
      this.grid[r] = activeRows[r - topRow];
    }
  }

  applyGravity() {
    // Each column: move all blocks down
    for (let c = 0; c < COLS; c++) {
      const col = [];
      for (let r = 0; r < ROWS; r++)
        if (this.grid[r][c] !== 0) col.push(this.grid[r][c]);
      for (let r = 0; r < ROWS; r++)
        this.grid[r][c] = r < ROWS - col.length ? 0 : col[r - (ROWS - col.length)];
    }
  }

  applyNuke() {
    this.grid = this.createEmpty();
  }
}

// ===== PIECE CLASS =====
class Piece {
  constructor(type) {
    this.type = type;
    this.rotIndex = 0;
    this.shape = PIECE_SHAPES[type][0];
    this.col = spawnCol(type, 0);
    this.row = 0;
  }

  rotate(board) {
    const rotations = PIECE_SHAPES[this.type];
    const nextRot = (this.rotIndex + 1) % rotations.length;
    const nextShape = rotations[nextRot];
    if (board.isValid(nextShape, this.row, this.col)) {
      this.rotIndex = nextRot;
      this.shape = nextShape;
      return true;
    }
    // wall kick: try offsets
    for (const offset of [-1, 1, -2, 2]) {
      if (board.isValid(nextShape, this.row, this.col + offset)) {
        this.rotIndex = nextRot;
        this.shape = nextShape;
        this.col += offset;
        return true;
      }
    }
    return false;
  }

  moveLeft(board) {
    if (board.isValid(this.shape, this.row, this.col - 1)) { this.col--; return true; }
    return false;
  }

  moveRight(board) {
    if (board.isValid(this.shape, this.row, this.col + 1)) { this.col++; return true; }
    return false;
  }

  moveDown(board) {
    if (board.isValid(this.shape, this.row + 1, this.col)) { this.row++; return true; }
    return false;
  }

  hardDrop(board) {
    while (this.moveDown(board)) {}
  }

  ghostRow(board) {
    let gr = this.row;
    while (board.isValid(this.shape, gr + 1, this.col)) gr++;
    return gr;
  }
}

// ===== HELPERS =====
function randomSpecial() {
  const total = SPECIAL_WEIGHTS.reduce((a,b)=>a+b,0);
  let r = Math.random()*total;
  for(let i=0;i<SPECIALS_LIST.length;i++){
    r -= SPECIAL_WEIGHTS[i];
    if(r<=0) return SPECIALS_LIST[i];
  }
  return SPECIALS_LIST[SPECIALS_LIST.length-1];
}

function randomPiece() {
  return PIECES_LIST[Math.floor(Math.random()*PIECES_LIST.length)];
}

function generateSequence(n=500) {
  return Array.from({length:n}, randomPiece);
}

// Score for lines cleared
function calcScore(lines, level) {
  const base = [0,100,300,500,800];
  return (base[Math.min(lines,4)] || 800) * level;
}

// Specials per lines cleared (BrickNet style)
function specialsForLines(lines) {
  if (lines >= 4) return 4;
  if (lines === 3) return 3;
  if (lines === 2) return 2;
  if (lines === 1) return 1;
  return 0;
}

// Determine teams based on mode
function buildTeams(players, mode) {
  // players: array of player objects with .id
  // returns map: playerId -> teamIndex
  const teams = {};
  if (mode === 'ffa') {
    players.forEach((p,i) => teams[p.id] = i);
  } else if (mode === '1v1') {
    players.forEach((p,i) => teams[p.id] = i % 2);
  } else if (mode === '2v2') {
    players.forEach((p,i) => teams[p.id] = i % 2);
  } else if (mode === '3v3') {
    players.forEach((p,i) => teams[p.id] = i % 2);
  } else if (mode === '2v2v2') {
    players.forEach((p,i) => teams[p.id] = i % 3);
  }
  return teams;
}

// Check if game is over for team-based modes
function checkTeamWinner(players, teams, mode) {
  if (mode === 'ffa') {
    const alive = players.filter(p=>p.alive);
    if (alive.length <= 1) return alive[0] || null;
    return false;
  }
  // Find alive teams
  const aliveTeams = new Set(players.filter(p=>p.alive).map(p=>teams[p.id]));
  if (aliveTeams.size <= 1) {
    const winTeam = [...aliveTeams][0];
    return players.filter(p=>teams[p.id]===winTeam && p.alive);
  }
  return false;
}

// Export for use in other modules
if (typeof module !== 'undefined') {
  module.exports = { Board, Piece, COLORS, PIECE_SHAPES, COLS, ROWS, CELL, MINI_CELL,
    SPECIALS_LIST, SPECIAL_NAMES, PIECES_LIST, MAX_INVENTORY,
    randomSpecial, randomPiece, generateSequence, calcScore,
    specialsForLines, buildTeams, checkTeamWinner };
}
