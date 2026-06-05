"use strict";

const { applyCors, handleOptions } = require("./_cors");
const { callGemini, logAi, readBody, sendJson, text } = require("./_gemini");

const schema = {
  type: "OBJECT",
  properties: {
    answer: { type: "STRING" }
  },
  required: ["answer"]
};

module.exports = async function handler(req, res) {
  const aiCallType = "patient-phrasing";
  if (handleOptions(req, res, "POST, OPTIONS")) return;
  applyCors(req, res, "POST, OPTIONS");
  if (req.method !== "POST") return sendJson(res, 405, { success: false, error: "Method not allowed." });

  const body = readBody(req);
  const deterministicAnswer = text(body?.deterministicAnswer);
  const audience = text(body?.audience, 100) || "patient";
  if (!deterministicAnswer) {
    logAi({ aiCallType, success: false });
    return sendJson(res, 400, { success: false, error: "deterministicAnswer is required." });
  }

  try {
    const result = await callGemini({
      systemInstruction: "Rewrite the supplied deterministic answer in clear, natural language for the requested audience. Preserve every fact and limitation. Do not add advice, diagnosis, interpretation, examples, or facts. If a safe rewrite is not possible, return the original text unchanged.",
      prompt: JSON.stringify({ audience, deterministicAnswer }),
      responseSchema: schema
    });
    const answer = text(result.answer) || deterministicAnswer;
    logAi({ aiCallType, success: true });
    return sendJson(res, 200, { success: true, answer });
  } catch (error) {
    console.error(error);
    logAi({ aiCallType, success: false });
    return sendJson(res, 200, { success: false, answer: deterministicAnswer, error: "Patient phrasing is temporarily unavailable." });
  }
};
