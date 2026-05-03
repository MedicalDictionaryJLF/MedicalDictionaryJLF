const STORAGE_KEY = "radiologyTrainerProgress.v2";
const RADIOLOGY_PROFILE_KEY = "trainer.v2";
const GOOGLE_CLIENT_ID = "595058136144-2e6f4u64er110a38sdi6ludegbrkqbao.apps.googleusercontent.com";
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.appdata";

const elements = {
  settingsButton: document.getElementById("settingsButton"),
  settingsOverlay: document.getElementById("settingsOverlay"),
  settingsPanel: document.getElementById("settingsPanel"),
  settingsClose: document.getElementById("settingsClose"),
  settingsConnectionStatus: document.getElementById("settingsConnectionStatus"),
  settingsLoginButton: document.getElementById("settingsLoginButton"),
  settingsSyncButton: document.getElementById("settingsSyncButton"),
  settingsLogoutButton: document.getElementById("settingsLogoutButton"),
  loginButton: document.getElementById("loginButton"),
  accountBox: document.getElementById("accountBox"),
  accountName: document.getElementById("accountName"),
  syncButton: document.getElementById("syncButton"),
  logoutButton: document.getElementById("logoutButton"),
  syncStatus: document.getElementById("syncStatus"),
  cardMeta: document.getElementById("cardMeta"),
  knownCount: document.getElementById("knownCount"),
  reviewCount: document.getElementById("reviewCount"),
  unseenCount: document.getElementById("unseenCount"),
  positionText: document.getElementById("positionText"),
  percentText: document.getElementById("percentText"),
  progressFill: document.getElementById("progressFill"),
  flashcard: document.getElementById("flashcard"),
  cardImage: document.getElementById("cardImage"),
  answerTitle: document.getElementById("answerTitle"),
  answerBody: document.getElementById("answerBody"),
  cardList: document.getElementById("cardList"),
  prevButton: document.getElementById("prevButton"),
  flipButton: document.getElementById("flipButton"),
  nextButton: document.getElementById("nextButton"),
  reviewButton: document.getElementById("reviewButton"),
  knownButton: document.getElementById("knownButton"),
  resetButton: document.getElementById("resetButton"),
};

let cards = [];
let state = createEmptyProgress();
let tokenClient = null;
let accessToken = "";
let tokenExpiresAt = 0;
let authInFlight = false;
let profileFileId = "";
let profileFileEtag = "";
let profileDoc = null;
let profileDirty = false;
let saveInFlight = false;
let saveQueued = false;
let saveTimer = null;
let accountLabel = "";

function nowIso() {
  return new Date().toISOString();
}

function createEmptyProgress() {
  return {
    index: 0,
    flipped: false,
    results: {},
    clearedAt: "",
    updatedAt: nowIso(),
  };
}

function deepClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function stripEtag(value) {
  return String(value || "").replace(/^W\//, "").replace(/^"(.*)"$/, "$1").trim();
}

function progressTimeMs(value) {
  const ms = new Date(String(value || "")).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function setSyncStatus(text, tone = "") {
  elements.syncStatus.textContent = String(text || "");
  elements.syncStatus.classList.toggle("ok", tone === "ok");
  elements.syncStatus.classList.toggle("error", tone === "error");
  if (elements.settingsConnectionStatus) {
    elements.settingsConnectionStatus.textContent = String(text || "");
  }
}

function normalizeProgress(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const results = {};
  if (input.results && typeof input.results === "object") {
    for (const [cardId, row] of Object.entries(input.results)) {
      if (!cardId || !row || typeof row !== "object") continue;
      const status = row.status === "known" || row.status === "review" ? row.status : "";
      if (!status) continue;
      results[String(cardId)] = {
        status,
        attempts: Math.max(0, Number(row.attempts) || 0),
        updatedAt: String(row.updatedAt || row.updated_at || input.updatedAt || nowIso()),
      };
    }
  }
  return {
    index: Number.isInteger(input.index) ? input.index : 0,
    flipped: false,
    results,
    clearedAt: String(input.clearedAt || input.cleared_at || ""),
    updatedAt: String(input.updatedAt || input.updated_at || nowIso()),
  };
}

function loadLocalState() {
  try {
    state = normalizeProgress(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
  } catch {
    state = createEmptyProgress();
    saveLocalState();
  }
}

function saveLocalState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      index: state.index,
      results: state.results,
      clearedAt: state.clearedAt || "",
      updatedAt: state.updatedAt || nowIso(),
    }),
  );
}

