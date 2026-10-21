/* =========================================================
 * DeskPad - Pure PWA Frontend (no backend required)
 * Stores config in localStorage, optional API endpoint for actions
 * ========================================================= */
'use strict';

/* ===== CONSTANTS ===== */
const STORAGE_KEY = 'deskpad-pwa-v1';
const NUM_LAYERS = 4;
const KEYS_PER_LAYER = 12;
const PX_PER_TICK = 6;
const KNOB_MIN_ANGLE = -135;
const KNOB_MAX_ANGLE = 135;

// Optional: set this to your backend URL if you add one later
// const API_BASE = 'http://127.0.0.1:8765/api';
const API_BASE = null;

const KEY_ACTION_TYPES = [
  { id: 'none', label: 'None', hint: '', fields: [] },
  { id: 'keypress', label: 'Key Press', hint: 'e.g. Enter, F5, a', fields: ['key'] },
  { id: 'shortcut', label: 'Shortcut', hint: 'e.g. Ctrl+C, Ctrl+Shift+Z', fields: ['combo'] },
  { id: 'text', label: 'Type Text', hint: 'text to type', fields: ['text'] },
  { id: 'media', label: 'Media', hint: 'play, next, prev, stop, mute, volup, voldown', fields: ['action'] },
  { id: 'mouse', label: 'Mouse', hint: 'left, right, middle, scrollup, scrolldown', fields: ['action'] },
  { id: 'app', label: 'Launch App', hint: 'app identifier', fields: ['appId'] },
  { id: 'shell', label: 'Shell Command', hint: 'command identifier', fields: ['cmdId'] },
  { id: 'layer', label: 'Switch Layer', hint: 'target layer 0-3', fields: ['target'] },
  { id: 'macro', label: 'Run Macro', hint: 'macro identifier', fields: ['macroId'] },
];

const DIAL_ACTION_TYPES = [
  { id: 'none', label: 'None', fields: [] },
  { id: 'volume', label: 'Volume', fields: [] },
  { id: 'brightness', label: 'Brightness', fields: [] },
  { id: 'scroll', label: 'Scroll', fields: ['direction'] },
  { id: 'zoom', label: 'Zoom', fields: [] },
  { id: 'custom', label: 'Custom Command', fields: ['command'] },
];

const DIAL_MODES = [
  { id: 'range', label: 'Range (stops at ends)' },
  { id: 'endless', label: 'Endless (wraps around)' },
];

const SCROLL_DIRECTIONS = [
  { id: 'vertical', label: 'Vertical' },
  { id: 'horizontal', label: 'Horizontal' },
];

