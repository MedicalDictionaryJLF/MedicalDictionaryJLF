"use strict";

const { applyCors, handleOptions } = require("./_cors");
const { callGemini, confidence, logAi, readBody, sendJson, text } = require("./_gemini");
const { consumeAiQuota, sendQuotaExceeded } = require("./_ai-limit");

const schema = {
  type: "OBJECT",
  properties: {
    answer: { type: "STRING" },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },
          detail: { type: "STRING" }
        },
        required: ["label", "detail"]
      }
    },
    domain: { type: "STRING" },
    confidence: { type: "NUMBER" },
    groundedInContext: { type: "BOOLEAN" },
    note: { type: "STRING" }
  },
  required: ["answer", "items", "domain", "confidence", "groundedInContext", "note"]
};

module.exports = async function handler(req, res) {
  const aiCallType = "search-answer";
  if (handleOptions(req, res, "POST, OPTIONS")) return;
  applyCors(req, res, "POST, OPTIONS");
  if (req.method !== "POST") return sendJson(res, 405, { success: false, error: "Method not allowed." });

  const body = readBody(req);
  const question = text(body?.question, 1200);
  const language = text(body?.language, 40) || "english";
  const scope = text(body?.scope, 80) || "all";
  const context = Array.isArray(body?.context)
    ? body.context.slice(0, 40).map(item => ({
        kind: text(item?.kind, 80),
        label: text(item?.label, 250),
        detail: text(item?.detail, 1200)
      })).filter(item => item.label || item.detail)
    : [];

  if (!question) return sendJson(res, 400, { success: false, error: "question is required." });

  const quotaState = await consumeAiQuota({ req, body, aiCallType });
  if (!quotaState.allowed) return sendQuotaExceeded(res, sendJson, quotaState.quota);

  try {
    const result = await callGemini({
      systemInstruction: [
        "You are the fallback resolver for a medical-student search engine.",
        "The application already tried deterministic local algorithms and called you only because confidence was insufficient.",
        "Answer the educational question concisely and factually in the requested interface language.",
        "Prefer the supplied local context whenever it supports the answer.",
        "If the local records do not encode a requested classification, you may use established medical knowledge, but groundedInContext must be false.",
        "Never invent a drug, structure, numeric reference range, dose, contraindication, or relationship.",
        "For classifications that vary between teaching sources, explicitly note that terminology can vary and list only widely accepted examples.",
        "Do not provide patient-specific diagnosis or treatment advice. This is a reference/study search.",
        "Return short list items when the question asks for members of a group."
      ].join(" "),
      prompt: JSON.stringify({ question, language, scope, localContext: context }),
      responseSchema: schema
    });
    const aiConfidence = confidence(result.confidence);
    logAi({ aiCallType, aiConfidence, finalIntent: text(result.domain, 100), success: true });
    return sendJson(res, 200, {
      success: true,
      answer: text(result.answer, 2500),
      items: Array.isArray(result.items) ? result.items.slice(0, 40).map(item => ({
        label: text(item?.label, 300),
        detail: text(item?.detail, 700)
      })).filter(item => item.label) : [],
      domain: text(result.domain, 100),
      confidence: aiConfidence,
      groundedInContext: Boolean(result.groundedInContext),
      note: text(result.note, 800),
      quota: quotaState.quota
    });
  } catch (error) {
    console.error(error);
    logAi({ aiCallType, success: false });
    return sendJson(res, 503, { success: false, error: "AI-assisted search is temporarily unavailable.", quota: quotaState.quota });
  }
};
