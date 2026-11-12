import { explicitSymptoms, symptomSubject, medicationSubjectName, unavailableDetail, ambiguousDrugQuestion, ambiguousFamilyQuestion, ambiguousDurationQuestion } from './dialogue/conversationSubjects.js?v=pilot-12';
import { getSocialAct, socialReply } from './dialogue/socialConversation.js';
import { QUESTION_VARIANTS, QUESTION_FOLLOWUPS } from './data/questionVariants.js';
import { INTENTS, QUESTION_AREAS, INTENT_TO_AREA, getModelQuestions } from './data/interviewSchema.js?v=pilot-9';
import { retrieveFacts } from './dialogue/clinicalFacts.js?v=pilot-9';
import { realizeEnglish, realizePatientReply } from './dialogue/responseTemplates.js?v=pilot-11';
import { analyzeQuestion, medicationSubject, splitQuestions } from './dialogue/questionAnalysis.js?v=pilot-11';
import { PRESENTING_SYMPTOMS } from './cases/conversationFacts.js';

const MATCH_THRESHOLD = 0.24;
const WEAK_MATCH_THRESHOLD = 0.16;
const MIN_TOP_SCORE_FOR_MATCH = 1.35;
const MIN_TOP_SCORE_FOR_WEAK_MATCH = 0.85;

const POLITE_TERMS = ['please', 'thank you', 'thanks', 'could you', 'can you', 'may i', 'sorry', 'take your time'];
const RUDE_TERMS = ['stupid', 'idiot', 'shut up', 'moron', 'fuck', 'bitch', 'irrelevant', 'hurry'];
const EMPATHY_TERMS = ['i am sorry', 'im sorry', 'that sounds', 'must be difficult', 'must be scary', 'i understand', 'i can see', 'thank you for telling me', 'thanks for telling me'];
const INTRO_TERMS = ['my name is', 'i am a medical student', 'im a medical student', 'i am a doctor', 'im a doctor', 'hello', 'good morning', 'good afternoon'];
const PERMISSION_TERMS = ['may i', 'is it okay if', 'is it alright if', 'would it be okay', 'can i ask', 'do you mind if'];
const PATIENT_CENTERED_TERMS = ['tell me more', 'what worries you most', 'how are you feeling', 'how does that make you feel', 'take your time'];
const DISMISSIVE_TERMS = ['just answer', 'just tell me', 'get to the point', 'stop talking', 'doesnt matter', 'does not matter'];

const ATTEMPT_RULES = [
  ['identity_dob', /\b(date of (?:your )?birth|birth date|when were you born|born exactly|exact date.*birth|birthday)\b/],
  ['identity_age', /\b(how old|what is your age|your age|are you under 18)\b/],
  ['hpi_relieving', /\b(help|helping|ease|eased|relieve|relieving|alleviat\w*|better|improv\w*|go away|rest)\b.*\b(pain|pressure|symptom|it)\b|\b(pain|pressure|symptom|it)\b.*\b(help|helping|ease|eased|relieve|relieving|alleviat\w*|better|improv\w*|go away|rest)\b/],
  ['hpi_timing', /\b(for how long|how long (did|does|was|is|has|had)|duration|lasting|lasted|constant|continuous|intermittent|comes and goes|come and go|how often)\b/],
  ['hpi_exacerbating', /\b(exacerbat\w*|aggravat\w*|makes? .* worse|worsens?|trigger\w*|bring\w* it on)\b/],
  ['hpi_radiation', /\b(radiat\w*|spread\w*|travel\w*|go anywhere|move anywhere|left arm|jaw|shoulder|back)\b/],
  ['hpi_character', /\b(character|describe .*pain|what .*pain .*like|feel like|pressure|tightness|stabbing|sharp|dull|burning|cramping|colicky)\b/],
  ['hpi_site', /\b(where .*pain|site of .*pain|location of .*pain|where does it hurt|where exactly)\b/],
  ['hpi_onset', /\b(when did .*start|when .*pain .*start|since when|how long ago|onset)\b/],
  ['hpi_activity_at_onset', /\b(what were you doing|doing when .*start|activity at onset|circumstances at onset)\b/],
  ['hpi_associated_symptoms', /\b(other symptoms|anything else with it|associated symptoms|symptoms accompanying|accompanying the pain|other symptoms except pain|symptoms except pain)\b/],
  ['hpi_severity', /\b(scale .*one .*ten|scale .*1 .*10|out of ten|rate .*pain|how (bad|strong|severe|intense)|severity|vas)\b/],
  ['hpi_course', /\b(course|getting better|getting worse|improving|worsening|changed over time|progress\w*)\b/],
  ['chief_complaint', /\b(why did you (?:come|came)|why are you here|what brought you|main problem|what happened|what is wrong|how can i help)\b/],
  ['allergies', /\b(allerg\w*|alerg\w*)\b/],
  ['medication_regular', /\b(medication|medicine|meds|pills|tablets|what are you on)\b/],
  ['pmh_chronic_diseases', /\b(chronic diseases?|medical problems?|previous diseases?|hypertension|high blood pressure|diabetes|cholesterol)\b/],
  ['pmh_cardiovascular_disease', /\b(heart disease|cardiac disease|cardiovascular disease|heart attack|mi|stent|bypass|angina)\b/],
  ['family_history', /\b(family history|mother|father|parents|siblings|relatives)\b/],
  ['substance_smoking', /\b(smok\w*|cigarette\w*|tobacco)\b/]
];

export const MEDICAL_TERMINOLOGY = {
  dyspnea: { intent: 'ros_dyspnea', patientFriendly: 'Do you feel short of breath?', difficulty: 'high' },
  dysuria: { intent: 'ros_dysuria', patientFriendly: 'Do you have pain or burning when passing urine?', difficulty: 'high' },
  hemoptysis: { intent: 'ros_hemoptysis', patientFriendly: 'Have you coughed up blood?', difficulty: 'high' },
  orthopnea: { intent: 'ros_orthopnea', patientFriendly: 'Do you feel short of breath when lying flat?', difficulty: 'high' },
  syncope: { intent: 'ros_syncope', patientFriendly: 'Have you fainted or lost consciousness?', difficulty: 'medium' },
  palpitations: { intent: 'ros_palpitations', patientFriendly: 'Do you feel your heart racing or beating irregularly?', difficulty: 'medium' },
  edema: { intent: 'ros_edema', patientFriendly: 'Have you noticed swelling, especially in your legs or ankles?', difficulty: 'medium' },
  melena: { intent: 'ros_gi_bleeding', patientFriendly: 'Have your stools been black or tar-like?', difficulty: 'high' },
  hematemesis: { intent: 'ros_gi_bleeding', patientFriendly: 'Have you vomited blood?', difficulty: 'high' },
  nocturia: { intent: 'ros_urinary_frequency', patientFriendly: 'Do you wake up at night to urinate?', difficulty: 'medium' },
  polyuria: { intent: 'ros_urinary_frequency', patientFriendly: 'Are you urinating much more than usual?', difficulty: 'high' },
  polydipsia: { intent: 'ros_general', patientFriendly: 'Are you much more thirsty than usual?', difficulty: 'high' },
  dysphagia: { intent: 'ros_swallowing', patientFriendly: 'Do you have difficulty swallowing?', difficulty: 'high' },
  paresthesia: { intent: 'ros_sensory', patientFriendly: 'Do you feel tingling, numbness, or pins and needles?', difficulty: 'high' },
  vertigo: { intent: 'ros_dizziness', patientFriendly: 'Do you feel like the room is spinning?', difficulty: 'medium' },
  cephalgia: { intent: 'ros_headache', patientFriendly: 'Do you have a headache?', difficulty: 'high' },
  cyanosis: { intent: 'ros_skin', patientFriendly: 'Have your lips or fingers turned blue?', difficulty: 'high' },
  diaphoresis: { intent: 'hpi_associated_symptoms', patientFriendly: 'Were you sweating unusually?', difficulty: 'high' }
};

const FAMILY_OVERVIEW = /\b(?:family history|family anamnesis|medical history in (?:your )?family|what diseases are in your family|(?:tell me(?: something)?|what) about (?:your )?family(?: health)?$|(?:illnesses|diseases|conditions) (?:in|run in) (?:your|the) family|(?:are|were) your parents healthy|(?:do|did) your parents have (?:any )?(?:illnesses|diseases|medical conditions)|do you have ill parents|(?:your|you) parents (?:have (?:any )?)?(?:illnesses|diseases)|parents diseases)\b/;

const CHART_DETAILS = /\b(?:phone number|telephone number|(?:how can|how do) (?:we|i) contact you|what is your contact$|what contact do you prefer|contact information|email(?: address)?|contact preference|social security number|national id|patient id|(?:show|check) (?:me )?your wrist ?band|id card|health insurance card|what (?:ward|room) are you (?:in|admitted to)|where were you admitted|(?:who is|whos) your (?:gp|doctor|general practitioner|primary care doctor|referr?ing doctor)|who sent you here|room number|blood (?:type|group)|medical record number|(?:what is|whats) your id)\b/;
const TYPO_FIXES = Object.freeze({
  zou: 'you', zour: 'your', yout: 'your', yoz: 'you',
  admited: 'admitted', admittet: 'admitted', admition: 'admission', admitid: 'admitted',
  happend: 'happened', sympthoms: 'symptoms', symptomes: 'symptoms',
  marrital: 'marital', marity: 'marital', hight: 'height', heigh: 'height',
  nasuea: 'nausea', anathing: 'anything', conctact: 'contact', spreeding: 'spreading',
  spreding: 'spreading', frecquently: 'frequently', fracquently: 'frequently',
  chronical: 'chronic', regullary: 'regularly', youd: 'you', mutch: 'much', discribe: 'describe', desiases: 'diseases',
  diseasse: 'disease', relives: 'relieves', intens: 'intense', leps: 'helps',
  wher: 'where', hoiw: 'how', whitch: 'which', scael: 'scale', strart: 'start',
  gander: 'gender', genger: 'gender', continous: 'continuous', recurent: 'recurrent',
  addmited: 'admitted', addmutedf: 'admitted', admitter: 'admitted',
  breathibg: 'breathing', breatinh: 'breathing', preasure: 'pressure', nauzea: 'nausea',
  realationship: 'relationship', conttact: 'contact', nunmber: 'number', somwhere: 'somewhere',
  anythinng: 'anything', asociated: 'associated', dayly: 'daily', simular: 'similar',
  cosciousness: 'consciousness', diebetes: 'diabetes', vacinacions: 'vaccinations',
  ilegal: 'illegal', amaying: 'amazing', adtes: 'address', phsysical: 'physical', actvity: 'activity'
});

const questionKey = value => normalize(value).replace(/^(?:please|and please) | please$/g, '');
const QUESTION_BY_PHRASE = new Map(Object.entries(QUESTION_VARIANTS)
  .flatMap(([intent, questions]) => questions.map(question => [questionKey(question), intent])));
const FOLLOWUP_BY_PHRASE = new Map(QUESTION_FOLLOWUPS.map(followup => [questionKey(followup.phrase), followup]));

// Explicit subjects take precedence over the previous symptom and keyword overlap.
const FAMILY_MEMBER = /\b(?:family(?! (?:doctor|physician))|relatives?|parents?|mother|father|mum|mom|dad|siblings?|brothers?|sisters?|grandparents?|grandmother|grandfather|children|son|daughter)\b/;
const FAMILY_HEART = /\b(?:heart attacks?|heart disease|heart conditions?|heart problems?|strokes?|hypertension|high blood pressure|cardiac disease|cardiovascular disease)\b/;
const SPECIALTY = /\b(?:cardiologist|diabetologist|endocrinologist|nephrologist|pulmonologist|gastroenterologist|neurologist|rheumatologist|oncologist|urologist|psychiatrist)\b/;
const CARE_VISIT = /\b(?:see|seeing|visit|visiting|go to|go see|followed by|under the care of|appointments? with|follow up with)\b/;
const REGULAR_CARE = /\b(?:gp|g p|general practitioner|primary care (?:doctor|provider)|doctors? office|family doctor)\b/;
const DIET_DETAIL = /\b(?:vegetarian|vegan|eat meat|eat (?:any )?animal products|plant based diet)\b/;
const SCOPED_QUESTIONS = [
  [/\b(?:injuries|injury|accidents?)\b/, /\b(?:ever|history|past|previous)\b/, 'I’m not sure about any previous injuries or accidents.'],
  [/\b(?:mental illness(?:es)?|psychiatric (?:illness|disorder|history)|mental health (?:condition|diagnosis))\b/, /\b(?:have|had|history|diagnosed)\b/, 'I’m not sure about that part of my mental health history.'],
  [/\b(?:donat\w*|give|given) blood\b/, /\b(?:you|ever|history)\b/, 'I’m not sure whether I’ve donated blood before.'],
  [/\b(?:pee|peed|urinate|urinated|pass(?:ed)? urine)\b/, /\b(?:did|have) you\b.*\b(?:today|this morning)\b/, 'I’m not sure when I last passed urine.']
];

