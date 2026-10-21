/* =========================================================
 * Macropad Simulator - app.js
 *
 * How this file is organised (top to bottom):
 *   1. Constants           - sizes, action lists, keyboard shortcuts
 *   2. State               - the single object that holds everything
 *   3. Saving / loading    - localStorage persistence
 *   4. Rendering           - turning state into DOM elements
 *   5. Key handling        - press / release, layer switching
 *   6. Knob handling       - dragging, mouse wheel, arrow keys
 *   7. Action handlers     - what a key / knob does (send to device)
 *   8. Device link         - Web Serial connection to real hardware
 *   9. Config modal        - the settings editor
 *  10. Tablet helpers      - fullscreen and keep-screen-awake
 *  11. Start-up            - wiring up event listeners
 *
 * The design rule: change `state` first, then call a render function.
 * The screen is always a picture of the state, never the other way round.
 *
 * The hardware protocol (what we send to the device and what it may
 * send back) is documented in PROTOCOL.md.
 * ========================================================= */
'use strict';

/* =========================================================
 * 1. CONSTANTS
 * ========================================================= */

const STORAGE_KEY = 'macropad-state-v1'; // localStorage key; bump the suffix if the saved format changes
const NUM_LAYERS = 4;                    // how many layers exist
const KEYS_PER_LAYER = 12;               // custom keys on each layer (3 x 4 grid)
const PX_PER_TICK = 6;                   // dragging a knob this many pixels = one "click" of the knob
const KNOB_MIN_ANGLE = -135;             // knob pointer angle at its minimum value (degrees)
const KNOB_MAX_ANGLE = 135;              // ...and at its maximum value

// --- Device link constants ---
const BAUD_RATES = [9600, 57600, 115200, 230400, 460800, 921600];
const MACRO_STEP_GAP_MS = 20;            // pause between macro steps so a small MCU is not flooded
const MACRO_MAX_WAIT_MS = 5000;          // longest "wait:N" we will honour in a macro
const MAX_RX_LINE = 1024;                // drop the receive buffer if a "line" gets longer than this
const MAX_KNOB_TICKS_PER_EVENT = 50;     // sanity limit for KNOBTURN events coming from the device

// Every action a custom key can perform. `hint` is placeholder text in the config form.
const KEY_ACTIONS = [
  { id: 'none',     label: 'None',         hint: '' },
  { id: 'keypress', label: 'Key press',    hint: 'e.g. Enter, F5, a' },
  { id: 'text',     label: 'Type text',    hint: 'text to type' },
  { id: 'shortcut', label: 'Shortcut',     hint: 'e.g. Ctrl+C' },
  { id: 'media',    label: 'Media',        hint: 'play, next, prev, stop, mute, volup, voldown' },
  { id: 'mouse',    label: 'Mouse',        hint: 'left, right, middle, scrollup, scrolldown' },
  { id: 'layer',    label: 'Switch layer', hint: 'layer number 1-4' },
  { id: 'macro',    label: 'Macro',        hint: 'steps split by commas: Ctrl+C, wait:100, Ctrl+V' },
];

// Every action a knob can perform when turned.
const KNOB_ACTIONS = [
  { id: 'none',       label: 'None' },
  { id: 'volume',     label: 'Volume' },
  { id: 'brightness', label: 'Brightness' },
  { id: 'scroll',     label: 'Scroll' },
  { id: 'zoom',       label: 'Zoom' },
  { id: 'custom',     label: 'Custom' },
];

// Knob modes:
//   range   - value stops at min and max (like a volume dial)
//   endless - value wraps around from max back to min (like a hue wheel)
const KNOB_MODES = [
  { id: 'range',   label: 'Range (stops at ends)' },
  { id: 'endless', label: 'Endless (wraps around)' },
];