const KEYBOARD_MAP = {
  macro: ['1', '2', '3', 'q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'c'],
  layer: ['7', '8', '9', '0'],
};

const ICONS = {
  terminal: '⌨', code: '⌘', browser: '🌐', files: '📁', settings: '⚙',
  copy: '📋', paste: '📄', cut: '✂', undo: '↶', redo: '↷',
  select: '☐', search: '🔍', camera: '📷',
  git: '🔀', 'git-add': '➕', 'git-commit': '💾', 'git-push': '⬆', 'git-pull': '⬇',
  build: '🔨', test: '🧪', debug: '🐛', format: '✨',
  canva: '🎨', figma: '🎯', gimp: '🖌', inkscape: '📐',
  duplicate: '📋', group: '🔗', ungroup: '⛓', 'zoom-fit': '🔍',
  play: '▶', prev: '⏮', next: '⏭', stop: '⏹', mute: '🔇',
  'vol-up': '🔊', 'vol-down': '🔉', fullscreen: '⛶', theater: '🎭',
  subtitles: '💬', 'speed-up': '⏩', 'speed-down': '⏪',
  default: '🔘',
};

const DEFAULT_LAYERS = [
  {
    name: 'General',
    keys: [
      {label: 'Terminal', icon: 'terminal', hint: 'Ctrl+Alt+T', action: 'shortcut', params: {combo: 'Ctrl+Alt+T'}},
      {label: 'Files', icon: 'files', hint: 'Super+E', action: 'shortcut', params: {combo: 'Super+E'}},
      {label: 'Browser', icon: 'browser', hint: 'Super+B', action: 'shortcut', params: {combo: 'Super+B'}},
      {label: 'Settings', icon: 'settings', hint: 'Super+.', action: 'shortcut', params: {combo: 'Super+.'}},
      {label: 'Copy', icon: 'copy', hint: 'Ctrl+C', action: 'shortcut', params: {combo: 'Ctrl+C'}},
      {label: 'Paste', icon: 'paste', hint: 'Ctrl+V', action: 'shortcut', params: {combo: 'Ctrl+V'}},
      {label: 'Cut', icon: 'cut', hint: 'Ctrl+X', action: 'shortcut', params: {combo: 'Ctrl+X'}},
      {label: 'Undo', icon: 'undo', hint: 'Ctrl+Z', action: 'shortcut', params: {combo: 'Ctrl+Z'}},
      {label: 'Redo', icon: 'redo', hint: 'Ctrl+Shift+Z', action: 'shortcut', params: {combo: 'Ctrl+Shift+Z'}},
      {label: 'Select All', icon: 'select', hint: 'Ctrl+A', action: 'shortcut', params: {combo: 'Ctrl+A'}},
      {label: 'Find', icon: 'search', hint: 'Ctrl+F', action: 'shortcut', params: {combo: 'Ctrl+F'}},
      {label: 'Screenshot', icon: 'camera', hint: 'PrtSc', action: 'keypress', params: {key: 'PrintScreen'}}
    ],
    dials: [
      {label: 'Volume', action: 'volume', value: 50, min: 0, max: 100, step: 2, mode: 'range', params: {}},
      {label: 'Brightness', action: 'brightness', value: 50, min: 0, max: 100, step: 5, mode: 'range', params: {}}
    ]
  },
  {
    name: 'Coding',
    keys: [
      {label: 'VS Code', icon: 'code', hint: 'Super+C', action: 'app', params: {appId: 'code'}},
      {label: 'Terminal', icon: 'terminal', hint: 'Ctrl+Alt+T', action: 'shortcut', params: {combo: 'Ctrl+Alt+T'}},
      {label: 'Git Status', icon: 'git', hint: 'gs', action: 'shell', params: {cmdId: 'git_status'}},
      {label: 'Git Add', icon: 'git-add', hint: 'ga', action: 'shell', params: {cmdId: 'git_add'}},
      {label: 'Git Commit', icon: 'git-commit', hint: 'gc', action: 'shell', params: {cmdId: 'git_commit'}},
      {label: 'Git Push', icon: 'git-push', hint: 'gp', action: 'shell', params: {cmdId: 'git_push'}},
      {label: 'Git Pull', icon: 'git-pull', hint: 'gP', action: 'shell', params: {cmdId: 'git_pull'}},
      {label: 'Build', icon: 'build', hint: 'Ctrl+Shift+B', action: 'shortcut', params: {combo: 'Ctrl+Shift+B'}},
      {label: 'Run Tests', icon: 'test', hint: 'Ctrl+T', action: 'shortcut', params: {combo: 'Ctrl+T'}},
      {label: 'Debug', icon: 'debug', hint: 'F5', action: 'keypress', params: {key: 'F5'}},
      {label: 'Format', icon: 'format', hint: 'Shift+Alt+F', action: 'shortcut', params: {combo: 'Shift+Alt+F'}},
      {label: 'Terminal', icon: 'terminal', hint: 'Ctrl+`', action: 'shortcut', params: {combo: 'Ctrl+`'}}
    ],
    dials: [
      {label: 'Volume', action: 'volume', value: 50, min: 0, max: 100, step: 2, mode: 'range', params: {}},
      {label: 'Scroll', action: 'scroll', value: 0, min: -100, max: 100, step: 1, mode: 'endless', params: {direction: 'vertical'}}
    ]
  },
  {
    name: 'Design',
    keys: [
      {label: 'Canva', icon: 'canva', hint: 'Super+C', action: 'app', params: {appId: 'canva'}},
      {label: 'Figma', icon: 'figma', hint: 'Super+F', action: 'app', params: {appId: 'figma'}},
      {label: 'Gimp', icon: 'gimp', hint: 'Super+G', action: 'app', params: {appId: 'gimp'}},
      {label: 'Inkscape', icon: 'inkscape', hint: 'Super+I', action: 'app', params: {appId: 'inkscape'}},
      {label: 'Undo', icon: 'undo', hint: 'Ctrl+Z', action: 'shortcut', params: {combo: 'Ctrl+Z'}},
      {label: 'Redo', icon: 'redo', hint: 'Ctrl+Shift+Z', action: 'shortcut', params: {combo: 'Ctrl+Shift+Z'}},
      {label: 'Copy', icon: 'copy', hint: 'Ctrl+C', action: 'shortcut', params: {combo: 'Ctrl+C'}},
      {label: 'Paste', icon: 'paste', hint: 'Ctrl+V', action: 'shortcut', params: {combo: 'Ctrl+V'}},
      {label: 'Duplicate', icon: 'duplicate', hint: 'Ctrl+D', action: 'shortcut', params: {combo: 'Ctrl+D'}},
      {label: 'Group', icon: 'group', hint: 'Ctrl+G', action: 'shortcut', params: {combo: 'Ctrl+G'}},
      {label: 'Ungroup', icon: 'ungroup', hint: 'Ctrl+Shift+G', action: 'shortcut', params: {combo: 'Ctrl+Shift+G'}},
      {label: 'Zoom Fit', icon: 'zoom-fit', hint: 'Shift+1', action: 'shortcut', params: {combo: 'Shift+1'}}
    ],
    dials: [
      {label: 'Zoom', action: 'zoom', value: 100, min: 25, max: 400, step: 5, mode: 'range', params: {}},
      {label: 'Scroll H', action: 'scroll', value: 0, min: -100, max: 100, step: 1, mode: 'endless', params: {direction: 'horizontal'}}
    ]
  },
  {
    name: 'Media',
    keys: [
      {label: 'Play/Pause', icon: 'play', hint: 'Space', action: 'media', params: {action: 'play'}},
      {label: 'Previous', icon: 'prev', hint: '←', action: 'media', params: {action: 'previous'}},
      {label: 'Next', icon: 'next', hint: '→', action: 'media', params: {action: 'next'}},
      {label: 'Stop', icon: 'stop', hint: 'S', action: 'media', params: {action: 'stop'}},
      {label: 'Mute', icon: 'mute', hint: 'M', action: 'media', params: {action: 'mute'}},
      {label: 'Vol Up', icon: 'vol-up', hint: '↑', action: 'media', params: {action: 'volume_up'}},
      {label: 'Vol Down', icon: 'vol-down', hint: '↓', action: 'media', params: {action: 'volume_down'}},
      {label: 'Fullscreen', icon: 'fullscreen', hint: 'F', action: 'keypress', params: {key: 'f'}},
      {label: 'Theater', icon: 'theater', hint: 'T', action: 'keypress', params: {key: 't'}},
      {label: 'Subtitles', icon: 'subtitles', hint: 'C', action: 'keypress', params: {key: 'c'}},
      {label: 'Speed +', icon: 'speed-up', hint: '>', action: 'keypress', params: {key: '>'}},
      {label: 'Speed -', icon: 'speed-down', hint: '<', action: 'keypress', params: {key: '<'}}
    ],
    dials: [
      {label: 'Volume', action: 'volume', value: 50, min: 0, max: 100, step: 2, mode: 'range', params: {}},
      {label: 'Seek', action: 'custom', value: 0, min: -100, max: 100, step: 1, mode: 'endless', params: {command: 'seek'}}
    ]
  }
];

/* ===== STATE ===== */
const state = {
  currentLayer: 0,
  layers: [],
  layerKeys: [
    {label: 'L1', target: 0},
    {label: 'L2', target: 1},
    {label: 'L3', target: 2},
    {label: 'L4', target: 3},
  ],
  pressedKeys: new Set(),
  pointerKeys: new Map(),
  knobDrags: new Map(),
};

const config = { tab: 'keys', layer: 0 };
const knobEls = [];

/* ===== HELPERS ===== */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const tidy = (n) => Math.round(n * 10000) / 10000;
const esc = (v) => String(v).replace(/[&<>"']/g, c => ({'&':'&','<':'<','>':'>','"':'"',"'":'''}[c]));
const getIcon = (name) => ICONS[name] || ICONS.default;

