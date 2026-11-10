import { AnimationMixer, Box3, MathUtils, Quaternion, Vector3 } from 'three';

function worldRotation(bone, quaternion) {
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new Quaternion()).invert().multiply(quaternion));
  bone.updateMatrixWorld(true);
}

function aim(bone, current, target) {
  const delta = new Quaternion().setFromUnitVectors(current.normalize(), target.normalize());
  worldRotation(bone, delta.multiply(bone.getWorldQuaternion(new Quaternion())));
}

function sampleVertices(patient, visit, acceptMaterial = () => true) {
  const vertex = new Vector3();
  patient.traverse(mesh => {
    if (!mesh.isSkinnedMesh || !acceptMaterial(mesh.material.name)) return;
    mesh.skeleton.update();
    for (let index = 0; index < mesh.geometry.attributes.position.count; index++) {
      mesh.getVertexPosition(index, vertex).applyMatrix4(mesh.matrixWorld);
      visit(vertex, mesh.material.name);
    }
  });
}

function writeTrack(clip, bone, property) {
  const track = clip.tracks.find(item => item.name === `${bone.name}.${property}`);
  for (let index = 0; index < track.values.length; index += track.getValueSize()) {
    bone[property].toArray(track.values, index);
  }
}

// Both poses share the same torso placement. Solve the legs separately so
// the heels or soles meet the bed without pulling the patient's back off it.
export function buildBedPositions(patient, bones, reclined, bed, includeBentPose) {
  const cover = bed?.getObjectByName('FoldedCover');
  const mattress = bed?.getObjectByName('Mattress');
  const pillow = bed?.getObjectByName('Pillow');
  const mattressBounds = mattress ? new Box3().setFromObject(mattress) : null;
  const mattressTop = mattressBounds?.max.y ?? .73;
  let supportHeight = mattressTop;
  if (cover && mattressBounds) {
    const bounds = new Box3().setFromObject(cover);
    // Seat the bedspread on the mattress and extend it under the heels.
    cover.position.y += mattressTop - bounds.min.y - .001;
    cover.scale.z *= (mattressBounds.max.z - bounds.min.z) / (bounds.max.z - bounds.min.z);
    const fitted = new Box3().setFromObject(cover);
    cover.position.z += bounds.min.z - fitted.min.z;
    supportHeight = fitted.max.y - .008;
  }

  const mixer = new AnimationMixer(patient);
  const action = mixer.clipAction(reclined);
  action.play();
  mixer.update(0);
  patient.updateMatrixWorld(true);

  const root = bones.get('Root');
  const pelvis = bones.get('pelvis').getWorldPosition(new Vector3());
  const head = bones.get('head').getWorldPosition(new Vector3());
  let torsoBottom = Infinity;
  let headBottom = Infinity;
  sampleVertices(patient, (point, material) => {
    if (Math.abs(point.x) > .15) return;
    if (point.z > head.z + .18 && point.z < pelvis.z + .1) torsoBottom = Math.min(torsoBottom, point.y);
    if (material.startsWith('Skin_') && Math.abs(point.z - head.z) < .1) headBottom = Math.min(headBottom, point.y);
  });
  const torsoOffset = Number.isFinite(torsoBottom) ? supportHeight - torsoBottom : 0;
  const groundedRoot = root.position.clone().add(new Vector3(0, torsoOffset, 0));
  if (pillow && Number.isFinite(headBottom)) {
    const bounds = new Box3().setFromObject(pillow);
    const top = Math.max(mattressTop + .035, headBottom + torsoOffset + .006);
    pillow.scale.y *= (top - mattressTop) / (bounds.max.y - bounds.min.y);
    pillow.position.y += top - new Box3().setFromObject(pillow).max.y;
  }

  const soleRotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), MathUtils.degToRad(75));
  const clips = [];
  for (const bent of includeBentPose ? [false, true] : [false]) {
    action.stop().play();
    mixer.update(0);
    root.position.copy(groundedRoot);
    patient.updateMatrixWorld(true);
    const clip = reclined.clone();
    if (bent) clip.name = 'PositionAbdominal';
    writeTrack(clip, root, 'position');
    if (bent) {
      for (const side of ['l', 'r']) {
        const foot = bones.get(`foot_${side}`);
        worldRotation(foot, soleRotation.clone().multiply(foot.getWorldQuaternion(new Quaternion())));
      }
    }

    const shoeBottom = { l: Infinity, r: Infinity };
    sampleVertices(patient, point => {
      const side = point.x >= 0 ? 'l' : 'r';
      shoeBottom[side] = Math.min(shoeBottom[side], point.y);
    }, material => material.includes('shoes'));
    for (const side of ['l', 'r']) {
      const thigh = bones.get(`thigh_${side}`), calf = bones.get(`calf_${side}`), foot = bones.get(`foot_${side}`);
      const hip = thigh.getWorldPosition(new Vector3()), knee = calf.getWorldPosition(new Vector3());
      const ankle = foot.getWorldPosition(new Vector3()), footRotation = foot.getWorldQuaternion(new Quaternion());
      const upper = knee.distanceTo(hip), lower = ankle.distanceTo(knee);
      const flexion = MathUtils.degToRad(bent ? 60 : 0);
      const reach = Math.sqrt(upper ** 2 + lower ** 2 + 2 * upper * lower * Math.cos(flexion));
      const ankleTarget = ankle.clone();
      const bottom = shoeBottom[side];
      if (Number.isFinite(bottom)) ankleTarget.y += supportHeight - bottom;
      ankleTarget.z = hip.z + Math.sqrt(Math.max(0, reach ** 2 - (ankleTarget.x - hip.x) ** 2 - (ankleTarget.y - hip.y) ** 2));
      const axis = ankleTarget.clone().sub(hip).normalize();
      const up = new Vector3(0, 1, 0).addScaledVector(axis, -axis.y).normalize();
      const along = (upper ** 2 - lower ** 2 + reach ** 2) / (2 * reach);
      const kneeTarget = hip.clone().addScaledVector(axis, along).addScaledVector(up, Math.sqrt(Math.max(0, upper ** 2 - along ** 2)));

      aim(thigh, knee.clone().sub(hip), kneeTarget.clone().sub(hip));
      const newKnee = calf.getWorldPosition(new Vector3());
      aim(calf, foot.getWorldPosition(new Vector3()).sub(newKnee), ankleTarget.sub(newKnee));
      worldRotation(foot, footRotation);
      for (const bone of [thigh, calf, foot]) writeTrack(clip, bone, 'quaternion');
    }
    clips.push(clip);
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(patient);
  patient.updateMatrixWorld(true);
  return clips;
}
