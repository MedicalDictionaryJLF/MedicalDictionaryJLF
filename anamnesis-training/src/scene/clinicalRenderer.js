import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { derivePatientAffect } from '../interaction/patientAffect.js';
import { getPatientAsset, resolveVisualState, reportedVital } from './patientAssets.js?v=clinical-3d-3';
import { EXAM_SITES, ECG_LEADS, getBedsideFinding, attemptLeadPlacement } from './bedsideInteractions.js?v=clinical-exam-5';
import { createLandmarkResolver } from './patientLandmarks.js';
import { buildBedPositions } from './abdominalPosition.js?v=bed-contact';
import { playBedsideAudio, stopBedsideAudio, setBedsideVolume, closeBedsideAudio } from './bedsideAudio.js';

const clamp=(n,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(n)?n:min));
const smooth=(v,target,dt,rate=5)=>THREE.MathUtils.lerp(v,target,1-Math.exp(-dt*rate));
const TRAINER_POSITIONS = { seated: 'PositionSeated', standing: 'PositionStanding', reclined: 'PositionReclined', abdominal: 'PositionAbdominal' };
const isSupine = position => position === 'reclined' || position === 'abdominal';
const VISEMES=['viseme_aa','viseme_E','viseme_O','viseme_PP','viseme_FF','viseme_SS'];
const FACE_KEYS=['eyeBlinkLeft','eyeBlinkRight','eyeSquintLeft','eyeSquintRight','browDownLeft','browDownRight','browInnerUp','mouthPressLeft','mouthPressRight','mouthFrownLeft','mouthFrownRight','jawOpen','mouthPucker',...VISEMES,'eyeLookDownLeft','eyeLookDownRight','eyeLookUpLeft','eyeLookUpRight','eyeLookInLeft','eyeLookInRight','eyeLookOutLeft','eyeLookOutRight'];

/** Owns one patient and one room. Preview controls never mutate clinical state. */
export class Patient3DRenderer {
  constructor(container,options={}) {
    Object.assign(this,{container,options,activeCase:options.activeCase,snapshot:null,loader:new GLTFLoader(),clock:new THREE.Clock(),actions:new Map(),slots:new Map(),morphMeshes:[],bones:new Map(),skinMaterials:[],mode:'case',positionOverride:null,speech:{active:false,text:'',index:0,boundary:0},affect:{},values:{pain:0,breath:0,sweat:0,pallor:0},elapsed:0,loaded:false,disposed:false,running:false,inView:true,inspectionEnabled:false,examTool:'off',selectedLead:null,placedLeads:{},abort:new AbortController(),demoClip:null,focusMode:'face',frames:0});
    this.inTrainer = Boolean(options.trainingMode);
    this.positionOverride = this.inTrainer && Object.hasOwn(TRAINER_POSITIONS, options.patientPosition) ? options.patientPosition : null;
    this.asset=getPatientAsset(this.activeCase);
    this.interactionEnabled=options.allowInspection!==false&&!options.completed;
    this.ecgCompletionEmitted=Boolean(options.ecgCompleted);
    this.failed=false;this.volume=.6;this.activePointers=new Set();
  }

  async init() {
    if (!this.container) throw new Error('Missing 3D patient container.');
    try {
      this.setupRenderer();this.setupScene();this.setupInterface();
      const load=async(url,key)=>{
        const loaded=await this.loader.loadAsync(url);
        if(this.disposed||this.failed){this.disposeObject(loaded.scene);throw new Error('Stale 3D asset load discarded');}
        this[key]=loaded.scene;this.scene.add(loaded.scene);return loaded;
      };
      let timeout;
      const [character,room]=await Promise.race([
        Promise.all([load(this.asset.characterUrl,'patient'),load(this.asset.environmentUrl,'environment')]),
        new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Patient/room asset loading timed out')),25000);})
      ]).finally(()=>clearTimeout(timeout));
      if (this.disposed) {this.disposeObject(character.scene);this.disposeObject(room.scene);return false;}
      this.patient=character.scene;this.environment=room.scene;this.patient.name=`Patient_${this.asset.slug}`;
      this.scene.add(this.environment,this.patient);this.prepareAssets(character);
      if (this.options.allowInspection !== false) this.createInspectionPoints();
      this.prepareAnimations(character.animations);
      const missing=['PositionStanding','PositionSeated','PositionReclined','IdleBreathing','RespiratoryEffort','RestArms','ChestPain','Blink','Talking','PainExpression'].filter(n=>!this.actions.has(n));
      if (missing.length) throw new Error(`Character animation clips missing: ${missing.join(', ')}`);
      this.setSlot('breath','IdleBreathing',0);this.setSlot('arms','RestArms',0);this.updateState(true);
      this.mixer.update(0);this.resize();this.focus(this.options.initialView || (this.inTrainer ? 'patient' : 'face'),true);
      this.loadingElement.remove();this.loaded=true;this.running=true;this.clock.start();
      this.container.dataset.patient=this.asset.slug;this.container.dataset.loaded='true';this.container.dataset.visualMode='3d';this.container.dataset.release='clinical-3d-3';
      this.status('3D patient ready');this.renderLoop();
      if(this.failed||this.disposed)return false;
      this.container.dispatchEvent(new CustomEvent('patient3d-ready',{detail:this.getDiagnostics(),bubbles:true}));
      return true;
    } catch (error) {this.running=false;this.loaded=false;throw error;}
  }

  setupRenderer() {
    this.container.replaceChildren();this.container.classList.add('patient-3d-active');
    this.canvas=document.createElement('canvas');this.canvas.className='patient-3d-canvas';this.canvas.tabIndex=0;
    this.canvas.setAttribute('aria-label','Interactive 3D patient view. Drag to rotate, two fingers or right-drag to pan, scroll or pinch to zoom.');
    this.container.append(this.canvas);this.loadingElement=document.createElement('div');this.loadingElement.className='patient-3d-loading';
    this.loadingElement.innerHTML='<span></span><strong>Loading patient and room…</strong>';this.loadingElement.setAttribute('role','status');this.container.append(this.loadingElement);
    this.renderer=new THREE.WebGLRenderer({canvas:this.canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{this.shaderError=new Error(`3D shader compilation failed: ${gl.getProgramInfoLog(program)}; vertex: ${gl.getShaderInfoLog(vertex)}; fragment: ${gl.getShaderInfoLog(fragment)}`);};
    Object.assign(this.renderer,{outputColorSpace:THREE.SRGBColorSpace,toneMapping:THREE.ACESFilmicToneMapping,toneMappingExposure:.93});
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.setQuality(this.options.quality || (matchMedia('(max-width:700px)').matches?'mobile':'balanced'));
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(this.container);
    this.intersectionObserver=new IntersectionObserver(entries=>{this.inView=entries[0]?.isIntersecting ?? true;});this.intersectionObserver.observe(this.container);
    this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.fail(new Error('WebGL context lost'));},{signal:this.abort.signal});
  }