/* ===== STORAGE ===== */
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      if (Number.isInteger(saved.currentLayer)) state.currentLayer = saved.currentLayer;
      if (Array.isArray(saved.layerKeys)) state.layerKeys = saved.layerKeys;
      if (Array.isArray(saved.layers) && saved.layers.length === 4) {
        state.layers = saved.layers.map((layer, i) => ({
          name: layer.name || DEFAULT_LAYERS[i].name,
          keys: (layer.keys || []).map((k, ki) => ({
            label: k.label || DEFAULT_LAYERS[i].keys[ki].label,
            icon: k.icon || DEFAULT_LAYERS[i].keys[ki].icon,
            hint: k.hint || DEFAULT_LAYERS[i].keys[ki].hint,
            action: k.action || 'none',
            params: k.params || {}
          })),
          dials: (layer.dials || []).map((d, di) => ({
            label: d.label || DEFAULT_LAYERS[i].dials[di].label,
            action: d.action || 'none',
            value: Number.isFinite(d.value) ? d.value : DEFAULT_LAYERS[i].dials[di].value,
            min: Number.isFinite(d.min) ? d.min : DEFAULT_LAYERS[i].dials[di].min,
            max: Number.isFinite(d.max) ? d.max : DEFAULT_LAYERS[i].dials[di].max,
            step: Number.isFinite(d.step) ? d.step : DEFAULT_LAYERS[i].dials[di].step,
            mode: d.mode || 'range',
            params: d.params || {}
          }))
        }));
      }
    }
  } catch (e) {}
  if (!state.layers.length) state.layers = JSON.parse(JSON.stringify(DEFAULT_LAYERS));
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      currentLayer: state.currentLayer,
      layerKeys: state.layerKeys,
      layers: state.layers
    }));
  } catch (e) {}
}

