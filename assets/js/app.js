import {
  ATTACHMENT_PENDING_ACTION,
  ATTACHMENT_STATUS,
  attachmentHasPendingDelete,
  attachmentHasPendingOperation,
  attachmentHasPendingUpload,
  getDueRetryQueueItems,
  normalizeAttachmentStatus,
  normalizePendingAction,
  removeRetryQueueItem,
  summarizeAttachmentOperations,
  upsertRetryQueueItem
} from "./sync.js";
import { createDialogController, renderStatusMessage } from "./ui.js";
import { createMissingTranslationTracker, repairMojibake } from "./i18n.js";
import {
  buildAppPathForRoute,
  getRouteForScreen,
  getRouteFromLocation,
  getScreenForRoute,
  resolveBundledDataUrl
} from "./core/app-paths.js";
import { parseCSVLines, rowsToObjects, rowsToObjectsWithHeaders } from "./services/csv-utils.js";
import {
  ALLOWED_TAGS,
  ALL_SEARCH_DATASET_KEYS,
  LAB_DATASET_KEY,
  SEARCH_GROUP_DEFINITIONS,
  SEARCH_GROUP_LABEL_BY_KEY,
  createMedicalDataRepository,
  createPharmacologyRepository
} from "./services/data-repository.js";
import { createSearchService } from "./services/search-service.js";
import { createQuizEngine } from "./services/quiz-service.js";

// ================================
// Google Drive Authentication
// ================================
// Replace with your OAuth Web Client ID from Google Cloud Console.
// Google Cloud OAuth setup:
// - Authorized JavaScript origins must include your app host (e.g. http://localhost:8000, https://<user>.github.io).
// - Required scope: https://www.googleapis.com/auth/drive.appdata
const GOOGLE_CLIENT_ID = "595058136144-2e6f4u64er110a38sdi6ludegbrkqbao.apps.googleusercontent.com";
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.appdata";
const APP_THEME_KEY = "app_theme";
const missingTranslationTracker = createMissingTranslationTracker();

// --- DOM helpers (prevents crashes if an element is missing) ---
const $ = (id)=>document.getElementById(id);
const on = (id, ev, fn)=>{ const el=$(id); if(!el){ console.warn('Missing element:', id); return; } el.addEventListener(ev, fn); };
const onOptional = (id, ev, fn)=>{ const el=$(id); if(!el) return; el.addEventListener(ev, fn); };

let gTokenClient = null;
let gAccessToken = "";
let gTokenExpiresAt = 0;
let gAuthInFlight = false;
let googleBtnWired = false;
let userProfile = null;
let profileFileId = "";
let profileFileEtag = "";
let profileDirty = false;
let profileAutosaveTimer = null;
let profileSaveInFlight = false;
let profileSaveQueued = false;
let anamnesisProfileSaveTimer = null;
let attachmentsCache = [];
let attachmentsSyncInFlight = false;
let settingsDialogController = null;
let appReadyPromise = null;

// ===== Offline cache via IndexedDB (stores downloaded CSVs) =====
const IDB_NAME = "mdict_cache";
const IDB_STORE = "files";
const IDB_VERSION = 1;
const ATTACHMENTS_DB_NAME = "medical_dictionary_db";
const ATTACHMENTS_DB_VERSION = 1;
const ATTACHMENTS_STORE = "attachments";
const ATTACHMENT_SYNC_PREF_KEY = "attachment_sync_mode";
const ATTACHMENT_LAST_SYNC_KEY = "attachment_last_sync_at";
const ATTACHMENT_RETRY_QUEUE_KEY = "attachment_retry_queue_v1";
const STORAGE_MODE_LOCAL = "local";
const STORAGE_MODE_DRIVE = "drive";

function idbOpen(dbName = IDB_NAME, version = IDB_VERSION, onUpgrade = null){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, version);
    req.onupgradeneeded = () => {
      if(typeof onUpgrade === "function"){
        onUpgrade(req.result, req.transaction, req.oldVersion, req.newVersion);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key){
  const db = await idbOpen(IDB_NAME, IDB_VERSION, (upgradeDb)=>{
    if(!upgradeDb.objectStoreNames.contains(IDB_STORE)){
      upgradeDb.createObjectStore(IDB_STORE);
    }
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const store = tx.objectStore(IDB_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value){
  const db = await idbOpen(IDB_NAME, IDB_VERSION, (upgradeDb)=>{
    if(!upgradeDb.objectStoreNames.contains(IDB_STORE)){
      upgradeDb.createObjectStore(IDB_STORE);
    }
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    const req = store.put(value, key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

function openAttachmentsDb(){
  return idbOpen(ATTACHMENTS_DB_NAME, ATTACHMENTS_DB_VERSION, (upgradeDb)=>{
    if(!upgradeDb.objectStoreNames.contains(ATTACHMENTS_STORE)){
      upgradeDb.createObjectStore(ATTACHMENTS_STORE, { keyPath: "id" });
    }
  });
}

function normalizeAttachmentStorageMode(raw){
  const value = String(raw || "").toLowerCase();
  return value === STORAGE_MODE_DRIVE ? STORAGE_MODE_DRIVE : STORAGE_MODE_LOCAL;
}

function normalizeAttachmentRecord(record){
  const input = record && typeof record === "object" ? record : {};
  const now = nowIso();
  const storageMode = normalizeAttachmentStorageMode(input.storageMode || STORAGE_MODE_LOCAL);
  const pendingAction = normalizePendingAction(input.pendingAction);
  const driveFileId = input.driveFileId ? String(input.driveFileId) : null;
  const normalizedStatus = normalizeAttachmentStatus(input.status || ATTACHMENT_STATUS.LOCAL_ONLY);
  const legacyUploadPending = storageMode === STORAGE_MODE_DRIVE && !driveFileId;
  return {
    id: String(input.id || ""),
    filename: String(input.filename || "attachment.txt"),
    mimeType: String(input.mimeType || "text/plain"),
    size: Math.max(0, Number(input.size) || 0),
    createdAt: String(input.createdAt || now),
    status: normalizedStatus,
    storageMode,
    driveFileId,
    pendingAction:
      pendingAction !== ATTACHMENT_PENDING_ACTION.NONE
        ? pendingAction
        : normalizedStatus === ATTACHMENT_STATUS.DELETE_PENDING
          ? ATTACHMENT_PENDING_ACTION.DELETE
          : legacyUploadPending
            ? ATTACHMENT_PENDING_ACTION.UPLOAD
            : ATTACHMENT_PENDING_ACTION.NONE,
    lastError: input.lastError ? String(input.lastError) : "",
    retryCount: Math.max(0, Number(input.retryCount) || 0),
    blob: input.blob instanceof Blob ? input.blob : new Blob([""], { type: "text/plain" })
  };
}

async function idbPutAttachment(record){
  const db = await openAttachmentsDb();
  const normalized = normalizeAttachmentRecord(record);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ATTACHMENTS_STORE, "readwrite");
    const store = tx.objectStore(ATTACHMENTS_STORE);
    const req = store.put(normalized);
    req.onsuccess = () => resolve(normalized);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAttachment(id){
  const db = await openAttachmentsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ATTACHMENTS_STORE, "readonly");
    const store = tx.objectStore(ATTACHMENTS_STORE);
    const req = store.get(String(id || ""));
    req.onsuccess = () => resolve(req.result ? normalizeAttachmentRecord(req.result) : null);
    req.onerror = () => reject(req.error);
  });
}

async function idbListAttachments(){
  const db = await openAttachmentsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ATTACHMENTS_STORE, "readonly");
    const store = tx.objectStore(ATTACHMENTS_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const rows = Array.isArray(req.result) ? req.result.map(normalizeAttachmentRecord) : [];
      rows.sort((a, b)=> String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbDeleteAttachment(id){
  const db = await openAttachmentsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ATTACHMENTS_STORE, "readwrite");
    const store = tx.objectStore(ATTACHMENTS_STORE);
    const req = store.delete(String(id || ""));
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function refreshBaseFilesCache(){
  // Static datasets are bundled and loaded locally from /data.
}

/**
 * Load base CSV:
 * 1) IndexedDB cache (if present)
 * 2) local file in /data (fallback)
 */
async function loadBaseFile(filenameOrPath){
  const raw = String(filenameOrPath || "");
  const normalized = raw.replace(/^\/+/, "");
  const cacheKey = "file:base/" + normalized.replace(/^data\//, "");

  const cached = await idbGet(cacheKey);
  if(cached?.text) return cached.text;

  // Local fallback from /data/
  const localPath = normalized.startsWith("data/") ? normalized.slice(5) : normalized;
  const text = await loadFile(resolveBundledDataUrl(localPath));
  try{
    await idbSet(cacheKey, {
      text,
      updated_at: null,
      filename: localPath,
      saved_at: new Date().toISOString()
    });
  }catch(e){}
  return text;
}

function setLoginStatus(text, type = "info") {
  const targets = [
    document.getElementById("google-auth-status")
  ].filter(Boolean);
  for(const el of targets){
    el.textContent = String(text || "");
    el.style.display = "block";
    el.style.background =
      type === "ok" ? "#eafaf0" :
      type === "error" ? "#fde8e8" :
      "#ecfdf5";
  }
}

function clearLoginStatus(){
  const targets = [
    document.getElementById("google-auth-status")
  ].filter(Boolean);
  for(const el of targets){
    el.style.display = "none";
    el.textContent = "";
    el.style.background = "";
  }
}

function getAttachmentSyncMode(){
  const saved = String(localStorage.getItem(ATTACHMENT_SYNC_PREF_KEY) || STORAGE_MODE_LOCAL).toLowerCase();
  return saved === STORAGE_MODE_DRIVE ? STORAGE_MODE_DRIVE : STORAGE_MODE_LOCAL;
}

function setAttachmentSyncMode(mode){
  const normalized = normalizeAttachmentStorageMode(mode);
  localStorage.setItem(ATTACHMENT_SYNC_PREF_KEY, normalized);
  return normalized;
}

function isDriveSyncEnabled(){
  return getAttachmentSyncMode() === STORAGE_MODE_DRIVE;
}

function setAttachmentMessage(text, tone = "info"){
  const el = document.getElementById("attachments-msg");
  if(!el) return;
  renderStatusMessage(el, { text: String(text || ""), tone });
}

function readAttachmentRetryQueue(){
  try{
    const raw = localStorage.getItem(ATTACHMENT_RETRY_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  }catch(e){
    return [];
  }
}

function writeAttachmentRetryQueue(queue){
  localStorage.setItem(ATTACHMENT_RETRY_QUEUE_KEY, JSON.stringify(Array.isArray(queue) ? queue : []));
}

function enqueueAttachmentRetry(id, action, attempts = 1){
  const normalizedAction = normalizePendingAction(action);
  if(!id || normalizedAction === ATTACHMENT_PENDING_ACTION.NONE) return;
  const nextAttempts = Math.max(1, Number(attempts) || 1);
  const delayMs = Math.min(30000, 1500 * (2 ** Math.max(0, nextAttempts - 1)));
  const queue = upsertRetryQueueItem(readAttachmentRetryQueue(), {
    id: String(id),
    action: normalizedAction,
    attempts: nextAttempts,
    dueAt: Date.now() + delayMs
  });
  writeAttachmentRetryQueue(queue);
}

function clearAttachmentRetry(id, action){
  writeAttachmentRetryQueue(removeRetryQueueItem(readAttachmentRetryQueue(), { id, action }));
}

function formatAttachmentSize(bytes){
  const b = Math.max(0, Number(bytes) || 0);
  if(b < 1024) return `${b} B`;
  if(b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if(b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getAttachmentStatusLabel(status){
  const s = normalizeAttachmentStatus(status);
  if(s === ATTACHMENT_STATUS.SYNCING) return tOr("attachment_status_syncing", "Syncing");
  if(s === ATTACHMENT_STATUS.SYNCED) return tOr("attachment_status_synced", "Synced");
  if(s === ATTACHMENT_STATUS.DELETE_PENDING) return tOr("attachment_status_delete_pending", "Delete pending");
  if(s === ATTACHMENT_STATUS.ERROR) return tOr("attachment_status_error", "Error");
  return tOr("attachment_status_local_only", "Local only");
}

function attachmentNeedsSync(record){
  return attachmentHasPendingOperation(record);
}

function listSyncCandidates(){
  return attachmentsCache.filter(row => attachmentHasPendingUpload(row));
}

function listDeleteCandidates(){
  return attachmentsCache.filter(row => attachmentHasPendingDelete(row));
}

function formatSyncTimestamp(value){
  const text = String(value || "").trim();
  if(!text) return tOr("never", "never");
  const dt = new Date(text);
  if(Number.isNaN(dt.getTime())) return tOr("never", "never");
  try{
    return dt.toLocaleString();
  }catch(e){
    return dt.toISOString();
  }
}

function setFeatureStatus(containerId, text, tone = "loading"){
  const el = document.getElementById(containerId);
  if(!el) return;
  if(!text){
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `<p class="feature-status" data-status-tone="${escapeHTML(tone)}">${escapeHTML(text)}</p>`;
}

function refreshStorageSyncUI(){
  const mode = getAttachmentSyncMode();
  const localRadio = document.getElementById("storage-mode-local");
  const driveRadio = document.getElementById("storage-mode-drive");
  const driveControls = document.getElementById("drive-sync-controls");
  const connectStatus = document.getElementById("drive-connection-status");
  const syncStatus = document.getElementById("drive-sync-status");
  const entrySyncBtn = document.getElementById("entry-sync-now-btn");
  const settingsSyncBtn = document.getElementById("drive-sync-now-btn");
  const syncSummary = summarizeAttachmentOperations(attachmentsCache);
  const lastSyncAt = localStorage.getItem(ATTACHMENT_LAST_SYNC_KEY) || "";
  if(localRadio) localRadio.checked = mode === STORAGE_MODE_LOCAL;
  if(driveRadio) driveRadio.checked = mode === STORAGE_MODE_DRIVE;
  if(driveControls) driveControls.classList.toggle("hidden", mode !== STORAGE_MODE_DRIVE);
  if(connectStatus){
    connectStatus.textContent = state.currentUser
      ? `${tOr("connected_as", "Connected as")} ${state.currentUserEmail || state.currentUser}`
      : tOr("storage_not_connected", "Not connected");
  }
  if(syncStatus){
    syncStatus.textContent = `${tOr("last_sync", "Last sync")}: ${formatSyncTimestamp(lastSyncAt)} | ${tOr("pending_operations", "Pending")}: ${syncSummary.pendingCount}`;
  }
  if(entrySyncBtn){
    entrySyncBtn.classList.toggle("hidden", mode !== STORAGE_MODE_DRIVE);
    entrySyncBtn.disabled = attachmentsSyncInFlight || syncSummary.pendingCount <= 0;
  }
  if(settingsSyncBtn){
    settingsSyncBtn.disabled = attachmentsSyncInFlight || mode !== STORAGE_MODE_DRIVE || syncSummary.pendingCount <= 0;
  }
}

async function loadAttachmentsFromDb(){
  try{
    attachmentsCache = await idbListAttachments();
  }catch(e){
    attachmentsCache = [];
    console.warn("Failed to load attachments from IndexedDB:", e);
    setAttachmentMessage(tOr("attachments_load_failed", "Failed to load attachments."), "error");
  }
}

function renderAttachmentsList(){
  const container = document.getElementById("attachments-list");
  if(!container) return;
  const driveMode = isDriveSyncEnabled();
  if(!attachmentsCache.length){
    container.innerHTML = `<p class="muted" style="margin:8px 0 0 0">${escapeHTML(tOr("attachments_none_yet", "No attachments yet."))}</p>`;
    refreshStorageSyncUI();
    return;
  }
  container.innerHTML = attachmentsCache.map((item)=>{
    const status = normalizeAttachmentStatus(item.status);
    const statusLabel = getAttachmentStatusLabel(status);
    const syncBtn = driveMode
      ? `<button type="button" data-action="sync" data-id="${escapeHTML(item.id)}" ${attachmentNeedsSync(item) ? "" : "disabled"}>${escapeHTML(attachmentHasPendingDelete(item) ? tOr("attachment_retry_delete", "Retry delete") : tOr("sync_now", "Sync now"))}</button>`
      : "";
    const removeDisabled = status === ATTACHMENT_STATUS.DELETE_PENDING ? "disabled" : "";
    return `
      <div class="attachment-item">
        <div class="attachment-meta">
          <strong>${escapeHTML(item.filename)}</strong>
          <div class="small">${escapeHTML(formatAttachmentSize(item.size))} | ${escapeHTML(item.mimeType || "text/plain")}</div>
        </div>
        <span class="badge attachment-status-${status}">${escapeHTML(statusLabel)}</span>
        <div class="attachment-actions">
          <button type="button" data-action="preview" data-id="${escapeHTML(item.id)}">${escapeHTML(tOr("preview", "Preview"))}</button>
          ${syncBtn}
          <button type="button" data-action="remove" data-id="${escapeHTML(item.id)}" ${removeDisabled}>${escapeHTML(tOr("remove", "Remove"))}</button>
        </div>
      </div>
    `;
  }).join("");
  refreshStorageSyncUI();
}

async function upsertAttachmentRecord(record){
  const saved = await idbPutAttachment(record);
  const idx = attachmentsCache.findIndex(row => row.id === saved.id);
  if(idx >= 0) attachmentsCache[idx] = saved;
  else attachmentsCache.unshift(saved);
  attachmentsCache.sort((a, b)=> String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return saved;
}

async function removeAttachmentRecord(id){
  const targetId = String(id || "");
  if(!targetId) return;
  await idbDeleteAttachment(targetId);
  attachmentsCache = attachmentsCache.filter(row => row.id !== targetId);
  clearAttachmentRetry(targetId, ATTACHMENT_PENDING_ACTION.UPLOAD);
  clearAttachmentRetry(targetId, ATTACHMENT_PENDING_ACTION.DELETE);
}

function createAttachmentId(){
  if(typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function"){
    return `att:${crypto.randomUUID()}`;
  }
  return `att:${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

function isTxtFile(file){
  if(!(file instanceof File)) return false;
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();
  return name.endsWith(".txt") || type === "text/plain";
}

function normalizeAttachmentFilename(name){
  const raw = String(name || "").trim();
  const safe = raw.replace(/[\\/:*?"<>|]+/g, "_");
  if(!safe) return `attachment_${Date.now()}.txt`;
  if(/\.txt$/i.test(safe)) return safe;
  return `${safe}.txt`;
}

function buildAttachmentRecordFromBlob(filename, blob){
  const mode = getAttachmentSyncMode();
  const b = blob instanceof Blob ? blob : new Blob([""], { type: "text/plain" });
  return {
    id: createAttachmentId(),
    filename: normalizeAttachmentFilename(filename),
    mimeType: "text/plain",
    size: Number(b.size) || 0,
    createdAt: nowIso(),
    status: ATTACHMENT_STATUS.LOCAL_ONLY,
    storageMode: mode === STORAGE_MODE_DRIVE ? STORAGE_MODE_DRIVE : STORAGE_MODE_LOCAL,
    driveFileId: null,
    pendingAction: mode === STORAGE_MODE_DRIVE ? ATTACHMENT_PENDING_ACTION.UPLOAD : ATTACHMENT_PENDING_ACTION.NONE,
    lastError: "",
    retryCount: 0,
    blob: b
  };
}

async function handleAttachmentFiles(fileList){
  const files = Array.from(fileList || []);
  if(!files.length) return;
  for(const file of files){
    if(!isTxtFile(file)){
      setAttachmentMessage(tOr("attachment_only_txt_supported", "Only .txt attachments are supported."), "error");
      continue;
    }
    const record = buildAttachmentRecordFromBlob(String(file.name || "attachment.txt"), file);
    await upsertAttachmentRecord(record);
  }
  renderAttachmentsList();
  setAttachmentMessage(tOr("attachment_saved_local", "Attachment saved locally."));
}

async function handleManualAttachmentCreate(){
  const filenameEl = document.getElementById("attachment-manual-filename");
  const contentEl = document.getElementById("attachment-manual-content");
  if(!filenameEl || !contentEl) return;
  const filename = normalizeAttachmentFilename(filenameEl.value || "");
  const content = String(contentEl.value || "");
  if(!content.trim()){
    setAttachmentMessage(tOr("attachment_manual_empty", "Attachment text is empty."), "error");
    return;
  }
  const blob = new Blob([content], { type: "text/plain" });
  const record = buildAttachmentRecordFromBlob(filename, blob);
  await upsertAttachmentRecord(record);
  contentEl.value = "";
  filenameEl.value = "";
  renderAttachmentsList();
  setAttachmentMessage(tOr("attachment_text_added", "Text added as attachment."));
}

function refreshAttachmentInputModeUI(){
  const modeSel = document.getElementById("attachment-input-mode");
  const manualWrap = document.getElementById("attachment-manual-wrap");
  const uploadBtn = document.getElementById("attachment-upload-btn");
  if(!modeSel || !manualWrap || !uploadBtn) return;
  const mode = String(modeSel.value || "upload");
  const manual = mode === "manual";
  manualWrap.classList.toggle("hidden", !manual);
  uploadBtn.classList.toggle("hidden", manual);
}

async function openAttachmentPreview(id){
  const overlay = document.getElementById("attachment-preview-overlay");
  const content = document.getElementById("attachment-preview-content");
  if(!overlay || !content) return;
  const record = attachmentsCache.find(row => row.id === String(id || ""));
  if(!record || !(record.blob instanceof Blob)){
    setAttachmentMessage(tOr("attachment_preview_unavailable", "Attachment preview is unavailable."), "error");
    return;
  }
  const text = await record.blob.text();
  content.textContent = String(text || "").slice(0, 2000);
  overlay.classList.remove("hidden");
}

function closeAttachmentPreview(){
  const overlay = document.getElementById("attachment-preview-overlay");
  if(overlay) overlay.classList.add("hidden");
}

function ensureGisScriptLoaded(){
  if(window.google && google.accounts && google.accounts.oauth2){
    return Promise.resolve(true);
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if(existing){
      existing.addEventListener("load", ()=> resolve(true), { once: true });
      existing.addEventListener("error", ()=> reject(new Error("Failed to load Google Identity Services.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error("Failed to load Google Identity Services."));
    document.head.appendChild(script);
  });
}

function hasGoogleDriveAccess(){
  if(!gAccessToken) return false;
  if(gTokenExpiresAt <= 0) return true;
  return Date.now() < (gTokenExpiresAt - 10000);
}

async function ensureDriveConnection(){
  if(hasGoogleDriveAccess()) return true;
  await ensureGisScriptLoaded();
  requestGoogleAccessTokenFromClick();
  return false;
}

async function uploadAttachmentToDrive(record){
  const metadata = {
    name: record.filename,
    parents: ["appDataFolder"]
  };
  const boundary = `mdict_upload_${Math.random().toString(36).slice(2)}`;
  const body = new Blob([
    `--${boundary}\r\n`,
    "Content-Type: application/json; charset=UTF-8\r\n\r\n",
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\n`,
    `Content-Type: ${record.mimeType || "text/plain"}\r\n\r\n`,
    record.blob,
    `\r\n--${boundary}--`
  ]);
  const res = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: {
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });
  const data = await res.json();
  return String(data && data.id || "");
}

async function deleteAttachmentFromDrive(driveFileId){
  const id = String(driveFileId || "").trim();
  if(!id) return true;
  await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}`, {
    method: "DELETE"
  });
  return true;
}

async function markAttachmentDeletePending(id){
  const record = attachmentsCache.find(row => row.id === String(id || ""));
  if(!record) return null;
  return upsertAttachmentRecord({
    ...record,
    status: ATTACHMENT_STATUS.DELETE_PENDING,
    pendingAction: ATTACHMENT_PENDING_ACTION.DELETE,
    lastError: "",
    retryCount: Math.max(0, Number(record.retryCount) || 0)
  });
}

async function requestAttachmentRemoval(id){
  const record = attachmentsCache.find(row => row.id === String(id || ""));
  if(!record) return false;
  if(!record.driveFileId){
    await removeAttachmentRecord(record.id);
    return true;
  }
  await markAttachmentDeletePending(record.id);
  renderAttachmentsList();
  const connected = await ensureDriveConnection();
  if(!connected){
    enqueueAttachmentRetry(record.id, ATTACHMENT_PENDING_ACTION.DELETE, Number(record.retryCount || 0) + 1);
    setAttachmentMessage(tOr("attachment_delete_pending", "Attachment marked for deletion. Retry after Google Drive connects."));
    return false;
  }
  return syncAttachmentRecord(record.id);
}

async function syncAttachmentUpload(record){
  await upsertAttachmentRecord({
    ...record,
    status: ATTACHMENT_STATUS.SYNCING,
    storageMode: STORAGE_MODE_DRIVE,
    pendingAction: ATTACHMENT_PENDING_ACTION.UPLOAD,
    lastError: ""
  });
  renderAttachmentsList();
  try{
    const driveFileId = await uploadAttachmentToDrive(record);
    await upsertAttachmentRecord({
      ...record,
      status: ATTACHMENT_STATUS.SYNCED,
      storageMode: STORAGE_MODE_DRIVE,
      driveFileId: driveFileId || record.driveFileId || null,
      pendingAction: ATTACHMENT_PENDING_ACTION.NONE,
      lastError: "",
      retryCount: 0
    });
    clearAttachmentRetry(record.id, ATTACHMENT_PENDING_ACTION.UPLOAD);
    return true;
  }catch(e){
    console.warn("Attachment sync failed:", e);
    const retryCount = Math.max(1, Number(record.retryCount) || 0) + 1;
    await upsertAttachmentRecord({
      ...record,
      status: ATTACHMENT_STATUS.ERROR,
      storageMode: STORAGE_MODE_DRIVE,
      pendingAction: ATTACHMENT_PENDING_ACTION.UPLOAD,
      lastError: String(e && e.message || e || ""),
      retryCount
    });
    enqueueAttachmentRetry(record.id, ATTACHMENT_PENDING_ACTION.UPLOAD, retryCount);
    return false;
  }
}

async function syncAttachmentDelete(record){
  await upsertAttachmentRecord({
    ...record,
    status: ATTACHMENT_STATUS.DELETE_PENDING,
    pendingAction: ATTACHMENT_PENDING_ACTION.DELETE,
    lastError: ""
  });
  renderAttachmentsList();
  try{
    await deleteAttachmentFromDrive(record.driveFileId);
    clearAttachmentRetry(record.id, ATTACHMENT_PENDING_ACTION.DELETE);
    await removeAttachmentRecord(record.id);
    return true;
  }catch(e){
    console.warn("Attachment delete failed:", e);
    const retryCount = Math.max(1, Number(record.retryCount) || 0) + 1;
    await upsertAttachmentRecord({
      ...record,
      status: ATTACHMENT_STATUS.ERROR,
      pendingAction: ATTACHMENT_PENDING_ACTION.DELETE,
      lastError: String(e && e.message || e || ""),
      retryCount
    });
    enqueueAttachmentRetry(record.id, ATTACHMENT_PENDING_ACTION.DELETE, retryCount);
    return false;
  }
}

async function syncAttachmentRecord(id){
  const record = attachmentsCache.find(row => row.id === String(id || ""));
  if(!record) return false;
  if(!isDriveSyncEnabled()) return false;
  if(attachmentHasPendingDelete(record)) return syncAttachmentDelete(record);
  if(!(record.blob instanceof Blob)) return false;
  return syncAttachmentUpload(record);
}

async function processDueAttachmentRetries(){
  const dueItems = getDueRetryQueueItems(readAttachmentRetryQueue(), Date.now());
  if(!dueItems.length) return;
  for(const item of dueItems){
    const record = attachmentsCache.find(row => row.id === String(item && item.id || ""));
    if(!record){
      clearAttachmentRetry(item.id, item.action);
      continue;
    }
    if(normalizePendingAction(item.action) === ATTACHMENT_PENDING_ACTION.DELETE){
      await syncAttachmentDelete(record);
      continue;
    }
    if(normalizePendingAction(item.action) === ATTACHMENT_PENDING_ACTION.UPLOAD){
      await syncAttachmentUpload(record);
    }
  }
}

async function syncAllAttachments(){
  if(attachmentsSyncInFlight) return;
  if(!isDriveSyncEnabled()){
    setAttachmentMessage(tOr("attachment_drive_sync_disabled", "Drive sync is disabled. Select Google Drive sync in Settings."), "error");
    return;
  }
  const connected = await ensureDriveConnection();
  if(!connected){
    setAttachmentMessage(tOr("attachment_connect_drive_first", "Connect Google Drive first, then run sync again."), "error");
    refreshStorageSyncUI();
    return;
  }

  const syncSummary = summarizeAttachmentOperations(attachmentsCache);
  if(syncSummary.pendingCount === 0){
    setAttachmentMessage(tOr("attachment_nothing_pending", "No pending attachment operations."));
    refreshStorageSyncUI();
    return;
  }

  attachmentsSyncInFlight = true;
  refreshStorageSyncUI();
  let success = 0;
  let failed = 0;
  await processDueAttachmentRetries();
  const deleteCandidates = listDeleteCandidates();
  for(const row of deleteCandidates){
    // eslint-disable-next-line no-await-in-loop
    const ok = await syncAttachmentDelete(row);
    if(ok) success += 1;
    else failed += 1;
    renderAttachmentsList();
  }
  const uploadCandidates = listSyncCandidates();
  for(const row of uploadCandidates){
    // eslint-disable-next-line no-await-in-loop
    const ok = await syncAttachmentUpload(row);
    if(ok) success += 1;
    else failed += 1;
    renderAttachmentsList();
  }
  attachmentsSyncInFlight = false;
  if(failed === 0) localStorage.setItem(ATTACHMENT_LAST_SYNC_KEY, nowIso());
  refreshStorageSyncUI();
  if(failed > 0){
    setAttachmentMessage(
      tOr("attachment_sync_finished_with_errors", "Sync finished: {success} completed, {failed} failed.")
        .replace("{success}", String(success))
        .replace("{failed}", String(failed)),
      "error"
    );
  } else {
    setAttachmentMessage(
      tOr("attachment_sync_finished", "Sync finished: {count} completed.")
        .replace("{count}", String(success))
    );
  }
}

async function applyAttachmentSyncMode(mode){
  const nextMode = setAttachmentSyncMode(mode);
  if(nextMode === STORAGE_MODE_DRIVE){
    for(const row of attachmentsCache){
      if(normalizeAttachmentStatus(row.status) === ATTACHMENT_STATUS.LOCAL_ONLY && !row.driveFileId){
        // eslint-disable-next-line no-await-in-loop
        await upsertAttachmentRecord({
          ...row,
          status: ATTACHMENT_STATUS.LOCAL_ONLY,
          storageMode: STORAGE_MODE_DRIVE,
          pendingAction: ATTACHMENT_PENDING_ACTION.UPLOAD,
          lastError: ""
        });
      }
    }
  } else {
    for(const row of attachmentsCache){
      const status = normalizeAttachmentStatus(row.status);
      if((status === ATTACHMENT_STATUS.LOCAL_ONLY || status === ATTACHMENT_STATUS.SYNCING || status === ATTACHMENT_STATUS.ERROR) && !row.driveFileId){
        // eslint-disable-next-line no-await-in-loop
        await upsertAttachmentRecord({
          ...row,
          status: ATTACHMENT_STATUS.LOCAL_ONLY,
          storageMode: STORAGE_MODE_LOCAL,
          pendingAction: ATTACHMENT_PENDING_ACTION.NONE,
          lastError: ""
        });
      }
    }
  }
  renderAttachmentsList();
  if(nextMode === STORAGE_MODE_LOCAL){
    setAttachmentMessage(tOr("attachment_storage_local_mode", "Storage mode set to Local only."));
  } else {
    setAttachmentMessage(tOr("attachment_storage_drive_mode", "Storage mode set to Google Drive sync."));
  }
}

async function initAttachmentsFeature(){
  await loadAttachmentsFromDb();
  renderAttachmentsList();

  const fileInput = document.getElementById("attachment-file-input");
  const inputModeSel = document.getElementById("attachment-input-mode");
  const manualSaveBtn = document.getElementById("attachment-manual-save-btn");
  const uploadBtn = document.getElementById("attachment-upload-btn");
  const listEl = document.getElementById("attachments-list");
  const previewClose = document.getElementById("attachment-preview-close");
  const previewOverlay = document.getElementById("attachment-preview-overlay");
  const localRadio = document.getElementById("storage-mode-local");
  const driveRadio = document.getElementById("storage-mode-drive");
  const connectBtn = document.getElementById("drive-connect-btn");
  const settingsSyncBtn = document.getElementById("drive-sync-now-btn");
  const entrySyncBtn = document.getElementById("entry-sync-now-btn");

  if(uploadBtn && fileInput){
    uploadBtn.addEventListener("click", ()=> fileInput.click());
    fileInput.addEventListener("change", async ()=>{
      const files = fileInput.files;
      fileInput.value = "";
      await handleAttachmentFiles(files);
    });
  }
  if(inputModeSel){
    inputModeSel.addEventListener("change", ()=> refreshAttachmentInputModeUI());
  }
  if(manualSaveBtn){
    manualSaveBtn.addEventListener("click", async ()=>{
      await handleManualAttachmentCreate();
    });
  }
  if(listEl){
    listEl.addEventListener("click", async (event)=>{
      const target = event.target instanceof Element ? event.target.closest("button[data-action]") : null;
      if(!target) return;
      const action = String(target.getAttribute("data-action") || "");
      const id = String(target.getAttribute("data-id") || "");
      if(!id) return;
      if(action === "preview"){
        await openAttachmentPreview(id);
        return;
      }
      if(action === "remove"){
        await requestAttachmentRemoval(id);
        renderAttachmentsList();
        return;
      }
      if(action === "sync"){
        const connected = await ensureDriveConnection();
        if(!connected){
          setAttachmentMessage(tOr("attachment_connect_drive_first", "Connect Google Drive first, then sync again."), "error");
          refreshStorageSyncUI();
          return;
        }
        const ok = await syncAttachmentRecord(id);
        if(ok) localStorage.setItem(ATTACHMENT_LAST_SYNC_KEY, nowIso());
        renderAttachmentsList();
        setAttachmentMessage(
          ok
            ? tOr("attachment_sync_single_success", "Attachment synced.")
            : tOr("attachment_sync_single_failed", "Attachment sync failed."),
          ok ? "info" : "error"
        );
      }
    });
  }
  if(localRadio){
    localRadio.addEventListener("change", async ()=>{
      if(localRadio.checked) await applyAttachmentSyncMode(STORAGE_MODE_LOCAL);
      refreshStorageSyncUI();
    });
  }
  if(driveRadio){
    driveRadio.addEventListener("change", async ()=>{
      if(driveRadio.checked) await applyAttachmentSyncMode(STORAGE_MODE_DRIVE);
      refreshStorageSyncUI();
    });
  }
  if(connectBtn){
    connectBtn.addEventListener("click", async ()=>{
      const connected = await ensureDriveConnection();
      if(!connected){
        setAttachmentMessage(tOr("attachment_google_auth_started", "Google authorization started. Confirm access and then sync."));
      } else {
        await processDueAttachmentRetries();
      }
      refreshStorageSyncUI();
    });
  }
  if(settingsSyncBtn){
    settingsSyncBtn.addEventListener("click", async ()=>{ await syncAllAttachments(); });
  }
  if(entrySyncBtn){
    entrySyncBtn.addEventListener("click", async ()=>{ await syncAllAttachments(); });
  }
  if(previewClose){
    previewClose.addEventListener("click", ()=> closeAttachmentPreview());
  }
  if(previewOverlay){
    previewOverlay.addEventListener("click", (event)=>{
      if(event.target === previewOverlay) closeAttachmentPreview();
    });
  }

  const initialMode = getAttachmentSyncMode();
  setAttachmentSyncMode(initialMode);
  refreshAttachmentInputModeUI();
  if(initialMode === STORAGE_MODE_DRIVE && hasGoogleDriveAccess()){
    await processDueAttachmentRetries();
  }
  refreshStorageSyncUI();
}

// -------- Offline cache (localStorage) --------
function cacheKeyTerms(){ return "cache/user_terms"; }
function cacheKeyReview(){ return "cache/user_review"; }
function cacheKeyWrongTermsLog(){ return "cache/wrong_terms_log_v1"; }
function cacheKeyStarredState(){ return "cache/starred_terms_state_v1"; }
function cacheKeyReviewState(){ return "cache/review_list_state_v1"; }

function readJsonLS(key, fallback){
  try{ const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; }
  catch(e){ return fallback; }
}
function writeJsonLS(key, val){ localStorage.setItem(key, JSON.stringify(val)); }

function deepClone(val){
  return JSON.parse(JSON.stringify(val));
}

function nowIso(){
  return new Date().toISOString();
}

function normalizeWhitespace(value){
  return String(value || "").replace(/\s+/g, " ").trim();
}

function displayCase(value){
  const text = normalizeWhitespace(value);
  if(!text) return "";
  return text.split(" ").map(part => {
    const p = String(part || "");
    if(!p) return "";
    if(p === p.toUpperCase() && p.length <= 3) return p;
    return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
  }).join(" ");
}

function tokenizeText(value){
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map(x => x.trim())
    .filter(Boolean);
}

function extractGermanArticle(value){
  const text = normalizeWhitespace(value);
  const m = text.match(/^(der|die|das)\s+(.+)$/i);
  if(!m) return { article: "", base: text };
  return {
    article: String(m[1] || "").toLowerCase(),
    base: normalizeWhitespace(m[2] || "")
  };
}

function defaultProfile(){
  const ts = nowIso();
  return {
    meta: {
      schema_version: 1,
      created_at: ts,
      updated_at: ts
    },
    terms: {},
    flashcards: {
      decks: {},
      cards: {},
      schedule: {},
      stats: {},
      v2_progress: {}
    },
    learning: {
      term_progress: {},
      quiz_sessions: [],
      mistakes: [],
      review_list: [],
      starred_state: { items: {} },
      review_state: { items: {} },
      custom_quizzes: { items: [] }
    },
    anamnesis: {
      records: [],
      active_patient_id: ""
    },
    settings: {}
  };
}

function ensureProfileShape(rawProfile){
  const base = defaultProfile();
  const merged = {
    ...base,
    ...(rawProfile && typeof rawProfile === "object" ? rawProfile : {})
  };
  merged.meta = {
    ...base.meta,
    ...(merged.meta && typeof merged.meta === "object" ? merged.meta : {})
  };
  merged.meta.schema_version = 1;
  merged.terms = merged.terms && typeof merged.terms === "object" ? merged.terms : {};
  merged.flashcards = {
    ...base.flashcards,
    ...(merged.flashcards && typeof merged.flashcards === "object" ? merged.flashcards : {})
  };
  merged.flashcards.decks = merged.flashcards.decks && typeof merged.flashcards.decks === "object" ? merged.flashcards.decks : {};
  merged.flashcards.cards = merged.flashcards.cards && typeof merged.flashcards.cards === "object" ? merged.flashcards.cards : {};
  merged.flashcards.schedule = merged.flashcards.schedule && typeof merged.flashcards.schedule === "object" ? merged.flashcards.schedule : {};
  merged.flashcards.stats = merged.flashcards.stats && typeof merged.flashcards.stats === "object" ? merged.flashcards.stats : {};
  merged.flashcards.v2_progress = merged.flashcards.v2_progress && typeof merged.flashcards.v2_progress === "object" ? merged.flashcards.v2_progress : {};
  merged.learning = {
    ...base.learning,
    ...(merged.learning && typeof merged.learning === "object" ? merged.learning : {})
  };
  merged.learning.term_progress = merged.learning.term_progress && typeof merged.learning.term_progress === "object" ? merged.learning.term_progress : {};
  merged.learning.quiz_sessions = Array.isArray(merged.learning.quiz_sessions) ? merged.learning.quiz_sessions : [];
  merged.learning.mistakes = Array.isArray(merged.learning.mistakes) ? merged.learning.mistakes : [];
  merged.learning.review_list = Array.isArray(merged.learning.review_list) ? merged.learning.review_list : [];
  merged.learning.starred_state = merged.learning.starred_state && typeof merged.learning.starred_state === "object" ? merged.learning.starred_state : { items: {} };
  merged.learning.review_state = merged.learning.review_state && typeof merged.learning.review_state === "object" ? merged.learning.review_state : { items: {} };
  merged.learning.custom_quizzes = merged.learning.custom_quizzes && typeof merged.learning.custom_quizzes === "object" ? merged.learning.custom_quizzes : { items: [] };
  if(!Array.isArray(merged.learning.custom_quizzes.items)) merged.learning.custom_quizzes.items = [];
  merged.anamnesis = merged.anamnesis && typeof merged.anamnesis === "object" ? merged.anamnesis : { records: [], active_patient_id: "" };
  if(!Array.isArray(merged.anamnesis.records)) merged.anamnesis.records = [];
  merged.anamnesis.active_patient_id = String(
    merged.anamnesis.active_patient_id ||
    merged.anamnesis.activePatientId ||
    ""
  ).trim();
  merged.settings = merged.settings && typeof merged.settings === "object" ? merged.settings : {};
  return merged;
}

function isProfileSessionActive(){
  return !!(gAccessToken && userProfile && profileFileId);
}

function markProfileDirty(){
  if(!isProfileSessionActive()) return;
  userProfile = ensureProfileShape(userProfile);
  userProfile.meta.updated_at = nowIso();
  profileDirty = true;
}

function normalizeTimedSetState(raw){
  const out = { items: {} };
  if(raw && typeof raw === "object" && raw.items && typeof raw.items === "object"){
    for(const [id, ts] of Object.entries(raw.items)){
      if(!id) continue;
      out.items[String(id)] = String(ts || nowIso());
    }
  }
  return out;
}

function buildNormalizedTerm(rawInput){
  const raw = {
    latin: normalizeWhitespace(rawInput && (rawInput.latin || rawInput.latin_translation)),
    english: normalizeWhitespace(rawInput && (rawInput.english || rawInput.english_translation)),
    german: normalizeWhitespace(rawInput && (rawInput.german || rawInput.german_translation)),
    slovak: normalizeWhitespace(rawInput && (rawInput.slovak || rawInput.slovak_translation)),
    notes: normalizeWhitespace(rawInput && (rawInput.notes || rawInput.english_definition || rawInput.german_definition))
  };
  const de = extractGermanArticle(raw.german);
  const norm = {
    latin: displayCase(raw.latin),
    english: displayCase(raw.english),
    german: displayCase(raw.german),
    german_article: de.article,
    german_base: displayCase(de.base),
    slovak: displayCase(raw.slovak),
    notes: normalizeWhitespace(raw.notes)
  };
  const tokenSet = new Set();
  [
    raw.latin, raw.english, raw.german, raw.slovak, raw.notes,
    norm.latin, norm.english, norm.german, norm.german_base, norm.slovak
  ].forEach(text => {
    tokenizeText(text).forEach(tok => tokenSet.add(tok));
  });
  norm.tokens = [...tokenSet];
  return { raw, norm };
}

function profileTermsToArray(){
  if(!isProfileSessionActive()) return readJsonLS(cacheKeyTerms(), []);
  const out = [];
  for(const [termId, row] of Object.entries(userProfile.terms || {})){
    const item = row && typeof row === "object" ? row : {};
    const raw = item.raw && typeof item.raw === "object" ? item.raw : {};
    const norm = item.norm && typeof item.norm === "object" ? item.norm : {};
    out.push({
      id: String(termId || ""),
      english: String(norm.english || raw.english || raw.english_translation || "").trim(),
      german: String(norm.german || raw.german || raw.german_translation || "").trim(),
      slovak: String(norm.slovak || raw.slovak || raw.slovak_translation || "").trim(),
      latin: String(norm.latin || raw.latin || raw.latin_translation || "").trim(),
      notes: String(norm.notes || raw.notes || raw.english_definition || raw.german_definition || "").trim(),
      raw,
      norm,
      created_at: String(item.created_at || ""),
      updated_at: String(item.updated_at || "")
    });
  }
  out.sort((a, b)=> String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  return out;
}

function upsertProfileTermFromRow(row){
  if(!isProfileSessionActive()) return;
  const normalized = buildNormalizedTerm(row || {});
  const ts = nowIso();
  const providedId = normalizeWhitespace(row && row.id);
  const generatedId = providedId || (
    (typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function")
      ? `term:${crypto.randomUUID()}`
      : `term:${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
  );
  const prev = userProfile.terms[generatedId] || {};
  userProfile.terms[generatedId] = {
    raw: normalized.raw,
    norm: normalized.norm,
    created_at: String(prev.created_at || ts),
    updated_at: ts
  };
  markProfileDirty();
}

function setProfileTermsFromArray(terms){
  if(!isProfileSessionActive()) return;
  const arr = Array.isArray(terms) ? terms : [];
  const next = {};
  for(const row of arr){
    const normalized = buildNormalizedTerm(row || {});
    const ts = nowIso();
    const providedId = normalizeWhitespace(row && row.id);
    const id = providedId || (
      (typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function")
        ? `term:${crypto.randomUUID()}`
        : `term:${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
    );
    const prev = (userProfile.terms && userProfile.terms[id]) || {};
    next[id] = {
      raw: normalized.raw,
      norm: normalized.norm,
      created_at: String(prev.created_at || row.created_at || ts),
      updated_at: String(row.updated_at || ts)
    };
  }
  userProfile.terms = next;
  markProfileDirty();
}

function getLocalTerms(){
  return profileTermsToArray();
}

function setLocalTerms(terms){
  if(isProfileSessionActive()){
    setProfileTermsFromArray(terms);
    return;
  }
  writeJsonLS(cacheKeyTerms(), terms || []);
}

function getEntryHistoryDisplayTitle(term){
  if(!term || typeof term !== "object") return "Untitled term";
  return String(
    term.english ||
    term.latin ||
    term.german ||
    term.slovak ||
    (term.category_fields && Object.values(term.category_fields).find(v => String(v || "").trim())) ||
    "Untitled term"
  ).trim() || "Untitled term";
}

function renderEntryHistory(){
  const list = document.getElementById("entry-history-list");
  const count = document.getElementById("entry-history-count");
  if(!list) return;
  const terms = getLocalTerms();
  if(count) count.textContent = String(terms.length || 0);
  if(!terms.length){
    list.innerHTML = '<div class="muted">No saved terms yet.</div>';
    return;
  }
  list.innerHTML = terms.slice(0, 50).map(term => {
    const title = getEntryHistoryDisplayTitle(term);
    const dataset = String(term.source_dataset || term.category || "").trim();
    const updated = term.updated_at ? new Date(term.updated_at).toLocaleString() : "";
    return `
      <div class="entry-history-item">
        <div class="entry-history-copy">
          <strong>${escapeHTML(title)}</strong>
          <div class="small">${escapeHTML(dataset || "custom")} ${updated ? `| ${escapeHTML(updated)}` : ""}</div>
        </div>
        <button type="button" class="danger" data-entry-delete-id="${escapeHTML(String(term.id || ""))}">Remove</button>
      </div>
    `;
  }).join("");
}

async function deleteEntryHistoryItem(id){
  const targetId = String(id || "").trim();
  if(!targetId) return;
  const current = getLocalTerms();
  const hit = current.find(term => String(term && term.id || "") === targetId);
  if(!hit) return;
  const label = getEntryHistoryDisplayTitle(hit);
  if(!confirm(`Remove "${label}" from added terms history?`)) return;
  setLocalTerms(current.filter(term => String(term && term.id || "") !== targetId));
  if(isProfileSessionActive()){
    await saveUserProfileNow("delete_term");
  }
  renderEntryHistory();
}

function getLocalReview(){
  if(isProfileSessionActive()) return Array.isArray(userProfile.learning.review_list) ? userProfile.learning.review_list : [];
  return readJsonLS(cacheKeyReview(), []);
}

function setLocalReview(items){
  const rows = Array.isArray(items) ? items : [];
  if(isProfileSessionActive()){
    userProfile.learning.review_list = rows;
    markProfileDirty();
  } else {
    writeJsonLS(cacheKeyReview(), rows);
  }
  rebuildReviewListStateFromLocalReview();
}

function getWrongTermsLog(){
  if(isProfileSessionActive()) return Array.isArray(userProfile.learning.mistakes) ? userProfile.learning.mistakes : [];
  return readJsonLS(cacheKeyWrongTermsLog(), []);
}

function setWrongTermsLog(items){
  const list = Array.isArray(items) ? items.slice(-1000) : [];
  if(isProfileSessionActive()){
    userProfile.learning.mistakes = list;
    markProfileDirty();
    return;
  }
  writeJsonLS(cacheKeyWrongTermsLog(), list);
}

function appendWrongTermsLog(entry){
  if(!entry) return;
  const list = getWrongTermsLog();
  const normalized = {
    ...entry,
    term_id: String(entry.term_id || entry.termId || ""),
    at: String(entry.at || entry.timestamp || nowIso()),
    from: String(entry.from || entry.fromField || ""),
    to: String(entry.to || entry.toField || "")
  };
  list.push(normalized);
  setWrongTermsLog(list);
}

function getStarredTermsState(){
  if(isProfileSessionActive()){
    return normalizeTimedSetState(userProfile.learning.starred_state || { items: {} });
  }
  return normalizeTimedSetState(readJsonLS(cacheKeyStarredState(), { items: {} }));
}

function setStarredTermsState(stateObj){
  const normalized = normalizeTimedSetState(stateObj);
  if(isProfileSessionActive()){
    userProfile.learning.starred_state = normalized;
    markProfileDirty();
    return;
  }
  writeJsonLS(cacheKeyStarredState(), normalized);
}

function markStarredTermState(termId, timestamp){
  const id = String(termId || "").trim();
  if(!id) return;
  const stateObj = getStarredTermsState();
  stateObj.items[id] = String(timestamp || nowIso());
  setStarredTermsState(stateObj);
}

function getReviewListState(){
  if(isProfileSessionActive()){
    return normalizeTimedSetState(userProfile.learning.review_state || { items: {} });
  }
  return normalizeTimedSetState(readJsonLS(cacheKeyReviewState(), { items: {} }));
}

function setReviewListState(stateObj){
  const normalized = normalizeTimedSetState(stateObj);
  if(isProfileSessionActive()){
    userProfile.learning.review_state = normalized;
    markProfileDirty();
    return;
  }
  writeJsonLS(cacheKeyReviewState(), normalized);
}

function reviewItemIdFromRow(row){
  if(!row) return "";
  if(row.user_term_id) return `user:${row.user_term_id}`;
  if(row.base_term_key) return String(row.base_term_key);
  return "";
}

function rebuildReviewListStateFromLocalReview(){
  const stateObj = getReviewListState();
  const now = nowIso();
  for(const row of getLocalReview()){
    const id = reviewItemIdFromRow(row);
    if(!id) continue;
    if(!stateObj.items[id]) stateObj.items[id] = now;
  }
  setReviewListState(stateObj);
}



// --- Utilities: async file loader ---
async function loadFile(filename) {
  const response = await fetch(filename);
  if(!response.ok){
    throw new Error(`Failed to load ${filename}: ${response.status}`);
  }
  return response.text();
}

function stripEtag(value){
  return String(value || "").replace(/^W\//, "").replace(/^"(.*)"$/, "$1").trim();
}

function profileTimeMs(value){
  const ms = new Date(String(value || "")).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function getTermProgressBucket(doc){
  const profile = ensureProfileShape(doc);
  const learning = profile.learning;
  if(!learning.term_progress || typeof learning.term_progress !== "object"){
    learning.term_progress = {};
  }
  if(!learning.term_progress.terms || typeof learning.term_progress.terms !== "object"){
    learning.term_progress.terms = {};
  }
  return learning.term_progress;
}

function mergeByUpdatedAt(localRow, remoteRow){
  const l = localRow && typeof localRow === "object" ? localRow : null;
  const r = remoteRow && typeof remoteRow === "object" ? remoteRow : null;
  if(!l && !r) return null;
  if(!l) return deepClone(r);
  if(!r) return deepClone(l);
  const lt = profileTimeMs(l.updated_at || l.updatedAt || l.last_seen);
  const rt = profileTimeMs(r.updated_at || r.updatedAt || r.last_seen);
  return deepClone(lt >= rt ? l : r);
}

function mergeProfiles(localProfileDoc, remoteProfileDoc){
  const local = ensureProfileShape(localProfileDoc);
  const remote = ensureProfileShape(remoteProfileDoc);
  const merged = ensureProfileShape(remote);

  const localTerms = local.terms || {};
  const remoteTerms = remote.terms || {};
  const termKeys = new Set([...Object.keys(remoteTerms), ...Object.keys(localTerms)]);
  const nextTerms = {};
  for(const key of termKeys){
    const row = mergeByUpdatedAt(localTerms[key], remoteTerms[key]);
    if(row) nextTerms[key] = row;
  }
  merged.terms = nextTerms;

  const localProg = getTermProgressBucket(local).terms || {};
  const remoteProg = getTermProgressBucket(remote).terms || {};
  const progKeys = new Set([...Object.keys(remoteProg), ...Object.keys(localProg)]);
  const nextProg = {};
  for(const key of progKeys){
    const l = localProg[key];
    const r = remoteProg[key];
    if(!l) nextProg[key] = deepClone(r);
    else if(!r) nextProg[key] = deepClone(l);
    else {
      const ll = profileTimeMs(l.last_seen || l.updatedAt || l.updated_at);
      const rr = profileTimeMs(r.last_seen || r.updatedAt || r.updated_at);
      nextProg[key] = deepClone(ll >= rr ? l : r);
    }
  }
  getTermProgressBucket(merged).terms = nextProg;

  const mistakes = [];
  const seenMistake = new Set();
  for(const row of [...(remote.learning.mistakes || []), ...(local.learning.mistakes || [])]){
    if(!row || typeof row !== "object") continue;
    const key = [
      String(row.term_id || row.termId || ""),
      String(row.at || row.timestamp || ""),
      String(row.from || row.fromField || ""),
      String(row.to || row.toField || "")
    ].join("|");
    if(!key || seenMistake.has(key)) continue;
    seenMistake.add(key);
    mistakes.push(row);
  }
  merged.learning.mistakes = mistakes.slice(-3000);

  const mergeObjectMap = (remoteMap, localMap)=>{
    const out = { ...(remoteMap || {}) };
    for(const [key, value] of Object.entries(localMap || {})){
      const hit = out[key];
      if(!hit){
        out[key] = deepClone(value);
        continue;
      }
      const winner = mergeByUpdatedAt(value, hit);
      out[key] = winner === null ? deepClone(hit) : winner;
    }
    return out;
  };

  merged.flashcards.decks = mergeObjectMap(remote.flashcards.decks, local.flashcards.decks);
  merged.flashcards.cards = mergeObjectMap(remote.flashcards.cards, local.flashcards.cards);
  merged.flashcards.schedule = mergeObjectMap(remote.flashcards.schedule, local.flashcards.schedule);
  merged.flashcards.v2_progress = { ...(remote.flashcards.v2_progress || {}), ...(local.flashcards.v2_progress || {}) };
  merged.flashcards.stats = { ...(remote.flashcards.stats || {}), ...(local.flashcards.stats || {}) };

  merged.learning.review_list = [...(remote.learning.review_list || [])];
  for(const row of (local.learning.review_list || [])){
    const key = `${row && row.base_term_key || ""}|${row && row.base_dataset || ""}|${row && row.user_term_id || ""}`;
    const exists = merged.learning.review_list.some(x => `${x && x.base_term_key || ""}|${x && x.base_dataset || ""}|${x && x.user_term_id || ""}` === key);
    if(!exists) merged.learning.review_list.push(row);
  }
  merged.learning.quiz_sessions = [...(remote.learning.quiz_sessions || []), ...(local.learning.quiz_sessions || [])]
    .sort((a, b)=> profileTimeMs(b && b.finishedAt) - profileTimeMs(a && a.finishedAt))
    .slice(0, 200);
  merged.learning.custom_quizzes = {
    items: [...(remote.learning.custom_quizzes && remote.learning.custom_quizzes.items || [])]
  };
  for(const row of (local.learning.custom_quizzes && local.learning.custom_quizzes.items || [])){
    const id = String(row && row.quizId || "");
    if(!id) continue;
    const idx = merged.learning.custom_quizzes.items.findIndex(x => x && String(x.quizId || "") === id);
    if(idx < 0) merged.learning.custom_quizzes.items.push(row);
    else merged.learning.custom_quizzes.items[idx] = mergeByUpdatedAt(row, merged.learning.custom_quizzes.items[idx]) || row;
  }
  merged.learning.starred_state = normalizeTimedSetState({
    items: {
      ...((remote.learning.starred_state && remote.learning.starred_state.items) || {}),
      ...((local.learning.starred_state && local.learning.starred_state.items) || {})
    }
  });
  merged.learning.review_state = normalizeTimedSetState({
    items: {
      ...((remote.learning.review_state && remote.learning.review_state.items) || {}),
      ...((local.learning.review_state && local.learning.review_state.items) || {})
    }
  });

  merged.anamnesis = mergeAnamnesisRegistryStates(local.anamnesis, remote.anamnesis);
  merged.anamnesis.active_patient_id = String(merged.anamnesis.activePatientId || "").trim();
  delete merged.anamnesis.activePatientId;

  merged.settings = {
    ...(remote.settings || {}),
    ...(local.settings || {})
  };

  merged.meta.created_at = String(remote.meta.created_at || local.meta.created_at || nowIso());
  merged.meta.updated_at = nowIso();
  merged.meta.schema_version = 1;
  return merged;
}

function toMultipartRelated({ metadata, content }){
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
    `--${boundary}--`
  ].join("\r\n");
  return { boundary, body };
}

async function driveFetch(url, opts = {}){
  if(!gAccessToken) throw new Error("Google access token missing.");
  const options = opts || {};
  const allowStatuses = Array.isArray(options.allowStatuses) ? options.allowStatuses : [];
  const headers = {
    Authorization: `Bearer ${gAccessToken}`,
    ...(options.headers || {})
  };
  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body
  });
  if(res.ok || allowStatuses.includes(res.status)) return res;
  let detail = "";
  try{
    const err = await res.json();
    detail = err && err.error && err.error.message ? String(err.error.message) : "";
  }catch(e){}
  throw new Error(`Drive request failed (${res.status})${detail ? `: ${detail}` : ""}`);
}

async function driveFindProfileFile(){
  const q = encodeURIComponent("name='profile.json' and trashed=false");
  const urls = [
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime,etag)`,
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime)`
  ];
  for(const url of urls){
    try{
      const res = await driveFetch(url);
      const json = await res.json();
      const files = Array.isArray(json && json.files) ? json.files : [];
      const hit = files.find(f => String(f && f.name || "") === "profile.json");
      if(hit) return {
        id: String(hit.id || ""),
        etag: String(hit.etag || ""),
        modifiedTime: String(hit.modifiedTime || "")
      };
      return null;
    }catch(e){
      if(url === urls[urls.length - 1]) throw e;
    }
  }
  return null;
}

async function driveCreateProfileFile(profileDoc){
  const metadata = { name: "profile.json", parents: ["appDataFolder"], mimeType: "application/json" };
  const multipart = toMultipartRelated({ metadata, content: profileDoc });
  try{
    const res = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,etag", {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${multipart.boundary}`
      },
      body: multipart.body
    });
    const data = await res.json();
    return {
      id: String(data && data.id || ""),
      etag: String(data && data.etag || stripEtag(res.headers.get("ETag")) || "")
    };
  }catch(e){
    const res = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${multipart.boundary}`
      },
      body: multipart.body
    });
    const data = await res.json();
    return {
      id: String(data && data.id || ""),
      etag: String(stripEtag(res.headers.get("ETag")) || "")
    };
  }
}

async function driveGetFileMeta(fileId){
  const id = encodeURIComponent(String(fileId || "").trim());
  try{
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,modifiedTime,etag`);
    const data = await res.json();
    return {
      id: String(data && data.id || ""),
      etag: String(data && data.etag || stripEtag(res.headers.get("ETag")) || ""),
      modifiedTime: String(data && data.modifiedTime || "")
    };
  }catch(e){
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,modifiedTime`);
    const data = await res.json();
    return {
      id: String(data && data.id || ""),
      etag: String(stripEtag(res.headers.get("ETag")) || ""),
      modifiedTime: String(data && data.modifiedTime || "")
    };
  }
}

async function driveDownloadFile(fileId){
  const id = encodeURIComponent(String(fileId || "").trim());
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  const doc = await res.json();
  const meta = await driveGetFileMeta(fileId);
  return {
    doc: ensureProfileShape(doc),
    etag: String(meta.etag || stripEtag(res.headers.get("ETag")) || "")
  };
}

async function driveUpdateProfileFile(fileId, profileDoc, etag){
  const id = encodeURIComponent(String(fileId || "").trim());
  const metadata = { name: "profile.json", mimeType: "application/json" };
  const multipart = toMultipartRelated({ metadata, content: profileDoc });
  const headers = {
    "Content-Type": `multipart/related; boundary=${multipart.boundary}`
  };
  const cleanEtag = stripEtag(etag);
  if(cleanEtag) headers["If-Match"] = `"${cleanEtag}"`;
  try{
    const res = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart&fields=id,etag`, {
      method: "PATCH",
      headers,
      body: multipart.body,
      allowStatuses: [412]
    });
    if(res.status === 412){
      return { conflict: true, etag: "" };
    }
    const data = await res.json();
    return {
      conflict: false,
      etag: String(data && data.etag || stripEtag(res.headers.get("ETag")) || "")
    };
  }catch(e){
    const res = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart&fields=id`, {
      method: "PATCH",
      headers,
      body: multipart.body,
      allowStatuses: [412]
    });
    if(res.status === 412){
      return { conflict: true, etag: "" };
    }
    return {
      conflict: false,
      etag: String(stripEtag(res.headers.get("ETag")) || "")
    };
  }
}

function startProfileAutosave(){
  if(profileAutosaveTimer) clearInterval(profileAutosaveTimer);
  profileAutosaveTimer = setInterval(()=>{
    if(profileDirty){
      saveUserProfileNow("autosave");
    }
  }, 60000);
}

function stopProfileAutosave(){
  if(profileAutosaveTimer){
    clearInterval(profileAutosaveTimer);
    profileAutosaveTimer = null;
  }
}

function stopAnamnesisProfileSave(){
  if(anamnesisProfileSaveTimer){
    clearTimeout(anamnesisProfileSaveTimer);
    anamnesisProfileSaveTimer = null;
  }
}

function scheduleAnamnesisProfileSave(delayMs = 1800){
  if(!isProfileSessionActive()) return;
  stopAnamnesisProfileSave();
  anamnesisProfileSaveTimer = setTimeout(()=>{
    anamnesisProfileSaveTimer = null;
    if(profileDirty){
      saveUserProfileNow("anamnesis");
    }
  }, Math.max(250, Number(delayMs) || 1800));
}

async function saveUserProfileNow(reason = "manual"){
  if(!isProfileSessionActive() || !profileDirty || !profileFileId) return;
  if(profileSaveInFlight){
    profileSaveQueued = true;
    return;
  }
  profileSaveInFlight = true;
  try{
    userProfile = ensureProfileShape(userProfile);
    userProfile.meta.updated_at = nowIso();
    let saveRes = await driveUpdateProfileFile(profileFileId, userProfile, profileFileEtag);
    if(saveRes.conflict){
      const remote = await driveDownloadFile(profileFileId);
      userProfile = mergeProfiles(userProfile, remote.doc);
      profileFileEtag = remote.etag || profileFileEtag;
      saveRes = await driveUpdateProfileFile(profileFileId, userProfile, profileFileEtag);
      if(saveRes.conflict){
        throw new Error("Cloud profile changed during save. Please retry.");
      }
    }
    if(saveRes.etag) profileFileEtag = saveRes.etag;
    profileDirty = false;
    if(!["autosave", "anamnesis", "signin_merge", "queued"].includes(String(reason || ""))){
      setLoginStatus("Profile saved.", "ok");
    }
  }catch(e){
    console.warn("Profile save failed:", e);
    setLoginStatus(`Error saving profile: ${e.message || e}`, "error");
  }finally{
    profileSaveInFlight = false;
    if(profileSaveQueued){
      profileSaveQueued = false;
      if(profileDirty){
        saveUserProfileNow("queued");
      }
    }
  }
}

async function loadOrCreateDriveProfile(){
  const existing = await driveFindProfileFile();
  if(!existing){
    userProfile = ensureProfileShape(defaultProfile());
    const created = await driveCreateProfileFile(userProfile);
    if(!created.id){
      throw new Error("Failed to create profile.json in appDataFolder.");
    }
    profileFileId = created.id;
    profileFileEtag = created.etag || "";
    profileDirty = false;
    return userProfile;
  }
  if(!existing.id){
    throw new Error("Google Drive returned an invalid profile file id.");
  }
  profileFileId = existing.id;
  const downloaded = await driveDownloadFile(existing.id);
  profileFileEtag = downloaded.etag || stripEtag(existing.etag) || "";
  userProfile = ensureProfileShape(downloaded.doc);
  profileDirty = false;
  return userProfile;
}

async function handleGoogleTokenResponse(resp){
  console.log("GOOGLE TOKEN CALLBACK:", resp);
  console.log("[AUTH] token callback resp:", resp);
  if(resp && resp.error){
    console.error("Google sign-in error:", resp.error, resp.error_description || "");
    setLoginStatus(`Error: ${resp.error_description || resp.error || "Google sign-in failed."}`, "error");
    gAuthInFlight = false;
    return;
  }
  if(!resp || !resp.access_token){
    console.error("No access token returned");
    setLoginStatus("Error: No access token returned.", "error");
    gAuthInFlight = false;
    return;
  }
  gAccessToken = String(resp.access_token || "").trim();
  const expiresIn = Number(resp && resp.expires_in || 0);
  gTokenExpiresAt = expiresIn > 0 ? (Date.now() + expiresIn * 1000) : 0;
  try{
    console.log("[AUTH] got access token, loading Drive profile...");
    await loadOrCreateDriveProfile();
    loadAnamnesisRegistryFromStorage();
    if(getAttachmentSyncMode() !== STORAGE_MODE_DRIVE){
      await applyAttachmentSyncMode(STORAGE_MODE_DRIVE);
    }
    refreshStorageSyncUI();
    if(profileDirty){
      await saveUserProfileNow("signin_merge");
    }
    const about = await driveLoadCurrentUser().catch(()=> ({ displayName: "", emailAddress: "" }));
    const profileLang = normalizeLanguage((userProfile && userProfile.settings && userProfile.settings.app_language) || state.language);
    const profileTextSize = String((userProfile && userProfile.settings && userProfile.settings.text_size) || (localStorage.getItem(TEXT_SIZE_KEY) || "4"));
    const profileTheme = normalizeTheme((userProfile && userProfile.settings && userProfile.settings.app_theme) || localStorage.getItem(APP_THEME_KEY) || "light");
    await setLanguage(profileLang);
    applyTextSize(profileTextSize);
    syncTextSizeForViewport({ force: true });
    applyTheme(profileTheme, { persist: true });
    const sizeSlider = document.getElementById("text-size-slider");
    if(sizeSlider) sizeSlider.value = isPhoneTextSizeViewport() ? String(PHONE_TEXT_SIZE_STEP) : profileTextSize;
    state.currentUser = about.displayName || about.emailAddress || tOr("auth_google_user", "Google user");
    state.currentUserEmail = about.emailAddress || "";
    updateAuthUI();
    startProfileAutosave();
    setLoginStatus(tOr("auth_profile_loaded", "Profile loaded."), "ok");
    showScreen("screen-submenu");
    renderQuizUI();
    if(flashcardsV2State.loaded){
      syncFlashcardsDashboard();
      renderFlashcardsPlayer();
    }
    if(anamnesisRegistryInitialized){
      renderAnamnesisPatientList();
      await loadAnamnesisForm();
    }
    refreshLabParametersUI();
  }catch(e){
    console.warn("Google sign-in failed:", e);
    setLoginStatus(`Error: ${e.message || e}`, "error");
  }finally{
    gAuthInFlight = false;
  }
}

function initGoogleTokenClient(){
  if(gTokenClient) return gTokenClient;
  if(!(window.google && google.accounts && google.accounts.oauth2)){
    throw new Error("Google Identity Services script not loaded.");
  }
  const clientId = String(GOOGLE_CLIENT_ID || "").trim();
  if(!clientId){
    throw new Error("GOOGLE_CLIENT_ID is empty.");
  }
  gTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: GOOGLE_SCOPES,
    callback: (resp) => {
      void handleGoogleTokenResponse(resp);
    }
  });
  return gTokenClient;
}

async function driveLoadCurrentUser(){
  const res = await driveFetch("https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)");
  const data = await res.json();
  const user = data && data.user ? data.user : {};
  return {
    displayName: String(user.displayName || "").trim(),
    emailAddress: String(user.emailAddress || "").trim()
  };
}

function requestGoogleAccessTokenFromClick(){
  console.log("[AUTH] signInWithGoogleDrive start");
  if(gAuthInFlight) return;
  gAuthInFlight = true;
  clearLoginStatus();
  setLoginStatus(tOr("auth_connecting", "Connecting..."), "info");
  try{
    initGoogleTokenClient();
    console.log("[AUTH] requestAccessToken() called. userActivation expected.");
    gTokenClient.requestAccessToken({ prompt: "consent" });
  }catch(e){
    gAuthInFlight = false;
    setLoginStatus(`Error: ${e.message || e}`, "error");
  }
}

function wireGoogleBtnOnce(){
  if(googleBtnWired) return;
  googleBtnWired = true;
  const btn = document.getElementById("btn-google-drive");
  if(!btn){
    console.warn("Missing element: btn-google-drive");
    return;
  }
  btn.addEventListener("click", () => {
    requestGoogleAccessTokenFromClick();
  });
}

async function signOutGoogleDrive(){
  if(profileDirty){
    await saveUserProfileNow("signout");
  }
  stopAnamnesisProfileSave();
  const token = gAccessToken;
  gAccessToken = "";
  gTokenExpiresAt = 0;
  gAuthInFlight = false;
  userProfile = null;
  profileFileId = "";
  profileFileEtag = "";
  profileDirty = false;
  profileSaveQueued = false;
  profileSaveInFlight = false;
  stopProfileAutosave();
  state.currentUser = null;
  state.currentUserEmail = null;
  if(typeof quizLastFinishedState !== "undefined") quizLastFinishedState = null;
  if(typeof flashcardsV2State !== "undefined" && flashcardsV2State && flashcardsV2State.session){
    flashcardsV2State.session.deck = [];
    flashcardsV2State.session.index = 0;
    flashcardsV2State.session.revealed = false;
    flashcardsV2State.session.querySnapshot = null;
  }
  if(token && window.google && google.accounts && google.accounts.oauth2 && typeof google.accounts.oauth2.revoke === "function"){
    try{ google.accounts.oauth2.revoke(token, ()=>{}); }catch(e){}
  }
  updateAuthUI();
  try{ renderQuizUI(); }catch(e){}
  try{
    if(typeof renderFlashcardsPlayer === "function") renderFlashcardsPlayer();
    if(typeof syncFlashcardsDashboard === "function") syncFlashcardsDashboard();
  }catch(e){}
  setLoginStatus(tOr("auth_signed_out", "Signed out."), "info");
}

// --- Utilities: robust CSV parser for quoted fields (RFC4180-ish) ---
// --- Translation loader ---
const translations = {};
const anamnesisDictionary = new Map();
const anamnesisDictionaryById = new Map();
const anamnesisTextNodes = new WeakMap();
const BUILTIN_TRANSLATION_FALLBACKS = {
  English: {
    dataset_anatomy: "Anatomy",
    dataset_physiology: "Physiology",
    dataset_latin_abbreviations: "Latin abbreviations",
    dataset_latin_greek: "Latin-Greek synonyms",
    dataset_latin_remedies: "Remedies",
    dataset_latin_units: "Latin units",
    dataset_muscles: "Muscles",
    field_normal_range_units: "Normal range and units",
    latin_search_notes: "Notes"
  },
  Deutsch: {
    dataset_anatomy: "Anatomie",
    dataset_physiology: "Physiologie",
    dataset_latin_abbreviations: "Lateinische Abkuerzungen",
    dataset_latin_greek: "Lateinisch-griechische Synonyme",
    dataset_latin_remedies: "Heilmittel",
    dataset_latin_units: "Lateinische Lektionen",
    dataset_muscles: "Muskeln",
    field_normal_range_units: "Referenzbereich und Einheiten",
    latin_search_notes: "Notizen"
  },
  Slovensky: {
    dataset_anatomy: "Anatomia",
    dataset_physiology: "Fyziologia",
    dataset_latin_abbreviations: "Latinske skratky",
    dataset_latin_greek: "Latinsko-grecke synonyma",
    dataset_latin_remedies: "Lieciva",
    dataset_latin_units: "Latinske lekcie",
    dataset_muscles: "Svaly",
    field_normal_range_units: "Normalne rozmedzie a jednotky",
    latin_search_notes: "Poznamky"
  }
};
const ANAMNESIS_DICTIONARY_CANDIDATE_GROUPS = [
  [
    resolveBundledDataUrl("app_language/anamnesis_internal.csv"),
    "data/app_language/anamnesis_internal.csv"
  ],
  [
    resolveBundledDataUrl("app_language/anamnesis_pediatrics.csv"),
    "data/app_language/anamnesis_pediatrics.csv"
  ]
];

function normalizeAnamnesisText(text){
  return String(text || '').replace(/\s+/g, ' ').trim();
}

const anamnesisDictionaryState = {
  loaded: false,
  failed: false,
  loadPromise: null
};

async function loadAnamnesisDictionary(){
  try{
    const parsedGroups = [];
    let lastErr = null;
    for(const candidates of ANAMNESIS_DICTIONARY_CANDIDATE_GROUPS){
      let rows = null;
      for(const path of candidates){
        try{
          const txt = await loadFile(path);
          if(!String(txt || '').trim()) continue;
          const parsed = parseCSVLines(txt);
          if(parsed.length < 1) continue;
          const headers = (parsed[0] || []).map(h => String(h || '').replace(/^\uFEFF/, '').trim().toLowerCase());
          const hasId = headers.includes('id_anamnesis') || headers.includes('id');
          const hasEnglish = headers.includes('english_translation');
          if(hasId && hasEnglish){
            rows = parsed;
            break;
          }
        }catch(e){
          lastErr = e;
        }
      }
      if(rows) parsedGroups.push(rows);
    }
    if(parsedGroups.length === 0){
      if(lastErr) throw lastErr;
      throw new Error('Anamnesis files could not be loaded');
    }
    anamnesisDictionary.clear();
    anamnesisDictionaryById.clear();
    for(const rows of parsedGroups){
      const objects = rowsToObjects(rows);
      for(const row of objects){
        const key = String(
          row.id_anamnesis ||
          row.ID_ANAMNESIS ||
          row.id ||
          ''
        ).trim();
        const english = normalizeAnamnesisText(row.english_translation);
        const german = normalizeAnamnesisText(row.german_translation);
        const slovak = normalizeAnamnesisText(row.slovak_translation);
        if(key){
          anamnesisDictionaryById.set(key, { key, english, german, slovak });
        }
        if(!english) continue;
        anamnesisDictionary.set(english, { english, german, slovak });
      }
    }
    if(anamnesisDictionaryById.size === 0){
      throw new Error("Anamnesis dictionaries loaded, but no id_anamnesis keys were parsed");
    }
  }catch(e){
    console.warn('Anamnesis translations load failed:', e.message || e);
    anamnesisDictionary.clear();
    anamnesisDictionaryById.clear();
  }
}

async function ensureAnamnesisDictionaryLoaded(){
  if(anamnesisDictionaryState.loaded) return true;
  if(anamnesisDictionaryState.loadPromise) return anamnesisDictionaryState.loadPromise;
  anamnesisDictionaryState.loadPromise = (async ()=>{
    try{
      await loadAnamnesisDictionary();
      anamnesisDictionaryState.loaded = anamnesisDictionaryById.size > 0 || anamnesisDictionary.size > 0;
      anamnesisDictionaryState.failed = !anamnesisDictionaryState.loaded;
      return anamnesisDictionaryState.loaded;
    }catch(e){
      anamnesisDictionaryState.failed = true;
      return false;
    }finally{
      anamnesisDictionaryState.loadPromise = null;
    }
  })();
  return anamnesisDictionaryState.loadPromise;
}

function translateAnamnesisText(baseText){
  const normalized = normalizeAnamnesisText(baseText);
  if(!normalized) return baseText;
  const row = anamnesisDictionary.get(normalized);
  if(!row) return baseText;
  const lang = normalizeLanguage(state.language);
  if(lang === 'Slovensky' && row.slovak) return row.slovak;
  if(lang === 'Deutsch' && row.german) return row.german;
  if(lang === 'English') return row.english || baseText;
  return row.english || baseText;
}

function translateAnamnesisById(key, fallbackText = ''){
  const row = anamnesisDictionaryById.get(String(key || '').trim());
  if(!row) return fallbackText;
  const lang = normalizeLanguage(state.language);
  if(lang === 'Slovensky' && row.slovak) return row.slovak;
  if(lang === 'Deutsch' && row.german) return row.german;
  if(lang === 'English') return row.english || fallbackText;
  return row.english || fallbackText;
}

function applyAnamnesisTranslationsToDom(){
  const section = document.getElementById('anamnesis-editor-card');
  if(!section || (anamnesisDictionary.size === 0 && anamnesisDictionaryById.size === 0)) return;

  section.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el=>{
    if(!el.dataset.anamBasePlaceholder){
      el.dataset.anamBasePlaceholder = el.getAttribute('placeholder') || '';
    }
    const base = el.dataset.anamBasePlaceholder;
    const key = String(el.dataset.anamKey || '').trim();
    if(key){
      el.setAttribute('placeholder', translateAnamnesisById(key, base));
      return;
    }
    if(!base) return;
    el.setAttribute('placeholder', translateAnamnesisText(base));
  });

  section.querySelectorAll('h2,h3,strong,span,label,summary,th,td,button,option').forEach(el=>{
    const key = String(el.dataset.anamKey || '').trim();
    if(key){
      const baseText = String(el.dataset.anamBaseText || el.textContent || '');
      if(!el.dataset.anamBaseText) el.dataset.anamBaseText = baseText;
      const translated = translateAnamnesisById(key, baseText);
      if(el.childElementCount > 0){
        let textNode = null;
        for(const n of el.childNodes){
          if(n.nodeType === Node.TEXT_NODE){
            textNode = n;
            break;
          }
        }
        if(!textNode){
          textNode = document.createTextNode("");
          el.appendChild(textNode);
        }
        textNode.nodeValue = " " + translated;
      } else {
        el.textContent = translated;
      }
      return;
    }
    let nodes = anamnesisTextNodes.get(el);
    if(!nodes){
      nodes = [];
      el.childNodes.forEach(node=>{
        if(node.nodeType !== Node.TEXT_NODE) return;
        const template = node.nodeValue || '';
        const base = normalizeAnamnesisText(template);
        if(!base) return;
        nodes.push({ node, template, base });
      });
      anamnesisTextNodes.set(el, nodes);
    }
    for(const item of nodes){
      const translated = translateAnamnesisText(item.base);
      item.node.nodeValue = item.template.replace(item.base, translated);
    }
  });
}

const TRANSLATION_LANG_CANON = {
  english: "English",
  en: "English",
  deutsch: "Deutsch",
  deutch: "Deutsch",
  german: "Deutsch",
  slovensky: "Slovensky",
  slovak: "Slovensky"
};

function normalizeTranslationHeader(header){
  const raw = String(header || "").trim();
  if(!raw) return raw;
  const key = raw.toLowerCase();
  return TRANSLATION_LANG_CANON[key] || raw;
}

async function loadTranslations(){
  try{
    const txt = await loadFile(resolveBundledDataUrl('app_language/app_translations.csv'));
    const rows = parseCSVLines(txt);
    if(rows.length < 1) throw new Error('No data in translations file');

    Object.keys(translations).forEach(k => delete translations[k]);

    const headers = rows[0].map(h => repairMojibake(String(h || '').trim()));
    for(let i = 1; i < headers.length; i++) {
      const lang = normalizeTranslationHeader(headers[i]);
      translations[lang] = {};
    }

    for(let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const key = repairMojibake(String(row[0] || '').trim());
      if(!key) continue;

      for(let j = 1; j < headers.length; j++) {
        const lang = normalizeTranslationHeader(headers[j]);
        const text = repairMojibake(String(row[j] || '').trim());
        if(text) translations[lang][key] = text;
      }
    }

    const variations = {
      'english': 'English',
      'en': 'English',
      'deutch': 'Deutsch',
      'deutsch': 'Deutsch',
      'german': 'Deutsch',
      'slovensky': 'Slovensky',
      'slovak': 'Slovensky'
    };
    Object.entries(variations).forEach(([variant, standard]) => {
      if(translations[standard]) translations[variant] = translations[standard];
    });

    for(const [lang, entries] of Object.entries(BUILTIN_TRANSLATION_FALLBACKS)){
      const bucket = translations[lang] && typeof translations[lang] === "object"
        ? translations[lang]
        : (translations[lang] = {});
      for(const [key, value] of Object.entries(entries)){
        if(!bucket[key]) bucket[key] = value;
      }
    }

    Object.entries(variations).forEach(([variant, standard]) => {
      if(translations[standard]) translations[variant] = translations[standard];
    });
  }catch(e){
    console.warn('Translations load failed:', e.message);
  }
}

// --- Medical terms loader ---
const LAB_TAG_FILTER_MODE = "AND"; // switch to "OR" to allow any selected tag
const LAB_SEARCH_DEBOUNCE_MS = 200;
const LAB_VISIBLE_TAGS_ON_CARD = 3;

let medicalTerms = [];
const medicalDataRepository = createMedicalDataRepository({
  loadText: loadBaseFile,
  parseCSVLines,
  rowsToObjectsWithHeaders,
  onLoadError: (...args)=>console.warn(...args)
});

async function ensureMedicalDatasetsLoaded(datasetKeys){
  await medicalDataRepository.ensureMedicalDatasetsLoaded(datasetKeys);
  medicalTerms = medicalDataRepository.getAllTerms();
  return medicalTerms;
}

function isSearchGroupLoaded(groupKey){
  return medicalDataRepository.isSearchGroupLoaded(groupKey);
}

function areAllSearchGroupsLoaded(){
  return medicalDataRepository.areAllSearchGroupsLoaded();
}

async function loadMedicalTerms(options = {}) {
  medicalTerms = await medicalDataRepository.loadMedicalTerms(options);
  return medicalTerms;
}

function normalizeSearchText(value){
  return normalizeSearchLoose(String(value || "").trim().toLowerCase());
}

function normalizeAtcCode(value){
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

let pharmacologyRecords = [];
const pharmacologyRepository = createPharmacologyRepository({
  loadText: loadBaseFile,
  parseCSVLines,
  rowsToObjects,
  normalizeSearchText,
  toFileSafeName,
  onLoadError: (...args)=>console.warn(...args)
});
const pharmacologyState = pharmacologyRepository.state;

function getDrugPharmacologyRecord(drugId){
  return pharmacologyRepository.getDrugRecord(drugId);
}

function getAtcChildren(parentCode){
  return pharmacologyRepository.getAtcChildren(parentCode);
}

function getAtcFilterLabel(atcCode){
  return pharmacologyRepository.getAtcFilterLabel(atcCode);
}

function searchPharmacology(query){
  pharmacologyRecords = pharmacologyRepository.getRecords();
  return pharmacologyRepository.search(query);
}

async function ensurePharmacologyIndexLoaded(options = {}){
  pharmacologyRecords = await pharmacologyRepository.ensureLoaded(options);
  return pharmacologyRecords;
}

// --- Muscles loader ---
let muscleTerms = [];
const musclesLoadState = {
  loaded: false,
  failed: false,
  loadPromise: null
};
async function loadMuscles() {
  try {
    const txt = await loadBaseFile('terminology/muscles.csv');
    const rows = parseCSVLines(txt);
    if(rows.length < 1) throw new Error('No data in muscles file');
    muscleTerms = rowsToObjects(rows);
    musclesLoadState.loaded = true;
    musclesLoadState.failed = false;
  } catch(e) {
    console.warn('Muscles load failed:', e.message);
    muscleTerms = [];
    musclesLoadState.loaded = false;
    musclesLoadState.failed = true;
  }
}

async function ensureMusclesLoaded(){
  if(musclesLoadState.loaded) return muscleTerms;
  if(musclesLoadState.loadPromise) return musclesLoadState.loadPromise;
  musclesLoadState.loadPromise = loadMuscles().finally(()=>{
    musclesLoadState.loadPromise = null;
  });
  await musclesLoadState.loadPromise;
  return muscleTerms;
}

// --- Biophysics True/False loader ---
const BIOPHYSICS_TF_FILE = "terminology/biophysics.csv";
const BIOPHYSICS_TF_AUTO_NEXT_KEY = "biophysics_tf/auto_next_v1";
let biophysicsTfItems = [];
const biophysicsTfState = {
  pool: [],
  index: 0,
  score: 0,
  answered: false,
  current: null,
  autoNextTimer: null
};

function getBiophysicsTfAutoNextEnabled(){
  const raw = localStorage.getItem(BIOPHYSICS_TF_AUTO_NEXT_KEY);
  if(raw === null) return true;
  return raw === "1";
}

function setBiophysicsTfAutoNextEnabled(enabled){
  const val = !!enabled;
  localStorage.setItem(BIOPHYSICS_TF_AUTO_NEXT_KEY, val ? "1" : "0");
  const el = document.getElementById("biophysics-tf-auto-next");
  if(el) el.checked = val;
}

function parseBooleanCell(value){
  const v = String(value || "").trim().toLowerCase();
  if(["true", "t", "1", "yes", "y"].includes(v)) return true;
  if(["false", "f", "0", "no", "n"].includes(v)) return false;
  return null;
}

function getBiophysicsTfText(item, kind){
  const lang = normalizeLanguage(state.language);
  if(kind === "statement"){
    if(lang === "Slovensky" && item.statementSk) return item.statementSk;
    return item.statementEn || item.statementSk || "";
  }
  if(lang === "Slovensky" && item.reasoningSk) return item.reasoningSk;
  return item.reasoningEn || item.reasoningSk || "";
}

function setBiophysicsTfAnswerButtonsDisabled(disabled){
  const trueBtn = document.getElementById("biophysics-answer-true");
  const falseBtn = document.getElementById("biophysics-answer-false");
  if(trueBtn) trueBtn.disabled = !!disabled;
  if(falseBtn) falseBtn.disabled = !!disabled;
}

function clearBiophysicsTfAutoNextTimer(){
  if(biophysicsTfState.autoNextTimer){
    clearTimeout(biophysicsTfState.autoNextTimer);
    biophysicsTfState.autoNextTimer = null;
  }
}

function renderBiophysicsTfQuestion(){
  const statementEl = document.getElementById("biophysics-tf-statement");
  const progressEl = document.getElementById("biophysics-tf-progress");
  const feedbackEl = document.getElementById("biophysics-tf-feedback");
  if(!statementEl || !progressEl || !feedbackEl) return;
  clearBiophysicsTfAutoNextTimer();

  if(!biophysicsTfState.pool.length){
    biophysicsTfState.current = null;
    biophysicsTfState.answered = false;
    statementEl.textContent = tOr("biophysics_no_statements_loaded", "No biophysics statements loaded.");
    feedbackEl.textContent = "";
    progressEl.textContent = "0 / 0";
    setBiophysicsTfAnswerButtonsDisabled(true);
    return;
  }

  if(biophysicsTfState.index >= biophysicsTfState.pool.length){
    biophysicsTfState.current = null;
    biophysicsTfState.answered = true;
    statementEl.textContent = tOr("biophysics_session_finished", "Session finished.");
    feedbackEl.textContent = `${tOr("biophysics_final_score", "Final score")}: ${biophysicsTfState.score} / ${biophysicsTfState.pool.length}`;
    progressEl.textContent = `${biophysicsTfState.pool.length} / ${biophysicsTfState.pool.length} | ${tOr("score", "Score")}: ${biophysicsTfState.score}`;
    setBiophysicsTfAnswerButtonsDisabled(true);
    return;
  }

  biophysicsTfState.current = biophysicsTfState.pool[biophysicsTfState.index] || null;
  biophysicsTfState.answered = false;
  statementEl.textContent = getBiophysicsTfText(biophysicsTfState.current, "statement") || tOr("biophysics_no_statement", "(No statement)");
  feedbackEl.textContent = "";
  progressEl.textContent = `${biophysicsTfState.index + 1} / ${biophysicsTfState.pool.length} | ${tOr("score", "Score")}: ${biophysicsTfState.score}`;
  setBiophysicsTfAnswerButtonsDisabled(false);
}

function answerBiophysicsTf(userAnswer){
  const feedbackEl = document.getElementById("biophysics-tf-feedback");
  const progressEl = document.getElementById("biophysics-tf-progress");
  const autoNextEl = document.getElementById("biophysics-tf-auto-next");
  const current = biophysicsTfState.current;
  if(!feedbackEl || !progressEl || !current || biophysicsTfState.answered) return;
  clearBiophysicsTfAutoNextTimer();

  biophysicsTfState.answered = true;
  const isCorrect = !!userAnswer === !!current.correct;
  if(isCorrect){
    biophysicsTfState.score += 1;
    feedbackEl.textContent = `${tOr("correct", "Correct")}.`;
    if(autoNextEl && autoNextEl.checked){
      const answeredIndex = biophysicsTfState.index;
      biophysicsTfState.autoNextTimer = setTimeout(()=>{
        if(
          biophysicsTfState.answered &&
          biophysicsTfState.index === answeredIndex &&
          biophysicsTfState.current
        ){
          nextBiophysicsTfQuestion();
        }
      }, 2000);
    }
  }else{
    const reasoning = getBiophysicsTfText(current, "reasoning");
    feedbackEl.textContent = reasoning ? `${tOr("incorrect", "Incorrect")}. ${reasoning}` : `${tOr("incorrect", "Incorrect")}.`;
  }
  progressEl.textContent = `${biophysicsTfState.index + 1} / ${biophysicsTfState.pool.length} | ${tOr("score", "Score")}: ${biophysicsTfState.score}`;
  setBiophysicsTfAnswerButtonsDisabled(true);
}

function nextBiophysicsTfQuestion(){
  const feedbackEl = document.getElementById("biophysics-tf-feedback");
  clearBiophysicsTfAutoNextTimer();
  if(!biophysicsTfState.pool.length) return;
  if(!biophysicsTfState.answered){
    if(feedbackEl) feedbackEl.textContent = tOr("biophysics_select_true_false_first", "Select True or False first.");
    return;
  }
  biophysicsTfState.index += 1;
  renderBiophysicsTfQuestion();
}

function handleBiophysicsTfKeyboard(event){
  const screen = document.getElementById("screen-biophysics-tf");
  if(!screen || screen.classList.contains("hidden")) return;

  const target = event.target;
  const tag = target && target.tagName ? String(target.tagName).toLowerCase() : "";
  const isTypingTarget =
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    (target && target.isContentEditable);
  if(isTypingTarget) return;

  const key = String(event.key || "").toLowerCase();
  if((key === "t" || key === "1") && !biophysicsTfState.answered){
    event.preventDefault();
    answerBiophysicsTf(true);
    return;
  }
  if((key === "f" || key === "2") && !biophysicsTfState.answered){
    event.preventDefault();
    answerBiophysicsTf(false);
    return;
  }
  if(key === "enter" && biophysicsTfState.answered){
    event.preventDefault();
    nextBiophysicsTfQuestion();
  }
}

async function ensureBiophysicsTfLoaded(){
  if(biophysicsTfItems.length) return biophysicsTfItems;
  try{
    const txt = await loadBaseFile(BIOPHYSICS_TF_FILE);
    const rows = parseCSVLines(txt);
    const parsed = rowsToObjectsWithHeaders(rows);
    const items = [];
    for(const obj of (parsed.objects || [])){
      const correct = parseBooleanCell(obj.true_or_false);
      if(correct === null) continue;
      const statementEn = normalizeWhitespace(obj.statement_en);
      const statementSk = normalizeWhitespace(obj.statement_sk);
      const reasoningEn = normalizeWhitespace(obj.reasoning_en);
      const reasoningSk = normalizeWhitespace(obj.reasoning_sk);
      if(!statementEn && !statementSk) continue;
      items.push({
        statementEn,
        statementSk,
        correct,
        reasoningEn,
        reasoningSk
      });
    }
    biophysicsTfItems = items;
  }catch(e){
    console.warn("Biophysics True/False load failed:", e.message || e);
    biophysicsTfItems = [];
  }
  return biophysicsTfItems;
}

function startBiophysicsTfSession(){
  const trueBtn = document.getElementById("biophysics-answer-true");
  const falseBtn = document.getElementById("biophysics-answer-false");
  const nextBtn = document.getElementById("biophysics-tf-next");
  const autoNextEl = document.getElementById("biophysics-tf-auto-next");
  if(trueBtn) trueBtn.textContent = "True";
  if(falseBtn) falseBtn.textContent = "False";
  if(nextBtn) nextBtn.textContent = "Next Enter";
  if(autoNextEl) autoNextEl.checked = getBiophysicsTfAutoNextEnabled();

  clearBiophysicsTfAutoNextTimer();
  biophysicsTfState.pool = biophysicsTfItems.slice();
  shuffle(biophysicsTfState.pool);
  biophysicsTfState.index = 0;
  biophysicsTfState.score = 0;
  biophysicsTfState.answered = false;
  biophysicsTfState.current = null;
  renderBiophysicsTfQuestion();
}

// --- UI wiring and i18n ---
let state = {
  language: localStorage.getItem('app_language') || 'English',
  currentUser: null,
  currentUserEmail: null,
  labParameters: {
    query: '',
    selectedTagKeys: new Set(),
    debounceTimer: null
  },
  pharmacology: {
    query: '',
    debounceTimer: null,
    selectedAtcCode: '',
    expandedAtcCodes: new Set()
  }
};

const ENTRY_CATEGORY_DATASETS = {
  basic_sciences: ["anatomy", "physiology"],
  diagnostics_procedures: ["diagnostic_methods", "procedures"],
  disease_and_symptoms: ["disease_and_symptoms"],
  lab_parameters: ["lab_parameters"],
  latin: ["latin_units", "latin_greek", "latin_abbreviations", "latin_remedies"],
  microorganisms: ["microorganisms"],
  pharmacology: ["pharmacology"]
};
const entryDatasetHeadersCache = new Map();
const entryDatasetExampleRowCache = new Map();
let entryFieldsRenderSeq = 0;

function getDatasetAdapterByKey(datasetKey){
  return (DATASET_ADAPTERS || []).find(spec => String(spec && spec.key || "") === String(datasetKey || "")) || null;
}

function getEntryCategory(){
  const select = document.getElementById("entry-category");
  const value = String((select && select.value) || "basic_sciences");
  return ENTRY_CATEGORY_DATASETS[value] ? value : "basic_sciences";
}

function getEntryDatasetOptionsForCategory(categoryKey){
  const keys = ENTRY_CATEGORY_DATASETS[String(categoryKey || "")] || [];
  return keys
    .map(key => getDatasetAdapterByKey(key))
    .filter(Boolean)
    .map(spec => ({ key: String(spec.key), label: localizeDatasetLabel(spec.key, String(spec.label || spec.key)) }));
}

function getEntrySelectedDatasetKey(){
  const category = getEntryCategory();
  const options = getEntryDatasetOptionsForCategory(category);
  const selected = String((document.getElementById("entry-source") || {}).value || "");
  if(options.some(opt => opt.key === selected)) return selected;
  return options.length ? options[0].key : "";
}

function isEntryTextareaField(header){
  const h = String(header || "").toLowerCase();
  return /notes|definition|causes|indications|contraindications|complications|features|differentials|treatment|diagnostics|description|regulation|steps|what_it_is|post_procedure|adverse_effects|interactions|physiological_role/i.test(h);
}

function normalizeHeaderList(rawHeaders){
  const seen = new Set();
  const out = [];
  for(const raw of (rawHeaders || [])){
    const h = String(raw || "").replace(/^\uFEFF/, "").trim();
    if(!h) continue;
    if(String(h).toLowerCase() === "id") continue;
    if(seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out;
}

async function loadEntryHeadersForDataset(datasetKey){
  const key = String(datasetKey || "");
  if(!key) return [];
  if(entryDatasetHeadersCache.has(key)) return entryDatasetHeadersCache.get(key) || [];
  const spec = getDatasetAdapterByKey(key);
  if(!spec || !spec.file){
    entryDatasetHeadersCache.set(key, []);
    return [];
  }
  try{
    const txt = await loadBaseFile(spec.file);
    const rows = parseCSVLines(txt || "");
    const headers = normalizeHeaderList((rows && rows[0]) || []);
    entryDatasetHeadersCache.set(key, headers);
    return headers;
  }catch(e){
    console.warn("Entry headers load failed for dataset:", key, e);
    entryDatasetHeadersCache.set(key, []);
    return [];
  }
}

async function loadEntryExampleRowForDataset(datasetKey){
  const key = String(datasetKey || "");
  if(!key) return {};
  if(entryDatasetExampleRowCache.has(key)) return entryDatasetExampleRowCache.get(key) || {};
  const spec = getDatasetAdapterByKey(key);
  if(!spec || !spec.file){
    entryDatasetExampleRowCache.set(key, {});
    return {};
  }
  try{
    const txt = await loadBaseFile(spec.file);
    const rows = parseCSVLines(txt || "");
    if(!rows || rows.length < 2){
      entryDatasetExampleRowCache.set(key, {});
      return {};
    }
    const parsed = rowsToObjectsWithHeaders(rows);
    const first = (parsed.objects && parsed.objects[0]) ? parsed.objects[0] : {};
    const example = {};
    for(const [col, value] of Object.entries(first || {})){
      example[String(col || "").trim()] = String(value || "").trim();
    }
    entryDatasetExampleRowCache.set(key, example);
    return example;
  }catch(e){
    console.warn("Entry example row load failed for dataset:", key, e);
    entryDatasetExampleRowCache.set(key, {});
    return {};
  }
}

async function renderEntryCategoryFields(){
  const renderSeq = ++entryFieldsRenderSeq;
  const sourceWrap = document.getElementById("entry-source-wrap");
  const sourceSelect = document.getElementById("entry-source");
  const fieldsWrap = document.getElementById("entry-dynamic-fields");
  if(!sourceWrap || !sourceSelect || !fieldsWrap) return;

  const category = getEntryCategory();
  const options = getEntryDatasetOptionsForCategory(category);
  if(!options.length){
    sourceWrap.classList.add("hidden");
    fieldsWrap.innerHTML = `<p class="muted">No dataset is mapped for this category.</p>`;
    return;
  }

  const previousSelected = String(sourceSelect.value || "");
  sourceSelect.innerHTML = options.map(opt => `<option value="${escapeHTML(opt.key)}">${escapeHTML(opt.label)}</option>`).join("");
  if(options.some(opt => opt.key === previousSelected)) sourceSelect.value = previousSelected;
  else sourceSelect.value = options[0].key;
  sourceWrap.classList.toggle("hidden", options.length <= 1);

  const datasetKey = String(sourceSelect.value || "");
  const headers = await loadEntryHeadersForDataset(datasetKey);
  const exampleRow = await loadEntryExampleRowForDataset(datasetKey);
  if(renderSeq !== entryFieldsRenderSeq) return;
  if(!headers.length){
    fieldsWrap.innerHTML = `<p class="muted" style="margin-top:8px">No editable fields found in selected dataset.</p>`;
    return;
  }

  fieldsWrap.innerHTML = [
    `<div class="small" style="margin-top:8px">Fields from selected CSV schema (${escapeHTML(datasetKey)})</div>`,
    ...headers.map(header => {
      const label = formatHeaderLabel(header);
      const example = String(exampleRow[header] || "").trim();
      const placeholder = example ? `${label} (${example})` : `${label}`;
      if(isEntryTextareaField(header)){
        return `<textarea data-entry-col="${escapeHTML(header)}" placeholder="${escapeHTML(placeholder)}"></textarea>`;
      }
      return `<input data-entry-col="${escapeHTML(header)}" placeholder="${escapeHTML(placeholder)}" />`;
    })
  ].join("");
}

// ===== Language handling =====
const LANG_CANON = {
  'english':'English',
  'en':'English',
  'deutch':'Deutsch',
  'deutsch':'Deutsch',
  'german':'Deutsch',
  'slovensky':'Slovensky',
  'slovak':'Slovensky'
};

function normalizeLanguage(lang){
  const raw = String(lang || '').trim();
  if(!raw) return 'English';
  const key = raw.toLowerCase();
  return LANG_CANON[key] || raw;
}

function normalizeTheme(theme){
  const raw = String(theme || "").trim().toLowerCase();
  return raw === "dark" ? "dark" : "light";
}

function refreshThemeButtons(){
  const theme = normalizeTheme(document.body.getAttribute("data-theme") || localStorage.getItem(APP_THEME_KEY) || "light");
  const lightBtn = document.getElementById("theme-light");
  const darkBtn = document.getElementById("theme-dark");
  if(lightBtn) lightBtn.classList.toggle("active", theme === "light");
  if(darkBtn) darkBtn.classList.toggle("active", theme === "dark");
}

function applyTheme(theme, opts = {}){
  const { persist = true } = opts;
  const next = normalizeTheme(theme);
  document.body.setAttribute("data-theme", next);
  if(persist){
    localStorage.setItem(APP_THEME_KEY, next);
    if(isProfileSessionActive()){
      userProfile.settings.app_theme = next;
      markProfileDirty();
    }
  }
  refreshThemeButtons();
}

function getBaseSearchField(){
  const lang = normalizeLanguage(state.language);
  if(lang === 'Deutsch') return 'german_translation';
  if(lang === 'Slovensky') return 'slovak_translation';
  return 'english_translation';
}

function getUserSearchField(){
  const lang = normalizeLanguage(state.language);
  if(lang === 'Deutsch') return 'german';
  if(lang === 'Slovensky') return 'slovak';
  return 'english';
}

const BASE_SEARCH_FIELDS = [
  "latin_translation",
  "english_translation",
  "german_translation",
  "slovak_translation",
  "english_definition",
  "german_definition",
  "slovak_definition",
  "genitive",
  "accusative"
];

const USER_SEARCH_FIELDS = [
  "latin",
  "english",
  "german",
  "slovak",
  "notes"
];
const USER_LC_SEARCH_FIELDS = [...USER_SEARCH_FIELDS];
const SEARCH_MIN_QUERY_LEN = 2;
const SEARCH_DEBOUNCE_MS = 180;
const SEARCH_MAX_RESULTS = 60;

const USER_FIELD_MAP = {
  english_translation: "english",
  german_translation: "german",
  slovak_translation: "slovak",
  latin_translation: "latin"
};

const LANGUAGE_FIELD_EQUIVALENTS = {
  english_translation: [
    "english_translation",
    "english_description",
    "english_definition"
  ],
  german_translation: [
    "german_translation",
    "german_description",
    "german_definition"
  ],
  slovak_translation: [
    "slovak_translation",
    "slovak_description",
    "slovak_definition"
  ],
  latin_translation: [
    "latin_translation",
    "latin_term",
    "full_form",
    "name"
  ]
};

function includesQuery(value, query){
  const hay = String(value || "").toLowerCase();
  const needle = String(query || "").toLowerCase();
  if(!needle) return true;
  if(hay.includes(needle)) return true;
  return normalizeSearchLoose(hay).includes(normalizeSearchLoose(needle));
}

const SEARCH_LOOSE_CACHE = new Map();
const INDEXED_DIGIT_MAP = {
  "Ã¢â€šâ‚¬": "0", "Ã¢â€šÂ": "1", "Ã¢â€šâ€š": "2", "Ã¢â€šÆ’": "3", "Ã¢â€šâ€ž": "4",
  "Ã¢â€šâ€¦": "5", "Ã¢â€šâ€ ": "6", "Ã¢â€šâ€¡": "7", "Ã¢â€šË†": "8", "Ã¢â€šâ€°": "9",
  "Ã¢ÂÂ°": "0", "Ã‚Â¹": "1", "Ã‚Â²": "2", "Ã‚Â³": "3", "Ã¢ÂÂ´": "4",
  "Ã¢ÂÂµ": "5", "Ã¢ÂÂ¶": "6", "Ã¢ÂÂ·": "7", "Ã¢ÂÂ¸": "8", "Ã¢ÂÂ¹": "9"
};
function normalizeSearchLoose(value){
  const raw = String(value || "").toLowerCase();
  const cached = SEARCH_LOOSE_CACHE.get(raw);
  if(cached !== undefined) return cached;
  let text = raw;
  try{
    // Remove diacritics so users can type without accents.
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }catch(_){
    text = raw;
  }
  // Treat indexed digits as normal digits: pOÃ¢â€šâ€š -> pO2.
  text = text.replace(/[Ã¢â€šâ‚¬Ã¢â€šÂÃ¢â€šâ€šÃ¢â€šÆ’Ã¢â€šâ€žÃ¢â€šâ€¦Ã¢â€šâ€ Ã¢â€šâ€¡Ã¢â€šË†Ã¢â€šâ€°Ã¢ÂÂ°Ã‚Â¹Ã‚Â²Ã‚Â³Ã¢ÂÂ´Ã¢ÂÂµÃ¢ÂÂ¶Ã¢ÂÂ·Ã¢ÂÂ¸Ã¢ÂÂ¹]/g, ch => INDEXED_DIGIT_MAP[ch] || ch);
  // Ignore punctuation and spacing differences: "D.S." vs "D. S." vs "DS".
  const compact = text.replace(/[^a-z0-9]+/g, "");
  if(SEARCH_LOOSE_CACHE.size > 50000) SEARCH_LOOSE_CACHE.clear();
  SEARCH_LOOSE_CACHE.set(raw, compact);
  return compact;
}

function matchAnyField(row, fields, query){
  for(const f of fields){
    if(includesQuery(row[f], query)) return true;
  }
  return false;
}

function getRowHeaders(row){
  const isIdHeader = (h)=> String(h || "").trim().toLowerCase() === "id";
  if(row && Array.isArray(row.__headers) && row.__headers.length){
    return row.__headers.filter(h => h && !isIdHeader(h));
  }
  return Object.keys(row || {}).filter(k => !k.startsWith("__") && !isIdHeader(k));
}

function matchAnyHeader(row, query){
  if(row && Array.isArray(row.__lcHeaders) && row.__lcHeaders.length){
    for(const value of row.__lcHeaders){
      if(includesQuery(value, query)) return true;
    }
    return false;
  }
  const headers = getRowHeaders(row);
  for(const h of headers){
    if(includesQuery(row[h], query)) return true;
  }
  return false;
}

function ensureUserSearchLowercaseCache(row){
  if(!row || typeof row !== "object") return null;
  if(!row.__lc || typeof row.__lc !== "object"){
    row.__lc = {};
  }
  for(const field of USER_LC_SEARCH_FIELDS){
    if(typeof row.__lc[field] !== "string"){
      row.__lc[field] = String(row[field] || "").toLowerCase();
    }
  }
  return row.__lc;
}

function formatHeaderLabel(header){
  const cleaned = String(header || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if(!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

const DATASET_LABEL_TRANSLATION_KEYS = {
  anatomy: "dataset_anatomy",
  diagnostic_methods: "dataset_diagnostic_methods",
  disease_and_symptoms: "disease_and_symptoms",
  lab_parameters: "laboratory_parameters",
  latin_abbreviations: "dataset_latin_abbreviations",
  latin_greek: "dataset_latin_greek",
  latin_remedies: "dataset_latin_remedies",
  latin_units: "dataset_latin_units",
  microorganisms: "microorganisms",
  muscles: "dataset_muscles",
  pharmacology: "pharmacology",
  physiology: "dataset_physiology",
  procedures: "dataset_procedures"
};

const FLASHCARDS_FIELD_TRANSLATION_KEYS = {
  name_en: "field_name_en",
  name_de: "field_name_de",
  name_sk: "field_name_sk",
  name_la: "field_name_la",
  name_gr: "field_name_gr",
  abbreviation: "latin_search_abbreviation",
  full_form: "latin_search_full_form",
  definition: "field_definition",
  notes: "latin_search_notes",
  region: "muscle_search_region",
  category: "category",
  origo: "muscle_search_origo",
  insercio: "muscle_search_insercio",
  innervation: "muscle_search_innervation",
  blood_supply: "muscle_search_blood_supply",
  movement_function: "field_movement_function",
  oina_summary: "field_oina_summary",
  name_en: "field_name_en",
  sample_type: "field_sample_type",
  physiological_role: "field_physiological_role",
  causes_of_increase: "field_causes_of_increase",
  causes_of_decrease: "field_causes_of_decrease",
  clinical_use: "field_clinical_use",
  system: "field_system",
  name_sk: "field_name_sk",
  drug_class: "field_drug_class",
  subclass: "field_subclass",
  mechanism_of_action: "field_mechanism_of_action",
  indications: "field_indications",
  contraindications: "field_contraindications",
  adverse_effects_common: "field_adverse_effects_common",
  adverse_effects_serious: "field_adverse_effects_serious",
  interactions_key: "field_interactions_key",
  pregnancy: "field_pregnancy",
  routes: "field_routes",
  onset: "field_onset",
  duration: "field_duration",
  unit_name: "field_unit_name",
  latin_grammar: "field_latin_grammar",
  definition_en: "field_definition_en",
  definition_de: "field_definition_de",
  definition_sk: "field_definition_sk",
  normal_range_units: "field_normal_range_units"
};

function localizeDatasetLabel(datasetKey, fallbackLabel = ""){
  const key = DATASET_LABEL_TRANSLATION_KEYS[String(datasetKey || "").trim()];
  const fallback = String(fallbackLabel || formatHeaderLabel(datasetKey));
  return key ? tOr(key, fallback) : fallback;
}

function localizeFlashcardsFieldLabel(fieldKey, fallbackLabel = ""){
  const normalized = String(fieldKey || "").trim();
  if(["abbreviation", "sample_type", "system", "physiological_role", "causes_of_increase", "causes_of_decrease", "clinical_use"].includes(normalized)){
    return labFieldLabel(normalized);
  }
  if(normalized === "name_en") return tOr("english_translation", String(fallbackLabel || "Name (EN)"));
  if(normalized === "name_de") return tOr("german_translation", String(fallbackLabel || "Name (DE)"));
  if(normalized === "name_sk") return tOr("slovak_translation", String(fallbackLabel || "Name (SK)"));
  if(normalized === "name_la") return tOr("latin_translation", String(fallbackLabel || "Name (LA)"));
  const tKey = FLASHCARDS_FIELD_TRANSLATION_KEYS[normalized];
  const fallback = String(fallbackLabel || formatHeaderLabel(normalized));
  return tKey ? tOr(tKey, fallback) : fallback;
}

const LATIN_HEADER_TRANSLATION_KEYS = {
  latin_term: 'latin_search_latin_term',
  latin_genitive: 'latin_search_latin_genitive',
  part_of_speech: 'latin_search_part_of_speech',
  gender: 'latin_search_gender',
  english_translation: 'english_translation',
  german_translation: 'german_translation',
  slovak_translation: 'slovak_translation',
  notes: 'latin_search_notes',
  latin_translation: 'latin_translation',
  greek_translation: 'latin_search_greek_translation',
  abbreviation: 'latin_search_abbreviation',
  full_form: 'latin_search_full_form',
  name: 'latin_search_name',
  english_description: 'latin_search_english_description',
  german_description: 'latin_search_german_description',
  slovak_description: 'latin_search_slovak_description',
  category: 'category',
  english_definition: 'latin_search_english_definition',
  german_definition: 'latin_search_german_definition',
  slovak_definition: 'latin_search_slovak_definition'
};

function getLatinHeaderLabel(header){
  const normalized = String(header || '').trim();
  const translationKey = LATIN_HEADER_TRANSLATION_KEYS[normalized];
  if(!translationKey) return formatHeaderLabel(normalized);
  return tOr(translationKey, formatHeaderLabel(normalized));
}

function renderBaseResult(row, preferredField){
  const headers = getRowHeaders(row);
  const preferred = preferredField && headers.includes(preferredField) && row[preferredField] ? preferredField : "";
  const titleField = preferred || headers.find(h => row[h]);
  const head = titleField ? String(row[titleField] || "").trim() : "";
  const datasetLabel = row.__datasetLabel ? `<div class="small" style="margin-top:4px">${escapeHTML(row.__datasetLabel)}</div>` : "";

  let kv = "";
  for(const h of headers){
    const v = String(row[h] || "").trim();
    if(!v) continue;
    kv += `<div class="k">${escapeHTML(formatHeaderLabel(h))}</div><div class="v">${escapeHTML(v)}</div>`;
  }

  return `<div class="result-head"><span class="result-badge term">Term</span></div><strong>${escapeHTML(head)}</strong>${datasetLabel}${kv ? `<div class="kv">${kv}</div>` : ""}`;
}

function renderSearchFallback(value){
  const text = String(value || "").trim();
  return text ? escapeHTML(text) : "&mdash;";
}

function renderPharmacologyResult(result){
  const row = result && result.row ? result.row : result;
  const hierarchyParts = Array.isArray(row && row.atc_hierarchy)
    ? row.atc_hierarchy.map(item => [item.atc_code, item.atc_name].filter(Boolean).join(" - ").trim()).filter(Boolean)
    : [];
  const otherCodes = (Array.isArray(row && row.atc_all) ? row.atc_all : []).filter(code => code && code !== row.atc_primary);
  const detailRows = [
    ["Primary ATC code", row && row.atc_primary],
    ["ATC categories", hierarchyParts.length ? hierarchyParts.join(" > ") : ""],
    ["Other ATC codes", otherCodes.length ? otherCodes.join(", ") : ""],
    ["Mechanism of action", row && row.mechanism_of_action],
    ["Indications", row && row.indications],
    ["Routes of administration", row && row.routes_of_administration],
    ["Standard dose", row && row.standard_dose],
    ["Absolute contraindications", row && row.contraindications_absolute],
    ["Relative contraindications", row && row.contraindications_relative],
    ["Adverse effects", row && row.adverse_effects],
    ["Major interactions", row && row.major_interactions],
    ["Antidote or reversal", row && row.antidote_or_reversal],
    ["Half-life", row && row.half_life],
    ["Metabolism", row && row.metabolism],
    ["Elimination", row && row.elimination]
  ].filter(([, value])=> String(value || "").trim());
  const kv = detailRows.map(([label, value])=>{
    return `<div class="k">${escapeHTML(label)}</div><div class="v pharmacology-value">${escapeHTML(String(value || "").trim())}</div>`;
  }).join("");
  return `<div class="result-head"><span class="result-badge drug">Drug</span></div>
    <strong>${escapeHTML(row && row.english_name || row && row.drug_id || "Unnamed drug")}</strong>
    ${row && row.slovak_name ? `<div class="small" style="margin-top:4px">${escapeHTML(row.slovak_name)}</div>` : ""}
    <div class="kv">${kv}</div>`;
}

const LAB_UI_LABELS = {
  English: {
    menuButton: "Lab parameters",
    pageTitle: "Lab parameters",
    subtitle: "Hospital lab taxonomy",
    searchPlaceholder: "Search term or abbreviation (min 2 chars)",
    systemLabel: "System",
    allSystems: "All systems",
    tagsLabel: "Tags",
    clearFilters: "Clear filters",
    selectedTagsAria: "Selected tags",
    availableTagsAria: "Available tags",
    noSelectedTags: "No tag selected",
    noTags: "No tags available",
    noResults: "No matching results found.",
    back: "Back",
    andJoin: "AND",
    more: "more"
  },
  Deutsch: {
    menuButton: "Laborparameter",
    pageTitle: "Laborparameter",
    subtitle: "Krankenhaus-Labortaxonomie",
    searchPlaceholder: "Begriff oder AbkÃƒÂ¼rzung suchen (mind. 2 Zeichen)",
    systemLabel: "System",
    allSystems: "Alle Systeme",
    tagsLabel: "Tags",
    clearFilters: "Filter lÃƒÂ¶schen",
    selectedTagsAria: "AusgewÃƒÂ¤hlte Tags",
    availableTagsAria: "VerfÃƒÂ¼gbare Tags",
    noSelectedTags: "Kein Tag ausgewÃƒÂ¤hlt",
    noTags: "Keine Tags verfÃƒÂ¼gbar",
    noResults: "Keine passenden Ergebnisse gefunden.",
    back: "ZurÃƒÂ¼ck",
    andJoin: "UND",
    more: "mehr"
  },
  Slovensky: {
    menuButton: "Laboratorne parametre",
    pageTitle: "Laboratorne parametre",
    subtitle: "Nemocnicna laboratorna taxonomia",
    searchPlaceholder: "Hladat termin alebo skratku (min. 2 znaky)",
    systemLabel: "System",
    allSystems: "Vsetky systemy",
    tagsLabel: "Tagy",
    clearFilters: "Vycistit filtre",
    selectedTagsAria: "Vybrane tagy",
    availableTagsAria: "Dostupne tagy",
    noSelectedTags: "Nie je vybrany ziadny tag",
    noTags: "Nie su dostupne ziadne tagy",
    noResults: "Neboli najdene ziadne zhodne vysledky.",
    back: "Spat",
    andJoin: "A",
    more: "dalsie"
  }
};

const LAB_FIELD_LABELS = {
  id: { English: "ID", Deutsch: "ID", Slovensky: "ID" },
  english_term: { English: "English term", Deutsch: "Englischer Begriff", Slovensky: "Anglicky termin" },
  german_term: { English: "German term", Deutsch: "Deutscher Begriff", Slovensky: "Nemecky termin" },
  slovak_term: { English: "Slovak term", Deutsch: "Slowakischer Begriff", Slovensky: "Slovensky termin" },
  abbreviation: { English: "Abbreviation", Deutsch: "AbkÃƒÂ¼rzung", Slovensky: "Skratka" },
  analyte: { English: "Analyte", Deutsch: "Analyt", Slovensky: "Analyt" },
  system: { English: "System", Deutsch: "System", Slovensky: "System" },
  sample_type: { English: "Sample type", Deutsch: "Probentyp", Slovensky: "Typ vzorky" },
  normal_range: { English: "Normal range", Deutsch: "Referenzbereich", Slovensky: "Normalne rozmedzie" },
  units: { English: "Units", Deutsch: "Einheiten", Slovensky: "Jednotky" },
  physiological_role: { English: "Physiological role", Deutsch: "Physiologische Rolle", Slovensky: "Fyziologicka uloha" },
  causes_of_increase: { English: "Causes of increase", Deutsch: "Ursachen der Erhoehung", Slovensky: "Priciny zvysenia" },
  causes_of_decrease: { English: "Causes of decrease", Deutsch: "Ursachen der Erniedrigung", Slovensky: "Priciny znizenia" },
  clinical_use: { English: "Clinical use", Deutsch: "Klinische Nutzung", Slovensky: "Klinicke pouzitie" },
  notes: { English: "Notes", Deutsch: "Notizen", Slovensky: "Poznamky" },
  tags: { English: "Tags", Deutsch: "Tags", Slovensky: "Tagy" }
};

const LAB_SYSTEM_TRANSLATIONS = {
  Hematology: { Deutsch: "Haematologie", Slovensky: "Hematologia" },
  Inflammation: { Deutsch: "Entzuendung", Slovensky: "Zapal" },
  Renal: { Deutsch: "Niere", Slovensky: "Oblicky" },
  Electrolytes: { Deutsch: "Elektrolyte", Slovensky: "Elektrolyty" },
  "Acid-base": { Deutsch: "Saeure-Basen", Slovensky: "Acidobazicka rovnovaha" },
  Metabolism: { Deutsch: "Stoffwechsel", Slovensky: "Metabolizmus" },
  Liver: { Deutsch: "Leber", Slovensky: "Pecen" },
  "Liver/Muscle": { Deutsch: "Leber/Muskel", Slovensky: "Pecen/Svaly" },
  "Liver/Bone": { Deutsch: "Leber/Knochen", Slovensky: "Pecen/Kosti" },
  "Liver/Nutrition": { Deutsch: "Leber/Ernaehrung", Slovensky: "Pecen/Vyziva" },
  Coagulation: { Deutsch: "Gerinnung", Slovensky: "Koagulacia" },
  "Coagulation/Inflammation": { Deutsch: "Gerinnung/Entzuendung", Slovensky: "Koagulacia/Zapal" },
  Lipids: { Deutsch: "Lipide", Slovensky: "Lipidy" },
  Endocrine: { Deutsch: "Endokrinologie", Slovensky: "Endokrinologia" },
  Cardiac: { Deutsch: "Kardiologie", Slovensky: "Kardiologia" },
  "Tissue injury": { Deutsch: "Gewebeschaden", Slovensky: "Poskodenie tkaniva" },
  Muscle: { Deutsch: "Muskulatur", Slovensky: "Svaly" },
  Pancreas: { Deutsch: "Pankreas", Slovensky: "Pankreas" },
  Perfusion: { Deutsch: "Perfusion", Slovensky: "Perfuzia" },
  ABG: { Deutsch: "BGA", Slovensky: "ABR" },
  Urinalysis: { Deutsch: "Urinanalyse", Slovensky: "Vysetrenie mocu" },
  "Endocrine/Bone": { Deutsch: "Endokrinologie/Knochen", Slovensky: "Endokrinologia/Kosti" },
  ICU: { Deutsch: "Intensivstation", Slovensky: "JIS" },
  Oncology: { Deutsch: "Onkologie", Slovensky: "Onkologia" },
  Autoimmune: { Deutsch: "Autoimmun", Slovensky: "Autoimunitne" },
  Infectious: { Deutsch: "Infektiologie", Slovensky: "Infekcne" },
  Toxicology: { Deutsch: "Toxikologie", Slovensky: "Toxikologia" },
  Neurology: { Deutsch: "Neurologie", Slovensky: "Neurologia" },
  Transfusion: { Deutsch: "Transfusionsmedizin", Slovensky: "Transfuzia" },
  Uncategorized: { Deutsch: "Nicht kategorisiert", Slovensky: "Nezaradene" }
};

const LAB_RESULT_FIELD_ORDER = [
  "english_term", "german_term", "slovak_term", "abbreviation", "analyte",
  "sample_type", "normal_range", "units", "physiological_role", "causes_of_increase",
  "causes_of_decrease", "clinical_use", "notes"
];

function labLang(){
  return normalizeLanguage(state.language);
}

function labText(key){
  const lang = labLang();
  return repairMojibake((LAB_UI_LABELS[lang] && LAB_UI_LABELS[lang][key]) || LAB_UI_LABELS.English[key] || key);
}

function labFieldLabel(field){
  const lang = labLang();
  const translated = LAB_FIELD_LABELS[field] && LAB_FIELD_LABELS[field][lang];
  return translated || formatHeaderLabel(field);
}

function getLocalizedSystem(systemName){
  const lang = labLang();
  if(lang === "English") return systemName;
  const map = LAB_SYSTEM_TRANSLATIONS[systemName];
  if(!map) return systemName;
  return map[lang] || systemName;
}

function escapeHTML(value){
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toFileSafeName(raw, fallback = "export"){
  const cleaned = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w\-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function dateStampYmd(){
  return new Date().toISOString().slice(0, 10);
}

async function saveJsonToFile({ suggestedName, data }){
  const fileName = String(suggestedName || "data.json").trim() || "data.json";
  const text = JSON.stringify(data ?? null, null, 2);
  if(typeof window.showSaveFilePicker === "function"){
    const handle = await window.showSaveFilePicker({
      suggestedName: fileName,
      types: [{ description: "JSON", accept: { "application/json": [".json"] } }]
    });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return;
  }
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function loadJsonFromFile({ accept = ".json,.mdjlf_quiz.json,.mdjlf_deck.json" } = {}){
  return new Promise((resolve, reject)=>{
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = async ()=>{
      const file = input.files && input.files[0];
      if(!file){
        resolve(null);
        return;
      }
      try{
        const txt = await file.text();
        const parsed = JSON.parse(txt);
        resolve({ file, parsed });
      }catch(e){
        reject(new Error("Invalid JSON file."));
      }
    };
    input.click();
  });
}

function normalizeImportedQuizDoc(raw){
  const doc = raw && typeof raw === "object" ? raw : null;
  if(!doc) throw new Error("Quiz file is not a JSON object.");
  if(Number(doc.schemaVersion) !== 1 || String(doc.type || "") !== "quiz"){
    throw new Error("Unsupported quiz file format.");
  }
  const name = String(doc.name || "").trim();
  if(!name) throw new Error("Quiz name is required.");
  const selectedTermIds = Array.isArray(doc.selectedTermIds) ? doc.selectedTermIds.map(v => String(v || "").trim()).filter(Boolean) : [];
  const settings = doc.settings && typeof doc.settings === "object" ? doc.settings : {};
  const type = ["multiple_choice", "matching", "typing"].includes(String(settings.type || doc.typeHint || "")) ? String(settings.type || doc.typeHint) : "multiple_choice";
  let fieldQuery = doc.filters && typeof doc.filters === "object" && doc.filters.fieldQuery && typeof doc.filters.fieldQuery === "object"
    ? {
        domainKey: String(doc.filters.fieldQuery.domainKey || "").trim(),
        subdivision1: String(doc.filters.fieldQuery.subdivision1 || "").trim(),
        subdivision2: String(doc.filters.fieldQuery.subdivision2 || "").trim(),
        frontFieldKey: String(doc.filters.fieldQuery.frontFieldKey || "").trim(),
        backFieldKey: String(doc.filters.fieldQuery.backFieldKey || "").trim()
      }
    : null;
  if(!fieldQuery || !fieldQuery.domainKey){
    const parsedFrom = parseDomainFieldPairKey(settings.fromField || "");
    const parsedTo = parseDomainFieldPairKey(settings.toField || "");
    if(parsedFrom && parsedTo && parsedFrom.domainKey === parsedTo.domainKey){
      fieldQuery = {
        domainKey: parsedFrom.domainKey,
        subdivision1: "",
        subdivision2: "",
        frontFieldKey: parsedFrom.fieldKey,
        backFieldKey: parsedTo.fieldKey
      };
    }
  }
  const importedFilters = doc.filters && typeof doc.filters === "object" ? doc.filters : {};
  return {
    quizId: String(doc.id || genId("quiz:")),
    name,
    description: String(doc.description || "").trim(),
    type,
    fromField: String(settings.fromField || "english_translation"),
    toField: String(settings.toField || "latin_translation"),
    termIds: selectedTermIds,
    filters: {
      includeCategories: Array.isArray(importedFilters.includeCategories) ? importedFilters.includeCategories : [],
      excludeCategories: Array.isArray(importedFilters.excludeCategories) ? importedFilters.excludeCategories : [],
      onlyWithDefinitions: !!importedFilters.onlyWithDefinitions,
      fieldQuery: fieldQuery || {},
      sourcePreset: ["all", "starred", "wrong", "review"].includes(String(importedFilters.sourcePreset || "").trim().toLowerCase())
        ? String(importedFilters.sourcePreset).trim().toLowerCase()
        : "all",
      targetCount: Math.max(1, Math.min(200, Number(importedFilters.targetCount || selectedTermIds.length || 20) || 20)),
      shufflePool: !Object.prototype.hasOwnProperty.call(importedFilters, "shufflePool") ? true : !!importedFilters.shufflePool
    },
    createdAt: String(doc.createdAt || new Date().toISOString()),
    updatedAt: String(doc.updatedAt || new Date().toISOString())
  };
}

function normalizeImportedDeckDoc(raw){
  const doc = raw && typeof raw === "object" ? raw : null;
  if(!doc) throw new Error("Deck file is not a JSON object.");
  if(Number(doc.schemaVersion) !== 1 || String(doc.type || "") !== "deck"){
    throw new Error("Unsupported deck file format.");
  }
  const id = String(doc.id || "").trim();
  const name = String(doc.name || "").trim();
  if(!id || !name) throw new Error("Deck id and name are required.");
  const cards = Array.isArray(doc.cards) ? doc.cards : [];
  const normalizedCards = cards.map(row => {
    const rid = String(row && row.id || "").trim();
    const front = String(row && row.front || "").trim();
    const back = String(row && row.back || "").trim();
    if(!rid || !front || !back) return null;
    return {
      id: rid,
      frontText: front,
      backText: back,
      notes: String(row && row.notes || "").trim(),
      tags: Array.isArray(row && row.tags) ? row.tags.map(v => String(v || "").trim()).filter(Boolean) : [],
      createdAt: String(row && row.createdAt || new Date().toISOString()),
      updatedAt: String(row && row.updatedAt || new Date().toISOString())
    };
  }).filter(Boolean);
  return {
    id,
    name,
    createdAt: String(doc.createdAt || new Date().toISOString()),
    updatedAt: String(doc.updatedAt || new Date().toISOString()),
    cards: normalizedCards
  };
}

function getLabRows(){
  return medicalTerms.filter(r => r && r.__dataset === LAB_DATASET_KEY);
}

function buildLabFilterCatalog(rows){
  void rows;
  const availableTags = ALLOWED_TAGS.slice().sort();
  const tags = availableTags.map(label => ({
    key: label.toLowerCase(),
    label
  }));
  return { tags };
}

function getLabTermTitleField(){
  const lang = labLang();
  if(lang === "Deutsch") return "german_term";
  if(lang === "Slovensky") return "slovak_term";
  return "english_term";
}

function labSearchMatch(row, query){
  if(!query) return true;
  return (
    includesQuery(row.english_term, query) ||
    includesQuery(row.german_term, query) ||
    includesQuery(row.slovak_term, query) ||
    includesQuery(row.abbreviation, query)
  );
}

function labFilterMatch(row){
  const labState = state.labParameters;
  if(labState.selectedTagKeys.size === 0) return true;
  if(LAB_TAG_FILTER_MODE === "OR"){
    return [...labState.selectedTagKeys].some(key => row.__labTagKeySet.has(key));
  }
  return [...labState.selectedTagKeys].every(key => row.__labTagKeySet.has(key));
}

function renderLabTagChips(tags){
  const availableWrap = document.getElementById("lab-parameters-tags-available");
  if(!availableWrap) return;
  const selected = state.labParameters.selectedTagKeys;
  availableWrap.setAttribute("aria-label", tOr("lab_available_tags", labText("availableTagsAria")));

  if(tags.length === 0){
    availableWrap.innerHTML = `<span class="lab-chip lab-chip-muted">${escapeHTML(labText("noTags"))}</span>`;
  } else {
    availableWrap.innerHTML = tags.map(tag => `
      <button type="button" class="lab-chip${selected.has(tag.key) ? " is-active" : ""}" data-tag-key="${escapeHTML(tag.key)}">${escapeHTML(tag.label)}</button>
    `).join("");
  }
}

function renderLabResults(rows){
  const resultsDiv = document.getElementById("lab-parameters-results");
  if(!resultsDiv) return;
  if(rows.length === 0){
    resultsDiv.textContent = tOr("No matching results found.", labText("noResults"));
    return;
  }
  const titleField = getLabTermTitleField();
  const languageTermFields = new Set(["english_term", "german_term", "slovak_term"]);
  resultsDiv.innerHTML = rows.map(row => {
    const title = String(row[titleField] || row.english_term || row.german_term || row.slovak_term || "").trim();
    const abbr = String(row.abbreviation || "").trim();
    const systemLabel = getLocalizedSystem(row.__labSystem || LAB_DEFAULT_SYSTEM);
    const allTags = Array.isArray(row.__labTags) ? row.__labTags : [];
    const visibleTags = allTags.filter(tag => String(tag || "").trim().toLowerCase() !== String(systemLabel || "").trim().toLowerCase());
    const shownTags = visibleTags.slice(0, LAB_VISIBLE_TAGS_ON_CARD);
    const hiddenTagCount = Math.max(0, visibleTags.length - shownTags.length);
    const topChips = [
      `<span class="lab-chip lab-chip-muted">${escapeHTML(systemLabel)}</span>`,
      ...shownTags.map(tag => `<span class="lab-chip lab-chip-muted">${escapeHTML(tag)}</span>`),
      hiddenTagCount > 0 ? `<span class="lab-chip lab-chip-muted">+${hiddenTagCount} ${escapeHTML(labText("more"))}</span>` : ""
    ].filter(Boolean).join("");

    const kv = LAB_RESULT_FIELD_ORDER
      .filter(field => field !== titleField && !languageTermFields.has(field))
      .map(field => ({ field, value: String(row[field] || "").trim() }))
      .filter(entry => !!entry.value)
      .map(entry => `<div class="k">${escapeHTML(labFieldLabel(entry.field))}</div><div class="v">${escapeHTML(entry.value)}</div>`)
      .join("");

    return `
      <div class="result">
        <div class="lab-result-head">
          <div>
            <div class="lab-result-name">${escapeHTML(title || "-")}</div>
            ${abbr ? `<div class="lab-result-abbr">${escapeHTML(labFieldLabel("abbreviation"))}: ${escapeHTML(abbr)}</div>` : ""}
          </div>
          <div class="lab-result-chips">${topChips}</div>
        </div>
        ${kv ? `<div class="kv">${kv}</div>` : ""}
      </div>
    `;
  }).join("");
}

function getFilteredLabRows(){
  const rows = getLabRows();
  const query = state.labParameters.query.trim().toLowerCase();
  return rows.filter(row => labSearchMatch(row, query) && labFilterMatch(row));
}

function refreshLabParametersUI(){
  const root = document.getElementById("screen-lab-parameters");
  if(!root) return;
  const rows = getLabRows();
  const catalog = buildLabFilterCatalog(rows);
  state.labParameters.selectedTagKeys = new Set(
    [...state.labParameters.selectedTagKeys].filter(key => catalog.tags.some(tag => tag.key === key))
  );
  renderLabStaticText();
  const clearBtn = document.getElementById("lab-parameters-clear-filters");
  if(clearBtn){
    const hasFilter = state.labParameters.selectedTagKeys.size > 0;
    clearBtn.disabled = !hasFilter;
  }
  renderLabTagChips(catalog.tags);
  renderLabResults(getFilteredLabRows());
}

function renderLabStaticText(){
  const map = {
    "to-lab-parameters": ["laboratory_parameters", "menuButton"],
    "lab-parameters-title": ["laboratory_parameters", "pageTitle"],
    "lab-tags-filter-label": ["tags", "tagsLabel"],
    "lab-parameters-clear-filters": ["clear_filters", "clearFilters"],
    "lab-parameters-back": ["back", "back"]
  };
  for(const [id, [translationKey, fallbackKey]] of Object.entries(map)){
    const el = document.getElementById(id);
    if(!el) continue;
    const value = tOr(translationKey, labText(fallbackKey));
    if(id === "to-lab-parameters"){
      const label = el.querySelector(".menu-label");
      if(label) label.textContent = value;
      else el.textContent = value;
      continue;
    }
    el.textContent = value;
  }
  const searchInput = document.getElementById("lab-parameters-search-input");
  if(searchInput){
    searchInput.placeholder = tOr("lab_search_placeholder", labText("searchPlaceholder"));
    if(searchInput.value !== state.labParameters.query){
      searchInput.value = state.labParameters.query;
    }
  }
}

function handleLabSearchInput(){
  const input = document.getElementById("lab-parameters-search-input");
  state.labParameters.query = String(input && input.value || "");
  clearTimeout(state.labParameters.debounceTimer);
  state.labParameters.debounceTimer = setTimeout(()=>{
    refreshLabParametersUI();
  }, LAB_SEARCH_DEBOUNCE_MS);
}

function toggleLabTag(tagKey){
  if(!tagKey) return;
  const selected = state.labParameters.selectedTagKeys;
  if(selected.has(tagKey)) selected.delete(tagKey);
  else selected.add(tagKey);
  refreshLabParametersUI();
}

function clearLabFilters(){
  state.labParameters.selectedTagKeys.clear();
  refreshLabParametersUI();
}

function getPharmacologySearchPlaceholder(){
  return tOr("pharmacology_search_placeholder", "Search drug name or ATC code (min 2 chars)");
}

function getPharmacologyActiveFilterCode(){
  return normalizeAtcCode(state.pharmacology.selectedAtcCode);
}

function pharmacologyMatchesAtcFilter(record, atcCode){
  const normalizedCode = normalizeAtcCode(atcCode);
  if(!normalizedCode) return true;
  const codes = [record && record.atc_primary, ...((record && record.atc_all) || [])]
    .map(normalizeAtcCode)
    .filter(Boolean);
  return codes.some(code => code.startsWith(normalizedCode));
}

function isCombinationText(value){
  return /\bcombination(s)?\b|\bincl\.\s*combination(s)?\b/i.test(String(value || ""));
}

function isCombinationPharmacologyRecord(record){
  if(!record) return false;
  if(isCombinationText(record.english_name) || isCombinationText(record.slovak_name)) return true;
  const hierarchy = Array.isArray(record.atc_hierarchy) ? record.atc_hierarchy : [];
  return hierarchy.some(item => isCombinationText(item && item.atc_name));
}

function getFilteredPharmacologyResults(query, atcCode){
  const filteredFilterCode = normalizeAtcCode(atcCode);
  const normalizedQuery = String(query || "").trim().toLowerCase();
  let results = normalizedQuery ? searchPharmacology(normalizedQuery) : pharmacologyRecords.map(row => ({ kind: "pharmacology", row, score: 0 }));
  if(filteredFilterCode){
    results = results.filter(item => pharmacologyMatchesAtcFilter(item.row, filteredFilterCode));
  }
  results = results.filter(item => !isCombinationPharmacologyRecord(item.row));
  if(!normalizedQuery){
    results.sort((a, b)=> String(a.row && (a.row.english_name || a.row.drug_id) || "").localeCompare(String(b.row && (b.row.english_name || b.row.drug_id) || "")));
  }
  return results;
}

function renderPharmacologyAtcOption(node, activeCode = ""){
  if(!node || !node.atc_code) return "";
  const isSelected = normalizeAtcCode(activeCode) === normalizeAtcCode(node.atc_code);
  const codeLabel = [node.atc_code, node.atc_name].filter(Boolean).join(" - ");
  return `<button type="button" class="pharmacology-atc-pill${isSelected ? " is-active" : ""}" data-atc-select="${escapeHTML(node.atc_code)}">${escapeHTML(codeLabel)}</button>`;
}

function renderPharmacologyAtcTree(){
  const label = document.getElementById("pharmacology-atc-filter-label");
  const summary = document.getElementById("pharmacology-filter-summary");
  const subtitle = document.getElementById("pharmacology-atc-subtitle");
  const clearBtn = document.getElementById("pharmacology-clear-filter");
  const selectedWrap = document.getElementById("pharmacology-selected-filter");
  const treeWrap = document.getElementById("pharmacology-atc-tree");
  if(label) label.textContent = tOr("pharmacology_narrow_tags", "Narrow search with tags");
  if(subtitle) subtitle.textContent = tOr("pharmacology_atc_categories", "ATC categories");
  if(clearBtn){
    clearBtn.textContent = tOr("pharmacology_clear_filter", "Clear filter");
    clearBtn.disabled = !getPharmacologyActiveFilterCode();
  }
  if(!selectedWrap || !treeWrap) return;
  const selectedCode = getPharmacologyActiveFilterCode();
  if(summary){
    if(selectedCode){
      summary.textContent = getAtcFilterLabel(selectedCode);
      summary.classList.add("is-active");
    } else {
      summary.textContent = tOr("pharmacology_no_filter", "No ATC category selected");
      summary.classList.remove("is-active");
    }
  }
  const hierarchy = selectedCode ? getAtcHierarchy(selectedCode) : [];
  if(hierarchy.length){
    selectedWrap.innerHTML = hierarchy.map((node, index) => {
      const codeLabel = [node.atc_code, node.atc_name].filter(Boolean).join(" - ");
      const active = index === hierarchy.length - 1;
      return `<button type="button" class="lab-chip${active ? " is-active" : ""}" data-atc-select="${escapeHTML(node.atc_code)}">${escapeHTML(codeLabel)}</button>`;
    }).join("");
    selectedWrap.hidden = false;
  } else {
    selectedWrap.innerHTML = `<span class="lab-chip lab-chip-muted">${escapeHTML(tOr("pharmacology_no_filter", "No ATC category selected"))}</span>`;
    selectedWrap.hidden = false;
  }

  let nodesToShow = [];
  if(!selectedCode){
    nodesToShow = getAtcChildren("");
  } else {
    const selectedChildren = getAtcChildren(selectedCode);
    nodesToShow = selectedChildren;
  }

  if(nodesToShow.length === 0){
    treeWrap.innerHTML = `<div class="muted">${escapeHTML(tOr("pharmacology_no_deeper_categories", "No deeper categories."))}</div>`;
    return;
  }
  treeWrap.innerHTML = nodesToShow.map(node => renderPharmacologyAtcOption(node)).join("");
}

function renderPharmacologyScreenResults(){
  const input = document.getElementById("pharmacology-search-input");
  const resultsDiv = document.getElementById("pharmacology-results");
  const title = document.getElementById("pharmacology-title");
  const menuBtn = document.getElementById("to-pharmacology");
  if(title) title.textContent = tOr("pharmacology", "Pharmacology");
  if(menuBtn){
    const label = menuBtn.querySelector(".menu-label");
    if(label) label.textContent = tOr("pharmacology", "Pharmacology");
  }
  if(!input || !resultsDiv) return;
  input.placeholder = getPharmacologySearchPlaceholder();
  renderPharmacologyAtcTree();
  if(input.value !== state.pharmacology.query){
    input.value = state.pharmacology.query;
  }

  const query = String(state.pharmacology.query || "").trim().toLowerCase();
  const selectedCode = getPharmacologyActiveFilterCode();
  if(query.length < SEARCH_MIN_QUERY_LEN && !selectedCode){
    resultsDiv.innerHTML = "";
    return;
  }

  const results = getFilteredPharmacologyResults(query.length >= SEARCH_MIN_QUERY_LEN ? query : "", selectedCode);
  if(results.length === 0){
    resultsDiv.textContent = tOr("No matching results found.", "No matching results found.");
    return;
  }

  resultsDiv.innerHTML = results.slice(0, SEARCH_MAX_RESULTS).map(item => {
    return `<div class="result">${renderPharmacologyResult(item)}</div>`;
  }).join("");
}

function handlePharmacologySearchInput(){
  const input = document.getElementById("pharmacology-search-input");
  state.pharmacology.query = String(input && input.value || "");
  clearTimeout(state.pharmacology.debounceTimer);
  state.pharmacology.debounceTimer = setTimeout(()=>{
    renderPharmacologyScreenResults();
  }, SEARCH_DEBOUNCE_MS);
}

function selectPharmacologyAtcCode(atcCode){
  const normalizedCode = normalizeAtcCode(atcCode);
  if(!normalizedCode){
    state.pharmacology.selectedAtcCode = "";
  } else {
    state.pharmacology.selectedAtcCode = normalizedCode;
  }
  renderPharmacologyScreenResults();
}

function clearPharmacologyAtcFilter(){
  state.pharmacology.selectedAtcCode = "";
  renderPharmacologyScreenResults();
}

function mapUserFieldFromBase(baseField){
  return USER_FIELD_MAP[baseField] || baseField;
}

async function setLanguage(lang){
  const canonical = normalizeLanguage(lang);
  state.language = canonical;
  localStorage.setItem('app_language', canonical);
  if(isProfileSessionActive()){
    userProfile.settings.app_language = canonical;
    markProfileDirty();
  }

  const sel = document.getElementById('language');
  if(sel) sel.value = canonical;

  if(!translations || Object.keys(translations).length === 0){
    try{ await loadTranslations(); }catch(e){}
  }

  applyTranslationsToDom();
  applyAnamnesisTranslationsToDom();
  updateAnamnesisMobileHeader(getActiveAnamnesisPatientRecord());

  const si = document.getElementById('search-input');
  if(si && si.value && si.value.trim().length >= 2){
    si.dispatchEvent(new Event('input', { bubbles:true }));
  }

  refreshMuscleTrainingUI();
  refreshLatinTerminologyUI();
  refreshLabParametersUI();
  await renderEntryCategoryFields();
  renderQuizGeneratorUi();
  renderQuizBuilderDomainUi();
  if(flashcardsV2State.loaded) refreshFlashcardsBuilderUI();
}

function t(key){
  const lang = state.language;
  if(translations[lang] && translations[lang][key]) return repairMojibake(translations[lang][key]);
  if(translations['English'] && translations['English'][key]) return repairMojibake(translations['English'][key]);
  missingTranslationTracker.report(key, lang);
  return key;
}

function tOr(key, fallback){
  const value = t(key);
  return value === key ? repairMojibake(fallback) : repairMojibake(value);
}

function applyTranslationsToDom(){
  document.title = tOr("app_title", document.title || "Medical Dictionary");
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.getAttribute('data-i18n');
    if(!el.dataset.baseText) el.dataset.baseText = el.textContent || "";
    el.textContent = tOr(k, el.dataset.baseText || k);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const k = el.getAttribute('data-i18n-placeholder');
    if(!el.dataset.basePlaceholder) el.dataset.basePlaceholder = el.getAttribute('placeholder') || "";
    el.placeholder = tOr(k, el.dataset.basePlaceholder || k);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    const k = el.getAttribute('data-i18n-aria-label');
    const fallback = el.getAttribute('aria-label') || "";
    el.setAttribute('aria-label', tOr(k, fallback || k));
  });
  refreshFieldOverflowUX(document);
}

// --- Muscle training helpers ---
const MUSCLE_HIDDEN = "****";
const MUSCLE_SEARCH_FIELD_KEY = "muscle_search_field";
const LATIN_HIDDEN = "****";
const LATIN_DATASET_KEY = "latin";
const LATIN_SEARCH_POS_KEY = "latin_search_pos";
const LATIN_SEARCH_FIELD_KEY = "latin_search_field";
const ANAMNESIS_STORAGE_KEY = "anamnesis_form_v1";
const ANAMNESIS_PSYCHIATRY_STORAGE_KEY = "anamnesis_psychiatry_form_v1";
const ANAMNESIS_PATIENTS_STORAGE_KEY = "anamnesis_patient_records_v1";
const ANAMNESIS_ACTIVE_PATIENT_KEY = "anamnesis_active_patient_id_v1";
const ANAMNESIS_LAYOUT_MODE_KEY = "anamnesis_layout_mode_v1";
const ANAMNESIS_INPUT_MODE_KEY = "anamnesis_input_mode_v1";
const TEXT_SIZE_KEY = "text_size";
const NAV_SESSION_KEY = "nav/last_screen_session";
const TEXT_SIZES = [13,14,15,16,17,18,19];
const PHONE_TEXT_SIZE_STEP = 1;
let muscleQuizPool = [];
let muscleQuizCurrent = null;
let muscleQuizRevealed = false;
let muscleQuizSelectedRegions = new Set();
let muscleQuizSelectedCategories = new Set();
let muscleQuizPersistentFields = new Set();
let muscleQuizTempFields = new Set();
let latinQuizPool = [];
let latinQuizCurrent = null;
let latinQuizRevealed = false;
let latinQuizSelectedUnits = new Set();
let latinQuizPersistentFields = new Set();
let latinQuizTempFields = new Set();
let latinSearchSelectedUnits = new Set();
let latinSearchUnitsInitialized = false;
let activeAnamnesisTab = "internal";
let anamnesisLayoutMode = "auto";
let anamnesisInputMode = "keyboard";
let anamnesisPatientRecords = [];
let activeAnamnesisPatientId = "";
let anamnesisSyncLock = false;
let anamnesisRegistryInitialized = false;
const MUSCLE_REGION_ORDER = [
  'muscles of the head',
  'muscles of the middle ear',
  'middle ear muscles',
  'muscles of the tongue',
  'muscles of the neck',
  'muscles of the larynx',
  'muscles of the pharynx',
  'muscles of the soft palate',
  'muscles of the thorax',
  'muscles of the back',
  'muscles of the abdominal wall',
  'muscles of the pelvic floor',
  'pelvic floor muscles',
  'perineal muscles',
  'muscles of the upper limb',
  'muscles of the lower limb'
];
const MUSCLE_REGION_ORDER_INDEX = new Map(
  MUSCLE_REGION_ORDER.map((name, idx) => [name, idx])
);

function normalizeMuscleRegionName(value){
  return String(value || '').trim().toLowerCase();
}

function compareMuscleRegionKeys(a, b){
  const aNormalized = normalizeMuscleRegionName(a);
  const bNormalized = normalizeMuscleRegionName(b);
  const aOrder = MUSCLE_REGION_ORDER_INDEX.get(aNormalized);
  const bOrder = MUSCLE_REGION_ORDER_INDEX.get(bNormalized);
  const aHasOrder = typeof aOrder === 'number';
  const bHasOrder = typeof bOrder === 'number';
  if(aHasOrder && bHasOrder) return aOrder - bOrder;
  if(aHasOrder) return -1;
  if(bHasOrder) return 1;
  return a.localeCompare(b);
}

function getMuscleRegionField(){
  const lang = normalizeLanguage(state.language);
  if(lang === 'Deutsch') return 'muscle_region_ge';
  if(lang === 'Slovensky') return 'muscle_region_sk';
  return 'muscle_region_en';
}

function getMuscleCategoryField(){
  const lang = normalizeLanguage(state.language);
  if(lang === 'Deutsch') return 'muscle_category_ge';
  if(lang === 'Slovensky') return 'muscle_category_sk';
  return 'muscle_category_en';
}

function getMuscleRegionKey(row){
  return (row.muscle_region_en || row.muscle_region_sk || row.muscle_region_ge || '').trim();
}

function getMuscleCategoryKey(row){
  return (row.muscle_category_en || row.muscle_category_sk || row.muscle_category_ge || '').trim();
}

function getMuscleRegionLabel(row){
  const field = getMuscleRegionField();
  return (row[field] || row.muscle_region_en || row.muscle_region_sk || row.muscle_region_ge || '').trim();
}

function getMuscleCategoryLabel(row){
  const field = getMuscleCategoryField();
  return (row[field] || row.muscle_category_en || row.muscle_category_sk || row.muscle_category_ge || '').trim();
}

function getMuscleMovementFunction(row){
  return (row.movement_function || row.type_of_movement || '').trim();
}

function escapeRegExp(value){
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function appendHighlightedText(container, value, query){
  const text = String(value || '');
  const q = String(query || '').trim();
  if(!q){
    container.textContent = text;
    return;
  }
  const regex = new RegExp(`(${escapeRegExp(q)})`, 'ig');
  const parts = text.split(regex);
  for(const part of parts){
    if(!part) continue;
    if(part.toLowerCase() === q.toLowerCase()){
      const mark = document.createElement('mark');
      mark.className = 'muscle-search-highlight';
      mark.textContent = part;
      container.appendChild(mark);
    } else {
      container.appendChild(document.createTextNode(part));
    }
  }
}

function addMuscleField(container, label, value, key, showToggles, highlightQuery){
  const row = document.createElement('div');
  row.className = 'muscle-field';

  if(showToggles){
    const leftWrap = document.createElement('label');
    leftWrap.className = 'muscle-field-toggle';
    const leftCb = document.createElement('input');
    leftCb.type = 'checkbox';
    leftCb.checked = muscleQuizPersistentFields.has(key);
    leftCb.addEventListener('change', ()=>{
      if(leftCb.checked) muscleQuizPersistentFields.add(key);
      else muscleQuizPersistentFields.delete(key);
      renderMuscleQuizFields();
    });
    leftWrap.appendChild(leftCb);
    row.appendChild(leftWrap);
  }

  const l = document.createElement('div');
  l.className = 'muscle-field-label';
  l.textContent = label;
  const v = document.createElement('div');
  v.className = 'muscle-field-value';
  appendHighlightedText(v, value || '-', highlightQuery);
  row.appendChild(l);
  row.appendChild(v);

  if(showToggles && key && value === MUSCLE_HIDDEN){
    const coverBtn = document.createElement('button');
    coverBtn.type = 'button';
    coverBtn.className = 'muscle-field-cover';
    coverBtn.textContent = tOr('reveal', 'Reveal');
    coverBtn.addEventListener('click', ()=>{
      muscleQuizTempFields.add(key);
      renderMuscleQuizFields();
    });
    v.appendChild(coverBtn);
  }

  container.appendChild(row);
}

function renderMuscleSearchResults(){
  const input = document.getElementById('muscle-search-input');
  const fieldSel = document.getElementById('muscle-search-field');
  const results = document.getElementById('muscle-search-results');
  if(!input || !results) return;
  const q = input.value.trim().toLowerCase();
  results.innerHTML = '';
  if(q.length < 2) return;

  const regionField = getMuscleRegionField();
  const categoryField = getMuscleCategoryField();
  const mode = fieldSel ? fieldSel.value : 'any';
  const matches = muscleTerms.filter(r => {
    if(mode === 'region') return includesQuery(r[regionField], q);
    if(mode === 'category') return includesQuery(r[categoryField], q);
    if(mode === 'english_muscle_name') return includesQuery(r.english_muscle_name, q);
    if(mode === 'latin_muscle_name') return includesQuery(r.latin_muscle_name, q);
    if(mode === 'movement_function' || mode === 'type_of_movement') return includesQuery(getMuscleMovementFunction(r), q);
    if(mode === 'insercio') return includesQuery(r.insercio, q);
    if(mode === 'origo') return includesQuery(r.origo, q);
    if(mode === 'blood_supply') return includesQuery(r.blood_supply, q);
    if(mode === 'innervation') return includesQuery(r.innervation, q);
    return (
      includesQuery(r.english_muscle_name, q) ||
      includesQuery(r.latin_muscle_name, q) ||
      includesQuery(r[regionField], q) ||
      includesQuery(r[categoryField], q) ||
      includesQuery(r.muscle_part, q) ||
      includesQuery(getMuscleMovementFunction(r), q) ||
      includesQuery(r.innervation, q) ||
      includesQuery(r.blood_supply, q) ||
      includesQuery(r.origo, q) ||
      includesQuery(r.insercio, q)
    );
  });
  const sortedMatches = mode === 'any' ? matches : [...matches].sort((a, b)=>{
    const aName = String(a.english_muscle_name || a.latin_muscle_name || '').trim();
    const bName = String(b.english_muscle_name || b.latin_muscle_name || '').trim();
    return aName.localeCompare(bName, undefined, { sensitivity: 'base' });
  });

  if(sortedMatches.length === 0){
    results.textContent = 'No muscles found.';
    return;
  }

  const limit = 50;
  sortedMatches.slice(0, limit).forEach(r=>{
    const card = document.createElement('div');
    card.className = 'muscle-result';
    addMuscleField(card, tOr('muscle_search_region', 'Region'), getMuscleRegionLabel(r), null, false, mode === 'region' ? q : null);
    addMuscleField(card, tOr('muscle_search_category', 'Category'), getMuscleCategoryLabel(r), null, false, mode === 'category' ? q : null);
    addMuscleField(card, tOr('muscle_search_latin_name', 'Latin name'), r.latin_muscle_name, null, false, mode === 'latin_muscle_name' ? q : null);
    addMuscleField(card, tOr('muscle_search_english_name', 'English name'), r.english_muscle_name, null, false, mode === 'english_muscle_name' ? q : null);
    addMuscleField(card, tOr('muscle_search_muscle_part', 'Parts of muscle'), r.muscle_part, null, false);
    addMuscleField(card, tOr('muscle_search_origo', 'Origo'), r.origo, null, false, mode === 'origo' ? q : null);
    addMuscleField(card, tOr('muscle_search_insercio', 'Insercio'), r.insercio, null, false, mode === 'insercio' ? q : null);
    addMuscleField(card, tOr('muscle_search_blood_supply', 'Blood supply'), r.blood_supply, null, false, mode === 'blood_supply' ? q : null);
    addMuscleField(card, tOr('muscle_search_innervation', 'Innervation'), r.innervation, null, false, mode === 'innervation' ? q : null);
    addMuscleField(card, tOr('muscle_type_of_movement', 'Movement'), getMuscleMovementFunction(r), null, false, (mode === 'movement_function' || mode === 'type_of_movement') ? q : null);
    results.appendChild(card);
  });
  if(sortedMatches.length > limit){
    const note = document.createElement('div');
    note.className = 'muted';
    note.textContent = `Showing first ${limit} results.`;
    results.appendChild(note);
  }
}

function renderMuscleRegionList(){
  const list = document.getElementById('muscle-region-list');
  if(!list) return;
  const regionField = getMuscleRegionField();
  const categoryField = getMuscleCategoryField();
  const regions = new Map();
  for(const r of muscleTerms){
    const key = getMuscleRegionKey(r);
    if(!key) continue;
    const label = (r[regionField] || r.muscle_region_en || key).trim();
    if(!regions.has(key)){
      regions.set(key, { label: label || key, categories: new Map() });
    }
    const catKey = getMuscleCategoryKey(r);
    if(!catKey) continue;
    const catLabel = (r[categoryField] || r.muscle_category_en || catKey).trim();
    regions.get(key).categories.set(catKey, catLabel || catKey);
  }
  const keys = [...regions.keys()].sort(compareMuscleRegionKeys);
  list.innerHTML = '';
  if(keys.length === 0){
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'No regions available.';
    list.appendChild(empty);
    return;
  }
  const controls = document.createElement('div');
  controls.className = 'muscle-region-controls';
  const clearAllBtn = document.createElement('button');
  clearAllBtn.type = 'button';
  clearAllBtn.className = 'muscle-region-action-btn danger';
  clearAllBtn.textContent = tOr('muscle_clear_all', 'Clear all');
  const hasSelections = muscleQuizSelectedRegions.size > 0 || muscleQuizSelectedCategories.size > 0;
  clearAllBtn.disabled = !hasSelections;
  clearAllBtn.addEventListener('click', ()=>{
    const confirmText = tOr('muscle_clear_all_confirm', 'Clear all selected regions and categories?');
    if(!window.confirm(confirmText)) return;
    muscleQuizSelectedRegions.clear();
    muscleQuizSelectedCategories.clear();
    renderMuscleRegionList();
  });
  controls.appendChild(clearAllBtn);
  list.appendChild(controls);

  keys.forEach(regionKey=>{
    const regionData = regions.get(regionKey);
    const wrapper = document.createElement('div');
    wrapper.className = 'muscle-region-item';

    const header = document.createElement('div');
    header.className = 'muscle-region-header';
    const regionCb = document.createElement('input');
    regionCb.type = 'checkbox';
    regionCb.checked = muscleQuizSelectedRegions.has(regionKey);
    const label = document.createElement('span');
    label.textContent = regionData.label;
    const actions = document.createElement('div');
    actions.className = 'muscle-region-actions';
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'muscle-region-action-btn';
    allBtn.textContent = tOr('muscle_region_all', 'All');
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'muscle-region-action-btn';
    clearBtn.textContent = tOr('muscle_region_clear', 'Clear');
    actions.appendChild(allBtn);
    actions.appendChild(clearBtn);
    header.appendChild(regionCb);
    header.appendChild(label);
    header.appendChild(actions);
    wrapper.appendChild(header);

    const catWrap = document.createElement('div');
    catWrap.className = 'muscle-region-categories checkbox-grid';
    if(!regionCb.checked) catWrap.classList.add('hidden');

    const catKeys = [...regionData.categories.keys()].sort((a,b)=>a.localeCompare(b));
    if(catKeys.length === 0){
      const none = document.createElement('div');
      none.className = 'muted';
      none.textContent = 'No categories for this region.';
      catWrap.appendChild(none);
    }else{
      catKeys.forEach(catKey=>{
        const catLabel = regionData.categories.get(catKey);
        const item = document.createElement('label');
        item.className = 'checkbox-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        const key = `${regionKey}||${catKey}`;
        cb.value = key;
        cb.checked = muscleQuizSelectedCategories.has(key);
        cb.addEventListener('change', ()=>{
          if(cb.checked){
            muscleQuizSelectedCategories.add(key);
            muscleQuizSelectedRegions.add(regionKey);
            regionCb.checked = true;
            catWrap.classList.remove('hidden');
          } else {
            muscleQuizSelectedCategories.delete(key);
          }
        });
        const span = document.createElement('span');
        span.textContent = catLabel;
        item.appendChild(cb);
        item.appendChild(span);
        catWrap.appendChild(item);
      });
    }
    const categoryCbs = ()=> [...catWrap.querySelectorAll('input[type="checkbox"]')];
    allBtn.disabled = catKeys.length === 0;
    clearBtn.disabled = catKeys.length === 0;
    allBtn.addEventListener('click', ()=>{
      muscleQuizSelectedRegions.add(regionKey);
      regionCb.checked = true;
      catWrap.classList.remove('hidden');
      categoryCbs().forEach(cb=>{
        cb.checked = true;
        muscleQuizSelectedCategories.add(cb.value);
      });
    });
    clearBtn.addEventListener('click', ()=>{
      muscleQuizSelectedRegions.delete(regionKey);
      regionCb.checked = false;
      categoryCbs().forEach(cb=>{
        cb.checked = false;
        muscleQuizSelectedCategories.delete(cb.value);
      });
      catWrap.classList.add('hidden');
    });

    regionCb.addEventListener('change', ()=>{
      if(regionCb.checked){
        muscleQuizSelectedRegions.add(regionKey);
        catWrap.classList.remove('hidden');
      } else {
        muscleQuizSelectedRegions.delete(regionKey);
        catWrap.classList.add('hidden');
        [...catWrap.querySelectorAll('input[type="checkbox"]')].forEach(cb=>{
          cb.checked = false;
          muscleQuizSelectedCategories.delete(cb.value);
        });
      }
    });

    wrapper.appendChild(catWrap);
    list.appendChild(wrapper);
  });
}

function buildMuscleQuizPool(){
  const regions = [...muscleQuizSelectedRegions];
  const categories = [...muscleQuizSelectedCategories];
  if(regions.length === 0 || categories.length === 0) return [];
  return muscleTerms.filter(r => {
    const regionKey = getMuscleRegionKey(r);
    const catKey = getMuscleCategoryKey(r);
    return regions.includes(regionKey) && categories.includes(`${regionKey}||${catKey}`);
  });
}

function renderMuscleQuizFields(){
  const fields = document.getElementById('muscle-quiz-fields');
  const area = document.getElementById('muscle-quiz-area');
  if(!fields || !area) return;
  fields.innerHTML = '';
  if(!muscleQuizCurrent){
    area.classList.add('hidden');
    return;
  }
  const toggleHead = document.createElement('div');
  toggleHead.className = 'muscle-quiz-toggle-head';
  const toggleHeadText = document.createElement('span');
  toggleHeadText.className = 'muscle-quiz-toggle-head-text';
  toggleHeadText.innerHTML = `${tOr('muscle_quiz_always', 'Always')}<br>${tOr('reveal', 'Reveal')}`;
  toggleHead.appendChild(toggleHeadText);
  fields.appendChild(toggleHead);

  const v = (value, key)=> {
    if(muscleQuizRevealed || muscleQuizPersistentFields.has(key) || muscleQuizTempFields.has(key)){
      return value || '-';
    }
    return MUSCLE_HIDDEN;
  };
  addMuscleField(fields, tOr('muscle_search_region', 'Region'), v(getMuscleRegionLabel(muscleQuizCurrent), 'region'), 'region', true);
  addMuscleField(fields, tOr('muscle_search_category', 'Category'), v(getMuscleCategoryLabel(muscleQuizCurrent), 'category'), 'category', true);
  addMuscleField(fields, tOr('muscle_search_latin_name', 'Latin name'), v(muscleQuizCurrent.latin_muscle_name, 'latin'), 'latin', true);
  addMuscleField(fields, tOr('muscle_search_english_name', 'English name'), v(muscleQuizCurrent.english_muscle_name, 'english'), 'english', true);
  addMuscleField(fields, tOr('muscle_search_muscle_part', 'Parts of muscle'), v(muscleQuizCurrent.muscle_part, 'part'), 'part', true);
  addMuscleField(fields, tOr('muscle_search_origo', 'Origo'), v(muscleQuizCurrent.origo, 'origo'), 'origo', true);
  addMuscleField(fields, tOr('muscle_search_insercio', 'Insercio'), v(muscleQuizCurrent.insercio, 'insercio'), 'insercio', true);
  addMuscleField(fields, tOr('muscle_search_blood_supply', 'Blood supply'), v(muscleQuizCurrent.blood_supply, 'blood_supply'), 'blood_supply', true);
  addMuscleField(fields, tOr('muscle_search_innervation', 'Innervation'), v(muscleQuizCurrent.innervation, 'innervation'), 'innervation', true);
  addMuscleField(fields, tOr('muscle_type_of_movement', 'Movement'), v(getMuscleMovementFunction(muscleQuizCurrent), 'movement'), 'movement', true);
  area.classList.remove('hidden');
}

function showNextMuscle(){
  if(!muscleQuizPool || muscleQuizPool.length === 0) return;
  muscleQuizCurrent = muscleQuizPool[Math.floor(Math.random() * muscleQuizPool.length)];
  muscleQuizRevealed = false;
  muscleQuizTempFields.clear();
  renderMuscleQuizFields();
}

function setMuscleQuizSetupCollapsed(collapsed){
  const setup = document.getElementById("muscle-quiz-setup");
  const toggleBtn = document.getElementById("muscle-quiz-settings-toggle");
  if(setup) setup.classList.toggle("hidden", !!collapsed);
  if(toggleBtn){
    toggleBtn.classList.toggle("hidden", !collapsed);
    toggleBtn.textContent = collapsed
      ? tOr("quiz_settings_show", "Show quiz settings")
      : tOr("quiz_settings_hide", "Hide quiz settings");
  }
}

function startMuscleQuiz(){
  const msg = document.getElementById('muscle-quiz-msg');
  if(msg) msg.textContent = '';
  muscleQuizPool = buildMuscleQuizPool();
  if(muscleQuizPool.length === 0){
    if(msg) msg.textContent = t('muscle_quiz_select_region') || 'Select a region and at least one group with data.';
    muscleQuizCurrent = null;
    renderMuscleQuizFields();
    return;
  }
  showNextMuscle();
  setMuscleQuizSetupCollapsed(true);
}

function refreshMuscleTrainingUI(){
  renderMuscleRegionList();
  renderMuscleQuizFields();
  const input = document.getElementById('muscle-search-input');
  if(input && input.value.trim().length >= 2) renderMuscleSearchResults();
}

function getLatinTerms(){
  return medicalTerms.filter(r => r && r.__dataset === LATIN_DATASET_KEY);
}

function getLatinUnitNumber(row){
  const direct = (
    row.unit_number ||
    row.unit ||
    row.lesson_number ||
    row.chapter_number ||
    ''
  ).trim();
  return direct || '';
}

function getLatinSourceDefaultName(row){
  const src = String((row && row.__sourcePath) || '').toLowerCase();
  if(src.endsWith('latin_units.csv')) return tOr('latin_source_units', 'Units');
  if(src.endsWith('latin_greek.csv')) return tOr('latin_source_greek', 'Latin-Greek synonyms');
  if(src.endsWith('latin_abbreviations.csv')){
    const hint = [
      row.unit_name,
      row.section_name,
      row.category,
      row.notes,
      row.english_translation
    ].map(v => String(v || '').toLowerCase()).join(' ');
    if(/prescript|prescription|recept|rx\b/.test(hint)){
      return tOr('latin_source_abbreviations_prescriptions', 'Abbreviations in prescriptions');
    }
    return tOr('latin_source_abbreviations', 'Abbreviations in medicine');
  }
  if(src.endsWith('latin_remedies.csv')) return tOr('latin_source_remedies', 'Remedies');
  return String(row.__sourceLabel || '').trim();
}

function getLocalizedLatinUnitName(row, fallbackName){
  const src = String((row && row.__sourcePath) || '').toLowerCase();
  if(!src.endsWith('latin_units.csv')) return fallbackName;
  const unitNumber = String(getLatinUnitNumber(row) || '').trim();
  const keyByNumber = {
    '1': 'latin_unit_name_1',
    '2': 'latin_unit_name_2',
    '3': 'latin_unit_name_3',
    '4': 'latin_unit_name_4',
    '5': 'latin_unit_name_5',
    '6': 'latin_unit_name_6',
    '7': 'latin_unit_name_7',
    '8': 'latin_unit_name_8',
    '9': 'latin_unit_name_9',
    '10': 'latin_unit_name_10',
    '11': 'latin_unit_name_11',
    '12': 'latin_unit_name_12',
    '13': 'latin_unit_name_13',
    '14': 'latin_unit_name_14'
  };
  const key = keyByNumber[unitNumber];
  if(!key) return fallbackName;
  return tOr(key, fallbackName);
}

function getLatinUnitName(row){
  const direct = (
    row.unit_name ||
    row.lesson_name ||
    row.chapter_name ||
    row.section_name ||
    ''
  ).trim();
  if(direct) return getLocalizedLatinUnitName(row, direct);
  return getLatinSourceDefaultName(row);
}

function getLatinUnitLabel(row){
  const number = getLatinUnitNumber(row);
  const name = getLatinUnitName(row);
  const unitWord = tOr('latin_quiz_unit_label', 'Unit');
  if(number && name) return `${unitWord} ${number} - ${name}`;
  if(number) return `${unitWord} ${number}`;
  if(name) return name;
  return tOr('latin_unit_unassigned', 'Unassigned unit');
}

function getLatinUnitKey(row){
  const number = getLatinUnitNumber(row);
  const name = getLatinUnitName(row);
  if(number || name) return `${number}||${name}`;
  return String(row.__sourcePath || 'latin_unknown');
}

function parseLatinUnitSortValue(unitNumber){
  const raw = String(unitNumber || '').trim();
  if(!raw) return { bucket: 2, num: Number.MAX_SAFE_INTEGER, text: '' };
  const appendix = raw.match(/^A(\d+)$/i);
  if(appendix) return { bucket: 1, num: Number(appendix[1]) || 0, text: raw };
  const normal = raw.match(/(\d+)/);
  if(normal) return { bucket: 0, num: Number(normal[1]) || 0, text: raw };
  return { bucket: 2, num: Number.MAX_SAFE_INTEGER, text: raw.toLowerCase() };
}

function compareLatinUnitEntries(a, b){
  const pa = parseLatinUnitSortValue(a.number);
  const pb = parseLatinUnitSortValue(b.number);
  if(pa.bucket !== pb.bucket) return pa.bucket - pb.bucket;
  if(pa.num !== pb.num) return pa.num - pb.num;
  return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
}

function isIgnoredLatinUnitEntry(entry){
  const number = String(entry && entry.number || '').trim().toLowerCase();
  const label = String(entry && entry.label || '').trim().toLowerCase();
  const ignoredLabels = new Set(['units', 'lektionen', 'lekcie']);
  if(number === 'unit_number') return true;
  if(ignoredLabels.has(label)) return true;
  return false;
}

function getLatinUnitEntries(){
  const terms = getLatinTerms();
  const units = new Map();
  for(const r of terms){
    const key = getLatinUnitKey(r);
    if(!units.has(key)){
      units.set(key, {
        key,
        number: getLatinUnitNumber(r),
        label: getLatinUnitLabel(r),
        count: 0
      });
    }
    units.get(key).count += 1;
  }
  return [...units.values()]
    .filter(e => !isIgnoredLatinUnitEntry(e))
    .sort(compareLatinUnitEntries);
}

function getLatinPartOfSpeechValues(rows){
  const values = new Set();
  for(const r of rows){
    const pos = String(r.part_of_speech || '').trim();
    if(pos && pos.toLowerCase() !== 'part_of_speech') values.add(pos);
  }
  return [...values].sort((a,b)=>a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function getLocalizedPartOfSpeechLabel(value){
  const raw = String(value || '').trim();
  if(!raw) return '';
  const key = `latin_pos_${raw.toLowerCase().replace(/\s+/g, '_')}`;
  return tOr(key, raw);
}

function getLatinResultFieldOrder(row){
  const src = String((row && row.__sourcePath) || '').toLowerCase();
  if(src.endsWith('latin_units.csv')){
    return [
      'latin_term',
      'latin_genitive',
      'part_of_speech',
      'gender',
      'english_translation',
      'german_translation',
      'slovak_translation',
      'english_definition',
      'german_definition',
      'slovak_definition',
      'notes'
    ];
  }
  if(src.endsWith('latin_greek.csv')){
    return [
      'latin_translation',
      'greek_translation',
      'english_translation',
      'german_translation',
      'slovak_translation'
    ];
  }
  if(src.endsWith('latin_abbreviations.csv')){
    return [
      'abbreviation',
      'full_form',
      'english_translation',
      'german_translation',
      'slovak_translation'
    ];
  }
  if(src.endsWith('latin_remedies.csv')){
    return [
      'name',
      'english_description',
      'german_description',
      'slovak_description'
    ];
  }
  return getRowHeaders(row);
}

function getLatinResultFields(row){
  const ordered = getLatinResultFieldOrder(row);
  const seen = new Set();
  const fields = [];
  for(const key of ordered){
    const k = String(key || '').trim();
    if(!k || seen.has(k)) continue;
    seen.add(k);
    const rawValue = String(row && row[k] || '').trim();
    if(!rawValue) continue;
    const value = k === 'part_of_speech' ? getLocalizedPartOfSpeechLabel(rawValue) : rawValue;
    fields.push({ key: k, label: getLatinHeaderLabel(k), value });
  }
  if(fields.length > 0) return fields;

  const fallback = [];
  for(const key of getRowHeaders(row)){
    const rawValue = String(row && row[key] || '').trim();
    if(!rawValue) continue;
    const value = key === 'part_of_speech' ? getLocalizedPartOfSpeechLabel(rawValue) : rawValue;
    fallback.push({ key, label: getLatinHeaderLabel(key), value });
  }
  return fallback;
}

function ensureLatinSearchUnitSelection(entries){
  if(entries.length === 0){
    latinSearchSelectedUnits.clear();
    return;
  }
  if(!latinSearchUnitsInitialized){
    entries.forEach(e => latinSearchSelectedUnits.add(e.key));
    latinSearchUnitsInitialized = true;
    return;
  }
  const keys = new Set(entries.map(e => e.key));
  [...latinSearchSelectedUnits].forEach(k => {
    if(!keys.has(k)) latinSearchSelectedUnits.delete(k);
  });
}

function renderLatinSearchFilters(){
  const list = document.getElementById('latin-search-units-filter');
  const allBtn = document.getElementById('latin-search-all-units');
  const clearBtn = document.getElementById('latin-search-clear-units');
  const fieldSel = document.getElementById('latin-search-field');
  const posSel = document.getElementById('latin-search-pos');
  if(!list || !allBtn || !clearBtn || !fieldSel || !posSel) return;

  const entries = getLatinUnitEntries();
  ensureLatinSearchUnitSelection(entries);
  list.innerHTML = '';

  if(entries.length === 0){
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = tOr('latin_no_terms_available', 'No Latin terms available.');
    list.appendChild(empty);
  } else {
    entries.forEach(entry => {
      const item = document.createElement('label');
      item.className = 'checkbox-item latin-filter-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = entry.key;
      cb.checked = latinSearchSelectedUnits.has(entry.key);
      cb.addEventListener('change', ()=>{
        if(cb.checked) latinSearchSelectedUnits.add(entry.key);
        else latinSearchSelectedUnits.delete(entry.key);
        allBtn.disabled = latinSearchSelectedUnits.size === entries.length;
        clearBtn.disabled = latinSearchSelectedUnits.size === 0;
        renderLatinSearchResults();
      });
      const span = document.createElement('span');
      span.textContent = entry.label;
      item.appendChild(cb);
      item.appendChild(span);
      list.appendChild(item);
    });
  }

  allBtn.disabled = entries.length === 0 || latinSearchSelectedUnits.size === entries.length;
  clearBtn.disabled = latinSearchSelectedUnits.size === 0;
  allBtn.onclick = ()=>{
    entries.forEach(e => latinSearchSelectedUnits.add(e.key));
    renderLatinSearchFilters();
    renderLatinSearchResults();
  };
  clearBtn.onclick = ()=>{
    latinSearchSelectedUnits.clear();
    renderLatinSearchFilters();
    renderLatinSearchResults();
  };

  const selectedPos = String(localStorage.getItem(LATIN_SEARCH_POS_KEY) || 'any');
  const hadValue = posSel.value;
  const keep = hadValue && hadValue !== 'any' ? hadValue : selectedPos;
  posSel.innerHTML = '';
  const anyOpt = document.createElement('option');
  anyOpt.value = 'any';
  anyOpt.textContent = tOr('any', 'Any');
  posSel.appendChild(anyOpt);
  const posValues = getLatinPartOfSpeechValues(getLatinTerms());
  posValues.forEach(pos => {
    const opt = document.createElement('option');
    opt.value = pos;
    opt.textContent = getLocalizedPartOfSpeechLabel(pos);
    posSel.appendChild(opt);
  });
  if([...posSel.options].some(o => o.value === keep)) posSel.value = keep;
  else posSel.value = 'any';

  const selectedField = String(localStorage.getItem(LATIN_SEARCH_FIELD_KEY) || 'any');
  if([...fieldSel.options].some(o => o.value === selectedField)) fieldSel.value = selectedField;
  else fieldSel.value = 'any';
}

function addLatinField(container, label, value, key, showToggles){
  const row = document.createElement('div');
  row.className = 'muscle-field';
  const l = document.createElement('div');
  l.className = 'muscle-field-label';
  if(showToggles && key){
    const toggle = document.createElement('label');
    toggle.className = 'latin-quiz-field-toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = latinQuizPersistentFields.has(key);
    cb.addEventListener('change', ()=>{
      if(cb.checked) latinQuizPersistentFields.add(key);
      else latinQuizPersistentFields.delete(key);
      renderLatinQuizFields();
    });
    const text = document.createElement('span');
    text.textContent = label;
    toggle.appendChild(cb);
    toggle.appendChild(text);
    l.appendChild(toggle);
  } else {
    l.textContent = label;
  }
  const v = document.createElement('div');
  v.className = 'muscle-field-value';
  v.textContent = value || '-';
  row.appendChild(l);
  row.appendChild(v);

  if(showToggles && key && value === LATIN_HIDDEN){
    const coverBtn = document.createElement('button');
    coverBtn.type = 'button';
    coverBtn.className = 'muscle-field-cover';
    coverBtn.textContent = tOr('reveal', 'Reveal');
    coverBtn.addEventListener('click', ()=>{
      latinQuizTempFields.add(key);
      renderLatinQuizFields();
    });
    v.appendChild(coverBtn);
  }

  container.appendChild(row);
}

function renderLatinSearchResults(){
  const input = document.getElementById('latin-search-input');
  const fieldSel = document.getElementById('latin-search-field');
  const posSel = document.getElementById('latin-search-pos');
  const results = document.getElementById('latin-search-results');
  if(!input || !results) return;
  const q = input.value.trim().toLowerCase();
  results.innerHTML = '';
  if(q.length < 2) return;

  const selectedField = fieldSel ? fieldSel.value : 'any';
  const selectedPos = posSel ? posSel.value : 'any';
  const selectedUnits = latinSearchSelectedUnits;
  const terms = getLatinTerms();
  const matches = terms.filter(r => {
    if(selectedUnits.size === 0) return false;
    const unitLabel = getLatinUnitLabel(r);
    const unitKey = getLatinUnitKey(r);
    const partOfSpeech = String(r.part_of_speech || '').trim();
    if(selectedUnits.size > 0 && !selectedUnits.has(unitKey)) return false;
    if(selectedPos !== 'any' && partOfSpeech !== selectedPos) return false;
    const matchesSelectedField = (() => {
      if(selectedField === 'english_translation') return includesQuery(r.english_translation, q);
      if(selectedField === 'german_translation') return includesQuery(r.german_translation, q);
      if(selectedField === 'slovak_translation') return includesQuery(r.slovak_translation, q);
      if(selectedField === 'abbreviation') return includesQuery(r.abbreviation, q);
      if(selectedField === 'latin_like'){
        return (
          includesQuery(r.latin_translation, q) ||
          includesQuery(r.latin_term, q) ||
          includesQuery(r.full_form, q) ||
          includesQuery(r.name, q)
        );
      }
      return (
        includesQuery(unitLabel, q) ||
        includesQuery(getLatinSourceDefaultName(r), q) ||
        matchAnyHeader(r, q) ||
        includesQuery(r.latin_translation, q) ||
        includesQuery(r.latin_term, q) ||
        includesQuery(r.latin_genitive, q) ||
        includesQuery(r.gender, q) ||
        includesQuery(r.full_form, q) ||
        includesQuery(r.name, q) ||
        includesQuery(r.abbreviation, q) ||
        includesQuery(r.english_translation, q) ||
        includesQuery(r.german_translation, q) ||
        includesQuery(r.slovak_translation, q) ||
        includesQuery(r.english_definition, q) ||
        includesQuery(r.german_definition, q) ||
        includesQuery(r.slovak_definition, q) ||
        includesQuery(r.notes, q)
      );
    })();
    if(!matchesSelectedField) return false;
    return true;
  });

  const sortedMatches = [...matches].sort((a, b)=>{
    const ua = { number: getLatinUnitNumber(a), label: getLatinUnitLabel(a) };
    const ub = { number: getLatinUnitNumber(b), label: getLatinUnitLabel(b) };
    const unitCmp = compareLatinUnitEntries(ua, ub);
    if(unitCmp !== 0) return unitCmp;
    const aTerm = String(a.latin_term || '').trim();
    const bTerm = String(b.latin_term || '').trim();
    return aTerm.localeCompare(bTerm, undefined, { sensitivity: 'base' });
  });

  if(sortedMatches.length === 0){
    results.textContent = tOr('latin_search_no_results', 'No Latin terms found.');
    return;
  }

  const limit = 100;
  sortedMatches.slice(0, limit).forEach(r=>{
    const card = document.createElement('div');
    card.className = 'muscle-result';
    addMuscleField(card, tOr('latin_quiz_unit_label', 'Unit'), getLatinUnitLabel(r), null, false, q);
    const fields = getLatinResultFields(r);
    fields.forEach(f => addMuscleField(card, f.label, f.value, null, false, q));
    results.appendChild(card);
  });
  if(sortedMatches.length > limit){
    const note = document.createElement('div');
    note.className = 'muted';
    note.textContent = `Showing first ${limit} results.`;
    results.appendChild(note);
  }
}

function renderLatinUnitList(){
  const list = document.getElementById('latin-unit-list');
  if(!list) return;
  list.innerHTML = '';
  const terms = getLatinTerms();
  if(terms.length === 0){
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = tOr('latin_no_terms_available', 'No Latin terms available.');
    list.appendChild(empty);
    return;
  }

  const units = new Map();
  for(const r of terms){
    const key = getLatinUnitKey(r);
    if(!units.has(key)){
      units.set(key, {
        key,
        number: getLatinUnitNumber(r),
        label: getLatinUnitLabel(r),
        count: 0
      });
    }
    units.get(key).count += 1;
  }

  const entries = [...units.values()]
    .filter(e => !isIgnoredLatinUnitEntry(e))
    .sort(compareLatinUnitEntries);
  const entryKeys = new Set(entries.map(e => e.key));
  [...latinQuizSelectedUnits].forEach(k => {
    if(!entryKeys.has(k)) latinQuizSelectedUnits.delete(k);
  });

  const controls = document.createElement('div');
  controls.className = 'muscle-region-controls';
  const clearAllBtn = document.createElement('button');
  clearAllBtn.type = 'button';
  clearAllBtn.className = 'muscle-region-action-btn danger';
  clearAllBtn.textContent = tOr('muscle_clear_all', 'Clear all');
  clearAllBtn.disabled = latinQuizSelectedUnits.size === 0;
  clearAllBtn.addEventListener('click', ()=>{
    const confirmText = tOr('latin_clear_all_confirm', 'Clear all selected units?');
    if(!window.confirm(confirmText)) return;
    latinQuizSelectedUnits.clear();
    renderLatinUnitList();
  });
  controls.appendChild(clearAllBtn);
  list.appendChild(controls);

  const grid = document.createElement('div');
  grid.className = 'checkbox-grid';
  for(const entry of entries){
    const item = document.createElement('label');
    item.className = 'checkbox-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = entry.key;
    cb.checked = latinQuizSelectedUnits.has(entry.key);
    cb.addEventListener('change', ()=>{
      if(cb.checked) latinQuizSelectedUnits.add(entry.key);
      else latinQuizSelectedUnits.delete(entry.key);
      clearAllBtn.disabled = latinQuizSelectedUnits.size === 0;
    });
    const span = document.createElement('span');
    span.textContent = entry.label;
    item.appendChild(cb);
    item.appendChild(span);
    grid.appendChild(item);
  }
  list.appendChild(grid);
}

function buildLatinQuizPool(){
  const selected = [...latinQuizSelectedUnits];
  if(selected.length === 0) return [];
  return getLatinTerms().filter(r => selected.includes(getLatinUnitKey(r)));
}

function renderLatinQuizFields(){
  const fields = document.getElementById('latin-quiz-fields');
  const area = document.getElementById('latin-quiz-area');
  if(!fields || !area) return;
  fields.innerHTML = '';
  if(!latinQuizCurrent){
    area.classList.add('hidden');
    return;
  }

  const v = (value, key)=> {
    if(latinQuizRevealed || latinQuizPersistentFields.has(key) || latinQuizTempFields.has(key)){
      return value || '-';
    }
    return LATIN_HIDDEN;
  };

  addLatinField(fields, tOr('latin_quiz_unit_label', 'Unit'), v(getLatinUnitLabel(latinQuizCurrent), 'unit'), 'unit', true);
  const quizFields = getLatinResultFields(latinQuizCurrent);
  quizFields.forEach(f => addLatinField(fields, f.label, v(f.value, f.key), f.key, true));
  area.classList.remove('hidden');
}

function showNextLatinTerm(){
  if(!latinQuizPool || latinQuizPool.length === 0) return;
  latinQuizCurrent = latinQuizPool[Math.floor(Math.random() * latinQuizPool.length)];
  latinQuizRevealed = false;
  latinQuizTempFields.clear();
  renderLatinQuizFields();
}

function startLatinQuiz(){
  const msg = document.getElementById('latin-quiz-msg');
  if(msg) msg.textContent = '';
  latinQuizPool = buildLatinQuizPool();
  if(latinQuizPool.length === 0){
    if(msg) msg.textContent = tOr('latin_quiz_select_unit', 'Select at least one unit with data.');
    latinQuizCurrent = null;
    renderLatinQuizFields();
    return;
  }
  showNextLatinTerm();
}

function refreshLatinTerminologyUI(){
  renderLatinSearchFilters();
  renderLatinUnitList();
  renderLatinQuizFields();
  const input = document.getElementById('latin-search-input');
  if(input && input.value.trim().length >= 2) renderLatinSearchResults();
}

// --- Anamnesis helpers ---
let anamnesisSaveTimer = null;
const ANAMNESIS_NOTES_BULLETS_KEY = "anamnesis_notes_bullets";
let psychiatryAnamnesisRows = null;
const psychiatryTermExplanations = new Map();
let psychiatryTermExplanationsLoaded = false;
const PSY_HELP_POPOVER_ID = "psy-help-popover";
let psychiatryHelpPopoverEl = null;
let psychiatryHelpActiveButton = null;
let psychiatryHelpActiveAnchor = null;

const ANAMNESIS_REPEATERS = [
  {
    rowsId: "pmh-operations-rows",
    addId: "pmh-operations-add",
    prefix: "pmh_operations",
    columns: [
      { key: "date", placeholder: "Date" },
      { key: "procedure", placeholder: "Procedure/Diagnosis" },
      { key: "outcome", placeholder: "Outcome" }
    ]
  },
  {
    rowsId: "medication-rows",
    addId: "medication-add",
    prefix: "medication_list",
    columns: [
      { key: "drug", placeholder: "Drug", anamKey: "anam_drug" },
      { key: "dose", placeholder: "Dose", anamKey: "anam_dose" },
      { key: "frequency", placeholder: "Frequency", anamKey: "anam_medication_frequency" },
      { key: "indication", placeholder: "Indication", anamKey: "anam_indication" }
    ]
  },
  {
    rowsId: "family-history-rows",
    addId: "family-history-add",
    prefix: "family_history",
    columns: [
      { key: "disease", placeholder: "Disease", anamKey: "anam_choroba" },
      { key: "details", placeholder: "Details", anamKey: "anam_detaily" },
      { key: "relation", placeholder: "Relation to p.", anamKey: "anam_relation_to_p" }
    ]
  },
  {
    rowsId: "ped-hospitalizations-rows",
    addId: "ped-hospitalizations-add",
    prefix: "ped_hospitalizations",
    columns: [
      { key: "date", placeholder: "Date" },
      { key: "procedure", placeholder: "Procedure/Diagnosis" },
      { key: "outcome", placeholder: "Outcome" }
    ]
  },
  {
    rowsId: "ped-planned-op-rows",
    addId: "ped-planned-op-add",
    prefix: "ped_planned_op",
    columns: [
      { key: "date", placeholder: "Date" },
      { key: "procedure", placeholder: "Procedure/Diagnosis" },
      { key: "outcome", placeholder: "Outcome" }
    ]
  },
  {
    rowsId: "ped-medication-rows",
    addId: "ped-medication-add",
    prefix: "ped_medication",
    columns: [
      { key: "drug", placeholder: "Drug", anamKey: "anam_drug" },
      { key: "dose", placeholder: "Dose", anamKey: "anam_dose" },
      { key: "frequency", placeholder: "Frequency", anamKey: "anam_medication_frequency" },
      { key: "indication", placeholder: "Indication", anamKey: "anam_indication" }
    ]
  },
  {
    rowsId: "pmh-planned-op-rows",
    addId: "pmh-planned-op-add",
    prefix: "pmh_planned_op",
    columns: [
      { key: "date", placeholder: "Date" },
      { key: "procedure", placeholder: "Procedure/Diagnosis" },
      { key: "outcome", placeholder: "Outcome" }
    ]
  }
];

function getRepeaterConfigByRowsId(rowsId){
  return ANAMNESIS_REPEATERS.find(c => c.rowsId === rowsId);
}

function buildRepeaterRow(rowsId, index){
  const cfg = getRepeaterConfigByRowsId(rowsId);
  if(!cfg) return null;
  const row = document.createElement("div");
  row.className = "anam-repeater-row";
  row.dataset.index = String(index);
  cfg.columns.forEach(col => {
    const input = document.createElement("input");
    input.name = `${cfg.prefix}_${col.key}_${index}`;
    input.placeholder = col.placeholder;
    if(col.anamKey) input.dataset.anamKey = col.anamKey;
    row.appendChild(input);
  });
  if(rowsId === "medication-rows" || rowsId === "ped-medication-rows"){
    const searchBtn = document.createElement("button");
    searchBtn.type = "button";
    searchBtn.className = "anam-remove-row anam-search-row";
    searchBtn.textContent = "Ã°Å¸â€Â";
    searchBtn.title = "Search this drug on Google";
    searchBtn.setAttribute("aria-label", "Search this drug on Google");
    searchBtn.addEventListener("click", ()=>{
      const drugInput = row.querySelector(`input[name="${cfg.prefix}_drug_${index}"]`);
      const query = String(drugInput?.value || "").trim();
      if(!query){
        if(drugInput) drugInput.focus();
        return;
      }
      const lang = normalizeLanguage(state.language);
      const suffix = (lang === "Slovensky") ? "pouÃ…Â¾itie lieku" : "drug use";
      const q = encodeURIComponent(`${query} ${suffix}`);
      window.open(`https://www.google.com/search?q=${q}`, "_blank", "noopener,noreferrer");
    });
    row.appendChild(searchBtn);
  }
  const del = document.createElement("button");
  del.type = "button";
  del.className = "anam-remove-row";
  del.textContent = "-";
  del.addEventListener("click", ()=>{
    const wrap = document.getElementById(rowsId);
    if(!wrap) return;
    if(wrap.children.length <= 1){
      const first = wrap.querySelector(".anam-repeater-row");
      if(!first) return;
      first.querySelectorAll("input").forEach(i=>{ i.value = ""; });
      scheduleAnamnesisSave();
      return;
    }
    row.remove();
    scheduleAnamnesisSave();
  });
  row.appendChild(del);
  return row;
}

function addRepeaterRow(rowsId){
  const wrap = document.getElementById(rowsId);
  if(!wrap) return;
  const max = [...wrap.querySelectorAll(".anam-repeater-row")]
    .map(r => Number(r.dataset.index || "0"))
    .reduce((a,b)=>Math.max(a,b), 0);
  const row = buildRepeaterRow(rowsId, max + 1);
  if(row){
    wrap.appendChild(row);
    // New dynamic rows need immediate i18n pass.
    applyAnamnesisTranslationsToDom();
    refreshAnamnesisInputMode();
  }
}

function bindAnamnesisRepeaterButton(addId, rowsId){
  const btn = document.getElementById(addId);
  if(!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", ()=>{
    addRepeaterRow(rowsId);
    scheduleAnamnesisSave();
  });
}

function bindAllAnamnesisRepeaterButtons(){
  for(const cfg of ANAMNESIS_REPEATERS){
    bindAnamnesisRepeaterButton(cfg.addId, cfg.rowsId);
  }
}

function initAnamnesisRepeaters(savedData){
  for(const cfg of ANAMNESIS_REPEATERS){
    const wrap = document.getElementById(cfg.rowsId);
    if(!wrap) continue;
    wrap.innerHTML = "";
    let maxIndex = 0;
    if(savedData){
      const re = new RegExp(`^${cfg.prefix}_[a-z_]+_(\\d+)$`);
      for(const key of Object.keys(savedData)){
        const m = key.match(re);
        if(m) maxIndex = Math.max(maxIndex, Number(m[1]) || 0);
      }
    }
    const count = Math.max(1, maxIndex);
    for(let i=1;i<=count;i++){
      const row = buildRepeaterRow(cfg.rowsId, i);
      if(row) wrap.appendChild(row);
    }
  }
  // Repeater rows are recreated dynamically, so re-apply translations afterwards.
  applyAnamnesisTranslationsToDom();
  refreshAnamnesisInputMode();
}

function updatePlannedOperationVisibility(){
  const wrap = document.getElementById("pmh-planned-op-wrap");
  if(!wrap) return;
  const yes = document.querySelector('input[name="pmh_planned_op"][value="yes"]');
  wrap.classList.toggle("hidden", !(yes && yes.checked));
}

function updateHousingVisibility(){
  const house = document.getElementById("social-house");
  const flat = document.getElementById("social-flat");
  const homeless = document.getElementById("social-homeless");
  const houseWrap = document.getElementById("social-house-wrap");
  const flatWrap = document.getElementById("social-flat-wrap");
  const homelessWrap = document.getElementById("social-homeless-wrap");
  if(houseWrap) houseWrap.classList.toggle("hidden", !(house && house.checked));
  if(flatWrap) flatWrap.classList.toggle("hidden", !(flat && flat.checked));
  if(homelessWrap) homelessWrap.classList.toggle("hidden", !(homeless && homeless.checked));
}

function normalizeHousingSelection(preferredId = ""){
  const ids = ["social-house", "social-flat", "social-homeless"];
  const boxes = ids
    .map(id => document.getElementById(id))
    .filter(Boolean);
  if(boxes.length === 0) return;

  const preferred = preferredId ? document.getElementById(preferredId) : null;
  if(preferred && preferred.checked){
    boxes.forEach(cb => { if(cb !== preferred) cb.checked = false; });
    return;
  }

  const checked = boxes.filter(cb => cb.checked);
  if(checked.length <= 1) return;
  const keep = checked[0];
  checked.slice(1).forEach(cb => { cb.checked = false; });
  keep.checked = true;
}

function normalizeEmploymentSelection(preferredName = ""){
  const names = ["social_working", "social_retired", "social_unemployed"];
  const boxes = names
    .map(name => document.querySelector(`input[name="${name}"]`))
    .filter(Boolean);
  if(boxes.length === 0) return;

  const preferred = preferredName ? document.querySelector(`input[name="${preferredName}"]`) : null;
  if(preferred && preferred.checked){
    boxes.forEach(cb => { if(cb !== preferred) cb.checked = false; });
    return;
  }

  const checked = boxes.filter(cb => cb.checked);
  if(checked.length <= 1) return;
  const keep = checked[0];
  checked.slice(1).forEach(cb => { cb.checked = false; });
  keep.checked = true;
}

function normalizeMaritalSelection(preferredName = ""){
  const names = ["social_single", "social_married", "social_divorced", "social_widowed"];
  const boxes = names
    .map(name => document.querySelector(`input[name="${name}"]`))
    .filter(Boolean);
  if(boxes.length === 0) return;

  const preferred = preferredName ? document.querySelector(`input[name="${preferredName}"]`) : null;
  if(preferred && preferred.checked){
    boxes.forEach(cb => { if(cb !== preferred) cb.checked = false; });
    return;
  }

  const checked = boxes.filter(cb => cb.checked);
  if(checked.length <= 1) return;
  const keep = checked[0];
  checked.slice(1).forEach(cb => { cb.checked = false; });
  keep.checked = true;
}

function normalizeLivingSelection(preferredName = ""){
  const names = ["social_alone", "social_family"];
  const boxes = names
    .map(name => document.querySelector(`input[name="${name}"]`))
    .filter(Boolean);
  if(boxes.length === 0) return;

  const preferred = preferredName ? document.querySelector(`input[name="${preferredName}"]`) : null;
  if(preferred && preferred.checked){
    boxes.forEach(cb => { if(cb !== preferred) cb.checked = false; });
    return;
  }

  const checked = boxes.filter(cb => cb.checked);
  if(checked.length <= 1) return;
  const keep = checked[0];
  checked.slice(1).forEach(cb => { cb.checked = false; });
  keep.checked = true;
}

function normalizeParentsAliveSelection(preferredName = ""){
  const names = ["family_parents_both", "family_parents_one", "family_parents_none"];
  const boxes = names
    .map(name => document.querySelector(`input[name="${name}"]`))
    .filter(Boolean);
  if(boxes.length === 0) return;

  const preferred = preferredName ? document.querySelector(`input[name="${preferredName}"]`) : null;
  if(preferred && preferred.checked){
    boxes.forEach(cb => { if(cb !== preferred) cb.checked = false; });
    return;
  }

  const checked = boxes.filter(cb => cb.checked);
  if(checked.length <= 1) return;
  const keep = checked[0];
  checked.slice(1).forEach(cb => { cb.checked = false; });
  keep.checked = true;
}

function updateMedicationConditionalVisibility(){
  const misuseYes = document.querySelector('input[name="med_misuse"][value="yes"]');
  const wrap = document.getElementById("med-misuse-notes-wrap");
  if(wrap) wrap.classList.toggle("hidden", !(misuseYes && misuseYes.checked));
}

function updateMedicationDetailsVisibility(){
  const otcYes = document.querySelector('input[name="med_otc"][value="yes"]');
  const supplementsYes = document.querySelector('input[name="med_supplements"][value="yes"]');
  const otcWrap = document.getElementById("med-otc-details-wrap");
  const supplementsWrap = document.getElementById("med-supplements-details-wrap");
  if(otcWrap) otcWrap.classList.toggle("hidden", !(otcYes && otcYes.checked));
  if(supplementsWrap) supplementsWrap.classList.toggle("hidden", !(supplementsYes && supplementsYes.checked));
}

function updateBloodTransfusionVisibility(){
  const transfusionYes = document.querySelector('input[name="blood_transfusion"][value="yes"]');
  const reactionYes = document.querySelector('input[name="blood_transfusion_reaction"][value="yes"]');
  const detailsWrap = document.getElementById("blood-transfusion-details-wrap");
  const reactionNotesWrap = document.getElementById("blood-transfusion-reaction-notes-wrap");
  const showDetails = !!(transfusionYes && transfusionYes.checked);
  if(detailsWrap) detailsWrap.classList.toggle("hidden", !showDetails);
  if(reactionNotesWrap){
    const showReactionNotes = showDetails && !!(reactionYes && reactionYes.checked);
    reactionNotesWrap.classList.toggle("hidden", !showReactionNotes);
  }
}

function updateGynecologicalVisibility(form = null){
  const scope = form && typeof form.querySelector === "function" ? form : document;
  const wrap = document.getElementById("anam-gyn-section");
  const female = scope.querySelector('input[name="ident_sex"][value="female"]');
  if(wrap) wrap.classList.toggle("hidden", !(female && female.checked));
}

function updatePediatricsBloodTransfusionVisibility(){
  const transfusionYes = document.querySelector('input[name="ped_blood_transfusion"][value="yes"]');
  const reactionYes = document.querySelector('input[name="ped_blood_transfusion_reaction"][value="yes"]');
  const detailsWrap = document.getElementById("ped-blood-transfusion-details-wrap");
  const reactionNotesWrap = document.getElementById("ped-blood-transfusion-reaction-notes-wrap");
  const showDetails = !!(transfusionYes && transfusionYes.checked);
  if(detailsWrap) detailsWrap.classList.toggle("hidden", !showDetails);
  if(reactionNotesWrap){
    const showReactionNotes = showDetails && !!(reactionYes && reactionYes.checked);
    reactionNotesWrap.classList.toggle("hidden", !showReactionNotes);
  }
}

function updatePediatricsMedicationConditionalVisibility(){
  const misuseYes = document.querySelector('input[name="ped_med_misuse"][value="yes"]');
  const wrap = document.getElementById("ped-med-misuse-notes-wrap");
  if(wrap) wrap.classList.toggle("hidden", !(misuseYes && misuseYes.checked));
}

function updatePediatricsMedicationDetailsVisibility(){
  const otcYes = document.querySelector('input[name="ped_med_otc"][value="yes"]');
  const supplementsYes = document.querySelector('input[name="ped_med_supplements"][value="yes"]');
  const otcWrap = document.getElementById("ped-med-otc-details-wrap");
  const supplementsWrap = document.getElementById("ped-med-supplements-details-wrap");
  if(otcWrap) otcWrap.classList.toggle("hidden", !(otcYes && otcYes.checked));
  if(supplementsWrap) supplementsWrap.classList.toggle("hidden", !(supplementsYes && supplementsYes.checked));
}

function updatePediatricsPlannedOperationVisibility(){
  const wrap = document.getElementById("ped-planned-op-wrap");
  const yes = document.querySelector('input[name="ped_planned_op"][value="yes"]');
  if(wrap) wrap.classList.toggle("hidden", !(yes && yes.checked));
}

function updateHpiRadiationVisibility(){
  const yes = document.querySelector('input[name="hpi_radiation"][value="yes"]');
  const wrap = document.getElementById("hpi-radiation-where-wrap");
  if(wrap) wrap.classList.toggle("hidden", !(yes && yes.checked));
}

function initAnamnesisNotesDrawer(){
  const toggle = document.getElementById("anamnesis-notes-toggle");
  const drawer = document.getElementById("anamnesis-notes-drawer");
  const close = document.getElementById("anamnesis-notes-close");
  const edge = document.getElementById("anamnesis-notes-edge");
  const notes = document.getElementById("anamnesis-notes-text");
  const bullets = document.getElementById("anamnesis-notes-bullets");
  if(!toggle || !drawer || !close || !edge || !notes || !bullets) return;

  try{ bullets.checked = localStorage.getItem(ANAMNESIS_NOTES_BULLETS_KEY) === "1"; }catch(e){}
  bullets.addEventListener("change", ()=>{
    try{ localStorage.setItem(ANAMNESIS_NOTES_BULLETS_KEY, bullets.checked ? "1" : "0"); }catch(e){}
  });

  toggle.addEventListener("click", ()=> drawer.classList.add("open"));
  close.addEventListener("click", ()=> drawer.classList.remove("open"));
  edge.addEventListener("click", ()=> drawer.classList.remove("open"));

  notes.addEventListener("keydown", (e)=>{
    if(e.key !== "Enter" || !bullets.checked) return;
    const s = notes.selectionStart ?? 0;
    const epos = notes.selectionEnd ?? 0;
    const value = notes.value;
    const lineStart = value.lastIndexOf("\n", Math.max(0, s - 1)) + 1;
    const linePrefix = value.slice(lineStart, s);
    if(linePrefix.trim() === ""){
      e.preventDefault();
      notes.value = value.slice(0, s) + "- " + value.slice(epos);
      notes.selectionStart = notes.selectionEnd = s + 2;
      return;
    }
    e.preventDefault();
    notes.value = value.slice(0, s) + "\n- " + value.slice(epos);
    notes.selectionStart = notes.selectionEnd = s + 3;
    scheduleAnamnesisSave();
  });
}

const anamnesisMobileToolbarState = {
  initialized: false,
  lastScrollY: 0,
  expanded: false,
  revealVisible: false,
  scrollHost: null
};
let anamnesisPhoneToolsOpen = false;
let anamnesisPhoneRegistryVisible = false;

function usesFloatingAnamnesisToolbar(){
  return false;
}

function isPhoneAnamnesisLayoutMode(){
  return getResolvedAnamnesisLayoutMode() === "phone";
}

function getAnamnesisScrollHost(){
  return document.querySelector("main") || document.scrollingElement || document.documentElement || document.body || null;
}

function getAnamnesisScrollTop(){
  const host = getAnamnesisScrollHost();
  if(host && typeof host.scrollTop === "number") return Math.max(host.scrollTop, 0);
  return Math.max(window.scrollY || window.pageYOffset || 0, 0);
}

function updateAnamnesisMobileToolbarMetrics(){
  const screen = document.getElementById("screen-anamnesis");
  const toolbar = document.querySelector("#screen-anamnesis .anamnesis-patient-toolbar");
  if(!screen || !toolbar) return;
  const style = window.getComputedStyle(toolbar);
  const marginBottom = parseFloat(style.marginBottom || "0") || 0;
  const offset = Math.ceil(toolbar.getBoundingClientRect().height + marginBottom);
  screen.style.setProperty("--anam-toolbar-mobile-offset", `${Math.max(120, offset)}px`);
}

function applyAnamnesisMobileToolbarState(expanded, revealVisible){
  const screen = document.getElementById("screen-anamnesis");
  const reveal = document.getElementById("anamnesis-toolbar-reveal");
  if(!screen) return;
  screen.classList.toggle("anam-mobile-toolbar-collapsed", !expanded);
  screen.classList.toggle("anam-mobile-toolbar-reveal-visible", !expanded && revealVisible);
  if(reveal) reveal.setAttribute("aria-expanded", expanded ? "true" : "false");
  anamnesisMobileToolbarState.expanded = expanded;
  anamnesisMobileToolbarState.revealVisible = revealVisible;
}

function setAnamnesisPhoneToolsOpen(open){
  const screen = document.getElementById("screen-anamnesis");
  const toggle = document.getElementById("anamnesis-mobile-tools-toggle");
  const next = !!open;
  anamnesisPhoneToolsOpen = next;
  if(screen) screen.classList.toggle("anam-mobile-tools-open", next);
  if(toggle) toggle.setAttribute("aria-expanded", next ? "true" : "false");
}

function buildAnamnesisMobileSubtitle(record){
  if(!record) return tOr("anamnesis_registry_hint", "Select an existing patient or create a new anamnesis record.");
  const parts = [];
  if(Number.isFinite(Number(record.age)) && Number(record.age) >= 0){
    parts.push(`${Number(record.age)} y`);
  }
  const complaint = String(record.chiefComplaint || "").trim();
  if(complaint) parts.push(complaint);
  if(parts.length) return parts.join(" | ");
  return tOr("anamnesis_mobile_editor_hint", "Continue documenting this patient record.");
}

function getAnamnesisRecordDisplayName(record){
  const shared = extractSharedAnamnesisFields(record ? record.sharedFields : null);
  return String(
    record && (record.name || shared.ident_full_name)
      ? (record.name || shared.ident_full_name)
      : tOr("anamnesis_unnamed_patient", "Unnamed patient")
  ).trim();
}

function updateAnamnesisTypeIndicators(type, opts = {}){
  const { showPatientsLabel = false } = opts;
  const desktopLabelEl = document.getElementById("anamnesis-patient-type-copy");
  const mobileBadgeEl = document.getElementById("anamnesis-mobile-workflow-badge");
  const nextLabel = showPatientsLabel
    ? tOr("anamnesis_patients", "Patients")
    : getAnamnesisTypeLabel(type);
  if(desktopLabelEl) desktopLabelEl.textContent = nextLabel;
  if(mobileBadgeEl) mobileBadgeEl.textContent = nextLabel;
}

function updateAnamnesisMobileHeader(record){
  const titleEl = document.getElementById("anamnesis-editor-title");
  const subtitleEl = document.getElementById("anamnesis-editor-subtitle");
  const mobileTitleEl = document.getElementById("anamnesis-mobile-title");
  const mobileSubtitleEl = document.getElementById("anamnesis-mobile-subtitle");
  const patientsButton = document.getElementById("anamnesis-show-patients");
  const mobileBackButton = document.getElementById("anamnesis-mobile-back");
  const mobileSaveButton = document.getElementById("anamnesis-mobile-save");
  const nextTitle = record
    ? getAnamnesisRecordDisplayName(record)
    : tOr("anamnesis_patients", "Patients");
  const nextSubtitle = buildAnamnesisMobileSubtitle(record);
  if(titleEl){
    titleEl.textContent = record
      ? nextTitle
      : tOr("anamnesis_unnamed_patient", "Unnamed patient");
  }
  if(subtitleEl){
    subtitleEl.textContent = nextSubtitle;
  }
  if(mobileTitleEl){
    mobileTitleEl.textContent = nextTitle;
  }
  if(mobileSubtitleEl){
    mobileSubtitleEl.textContent = nextSubtitle;
  }
  if(patientsButton){
    patientsButton.hidden = !record;
    patientsButton.disabled = !record;
  }
  if(mobileBackButton){
    mobileBackButton.hidden = !record;
    mobileBackButton.disabled = !record;
  }
  if(mobileSaveButton){
    mobileSaveButton.disabled = !record;
  }
  updateAnamnesisTypeIndicators(record ? record.anamnesisType : "internal", { showPatientsLabel: !record });
}

function updateAnamnesisMobileHeaderPreview(){
  const current = getActiveAnamnesisPatientRecord();
  if(!current){
    updateAnamnesisMobileHeader(null);
    return;
  }
  const preview = { ...current };
  const form = getActiveAnamnesisForm();
  if(form){
    const nameInput = form.querySelector('[name="ident_full_name"]');
    const ageInput = form.querySelector('[name="ident_age"]');
    const complaintInput = form.querySelector('[name="chief_complaint"]');
    if(nameInput && String(nameInput.value || "").trim()) preview.name = String(nameInput.value || "").trim();
    if(ageInput && String(ageInput.value || "").trim()){
      preview.age = parseAnamnesisAge(ageInput.value);
    }
    if(complaintInput && String(complaintInput.value || "").trim()) preview.chiefComplaint = String(complaintInput.value || "").trim();
  }
  const typeEl = document.getElementById("anamnesis-patient-type");
  if(typeEl) preview.anamnesisType = typeEl.value;
  updateAnamnesisMobileHeader(preview);
}

function focusAnamnesisRegistryList(){
  const registryCard = document.getElementById("anamnesis-registry-card");
  if(!registryCard) return;
  try{
    registryCard.scrollIntoView({
      block: "start",
      behavior: prefersReducedMotion() ? "auto" : "smooth"
    });
  }catch(e){}
}

function showAnamnesisPatientListView(opts = {}){
  const { focus = true } = opts;
  anamnesisPhoneRegistryVisible = true;
  setAnamnesisPhoneToolsOpen(false);
  updateAnamnesisEditorChrome(getActiveAnamnesisPatientRecord());
  if(focus){
    requestAnimationFrame(()=> focusAnamnesisRegistryList());
  }
}

function syncAnamnesisMobileToolbar(opts = {}){
  const { forceExpanded = null, forceCollapsed = null } = opts;
  const screen = document.getElementById("screen-anamnesis");
  const editorCard = document.getElementById("anamnesis-editor-card");
  const currentY = getAnamnesisScrollTop();
  if(!screen || !editorCard || editorCard.classList.contains("hidden") || !usesFloatingAnamnesisToolbar()){
    if(screen){
      screen.classList.remove("anam-mobile-toolbar-collapsed", "anam-mobile-toolbar-reveal-visible");
      screen.style.removeProperty("--anam-toolbar-mobile-offset");
    }
    anamnesisMobileToolbarState.expanded = false;
    anamnesisMobileToolbarState.revealVisible = false;
    anamnesisMobileToolbarState.lastScrollY = currentY;
    return;
  }

  updateAnamnesisMobileToolbarMetrics();
  let expanded = anamnesisMobileToolbarState.expanded;
  let revealVisible = anamnesisMobileToolbarState.revealVisible;

  if(forceExpanded === true){
    expanded = true;
    revealVisible = false;
  } else if(forceCollapsed === true){
    expanded = false;
    revealVisible = true;
  } else {
    revealVisible = !expanded;
  }

  applyAnamnesisMobileToolbarState(expanded, revealVisible);
  if(expanded){
    requestAnimationFrame(()=> updateAnamnesisMobileToolbarMetrics());
  }
  anamnesisMobileToolbarState.lastScrollY = currentY;
}

function initAnamnesisMobileToolbar(){
  const reveal = document.getElementById("anamnesis-toolbar-reveal");
  const collapse = document.getElementById("anamnesis-toolbar-collapse");
  const toolsToggle = document.getElementById("anamnesis-mobile-tools-toggle");
  if(reveal && !reveal.dataset.bound){
    reveal.dataset.bound = "1";
    reveal.addEventListener("click", ()=>{
      syncAnamnesisMobileToolbar({ forceExpanded: true });
    });
  }
  if(collapse && !collapse.dataset.bound){
    collapse.dataset.bound = "1";
    collapse.addEventListener("click", ()=>{
      syncAnamnesisMobileToolbar({ forceCollapsed: true });
    });
  }
  if(toolsToggle && !toolsToggle.dataset.bound){
    toolsToggle.dataset.bound = "1";
    toolsToggle.addEventListener("click", ()=>{
      setAnamnesisPhoneToolsOpen(!anamnesisPhoneToolsOpen);
    });
  }
  if(anamnesisMobileToolbarState.initialized) return;
  anamnesisMobileToolbarState.initialized = true;
  anamnesisMobileToolbarState.lastScrollY = getAnamnesisScrollTop();
  const scrollHost = getAnamnesisScrollHost();
  anamnesisMobileToolbarState.scrollHost = scrollHost;
  if(scrollHost){
    scrollHost.addEventListener("scroll", ()=> syncAnamnesisMobileToolbar(), { passive: true });
  }
  window.addEventListener("scroll", ()=> syncAnamnesisMobileToolbar(), { passive: true });
  window.addEventListener("resize", ()=> syncAnamnesisMobileToolbar());
  window.addEventListener("orientationchange", ()=> syncAnamnesisMobileToolbar());
}

function normalizeAnamnesisLayoutMode(raw){
  const value = String(raw || "").trim().toLowerCase();
  if(value === "desktop") return "desktop";
  if(value === "tablet" || value === "phone" || value === "mobile") return "phone";
  return detectAnamnesisScreenFit();
}

function normalizeAnamnesisInputMode(raw){
  return String(raw || "").trim().toLowerCase() === "pen" ? "pen" : "keyboard";
}

function detectAnamnesisScreenFit(){
  const width = Math.round(window.visualViewport && window.visualViewport.width ? window.visualViewport.width : window.innerWidth || 0);
  if(width <= 760) return "phone";
  if(width <= 1180) return "phone";
  return "desktop";
}

function getResolvedAnamnesisLayoutMode(){
  return normalizeAnamnesisLayoutMode(anamnesisLayoutMode);
}

function canPreferStylusInput(){
  try{
    return Number(navigator.maxTouchPoints || 0) > 0 || !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  }catch(e){
    return false;
  }
}

function isAnamnesisTextEntry(el){
  if(el instanceof HTMLTextAreaElement) return true;
  if(!(el instanceof HTMLInputElement)) return false;
  const type = String(el.type || "text").toLowerCase();
  return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "hidden", "date", "datetime-local", "time", "month", "week"].includes(type);
}

function refreshAnamnesisInputMode(){
  const screen = document.getElementById("screen-anamnesis");
  if(!screen) return;
  screen.dataset.anamInputMode = anamnesisInputMode;
  screen.querySelectorAll("input, textarea").forEach(el=>{
    if(!(el instanceof HTMLElement) || !isAnamnesisTextEntry(el)) return;
    el.classList.toggle("anamnesis-pen-input", anamnesisInputMode === "pen");
    el.classList.toggle("anamnesis-pen-textarea", anamnesisInputMode === "pen" && el instanceof HTMLTextAreaElement);
    if(!el.dataset.anamOriginalInputmode){
      el.dataset.anamOriginalInputmode = el.getAttribute("inputmode") || "";
    }
    if(el.dataset.anamOriginalInputmode){
      el.setAttribute("inputmode", el.dataset.anamOriginalInputmode);
    } else {
      el.removeAttribute("inputmode");
    }
  });
}

function applyAnamnesisLayoutMode(){
  const screen = document.getElementById("screen-anamnesis");
  const select = document.getElementById("anamnesis-layout-mode");
  const resolved = getResolvedAnamnesisLayoutMode();
  if(screen) screen.dataset.anamLayout = resolved;
  if(select) select.value = anamnesisLayoutMode;
  anamnesisPhoneRegistryVisible = !getActiveAnamnesisPatientRecord();
  setAnamnesisPhoneToolsOpen(false);
  syncAnamnesisMobileToolbar();
}

function setAnamnesisLayoutMode(mode, opts = {}){
  const { persist = true } = opts;
  anamnesisLayoutMode = normalizeAnamnesisLayoutMode(mode);
  if(persist){
    try{ localStorage.setItem(ANAMNESIS_LAYOUT_MODE_KEY, anamnesisLayoutMode); }catch(e){}
  }
  applyAnamnesisLayoutMode();
  updateAnamnesisEditorChrome(getActiveAnamnesisPatientRecord());
}

function setAnamnesisInputMode(mode, opts = {}){
  const { persist = true } = opts;
  anamnesisInputMode = normalizeAnamnesisInputMode(mode);
  const select = document.getElementById("anamnesis-input-mode");
  if(select) select.value = anamnesisInputMode;
  if(persist){
    try{ localStorage.setItem(ANAMNESIS_INPUT_MODE_KEY, anamnesisInputMode); }catch(e){}
  }
  refreshAnamnesisInputMode();
}

function initAnamnesisPreferences(){
  try{ anamnesisLayoutMode = normalizeAnamnesisLayoutMode(localStorage.getItem(ANAMNESIS_LAYOUT_MODE_KEY)); }catch(e){ anamnesisLayoutMode = detectAnamnesisScreenFit(); }
  try{ anamnesisInputMode = normalizeAnamnesisInputMode(localStorage.getItem(ANAMNESIS_INPUT_MODE_KEY)); }catch(e){ anamnesisInputMode = "keyboard"; }
  applyAnamnesisLayoutMode();
  refreshAnamnesisInputMode();
}

function getActiveAnamnesisForm(){
  if(activeAnamnesisTab === "psychiatry"){
    return document.getElementById("anamnesis-psychiatry-form");
  }
  if(activeAnamnesisTab === "pediatrics"){
    return document.getElementById("anamnesis-pediatrics-form");
  }
  return document.getElementById("anamnesis-form");
}

function normalizeAnamnesisType(rawType){
  const value = String(rawType || "").trim().toLowerCase();
  if(value === "psychiatry") return "psychiatric";
  if(value === "surgery") return "internal";
  if(value === "psychiatric" || value === "internal" || value === "pediatrics") return value;
  return "internal";
}

function getAnamnesisFormTabByType(type){
  const normalized = normalizeAnamnesisType(type);
  if(normalized === "psychiatric") return "psychiatry";
  if(normalized === "pediatrics") return "pediatrics";
  return "internal";
}

function getAnamnesisTypeLabel(type){
  const normalized = normalizeAnamnesisType(type);
  if(normalized === "psychiatric") return tOr("anamnesis_type_psychiatric", "Psychiatric");
  if(normalized === "pediatrics") return tOr("anamnesis_type_pediatrics", "Pediatrics");
  return tOr("anamnesis_type_internal", "Internal");
}

const SHARED_PSYCHIATRY_FIELD_IDS = new Set([
  "psych_name",
  "psych_age",
  "psych_dob",
  "psych_address",
  "psych_admitted_when",
  "psych_admission_reason"
]);
const ANAMNESIS_SHARED_FIELD_NAMES = [
  "ident_full_name",
  "ident_dob",
  "ident_age",
  "ident_sex",
  "ident_city",
  "ident_admitted",
  "chief_complaint"
];
const PEDIATRICS_PRENATAL_ROWS = [
  { label: "Planned pregnancy", key: "ped_planned_pregnancy" },
  { label: "Regular prenatal care", key: "ped_regular_prenatal_care" },
  { label: "Bleeding / spotting", key: "ped_bleeding_spotting" },
  { label: "Rubella during pregnancy", key: "ped_rubella_during_pregnancy" },
  { label: "Gestational diabetes", key: "ped_gestational_diabetes" },
  { label: "Hypertension / preeclampsia", key: "ped_hypertension_preeclampsia" },
  { label: "Kidney disease", key: "ped_kidney_disease" },
  { label: "Premature contractions", key: "ped_premature_contractions" },
  { label: "Threatened miscarriage", key: "ped_threatened_miscarriage" },
  { label: "Drugs / alcohol / smoking", key: "ped_drugs_alcohol_smoking" },
  { label: "Medications / herbs used", key: "ped_medications_herbs_used" },
  { label: "Fertility treatment", key: "ped_fertility_treatment" }
];
const PEDIATRICS_IMMUNIZATION_ROWS = [
  { id: "hexa_1", label: "Hexavalent vaccine - 1st dose", labelKey: "ped_hexa_1", age: "3rd month (from 10th week of life)", ageKey: "ped_age_3rd_month_10th_week" },
  { id: "hexa_2", label: "Hexavalent vaccine - 2nd dose", labelKey: "ped_hexa_2", age: "5th month of life", ageKey: "ped_age_5th_month_life" },
  { id: "hexa_3", label: "Hexavalent vaccine - 3rd dose", labelKey: "ped_hexa_3", age: "11th month of life", ageKey: "ped_age_11th_month_life" },
  { id: "pcv_1", label: "PCV - 1st dose", labelKey: "ped_pcv_1", age: "3rd month of life", ageKey: "ped_age_3rd_month_life" },
  { id: "pcv_2", label: "PCV - 2nd dose", labelKey: "ped_pcv_2", age: "5th month of life", ageKey: "ped_age_5th_month_life" },
  { id: "pcv_3", label: "PCV - 3rd dose", labelKey: "ped_pcv_3", age: "11th month of life", ageKey: "ped_age_11th_month_life" },
  { id: "mmr_1", label: "MMR - 1st dose", labelKey: "ped_mmr_1", age: "15-18 months of life", ageKey: "ped_age_15_18_months" },
  { id: "mmr_2", label: "MMR - 2nd dose", labelKey: "ped_mmr_2", age: "5th year of life", ageKey: "ped_age_5th_year_life" },
  { id: "dtap_ipv_1", label: "Booster DTaP-IPV", labelKey: "ped_dtap_ipv_1", age: "6th year of life", ageKey: "ped_age_6th_year_life" },
  { id: "dtap_ipv_2", label: "DTaP-IPV booster 2", labelKey: "ped_dtap_ipv_2", age: "13th year of life", ageKey: "ped_age_13th_year_life" }
];
const PEDIATRICS_PMH_ROWS = [
  { label: "Varicella", key: "ped_varicella" }, { label: "Measles", key: "ped_measles" }, { label: "Mumps", key: "ped_mumps" }, { label: "Rubella", key: "ped_rubella" },
  { label: "Bronchitis / pneumonia", key: "ped_bronchitis_pneumonia" }, { label: "Otitis media (recurrent)", key: "ped_otitis_media_recurrent" },
  { label: "Asthma / wheezing", key: "ped_asthma_wheezing" }, { label: "Seizures", key: "ped_seizures" }, { label: "Anemia", key: "ped_anemia" }, { label: "UTI", key: "ped_uti" },
  { label: "Abdominal pain", key: "ped_abdominal_pain" }, { label: "Skin problems", key: "ped_skin_problems" }
];
const PEDIATRICS_FAMILY_ROWS = [
  { label: "Allergies", key: "ped_allergies" }, { label: "Asthma", key: "ped_asthma_wheezing" }, { label: "Diabetes", key: "ped_diabetes" },
  { label: "Hypertension", key: "ped_hypertension" }, { label: "Heart disease", key: "ped_heart_disease" }, { label: "Thyroid disease", key: "ped_thyroid_disease" },
  { label: "Epilepsy", key: "ped_epilepsy" }, { label: "Cancer", key: "ped_cancer" }, { label: "Genetic disorders", key: "ped_genetic_disorders" }
];
const PEDIATRICS_SOCIAL_ROWS = [
  { label: "Smoking in home", key: "ped_smoking_in_home" }, { label: "Pets or farm animals", key: "ped_pets_or_farm_animals" },
  { label: "School/daycare attendance", key: "ped_school_daycare_attendance" }, { label: "Behavioural issues at school", key: "ped_behavioural_issues_at_school" },
  { label: "Abroad recently (approx. last 1 year)", key: "ped_abroad_recently" }, { label: "Screen time >2 hours/day", key: "ped_screen_time_2h" },
  { label: "Physical activity <1 hour/day", key: "ped_physical_activity_1h" }, { label: "Sick contacts (family/school outbreaks)", key: "ped_sick_contacts" },
  { label: "Problems at home (e.g. domestic abuse)", key: "ped_problems_at_home" }
];
const PEDIATRICS_SUBSTANCE_ROWS = [
  { label: "Coffee / dark tea", key: "ped_coffee_dark_tea" }, { label: "Smoking (vaping, cigarettes, etc.)", key: "ped_smoking_vaping" },
  { label: "Drinking (beer, spirits, etc.)", key: "ped_drinking" }, { label: "Drugs (substance abuse)", key: "ped_drugs_substance_abuse" }
];

function generateAnamnesisRecordId(){
  if(typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function"){
    return `anam:${crypto.randomUUID()}`;
  }
  return `anam:${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

function parseAnamnesisAge(rawValue){
  if(rawValue === null || rawValue === undefined || rawValue === "") return null;
  const numeric = Number(rawValue);
  if(Number.isFinite(numeric) && numeric >= 0) return numeric;
  const match = String(rawValue).match(/\b(\d{1,3})\b/);
  if(!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function calculateAgeFromDob(rawDob){
  const value = String(rawDob || "").trim();
  if(!value) return null;
  const dob = new Date(value);
  if(Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDelta = today.getMonth() - dob.getMonth();
  if(monthDelta < 0 || (monthDelta === 0 && today.getDate() < dob.getDate())){
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function syncAgeFromDob(form){
  if(!form) return;
  const dobField = form.elements.namedItem("ident_dob");
  const ageField = form.elements.namedItem("ident_age");
  if(!dobField || !ageField) return;
  const age = calculateAgeFromDob(dobField.value);
  if(age === null){
    if(!String(dobField.value || "").trim()) ageField.value = "";
    return;
  }
  ageField.value = String(age);
}

function normalizeAnamnesisDataByType(rawData, defaultType = "internal"){
  const normalizedType = normalizeAnamnesisType(defaultType);
  if(!rawData || typeof rawData !== "object" || Array.isArray(rawData)){
    return { internal: {}, psychiatric: {}, pediatrics: {} };
  }
  const hasBuckets = ["internal", "psychiatric", "pediatrics", "psychiatry", "surgery"].some(key => rawData[key] && typeof rawData[key] === "object");
  if(hasBuckets){
    return {
      internal: rawData.internal && typeof rawData.internal === "object" ? { ...rawData.internal } : {},
      psychiatric: rawData.psychiatric && typeof rawData.psychiatric === "object"
        ? { ...rawData.psychiatric }
        : (rawData.psychiatry && typeof rawData.psychiatry === "object" ? { ...rawData.psychiatry } : {}),
      pediatrics: rawData.pediatrics && typeof rawData.pediatrics === "object" ? { ...rawData.pediatrics } : {}
    };
  }
  return {
    internal: normalizedType === "internal" ? { ...rawData } : {},
    psychiatric: normalizedType === "psychiatric" ? { ...rawData } : {},
    pediatrics: normalizedType === "pediatrics" ? { ...rawData } : {}
  };
}

function extractSharedAnamnesisFields(source){
  const out = {};
  const data = source && typeof source === "object" ? source : {};
  for(const key of ANAMNESIS_SHARED_FIELD_NAMES){
    if(key in data && data[key] !== undefined){
      out[key] = data[key];
    }
  }
  return out;
}

function mergeSharedFieldsIntoData(data, sharedFields){
  return {
    ...(data && typeof data === "object" ? data : {}),
    ...extractSharedAnamnesisFields(sharedFields)
  };
}

function collectSharedFieldsFromBuckets(buckets){
  return {
    ...extractSharedAnamnesisFields(buckets.internal),
    ...extractSharedAnamnesisFields(buckets.pediatrics),
    ...extractSharedAnamnesisFields(buckets.psychiatric)
  };
}

function createPatientAnamnesisRecord(seed = {}){
  const type = normalizeAnamnesisType(seed.anamnesisType);
  const buckets = normalizeAnamnesisDataByType(seed.anamnesisData, type);
  const sharedFields = {
    ...collectSharedFieldsFromBuckets(buckets),
    ...extractSharedAnamnesisFields(seed.sharedFields)
  };
  const inferredName =
    seed.name ||
    sharedFields.ident_full_name ||
    buckets.internal?.ident_full_name ||
    buckets.pediatrics?.ident_full_name ||
    buckets.psychiatric?.ident_full_name ||
    buckets.psychiatric?.psych_name ||
    "";
  const inferredAge =
    seed.age ??
    sharedFields.ident_age ??
    buckets.internal?.ident_age ??
    buckets.pediatrics?.ident_age ??
    buckets.psychiatric?.ident_age ??
    buckets.psychiatric?.psych_age ??
    null;
  const inferredComplaint =
    seed.chiefComplaint ||
    sharedFields.chief_complaint ||
    buckets.internal?.chief_complaint ||
    buckets.pediatrics?.chief_complaint ||
    buckets.psychiatric?.chief_complaint ||
    buckets.psychiatric?.psych_admission_reason ||
    "";
  return {
    id: String(seed.id || generateAnamnesisRecordId()),
    name: String(inferredName || "").trim(),
    age: parseAnamnesisAge(inferredAge),
    anamnesisType: type,
    chiefComplaint: String(inferredComplaint || "").trim(),
    createdAt: String(seed.createdAt || nowIso()),
    updatedAt: String(seed.updatedAt || nowIso()),
    notes: String(seed.notes || "").trim(),
    sharedFields,
    anamnesisData: buckets
  };
}

function normalizeAnamnesisProfileState(rawState){
  const source = rawState && typeof rawState === "object" ? rawState : {};
  const rawRecords = Array.isArray(source.records)
    ? source.records
    : (Array.isArray(source.patients) ? source.patients : []);
  const records = rawRecords
    .map(record => createPatientAnamnesisRecord(record))
    .sort((a, b)=> String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const requestedActiveId = String(
    source.activePatientId ||
    source.active_patient_id ||
    source.active_patient ||
    ""
  ).trim();
  return {
    records,
    activePatientId: records.some(record => record.id === requestedActiveId)
      ? requestedActiveId
      : (records[0] ? records[0].id : "")
  };
}

function mergeAnamnesisRegistryStates(localState, remoteState){
  const local = normalizeAnamnesisProfileState(localState);
  const remote = normalizeAnamnesisProfileState(remoteState);
  const byId = new Map();
  for(const record of remote.records){
    byId.set(record.id, createPatientAnamnesisRecord(record));
  }
  for(const record of local.records){
    const hit = byId.get(record.id);
    if(!hit){
      byId.set(record.id, createPatientAnamnesisRecord(record));
      continue;
    }
    const localTs = profileTimeMs(record.updatedAt || record.createdAt);
    const remoteTs = profileTimeMs(hit.updatedAt || hit.createdAt);
    byId.set(record.id, createPatientAnamnesisRecord(localTs >= remoteTs ? record : hit));
  }
  const records = [...byId.values()].sort((a, b)=> String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const localActiveId = String(local.activePatientId || "").trim();
  const remoteActiveId = String(remote.activePatientId || "").trim();
  const activePatientId = records.some(record => record.id === localActiveId)
    ? localActiveId
    : (records.some(record => record.id === remoteActiveId) ? remoteActiveId : (records[0] ? records[0].id : ""));
  return {
    records,
    activePatientId
  };
}

function getAnamnesisPatientRecordById(id){
  return anamnesisPatientRecords.find(record => record.id === id) || null;
}

function getActiveAnamnesisPatientRecord(){
  return getAnamnesisPatientRecordById(activeAnamnesisPatientId);
}

function getAnamnesisRecordSummary(record){
  const shared = extractSharedAnamnesisFields(record ? record.sharedFields : null);
  const name = getAnamnesisRecordDisplayName(record);
  const type = getAnamnesisTypeLabel(record ? record.anamnesisType : "");
  const age = Number.isFinite(record && (record.age ?? parseAnamnesisAge(shared.ident_age))) ? String(record.age ?? parseAnamnesisAge(shared.ident_age)) : tOr("anamnesis_age_na", "Age n/a");
  const buckets = normalizeAnamnesisDataByType(record ? record.anamnesisData : null, record ? record.anamnesisType : "internal");
  const formComplaint =
    shared.chief_complaint ||
    buckets.internal?.chief_complaint ||
    buckets.pediatrics?.chief_complaint ||
    buckets.psychiatric?.chief_complaint ||
    "";
  const complaint = String(record && record.chiefComplaint ? record.chiefComplaint : (formComplaint || tOr("anamnesis_no_chief_complaint", "No chief complaint"))).trim();
  return `${name} | ${type} | ${age} | ${complaint}`;
}

function getAnamnesisMetaInputValue(id){
  const el = document.getElementById(id);
  return el ? String(el.value || "").trim() : "";
}

function withAnamnesisSyncLock(callback){
  anamnesisSyncLock = true;
  try{
    callback();
  }finally{
    anamnesisSyncLock = false;
  }
}

function normalizePsychiatryFieldType(rawType){
  const type = String(rawType || "").trim().toLowerCase();
  if(type === "text" || type === "textarea" || type === "checkbox" || type === "radio" || type === "select") return type;
  return "";
}

function normalizePsychiatryCsvRows(rawRows){
  if(!rawRows || rawRows.length === 0) return [];
  const headers = (rawRows[0] || []).map(h=>String(h || "").replace(/^\uFEFF/, "").trim());
  const expectedCols = headers.length;
  const out = [];
  for(let i=1;i<rawRows.length;i++){
    const row = rawRows[i] || [];
    if(row.length === 0 || row.every(v=>!String(v || "").trim())) continue;
    let normalized = row.slice();
    if(normalized.length > expectedCols){
      const head = normalized.slice(0, 5);
      const fieldLabel = normalized.slice(5, normalized.length - 3).join(", ").trim();
      const tail = normalized.slice(normalized.length - 3);
      normalized = [...head, fieldLabel, ...tail];
    }
    while(normalized.length < expectedCols) normalized.push("");
    const obj = {};
    for(let j=0;j<headers.length;j++){
      obj[headers[j]] = String(normalized[j] || "").trim();
    }
    const parsedType = normalizePsychiatryFieldType(obj.field_type);
    if(parsedType){
      obj.field_type = parsedType;
    } else {
      const fallbackType = normalizePsychiatryFieldType(obj.description);
      if(fallbackType){
        const merged = [obj.field_label, obj.field_type, obj.options].map(v=>String(v || "").trim()).filter(Boolean);
        obj.field_label = merged.join(", ");
        obj.field_type = fallbackType;
        obj.options = "";
        obj.description = "";
      } else {
        obj.field_type = "text";
      }
    }
    out.push(obj);
  }
  return out;
}

async function loadPsychiatryAnamnesisRows(){
  if(Array.isArray(psychiatryAnamnesisRows) && psychiatryAnamnesisRows.length > 0){
    return psychiatryAnamnesisRows;
  }
  const candidates = [
    resolveBundledDataUrl("app_language/anamnesis_psychiatry.csv"),
    "data/app_language/anamnesis_psychiatry.csv",
    resolveBundledDataUrl("anamnesis_psychiatry.csv")
  ];
  let parsed = null;
  let lastErr = null;
  for(const path of candidates){
    try{
      const txt = await loadFile(path);
      if(!String(txt || "").trim()) continue;
      parsed = parseCSVLines(txt);
      if(parsed.length > 1) break;
    }catch(e){
      lastErr = e;
    }
  }
  if(!parsed || parsed.length <= 1){
    if(lastErr) throw lastErr;
    throw new Error("Psychiatry anamnesis CSV could not be loaded");
  }
  psychiatryAnamnesisRows = normalizePsychiatryCsvRows(parsed);
  return psychiatryAnamnesisRows;
}

function parsePsychiatryOptions(raw){
  return String(raw || "").split("|").map(v=>v.trim()).filter(Boolean);
}

function normalizePsychiatryExplanationKey(text){
  return String(text || "").replace(/\s+/g, " ").trim();
}

function getPsychiatryExplanation(termText){
  const key = normalizePsychiatryExplanationKey(termText);
  if(!key) return null;
  return psychiatryTermExplanations.get(key) || null;
}

function normalizePsychiatryInlineExplanation(raw){
  const text = String(raw || "").trim();
  if(!text) return null;
  return { en: text, sk: "" };
}

async function loadPsychiatryTermExplanations(){
  if(psychiatryTermExplanationsLoaded) return psychiatryTermExplanations;
  psychiatryTermExplanations.clear();
  psychiatryTermExplanationsLoaded = true;
  try{
    const candidates = ANAMNESIS_DICTIONARY_CANDIDATE_GROUPS[0] || [];
    let parsed = null;
    let lastErr = null;
    for(const path of candidates){
      try{
        const txt = await loadFile(path);
        if(!String(txt || "").trim()) continue;
        const rows = parseCSVLines(txt);
        if(rows.length < 2) continue;
        const headers = (rows[0] || []).map(h=>String(h || "").replace(/^\uFEFF/, "").trim().toLowerCase());
        if(headers.includes("section") && headers.includes("item_type") && headers.includes("label_en") && headers.includes("label_sk")){
          parsed = rows;
          break;
        }
      }catch(e){
        lastErr = e;
      }
    }
    if(!parsed){
      if(lastErr) console.warn("Psychiatry explanations load failed:", lastErr.message || lastErr);
      return psychiatryTermExplanations;
    }
    const headers = (parsed[0] || []).map(h=>String(h || "").replace(/^\uFEFF/, "").trim().toLowerCase());
    const idxSection = headers.indexOf("section");
    const idxItemType = headers.indexOf("item_type");
    const idxEn = headers.indexOf("label_en");
    const idxSk = headers.indexOf("label_sk");
    if(idxSection < 0 || idxItemType < 0 || idxEn < 0 || idxSk < 0) return psychiatryTermExplanations;

    for(let i=1;i<parsed.length;i++){
      const row = parsed[i] || [];
      const section = String(row[idxSection] || "").trim().toLowerCase();
      if(section !== "explanations") continue;
      const term = normalizePsychiatryExplanationKey(row[idxItemType]);
      if(!term) continue;
      const en = String(row[idxEn] || "").trim();
      const sk = String(row[idxSk] || "").trim();
      if(!en && !sk) continue;
      psychiatryTermExplanations.set(term, { en, sk });
    }
  }catch(e){
    console.warn("Psychiatry explanations parse failed:", e.message || e);
  }
  return psychiatryTermExplanations;
}

function closePsychiatryHelpPopover(){
  if(psychiatryHelpActiveButton){
    psychiatryHelpActiveButton.setAttribute("aria-expanded", "false");
  }
  if(psychiatryHelpPopoverEl){
    psychiatryHelpPopoverEl.classList.add("hidden");
    psychiatryHelpPopoverEl.setAttribute("aria-hidden", "true");
  }
  psychiatryHelpActiveButton = null;
  psychiatryHelpActiveAnchor = null;
}

function positionPsychiatryHelpPopover(anchor){
  if(!psychiatryHelpPopoverEl || !anchor) return;
  const margin = 8;
  const gap = 8;
  psychiatryHelpPopoverEl.style.visibility = "hidden";
  psychiatryHelpPopoverEl.classList.remove("hidden");
  psychiatryHelpPopoverEl.setAttribute("aria-hidden", "false");

  const anchorRect = anchor.getBoundingClientRect();
  const popRect = psychiatryHelpPopoverEl.getBoundingClientRect();
  let left = anchorRect.left + (anchorRect.width / 2) - (popRect.width / 2);
  const maxLeft = window.innerWidth - popRect.width - margin;
  left = Math.max(margin, Math.min(left, Math.max(margin, maxLeft)));

  let top = anchorRect.top - popRect.height - gap;
  let placement = "top";
  if(top < margin){
    top = anchorRect.bottom + gap;
    placement = "bottom";
  }
  psychiatryHelpPopoverEl.style.left = `${Math.round(left)}px`;
  psychiatryHelpPopoverEl.style.top = `${Math.round(Math.max(margin, top))}px`;
  psychiatryHelpPopoverEl.dataset.placement = placement;
  psychiatryHelpPopoverEl.style.visibility = "visible";
}

function ensurePsychiatryHelpPopover(){
  if(psychiatryHelpPopoverEl) return psychiatryHelpPopoverEl;
  const pop = document.createElement("div");
  pop.id = PSY_HELP_POPOVER_ID;
  pop.className = "help-popover hidden";
  pop.setAttribute("role", "tooltip");
  pop.setAttribute("aria-hidden", "true");
  document.body.appendChild(pop);
  psychiatryHelpPopoverEl = pop;

  document.addEventListener("click", (e)=>{
    if(!psychiatryHelpPopoverEl || psychiatryHelpPopoverEl.classList.contains("hidden")) return;
    const target = e.target;
    if(psychiatryHelpPopoverEl.contains(target)) return;
    if(psychiatryHelpActiveButton && psychiatryHelpActiveButton.contains(target)) return;
    closePsychiatryHelpPopover();
  });
  document.addEventListener("keydown", (e)=>{
    if(e.key === "Escape") closePsychiatryHelpPopover();
  });
  window.addEventListener("resize", ()=>{
    if(psychiatryHelpActiveAnchor) positionPsychiatryHelpPopover(psychiatryHelpActiveAnchor);
  });
  window.addEventListener("scroll", ()=>{
    if(psychiatryHelpActiveAnchor) positionPsychiatryHelpPopover(psychiatryHelpActiveAnchor);
  }, true);
  return psychiatryHelpPopoverEl;
}

function openPsychiatryHelpPopover(button, anchor, termText, explanation){
  const pop = ensurePsychiatryHelpPopover();
  if(!pop || !button || !anchor || !explanation) return;
  pop.innerHTML = "";

  const term = document.createElement("div");
  term.className = "help-popover-term";
  term.textContent = termText;
  pop.appendChild(term);

  const enText = String(explanation.en || "").trim();
  const skText = String(explanation.sk || "").trim();
  if(enText){
    const en = document.createElement("div");
    en.className = "help-popover-line";
    en.textContent = enText;
    pop.appendChild(en);
  }
  if(skText){
    const sk = document.createElement("div");
    sk.className = "help-popover-line";
    sk.textContent = `SK: ${skText}`;
    pop.appendChild(sk);
  }

  if(psychiatryHelpActiveButton && psychiatryHelpActiveButton !== button){
    psychiatryHelpActiveButton.setAttribute("aria-expanded", "false");
  }
  psychiatryHelpActiveButton = button;
  psychiatryHelpActiveAnchor = anchor;
  button.setAttribute("aria-expanded", "true");
  button.setAttribute("aria-controls", PSY_HELP_POPOVER_ID);
  positionPsychiatryHelpPopover(anchor);
}

function togglePsychiatryHelpPopover(button, termText, explanationOverride = null){
  const explanation = explanationOverride || getPsychiatryExplanation(termText);
  if(!explanation) return;
  const anchor = button.closest(".anam-help-term") || button;
  const isOpen = psychiatryHelpActiveButton === button && psychiatryHelpPopoverEl && !psychiatryHelpPopoverEl.classList.contains("hidden");
  if(isOpen){
    closePsychiatryHelpPopover();
    return;
  }
  openPsychiatryHelpPopover(button, anchor, normalizePsychiatryExplanationKey(termText), explanation);
}

function renderTermWithHelp(termText, opts = {}){
  const normalized = normalizePsychiatryExplanationKey(termText);
  const wrap = document.createElement("span");
  wrap.className = "anam-help-term";
  const term = document.createElement("span");
  term.className = "anam-help-term-text";
  term.textContent = normalized;
  wrap.appendChild(term);

  const inlineExplanation = normalizePsychiatryInlineExplanation(opts.description);
  const explanation = inlineExplanation || getPsychiatryExplanation(normalized);
  if(!explanation) return wrap;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "help-icon";
  btn.textContent = "?";
  btn.setAttribute("aria-label", `Show explanation for ${normalized}`);
  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-controls", PSY_HELP_POPOVER_ID);
  btn.setAttribute("aria-expanded", "false");
  btn.addEventListener("click", (e)=>{
    e.preventDefault();
    e.stopPropagation();
    togglePsychiatryHelpPopover(btn, normalized, explanation);
  });
  wrap.appendChild(btn);
  return wrap;
}

function formatPsychiatryOptionLabel(value){
  const cleaned = String(value || "").trim().replace(/_/g, " ");
  if(!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function normalizePsychiatryRole(rawRole){
  const role = String(rawRole || "").trim().toLowerCase();
  if(role === "clinician" || role === "patient" || role === "question" || role === "include") return role;
  return "";
}

function inferPsychiatryFieldRole(field){
  const explicit = normalizePsychiatryRole(field.description);
  if(explicit) return explicit;
  const groupName = String(field.group_name || "").toLowerCase();
  const groupId = String(field.group_id || "").toLowerCase();
  const label = String(field.field_label || "").trim();
  if(groupName.includes("question") || groupId.includes("question")) return "patient";
  if(label.endsWith("?")) return "patient";
  if((normalizePsychiatryFieldType(field.field_type) || "text") === "checkbox") return "clinician";
  return "patient";
}

function isClinicianRole(field){
  return inferPsychiatryFieldRole(field) === "clinician";
}

function parsePsychiatrySectionNumber(sectionId){
  const m = String(sectionId || "").match(/(\d+)/);
  return m ? Number(m[1]) : NaN;
}

function buildPsychiatryCheckboxLabel(field, opts = {}){
  const name = String(field.field_id || "").trim();
  const labelText = String(field.field_label || name || "").trim();
  const description = String(field.description || "").trim();
  const label = document.createElement("label");
  label.className = "anam-psych-checkbox-label";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = name;
  if(opts.clinician) label.classList.add("anam-psych-clinician");
  label.appendChild(input);
  const textWrap = renderTermWithHelp(labelText, { description });
  if(opts.clinician) textWrap.classList.add("anam-psych-clinician");
  label.appendChild(textWrap);
  return label;
}

function buildPsychiatryAnamnesisField(field){
  const type = normalizePsychiatryFieldType(field.field_type) || "text";
  const name = String(field.field_id || "").trim();
  const labelText = String(field.field_label || name || "").trim();
  const description = String(field.description || "").trim();
  const options = parsePsychiatryOptions(field.options);

  const wrap = document.createElement("div");
  wrap.className = "anam-field";

  const clinician = isClinicianRole(field);

  if(type === "checkbox"){
    const row = document.createElement("div");
    row.className = "anam-row";
    row.appendChild(buildPsychiatryCheckboxLabel(field, { clinician }));
    wrap.appendChild(row);
  } else if(type === "radio"){
    const row = document.createElement("div");
    row.className = "anam-row";
    const title = document.createElement("span");
    title.appendChild(renderTermWithHelp(labelText));
    if(clinician) title.classList.add("anam-psych-clinician");
    row.appendChild(title);
    const radioOptions = options.length > 0 ? options : ["yes", "no"];
    for(const option of radioOptions){
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = name;
      input.value = option;
      label.appendChild(input);
      label.appendChild(document.createTextNode(" " + formatPsychiatryOptionLabel(option)));
      if(clinician) label.classList.add("anam-psych-clinician");
      row.appendChild(label);
    }
    wrap.appendChild(row);
    wrap.classList.add("anam-psych-full");
  } else if(type === "select"){
    const select = document.createElement("select");
    select.name = name;
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = labelText;
    select.appendChild(empty);
    if(clinician) select.classList.add("anam-psych-clinician");
    for(const option of options){
      const opt = document.createElement("option");
      opt.value = option;
      opt.textContent = formatPsychiatryOptionLabel(option);
      select.appendChild(opt);
    }
    wrap.appendChild(select);
  } else if(type === "textarea"){
    const input = document.createElement("textarea");
    input.name = name;
    input.placeholder = labelText;
    if(clinician) input.classList.add("anam-psych-clinician");
    wrap.appendChild(input);
    wrap.classList.add("anam-psych-full");
  } else {
    const input = document.createElement("input");
    input.type = "text";
    input.name = name;
    input.placeholder = labelText;
    if(clinician) input.classList.add("anam-psych-clinician");
    wrap.appendChild(input);
  }

  if(description && !normalizePsychiatryRole(description)){
    const desc = document.createElement("div");
    desc.className = "anam-field-desc";
    desc.textContent = description;
    wrap.appendChild(desc);
  }

  return wrap;
}

function buildSharedIdentificationSection(){
  const section = document.createElement("div");
  section.className = "anam-section";
  const heading = document.createElement("h3");
  heading.textContent = "1. Identification";
  section.appendChild(heading);

  const grid = document.createElement("div");
  grid.className = "anam-grid";

  const fullName = document.createElement("input");
  fullName.name = "ident_full_name";
  fullName.placeholder = "Full name";
  grid.appendChild(fullName);

  const dob = document.createElement("input");
  dob.name = "ident_dob";
  dob.type = "date";
  dob.placeholder = "Date of birth";
  grid.appendChild(dob);

  const age = document.createElement("input");
  age.name = "ident_age";
  age.type = "number";
  age.min = "0";
  age.step = "1";
  age.placeholder = "Age";
  grid.appendChild(age);

  const sexRow = document.createElement("div");
  sexRow.className = "anam-row";
  const sexLabel = document.createElement("span");
  sexLabel.textContent = "Sex";
  sexRow.appendChild(sexLabel);
  ["male", "female"].forEach(value=>{
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "ident_sex";
    input.value = value;
    label.appendChild(input);
    label.appendChild(document.createTextNode(value === "male" ? " Male" : " Female"));
    sexRow.appendChild(label);
  });
  grid.appendChild(sexRow);

  const city = document.createElement("input");
  city.name = "ident_city";
  city.placeholder = "Address (City)";
  grid.appendChild(city);

  section.appendChild(grid);
  return section;
}

function buildSharedChiefComplaintSection(){
  const section = document.createElement("div");
  section.className = "anam-section";
  const heading = document.createElement("h3");
  heading.textContent = "2. Chief Complaint";
  section.appendChild(heading);

  const admitted = document.createElement("input");
  admitted.name = "ident_admitted";
  admitted.type = "datetime-local";
  admitted.placeholder = "Admitted on (date/time)";
  section.appendChild(admitted);

  const complaint = document.createElement("textarea");
  complaint.name = "chief_complaint";
  complaint.placeholder = "Main reason for admission (caregiver's / patient's words)";
  section.appendChild(complaint);

  return section;
}

function buildYesNoNotesTable(sectionTitle, rows, prefix, opts = {}){
  const section = document.createElement("div");
  section.className = "anam-section";
  const heading = document.createElement("h3");
  heading.textContent = sectionTitle;
  if(opts.headingKey) heading.dataset.anamKey = opts.headingKey;
  section.appendChild(heading);
  if(opts.caption){
    const caption = document.createElement("p");
    caption.className = "muted";
    caption.textContent = opts.caption;
    if(opts.captionKey) caption.dataset.anamKey = opts.captionKey;
    section.appendChild(caption);
  }
  const table = document.createElement("table");
  table.className = "anam-table";
  table.innerHTML = "<thead><tr><th data-anam-key=\"ped_question\">Question</th><th data-anam-key=\"ped_yes\">Yes</th><th data-anam-key=\"ped_no\">No</th><th data-anam-key=\"anam_notes\">Notes</th></tr></thead>";
  const body = document.createElement("tbody");
  rows.forEach((rowDef, index)=>{
    const label = typeof rowDef === "string" ? rowDef : rowDef.label;
    const rowKey = rowDef && typeof rowDef === "object" ? rowDef.key : "";
    const slug = String(label).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `item_${index+1}`;
    const tr = document.createElement("tr");
    const labelCell = document.createElement("td");
    labelCell.textContent = label;
    if(rowKey) labelCell.dataset.anamKey = rowKey;
    const yesCell = document.createElement("td");
    yesCell.innerHTML = `<input type="radio" name="${prefix}_${slug}" value="yes" />`;
    const noCell = document.createElement("td");
    noCell.innerHTML = `<input type="radio" name="${prefix}_${slug}" value="no" />`;
    const notesCell = document.createElement("td");
    const notesInput = document.createElement("input");
    notesInput.name = `${prefix}_${slug}_notes`;
    notesInput.placeholder = "Notes";
    notesInput.dataset.anamKey = "anam_notes";
    notesCell.appendChild(notesInput);
    tr.append(labelCell, yesCell, noCell, notesCell);
    body.appendChild(tr);
  });
  table.appendChild(body);
  section.appendChild(table);
  return section;
}

function buildPediatricsImmunizationSection(){
  const section = document.createElement("div");
  section.className = "anam-section";
  const heading = document.createElement("h3");
  heading.textContent = "8. Immunization History";
  heading.dataset.anamKey = "ped_n_8_immunization";
  section.appendChild(heading);
  const table = document.createElement("table");
  table.className = "anam-table";
  table.innerHTML = "<thead><tr><th data-anam-key=\"ped_vaccine_immunization\">Vaccine / Immunization</th><th data-anam-key=\"ped_recommended_age\">Recommended age</th><th data-anam-key=\"ped_date_given\">Date given</th><th data-anam-key=\"ped_given\">Given</th><th data-anam-key=\"ped_notes_reaction\">Notes / Reaction</th></tr></thead>";
  const body = document.createElement("tbody");
  for(const row of PEDIATRICS_IMMUNIZATION_ROWS){
    const tr = document.createElement("tr");
    const vaccineCell = document.createElement("td");
    vaccineCell.textContent = row.label;
    vaccineCell.dataset.anamKey = row.labelKey;
    const ageCell = document.createElement("td");
    ageCell.textContent = row.age;
    if(row.ageKey) ageCell.dataset.anamKey = row.ageKey;
    const dateCell = document.createElement("td");
    dateCell.innerHTML = `<input name="ped_immun_${row.id}_date" />`;
    const givenCell = document.createElement("td");
    const select = document.createElement("select");
    select.name = `ped_immun_${row.id}_given`;
    select.innerHTML = `<option value=""></option><option value="yes" data-anam-key="ped_yes">Yes</option><option value="no" data-anam-key="ped_no">No</option>`;
    givenCell.appendChild(select);
    const notesCell = document.createElement("td");
    const notesInput = document.createElement("input");
    notesInput.name = `ped_immun_${row.id}_notes`;
    notesInput.placeholder = "Notes";
    notesInput.dataset.anamKey = "anam_notes";
    notesCell.appendChild(notesInput);
    tr.append(vaccineCell, ageCell, dateCell, givenCell, notesCell);
    body.appendChild(tr);
  }
  table.appendChild(body);
  section.appendChild(table);
  const statusRow = document.createElement("div");
  statusRow.className = "anam-row";
  statusRow.innerHTML = `<span data-anam-key="ped_vaccination_status">Vaccination status</span>
    <label data-anam-key="ped_up_to_date"><input type="radio" name="ped_immun_status" value="up_to_date" /> Up to date</label>
    <label data-anam-key="ped_incomplete_delayed"><input type="radio" name="ped_immun_status" value="incomplete" /> Incomplete / Delayed</label>
    <label data-anam-key="ped_unknown"><input type="radio" name="ped_immun_status" value="unknown" /> Unknown</label>`;
  section.appendChild(statusRow);
  const notes = document.createElement("textarea");
  notes.name = "ped_immun_notes";
  notes.placeholder = "Immunization notes";
  notes.dataset.anamKey = "ped_immunization_notes";
  section.appendChild(notes);
  const adverseRow = document.createElement("div");
  adverseRow.className = "anam-row";
  adverseRow.innerHTML = `<span data-anam-key="ped_history_adverse_vaccine_reactions">History of adverse vaccine reactions</span>
    <label data-anam-key="ped_yes"><input type="radio" name="ped_immun_adverse" value="yes" /> Yes</label>
    <label data-anam-key="ped_no"><input type="radio" name="ped_immun_adverse" value="no" /> No</label>`;
  section.appendChild(adverseRow);
  const adverseNotes = document.createElement("textarea");
  adverseNotes.name = "ped_immun_adverse_notes";
  adverseNotes.placeholder = "If yes, details";
  adverseNotes.dataset.anamKey = "ped_if_yes_details";
  section.appendChild(adverseNotes);
  return section;
}

function buildPediatricsReferenceSection(){
  const section = document.createElement("details");
  section.className = "anam-section";
  section.open = true;
  section.innerHTML = `
    <summary><strong>16. Values of vital signs</strong></summary>
    <table class="anam-table">
      <thead><tr><th>Measure</th><th>Age group</th><th>Reference</th></tr></thead>
      <tbody>
        <tr><td>Heart rate</td><td>Newborn / Infant / Toddler / Preschool / School-age / Adolescent</td><td>100-160 / 100-150 / 90-140 / 80-120 / 70-110 / 60-100 per min</td></tr>
        <tr><td>Respiratory rate</td><td>Newborn / Infant / Toddler / Preschool / School-age / Adolescent</td><td>30-60 / 30-50 / 24-40 / 22-34 / 18-30 / 12-20 per min</td></tr>
        <tr><td>Blood pressure</td><td>Newborn / Infant / Toddler / Preschool / School-age / Adolescent</td><td>60-90/30-60, 80-100/55-65, 90-105/55-70, 95-110/60-75, 100-120/60-80, 110-130/65-85</td></tr>
        <tr><td>Oxygen saturation</td><td>Normal / Mild / Moderate / Severe hypoxemia</td><td>&ge;95%, 92-94%, 89-91%, &lt;89%</td></tr>
        <tr><td>Temperature</td><td>Normal / Low-grade / Fever / High fever / Hyperpyrexia / Hypothermia</td><td>36.5-37.5, 37.6-38.0, &gt;38.0, &gt;39.0, &gt;40.0, &lt;35.9 C</td></tr>
      </tbody>
    </table>
    <table class="anam-table">
      <thead><tr><th>Head circumference</th><th>Boys (cm)</th><th>Girls (cm)</th></tr></thead>
      <tbody>
        <tr><td>Newborn / 1 / 2 / 3 / 6 / 9 months</td><td>33-37 / 35-39 / 37-41 / 38-42 / 41-45 / 43-47</td><td>32-36 / 34-38 / 36-40 / 37-41 / 40-44 / 42-46</td></tr>
        <tr><td>12 / 18 / 24 months / 3 / 4 / 5 years</td><td>44-48 / 45-49.5 / 46-50 / 47-51 / 48-52 / 49-53</td><td>43-47 / 44-48.5 / 45-49 / 46-50 / 47-51 / 48-52</td></tr>
      </tbody>
    </table>
    <table class="anam-table">
      <thead><tr><th>WHO growth references 0-5 years</th><th>P3</th><th>P50</th><th>P97</th></tr></thead>
      <tbody>
        <tr><td>Boys weight (birth / 12m / 24m / 5y)</td><td>2.5 / 7.8 / 9.4 / 13.3 kg</td><td>3.3 / 9.6 / 12.2 / 18.3 kg</td><td>4.4 / 11.8 / 15.0 / 24.2 kg</td></tr>
        <tr><td>Girls weight (birth / 12m / 24m / 5y)</td><td>2.4 / 7.3 / 8.9 / 13.0 kg</td><td>3.2 / 8.9 / 11.5 / 17.4 kg</td><td>4.2 / 11.1 / 14.3 / 23.2 kg</td></tr>
        <tr><td>Boys height (birth / 12m / 24m / 5y)</td><td>46.3 / 68.9 / 78.3 / 98.7 cm</td><td>49.9 / 74.0 / 86.4 / 110.0 cm</td><td>53.4 / 79.3 / 94.2 / 121.3 cm</td></tr>
        <tr><td>Girls height (birth / 12m / 24m / 5y)</td><td>45.6 / 67.7 / 76.9 / 97.3 cm</td><td>49.1 / 72.3 / 84.5 / 108.4 cm</td><td>52.7 / 77.1 / 92.4 / 119.5 cm</td></tr>
      </tbody>
    </table>`;
  return section;
}

function enhanceAnamnesisSections(form){
  if(!form) return;
  const sections = [...form.children].filter(el => el && el.classList && el.classList.contains("anam-section"));
  sections.forEach((section, index) => {
    if(index < 2){
      if(section.tagName === "DETAILS") section.open = true;
      return;
    }
    if(section.tagName === "DETAILS"){
      section.open = true;
      return;
    }
    const title = section.querySelector(":scope > h3");
    if(!title) return;
    const details = document.createElement("details");
    details.className = section.className;
    details.open = true;
    const summary = document.createElement("summary");
    const strong = document.createElement("strong");
    strong.innerHTML = title.innerHTML;
    summary.appendChild(strong);
    details.appendChild(summary);
    [...section.childNodes].forEach(node => {
      if(node !== title) details.appendChild(node);
    });
    section.replaceWith(details);
  });
}

function renderPediatricsAnamnesisForm(){
  const form = document.getElementById("anamnesis-pediatrics-form");
  if(!form) return;
  form.innerHTML = "";
  form.appendChild(buildSharedIdentificationSection());
  form.appendChild(buildSharedChiefComplaintSection());
  form.insertAdjacentHTML("beforeend", `
    <div class="anam-section">
      <h3>3. History of Present Illness (SOCRATES)</h3>
      <div class="anam-grid">
        <input name="ped_hpi_site" placeholder="Site / System involved" />
        <input name="ped_hpi_onset" placeholder="Onset (When? Doing what?)" />
        <input name="ped_hpi_timing" placeholder="Timing (How often?)" />
        <input name="ped_hpi_exacerbating" placeholder="Exacerbating factors" />
        <input name="ped_hpi_relieving" placeholder="Relieving factors" />
        <input name="ped_hpi_radiation" placeholder="Radiation / Spread" />
      </div>
      <div class="anam-row" style="margin-top:8px">
        <span>Character / Nature of symptom</span>
        <label><input type="checkbox" name="ped_hpi_mild" /> Mild</label>
        <label><input type="checkbox" name="ped_hpi_moderate" /> Moderate</label>
        <label><input type="checkbox" name="ped_hpi_severe" /> Severe</label>
        <label><input type="checkbox" name="ped_hpi_progressive" /> Progressive</label>
        <label><input type="checkbox" name="ped_hpi_episodic" /> Episodic</label>
        <label><input type="checkbox" name="ped_hpi_fluctuating" /> Fluctuating</label>
        <input name="ped_hpi_other_character" placeholder="Other" />
      </div>
      <div class="anam-row" style="margin-top:8px">
        <span>Associated symptoms</span>
        <label><input type="checkbox" name="ped_assoc_fever" /> Fever</label>
        <label><input type="checkbox" name="ped_assoc_fatigue" /> Fatigue</label>
        <label><input type="checkbox" name="ped_assoc_irritability" /> Irritability</label>
        <label><input type="checkbox" name="ped_assoc_poor_feeding" /> Poor feeding</label>
        <label><input type="checkbox" name="ped_assoc_cough" /> Cough</label>
        <label><input type="checkbox" name="ped_assoc_gi" /> GI symptoms</label>
        <label><input type="checkbox" name="ped_assoc_rash" /> Rash</label>
        <label><input type="checkbox" name="ped_assoc_sleep" /> Sleep changes</label>
        <label><input type="checkbox" name="ped_assoc_behavior" /> Behavioral changes</label>
        <label><input type="checkbox" name="ped_assoc_school" /> School issues</label>
      </div>
      <div class="anam-row" style="margin-top:8px">
        <span>Severity / impact on functioning</span>
        <label><input type="checkbox" name="ped_impact_minimal" /> Minimal</label>
        <label><input type="checkbox" name="ped_impact_moderate" /> Moderate</label>
        <label><input type="checkbox" name="ped_impact_significant" /> Significant</label>
        <label><input type="checkbox" name="ped_impact_sleep" /> Interferes with sleep</label>
        <label><input type="checkbox" name="ped_impact_feeding" /> Interferes with feeding</label>
        <label><input type="checkbox" name="ped_impact_school" /> Interferes with school / play</label>
      </div>
      <div class="anam-row" style="margin-top:8px">
        <span>Severity</span>
        <input name="ped_hpi_severity" type="number" min="1" max="10" step="1" placeholder="1-10" />
      </div>
      <div class="anam-row" style="margin-top:8px">
        <span>Progression since onset</span>
        <label><input type="checkbox" name="ped_prog_improving" /> Improving</label>
        <label><input type="checkbox" name="ped_prog_worsening" /> Worsening</label>
        <label><input type="checkbox" name="ped_prog_unchanged" /> Unchanged</label>
        <label><input type="checkbox" name="ped_prog_recurrent" /> Recurrent</label>
      </div>
      <textarea name="ped_hpi_notes" placeholder="Notes"></textarea>
    </div>
    <div class="anam-section">
      <h3>4. Review of Systems</h3>
      <div class="anam-row"><strong>General</strong><label><input type="checkbox" name="ped_ros_general_fever" /> Fever</label><label><input type="checkbox" name="ped_ros_general_weight_loss" /> Weight loss</label><label><input type="checkbox" name="ped_ros_general_poor_appetite" /> Poor appetite</label><label><input type="checkbox" name="ped_ros_general_fatigue" /> Fatigue</label><label><input type="checkbox" name="ped_ros_general_night_sweats" /> Night sweats</label></div>
      <textarea name="ped_ros_general_notes" placeholder="General notes"></textarea>
      <div class="anam-row"><strong>Head and Neck</strong><label><input type="checkbox" name="ped_ros_head_headache" /> Headache</label><label><input type="checkbox" name="ped_ros_head_vision" /> Vision issues</label><label><input type="checkbox" name="ped_ros_head_ear_pain" /> Ear pain</label><label><input type="checkbox" name="ped_ros_head_nosebleeds" /> Nosebleeds</label><label><input type="checkbox" name="ped_ros_head_throat" /> Sore throat</label></div>
      <textarea name="ped_ros_head_notes" placeholder="Head and Neck notes"></textarea>
      <div class="anam-row"><strong>Cardiac</strong><label><input type="checkbox" name="ped_ros_cardiac_murmur" /> Murmur</label><label><input type="checkbox" name="ped_ros_cardiac_cyanosis" /> Cyanosis</label><label><input type="checkbox" name="ped_ros_cardiac_exercise" /> Poor exercise tolerance</label></div>
      <textarea name="ped_ros_cardiac_notes" placeholder="Cardiac notes"></textarea>
      <div class="anam-row"><strong>Respiratory</strong><label><input type="checkbox" name="ped_ros_resp_cough" /> Cough</label><label><input type="checkbox" name="ped_ros_resp_wheezing" /> Wheezing</label><label><input type="checkbox" name="ped_ros_resp_dyspnea" /> Dyspnea</label></div>
      <textarea name="ped_ros_resp_notes" placeholder="Respiratory notes"></textarea>
      <div class="anam-row"><strong>Gastrointestinal</strong><label><input type="checkbox" name="ped_ros_gi_vomiting" /> Vomiting</label><label><input type="checkbox" name="ped_ros_gi_diarrhea" /> Diarrhea</label><label><input type="checkbox" name="ped_ros_gi_constipation" /> Constipation</label><label><input type="checkbox" name="ped_ros_gi_blood" /> Blood in stool</label></div>
      <textarea name="ped_ros_gi_notes" placeholder="Gastrointestinal notes"></textarea>
      <div class="anam-row"><strong>GU</strong><label><input type="checkbox" name="ped_ros_gu_dysuria" /> Dysuria</label><label><input type="checkbox" name="ped_ros_gu_frequency" /> Frequency</label><label><input type="checkbox" name="ped_ros_gu_bedwetting" /> Bedwetting</label></div>
      <textarea name="ped_ros_gu_notes" placeholder="GU notes"></textarea>
      <div class="anam-row"><strong>Skin</strong><label><input type="checkbox" name="ped_ros_skin_rashes" /> Rashes</label><label><input type="checkbox" name="ped_ros_skin_eczema" /> Eczema</label><label><input type="checkbox" name="ped_ros_skin_allergies" /> Allergies</label></div>
      <textarea name="ped_ros_skin_notes" placeholder="Skin notes"></textarea>
      <div class="anam-row"><strong>Neuro</strong><label><input type="checkbox" name="ped_ros_neuro_seizures" /> Seizures</label><label><input type="checkbox" name="ped_ros_neuro_dizziness" /> Dizziness</label><label><input type="checkbox" name="ped_ros_neuro_fainting" /> Fainting</label></div>
      <textarea name="ped_ros_neuro_notes" placeholder="Neuro notes"></textarea>
    </div>`);
  form.appendChild(buildYesNoNotesTable("5. Prenatal History", PEDIATRICS_PRENATAL_ROWS, "ped_prenatal", { headingKey: "ped_n_5_prenatal" }));
  form.insertAdjacentHTML("beforeend", `
    <div class="anam-section">
      <h3 data-anam-key="ped_n_6_birth_neonatal">6. Birth & Neonatal History</h3>
      <div class="anam-grid">
        <input name="ped_birth_place" data-anam-key="ped_place_of_birth" placeholder="Place of birth" />
        <input name="ped_gestational_week" data-anam-key="ped_gestational_week_at_birth" placeholder="Gestational week at birth" />
        <input name="ped_labor_duration" data-anam-key="ped_duration_of_labor" placeholder="Duration of labor" />
        <input name="ped_birth_weight" data-anam-key="ped_birth_weight" placeholder="Birth weight" />
        <input name="ped_apgar_1" placeholder="Apgar 1 min" />
        <input name="ped_apgar_5" placeholder="Apgar 5 min" />
        <input name="ped_apgar_10" placeholder="Apgar 10 min" />
        <input name="ped_hospital_stay_longer" data-anam-key="ped_longer_hospital_stay_if_yes_how_long" placeholder="Longer hospital stay if yes, how long" />
      </div>
      <div class="anam-row"><span data-anam-key="ped_gestational_age">Gestational age</span><label data-anam-key="ped_preterm"><input type="radio" name="ped_gestational_age" value="preterm" /> Preterm</label><label data-anam-key="ped_term"><input type="radio" name="ped_gestational_age" value="term" /> Term</label><label data-anam-key="ped_post_term"><input type="radio" name="ped_gestational_age" value="postterm" /> Post-term</label></div>
      <div class="anam-row"><span data-anam-key="ped_labor_induced">Labor induced</span><label data-anam-key="ped_yes"><input type="radio" name="ped_labor_induced" value="yes" /> Yes</label><label data-anam-key="ped_no"><input type="radio" name="ped_labor_induced" value="no" /> No</label><input name="ped_labor_induced_reason" data-anam-key="ped_reason" placeholder="Reason" /></div>
      <div class="anam-row"><span data-anam-key="ped_assisted_delivery">Assisted delivery</span><label data-anam-key="ped_forceps"><input type="checkbox" name="ped_delivery_forceps" /> Forceps</label><label data-anam-key="ped_vacuum"><input type="checkbox" name="ped_delivery_vacuum" /> Vacuum</label><label data-anam-key="ped_caesarean"><input type="checkbox" name="ped_delivery_caesarean" /> Caesarean</label><input name="ped_delivery_reason" data-anam-key="ped_reason" placeholder="Reason" /></div>
      <div class="anam-row"><span data-anam-key="ped_resuscitation">Resuscitation</span><label data-anam-key="ped_yes"><input type="radio" name="ped_resuscitation" value="yes" /> Yes</label><label data-anam-key="ped_no"><input type="radio" name="ped_resuscitation" value="no" /> No</label><span data-anam-key="ped_nicu_admission">NICU admission</span><label data-anam-key="ped_yes"><input type="radio" name="ped_nicu" value="yes" /> Yes</label><label data-anam-key="ped_no"><input type="radio" name="ped_nicu" value="no" /> No</label></div>
      <div class="anam-row"><span data-anam-key="ped_neonatal_problems">Neonatal problems</span><label data-anam-key="ped_jaundice"><input type="checkbox" name="ped_neonatal_jaundice" /> Jaundice</label><label data-anam-key="ped_infection"><input type="checkbox" name="ped_neonatal_infection" /> Infection</label><label data-anam-key="ped_seizures"><input type="checkbox" name="ped_neonatal_seizures" /> Seizures</label><label data-anam-key="ped_respiratory_distress"><input type="checkbox" name="ped_neonatal_respiratory" /> Respiratory distress</label><input name="ped_neonatal_other" data-anam-key="anam_other" placeholder="Other" /></div>
      <div class="anam-row"><span data-anam-key="ped_feeding">Feeding</span><label data-anam-key="ped_breast"><input type="checkbox" name="ped_feed_breast" /> Breast</label><label data-anam-key="ped_formula"><input type="checkbox" name="ped_feed_formula" /> Formula</label><label data-anam-key="ped_mixed"><input type="checkbox" name="ped_feed_mixed" /> Mixed</label><input name="ped_feed_formula_name" data-anam-key="ped_formula_name" placeholder="Formula name" /></div>
    </div>
    <div class="anam-section">
      <h3 data-anam-key="ped_n_7_developmental">7. Developmental History</h3>
      <div class="anam-grid">
        <input name="ped_dev_head_control" data-anam-key="ped_head_control_age" placeholder="Head control age achieved" />
        <input name="ped_dev_first_words" data-anam-key="ped_first_words_age" placeholder="First words age achieved" />
        <input name="ped_dev_rolling" data-anam-key="ped_rolling_age" placeholder="Rolling age achieved" />
        <input name="ped_dev_sentences" data-anam-key="ped_sentences_age" placeholder="Sentences age achieved" />
        <input name="ped_dev_sitting" data-anam-key="ped_sitting_age" placeholder="Sitting age achieved" />
        <input name="ped_dev_walking" data-anam-key="ped_walking_age" placeholder="Walking age achieved" />
        <input name="ped_dev_standing" data-anam-key="ped_standing_age" placeholder="Standing age achieved" />
      </div>
      <div class="anam-row"><strong data-anam-key="ped_additional_development">Additional Development</strong></div>
      <div class="anam-grid">
        <div><strong data-anam-key="ped_learning_difficulties">Learning difficulties</strong><div class="anam-row"><label data-anam-key="ped_yes"><input type="radio" name="ped_dev_learning" value="yes" /> Yes</label><label data-anam-key="ped_no"><input type="radio" name="ped_dev_learning" value="no" /> No</label></div><input name="ped_dev_learning_notes" data-anam-key="anam_notes" placeholder="Notes" /></div>
        <div><strong data-anam-key="ped_attention_problems">Attention problems</strong><div class="anam-row"><label data-anam-key="ped_yes"><input type="radio" name="ped_dev_attention" value="yes" /> Yes</label><label data-anam-key="ped_no"><input type="radio" name="ped_dev_attention" value="no" /> No</label></div><input name="ped_dev_attention_notes" data-anam-key="anam_notes" placeholder="Notes" /></div>
        <div><strong data-anam-key="ped_hyperactivity">Hyperactivity</strong><div class="anam-row"><label data-anam-key="ped_yes"><input type="radio" name="ped_dev_hyperactivity" value="yes" /> Yes</label><label data-anam-key="ped_no"><input type="radio" name="ped_dev_hyperactivity" value="no" /> No</label></div><input name="ped_dev_hyperactivity_notes" data-anam-key="anam_notes" placeholder="Notes" /></div>
        <div><strong data-anam-key="ped_behavioral_problems">Behavioral problems</strong><div class="anam-row"><label data-anam-key="ped_yes"><input type="radio" name="ped_dev_behavioral" value="yes" /> Yes</label><label data-anam-key="ped_no"><input type="radio" name="ped_dev_behavioral" value="no" /> No</label></div><input name="ped_dev_behavioral_notes" data-anam-key="anam_notes" placeholder="Notes" /></div>
      </div>
    </div>`);
  form.appendChild(buildPediatricsImmunizationSection());
  form.appendChild(buildYesNoNotesTable("9. Past Medical History", PEDIATRICS_PMH_ROWS, "ped_pmh", { headingKey: "ped_n_9_pmh" }));
  form.insertAdjacentHTML("beforeend", `
    <div class="anam-section">
      <h3 data-anam-key="ped_operations_hospitalizations">Operations & Hospitalizations</h3>
      <div class="anam-repeater" data-repeater="ped_hospitalizations">
        <div class="anam-repeater-head"><span>Date</span><span>Procedure/Diagnosis</span><span>Outcome</span><span></span></div>
        <div class="anam-repeater-body" id="ped-hospitalizations-rows"></div>
        <button type="button" id="ped-hospitalizations-add" class="anam-add-row">+</button>
      </div>
      <div class="anam-row" style="margin-top:8px">
        <span data-anam-key="anam_planned_operation_now">Planned operation now</span>
        <label data-anam-key="anam_yes"><input type="radio" name="ped_planned_op" value="yes" /> Yes</label>
        <label data-anam-key="anam_no"><input type="radio" name="ped_planned_op" value="no" /> No</label>
      </div>
      <div id="ped-planned-op-wrap" class="hidden" style="margin-top:8px">
        <div class="anam-repeater" data-repeater="ped_planned_op">
          <div class="anam-repeater-head">
            <span>Date</span><span>Procedure/Diagnosis</span><span>Outcome</span><span></span>
          </div>
          <div class="anam-repeater-body" id="ped-planned-op-rows"></div>
          <button type="button" id="ped-planned-op-add" class="anam-add-row">+</button>
        </div>
      </div>
    </div>
    <div class="anam-section">
      <h3 data-anam-key="anam_n_6_allergies_transfusions">Allergies & Transfusions</h3>
      <textarea name="ped_allergies" data-anam-key="anam_allergy_reaction" placeholder="Allergy / Reaction (Medication, food, environmental(pollen,chemicals,etc.),Topical(Soap,cosmetics,etc.),Vaccines,Contrast agents)"></textarea>
      <div class="anam-row">
        <span data-anam-key="anam_blood_transfusion_in_past">Blood transfusion in past</span>
        <label data-anam-key="anam_no"><input type="radio" name="ped_blood_transfusion" value="no" /> No</label>
        <label data-anam-key="anam_yes"><input type="radio" name="ped_blood_transfusion" value="yes" /> Yes</label>
      </div>
      <div id="ped-blood-transfusion-details-wrap" class="hidden">
        <input name="ped_blood_transfusion_number" placeholder="Number" />
        <div class="anam-row">
          <span data-anam-key="anam_reaction">Reaction</span>
          <label data-anam-key="anam_no"><input type="radio" name="ped_blood_transfusion_reaction" value="no" /> No</label>
          <label data-anam-key="anam_yes"><input type="radio" name="ped_blood_transfusion_reaction" value="yes" /> Yes</label>
        </div>
        <div id="ped-blood-transfusion-reaction-notes-wrap" class="hidden">
          <input name="ped_blood_transfusion_reaction_desc" placeholder="Reaction details" />
        </div>
      </div>
    </div>
    <div class="anam-section">
      <h3 data-anam-key="anam_n_7_medication">Medication</h3>
      <div class="anam-repeater" data-repeater="ped_medication">
        <div class="anam-repeater-head">
          <span data-anam-key="anam_drug">Drug</span><span data-anam-key="anam_dose">Dose</span><span data-anam-key="anam_medication_frequency">Frequency</span><span data-anam-key="anam_indication">Indication</span><span></span><span></span>
        </div>
        <div class="anam-repeater-body" id="ped-medication-rows"></div>
        <button type="button" id="ped-medication-add" class="anam-add-row">+</button>
      </div>
      <div class="anam-row">
        <span class="anam-med-question" data-anam-key="anam_over_the_counter_medicine">Regular use of over the counter medicine</span>
        <label data-anam-key="anam_yes"><input type="radio" name="ped_med_otc" value="yes" /> Yes</label>
        <label data-anam-key="anam_no"><input type="radio" name="ped_med_otc" value="no" /> No</label>
      </div>
      <div id="ped-med-otc-details-wrap" class="hidden">
        <input name="ped_med_otc_details" data-anam-key="anam_notes" placeholder="Notes" />
      </div>
      <div class="anam-row">
        <span class="anam-med-question" data-anam-key="anam_supplements_vitamins_herbal_products">Regular use of supplements / vitamins / herbal products</span>
        <label data-anam-key="anam_yes"><input type="radio" name="ped_med_supplements" value="yes" /> Yes</label>
        <label data-anam-key="anam_no"><input type="radio" name="ped_med_supplements" value="no" /> No</label>
      </div>
      <div id="ped-med-supplements-details-wrap" class="hidden">
        <input name="ped_med_supplements_details" data-anam-key="anam_notes" placeholder="Notes" />
      </div>
      <div class="anam-row">
        <span class="anam-med-question" data-anam-key="anam_history_of_misuse_of_prescribed_drugs">History of misuse of prescribed drugs</span>
        <label data-anam-key="anam_yes"><input type="radio" name="ped_med_misuse" value="yes" /> Yes</label>
        <label data-anam-key="anam_no"><input type="radio" name="ped_med_misuse" value="no" /> No</label>
      </div>
      <div id="ped-med-misuse-notes-wrap" class="hidden">
        <input name="ped_med_misuse_notes" data-anam-key="anam_notes" placeholder="Notes" />
      </div>
    </div>`);
  form.appendChild(buildYesNoNotesTable("10. Family History", PEDIATRICS_FAMILY_ROWS, "ped_family", { headingKey: "ped_n_10_family" }));
  form.appendChild(buildYesNoNotesTable("11. Social & Environmental History", PEDIATRICS_SOCIAL_ROWS, "ped_social", { headingKey: "ped_n_11_social" }));
  form.appendChild(buildYesNoNotesTable("12. Abuses / Substance Use", PEDIATRICS_SUBSTANCE_ROWS, "ped_substance", { headingKey: "ped_n_12_substance", caption: "Relevant especially in older children / adolescents.", captionKey: "ped_relevant_older_children" }));
  form.insertAdjacentHTML("beforeend", `
    <div class="anam-section">
      <h3>13. Status Praesens Generalis (SPG)</h3>
      <div class="anam-row"><span>Consciousness</span><label><input type="checkbox" name="ped_spg_alert" /> Alert</label><label><input type="checkbox" name="ped_spg_responsive" /> Responsive</label><label><input type="checkbox" name="ped_spg_lethargic" /> Lethargic</label><label><input type="checkbox" name="ped_spg_nonresponsive" /> Non-responsive</label></div>
      <textarea name="ped_spg_consciousness_notes" placeholder="Consciousness notes"></textarea>
      <div class="anam-row"><span>Orientation</span><label><input type="checkbox" name="ped_spg_person" /> Person</label><label><input type="checkbox" name="ped_spg_place" /> Place</label><label><input type="checkbox" name="ped_spg_time" /> Time</label></div>
      <textarea name="ped_spg_appearance" placeholder="General appearance"></textarea>
      <div class="anam-row"><span>Hydration</span><label><input type="checkbox" name="ped_spg_hydration_normal" /> Normal</label><label><input type="checkbox" name="ped_spg_hydration_mild" /> Mild dehydration</label><label><input type="checkbox" name="ped_spg_hydration_moderate" /> Moderate</label><label><input type="checkbox" name="ped_spg_hydration_severe" /> Severe</label></div>
      <div class="anam-row"><span>Nutrition status</span><label><input type="checkbox" name="ped_spg_nutrition_normal" /> Normal</label><label><input type="checkbox" name="ped_spg_nutrition_under" /> Underweight</label><label><input type="checkbox" name="ped_spg_nutrition_over" /> Overweight</label><label><input type="checkbox" name="ped_spg_nutrition_obese" /> Obese</label></div>
      <div class="anam-row"><span>Habitus</span><label><input type="checkbox" name="ped_spg_habitus_asthenic" /> Asthenic</label><label><input type="checkbox" name="ped_spg_habitus_normo" /> Normosthenic</label><label><input type="checkbox" name="ped_spg_habitus_hyper" /> Hypersthenic</label></div>
      <div class="anam-row"><span>Gait / Mobility</span><label><input type="checkbox" name="ped_spg_gait_normal" /> Normal</label><label><input type="checkbox" name="ped_spg_gait_ataxic" /> Ataxic</label><label><input type="checkbox" name="ped_spg_gait_hemi" /> Hemiparetic</label><label><input type="checkbox" name="ped_spg_gait_shuffling" /> Shuffling</label><label><input type="checkbox" name="ped_spg_gait_aid" /> Uses aid</label></div>
      <textarea name="ped_spg_gait_notes" placeholder="Gait / mobility notes"></textarea>
      <div class="anam-row"><span>Speech</span><label><input type="checkbox" name="ped_spg_speech_normal" /> Normal</label><label><input type="checkbox" name="ped_spg_speech_dysarthria" /> Dysarthria</label><label><input type="checkbox" name="ped_spg_speech_aphasia" /> Aphasia</label><label><input type="checkbox" name="ped_spg_speech_slurred" /> Slurred</label></div>
      <div class="anam-row"><span>Position</span><label><input type="checkbox" name="ped_spg_position_active" /> Active</label><label><input type="checkbox" name="ped_spg_position_passive" /> Passive</label><label><input type="checkbox" name="ped_spg_position_forced" /> Forced</label></div>
      <textarea name="ped_spg_skin" placeholder="Skin color / rashes / lesions"></textarea>
      <div class="anam-row"><span>Odor</span><label><input type="checkbox" name="ped_spg_odor_alcohol" /> Alcohol</label><label><input type="checkbox" name="ped_spg_odor_ketosis" /> Ketosis</label><label><input type="checkbox" name="ped_spg_odor_uremic" /> Uremic</label><label><input type="checkbox" name="ped_spg_odor_hepatic" /> Hepatic</label><input name="ped_spg_odor_other" placeholder="Other" /></div>
    </div>
    <div class="anam-section">
      <h3>14. Vital Signs</h3>
      <div class="anam-grid">
        <input name="ped_vital_temp" placeholder="Temp (C)" />
        <input name="ped_vital_spo2" placeholder="SpO2 (%)" />
        <input name="ped_vital_hr" placeholder="HR (/min)" />
        <input name="ped_vital_weight" placeholder="Weight (kg)" />
        <input name="ped_vital_rr" placeholder="RR (/min)" />
        <input name="ped_vital_weight_percentile" placeholder="Weight percentile" />
        <input name="ped_vital_bp" placeholder="BP (mmHg)" />
        <input name="ped_vital_height" placeholder="Height (cm)" />
        <input name="ped_vital_height_percentile" placeholder="Height percentile" />
        <input name="ped_vital_head_circumference" placeholder="Head circumference (cm)" />
      </div>
      <div class="anam-row"><span>Taken</span><label><input type="checkbox" name="ped_vital_from_monitor" /> Directly from monitor</label><label><input type="checkbox" name="ped_vital_from_chart" /> From patient charts</label><input name="ped_vital_when" placeholder="If from charts, when" /></div>
      <textarea name="ped_vital_notes" placeholder="Vital signs notes"></textarea>
    </div>
    <div class="anam-section">
      <h3>15. Status Praesens Localis (SPL)</h3>
      <div class="anam-grid">
        <div><span>Peripheral IV line</span><div class="anam-row"><label><input type="radio" name="ped_spl_iv" value="yes" /> Yes</label><label><input type="radio" name="ped_spl_iv" value="no" /> No</label></div><input name="ped_spl_iv_notes" placeholder="Notes" /></div>
        <div><span>Central venous catheter</span><div class="anam-row"><label><input type="radio" name="ped_spl_cvc" value="yes" /> Yes</label><label><input type="radio" name="ped_spl_cvc" value="no" /> No</label></div><input name="ped_spl_cvc_notes" placeholder="Notes" /></div>
        <div><span>Foley catheter</span><div class="anam-row"><label><input type="radio" name="ped_spl_foley" value="yes" /> Yes</label><label><input type="radio" name="ped_spl_foley" value="no" /> No</label></div><input name="ped_spl_foley_notes" placeholder="Notes" /></div>
        <div><span>Drains</span><div class="anam-row"><label><input type="radio" name="ped_spl_drains" value="yes" /> Yes</label><label><input type="radio" name="ped_spl_drains" value="no" /> No</label></div><input name="ped_spl_drains_notes" placeholder="Notes" /></div>
        <div><span>Oxygen therapy</span><div class="anam-row"><label><input type="radio" name="ped_spl_o2" value="yes" /> Yes</label><label><input type="radio" name="ped_spl_o2" value="no" /> No</label></div><input name="ped_spl_o2_notes" placeholder="Notes" /></div>
        <div><span>ECG monitoring</span><div class="anam-row"><label><input type="radio" name="ped_spl_ecg" value="yes" /> Yes</label><label><input type="radio" name="ped_spl_ecg" value="no" /> No</label></div><input name="ped_spl_ecg_notes" placeholder="Notes" /></div>
        <div><span>Vital function monitor</span><div class="anam-row"><label><input type="radio" name="ped_spl_monitor" value="yes" /> Yes</label><label><input type="radio" name="ped_spl_monitor" value="no" /> No</label></div><input name="ped_spl_monitor_notes" placeholder="Notes" /></div>
      </div>
      <textarea name="ped_spl_head" placeholder="Head / face / scalp / hair notes"></textarea>
      <textarea name="ped_spl_cranial_nerves" placeholder="Cranial nerves notes"></textarea>
      <textarea name="ped_spl_eyes" placeholder="Eyes notes"></textarea>
      <textarea name="ped_spl_ears_nose" placeholder="Ears & nose notes"></textarea>
      <textarea name="ped_spl_mouth_pharynx" placeholder="Mouth & pharynx notes"></textarea>
      <textarea name="ped_spl_neck" placeholder="Neck notes"></textarea>
      <textarea name="ped_spl_thorax" placeholder="Thorax / lungs / heart notes"></textarea>
      <textarea name="ped_spl_abdomen" placeholder="Abdomen notes"></textarea>
      <div class="anam-row"><span>Special abdominal signs</span><label><input type="checkbox" name="ped_spl_blumberg_pos" /> Blumberg +</label><label><input type="checkbox" name="ped_spl_murphy_pos" /> Murphy +</label><label><input type="checkbox" name="ped_spl_mcburney_pos" /> McBurney / Rovsing +</label><label><input type="checkbox" name="ped_spl_tapotement_pos" /> Tapotement +</label></div>
      <textarea name="ped_spl_limbs" placeholder="Limbs / joints / pulses notes"></textarea>
      <textarea name="ped_spl_pulses_upper" placeholder="Upper limb pulses notes"></textarea>
      <textarea name="ped_spl_pulses_lower" placeholder="Lower limb pulses notes"></textarea>
      <input name="ped_spl_capillary_refill" placeholder="Capillary refill time (seconds)" />
      <div class="anam-row"><span>Spine posture & curvature</span><label><input type="checkbox" name="ped_spine_normal" /> Normal</label><label><input type="checkbox" name="ped_spine_scoliosis" /> Scoliosis</label><label><input type="checkbox" name="ped_spine_kyphosis" /> Kyphosis</label><label><input type="checkbox" name="ped_spine_lordosis" /> Lordosis</label></div>
      <textarea name="ped_spine_notes" placeholder="Spine notes"></textarea>
      <textarea name="ped_spine_mobility" placeholder="Spine mobility notes"></textarea>
    </div>`);
  form.appendChild(buildPediatricsReferenceSection());
}

function renderPsychiatryAnamnesisForm(fields){
  const form = document.getElementById("anamnesis-psychiatry-form");
  if(!form) return;
  form.innerHTML = "";
  if(!Array.isArray(fields) || fields.length === 0){
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Psychiatry anamnesis data not found.";
    form.appendChild(empty);
    return;
  }

  form.appendChild(buildSharedIdentificationSection());
  form.appendChild(buildSharedChiefComplaintSection());

  const sections = [];
  let currentSection = null;
  let currentGroup = null;
  for(const field of fields){
    if(!String(field.field_id || "").trim()) continue;
    if(SHARED_PSYCHIATRY_FIELD_IDS.has(String(field.field_id || "").trim())) continue;
    if(!currentSection || currentSection.id !== field.section_id){
      const sectionNo = parsePsychiatrySectionNumber(field.section_id);
      const adjustedSectionNo = Number.isFinite(sectionNo) ? sectionNo + 2 : (sections.length + 3);
      currentSection = {
        id: field.section_id,
        no: adjustedSectionNo,
        name: field.section_name || field.section_id || "Section",
        groups: []
      };
      sections.push(currentSection);
      currentGroup = null;
    }
    if(!currentGroup || currentGroup.id !== field.group_id){
      currentGroup = {
        id: field.group_id,
        name: field.group_name || field.group_id || "",
        fields: []
      };
      currentSection.groups.push(currentGroup);
    }
    currentGroup.fields.push(field);
  }

  for(const section of sections){
    const sectionEl = document.createElement("div");
    sectionEl.className = "anam-section";
    const h3 = document.createElement("h3");
    h3.appendChild(document.createTextNode(`${section.no}. `));
    h3.appendChild(renderTermWithHelp(section.name));
    sectionEl.appendChild(h3);

    for(const group of section.groups){
      const groupEl = document.createElement("div");
      groupEl.className = "anam-group";
      const title = document.createElement("strong");
      title.className = "anam-group-title";
      title.appendChild(renderTermWithHelp(group.name));
      groupEl.appendChild(title);

      const checkboxFields = group.fields.filter(f => (normalizePsychiatryFieldType(f.field_type) || "text") === "checkbox");
      const otherFields = group.fields.filter(f => (normalizePsychiatryFieldType(f.field_type) || "text") !== "checkbox");

      if(checkboxFields.length > 0){
        const patientBoxes = checkboxFields.filter(f => !isClinicianRole(f));
        const clinicianBoxes = checkboxFields.filter(f => isClinicianRole(f));

        if(patientBoxes.length > 0){
          const row = document.createElement("div");
          row.className = "anam-row";
          const lead = document.createElement("strong");
          lead.textContent = "Patient";
          row.appendChild(lead);
          for(const field of patientBoxes){
            row.appendChild(buildPsychiatryCheckboxLabel(field));
          }
          groupEl.appendChild(row);
        }

        if(clinicianBoxes.length > 0){
          const row = document.createElement("div");
          row.className = "anam-row";
          const lead = document.createElement("strong");
          lead.className = "anam-psych-clinician";
          lead.textContent = "Clinician";
          row.appendChild(lead);
          for(const field of clinicianBoxes){
            row.appendChild(buildPsychiatryCheckboxLabel(field, { clinician: true }));
          }
          groupEl.appendChild(row);
        }
      }

      if(otherFields.length > 0){
        const grid = document.createElement("div");
        grid.className = "anam-grid";
        for(const field of otherFields){
          grid.appendChild(buildPsychiatryAnamnesisField(field));
        }
        groupEl.appendChild(grid);
      }

      sectionEl.appendChild(groupEl);
    }
    form.appendChild(sectionEl);
  }
  refreshAnamnesisInputMode();
}

async function ensurePsychiatryAnamnesisFormBuilt(){
  const form = document.getElementById("anamnesis-psychiatry-form");
  if(!form) return;
  if(form.dataset.ready === "1") return;
  try{
    const [fields] = await Promise.all([
      loadPsychiatryAnamnesisRows(),
      loadPsychiatryTermExplanations()
    ]);
    renderPsychiatryAnamnesisForm(fields);
    refreshAnamnesisInputMode();
    form.dataset.ready = "1";
    form.addEventListener("input", (event)=>{
      const target = event.target instanceof HTMLElement ? event.target : null;
      const targetName = target && "name" in target ? String(target.name || "") : "";
      if(targetName === "ident_dob"){
        syncAgeFromDob(form);
      }
      scheduleAnamnesisSave();
    });
    form.addEventListener("change", (event)=>{
      const target = event.target instanceof HTMLElement ? event.target : null;
      const targetName = target && "name" in target ? String(target.name || "") : "";
      if(targetName === "ident_dob"){
        syncAgeFromDob(form);
      }
      scheduleAnamnesisSave();
    });
  }catch(e){
    form.innerHTML = "";
    const msg = document.createElement("p");
    msg.className = "muted";
    msg.textContent = "Failed to load psychiatry anamnesis form.";
    form.appendChild(msg);
    console.warn("Psychiatry anamnesis form load failed:", e.message || e);
  }
}

function ensurePediatricsAnamnesisFormBuilt(){
  const form = document.getElementById("anamnesis-pediatrics-form");
  if(!form) return;
  if(form.dataset.ready === "1") return;
  renderPediatricsAnamnesisForm();
  bindAllAnamnesisRepeaterButtons();
  applyAnamnesisTranslationsToDom();
  refreshAnamnesisInputMode();
  form.dataset.ready = "1";
  form.addEventListener("input", (event)=>{
    const target = event.target instanceof HTMLElement ? event.target : null;
    const targetName = target && "name" in target ? String(target.name || "") : "";
    if(targetName === "ident_dob"){
      syncAgeFromDob(form);
    }
    scheduleAnamnesisSave();
  });
  form.addEventListener("change", (event)=>{
    const target = event.target instanceof HTMLElement ? event.target : null;
    const targetName = target && "name" in target ? String(target.name || "") : "";
    if(targetName === "ident_dob"){
      syncAgeFromDob(form);
    }
    if(targetName === "ped_med_otc" || targetName === "ped_med_supplements"){
      updatePediatricsMedicationDetailsVisibility();
    }
    if(targetName === "ped_med_misuse"){
      updatePediatricsMedicationConditionalVisibility();
    }
    if(targetName === "ped_planned_op"){
      updatePediatricsPlannedOperationVisibility();
    }
    if(targetName === "ped_blood_transfusion" || targetName === "ped_blood_transfusion_reaction"){
      updatePediatricsBloodTransfusionVisibility();
    }
    scheduleAnamnesisSave();
  });
}

function collectAnamnesisData(form){
  const data = {};
  form.querySelectorAll("input, textarea, select").forEach(el=>{
    if(!el.name) return;
    if(el.type === "checkbox") data[el.name] = el.checked;
    else if(el.type === "radio"){
      if(el.checked) data[el.name] = el.value;
    } else {
      data[el.name] = el.value;
    }
  });
  return data;
}

function applyAnamnesisData(form, data){
  form.querySelectorAll("input, textarea, select").forEach(el=>{
    if(!el.name || !(el.name in data)) return;
    if(el.type === "checkbox") el.checked = !!data[el.name];
    else if(el.type === "radio") el.checked = (data[el.name] === el.value);
    else el.value = data[el.name];
  });
}

function scheduleAnamnesisSave(){
  clearTimeout(anamnesisSaveTimer);
  anamnesisSaveTimer = setTimeout(saveAnamnesisForm, 300);
}

function readLocalAnamnesisRegistryState(){
  let records = [];
  try{
    const raw = localStorage.getItem(ANAMNESIS_PATIENTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if(Array.isArray(parsed)){
      records = parsed.map(record => createPatientAnamnesisRecord(record));
    }
  }catch(e){
    records = [];
  }
  if(records.length === 0){
    records = migrateLegacyAnamnesisPatients();
  }
  const sorted = records.sort((a, b)=> String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const storedActiveId = String(localStorage.getItem(ANAMNESIS_ACTIVE_PATIENT_KEY) || "").trim();
  return {
    records: sorted,
    activePatientId: sorted.some(record => record.id === storedActiveId) ? storedActiveId : (sorted[0] ? sorted[0].id : "")
  };
}

function persistAnamnesisRegistry(){
  const normalizedState = normalizeAnamnesisProfileState({
    records: anamnesisPatientRecords,
    activePatientId: activeAnamnesisPatientId
  });
  anamnesisPatientRecords = normalizedState.records;
  activeAnamnesisPatientId = normalizedState.activePatientId;
  localStorage.setItem(ANAMNESIS_PATIENTS_STORAGE_KEY, JSON.stringify(anamnesisPatientRecords));
  if(activeAnamnesisPatientId){
    localStorage.setItem(ANAMNESIS_ACTIVE_PATIENT_KEY, activeAnamnesisPatientId);
  } else {
    localStorage.removeItem(ANAMNESIS_ACTIVE_PATIENT_KEY);
  }
  if(isProfileSessionActive()){
    userProfile = ensureProfileShape(userProfile);
    const currentProfileState = normalizeAnamnesisProfileState(userProfile.anamnesis);
    const nextProfileState = normalizeAnamnesisProfileState({
      records: anamnesisPatientRecords,
      activePatientId: activeAnamnesisPatientId
    });
    if(JSON.stringify(currentProfileState) !== JSON.stringify(nextProfileState)){
      userProfile.anamnesis = {
        records: deepClone(nextProfileState.records),
        active_patient_id: nextProfileState.activePatientId
      };
      markProfileDirty();
      scheduleAnamnesisProfileSave();
    }
  }
}

function migrateLegacyAnamnesisPatients(){
  const migrated = [];
  let internalData = null;
  let psychiatryData = null;
  try{ internalData = JSON.parse(localStorage.getItem(ANAMNESIS_STORAGE_KEY) || "null"); }catch(e){ internalData = null; }
  try{ psychiatryData = JSON.parse(localStorage.getItem(ANAMNESIS_PSYCHIATRY_STORAGE_KEY) || "null"); }catch(e){ psychiatryData = null; }

  if(internalData && typeof internalData === "object"){
    migrated.push(createPatientAnamnesisRecord({
      name: internalData.ident_full_name || "Imported internal patient",
      age: parseAnamnesisAge(internalData.ident_age || internalData.ident_dob_age),
      anamnesisType: "internal",
      chiefComplaint: internalData.chief_complaint || "",
      notes: internalData.anamnesis_global_notes || "",
      anamnesisData: { internal: internalData }
    }));
  }
  if(psychiatryData && typeof psychiatryData === "object"){
    migrated.push(createPatientAnamnesisRecord({
      name: psychiatryData.patient_name || psychiatryData.ident_full_name || "Imported psychiatric patient",
      age: parseAnamnesisAge(psychiatryData.patient_age),
      anamnesisType: "psychiatric",
      chiefComplaint: psychiatryData.chief_complaint || "",
      notes: psychiatryData.anamnesis_global_notes || "",
      anamnesisData: { psychiatric: psychiatryData }
    }));
  }
  return migrated;
}

function loadAnamnesisRegistryFromStorage(){
  const localState = readLocalAnamnesisRegistryState();
  let nextState = localState;
  if(isProfileSessionActive()){
    const remoteState = normalizeAnamnesisProfileState(userProfile && userProfile.anamnesis);
    nextState = mergeAnamnesisRegistryStates(localState, remoteState);
    const normalizedRemoteState = normalizeAnamnesisProfileState(remoteState);
    if(JSON.stringify(normalizedRemoteState) !== JSON.stringify(nextState)){
      userProfile = ensureProfileShape(userProfile);
      userProfile.anamnesis = {
        records: deepClone(nextState.records),
        active_patient_id: nextState.activePatientId
      };
      markProfileDirty();
    }
  }
  anamnesisPatientRecords = nextState.records;
  activeAnamnesisPatientId = nextState.activePatientId;
  localStorage.setItem(ANAMNESIS_PATIENTS_STORAGE_KEY, JSON.stringify(anamnesisPatientRecords));
  if(activeAnamnesisPatientId){
    localStorage.setItem(ANAMNESIS_ACTIVE_PATIENT_KEY, activeAnamnesisPatientId);
  } else {
    localStorage.removeItem(ANAMNESIS_ACTIVE_PATIENT_KEY);
  }
}

function renderAnamnesisPatientList(){
  const list = document.getElementById("anamnesis-patient-list");
  if(!list) return;
  list.innerHTML = "";
  if(anamnesisPatientRecords.length === 0){
    const empty = document.createElement("div");
    empty.className = "anamnesis-patient-empty muted";
    empty.textContent = tOr("anamnesis_no_patients_saved", "No patients saved yet.");
    list.appendChild(empty);
    return;
  }

  for(const record of anamnesisPatientRecords){
    const row = document.createElement("div");
    row.className = "anamnesis-patient-row";
    if(record.id === activeAnamnesisPatientId) row.classList.add("active");
    row.setAttribute("role", "listitem");
    row.dataset.patientId = record.id;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "anamnesis-patient-open";
    btn.dataset.patientId = record.id;

    const title = document.createElement("strong");
    title.className = "anamnesis-patient-summary";
    title.textContent = getAnamnesisRecordSummary(record);
    btn.appendChild(title);

    const meta = document.createElement("span");
    meta.className = "muted anamnesis-patient-updated";
    meta.textContent = `${tOr("anamnesis_updated", "Updated")} ${new Date(record.updatedAt || record.createdAt || nowIso()).toLocaleString()}`;
    btn.appendChild(meta);

    btn.addEventListener("click", async ()=>{
      await openAnamnesisPatientRecord(record.id);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "anamnesis-patient-delete";
    deleteBtn.dataset.patientId = record.id;
    deleteBtn.setAttribute("aria-label", tOr("anamnesis_delete_patient", "Delete patient"));
    deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v8h-2zm4 0h2v8h-2zM7 10h2v8H7zm1 10h8a2 2 0 0 0 2-2V8H6v10a2 2 0 0 0 2 2z"/></svg>';
    deleteBtn.addEventListener("click", async (event)=>{
      event.preventDefault();
      event.stopPropagation();
      await deleteAnamnesisPatientRecord(record.id);
    });

    row.appendChild(btn);
    row.appendChild(deleteBtn);
    list.appendChild(row);
  }
}

function updateAnamnesisEditorChrome(record){
  const screen = document.getElementById("screen-anamnesis");
  const shell = document.querySelector("#screen-anamnesis .anamnesis-registry-shell");
  const registryCard = document.getElementById("anamnesis-registry-card");
  const editorCard = document.getElementById("anamnesis-editor-card");
  const hasRecord = !!record;
  const showRegistry = !hasRecord || anamnesisPhoneRegistryVisible;
  const showEditor = hasRecord && !anamnesisPhoneRegistryVisible;
  const collapseRegistry = showEditor;
  if(screen) screen.classList.toggle("anamnesis-record-open", showEditor);
  if(shell) shell.classList.toggle("is-editor-active", collapseRegistry);
  if(registryCard) registryCard.classList.toggle("hidden", !showRegistry);
  if(editorCard) editorCard.classList.toggle("hidden", !showEditor);
  updateAnamnesisMobileHeader(record);
  if(!hasRecord){
    anamnesisPhoneRegistryVisible = true;
    setAnamnesisPhoneToolsOpen(false);
  }
  requestAnimationFrame(()=> syncAnamnesisMobileToolbar());
}

function populateAnamnesisMetaInputs(record){
  withAnamnesisSyncLock(()=>{
    const type = document.getElementById("anamnesis-patient-type");
    if(type) type.value = record ? normalizeAnamnesisType(record.anamnesisType) : "internal";
  });
}

function syncMetaToInternalForm(){
  return;
}

function syncInternalFormToMeta(targetName = ""){
  return;
}

async function setAnamnesisFormTab(tab){
  const nextTab = tab === "psychiatry" ? "psychiatry" : (tab === "pediatrics" ? "pediatrics" : "internal");
  activeAnamnesisTab = nextTab;
  const internalWrap = document.getElementById("anamnesis-form-internal-wrap");
  const psychiatryWrap = document.getElementById("anamnesis-form-psychiatry-wrap");
  const pediatricsWrap = document.getElementById("anamnesis-form-pediatrics-wrap");
  if(internalWrap) internalWrap.classList.toggle("hidden", nextTab !== "internal");
  if(psychiatryWrap) psychiatryWrap.classList.toggle("hidden", nextTab !== "psychiatry");
  if(pediatricsWrap) pediatricsWrap.classList.toggle("hidden", nextTab !== "pediatrics");
  if(nextTab === "psychiatry") await ensurePsychiatryAnamnesisFormBuilt();
  if(nextTab === "pediatrics") ensurePediatricsAnamnesisFormBuilt();
}

async function loadInternalAnamnesisForm(data = null){
  const form = document.getElementById('anamnesis-form');
  if(!form) return;
  if(anamnesisDictionaryById.size === 0){
    try{ await loadAnamnesisDictionary(); }catch(e){}
  }
  form.reset();
  if(!data || typeof data !== "object"){
    initAnamnesisRepeaters(null);
    updatePlannedOperationVisibility();
    normalizeEmploymentSelection();
    normalizeMaritalSelection();
    normalizeLivingSelection();
    normalizeParentsAliveSelection();
    normalizeHousingSelection();
    updateHousingVisibility();
    updateMedicationConditionalVisibility();
    updateMedicationDetailsVisibility();
    updateBloodTransfusionVisibility();
    updateGynecologicalVisibility(form);
    updateHpiRadiationVisibility();
    applyAnamnesisTranslationsToDom();
    enhanceAnamnesisSections(form);
    refreshAnamnesisInputMode();
    return;
  }
  initAnamnesisRepeaters(data);
  applyAnamnesisData(form, data);
  updatePlannedOperationVisibility();
  normalizeEmploymentSelection();
  normalizeMaritalSelection();
  normalizeLivingSelection();
  normalizeParentsAliveSelection();
  normalizeHousingSelection();
  updateHousingVisibility();
  updateMedicationConditionalVisibility();
  updateMedicationDetailsVisibility();
  updateBloodTransfusionVisibility();
  updateGynecologicalVisibility(form);
  updateHpiRadiationVisibility();
  syncAgeFromDob(form);
  applyAnamnesisTranslationsToDom();
  enhanceAnamnesisSections(form);
  refreshAnamnesisInputMode();
}

async function loadPsychiatryAnamnesisForm(data = null){
  await ensurePsychiatryAnamnesisFormBuilt();
  const form = document.getElementById("anamnesis-psychiatry-form");
  if(!form) return;
  if(data){
    applyAnamnesisData(form, data);
  } else {
    form.reset();
  }
  syncAgeFromDob(form);
  enhanceAnamnesisSections(form);
  refreshAnamnesisInputMode();
}

async function loadPediatricsAnamnesisForm(data = null){
  ensurePediatricsAnamnesisFormBuilt();
  const form = document.getElementById("anamnesis-pediatrics-form");
  if(!form) return;
  initAnamnesisRepeaters(data);
  if(data){
    applyAnamnesisData(form, data);
  } else {
    form.reset();
  }
  applyAnamnesisTranslationsToDom();
  updatePediatricsMedicationConditionalVisibility();
  updatePediatricsMedicationDetailsVisibility();
  updatePediatricsPlannedOperationVisibility();
  updatePediatricsBloodTransfusionVisibility();
  syncAgeFromDob(form);
  enhanceAnamnesisSections(form);
  refreshAnamnesisInputMode();
}

async function loadAnamnesisForm(){
  const record = getActiveAnamnesisPatientRecord();
  const status = document.getElementById("anamnesis-status");
  if(status) status.textContent = "";
  updateAnamnesisEditorChrome(record);
  populateAnamnesisMetaInputs(record);
  const notes = document.getElementById("anamnesis-notes-text");
  if(!record){
    if(notes) notes.value = "";
    await setAnamnesisFormTab("internal");
    await loadInternalAnamnesisForm(null);
    updateAnamnesisMobileHeaderPreview();
    return;
  }

  const type = normalizeAnamnesisType(record.anamnesisType);
  await setAnamnesisFormTab(getAnamnesisFormTabByType(type));
  const bucket = normalizeAnamnesisDataByType(record.anamnesisData, type);
  const sharedData = extractSharedAnamnesisFields(record.sharedFields);
  if(activeAnamnesisTab === "psychiatry"){
    await loadPsychiatryAnamnesisForm(mergeSharedFieldsIntoData(bucket.psychiatric || null, sharedData));
  } else if(activeAnamnesisTab === "pediatrics"){
    await loadPediatricsAnamnesisForm(mergeSharedFieldsIntoData(bucket.pediatrics || null, sharedData));
  } else {
    const internalData = type === "pediatrics" ? (bucket.pediatrics || null) : (bucket.internal || null);
    await loadInternalAnamnesisForm(mergeSharedFieldsIntoData(internalData, sharedData));
    syncMetaToInternalForm();
  }
  if(notes) notes.value = record.notes || "";
  updateAnamnesisMobileHeaderPreview();
}

function upsertAnamnesisRecord(record){
  const index = anamnesisPatientRecords.findIndex(item => item.id === record.id);
  if(index === -1) anamnesisPatientRecords.unshift(record);
  else anamnesisPatientRecords.splice(index, 1, record);
  anamnesisPatientRecords.sort((a, b)=> String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function saveAnamnesisForm(opts = {}){
  const { silent = false, forcedType = "" } = opts;
  const record = getActiveAnamnesisPatientRecord();
  if(!record) return;
  const formType = normalizeAnamnesisType(forcedType || record.anamnesisType);
  const formTab = getAnamnesisFormTabByType(formType);
  const form = formTab === "psychiatry"
    ? document.getElementById("anamnesis-psychiatry-form")
    : document.getElementById("anamnesis-form");
  if(!form) return;

  const notes = document.getElementById("anamnesis-notes-text");
  const typeInput = document.getElementById("anamnesis-patient-type");
  const nextRecordType = forcedType ? record.anamnesisType : (typeInput ? typeInput.value : record.anamnesisType);
  const collected = collectAnamnesisData(form);
  if(notes) collected.anamnesis_global_notes = notes.value;
  const sharedFields = extractSharedAnamnesisFields(collected);
  const existingBuckets = normalizeAnamnesisDataByType(record.anamnesisData, record.anamnesisType);

  const nextRecord = createPatientAnamnesisRecord({
    ...record,
    name: collected.ident_full_name || record.name,
    age: collected.ident_age || record.age,
    anamnesisType: nextRecordType,
    chiefComplaint: collected.chief_complaint || record.chiefComplaint,
    notes: notes ? notes.value : record.notes,
    updatedAt: nowIso(),
    sharedFields,
    anamnesisData: {
      internal: mergeSharedFieldsIntoData(existingBuckets.internal, sharedFields),
      psychiatric: mergeSharedFieldsIntoData(existingBuckets.psychiatric, sharedFields),
      pediatrics: mergeSharedFieldsIntoData(existingBuckets.pediatrics, sharedFields),
      [formType]: mergeSharedFieldsIntoData(collected, sharedFields)
    }
  });

  if(!nextRecord.chiefComplaint && collected.chief_complaint){
    nextRecord.chiefComplaint = String(collected.chief_complaint || "").trim();
  }
  if(!nextRecord.name && collected.ident_full_name){
    nextRecord.name = String(collected.ident_full_name || "").trim();
  }
  if(nextRecord.age === null && collected.ident_age){
    nextRecord.age = parseAnamnesisAge(collected.ident_age);
  }

  upsertAnamnesisRecord(nextRecord);
  activeAnamnesisPatientId = nextRecord.id;
  persistAnamnesisRegistry();
  renderAnamnesisPatientList();
  updateAnamnesisEditorChrome(nextRecord);
  if(!silent){
    const status = document.getElementById("anamnesis-status");
    if(status) status.textContent = t("anam_saved_locally") || "Saved locally.";
  }
}

function clearInternalAnamnesisForm(){
  const form = document.getElementById('anamnesis-form');
  if(form) form.reset();
  initAnamnesisRepeaters(null);
  updatePlannedOperationVisibility();
  normalizeEmploymentSelection();
  normalizeMaritalSelection();
  normalizeLivingSelection();
  normalizeParentsAliveSelection();
  normalizeHousingSelection();
  updateHousingVisibility();
  updateMedicationConditionalVisibility();
  updateMedicationDetailsVisibility();
  updateBloodTransfusionVisibility();
  updateHpiRadiationVisibility();
}

function clearPsychiatryAnamnesisForm(){
  const form = document.getElementById("anamnesis-psychiatry-form");
  if(form) form.reset();
}

function clearPediatricsAnamnesisForm(){
  const form = document.getElementById("anamnesis-pediatrics-form");
  if(form) form.reset();
  initAnamnesisRepeaters(null);
}

function clearAnamnesisForm(){
  const record = getActiveAnamnesisPatientRecord();
  if(!record) return;
  const type = normalizeAnamnesisType(record.anamnesisType);
  if(getAnamnesisFormTabByType(type) === "psychiatry") clearPsychiatryAnamnesisForm();
  else if(getAnamnesisFormTabByType(type) === "pediatrics") clearPediatricsAnamnesisForm();
  else clearInternalAnamnesisForm();
  const notes = document.getElementById("anamnesis-notes-text");
  if(notes) notes.value = "";
  const nextRecord = createPatientAnamnesisRecord({
    ...record,
    name: "",
    age: null,
    chiefComplaint: "",
    notes: "",
    sharedFields: {},
    updatedAt: nowIso(),
    anamnesisData: {
      internal: {},
      psychiatric: {},
      pediatrics: {},
      [type]: {}
    }
  });
  upsertAnamnesisRecord(nextRecord);
  persistAnamnesisRegistry();
  renderAnamnesisPatientList();
  const status = document.getElementById("anamnesis-status");
  if(status) status.textContent = t("anam_cleared") || "Cleared.";
}

async function openAnamnesisPatientRecord(id){
  const record = getAnamnesisPatientRecordById(id);
  if(!record) return;
  if(activeAnamnesisPatientId && activeAnamnesisPatientId !== id){
    saveAnamnesisForm({ silent: true });
  }
  anamnesisPhoneRegistryVisible = false;
  setAnamnesisPhoneToolsOpen(false);
  activeAnamnesisPatientId = id;
  persistAnamnesisRegistry();
  renderAnamnesisPatientList();
  await loadAnamnesisForm();
}

async function deleteAnamnesisPatientRecord(id){
  const record = getAnamnesisPatientRecordById(id);
  if(!record) return;
  const summary = getAnamnesisRecordSummary(record);
  const confirmText = tOr("anamnesis_delete_confirm", "Delete this patient record? This cannot be undone.");
  if(!confirm(`${confirmText}\n\n${summary}`)) return;

  anamnesisPatientRecords = anamnesisPatientRecords.filter(item => item.id !== id);
  if(activeAnamnesisPatientId === id){
    activeAnamnesisPatientId = anamnesisPatientRecords[0] ? anamnesisPatientRecords[0].id : "";
  }
  persistAnamnesisRegistry();
  renderAnamnesisPatientList();
  updateAnamnesisEditorChrome(getActiveAnamnesisPatientRecord());
  await loadAnamnesisForm();
}

function closeActiveAnamnesisPatient(){
  saveAnamnesisForm({ silent: true });
  anamnesisPhoneRegistryVisible = false;
  setAnamnesisPhoneToolsOpen(false);
  activeAnamnesisPatientId = "";
  persistAnamnesisRegistry();
  renderAnamnesisPatientList();
  loadAnamnesisForm();
  requestAnimationFrame(()=> focusAnamnesisRegistryList());
}

async function createAnamnesisPatientRecord(seed = {}){
  const record = createPatientAnamnesisRecord(seed);
  anamnesisPatientRecords.unshift(record);
  anamnesisPhoneRegistryVisible = false;
  setAnamnesisPhoneToolsOpen(false);
  activeAnamnesisPatientId = record.id;
  persistAnamnesisRegistry();
  renderAnamnesisPatientList();
  await loadAnamnesisForm();
}

function initializeAnamnesisRegistry(){
  if(anamnesisRegistryInitialized) return;
  loadAnamnesisRegistryFromStorage();
  persistAnamnesisRegistry();
  renderAnamnesisPatientList();
  anamnesisPhoneRegistryVisible = !getActiveAnamnesisPatientRecord();
  updateAnamnesisEditorChrome(getActiveAnamnesisPatientRecord());
  applyAnamnesisLayoutMode();
  refreshAnamnesisInputMode();
  anamnesisRegistryInitialized = true;
}

async function handleAnamnesisTypeChange(nextType){
  const record = getActiveAnamnesisPatientRecord();
  if(!record) return;
  const normalizedNextType = normalizeAnamnesisType(nextType);
  const previousType = normalizeAnamnesisType(record.anamnesisType);
  if(previousType === normalizedNextType) return;
  saveAnamnesisForm({ silent: true, forcedType: previousType });
  const updatedRecord = createPatientAnamnesisRecord({
    ...getActiveAnamnesisPatientRecord(),
    anamnesisType: normalizedNextType,
    updatedAt: nowIso()
  });
  upsertAnamnesisRecord(updatedRecord);
  persistAnamnesisRegistry();
  renderAnamnesisPatientList();
  await loadAnamnesisForm();
}

async function ensureAnamnesisRegistryReady(){
  initializeAnamnesisRegistry();
  if(getActiveAnamnesisPatientRecord()){
    await loadAnamnesisForm();
    return;
  }
  await loadAnamnesisForm();
}

function applyTextSize(step, opts = {}){
  const { persist = true, syncProfile = true } = opts;
  const clamped = Math.max(1, Math.min(7, Number(step) || 4));
  const px = TEXT_SIZES[clamped - 1] || 16;
  const scale = px / 16;
  document.documentElement.style.setProperty('--base-font-size', px + 'px');
  document.documentElement.style.setProperty('--text-scale', String(scale));
  document.body.style.setProperty('--base-font-size', px + 'px');
  document.body.style.setProperty('--text-scale', String(scale));
  if(persist){
    localStorage.setItem(TEXT_SIZE_KEY, String(clamped));
  }
  if(syncProfile && isProfileSessionActive()){
    userProfile.settings.text_size = String(clamped);
    markProfileDirty();
  }
}

let lastTextSizePhonePreset = null;

function normalizeTextSizeStep(raw, fallback = 4){
  return String(Math.max(1, Math.min(7, Number(raw) || fallback)));
}

function isPhoneTextSizeViewport(){
  const width = Math.round(window.visualViewport && window.visualViewport.width ? window.visualViewport.width : window.innerWidth || 0);
  return width <= 760;
}

function syncTextSizeForViewport(opts = {}){
  const { force = false } = opts;
  const isPhone = isPhoneTextSizeViewport();
  if(!force && lastTextSizePhonePreset === isPhone) return;
  const preferred = normalizeTextSizeStep(localStorage.getItem(TEXT_SIZE_KEY) || '4');
  const effective = isPhone ? String(PHONE_TEXT_SIZE_STEP) : preferred;
  applyTextSize(effective, { persist: false, syncProfile: false });
  const sizeSlider = document.getElementById('text-size-slider');
  if(sizeSlider) sizeSlider.value = effective;
  lastTextSizePhonePreset = isPhone;
}

const SCREEN_TRANSITION_MS = 210;
let currentScreenId = "";
let navStack = [];

function prefersReducedMotion(){
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function focusScreenPrimaryTarget(screenEl){
  if(!screenEl) return;
  const firstInput = screenEl.querySelector("input, select, textarea");
  const firstHeading = screenEl.querySelector("h2");
  const fallback = screenEl.querySelector("button, [tabindex]");
  const target = firstInput || firstHeading || fallback;
  if(!target) return;
  if(target.tagName && target.tagName.toLowerCase() === "h2" && !target.hasAttribute("tabindex")){
    target.setAttribute("tabindex", "-1");
  }
  try{ target.focus({ preventScroll: true }); }catch(e){}
}

function resetScreenScrollPosition(screenEl){
  const main = document.querySelector("main");
  const docEl = document.documentElement;
  const body = document.body;
  const scrollingEl = document.scrollingElement;
  const reset = ()=>{
    try{
      if(main) main.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }catch(e){}
    try{
      if(scrollingEl) scrollingEl.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }catch(e){}
    try{
      if(docEl){
        docEl.scrollTop = 0;
        docEl.scrollLeft = 0;
      }
      if(body){
        body.scrollTop = 0;
        body.scrollLeft = 0;
      }
    }catch(e){}
    try{
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }catch(e){}
    if(!screenEl) return;
    try{
      screenEl.scrollTop = 0;
      screenEl.scrollLeft = 0;
    }catch(e){}
    screenEl.querySelectorAll("*").forEach(el=>{
      if(!(el instanceof HTMLElement)) return;
      const tag = String(el.tagName || "").toLowerCase();
      if(tag === "textarea" || tag === "input" || tag === "select") return;
      const canScrollY = el.scrollHeight - el.clientHeight > 8;
      const canScrollX = el.scrollWidth - el.clientWidth > 8;
      if(!canScrollY && !canScrollX) return;
      try{
        el.scrollTop = 0;
        el.scrollLeft = 0;
      }catch(e){}
    });
  };
  reset();
  requestAnimationFrame(reset);
  setTimeout(reset, 80);
  setTimeout(reset, 180);
}

function finalizeHiddenScreen(el){
  if(!el) return;
  el.classList.remove("is-active");
  el.classList.remove("is-exiting");
  el.classList.add("hidden");
  el.setAttribute("aria-hidden", "true");
  try{ el.inert = true; }catch(e){}
}

function switchScreen(id, opts = {}){
  const { updateHistory = true, replaceHistory = false } = opts;
  const nextEl = document.getElementById(id);
  if(!nextEl) return;

  if(!currentScreenId){
    const visible = document.querySelector(".screen:not(.hidden)");
    currentScreenId = visible ? String(visible.id || "") : "";
  }

  const prevId = String(currentScreenId || "");
  const prevEl = prevId ? document.getElementById(prevId) : null;
  const sameScreen = prevEl && prevEl === nextEl;
  const animate = !prefersReducedMotion();

  if(!sameScreen){
    nextEl.classList.remove("hidden");
    nextEl.classList.remove("is-exiting");
    nextEl.setAttribute("aria-hidden", "false");
    try{ nextEl.inert = false; }catch(e){}
    if(animate){
      nextEl.classList.remove("is-active");
      // Ensure class change is committed before activating transition.
      void nextEl.offsetHeight;
      requestAnimationFrame(()=> nextEl.classList.add("is-active"));
    } else {
      nextEl.classList.add("is-active");
    }

    if(prevEl){
      prevEl.classList.remove("is-active");
      prevEl.classList.add("is-exiting");
      prevEl.setAttribute("aria-hidden", "true");
      try{ prevEl.inert = true; }catch(e){}
      if(animate){
        let done = false;
        const cleanup = ()=>{
          if(done) return;
          done = true;
          prevEl.removeEventListener("transitionend", onEnd);
          finalizeHiddenScreen(prevEl);
        };
        const onEnd = (event)=>{
          if(event && event.target !== prevEl) return;
          cleanup();
        };
        prevEl.addEventListener("transitionend", onEnd, { once: true });
        setTimeout(cleanup, SCREEN_TRANSITION_MS + 80);
      } else {
        finalizeHiddenScreen(prevEl);
      }
    }

    currentScreenId = id;
    resetScreenScrollPosition(nextEl);
    setTimeout(()=> focusScreenPrimaryTarget(nextEl), animate ? 60 : 0);
  } else {
    nextEl.classList.remove("hidden");
    nextEl.classList.remove("is-exiting");
    nextEl.classList.add("is-active");
    nextEl.setAttribute("aria-hidden", "false");
    try{ nextEl.inert = false; }catch(e){}
    currentScreenId = id;
    resetScreenScrollPosition(nextEl);
  }

  // Persist current view in the URL using clean path routes.
  const targetPath = buildAppPathForRoute(getRouteForScreen(id));
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if(updateHistory && currentPath !== targetPath){
    if(replaceHistory) history.replaceState(null, "", targetPath);
    else history.pushState(null, "", targetPath);
  }

  // Persist per tab session: survives refresh, resets after tab/browser close.
  try{ sessionStorage.setItem(NAV_SESSION_KEY, id); }catch(e){}
}

function updateHeaderNavUI(){
  const backBtn = document.getElementById("header-back");
  if(!backBtn) return;
  const isMenu = String(currentScreenId || "") === "screen-menu";
  backBtn.classList.toggle("hidden", isMenu);
  backBtn.disabled = isMenu;
}

function goHeaderBack(){
  const current = String(currentScreenId || "");
  if(current === "screen-menu") return;
  if(current === "screen-submenu"){
    navStack = [];
    showScreen("screen-menu", { skipNavStack: true });
    return;
  }
  const prev = navStack.length ? navStack.pop() : "";
  if(prev){
    showScreen(prev, { skipNavStack: true });
  } else {
    showScreen("screen-menu", { skipNavStack: true });
  }
}

function showScreen(id, opts = {}){
  const { replaceNav = false, skipNavStack = false, ...switchOpts } = opts || {};
  const visible = currentScreenId || (document.querySelector(".screen:not(.hidden)") && document.querySelector(".screen:not(.hidden)").id) || "";
  if(!skipNavStack && visible && id !== visible){
    if(replaceNav){
      if(navStack.length){
        navStack[navStack.length - 1] = visible;
      } else {
        navStack.push(visible);
      }
    } else {
      navStack.push(visible);
    }
    if(navStack.length > 120){
      navStack = navStack.slice(navStack.length - 120);
    }
  }
  switchScreen(id, switchOpts);
  if(id === "screen-menu"){
    const main = document.querySelector("main");
    const menu = document.getElementById("screen-menu");
    const resetMenuTop = ()=>{
      try{
        if(main) main.scrollTo({ top: 0, behavior: "auto" });
        if(menu){
          menu.scrollTop = 0;
          menu.scrollLeft = 0;
        }
      }catch(e){}
    };
    resetMenuTop();
    requestAnimationFrame(resetMenuTop);
    setTimeout(resetMenuTop, 80);
    setTimeout(resetMenuTop, 180);
  }
  if(id === "screen-entry") renderAttachmentsList();
  updateHeaderNavUI();
  syncLayoutMetrics();
}

function syncLayoutMetrics(){
  const header = document.querySelector("header");
  const h = header ? Math.ceil(header.getBoundingClientRect().height || 74) : 74;
  document.documentElement.style.setProperty("--header-h", `${h}px`);
}

function initScreenStates(){
  document.querySelectorAll(".screen").forEach(screen=>{
    const hidden = screen.classList.contains("hidden");
    screen.setAttribute("aria-hidden", hidden ? "true" : "false");
    try{ screen.inert = hidden; }catch(e){}
    screen.classList.remove("is-exiting");
    if(hidden) screen.classList.remove("is-active");
    else screen.classList.add("is-active");
  });
  const visible = document.querySelector(".screen:not(.hidden)");
  currentScreenId = visible ? String(visible.id || "") : "";
  updateHeaderNavUI();
  document.body.classList.add("ui-motion-ready");
}

function initButtonRipples(){
  document.addEventListener("pointerdown", (event)=>{
    if(typeof event.button === "number" && event.button !== 0) return;
    if(prefersReducedMotion()) return;
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if(!target) return;
    if(target.classList.contains("linklike")) return;
    const rect = target.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = "button-ripple";
    ripple.style.left = `${event.clientX - rect.left}px`;
    ripple.style.top = `${event.clientY - rect.top}px`;
    target.appendChild(ripple);
    ripple.addEventListener("animationend", ()=> ripple.remove(), { once: true });
  }, { passive: true });
}

const fieldMarqueeStates = new WeakMap();

function isMarqueeInput(el){
  if(!(el instanceof HTMLInputElement)) return false;
  const t = String(el.type || "text").toLowerCase();
  return t === "text" || t === "search" || t === "email" || t === "url" || t === "tel" || t === "";
}

function measureTextWidthForElement(el, text){
  const value = String(text || "");
  if(!value) return 0;
  const cs = window.getComputedStyle(el);
  const canvas = measureTextWidthForElement.canvas || (measureTextWidthForElement.canvas = document.createElement("canvas"));
  const ctx = canvas.getContext("2d");
  if(!ctx) return 0;
  const fontStyle = cs.fontStyle || "normal";
  const fontVariant = cs.fontVariant || "normal";
  const fontWeight = cs.fontWeight || "400";
  const fontSize = cs.fontSize || "16px";
  const fontFamily = cs.fontFamily || "sans-serif";
  ctx.font = `${fontStyle} ${fontVariant} ${fontWeight} ${fontSize} ${fontFamily}`;
  return ctx.measureText(value).width;
}

function getFieldVisibleTextWidth(el){
  const cs = window.getComputedStyle(el);
  const pl = parseFloat(cs.paddingLeft || "0") || 0;
  const pr = parseFloat(cs.paddingRight || "0") || 0;
  return Math.max(0, el.clientWidth - pl - pr - 2);
}

function getFieldOverflowText(el){
  if(el instanceof HTMLInputElement){
    const value = String(el.value || "");
    if(value) return value;
    return String(el.placeholder || "");
  }
  if(el instanceof HTMLSelectElement){
    const option = el.selectedOptions && el.selectedOptions.length ? el.selectedOptions[0] : null;
    return option ? String(option.textContent || "").trim() : "";
  }
  return "";
}

function fieldTextOverflows(el){
  if(!(el instanceof HTMLElement)) return false;
  if(el.clientWidth <= 0) return false;
  const text = getFieldOverflowText(el);
  if(!text) return false;
  const textWidth = measureTextWidthForElement(el, text);
  const visibleWidth = getFieldVisibleTextWidth(el);
  return textWidth > visibleWidth + 4;
}

function stopFieldMarquee(el){
  const state = fieldMarqueeStates.get(el);
  if(state && state.rafId){
    cancelAnimationFrame(state.rafId);
  }
  fieldMarqueeStates.delete(el);
  try{ el.scrollLeft = 0; }catch(e){}
}

function startFieldMarquee(el){
  if(!(el instanceof HTMLInputElement) || !isMarqueeInput(el)) return;
  if(document.activeElement === el) return;
  if(!String(el.value || "").trim()) return;
  const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
  if(maxScroll < 6) return;
  stopFieldMarquee(el);
  const state = {
    dir: 1,
    pauseUntil: performance.now() + 650,
    speedPxPerSec: 34,
    rafId: 0
  };
  const step = (ts)=>{
    if(!document.body.contains(el)){
      stopFieldMarquee(el);
      return;
    }
    if(document.activeElement === el){
      stopFieldMarquee(el);
      return;
    }
    const currentMax = Math.max(0, el.scrollWidth - el.clientWidth);
    if(currentMax < 6){
      stopFieldMarquee(el);
      return;
    }
    if(ts < state.pauseUntil){
      state.rafId = requestAnimationFrame(step);
      return;
    }
    const stepPx = state.speedPxPerSec / 60;
    let next = el.scrollLeft + state.dir * stepPx;
    if(next >= currentMax){
      next = currentMax;
      state.dir = -1;
      state.pauseUntil = ts + 900;
    }else if(next <= 0){
      next = 0;
      state.dir = 1;
      state.pauseUntil = ts + 700;
    }
    el.scrollLeft = next;
    state.rafId = requestAnimationFrame(step);
  };
  fieldMarqueeStates.set(el, state);
  state.rafId = requestAnimationFrame(step);
}

function updateFieldOverflowUX(el){
  if(!(el instanceof HTMLElement)) return;
  const overflow = fieldTextOverflows(el);
  if(overflow){
    const full = getFieldOverflowText(el);
    if(full) el.setAttribute("title", full);
  }else{
    el.removeAttribute("title");
  }
  if(el instanceof HTMLInputElement && isMarqueeInput(el)){
    if(overflow && String(el.value || "").trim() && document.activeElement !== el){
      startFieldMarquee(el);
    }else{
      stopFieldMarquee(el);
    }
  }
}

function refreshFieldOverflowUX(root = document){
  if(!root || !root.querySelectorAll) return;
  root.querySelectorAll("input, select").forEach(el=> updateFieldOverflowUX(el));
}

function initFieldOverflowUX(){
  const isTarget = (el)=> el instanceof HTMLInputElement || el instanceof HTMLSelectElement;
  document.addEventListener("focusin", (event)=>{
    const el = event.target;
    if(isTarget(el)) stopFieldMarquee(el);
  });
  document.addEventListener("focusout", (event)=>{
    const el = event.target;
    if(isTarget(el)) updateFieldOverflowUX(el);
  });
  document.addEventListener("input", (event)=>{
    const el = event.target;
    if(isTarget(el)) updateFieldOverflowUX(el);
  });
  document.addEventListener("change", (event)=>{
    const el = event.target;
    if(isTarget(el)) updateFieldOverflowUX(el);
  });
  window.addEventListener("resize", ()=>{
    refreshFieldOverflowUX(document);
  });
  refreshFieldOverflowUX(document);
}

function animateOpenCloseHeight(element, expand){
  if(!element) return;
  if(prefersReducedMotion()){
    if(element.tagName && element.tagName.toLowerCase() === "details"){
      element.open = !!expand;
    }
    return;
  }
  const startHeight = element.offsetHeight;
  element.style.height = startHeight + "px";
  element.style.overflow = "hidden";
  element.classList.add("is-collapsing");
  if(element.tagName && element.tagName.toLowerCase() === "details"){
    element.open = !!expand;
  }
  const endHeight = element.scrollHeight;
  requestAnimationFrame(()=>{
    element.style.height = endHeight + "px";
  });
  const cleanup = ()=>{
    element.classList.remove("is-collapsing");
    element.style.height = "";
    element.style.overflow = "";
  };
  const onEnd = (event)=>{
    if(event && event.target !== element) return;
    element.removeEventListener("transitionend", onEnd);
    cleanup();
  };
  element.addEventListener("transitionend", onEnd);
  setTimeout(()=>{
    element.removeEventListener("transitionend", onEnd);
    cleanup();
  }, 320);
}

function initDetailsAnimation(){
  document.querySelectorAll("details").forEach(details=>{
    if(details.dataset.animReady === "1") return;
    details.dataset.animReady = "1";
    const summary = details.querySelector("summary");
    if(!summary) return;
    details.setAttribute("aria-expanded", details.open ? "true" : "false");
    summary.addEventListener("click", (event)=>{
      if(prefersReducedMotion()) return;
      event.preventDefault();
      const willOpen = !details.open;
      animateOpenCloseHeight(details, willOpen);
      details.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });
    details.addEventListener("toggle", ()=>{
      details.setAttribute("aria-expanded", details.open ? "true" : "false");
    });
  });
}

function initCustomCollapsibleAnimation(){
  document.querySelectorAll("[data-collapsible]").forEach(root=>{
    if(root.dataset.animReady === "1") return;
    const toggle = root.querySelector("[data-collapsible-toggle]");
    const body = root.querySelector("[data-collapsible-body]");
    if(!toggle || !body) return;
    root.dataset.animReady = "1";
    const expandedByDefault = root.getAttribute("data-collapsible") !== "closed";
    body.hidden = !expandedByDefault;
    toggle.setAttribute("aria-expanded", expandedByDefault ? "true" : "false");
    toggle.addEventListener("click", ()=>{
      const willExpand = body.hidden;
      if(prefersReducedMotion()){
        body.hidden = !willExpand;
        toggle.setAttribute("aria-expanded", willExpand ? "true" : "false");
        return;
      }
      const startHeight = root.offsetHeight;
      root.style.height = startHeight + "px";
      root.style.overflow = "hidden";
      root.classList.add("is-collapsing");
      body.hidden = !willExpand;
      toggle.setAttribute("aria-expanded", willExpand ? "true" : "false");
      const endHeight = root.scrollHeight;
      requestAnimationFrame(()=>{ root.style.height = endHeight + "px"; });
      const cleanup = ()=>{
        root.classList.remove("is-collapsing");
        root.style.height = "";
        root.style.overflow = "";
      };
      const onEnd = (event)=>{
        if(event && event.target !== root) return;
        root.removeEventListener("transitionend", onEnd);
        cleanup();
      };
      root.addEventListener("transitionend", onEnd);
      setTimeout(()=>{
        root.removeEventListener("transitionend", onEnd);
        cleanup();
      }, 320);
    });
  });
}

function bindStickyResultsOffset(screenSelector, resultsEl){
  if(!resultsEl) return;
  const controls = document.querySelector(`${screenSelector} .search-controls`);
  if(!controls) return;
  const setOffset = ()=>{
    const h = controls.offsetHeight || 0;
    resultsEl.style.setProperty('--search-controls-offset', h + 'px');
  };
  setOffset();
  window.addEventListener('resize', setOffset);
  if(typeof ResizeObserver === "function"){
    const observer = new ResizeObserver(()=> setOffset());
    observer.observe(controls);
  }
}

const mainSearchState = {
  debounceTimer: null,
  requestSeq: 0,
  anyWarmupPromise: null,
  pharmacologyWarmupPromise: null
};

function getSearchGroupDefinition(groupKey){
  return SEARCH_GROUP_DEFINITIONS.find(g => g.key === groupKey) || null;
}

function getSearchDatasetKeysForSelection(groupKey){
  if(groupKey === "all") return ALL_SEARCH_DATASET_KEYS.slice();
  const def = getSearchGroupDefinition(groupKey);
  return def ? def.datasets.slice() : [];
}

const mainSearchService = createSearchService({
  maxResults: SEARCH_MAX_RESULTS,
  languageFieldEquivalents: LANGUAGE_FIELD_EQUIVALENTS,
  userSearchFields: USER_LC_SEARCH_FIELDS,
  normalizeSearchText,
  getLoadedRows: ()=>medicalDataRepository.getLoadedSearchRows(),
  isRowInSelection: (row, selectedGroup)=>medicalDataRepository.isRowInSearchSelection(row, selectedGroup),
  getLocalTerms,
  ensureUserSearchLowercaseCache,
  matchAnyHeader,
  searchPharmacology
});

function collectMainSearchResults(query, selectedGroup, langField, userField){
  return mainSearchService.collectMainSearchResults(query, selectedGroup, langField, userField);
}

function renderMainSearchResults(resultsDiv, results, langField, userField, opts = {}){
  const isLoadingMore = !!opts.isLoadingMore;
  const wasTruncated = !!opts.wasTruncated;
  if(results.length === 0){
    const loadingLine = isLoadingMore ? `<div class="small muted" style="margin-top:6px">${escapeHTML(tOr("loading_more_sources", "Loading more sources..."))}</div>` : "";
    resultsDiv.innerHTML = `${escapeHTML(t('No matching results found.') || 'No matching results found.')}${loadingLine}`;
    return;
  }
  const cards = results.map(item => {
    if(item.kind === "base"){
      return `<div class="result">${renderBaseResult(item.row, langField)}</div>`;
    }
    if(item.kind === "pharmacology"){
      return `<div class="result">${renderPharmacologyResult(item)}</div>`;
    }
    const row = item.row || {};
    const head = (row[userField]||row.latin||row.english||"").trim();
    const def = (row.notes||"").trim();
    return `<div class="result"><div class="result-head"><span class="result-badge term">Term</span></div><strong>${escapeHTML(head)}</strong>${def?`<div class="muted" style="margin-top:6px">${escapeHTML(def)}</div>`:""}
      <div class="kv">
        <div class="k">Latin</div><div class="v">${escapeHTML(row.latin||"")}</div>
        <div class="k">English</div><div class="v">${escapeHTML(row.english||"")}</div>
        <div class="k">German</div><div class="v">${escapeHTML(row.german||"")}</div>
        <div class="k">Slovak</div><div class="v">${escapeHTML(row.slovak||"")}</div>
      </div></div>`;
  }).join("");
  const meta = [
    wasTruncated ? `<div class="small muted" style="margin-top:6px">${escapeHTML(`Showing first ${SEARCH_MAX_RESULTS} results`)}</div>` : "",
    isLoadingMore ? `<div class="small muted" style="margin-top:6px">${escapeHTML(tOr("loading_more_sources", "Loading more sources..."))}</div>` : ""
  ].filter(Boolean).join("");
  resultsDiv.innerHTML = `${cards}${meta}`;
}

function scheduleAnySearchWarmup(runAfterLoad){
  if(mainSearchState.anyWarmupPromise || areAllSearchGroupsLoaded()) return;
  // "Any" mode progressively expands sources in the background to avoid blocking input.
  mainSearchState.anyWarmupPromise = (async ()=>{
    for(const group of SEARCH_GROUP_DEFINITIONS){
      if(isSearchGroupLoaded(group.key)) continue;
      await ensureMedicalDatasetsLoaded(group.datasets);
      if(typeof runAfterLoad === "function"){
        await runAfterLoad();
      }
    }
  })().finally(()=>{
    mainSearchState.anyWarmupPromise = null;
  });
}

function schedulePharmacologyWarmup(runAfterLoad){
  if(mainSearchState.pharmacologyWarmupPromise || pharmacologyState.loaded || pharmacologyState.failed) return;
  mainSearchState.pharmacologyWarmupPromise = ensurePharmacologyIndexLoaded()
    .then(async ()=>{
      if(typeof runAfterLoad === "function"){
        await runAfterLoad();
      }
    })
    .finally(()=>{
      mainSearchState.pharmacologyWarmupPromise = null;
    });
}

async function runMainSearchNow(){
  const searchInput = document.getElementById('search-input');
  const resultsDiv = document.getElementById('search-results');
  const datasetSelect = document.getElementById('search-dataset');
  if(!searchInput || !resultsDiv) return;

  const requestId = ++mainSearchState.requestSeq;
  const q = searchInput.value.trim().toLowerCase();
  const selectedGroup = datasetSelect ? datasetSelect.value : "all";
  resultsDiv.innerHTML = "";
  if(q.length < SEARCH_MIN_QUERY_LEN) return;

  if((selectedGroup === "all" || selectedGroup === "pharmacology") && !pharmacologyState.loaded && !pharmacologyState.failed){
    if(selectedGroup === "pharmacology"){
      resultsDiv.textContent = tOr("loading", "Loading...");
      await ensurePharmacologyIndexLoaded();
      if(requestId !== mainSearchState.requestSeq) return;
    } else {
      schedulePharmacologyWarmup(async ()=>{
        const liveInput = document.getElementById('search-input');
        if(!liveInput) return;
        if(liveInput.value.trim().length >= SEARCH_MIN_QUERY_LEN){
          await runMainSearchNow();
        }
      });
    }
  }

  if(selectedGroup !== "all" && !isSearchGroupLoaded(selectedGroup)){
    resultsDiv.textContent = tOr("loading", "Loading...");
    await ensureMedicalDatasetsLoaded(getSearchDatasetKeysForSelection(selectedGroup));
    if(requestId !== mainSearchState.requestSeq) return;
  }

  const langField = getBaseSearchField();
  const userField = getUserSearchField();
  const { results, truncated } = collectMainSearchResults(q, selectedGroup, langField, userField);
  const loadingMore = selectedGroup === "all" && (!areAllSearchGroupsLoaded() || (!pharmacologyState.loaded && !pharmacologyState.failed));
  renderMainSearchResults(resultsDiv, results, langField, userField, {
    isLoadingMore: loadingMore,
    wasTruncated: truncated
  });

  if(selectedGroup === "all" && loadingMore){
    scheduleAnySearchWarmup(async ()=>{
      const liveInput = document.getElementById('search-input');
      if(!liveInput) return;
      const liveQuery = liveInput.value.trim();
      if(liveQuery.length >= SEARCH_MIN_QUERY_LEN){
        await runMainSearchNow();
      }
    });
    schedulePharmacologyWarmup(async ()=>{
      const liveInput = document.getElementById('search-input');
      if(!liveInput) return;
      const liveQuery = liveInput.value.trim();
      if(liveQuery.length >= SEARCH_MIN_QUERY_LEN){
        await runMainSearchNow();
      }
    });
  }
}

function debounceMainSearch(){
  clearTimeout(mainSearchState.debounceTimer);
  mainSearchState.debounceTimer = setTimeout(()=>{
    runMainSearchNow();
  }, SEARCH_DEBOUNCE_MS);
}

function populateSearchDatasetSelect(){
  const datasetSelect = document.getElementById('search-dataset');
  if(!datasetSelect) return;
  const previous = datasetSelect.value || "all";
  const options = [
    `<option value="all">${escapeHTML(tOr("any", "Any"))}</option>`,
    ...SEARCH_GROUP_DEFINITIONS.map(group => `<option value="${escapeHTML(group.key)}">${escapeHTML(group.label)}</option>`)
  ];
  datasetSelect.innerHTML = options.join("");
  if([...datasetSelect.options].some(option => option.value === previous)){
    datasetSelect.value = previous;
  }
}
/* === NEW: auth UI (cog always visible + header user) === */
function updateAuthUI(){
  const cog = document.getElementById('settings-toggle');
  const headerLoginBtn = document.getElementById('header-login-google');
  const headerAccount = document.getElementById('header-account');
  const headerAccountName = document.getElementById('header-account-name');
  const menuGoogleBtn = document.getElementById('btn-google-drive');
  const menuGuestBtn = document.getElementById('continue-guest');
  const menuContinueBtn = document.getElementById('continue-auth');
  const menuAuthStatus = document.getElementById('google-auth-status');

  const loggedIn = !!state.currentUser;
  const userLabel = String(state.currentUser || state.currentUserEmail || tOr("auth_google_user", "Google user"));
  if(loggedIn){
    if(cog) cog.classList.remove('hidden');
    if(headerLoginBtn) headerLoginBtn.classList.add('hidden');
    if(headerAccount) headerAccount.classList.remove('hidden');
    if(headerAccountName) headerAccountName.textContent = userLabel;
    if(menuGoogleBtn) menuGoogleBtn.classList.add('hidden');
    if(menuGuestBtn) menuGuestBtn.classList.add('hidden');
    if(menuContinueBtn) menuContinueBtn.classList.remove('hidden');
    if(menuAuthStatus) menuAuthStatus.textContent = "";
  } else {
    if(cog) cog.classList.remove('hidden');
    if(headerAccount) headerAccount.classList.add('hidden');
    if(headerAccountName) headerAccountName.textContent = "-";
    if(headerLoginBtn) headerLoginBtn.classList.remove('hidden');
    if(menuGoogleBtn) menuGoogleBtn.classList.remove('hidden');
    if(menuGuestBtn) menuGuestBtn.classList.remove('hidden');
    if(menuContinueBtn) menuContinueBtn.classList.add('hidden');
    if(menuAuthStatus) menuAuthStatus.textContent = "";
    if(headerAccountName) headerAccountName.textContent = "-";
    if(settingsDialogController) settingsDialogController.close();
  }
  refreshStorageSyncUI();
  updateHeaderNavUI();
}

async function logoutToLogin(){
  await signOutGoogleDrive();
  updateAuthUI();
  navStack = [];
  showScreen('screen-menu', { skipNavStack: true });
}

function initialScreenForSection(section){
  return getScreenForRoute(section);
}

async function prepareScreenAfterNavigation(screenId){
  const id = String(screenId || "");
  if(id === "screen-anamnesis"){
    await ensureAnamnesisDictionaryLoaded();
    await ensureAnamnesisRegistryReady();
    return;
  }
  if(id === "screen-search"){
    const ds = document.getElementById('search-dataset');
    if(ds && ds.value === "all") scheduleAnySearchWarmup(async ()=>{});
    else ensureMedicalDatasetsLoaded(getSearchDatasetKeysForSelection(ds ? ds.value : "all"));
    debounceMainSearch();
    return;
  }
  if(id === "screen-lab-parameters"){
    await ensureMedicalDatasetsLoaded([LAB_DATASET_KEY]);
    refreshLabParametersUI();
    return;
  }
  if(id === "screen-pharmacology"){
    await ensurePharmacologyIndexLoaded();
    renderPharmacologyScreenResults();
    return;
  }
  if(id === "screen-latin-terminology"){
    await ensureMedicalDatasetsLoaded([LATIN_DATASET_KEY]);
    refreshLatinTerminologyUI();
    return;
  }
  if(id === "screen-muscle-training"){
    await ensureMusclesLoaded();
    renderMuscleRegionList();
    return;
  }
  if(id === "screen-quiz"){
    await ensureFlashcardsV2DataLoaded();
    renderQuizGeneratorUi();
    renderQuizStudioInsights();
    return;
  }
  if(id === "screen-biophysics-tf"){
    await ensureBiophysicsTfLoaded();
    startBiophysicsTfSession();
    return;
  }
  if(id === "screen-entry"){
    renderEntryHistory();
    renderAttachmentsList();
    return;
  }
  if(id === "screen-flashcards"){
    await ensureFlashcardsV2DataLoaded();
    refreshFlashcardsBuilderUI();
    renderFlashcardsPlayer();
  }
}

async function init(){
  // Optional: refresh base CSV cache (static assets in this build)
  try{ await refreshBaseFilesCache(); }catch(e){ console.warn('Base CSV refresh skipped:', e); }
  applyTheme(localStorage.getItem(APP_THEME_KEY) || "light", { persist: false });
  initAnamnesisPreferences();
  initAnamnesisMobileToolbar();
  syncLayoutMetrics();
  syncTextSizeForViewport({ force: true });
  window.addEventListener("resize", syncLayoutMetrics);
  window.addEventListener("orientationchange", syncLayoutMetrics);
  window.addEventListener("resize", ()=> syncTextSizeForViewport());
  window.addEventListener("orientationchange", ()=> syncTextSizeForViewport());
  window.addEventListener("resize", applyAnamnesisLayoutMode);
  window.addEventListener("orientationchange", applyAnamnesisLayoutMode);
  try{
    await appStorage.init();
    await migrateLegacyFlashcardData();
  }catch(e){
    console.warn("Flashcard storage init failed, flashcards may be limited:", e);
  }
  await loadTranslations();

  // Apply language instantly (no reload needed)
  await setLanguage(state.language);
  initScreenStates();
  initButtonRipples();
  initFieldOverflowUX();
  initDetailsAnimation();
  initCustomCollapsibleAnimation();
  await initAttachmentsFeature();
  const entryCategorySelect = document.getElementById("entry-category");
  const entrySourceSelect = document.getElementById("entry-source");
  if(entryCategorySelect){
    entryCategorySelect.addEventListener("change", async ()=>{ await renderEntryCategoryFields(); });
  }
  if(entrySourceSelect){
    entrySourceSelect.addEventListener("change", async ()=>{ await renderEntryCategoryFields(); });
  }
  await renderEntryCategoryFields();

  // Settings sidebar handling
  const settingsBtn = document.getElementById('settings-toggle');
  const sidebar = document.getElementById('settings-sidebar');
  const overlay = document.getElementById('settings-overlay');
  const settingsClose = document.getElementById('settings-close');

  const appHeader = document.querySelector('header');
  const appMain = document.querySelector('main');
  const appFooter = document.querySelector('.app-copyright');
  if(sidebar && overlay){
    settingsDialogController = createDialogController({
      dialog: sidebar,
      overlay,
      trigger: settingsBtn,
      inertRoots: [appHeader, appMain, appFooter]
    });
  }
  function openSettings(triggerEl = settingsBtn){
    if(settingsDialogController) settingsDialogController.open(triggerEl);
  }
  function closeSettings(){
    if(settingsDialogController) settingsDialogController.close();
  }
  function toggleSettings(triggerEl = settingsBtn){
    if(!sidebar) return;
    if(sidebar.classList.contains('open')) closeSettings();
    else openSettings(triggerEl);
  }

  if(settingsBtn) settingsBtn.addEventListener('click', ()=> toggleSettings(settingsBtn));
  if(overlay) overlay.addEventListener('click', closeSettings);
  if(settingsClose) settingsClose.addEventListener('click', closeSettings);
  const headerBackBtn = document.getElementById('header-back');
  if(headerBackBtn){
    headerBackBtn.addEventListener('click', ()=> goHeaderBack());
  }
  const headerGoogleBtn = document.getElementById('header-login-google');
  if(headerGoogleBtn){
    headerGoogleBtn.addEventListener('click', ()=>{
      requestGoogleAccessTokenFromClick();
    });
  }
  const headerLogoutBtn = document.getElementById('header-logout');
  if(headerLogoutBtn){
    headerLogoutBtn.addEventListener('click', async ()=>{ await logoutToLogin(); });
  }

  function syncMenuLanguageSelection(lang){
    const canonical = normalizeLanguage(lang || state.language);
    document.querySelectorAll('#screen-menu .lang-btn[data-lang]').forEach(btn=>{
      const btnLang = normalizeLanguage(btn.getAttribute('data-lang'));
      btn.classList.toggle('is-selected', btnLang === canonical);
    });
  }

  function setFeedbackStatus(message, isError){
    const status = document.getElementById("feedback-status");
    if(!status) return;
    status.textContent = String(message || "");
    status.style.color = isError ? "#ffd6d6" : "rgba(255,255,255,.9)";
  }

  function prefillFeedbackContact(){
    const contactEl = document.getElementById("feedback-contact");
    if(contactEl && state.currentUserEmail && !String(contactEl.value || "").trim()){
      contactEl.value = String(state.currentUserEmail);
    }
  }

  function initFeedbackForm(){
    const form = document.getElementById("feedback-form");
    if(!form) return;
    const categoryEl = document.getElementById("feedback-type");
    const messageEl = document.getElementById("feedback-message");
    prefillFeedbackContact();
    form.addEventListener("submit", (event)=>{
      event.preventDefault();
      const contactEl = document.getElementById("feedback-contact");
      const category = String(categoryEl && categoryEl.value || "General feedback").trim();
      const contact = String(contactEl && contactEl.value || "").trim();
      const message = String(messageEl && messageEl.value || "").trim();
      if(!message){
        setFeedbackStatus(tOr("feedback_write_message_before_send", "Please write a message before sending."), true);
        if(messageEl) messageEl.focus();
        return;
      }
      const subject = `Medical Dictionary - ${category}`;
      const bodyLines = [
        `Category: ${category}`,
        `Contact email: ${contact || state.currentUserEmail || "not provided"}`,
        `Language: ${normalizeLanguage(state.language)}`,
        `Date: ${new Date().toISOString()}`,
        "",
        "Message:",
        message
      ];
      const mailto = `mailto:medicaldictionaryjlf@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join("\n"))}`;
      window.location.href = mailto;
      setFeedbackStatus(tOr("feedback_opening_mail_app", "Opening your mail app..."), false);
    });
  }

  // Hero language buttons
  document.querySelectorAll('.lang-btn').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      e.preventDefault();
      const lang = btn.getAttribute('data-lang');
      if(btn.closest('#screen-menu')){
        document.querySelectorAll('#screen-menu .lang-btn').forEach(x=>x.classList.remove('is-selected'));
        btn.classList.add('is-selected');
      }
      await setLanguage(lang);
      syncMenuLanguageSelection(lang);
    });
  });
  syncMenuLanguageSelection(state.language);
  initFeedbackForm();

  // Text size selection (7 steps)
  const sizeSlider = document.getElementById('text-size-slider');
  const savedSize = localStorage.getItem(TEXT_SIZE_KEY) || '4';
  applyTextSize(savedSize);
  syncTextSizeForViewport({ force: true });
  if(sizeSlider){
    sizeSlider.value = isPhoneTextSizeViewport() ? String(PHONE_TEXT_SIZE_STEP) : savedSize;
    sizeSlider.addEventListener('input', ()=> applyTextSize(sizeSlider.value));
  }
  const themeLightBtn = document.getElementById("theme-light");
  const themeDarkBtn = document.getElementById("theme-dark");
  refreshThemeButtons();
  if(themeLightBtn){
    themeLightBtn.addEventListener("click", ()=> applyTheme("light", { persist: true }));
  }
  if(themeDarkBtn){
    themeDarkBtn.addEventListener("click", ()=> applyTheme("dark", { persist: true }));
  }

  wireGoogleBtnOnce();

  function openGuestModal(){
    const ov = document.getElementById('guest-overlay');
    if(ov) ov.classList.remove('hidden');
  }
  function closeGuestModal(){
    const ov = document.getElementById('guest-overlay');
    if(ov) ov.classList.add('hidden');
  }

  on('continue-guest','click', ()=> openGuestModal());
  on('continue-auth','click', ()=> showScreen('screen-submenu'));
  on('settings-feedback-open','click', ()=>{
    closeSettings();
    prefillFeedbackContact();
    showScreen('screen-feedback');
  });
  on('guest-back','click', ()=> closeGuestModal());
  on('guest-continue','click', ()=>{
    closeGuestModal();
    showScreen('screen-submenu');
  });
  on('to-search','click', ()=> {
    showScreen('screen-search');
    const datasetSelect = document.getElementById('search-dataset');
    const selectedGroup = datasetSelect ? datasetSelect.value : "all";
    setFeatureStatus('search-results', tOr("loading", "Loading..."), "loading");
    if(selectedGroup === "all"){
      scheduleAnySearchWarmup(async ()=>{});
    } else {
      ensureMedicalDatasetsLoaded(getSearchDatasetKeysForSelection(selectedGroup));
    }
    debounceMainSearch();
  });
  on('to-lab-parameters','click', async ()=> {
    showScreen('screen-lab-parameters');
    setFeatureStatus('lab-parameters-results', tOr("loading", "Loading..."), "loading");
    try{
      await ensureMedicalDatasetsLoaded([LAB_DATASET_KEY]);
      refreshLabParametersUI();
    }catch(e){
      setFeatureStatus('lab-parameters-results', tOr("feature_load_failed", "Failed to load this section."), "error");
    }
  });
  on('to-pharmacology','click', async ()=> {
    showScreen('screen-pharmacology');
    setFeatureStatus('pharmacology-results', tOr("loading", "Loading..."), "loading");
    try{
      await ensurePharmacologyIndexLoaded();
      renderPharmacologyScreenResults();
      if(pharmacologyState.failed){
        setFeatureStatus('pharmacology-results', tOr("feature_load_failed", "Failed to load this section."), "error");
      }
    }catch(e){
      setFeatureStatus('pharmacology-results', tOr("feature_load_failed", "Failed to load this section."), "error");
    }
  });
  on('to-entry','click', ()=> {
    showScreen('screen-entry');
    renderEntryHistory();
  });
  const entryHistoryList = document.getElementById('entry-history-list');
  if(entryHistoryList){
    entryHistoryList.addEventListener('click', async (event)=>{
      const btn = event.target && event.target.closest ? event.target.closest('[data-entry-delete-id]') : null;
      if(!btn) return;
      await deleteEntryHistoryItem(btn.getAttribute('data-entry-delete-id'));
    });
  }
  on('to-latin-terminology','click', async ()=> {
    showScreen('screen-latin-terminology');
    setFeatureStatus('latin-search-results', tOr("loading", "Loading..."), "loading");
    try{
      await ensureMedicalDatasetsLoaded([LATIN_DATASET_KEY]);
      refreshLatinTerminologyUI();
    }catch(e){
      setFeatureStatus('latin-search-results', tOr("feature_load_failed", "Failed to load this section."), "error");
    }
  });
  on('to-quiz','click', async ()=> {
    showScreen('screen-quiz');
    setQuizSetupCollapsed(false);
    const quizScore = document.getElementById('quiz-score');
    if(quizScore) quizScore.textContent = tOr("loading", "Loading...");
    try{
      await ensureFlashcardsV2DataLoaded();
      renderQuizGeneratorUi();
      renderQuizStudioInsights();
    }catch(e){
      if(quizScore) quizScore.textContent = tOr("feature_load_failed", "Failed to load this section.");
    }
  });
  on('to-biophysics-tf','click', async ()=> {
    showScreen('screen-biophysics-tf');
    await ensureBiophysicsTfLoaded();
    startBiophysicsTfSession();
  });
  on('to-flashcards','click', async ()=> {
    showScreen('screen-flashcards');
    setFlashcardsBuilderCollapsed(false);
    const flashcardsMsg = document.getElementById('flashcards-builder-msg');
    if(flashcardsMsg) flashcardsMsg.textContent = tOr("loading", "Loading...");
    try{
      await ensureFlashcardsV2DataLoaded();
      refreshFlashcardsBuilderUI();
      renderFlashcardsPlayer();
    }catch(e){
      if(flashcardsMsg) flashcardsMsg.textContent = tOr("feature_load_failed", "Failed to load this section.");
    }
  });
  on('to-muscle-training','click', async ()=> {
    showScreen('screen-muscle-training');
    setMuscleQuizSetupCollapsed(false);
    setFeatureStatus('muscle-region-list', tOr("loading", "Loading..."), "loading");
    try{
      await ensureMusclesLoaded();
      renderMuscleRegionList();
    }catch(e){
      setFeatureStatus('muscle-region-list', tOr("feature_load_failed", "Failed to load this section."), "error");
    }
  });
  on('to-anamnesis','click', async ()=> {
    showScreen('screen-anamnesis');
    await ensureAnamnesisDictionaryLoaded();
    await ensureAnamnesisRegistryReady();
  });

  const searchInput = document.getElementById('search-input');
  const resultsDiv = document.getElementById('search-results');
  const datasetSelect = document.getElementById('search-dataset');
  const labSearchInput = document.getElementById('lab-parameters-search-input');
  const labResultsDiv = document.getElementById('lab-parameters-results');
  const labAvailableTags = document.getElementById('lab-parameters-tags-available');
  const labClearFiltersBtn = document.getElementById('lab-parameters-clear-filters');
  const pharmacologySearchInput = document.getElementById('pharmacology-search-input');
  const pharmacologyResultsDiv = document.getElementById('pharmacology-results');
  const pharmacologyTree = document.getElementById('pharmacology-atc-tree');
  const pharmacologySelectedFilter = document.getElementById('pharmacology-selected-filter');
  const pharmacologyClearFilterBtn = document.getElementById('pharmacology-clear-filter');

  populateSearchDatasetSelect();

  bindStickyResultsOffset('#screen-search', resultsDiv);
  bindStickyResultsOffset('#screen-lab-parameters', labResultsDiv);
  bindStickyResultsOffset('#screen-pharmacology', pharmacologyResultsDiv);
  if(labSearchInput){
    labSearchInput.addEventListener('input', handleLabSearchInput);
  }
  if(pharmacologySearchInput){
    pharmacologySearchInput.addEventListener('input', handlePharmacologySearchInput);
  }
  if(pharmacologyTree){
    pharmacologyTree.addEventListener('click', (event)=>{
      const target = event.target instanceof Element ? event.target : null;
      if(!target) return;
      const selectBtn = target.closest('[data-atc-select]');
      if(selectBtn){
        selectPharmacologyAtcCode(selectBtn.getAttribute('data-atc-select') || '');
      }
    });
  }
  if(pharmacologySelectedFilter){
    pharmacologySelectedFilter.addEventListener('click', (event)=>{
      const target = event.target instanceof Element ? event.target.closest('[data-atc-select]') : null;
      if(!target) return;
      selectPharmacologyAtcCode(target.getAttribute('data-atc-select') || '');
    });
  }
  if(pharmacologyClearFilterBtn){
    pharmacologyClearFilterBtn.addEventListener('click', clearPharmacologyAtcFilter);
  }
  if(labAvailableTags){
    labAvailableTags.addEventListener('click', (event)=>{
      const btn = event.target instanceof Element ? event.target.closest('[data-tag-key]') : null;
      if(!btn) return;
      toggleLabTag(btn.getAttribute('data-tag-key') || '');
    });
  }
  if(labClearFiltersBtn){
    labClearFiltersBtn.addEventListener('click', clearLabFilters);
  }

  const muscleSearchInput = document.getElementById('muscle-search-input');
  if(muscleSearchInput){
    muscleSearchInput.addEventListener('input', renderMuscleSearchResults);
  }
  const muscleSearchField = document.getElementById('muscle-search-field');
  if(muscleSearchField){
    const savedRaw = localStorage.getItem(MUSCLE_SEARCH_FIELD_KEY);
    const saved = savedRaw === 'type_of_movement' ? 'movement_function' : savedRaw;
    if(saved && [...muscleSearchField.options].some(o=>o.value === saved)){
      muscleSearchField.value = saved;
    }
    muscleSearchField.addEventListener('change', renderMuscleSearchResults);
    muscleSearchField.addEventListener('change', ()=>{
      localStorage.setItem(MUSCLE_SEARCH_FIELD_KEY, muscleSearchField.value);
    });
  }
  onOptional('muscle-quiz-start','click', ()=> startMuscleQuiz());
  onOptional('muscle-quiz-reveal','click', ()=>{ muscleQuizRevealed = true; renderMuscleQuizFields(); });
  onOptional('muscle-quiz-next','click', ()=> showNextMuscle());

  const latinSearchInput = document.getElementById('latin-search-input');
  if(latinSearchInput){
    latinSearchInput.addEventListener('input', renderLatinSearchResults);
  }
  const latinSearchField = document.getElementById('latin-search-field');
  if(latinSearchField){
    latinSearchField.addEventListener('change', ()=>{
      localStorage.setItem(LATIN_SEARCH_FIELD_KEY, latinSearchField.value);
      renderLatinSearchResults();
    });
  }
  const latinSearchPos = document.getElementById('latin-search-pos');
  if(latinSearchPos){
    latinSearchPos.addEventListener('change', ()=>{
      localStorage.setItem(LATIN_SEARCH_POS_KEY, latinSearchPos.value);
      renderLatinSearchResults();
    });
  }
  onOptional('latin-quiz-start','click', ()=> startLatinQuiz());
  onOptional('latin-quiz-reveal','click', ()=>{ latinQuizRevealed = true; renderLatinQuizFields(); });
  onOptional('latin-quiz-next','click', ()=> showNextLatinTerm());

  const anamForm = document.getElementById('anamnesis-form');
  if(anamForm){
    initializeAnamnesisRegistry();
    initAnamnesisRepeaters(null);
    initAnamnesisNotesDrawer();
    syncAnamnesisMobileToolbar();
    updateGynecologicalVisibility(anamForm);
    anamForm.addEventListener('input', (event)=>{
      const target = event.target instanceof HTMLElement ? event.target : null;
      const targetName = target && "name" in target ? String(target.name || "") : "";
      if(targetName === "ident_dob"){
        syncAgeFromDob(anamForm);
      }
      if(targetName === "ident_sex"){
        updateGynecologicalVisibility(anamForm);
      }
      if(targetName === "ident_full_name" || targetName === "chief_complaint" || targetName === "ident_age"){
        syncInternalFormToMeta(targetName);
        updateAnamnesisMobileHeaderPreview();
      }
      scheduleAnamnesisSave();
    });
    anamForm.addEventListener('change', (event)=>{
      const target = event.target instanceof HTMLElement ? event.target : null;
      const targetName = target && "name" in target ? String(target.name || "") : "";
      if(targetName === "ident_dob"){
        syncAgeFromDob(anamForm);
      }
      if(targetName === "ident_sex"){
        updateGynecologicalVisibility(anamForm);
      }
      scheduleAnamnesisSave();
    });
  }
  const anamMetaType = document.getElementById("anamnesis-patient-type");
  if(anamMetaType){
    anamMetaType.addEventListener("change", async ()=>{
      updateAnamnesisMobileHeaderPreview();
      await handleAnamnesisTypeChange(anamMetaType.value);
    });
  }
  const anamLayoutMode = document.getElementById("anamnesis-layout-mode");
  if(anamLayoutMode){
    anamLayoutMode.value = anamnesisLayoutMode;
    anamLayoutMode.addEventListener("change", ()=>{
      setAnamnesisLayoutMode(anamLayoutMode.value);
    });
  }
  const anamInputMode = document.getElementById("anamnesis-input-mode");
  if(anamInputMode){
    anamInputMode.value = anamnesisInputMode;
    anamInputMode.addEventListener("change", ()=>{
      setAnamnesisInputMode(anamInputMode.value);
    });
  }
  on('anamnesis-save', 'click', ()=> saveAnamnesisForm());
  on('anamnesis-show-patients', 'click', ()=> showAnamnesisPatientListView({ focus: true }));
  onOptional('anamnesis-mobile-save', 'click', ()=> saveAnamnesisForm());
  onOptional('anamnesis-mobile-back', 'click', ()=> showAnamnesisPatientListView({ focus: true }));
  on('anamnesis-add-patient', 'click', ()=>{
    const modal = document.getElementById("anamnesis-patient-modal");
    if(modal){
      modal.classList.remove("hidden");
      modal.setAttribute("aria-hidden", "false");
    }
  });
  on('anamnesis-modal-cancel', 'click', ()=>{
    const modal = document.getElementById("anamnesis-patient-modal");
    if(modal){
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
    }
  });
  on('anamnesis-modal-create', 'click', async ()=>{
    const typeEl = document.getElementById("anamnesis-new-type");
    await createAnamnesisPatientRecord({
      anamnesisType: typeEl ? typeEl.value : "internal"
    });
    [typeEl].forEach(el=>{
      if(!el) return;
      if(el.tagName && el.tagName.toLowerCase() === "select") el.value = "psychiatric";
      else el.value = "";
    });
    const modal = document.getElementById("anamnesis-patient-modal");
    if(modal){
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
    }
  });
  const anamnesisPatientModal = document.getElementById("anamnesis-patient-modal");
  if(anamnesisPatientModal){
    anamnesisPatientModal.addEventListener("click", (event)=>{
      if(event.target !== anamnesisPatientModal) return;
      anamnesisPatientModal.classList.add("hidden");
      anamnesisPatientModal.setAttribute("aria-hidden", "true");
    });
  }
  bindAllAnamnesisRepeaterButtons();
  document.querySelectorAll('input[name="pmh_planned_op"]').forEach(el=>{
    el.addEventListener('change', ()=>{
      updatePlannedOperationVisibility();
      scheduleAnamnesisSave();
    });
  });
  document.querySelectorAll('input[name="med_misuse"]').forEach(el=>{
    el.addEventListener('change', ()=>{
      updateMedicationConditionalVisibility();
      scheduleAnamnesisSave();
    });
  });
  document.querySelectorAll('input[name="med_otc"]').forEach(el=>{
    el.addEventListener('change', ()=>{
      updateMedicationDetailsVisibility();
      scheduleAnamnesisSave();
    });
  });
  document.querySelectorAll('input[name="med_supplements"]').forEach(el=>{
    el.addEventListener('change', ()=>{
      updateMedicationDetailsVisibility();
      scheduleAnamnesisSave();
    });
  });
  document.querySelectorAll('input[name="blood_transfusion"]').forEach(el=>{
    el.addEventListener('change', ()=>{
      updateBloodTransfusionVisibility();
      scheduleAnamnesisSave();
    });
  });
  document.querySelectorAll('input[name="blood_transfusion_reaction"]').forEach(el=>{
    el.addEventListener('change', ()=>{
      updateBloodTransfusionVisibility();
      scheduleAnamnesisSave();
    });
  });
  document.querySelectorAll('input[name="hpi_radiation"]').forEach(el=>{
    el.addEventListener('change', ()=>{
      updateHpiRadiationVisibility();
      scheduleAnamnesisSave();
    });
  });
  ['social-house','social-flat','social-homeless'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.addEventListener('change', ()=>{
      normalizeHousingSelection(id);
      updateHousingVisibility();
      scheduleAnamnesisSave();
    });
  });
  ['social_working','social_retired','social_unemployed'].forEach(name=>{
    const el = document.querySelector(`input[name="${name}"]`);
    if(el) el.addEventListener('change', ()=>{
      normalizeEmploymentSelection(name);
      scheduleAnamnesisSave();
    });
  });
  ['social_single','social_married','social_divorced','social_widowed'].forEach(name=>{
    const el = document.querySelector(`input[name="${name}"]`);
    if(el) el.addEventListener('change', ()=>{
      normalizeMaritalSelection(name);
      scheduleAnamnesisSave();
    });
  });
  ['social_alone','social_family'].forEach(name=>{
    const el = document.querySelector(`input[name="${name}"]`);
    if(el) el.addEventListener('change', ()=>{
      normalizeLivingSelection(name);
      scheduleAnamnesisSave();
    });
  });
  ['family_parents_both','family_parents_one','family_parents_none'].forEach(name=>{
    const el = document.querySelector(`input[name="${name}"]`);
    if(el) el.addEventListener('change', ()=>{
      normalizeParentsAliveSelection(name);
      scheduleAnamnesisSave();
    });
  });
  const notesText = document.getElementById("anamnesis-notes-text");
  if(notesText) notesText.addEventListener("input", scheduleAnamnesisSave);

  on('anamnesis-clear','click', ()=>{
    if(confirm(tOr("anamnesis_clear_confirm", "Clear the whole anamnesis form? This cannot be undone."))){
      clearAnamnesisForm();
    }
  });

  if(datasetSelect && searchInput){
    datasetSelect.addEventListener('change', ()=>{
      const selectedGroup = datasetSelect.value || "all";
      if(selectedGroup !== "all"){
        ensureMedicalDatasetsLoaded(getSearchDatasetKeysForSelection(selectedGroup));
        if(selectedGroup === "pharmacology"){
          ensurePharmacologyIndexLoaded();
        }
      } else {
        scheduleAnySearchWarmup(async ()=>{});
        schedulePharmacologyWarmup(async ()=>{});
      }
      debounceMainSearch();
    });
  }

  if(searchInput && resultsDiv){
    searchInput.addEventListener('input', debounceMainSearch);
  }
  const searchFilterChips = document.querySelectorAll('[data-search-dataset]');
  if(searchFilterChips.length && datasetSelect){
    const syncSearchFilterChips = ()=>{
      const current = String(datasetSelect.value || "all");
      searchFilterChips.forEach(btn => {
        const active = String(btn.getAttribute('data-search-dataset') || "") === current;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    };
    syncSearchFilterChips();
    searchFilterChips.forEach(btn => {
      btn.addEventListener('click', ()=>{
        const next = String(btn.getAttribute('data-search-dataset') || "");
        if(!next) return;
        datasetSelect.value = next;
        syncSearchFilterChips();
        runMainSearchNow();
      });
    });
    datasetSelect.addEventListener('change', syncSearchFilterChips);
  }


  on('save-term','click', async ()=>{
    const fields = [...document.querySelectorAll('#entry-dynamic-fields [data-entry-col]')];
    const rowValues = {};
    for(const el of fields){
      const key = String(el.getAttribute("data-entry-col") || "").trim();
      if(!key) continue;
      rowValues[key] = String(el.value || "").trim();
    }
    const category = getEntryCategory();
    const sourceDataset = getEntrySelectedDatasetKey();
    const adapter = getDatasetAdapterByKey(sourceDataset);
    const pickFromAliases = (aliases)=>{
      const list = Array.isArray(aliases) ? aliases : [aliases];
      for(const col of list){
        const key = String(col || "").trim();
        if(!key) continue;
        const value = String(rowValues[key] || "").trim();
        if(value) return value;
      }
      return "";
    };
    const english = pickFromAliases(adapter && adapter.columns ? adapter.columns.en : []);
    const german = pickFromAliases(adapter && adapter.columns ? adapter.columns.de : []);
    const slovak = pickFromAliases(adapter && adapter.columns ? adapter.columns.sk : []);
    const latin = pickFromAliases(adapter && adapter.columns ? adapter.columns.la : []);
    const defText = pickFromAliases(adapter && adapter.columns ? adapter.columns.definition : []);
    const notesText = pickFromAliases(adapter && adapter.columns ? adapter.columns.notes : []);
    const notesWithCategory = [defText, notesText].filter(Boolean).join("\n\n");
    const hasAnyValue = Object.values(rowValues).some(v => !!String(v || "").trim());
    if(!hasAnyValue){
      const em = document.getElementById('entry-msg');
      if(em) em.textContent = "Fill at least one field before saving.";
      return;
    }

    const term = {
      id: (typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function")
        ? `term:${crypto.randomUUID()}`
        : `term:${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`,
      english,
      german,
      latin,
      slovak,
      notes: notesWithCategory,
      source_dataset: sourceDataset || category,
      category,
      category_fields: rowValues,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    if(isProfileSessionActive()){
      upsertProfileTermFromRow(term);
      await saveUserProfileNow("save_term");
    } else {
      const terms = getLocalTerms();
      terms.unshift(term);
      setLocalTerms(terms);
    }

    const em = document.getElementById('entry-msg');
    if(em){
      em.textContent = isProfileSessionActive()
        ? ((t('Term saved successfully!') || 'Term saved successfully!') + ' (Google Drive)')
        : ((t('Term saved successfully!') || 'Term saved successfully!') + ' (guest)');
    }
    renderEntryHistory();
    fields.forEach(f=>{ f.value=''; });
    await renderEntryCategoryFields();
  });

  on('start-quiz','click', ()=> startQuiz());
  on('end-quiz','click', ()=> {
    quizEngine.finishQuiz();
    setQuizSetupCollapsed(false);
    renderQuizUI();
    saveUserProfileNow("quiz_end");
  });
  on('quiz-preset-balanced','click', ()=> applyQuizStudioPreset('balanced'));
  on('quiz-preset-exam','click', ()=> applyQuizStudioPreset('exam'));
  on('quiz-preset-speed','click', ()=> applyQuizStudioPreset('speed'));
  on('quiz-preset-recovery','click', ()=> applyQuizStudioPreset('recovery'));
  on('quiz-studio-retry-last-wrong','click', ()=> retryLastWrongTermsFromStudio());
  on('quiz-studio-review-last-wrong','click', ()=> addWrongTermsToReviewList());
  on('quiz-settings-toggle','click', ()=> setQuizSetupCollapsed(false));
  on('quiz-builder-toggle','click', ()=> setQuizSetupCollapsed(false));
  on('quiz-preview-stage','click', ()=>{
    setQuizSetupCollapsed(true);
    renderQuizUI();
  });
  on('flashcards-builder-toggle','click', ()=> setFlashcardsBuilderCollapsed(false));
  on('flashcards-preview-player','click', ()=> setFlashcardsBuilderCollapsed(true));
  onOptional('muscle-quiz-settings-toggle','click', ()=> setMuscleQuizSetupCollapsed(false));
  on('biophysics-answer-true','click', ()=> answerBiophysicsTf(true));
  on('biophysics-answer-false','click', ()=> answerBiophysicsTf(false));
  on('biophysics-tf-next','click', ()=> nextBiophysicsTfQuestion());
  on('biophysics-tf-restart','click', async ()=> {
    if(!confirm("Do you really want to restart this session?")) return;
    await ensureBiophysicsTfLoaded();
    startBiophysicsTfSession();
  });
  const biophysicsAutoNext = document.getElementById('biophysics-tf-auto-next');
  if(biophysicsAutoNext){
    biophysicsAutoNext.checked = getBiophysicsTfAutoNextEnabled();
    biophysicsAutoNext.addEventListener('change', ()=>{
      setBiophysicsTfAutoNextEnabled(!!biophysicsAutoNext.checked);
    });
  }
  if(document.getElementById('flashcard-back')){
    on('flashcard-back','click', ()=> showScreen('screen-submenu'));
  }
  document.addEventListener('keydown', handleQuizKeyboardShortcuts);
  document.addEventListener('keydown', handleBiophysicsTfKeyboard);

  updateAuthUI();
  refreshLabParametersUI();
  initQuizGeneratorUI();
  renderQuizStudioInsights();
  renderQuizUI();
  initFlashcardsV2();

  const savedSession = sessionStorage.getItem(NAV_SESSION_KEY) || "";
  const route = getRouteFromLocation();
  const start =
    route ? getScreenForRoute(route) :
    (savedSession && document.getElementById(savedSession)) ? savedSession :
    "screen-menu";

  showScreen(start, { replaceHistory: true, skipNavStack: true });
  await prepareScreenAfterNavigation(start);
  applyTranslationsToDom();
}


const QUIZ_PROGRESS_KEY = "quiz/progress_v1";
const QUIZ_SESSIONS_KEY = "quiz/sessions_v1";
const QUIZ_CUSTOM_KEY = "quiz/custom_quizzes_v1";
const QUIZ_SCREEN_MODE_KEY = "quiz/screen_mode_v1";
const QUIZ_MAX_SESSIONS = 100;
let quizLastFinishedState = null;
let quizBuilderEditingId = null;
let quizBuilderSelectedIds = new Set();
let quizBuilderDomainKey = "";
let quizBuilderSubdivision1 = "";
let quizBuilderSubdivision2 = "";
let quizBuilderFrontFieldKey = "";
let quizBuilderBackFieldKey = "";
let quizGeneratorDomainKey = "";
let quizGeneratorSubdivision1 = [];
let quizGeneratorSubdivision2 = [];
let quizGeneratorFrontFieldKey = "";
let quizGeneratorBackFieldKey = "";

function getQuizScreenMode(){
  return "studio";
}

function setQuizScreenMode(mode){
  const studioSection = document.getElementById("quiz-studio-section");
  localStorage.setItem(QUIZ_SCREEN_MODE_KEY, "studio");
  if(studioSection) studioSection.classList.remove("hidden");
}

function genId(prefix){
  if(typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function"){
    return `${prefix}${crypto.randomUUID()}`;
  }
  return `${prefix}${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

function readCustomQuizzes(){
  if(isProfileSessionActive()){
    const data = userProfile.learning.custom_quizzes || { items: [] };
    if(!Array.isArray(data.items)) data.items = [];
    data.items = data.items.filter(x => x && typeof x === "object");
    return deepClone(data);
  }
  const data = readJsonLS(QUIZ_CUSTOM_KEY, { items: [] }) || { items: [] };
  if(!Array.isArray(data.items)) data.items = [];
  data.items = data.items.filter(x => x && typeof x === "object");
  return data;
}

function writeCustomQuizzes(data){
  const normalized = data || { items: [] };
  if(isProfileSessionActive()){
    userProfile.learning.custom_quizzes = {
      items: Array.isArray(normalized.items) ? normalized.items.filter(x => x && typeof x === "object") : []
    };
    markProfileDirty();
    return;
  }
  writeJsonLS(QUIZ_CUSTOM_KEY, normalized);
}

function toCategoryFilters(raw){
  const text = String(raw || "").trim();
  if(!text) return [];
  return text.split(",").map(x => x.trim()).filter(Boolean);
}

function getQuizBuilderFieldQueryFromForm(){
  return {
    domainKey: String(quizBuilderDomainKey || ""),
    subdivision1: String(quizBuilderSubdivision1 || ""),
    subdivision2: String(quizBuilderSubdivision2 || ""),
    frontFieldKey: String(document.getElementById("qb-front-field")?.value || quizBuilderFrontFieldKey || ""),
    backFieldKey: String(document.getElementById("qb-back-field")?.value || quizBuilderBackFieldKey || "")
  };
}

function getQuizBuilderPairKeysFromQuery(fieldQuery){
  const q = fieldQuery || {};
  const domain = String(q.domainKey || "domain");
  const front = String(q.frontFieldKey || "front");
  const back = String(q.backFieldKey || "back");
  return {
    fromField: `field:${domain}:${front}`,
    toField: `field:${domain}:${back}`
  };
}

function getQuizBuilderPairKeysFromForm(){
  return getQuizBuilderPairKeysFromQuery(getQuizBuilderFieldQueryFromForm());
}

function makeDomainFieldPairKey(domainKey, fieldKey){
  return `field:${String(domainKey || "").trim()}:${String(fieldKey || "").trim()}`;
}

function parseDomainFieldPairKey(value){
  const raw = String(value || "");
  if(!raw.startsWith("field:")) return null;
  const parts = raw.split(":");
  if(parts.length < 3) return null;
  return {
    domainKey: String(parts[1] || "").trim(),
    fieldKey: String(parts.slice(2).join(":") || "").trim()
  };
}

function buildQuizCandidatesFromFieldQuery(fieldQuery){
  const q = fieldQuery || {};
  if(!flashcardsV2State.loaded) return [];
  const domainKey = String(q.domainKey || "").trim();
  if(!domainKey) return [];
  const adapter = flashcardsV2State.adapterByKey.get(domainKey);
  if(!adapter) return [];
  const frontField = adapter.fieldByKey.get(String(q.frontFieldKey || ""));
  const backField = adapter.fieldByKey.get(String(q.backFieldKey || ""));
  if(!frontField || !backField) return [];
  const queryForSubdivision = {
    subdivision1: q.subdivision1 || "",
    subdivision2: q.subdivision2 || []
  };
  const out = [];
  for(const row of flashcardsV2State.allTerms){
    if(!row || String(row._domain || "") !== domainKey) continue;
    if(!matchesFlashcardsSubdivision(row, adapter, queryForSubdivision)) continue;
    const fromTerm = String(frontField.getValue(row) || "").trim();
    const toTerm = String(backField.getValue(row) || "").trim();
    if(!fromTerm || !toTerm || fromTerm === toTerm) continue;
    out.push({
      termId: String(row._id || ""),
      fromTerm,
      toTerm,
      sourceType: "base",
      sourceDataset: domainKey,
      category: adapter.label || domainKey,
      hasDefinition: hasAnyDefinition(row),
      baseTermKey: String(row._id || ""),
      userTermId: null
    });
  }
  return out;
}

function renderQuizBuilderDomainUi(){
  const domainsEl = document.getElementById("qb-domains");
  const subWrap = document.getElementById("qb-subdivision-wrap");
  const sub1Label = document.getElementById("qb-subdivision1-label");
  const sub1Sel = document.getElementById("qb-subdivision1");
  const sub2Wrap = document.getElementById("qb-subdivision2-wrap");
  const sub2Label = document.getElementById("qb-subdivision2-label");
  const sub2Sel = document.getElementById("qb-subdivision2");
  const frontSel = document.getElementById("qb-front-field");
  const backSel = document.getElementById("qb-back-field");
  if(!domainsEl || !subWrap || !sub1Label || !sub1Sel || !sub2Wrap || !sub2Label || !sub2Sel || !frontSel || !backSel) return;
  if(!flashcardsV2State.loaded) return;

  if(!quizBuilderDomainKey && flashcardsV2State.adapters.length){
    quizBuilderDomainKey = flashcardsV2State.adapters[0].key;
  }

  domainsEl.innerHTML = flashcardsV2State.adapters.map(adapter => {
    const checked = adapter.key === quizBuilderDomainKey ? " checked" : "";
    return `<label class="checkbox-item"><input type="radio" name="qb-domain" data-qb-domain="${escapeHTML(adapter.key)}"${checked} /> ${escapeHTML(localizeDatasetLabel(adapter.key, adapter.label))}</label>`;
  }).join("");

  const adapter = flashcardsV2State.adapterByKey.get(quizBuilderDomainKey);
  const cfg = getFlashcardsSubdivisionConfig(adapter);
  const domainRows = flashcardsV2State.allTerms.filter(row => row && row._domain === quizBuilderDomainKey);
  if(!cfg){
    subWrap.classList.add("hidden");
    sub2Wrap.classList.add("hidden");
    quizBuilderSubdivision1 = "";
    quizBuilderSubdivision2 = "";
  } else {
    subWrap.classList.remove("hidden");
    sub1Label.textContent = cfg.level1 ? cfg.level1.label : tOr("quiz_subdivision", "Subdivision");
    const opts1 = cfg.level1 ? getSubdivisionOptions(adapter, cfg.level1.key, domainRows) : [];
    sub1Sel.innerHTML = [`<option value="">${escapeHTML(tOr("any", "Any"))}</option>`, ...opts1.map(v => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`)].join("");
    if(opts1.includes(quizBuilderSubdivision1)) sub1Sel.value = quizBuilderSubdivision1;
    else { quizBuilderSubdivision1 = ""; sub1Sel.value = ""; }

    if(cfg.level2){
      sub2Wrap.classList.remove("hidden");
      sub2Label.textContent = cfg.level2.label;
      const rows2 = quizBuilderSubdivision1
        ? domainRows.filter(row => {
            const c1 = adapter.columns[cfg.level1.key];
            return String(row[c1] || "").trim() === quizBuilderSubdivision1;
          })
        : domainRows;
      const opts2 = getSubdivisionOptions(adapter, cfg.level2.key, rows2);
      sub2Sel.innerHTML = [`<option value="">${escapeHTML(tOr("any", "Any"))}</option>`, ...opts2.map(v => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`)].join("");
      if(opts2.includes(quizBuilderSubdivision2)) sub2Sel.value = quizBuilderSubdivision2;
      else { quizBuilderSubdivision2 = ""; sub2Sel.value = ""; }
    } else {
      sub2Wrap.classList.add("hidden");
      quizBuilderSubdivision2 = "";
    }
  }

  const fieldOptions = getFieldOptionsForDomains([quizBuilderDomainKey]);
  frontSel.innerHTML = fieldOptions.map(opt => `<option value="${escapeHTML(opt.key)}">${escapeHTML(opt.label)}</option>`).join("");
  backSel.innerHTML = fieldOptions.map(opt => `<option value="${escapeHTML(opt.key)}">${escapeHTML(opt.label)}</option>`).join("");
  const keys = fieldOptions.map(opt => opt.key);
  if(!keys.includes(quizBuilderFrontFieldKey)) quizBuilderFrontFieldKey = keys[0] || "";
  if(!keys.includes(quizBuilderBackFieldKey) || quizBuilderBackFieldKey === quizBuilderFrontFieldKey){
    quizBuilderBackFieldKey = keys.find(k => k !== quizBuilderFrontFieldKey) || quizBuilderFrontFieldKey || "";
  }
  if(quizBuilderFrontFieldKey) frontSel.value = quizBuilderFrontFieldKey;
  if(quizBuilderBackFieldKey) backSel.value = quizBuilderBackFieldKey;
}

function getQuizBuilderConfigFromForm(){
  const fieldQuery = getQuizBuilderFieldQueryFromForm();
  const pair = getQuizBuilderPairKeysFromQuery(fieldQuery);
  const quizType = document.getElementById("qb-type")?.value || "multiple_choice";
  return {
    quizId: quizBuilderEditingId || genId("quiz:"),
    name: String(document.getElementById("qb-name")?.value || "").trim(),
    description: String(document.getElementById("qb-description")?.value || "").trim(),
    type: ["multiple_choice", "matching", "typing"].includes(quizType) ? quizType : "multiple_choice",
    fromField: pair.fromField,
    toField: pair.toField,
    termIds: [],
    filters: {
      fieldQuery,
      sourcePreset: getQuizBuilderSourcePreset(),
      targetCount: getQuizBuilderTargetCount(),
      shufflePool: !!document.getElementById("qb-shuffle-pool")?.checked
    }
  };
}

function applyQuizBuilderConfigToForm(cfg){
  if(!cfg) return;
  const type = String(cfg.type || "multiple_choice");
  const name = String(cfg.name || "");
  const description = String(cfg.description || "");
  const sourcePreset = String((cfg.filters && cfg.filters.sourcePreset) || "all");
  const targetCount = String((cfg.filters && cfg.filters.targetCount) || "20");
  const shufflePool = !cfg.filters || !Object.prototype.hasOwnProperty.call(cfg.filters, "shufflePool") ? true : !!cfg.filters.shufflePool;

  const setValue = (id, val)=>{
    const el = document.getElementById(id);
    if(el) el.value = val;
  };
  setValue("qb-name", name);
  setValue("qb-description", description);
  setValue("qb-type", type);
  setValue("qb-source-preset", sourcePreset);
  setValue("qb-target-count", targetCount);
  const shuffleEl = document.getElementById("qb-shuffle-pool");
  if(shuffleEl) shuffleEl.checked = shufflePool;

  let fq = (cfg.filters && cfg.filters.fieldQuery) || {};
  if(!fq || !fq.domainKey){
    const parsedFrom = parseDomainFieldPairKey(cfg.fromField);
    const parsedTo = parseDomainFieldPairKey(cfg.toField);
    if(parsedFrom && parsedTo && parsedFrom.domainKey === parsedTo.domainKey){
      fq = {
        domainKey: parsedFrom.domainKey,
        subdivision1: "",
        subdivision2: "",
        frontFieldKey: parsedFrom.fieldKey,
        backFieldKey: parsedTo.fieldKey
      };
    }
  }
  quizBuilderDomainKey = String(fq.domainKey || quizBuilderDomainKey || "");
  quizBuilderSubdivision1 = String(fq.subdivision1 || "");
  quizBuilderSubdivision2 = String(fq.subdivision2 || "");
  quizBuilderFrontFieldKey = String(fq.frontFieldKey || "");
  quizBuilderBackFieldKey = String(fq.backFieldKey || "");
  renderQuizBuilderDomainUi();

  const quizTypeSel = document.getElementById("quiz-type");
  if(quizTypeSel) quizTypeSel.value = type;
  const fromSel = document.getElementById("quiz-from");
  if(fromSel) fromSel.value = String(cfg.fromField || "");
  const toSel = document.getElementById("quiz-to");
  if(toSel) toSel.value = String(cfg.toField || "");
  const qbFrom = document.getElementById("qb-from");
  if(qbFrom) qbFrom.value = String(cfg.fromField || "");
  const qbTo = document.getElementById("qb-to");
  if(qbTo) qbTo.value = String(cfg.toField || "");

  quizBuilderEditingId = String(cfg.quizId || "");
}

function getWrongTermIdsForPair(fromField, toField){
  const data = progressStore._readProgress();
  const terms = Object.values(data.terms || {}).filter(row => {
    if(!row) return false;
    if(String(row.fromField || "") !== String(fromField || "")) return false;
    if(String(row.toField || "") !== String(toField || "")) return false;
    return Number(row.wrong || 0) > 0;
  });
  terms.sort((a, b) => Number(b.wrong || 0) - Number(a.wrong || 0));
  return [...new Set(terms.map(row => String(row.termId || "").trim()).filter(Boolean))];
}

function getReviewTermIdsForCandidates(candidates){
  const review = getLocalReview();
  const wanted = new Set(review.map(item => `${String(item.base_term_key || "")}|${String(item.base_dataset || "")}|${String(item.user_term_id || "")}`));
  return candidates
    .filter(candidate => wanted.has(`${String(candidate.baseTermKey || "")}|${String(candidate.sourceDataset || "")}|${String(candidate.userTermId || "")}`))
    .map(candidate => String(candidate.termId || "").trim())
    .filter(Boolean);
}

function getQuizBuilderSourcePreset(){
  const raw = String(document.getElementById("qb-source-preset")?.value || "all").trim().toLowerCase();
  return ["all", "starred", "wrong", "review"].includes(raw) ? raw : "all";
}

function getQuizBuilderTargetCount(){
  const n = Number(document.getElementById("qb-target-count")?.value || 20);
  return Math.max(1, Math.min(200, Number.isFinite(n) ? n : 20));
}

function applyQuizBuilderSourcePreset(candidates, sourcePreset, fromField, toField){
  const preset = String(sourcePreset || "all").trim().toLowerCase();
  if(preset === "starred"){
    return candidates.filter(c => progressStore.isStarred(c.termId));
  }
  if(preset === "wrong"){
    const wrongIds = new Set(getWrongTermIdsForPair(fromField, toField));
    return candidates.filter(c => wrongIds.has(c.termId));
  }
  if(preset === "review"){
    const reviewIds = new Set(getReviewTermIdsForCandidates(candidates));
    return candidates.filter(c => reviewIds.has(c.termId));
  }
  return candidates;
}

function buildQuizBuilderResolvedRows(){
  const fieldQuery = getQuizBuilderFieldQueryFromForm();
  const pair = getQuizBuilderPairKeysFromQuery(fieldQuery);
  const fromField = pair.fromField || (document.getElementById("qb-from")?.value || "english_translation");
  const toField = pair.toField || (document.getElementById("qb-to")?.value || "latin_translation");
  const sourcePreset = getQuizBuilderSourcePreset();
  const targetCount = getQuizBuilderTargetCount();
  const shufflePool = !!document.getElementById("qb-shuffle-pool")?.checked;
  let candidates = (fieldQuery.domainKey && fieldQuery.frontFieldKey && fieldQuery.backFieldKey)
    ? buildQuizCandidatesFromFieldQuery(fieldQuery)
    : buildQuizCandidates(fromField, toField);
  candidates = applyQuizBuilderSourcePreset(candidates, sourcePreset, fromField, toField);
  if(shufflePool) shuffle(candidates);
  const rows = candidates.slice(0, targetCount);
  return {
    fromField,
    toField,
    fieldQuery,
    sourcePreset,
    targetCount,
    shufflePool,
    candidates,
    rows
  };
}

function setQuizBuilderMessage(text){
  const msg = document.getElementById("qb-msg");
  if(msg) msg.textContent = text || "";
}

function renderQuizBuilderSavedList(){
  const sel = document.getElementById("qb-saved-select");
  if(!sel) return;
  const items = readCustomQuizzes().items || [];
  const options = ['<option value="">Select saved quiz</option>']
    .concat(items.map(item => `<option value="${escapeHTML(String(item.quizId || ""))}">${escapeHTML(String(item.name || "Untitled quiz"))}</option>`));
  sel.innerHTML = options.join("");
  if(quizBuilderEditingId){
    sel.value = quizBuilderEditingId;
  }
}

function renderQuizBuilderPreview(){
  const countEl = document.getElementById("qb-preview-count");
  const summaryEl = document.getElementById("qb-preview-summary");
  const listEl = document.getElementById("qb-preview-list");
  if(!countEl && !summaryEl && !listEl) return;
  const resolved = buildQuizBuilderResolvedRows();
  const sourceLabelMap = {
    all: "All matching",
    starred: "Starred",
    wrong: "Wrong terms",
    review: "Review list"
  };
  const typeLabelMap = {
    multiple_choice: "Multiple choice",
    matching: "Matching",
    typing: "Typing"
  };
  const adapter = flashcardsV2State.adapterByKey.get(String(resolved.fieldQuery?.domainKey || ""));
  const scopeBits = [adapter ? localizeDatasetLabel(adapter.key, adapter.label) : "No domain"];
  if(resolved.fieldQuery?.subdivision1) scopeBits.push(formatSubdivisionSelection(resolved.fieldQuery.subdivision1));
  if(resolved.fieldQuery?.subdivision2) scopeBits.push(formatSubdivisionSelection(resolved.fieldQuery.subdivision2));
  const type = String(document.getElementById("qb-type")?.value || "multiple_choice");
  if(countEl){
    countEl.textContent = `${resolved.rows.length} ready now | ${resolved.candidates.length} matching terms`;
  }
  if(summaryEl){
    summaryEl.textContent = `${scopeBits.join(" / ")} | ${sourceLabelMap[resolved.sourcePreset] || "All matching"} | ${typeLabelMap[type] || "Multiple choice"}`;
  }
  if(listEl){
    if(resolved.rows.length === 0){
      listEl.innerHTML = '<div class="muted">No terms match this preset yet.</div>';
    } else {
      listEl.innerHTML = resolved.rows.slice(0, 8).map(row => `
        <div class="quiz-builder-preview-item">
          <strong>${escapeHTML(row.fromTerm || "")}</strong>
          <div class="small">${escapeHTML(row.toTerm || "")}</div>
        </div>
      `).join("");
    }
  }
}

function resetQuizBuilderForm(){
  quizBuilderEditingId = null;
  if(flashcardsV2State.adapters.length){
    quizBuilderDomainKey = flashcardsV2State.adapters[0].key;
  }
  quizBuilderSubdivision1 = "";
  quizBuilderSubdivision2 = "";
  quizBuilderFrontFieldKey = "";
  quizBuilderBackFieldKey = "";
  applyQuizBuilderConfigToForm({
    quizId: "",
    name: "",
    description: "",
    type: "multiple_choice",
    fromField: "",
    toField: "",
    termIds: [],
    filters: { fieldQuery: {}, sourcePreset: "all", targetCount: 20, shufflePool: true }
  });
  setQuizBuilderMessage("");
  renderQuizBuilderSavedList();
  renderQuizBuilderPreview();
}

function refreshQuizBuilderUI(){
  if(!document.getElementById("qb-saved-select")) return;
  renderQuizBuilderDomainUi();
  renderQuizBuilderSavedList();
  renderQuizBuilderPreview();
}

function initQuizBuilderUI(){
  if(!document.getElementById("qb-name")) return;
  const domainsEl = document.getElementById("qb-domains");
  const subdivision1Sel = document.getElementById("qb-subdivision1");
  const subdivision2Sel = document.getElementById("qb-subdivision2");
  const frontFieldSel = document.getElementById("qb-front-field");
  const backFieldSel = document.getElementById("qb-back-field");
  const applyMainQuizSelectors = ()=>{
    const pair = getQuizBuilderPairKeysFromForm();
    const from = pair.fromField;
    const to = pair.toField;
    const type = document.getElementById("qb-type")?.value || "multiple_choice";
    const quizFrom = document.getElementById("quiz-from");
    const quizTo = document.getElementById("quiz-to");
    const quizType = document.getElementById("quiz-type");
    const hasOpt = (sel, val)=> !!sel && [...sel.options].some(opt => opt.value === val);
    if(quizFrom && hasOpt(quizFrom, from)) quizFrom.value = from;
    if(quizTo && hasOpt(quizTo, to)) quizTo.value = to;
    if(quizType) quizType.value = type;
    const qbFrom = document.getElementById("qb-from");
    const qbTo = document.getElementById("qb-to");
    if(qbFrom) qbFrom.value = from;
    if(qbTo) qbTo.value = to;
  };

  ensureFlashcardsV2DataLoaded().then(()=>{
    renderQuizBuilderDomainUi();
    applyMainQuizSelectors();
    renderQuizBuilderPreview();
  });

  if(domainsEl && subdivision1Sel && subdivision2Sel && frontFieldSel && backFieldSel){
    renderQuizBuilderDomainUi();
    domainsEl.addEventListener("change", (event)=>{
      const hit = event.target instanceof HTMLInputElement ? String(event.target.getAttribute("data-qb-domain") || "") : "";
      if(!hit) return;
      quizBuilderDomainKey = hit;
      quizBuilderSubdivision1 = "";
      quizBuilderSubdivision2 = "";
      quizBuilderFrontFieldKey = "";
      quizBuilderBackFieldKey = "";
      renderQuizBuilderDomainUi();
      applyMainQuizSelectors();
      renderQuizBuilderPreview();
    });
    subdivision1Sel.addEventListener("change", ()=>{
      quizBuilderSubdivision1 = String(subdivision1Sel.value || "");
      quizBuilderSubdivision2 = "";
      renderQuizBuilderDomainUi();
      applyMainQuizSelectors();
      renderQuizBuilderPreview();
    });
    subdivision2Sel.addEventListener("change", ()=>{
      quizBuilderSubdivision2 = String(subdivision2Sel.value || "");
      applyMainQuizSelectors();
      renderQuizBuilderPreview();
    });
    frontFieldSel.addEventListener("change", ()=>{
      quizBuilderFrontFieldKey = String(frontFieldSel.value || "");
      if(quizBuilderBackFieldKey === quizBuilderFrontFieldKey){
        const alt = [...backFieldSel.options].map(opt => opt.value).find(v => v !== quizBuilderFrontFieldKey);
        if(alt){
          quizBuilderBackFieldKey = alt;
          backFieldSel.value = alt;
        }
      }
      applyMainQuizSelectors();
      renderQuizBuilderPreview();
    });
    backFieldSel.addEventListener("change", ()=>{
      quizBuilderBackFieldKey = String(backFieldSel.value || "");
      if(quizBuilderBackFieldKey === quizBuilderFrontFieldKey){
        const alt = [...frontFieldSel.options].map(opt => opt.value).find(v => v !== quizBuilderBackFieldKey);
        if(alt){
          quizBuilderFrontFieldKey = alt;
          frontFieldSel.value = alt;
        }
      }
      applyMainQuizSelectors();
      renderQuizBuilderPreview();
    });
  }

  ["qb-type", "qb-source-preset", "qb-target-count", "qb-shuffle-pool"].forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    el.addEventListener("change", ()=>{
      applyMainQuizSelectors();
      renderQuizBuilderPreview();
    });
  });

  on("qb-new", "click", ()=> resetQuizBuilderForm());
  on("qb-save", "click", ()=>{
    const cfg = getQuizBuilderConfigFromForm();
    const resolved = buildQuizBuilderResolvedRows();
    if(!cfg.name){
      setQuizBuilderMessage("Quiz name is required.");
      return;
    }
    if(resolved.rows.length === 0){
      setQuizBuilderMessage("No terms match this preset.");
      return;
    }
    const now = new Date().toISOString();
    const store = readCustomQuizzes();
    const idx = store.items.findIndex(item => item && String(item.quizId || "") === String(cfg.quizId || ""));
    const row = {
      quizId: cfg.quizId,
      name: cfg.name,
      description: cfg.description || "",
      type: cfg.type,
      fromField: cfg.fromField,
      toField: cfg.toField,
      termIds: Array.isArray(cfg.termIds) ? cfg.termIds : [],
      filters: cfg.filters || { fieldQuery: {}, sourcePreset: "all", targetCount: 20, shufflePool: true },
      createdAt: idx >= 0 ? store.items[idx].createdAt : now,
      updatedAt: now
    };
    if(idx >= 0) store.items[idx] = row;
    else store.items.unshift(row);
    writeCustomQuizzes(store);
    quizBuilderEditingId = row.quizId;
    setQuizBuilderMessage(`Saved quiz "${row.name}" locally.`);
    renderQuizBuilderSavedList();
  });
  on("qb-load", "click", ()=>{
    const sel = document.getElementById("qb-saved-select");
    const quizId = sel ? sel.value : "";
    if(!quizId){
      setQuizBuilderMessage("Select a saved quiz first.");
      return;
    }
    const store = readCustomQuizzes();
    const hit = store.items.find(item => item && String(item.quizId || "") === String(quizId));
    if(!hit){
      setQuizBuilderMessage("Saved quiz not found.");
      return;
    }
    applyQuizBuilderConfigToForm(hit);
    setQuizBuilderMessage(`Loaded quiz "${hit.name || "Untitled quiz"}".`);
    refreshQuizBuilderUI();
  });
  on("qb-delete", "click", ()=>{
    const sel = document.getElementById("qb-saved-select");
    const quizId = sel ? sel.value : "";
    if(!quizId){
      setQuizBuilderMessage("Select a saved quiz first.");
      return;
    }
    const store = readCustomQuizzes();
    const next = store.items.filter(item => item && String(item.quizId || "") !== String(quizId));
    if(next.length === store.items.length){
      setQuizBuilderMessage("Saved quiz not found.");
      return;
    }
    writeCustomQuizzes({ items: next });
    if(String(quizBuilderEditingId || "") === String(quizId)) quizBuilderEditingId = null;
    setQuizBuilderMessage("Saved quiz deleted.");
    renderQuizBuilderSavedList();
  });
  on("qb-start", "click", ()=>{
    const sel = document.getElementById("qb-saved-select");
    const quizId = sel ? sel.value : "";
    if(!quizId){
      setQuizBuilderMessage("Select a saved quiz first.");
      return;
    }
    const hit = (readCustomQuizzes().items || []).find(item => item && String(item.quizId || "") === String(quizId));
    if(!hit){
      setQuizBuilderMessage("Saved quiz not found.");
      return;
    }
    applyQuizBuilderConfigToForm(hit);
    const resolved = buildQuizBuilderResolvedRows();
    const selectedIds = Array.isArray(hit.termIds) ? hit.termIds.map(x => String(x || "").trim()).filter(Boolean) : [];
    const retryItems = selectedIds.length > 0
      ? resolved.candidates.filter(c => selectedIds.includes(String(c.termId || ""))).slice(0, resolved.targetCount)
      : resolved.rows.slice();
    if(retryItems.length === 0){
      setQuizBuilderMessage("This quiz has no terms available right now.");
      return;
    }
    startQuiz({
      retryItems,
      configOverrides: {
        quizType: hit.type || "multiple_choice",
        fromField: resolved.fromField || hit.fromField || "english_translation",
        toField: resolved.toField || hit.toField || "latin_translation",
        questionCount: Math.min(retryItems.length, Math.max(1, Number((hit.filters && hit.filters.targetCount) || retryItems.length || 10))),
        termIds: retryItems.map(item => item.termId),
        customFilters: null
      }
    });
    setQuizBuilderMessage(`Started quiz "${hit.name || "Untitled quiz"}".`);
  });
  on("qb-export", "click", ()=>{
    const sel = document.getElementById("qb-saved-select");
    const quizId = sel ? sel.value : "";
    if(!quizId){
      setQuizBuilderMessage("Select a saved quiz first.");
      return;
    }
    const hit = (readCustomQuizzes().items || []).find(item => item && String(item.quizId || "") === String(quizId));
    if(!hit){
      setQuizBuilderMessage("Saved quiz not found.");
      return;
    }
    const exported = buildQuizExportDocument(hit);
    const fileName = `quiz_${toFileSafeName(hit.name, "quiz")}_${dateStampYmd()}.mdjlf_quiz.json`;
    saveJsonToFile({ suggestedName: fileName, data: exported })
      .then(()=> setQuizBuilderMessage("Quiz saved to file."))
      .catch((e)=> setQuizBuilderMessage(`Save failed: ${e.message || e}`));
  });
  on("qb-import", "click", async ()=>{
    try{
      const loaded = await loadJsonFromFile();
      if(!loaded) return;
      const cfg = normalizeImportedQuizDoc(loaded.parsed);
      const store = readCustomQuizzes();
      const idx = store.items.findIndex(item => item && String(item.quizId || "") === cfg.quizId);
      if(idx >= 0){
        const overwrite = confirm(`Quiz "${cfg.name}" already exists. Press OK to overwrite, Cancel to duplicate.`);
        if(overwrite){
          store.items[idx] = { ...store.items[idx], ...cfg, updatedAt: new Date().toISOString() };
        } else {
          cfg.quizId = genId("quiz:");
          cfg.createdAt = new Date().toISOString();
          cfg.updatedAt = cfg.createdAt;
          store.items.unshift(cfg);
        }
      } else {
        store.items.unshift(cfg);
      }
      writeCustomQuizzes(store);
      applyQuizBuilderConfigToForm(cfg);
      refreshQuizBuilderUI();
      setQuizBuilderMessage(`Imported quiz "${cfg.name}".`);
    }catch(e){
      setQuizBuilderMessage(`Import failed: ${e.message || e}`);
    }
  });
  refreshQuizBuilderUI();
}

const progressStore = {
  _readProgress(){
    if(isProfileSessionActive()){
      const bucket = getTermProgressBucket(userProfile);
      return { terms: deepClone(bucket.terms || {}) };
    }
    return readJsonLS(QUIZ_PROGRESS_KEY, { terms: {} }) || { terms: {} };
  },
  _writeProgress(data){
    if(isProfileSessionActive()){
      const bucket = getTermProgressBucket(userProfile);
      bucket.terms = deepClone((data && data.terms) || {});
      markProfileDirty();
      return;
    }
    writeJsonLS(QUIZ_PROGRESS_KEY, data || { terms: {} });
  },
  _readSessions(){
    if(isProfileSessionActive()){
      return Array.isArray(userProfile.learning.quiz_sessions) ? deepClone(userProfile.learning.quiz_sessions) : [];
    }
    return readJsonLS(QUIZ_SESSIONS_KEY, []) || [];
  },
  _writeSessions(items){
    if(isProfileSessionActive()){
      userProfile.learning.quiz_sessions = Array.isArray(items) ? deepClone(items) : [];
      markProfileDirty();
      return;
    }
    writeJsonLS(QUIZ_SESSIONS_KEY, Array.isArray(items) ? items : []);
  },
  _pairKey(termId, fromField, toField){
    return `${termId}::${fromField}->${toField}`;
  },
  getTermStats(termId, fromField, toField){
    const data = this._readProgress();
    return data.terms[this._pairKey(termId, fromField, toField)] || { correct: 0, wrong: 0, attempts: 0, starred: false };
  },
  isStarred(termId){
    const data = this._readProgress();
    return Object.entries(data.terms || {}).some(([key, val]) => key.startsWith(`${termId}::`) && !!val.starred);
  },
  recordAttempt(termId, fromField, toField, isCorrect){
    const data = this._readProgress();
    const key = this._pairKey(termId, fromField, toField);
    const row = data.terms[key] || { correct: 0, wrong: 0, attempts: 0, starred: false, termId, fromField, toField, updatedAt: null };
    row.attempts = Number(row.attempts || 0) + 1;
    if(isCorrect) row.correct = Number(row.correct || 0) + 1;
    else row.wrong = Number(row.wrong || 0) + 1;
    row.updatedAt = new Date().toISOString();
    row.last_seen = row.updatedAt;
    data.terms[key] = row;
    this._writeProgress(data);
  },
  getWeakTerms({ limit = 20, fromField, toField } = {}){
    const data = this._readProgress();
    const rows = Object.values(data.terms || {}).filter(row => {
      if(fromField && row.fromField !== fromField) return false;
      if(toField && row.toField !== toField) return false;
      return true;
    });
    rows.sort((a, b)=>{
      const aScore = Number(a.wrong || 0) - Number(a.correct || 0);
      const bScore = Number(b.wrong || 0) - Number(b.correct || 0);
      if(aScore !== bScore) return bScore - aScore;
      return Number(b.wrong || 0) - Number(a.wrong || 0);
    });
    return rows.slice(0, Math.max(0, Number(limit) || 0));
  },
  toggleStar(termId){
    const data = this._readProgress();
    const keys = Object.keys(data.terms || {}).filter(key => key.startsWith(`${termId}::`));
    if(keys.length === 0){
      const synthetic = `${termId}::english_translation->latin_translation`;
      data.terms[synthetic] = { correct: 0, wrong: 0, attempts: 0, starred: true, termId, fromField: "english_translation", toField: "latin_translation", updatedAt: new Date().toISOString() };
      this._writeProgress(data);
      markStarredTermState(termId);
      return true;
    }
    const nextStarred = !keys.every(key => !!data.terms[key].starred);
    keys.forEach(key => { data.terms[key].starred = nextStarred; });
    this._writeProgress(data);
    if(nextStarred) markStarredTermState(termId);
    return nextStarred;
  },
  recordSession(summary){
    const sessions = this._readSessions();
    sessions.unshift(summary);
    this._writeSessions(sessions.slice(0, QUIZ_MAX_SESSIONS));
  }
};

function makeBaseTermId(row, fromValue, toValue){
  const dataset = String(row.__dataset || "base");
  const idPart = String(row.id || row.ID || "").trim();
  if(idPart) return `${dataset}:${idPart}`;
  return `${dataset}:${String(fromValue || "").trim()}|${String(toValue || "").trim()}`;
}

function pickFirstNonEmptyField(row, fieldNames){
  for(const fieldName of fieldNames || []){
    const value = String((row && row[fieldName]) || "").trim();
    if(value) return value;
  }
  return "";
}

function getEquivalentLanguageValue(row, canonicalField){
  const aliases = LANGUAGE_FIELD_EQUIVALENTS[canonicalField] || [canonicalField];
  return pickFirstNonEmptyField(row, aliases);
}

function buildCategoryText(row, fallback){
  const direct = String((row && row.category) || "").trim();
  if(direct) return direct;
  const sourceLabel = String((row && row.__sourceLabel) || "").trim();
  if(sourceLabel) return sourceLabel;
  const datasetLabel = String((row && row.__datasetLabel) || "").trim();
  if(datasetLabel) return datasetLabel;
  return String(fallback || "").trim();
}

function hasAnyDefinition(row){
  if(!row) return false;
  const fields = [
    "english_definition",
    "german_definition",
    "slovak_definition",
    "english_description",
    "german_description",
    "slovak_description",
    "notes"
  ];
  return fields.some(f => String(row[f] || "").trim().length > 0);
}

function buildQuizCandidates(fromField, toField){
  const fromPair = parseDomainFieldPairKey(fromField);
  const toPair = parseDomainFieldPairKey(toField);
  if(fromPair && toPair && fromPair.domainKey && fromPair.domainKey === toPair.domainKey && flashcardsV2State.loaded){
    const adapter = flashcardsV2State.adapterByKey.get(fromPair.domainKey);
    if(!adapter) return [];
    const frontField = adapter.fieldByKey.get(fromPair.fieldKey);
    const backField = adapter.fieldByKey.get(toPair.fieldKey);
    if(!frontField || !backField) return [];
    const subQuery = {
      subdivision1: normalizeSubdivisionSelection(quizGeneratorSubdivision1),
      subdivision2: normalizeSubdivisionSelection(quizGeneratorSubdivision2)
    };
    const candidates = [];
    for(const row of flashcardsV2State.allTerms){
      if(!row || String(row._domain || "") !== fromPair.domainKey) continue;
      if(!matchesFlashcardsSubdivision(row, adapter, subQuery)) continue;
      const fromTerm = String(frontField.getValue(row) || "").trim();
      const toTerm = String(backField.getValue(row) || "").trim();
      if(!fromTerm || !toTerm || fromTerm === toTerm) continue;
      const termId = String(row._id || "");
      candidates.push({
        termId,
        fromTerm,
        toTerm,
        sourceType: "base",
        sourceDataset: fromPair.domainKey,
        category: adapter.label || fromPair.domainKey,
        hasDefinition: hasAnyDefinition(row),
        baseTermKey: termId,
        userTermId: null
      });
    }
    return candidates;
  }

  const fromUser = mapUserFieldFromBase(fromField);
  const toUser = mapUserFieldFromBase(toField);
  const candidates = [];

  for(const row of medicalTerms){
    const fromTerm = getEquivalentLanguageValue(row, fromField);
    const toTerm = getEquivalentLanguageValue(row, toField);
    if(!fromTerm || !toTerm) continue;
    const termId = makeBaseTermId(row, fromTerm, toTerm);
    candidates.push({
      termId,
      fromTerm,
      toTerm,
      sourceType: "base",
      sourceDataset: row.__dataset || "",
      category: buildCategoryText(row, row.__dataset || ""),
      hasDefinition: hasAnyDefinition(row),
      baseTermKey: termId,
      userTermId: null
    });
  }

  for(const row of getLocalTerms()){
    const fromTerm = String(row && row[fromUser] || "").trim();
    const toTerm = String(row && row[toUser] || "").trim();
    if(!fromTerm || !toTerm) continue;
    const idPart = String((row && row.id) || "").trim() || `${fromTerm}|${toTerm}`;
    const termId = `user:${idPart}`;
    candidates.push({
      termId,
      fromTerm,
      toTerm,
      sourceType: "user",
      sourceDataset: "manual_entry",
      category: "manual_entry",
      hasDefinition: String((row && row.notes) || "").trim().length > 0,
      baseTermKey: null,
      userTermId: row && row.id ? row.id : null
    });
  }
  return candidates;
}

function resolveQuizCandidatesForSession({
  fromField,
  toField,
  filters = {},
  retryItems = null,
  termIds = null,
  customFilters = null
} = {}){
  const savedSub1 = normalizeSubdivisionSelection(quizGeneratorSubdivision1);
  const savedSub2 = normalizeSubdivisionSelection(quizGeneratorSubdivision2);
  if(filters && typeof filters === "object"){
    if(Object.prototype.hasOwnProperty.call(filters, "subdivision1")) quizGeneratorSubdivision1 = normalizeSubdivisionSelection(filters.subdivision1);
    if(Object.prototype.hasOwnProperty.call(filters, "subdivision2")) quizGeneratorSubdivision2 = normalizeSubdivisionSelection(filters.subdivision2);
  }
  let candidates = retryItems && retryItems.length ? retryItems.slice() : buildQuizCandidates(fromField, toField);
  quizGeneratorSubdivision1 = savedSub1;
  quizGeneratorSubdivision2 = savedSub2;

  if(Array.isArray(termIds) && termIds.length > 0){
    const wanted = new Set(termIds.map(v => String(v || "").trim()).filter(Boolean));
    candidates = candidates.filter(candidate => wanted.has(String(candidate.termId || "").trim()));
  }
  if(customFilters){
    const include = (customFilters.includeCategories || []).map(v => String(v || "").trim().toLowerCase()).filter(Boolean);
    const exclude = (customFilters.excludeCategories || []).map(v => String(v || "").trim().toLowerCase()).filter(Boolean);
    const onlyWithDefinitions = !!customFilters.onlyWithDefinitions;
    candidates = candidates.filter(candidate => {
      const categoryText = String(candidate.category || "").toLowerCase();
      if(include.length > 0 && !include.some(value => categoryText.includes(value))) return false;
      if(exclude.length > 0 && exclude.some(value => categoryText.includes(value))) return false;
      if(onlyWithDefinitions && !candidate.hasDefinition) return false;
      return true;
    });
  }
  if(filters.onlyStarred){
    candidates = candidates.filter(candidate => progressStore.isStarred(candidate.termId));
  }
  return candidates.filter(candidate => candidate.fromTerm && candidate.toTerm);
}

const quizEngine = createQuizEngine({
  onTick: ()=>renderQuizUI(),
  getTermStats: (termId, fromField, toField)=>progressStore.getTermStats(termId, fromField, toField),
  recordAttempt: (termId, fromField, toField, isCorrect)=>progressStore.recordAttempt(termId, fromField, toField, isCorrect),
  recordSession: (summary)=>progressStore.recordSession(summary),
  appendWrongTermsLog,
  persistSession: ()=>saveUserProfileNow("quiz_end")
});

function quizAccuracyPct(quizState){
  if(!quizState || !quizState.answered) return 0;
  return Math.round((quizState.score / quizState.answered) * 100);
}

function renderQuizStats(quizState){
  const scoreEl = document.getElementById('quiz-score');
  const statsEl = document.getElementById('quiz-stats');
  if(scoreEl){
    const total = quizState && quizState.settings ? quizState.settings.questionCount : 0;
    scoreEl.textContent = `${t('score') || 'Score'}: ${(quizState && quizState.score) || 0} / ${total}`;
  }
  if(statsEl){
    const streak = (quizState && quizState.streak) || 0;
    const acc = quizAccuracyPct(quizState);
    const timer = (quizState && quizState.timeLeftSeconds != null)
      ? ` | ${tOr('quiz_time', 'Time')}: ${quizState.timeLeftSeconds}s`
      : '';
    statsEl.textContent = `${tOr('quiz_streak', 'Streak')}: ${streak} | ${tOr('quiz_accuracy', 'Accuracy')}: ${acc}%${timer}`;
  }
}

function renderQuizSummary(quizState){
  const area = document.getElementById('quiz-area');
  if(!area) return;
  const wrong = (quizState && quizState.wrongAnswers) || [];
  const wrongHtml = wrong.length === 0
    ? `<div class="muted">${escapeHTML(tOr('quiz_no_wrong_terms', 'No wrong terms. Great run.'))}</div>`
    : wrong.map(item => `
      <div class="quiz-wrong-item">
        <div><strong>${escapeHTML(item.fromTerm || '')}</strong></div>
        <div class="small">${escapeHTML(tOr('correct', 'Correct'))}: ${escapeHTML(item.correctToTerm || '')}</div>
        <div class="small">${escapeHTML(tOr('quiz_chosen_label', 'Chosen'))}: ${escapeHTML(item.userChosen || '')}</div>
        <div class="small">${escapeHTML(item.timestamp || '')}</div>
      </div>
    `).join('');

  area.innerHTML = `
    <div class="quiz-summary">
      <div><strong>${escapeHTML(tOr('quiz_summary_title', 'Quiz summary'))}</strong></div>
      <div class="muted">${escapeHTML(tOr('quiz_total_correct', 'Total correct'))}: ${quizState.score} / ${(quizState.settings && quizState.settings.questionCount) || quizState.questions.length}</div>
      <div class="quiz-wrong-list">${wrongHtml}</div>
      <div class="row">
        <button type="button" id="quiz-retry-wrong"${wrong.length ? '' : ' disabled'}>${escapeHTML(tOr('quiz_retry_wrong_terms', 'Retry wrong terms'))}</button>
        <button type="button" id="quiz-add-wrong-review"${wrong.length ? '' : ' disabled'}>${escapeHTML(tOr('quiz_add_wrong_review', 'Add wrong terms to review list'))}</button>
      </div>
    </div>
  `;

  const retryBtn = document.getElementById('quiz-retry-wrong');
  if(retryBtn){
    retryBtn.addEventListener('click', ()=>{
      if(!quizLastFinishedState || !quizLastFinishedState.wrongAnswers || quizLastFinishedState.wrongAnswers.length === 0) return;
      const fromField = quizLastFinishedState.fromField;
      const toField = quizLastFinishedState.toField;
      const fromSel = document.getElementById('quiz-from');
      const toSel = document.getElementById('quiz-to');
      if(fromSel) fromSel.value = fromField;
      if(toSel) toSel.value = toField;
      const all = buildQuizCandidates(fromField, toField);
      const wanted = new Set(quizLastFinishedState.wrongAnswers.map(w => `${w.termId}::${w.fromTerm}::${w.correctToTerm}`));
      const retryItems = all.filter(c => wanted.has(`${c.termId}::${c.fromTerm}::${c.toTerm}`));
      startQuiz({ retryItems });
    });
  }

  const reviewBtn = document.getElementById('quiz-add-wrong-review');
  if(reviewBtn){
    reviewBtn.addEventListener('click', addWrongTermsToReviewList);
  }
}

function quizRequiresDoubleConfirm(quizState){
  return !!(quizState && quizState.settings && quizState.settings.filters && quizState.settings.filters.doubleConfirm);
}

function handleMultipleChoiceSelection(question, optionId){
  if(!question || !optionId || question.answered) return;
  const quizState = quizEngine.getQuizState();
  if(!quizRequiresDoubleConfirm(quizState)){
    const res = quizEngine.answerQuestion(question.id, optionId);
    if(res.ok) renderQuizUI();
    return;
  }

  if(String(question.pendingOptionId || "") !== String(optionId)){
    question.pendingOptionId = String(optionId);
    renderQuizUI();
    return;
  }

  const res = quizEngine.answerQuestion(question.id, optionId);
  if(res.ok) renderQuizUI();
}

function renderQuizQuestion(quizState){
  const area = document.getElementById('quiz-area');
  if(!area) return;
  const q = quizState.currentQuestion;
  if(!q){
    area.textContent = tOr('quiz_complete', 'Quiz complete.');
    return;
  }
  if(q.type === "matching"){
    const letterForIndex = (index)=>{
      const code = 65 + index;
      return code <= 90 ? String.fromCharCode(code) : String(index + 1);
    };
    const choiceLetterMap = new Map(q.choices.map((choice, index) => [choice, letterForIndex(index)]));
    const activePairId = String(q.activePairId || (q.pairs[0] && q.pairs[0].pairId) || "");
    const promptListHtml = q.pairs.map((pair, idx)=>{
      const selectedLetter = pair.selectedToTerm ? (choiceLetterMap.get(pair.selectedToTerm) || "") : "";
      const wrongWithCorrect = `${tOr('wrong', 'Wrong')} (${tOr('correct', 'Correct')}: ${choiceLetterMap.get(pair.correctToTerm) || "?"})`;
      const status = !q.answered ? "" : (pair.isCorrect
        ? `<span class="quiz-feedback ok">${escapeHTML(tOr('correct', 'Correct'))}</span>`
        : `<span class="quiz-feedback bad">${escapeHTML(wrongWithCorrect)}</span>`);
      const classes = [
        "quiz-matching-reference-button",
        activePairId === String(pair.pairId) && !q.answered ? "is-active" : "",
        q.answered && pair.isCorrect ? "quiz-correct" : "",
        q.answered && !pair.isCorrect ? "quiz-wrong" : ""
      ].filter(Boolean).join(" ");
      return `
        <button type="button" class="${classes}" data-match-pair-select="${escapeHTML(pair.pairId)}" ${q.answered ? 'disabled' : ''}>
          <span class="quiz-matching-reference-main">
            <strong>${idx + 1}.</strong>
            <span>${escapeHTML(pair.fromTerm)}</span>
          </span>
          <span class="quiz-matching-reference-meta">
            ${selectedLetter
              ? `${escapeHTML(tOr('quiz_selected_answer', 'Selected'))}: ${escapeHTML(selectedLetter)}`
              : escapeHTML(tOr('quiz_select_answer', 'Select answer'))}
          </span>
          ${status}
        </button>
      `;
    }).join("");
    const answerListHtml = q.choices.map((choice, index)=>{
      const letter = letterForIndex(index);
      const assignedPair = q.pairs.find(pair => pair.selectedToTerm === choice);
      const assignedNumber = assignedPair ? String(q.pairs.indexOf(assignedPair) + 1) : "";
      const isCorrectTarget = q.answered && q.pairs.some(pair => pair.correctToTerm === choice);
      const classes = [
        "quiz-matching-reference-button",
        assignedPair && !q.answered ? "quiz-pending" : "",
        q.answered && assignedPair && assignedPair.correctToTerm === choice ? "quiz-correct" : "",
        q.answered && assignedPair && assignedPair.correctToTerm !== choice ? "quiz-wrong" : "",
        q.answered && !assignedPair && isCorrectTarget ? "quiz-neutral" : ""
      ].filter(Boolean).join(" ");
      return `
        <button type="button" class="${classes}" data-match-choice-pick="${escapeHTML(choice)}" ${q.answered ? 'disabled' : ''}>
          <span class="quiz-matching-reference-main">
            <strong>${escapeHTML(letter)}.</strong>
            <span>${escapeHTML(choice)}</span>
          </span>
          <span class="quiz-matching-reference-meta">
            ${assignedNumber
              ? `${escapeHTML(tOr('quiz_assigned_to', 'Assigned to'))}: ${escapeHTML(assignedNumber)}`
              : escapeHTML(tOr('quiz_click_to_assign', 'Click to assign'))}
          </span>
        </button>
      `;
    }).join("");

    area.innerHTML = `
      <div class="quiz-question ${q.answered ? 'quiz-answered' : ''}" data-question-id="${escapeHTML(q.id)}">
        <div class="quiz-question-title">${escapeHTML(tOr('quiz_match_terms', 'Match terms'))} (${q.pairs.length} ${escapeHTML(tOr('quiz_pairs', 'pairs'))})</div>
        <div class="quiz-matching-reference-grid">
          <div class="quiz-matching-reference">
            <div class="quiz-matching-side-title">${escapeHTML(tOr('quiz_match_prompts', 'Numbered prompts'))}</div>
            <div class="quiz-matching-reference-list">${promptListHtml}</div>
          </div>
          <div class="quiz-matching-reference">
            <div class="quiz-matching-side-title">${escapeHTML(tOr('quiz_match_answers', 'Lettered answers'))}</div>
            <div class="quiz-matching-reference-list">${answerListHtml}</div>
          </div>
        </div>
        ${q.answered ? '' : `<div class="quiz-shortcuts">${escapeHTML(tOr('quiz_matching_pick_hint', 'Click one prompt on the left, then one answer on the right to assign them.'))}</div>`}
        <div class="row">
          ${q.answered
            ? `<button type="button" id="quiz-next-question" class="primary">${escapeHTML(tOr('quiz_finish', 'Finish'))}</button>`
            : `<button type="button" id="quiz-submit-matching" class="primary">${escapeHTML(tOr('quiz_submit_matching', 'Submit matching'))}</button>`}
        </div>
      </div>
    `;

    const submitBtn = document.getElementById('quiz-submit-matching');
    area.querySelectorAll('[data-match-pair-select]').forEach(btn => {
      btn.addEventListener('click', ()=>{
        q.activePairId = btn.getAttribute('data-match-pair-select') || '';
        renderQuizUI();
      });
    });
    area.querySelectorAll('[data-match-choice-pick]').forEach(btn => {
      btn.addEventListener('click', ()=>{
        const choice = btn.getAttribute('data-match-choice-pick') || '';
        const pair = q.pairs.find(item => String(item.pairId) === String(q.activePairId || activePairId));
        if(!pair) return;
        q.pairs.forEach(item => {
          if(item.selectedToTerm === choice) item.selectedToTerm = "";
        });
        pair.selectedToTerm = choice;
        q.activePairId = pair.pairId;
        renderQuizUI();
      });
    });
    if(submitBtn){
      submitBtn.addEventListener('click', ()=>{
        const answers = {};
        q.pairs.forEach(pair => { answers[pair.pairId] = pair.selectedToTerm || ""; });
        const res = quizEngine.submitMatching(q.id, answers);
        if(res.ok) renderQuizUI();
      });
    }
    const nextBtn = document.getElementById('quiz-next-question');
    if(nextBtn){
      nextBtn.addEventListener('click', ()=>{
        quizEngine.nextQuestion();
        renderQuizUI();
      });
    }
    return;
  }

  const isStarred = progressStore.isStarred(q.termId);
  const feedback = !q.answered ? '' : (q.isCorrect
    ? `<div class="quiz-feedback ok">${escapeHTML(tOr('correct', 'Correct'))}</div>`
    : `<div class="quiz-feedback bad">${escapeHTML(tOr('wrong', 'Wrong'))}. ${escapeHTML(tOr('quiz_correct_answer', 'Correct answer'))}: ${escapeHTML(q.correctToTerm)}</div>`);

  if(q.type === "typing"){
    area.innerHTML = `
      <div class="quiz-question ${q.answered ? 'quiz-answered' : ''}" data-question-id="${escapeHTML(q.id)}">
        <div class="quiz-question-head">
          <div class="quiz-question-title">Q${q.number}/${quizState.questions.length}: ${escapeHTML(q.fromTerm)}</div>
          <button type="button" id="quiz-toggle-star">${isStarred ? escapeHTML(tOr('quiz_unstar', 'Unstar')) : escapeHTML(tOr('quiz_star', 'Star'))}</button>
        </div>
        ${feedback}
        <div class="row">
          <input id="quiz-typing-answer" placeholder="${escapeHTML(tOr('quiz_type_answer_placeholder', 'Type answer'))}" value="${escapeHTML(q.typedAnswer || '')}" ${q.answered ? 'disabled' : ''} />
          ${q.answered ? '' : `<button type="button" id="quiz-submit-typing" class="primary">${escapeHTML(tOr('quiz_submit', 'Submit'))}</button>`}
        </div>
        <div class="quiz-shortcuts">${escapeHTML(tOr('quiz_shortcuts_typing', 'Press Enter to submit, then Enter for next question.'))}</div>
        ${q.answered ? `<div class="row"><button type="button" id="quiz-next-question" class="primary">${escapeHTML(tOr('quiz_next_question', 'Next question'))}</button></div>` : ''}
      </div>
    `;

    const submitBtn = document.getElementById('quiz-submit-typing');
    if(submitBtn){
      submitBtn.addEventListener('click', ()=>{
        const answer = document.getElementById('quiz-typing-answer')?.value || '';
        const res = quizEngine.answerQuestion(q.id, answer);
        if(res.ok) renderQuizUI();
      });
    }
    const input = document.getElementById('quiz-typing-answer');
    if(input && !q.answered){
      input.addEventListener('keydown', (ev)=>{
        if(ev.key === 'Enter'){
          ev.preventDefault();
          const res = quizEngine.answerQuestion(q.id, input.value || '');
          if(res.ok) renderQuizUI();
        }
      });
    }
  } else {
    const requireDoubleConfirm = quizRequiresDoubleConfirm(quizState);
    const pendingOptionId = String(q.pendingOptionId || "");
    const optionsHtml = q.options.map((option, index)=>{
      let cls = "";
      if(q.answered){
        if(option.text === q.correctToTerm) cls = "quiz-correct";
        else if(option.id === q.selectedOptionId) cls = "quiz-wrong";
        else cls = "quiz-neutral";
      } else if(requireDoubleConfirm && option.id === pendingOptionId){
        cls = "quiz-pending";
      }
      return `<button type="button" data-option-id="${escapeHTML(option.id)}" class="${cls}" ${q.answered ? 'disabled' : ''}>${index + 1}. ${escapeHTML(option.text)}</button>`;
    }).join("");
    const pendingHint = (!q.answered && requireDoubleConfirm && pendingOptionId)
      ? `<div class="quiz-feedback">${escapeHTML(tOr('quiz_double_confirm_pending', 'Answer selected. Tap the same option again to confirm.'))}</div>`
      : '';
    const shortcuts = requireDoubleConfirm
      ? tOr('quiz_shortcuts_double_confirm', 'Keys 1-6 select options (press the same key again to confirm). Press Enter for next question.')
      : tOr('quiz_shortcuts_standard', 'Keys 1-6 select an option. Press Enter for next question.');

    area.innerHTML = `
      <div class="quiz-question ${q.answered ? 'quiz-answered' : ''}" data-question-id="${escapeHTML(q.id)}">
        <div class="quiz-question-head">
          <div class="quiz-question-title">Q${q.number}/${quizState.questions.length}: ${escapeHTML(q.fromTerm)}</div>
          <button type="button" id="quiz-toggle-star">${isStarred ? escapeHTML(tOr('quiz_unstar', 'Unstar')) : escapeHTML(tOr('quiz_star', 'Star'))}</button>
        </div>
        ${feedback}
        ${pendingHint}
        <div class="choices">${optionsHtml}</div>
        <div class="quiz-shortcuts">${escapeHTML(shortcuts)}</div>
        ${q.answered ? `<div class="row"><button type="button" id="quiz-next-question" class="primary">${escapeHTML(tOr('quiz_next_question', 'Next question'))}</button></div>` : ''}
      </div>
    `;

    const optionButtons = area.querySelectorAll('[data-option-id]');
    optionButtons.forEach(btn => {
      btn.addEventListener('click', ()=>{
        const optionId = btn.getAttribute('data-option-id');
        handleMultipleChoiceSelection(q, optionId);
      });
    });
  }

  const starBtn = document.getElementById('quiz-toggle-star');
  if(starBtn){
    starBtn.addEventListener('click', ()=>{
      progressStore.toggleStar(q.termId);
      renderQuizUI();
    });
  }

  const nextBtn = document.getElementById('quiz-next-question');
  if(nextBtn){
    nextBtn.addEventListener('click', ()=>{
      quizEngine.nextQuestion();
      renderQuizUI();
    });
  }
}

function renderQuizUI(){
  const quizState = quizEngine.getQuizState();
  renderQuizStats(quizState);
  renderQuizStudioInsights();
  if(quizState.active){
    renderQuizQuestion(quizState);
    return;
  }
  if(quizState.finished){
    quizLastFinishedState = quizState;
    renderQuizSummary(quizState);
    return;
  }
  const area = document.getElementById('quiz-area');
  if(area) area.textContent = tOr('quiz_configure_and_start', 'Configure settings and press Start.');
}

function addWrongTermsToReviewList(){
  if(!quizLastFinishedState || !quizLastFinishedState.wrongAnswers) return;
  const wrong = quizLastFinishedState.wrongAnswers;
  if(wrong.length === 0) return;
  const review = getLocalReview();
  const exists = new Set(review.map(r => `${r.base_term_key || ''}|${r.base_dataset || ''}|${r.user_term_id || ''}`));

  for(const w of wrong){
    const key = `${w.baseTermKey || ''}|${w.sourceDataset || ''}|${w.userTermId || ''}`;
    if(exists.has(key)) continue;
    review.push({
      id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(16) + Math.random().toString(16).slice(2)),
      user_term_id: w.userTermId || null,
      base_term_key: w.baseTermKey || null,
      base_dataset: w.sourceDataset || null,
      difficulty: 3,
      last_seen: null,
      next_due: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    exists.add(key);
  }
  setLocalReview(review);
  rebuildReviewListStateFromLocalReview();
  const area = document.getElementById('quiz-area');
  if(area){
    const note = document.createElement('div');
    note.className = 'muted';
    note.textContent = tOr('quiz_wrong_added_to_review', 'Wrong terms added to review list.');
    area.appendChild(note);
  }
}

function readQuizSettings(){
  const rawQuestionCount = Number(document.getElementById('quiz-question-count')?.value || 10);
  const rawOptionsCount = clampQuizOptionsCount(document.getElementById('quiz-options-count')?.value || 4);
  const front = String(document.getElementById('quiz-front-field')?.value || quizGeneratorFrontFieldKey || "");
  const back = String(document.getElementById('quiz-back-field')?.value || quizGeneratorBackFieldKey || "");
  const useDomainFields = !!(quizGeneratorDomainKey && front && back);
  const fromField = useDomainFields ? makeDomainFieldPairKey(quizGeneratorDomainKey, front) : (document.getElementById('quiz-from')?.value || "english_translation");
  const toField = useDomainFields ? makeDomainFieldPairKey(quizGeneratorDomainKey, back) : (document.getElementById('quiz-to')?.value || "latin_translation");
  return {
    quizType: document.getElementById('quiz-type')?.value || "multiple_choice",
    fromField,
    toField,
    questionCount: rawQuestionCount,
    optionsCount: rawOptionsCount,
    filters: {
      onlyStarred: !!document.getElementById('quiz-only-starred')?.checked,
      preferWrong: !!document.getElementById('quiz-prefer-wrong')?.checked,
      doubleConfirm: !!document.getElementById('quiz-double-confirm')?.checked,
      domainKey: quizGeneratorDomainKey,
      subdivision1: normalizeSubdivisionSelection(quizGeneratorSubdivision1),
      subdivision2: normalizeSubdivisionSelection(quizGeneratorSubdivision2)
    }
  };
}

function getQuizStudioFilteredCandidates(settings = readQuizSettings()){
  let rows = buildQuizCandidates(settings.fromField, settings.toField).filter(c => c.fromTerm && c.toTerm);
  if(settings.filters.onlyStarred) rows = rows.filter(c => progressStore.isStarred(c.termId));
  return rows;
}

function syncQuizSessionStageVisibility(forceVisible = null){
  const stage = document.getElementById("quiz-session-stage");
  const screen = document.getElementById("screen-quiz");
  if(!stage || !screen) return;
  const visible = typeof forceVisible === "boolean"
    ? forceVisible
    : screen.classList.contains("quiz-builder-collapsed");
  stage.classList.toggle("hidden", !visible);
}

function renderQuizStudioInsights(){
  const poolEl = document.getElementById("quiz-studio-pool");
  const planEl = document.getElementById("quiz-studio-plan");
  const retryBtn = document.getElementById("quiz-studio-retry-last-wrong");
  const reviewBtn = document.getElementById("quiz-studio-review-last-wrong");
  const countEl = document.getElementById("quiz-question-count");
  const countHintEl = document.getElementById("quiz-question-count-hint");
  const optionsEl = document.getElementById("quiz-options-count");
  const timerEl = document.getElementById("quiz-timer");
  const timerHintEl = document.getElementById("quiz-timer-hint");
  const settings = readQuizSettings();
  const filtered = getQuizStudioFilteredCandidates(settings);
  const maxQuestions = Math.max(1, filtered.length || 1);
  const normalizedQuestionCount = clampQuizQuestionCount(settings.questionCount, maxQuestions);
  const normalizedOptionsCount = clampQuizOptionsCount(settings.optionsCount);
  const timerSeconds = filtered.length ? calculateQuizTimerSeconds({
    quizType: settings.quizType,
    questionCount: normalizedQuestionCount,
    optionsCount: normalizedOptionsCount,
    doubleConfirm: settings.filters.doubleConfirm
  }) : 0;
  if(countEl){
    countEl.max = String(maxQuestions);
    countEl.value = String(normalizedQuestionCount);
  }
  if(countHintEl){
    countHintEl.textContent = filtered.length
      ? `Available range: 1-${maxQuestions}.`
      : "No matching terms yet.";
  }
  if(optionsEl){
    optionsEl.min = "2";
    optionsEl.max = "6";
    optionsEl.value = String(normalizedOptionsCount);
    optionsEl.disabled = settings.quizType !== "multiple_choice";
  }
  if(timerEl){
    timerEl.value = timerSeconds > 0 ? formatSecondsCompact(timerSeconds) : "-";
    timerEl.dataset.seconds = String(timerSeconds);
  }
  if(timerHintEl){
    timerHintEl.textContent = settings.quizType === "typing"
      ? "Auto timer is extended for typing answers."
      : settings.quizType === "matching"
        ? "Auto timer scales with the number of pairs to match."
        : "Auto timer scales with question count and answer-option load.";
  }
  if(settings.filters.preferWrong){
    const wrongIds = new Set(getWrongTermIdsForPair(settings.fromField, settings.toField));
    const wrongCount = filtered.filter(c => wrongIds.has(c.termId)).length;
    if(planEl) planEl.dataset.wrongCount = String(wrongCount);
  }
  if(poolEl){
    poolEl.textContent = `${filtered.length} available pairs`;
  }
  if(planEl){
    if(filtered.length === 0){
      planEl.textContent = "No matching terms with current filters.";
    } else {
      const flags = [];
      if(settings.filters.onlyStarred) flags.push("starred");
      if(settings.filters.preferWrong) flags.push("weak-first");
      if(settings.filters.doubleConfirm) flags.push("double-confirm");
      flags.push(`${formatSecondsCompact(timerSeconds)} timer`);
      const optionSegment = settings.quizType === "multiple_choice" ? ` | ${normalizedOptionsCount} options` : "";
      planEl.textContent = `${settings.quizType} | ${normalizedQuestionCount} questions${optionSegment}${flags.length ? ` | ${flags.join(", ")}` : ""}`;
    }
  }
  const hasWrong = !!(quizLastFinishedState && Array.isArray(quizLastFinishedState.wrongAnswers) && quizLastFinishedState.wrongAnswers.length);
  if(retryBtn) retryBtn.disabled = !hasWrong;
  if(reviewBtn) reviewBtn.disabled = !hasWrong;
}

function applyQuizStudioPreset(presetKey){
  const typeEl = document.getElementById("quiz-type");
  const countEl = document.getElementById("quiz-question-count");
  const optionsEl = document.getElementById("quiz-options-count");
  const starredEl = document.getElementById("quiz-only-starred");
  const wrongEl = document.getElementById("quiz-prefer-wrong");
  const confirmEl = document.getElementById("quiz-double-confirm");
  const preset = String(presetKey || "").trim().toLowerCase();
  if(typeEl && preset === "balanced") typeEl.value = "multiple_choice";
  if(countEl && preset === "balanced") countEl.value = "12";
  if(optionsEl && preset === "balanced") optionsEl.value = "4";
  if(starredEl && preset === "balanced") starredEl.checked = false;
  if(wrongEl && preset === "balanced") wrongEl.checked = false;
  if(confirmEl && preset === "balanced") confirmEl.checked = false;

  if(typeEl && preset === "exam") typeEl.value = "multiple_choice";
  if(countEl && preset === "exam") countEl.value = "25";
  if(optionsEl && preset === "exam") optionsEl.value = "6";
  if(starredEl && preset === "exam") starredEl.checked = false;
  if(wrongEl && preset === "exam") wrongEl.checked = false;
  if(confirmEl && preset === "exam") confirmEl.checked = true;

  if(typeEl && preset === "speed") typeEl.value = "typing";
  if(countEl && preset === "speed") countEl.value = "8";
  if(optionsEl && preset === "speed") optionsEl.value = "2";
  if(starredEl && preset === "speed") starredEl.checked = false;
  if(wrongEl && preset === "speed") wrongEl.checked = false;
  if(confirmEl && preset === "speed") confirmEl.checked = false;

  if(typeEl && preset === "recovery") typeEl.value = "multiple_choice";
  if(countEl && preset === "recovery") countEl.value = "15";
  if(optionsEl && preset === "recovery") optionsEl.value = "3";
  if(starredEl && preset === "recovery") starredEl.checked = false;
  if(wrongEl && preset === "recovery") wrongEl.checked = true;
  if(confirmEl && preset === "recovery") confirmEl.checked = false;
  renderQuizStudioInsights();
}

function retryLastWrongTermsFromStudio(){
  if(!quizLastFinishedState || !quizLastFinishedState.wrongAnswers || quizLastFinishedState.wrongAnswers.length === 0) return;
  const all = buildQuizCandidates(quizLastFinishedState.fromField, quizLastFinishedState.toField);
  const wanted = new Set(quizLastFinishedState.wrongAnswers.map(w => `${w.termId}::${w.fromTerm}::${w.correctToTerm}`));
  const retryItems = all.filter(c => wanted.has(`${c.termId}::${c.fromTerm}::${c.toTerm}`));
  startQuiz({ retryItems, configOverrides: { fromField: quizLastFinishedState.fromField, toField: quizLastFinishedState.toField } });
}

function renderQuizGeneratorUi(){
  const domainsEl = document.getElementById("quiz-domains");
  const subWrap = document.getElementById("quiz-subdivision-wrap");
  const sub1Label = document.getElementById("quiz-subdivision1-label");
  const sub1Sel = document.getElementById("quiz-subdivision1");
  const sub2Wrap = document.getElementById("quiz-subdivision2-wrap");
  const sub2Label = document.getElementById("quiz-subdivision2-label");
  const sub2Sel = document.getElementById("quiz-subdivision2");
  const frontSel = document.getElementById("quiz-front-field");
  const backSel = document.getElementById("quiz-back-field");
  const legacyFrom = document.getElementById("quiz-from");
  const legacyTo = document.getElementById("quiz-to");
  if(!domainsEl || !subWrap || !sub1Label || !sub1Sel || !sub2Wrap || !sub2Label || !sub2Sel || !frontSel || !backSel) return;
  if(!flashcardsV2State.loaded) return;

  if(!quizGeneratorDomainKey && flashcardsV2State.adapters.length){
    quizGeneratorDomainKey = flashcardsV2State.adapters[0].key;
  }

  domainsEl.innerHTML = flashcardsV2State.adapters.map(adapter => {
    const checked = adapter.key === quizGeneratorDomainKey ? " checked" : "";
    return `<label class="checkbox-item"><input type="radio" name="quiz-domain" data-quiz-domain="${escapeHTML(adapter.key)}"${checked} /> ${escapeHTML(localizeDatasetLabel(adapter.key, adapter.label))}</label>`;
  }).join("");

  const adapter = flashcardsV2State.adapterByKey.get(quizGeneratorDomainKey);
  const cfg = getFlashcardsSubdivisionConfig(adapter);
  const domainRows = flashcardsV2State.allTerms.filter(row => row && row._domain === quizGeneratorDomainKey);
  if(!cfg){
    subWrap.classList.add("hidden");
    sub2Wrap.classList.add("hidden");
    quizGeneratorSubdivision1 = [];
    quizGeneratorSubdivision2 = [];
    if(sub1Sel) sub1Sel.innerHTML = "";
    if(sub2Sel) sub2Sel.innerHTML = "";
  } else {
    subWrap.classList.remove("hidden");
    sub1Label.textContent = cfg.level1 ? cfg.level1.label : tOr("quiz_subdivision", "Subdivision");
    const opts1 = cfg.level1 ? getSubdivisionOptions(adapter, cfg.level1.key, domainRows) : [];
    const selectedLevel1 = normalizeSubdivisionSelection(quizGeneratorSubdivision1).filter(value => opts1.includes(value));
    quizGeneratorSubdivision1 = selectedLevel1;
    renderSubdivisionChecklist(sub1Sel, opts1, selectedLevel1, nextValues => {
      quizGeneratorSubdivision1 = nextValues;
      quizGeneratorSubdivision2 = [];
      renderQuizGeneratorUi();
      renderQuizStudioInsights();
    });

    if(cfg.level2){
      sub2Wrap.classList.remove("hidden");
      sub2Label.textContent = cfg.level2.label;
      const rows2 = subdivisionHasSelection(quizGeneratorSubdivision1)
        ? domainRows.filter(row => {
            const c1 = adapter.columns[cfg.level1.key];
            return normalizeSubdivisionSelection(quizGeneratorSubdivision1).includes(String(row[c1] || "").trim());
          })
        : domainRows;
      const opts2 = getSubdivisionOptions(adapter, cfg.level2.key, rows2);
      const selectedLevel2 = normalizeSubdivisionSelection(quizGeneratorSubdivision2).filter(value => opts2.includes(value));
      quizGeneratorSubdivision2 = selectedLevel2;
      renderSubdivisionChecklist(sub2Sel, opts2, selectedLevel2, nextValues => {
        quizGeneratorSubdivision2 = nextValues;
        renderQuizGeneratorUi();
        renderQuizStudioInsights();
      });
    } else {
      sub2Wrap.classList.add("hidden");
      quizGeneratorSubdivision2 = [];
      if(sub2Sel) sub2Sel.innerHTML = "";
    }
  }

  const options = getFieldOptionsForDomains([quizGeneratorDomainKey]);
  frontSel.innerHTML = options.map(opt => `<option value="${escapeHTML(opt.key)}">${escapeHTML(opt.label)}</option>`).join("");
  backSel.innerHTML = options.map(opt => `<option value="${escapeHTML(opt.key)}">${escapeHTML(opt.label)}</option>`).join("");
  const keys = options.map(opt => opt.key);
  if(!keys.includes(quizGeneratorFrontFieldKey)) quizGeneratorFrontFieldKey = keys[0] || "";
  if(!keys.includes(quizGeneratorBackFieldKey) || quizGeneratorBackFieldKey === quizGeneratorFrontFieldKey){
    quizGeneratorBackFieldKey = keys.find(k => k !== quizGeneratorFrontFieldKey) || quizGeneratorFrontFieldKey || "";
  }
  if(quizGeneratorFrontFieldKey) frontSel.value = quizGeneratorFrontFieldKey;
  if(quizGeneratorBackFieldKey) backSel.value = quizGeneratorBackFieldKey;

  if(legacyFrom) legacyFrom.value = makeDomainFieldPairKey(quizGeneratorDomainKey, quizGeneratorFrontFieldKey);
  if(legacyTo) legacyTo.value = makeDomainFieldPairKey(quizGeneratorDomainKey, quizGeneratorBackFieldKey);
}

function initQuizGeneratorUI(){
  const domainsEl = document.getElementById("quiz-domains");
  const sub1Sel = document.getElementById("quiz-subdivision1");
  const sub2Sel = document.getElementById("quiz-subdivision2");
  const frontSel = document.getElementById("quiz-front-field");
  const backSel = document.getElementById("quiz-back-field");
  const watchedIds = ["quiz-type", "quiz-question-count", "quiz-options-count", "quiz-timer", "quiz-only-starred", "quiz-prefer-wrong", "quiz-double-confirm"];
  if(!domainsEl || !sub1Sel || !sub2Sel || !frontSel || !backSel) return;
  if(domainsEl.dataset.bound === "1") return;
  domainsEl.dataset.bound = "1";

  ensureFlashcardsV2DataLoaded().then(()=>{
    renderQuizGeneratorUi();
    renderQuizStudioInsights();
  });

  domainsEl.addEventListener("change", (event)=>{
    const hit = event.target instanceof HTMLInputElement
      ? String(event.target.getAttribute("data-quiz-domain") || "")
      : "";
    if(!hit) return;
    quizGeneratorDomainKey = hit;
    quizGeneratorSubdivision1 = [];
    quizGeneratorSubdivision2 = [];
    quizGeneratorFrontFieldKey = "";
    quizGeneratorBackFieldKey = "";
    renderQuizGeneratorUi();
    renderQuizStudioInsights();
  });

  frontSel.addEventListener("change", ()=>{
    quizGeneratorFrontFieldKey = String(frontSel.value || "");
    if(quizGeneratorFrontFieldKey === String(backSel.value || "")){
      const alt = [...backSel.options].map(opt => opt.value).find(v => v !== quizGeneratorFrontFieldKey);
      if(alt){
        backSel.value = alt;
        quizGeneratorBackFieldKey = alt;
      }
    }
    renderQuizGeneratorUi();
    renderQuizStudioInsights();
  });

  backSel.addEventListener("change", ()=>{
    quizGeneratorBackFieldKey = String(backSel.value || "");
    if(quizGeneratorBackFieldKey === String(frontSel.value || "")){
      const alt = [...frontSel.options].map(opt => opt.value).find(v => v !== quizGeneratorBackFieldKey);
      if(alt){
        frontSel.value = alt;
        quizGeneratorFrontFieldKey = alt;
      }
    }
    renderQuizGeneratorUi();
    renderQuizStudioInsights();
  });

  watchedIds.forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    el.addEventListener("change", renderQuizStudioInsights);
  });
}

function setQuizSetupCollapsed(collapsed){
  const builderCard = document.getElementById("quiz-builder-card");
  const toggleBtn = document.getElementById("quiz-builder-toggle");
  const screen = document.getElementById("screen-quiz");
  const legacyToggle = document.getElementById("quiz-settings-toggle");
  if(builderCard) builderCard.classList.toggle("hidden", !!collapsed);
  if(screen) screen.classList.toggle("quiz-builder-collapsed", !!collapsed);
  if(toggleBtn){
    toggleBtn.classList.toggle("hidden", !collapsed);
    toggleBtn.textContent = tOr("quiz_builder_return", "Return to Quiz builder");
  }
  if(legacyToggle){
    legacyToggle.classList.add("hidden");
    legacyToggle.textContent = collapsed
      ? tOr("quiz_settings_show", "Show quiz settings")
      : tOr("quiz_settings_hide", "Hide quiz settings");
  }
  syncQuizSessionStageVisibility(!!collapsed);
}

function startQuiz({ retryItems = null, configOverrides = null } = {}){
  const area = document.getElementById('quiz-area');
  if(area) area.innerHTML = '';
  const defaults = readQuizSettings();
  const cfg = { ...defaults, ...(configOverrides || {}) };
  cfg.filters = { ...(defaults.filters || {}), ...((configOverrides && configOverrides.filters) || {}) };
  const sessionCandidates = resolveQuizCandidatesForSession({
    fromField: cfg.fromField,
    toField: cfg.toField,
    filters: cfg.filters,
    retryItems,
    termIds: cfg.termIds || null,
    customFilters: cfg.customFilters || null
  });
  cfg.questionCount = clampQuizQuestionCount(cfg.questionCount, sessionCandidates.length || 1);
  cfg.optionsCount = clampQuizOptionsCount(cfg.optionsCount);
  cfg.filters.timerSeconds = calculateQuizTimerSeconds({
    quizType: cfg.quizType,
    questionCount: cfg.questionCount,
    optionsCount: cfg.optionsCount,
    doubleConfirm: cfg.filters.doubleConfirm
  });
  const startRes = quizEngine.startQuiz({
    candidates: sessionCandidates,
    quizType: cfg.quizType || "multiple_choice",
    fromField: cfg.fromField,
    toField: cfg.toField,
    questionCount: cfg.questionCount,
    optionsCount: cfg.optionsCount,
    filters: { ...cfg.filters, customFilters: cfg.customFilters || null }
  });
  if(!startRes.ok){
    if(area) area.textContent = t(startRes.reason) || startRes.reason;
    renderQuizStats(quizEngine.getQuizState());
    syncQuizSessionStageVisibility(false);
    return;
  }
  setQuizSetupCollapsed(true);
  renderQuizUI();
}

function handleQuizKeyboardShortcuts(event){
  const quizState = quizEngine.getQuizState();
  if(!quizState.active) return;
  const screen = document.getElementById('screen-quiz');
  if(!screen || screen.classList.contains('hidden')) return;
  const q = quizState.currentQuestion;
  if(!q) return;
  if(q.type === "matching") return;

  if(q.type === "typing"){
    if(event.key === 'Enter'){
      if(!q.answered){
        const input = document.getElementById('quiz-typing-answer');
        if(input){
          event.preventDefault();
          const res = quizEngine.answerQuestion(q.id, input.value || "");
          if(res.ok) renderQuizUI();
        }
      } else {
        event.preventDefault();
        quizEngine.nextQuestion();
        renderQuizUI();
      }
    }
    return;
  }

  if(/^[1-6]$/.test(event.key) && !q.answered){
    const idx = Number(event.key) - 1;
    const option = q.options[idx];
    if(option){
      event.preventDefault();
      handleMultipleChoiceSelection(q, option.id);
    }
    return;
  }

  if(event.key === 'Enter' && !q.answered){
    const pendingOptionId = String(q.pendingOptionId || "");
    if(pendingOptionId && quizRequiresDoubleConfirm(quizState)){
      event.preventDefault();
      handleMultipleChoiceSelection(q, pendingOptionId);
    }
    return;
  }

  if(event.key === 'Enter' && q.answered){
    event.preventDefault();
    quizEngine.nextQuestion();
    renderQuizUI();
  }
}

const FLASHCARD_SCHEDULE_KEY = "flashcards/schedule_v1";
const FLASHCARD_STATS_KEY = "flashcards/stats_v1";
const FLASHCARD_CUSTOM_DECKS_KEY = "flashcards/custom_decks_v1";

const flashcardState = {
  categoryKey: "all",
  subcategoryKey: "all",
  deckId: "all",
  frontField: "english_translation",
  backField: "latin_translation",
  shuffle: false,
  terms: [],
  currentCard: null,
  flipped: false
};

function readFlashcardSchedule(){
  if(isProfileSessionActive()){
    const records = userProfile.flashcards.schedule && typeof userProfile.flashcards.schedule === "object"
      ? userProfile.flashcards.schedule
      : {};
    return { records: deepClone(records) };
  }
  return readJsonLS(FLASHCARD_SCHEDULE_KEY, { records: {} }) || { records: {} };
}

function writeFlashcardSchedule(data){
  if(isProfileSessionActive()){
    const records = data && data.records && typeof data.records === "object" ? data.records : {};
    userProfile.flashcards.schedule = deepClone(records);
    markProfileDirty();
    return;
  }
  writeJsonLS(FLASHCARD_SCHEDULE_KEY, data || { records: {} });
}

function readFlashcardStats(){
  if(isProfileSessionActive()){
    const stats = userProfile.flashcards.stats && typeof userProfile.flashcards.stats === "object"
      ? userProfile.flashcards.stats
      : {};
    return deepClone(stats);
  }
  return readJsonLS(FLASHCARD_STATS_KEY, {}) || {};
}

function writeFlashcardStats(data){
  if(isProfileSessionActive()){
    userProfile.flashcards.stats = data && typeof data === "object" ? deepClone(data) : {};
    markProfileDirty();
    return;
  }
  writeJsonLS(FLASHCARD_STATS_KEY, data || {});
}

function getTodayIsoDate(){
  return new Date().toISOString().slice(0, 10);
}

function getTodayFlashcardStats(){
  const all = readFlashcardStats();
  return all[getTodayIsoDate()] || { reviewed: 0, correct: 0, streak: 0, longestStreak: 0 };
}

function updateTodayFlashcardStats(isCorrect){
  const all = readFlashcardStats();
  const key = getTodayIsoDate();
  const row = all[key] || { reviewed: 0, correct: 0, streak: 0, longestStreak: 0 };
  row.reviewed += 1;
  if(isCorrect){
    row.correct += 1;
    row.streak += 1;
    row.longestStreak = Math.max(row.longestStreak, row.streak);
  } else {
    row.streak = 0;
  }
  all[key] = row;
  writeFlashcardStats(all);
}

function getUserTermId(row){
  const idPart = String((row && row.id) || "").trim();
  if(idPart) return `user:${idPart}`;
  const fallback = `${String((row && row.english) || "").trim()}|${String((row && row.latin) || "").trim()}`;
  return `user:${fallback}`;
}

function computeFlashcardCounters(terms, frontField, backField, deckId){
  const now = Date.now();
  let dueNow = 0;
  let newCards = 0;
  let learned = 0;
  for(const term of terms){
    const rec = getFlashcardRecord(term.termId, frontField, backField, deckId);
    if(!rec){
      newCards += 1;
      continue;
    }
    if((Number(rec.reps) || 0) > 0) learned += 1;
    const dueAtMs = rec.dueAt ? new Date(rec.dueAt).getTime() : 0;
    if(dueAtMs <= now) dueNow += 1;
  }
  return { dueNow, newCards, learned };
}

function getNextDueCard(terms, frontField, backField, deckId, shuffleMode){
  const now = Date.now();
  const due = [];
  const fresh = [];
  for(const term of terms){
    const rec = getFlashcardRecord(term.termId, frontField, backField, deckId);
    if(!rec){
      fresh.push({ term, rec: null });
      continue;
    }
    const dueAtMs = rec.dueAt ? new Date(rec.dueAt).getTime() : 0;
    if(dueAtMs <= now){
      due.push({ term, rec, dueAtMs });
    }
  }
  if(due.length > 0){
    if(shuffleMode){
      return due[Math.floor(Math.random() * due.length)].term;
    }
    due.sort((a, b)=>a.dueAtMs - b.dueAtMs);
    return due[0].term;
  }
  if(fresh.length > 0){
    if(shuffleMode){
      return fresh[Math.floor(Math.random() * fresh.length)].term;
    }
    return fresh[0].term;
  }
  return null;
}

const flashcardEngine = {
  startSession({ categoryKey, subcategoryKey, deckId, frontField, backField, shuffle }){
    let terms = buildFlashcardTerms();
    terms = filterTermsByCategoryAndSubdivision(terms, categoryKey, subcategoryKey);
    terms = filterTermsByDeck(terms, deckId);
    terms = filterTermsByLanguages(terms, frontField, backField);
    flashcardState.categoryKey = categoryKey;
    flashcardState.subcategoryKey = subcategoryKey;
    flashcardState.deckId = deckId;
    flashcardState.frontField = frontField;
    flashcardState.backField = backField;
    flashcardState.shuffle = !!shuffle;
    flashcardState.terms = terms;
    flashcardState.currentCard = getNextDueCard(terms, frontField, backField, deckId, !!shuffle);
    flashcardState.flipped = false;
    return this.getState();
  },
  flipCurrent(){
    if(!flashcardState.currentCard) return this.getState();
    flashcardState.flipped = !flashcardState.flipped;
    return this.getState();
  },
  gradeCurrent(grade){
    const card = flashcardState.currentCard;
    if(!card) return this.getState();
    const frontField = flashcardState.frontField;
    const backField = flashcardState.backField;
    const deckId = flashcardState.deckId;
    const now = new Date();
    const current = getFlashcardRecord(card.termId, frontField, backField, deckId) || {
      intervalDays: 0,
      ease: 2.5,
      reps: 0,
      lapses: 0,
      seenCount: 0
    };
    let ease = Number(current.ease || 2.5);
    let reps = Number(current.reps || 0);
    let intervalDays = Number(current.intervalDays || 0);
    let dueAt = new Date(now.getTime());

    if(grade === "again"){
      reps = 0;
      intervalDays = 0;
      ease = Math.max(1.3, ease - 0.2);
      current.lapses = Number(current.lapses || 0) + 1;
      dueAt = new Date(now.getTime() + 60 * 1000);
      updateTodayFlashcardStats(false);
    } else if(grade === "hard"){
      reps += 1;
      intervalDays = reps <= 1 ? 1 : Math.max(1, Math.round(Math.max(1, intervalDays) * 1.2));
      ease = Math.max(1.3, ease - 0.15);
      dueAt = new Date(now.getTime() + intervalDays * 86400000);
      updateTodayFlashcardStats(true);
    } else if(grade === "good"){
      reps += 1;
      if(reps === 1) intervalDays = 1;
      else if(reps === 2) intervalDays = 3;
      else intervalDays = Math.max(1, Math.round(Math.max(1, intervalDays) * ease));
      dueAt = new Date(now.getTime() + intervalDays * 86400000);
      updateTodayFlashcardStats(true);
    } else {
      reps += 1;
      if(reps === 1) intervalDays = 3;
      else intervalDays = Math.max(1, Math.round(Math.max(1, intervalDays) * ease * 1.3));
      ease = Math.min(3.0, ease + 0.1);
      dueAt = new Date(now.getTime() + intervalDays * 86400000);
      updateTodayFlashcardStats(true);
    }

    setFlashcardRecord(card.termId, frontField, backField, deckId, {
      ...current,
      intervalDays,
      ease,
      reps,
      seenCount: Number(current.seenCount || 0) + 1,
      lastGrade: grade,
      lastReviewedAt: now.toISOString(),
      dueAt: dueAt.toISOString()
    });

    flashcardState.currentCard = getNextDueCard(
      flashcardState.terms,
      flashcardState.frontField,
      flashcardState.backField,
      flashcardState.deckId,
      flashcardState.shuffle
    );
    flashcardState.flipped = false;
    return this.getState();
  },
  resetCurrentDeckProgress(){
    removeFlashcardDeckProgress(
      flashcardState.frontField,
      flashcardState.backField,
      flashcardState.deckId
    );
    flashcardState.currentCard = getNextDueCard(
      flashcardState.terms,
      flashcardState.frontField,
      flashcardState.backField,
      flashcardState.deckId,
      flashcardState.shuffle
    );
    flashcardState.flipped = false;
    return this.getState();
  },
  getState(){
    const counters = computeFlashcardCounters(
      flashcardState.terms,
      flashcardState.frontField,
      flashcardState.backField,
      flashcardState.deckId
    );
    const today = getTodayFlashcardStats();
    return {
      ...flashcardState,
      counters,
      today
    };
  }
};

function setFlashcardCustomMessage(text){
  const msg = document.getElementById("flashcard-custom-msg");
  if(msg) msg.textContent = text || "";
}

function parseCustomCardTags(raw){
  return String(raw || "").split(",").map(x => x.trim()).filter(Boolean);
}

function renderFlashcardCustomDeckSelectors(){
  const manageSel = document.getElementById("flashcard-manage-deck-select");
  const cardDeckSel = document.getElementById("flashcard-custom-card-deck");
  const rows = getCustomDeckRows();
  const html = rows.length
    ? rows.map(d => `<option value="${escapeHTML(d.id)}">${escapeHTML(d.name || "Custom deck")}</option>`).join("")
    : '<option value="">No custom decks</option>';
  if(manageSel){
    const cur = manageSel.value;
    manageSel.innerHTML = html;
    if(rows.some(d => d.id === cur)) manageSel.value = cur;
  }
  if(cardDeckSel){
    const cur = cardDeckSel.value;
    cardDeckSel.innerHTML = html;
    if(rows.some(d => d.id === cur)) cardDeckSel.value = cur;
  }
}

function renderCustomCardSelect(){
  const cardSel = document.getElementById("flashcard-custom-card-select");
  const deckSel = document.getElementById("flashcard-custom-card-deck");
  if(!cardSel || !deckSel) return;
  const deckId = String(deckSel.value || "");
  const cards = deckId ? appStorage.getCardsByDeckSync(deckId) : [];
  if(cards.length < 1){
    cardSel.innerHTML = '<option value="">No cards in selected deck</option>';
    return;
  }
  cardSel.innerHTML = ['<option value="">Select card</option>']
    .concat(cards.map(c => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.frontText || "(untitled)")}</option>`))
    .join("");
}

function clearCustomCardEditor(){
  flashcardState.editingCustomCardId = null;
  ["flashcard-custom-front","flashcard-custom-back","flashcard-custom-notes","flashcard-custom-tags"].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.value = "";
  });
  const sel = document.getElementById("flashcard-custom-card-select");
  if(sel) sel.value = "";
}

function loadCustomCardEditor(cardId){
  const id = String(cardId || "");
  if(!id){
    clearCustomCardEditor();
    return;
  }
  const hit = appStorage.getCardsSync().find(c => c && c.id === id);
  if(!hit) return;
  flashcardState.editingCustomCardId = hit.id;
  const put = (elId, value)=>{ const el = document.getElementById(elId); if(el) el.value = value; };
  put("flashcard-custom-front", hit.frontText || "");
  put("flashcard-custom-back", hit.backText || "");
  put("flashcard-custom-notes", hit.notes || "");
  put("flashcard-custom-tags", Array.isArray(hit.tags) ? hit.tags.join(", ") : "");
  const deckSel = document.getElementById("flashcard-custom-card-deck");
  if(deckSel) deckSel.value = hit.deckId || "";
}

function saveCustomCardFromEditor(){
  const deckId = String(document.getElementById("flashcard-custom-card-deck")?.value || "");
  const frontText = String(document.getElementById("flashcard-custom-front")?.value || "").trim();
  const backText = String(document.getElementById("flashcard-custom-back")?.value || "").trim();
  const notes = String(document.getElementById("flashcard-custom-notes")?.value || "").trim();
  const tags = parseCustomCardTags(document.getElementById("flashcard-custom-tags")?.value || "");
  if(!deckId){
    setFlashcardCustomMessage("Select a deck first.");
    return;
  }
  if(!frontText || !backText){
    setFlashcardCustomMessage("Front and back text are required.");
    return;
  }
  const existing = flashcardState.editingCustomCardId
    ? appStorage.getCardsSync().find(c => c && c.id === flashcardState.editingCustomCardId)
    : null;
  const saved = appStorage.upsertCard({
    id: existing ? existing.id : null,
    createdAt: existing ? existing.createdAt : null,
    deckId,
    frontText,
    backText,
    notes,
    tags
  });
  flashcardState.editingCustomCardId = saved.id;
  setFlashcardCustomMessage("Card saved.");
  refreshFlashcardsSession();
}

function deleteCustomCardFromEditor(){
  const selected = String(document.getElementById("flashcard-custom-card-select")?.value || flashcardState.editingCustomCardId || "");
  if(!selected){
    setFlashcardCustomMessage("Select a card first.");
    return;
  }
  if(!confirm("Delete selected card?")) return;
  appStorage.deleteCard(selected);
  clearCustomCardEditor();
  setFlashcardCustomMessage("Card deleted.");
  refreshFlashcardsSession();
}

function importCustomCardsCsv(text, deckId){
  const rows = parseCSVLines(text || "");
  if(rows.length < 2) return 0;
  const parsed = rowsToObjectsWithHeaders(rows);
  let inserted = 0;
  for(const row of (parsed.objects || [])){
    const frontText = String(row.front || row.frontText || "").trim();
    const backText = String(row.back || row.backText || "").trim();
    if(!frontText || !backText) continue;
    const notes = String(row.notes || "").trim();
    const tags = String(row.tags || "").split(/[;,]/).map(x => x.trim()).filter(Boolean);
    appStorage.upsertCard({ deckId, frontText, backText, notes, tags });
    inserted += 1;
  }
  return inserted;
}

function renderFlashcardDeckSelect(){
  const select = document.getElementById("flashcard-deck-select");
  if(!select) return;
  const custom = getCustomDeckRows();
  const options = [
    { id: "all", label: "All terms" },
    { id: "starred", label: "Starred terms" },
    { id: "wrong", label: "Wrong terms (review list)" },
    ...custom.map(d => ({ id: `custom:${d.id}`, label: `Custom deck: ${d.name}` }))
  ];
  const ids = new Set(options.map(o => o.id));
  if(!ids.has(flashcardState.deckId)) flashcardState.deckId = "all";
  select.innerHTML = options.map(opt => `<option value="${escapeHTML(opt.id)}"${opt.id === flashcardState.deckId ? " selected" : ""}>${escapeHTML(opt.label)}</option>`).join("");
}

const FLASHCARD_FIELD_EXCLUDE = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "created_at",
  "updated_at",
  "termId",
  "customCardId",
  "customDeckId",
  "sourceType",
  "sourceDataset",
  "baseTermKey",
  "userTermId",
  "frontText",
  "backText"
]);

const FLASHCARD_FIELD_PREFERRED_ORDER = [
  "english_translation",
  "german_translation",
  "slovak_translation",
  "latin_translation",
  "english_definition",
  "german_definition",
  "slovak_definition",
  "notes",
  "abbreviation",
  "category"
];

const FLASHCARD_FIELD_LABELS = {
  english_translation: "English",
  german_translation: "German",
  slovak_translation: "Slovak",
  latin_translation: "Latin",
  english_definition: "English definition",
  german_definition: "German definition",
  slovak_definition: "Slovak definition"
};

function getFlashcardCategoryLabel(categoryKey){
  const key = String(categoryKey || "all");
  if(key === "all") return "All categories";
  if(key === "source:manual_entry") return "Manual entries";
  if(key === "source:custom_cards") return "Custom cards";
  if(key.startsWith("group:")){
    const groupKey = key.slice("group:".length);
    return SEARCH_GROUP_LABEL_BY_KEY[groupKey] || formatHeaderLabel(groupKey);
  }
  return "Category";
}

function getFlashcardSourceEntries(terms){
  const byPath = new Map();
  for(const term of (terms || [])){
    if(!term || term.sourceType !== "base") continue;
    const sourcePath = String(term.__sourcePath || "").trim();
    if(!sourcePath || byPath.has(sourcePath)) continue;
    byPath.set(sourcePath, {
      id: `source:${sourcePath}`,
      sourcePath,
      groupKey: String(term.__group || ""),
      datasetKey: String(term.__dataset || ""),
      datasetLabel: String(term.__datasetLabel || term.__dataset || "Dataset"),
      sourceLabel: String(term.__sourceLabel || term.__datasetLabel || term.__dataset || "Source")
    });
  }
  return [...byPath.values()];
}

function filterTermsByCategoryAndSubdivision(terms, categoryKey, subcategoryKey){
  const category = String(categoryKey || "all");
  const subdivision = String(subcategoryKey || "all");
  let rows = (terms || []).slice();

  if(category.startsWith("group:")){
    const groupKey = category.slice("group:".length);
    rows = rows.filter(term => term && term.sourceType === "base" && String(term.__group || "") === groupKey);
  } else if(category === "source:manual_entry"){
    rows = rows.filter(term => term && term.sourceType === "user");
  } else if(category === "source:custom_cards"){
    rows = rows.filter(term => term && term.sourceType === "custom");
  }

  if(subdivision !== "all" && subdivision.startsWith("source:")){
    const sourcePath = subdivision.slice("source:".length);
    rows = rows.filter(term => term && String(term.__sourcePath || "") === sourcePath);
  }
  return rows;
}

function getFlashcardFieldOptions(terms){
  const found = new Set();
  for(const term of (terms || [])){
    if(!term || term.sourceType === "custom") continue;
    for(const field of Object.keys(term)){
      if(!field || field.startsWith("__") || FLASHCARD_FIELD_EXCLUDE.has(field)) continue;
      const value = String(term[field] || "").trim();
      if(value) found.add(field);
    }
  }
  if(found.size === 0){
    found.add("english_translation");
    found.add("latin_translation");
  }
  const sorted = [...found].sort((a, b)=>{
    const ia = FLASHCARD_FIELD_PREFERRED_ORDER.indexOf(a);
    const ib = FLASHCARD_FIELD_PREFERRED_ORDER.indexOf(b);
    if(ia >= 0 || ib >= 0){
      if(ia < 0) return 1;
      if(ib < 0) return -1;
      return ia - ib;
    }
    return a.localeCompare(b);
  });
  return sorted.map(field => ({
    field,
    label: FLASHCARD_FIELD_LABELS[field] || formatHeaderLabel(field)
  }));
}

function normalizeFlashcardFieldSelection(scopeTerms){
  const options = getFlashcardFieldOptions(scopeTerms);
  const ids = new Set(options.map(x => x.field));
  if(!ids.has(flashcardState.frontField)){
    flashcardState.frontField = options[0] ? options[0].field : "english_translation";
  }
  if(!ids.has(flashcardState.backField)){
    const fallback = options.find(x => x.field !== flashcardState.frontField);
    flashcardState.backField = fallback ? fallback.field : flashcardState.frontField;
  }
  return options;
}

function renderFlashcardCategorySelect(terms){
  const select = document.getElementById("flashcard-category-select");
  if(!select) return;
  const options = [
    { id: "all", label: "All categories" },
    ...SEARCH_GROUP_DEFINITIONS.map(group => ({ id: `group:${group.key}`, label: group.label })),
    { id: "source:manual_entry", label: "Manual entries" },
    { id: "source:custom_cards", label: "Custom cards" }
  ];
  const ids = new Set(options.map(opt => opt.id));
  if(!ids.has(flashcardState.categoryKey)) flashcardState.categoryKey = "all";
  select.innerHTML = options.map(opt => `<option value="${escapeHTML(opt.id)}"${opt.id === flashcardState.categoryKey ? " selected" : ""}>${escapeHTML(opt.label)}</option>`).join("");
}

function renderFlashcardSubdivisionSelect(terms){
  const select = document.getElementById("flashcard-subcategory-select");
  if(!select) return;
  const sourceEntries = getFlashcardSourceEntries(terms);
  let entries = sourceEntries;
  if(String(flashcardState.categoryKey || "").startsWith("group:")){
    const groupKey = String(flashcardState.categoryKey).slice("group:".length);
    entries = entries.filter(entry => entry.groupKey === groupKey);
  } else if(flashcardState.categoryKey === "source:manual_entry" || flashcardState.categoryKey === "source:custom_cards"){
    entries = [];
  }
  const options = [
    { id: "all", label: "All subdivisions" },
    ...entries.map(entry => ({
      id: entry.id,
      label: entry.datasetLabel === entry.sourceLabel
        ? entry.sourceLabel
        : `${entry.datasetLabel}: ${entry.sourceLabel}`
    }))
  ];
  const ids = new Set(options.map(opt => opt.id));
  if(!ids.has(flashcardState.subcategoryKey)) flashcardState.subcategoryKey = "all";
  select.disabled = options.length <= 1;
  select.innerHTML = options.map(opt => `<option value="${escapeHTML(opt.id)}"${opt.id === flashcardState.subcategoryKey ? " selected" : ""}>${escapeHTML(opt.label)}</option>`).join("");
}

function renderFlashcardsUI(){
  const categorySel = document.getElementById("flashcard-category-select");
  const subcategorySel = document.getElementById("flashcard-subcategory-select");
  const deckSel = document.getElementById("flashcard-deck-select");
  const frontSel = document.getElementById("flashcard-front-lang");
  const backSel = document.getElementById("flashcard-back-lang");
  const countersEl = document.getElementById("flashcard-counters");
  const statsEl = document.getElementById("flashcard-stats");
  const cardBtn = document.getElementById("flashcard-card");
  const frontText = document.getElementById("flashcard-front-text");
  const backText = document.getElementById("flashcard-back-text");
  const backDef = document.getElementById("flashcard-back-def");
  const grades = document.getElementById("flashcard-grades");
  if(!categorySel || !subcategorySel || !deckSel || !frontSel || !backSel || !countersEl || !statsEl || !cardBtn || !frontText || !backText || !backDef || !grades) return;

  const allTerms = buildFlashcardTerms();
  const termScope = filterTermsByDeck(
    filterTermsByCategoryAndSubdivision(allTerms, flashcardState.categoryKey, flashcardState.subcategoryKey),
    flashcardState.deckId
  );
  const fieldOptions = normalizeFlashcardFieldSelection(termScope);

  renderFlashcardCategorySelect(allTerms);
  renderFlashcardSubdivisionSelect(allTerms);
  renderFlashcardDeckSelect();
  renderFlashcardCustomDeckSelectors();
  renderCustomCardSelect();
  frontSel.innerHTML = fieldOptions.map(opt => `<option value="${escapeHTML(opt.field)}"${opt.field === flashcardState.frontField ? " selected" : ""}>${escapeHTML(opt.label)}</option>`).join("");
  backSel.innerHTML = fieldOptions.map(opt => `<option value="${escapeHTML(opt.field)}"${opt.field === flashcardState.backField ? " selected" : ""}>${escapeHTML(opt.label)}</option>`).join("");

  const s = flashcardEngine.getState();
  countersEl.textContent = `Category: ${getFlashcardCategoryLabel(s.categoryKey)} | Deck: ${getDeckLabel(s.deckId)} | Due now: ${s.counters.dueNow} | New: ${s.counters.newCards} | Learned: ${s.counters.learned}`;

  const reviewed = Number(s.today.reviewed || 0);
  const correct = Number(s.today.correct || 0);
  const accuracy = reviewed > 0 ? Math.round((correct / reviewed) * 100) : 0;
  statsEl.textContent = `Cards reviewed today: ${reviewed} | Accuracy today: ${accuracy}% | Longest streak: ${Number(s.today.longestStreak || 0)}`;

  if(!s.currentCard){
    frontText.textContent = "No cards due now.";
    backText.textContent = "Change deck, languages, or reset progress.";
    backDef.textContent = "";
    cardBtn.classList.remove("is-flipped");
    grades.classList.add("hidden");
    return;
  }

  const card = s.currentCard;
  frontText.textContent = getFlashcardFrontText(card, s.frontField);
  backText.textContent = getFlashcardBackText(card, s.backField);
  backDef.textContent = getFlashcardDefinition(card, s.backField);
  if(s.flipped){
    cardBtn.classList.add("is-flipped");
    grades.classList.remove("hidden");
  } else {
    cardBtn.classList.remove("is-flipped");
    grades.classList.add("hidden");
  }
}

function refreshFlashcardsSession(){
  if(!document.getElementById("flashcard-deck-select")) return;
  const scoped = filterTermsByDeck(
    filterTermsByCategoryAndSubdivision(buildFlashcardTerms(), flashcardState.categoryKey, flashcardState.subcategoryKey),
    flashcardState.deckId
  );
  normalizeFlashcardFieldSelection(scoped);
  flashcardEngine.startSession({
    categoryKey: flashcardState.categoryKey,
    subcategoryKey: flashcardState.subcategoryKey,
    deckId: flashcardState.deckId,
    frontField: flashcardState.frontField,
    backField: flashcardState.backField,
    shuffle: flashcardState.shuffle
  });
  renderFlashcardsUI();
}

function createCustomFlashcardDeck(){
  const name = String(window.prompt("Custom deck name:", "My deck") || "").trim();
  if(!name) return null;
  const deck = appStorage.createDeck({ name, termIds: [] });
  flashcardState.deckId = `custom:${deck.id}`;
  return deck;
}

function renameCustomFlashcardDeck(deckId){
  const id = String(deckId || "");
  if(!id) return;
  const row = getCustomDeckRows().find(d => d && d.id === id);
  if(!row) return;
  const name = String(window.prompt("Rename deck:", row.name || "Custom deck") || "").trim();
  if(!name) return;
  appStorage.updateDeck(id, { name });
}

function deleteCustomFlashcardDeck(deckId){
  const id = String(deckId || "");
  if(!id) return;
  const row = getCustomDeckRows().find(d => d && d.id === id);
  if(!row) return;
  if(!confirm(`Delete deck "${row.name}" and all its custom cards?`)) return;
  appStorage.deleteDeck(id);
  if(flashcardState.deckId === `custom:${id}`) flashcardState.deckId = "all";
}

function addCurrentCardToCustomDeck(){
  const card = flashcardState.currentCard;
  if(!card) return;
  let deckId = flashcardState.deckId;
  if(!String(deckId || "").startsWith("custom:")){
    const decks = getCustomDeckRows();
    if(decks.length === 0){
      const created = createCustomFlashcardDeck();
      if(!created) return;
      deckId = `custom:${created.id}`;
    } else {
      deckId = `custom:${decks[0].id}`;
      flashcardState.deckId = deckId;
    }
  }
  if(!String(deckId).startsWith("custom:")) return;
  const id = String(deckId).slice("custom:".length);
  const hit = getCustomDeckRows().find(d => d && d.id === id);
  if(!hit) return;
  const set = new Set(hit.termIds || []);
  set.add(card.termId);
  appStorage.updateDeck(id, { termIds: [...set] });
  renderFlashcardsUI();
}

function initFlashcardsUI(){
  if(!document.getElementById("flashcard-deck-select")) return;
  const categorySel = document.getElementById("flashcard-category-select");
  const subcategorySel = document.getElementById("flashcard-subcategory-select");
  const deckSel = document.getElementById("flashcard-deck-select");
  const frontSel = document.getElementById("flashcard-front-lang");
  const backSel = document.getElementById("flashcard-back-lang");
  const cardBtn = document.getElementById("flashcard-card");
  const grades = document.getElementById("flashcard-grades");
  const manageDeckSel = document.getElementById("flashcard-manage-deck-select");
  const customDeckSel = document.getElementById("flashcard-custom-card-deck");
  const customCardSel = document.getElementById("flashcard-custom-card-select");

  if(categorySel){
    categorySel.addEventListener("change", ()=>{
      flashcardState.categoryKey = categorySel.value || "all";
      flashcardState.subcategoryKey = "all";
      refreshFlashcardsSession();
    });
  }
  if(subcategorySel){
    subcategorySel.addEventListener("change", ()=>{
      flashcardState.subcategoryKey = subcategorySel.value || "all";
      refreshFlashcardsSession();
    });
  }
  if(deckSel){
    deckSel.addEventListener("change", ()=>{
      flashcardState.deckId = deckSel.value;
      refreshFlashcardsSession();
    });
  }
  if(frontSel){
    frontSel.addEventListener("change", ()=>{
      flashcardState.frontField = frontSel.value;
      refreshFlashcardsSession();
    });
  }
  if(backSel){
    backSel.addEventListener("change", ()=>{
      flashcardState.backField = backSel.value;
      refreshFlashcardsSession();
    });
  }
  if(cardBtn){
    cardBtn.addEventListener("click", ()=>{
      flashcardEngine.flipCurrent();
      renderFlashcardsUI();
    });
  }
  if(grades){
    grades.addEventListener("click", (event)=>{
      const btn = event.target instanceof Element ? event.target.closest("[data-grade]") : null;
      if(!btn) return;
      const grade = btn.getAttribute("data-grade");
      if(!grade) return;
      flashcardEngine.gradeCurrent(grade);
      renderFlashcardsUI();
    });
  }

  if(manageDeckSel){
    manageDeckSel.addEventListener("change", ()=>{
      const id = String(manageDeckSel.value || "");
      if(customDeckSel && id) customDeckSel.value = id;
      renderCustomCardSelect();
    });
  }
  if(customDeckSel){
    customDeckSel.addEventListener("change", ()=> renderCustomCardSelect());
  }
  if(customCardSel){
    customCardSel.addEventListener("change", ()=> loadCustomCardEditor(customCardSel.value));
  }

  on("flashcard-shuffle", "click", ()=>{
    flashcardState.shuffle = !flashcardState.shuffle;
    refreshFlashcardsSession();
  });
  on("flashcard-reset-progress", "click", ()=>{
    if(confirm("Reset progress for this deck and language pair?")){
      flashcardEngine.resetCurrentDeckProgress();
      renderFlashcardsUI();
    }
  });
  on("flashcard-add-star", "click", ()=> addCurrentFlashcardToStarred());
  on("flashcard-create-custom", "click", ()=>{
    const created = createCustomFlashcardDeck();
    if(created){
      setFlashcardCustomMessage(`Deck "${created.name}" created.`);
      refreshFlashcardsSession();
    }
  });
  on("flashcard-add-custom", "click", ()=> addCurrentCardToCustomDeck());

  on("flashcard-deck-create", "click", ()=>{
    const created = createCustomFlashcardDeck();
    if(created){
      setFlashcardCustomMessage(`Deck "${created.name}" created.`);
      refreshFlashcardsSession();
    }
  });
  on("flashcard-deck-rename", "click", ()=>{
    const id = String(document.getElementById("flashcard-manage-deck-select")?.value || "");
    renameCustomFlashcardDeck(id);
    refreshFlashcardsSession();
  });
  on("flashcard-deck-delete", "click", ()=>{
    const id = String(document.getElementById("flashcard-manage-deck-select")?.value || "");
    deleteCustomFlashcardDeck(id);
    clearCustomCardEditor();
    refreshFlashcardsSession();
  });
  on("flashcard-deck-export-file", "click", async ()=>{
    const id = String(document.getElementById("flashcard-manage-deck-select")?.value || "");
    if(!id){
      setFlashcardCustomMessage("Select a deck first.");
      return;
    }
    const doc = buildDeckExportDocument(id);
    if(!doc){
      setFlashcardCustomMessage("Deck not found.");
      return;
    }
    const fileName = `deck_${toFileSafeName(doc.name, "deck")}_${dateStampYmd()}.mdjlf_deck.json`;
    try{
      await saveJsonToFile({ suggestedName: fileName, data: doc });
      setFlashcardCustomMessage(`Deck "${doc.name}" saved to file.`);
    }catch(e){
      setFlashcardCustomMessage(`Save failed: ${e.message || e}`);
    }
  });
  on("flashcard-deck-import-file", "click", async ()=>{
    try{
      const loaded = await loadJsonFromFile();
      if(!loaded) return;
      const importedDeckId = importDeckDocument(loaded.parsed);
      clearCustomCardEditor();
      refreshFlashcardsSession();
      const manageSel = document.getElementById("flashcard-manage-deck-select");
      if(manageSel) manageSel.value = importedDeckId;
      const cardDeckSel = document.getElementById("flashcard-custom-card-deck");
      if(cardDeckSel) cardDeckSel.value = importedDeckId;
      renderCustomCardSelect();
      const deck = getCustomDeckRows().find(d => d && d.id === importedDeckId);
      setFlashcardCustomMessage(`Imported deck "${deck ? deck.name : importedDeckId}".`);
    }catch(e){
      setFlashcardCustomMessage(`Import failed: ${e.message || e}`);
    }
  });
  on("flashcard-custom-new", "click", ()=>{
    clearCustomCardEditor();
    setFlashcardCustomMessage("");
  });
  on("flashcard-custom-save", "click", ()=> saveCustomCardFromEditor());
  on("flashcard-custom-delete", "click", ()=> deleteCustomCardFromEditor());
  on("flashcard-custom-import-btn", "click", async ()=>{
    const fileInput = document.getElementById("flashcard-custom-import-file");
    const deckId = String(document.getElementById("flashcard-custom-card-deck")?.value || "");
    const file = fileInput && fileInput.files ? fileInput.files[0] : null;
    if(!deckId){
      setFlashcardCustomMessage("Select a destination deck first.");
      return;
    }
    if(!file){
      setFlashcardCustomMessage("Choose CSV file first.");
      return;
    }
    try{
      const txt = await file.text();
      const inserted = importCustomCardsCsv(txt, deckId);
      setFlashcardCustomMessage(`Imported ${inserted} cards.`);
      refreshFlashcardsSession();
      if(fileInput) fileInput.value = "";
    }catch(e){
      setFlashcardCustomMessage(`Import failed: ${e.message || e}`);
    }
  });
}

const FLASHCARD_MIGRATION_KEY = "flashcards/idb_migrated_v1";
const FLASHCARD_GUEST_STORE_KEY = "flashcards/guest_store_v1";

function createProfileBackedStorage(){
  let ready = false;
  const guest = {
    decks: [],
    cards: [],
    scheduling: {}
  };

  function generateId(prefix){
    if(typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function"){
      return `${prefix}${crypto.randomUUID()}`;
    }
    return `${prefix}${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  }

  function nowTs(){
    return nowIso();
  }

  function ensureReady(){
    if(!ready) throw new Error("Storage not initialized");
  }

  function normalizeGuestSnapshot(raw){
    const next = raw && typeof raw === "object" ? raw : {};
    return {
      decks: Array.isArray(next.decks) ? next.decks.filter(Boolean) : [],
      cards: Array.isArray(next.cards) ? next.cards.filter(Boolean) : [],
      scheduling: next.scheduling && typeof next.scheduling === "object" ? next.scheduling : {}
    };
  }

  function saveGuest(){
    writeJsonLS(FLASHCARD_GUEST_STORE_KEY, {
      decks: guest.decks,
      cards: guest.cards,
      scheduling: guest.scheduling
    });
  }

  function getProfileDeckMap(){
    userProfile = ensureProfileShape(userProfile);
    if(!userProfile.flashcards.decks || typeof userProfile.flashcards.decks !== "object"){
      userProfile.flashcards.decks = {};
    }
    return userProfile.flashcards.decks;
  }

  function getProfileCardMap(){
    userProfile = ensureProfileShape(userProfile);
    if(!userProfile.flashcards.cards || typeof userProfile.flashcards.cards !== "object"){
      userProfile.flashcards.cards = {};
    }
    return userProfile.flashcards.cards;
  }

  function getProfileScheduleMap(){
    userProfile = ensureProfileShape(userProfile);
    if(!userProfile.flashcards.schedule || typeof userProfile.flashcards.schedule !== "object"){
      userProfile.flashcards.schedule = {};
    }
    return userProfile.flashcards.schedule;
  }

  function getDeckRows(){
    if(isProfileSessionActive()){
      return Object.values(getProfileDeckMap()).map(deepClone);
    }
    return guest.decks.map(deepClone);
  }

  function getCardRows(){
    if(isProfileSessionActive()){
      return Object.values(getProfileCardMap()).map(deepClone);
    }
    return guest.cards.map(deepClone);
  }

  function getScheduleMap(){
    if(isProfileSessionActive()){
      return deepClone(getProfileScheduleMap());
    }
    return deepClone(guest.scheduling);
  }

  function markDeckSave(){
    if(isProfileSessionActive()){
      markProfileDirty();
      saveUserProfileNow("save_deck");
    } else {
      saveGuest();
    }
  }

  return {
    async init(){
      if(ready) return;
      const loaded = normalizeGuestSnapshot(readJsonLS(FLASHCARD_GUEST_STORE_KEY, null));
      guest.decks = loaded.decks;
      guest.cards = loaded.cards;
      guest.scheduling = loaded.scheduling;
      ready = true;
    },
    getDecksSync(){
      ensureReady();
      return getDeckRows();
    },
    getCardsSync(){
      ensureReady();
      return getCardRows();
    },
    getCardsByDeckSync(deckId){
      ensureReady();
      const id = String(deckId || "");
      return getCardRows().filter(c => String(c && c.deckId || "") === id);
    },
    getSchedulingRecordSync(key){
      ensureReady();
      const k = String(key || "");
      const map = getScheduleMap();
      return map[k] ? deepClone(map[k]) : null;
    },
    getSchedulingMapSync(){
      ensureReady();
      return getScheduleMap();
    },
    createDeck({ id, name, termIds = [] }){
      ensureReady();
      const ts = nowTs();
      const row = {
        id: String(id || generateId("deck:")),
        name: String(name || "").trim() || "Custom deck",
        termIds: Array.isArray(termIds) ? [...new Set(termIds.map(x => String(x || "").trim()).filter(Boolean))] : [],
        createdAt: ts,
        updatedAt: ts
      };
      if(isProfileSessionActive()){
        const decks = getProfileDeckMap();
        decks[row.id] = row;
      } else {
        guest.decks = guest.decks.filter(d => String(d && d.id || "") !== row.id);
        guest.decks.unshift(row);
      }
      markDeckSave();
      return deepClone(row);
    },
    updateDeck(deckId, patch){
      ensureReady();
      const id = String(deckId || "");
      const ts = nowTs();
      if(isProfileSessionActive()){
        const decks = getProfileDeckMap();
        const cur = decks[id];
        if(!cur) return null;
        const next = {
          ...cur,
          ...(patch || {}),
          id,
          name: String((patch && patch.name) || cur.name || "Custom deck").trim() || "Custom deck",
          termIds: Array.isArray((patch && patch.termIds) || cur.termIds)
            ? [...new Set(((patch && patch.termIds) || cur.termIds).map(x => String(x || "").trim()).filter(Boolean))]
            : [],
          updatedAt: ts
        };
        decks[id] = next;
        markDeckSave();
        return deepClone(next);
      }
      const idx = guest.decks.findIndex(d => String(d && d.id || "") === id);
      if(idx < 0) return null;
      const cur = guest.decks[idx];
      const next = {
        ...cur,
        ...(patch || {}),
        id,
        name: String((patch && patch.name) || cur.name || "Custom deck").trim() || "Custom deck",
        termIds: Array.isArray((patch && patch.termIds) || cur.termIds)
          ? [...new Set(((patch && patch.termIds) || cur.termIds).map(x => String(x || "").trim()).filter(Boolean))]
          : [],
        updatedAt: ts
      };
      guest.decks[idx] = next;
      saveGuest();
      return deepClone(next);
    },
    deleteDeck(deckId){
      ensureReady();
      const id = String(deckId || "");
      if(isProfileSessionActive()){
        const decks = getProfileDeckMap();
        if(!decks[id]) return false;
        delete decks[id];
        const cards = getProfileCardMap();
        for(const key of Object.keys(cards)){
          if(String(cards[key] && cards[key].deckId || "") === id){
            delete cards[key];
          }
        }
        const sched = getProfileScheduleMap();
        for(const key of Object.keys(sched)){
          const row = sched[key];
          if(String(row && row.deckId || "").includes(id) || String(key || "").startsWith(`custom:${id}::`) || String(key || "").startsWith(`${id}::`)){
            delete sched[key];
          }
        }
        markDeckSave();
        return true;
      }
      const hit = guest.decks.some(d => String(d && d.id || "") === id);
      if(!hit) return false;
      guest.decks = guest.decks.filter(d => String(d && d.id || "") !== id);
      guest.cards = guest.cards.filter(c => String(c && c.deckId || "") !== id);
      Object.keys(guest.scheduling).forEach(key => {
        const row = guest.scheduling[key];
        if(String(row && row.deckId || "").includes(id) || String(key || "").startsWith(`custom:${id}::`) || String(key || "").startsWith(`${id}::`)){
          delete guest.scheduling[key];
        }
      });
      saveGuest();
      return true;
    },
    upsertCard(card){
      ensureReady();
      const ts = nowTs();
      const row = {
        id: String((card && card.id) || generateId("card:")),
        deckId: String((card && card.deckId) || ""),
        frontText: String((card && card.frontText) || "").trim(),
        backText: String((card && card.backText) || "").trim(),
        notes: String((card && card.notes) || "").trim(),
        tags: Array.isArray(card && card.tags) ? [...new Set(card.tags.map(x => String(x || "").trim()).filter(Boolean))] : [],
        createdAt: String((card && card.createdAt) || ts),
        updatedAt: ts
      };
      if(isProfileSessionActive()){
        const cards = getProfileCardMap();
        cards[row.id] = row;
        markProfileDirty();
      } else {
        const idx = guest.cards.findIndex(c => String(c && c.id || "") === row.id);
        if(idx >= 0) guest.cards[idx] = row;
        else guest.cards.unshift(row);
        saveGuest();
      }
      return deepClone(row);
    },
    deleteCard(cardId){
      ensureReady();
      const id = String(cardId || "");
      if(isProfileSessionActive()){
        const cards = getProfileCardMap();
        if(!cards[id]) return false;
        delete cards[id];
        const sched = getProfileScheduleMap();
        Object.keys(sched).forEach(key => {
          if(String(key || "").includes(`::customcard:${id}`)) delete sched[key];
        });
        markProfileDirty();
        return true;
      }
      const hit = guest.cards.some(c => String(c && c.id || "") === id);
      if(!hit) return false;
      guest.cards = guest.cards.filter(c => String(c && c.id || "") !== id);
      Object.keys(guest.scheduling).forEach(key => {
        if(String(key || "").includes(`::customcard:${id}`)) delete guest.scheduling[key];
      });
      saveGuest();
      return true;
    },
    upsertScheduling(record){
      ensureReady();
      const key = String((record && record.key) || "").trim();
      if(!key) return null;
      const row = {
        ...(record || {}),
        key,
        updatedAt: nowTs()
      };
      if(isProfileSessionActive()){
        const sched = getProfileScheduleMap();
        sched[key] = row;
        markProfileDirty();
      } else {
        guest.scheduling[key] = row;
        saveGuest();
      }
      return deepClone(row);
    },
    removeSchedulingByPrefix(prefix){
      ensureReady();
      const p = String(prefix || "");
      if(!p) return 0;
      let removed = 0;
      if(isProfileSessionActive()){
        const sched = getProfileScheduleMap();
        Object.keys(sched).forEach(key => {
          if(String(key || "").startsWith(p)){
            delete sched[key];
            removed += 1;
          }
        });
        if(removed) markProfileDirty();
        return removed;
      }
      Object.keys(guest.scheduling).forEach(key => {
        if(String(key || "").startsWith(p)){
          delete guest.scheduling[key];
          removed += 1;
        }
      });
      if(removed) saveGuest();
      return removed;
    },
    dumpSnapshot(){
      ensureReady();
      return {
        decks: this.getDecksSync(),
        cards: this.getCardsSync(),
        scheduling: this.getSchedulingMapSync()
      };
    }
  };
}

const appStorage = createProfileBackedStorage();
flashcardState.editingCustomCardId = null;

async function migrateLegacyFlashcardData(){
  if(localStorage.getItem(FLASHCARD_MIGRATION_KEY) === "1") return;
  const hasData = appStorage.getDecksSync().length > 0 || appStorage.getCardsSync().length > 0 || Object.keys(appStorage.getSchedulingMapSync() || {}).length > 0;
  if(hasData){
    localStorage.setItem(FLASHCARD_MIGRATION_KEY, "1");
    return;
  }
  const oldDecks = readJsonLS(FLASHCARD_CUSTOM_DECKS_KEY, { items: [] }) || { items: [] };
  for(const deck of (oldDecks.items || [])){
    if(!deck || !deck.id) continue;
    appStorage.createDeck({
      id: deck.id,
      name: deck.name || "Custom deck",
      termIds: Array.isArray(deck.termIds) ? deck.termIds : []
    });
  }
  const oldSchedule = readJsonLS(FLASHCARD_SCHEDULE_KEY, { records: {} }) || { records: {} };
  for(const [key, value] of Object.entries(oldSchedule.records || {})){
    appStorage.upsertScheduling({
      ...(value || {}),
      key,
      deckId: String(key).split("::")[0] || ""
    });
  }
  localStorage.setItem(FLASHCARD_MIGRATION_KEY, "1");
}

function readCustomDecks(){
  return { items: appStorage.getDecksSync() };
}

function writeCustomDecks(data){
  const rows = Array.isArray(data && data.items) ? data.items : [];
  const existing = appStorage.getDecksSync();
  const incomingById = new Map(rows.filter(x => x && x.id).map(x => [String(x.id), x]));
  for(const row of existing){
    if(!incomingById.has(String(row.id))) appStorage.deleteDeck(row.id);
  }
  for(const row of rows){
    if(!row || !row.id) continue;
    const hit = existing.find(d => d && d.id === row.id);
    if(hit){
      appStorage.updateDeck(row.id, {
        name: row.name || hit.name || "Custom deck",
        termIds: Array.isArray(row.termIds) ? row.termIds : hit.termIds
      });
    } else {
      appStorage.createDeck({
        id: row.id,
        name: row.name || "Custom deck",
        termIds: Array.isArray(row.termIds) ? row.termIds : []
      });
    }
  }
}

function buildQuizExportDocument(row){
  return {
    schemaVersion: 1,
    type: "quiz",
    id: String(row.quizId || genId("quiz:")),
    name: String(row.name || "Quiz"),
    description: String(row.description || ""),
    createdAt: String(row.createdAt || new Date().toISOString()),
    updatedAt: String(row.updatedAt || new Date().toISOString()),
    settings: {
      type: String(row.type || "multiple_choice"),
      fromField: String(row.fromField || "english_translation"),
      toField: String(row.toField || "latin_translation")
    },
    selectedTermIds: Array.isArray(row.termIds) ? row.termIds : [],
    filters: row.filters || { includeCategories: [], excludeCategories: [], onlyWithDefinitions: false }
  };
}

function buildDeckExportDocument(deckId){
  const id = String(deckId || "");
  const deck = getCustomDeckRows().find(d => d && d.id === id);
  if(!deck) return null;
  const cards = appStorage.getCardsByDeckSync(id);
  return {
    schemaVersion: 1,
    type: "deck",
    id,
    name: String(deck.name || "Custom deck"),
    createdAt: String(deck.createdAt || new Date().toISOString()),
    updatedAt: String(deck.updatedAt || new Date().toISOString()),
    cards: cards.map(card => ({
      id: String(card.id || ""),
      front: String(card.frontText || ""),
      back: String(card.backText || ""),
      notes: String(card.notes || ""),
      tags: Array.isArray(card.tags) ? card.tags : [],
      createdAt: String(card.createdAt || new Date().toISOString()),
      updatedAt: String(card.updatedAt || new Date().toISOString())
    }))
  };
}

function importDeckDocument(doc){
  const parsed = normalizeImportedDeckDoc(doc);
  const deckRows = getCustomDeckRows();
  const existingDeck = deckRows.find(d => d && d.id === parsed.id);
  let targetDeckId = parsed.id;
  let preserveCardIds = true;

  if(existingDeck){
    const overwrite = confirm(`Deck "${parsed.name}" already exists. Press OK to overwrite, Cancel to duplicate.`);
    if(overwrite){
      for(const card of appStorage.getCardsByDeckSync(existingDeck.id)){
        appStorage.deleteCard(card.id);
      }
      appStorage.updateDeck(existingDeck.id, { name: parsed.name });
      targetDeckId = existingDeck.id;
      preserveCardIds = true;
    } else {
      const created = appStorage.createDeck({ name: `${parsed.name} (copy)`, termIds: [] });
      targetDeckId = created.id;
      preserveCardIds = false;
    }
  } else {
    appStorage.createDeck({ id: parsed.id, name: parsed.name, termIds: [] });
    targetDeckId = parsed.id;
    preserveCardIds = true;
  }

  const allCards = appStorage.getCardsSync();
  const cardsInTarget = new Set(appStorage.getCardsByDeckSync(targetDeckId).map(c => String(c.id || "")));
  for(const card of parsed.cards){
    let cardId = preserveCardIds ? String(card.id || "") : "";
    if(!cardId){
      cardId = genId("card:");
    } else {
      const existingCard = allCards.find(c => c && String(c.id || "") === cardId);
      const safeToReuse = !existingCard || cardsInTarget.has(cardId);
      if(!safeToReuse) cardId = genId("card:");
    }
    appStorage.upsertCard({
      id: cardId,
      deckId: targetDeckId,
      frontText: card.frontText,
      backText: card.backText,
      notes: card.notes || "",
      tags: card.tags || [],
      createdAt: card.createdAt,
      updatedAt: card.updatedAt
    });
  }

  return targetDeckId;
}

function getFlashcardScheduleKey(termId, frontField, backField, deckId){
  return `${deckId}::${frontField}->${backField}::${termId}`;
}

function getFlashcardRecord(termId, frontField, backField, deckId){
  return appStorage.getSchedulingRecordSync(getFlashcardScheduleKey(termId, frontField, backField, deckId));
}

function setFlashcardRecord(termId, frontField, backField, deckId, record){
  appStorage.upsertScheduling({
    ...(record || {}),
    key: getFlashcardScheduleKey(termId, frontField, backField, deckId),
    deckId: String(deckId || "")
  });
}

function removeFlashcardDeckProgress(frontField, backField, deckId){
  const prefix = `${deckId}::${frontField}->${backField}::`;
  appStorage.removeSchedulingByPrefix(prefix);
}

function getFlashcardCustomCards(){
  return appStorage.getCardsSync();
}

function getCustomDeckRows(){
  return appStorage.getDecksSync();
}

function getDeckLabel(deckId){
  if(deckId === "all") return "All terms";
  if(deckId === "starred") return "Starred terms";
  if(deckId === "wrong") return "Wrong terms (review list)";
  if(String(deckId || "").startsWith("custom:")){
    const id = String(deckId).slice("custom:".length);
    const hit = getCustomDeckRows().find(d => d && d.id === id);
    return hit ? `Custom deck: ${hit.name}` : "Custom deck";
  }
  return "Deck";
}

function buildFlashcardTerms(){
  const terms = [];
  for(const row of medicalTerms){
    const english = getEquivalentLanguageValue(row, "english_translation");
    const german = getEquivalentLanguageValue(row, "german_translation");
    const slovak = getEquivalentLanguageValue(row, "slovak_translation");
    const latin = getEquivalentLanguageValue(row, "latin_translation");
    const termId = makeBaseTermId(row, english || german || slovak || latin, latin || english || german || slovak);
    terms.push({
      ...(row || {}),
      termId,
      english_translation: english,
      german_translation: german,
      slovak_translation: slovak,
      latin_translation: latin,
      english_definition: String(row.english_definition || "").trim(),
      german_definition: String(row.german_definition || "").trim(),
      slovak_definition: String(row.slovak_definition || "").trim(),
      notes: String(row.notes || "").trim(),
      sourceType: "base",
      sourceDataset: row.__dataset || "",
      __group: row.__group || "",
      __dataset: row.__dataset || "",
      __datasetLabel: row.__datasetLabel || "",
      __sourceLabel: row.__sourceLabel || "",
      __sourcePath: row.__sourcePath || "",
      __headers: Array.isArray(row.__headers) ? row.__headers.slice() : [],
      baseTermKey: termId,
      userTermId: null
    });
  }
  for(const row of getLocalTerms()){
    const english = String((row && row.english) || "").trim();
    const german = String((row && row.german) || "").trim();
    const slovak = String((row && row.slovak) || "").trim();
    const latin = String((row && row.latin) || "").trim();
    terms.push({
      ...(row || {}),
      termId: getUserTermId(row),
      english_translation: english,
      german_translation: german,
      slovak_translation: slovak,
      latin_translation: latin,
      english_definition: String((row && row.notes) || "").trim(),
      german_definition: "",
      slovak_definition: "",
      notes: String((row && row.notes) || "").trim(),
      sourceType: "user",
      sourceDataset: "manual_entry",
      __group: "manual_entry",
      __dataset: "manual_entry",
      __datasetLabel: "Manual entries",
      __sourceLabel: "Manual entries",
      __sourcePath: "",
      __headers: ["english", "german", "slovak", "latin", "notes"],
      baseTermKey: null,
      userTermId: (row && row.id) || null
    });
  }
  for(const card of getFlashcardCustomCards()){
    const front = String(card.frontText || "").trim();
    const back = String(card.backText || "").trim();
    if(!front || !back) continue;
    terms.push({
      termId: `customcard:${card.id}`,
      customCardId: card.id,
      customDeckId: card.deckId,
      frontText: front,
      backText: back,
      english_translation: front,
      german_translation: front,
      slovak_translation: front,
      latin_translation: front,
      english_definition: String(card.notes || "").trim(),
      german_definition: "",
      slovak_definition: "",
      notes: [String(card.notes || "").trim(), Array.isArray(card.tags) ? card.tags.join(", ") : ""].filter(Boolean).join(" | "),
      sourceType: "custom",
      sourceDataset: "custom_cards",
      __group: "custom",
      __dataset: "custom_cards",
      __datasetLabel: "Custom cards",
      __sourceLabel: "Custom cards",
      __sourcePath: "",
      __headers: ["frontText", "backText", "notes"],
      baseTermKey: null,
      userTermId: null
    });
  }
  return terms;
}

function filterTermsByDeck(terms, deckId){
  if(deckId === "all") return terms.slice();
  if(deckId === "starred"){
    return terms.filter(term => progressStore.isStarred(term.termId));
  }
  if(deckId === "wrong"){
    const review = getLocalReview();
    const wanted = new Set();
    for(const row of review){
      if(row && row.user_term_id) wanted.add(`user:${row.user_term_id}`);
      if(row && row.base_term_key) wanted.add(String(row.base_term_key));
    }
    return terms.filter(term => wanted.has(term.termId));
  }
  if(String(deckId || "").startsWith("custom:")){
    const id = String(deckId).slice("custom:".length);
    const hit = getCustomDeckRows().find(d => d && d.id === id);
    const ids = new Set((hit && hit.termIds) || []);
    return terms.filter(term => ids.has(term.termId) || String(term.customDeckId || "") === id);
  }
  return terms.slice();
}

function filterTermsByLanguages(terms, frontField, backField){
  return terms.filter(term => {
    if(term.sourceType === "custom"){
      return !!String(term.frontText || "").trim() && !!String(term.backText || "").trim();
    }
    const front = String(term[frontField] || "").trim();
    const back = String(term[backField] || "").trim();
    return !!front && !!back;
  });
}

function getFlashcardFrontText(card, frontField){
  if(!card) return "";
  if(card.sourceType === "custom") return String(card.frontText || "");
  return String(card[frontField] || "");
}

function getFlashcardBackText(card, backField){
  if(!card) return "";
  if(card.sourceType === "custom") return String(card.backText || "");
  return String(card[backField] || "");
}

function getFlashcardDefinition(card, backField){
  if(!card) return "";
  if(card.sourceType === "custom") return card.notes || "";
  if(backField === "english_translation") return card.english_definition || card.notes || "";
  if(backField === "german_translation") return card.german_definition || card.notes || "";
  if(backField === "slovak_translation") return card.slovak_definition || card.notes || "";
  return card.notes || card.english_definition || "";
}

function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
}

const DATASET_ADAPTERS = [
  { key: "anatomy", label: "Anatomy", file: "terminology/anatomy.csv", idColumn: "id", columns: {
    en: ["english_term"], de: ["german_term"], sk: ["slovak_term"], la: ["latin_term"],
    latin_term: ["latin_term"], latin_genitive: ["latin_genitive"], latin_gender: ["latin_gender"], latin_declension: ["latin_declension"],
    definition: ["notes"], notes: ["notes"]
  }},
  { key: "diagnostic_methods", label: "Diagnostic methods", file: "terminology/diagnostic_methods.csv", idColumn: "id", columns: {
    en: ["english_term"], de: ["german_term"], sk: ["slovak_term"], la: ["latin_term"],
    abbreviation: ["abbreviation"], definition: ["what_it_is"], notes: ["notes"]
  }},
  { key: "disease_and_symptoms", label: "Diseases and symptoms", file: "terminology/disease_and_symptoms.csv", idColumn: "id", columns: {
    en: ["english_term"], de: ["german_term"], sk: ["slovak_term"], la: ["latin_term"],
    definition: ["definition_short"], notes: ["notes"]
  }},
  { key: "lab_parameters", label: "Laboratory parameters", file: "terminology/lab_parameters.csv", idColumn: "id", columns: {
    en: ["english_term"], de: ["german_term"], sk: ["slovak_term"],
    abbreviation: ["abbreviation"], analyte: ["analyte"], system: ["system"], sample_type: ["sample_type"],
    normal_range: ["normal_range"], units: ["units"], physiological_role: ["physiological_role"],
    causes_of_increase: ["causes_of_increase"], causes_of_decrease: ["causes_of_decrease"], clinical_use: ["clinical_use"],
    definition: ["physiological_role", "clinical_use"], notes: ["notes"]
  }},
  { key: "latin_abbreviations", label: "Latin abbreviations", file: "terminology/latin/latin_abbreviations.csv", idColumn: null, columns: {
    en: ["english_translation"], de: ["german_translation"], sk: ["slovak_translation"],
    abbreviation: ["abbreviation"], full_form: ["full_form"], definition: ["full_form"]
  }},
  { key: "latin_greek", label: "Latin-Greek", file: "terminology/latin/latin_greek.csv", idColumn: null, columns: {
    en: ["english_translation"], de: ["german_translation"], sk: ["slovak_translation"], la: ["latin_translation"], gr: ["greek_translation"],
    latin_term: ["latin_translation"], definition: ["english_translation"]
  }},
  { key: "latin_remedies", label: "Latin remedies", file: "terminology/latin/latin_remedies.csv", idColumn: null, columns: {
    en: ["english_description"], de: ["german_description"], sk: ["slovak_description"], la: ["name"],
    latin_term: ["name"], def_en: ["english_description"], def_de: ["german_description"], def_sk: ["slovak_description"], definition: ["english_description"]
  }},
  { key: "latin_units", label: "Latin units", file: "terminology/latin/latin_units.csv", idColumn: "unit_number", columns: {
    unit_name: ["unit_name"],
    en: ["english_translation"], de: ["german_translation"], sk: ["slovak_translation"], la: ["latin_term"],
    latin_term: ["latin_term"], latin_genitive: ["latin_genitive"], latin_gender: ["gender"], part_of_speech: ["part_of_speech"],
    def_en: ["english_definition"], def_de: ["german_definition"], def_sk: ["slovak_definition"], definition: ["english_definition"]
  }},
  { key: "microorganisms", label: "Microorganisms", file: "terminology/microorganisms.csv", idColumn: "id", columns: {
    en: ["common_english_name"], de: ["german_name"], sk: ["slovak_name"], la: ["scientific_name"],
    latin_term: ["scientific_name"], definition: ["diseases_caused", "diagnostics_key"], notes: ["notes"]
  }},
  { key: "muscles", label: "Muscles", file: "terminology/muscles.csv", idColumn: null, columns: {
    en: ["english_muscle_name"], de: ["muscle_category_ge"], sk: ["muscle_category_sk"], la: ["latin_muscle_name"],
    region: ["muscle_region_en"], category: ["muscle_category_en"],
    muscle_latin: ["latin_muscle_name"], muscle_english: ["english_muscle_name"],
    origo: ["origo"], insercio: ["insercio"], innervation: ["innervation"], blood_supply: ["blood_supply"], movement_function: ["movement_function"],
    definition: ["movement_function"]
  }},
  { key: "physiology", label: "Physiology", file: "terminology/physiology.csv", idColumn: "id", columns: {
    en: ["process_name_en"], de: ["process_name_de"], sk: ["process_name_sk"],
    definition: ["definition_short"], notes: ["notes"]
  }},
  { key: "procedures", label: "Procedures", file: "terminology/procedures.csv", idColumn: "id", columns: {
    en: ["english_term"], de: ["german_term"], sk: ["slovak_term"], la: ["latin_term"],
    definition: ["what_it_is"], notes: ["notes"]
  }}
];

function hasCols(row, colsArray){
  return (colsArray || []).every(col => {
    const key = String(col || "").trim();
    return !!key && String((row && row[key]) || "").trim().length > 0;
  });
}

const FLASHCARDS_V2_PROGRESS_PREFIX = "flashcards/v2/progress/";

const flashcardsV2State = {
  adapters: [],
  adapterByKey: new Map(),
  allTerms: [],
  loaded: false,
  query: {
    domains: [],
    subdivision1: [],
    subdivision2: [],
    frontFieldKey: "",
    frontFieldSecondaryKey: "",
    backFieldKey: "",
    backFieldSecondaryKey: "",
    only: "random",
    limit: 20
  },
  session: {
    deck: [],
    index: 0,
    revealed: false,
    querySnapshot: null
  }
};

function resolveAdapterColumns(spec, headers){
  const available = new Set((headers || []).map(h => String(h || "").trim()).filter(Boolean));
  const resolved = {};
  for(const [canonicalKey, aliases] of Object.entries(spec.columns || {})){
    const list = Array.isArray(aliases) ? aliases : [aliases];
    const hit = list.find(candidate => available.has(String(candidate || "").trim()));
    if(hit){
      resolved[canonicalKey] = String(hit);
    } else {
      console.warn(`[flashcards] ${spec.key}: missing mapping for "${canonicalKey}" (aliases: ${list.join(", ")})`);
    }
  }
  return resolved;
}

function getDefaultFieldCatalogForAdapter(adapter){
  const c = adapter.columns || {};
  const fields = [];
  const add = (key, label, colKey)=>{ if(c[colKey]) fields.push({ key, label, getValue: row => getTrimmed(row, c[colKey]) }); };
  const addBuild = (key, label, build)=> fields.push({ key, label, getValue: row => String(build(row, c) || "").trim() });

  if(adapter.key === "lab_parameters"){
    add("name_en", "Analyte / Parameter name (EN)", "en");
    add("name_de", "Analyte / Parameter name (DE)", "de");
    add("name_sk", "Analyte / Parameter name (SK)", "sk");
    add("abbreviation", "Abbreviation", "abbreviation");
    if(c.normal_range || c.units){
      addBuild("normal_range_units", "Normal range + units", (row, cols)=> [getTrimmed(row, cols.normal_range), getTrimmed(row, cols.units)].filter(Boolean).join(" "));
    }
    add("sample_type", "Sample type", "sample_type");
    add("physiological_role", "Physiological role", "physiological_role");
    add("causes_of_increase", "Causes of increase", "causes_of_increase");
    add("causes_of_decrease", "Causes of decrease", "causes_of_decrease");
    add("clinical_use", "Clinical use", "clinical_use");
    add("system", "System", "system");
    add("notes", "Notes", "notes");
    return fields;
  }
  if(adapter.key === "pharmacology"){
    add("name_en", "Drug name (EN)", "en");
    add("name_sk", "Drug name (SK)", "sk");
    add("drug_class", "Class", "drug_class");
    add("subclass", "Subclass", "subclass");
    add("mechanism_of_action", "Mechanism of action", "mechanism");
    add("indications", "Indications", "indications");
    add("contraindications", "Contraindications", "contraindications");
    add("adverse_effects_common", "Adverse effects (common)", "adverse_effects_common");
    add("adverse_effects_serious", "Adverse effects (serious)", "adverse_effects_serious");
    add("interactions_key", "Interactions (key)", "interactions_key");
    add("pregnancy", "Pregnancy", "pregnancy");
    add("routes", "Routes", "routes");
    add("onset", "Onset", "onset");
    add("duration", "Duration", "duration");
    add("notes", "Notes", "notes");
    return fields;
  }
  if(adapter.key === "latin_units"){
    add("unit_name", "Unit", "unit_name");
    add("name_la", "Latin term", "la");
    add("name_en", "English translation", "en");
    add("name_de", "German translation", "de");
    add("name_sk", "Slovak translation", "sk");
    addBuild("latin_grammar", "Latin grammar", (row, cols) => [getTrimmed(row, cols.latin_genitive), getTrimmed(row, cols.latin_gender), getTrimmed(row, cols.part_of_speech)].filter(Boolean).join(" | "));
    add("definition_en", "Definition (EN)", "def_en");
    add("definition_de", "Definition (DE)", "def_de");
    add("definition_sk", "Definition (SK)", "def_sk");
    add("notes", "Notes", "notes");
    return fields;
  }
  add("name_en", "Name (EN)", "en");
  add("name_de", "Name (DE)", "de");
  add("name_sk", "Name (SK)", "sk");
  add("name_la", "Name (LA)", "la");
  add("name_gr", "Name (GR)", "gr");
  add("abbreviation", "Abbreviation", "abbreviation");
  add("full_form", "Full form", "full_form");
  add("definition", "Definition", "definition");
  add("notes", "Notes", "notes");
  if(adapter.key === "muscles"){
    add("region", "Region", "region");
    add("category", "Category", "category");
    add("origo", "Origo", "origo");
    add("insercio", "Insercio", "insercio");
    add("innervation", "Innervation", "innervation");
    add("blood_supply", "Blood supply", "blood_supply");
    add("movement_function", "Movement function", "movement_function");
    addBuild("oina_summary", "OINA summary", (row, cols) => [
      getTrimmed(row, cols.origo) ? `Origo: ${getTrimmed(row, cols.origo)}` : "",
      getTrimmed(row, cols.insercio) ? `Insercio: ${getTrimmed(row, cols.insercio)}` : "",
      getTrimmed(row, cols.innervation) ? `Innervation: ${getTrimmed(row, cols.innervation)}` : "",
      getTrimmed(row, cols.blood_supply) ? `Blood supply: ${getTrimmed(row, cols.blood_supply)}` : "",
      getTrimmed(row, cols.movement_function) ? `Function: ${getTrimmed(row, cols.movement_function)}` : ""
    ].filter(Boolean).join(" | "));
  }
  return fields.filter((v, i, arr) => arr.findIndex(x => x.key === v.key) === i);
}

function getStableIdSeed(row, adapter){
  const c = adapter.columns || {};
  const keys = [c.en, c.de, c.sk, c.la, c.gr, c.abbreviation, c.full_form, c.english_name, c.muscle_english, c.muscle_latin, c.latin_term, c.definition, c.notes];
  const values = [];
  for(const key of keys){
    if(!key) continue;
    const value = String((row && row[key]) || "").trim();
    if(value) values.push(value);
  }
  if(values.length) return values.join("|");
  return Object.keys(row || {}).sort().map(k => `${k}:${String(row[k] || "").trim()}`).join("|");
}

function djb2Hash(text){
  let hash = 5381;
  const s = String(text || "");
  for(let i = 0; i < s.length; i += 1){
    hash = ((hash << 5) + hash) ^ s.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function getTrimmed(row, key){
  if(!key) return "";
  return String((row && row[key]) || "").trim();
}

function pickFirstNonEmpty(row, keys){
  for(const key of (keys || [])){
    const value = getTrimmed(row, key);
    if(value) return value;
  }
  return "";
}

async function ensureFlashcardsV2DataLoaded(){
  if(flashcardsV2State.loaded) return flashcardsV2State;
  const adapters = [];
  const allTerms = [];

  for(const spec of DATASET_ADAPTERS){
    try{
      const txt = await loadBaseFile(spec.file);
      const rows = parseCSVLines(txt || "");
      if(rows.length < 2) continue;
      const parsed = rowsToObjectsWithHeaders(rows);
      const headers = (parsed.headers || []).map(h => String(h || "").trim()).filter(Boolean);
      const resolvedColumns = resolveAdapterColumns(spec, headers);
      const adapterSeed = {
        key: spec.key,
        label: spec.label,
        file: spec.file,
        idColumn: spec.idColumn || null,
        columns: resolvedColumns
      };
      const fieldCatalog = getDefaultFieldCatalogForAdapter(adapterSeed);
      const adapter = {
        ...adapterSeed,
        fieldCatalog,
        fieldByKey: new Map(fieldCatalog.map(field => [field.key, field]))
      };
      adapters.push(adapter);
      for(const row of (parsed.objects || [])){
        const idFromColumn = adapter.idColumn ? getTrimmed(row, adapter.idColumn) : "";
        const _id = idFromColumn
          ? `${adapter.key}:${idFromColumn}`
          : `${adapter.key}:${djb2Hash(getStableIdSeed(row, adapter))}`;
        allTerms.push({
          ...row,
          _domain: adapter.key,
          _id
        });
      }
    }catch(e){
      console.warn(`[flashcards] failed loading ${spec.file}:`, e.message || e);
    }
  }

  flashcardsV2State.adapters = adapters;
  flashcardsV2State.adapterByKey = new Map(adapters.map(adapter => [adapter.key, adapter]));
  flashcardsV2State.allTerms = allTerms;
  flashcardsV2State.loaded = true;
  if(!flashcardsV2State.query.domains.length){
    flashcardsV2State.query.domains = adapters.length ? [adapters[0].key] : [];
  }
  return flashcardsV2State;
}

function getUserStorageKey(){
  const email = String(state.currentUserEmail || "").trim().toLowerCase();
  const user = String(state.currentUser || "").trim().toLowerCase();
  return email || user || "guest";
}

function loadProgress(userKey){
  if(isProfileSessionActive()){
    const bucket = userProfile.flashcards.v2_progress && typeof userProfile.flashcards.v2_progress === "object"
      ? userProfile.flashcards.v2_progress
      : {};
    return deepClone(bucket[String(userKey || "")] || {});
  }
  return readJsonLS(`${FLASHCARDS_V2_PROGRESS_PREFIX}${userKey}`, {});
}

function saveProgress(userKey, progress){
  if(isProfileSessionActive()){
    if(!userProfile.flashcards.v2_progress || typeof userProfile.flashcards.v2_progress !== "object"){
      userProfile.flashcards.v2_progress = {};
    }
    userProfile.flashcards.v2_progress[String(userKey || "")] = deepClone(progress || {});
    markProfileDirty();
    return;
  }
  writeJsonLS(`${FLASHCARDS_V2_PROGRESS_PREFIX}${userKey}`, progress || {});
}

function getProgressWeight(progressRow){
  const wrong = Number((progressRow && progressRow.wrong) || 0);
  const correct = Number((progressRow && progressRow.correct) || 0);
  return Math.max(1, 1 + (wrong * 2) - correct);
}

function weightedSample(items, limit, weightFn){
  const pool = items.slice();
  const target = Math.max(0, Math.min(Number(limit) || 0, pool.length));
  const out = [];
  while(out.length < target && pool.length){
    let total = 0;
    const weights = pool.map(item => {
      const w = Math.max(1, Number(weightFn(item)) || 1);
      total += w;
      return w;
    });
    let pick = Math.random() * total;
    let idx = 0;
    for(let i = 0; i < pool.length; i += 1){
      pick -= weights[i];
      if(pick <= 0){
        idx = i;
        break;
      }
    }
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

function randomSample(items, limit){
  const copy = items.slice();
  shuffle(copy);
  return copy.slice(0, Math.max(0, Math.min(Number(limit) || 0, copy.length)));
}

function buildDeck({ query, terms, progress, adapters }){
  const adapterMap = new Map((adapters || []).map(adapter => [adapter.key, adapter]));
  const domains = new Set((query.domains || []).map(v => String(v || "").trim()).filter(Boolean));
  const only = String(query.only || "random");
  const nowMs = Date.now();
  const candidates = [];

  for(const row of (terms || [])){
    if(!row || !domains.has(String(row._domain || ""))) continue;
    const adapter = adapterMap.get(String(row._domain || ""));
    if(!adapter) continue;
    if(!matchesFlashcardsSubdivision(row, adapter, query)) continue;
    const frontField = adapter.fieldByKey.get(String(query.frontFieldKey || ""));
    const frontFieldSecondary = adapter.fieldByKey.get(String(query.frontFieldSecondaryKey || ""));
    const backField = adapter.fieldByKey.get(String(query.backFieldKey || ""));
    const backFieldSecondary = adapter.fieldByKey.get(String(query.backFieldSecondaryKey || ""));
    if(!frontField || !backField) continue;
    const front = String(frontField.getValue(row) || "").trim();
    const frontSecondary = frontFieldSecondary ? String(frontFieldSecondary.getValue(row) || "").trim() : "";
    const back = String(backField.getValue(row) || "").trim();
    const backSecondary = backFieldSecondary ? String(backFieldSecondary.getValue(row) || "").trim() : "";
    if(!front || !back || front === back) continue;
    const termId = String(row._id || "");
    const p = (progress && progress[termId]) || null;

    if(only === "new" && p) continue;
    if(only === "wrong"){
      const wrong = Number((p && p.wrong) || 0);
      const correct = Number((p && p.correct) || 0);
      if(!(wrong >= 1 || wrong > correct)) continue;
    }
    if(only === "due"){
      const nextReview = p && p.nextReview ? new Date(p.nextReview).getTime() : 0;
      if(!(nextReview && nextReview <= nowMs)) continue;
    }
    candidates.push({
      termId,
      domain: row._domain,
      front,
      frontSecondary,
      back,
      backSecondary,
      meta: {
        domainLabel: adapter.label,
        frontLabel: frontField.label,
        backLabel: backField.label
      },
      _progress: p
    });
  }

  const limit = Math.max(1, Number(query.limit) || 20);
  const sampled = (only === "wrong" || only === "due")
    ? weightedSample(candidates, limit, item => getProgressWeight(item._progress))
    : randomSample(candidates, limit);

  return sampled.map(item => ({
    termId: item.termId,
    domain: item.domain,
    front: item.front,
    frontSecondary: item.frontSecondary || "",
    back: item.back,
    backSecondary: item.backSecondary || "",
    meta: item.meta
  }));
}

function getSelectedFlashcardsDomains(){
  const root = document.getElementById("flashcards-domains");
  if(!root) return [];
  return [...root.querySelectorAll('input[data-domain-key]')]
    .filter(el => el.checked)
    .map(el => String(el.getAttribute("data-domain-key") || "").trim())
    .filter(Boolean);
}

function renderFlashcardsDomains(){
  const root = document.getElementById("flashcards-domains");
  if(!root) return;
  const current = flashcardsV2State.query.domains[0] || (flashcardsV2State.adapters[0] && flashcardsV2State.adapters[0].key) || "";
  root.innerHTML = flashcardsV2State.adapters.map(adapter => {
    const checked = adapter.key === current ? " checked" : "";
    return `<label class="checkbox-item"><input type="radio" name="flashcards-domain" data-domain-key="${escapeHTML(adapter.key)}"${checked} /> ${escapeHTML(localizeDatasetLabel(adapter.key, adapter.label))}</label>`;
  }).join("");
  flashcardsV2State.query.domains = current ? [current] : [];
}

function getFieldOptionsForDomains(domainKeys){
  const selected = (domainKeys || []).slice(0, 1);
  const byKey = new Map();
  for(const domainKey of selected){
    const adapter = flashcardsV2State.adapterByKey.get(domainKey);
    if(!adapter) continue;
    for(const field of (adapter.fieldCatalog || [])){
      const hit = byKey.get(field.key);
      if(hit) hit.domains.add(domainKey);
      else byKey.set(field.key, { key: field.key, label: localizeFlashcardsFieldLabel(field.key, field.label), domains: new Set([domainKey]) });
    }
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function getFlashcardsSubdivisionConfig(adapter){
  if(!adapter) return null;
  if(adapter.key === "latin_units"){
    return {
      level1: { key: "unit_name", label: tOr("field_unit_name", "Unit") },
      level2: null
    };
  }
  if(adapter.key === "pharmacology"){
    return {
      level1: { key: "drug_class", label: tOr("field_drug_class", "Drug class") },
      level2: { key: "subclass", label: tOr("field_subclass", "Subclass") }
    };
  }
  if(adapter.key === "muscles"){
    return {
      level1: { key: "region", label: tOr("muscle_search_region", "Region") },
      level2: { key: "category", label: tOr("muscle_search_category", "Category") }
    };
  }
  return null;
}

function uniqueSorted(values){
  return [...new Set(values.map(v => String(v || "").trim()).filter(Boolean))].sort((a, b)=>a.localeCompare(b));
}

function normalizeSubdivisionSelection(raw){
  if(Array.isArray(raw)){
    return [...new Set(raw.map(v => String(v || "").trim()).filter(Boolean))];
  }
  const value = String(raw || "").trim();
  return value ? [value] : [];
}

function subdivisionHasSelection(raw){
  return normalizeSubdivisionSelection(raw).length > 0;
}

function formatSubdivisionSelection(raw){
  return normalizeSubdivisionSelection(raw).join(", ");
}

function getChecklistSelectedValues(container){
  if(!(container instanceof HTMLElement)) return [];
  return [...container.querySelectorAll('input[type="checkbox"]:checked')]
    .map(el => String(el.value || "").trim())
    .filter(Boolean);
}

function renderSubdivisionChecklist(container, options, selectedValues, onChange){
  if(!(container instanceof HTMLElement)) return;
  const values = Array.isArray(options) ? options : [];
  const selected = new Set(normalizeSubdivisionSelection(selectedValues));
  container.innerHTML = "";
  values.forEach(value => {
    const item = document.createElement("label");
    item.className = "checkbox-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = value;
    cb.checked = selected.has(value);
    cb.addEventListener("change", ()=>{
      if(typeof onChange === "function"){
        onChange(getChecklistSelectedValues(container));
      }
    });
    const span = document.createElement("span");
    span.textContent = value;
    item.appendChild(cb);
    item.appendChild(span);
    container.appendChild(item);
  });
}

function getSubdivisionOptions(adapter, colKey, rows){
  const col = adapter && adapter.columns ? adapter.columns[colKey] : "";
  if(!col) return [];
  return uniqueSorted((rows || []).map(row => row ? row[col] : ""));
}

function matchesFlashcardsSubdivision(row, adapter, query){
  const cfg = getFlashcardsSubdivisionConfig(adapter);
  if(!cfg || !row || !adapter) return true;
  const level1Values = normalizeSubdivisionSelection(query.subdivision1);
  const level2Values = normalizeSubdivisionSelection(query.subdivision2);
  if(cfg.level1 && level1Values.length){
    const c1 = adapter.columns[cfg.level1.key];
    if(!level1Values.includes(String(row[c1] || "").trim())) return false;
  }
  if(cfg.level2 && level2Values.length){
    const c2 = adapter.columns[cfg.level2.key];
    if(!level2Values.includes(String(row[c2] || "").trim())) return false;
  }
  return true;
}

function clampQuizQuestionCount(raw, poolSize){
  const max = Math.max(1, Number(poolSize) || 0);
  const parsed = Math.max(1, Number(raw) || 1);
  return Math.min(parsed, max);
}

function clampQuizOptionsCount(raw){
  return Math.max(2, Math.min(Number(raw) || 4, 6));
}

function calculateQuizTimerSeconds({ quizType, questionCount, optionsCount, doubleConfirm = false } = {}){
  const count = Math.max(1, Number(questionCount) || 1);
  const options = clampQuizOptionsCount(optionsCount);
  const type = String(quizType || "multiple_choice");
  let total = 0;
  if(type === "typing"){
    total = (count * 13) + 20;
  } else if(type === "matching"){
    total = (count * 9) + 18;
  } else {
    total = (count * (5 + (options * 2))) + 12;
    if(doubleConfirm) total += count;
  }
  return Math.max(15, Math.round(total / 5) * 5);
}

function formatSecondsCompact(totalSeconds){
  const secs = Math.max(0, Number(totalSeconds) || 0);
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  if(mins <= 0) return `${rem}s`;
  if(rem === 0) return `${mins}m`;
  return `${mins}m ${rem}s`;
}

function getFlashcardsFieldLabel(fieldKey, optionMap){
  const key = String(fieldKey || "").trim();
  if(!key) return "-";
  return optionMap.get(key) || localizeFlashcardsFieldLabel(key, formatHeaderLabel(key));
}

function setFlashcardsText(id, value){
  const el = document.getElementById(id);
  if(el) el.textContent = String(value ?? "");
}

function setFlashcardsOptionalText(id, value){
  const el = document.getElementById(id);
  if(!el) return;
  const text = String(value || "").trim();
  el.textContent = text;
  el.classList.toggle("hidden", !text);
}

function syncFlashcardsDashboard(options = null){
  const displayQuery = flashcardsV2State.session.deck.length && flashcardsV2State.session.querySnapshot
    ? flashcardsV2State.session.querySnapshot
    : flashcardsV2State.query;
  const optionList = Array.isArray(options) && displayQuery === flashcardsV2State.query
    ? options
    : getFieldOptionsForDomains(displayQuery.domains);
  const optionMap = new Map(optionList.map(opt => [opt.key, opt.label]));
  const selectedAdapter = flashcardsV2State.adapterByKey.get(displayQuery.domains[0] || "");
  const selectedDomainLabel = selectedAdapter ? localizeDatasetLabel(selectedAdapter.key, selectedAdapter.label) : "-";
  const frontLabel = getFlashcardsFieldLabel(displayQuery.frontFieldKey, optionMap);
  const backLabel = getFlashcardsFieldLabel(displayQuery.backFieldKey, optionMap);
  const frontSecondaryLabel = displayQuery.frontFieldSecondaryKey
    ? getFlashcardsFieldLabel(displayQuery.frontFieldSecondaryKey, optionMap)
    : "";
  const backSecondaryLabel = displayQuery.backFieldSecondaryKey
    ? getFlashcardsFieldLabel(displayQuery.backFieldSecondaryKey, optionMap)
    : "";
  setFlashcardsText("flashcards-loaded-terms", flashcardsV2State.allTerms.length);
  setFlashcardsText("flashcards-selected-domain", selectedDomainLabel);
  setFlashcardsText("flashcards-front-field-pill", frontLabel);
  setFlashcardsText("flashcards-back-field-pill", backLabel);
  setFlashcardsText("flashcards-front-primary-label", frontLabel);
  setFlashcardsText("flashcards-back-primary-label", backLabel);
  setFlashcardsOptionalText("flashcards-front-secondary-label", frontSecondaryLabel);
  setFlashcardsOptionalText("flashcards-back-secondary-label", backSecondaryLabel);
}

function refreshFlashcardsBuilderUI(msgText = ""){
  const subdivisionWrap = document.getElementById("flashcards-subdivision-wrap");
  const subdivision1Label = document.getElementById("flashcards-subdivision1-label");
  const subdivision1Sel = document.getElementById("flashcards-subdivision1");
  const subdivision2Wrap = document.getElementById("flashcards-subdivision2-wrap");
  const subdivision2Label = document.getElementById("flashcards-subdivision2-label");
  const subdivision2Sel = document.getElementById("flashcards-subdivision2");
  const frontSel = document.getElementById("flashcards-front-field");
  const frontSel2 = document.getElementById("flashcards-front-field-2");
  const backSel = document.getElementById("flashcards-back-field");
  const backSel2 = document.getElementById("flashcards-back-field-2");
  const onlySel = document.getElementById("flashcards-only");
  const limitSel = document.getElementById("flashcards-limit");
  const msg = document.getElementById("flashcards-builder-msg");
  if(!subdivisionWrap || !subdivision1Label || !subdivision1Sel || !subdivision2Wrap || !subdivision2Label || !subdivision2Sel || !frontSel || !frontSel2 || !backSel || !backSel2 || !onlySel || !limitSel || !msg) return;

  const selectedDomains = getSelectedFlashcardsDomains();
  if(selectedDomains.length){
    flashcardsV2State.query.domains = [selectedDomains[0]];
  } else if(!flashcardsV2State.query.domains.length && flashcardsV2State.adapters.length){
    flashcardsV2State.query.domains = [flashcardsV2State.adapters[0].key];
  }
  renderFlashcardsDomains();

  const domainKey = flashcardsV2State.query.domains[0] || "";
  const adapter = flashcardsV2State.adapterByKey.get(domainKey) || null;
  const cfg = getFlashcardsSubdivisionConfig(adapter);
  const domainRows = flashcardsV2State.allTerms.filter(row => row && row._domain === domainKey);

  if(!cfg){
    subdivisionWrap.classList.add("hidden");
    subdivision2Wrap.classList.add("hidden");
    flashcardsV2State.query.subdivision1 = [];
    flashcardsV2State.query.subdivision2 = [];
    if(subdivision1Sel) subdivision1Sel.innerHTML = "";
    if(subdivision2Sel) subdivision2Sel.innerHTML = "";
  } else {
    subdivisionWrap.classList.remove("hidden");
    subdivision1Label.textContent = cfg.level1 ? cfg.level1.label : tOr("quiz_subdivision", "Subdivision");
    const level1Options = cfg.level1 ? getSubdivisionOptions(adapter, cfg.level1.key, domainRows) : [];
    const selectedLevel1 = normalizeSubdivisionSelection(flashcardsV2State.query.subdivision1).filter(value => level1Options.includes(value));
    flashcardsV2State.query.subdivision1 = selectedLevel1;
    renderSubdivisionChecklist(subdivision1Sel, level1Options, selectedLevel1, nextValues => {
      flashcardsV2State.query.subdivision1 = nextValues;
      flashcardsV2State.query.subdivision2 = [];
      refreshFlashcardsBuilderUI();
    });

    if(cfg.level2){
      subdivision2Wrap.classList.remove("hidden");
      subdivision2Label.textContent = cfg.level2.label;
      const rowsForLevel2 = subdivisionHasSelection(flashcardsV2State.query.subdivision1)
        ? domainRows.filter(row => {
            const c1 = adapter.columns[cfg.level1.key];
            return normalizeSubdivisionSelection(flashcardsV2State.query.subdivision1).includes(String(row[c1] || "").trim());
          })
        : domainRows;
      const level2Options = getSubdivisionOptions(adapter, cfg.level2.key, rowsForLevel2);
      const selectedLevel2 = normalizeSubdivisionSelection(flashcardsV2State.query.subdivision2).filter(value => level2Options.includes(value));
      flashcardsV2State.query.subdivision2 = selectedLevel2;
      renderSubdivisionChecklist(subdivision2Sel, level2Options, selectedLevel2, nextValues => {
        flashcardsV2State.query.subdivision2 = nextValues;
        refreshFlashcardsBuilderUI();
      });
    } else {
      subdivision2Wrap.classList.add("hidden");
      flashcardsV2State.query.subdivision2 = [];
      if(subdivision2Sel) subdivision2Sel.innerHTML = "";
    }
  }

  const options = getFieldOptionsForDomains(flashcardsV2State.query.domains);
  frontSel.innerHTML = options.map(opt => `<option value="${escapeHTML(opt.key)}">${escapeHTML(opt.label)}</option>`).join("");
  frontSel2.innerHTML = [`<option value="">${escapeHTML(tOr("flashcards_none", "None"))}</option>`, ...options.map(opt => `<option value="${escapeHTML(opt.key)}">${escapeHTML(opt.label)}</option>`)].join("");
  backSel.innerHTML = options.map(opt => `<option value="${escapeHTML(opt.key)}">${escapeHTML(opt.label)}</option>`).join("");
  backSel2.innerHTML = [`<option value="">${escapeHTML(tOr("flashcards_none", "None"))}</option>`, ...options.map(opt => `<option value="${escapeHTML(opt.key)}">${escapeHTML(opt.label)}</option>`)].join("");
  const keys = options.map(opt => opt.key);
  if(!keys.includes(flashcardsV2State.query.frontFieldKey)){
    flashcardsV2State.query.frontFieldKey = keys[0] || "";
  }
  if(!keys.includes(flashcardsV2State.query.backFieldKey) || flashcardsV2State.query.backFieldKey === flashcardsV2State.query.frontFieldKey){
    flashcardsV2State.query.backFieldKey = keys.find(key => key !== flashcardsV2State.query.frontFieldKey) || flashcardsV2State.query.frontFieldKey || "";
  }
  if(flashcardsV2State.query.frontFieldKey) frontSel.value = flashcardsV2State.query.frontFieldKey;
  if(keys.includes(flashcardsV2State.query.frontFieldSecondaryKey)) frontSel2.value = flashcardsV2State.query.frontFieldSecondaryKey;
  else frontSel2.value = "";
  if(flashcardsV2State.query.backFieldKey) backSel.value = flashcardsV2State.query.backFieldKey;
  if(keys.includes(flashcardsV2State.query.backFieldSecondaryKey)) backSel2.value = flashcardsV2State.query.backFieldSecondaryKey;
  else backSel2.value = "";
  onlySel.value = flashcardsV2State.query.only;
  limitSel.value = String(flashcardsV2State.query.limit || 20);
  const selectedAdapter = flashcardsV2State.adapterByKey.get(flashcardsV2State.query.domains[0] || "");
  const selectedDomainLabel = selectedAdapter ? localizeDatasetLabel(selectedAdapter.key, selectedAdapter.label) : "-";
  const base = `${tOr("flashcards_loaded_terms", "Loaded terms")}: ${flashcardsV2State.allTerms.length} | ${tOr("flashcards_selected_domain", "Selected domain")}: ${selectedDomainLabel}`;
  syncFlashcardsDashboard(options);
  msg.textContent = msgText ? `${msgText} | ${base}` : base;
}

function renderFlashcardsPlayer(){
  const cardBtn = document.getElementById("flashcards-card");
  const frontEl = document.getElementById("flashcards-front");
  const frontSubEl = document.getElementById("flashcards-front-secondary");
  const backEl = document.getElementById("flashcards-back-side");
  const backSubEl = document.getElementById("flashcards-back-secondary");
  const ratings = document.getElementById("flashcards-ratings");
  const progressEl = document.getElementById("flashcards-progress");
  const revealBtn = document.getElementById("flashcards-reveal");
  const againBtn = document.getElementById("flashcards-again");
  const goodBtn = document.getElementById("flashcards-good");
  const easyBtn = document.getElementById("flashcards-easy");
  const generatedCountEl = document.getElementById("flashcards-generated-count");
  const progressBarEl = document.getElementById("flashcards-progress-bar");
  if(!cardBtn || !frontEl || !frontSubEl || !backEl || !backSubEl || !ratings || !progressEl || !revealBtn || !againBtn || !goodBtn || !easyBtn) return;

  const deck = flashcardsV2State.session.deck;
  const index = flashcardsV2State.session.index;
  const current = deck[index] || null;
  const progressText = current ? `${Math.min(index + 1, deck.length)}/${deck.length}` : `0/${deck.length}`;
  syncFlashcardsDashboard();
  if(generatedCountEl) generatedCountEl.textContent = String(deck.length);
  if(progressBarEl) progressBarEl.style.width = deck.length ? `${(Math.min(index + 1, deck.length) / deck.length) * 100}%` : "0%";
  cardBtn.classList.toggle("is-empty", !current);
  cardBtn.setAttribute("aria-disabled", current ? "false" : "true");
  if(!current){
    frontEl.textContent = tOr("flashcards_no_active_session", "No active session. Generate a deck first.");
    frontSubEl.textContent = "";
    backEl.textContent = "";
    backSubEl.textContent = "";
    cardBtn.classList.remove("is-flipped");
    ratings.classList.add("hidden");
    progressEl.textContent = progressText;
    revealBtn.disabled = true;
    revealBtn.classList.remove("hidden");
    againBtn.disabled = true;
    goodBtn.disabled = true;
    easyBtn.disabled = true;
    return;
  }
  frontEl.textContent = current.front;
  frontSubEl.textContent = String(current.frontSecondary || "");
  backEl.textContent = current.back;
  backSubEl.textContent = String(current.backSecondary || "");
  cardBtn.classList.toggle("is-flipped", !!flashcardsV2State.session.revealed);
  ratings.classList.toggle("hidden", !flashcardsV2State.session.revealed);
  progressEl.textContent = progressText;
  revealBtn.disabled = false;
  revealBtn.classList.toggle("hidden", !!flashcardsV2State.session.revealed);
  const canRate = flashcardsV2State.session.revealed;
  againBtn.disabled = !canRate;
  goodBtn.disabled = !canRate;
  easyBtn.disabled = !canRate;
}

function applyFlashcardsRating(termId, rating){
  const userKey = getUserStorageKey();
  const progress = loadProgress(userKey) || {};
  const row = progress[termId] || { correct: 0, wrong: 0, lastSeen: null, nextReview: null };
  const now = new Date();
  const dayMs = 86400000;
  if(rating === "again"){
    row.wrong = Number(row.wrong || 0) + 1;
    row.nextReview = new Date(now.getTime() + (1 * dayMs)).toISOString();
  } else if(rating === "good"){
    row.correct = Number(row.correct || 0) + 1;
    row.nextReview = new Date(now.getTime() + (3 * dayMs)).toISOString();
  } else {
    row.correct = Number(row.correct || 0) + 1;
    row.nextReview = new Date(now.getTime() + (7 * dayMs)).toISOString();
  }
  row.lastSeen = now.toISOString();
  progress[termId] = row;
  saveProgress(userKey, progress);
}

function startFlashcardsSession(deck){
  flashcardsV2State.session.deck = Array.isArray(deck) ? deck : [];
  flashcardsV2State.session.index = 0;
  flashcardsV2State.session.revealed = false;
  flashcardsV2State.session.querySnapshot = flashcardsV2State.session.deck.length
    ? {
        ...flashcardsV2State.query,
        subdivision1: normalizeSubdivisionSelection(flashcardsV2State.query.subdivision1),
        subdivision2: normalizeSubdivisionSelection(flashcardsV2State.query.subdivision2)
      }
    : null;
  renderFlashcardsPlayer();
}

function setFlashcardsBuilderCollapsed(collapsed){
  const builderCard = document.getElementById("flashcards-builder-card");
  const toggleBtn = document.getElementById("flashcards-builder-toggle");
  const screen = document.getElementById("screen-flashcards");
  if(builderCard) builderCard.classList.toggle("hidden", !!collapsed);
  if(screen) screen.classList.toggle("flashcards-builder-collapsed", !!collapsed);
  if(toggleBtn){
    toggleBtn.classList.toggle("hidden", !collapsed);
    toggleBtn.textContent = collapsed
      ? tOr("flashcards_builder_show", "Show builder settings")
      : tOr("flashcards_builder_hide", "Hide builder settings");
  }
}

function generateFlashcardsSession(){
  const msg = document.getElementById("flashcards-builder-msg");
  const subdivision1Sel = document.getElementById("flashcards-subdivision1");
  const subdivision2Sel = document.getElementById("flashcards-subdivision2");
  const frontSel = document.getElementById("flashcards-front-field");
  const frontSel2 = document.getElementById("flashcards-front-field-2");
  const backSel = document.getElementById("flashcards-back-field");
  const backSel2 = document.getElementById("flashcards-back-field-2");
  const onlySel = document.getElementById("flashcards-only");
  const limitSel = document.getElementById("flashcards-limit");
  if(!msg || !subdivision1Sel || !subdivision2Sel || !frontSel || !frontSel2 || !backSel || !backSel2 || !onlySel || !limitSel) return;

  const selected = getSelectedFlashcardsDomains();
  flashcardsV2State.query.domains = selected.length ? [selected[0]] : [];
  flashcardsV2State.query.subdivision1 = getChecklistSelectedValues(subdivision1Sel);
  flashcardsV2State.query.subdivision2 = getChecklistSelectedValues(subdivision2Sel);
  flashcardsV2State.query.frontFieldKey = String(frontSel.value || "");
  flashcardsV2State.query.frontFieldSecondaryKey = String(frontSel2.value || "");
  flashcardsV2State.query.backFieldKey = String(backSel.value || "");
  flashcardsV2State.query.backFieldSecondaryKey = String(backSel2.value || "");
  flashcardsV2State.query.only = String(onlySel.value || "random");
  flashcardsV2State.query.limit = Math.max(1, Number(limitSel.value) || 20);

  if(!flashcardsV2State.query.domains.length){
    msg.textContent = tOr("flashcards_select_one_domain", "Select at least one domain.");
    startFlashcardsSession([]);
    return;
  }
  if(!flashcardsV2State.query.frontFieldKey || !flashcardsV2State.query.backFieldKey){
    msg.textContent = tOr("flashcards_select_front_back", "Select front and back fields.");
    startFlashcardsSession([]);
    return;
  }
  if(flashcardsV2State.query.frontFieldKey === flashcardsV2State.query.backFieldKey){
    msg.textContent = tOr("flashcards_front_back_same", "Front and Back cannot be the same field.");
    startFlashcardsSession([]);
    return;
  }

  const progress = loadProgress(getUserStorageKey()) || {};
  const deck = buildDeck({
    query: flashcardsV2State.query,
    terms: flashcardsV2State.allTerms,
    progress,
    adapters: flashcardsV2State.adapters
  });
  msg.textContent = `${tOr("flashcards_generated_cards", "Generated")} ${deck.length} ${tOr("flashcards_cards_suffix", "card(s).")}`;
  startFlashcardsSession(deck);
  if(deck.length > 0) setFlashcardsBuilderCollapsed(true);
}

function handleFlashcardsRating(rating){
  const deck = flashcardsV2State.session.deck;
  const index = flashcardsV2State.session.index;
  const current = deck[index] || null;
  if(!current || !flashcardsV2State.session.revealed) return;
  applyFlashcardsRating(current.termId, rating);
  flashcardsV2State.session.index += 1;
  flashcardsV2State.session.revealed = false;
  if(flashcardsV2State.session.index >= deck.length){
    const msg = document.getElementById("flashcards-builder-msg");
    if(msg) msg.textContent = `${tOr("flashcards_session_finished", "Session finished.")} ${tOr("flashcards_reviewed", "Reviewed")} ${deck.length} ${tOr("flashcards_cards_suffix", "card(s).")}`;
    flashcardsV2State.session.deck = [];
    flashcardsV2State.session.index = 0;
    flashcardsV2State.session.querySnapshot = null;
    saveUserProfileNow("flashcards_session_end");
  }
  renderFlashcardsPlayer();
}

function initFlashcardsV2(){
  const domainsWrap = document.getElementById("flashcards-domains");
  const subdivision1Sel = document.getElementById("flashcards-subdivision1");
  const subdivision2Sel = document.getElementById("flashcards-subdivision2");
  const frontSel = document.getElementById("flashcards-front-field");
  const frontSel2 = document.getElementById("flashcards-front-field-2");
  const backSel = document.getElementById("flashcards-back-field");
  const backSel2 = document.getElementById("flashcards-back-field-2");
  const onlySel = document.getElementById("flashcards-only");
  const limitSel = document.getElementById("flashcards-limit");
  const generateBtn = document.getElementById("flashcards-generate");
  const cardBtn = document.getElementById("flashcards-card");
  const revealBtn = document.getElementById("flashcards-reveal");
  const againBtn = document.getElementById("flashcards-again");
  const goodBtn = document.getElementById("flashcards-good");
  const easyBtn = document.getElementById("flashcards-easy");
  if(!domainsWrap || !subdivision1Sel || !subdivision2Sel || !frontSel || !frontSel2 || !backSel || !backSel2 || !onlySel || !limitSel || !generateBtn || !cardBtn || !revealBtn || !againBtn || !goodBtn || !easyBtn) return;

  ensureFlashcardsV2DataLoaded().then(()=>{
    refreshFlashcardsBuilderUI();
    renderFlashcardsPlayer();
  });

  domainsWrap.addEventListener("change", ()=>{
    flashcardsV2State.query.subdivision1 = [];
    flashcardsV2State.query.subdivision2 = [];
    refreshFlashcardsBuilderUI();
  });
  frontSel.addEventListener("change", ()=>{
    flashcardsV2State.query.frontFieldKey = String(frontSel.value || "");
    if(flashcardsV2State.query.frontFieldKey === String(backSel.value || "")){
      const alt = [...backSel.options].map(opt => opt.value).find(v => v !== flashcardsV2State.query.frontFieldKey);
      if(alt) backSel.value = alt;
    }
    flashcardsV2State.query.backFieldKey = String(backSel.value || "");
    syncFlashcardsDashboard();
  });
  frontSel2.addEventListener("change", ()=>{
    const val = String(frontSel2.value || "");
    flashcardsV2State.query.frontFieldSecondaryKey = val && val !== String(frontSel.value || "") ? val : "";
    if(flashcardsV2State.query.frontFieldSecondaryKey !== val) frontSel2.value = "";
    syncFlashcardsDashboard();
  });
  backSel.addEventListener("change", ()=>{
    flashcardsV2State.query.backFieldKey = String(backSel.value || "");
    if(flashcardsV2State.query.backFieldKey === String(frontSel.value || "")){
      const alt = [...frontSel.options].map(opt => opt.value).find(v => v !== flashcardsV2State.query.backFieldKey);
      if(alt) frontSel.value = alt;
    }
    flashcardsV2State.query.frontFieldKey = String(frontSel.value || "");
    syncFlashcardsDashboard();
  });
  backSel2.addEventListener("change", ()=>{
    const val = String(backSel2.value || "");
    flashcardsV2State.query.backFieldSecondaryKey = val && val !== String(backSel.value || "") ? val : "";
    if(flashcardsV2State.query.backFieldSecondaryKey !== val) backSel2.value = "";
    syncFlashcardsDashboard();
  });
  onlySel.addEventListener("change", ()=>{
    flashcardsV2State.query.only = String(onlySel.value || "random");
    syncFlashcardsDashboard();
  });
  limitSel.addEventListener("change", ()=>{
    flashcardsV2State.query.limit = Math.max(1, Number(limitSel.value) || 20);
    syncFlashcardsDashboard();
  });
  generateBtn.addEventListener("click", ()=> generateFlashcardsSession());
  cardBtn.addEventListener("click", ()=>{
    if(!flashcardsV2State.session.deck[flashcardsV2State.session.index]) return;
    flashcardsV2State.session.revealed = true;
    renderFlashcardsPlayer();
  });
  revealBtn.addEventListener("click", ()=>{
    if(!flashcardsV2State.session.deck[flashcardsV2State.session.index]) return;
    flashcardsV2State.session.revealed = true;
    renderFlashcardsPlayer();
  });
  againBtn.addEventListener("click", ()=> handleFlashcardsRating("again"));
  goodBtn.addEventListener("click", ()=> handleFlashcardsRating("good"));
  easyBtn.addEventListener("click", ()=> handleFlashcardsRating("easy"));
}

function isSmokeMode(){
  return new URLSearchParams(window.location.search).get("smoke") === "1";
}

function waitForNextUiTurn(){
  return new Promise((resolve)=>{
    requestAnimationFrame(()=> setTimeout(resolve, 0));
  });
}

function exposeSmokeTestApi(){
  if(!isSmokeMode()) return;
  window.__appTestApi = {
    ready(){
      return appReadyPromise || Promise.resolve();
    },
    isGuestMode(){
      return !state.currentUser && !isProfileSessionActive();
    },
    async saveSmokeTerm(token){
      const marker = String(token || `smoke-${Date.now()}`);
      showScreen('screen-entry', { skipNavStack: true });
      const categorySelect = document.getElementById('entry-category');
      if(categorySelect) categorySelect.value = 'basic_sciences';
      await renderEntryCategoryFields();
      const firstField = document.querySelector('#entry-dynamic-fields input:not([type="file"]), #entry-dynamic-fields textarea');
      if(!firstField) return false;
      firstField.value = `SMOKE ${marker}`;
      const saveBtn = document.getElementById('save-term');
      if(saveBtn) saveBtn.click();
      await waitForNextUiTurn();
      return getLocalTerms().some(term => JSON.stringify(term || {}).includes(marker));
    },
    hasSmokeTerm(token){
      const marker = String(token || "");
      return getLocalTerms().some(term => JSON.stringify(term || {}).includes(marker));
    },
    cleanupSmokeTerm(token){
      const marker = String(token || "");
      if(!marker) return false;
      const filtered = getLocalTerms().filter(term => !JSON.stringify(term || {}).includes(marker));
      setLocalTerms(filtered);
      renderEntryHistory();
      return true;
    },
    async searchSmoke(query){
      showScreen('screen-search', { skipNavStack: true });
      const dataset = document.getElementById('search-dataset');
      const input = document.getElementById('search-input');
      if(dataset) dataset.value = 'all';
      if(input) input.value = String(query || "");
      await runMainSearchNow();
      return document.querySelectorAll('#search-results .result').length;
    },
    async startQuizSmoke(){
      showScreen('screen-quiz', { skipNavStack: true });
      await ensureFlashcardsV2DataLoaded();
      renderQuizGeneratorUi();
      renderQuizStudioInsights();
      const questionCount = document.getElementById('quiz-question-count');
      const startBtn = document.getElementById('start-quiz');
      if(questionCount) questionCount.value = '5';
      if(startBtn) startBtn.click();
      await waitForNextUiTurn();
      const quizArea = document.getElementById('quiz-area');
      const stage = document.getElementById('quiz-session-stage');
      return !!quizArea && !!stage && !stage.classList.contains('hidden') && String(quizArea.textContent || '').trim().length > 0;
    },
    async generateFlashcardsSmoke(){
      showScreen('screen-flashcards', { skipNavStack: true });
      await ensureFlashcardsV2DataLoaded();
      refreshFlashcardsBuilderUI();
      generateFlashcardsSession();
      await waitForNextUiTurn();
      return Array.isArray(flashcardsV2State.session.deck) ? flashcardsV2State.session.deck.length : 0;
    }
  };
}

window.addEventListener('popstate', ()=>{
  const screenId = getScreenForRoute(getRouteFromLocation() || "menu");
  showScreen(screenId, { updateHistory: false, skipNavStack: true });
  void prepareScreenAfterNavigation(screenId);
});

function bootstrapApp(){
  if(appReadyPromise) return appReadyPromise;
  appReadyPromise = init();
  exposeSmokeTestApi();
  return appReadyPromise;
}

if(document.readyState === 'loading'){
  window.addEventListener('DOMContentLoaded', ()=>{ void bootstrapApp(); }, { once: true });
} else {
  void bootstrapApp();
}
