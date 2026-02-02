const SUPABASE_URL = "https://glrxzhmhgzhabqzhmsiu.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdscnh6aG1oZ3poYWJxemhtc2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY4MzM3NzUsImV4cCI6MjA4MjQwOTc3NX0.Nzx3cHnPpn1awhQyNhjwKd2GUFnzieVR6uz7L-2eKrs";

// --- DOM helpers (prevents crashes if an element is missing) ---
const $ = (id)=>document.getElementById(id);
const on = (id, ev, fn)=>{ const el=$(id); if(!el){ console.warn('Missing element:', id); return; } el.addEventListener(ev, fn); };

// ====== Routing + paths (supports /main/, /anamnesis/, etc.) ======
const SECTIONS = new Set(["main","anamnesis","muscles","quiz"]);

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

const STORAGE_BUCKET = "Medical terms CSV";
const ENABLE_STORAGE_BASE_SYNC = false;
const STORAGE_FILES = [
  { filename: "medical_terms.csv", cacheId: "base/medical_terms.csv" },
  { filename: "App translations.csv", cacheId: "base/App translations.csv" },
  { filename: "muscles.csv", cacheId: "base/muscles.csv" },
];

let supabase = null;

function initSupabase() {
  const createClient = window.supabase?.createClient;
  if(typeof createClient !== "function"){
    console.warn("Supabase SDK not loaded – running local-only mode");
    return null;
  }
  if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.startsWith("PASTE_")) {
    console.warn("Supabase anon key missing – running local-only mode");
    return null;
  }
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
}

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

// ===== Supabase Storage helpers (download base CSVs) =====
function storageClient(){
  const c = initSupabase();
  if(!c) return null;
  return c.storage.from(STORAGE_BUCKET);
}

async function storageListMeta(){
  const sc = storageClient();
  if(!sc) return null;
  try{
    const { data, error } = await sc.list("", { limit: 1000 });
    if(error) throw error;

    const meta = {};
    for(const f of (data || [])){
      meta[f.name] = f;
    }
    return meta;
  }catch(e){
    console.warn("Storage list failed (will fall back to direct downloads):", e.message || e);
    return null;
  }
}

async function downloadFromStorage(filename){
  const sc = storageClient();
  if(!sc) throw new Error("Supabase not configured");
  const { data, error } = await sc.download(filename);
  if(error) throw error;
  return await data.text();
}

/**
 * Refresh cached base CSV files on login.
 * - Downloads files from Supabase Storage to IndexedDB if remote updated_at changed.
 */
async function refreshBaseFilesCache(){
  if(!ENABLE_STORAGE_BASE_SYNC) return;
  const meta = await storageListMeta();

  for(const f of STORAGE_FILES){
    const cacheKey = "file:" + f.cacheId;
    let cached = null;

    try{ cached = await idbGet(cacheKey); }catch(e){ cached = null; }

    const remote = meta ? meta[f.filename] : null;
    const remoteUpdated = remote?.updated_at || remote?.created_at || null;
    const cachedUpdated = cached?.updated_at || null;

    const needsUpdate = !meta || !cached || !cachedUpdated || (remoteUpdated && remoteUpdated !== cachedUpdated);

    if(needsUpdate){
      try{
        const text = await downloadFromStorage(f.filename);
        await idbSet(cacheKey, {
          text,
          updated_at: remoteUpdated,
          filename: f.filename,
          saved_at: new Date().toISOString()
        });
      }catch(e){
        console.warn("Storage download failed for", f.filename, "(continuing):", e.message || e);
      }
    }
  }
}

/**
 * Load base CSV:
 * 1) IndexedDB cache (if present)
 * 2) local file in /data (fallback)
 */
async function loadBaseFile(filenameOrPath){
  const filename = String(filenameOrPath || "").split("/").pop(); // allow passing "data/medical_terms.csv"
  const entry = STORAGE_FILES.find(x => x.filename === filename);
  const cacheKey = "file:" + (entry ? entry.cacheId : ("base/" + filename));

  const cached = await idbGet(cacheKey);
  if(cached?.text) return cached.text;

  // Local fallback from /data/
  return await loadFile(DATA_BASE + filename);
}

function setLoginStatus(text, type = "info") {
  const el = document.getElementById("login-status");
  if (!el) return;

  el.textContent = String(text || "");
  el.style.display = "block";

  el.style.background =
    type === "ok" ? "#eafaf0" :
    type === "error" ? "#fde8e8" :
    "#ecfdf5";
}

function clearLoginStatus(){
  const el = document.getElementById("login-status");
  if(!el) return;
  el.style.display = "none";
  el.textContent = "";
  el.style.background = "";
}

function normalizeLoginIdentifier(input){
  const raw = String(input || "").trim().toLowerCase();
  if(!raw) return "";
  if(raw.includes("@")) return raw;
  return raw + "@medicaldict.local";
}

async function supaGetSession(){
  const c = initSupabase();
  if(!c) return null;
  const { data, error } = await c.auth.getSession();
  if(error) throw error;
  return data.session;
}

async function supaSignUp(email, password, displayName){
  const c = initSupabase();
  if(!c) throw new Error("Supabase not configured");
  const { error } = await c.auth.signUp({
    email,
    password,
    options: { data: { name: displayName || "" } }
  });
  if(error) throw error;
}

async function supaSignIn(email, password){
  const c = initSupabase();
  if(!c) throw new Error("Supabase not configured");
  const { error } = await c.auth.signInWithPassword({ email, password });
  if(error) throw error;
}

async function supaRequestPasswordReset(email){
  const c = initSupabase();
  if(!c) throw new Error("Supabase not configured");
  const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, "");
  const redirectTo = base + "reset-password.html";
  const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo });
  if(error) throw error;
}

async function supaSignOut(){
  const c = initSupabase();
  if(!c) return;
  const { error } = await c.auth.signOut();
  if(error) throw error;
}