// Which computer-keyboard key triggers which pad key. Handy on desktop!
const KEYBOARD_MAP = {
  custom: ['1', '2', '3', 'q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'c'],
  layer:  ['7', '8', '9', '0'],
};

/* =========================================================
 * 2. STATE
 * ========================================================= */

// Small helper so the defaults below stay readable.
function k(label, subtext, action, value) {
  return { label, subtext, action, value };
}

// Builds a brand-new default configuration. Used on first run and by "Reset to defaults".
function makeDefaultState() {
  return {
    currentLayer: 0,

    // layers[layerIndex][keyIndex] -> { label, subtext, action, value }
    layers: [
      // Layer 1: editing shortcuts
      [
        k('Copy', 'Ctrl+C', 'shortcut', 'Ctrl+C'),
        k('Paste', 'Ctrl+V', 'shortcut', 'Ctrl+V'),
        k('Cut', 'Ctrl+X', 'shortcut', 'Ctrl+X'),
        k('Undo', 'Ctrl+Z', 'shortcut', 'Ctrl+Z'),
        k('Redo', 'Ctrl+Y', 'shortcut', 'Ctrl+Y'),
        k('Save', 'Ctrl+S', 'shortcut', 'Ctrl+S'),
        k('Find', 'Ctrl+F', 'shortcut', 'Ctrl+F'),
        k('Select', 'Ctrl+A', 'shortcut', 'Ctrl+A'),
        k('New tab', 'Ctrl+T', 'shortcut', 'Ctrl+T'),
        k('Close', 'Ctrl+W', 'shortcut', 'Ctrl+W'),
        k('Reload', 'F5', 'keypress', 'F5'),
        k('Shot', 'PrtSc', 'keypress', 'PrintScreen'),
      ],
      // Layer 2: media control
      [
        k('Play', 'play/pause', 'media', 'play'),
        k('Prev', 'track', 'media', 'prev'),
        k('Next', 'track', 'media', 'next'),
        k('Stop', '', 'media', 'stop'),
        k('Mute', '', 'media', 'mute'),
        k('Vol +', '', 'media', 'volup'),
        k('Vol -', '', 'media', 'voldown'),
        k('Click', 'left', 'mouse', 'left'),
        k('Right', 'click', 'mouse', 'right'),
        k('Mid', 'click', 'mouse', 'middle'),
        k('Up', 'scroll', 'mouse', 'scrollup'),
        k('Down', 'scroll', 'mouse', 'scrolldown'),
      ],
      // Layer 3: text snippets
      [
        k('Hello', 'greeting', 'text', 'Hello,'),
        k('Thanks', 'sign-off', 'text', 'Thanks and regards,'),
        k('Email', 'address', 'text', 'name@example.com'),
        k('TODO', 'comment', 'text', '// TODO: '),
        k('printf', 'C snippet', 'text', 'printf("\\n");'),
        k('main()', 'C snippet', 'text', 'int main(void) {\n    return 0;\n}'),
        k('Enter', '', 'keypress', 'Enter'),
        k('Esc', '', 'keypress', 'Escape'),
        k('Tab', '', 'keypress', 'Tab'),
        k('Lock', 'Win+L', 'shortcut', 'Win+L'),
        k('Desktop', 'Win+D', 'shortcut', 'Win+D'),
        k('Task Mgr', 'Ctrl+Shift+Esc', 'shortcut', 'Ctrl+Shift+Esc'),
      ],
      // Layer 4: macros and spare keys
      [
        k('Dup line', 'macro', 'macro', 'Home, Shift+End, Ctrl+C, End, Enter, Ctrl+V'),
        k('Sel word', 'macro', 'macro', 'Ctrl+Left, Ctrl+Shift+Right'),
        k('Save all', 'macro', 'macro', 'Ctrl+S, wait:200, Ctrl+Shift+S'),
        k('To L1', 'layer', 'layer', '1'),
        k('To L2', 'layer', 'layer', '2'),
        k('To L3', 'layer', 'layer', '3'),
        k('Key 7', '', 'none', ''), k('Key 8', '', 'none', ''), k('Key 9', '', 'none', ''),
        k('Key 10', '', 'none', ''), k('Key 11', '', 'none', ''), k('Key 12', '', 'none', ''),
      ],
    ],

    // layerKeys[i] -> which layer (0-based) that key jumps to
    layerKeys: [
      { label: 'L1', target: 0 },
      { label: 'L2', target: 1 },
      { label: 'L3', target: 2 },
      { label: 'L4', target: 3 },
    ],

    // Each layer owns an independent copy of both dial configurations.
    // `knobs` is the active layer's dial pair; `layerKnobs` stores all four layers.
    knobs: [
      { label: 'Volume', value: 50, min: 0, max: 100, step: 1, mode: 'range', action: 'volume', valueParam: '' },
      { label: 'Zoom', value: 100, min: 50, max: 200, step: 5, mode: 'range', action: 'zoom', valueParam: '' },
    ],
    layerKnobs: Array.from({ length: NUM_LAYERS }, () => [
      { label: 'Volume', value: 50, min: 0, max: 100, step: 1, mode: 'range', action: 'volume', valueParam: '' },
      { label: 'Zoom', value: 100, min: 50, max: 200, step: 5, mode: 'range', action: 'zoom', valueParam: '' },
    ]),

    // Settings for the hardware link (the connection itself is NOT saved, only these settings)
    device: {
      baud: 115200,        // serial speed; must match the firmware
      send: true,          // send key/knob actions to the device
      receive: true,       // accept key/knob events coming from the device
      autoConnect: true,   // reconnect automatically to a device we were already allowed to use
    },

    // ----- Runtime-only fields (NOT saved to localStorage) -----
    pressedKeys: new Set(),  // ids of keys currently held down, e.g. 'c3' (custom key 3) or 'l1' (layer key 1)
    pointerKeys: new Map(),  // pointerId -> key id, so several fingers can hold several keys at once
    knobDrags: new Map(),    // pointerId -> { index, lastX, lastY, accum }, so two knobs can turn at once
  };
}

const state = makeDefaultState();

// Config-modal UI state (which tab and which layer are being edited)
const config = { tab: 'keys', layer: 0 };


// References to the knob DOM elements so we can update them quickly while dragging
const knobEls = [];

// The live serial connection (all null/empty while disconnected)
const device = {
  port: null,        // the SerialPort object
  reader: null,      // stream reader for bytes coming from the device
  writer: null,      // stream writer for bytes going to the device
  rxBuffer: '',      // incoming text that has not formed a full line yet
  txChain: Promise.resolve(), // writes are chained so lines never interleave
};

/* =========================================================
 * Small helpers
 * ========================================================= */

const $ = (selector) => document.querySelector(selector);

// Keeps a number between lo and hi.
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Rounds away tiny floating-point noise (0.1 + 0.2 = 0.30000000000000004).
const tidy = (n) => Math.round(n * 10000) / 10000;

// Resolves after `ms` milliseconds (used for macro delays).
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Makes text safe to put inside HTML (so a key labelled "<b>" can't break the page).
function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* =========================================================
 * 3. SAVING / LOADING
 * ========================================================= */

// Saves only the settings (not the runtime-only fields) to the browser.
function saveState() {
  try {
    const data = {
      currentLayer: state.currentLayer,
      layers: state.layers,
      layerKeys: state.layerKeys,
      knobs: state.knobs,
      layerKnobs: state.layerKnobs.map((pair, i) =>
        i === state.currentLayer ? state.knobs : pair
      ),
      device: state.device,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('[macropad] could not save state:', err); // e.g. private mode or storage full
  }
}

// Loads saved settings and merges them on top of the defaults.
// Merging (instead of replacing) means missing or damaged fields fall back to defaults.
function loadState() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (err) {
    return; // corrupt JSON -> keep defaults
  }
  if (!saved || typeof saved !== 'object') return;

  const defaults = makeDefaultState();

  if (Number.isInteger(saved.currentLayer) && saved.currentLayer >= 0 && saved.currentLayer < NUM_LAYERS) {
    state.currentLayer = saved.currentLayer;
  }

  if (Array.isArray(saved.layers)) {
    state.layers = defaults.layers.map((layer, li) =>
      layer.map((key, ki) => Object.assign({}, key, saved.layers[li] && saved.layers[li][ki]))
    );
  }

  if (Array.isArray(saved.layerKeys)) {
    state.layerKeys = defaults.layerKeys.map((lk, i) => {
      const merged = Object.assign({}, lk, saved.layerKeys[i]);
      merged.target = clamp(Number(merged.target) || 0, 0, NUM_LAYERS - 1);
      return merged;
    });
  }

  const mergeKnobPair = (savedPair, defaultsPair) => defaultsPair.map((kn, i) => {
    const merged = Object.assign({}, kn, savedPair && savedPair[i]);
    ['value', 'min', 'max', 'step'].forEach((f) => {
      merged[f] = Number.isFinite(Number(merged[f])) ? Number(merged[f]) : kn[f];
    });
    if (merged.max > merged.min) merged.value = clamp(merged.value, merged.min, merged.max);
    return merged;
  });

  if (Array.isArray(saved.layerKnobs)) {
    state.layerKnobs = defaults.layerKnobs.map((pair, li) =>
      mergeKnobPair(saved.layerKnobs[li], pair)
    );
  } else if (Array.isArray(saved.knobs)) {
    // Migrate older configurations by copying their existing dial settings to every layer.
    const oldPair = mergeKnobPair(saved.knobs, defaults.knobs);
    state.layerKnobs = defaults.layerKnobs.map(() => oldPair.map(kn => ({ ...kn })));
  }

  state.knobs = state.layerKnobs[state.currentLayer].map(kn => ({ ...kn }));

  if (saved.device && typeof saved.device === 'object') {
    const d = saved.device;
    state.device = {
      baud: BAUD_RATES.includes(Number(d.baud)) ? Number(d.baud) : defaults.device.baud,
      // anything other than an explicit `false` keeps the default of "on"
      send: d.send !== false,
      receive: d.receive !== false,
      autoConnect: d.autoConnect !== false,
    };
  }
}

/* =========================================================
 * 4. RENDERING
 * ========================================================= */

// Rebuilds the 12 custom keys for the current layer.
function renderCustomKeys() {
  const grid = $('#custom-keys');
  grid.innerHTML = '';

  state.layers[state.currentLayer].forEach((key, i) => {
    const id = 'c' + i;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'key' + (key.action === 'none' ? ' key-empty' : '');
    btn.dataset.keyId = id; // lets event handlers know which key was touched
    btn.innerHTML =
      `<span class="key-label">${esc(key.label)}</span>` +
      `<span class="key-sub">${esc(key.subtext)}</span>` +
      `<kbd class="key-hint">${esc(KEYBOARD_MAP.custom[i].toUpperCase())}</kbd>`;
    if (state.pressedKeys.has(id)) btn.classList.add('pressed');
    grid.appendChild(btn);
  });
}

// Rebuilds the 4 layer keys, lighting up the one for the active layer.
function renderLayerKeys() {
  const row = $('#layer-keys');
  row.innerHTML = '';

  state.layerKeys.forEach((lk, i) => {
    const id = 'l' + i;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'key' + (lk.target === state.currentLayer ? ' active-layer' : '');
    btn.dataset.keyId = id;
    btn.innerHTML =
      `<span class="key-label">${esc(lk.label)}</span>` +
      `<kbd class="key-hint">${esc(KEYBOARD_MAP.layer[i])}</kbd>`;
    if (state.pressedKeys.has(id)) btn.classList.add('pressed');
    row.appendChild(btn);
  });
}

// Builds both knobs. The numbers and angle are filled in by updateKnobVisual().
function renderKnobs() {
  const wrap = $('#knobs');
  wrap.innerHTML = '';
  knobEls.length = 0;

  state.knobs.forEach((kn, i) => {
    const item = document.createElement('div');
    item.className = 'knob-item';
    item.innerHTML =
      `<div class="knob-label">${esc(kn.label)}</div>` +
      `<div class="knob-dial" data-knob="${i}" tabindex="0" role="slider" aria-label="${esc(kn.label)}">` +
        `<div class="knob-cap"></div>` +
      `</div>` +
      `<div class="knob-value"></div>`;
    wrap.appendChild(item);

    knobEls[i] = {
      dial: item.querySelector('.knob-dial'),
      value: item.querySelector('.knob-value'),
    };
    updateKnobVisual(i);
  });
}

// Updates just one knob's pointer angle + number (cheap, so we can do it on every drag move).
function updateKnobVisual(i) {
  const kn = state.knobs[i];
  const els = knobEls[i];
  if (!els) return;

  const span = kn.max - kn.min;
  const fraction = span > 0 ? clamp((kn.value - kn.min) / span, 0, 1) : 0;
  const angle = KNOB_MIN_ANGLE + fraction * (KNOB_MAX_ANGLE - KNOB_MIN_ANGLE);

  els.dial.style.setProperty('--angle', angle + 'deg');
  els.value.textContent = tidy(kn.value);
  els.dial.setAttribute('aria-valuemin', kn.min);
  els.dial.setAttribute('aria-valuemax', kn.max);
  els.dial.setAttribute('aria-valuenow', kn.value);
}

// Updates the "Layer N" badge and the accent colour (CSS reads body[data-layer]).
function renderLayerIndicator() {
  $('#layer-indicator').textContent = 'Layer ' + (state.currentLayer + 1);
  document.body.dataset.layer = state.currentLayer;
}

// Updates the device pill and the Connect/Disconnect button to match the connection.
function updateDeviceUI() {
  const connected = !!device.port;
  $('#device-status').classList.toggle('connected', connected);
  $('#device-status-text').textContent = connected ? `Device @ ${state.device.baud}` : 'No device';

  const btn = $('#connect-btn');
  btn.textContent = connected ? 'Disconnect' : 'Connect';
  // Web Serial only exists in Chromium browsers; grey the button out elsewhere
  btn.disabled = !serialSupported();
  btn.title = serialSupported()
    ? ''
    : 'Web Serial is not available in this browser (use Chrome or Edge, over https or localhost)';
}

// Redraws everything. Used at start-up and after config changes.
function renderAll() {
  renderLayerIndicator();
  renderCustomKeys();
  renderLayerKeys();
  renderKnobs();
  updateDeviceUI();
}

// Intentionally silent: the interface has no activity log or console event stream.
function logAction(_message) {}

/* =========================================================
 * 5. KEY HANDLING
 * ========================================================= */

// Looks up the key object for an id like 'c3' or 'l1'.
function getKeyById(id) {
  const index = Number(id.slice(1));
  return id[0] === 'c' ? state.layers[state.currentLayer][index] : state.layerKeys[index];
}

// Adds / removes the "pressed" look on a key's element.
function setPressedVisual(id, isPressed) {
  const el = document.querySelector(`[data-key-id="${id}"]`);
  if (el) el.classList.toggle('pressed', isPressed);
}

// A key goes down: show it pressed, then run its action.
function handleKeyDown(id) {
  if (state.pressedKeys.has(id)) return; // ignore auto-repeat from a held computer key
  state.pressedKeys.add(id);
  setPressedVisual(id, true);

  if (id[0] === 'c') executeKeyAction(getKeyById(id));
  else executeLayerKey(getKeyById(id));
}

// A key comes back up: remove the pressed look.
function handleKeyUp(id) {
  state.pressedKeys.delete(id);
  setPressedVisual(id, false);
}

// Changes the active layer and redraws the keys.
// `opts.fromDevice` is true when the DEVICE asked for the change, so we don't echo it straight back.
function switchLayer(index, opts = {}) {
  if (!Number.isInteger(index) || index < 0 || index >= NUM_LAYERS) return;
  // Save the outgoing layer's dial state and restore the destination layer's pair.
  state.layerKnobs[state.currentLayer] = state.knobs.map(kn => ({ ...kn }));
  state.currentLayer = index;
  state.knobs = state.layerKnobs[index].map(kn => ({ ...kn }));
  state.pressedKeys.clear(); // the old buttons are about to be replaced, so forget their pressed state
  renderLayerIndicator();
  renderCustomKeys();
  renderLayerKeys();
  renderKnobs();
  saveState();
  logAction(`Layer -> ${index + 1}`);
  if (!opts.fromDevice) sendAction(`LAYER ${index}`); // keeps device LEDs/screens in sync
}

/* =========================================================
 * 6. KNOB HANDLING
 * ========================================================= */

// Turns knob `i` by `ticks` clicks (positive = clockwise/up, negative = the other way).
function changeKnob(i, ticks) {
  const kn = state.knobs[i];
  const step = kn.step > 0 ? kn.step : 1;  // protect against a zero/negative step
  const span = kn.max - kn.min;
  if (!(span > 0)) return;                 // nonsense range -> do nothing

  const before = kn.value;
  let next = before + ticks * step;

  if (kn.mode === 'endless') {
    // Wrap around: going past max lands back at min (and vice versa)
    next = ((next - kn.min) % span + span) % span + kn.min;
  } else {
    next = clamp(next, kn.min, kn.max);
  }
  next = tidy(next);
  if (next === before) return;             // already at the end of the range

  kn.value = next;
  updateKnobVisual(i);
  executeKnobAction(i, ticks * step, next);
}

// A finger/mouse goes down on a knob: start tracking THAT pointer's drag.
// Using one entry per pointerId means two fingers can turn two knobs at the same time.
function startKnobDrag(e) {
  const dial = e.target.closest('.knob-dial');
  if (!dial) return;
  e.preventDefault();
  const index = Number(dial.dataset.knob);
  state.knobDrags.set(e.pointerId, { index, lastX: e.clientX, lastY: e.clientY, accum: 0 });
  dial.classList.add('rotating');
  dial.focus();
}

// A pointer moves: if it is dragging a knob, turn it. Up or right = clockwise.
function handleKnobDrag(e) {
  const drag = state.knobDrags.get(e.pointerId);
  if (!drag) return;

  // How far did we move since the last event? (up = positive, right = positive)
  const delta = (drag.lastY - e.clientY) + (e.clientX - drag.lastX);
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;

  // Collect movement until it adds up to a whole "click", keep the remainder.
  drag.accum += delta;
  const ticks = Math.trunc(drag.accum / PX_PER_TICK);
  if (ticks !== 0) {
    drag.accum -= ticks * PX_PER_TICK;
    changeKnob(drag.index, ticks);
  }
}

// A pointer is released: stop its knob drag (if any) and save the new value.
function endKnobDrag(e) {
  const drag = state.knobDrags.get(e.pointerId);
  if (!drag) return;
  const el = knobEls[drag.index];
  if (el) el.dial.classList.remove('rotating');
  state.knobDrags.delete(e.pointerId);
  saveState();
}

// Mouse wheel over a knob turns it too.
function handleKnobWheel(e) {
  const dial = e.target.closest('.knob-dial');
  if (!dial) return;
  e.preventDefault(); // don't scroll the page
  changeKnob(Number(dial.dataset.knob), e.deltaY < 0 ? 1 : -1);
  saveState();
}

// Arrow keys turn a focused knob (accessibility).
function handleKnobKey(e) {
  const dial = e.target.closest && e.target.closest('.knob-dial');
  if (!dial) return false;
  const ticks = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
  if (!ticks) return false;
  e.preventDefault();
  changeKnob(Number(dial.dataset.knob), ticks);
  saveState();
  return true;
}

/* =========================================================
 * 7. ACTION HANDLERS
 *
 * Each action does two things:
 *   - logs what happened (so you can see it on screen), and
 *   - sends a command line to the connected device, if there is one.
 * A web page cannot press real keys on the computer by itself, so
 * the real key presses are the DEVICE's job (it acts as a USB
 * keyboard/mouse). See PROTOCOL.md for the command format.
 * ========================================================= */

function executeKeyAction(key) {
  const v = String(key.value);

  switch (key.action) {
    case 'none':
      return;
    case 'keypress':
      logAction(`Key press: ${v}`);
      sendAction(`KEY ${escapeField(v)}`);
      break;
    case 'text':
      logAction(`Type text: ${JSON.stringify(v)}`);
      sendAction(`TEXT ${escapeField(v)}`);
      break;
    case 'shortcut':
      logAction(`Shortcut: ${v}`);
      sendAction(`SC ${escapeField(v)}`);
      break;
    case 'media':
      logAction(`Media: ${v}`);
      sendAction(`MEDIA ${escapeField(v)}`);
      break;
    case 'mouse':
      logAction(`Mouse: ${v}`);
      sendAction(`MOUSE ${escapeField(v)}`);
      break;
    case 'layer': {
      // The value is a 1-based layer number typed by the user.
      // switchLayer() itself tells the device (LAYER n), so nothing extra to send here.
      const target = parseInt(v, 10) - 1;
      if (Number.isInteger(target) && target >= 0 && target < NUM_LAYERS) switchLayer(target);
      else logAction(`Layer action has an invalid value: "${v}"`);
      break;
    }
    case 'macro': {
      // A macro is a comma-separated list of steps run one after another
      const steps = v.split(',').map((s) => s.trim()).filter(Boolean);
      logAction(`Macro (${steps.length} steps): ${steps.join(' > ')}`);
      sendMacro(steps);
      break;
    }
    default:
      logAction(`Unknown key action: ${key.action}`);
  }
}

// Layer keys always just jump to their target layer.
function executeLayerKey(layerKey) {
  switchLayer(layerKey.target);
}

// `delta` is how much the value changed this turn, `value` is the new value.
function executeKnobAction(index, delta, value) {
  const kn = state.knobs[index];
  const sign = delta > 0 ? '+' : '';

  switch (kn.action) {
    case 'none':
      return;
    case 'volume':
      logAction(`Volume ${sign}${tidy(delta)} -> ${value}`);
      break;
    case 'brightness':
      logAction(`Brightness ${sign}${tidy(delta)} -> ${value}`);
      break;
    case 'scroll':
      logAction(`Scroll ${kn.valueParam || 'vertical'} ${sign}${tidy(delta)}`);
      break;
    case 'zoom':
      logAction(`Zoom ${sign}${tidy(delta)} -> ${value}%`);
      break;
    case 'custom':
      logAction(`Custom "${kn.valueParam || 'unnamed'}" ${sign}${tidy(delta)} -> ${value}`);
      break;
    default:
      logAction(`Unknown knob action: ${kn.action}`);
      return;
  }

  // Format: KNOB <index> <action> <delta> <value> <param>
  // The parameter is last because it may contain spaces (it is "the rest of the line").
  sendAction(`KNOB ${index} ${kn.action} ${tidy(delta)} ${value} ${escapeField(kn.valueParam)}`.trimEnd());
}

// Runs a macro on the device: each step becomes one command, with host-side pauses for "wait:N".
async function sendMacro(steps) {
  if (!deviceReady()) return;              // nothing to do without a device
  for (const step of steps) {
    const wait = /^wait:(\d+)$/i.exec(step);
    if (wait) {
      await sleep(Math.min(Number(wait[1]), MACRO_MAX_WAIT_MS));
      continue;
    }
    // "Ctrl+C" has a + in the middle, so it is a combo; "Enter" or "+" alone is a single key
    const isCombo = step.length > 1 && step.includes('+');
    sendAction(`${isCombo ? 'SC' : 'KEY'} ${escapeField(step)}`);
    await sleep(MACRO_STEP_GAP_MS);
  }
}

/* =========================================================
 * 8. DEVICE LINK (Web Serial)
 *
 * Talks to a microcontroller over a serial port using simple text
 * lines (one command per line, "\n" terminated). The browser
 * decides WHAT should happen; the device does the real key presses.
 * Works in Chromium browsers (Chrome, Edge) on https or localhost.
 * ========================================================= */

const serialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator;

// True when we have an open port AND the user wants actions sent to it.
const deviceReady = () => !!device.writer && state.device.send;

// Text fields can contain spaces, newlines and backslashes, but a command must fit on ONE line,
// so we escape them: backslash -> \\, newline -> \n, carriage return -> \r.
function escapeField(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

// Low-level: queue one line for sending, no questions asked.
function writeLine(line) {
  const writer = device.writer;
  if (!writer) return;
  const bytes = new TextEncoder().encode(line + '\n');
  console.debug('[macropad] TX', line);
  // Chain the writes so two quick commands can never be mixed up in transit
  device.txChain = device.txChain
    .then(() => writer.write(bytes))
    .catch((err) => console.warn('[macropad] write failed:', err));
}

// Sends an action/command only if a device is connected and "send" is enabled in settings.
function sendAction(line) {
  if (deviceReady()) writeLine(line);
}

// "Connect" button: ask the browser to show its serial-port picker, then open the chosen port.
async function connectDevice() {
  if (!serialSupported()) {
    logAction('Web Serial is not available in this browser (use Chrome or Edge)');
    return;
  }
  if (device.port) return;
  try {
    const port = await navigator.serial.requestPort(); // must be called from a click
    await openPort(port);
  } catch (err) {
    if (err && err.name === 'NotFoundError') return;   // the user simply closed the picker
    logAction('Connect failed: ' + ((err && err.message) || err));
  }
}

// Opens a serial port, remembers the reader/writer, says hello, and starts listening.
async function openPort(port) {
  await port.open({ baudRate: state.device.baud });
  device.port = port;
  device.writer = port.writable.getWriter();
  device.reader = port.readable.getReader();
  device.rxBuffer = '';
  device.txChain = Promise.resolve();
  updateDeviceUI();
  logAction(`Device connected @ ${state.device.baud}`);

  // Handshake + tell the device which layer we are on (sent even if "send actions" is off)
  writeLine('HELLO macropad 1');
  writeLine(`LAYER ${state.currentLayer}`);

  readLoop(device.reader); // deliberately not awaited: it keeps running in the background
}

// Reads bytes from the device forever, cutting them into lines.
async function readLoop(reader) {
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;                                     // stream closed
      if (!value) continue;

      // stream:true keeps half-received characters until the rest arrives
      device.rxBuffer += decoder.decode(value, { stream: true });

      let newline;
      while ((newline = device.rxBuffer.indexOf('\n')) !== -1) {
        const line = device.rxBuffer.slice(0, newline).replace(/\r$/, '').trim();
        device.rxBuffer = device.rxBuffer.slice(newline + 1);
        if (line) handleDeviceLine(line);
      }
      // A device that never sends a newline would grow this forever, so cut it off
      if (device.rxBuffer.length > MAX_RX_LINE) device.rxBuffer = '';
    }
  } catch (err) {
    logAction('Device read error: ' + ((err && err.message) || err)); // e.g. cable pulled
  } finally {
    await teardownDevice();
  }
}

// Closes everything and resets the UI. Safe to call more than once.
async function teardownDevice() {
  const { port, reader, writer } = device;
  if (!port) return;                                       // already torn down
  device.port = device.reader = device.writer = null;      // mark as disconnected first
  updateDeviceUI();

  try { await reader.cancel(); } catch (err) { /* already closed */ }
  try { reader.releaseLock(); } catch (err) { /* already released */ }
  // writer.close() can hang if the device vanished, so give up after half a second
  try { await Promise.race([writer.close(), sleep(500)]); } catch (err) { /* ignore */ }
  try { writer.releaseLock(); } catch (err) { /* ignore */ }
  try { await port.close(); } catch (err) { /* ignore */ }

  logAction('Device disconnected');
}

// If we were already given permission for exactly one port, open it without showing the picker.
async function autoConnectDevice() {
  if (!serialSupported() || !state.device.autoConnect || device.port) return;
  try {
    const ports = await navigator.serial.getPorts();
    if (ports.length === 1) await openPort(ports[0]);      // more than one = ambiguous, so ask the user
  } catch (err) {
    // port busy (another program has it) or gone: just stay disconnected
  }
}

// One line arrived from the device. Events make the on-screen pad behave as if it was touched.
function handleDeviceLine(line) {
  const [rawCmd, ...args] = line.split(/\s+/);
  const cmd = rawCmd.toUpperCase();
  const n = args.map(Number);                              // numeric view of the arguments

  // Replies like HELLO are always shown; physical key/knob events can be switched off in settings.
  if (cmd === 'HELLO' || cmd === 'ERR') {
    logAction('Device: ' + line.slice(0, 80));
    return;
  }
  if (!state.device.receive) return;

  switch (cmd) {
    case 'KEYDOWN':   // custom key pressed on the device: KEYDOWN <0-11>
      if (Number.isInteger(n[0]) && n[0] >= 0 && n[0] < KEYS_PER_LAYER) handleKeyDown('c' + n[0]);
      break;
    case 'KEYUP':
      if (Number.isInteger(n[0]) && n[0] >= 0 && n[0] < KEYS_PER_LAYER) handleKeyUp('c' + n[0]);
      break;
    case 'LKEYDOWN':  // layer key pressed on the device: LKEYDOWN <0-3>
      if (Number.isInteger(n[0]) && n[0] >= 0 && n[0] < NUM_LAYERS) handleKeyDown('l' + n[0]);
      break;
    case 'LKEYUP':
      if (Number.isInteger(n[0]) && n[0] >= 0 && n[0] < NUM_LAYERS) handleKeyUp('l' + n[0]);
      break;
    case 'KNOBTURN':  // knob turned on the device: KNOBTURN <0-1> <signed clicks>
      if (Number.isInteger(n[0]) && n[0] >= 0 && n[0] < state.knobs.length && Number.isInteger(n[1]) && n[1] !== 0) {
        changeKnob(n[0], clamp(n[1], -MAX_KNOB_TICKS_PER_EVENT, MAX_KNOB_TICKS_PER_EVENT));
        saveState();
      }
      break;
    case 'LAYER':     // device asks for a layer: LAYER <0-3> (don't echo it back)
      if (Number.isInteger(n[0])) switchLayer(n[0], { fromDevice: true });
      break;
    default:
      logAction('Device: ' + line.slice(0, 80));
  }
}

/* =========================================================
 * 9. CONFIG MODAL
 * ========================================================= */

function openConfig() {
  $('#config-modal').hidden = false;
  renderConfig();
}

function closeConfig() {
  $('#config-modal').hidden = true;
  saveState();
}

const isConfigOpen = () => !$('#config-modal').hidden;

// Builds a <select> element as an HTML string. `attrs` are the data-* attributes that say what it edits.
function selectHtml(options, selectedId, attrs) {
  const opts = options
    .map((o) => `<option value="${esc(o.id)}"${String(o.id) === String(selectedId) ? ' selected' : ''}>${esc(o.label)}</option>`)
    .join('');
  return `<select ${attrs}>${opts}</select>`;
}

// Draws whichever tab is active.
function renderConfig() {
  // Highlight the right tab button
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === config.tab));

  const body = $('#config-body');
  if (config.tab === 'keys') body.innerHTML = renderKeyConfig();
  else if (config.tab === 'layers') body.innerHTML = renderLayerConfig();
  else if (config.tab === 'device') body.innerHTML = renderDeviceConfig();
  else body.innerHTML = renderKnobConfig();
}

