"use strict";

const ALLOWED_ORIGINS = new Set([
  "https://medicaldictionaryjlf.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);

function applyCors(req, res, methods = "POST, OPTIONS") {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

function handleOptions(req, res, methods) {
  applyCors(req, res, methods);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }

  return false;
}

module.exports = {
  applyCors,
  handleOptions
};