function defaultProfile() {
  const ts = nowIso();
  return {
    meta: {
      schema_version: 1,
      created_at: ts,
      updated_at: ts,
    },
    terms: {},
    flashcards: {
      decks: {},
      cards: {},
      schedule: {},
      stats: {},
      v2_progress: {},
    },
    learning: {
      term_progress: {},
      quiz_sessions: [],
      mistakes: [],
      review_list: [],
      starred_state: { items: {} },
      review_state: { items: {} },
      custom_quizzes: { items: [] },
    },
    courses: {
      latin_progress: {},
    },
    anamnesis: {
      records: [],
      active_patient_id: "",
    },
    radiology: {
      progress: {},
    },
    settings: {},
  };
}

function ensureProfileShape(rawProfile) {
  const base = defaultProfile();
  const merged = {
    ...base,
    ...(rawProfile && typeof rawProfile === "object" ? rawProfile : {}),
  };
  merged.meta = {
    ...base.meta,
    ...(merged.meta && typeof merged.meta === "object" ? merged.meta : {}),
  };
  merged.meta.schema_version = 1;
  merged.terms = merged.terms && typeof merged.terms === "object" ? merged.terms : {};
  merged.flashcards = {
    ...base.flashcards,
    ...(merged.flashcards && typeof merged.flashcards === "object" ? merged.flashcards : {}),
  };
  merged.flashcards.decks = merged.flashcards.decks && typeof merged.flashcards.decks === "object" ? merged.flashcards.decks : {};
  merged.flashcards.cards = merged.flashcards.cards && typeof merged.flashcards.cards === "object" ? merged.flashcards.cards : {};
  merged.flashcards.schedule = merged.flashcards.schedule && typeof merged.flashcards.schedule === "object" ? merged.flashcards.schedule : {};
  merged.flashcards.stats = merged.flashcards.stats && typeof merged.flashcards.stats === "object" ? merged.flashcards.stats : {};
  merged.flashcards.v2_progress = merged.flashcards.v2_progress && typeof merged.flashcards.v2_progress === "object" ? merged.flashcards.v2_progress : {};
  merged.learning = {
    ...base.learning,
    ...(merged.learning && typeof merged.learning === "object" ? merged.learning : {}),
  };
  merged.learning.term_progress = merged.learning.term_progress && typeof merged.learning.term_progress === "object" ? merged.learning.term_progress : {};
  merged.learning.quiz_sessions = Array.isArray(merged.learning.quiz_sessions) ? merged.learning.quiz_sessions : [];
  merged.learning.mistakes = Array.isArray(merged.learning.mistakes) ? merged.learning.mistakes : [];
  merged.learning.review_list = Array.isArray(merged.learning.review_list) ? merged.learning.review_list : [];
  merged.learning.starred_state = merged.learning.starred_state && typeof merged.learning.starred_state === "object" ? merged.learning.starred_state : { items: {} };
  merged.learning.review_state = merged.learning.review_state && typeof merged.learning.review_state === "object" ? merged.learning.review_state : { items: {} };
  merged.learning.custom_quizzes = merged.learning.custom_quizzes && typeof merged.learning.custom_quizzes === "object" ? merged.learning.custom_quizzes : { items: [] };
  if (!Array.isArray(merged.learning.custom_quizzes.items)) merged.learning.custom_quizzes.items = [];
  merged.courses = {
    ...base.courses,
    ...(merged.courses && typeof merged.courses === "object" ? merged.courses : {}),
  };
  merged.courses.latin_progress = merged.courses.latin_progress && typeof merged.courses.latin_progress === "object" ? merged.courses.latin_progress : {};
  merged.anamnesis = merged.anamnesis && typeof merged.anamnesis === "object" ? merged.anamnesis : { records: [], active_patient_id: "" };
  if (!Array.isArray(merged.anamnesis.records)) merged.anamnesis.records = [];
  merged.anamnesis.active_patient_id = String(merged.anamnesis.active_patient_id || merged.anamnesis.activePatientId || "").trim();
  merged.radiology = merged.radiology && typeof merged.radiology === "object" ? merged.radiology : {};
  merged.radiology.progress = merged.radiology.progress && typeof merged.radiology.progress === "object" ? merged.radiology.progress : {};
  merged.settings = merged.settings && typeof merged.settings === "object" ? merged.settings : {};
  return merged;
}

