"use strict";

const crypto = require("node:crypto");
const { applyCors, handleOptions } = require("./_cors");
const { readBody, sendJson } = require("./_gemini");

const MAX_BODY_BYTES = 512 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_REQUESTS = 20;
const rateBuckets = new Map();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ANONYMOUS_USER_RE = /^pt-(?:browser|account)-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODES = new Set(["practice", "teaching", "exam"]);
const TRAINER_TYPES = new Set(["anamnesis", "anamnesis_examination"]);

function text(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function number(value, min = 0, max = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(min, Math.min(max, parsed));
}

function iso(value, required = false) {
  const candidate = text(value, 80);
  if (!candidate) return required ? null : "";
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(req.socket?.remoteAddress || "unknown");
}

function allowedByRateLimit(req) {
  const now = Date.now();
  const ipHash = crypto.createHash("sha256").update(safeIp(req)).digest("hex").slice(0, 24);
  const bucket = rateBuckets.get(ipHash);
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(ipHash, { startedAt: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  if (rateBuckets.size > 5000) {
    for (const [key, value] of rateBuckets) {
      if (now - value.startedAt >= RATE_WINDOW_MS) rateBuckets.delete(key);
    }
  }
  return bucket.count <= RATE_MAX_REQUESTS;
}

function sanitizeMessage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const speaker = raw.speaker === "patient" ? "patient" : raw.speaker === "student" ? "student" : "";
  const timestamp = iso(raw.timestamp);
  const body = text(raw.text, 6000);
  if (!speaker || !timestamp || !body) return null;
  const out = { timestamp, speaker, text: body };
  const strings = {
    normalizedQuestion: 6000,
    detectedIntent: 160,
    matchedIntent: 160,
    matchedQuestionAnswerId: 200,
    matchKind: 100,
    responseScope: 100,
    feedbackLabel: 160,
    returnedAnswer: 6000,
    aiSelectedIntent: 160,
    finalResolutionSource: 100
  };
  for (const [key, limit] of Object.entries(strings)) {
    const value = text(raw[key], limit);
    if (value) out[key] = value;
  }
  if (Array.isArray(raw.matchedIntentIds)) out.matchedIntentIds = raw.matchedIntentIds.slice(0, 20).map((value) => text(String(value), 160)).filter(Boolean);
  if (raw.confidence !== undefined) out.confidence = number(raw.confidence, 0, 1);
  if (raw.matchScore !== undefined) out.matchScore = number(raw.matchScore, 0, 100000);
  if (raw.aiConfidence !== undefined && raw.aiConfidence !== null) out.aiConfidence = number(raw.aiConfidence, 0, 1);
  if (raw.fallbackUsed !== undefined) out.fallbackUsed = Boolean(raw.fallbackUsed);
  if (raw.aiAttempted !== undefined) out.aiAttempted = Boolean(raw.aiAttempted);
  if (raw.aiSucceeded !== undefined) out.aiSucceeded = Boolean(raw.aiSucceeded);
  if (raw.aiRescueUsed !== undefined) out.aiRescueUsed = Boolean(raw.aiRescueUsed);
  return out;
}

function sanitizeFallback(raw) {
  if (!raw || typeof raw !== "object") return null;
  const timestamp = iso(raw.timestamp);
  const rawStudentQuestion = text(raw.rawStudentQuestion, 6000);
  if (!timestamp || !rawStudentQuestion) return null;
  return {
    timestamp,
    rawStudentQuestion,
    normalizedQuestion: text(raw.normalizedQuestion, 6000),
    detectedIntent: text(raw.detectedIntent, 160),
    matchedIntent: text(raw.matchedIntent, 160),
    matchedIntentIds: Array.isArray(raw.matchedIntentIds) ? raw.matchedIntentIds.slice(0, 20).map((value) => text(String(value), 160)).filter(Boolean) : [],
    confidence: number(raw.confidence, 0, 1),
    matchScore: number(raw.matchScore, 0, 100000),
    matchKind: text(raw.matchKind, 100),
    responseScope: text(raw.responseScope, 100),
    fallbackUsed: true,
    aiSelectedIntent: text(raw.aiSelectedIntent, 160),
    aiConfidence: raw.aiConfidence === null || raw.aiConfidence === undefined ? null : number(raw.aiConfidence, 0, 1),
    aiAttempted: Boolean(raw.aiAttempted),
    aiSucceeded: Boolean(raw.aiSucceeded),
    aiRescueUsed: Boolean(raw.aiRescueUsed),
    finalResolutionSource: text(raw.finalResolutionSource, 100),
    returnedPatientAnswer: text(raw.returnedPatientAnswer, 6000),
    error: text(raw.error, 500)
  };
}

function sanitizeExamination(raw) {
  if (!raw || typeof raw !== "object") return null;
  const timestamp = iso(raw.timestamp);
  const type = text(raw.type, 100);
  if (!type || !timestamp) return null;
  const out = {
    type,
    id: text(raw.id, 180),
    label: text(raw.label, 500),
    timestamp
  };
  if (Array.isArray(raw.resultKeys)) out.resultKeys = raw.resultKeys.slice(0, 100).map((value) => text(String(value), 180)).filter(Boolean);
  if (raw.effectModelled !== undefined) out.effectModelled = Boolean(raw.effectModelled);
  if (raw.effectMessage) out.effectMessage = text(raw.effectMessage, 2000);
  return out;
}

function validatePayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "JSON object required." };
  const estimatedBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  if (estimatedBytes > MAX_BODY_BYTES) return { error: "Transcript exceeds the maximum allowed size." };

  if (Number(body.schemaVersion) !== 1) return { error: "Unsupported schemaVersion." };
  const sessionId = text(body.sessionId, 64);
  if (!UUID_RE.test(sessionId)) return { error: "A valid sessionId is required." };
  const anonymousUserId = text(body.anonymousUserId, 100);
  if (!ANONYMOUS_USER_RE.test(anonymousUserId)) return { error: "A valid anonymousUserId is required." };
  const caseId = text(body.caseId, 120);
  if (!caseId) return { error: "caseId is required." };
  const mode = text(body.mode, 20).toLowerCase();
  const trainerType = text(body.trainerType, 40).toLowerCase();
  if (!MODES.has(mode)) return { error: "Invalid mode." };
  if (!TRAINER_TYPES.has(trainerType)) return { error: "Invalid trainerType." };

  const startedAt = iso(body.startedAt, true);
  const completedAt = iso(body.completedAt, true);
  if (!startedAt || !completedAt) return { error: "Valid startedAt and completedAt timestamps are required." };
  if (Date.parse(completedAt) < Date.parse(startedAt)) return { error: "completedAt cannot precede startedAt." };

  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  if (rawMessages.length > 1000) return { error: "Too many transcript messages." };
  const messages = rawMessages.map(sanitizeMessage);
  if (messages.some((item) => !item)) return { error: "One or more transcript messages are invalid." };

  const rawExaminations = Array.isArray(body.examinations) ? body.examinations : [];
  if (rawExaminations.length > 500) return { error: "Too many examination/action entries." };
  const examinations = rawExaminations.map(sanitizeExamination);
  if (examinations.some((item) => !item)) return { error: "One or more examination/action entries are invalid." };

  const rawFallback = Array.isArray(body.fallbackQuestions) ? body.fallbackQuestions : [];
  if (rawFallback.length > 500) return { error: "Too many fallback entries." };
  const fallbackQuestions = rawFallback.map(sanitizeFallback);
  if (fallbackQuestions.some((item) => !item)) return { error: "One or more fallback entries are invalid." };

  const sanitizeTopics = (value) => Array.isArray(value)
    ? value.slice(0, 300).map((item) => text(String(item), 180)).filter(Boolean)
    : [];

  return {
    value: {
      schemaVersion: 1,
      sessionId,
      anonymousUserId,
      caseId,
      caseName: text(body.caseName, 200),
      trainerType,
      mode,
      startedAt,
      completedAt,
      durationSeconds: Math.round(number(body.durationSeconds, 0, 7 * 24 * 60 * 60)),
      messages,
      examinations,
      coveredTopics: sanitizeTopics(body.coveredTopics),
      uncoveredTopics: sanitizeTopics(body.uncoveredTopics),
      fallbackQuestions,
      clientVersion: text(body.clientVersion, 100)
    }
  };
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res, "POST, OPTIONS")) return;
  applyCors(req, res, "POST, OPTIONS");
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST required." });
  if (!String(req.headers["content-type"] || "").toLowerCase().includes("application/json")) {
    return sendJson(res, 415, { ok: false, error: "Content-Type application/json required." });
  }
  if (!allowedByRateLimit(req)) return sendJson(res, 429, { ok: false, error: "Too many requests. Please retry later." });

  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > MAX_BODY_BYTES) return sendJson(res, 413, { ok: false, error: "Transcript exceeds the maximum allowed size." });

  const parsed = readBody(req);
  const checked = validatePayload(parsed);
  if (checked.error) return sendJson(res, 400, { ok: false, error: checked.error });

  const upstreamUrl = String(process.env.PATIENT_TRAINER_APPS_SCRIPT_URL || "").trim();
  const sharedSecret = String(process.env.PATIENT_TRAINER_UPLOAD_SHARED_SECRET || "").trim();
  if (!upstreamUrl || !sharedSecret) return sendJson(res, 503, { ok: false, error: "Patient Trainer upload service is not configured." });

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ sharedSecret, payload: checked.value }),
      redirect: "follow",
      signal: AbortSignal.timeout(12000)
    });
    const raw = await upstream.text();
    let answer;
    try { answer = JSON.parse(raw); } catch { return sendJson(res, 502, { ok: false, error: "Upload service returned an invalid response." }); }
    if (!upstream.ok || !answer || answer.ok !== true) {
      return sendJson(res, 502, { ok: false, error: text(answer?.error, 300) || "Upload service rejected the session." });
    }
    if (String(answer.sessionId || "") !== checked.value.sessionId) {
      return sendJson(res, 502, { ok: false, error: "Upload service returned a mismatched session ID." });
    }
    const filename = text(answer.filename, 220);
    if (!filename) return sendJson(res, 502, { ok: false, error: "Upload service did not return a filename." });
    return sendJson(res, 200, {
      ok: true,
      sessionId: checked.value.sessionId,
      receivedAt: iso(answer.receivedAt) || new Date().toISOString(),
      filename,
      uploadId: text(answer.uploadId, 220) || filename
    });
  } catch (error) {
    console.error("patient-trainer-log upload failed", error);
    return sendJson(res, 502, { ok: false, error: "Session saved locally, but the upload service could not be reached." });
  }
};

module.exports._validatePayload = validatePayload;
