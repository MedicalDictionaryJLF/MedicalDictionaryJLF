// Current examination evidence, deliberately separate from symptom animations.
// A history of a symptom or a diagnosis does not author a physical finding.
const authored = (source, classification = 'normal', extras = {}) => ({ source, classification, availability: 'authored', ...extras });
const heart = authored('exam.heart', 'normal', { sound: 'normal-heart' });
const lungs = authored('exam.lungs', 'normal', { sound: 'clear-breath' });
const bowel = authored('exam.bowelSounds', 'normal', { sound: 'bowel-present' });
const bilateral = (prefix, technique, definition) => Object.fromEntries(['right', 'left'].map(side => [`${technique}:${prefix}-${side}`, definition]));
const abdominal = technique => Object.fromEntries(['ruq', 'luq', 'rlq', 'llq'].map(quadrant => [`${technique}:abdomen-${quadrant}`, authored('exam.abdomen')]));
const common = {
  ...Object.fromEntries(['aortic', 'pulmonic', 'tricuspid', 'mitral'].map(area => [`auscultate:heart-${area}`, heart])),
  ...Object.fromEntries(['front-right', 'front-left', 'back-right', 'back-left'].map(area => [`auscultate:lung-${area}`, lungs])),
  ...Object.fromEntries(['ruq', 'luq', 'rlq', 'llq'].map(area => [`auscultate:abdomen-${area}`, bowel]))
};

export const CASE_EXAMINATION_FINDINGS = Object.freeze({
  chest_pain_acs_risk: {
    availability: 'authored',
    findings: {
      ...common,
      'inspect:general': authored('exam.general', 'abnormal'),
      'inspect:chest': authored('exam.general', 'abnormal', { text: 'Slight clamminess is documented. Chest movement has not been separately authored.' }),
      ...bilateral('perfusion', 'palpate', authored('exam.perfusion')),
      ...bilateral('radial', 'palpate', authored('exam.pulses')),
      ...bilateral('leg', 'inspect', authored('exam.legs')),
      ...bilateral('leg', 'palpate', authored('exam.legs')),
      'palpate:chest-wall': authored('exam.chestWall'),
      ...abdominal('palpate')
    }
  },
  abdominal_pain_cholecystitis: {
    availability: 'authored',
    findings: {
      ...common,
      'inspect:general': authored('exam.general', 'abnormal'),
      'palpate:abdomen-ruq': authored('exam.abdomen', 'abnormal', {
        text: 'Right upper quadrant tenderness is present. No generalized guarding is documented.',
        response: { kind: 'discomfort', gesture: 'AbdominalGuard', text: 'That is sore under my right ribs.' }
      }),
      'palpate:murphy-ruq': authored('exam.abdomen', 'abnormal', {
        text: 'During right upper quadrant palpation with inspiration, the authored Murphy sign is positive.',
        procedure: 'RUQ palpation during inspiration',
        response: { kind: 'discomfort', gesture: 'AbdominalGuard', text: 'It hurts when I breathe in there.' }
      })
    }
  },
  progressive_dyspnea_edema: { availability: 'unavailable', findings: {} },
  fever_flank_dysuria: { availability: 'unavailable', findings: {}, presentationResponses: {
    'percuss:flank-right': { source: 'hpi.exacerbating', kind: 'reported-discomfort', gesture: 'FlankGuard', text: 'The history records that tapping the right side worsens the pain. No objective renal-angle examination result is authored.' }
  } },
  melena_dizziness_nsaid: { availability: 'unavailable', findings: {} },
  exertional_syncope: { availability: 'unavailable', findings: {} },
  weight_loss_bowel_change: { availability: 'unavailable', findings: {} },
  recurrent_headache_migraine: { availability: 'unavailable', findings: {} }
});

export function isAuthoredClinicalValue(value) {
  const text = String(value ?? '').trim();
  return Boolean(text && !/available (?:in the full encounter mode|if measured)|within the expected range for this case|not ordered|not measured|not authored/i.test(text));
}

export function resolveExaminationFinding(patientCase, siteId, technique) {
  const profile = CASE_EXAMINATION_FINDINGS[patientCase?.id];
  const key = `${technique}:${siteId}`;
  // New cases may supply the same explicit structure without editing a renderer.
  const definition = patientCase?.examinationFindings?.[key] || profile?.findings?.[key];
  const sourceValue = definition?.source?.split('.').reduce((value, part) => value?.[part], patientCase);
  const available = definition?.availability === 'authored' && isAuthoredClinicalValue(definition.text || sourceValue);
  return {
    availability: available ? 'authored' : 'unavailable',
    classification: available ? definition.classification : 'unverified',
    source: available ? definition.source : null,
    finding: available ? String(definition.text || sourceValue) : 'No case-specific finding is authored for this technique and site. The technique was performed; no normal or abnormal result has been inferred.',
    sound: available && definition.sound ? { kind: 'synthesized', pattern: definition.sound, label: 'Synthesized educational approximation; not a recording of this patient.' } : null,
    response: available ? definition.response || null : null,
    presentationResponse: profile?.presentationResponses?.[key] || null,
    procedure: definition?.procedure || null,
    clinicalSignificance: available ? definition.clinicalSignificance || 'Documented case examination evidence.' : 'Unassessed: no current objective finding authored.'
  };
}
