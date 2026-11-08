"use strict";

// Patient Trainer Vercel relay: secrets are never supplied to the browser.
const { applyCors, handleOptions } = require("./_cors");
const { readBody, sendJson } = require("./_gemini");

const MAX_REQUEST_BYTES = 3_000_000;
const TIMEOUT_MS = 20_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeString = (v, max = 1000) => typeof v === "string" ? v.slice(0, max) : "";
const safeItems = (v, max) => Array.isArray(v) ? v.slice(0, max) : [];

function validate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "A JSON object is required.";
  if (body.schemaVersion !== 1) return "Unsupported session schema.";
  if (!UUID_RE.test(safeString(body.sessionId))) return "Invalid session ID.";
  if (!/^pt-(?:browser|account)-[0-9a-f-]{36}$/i.test(safeString(body.anonymousUserId))) return "Invalid anonymous user ID.";
  if (!body.caseId || typeof body.caseId !== "string") return "Missing case ID.";
  if (!body.completedAt || Number.isNaN(Date.parse(body.completedAt))) return "The session must be completed before submission.";
  if (!Array.isArray(body.messages) || body.messages.length > 1000) return "Invalid session messages.";
  if (body.messages.some(m => !m || typeof m !== "object" || !["student", "patient"].includes(m.speaker))) return "Invalid transcript entry.";
  return null;
}

function cleanRecord(raw) {
  const scalar = (value, max) => safeString(value, max);
  return {
    schemaVersion: 1,
    sessionId: raw.sessionId,
    anonymousUserId: raw.anonymousUserId,
    caseId: scalar(raw.caseId, 150),
    caseName: scalar(raw.caseName, 200),
    trainerType: scalar(raw.trainerType, 64),
    mode: scalar(raw.mode, 32),
    startedAt: scalar(raw.startedAt, 60),
    completedAt: scalar(raw.completedAt, 60),
    durationSeconds: Math.max(0, Math.min(604800, Number(raw.durationSeconds) || 0)),
    messages: safeItems(raw.messages, 1000).map(m => ({
      timestamp: scalar(m.timestamp, 60),
      speaker: m.speaker,
      text: scalar(m.text, 6000),
      normalizedQuestion: scalar(m.normalizedQuestion, 3000),
      matchedIntent: scalar(m.matchedIntent, 150),
      matchedQuestionAnswerId: scalar(m.matchedQuestionAnswerId, 150),
      matchKind: scalar(m.matchKind, 120),
      responseScope: scalar(m.responseScope, 120),
      confidence: Number.isFinite(Number(m.confidence)) ? Number(m.confidence) : null,
      fallbackUsed: Boolean(m.fallbackUsed),
      detectedIntent: scalar(m.detectedIntent, 150),
      returnedAnswer: scalar(m.returnedAnswer, 6000),
      matchedIntentIds: safeItems(m.matchedIntentIds, 20).map(x => scalar(x, 150)),
      matchScore: Number.isFinite(Number(m.matchScore)) ? Number(m.matchScore) : null,
      aiSelectedIntent: scalar(m.aiSelectedIntent, 150),
      aiConfidence: Number.isFinite(Number(m.aiConfidence)) ? Number(m.aiConfidence) : null,
      aiAttempted: Boolean(m.aiAttempted),
      aiSucceeded: Boolean(m.aiSucceeded),
      aiRescueUsed: Boolean(m.aiRescueUsed),
      finalResolutionSource: scalar(m.finalResolutionSource, 150)
    })),
    examinations: safeItems(raw.examinations, 300).map(x => ({
      type: scalar(x?.type, 100), id: scalar(x?.id, 100),
      label: scalar(x?.label, 500), timestamp: scalar(x?.timestamp, 60)
    })),
    coveredTopics: safeItems(raw.coveredTopics, 500).map(x => scalar(x, 150)),
    uncoveredTopics: safeItems(raw.uncoveredTopics, 500).map(x => scalar(x, 150)),
    fallbackQuestions: safeItems(raw.fallbackQuestions, 500).map(x => ({
      timestamp: scalar(x?.timestamp, 60),
      rawStudentQuestion: scalar(x?.rawStudentQuestion, 6000),
      detectedIntent: scalar(x?.detectedIntent, 150),
      matchKind: scalar(x?.matchKind, 120),
      returnedPatientAnswer: scalar(x?.returnedPatientAnswer, 6000),
      error: scalar(x?.error, 500)
    })),
    clientVersion: scalar(raw.clientVersion, 100)
  };
}

function safeFilename(record) {
  return `patient-trainer-${record.sessionId}.json`;
}

async function relayToAppsScript(record, deps = {}) {
  const endpoint = process.env.PATIENT_TRAINER_APPS_SCRIPT_URL;
  const secret = process.env.PATIENT_TRAINER_UPLOAD_SHARED_SECRET;
  if (!endpoint || !secret) {
    const error = new Error("Upload storage is not configured.");
    error.statusCode = 503;
    throw error;
  }
  let parsed;
  try { parsed = new URL(endpoint); } catch { throw new Error("Upload destination is invalid."); }
  if (parsed.protocol !== "https:" || !/^(?:script\.google\.com|script\.googleusercontent\.com)$/i.test(parsed.hostname)) {
    throw new Error("Upload destination must be a Google Apps Script HTTPS URL.");
  }
  const response = await (deps.fetch || fetch)(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: JSON.stringify({ action: "patient-trainer-log", secret, filename: safeFilename(record), session: record }),
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Storage returned HTTP ${response.status}.`);
  let result;
  try { result = await response.json(); } catch { throw new Error("Storage did not return JSON confirmation."); }
  if (result?.ok !== true || result?.stored !== true || result.sessionId !== record.sessionId || !result.filename) {
    throw new Error("Storage did not confirm the matching session was saved.");
  }
  return {
    ok: true,
    sessionId: record.sessionId,
    filename: safeString(result.filename, 255),
    uploadId: safeString(result.uploadId || result.fileId || result.filename, 300),
    receivedAt: safeString(result.receivedAt, 60) || new Date().toISOString()
  };
}

async function handler(req, res) {
  if (handleOptions(req, res, "POST, OPTIONS")) return;
  applyCors(req, res, "POST, OPTIONS");
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." });

  const advertised = Number(req.headers?.["content-length"] || 0);
  if (advertised > MAX_REQUEST_BYTES) return sendJson(res, 413, { ok: false, error: "Session log exceeds the upload size limit." });
  const body = readBody(req);
  if (body && Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_REQUEST_BYTES) {
    return sendJson(res, 413, { ok: false, error: "Session log exceeds the upload size limit." });
  }
  const message = validate(body);
  if (message) return sendJson(res, 400, { ok: false, error: message });
  let record;
  try { record = cleanRecord(body); } catch { return sendJson(res, 400, { ok: false, error: "Invalid session record." }); }
  if (Buffer.byteLength(JSON.stringify(record), "utf8") > MAX_REQUEST_BYTES) {
    return sendJson(res, 413, { ok: false, error: "Session log is too large; the local copy remains available." });
  }
  try {
    const result = await relayToAppsScript(record);
    return sendJson(res, 200, result);
  } catch (error) {
    console.error("Patient Trainer storage failed:", error?.name || "Error");
    return sendJson(res, error.statusCode || 503, { ok: false, error: "Unable to store session. It remains saved on this device; retry later." });
  }
}

module.exports = handler;
module.exports._test = { validate, cleanRecord, safeFilename, relayToAppsScript, MAX_REQUEST_BYTES };
