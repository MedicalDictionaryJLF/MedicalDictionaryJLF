// Exercises real character skeletons and the examination/ECG controller on the CPU.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PATIENT_CASES } from '../anamnesis-training/src/cases/index.js';
import { Patient3DRenderer } from '../anamnesis-training/src/scene/patient3DRenderer.js';
import { buildEncounterReport, createEncounterState, evaluateExamination, performExamination, recordEcgProgress } from '../anamnesis-training/src/clinicalEncounter.js';
import { labsForGroup } from '../anamnesis-training/src/ui/actionPanels.js';
import { EXAM_SITES, ECG_LEADS, getBedsideFinding } from '../anamnesis-training/src/scene/bedsideInteractions.js';

globalThis.self=globalThis;
globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
globalThis.ProgressEvent=class {constructor(type,options){Object.assign(this,{type},options);}};
globalThis.CustomEvent=class {constructor(type,options){this.type=type;this.detail=options.detail;}};
globalThis.document={createElement:()=>({hidden:false,innerHTML:'',addEventListener(){}})};

for(const patientCase of PATIENT_CASES){
  const state=createEncounterState(),events=[];
  let renderer;
  const container={append(){},dispatchEvent:event=>{
    events.push(event);
    if(event.type==='patient3d-examination') assert.ok(performExamination(patientCase,state,event.detail.examinationId,{...event.detail,environmentReady:renderer.canExamine()}).ok);
    if(event.type==='patient3d-ecg-progress') assert.ok(recordEcgProgress(patientCase,state,event.detail,renderer.canExamine()).ok);
  }};
  renderer=new Patient3DRenderer(container,{activeCase:patientCase,autoPlayAudio:false});
  const bytes=fs.readFileSync(new URL(renderer.asset.characterUrl));
  const loaded=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  renderer.patient=loaded.scene;
  renderer.patient.traverse(object=>{if(object.isBone)renderer.bones.set(object.name,object);});
  renderer.camera=new THREE.PerspectiveCamera(36,1,.03,35);
  renderer.controls={target:new THREE.Vector3(),update(){renderer.camera.lookAt(this.target);renderer.camera.updateMatrixWorld(true);}};
  renderer.toolbar={querySelector:()=>({setAttribute(){},hidden:false,value:''}),querySelectorAll:()=>[]};
  renderer.mixer=new THREE.AnimationMixer(renderer.patient);
  for(const clip of loaded.animations)renderer.actions.set(clip.name,renderer.mixer.clipAction(clip));
  renderer.createInspectionPoints();
  assert.equal(renderer.setExaminationTool('inspect'),false,'No tools before renderer ready');
  renderer.loaded=true;
  assert.equal(renderer.inspectionPoints.length,EXAM_SITES.length,`${patientCase.id}: examination landmark missing`);
  assert.equal(renderer.leadPoints.length,ECG_LEADS.length,`${patientCase.id}: ECG landmark missing`);
  renderer.setSlot('arms','RestArms',0);renderer.setSlot('breath','IdleBreathing',0);
  for(const posture of ['standing','seated','reclined']){
    renderer.setPosition(posture);
    renderer.patient.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(renderer.patient).expandByScalar(.27);
    for(const marker of [...renderer.inspectionPoints,...renderer.leadPoints]){
      const position=marker.getWorldPosition(new THREE.Vector3());
      assert.ok(bounds.containsPoint(position),`${patientCase.id}: ${posture} landmark ${marker.userData.siteId || marker.userData.leadId} is detached`);
    }
  }
  renderer.setPosition('standing');
  renderer.setExaminationTool('auscultate');renderer.focus('patient');renderer.updateMarkerVisibility();
  assert.ok(renderer.inspectionPoints.find(p=>p.userData.siteId==='lung-front-right').visible,'Anterior landmark visible from front');
  assert.equal(renderer.inspectionPoints.find(p=>p.userData.siteId==='lung-back-right').visible,false,'Posterior landmark cannot be clicked through the body');
  renderer.focus('back');renderer.updateMarkerVisibility();
  assert.ok(renderer.inspectionPoints.find(p=>p.userData.siteId==='lung-back-right').visible,'Posterior landmark reachable from back');
  assert.equal(renderer.inspectionPoints.find(p=>p.userData.siteId==='lung-front-right').visible,false);
  for(const technique of ['inspect','auscultate','palpate','percuss']){
    renderer.setExaminationTool(technique);
    const point=EXAM_SITES.find(item=>item.techniques.includes(technique));
    renderer.examineSite(point.id);
    for (const site of EXAM_SITES.filter(item=>item.techniques.includes(technique)).slice(1)) renderer.examineSite(site.id,'accessible');
    const event=events.at(-1);
    assert.equal(event.type,'patient3d-examination');
    assert.equal(event.detail.technique,technique);
    assert.equal(event.detail.finding,getBedsideFinding(patientCase,event.detail.siteId,technique).finding);
    if(!['chest_pain_acs_risk','abdominal_pain_cholecystitis'].includes(patientCase.id))
      assert.equal(event.detail.documented,false,`${patientCase.id}: undocumented source case must not inherit another patient's finding`);
  }
  renderer.setExaminationTool('ecg');
  renderer.selectedLead='RA';
  assert.equal(renderer.placeLead('LA').ok,false,'Wrong anatomical target must be rejected');
  assert.equal(Object.keys(renderer.placedLeads).length,0);
  for(const [index,lead] of ECG_LEADS.entries()){
    renderer.selectedLead=lead.id;
    const result=renderer.placeLead(lead.id);
    assert.equal(result.ok,true);
    assert.equal(result.completed,index===ECG_LEADS.length-1);
  }
  assert.equal(events.filter(e=>e.type==='patient3d-ecg-complete').length,1);
  assert.equal(Object.keys(renderer.placedLeads).length,10);
  assert.equal(events.at(-1).detail.caseId,patientCase.id);
  assert.equal(state.ecg.completed,true);
  assert.equal(state.ecg.attempts.filter(item=>!item.correct).length,1);
  assert.equal(state.ecg.placedLeads.length,10);
  const resumed=JSON.parse(JSON.stringify(state));
  assert.deepEqual(evaluateExamination(patientCase,resumed),evaluateExamination(patientCase,state));
  renderer.restorePlacedLeads(resumed.ecg.placedLeads);
  assert.equal(events.filter(e=>e.type==='patient3d-ecg-complete').length,1,'Restore does not replay completion');
  const historyOnly=!['chest_pain_acs_risk','abdominal_pain_cholecystitis'].includes(patientCase.id);
  if(historyOnly){
    assert.equal(evaluateExamination(patientCase,state).percent,null,'Unsupported findings do not contribute fabricated credit');
    assert.deepEqual(labsForGroup('fbc',patientCase),{});
    assert.ok(state.examActions.every(action=>!action.documented&&!action.sound));
  }
  const empty=buildEncounterReport({patientCase,encounterState:createEncounterState(),interviewScore:0,closingInput:{}});
  assert.equal(empty.encounterScore,0,'Empty encounter earns no credit');
  const report=buildEncounterReport({patientCase,encounterState:resumed,interviewScore:42,closingInput:{}});
  assert.equal(report.examination.record.length,state.examActions.length);
  assert.equal(report.investigations.acquiredEcg,Boolean(patientCase.ecg.available));
  renderer.fail(new Error('Test context loss'));
  const count=events.length;
  assert.equal(renderer.examineSite('general').ok,false);
  assert.equal(renderer.placeLead('RA').ok,false);
  assert.equal(events.length,count,'Failed renderer cannot emit exam/ECG events');
  console.log(`${patientCase.identity.name}: ${EXAM_SITES.length} moving exam sites, 10 placed leads, four techniques PASS`);
}
console.log('PASS: bedside interaction contracts on all eight skinned characters');