function isProfileSessionActive() {
  return !!(accessToken && profileDoc && profileFileId);
}

function mergeProgress(localProgress, remoteProgress) {
  const local = normalizeProgress(localProgress);
  const remote = normalizeProgress(remoteProgress);
  const merged = progressTimeMs(local.updatedAt) >= progressTimeMs(remote.updatedAt)
    ? normalizeProgress(local)
    : normalizeProgress(remote);
  const ids = new Set([...Object.keys(remote.results), ...Object.keys(local.results)]);
  merged.results = {};
  const clearedAt = [local.clearedAt, remote.clearedAt]
    .sort((a, b) => progressTimeMs(b) - progressTimeMs(a))[0] || "";
  const clearedMs = progressTimeMs(clearedAt);
  for (const id of ids) {
    const localRow = local.results[id];
    const remoteRow = remote.results[id];
    const localMs = progressTimeMs(localRow && localRow.updatedAt);
    const remoteMs = progressTimeMs(remoteRow && remoteRow.updatedAt);
    if (!localRow && remoteMs <= clearedMs) continue;
    if (!remoteRow && localMs <= clearedMs) continue;
    if (!localRow) merged.results[id] = deepClone(remoteRow);
    else if (!remoteRow) merged.results[id] = deepClone(localRow);
    else {
      const winner = localMs >= remoteMs ? localRow : remoteRow;
      if (progressTimeMs(winner.updatedAt) <= clearedMs) continue;
      merged.results[id] = localMs >= remoteMs
        ? deepClone(localRow)
        : deepClone(remoteRow);
    }
  }
  merged.clearedAt = clearedAt;
  merged.updatedAt = [local.updatedAt, remote.updatedAt]
    .sort((a, b) => progressTimeMs(b) - progressTimeMs(a))[0] || nowIso();
  merged.flipped = false;
  return merged;
}

function markProfileDirty() {
  if (!isProfileSessionActive()) return;
  profileDoc = ensureProfileShape(profileDoc);
  profileDoc.meta.updated_at = nowIso();
  profileDirty = true;
}

function writeProgressToProfile() {
  if (!isProfileSessionActive()) return;
  profileDoc.radiology.progress[RADIOLOGY_PROFILE_KEY] = normalizeProgress(state);
  markProfileDirty();
}

function persistProgress({ syncProfile = true, immediate = false } = {}) {
  state.updatedAt = nowIso();
  saveLocalState();
  if (syncProfile && isProfileSessionActive()) {
    writeProgressToProfile();
    scheduleProfileSave(immediate ? 0 : 900);
  }
}

