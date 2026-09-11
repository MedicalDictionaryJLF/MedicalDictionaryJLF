const DEFAULT_API_BASE = "";
const DEFAULT_PRODUCTION_API_BASE = "https://medical-dictionary-jlf.vercel.app";
const AI_VISITOR_KEY = "md_ai_visitor_v1";
const AI_SESSION_KEY = "md_ai_session_v1";

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function getApiBaseUrl() {
  const explicit = window.MEDICAL_DICTIONARY_API_BASE_URL || window.ANAMNESIS_API_BASE_URL || DEFAULT_API_BASE;
  if (explicit) return normalizeBaseUrl(explicit);
  if (/\.github\.io$/i.test(window.location.hostname)) return DEFAULT_PRODUCTION_API_BASE;
  return "";
}

export function buildApiUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBaseUrl();

  return base
    ? `${base}${normalizedPath}`
    : normalizedPath;
}


function createVisitorId() {
  try {
    const existing = localStorage.getItem(AI_VISITOR_KEY);
    if (existing) return existing;
    const created = (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function")
      ? globalThis.crypto.randomUUID()
      : `visitor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(AI_VISITOR_KEY, created);
    return created;
  } catch {
    return `ephemeral_${Math.random().toString(36).slice(2)}`;
  }
}

export function getAiClientContext() {
  let sessionToken = "";
  try { sessionToken = localStorage.getItem(AI_SESSION_KEY) || ""; } catch {}
  return { visitorId: createVisitorId(), sessionToken };
}

export function clearAiSessionToken() {
  try { localStorage.removeItem(AI_SESSION_KEY); } catch {}
}

export async function establishAiSession(accessToken) {
  const token = String(accessToken || "").trim();
  if (!token) { clearAiSessionToken(); return null; }
  const response = await postJson(buildApiUrl("/api/ai-session"), { accessToken: token }, { includeClientContext: false });
  if (response?.sessionToken) {
    try { localStorage.setItem(AI_SESSION_KEY, response.sessionToken); } catch {}
  }
  return response;
}

function responsePreview(rawText) {
  return String(rawText || "").replace(/\s+/g, " ").slice(0, 200);
}

async function parseJsonResponse(response, url) {
  const contentType = response.headers.get("content-type") || "";
  const rawText = await response.text();

  let payload;

  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    const parseError = new Error(
      `API returned non-JSON response: ${url}, status ${response.status}, content-type ${contentType || "unknown"}.`
    );

    parseError.details = {
      url,
      status: response.status,
      contentType,
      validJson: false,
      preview: responsePreview(rawText)
    };

    throw parseError;
  }

  if (!response.ok) {
    const apiError = new Error(
      payload.error ||
      `API request failed with status ${response.status}.`
    );

    apiError.details = {
      url,
      status: response.status,
      contentType,
      validJson: true,
      payload
    };

    throw apiError;
  }

  return {
    ...payload,
    _http: {
      url,
      status: response.status,
      contentType,
      validJson: true
    }
  };
}

async function postJson(url, body, options = {}) {
  let response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(options.includeClientContext === false
        ? body
        : { ...(body || {}), clientContext: getAiClientContext() })
    });
  } catch (error) {
    const networkError = new Error(
      `Network request failed for ${url}: ${error.message}`
    );

    networkError.details = {
      url,
      status: null,
      contentType: null,
      validJson: false
    };

    throw networkError;
  }

  return parseJsonResponse(response, url);
}

async function getJson(url) {
  let response;

  try {
    response = await fetch(url, { method: "GET" });
  } catch (error) {
    const networkError = new Error(
      `Network request failed for ${url}: ${error.message}`
    );

    networkError.details = {
      url,
      status: null,
      contentType: null,
      validJson: false
    };

    throw networkError;
  }

  return parseJsonResponse(response, url);
}

export function resolveIntentWithAI(question, intents) {
  return postJson(
    buildApiUrl("/api/intent-rescue"),
    { question, intents }
  );
}

export function resolveContextWithAI(question, conversation = [], context = {}, intents = []) {
  return postJson(
    buildApiUrl("/api/context-resolve"),
    { question, conversation, context, intents }
  );
}

export function rewritePatientAnswer(deterministicAnswer, audience = "patient") {
  return postJson(
    buildApiUrl("/api/patient-phrasing"),
    { deterministicAnswer, audience }
  );
}

export function getAiHealth() {
  return getJson(buildApiUrl("/api/ai-health"));
}

export function answerSearchQuestion(question, context = [], language = "english", scope = "all") {
  return postJson(
    buildApiUrl("/api/search-answer"),
    { question, context, language, scope }
  );
}
