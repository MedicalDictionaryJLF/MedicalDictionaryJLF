export const DETAILS_PASSWORD = '1379';
const STORAGE_KEY = 'anamnesisDetailsUnlocked';

export function isDetailsUnlocked() {
  return sessionStorage.getItem(STORAGE_KEY) === 'true';
}

export function renderDetailsPanel({ container, currentMode, lastDetection, aiDiagnostics, engine, onExportDebug, onRunSimulation }) {
  if (!container) return;
  if (!isDetailsUnlocked()) {
    container.innerHTML = `
      <details class="details-lock">
        <summary>Details</summary>
        <form id="detailsUnlockForm" class="details-unlock-form">
          <label>
            <span>Password</span>
            <input id="detailsPasswordInput" type="password" autocomplete="off" inputmode="numeric" />
          </label>
          <button type="submit" class="secondary">Unlock</button>
          <p id="detailsUnlockError" class="details-error" aria-live="polite"></p>
        </form>
      </details>
    `;
    container.querySelector('#detailsUnlockForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = container.querySelector('#detailsPasswordInput');
      if (input?.value === DETAILS_PASSWORD) {
        sessionStorage.setItem(STORAGE_KEY, 'true');
        renderDetailsPanel({ container, currentMode, lastDetection, aiDiagnostics, engine, onExportDebug, onRunSimulation });
      } else {
        const error = container.querySelector('#detailsUnlockError');
        if (error) error.textContent = 'Incorrect password.';
      }
    });
    return;
  }

  container.innerHTML = `
    <details class="details-panel-content" open>
      <summary>Details</summary>
      <div class="details-actions">
        <button id="detailsExportDebugBtn" type="button" class="secondary">Export debug.json</button>
        <button id="detailsRunSimulationBtn" type="button" class="secondary">Run simulation tests</button>
      </div>
      <section class="technical-grid">
        <h3>Answer Quality / Intent Analysis</h3>
        ${renderDetection(lastDetection)}
      </section>
      <section class="technical-grid">
        <h3>AI Diagnostics</h3>
        ${renderAiDiagnostics(aiDiagnostics)}
      </section>
      <section class="technical-grid">
        <h3>Session</h3>
        <p><strong>Mode:</strong> ${escapeHtml(currentMode)}</p>
        <p><strong>Turns:</strong> ${escapeHtml(engine?.turn ?? 0)}</p>
      </section>
    </details>
  `;
  container.querySelector('#detailsExportDebugBtn')?.addEventListener('click', onExportDebug);
  container.querySelector('#detailsRunSimulationBtn')?.addEventListener('click', onRunSimulation);
}

function renderDetection(detection) {
  if (!detection) return '<p>No question analyzed yet.</p>';
  return `
    <p><strong>Detected intent:</strong> ${escapeHtml(detection.primaryIntent?.title || detection.primaryIntent?.id || 'none')}</p>
    <p><strong>Final resolution source:</strong> ${escapeHtml(detection.kind || 'unknown')}</p>
    <p><strong>Deterministic confidence:</strong> ${Math.round((detection.confidence ?? 0) * 100)}%</p>
    <p><strong>Response scope:</strong> ${escapeHtml(detection.responseScope || 'unknown')}</p>
    <p><strong>Fallback used:</strong> ${detection.responseScope === 'clarification' ? 'yes' : 'no'}</p>
    <p><strong>Terminology issue:</strong> ${escapeHtml(detection.terminologyEvent?.term || 'none')}</p>
    <details class="raw-details">
      <summary>Top candidate intents</summary>
      <ol>
        ${(detection.candidates ?? []).slice(0, 6).map((candidate) => `<li>${escapeHtml(candidate.title || candidate.id)} (${Number(candidate.score ?? 0).toFixed(2)})</li>`).join('') || '<li>None</li>'}
      </ol>
    </details>
  `;
}

function renderAiDiagnostics(aiDiagnostics = {}) {
  const boolText = (value) => value === null || value === undefined ? 'unknown' : value ? 'yes' : 'no';
  return `
    <p><strong>AI attempted:</strong> ${escapeHtml(boolText(aiDiagnostics.lastAttempted))}</p>
    <p><strong>AI succeeded:</strong> ${escapeHtml(boolText(aiDiagnostics.lastSucceeded))}</p>
    <p><strong>AI-selected intent:</strong> ${escapeHtml(aiDiagnostics.lastSelectedIntent || 'none')}</p>
    <p><strong>AI confidence:</strong> ${escapeHtml(aiDiagnostics.lastConfidence ?? 'unknown')}</p>
    <p><strong>AI enabled:</strong> ${escapeHtml(boolText(aiDiagnostics.enabled))}</p>
    <p><strong>Backend reachable:</strong> ${escapeHtml(boolText(aiDiagnostics.backendReachable))}</p>
    <p><strong>Gemini configured:</strong> ${escapeHtml(boolText(aiDiagnostics.geminiConfigured))}</p>
    <p><strong>AI model:</strong> ${escapeHtml(aiDiagnostics.model || 'unknown')}</p>
    <p><strong>Last AI error:</strong> ${escapeHtml(aiDiagnostics.lastAIError || 'none')}</p>
  `;
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
