"use strict";

const { applyCors, handleOptions } = require("./_cors");
const { GEMINI_MODEL, sendJson } = require("./_gemini");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res, "GET, OPTIONS")) return;
  applyCors(req, res, "GET, OPTIONS");

  if (req.method !== "GET") {
    return sendJson(res, 405, { success: false, error: "Method not allowed." });
  }

  return sendJson(res, 200, {
    success: true,
    configured: Boolean(process.env.GEMINI_API_KEY),
    model: GEMINI_MODEL,
    runtime: "vercel-serverless"
  });
};
