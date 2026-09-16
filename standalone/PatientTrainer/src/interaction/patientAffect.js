const includesAny = (text, terms) => terms.some((term) => text.includes(term));
const clamp = (v, min, max) => Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));

export function derivePatientAffect({ reply = '', studentInput = '', rapport = 70, snapshot = null, casePersonality = null } = {}) {
  const text = String(reply || '').toLowerCase();
  const question = String(studentInput || '').toLowerCase();
  const symptoms = snapshot?.symptoms || {};
  const visual = snapshot?.visual || {};
  const personality = casePersonality || {};
  const pain = clamp(Number(symptoms.pain || 0) / 10, 0, 1);
  const distress = clamp(Math.max(Number(symptoms.distress || 0), pain * 0.8), 0, 1);
  const anxiety = clamp(Number(personality.anxiety || 0.4), 0, 1);
  const trust = clamp((Number(rapport || 0) - 20) / 80, 0, 1);

  let emotion = 'neutral';
  if (visual.consciousness === 'drowsy' || visual.consciousness === 'unconscious') emotion = visual.consciousness;
  else if (rapport < 32 || includesAny(question, ['shut up', 'stupid', 'idiot', 'moron', 'hurry'])) emotion = 'irritated';
  else if (includesAny(text, ['frightened', 'worried', 'scared', 'afraid', 'anxious']) || (anxiety > 0.68 && distress > 0.45)) emotion = 'anxious';
  else if (includesAny(text, ['pain', 'pressure', 'tightness', 'hurts', 'chest']) || pain > 0.52) emotion = 'pain';
  else if (includesAny(text, ['sad', 'upset', 'down', 'depressed', 'cry'])) emotion = 'sad';
  else if (rapport > 82 && distress < 0.45) emotion = 'engaged';
  else if (distress > 0.58) emotion = 'strained';

  return {
    emotion,
    distress,
    pain,
    anxiety,
    trust,
    gazeEngagement: clamp(0.42 + trust * 0.55 - (emotion === 'irritated' ? 0.42 : 0), 0.08, 1),
    headTension: clamp(distress * 0.75 + (emotion === 'irritated' ? 0.25 : 0), 0, 1),
    mouthTension: clamp((emotion === 'pain' ? 0.78 : emotion === 'anxious' ? 0.55 : emotion === 'irritated' ? 0.46 : distress * 0.35), 0, 1),
    browTension: clamp((emotion === 'pain' ? 0.9 : emotion === 'anxious' ? 0.72 : emotion === 'irritated' ? 0.64 : distress * 0.38), 0, 1)
  };
}