const DIRECT_RULES = [
  [/\b(what is your name|your name|who are you|full name)\b/, ['identity_name'], 'single_intent'],
  [/\b(date of (?:your )?birth|birth date|when (?:were|did) you born|birthday)\b/, ['identity_dob'], 'single_intent'],
  [/\b(how old|what is your age|your age|are you under 18)\b/, ['identity_age'], 'single_intent'],
  [/\b(male or female|sex|gender|are you (?:a )?(?:man|men|woman|women))\b/, ['identity_sex'], 'single_intent'],
  [/\b(where are you from|where do you live|which town|what city|what street|address|residence)\b/, ['identity_residence'], 'single_intent'],
  [/\b(?:where (?:were|was) you born|birthplace|place of birth)\b/, ['intake_birthplace'], 'single_intent'],
  [/\b(?:any siblings|have siblings|have (?:a )?(?:sister|brother)|(?:sisters?|brothers?) or (?:sisters?|brothers?))\b/, ['intake_siblings'], 'single_intent'],
  [/\b(?:last meal|what did you (?:eat|have)(?: today| for breakfast)?|did you (?:eat|ate|have breakfast|had breakfast)(?: today| something)?)\b/, ['intake_last_meal'], 'single_intent'],
  [/\b(?:did you drink (?:water|anything) today|how much (?:water|liquid|fluid) did you drink today)\b/, ['intake_recent_fluids'], 'single_intent'],
  [/\b(?:what (?:do you eat|is your diet)|(?:any|kind of|your) diet|how is your diet|vegetarian or vegan|do you eat meat)\b/, ['intake_diet'], 'single_intent'],
  [/^(?:(?:can|could|do|did) you sleep(?: well)?(?: at night)?|how (?:well do you sleep|is your sleep(?: quality)?))$/, ['intake_sleep'], 'single_intent'],
  [/\b(?:did you (?:have|had) (?:this|the|similar) pain before|do you have (?:this|thius) pain before|have you experienced something similar before)\b/, ['hpi_previous_episodes'], 'single_intent'],
  [/^(?:how did you (?:come|came)|did you (?:come|came|get) (?:here |there |to (?:the )?hospital )?(?:by|with) (?:a )?(?:car|bus|ambulance)(?: or (?:by )?(?:car|bus|ambulance))?|did you get (?:here|there) by (?:car|bus|ambulance))$/, ['administrative_arrival_method'], 'single_intent'],
  [/\b(?:how often do you (?:have (?:a )?(?:bowel|bowl) movements?|move your bowels|pass stool|open your bowels)|bowel movement frequency)\b/, ['ros_bowel_frequency'], 'single_intent'],
  [/\b(?:last visit (?:at|to|with) (?:the |your )?(?:gyn(?:ae|e)colog(?:ist|y)|gynecolgist)|last (?:gynaecology|gynecology) (?:visit|appointment)|last (?:see|visit) (?:a |your |the )?(?:gynaecologist|gynecologist))\b/, ['gyn_last_visit'], 'single_intent'],
  [/\b(?:have you ever (?:had|experienced)|do you have any experience with|did you (?:have|had)|have you had)\b.*\b(?:this (?:kind of )?(?:pain|problem)|similar (?:symptoms|problems)|anything like this|something similar|(?:these|those) symptoms)|\bhas it ever hurt like this before\b|\b(?:this|it) (?:your )?first time (?:having|with)\b/, ['hpi_previous_episodes'], 'single_intent'],
  [/\b(next of (?:kin|kim)|emergency contact|contact person|family contact)\b/, ['intake_contact_person'], 'single_intent'],
  [/\b(how tall are you|(?:what is|whats) your height)\b/, ['intake_height'], 'single_intent'],
  [/\b((?:what is|whats) your (?:current )?weigh(?:t)?|(?:what|how much) do you weigh(?:t)?|how much do weigh(?:t)?)\b/, ['intake_weight'], 'single_intent'],
  [/\b(marital status|(?:social|family) status|are you (?:married|single|widowed|divorced))\b/, ['intake_marital_status'], 'single_intent'],
  [/\b((?:do you have (?:any )?|how many )(?:children|kids|a child)|how many children do you have)\b|^(?:and )?(?:kids|children)$/, ['intake_children'], 'single_intent'],
  [/\b(are you giving (me )?the history|history yourself|who is giving (me )?the history|who can give (me )?the history)\b/, ['history_source'], 'single_intent'],
  [/\b(when were you admit(?:ted|ed|tet|id)|when did you get admitted|when did you (?:come|came)|when did you arrive|what time did you come|when did you get here|how long (?:are|have) you (?:been )?(?:here|in (?:the )?hospital))\b/, ['administrative_admission_time'], 'single_intent'],
  [/\b(how did you get here|how did you arrive|how did you (?:come|came) here|how did you (?:get|come|came) (?:to|into) (the )?hospital|did you (?:come|came) by (?:ambulance|bus|car)|did someone drive you|who (?:brought|took) you|did someone bring you|did you (?:come|came) (?:to (?:the )?hospital )?(?:alone|with (?:someone|anyone|somebody)|by yourself)|are you here (?:alone|with (?:family|anyone))|were you brought by emergency services)\b/, ['administrative_arrival_method'], 'single_intent'],
  [/\b(what (?:brought|brings?|is bringing) you|why did you (?:come|came)|why are you here|what happened|what is wrong|main problem|how can i help|tell me about the problem|reason for (coming|admission)|what is your (?:current complain(?:t)?|medical problem|main complaint|current problem|current medical condition|problem)|what seems to be (?:the|th) problem|(?:do you (?:have|feel) (?:any )?pain|are you (?:in (?:any )?pain|(?:feeling|experiencing) (?:any )?pain)|is something hurting you|does it hurt now)(?: right now| now)?$|what do you feel right now|what symptoms (?:do you have|are you having)|do you have any symptoms|what is bothering you today|what happend to you|^what was the reason$)\b/, ['chief_complaint'], 'broad_open_history'],
  [/\b(heart attack in family|family heart disease|stroke in family|family history of (?:heart disease|heart attacks?|stroke|hypertension|high blood pressure)|premature heart|sudden cardiac)\b/, ['family_cardiovascular'], 'single_intent'],
  [/\b(diabetes in family|family diabetes|family history of diabetes)\b/, ['family_diabetes'], 'single_intent'],
  [/\b(cancer in family|(?:does|did) anyone in your family (?:have|has) cancer|family cancer|family history of cancer)\b/, ['family_cancer'], 'single_intent'],
  [/\b(genetic disease|genetic predisposition|inherited disease|runs in (the )?family|sudden unexplained death)\b/, ['family_inherited'], 'single_intent'],
  [FAMILY_OVERVIEW, ['family_history'], 'single_intent'],
  [/\b(where is the pain|where does it hurt|on which side|site of pain|location of pain)\b/, ['hpi_site'], 'single_intent'],
  [/\b(when did (the )?(pain|symptom|problem) start|onset of pain|when did it start|since when)\b/, ['hpi_onset'], 'single_intent'],
  [/\b(what were you doing|doing when it started|activity at onset|circumstances at onset)\b/, ['hpi_activity_at_onset'], 'single_intent'],
  [/\b(character of (the )?pain|what type of pain|what kind of pain|what is the pain like|what does it feel like|describe (?:your|that|the) pain|what is (?:the )?pain like|(?:the )?character of your pain)\b/, ['hpi_character'], 'single_intent'],
  [/\b(does (it|the pain) radiate|does (it|the pain) spread|does it go anywhere|does it travel|radiation of (the )?pain)\b/, ['hpi_radiation'], 'single_intent'],
  [/\b(associated symptoms|any other sympt(?:oms|homes|omes)|other difficulties in common with the pain|what other sympt(?:oms|homes|omes)|anything else with it|symptoms accompanying|problems associated with (?:that|it))\b/, ['hpi_associated_symptoms'], 'single_intent'],
  [/\b(for how long|how long .*last|duration|constant|continuous|intermittent|comes and goes|how often)\b/, ['hpi_timing'], 'single_intent'],
  [/\b(what makes it worse|worsens the pain|aggravating factors|exacerbating factors|what triggers it)\b/, ['hpi_exacerbating'], 'single_intent'],
  [/\b(what makes it better|relieving factors|what relieves|helps the pain|anything help)\b/, ['hpi_relieving'], 'single_intent'],
  [/\b(how bad|how strong|how intense|how intensive|severity|vas|scale from|out of ten|rate (the )?pain)\b/, ['hpi_severity'], 'single_intent'],
  [/\b(getting worse over time|getting better over time|course since onset|has it changed|progressing|improving|worsening)\b/, ['hpi_course'], 'single_intent'],

  // Atomic ROS rules must precede broad system screens.
  [/\b(fever|chills|rigors|shaking chills)\b/, ['ros_fever'], 'single_intent'],
  [/\b(weight loss|lost (?:any )?weight|weight gain|gained (?:any )?weight)\b/, ['ros_weight'], 'single_intent'],
  [/\b(fatigue|unusually tired|feeling (?:any )?tired|low energy|exhausted)\b/, ['ros_fatigue'], 'single_intent'],
  [/\b(night sweats|sweating at night)\b/, ['ros_night_sweats'], 'single_intent'],
  [/\b(appetite|eating less|eating more)\b/, ['ros_appetite'], 'single_intent'],
  [/\b(headache|head pain|(?:head|head is) hurt(?:s|ing)?)\b/, ['ros_headache'], 'single_intent'],
  [/\b(dizzy|dizziness|vertigo|room spinning|light headed|light-headed)\b/, ['ros_dizziness'], 'single_intent'],
  [/\b(vision|visual|blurred vision|double vision)\b/, ['ros_vision'], 'single_intent'],
  [/\b(hearing|hearing loss|ear problems)\b/, ['ros_hearing'], 'single_intent'],
  [/\b(difficulty swallowing|pain.*swallow|swallowing|dysphagia|food sticking)\b/, ['ros_swallowing'], 'single_intent'],
  [/\b(chest pain|chest pressure|chest discomfort)\b/, ['ros_chest_pain'], 'single_intent'],
  [/\b(palpitations|heart racing|heart pounding|irregular heartbeat)\b/, ['ros_palpitations'], 'single_intent'],
  [/\b(leg swelling|legs swelling|ankle swelling|swollen legs|oedema|edema)\b/, ['ros_edema'], 'single_intent'],
  [/\b(faint|fainted|syncope|blackout|passed out|nearly faint)\b/, ['ros_syncope'], 'single_intent'],
  [/\b(orthopn|lying flat.*breath|pillows.*breath|wake.*night.*breath|pnd)\b/, ['ros_orthopnea'], 'single_intent'],
  [/\b(shortness of breath|feel short of breath|breathless|trouble breathing|how (?:is|s) (?:your|you) breathing|is (?:your|you) breathing (?:unimpaired|unimparied)|how do you breathe|breathing (?:problem|problems|complications)|(?:problems?|difficult(?:y|ies)) (?:with )?breathing|dyspn)\b/, ['ros_dyspnea'], 'single_intent'],
  [/\b(cough|coughing)\b/, ['ros_cough'], 'single_intent'],
  [/\b(sputum|phlegm|mucus.*cough)\b/, ['ros_sputum'], 'single_intent'],
  [/\b(cough.*blood|coughed.*blood|ha?emoptysis)\b/, ['ros_hemoptysis'], 'single_intent'],
  [/\b(wheeze|wheezing|whistling.*breath)\b/, ['ros_wheeze'], 'single_intent'],
  [/\b(nausea|nauseous|feel sick)\b/, ['ros_nausea'], 'single_intent'],
  [/\b(vomit|vomiting|threw up|sick up)\b/, ['ros_vomiting'], 'single_intent'],
  [/\b(abdominal pain|stomach pain|belly pain|tummy pain)\b/, ['ros_abdominal_pain'], 'single_intent'],
  [/\b(diarrh|constipat|bowel habit|stool frequency)\b/, ['ros_bowel_habit'], 'single_intent'],
  [/\b(black stool|black stools|blood in stool|bloody stool|mela?ena|vomit.*blood|ha?ematemesis)\b/, ['ros_gi_bleeding'], 'single_intent'],
  [/\b(jaundice|yellow eyes|yellow skin|dark urine|pale stool)\b/, ['ros_jaundice'], 'single_intent'],
  [/\b(dysuria|burning.*urin|pain.*urin|pain.*passing urine)\b/, ['ros_dysuria'], 'single_intent'],
  [/\b(urinary frequency|urinate often|pee often|urgency|nocturia)\b/, ['ros_urinary_frequency'], 'single_intent'],
  [/\b(blood in (?:your )?urine|ha?ematuria|red urine)\b/, ['ros_hematuria'], 'single_intent'],
  [/\b(flank pain|loin pain|kidney pain|pain in your side)\b/, ['ros_flank_pain'], 'single_intent'],
  [/\b(weakness|weak arm|weak leg|facial weakness)\b/, ['ros_weakness'], 'single_intent'],
  [/\b(numb|numbness|tingling|pins and needles|paresthesia)\b/, ['ros_sensory'], 'single_intent'],
  [/\b(seizure|fit|convulsion)\b/, ['ros_seizures'], 'single_intent'],
  [/\b(slurred speech|speech problem|difficulty speaking|finding words)\b/, ['ros_speech'], 'single_intent'],
  [/\b(balance|unsteady|gait problem)\b/, ['ros_balance'], 'single_intent'],
  [/\b(joint pain|joint swelling|painful joints)\b/, ['ros_joint_pain'], 'single_intent'],
  [/\b(morning stiffness|joint stiffness|stiff joints)\b/, ['ros_stiffness'], 'single_intent'],
  [/\b(back pain|lower back|low back pain)\b/, ['ros_back_pain'], 'single_intent'],
  [/\b(rash|skin rash|new spots)\b/, ['ros_rash'], 'single_intent'],
  [/\b(itch|itching|pruritus)\b/, ['ros_pruritus'], 'single_intent'],
  [/\b(bruising|bruise easily|bleeding easily|petechiae|purpura)\b/, ['ros_bruising'], 'single_intent'],

  [/\b(general symptoms|anything generally|fever weight tired appetite)\b/, ['ros_general'], 'single_intent'],
  [/\b(head and neck symptoms|head or neck problems)\b/, ['ros_head_neck'], 'single_intent'],
  [/\b(cardiovascular symptoms|heart symptoms|cardiac symptoms)\b/, ['ros_cardiovascular'], 'single_intent'],
  [/\b(respiratory symptoms|breathing symptoms|lung symptoms)\b/, ['ros_respiratory'], 'single_intent'],
  [/\b(gastrointestinal symptoms|gastrointestinal problems|digestive symptoms|digestive problems|digestive issues|stomach or bowel problems)\b/, ['ros_gastrointestinal'], 'single_intent'],
  [/\b(urinary symptoms|urination problems|problems with urination|genitourinary symptoms)\b/, ['ros_genitourinary'], 'single_intent'],
  [/\b(neurological symptoms|neurologic symptoms)\b/, ['ros_neurological'], 'single_intent'],
  [/\b(musculoskeletal symptoms|joint or muscle problems)\b/, ['ros_musculoskeletal'], 'single_intent'],
  [/\b(skin symptoms|skin problems)\b/, ['ros_skin'], 'single_intent'],

  [/\b(heart condition|heart disease|cardiac condition|cardiovascular disease|coronary disease|angina|previous mi|heart attack|heart problems?|cardiac problems?|stent|bypass|arrhythmia|heart failure)\b/, ['pmh_cardiovascular_disease'], 'single_intent'],
  [/\b(chronic diseases?|medical problems|previous diseases|past medical history|whats your medical history|in the past have you had any medical conditions|(?:any other|any serious) (?:diseases|illness(?:es)?)|long term (?:medical )?conditions|high blood pressure|hypertension|diabetes|cholesterol|kidney disease|thyroid|liver disease)\b/, ['pmh_chronic_diseases'], 'single_intent'],
  [/\b(specialist|cardiologist|diabetologist|endocrinologist|nephrologist|pulmonologist|gastroenterologist|neurologist|oncologist)\b/, ['pmh_specialists'], 'single_intent'],
  [/\b(any operation|operation history|any surgery|surgeries|were you operated)\b/, ['pmh_operations'], 'single_intent'],
  [/\b(hospitalized before|hospitalised before|been (?:in|to) (?:the )?hospital before|first visit to (?:our|the) hospital|(?:admitted|treated) (?:to|in) (?:a |the )?hospital befor(?:e)?|previous admission|hospitalisation|hospitalization)\b/, ['pmh_hospitalizations'], 'single_intent'],
  [/\b(anesthesia problem|anaesthesia problem|anaesthetic complication|anesthetic complication|difficult intubation|malignant hyperthermia|slow to wake)\b/, ['pmh_anesthesia_complications'], 'single_intent'],
  [/\b(open or laparoscopic|laparoscopic|open surgery|type of procedure)\b/, ['operation_approach'], 'contextual_followup'],
  [/\b(date of operation|what year was .*operation|when was .*operation|when was .*appendix removed)\b/, ['operation_date'], 'contextual_followup'],
  [/\b(ct scan|computed tomography|ecg|blood tests|ultrasound|mri|previous examination|previous scan)\b/, ['pmh_previous_exams'], 'single_intent'],
  [/\b(food allerg(?:y|ies)|environmental allerg(?:y|ies)|allergic to (?:any )?(?:foods?|latex)|latex allergy)\b/, ['allergy_environment_food'], 'contextual_followup'],
  [/\b(any allergies|allergies|are you allergic|drug allergy|latex allergy)\b/, ['allergies'], 'single_intent'],
  [/\b(what reaction|allergy reaction|what happens when)\b/, ['allergy_reaction'], 'contextual_followup'],
  [/\b(transfusion|blood transfusion|received blood)\b/, ['transfusions'], 'single_intent'],

  [/\b(nitroglycerin|nitroglycerine|\bntg\b|\bnitro\b|spray under tongue|tablet under tongue)\b/, ['medication_nitroglycerin_previous'], 'single_intent'],
  [/\b(over the counter|\botc\b|non prescription|unprescribed (?:medicine|medications?)|without (?:a )?prescription|any painkillers|tried painkillers)\b/, ['medication_otc'], 'single_intent'],
  [/\b(what medications|(?:do|are) you (?:take|taking|use|using) (?:any )?medications?|medicines|meds|pills|tablets|what are you on)\b/, ['medication_regular'], 'single_intent'],
  [/\b(what dose|what dosage|how many mg|what strength|dose of)\b/, ['medication_dose'], 'single_intent'],
  [/\b(how often do you take|medication frequency|once daily|twice daily)\b/, ['medication_frequency'], 'single_intent'],
  [/\b(what is .* medication for|why do you take|what do you take .* for|indication)\b/, ['medication_indication'], 'single_intent'],
  [/\b(recent medication change|new medication|changed dose|stopped medication|started medication)\b/, ['medication_recent_changes'], 'single_intent'],
  [/\b(supplements|vitamins|herbal|herbs)\b/, ['medication_supplements'], 'single_intent'],
  [/\b(forget|adherence|take them regularly|took today|miss doses|missed dose)\b/, ['medication_adherence'], 'single_intent'],


  [/\b(travel(?:l?ed|l?ing)?|abroad|recent trip|visited any countries)\b/, ['epi_travel'], 'single_intent'],
  [/\b(sick contact|infectious contact|anyone ill|contact with infection)\b/, ['epi_contacts'], 'single_intent'],
  [/\b(pets|farm animals|animal exposure|tick bite|tick|animal bite|animal scratch)\b/, ['epi_animals_ticks'], 'single_intent'],
  [/\b(vaccination|vaccinated|suspicious food|unsafe water|food poisoning)\b/, ['epi_vaccination_food'], 'single_intent'],

  [/\b(do you work|occupation|job|retired|unemployed|employment status|(?:where|what) do you study|what (?:school|university) (?:are you studying|you study))\b/, ['identity_occupation'], 'single_intent'],
  [/\b(who do you live with|live alone|live with (?:your|family)|partner|children at home)\b/, ['social_household'], 'single_intent'],
  [/\b(house or apartment|house or flat|housing|which floor|stairs|elevator|lift at home)\b/, ['social_housing'], 'single_intent'],
  [/\b(who helps you|support at home|carer|caregiver|home nurse)\b/, ['social_support'], 'single_intent'],
  [/\b(usual function|baseline function|before this illness|normally independent|normally walk)\b/, ['social_baseline_function'], 'single_intent'],
  [/\b(current function|now manage|now walk|since this illness|currently independent|current mobility|how is your mobility|can you walk|(?:affect|effect) your daily life|mobility aids)\b/, ['social_current_function'], 'single_intent'],

  [/\b(last period|last menstrual|\blmp\b|periods regular|menstruation|menopause)\b/, ['gyn_lmp'], 'single_intent'],
  [/\b(could you be pregnant|possibly pregnant|pregnancy possibility|are you pregnant)\b/, ['gyn_pregnancy'], 'single_intent'],
  [/\b(contraception|birth control|contraceptive|iud|coil)\b/, ['gyn_contraception'], 'single_intent'],
  [/\b(previous pregnancies|deliveries|miscarriage|abortion|c section|caesarean|children.*pregnan)\b/, ['gyn_obstetric'], 'single_intent'],

  [/\b(how many cigarettes|cigarettes per day|cigarettes a day|years.*smok|pack years|how much do you smoke)\b/, ['substance_smoking_quantity'], 'single_intent'],
  [/\b(do you smoke|smoking|cigarettes|tobacco|vape|vaping)\b/, ['substance_smoking'], 'single_intent'],
  [/\b(alcohol|drink alcohol|beer|wine|spirits)\b/, ['substance_alcohol'], 'single_intent'],
  [/\b(coffee|black tea|energy drinks|caffeine)\b/, ['substance_caffeine'], 'single_intent'],
  [/\b(recreational drugs|street drugs|illegal (?:drugs|substances)|marijuana|cannabis|cocaine|drug use|(?:do|did|have) you (?:ever )?(?:use|used) (?:any )?drugs)\b/, ['substance_drugs'], 'single_intent'],

  [/\b(anything else|anything i have missed|anything important i should know|something else)\b/, ['closure_anything_else'], 'single_intent'],
  [/\b(what worries you most|what are you worried about|main concern|concerns about this)\b/, ['closure_concerns'], 'single_intent'],
  [/\b(any questions for me|do you understand|does that make sense|anything you want me to clarify)\b/, ['closure_understanding'], 'single_intent'],

  [/\b(blood pressure|\bbp\b)\b/, ['vital_bp'], 'objective_exam_request'],
  [/\b(heart rate|pulse|\bhr\b)\b/, ['vital_hr'], 'objective_exam_request'],
  [/\b(respiratory rate|\brr\b)\b/, ['vital_rr'], 'objective_exam_request'],
  [/\b(oxygen saturation|spo2|saturation)\b/, ['vital_spo2'], 'objective_exam_request'],
  [/\b(temperature)\b/, ['vital_temperature'], 'objective_exam_request'],
  [/\b(lungs|crackles|breath sounds|auscultation lungs)\b/, ['exam_lungs'], 'objective_exam_request'],
  [/\b(heart sounds|murmur|auscultation heart)\b/, ['exam_heart'], 'objective_exam_request'],
  [/\b(abdominal exam|guarding|blumberg|murphy|mcburney|rovsing)\b/, ['exam_abdomen'], 'objective_exam_request'],
  [/\b(bowel sounds)\b/, ['exam_bowel_sounds'], 'objective_exam_request'],
  [/\b(wbc|white blood cells)\b/, ['lab_wbc'], 'objective_exam_request'],
  [/\b(crp)\b/, ['lab_crp'], 'objective_exam_request'],
  [/\b(creatinine)\b/, ['lab_creatinine'], 'objective_exam_request'],
  [/\b(potassium)\b/, ['lab_potassium'], 'objective_exam_request'],
  [/\b(glucose|blood sugar)\b/, ['lab_glucose'], 'objective_exam_request'],
  [/\b(tsh)\b/, ['lab_tsh'], 'objective_exam_request']
];