// Tab 1: the 12 keys of one layer (pick the layer at the top).
function renderKeyConfig() {
  const layerOptions = Array.from({ length: NUM_LAYERS }, (_, i) => ({ id: i, label: 'Layer ' + (i + 1) }));
  let html =
    `<div class="cfg-toolbar"><span>Editing</span>` +
    selectHtml(layerOptions, config.layer, 'data-scope="cfgLayer"') +
    `</div>`;

  state.layers[config.layer].forEach((key, i) => {
    const action = KEY_ACTIONS.find((a) => a.id === key.action) || KEY_ACTIONS[0];
    const attrs = (field) => `data-scope="key" data-index="${i}" data-field="${field}"`;
    html +=
      `<div class="cfg-row">` +
        `<div class="cfg-name">Key ${i + 1}</div>` +
        `<label class="cfg-field">Label<input type="text" value="${esc(key.label)}" ${attrs('label')}></label>` +
        `<label class="cfg-field">Subtext<input type="text" value="${esc(key.subtext)}" ${attrs('subtext')}></label>` +
        `<label class="cfg-field">Action${selectHtml(KEY_ACTIONS, key.action, attrs('action'))}</label>` +
        `<label class="cfg-field">Value<input type="text" value="${esc(key.value)}" placeholder="${esc(action.hint)}"` +
          `${key.action === 'none' ? ' disabled' : ''} ${attrs('value')}></label>` +
      `</div>`;
  });
  return html;
}

