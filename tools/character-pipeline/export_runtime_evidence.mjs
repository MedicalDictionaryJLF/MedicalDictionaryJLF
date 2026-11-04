// Exports CPU-deformed runtime geometry/camera values for Blender evidence.
// Image decoding is stubbed here; Blender imports materials from the real GLB.
import fs from 'node:fs';
import path from 'node:path';
const outputDir=path.resolve(process.argv[2] || 'runtime-evidence');fs.mkdirSync(outputDir,{recursive:true});
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Patient3DRenderer} from '../../anamnesis-training/src/scene/patient3DRenderer.js';
import {PATIENT_CASES} from '../../anamnesis-training/src/cases/index.js';
import {PatientStateEngine} from '../../anamnesis-training/src/patientState.js';
globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});globalThis.ProgressEvent=class{constructor(t,o){Object.assign(this,{type:t},o)}};
const load=async url=>{let b=fs.readFileSync(new URL(url));return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')};
for(const [index,posture,view,aspect] of [[1,'reclined','face',1],[1,'reclined','patient',.5],[0,'standing','patient',1.6]]){
 const activeCase=PATIENT_CASES[index],r=new Patient3DRenderer(null,{activeCase}),[g,room]=await Promise.all([load(r.asset.characterUrl),load(r.asset.environmentUrl)]);r.patient=g.scene;r.environment=room.scene;r.camera=new T.PerspectiveCamera(36,aspect,.03,35);r.controls={target:new T.Vector3(),update(){r.camera.lookAt(this.target);r.camera.updateMatrixWorld(true)}};r.toolbar={querySelector(){return{}},querySelectorAll(){return[]}};r.mixer=new T.AnimationMixer(r.patient);for(const a of g.animations)r.actions.set(a.name,r.mixer.clipAction(a));const meshes=[];r.patient.traverse(o=>{if(o.isBone)r.bones.set(o.name,o);if(o.isSkinnedMesh)meshes.push(o);if(o.morphTargetDictionary)r.morphMeshes.push(o)});for(const [p,n] of Object.entries({chair:'ExamChair',bed:'HospitalBed',cover:'FoldedCover'}))r[p]=room.scene.getObjectByName(n);r.snapshot=new PatientStateEngine(activeCase).getSnapshot();r.setSlot('breath','IdleBreathing',0);r.setSlot('arms','RestArms',0);r.setClinicalMode('resting');r.setPosition(posture);for(let i=0;i<120;i++){r.elapsed+=1/60;r.updateAnimation(1/60)}r.patient.updateMatrixWorld(true);r.focus(view,true);
 const out={patient:r.asset.slug,posture,view,camera:{position:r.camera.position.toArray(),target:r.controls.target.toArray(),fov:r.camera.fov,aspect},bedPosition:r.bed.position.toArray(),chairVisible:r.chair.visible,meshes:[]};
 for(const m of meshes){m.skeleton.update();const vertices=[];for(let i=0;i<m.geometry.attributes.position.count;i++)vertices.push(...m.getVertexPosition(i,new T.Vector3()).applyMatrix4(m.matrixWorld).toArray());out.meshes.push({name:m.name,material:m.material.name,vertices,indices:Array.from(m.geometry.index.array),uv:Array.from(m.geometry.attributes.uv.array)})}
 const file=path.join(outputDir,`runtime-${r.asset.slug}-${view}.json`);fs.writeFileSync(file,JSON.stringify(out));console.log(file);
}
