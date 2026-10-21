const NUM_CUSTOM_KEYS = 12;
const NUM_LAYERS = 4;
const NUM_KNOBS = 2;

const state = {
  currentLayer: 0,
  customKeys: Array.from({ length: NUM_LAYERS }, () =>
    Array.from({ length: NUM_CUSTOM_KEYS }, (_, i) => ({
      label: `Key ${i + 1}`,
      subtext: '',
      action: 'none',
      value: ''
    }))
  ),
  layerKeys: Array.from({ length: NUM_LAYERS }, (_, i) => ({
    label: `L${i + 1}`,
    targetLayer: i
  })),
  knobs: Array.from({ length: NUM_KNOBS }, (_, i) => ({
    label: `Knob ${i + 1}`,
    value: 0,
    min: 0,
    max: 100,
    step: 1,
    mode: 'relative',
    action: 'none',
    valueParam: ''
  })),
  pressedKeys: new Set(),
  knobDrag: { active: false, knobIndex: null, startY: 0, startValue: 0 },
  keyCapture: { active: false, targetInput: null, targetKeyIndex: null, targetField: null }
};

const keyActions = [
  { value: 'none', label: 'None' },
  { value: 'keypress', label: 'Key Press' },
  { value: 'text', label: 'Type Text' },
  { value: 'shortcut', label: 'Keyboard Shortcut' },
  { value: 'media', label: 'Media Control' },
  { value: 'mouse', label: 'Mouse Action' },
  { value: 'layer', label: 'Layer Switch' },
  { value: 'macro', label: 'Macro Sequence' }
];

const knobActions = [
  { value: 'none', label: 'None' },
  { value: 'volume', label: 'System Volume' },
  { value: 'brightness', label: 'Screen Brightness' },
  { value: 'scroll', label: 'Scroll' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'custom', label: 'Custom Value' }
];

const keyCaptureActions = ['keypress', 'shortcut'];

function init() {
  renderCustomKeys();
  renderLayerKeys();
  renderKnobs();
  setupEventListeners();
  loadState();
}

function renderCustomKeys() {
  const container = document.getElementById('custom-keys');
  const keys = state.customKeys[state.currentLayer];
  
  container.innerHTML = keys.map((key, index) => `
    <div class="key" data-key-index="${index}" data-layer="${state.currentLayer}">
      <span class="key-label">${escapeHtml(key.label)}</span>
      ${key.subtext ? `<span class="key-subtext">${escapeHtml(key.subtext)}</span>` : ''}
    </div>
  `).join('');
}

function renderLayerKeys() {
  const container = document.getElementById('layer-keys');
  
  container.innerHTML = state.layerKeys.map((layer, index) => `
    <div class="layer-key ${index === state.currentLayer ? 'active' : ''}" data-layer-index="${index}">
      ${escapeHtml(layer.label)}
    </div>
  `).join('');
}

function renderKnobs() {
  state.knobs.forEach((knob, index) => {
    const knobEl = document.getElementById(`knob-${index + 1}`);
    const valueEl = document.getElementById(`knob${index + 1}-value`);
    const indicator = knobEl.querySelector('.knob-indicator');
    
    const angle = mapValue(knob.value, knob.min, knob.max, -135, 135);
    indicator.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
    valueEl.textContent = knob.value;
  });
}