// Tab 2: the 4 layer keys (name + which layer they jump to).
function renderLayerConfig() {
  const layerOptions = Array.from({ length: NUM_LAYERS }, (_, i) => ({ id: i, label: 'Layer ' + (i + 1) }));
  return state.layerKeys.map((lk, i) => {
    const attrs = (field) => `data-scope="layerKey" data-index="${i}" data-field="${field}"`;
    return (
      `<div class="cfg-row cfg-row-simple">` +
        `<div class="cfg-name">Layer key ${i + 1}</div>` +
        `<label class="cfg-field">Label<input type="text" value="${esc(lk.label)}" ${attrs('label')}></label>` +
        `<label class="cfg-field">Jumps to${selectHtml(layerOptions, lk.target, attrs('target'))}</label>` +
      `</div>`
    );
  }).join('');
}

// Tab 3: the active layer's independent knobs.
function renderKnobConfig() {
  return `<p class="cfg-note">Editing dials for Layer ${state.currentLayer + 1}. Each layer saves its own dial settings.</p>` + state.knobs.map((kn, i) => {
    const attrs = (field) => `data-scope="knob" data-index="${i}" data-field="${field}"`;
    const num = (field, label) =>
      `<label class="cfg-field">${label}<input type="number" step="any" value="${esc(kn[field])}" ${attrs(field)}></label>`;
    return (
      `<div class="cfg-row cfg-row-simple">` +
        `<div class="cfg-name">Knob ${i + 1}</div>` +
        `<label class="cfg-field">Label<input type="text" value="${esc(kn.label)}" ${attrs('label')}></label>` +
        num('value', 'Current value') +
        num('min', 'Minimum') +
        num('max', 'Maximum') +
        num('step', 'Step per click') +
        `<label class="cfg-field">Mode${selectHtml(KNOB_MODES, kn.mode, attrs('mode'))}</label>` +
        `<label class="cfg-field">Action${selectHtml(KNOB_ACTIONS, kn.action, attrs('action'))}</label>` +
        `<label class="cfg-field">Parameter<input type="text" value="${esc(kn.valueParam)}" ` +
          `placeholder="Custom: command name / Scroll: horizontal" ${attrs('valueParam')}></label>` +
      `</div>`
    );
  }).join('');
}