function toMultipartRelated({ metadata, content }) {
  const boundary = `mdict_${Math.random().toString(36).slice(2)}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(content),
    `--${boundary}--`,
  ].join("\r\n");
  return { boundary, body };
}

async function driveFetch(url, opts = {}) {
  if (!accessToken) throw new Error("Google access token missing.");
  const options = opts || {};
  const allowStatuses = Array.isArray(options.allowStatuses) ? options.allowStatuses : [];
  const res = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
    body: options.body,
  });
  if (res.ok || allowStatuses.includes(res.status)) return res;
  let detail = "";
  try {
    const err = await res.json();
    detail = err && err.error && err.error.message ? String(err.error.message) : "";
  } catch {}
  throw new Error(`Drive request failed (${res.status})${detail ? `: ${detail}` : ""}`);
}

async function driveFindProfileFile() {
  const q = encodeURIComponent("name='profile.json' and trashed=false");
  const urls = [
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime,etag)`,
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime)`,
  ];
  for (const url of urls) {
    try {
      const res = await driveFetch(url);
      const json = await res.json();
      const files = Array.isArray(json && json.files) ? json.files : [];
      const hit = files.find((file) => String(file && file.name || "") === "profile.json");
      return hit
        ? { id: String(hit.id || ""), etag: String(hit.etag || ""), modifiedTime: String(hit.modifiedTime || "") }
        : null;
    } catch (error) {
      if (url === urls[urls.length - 1]) throw error;
    }
  }
  return null;
}

async function driveCreateProfileFile(nextProfile) {
  const metadata = { name: "profile.json", parents: ["appDataFolder"], mimeType: "application/json" };
  const multipart = toMultipartRelated({ metadata, content: nextProfile });
  const request = (url) => driveFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/related; boundary=${multipart.boundary}`,
    },
    body: multipart.body,
  });
  try {
    const res = await request("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,etag");
    const data = await res.json();
    return {
      id: String(data && data.id || ""),
      etag: String(data && data.etag || stripEtag(res.headers.get("ETag")) || ""),
    };
  } catch (error) {
    const res = await request("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id");
    const data = await res.json();
    return {
      id: String(data && data.id || ""),
      etag: String(stripEtag(res.headers.get("ETag")) || ""),
    };
  }
}

async function driveGetFileMeta(fileId) {
  const id = encodeURIComponent(String(fileId || "").trim());
  try {
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,modifiedTime,etag`);
    const data = await res.json();
    return {
      id: String(data && data.id || ""),
      etag: String(data && data.etag || stripEtag(res.headers.get("ETag")) || ""),
      modifiedTime: String(data && data.modifiedTime || ""),
    };
  } catch (error) {
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,modifiedTime`);
    const data = await res.json();
    return {
      id: String(data && data.id || ""),
      etag: String(stripEtag(res.headers.get("ETag")) || ""),
      modifiedTime: String(data && data.modifiedTime || ""),
    };
  }
}

async function driveDownloadFile(fileId) {
  const id = encodeURIComponent(String(fileId || "").trim());
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  const doc = await res.json();
  const meta = await driveGetFileMeta(fileId);
  return {
    doc: ensureProfileShape(doc),
    etag: String(meta.etag || stripEtag(res.headers.get("ETag")) || ""),
  };
}

async function driveUpdateProfileFile(fileId, nextProfile, etag) {
  const id = encodeURIComponent(String(fileId || "").trim());
  const metadata = { name: "profile.json", mimeType: "application/json" };
  const multipart = toMultipartRelated({ metadata, content: nextProfile });
  const headers = {
    "Content-Type": `multipart/related; boundary=${multipart.boundary}`,
  };
  const cleanEtag = stripEtag(etag);
  if (cleanEtag) headers["If-Match"] = `"${cleanEtag}"`;
  const request = (url) => driveFetch(url, {
    method: "PATCH",
    headers,
    body: multipart.body,
    allowStatuses: [412],
  });
  try {
    const res = await request(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart&fields=id,etag`);
    if (res.status === 412) return { conflict: true, etag: "" };
    const data = await res.json();
    return {
      conflict: false,
      etag: String(data && data.etag || stripEtag(res.headers.get("ETag")) || ""),
    };
  } catch (error) {
    const res = await request(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart&fields=id`);
    if (res.status === 412) return { conflict: true, etag: "" };
    return {
      conflict: false,
      etag: String(stripEtag(res.headers.get("ETag")) || ""),
    };
  }
}

