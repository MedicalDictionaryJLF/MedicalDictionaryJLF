import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";

export function toPosixPath(value) {
  return String(value).split(sep).join("/");
}

export function walkFiles(directory, predicate = () => true) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (
        ![".git", ".artifacts", "coverage", "dist", "node_modules"].includes(
          entry.name,
        )
      ) {
        files.push(...walkFiles(fullPath, predicate));
      }
      continue;
    }
    if (predicate(fullPath)) files.push(fullPath);
  }
  return files;
}

export function stripUrlDecorations(value) {
  return decodeURIComponent(
    String(value || "")
      .split("#", 1)[0]
      .split("?", 1)[0],
  );
}

export function isExternalReference(value) {
  return /^(?:[a-z]+:|\/\/|#)/i.test(String(value || ""));
}

export function extractHtmlReferences(html) {
  const references = [];
  const pattern = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(pattern)) references.push(match[1]);
  return references;
}

export function resolveLocalReference(reference, sourceFile, rootDirectory) {
  if (!reference || isExternalReference(reference)) return null;
  const cleaned = stripUrlDecorations(reference);
  if (!cleaned) return null;
  return cleaned.startsWith("/")
    ? resolve(rootDirectory, cleaned.replace(/^\/+/, ""))
    : resolve(dirname(sourceFile), cleaned);
}

export function findMissingHtmlReferences(htmlFiles, rootDirectory) {
  const missing = [];
  for (const htmlFile of htmlFiles) {
    const html = readFileSync(htmlFile, "utf8");
    for (const reference of extractHtmlReferences(html)) {
      const target = resolveLocalReference(reference, htmlFile, rootDirectory);
      if (target && !existsSync(target)) {
        missing.push({
          source: toPosixPath(relative(rootDirectory, htmlFile)),
          reference,
          expected: toPosixPath(relative(rootDirectory, target)),
        });
      }
    }
  }
  return missing;
}

export function findMissingJavaScriptReferences(
  javaScriptFiles,
  rootDirectory,
) {
  const missing = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\bnew\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g,
  ];

  for (const sourceFile of javaScriptFiles) {
    const source = readFileSync(sourceFile, "utf8");
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const specifier = stripUrlDecorations(match[1]);
        if (!specifier.startsWith(".")) continue;
        const unresolved = resolve(dirname(sourceFile), specifier);
        const candidates = [
          unresolved,
          `${unresolved}.js`,
          `${unresolved}.mjs`,
          `${unresolved}.json`,
          resolve(unresolved, "index.js"),
        ];
        if (!candidates.some(existsSync)) {
          missing.push({
            source: toPosixPath(relative(rootDirectory, sourceFile)),
            reference: match[1],
            expected: toPosixPath(relative(rootDirectory, unresolved)),
          });
        }
      }
    }
  }
  return missing;
}

export function isJavaScriptFile(file) {
  return [".js", ".mjs"].includes(extname(file));
}
