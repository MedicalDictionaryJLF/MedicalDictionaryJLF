import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PATIENT_CASES } from '../src/cases/index.js';
import { getPatientAsset, resolveVisualState } from '../src/scene/patientAssets.js';

for (const patientCase of PATIENT_CASES) {
  const asset = getPatientAsset(patientCase);
  const bytes = fs.readFileSync(new URL(asset.characterUrl));
  assert.equal(bytes.toString('utf8', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  assert.equal(gltf.skins[0].joints.length, 53);
  assert.ok(gltf.nodes.some(node => node.extras?.caseId === patientCase.id));
  const body = gltf.meshes.find(mesh => mesh.extras?.targetNames?.includes('eyeBlinkLeft'));
  for (const key of ['eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen', 'viseme_aa', 'viseme_E', 'viseme_O']) {
    assert.ok(body.extras.targetNames.includes(key), `${asset.slug} facial shape ${key}`);
  }
  for (const clip of ['PositionStanding', 'PositionSeated', 'PositionReclined', 'RestArms', 'ChestPain', 'IdleBreathing', 'RespiratoryEffort', 'Blink', 'Talking']) {
    assert.ok(gltf.animations.some(animation => animation.name === clip));
  }
  for (const channel of gltf.animations.find(animation => animation.name === 'IdleBreathing').channels) {
    assert.equal(gltf.nodes[channel.target.node].name, 'spine_03', 'Breathing stays in its anatomical layer');
  }
  assert.ok(gltf.images.every(image => Number.isInteger(image.bufferView)), 'Embedded textures');
  assert.equal(resolveVisualState(patientCase, null, 'resting').pain, 0);
  const roomBytes = fs.readFileSync(new URL(asset.environmentUrl));
  const room = JSON.parse(roomBytes.subarray(20, 20 + roomBytes.readUInt32LE(12)).toString());
  for (const name of ['HospitalBed', 'ExamChair', 'MonitorScreen']) assert.ok(room.nodes.some(node => node.name === name));
}
console.log('Anatomical 3D patient, facial rig, animation-layer and room contracts: PASS');