export class PatientEngine {
  constructor(patientCase, options = {}) { this.options = options; this.loadCase(patientCase); }

  exportState() {
    return {
      askedIntents: [...this.askedIntents],
      attemptedIntents: [...this.attemptedIntents],
      attemptEvents: structuredCopy(this.attemptEvents),
      communicationEvents: structuredCopy(this.communicationEvents),
      transcript: structuredCopy(this.transcript),
      debugTurns: structuredCopy(this.debugTurns),
      terminologyEvents: structuredCopy(this.terminologyEvents),
      lastIntent: this.lastIntent,
      lastClinicalQuestion: this.lastClinicalQuestion,
      lastMeaningfulIntent: this.lastMeaningfulIntent,
      lastMeaningfulDomain: this.lastMeaningfulDomain,
      currentSymptom: this.currentSymptom,
      lastQuestionType: this.lastQuestionType,
      lastRequestedAttribute: this.lastRequestedAttribute,
      activeMedication: this.activeMedication,
      rescueState: structuredCopy(this.rescueState),
      lastContextResolutionReason: this.lastContextResolutionReason,
      lastDetection: structuredCopy(this.lastDetection),
      pendingClarification: structuredCopy(this.pendingClarification),
      rapport: this.rapport,
      rapportEvents: structuredCopy(this.rapportEvents),
      lastRapportEvent: structuredCopy(this.lastRapportEvent),
      turn: this.turn,
      disclosureAttempts: Object.fromEntries(this.disclosureAttempts ?? new Map())
    };
  }

  restoreState(state = {}) {
    if (!state || typeof state !== 'object') return this;
    this.askedIntents = new Set(Array.isArray(state.askedIntents) ? state.askedIntents : []);
    this.attemptedIntents = new Set(Array.isArray(state.attemptedIntents) ? state.attemptedIntents : []);
    this.attemptEvents = structuredCopy(Array.isArray(state.attemptEvents) ? state.attemptEvents : []);
    this.communicationEvents = structuredCopy(Array.isArray(state.communicationEvents) ? state.communicationEvents : []);
    this.transcript = structuredCopy(Array.isArray(state.transcript) ? state.transcript : []);
    this.debugTurns = structuredCopy(Array.isArray(state.debugTurns) ? state.debugTurns : []);
    this.terminologyEvents = structuredCopy(Array.isArray(state.terminologyEvents) ? state.terminologyEvents : []);
    this.lastIntent = state.lastIntent || null;
    this.lastClinicalQuestion = String(state.lastClinicalQuestion || state.lastDetection?.normalized || '');
    this.lastMeaningfulIntent = state.lastMeaningfulIntent || null;
    this.lastMeaningfulDomain = state.lastMeaningfulDomain || null;
    this.currentSymptom = !state.currentSymptom || state.currentSymptom.name ? state.currentSymptom ?? null :
      this.symptomForIntent(this.lastMeaningfulIntent ?? '');
    this.lastQuestionType = state.lastQuestionType || null;
    this.lastRequestedAttribute = state.lastRequestedAttribute || null;
    this.activeMedication = state.activeMedication || null;
    this.rescueState = structuredCopy(state.rescueState) ?? { count: 0, disabled: false, attempted: [], accepted: [] };
    this.lastContextResolutionReason = String(state.lastContextResolutionReason || '');
    this.lastDetection = structuredCopy(state.lastDetection || null);
    this.pendingClarification = structuredCopy(state.pendingClarification || null);
    this.rapport = Number.isFinite(Number(state.rapport)) ? Number(state.rapport) : (this.case.personality?.baselineRapport ?? 70);
    this.rapportEvents = structuredCopy(Array.isArray(state.rapportEvents) ? state.rapportEvents : []);
    this.lastRapportEvent = structuredCopy(state.lastRapportEvent || null);
    this.turn = Math.max(0, Number(state.turn || 0));
    this.disclosureAttempts = new Map(Object.entries(state.disclosureAttempts || {}).map(([key, value]) => [key, Number(value || 0)]));
    return this;
  }

  loadCase(patientCase) {
    this.case = patientCase;
    this.askedIntents = new Set();
    this.attemptedIntents = new Set();
    this.attemptEvents = [];
    this.communicationEvents = [];
    this.transcript = [];
    this.debugTurns = [];
    this.terminologyEvents = [];
    this.lastIntent = null;
    this.lastClinicalQuestion = '';
    this.lastMeaningfulIntent = null;
    this.lastMeaningfulDomain = null;
    this.currentSymptom = null;
    this.lastQuestionType = null;
    this.lastRequestedAttribute = null;
    this.activeMedication = null;
    this.rescueState = { count: 0, disabled: false, attempted: [], accepted: [] };
    this.lastContextResolutionReason = '';
    this.lastDetection = null;
    this.pendingClarification = null;
    this.rapport = patientCase.personality?.baselineRapport ?? 70;
    this.rapportEvents = [];
    this.lastRapportEvent = null;
    this.turn = 0;
    this.disclosureAttempts = new Map();
    return '';
  }

  ask(question, detectionOverride = null) {
    this.turn += 1;
    let detection = detectionOverride || this.detect(question);
    const recognizedIntents = [...new Set((detection.answerIntents ?? []).map(item => item.id))];
    const explicitClauses = detection.parts;
    const parts = explicitClauses ?? (detection.answerIntents.length > 1
      ? detection.answerIntents.map(candidate => ({ ...detection, primaryIntent: candidate, answerIntents: [candidate] }))
      : [detection]);
    const evaluatedParts = parts.map(part => this.applyDisclosurePolicy(question, part));
    detection = evaluatedParts.length === 1 ? evaluatedParts[0] : { ...detection, parts: evaluatedParts };
    const rapportEvent = this.updateRapport(question, detection);
    const inferredAttempts = explicitClauses
      ? [...new Set(parts.flatMap(part => this.inferAttemptedIntents(part.normalized, part)))]
      : this.inferAttemptedIntents(question, detection);
    const { reply, answers } = this.composeReply(detection);
    const answered = answers.filter(answer => answer.status === 'answered');
    const creditedIds = answered.flatMap(answer => answer.creditedIntentIds ?? []);
    const attemptedIntentIds = [...new Set([...inferredAttempts, ...creditedIds])];
    const answeredIds = [...new Set([...answered.map(answer => answer.intent), ...creditedIds])];
    const previouslyAttempted = new Set(this.attemptedIntents);
    const previouslyResolved = new Set(this.askedIntents);
    attemptedIntentIds.forEach(intentId => this.attemptedIntents.add(intentId));
    const communicationAssessment = this.assessCommunication(question, detection, attemptedIntentIds, previouslyAttempted, previouslyResolved);
    const feedbackLabel = this.makeFeedbackLabel(detection, communicationAssessment);

    this.pushStudent(question, detection.primaryIntent?.id ?? 'unknown', feedbackLabel);
    this.pushPatient(reply, detection.primaryIntent?.id ?? 'unknown');
    this.lastDetection = detection;
    this.lastQuestionType = detection.questionType;
    this.lastContextResolutionReason = detection.contextResolutionReason;
    for (const id of answeredIds) this.askedIntents.add(id);
    const nextContext = this.conversationContext();
    for (const part of evaluatedParts) {
      this.advanceConversationContext(nextContext, part);
      if (part.primaryIntent || (part.responseScope === 'clarification' && !part.analysis?.correction)) {
        this.lastClinicalQuestion = part.analysis?.correctedQuestion ?? part.normalized;
      }
    }
    this.lastIntent = this.lastMeaningfulIntent = nextContext.lastIntent;
    this.lastMeaningfulDomain = nextContext.lastDomain;
    this.activeMedication = nextContext.activeMedication;
    this.currentSymptom = nextContext.activeSymptom;
    this.lastRequestedAttribute = nextContext.lastAttribute;
    const unresolved = evaluatedParts.find(part => part.responseScope === 'clarification' && !part.analysis?.correction);
    if (unresolved) {
      this.pendingClarification = {
        question: unresolved.normalized, createdAtTurn: this.turn,
        candidates: unresolved.candidates.slice(0, 5)
      };
    } else if (!evaluatedParts.every(part => part.socialAct)) {
      this.pendingClarification = null;
    }
    attemptedIntentIds.forEach((intentId) => {
      const answer = answers.find(item => item.intent === intentId || item.creditedIntentIds?.includes(intentId));
      this.attemptEvents.push({
        turnNumber: this.turn,
        intentId,
        question,
        recognized: recognizedIntents.includes(intentId) || creditedIds.includes(intentId),
        outcome: answer?.status ?? 'unresolved',
        reason: answer?.reason ?? null,
        resolved: answeredIds.includes(intentId),
        engineIntentIds: recognizedIntents,
        responseScope: detection.responseScope,
        matchKind: detection.kind,
        previouslyAttempted: previouslyAttempted.has(intentId),
        previouslyResolved: previouslyResolved.has(intentId)
      });
    });
    this.communicationEvents.push({ turnNumber: this.turn, question, ...communicationAssessment });
    if (detection.terminologyEvent) this.terminologyEvents.push(detection.terminologyEvent);
    this.debugTurns.push({
      ...this.makeDebugTurn(question, detection, reply, feedbackLabel, attemptedIntentIds, communicationAssessment, creditedIds),
      confidence: detection.confidence, recognizedIntents, answeredIds,
      interpretations: evaluatedParts.map(part => ({
        ...part.analysis, question: part.normalized, intent: part.primaryIntent?.id ?? null,
        confidence: part.confidence,
        contextUsed: part.contextUsed, contextReason: part.contextResolutionReason
      })),
      answers
    });

    return { reply, turnNumber: this.turn, answeredIds, recognizedIntents, detectedIntent: detection.primaryIntent?.id ?? 'unknown', confidence: detection.confidence, detection, coverage: this.getCoverage(), rapport: this.rapport, rapportEvent, feedbackLabel, terminologySuggestion: detection.terminologyEvent?.suggestedPatientFriendlyQuestion ?? '' };
  }

