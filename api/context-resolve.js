"use strict";

const { callGemini, confidence, logAi, readBody, sendJson, text } = require("./_gemini");

const schema = {
  type: "OBJECT",
  properties: {
    resolvedQuestion: { type: "STRING" },
    intent: { type: "STRING" },
    confidence: { type: "NUMBER" }
  },
  required: ["resolvedQuestion", "intent", "confidence"]
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
  const context = {
    lastMeaningfulIntent: text(body?.context?.lastMeaningfulIntent, 100),
    lastMeaningfulDomain: text(body?.context?.lastMeaningfulDomain, 100),
    activeSymptom: text(JSON.stringify(body?.context?.activeSymptom || {}), 500)
  };
  const intents = Array.isArray(body?.intents)
    ? body.intents.slice(0, 150).map(item => ({
      id: text(item?.id, 100),
      description: text(item?.description, 500)
    })).filter(item => item.id)
    : [];

  if (!question) {
    logAi({ aiCallType, success: false });
    return sendJson(res, 400, { success: false, error: "question is required." });
  }

  try {
    const result = await callGemini({
      systemInstruction: "Resolve the final contextual follow-up question. Rewrite it as a standalone question and select only one supplied intent id when a supplied intent clearly fits. Otherwise return intent as an empty string. Preserve meaning. Do not answer the question and do not add facts.",
      prompt: JSON.stringify({ conversation, context, question, intents }),
      responseSchema: schema
    });
    const resolvedQuestion = text(result.resolvedQuestion);
    const finalIntent = intents.some(item => item.id === result.intent) ? result.intent : null;
    const aiConfidence = confidence(result.confidence);
    logAi({ aiCallType, aiConfidence, finalIntent, success: true });
    return sendJson(res, 200, { success: true, resolvedQuestion: resolvedQuestion || question, intent: finalIntent, confidence: aiConfidence });
  } catch (error) {
    console.error(error);
    logAi({ aiCallType, success: false });
    return sendJson(res, 503, { success: false, error: "Context resolution is temporarily unavailable." });
  }
};
