"use strict";

const fs = require("node:fs");
const path = require("node:path");

const requiredFiles = [
  "api/_gemini.js",
  "api/intent-rescue.js",
  "api/context-resolve.js",
  "api/patient-phrasing.js",
  "src/ai/client.js"
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(process.cwd(), file))) {
    throw new Error(`Missing required file: ${file}`);
  }
}

console.log("Static Vercel build validation passed.");