  detectionForResolvedIntent(question, intentId, reason, confidence, analysis) {
    const candidate = this.toCandidate(intentId, 5, ['ai-helper']);
    if (!candidate) return null;
    const normalized = normalize(question);
    return this.makeDetection({
      kind: 'ai_resolved',
      responseScope: INTENTS[intentId]?.domain === 'objective' ? 'objective_exam_request' : 'contextual_followup',
      normalized,
      tokens: tokenize(normalized),
      phrases: makeNgrams(tokenize(normalized), 4),
      primaryIntent: candidate,
      answerIntents: [candidate],
      candidates: [candidate],
      confidence,
      analysis,
      contextUsed: false,
      contextResolutionReason: reason
    });
  }

  conversationContext() {
    return {
      activeSymptom: this.currentSymptom,
      activeMedication: this.activeMedication,
      lastAttribute: this.lastRequestedAttribute,
      lastIntent: this.lastMeaningfulIntent,
      lastDomain: this.lastMeaningfulDomain
    };
  }

  detect(question) {
    const clauses = QUESTION_BY_PHRASE.has(questionKey(question)) ? [question] : splitQuestions(question);
    const context = this.conversationContext();
    const parts = clauses.map(clause => {
      const part = {
        ...this.detectClause(clause, context),
        questionType: this.classifyQuestionType(normalize(clause), clause)
      };
      this.advanceConversationContext(context, part);
      return part;
    });
    if (parts.length === 1) return parts[0];
    const resolved = parts.find(part => part.primaryIntent && part.responseScope !== 'terminology_not_understood');
    const primary = resolved ?? parts[0];
    return this.makeDetection({
      ...primary,
      normalized: normalize(question),
      kind: 'compound',
      responseScope: 'multi_intent_explicit',
      answerIntents: [...new Map(parts.flatMap(part => part.answerIntents).map(intent => [intent.id, intent])).values()],
      parts
    });
  }

  advanceConversationContext(context, part) {
    const intent = part.primaryIntent?.id;
    if (!intent || part.responseScope === 'terminology_not_understood') return;
    const domain = INTENTS[intent].domain;
    context.activeSymptom = part.analysis?.subject ?? symptomSubject(this.case, intent, part.normalized);
    context.activeMedication = domain === 'medication'
      ? part.analysis?.target?.medication ?? medicationSubjectName(this.case, part.normalized) ??
        (part.contextUsed ? context.activeMedication : null)
      : null;
    context.lastIntent = intent;
    context.lastDomain = domain;
    context.lastAttribute = part.analysis?.attribute ?? 'overview';
  }

  detectCorrection(normalized, context) {
    const correction = normalized.match(/^(?:no )?(?:i meant|i mean|what i meant was) (.+)$/);
    const choice = /^(?:(?:the )?(?:medicines|medications|recreational drugs)|(?:when )?it started|how long it lasts|family medical history|who you live with)$/.test(normalized) ? normalized : null;
    if (!correction && !choice) return null;
    const previous = this.pendingClarification?.question || this.lastClinicalQuestion;
    if (!previous) return null;
    const referent = correction?.[1] ?? choice;
    if (ambiguousFamilyQuestion.test(previous) && /^(?:family (?:medical )?history|who you live with)$/.test(referent)) {
      return this.focusedDetection(normalized, referent === 'who you live with' ? 'social_household' : 'family_history',
        { attribute: 'overview', correction: true, correctedQuestion: previous });
    }
    if (context.activeSymptom && ambiguousDurationQuestion.test(previous) && /^(?:(?:when )?it started|how long it lasts)$/.test(referent)) {
      const onset = referent.endsWith('started');
      const subject = context.activeSymptom;
      return this.focusedDetection(normalized, subject.primary ? (onset ? 'hpi_onset' : 'hpi_timing') : subject.intent,
        { subject, attribute: onset ? 'onset.time' : 'timing.duration', correction: true, correctedQuestion: previous });
    }
    const subjects = explicitSymptoms(this.case, referent);
    const subject = subjects.length === 1 ? subjects[0] : null;
    const previousAnalysis = analyzeQuestion(previous, this.case, context);
    if (subject && previousAnalysis.symptomIntent) {
      const intent = subject.primary ? previousAnalysis.symptomIntent : subject.intent;
      return this.focusedDetection(normalized, intent, {
        ...previousAnalysis, subject, target: null, correction: true, correctedQuestion: previous
      });
    }
    if (/\b(?:drugs|substances)\b/.test(previous) && /^(?:the )?(?:medicines|medications|recreational drugs)$/.test(referent)) {
      return this.focusedDetection(normalized, referent.endsWith('recreational drugs') ? 'substance_drugs' : 'medication_regular',
        { attribute: 'overview', correction: true, correctedQuestion: previous });
    }
    const medicine = medicationSubjectName(this.case, referent);
    if (medicine && context.lastDomain === 'medication') {
      const match = previousAnalysis.attribute?.match(/^medication\.(dose|frequency|indication)$/);
      const attribute = match?.[1] ?? context.lastIntent?.match(/^medication_(dose|frequency|indication)$/)?.[1];
      if (attribute) return this.focusedDetection(normalized, `medication_${attribute}`, {
        attribute: `medication.${attribute}`, target: { medication: medicine }, correction: true, correctedQuestion: previous
      });
    }
    return null;
  }

  focusedDetection(normalized, intent, analysis) {
    const candidate = this.toCandidate(intent, 6, ['conversation-subject']);
    return this.makeDetection({
      kind: 'direct', responseScope: 'contextual_followup', normalized, contextUsed: true,
      primaryIntent: candidate, answerIntents: [candidate],
      analysis: { ...analysis, intent }, contextResolutionReason: 'Resolved to the current conversation subject.'
    });
  }

  detectClause(question, context) {
    const normalized = normalize(question);
    const correction = this.detectCorrection(normalized, context);
    if (correction) return correction;
    const analysis = analyzeQuestion(normalized, this.case, context);
    const detection = this.detectLegacy(question, context);
    const temporalRole = analysis.temporalCue?.role;
    if ((temporalRole === 'event_relative' || temporalRole === 'one_off_medication') &&
        (medicationSubject.test(normalized) || /\bdose\b/.test(normalized) || medicationSubjectName(this.case, normalized) ||
          (context.lastDomain === 'medication' && /\b(?:it|them)\b/.test(normalized)))) {
      const intent = temporalRole === 'event_relative' ? 'hpi_onset' : 'medication_adherence';
      return this.focusedDetection(normalized, intent, { ...analysis,
        attribute: temporalRole === 'event_relative' ? 'onset.medication_relation' : 'medication.specific_timing',
        target: null });
    }
    if (detection.primaryIntent?.reasons.includes('conversation-subject')) return detection;
    if (detection.primaryIntent?.reasons.includes('question-bank') ||
        ['ros_bowel_frequency', 'gyn_last_visit', 'hpi_previous_episodes', 'administrative_arrival_method'].includes(detection.primaryIntent?.id)) {
      return { ...detection, analysis: { ...analysis, intent: detection.primaryIntent.id, attribute: 'overview', target: null } };
    }
    if (detection.socialAct) return detection;
    if (FOLLOWUP_BY_PHRASE.has(questionKey(normalized))) return { ...detection, analysis };
    if (detection.responseScope === 'terminology_not_understood') return { ...detection, analysis };
    if (detection.responseScope === 'clarification' && !analysis.symptomIntent &&
        /^(?:do|did|are|have) you\b/.test(normalized)) {
      const subjects = explicitSymptoms(this.case, normalized);
      const subject = subjects.length === 1 ? subjects[0] : null;
      if (subject?.primary === false && this.case.subjectAliases?.[subject.intent] && INTENTS[subject.intent]?.domain === 'ros') {
        return this.focusedDetection(normalized, subject.intent, { ...analysis, subject, attribute: 'overview', target: null });
      }
    }
    if (['chart_details', 'station_context', 'audio_check'].includes(detection.responseScope)) return detection;

    const specialty = normalized.match(SPECIALTY)?.[0];
    if (FAMILY_MEMBER.test(normalized) && FAMILY_HEART.test(normalized) &&
        !/\b(?:genetic|inherited|sudden unexplained death)\b/.test(normalized)) {
      return this.scopedHistoryDetection(detection, 'family_cardiovascular');
    }
    if (CARE_VISIT.test(normalized) && (specialty || REGULAR_CARE.test(normalized)) && !FAMILY_MEMBER.test(normalized)) {
      // A named specialty needs a documented answer about that specialty.
      const hasSpecialtyAnswer = specialty && retrieveFacts(this.case, 'pmh_specialists')
        .some(fact => new RegExp(`\\b${specialty}s?\\b`, 'i').test(realizeEnglish(fact)?.text ?? ''));
      return this.scopedHistoryDetection(detection, 'pmh_specialists',
        specialty && !hasSpecialtyAnswer ? 'specialists.named' : 'overview');
    }
    if (/^(?:do|have|are) you\b.*\b(?:take|taking|use|using|on)\b/.test(normalized) &&
        medicationSubject.test(normalized) && /\b(?:for|to (?:treat|manage|control))\b.*\bchronic\b/.test(normalized)) {
      return this.scopedHistoryDetection(detection, 'medication_indication');
    }
    if (/\b(?:have|did) you (?:ever |recently )?travel(?:l?ed|l?ing)?\b/.test(normalized)) {
      return this.scopedHistoryDetection(detection, 'epi_travel');
    }
    if (DIET_DETAIL.test(normalized) && !/\b(?:why|when|did)\b/.test(normalized)) {
      return this.scopedHistoryDetection(detection, 'intake_diet', 'diet.restrictions');
    }
    const scoped = SCOPED_QUESTIONS.find(([topic, wording]) => topic.test(normalized) && wording.test(normalized));
    if (scoped) return this.makeDetection({ ...detection, kind: 'direct', responseScope: 'unavailable_detail',
      primaryIntent: null, answerIntents: [], candidates: [], analysis: { unavailableReply: scoped[2] } });
    if (analysis.symptomIntent && !analysis.explicitOtherTopic && !analysis.intent?.startsWith('medication_')) {
      const explicit = explicitSymptoms(this.case, normalized);
      if (explicit.length > 1) {
        return this.makeDetection({
          ...detection, kind: 'uncertain', responseScope: 'clarification', primaryIntent: null,
          answerIntents: [], confidence: 0,
          analysis: { ...analysis, unresolvedReference: true, choices: explicit.map(subject => subject.name) }
        });
      }
      const referenced = /\b(?:it|that|this|the pain|the symptom)\b/.test(normalized) ? context.activeSymptom : null;
      const subject = explicit[0] ?? referenced;
      if (subject?.primary === false) {
        return this.focusedDetection(normalized, subject.intent, { ...analysis, subject, target: null });
      }
    }
    if (analysis.intent && INTENTS[analysis.intent]) {
      const candidate = this.toCandidate(analysis.intent, 6, ['attribute-rule']);
      return this.makeDetection({
        ...detection, analysis, kind: 'direct', candidates: [candidate],
        confidence: analysis.contextUsed ? 0.86 : 0.94,
        responseScope: analysis.contextUsed ? 'contextual_followup' : 'single_intent',
        primaryIntent: candidate, answerIntents: [candidate], contextUsed: analysis.contextUsed,
        contextResolutionReason: analysis.contextUsed ? 'Question facet resolved against the active symptom or medication.' : ''
      });
    }
    if ((analysis.unresolvedReference || analysis.differentSymptom || analysis.explicitOtherTopic) &&
        detection.primaryIntent?.id.startsWith('hpi_')) {
      return this.makeDetection({ ...detection, analysis, kind: 'uncertain',
        responseScope: 'clarification', primaryIntent: null, answerIntents: [], confidence: 0 });
    }
    return { ...detection, analysis: { ...analysis, attribute: 'overview' } };
  }

  scopedHistoryDetection(detection, intent, attribute = 'overview') {
    const candidate = this.toCandidate(intent, 6, ['explicit-subject']);
    return this.makeDetection({ ...detection, kind: 'direct', responseScope: 'single_intent',
      primaryIntent: candidate, answerIntents: [candidate], candidates: [candidate],
      confidence: 0.94, contextUsed: false, analysis: { intent, attribute } });
  }