async function driveLoadCurrentUser() {
  const res = await driveFetch("https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)");
  const data = await res.json();
  const user = data && data.user ? data.user : {};
  return {
    displayName: String(user.displayName || ""),
    emailAddress: String(user.emailAddress || ""),
  };
}

async function saveProfileNow(reason = "manual") {
  if (!isProfileSessionActive() || !profileDirty || !profileFileId) return;
  if (saveInFlight) {
    saveQueued = true;
    return;
  }
  saveInFlight = true;
  updateAuthUI();
  try {
    profileDoc = ensureProfileShape(profileDoc);
    profileDoc.meta.updated_at = nowIso();
    let result = await driveUpdateProfileFile(profileFileId, profileDoc, profileFileEtag);
    if (result.conflict) {
      const remote = await driveDownloadFile(profileFileId);
      const remoteProgress = remote.doc.radiology.progress[RADIOLOGY_PROFILE_KEY];
      state = mergeProgress(state, remoteProgress);
      profileDoc = ensureProfileShape(remote.doc);
      profileDoc.radiology.progress[RADIOLOGY_PROFILE_KEY] = normalizeProgress(state);
      profileFileEtag = remote.etag || profileFileEtag;
      result = await driveUpdateProfileFile(profileFileId, profileDoc, profileFileEtag);
      if (result.conflict) throw new Error("Cloud profile changed during save. Please retry.");
    }
    if (result.etag) profileFileEtag = result.etag;
    profileDirty = false;
    saveLocalState();
    if (reason !== "autosave") setSyncStatus("Progress synced with Google Drive.", "ok");
  } catch (error) {
    console.warn("Profile save failed:", error);
    setSyncStatus(`Drive sync failed: ${error.message || error}`, "error");
  } finally {
    saveInFlight = false;
    updateAuthUI();
    if (saveQueued) {
      saveQueued = false;
      if (profileDirty) void saveProfileNow("queued");
    }
  }
}

function scheduleProfileSave(delayMs = 900) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveProfileNow("autosave");
  }, Math.max(0, Number(delayMs) || 0));
}

async function loadOrCreateDriveProfile() {
  const existing = await driveFindProfileFile();
  if (!existing) {
    profileDoc = ensureProfileShape(defaultProfile());
    profileDoc.radiology.progress[RADIOLOGY_PROFILE_KEY] = normalizeProgress(state);
    const created = await driveCreateProfileFile(profileDoc);
    if (!created.id) throw new Error("Failed to create profile.json in Google Drive.");
    profileFileId = created.id;
    profileFileEtag = created.etag || "";
    profileDirty = false;
    return;
  }
  profileFileId = existing.id;
  const downloaded = await driveDownloadFile(existing.id);
  profileDoc = ensureProfileShape(downloaded.doc);
  profileFileEtag = downloaded.etag || stripEtag(existing.etag) || "";
  const remoteProgress = profileDoc.radiology.progress[RADIOLOGY_PROFILE_KEY];
  state = mergeProgress(state, remoteProgress);
  profileDoc.radiology.progress[RADIOLOGY_PROFILE_KEY] = normalizeProgress(state);
  profileDirty = true;
  saveLocalState();
  await saveProfileNow("signin_merge");
}

async function ensureGoogleIdentity() {
  if (window.google && google.accounts && google.accounts.oauth2) return;
  await new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (window.google && google.accounts && google.accounts.oauth2) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt > 10000) {
        clearInterval(timer);
        reject(new Error("Google sign-in library did not load."));
      }
    }, 100);
  });
}

async function initTokenClient() {
  await ensureGoogleIdentity();
  if (tokenClient) return tokenClient;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    prompt: "",
    callback: handleGoogleTokenResponse,
  });
  return tokenClient;
}

