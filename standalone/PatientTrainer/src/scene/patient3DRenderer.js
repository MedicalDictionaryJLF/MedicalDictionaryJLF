import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { derivePatientAffect } from '../interaction/patientAffect.js';

const PATIENT_URL = new URL('../../assets/3d/patient/scene.gltf', import.meta.url);
// Version the model request so replaced GLTF/material assets cannot be hidden by browser cache.
PATIENT_URL.searchParams.set('v', '20260916-age58-face-v2');
const BED_URL = new URL('../../assets/3d/bed/scene.gltf', import.meta.url);

const BONE = Object.freeze({
  hips: 'mixamorig_Hips_01',
  spine: 'mixamorig_Spine_02',
  spine1: 'mixamorig_Spine1_03',
  spine2: 'mixamorig_Spine2_04',
  neck: 'mixamorig_Neck_05',
  head: 'mixamorig_Head_06',
  rightEye: 'mixamorig_RightEye_08',
  leftEye: 'mixamorig_LeftEye_09',
  leftArm: 'mixamorig_LeftArm_011',
  leftForeArm: 'mixamorig_LeftForeArm_012',
  leftHand: 'mixamorig_LeftHand_013',
  rightArm: 'mixamorig_RightArm_035',
  rightForeArm: 'mixamorig_RightForeArm_036',
  rightHand: 'mixamorig_RightHand_037',
  leftUpLeg: 'mixamorig_LeftUpLeg_062',
  leftLeg: 'mixamorig_LeftLeg_063',
  rightUpLeg: 'mixamorig_RightUpLeg_058',
  rightLeg: 'mixamorig_RightLeg_00'
});

const clamp = (v, min, max) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
const lerp = (a, b, t) => a + (b - a) * t;