  detectLegacy(question, context) {
    const normalized = normalize(question);
    const tokens = tokenize(normalized);
    const phrases = makeNgrams(tokens, 4);
    const questionType = this.classifyQuestionType(normalized, question);

    if (/^(?:do you know )?(?:where (?:are you|you are)(?: right now)?|what (?:is )?(?:the date|day|date is|day is)(?: today)?|what is todays date|whats the time)$/.test(normalized)) {
      return this.makeDetection({ kind: 'direct', responseScope: 'station_context', normalized, tokens, phrases, questionType });
    }
    if (/^(?:and )?can you hear me(?: right| clearly)?$/.test(normalized)) {
      return this.makeDetection({ kind: 'direct', responseScope: 'audio_check', normalized, tokens, phrases, questionType });
    }
    if (CHART_DETAILS.test(normalized)) return this.makeDetection({ kind: 'direct', responseScope: 'chart_details', normalized, tokens, phrases, questionType });
    const addressed = normalized.match(/^(?:hi|hello|hey|good morning|good afternoon) (.+)$/)?.[1];
    const name = normalize(this.case.identity?.name);
    const socialAct = addressed && name && (addressed === name || addressed === name.split(' ')[0]) ?
      'greeting' : getSocialAct(normalized);
    if (socialAct) return this.makeDetection({ kind: 'direct', responseScope: 'social', socialAct, normalized, tokens, phrases, questionType });
    if (ambiguousDrugQuestion.test(normalized)) {
      const intent = context.lastDomain === 'medication' ? 'medication_regular' :
        context.lastIntent === 'substance_drugs' ? 'substance_drugs' : null;
      if (intent) return this.focusedDetection(normalized, intent, { attribute: 'overview' });
      return this.makeDetection({ kind: 'uncertain', responseScope: 'clarification', normalized, tokens, phrases, questionType });
    }
    if (ambiguousFamilyQuestion.test(normalized) || ambiguousDurationQuestion.test(normalized)) {
      return this.makeDetection({ kind: 'uncertain', responseScope: 'clarification', normalized, tokens, phrases, questionType });
    }
    if (!normalized) return this.makeDetection({ kind: normalized ? 'uncertain' : 'empty', responseScope: 'clarification', normalized, tokens, phrases, questionType });

    const term = this.detectMedicalTerminology(tokens);
    if (term && !term.patientUnderstood) {
      return this.makeDetection({ kind: 'terminology', responseScope: 'terminology_not_understood', normalized, tokens, phrases, primaryIntent: this.toCandidate(term.intent, 5, ['medical-term']), answerIntents: [], terminologyEvent: term });
    }

    const key = questionKey(normalized);
    const followup = FOLLOWUP_BY_PHRASE.get(key);
    const contextUsed = followup?.after.includes(context.lastIntent) ?? false;
    const bankIntent = QUESTION_BY_PHRASE.get(key) ?? (contextUsed ? followup.intent : null);
    if (bankIntent) {
      const candidate = this.toCandidate(bankIntent, 6, ['question-bank']);
      const scope = contextUsed ? 'contextual_followup' : bankIntent === 'chief_complaint' ? 'broad_open_history' : 'single_intent';
      return this.makeDetection({
        kind: 'direct', responseScope: scope, normalized, tokens, phrases, questionType,
        primaryIntent: candidate, answerIntents: [candidate], contextUsed,
        contextResolutionReason: contextUsed ? 'Follow-up linked to the preceding interview topic.' : ''
      });
    }
    if (followup) {
      return this.makeDetection({ kind: 'uncertain', responseScope: 'clarification', normalized, tokens, phrases, questionType });
    }

    const explicit = this.detectExplicitMultiIntent(normalized, tokens);
    if (explicit.length > 1) {
      return this.makeDetection({ kind: 'direct', responseScope: 'multi_intent_explicit', normalized, tokens, phrases, primaryIntent: explicit[0], answerIntents: explicit, candidates: explicit });
    }

    const direct = this.detectDirectIntent(normalized, tokens, context);
    if (direct) {
      return this.makeDetection({ kind: 'direct', responseScope: direct.scope, normalized, tokens, phrases, primaryIntent: direct.candidates[0], answerIntents: direct.scope === 'broad_open_history' ? [direct.candidates[0]] : direct.candidates, candidates: direct.candidates, contextUsed: direct.contextUsed, contextResolutionReason: direct.contextResolutionReason });
    }

    const needed = new Set(this.nextNeededIntents());
    const candidates = Object.entries(INTENTS).map(([id, intent]) => this.scoreCandidate(id, intent, normalized, tokens, phrases, needed)).sort((a, b) => b.score - a.score);
    const suppressed = this.applySuppression(candidates, normalized, tokens);
    const usable = candidates.filter((c) => c.score > 0.18 && !suppressed.find((s) => s.intentId === c.id));
    const top = usable[0];
    const second = usable[1];
    const confidence = calculateConfidence(top?.score ?? 0, second?.score ?? 0, normalized.length);
    const difficulty = this.difficulty;
    const strongThreshold = difficulty === 'beginner' ? MATCH_THRESHOLD - 0.04 : difficulty === 'advanced' ? MATCH_THRESHOLD + 0.035 : MATCH_THRESHOLD;
    const weakThreshold = difficulty === 'beginner' ? WEAK_MATCH_THRESHOLD - 0.03 : difficulty === 'advanced' ? WEAK_MATCH_THRESHOLD + 0.025 : WEAK_MATCH_THRESHOLD;
    const topStrong = difficulty === 'beginner' ? MIN_TOP_SCORE_FOR_MATCH - 0.20 : difficulty === 'advanced' ? MIN_TOP_SCORE_FOR_MATCH + 0.20 : MIN_TOP_SCORE_FOR_MATCH;
    const topWeak = difficulty === 'beginner' ? MIN_TOP_SCORE_FOR_WEAK_MATCH - 0.15 : difficulty === 'advanced' ? MIN_TOP_SCORE_FOR_WEAK_MATCH + 0.15 : MIN_TOP_SCORE_FOR_WEAK_MATCH;
    const strong = confidence >= strongThreshold || (top?.score ?? 0) >= topStrong;
    const weak = confidence >= weakThreshold || (top?.score ?? 0) >= topWeak;
    if (strong || weak) {
      const scope = this.classifyResponseScope(normalized, tokens, [top], strong ? 'strong' : 'weak_answered');
      const answers = scope === 'single_intent' || scope === 'contextual_followup' || scope === 'objective_exam_request' ? [top] : this.selectMultipleIntents(usable, normalized, tokens);
      return this.makeDetection({ kind: strong ? 'matched' : 'weak_answered', responseScope: scope, normalized, tokens, phrases, primaryIntent: top, answerIntents: answers.length ? answers : [top], candidates: usable.slice(0, 5), suppressedCandidates: suppressed, confidence });
    }

    return this.makeDetection({ kind: 'uncertain', responseScope: 'clarification', normalized, tokens, phrases, primaryIntent: null, answerIntents: [], candidates: candidates.slice(0, 5), suppressedCandidates: suppressed, confidence });
  }

  get difficulty() {
    return String(this.options?.difficulty || 'intermediate').toLowerCase();
  }

  applyDisclosurePolicy(question, detection) {
    if (!detection?.primaryIntent?.id || this.difficulty !== 'advanced') return detection;
    const intentId = detection.primaryIntent.id;
    const intent = INTENTS[intentId];
    if (!intent?.sensitive) return detection;
    const guardedness = Number(this.case.personality?.guardedness ?? 0);
    if (guardedness < 0.2 || this.rapport >= 72) return detection;
    const q = normalize(question);
    const permission = PERMISSION_TERMS.some((term) => q.includes(term));
    const previous = Number(this.disclosureAttempts.get(intentId) || 0);
    this.disclosureAttempts.set(intentId, previous + 1);
    if (permission || previous >= 1) return detection;
    return this.makeDetection({
      ...detection,
      kind: 'guarded',
      responseScope: 'guarded_withholding',
      primaryIntent: detection.primaryIntent,
      answerIntents: [],
      candidates: detection.candidates,
      confidence: detection.confidence,
      normalized: detection.normalized,
      tokens: detection.tokens,
      phrases: detection.phrases,
      questionType: detection.questionType,
      contextUsed: detection.contextUsed,
      contextResolutionReason: 'Advanced-mode guarded patient: ask respectfully or establish rapport before disclosure.'
    });
  }

  guardedReply() {
    const options = [
      'I would rather not get into that straight away. Why do you need to know?',
      'That is a bit personal. Could you explain why you are asking?',
      'I am not very comfortable talking about that yet.'
    ];
    return options[this.turn % options.length];
  }

  inferAttemptedIntents(question, detection) {
    if (detection?.socialAct || detection?.responseScope === 'unavailable_detail' || detection?.analysis?.choices?.length) return [];
    const normalized = normalize(question);
    const detectedIds = [...new Set((detection?.answerIntents ?? []).map(intent => intent.id).filter(id => INTENTS[id]))];
    // A scoped facet or explicit family/medication question is stronger
    // evidence than words it happens to share with other rubric items.
    if (detectedIds.length && (detection.analysis?.intent ||
        detectedIds.every(id => INTENTS[id].domain === 'family') ||
        (medicationSubject.test(normalized) && detectedIds.every(id => INTENTS[id].domain === 'medication')))) {
      return detectedIds;
    }
    const explicitAttempts = ATTEMPT_RULES
      .filter(([, pattern]) => pattern.test(normalized))
      .map(([intentId]) => intentId)
      .filter((intentId, index, list) => INTENTS[intentId] && list.indexOf(intentId) === index);

    if (explicitAttempts.length) {
      const legacyOverview = new Set(['family_history','epidemiology','social_living','daily_independence','gyn_history','ros_general','ros_head_neck','ros_cardiovascular','ros_respiratory','ros_gastrointestinal','ros_genitourinary','ros_neurological','ros_musculoskeletal','ros_skin']);
      if (detectedIds.length && explicitAttempts.every((intentId) => legacyOverview.has(intentId) || !detectedIds.includes(intentId))) return detectedIds.slice(0, 3);
      const hpiAttempts = explicitAttempts.filter((intentId) => intentId.startsWith('hpi_'));
      if (hpiAttempts.length) return hpiAttempts.slice(0, 2);
      return explicitAttempts.slice(0, 3);
    }

    if (detection?.responseScope === 'terminology_not_understood' && detection.primaryIntent?.id) {
      return [detection.primaryIntent.id];
    }

    return detectedIds;
  }

  makeDetection(data) {
    return {
      kind: data.kind ?? 'matched', responseScope: data.responseScope ?? 'single_intent',
      primaryIntent: data.primaryIntent ?? null, bestIntent: data.primaryIntent ?? null,
      answerIntents: data.answerIntents ?? [], confidence: data.confidence ?? (data.primaryIntent ? 1 : 0),
      candidates: data.candidates ?? (data.primaryIntent ? [data.primaryIntent] : []),
      suppressedCandidates: data.suppressedCandidates ?? [], normalized: data.normalized ?? '',
      tokens: data.tokens ?? [], phrases: data.phrases ?? [], directMappingUsed: data.kind === 'direct',
      contextUsed: Boolean(data.contextUsed), terminologyEvent: data.terminologyEvent ?? null,
      questionType: data.questionType ?? 'question', contextResolutionReason: data.contextResolutionReason ?? '',
      analysis: data.analysis ?? null, socialAct: data.socialAct ?? null, parts: data.parts
    };
  }

  detectMedicalTerminology(tokens) {
    for (const [term, data] of Object.entries(MEDICAL_TERMINOLOGY)) {
      if (!tokens.includes(term)) continue;
      const literacy = this.case.personality?.healthLiteracy ?? 0.5;
      const required = data.difficulty === 'high' ? 0.7 : data.difficulty === 'medium' ? 0.55 : 0.35;
      return { term, intendedIntent: data.intent, intent: data.intent, patientUnderstood: literacy >= required, suggestedPatientFriendlyQuestion: data.patientFriendly, mode: this.options.mode ?? 'practice' };
    }
    return null;
  }

  detectDirectIntent(normalized, tokens, context) {
    const statementMatch = this.resolveStatement(normalized);
    if (statementMatch) return statementMatch;

    if (/^(?:do|did|are) you (?:use|take|on|taking) (?:some |any |a )?(?:blood pressure|hypertension) (?:medicines?|medications?|meds|pills?|tablets?)\b/.test(normalized)) {
      return { candidates: [this.toCandidate('medication_regular', 6, ['explicit-medication-subject'])], scope: 'single_intent' };
    }

    const contextMatch = this.resolveContextualFollowup(normalized, context);
    if (contextMatch) return contextMatch;

    for (const [pattern, ids, scope] of DIRECT_RULES) {
      if (!pattern.test(normalized)) continue;
      const candidates = ids.filter(id => scope !== 'objective_exam_request' || !medicationSubject.test(normalized)).map((id) => this.toCandidate(id, 6, ['direct'])).filter(Boolean);
      if (!candidates.length) continue;
      return { candidates, scope };
    }

    return null;
  }

  resolveStatement(normalized) {
    if (/^(you are|youre|you seem to be) (a )?male$/.test(normalized)) return { candidates: [this.toCandidate('identity_sex', 4.5, ['statement-confirmation'])], scope: 'single_intent', statementReply: true, contextResolutionReason: 'Student stated the patient sex.' };
    if (/^(you are|youre|you seem to be) (a )?female$/.test(normalized)) return { candidates: [this.toCandidate('identity_sex', 4.5, ['statement-confirmation'])], scope: 'single_intent', statementReply: true, contextResolutionReason: 'Student stated the patient sex.' };
    return null;
  }

  contextCandidate(id, reason, score = 5) {
    return { candidates: [this.toCandidate(id, score, ['context-followup'])], scope: 'contextual_followup', contextUsed: true, contextResolutionReason: reason };
  }

  resolveContextualFollowup(normalized, context) {
    const last = context.lastIntent;
    const lastDomain = context.lastDomain;

    if (/^(when exactly|exact date|when was that exactly|when was that)$/.test(normalized)) {
      if (last === 'identity_age' || last === 'identity_dob') return this.contextCandidate('identity_dob', 'Exact date requested after age/date of birth.');
      if (last === 'pmh_operations' || last === 'operation_date' || last === 'operation_approach') return this.contextCandidate('operation_date', 'Date requested after operation history.');
      if (last === 'hpi_onset') return this.contextCandidate('hpi_onset', 'Exact time requested after symptom onset.');
      return null;
    }

    if ((last === 'allergies' || lastDomain === 'allergy') && /\b(food|environment|pollen|hay fever|reaction|what happens)\b/.test(normalized)) {
      if (/\b(pollen|hay fever)\b/.test(normalized)) return this.contextCandidate('allergy_pollen', 'Allergy follow-up about pollen.');
      if (/\b(food|environment)\b/.test(normalized)) return this.contextCandidate('allergy_environment_food', 'Allergy follow-up about food/environment.');
      if (/\b(reaction|what happens)\b/.test(normalized)) return this.contextCandidate('allergy_reaction', 'Allergy reaction follow-up.');
    }

    if (lastDomain === 'medication' && /^(?:and )?(?:what do they (?:do|help with)|what are they for)$/.test(normalized)) {
      return this.contextCandidate('medication_indication', 'Asked what the current medicines are for.');
    }
    if (lastDomain === 'medication' && /^(?:and )?(?:(?:what )?dose\b|how often(?:$| do you take (?:it|them)$)|frequency$|why(?:$| do you take (?:it|them)$)|indication$)/.test(normalized)) {
      if (/\b(dose)\b/.test(normalized)) return this.contextCandidate('medication_dose', 'Medication dose follow-up.');
      if (/\b(how often|frequency)\b/.test(normalized)) return this.contextCandidate('medication_frequency', 'Medication frequency follow-up.');
      return this.contextCandidate('medication_indication', 'Medication indication follow-up.');
    }

    // Explicit consultation-closing language must not be swallowed by an active pain context.
    if (/\b(before (we|i) (finish|end)|anything else (you think )?i should know|anything else before we finish)\b/.test(normalized)) return null;

    if (context.activeSymptom && !this.isClearlyNonHpi(normalized)) {
      if (context.activeSymptom.primary && /^(?:did (?:this|that) (?:happen|happened) before|did you (?:have|had) problems with that before)$/.test(normalized)) {
        return this.contextCandidate('hpi_previous_episodes', 'Asked whether the current symptom happened before.');
      }
      if (/^(?:and )?when is it (?:worst|at its worst)$/.test(normalized)) return this.contextCandidate('hpi_timing', 'Asked when the active symptom is worst.');
      if (/^(?:and )?how did you (?:treat|treated) it$/.test(normalized)) return this.contextCandidate('hpi_relieving', 'Asked how the active symptom was treated.');
      if (/\b(where do you feel it|where is it|where exactly is it|where exactly|where do you feel the pain)\b/.test(normalized)) return this.contextCandidate('hpi_site', 'Pronoun/location follow-up resolved to active pain symptom.');
      if (/\b(what is its character|what is the character|what type is it|what kind is it|what is it like|what does it feel like|how would you describe it|describe it)\b/.test(normalized)) return this.contextCandidate('hpi_character', 'Pronoun/character follow-up resolved to active pain symptom.');
      if (/\b(does it radiate|is it radiating|does it move|does it go anywhere|does it spread|does it travel|does it shoot|go to arm|go to jaw|go to back)\b/.test(normalized)) return this.contextCandidate('hpi_radiation', 'Pronoun/radiation follow-up resolved to active pain symptom.');
      if (/\b(how strong is it|how bad is it|how severe is it|rate it|scale)\b/.test(normalized)) return this.contextCandidate('hpi_severity', 'Pronoun/severity follow-up resolved to active pain symptom.');
      if (/\b(what makes it worse|does anything worsen it|is something worsening it|is something worsening the pain|what worsens it|what worsens the pain)\b/.test(normalized)) return this.contextCandidate('hpi_exacerbating', 'Worsening trigger follow-up resolved to active pain symptom.');
      if (/\b(what makes it better|does anything relieve it|what relieves it|does anything help|what helps it|does it go away|did anything help|anything help|anything helping|help ease|ease the pain|eased the pain|improve the pain|make the pain better)\b/.test(normalized)) return this.contextCandidate('hpi_relieving', 'Relieving factor follow-up resolved to active pain symptom.');
      if (/\b(for how long|how long (did|does|was|is|has|had)|duration|lasting|lasted|constant|continuous|intermittent|comes and goes|come and go|how often)\b/.test(normalized)) return this.contextCandidate('hpi_timing', 'Timing/duration follow-up resolved to active pain symptom.');
      if (/^(?:and )?how do you treat (?:it|them|these)(?: at home)?$/.test(normalized)) return this.contextCandidate('hpi_relieving', 'Treatment follow-up resolved to the active symptom.');
      if (/\b(anything else|other symptoms|with it)\b/.test(normalized)) return this.contextCandidate('hpi_associated_symptoms', 'Associated symptom follow-up resolved to active pain symptom.');
    }
    return null;
  }

