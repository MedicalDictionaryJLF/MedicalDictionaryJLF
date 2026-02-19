// ================================
// Google Drive Authentication
// ================================
// Replace with your OAuth Web Client ID from Google Cloud Console.
// Google Cloud OAuth setup:
// - Authorized JavaScript origins must include your app host (e.g. http://localhost:8000, https://<user>.github.io).
// - Required scope: https://www.googleapis.com/auth/drive.appdata
const GOOGLE_CLIENT_ID = "595058136144-2e6f4u64er110a38sdi6ludegbrkqbao.apps.googleusercontent.com";
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.appdata";

// --- DOM helpers (prevents crashes if an element is missing) ---
const $ = (id)=>document.getElementById(id);
const on = (id, ev, fn)=>{ const el=$(id); if(!el){ console.warn('Missing element:', id); return; } el.addEventListener(ev, fn); };

// ====== Routing + paths (supports /main/, /anamnesis/, etc.) ======
const SECTIONS = new Set(["main","anamnesis","muscles","quiz","flashcards"]);

function currentSection(){
  const path = window.location.pathname.replace(/\/+$/,'');
  const last = path.split('/').pop() || "";
  if(SECTIONS.has(last)) return last;
  const p = new URLSearchParams(window.location.search).get("page");
  if(p && SECTIONS.has(p.toLowerCase())) return p.toLowerCase();
  return "root";
}

const IS_SECTION_PAGE = currentSection() !== "root";
const DATA_BASE = IS_SECTION_PAGE ? "../data/" : "data/";

let gTokenClient = null;
let gAccessToken = "";
let gTokenExpiresAt = 0;
let gAuthInFlight = false;
let googleBtnWired = false;
let googleSettingsBtnWired = false;
let userProfile = null;
let profileFileId = "";
let profileFileEtag = "";
let profileDirty = false;
let profileAutosaveTimer = null;
let profileSaveInFlight = false;
let profileSaveQueued = false;

// ===== Offline cache via IndexedDB (stores downloaded CSVs) =====
const IDB_NAME = "mdict_cache";
const IDB_STORE = "files";
const IDB_VERSION = 1;

function idbOpen(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(IDB_STORE)){
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key){
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const store = tx.objectStore(IDB_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value){
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    const req = store.put(value, key);
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
  const text = await loadFile(DATA_BASE + localPath);
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



// --- Utilities: File loader that works with both http and file:// protocols ---
async function loadFile(filename) {
  try {
    const response = await fetch(filename);
    return await response.text();
  } catch (e) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', filename, true);
      xhr.onload = () => resolve(xhr.responseText);
      xhr.onerror = () => {
        try {
          const fallbackXhr = new XMLHttpRequest();
          fallbackXhr.open('GET', filename, false);
          fallbackXhr.send();
          if (fallbackXhr.status === 200) resolve(fallbackXhr.responseText);
          else reject(new Error(`Failed to load ${filename}`));
        } catch (finalError) {
          reject(finalError);
        }
      };
      xhr.send();
    });
  }
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
    if(reason !== "autosave"){
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
    const about = await driveLoadCurrentUser().catch(()=> ({ displayName: "", emailAddress: "" }));
    const profileLang = normalizeLanguage((userProfile && userProfile.settings && userProfile.settings.app_language) || state.language);
    const profileTextSize = String((userProfile && userProfile.settings && userProfile.settings.text_size) || (localStorage.getItem(TEXT_SIZE_KEY) || "4"));
    await setLanguage(profileLang);
    applyTextSize(profileTextSize);
    const sizeSlider = document.getElementById("text-size-slider");
    if(sizeSlider) sizeSlider.value = profileTextSize;
    state.currentUser = about.displayName || about.emailAddress || "Google user";
    state.currentUserEmail = about.emailAddress || "";
    updateAuthUI();
    startProfileAutosave();
    setLoginStatus("Profile loaded.", "ok");
    showScreen("screen-submenu");
    renderQuizUI();
    refreshFlashcardsSession();
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
  setLoginStatus("Connecting...", "info");
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

function wireSettingsGoogleBtnOnce(){
  if(googleSettingsBtnWired) return;
  googleSettingsBtnWired = true;
  const btn = document.getElementById("to-login-from-settings-public");
  if(!btn) return;
  btn.addEventListener("click", ()=>{
    const sidebar = document.getElementById('settings-sidebar');
    const overlay = document.getElementById('settings-overlay');
    if(sidebar) sidebar.classList.remove('open');
    if(overlay) overlay.classList.remove('open');
    requestGoogleAccessTokenFromClick();
  });
}

async function signOutGoogleDrive(){
  if(profileDirty){
    await saveUserProfileNow("signout");
  }
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
  }
  if(token && window.google && google.accounts && google.accounts.oauth2 && typeof google.accounts.oauth2.revoke === "function"){
    try{ google.accounts.oauth2.revoke(token, ()=>{}); }catch(e){}
  }
  updateAuthUI();
  try{ renderQuizUI(); }catch(e){}
  try{ refreshFlashcardsSession(); }catch(e){}
  setLoginStatus("Signed out.", "info");
}

// --- Utilities: robust CSV parser for quoted fields (RFC4180-ish) ---
function parseCSVLines(text){
  const rows = [];
  let cur = [];
  let curField = '';
  let inQuotes = false;

  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const semiCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delimiter = semiCount > commaCount ? ';' : ',';

  for(let i=0;i<text.length;i++){
    const ch = text[i];
    const next = text[i+1];
    if(inQuotes){
      if(ch === '"'){
        if(next === '"'){ curField += '"'; i++; } else { inQuotes = false; }
      } else { curField += ch; }
    } else {
      if(ch === '"') { inQuotes = true; }
      else if(ch === delimiter){ cur.push(curField); curField = ''; }
      else if(ch === '\r') continue;
      else if(ch === '\n'){ cur.push(curField); rows.push(cur); cur = []; curField = ''; }
      else curField += ch;
    }
  }
  if(curField !== '' || cur.length>0) { cur.push(curField); rows.push(cur); }
  return rows;
}

function rowsToObjects(rows){
  if(!rows || rows.length === 0) return [];
  const headers = rows[0].map(h=>String(h || '').replace(/^\uFEFF/, '').trim());
  const objs = [];
  for(let i=1;i<rows.length;i++){
    const row = rows[i];
    const obj = {};
    for(let j=0;j<headers.length;j++) obj[headers[j]] = (row[j]||'').trim();
    objs.push(obj);
  }
  return objs;
}

function rowsToObjectsWithHeaders(rows){
  if(!rows || rows.length === 0) return { headers: [], objects: [] };
  const headers = rows[0].map(h=>String(h || '').replace(/^\uFEFF/, '').trim());
  const objects = [];
  for(let i=1;i<rows.length;i++){
    const row = rows[i];
    const obj = {};
    for(let j=0;j<headers.length;j++) obj[headers[j]] = (row[j]||'').trim();
    objects.push(obj);
  }
  return { headers, objects };
}

// --- Translation loader ---
const translations = {};
const anamnesisDictionary = new Map();
const anamnesisDictionaryById = new Map();
const anamnesisTextNodes = new WeakMap();
const ANAMNESIS_INTERNAL_CSV_CANDIDATES = [
  DATA_BASE + "app_language/anamnesis_internal.csv",
  "data/app_language/anamnesis_internal.csv"
];

function normalizeAnamnesisText(text){
  return String(text || '').replace(/\s+/g, ' ').trim();
}

async function loadAnamnesisDictionary(){
  try{
    const candidates = ANAMNESIS_INTERNAL_CSV_CANDIDATES;
    let rows = null;
    let loadedFrom = '';
    let lastErr = null;
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
          loadedFrom = path;
          break;
        }
      }catch(e){
        lastErr = e;
      }
    }
    if(!rows){
      if(lastErr) throw lastErr;
      throw new Error('Anamnesis file could not be loaded');
    }
    const objects = rowsToObjects(rows);
    anamnesisDictionary.clear();
    anamnesisDictionaryById.clear();
    for(const row of objects){
      const key = String(
        row.id_anamnesis ||
        row.ID_ANAMNESIS ||
        row.id ||
        ''
      ).trim();
      const english = normalizeAnamnesisText(row.english_translation);
      const slovak = normalizeAnamnesisText(row.slovak_translation);
      if(key){
        anamnesisDictionaryById.set(key, { key, english, slovak });
      }
      if(!english) continue;
      anamnesisDictionary.set(english, { english, slovak });
    }
    if(anamnesisDictionaryById.size === 0){
      throw new Error(`Anamnesis dictionary loaded from ${loadedFrom}, but no id_anamnesis keys were parsed`);
    }
  }catch(e){
    console.warn('Anamnesis translations load failed:', e.message || e);
    anamnesisDictionary.clear();
    anamnesisDictionaryById.clear();
  }
}

function translateAnamnesisText(baseText){
  const normalized = normalizeAnamnesisText(baseText);
  if(!normalized) return baseText;
  const row = anamnesisDictionary.get(normalized);
  if(!row) return baseText;
  const lang = normalizeLanguage(state.language);
  if(lang === 'Slovensky' && row.slovak) return row.slovak;
  if(lang === 'Deutsch' && row.slovak) return row.slovak;
  if(lang === 'English') return row.english || baseText;
  return row.english || baseText;
}

function translateAnamnesisById(key, fallbackText = ''){
  const row = anamnesisDictionaryById.get(String(key || '').trim());
  if(!row) return fallbackText;
  const lang = normalizeLanguage(state.language);
  if(lang === 'Slovensky' && row.slovak) return row.slovak;
  if(lang === 'Deutsch' && row.slovak) return row.slovak;
  if(lang === 'English') return row.english || fallbackText;
  return row.english || fallbackText;
}