/* ===== RENDERING ===== */
function renderAll() {
  renderLayerIndicator();
  renderLayerTabs();
  renderMacroKeys();
  renderLayerKeys();
  renderKnobs();
}

function renderLayerIndicator() {
  const layer = state.layers[state.currentLayer];
  $('#layer-indicator').textContent = layer?.name || `Layer ${state.currentLayer + 1}`;
  document.body.dataset.layer = state.currentLayer;
}

function renderLayerTabs() {
  const container = $('#layer-tabs');
  container.innerHTML = '';
  state.layers.forEach((layer, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.role = 'tab';
    btn.className = 'layer-tab' + (i === state.currentLayer ? ' active' : '');
    btn.dataset.layer = i;
    btn.textContent = layer?.name || `L${i+1}`;
    btn.addEventListener('click', () => switchLayer(i));
    container.appendChild(btn);
  });
}

function renderMacroKeys() {
  const grid = $('#macro-keys');
  grid.innerHTML = '';
  const layer = state.layers[state.currentLayer];
  if (!layer) return;

  layer.keys.forEach((key, i) => {
    const id = 'm' + i;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'key' + (key.action === 'none' ? ' key-empty' : '');
    btn.dataset.keyId = id;
    btn.innerHTML = `
      <span class="key-icon">${getIcon(key.icon)}</span>
      <span class="key-label">${esc(key.label)}</span>
      <span class="key-sub">${esc(key.hint)}</span>
      <kbd class="key-hint">${esc(KEYBOARD_MAP.macro[i].toUpperCase())}</kbd>
    `;
    if (state.pressedKeys.has(id)) btn.classList.add('pressed');
    grid.appendChild(btn);
  });
}

function renderLayerKeys() {
  const row = $('#layer-keys');
  row.innerHTML = '';
  state.layerKeys.forEach((lk, i) => {
    const id = 'l' + i;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'key' + (lk.target === state.currentLayer ? ' active-layer' : '');
    btn.dataset.keyId = id;
    btn.innerHTML = `
      <span class="key-label">${esc(lk.label)}</span>
      <kbd class="key-hint">${esc(KEYBOARD_MAP.layer[i])}</kbd>
    `;
    if (state.pressedKeys.has(id)) btn.classList.add('pressed');
    row.appendChild(btn);
  });
}

function renderKnobs() {
  const wrap = $('#knobs');
  wrap.innerHTML = '';
  knobEls.length = 0;

  const layer = state.layers[state.currentLayer];
  if (!layer) return;

  layer.dials.forEach((dial, i) => {
    const item = document.createElement('div');
    item.className = 'knob-item';
    item.innerHTML = `
      <div class="knob-label">${esc(dial.label)}</div>
      <div class="knob-dial" data-knob="${i}" tabindex="0" role="slider" aria-label="${esc(dial.label)}">
        <div class="knob-cap"></div>
      </div>
      <div class="knob-value"></div>
    `;
    wrap.appendChild(item);

    knobEls[i] = {
      dial: item.querySelector('.knob-dial'),
      value: item.querySelector('.knob-value'),
    };
    updateKnobVisual(i, dial);
  });
}

