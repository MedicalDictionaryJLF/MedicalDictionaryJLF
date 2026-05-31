const NS = 'http://www.w3.org/2000/svg';

const ids = {
  torso: ['body_torso_default', 'underwear_plain', 'shirt_colar_2_of_2', 'shirt_colar_1_of_2', 'vest_5-button_basic', 'tie_neck'],
  head: ['body_head_default', 'ears_default', 'sockets_joy', 'nose_pointed_2_of_2', 'mouth_joy', 'warpaint_football', 'eyes_joy', 'eyeballs_default', 'lashes_joy', 'brows_joy', 'facialhair_beard_boxed', 'nose_pointed_1_of_2', 'hair_buzzcut', 'glasses_hipster'],
  face: ['brows_joy', 'mouth_joy', 'eyes_joy', 'eyeballs_default', 'glasses_hipster'],
  right: {
    upper: ['body_arm_right_default'],
    lower: ['body_forearm_right_default'],
    sleeveUpper: ['shirt_right_sleeve_cap', 'shirt_right_sleeve_cap_shadow', 'shirt_right_sleeve_inner_shadow'],
    sleeveLower: ['shirt_right_sleeve', 'shirt_right_sleeve_shadow_a', 'shirt_right_sleeve_shadow_b', 'shirt_right_sleeve_shadow_c', 'shirt_right_cuff'],
    hand: ['body_hand_right_default']
  },
  left: {
    upper: ['body_arm_left_default'],
    lower: ['body_forearm_left_default'],
    sleeveUpper: ['shirt_left_sleeve_cap', 'shirt_left_sleeve_cap_shadow', 'shirt_left_sleeve_inner_shadow'],
    sleeveLower: ['shirt_left_sleeve', 'shirt_left_sleeve_shadow_a', 'shirt_left_cuff'],
    hand: ['body_hand_left_default'],
    accessories: ['watch_generic']
  }
};

const rest = {
  right: { shoulder: { x: 247, y: 181 }, elbow: { x: 221, y: 241 }, wrist: { x: 221, y: 312 }, elbowSign: 1, restHandAngle: Math.PI / 2 },
  left: { shoulder: { x: 318, y: 181 }, elbow: { x: 337, y: 248 }, wrist: { x: 342, y: 320 }, elbowSign: -1, restHandAngle: Math.PI / 2 }
};

const presets = {
  sternum: { x: 282, y: 224 },
  leftChest: { x: 303, y: 221 },
  rightChest: { x: 260, y: 221 },
  mouth: { x: 281, y: 146 },
  abdomen: { x: 282, y: 268 },
  restRight: { x: 221, y: 312 },
  restLeft: { x: 342, y: 320 }
};

for (const side of ['right', 'left']) {
  const r = rest[side];
  r.l1 = dist(r.shoulder, r.elbow);
  r.l2 = dist(r.elbow, r.wrist);
  r.restUpperAngle = Math.atan2(r.elbow.y - r.shoulder.y, r.elbow.x - r.shoulder.x);
  r.restForeAngle = Math.atan2(r.wrist.y - r.elbow.y, r.wrist.x - r.elbow.x);
}

const state = {
  ready: false,
  svg: null,
  mount: null,
  baseTransforms: new Map(),
  current: null,
  armRaf: null,
  idleRaf: null,
  painUntil: 0,
  frownUntil: 0,
  touchUntil: 0,
  lastIdleGesture: 0,
  caseProfile: null
};

export async function initAvatarAnimator(activeCase) {
  state.caseProfile = activeCase || null;
  state.mount = document.getElementById('avatarMount');
  if (!state.mount) return false;

  if (!state.svg) {
    try {
      const response = await fetch(new URL('../patient-avatar.svg', import.meta.url), { cache: 'no-cache' });
      if (!response.ok) throw new Error(`Avatar SVG not found (${response.status})`);
      const svgText = await response.text();
      const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const parsedSvg = doc.querySelector('svg');
      if (!parsedSvg) throw new Error('No SVG root found');
      parsedSvg.id = 'patientAvatarSvg';
      parsedSvg.classList.add('animated-patient-svg');
      state.mount.innerHTML = '';
      state.mount.appendChild(document.importNode(parsedSvg, true));
      state.svg = state.mount.querySelector('svg');
      tagShirtSleeveParts();
      storeBaseTransforms();
      liftArmLayer('right');
      state.ready = true;
      startIdleLoop();
    } catch (error) {
      console.error('Avatar animation failed:', error);
      state.mount.innerHTML = '<div class="avatar-fallback visible">Pt</div>';
      return false;
    }
  }

  resetAvatarPose({ keepBreathing: true });
  return true;
}

