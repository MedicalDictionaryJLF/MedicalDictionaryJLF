import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DIST_DIRECTORY, REPOSITORY_ROOT } from "./project-config.mjs";

if (!existsSync(DIST_DIRECTORY)) {
  throw new Error(
    "Cannot copy static assets because dist/ does not exist. Run Vite first.",
  );
}

const copies = [
  [resolve(REPOSITORY_ROOT, "data"), resolve(DIST_DIRECTORY, "data")],
];

for (const [source, destination] of copies) {
  if (!existsSync(source))
    throw new Error(`Required static source does not exist: ${source}`);
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true, force: true });
}

console.log("Copied bundled datasets into dist/data.");
