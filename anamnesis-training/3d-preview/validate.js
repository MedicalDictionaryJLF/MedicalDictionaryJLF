import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PATIENT_CASES } from '../src/cases/index.js';
import { getPatientAsset,resolveVisualState } from '../src/scene/patientAssets.js?v=clinical-3d-3';
import { PatientStateEngine } from '../src/patientState.js';
import { PatientEngine } from '../src/patientEngine.js';
import { Patient3DRenderer } from '../src/scene/patient3DRenderer.js?v=clinical-3d-3';

const button=document.getElementById('runValidation'),status=document.getElementById('qaStatus'),report=document.getElementById('qaReport');
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const position=(scene,name)=>scene.getObjectByName(name).getWorldPosition(new THREE.Vector3());
const required=['PositionStanding','PositionSeated','PositionReclined','RestArms','ChestPain','AbdominalGuard','FlankGuard','Headache','IdleBreathing','RespiratoryEffort','Fatigue','Blink','PainExpression','Talking','EyeMovement'];
button.addEventListener('click',async()=>{
  button.disabled=true;const rows=[],only=new URLSearchParams(location.search).get('only');
  for(const c of PATIENT_CASES.filter(c=>!only||getPatientAsset(c).slug===only)){
    status.textContent=`Loading ${c.identity.name}…`;const asset=getPatientAsset(c);
    try{
      const gltf=await new GLTFLoader().loadAsync(asset.characterUrl),scene=gltf.scene,meshes=[],morphs=[],materials=new Set();
      scene.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o);if(o.morphTargetDictionary)morphs.push(o);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)materials.add(m);});
      assert(meshes.length>=7,'Missing skinned character parts');assert(morphs.length>=5,'Missing facial deformation meshes');assert(meshes.some(m=>m.userData.caseId===c.id),'GLB belongs to the wrong case');
      const bones=new Set(meshes.flatMap(m=>m.skeleton.bones.map(b=>b.name)));assert(bones.size>=53,'Incomplete skeleton');for(const name of required)assert(gltf.animations.some(a=>a.name===name),`Missing ${name}`);
      let checkedVertices=0;
      for(const m of meshes){const w=m.geometry.attributes.skinWeight,j=m.geometry.attributes.skinIndex;assert(w&&j,'Mesh has no skin weights');for(let i=0;i<w.count;i++){const values=[w.getX(i),w.getY(i),w.getZ(i),w.getW(i)];assert(values.every(Number.isFinite),'Invalid weight');assert(Math.abs(values.reduce((a,b)=>a+b,0)-1)<.002,'Unnormalised weights');checkedVertices++;}}
      let decodedTextures=0;for(const m of materials){
        assert(!m.transparent&&m.depthWrite,`Unsafe transparent/depth material: ${m.name}`);
        if(m.name==='PatientEyeCorneaClear')assert(m.opacity===0&&m.alphaTest>=.3,'Opaque outer eye shell hides the iris');
        if(/^PatientBody\.(short|bob|ponytail|braid|eyebrow|eyelashes)/.test(m.name))assert(m.alphaTest>=.3,`Hair cutout missing: ${m.name}`);
        for(const key of ['map','normalMap'])if(m[key]){assert(m[key].image?.width>0,'Texture decode failed');decodedTextures++;}
      }
      const mixer=new THREE.AnimationMixer(scene),actions=new Map(gltf.animations.map(c=>[c.name,mixer.clipAction(c)]));
      const sample=(names,time=1)=>{mixer.stopAllAction();for(const name of names)actions.get(name).reset().setEffectiveWeight(1).play();mixer.setTime(time);scene.updateMatrixWorld(true);for(const m of meshes)m.skeleton.update();};
      sample(['PositionStanding','RestArms']);const rest=position(scene,'hand_r'),standHip=position(scene,'pelvis'),box=new THREE.Box3().setFromObject(scene),height=box.max.y-box.min.y;assert(height>1.4&&height<2.1,`Implausible stature ${height}`);
      sample(['PositionStanding','ChestPain']);const wrist=position(scene,'hand_r'),chest=position(scene,'spine_03');assert(rest.distanceTo(wrist)>.2,'Chest gesture does not move hand');assert(wrist.distanceTo(chest)<.4,'Hand misses chest');
      sample(['PositionSeated','RestArms']);const hip=position(scene,'pelvis'),knee=position(scene,'calf_l');assert(hip.y<standHip.y-.2,'Seated pelvis not lowered');assert(Math.abs(knee.y-hip.y)<.2,'Seated thighs not horizontal');
      sample(['PositionReclined','RestArms']);assert(Math.abs(position(scene,'head').y-position(scene,'pelvis').y)<.3,'Reclined torso not horizontal');
      sample(['PositionStanding','RestArms','IdleBreathing'],0);const scale=scene.getObjectByName('spine_03').scale.clone();sample(['PositionStanding','RestArms','IdleBreathing'],2.3);assert(scale.distanceTo(scene.getObjectByName('spine_03').scale)>.002,'Breathing static');
      sample(['PositionStanding','ChestPain','IdleBreathing'],2.3);assert(position(scene,'hand_r').distanceTo(chest)<.4,'Breathing overrides arm gesture');
      const body=morphs.find(m=>m.userData.caseId===c.id);
      sample(['PositionStanding','RestArms','Blink'],44/24);assert(body.morphTargetInfluences[body.morphTargetDictionary.eyeBlinkLeft]>.8,'Blink morph does not play');
      sample(['PositionStanding','RestArms','Talking'],7/24);assert(body.morphTargetInfluences[body.morphTargetDictionary.viseme_aa]>.3,'Talking viseme does not play');
      let vertexSamples=0;
      for(const clip of ['PositionStanding','PositionSeated','PositionReclined','ChestPain','AbdominalGuard','FlankGuard','Headache']){
        sample(clip.startsWith('Position')?[clip,'RestArms']:['PositionStanding',clip]);
        for(const m of meshes)for(let i=0;i<m.geometry.attributes.position.count;i+=31){const v=m.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(m.matrixWorld);assert([v.x,v.y,v.z].every(Number.isFinite),'Non-finite deformed anatomy');assert(v.length()<4,'Exploding skin deformation');vertexSamples++;}
      }
      const state=new PatientStateEngine(c),before=JSON.stringify(state.getSnapshot());resolveVisualState(c,state.getSnapshot(),'resting');assert(before===JSON.stringify(state.getSnapshot()),'Preview mutates clinical state');
      // Exercise the actual runtime facial adapter against the loaded morphs,
      // independently of unavailable GPU context creation.
      const facialAdapter=new Patient3DRenderer(null,{activeCase:c});facialAdapter.morphMeshes=morphs;facialAdapter.values.pain=.7;facialAdapter.visual={consciousness:'alert'};facialAdapter.elapsed=1;facialAdapter.applyFace(.3);
      assert(body.morphTargetInfluences[body.morphTargetDictionary.browDownLeft]>.2,'Runtime pain expression fails');
      facialAdapter.setSpeaking(true,'aaa');facialAdapter.applyFace(.3);assert(body.morphTargetInfluences[body.morphTargetDictionary.viseme_aa]>.2,'Runtime speaking face fails');facialAdapter.setSpeaking(false);
      facialAdapter.values.pain=0;facialAdapter.affect={emotion:'irritated'};facialAdapter.applyFace(.3);assert(body.morphTargetInfluences[body.morphTargetDictionary.browDownLeft]>.3,'Dialogue affect fails to reach facial rig');
      const reply=new PatientEngine(c).ask('What brought you to hospital today?').reply;assert(typeof reply==='string'&&reply.length>15,'Interview reply failed');
      const room=await new GLTFLoader().loadAsync(asset.environmentUrl);for(const name of ['HospitalBed','ExamChair','MonitorScreen','IVEquipment','OxygenEquipment'])assert(room.scene.getObjectByName(name),`Room missing ${name}`);
      rows.push({patient:c.identity.name,caseId:c.id,status:'PASS',bones:bones.size,skinnedMeshes:meshes.length,facialMeshes:morphs.length,clips:gltf.animations.length,decodedTextures,checkedVertices,vertexSamples,heightM:Number(height.toFixed(3)),chestHandDistanceM:Number(wrist.distanceTo(chest).toFixed(3))});
      mixer.stopAllAction();mixer.uncacheRoot(scene);
      for(const root of [scene,room.scene])root.traverse(o=>{o.geometry?.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){if(!m)continue;for(const v of Object.values(m))if(v?.isTexture)v.dispose();m.dispose();}o.skeleton?.dispose();});
    }catch(error){rows.push({patient:c.identity.name,status:'FAIL',characterUrl:asset.characterUrl,error:error.message});console.error(error);}
    report.textContent=JSON.stringify(rows,null,2);
  }
  status.textContent=`Complete: ${rows.filter(r=>r.status==='PASS').length}/${rows.length} passed. WebGL rendering is a separate check.`;button.disabled=false;
});
