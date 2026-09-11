"use strict";

const { applyCors, handleOptions } = require("./_cors");
const { readBody, sendJson, text } = require("./_gemini");
const { issueAiSessionToken, shortHash } = require("./_ai-limit");

const DRIVE_ABOUT_URL = "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,permissionId)";

module.exports = async function handler(req, res) {
  if (handleOptions(req, res, "POST, OPTIONS")) return;
  applyCors(req, res, "POST, OPTIONS");
  if (req.method !== "POST") return sendJson(res, 405, { success: false, error: "Method not allowed." });

  const body = readBody(req);
  const accessToken = text(body?.accessToken, 5000);
  if (!accessToken) return sendJson(res, 400, { success: false, error: "Google access token is required." });

  try {
    const response = await fetch(DRIVE_ABOUT_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(7000)
    });
    if (!response.ok) return sendJson(res, 401, { success: false, error: "Google session could not be verified." });
    const payload = await response.json();
    const user = payload?.user || {};
    const identity = text(user.emailAddress, 500) || text(user.permissionId, 500) || text(user.displayName, 500);
    if (!identity) return sendJson(res, 401, { success: false, error: "Google account identity was unavailable." });
    const subject = shortHash(identity.toLowerCase());
    const token = issueAiSessionToken(subject);
    return sendJson(res, 200, {
      success: true,
      sessionToken: token,
      tier: "user",
      expiresInSeconds: 60 * 60 * 12
    });
  } catch (error) {
    console.error(error);
    return sendJson(res, 503, { success: false, error: "AI usage session could not be created." });
  }
};
