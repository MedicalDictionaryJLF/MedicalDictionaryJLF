import { performExamination } from '../clinicalEncounter.js';
import { getPhysicalExamMap, PHYSICAL_EXAM_TOOLS } from '../data/physicalExamMap.js';
import { getExamSound } from '../data/examSoundLibrary.js';

let currentRecording = null;
let activeAudioContext = null;

export const PATIENT_VIEW_ASSETS = Object.freeze({
  front: new URL('../../assets/peter_novak_front.png', import.meta.url).href,
  back: new URL('../../assets/peter_novak_back.png', import.meta.url).href
});

export function getPatientViewAsset(view = 'front') {
  return PATIENT_VIEW_ASSETS[view === 'back' ? 'back' : 'front'];
}

export function renderInteractivePhysicalExam({ container, patientCase, encounterState, mode, onPerformed }) {
  if (!container) return;
  ensureExamState(encounterState);
  const examMap = getPhysicalExamMap(patientCase);
  const ui = encounterState.physicalExamUi;
  const hotspots = examMap.hotspots.filter((point) => point.view === ui.view && point.tools.includes(ui.tool));
  const selectedPoint = examMap.hotspots.find((point) => point.id === ui.selectedHotspot) || null;
  const selectedResult = selectedPoint?.results?.[ui.lastTechnique] || selectedPoint?.results?.[ui.tool] || null;
  const interactionKeys = new Set(encounterState.examInteractions.map((item) => `${item.technique}:${item.hotspotId}`));
  const scene = buildExamSceneProfile(patientCase, encounterState, ui);

  container.innerHTML = `
    <div class="interactive-exam-shell" data-exam-tool="${escapeHtml(ui.tool)}" data-exam-view="${escapeHtml(ui.view)}" data-bedside-setup="${escapeHtml(ui.setup)}">
      <aside class="exam-tool-tray" aria-label="Physical examination technique">
        <div class="exam-tray-heading">
          <span>Technique</span>
          <strong>Choose how you examine</strong>
        </div>
        <div class="exam-tool-list">
          ${PHYSICAL_EXAM_TOOLS.map((tool) => `
            <button type="button" class="exam-tool-button ${ui.tool === tool.id ? 'active' : ''}" data-exam-tool-select="${tool.id}" aria-pressed="${ui.tool === tool.id}">
              <span class="exam-tool-icon">${toolIcon(tool.icon)}</span>
              <span><strong>${escapeHtml(tool.label)}</strong><small>${escapeHtml(tool.description)}</small></span>
            </button>
          `).join('')}
        </div>
        <div class="exam-technique-note">
          <span class="technique-dot"></span>
          <p>${escapeHtml(toolHelp(ui.tool))}</p>
        </div>
        ${mode === 'exam' ? '<p class="exam-mode-note">Exam mode: anatomical point labels appear only on hover/focus. Findings remain hidden until you examine the patient.</p>' : '<p class="exam-mode-note">Practice build: hover a point to see its anatomical target. No correctness hint is shown before placement.</p>'}
      </aside>

      <section class="exam-avatar-workbench">
        <div class="exam-workbench-toolbar">
          <div class="exam-toolbar-primary">
            <div class="exam-view-switch" role="group" aria-label="Patient view">
              <button type="button" class="${ui.view === 'front' ? 'active' : ''}" data-exam-view="front" aria-pressed="${ui.view === 'front'}">Anterior</button>
              <button type="button" class="${ui.view === 'back' ? 'active' : ''}" data-exam-view="back" aria-pressed="${ui.view === 'back'}">Posterior</button>
            </div>
            <div class="exam-setup-switch" role="group" aria-label="Bedside setup">
              ${['none','ecg','monitor'].map((setup) => `<button type="button" class="${ui.setup === setup ? 'active' : ''}" data-exam-setup="${setup}" aria-pressed="${ui.setup === setup}">${setup === 'none' ? 'No hookups' : setup === 'ecg' ? 'ECG attached' : 'Monitor attached'}</button>`).join('')}
            </div>
          </div>
          <div class="exam-workbench-status">
            <span>${escapeHtml(PHYSICAL_EXAM_TOOLS.find((tool) => tool.id === ui.tool)?.label || 'Examine')}</span>
            <strong>${hotspots.length} available points</strong><small class="posterior-ready-status" data-posterior-ready>${escapeHtml(scene.supportStatus)}</small>
          </div>
        </div>

        <div class="exam-avatar-room ${scene.distressed ? 'patient-distressed' : ''} ${scene.diaphoresis ? 'patient-diaphoretic' : ''}" data-emergency-scene="${escapeHtml(scene.kind)}">
          <div class="exam-room-label"><span>Emergency room examination</span><small>${ui.view === 'front' ? 'Anterior view' : 'Posterior view'}</small></div>
          <div class="exam-distress-badges">${scene.badges.map((badge) => `<span>${escapeHtml(badge)}</span>`).join('')}</div>
          <div class="exam-scene-wall-monitor ${ui.setup === 'monitor' ? 'visible' : ''}" aria-hidden="${ui.setup === 'monitor' ? 'false' : 'true'}">${buildMiniMonitor(scene)}</div>
          <div class="exam-bed-frame" aria-hidden="true">
            <div class="exam-bed-headboard"></div>
            <div class="exam-bed-mattress"></div>
            <div class="exam-bed-pillow"></div>
            <div class="exam-bed-sheet"></div>
            <div class="exam-bed-rail left"></div>
            <div class="exam-bed-rail right"></div>
          </div>
          <div id="interactiveExamAvatar" class="interactive-exam-avatar ${ui.view === 'front' ? 'realistic-front' : 'realistic-back'} ${scene.distressed ? 'distressed-pose' : ''}" tabindex="0" aria-label="Interactive patient body map. Select an examination technique and then choose a body point.">
            ${buildRealisticPatientImages(ui.view, scene, ui.setup)}
            ${buildHookupOverlay(ui.view, ui.setup)}
            <div class="exam-hotspot-layer">
              ${hotspots.map((point) => {
                const key = `${ui.tool}:${point.id}`;
                const completed = interactionKeys.has(key);
                const selected = ui.selectedHotspot === point.id && ui.lastTechnique === ui.tool;
                const position = pointPosition(point, ui.tool);
                return `
                  <button type="button"
                    class="exam-hotspot ${completed ? 'completed' : ''} ${selected ? 'selected' : ''}"
                    style="left:${position.x}%;top:${position.y}%"
                    data-exam-hotspot="${escapeHtml(point.id)}"
                    aria-label="${escapeHtml(`${PHYSICAL_EXAM_TOOLS.find((tool) => tool.id === ui.tool)?.label || 'Examine'}: ${point.label}`)}">
                    <span class="hotspot-ring"></span>
                    <span class="hotspot-label"><b>${escapeHtml(point.label)}</b><small>${escapeHtml(point.region || '')}</small></span>
                  </button>
                `;
              }).join('')}
            </div>
            <div id="examInstrumentCursor" class="exam-instrument-cursor" aria-hidden="true">${toolIcon(toolCursorIcon(ui.tool))}</div>
            ${selectedPoint && ui.lastTechnique ? (() => { const position = pointPosition(selectedPoint, ui.lastTechnique); return `<div class="exam-placed-instrument" style="left:${position.x}%;top:${position.y}%" aria-hidden="true">${toolIcon(toolCursorIcon(ui.lastTechnique))}</div>`; })() : ''}
          </div>
          <div class="exam-response-strip">
            <div class="exam-response-avatar">Pt</div>
            <div class="exam-response-copy">
              <strong>${escapeHtml(scene.responseTitle)}</strong>
              <p>${escapeHtml(scene.responseLine)}</p>
            </div>
            <div class="exam-response-pulse"><span></span><span></span><span></span></div>
          </div>
          <div class="exam-body-instructions">
            <span class="instruction-index">${toolIcon(toolCursorIcon(ui.tool))}</span>
            <p><strong>${escapeHtml(PHYSICAL_EXAM_TOOLS.find((tool) => tool.id === ui.tool)?.short || 'Examine')}</strong> · Select one of the available points on the patient. Compare both sides where appropriate.</p>
          </div>
        </div>
      </section>


      <aside class="exam-findings-rail exam-findings-rail-compact">
        <section class="exam-observation-log exam-observation-log-only">
          <div class="finding-heading"><span>Physical examination findings</span><strong>${encounterState.examInteractions.length} site interactions</strong></div>
          <div class="exam-observation-list">
            ${encounterState.examInteractions.length ? encounterState.examInteractions.slice().reverse().slice(0, 16).map((item, index) => `
              <article class="${index === 0 ? 'latest-observation' : ''}">
                <div class="observation-title-row">
                  <span class="observation-technique">${escapeHtml(labelForTool(item.technique))}</span>
                  ${index === 0 ? '<span class="latest-observation-badge">Latest</span>' : ''}
                </div>
                <strong>${escapeHtml(item.label)}</strong>
                <p>${escapeHtml(item.finding)}</p>
                ${item.soundId ? `<button type="button" class="secondary compact observation-sound-button" data-replay-log-sound="${escapeHtml(item.soundId)}">▶ Play sound</button>` : ''}
              </article>
            `).join('') : '<div class="exam-empty-log exam-empty-log-compact">No physical findings obtained yet. Select a technique and examine the patient.</div>'}
          </div>
        </section>
      </aside>
    </div>
  `;

  container.querySelectorAll('[data-exam-tool-select]').forEach((button) => {
    button.addEventListener('click', () => {
      ui.tool = button.dataset.examToolSelect;
      ui.selectedHotspot = null;
      ui.lastTechnique = null;
      stopExamAudio();
      renderInteractivePhysicalExam({ container, patientCase, encounterState, mode, onPerformed });
    });
  });

  container.querySelectorAll('[data-exam-setup]').forEach((button) => {
    button.addEventListener('click', () => {
      ui.setup = button.dataset.examSetup || 'none';
      renderInteractivePhysicalExam({ container, patientCase, encounterState, mode, onPerformed });
    });
  });

  container.querySelectorAll('[data-exam-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextView = button.dataset.examView === 'back' ? 'back' : 'front';
      ui.view = nextView;
      ui.selectedHotspot = null;
      ui.lastTechnique = null;
      stopExamAudio();

      // Switch the photograph immediately before the full panel redraw.
      // This prevents a failed redraw from leaving the old patient view visible.
      applyPatientViewImmediately(container, nextView);
      renderInteractivePhysicalExam({ container, patientCase, encounterState, mode, onPerformed });
    });
  });

  container.querySelectorAll('[data-exam-hotspot]').forEach((button) => {
    button.addEventListener('click', async () => {
      const point = examMap.hotspots.find((item) => item.id === button.dataset.examHotspot);
      const detail = point?.results?.[ui.tool];
      if (!point || !detail) return;
      ui.selectedHotspot = point.id;
      ui.lastTechnique = ui.tool;

      const key = `${ui.tool}:${point.id}`;
      const existing = encounterState.examInteractions.find((item) => `${item.technique}:${item.hotspotId}` === key);
      if (!existing) {
        encounterState.examInteractions.push({
          technique: ui.tool,
          hotspotId: point.id,
          label: detail.noteLabel || point.label,
          region: point.region,
          finding: detail.finding,
          soundId: detail.soundId || null,
          at: new Date().toISOString()
        });
      }

      let broad = null;
      if (detail.examActionId) broad = performExamination(patientCase, encounterState, detail.examActionId);
      const result = {
        ok: true,
        action: broad?.action || { id: detail.examActionId || point.id, label: detail.noteLabel || point.label },
        finding: detail.finding,
        detailedFinding: detail,
        hotspot: point,
        technique: ui.tool,
        repeated: Boolean(existing)
      };
      onPerformed?.(result);
      renderInteractivePhysicalExam({ container, patientCase, encounterState, mode, onPerformed });
      if (detail.soundId) await playExamSound(detail.soundId, container);
    });
  });

  container.querySelector('[data-replay-exam-sound]')?.addEventListener('click', async () => {
    if (selectedResult?.soundId) await playExamSound(selectedResult.soundId, container);
  });
  container.querySelectorAll('[data-replay-log-sound]').forEach((button) => button.addEventListener('click', async () => {
    const soundId = button.dataset.replayLogSound;
    if (soundId) await playExamSound(soundId, container);
  }));

  bindInstrumentCursor(container, ui.tool);
}