async function handleGoogleTokenResponse(resp) {
  if (resp && resp.error) {
    authInFlight = false;
    setSyncStatus(`Google sign-in failed: ${resp.error_description || resp.error}`, "error");
    updateAuthUI();
    return;
  }
  if (!resp || !resp.access_token) {
    authInFlight = false;
    setSyncStatus("Google sign-in failed: no access token returned.", "error");
    updateAuthUI();
    return;
  }
  accessToken = String(resp.access_token || "").trim();
  tokenExpiresAt = Number(resp.expires_in || 0) > 0 ? Date.now() + Number(resp.expires_in) * 1000 : 0;
  try {
    setSyncStatus("Synchronizing radiology progress with Google Drive...");
    await loadOrCreateDriveProfile();
    const about = await driveLoadCurrentUser().catch(() => ({ displayName: "", emailAddress: "" }));
    accountLabel = about.displayName || about.emailAddress || "Google user";
    setSyncStatus("Radiology progress is synced with Google Drive.", "ok");
    renderCard();
  } catch (error) {
    console.warn("Google Drive sync failed:", error);
    setSyncStatus(`Drive sync failed: ${error.message || error}`, "error");
  } finally {
    authInFlight = false;
    updateAuthUI();
  }
}

async function signIn() {
  if (authInFlight) return;
  authInFlight = true;
  updateAuthUI();
  setSyncStatus("Opening Google sign-in...");
  try {
    const client = await initTokenClient();
    client.requestAccessToken({ prompt: accessToken ? "" : "consent" });
  } catch (error) {
    authInFlight = false;
    setSyncStatus(`Google sign-in is unavailable: ${error.message || error}`, "error");
    updateAuthUI();
  }
}

async function manualSync() {
  if (!isProfileSessionActive()) {
    await signIn();
    return;
  }
  setSyncStatus("Synchronizing radiology progress with Google Drive...");
  try {
    const remote = await driveDownloadFile(profileFileId);
    profileFileEtag = remote.etag || profileFileEtag;
    const remoteProgress = remote.doc.radiology.progress[RADIOLOGY_PROFILE_KEY];
    state = mergeProgress(state, remoteProgress);
    profileDoc = ensureProfileShape(remote.doc);
    profileDoc.radiology.progress[RADIOLOGY_PROFILE_KEY] = normalizeProgress(state);
    profileDirty = true;
    saveLocalState();
    await saveProfileNow("manual");
    renderCard();
  } catch (error) {
    console.warn("Manual sync failed:", error);
    setSyncStatus(`Drive sync failed: ${error.message || error}`, "error");
  }
}

async function signOut() {
  if (profileDirty) await saveProfileNow("signout");
  const token = accessToken;
  accessToken = "";
  tokenExpiresAt = 0;
  profileFileId = "";
  profileFileEtag = "";
  profileDoc = null;
  profileDirty = false;
  accountLabel = "";
  if (token && window.google && google.accounts && google.accounts.oauth2 && typeof google.accounts.oauth2.revoke === "function") {
    try {
      google.accounts.oauth2.revoke(token, () => {});
    } catch {}
  }
  setSyncStatus("Signed out. Progress will keep saving locally.", "");
  updateAuthUI();
}

function updateAuthUI() {
  const loggedIn = isProfileSessionActive();
  elements.loginButton.classList.toggle("hidden", loggedIn);
  elements.loginButton.disabled = authInFlight;
  elements.accountBox.classList.toggle("hidden", !loggedIn);
  elements.accountName.textContent = accountLabel || "Google user";
  elements.syncButton.disabled = authInFlight || saveInFlight;
  elements.settingsLoginButton.classList.toggle("hidden", loggedIn);
  elements.settingsLoginButton.disabled = authInFlight;
  elements.settingsSyncButton.classList.toggle("hidden", !loggedIn);
  elements.settingsSyncButton.disabled = authInFlight || saveInFlight;
  elements.settingsLogoutButton.classList.toggle("hidden", !loggedIn);
  elements.settingsLogoutButton.disabled = authInFlight || saveInFlight;
  if (elements.settingsConnectionStatus) {
    elements.settingsConnectionStatus.textContent = loggedIn
      ? `Signed in as ${accountLabel || "Google user"}. Radiology progress syncs with Google Drive.`
      : elements.syncStatus.textContent || "Progress saves locally until you sign in.";
  }
}