function updateKnobVisual(i, dial) {
  const els = knobEls[i];
  if (!els || !dial) return;

  const span = dial.max - dial.min;
  const fraction = span > 0 ? clamp((dial.value - dial.min) / span, 0, 1) : 0;
  const angle = KNOB_MIN_ANGLE + fraction * (KNOB_MAX_ANGLE - KNOB_MIN_ANGLE);

  els.dial.style.setProperty('--angle', angle + 'deg');
  els.value.textContent = tidy(dial.value);
  els.dial.setAttribute('aria-valuemin', dial.min);
  els.dial.setAttribute('aria-valuemax', dial.max);
  els.dial.setAttribute('aria-valuenow', dial.value);
}

/* ===== KEY HANDLING ===== */
function getKeyById(id) {
  const index = Number(id.slice(1));
  return id[0] === 'm' ? state.layers[state.currentLayer].keys[index] : state.layerKeys[index];
}

function setPressedVisual(id, pressed) {
  const el = document.querySelector(`[data-key-id="${id}"]`);
  if (el) el.classList.toggle('pressed', pressed);
}

function handleKeyDown(id) {
  if (state.pressedKeys.has(id)) return;
  state.pressedKeys.add(id);
  setPressedVisual(id, true);

  if (id[0] === 'm') executeKeyAction(getKeyById(id));
  else executeLayerKey(getKeyById(id));
}

function handleKeyUp(id) {
  state.pressedKeys.delete(id);
  setPressedVisual(id, false);
}

function switchLayer(index) {
  if (!Number.isInteger(index) || index < 0 || index >= NUM_LAYERS) return;
  state.currentLayer = index;
  state.pressedKeys.clear();
  renderLayerIndicator();
  renderLayerTabs();
  renderMacroKeys();
  renderLayerKeys();
  renderKnobs();
  saveState();
}

async function executeKeyAction(key) {
  const {action, params} = key;
  if (action === 'none') return;

  // Visual feedback
  console.log('[DeskPad] Action:', action, params);

  // If API_BASE is set, send to backend
  if (API_BASE) {
    try {
      await fetch(API_BASE + '/action', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({type: action, params, layer: state.currentLayer})
      });
    } catch (e) {
      console.warn('[DeskPad] API call failed:', e);
    }
  }
}

function executeLayerKey(layerKey) {
  switchLayer(layerKey.target);
}

/* ===== KNOB HANDLING ===== */
function startKnobDrag(e) {
  const dial = e.target.closest('.knob-dial');
  if (!dial) return;
  e.preventDefault();
  const index = Number(dial.dataset.knob);
  state.knobDrags.set(e.pointerId, {index, lastX: e.clientX, lastY: e.clientY, accum: 0});
  dial.classList.add('rotating');
  dial.focus();
}

async function handleKnobDrag(e) {
  const drag = state.knobDrags.get(e.pointerId);
  if (!drag) return;

  const delta = (drag.lastY - e.clientY) + (e.clientX - drag.lastX);
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;

  drag.accum += delta;
  const ticks = Math.trunc(drag.accum / PX_PER_TICK);
  if (ticks !== 0) {
    drag.accum -= ticks * PX_PER_TICK;
    await changeKnob(drag.index, ticks);
  }
}

async function changeKnob(index, ticks) {
  const layer = state.layers[state.currentLayer];
  const dial = layer?.dials[index];
  if (!dial) return;

  const step = dial.step > 0 ? dial.step : 1;
  const span = dial.max - dial.min;
  if (!(span > 0)) return;

  let next = dial.value + ticks * step;

  if (dial.mode === 'endless') {
    next = ((next - dial.min) % span + span) % span + dial.min;
  } else {
    next = clamp(next, dial.min, dial.max);
  }
  next = tidy(next);
  if (next === dial.value) return;

  dial.value = next;
  updateKnobVisual(index, dial);

  console.log('[DeskPad] Dial', index, ':', dial.action, 'delta', ticks * step, 'value', next);

  if (API_BASE) {
    try {
      await fetch(API_BASE + '/dial', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          dialIndex: index, type: dial.action, delta: ticks * step,
          value: next, params: dial.params, layer: state.currentLayer
        })
      });
    } catch (e) {
      console.warn('[DeskPad] Dial API call failed:', e);
    }
  }
}

