export const medicalDomains = {
  communication: {
    label: 'Communication',
    intents: ['introduction', 'open_history']
  },
  chiefComplaint: {
    label: 'Chief complaint',
    intents: ['chief_complaint']
  },
  hpi: {
    label: 'HPI / SOCRATES',
    intents: [
      'pain_site',
      'pain_onset',
      'pain_circumstances',
      'pain_character',
      'pain_radiation',
      'migration',
      'pain_associated_symptoms',
      'pain_timing',
      'pain_exacerbating',
      'pain_relieving',
      'pain_severity',
      'pain_course'
    ]
  },
  symptoms: {
    label: 'Review of systems',
    intents: [
      'fever',
      'nausea_vomiting',
      'dyspnea',
      'cough',
      'sputum',
      'sputum_color',
      'hemoptysis',
      'palpitations',
      'syncope',
      'edema',
      'sweating',
      'wheezing',
      'severe_dyspnea',
      'cyanosis',
      'confusion',
      'chest_pain',
      'weight_loss',
      'appetite',
      'bowel_symptoms',
      'urinary_symptoms',
      'review_of_systems_general'
    ]
  },
  pastMedicalHistory: {
    label: 'Past medical history',
    intents: ['past_medical_history', 'past_cardiac_history', 'cardiovascular_risk_factors', 'known_copd_asthma', 'operations', 'hospitalizations']
  },
  medication: {
    label: 'Medication',
    intents: ['medication', 'inhaler_medication', 'oxygen_use']
  },
  allergies: {
    label: 'Allergies and transfusions',
    intents: ['allergies', 'transfusions']
  },
  familyHistory: {
    label: 'Family history',
    intents: ['family_history']
  },
  socialHistory: {
    label: 'Social history',
    intents: ['occupation', 'living_situation', 'smoking', 'alcohol', 'recreational_drugs']
  },
  epidemiology: {
    label: 'Epidemiology',
    intents: ['travel', 'animal_exposure', 'vaccination']
  },
  gynecology: {
    label: 'Gynecological history',
    intents: ['gynecological_history', 'pregnancy_possibility']
  },
  redFlags: {
    label: 'Red flags',
    intents: ['sweating', 'severe_dyspnea', 'cyanosis', 'confusion', 'wheezing', 'sputum_color', 'chest_pain']
  }
};

export const osceCategories = [
  { id: 'communication', label: 'Introduction / communication', weight: 8, intents: ['introduction', 'open_history'] },
  { id: 'chiefComplaint', label: 'Chief complaint', weight: 8, intents: ['chief_complaint'] },
  { id: 'hpi', label: 'HPI / SOCRATES', weight: 22, domain: 'hpi' },
  { id: 'ros', label: 'Review of systems', weight: 12, domain: 'symptoms' },
  { id: 'pmh', label: 'Past medical history', weight: 10, domain: 'pastMedicalHistory' },
  { id: 'medication', label: 'Medication', weight: 8, domain: 'medication' },
  { id: 'allergies', label: 'Allergies', weight: 6, intents: ['allergies'] },
  { id: 'family', label: 'Family history', weight: 6, intents: ['family_history'] },
  { id: 'social', label: 'Social history', weight: 8, domain: 'socialHistory' },
  { id: 'redFlags', label: 'Red flags', weight: 10, redFlags: true },
  { id: 'structure', label: 'Structure', weight: 2, structure: true }
];

export function domainForIntent(intentId) {
  const entry = Object.entries(medicalDomains).find(([, domain]) => domain.intents.includes(intentId));
  return entry?.[0] ?? 'other';
}