function applyAnamnesisTranslationsToDom(){
  const section = document.getElementById('anamnesis-form-internal-wrap');
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

  section.querySelectorAll('h2,h3,strong,span,label,summary,th,button').forEach(el=>{
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
    const txt = await loadFile(DATA_BASE + 'app_language/app_translations.csv');
    const rows = parseCSVLines(txt);
    if(rows.length < 1) throw new Error('No data in translations file');

    Object.keys(translations).forEach(k => delete translations[k]);

    const headers = rows[0].map(h => h.trim());
    for(let i = 1; i < headers.length; i++) {
      const lang = normalizeTranslationHeader(headers[i]);
      translations[lang] = {};
    }

    for(let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const key = row[0].trim();
      if(!key) continue;

      for(let j = 1; j < headers.length; j++) {
        const lang = normalizeTranslationHeader(headers[j]);
        const text = (row[j] || '').trim();
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
  }catch(e){
    console.warn('Translations load failed:', e.message);
  }
}

// --- Medical terms loader ---
const TERMINOLOGY_SOURCES = [
  { key: "anatomy", label: "Anatomy", path: "terminology/anatomy.csv" },
  { key: "diagnostic_methods", label: "Diagnostic methods", path: "terminology/diagnostic_methods.csv" },
  { key: "disease_and_symptoms", label: "Diseases and symptoms", path: "terminology/disease_and_symptoms.csv" },
  { key: "lab_parameters", label: "Laboratory parameters", path: "terminology/lab_parameters.csv" },
  { key: "latin", label: "Latin", path: "terminology/latin/latin_units.csv", sourceLabel: "Units" },
  { key: "latin", label: "Latin", path: "terminology/latin/latin_greek.csv", sourceLabel: "Latin-Greek synonyms" },
  { key: "latin", label: "Latin", path: "terminology/latin/latin_abbreviations.csv", sourceLabel: "Abbreviations in medicine" },
  { key: "latin", label: "Latin", path: "terminology/latin/latin_remedies.csv", sourceLabel: "Remedies" },
  { key: "microorganisms", label: "Microorganisms", path: "terminology/microorganisms.csv" },
  { key: "pharmacology", label: "Pharmacology", path: "terminology/pharmacology/pharmacology.csv" },
  { key: "physiology", label: "Physiology", path: "terminology/physiology.csv" },
  { key: "procedures", label: "Procedures", path: "terminology/procedures.csv" },
  { key: "muscles", label: "Muscles", path: "terminology/muscles.csv" },
];

const SEARCH_GROUP_DEFINITIONS = [
  { key: "basic_sciences", label: "Basic sciences", datasets: ["anatomy", "physiology"] },
  { key: "diagnostics_procedures", label: "Diagnostics & Procedures", datasets: ["diagnostic_methods", "procedures"] },
  { key: "disease_and_symptoms", label: "Diseases and symptoms", datasets: ["disease_and_symptoms"] },
  { key: "lab_parameters", label: "Laboratory parameters", datasets: ["lab_parameters"] },
  { key: "latin", label: "Latin", datasets: ["latin"] },
  { key: "microorganisms", label: "Microorganisms", datasets: ["microorganisms"] },
  { key: "pharmacology", label: "Pharmacology", datasets: ["pharmacology"] }
];
const SEARCH_GROUP_BY_DATASET = {
  anatomy: "basic_sciences",
  physiology: "basic_sciences",
  diagnostic_methods: "diagnostics_procedures",
  procedures: "diagnostics_procedures",
  disease_and_symptoms: "disease_and_symptoms",
  lab_parameters: "lab_parameters",
  latin: "latin",
  microorganisms: "microorganisms",
  pharmacology: "pharmacology"
};
const SEARCH_GROUP_LABEL_BY_KEY = Object.fromEntries(SEARCH_GROUP_DEFINITIONS.map(g => [g.key, g.label]));
const SEARCH_GROUP_KEYS = SEARCH_GROUP_DEFINITIONS.map(g => g.key);
const ALL_SEARCH_DATASET_KEYS = [...new Set(SEARCH_GROUP_DEFINITIONS.flatMap(g => g.datasets))];
const SEARCH_LC_FIELDS = [
  "english_translation",
  "german_translation",
  "slovak_translation",
  "latin_translation",
  "abbreviation"
];

const LAB_DATASET_KEY = "lab_parameters";
const LAB_TAG_FILTER_MODE = "AND"; // switch to "OR" to allow any selected tag
const LAB_SEARCH_DEBOUNCE_MS = 200;
const LAB_DEFAULT_SYSTEM = "Uncategorized";
const LAB_VISIBLE_TAGS_ON_CARD = 3;

const ALLOWED_TAGS = [
  "Complete blood count",
  "Inflammation",
  "Infection",
  "Renal",
  "Electrolytes",
  "Acid-base",
  "Metabolism",
  "Liver",
  "Lipids",
  "Endocrine",
  "Cardiac",
  "Coagulation",
  "Urinalysis",
  "Arterial blood gas",
  "ICU",
  "Oncology",
  "Autoimmune",
  "Toxicology",
  "Neurology",
  "Transfusion"
];

const TAG_NORMALIZATION_MAP = {
  // CBC-related
  "CBC": "Complete blood count",
  "Anemia": "Complete blood count",
  "Hemolysis": "Complete blood count",
  "Iron studies": "Complete blood count",
  "Deficiency": "Complete blood count",

  // Electrolytes
  "Hyperkalemia": "Electrolytes",
  "Hyponatremia": "Electrolytes",
  "Hypernatremia": "Electrolytes",

  // Renal
  "AKI": "Renal",
  "CKD": "Renal",
  "Hydration": "Renal",

  // Cardiac
  "ACS": "Cardiac",
  "Arrhythmia": "Cardiac",
  "Heart failure": "Cardiac",
  "ASCVD": "Cardiac",

  // Coagulation
  "Bleeding": "Coagulation",
  "Thrombosis": "Coagulation",
  "DIC": "Coagulation",
  "Thrombophilia": "Coagulation",

  // Liver
  "Cholestasis": "Liver",
  "Liver injury": "Liver",
  "Jaundice": "Liver",

  // Metabolism
  "DKA": "Metabolism",
  "Diabetes": "Metabolism",
  "Gout": "Metabolism",
  "Metabolic syndrome": "Metabolism",

  // ICU
  "Sepsis": "ICU",
  "Shock": "ICU",
  "Perfusion": "ICU",

  // Neurology
  "Meningitis": "Neurology",

  // Urinalysis
  "UTI": "Urinalysis",

  // ABG
  "ABG": "Arterial blood gas",

  // Blood bank
  "Blood bank": "Transfusion"
};

function normalizeTags(rawTags) {
  if (!rawTags) return [];

  const parsed = rawTags
    .split(";")
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0);

  const normalized = parsed.map(tag => {
    return TAG_NORMALIZATION_MAP[tag] || tag;
  });

  // Keep only allowed tags
  const filtered = normalized.filter(tag =>
    ALLOWED_TAGS.includes(tag)
  );

  // Deduplicate
  return [...new Set(filtered)];
}

function normalizeLabRow(obj){
  const system = String(obj.system || "").trim() || LAB_DEFAULT_SYSTEM;
  const tagLabels = normalizeTags(obj.tags);
  const tagKeys = tagLabels.map(tag => tag.toLowerCase());
  return {
    ...obj,
    tags: tagLabels,
    system,
    __labSystem: system,
    __labSystemKey: system.toLowerCase(),
    __labTags: tagLabels,
    __labTagKeys: tagKeys,
    __labTagKeySet: new Set(tagKeys),
  };
}

let medicalTerms = [];
const datasetCache = new Map(); // source.path -> parsed rows
const datasetLoadPromises = new Map(); // source.path -> Promise<rows[]>
const loadedSourcePaths = new Set();

function getSearchGroupKeyForDataset(datasetKey){
  return SEARCH_GROUP_BY_DATASET[datasetKey] || datasetKey;
}

function buildLowercaseCache(row, headers){
  const lc = {};
  for(const field of SEARCH_LC_FIELDS){
    lc[field] = String(row[field] || "").toLowerCase();
  }
  const lcHeaders = (headers || [])
    .filter(h => h)
    .map(h => String(row[h] || "").toLowerCase());
  return { lc, lcHeaders };
}

function buildLoadedMedicalRow(source, obj, headers){
  const row = source.key === LAB_DATASET_KEY ? normalizeLabRow(obj) : obj;
  const { lc, lcHeaders } = buildLowercaseCache(row, headers);
  return {
    ...row,
    __dataset: source.key,
    __group: getSearchGroupKeyForDataset(source.key),
    __datasetLabel: source.label,
    __groupLabel: SEARCH_GROUP_LABEL_BY_KEY[getSearchGroupKeyForDataset(source.key)] || source.label,
    __sourceLabel: source.sourceLabel || source.label,
    __sourcePath: source.path,
    __headers: headers,
    __lc: lc,
    __lcHeaders: lcHeaders
  };
}

async function loadMedicalSource(source){
  if(loadedSourcePaths.has(source.path)){
    return datasetCache.get(source.path) || [];
  }
  const inFlight = datasetLoadPromises.get(source.path);
  if(inFlight) return inFlight;

  const work = (async ()=>{
    try{
      const txt = await loadBaseFile(source.path);
      const rows = parseCSVLines(txt);
      if(rows.length < 1){
        datasetCache.set(source.path, []);
        loadedSourcePaths.add(source.path);
        return [];
      }
      const parsed = rowsToObjectsWithHeaders(rows);
      const headers = (parsed.headers || []).filter(h=>h);
      const loadedRows = (parsed.objects || []).map(obj => buildLoadedMedicalRow(source, obj, headers));
      datasetCache.set(source.path, loadedRows);
      loadedSourcePaths.add(source.path);
      if(loadedRows.length){
        medicalTerms.push(...loadedRows);
      }
      return loadedRows;
    }catch(e){
      console.warn('Medical terms load failed for', source.path + ':', e.message || e);
      datasetCache.set(source.path, []);
      loadedSourcePaths.add(source.path);
      return [];
    }finally{
      datasetLoadPromises.delete(source.path);
    }
  })();

  datasetLoadPromises.set(source.path, work);
  return work;
}

async function ensureMedicalDatasetsLoaded(datasetKeys){
  const wantedKeys = [...new Set((datasetKeys || []).map(v => String(v || "").trim()).filter(Boolean))];
  if(wantedKeys.length === 0) return medicalTerms;
  const sources = TERMINOLOGY_SOURCES.filter(source => wantedKeys.includes(source.key));
  if(sources.length === 0) return medicalTerms;
  await Promise.all(sources.map(source => loadMedicalSource(source)));
  return medicalTerms;
}

function isSearchGroupLoaded(groupKey){
  const group = SEARCH_GROUP_DEFINITIONS.find(g => g.key === groupKey);
  if(!group) return true;
  const sources = TERMINOLOGY_SOURCES.filter(source => group.datasets.includes(source.key));
  return sources.every(source => loadedSourcePaths.has(source.path));
}

function areAllSearchGroupsLoaded(){
  return SEARCH_GROUP_KEYS.every(groupKey => isSearchGroupLoaded(groupKey));
}

async function loadMedicalTerms(options = {}) {
  const opts = options || {};
  if(opts && opts.clearCache){
    medicalTerms = [];
    datasetCache.clear();
    datasetLoadPromises.clear();
    loadedSourcePaths.clear();
  }
  const datasetKeys = opts.loadAll ? [...new Set(TERMINOLOGY_SOURCES.map(s => s.key))] : (opts.datasetKeys || []);
  return ensureMedicalDatasetsLoaded(datasetKeys);
}

// --- Muscles loader ---
let muscleTerms = [];
async function loadMuscles() {
  try {
    const txt = await loadBaseFile('terminology/muscles.csv');
    const rows = parseCSVLines(txt);
    if(rows.length < 1) throw new Error('No data in muscles file');
    muscleTerms = rowsToObjects(rows);
  } catch(e) {
    console.warn('Muscles load failed:', e.message);
    muscleTerms = [];
  }
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
  }
};

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
  return String(value || "").toLowerCase().includes(query);
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
      if(value && value.includes(query)) return true;
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

const LATIN_HEADER_TRANSLATION_KEYS = {
  latin_term: 'latin_search_latin_term',
  latin_genitive: 'latin_search_latin_genitive',
  part_of_speech: 'latin_search_part_of_speech',
  gender: 'latin_search_gender',
  english_translation: 'latin_search_english_translation',
  german_translation: 'latin_search_german_translation',
  slovak_translation: 'latin_search_slovak_translation',
  notes: 'latin_search_notes',
  latin_translation: 'latin_search_latin_translation',
  greek_translation: 'latin_search_greek_translation',
  abbreviation: 'latin_search_abbreviation',
  full_form: 'latin_search_full_form',
  name: 'latin_search_name',
  english_description: 'latin_search_english_description',
  german_description: 'latin_search_german_description',
  slovak_description: 'latin_search_slovak_description',
  category: 'latin_search_category',
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
  const datasetLabel = row.__datasetLabel ? `<div class="small" style="margin-top:4px">${row.__datasetLabel}</div>` : "";

  let kv = "";
  for(const h of headers){
    const v = String(row[h] || "").trim();
    if(!v) continue;
    kv += `<div class="k">${formatHeaderLabel(h)}</div><div class="v">${v}</div>`;
  }

  return `<strong>${head}</strong>${datasetLabel}${kv ? `<div class="kv">${kv}</div>` : ""}`;
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
    searchPlaceholder: "Begriff oder Abkürzung suchen (mind. 2 Zeichen)",
    systemLabel: "System",
    allSystems: "Alle Systeme",
    tagsLabel: "Tags",
    clearFilters: "Filter löschen",
    selectedTagsAria: "Ausgewählte Tags",
    availableTagsAria: "Verfügbare Tags",
    noSelectedTags: "Kein Tag ausgewählt",
    noTags: "Keine Tags verfügbar",
    noResults: "Keine passenden Ergebnisse gefunden.",
    back: "Zurück",
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
  abbreviation: { English: "Abbreviation", Deutsch: "Abkürzung", Slovensky: "Skratka" },
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
  return (LAB_UI_LABELS[lang] && LAB_UI_LABELS[lang][key]) || LAB_UI_LABELS.English[key] || key;
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
  if(selectedTermIds.length === 0) throw new Error("Quiz must contain at least one selected term.");
  const settings = doc.settings && typeof doc.settings === "object" ? doc.settings : {};
  const type = ["multiple_choice", "matching", "typing"].includes(String(settings.type || doc.typeHint || "")) ? String(settings.type || doc.typeHint) : "multiple_choice";
  return {
    quizId: String(doc.id || genId("quiz:")),
    name,
    description: String(doc.description || "").trim(),
    type,
    fromField: String(settings.fromField || "english_translation"),
    toField: String(settings.toField || "latin_translation"),
    termIds: selectedTermIds,
    filters: doc.filters && typeof doc.filters === "object" ? {
      includeCategories: Array.isArray(doc.filters.includeCategories) ? doc.filters.includeCategories : [],
      excludeCategories: Array.isArray(doc.filters.excludeCategories) ? doc.filters.excludeCategories : [],
      onlyWithDefinitions: !!doc.filters.onlyWithDefinitions
    } : { includeCategories: [], excludeCategories: [], onlyWithDefinitions: false },
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
  const selectedWrap = document.getElementById("lab-parameters-selected-tags");
  const availableWrap = document.getElementById("lab-parameters-tags-available");
  if(!selectedWrap || !availableWrap) return;
  const selected = state.labParameters.selectedTagKeys;
  selectedWrap.setAttribute("aria-label", labText("selectedTagsAria"));
  availableWrap.setAttribute("aria-label", labText("availableTagsAria"));

  if(selected.size === 0){
    selectedWrap.innerHTML = `<span class="lab-chip lab-chip-muted">${escapeHTML(labText("noSelectedTags"))}</span>`;
  } else {
    const selectedTags = tags.filter(tag => selected.has(tag.key));
    selectedWrap.innerHTML = selectedTags.map(tag => `
      <span class="lab-chip">
        ${escapeHTML(tag.label)}
        <button type="button" class="lab-chip-close" data-tag-key="${escapeHTML(tag.key)}" aria-label="Remove ${escapeHTML(tag.label)}">x</button>
      </span>
    `).join("");
  }

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
    resultsDiv.textContent = labText("noResults");
    return;
  }
  const titleField = getLabTermTitleField();
  resultsDiv.innerHTML = rows.map(row => {
    const title = String(row[titleField] || row.english_term || row.german_term || row.slovak_term || "").trim();
    const abbr = String(row.abbreviation || "").trim();
    const shownTags = (row.__labTags || []).slice(0, LAB_VISIBLE_TAGS_ON_CARD);
    const hiddenTagCount = Math.max(0, (row.__labTags || []).length - shownTags.length);
    const topChips = [
      `<span class="lab-chip lab-chip-muted">${escapeHTML(getLocalizedSystem(row.__labSystem || LAB_DEFAULT_SYSTEM))}</span>`,
      ...shownTags.map(tag => `<span class="lab-chip lab-chip-muted">${escapeHTML(tag)}</span>`),
      hiddenTagCount > 0 ? `<span class="lab-chip lab-chip-muted">+${hiddenTagCount} ${escapeHTML(labText("more"))}</span>` : ""
    ].filter(Boolean).join("");

    const kv = LAB_RESULT_FIELD_ORDER
      .filter(field => field !== titleField)
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
    "to-lab-parameters": "menuButton",
    "lab-parameters-title": "pageTitle",
    "lab-parameters-subtitle": "subtitle",
    "lab-tags-filter-label": "tagsLabel",
    "lab-parameters-clear-filters": "clearFilters",
    "lab-parameters-back": "back"
  };
  for(const [id, key] of Object.entries(map)){
    const el = document.getElementById(id);
    if(el) el.textContent = labText(key);
  }
  const searchInput = document.getElementById("lab-parameters-search-input");
  if(searchInput){
    searchInput.placeholder = labText("searchPlaceholder");
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

  const si = document.getElementById('search-input');
  if(si && si.value && si.value.trim().length >= 2){
    si.dispatchEvent(new Event('input', { bubbles:true }));
  }

  refreshMuscleTrainingUI();
  refreshLatinTerminologyUI();
  refreshLabParametersUI();
}

function t(key){
  const lang = state.language;
  if(translations[lang] && translations[lang][key]) return translations[lang][key];
  if(translations['English'] && translations['English'][key]) return translations['English'][key];
  return key;
}

function tOr(key, fallback){
  const value = t(key);
  return value === key ? fallback : value;
}

function applyTranslationsToDom(){
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.getAttribute('data-i18n');
    el.textContent = t(k);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const k = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(k);
  });
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
const TEXT_SIZE_KEY = "text_size";
const NAV_SESSION_KEY = "nav/last_screen_session";
const TEXT_SIZES = [13,14,15,16,17,18,19];
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
  appendHighlightedText(v, value || '—', highlightQuery);
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
      return value || '—';
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
  anyOpt.textContent = tOr('latin_search_any', 'Any');
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
  if(rowsId === "medication-rows"){
    const searchBtn = document.createElement("button");
    searchBtn.type = "button";
    searchBtn.className = "anam-remove-row anam-search-row";
    searchBtn.textContent = "🔍";
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
      const suffix = (lang === "Slovensky") ? "použitie lieku" : "drug use";
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

function getActiveAnamnesisForm(){
  if(activeAnamnesisTab === "psychiatry"){
    return document.getElementById("anamnesis-psychiatry-form");
  }
  return document.getElementById("anamnesis-form");
}

function getAnamnesisStorageKeyByTab(tab){
  return tab === "psychiatry" ? ANAMNESIS_PSYCHIATRY_STORAGE_KEY : ANAMNESIS_STORAGE_KEY;
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
    DATA_BASE + "app_language/anamnesis_psychiatry.csv",
    "data/app_language/anamnesis_psychiatry.csv",
    DATA_BASE + "anamnesis_psychiatry.csv"
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
    const candidates = ANAMNESIS_INTERNAL_CSV_CANDIDATES;
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

  const sections = [];
  let currentSection = null;
  let currentGroup = null;
  for(const field of fields){
    if(!String(field.field_id || "").trim()) continue;
    if(!currentSection || currentSection.id !== field.section_id){
      const sectionNo = parsePsychiatrySectionNumber(field.section_id);
      currentSection = {
        id: field.section_id,
        no: Number.isFinite(sectionNo) ? sectionNo : (sections.length + 1),
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
    form.dataset.ready = "1";
    form.addEventListener("input", scheduleAnamnesisSave);
    form.addEventListener("change", scheduleAnamnesisSave);
  }catch(e){
    form.innerHTML = "";
    const msg = document.createElement("p");
    msg.className = "muted";
    msg.textContent = "Failed to load psychiatry anamnesis form.";
    form.appendChild(msg);
    console.warn("Psychiatry anamnesis form load failed:", e.message || e);
  }
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

function saveAnamnesisForm(){
  const form = getActiveAnamnesisForm();
  if(!form) return;
  const data = collectAnamnesisData(form);
  const notes = document.getElementById("anamnesis-notes-text");
  if(notes) data.anamnesis_global_notes = notes.value;
  localStorage.setItem(getAnamnesisStorageKeyByTab(activeAnamnesisTab), JSON.stringify(data));
  const status = document.getElementById("anamnesis-status");
  if(status) status.textContent = t("anam_saved_locally") || "Saved locally.";
}

function scheduleAnamnesisSave(){
  clearTimeout(anamnesisSaveTimer);
  anamnesisSaveTimer = setTimeout(saveAnamnesisForm, 300);
}

async function loadInternalAnamnesisForm(){
  const form = document.getElementById('anamnesis-form');
  if(!form) return;
  if(anamnesisDictionaryById.size === 0){
    try{ await loadAnamnesisDictionary(); }catch(e){}
  }
  const raw = localStorage.getItem(ANAMNESIS_STORAGE_KEY);
  if(!raw){
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
    applyAnamnesisTranslationsToDom();
    return;
  }
  let data = null;
  try{ data = JSON.parse(raw); }catch(e){ data = null; }
  if(!data){
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
    applyAnamnesisTranslationsToDom();
    return;
  }
  initAnamnesisRepeaters(data);
  form.querySelectorAll('input, textarea, select').forEach(el=>{
    if(!el.name || !(el.name in data)) return;
    if(el.type === 'checkbox') el.checked = !!data[el.name];
    else if(el.type === 'radio') el.checked = (data[el.name] === el.value);
    else el.value = data[el.name];
  });
  const notes = document.getElementById("anamnesis-notes-text");
  if(notes) notes.value = data.anamnesis_global_notes || "";
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
  applyAnamnesisTranslationsToDom();
}

async function loadPsychiatryAnamnesisForm(){
  await ensurePsychiatryAnamnesisFormBuilt();
  const form = document.getElementById("anamnesis-psychiatry-form");
  if(!form) return;
  const raw = localStorage.getItem(ANAMNESIS_PSYCHIATRY_STORAGE_KEY);
  let data = null;
  try{ data = raw ? JSON.parse(raw) : null; }catch(e){ data = null; }
  if(data){
    applyAnamnesisData(form, data);
  } else {
    form.reset();
  }
  const notes = document.getElementById("anamnesis-notes-text");
  if(notes) notes.value = (data && data.anamnesis_global_notes) ? data.anamnesis_global_notes : "";
}

async function loadAnamnesisForm(){
  if(activeAnamnesisTab === "psychiatry"){
    await loadPsychiatryAnamnesisForm();
    return;
  }
  await loadInternalAnamnesisForm();
}

function clearInternalAnamnesisForm(){
  const form = document.getElementById('anamnesis-form');
  if(form) form.reset();
  localStorage.removeItem(ANAMNESIS_STORAGE_KEY);
  initAnamnesisRepeaters(null);
  const notes = document.getElementById("anamnesis-notes-text");
  if(notes) notes.value = "";
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
  const status = document.getElementById('anamnesis-status');
  if(status) status.textContent = t('anam_cleared') || 'Cleared.';
}

function clearPsychiatryAnamnesisForm(){
  const form = document.getElementById("anamnesis-psychiatry-form");
  if(form) form.reset();
  const notes = document.getElementById("anamnesis-notes-text");
  if(notes) notes.value = "";
  localStorage.removeItem(ANAMNESIS_PSYCHIATRY_STORAGE_KEY);
  const status = document.getElementById("anamnesis-status");
  if(status) status.textContent = t("anam_cleared") || "Cleared.";
}

function clearAnamnesisForm(){
  if(activeAnamnesisTab === "psychiatry"){
    clearPsychiatryAnamnesisForm();
    return;
  }
  clearInternalAnamnesisForm();
}

async function setAnamnesisTab(tab, opts = {}){
  const { load = true } = opts;
  const nextTab = tab === "psychiatry" ? "psychiatry" : "internal";
  if(activeAnamnesisTab !== nextTab) saveAnamnesisForm();
  activeAnamnesisTab = nextTab;

  const internalWrap = document.getElementById("anamnesis-form-internal-wrap");
  const psychiatryWrap = document.getElementById("anamnesis-form-psychiatry-wrap");
  if(internalWrap) internalWrap.classList.toggle("hidden", nextTab !== "internal");
  if(psychiatryWrap) psychiatryWrap.classList.toggle("hidden", nextTab !== "psychiatry");

  document.querySelectorAll("#screen-anamnesis .anamnesis-bookmark[data-anam-tab]").forEach(btn=>{
    const isActive = btn.dataset.anamTab === nextTab;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  if(load) await loadAnamnesisForm();
}

function applyTextSize(step){
  const clamped = Math.max(1, Math.min(7, Number(step) || 4));
  const px = TEXT_SIZES[clamped - 1] || 16;
  const scale = px / 16;
  document.body.style.setProperty('--base-font-size', px + 'px');
  document.body.style.setProperty('--text-scale', String(scale));
  localStorage.setItem(TEXT_SIZE_KEY, String(clamped));
  if(isProfileSessionActive()){
    userProfile.settings.text_size = String(clamped);
    markProfileDirty();
  }
}

function showScreen(id, opts = {}){
  const { updateHistory = true, replaceHistory = false } = opts;
  document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
  const el = document.getElementById(id);
  if(el) el.classList.remove('hidden');

  // Persist current view in the URL (refresh keeps screen)
  const h = "#" + encodeURIComponent(id);
  if(updateHistory && location.hash !== h){
    if(replaceHistory) history.replaceState(null, "", h);
    else location.hash = h;
  }

  // Persist per tab session: survives refresh, resets after tab/browser close.
  try{ sessionStorage.setItem(NAV_SESSION_KEY, id); }catch(e){}
}

const mainSearchState = {
  debounceTimer: null,
  requestSeq: 0,
  anyWarmupPromise: null
};

function getSearchGroupDefinition(groupKey){
  return SEARCH_GROUP_DEFINITIONS.find(g => g.key === groupKey) || null;
}

function getSearchDatasetKeysForSelection(groupKey){
  if(groupKey === "all") return ALL_SEARCH_DATASET_KEYS.slice();
  const def = getSearchGroupDefinition(groupKey);
  return def ? def.datasets.slice() : [];
}

function isRowInSearchSelection(row, selectedGroup){
  if(!row || !row.__group) return false;
  if(selectedGroup === "all"){
    return SEARCH_GROUP_KEYS.includes(row.__group);
  }
  return row.__group === selectedGroup;
}

function getLoadedSearchRows(){
  return medicalTerms.filter(row => row && SEARCH_GROUP_KEYS.includes(row.__group));
}

function collectMainSearchResults(query, selectedGroup, langField, userField){
  const results = [];
  const seenBase = new Set();
  const seenUser = new Set();
  const searchAllHeaders = selectedGroup === LATIN_DATASET_KEY;

  for(const row of getLoadedSearchRows()){
    if(!isRowInSearchSelection(row, selectedGroup)) continue;
    const cachedField = row.__lc && row.__lc[langField] ? row.__lc[langField] : "";
    const baseMatch = cachedField.includes(query);
    const latinHeaderMatch = searchAllHeaders && matchAnyHeader(row, query);
    if(baseMatch || latinHeaderMatch){
      results.push({ kind: "base", row });
      seenBase.add(row);
      if(results.length >= SEARCH_MAX_RESULTS){
        return { results, truncated: true };
      }
    }
  }

  if(selectedGroup === "all"){
    for(const trow of getLocalTerms()){
      const lc = ensureUserSearchLowercaseCache(trow) || {};
      const userValue = lc[userField] || "";
      if(userValue.includes(query)){
        results.push({ kind: "user", row: trow });
        seenUser.add(trow);
        if(results.length >= SEARCH_MAX_RESULTS){
          return { results, truncated: true };
        }
      }
    }
  }

  if(results.length === 0){
    for(const row of getLoadedSearchRows()){
      if(!isRowInSearchSelection(row, selectedGroup)) continue;
      if(!seenBase.has(row) && matchAnyHeader(row, query)){
        results.push({ kind: "base", row });
        seenBase.add(row);
        if(results.length >= SEARCH_MAX_RESULTS){
          return { results, truncated: true };
        }
      }
    }
    if(selectedGroup === "all"){
      for(const trow of getLocalTerms()){
        const lc = ensureUserSearchLowercaseCache(trow) || {};
        const anyFieldMatch = USER_LC_SEARCH_FIELDS.some(field => (lc[field] || "").includes(query));
        if(!seenUser.has(trow) && anyFieldMatch){
          results.push({ kind: "user", row: trow });
          seenUser.add(trow);
          if(results.length >= SEARCH_MAX_RESULTS){
            return { results, truncated: true };
          }
        }
      }
    }
  }

  return { results, truncated: false };
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
    const row = item.row || {};
    const head = (row[userField]||row.latin||row.english||"").trim();
    const def = (row.notes||"").trim();
    return `<div class="result"><strong>${head}</strong>${def?`<div class="muted" style="margin-top:6px">${def}</div>`:""}
      <div class="kv">
        <div class="k">Latin</div><div class="v">${row.latin||""}</div>
        <div class="k">English</div><div class="v">${row.english||""}</div>
        <div class="k">German</div><div class="v">${row.german||""}</div>
        <div class="k">Slovak</div><div class="v">${row.slovak||""}</div>
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

  if(selectedGroup !== "all" && !isSearchGroupLoaded(selectedGroup)){
    resultsDiv.textContent = tOr("loading", "Loading...");
    await ensureMedicalDatasetsLoaded(getSearchDatasetKeysForSelection(selectedGroup));
    if(requestId !== mainSearchState.requestSeq) return;
  }

  const langField = getBaseSearchField();
  const userField = getUserSearchField();
  const { results, truncated } = collectMainSearchResults(q, selectedGroup, langField, userField);
  const loadingMore = selectedGroup === "all" && !areAllSearchGroupsLoaded();
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
    `<option value="all">Any</option>`,
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
  const who = document.getElementById('header-whoami');
  const whoUser = document.getElementById('header-user');
  const accountBlock = document.getElementById('settings-account-block');
  const loginBlock = document.getElementById('settings-login-block');
  const accountUser = document.getElementById('current-user');

  const loggedIn = !!state.currentUser;
  if(loggedIn){
    if(cog) cog.classList.remove('hidden');
    if(who) who.classList.remove('hidden');
    if(whoUser) whoUser.textContent = state.currentUser;
    if(accountBlock) accountBlock.classList.remove('hidden');
    if(accountUser) accountUser.textContent = state.currentUser;
    if(loginBlock) loginBlock.classList.add('hidden');
  } else {
    if(cog) cog.classList.remove('hidden');
    if(who) who.classList.add('hidden');
    if(whoUser) whoUser.textContent = "Guest";
    if(accountBlock) accountBlock.classList.add('hidden');
    if(accountUser) accountUser.textContent = "(none)";
    if(loginBlock) loginBlock.classList.remove('hidden');
    // ensure settings is closed if user logs out
    const sidebar = document.getElementById('settings-sidebar');
    const overlay = document.getElementById('settings-overlay');
    if(sidebar) sidebar.classList.remove('open');
    if(overlay) overlay.classList.remove('open');
  }
}

async function logoutToLogin(){
  await signOutGoogleDrive();
  const cu = document.getElementById('current-user');
  if(cu) cu.textContent = "(none)";
  updateAuthUI();
  showScreen('screen-menu');
}

function initialScreenForSection(section){
  if(section === "anamnesis") return "screen-anamnesis";
  if(section === "muscles") return "screen-muscle-training";
  if(section === "quiz") return "screen-quiz";
  if(section === "flashcards") return "screen-flashcards";
  if(section === "main") return "screen-submenu";
  return "screen-menu";
}

async function init(){
  // Optional: refresh base CSV cache (static assets in this build)
  try{ await refreshBaseFilesCache(); }catch(e){ console.warn('Base CSV refresh skipped:', e); }
  try{
    await appStorage.init();
    await migrateLegacyFlashcardData();
  }catch(e){
    console.warn("Flashcard storage init failed, flashcards may be limited:", e);
  }
  await Promise.all([loadTranslations(), loadMedicalTerms(), loadMuscles(), loadAnamnesisDictionary()]);

  // Apply language instantly (no reload needed)
  await setLanguage(state.language);

  // Settings sidebar handling
  const settingsBtn = document.getElementById('settings-toggle');
  const sidebar = document.getElementById('settings-sidebar');
  const overlay = document.getElementById('settings-overlay');
  const settingsClose = document.getElementById('settings-close');

  function openSettings(){
    if(!sidebar || !overlay) return;
    sidebar.classList.add('open');
    overlay.classList.add('open');
  }
  function closeSettings(){
    if(!sidebar || !overlay) return;
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
  }
  function toggleSettings(){
    if(!sidebar) return;
    if(sidebar.classList.contains('open')) closeSettings();
    else openSettings();
  }

  if(settingsBtn) settingsBtn.addEventListener('click', toggleSettings);
  if(overlay) overlay.addEventListener('click', closeSettings);
  if(settingsClose) settingsClose.addEventListener('click', closeSettings);

  // Hero language buttons
  document.querySelectorAll('.lang-btn').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      e.preventDefault();
      const lang = btn.getAttribute('data-lang');
      await setLanguage(lang);
    });
  });

  // Text size selection (7 steps)
  const sizeSlider = document.getElementById('text-size-slider');
  const savedSize = localStorage.getItem(TEXT_SIZE_KEY) || '4';
  applyTextSize(savedSize);
  if(sizeSlider){
    sizeSlider.value = savedSize;
    sizeSlider.addEventListener('input', ()=> applyTextSize(sizeSlider.value));
  }

  wireGoogleBtnOnce();
  wireSettingsGoogleBtnOnce();

  function openGuestModal(){
    const ov = document.getElementById('guest-overlay');
    if(ov) ov.classList.remove('hidden');
  }
  function closeGuestModal(){
    const ov = document.getElementById('guest-overlay');
    if(ov) ov.classList.add('hidden');
  }

  on('continue-guest','click', ()=> openGuestModal());
  on('guest-back','click', ()=> closeGuestModal());
  on('guest-continue','click', ()=>{
    closeGuestModal();
    showScreen('screen-submenu');
  });
  on('forgot-cancel','click', ()=>{});


  on('to-search','click', ()=> {
    showScreen('screen-search');
    const datasetSelect = document.getElementById('search-dataset');
    const selectedGroup = datasetSelect ? datasetSelect.value : "all";
    if(selectedGroup === "all"){
      scheduleAnySearchWarmup(async ()=>{});
    } else {
      ensureMedicalDatasetsLoaded(getSearchDatasetKeysForSelection(selectedGroup));
    }
    debounceMainSearch();
  });
  on('to-lab-parameters','click', async ()=> {
    showScreen('screen-lab-parameters');
    await ensureMedicalDatasetsLoaded([LAB_DATASET_KEY]);
    refreshLabParametersUI();
  });
  on('to-entry','click', ()=> { showScreen('screen-entry'); });
  on('to-latin-terminology','click', async ()=> {
    showScreen('screen-latin-terminology');
    await ensureMedicalDatasetsLoaded([LATIN_DATASET_KEY]);
    refreshLatinTerminologyUI();
  });
  on('to-quiz','click', async ()=> {
    showScreen('screen-quiz');
    await ensureMedicalDatasetsLoaded(ALL_SEARCH_DATASET_KEYS);
    await ensureFlashcardsV2DataLoaded();
    renderQuizGeneratorUi();
    refreshQuizBuilderUI();
  });
  on('to-flashcards','click', async ()=> {
    showScreen('screen-flashcards');
    await ensureMedicalDatasetsLoaded(ALL_SEARCH_DATASET_KEYS);
    refreshFlashcardsSession();
    await ensureFlashcardsV2DataLoaded();
    refreshFlashcardsBuilderUI();
  });
  on('to-muscle-training','click', ()=> { showScreen('screen-muscle-training'); });
  on('to-anamnesis','click', async ()=> {
    showScreen('screen-anamnesis');
    await setAnamnesisTab("internal", { load: true });
  });
  on('to-menu','click', ()=> { showScreen('screen-menu'); });
  on('to-login-from-settings','click', async ()=> { await logoutToLogin(); });

  const searchInput = document.getElementById('search-input');
  const resultsDiv = document.getElementById('search-results');
  const datasetSelect = document.getElementById('search-dataset');
  const labSearchInput = document.getElementById('lab-parameters-search-input');
  const labResultsDiv = document.getElementById('lab-parameters-results');
  const labAvailableTags = document.getElementById('lab-parameters-tags-available');
  const labSelectedTags = document.getElementById('lab-parameters-selected-tags');
  const labClearFiltersBtn = document.getElementById('lab-parameters-clear-filters');

  populateSearchDatasetSelect();

  if(resultsDiv){
    const controls = document.querySelector('#screen-search .search-controls');
    if(controls){
      const setOffset = ()=>{
        const h = controls.offsetHeight || 0;
        resultsDiv.style.setProperty('--search-controls-offset', h + 'px');
      };
      setOffset();
      window.addEventListener('resize', setOffset);
    }
  }
  if(labResultsDiv){
    const controls = document.querySelector('#screen-lab-parameters .search-controls');
    if(controls){
      const setOffset = ()=>{
        const h = controls.offsetHeight || 0;
        labResultsDiv.style.setProperty('--search-controls-offset', h + 'px');
      };
      setOffset();
      window.addEventListener('resize', setOffset);
    }
  }
  if(labSearchInput){
    labSearchInput.addEventListener('input', handleLabSearchInput);
  }
  if(labAvailableTags){
    labAvailableTags.addEventListener('click', (event)=>{
      const btn = event.target instanceof Element ? event.target.closest('[data-tag-key]') : null;
      if(!btn) return;
      toggleLabTag(btn.getAttribute('data-tag-key') || '');
    });
  }
  if(labSelectedTags){
    labSelectedTags.addEventListener('click', (event)=>{
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
  on('muscle-quiz-start','click', ()=> startMuscleQuiz());
  on('muscle-quiz-reveal','click', ()=>{ muscleQuizRevealed = true; renderMuscleQuizFields(); });
  on('muscle-quiz-next','click', ()=> showNextMuscle());
  on('muscle-training-back','click', ()=> showScreen('screen-submenu'));

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
  on('latin-quiz-start','click', ()=> startLatinQuiz());
  on('latin-quiz-reveal','click', ()=>{ latinQuizRevealed = true; renderLatinQuizFields(); });
  on('latin-quiz-next','click', ()=> showNextLatinTerm());
  on('latin-terminology-back','click', ()=> showScreen('screen-submenu'));

  const anamForm = document.getElementById('anamnesis-form');
  if(anamForm){
    initAnamnesisRepeaters(null);
    initAnamnesisNotesDrawer();
    anamForm.addEventListener('input', scheduleAnamnesisSave);
    anamForm.addEventListener('change', scheduleAnamnesisSave);
  }
  document.querySelectorAll('#screen-anamnesis .anamnesis-bookmark[data-anam-tab]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const tab = btn.dataset.anamTab || "internal";
      await setAnamnesisTab(tab, { load: true });
    });
  });
  for(const cfg of ANAMNESIS_REPEATERS){
    on(cfg.addId, 'click', ()=>{
      addRepeaterRow(cfg.rowsId);
      scheduleAnamnesisSave();
    });
  }
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
    if(confirm("Clear the whole anamnesis form? This cannot be undone.")){
      clearAnamnesisForm();
    }
  });
  on('anamnesis-back','click', ()=> showScreen('screen-submenu'));

  if(datasetSelect && searchInput){
    datasetSelect.addEventListener('change', ()=>{
      const selectedGroup = datasetSelect.value || "all";
      if(selectedGroup !== "all"){
        ensureMedicalDatasetsLoaded(getSearchDatasetKeysForSelection(selectedGroup));
      } else {
        scheduleAnySearchWarmup(async ()=>{});
      }
      debounceMainSearch();
    });
  }

  if(searchInput && resultsDiv){
    searchInput.addEventListener('input', debounceMainSearch);
  }

  on('search-back','click', ()=> showScreen('screen-submenu'));
  on('lab-parameters-back','click', ()=> showScreen('screen-submenu'));

  on('save-term','click', async ()=>{
    const fields = [...document.querySelectorAll('#entry-fields [data-field]')];
    const raw = {};
    for(const el of fields) raw[el.dataset.field] = el.value.trim();

    const term = {
      id: (typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function")
        ? `term:${crypto.randomUUID()}`
        : `term:${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`,
      english: raw.english_translation || "",
      german: raw.german_translation || "",
      latin: raw.latin_translation || "",
      slovak: raw.slovak_translation || "",
      notes: raw.english_definition || raw.german_definition || "",
      source_dataset: "manual_entry",
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
    fields.forEach(f=>f.value='');
  });

  on('entry-back','click', ()=> showScreen('screen-submenu'));
  on('start-quiz','click', ()=> startQuiz());
  on('end-quiz','click', ()=> {
    quizEngine.finishQuiz();
    renderQuizUI();
    saveUserProfileNow("quiz_end");
  });
  on('quiz-back','click', ()=> showScreen('screen-submenu'));
  if(document.getElementById('flashcard-back')){
    on('flashcard-back','click', ()=> showScreen('screen-submenu'));
  }
  on('flashcards-back','click', ()=> showScreen('screen-submenu'));
  document.addEventListener('keydown', handleQuizKeyboardShortcuts);

  updateAuthUI();
  refreshLabParametersUI();
  initQuizBuilderUI();
  initQuizGeneratorUI();
  renderQuizUI();
  initFlashcardsUI();
  refreshFlashcardsSession();
  initFlashcardsV2();

  const hashId = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  const savedSession = sessionStorage.getItem(NAV_SESSION_KEY) || "";
  const start =
    (hashId && document.getElementById(hashId)) ? hashId :
    (savedSession && document.getElementById(savedSession)) ? savedSession :
    "screen-menu";

  showScreen(start, { replaceHistory: true });
  if(start === "screen-anamnesis") loadAnamnesisForm();
  if(start === "screen-search"){
    const ds = document.getElementById('search-dataset');
    if(ds && ds.value === "all") scheduleAnySearchWarmup(async ()=>{});
    else ensureMedicalDatasetsLoaded(getSearchDatasetKeysForSelection(ds ? ds.value : "all"));
    debounceMainSearch();
  }
  if(start === "screen-lab-parameters"){
    await ensureMedicalDatasetsLoaded([LAB_DATASET_KEY]);
    refreshLabParametersUI();
  }
  if(start === "screen-latin-terminology"){
    await ensureMedicalDatasetsLoaded([LATIN_DATASET_KEY]);
    refreshLatinTerminologyUI();
  }
  if(start === "screen-quiz"){
    await ensureMedicalDatasetsLoaded(ALL_SEARCH_DATASET_KEYS);
    await ensureFlashcardsV2DataLoaded();
    renderQuizGeneratorUi();
    refreshQuizBuilderUI();
  }
  if(start === "screen-flashcards"){
    await ensureMedicalDatasetsLoaded(ALL_SEARCH_DATASET_KEYS);
    refreshFlashcardsSession();
    await ensureFlashcardsV2DataLoaded();
    refreshFlashcardsBuilderUI();
  }
  applyTranslationsToDom();
}


const QUIZ_PROGRESS_KEY = "quiz/progress_v1";
const QUIZ_SESSIONS_KEY = "quiz/sessions_v1";
const QUIZ_CUSTOM_KEY = "quiz/custom_quizzes_v1";
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
let quizGeneratorSubdivision1 = "";
let quizGeneratorSubdivision2 = "";
let quizGeneratorFrontFieldKey = "";
let quizGeneratorBackFieldKey = "";

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
    subdivision1: String(q.subdivision1 || ""),
    subdivision2: String(q.subdivision2 || "")
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
    return `<label class="checkbox-item"><input type="radio" name="qb-domain" data-qb-domain="${escapeHTML(adapter.key)}"${checked} /> ${escapeHTML(adapter.label)}</label>`;
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
      sub2Sel.innerHTML = ['<option value="">All</option>', ...opts2.map(v => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`)].join("");
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
  const fromField = pair.fromField;
  const toField = pair.toField;
  const quizType = document.getElementById("qb-type")?.value || "multiple_choice";
  const includeCategories = toCategoryFilters(document.getElementById("qb-category-include")?.value || "");
  const excludeCategories = toCategoryFilters(document.getElementById("qb-category-exclude")?.value || "");
  const onlyWithDefinitions = !!document.getElementById("qb-only-definitions")?.checked;
  return {
    quizId: quizBuilderEditingId || genId("quiz:"),
    name: String(document.getElementById("qb-name")?.value || "").trim(),
    description: String(document.getElementById("qb-description")?.value || "").trim(),
    type: ["multiple_choice", "matching", "typing"].includes(quizType) ? quizType : "multiple_choice",
    fromField,
    toField,
    termIds: [...quizBuilderSelectedIds],
    filters: { includeCategories, excludeCategories, onlyWithDefinitions, fieldQuery }
  };
}

function applyQuizBuilderConfigToForm(cfg){
  if(!cfg) return;
  const from = String(cfg.fromField || "");
  const to = String(cfg.toField || "");
  const type = String(cfg.type || "multiple_choice");
  const name = String(cfg.name || "");
  const description = String(cfg.description || "");
  const include = ((cfg.filters && cfg.filters.includeCategories) || []).join(", ");
  const exclude = ((cfg.filters && cfg.filters.excludeCategories) || []).join(", ");
  const onlyDef = !!(cfg.filters && cfg.filters.onlyWithDefinitions);

  const setValue = (id, val)=>{
    const el = document.getElementById(id);
    if(el) el.value = val;
  };
  setValue("qb-name", name);
  setValue("qb-description", description);
  setValue("qb-type", type);
  setValue("qb-from", from);
  setValue("qb-to", to);
  setValue("qb-category-include", include);
  setValue("qb-category-exclude", exclude);
  const onlyDefEl = document.getElementById("qb-only-definitions");
  if(onlyDefEl) onlyDefEl.checked = onlyDef;

  const fq = (cfg.filters && cfg.filters.fieldQuery) || {};
  quizBuilderDomainKey = String(fq.domainKey || quizBuilderDomainKey || "");
  quizBuilderSubdivision1 = String(fq.subdivision1 || "");
  quizBuilderSubdivision2 = String(fq.subdivision2 || "");
  quizBuilderFrontFieldKey = String(fq.frontFieldKey || "");
  quizBuilderBackFieldKey = String(fq.backFieldKey || "");
  renderQuizBuilderDomainUi();

  const quizTypeSel = document.getElementById("quiz-type");
  if(quizTypeSel) quizTypeSel.value = type;
  const fromSel = document.getElementById("quiz-from");
  if(fromSel) fromSel.value = from;
  const toSel = document.getElementById("quiz-to");
  if(toSel) toSel.value = to;

  quizBuilderEditingId = String(cfg.quizId || "");
  quizBuilderSelectedIds = new Set((cfg.termIds || []).map(x => String(x || "").trim()).filter(Boolean));
}

function getCandidateMapForBuilder(){
  const candidates = getQuizBuilderFilteredCandidates();
  const map = new Map();
  for(const c of candidates){
    map.set(c.termId, c);
  }
  return map;
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

function renderQuizBuilderSelectedList(){
  const list = document.getElementById("qb-selected-list");
  const count = document.getElementById("qb-selected-count");
  const map = getCandidateMapForBuilder();
  const validIds = new Set(map.keys());
  [...quizBuilderSelectedIds].forEach(id => {
    if(!validIds.has(id)) quizBuilderSelectedIds.delete(id);
  });
  const rows = [...quizBuilderSelectedIds].map(id => map.get(id)).filter(Boolean);
  if(count) count.textContent = String(rows.length);
  if(!list) return;
  if(rows.length === 0){
    list.innerHTML = '<div class="muted">No terms selected.</div>';
    return;
  }
  list.innerHTML = rows.map(row => `
    <div class="quiz-builder-selected-item">
      <div>
        <strong>${escapeHTML(row.fromTerm || "")}</strong>
        <div class="small">${escapeHTML(row.toTerm || "")} | ${escapeHTML(row.category || "")}</div>
      </div>
      <button type="button" data-qb-remove-id="${escapeHTML(String(row.termId || ""))}" class="danger">Remove</button>
    </div>
  `).join("");
}

function getQuizBuilderFilteredCandidates(){
  const fieldQuery = getQuizBuilderFieldQueryFromForm();
  const includeCategories = toCategoryFilters(document.getElementById("qb-category-include")?.value || "");
  const excludeCategories = toCategoryFilters(document.getElementById("qb-category-exclude")?.value || "");
  const onlyWithDefinitions = !!document.getElementById("qb-only-definitions")?.checked;
  const legacyFrom = document.getElementById("qb-from")?.value || "english_translation";
  const legacyTo = document.getElementById("qb-to")?.value || "latin_translation";
  let candidates = (fieldQuery.domainKey && fieldQuery.frontFieldKey && fieldQuery.backFieldKey)
    ? buildQuizCandidatesFromFieldQuery(fieldQuery)
    : buildQuizCandidates(legacyFrom, legacyTo);
  if(includeCategories.length > 0){
    candidates = candidates.filter(c => includeCategories.some(cat => String(c.category || "").toLowerCase().includes(cat.toLowerCase())));
  }
  if(excludeCategories.length > 0){
    candidates = candidates.filter(c => !excludeCategories.some(cat => String(c.category || "").toLowerCase().includes(cat.toLowerCase())));
  }
  if(onlyWithDefinitions){
    candidates = candidates.filter(c => !!c.hasDefinition);
  }
  return candidates;
}

function renderQuizBuilderSuggestions(){
  const box = document.getElementById("qb-term-suggestions");
  const searchInput = document.getElementById("qb-term-search");
  if(!box || !searchInput) return;
  const q = String(searchInput.value || "").trim().toLowerCase();
  if(q.length < 2){
    box.innerHTML = '<div class="muted">Type at least 2 characters.</div>';
    return;
  }
  const candidates = getQuizBuilderFilteredCandidates();
  const hits = candidates.filter(c => {
    if(quizBuilderSelectedIds.has(c.termId)) return false;
    return includesQuery(c.fromTerm, q) || includesQuery(c.toTerm, q) || includesQuery(c.category, q);
  }).slice(0, 30);
  if(hits.length === 0){
    box.innerHTML = '<div class="muted">No matching results found.</div>';
    return;
  }
  box.innerHTML = hits.map(row => `
    <button type="button" class="quiz-builder-suggestion" data-qb-add-id="${escapeHTML(String(row.termId || ""))}">
      <strong>${escapeHTML(row.fromTerm || "")}</strong> -> ${escapeHTML(row.toTerm || "")}
      <div class="small">${escapeHTML(row.category || "")}</div>
    </button>
  `).join("");
}

function resetQuizBuilderForm(){
  quizBuilderEditingId = null;
  quizBuilderSelectedIds.clear();
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
    filters: { includeCategories: [], excludeCategories: [], onlyWithDefinitions: false, fieldQuery: {} }
  });
  setQuizBuilderMessage("");
  renderQuizBuilderSavedList();
  renderQuizBuilderSelectedList();
  renderQuizBuilderSuggestions();
}

function refreshQuizBuilderUI(){
  if(!document.getElementById("qb-saved-select")) return;
  renderQuizBuilderDomainUi();
  renderQuizBuilderSavedList();
  renderQuizBuilderSelectedList();
  renderQuizBuilderSuggestions();
}

function initQuizBuilderUI(){
  if(!document.getElementById("qb-name")) return;
  const domainsEl = document.getElementById("qb-domains");
  const subdivision1Sel = document.getElementById("qb-subdivision1");
  const subdivision2Sel = document.getElementById("qb-subdivision2");
  const frontFieldSel = document.getElementById("qb-front-field");
  const backFieldSel = document.getElementById("qb-back-field");
  const suggestions = document.getElementById("qb-term-suggestions");
  const selectedList = document.getElementById("qb-selected-list");
  const searchInput = document.getElementById("qb-term-search");
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
    renderQuizBuilderSelectedList();
    renderQuizBuilderSuggestions();
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
      renderQuizBuilderSelectedList();
      renderQuizBuilderSuggestions();
    });
    subdivision1Sel.addEventListener("change", ()=>{
      quizBuilderSubdivision1 = String(subdivision1Sel.value || "");
      quizBuilderSubdivision2 = "";
      renderQuizBuilderDomainUi();
      applyMainQuizSelectors();
      renderQuizBuilderSelectedList();
      renderQuizBuilderSuggestions();
    });
    subdivision2Sel.addEventListener("change", ()=>{
      quizBuilderSubdivision2 = String(subdivision2Sel.value || "");
      applyMainQuizSelectors();
      renderQuizBuilderSelectedList();
      renderQuizBuilderSuggestions();
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
      renderQuizBuilderSelectedList();
      renderQuizBuilderSuggestions();
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
      renderQuizBuilderSelectedList();
      renderQuizBuilderSuggestions();
    });
  }

  if(searchInput){
    searchInput.addEventListener("input", ()=> renderQuizBuilderSuggestions());
  }
  ["qb-type", "qb-category-include", "qb-category-exclude", "qb-only-definitions"].forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    el.addEventListener("change", ()=>{
      applyMainQuizSelectors();
      renderQuizBuilderSelectedList();
      renderQuizBuilderSuggestions();
    });
  });
  if(suggestions){
    suggestions.addEventListener("click", (event)=>{
      const btn = event.target && event.target.closest ? event.target.closest("[data-qb-add-id]") : null;
      if(!btn) return;
      const id = btn.getAttribute("data-qb-add-id");
      if(!id) return;
      quizBuilderSelectedIds.add(id);
      renderQuizBuilderSelectedList();
      renderQuizBuilderSuggestions();
    });
  }
  if(selectedList){
    selectedList.addEventListener("click", (event)=>{
      const btn = event.target && event.target.closest ? event.target.closest("[data-qb-remove-id]") : null;
      if(!btn) return;
      const id = btn.getAttribute("data-qb-remove-id");
      if(!id) return;
      quizBuilderSelectedIds.delete(id);
      renderQuizBuilderSelectedList();
      renderQuizBuilderSuggestions();
    });
  }

  on("qb-clear-selected", "click", ()=>{
    quizBuilderSelectedIds.clear();
    renderQuizBuilderSelectedList();
    renderQuizBuilderSuggestions();
  });
  on("qb-import-starred", "click", ()=>{
    const pair = getQuizBuilderPairKeysFromForm();
    const fromField = pair.fromField;
    const toField = pair.toField;
    const candidates = getQuizBuilderFilteredCandidates().filter(c => progressStore.isStarred(c.termId));
    candidates.forEach(c => quizBuilderSelectedIds.add(c.termId));
    setQuizBuilderMessage(`Imported ${candidates.length} starred terms.`);
    renderQuizBuilderSelectedList();
    renderQuizBuilderSuggestions();
    const fromSel = document.getElementById("quiz-from");
    const toSel = document.getElementById("quiz-to");
    if(fromSel) fromSel.value = fromField;
    if(toSel) toSel.value = toField;
  });
  on("qb-import-wrong", "click", ()=>{
    const pair = getQuizBuilderPairKeysFromForm();
    const fromField = pair.fromField;
    const toField = pair.toField;
    const candidates = getQuizBuilderFilteredCandidates();
    const candidateIds = new Set(candidates.map(c => c.termId));
    const wrongIds = getWrongTermIdsForPair(fromField, toField).filter(id => candidateIds.has(id));
    wrongIds.forEach(id => quizBuilderSelectedIds.add(id));
    setQuizBuilderMessage(`Imported ${wrongIds.length} wrong terms.`);
    renderQuizBuilderSelectedList();
    renderQuizBuilderSuggestions();
  });

  on("qb-new", "click", ()=> resetQuizBuilderForm());
  on("qb-save", "click", ()=>{
    const cfg = getQuizBuilderConfigFromForm();
    if(!cfg.name){
      setQuizBuilderMessage("Quiz name is required.");
      return;
    }
    if(!Array.isArray(cfg.termIds) || cfg.termIds.length === 0){
      setQuizBuilderMessage("Select at least one term.");
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
      termIds: cfg.termIds,
      filters: cfg.filters || { includeCategories: [], excludeCategories: [], onlyWithDefinitions: false },
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
    const retryItems = getQuizBuilderFilteredCandidates().filter(c => (hit.termIds || []).includes(c.termId));
    startQuiz({
      retryItems,
      configOverrides: {
        quizType: hit.type || "multiple_choice",
        fromField: hit.fromField || "english_translation",
        toField: hit.toField || "latin_translation",
        termIds: hit.termIds || [],
        customFilters: hit.filters || null
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
      subdivision1: String(quizGeneratorSubdivision1 || ""),
      subdivision2: String(quizGeneratorSubdivision2 || "")
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

function weightedSampleWithoutReplacement(items, count, weightFn){
  const pool = items.slice();
  const selected = [];
  const take = Math.min(count, pool.length);
  for(let i=0;i<take;i++){
    const weighted = pool.map(item => ({ item, weight: Math.max(0.01, Number(weightFn(item)) || 1) }));
    const total = weighted.reduce((sum, x)=>sum + x.weight, 0);
    let hit = Math.random() * total;
    let picked = weighted[weighted.length - 1].item;
    for(const x of weighted){
      hit -= x.weight;
      if(hit <= 0){ picked = x.item; break; }
    }
    selected.push(picked);
    const idx = pool.indexOf(picked);
    if(idx >= 0) pool.splice(idx, 1);
  }
  return selected;
}

function createQuizQuestions(candidates, questionCount, optionsCount, fromField, toField){
  const chosen = candidates.slice(0, questionCount);
  const questionType = "multiple_choice";
  const allAnswers = [...new Set(candidates.map(c => c.toTerm).filter(Boolean))];
  return chosen.map((candidate, idx)=>{
    const options = [candidate.toTerm];
    const distractors = allAnswers.filter(v => v !== candidate.toTerm);
    shuffle(distractors);
    for(let i=0; i<distractors.length && options.length < optionsCount; i++){
      options.push(distractors[i]);
    }
    shuffle(options);
    return {
      id: `q${idx + 1}`,
      type: questionType,
      fromField,
      toField,
      number: idx + 1,
      termId: candidate.termId,
      fromTerm: candidate.fromTerm,
      correctToTerm: candidate.toTerm,
      options: options.map((text, i)=>({ id: `o${i+1}`, text })),
      answered: false,
      selectedOptionId: null,
      isCorrect: null,
      sourceType: candidate.sourceType,
      sourceDataset: candidate.sourceDataset,
      baseTermKey: candidate.baseTermKey,
      userTermId: candidate.userTermId
    };
  });
}

function createTypingQuestions(candidates, questionCount, fromField, toField){
  const chosen = candidates.slice(0, questionCount);
  return chosen.map((candidate, idx)=>({
    id: `q${idx + 1}`,
    type: "typing",
    fromField,
    toField,
    number: idx + 1,
    termId: candidate.termId,
    fromTerm: candidate.fromTerm,
    correctToTerm: candidate.toTerm,
    answered: false,
    typedAnswer: "",
    isCorrect: null,
    sourceType: candidate.sourceType,
    sourceDataset: candidate.sourceDataset,
    baseTermKey: candidate.baseTermKey,
    userTermId: candidate.userTermId
  }));
}

function createMatchingQuestions(candidates, questionCount, fromField, toField){
  const chosen = candidates.slice(0, questionCount);
  const choices = [...new Set(chosen.map(c => c.toTerm).filter(Boolean))];
  shuffle(choices);
  const pairs = chosen.map((candidate, idx)=>({
    pairId: `p${idx + 1}`,
    termId: candidate.termId,
    fromTerm: candidate.fromTerm,
    correctToTerm: candidate.toTerm,
    selectedToTerm: "",
    isCorrect: null,
    sourceType: candidate.sourceType,
    sourceDataset: candidate.sourceDataset,
    baseTermKey: candidate.baseTermKey,
    userTermId: candidate.userTermId
  }));
  return [{
    id: "m1",
    type: "matching",
    fromField,
    toField,
    number: 1,
    pairs,
    choices,
    answered: false
  }];
}

const quizEngine = (() => {
  const state = {
    active: false,
    finished: false,
    quizType: "multiple_choice",
    fromField: null,
    toField: null,
    settings: null,
    pool: [],
    questions: [],
    currentIndex: 0,
    score: 0,
    answered: 0,
    streak: 0,
    bestStreak: 0,
    wrongAnswers: [],
    startedAt: null,
    finishedAt: null,
    timerSeconds: 0,
    timeLeftSeconds: null,
    timerHandle: null
  };

  function clearTimer(){
    if(state.timerHandle){
      clearInterval(state.timerHandle);
      state.timerHandle = null;
    }
  }

  function startTimer(){
    clearTimer();
    if(!(state.timerSeconds > 0)) return;
    const deadline = Date.now() + state.timerSeconds * 1000;
    state.timeLeftSeconds = state.timerSeconds;
    state.timerHandle = setInterval(()=>{
      const leftMs = deadline - Date.now();
      state.timeLeftSeconds = Math.max(0, Math.ceil(leftMs / 1000));
      if(leftMs <= 0){
        finishQuiz();
      } else {
        renderQuizUI();
      }
    }, 250);
  }

  function getCurrentQuestion(){
    return state.questions[state.currentIndex] || null;
  }

function startQuiz({ fromField, toField, questionCount, optionsCount, quizType = "multiple_choice", filters = {}, retryItems = null, termIds = null, customFilters = null }){
    const normalizedQuizType = ["multiple_choice", "matching", "typing"].includes(String(quizType || "")) ? String(quizType) : "multiple_choice";
    const onlyStarred = !!filters.onlyStarred;
    const preferWrong = !!filters.preferWrong;
    const doubleConfirm = !!filters.doubleConfirm;

    const savedSub1 = quizGeneratorSubdivision1;
    const savedSub2 = quizGeneratorSubdivision2;
    if(filters && typeof filters === "object"){
      if(Object.prototype.hasOwnProperty.call(filters, "subdivision1")) quizGeneratorSubdivision1 = String(filters.subdivision1 || "");
      if(Object.prototype.hasOwnProperty.call(filters, "subdivision2")) quizGeneratorSubdivision2 = String(filters.subdivision2 || "");
    }
    let candidates = retryItems && retryItems.length ? retryItems.slice() : buildQuizCandidates(fromField, toField);
    quizGeneratorSubdivision1 = savedSub1;
    quizGeneratorSubdivision2 = savedSub2;
    if(Array.isArray(termIds) && termIds.length > 0){
      const wanted = new Set(termIds.map(v => String(v || "").trim()).filter(Boolean));
      candidates = candidates.filter(c => wanted.has(String(c.termId || "").trim()));
    }
    if(customFilters){
      const include = (customFilters.includeCategories || []).map(v => String(v || "").trim().toLowerCase()).filter(Boolean);
      const exclude = (customFilters.excludeCategories || []).map(v => String(v || "").trim().toLowerCase()).filter(Boolean);
      const onlyWithDefinitions = !!customFilters.onlyWithDefinitions;
      candidates = candidates.filter(c => {
        const categoryText = String(c.category || "").toLowerCase();
        if(include.length > 0 && !include.some(v => categoryText.includes(v))) return false;
        if(exclude.length > 0 && exclude.some(v => categoryText.includes(v))) return false;
        if(onlyWithDefinitions && !c.hasDefinition) return false;
        return true;
      });
    }
    if(onlyStarred){
      candidates = candidates.filter(c => progressStore.isStarred(c.termId));
    }
    candidates = candidates.filter(c => c.fromTerm && c.toTerm);
    if(candidates.length < 1){
      return { ok: false, reason: "quiz_err_no_pairs" };
    }
    if(normalizedQuizType === "multiple_choice" && candidates.length < 2){
      return { ok: false, reason: "quiz_err_need_two_pairs" };
    }

    const maxQuestions = Math.max(1, Math.min(Number(questionCount) || 5, candidates.length));
    const answersPerQuestion = Math.max(2, Math.min(Number(optionsCount) || 4, 6));

    let selected = candidates.slice();
    if(preferWrong){
      selected = weightedSampleWithoutReplacement(candidates, maxQuestions, (candidate)=>{
        const stats = progressStore.getTermStats(candidate.termId, fromField, toField);
        const wrong = Number(stats.wrong || 0);
        const correct = Number(stats.correct || 0);
        return 1 + Math.max(0, wrong - correct) + Math.min(3, wrong);
      });
    } else {
      shuffle(selected);
      selected = selected.slice(0, maxQuestions);
    }

    state.active = true;
    state.finished = false;
    state.quizType = normalizedQuizType;
    state.fromField = fromField;
    state.toField = toField;
    state.settings = {
      questionCount: maxQuestions,
      optionsCount: answersPerQuestion,
      type: normalizedQuizType,
      filters: { onlyStarred, preferWrong, doubleConfirm },
      customFilters: customFilters || null,
      timer: Number(filters.timerSeconds || 0)
    };
    state.pool = candidates;
    if(normalizedQuizType === "typing"){
      state.questions = createTypingQuestions(selected, maxQuestions, fromField, toField);
    } else if(normalizedQuizType === "matching"){
      state.questions = createMatchingQuestions(selected, maxQuestions, fromField, toField);
    } else {
      state.questions = createQuizQuestions(selected, maxQuestions, answersPerQuestion, fromField, toField);
    }
    state.currentIndex = 0;
    state.score = 0;
    state.answered = 0;
    state.streak = 0;
    state.bestStreak = 0;
    state.wrongAnswers = [];
    state.startedAt = new Date().toISOString();
    state.finishedAt = null;
    state.timerSeconds = Number(filters.timerSeconds || 0);
    state.timeLeftSeconds = state.timerSeconds > 0 ? state.timerSeconds : null;
    startTimer();
    return { ok: true };
  }

  function answerQuestion(questionId, selectedOptionId){
    if(!state.active) return { ok: false, reason: "Quiz not active." };
    const question = getCurrentQuestion();
    if(!question || question.id !== questionId || question.answered){
      return { ok: false, reason: "Question already answered." };
    }
    if(question.type === "typing"){
      const typed = String(selectedOptionId || "").trim();
      question.answered = true;
      question.typedAnswer = typed;
      question.isCorrect = typed.toLowerCase() === String(question.correctToTerm || "").trim().toLowerCase();

      state.answered += 1;
      if(question.isCorrect){
        state.score += 1;
        state.streak += 1;
        state.bestStreak = Math.max(state.bestStreak, state.streak);
      } else {
        state.streak = 0;
        const wrongEntry = {
          termId: question.termId,
          fromTerm: question.fromTerm,
          correctToTerm: question.correctToTerm,
          userChosen: typed,
          timestamp: new Date().toISOString(),
          sourceType: question.sourceType,
          sourceDataset: question.sourceDataset,
          baseTermKey: question.baseTermKey,
          userTermId: question.userTermId
        };
        state.wrongAnswers.push(wrongEntry);
        appendWrongTermsLog({
          termId: wrongEntry.termId,
          fromField: question.fromField,
          toField: question.toField,
          chosen: wrongEntry.userChosen || "",
          correct: wrongEntry.correctToTerm || "",
          timestamp: wrongEntry.timestamp
        });
      }
      progressStore.recordAttempt(question.termId, question.fromField, question.toField, question.isCorrect);
      question.pendingOptionId = "";
      return { ok: true, question };
    }
    if(question.type === "matching"){
      return { ok: false, reason: "Use matching submit." };
    }

    const selected = question.options.find(o => o.id === selectedOptionId);
    if(!selected) return { ok: false, reason: "Invalid option." };

    question.answered = true;
    question.selectedOptionId = selectedOptionId;
    question.isCorrect = selected.text === question.correctToTerm;

    state.answered += 1;
    if(question.isCorrect){
      state.score += 1;
      state.streak += 1;
      state.bestStreak = Math.max(state.bestStreak, state.streak);
    } else {
      state.streak = 0;
      const wrongEntry = {
        termId: question.termId,
        fromTerm: question.fromTerm,
        correctToTerm: question.correctToTerm,
        userChosen: selected.text,
        timestamp: new Date().toISOString(),
        sourceType: question.sourceType,
        sourceDataset: question.sourceDataset,
        baseTermKey: question.baseTermKey,
        userTermId: question.userTermId
      };
      state.wrongAnswers.push(wrongEntry);
      appendWrongTermsLog({
        termId: wrongEntry.termId,
        fromField: question.fromField,
        toField: question.toField,
        chosen: wrongEntry.userChosen || "",
        correct: wrongEntry.correctToTerm || "",
        timestamp: wrongEntry.timestamp
      });
    }
    progressStore.recordAttempt(question.termId, question.fromField, question.toField, question.isCorrect);
    question.pendingOptionId = "";
    return { ok: true, question };
  }

  function submitMatching(questionId, answersByPairId){
    if(!state.active) return { ok: false, reason: "Quiz not active." };
    const question = getCurrentQuestion();
    if(!question || question.id !== questionId || question.answered || question.type !== "matching"){
      return { ok: false, reason: "Matching question unavailable." };
    }
    const answerMap = answersByPairId && typeof answersByPairId === "object" ? answersByPairId : {};
    let correctCount = 0;
    let wrongCount = 0;
    const timestamp = new Date().toISOString();
    for(const pair of question.pairs){
      const chosen = String(answerMap[pair.pairId] || "").trim();
      pair.selectedToTerm = chosen;
      pair.isCorrect = chosen.toLowerCase() === String(pair.correctToTerm || "").trim().toLowerCase();
      state.answered += 1;
      if(pair.isCorrect){
        correctCount += 1;
      } else {
        wrongCount += 1;
        const wrongEntry = {
          termId: pair.termId,
          fromTerm: pair.fromTerm,
          correctToTerm: pair.correctToTerm,
          userChosen: chosen,
          timestamp,
          sourceType: pair.sourceType,
          sourceDataset: pair.sourceDataset,
          baseTermKey: pair.baseTermKey,
          userTermId: pair.userTermId
        };
        state.wrongAnswers.push(wrongEntry);
        appendWrongTermsLog({
          termId: wrongEntry.termId,
          fromField: question.fromField,
          toField: question.toField,
          chosen: wrongEntry.userChosen || "",
          correct: wrongEntry.correctToTerm || "",
          timestamp: wrongEntry.timestamp
        });
      }
      progressStore.recordAttempt(pair.termId, question.fromField, question.toField, pair.isCorrect);
    }
    state.score += correctCount;
    state.streak = wrongCount === 0 ? state.streak + 1 : 0;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    question.answered = true;
    return { ok: true, question };
  }

  function nextQuestion(){
    if(!state.active) return;
    const q = getCurrentQuestion();
    if(!q || !q.answered) return;
    if(state.currentIndex >= state.questions.length - 1){
      finishQuiz();
      return;
    }
    state.currentIndex += 1;
  }

  function finishQuiz(){
    if(!state.active && state.finished) return getQuizState();
    clearTimer();
    state.active = false;
    state.finished = true;
    state.finishedAt = new Date().toISOString();
    const summary = {
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      fromField: state.fromField,
      toField: state.toField,
      score: state.score,
      total: state.settings && state.settings.questionCount ? state.settings.questionCount : state.questions.length,
      wrongAnswers: state.wrongAnswers.slice(),
      settings: state.settings
    };
    progressStore.recordSession(summary);
    saveUserProfileNow("quiz_end");
    return getQuizState();
  }

  function getQuizState(){
    return {
      active: state.active,
      finished: state.finished,
      quizType: state.quizType,
      fromField: state.fromField,
      toField: state.toField,
      settings: state.settings,
      questions: state.questions,
      currentIndex: state.currentIndex,
      currentQuestion: getCurrentQuestion(),
      score: state.score,
      answered: state.answered,
      streak: state.streak,
      bestStreak: state.bestStreak,
      wrongAnswers: state.wrongAnswers,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      timeLeftSeconds: state.timeLeftSeconds
    };
  }

  return { startQuiz, answerQuestion, submitMatching, getQuizState, finishQuiz, nextQuestion };
})();

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
        <div class="small">${escapeHTML(tOr('quiz_correct_label', 'Correct'))}: ${escapeHTML(item.correctToTerm || '')}</div>
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
    const rowsHtml = q.pairs.map((pair, idx)=>{
      const wrongWithCorrect = `${tOr('wrong', 'Wrong')} (${tOr('quiz_correct_label', 'Correct')}: ${pair.correctToTerm})`;
      const status = !q.answered ? '' : (pair.isCorrect
        ? `<span class="quiz-feedback ok">${escapeHTML(tOr('correct', 'Correct'))}</span>`
        : `<span class="quiz-feedback bad">${escapeHTML(wrongWithCorrect)}</span>`);
      const options = [`<option value="">${escapeHTML(tOr('quiz_select_answer', 'Select answer'))}</option>`]
        .concat(q.choices.map(choice => `<option value="${escapeHTML(choice)}"${pair.selectedToTerm === choice ? ' selected' : ''}>${escapeHTML(choice)}</option>`))
        .join("");
      return `
        <div class="quiz-wrong-item">
          <div><strong>${idx + 1}. ${escapeHTML(pair.fromTerm)}</strong></div>
          <div class="row">
            <select data-match-pair="${escapeHTML(pair.pairId)}" ${q.answered ? 'disabled' : ''}>${options}</select>
          </div>
          ${status}
        </div>
      `;
    }).join("");

    area.innerHTML = `
      <div class="quiz-question ${q.answered ? 'quiz-answered' : ''}" data-question-id="${escapeHTML(q.id)}">
        <div class="quiz-question-title">${escapeHTML(tOr('quiz_match_terms', 'Match terms'))} (${q.pairs.length} ${escapeHTML(tOr('quiz_pairs', 'pairs'))})</div>
        <div class="quiz-wrong-list">${rowsHtml}</div>
        <div class="row">
          ${q.answered
            ? `<button type="button" id="quiz-next-question" class="primary">${escapeHTML(tOr('quiz_finish', 'Finish'))}</button>`
            : `<button type="button" id="quiz-submit-matching" class="primary">${escapeHTML(tOr('quiz_submit_matching', 'Submit matching'))}</button>`}
        </div>
      </div>
    `;

    const submitBtn = document.getElementById('quiz-submit-matching');
    if(submitBtn){
      submitBtn.addEventListener('click', ()=>{
        const answers = {};
        area.querySelectorAll('[data-match-pair]').forEach(el => {
          const key = el.getAttribute('data-match-pair');
          answers[key] = el.value;
        });
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
  const front = String(document.getElementById('quiz-front-field')?.value || quizGeneratorFrontFieldKey || "");
  const back = String(document.getElementById('quiz-back-field')?.value || quizGeneratorBackFieldKey || "");
  const useDomainFields = !!(quizGeneratorDomainKey && front && back);
  const fromField = useDomainFields ? makeDomainFieldPairKey(quizGeneratorDomainKey, front) : (document.getElementById('quiz-from')?.value || "english_translation");
  const toField = useDomainFields ? makeDomainFieldPairKey(quizGeneratorDomainKey, back) : (document.getElementById('quiz-to')?.value || "latin_translation");
  return {
    quizType: document.getElementById('quiz-type')?.value || "multiple_choice",
    fromField,
    toField,
    questionCount: Number(document.getElementById('quiz-question-count')?.value || 10),
    optionsCount: Number(document.getElementById('quiz-options-count')?.value || 4),
    filters: {
      onlyStarred: !!document.getElementById('quiz-only-starred')?.checked,
      preferWrong: !!document.getElementById('quiz-prefer-wrong')?.checked,
      doubleConfirm: !!document.getElementById('quiz-double-confirm')?.checked,
      timerSeconds: Number(document.getElementById('quiz-timer')?.value || 0),
      domainKey: quizGeneratorDomainKey,
      subdivision1: quizGeneratorSubdivision1,
      subdivision2: quizGeneratorSubdivision2
    }
  };
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
    return `<label class="checkbox-item"><input type="radio" name="quiz-domain" data-quiz-domain="${escapeHTML(adapter.key)}"${checked} /> ${escapeHTML(adapter.label)}</label>`;
  }).join("");

  const adapter = flashcardsV2State.adapterByKey.get(quizGeneratorDomainKey);
  const cfg = getFlashcardsSubdivisionConfig(adapter);
  const domainRows = flashcardsV2State.allTerms.filter(row => row && row._domain === quizGeneratorDomainKey);
  if(!cfg){
    subWrap.classList.add("hidden");
    sub2Wrap.classList.add("hidden");
    quizGeneratorSubdivision1 = "";
    quizGeneratorSubdivision2 = "";
  } else {
    subWrap.classList.remove("hidden");
    sub1Label.textContent = cfg.level1 ? cfg.level1.label : tOr("quiz_subdivision", "Subdivision");
    const opts1 = cfg.level1 ? getSubdivisionOptions(adapter, cfg.level1.key, domainRows) : [];
    sub1Sel.innerHTML = [`<option value="">${escapeHTML(tOr("any", "Any"))}</option>`, ...opts1.map(v => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`)].join("");
    if(opts1.includes(quizGeneratorSubdivision1)) sub1Sel.value = quizGeneratorSubdivision1;
    else { quizGeneratorSubdivision1 = ""; sub1Sel.value = ""; }

    if(cfg.level2){
      sub2Wrap.classList.remove("hidden");
      sub2Label.textContent = cfg.level2.label;
      const rows2 = quizGeneratorSubdivision1
        ? domainRows.filter(row => {
            const c1 = adapter.columns[cfg.level1.key];
            return String(row[c1] || "").trim() === quizGeneratorSubdivision1;
          })
        : domainRows;
      const opts2 = getSubdivisionOptions(adapter, cfg.level2.key, rows2);
      sub2Sel.innerHTML = [`<option value="">${escapeHTML(tOr("any", "Any"))}</option>`, ...opts2.map(v => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`)].join("");
      if(opts2.includes(quizGeneratorSubdivision2)) sub2Sel.value = quizGeneratorSubdivision2;
      else { quizGeneratorSubdivision2 = ""; sub2Sel.value = ""; }
    } else {
      sub2Wrap.classList.add("hidden");
      quizGeneratorSubdivision2 = "";
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
  if(!domainsEl || !sub1Sel || !sub2Sel || !frontSel || !backSel) return;
  if(domainsEl.dataset.bound === "1") return;
  domainsEl.dataset.bound = "1";

  ensureFlashcardsV2DataLoaded().then(()=>{
    renderQuizGeneratorUi();
  });

  domainsEl.addEventListener("change", (event)=>{
    const hit = event.target instanceof HTMLInputElement
      ? String(event.target.getAttribute("data-quiz-domain") || "")
      : "";
    if(!hit) return;
    quizGeneratorDomainKey = hit;
    quizGeneratorSubdivision1 = "";
    quizGeneratorSubdivision2 = "";
    quizGeneratorFrontFieldKey = "";
    quizGeneratorBackFieldKey = "";
    renderQuizGeneratorUi();
  });

  sub1Sel.addEventListener("change", ()=>{
    quizGeneratorSubdivision1 = String(sub1Sel.value || "");
    quizGeneratorSubdivision2 = "";
    renderQuizGeneratorUi();
  });

  sub2Sel.addEventListener("change", ()=>{
    quizGeneratorSubdivision2 = String(sub2Sel.value || "");
    renderQuizGeneratorUi();
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
  });
}

function startQuiz({ retryItems = null, configOverrides = null } = {}){
  const area = document.getElementById('quiz-area');
  if(area) area.innerHTML = '';
  const defaults = readQuizSettings();
  const cfg = { ...defaults, ...(configOverrides || {}) };
  cfg.filters = { ...(defaults.filters || {}), ...((configOverrides && configOverrides.filters) || {}) };
  const startRes = quizEngine.startQuiz({
    quizType: cfg.quizType || "multiple_choice",
    fromField: cfg.fromField,
    toField: cfg.toField,
    questionCount: cfg.questionCount,
    optionsCount: cfg.optionsCount,
    filters: cfg.filters,
    retryItems,
    termIds: cfg.termIds || null,
    customFilters: cfg.customFilters || null
  });
  if(!startRes.ok){
    if(area) area.textContent = t(startRes.reason) || startRes.reason;
    renderQuizStats(quizEngine.getQuizState());
    return;
  }
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
  { key: "pharmacology", label: "Pharmacology", file: "terminology/pharmacology/pharmacology.csv", idColumn: "id", columns: {
    en: ["english_name"], sk: ["slovak_name"],
    english_name: ["english_name"], drug_class: ["drug_class"], subclass: ["subclass"], mechanism: ["mechanism_of_action"],
    indications: ["indications"], contraindications: ["contraindications"], adverse_effects_common: ["adverse_effects_common"],
    adverse_effects_serious: ["adverse_effects_serious"], interactions_key: ["interactions_key"], pregnancy: ["pregnancy"],
    routes: ["routes"], onset: ["onset"], duration: ["duration"], definition: ["mechanism_of_action"], notes: ["notes"]
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
    subdivision1: "",
    subdivision2: "",
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
    revealed: false
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
    return `<label class="checkbox-item"><input type="radio" name="flashcards-domain" data-domain-key="${escapeHTML(adapter.key)}"${checked} /> ${escapeHTML(adapter.label)}</label>`;
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
      else byKey.set(field.key, { key: field.key, label: field.label, domains: new Set([domainKey]) });
    }
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function getFlashcardsSubdivisionConfig(adapter){
  if(!adapter) return null;
  if(adapter.key === "latin_units"){
    return {
      level1: { key: "unit_name", label: "Unit" },
      level2: null
    };
  }
  if(adapter.key === "pharmacology"){
    return {
      level1: { key: "drug_class", label: "Drug class" },
      level2: { key: "subclass", label: "Subclass" }
    };
  }
  if(adapter.key === "muscles"){
    return {
      level1: { key: "region", label: "Region" },
      level2: { key: "category", label: "Category" }
    };
  }
  return null;
}

function uniqueSorted(values){
  return [...new Set(values.map(v => String(v || "").trim()).filter(Boolean))].sort((a, b)=>a.localeCompare(b));
}

function getSubdivisionOptions(adapter, colKey, rows){
  const col = adapter && adapter.columns ? adapter.columns[colKey] : "";
  if(!col) return [];
  return uniqueSorted((rows || []).map(row => row ? row[col] : ""));
}

function matchesFlashcardsSubdivision(row, adapter, query){
  const cfg = getFlashcardsSubdivisionConfig(adapter);
  if(!cfg || !row || !adapter) return true;
  const level1Value = String(query.subdivision1 || "").trim();
  const level2Value = String(query.subdivision2 || "").trim();
  if(cfg.level1 && level1Value){
    const c1 = adapter.columns[cfg.level1.key];
    if(String(row[c1] || "").trim() !== level1Value) return false;
  }
  if(cfg.level2 && level2Value){
    const c2 = adapter.columns[cfg.level2.key];
    if(String(row[c2] || "").trim() !== level2Value) return false;
  }
  return true;
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
    flashcardsV2State.query.subdivision1 = "";
    flashcardsV2State.query.subdivision2 = "";
  } else {
    subdivisionWrap.classList.remove("hidden");
    subdivision1Label.textContent = cfg.level1 ? cfg.level1.label : tOr("flashcards_subdivision", "Subdivision");
    const level1Options = cfg.level1 ? getSubdivisionOptions(adapter, cfg.level1.key, domainRows) : [];
    subdivision1Sel.innerHTML = [`<option value="">${escapeHTML(tOr("any", "Any"))}</option>`, ...level1Options.map(v => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`)].join("");
    if(level1Options.includes(flashcardsV2State.query.subdivision1)) subdivision1Sel.value = flashcardsV2State.query.subdivision1;
    else {
      flashcardsV2State.query.subdivision1 = "";
      subdivision1Sel.value = "";
    }

    if(cfg.level2){
      subdivision2Wrap.classList.remove("hidden");
      subdivision2Label.textContent = cfg.level2.label;
      const rowsForLevel2 = flashcardsV2State.query.subdivision1
        ? domainRows.filter(row => {
            const c1 = adapter.columns[cfg.level1.key];
            return String(row[c1] || "").trim() === flashcardsV2State.query.subdivision1;
          })
        : domainRows;
      const level2Options = getSubdivisionOptions(adapter, cfg.level2.key, rowsForLevel2);
      subdivision2Sel.innerHTML = [`<option value="">${escapeHTML(tOr("any", "Any"))}</option>`, ...level2Options.map(v => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`)].join("");
      if(level2Options.includes(flashcardsV2State.query.subdivision2)) subdivision2Sel.value = flashcardsV2State.query.subdivision2;
      else {
        flashcardsV2State.query.subdivision2 = "";
        subdivision2Sel.value = "";
      }
    } else {
      subdivision2Wrap.classList.add("hidden");
      flashcardsV2State.query.subdivision2 = "";
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
  const selectedDomainLabel = selectedAdapter ? selectedAdapter.label : "-";
  const base = `${tOr("flashcards_loaded_terms", "Loaded terms")}: ${flashcardsV2State.allTerms.length} | ${tOr("flashcards_selected_domain", "Selected domain")}: ${selectedDomainLabel}`;
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
  if(!cardBtn || !frontEl || !frontSubEl || !backEl || !backSubEl || !ratings || !progressEl || !revealBtn || !againBtn || !goodBtn || !easyBtn) return;

  const deck = flashcardsV2State.session.deck;
  const index = flashcardsV2State.session.index;
  const current = deck[index] || null;
  if(!current){
    frontEl.textContent = tOr("flashcards_no_active_session", "No active session. Generate a deck first.");
    frontSubEl.textContent = "";
    backEl.textContent = "";
    backSubEl.textContent = "";
    cardBtn.classList.remove("is-flipped");
    ratings.classList.add("hidden");
    progressEl.textContent = `0/${deck.length}`;
    revealBtn.disabled = true;
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
  progressEl.textContent = `${Math.min(index + 1, deck.length)}/${deck.length}`;
  revealBtn.disabled = false;
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
  renderFlashcardsPlayer();
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
  flashcardsV2State.query.subdivision1 = String(subdivision1Sel.value || "");
  flashcardsV2State.query.subdivision2 = String(subdivision2Sel.value || "");
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
    flashcardsV2State.query.subdivision1 = "";
    flashcardsV2State.query.subdivision2 = "";
    refreshFlashcardsBuilderUI();
  });
  subdivision1Sel.addEventListener("change", ()=>{
    flashcardsV2State.query.subdivision1 = String(subdivision1Sel.value || "");
    flashcardsV2State.query.subdivision2 = "";
    refreshFlashcardsBuilderUI();
  });
  subdivision2Sel.addEventListener("change", ()=>{
    flashcardsV2State.query.subdivision2 = String(subdivision2Sel.value || "");
    refreshFlashcardsBuilderUI();
  });
  frontSel.addEventListener("change", ()=>{
    flashcardsV2State.query.frontFieldKey = String(frontSel.value || "");
    if(flashcardsV2State.query.frontFieldKey === String(backSel.value || "")){
      const alt = [...backSel.options].map(opt => opt.value).find(v => v !== flashcardsV2State.query.frontFieldKey);
      if(alt) backSel.value = alt;
    }
  });
  frontSel2.addEventListener("change", ()=>{
    const val = String(frontSel2.value || "");
    flashcardsV2State.query.frontFieldSecondaryKey = val && val !== String(frontSel.value || "") ? val : "";
    if(flashcardsV2State.query.frontFieldSecondaryKey !== val) frontSel2.value = "";
  });
  backSel.addEventListener("change", ()=>{
    flashcardsV2State.query.backFieldKey = String(backSel.value || "");
    if(flashcardsV2State.query.backFieldKey === String(frontSel.value || "")){
      const alt = [...frontSel.options].map(opt => opt.value).find(v => v !== flashcardsV2State.query.backFieldKey);
      if(alt) frontSel.value = alt;
    }
  });
  backSel2.addEventListener("change", ()=>{
    const val = String(backSel2.value || "");
    flashcardsV2State.query.backFieldSecondaryKey = val && val !== String(backSel.value || "") ? val : "";
    if(flashcardsV2State.query.backFieldSecondaryKey !== val) backSel2.value = "";
  });
  onlySel.addEventListener("change", ()=>{ flashcardsV2State.query.only = String(onlySel.value || "random"); });
  limitSel.addEventListener("change", ()=>{ flashcardsV2State.query.limit = Math.max(1, Number(limitSel.value) || 20); });
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

/*
How to use (Lab parameters taxonomy):
- Expected CSV header includes existing fields and optional "tags" column:
  id,english_term,german_term,slovak_term,abbreviation,system,...,notes,tags
- tags format: semicolon-separated text, e.g. ICU;Sepsis;Shock;Emergency
- tags are optional; missing/empty tags are treated as no tags
- system is optional; missing/empty system defaults to "Uncategorized"
*/

window.addEventListener('hashchange', ()=>{
  const id = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  if(id && document.getElementById(id)) showScreen(id, { updateHistory: false });
});

window.addEventListener('DOMContentLoaded', ()=>{ init(); });