// Tab 4: hardware link settings.
function renderDeviceConfig() {
  const d = state.device;
  const attrs = (field) => `data-scope="device" data-field="${field}"`;
  const check = (field, label) =>
    `<label class="cfg-field cfg-check"><input type="checkbox" ${d[field] ? 'checked' : ''} ${attrs(field)}>${label}</label>`;
  const baudOptions = BAUD_RATES.map((b) => ({ id: b, label: String(b) }));

  return (
    `<div class="cfg-row cfg-row-simple">` +
      `<div class="cfg-name">Serial link (Web Serial)</div>` +
      `<div class="cfg-note cfg-wide">` +
        (serialSupported()
          ? 'Use the Connect button in the top bar to pick your device.'
          : 'This browser does not support Web Serial. Use Chrome or Edge, opened from https or localhost.') +
        ` Status: <strong>${device.port ? 'connected' : 'not connected'}</strong>.` +
      `</div>` +
      `<label class="cfg-field">Baud rate (applies on next connect)${selectHtml(baudOptions, d.baud, attrs('baud'))}</label>` +
      `<div></div>` +
      check('send', 'Send key and knob actions to the device') +
      check('receive', 'Accept key and knob events from the device') +
      check('autoConnect', 'Reconnect automatically to a device I already allowed') +
    `</div>`
  );
}

