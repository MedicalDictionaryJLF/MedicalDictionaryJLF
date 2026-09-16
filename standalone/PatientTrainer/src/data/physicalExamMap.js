export const PHYSICAL_EXAM_TOOLS = [
  { id: 'inspect', label: 'Inspect', short: 'Inspect', description: 'Look for visible signs before touching the patient.', icon: 'eye' },
  { id: 'auscultate', label: 'Auscultate', short: 'Stethoscope', description: 'Place the stethoscope on a clinically relevant point.', icon: 'stethoscope' },
  { id: 'palpate', label: 'Palpate', short: 'Palpate', description: 'Use focused palpation at a specific anatomical site.', icon: 'hand' },
  { id: 'percuss', label: 'Percuss', short: 'Percuss', description: 'Compare percussion notes at the selected body point.', icon: 'tap' }
];

const peter = {
  visualOverlays: [
    { id: 'pallor', view: 'front', area: 'face', className: 'visual-pallor', label: 'Subtle pallor', finding: 'The patient looks mildly pale and worried.' },
    { id: 'diaphoresis', view: 'front', area: 'forehead', className: 'visual-diaphoresis', label: 'Diaphoresis', finding: 'A light clammy sheen is visible on the forehead.' }
  ],
  hotspots: [
    // FRONT VIEW ORIENTATION:
    // patient RIGHT is on the viewer's LEFT; patient LEFT is on the viewer's RIGHT.
    // Coordinates below are intentionally tied to visible anatomical landmarks on the v2 avatar.

    // Inspection: general / face / neck / peripheral signs
    point('front-general', 'front', 50.0, 8.2, 'General appearance', ['inspect'], {
      inspect: result('general', 'General inspection', 'He looks worried and mildly distressed by ongoing chest pain. He is slightly pale and clammy, but alert and fully oriented.')
    }, 'General'),
    point('front-lips', 'front', 50.0, 13.7, 'Lips / central cyanosis', ['inspect'], {
      inspect: result('perfusion', 'Lips', 'There is no central cyanosis. The lips and tongue are not blue.')
    }, 'General'),
    point('front-jvp', 'front', 46.7, 18.1, 'Jugular venous pressure', ['inspect'], {
      inspect: result('jvp', 'JVP', 'At approximately 45°, the jugular venous pressure is not elevated.')
    }, 'Cardiovascular'),
    point('front-trachea', 'front', 50.0, 18.8, 'Trachea / upper airway', ['inspect', 'auscultate'], {
      inspect: result('respiratory', 'Trachea / upper airway', 'The trachea appears central. There is no obvious suprasternal retraction.'),
      auscultate: result('respiratory', 'Upper airway auscultation', 'No stridor is heard over the trachea.', null, 'No pathological upper-airway sound is present in this case.')
    }, 'Respiratory'),
    point('front-hands-left', 'front', 75.2, 52.5, 'Left hand / perfusion', ['inspect', 'palpate'], {
      inspect: result('perfusion', 'Left hand', 'The hand is warm, with no peripheral cyanosis or obvious clubbing.'),
      palpate: result('perfusion', 'Capillary refill, left hand', 'The hand is warm. Capillary refill is approximately 2 seconds.')
    }, 'Peripheral'),
    point('front-hands-right', 'front', 24.8, 52.5, 'Right hand / perfusion', ['inspect', 'palpate'], {
      inspect: result('perfusion', 'Right hand', 'The hand is warm, with no peripheral cyanosis or obvious clubbing.'),
      palpate: result('perfusion', 'Capillary refill, right hand', 'The hand is warm. Capillary refill is approximately 2 seconds.')
    }, 'Peripheral'),

    // Pulses and chest-wall palpation
    point('front-radial-right', 'front', 27.0, 48.6, 'Right radial pulse', ['palpate'], {
      palpate: result('pulses', 'Right radial pulse', 'The radial pulse is palpable, regular, and symmetrical with the opposite side.')
    }, 'Cardiovascular'),
    point('front-radial-left', 'front', 73.0, 48.6, 'Left radial pulse', ['palpate'], {
      palpate: result('pulses', 'Left radial pulse', 'The radial pulse is palpable, regular, and symmetrical with the opposite side.')
    }, 'Cardiovascular'),
    point('front-carotid-right', 'front', 47.0, 18.3, 'Right carotid', ['palpate', 'auscultate'], {
      palpate: result('pulses', 'Right carotid pulse', 'The right carotid pulse is palpable without an obvious delay compared with the left.'),
      auscultate: result('cardiovascular', 'Right carotid auscultation', 'No carotid bruit is heard.', null, 'No pathological sound is present in this case.')
    }, 'Cardiovascular'),
    point('front-carotid-left', 'front', 53.0, 18.3, 'Left carotid', ['palpate', 'auscultate'], {
      palpate: result('pulses', 'Left carotid pulse', 'The left carotid pulse is palpable without an obvious delay compared with the right.'),
      auscultate: result('cardiovascular', 'Left carotid auscultation', 'No carotid bruit is heard.', null, 'No pathological sound is present in this case.')
    }, 'Cardiovascular'),
    point('front-sternum', 'front', 50.0, 28.0, 'Anterior chest wall', ['palpate'], {
      palpate: result('chestWall', 'Chest-wall palpation', 'Firm palpation over the anterior chest wall does not reproduce his presenting pain.')
    }, 'Chest pain'),
    point('front-apex-palpation', 'front', 57.8, 30.6, 'Cardiac apex / precordium', ['palpate'], {
      palpate: result('cardiovascular', 'Precordial palpation', 'No obvious heave or palpable thrill is felt. The apical impulse is not grossly displaced.')
    }, 'Cardiovascular'),

    // Five standard cardiac auscultation areas
    point('heart-aortic', 'front', 48.1, 23.5, 'Aortic area · 2nd right intercostal space', ['auscultate'], {
      auscultate: result('cardiovascular', 'Aortic area', 'Regular S1 and S2 are heard. No systolic or diastolic murmur is evident at this point.', 'normal_heart')
    }, 'Heart'),
    point('heart-pulmonic', 'front', 51.9, 23.5, 'Pulmonic area · 2nd left intercostal space', ['auscultate'], {
      auscultate: result('cardiovascular', 'Pulmonic area', 'Regular S1 and S2 are heard. No additional sound or murmur is evident.', 'normal_heart')
    }, 'Heart'),
    point('heart-erb', 'front', 51.9, 25.4, "Erb's point · 3rd left intercostal space", ['auscultate'], {
      auscultate: result('cardiovascular', "Erb's point", 'Regular S1 and S2 are heard. There is no pericardial rub.', 'normal_heart')
    }, 'Heart'),
    point('heart-tricuspid', 'front', 51.4, 28.1, 'Tricuspid area · lower left sternal border', ['auscultate'], {
      auscultate: result('cardiovascular', 'Tricuspid area', 'Regular S1 and S2 are heard. No murmur or gallop is appreciated.', 'normal_heart')
    }, 'Heart'),
    point('heart-mitral', 'front', 57.8, 30.6, 'Mitral / apical area · 5th intercostal space, MCL', ['auscultate'], {
      auscultate: result('cardiovascular', 'Mitral / apical area', 'S1 and S2 are regular. No new murmur, gallop, or added sound is heard.', 'normal_heart')
    }, 'Heart'),

    // Anterior lung comparison points
    lung('lung-front-r-upper', 'front', 42.0, 24.8, 'Right upper anterior lung', 'Right upper anterior lung field', { auscultate: { x: 42.0, y: 24.8 }, percuss: { x: 41.0, y: 25.2 } }),
    lung('lung-front-l-upper', 'front', 58.0, 24.8, 'Left upper anterior lung', 'Left upper anterior lung field', { auscultate: { x: 58.0, y: 24.8 }, percuss: { x: 59.0, y: 25.2 } }),
    lung('lung-front-r-mid', 'front', 40.5, 29.1, 'Right mid anterior lung', 'Right mid anterior lung field', { auscultate: { x: 40.5, y: 29.1 }, percuss: { x: 39.8, y: 29.8 } }),
    lung('lung-front-l-mid', 'front', 59.5, 29.1, 'Left mid anterior lung', 'Left mid anterior lung field', { auscultate: { x: 59.5, y: 29.1 }, percuss: { x: 60.2, y: 29.8 } }),
    lung('lung-front-r-lower', 'front', 41.0, 33.7, 'Right lower anterior lung', 'Right lower anterior lung field', { auscultate: { x: 41.0, y: 33.7 }, percuss: { x: 40.5, y: 34.0 } }),
    lung('lung-front-l-lower', 'front', 59.0, 33.7, 'Left lower anterior lung', 'Left lower anterior lung field', { auscultate: { x: 59.0, y: 33.7 }, percuss: { x: 59.5, y: 34.0 } }),

    // Abdomen
    point('abdomen-ruq', 'front', 44.0, 37.2, 'Right upper quadrant', ['inspect', 'palpate', 'percuss', 'auscultate'], {
      inspect: result('abdomen', 'Right upper abdomen inspection', 'The abdomen is not distended and there is no visible pulsatile mass.'),
      palpate: result('abdomen', 'Right upper quadrant palpation', 'The abdomen is soft and non-tender in the right upper quadrant.'),
      percuss: result('abdomen', 'Right upper quadrant percussion', 'Expected hepatic dullness is present over the liver.', 'percussion_dull'),
      auscultate: result('abdomen', 'Right upper quadrant bowel sounds', 'Intermittent bowel sounds are present.', 'normal_bowel')
    }, 'Abdomen'),
    point('abdomen-luq', 'front', 56.0, 37.2, 'Left upper quadrant', ['inspect', 'palpate', 'percuss', 'auscultate'], {
      inspect: result('abdomen', 'Left upper abdomen inspection', 'The abdomen is not distended.'),
      palpate: result('abdomen', 'Left upper quadrant palpation', 'The abdomen is soft and non-tender in the left upper quadrant.'),
      percuss: result('abdomen', 'Left upper quadrant percussion', 'A predominantly tympanitic note is heard over gas-filled abdominal structures.', 'percussion_tympanic'),
      auscultate: result('abdomen', 'Left upper quadrant bowel sounds', 'Intermittent bowel sounds are present.', 'normal_bowel')
    }, 'Abdomen'),
    point('abdomen-rlq', 'front', 44.0, 42.0, 'Right lower quadrant', ['inspect', 'palpate', 'percuss', 'auscultate'], {
      inspect: result('abdomen', 'Right lower abdomen inspection', 'No focal visible abnormality is apparent.'),
      palpate: result('abdomen', 'Right lower quadrant palpation', 'The abdomen is soft and non-tender in the right lower quadrant.'),
      percuss: result('abdomen', 'Right lower quadrant percussion', 'A tympanitic note predominates.', 'percussion_tympanic'),
      auscultate: result('abdomen', 'Right lower quadrant bowel sounds', 'Intermittent bowel sounds are present.', 'normal_bowel')
    }, 'Abdomen'),
    point('abdomen-llq', 'front', 56.0, 42.0, 'Left lower quadrant', ['inspect', 'palpate', 'percuss', 'auscultate'], {
      inspect: result('abdomen', 'Left lower abdomen inspection', 'No focal visible abnormality is apparent.'),
      palpate: result('abdomen', 'Left lower quadrant palpation', 'The abdomen is soft and non-tender in the left lower quadrant.'),
      percuss: result('abdomen', 'Left lower quadrant percussion', 'A tympanitic note predominates.', 'percussion_tympanic'),
      auscultate: result('abdomen', 'Left lower quadrant bowel sounds', 'Intermittent bowel sounds are present.', 'normal_bowel')
    }, 'Abdomen'),

    // Legs / oedema / DVT screening
    point('leg-right-calf', 'front', 41.2, 76.5, 'Right calf', ['inspect', 'palpate'], {
      inspect: result('legs', 'Right calf inspection', 'There is no unilateral swelling, erythema, or obvious asymmetry.'),
      palpate: result('legs', 'Right calf palpation', 'The right calf is not focally tender.')
    }, 'Lower limbs'),
    point('leg-left-calf', 'front', 58.8, 76.5, 'Left calf', ['inspect', 'palpate'], {
      inspect: result('legs', 'Left calf inspection', 'There is no unilateral swelling, erythema, or obvious asymmetry.'),
      palpate: result('legs', 'Left calf palpation', 'The left calf is not focally tender.')
    }, 'Lower limbs'),
    point('ankle-right', 'front', 39.6, 89.2, 'Right ankle / oedema', ['inspect', 'palpate'], {
      inspect: result('legs', 'Right ankle inspection', 'There is no clinically significant ankle swelling.'),
      palpate: result('legs', 'Right ankle oedema assessment', 'No clinically significant pitting oedema is present.')
    }, 'Lower limbs'),
    point('ankle-left', 'front', 60.4, 89.2, 'Left ankle / oedema', ['inspect', 'palpate'], {
      inspect: result('legs', 'Left ankle inspection', 'There is no clinically significant ankle swelling.'),
      palpate: result('legs', 'Left ankle oedema assessment', 'No clinically significant pitting oedema is present.')
    }, 'Lower limbs'),

    // Posterior lung examination
    lung('lung-back-r-upper', 'back', 43.0, 22.8, 'Right upper posterior lung', 'Right upper posterior lung field', { auscultate: { x: 43.0, y: 22.8 }, percuss: { x: 42.0, y: 23.5 } }),
    lung('lung-back-l-upper', 'back', 57.0, 22.8, 'Left upper posterior lung', 'Left upper posterior lung field', { auscultate: { x: 57.0, y: 22.8 }, percuss: { x: 58.0, y: 23.5 } }),
    lung('lung-back-r-mid', 'back', 40.5, 27.8, 'Right mid posterior lung', 'Right mid posterior lung field', { auscultate: { x: 40.5, y: 27.8 }, percuss: { x: 40.0, y: 28.4 } }),
    lung('lung-back-l-mid', 'back', 59.5, 27.8, 'Left mid posterior lung', 'Left mid posterior lung field', { auscultate: { x: 59.5, y: 27.8 }, percuss: { x: 60.0, y: 28.4 } }),
    lung('lung-back-r-base', 'back', 41.5, 33.7, 'Right posterior lung base', 'Right posterior basal lung field', { auscultate: { x: 41.5, y: 33.7 }, percuss: { x: 41.0, y: 34.4 } }),
    lung('lung-back-l-base', 'back', 58.5, 33.7, 'Left posterior lung base', 'Left posterior basal lung field', { auscultate: { x: 58.5, y: 33.7 }, percuss: { x: 59.0, y: 34.4 } }),

    // Bilateral renal angle tapotement / CVA tenderness
    point('back-renal-angle-right', 'back', 55.7, 37.2, 'Right renal angle tapotement', ['palpate'], {
      palpate: result(null, 'Right renal angle tapotement', 'Gentle fist percussion over the right costovertebral angle does not elicit tenderness.')
    }, 'Renal'),
    point('back-renal-angle-left', 'back', 44.3, 37.2, 'Left renal angle tapotement', ['palpate'], {
      palpate: result(null, 'Left renal angle tapotement', 'Gentle fist percussion over the left costovertebral angle does not elicit tenderness.')
    }, 'Renal'),

    point('back-sacral', 'back', 50.0, 44.2, 'Sacral oedema', ['inspect', 'palpate'], {
      inspect: result('legs', 'Sacral area inspection', 'No obvious sacral oedema is visible.'),
      palpate: result('legs', 'Sacral oedema assessment', 'No pitting sacral oedema is present.')
    }, 'Peripheral')
  ]
};

const CASE_MAPS = {
  chest_pain_acs_risk: peter
};

export function getPhysicalExamMap(patientCase) {
  return CASE_MAPS[patientCase?.id] || peter;
}

function lung(id, view, x, y, label, noteLabel, positions = null) {
  return point(id, view, x, y, label, ['auscultate', 'percuss'], {
    auscultate: result('respiratory', noteLabel, 'Vesicular breath sounds are present with equal air entry. No wheeze or crackles are heard at this point.', 'normal_vesicular'),
    percuss: result('respiratory', `${noteLabel} percussion`, 'The percussion note is resonant and symmetrical with the corresponding opposite side.', 'percussion_resonant')
  }, 'Respiratory', positions);
}

function point(id, view, x, y, label, tools, results, region, positions = null) {
  return { id, view, x, y, label, tools, results, region, positions };
}

function result(examActionId, noteLabel, finding, soundId = null, soundNote = '') {
  return { examActionId, noteLabel, finding, soundId, soundNote };
}
