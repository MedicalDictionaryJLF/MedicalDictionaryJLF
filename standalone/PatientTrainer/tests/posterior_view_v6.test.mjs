import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PATIENT_VIEW_ASSETS, getPatientViewAsset } from '../src/ui/interactivePhysicalExam.v6.js';
import { getPhysicalExamMap } from '../src/data/physicalExamMap.v6.js';

const frontPath = fileURLToPath(PATIENT_VIEW_ASSETS.front);
const backPath = fileURLToPath(PATIENT_VIEW_ASSETS.back);
assert.ok(fs.existsSync(frontPath), 'front patient image exists');
assert.ok(fs.existsSync(backPath), 'posterior patient image exists');
assert.notEqual(frontPath, backPath, 'front and posterior image are distinct assets');
assert.equal(getPatientViewAsset('back'), PATIENT_VIEW_ASSETS.back);

const map = getPhysicalExamMap({ id:'chest_pain_acs_risk' });
const posterior = map.hotspots.filter(p => p.view === 'back');
assert.ok(posterior.length >= 7, 'posterior examination has mapped targets');
assert.ok(posterior.filter(p => p.tools.includes('auscultate')).length >= 6, 'posterior auscultation has lung points');
assert.ok(posterior.filter(p => p.tools.includes('percuss')).length >= 6, 'posterior percussion has lung points');

const uiSource = fs.readFileSync(new URL('../src/ui/interactivePhysicalExam.v6.js', import.meta.url), 'utf8');
assert.match(uiSource, /data-patient-view-image=\"front\"/);
assert.match(uiSource, /data-patient-view-image=\"back\"/);
assert.match(uiSource, /applyPatientViewImmediately/);
assert.match(uiSource, /peter_novak_back_52_v6\.png/);

console.log('✓ posterior view v6 assets and switch path verified');
