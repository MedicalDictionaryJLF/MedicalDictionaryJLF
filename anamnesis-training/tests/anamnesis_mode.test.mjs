import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAnamnesisCompanionAreas } from '../src/ui/anamnesisCompanion.js';
import { peterNovak } from '../src/cases/peterNovak.js';
import { janaKovacova } from '../src/cases/janaKovacova.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const trainerRoot = path.resolve(here, '..');
const projectRoot = path.resolve(trainerRoot, '..');
const read = (p) => fs.readFileSync(p, 'utf8');

const maleAreas = getAnamnesisCompanionAreas(peterNovak);
const femaleAreas = getAnamnesisCompanionAreas(janaKovacova);
assert.equal(maleAreas.some((area) => area.id === 'gynecological'), false, 'Male overview must omit gynecological history');
assert.equal(femaleAreas.some((area) => area.id === 'gynecological'), true, 'Female overview must include gynecological history');
assert.equal(maleAreas.some((area) => area.id === 'objective'), false, 'Anamnesis-only overview must omit objective/exam area');
assert.equal(femaleAreas.some((area) => area.id === 'objective'), false, 'Anamnesis-only overview must omit objective/exam area');

const html = read(path.join(trainerRoot, 'index.html'));
const main = read(path.join(trainerRoot, 'src/main.js'));
const css = read(path.join(trainerRoot, 'styles.css'));
const appCss = read(path.join(projectRoot, 'assets/css/app.css'));

assert.match(html, /data-trainer-experience="anamnesis"/, 'Anamnesis-only mode must exist in setup');
assert.match(html, /data-trainer-experience="full"/, 'Full encounter preview must exist in setup');
assert.match(html, /Under development/, 'Full encounter must be visibly marked under development');
assert.match(html, /data-companion-view="overview"/, 'Broad topic overview must exist');
assert.match(html, /data-companion-view="worksheet"/, 'Built-in worksheet must exist');
assert.match(main, /query\.get\('dev'\) === '1'/, 'Developer bypass must be explicit and query controlled');
assert.match(main, /trainerExperience === 'anamnesis' \? 'interview' : requested/, 'Anamnesis mode must force interview-only workspace');
assert.match(css, /data-trainer-experience="anamnesis"[^}]*\.encounter-stepbar/s, 'Anamnesis CSS must remove clinical stepbar');
assert.match(css, /\.pt-shell-sidebar\{[\s\S]*?z-index:92/, 'Integrated trainer sidebar must sit above page content');
assert.match(appCss, /@media\(max-width:899px\)[\s\S]*?\.app-sidebar\{z-index:74!important;\}[\s\S]*?\.sidebar-scrim\{z-index:73!important;\}/, 'Main app mobile sidebar must remain above its scrim');

console.log(`Patient Trainer anamnesis-mode regression: PASS (${maleAreas.length} male sections, ${femaleAreas.length} female sections)`);
