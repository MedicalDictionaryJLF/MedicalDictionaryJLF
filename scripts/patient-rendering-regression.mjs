// Evaluates the shipped GLBs through the actual renderer, without a GPU.
// Image decoding and rendered appearance are verified separately in the browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PATIENT_CASES } from '../anamnesis-training/src/cases/index.js';
import { Patient3DRenderer } from '../anamnesis-training/src/scene/patient3DRenderer.js';
import { PatientStateEngine } from '../anamnesis-training/src/patientState.js';

globalThis.self=globalThis;
globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
globalThis.ProgressEvent=class {constructor(type,options){Object.assign(this,{type},options);}};

const load=async url=>{
  const bytes=fs.readFileSync(new URL(url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
};
const rows=[];
for(const activeCase of PATIENT_CASES){
  const renderer=new Patient3DRenderer(null,{activeCase});
  const [character,environment]=await Promise.all([load(renderer.asset.characterUrl),load(renderer.asset.environmentUrl)]);
  renderer.patient=character.scene;renderer.environment=environment.scene;
  renderer.camera=new THREE.PerspectiveCamera(36,1,.03,35);
  renderer.controls={target:new THREE.Vector3(),update(){renderer.camera.lookAt(this.target);renderer.camera.updateMatrixWorld(true);}};
  renderer.toolbar={querySelector(){return {};},querySelectorAll(){return [];}};
  renderer.mixer=new THREE.AnimationMixer(renderer.patient);
  for(const clip of character.animations)renderer.actions.set(clip.name,renderer.mixer.clipAction(clip));
  const materials=new Set(),meshes=[];
  renderer.patient.traverse(object=>{
    if(object.isBone)renderer.bones.set(object.name,object);
    if(object.isSkinnedMesh)meshes.push(object);
    if(object.morphTargetDictionary)renderer.morphMeshes.push(object);
    for(const material of Array.isArray(object.material)?object.material:[object.material])if(material)materials.add(material);
  });
  let solids=0,cutouts=0;
  for(const material of materials){
    const cornea=material.name==='PatientEyeCorneaClear',cutout=cornea||/^PatientBody\.(short|bob|ponytail|braid|eyebrow|eyelashes)/.test(material.name);
    // Verify the exported file itself, before the defensive runtime policy.
    assert.equal(material.transparent,false,`${activeCase.id}: ${material.name} is transparent`);
    assert.equal(material.depthWrite,true,`${activeCase.id}: ${material.name} bypasses depth`);
    if(cutout){cutouts++;assert.ok(material.alphaTest>=.3,`${material.name}: missing cutout threshold`);}
    else {solids++;assert.equal(material.alphaTest,0,`${material.name}: opaque anatomy has alpha cutoff`);}
    if(cornea)assert.equal(material.opacity,0,'Outer eye shell obscures iris');
    renderer.preparePatientMaterial(material);
    assert.equal(material.depthWrite,true);
    assert.equal(material.transparent,false);
  }
  for(const [property,name] of Object.entries({chair:'ExamChair',bed:'HospitalBed',cover:'FoldedCover'}))renderer[property]=environment.scene.getObjectByName(name);
  const bedding=Array.from(renderer.cover.geometry.attributes.position.array);
  environment.scene.updateMatrixWorld(true);
  const bedspreadBounds=new THREE.Box3().setFromObject(renderer.cover),mattressBounds=new THREE.Box3().setFromObject(environment.scene.getObjectByName('Mattress'));
  assert.ok(bedspreadBounds.min.y>mattressBounds.max.y+.01,`${activeCase.id}: mattress intersects the bedspread`);
  const state=new PatientStateEngine(activeCase),snapshot=state.getSnapshot(),clinicalBefore=JSON.stringify(snapshot);
  renderer.snapshot=snapshot;renderer.setSlot('arms','RestArms',0);renderer.setSlot('breath','IdleBreathing',0);renderer.updateState(true);
  const position=name=>renderer.bones.get(name).getWorldPosition(new THREE.Vector3());
  const bounds=()=>{const result=new THREE.Box3();renderer.patient.updateMatrixWorld(true);for(const mesh of meshes){mesh.skeleton.update();mesh.computeBoundingBox();result.union(mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld));}return result;};
  const checkFrame=box=>{
    renderer.camera.updateMatrixWorld(true);
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
      const point=new THREE.Vector3(x,y,z).project(renderer.camera);
      assert.ok(Math.abs(point.x)<.98&&Math.abs(point.y)<.98&&Math.abs(point.z)<1,`${activeCase.id}: camera crops posed patient (${point.toArray()})`);
    }
  };
  renderer.setClinicalMode('resting');renderer.setPosition('standing');renderer.focus('face',true);
  const skin=meshes.find(mesh=>mesh.material.name.startsWith('Skin_')),teeth=meshes.find(mesh=>mesh.material.name.includes('teeth_base'));
  assert.ok(skin&&teeth,'Missing skin or teeth mesh');skin.skeleton.update();teeth.skeleton.update();skin.computeBoundingSphere();
  let hiddenTeeth=0,toothSamples=0;
  for(let index=0;index<teeth.geometry.attributes.position.count;index+=150){
    const point=teeth.getVertexPosition(index,new THREE.Vector3()).applyMatrix4(teeth.matrixWorld),origin=renderer.camera.position;
    const hit=new THREE.Raycaster(origin,point.clone().sub(origin).normalize()).intersectObject(skin)[0];
    toothSamples++;if(hit&&hit.distance<origin.distanceTo(point)-.001)hiddenTeeth++;
  }
  assert.ok(hiddenTeeth/toothSamples>.9,`${activeCase.id}: resting teeth are exposed through the face`);
  let switches=0;
  for(const mode of ['resting','symptomatic']){
    renderer.setClinicalMode(mode);
    for(const posture of ['standing','seated','reclined','standing','reclined','seated','reclined']){
      renderer.setPosition(posture);switches++;
      // The requested pose must already be applied when the UI call returns.
      const head=position('head'),hip=position('pelvis'),knee=position('calf_l');
      if(posture==='reclined'){
        assert.ok(Math.abs(head.y-hip.y)<.22&&Math.abs(head.z-hip.z)>.4,`${activeCase.id}: reclined selector still displays upright pose`);
        assert.ok(renderer.bed.position.length()<1e-6,'Bed has not moved with the patient');
      }else if(posture==='standing')assert.ok(head.y-hip.y>.45,'Standing pose lost');
      else assert.ok(Math.abs(hip.y-knee.y)<.2,'Seated thighs not horizontal');
      assert.equal([...renderer.actions].filter(([name,action])=>name.startsWith('Position')&&action.isRunning()).length,1,'Multiple posture actions remain active');
      assert.deepEqual(Array.from(renderer.cover.geometry.attributes.position.array),bedding,'Bedding was raised through the patient');
      for(const aspect of [390/780,16/10]){
        renderer.camera.aspect=aspect;renderer.camera.updateProjectionMatrix();renderer.focus('patient',true);checkFrame(bounds());
        renderer.focus('face',true);
        const direction=renderer.camera.position.clone().sub(renderer.controls.target).normalize();
        if(posture==='reclined')assert.ok(direction.y>.7,'Reclined face camera looks from the feet instead of above');
      }
      for(let tick=0;tick<45;tick++){renderer.elapsed+=1/60;renderer.updateAnimation(1/60);}
    }
  }
  assert.equal(JSON.stringify(snapshot),clinicalBefore,'Visual preview mutated clinical state');
  rows.push({patient:activeCase.identity.name,solidMaterials:solids,cutoutMaterials:cutouts,bedspreadClearanceM:Number((bedspreadBounds.min.y-mattressBounds.max.y).toFixed(4)),restingTeethOccluded:{hidden:hiddenTeeth,total:toothSamples},postureSwitches:switches,portraitAndLandscapeFraming:'PASS',status:'PASS'});
  console.log(`${activeCase.identity.name}: material depth, ${switches} instant posture switches, portrait/landscape framing PASS`);
}
fs.mkdirSync(new URL('../docs/patient-trainer-3d/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../docs/patient-trainer-3d/rendering-regression.json',import.meta.url),JSON.stringify({method:'Actual Three.js GLTFLoader and Patient3DRenderer CPU evaluation; image decoding stubbed; no GPU render claim',results:rows},null,2)+'\n');
console.log('PASS: all eight patient rendering regression cases');
