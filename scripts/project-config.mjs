import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const DIST_DIRECTORY = resolve(REPOSITORY_ROOT, "dist");
export const ARTIFACTS_DIRECTORY = resolve(REPOSITORY_ROOT, ".artifacts");

export const SUPPORTED_ROUTES = [
  "menu",
  "main",
  "search",
  "entry",
  "quiz",
  "flashcards",
  "courses",
  "muscles",
  "lab-parameters",
  "pharmacology",
  "latin-terminology",
  "biophysics",
  "feedback",
  "anamnesis",
  "anamnesis-training",
];

export const SHELL_ROUTES = SUPPORTED_ROUTES.filter(
  (route) => route !== "anamnesis-training",
);

export const REQUIRED_API_FILES = [
  "api/_cors.js",
  "api/_gemini.js",
  "api/ai-health.js",
  "api/context-resolve.js",
  "api/intent-rescue.js",
  "api/learning-events.js",
  "api/patient-phrasing.js",
];

export const REQUIRED_ANAMNESIS_ASSETS = [
  "anamnesis-training/styles.css",
  "anamnesis-training/patient-avatar.svg",
  "anamnesis-training/ECGs/peter_novak_ecg.png",
];

export const ROUTE_MARKERS = Object.fromEntries(
  SUPPORTED_ROUTES.map((route) => [
    route,
    route === "anamnesis-training"
      ? "Anamnesis Avatar Trainer"
      : "Medical Dictionary",
  ]),
);
