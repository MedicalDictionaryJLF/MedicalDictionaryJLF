/* app.js
   Goal: keep HTML dumb, keep JS smart.
   This file:
   - handles screen navigation
   - handles language state + text replacement
   - loads CSVs with plain fetch (no “storage download” mystery)
*/

const APP = {
  state: {
    screen: "language",
    language: "en",
    user: null,
    data: {
      termsCSV: null,
      musclesCSV: null,
      translationsCSV: null,
    },
  },

  config: {
    languages: [
      { code: "en", label: "English" },
      { code: "de", label: "Deutch" },      // your spelling stays, your choice
      { code: "sk", label: "Slovensky" },
      { code: "es", label: "Español" },
      { code: "no", label: "Norsk" },
      { code: "is", label: "Íslenska" },
    ],

    // Keep filenames simple. Spaces are legal but annoying.
    files: {
      terms: "medical_terms.csv",
      muscles: "Muscles.csv",
      // rename your file to app_translations.csv if you currently have "App translations.csv"
      translations: "app_translations.csv",
    },
  },

  // Minimal i18n dictionary (expand later)
  i18n: {
    en: {
      app_title: "Medical Dictionary",
      logged_in_as: "Logged in as:",
      settings: "Settings",
      language: "Language",
      account_sync: "Account & Sync",
      sync: "Sync",
      back_to_language_menu: "Back to Language Menu",
      return_to_login: "Return to Login",
      choose_language: "Choose language",
      may_change_later: "May later change in settings",
      login: "Login",
      register: "Register",
      continue_without_account: "Continue without account",
      please_note: "Please note: This web version is still in development…",
      login_or_register: "Login or Register",
      back: "Back",
      welcome: "Welcome",
      search_terms: "Search Terms",
      add_term: "Add Term",
      quiz: "Quiz",
      muscle_training: "Muscle training",
      anamnesis: "Anamnesis",
      links: "Links",
      search: "Search",
      save_term: "Save Term",
      start: "Start",
    },
    // Stub. You can load full translations from CSV later.
    de: {},
    sk: {},
    es: {},
    no: {},
    is: {},
  },
};

// ---------- Utilities ----------
function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function setText(key) {
  const lang = APP.state.language;
  return (APP.i18n[lang] && APP.i18n[lang][key]) || APP.i18n.en[key] || key;
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = setText(key);
  });
}

function showScreen(name) {
  APP.state.screen = name;
  document.querySelectorAll("[data-screen]").forEach((sec) => {
    sec.classList.toggle("hidden", sec.getAttribute("data-screen") !== name);
  });
}

async function fetchText(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return await res.text();
}

// ---------- CSV loading (hooks) ----------
async function loadCoreCSVs() {
  const statusEl = document.getElementById("dataStatus");
  if (statusEl) statusEl.textContent = "Data: loading…";

  try {
    // These are optional; if missing, app still loads.
    APP.state.data.termsCSV = await fetchText(APP.config.files.terms).catch(() => null);
    APP.state.data.musclesCSV = await fetchText(APP.config.files.muscles).catch(() => null);
    APP.state.data.translationsCSV = await fetchText(APP.config.files.translations).catch(() => null);

    const loaded = [
      APP.state.data.termsCSV ? "terms" : null,
      APP.state.data.musclesCSV ? "muscles" : null,
      APP.state.data.translationsCSV ? "translations" : null,
    ].filter(Boolean);

    if (statusEl) statusEl.textContent = loaded.length
      ? `Data: loaded (${loaded.join(", ")})`
      : "Data: not loaded (missing CSVs?)";
  } catch (e) {
    if (statusEl) statusEl.textContent = "Data: error";
    console.error("CSV load failed:", e);
  }
}

// ---------- UI wiring ----------
function renderLanguageButtons(containerId, onPick) {
  const wrap = $(containerId);
  wrap.innerHTML = "";

  APP.config.languages.forEach((lang) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = lang.label;
    btn.dataset.lang = lang.code;

    if (APP.state.language === lang.code) btn.style.border = "2px solid #000";

    btn.addEventListener("click", () => onPick(lang.code));
    wrap.appendChild(btn);
  });
}

function setLanguage(code) {
  APP.state.language = code;
  applyI18n();
  renderLanguageButtons("languageButtons", setLanguage);
  renderLanguageButtons("languageButtonsStart", (c) => {
    setLanguage(c);
    // staying on language screen is fine
  });
}

function setUserLabel() {
  const userLabel = $("userLabel");
  userLabel.textContent = APP.state.user?.email || "—";
}

// Example dumb search implementation (replace with real CSV parsing later)
function doSearch() {
  const q = $("searchInput").value.trim().toLowerCase();
  const out = $("searchResults");

  if (!q) {
    out.textContent = "";
    return;
  }

  const text = APP.state.data.termsCSV;
  if (!text) {
    out.textContent = "Terms CSV not loaded. Ensure medical_terms.csv exists in repo root.";
    return;
  }

  // naive search: filter lines containing query
  const lines = text.split(/\r?\n/);
  const hits = lines.filter((ln) => ln.toLowerCase().includes(q)).slice(0, 50);
  out.textContent = hits.length ? hits.join("\n") : "No matches (naive search).";
}

function wireEvents() {
  // Start screen buttons
  $("btnGoLogin").addEventListener("click", () => showScreen("auth"));
  $("btnGoRegister").addEventListener("click", () => showScreen("auth"));

  $("btnContinueGuest").addEventListener("click", async () => {
    showScreen("home");
    await loadCoreCSVs();
  });

  // Settings navigation
  $("btnSettings").addEventListener("click", () => showScreen("settings"));
  $("btnBackToLang").addEventListener("click", () => showScreen("language"));
  $("btnReturnToLogin").addEventListener("click", () => showScreen("auth"));
  $("btnSync").addEventListener("click", () => alert("Sync placeholder. Wire Supabase later."));

  // Auth back
  $("btnAuthBack").addEventListener("click", () => showScreen("language"));

  // Home nav
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => showScreen(btn.dataset.nav));
  });

  // Back buttons
  $("btnSearchBack").addEventListener("click", () => showScreen("home"));
  $("btnAddBack").addEventListener("click", () => showScreen("home"));
  $("btnQuizBack").addEventListener("click", () => showScreen("home"));

  // Search input
  $("searchInput").addEventListener("input", doSearch);

  // Quiz stub
  $("btnStartQuiz").addEventListener("click", () => {
    alert(`Quiz placeholder: ${$("quizFrom").value} -> ${$("quizTo").value}`);
  });

  // Add term stub
  $("btnSaveTerm").addEventListener("click", () => alert("Save Term placeholder"));
}

// ---------- Boot ----------
function boot() {
  // Initial UI
  renderLanguageButtons("languageButtons", setLanguage);
  renderLanguageButtons("languageButtonsStart", (code) => setLanguage(code));

  setLanguage(APP.state.language);
  setUserLabel();
  applyI18n();
  wireEvents();

  // Start on language screen
  showScreen("language");

  console.log("app.js loaded");
}

document.addEventListener("DOMContentLoaded", boot);
