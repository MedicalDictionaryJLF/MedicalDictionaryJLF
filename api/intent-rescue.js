"use strict";

const { applyCors, handleOptions } = require("./_cors");
const { callGemini, confidence, logAi, readBody, sendJson, text } = require("./_gemini");

const schema = {
  type: "OBJECT",
  properties: {
    intent: { type: "STRING" },
    confidence: { type: "NUMBER" },
    reason: { type: "STRING" }
  },
  required: ["intent", "confidence", "reason"]
};

module.exports = async function handler(req, res) {
  const aiCallType = "intent-rescue";
  if (handleOptions(req, res, "POST, OPTIONS")) return;
  applyCors(req, res, "POST, OPTIONS");
  if (req.method !== "POST") return sendJson(res, 405, { success: false, error: "Method not allowed." });

  const body = readBody(req);
  const question = text(body?.question);
  const intents = Array.isArray(body?.intents)
    ? body.intents.slice(0, 100).map(item => ({
      id: text(item?.id, 100),
      description: text(item?.description, 500)
    })).filter(item => item.id)
    : [];

  if (!question || !intents.length) {
    logAi({ aiCallType, success: false });
    return sendJson(res, 400, { success: false, error: "question and intents are required." });
  }

  try {
    const result = await callGemini({
      systemInstruction: "Classify an ambiguous user question into one supplied intent. Use only a supplied intent id. If none fit, return intent as an empty string. You are a routing helper, not a medical advisor.",
      prompt: JSON.stringify({ question, intents }),
      responseSchema: schema
    });
    const finalIntent = intents.some(item => item.id === result.intent) ? result.intent : null;
    const aiConfidence = finalIntent ? confidence(result.confidence) : 0;
    logAi({ aiCallType, aiConfidence, finalIntent, success: true });
    return sendJson(res, 200, { success: true, intent: finalIntent, confidence: aiConfidence, reason: text(result.reason, 500) });
  } catch (error) {
    console.error(error);
    logAi({ aiCallType, success: false });
    return sendJson(res, 503, { success: false, error: "Intent rescue is temporarily unavailable." });
  }
};
