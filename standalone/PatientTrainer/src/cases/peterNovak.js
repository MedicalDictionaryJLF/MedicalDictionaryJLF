export const peterNovak = {
  "id": "chest_pain_acs_risk",
  "title": "Acute chest discomfort",
  "difficulty": "Intermediate",
  "patientCard": "58-year-old man, anxious, sitting upright, complaining of chest discomfort.",
  "stationBrief": {
    "location": "Emergency Department acute assessment bay",
    "time": "09:20 simulated hospital time",
    "task": "Assess a patient with ongoing chest discomfort. Take a focused history, identify immediately important risks and red flags, perform a targeted examination, choose investigations, form a differential, and hand over your plan."
  },
  "openingLine": "I have this heavy pressure in my chest and it really scared me.",
  "ecg": {
    "available": true,
    "label": "12-lead ECG · Peter Novak",
    "imagePath": new URL('../../ECGs/peter_novak_ecg.png', import.meta.url).href,
    "interpretation": "ST-segment elevation in the inferior leads with reciprocal change in aVL, compatible with an acute inferior STEMI."
  },
  "administrative": {
    "admissionTime": "today around 9 AM",
    "arrivalMethod": "My wife drove me here. I did not come by ambulance.",
    "arrivalMode": "My wife drove me here. I did not come by ambulance."
  },
  "personality": {
    "baselineRapport": 68,
    "talkativeness": 0.48,
    "anxiety": 0.75,
    "healthLiteracy": 0.45,
    "guardedness": 0.25
  },
  "identity": {
    "name": "Peter Novak",
    "age": 58,
    "dob": "14 March 1968",
    "sex": "male",
    "residence": "Martin",
    "occupation": "a bus driver"
  },
  "chiefComplaint": "I came because of pressure-like chest pain. I was frightened enough to come in.",
  "hpi": {
    "site": "It is mainly in the middle of my chest, behind the breastbone.",
    "onset": "It started about two hours before I came to hospital.",
    "activityAtOnset": "I was walking from the parking lot toward work when it started.",
    "character": "It feels like a heavy pressure or tightness, not like a stabbing pain.",
    "radiation": "Yes, it spreads to my left arm and a bit up to my jaw.",
    "associatedSymptoms": "I felt short of breath, sweaty, and nauseous. I did not vomit.",
    "timing": "The worst spell lasted about 30 minutes. It eased with rest but keeps coming back.",
    "exacerbating": "Walking and climbing stairs make it worse.",
    "relieving": "Rest helped a little. I have not tried nitroglycerin.",
    "severity": "At worst it was 8 out of 10. Right now it is around 4 out of 10.",
    "course": "It improved after resting but has not disappeared completely."
  },
  "ros": {
    "general": "No fever, no weight loss, and no night sweats. I have felt more tired lately.",
    "headNeck": "No headache, no visual problems, and my hearing is okay. I felt slightly dizzy during the pain.",
    "cardiovascular": "I had chest pressure, shortness of breath with exertion, and occasional palpitations. No fainting.",
    "respiratory": "No cough, no sputum, and I have not coughed up blood. The shortness of breath came with the chest pressure.",
    "gastrointestinal": "Mild nausea with the pain. No abdominal pain, diarrhea, constipation, black stool, or blood in stool.",
    "genitourinary": "No problems passing urine. No burning, no blood in urine, and no incontinence.",
    "neurological": "No weakness, numbness, seizures, or speech problems.",
    "musculoskeletal": "No joint swelling. I sometimes have lower back pain from sitting at work.",
    "skin": "No rash, wounds, or yellowing of the skin."
  },
  "pmh": {
    "chronicDiseases": "I have high blood pressure and high cholesterol. No diabetes that I know of.",
    "cardiovascularDisease": "I have high blood pressure and high cholesterol. I have never had a heart attack, stent, or bypass.",
    "specialists": "I see my general practitioner. No regular cardiologist yet.",
    "hospitalizations": "I was hospitalized once years ago for pneumonia.",
    "operations": "My appendix was removed when I was young. No other surgeries.",
    "operationDetails": {
      "date": "I do not remember exactly. I was young, maybe in my teens.",
      "approach": "I am not sure whether it was open or laparoscopic. I was young.",
      "complications": "No complications that I know of."
    },
    "previousExams": "I had blood tests last year and an ECG maybe two years ago. No recent CT scan that I remember."
  },
  "allergies": "No known drug allergies.",
  "allergyDetails": {
    "foodEnvironment": "No food or environmental allergies that I know of.",
    "pollen": "No, I do not have a pollen allergy.",
    "reaction": "I have not had an allergy reaction that I know of."
  },
  "transfusions": "No previous blood transfusions.",
  "medication": {
    "regular": "If I remember correctly, ramipril 5 mg once daily. Atorvastatin 20 mg at night, though I sometimes forget it. Occasional ibuprofen for back pain.",
    "nitroglycerinPrevious": "No, I have never used nitroglycerin before.",
    "otcSupplements": "Occasional ibuprofen for back pain. No supplements.",
    "adherence": "I took ramipril today. I sometimes forget atorvastatin."
  },
  "gynHistory": "That does not apply to me.",
  "familyHistory": "My father died of a heart attack at 62. My mother has diabetes and high blood pressure.",
  "epidemiology": "No recent travel, no sick contacts, no pets. I had COVID two years ago and I am vaccinated twice.",
  "social": {
    "living": "I am married and live with my wife in an apartment on the third floor, with an elevator.",
    "independence": "I am independent in daily activities and walk without aids."
  },
  "substances": {
    "smoking": "I smoke about 15 cigarettes a day, for around 35 years.",
    "alcohol": "I drink beer on weekends, maybe two or three beers.",
    "caffeine": "Two coffees a day, sometimes black tea.",
    "drugs": "No recreational drugs."
  },
  "vitals": {
    "bp": "Blood pressure is 154/94 mmHg in the right arm and 152/92 mmHg in the left arm.",
    "hr": "Heart rate is 96 per minute and regular.",
    "rr": "Respiratory rate is 20 per minute.",
    "spo2": "Oxygen saturation is 96 percent on room air.",
    "temperature": "Temperature is 36.8 °C."
  },
  "exam": {
    "general": "The patient looks worried and mildly distressed by ongoing pain. He is slightly clammy but alert and fully oriented.",
    "heart": "Heart sounds S1 and S2 are present. Rhythm is regular. No new murmur, gallop, or pericardial rub is heard.",
    "lungs": "Air entry is equal bilaterally. The lungs are clear with no wheeze or basal crackles.",
    "perfusion": "Hands are warm. Capillary refill is about 2 seconds. There is no peripheral cyanosis.",
    "pulses": "Radial and peripheral pulses are palpable and symmetrical. There is no pulse deficit.",
    "jvp": "JVP is not elevated at 45 degrees.",
    "chestWall": "Palpation of the chest wall does not reproduce the pain.",
    "legs": "There is no unilateral calf swelling or tenderness and no clinically significant pitting oedema.",
    "abdomen": "The abdomen is soft and non-tender with no pulsatile abdominal mass.",
    "bowelSounds": "Bowel sounds are present."
  },
  "labs": {
    "hsTroponinT": "High-sensitivity troponin T is 184 ng/L and above the laboratory reference limit.",
    "wbc": "WBC is 9.2 ×10⁹/L.",
    "hemoglobin": "Haemoglobin is 146 g/L.",
    "platelets": "Platelets are 248 ×10⁹/L.",
    "crp": "CRP is 4 mg/L.",
    "creatinine": "Creatinine is 88 µmol/L.",
    "egfr": "Estimated GFR is 86 mL/min/1.73 m².",
    "sodium": "Sodium is 139 mmol/L.",
    "potassium": "Potassium is 4.3 mmol/L.",
    "magnesium": "Magnesium is 0.84 mmol/L.",
    "glucose": "Glucose is 6.1 mmol/L.",
    "inr": "INR is 1.0.",
    "aptt": "aPTT is 29 seconds.",
    "ldl": "LDL cholesterol is 3.4 mmol/L."
  },
  "simulation": {
    "initialState": {
      "symptoms": {
        "pain": 7,
        "distress": 0.78,
        "dyspnea": 0.42,
        "nausea": 0.25
      },
      "visual": {
        "sweating": 0.72,
        "pallor": 0.24,
        "position": "standing",
        "consciousness": "alert"
      }
    },
    "actionEffects": [
      {
        "id": "aspirin",
        "match": ["aspirin"],
        "message": "Aspirin was administered. No immediate visible physiological change is expected."
      },
      {
        "id": "monitor_iv",
        "match": ["continuous cardiac monitoring", "monitoring and obtain iv access", "monitor and establish iv access"],
        "equipment": {
          "monitor": true,
          "telemetry": true,
          "bpCuff": true,
          "spo2Probe": true,
          "ivAccess": true
        },
        "message": "The patient is now connected to continuous monitoring and has IV access."
      },
      {
        "id": "stemi_pathway",
        "match": ["stemi pathway", "cardiology"],
        "message": "Urgent cardiology / STEMI escalation was recorded. The bedside appearance does not immediately change."
      },
      {
        "id": "anticoagulation",
        "match": ["anticoagulation", "heparin"],
        "message": "Anticoagulation was recorded. No immediate visible physiological change is expected."
      },
      {
        "id": "nitrate",
        "match": ["sublingual nitrate", "nitroglycerin", "nitrate"],
        "symptomDelta": {
          "pain": -2.5,
          "distress": -0.22,
          "dyspnea": -0.08
        },
        "physiologyDelta": {
          "hr": -4,
          "sbp": -12,
          "dbp": -6
        },
        "visualDelta": {
          "sweating": -0.18
        },
        "message": "In this case the chest pressure eases and the blood pressure trends down after nitrate."
      },
      {
        "id": "oxygen",
        "match": ["supplemental oxygen", "oxygen"],
        "equipment": {
          "oxygen": true
        },
        "message": "Nasal oxygen is applied. Because the patient is not significantly hypoxaemic, there is little immediate visible change."
      }
    ]
  },
  "redFlags": [
    "Ongoing pressure-like retrosternal pain lasting more than 20 minutes",
    "Radiation to the left arm and jaw",
    "Dyspnoea, diaphoresis and nausea accompanying the pain",
    "Major cardiovascular risk factors: smoking, hypertension, dyslipidaemia and positive family history"
  ],
  "debriefPriorities": {
    "essential": [
      "identity_name",
      "identity_age",
      "identity_sex",
      "identity_residence",
      "administrative_admission_time",
      "administrative_arrival_method",
      "chief_complaint",
      "hpi_site",
      "hpi_onset",
      "hpi_activity_at_onset",
      "hpi_character",
      "hpi_radiation",
      "hpi_associated_symptoms",
      "hpi_timing",
      "hpi_exacerbating",
      "hpi_relieving",
      "hpi_severity",
      "hpi_course",
      "pmh_chronic_diseases",
      "allergies",
      "medication_regular"
    ],
    "caseCritical": [
      "pmh_cardiovascular_disease",
      "ros_cardiovascular",
      "ros_respiratory",
      "family_history",
      "substance_smoking",
      "medication_nitroglycerin_previous"
    ],
    "criticalSafety": [
      "chief_complaint",
      "hpi_site",
      "hpi_onset",
      "hpi_character",
      "hpi_radiation",
      "hpi_associated_symptoms",
      "hpi_severity",
      "pmh_chronic_diseases",
      "pmh_cardiovascular_disease",
      "allergies",
      "medication_regular",
      "substance_smoking",
      "family_history"
    ]
  },
  "expectedDiagnosisIdea": "Acute coronary syndrome with an ECG pattern compatible with an inferior STEMI. This requires immediate STEMI-pathway escalation, continuous monitoring, antiplatelet therapy according to protocol, appropriate antithrombotic/reperfusion planning, and urgent cardiology/catheterization-laboratory involvement."
};