  isClearlyNonHpi(normalized) {
    return /\b(name|age|old|born|address|city|town|live|from|admitted|hospital|medication|allerg|operation|surgery|family|smok|alcohol|work|job|blood pressure|pulse|heart rate|spo2|saturation|temperature|lab|ecg|ct|mri|ultrasound|bowel|bowl|bowels|stool)\b/.test(normalized);
  }

  detectExplicitMultiIntent(normalized, tokens) {
    const hits = [];
    const add = (condition, id, reason) => { if (condition && !hits.find((h) => h.id === id)) hits.push(this.toCandidate(id, 4, [reason])); };
    const hasJoiner = /\b(and|or|,|plus|with)\b/.test(normalized);
    if (!hasJoiner) return hits;
    add(/\b(?:height|how tall)\b/.test(normalized) && /\b(?:weight|weigh)\b/.test(normalized), 'intake_height', 'explicit-list');
    add(/\b(?:height|how tall)\b/.test(normalized) && /\b(?:weight|weigh)\b/.test(normalized), 'intake_weight', 'explicit-list');
    add(/\b(smok|cigarette)/.test(normalized), 'substance_smoking', 'explicit-list');
    add(/\b(alcohol|beer|wine|spirits|drink)/.test(normalized), 'substance_alcohol', 'explicit-list');
    add(/\b(recreational drugs|street drugs|marijuana|cocaine)\b/.test(normalized), 'substance_drugs', 'explicit-list');
    add(/\b(fever|temperature)\b/.test(normalized), 'ros_general', 'explicit-list');
    add(/\b(nausea|vomit|vomiting|diarrhea|constipation|stool)\b/.test(normalized), 'ros_gastrointestinal', 'explicit-list');
    add(/\b(pee|peeing|urine|urination|urinating)\b/.test(normalized), 'ros_genitourinary', 'explicit-list');
    add(/\b(vision|visual|hearing|ear)\b/.test(normalized), 'ros_head_neck', 'explicit-list');
    add(/\b(cough|sputum|blood when coughing|shortness of breath|breathless)\b/.test(normalized), 'ros_respiratory', 'explicit-list');
    add(/\b(chest pain|palpitations|heart racing)\b/.test(normalized), 'ros_cardiovascular', 'explicit-list');
    add(/\b(medication|medicine|meds|pills|tablets)\b/.test(normalized), 'medication_regular', 'explicit-list');
    add(/\b(allergy|allergies|allergic)\b/.test(normalized), 'allergies', 'explicit-list');
    return hits;
  }

  scoreCandidate(id, intent, normalized, tokens, phrases, needed) {
    let score = 0;
    const reasons = [];
    for (const keyword of intent.keywords ?? []) {
      const key = normalize(keyword);
      if (!key) continue;
      if (key.includes(' ')) {
        if (normalized.includes(key) || phrases.includes(key)) { score += 3.2; reasons.push(`phrase:${keyword}`); }
      } else if (tokens.includes(key)) { score += 1.5; reasons.push(`token:${keyword}`); }
      else {
        const fuzzy = tokens.some((token) => token.length > 4 && dice(token, key) > 0.78);
        if (fuzzy) { score += 0.55; reasons.push(`fuzzy:${keyword}`); }
      }
    }

    if (id.startsWith('hpi_') && /\b(pain|symptom|problem|it)\b/.test(normalized)) score += 0.45;
    if (INTENTS[id]?.domain === 'objective' && this.hasObjectiveTrigger(normalized)) score += 0.8;
    if (INTENTS[id]?.domain === 'objective' && !this.hasObjectiveTrigger(normalized)) score -= 0.75;
    if (!/female/i.test(String(this.case.identity?.sex || '')) && id === 'gyn_history') score -= 2.5;
    if (needed.has(id)) score += 0.08;

    return this.toCandidate(id, Math.max(0, score * (1 + ((intent.priority ?? 4) / 100))), reasons);
  }

  hasObjectiveTrigger(normalized) {
    return /\b(bp|blood pressure|heart rate|pulse|respiratory rate|oxygen saturation|spo2|temperature|vitals|monitor|ecg|lab|blood test|examination|exam|auscultation|palpation|wbc|crp|creatinine|potassium|glucose|tsh|murmur|wheezing|crackles|guarding|blumberg|murphy|mcburney|bowel sounds)\b/.test(normalized);
  }

  symptomForIntent(intentId) {
    if (intentId !== 'chief_complaint' && !intentId.startsWith('hpi_')) return null;
    const symptom = this.case.presentingSymptom ?? PRESENTING_SYMPTOMS[this.case.id];
    return symptom ? { name: symptom.name, bodyArea: symptom.region, lastPropertyIntent: intentId } : null;
  }

  classifyQuestionType(normalized, original = '') {
    if (!normalized) return 'empty';
    if (/\?$/.test(original.trim())) return 'question';
    if (/^(what|when|where|why|how|who|do|does|did|is|are|was|were|can|could|have|has|had|any)\b/.test(normalized)) return 'question';
    if (/^(you are|youre|you seem to be)\b/.test(normalized)) return 'statement_assertion';
    return 'fragment_or_statement';
  }

  applySuppression(candidates, normalized) {
    const suppressed = [];
    const suppress = (id, reason) => { const c = candidates.find((x) => x.id === id); if (c) { c.score = Math.max(0, c.score - 5); suppressed.push({ intentId: id, reason }); } };
    if (!FAMILY_OVERVIEW.test(normalized)) suppress('family_history', 'An overview requires an explicit family-history question');
    if (medicationSubject.test(normalized)) {
      for (const id of Object.keys(INTENTS).filter(id => INTENTS[id].domain === 'objective')) suppress(id, 'Medication question is not a measurement request');
    }
    if (/character/.test(normalized)) { suppress('pmh_previous_exams', 'CT must not match inside character'); for (const c of candidates.filter((x) => INTENTS[x.id]?.domain === 'objective')) suppress(c.id, 'character question is not objective/vitals'); }
    if (/\b(admit|admitted|admission|arrive|came to hospital|get here)\b/.test(normalized) && !/\b(pain|symptom).*start/.test(normalized)) suppress('hpi_onset', 'admission time is administrative, not symptom onset');
    if (/\b(move|moving|spread|radiat|travel|shoot|arm|jaw|back)\b/.test(normalized)) suppress('hpi_site', 'movement/spread words indicate radiation, not site');
    if (/\b(worsen|worse|aggravating|exacerbating)\b/.test(normalized) && !/over time|course|changed|progress/.test(normalized)) suppress('hpi_course', 'worsening trigger should map to exacerbating factors, not course');
    if (/\b(where are you from|where do you live|which town|what city)\b/.test(normalized)) suppress('hpi_site', 'residence question overrides pain site');
    if (this.lastIntent === 'allergies' && /\b(food|environment|pollen)\b/.test(normalized)) suppress('epidemiology', 'allergy context overrides epidemiology food exposure');
    if (/\b(pee|peeing|urine|stool|diarrhea|constipation)\b/.test(normalized) && !/bowel sounds|auscultation|exam/.test(normalized)) suppress('exam_bowel_sounds', 'history question must not trigger objective bowel sounds');
    return suppressed;
  }

  classifyResponseScope(normalized, tokens, candidates, kind) {
    const top = candidates[0];
    if (!top) return 'clarification';
    if (INTENTS[top.id]?.domain === 'objective') return 'objective_exam_request';
    if (['contextual_followup'].includes(kind)) return 'contextual_followup';
    if (/\b(what happened|what (?:brought|brings?|is bringing) you|why did you come|how can i help|tell me about the problem)\b/.test(normalized)) return 'broad_open_history';
    return 'single_intent';
  }

  selectMultipleIntents(candidates, normalized) {
    if (!candidates.length) return [];
    const explicit = this.detectExplicitMultiIntent(normalized, tokenize(normalized));
    if (explicit.length > 1) return explicit;
    return [candidates[0]];
  }

  composeReply(detection) {
    const answers = (detection.parts ?? [detection]).flatMap(part => this.answerClause(part));
    const text = [...new Set(answers.map(answer => answer.text))].join(' ');
    return { reply: this.applyPatientPersonality(text, detection), answers };
  }

  answerClause(detection) {
    const { responseScope, primaryIntent, analysis } = detection;
    const special = {
      audio_check: () => ['acknowledged', 'Yes, I can hear you.'],
      station_context: () => ['acknowledged', /\bwhere\b/.test(detection.normalized)
        ? `We’re at the ${this.case.stationBrief?.location?.toLowerCase() ?? 'clinic'}.`
        : 'I don’t have a calendar or clock in front of me.'],
      chart_details: () => ['out_of_scope', 'Those details are not available in this station.'],
      unavailable_detail: () => ['recognized_unknown', analysis.unavailableReply],
      social: () => ['acknowledged', socialReply(detection.socialAct)],
      terminology_not_understood: () => ['clarification_required', 'I don’t understand that term. Could you describe what you mean?'],
      guarded_withholding: () => ['withheld', this.guardedReply()],
      clarification: () => ['clarification_required', this.clarificationReply(detection)]
    }[responseScope]?.();
    if (special) return [{ intent: primaryIntent?.id, status: special[0], text: special[1], factsUsed: [], rules: [responseScope] }];

    return detection.answerIntents.map(candidate => {
      const attribute = candidate.id === analysis?.intent ? analysis.attribute : 'overview';
      const secondaryFacet = analysis?.subject?.primary === false && attribute !== 'overview';
      const secondaryText = secondaryFacet ? this.case.subjectHistory?.[analysis.subject.intent]?.[attribute] : null;
      let facts = secondaryFacet ? [{
        id: `${this.case.id}:${candidate.id}:${attribute}`, intent: candidate.id, attribute,
        state: secondaryText ? 'authored_narrative' : 'not_authored', value: secondaryText,
        provenance: { paths: [`subjectHistory.${candidate.id}.${attribute}`] }
      }] : retrieveFacts(this.case, candidate.id, attribute, analysis?.target);
      const realizeFacts = (records) => records.flatMap(fact => {
        const response = realizePatientReply(fact, analysis ?? {}, this.options.interviewLanguage);
        return response ? [{ ...response, fact }] : [];
      });
      let realized = realizeFacts(facts);
      if (!realized.length && attribute === 'overview' && facts.some(fact => fact.state === 'present' || fact.state === 'absent')) {
        facts = retrieveFacts(this.case, candidate.id, 'authored-overview');
        realized = realizeFacts(facts);
      }
      // One-facet narrative fields can answer their corresponding open request.
      // A target-specific confirmation needs target-specific authored facts.
      if (!realized.length && !secondaryFacet && !analysis?.target &&
          ['location', 'onset.time', 'onset.activity', 'character.qualities', 'radiation.sites', 'progression', 'relief', 'presence'].includes(attribute)) {
        facts = retrieveFacts(this.case, candidate.id);
        realized = realizeFacts(facts);
      }
      if (candidate.id === 'identity_sex' && detection.questionType === 'statement_assertion' && realized.length) {
        const asserted = detection.normalized.match(/\b(male|female)$/)?.[1];
        if (asserted) realized[0].text = `${asserted === this.case.identity.sex ? 'Yes' : 'No'}. ${realized[0].text}`;
      }
      const creditedIntentIds = [...new Set(realized.map(item => item.fact.intent))]
        .filter(intent => intent !== candidate.id && (FAMILY_OVERVIEW.test(detection.normalized) ||
          QUESTION_BY_PHRASE.get(questionKey(detection.normalized)) === 'family_history' ||
          (candidate.id === 'family_history' && analysis?.correction)));
      return {
        intent: candidate.id, attribute, target: analysis?.target ?? null,
        ...(creditedIntentIds.length ? { creditedIntentIds } : {}),
        status: realized.length ? 'answered' : 'recognized_unknown',
        text: realized.length ? [...new Set(realized.map(item => item.text))].join(' ') : unavailableDetail(attribute, analysis?.subject, candidate.id),
        factsUsed: realized.map(({ text, fact: { id, state, intent, provenance } }) => ({ id, state, intent, text, paths: provenance.paths })),
        rules: realized.length ? realized.map(item => item.rule) : ['unknown'],
        reason: realized.length ? null : facts.map(fact =>
          ['present', 'absent', 'authored_narrative'].includes(fact.state) ? 'could_not_realize_fact' : fact.state).join(', ')
      };
    });
  }

  clarificationReply({ normalized, analysis }) {
    if (/^(?:does|did) it graduate$/.test(normalized)) return 'Do you mean whether it started gradually or whether it spread somewhere else?';
    if (/^(?:how often|how many times) (?:do|did) you (?:go to|use) the (?:bathroom|toilet)$/.test(normalized)) {
      return 'Do you mean passing urine or having a bowel movement?';
    }
    if (ambiguousDrugQuestion.test(normalized)) {
      return 'Do you mean medicines I take or recreational drugs?';
    }
    if (analysis?.choices?.length === 2) return `Do you mean the ${analysis.choices[0]} or the ${analysis.choices[1]}?`;
    if (analysis?.differentSymptom) return 'Which symptom do you mean? Could you ask about one symptom at a time?';
    if (analysis?.unresolvedReference) return 'Which symptom or problem are you asking about?';
    if (ambiguousFamilyQuestion.test(normalized)) return 'Do you mean who I live with or my family’s medical history?';
    if (this.currentSymptom && ambiguousDurationQuestion.test(normalized)) {
      return 'Do you mean when it started or how long it lasts?';
    }
    if (/^(?:when|how many|how long|which one|what|where)$/.test(normalized)) {
      return 'What are you asking about specifically?';
    }
    return 'I’m not sure which detail you want to know. Can you name the symptom or topic?';
  }