function endKnobDrag(e) {
  const drag = state.knobDrags.get(e.pointerId);
  if (!drag) return;
  const el = knobEls[drag.index];
  if (el) el.dial.classList.remove('rotating');
  state.knobDrags.delete(e.pointerId);
  saveState();
}

function handleKnobWheel(e) {
  const dial = e.target.closest('.knob-dial');
  if (!dial) return;
  e.preventDefault();
  changeKnob(Number(dial.dataset.knob), e.deltaY < 0 ? 1 : -1);
}

function handleKnobKey(e) {
  const dial = e.target.closest && e.target.closest('.knob-dial');
  if (!dial) return false;
  const ticks = {ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1}[e.key];
  if (!ticks) return false;
  e.preventDefault();
  changeKnob(Number(dial.dataset.knob), ticks);
  return true;
}

/* ===== CONFIG MODAL ===== */
function openConfig() {
  $('#config-modal').hidden = false;
  renderConfig();
}

function closeConfig() {
  $('#config-modal').hidden = true;
  saveState();
}

function isConfigOpen() {
  return !$('#config-modal').hidden;
}

function selectHtml(options, selectedId, attrs) {
  const opts = options.map(o => `
    <option value="${esc(o.id)}"${String(o.id) === String(selectedId) ? ' selected' : ''}>${esc(o.label)}</option>
  `).join('');
  return `<select ${attrs}>${opts}</select>`;
}

function renderConfig() {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === config.tab));
  const body = $('#config-body');

  if (config.tab === 'keys') body.innerHTML = renderKeyConfig();
  else if (config.tab === 'layers') body.innerHTML = renderLayerConfig();
  else if (config.tab === 'knobs') body.innerHTML = renderKnobConfig();
  else body.innerHTML = renderExportConfig();
}

function renderKeyConfig() {
  const layerOpts = Array.from({length: NUM_LAYERS}, (_, i) => ({id: i, label: state.layers[i]?.name || `Layer ${i+1}`}));
  let html = `<div class="cfg-toolbar"><span>Editing</span>${selectHtml(layerOpts, config.layer, 'data-scope="cfgLayer"')}</div>`;

  state.layers[config.layer].keys.forEach((key, i) => {
    const actionDef = KEY_ACTION_TYPES.find(a => a.id === key.action) || KEY_ACTION_TYPES[0];
    const attrs = (field) => `data-scope="key" data-index="${i}" data-field="${field}"`;
    html += `
      <div class="cfg-row">
        <div class="cfg-name">Key ${i+1}</div>
        <label class="cfg-field">Label<input type="text" value="${esc(key.label)}" ${attrs('label')}></label>
        <label class="cfg-field">Icon<input type="text" value="${esc(key.icon)}" ${attrs('icon')}></label>
        <label class="cfg-field">Hint<input type="text" value="${esc(key.hint)}" ${attrs('hint')}></label>
        <label class="cfg-field">Action${selectHtml(KEY_ACTION_TYPES, key.action, attrs('action'))}</label>
    `;

    actionDef.fields.forEach(field => {
      const val = key.params?.[field] || '';
      const placeholder = field === 'key' ? 'Enter, F5, a' :
                          field === 'combo' ? 'Ctrl+C, Ctrl+Shift+Z' :
                          field === 'text' ? 'Text to type' :
                          field === 'action' ? 'play, next, prev, stop, mute, volup, voldown' :
                          field === 'appId' ? 'code, terminal, browser, files' :
                          field === 'cmdId' ? 'git_status, git_add, etc.' :
                          field === 'target' ? '0-3' :
                          field === 'macroId' ? 'macro name' :
                          field === 'direction' ? 'vertical/horizontal' :
                          field === 'command' ? 'custom command id' : '';
      html += `<label class="cfg-field">${field.charAt(0).toUpperCase()+field.slice(1)}<input type="text" value="${esc(val)}" placeholder="${esc(placeholder)}" ${attrs('params.'+field)}></label>`;
    });

    html += `</div>`;
  });
  return html;
}

