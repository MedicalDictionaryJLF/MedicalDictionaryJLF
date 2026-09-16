import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATIENT_CASES } from '../src/cases/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const mainSource = fs.readFileSync(path.join(here, '../src/main.js'), 'utf8');

assert.ok(PATIENT_CASES.length >= 2, 'Expected at least two selectable cases');
assert.ok(PATIENT_CASES.every((item) => item?.id && item?.title), 'Every selectable case needs an id and title');
assert.doesNotMatch(mainSource, /filter\s*\(\s*\(item\)\s*=>\s*item\.id\s*===\s*['"]chest_pain_acs_risk['"]\s*\)/, 'Case selector must not whitelist Peter Novak only');

const ids = new Set(PATIENT_CASES.map((item) => item.id));
assert.equal(ids.size, PATIENT_CASES.length, 'Case ids must be unique');

console.log(`case-selection-regression: PASS (${PATIENT_CASES.length} cases available)`);
