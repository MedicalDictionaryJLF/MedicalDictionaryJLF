export const EXAM_SOUND_LIBRARY = {
  normal_heart: {
    id: 'normal_heart',
    label: 'Normal S1 / S2 heart sounds',
    kind: 'recording',
    url: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/HROgg.ogg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:HROgg.ogg',
    author: 'James Heilman, MD',
    license: 'CC0 1.0',
    description: 'Recorded normal heart sounds at about 70 BPM.',
    clinicalUse: ['heart'],
    preferredHotspots: ['heart-aortic', 'heart-pulmonic', 'heart-erb', 'heart-tricuspid', 'heart-mitral']
  },

  svt_heart: {
    id: 'svt_heart',
    label: 'Supraventricular tachycardia heart sounds',
    kind: 'recording',
    url: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Ash-SVT.ogg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Ash-SVT.ogg',
    author: 'Ashquacks',
    license: 'CC BY-SA 4.0',
    description: 'Clinical auscultation recording during an episode of paroxysmal supraventricular tachycardia.',
    clinicalUse: ['heart'],
    preferredHotspots: ['heart-aortic', 'heart-pulmonic', 'heart-erb', 'heart-tricuspid', 'heart-mitral']
  },
  ipf_velcro_crackles: {
    id: 'ipf_velcro_crackles',
    label: 'Fine Velcro-like crackles (IPF)',
    kind: 'recording',
    url: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/IPF_Lung_Sound.ogg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:IPF_Lung_Sound.ogg',
    author: 'IPFeditor',
    license: 'CC BY-SA 3.0',
    description: 'Clinical recording of Velcro-like crackles on auscultation in idiopathic pulmonary fibrosis.',
    clinicalUse: ['lungs'],
    preferredHotspots: ['lung-back-r-base', 'lung-back-l-base']
  },
  aortic_stenosis_reference: {
    id: 'aortic_stenosis_reference',
    label: 'Aortic stenosis murmur',
    kind: 'published-simulation',
    url: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Heart-energy-signature-spectrogram-for-cardiovascular-diagnosis-1475-925X-6-16-S6.ogg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Heart-energy-signature-spectrogram-for-cardiovascular-diagnosis-1475-925X-6-16-S6.ogg',
    author: 'Kudriavtsev, Polyshchuk & Roy',
    license: 'CC BY 2.0',
    description: 'Published simulated aortic-stenosis heart-sound track from an open-access biomedical engineering paper; not a patient recording.',
    clinicalUse: ['heart'],
    preferredHotspots: ['heart-aortic', 'front-carotid-right', 'front-carotid-left']
  },
  pulmonary_stenosis_reference: {
    id: 'pulmonary_stenosis_reference',
    label: 'Pulmonary stenosis murmur',
    kind: 'published-simulation',
    url: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Heart-energy-signature-spectrogram-for-cardiovascular-diagnosis-1475-925X-6-16-S7.ogg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Heart-energy-signature-spectrogram-for-cardiovascular-diagnosis-1475-925X-6-16-S7.ogg',
    author: 'Kudriavtsev, Polyshchuk & Roy',
    license: 'CC BY 2.0',
    description: 'Published simulated pulmonary-stenosis heart-sound track; not a patient recording.',
    clinicalUse: ['heart'],
    preferredHotspots: ['heart-pulmonic']
  },
  tetralogy_fallot_reference: {
    id: 'tetralogy_fallot_reference',
    label: 'Tetralogy of Fallot murmur (acyanotic example)',
    kind: 'published-simulation',
    url: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Heart-energy-signature-spectrogram-for-cardiovascular-diagnosis-1475-925X-6-16-S8.ogg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Heart-energy-signature-spectrogram-for-cardiovascular-diagnosis-1475-925X-6-16-S8.ogg',
    author: 'Kudriavtsev, Polyshchuk & Roy',
    license: 'CC BY 2.0',
    description: 'Published simulated heart-sound track for an acyanotic Tetralogy of Fallot example; not a patient recording.',
    clinicalUse: ['heart'],
    preferredHotspots: ['heart-pulmonic', 'heart-erb', 'heart-tricuspid']
  },
  vsd_reference: {
    id: 'vsd_reference',
    label: 'Ventricular septal defect murmur',
    kind: 'published-simulation',
    url: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Heart-energy-signature-spectrogram-for-cardiovascular-diagnosis-1475-925X-6-16-S9.ogg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Heart-energy-signature-spectrogram-for-cardiovascular-diagnosis-1475-925X-6-16-S9.ogg',
    author: 'Kudriavtsev, Polyshchuk & Roy',
    license: 'CC BY 2.0',
    description: 'Published simulated ventricular-septal-defect heart-sound track; not a patient recording.',
    clinicalUse: ['heart'],
    preferredHotspots: ['heart-tricuspid', 'heart-erb']
  },
  mitral_valve_prolapse_reference: {
    id: 'mitral_valve_prolapse_reference',
    label: 'Mitral valve prolapse with clicks',
    kind: 'published-simulation',
    url: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Heart-energy-signature-spectrogram-for-cardiovascular-diagnosis-1475-925X-6-16-S5.ogg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Heart-energy-signature-spectrogram-for-cardiovascular-diagnosis-1475-925X-6-16-S5.ogg',
    author: 'Kudriavtsev, Polyshchuk & Roy',
    license: 'CC BY 2.0',
    description: 'Published simulated mitral-valve-prolapse sound track with three clicks; not a patient recording.',
    clinicalUse: ['heart'],
    preferredHotspots: ['heart-mitral']
  },
  wheeze: {
    id: 'wheeze',
    label: 'Wheeze',
    kind: 'recording',
    url: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Wheeze2O.ogg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Wheeze2O.ogg',
    author: 'James Heilman, MD',
    license: 'CC BY-SA 3.0',
    description: 'Recorded wheezing respirations.',
    clinicalUse: ['lungs'],
    preferredHotspots: ['lung-front-r-upper', 'lung-front-l-upper', 'lung-front-r-mid', 'lung-front-l-mid', 'lung-front-r-lower', 'lung-front-l-lower', 'lung-back-r-upper', 'lung-back-l-upper', 'lung-back-r-mid', 'lung-back-l-mid', 'lung-back-r-base', 'lung-back-l-base']
  },
  crackles: {
    id: 'crackles',
    label: 'Crackles',
    kind: 'recording',
    url: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Crackles_pneumoniaO.ogg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Crackles_pneumoniaO.ogg',
    author: 'James Heilman, MD',
    license: 'CC BY-SA 3.0',
    description: 'Recorded pulmonary crackles in pneumonia through a stethoscope.',
    clinicalUse: ['lungs'],
    preferredHotspots: ['lung-front-r-upper', 'lung-front-l-upper', 'lung-front-r-mid', 'lung-front-l-mid', 'lung-front-r-lower', 'lung-front-l-lower', 'lung-back-r-upper', 'lung-back-l-upper', 'lung-back-r-mid', 'lung-back-l-mid', 'lung-back-r-base', 'lung-back-l-base']
  },
  stridor: {
    id: 'stridor',
    label: 'Inspiratory and expiratory stridor',
    kind: 'recording',
    url: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Stridor_NP_OGG_2.ogg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Stridor_NP_OGG_2.ogg',
    author: 'James Heilman, MD / processed by Natural Philo',
    license: 'CC BY-SA 3.0',
    description: 'Processed recording of inspiratory and expiratory stridor.',
    clinicalUse: ['airway'],
    preferredHotspots: ['front-trachea']
  },
  carotid_bruit: {
    id: 'carotid_bruit',
    label: 'Carotid bruit',
    kind: 'recording',
    url: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/MurmurO.ogg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:MurmurO.ogg',
    author: 'James Heilman, MD',
    license: 'CC BY-SA 3.0',
    description: 'Recorded carotid bruit in a patient with carotid stenosis.',
    clinicalUse: ['carotid'],
    preferredHotspots: ['front-carotid-right', 'front-carotid-left']
  },
  bowel_obstruction: {
    id: 'bowel_obstruction',
    label: 'Tinkling bowel sounds',
    kind: 'recording',
    url: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/SBOOgg.ogg',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:SBOOgg.ogg',
    author: 'James Heilman, MD',
    license: 'CC BY-SA 3.0',
    description: 'Recorded tinkling bowel sounds in small bowel obstruction.',
    clinicalUse: ['abdomen'],
    preferredHotspots: ['abdomen-ruq', 'abdomen-luq', 'abdomen-rlq', 'abdomen-llq']
  },
  normal_vesicular: {
    id: 'normal_vesicular',
    label: 'Normal vesicular breath sound',
    kind: 'synth-breath',
    description: 'Educational simulation of a soft vesicular breath sound. This is not a patient recording.',
    clinicalUse: ['lungs'],
    preferredHotspots: ['lung-front-r-upper', 'lung-front-l-upper', 'lung-front-r-mid', 'lung-front-l-mid', 'lung-front-r-lower', 'lung-front-l-lower', 'lung-back-r-upper', 'lung-back-l-upper', 'lung-back-r-mid', 'lung-back-l-mid', 'lung-back-r-base', 'lung-back-l-base']
  },
  normal_bowel: {
    id: 'normal_bowel',
    label: 'Normal bowel activity',
    kind: 'synth-bowel',
    description: 'Educational simulation of intermittent normal bowel sounds. This is not a patient recording.',
    clinicalUse: ['abdomen'],
    preferredHotspots: ['abdomen-ruq', 'abdomen-luq', 'abdomen-rlq', 'abdomen-llq']
  },
  percussion_resonant: {
    id: 'percussion_resonant',
    label: 'Resonant percussion note',
    kind: 'synth-percussion',
    percussionProfile: 'resonant',
    description: 'Educationally synthesized resonant note for normal aerated lung. This is not a clinical recording.',
    clinicalUse: ['percussion']
  },
  percussion_dull: {
    id: 'percussion_dull',
    label: 'Dull percussion note',
    kind: 'synth-percussion',
    percussionProfile: 'dull',
    description: 'Educationally synthesized dull note for solid tissue such as liver. This is not a clinical recording.',
    clinicalUse: ['percussion']
  },
  percussion_tympanic: {
    id: 'percussion_tympanic',
    label: 'Tympanic percussion note',
    kind: 'synth-percussion',
    percussionProfile: 'tympanic',
    description: 'Educationally synthesized tympanic note for gas-filled abdominal structures. This is not a clinical recording.',
    clinicalUse: ['percussion']
  },
  percussion_flat: {
    id: 'percussion_flat',
    label: 'Flat percussion note',
    kind: 'synth-percussion',
    percussionProfile: 'flat',
    description: 'Educationally synthesized flat note over dense tissue. This is not a clinical recording.',
    clinicalUse: ['percussion']
  }
};

export function getExamSound(soundId) {
  return EXAM_SOUND_LIBRARY[soundId] || null;
}

export function listRecordedExamSounds() {
  return Object.values(EXAM_SOUND_LIBRARY).filter((item) => item.kind === 'recording');
}
