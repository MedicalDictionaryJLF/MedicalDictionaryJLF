import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSVLines, rowsToObjects } from '../assets/js/services/csv-utils.js';
import { buildAnatomyStructureIndex, getStructureTerm } from '../assets/js/anatomy/anatomy-structure-service.js';
import { createPharmacologyService } from '../assets/js/pharmacology/pharmacology-service.js';
import {
  resolveAnatomyCollectionQuestion,
  resolveMuscleActionQuestion,
  resolvePharmacologyListQuestion
} from '../assets/js/search/smart-search.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = relative => fs.readFile(path.join(root, relative), 'utf8');

const muscles = rowsToObjects(parseCSVLines(await read('data/terminology/muscles.csv')));
const anatomy = JSON.parse(await read('data/anatomy/anatomy_structures_core_elaborated.json'));
const anatomyIndex = buildAnatomyStructureIndex(anatomy);

const abductors = resolveMuscleActionQuestion('What are the abductors of the arm?', muscles);
assert.ok(abductors, 'arm abductor question should resolve locally');
assert.equal(abductors.source, 'internal');
const abductorNames = abductors.items.map(item => item.label);
assert.ok(abductorNames.includes('Deltoid muscle'), 'deltoid should be identified as an arm abductor');
assert.ok(abductorNames.includes('Supraspinatus muscle'), 'supraspinatus should be identified as an arm abductor');
assert.deepEqual(abductorNames, [...abductorNames].sort((a,b)=>a.localeCompare(b, undefined, { sensitivity:'base' })), 'muscle answer must be alphabetic');

const airways = resolveAnatomyCollectionQuestion(
  'What are the airways?',
  anatomyIndex.rows,
  muscles,
  record => getStructureTerm(record, 'en') || getStructureTerm(record, 'la') || record?.id || ''
);
assert.ok(airways, 'airway collection question should resolve locally');
assert.ok(airways.items.length >= 1, 'airway answer should contain structures');
assert.ok(airways.items.every(item => String(item.record?.type || '').toLowerCase() === 'airway'), 'airway answer should contain only airway structures');
const airwayNames = airways.items.map(item => item.label);
assert.deepEqual(airwayNames, [...airwayNames].sort((a,b)=>a.localeCompare(b, undefined, { sensitivity:'base' })), 'anatomy collection answer must be alphabetic');

const pharma = createPharmacologyService({
  loadText: async relative => read(`data/${relative}`),
  expectedRecordCount: 0,
  onError: error => { throw error; }
});
await pharma.ensureLoaded();
const searchFn = query => pharma.searchDrugs(query, {}, { mode:'drug', limit:120 }).map(result => ({
  kind:'pharmacology', row:result.record, score:result.score, matchedFields:result.matchedFields
}));

const ace = resolvePharmacologyListQuestion('What are ACE inhibitors?', searchFn);
assert.ok(ace, 'ACE inhibitor question should resolve from the pharmacology dataset');
assert.ok(ace.items.length > 0, 'ACE inhibitor answer should contain drugs');
assert.deepEqual(ace.items.map(i=>i.label), [...ace.items.map(i=>i.label)].sort((a,b)=>a.localeCompare(b, undefined, { sensitivity:'base' })), 'pharmacology answer must be alphabetic');

const thirdGenBeta = resolvePharmacologyListQuestion('What are the 3rd generation beta-blockers?', searchFn);
assert.equal(thirdGenBeta, null, 'generation question not encoded in the local dataset must fall through to AI instead of inventing an answer');

console.log(`Smart search tests passed: ${abductorNames.length} arm abductors, ${airwayNames.length} airways, ${ace.items.length} ACE-inhibitor matches, AI fallback preserved for 3rd-generation beta-blockers.`);
