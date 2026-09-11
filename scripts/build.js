"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const requiredFiles = [
  "api/_gemini.js",
  "api/_cors.js",
  "api/_ai-limit.js",
  "api/ai-session.js",
  "api/search-answer.js",
  "api/intent-rescue.js",
  "api/context-resolve.js",
  "api/patient-phrasing.js",
  "api/ai-health.js",
  "api/learning-events.js",
  "src/ai/client.js",
  "anamnesis-training/index.html",
  "anamnesis-training/styles.css",
  "anamnesis-training/src/main.js",
  "anamnesis-training/src/aiSupport.js",
  "anamnesis-training/patient-avatar.svg",
  "anamnesis-training/ECGs/peter_novak_ecg.png",
  "data/anatomy/anatomy_structures_core_elaborated.json",
  "data/anatomy/anatomy_structures_core_elaborated_flat.csv",
  "scripts/anatomy-data-validator.mjs",
  "data/anatomy/anatomy_structures_question_bank_seed.json",
  "data/anatomy/anatomy_structures_question_bank_generated.json",
  "data/anatomy/anatomy_structures_question_bank_generated_flat.csv",
  "scripts/generate-anatomy-questions.mjs",
  "data/anatomy/anatomy_structures_oral_rubrics_seed.json",
  "data/anatomy/anatomy_structures_clinical_bridges_seed.json",
  "data/anatomy/clinical_correlations_logic.json",
  "data/anatomy/clinical_correlations_flat.csv",
  "data/schemas/anatomy_structures_v2.schema.json",
  "data/schemas/clinical_correlations.schema.json",
  "assets/js/anatomy/anatomy-structure-service.js",
  "assets/js/search/smart-search.js",
  "assets/js/anatomy/clinical-correlation-service.js"
];

execFileSync(process.execPath, ["scripts/generate-anatomy-questions.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["scripts/anatomy-data-validator.mjs"], { stdio: "inherit" });

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(process.cwd(), file))) {
    throw new Error(`Missing required file: ${file}`);
  }
}

console.log("Static Vercel build validation passed.");