// -------- Supabase schema (Option B: normalized tables) --------
const USER_TERMS_TABLE = "user_terms";
const USER_REVIEW_TABLE = "user_review";

// -------- Offline cache (localStorage) --------
function cacheKeyTerms(){ return "cache/user_terms"; }
function cacheKeyReview(){ return "cache/user_review"; }

function readJsonLS(key, fallback){
  try{ const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; }
  catch(e){ return fallback; }
}
function writeJsonLS(key, val){ localStorage.setItem(key, JSON.stringify(val)); }

function getLocalTerms(){ return readJsonLS(cacheKeyTerms(), []); }
function setLocalTerms(terms){ writeJsonLS(cacheKeyTerms(), terms || []); updateDirtyCount(); }

function getLocalReview(){ return readJsonLS(cacheKeyReview(), []); }
function setLocalReview(items){ writeJsonLS(cacheKeyReview(), items || []); updateDirtyCount(); }

function cacheKeyUserMap(){ return "cache/user_display_map"; }
function getLocalUserMap(){ return readJsonLS(cacheKeyUserMap(), []); }
function setLocalUserMap(items){ writeJsonLS(cacheKeyUserMap(), items || []); }
function setDisplayNameMapping(name, email){
  if(!name || !email) return;
  const map = getLocalUserMap();
  const key = name.trim().toLowerCase();
  const existing = map.find(x => (x.name || '').toLowerCase() === key);
  if(existing) existing.email = email;
  else map.push({ name, email });
  setLocalUserMap(map);
}
function lookupEmailByDisplayName(name){
  const key = String(name || '').trim().toLowerCase();
  if(!key) return '';
  const map = getLocalUserMap();
  const hit = map.find(x => (x.name || '').toLowerCase() === key);
  return hit ? hit.email : '';
}

function countDirty(){
  const t = getLocalTerms().filter(x=>x && x.dirty).length;
  const r = getLocalReview().filter(x=>x && x.dirty).length;
  return t + r;
}
function updateDirtyCount(){
  const el = document.getElementById("sync-dirty-count");
  if(el) el.textContent = String(countDirty());
}
function setSyncStatus(msg){
  const el = document.getElementById("sync-status");
  if(el) el.textContent = msg;
}

// -------- Supabase data access (normalized tables) --------
async function supaRequireSession(){
  const c = initSupabase();
  if(!c) throw new Error("Supabase not configured");
  const { data, error } = await c.auth.getSession();
  if(error) throw error;
  if(!data.session) throw new Error("Auth session missing");
  return { client: c, session: data.session };
}

async function supaFetchUserTerms(){
  const { client } = await supaRequireSession();
  const { data, error } = await client
    .from(USER_TERMS_TABLE)
    .select("*")
    .order("updated_at", { ascending: false });
  if(error) throw error;
  return data || [];
}

async function supaUpsertUserTerms(rows){
  const { client, session } = await supaRequireSession();
  const now = new Date().toISOString();
  const payload = (rows || []).map(r => ({
    id: r.id || undefined,
    user_id: session.user.id,
    english: r.english ?? null,
    german: r.german ?? null,
    latin: r.latin ?? null,
    slovak: r.slovak ?? null,
    spanish: r.spanish ?? null,
    source_dataset: r.source_dataset ?? null,
    notes: r.notes ?? null,
    created_at: r.created_at ?? undefined,
    updated_at: now
  }));
  if(payload.length === 0) return;
  const { error } = await client
    .from(USER_TERMS_TABLE)
    .upsert(payload, { onConflict: "id" });
  if(error) throw error;
}

async function supaFetchUserReview(){
  const { client } = await supaRequireSession();
  const { data, error } = await client
    .from(USER_REVIEW_TABLE)
    .select("*")
    .order("updated_at", { ascending: false });
  if(error) throw error;
  return data || [];
}

async function supaUpsertUserReview(rows){
  const { client, session } = await supaRequireSession();
  const now = new Date().toISOString();
  const payload = (rows || []).map(r => ({
    id: r.id || undefined,
    user_id: session.user.id,
    user_term_id: r.user_term_id ?? null,
    base_term_key: r.base_term_key ?? null,
    base_dataset: r.base_dataset ?? null,
    difficulty: Number.isFinite(r.difficulty) ? r.difficulty : 0,
    last_seen: r.last_seen ?? null,
    next_due: r.next_due ?? null,
    created_at: r.created_at ?? undefined,
    updated_at: now
  }));
  if(payload.length === 0) return;
  const { error } = await client
    .from(USER_REVIEW_TABLE)
    .upsert(payload, { onConflict: "id" });
  if(error) throw error;
}

// -------- Sync (manual) --------
function mergeById(localRows, remoteRows){
  const map = new Map();
  for(const r of (remoteRows||[])){
    if(r && r.id) map.set(r.id, { ...r, dirty: false });
  }
  for(const l of (localRows||[])){
    if(!l) continue;
    if(l.id){
      const existing = map.get(l.id);
      if(l.dirty) map.set(l.id, { ...(existing||{}), ...l, dirty: true });
      else if(!existing) map.set(l.id, { ...l, dirty: false });
    } else {
      map.set("local-" + Math.random().toString(16).slice(2), { ...l, dirty: true });
    }
  }
  return Array.from(map.values());
}

