export const dyspneaCOPD = {
  id: 'dyspneaCOPD',
  title: 'Dyspnea',
  visibleLabel: '69-year-old man with worsening breathlessness and cough',
  hiddenDiagnosis: 'Acute exacerbation of COPD, likely infective',
  caseType: 'copdExacerbation',

  identity: {
    name: 'Milan Kral',
    age: 69,
    sex: 'Male',
    occupation: 'Retired mechanic',
    livingSituation: 'Lives with his daughter in a ground-floor house.'
  },

  chiefComplaint: {
    patientWords: 'I cannot catch my breath like usual, and my cough has been worse.',
    shortAnswer: 'I came because my breathing has become much worse.',
    spontaneousDetails: [
      'I have COPD.',
      'My cough is worse.',
      'The phlegm has turned yellow-green.'
    ]
  },

  hpi: {
    mainSymptom: 'Shortness of breath',
    site: 'It is not pain in one spot; it is my breathing and tightness in the chest.',
    onset: 'The breathlessness worsened over the last two days.',
    circumstances: 'It started after several days of a cold and more coughing.',
    character: 'It feels like I cannot get enough air out, and my chest whistles.',
    radiation: 'No pain spreading anywhere.',
    associatedSymptoms: 'More cough, more phlegm, wheezing, tiredness, and a low fever.',
    timing: 'It is there most of the day and is worse when I walk or lie flat.',
    exacerbatingFactors: ['Walking to the bathroom makes it worse.', 'Cold air and coughing make it worse.'],
    relievingFactors: ['My rescue inhaler helps for a short time.', 'Sitting upright helps.'],
    severity: 'Today I can only speak in short sentences when it is bad. Compared with usual, it is severe.',
    course: 'It has been getting worse despite using my inhalers more often.'
  },

  symptoms: {
    fever: 'I had a temperature around 37.9 C and chills yesterday.',
    nauseaVomiting: 'No nausea or vomiting.',
    dyspnea: 'Yes, I am much more short of breath than usual, even at rest sometimes.',
    cough: 'My cough is worse than usual.',
    sputum: 'I am bringing up more phlegm than usual.',
    sputumColor: 'The phlegm is yellow-green now. It is normally clearer.',
    hemoptysis: 'No blood in the phlegm.',
    palpitations: 'My heart beats fast when I am struggling to breathe.',
    syncope: 'I have not fainted.',
    edema: 'My ankles are a bit swollen, but that happens sometimes.',
    weightLoss: 'No recent weight loss.',
    appetite: 'I have eaten less for two days because breathing is hard.',
    bowelSymptoms: 'No diarrhea or constipation.',
    urinarySymptoms: 'No urinary burning or blood.',
    sweating: 'I sweat when breathing gets difficult.',
    chestPain: 'No crushing chest pain. My chest feels tight from breathing.',
    wheezing: 'Yes, I can hear wheezing, especially when I breathe out.',
    severeDyspnea: 'At worst I can only say a few words before stopping for breath.',
    cyanosis: 'My daughter said my lips looked a bit bluish this morning.',
    confusion: 'I felt drowsy and not quite myself this morning, but I am clearer now.'
  },

  ros: {
    general: 'Low fever, tiredness, and reduced appetite. No major weight loss.',
    cardiovascular: 'No crushing chest pain or fainting. Fast heartbeat with breathlessness. Mild ankle swelling.',
    respiratory: 'Worsening shortness of breath, cough, wheeze, and yellow-green phlegm. No blood in sputum.',
    gastrointestinal: 'Reduced appetite. No vomiting, diarrhea, abdominal pain, or black stool.',
    genitourinary: 'No urinary symptoms.',
    neurological: 'No weakness or seizures. Some drowsiness this morning.',
    musculoskeletal: 'No new joint or muscle pain.',
    skin: 'No rash. Lips looked a little blue according to my daughter.'
  },

  pastMedicalHistory: {
    summary: 'I have COPD, high blood pressure, and reflux.',
    cardiac: 'No known heart attack or stents.',
    cardiovascularRisk: 'High blood pressure and a long smoking history.',
    respiratory: 'I was told I have COPD about eight years ago. I had two flare-ups last year.',
    other: 'Reflux disease. No diabetes.'
  },

  operationsHospitalizations: {
    operations: 'I had hernia surgery many years ago.',
    hospitalizations: 'I was admitted twice for breathing flare-ups, once last winter and once three years ago. No ICU.',
    details: [
      {
        procedure: 'hernia repair',
        approximateDate: 'many years ago',
        exactDateKnown: false,
        approach: 'unknown',
        complications: 'none known'
      }
    ]
  },

  medication: [
    'Ramipril 5 mg once daily.',
    'Omeprazole 20 mg daily.',
    'A blue rescue inhaler and a daily inhaler, but I do not remember all the names.'
  ],
  medicationInhalers: 'I use salbutamol as needed and a tiotropium inhaler daily. I may miss the daily inhaler sometimes.',
  oxygenUse: 'I do not use oxygen at home.',
  allergies: ['Penicillin caused a swollen rash years ago.'],
  transfusions: {
    summary: 'No blood transfusions.'
  },
  gynecologicalHistory: {
    summary: 'That does not apply to me.',
    pregnancyPossibility: 'That does not apply to me.'
  },
  familyHistory: {
    summary: 'My father had chronic bronchitis and smoked. My mother had a stroke.'
  },
  epidemiology: {
    travel: 'No recent travel.',
    animals: 'No pets or farm animals.',
    vaccination: 'I had two COVID vaccines, but I skipped the flu shot this year.'
  },
  socialHistory: {
    living: 'I live with my daughter, who helps with shopping. I usually manage washing and dressing.',
    function: 'Normally I can walk around the house, but today I get breathless crossing the room.'
  },
  substanceUse: {
    smoking: 'I smoked one pack a day for about 45 years. I still smoke five cigarettes on some days.',
    alcohol: 'I drink a small beer a few evenings a week.',
    recreationalDrugs: 'No recreational drugs.'
  },

  redFlags: [
    { id: 'copd_severe_dyspnea', label: 'Severe dyspnea or inability to speak full sentences', triggerIntents: ['severe_dyspnea', 'dyspnea'] },
    { id: 'copd_cyanosis', label: 'Cyanosis', triggerIntents: ['cyanosis'] },
    { id: 'copd_confusion', label: 'Confusion or drowsiness', triggerIntents: ['confusion'] },
    { id: 'copd_fever', label: 'Fever or infective symptoms', triggerIntents: ['fever', 'sputum_color'] },
    { id: 'copd_hemoptysis_chestpain', label: 'Hemoptysis or concerning chest pain', triggerIntents: ['hemoptysis', 'chest_pain'] }
  ],

  requiredChecklist: [
    'chief_complaint',
    'pain_onset',
    'dyspnea',
    'cough',
    'sputum',
    'sputum_color',
    'fever',
    'chest_pain',
    'wheezing',
    'smoking',
    'known_copd_asthma',
    'inhaler_medication',
    'hospitalizations',
    'oxygen_use',
    'allergies'
  ],
  optionalChecklist: [
    'introduction',
    'open_history',
    'pain_circumstances',
    'pain_exacerbating',
    'pain_relieving',
    'pain_severity',
    'hemoptysis',
    'severe_dyspnea',
    'cyanosis',
    'confusion',
    'palpitations',
    'edema',
    'medication',
    'family_history',
    'alcohol',
    'recreational_drugs',
    'vaccination',
    'living_situation'
  ],

  differentialWeights: {
    initial: {
      copdExacerbation: 0.62,
      pneumonia: 0.14,
      heartFailure: 0.1,
      pulmonaryEmbolism: 0.07,
      ACS: 0.04,
      asthma: 0.03
    },
    evidence: [
      { intents: ['sputum_color', 'fever'], adjust: { copdExacerbation: 0.08, pneumonia: 0.08 } },
      { intents: ['wheezing', 'known_copd_asthma'], adjust: { copdExacerbation: 0.15, asthma: 0.03 } },
      { intents: ['hemoptysis'], adjust: { pulmonaryEmbolism: 0.12, pneumonia: 0.04 } },
      { intents: ['edema'], adjust: { heartFailure: 0.08 } },
      { intents: ['chest_pain'], adjust: { ACS: 0.05, pulmonaryEmbolism: 0.02 } }
    ]
  },

  personality: {
    talkativeness: 0.38,
    anxiety: 0.7,
    guardedness: 0.35,
    healthLiteracy: 0.42,
    cooperativeness: 0.7,
    painTolerance: 0.65,
    emotionalTone: 'breathless'
  },

  reliability: {
    timeRecall: 0.72,
    medicationRecall: 0.45,
    symptomDescription: 0.75,
    substanceUseHonesty: 0.55
  },

  disclosureRules: {
    spontaneousDisclosureLevel: 1,
    sensitiveTopicsRequireRapport: true,
    alcoholRequiresFollowUp: true,
    drugsRequireDirectQuestion: true
  },

  teachingObjectives: [
    'Assess severity of dyspnea and signs of respiratory failure.',
    'Ask cough, sputum volume, sputum color, fever, and hemoptysis.',
    'Review inhaler use, previous admissions, oxygen use, and smoking history.'
  ]
};