function setSettingsOpen(open) {
  elements.settingsOverlay.classList.toggle("open", !!open);
  elements.settingsPanel.classList.toggle("open", !!open);
  elements.settingsOverlay.setAttribute("aria-hidden", open ? "false" : "true");
  elements.settingsPanel.setAttribute("aria-hidden", open ? "false" : "true");
  document.body.classList.toggle("settings-open", !!open);
  if (open) {
    elements.settingsPanel.focus({ preventScroll: true });
  } else {
    elements.settingsButton.focus({ preventScroll: true });
  }
}

function clampIndex() {
  state.index = Math.max(0, Math.min(state.index, Math.max(0, cards.length - 1)));
}

function currentCard() {
  return cards[state.index];
}

function resultFor(card) {
  return state.results[card.id]?.status || "unseen";
}

function counts() {
  let known = 0;
  let review = 0;
  for (const card of cards) {
    const status = resultFor(card);
    if (status === "known") known += 1;
    if (status === "review") review += 1;
  }
  return {
    known,
    review,
    unseen: cards.length - known - review,
  };
}

function setFlipped(nextValue) {
  state.flipped = nextValue;
  elements.flashcard.classList.toggle("is-flipped", state.flipped);
  elements.flipButton.textContent = state.flipped ? "Image" : "Flip";
}

function displayTitle(card) {
  const title = (card.title || "").trim();
  if (!title || title.startsWith("\u2022") || /^o\s+/i.test(title)) {
    return card.label;
  }
  return title.replace(/:$/, "");
}