async function syncNow(){
  if(!state.currentUserEmail){ setSyncStatus("login required"); return; }
  try{
    setSyncStatus("syncing...");
    const [remoteTerms, remoteReview] = await Promise.all([supaFetchUserTerms(), supaFetchUserReview()]);
    const mergedTerms = mergeById(getLocalTerms(), remoteTerms);
    const mergedReview = mergeById(getLocalReview(), remoteReview);
    setLocalTerms(mergedTerms);
    setLocalReview(mergedReview);

    const dirtyTerms = mergedTerms.filter(x=>x && x.dirty);
    const dirtyReview = mergedReview.filter(x=>x && x.dirty);

    for(const t of dirtyTerms){
      if(!t.id) t.id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(16)+Math.random().toString(16).slice(2));
    }
    for(const r of dirtyReview){
      if(!r.id) r.id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(16)+Math.random().toString(16).slice(2));
    }

    await Promise.all([supaUpsertUserTerms(dirtyTerms), supaUpsertUserReview(dirtyReview)]);

    for(const t of mergedTerms) t.dirty = false;
    for(const r of mergedReview) r.dirty = false;
    setLocalTerms(mergedTerms);
    setLocalReview(mergedReview);

    localStorage.setItem("cache/last_sync_at", new Date().toISOString());
    setSyncStatus("synced " + new Date().toLocaleString());
  }catch(e){
    console.error(e);
    setSyncStatus("sync failed: " + (e.message || e));
  }
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
          const syncXhr = new XMLHttpRequest();
          syncXhr.open('GET', filename, false);
          syncXhr.send();
          if (syncXhr.status === 200) resolve(syncXhr.responseText);
          else reject(new Error(`Failed to load ${filename}`));
        } catch (finalError) {
          reject(finalError);
        }
      };
      xhr.send();
    });
  }
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
  const headers = rows[0].map(h=>h.trim());
  const objs = [];
  for(let i=1;i<rows.length;i++){
    const row = rows[i];
    const obj = {};
    for(let j=0;j<headers.length;j++) obj[headers[j]] = (row[j]||'').trim();
    objs.push(obj);
  }
  return objs;
}

// --- Translation loader ---
const translations = {};
const anamnesisDictionary = new Map();
const anamnesisTextNodes = new WeakMap();

function normalizeAnamnesisText(text){
  return String(text || '').replace(/\s+/g, ' ').trim();
}

async function loadAnamnesisDictionary(){
  try{
    const txt = await loadBaseFile('anamnesis.csv');
    const rows = parseCSVLines(txt);
    if(rows.length < 1) throw new Error('No data in anamnesis file');
    const objects = rowsToObjects(rows);
    anamnesisDictionary.clear();
    for(const row of objects){
      const english = normalizeAnamnesisText(row.english_translation);
      if(!english) continue;
      const slovak = normalizeAnamnesisText(row.slovak_translation);
      anamnesisDictionary.set(english, { english, slovak });
    }
  }catch(e){
    console.warn('Anamnesis translations load failed:', e.message || e);
    anamnesisDictionary.clear();
  }
}

function translateAnamnesisText(baseText){
  const normalized = normalizeAnamnesisText(baseText);
  if(!normalized) return baseText;
  const row = anamnesisDictionary.get(normalized);
  if(!row) return baseText;
  const lang = normalizeLanguage(state.language);
  if(lang === 'Slovensky' && row.slovak) return row.slovak;
  if(lang === 'English') return row.english || baseText;
  return row.english || baseText;
}