function renderLayerConfig() {
  const layerOpts = Array.from({length: NUM_LAYERS}, (_, i) => ({id: i, label: state.layers[i]?.name || `Layer ${i+1}`}));
  return state.layerKeys.map((lk, i) => {
    const attrs = (field) => `data-scope="layerKey" data-index="${i}" data-field="${field}"`;
    return `
      <div class="cfg-row cfg-row-simple">
        <div class="cfg-name">Layer key ${i+1}</div>
        <label class="cfg-field">Label<input type="text" value="${esc(lk.label)}" ${attrs('label')}></label>
        <label class="cfg-field">Target${selectHtml(layerOpts, lk.target, attrs('target'))}</label>
      </div>
    `;
  }).join('');
}

function renderKnobConfig() {
  return `<p class="cfg-note">Editing dials for ${state.layers[config.layer]?.name || 'Layer 1'}. Each layer saves its own dial settings.</p>` +
    state.layers[config.layer].dials.map((dial, i) => {
      const attrs = (field) => `data-scope="knob" data-index="${i}" data-field="${field}"`;
      const num = (field, label) => `<label class="cfg-field">${label}<input type="number" step="any" value="${esc(dial[field])}" ${attrs(field)}></label>`;
      const actionDef = DIAL_ACTION_TYPES.find(a => a.id === dial.action) || DIAL_ACTION_TYPES[0];

      return `
        <div class="cfg-row cfg-row-simple">
          <div class="cfg-name">Dial ${i+1}</div>
          <label class="cfg-field">Label<input type="text" value="${esc(dial.label)}" ${attrs('label')}></label>
          ${num('value', 'Current')}
          ${num('min', 'Min')}
          ${num('max', 'Max')}
          ${num('step', 'Step')}
          <label class="cfg-field">Mode${selectHtml(DIAL_MODES, dial.mode || 'range', attrs('mode'))}</label>
          <label class="cfg-field">Action${selectHtml(DIAL_ACTION_TYPES, dial.action, attrs('action'))}</label>
          ${actionDef.fields.map(f => {
            const opts = f === 'direction' ? SCROLL_DIRECTIONS : [];
            const val = dial.params?.[f] || '';
            return opts.length
              ? `<label class="cfg-field">${f}${selectHtml(opts, val, attrs('params.'+f))}</label>`
              : `<label class="cfg-field">${f}<input type="text" value="${esc(val)}" ${attrs('params.'+f)}></label>`;
          }).join('')}
        </div>
      `;
    }).join('');
}

function renderExportConfig() {
  const json = JSON.stringify({
    currentLayer: state.currentLayer,
    layerKeys: state.layerKeys,
    layers: state.layers
  }, null, 2);

  return `
    <div class="cfg-row cfg-row-simple">
      <div class="cfg-name">Export Config</div>
      <div class="cfg-note cfg-wide">
        Copy this JSON to backup or share your layout. Paste into Import to restore.
      </div>
      <textarea class="cfg-field" rows="15" readonly style="font-family:monospace;font-size:0.75rem;background:rgba(0,0,0,0.3);">${esc(json)}</textarea>
      <div></div>
      <button type="button" class="btn" id="copy-config">Copy to Clipboard</button>
      <div></div>
    </div>
    <div class="cfg-row cfg-row-simple">
      <div class="cfg-name">Import Config</div>
      <div class="cfg-note cfg-wide">Paste a previously exported JSON config here.</div>
      <textarea class="cfg-field" rows="8" id="import-json" placeholder="Paste JSON here..." style="font-family:monospace;font-size:0.75rem;background:rgba(0,0,0,0.3);"></textarea>
      <div></div>
      <button type="button" class="btn btn-primary" id="import-config">Import</button>
      <div></div>
    </div>
  `;
}

function handleConfigInput(e) {
  const el = e.target;
  const scope = el.dataset.scope;
  if (!scope) return;

  if (scope === 'cfgLayer') {
    config.layer = Number(el.value);
    renderConfig();
    return;
  }

  const index = Number(el.dataset.index);
  const field = el.dataset.field;

  if (scope === 'key') {
    const key = state.layers[config.layer].keys[index];
    if (field.startsWith('params.')) {
      key.params = key.params || {};
      key.params[field.slice(7)] = el.value;
    } else {
      key[field] = el.value;
    }
  } else if (scope === 'layerKey') {
    state.layerKeys[index][field] = field === 'target' ? Number(el.value) : el.value;
  } else if (scope === 'knob') {
    const dial = state.layers[config.layer].dials[index];
    if (['value','min','max','step'].includes(field)) {
      const n = parseFloat(el.value);
      if (!Number.isFinite(n)) return;
      dial[field] = n;
      if (dial.max > dial.min) dial.value = clamp(dial.value, dial.min, dial.max);
    } else if (field.startsWith('params.')) {
      dial.params = dial.params || {};
      dial.params[field.slice(7)] = el.value;
    } else {
      dial[field] = el.value;
    }
  }

  saveState();
  renderAll();
  if (field === 'action' || field === 'mode') renderConfig();
}

