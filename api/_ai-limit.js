"use strict";

const crypto = require("node:crypto");

const memoryCounters = new Map();

function envInt(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function hmacSecret() {
  return String(process.env.AI_SESSION_SECRET || process.env.GEMINI_API_KEY || "medical-dictionary-ai-session-dev");
}

function signPayload(payloadText) {
  return crypto.createHmac("sha256", hmacSecret()).update(payloadText).digest("base64url");
}

function issueAiSessionToken(subject, ttlSeconds = 60 * 60 * 12) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: String(subject || "").slice(0, 160),
    tier: "user",
    iat: now,
    exp: now + Math.max(900, Number(ttlSeconds) || 0)
  };
  const encoded = base64Url(JSON.stringify(payload));
  return `${encoded}.${signPayload(encoded)}`;
}

function verifyAiSessionToken(token) {
  const raw = String(token || "");
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  const expected = signPayload(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload?.sub || payload?.tier !== "user") return null;
    if (Number(payload.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function requestIp(req) {
  const forwarded = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(req?.headers?.["x-real-ip"] || req?.socket?.remoteAddress || "unknown").trim();
}

function shortHash(value) {
  // Keyed hashing prevents raw IP/email hashes in the rate-limit store from
  // becoming an easy offline lookup table if the store is ever inspected.
  return crypto.createHmac("sha256", hmacSecret()).update(String(value || "")).digest("hex").slice(0, 32);
}

function sanitizeVisitorId(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96) || "no-visitor";
}

function windowKey(prefix, subject, windowMs) {
  return `${prefix}:${Math.floor(Date.now() / windowMs)}:${subject}`;
}

function memoryIncrement(key, ttlSeconds) {
  const now = Date.now();
  const current = memoryCounters.get(key);
  if (!current || current.expiresAt <= now) {
    memoryCounters.set(key, { value: 1, expiresAt: now + ttlSeconds * 1000 });
    return Promise.resolve(1);
  }
  current.value += 1;
  return Promise.resolve(current.value);
}

async function redisCommand(command) {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, "");
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || "");
  if (!url || !token) return null;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(3500)
  });
  if (!response.ok) throw new Error(`Rate-limit store returned ${response.status}.`);
  const payload = await response.json();
  return payload?.result;
}

async function incrementCounter(key, ttlSeconds) {
  try {
    const result = await redisCommand(["INCR", key]);
    if (result !== null) {
      const count = Number(result) || 0;
      if (count === 1) await redisCommand(["EXPIRE", key, String(ttlSeconds)]);
      return { count, durable: true };
    }
  } catch (error) {
    console.warn("AI rate-limit durable store unavailable; using process-local fallback.", error?.message || error);
  }
  return { count: await memoryIncrement(key, ttlSeconds), durable: false };
}

function secondsUntilNextWindow(windowMs) {
  const now = Date.now();
  return Math.max(1, Math.ceil((windowMs - (now % windowMs)) / 1000));
}

async function consumeAiQuota({ req, body, aiCallType = "ai" }) {
  const context = body?.clientContext && typeof body.clientContext === "object" ? body.clientContext : {};
  const session = verifyAiSessionToken(context.sessionToken);
  const ip = requestIp(req);
  const ipHash = shortHash(ip);
  const visitorId = sanitizeVisitorId(context.visitorId);
  const tier = session ? "user" : "anonymous";
  const subject = session ? `user:${session.sub}` : `anon:${ipHash}:${visitorId}`;

  const dailyLimit = tier === "user" ? envInt("AI_DAILY_LIMIT_USER", 60) : envInt("AI_DAILY_LIMIT_ANON", 20);
  const hourlyLimit = tier === "user" ? envInt("AI_HOURLY_LIMIT_USER", 30) : envInt("AI_HOURLY_LIMIT_ANON", 10);
  const ipDailyLimit = envInt("AI_DAILY_LIMIT_IP", 120);
  const DAY_MS = 24 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;

  const [day, hour, ipDay] = await Promise.all([
    incrementCounter(windowKey("ai:day", subject, DAY_MS), secondsUntilNextWindow(DAY_MS) + 60),
    incrementCounter(windowKey("ai:hour", subject, HOUR_MS), secondsUntilNextWindow(HOUR_MS) + 60),
    incrementCounter(windowKey("ai:ipday", ipHash, DAY_MS), secondsUntilNextWindow(DAY_MS) + 60)
  ]);

  const allowed = day.count <= dailyLimit && hour.count <= hourlyLimit && ipDay.count <= ipDailyLimit;
  const resetAt = new Date(Date.now() + Math.min(secondsUntilNextWindow(HOUR_MS), secondsUntilNextWindow(DAY_MS)) * 1000).toISOString();
  const quota = {
    tier,
    aiCallType,
    daily: { used: day.count, limit: dailyLimit, remaining: Math.max(0, dailyLimit - day.count) },
    hourly: { used: hour.count, limit: hourlyLimit, remaining: Math.max(0, hourlyLimit - hour.count) },
    resetAt,
    durable: Boolean(day.durable && hour.durable && ipDay.durable)
  };
  return { allowed, quota, session };
}

function sendQuotaExceeded(res, sendJson, quota) {
  return sendJson(res, 429, {
    success: false,
    error: "AI assistance limit reached. Local deterministic features remain available.",
    code: "AI_QUOTA_EXCEEDED",
    quota
  });
}

module.exports = {
  consumeAiQuota,
  issueAiSessionToken,
  sendQuotaExceeded,
  verifyAiSessionToken,
  shortHash
};
