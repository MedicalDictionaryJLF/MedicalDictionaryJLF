import { resolveExaminationFinding } from '../cases/examinationFindings.js';

// Landmarks are attached to the same named skeleton in all eight characters.
// Patient left/right follows anatomy, not the viewer's mirrored screen position.
const site = (id, label, bone, offset, techniques, findingKey, view = 'front') =>
  Object.freeze({ id, label, bone, offset, techniques, findingKey, view });

export const EXAM_SITES = Object.freeze([
  site('general', 'General appearance', 'head', [0, .08, .12], ['inspect'], 'general'),
  site('chest', 'Chest appearance and respiratory effort', 'spine_03', [0, .05, .17], ['inspect'], 'lungs'),
  site('heart-aortic', 'Aortic area', 'spine_03', [-.055, .02, .16], ['auscultate'], 'heart'),
  site('heart-pulmonic', 'Pulmonic area', 'spine_03', [.055, .02, .16], ['auscultate'], 'heart'),
  site('heart-tricuspid', 'Tricuspid area · left lower sternal border', 'spine_02', [.04, -.015, .19], ['auscultate'], 'heart'),
  site('heart-mitral', 'Mitral area', 'spine_02', [.11, -.015, .18], ['auscultate'], 'heart'),
  site('lung-front-right', 'Right anterior lung', 'spine_03', [-.14, -.02, .14], ['auscultate', 'percuss'], 'lungs'),
  site('lung-front-left', 'Left anterior lung', 'spine_03', [.14, -.02, .14], ['auscultate', 'percuss'], 'lungs'),
  site('lung-back-right', 'Right posterior lung', 'spine_03', [-.13, -.03, -.14], ['auscultate', 'percuss'], 'lungs', 'back'),
  site('lung-back-left', 'Left posterior lung', 'spine_03', [.13, -.03, -.14], ['auscultate', 'percuss'], 'lungs', 'back'),
  site('chest-wall', 'Anterior chest wall', 'spine_02', [0, .01, .19], ['palpate'], 'chestWall'),
  site('abdomen-ruq', 'Right upper abdomen', 'spine_01', [-.10, -.03, .18], ['inspect', 'palpate', 'percuss', 'auscultate'], 'abdomen'),
  site('abdomen-luq', 'Left upper abdomen', 'spine_01', [.10, -.03, .18], ['inspect', 'palpate', 'percuss', 'auscultate'], 'abdomen'),
  site('abdomen-rlq', 'Right lower abdomen', 'spine_01', [-.10, -.15, .16], ['palpate', 'percuss', 'auscultate'], 'abdomen'),
  site('abdomen-llq', 'Left lower abdomen', 'spine_01', [.10, -.15, .16], ['palpate', 'percuss', 'auscultate'], 'abdomen'),
  site('murphy-ruq', 'Murphy manoeuvre · RUQ palpation with inspiration', 'spine_01', [-.10, .015, .18], ['palpate'], 'abdomen'),
  site('perfusion-right', 'Right hand · warmth and capillary refill', 'hand_r', [0, .08, .04], ['palpate'], 'perfusion'),
  site('perfusion-left', 'Left hand · warmth and capillary refill', 'hand_l', [0, .08, .04], ['palpate'], 'perfusion'),
  site('radial-right', 'Right radial pulse', 'hand_r', [0, .025, .035], ['palpate'], 'pulses'),
  site('radial-left', 'Left radial pulse', 'hand_l', [0, .025, .035], ['palpate'], 'pulses'),
  site('leg-right', 'Right lower leg', 'calf_r', [0, .13, .045], ['inspect', 'palpate'], 'legs'),
  site('leg-left', 'Left lower leg', 'calf_l', [0, .13, .045], ['inspect', 'palpate'], 'legs'),
  site('flank-right', 'Right renal angle', 'spine_01', [-.13, -.04, -.13], ['percuss'], 'abdomen', 'back'),
  site('flank-left', 'Left renal angle', 'spine_01', [.13, -.04, -.13], ['percuss'], 'abdomen', 'back')
]);

const lead = (id, label, bone, offset, color, hint, distalJoint) => Object.freeze({ id, label, bone, offset, color, hint, distalJoint });
export const ECG_LEADS = Object.freeze([
  lead('RA', 'Right arm', 'lowerarm_r', [0, 0, .035], '#d94343', 'Right distal forearm, above the wrist', 'hand_r'),
  lead('LA', 'Left arm', 'lowerarm_l', [0, 0, .035], '#e4c72d', 'Left distal forearm, above the wrist', 'hand_l'),
  lead('RL', 'Right leg', 'calf_r', [0, 0, .035], '#343d48', 'Right lower leg, above the ankle', 'foot_r'),
  lead('LL', 'Left leg', 'calf_l', [0, 0, .035], '#48ae66', 'Left lower leg, above the ankle', 'foot_l'),
  lead('V1', 'V1', 'spine_03', [-.038, -.075, .174], '#df8842', '4th intercostal space, right sternal border'),
  lead('V2', 'V2', 'spine_03', [.038, -.075, .174], '#e4c72d', '4th intercostal space, left sternal border'),
  lead('V3', 'V3', 'spine_02', [.085, .006, .184], '#48ae66', 'Between V2 and V4'),
  lead('V4', 'V4', 'spine_02', [.125, -.035, .178], '#80533e', '5th intercostal space, left midclavicular line'),
  lead('V5', 'V5', 'spine_02', [.18, -.035, .145], '#343d48', 'Level with V4, left anterior axillary line'),
  lead('V6', 'V6', 'spine_02', [.22, -.035, .105], '#7750b1', 'Level with V4, left midaxillary line')
]);

const EXAMINATION_ID = Object.freeze({ general:'general', perfusion:'perfusion', heart:'cardiovascular', lungs:'respiratory', abdomen:'abdomen', chestWall:'chestWall', pulses:'pulses', legs:'legs' });

export function getBedsideFinding(patientCase, siteId, technique) {
  const point = EXAM_SITES.find(item => item.id === siteId);
  if (!point || !point.techniques.includes(technique)) return null;
  const key = point.findingKey === 'abdomen' && technique === 'auscultate' ? 'bowelSounds' : point.findingKey;
  const evidence = resolveExaminationFinding(patientCase, siteId, technique);
  return { ...evidence, caseId:patientCase.id, siteId, siteLabel:point.label, technique, examinationId:EXAMINATION_ID[key] || (key === 'bowelSounds' ? 'bowelSounds' : null), documented:evidence.availability === 'authored' };
}

export function attemptLeadPlacement(placed, selectedId, targetId) {
  const selected = ECG_LEADS.find(item => item.id === selectedId);
  const target = ECG_LEADS.find(item => item.id === targetId);
  if (!selected || !target) return { ok:false, reason:'Choose a lead, then a marked anatomical site.' };
  if (placed[selectedId]) return { ok:false, reason:`${selectedId} is already placed.` };
  if (selectedId !== targetId) return { ok:false, reason:`${selectedId} belongs at ${selected.hint}. Try again.` };
  placed[selectedId] = true;
  return { ok:true, completed:ECG_LEADS.every(item => placed[item.id]), count:ECG_LEADS.filter(item => placed[item.id]).length };
}
