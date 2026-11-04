import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import validator from 'gltf-validator';
import { PATIENT_CASES } from '../anamnesis-training/src/cases/index.js';
import { PATIENT_ASSETS,resolveVisualState,reportedVital } from '../anamnesis-training/src/scene/patientAssets.js';
import { PatientStateEngine } from '../anamnesis-training/src/patientState.js';

const root=path.resolve('anamnesis-training/assets/3d/clinical'),results=[];
const reused=process.argv.includes('--reuse-conformance')?JSON.parse(await fs.readFile('tools/character-pipeline/asset-validation.json','utf8')):null;
async function conform(bytes,folder,name){
  if(!reused)return validator.validateBytes(new Uint8Array(bytes),{uri:name,maxIssues:1000,ignoredIssues:['UNUSED_OBJECT']});
  const row=reused.find(r=>r.folder===folder&&r.name===name);
  assert.ok(row&&row.bytes===bytes.length,`Conformance record must match ${folder}/${name}`);
  return {issues:{numErrors:row.errors,numWarnings:row.warnings,messages:row.messages || []}};
}
const clips=['PositionStanding','PositionSeated','PositionReclined','RestArms','ChestPain','AbdominalGuard','FlankGuard','Headache','IdleBreathing','RespiratoryEffort','Fatigue','Blink','PainExpression','Talking','EyeMovement'];
for(const c of PATIENT_CASES){
  const profile=PATIENT_ASSETS[c.id];assert.ok(profile,`${c.id} mapped`);const file=path.join(root,'patients',profile.slug+'.glb'),b=await fs.readFile(file);assert.equal(b.toString('utf8',0,4),'glTF');assert.equal(b.readUInt32LE(8),b.length);
  const g=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString()),r=await conform(b,'patients',path.basename(file));
  assert.equal(r.issues.numErrors,0,JSON.stringify(r.issues.messages.filter(m=>m.severity===0)));assert.equal(g.skins.length,1);assert.equal(g.skins[0].joints.length,53);assert.ok(g.nodes.some(n=>n.extras?.caseId===c.id));assert.ok(g.images.every(i=>Number.isInteger(i.bufferView)));assert.ok(g.buffers.every(b=>!b.uri));
  const body=g.meshes.find(m=>m.extras?.targetNames?.includes('eyeBlinkLeft'));for(const key of ['eyeBlinkLeft','eyeBlinkRight','jawOpen','viseme_aa','viseme_E','viseme_O','viseme_PP'])assert.ok(body.extras.targetNames.includes(key));for(const name of clips)assert.ok(g.animations.some(a=>a.name===name));
  for(const name of ['IdleBreathing','RespiratoryEffort'])for(const ch of g.animations.find(a=>a.name===name).channels)assert.equal(g.nodes[ch.target.node].name,'spine_03');
  for(const ch of g.animations.find(a=>a.name==='ChestPain').channels)assert.match(g.nodes[ch.target.node].name,/^(upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)/);
  const state=new PatientStateEngine(c),before=JSON.stringify(state.getSnapshot());assert.equal(resolveVisualState(c,state.getSnapshot(),'resting').pain,0);assert.equal(before,JSON.stringify(state.getSnapshot()));if(!profile.explicitSimulation)assert.equal(reportedVital(c,'hr',state.getSnapshot()),null);
  const row={patient:c.identity.name,caseId:c.id,file:path.relative(process.cwd(),file),sha256:crypto.createHash('sha256').update(b).digest('hex'),bytes:b.length,skinJoints:53,facialTargets:body.extras.targetNames.length,animationClips:g.animations.length,errors:r.issues.numErrors,warnings:r.issues.numWarnings,warningMessages:r.issues.messages.filter(m=>m.severity===1).map(m=>m.code)};results.push(row);console.log(`${profile.slug}: ${row.errors} errors, ${row.warnings} warnings`);
}
for(const kind of ['environments','scenes'])for(const name of await fs.readdir(path.join(root,kind))){if(!name.endsWith('.glb'))continue;const b=await fs.readFile(path.join(root,kind,name)),r=await conform(b,kind,name);assert.equal(r.issues.numErrors,0,name);results.push({asset:name,kind,bytes:b.length,errors:r.issues.numErrors,warnings:r.issues.numWarnings});}
assert.equal(new Set(results.filter(r=>r.sha256).map(r=>r.sha256)).size,8);await fs.mkdir('docs/patient-trainer-3d',{recursive:true});await fs.writeFile('docs/patient-trainer-3d/asset-validation.json',JSON.stringify({validator:'Khronos glTF Validator',results},null,2)+'\n');console.log(`PASS: ${results.length} GLBs, ${results.reduce((n,r)=>n+r.errors,0)} errors, ${results.reduce((n,r)=>n+r.warnings,0)} warnings`);