  answerFor(intentId) {
    return retrieveFacts(this.case, intentId).map(fact => realizeEnglish(fact)?.text).filter(Boolean).join(' ');
  }

  disclosedAnswerFor(intentId) {
    const answers = this.debugTurns.flatMap(turn => turn.answers ?? [])
      .filter(answer => (answer.intent === intentId || answer.creditedIntentIds?.includes(intentId)) && answer.status === 'answered')
      .flatMap(answer => answer.intent === intentId ? [answer.text] :
        answer.factsUsed.filter(fact => fact.intent === intentId).map(fact => fact.text));
    return answers.length ? [...new Set(answers)].join(' ') : this.answerFor(intentId);
  }

  applyPatientPersonality(reply, detection) {
    const id = detection.primaryIntent?.id;
    const p = this.case.personality ?? {};
    let styled = reply;
    if (id === 'chief_complaint' && detection.responseScope === 'broad_open_history' && this.difficulty === 'beginner') {
      const extra = ['hpi_site', 'hpi_onset'].slice(0, (p.talkativeness ?? 0.5) >= 0.55 ? 2 : 1)
        .map(intent => this.answerFor(intent)).filter(Boolean);
      styled = [styled, ...extra].join(' ');
    }
    if ((p.anxiety ?? 0) > 0.72 && id?.startsWith('hpi_') && this.turn === 1) styled += ' It worries me.';
    if (this.rapport < 35) styled += ' Could we go a little slower?';
    return styled;
  }

  assessCommunication(question, detection, attemptedIntentIds = [], previouslyAttempted = new Set(), previouslyResolved = new Set()) {
    const normalized = normalize(question);
    const words = normalized.split(' ').filter(Boolean);
    const issues = [];
    const positives = [];

    const shorthand = detection.questionType === 'fragment_or_statement' && words.length <= 4 && /\b(factors?|history|timing|duration|severity|radiation|onset|character|allergies|medication)\b/.test(normalized);
    if (shorthand) issues.push({ type: 'checklist_shorthand', message: 'Phrase this as a patient-facing question rather than a checklist heading.' });
    if (detection.responseScope === 'terminology_not_understood') issues.push({ type: 'too_technical', message: 'Use patient-friendly wording instead of unexplained medical terminology.' });
    if (normalized.length > 180) issues.push({ type: 'overlong', message: 'Ask one focused question at a time.' });
    if (detection.responseScope === 'guarded_withholding') issues.push({ type: 'sensitive_without_context', message: 'For sensitive topics, explain why you are asking and ask permission where appropriate.' });

    const verifying = /\b(just to (clarify|confirm)|to confirm|so you said|did i understand|is that right|correct me if)\b/.test(normalized);
    const unnecessaryRepeats = attemptedIntentIds.filter(intentId => {
      if (!previouslyAttempted.has(intentId) || !previouslyResolved.has(intentId)) return false;
      const clause = (detection.parts ?? [detection]).find(part => part.answerIntents.some(item => item.id === intentId));
      const attribute = clause?.analysis?.intent === intentId ? clause.analysis.attribute : 'overview';
      const target = JSON.stringify(clause?.analysis?.target ?? null);
      return this.debugTurns.some(turn => turn.answers?.some(answer => answer.intent === intentId &&
        answer.status === 'answered' && answer.attribute === attribute && JSON.stringify(answer.target ?? null) === target));
    });
    if (unnecessaryRepeats.length && !verifying) issues.push({ type: 'repeated_resolved_area', message: 'This area had already been successfully covered.' });
    if (verifying && unnecessaryRepeats.length) positives.push({ type: 'verification', message: 'Appropriate clarification / verification.' });
    if (this.turn <= 3 && INTRO_TERMS.some((term) => normalized.includes(term))) positives.push({ type: 'introduction', message: 'Introduced self or greeted the patient.' });
    if (EMPATHY_TERMS.some((term) => normalized.includes(term))) positives.push({ type: 'empathy', message: 'Acknowledged the patient’s experience.' });
    if (PERMISSION_TERMS.some((term) => normalized.includes(term))) positives.push({ type: 'permission', message: 'Asked permission respectfully.' });
    if (PATIENT_CENTERED_TERMS.some((term) => normalized.includes(term))) positives.push({ type: 'patient_centered', message: 'Used patient-centred open wording.' });
    if (attemptedIntentIds.some((id) => INTENT_TO_AREA[id] === 'closure')) positives.push({ type: 'closure', message: 'Closed the consultation with the patient rather than simply stopping.' });

    const penalty = issues.reduce((sum, issue) => sum + ({ checklist_shorthand: 6, too_technical: 8, overlong: 3, repeated_resolved_area: 2, sensitive_without_context: 3 }[issue.type] ?? 0), 0);
    return { score: Math.max(0, 80 + Math.min(20, positives.length * 5) - penalty), issues, positives, shorthand, unnecessaryRepeats };
  }

  makeFeedbackLabel(detection, communicationAssessment = null) {
    if (detection.socialAct) return 'Conversation';
    if (detection.responseScope === 'terminology_not_understood') return 'Terminology unclear';
    if (detection.responseScope === 'clarification') return 'Needs clarification';
    if (communicationAssessment?.shorthand) return 'Use patient-facing wording';
    if (detection.responseScope === 'contextual_followup') return 'Useful follow-up';
    if (detection.responseScope === 'objective_exam_request') return 'Objective finding';
    const domain = INTENTS[detection.primaryIntent?.id]?.domain;
    if (domain === 'identity' || domain === 'administrative') return 'Identification';
    if (domain === 'medication') return 'Medication history';
    if (domain === 'allergy') return 'Allergy history';
    if (domain === 'pmh') return 'Past medical history';
    if (domain === 'social') return 'Social history';
    if (domain === 'family') return 'Family history';
    return 'Good question';
  }

  updateRapport(question, detection = null) {
    const q = normalize(question);
    const factors = [];
    let delta = 0;
    const add = (value, id, label) => { delta += value; factors.push({ id, value, label }); };

    if (POLITE_TERMS.some((term) => q.includes(term))) add(1.5, 'polite', 'Polite wording');
    if (this.turn <= 3 && INTRO_TERMS.some((term) => q.includes(term))) add(3.5, 'introduction', 'Introduced self / greeted patient');
    if (EMPATHY_TERMS.some((term) => q.includes(term))) add(4, 'empathy', 'Acknowledged the patient experience');
    if (PERMISSION_TERMS.some((term) => q.includes(term))) add(2.5, 'permission', 'Asked permission respectfully');
    if (PATIENT_CENTERED_TERMS.some((term) => q.includes(term))) add(2.5, 'patient_centered', 'Patient-centred open wording');
    if (RUDE_TERMS.some((term) => q.includes(term))) add(-20, 'rude', 'Rude or hostile wording');
    if (DISMISSIVE_TERMS.some((term) => q.includes(term))) add(-8, 'dismissive', 'Dismissive wording');
    if (q.length > 180) add(-2, 'overlong', 'Overlong multi-part question');
    if (detection?.responseScope === 'terminology_not_understood') add(-3, 'jargon', 'Used unexplained technical terminology');
    if (detection?.questionType === 'fragment_or_statement' && q.split(' ').length <= 4) add(-2, 'checklist', 'Checklist-style fragment');

    delta = Math.max(-22, Math.min(6, delta));
    const before = this.rapport;
    this.rapport = Math.max(0, Math.min(100, this.rapport + delta));
    const event = {
      turnNumber: this.turn,
      before,
      after: this.rapport,
      delta: this.rapport - before,
      factors,
      source: 'text',
      state: this.rapport >= 82 ? 'strong' : this.rapport >= 62 ? 'comfortable' : this.rapport >= 42 ? 'guarded' : 'poor'
    };
    this.lastRapportEvent = event;
    this.rapportEvents.push(event);
    return event;
  }

  applyRapportSignal({ delta = 0, source = 'external', label = 'External interaction signal', metadata = null } = {}) {
    const before = this.rapport;
    const bounded = Math.max(-12, Math.min(12, Number(delta) || 0));
    this.rapport = Math.max(0, Math.min(100, this.rapport + bounded));
    const event = {
      turnNumber: this.turn,
      before,
      after: this.rapport,
      delta: this.rapport - before,
      source,
      factors: [{ id: source, value: this.rapport - before, label }],
      metadata,
      state: this.rapport >= 82 ? 'strong' : this.rapport >= 62 ? 'comfortable' : this.rapport >= 42 ? 'guarded' : 'poor'
    };
    this.lastRapportEvent = event;
    this.rapportEvents.push(event);
    return event;
  }

  nextNeededIntents() {
    return QUESTION_AREAS
      .filter((area) => area.required || (area.id === 'gynecological' && /female/i.test(this.case.identity.sex)))
      .flatMap((area) => area.intents)
      .filter((intent) => !this.isIntentSatisfied(intent, this.askedIntents));
  }

  isIntentSatisfied(intentId, intentSet) {
    if (intentId === 'identity_age') return intentSet.has('identity_age') || intentSet.has('identity_dob');
    return intentSet.has(intentId);
  }

  getCoverageForSet(intentSet, basis = 'resolved') {
    return QUESTION_AREAS
      .filter((area) => area.id !== 'gynecological' || /female/i.test(this.case.identity.sex))
      .map((area) => {
        const asked = area.intents.filter((intent) => this.isIntentSatisfied(intent, intentSet));
        return {
          id: area.id,
          title: area.title,
          required: area.required,
          modelQuestion: area.modelQuestion,
          total: area.intents.length,
          asked: asked.length,
          percent: Math.round((asked.length / area.intents.length) * 100),
          missing: area.intents.filter((intent) => !this.isIntentSatisfied(intent, intentSet)),
          basis
        };
      });
  }

  getCoverage() { return this.getCoverageForSet(this.askedIntents, 'resolved'); }
  getStudentCoverage() { return this.getCoverageForSet(this.attemptedIntents, 'student_attempt'); }

  getDebriefPriorities() {
    const configured = this.case.debriefPriorities ?? {};
    const applicableRequired = QUESTION_AREAS
      .filter((area) => area.required && area.id !== 'objective' && (area.id !== 'gynecological' || /female/i.test(this.case.identity.sex)))
      .flatMap((area) => area.intents);
    const notRelevant = new Set((configured.notRelevant ?? []).filter((id) => INTENTS[id]));
    const clean = (values) => [...new Set(values ?? [])].filter((id) => INTENTS[id] && !notRelevant.has(id));
    const essential = clean(configured.essential?.length ? configured.essential : ['chief_complaint','hpi_onset','hpi_character','hpi_severity','allergies','medication_regular']);
    const caseCritical = clean(configured.caseCritical).filter((id) => !essential.includes(id));
    const recommended = clean(configured.recommended?.length ? configured.recommended : applicableRequired.filter((id) => !essential.includes(id) && !caseCritical.includes(id)));
    const optional = clean(configured.optional);
    const criticalSafety = clean(configured.criticalSafety?.length ? configured.criticalSafety : [...essential, ...caseCritical]);
    return { essential, caseCritical, recommended, comprehensive: recommended, optional, notRelevant: [...notRelevant], criticalSafety };
  }

  percentForIntents(intentIds, intentSet = this.attemptedIntents) {
    if (!intentIds.length) return 100;
    const complete = intentIds.filter((id) => this.isIntentSatisfied(id, intentSet)).length;
    return Math.round((complete / intentIds.length) * 100);
  }

  getCommunicationAssessment() {
    const allIssues = this.communicationEvents.flatMap((event) => (event.issues ?? []).map((issue) => ({ ...issue, turnNumber: event.turnNumber, question: event.question })));
    const allPositives = this.communicationEvents.flatMap((event) => (event.positives ?? []).map((item) => ({ ...item, turnNumber: event.turnNumber, question: event.question })));
    const uniquePositiveTypes = new Set(allPositives.map((item) => item.type));
    const penalty = allIssues.reduce((sum, issue) => sum + ({ checklist_shorthand: 6, too_technical: 8, overlong: 3, repeated_resolved_area: 2, sensitive_without_context: 3 }[issue.type] ?? 0), 0);
    const score = this.communicationEvents.length
      ? Math.max(0, Math.min(100, 75 + Math.min(25, uniquePositiveTypes.size * 5) - Math.min(40, penalty)))
      : 0;
    return { score, issues: allIssues, positives: allPositives };
  }

  getStructureAssessment() {
    const attempted = this.attemptEvents.filter((event) => event?.intentId);
    const firstTurnForArea = (areaId) => attempted.find((event) => INTENT_TO_AREA[event.intentId] === areaId)?.turnNumber ?? Infinity;
    const firstIntentTurn = (intentId) => attempted.find((event) => event.intentId === intentId)?.turnNumber ?? Infinity;
    const feedback = [];
    let score = 0;
    const introEarly = this.rapportEvents.some((event) => event.turnNumber <= 3 && event.factors?.some((factor) => factor.id === 'introduction'));
    if (introEarly) score += 15; else feedback.push('Introduce yourself and establish the interaction early.');
    if (firstIntentTurn('chief_complaint') <= 5) score += 20; else feedback.push('Establish the presenting complaint early before moving into checklists.');
    const hpiTurn = firstTurnForArea('hpi_socrates');
    const backgroundTurn = Math.min(firstTurnForArea('past_medical_history'), firstTurnForArea('social_history'), firstTurnForArea('substance_use'));
    if (hpiTurn < backgroundTurn) score += 25; else feedback.push('Explore the current problem before moving deeply into background history.');
    const sensitiveTurn = Math.min(firstTurnForArea('substance_use'), firstTurnForArea('gynecological'));
    if (Number.isFinite(sensitiveTurn) && firstIntentTurn('chief_complaint') < sensitiveTurn) score += 15;
    else if (Number.isFinite(sensitiveTurn)) feedback.push('Avoid opening with sensitive history before establishing the clinical problem and rapport.');
    const closureTurn = firstTurnForArea('closure');
    if (Number.isFinite(closureTurn) && closureTurn >= Math.max(5, Math.ceil(this.turn * 0.55))) score += 15; else feedback.push('Close the interview explicitly: ask if anything was missed and address the patient’s concerns.');
    const medicationTurn = firstTurnForArea('medication');
    const allergyTurn = firstTurnForArea('allergies_transfusions');
    const coherentCore = Number.isFinite(hpiTurn) && Number.isFinite(medicationTurn) && Number.isFinite(allergyTurn)
      && medicationTurn >= hpiTurn && allergyTurn >= hpiTurn;
    if (coherentCore) score += 10;
    else if ((Number.isFinite(medicationTurn) || Number.isFinite(allergyTurn)) && !Number.isFinite(hpiTurn)) feedback.push('Explore the presenting problem before a detailed medication/allergy review.');
    return { score: Math.min(100, score), feedback, firstTurnByArea: Object.fromEntries(QUESTION_AREAS.filter((area) => area.id !== 'objective').map((area) => [area.id, firstTurnForArea(area.id)])) };
  }

