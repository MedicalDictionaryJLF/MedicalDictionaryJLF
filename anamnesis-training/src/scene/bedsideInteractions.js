import { resolveExaminationFinding } from '../cases/examinationFindings.js';

// Torso coordinates are measured from the collarbones toward the pelvis and
// across the shoulder half-width. Positive lateral values are patient left.
const torso = (lateral, down, surface = 'front') => ({ lateral, down, surface });
const segment = (bone, distalJoint, along, radialSide) => ({ bone, distalJoint, along, radialSide });
const site = (id, label, anchor, techniques, findingKey) =>
  Object.freeze({ id, label, anchor, techniques, findingKey, view: anchor.surface === 'back' ? 'back' : 'front' });

const secondInterspace = .14;
const fourthInterspace = .31;
const fifthInterspace = .40;
const midclavicular = .61;
const parasternal = .22;

export const EXAM_SITES = Object.freeze([
  site('general', 'General appearance', { bone: 'head', offset: [0, .08, .12] }, ['inspect'], 'general'),
  site('chest', 'Chest appearance and respiratory effort', torso(0, .27), ['inspect'], 'lungs'),
  site('heart-aortic', 'Aortic area', torso(-parasternal, secondInterspace), ['auscultate'], 'heart'),
  site('heart-pulmonic', 'Pulmonic area', torso(parasternal, secondInterspace), ['auscultate'], 'heart'),
  site('heart-tricuspid', 'Tricuspid area · left lower sternal border', torso(parasternal, .43), ['auscultate'], 'heart'),
  site('heart-mitral', 'Mitral area', torso(midclavicular, fifthInterspace), ['auscultate'], 'heart'),
  site('lung-front-right', 'Right anterior lung', torso(-.68, .22), ['auscultate', 'percuss'], 'lungs'),
  site('lung-front-left', 'Left anterior lung', torso(.68, .22), ['auscultate', 'percuss'], 'lungs'),
  site('lung-back-right', 'Right posterior lung', torso(-.59, .40, 'back'), ['auscultate', 'percuss'], 'lungs'),
  site('lung-back-left', 'Left posterior lung', torso(.59, .40, 'back'), ['auscultate', 'percuss'], 'lungs'),
  site('chest-wall', 'Anterior chest wall', torso(0, .31), ['palpate'], 'chestWall'),
  site('abdomen-ruq', 'Right upper abdomen', torso(-.49, .63), ['inspect', 'palpate', 'percuss', 'auscultate'], 'abdomen'),
  site('abdomen-luq', 'Left upper abdomen', torso(.49, .63), ['inspect', 'palpate', 'percuss', 'auscultate'], 'abdomen'),
  site('abdomen-rlq', 'Right lower abdomen', torso(-.47, .88), ['palpate', 'percuss', 'auscultate'], 'abdomen'),
  site('abdomen-llq', 'Left lower abdomen', torso(.47, .88), ['palpate', 'percuss', 'auscultate'], 'abdomen'),
  site('murphy-ruq', 'Murphy manoeuvre · RUQ palpation with inspiration', torso(-.58, .51), ['palpate'], 'abdomen'),
  site('perfusion-right', 'Right hand · warmth and capillary refill', { bone: 'hand_r', offset: [0, .08, .04] }, ['palpate'], 'perfusion'),
  site('perfusion-left', 'Left hand · warmth and capillary refill', { bone: 'hand_l', offset: [0, .08, .04] }, ['palpate'], 'perfusion'),
  site('radial-right', 'Right radial pulse', segment('lowerarm_r', 'hand_r', .96, 'r'), ['palpate'], 'pulses'),
  site('radial-left', 'Left radial pulse', segment('lowerarm_l', 'hand_l', .96, 'l'), ['palpate'], 'pulses'),
  site('leg-right', 'Right lower leg', segment('calf_r', 'foot_r', .46), ['inspect', 'palpate'], 'legs'),
  site('leg-left', 'Left lower leg', segment('calf_l', 'foot_l', .46), ['inspect', 'palpate'], 'legs'),
  site('flank-right', 'Right renal angle', torso(-.60, .69, 'back'), ['percuss'], 'abdomen'),
  site('flank-left', 'Left renal angle', torso(.60, .69, 'back'), ['percuss'], 'abdomen')
]);

const lead = (id, label, anchor, color, hint) => Object.freeze({ id, label, anchor, color, hint });
export const ECG_LEADS = Object.freeze([
  lead('RA', 'Right arm', segment('lowerarm_r', 'hand_r', .84), '#d94343', 'Right distal forearm, above the wrist'),
  lead('LA', 'Left arm', segment('lowerarm_l', 'hand_l', .84), '#e4c72d', 'Left distal forearm, above the wrist'),
  lead('RL', 'Right leg', segment('calf_r', 'foot_r', .84), '#343d48', 'Right lower leg, above the ankle'),
  lead('LL', 'Left leg', segment('calf_l', 'foot_l', .84), '#48ae66', 'Left lower leg, above the ankle'),
  lead('V1', 'V1', torso(-parasternal, fourthInterspace), '#df8842', '4th intercostal space, right sternal border'),
  lead('V2', 'V2', torso(parasternal, fourthInterspace), '#e4c72d', '4th intercostal space, left sternal border'),
  lead('V3', 'V3', torso((parasternal + midclavicular) / 2, (fourthInterspace + fifthInterspace) / 2), '#48ae66', 'Between V2 and V4'),
  lead('V4', 'V4', torso(midclavicular, fifthInterspace), '#80533e', '5th intercostal space, left midclavicular line'),
  lead('V5', 'V5', torso(0, fifthInterspace, 'anterior-axillary'), '#343d48', 'Level with V4, left anterior axillary line'),
  lead('V6', 'V6', torso(0, fifthInterspace, 'midaxillary'), '#7750b1', 'Level with V4, left midaxillary line')
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