  setupScene() {
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#c7d2d0');this.camera=new THREE.PerspectiveCamera(36,1,.03,35);
    this.controls=new OrbitControls(this.camera,this.canvas);
    Object.assign(this.controls,{enableDamping:true,dampingFactor:.085,minDistance:.38,maxDistance:8,minPolarAngle:.05,maxPolarAngle:Math.PI*.49,screenSpacePanning:true});
    this.scene.add(new THREE.HemisphereLight(0xe8f2ff,0x707b71,1.45));
    this.key=new THREE.DirectionalLight(0xfff5e8,this.asset.dimmedLighting?1.55:2.3);this.key.position.set(1.5,4.5,3.5);this.key.castShadow=true;
    this.key.shadow.mapSize.set(1024,1024);this.key.shadow.normalBias=.035;
    Object.assign(this.key.shadow.camera,{left:-3.1,right:3.1,top:3,bottom:-3,near:.2,far:12});this.scene.add(this.key);
    const fill=new THREE.DirectionalLight(0xc7e1ed,.7);fill.position.set(-3,2.6,1.5);this.scene.add(fill);
    const rim=new THREE.DirectionalLight(0xf7ffff,.7);rim.position.set(-1.6,3,-2);this.scene.add(rim);
  }

  setupInterface() {
    const toolbar=document.createElement('div');toolbar.className='patient3d-toolbar';toolbar.setAttribute('aria-label','3D patient controls');
    toolbar.innerHTML=`<div class="patient3d-view-buttons"><button type="button" data-focus="face" title="Frame the face">Face</button><button type="button" data-focus="patient">Patient</button><button type="button" data-focus="back">Back</button><button type="button" data-focus="room">Room</button><button type="button" data-inspect aria-pressed="false">Examine</button><button type="button" data-expand aria-label="Expand patient view">⛶</button></div><div class="patient3d-options"><label data-animation-control><span>Animation</span><select data-animation-mode aria-label="Clinical animation mode"><option value="case">Follow case</option><option value="resting">Resting preview</option><option value="symptomatic">Symptom preview</option></select></label><label><span>Position</span><select data-position aria-label="Patient position"><option value="case">Follow case</option><option value="standing">Standing</option><option value="seated">Seated</option><option value="reclined">Reclined</option></select></label><label data-exam-control hidden><span>Technique</span><select data-exam-technique aria-label="Examination technique"><option value="inspect">Inspect</option><option value="auscultate">Auscultate</option><option value="palpate">Palpate</option><option value="percuss">Percuss</option><option value="ecg">ECG leads</option></select></label></div>`;
    this.toolbar=toolbar;this.container.append(toolbar);this.message=document.createElement('div');this.message.className='patient3d-message';this.message.setAttribute('aria-live','polite');this.container.append(this.message);
    if (this.inTrainer) {
      toolbar.querySelector('[data-position]').parentElement.remove();
      toolbar.querySelector('[data-animation-control]').remove();
      if (this.options.trainingMode !== 'teaching') {
        toolbar.querySelector('[data-focus="back"]').remove();
        toolbar.querySelector('[data-expand]').remove();
        toolbar.querySelector('[data-inspect]').remove();
        toolbar.querySelector('.patient3d-options').remove();
      }
    }
    if (this.options.trainingMode === 'teaching') {
      const positions = document.createElement('div');
      positions.className = 'patient3d-view-buttons patient3d-position-buttons';
      positions.setAttribute('role', 'group');
      positions.setAttribute('aria-label', 'Patient position');
      positions.innerHTML = `
        <button type="button" data-position-button="seated">Sit</button>
        <button type="button" data-position-button="standing">Stand</button>
        <button type="button" data-position-button="reclined">Lie flat</button>
        <button type="button" data-position-button="abdominal">Lie with knees bent</button>`;
      toolbar.append(positions);
    }
    const positionControl = toolbar.querySelector('[data-position]');
    if (this.options.allowInspection === false) toolbar.querySelector('[data-inspect]')?.remove();
    else positionControl?.add(new Option('Supine · knees flexed', 'abdominal'));
    toolbar.addEventListener('click', e => {
      const button = e.target.closest('button');
      if (!button) return;
      if (button.dataset.focus) this.focus(button.dataset.focus);
      if (button.dataset.positionButton && this.options.trainingMode === 'teaching') {
        this.container.dispatchEvent(new CustomEvent('patient3d-position-control', {
          bubbles: true, detail: { position: button.dataset.positionButton }
        }));
      }
      if (button.hasAttribute('data-inspect')) this.toggleInspection();
      if (button.hasAttribute('data-expand')) this.toggleExpanded();
    }, { signal: this.abort.signal });
    toolbar.querySelector('[data-animation-mode]')?.addEventListener('change', e => this.setClinicalMode(e.target.value), { signal: this.abort.signal });
    positionControl?.addEventListener('change', e => this.setPosition(e.target.value), { signal: this.abort.signal });
    toolbar.querySelector('[data-exam-technique]')?.addEventListener('change', e => this.setExaminationTool(e.target.value), { signal: this.abort.signal });
    this.canvas.addEventListener('pointerdown',e=>{
      this.activePointers.add(e.pointerId);
      if(this.activePointers.size!==1||e.button!==0){this.pointerDown=null;return;}
      this.pointerDown={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};
    },{signal:this.abort.signal});
    this.canvas.addEventListener('pointermove',e=>{if(this.pointerDown&&Math.hypot(e.clientX-this.pointerDown.x,e.clientY-this.pointerDown.y)>6)this.pointerDown.moved=true;},{signal:this.abort.signal});
    this.canvas.addEventListener('pointercancel',e=>{this.activePointers.delete(e.pointerId);this.pointerDown=null;},{signal:this.abort.signal});
    this.canvas.addEventListener('pointerup',e=>{
      const down=this.pointerDown;this.pointerDown=null;this.activePointers.delete(e.pointerId);
      if(!this.canExamine()||this.examTool==='off'||!down||down.id!==e.pointerId||down.moved||this.activePointers.size||Math.hypot(e.clientX-down.x,e.clientY-down.y)>6)return;
      this.updateMarkerVisibility();this.patient.updateMatrixWorld(true);
      const box=this.canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-box.left)/box.width*2-1,-(e.clientY-box.top)/box.height*2+1),this.camera);
      const markers=[...(this.inspectionPoints || []),...(this.leadPoints || [])].filter(p=>p.visible);
      let target=ray.intersectObjects(markers,false)[0]?.object;
      // Give a small projected landmark a usable tap area on narrow screens.
      if(!target&&e.pointerType==='touch'){
        let distance=16;
        for(const point of markers){
          const projected=point.getWorldPosition(new THREE.Vector3()).project(this.camera);
          if(Math.abs(projected.z)>1)continue;
          const d=Math.hypot(box.left+(projected.x+1)*box.width/2-e.clientX,box.top+(1-projected.y)*box.height/2-e.clientY);
          if(d<distance){target=point;distance=d;}
        }
      }
      if(target?.userData.siteId)this.examineSite(target.userData.siteId,'3d');
      if(target?.userData.leadId)this.placeLead(target.userData.leadId);
    },{signal:this.abort.signal});
    this.canvas.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&this.expanded)this.toggleExpanded();if(e.key.toLowerCase()==='f')this.focus('face');if(e.key.toLowerCase()==='r')this.focus('patient');
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
        e.preventDefault();const s=new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));s.theta+=e.key==='ArrowLeft'?.08:e.key==='ArrowRight'?-.08:0;s.phi=clamp(s.phi+(e.key==='ArrowUp'?-.08:e.key==='ArrowDown'?.08:0),.12,Math.PI*.49);this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(s));
      }
    },{signal:this.abort.signal});
  }

  prepareAssets(character) {
    for(const root of [this.patient,this.environment])root.traverse(o=>{
      if(o.isBone)this.bones.set(o.name,o);if(!o.isMesh)return;o.castShadow=true;o.receiveShadow=true;o.frustumCulled=!o.isSkinnedMesh;if(o.morphTargetDictionary)this.morphMeshes.push(o);
      for(const m of Array.isArray(o.material)?o.material:[o.material]){
        if(!m)continue;this.preparePatientMaterial(m);if(m.map)m.map.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
        if(m.name.startsWith('Skin_')){m.userData.baseColor=m.color.clone();m.userData.baseRoughness=m.roughness;this.skinMaterials.push(m);}
      }
    });
    for(const [key,name] of Object.entries({chair:'ExamChair',bed:'HospitalBed',ivStand:'IVEquipment',oxygenEquipment:'OxygenEquipment',monitor:'BedsideMonitor'}))this[key]=this.environment.getObjectByName(name);
    this.cover=this.environment.getObjectByName('FoldedCover');
    const screen=this.environment.getObjectByName('MonitorScreen');
    if(screen){this.monitorCanvas=document.createElement('canvas');this.monitorCanvas.width=512;this.monitorCanvas.height=320;this.monitorTexture=new THREE.CanvasTexture(this.monitorCanvas);this.monitorTexture.colorSpace=THREE.SRGBColorSpace;screen.material=new THREE.MeshBasicMaterial({map:this.monitorTexture});}
    this.createWearableEquipment();this.animationNames=character.animations.map(c=>c.name);
  }

  prepareAnimations(clips) {
    const reclined = clips.find(clip => clip.name === 'PositionReclined');
    if (reclined) {
      const includeBentPose = this.inTrainer || this.options.allowInspection !== false;
      clips = clips.flatMap(clip => clip === reclined
        ? buildBedPositions(this.patient, this.bones, reclined, this.bed, includeBentPose)
        : [clip]);
    }
    this.mixer = new THREE.AnimationMixer(this.patient);
    for (const clip of clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
  }

  preparePatientMaterial(material) {
    if(material.name==='PatientEyeCorneaClear'){
      // The atlas's lost corneal alpha must not turn a clear outer shell into
      // an opaque blue disk. Iris and sclera retain their opaque depth layer.
      material.transparent=false;material.opacity=0;material.depthWrite=true;material.depthTest=true;material.alphaTest=.34;material.side=THREE.FrontSide;material.needsUpdate=true;return;
    }
    const cutout=/^PatientBody\.(short|bob|ponytail|braid|eyebrow|eyelashes)/.test(material.name);
    const anatomy=/^Skin_|^PatientBody\.(high-poly|teeth|tongue|shoes)/.test(material.name);
    if(!cutout&&!anatomy)return;
    // Skin and internal anatomy must participate in the depth buffer. BLEND
    // materials let eyes/teeth and far-side skin draw over the front of a face.
    material.transparent=false;material.opacity=1;material.depthWrite=true;material.depthTest=true;
    material.alphaTest=cutout?.34:0;material.side=cutout?THREE.DoubleSide:THREE.FrontSide;
    if(cutout)material.roughness=.78;
    material.needsUpdate=true;
  }

  createWearableEquipment() {
    this.wearables={};
    const add=(name,boneName,geometry,color,position)=>{const bone=this.bones.get(boneName);if(!bone)return;const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,roughness:.58}));mesh.name=name;mesh.position.set(...position);bone.add(mesh);this.wearables[name]=mesh;};
    add('bpCuff','upperarm_l',new THREE.CylinderGeometry(.049,.049,.085,24,1,true),0x344653,[0,.12,0]);add('spo2Probe','index_03_r',new THREE.BoxGeometry(.017,.028,.022),0xdddde2,[0,.008,0]);add('ivAccess','lowerarm_l',new THREE.BoxGeometry(.035,.055,.003),0xe8e2cc,[0,.18,-.028]);
    const head=this.bones.get('head');if(head){const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(-.075,.055,.064),new THREE.Vector3(-.055,.025,.086),new THREE.Vector3(0,.015,.105),new THREE.Vector3(.055,.025,.086),new THREE.Vector3(.075,.055,.064)]);const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,24,.0018,5,false),new THREE.MeshStandardMaterial({color:0xa4d7da,roughness:.3}));mesh.name='oxygen';head.add(mesh);this.wearables.oxygen=mesh;}
  }

  createInspectionPoints() {
    const resolve = createLandmarkResolver(this.patient, this.bones);
    const marker = (definition, key, label, color, radius) => {
      const anchor = resolve(definition.anchor);
      if (!anchor?.bone) throw new Error(`Anatomical surface not found for ${definition.id}`);
      const geometry = new THREE.SphereGeometry(radius, 12, 8);
      const material = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: .9, toneMapped: false });
      const point = new THREE.Mesh(geometry, material);
      point.renderOrder = 20;
      point.position.copy(anchor.offset);
      point.visible = false;
      point.userData = { [key]: definition.id, label, normal: definition.anchor.surface ? anchor.normal : null };
      anchor.bone.add(point);
      return point;
    };
    this.inspectionPoints = EXAM_SITES.map(site => marker(site, 'siteId', site.label, 0x53e4cc, site.id === 'general' ? .023 : .016));
    this.leadPoints = ECG_LEADS.map(lead => marker(lead, 'leadId', lead.hint, lead.color, .013));
    this.inspectionList = document.createElement('div');
    this.inspectionList.className = 'patient3d-inspection-list patient3d-bedside-panel';
    this.inspectionList.hidden = true;
    this.placeBedsideControls();
    this.inspectionList.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;
      if(button.dataset.examSite){const site=EXAM_SITES.find(item=>item.id===button.dataset.examSite);if(site?.view==='back')this.focus('back');this.examineSite(button.dataset.examSite,'accessible');}
      if(button.dataset.selectLead){this.selectedLead=button.dataset.selectLead;this.renderBedsidePanel();this.status(`${this.selectedLead}: choose the anatomical position`);}
      if(button.dataset.leadTarget)this.placeLead(button.dataset.leadTarget);
      if(button.hasAttribute('data-reset-leads')&&this.canExamine()){this.placedLeads={};this.selectedLead=null;this.emitEcgProgress({reset:true});this.renderBedsidePanel();this.status('ECG placement reset. Previously completed procedures remain in the clinical record.');}
      if(button.hasAttribute('data-audio-play'))this.playExaminationSound();
      if(button.hasAttribute('data-audio-stop'))stopBedsideAudio();
    },{signal:this.abort.signal});
    this.inspectionList.addEventListener('input',event=>{if(event.target.matches('[data-audio-volume]')){this.volume=Number(event.target.value);setBedsideVolume(this.volume);}},{signal:this.abort.signal});
  }

  placeBedsideControls() {
    if (!this.inspectionList) return;
    const dock = this.expanded ? null : this.options.bedsideControls;
    this.inspectionList.classList?.toggle('patient3d-bedside-docked', Boolean(dock));
    (dock || this.container).append(this.inspectionList);
  }

  canExamine(){return this.loaded&&!this.disposed&&!this.failed&&this.interactionEnabled;}
  setInteractionEnabled(enabled){this.interactionEnabled=Boolean(enabled)&&this.options.allowInspection!==false;if(!enabled)this.setExaminationTool('off');this.syncPositionButtons();const button=this.toolbar?.querySelector('[data-inspect]');if(button)button.disabled=!this.interactionEnabled;}
  inspect(id){return this.examineSite(id);}
  toggleInspection(enabled=this.examTool==='off'){return this.setExaminationTool(enabled?'inspect':'off');}
  setExaminationTool(tool='off'){
    if(tool!=='off'&&!this.canExamine())return false;
    stopBedsideAudio();
    this.selectedSite=null;this.lastExamination=null;
    this.examTool=['inspect','auscultate','palpate','percuss','ecg'].includes(tool)?tool:'off';this.inspectionEnabled=this.examTool!=='off';
    this.toolbar?.querySelector('[data-inspect]')?.setAttribute('aria-pressed',String(this.inspectionEnabled));
    const examControl = this.toolbar?.querySelector('[data-exam-control]');
    if (examControl) {
      examControl.hidden = !this.inspectionEnabled;
      if (this.inspectionEnabled) this.toolbar.querySelector('[data-exam-technique]').value = this.examTool;
    }
    this.updateMarkerVisibility();this.renderBedsidePanel();if(this.inspectionEnabled)this.focus('patient');
    return true;
  }
  updateMarkerVisibility(){
    if(!this.patient||!this.camera)return;
    this.patient.updateMatrixWorld(true);
    for(const point of [...(this.inspectionPoints||[]),...(this.leadPoints||[])]){
      const site=EXAM_SITES.find(s=>s.id===point.userData.siteId);
      let visible=this.canExamine()&&(site?this.examTool!=='ecg'&&site.techniques.includes(this.examTool):this.examTool==='ecg');
      if(visible&&site?.view==='back'&&isSupine(this.actualPosition))visible=false;
      if(visible&&point.userData.normal){
        const normal=point.userData.normal.clone().transformDirection(point.parent.matrixWorld);
        const towardCamera=this.camera.position.clone().sub(point.getWorldPosition(new THREE.Vector3())).normalize();
        visible=normal.dot(towardCamera)>.05;
      }
      point.visible=visible;
      point.scale.setScalar(point.userData.siteId===this.selectedSite?1.25:this.placedLeads[point.userData.leadId]?1.18:1);
      if(point.userData.leadId)point.material.opacity=this.placedLeads[point.userData.leadId]?1:.7;
    }
  }
  renderBedsidePanel(){
    if(!this.inspectionList)return;this.inspectionList.hidden=this.examTool==='off'||!this.canExamine();if(this.inspectionList.hidden)return;
    if(this.examTool==='ecg'){
      const count=ECG_LEADS.filter(l=>this.placedLeads[l.id]).length;
      this.inspectionList.innerHTML=`<strong>12-lead ECG · ${count}/10 electrodes</strong><span class="patient3d-panel-help">Select an electrode, then place it on the patient. Patient left and right follow anatomy.</span><div class="patient3d-lead-tray">${ECG_LEADS.map(l=>`<button type="button" data-select-lead="${l.id}" ${this.placedLeads[l.id]?'disabled':''} aria-pressed="${this.selectedLead===l.id}"${this.options.trainingMode==='exam'?'':` title="${l.hint}"`}><i style="background:${l.color}"></i>${l.id}${this.placedLeads[l.id]?' ✓':''}</button>`).join('')}</div><details><summary>Choose anatomical target with keyboard</summary><div class="patient3d-targets">${this.selectedLead?ECG_LEADS.map(l=>`<button type="button" data-lead-target="${l.id}" aria-label="Place selected electrode at ${l.hint}">${l.hint}</button>`).join(''):'Select an electrode first.'}</div></details><button type="button" data-reset-leads class="patient3d-reset">Reset placements</button>`;
    }else{
      const points=EXAM_SITES.filter(s=>s.techniques.includes(this.examTool)&&this.inspectionPoints.some(p=>p.userData.siteId===s.id));
      this.inspectionList.innerHTML=`<strong>${this.examTool[0].toUpperCase()+this.examTool.slice(1)} · ${this.selectedSite?EXAM_SITES.find(s=>s.id===this.selectedSite)?.label||'choose a body site':'choose a body site'}</strong><details><summary>Choose anatomical site with keyboard</summary><div class="patient3d-site-buttons">${points.map(s=>`<button type="button" data-exam-site="${s.id}" aria-pressed="${this.selectedSite===s.id}">${s.label}${s.view==='back'?' · back':''}</button>`).join('')}</div></details>${this.lastExamination?.technique===this.examTool&&['auscultate','percuss'].includes(this.examTool)?(this.lastExamination.sound?`<details class="patient3d-audio"><summary>Sound controls · synthesized</summary><div class="patient3d-audio-controls"><span>Educational approximation; no patient recording.</span><button type="button" data-audio-play>Play / repeat sound</button><button type="button" data-audio-stop>Stop</button><label>Volume <input data-audio-volume type="range" min="0" max="1" step="0.05" value="${this.volume}" aria-label="Examination sound volume"></label></div></details>`:'<small class="patient3d-panel-help">No sound is authored for this site.</small>'):''}`;
    }
  }
  examineSite(id,input='3d'){
    if(!this.canExamine())return {ok:false,reason:'3D environment unavailable or attempt completed.'};
    const result=getBedsideFinding(this.activeCase,id,this.examTool);if(!result)return {ok:false,reason:'This technique is not valid at the selected site.'};
    if (this.examTool === 'palpate' && result.examinationId === 'abdomen' && this.actualPosition !== 'abdominal') {
      if (this.inTrainer) {
        const reason = this.options.trainingMode === 'exam'
          ? 'The patient is not positioned for abdominal palpation.'
          : 'Ask the patient in chat to lie on their back and bend their knees slightly before palpating.';
        this.status(reason);
        return { ok: false, reason };
      }
      this.setPosition('abdominal');
      this.status('Patient supine with knees slightly flexed. Select the abdominal site again to palpate.');
      return { ok: false, repositioned: true };
    }
    if (this.inTrainer && isSupine(this.actualPosition) && EXAM_SITES.find(site => site.id === id)?.view === 'back') {
      const reason = 'Ask the patient in chat to sit up before examining their back.';
      this.status(reason);
      return { ok: false, reason };
    }
    result.audioNote=result.sound?.label||(['auscultate','percuss'].includes(this.examTool)?'No sound is authored for this technique and site.':'');
    result.position=this.actualPosition;result.input=input;
    this.selectedSite=id;this.lastExamination=result;
    this.status(`${result.siteLabel} · ${result.finding}`);this.renderBedsidePanel();
    if(result.sound && this.options.autoPlayAudio!==false)this.playExaminationSound();
    this.container.dispatchEvent(new CustomEvent('patient3d-examination',{detail:result,bubbles:true}));this.options.onExamination?.(result);
    const reaction=result.response||result.presentationResponse;
    if(reaction){this.examinationReaction={...reaction,until:this.elapsed+2.2};this.status(`${result.siteLabel} · ${result.finding} ${reaction.text||''}`);}
    this.updateMarkerVisibility();return {ok:true,...result};
  }
  playExaminationSound(){if(!this.canExamine()||!this.lastExamination?.sound)return;playBedsideAudio(this.lastExamination.technique,this.lastExamination.siteId,{sound:this.lastExamination.sound,volume:this.volume}).catch(error=>{console.info('Examination audio unavailable',error);this.status('Sound playback is unavailable. The acquired finding is preserved.');});}
  emitEcgProgress(detail={}){this.container.dispatchEvent(new CustomEvent('patient3d-ecg-progress',{bubbles:true,detail:{...detail,caseId:this.activeCase.id,placedLeads:Object.keys(this.placedLeads)}}));}
  placeLead(targetId){
    if(!this.canExamine()||this.examTool!=='ecg')return {ok:false,reason:'ECG placement requires the live 3D environment.'};
    const selectedId=this.selectedLead,result=attemptLeadPlacement(this.placedLeads,selectedId,targetId);
    if(selectedId&&ECG_LEADS.some(l=>l.id===targetId))this.emitEcgProgress({selectedId,targetId,correct:result.ok});
    if(!result.ok){this.status(this.options.trainingMode==='exam'?'Electrode placement is incorrect. Choose another anatomical site.':result.reason);return result;}
    this.selectedLead=null;this.renderBedsidePanel();this.updateMarkerVisibility();this.status(result.completed?'All 10 electrodes placed.':`${targetId} placed · ${result.count}/10`);
    if(result.completed&&!this.ecgCompletionEmitted){this.ecgCompletionEmitted=true;const detail={caseId:this.activeCase.id,hasRecording:Boolean(this.activeCase.ecg?.available),placedLeads:Object.keys(this.placedLeads)};this.container.dispatchEvent(new CustomEvent('patient3d-ecg-complete',{detail,bubbles:true}));this.options.onEcgComplete?.(detail);}
    return result;
  }
  restorePlacedLeads(ids=[]){this.placedLeads=Object.fromEntries(ECG_LEADS.filter(item=>ids.includes(item.id)).map(item=>[item.id,true]));this.selectedLead=null;this.renderBedsidePanel();this.updateMarkerVisibility();}
  setSnapshot(snapshot){if(snapshot?.caseId&&snapshot.caseId!==this.activeCase.id)return;this.snapshot=snapshot;this.updateState();}

  updateState(immediate=false) {
    this.visual=resolveVisualState(this.activeCase,this.snapshot,this.mode);if(!this.mixer)return;
    const position=this.positionOverride || (this.inTrainer ? 'seated' : this.visual.position || this.asset.preferredPosition),changed=position!==this.actualPosition;this.actualPosition=position;
    // Move pose and furniture together. Interpolating a standing body through
    // an already-positioned mattress causes visible body/bed intersections.
    const clip = TRAINER_POSITIONS[position];
    if (changed || immediate) this.syncPositionButtons();
    this.setSlot('posture',clip,0);
    if(this.chair)this.chair.visible=position==='seated';
    if(this.bed)this.bed.position.set(isSupine(position)?0:1.55,0,isSupine(position)?0:-.45);
    if(changed&&(this.inTrainer||position==='abdominal'))this.setSlot('arms','RestArms',0);
    // The existing flat bedspread stays on the mattress below the clothed
    // patient. It is not raised through the abdomen, shoulders or neck.
    if(changed||immediate){this.mixer.update(0);this.patient?.updateMatrixWorld(true);}
    const e=this.visual.equipment;for(const [key,mesh] of Object.entries(this.wearables || {}))mesh.visible=Boolean(e[key] || key==='spo2Probe'&&e.monitor);
    if(this.ivStand)this.ivStand.visible=Boolean(e.ivAccess || e.infusion);if(this.oxygenEquipment)this.oxygenEquipment.visible=Boolean(e.oxygen);if(this.monitor)this.monitor.visible=Boolean(e.monitor || e.telemetry);this.drawMonitor();
  }

  setSlot(slot,name,fade=.6){if(this.slots.get(slot)===name)return;const a=this.actions.get(name);if(!a)return;const previous=this.actions.get(this.slots.get(slot));if(fade)previous?.fadeOut(fade);else previous?.stop();if(slot==='posture')for(const [key,action] of this.actions)if(key.startsWith('Position')&&key!==name)action.stop();a.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();if(fade)a.fadeIn(fade);this.slots.set(slot,name);}
  setClinicalMode(mode='case'){this.stopDemo();this.mode=['case','resting','symptomatic'].includes(mode)?mode:'case';this.toolbar.querySelector('[data-animation-mode]').value=this.mode;this.updateState();this.status(this.mode==='case'?'Following the clinical case':this.mode==='resting'?'Resting animation preview · case unchanged':'Documented symptom preview · case unchanged');}
  syncPositionButtons() {
    this.toolbar?.querySelectorAll('[data-position-button]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.positionButton === this.actualPosition));
      button.disabled = Boolean(this.options.completed);
    });
  }

  applyPositionRequest(position) {
    if (!this.inTrainer || this.options.completed || !this.loaded ||
        this.failed || this.disposed || !Object.hasOwn(TRAINER_POSITIONS, position) ||
        !this.actions.has(TRAINER_POSITIONS[position])) return false;
    this.positionOverride = position;
    this.updateState(true);
    this.focus('patient');
    this.updateMarkerVisibility();
    return true;
  }

  setPosition(position='case'){
    if (this.inTrainer) return;
    this.stopDemo();
    const supported = ['standing', 'seated', 'reclined'].includes(position) || (position === 'abdominal' && this.actions.has('PositionAbdominal'));
    this.positionOverride = supported ? position : null;
    this.toolbar.querySelector('[data-position]').value = this.positionOverride || 'case';
    this.updateState(true);
    this.focus('patient');
    this.updateMarkerVisibility();
    if(this.positionOverride)this.status(position === 'abdominal' ? 'Abdominal examination position. The patient is supine with knees slightly flexed.' : 'Position preview · clinical state unchanged');
  }
  setViewMode(mode='encounter'){
    if (mode !== 'examination' && this.examTool !== 'off') this.setExaminationTool('off');
    this.focus(mode === 'examination' || this.inTrainer ? 'patient' : 'face');
  }
  focus(mode='face',immediate=false){
    if(!this.camera||!this.controls)return;this.focusMode=mode;this.patient?.updateMatrixWorld(true);
    const reclined=isSupine(this.actualPosition);
    if(!this.inTrainer&&mode==='back'&&reclined){this.setPosition('seated');return this.focus('back',immediate);}
    if(mode==='room'){
      this.controls.target.set(.1,.9,-.3);this.camera.position.copy(this.controls.target).add(new THREE.Vector3(3.7,2.2,4.7));
    }else{
      let bounds,direction;
      if(mode==='face'){
        const head=this.bones.get('head')?.getWorldPosition(new THREE.Vector3()) || new THREE.Vector3(0,1.55,0);
        head.add(reclined?new THREE.Vector3(0,.035,-.065):new THREE.Vector3(0,.065,.01));
        bounds=new THREE.Box3().setFromCenterAndSize(head,new THREE.Vector3(.36,.40,.36));
        direction=reclined?new THREE.Vector3(.12,.85,.36):new THREE.Vector3(.22,.07,1);
      }else{
        bounds=new THREE.Box3();this.patient?.traverse(object=>{if(!object.isSkinnedMesh)return;object.skeleton.update();object.computeBoundingBox();bounds.union(object.boundingBox.clone().applyMatrix4(object.matrixWorld));});
        if(bounds.isEmpty())bounds.setFromCenterAndSize(new THREE.Vector3(0,.85,0),new THREE.Vector3(.7,1.7,.5));
        if (mode === 'back') direction = new THREE.Vector3(-.35, .18, -1);
        else if (this.actualPosition === 'abdominal' && this.examTool === 'palpate') direction = new THREE.Vector3(-1.25, 2.4, 1.45);
        else direction = reclined ? new THREE.Vector3(.85, 2.6, 2.1) : new THREE.Vector3(.42, .18, 1);
      }
      this.frameBounds(bounds,direction);
    }
    this.controls.update();this.toolbar?.querySelectorAll('[data-focus]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.focus===mode)));if(!immediate)this.status(mode==='face'?'Face view':mode==='room'?'Hospital room':mode==='back'?'Posterior patient view':'Full patient view');
  }

  frameBounds(bounds,direction){
    direction.normalize();const right=new THREE.Vector3().crossVectors(this.camera.up,direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right).normalize(),target=bounds.getCenter(new THREE.Vector3()),corners=[];
    let low=Infinity,high=-Infinity;
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){const corner=new THREE.Vector3(x,y,z);corners.push(corner);const projection=corner.clone().sub(target).dot(up);low=Math.min(low,projection);high=Math.max(high,projection);}
    // Keep the examination targets below the toolbar, including when it wraps.
    let topInset = 0;
    if (this.inspectionEnabled && this.canvas && this.toolbar) {
      const view = this.canvas.getBoundingClientRect();
      topInset = clamp((this.toolbar.getBoundingClientRect().bottom - view.top + 8) / view.height, 0, .4);
    }
    const targetBias = Math.max(.1, topInset / (2 * (1 - topInset)));
    target.addScaledVector(up, (high - low) * targetBias);
    const tangent = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    let distance = .5;
    for (const corner of corners) {
      const delta = corner.sub(target), depth = delta.dot(direction);
      const vertical = delta.dot(up);
      const verticalFit = vertical > 0 ? vertical / (1 - 2 * topInset) : -vertical;
      const horizontalFit = Math.abs(delta.dot(right)) / Math.max(.2, this.camera.aspect);
      distance = Math.max(distance, depth + Math.max(verticalFit, horizontalFit) / tangent);
    }
    this.controls.target.copy(target);this.camera.position.copy(target).addScaledVector(direction,distance*1.2);
  }
  setQuality(quality='balanced'){this.quality=quality;if(!this.renderer)return;this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,quality==='mobile'?1:quality==='high'?2:1.5));this.renderer.shadowMap.enabled=quality!=='mobile';this.resize();}
  resize(){if(!this.renderer||!this.camera)return;const w=Math.max(1,this.container.clientWidth),h=Math.max(1,this.container.clientHeight),changed=Math.abs(this.camera.aspect-w/h)>.005;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();if(changed&&this.loaded)this.focus(this.focusMode,true);}
  toggleExpanded(){this.expanded=!this.expanded;this.container.classList.toggle('patient3d-expanded',this.expanded);this.toolbar.querySelector('[data-expand]').setAttribute('aria-label',this.expanded?'Restore patient view':'Expand patient view');this.placeBedsideControls();this.resize();}
  setSpeaking(active,text=''){this.stopDemo();this.speech.active=Boolean(active);if(active)this.speech={active:true,text,index:0,boundary:this.elapsed};}
  pulseSpeechBoundary(e={}){if(Number.isFinite(e.charIndex))this.speech.index=e.charIndex;this.speech.boundary=this.elapsed;}
  reactToReply(text='',result={}){this.affect=derivePatientAffect({reply:text,studentInput:result.studentInput || '',rapport:result.rapport ?? 70,snapshot:this.snapshot,casePersonality:this.activeCase.personality});}
  reactToExamination(id=''){if(id==='general')this.focus('face');if(['respiratory','abdomen','legs','perfusion'].includes(id))this.focus('patient');}
  setEmotion(emotion='neutral'){this.emotion=emotion;}
  triggerPose(type){const name={chest:'ChestPain',abdomen:'AbdominalGuard',flank:'FlankGuard',headache:'Headache'}[type];if(name)this.playAnimation(name);}
  playAnimation(name){this.stopDemo();const a=this.actions.get(name);if(!a)return false;if(name.startsWith('Position')){this.setPosition(name.replace('Position','').toLowerCase());return true;}const slot=['RestArms','ChestPain','AbdominalGuard','FlankGuard','Headache'].includes(name)?'arms':['IdleBreathing','RespiratoryEffort'].includes(name)?'breath':name==='Fatigue'?'head':null;if(slot)this.actions.get(this.slots.get(slot))?.stop();a.reset().setEffectiveWeight(1).setLoop(THREE.LoopRepeat).play();this.demoClip=name;this.status(`${name.replace(/([a-z])([A-Z])/g,'$1 $2')} · animation preview`);return true;}
  stopDemo(){if(!this.demoClip)return;this.actions.get(this.demoClip)?.stop();this.demoClip=null;for(const name of this.slots.values())this.actions.get(name)?.reset().setEffectiveWeight(1).play();}

  applyFace(dt) {
    if(this.demoClip&&['Blink','Talking','PainExpression','EyeMovement'].includes(this.demoClip))return;
    const v=Object.fromEntries(FACE_KEYS.map(n=>[n,0])),phase=this.elapsed%4.3,pain=this.values.pain;
    const blink=phase>3.8&&phase<4.02?Math.sin((phase-3.8)/.22*Math.PI):0;v.eyeBlinkLeft=v.eyeBlinkRight=this.visual?.consciousness==='unconscious'?1:blink;
    v.browDownLeft=v.browDownRight=pain*.43;v.browInnerUp=pain*.21+(this.affect.anxiety || 0)*.06;v.eyeSquintLeft=v.eyeSquintRight=pain*.22;v.mouthPressLeft=v.mouthPressRight=pain*.24;v.mouthFrownLeft=v.mouthFrownRight=pain*.1;
    const emotion=this.mode==='resting'?'neutral':this.affect.emotion || this.emotion;
    if(emotion==='anxious'){v.browInnerUp=Math.max(v.browInnerUp,.24);v.mouthFrownLeft=Math.max(v.mouthFrownLeft,.1);v.mouthFrownRight=Math.max(v.mouthFrownRight,.1);}
    if(emotion==='irritated'){v.browDownLeft=Math.max(v.browDownLeft,.38);v.browDownRight=Math.max(v.browDownRight,.38);v.mouthPressLeft=Math.max(v.mouthPressLeft,.26);v.mouthPressRight=Math.max(v.mouthPressRight,.26);}
    if(emotion==='sad'){v.browInnerUp=Math.max(v.browInnerUp,.24);v.mouthFrownLeft=Math.max(v.mouthFrownLeft,.2);v.mouthFrownRight=Math.max(v.mouthFrownRight,.2);}
    if(this.visual?.consciousness==='drowsy')v.eyeBlinkLeft=v.eyeBlinkRight=Math.max(v.eyeBlinkLeft,.35);
    const gaze=Math.sin(this.elapsed*.31)*.1;v[gaze>0?'eyeLookOutLeft':'eyeLookInLeft']=Math.abs(gaze);v[gaze>0?'eyeLookInRight':'eyeLookOutRight']=Math.abs(gaze);
    if(this.speech.active){
      // Browser speech has word boundaries, not phoneme timestamps. Sub-word
      // visemes are approximate and restrained, rather than claimed phoneme sync.
      const since=Math.max(0,this.elapsed-this.speech.boundary),i=Math.min(this.speech.text.length-1,this.speech.index+Math.floor(since*12)),ch=(this.speech.text[i] || 'a').toLowerCase();const shape=/[bmp]/.test(ch)?'viseme_PP':/[fv]/.test(ch)?'viseme_FF':/[ou]/.test(ch)?'viseme_O':/[ei]/.test(ch)?'viseme_E':/[szct]/.test(ch)?'viseme_SS':'viseme_aa';v[shape]=/\s|[.,!?]/.test(ch)?0:.27+Math.abs(Math.sin(this.elapsed*13))*.22;
    }
    for(const mesh of this.morphMeshes)for(const [name,value] of Object.entries(v)){const i=mesh.morphTargetDictionary[name];if(i!==undefined)mesh.morphTargetInfluences[i]=smooth(mesh.morphTargetInfluences[i],value,dt,name.startsWith('eyeBlink')?40:15);}
  }

  updateAnimation(dt) {
    const s=this.visual || resolveVisualState(this.activeCase,this.snapshot,this.mode);
    this.values.pain=smooth(this.values.pain,s.pain,dt);this.values.breath=smooth(this.values.breath,s.breathing,dt);this.values.sweat=smooth(this.values.sweat,s.sweating,dt);this.values.pallor=smooth(this.values.pallor,s.pallor,dt);
    if (!this.demoClip) {
      this.setSlot('breath',this.values.breath>.3?'RespiratoryEffort':'IdleBreathing',.8);
      const restingArms = this.inTrainer || this.actualPosition === 'abdominal' || this.values.pain <= .3;
      const gesture = this.examinationReaction?.until > this.elapsed ? this.examinationReaction.gesture : restingArms ? 'RestArms' : s.gesture;
      this.setSlot('arms', gesture, .25);
      if(s.fatigue>.1)this.setSlot('head','Fatigue',.8);
      this.actions.get('Fatigue')?.setEffectiveWeight(s.fatigue || 0);
    }
    this.mixer.update(dt);this.applyFace(dt);
    for(const m of this.skinMaterials){m.roughness=THREE.MathUtils.lerp(m.userData.baseRoughness,.34,this.values.sweat);m.color.copy(m.userData.baseColor).lerp(new THREE.Color('#e7d9c6'),this.values.pallor*.12);}
    if(this.asset.posturalDizziness&&this.actualPosition==='standing'&&this.mode!=='resting'){const root=this.bones.get('Root');if(root)root.rotation.z+=Math.sin(this.elapsed*1.1)*.006;}
    this.controls.update();
  }
  drawMonitor(){if(!this.monitorCanvas)return;const c=this.monitorCanvas.getContext('2d');c.fillStyle='#061511';c.fillRect(0,0,512,320);c.fillStyle='#8bcab3';c.font='20px sans-serif';c.fillText('BEDSIDE OBSERVATIONS',24,35);[['HR','hr','/min'],['SpO₂','spo2','%'],['RR','rr','/min']].forEach(([label,key,unit],i)=>{const value=reportedVital(this.activeCase,key,this.snapshot);c.fillStyle='#8faaa1';c.font='20px sans-serif';c.fillText(label,24,100+i*73);c.fillStyle='#b5edd0';c.font='bold 40px monospace';c.fillText(value==null?'—':String(Math.round(value)),210,103+i*73);c.font='16px sans-serif';c.fillText(value==null?'not documented':unit,320,100+i*73);});this.monitorTexture.needsUpdate=true;}
  fail(error){if(this.failed||this.disposed)return;this.failed=true;this.loaded=false;this.running=false;this.interactionEnabled=false;stopBedsideAudio();this.options.onError?.(error);}
  renderLoop(){if(!this.running||this.disposed||this.failed)return;try{const dt=Math.min(this.clock.getDelta(),.05);if(this.inView&&!document.hidden){this.elapsed+=dt;this.updateAnimation(dt);this.updateMarkerVisibility();this.renderer.render(this.scene,this.camera);if(this.shaderError)throw this.shaderError;this.frames++;}if(!this.failed&&!this.disposed)this.raf=requestAnimationFrame(()=>this.renderLoop());}catch(error){this.fail(error);}}
  status(text){if(this.message)this.message.textContent=text;this.options.onStatus?.(text);}
  getDiagnostics(){return {release:'clinical-3d-3',caseId:this.activeCase.id,character:this.asset.slug,room:this.asset.room,loaded:this.loaded,animations:this.animationNames || [],skinnedMeshes:this.patient?this.collect(this.patient,o=>o.isSkinnedMesh).length:0,facialMeshes:this.morphMeshes.length,bones:this.bones.size,examSites:this.inspectionPoints?.length||0,ecgTargets:this.leadPoints?.length||0,ecgPlaced:Object.keys(this.placedLeads).length,position:this.actualPosition,frames:this.frames,triangles:this.renderer?.info.render.triangles || 0,quality:this.quality,speaking:this.speech.active,previewMode:this.mode,drawCalls:this.renderer?.info.render.calls || 0};}
  collect(root,predicate){const values=[];root.traverse(o=>{if(predicate(o))values.push(o);});return values;}
  disposeObject(root){const geometry=new Set(),materials=new Set(),textures=new Set();root?.traverse(o=>{if(o.geometry)geometry.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){if(!m)continue;materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}o.skeleton?.dispose?.();});for(const item of [...geometry,...materials,...textures])item.dispose();}
  dispose(){if(this.disposed)return;this.disposed=true;this.running=false;cancelAnimationFrame(this.raf);this.abort.abort();closeBedsideAudio();this.resizeObserver?.disconnect();this.intersectionObserver?.disconnect();this.controls?.dispose();this.mixer?.stopAllAction();if(this.patient)this.mixer?.uncacheRoot(this.patient);this.inspectionList?.remove();this.disposeObject(this.scene);this.renderer?.dispose();if(this.renderer&&!this.renderer.getContext().isContextLost())this.renderer.forceContextLoss();this.container?.classList.remove('patient-3d-active','patient3d-expanded');}
}