// One listener handles every input in the modal. The data-* attributes on each
// input say what part of the state it edits ("event delegation").
function handleConfigInput(e) {
  const el = e.target;
  const scope = el.dataset.scope;
  if (!scope) return;

  // The "which layer am I editing" dropdown only affects the form, not the settings.
  if (scope === 'cfgLayer') {
    config.layer = Number(el.value);
    renderConfig();
    return;
  }

  const index = Number(el.dataset.index);
  const field = el.dataset.field;

  if (scope === 'key') {
    state.layers[config.layer][index][field] = el.value;
  } else if (scope === 'layerKey') {
    state.layerKeys[index][field] = field === 'target' ? Number(el.value) : el.value;
  } else if (scope === 'knob') {
    const kn = state.knobs[index];
    if (['value', 'min', 'max', 'step'].includes(field)) {
      const n = parseFloat(el.value);
      if (!Number.isFinite(n)) return;             // ignore half-typed input like "-"
      kn[field] = n;
      if (kn.max > kn.min) kn.value = clamp(kn.value, kn.min, kn.max);
    } else {
      kn[field] = el.value;
    }
  } else if (scope === 'device') {
    // Checkboxes give true/false, the baud dropdown gives a number
    state.device[field] = el.type === 'checkbox' ? el.checked : Number(el.value);
  }

  saveState();
  renderAll(); // keeps the pad behind the modal in sync (it does not touch the modal itself)

  // Changing an action changes the placeholder / disabled state, so redraw the form.
  // (Only for dropdowns: redrawing while typing in a text box would steal focus.)
  if (field === 'action' || field === 'mode') renderConfig();
}

