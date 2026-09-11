const FRONT_IMAGE = new URL('../../assets/peter_novak_front_52_v6.png', import.meta.url).href;

export const ECG_ELECTRODES = Object.freeze([
  electrode('RA', 'Right arm', 'Limb electrode', 26.0, 52.0, 5.5, 'Place on the right upper limb near the wrist or distal forearm.', '#d63b3b', 'Red', 7),
  electrode('LA', 'Left arm', 'Limb electrode', 74.0, 52.0, 5.5, 'Place on the left upper limb near the wrist or distal forearm.', '#d6c62e', 'Yellow', -7),
  electrode('RL', 'Right leg', 'Limb electrode', 39.2, 88.0, 5.5, 'Place on the right lower limb near the ankle.', '#2fa84f', 'Green', 2),
  electrode('LL', 'Left leg', 'Limb electrode', 60.8, 88.0, 5.5, 'Place on the left lower limb near the ankle.', '#222b38', 'Black', -2),
  electrode('V1', 'V1', 'Precordial', 48.3, 28.0, 3.2, '4th intercostal space, right sternal border.', '#cc6c1d', 'Orange', 0),
  electrode('V2', 'V2', 'Precordial', 51.8, 28.0, 3.2, '4th intercostal space, left sternal border.', '#d6c62e', 'Yellow', 0),
  electrode('V3', 'V3', 'Precordial', 54.0, 29.6, 3.2, 'Halfway between V2 and V4.', '#2fa84f', 'Green', 0),
  electrode('V4', 'V4', 'Precordial', 57.0, 31.4, 3.2, '5th intercostal space, left midclavicular line.', '#5b3a22', 'Brown', 0),
  electrode('V5', 'V5', 'Precordial', 60.6, 31.4, 3.4, 'Same horizontal level as V4, left anterior axillary line.', '#1d1f24', 'Black', 0),
  electrode('V6', 'V6', 'Precordial', 64.0, 31.4, 3.5, 'Same horizontal level as V4, left midaxillary line.', '#6d42b9', 'Purple', 0)
]);

export function createEcgLeadPlacementState() {
  return { selected: null, placed: {}, attempts: 0, completed: false, lastFeedback: '', lastIncorrect: false };
}

export function renderEcgLeadPlacement({ container, state, mode = 'practice', onComplete, onViewEcg }) {
  if (!container || !state) return;
  const placedCount = Object.keys(state.placed || {}).length;
  state.completed = placedCount === ECG_ELECTRODES.length;
  const selected = ECG_ELECTRODES.find((item) => item.id === state.selected) || null;
  container.innerHTML = `
    <div class="ecg-placement-shell ${state.completed ? 'is-complete' : ''}">
      <div class="ecg-placement-intro">
        <div><span>12-lead ECG acquisition</span><strong>${state.completed ? 'Electrodes correctly placed' : 'Drag all 10 leads onto the patient before the tracing is available'}</strong></div>
        <div class="ecg-placement-progress"><b>${placedCount}/10</b><i><em style="width:${placedCount * 10}%"></em></i></div>
      </div>
      <div class="ecg-game-grid">
        <aside class="ecg-electrode-tray">
          <div class="ecg-tray-section"><span>Limb leads</span>${renderElectrodeGroup(ECG_ELECTRODES.filter(x => x.group === 'Limb electrode'), state)}</div>
          <div class="ecg-tray-section"><span>Chest leads</span>${renderElectrodeGroup(ECG_ELECTRODES.filter(x => x.group === 'Precordial'), state)}</div>
          <div class="ecg-placement-help">
            <strong>${selected ? selectedSummary(selected) : 'Choose or drag a lead'}</strong>
            <p>${selected ? selectedInstruction(selected, mode) : 'Use the coloured lead tiles below. Drag a lead image onto Peter or click a lead and then click the patient.'}</p>
          </div>
          <button type="button" class="secondary compact" data-ecg-reset ${placedCount ? '' : 'disabled'}>Reset placement</button>
        </aside>
        <section class="ecg-patient-stage">
          <div class="ecg-photo-wrap" data-ecg-body>
            <img src="${escapeHtml(FRONT_IMAGE)}" alt="Peter Novak for 12-lead ECG electrode placement" draggable="false" />
            ${ECG_ELECTRODES.filter(e => state.placed[e.id]).map(renderPlacedMarker).join('')}
          </div>
          <div class="ecg-game-feedback ${state.lastIncorrect ? 'incorrect' : ''}" aria-live="polite">${escapeHtml(state.lastFeedback || (state.completed ? 'All electrodes are correctly placed.' : 'The ECG remains locked until all electrodes are correctly positioned.'))}</div>
        </section>
      </div>
      ${state.completed ? `<div class="ecg-complete-row"><span>✓ Correct setup. The 12-lead tracing can now be acquired.</span><button type="button" data-view-acquired-ecg>View ECG</button></div>` : ''}
    </div>`;

  container.querySelectorAll('[data-ecg-electrode]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      state.selected = button.dataset.ecgElectrode;
      state.lastFeedback = '';
      state.lastIncorrect = false;
      renderEcgLeadPlacement({ container, state, mode, onComplete, onViewEcg });
    });
    button.addEventListener('dragstart', (event) => {
      state.selected = button.dataset.ecgElectrode;
      event.dataTransfer?.setData('text/plain', state.selected);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
  });
  const body = container.querySelector('[data-ecg-body]');
  body?.addEventListener('click', (event) => attemptPlacement(event, body, state, mode, container, onComplete, onViewEcg));
  body?.addEventListener('dragover', (event) => event.preventDefault());
  body?.addEventListener('drop', (event) => {
    event.preventDefault();
    const id = event.dataTransfer?.getData('text/plain');
    if (id) state.selected = id;
    attemptPlacement(event, body, state, mode, container, onComplete, onViewEcg);
  });
  container.querySelector('[data-ecg-reset]')?.addEventListener('click', () => {
    Object.assign(state, createEcgLeadPlacementState());
    renderEcgLeadPlacement({ container, state, mode, onComplete, onViewEcg });
  });
  container.querySelector('[data-view-acquired-ecg]')?.addEventListener('click', () => onViewEcg?.());
}

