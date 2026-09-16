import assert from 'node:assert/strict';
import fs from 'node:fs';

const patientGltf = JSON.parse(fs.readFileSync(new URL('../assets/3d/patient/scene.gltf', import.meta.url), 'utf8'));
const rendererSource = fs.readFileSync(new URL('../src/scene/patient3DRenderer.js', import.meta.url), 'utf8');
const caseSource = fs.readFileSync(new URL('../src/cases/peterNovak.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const attribution = fs.readFileSync(new URL('../assets/3d/ATTRIBUTION.txt', import.meta.url), 'utf8');
const texture = fs.readFileSync(new URL('../assets/3d/patient/textures/MikeAlger_Material_baseColor_age58_v2.jpeg', import.meta.url));

assert.ok(patientGltf.skins?.length >= 1, 'patient asset must remain rigged');
assert.ok(patientGltf.nodes?.some((node) => node.name === 'mixamorig_Hips_01'));
assert.ok(patientGltf.nodes?.some((node) => node.name === 'mixamorig_RightArm_035'));
assert.ok(rendererSource.includes("from 'three'"));
assert.ok(rendererSource.includes("three/addons/loaders/GLTFLoader.js"));
assert.ok(rendererSource.includes('applyPoseBlend'));
assert.ok(rendererSource.includes('createBedsideMonitor'));
assert.ok(rendererSource.includes('alignStandingPatientToFloor'), 'encounter patient must stand on the room floor');
assert.ok(rendererSource.includes("visual?.position || 'standing'"), 'encounter renderer must default to standing posture');
assert.ok(rendererSource.includes("const target = new THREE.Vector3(0, examination ? 0.92 : 1.40, 0.02)"), 'camera must switch between upper-body encounter and full-body examination framing');
assert.ok(rendererSource.includes("const radius = (examination ? 3.25 : 1.72)"), 'examination view must widen to show the full body');
assert.ok(rendererSource.includes('applyAgeAppearance'), 'patient appearance must respond to case age');
assert.ok(rendererSource.includes("PATIENT_URL.searchParams.set('v', '20260916-age58-face-v2')"), 'patient GLTF request must be cache-versioned');
assert.ok(patientGltf.images?.[0]?.uri?.includes('age58_v2'), 'GLTF must reference the new uncached age-58 texture filename');
assert.ok(rendererSource.includes('y: -0.40 * strength'), 'left resting arm must be brought anterior to the torso');
assert.ok(rendererSource.includes('y: 0.40 * strength'), 'right resting arm must be brought anterior to the torso');
assert.ok(rendererSource.includes('depthTest: false'), 'procedural face rig must render visibly in front of the head mesh');
assert.ok(rendererSource.includes('this.apparentAge'), 'renderer must read age from the active case');
assert.ok(!rendererSource.includes('this.loader.loadAsync(BED_URL.href)'), 'main encounter must not load the bed scene');
assert.ok(!rendererSource.includes('this.patient.rotation.x = -Math.PI / 2'), 'main encounter must not force the patient into a bed pose');
assert.ok(caseSource.includes('"age": 58'));
assert.ok(caseSource.includes('"dob": "14 March 1968"'));
assert.ok(caseSource.includes('"position": "standing"'));
assert.ok(texture.byteLength > 500_000, 'aged patient texture must be present');
assert.ok(html.includes('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js'));
assert.ok(html.includes('3D credits'));
assert.ok(attribution.includes('Mike Alger'));

console.log('Three.js standing encounter / age appearance regression tests passed.');
