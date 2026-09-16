import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXAM_SOUND_LIBRARY } from '../src/data/examSoundLibrary.js';
import { PHYSICAL_EXAM_TOOLS, getPhysicalExamMap } from '../src/data/physicalExamMap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const map = getPhysicalExamMap({ id: 'chest_pain_acs_risk' });

assert.equal(PHYSICAL_EXAM_TOOLS.length, 4, 'Expected four physical examination techniques');
assert.deepEqual(PHYSICAL_EXAM_TOOLS.map(t => t.id), ['inspect', 'auscultate', 'palpate', 'percuss']);
assert.ok(Array.isArray(map.hotspots) && map.hotspots.length >= 30, 'Expected a dense interactive body map');
assert.ok(Array.isArray(map.visualOverlays) && map.visualOverlays.length >= 2, 'Expected patient visual overlays');

const ids = map.hotspots.map(h => h.id);
assert.equal(new Set(ids).size, ids.length, 'Hotspot IDs must be unique');

const heartSites = map.hotspots.filter(h => h.region === 'Heart' && h.tools.includes('auscultate'));
assert.equal(heartSites.length, 5, 'Expected five standard cardiac auscultation areas');
assert.ok(heartSites.every(h => h.results.auscultate?.soundId === 'normal_heart'), 'Peter cardiac sites should use the normal-heart recording');

const lungSites = map.hotspots.filter(h => h.id.startsWith('lung-'));
assert.ok(lungSites.length >= 12, `Expected >= 12 lung sites, got ${lungSites.length}`);
assert.ok(lungSites.some(h => h.view === 'front'), 'Expected anterior lung sites');
assert.ok(lungSites.some(h => h.view === 'back'), 'Expected posterior lung sites');
assert.ok(lungSites.every(h => h.tools.includes('auscultate') && h.tools.includes('percuss')), 'Lung points should support auscultation and percussion');

const abdomenSites = map.hotspots.filter(h => h.region === 'Abdomen');
assert.ok(abdomenSites.length >= 4, 'Expected abdominal quadrants');
assert.ok(abdomenSites.every(h => ['inspect','auscultate','palpate','percuss'].every(t => h.tools.includes(t))), 'Abdominal quadrants should support all four techniques');

for (const hotspot of map.hotspots) {
  assert.ok(['front', 'back'].includes(hotspot.view), `Invalid view for ${hotspot.id}`);
  assert.ok(hotspot.x >= 0 && hotspot.x <= 100 && hotspot.y >= 0 && hotspot.y <= 100, `Invalid position for ${hotspot.id}`);
  for (const tool of hotspot.tools) {
    assert.ok(hotspot.results?.[tool], `${hotspot.id} missing result for ${tool}`);
    const soundId = hotspot.results[tool]?.soundId;
    if (soundId) assert.ok(EXAM_SOUND_LIBRARY[soundId], `${hotspot.id}/${tool} references unknown sound ${soundId}`);
  }
}

