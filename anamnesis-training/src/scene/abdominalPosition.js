import { AnimationMixer, Box3, MathUtils, Quaternion, Vector3 } from 'three';

// Use the existing supine clip as the base. Solve for a small knee flexion
// while keeping the feet supported and leaving the torso and head on the bed.
export function buildAbdominalPosition(patient, bones, reclined, bedspread) {
  const clip = reclined.clone();
  clip.name = 'PositionAbdominal';
  const mattressHeight = bedspread ? new Box3().setFromObject(bedspread).max.y - .008 : .78;
  const mixer = new AnimationMixer(patient);
  mixer.clipAction(reclined).play();
  mixer.update(0);
  patient.updateMatrixWorld(true);

  const shoeBottom = { l: Infinity, r: Infinity };
  const vertex = new Vector3();
  patient.traverse(mesh => {
    if (!mesh.isSkinnedMesh || !mesh.material.name.includes('shoes')) return;
    for (let index = 0; index < mesh.geometry.attributes.position.count; index++) {
      mesh.getVertexPosition(index, vertex).applyMatrix4(mesh.matrixWorld);
      const side = vertex.x >= 0 ? 'l' : 'r';
      shoeBottom[side] = Math.min(shoeBottom[side], vertex.y);
    }
  });

  function worldRotation(bone, quaternion) {
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new Quaternion()).invert().multiply(quaternion));
    bone.updateMatrixWorld(true);
  }

  function aim(bone, current, target) {
    const delta = new Quaternion().setFromUnitVectors(current.normalize(), target.normalize());
    worldRotation(bone, delta.multiply(bone.getWorldQuaternion(new Quaternion())));
  }

  for (const side of ['l', 'r']) {
    const thigh = bones.get(`thigh_${side}`), calf = bones.get(`calf_${side}`), foot = bones.get(`foot_${side}`);
    const hip = thigh.getWorldPosition(new Vector3()), knee = calf.getWorldPosition(new Vector3());
    const ankle = foot.getWorldPosition(new Vector3()), footRotation = foot.getWorldQuaternion(new Quaternion());
    const upper = knee.distanceTo(hip), lower = ankle.distanceTo(knee);
    const flexion = MathUtils.degToRad(27);
    const reach = Math.sqrt(upper ** 2 + lower ** 2 + 2 * upper * lower * Math.cos(flexion));
    const ankleTarget = ankle.clone();
    if (Number.isFinite(shoeBottom[side])) ankleTarget.y += mattressHeight - shoeBottom[side];
    ankleTarget.z = hip.z + Math.sqrt(reach ** 2 - (ankleTarget.x - hip.x) ** 2 - (ankleTarget.y - hip.y) ** 2);
    const axis = ankleTarget.clone().sub(hip).normalize();
    const up = new Vector3(0, 1, 0).addScaledVector(axis, -axis.y).normalize();
    const along = (upper ** 2 - lower ** 2 + reach ** 2) / (2 * reach);
    const kneeTarget = hip.clone().addScaledVector(axis, along).addScaledVector(up, Math.sqrt(upper ** 2 - along ** 2));

    aim(thigh, knee.clone().sub(hip), kneeTarget.clone().sub(hip));
    const newKnee = calf.getWorldPosition(new Vector3());
    aim(calf, foot.getWorldPosition(new Vector3()).sub(newKnee), ankleTarget.sub(newKnee));
    worldRotation(foot, footRotation);

    for (const bone of [thigh, calf, foot]) {
      const track = clip.tracks.find(item => item.name === `${bone.name}.quaternion`);
      for (let index = 0; index < track.values.length; index += 4) bone.quaternion.toArray(track.values, index);
    }
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(patient);
  patient.updateMatrixWorld(true);
  return clip;
}