function attemptPlacement(event, body, state, mode, container, onComplete, onViewEcg) {
  if (!state.selected || state.placed[state.selected]) return;
  const electrode = ECG_ELECTRODES.find((item) => item.id === state.selected);
  if (!electrode) return;
  const rect = body.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;
  const dx = x - electrode.x;
  const dy = y - electrode.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  state.attempts += 1;
  if (distance <= electrode.tolerance) {
    state.placed[electrode.id] = { x: electrode.x, y: electrode.y };
    state.lastFeedback = `${placedLabel(electrode)} placed correctly.`;
    state.lastIncorrect = false;
    state.selected = null;
    const wasComplete = state.completed;
    state.completed = Object.keys(state.placed).length === ECG_ELECTRODES.length;
    renderEcgLeadPlacement({ container, state, mode, onComplete, onViewEcg });
    if (state.completed && !wasComplete) onComplete?.(state);
    return;
  }

  const nearest = findNearestElectrode(x, y, electrode.group);
  state.lastIncorrect = true;
  state.lastFeedback = buildIncorrectFeedback({ selected: electrode, nearest, distance, mode });
  renderEcgLeadPlacement({ container, state, mode, onComplete, onViewEcg });
}

function buildIncorrectFeedback({ selected, nearest, distance, mode }) {
  const tryAgain = 'Please try again.';
  if (selected.group === 'Limb electrode') {
    if (nearest && nearest.id !== selected.id) {
      return `The ${selected.colorName.toLowerCase()} limb lead does not belong here. This area corresponds to the ${nearest.colorName.toLowerCase()} limb lead. ${tryAgain}`;
    }
    return `The ${selected.colorName.toLowerCase()} limb lead is misplaced. ${mode === 'exam' ? '' : selected.hint + ' '} ${tryAgain}`.trim();
  }
  if (nearest && nearest.id !== selected.id && nearest.group === 'Precordial') {
    return `${selected.id} is closer to the ${nearest.id} position than to its own landmark. ${mode === 'exam' ? '' : selected.hint + ' '} ${tryAgain}`.trim();
  }
  if (distance > selected.tolerance * 2.35) {
    return `${selected.id} is very misplaced on the chest. ${mode === 'exam' ? '' : selected.hint + ' '} ${tryAgain}`.trim();
  }
  return `${selected.id}: not quite. ${mode === 'exam' ? '' : selected.hint + ' '} ${tryAgain}`.trim();
}

function findNearestElectrode(x, y, group) {
  const candidates = ECG_ELECTRODES.filter((item) => item.group === group);
  let best = null;
  let bestDistance = Infinity;
  for (const item of candidates) {
    const dx = x - item.x;
    const dy = y - item.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = item;
    }
  }
  return best;
}