export class Patient3DRenderer {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.clock = new THREE.Clock();
    this.loader = new GLTFLoader();
    this.patient = null;
    this.bed = null;
    this.floorY = -0.46;
    this.patientContactInset = 0;
    this.patientSupportMeshes = [];
    this.blanketBaseY = 0;
    this.hairMaterials = [];
    this.apparentAge = Number(options?.activeCase?.identity?.age || 58);
    this.bones = new Map();
    this.baseBoneQuaternions = new Map();
    this.skinMaterials = [];
    this.snapshot = null;
    this.running = false;
    this.raf = null;
    this.resizeObserver = null;
    this.pointer = { down: false, x: 0, y: 0, yaw: 0, pitch: 0, zoom: 1 };
    this.pose = { chest: 0, abdomen: 0, targetChest: 0, targetAbdomen: 0, poseUntil: 0 };
    this.viewMode = 'encounter';
    this.speech = { active: false, text: '', startedAt: 0, boundaryPulse: 0 };
    this.affect = { emotion: 'neutral', distress: 0.15, pain: 0, anxiety: 0.4, trust: 0.6, gazeEngagement: 0.8, headTension: 0.1, mouthTension: 0.1, browTension: 0.1 };
    this.faceRig = {};
    this.casePersonality = options?.activeCase?.personality || {};
    this.room = {};
    this.equipment = {};
    this.loaded = false;
    this.fallbackReason = '';
  }

  async init() {
    if (!this.container) throw new Error('Missing patient scene container');
    if (!window.WebGL2RenderingContext) throw new Error('WebGL 2 is not supported');

    this.setupRenderer();
    this.setupScene();
    this.setupRoom();
    this.setupInteraction();

    const patientGltf = await this.loader.loadAsync(PATIENT_URL.href);

    this.patient = patientGltf.scene;
    this.preparePatient();
    this.createEquipment();
    this.frameScene();
    this.loadingElement?.remove();
    this.loadingElement = null;
    this.loaded = true;
    this.running = true;
    this.clock.start();
    this.renderLoop();
    return true;
  }

  setupRenderer() {
    this.container.innerHTML = '';
    this.container.classList.add('patient-3d-active');
    const canvas = document.createElement('canvas');
    canvas.className = 'patient-3d-canvas';
    canvas.setAttribute('aria-label', 'Interactive 3D patient on an emergency department bed');
    this.container.appendChild(canvas);
    const loading = document.createElement('div');
    loading.className = 'patient-3d-loading';
    loading.innerHTML = '<span></span><strong>Preparing 3D patient…</strong>';
    this.container.appendChild(loading);
    this.loadingElement = loading;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
  }

  setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe7eff4);
    this.scene.fog = new THREE.Fog(0xe7eff4, 7.5, 15);

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 30);
    this.camera.position.set(2.75, 2.15, 3.15);

    const hemi = new THREE.HemisphereLight(0xf7fbff, 0x889aa8, 1.85);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.25);
    key.position.set(3.5, 5.5, 2.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 15;
    key.shadow.camera.left = -4;
    key.shadow.camera.right = 4;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -4;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xbfd9e8, 0.7);
    fill.position.set(-3, 2.5, -2);
    this.scene.add(fill);
  }

  setupRoom() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.MeshStandardMaterial({ color: 0xdde6eb, roughness: 0.9, metalness: 0 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.46;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const backWall = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 5),
      new THREE.MeshStandardMaterial({ color: 0xeef4f7, roughness: 0.95 })
    );
    backWall.position.set(0, 2, -3.2);
    backWall.receiveShadow = true;
    this.scene.add(backWall);

    const wallBand = new THREE.Mesh(
      new THREE.BoxGeometry(8, 0.09, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x95b5c4, roughness: 0.65 })
    );
    wallBand.position.set(0, 1.05, -3.15);
    this.scene.add(wallBand);

    this.room.monitor = this.createBedsideMonitor();
    this.room.monitor.position.set(-1.15, -0.38, -0.15);
    this.scene.add(this.room.monitor);

    this.room.ivStand = this.createIvStand();
    this.room.ivStand.position.set(1.05, -0.45, -0.28);
    this.scene.add(this.room.ivStand);
  }

  prepareBed() {
    const box = new THREE.Box3().setFromObject(this.bed);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const targetLength = 2.22;
    const scale = targetLength / Math.max(size.x, size.z);
    this.bed.scale.setScalar(scale);
    this.bed.position.set(-center.x * scale, -center.y * scale - 0.02, -center.z * scale);
    this.bed.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        if (obj.material) {
          obj.material = obj.material.clone();
          obj.material.color.multiplyScalar(1.05);
          obj.material.roughness = 0.82;
        }
      }
    });
    this.scene.add(this.bed);
    this.bed.updateMatrixWorld(true);
    this.bedContactY = this.measureBedContactHeight();
  }

  measureBedContactHeight() {
    // The Sketchfab bed contains rails/headboards that are much taller than the
    // mattress. Find the highest broad, relatively thin horizontal mesh instead
    // of using the bed's overall bounding-box maximum (which caused levitation).
    const candidates = [];
    this.bed.traverse((obj) => {
      if (!obj.isMesh || !obj.visible) return;
      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3();
      box.getSize(size);
      const footprintLong = Math.max(size.x, size.z);
      const footprintShort = Math.min(size.x, size.z);
      const thickness = size.y;
      if (footprintLong > 1.45 && footprintShort > 0.62 && thickness < 0.34) {
        candidates.push({ top: box.max.y, thickness, area: size.x * size.z });
      }
    });
    if (!candidates.length) return 0.20;
    candidates.sort((a, b) => (b.top - a.top) || (b.area - a.area));
    return candidates[0].top;
  }

  preparePatient() {
    this.patient.name = 'ClinicalPatient3D';
    // Main encounter view: the patient stands facing the examiner. The full-body
    // physical-examination workspace remains a separate clinical view; this scene
    // deliberately frames the face and torso so visible distress is actually useful.
    this.patient.rotation.set(0, 0, 0);
    this.patient.scale.setScalar(1.0);
    this.patient.position.set(0, 0, 0);

    this.patient.traverse((obj) => {
      if (obj.isBone) {
        this.bones.set(obj.name, obj);
        this.baseBoneQuaternions.set(obj.name, obj.quaternion.clone());
      }
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        if (obj.material) {
          obj.material = obj.material.clone();
          obj.material.side = THREE.FrontSide;
          if (obj.material.map) obj.material.map.colorSpace = THREE.SRGBColorSpace;
          if (obj.material.name === 'MikeAlger_Material') {
            obj.material.roughness = 0.70;
            obj.material.metalness = 0;
            this.skinMaterials.push(obj.material);
          }
          if (/Hair_/i.test(`${obj.name || ''} ${obj.geometry?.name || ''}`)) {
            this.hairMaterials.push(obj.material);
          }
        }
      }
    });

    this.styleClinicalClothing();
    this.applyAgeAppearance();
    this.createFaceRig();
    this.applyRestPose(1);
    this.scene.add(this.patient);
    this.patient.updateMatrixWorld(true);
    this.alignStandingPatientToFloor();
  }

  createFaceRig() {
    const head = this.bones.get(BONE.head);
    if (!head) return;

    // The converted glTF lost the advertised facial morph targets. Rather than
    // pretending otherwise, use a restrained procedural mouth/brow overlay tied
    // to the real head bone. It can later be replaced by FBX morph targets without
    // changing the affect/speech API.
    const mouthGroup = new THREE.Group();
    mouthGroup.name = 'ProceduralMouthRig';
    mouthGroup.position.set(0.12, 3.55, 13.18);
    const mouthMaterial = new THREE.MeshBasicMaterial({ color: 0x431a1c, transparent: true, opacity: 0.06, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(2.35, 28), mouthMaterial);
    mouth.scale.set(1.62, 0.08, 1);
    mouth.renderOrder = 1000;
    mouth.frustumCulled = false;
    mouthGroup.add(mouth);
    head.add(mouthGroup);
    this.faceRig.mouthGroup = mouthGroup;
    this.faceRig.mouth = mouth;

    const browMaterial = new THREE.MeshBasicMaterial({ color: 0x413733, transparent: true, opacity: 0.10, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const browGeo = new THREE.PlaneGeometry(3.2, 0.35);
    const rightBrow = new THREE.Mesh(browGeo, browMaterial.clone());
    const leftBrow = new THREE.Mesh(browGeo, browMaterial.clone());
    rightBrow.position.set(-3.0, 8.9, 11.18);
    leftBrow.position.set(3.2, 8.9, 11.18);
    rightBrow.renderOrder = 999;
    leftBrow.renderOrder = 999;
    rightBrow.frustumCulled = false;
    leftBrow.frustumCulled = false;
    head.add(rightBrow, leftBrow);
    this.faceRig.rightBrow = rightBrow;
    this.faceRig.leftBrow = leftBrow;
  }

  setSpeaking(active, text = '') {
    this.speech.active = Boolean(active);
    this.speech.text = String(text || '');
    this.speech.startedAt = performance.now();
    if (!active) this.speech.boundaryPulse = 0;
  }

  pulseSpeechBoundary() {
    this.speech.boundaryPulse = performance.now();
  }

  setViewMode(mode = 'encounter') {
    this.viewMode = mode === 'examination' ? 'examination' : 'encounter';
    this.pointer.yaw = 0;
    this.pointer.pitch = 0;
    this.pointer.zoom = 1;
    this.updateCamera();
  }

  alignStandingPatientToFloor() {
    this.patient.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.patient);
    if (!Number.isFinite(box.min.y)) return;
    this.patient.position.y += this.floorY - box.min.y;
    // A tiny rearward offset keeps the torso centred while leaving room for
    // monitor equipment on either side of the encounter scene.
    this.patient.position.z = -0.04;
    this.patient.updateMatrixWorld(true);
  }

  applyAgeAppearance() {
    const ageFactor = clamp((this.apparentAge - 35) / 35, 0, 1);
    // The aged base texture supplies the wrinkles/temple greying. Material changes
    // reinforce the older skin/hair under different lighting without turning him
    // into a caricature.
    this.skinMaterials.forEach((material) => {
      material.roughness = lerp(0.64, 0.78, ageFactor);
      material.color.setRGB(1 - ageFactor * 0.035, 1 - ageFactor * 0.025, 1 - ageFactor * 0.018);
      material.needsUpdate = true;
    });
    this.hairMaterials.forEach((material) => {
      // The source hair texture is strongly brown. A neutral mapped material still
      // reads young, so remove the baked colour map and render salt-and-pepper hair
      // directly. The beard remains textured on the face atlas.
      material.map = null;
      material.roughness = Math.max(Number(material.roughness || 0.7), 0.84);
      material.metalness = 0;
      material.color.set(0x72777a);
      material.needsUpdate = true;
    });
  }

  styleClinicalClothing() {
    // The body mesh does not contain a complete bare torso under the casual
    // clothes. Keep the upper garments as real geometry and restyle them into a
    // neutral hospital top; only shoes/bracelet are hidden. This avoids holes and
    // gives the body enough thickness to sit naturally on the mattress.
    this.patient.traverse((obj) => {
      if (!obj.isMesh) return;
      const label = `${obj.name || ''} ${obj.geometry?.name || ''} ${obj.material?.name || ''}`;
      if (/Shoes_|Bracelet_/i.test(label)) {
        obj.visible = false;
        return;
      }
      if (/Sweatshirt_|Shirt_/i.test(label) && obj.material) {
        obj.material = obj.material.clone();
        obj.material.color.set(/Sweatshirt_/i.test(label) ? 0x415c6d : 0x9bb5c4);
        obj.material.roughness = 0.94;
        obj.material.metalness = 0;
        if ('map' in obj.material) obj.material.map = null;
        obj.material.needsUpdate = true;
      } else if (/Pants_/i.test(label) && obj.material) {
        obj.material = obj.material.clone();
        obj.material.color.set(0x344b59);
        obj.material.roughness = 0.94;
        obj.material.metalness = 0;
        if ('map' in obj.material) obj.material.map = null;
        obj.material.needsUpdate = true;
      }
    });
  }

  alignPatientToMattress() {
    // Do not align the whole skinned model by its absolute lowest vertex. In a
    // Mixamo T-pose the hands/arms can extend farther "behind" the body than
    // the back, which makes the thorax and legs hover when that single vertex
    // is used as the contact point. Instead use the actual load-bearing clothing
    // around the thorax/pelvis and deliberately allow a few centimetres of
    // mattress compression.
    this.patient.updateMatrixWorld(true);
    const supportBottoms = [];
    for (const mesh of this.patientSupportMeshes) {
      if (!mesh.visible) continue;
      const label = `${mesh.name || ''} ${mesh.geometry?.name || ''} ${mesh.material?.name || ''}`;
      const box = new THREE.Box3().setFromObject(mesh);
      if (!Number.isFinite(box.min.y)) continue;
      // Shirt can be much thinner than the torso garment. Pants + sweatshirt
      // give the most stable approximation of the patient's posterior surface.
      const weight = /Pants_/i.test(label) ? 2 : /Sweatshirt_/i.test(label) ? 2 : 1;
      for (let i = 0; i < weight; i += 1) supportBottoms.push(box.min.y);
    }
    if (!supportBottoms.length) {
      const box = new THREE.Box3().setFromObject(this.patient);
      supportBottoms.push(box.min.y);
    }
    supportBottoms.sort((a, b) => a - b);
    const supportBottom = supportBottoms[Math.floor(supportBottoms.length / 2)];
    const desiredSupport = this.bedContactY + this.patientContactInset;
    this.patient.position.y += desiredSupport - supportBottom;
    this.patient.updateMatrixWorld(true);

    // Final safety clamp: the pelvis centre should remain close to the mattress.
    // This prevents future clothing/asset changes from turning the patient into
    // a levitating cardiology case again.
    const hips = this.bones.get(BONE.hips);
    if (hips) {
      const hipsWorld = new THREE.Vector3();
      hips.getWorldPosition(hipsWorld);
      const targetHipY = this.bedContactY + 0.13;
      const correction = clamp(targetHipY - hipsWorld.y, -0.08, 0.08);
      this.patient.position.y += correction;
      this.patient.updateMatrixWorld(true);
    }
  }

  createPillow() {
    const pillow = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.105, 0.34, 8, 3, 6),
      new THREE.MeshStandardMaterial({ color: 0xf3f7f9, roughness: 0.96, metalness: 0 })
    );
    pillow.position.set(0, this.bedContactY + 0.045, -0.82);
    pillow.rotation.x = -0.03;
    pillow.castShadow = true;
    pillow.receiveShadow = true;
    this.scene.add(pillow);
    this.room.pillow = pillow;
  }

  createBlanket() {
    const blanket = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, 0.055, 1.02, 8, 2, 12),
      new THREE.MeshStandardMaterial({ color: 0xdbe8ef, roughness: 0.96, metalness: 0 })
    );
    this.blanketBaseY = this.bedContactY + 0.285;
    blanket.position.set(0, this.blanketBaseY, 0.38);
    blanket.rotation.x = -0.035;
    blanket.castShadow = true;
    blanket.receiveShadow = true;
    this.scene.add(blanket);
    this.room.blanket = blanket;
  }

  createBedsideMonitor() {
    const group = new THREE.Group();
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.35, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x314554, roughness: 0.42, metalness: 0.12 })
    );
    shell.position.y = 1.05;
    shell.castShadow = true;
    group.add(shell);

    const screenMaterial = new THREE.MeshBasicMaterial({ map: this.createMonitorTexture(), toneMapped: false });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.25), screenMaterial);
    screen.position.set(0, 1.06, 0.078);
    group.add(screen);
    this.room.monitorScreen = screen;

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 1.1, 16),
      new THREE.MeshStandardMaterial({ color: 0x9caab1, metalness: 0.7, roughness: 0.3 })
    );
    pole.position.y = 0.48;
    group.add(pole);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.26, 0.05, 20),
      new THREE.MeshStandardMaterial({ color: 0x778891, metalness: 0.35, roughness: 0.5 })
    );
    base.position.y = -0.05;
    group.add(base);
    group.visible = false;
    return group;
  }

  createMonitorTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    this.room.monitorCanvas = canvas;
    this.room.monitorCtx = ctx;
    this.drawMonitorTexture();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    this.room.monitorTexture = texture;
    return texture;
  }

  drawMonitorTexture() {
    const ctx = this.room.monitorCtx;
    const canvas = this.room.monitorCanvas;
    if (!ctx || !canvas) return;
    const p = this.snapshot?.physiology || {};
    ctx.fillStyle = '#071211';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'bold 50px system-ui';
    ctx.fillStyle = '#49f0a7';
    ctx.fillText(String(Math.round(p.hr || 82)), 350, 64);
    ctx.font = 'bold 34px system-ui';
    ctx.fillStyle = '#5ce3ff';
    ctx.fillText(String(Math.round(p.spo2 || 98)), 365, 145);
    ctx.fillStyle = '#ffdd79';
    ctx.fillText(`${Math.round(p.sbp || 125)}/${Math.round(p.dbp || 80)}`, 285, 230);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#49f0a7';
    ctx.beginPath();
    const y = 83;
    for (let x = 0; x <= 330; x += 4) {
      const phase = (x % 72) / 72;
      let v = Math.sin(x * 0.08) * 3;
      if (phase > .40 && phase < .43) v -= 12;
      if (phase >= .43 && phase < .46) v += 42;
      if (phase >= .46 && phase < .49) v -= 19;
      const py = y - v;
      if (x === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
    }
    ctx.stroke();
    ctx.strokeStyle = '#5ce3ff';
    ctx.beginPath();
    for (let x = 0; x <= 330; x += 4) {
      const py = 163 - (Math.sin(x * 0.05) + Math.sin(x * 0.11) * .28) * 10;
      if (x === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
    }
    ctx.stroke();
    if (this.room.monitorTexture) this.room.monitorTexture.needsUpdate = true;
  }

  createIvStand() {
    const group = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x9eacb3, metalness: 0.75, roughness: 0.28 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.8, 12), metal);
    pole.position.y = 0.9;
    group.add(pole);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.018, 0.018), metal);
    cross.position.y = 1.77;
    group.add(cross);
    const bag = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.28, 0.035),
      new THREE.MeshPhysicalMaterial({ color: 0xdaf5f7, transmission: 0.45, transparent: true, opacity: 0.72, roughness: 0.18 })
    );
    bag.position.set(0.1, 1.57, 0);
    group.add(bag);
    group.visible = false;
    return group;
  }

  createEquipment() {
    this.equipment.chestElectrodes = new THREE.Group();
    const padGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.008, 20);
    padGeo.rotateX(Math.PI / 2);
    const padMat = new THREE.MeshStandardMaterial({ color: 0xf6f8f9, roughness: 0.55, metalness: 0 });
    const positions = [
      [-0.16, 1.36, 0.17], [-0.05, 1.38, 0.19], [0.07, 1.37, 0.19],
      [-0.18, 1.27, 0.18], [-0.05, 1.29, 0.20], [0.10, 1.28, 0.19]
    ];
    positions.forEach(([x, y, z]) => {
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.position.set(x, y, z);
      pad.castShadow = true;
      this.equipment.chestElectrodes.add(pad);
    });
    this.equipment.chestElectrodes.visible = false;
    this.scene.add(this.equipment.chestElectrodes);

    this.equipment.oxygen = this.createOxygenCannula();
    this.equipment.oxygen.visible = false;
    this.scene.add(this.equipment.oxygen);
  }

  createOxygenCannula() {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color: 0x8de4ee, transparent: true, opacity: 0.75 });
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.13, 1.62, 0.18),
      new THREE.Vector3(-0.04, 1.61, 0.21),
      new THREE.Vector3(0.04, 1.61, 0.21),
      new THREE.Vector3(0.13, 1.62, 0.18)
    ]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.007, 8, false), material);
    group.add(tube);
    return group;
  }

  frameScene() {
    this.resize();
    this.updateCamera();
  }

  setupInteraction() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (event) => {
      this.pointer.down = true;
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
      el.setPointerCapture?.(event.pointerId);
    });
    el.addEventListener('pointermove', (event) => {
      if (!this.pointer.down) return;
      const dx = event.clientX - this.pointer.x;
      const dy = event.clientY - this.pointer.y;
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
      this.pointer.yaw = clamp(this.pointer.yaw - dx * 0.0035, -0.75, 0.75);
      this.pointer.pitch = clamp(this.pointer.pitch + dy * 0.0028, -0.22, 0.42);
      this.updateCamera();
    });
    const finish = (event) => {
      this.pointer.down = false;
      try { el.releasePointerCapture?.(event.pointerId); } catch {}
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('dblclick', () => {
      this.pointer.yaw = 0;
      this.pointer.pitch = 0;
      this.pointer.zoom = 1;
      this.updateCamera();
    });
    el.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.pointer.zoom = clamp(this.pointer.zoom + Math.sign(event.deltaY) * 0.08, 0.78, 1.35);
      this.updateCamera();
    }, { passive: false });
  }

  updateCamera() {
    if (!this.camera) return;
    const examination = this.viewMode === 'examination';
    const target = new THREE.Vector3(0, examination ? 0.92 : 1.40, 0.02);
    const radius = (examination ? 3.25 : 1.72) * this.pointer.zoom;
    const yaw = 0.08 + this.pointer.yaw * (examination ? 0.80 : 0.48);
    const pitch = (examination ? 0.03 : 0.045) + this.pointer.pitch * 0.55;
    this.camera.position.set(
      Math.sin(yaw) * Math.cos(pitch) * radius,
      target.y + Math.sin(pitch) * radius,
      Math.cos(yaw) * Math.cos(pitch) * radius
    );
    this.camera.lookAt(target);
  }

  resize() {
    if (!this.renderer || !this.camera || !this.container) return;
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(2, Math.floor(rect.width));
    const height = Math.max(2, Math.floor(rect.height));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setSnapshot(snapshot) {
    this.snapshot = snapshot;
    if (!snapshot) return;
    const equipment = snapshot.equipment || {};
    this.room.monitor.visible = Boolean(equipment.monitor || equipment.telemetry);
    this.room.ivStand.visible = Boolean(equipment.ivAccess || equipment.infusion);
    this.equipment.chestElectrodes.visible = Boolean(equipment.ecg12 || equipment.telemetry || equipment.monitor);
    this.equipment.oxygen.visible = Boolean(equipment.oxygen);
    if (this.room.monitor.visible) this.drawMonitorTexture();

    const sweating = clamp(Number(snapshot.visual?.sweating || 0), 0, 1);
    const pallor = clamp(Number(snapshot.visual?.pallor || 0), 0, 1);
    const ageFactor = clamp((this.apparentAge - 35) / 35, 0, 1);
    this.skinMaterials.forEach((material) => {
      const matureBaseline = lerp(0.64, 0.78, ageFactor);
      material.roughness = lerp(matureBaseline, 0.32, sweating);
      material.color.setRGB(
        1 - ageFactor * 0.035 - pallor * 0.10,
        1 - ageFactor * 0.025 - pallor * 0.025,
        1 - ageFactor * 0.018
      );
      material.needsUpdate = true;
    });
  }

  reactToReply(text = '', result = {}) {
    const lower = String(text).toLowerCase();
    this.affect = derivePatientAffect({
      reply: text,
      studentInput: result?.studentInput || '',
      rapport: result?.rapport ?? 70,
      snapshot: this.snapshot,
      casePersonality: this.casePersonality
    });
    if (/chest|pressure|pain|tightness/.test(lower)) this.triggerPose('chest', 3200);
    else if (/nause|abdomen|stomach/.test(lower)) this.triggerPose('abdomen', 2200);
  }

  reactToExamination(examinationId = '', finding = '') {
    const lower = `${examinationId} ${finding}`.toLowerCase();
    if (/chest|cardio|stern|precord|pain|tender/.test(lower)) this.triggerPose('chest', 2200);
    else if (/abdomen|abdominal|epigastr/.test(lower)) this.triggerPose('abdomen', 1900);
  }

  setEmotion(emotion = 'neutral') {
    if (emotion === 'pain' || emotion === 'worried') this.triggerPose('chest', 3000);
    this.affect = { ...this.affect, emotion: emotion === 'worried' ? 'anxious' : emotion };
  }

  triggerPose(type, duration = 2500) {
    const now = performance.now();
    if (type === 'chest') {
      this.pose.targetChest = 1;
      this.pose.targetAbdomen = 0;
    } else if (type === 'abdomen') {
      this.pose.targetChest = 0;
      this.pose.targetAbdomen = 1;
    }
    this.pose.poseUntil = now + duration;
  }

  applyRestPose(strength = 1) {
    // Mixamo's source pose is a T-pose. Rotating only around local X lowers the
    // arms but also pushes both hands posterior to the body. Add mirrored local-Y
    // offsets so the hands rest naturally just anterior to the thighs.
    this.setBoneEulerOffset(BONE.leftArm, { x: 1.48 * strength, y: -0.40 * strength });
    this.setBoneEulerOffset(BONE.rightArm, { x: 1.48 * strength, y: 0.40 * strength });
    this.setBoneEulerOffset(BONE.leftForeArm, { z: 0.05 * strength });
    this.setBoneEulerOffset(BONE.rightForeArm, { z: -0.05 * strength });
    this.setBoneEulerOffset(BONE.leftUpLeg, { z: -0.035 * strength });
    this.setBoneEulerOffset(BONE.rightUpLeg, { z: 0.035 * strength });
  }

  applyPoseBlend(chest, abdomen, breath, distress, consciousness) {
    const now = performance.now();
    if (now > this.pose.poseUntil) {
      this.pose.targetChest = 0;
      this.pose.targetAbdomen = 0;
    }
    const dt = 1 / 60;
    this.pose.chest = THREE.MathUtils.damp(this.pose.chest, this.pose.targetChest, 5.5, dt);
    this.pose.abdomen = THREE.MathUtils.damp(this.pose.abdomen, this.pose.targetAbdomen, 5.5, dt);

    const chestPose = this.pose.chest;
    const abdomenPose = this.pose.abdomen;
    const visualPosition = String(this.snapshot?.visual?.position || 'standing');
    const guarding = visualPosition === 'guarding' ? 1 : 0;
    const standing = visualPosition === 'standing' || visualPosition === 'upright' ? 1 : 0;

    // Mixamo's arms are in a T-pose. Local +X rotation lowers both arms beside the body.
    // The chest/abdomen targets below were solved against the uploaded rig's real bone transforms.
    const rightArmX = 1.48 + chestPose * (0.776 - 1.48) + abdomenPose * (1.56 - 1.48);
    const actionBlend = clamp(chestPose + abdomenPose, 0, 1);
    const rightArmY = 0.40 + chestPose * (0.05 - 0.40) + abdomenPose * (0.18 - 0.40);
    const rightArmZ = chestPose * -0.938 + abdomenPose * -0.596;
    const rightForeY = chestPose * 1.493 + abdomenPose * 0.773;
    const rightForeZ = (-0.05 * (1 - actionBlend)) + chestPose * -2.136 + abdomenPose * -1.741;
    this.setBoneEulerOffset(BONE.leftArm, { x: 1.48 - guarding * 0.08, y: -0.40 + guarding * 0.05 });
    this.setBoneEulerOffset(BONE.leftForeArm, { z: 0.05 + guarding * -0.10 });
    this.setBoneEulerOffset(BONE.rightArm, { x: rightArmX, y: rightArmY, z: rightArmZ });
    this.setBoneEulerOffset(BONE.rightForeArm, { y: rightForeY, z: rightForeZ });
    this.setBoneEulerOffset(BONE.rightHand, { y: -chestPose * 0.12 });

    const breathAngle = breath * (0.009 + distress * 0.010);
    // Standing encounter posture: subtle protective forward flexion with distress,
    // otherwise upright. Breathing is deliberately restrained so the torso reads
    // as alive rather than rubbery.
    this.setBoneEulerOffset(BONE.spine, { x: guarding * 0.018 + distress * 0.006 });
    this.setBoneEulerOffset(BONE.spine1, { x: guarding * 0.030 + breathAngle });
    this.setBoneEulerOffset(BONE.spine2, { x: guarding * 0.024 + breathAngle * 0.72 });

    this.setBoneEulerOffset(BONE.leftUpLeg, { z: -0.025 * standing });
    this.setBoneEulerOffset(BONE.rightUpLeg, { z: 0.025 * standing });
    this.setBoneEulerOffset(BONE.leftLeg, {});
    this.setBoneEulerOffset(BONE.rightLeg, {});

    // Head/eyes/mouth are handled by applyFacialAffect so speech and emotion can blend cleanly.
  }

  applyFacialAffect(elapsed, distress, consciousness) {
    const affect = this.affect || {};
    const speaking = this.speech.active;
    const talkWave = speaking
      ? Math.abs(Math.sin(elapsed * 18.5) * 0.72 + Math.sin(elapsed * 11.3) * 0.28)
      : 0;
    const boundaryBoost = speaking && performance.now() - this.speech.boundaryPulse < 110 ? 0.35 : 0;
    const emotionOpen = affect.emotion === 'pain' ? 0.12 : affect.emotion === 'anxious' ? 0.08 : 0.03;
    const mouthOpen = clamp((speaking ? 0.18 + talkWave * 0.72 + boundaryBoost : emotionOpen) + distress * 0.035, 0.04, 1);
    if (this.faceRig.mouth) {
      this.faceRig.mouth.scale.set(1.62 + talkWave * 0.10, 0.055 + mouthOpen * 0.74, 1);
      this.faceRig.mouth.material.opacity = speaking ? 0.78 : Math.max(0.04, mouthOpen * 0.18);
    }

    const brow = clamp(Number(affect.browTension || 0), 0, 1);
    if (this.faceRig.rightBrow && this.faceRig.leftBrow) {
      this.faceRig.rightBrow.rotation.z = -0.12 - brow * 0.25;
      this.faceRig.leftBrow.rotation.z = 0.12 + brow * 0.25;
      this.faceRig.rightBrow.position.y = 8.9 - brow * 0.22;
      this.faceRig.leftBrow.position.y = 8.9 - brow * 0.22;
      const opacity = 0.08 + brow * 0.34;
      this.faceRig.rightBrow.material.opacity = opacity;
      this.faceRig.leftBrow.material.opacity = opacity;
    }

    const gaze = clamp(Number(affect.gazeEngagement ?? 0.75), 0, 1);
    const avoid = (1 - gaze) * 0.22;
    const conversationalShift = speaking ? Math.sin(elapsed * 0.95) * 0.018 : 0;
    this.setBoneEulerOffset(BONE.rightEye, { y: avoid + conversationalShift });
    this.setBoneEulerOffset(BONE.leftEye, { y: avoid + conversationalShift });

    const moodTilt = affect.emotion === 'irritated' ? -0.045 : affect.emotion === 'sad' ? 0.05 : affect.emotion === 'anxious' ? 0.025 : 0;
    const speechNod = speaking ? Math.sin(elapsed * 2.1) * 0.012 : 0;
    const consciousnessDrop = consciousness === 'unconscious' ? 0.18 : consciousness === 'drowsy' ? 0.08 : 0;
    this.setBoneEulerOffset(BONE.neck, { x: moodTilt * 0.45 + speechNod * 0.5, z: consciousnessDrop * 0.3 });
    this.setBoneEulerOffset(BONE.head, { x: moodTilt + speechNod, z: consciousnessDrop });
  }

  setBoneEulerOffset(name, values = {}) {
    const bone = this.bones.get(name);
    const base = this.baseBoneQuaternions.get(name);
    if (!bone || !base) return;
    Patient3DRenderer.tmpEuler.set(values.x || 0, values.y || 0, values.z || 0, 'XYZ');
    Patient3DRenderer.tmpQuaternion.setFromEuler(Patient3DRenderer.tmpEuler);
    bone.quaternion.copy(base).multiply(Patient3DRenderer.tmpQuaternion);
  }

  setBoneOffset(name, axis, angle) {
    this.setBoneEulerOffset(name, { [axis]: angle });
  }

  renderLoop() {
    if (!this.running) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    const elapsed = this.clock.elapsedTime;
    const snapshot = this.snapshot || {};
    const physiology = snapshot.physiology || {};
    const symptoms = snapshot.symptoms || {};
    const visual = snapshot.visual || {};

    const rr = clamp(Number(physiology.rr || 16), 4, 45);
    const pain = clamp(Number(symptoms.pain || 0), 0, 10) / 10;
    const distress = clamp(Math.max(Number(symptoms.distress || 0.15), pain * 0.74), 0, 1);
    const breathPhase = elapsed * (rr / 60) * Math.PI * 2;
    const breath = (Math.sin(breathPhase) + 1) / 2;
    const consciousness = String(visual.consciousness || 'alert');

    this.applyPoseBlend(this.pose.chest, this.pose.abdomen, breath, distress, consciousness);
    this.applyFacialAffect(elapsed, distress, consciousness);

    if (this.room.monitor.visible && (Math.floor(elapsed * 2) % 2 === 0)) this.drawMonitorTexture();
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(() => this.renderLoop());
  }

  dispose() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.renderer?.dispose();
    this.container?.classList.remove('patient-3d-active');
  }
}

Patient3DRenderer.AXIS_X = new THREE.Vector3(1, 0, 0);
Patient3DRenderer.AXIS_Y = new THREE.Vector3(0, 1, 0);
Patient3DRenderer.AXIS_Z = new THREE.Vector3(0, 0, 1);
Patient3DRenderer.tmpQuaternion = new THREE.Quaternion();
Patient3DRenderer.tmpEuler = new THREE.Euler();