export function reactAvatarToPatientReply(reply = '', result = {}) {
  if (!state.ready) return;
  const text = `${reply} ${result.detectedIntent || ''} ${result.feedbackLabel || ''}`.toLowerCase();
  const painful = /chest|pressure|pain|hurts|short of breath|breath|nause|sweat|scared|worried|dizzy/.test(text);
  const intense = /8 out of 10|severe|strong|scared|worried|pressure|chest/.test(text);
  const now = performance.now();
  if (painful) {
    state.painUntil = now + (intense ? 6500 : 4200);
    state.frownUntil = now + (intense ? 7000 : 4500);
  }
  if (/chest|pressure|pain/.test(text) && now > state.touchUntil - 1000) {
    touchChest();
  } else if (/short of breath|breath/.test(text)) {
    state.frownUntil = now + 6000;
  }
}

export function setAvatarEmotion(emotion = 'neutral') {
  if (!state.ready) return;
  const now = performance.now();
  if (emotion === 'pain' || emotion === 'worried') {
    state.painUntil = now + 6000;
    state.frownUntil = now + 7000;
    if (emotion === 'pain') touchChest();
  } else if (emotion === 'neutral') {
    state.painUntil = 0;
    state.frownUntil = 0;
  }
}

function startIdleLoop() {
  cancelAnimationFrame(state.idleRaf);
  const loop = (now) => {
    if (!state.svg) return;
    const painful = now < state.painUntil;
    const frowning = now < state.frownUntil;
    const breathSpeed = painful ? 0.0063 : 0.0036;
    const breath = Math.sin(now * breathSpeed);
    const breath2 = Math.sin(now * breathSpeed * 0.5 + 1.1);
    const chestScale = 1 + (painful ? 0.010 : 0.006) * (breath + 1) / 2;
    const yShift = painful ? breath * 1.2 : breath * 0.6;
    const sway = Math.sin(now * 0.0012) * (painful ? 0.55 : 0.35);

    ids.torso.forEach((id) => applyTransform(id, `translate(${sway.toFixed(3)} ${yShift.toFixed(3)}) scale(${chestScale.toFixed(4)} ${chestScale.toFixed(4)})`, '282 240'));
    ids.head.forEach((id) => applyTransform(id, `translate(${(sway * 0.45).toFixed(3)} ${(yShift * 0.38).toFixed(3)}) rotate(${(breath2 * (painful ? 1.1 : 0.5)).toFixed(3)} 282 145)`));

    applyFrown(frowning, painful, now);

    if (now - state.lastIdleGesture > 9500 && !state.armRaf && now > state.touchUntil + 1800) {
      state.lastIdleGesture = now;
      if (painful || Math.random() > 0.55) touchChest();
      else subtleShoulderShift();
    }

    state.idleRaf = requestAnimationFrame(loop);
  };
  state.idleRaf = requestAnimationFrame(loop);
}

function applyFrown(active, painful, now) {
  const brow = getEl('brows_joy');
  const mouth = getEl('mouth_joy');
  const eyes = getEl('eyes_joy');
  if (brow) {
    const tension = active ? 1 : 0;
    const twitch = active ? Math.sin(now * 0.007) * 0.6 : 0;
    applyTransform('brows_joy', `translate(0 ${(1.6 * tension).toFixed(2)}) rotate(${(-3.2 * tension + twitch).toFixed(2)} 282 137)`);
  }
  if (mouth) {
    const tension = active ? 1 : 0;
    applyTransform('mouth_joy', `translate(0 ${(1.5 * tension).toFixed(2)}) scale(1 ${(1 - 0.05 * tension).toFixed(3)})`, '282 165');
  }
  if (eyes) {
    applyTransform('eyes_joy', painful ? `translate(0 0.6)` : '');
  }
}

function subtleShoulderShift() {
  const side = Math.random() > 0.5 ? 'right' : 'left';
  reachTo(side, side === 'right' ? { x: 232, y: 302 } : { x: 332, y: 310 }, { duration: 600 })
    .then(() => wait(850))
    .then(() => resetArms(700));
}

function touchChest() {
  const now = performance.now();
  state.touchUntil = now + 3800;
  state.frownUntil = Math.max(state.frownUntil, now + 4200);
  reachTo('right', presets.sternum, { duration: 800 })
    .then(() => pulseHandOnChest(1500))
    .then(() => wait(950))
    .then(() => resetArms(850));
}