function resetToDefaults() {
  if (!confirm('Reset all keys, layers, dials to defaults?')) return;
  state.layers = JSON.parse(JSON.stringify(DEFAULT_LAYERS));
  state.currentLayer = 0;
  state.layerKeys = [
    {label: 'L1', target: 0},
    {label: 'L2', target: 1},
    {label: 'L3', target: 2},
    {label: 'L4', target: 3},
  ];
  saveState();
  renderAll();
  renderConfig();
}

/* ===== TABLET HELPERS ===== */
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

function updateFullscreenButton() {
  const btn = $('#fullscreen-btn');
  btn.hidden = !document.fullscreenEnabled;
  btn.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
}

let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) {}
}

/* ===== INIT ===== */
function keyIdFromKeyboard(e) {
  const key = e.key.toLowerCase();
  const ci = KEYBOARD_MAP.macro.indexOf(key);
  if (ci !== -1) return 'm' + ci;
  const li = KEYBOARD_MAP.layer.indexOf(key);
  if (li !== -1) return 'l' + li;
  return null;
}

function init() {
  loadState();
  renderAll();

  document.addEventListener('pointerdown', (e) => {
    requestWakeLock();
    const keyEl = e.target.closest('[data-key-id]');
    if (keyEl) {
      e.preventDefault();
      state.pointerKeys.set(e.pointerId, keyEl.dataset.keyId);
      handleKeyDown(keyEl.dataset.keyId);
      return;
    }
    startKnobDrag(e);
  });

  document.addEventListener('pointermove', handleKnobDrag);

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

  $('#knobs').addEventListener('wheel', handleKnobWheel, {passive: false});

  $('.deskpad').addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('gesturestart', e => e.preventDefault());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isConfigOpen()) { closeConfig(); return; }
    if (isConfigOpen()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (handleKnobKey(e)) return;
    const id = keyIdFromKeyboard(e);
    if (id && !e.repeat) { e.preventDefault(); handleKeyDown(id); }
  });
  document.addEventListener('keyup', (e) => {
    const id = keyIdFromKeyboard(e);
    if (id) handleKeyUp(id);
  });

  $('#configure-btn').addEventListener('click', openConfig);
  $('#fullscreen-btn').addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  updateFullscreenButton();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });

  $('#config-close').addEventListener('click', closeConfig);
  $('#config-done').addEventListener('click', closeConfig);
  $('#config-reset').addEventListener('click', resetToDefaults);
  $('#config-modal').addEventListener('click', (e) => { if (e.target.id === 'config-modal') closeConfig(); });

  $$('.tab').forEach(tab => tab.addEventListener('click', () => {
    config.tab = tab.dataset.tab;
    renderConfig();
  }));

  $('#config-body').addEventListener('input', handleConfigInput);

  // Export/Import handlers
  document.addEventListener('click', (e) => {
    if (e.target.id === 'copy-config') {
      const json = JSON.stringify({
        currentLayer: state.currentLayer,
        layerKeys: state.layerKeys,
        layers: state.layers
      }, null, 2);
      navigator.clipboard.writeText(json);
      e.target.textContent = 'Copied!';
      setTimeout(() => e.target.textContent = 'Copy to Clipboard', 1500);
    }
    if (e.target.id === 'import-config') {
      const textarea = $('#import-json');
      try {
        const imported = JSON.parse(textarea.value);
        if (imported.layers && imported.layers.length === 4) {
          state.layers = imported.layers;
          if (imported.currentLayer !== undefined) state.currentLayer = imported.currentLayer;
          if (imported.layerKeys) state.layerKeys = imported.layerKeys;
          saveState();
          renderAll();
          renderConfig();
          textarea.value = '';
          alert('Config imported successfully!');
        } else {
          alert('Invalid config format');
        }
      } catch (err) {
        alert('Invalid JSON: ' + err.message);
      }
    }
  });
}

init();