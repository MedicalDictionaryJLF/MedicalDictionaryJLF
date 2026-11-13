import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('index.html');
const core = read('assets/js/app.js');
const ob = read('assets/js/anamnesis/obstetric.js');
const css = read('assets/css/app.css');
const contains = (text, fragment, message) => assert.ok(text.includes(fragment), message || 'Missing: ' + fragment);

for (const name of [
  'anamnesis-form-obstetric-wrap','anamnesis-obstetric-form',
  'data-anamnesis-workflow="obstetric"','value="obstetric"'
]) contains(html,name);

for (const name of [
  'getActiveAnamnesisForm','loadObstetricAnamnesisForm',
  'ensureObstetricAnamnesisFormBuilt','clearObstetricAnamnesisForm',
  'obstetric: mergeSharedFieldsIntoData',
  'obstetric: rawData.obstetric','obstetric: normalizedType',
  'applyObstetricLanguage','getAnamnesisReportFormValue(form, "ob_pathway")'
]) contains(core,name);

for (const name of [
  'ob_pathway','antenatal_lmp','antenatal_edd_clinical','antenatal_ga_weeks',
  'antenatal_membranes','antenatal_movements_change','post_delivery_mode',
  'post_delivery_date','post_bleeding_heavy','post_psychosis',
  'data-ob-when','prepareObstetricFormForData',
  'ob_preg_','ob_fetus_','ob_baby_','ob_visit_'
]) {
  // Repeater field names are generated from the stable type rather than literals.
  if(name.startsWith('ob_') && ['ob_preg_','ob_fetus_','ob_baby_','ob_visit_'].includes(name)) continue;
  contains(ob,name);
}
for (const name of ["preg:","fetus:","baby:","visit:"]) contains(ob,name);
contains(css, '#anamnesis-obstetric-form .anam-ob-pathway');
assert.match(ob, /form\.querySelectorAll\('\[data-ob-scope\]'\)/, 'Dynamic path section toggle missing');
assert.match(ob, /!Number\.isFinite\(weeks\) \|\| weeks >= cutoff/, 'Unknown gestation should not hide important questions');
assert.match(ob, /form\.querySelectorAll\('\[data-ob-when\]'\)/, 'Conditional fields missing');
assert.match(ob, /birthOutcomeKnown && !feedingRelevant/, 'Sensitive infant feeding condition missing');
assert.ok(ob.length > 20000, 'Obstetric content unexpectedly missing');
console.log('Obstetric anamnesis structural regression checks passed.');
