import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://glrxzhmhgzhabqzhmsiu.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdscnh6aG1oZ3poYWJxemhtc2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY4MzM3NzUsImV4cCI6MjA4MjQwOTc3NX0.Nzx3cHnPpn1awhQyNhjwKd2GUFnzieVR6uz7L-2eKrs";

// --- DOM helpers (prevents crashes if an element is missing) ---
const $ = (id)=>document.getElementById(id);
const on = (id, ev, fn)=>{ const el=$(id); if(!el){ console.warn('Missing element:', id); return; } el.addEventListener(ev, fn); };

// ===== Supabase Storage: base CSV files for offline cache =====
const STORAGE_BUCKET = "Medical terms CSV";
const STORAGE_FILES = [
  { filename: "medical_terms.csv", cacheId: "base/medical_terms.csv" },
  { filename: "App translations.csv", cacheId: "base/App translations.csv" },
];

let supabase = null;

function initSupabase() {
  if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.startsWith("PASTE_")) {
    console.warn("Supabase anon key missing – running local-only mode");
    return null;
  }
  if (!supabase) supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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

async function refreshBaseFilesCache(){
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

async function loadBaseFile(filename){
  const entry = STORAGE_FILES.find(x => x.filename === filename);
  const cacheKey = "file:" + (entry ? entry.cacheId : ("base/" + filename));

  const cached = await idbGet(cacheKey);
  if(cached?.text) return cached.text;

  return await loadFile(filename);
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

async function supaSignUp(email, password){
  const c = initSupabase();
  if(!c) throw new Error("Supabase not configured");
  const { error } = await c.auth.signUp({ email, password });
  if(error) throw error;
}

async function supaSignIn(email, password){
  const c = initSupabase();
  if(!c) throw new Error("Supabase not configured");
  const { error } = await c.auth.signInWithPassword({ email, password });
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

// --- Utilities: File loader ---
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

// --- CSV parser ---
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

  const si = document.getElementById('search-input');
  if(si && si.value && si.value.trim().length >= 2){
    si.dispatchEvent(new Event('input', { bubbles:true }));
  }
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

function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
  const el = document.getElementById(id);
  if(el) el.classList.remove('hidden');
}

/* === auth UI (cog only after login + header user) === */
function updateAuthUI(){
  const cog = document.getElementById('settings-toggle');
  const who = document.getElementById('header-whoami');
  const whoUser = document.getElementById('header-user');

  const loggedIn = !!state.currentUser;
  if(loggedIn){
    cog?.classList.remove('hidden');
    who?.classList.remove('hidden');
    if(whoUser) whoUser.textContent = state.currentUser;
  } else {
    cog?.classList.add('hidden');
    who?.classList.add('hidden');
    if(whoUser) whoUser.textContent = '—';
    document.getElementById('settings-sidebar')?.classList.remove('open');
    document.getElementById('settings-overlay')?.classList.remove('open');
  }
}

async function logoutToLogin(){
  try{ await supaSignOut(); }catch(e){ console.warn("Sign out failed:", e); }
  state.currentUser = null;
  state.currentUserEmail = null;
  const cu = document.getElementById('current-user');
  if(cu) cu.textContent = "(none)";
  updateAuthUI();
  document.getElementById('login-form')?.classList.remove('hidden');
  document.getElementById('register-form')?.classList.add('hidden');
  showScreen('screen-login');
}

async function init(){
  try{ await refreshBaseFilesCache(); }catch(e){ console.warn('Base CSV refresh skipped:', e); }

  await Promise.all([loadTranslations(), loadMedicalTerms()]);
  await setLanguage(state.language);

  // Settings sidebar
  const settingsBtn = document.getElementById('settings-toggle');
  const sidebar = document.getElementById('settings-sidebar');
  const overlay = document.getElementById('settings-overlay');

  function openSettings(){ sidebar?.classList.add('open'); overlay?.classList.add('open'); }
  function closeSettings(){ sidebar?.classList.remove('open'); overlay?.classList.remove('open'); }
  function toggleSettings(){ sidebar?.classList.contains('open') ? closeSettings() : openSettings(); }

  settingsBtn?.addEventListener('click', toggleSettings);
  overlay?.addEventListener('click', closeSettings);

  // Hero language buttons
  document.querySelectorAll('.lang-btn').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      e.preventDefault();
      const lang = btn.getAttribute('data-lang');
      await setLanguage(lang);
    });
  });

  on('to-login','click', ()=> showScreen('screen-login'));
  on('to-register','click', ()=> {
    showScreen('screen-login');
    document.getElementById('login-form')?.classList.add('hidden');
    document.getElementById('register-form')?.classList.remove('hidden');
  });

  function openGuestModal(){ document.getElementById('guest-overlay')?.classList.remove('hidden'); }
  function closeGuestModal(){ document.getElementById('guest-overlay')?.classList.add('hidden'); }

  on('continue-guest','click', ()=> openGuestModal());
  on('guest-back','click', ()=> closeGuestModal());
  on('guest-continue','click', ()=>{
    closeGuestModal();
    showScreen('screen-submenu');
  });

  const langSel = document.getElementById('language');
  if(langSel) langSel.value = state.language;
  on('language','change', async (e)=>{ await setLanguage(e.target.value); });

  on('btn-show-register','click', ()=>{
    document.getElementById('login-form')?.classList.add('hidden');
    document.getElementById('register-form')?.classList.remove('hidden');
  });
  on('btn-show-login','click', ()=>{
    document.getElementById('login-form')?.classList.remove('hidden');
    document.getElementById('register-form')?.classList.add('hidden');
  });

  on('btn-register','click', async () => {
    clearLoginStatus();
    const username = document.getElementById('reg-username')?.value.trim() || "";
    const password = document.getElementById('reg-password')?.value || "";
    const confirm = document.getElementById('reg-password-confirm')?.value || "";
    const msg = document.getElementById('register-msg');
    if(msg) msg.textContent='';

    if (!username || !password) { setLoginStatus("Please fill all fields", "error"); return; }
    if (password !== confirm) { setLoginStatus("Passwords do not match", "error"); return; }

    const email = normalizeLoginIdentifier(username);

    try {
      setLoginStatus("Creating account…");
      await supaSignUp(email, password);

      const session = await supaGetSession();
      setLoginStatus(session ? "Account created. You can log in now." : "Account created. Please confirm your email, then log in.", session ? "ok" : "info");

      if(msg) msg.textContent = t('Registration successful! You can now log in.') || 'Registration successful! You can now log in.';

      const u = document.getElementById('reg-username'); if(u) u.value='';
      const p = document.getElementById('reg-password'); if(p) p.value='';
      const c = document.getElementById('reg-password-confirm'); if(c) c.value='';
    } catch (e) {
      console.error(e);
      setLoginStatus("Registration failed: " + e.message, "error");
      if(msg) msg.textContent = (e.message || String(e));
    }
  });

  on('btn-login','click', async () => {
    clearLoginStatus();
    const username = document.getElementById('username')?.value.trim() || "";
    const password = document.getElementById('password')?.value || "";
    const msg = document.getElementById('login-msg');
    if(msg) msg.textContent='';

    if (!username || !password) { setLoginStatus("Enter username and password", "error"); return; }

    const email = normalizeLoginIdentifier(username);

    try {
      setLoginStatus("Signing in…");
      await supaSignIn(email, password);

      state.currentUser = username;
      state.currentUserEmail = email;

      const cu = document.getElementById('current-user');
      if(cu) cu.textContent = username;
      updateAuthUI();

      setLoginStatus("Signed in. Sync active.", "ok");
      showScreen("screen-submenu");

      try{
        await refreshBaseFilesCache();
        await Promise.all([loadTranslations(), loadMedicalTerms()]);
        applyTranslationsToDom();
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

  on('to-search','click', ()=> { showScreen('screen-search'); });
  on('to-entry','click', ()=> { showScreen('screen-entry'); });
  on('to-quiz','click', ()=> { showScreen('screen-quiz'); });

  on('to-menu','click', ()=> { showScreen('screen-menu'); });
  on('to-login-from-settings','click', async ()=> { await logoutToLogin(); });
  on('btn-sync','click', async ()=>{ await syncNow(); });

  updateDirtyCount();

  const searchInput = document.getElementById('search-input');
  const resultsDiv = document.getElementById('search-results');

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

      for(const tRow of getLocalTerms()){
        if(includesQuery(tRow && tRow[userField], q)){
          results.push({ kind:'user', row:tRow });
          seenUser.add(tRow);
        }
      }

      if(results.length === 0){
        for(const r of medicalTerms){
          if(!seenBase.has(r) && matchAnyField(r, BASE_SEARCH_FIELDS, q)){
            results.push({ kind:'base', row:r });
            seenBase.add(r);
          }
        }
        for(const tRow of getLocalTerms()){
          if(!seenUser.has(tRow) && matchAnyField(tRow || {}, USER_SEARCH_FIELDS, q)){
            results.push({ kind:'user', row:tRow });
            seenUser.add(tRow);
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
  showScreen('screen-menu');
  applyTranslationsToDom();
}

function startQuiz(){
  const from = document.getElementById('quiz-from')?.value;
  const to = document.getElementById('quiz-to')?.value;
  if(!from || !to) return;

  const fromUser = mapUserFieldFromBase(from);
  const toUser = mapUserFieldFromBase(to);

  const area = document.getElementById('quiz-area');
  const scoreEl = document.getElementById('quiz-score');
  if(!area || !scoreEl) return;

  area.innerHTML='';
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
  const quizItems = pool.slice(0, Math.min(5,pool.length));
  let score=0;

  quizItems.forEach((it, idx)=>{
    const qdiv = document.createElement('div');
    qdiv.className='quiz-item';
    const q = document.createElement('div');
    q.innerHTML = `<strong>Q${idx+1}:</strong> ${it.from}`;
    qdiv.appendChild(q);

    const choices = [it.to];
    for(let i=0;i<20 && choices.length<4;i++){
      const cand = pool[Math.floor(Math.random()*pool.length)].to;
      if(cand && !choices.includes(cand)) choices.push(cand);
    }
    shuffle(choices);

    const ul = document.createElement('div');
    ul.className='choices';
    choices.forEach(ch=>{
      const btn = document.createElement('button');
      btn.textContent=ch;
      btn.addEventListener('click', ()=>{
        if(btn.classList.contains('answered')) return;
        btn.classList.add('answered');
        if(ch===it.to){ btn.style.background='lightgreen'; score++; }
        else { btn.style.background='indianred'; }
        scoreEl.textContent = `${t('score')||'Score'}: ${score} / ${quizItems.length}`;
      });
      ul.appendChild(btn);
    });
    qdiv.appendChild(ul);
    area.appendChild(qdiv);
  });

  scoreEl.textContent = `${t('score')||'Score'}: ${score} / ${quizItems.length}`;
}

function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
}

window.addEventListener('DOMContentLoaded', ()=>{ init(); });
