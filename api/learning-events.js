"use strict";

const crypto = require("node:crypto");
const { applyCors, handleOptions } = require("./_cors");
const { readBody, sendJson, text } = require("./_gemini");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

function googleDriveConfigured() {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY &&
    process.env.GOOGLE_DRIVE_FOLDER_ID
  );
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function serviceAccountPrivateKey() {
  return process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
}

function createJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: DRIVE_SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signingInput)
    .sign(serviceAccountPrivateKey());

  return `${signingInput}.${base64Url(signature)}`;
}

async function getAccessToken() {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: createJwt()
    })
  });

  if (!response.ok) {
    throw new Error(`Google token request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  if (!payload.access_token) throw new Error("Google token response did not include an access token.");
  return payload.access_token;
}

async function uploadLearningEvent(entry) {
  const accessToken = await getAccessToken();
  const boundary = `learning_event_${crypto.randomUUID()}`;
  const metadata = {
    name: `anamnesis-learning-event-${Date.now()}.json`,
    mimeType: "application/json",
    parents: [process.env.GOOGLE_DRIVE_FOLDER_ID]
  };
  const file = JSON.stringify(entry, null, 2);
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    file,
    `--${boundary}--`,
    ""
  ].join("\r\n");

  const response = await fetch(DRIVE_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });

  if (!response.ok) {
    throw new Error(`Google Drive upload failed with status ${response.status}.`);
  }
}

function sanitizeEvent(body) {
  return {
    recordedAt: text(body?.recordedAt, 100) || new Date().toISOString(),
    studentQuestion: text(body?.studentQuestion, 1000),
    deterministicIntentGuess: text(body?.deterministicIntentGuess, 150) || null,
    deterministicConfidence: Number(body?.deterministicConfidence) || 0,
    aiAvailable: Boolean(body?.aiAvailable),
    aiAttempted: Boolean(body?.aiAttempted),
    aiSucceeded: Boolean(body?.aiSucceeded),
    aiRescueUsed: Boolean(body?.aiRescueUsed),
    aiSelectedIntent: text(body?.aiSelectedIntent, 150) || null,
    aiConfidence: body?.aiConfidence ?? null,
    aiEndpoint: text(body?.aiEndpoint, 500) || null,
    aiHttpStatus: body?.aiHttpStatus ?? null,
    aiContentType: text(body?.aiContentType, 150) || null,
    aiError: text(body?.aiError, 500) || null,
    finalResolutionSource: text(body?.finalResolutionSource, 100) || null,
    resolvedIntent: text(body?.resolvedIntent, 150) || null,
    fallbackUsed: Boolean(body?.fallbackUsed),
    patientPhrasingUsed: Boolean(body?.patientPhrasingUsed),
    errors: Array.isArray(body?.errors) ? body.errors.slice(0, 10).map((item) => text(item, 500)).filter(Boolean) : []
  };
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res, "POST, OPTIONS")) return;
  applyCors(req, res, "POST, OPTIONS");

  if (req.method !== "POST") {
    return sendJson(res, 405, { success: false, error: "Method not allowed." });
  }

  const body = readBody(req);
  if (!body || typeof body !== "object") {
    return sendJson(res, 400, { success: false, error: "Valid JSON body is required." });
  }

  const entry = sanitizeEvent(body);
  const configured = googleDriveConfigured();

  if (!configured) {
    console.info("anamnesis-learning-event", JSON.stringify(entry));
    return sendJson(res, 200, { success: true, stored: false, configured: false });
  }

  try {
    await uploadLearningEvent(entry);
    return sendJson(res, 200, { success: true, stored: true, configured: true });
  } catch (error) {
    console.error(error);
    return sendJson(res, 503, { success: false, error: "Learning event upload is temporarily unavailable." });
  }
};
