// Appearance choices are cosmetic; evidence refers to the unchanged source cases.
const ROOT = new URL('../../assets/3d/clinical/', import.meta.url);
// Vite normalises directory asset URLs and may drop the final slash.
if (!ROOT.pathname.endsWith('/')) ROOT.pathname += '/';
const entry = (slug, room, gesture, evidence, extras = {}) => Object.freeze({
  slug, room, gesture, evidence, ...extras,
  characterUrl: new URL(`patients/${slug}.glb?v=clinical-3d-3`, ROOT).href,
  environmentUrl: new URL(`environments/${room}.glb?v=clinical-3d-3`, ROOT).href
});
export const PATIENT_ASSETS = Object.freeze({
  chest_pain_acs_risk: entry('peter_novak','acute','ChestPain',['hpi.site','exam.general','simulation.initialState'],{explicitSimulation:true,preferredPosition:'standing'}),
  abdominal_pain_cholecystitis: entry('jana_kovacova','acute','AbdominalGuard',['hpi.site','hpi.severity','exam.abdomen'],{explicitSimulation:true,preferredPosition:'seated'}),
  progressive_dyspnea_edema: entry('milan_hronec','internal','RestArms',['hpi.exacerbating','hpi.relieving','rosDetails.cardiovascular.orthopnea'],{breathingEffort:.62,fatigue:.35,preferredPosition:'seated'}),
  fever_flank_dysuria: entry('lucia_benkova','acute','FlankGuard',['hpi.site','hpi.severity'],{narrativePain:.7,preferredPosition:'seated'}),
  melena_dizziness_nsaid: entry('karol_urban','acute','RestArms',['hpi.associatedSymptoms','hpi.exacerbating','hpi.relieving'],{fatigue:.5,posturalDizziness:true,preferredPosition:'seated'}),
  exertional_syncope: entry('eva_sykorova','internal','RestArms',['hpi.course','hpi.relieving'],{fatigue:.25,preferredPosition:'seated'}),
  weight_loss_bowel_change: entry('zuzana_kralova','examination','RestArms',['hpi.associatedSymptoms','hpi.severity'],{fatigue:.35,preferredPosition:'seated'}),
  recurrent_headache_migraine: entry('nina_molnarova','examination','Headache',['hpi.site','hpi.severity','hpi.exacerbating'],{narrativePain:.7,preferredPosition:'seated',dimmedLighting:true})
});
export function getPatientAsset(patientCase) {
  const asset = PATIENT_ASSETS[patientCase?.id];
  if (!asset) throw new Error(`No 3D character registered for case ${patientCase?.id || '(missing)'}.`);
  return asset;
}
const clamp = n => Math.max(0,Math.min(1,Number.isFinite(n)?n:0));
export function resolveVisualState(patientCase,snapshot,mode='case') {
  const profile=getPatientAsset(patientCase),initial=patientCase?.simulation?.initialState || {};
  const symptoms=(mode==='symptomatic'?initial.symptoms:snapshot?.symptoms || initial.symptoms) || {};
  const visual=(mode==='symptomatic'?initial.visual:snapshot?.visual || initial.visual) || {};
  // Six history-only cases inherit generic factory defaults. Translate their
  // documented presentation and subsequent state deltas into animation amplitudes.
  // These amplitudes are not measured findings and never enter clinical state.
  const pain=profile.explicitSimulation?Number(symptoms.pain || 0)/10:Math.max(0,Number(profile.narrativePain || 0)+(Number(symptoms.pain || 0)-Number(initial.symptoms?.pain || 0))/10);
  const breathing=profile.explicitSimulation?Number(symptoms.dyspnea || 0):Math.max(0,Number(profile.breathingEffort || 0)+Number(symptoms.dyspnea || 0)-Number(initial.symptoms?.dyspnea || 0));
  const rest=mode==='resting';
  return {pain:rest?0:clamp(pain),breathing:rest?0:clamp(breathing),sweating:rest?0:clamp(Number(visual.sweating || 0)),pallor:rest?0:clamp(Number(visual.pallor || 0)),fatigue:rest?0:profile.fatigue || 0,distress:rest?0:clamp(Number(symptoms.distress || 0)),consciousness:visual.consciousness || 'alert',equipment:snapshot?.equipment || {},position:visual.position==='standing'?'standing':profile.preferredPosition,gesture:profile.gesture};
}
export function reportedVital(patientCase,key,snapshot) {
  const source=patientCase?.vitals?.[key==='temp'?'temperature':key==='sbp'||key==='dbp'?'bp':key];
  if (!/\d/.test(String(source || ''))) return null;
  return snapshot?.physiology?.[key] ?? null;
}