function pulseHandOnChest(duration = 1200) {
  const start = performance.now();
  return new Promise((resolve) => {
    const frame = (now) => {
      if (!state.current || state.current.side !== 'right') return resolve();
      const t = Math.min(1, (now - start) / duration);
      const tap = Math.sin((now - start) * 0.018) * 2.2;
      const pose = { ...state.current.pose, wrist: { ...state.current.pose.wrist, x: state.current.pose.wrist.x + tap * 0.25, y: state.current.pose.wrist.y + tap } };
      setTransforms('right', pose);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

function reachTo(side, rawTarget, opts = {}) {
  if (!state.ready) return Promise.resolve(null);
  const goal = solveIK(side, rawTarget);
  const duration = opts.duration ?? 700;
  const from = state.current && state.current.side === side ? state.current.pose : restPose(side);
  const start = performance.now();
  cancelAnimationFrame(state.armRaf);
  return new Promise((resolve) => {
    const frame = (now) => {
      const t = ease(Math.min(1, (now - start) / duration));
      const pose = interpolatePose(from, goal, t);
      setTransforms(side, pose);
      if (t < 1) state.armRaf = requestAnimationFrame(frame);
      else { state.current = { side, pose: goal }; state.armRaf = null; resolve(goal); }
    };
    state.armRaf = requestAnimationFrame(frame);
  });
}

function resetArms(duration = 500) {
  const side = state.current?.side || 'right';
  const from = state.current?.pose || restPose(side);
  const to = restPose(side);
  const start = performance.now();
  return new Promise((resolve) => {
    const frame = (now) => {
      const t = ease(Math.min(1, (now - start) / duration));
      const pose = interpolatePose(from, to, t);
      setTransforms(side, pose);
      if (t < 1) requestAnimationFrame(frame);
      else { resetAvatarPose({ keepBreathing: true }); resolve(); }
    };
    requestAnimationFrame(frame);
  });
}

function resetAvatarPose() {
  ['right', 'left'].forEach((side) => {
    const part = ids[side];
    [...(part.upper || []), ...(part.lower || []), ...(part.sleeveUpper || []), ...(part.sleeveLower || []), ...(part.hand || []), ...(part.accessories || [])].forEach((id) => {
      const el = getEl(id);
      if (el) {
        el.removeAttribute('transform');
        el.style.opacity = '';
      }
    });
  });
  state.current = null;
}

function solveIK(side, rawTarget) {
  const r = rest[side];
  const handOffset = 4;
  let base = Math.atan2(rawTarget.y - r.shoulder.y, rawTarget.x - r.shoulder.x);
  const target = { x: rawTarget.x - Math.cos(base) * handOffset, y: rawTarget.y - Math.sin(base) * handOffset };
  let dx = target.x - r.shoulder.x;
  let dy = target.y - r.shoulder.y;
  let d = Math.hypot(dx, dy);
  d = clamp(d, Math.abs(r.l1 - r.l2) + 8, r.l1 + r.l2 - 2);
  base = Math.atan2(dy, dx);
  const cosA = clamp((r.l1 * r.l1 + d * d - r.l2 * r.l2) / (2 * r.l1 * d), -1, 1);
  const alpha = Math.acos(cosA);
  const upperAngle = base + r.elbowSign * alpha;
  const elbow = { x: r.shoulder.x + r.l1 * Math.cos(upperAngle), y: r.shoulder.y + r.l1 * Math.sin(upperAngle) };
  const wrist = { x: r.shoulder.x + d * Math.cos(base), y: r.shoulder.y + d * Math.sin(base) };
  const foreAngle = Math.atan2(wrist.y - elbow.y, wrist.x - elbow.x);
  const handAngle = base + (side === 'right' ? 0.08 : -0.08);
  return { side, upperAngle, foreAngle, handAngle, elbow, wrist, target: rawTarget };
}

function setTransforms(side, pose) {
  const r = rest[side];
  const part = ids[side];
  liftArmLayer(side);
  const upperDelta = deg(angleDelta(pose.upperAngle, r.restUpperAngle));
  const foreDelta = deg(angleDelta(pose.foreAngle, r.restForeAngle));
  const handDelta = deg(angleDelta(pose.handAngle, r.restHandAngle));
  [...(part.upper || []), ...(part.sleeveUpper || [])].forEach((id) => applyOnly(id, `rotate(${upperDelta.toFixed(3)} ${r.shoulder.x} ${r.shoulder.y})`));
  const edx = pose.elbow.x - r.elbow.x;
  const edy = pose.elbow.y - r.elbow.y;
  [...(part.lower || []), ...(part.sleeveLower || []), ...(part.accessories || [])].forEach((id) => applyOnly(id, `translate(${edx.toFixed(3)} ${edy.toFixed(3)}) rotate(${foreDelta.toFixed(3)} ${r.elbow.x} ${r.elbow.y})`));
  const wdx = pose.wrist.x - r.wrist.x;
  const wdy = pose.wrist.y - r.wrist.y;
  (part.hand || []).forEach((id) => applyOnly(id, `translate(${wdx.toFixed(3)} ${wdy.toFixed(3)}) rotate(${handDelta.toFixed(3)} ${r.wrist.x} ${r.wrist.y})`));
}

function restPose(side) {
  const r = rest[side];
  return { side, upperAngle: r.restUpperAngle, foreAngle: r.restForeAngle, handAngle: r.restHandAngle, elbow: { ...r.elbow }, wrist: { ...r.wrist }, target: { ...r.wrist } };
}

function interpolatePose(from, to, t) {
  return {
    side: to.side,
    upperAngle: from.upperAngle + angleDelta(to.upperAngle, from.upperAngle) * t,
    foreAngle: from.foreAngle + angleDelta(to.foreAngle, from.foreAngle) * t,
    handAngle: from.handAngle + angleDelta(to.handAngle, from.handAngle) * t,
    elbow: { x: lerp(from.elbow.x, to.elbow.x, t), y: lerp(from.elbow.y, to.elbow.y, t) },
    wrist: { x: lerp(from.wrist.x, to.wrist.x, t), y: lerp(from.wrist.y, to.wrist.y, t) },
    target: to.target
  };
}

function tagShirtSleeveParts() {
  const shirt = getEl('shirt_colar_2_of_2');
  if (!shirt) return;
  const paths = [...shirt.querySelectorAll(':scope > path')];
  const pathIds = {
    15: 'shirt_right_sleeve_cap', 18: 'shirt_right_sleeve', 19: 'shirt_right_sleeve_cap_shadow', 26: 'shirt_right_sleeve_shadow_a', 27: 'shirt_right_sleeve_shadow_b', 28: 'shirt_right_sleeve_shadow_c', 29: 'shirt_right_cuff', 30: 'shirt_right_sleeve_inner_shadow',
    16: 'shirt_left_sleeve_cap', 17: 'shirt_left_sleeve', 20: 'shirt_left_sleeve_cap_shadow', 23: 'shirt_left_sleeve_shadow_a', 24: 'shirt_left_sleeve_inner_shadow', 25: 'shirt_left_cuff'
  };
  Object.entries(pathIds).forEach(([index, id]) => { const el = paths[Number(index) - 1]; if (el) el.id = id; });
}

function liftArmLayer(side) {
  if (!state.svg) return;
  const part = ids[side];
  [...(part.upper || []), ...(part.lower || []), ...(part.sleeveUpper || []), ...(part.sleeveLower || []), ...(part.accessories || []), ...(part.hand || [])]
    .forEach((id) => { const el = getEl(id); if (el) state.svg.appendChild(el); });
}

function storeBaseTransforms() {
  state.baseTransforms.clear();
  state.svg.querySelectorAll('[id]').forEach((el) => state.baseTransforms.set(el.id, el.getAttribute('transform') || ''));
}

function applyTransform(id, transform, origin = '') {
  const el = getEl(id);
  if (!el) return;
  const base = state.baseTransforms.get(id) || '';
  if (origin) {
    const [ox, oy] = origin.split(' ').map(Number);
    // SVG transform scale is around origin by translate-scale-translate sandwich.
    if (transform.includes('scale(')) {
      el.setAttribute('transform', `${base} translate(${ox} ${oy}) ${transform} translate(${-ox} ${-oy})`.trim());
      return;
    }
  }
  el.setAttribute('transform', `${base} ${transform}`.trim());
}

function applyOnly(id, transform) {
  const el = getEl(id);
  if (!el) return;
  el.setAttribute('transform', transform);
  el.style.opacity = '';
}

function getEl(id) { return state.svg?.querySelector(`#${CSS.escape(id)}`); }
function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function angleDelta(a, b) { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
function deg(rad) { return rad * 180 / Math.PI; }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
