import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import {
  DIST_DIRECTORY,
  ROUTE_MARKERS,
  SUPPORTED_ROUTES,
} from "./project-config.mjs";
import { walkFiles } from "./lib/file-references.mjs";

const REPOSITORY_BASE = "/MedicalDictionaryJLF";
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function safeFileForRequest(requestPath) {
  let pathname = decodeURIComponent(
    new URL(requestPath, "http://localhost").pathname,
  );
  if (pathname === REPOSITORY_BASE) pathname = "/";
  else if (pathname.startsWith(`${REPOSITORY_BASE}/`))
    pathname = pathname.slice(REPOSITORY_BASE.length);
  const normalized = pathname.replace(/^\/+/, "");
  let file = resolve(DIST_DIRECTORY, normalized);
  if (!file.startsWith(`${DIST_DIRECTORY}${sep}`) && file !== DIST_DIRECTORY)
    return null;
  if (existsSync(file) && statSync(file).isDirectory())
    file = resolve(file, "index.html");
  if (!extname(file)) file = resolve(file, "index.html");
  return file;
}

const server = createServer((request, response) => {
  const file = safeFileForRequest(request.url || "/");
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type":
      MIME_TYPES[extname(file).toLowerCase()] || "application/octet-stream",
  });
  createReadStream(file).pipe(response);
});

const failures = [];
const requested = [];

async function request(pathname, expectedMarker = null) {
  const response = await fetch(`${origin}${pathname}`);
  const body = await response.text();
  requested.push(pathname);
  if (!response.ok)
    failures.push(
      `${pathname}: expected HTTP success, received ${response.status}`,
    );
  if (expectedMarker && !body.includes(expectedMarker)) {
    failures.push(`${pathname}: response did not contain "${expectedMarker}"`);
  }
}

await new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveListen);
});
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;

try {
  for (const prefix of ["", REPOSITORY_BASE]) {
    await request(`${prefix}/`, "Medical Dictionary");
    for (const route of SUPPORTED_ROUTES) {
      await request(`${prefix}/${route}/`, ROUTE_MARKERS[route]);
    }
  }

  const outputFiles = walkFiles(DIST_DIRECTORY);
  const criticalAssets = [
    outputFiles.find((file) => file.endsWith(".js")),
    outputFiles.find((file) => file.endsWith(".css")),
    outputFiles.find((file) => file.includes("patient-avatar")),
    outputFiles.find((file) => file.includes("peter_novak_ecg")),
    resolve(DIST_DIRECTORY, "data/terminology/anatomy.csv"),
    resolve(DIST_DIRECTORY, "data/pharmacology_database_test.json"),
  ].filter(Boolean);
  for (const file of criticalAssets) {
    const relativePath = file.slice(DIST_DIRECTORY.length).split(sep).join("/");
    await request(relativePath);
    await request(`${REPOSITORY_BASE}${relativePath}`);
  }
} finally {
  await new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

if (failures.length) {
  console.error(`Static smoke tests failed with ${failures.length} error(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Static smoke tests passed: ${requested.length} requests across root and ${REPOSITORY_BASE}/ hosting.`,
  );
}
