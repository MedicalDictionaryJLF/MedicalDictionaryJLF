async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({ success: false, error: "Invalid server response." }));
  if (!response.ok) throw new Error(payload.error || "AI helper request failed.");
  return payload;
}

export function resolveIntentWithAI(question, intents) {
  return postJson("/api/intent-rescue", { question, intents });
}

export function resolveContextWithAI(question, conversation = [], context = {}, intents = []) {
  return postJson("/api/context-resolve", { question, conversation, context, intents });
}

export function rewritePatientAnswer(deterministicAnswer, audience = "patient") {
  return postJson("/api/patient-phrasing", { deterministicAnswer, audience });
}