function mapValue(value, inMin, inMax, outMin, outMax) {
  return ((value - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin;
}

function setupEventListeners() {
  document.getElementById('custom-keys').addEventListener('mousedown', handleKeyDown);
  document.getElementById('custom-keys').addEventListener('mouseup', handleKeyUp);
  document.getElementById('custom-keys').addEventListener('mouseleave', handleKeyUp);
  document.getElementById('custom-keys').addEventListener('touchstart', handleKeyDown, { passive: false });
  document.getElementById('custom-keys').addEventListener('touchend', handleKeyUp);

  document.getElementById('layer-keys').addEventListener('click', handleLayerClick);

  document.getElementById('knob-1').addEventListener('mousedown', (e) => startKnobDrag(e, 0));
  document.getElementById('knob-2').addEventListener('mousedown', (e) => startKnobDrag(e, 1));
  document.addEventListener('mousemove', handleKnobDrag);
  document.addEventListener('mouseup', endKnobDrag);
  document.getElementById('knob-1').addEventListener('touchstart', (e) => startKnobDrag(e, 0), { passive: false });
  document.getElementById('knob-2').addEventListener('touchstart', (e) => startKnobDrag(e, 1), { passive: false });
  document.addEventListener('touchmove', handleKnobDrag, { passive: false });
  document.addEventListener('touchend', endKnobDrag);

  document.getElementById('config-btn').addEventListener('click', openConfig);
  document.getElementById('close-config').addEventListener('click', closeConfig);
  document.getElementById('config-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeConfig();
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('key-config-grid').addEventListener('input', handleConfigChange);
  document.getElementById('key-config-grid').addEventListener('focusin', handleConfigFocus);
  document.getElementById('key-config-grid').addEventListener('focusout', handleConfigBlur);
  document.getElementById('layer-config-grid').addEventListener('input', handleConfigChange);
  document.getElementById('knob-config-grid').addEventListener('input', handleConfigChange);

  document.addEventListener('keydown', handleGlobalKeydown);
}

function handleKeyDown(e) {
  const keyEl = e.target.closest('.key');
  if (!keyEl) return;
  
  e.preventDefault();
  const index = parseInt(keyEl.dataset.keyIndex);
  const layer = parseInt(keyEl.dataset.layer);
  
  if (layer !== state.currentLayer) return;
  
  state.pressedKeys.add(index);
  keyEl.classList.add('pressed');
  executeKeyAction(index);
}

function handleKeyUp(e) {
  const keyEl = e.target.closest('.key');
  if (!keyEl) {
    document.querySelectorAll('.key.pressed').forEach(el => el.classList.remove('pressed'));
    state.pressedKeys.clear();
    return;
  }
  
  const index = parseInt(keyEl.dataset.keyIndex);
  state.pressedKeys.delete(index);
  keyEl.classList.remove('pressed');
}

function handleLayerClick(e) {
  const layerEl = e.target.closest('.layer-key');
  if (!layerEl) return;
  
  const index = parseInt(layerEl.dataset.layerIndex);
  switchLayer(index);
}

function switchLayer(layerIndex) {
  state.currentLayer = layerIndex;
  document.getElementById('current-layer').textContent = `Layer ${layerIndex + 1}`;
  renderCustomKeys();
  renderLayerKeys();
}

function startKnobDrag(e, knobIndex) {
  e.preventDefault();
  const knob = state.knobs[knobIndex];
  const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
  
  state.knobDrag = {
    active: true,
    knobIndex,
    startY: clientY,
    startValue: knob.value
  };
  
  document.getElementById(`knob-${knobIndex + 1}`).classList.add('rotating');
}

function handleKnobDrag(e) {
  if (!state.knobDrag.active) return;
  
  e.preventDefault();
  const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
  const deltaY = state.knobDrag.startY - clientY;
  const knob = state.knobs[state.knobDrag.knobIndex];
  
  const sensitivity = 0.5;
  let newValue = state.knobDrag.startValue + deltaY * sensitivity;
  newValue = Math.round(newValue / knob.step) * knob.step;
  newValue = Math.max(knob.min, Math.min(knob.max, newValue));
  
  if (newValue !== knob.value) {
    knob.value = newValue;
    executeKnobAction(state.knobDrag.knobIndex, newValue);
    renderKnobs();
  }
}

function endKnobDrag() {
  if (state.knobDrag.active) {
    document.getElementById(`knob-${state.knobDrag.knobIndex + 1}`).classList.remove('rotating');
    state.knobDrag.active = false;
  }
}

function executeKeyAction(keyIndex) {
  const key = state.customKeys[state.currentLayer][keyIndex];
  console.log(`Key ${keyIndex + 1} (Layer ${state.currentLayer + 1}):`, key);
  
  switch (key.action) {
    case 'keypress':
      simulateKeyPress(key.value);
      break;
    case 'text':
      simulateTextInput(key.value);
      break;
    case 'shortcut':
      simulateShortcut(key.value);
      break;
    case 'media':
      simulateMediaControl(key.value);
      break;
    case 'mouse':
      simulateMouseAction(key.value);
      break;
    case 'layer':
      switchLayer(parseInt(key.value) || 0);
      break;
    case 'macro':
      executeMacro(key.value);
      break;
  }
}

function executeKnobAction(knobIndex, value) {
  const knob = state.knobs[knobIndex];
  console.log(`Knob ${knobIndex + 1}: ${value}`, knob);
  
  switch (knob.action) {
    case 'volume':
      setSystemVolume(value);
      break;
    case 'brightness':
      setBrightness(value);
      break;
    case 'scroll':
      simulateScroll(value);
      break;
    case 'zoom':
      simulateZoom(value);
      break;
    case 'custom':
      sendCustomValue(knob.valueParam, value);
      break;
  }
}

function simulateKeyPress(key) {
  console.log('Simulate key press:', key);
}

function simulateTextInput(text) {
  console.log('Type text:', text);
}

function simulateShortcut(shortcut) {
  console.log('Execute shortcut:', shortcut);
}

function simulateMediaControl(action) {
  console.log('Media control:', action);
}

function simulateMouseAction(action) {
  console.log('Mouse action:', action);
}

function executeMacro(macro) {
  console.log('Execute macro:', macro);
}

function setSystemVolume(value) {
  console.log('Set volume:', value);
}

function setBrightness(value) {
  console.log('Set brightness:', value);
}

function simulateScroll(value) {
  console.log('Scroll:', value);
}

function simulateZoom(value) {
  console.log('Zoom:', value);
}

function sendCustomValue(param, value) {
  console.log('Custom value:', param, value);
}

function openConfig() {
  renderConfig();
  document.getElementById('config-modal').classList.remove('hidden');
}

function closeConfig() {
  stopKeyCapture();
  document.getElementById('config-modal').classList.add('hidden');
  saveState();
}

function switchTab(tab) {
  stopKeyCapture();
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `${tab}-tab`);
  });
}

