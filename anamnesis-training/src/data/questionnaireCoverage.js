export const questionnaireCoverage = [
  {
    id: 'identification',
    label: 'Identification',
    intents: ['identity_name', 'identity_age', 'identity_dob', 'identity_sex', 'identity_residence', 'identity_address', 'administrative_admission_time', 'administrative_arrival_mode']
  },
  {
    id: 'chiefComplaint',
    label: 'Chief complaint',
    intents: ['chief_complaint', 'open_history']
  },
  {
    id: 'hpi',
    label: 'SOCRATES / HPI',
    intents: ['hpi_site', 'pain_site', 'hpi_onset', 'pain_onset', 'hpi_circumstances', 'pain_circumstances', 'hpi_character', 'pain_character', 'hpi_radiation', 'pain_radiation', 'migration', 'hpi_associated_symptoms', 'pain_associated_symptoms', 'hpi_timing', 'pain_timing', 'hpi_exacerbating', 'pain_exacerbating', 'hpi_relieving', 'pain_relieving', 'hpi_severity', 'pain_severity', 'hpi_course', 'pain_course']
  },
  {
    id: 'ros',
    label: 'Review of systems',
    intents: ['fever', 'weight_loss', 'fatigue', 'night_sweats', 'headache', 'dizziness', 'visual_problems', 'speech_problems', 'sore_throat', 'chest_pain', 'palpitations', 'dyspnea', 'cough', 'sputum', 'hemoptysis', 'dysphagia', 'nausea_vomiting', 'abdominal_pain', 'diarrhea', 'constipation', 'blood_in_stool', 'bowel_symptoms', 'dysuria', 'urinary_frequency', 'nocturia', 'incontinence', 'urinary_symptoms']
  },
  {
    id: 'pmh',
    label: 'Past medical history',
    intents: ['past_medical_history', 'pmh_chronic_diseases', 'pmh_hypertension', 'pmh_diabetes', 'pmh_dyslipidemia', 'pmh_ischemic_heart_disease', 'past_cardiac_history', 'pmh_heart_failure', 'pmh_kidney_disease', 'pmh_lung_disease', 'known_copd_asthma', 'pmh_thyroid', 'pmh_liver_disease']
  },
  {
    id: 'specialistCare',
    label: 'Specialist care',
    intents: ['specialist_care']
  },
  {
    id: 'operations',
    label: 'Operations / hospitalizations',
    intents: ['operations', 'hospitalizations', 'planned_operation', 'previous_examinations', 'previous_ecg', 'previous_blood_tests', 'previous_ultrasound', 'previous_ct', 'previous_mri']
  },
  {
    id: 'allergies',
    label: 'Allergies / transfusions',
    intents: ['allergies', 'allergy_reaction', 'transfusions']
  },
  {
    id: 'medication',
    label: 'Medication',
    intents: ['medication', 'medication_regular', 'inhaler_medication', 'oxygen_use', 'medication_dose', 'medication_frequency', 'medication_indication', 'medication_otc', 'medication_supplements']
  },
  {
    id: 'gynecology',
    label: 'Gynecological history',
    femaleOnly: true,
    intents: ['gynecological_history', 'gyn_menstruation', 'gyn_lmp', 'gyn_menopause', 'gyn_contraception', 'pregnancy_possibility', 'gyn_pregnancy', 'gyn_children', 'gyn_deliveries', 'gyn_c_section', 'gyn_miscarriage', 'gyn_pelvic_pain']
  },
  {
    id: 'family',
    label: 'Family history',
    intents: ['family_history', 'family_parents', 'family_mother', 'family_father', 'family_cardiovascular', 'family_stroke', 'family_diabetes', 'family_cancer', 'family_genetic']
  },
  {
    id: 'epidemiology',
    label: 'Epidemiology',
    intents: ['travel', 'epidemiology_travel', 'animal_exposure', 'epidemiology_animals', 'vaccination', 'epidemiology_covid_vaccination', 'epidemiology_covid_infection', 'epidemiology_contact', 'epidemiology_tick']
  },
  {
    id: 'social',
    label: 'Social history',
    intents: ['occupation', 'living_situation', 'social_employment', 'social_occupation', 'social_marital_status', 'social_living_situation', 'social_housing', 'social_housing_floor', 'social_housing_elevator']
  },
  {
    id: 'substances',
    label: 'Substance use',
    intents: ['smoking', 'substance_smoking', 'substance_smoking_pack_years', 'alcohol', 'substance_alcohol', 'substance_coffee', 'substance_black_tea', 'substance_caffeine', 'recreational_drugs', 'substance_drugs']
  },
  {
    id: 'generalExam',
    label: 'General examination',
    intents: ['exam_consciousness', 'exam_orientation', 'exam_general_appearance', 'exam_hydration', 'exam_nutrition', 'exam_gait', 'exam_speech', 'exam_skin', 'exam_edema']
  },
  {
    id: 'vitals',
    label: 'Vital signs',
    intents: ['vital_temperature', 'vital_spo2', 'vital_hr', 'vital_rr', 'vital_bp', 'vital_weight', 'vital_height', 'vital_bmi']
  },
  {
    id: 'localExam',
    label: 'Local examination',
    intents: ['exam_lymph_nodes', 'exam_thyroid', 'exam_jvp', 'exam_carotids', 'exam_lungs', 'exam_crackles', 'exam_wheezing', 'exam_heart_sounds', 'exam_murmur', 'exam_rhythm', 'exam_abdomen', 'exam_palpation', 'exam_guarding', 'exam_bowel_sounds', 'exam_blumberg', 'exam_murphy', 'exam_mcburney', 'exam_rovsing', 'exam_tapotement', 'exam_pulses', 'exam_capillary_refill', 'exam_spine']
  },
  {
    id: 'labs',
    label: 'Labs',
    intents: ['lab_hb', 'lab_rbc', 'lab_hct', 'lab_wbc', 'lab_platelets', 'lab_crp', 'lab_creatinine', 'lab_urea', 'lab_sodium', 'lab_potassium', 'lab_chloride', 'lab_calcium', 'lab_alt', 'lab_ast', 'lab_bilirubin', 'lab_glucose', 'lab_cholesterol', 'lab_ldl', 'lab_hdl', 'lab_triglycerides', 'lab_tsh']
  }
];
