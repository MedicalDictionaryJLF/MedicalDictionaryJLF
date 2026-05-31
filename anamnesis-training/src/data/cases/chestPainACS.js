export const chestPainACS = {
  id: 'chestPainACS',
  title: 'Chest Pain',
  visibleLabel: '58-year-old man with acute chest pressure',
  hiddenDiagnosis: 'Acute coronary syndrome, likely NSTEMI or unstable angina',
  caseType: 'chestPainACS',

  identity: {
    name: 'Peter Novak',
    age: 58,
    sex: 'Male',
    occupation: 'Bus driver',
    livingSituation: 'Lives with his wife in a third-floor apartment with an elevator.'
  },

  ecg: {
    available: true,
    label: '12-lead ECG - Peter Novak',
    imagePath: '/ECGs/peter_novak_ecg.png',
    interpretation: 'Inferior STEMI with reciprocal aVL depression'
  },

  chiefComplaint: {
    patientWords: 'I have this heavy pressure in my chest and it really scared me.',
    shortAnswer: 'I came because of pressure-like chest pain.',
    spontaneousDetails: [
      'It is in the middle of my chest.',
      'It started while I was walking.',
      'I felt sweaty and short of breath.'
    ]
  },

  hpi: {
    mainSymptom: 'Chest pain',
    site: 'It is mainly in the middle of my chest, behind the breastbone.',
    onset: 'It started about two hours before I came to hospital.',
    circumstances: 'I was walking from the parking lot toward work when it started.',
    character: 'It feels like a heavy pressure or tightness, not like a stabbing pain.',
    radiation: 'Yes, it spreads to my left arm and a bit up to my jaw.',
    associatedSymptoms: 'I felt short of breath, sweaty, and nauseous. I did not vomit.',
    timing: 'The worst spell lasted about 30 minutes. It eased with rest but keeps coming back.',
    exacerbatingFactors: ['Walking and climbing stairs make it worse.', 'Stress seems to make me notice it more.'],
    relievingFactors: ['Rest helps a little.', 'I have not tried nitroglycerin.'],
    severity: 'At worst it was 8 out of 10. Right now it is around 4 out of 10.',
    course: 'It improved after resting, but it has not gone away completely.'
  },

  symptoms: {
    fever: 'No fever or chills.',
    nauseaVomiting: 'I felt nauseous with the chest pressure, but I did not vomit.',
    dyspnea: 'Yes, I felt short of breath when the chest pressure was strongest.',
    cough: 'No cough.',
    sputum: 'No phlegm.',
    sputumColor: 'I am not coughing anything up.',
    hemoptysis: 'No, I have not coughed up blood.',
    palpitations: 'My heart felt like it was racing for a few minutes.',
    syncope: 'I did not faint, but I felt a little light-headed.',
    edema: 'My ankles swell a little in the evenings after work.',
    weightLoss: 'No unexplained weight loss.',
    appetite: 'My appetite has been normal.',
    bowelSymptoms: 'No diarrhea, constipation, or blood in the stool.',
    urinarySymptoms: 'No burning or blood when I urinate.',
    sweating: 'Yes, I broke out in a cold sweat during the pain.',
    chestPain: 'Yes, the main problem is chest pressure.'
  },

  ros: {
    general: 'No fever, no weight loss, and no night sweats. I have felt more tired lately.',
    cardiovascular: 'Chest pressure with exertion, mild palpitations, and some evening ankle swelling.',
    respiratory: 'Shortness of breath came with the chest pressure. No cough, phlegm, or blood.',
    gastrointestinal: 'Nausea with the pain. No abdominal pain, diarrhea, constipation, or black stool.',
    genitourinary: 'No urinary burning, frequency, or blood.',
    neurological: 'No weakness, speech problems, seizures, or loss of consciousness.',
    musculoskeletal: 'No chest wall injury. I have chronic low back pain from sitting at work.',
    skin: 'No rash or wounds.'
  },

  pastMedicalHistory: {
    summary: 'I have high blood pressure and high cholesterol. No diabetes that I know of.',
    cardiac: 'I have never had a heart attack or stent. I was told once that my blood pressure and cholesterol put me at risk.',
    cardiovascularRisk: 'High blood pressure, high cholesterol, smoking, and my father had a heart attack.',
    respiratory: 'No COPD or asthma.',
    other: 'I had pneumonia years ago.'
  },

  operationsHospitalizations: {
    operations: 'My appendix was removed when I was young. No other surgeries.',
    hospitalizations: 'I was hospitalized once years ago for pneumonia.',
    details: [
      {
        procedure: 'appendectomy',
        approximateDate: 'when I was young, maybe in my teens',
        exactDateKnown: false,
        approach: 'unknown',
        complications: 'none known'
      }
    ]
  },

  medication: [
    'Ramipril 5 mg once daily.',
    'Atorvastatin 20 mg at night, though I sometimes forget it.',
    'Occasional ibuprofen for back pain.'
  ],
  medicationInhalers: 'I do not use inhalers.',
  oxygenUse: 'No oxygen at home.',
  allergies: ['No known drug allergies.'],
  transfusions: {
    summary: 'No previous blood transfusions.'
  },
  gynecologicalHistory: {
    summary: 'That does not apply to me.',
    pregnancyPossibility: 'That does not apply to me.'
  },
  familyHistory: {
    summary: 'My father died of a heart attack at 62. My mother has diabetes and high blood pressure.'
  },
  epidemiology: {
    travel: 'No recent travel.',
    animals: 'No pets or farm animal contact.',
    vaccination: 'I had two COVID vaccines. I do not remember my last flu shot.'
  },
  socialHistory: {
    living: 'I am married and live with my wife. I manage daily activities independently.',
    function: 'I can normally walk and work, but stairs have been harder today.'
  },
  substanceUse: {
    smoking: 'I smoke about 15 cigarettes a day and have smoked for around 35 years.',
    alcohol: 'I drink beer on weekends, usually two or three beers.',
    recreationalDrugs: 'No recreational drugs.'
  },

  redFlags: [
    { id: 'acs_radiation', label: 'Radiation to left arm or jaw', triggerIntents: ['pain_radiation'] },
    { id: 'acs_dyspnea_sweating', label: 'Dyspnea and sweating with chest pain', triggerIntents: ['dyspnea', 'sweating'] },
    { id: 'acs_syncope', label: 'Syncope or near-syncope', triggerIntents: ['syncope'] },
    { id: 'acs_severe_pain', label: 'Severe chest pain', triggerIntents: ['pain_severity'] },
    { id: 'acs_cardiac_history', label: 'Previous MI/CAD or major risk factors', triggerIntents: ['past_cardiac_history', 'cardiovascular_risk_factors'] }
  ],

  requiredChecklist: [
    'chief_complaint',
    'pain_site',
    'pain_onset',
    'pain_character',
    'pain_radiation',
    'pain_severity',
    'dyspnea',
    'sweating',
    'nausea_vomiting',
    'palpitations',
    'syncope',
    'cardiovascular_risk_factors',
    'past_cardiac_history',
    'medication',
    'allergies',
    'family_history',
    'smoking'
  ],
  optionalChecklist: [
    'introduction',
    'open_history',
    'pain_circumstances',
    'pain_timing',
    'pain_exacerbating',
    'pain_relieving',
    'pain_course',
    'edema',
    'cough',
    'hemoptysis',
    'alcohol',
    'recreational_drugs',
    'occupation',
    'living_situation',
    'transfusions'
  ],

  differentialWeights: {
    initial: {
      ACS: 0.55,
      pulmonaryEmbolism: 0.12,
      GERD: 0.1,
      pneumonia: 0.08,
      panicAttack: 0.05,
      aorticDissection: 0.1
    },
    evidence: [
      { intents: ['pain_radiation'], adjust: { ACS: 0.12, GERD: -0.04 } },
      { intents: ['sweating', 'nausea_vomiting'], adjust: { ACS: 0.1, panicAttack: -0.02 } },
      { intents: ['dyspnea'], adjust: { ACS: 0.05, pulmonaryEmbolism: 0.04 } },
      { intents: ['fever', 'cough'], adjust: { pneumonia: 0.12, ACS: -0.04 } },
      { intents: ['hemoptysis'], adjust: { pulmonaryEmbolism: 0.14, ACS: -0.03 } }
    ]
  },

  personality: {
    talkativeness: 0.52,
    anxiety: 0.78,
    guardedness: 0.25,
    healthLiteracy: 0.52,
    cooperativeness: 0.75,
    painTolerance: 0.55,
    emotionalTone: 'worried'
  },

  reliability: {
    timeRecall: 0.8,
    medicationRecall: 0.65,
    symptomDescription: 0.85,
    substanceUseHonesty: 0.7
  },

  disclosureRules: {
    spontaneousDisclosureLevel: 1,
    sensitiveTopicsRequireRapport: true,
    alcoholRequiresFollowUp: true,
    drugsRequireDirectQuestion: true
  },

  teachingObjectives: [
    'Use SOCRATES for chest pain.',
    'Screen ACS red flags and cardiovascular risk factors.',
    'Ask medication and allergies early because treatment decisions may depend on them.'
  ]
};
