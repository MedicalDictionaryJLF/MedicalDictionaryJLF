import { Raycaster, Vector3 } from 'three';

const front = new Vector3(0, 0, 1);
const back = new Vector3(0, 0, -1);
const anteriorAxillary = new Vector3(.75, 0, .66).normalize();
const midaxillary = new Vector3(1, 0, 0);

// Calibrate once on each character's upright bind pose. The sampled surface
// points then follow the skeleton without raycasting the patient every frame.
export function createLandmarkResolver(patient, bones) {
  patient.updateMatrixWorld(true);
  const skin = [], uniform = [];
  patient.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    if (mesh.material.name.startsWith('Skin_')) skin.push(mesh);
    if (mesh.material.name.startsWith('WardCotton')) uniform.push(mesh);
  });

  const clavicles = joint('clavicle_l').lerp(joint('clavicle_r'), .5);
  const pelvis = joint('pelvis');
  const halfWidth = joint('upperarm_l').distanceTo(joint('upperarm_r')) / 2;
  const ray = new Raycaster();

  function joint(name) {
    return bones.get(name).getWorldPosition(new Vector3());
  }

  function surface(center, outward, meshes, reach, maxLateral = Infinity) {
    ray.set(center.clone().addScaledVector(outward, reach), outward.clone().negate());
    ray.far = reach + .06;
    return ray.intersectObjects(meshes, false).find(hit => Math.abs(hit.point.x - clavicles.x) <= maxLateral)?.point;
  }

  function attach(bone, point, outward) {
    const offset = bone.worldToLocal(point.clone().addScaledVector(outward, .006));
    const normal = bone.worldToLocal(point.clone().add(outward)).sub(bone.worldToLocal(point.clone())).normalize();
    return { bone, offset, normal };
  }

  return anchor => {
    if (anchor.offset) return { bone: bones.get(anchor.bone), offset: new Vector3(...anchor.offset) };

    if (anchor.distalJoint) {
      const bone = bones.get(anchor.bone);
      const proximal = joint(anchor.bone), distal = joint(anchor.distalJoint);
      const axis = distal.clone().sub(proximal).normalize();
      const center = proximal.lerp(distal, anchor.along);
      const outward = anchor.radialSide ? joint(`thumb_01_${anchor.radialSide}`).sub(distal) : front.clone();
      outward.addScaledVector(axis, -outward.dot(axis)).normalize();
      const meshes = anchor.bone.startsWith('calf') ? [...skin, ...uniform] : skin;
      const point = surface(center, outward, meshes, .11);
      return point ? attach(bone, point, outward) : null;
    }

    const center = new Vector3(clavicles.x + anchor.lateral * halfWidth, clavicles.y + (pelvis.y - clavicles.y) * anchor.down, clavicles.z);
    const meshes = [...uniform, ...skin];
    let outward = anchor.surface === 'back' ? back : front;
    let point;
    if (anchor.surface === 'anterior-axillary' || anchor.surface === 'midaxillary') {
      const anterior = surface(center, front, meshes, .4);
      const posterior = surface(center, back, meshes, .4);
      if (anterior && posterior) center.z = (anterior.z + posterior.z) / 2;
      const side = surface(center, midaxillary, meshes, .4, halfWidth * 1.24);
      if (side && anchor.surface === 'anterior-axillary') {
        center.x += (side.x - center.x) * .91;
        point = surface(center, front, meshes, .4);
        outward = anteriorAxillary;
      } else {
        point = side;
        outward = midaxillary;
      }
    } else {
      point = surface(center, outward, meshes, .4, halfWidth * 1.24);
    }
    const bone = bones.get(anchor.down >= .51 ? 'spine_01' : 'spine_03');
    return point ? attach(bone, point, outward) : null;
  };
}