function resetToDefaults() {
  if (!window.confirm('Reset all keys, layers, knobs and device settings to the defaults?')) return;
  Object.assign(state, makeDefaultState());
  config.layer = 0;
  saveState();
  renderAll();
  renderConfig();
  logAction('Settings reset to defaults');
}

/* =========================================================
 * 10. TABLET HELPERS
 * ========================================================= */

// Toggles full-screen mode (hides the browser's address bar etc.).
function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => { /* the browser said no; ignore */ });
  }
}

// The "Fullscreen" button only makes sense where the browser allows it; its label follows the mode.
function updateFullscreenButton() {
  const btn = $('#fullscreen-btn');
  btn.hidden = !document.fullscreenEnabled;
  btn.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
}

// Asks the device to keep the screen on, so the pad doesn't go dark while you use it.
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (err) {
    // not supported, or the browser refused (low battery etc.): the pad still works, just may dim
  }
}

/* =========================================================
 * 11. START-UP
 * ========================================================= */

// Finds which pad key a computer-keyboard key maps to, e.g. 'q' -> 'c3'. Returns null if none.
function keyIdFromKeyboard(e) {
  const key = e.key.toLowerCase();
  const ci = KEYBOARD_MAP.custom.indexOf(key);
  if (ci !== -1) return 'c' + ci;
  const li = KEYBOARD_MAP.layer.indexOf(key);
  if (li !== -1) return 'l' + li;
  return null;
}

