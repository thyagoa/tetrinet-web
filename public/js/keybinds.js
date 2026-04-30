// ===== KEYBINDS SYSTEM =====
// Manages all game key mappings with localStorage persistence.
// All keys stored as e.code values (e.g. 'KeyQ', 'Space', 'ArrowLeft').

const KEYBIND_DEFAULTS = {
  moveLeft:    'ArrowLeft',
  moveRight:   'ArrowRight',
  rotate:      'ArrowUp',
  softDrop:    'ArrowDown',
  hardDrop:    'Space',
  targetSelf:  'KeyQ',
  targetPrev:  'KeyW',
  targetNext:  'KeyE',
  useBomb:     'ShiftLeft',
  discardBomb: 'ControlLeft',
};

const KEYBIND_LABELS = {
  moveLeft:    'Mover Esquerda',
  moveRight:   'Mover Direita',
  rotate:      'Rotacionar',
  softDrop:    'Queda Rápida',
  hardDrop:    'Drop Instantâneo',
  targetSelf:  'Alvo: EU',
  targetPrev:  'Alvo: Anterior',
  targetNext:  'Alvo: Próximo',
  useBomb:     'Usar Bomba',
  discardBomb: 'Descartar Bomba',
};

const KEYBIND_STORAGE_KEY = 'bricknet_keybinds';

// Migration map: old e.key / legacy values → correct e.code values
const KEYBIND_MIGRATION = {
  'q': 'KeyQ', 'w': 'KeyW', 'e': 'KeyE', 'a': 'KeyA', 's': 'KeyS', 'd': 'KeyD',
  'Q': 'KeyQ', 'W': 'KeyW', 'E': 'KeyE', 'A': 'KeyA', 'S': 'KeyS', 'D': 'KeyD',
  ' ': 'Space',
};

// Apply migration to a single key value
function migrateKey(key) {
  return KEYBIND_MIGRATION[key] || key;
}

// Load keybinds from localStorage, falling back to defaults
function loadKeybinds() {
  try {
    const saved = localStorage.getItem(KEYBIND_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Merge with defaults in case new actions were added, then migrate legacy values
      const merged = { ...KEYBIND_DEFAULTS, ...parsed };
      let needsSave = false;
      for (const action of Object.keys(merged)) {
        const migrated = migrateKey(merged[action]);
        if (migrated !== merged[action]) {
          merged[action] = migrated;
          needsSave = true;
        }
      }
      if (needsSave) {
        try { localStorage.setItem(KEYBIND_STORAGE_KEY, JSON.stringify(merged)); } catch(e) {}
      }
      return merged;
    }
  } catch(e) {}
  return { ...KEYBIND_DEFAULTS };
}

function saveKeybinds(binds) {
  try {
    localStorage.setItem(KEYBIND_STORAGE_KEY, JSON.stringify(binds));
  } catch(e) {}
}

function resetKeybinds() {
  localStorage.removeItem(KEYBIND_STORAGE_KEY);
  return { ...KEYBIND_DEFAULTS };
}

// Pretty-print a key (e.code format) for display
function keyDisplayName(key) {
  const names = {
    'Space':        'ESPAÇO',
    'ArrowLeft':    '← ESQ',
    'ArrowRight':   '→ DIR',
    'ArrowUp':      '↑ CIMA',
    'ArrowDown':    '↓ BAIXO',
    'ShiftLeft':    'SHIFT ESQ',
    'ShiftRight':   'SHIFT DIR',
    'ControlLeft':  'CTRL ESQ',
    'ControlRight': 'CTRL DIR',
    'AltLeft':      'ALT ESQ',
    'AltRight':     'ALT DIR',
    'Enter':        'ENTER',
    'Backspace':    'BACKSPACE',
    'Escape':       'ESC',
    'Tab':          'TAB',
    // Legacy e.key values (fallback for any stored old-format)
    ' ':            'ESPAÇO',
  };
  if (names[key]) return names[key];
  // Handle 'KeyX' → 'X'
  if (/^Key[A-Z]$/.test(key)) return key.slice(3);
  // Handle 'DigitN' → 'N'
  if (/^Digit\d$/.test(key)) return key.slice(5);
  // Handle 'Numpad...'
  if (key.startsWith('Numpad')) return 'NUM ' + key.slice(6);
  // Handle 'F1'–'F12'
  if (/^F\d{1,2}$/.test(key)) return key;
  return key.toUpperCase();
}

// Check if a key string is forbidden (shouldn't be bound)
function isForbiddenKey(key) {
  return ['Escape', 'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12'].includes(key);
}

// Active keybinds (loaded once, shared globally)
const keybinds = loadKeybinds();

// Reverse lookup: e.code → action
function getActionForKey(code) {
  for (const [action, key] of Object.entries(keybinds)) {
    if (key === code) return action;
  }
  return null;
}
