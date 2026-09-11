import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PATIENT_CASES } from '../anamnesis-training/src/patientCase.js';
import { getExaminationActions, createEncounterState } from '../anamnesis-training/src/clinicalEncounter.js';
import { labsForGroup } from '../anamnesis-training/src/ui/actionPanels.js';

const html = readFileSync(new URL('../anamnesis-training/index.html', import.meta.url), 'utf8');
for (const marker of ['Interview', 'Examine', 'Investigations', 'Reasoning', 'Handover']) assert.ok(html.includes(marker), `Missing workspace ${marker}`);
for (const id of ['encounterOverview', 'actionHistoryPanel', 'examinationPanel', 'labsPanel', 'medicationPanel', 'clinicalNotesPanel', 'differentialPanel', 'closingPanel']) assert.ok(html.includes(`id="${id}"`), `Missing ${id}`);

const chest = PATIENT_CASES.find((item) => item.id === 'chest_pain_acs_risk');
assert.ok(chest, 'Chest pain case must exist');
assert.match(chest.stationBrief.task, /examination/i);
assert.match(chest.ecg.interpretation, /inferior STEMI/i);
assert.match(chest.labs.hsTroponinT, /184 ng\/L/i);
assert.match(chest.exam.chestWall, /does not reproduce/i);
assert.match(chest.exam.legs, /no unilateral calf swelling/i);

const exams = getExaminationActions(chest, createEncounterState());
for (const examId of ['general', 'perfusion', 'cardiovascular', 'pulses', 'respiratory', 'chestWall', 'legs']) assert.ok(exams.some((item) => item.id === examId), `Missing enhanced exam ${examId}`);
assert.ok(exams.filter((item) => item.required).length >= 5, 'Enhanced ACS case should require a focused five-part exam');

const cardiac = labsForGroup('cardiac_biomarkers', chest);
assert.ok(cardiac.hsTroponinT, 'Cardiac biomarker order must reveal deterministic troponin');
const renal = labsForGroup('renal_electrolytes', chest);
for (const key of ['creatinine', 'egfr', 'sodium', 'potassium', 'magnesium']) assert.ok(renal[key], `Missing ${key}`);

console.log('Patient Trainer UI 1.10 tests: PASS');