function init() {
  loadState();
  renderAll();

  // --- Pad keys and knobs: touch / mouse ---
  // We listen on the document so keys keep working even though they get rebuilt on every render.
  // Every pointer (finger) has its own pointerId, so several can be active at the same time.
  document.addEventListener('pointerdown', (e) => {
    requestWakeLock(); // first touch is a user gesture, so the browser allows this now
    const keyEl = e.target.closest && e.target.closest('[data-key-id]');
    if (keyEl) {
      e.preventDefault();
      const id = keyEl.dataset.keyId;
      state.pointerKeys.set(e.pointerId, id);
      handleKeyDown(id);
      return;
    }
    startKnobDrag(e); // not a key? maybe a knob
  });

  document.addEventListener('pointermove', handleKnobDrag);

  // A finger lifting (or being cancelled) anywhere on the page lets go of whatever IT was holding,
  // even if it slid off the key first. Other fingers are untouched.
  const releasePointer = (e) => {
    const keyId = state.pointerKeys.get(e.pointerId);
    if (keyId !== undefined) {
      state.pointerKeys.delete(e.pointerId);
      handleKeyUp(keyId);
    }
    endKnobDrag(e);
  };
  document.addEventListener('pointerup', releasePointer);
  document.addEventListener('pointercancel', releasePointer);

  // --- Knobs: mouse wheel ---
  // passive:false is required, otherwise preventDefault() (stopping page scroll) is ignored.
  $('#knobs').addEventListener('wheel', handleKnobWheel, { passive: false });

  // --- Tablet niceties: no long-press menu on the pad, no Safari pinch-zoom gesture ---
  $('.macropad').addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // --- Computer keyboard ---
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isConfigOpen()) { closeConfig(); return; }
    if (isConfigOpen()) return;                                   // don't hijack typing in the form
    if (e.ctrlKey || e.metaKey || e.altKey) return;               // leave browser shortcuts alone
    if (handleKnobKey(e)) return;                                 // arrows on a focused knob
    const id = keyIdFromKeyboard(e);
    if (id && !e.repeat) { e.preventDefault(); handleKeyDown(id); }
  });
  document.addEventListener('keyup', (e) => {
    const id = keyIdFromKeyboard(e);
    if (id) handleKeyUp(id);
  });

  // --- Top bar buttons ---
  $('#layer-toggle').addEventListener('click', () => switchLayer((state.currentLayer + 1) % NUM_LAYERS));
  $('#configure-btn').addEventListener('click', openConfig);
  $('#connect-btn').addEventListener('click', () => (device.port ? teardownDevice() : connectDevice()));
  $('#fullscreen-btn').addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  updateFullscreenButton();

  // The screen lock is released when the tab is hidden; take it again when we come back
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });

  // --- Hardware link: react to the cable being unplugged / plugged back in ---
  if (serialSupported()) {
    navigator.serial.addEventListener('disconnect', (e) => {
      if (e.target === device.port) teardownDevice();
    });
    navigator.serial.addEventListener('connect', (e) => {
      if (state.device.autoConnect && !device.port) openPort(e.target).catch(() => { /* still busy: ignore */ });
    });
    autoConnectDevice(); // open a previously allowed device right away
  }

  // --- Config modal ---
  $('#config-close').addEventListener('click', closeConfig);
  $('#config-done').addEventListener('click', closeConfig);
  $('#config-reset').addEventListener('click', resetToDefaults);
  // Clicking the dark area outside the dialog closes it
  $('#config-modal').addEventListener('click', (e) => { if (e.target.id === 'config-modal') closeConfig(); });
  // Switching tabs
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    config.tab = tab.dataset.tab;
    renderConfig();
  });
  // Every field in the form
  $('#config-body').addEventListener('input', handleConfigInput);
}

init();