const recordings = Object.values(EXAM_SOUND_LIBRARY).filter(s => s.kind === 'recording');
const publishedSimulations = Object.values(EXAM_SOUND_LIBRARY).filter(s => s.kind === 'published-simulation');
assert.ok(recordings.length >= 8, 'Expected at least eight verified recorded sound examples');
assert.ok(publishedSimulations.length >= 5, 'Expected a broader published reference-simulation atlas');
for (const sound of recordings) {
  assert.match(sound.url, /^https:\/\//, `${sound.id} missing remote recording URL`);
  assert.match(sound.sourcePage, /^https:\/\//, `${sound.id} missing source page`);
  assert.ok(sound.license, `${sound.id} missing license`);
  assert.ok(sound.author, `${sound.id} missing author`);
}

for (const sound of publishedSimulations) {
  assert.match(sound.url, /^https:\/\//, `${sound.id} missing reference-audio URL`);
  assert.match(sound.sourcePage, /^https:\/\//, `${sound.id} missing source page`);
  assert.ok(sound.license, `${sound.id} missing license`);
  assert.match(sound.description, /not a patient recording/i, `${sound.id} must be explicitly labelled as simulation`);
}

const hotspotIds = new Set(ids);
for (const sound of Object.values(EXAM_SOUND_LIBRARY)) {
  for (const hotspotId of sound.preferredHotspots || []) {
    assert.ok(hotspotIds.has(hotspotId), `${sound.id} prefers unknown hotspot ${hotspotId}`);
  }
}

for (const id of ['normal_vesicular','normal_bowel','percussion_resonant','percussion_dull','percussion_tympanic','percussion_flat']) {
  assert.ok(EXAM_SOUND_LIBRARY[id], `Missing educational synthesis ${id}`);
  assert.notEqual(EXAM_SOUND_LIBRARY[id].kind, 'recording', `${id} must not be mislabelled as a recording`);
}

const panelCode = fs.readFileSync(path.join(root, 'src/ui/clinicalEncounterPanels.js'), 'utf8');
assert.ok(panelCode.includes('renderInteractivePhysicalExam'), 'Examination panel must render the interactive exam UI');
assert.ok(!panelCode.includes('data-perform-exam'), 'Legacy click-to-reveal examination checklist should not remain in the panel');

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.ok(html.includes('Patient Trainer Lab'), 'Expected standalone Patient Trainer branding');
assert.ok(html.includes('Interactive physical examination'), 'Expected interactive physical examination workspace');
assert.ok(!html.includes('Medical Dictionary</'), 'Standalone trainer should not expose the Medical Dictionary shell branding');

console.log(`Interactive exam validation passed: ${map.hotspots.length} hotspots, ${heartSites.length} heart sites, ${lungSites.length} respiratory sites, ${recordings.length} recorded clinical sounds, ${publishedSimulations.length} published simulations.`);


// realistic anterior photograph placement sanity
{
  const map = getPhysicalExamMap({ id: 'chest_pain_acs_risk' });
  const byId = Object.fromEntries(map.hotspots.map((p) => [p.id, p]));

  assert.ok(byId['front-lips'].y > 12 && byId['front-lips'].y < 15, 'Lips must be placed at mouth level');
  assert.ok(byId['front-radial-right'].y > 47 && byId['front-radial-right'].y < 51, 'Radial pulse must sit at the distal forearm/wrist, not the mid-forearm');
  assert.ok(byId['front-hands-right'].y > 51 && byId['front-hands-right'].y < 54, 'Hand inspection must be on the hand');
  assert.ok(byId['abdomen-ruq'].y < 52 && byId['abdomen-rlq'].y < 58, 'Abdominal quadrants must remain on the abdomen');
  assert.ok(byId['heart-aortic'].x < 50 && byId['heart-pulmonic'].x > 50, 'Anterior cardiac laterality must follow patient right/left');
  assert.ok(byId['front-hands-right'].x < 50 && byId['front-hands-left'].x > 50, 'Patient right/left hand orientation must be correct');
  console.log('✓ realistic anterior photograph placement sanity');
}


// PT-v4 cache-proof, posterior-view and technique-position validation
{
  const byId = Object.fromEntries(map.hotspots.map((p) => [p.id, p]));
  assert.ok(Math.abs(byId['heart-aortic'].x - 48.1) < 0.01);
  assert.ok(Math.abs(byId['heart-pulmonic'].x - 51.9) < 0.01);
  assert.ok(byId['heart-mitral'].x > 57 && byId['heart-mitral'].y > 30);
  assert.notDeepEqual(byId['lung-front-r-upper'].positions.auscultate, byId['lung-front-r-upper'].positions.percuss, 'Auscultation/percussion should have independent display coordinates');
  assert.ok(byId['lung-front-r-upper'].positions.auscultate.x > 40, 'Anterior lung point must remain on thorax');
  assert.ok(byId['lung-back-r-upper'].positions.auscultate.y < 27, 'Posterior upper lung point must remain on upper thorax');
  const interactive = fs.readFileSync(path.join(root, 'src/ui/interactivePhysicalExam.js'), 'utf8');
  assert.ok(interactive.includes('peter_novak_back.png'), 'Posterior photograph must be wired into the canonical examination renderer');
  assert.ok(interactive.includes("data-exam-view=\"back\""), 'Posterior toggle must remain rendered');
  assert.ok(fs.existsSync(path.join(root, 'assets/peter_novak_back.png')), 'Posterior photograph asset must exist');
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  assert.ok(main.includes('clinicalEncounterPanels.js'), 'Main module must use the canonical examination chain');
  console.log('✓ Posterior and technique-coordinate validation');
}
