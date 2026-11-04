/** Refresh patient/combined Khronos rows; keep unrelated room rows unchanged. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const validator = require('gltf-validator');
const args = process.argv.slice(2);
const arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const root = arg('--assets', 'anamnesis-training/assets/3d/clinical');
const report = arg('--report', 'tools/character-pipeline/asset-validation.json');
const folders = arg('--folders', 'patients,scenes').split(',');
const rows = JSON.parse(fs.readFileSync(report, 'utf8'));
let failed = false;
for (const row of rows) {
  if (!folders.includes(row.folder)) continue;
  const file = path.join(root, row.folder, row.name);
  const data = fs.readFileSync(file);
  const result = await validator.validateBytes(new Uint8Array(data), { uri: row.name, maxIssues: 10000 });
  Object.assign(row, {
    bytes: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    errors: result.issues.numErrors,
    warnings: result.issues.numWarnings,
    infos: result.issues.numInfos,
    messages: result.issues.messages
  });
  failed ||= row.errors > 0 || row.warnings > 0;
  console.log(`${row.folder}/${row.name}: ${row.errors} errors, ${row.warnings} warnings, ${row.infos} infos`);
}
fs.writeFileSync(report, JSON.stringify(rows, null, 2) + '\n');
if (failed) process.exitCode = 1;