function renderConfig() {
  renderKeyConfig();
  renderLayerConfig();
  renderKnobConfig();
}

function renderKeyConfig() {
  const container = document.getElementById('key-config-grid');
  const keys = state.customKeys[state.currentLayer];
  
  container.innerHTML = keys.map((key, index) => `
    <div class="config-item">
      <label>Key ${index + 1} (Layer ${state.currentLayer + 1})</label>
      <div class="config-row">
        <input type="text" placeholder="Label" value="${escapeHtml(key.label)}" data-key-index="${index}" data-field="label">
        <input type="text" placeholder="Subtext" value="${escapeHtml(key.subtext)}" data-key-index="${index}" data-field="subtext">
      </div>
      <div class="config-row">
        <select data-key-index="${index}" data-field="action">
          ${keyActions.map(a => `<option value="${a.value}" ${a.value === key.action ? 'selected' : ''}>${a.label}</option>`).join('')}
        </select>
        <input type="text" placeholder="Value" value="${escapeHtml(key.value)}" data-key-index="${index}" data-field="value" ${keyCaptureActions.includes(key.action) ? 'data-capture="true"' : ''}>
      </div>
    </div>
  `).join('');
}

function renderLayerConfig() {
  const container = document.getElementById('layer-config-grid');
  
  container.innerHTML = state.layerKeys.map((layer, index) => `
    <div class="config-item">
      <label>Layer Key ${index + 1}</label>
      <div class="config-row">
        <input type="text" placeholder="Label" value="${escapeHtml(layer.label)}" data-layer-index="${index}" data-field="label">
        <select data-layer-index="${index}" data-field="targetLayer">
          ${Array.from({ length: NUM_LAYERS }, (_, i) => `<option value="${i}" ${i === layer.targetLayer ? 'selected' : ''}>Layer ${i + 1}</option>`).join('')}
        </select>
      </div>
    </div>
  `).join('');
}

function renderKnobConfig() {
  const container = document.getElementById('knob-config-grid');
  
  container.innerHTML = state.knobs.map((knob, index) => `
    <div class="config-item">
      <label>Knob ${index + 1}</label>
      <div class="config-row">
        <input type="text" placeholder="Label" value="${escapeHtml(knob.label)}" data-knob-index="${index}" data-field="label">
        <select data-knob-index="${index}" data-field="mode">
          <option value="relative" ${knob.mode === 'relative' ? 'selected' : ''}>Relative</option>
          <option value="absolute" ${knob.mode === 'absolute' ? 'selected' : ''}>Absolute</option>
        </select>
      </div>
      <div class="config-row">
        <input type="number" placeholder="Min" value="${knob.min}" data-knob-index="${index}" data-field="min" step="1">
        <input type="number" placeholder="Max" value="${knob.max}" data-knob-index="${index}" data-field="max" step="1">
      </div>
      <div class="config-row">
        <input type="number" placeholder="Step" value="${knob.step}" data-knob-index="${index}" data-field="step" step="1" min="1">
        <select data-knob-index="${index}" data-field="action">
          ${knobActions.map(a => `<option value="${a.value}" ${a.value === knob.action ? 'selected' : ''}>${a.label}</option>`).join('')}
        </select>
      </div>
      <div class="config-row">
        <input type="text" placeholder="Value Param" value="${escapeHtml(knob.valueParam)}" data-knob-index="${index}" data-field="valueParam">
      </div>
    </div>
  `).join('');
}