function answerLines(card) {
  const lines = (card.description || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const title = (card.title || "").trim();
  if (title && lines[0] === title) {
    lines.shift();
  }
  return lines;
}

function renderAnswerLine(line) {
  const row = document.createElement("p");
  row.className = "answer-line";

  if (line.startsWith("\u2022")) {
    row.classList.add("bullet");
    row.append(marker("\u2022"), textSpan(line.slice(1).trim()));
    return row;
  }

  if (/^o\s+/.test(line)) {
    row.classList.add("subbullet");
    row.append(marker("-"), textSpan(line.slice(2).trim()));
    return row;
  }

  row.textContent = line;
  return row;
}

function renderAnswerImage(card) {
  if (!card.answerImage) return null;

  const img = document.createElement("img");
  img.className = "answer-image";
  img.src = card.answerImage;
  img.alt = `${card.label} answer source`;
  return img;
}

function marker(value) {
  const span = document.createElement("span");
  span.className = "marker";
  span.textContent = value;
  return span;
}

function textSpan(value) {
  const span = document.createElement("span");
  span.textContent = value;
  return span;
}

function renderCard() {
  clampIndex();
  const card = currentCard();
  if (!card) return;
  const completed = counts();
  const done = completed.known + completed.review;
  const percent = cards.length ? Math.round((done / cards.length) * 100) : 0;

  elements.cardMeta.textContent = `${card.label} | source page ${card.page}`;
  elements.positionText.textContent = `${state.index + 1} / ${cards.length}`;
  elements.percentText.textContent = `${percent}%`;
  elements.progressFill.style.width = `${percent}%`;
  elements.knownCount.textContent = completed.known;
  elements.reviewCount.textContent = completed.review;
  elements.unseenCount.textContent = completed.unseen;

  elements.cardImage.src = card.image;
  elements.cardImage.alt = `${card.label} radiology image`;
  elements.answerTitle.textContent = displayTitle(card);
  const answerNodes = answerLines(card).map(renderAnswerLine);
  const answerImage = renderAnswerImage(card);
  if (answerImage) answerNodes.push(answerImage);
  elements.answerBody.replaceChildren(...answerNodes);

  elements.prevButton.disabled = state.index === 0;
  elements.nextButton.disabled = state.index === cards.length - 1;

  setFlipped(state.flipped);
  renderQueue();
  saveLocalState();
}

function renderQueue() {
  const fragment = document.createDocumentFragment();

  cards.forEach((card, index) => {
    const button = document.createElement("button");
    const status = resultFor(card);
    button.type = "button";
    button.className = `card-jump ${status}`;
    button.textContent = card.number;
    button.title = `${card.label} | ${status}`;
    button.setAttribute("aria-label", `${card.label}, ${status}`);
    if (index === state.index) button.classList.add("current");
    button.addEventListener("click", () => {
      state.index = index;
      setFlipped(false);
      persistProgress();
      renderCard();
    });
    fragment.append(button);
  });

  elements.cardList.replaceChildren(fragment);
}

function move(delta) {
  state.index += delta;
  clampIndex();
  setFlipped(false);
  persistProgress();
  renderCard();
}

function mark(status) {
  const card = currentCard();
  const previous = state.results[card.id];
  state.results[card.id] = {
    status,
    attempts: (previous?.attempts || 0) + 1,
    updatedAt: nowIso(),
  };

  if (state.index < cards.length - 1) {
    state.index += 1;
  }
  setFlipped(false);
  persistProgress({ immediate: true });
  renderCard();
}

function resetProgress() {
  const shouldReset = window.confirm("Reset all recorded progress?");
  if (!shouldReset) return;

  state = createEmptyProgress();
  state.clearedAt = state.updatedAt;
  persistProgress({ immediate: true });
  renderCard();
}

function bindEvents() {
  elements.settingsButton.addEventListener("click", () => setSettingsOpen(true));
  elements.settingsClose.addEventListener("click", () => setSettingsOpen(false));
  elements.settingsOverlay.addEventListener("click", () => setSettingsOpen(false));
  elements.settingsLoginButton.addEventListener("click", signIn);
  elements.settingsSyncButton.addEventListener("click", manualSync);
  elements.settingsLogoutButton.addEventListener("click", signOut);
  elements.loginButton.addEventListener("click", signIn);
  elements.syncButton.addEventListener("click", manualSync);
  elements.logoutButton.addEventListener("click", signOut);
  elements.flashcard.addEventListener("click", () => setFlipped(!state.flipped));
  elements.flipButton.addEventListener("click", () => setFlipped(!state.flipped));
  elements.prevButton.addEventListener("click", () => move(-1));
  elements.nextButton.addEventListener("click", () => move(1));
  elements.reviewButton.addEventListener("click", () => mark("review"));
  elements.knownButton.addEventListener("click", () => mark("known"));
  elements.resetButton.addEventListener("click", resetProgress);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && elements.settingsPanel.classList.contains("open")) {
      event.preventDefault();
      setSettingsOpen(false);
      return;
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }

    if (event.key === " ") {
      event.preventDefault();
      setFlipped(!state.flipped);
    }
    if (event.key === "ArrowLeft") move(-1);
    if (event.key === "ArrowRight") move(1);
    if (event.key === "1") mark("review");
    if (event.key === "2") mark("known");
  });

  window.addEventListener("beforeunload", () => {
    if (isProfileSessionActive()) writeProgressToProfile();
  });
}

async function init() {
  bindEvents();
  loadLocalState();
  updateAuthUI();

  try {
    const payload = await loadCardsData();
    cards = payload.cards || [];
    clampIndex();
    renderCard();
  } catch (error) {
    elements.cardMeta.textContent = "Could not load card data";
    elements.answerTitle.textContent = "Card data failed to load";
    elements.answerBody.textContent = String(error);
    setFlipped(true);
  }
}

async function loadCardsData() {
  try {
    const response = await fetch("data/cards.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (window.RADIOLOGY_CARDS_DATA && Array.isArray(window.RADIOLOGY_CARDS_DATA.cards)) {
      return window.RADIOLOGY_CARDS_DATA;
    }
    throw error;
  }
}

init();