function applyAnamnesisTranslationsToDom(){
  const section = document.getElementById('screen-anamnesis');
  if(!section || anamnesisDictionary.size === 0) return;

  section.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el=>{
    if(!el.dataset.anamBasePlaceholder){
      el.dataset.anamBasePlaceholder = el.getAttribute('placeholder') || '';
    }
    const base = el.dataset.anamBasePlaceholder;
    if(!base) return;
    el.setAttribute('placeholder', translateAnamnesisText(base));
  });

  section.querySelectorAll('h2,h3,strong,span,label,summary,th,button').forEach(el=>{
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

async function loadTranslations(){
  try{
    const txt = await loadBaseFile('App translations.csv');
    const rows = parseCSVLines(txt);
    if(rows.length < 1) throw new Error('No data in translations file');

    Object.keys(translations).forEach(k => delete translations[k]);

    const headers = rows[0].map(h => h.trim());
    for(let i = 1; i < headers.length; i++) {
      const lang = headers[i];
      translations[lang] = {};
    }

    for(let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const key = row[0].trim();
      if(!key) continue;

      for(let j = 1; j < headers.length; j++) {
        const lang = headers[j];
        const text = (row[j] || '').trim();
        if(text) translations[lang][key] = text;
      }
    }

    const variations = {
      'english': 'English',
      'deutch': 'Deutch',
      'deutsch': 'Deutch',
      'german': 'Deutch',
      'slovensky': 'Slovensky',
      'slovak': 'Slovensky',
      'espanol': 'Spanish',
      'español': 'Spanish',
      'spanish': 'Spanish',
      'norsk': 'Norwegian',
      'norwegian': 'Norwegian',
      'islenska': 'Icelandic',
      'íslenska': 'Icelandic',
      'icelandic': 'Icelandic'
    };
    Object.entries(variations).forEach(([variant, standard]) => {
      if(translations[standard]) translations[variant] = translations[standard];
    });
  }catch(e){
    console.warn('Translations load failed:', e.message);
  }
}

// --- Medical terms loader ---
let medicalTerms = [];
async function loadMedicalTerms() {
  try {
    const txt = await loadBaseFile('medical_terms.csv');
    const rows = parseCSVLines(txt);
    if(rows.length < 1) throw new Error('No data in medical terms file');
    medicalTerms = rowsToObjects(rows);
  } catch(e) {
    console.warn('Medical terms load failed:', e.message);
    medicalTerms = [];
  }
}

// --- Muscles loader ---
let muscleTerms = [];
async function loadMuscles() {
  try {
    const txt = await loadBaseFile('muscles.csv');
    const rows = parseCSVLines(txt);
    if(rows.length < 1) throw new Error('No data in muscles file');
    muscleTerms = rowsToObjects(rows);
  } catch(e) {
    console.warn('Muscles load failed:', e.message);
    muscleTerms = [];
  }
}

// --- UI wiring and i18n ---
let state = { language: localStorage.getItem('app_language') || 'English', currentUser: null, currentUserEmail: null };

// ===== Language handling =====
const LANG_CANON = {
  'english':'English',
  'deutch':'Deutch',
  'deutsch':'Deutch',
  'german':'Deutch',
  'slovensky':'Slovensky',
  'slovak':'Slovensky',
  'spanish':'Spanish',
  'espanol':'Spanish',
  'español':'Spanish',
  'norwegian':'Norwegian',
  'norsk':'Norwegian',
  'icelandic':'Icelandic',
  'islenska':'Icelandic',
  'íslenska':'Icelandic'
};

function normalizeLanguage(lang){
  const raw = String(lang || '').trim();
  if(!raw) return 'English';
  const key = raw.toLowerCase();
  return LANG_CANON[key] || raw;
}

function getBaseSearchField(){
  const lang = normalizeLanguage(state.language);
  if(lang === 'Deutch') return 'german_translation';
  if(lang === 'Slovensky') return 'slovak_translation';
  if(lang === 'Spanish') return 'spanish_translation';
  if(lang === 'Norwegian') return 'norvegian_translation';
  if(lang === 'Icelandic') return 'icelandic_translation';
  return 'english_translation';
}

function getUserSearchField(){
  const lang = normalizeLanguage(state.language);
  if(lang === 'Deutch') return 'german';
  if(lang === 'Slovensky') return 'slovak';
  if(lang === 'Spanish') return 'spanish';
  if(lang === 'Norwegian') return 'norwegian';
  if(lang === 'Icelandic') return 'icelandic';
  return 'english';
}

const BASE_SEARCH_FIELDS = [
  "latin_translation",
  "english_translation",
  "german_translation",
  "slovak_translation",
  "spanish_translation",
  "norvegian_translation",
  "norwegian_translation",
  "icelandic_translation",
  "english_definition",
  "german_definition",
  "slovak_definition",
  "spanish_definition",
  "norwegian_definition",
  "icelandic_definition",
  "genitive",
  "accusative"
];

const USER_SEARCH_FIELDS = [
  "latin",
  "english",
  "german",
  "slovak",
  "spanish",
  "norwegian",
  "icelandic",
  "notes"
];

const USER_FIELD_MAP = {
  english_translation: "english",
  german_translation: "german",
  slovak_translation: "slovak",
  latin_translation: "latin",
  spanish_translation: "spanish",
  norwegian_translation: "norwegian",
  norvegian_translation: "norwegian",
  icelandic_translation: "icelandic"
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

function mapUserFieldFromBase(baseField){
  return USER_FIELD_MAP[baseField] || baseField;
}

async function setLanguage(lang){
  const canonical = normalizeLanguage(lang);
  state.language = canonical;
  localStorage.setItem('app_language', canonical);

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
}

function t(key){
  const lang = state.language;
  if(translations[lang] && translations[lang][key]) return translations[lang][key];
  if(translations['English'] && translations['English'][key]) return translations['English'][key];
  return key;
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
const ANAMNESIS_STORAGE_KEY = "anamnesis_form_v1";
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

function getMuscleRegionField(){
  const lang = normalizeLanguage(state.language);
  if(lang === 'Deutch') return 'muscle_region_ge';
  if(lang === 'Slovensky') return 'muscle_region_sk';
  return 'muscle_region_en';
}

function getMuscleCategoryField(){
  const lang = normalizeLanguage(state.language);
  if(lang === 'Deutch') return 'muscle_category_ge';
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

function addMuscleField(container, label, value, key, showToggles){
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
  v.textContent = value || '—';
  row.appendChild(l);
  row.appendChild(v);

  if(showToggles){
    const rightWrap = document.createElement('label');
    rightWrap.className = 'muscle-field-toggle right';
    const rightCb = document.createElement('input');
    rightCb.type = 'checkbox';
    rightCb.checked = muscleQuizTempFields.has(key);
    rightCb.addEventListener('change', ()=>{
      if(rightCb.checked) muscleQuizTempFields.add(key);
      else muscleQuizTempFields.delete(key);
      renderMuscleQuizFields();
    });
    rightWrap.appendChild(rightCb);
    row.appendChild(rightWrap);
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
    if(mode === 'type_of_movement') return includesQuery(r.type_of_movement, q);
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
      includesQuery(r.type_of_movement, q) ||
      includesQuery(r.innervation, q) ||
      includesQuery(r.blood_supply, q) ||
      includesQuery(r.origo, q) ||
      includesQuery(r.insercio, q)
    );
  });

  if(matches.length === 0){
    results.textContent = 'No muscles found.';
    return;
  }

  const limit = 50;
  matches.slice(0, limit).forEach(r=>{
    const card = document.createElement('div');
    card.className = 'muscle-result';
    addMuscleField(card, t('muscle_search_region') || 'Region', getMuscleRegionLabel(r), null, false);
    addMuscleField(card, t('muscle_search_category') || 'Category', getMuscleCategoryLabel(r), null, false);
    addMuscleField(card, 'Latin name', r.latin_muscle_name, null, false);
    addMuscleField(card, 'English name', r.english_muscle_name, null, false);
    addMuscleField(card, 'Muscle part', r.muscle_part, null, false);
    addMuscleField(card, t('muscle_type_of_movement') || 'Type of movement', r.type_of_movement, null, false);
    addMuscleField(card, 'Innervation', r.innervation, null, false);
    addMuscleField(card, 'Blood supply', r.blood_supply, null, false);
    addMuscleField(card, 'Origo', r.origo, null, false);
    addMuscleField(card, 'Insercio', r.insercio, null, false);
    results.appendChild(card);
  });
  if(matches.length > limit){
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
  const keys = [...regions.keys()].sort((a,b)=>a.localeCompare(b));
  list.innerHTML = '';
  if(keys.length === 0){
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'No regions available.';
    list.appendChild(empty);
    return;
  }
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
    header.appendChild(regionCb);
    header.appendChild(label);
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
  const v = (value, key)=> {
    if(muscleQuizRevealed || muscleQuizPersistentFields.has(key) || muscleQuizTempFields.has(key)){
      return value || '—';
    }
    return MUSCLE_HIDDEN;
  };
  addMuscleField(fields, t('muscle_search_region') || 'Region', v(getMuscleRegionLabel(muscleQuizCurrent), 'region'), 'region', true);
  addMuscleField(fields, t('muscle_search_category') || 'Category', v(getMuscleCategoryLabel(muscleQuizCurrent), 'category'), 'category', true);
  addMuscleField(fields, 'Latin name', v(muscleQuizCurrent.latin_muscle_name, 'latin'), 'latin', true);
  addMuscleField(fields, 'English name', v(muscleQuizCurrent.english_muscle_name, 'english'), 'english', true);
  addMuscleField(fields, 'Muscle part', v(muscleQuizCurrent.muscle_part, 'part'), 'part', true);
  addMuscleField(fields, t('muscle_type_of_movement') || 'Type of movement', v(muscleQuizCurrent.type_of_movement, 'movement'), 'movement', true);
  addMuscleField(fields, 'Innervation', v(muscleQuizCurrent.innervation, 'innervation'), 'innervation', true);
  addMuscleField(fields, 'Blood supply', v(muscleQuizCurrent.blood_supply, 'blood_supply'), 'blood_supply', true);
  addMuscleField(fields, 'Origo', v(muscleQuizCurrent.origo, 'origo'), 'origo', true);
  addMuscleField(fields, 'Insercio', v(muscleQuizCurrent.insercio, 'insercio'), 'insercio', true);
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

// --- Anamnesis helpers ---
let anamnesisSaveTimer = null;
const ANAMNESIS_NOTES_BULLETS_KEY = "anamnesis_notes_bullets";

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
      { key: "drug", placeholder: "Drug" },
      { key: "dose", placeholder: "Dose" },
      { key: "frequency", placeholder: "Frequency" },
      { key: "indication", placeholder: "Indication" }
    ]
  },
  {
    rowsId: "family-history-rows",
    addId: "family-history-add",
    prefix: "family_history",
    columns: [
      { key: "disease", placeholder: "Choroba" },
      { key: "details", placeholder: "Detaily" },
      { key: "relation", placeholder: "Relation to p." }
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
    row.appendChild(input);
  });
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
  if(row) wrap.appendChild(row);
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

function updateMedicationConditionalVisibility(){
  const misuseYes = document.querySelector('input[name="med_misuse"][value="yes"]');
  const wrap = document.getElementById("med-misuse-notes-wrap");
  if(wrap) wrap.classList.toggle("hidden", !(misuseYes && misuseYes.checked));
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

function saveAnamnesisForm(){
  const form = document.getElementById('anamnesis-form');
  if(!form) return;
  const data = {};
  form.querySelectorAll('input, textarea, select').forEach(el=>{
    if(!el.name) return;
    if(el.type === 'checkbox') data[el.name] = el.checked;
    else if(el.type === 'radio'){
      if(el.checked) data[el.name] = el.value;
    } else {
      data[el.name] = el.value;
    }
  });
  const notes = document.getElementById("anamnesis-notes-text");
  if(notes) data.anamnesis_global_notes = notes.value;
  localStorage.setItem(ANAMNESIS_STORAGE_KEY, JSON.stringify(data));
  const status = document.getElementById('anamnesis-status');
  if(status) status.textContent = 'Saved locally.';
}

function scheduleAnamnesisSave(){
  clearTimeout(anamnesisSaveTimer);
  anamnesisSaveTimer = setTimeout(saveAnamnesisForm, 300);
}

function loadAnamnesisForm(){
  const form = document.getElementById('anamnesis-form');
  if(!form) return;
  const raw = localStorage.getItem(ANAMNESIS_STORAGE_KEY);
  if(!raw){
    initAnamnesisRepeaters(null);
    updatePlannedOperationVisibility();
    updateHousingVisibility();
    updateMedicationConditionalVisibility();
    return;
  }
  let data = null;
  try{ data = JSON.parse(raw); }catch(e){ data = null; }
  if(!data){
    initAnamnesisRepeaters(null);
    updatePlannedOperationVisibility();
    updateHousingVisibility();
    updateMedicationConditionalVisibility();
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
  updateHousingVisibility();
  updateMedicationConditionalVisibility();
}

function clearAnamnesisForm(){
  const form = document.getElementById('anamnesis-form');
  if(form) form.reset();
  localStorage.removeItem(ANAMNESIS_STORAGE_KEY);
  initAnamnesisRepeaters(null);
  const notes = document.getElementById("anamnesis-notes-text");
  if(notes) notes.value = "";
  updatePlannedOperationVisibility();
  updateHousingVisibility();
  updateMedicationConditionalVisibility();
  const status = document.getElementById('anamnesis-status');
  if(status) status.textContent = 'Cleared.';
}

function applyTextSize(step){
  const clamped = Math.max(1, Math.min(7, Number(step) || 4));
  const px = TEXT_SIZES[clamped - 1] || 16;
  document.body.style.setProperty('--base-font-size', px + 'px');
  localStorage.setItem(TEXT_SIZE_KEY, String(clamped));
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
/* === NEW: auth UI (cog always visible + header user) === */
function updateAuthUI(){
  const cog = document.getElementById('settings-toggle');
  const who = document.getElementById('header-whoami');
  const whoUser = document.getElementById('header-user');
  const syncBlock = document.getElementById('settings-sync-block');
  const loginBlock = document.getElementById('settings-login-block');

  const loggedIn = !!state.currentUser;
  if(loggedIn){
    if(cog) cog.classList.remove('hidden');
    if(who) who.classList.remove('hidden');
    if(whoUser) whoUser.textContent = state.currentUser;
    if(syncBlock) syncBlock.classList.remove('hidden');
    if(loginBlock) loginBlock.classList.add('hidden');
  } else {
    if(cog) cog.classList.remove('hidden');
    if(who) who.classList.add('hidden');
    if(whoUser) whoUser.textContent = '???';
    if(syncBlock) syncBlock.classList.add('hidden');
    if(loginBlock) loginBlock.classList.remove('hidden');
    // ensure settings is closed if user logs out
    const sidebar = document.getElementById('settings-sidebar');
    const overlay = document.getElementById('settings-overlay');
    if(sidebar) sidebar.classList.remove('open');
    if(overlay) overlay.classList.remove('open');
  }
}

async function logoutToLogin(){
  try{
    await supaSignOut();
  }catch(e){
    console.warn("Sign out failed:", e);
  }
  state.currentUser = null;
  state.currentUserEmail = null;
  const cu = document.getElementById('current-user');
  if(cu) cu.textContent = "(none)";
  updateAuthUI();
  const lf = document.getElementById('login-form');
  const rf = document.getElementById('register-form');
  if(lf) lf.classList.remove('hidden');
  if(rf) rf.classList.add('hidden');
  showScreen('screen-login');
}

function initialScreenForSection(section){
  if(section === "anamnesis") return "screen-anamnesis";
  if(section === "muscles") return "screen-muscle-training";
  if(section === "quiz") return "screen-quiz";
  if(section === "main") return "screen-submenu";
  return "screen-menu";
}

async function init(){
  // Optional: refresh base CSV cache from Supabase Storage (disabled by default)
  try{ await refreshBaseFilesCache(); }catch(e){ console.warn('Base CSV refresh skipped:', e); }

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

  on('to-login','click', ()=> showScreen('screen-login'));
  on('to-register','click', ()=> {
    showScreen('screen-login');
    const lf = document.getElementById('login-form');
    const rf = document.getElementById('register-form');
    if(lf) lf.classList.add('hidden');
    if(rf) rf.classList.remove('hidden');
  });

  function openGuestModal(){
    const ov = document.getElementById('guest-overlay');
    if(ov) ov.classList.remove('hidden');
  }
  function closeGuestModal(){
    const ov = document.getElementById('guest-overlay');
    if(ov) ov.classList.add('hidden');
  }

  function openForgotModal(){
    const ov = document.getElementById('forgot-overlay');
    const msg = document.getElementById('forgot-msg');
    const email = document.getElementById('forgot-email');
    if(msg) msg.textContent = '';
    if(email){
      const fromLogin = document.getElementById('username')?.value?.trim() || '';
      email.value = fromLogin.includes('@') ? fromLogin : '';
    }
    if(ov) ov.classList.remove('hidden');
  }
  function closeForgotModal(){
    const ov = document.getElementById('forgot-overlay');
    if(ov) ov.classList.add('hidden');
  }

  on('continue-guest','click', ()=> openGuestModal());
  on('guest-back','click', ()=> closeGuestModal());
  on('guest-continue','click', ()=>{
    closeGuestModal();
    showScreen('screen-submenu');
  });
  on('forgot-cancel','click', ()=> closeForgotModal());

  on('btn-show-register','click', ()=>{
    const lf = document.getElementById('login-form');
    const rf = document.getElementById('register-form');
    if(lf) lf.classList.add('hidden');
    if(rf) rf.classList.remove('hidden');
  });
  on('btn-show-login','click', ()=>{
    const lf = document.getElementById('login-form');
    const rf = document.getElementById('register-form');
    if(lf) lf.classList.remove('hidden');
    if(rf) rf.classList.add('hidden');
  });

  on('btn-register','click', async () => {
    clearLoginStatus();
    const username = document.getElementById('reg-username')?.value?.trim() || "";
    const emailInput = document.getElementById('reg-email')?.value?.trim() || "";
    const password = document.getElementById('reg-password')?.value || "";
    const confirm = document.getElementById('reg-password-confirm')?.value || "";
    const msg = document.getElementById('register-msg');
    if(msg) msg.textContent='';

    if (!username || !emailInput || !password) {
      setLoginStatus("Please fill all fields", "error");
      return;
    }
    if (password !== confirm) {
      setLoginStatus("Passwords do not match", "error");
      return;
    }

    const email = emailInput;

    try {
      setLoginStatus("Creating account…");
      await supaSignUp(email, password, username);
      setDisplayNameMapping(username, email);

      const session = await supaGetSession();
      if (session) {
        setLoginStatus("Account created. You can log in now.", "ok");
      } else {
        setLoginStatus("Account created. Please confirm your email, then log in.", "info");
      }
      if(msg) msg.textContent = t('Registration successful! You can now log in.') || 'Registration successful! You can now log in.';
      const ru = document.getElementById('reg-username'); if(ru) ru.value='';
      const re = document.getElementById('reg-email'); if(re) re.value='';
      const rp = document.getElementById('reg-password'); if(rp) rp.value='';
      const rc = document.getElementById('reg-password-confirm'); if(rc) rc.value='';
    } catch (e) {
      console.error(e);
      setLoginStatus("Registration failed: " + e.message, "error");
      if(msg) msg.textContent = (e.message || String(e));
    }
  });

  on('btn-login','click', async () => {
    clearLoginStatus();
    const username = document.getElementById('username')?.value?.trim() || "";
    const password = document.getElementById('password')?.value || "";
    const msg = document.getElementById('login-msg');
    if(msg) msg.textContent='';

    if (!username || !password) {
      setLoginStatus(t("login_missing_fields") || "Enter username and password", "error");
      return;
    }

    let email = "";
    if(username.includes("@")) email = username;
    else email = lookupEmailByDisplayName(username);
    if(!email){
      setLoginStatus("Unknown display name. Use your email.", "error");
      return;
    }

    try {
      setLoginStatus("Signing in...");
      await supaSignIn(email, password);

      const session = await supaGetSession();
      const displayName = session?.user?.user_metadata?.name || username;
      state.currentUser = displayName;
      state.currentUserEmail = session?.user?.email || email;

      const cu = document.getElementById('current-user');
      if(cu) cu.textContent = displayName;
      updateAuthUI();

      setLoginStatus("Signed in. Sync active.", "ok");
      showScreen("screen-submenu");

      // Optional: pull newest base CSVs into offline cache on login, then reload from cache
      try{
        await refreshBaseFilesCache();
        await Promise.all([loadTranslations(), loadMedicalTerms(), loadMuscles(), loadAnamnesisDictionary()]);
        applyTranslationsToDom();
        applyAnamnesisTranslationsToDom();
        refreshMuscleTrainingUI();
      }catch(e){
        console.warn("Base CSV refresh failed (offline/local only):", e);
      }

      try{
        setSyncStatus("loading...");
        const [remoteTerms, remoteReview] = await Promise.all([supaFetchUserTerms(), supaFetchUserReview()]);
        setLocalTerms(mergeById(getLocalTerms(), remoteTerms));
        setLocalReview(mergeById(getLocalReview(), remoteReview));
        setSyncStatus("ready");
      }catch(e){
        console.warn("Initial remote load failed (offline/local only):", e);
        setSyncStatus("offline/local only");
      }

    } catch (e) {
      console.error(e);
      setLoginStatus("Login failed: " + e.message, "error");
      if(msg) msg.textContent = t('Invalid credentials.') || 'Invalid credentials.';
    }
  });

  on('btn-forgot','click', async () => { openForgotModal(); });

  on('forgot-send','click', async () => {
    clearLoginStatus();
    const msg = document.getElementById('forgot-msg');
    const email = document.getElementById('forgot-email')?.value?.trim() || "";
    if(!email){
      if(msg) msg.textContent = t('forgot_password_email_required') || 'Email is required.';
      return;
    }
    try{
      if(msg) msg.textContent = t('forgot_password_sending') || 'Sending reset email...';
      await supaRequestPasswordReset(email);
      if(msg) msg.textContent = t('forgot_password_sent_msg') || 'Reset email sent.';
    }catch(e){
      console.error(e);
      if(msg) msg.textContent = (t('forgot_password_failed') || 'Reset failed: ') + (e.message || e);
    }
  });

  on('to-search','click', ()=> { showScreen('screen-search'); });
  on('to-entry','click', ()=> { showScreen('screen-entry'); });
  on('to-quiz','click', ()=> { showScreen('screen-quiz'); });
  on('to-muscle-training','click', ()=> { showScreen('screen-muscle-training'); });
  on('to-anamnesis','click', ()=> { showScreen('screen-anamnesis'); loadAnamnesisForm(); });

  on('to-menu','click', ()=> { showScreen('screen-menu'); });
  on('to-login-from-settings-public','click', ()=>{
    showScreen('screen-login');
    const sidebar = document.getElementById('settings-sidebar');
    const overlay = document.getElementById('settings-overlay');
    if(sidebar) sidebar.classList.remove('open');
    if(overlay) overlay.classList.remove('open');
  });
  on('to-login-from-settings','click', async ()=> { await logoutToLogin(); });
  on('btn-sync','click', async ()=>{ await syncNow(); });

  updateDirtyCount();

  const searchInput = document.getElementById('search-input');
  const resultsDiv = document.getElementById('search-results');

  const muscleSearchInput = document.getElementById('muscle-search-input');
  if(muscleSearchInput){
    muscleSearchInput.addEventListener('input', renderMuscleSearchResults);
  }
  const muscleSearchField = document.getElementById('muscle-search-field');
  if(muscleSearchField){
    const saved = localStorage.getItem(MUSCLE_SEARCH_FIELD_KEY);
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

  const anamForm = document.getElementById('anamnesis-form');
  if(anamForm){
    initAnamnesisRepeaters(null);
    initAnamnesisNotesDrawer();
    anamForm.addEventListener('input', scheduleAnamnesisSave);
    anamForm.addEventListener('change', scheduleAnamnesisSave);
  }
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
  ['social-house','social-flat','social-homeless'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.addEventListener('change', ()=>{
      updateHousingVisibility();
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

  if(searchInput && resultsDiv){
    searchInput.addEventListener('input', ()=>{
      const q = searchInput.value.trim().toLowerCase();
      resultsDiv.innerHTML='';
      if(q.length<2) return;

      const results = [];
      const seenBase = new Set();
      const seenUser = new Set();
      const langField = getBaseSearchField();
      const userField = getUserSearchField();

      for(const r of medicalTerms){
        if(includesQuery(r[langField], q)){
          results.push({ kind:'base', row:r });
          seenBase.add(r);
        }
      }

      for(const trow of getLocalTerms()){
        if(includesQuery(trow && trow[userField], q)){
          results.push({ kind:'user', row:trow });
          seenUser.add(trow);
        }
      }

      if(results.length === 0){
        for(const r of medicalTerms){
          if(!seenBase.has(r) && matchAnyField(r, BASE_SEARCH_FIELDS, q)){
            results.push({ kind:'base', row:r });
            seenBase.add(r);
          }
        }
        for(const trow of getLocalTerms()){
          if(!seenUser.has(trow) && matchAnyField(trow || {}, USER_SEARCH_FIELDS, q)){
            results.push({ kind:'user', row:trow });
            seenUser.add(trow);
          }
        }
      }

      if(results.length===0){
        resultsDiv.textContent = t('No matching results found.') || 'No matching results found.';
        return;
      }

      for(const item of results){
        const el = document.createElement('div');
        el.className='result';
        if(item.kind === 'base'){
          const row = item.row;
          const head = (row[langField]||row['latin_translation']||row['english_translation']||'').trim();
          const def = (row['english_definition']||'').trim();
          el.innerHTML = `<strong>${head}</strong>${def?`<div class="muted" style="margin-top:6px">${def}</div>`:''}
            <div class="kv">
              <div class="k">Latin</div><div class="v">${row['latin_translation']||''}</div>
              <div class="k">English</div><div class="v">${row['english_translation']||''}</div>
              <div class="k">German</div><div class="v">${row['german_translation']||''}</div>
              <div class="k">Slovak</div><div class="v">${row['slovak_translation']||''}</div>
            </div>`;
        } else {
          const row = item.row;
          const head = (row[userField]||row.latin||row.english||'').trim();
          const def = (row.notes||'').trim();
          el.innerHTML = `<strong>${head}</strong>${def?`<div class="muted" style="margin-top:6px">${def}</div>`:''}
            <div class="kv">
              <div class="k">Latin</div><div class="v">${row.latin||''}</div>
              <div class="k">English</div><div class="v">${row.english||''}</div>
              <div class="k">German</div><div class="v">${row.german||''}</div>
              <div class="k">Slovak</div><div class="v">${row.slovak||''}</div>
            </div>`;
        }
        resultsDiv.appendChild(el);
      }
    });
  }

  on('search-back','click', ()=> showScreen('screen-submenu'));

  on('save-term','click', async ()=>{
    if(!state.currentUser){
      const em = document.getElementById('entry-msg');
      if(em) em.textContent = t('Please login first.') || 'Please login first.';
      return;
    }
    const fields = [...document.querySelectorAll('#entry-fields [data-field]')];
    const raw = {};
    for(const el of fields) raw[el.dataset.field] = el.value.trim();

    const term = {
      id: null,
      english: raw.english_translation || null,
      german: raw.german_translation || null,
      latin: raw.latin_translation || null,
      slovak: raw.slovak_translation || null,
      spanish: raw.spanish_translation || null,
      notes: raw.english_definition || raw.german_definition || null,
      source_dataset: "manual_entry",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      dirty: true
    };

    const terms = getLocalTerms();
    terms.unshift(term);
    setLocalTerms(terms);

    const em = document.getElementById('entry-msg');
    if(em) em.textContent = (t('Term saved successfully!') || 'Term saved successfully!') + ' (saved locally — press Sync)';
    fields.forEach(f=>f.value='');
  });

  on('entry-back','click', ()=> showScreen('screen-submenu'));
  on('start-quiz','click', ()=> startQuiz());
  on('quiz-back','click', ()=> showScreen('screen-submenu'));

  updateAuthUI();

  const hashId = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  const savedSession = sessionStorage.getItem(NAV_SESSION_KEY) || "";
  const start =
    (hashId && document.getElementById(hashId)) ? hashId :
    (savedSession && document.getElementById(savedSession)) ? savedSession :
    "screen-menu";

  showScreen(start, { replaceHistory: true });
  if(start === "screen-anamnesis") loadAnamnesisForm();
  applyTranslationsToDom();
}


function startQuiz(){
  const from = document.getElementById('quiz-from').value;
  const to = document.getElementById('quiz-to').value;
  const fromUser = mapUserFieldFromBase(from);
  const toUser = mapUserFieldFromBase(to);
  const area = document.getElementById('quiz-area');
  area.innerHTML='';
  const scoreEl = document.getElementById('quiz-score');
  scoreEl.textContent='';

  const pool = [];
  for(const r of medicalTerms) if(r[from] && r[to]) pool.push({from: r[from], to: r[to]});
  if(state.currentUser){
    const added = getLocalTerms();
    for(const r of added) if(r && r[fromUser] && r[toUser]) pool.push({from: r[fromUser], to: r[toUser]});
  }
  if(pool.length === 0){
    area.textContent = t('No pairs available for this selection.') || 'No pairs available for this selection.';
    return;
  }

  shuffle(pool);
  let score=0;
  let answeredTotal=0;
  let index=0;

  const renderBatch = () => {
    area.innerHTML='';
    const quizItems = pool.slice(index, index + 5);
    if(quizItems.length === 0){
      area.textContent = t('Quiz complete.') || 'Quiz complete.';
      return;
    }
    let answeredInBatch=0;

    quizItems.forEach((it, idx)=>{
      const qdiv = document.createElement('div');
      qdiv.className='quiz-item';
      const q = document.createElement('div');
      q.innerHTML = `<strong>Q${index + idx + 1}:</strong> ${it.from}`;
      qdiv.appendChild(q);

      const choices = [it.to];
      for(let i=0;i<20 && choices.length<4;i++){
        const cand = pool[Math.floor(Math.random()*pool.length)].to;
        if(cand && !choices.includes(cand)) choices.push(cand);
      }
      shuffle(choices);

      const ul = document.createElement('div');
      ul.className='choices';
      let answered=false;
      choices.forEach(ch=>{
        const btn = document.createElement('button');
        btn.textContent=ch;
        btn.addEventListener('click', ()=>{
          if(answered) return;
          answered=true;
          [...ul.querySelectorAll('button')].forEach(b=>{
            b.disabled = true;
            b.classList.add('answered');
          });
          if(ch===it.to){ btn.style.background='lightgreen'; score++; }
          else { btn.style.background='indianred'; }
          answeredInBatch++;
          answeredTotal++;
          scoreEl.textContent = `${t('score')||'Score'}: ${score} / ${answeredTotal}`;
          if(answeredInBatch === quizItems.length){
            index += quizItems.length;
            if(index < pool.length){
              setTimeout(renderBatch, 250);
            }else{
              const done = document.createElement('div');
              done.className='muted';
              done.textContent = t('Quiz complete.') || 'Quiz complete.';
              area.appendChild(done);
            }
          }
        });
        ul.appendChild(btn);
      });
      qdiv.appendChild(ul);
      area.appendChild(qdiv);
    });

    scoreEl.textContent = `${t('score')||'Score'}: ${score} / ${answeredTotal}`;
  };

  renderBatch();
}

function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
}

window.addEventListener('hashchange', ()=>{
  const id = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  if(id && document.getElementById(id)) showScreen(id, { updateHistory: false });
});

window.addEventListener('DOMContentLoaded', ()=>{ init(); });
