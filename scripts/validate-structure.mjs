import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PHARMACOLOGY_DATA_PATH } from "../assets/js/pharmacology/pharmacology-service.js";
import { TERMINOLOGY_SOURCES } from "../assets/js/services/data-repository.js";
import {
  REQUIRED_ANAMNESIS_ASSETS,
  REQUIRED_API_FILES,
  REPOSITORY_ROOT,
  SHELL_ROUTES,
  SUPPORTED_ROUTES,
} from "./project-config.mjs";
import {
  findMissingHtmlReferences,
  findMissingJavaScriptReferences,
  isJavaScriptFile,
  toPosixPath,
  walkFiles,
} from "./lib/file-references.mjs";

const failures = [];
const notes = [];
const allowedDatasetStatuses = new Set(["active", "planned"]);
const requiredFiles = [
  "index.html",
  "package.json",
  "package-lock.json",
  "vite.config.mjs",
  "api/package.json",
  "assets/js/app.js",
  "assets/js/route-loader.js",
  "assets/js/core/app-paths.js",
  "src/ai/client.js",
  "anamnesis-training/index.html",
  "anamnesis-training/src/main.js",
  "anamnesis-training/src/patientCase.js",
  "anamnesis-training/src/simulationRunner.js",
  ...REQUIRED_API_FILES,
  ...REQUIRED_ANAMNESIS_ASSETS,
  ...SUPPORTED_ROUTES.map((route) => `${route}/index.html`),
];

function fail(validation, affected, expected) {
  failures.push({ validation, affected, expected });
}

for (const file of requiredFiles) {
  if (!existsSync(resolve(REPOSITORY_ROOT, file))) {
    fail("required repository file", file, "file must exist");
  }
}

for (const source of TERMINOLOGY_SOURCES) {
  const relativePath = `data/${source.path}`;
  const status = source.status ?? "active";
  if (!allowedDatasetStatuses.has(status)) {
    fail(
      "declared terminology dataset status",
      `${source.key}: ${String(status)}`,
      'status must be "active" or "planned"',
    );
  }
  if (!existsSync(resolve(REPOSITORY_ROOT, relativePath))) {
    fail(
      "declared terminology dataset",
      `${source.key}: ${relativePath}`,
      "declared source path must reference a readable repository file",
    );
  }
}

const pharmacologyPath = `data/${PHARMACOLOGY_DATA_PATH}`;
if (!existsSync(resolve(REPOSITORY_ROOT, pharmacologyPath))) {
  fail(
    "declared pharmacology dataset",
    pharmacologyPath,
    "PHARMACOLOGY_DATA_PATH must reference a repository JSON file",
  );
}

const routeSourcePath = resolve(REPOSITORY_ROOT, "assets/js/core/app-paths.js");
if (existsSync(routeSourcePath)) {
  const routeSource = readFileSync(routeSourcePath, "utf8");
  const objectBody = routeSource.match(
    /export\s+const\s+SCREEN_ROUTE_MAP\s*=\s*{([\s\S]*?)};/,
  )?.[1];
  if (!objectBody) {
    fail(
      "route definition parsing",
      "assets/js/core/app-paths.js",
      "SCREEN_ROUTE_MAP must remain a statically inspectable object literal",
    );
  } else {
    const pairs = [
      ...objectBody.matchAll(/["']([^"']+)["']\s*:\s*["']([^"']+)["']/g),
    ].map(([, screen, route]) => ({ screen, route }));
    const duplicateValues = (values) => [
      ...new Set(
        values.filter((value, index) => values.indexOf(value) !== index),
      ),
    ];
    for (const screen of duplicateValues(pairs.map((pair) => pair.screen))) {
      fail(
        "duplicate route key",
        screen,
        "each screen key must be declared once",
      );
    }
    for (const route of duplicateValues(pairs.map((pair) => pair.route))) {
      fail(
        "duplicate route-to-screen mapping",
        route,
        "each route must map to exactly one screen",
      );
    }
    const mappedRoutes = new Set(pairs.map((pair) => pair.route));
    for (const route of SHELL_ROUTES) {
      if (!mappedRoutes.has(route)) {
        fail(
          "supported route mapping",
          route,
          "route must appear in SCREEN_ROUTE_MAP",
        );
      }
    }
    for (const { route } of pairs) {
      if (!existsSync(resolve(REPOSITORY_ROOT, route, "index.html"))) {
        fail("route directory", route, `${route}/index.html must exist`);
      }
    }
    notes.push(`${pairs.length} route-to-screen mappings inspected`);
  }
}

const allFiles = walkFiles(
  REPOSITORY_ROOT,
  (file) =>
    !file.includes(`${resolve(REPOSITORY_ROOT, "node_modules")}\\`) &&
    !file.includes(`${resolve(REPOSITORY_ROOT, "dist")}\\`),
);
const htmlFiles = allFiles.filter((file) => file.endsWith(".html"));
for (const missing of findMissingHtmlReferences(htmlFiles, REPOSITORY_ROOT)) {
  fail(
    "HTML local asset reference",
    `${missing.source} -> ${missing.reference}`,
    `${missing.expected} must exist`,
  );
}

const javaScriptFiles = allFiles.filter(isJavaScriptFile);
for (const missing of findMissingJavaScriptReferences(
  javaScriptFiles,
  REPOSITORY_ROOT,
)) {
  fail(
    "JavaScript local import/reference",
    `${missing.source} -> ${missing.reference}`,
    `${missing.expected} (or a supported extension/index file) must exist`,
  );
}

const lockfiles = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
].filter((file) => existsSync(resolve(REPOSITORY_ROOT, file)));
if (lockfiles.length !== 1 || lockfiles[0] !== "package-lock.json") {
  fail(
    "authoritative dependency lockfile",
    lockfiles.join(", ") || "none",
    "exactly one package-lock.json must be present",
  );
}

if (failures.length) {
  console.error(
    `Repository structure validation failed with ${failures.length} error(s):`,
  );
  for (const item of failures) {
    console.error(
      `- ${item.validation}: ${item.affected}; expected ${item.expected}.`,
    );
  }
  process.exitCode = 1;
} else {
  console.log("Repository structure validation passed.");
  console.log(
    `${requiredFiles.length} required files, ${htmlFiles.length} HTML files, ${javaScriptFiles.length} JavaScript files, and ${TERMINOLOGY_SOURCES.length} declared terminology sources inspected.`,
  );
  for (const note of notes) console.log(`- ${note}`);
}
