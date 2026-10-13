const mergeDeep = (base, override) => {
  if (Array.isArray(base) || Array.isArray(override)) return override ?? base;
  if (!base || typeof base !== 'object') return override ?? base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])
      ? mergeDeep(base[key], value)
      : value;
  }
  return out;
};

const negativeRos = {
  general: { fever:'No fever or chills.', weight:'No unintentional weight change.', fatigue:'No unusual fatigue.', nightSweats:'No drenching night sweats.', appetite:'My appetite is normal.' },
  headNeck: { headache:'No headache.', dizziness:'No dizziness.', vision:'No new visual problems.', hearing:'No hearing problems.', swallowing:'No difficulty swallowing.' },
  cardiovascular: { chestPain:'No chest pain.', palpitations:'No palpitations.', edema:'No leg or ankle swelling.', syncope:'I have not fainted or nearly fainted.', orthopnea:'No shortness of breath lying flat or waking at night gasping.' },
  respiratory: { dyspnea:'No shortness of breath.', cough:'No cough.', sputum:'No sputum.', hemoptysis:'I have not coughed up blood.', wheeze:'No wheezing.' },
  gastrointestinal: { nausea:'No nausea.', vomiting:'No vomiting.', abdominalPain:'No abdominal pain.', bowelHabit:'No diarrhea, constipation, or change in bowel habit.', bleeding:'No black stool, blood in stool, or vomiting blood.', jaundice:'No yellowing of my eyes or skin.' },
  genitourinary: { dysuria:'No pain or burning when passing urine.', frequency:'No unusual frequency or urgency.', hematuria:'No blood in my urine.', flankPain:'No flank pain.' },
  neurological: { weakness:'No focal weakness.', sensory:'No numbness or tingling.', seizures:'No seizures.', speech:'No new speech difficulty.', balance:'No new balance or gait problem.' },
  musculoskeletal: { joints:'No painful or swollen joints.', stiffness:'No unusual stiffness.', backPain:'No significant back pain.' },
  skin: { rash:'No rash.', pruritus:'No unusual itching.', bruising:'No unusual bruising or bleeding.' }
};

const defaultCase = {
  difficulty: 'Intermediate',
  ecg: { available:false, label:'No case-specific ECG', imagePath:'', interpretation:'' },
  historySource: 'I can give you the history myself.',
  personality: { baselineRapport:70, talkativeness:0.5, anxiety:0.4, healthLiteracy:0.5, guardedness:0.2 },
  administrative: { admissionTime:'today', arrivalMethod:'A family member brought me here.', arrivalMode:'A family member brought me here.' },
  rosDetails: negativeRos,
  ros: {
    general:'No major general symptoms apart from the current problem.', headNeck:'No major head or neck symptoms.', cardiovascular:'No major cardiovascular symptoms apart from anything already described.', respiratory:'No major respiratory symptoms apart from anything already described.', gastrointestinal:'No major gastrointestinal symptoms apart from anything already described.', genitourinary:'No major urinary symptoms.', neurological:'No major neurological symptoms.', musculoskeletal:'No major musculoskeletal symptoms.', skin:'No major skin symptoms.'
  },
  pmh: { chronicDiseases:'No major chronic medical conditions.', cardiovascularDisease:'No known cardiovascular disease.', specialists:'No regular specialist follow-up.', hospitalizations:'No previous hospital admissions.', operations:'No previous operations.', operationDetails:{date:'No previous operation.',approach:'No previous operation.',complications:'No previous operation.'}, anesthesiaHistory:'No previous anaesthetic history.', previousExams:'No relevant previous tests that I know of.' },
  allergies:'No known drug allergies.', allergyDetails:{foodEnvironment:'No food, latex, or environmental allergies.',pollen:'No pollen allergy.',reaction:'I have not had an allergic reaction that I know of.'}, transfusions:'No previous blood transfusions.',
  medication:{ regular:'I do not take regular prescribed medicines.', nitroglycerinPrevious:'No, I have never used nitroglycerin.', otcSupplements:'No regular over-the-counter medicines or supplements.', adherence:'No regular medication.', details:{dose:'No regular prescription dose.',frequency:'No regular prescription frequency.',indication:'No regular prescription indication.',recentChanges:'No recent medication changes.',otc:'No regular over-the-counter medicines.',supplements:'No supplements or herbal products.'} },
  gynHistory:'That does not apply to me.', gynDetails:{lmp:'Not applicable.',pregnancy:'Not applicable.',contraception:'Not applicable.',obstetric:'Not applicable.'},
  familyHistory:'No major family history that I know of.', familyDetails:{cardiovascular:'No important premature cardiovascular disease in the family.',diabetes:'No important diabetes history in the family.',cancer:'No important cancer history in the family.',inherited:'No known inherited disease or sudden unexplained death.'},
  epidemiology:'No relevant travel, sick contacts, animal exposure, or suspicious food exposure.', epidemiologyDetails:{travel:'No recent travel.',contacts:'No known sick contacts.',animalsTicks:'No relevant animal or tick exposure.',vaccinationFood:'Vaccinations are up to date as far as I know. No suspicious food or water exposure.'},
  social:{living:'I live at home and manage independently.',independence:'I am independent in daily activities.'}, socialDetails:{household:'I live with family.',housing:'No major access problems at home.',support:'Family can help if needed.',baselineFunction:'Normally fully independent and mobile.',currentFunction:'The current illness has not greatly changed my independence.'},
  substances:{smoking:'I do not smoke.',alcohol:'I drink little or no alcohol.',caffeine:'One or two caffeinated drinks a day.',drugs:'No recreational drugs.'}, substanceDetails:{smokingQuantity:'I do not smoke.'},
  closure:{anythingElse:'No, I think we have covered the main problem.',concerns:'I mainly want to know what is causing this.',understanding:'Yes, I understand. I do not have another question right now.'},
  vitals:{bp:'Blood pressure is within the expected range for this case.',hr:'Heart rate is available if measured.',rr:'Respiratory rate is available if measured.',spo2:'Oxygen saturation is available if measured.',temperature:'Temperature is available if measured.'},
  exam:{general:'General examination is available in the full encounter mode.',lungs:'Respiratory examination is available in the full encounter mode.',heart:'Cardiovascular examination is available in the full encounter mode.',abdomen:'Abdominal examination is available in the full encounter mode.',bowelSounds:'Bowel sounds are available in the full encounter mode.'},
  labs:{wbc:'Not ordered.',crp:'Not ordered.',creatinine:'Not ordered.',potassium:'Not ordered.',glucose:'Not ordered.',tsh:'Not ordered.'},
  simulation:{initialState:{symptoms:{pain:2,distress:0.25,dyspnea:0.05,nausea:0.05},visual:{sweating:0,pallor:0,position:'sitting',consciousness:'alert'}},actionEffects:[]},
  redFlags:[],
  debriefPriorities:{essential:[],caseCritical:[],recommended:[],optional:[],notRelevant:[],criticalSafety:[]},
  expectedDiagnosisIdea:'Use the history to form an appropriate differential diagnosis.'
};

export function createAnamnesisCase(config = {}) {
  return mergeDeep(defaultCase, config);
}
