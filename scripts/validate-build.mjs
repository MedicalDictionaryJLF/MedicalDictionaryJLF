import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { TERMINOLOGY_SOURCES } from "../assets/js/services/data-repository.js";
import { PHARMACOLOGY_DATA_PATH } from "../assets/js/pharmacology/pharmacology-service.js";
import {
  ARTIFACTS_DIRECTORY,
  DIST_DIRECTORY,
  ROUTE_MARKERS,
  SUPPORTED_ROUTES,
} from "./project-config.mjs";
import {
  extractHtmlReferences,
  isExternalReference,
  resolveLocalReference,
  stripUrlDecorations,
  toPosixPath,
  walkFiles,
} from "./lib/file-references.mjs";

const failures = [];
const checkedReferences = [];
const configuredBase = String(process.env.VITE_BASE_PATH || "").trim();

function normalizeConfiguredBaseReference(reference) {
  if (!configuredBase || configuredBase === "./") return reference;
  const base = `/${configuredBase.replace(/^\/+|\/+$/g, "")}/`;
  return String(reference).startsWith(base)
    ? `/${String(reference).slice(base.length)}`
    : reference;
}

function fail(validation, affected, expected) {
  failures.push({ validation, affected, expected });
}

const rootEntry = resolve(DIST_DIRECTORY, "index.html");
if (!existsSync(rootEntry))
  fail("root build entry", "dist/index.html", "file must exist");

for (const route of SUPPORTED_ROUTES) {
  const entry = resolve(DIST_DIRECTORY, route, "index.html");
  if (!existsSync(entry)) {
    fail("route build entry", route, `dist/${route}/index.html must exist`);
    continue;
  }
  const html = readFileSync(entry, "utf8");
  if (!html.includes(ROUTE_MARKERS[route])) {
    fail(
      "route application marker",
      `dist/${route}/index.html`,
      `HTML must contain "${ROUTE_MARKERS[route]}"`,
    );
  }
}

const outputFiles = walkFiles(DIST_DIRECTORY);
const htmlFiles = outputFiles.filter((file) => file.endsWith(".html"));
const javaScriptFiles = outputFiles.filter((file) => file.endsWith(".js"));
const cssFiles = outputFiles.filter((file) => file.endsWith(".css"));
if (javaScriptFiles.length === 0)
  fail("built JavaScript", "dist/", "at least one .js asset must exist");
if (cssFiles.length === 0)
  fail("built CSS", "dist/", "at least one .css asset must exist");

for (const htmlFile of htmlFiles) {
  const html = readFileSync(htmlFile, "utf8");
  for (const reference of extractHtmlReferences(html)) {
    if (isExternalReference(reference)) continue;
    const target = resolveLocalReference(
      normalizeConfiguredBaseReference(reference),
      htmlFile,
      DIST_DIRECTORY,
    );
    if (!target) continue;
    checkedReferences.push({ source: htmlFile, reference, target });
    if (!existsSync(target) || !statSync(target).isFile()) {
      fail(
        "generated HTML local asset",
        `${toPosixPath(relative(DIST_DIRECTORY, htmlFile))} -> ${reference}`,
        `${toPosixPath(relative(DIST_DIRECTORY, target))} must be a file`,
      );
    }
  }
}

const cssUrlPattern = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
for (const cssFile of cssFiles) {
  const css = readFileSync(cssFile, "utf8");
  for (const match of css.matchAll(cssUrlPattern)) {
    const reference = match[1];
    if (isExternalReference(reference)) continue;
    const normalizedReference = normalizeConfiguredBaseReference(reference);
    const cleaned = stripUrlDecorations(normalizedReference);
    const target = cleaned.startsWith("/")
      ? resolve(DIST_DIRECTORY, cleaned.replace(/^\/+/, ""))
      : resolve(dirname(cssFile), cleaned);
    if (!existsSync(target)) {
      fail(
        "generated CSS local asset",
        `${toPosixPath(relative(DIST_DIRECTORY, cssFile))} -> ${reference}`,
        `${toPosixPath(relative(DIST_DIRECTORY, target))} must exist`,
      );
    }
  }
}

for (const source of TERMINOLOGY_SOURCES) {
  const outputPath = resolve(DIST_DIRECTORY, "data", source.path);
  if (!existsSync(outputPath)) {
    fail(
      "built terminology dataset",
      source.path,
      `dist/data/${source.path} must exist`,
    );
  }
}
if (!existsSync(resolve(DIST_DIRECTORY, "data", PHARMACOLOGY_DATA_PATH))) {
  fail(
    "built pharmacology dataset",
    PHARMACOLOGY_DATA_PATH,
    `dist/data/${PHARMACOLOGY_DATA_PATH} must exist`,
  );
}

for (const requiredAssetName of ["patient-avatar", "peter_novak_ecg"]) {
  if (!outputFiles.some((file) => basename(file).includes(requiredAssetName))) {
    fail(
      "built anamnesis asset",
      requiredAssetName,
      "a corresponding emitted file must exist in dist/",
    );
  }
}

const secretPatterns = [
  [
    "server environment variable name",
    /\b(?:GEMINI_API_KEY|GOOGLE_PRIVATE_KEY|GOOGLE_SERVICE_ACCOUNT_EMAIL)\b/,
  ],
  ["private key material", /-----BEGIN (?:RSA )?PRIVATE KEY-----/],
  ["Google API key-like value", /\bAIza[0-9A-Za-z_-]{35}\b/],
];
for (const frontendFile of [...htmlFiles, ...javaScriptFiles, ...cssFiles]) {
  const contents = readFileSync(frontendFile, "utf8");
  for (const [description, pattern] of secretPatterns) {
    if (pattern.test(contents)) {
      fail(
        "frontend credential scan",
        toPosixPath(relative(DIST_DIRECTORY, frontendFile)),
        `file must not contain ${description}`,
      );
    }
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  outputDirectory: "dist",
  routes: SUPPORTED_ROUTES.length + 1,
  htmlFiles: htmlFiles.length,
  javaScriptFiles: javaScriptFiles.length,
  cssFiles: cssFiles.length,
  outputFiles: outputFiles.length,
  localHtmlReferencesChecked: checkedReferences.length,
  failures,
};
mkdirSync(ARTIFACTS_DIRECTORY, { recursive: true });
writeFileSync(
  resolve(ARTIFACTS_DIRECTORY, "build-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);

if (failures.length) {
  console.error(
    `Build output validation failed with ${failures.length} error(s):`,
  );
  for (const item of failures) {
    console.error(
      `- ${item.validation}: ${item.affected}; expected ${item.expected}.`,
    );
  }
  process.exitCode = 1;
} else {
  console.log(
    `Build output validation passed: ${summary.routes} entries, ${summary.outputFiles} files, ${summary.localHtmlReferencesChecked} local HTML references.`,
  );
}
