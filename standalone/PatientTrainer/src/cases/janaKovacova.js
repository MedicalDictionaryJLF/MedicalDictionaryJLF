export const janaKovacova = {
  "id": "abdominal_pain_cholecystitis",
  "title": "Case 2",
  "difficulty": "Intermediate",
  "patientCard": "43-year-old woman with abdominal pain and nausea after a fatty meal.",
  "stationBrief": {
    "location": "Emergency Department surgical triage room",
    "time": "18:40 simulated hospital time",
    "task": "Take a focused abdominal-pain anamnesis. Clarify SOCRATES, GI/GU/gynaecological symptoms, risk factors, allergies, medication, and decide which objective findings are needed."
  },
  "ecg": {
    "available": false,
    "label": "No case-specific ECG",
    "imagePath": "",
    "interpretation": ""
  },
  "openingLine": "I have strong pain under my right ribs and I feel sick.",
  "administrative": {
    "admissionTime": "this morning",
    "arrivalMethod": "My husband drove me here.",
    "arrivalMode": "My husband drove me here."
  },
  "personality": {
    "baselineRapport": 72,
    "talkativeness": 0.6,
    "anxiety": 0.55,
    "healthLiteracy": 0.55,
    "guardedness": 0.15
  },
  "identity": {
    "name": "Jana Kovacova",
    "age": 43,
    "dob": "22 February 1983",
    "sex": "female",
    "residence": "Zilina",
    "occupation": "an accountant"
  },
  "chiefComplaint": "I came because of strong pain in the right upper part of my abdomen.",
  "hpi": {
    "site": "It is under the right ribs, more toward the upper abdomen.",
    "onset": "It started yesterday evening, about two hours after dinner.",
    "activityAtOnset": "I had eaten fried cheese and then watched TV. It began after that.",
    "character": "It is a constant cramping and pressure-like pain.",
    "radiation": "It goes to my right shoulder blade.",
    "associatedSymptoms": "I have nausea and vomited once. I also had chills.",
    "timing": "It has been there most of the time since last evening.",
    "exacerbating": "Eating makes it worse, especially fatty food. Deep breathing is uncomfortable too.",
    "relieving": "Nothing really helps. Paracetamol only helped slightly.",
    "severity": "About 7 out of 10.",
    "course": "It is getting worse compared with yesterday."
  },
  "ros": {
    "general": "I feel tired and had chills. No weight loss or night sweats.",
    "headNeck": "No headache, dizziness, vision, hearing, or throat problems.",
    "cardiovascular": "No chest pain or palpitations.",
    "respiratory": "No cough or shortness of breath.",
    "gastrointestinal": "Nausea, one episode of vomiting, right upper abdominal pain. No diarrhea, no blood in stool, no black stool.",
    "genitourinary": "No urinary burning, frequency, or blood in urine.",
    "neurological": "No weakness, numbness, seizures, or loss of consciousness.",
    "musculoskeletal": "No joint pain or muscle pain.",
    "skin": "No rash. My husband said my eyes looked slightly yellow this morning, but I am not sure."
  },
  "pmh": {
    "chronicDiseases": "I have high cholesterol. No diabetes or hypertension.",
    "cardiovascularDisease": "No known heart disease.",
    "specialists": "No regular specialist follow-up.",
    "hospitalizations": "Only for childbirth.",
    "operations": "No operations.",
    "operationDetails": {
      "date": "No previous operation date because I have not had surgery.",
      "approach": "No previous operation approach because I have not had surgery."
    },
    "previousExams": "I had an abdominal ultrasound two years ago and they mentioned gallstones."
  },
  "allergies": "I am allergic to penicillin. I had a rash as a child.",
  "allergyDetails": {
    "foodEnvironment": "No food or environmental allergies that I know of.",
    "pollen": "No pollen allergy.",
    "reaction": "With penicillin I had a rash as a child."
  },
  "transfusions": "No transfusions.",
  "medication": {
    "regular": "I do not take regular prescribed medicines.",
    "nitroglycerinPrevious": "No, I have never used nitroglycerin.",
    "otcSupplements": "Sometimes paracetamol. No supplements.",
    "adherence": "No regular medication."
  },
  "gynHistory": "My periods are regular. Last menstrual period was about two weeks ago. I am not pregnant as far as I know. I have two children, both vaginal deliveries. No miscarriages.",
  "familyHistory": "My mother had gallbladder surgery. Father has hypertension.",
  "epidemiology": "No travel, no sick contacts, no farm animals. We have a cat. No tick bite recently.",
  "social": {
    "living": "I am married and live with my husband and children in a house.",
    "independence": "I am independent in all daily activities."
  },
  "substances": {
    "smoking": "I do not smoke.",
    "alcohol": "Rarely, maybe a glass of wine once a month.",
    "caffeine": "One coffee a day.",
    "drugs": "No recreational drugs."
  },
  "vitals": {
    "bp": "Her blood pressure is 130/80 mmHg.",
    "hr": "Heart rate is 104 per minute.",
    "rr": "Respiratory rate is 18 per minute.",
    "spo2": "Oxygen saturation is 98 percent on room air.",
    "temperature": "Temperature is 38.1 °C."
  },
  "exam": {
    "general": "The patient appears uncomfortable because of abdominal pain and is febrile.",
    "lungs": "Lungs are clear.",
    "heart": "Heart rhythm is regular with no murmur.",
    "abdomen": "Right upper quadrant tenderness is present. Murphy sign is positive. There is no generalized guarding.",
    "bowelSounds": "Bowel sounds are present."
  },
  "labs": {
    "wbc": "WBC is 13.2 ×10⁹/L.",
    "crp": "CRP is 68 mg/L.",
    "creatinine": "Creatinine is 70 µmol/L.",
    "potassium": "Potassium is 4.0 mmol/L.",
    "glucose": "Glucose is 5.2 mmol/L.",
    "tsh": "TSH was not measured."
  },
  "simulation": {
    "initialState": {
      "symptoms": {
        "pain": 7,
        "distress": 0.62,
        "dyspnea": 0.05,
        "nausea": 0.56
      },
      "visual": {
        "sweating": 0.25,
        "pallor": 0.12,
        "position": "guarding",
        "consciousness": "alert"
      }
    },
    "actionEffects": [
      {
        "id": "analgesia",
        "match": ["analgesia", "pain relief"],
        "symptomDelta": {
          "pain": -3,
          "distress": -0.22
        },
        "physiologyDelta": {
          "hr": -5
        },
        "message": "The abdominal pain and visible distress ease after analgesia."
      },
      {
        "id": "antiemetic",
        "match": ["antiemetic"],
        "symptomDelta": {
          "nausea": -0.45,
          "distress": -0.06
        },
        "message": "Nausea improves after antiemetic treatment."
      },
      {
        "id": "iv_fluids",
        "match": ["iv access", "fluids", "iv fluid"],
        "equipment": {
          "ivAccess": true,
          "infusion": true
        },
        "message": "IV access is established and an infusion is running."
      },
      {
        "id": "surgical_review",
        "match": ["surgical review", "senior"],
        "message": "Senior / surgical review is requested. The bedside appearance does not immediately change."
      }
    ]
  },
  "redFlags": [
    "Right upper quadrant pain with vomiting and chills",
    "Known gallstones",
    "Possible jaundice reported by family"
  ],
  "expectedDiagnosisIdea": "Possible acute cholecystitis or biliary obstruction. Needs abdominal exam, inflammatory markers, liver tests, bilirubin, ultrasound, and surgical review."
};