function handleConfigChange(e) {
  const target = e.target;
  const field = target.dataset.field;
  
  if (target.dataset.keyIndex !== undefined) {
    const index = parseInt(target.dataset.keyIndex);
    state.customKeys[state.currentLayer][index][field] = target.type === 'number' ? parseFloat(target.value) : target.value;
    if (field === 'label' || field === 'subtext') renderCustomKeys();
    if (field === 'action') {
      const valueInput = target.closest('.config-item').querySelector('[data-field="value"]');
      if (valueInput) {
        valueInput.dataset.capture = keyCaptureActions.includes(target.value) ? 'true' : '';
        valueInput.placeholder = keyCaptureActions.includes(target.value) ? 'Press key combination...' : 'Value';
      }
    }
  } else if (target.dataset.layerIndex !== undefined) {
    const index = parseInt(target.dataset.layerIndex);
    state.layerKeys[index][field] = target.type === 'number' ? parseInt(target.value) : target.value;
    if (field === 'label') renderLayerKeys();
  } else if (target.dataset.knobIndex !== undefined) {
    const index = parseInt(target.dataset.knobIndex);
    state.knobs[index][field] = target.type === 'number' ? parseFloat(target.value) : target.value;
    if (field === 'label') renderKnobs();
    if (field === 'min' || field === 'max' || field === 'step') renderKnobs();
  }
}

function handleConfigFocus(e) {
  const target = e.target;
  if (target.dataset.field === 'value' && target.dataset.capture === 'true') {
    startKeyCapture(target, parseInt(target.dataset.keyIndex), 'value');
  }
}

function handleConfigBlur(e) {
  const target = e.target;
  if (target.dataset.field === 'value' && target.dataset.capture === 'true') {
    if (state.keyCapture.targetInput === target) {
      stopKeyCapture();
    }
  }
}

function startKeyCapture(input, keyIndex, field) {
  if (state.keyCapture.active) return;
  
  state.keyCapture = {
    active: true,
    targetInput: input,
    targetKeyIndex: keyIndex,
    targetField: field,
    keysPressed: new Set()
  };
  
  input.classList.add('listening');
  input.placeholder = 'Listening...';
  input.value = '';
}

function stopKeyCapture() {
  if (state.keyCapture.active && state.keyCapture.targetInput) {
    state.keyCapture.targetInput.classList.remove('listening');
    state.keyCapture.targetInput.placeholder = 'Press key combination...';
  }
  state.keyCapture = { active: false, targetInput: null, targetKeyIndex: null, targetField: null, keysPressed: new Set() };
}

function handleGlobalKeydown(e) {
  if (e.key === 'Escape') {
    if (state.keyCapture.active) {
      stopKeyCapture();
    } else {
      closeConfig();
    }
    return;
  }
  
  if (!state.keyCapture.active) return;
  
  e.preventDefault();
  
  const key = formatKey(e);
  state.keyCapture.keysPressed.add(key);
  
  const combination = formatKeyCombination(state.keyCapture.keysPressed);
  state.keyCapture.targetInput.value = combination;
  
  state.customKeys[state.currentLayer][state.keyCapture.targetKeyIndex][state.keyCapture.targetField] = combination;
}

function handleGlobalKeyup(e) {
  if (!state.keyCapture.active) return;
  
  const key = formatKey(e);
  state.keyCapture.keysPressed.delete(key);
}

function formatKey(e) {
  const parts = [];
  
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.metaKey) parts.push('Cmd');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  
  let key = e.key;
  
  if (key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift') {
    return null;
  }
  
  if (key === ' ') key = 'Space';
  else if (key === 'Escape') key = 'Esc';
  else if (key === 'ArrowUp') key = 'Up';
  else if (key === 'ArrowDown') key = 'Down';
  else if (key === 'ArrowLeft') key = 'Left';
  else if (key === 'ArrowRight') key = 'Right';
  else if (key.length === 1) key = key.toUpperCase();
  else key = key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
  
  parts.push(key);
  return parts.join('+');
}

function formatKeyCombination(keysPressed) {
  if (keysPressed.size === 0) return '';
  
  const allParts = new Set();
  keysPressed.forEach(combo => {
    combo.split('+').forEach(part => allParts.add(part));
  });
  
  const order = ['Ctrl', 'Cmd', 'Alt', 'Shift'];
  const sorted = [...allParts].sort((a, b) => {
    const aIndex = order.indexOf(a);
    const bIndex = order.indexOf(b);
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return a.localeCompare(b);
  });
  
  return sorted.join(' + ');
}

function saveState() {
  localStorage.setItem('macropad-state', JSON.stringify(state));
}

function loadState() {
  const saved = localStorage.getItem('macropad-state');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      Object.assign(state, parsed);
      renderCustomKeys();
      renderLayerKeys();
      renderKnobs();
    } catch (e) {
      console.error('Failed to load state:', e);
    }
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', init);
document.addEventListener('keyup', handleGlobalKeyup);