function applyPatientViewImmediately(container, view) {
  const activeView = view === 'back' ? 'back' : 'front';
  const shell = container.querySelector('.interactive-exam-shell');
  if (shell) shell.dataset.examView = activeView;

  container.querySelectorAll('[data-exam-setup]').forEach((button) => {
    button.addEventListener('click', () => {
      ui.setup = button.dataset.examSetup || 'none';
      renderInteractivePhysicalExam({ container, patientCase, encounterState, mode, onPerformed });
    });
  });

  container.querySelectorAll('[data-exam-view]').forEach((button) => {
    const active = button.dataset.examView === activeView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  const avatar = container.querySelector('#interactiveExamAvatar');
  if (avatar) {
    avatar.classList.toggle('realistic-front', activeView === 'front');
    avatar.classList.toggle('realistic-back', activeView === 'back');
  }

  container.querySelectorAll('[data-patient-view-image]').forEach((image) => {
    const active = image.dataset.patientViewImage === activeView;
    image.classList.toggle('active', active);
    image.setAttribute('aria-hidden', active ? 'false' : 'true');
  });

  const label = container.querySelector('.exam-room-label small');
  if (label) label.textContent = activeView === 'front' ? 'Anterior view' : 'Posterior view';
}

export function stopExamAudio() {
  try {
    if (currentRecording) {
      currentRecording.pause();
      currentRecording.currentTime = 0;
      currentRecording = null;
    }
  } catch {}
  try {
    if (activeAudioContext && activeAudioContext.state !== 'closed') activeAudioContext.close();
  } catch {}
  activeAudioContext = null;
}

async function playExamSound(soundId, container) {
  stopExamAudio();
  const sound = getExamSound(soundId);
  const status = container?.querySelector('[data-exam-audio-status]');
  if (!sound) return;
  if (status) status.textContent = 'Playing…';
  try {
    if (sound.url) {
      const audio = new Audio(sound.url);
      audio.preload = 'auto';
      audio.volume = .82;
      currentRecording = audio;
      audio.addEventListener('ended', () => { if (status) status.textContent = 'Playback finished'; currentRecording = null; }, { once: true });
      audio.addEventListener('error', () => { if (status) status.textContent = 'Recording could not be loaded. Check internet access.'; }, { once: true });
      await audio.play();
      return;
    }
    if (sound.kind === 'synth-breath') await synthBreath();
    if (sound.kind === 'synth-bowel') await synthBowel();
    if (sound.kind === 'synth-percussion') await synthPercussion(sound.percussionProfile || 'resonant');
    if (status) status.textContent = 'Simulated sound played';
  } catch (error) {
    if (status) status.textContent = `Audio unavailable: ${error?.message || 'playback failed'}`;
  }
}

function renderFinding(detail) {
  const sound = detail.soundId ? getExamSound(detail.soundId) : null;
  return `
    <div class="finding-result-body">
      <p>${escapeHtml(detail.finding)}</p>
      ${detail.soundNote ? `<div class="finding-sound-note">${escapeHtml(detail.soundNote)}</div>` : ''}
      ${sound ? `
        <div class="exam-sound-card ${soundCardClass(sound)}">
          <div><span>${soundKindLabel(sound)}</span><strong>${escapeHtml(sound.label)}</strong></div>
          <button type="button" class="secondary compact" data-replay-exam-sound>Play again</button>
          <p>${escapeHtml(sound.description || '')}</p>
          <small data-exam-audio-status>${soundAudioMeta(sound)}</small>
          ${sound.sourcePage ? `<a href="${escapeHtml(sound.sourcePage)}" target="_blank" rel="noreferrer">Source / license</a>` : ''}
        </div>
      ` : ''}
    </div>
  `;
}


function soundKindLabel(sound) {
  if (sound?.kind === 'recording') return 'Recorded clinical audio';
  if (sound?.kind === 'published-simulation') return 'Published reference simulation';
  return 'Simulated educational audio';
}

function pointPosition(point, technique) {
  const specific = point?.positions?.[technique];
  if (specific && Number.isFinite(specific.x) && Number.isFinite(specific.y)) return specific;
  return { x: point?.x ?? 50, y: point?.y ?? 50 };
}

function soundCardClass(sound) {
  if (sound?.kind === 'recording') return 'recorded';
  if (sound?.kind === 'published-simulation') return 'reference-simulation';
  return 'simulated';
}

function soundAudioMeta(sound) {
  if (sound?.url) return `${escapeHtml(sound.author || '')} · ${escapeHtml(sound.license || '')}`;
  return 'Generated locally with Web Audio';
}

function ensureExamState(encounterState) {
  if (!Array.isArray(encounterState.examInteractions)) encounterState.examInteractions = [];
  if (!encounterState.physicalExamUi) encounterState.physicalExamUi = { tool: 'inspect', view: 'front', selectedHotspot: null, lastTechnique: null, setup: 'monitor' };
  if (!encounterState.physicalExamUi.setup) encounterState.physicalExamUi.setup = 'monitor';
}

function bindInstrumentCursor(container, tool) {
  const avatar = container.querySelector('#interactiveExamAvatar');
  const cursor = container.querySelector('#examInstrumentCursor');
  if (!avatar || !cursor) return;
  avatar.addEventListener('pointermove', (event) => {
    const rect = avatar.getBoundingClientRect();
    cursor.style.left = `${event.clientX - rect.left}px`;
    cursor.style.top = `${event.clientY - rect.top}px`;
    cursor.classList.add('visible');
  });
  avatar.addEventListener('pointerleave', () => cursor.classList.remove('visible'));
  avatar.dataset.cursorTool = tool;
}

function buildRealisticPatientImages(view = 'front', scene = {}, setup = 'none') {
  const activeView = view === 'back' ? 'back' : 'front';
  const distressedClass = scene.distressed ? ' distress-visible' : '';
  const sweatyClass = scene.diaphoresis ? ' sweating-visible' : '';
  const supportClass = setup !== 'none' ? ' setup-visible' : '';
  return `
    <div class="exam-patient-shell ${distressedClass}${sweatyClass}${supportClass}">
      <img
        class="exam-patient-photo patient-view-photo ${activeView === 'front' ? 'active' : ''}"
        data-patient-view-image="front"
        src="${escapeHtml(PATIENT_VIEW_ASSETS.front)}"
        alt="Anterior view of Peter Novak for physical examination"
        draggable="false"
        aria-hidden="${activeView === 'front' ? 'false' : 'true'}" />
      <img
        class="exam-patient-photo patient-view-photo ${activeView === 'back' ? 'active' : ''}"
        data-patient-view-image="back"
        src="${escapeHtml(PATIENT_VIEW_ASSETS.back)}"
        alt="Posterior view of Peter Novak for physical examination"
        draggable="false"
        aria-hidden="${activeView === 'back' ? 'false' : 'true'}" />
      <div class="exam-patient-sweat" aria-hidden="true"></div>
      <div class="exam-patient-pain-flush" aria-hidden="true"></div>
      <div class="exam-patient-breath-haze" aria-hidden="true"></div>
    </div>
  `;
}



function buildExamSceneProfile(patientCase, encounterState, ui) {
  const interactions = encounterState?.examInteractions || [];
  const recentTool = PHYSICAL_EXAM_TOOLS.find((tool) => tool.id === ui.tool)?.label || 'Physical exam';
  const isChestPain = patientCase?.caseType === 'chestPainACS' || /stemi|acute chest pressure|chest pain/i.test(`${patientCase?.title || ''} ${patientCase?.visibleLabel || ''} ${patientCase?.hiddenDiagnosis || ''}`);
  const hasPainInteraction = interactions.some((item) => /tender|pain|stern/i.test(`${item.label} ${item.finding}`));
  const distressed = isChestPain || hasPainInteraction;
  const diaphoresis = isChestPain || /sweat/i.test(JSON.stringify(patientCase?.symptoms || {}));
  const badges = distressed ? ['Distressed', 'Chest pain', diaphoresis ? 'Diaphoretic' : 'Anxious', 'Responding'] : ['Cooperative', 'Awake', 'Responding'];
  const responseLine = distressed
    ? (ui.tool === 'palpate' ? 'He winces and says the pressure is still there. He answers in short, uncomfortable phrases.' : ui.tool === 'auscultate' ? 'He remains anxious, breathing unevenly, and responds between shallow breaths.' : 'He looks uncomfortable, sweaty, and keeps acknowledging the chest pressure when spoken to.')
    : 'He follows instructions and answers appropriately during the examination.';
  const responseTitle = distressed ? 'Peter grimaces and responds.' : 'Peter responds appropriately.';
  return {
    kind: distressed ? 'distress' : 'stable',
    distressed,
    diaphoresis,
    supportStatus: ui.setup === 'monitor' ? 'Monitor + ECG visible' : ui.setup === 'ecg' ? 'ECG attached' : 'Bedside exam scene active',
    badges,
    responseLine,
    responseTitle
  };
}

function buildHookupOverlay(view = 'front', setup = 'none') {
  if (setup === 'none') return '';
  const monitorMini = setup === 'monitor' ? '<div class="exam-inline-monitor-tag">Monitor connected</div>' : '<div class="exam-inline-monitor-tag">12‑lead hookup</div>';
  if (view === 'back') {
    return `
      <div class="exam-hookup-overlay back ${escapeHtml(setup)}" aria-hidden="true">
        ${monitorMini}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="exam-wire-svg">
          <path d="M32 38 C20 30, 12 24, 8 18" />
          <path d="M68 38 C80 30, 88 24, 92 18" />
          <path d="M44 52 C35 62, 30 72, 28 86" />
          <path d="M56 52 C65 62, 70 72, 72 86" />
        </svg>
        <span class="lead-node limb left-arm"></span>
        <span class="lead-node limb right-arm"></span>
        <span class="lead-node limb left-leg"></span>
        <span class="lead-node limb right-leg"></span>
      </div>`;
  }
  return `
    <div class="exam-hookup-overlay front ${escapeHtml(setup)}" aria-hidden="true">
      ${monitorMini}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="exam-wire-svg">
        <path d="M24 36 C18 26, 10 19, 8 16" />
        <path d="M76 36 C82 26, 90 19, 92 16" />
        <path d="M38 33 C34 28, 27 22, 16 18" />
        <path d="M46 30 C39 25, 31 20, 22 16" />
        <path d="M52 30 C58 24, 66 19, 76 16" />
        <path d="M60 33 C68 28, 77 22, 86 18" />
        <path d="M67 34 C75 30, 86 26, 95 24" />
        <path d="M28 82 C26 88, 24 93, 20 96" />
        <path d="M72 82 C74 88, 76 93, 80 96" />
      </svg>
      <span class="lead-node limb left-arm"></span>
      <span class="lead-node limb right-arm"></span>
      <span class="lead-node limb left-leg"></span>
      <span class="lead-node limb right-leg"></span>
      <span class="lead-node chest v1">1</span>
      <span class="lead-node chest v2">2</span>
      <span class="lead-node chest v3">3</span>
      <span class="lead-node chest v4">4</span>
      <span class="lead-node chest v5">5</span>
      <span class="lead-node chest v6">6</span>
    </div>`;
}

function buildMiniMonitor(scene) {
  return `
    <div class="scene-monitor-shell">
      <div class="scene-monitor-topline"><span>Lead II</span><span>ER bedside monitor</span></div>
      <div class="scene-monitor-grid">
        <div class="scene-monitor-wave ecg"><span class="wave-trace"></span></div>
        <div class="scene-monitor-wave pleth"><span class="wave-trace"></span></div>
        <div class="scene-monitor-wave resp"><span class="wave-trace"></span></div>
        <div class="scene-monitor-metrics">
          <div><label>HR</label><strong>96</strong></div>
          <div><label>SpO₂</label><strong>94%</strong></div>
          <div><label>BP</label><strong>154/96</strong></div>
          <div><label>RR</label><strong>24</strong></div>
        </div>
      </div>
      <div class="scene-monitor-alert">${escapeHtml(scene.distressed ? 'ST elevation visible in lead II · patient diaphoretic' : 'Patient monitored')}</div>
    </div>`;
}

function buildPatientSvg(view, visualOverlays = []) {
  const isFront = view === 'front';
  const pallor = visualOverlays.some((item) => item.view === view && item.className === 'visual-pallor');
  const diaphoresis = visualOverlays.some((item) => item.view === view && item.className === 'visual-diaphoresis');

  return `
  <svg class="exam-patient-svg ${isFront ? 'front-view' : 'back-view'}" viewBox="0 0 420 760" role="img" aria-label="${isFront ? 'Anterior' : 'Posterior'} full-body patient avatar">
    <defs>
      <linearGradient id="skinGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#efbea0"/>
        <stop offset=".48" stop-color="#dda07e"/>
        <stop offset="1" stop-color="#c47f63"/>
      </linearGradient>
      <linearGradient id="skinLight" x1="0" y1="0" x2=".25" y2="1">
        <stop offset="0" stop-color="#f5cfb6"/>
        <stop offset=".58" stop-color="#e2a581"/>
        <stop offset="1" stop-color="#ca8768"/>
      </linearGradient>
      <linearGradient id="skinArm" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#cf8969"/>
        <stop offset=".42" stop-color="#e4a783"/>
        <stop offset="1" stop-color="#f0bea0"/>
      </linearGradient>
      <linearGradient id="shortsGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#335e68"/>
        <stop offset="1" stop-color="#24464f"/>
      </linearGradient>
      <radialGradient id="faceLight" cx=".38" cy=".28" r=".78">
        <stop offset="0" stop-color="#f7d2b9"/>
        <stop offset=".62" stop-color="#e1a17f"/>
        <stop offset="1" stop-color="#c98164"/>
      </radialGradient>
      <filter id="bodyShadow" x="-30%" y="-15%" width="160%" height="155%">
        <feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#173c38" flood-opacity=".15"/>
      </filter>
      <filter id="softInner" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3"/>
      </filter>
    </defs>

    <ellipse cx="210" cy="727" rx="88" ry="13" fill="#173f39" opacity=".10"/>

    <g filter="url(#bodyShadow)" class="patient-body patient-body-${view}">
      ${isFront ? frontBodySvg({ pallor, diaphoresis }) : backBodySvg()}
    </g>
  </svg>`;
}

function frontBodySvg({ pallor, diaphoresis }) {
  return `
    <!-- legs behind the trunk -->
    <path d="M166 486 C162 532 159 582 158 631 C157 662 160 686 167 700
             C175 708 190 708 198 700 C204 676 204 648 202 617 L200 496 Z"
          fill="url(#skinGrad)"/>
    <path d="M220 496 L218 617 C216 648 216 676 222 700
             C230 708 245 708 253 700 C260 686 263 662 262 631
             C261 582 258 532 254 486 Z"
          fill="url(#skinGrad)"/>

    <!-- ankles and feet -->
    <path d="M161 686 C163 706 163 715 158 721 C168 731 192 734 203 723
             C202 711 199 701 195 694 Z" fill="url(#skinLight)"/>
    <path d="M225 694 C221 701 218 711 217 723 C228 734 252 731 262 721
             C257 715 257 706 259 686 Z" fill="url(#skinLight)"/>
    <path d="M154 718 C167 713 188 714 203 723 C200 739 181 742 159 739
             C149 735 148 726 154 718 Z" fill="#304d55"/>
    <path d="M217 723 C232 714 253 713 266 718 C272 726 271 735 261 739
             C239 742 220 739 217 723 Z" fill="#304d55"/>

    <!-- arms -->
    <path d="M145 236 C125 245 112 261 107 284 L94 355 L79 421
             C75 439 83 451 95 455 C108 458 118 449 122 436
             L139 371 L155 302 L163 253 Z" fill="url(#skinArm)"/>
    <path d="M275 236 C295 245 308 261 313 284 L326 355 L341 421
             C345 439 337 451 325 455 C312 458 302 449 298 436
             L281 371 L265 302 L257 253 Z" fill="url(#skinArm)"/>
    <ellipse cx="95" cy="458" rx="19" ry="24" fill="url(#skinLight)"/>
    <ellipse cx="325" cy="458" rx="19" ry="24" fill="url(#skinLight)"/>
    <path d="M83 454 Q95 470 108 454" fill="none" stroke="#b8735d" stroke-width="1.4" opacity=".38"/>
    <path d="M312 454 Q325 470 337 454" fill="none" stroke="#b8735d" stroke-width="1.4" opacity=".38"/>

    <!-- trunk breathing group -->
    <g class="exam-avatar-breathe">
      <path d="M182 206
               C162 208 145 216 134 233
               C124 249 123 274 128 308
               L141 403
               C145 439 164 463 188 473
               C201 478 219 478 232 473
               C256 463 275 439 279 403
               L292 308
               C297 274 296 249 286 233
               C275 216 258 208 238 206
               C230 218 220 224 210 224
               C200 224 190 218 182 206 Z"
            fill="url(#skinGrad)"/>

      <!-- shoulders / clavicles / pectorals -->
      <path d="M153 241 Q177 224 203 233" fill="none" stroke="#ae725e" stroke-width="2.3" opacity=".28"/>
      <path d="M267 241 Q243 224 217 233" fill="none" stroke="#ae725e" stroke-width="2.3" opacity=".28"/>
      <path d="M160 252 Q187 247 210 248 Q233 247 260 252" fill="none" stroke="#ac715d" stroke-width="1.8" opacity=".14"/>
      <path d="M154 286 Q180 299 205 290" fill="none" stroke="#a46d5a" stroke-width="1.8" opacity=".14"/>
      <path d="M266 286 Q240 299 215 290" fill="none" stroke="#a46d5a" stroke-width="1.8" opacity=".14"/>
      <path d="M210 225 L210 366" stroke="#9f6756" stroke-width="1.5" opacity=".14"/>
      <path d="M160 343 Q184 356 210 355 Q236 356 260 343" fill="none" stroke="#9f6756" stroke-width="1.7" opacity=".15"/>
      <path d="M173 396 Q188 387 204 397 M216 397 Q232 387 247 396" fill="none" stroke="#9f6756" stroke-width="1.5" opacity=".14"/>
      <ellipse cx="210" cy="381" rx="3.2" ry="2.2" fill="#9c6758" opacity=".32"/>
      <circle cx="173" cy="288" r="1.9" fill="#a56e5b" opacity=".22"/>
      <circle cx="247" cy="288" r="1.9" fill="#a56e5b" opacity=".22"/>
    </g>

    <!-- shorts -->
    <path d="M146 428
             C158 446 178 457 210 457
             C242 457 262 446 274 428
             L267 504 L223 504 L210 479 L197 504 L153 504 Z"
          fill="url(#shortsGrad)"/>
    <path d="M210 458 L210 500" stroke="#18343a" stroke-width="1.5" opacity=".27"/>
    <path d="M156 476 Q181 486 197 476 M223 476 Q239 486 264 476" fill="none" stroke="#173a41" opacity=".23"/>

    <!-- neck -->
    <path d="M188 162
             C188 178 187 193 181 205
             C189 214 199 219 210 219
             C221 219 231 214 239 205
             C233 193 232 178 232 162 Z"
          fill="url(#skinLight)"/>
    <path d="M190 190 Q210 201 230 190" fill="none" stroke="#ab705d" stroke-width="1.4" opacity=".28"/>
    <path d="M194 207 Q210 214 226 207" fill="none" stroke="#ab705d" stroke-width="1.3" opacity=".25"/>

    <!-- face -->
    <path d="M210 50
             C186 50 170 66 167 93
             L167 118
             C167 148 184 167 210 170
             C236 167 253 148 253 118
             L253 93
             C250 66 234 50 210 50 Z"
          fill="url(#faceLight)"/>
    <path d="M170 98
             C170 69 188 48 210 48
             C233 48 250 69 250 97
             C242 83 235 74 229 67
             C216 71 203 72 191 69
             C184 77 177 87 170 98 Z"
          fill="#4b3531"/>
    <path d="M172 89 C174 63 193 46 210 46 C227 46 246 63 248 89
             C238 67 225 57 210 56 C195 57 182 67 172 89 Z"
          fill="#3f2d2a" opacity=".96"/>

    <path d="M166 105 C160 111 160 130 166 137 C170 141 174 137 173 131 C173 122 171 112 166 105 Z"
          fill="#d99877"/>
    <path d="M254 105 C260 111 260 130 254 137 C250 141 246 137 247 131 C247 122 249 112 254 105 Z"
          fill="#d99877"/>

    <!-- brows and eyes -->
    <path d="M182 103 Q191 98 200 102" fill="none" stroke="#4a3732" stroke-width="3.6" stroke-linecap="round"/>
    <path d="M220 102 Q229 98 238 103" fill="none" stroke="#4a3732" stroke-width="3.6" stroke-linecap="round"/>
    <g class="exam-avatar-blink">
      <path d="M181 118 Q190 112 199 118 Q190 123 181 118 Z" fill="#f6efe9"/>
      <path d="M221 118 Q230 112 239 118 Q230 123 221 118 Z" fill="#f6efe9"/>
      <circle cx="190" cy="117" r="3.6" fill="#4b514c"/>
      <circle cx="230" cy="117" r="3.6" fill="#4b514c"/>
      <circle cx="191" cy="116" r="1.2" fill="#131817"/>
      <circle cx="231" cy="116" r="1.2" fill="#131817"/>
    </g>

    <!-- nose / mouth / jawline -->
    <path d="M210 119 Q204 136 209 143 Q213 145 217 142" fill="none" stroke="#ac6f5b" stroke-width="1.9" stroke-linecap="round"/>
    <path d="M192 154 Q210 149 228 154" fill="none" stroke="#734a41" stroke-width="2.8" stroke-linecap="round"/>
    <path d="M196 158 Q210 162 224 158" fill="none" stroke="#aa6a62" stroke-width="1.1" opacity=".56"/>
    <path d="M181 144 Q190 158 210 161 Q230 158 239 144" fill="none" stroke="#b1705d" stroke-width="1.1" opacity=".16"/>

    ${pallor ? '<ellipse cx="210" cy="112" rx="41" ry="49" fill="#f5e7dc" opacity=".16" class="visual-overlay visual-pallor"/>' : ''}
    ${diaphoresis ? '<g class="visual-overlay visual-diaphoresis" fill="#d8f7f2" opacity=".82"><ellipse cx="186" cy="82" rx="2.1" ry="5.2"/><ellipse cx="210" cy="78" rx="2.2" ry="5.8"/><ellipse cx="234" cy="83" rx="2.1" ry="5.1"/></g>' : ''}

    <!-- subtle adult male surface landmarks -->
    <path d="M175 503 Q180 514 189 520" fill="none" stroke="#a66b58" stroke-width="1.3" opacity=".18"/>
    <path d="M245 503 Q240 514 231 520" fill="none" stroke="#a66b58" stroke-width="1.3" opacity=".18"/>
    <path d="M168 617 Q179 624 194 618" fill="none" stroke="#a66b58" stroke-width="1.3" opacity=".18"/>
    <path d="M226 618 Q241 624 252 617" fill="none" stroke="#a66b58" stroke-width="1.3" opacity=".18"/>
  `;
}

function backBodySvg() {
  return `
    <!-- legs -->
    <path d="M166 486 C162 532 159 582 158 631 C157 662 160 686 167 700
             C175 708 190 708 198 700 C204 676 204 648 202 617 L200 496 Z"
          fill="url(#skinGrad)"/>
    <path d="M220 496 L218 617 C216 648 216 676 222 700
             C230 708 245 708 253 700 C260 686 263 662 262 631
             C261 582 258 532 254 486 Z"
          fill="url(#skinGrad)"/>
    <path d="M161 686 C163 706 163 715 158 721 C168 731 192 734 203 723
             C202 711 199 701 195 694 Z" fill="url(#skinLight)"/>
    <path d="M225 694 C221 701 218 711 217 723 C228 734 252 731 262 721
             C257 715 257 706 259 686 Z" fill="url(#skinLight)"/>
    <path d="M154 718 C167 713 188 714 203 723 C200 739 181 742 159 739
             C149 735 148 726 154 718 Z" fill="#304d55"/>
    <path d="M217 723 C232 714 253 713 266 718 C272 726 271 735 261 739
             C239 742 220 739 217 723 Z" fill="#304d55"/>

    <!-- arms -->
    <path d="M145 236 C125 245 112 261 107 284 L94 355 L79 421
             C75 439 83 451 95 455 C108 458 118 449 122 436
             L139 371 L155 302 L163 253 Z" fill="url(#skinArm)"/>
    <path d="M275 236 C295 245 308 261 313 284 L326 355 L341 421
             C345 439 337 451 325 455 C312 458 302 449 298 436
             L281 371 L265 302 L257 253 Z" fill="url(#skinArm)"/>
    <ellipse cx="95" cy="458" rx="19" ry="24" fill="url(#skinLight)"/>
    <ellipse cx="325" cy="458" rx="19" ry="24" fill="url(#skinLight)"/>

    <!-- trunk -->
    <g class="exam-avatar-breathe">
      <path d="M182 206
               C162 208 145 216 134 233
               C124 249 123 274 128 308
               L141 403
               C145 439 164 463 188 473
               C201 478 219 478 232 473
               C256 463 275 439 279 403
               L292 308
               C297 274 296 249 286 233
               C275 216 258 208 238 206
               C230 218 220 224 210 224
               C200 224 190 218 182 206 Z"
            fill="url(#skinGrad)"/>

      <!-- scapulae / spine / lumbar landmarks -->
      <path d="M171 244 Q184 229 198 237 Q193 272 176 302"
            fill="none" stroke="#9c6858" stroke-width="2" opacity=".23"/>
      <path d="M249 244 Q236 229 222 237 Q227 272 244 302"
            fill="none" stroke="#9c6858" stroke-width="2" opacity=".23"/>
      <path d="M210 226 L210 429" stroke="#966252" stroke-width="1.9" opacity=".22"/>
      <path d="M160 335 Q183 347 210 344 Q237 347 260 335"
            fill="none" stroke="#9c6858" stroke-width="1.6" opacity=".14"/>
      <path d="M176 387 Q193 376 210 382 Q227 376 244 387"
            fill="none" stroke="#9c6858" stroke-width="1.5" opacity=".14"/>
      <path d="M188 424 Q210 436 232 424" fill="none" stroke="#9c6858" stroke-width="1.4" opacity=".16"/>
    </g>

    <!-- shorts -->
    <path d="M146 428
             C158 446 178 457 210 457
             C242 457 262 446 274 428
             L267 504 L223 504 L210 479 L197 504 L153 504 Z"
          fill="url(#shortsGrad)"/>
    <path d="M210 458 L210 500" stroke="#18343a" stroke-width="1.5" opacity=".27"/>

    <!-- neck and head -->
    <path d="M188 162
             C188 178 187 193 181 205
             C189 214 199 219 210 219
             C221 219 231 214 239 205
             C233 193 232 178 232 162 Z"
          fill="url(#skinLight)"/>
    <path d="M210 50
             C186 50 170 66 167 93
             L167 118
             C167 148 184 167 210 170
             C236 167 253 148 253 118
             L253 93
             C250 66 234 50 210 50 Z"
          fill="url(#faceLight)"/>
    <path d="M170 100
             C171 69 189 48 210 48
             C232 48 249 69 250 100
             C241 84 227 73 210 71
             C193 73 179 84 170 100 Z"
          fill="#4b3531"/>
    <path d="M175 78 Q210 50 245 78 Q239 59 226 53 Q210 44 194 53 Q181 59 175 78 Z"
          fill="#3f2d2a" opacity=".96"/>
    <path d="M166 105 C160 111 160 130 166 137 C170 141 174 137 173 131 C173 122 171 112 166 105 Z"
          fill="#d99877"/>
    <path d="M254 105 C260 111 260 130 254 137 C250 141 246 137 247 131 C247 122 249 112 254 105 Z"
          fill="#d99877"/>
    <path d="M192 185 Q210 192 228 185" fill="none" stroke="#a96e5a" stroke-width="1.3" opacity=".22"/>
  `;
}

function toolHelp(tool) {
  if (tool === 'inspect') return 'Move around the patient and visually assess targeted areas. Future cases can add local skin colour, rash, bruising, scars, swelling and other visible overlays.';
  if (tool === 'auscultate') return 'Place the stethoscope on a point. Recorded sounds are used when a suitable licensed recording exists; otherwise the UI explicitly labels educational simulation.';
  if (tool === 'palpate') return 'Choose a focused anatomical site rather than revealing a whole-system examination with one click.';
  if (tool === 'percuss') return 'Compare paired lung fields or abdominal zones. Percussion notes in this prototype are synthesized and clearly marked as simulated.';
  return '';
}

function labelForTool(tool) {
  return PHYSICAL_EXAM_TOOLS.find((item) => item.id === tool)?.label || tool;
}

function toolCursorIcon(tool) {
  if (tool === 'auscultate') return 'stethoscope';
  if (tool === 'palpate') return 'hand';
  if (tool === 'percuss') return 'tap';
  return 'eye';
}

function toolIcon(name) {
  if (name === 'stethoscope') return `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 4v8a6 6 0 0 0 12 0V4M5 4h6M17 4h6M20 14v4a5 5 0 0 0 10 0v-2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="28" cy="14" r="2.4" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
  if (name === 'hand') return `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10 16V8a2 2 0 0 1 4 0v6-9a2 2 0 0 1 4 0v9-7a2 2 0 0 1 4 0v9-5a2 2 0 0 1 4 0v9c0 5-4 9-9 9h-2c-4 0-7-2-9-6l-3-6a2.5 2.5 0 0 1 4-3l3 2Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (name === 'tap') return `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 18h11M7 14h11M12 10h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 23c2-7 6-9 9-7-1 8-4 12-9 13-5 1-9-1-12-5l5-3c2 2 4 3 7 2Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
  return `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 16s5-8 13-8 13 8 13 8-5 8-13 8S3 16 3 16Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="16" r="4" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
}

async function synthPercussion(profile) {
  const ctx = makeAudioContext();
  const now = ctx.currentTime;
  const settings = {
    resonant: { freq: 115, duration: .34, q: 2.2, noise: .22 },
    dull: { freq: 78, duration: .20, q: 1.3, noise: .10 },
    tympanic: { freq: 220, duration: .44, q: 4.2, noise: .12 },
    flat: { freq: 62, duration: .13, q: .8, noise: .06 }
  }[profile] || { freq: 115, duration: .34, q: 2.2, noise: .22 };

  const master = ctx.createGain();
  master.gain.setValueAtTime(.0001, now);
  master.gain.exponentialRampToValueAtTime(.55, now + .006);
  master.gain.exponentialRampToValueAtTime(.0001, now + settings.duration);
  master.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = profile === 'tympanic' ? 'sine' : 'triangle';
  osc.frequency.setValueAtTime(settings.freq, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(38, settings.freq * .62), now + settings.duration);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = settings.freq * 1.1;
  filter.Q.value = settings.q;
  osc.connect(filter).connect(master);
  osc.start(now); osc.stop(now + settings.duration + .02);

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, settings.duration);
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = settings.noise;
  noise.connect(noiseGain).connect(master);
  noise.start(now); noise.stop(now + settings.duration);
  await wait((settings.duration + .05) * 1000);
}

async function synthBreath() {
  const ctx = makeAudioContext();
  const duration = 4.4;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, duration);
  const high = ctx.createBiquadFilter(); high.type = 'highpass'; high.frequency.value = 120;
  const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 1050;
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(.0001, now);
  gain.gain.linearRampToValueAtTime(.12, now + .9);
  gain.gain.linearRampToValueAtTime(.05, now + 1.8);
  gain.gain.linearRampToValueAtTime(.09, now + 2.55);
  gain.gain.linearRampToValueAtTime(.0001, now + 4.2);
  source.connect(high).connect(low).connect(gain).connect(ctx.destination);
  source.start(); source.stop(now + duration);
  await wait(duration * 1000);
}

async function synthBowel() {
  const ctx = makeAudioContext();
  const start = ctx.currentTime;
  [0, .55, 1.45, 2.2].forEach((offset, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = index % 2 ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(150 + index * 35, start + offset);
    osc.frequency.exponentialRampToValueAtTime(55 + index * 8, start + offset + .18);
    gain.gain.setValueAtTime(.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(.08, start + offset + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, start + offset + .22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start + offset); osc.stop(start + offset + .25);
  });
  await wait(2700);
}

function makeAudioContext() {
  activeAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  return activeAudioContext;
}

function noiseBuffer(ctx, duration) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    last = last * .84 + white * .16;
    data[i] = last;
  }
  return buffer;
}

function wait(ms) { return new Promise((resolve) => window.setTimeout(resolve, ms)); }
function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