function renderElectrodeGroup(items, state) {
  return `<div class="ecg-electrode-list">${items.map((item) => {
    const placed = Boolean(state.placed[item.id]);
    const selected = state.selected === item.id;
    const primary = item.group === 'Limb electrode' ? item.colorName : item.id;
    const secondary = item.group === 'Limb electrode' ? 'Limb lead' : 'Chest lead';
    return `<button type="button" draggable="${placed ? 'false' : 'true'}" class="ecg-electrode-chip ${selected ? 'selected' : ''} ${placed ? 'placed' : ''}" data-ecg-electrode="${item.id}" ${placed ? 'disabled' : ''}>${renderLeadIllustration(item)}<span class="ecg-chip-text"><b>${escapeHtml(primary)}</b><small>${escapeHtml(secondary)}</small></span>${placed ? '<span class="ecg-check">✓</span>' : ''}</button>`;
  }).join('')}</div>`;
}

function renderLeadIllustration(item) {
  const textFill = contrastText(item.color);
  if (item.group === 'Limb electrode') {
    return `<svg class="ecg-lead-art ecg-clip-art" viewBox="0 0 88 52" aria-hidden="true">
      <path class="ecg-wire" d="M2 8 C18 8 22 13 28 20 S42 30 52 30" />
      <rect x="2" y="3" width="22" height="10" rx="5" fill="${item.color}" stroke="#40586d" stroke-width="1.2" />
      <g transform="translate(45 16) rotate(-8)">
        <path d="M3 6 Q15 -2 31 5 L35 12 Q20 8 7 17 Z" fill="${item.color}" stroke="#40586d" stroke-width="1.4"/>
        <path d="M7 17 Q20 10 35 13 L31 21 Q17 24 3 18 Z" fill="${item.color}" stroke="#40586d" stroke-width="1.4"/>
        <circle cx="6" cy="12" r="3.5" fill="#e8eef3" stroke="#60788a" stroke-width="1"/>
        <path d="M31 5 L39 0 L42 4 L35 12" fill="#d6dde3" stroke="#60788a" stroke-width="1"/>
      </g>
    </svg>`;
  }
  const chipText = item.id.replace('V', '');
  return `<svg class="ecg-lead-art" viewBox="0 0 88 52" aria-hidden="true">
    <path class="ecg-wire" d="M3 8 C18 8 22 14 27 21 S39 35 53 35" />
    <rect x="2" y="3" width="20" height="10" rx="5" fill="${item.color}" stroke="#40586d" stroke-width="1.2" />
    <circle cx="60" cy="35" r="13" fill="#f8fbfd" stroke="#8ea8bc" stroke-width="1.6" />
    <circle cx="60" cy="35" r="7.2" fill="${item.color}" opacity="0.92" />
    <rect x="27" y="18" width="17" height="7" rx="3.5" fill="${item.color}" stroke="#40586d" stroke-width="1.1" />
    <text x="12" y="11.2" text-anchor="middle" font-size="6.8" font-weight="800" fill="${textFill}">${chipText}</text>
  </svg>`;
}

function renderPlacedMarker(item) {
  const textFill = contrastText(item.color);
  const isLimb = item.group === 'Limb electrode';
  const markerText = isLimb ? '' : item.id.replace('V', '');
  const extraClass = isLimb ? ' limb' : ' chest';
  const title = isLimb ? `${item.colorName} limb clip` : item.id;
  const content = isLimb
    ? '<span class="limb-clip-jaw limb-clip-jaw-a"></span><span class="limb-clip-jaw limb-clip-jaw-b"></span><span class="limb-clip-pin"></span>'
    : escapeHtml(markerText);
  return `<span class="ecg-electrode-marker${extraClass}" style="left:${item.x}%;top:${item.y}%;--lead-color:${item.color};--lead-text:${textFill};--lead-rotation:${item.rotation || 0}deg" data-electrode-marker="${item.id}" title="${escapeHtml(title)}">${content}</span>`;
}

function selectedSummary(item) {
  return item.group === 'Limb electrode' ? `Selected: ${item.colorName} lead` : `Selected: ${item.id}`;
}

function selectedInstruction(item, mode) {
  if (mode === 'exam') return item.group === 'Limb electrode' ? 'Drag it to the correct limb position.' : `${item.id}: drag it to the correct anatomical position.`;
  return item.group === 'Limb electrode' ? `Drag the ${item.colorName.toLowerCase()} lead to the correct limb position.` : item.hint;
}

function placedLabel(item) {
  return item.group === 'Limb electrode' ? `${item.colorName} limb lead` : item.id;
}

function electrode(id, label, group, x, y, tolerance, hint, color, colorName, rotation = 0) { return { id, label, group, x, y, tolerance, hint, color, colorName, rotation }; }
function contrastText(color) {
  const hex = String(color || '').replace('#', '');
  if (hex.length !== 6) return '#ffffff';
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
  return luminance > 165 ? '#1f2937' : '#ffffff';
}
function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
