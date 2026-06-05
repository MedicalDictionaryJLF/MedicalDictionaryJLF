const DEFAULT_API_BASE = "";

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function getApiBaseUrl() {
  return normalizeBaseUrl(
    window.ANAMNESIS_API_BASE_URL ||
    DEFAULT_API_BASE
  );
}

export function buildApiUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBaseUrl();

  return base
    ? `${base}${normalizedPath}`
    : normalizedPath;
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

async function postJson(url, body) {
  let response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
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