  getScoreBreakdown() {
    const priorities = this.getDebriefPriorities();
    const essential = this.percentForIntents(priorities.essential);
    const caseCritical = this.percentForIntents(priorities.caseCritical);
    const recommended = this.percentForIntents(priorities.recommended);
    const comprehensive = recommended;
    const communication = this.getCommunicationAssessment().score;
    const structure = this.getStructureAssessment().score;
    const overall = Math.round((essential * 0.40) + (caseCritical * 0.25) + (recommended * 0.15) + (communication * 0.10) + (structure * 0.10));
    const requiredResolved = this.getCoverage().filter((area) => area.required && area.id !== 'objective');
    const resolvedAsked = requiredResolved.reduce((sum, area) => sum + area.asked, 0);
    const resolvedTotal = requiredResolved.reduce((sum, area) => sum + area.total, 0);
    const engineResolvedCoverage = resolvedTotal ? Math.round((resolvedAsked / resolvedTotal) * 100) : 0;
    return { overall, essential, caseCritical, recommended, comprehensive, communication, structure, engineResolvedCoverage };
  }

  getScore() { return this.getScoreBreakdown().overall; }

  getCriticalMisses() {
    return this.getDebriefPriorities().criticalSafety.filter((intent) => !this.isIntentSatisfied(intent, this.attemptedIntents));
  }

  getMissedFeedback() {
    return this.getStudentCoverage()
      .filter((area) => area.required && area.id !== 'objective' && area.percent < 100)
      .map((area) => ({ title: area.title, missing: area.missing, modelQuestion: area.modelQuestion }));
  }

  getResolutionIssues() {
    const eventuallyResolved = this.askedIntents;
    return this.attemptEvents
      .filter(event => !event.resolved && event.responseScope !== 'guarded_withholding' && event.outcome !== 'withheld')
      .map((event) => ({
        ...event,
        label: INTENTS[event.intentId]?.title ?? event.intentId,
        laterResolved: this.isIntentSatisfied(event.intentId, eventuallyResolved)
      }));
  }

  makeMissDetail(intentId, tier) {
    const area = QUESTION_AREAS.find((item) => item.intents.includes(intentId));
    return {
      id: intentId,
      label: INTENTS[intentId]?.title ?? intentId,
      area: area?.title ?? 'History',
      tier,
      examples: getModelQuestions(intentId).slice(0, 2)
    };
  }

  getStrengths() {
    const priorities = this.getDebriefPriorities();
    const strengths = [];
    const completedCritical = priorities.caseCritical.filter((id) => this.isIntentSatisfied(id, this.attemptedIntents));
    if (completedCritical.length) strengths.push(`Covered ${completedCritical.length}/${priorities.caseCritical.length || completedCritical.length} case-critical history item${completedCritical.length === 1 ? '' : 's'}.`);
    const communication = this.getCommunicationAssessment();
    const positiveTypes = new Set(communication.positives.map((item) => item.type));
    if (positiveTypes.has('introduction')) strengths.push('Introduced yourself / established the interaction early.');
    if (positiveTypes.has('empathy')) strengths.push('Used explicit empathic language.');
    if (positiveTypes.has('permission')) strengths.push('Used respectful permission before sensitive questioning.');
    if (positiveTypes.has('closure')) strengths.push('Closed the consultation explicitly.');
    return strengths;
  }

  getConversationQuality() {
    const quality = { clarificationTurns: 0, unavailableTurns: 0, answeredTurns: 0, correctedTurns: 0, aiRequests: 0, aiRescues: 0 };
    for (const turn of this.debugTurns) {
      const answers = turn.answers ?? [];
      if (answers.some(answer => answer.status === 'clarification_required')) quality.clarificationTurns++;
      if (answers.some(answer => answer.status === 'recognized_unknown')) quality.unavailableTurns++;
      if (answers.some(answer => answer.status === 'answered')) quality.answeredTurns++;
      if (turn.interpretations?.some(item => item.correction) && answers.some(answer => answer.status === 'answered')) quality.correctedTurns++;
      if (turn.rescue?.aiAttempted) quality.aiRequests++;
      if (turn.rescue?.aiRescueUsed) quality.aiRescues++;
    }
    return quality;
  }

  getDebrief() {
    const priorities = this.getDebriefPriorities();
    const missedEssential = priorities.essential.filter((intent) => !this.isIntentSatisfied(intent, this.attemptedIntents));
    const missedCaseCritical = priorities.caseCritical.filter((intent) => !this.isIntentSatisfied(intent, this.attemptedIntents));
    const missedRecommended = priorities.recommended.filter((intent) => !this.isIntentSatisfied(intent, this.attemptedIntents));
    const evidenceByIntent = {};
    const turns = new Map(this.debugTurns.map(turn => [turn.turnNumber, turn]));
    for (const event of this.attemptEvents) {
      const existing = evidenceByIntent[event.intentId];
      if (existing?.resolved || (existing && !event.resolved && event.reason !== 'not_authored')) continue;
      evidenceByIntent[event.intentId] = {
        turnNumber: event.turnNumber,
        question: event.question,
        reply: event.recognized ? turns.get(event.turnNumber)?.patientAnswer : null,
        resolved: event.resolved,
        reason: event.reason
      };
    }
    for (const turn of this.debugTurns) {
      for (const id of turn.answeredIds ?? []) {
        if (evidenceByIntent[id]?.resolved) continue;
        evidenceByIntent[id] = { turnNumber: turn.turnNumber, question: turn.studentInput, reply: turn.patientAnswer, resolved: true, reason: null };
      }
    }
    return {
      score: this.getScore(),
      evidenceByIntent,
      conversationQuality: this.getConversationQuality(),
      scoreBreakdown: this.getScoreBreakdown(),
      studentCoverage: this.getStudentCoverage(),
      engineResolvedCoverage: this.getCoverage(),
      missedRequired: this.getMissedFeedback(),
      missedEssential,
      missedCaseCritical,
      missedRecommended,
      missedDetails: [
        ...missedEssential.map((id) => this.makeMissDetail(id, 'Essential')),
        ...missedCaseCritical.map((id) => this.makeMissDetail(id, 'Case-critical')),
        ...missedRecommended.map((id) => this.makeMissDetail(id, 'Recommended'))
      ],
      criticalSafetyMisses: this.getCriticalMisses(),
      resolutionIssues: this.getResolutionIssues(),
      communication: this.getCommunicationAssessment(),
      structure: this.getStructureAssessment(),
      strengths: this.getStrengths()
    };
  }

  legacyGenerateSummary() {
    const section = (title, intentIds) => [title, intentIds.filter((id) => this.askedIntents.has(id)).map((id) => this.disclosedAnswerFor(id)).filter(Boolean).join(' ') || '[Not asked / incomplete]'].join('\n');
    const gyn = /female/i.test(this.case.identity.sex) ? section('Gynecological History:', ['gyn_history']) : 'Gynecological History:\nNot applicable.';
    return ['Anamnesis Summary', '', `Patient: ${strip(this.case.identity.age)}, ${strip(this.case.identity.sex).toLowerCase()}, ${strip(this.case.identity.name)}, ${strip(this.case.identity.residence)}.`, '', section('Chief Complaint:', ['chief_complaint']), '', section('History Of Present Illness:', ['hpi_site', 'hpi_onset', 'hpi_activity_at_onset', 'hpi_character', 'hpi_radiation', 'hpi_associated_symptoms', 'hpi_timing', 'hpi_exacerbating', 'hpi_relieving', 'hpi_severity', 'hpi_course']), '', section('Review Of Systems:', ['ros_general', 'ros_head_neck', 'ros_cardiovascular', 'ros_respiratory', 'ros_gastrointestinal', 'ros_genitourinary', 'ros_neurological', 'ros_musculoskeletal', 'ros_skin']), '', section('Past Medical History:', ['pmh_chronic_diseases', 'pmh_cardiovascular_disease', 'pmh_specialists', 'pmh_hospitalizations', 'pmh_operations', 'pmh_previous_exams']), '', section('Medication:', ['medication_regular', 'medication_nitroglycerin_previous', 'medication_otc_supplements', 'medication_adherence']), '', section('Allergies And Transfusions:', ['allergies', 'allergy_environment_food', 'allergy_pollen', 'allergy_reaction', 'transfusions']), '', gyn, '', section('Family History:', ['family_history']), '', section('Epidemiological History:', ['epidemiology']), '', section('Social And Functional History:', ['identity_occupation', 'social_living', 'daily_independence']), '', section('Substance Use:', ['substance_smoking', 'substance_alcohol', 'substance_caffeine', 'substance_drugs']), '', 'Terminology feedback:', ...(this.terminologyEvents.length ? this.terminologyEvents.map((e) => `- Used “${e.term}”; patient-friendly wording: ${e.suggestedPatientFriendlyQuestion}`) : ['None.']), '', 'Clinical Direction:', this.case.expectedDiagnosisIdea].join('\n');
  }

  generateSummary() {
    const visibleAreas = QUESTION_AREAS.filter((area) => area.id !== 'objective' && (area.id !== 'gynecological' || /female/i.test(this.case.identity.sex)));
    const lines = ['Anamnesis Summary', ''];
    for (const area of visibleAreas) {
      const facts = [...area.intents, ...(area.optionalIntents ?? [])]
        .filter((id) => this.askedIntents.has(id))
        .map((id) => this.disclosedAnswerFor(id))
        .filter(Boolean);
      lines.push(`${area.title}:`);
      lines.push(facts.length ? [...new Set(facts)].join(' ') : '[Not asked / incomplete]');
      lines.push('');
    }
    lines.push('Terminology feedback:');
    lines.push(...(this.terminologyEvents.length ? this.terminologyEvents.map((event) => `- Used "${event.term}"; patient-friendly wording: ${event.suggestedPatientFriendlyQuestion}`) : ['None.']));
    return lines.join('\n').trim();
  }

  getDebugExport() {
    const debrief = this.getDebrief();
    return {
      appVersion: '2.3.0-debrief-coverage',
      exportedAt: new Date().toISOString(),
      selectedCase: this.case.id,
      conversationHistory: this.debugTurns,
      finalCoverage: this.getCoverage(),
      studentCoverage: this.getStudentCoverage(),
      scoreState: { score: this.getScore(), breakdown: this.getScoreBreakdown() },
      discoveredFacts: [...this.askedIntents],
      studentAttemptedIntents: [...this.attemptedIntents],
      missedRequiredFields: debrief.missedRequired,
      missedCaseCritical: debrief.missedCaseCritical,
      missedRedFlags: debrief.criticalSafetyMisses,
      simulatorResolutionIssues: debrief.resolutionIssues,
      communicationFeedback: debrief.communication,
      rapport: this.rapport,
      rapportEvents: this.rapportEvents,
      terminologyFeedback: this.terminologyEvents
    };
  }

  makeDebugTurn(question, detection, reply, feedbackLabel, attemptedIntentIds = [], communicationAssessment = null, creditedIds = []) {
    const resolvedIds = detection.answerIntents.map((intent) => intent.id);
    return {
      turnNumber: this.turn,
      studentInput: question,
      normalizedInput: detection.normalized,
      tokens: detection.tokens,
      attemptedIntentIds,
      attemptedIntentLabels: attemptedIntentIds.map((id) => INTENTS[id]?.title || id),
      selectedIntentIds: resolvedIds,
      selectedIntentLabels: detection.answerIntents.map((i) => INTENTS[i.id]?.title || i.id),
      selectedDomains: detection.answerIntents.map((i) => INTENTS[i.id]?.domain || 'unknown'),
      studentEngineMismatch: attemptedIntentIds.some(id => !resolvedIds.includes(id) && !creditedIds.includes(id)),
      responseScope: detection.responseScope,
      patientAnswer: reply,
      feedbackLabel,
      communicationAssessment,
      matchKind: detection.kind,
      directMappingUsed: detection.directMappingUsed,
      contextUsed: detection.contextUsed,
      topCandidates: detection.candidates.map((c) => ({ intentId: c.id, label: c.title, domain: INTENTS[c.id]?.domain || 'unknown', score: c.score })),
      suppressedCandidates: detection.suppressedCandidates,
      fallbackOccurred: detection.responseScope === 'clarification',
      fallbackReason: detection.responseScope === 'clarification' ? 'No clinically reasonable interpretation.' : '',
      terminologyEvents: detection.terminologyEvent ? [detection.terminologyEvent] : [],
      coverageSnapshot: this.getCoverage(),
      studentCoverageSnapshot: this.getStudentCoverage(),
      repeatedIntentState: Object.fromEntries([...this.askedIntents].map((id) => [id, true])),
      attemptedIntentState: Object.fromEntries([...this.attemptedIntents].map((id) => [id, true])),
      lastMeaningfulIntent: this.lastMeaningfulIntent,
      lastMeaningfulDomain: this.lastMeaningfulDomain,
      currentSymptom: this.currentSymptom,
      questionType: detection.questionType,
      contextResolutionReason: detection.contextResolutionReason,
      rapportEvent: this.lastRapportEvent
    };
  }

  pushStudent(text, intent, feedbackLabel = '') { this.transcript.push({ role: 'student', text, intent, feedbackLabel, at: Date.now() }); }
  pushPatient(text, intent) { this.transcript.push({ role: 'patient', text, intent, at: Date.now() }); }
  toCandidate(id, score = 0, reasons = []) { if (!INTENTS[id]) return null; return { id, title: INTENTS[id].title, score, reasons, answerKeys: INTENTS[id].answerKeys, alreadyAsked: this.askedIntents.has(id) }; }
}

function structuredCopy(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch {}
  }
  return JSON.parse(JSON.stringify(value));
}

export function normalize(text) { return String(text ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b[a-z]+\b/g, word => Object.hasOwn(TYPO_FIXES, word) ? TYPO_FIXES[word] : word); }
function tokenize(text) { return normalize(text).split(' ').filter((token) => token.length > 1).map(lightStem); }
function lightStem(token) { const keep = ['is','was','has','does','this','his','as','its','it','ct','mi','bp','hr','rr','tsh','crp','wbc','ntg','dyspnea','dysuria','hemoptysis','orthopnea','syncope','palpitations','edema','melena','hematemesis','nocturia','polyuria','polydipsia','dysphagia','paresthesia','vertigo','cephalgia','cyanosis','diaphoresis']; if (keep.includes(token)) return token; return token.replace(/ies$/, 'y').replace(/ing$/, '').replace(/ed$/, '').replace(/s$/, ''); }
function makeNgrams(tokens, maxSize = 4) { const grams = []; for (let size = 2; size <= maxSize; size += 1) for (let i = 0; i <= tokens.length - size; i += 1) grams.push(tokens.slice(i, i + size).join(' ')); return grams; }
function calculateConfidence(top, second, length) { if (top <= 0) return 0; const separation = Math.max(0, top - second) / Math.max(top, 1); const strength = Math.min(1, top / 5.5); const lengthFactor = length < 8 ? 0.88 : 1; return round2(((strength * 0.75) + (separation * 0.25)) * lengthFactor); }
function round2(value) { return Math.round(value * 100) / 100; }
function strip(value) { return String(value ?? '').replace(/^I am /i, '').replace(/^My name is /i, '').replace(/^I live in /i, 'from '); }
function dice(a, b) { if (a === b) return 1; if (a.length < 2 || b.length < 2) return 0; const bigrams = (s) => Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2)); const aGrams = bigrams(a); const bGrams = bigrams(b); let hits = 0; const used = new Set(); for (const g of aGrams) { const idx = bGrams.findIndex((x, i) => x === g && !used.has(i)); if (idx >= 0) { hits += 1; used.add(idx); } } return (2 * hits) / (aGrams.length + bGrams.length); }
