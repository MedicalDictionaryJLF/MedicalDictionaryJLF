export const abdominalPainAppendicitis = {
  id: 'abdominalPainAppendicitis',
  title: 'Abdominal Pain',
  visibleLabel: '24-year-old woman with worsening right lower abdominal pain',
  hiddenDiagnosis: 'Acute appendicitis',
  caseType: 'appendicitis',

  identity: {
    name: 'Lucia Horvathova',
    age: 24,
    sex: 'Female',
    occupation: 'University student and part-time cafe worker',
    livingSituation: 'Lives with two roommates in a rented flat.'
  },

  chiefComplaint: {
    patientWords: 'My stomach pain started near the middle and now it hurts badly on the lower right side.',
    shortAnswer: 'I came because of abdominal pain.',
    spontaneousDetails: [
      'It started around my belly button.',
      'It moved to the lower right side.',
      'I feel nauseous and I do not want to eat.'
    ]
  },

  hpi: {
    mainSymptom: 'Abdominal pain',
    site: 'It is now in the lower right side of my abdomen.',
    onset: 'It started yesterday afternoon, around 18 hours ago.',
    circumstances: 'It began while I was studying at home. There was no injury.',
    character: 'At first it was a dull stomach ache, now it is sharper and constant.',
    radiation: 'It does not really spread to my back or shoulder.',
    migration: 'It started around my belly button and then moved to the right lower abdomen.',
    associatedSymptoms: 'I feel nauseous, I vomited once, and I have not wanted to eat.',
    timing: 'It has become constant over the last several hours.',
    exacerbatingFactors: ['Walking, coughing, and bumps in the car make it worse.', 'Pressing on the area hurts.'],
    relievingFactors: ['Lying still with my knees bent helps a little.', 'Painkillers did not help much.'],
    severity: 'It is about 7 out of 10 now.',
    course: 'It is getting worse compared with yesterday.'
  },

  symptoms: {
    fever: 'I felt feverish and had chills. At home the temperature was 38.1 C.',
    nauseaVomiting: 'I feel nauseous and vomited once this morning.',
    dyspnea: 'No shortness of breath.',
    cough: 'No cough.',
    sputum: 'No phlegm.',
    sputumColor: 'No phlegm.',
    hemoptysis: 'No coughing blood.',
    palpitations: 'No palpitations.',
    syncope: 'I have not fainted.',
    edema: 'No leg swelling.',
    weightLoss: 'No weight loss.',
    appetite: 'I have no appetite since the pain started.',
    bowelSymptoms: 'No diarrhea. I passed a small stool yesterday. No blood in stool.',
    urinarySymptoms: 'No burning, frequency, or blood in urine.',
    sweating: 'I sweat when the pain gets bad.',
    chestPain: 'No chest pain.',
    wheezing: 'No wheezing.',
    severeDyspnea: 'No severe breathlessness.',
    cyanosis: 'No blue lips or fingers.',
    confusion: 'I am not confused.'
  },

  ros: {
    general: 'Feverish with chills and reduced appetite. No weight loss or night sweats.',
    cardiovascular: 'No chest pain, palpitations, fainting, or leg swelling.',
    respiratory: 'No cough, phlegm, wheeze, or shortness of breath.',
    gastrointestinal: 'Right lower abdominal pain, nausea, one vomit, and no appetite. No diarrhea or blood in stool.',
    genitourinary: 'No urinary burning, frequency, flank pain, or blood.',
    neurological: 'No headache, weakness, numbness, seizures, or loss of consciousness.',
    musculoskeletal: 'No joint pains. Walking worsens the abdominal pain.',
    skin: 'No rash or jaundice.'
  },

  pastMedicalHistory: {
    summary: 'I am generally healthy. No chronic diseases.',
    cardiac: 'No heart disease.',
    cardiovascularRisk: 'No known high blood pressure, diabetes, or high cholesterol.',
    respiratory: 'No asthma or COPD.',
    other: 'I had iron deficiency last year but it improved.'
  },

  operationsHospitalizations: {
    operations: 'No previous operations, including no abdominal surgery.',
    hospitalizations: 'Only a short hospital visit for dehydration as a child.',
    details: []
  },

  medication: [
    'No regular prescription medication.',
    'I took paracetamol today, but it helped only a little.',
    'I take no supplements.'
  ],
  medicationInhalers: 'I do not use inhalers.',
  oxygenUse: 'No oxygen at home.',
  allergies: ['No known drug allergies.'],
  transfusions: {
    summary: 'No blood transfusions.'
  },
  gynecologicalHistory: {
    summary: 'My periods are usually regular. Last period started about two weeks ago. No abnormal vaginal bleeding or discharge.',
    pregnancyPossibility: 'Pregnancy is unlikely. I use condoms, but I have not taken a test today.'
  },
  familyHistory: {
    summary: 'No inflammatory bowel disease in the family. My father has high blood pressure.'
  },
  epidemiology: {
    travel: 'No recent travel.',
    animals: 'No farm animals. My roommate has a cat.',
    vaccination: 'Routine childhood vaccinations. I am not sure about the flu vaccine.'
  },
  socialHistory: {
    living: 'I live with two roommates and can look after myself normally.',
    function: 'I am normally independent, but today walking is painful.'
  },
  substanceUse: {
    smoking: 'I do not smoke.',
    alcohol: 'I drink socially, maybe one or two drinks on some weekends.',
    recreationalDrugs: 'No recreational drugs.'
  },

  redFlags: [
    { id: 'appendix_fever', label: 'Fever with abdominal pain', triggerIntents: ['fever'] },
    { id: 'appendix_vomiting', label: 'Vomiting with worsening abdominal pain', triggerIntents: ['nausea_vomiting'] },
    { id: 'appendix_migration', label: 'Pain migration to right lower quadrant', triggerIntents: ['migration', 'pain_site'] },
    { id: 'appendix_peritoneal', label: 'Pain worse with walking, coughing, or movement', triggerIntents: ['pain_exacerbating'] },
    { id: 'appendix_pregnancy', label: 'Pregnancy possibility assessed', triggerIntents: ['pregnancy_possibility', 'gynecological_history'] }
  ],

  requiredChecklist: [
    'chief_complaint',
    'pain_site',
    'pain_onset',
    'migration',
    'pain_character',
    'pain_severity',
    'fever',
    'nausea_vomiting',
    'appetite',
    'bowel_symptoms',
    'urinary_symptoms',
    'gynecological_history',
    'pregnancy_possibility',
    'operations',
    'medication',
    'allergies'
  ],
  optionalChecklist: [
    'introduction',
    'open_history',
    'pain_circumstances',
    'pain_radiation',
    'pain_associated_symptoms',
    'pain_timing',
    'pain_exacerbating',
    'pain_relieving',
    'pain_course',
    'past_medical_history',
    'family_history',
    'smoking',
    'alcohol',
    'recreational_drugs',
    'travel',
    'animal_exposure'
  ],

  differentialWeights: {
    initial: {
      appendicitis: 0.58,
      gastroenteritis: 0.12,
      ovarianTorsion: 0.1,
      ectopicPregnancy: 0.08,
      urinaryTractInfection: 0.07,
      renalColic: 0.05
    },
    evidence: [
      { intents: ['migration', 'pain_site'], adjust: { appendicitis: 0.15, gastroenteritis: -0.04 } },
      { intents: ['fever', 'nausea_vomiting'], adjust: { appendicitis: 0.09, gastroenteritis: 0.03 } },
      { intents: ['urinary_symptoms'], adjust: { urinaryTractInfection: -0.05, renalColic: -0.03 } },
      { intents: ['pregnancy_possibility'], adjust: { ectopicPregnancy: -0.02 } },
      { intents: ['gynecological_history'], adjust: { ovarianTorsion: -0.02 } }
    ]
  },

  personality: {
    talkativeness: 0.58,
    anxiety: 0.62,
    guardedness: 0.42,
    healthLiteracy: 0.55,
    cooperativeness: 0.8,
    painTolerance: 0.45,
    emotionalTone: 'uncomfortable'
  },

  reliability: {
    timeRecall: 0.75,
    medicationRecall: 0.8,
    symptomDescription: 0.82,
    substanceUseHonesty: 0.75
  },

  disclosureRules: {
    spontaneousDisclosureLevel: 1,
    sensitiveTopicsRequireRapport: true,
    alcoholRequiresFollowUp: true,
    drugsRequireDirectQuestion: true
  },

  teachingObjectives: [
    'Elicit migration of abdominal pain and peritoneal features.',
    'Differentiate gastrointestinal, urinary, and gynecological causes.',
    'Assess pregnancy possibility in reproductive-age patients with abdominal pain.'
  ]
};
