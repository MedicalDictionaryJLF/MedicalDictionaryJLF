"use strict";

const { callGemini, confidence, logAi, readBody, sendJson, text } = require("./_gemini");

const schema = {
  type: "OBJECT",
  properties: {
    resolvedQuestion: { type: "STRING" },
    confidence: { type: "NUMBER" }
  },
  required: ["resolvedQuestion", "confidence"]
};

module.exports = async function handler(req, res) {
  const aiCallType = "context-resolve";
  if (req.method !== "POST") return sendJson(res, 405, { success: false, error: "Method not allowed." });

  const body = readBody(req);
  const question = text(body?.question);
  const conversation = Array.isArray(body?.conversation)
    ? body.conversation.slice(-10).map(item => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      text: text(item?.text, 1500)
    })).filter(item => item.text)
    : [];

  if (!question) {
    logAi({ aiCallType, success: false });
    return sendJson(res, 400, { success: false, error: "question is required." });
  }

  try {
    const result = await callGemini({
      systemInstruction: "Rewrite the final question as a standalone question by resolving pronouns and references from the supplied conversation. Preserve meaning. Do not answer the question and do not add facts.",
      prompt: JSON.stringify({ conversation, question }),
      responseSchema: schema
    });
    const resolvedQuestion = text(result.resolvedQuestion);
    const aiConfidence = confidence(result.confidence);
    logAi({ aiCallType, aiConfidence, success: true });
    return sendJson(res, 200, { success: true, resolvedQuestion: resolvedQuestion || question, confidence: aiConfidence });
  } catch (error) {
    console.error(error);
    logAi({ aiCallType, success: false });
    return sendJson(res, 503, { success: false, error: "Context resolution is temporarily unavailable." });
  }
};
