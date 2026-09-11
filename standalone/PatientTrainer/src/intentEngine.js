import { allIntentDefinitions as intentDefinitions } from './data/intentDefinitions.js';
import { synonymDictionary } from './data/synonymDictionary.js';

const DEFAULT_THRESHOLDS = {
  MATCH_THRESHOLD: 0.24,
  WEAK_MATCH_THRESHOLD: 0.16,
  MIN_TOP_SCORE_FOR_MATCH: 1.35,
  MIN_TOP_SCORE_FOR_WEAK_MATCH: 0.85
};

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'by', 'can', 'could', 'did',
  'do', 'does', 'for', 'from', 'have', 'has', 'how', 'i', 'in', 'is', 'it', 'me',
  'my', 'of', 'on', 'or', 'the', 'there', 'this', 'to', 'was', 'were', 'what',
  'when', 'where', 'with', 'would', 'you', 'your'
]);

const FOLLOW_UP_MAP = [
  { id: 'pain_radiation', phrases: ['go anywhere', 'spread', 'travel', 'move anywhere', 'radiate'] },
  { id: 'pain_severity', phrases: ['how bad', 'how strong', 'out of ten', 'scale', 'rate it'] },
  { id: 'pain_onset', phrases: ['since when', 'how long', 'when exactly', 'when did it start'] },
  { id: 'pain_exacerbating', phrases: ['what makes it worse', 'worse', 'brings it on'] },
  { id: 'pain_relieving', phrases: ['what makes it better', 'better', 'helps', 'relieves'] },
  { id: 'pain_associated_symptoms', phrases: ['anything else', 'with it', 'other symptoms'] },
  { id: 'pain_timing', phrases: ['constant', 'come and go', 'how often'] },
  { id: 'pain_course', phrases: ['changed', 'getting worse', 'getting better'] }
];

const AMBIGUOUS_PATTERNS = [
  'down there',
  'how is it',
  'how are things',
  'any problems',
  'is everything okay'
];

const CONCEPT_GROUPS = {
  identityConcept: [/\b(name|age|born|birthday|sex|gender|address|city|town|where are you from|where do you live|which town)\b/],
  admissionConcept: [/\b(admitted|admission|arrive|came here|come here|come to hospital|brought you|ambulance|come alone)\b/],
  chiefComplaintConcept: [/\b(what brought|why did you come|why are you here|what happened|what is wrong|main problem|how can i help)\b/],
  painSiteConcept: [/\b(site|where is the pain|where does it hurt|where exactly|location)\b/],
  painOnsetConcept: [/\b(onset|when did (it|the pain|symptoms?) start|since when|how long ago)\b/],
  painCharacterConcept: [/\b(character|type of pain|kind of pain|what is the pain like|describe the pain|sharp|dull|burning|pressing|stabbing|colicky)\b/],
  painRadiationConcept: [/\b(radiat\w*|spread|move anywhere|travel|go anywhere|arm|jaw|back)\b/],
  associatedSymptomsConcept: [/\b(associated symptoms|other symptoms|anything else with it|nausea|vomit|fever|sweat|palpitations|dizzy|short of breath)\b/],
  medicationConcept: [/\b(medication|medicine|meds|pills|tablets|dose|frequency|over the counter|otc|supplements|vitamins|herbal|adherence|forget)\b/],
  allergyConcept: [/\b(allerg\w*|alerg\w*|reaction|penicillin|latex|food allergy)\b/],
  pmhConcept: [/\b(chronic|medical problems|previous diseases|hypertension|high blood pressure|diabetes|cholesterol|heart disease|heart attack|kidney|asthma|copd|thyroid|liver)\b/],
  familyConcept: [/\b(family history|in your family|parents|mother|father|siblings|relatives|genetic)\b/],
  socialConcept: [/\b(work|job|occupation|retired|unemployed|married|single|divorced|widowed|live alone|live with|house|apartment|floor|elevator)\b/],
  substanceConcept: [/\b(smok\w*|cigarettes?|tobacco|pack years|alcohol|beer|wine|spirits|coffee|black tea|energy drinks|recreational drugs|street drugs|cannabis|marijuana|cocaine)\b/],
  examConcept: [/\b(exam|examination|conscious|oriented|appearance|hydration|skin|edema|lungs|wheezing|crackles|heart sounds|murmur|abdomen|guarding|blumberg|murphy|mcburney|rovsing|pulses|capillary)\b/],
  vitalsConcept: [/\b(temperature|spo2|oxygen saturation|heart rate|pulse|respiratory rate|blood pressure|bp|weight|height|bmi|vitals?)\b/],
  labsConcept: [/\b(hb|hemoglobin|rbc|hct|wbc|platelets|crp|creatinine|urea|sodium|potassium|chloride|calcium|alt|ast|bilirubin|glucose|ldl|hdl|triglycerides|tsh|troponin)\b/]
};

const CONTEXT_BLOCKING_CONCEPTS = new Set([
  'identityConcept',
  'admissionConcept',
  'medicationConcept',
  'allergyConcept',
  'pmhConcept',
  'familyConcept',
  'socialConcept',
  'substanceConcept',
  'examConcept',
  'vitalsConcept',
  'labsConcept'
]);

const TYPO_ALIASES = {
  alergic: 'allergic',
  alergies: 'allergies',
  alergy: 'allergy',
  alergi: 'allergy',
  medecine: 'medicine',
  medicin: 'medicine',
  medicene: 'medicine',
  nausia: 'nausea',
  nause: 'nausea',
  breth: 'breath',
  breathng: 'breathing',
  breathin: 'breathing',
  surgury: 'surgery',
  diarea: 'diarrhea',
  diahrea: 'diarrhea'
};

const SHORT_QUESTION_INTENTS = [
  { id: 'allergies', patterns: [/^allerg(y|ies|ic)?$/, /^alerg(y|ies|ic)?$/, /^any allerg(y|ies|ic)?$/, /^any alerg(y|ies|ic)?$/, /^drug reactions?$/, /^bad reactions?$/] },
  { id: 'medication', patterns: [/^med(ication|icine|s)?$/, /^medecine$/, /^pills?$/, /^tablets?$/, /^prescriptions?$/, /^regular treatment$/, /^supplements?$/, /^over the counter$/] },
  { id: 'smoking', patterns: [/^smok(e|ing)?$/, /^cigarettes?$/, /^tobacco$/, /^do you smoke$/] },
  { id: 'alcohol', patterns: [/^alcohol$/, /^drink$/, /^do you drink$/, /^beer$/, /^wine$/, /^spirits$/] },
  { id: 'recreational_drugs', patterns: [/^drugs?$/, /^recreational drugs?$/, /^weed$/, /^marijuana$/, /^do you use drugs?$/] },
  { id: 'pain_site', patterns: [/^where$/, /^where exactly$/, /^location$/, /^place$/] },
  { id: 'pain_onset', patterns: [/^when$/, /^since when$/, /^how long$/, /^from when$/] },
  { id: 'pain_severity', patterns: [/^how bad$/, /^how severe$/, /^how strong$/, /^severity$/] },
  { id: 'pain_radiation', patterns: [/^does it spread$/, /^spread$/, /^radiation$/, /^go anywhere$/, /^move anywhere$/] },
  { id: 'pain_associated_symptoms', patterns: [/^anything else$/, /^other symptoms$/, /^with it$/] },
  { id: 'fever', patterns: [/^fever$/, /^any fever$/, /^temperature$/, /^chills?$/] },
  { id: 'nausea_vomiting', patterns: [/^nausea$/, /^nausia$/, /^any nausea$/, /^any nausia$/, /^nauseous$/, /^vomiting?$/, /^vomit$/] },
  { id: 'operations', patterns: [/^surgeries?$/, /^operations?$/, /^any surgeries?$/, /^operated$/] },
  { id: 'past_medical_history', patterns: [/^previous diseases?$/, /^past diseases?$/, /^medical problems?$/, /^chronic diseases?$/, /^diagnoses$/] },
  { id: 'family_history', patterns: [/^family$/, /^family history$/, /^parents$/, /^mother$/, /^father$/, /^siblings$/] },
  { id: 'urinary_symptoms', patterns: [/^urine$/, /^urination$/, /^pee$/, /^waterworks$/, /^urinary problems?$/] },
  { id: 'bowel_symptoms', patterns: [/^stool$/, /^bowel$/, /^bowels$/, /^poop$/, /^diarrhea$/, /^constipation$/] },
  { id: 'cough', patterns: [/^cough$/, /^do you cough$/] },
  { id: 'dyspnea', patterns: [/^breathing$/, /^breath problem$/, /^breth problem$/, /^shortness of breath$/] }
];

const DIRECT_INTENT_PATTERNS = [
  {
    id: 'greeting',
    patterns: [/^(hello|hi|good morning|good afternoon)$/]
  },
  {
    id: 'introduction',
    patterns: [
      /\bintroduce (yourself|you)\b/,
      /\bconsent\b/,
      /\bpermission\b/
    ]
  },
  {
    id: 'identity_name',
    patterns: [/\bwhat is your name\b/, /\byour name\b/, /\bwho are you\b/, /\btell me your name\b/]
  },
  {
    id: 'identity_age',
    patterns: [/\bhow old are you\b/, /\bwhat is your age\b/, /\bage\b/]
  },
  {
    id: 'identity_dob',
    patterns: [/\bdate of birth\b/, /\bwhen were you born\b/, /\bborn\b/, /\bbirthday\b/]
  },
  {
    id: 'identity_sex',
    patterns: [/\bare you male or female\b/, /\bsex\b/, /\bgender\b/]
  },
  {
    id: 'identity_residence',
    patterns: [/\bwhere are you from\b/, /\bwhere do you live\b/, /\bwhich town\b/, /\bwhat town\b/, /\bwhat city\b/, /\bresidence\b/]
  },
  {
    id: 'identity_address',
    patterns: [/\baddress\b/]
  },
  {
    id: 'administrative_admission_time',
    patterns: [/\bwhen did you come\b/, /\bwhen did you arrive\b/, /\bwhen were you admitted\b/, /\bwhen did they admit you\b/, /\bwhen did you come (here|to (the )?hospital)\b/]
  },
  {
    id: 'administrative_arrival_method',
    patterns: [/\bhow did you get here\b/, /\bhow did you arrive\b/, /\bhow did you get to (the )?hospital\b/, /\bby which mode of transport did you (come|get to (the )?hospital)\b/, /\bwhat transportation brought you here\b/, /\bdid you come by ambulance\b/, /\bdid someone drive you\b/, /\bwho brought you\b/, /\bdid you walk here\b/, /\bwere you brought by emergency services\b/, /\bcome alone\b/, /\bambulance\b/]
  },
  {
    id: 'chief_complaint',
    patterns: [
      /\bwhat brought you\b/,
      /\bhow can i help\b/,
      /\bwhy (are you here|did you come)\b/,
      /\bwhat are you here for\b/,
      /\bwhat seems to be the problem\b/,
      /\bmain problem\b/,
      /\bproblem today\b/,
      /\bwhat is wrong\b/,
      /\bwhat happened\b/,
      /\btell me about the problem\b/
    ]
  },
  {
    id: 'open_history',
    patterns: [
      /\btell me more\b/,
      /\btell me what happened\b/,
      /\btell me about the problem\b/,
      /\bin your own words\b/,
      /\bstart from the beginning\b/
    ]
  },
  {
    id: 'pain_site',
    patterns: [
      /\bwhere (is|was|do you feel|exactly)\b/,
      /\bwhere does it hurt\b/,
      /\blocation\b/,
      /\bplace\b/,
      /\bwhich part\b/
    ]
  },
  {
    id: 'hpi_site',
    patterns: [/\bsite of pain\b/, /\bwhere is the pain\b/, /\bwhere does it hurt\b/, /\bwhere exactly is it\b/]
  },
  {
    id: 'hpi_onset',
    patterns: [/\bonset of pain\b/, /^onset$/, /\bwhen did (it|the pain|the symptom) start\b/, /\bsince when\b/]
  },
  {
    id: 'hpi_circumstances',
    patterns: [/\bwhat were you doing\b/]
  },
  {
    id: 'hpi_character',
    patterns: [/\bcharacter of pain\b/, /\bwhat (type|kind) of pain\b/, /\bwhat is (it|the pain) like\b/, /\bwhat does it feel like\b/, /\bdescribe the pain\b/, /\bsharp\b/, /\bdull\b/, /\bburning\b/, /\bpressing\b/, /\bstabbing\b/, /\bcolicky\b/]
  },
  {
    id: 'hpi_radiation',
    patterns: [/\bradiation\b/, /\bradiation of (the )?pain\b/, /\bdoes it spread\b/, /\bdoes it radiate\b/, /\bdoes it move\b/, /\bdoes it travel\b/, /\bdoes it go anywhere\b/]
  },
  {
    id: 'hpi_severity',
    patterns: [/\bseverity\b/, /\bvas\b/, /\bhow bad is it\b/, /\bscale from 1 to 10\b/, /\bfrom 1 to 10\b/, /\b1 to 10\b/]
  },
  {
    id: 'hpi_exacerbating',
    patterns: [/\bexacerbating factors\b/, /\baggravating factors\b/, /\bwhat makes it worse\b/]
  },
  {
    id: 'hpi_relieving',
    patterns: [/\brelieving factors\b/, /\balleviating factors\b/, /\bwhat makes it better\b/, /\bwhat helps\b/]
  },
  {
    id: 'hpi_timing',
    patterns: [/^timing$/, /^duration$/, /\bhow long does it last\b/]
  },
  {
    id: 'hpi_course',
    patterns: [/\bcourse since onset\b/, /\bis it getting worse\b/, /\bis it improving\b/, /\bis it worsening\b/, /\bimproving or worsening\b/]
  },
  {
    id: 'hpi_associated_symptoms',
    patterns: [/\bany other symptoms\b/, /\banything else with it\b/]
  },
  {
    id: 'pain_onset',
    patterns: [
      /\bwhen did (it|this|the pain|the problem) (start|begin)\b/,
      /\bsince when\b/,
      /\bhow long\b/,
      /\bwhen exactly\b/,
      /\bfrom when\b/
    ]
  },
  {
    id: 'pain_radiation',
    patterns: [
      /\bdoes it (go|move|spread|travel|radiate)\b/,
      /\bgo anywhere\b/,
      /\bspread anywhere\b/,
      /\bgoes to\b/,
      /\bshoots?\b/,
      /\bto (the )?(arm|jaw|shoulder|back)\b/
    ]
  },
  {
    id: 'pain_severity',
    patterns: [
      /\bhow (bad|strong|severe|intense)\b/,
      /\bout of ten\b/,
      /\b0 to 10\b/,
      /\brate (it|the pain)\b/
    ]
  },
  {
    id: 'pain_exacerbating',
    patterns: [/\bwhat makes it worse\b/, /\bmakes it worse\b/, /\bworse with\b/]
  },
  {
    id: 'pain_relieving',
    patterns: [/\bwhat makes it better\b/, /\bmakes it better\b/, /\bwhat helps\b/, /\brelieves\b/]
  },
  {
    id: 'pain_associated_symptoms',
    patterns: [/\banything else\b/, /\bother symptoms\b/, /\bwith it\b/, /\bassociated\b/]
  },
  {
    id: 'hearing_problems',
    patterns: [/\bhearing\b/, /\bhearing problems?\b/, /\bear problems?\b/]
  },
  {
    id: 'visual_problems',
    patterns: [/\bvisual\b/, /\bvision\b/, /\bvisual problems?\b/]
  },
  {
    id: 'fever',
    patterns: [/\bfever\b/, /\btemperature\b/, /\bchills?\b/, /\bshivering\b/]
  },
  {
    id: 'weight_loss',
    patterns: [/\blost weight\b/, /\bweight loss\b/, /\blosing weight\b/]
  },
  {
    id: 'night_sweats',
    patterns: [/\bnight sweats?\b/]
  },
  {
    id: 'dizziness',
    patterns: [/\bdizziness\b/, /\bdizzy\b/]
  },
  {
    id: 'sweating',
    patterns: [/\bsweat\w*\b/]
  },
  {
    id: 'nausea_vomiting',
    patterns: [/\bnausea\b/, /\bnauseous\b/, /\bvomit\w*\b/, /\bthrow up\b/, /\bfeel sick\b/]
  },
  {
    id: 'dyspnea',
    patterns: [/\bshort of breath\b/, /\bbreathless\b/, /\bdifficulty breathing\b/, /\bhard to breathe\b/, /\bdyspnea\b/]
  },
  {
    id: 'cough',
    patterns: [/\bcough\w*\b/]
  },
  {
    id: 'sputum',
    patterns: [/\bsputum\b/, /\bphlegm\b/, /\bmucus\b/, /\bbring\w* up\b/, /\bcough up sputum\b/]
  },
  {
    id: 'hemoptysis',
    patterns: [/\bcough\w* blood\b/, /\bblood in (the )?(sputum|phlegm|mucus)\b/, /\bblood when coughing\b/, /\bhemoptysis\b/]
  },
  {
    id: 'palpitations',
    patterns: [/\bpalpitations?\b/, /\bheart racing\b/, /\bheart pounding\b/, /\bfluttering\b/]
  },
  {
    id: 'syncope',
    patterns: [/\bfaint\w*\b/, /\bpassed out\b/, /\bblack(ed)? out\b/, /\bcollapse\b/]
  },
  {
    id: 'edema',
    patterns: [/\bleg swelling\b/, /\bankle swelling\b/, /\bswollen legs\b/, /\bedema\b/]
  },
  {
    id: 'appetite',
    patterns: [/\bappetite\b/, /\bnot eating\b/, /\bloss of appetite\b/]
  },
  {
    id: 'bowel_symptoms',
    patterns: [/\bbowels?\b/, /\bstools?\b/, /\bdiarrhea\b/, /\bconstipation\b/, /\bblood in stool\b/]
  },
  {
    id: 'urinary_symptoms',
    patterns: [/\burin\w*\b/, /\bpee\b/, /\bburning\b/, /\bfrequency\b/, /\bblood in urine\b/]
  },
  {
    id: 'past_medical_history',
    patterns: [/\bpast medical\b/, /\bmedical problems\b/, /\bprevious diseases?\b/, /\bchronic (disease|illness|condition)s?\b/, /\bdiagnos(e|is|ed)\b/, /\bhigh blood pressure\b/, /\bdiabetes\b/, /\bheart disease\b/, /\basthma\b/, /\bcopd\b/]
  },
  { id: 'pmh_chronic_diseases', patterns: [/\bchronic diseases?\b/, /\bany chronic diseases?\b/] },
  { id: 'pmh_hypertension', patterns: [/\bhigh blood pressure\b/, /\bhypertension\b/] },
  { id: 'pmh_diabetes', patterns: [/\bdiabetes\b/] },
  { id: 'pmh_dyslipidemia', patterns: [/\bcholesterol\b/, /\bdyslipidemia\b/] },
  { id: 'pmh_ischemic_heart_disease', patterns: [/\bheart disease\b/, /\bheart attack\b/, /\bmyocardial infarction\b/] },
  { id: 'pmh_cardiovascular_disease', patterns: [/\bheart condition\b/, /\bcardiac condition\b/, /\bcardiovascular disease\b/, /\bcvs condition\b/, /\bcoronary disease\b/] },
  { id: 'pmh_previous_mi', patterns: [/\bprevious mi\b/, /\bmyocardial infarction\b/, /\bprevious heart attack\b/, /\bheart attack\b/] },
  { id: 'pmh_angina', patterns: [/\bangina\b/] },
  { id: 'pmh_stent', patterns: [/\bstent\b/] },
  { id: 'pmh_bypass', patterns: [/\bbypass\b/] },
  { id: 'pmh_arrhythmia', patterns: [/\barrhythmia\b/, /\birregular heartbeat\b/] },
  { id: 'pmh_heart_failure', patterns: [/\bheart failure\b/] },
  { id: 'pmh_kidney_disease', patterns: [/\bkidney disease\b/] },
  { id: 'pmh_lung_disease', patterns: [/\basthma\b/, /\bcopd\b/, /\blung disease\b/] },
  { id: 'pmh_thyroid', patterns: [/\bthyroid\b/] },
  { id: 'pmh_liver_disease', patterns: [/\bliver disease\b/] },
  { id: 'specialist_care', patterns: [/\bspecialist\b/, /\bcardiologist\b/, /\bpulmonologist\b/, /\bdiabetologist\b/] },
  {
    id: 'operations',
    patterns: [/\boperation history\b/, /\boperations?\b/, /\bsurger(y|ies)\b/, /\bprocedure\b/]
  },
  { id: 'operation_date', patterns: [/\bwhen was that exactly\b/, /\bwhen was (the )?(operation|surgery)\b/] },
  { id: 'operation_approach', patterns: [/\bopen or laparoscopic\b/, /\bwas it open\b/, /\blaparoscopic\b/] },
  { id: 'operation_complications', patterns: [/\bcomplications?\b/] },
  { id: 'planned_operation', patterns: [/\bplanned operation\b/] },
  { id: 'previous_examinations', patterns: [/\bprevious examinations\b/] },
  { id: 'previous_ecg', patterns: [/\becg\b/] },
  { id: 'previous_blood_tests', patterns: [/\bblood tests?\b/] },
  { id: 'previous_ultrasound', patterns: [/\bultrasound\b/] },
  { id: 'previous_ct', patterns: [/\bct\b/] },
  { id: 'previous_mri', patterns: [/\bmri\b/] },
  {
    id: 'hospitalizations',
    patterns: [/\bhospitali[sz]ed\b/, /\badmitted\b/, /\badmissions?\b/, /\bhospital stays?\b/]
  },
  {
    id: 'medication',
    patterns: [/\bmedicines?\b/, /\bmedications?\b/, /\bmeds\b/, /\bpills?\b/, /\btablets?\b/, /\bprescriptions?\b/, /\bwhat do you take\b/, /\bregular treatment\b/, /\bsupplements?\b/, /\bover the counter\b/]
  },
  { id: 'medication_regular', patterns: [/\bdo you take medication\b/, /\bwhat medication do you take\b/, /\bany medication\b/, /\bany pills\b/, /\bany tablets\b/, /\bpills regularly\b/] },
  { id: 'medication_supplements', patterns: [/\bsupplements?\b/, /\bvitamins?\b/, /\bherbal\b/] },
  { id: 'medication_otc', patterns: [/\bover the counter\b/, /\botc\b/] },
  { id: 'medication_dose', patterns: [/\bwhat dose\b/, /\bdose\b/] },
  { id: 'medication_frequency', patterns: [/\bhow often do you take\b/, /\bhow often\b/] },
  { id: 'medication_indication', patterns: [/\bwhy do you take it\b/] },
  { id: 'medication_adherence', patterns: [/\bforget your medication\b/, /\btake (it|them) regularly\b/, /\badherence\b/] },
  { id: 'medication_nitroglycerin_previous', patterns: [/\bhave you ever used nitro(glycerin|glycerine|glicerin)?\b/, /\bin the past.*nitro(glycerin|glycerine|glicerin)?\b/, /\bprevious.*nitro(glycerin|glycerine|glicerin)?\b/, /\bntg\b/, /\bspray under tongue\b/, /\btablet under tongue\b/] },
  { id: 'medication_nitroglycerin_current', patterns: [/\bare you using nitro(glycerin|glycerine|glicerin)?\b/, /\bdo you use nitro(glycerin|glycerine|glicerin)?\b/, /\bnitro spray\b/] },
  { id: 'medication_antianginal', patterns: [/\bmedicine for chest pain\b/, /\bmedication for angina\b/, /\bantianginal\b/] },
  {
    id: 'allergies',
    patterns: [/\ballerg\w*\b/, /\breaction\b/, /\bdrug reaction\b/, /\bfood allergy\b/, /\benvironmental allergy\b/, /\bbad reaction\b/, /\brash after medicine\b/, /\bpenicillin\b/, /\blatex\b/]
  },
  { id: 'allergy_reaction', patterns: [/\bwhat reaction\b/] },
  { id: 'allergy_environment_food', patterns: [/\b(food|environmental) allerg\w*\b/, /\bfor environment or food\b/, /\benvironment or food\b/] },
  { id: 'allergy_pollen', patterns: [/\bpollen\b/] },
  { id: 'transfusions', patterns: [/\bblood transfusion\b/, /\btransfusion reaction\b/, /\btransfusions?\b/] },
  {
    id: 'family_history',
    patterns: [/\bfamily history\b/, /\bin your family\b/, /\bfamily\b/, /\bparents?\b/, /\bmother\b/, /\bfather\b/, /\bsiblings?\b/, /\brelatives?\b/, /\bheart disease in family\b/, /\bdiabetes in family\b/, /\bcancer in family\b/]
  },
  { id: 'family_parents', patterns: [/\bparents\b/, /\bare your parents alive\b/] },
  { id: 'family_mother', patterns: [/\bmother\b/, /\bmother die\b/] },
  { id: 'family_father', patterns: [/\bfather\b/, /\bfather die\b/] },
  { id: 'family_cardiovascular', patterns: [/\bheart disease in family\b/, /\bheart attack in family\b/] },
  { id: 'family_stroke', patterns: [/\bstroke in family\b/] },
  { id: 'family_diabetes', patterns: [/\bdiabetes in family\b/] },
  { id: 'family_cancer', patterns: [/\bcancer in family\b/] },
  { id: 'family_genetic', patterns: [/\bgenetic disease\b/] },
  { id: 'epidemiology_travel', patterns: [/\btravel\b/, /\babroad\b/] },
  { id: 'epidemiology_animals', patterns: [/\bpets\b/, /\banimals\b/, /\bfarm animals\b/] },
  { id: 'epidemiology_covid_vaccination', patterns: [/\bcovid vaccination\b/, /\bvaccinated against covid\b/] },
  { id: 'epidemiology_covid_infection', patterns: [/\bcovid infection\b/, /\bdid you have covid\b/] },
  { id: 'epidemiology_contact', patterns: [/\binfectious contact\b/, /\bsick contacts?\b/] },
  { id: 'epidemiology_tick', patterns: [/\btick\b/] },
  { id: 'epidemiology_food', patterns: [/\bsuspicious food\b/, /\bbad food\b/, /\bfood poisoning\b/] },
  { id: 'social_employment', patterns: [/\bdo you work\b/, /\bretired\b/, /\bunemployed\b/] },
  { id: 'social_occupation', patterns: [/\boccupation\b/, /\bjob\b/] },
  { id: 'social_marital_status', patterns: [/\bmarried\b/, /\bsingle\b/, /\bdivorced\b/, /\bwidowed\b/] },
  { id: 'social_living_situation', patterns: [/\blive alone\b/, /\bwho do you live with\b/, /\blive with family\b/] },
  { id: 'social_housing', patterns: [/\bhouse or apartment\b/, /\bapartment\b/, /\bhouse\b/] },
  { id: 'social_housing_floor', patterns: [/\bwhich floor\b/] },
  { id: 'social_housing_elevator', patterns: [/\belevator\b/] },
  {
    id: 'occupation',
    patterns: [/\bwhat do you do\b/, /\bwork\b/, /\bjob\b/, /\boccupation\b/, /\bprofession\b/]
  },
  {
    id: 'living_situation',
    patterns: [/\bwhere do you live\b/, /\bwho do you live with\b/, /\blive alone\b/, /\bliving situation\b/, /\bsupport at home\b/]
  },
  {
    id: 'smoking',
    patterns: [/\bsmok\w*\b/, /\bcigarettes?\b/, /\btobacco\b/, /\bpack years?\b/]
  },
  { id: 'substance_smoking', patterns: [/\bdo you smoke\b/, /\bsmoking\b/, /\bcigarettes?\b/] },
  { id: 'substance_smoking_pack_years', patterns: [/\bpack years\b/, /\bhow many cigarettes\b/, /\bhow long have you smoked\b/] },
  { id: 'substance_alcohol', patterns: [/\bdo you drink alcohol\b/, /\balcohol\b/, /\bbeer\b/, /\bwine\b/, /\bspirits\b/] },
  { id: 'substance_coffee', patterns: [/\bcoffee\b/] },
  { id: 'substance_black_tea', patterns: [/\bblack tea\b/] },
  { id: 'substance_caffeine', patterns: [/\benergy drinks\b/, /\bcaffeine\b/] },
  { id: 'substance_drugs', patterns: [/\bdrugs\b/, /\brecreational drugs\b/] },
  { id: 'gyn_menstruation', patterns: [/\bperiods? regular\b/, /\bmenstruation\b/] },
  { id: 'gyn_lmp', patterns: [/\blast period\b/] },
  { id: 'gyn_menopause', patterns: [/\bmenopause\b/] },
  { id: 'gyn_contraception', patterns: [/\bcontraception\b/] },
  { id: 'gyn_pregnancy', patterns: [/\bpregnant\b/, /\bcould you be pregnant\b/] },
  { id: 'gyn_children', patterns: [/\bchildren\b/] },
  { id: 'gyn_deliveries', patterns: [/\bdeliveries\b/] },
  { id: 'gyn_c_section', patterns: [/\bc section\b/, /\bc-section\b/] },
  { id: 'gyn_miscarriage', patterns: [/\bmiscarriage\b/, /\babortion\b/] },
  { id: 'gyn_pelvic_pain', patterns: [/\bpelvic pain\b/] },
  {
    id: 'alcohol',
    patterns: [/\balcohol\b/, /\bdrink\b/, /\bdrink alcohol\b/, /\bbeer\b/, /\bwine\b/, /\bspirits\b/]
  },
  {
    id: 'recreational_drugs',
    patterns: [/\brecreational drugs\b/, /\bstreet drugs\b/, /\buse drugs\b/, /\bdrug use\b/, /\bcannabis\b/, /\bmarijuana\b/, /\bcocaine\b/]
  },
  {
    id: 'gynecological_history',
    patterns: [/\bperiod\b/, /\bmenstrual\b/, /\blast period\b/, /\bcontraception\b/, /\bvaginal\b/]
  },
  {
    id: 'pregnancy_possibility',
    patterns: [/\bpregnan\w*\b/, /\bmissed period\b/]
  },
  { id: 'vital_temperature', patterns: [/\btemperature\b/, /\bfever measured\b/] },
  { id: 'vital_spo2', patterns: [/\boxygen saturation\b/, /\bspo2\b/] },
  { id: 'vital_hr', patterns: [/\bheart rate\b/, /\bpulse\b/] },
  { id: 'vital_rr', patterns: [/\brespiratory rate\b/] },
  { id: 'vital_bp', patterns: [/\bblood pressure\b/, /\bbp\b/] },
  { id: 'vital_weight', patterns: [/\bweight\b/] },
  { id: 'vital_height', patterns: [/\bheight\b/] },
  { id: 'vital_bmi', patterns: [/\bbmi\b/] },
  { id: 'exam_consciousness', patterns: [/\bconsciousness\b/, /\bis he conscious\b/] },
  { id: 'exam_orientation', patterns: [/\boriented\b/] },
  { id: 'exam_general_appearance', patterns: [/\bgeneral appearance\b/, /\bhow does he look\b/, /\bhow does she look\b/] },
  { id: 'exam_hydration', patterns: [/\bhydration\b/, /\bdehydrated\b/] },
  { id: 'exam_nutrition', patterns: [/\bnutrition\b/] },
  { id: 'exam_gait', patterns: [/\bgait\b/] },
  { id: 'exam_speech', patterns: [/\bspeech\b/] },
  { id: 'exam_skin', patterns: [/\bskin\b/] },
  { id: 'exam_edema', patterns: [/\bedema\b/] },
  { id: 'exam_lymph_nodes', patterns: [/\blymph nodes\b/] },
  { id: 'exam_thyroid', patterns: [/\bthyroid\b/] },
  { id: 'exam_jvp', patterns: [/\bjvp\b/, /\bjugular\b/] },
  { id: 'exam_carotids', patterns: [/\bcarotids?\b/] },
  { id: 'exam_lungs', patterns: [/\blungs?\b/, /\bauscultation lungs\b/, /\blungs clear\b/] },
  { id: 'exam_crackles', patterns: [/\bcrackles\b/] },
  { id: 'exam_wheezing', patterns: [/\bwheezing\b/] },
  { id: 'exam_heart_sounds', patterns: [/\bheart sounds\b/] },
  { id: 'exam_murmur', patterns: [/\bmurmur\b/] },
  { id: 'exam_rhythm', patterns: [/\brhythm\b/] },
  { id: 'exam_abdomen', patterns: [/\babdominal exam\b/, /\babdomen\b/] },
  { id: 'exam_palpation', patterns: [/\bpalpation\b/] },
  { id: 'exam_guarding', patterns: [/\bguarding\b/] },
  { id: 'exam_bowel_sounds', patterns: [/\bbowel sounds\b/] },
  { id: 'exam_blumberg', patterns: [/\bblumberg\b/] },
  { id: 'exam_murphy', patterns: [/\bmurphy\b/] },
  { id: 'exam_mcburney', patterns: [/\bmcburney\b/] },
  { id: 'exam_rovsing', patterns: [/\brovsing\b/] },
  { id: 'exam_tapotement', patterns: [/\btapotement\b/] },
  { id: 'exam_pulses', patterns: [/\bpulses\b/] },
  { id: 'exam_capillary_refill', patterns: [/\bcapillary refill\b/] },
  { id: 'exam_spine', patterns: [/\bspine\b/] },
  { id: 'lab_hb', patterns: [/\bhemoglobin\b/, /\bhb\b/] },
  { id: 'lab_rbc', patterns: [/\bred blood cells\b/, /\brbc\b/] },
  { id: 'lab_hct', patterns: [/\bhematocrit\b/, /\bhct\b/] },
  { id: 'lab_wbc', patterns: [/\bwhite blood cells\b/, /\bwbc\b/] },
  { id: 'lab_platelets', patterns: [/\bplatelets\b/] },
  { id: 'lab_crp', patterns: [/\bcrp\b/] },
  { id: 'lab_creatinine', patterns: [/\bcreatinine\b/] },
  { id: 'lab_urea', patterns: [/\burea\b/] },
  { id: 'lab_sodium', patterns: [/\bsodium\b/] },
  { id: 'lab_potassium', patterns: [/\bpotassium\b/] },
  { id: 'lab_chloride', patterns: [/\bchloride\b/] },
  { id: 'lab_calcium', patterns: [/\bcalcium\b/] },
  { id: 'lab_alt', patterns: [/\balt\b/] },
  { id: 'lab_ast', patterns: [/\bast\b/] },
  { id: 'lab_bilirubin', patterns: [/\bbilirubin\b/] },
  { id: 'lab_glucose', patterns: [/\bglucose\b/] },
  { id: 'lab_cholesterol', patterns: [/\bcholesterol\b/] },
  { id: 'lab_ldl', patterns: [/\bldl\b/] },
  { id: 'lab_hdl', patterns: [/\bhdl\b/] },
  { id: 'lab_triglycerides', patterns: [/\btriglycerides\b/] },
  { id: 'lab_tsh', patterns: [/\btsh\b/] },
  { id: 'lab_troponin', patterns: [/\btroponin\b/] }
];

export function detectIntents(question, patientCase, state, thresholds = {}) {
  const activeThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...thresholds
  };
  const normalizedQuestion = normalizeQuestion(question);
  const { normalized, tokens, ngrams: phrases } = normalizedQuestion;
  const directIntentIds = findDirectIntentIds(normalized);
  const conceptMatches = detectClinicalConcepts(normalized);
  const contextAllowed = shouldApplyContext(normalized, state, directIntentIds, conceptMatches);
  const contextualIntent = contextAllowed ? resolveContextualIntent(normalized, state) : null;
  const shortIntentId = findShortQuestionIntent(normalized, state, contextAllowed);
  if (shortIntentId) directIntentIds.add(shortIntentId);
  const isAmbiguous = AMBIGUOUS_PATTERNS.some((pattern) => normalized.includes(pattern));

  if (!normalized) {
    return emptyDetection('empty');
  }

  const candidates = intentDefinitions.map((intent) => {
    const components = scoreIntent(intent, normalized, tokens, phrases, patientCase, state, contextualIntent);
    if (directIntentIds.has(intent.id)) {
      components.keywordScore = Math.max(components.keywordScore, 1);
      components.contextScore = Math.max(components.contextScore, 0.65);
    }
    const weightedScore =
      components.keywordScore * 0.3 +
      components.synonymScore * 0.25 +
      components.fuzzyScore * 0.15 +
      components.contextScore * 0.15 +
      components.clinicalRelevanceScore * 0.1 +
      components.uncoveredFieldBoost * 0.05;
    const score = weightedScore * 2;

    return {
      ...intent,
      score: round(score),
      components,
      suppressionReason: suppressionReasonFor(intent.id, normalized, contextualIntent, conceptMatches, directIntentIds),
      explicitEvidence: directIntentIds.has(intent.id) || components.keywordScore > 0 || components.synonymScore > 0 || components.fuzzyScore > 0,
      alreadyCovered: state.coveredIntents.includes(intent.id)
    };
  }).sort((a, b) => b.score - a.score);

  const explicitCandidates = candidates.filter((candidate) => !candidate.suppressionReason && (candidate.explicitEvidence || candidate.id === contextualIntent));
  const best = explicitCandidates[0] ?? candidates[0];
  const second = explicitCandidates[1] ?? candidates[1];
  const confidence = calculateConfidence(best?.score ?? 0, second?.score ?? 0, Boolean(contextualIntent || shortIntentId));
  const matchedIntents = selectMatchedIntents(explicitCandidates, normalized, confidence, contextualIntent, directIntentIds);
  const top = matchedIntents[0] ?? best;
  let kind = 'uncertain';
  if (matchedIntents.length && (confidence >= activeThresholds.MATCH_THRESHOLD || top.score >= activeThresholds.MIN_TOP_SCORE_FOR_MATCH)) {
    kind = 'matched';
  } else if (matchedIntents.length && (confidence >= activeThresholds.WEAK_MATCH_THRESHOLD || top.score >= activeThresholds.MIN_TOP_SCORE_FOR_WEAK_MATCH)) {
    kind = 'weak_match';
  }

  if (isAmbiguous && matchedIntents.length === 0) {
    return {
      ...emptyDetection('ambiguous'),
      normalized,
      tokens,
      candidates: candidates.slice(0, 6),
      directMatch: directIntentIds.size > 0,
      directIntentIds: [...directIntentIds],
      conceptMatches,
      suppressedCandidates: candidates.filter((candidate) => candidate.suppressionReason).slice(0, 8),
      priorityTier: priorityTierFor(directIntentIds, conceptMatches, contextualIntent),
      contextBoostApplied: Boolean(contextualIntent),
      debugMatchKind: 'clarification',
      clarification: clarificationFor(normalized, state)
    };
  }

  if (kind === 'uncertain') {
    return {
      kind: isAmbiguous ? 'ambiguous' : 'uncertain',
      normalized,
      tokens,
      bestIntent: null,
      confidence,
      matchedIntents: [],
      candidates: candidates.slice(0, 6),
      directMatch: directIntentIds.size > 0,
      directIntentIds: [...directIntentIds],
      conceptMatches,
      suppressedCandidates: candidates.filter((candidate) => candidate.suppressionReason).slice(0, 8),
      priorityTier: priorityTierFor(directIntentIds, conceptMatches, contextualIntent),
      contextBoostApplied: Boolean(contextualIntent),
      debugMatchKind: 'fallback',
      clarification: isAmbiguous ? clarificationFor(normalized, state) : null,
      fallbackReason: !explicitCandidates.length ? 'no explicit candidate' : `top score ${round(best?.score ?? 0)} below weak threshold`
    };
  }

  return {
    kind,
    normalized,
    tokens,
    bestIntent: matchedIntents[0],
    confidence,
    matchedIntents,
    candidates: candidates.slice(0, 6),
    directMatch: directIntentIds.size > 0,
    directIntentIds: [...directIntentIds],
    conceptMatches,
    suppressedCandidates: candidates.filter((candidate) => candidate.suppressionReason).slice(0, 8),
    priorityTier: priorityTierFor(directIntentIds, conceptMatches, contextualIntent),
    contextBoostApplied: Boolean(contextualIntent),
    debugMatchKind: directIntentIds.size ? 'direct' : kind === 'weak_match' ? 'weak_answered' : 'strong',
    contextualIntent,
    shortIntentId,
    fallbackReason: null
  };
}

function scoreIntent(intent, normalized, tokens, phrases, patientCase, state, contextualIntent) {
  const keywordScore = scoreTerms(intent.keywords ?? [], normalized, tokens, phrases);
  const expandedSynonyms = expandSynonyms(intent);
  const synonymScore = scoreTerms(expandedSynonyms, normalized, tokens, phrases);
  const fuzzyScore = scoreFuzzy([...(intent.keywords ?? []), ...expandedSynonyms], tokens);
  const contextScore = scoreContext(intent, normalized, tokens, state, contextualIntent);
  const clinicalRelevanceScore = scoreClinicalRelevance(intent, patientCase);
  const uncoveredFieldBoost = state.coveredIntents.includes(intent.id) ? 0 : 1;

  return {
    keywordScore,
    synonymScore,
    fuzzyScore,
    contextScore,
    clinicalRelevanceScore,
    uncoveredFieldBoost
  };
}

function scoreTerms(terms, normalized, tokens, phrases) {
  if (!terms.length) return 0;
  let points = 0;
  let possible = 0;

  for (const term of terms) {
    const normalizedTerm = normalize(term);
    if (!normalizedTerm) continue;
    const termTokens = tokenize(normalizedTerm);
    possible += normalizedTerm.includes(' ') ? 2 : 1;
    if (normalizedTerm.includes(' ') && normalized.includes(normalizedTerm)) {
      points += normalizedTerm.includes(' ') ? 2 : 1;
      continue;
    }
    if (!normalizedTerm.includes(' ') && termTokens.length === 1 && /\b[a-z]{1,3}\b/.test(normalizedTerm)) {
      if (tokens.includes(termTokens[0])) points += 0.9;
      continue;
    }
    if (!normalizedTerm.includes(' ') && new RegExp(`\\b${escapeRegex(normalizedTerm)}\\b`).test(normalized)) {
      points += 0.9;
      continue;
    }
    if (termTokens.length === 1 && tokens.includes(termTokens[0])) {
      points += 0.85;
      continue;
    }
    if (termTokens.length > 1 && phrases.includes(termTokens.join(' '))) {
      points += 1.35;
      continue;
    }
    const overlap = termTokens.filter((token) => tokens.includes(token) && !STOP_WORDS.has(token)).length;
    if (overlap) points += Math.min(1, overlap / Math.max(1, termTokens.length));
  }

  return possible ? clamp(points / Math.min(possible, 5), 0, 1) : 0;
}

function scoreFuzzy(terms, tokens) {
  const termTokens = terms
    .flatMap((term) => tokenize(term))
    .filter((token) => token.length > 4 && !STOP_WORDS.has(token));

  if (!termTokens.length || !tokens.length) return 0;

  let matches = 0;
  for (const token of tokens) {
    if (STOP_WORDS.has(token) || token.length < 4) continue;
    const normalizedToken = TYPO_ALIASES[token] ?? token;
    if (termTokens.some((termToken) => fuzzyClose(normalizedToken, termToken))) matches += 1;
  }
  return clamp(matches / Math.min(tokens.length, 4), 0, 1);
}

function scoreContext(intent, normalized, tokens, state, contextualIntent) {
  let score = 0;
  if (intent.id === contextualIntent) score += 1;
  if (state.lastIntent && sameClinicalArea(intent.id, state.lastIntent)) score += 0.25;
  if (tokens.includes('it') && state.currentSymptom === 'pain' && intent.domain === 'hpi') score += 0.25;
  if (tokens.includes('breathing') && ['dyspnea', 'cough', 'sputum', 'wheezing'].includes(intent.id)) score += 0.25;
  if (state.coveredIntents.includes(intent.id)) score -= 0.3;
  return clamp(score, 0, 1);
}

function scoreClinicalRelevance(intent, patientCase) {
  if (patientCase.requiredChecklist.includes(intent.id)) return 1;
  if (patientCase.optionalChecklist.includes(intent.id)) return 0.72;
  if (intent.requiredFor?.includes(patientCase.caseType)) return 0.8;
  if (intent.requiredFor?.includes('all')) return 0.6;
  if (patientCase.identity.sex !== 'Female' && intent.domain === 'gynecology') return 0;
  return 0.35;
}

function resolveContextualIntent(normalized, state) {
  if (state.pendingClarificationIntent && /^(yes|yeah|yep|correct|that|that one|exactly|please do)$/.test(normalized)) {
    return state.pendingClarificationIntent;
  }
  if (['allergies', 'allergy_reaction', 'allergy_environment_food', 'allergy_pollen'].includes(state.lastIntent)) {
    if (/\b(environment|food)\b/.test(normalized)) return 'allergy_environment_food';
    if (/\bpollen\b/.test(normalized)) return 'allergy_pollen';
    if (/\breaction|happens\b/.test(normalized)) return 'allergy_reaction';
  }
  if (['operations', 'hospitalizations', 'operation_date', 'operation_approach', 'operation_complications'].includes(state.lastIntent)) {
    if (/\bwhen\b/.test(normalized)) return 'operation_date';
    if (/\b(open|laparoscopic)\b/.test(normalized)) return 'operation_approach';
    if (/\bcomplications?\b/.test(normalized)) return 'operation_complications';
  }
  if (['medication', 'medication_regular', 'medication_dose', 'medication_frequency', 'medication_indication'].includes(state.lastIntent)) {
    if (/\bdose\b/.test(normalized)) return 'medication_dose';
    if (/\bhow often\b/.test(normalized)) return 'medication_frequency';
    if (/\bwhy\b/.test(normalized)) return 'medication_indication';
  }
  for (const item of FOLLOW_UP_MAP) {
    if (item.phrases.some((phrase) => normalized.includes(phrase))) return item.id;
  }
  if (/^(where|where exactly|where is it|where was it|where do you feel it)$/.test(normalized)) return 'pain_site';
  if (/^(when|since when|when exactly|when did it begin|when did it start)$/.test(normalized)) return 'pain_onset';
  if (/^(what kind|what type|describe it|what does it feel like)$/.test(normalized)) return 'pain_character';
  if (/^(does it move|does it spread|does it travel|does it radiate|where does it go)$/.test(normalized)) return 'pain_radiation';
  if (/^(how bad|how severe|how strong|rate it)$/.test(normalized)) return 'pain_severity';
  if (normalized === 'anything else') return 'pain_associated_symptoms';
  if (normalized.includes('how much') && state.lastIntent === 'alcohol') return 'alcohol';
  if (normalized.includes('how many') && state.lastIntent === 'smoking') return 'smoking';
  if (normalized.includes('what color') && state.lastIntent === 'sputum') return 'sputum_color';
  return null;
}

function findShortQuestionIntent(normalized, state, contextAllowed = true) {
  const compact = normalized.trim();
  if (!compact || compact.split(' ').length > 5) return null;

  for (const item of SHORT_QUESTION_INTENTS) {
    if (item.patterns.some((pattern) => pattern.test(compact))) {
      if (['pain_site', 'pain_onset', 'pain_severity', 'pain_radiation', 'pain_associated_symptoms'].includes(item.id)) {
        return contextAllowed && (state.currentSymptom || state.currentTopic) ? item.id : null;
      }
      return item.id;
    }
  }

  return null;
}

function findDirectIntentIds(normalized) {
  return new Set(
    DIRECT_INTENT_PATTERNS
      .filter((item) => item.patterns.some((pattern) => pattern.test(normalized)))
      .map((item) => item.id)
  );
}

function detectClinicalConcepts(normalized) {
  return Object.entries(CONCEPT_GROUPS)
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(normalized)))
    .map(([name]) => name);
}

function shouldApplyContext(normalized, state, directIntentIds, conceptMatches) {
  if (state.pendingClarificationIntent && /^(yes|yeah|yep|correct|that|that one|exactly|please do)$/.test(normalized)) return true;
  if (directIntentIds.size) {
    const directIds = [...directIntentIds];
    return directIds.every((id) => id.startsWith('hpi_') || id.startsWith('pain_'));
  }
  const hasBlockingConcept = conceptMatches.some((concept) => CONTEXT_BLOCKING_CONCEPTS.has(concept));
  if (hasBlockingConcept) return false;
  const words = normalized.split(' ').filter(Boolean);
  return words.length <= 6 || /\b(it|this|that|the pain|the problem|with it)\b/.test(normalized);
}

function priorityTierFor(directIntentIds, conceptMatches, contextualIntent) {
  if (directIntentIds.size) return 2;
  if (conceptMatches.some((item) => ['identityConcept', 'admissionConcept', 'socialConcept'].includes(item))) return 3;
  if (conceptMatches.some((item) => ['medicationConcept', 'allergyConcept', 'pmhConcept', 'familyConcept', 'examConcept', 'vitalsConcept', 'labsConcept'].includes(item))) return 4;
  if (conceptMatches.includes('associatedSymptomsConcept')) return 5;
  if (contextualIntent) return 6;
  return conceptMatches.length ? 7 : 8;
}

function selectMatchedIntents(candidates, normalized, confidence, contextualIntent, directIntentIds = new Set()) {
  const hasListLanguage = /\b(and|or|,)\b/.test(normalized);
  const threshold = contextualIntent ? 0.48 : 0.62;
  const topScore = candidates[0]?.score ?? 0;
  const limit = !hasListLanguage && directIntentIds.size === 1
    ? 1
    : hasListLanguage ? 4 : Math.max(1, confidence > 0.72 ? 2 : 1);

  const selected = candidates
    .filter((candidate) => {
      if (candidate.suppressionReason || isLikelyFalsePositive(candidate.id, normalized, contextualIntent)) return false;
      if (candidate.id === contextualIntent && candidate.score >= 0.4) return true;
      if (!candidate.explicitEvidence) return false;
      if (candidate.score >= threshold && candidate.score >= topScore * 0.55) return true;
      return hasListLanguage && candidate.score >= 0.34;
    })
    .slice(0, limit);
  const seen = new Set();
  return selected.filter((candidate) => {
    const canonical = canonicalIntentFor(candidate.id);
    if (seen.has(canonical)) return false;
    seen.add(canonical);
    return true;
  });
}

function canonicalIntentFor(intentId) {
  const aliases = {
    hpi_site: 'pain_site',
    hpi_onset: 'pain_onset',
    hpi_circumstances: 'pain_circumstances',
    hpi_character: 'pain_character',
    hpi_radiation: 'pain_radiation',
    hpi_severity: 'pain_severity',
    hpi_exacerbating: 'pain_exacerbating',
    hpi_relieving: 'pain_relieving',
    hpi_timing: 'pain_timing',
    hpi_course: 'pain_course',
    hpi_associated_symptoms: 'pain_associated_symptoms',
    medication_regular: 'medication',
    substance_smoking: 'smoking',
    substance_alcohol: 'alcohol',
    substance_drugs: 'recreational_drugs'
  };
  return aliases[intentId] ?? intentId;
}

function suppressionReasonFor(intentId, normalized, contextualIntent, conceptMatches, directIntentIds) {
  if (intentId === 'pain_site' || intentId === 'hpi_site') {
    if (conceptMatches.includes('identityConcept') && /\b(where are you from|where do you live|which town|what city|address)\b/.test(normalized)) {
      return 'identity/location wording overrides pain-site context';
    }
  }
  if (intentId === 'pain_onset' || intentId === 'hpi_onset') {
    if (conceptMatches.includes('admissionConcept') && !/\b(pain|symptom|problem|it) (start|begin|started|began)\b/.test(normalized)) {
      return 'admission timing wording overrides symptom-onset context';
    }
  }
  if (intentId === 'previous_ct' && !/\bct\b|\bct scan\b/.test(normalized)) {
    return 'CT requires standalone abbreviation or CT scan';
  }
  if ((intentId === 'living_situation' || intentId === 'social_living_situation') && directIntentIds.has('identity_residence')) {
    return 'residence question should answer city/address, not household support';
  }
  if (intentId === 'allergies' && directIntentIds.has('allergy_reaction') && !/\ballerg\w*|alerg\w*|penicillin|latex|food allergy|drug allergy\b/.test(normalized)) {
    return 'reaction follow-up should answer the reaction, not re-list allergies';
  }
  if (intentId === 'family_history' && conceptMatches.includes('socialConcept') && /\b(live with family|who do you live with|do you live with|live alone)\b/.test(normalized)) {
    return 'living-with-family wording is social history, not family disease history';
  }
  if ((intentId === 'alcohol' || intentId === 'substance_alcohol') && /\b(coffee|black tea|energy drinks?|caffeine)\b/.test(normalized) && !/\b(alcohol|beer|wine|spirits)\b/.test(normalized)) {
    return 'caffeine wording suppresses alcohol';
  }
  if ((intentId === 'lab_ast' || intentId === 'lab_alt') && !new RegExp(`\\b${intentId.slice(4)}\\b`).test(normalized)) {
    return 'short lab abbreviation must be standalone';
  }
  if (isLikelyFalsePositive(intentId, normalized, contextualIntent)) {
    return 'negative evidence rule';
  }
  return null;
}

function isLikelyFalsePositive(intentId, normalized, contextualIntent) {
  if (intentId === 'pain_timing' && /\b(introduc\w*|introduction|consent|permission)\b/.test(normalized)) {
    return true;
  }
  if (intentId === 'pain_exacerbating' && /\b(short of breath|breathless|difficulty breathing|hard to breathe)\b/.test(normalized)) {
    return !/\b(worse|aggravat\w*|trigger\w*|bring\w* it on|exacerbat\w*)\b/.test(normalized);
  }
  if (intentId === 'pain_exacerbating' && /\b(breth|breath|breathing)\b/.test(normalized)) {
    return !/\b(worse|aggravat\w*|trigger\w*|bring\w* it on|exacerbat\w*)\b/.test(normalized);
  }
  if (intentId === 'pain_associated_symptoms' && /\b(nausea or vomiting|go away or better|reliev|alleviat|makes it better)\b/.test(normalized)) {
    return true;
  }
  if ((intentId === 'pain_radiation' || intentId === 'pain_site') && /\b(go away or better|reliev|alleviat|makes it better)\b/.test(normalized)) {
    return true;
  }
  if ((intentId.startsWith('pain_') || intentId.startsWith('hpi_')) && /\b(urination|urinary|stool|bowel|diarrhea|constipation|visual|vision|hearing|ear)\b/.test(normalized) && !/\bpain\b/.test(normalized)) {
    return true;
  }
  if (intentId === 'chief_complaint' && /\b(urination|urinary|stool|bowel|diarrhea|constipation)\b/.test(normalized)) {
    return true;
  }
  if (intentId === 'exam_bowel_sounds') {
    return !/\bbowel sounds?\b/.test(normalized);
  }
  if (['past_medical_history', 'past_cardiac_history', 'pmh_ischemic_heart_disease', 'pmh_previous_mi', 'pmh_cardiovascular_disease', 'pmh_angina', 'pmh_stent', 'pmh_bypass', 'pmh_arrhythmia'].includes(intentId)) {
    if (/\bin family\b|\bfamily\b/.test(normalized)) return true;
  }
  if (intentId === 'past_cardiac_history') {
    return !/\b(heart|cardiac|cardiovascular|cvs|coronary|angina|stent|bypass|arrhythmia|mi|myocardial)\b/.test(normalized);
  }
  if (intentId === 'past_medical_history' && /\b(high blood pressure|hypertension|diabetes|cholesterol|heart disease|heart condition|kidney disease|asthma|copd|thyroid|liver disease)\b/.test(normalized)) {
    return true;
  }
  if (intentId === 'medication' && /\b(over the counter|otc|supplements?|vitamins?|herbal)\b/.test(normalized)) {
    return true;
  }
  if (intentId === 'medication_antianginal') {
    return !/\b(angina|chest pain|nitro|ntg|spray under tongue|tablet under tongue)\b/.test(normalized);
  }
  if (intentId === 'fever' && /\bsweat\w*\b/.test(normalized)) {
    return !/\b(fever|temperature|chills?|shiver\w*|hot)\b/.test(normalized);
  }
  if (intentId === 'fever' && /\bwhat is (his|her|the)?\s*temperature\b|\btemperature (is|was|taken|measured)\b/.test(normalized)) {
    return true;
  }
  if (intentId === 'fever' && /^temperature$/.test(normalized)) {
    return true;
  }
  if (intentId === 'cough' && /\b(blood when coughing|coughing blood|blood in sputum|hemoptysis)\b/.test(normalized)) {
    return true;
  }
  if (intentId === 'weight_loss') {
    return !/\b(weight|lost weight|losing weight|night sweats?)\b/.test(normalized);
  }
  if (intentId === 'vital_weight') {
    return /\b(lost weight|losing weight|weight loss)\b/.test(normalized);
  }
  if (intentId === 'hospitalizations') {
    return /\b(when were you admitted|when did you come|when did you arrive)\b/.test(normalized);
  }
  if (intentId === 'severe_dyspnea') {
    return !/\b(severe|cannot breathe|can't breathe|too breathless|very bad|short sentences?)\b/.test(normalized);
  }
  if (intentId === 'allergies') {
    return !/\b(allerg\w*|alerg\w*|reaction|penicillin|latex)\b/.test(normalized);
  }
  if (intentId === 'medication') {
    return /\b(recreational drugs|street drugs|use drugs|cannabis|marijuana|cocaine)\b/.test(normalized);
  }
  if (intentId === 'recreational_drugs' || intentId === 'substance_drugs') {
    if (/\b(allerg\w*|alerg\w*|reaction|penicillin|latex)\b/.test(normalized)) return true;
    return !/\b(recreational drugs|street drugs|use drugs|drug use|cannabis|marijuana|cocaine|weed|opioid)\b/.test(normalized);
  }
  if (intentId === 'family_history') {
    return /\b(live with family|who do you live with|do you live with|live alone)\b/.test(normalized) ||
      /\b(heart attack|heart disease|stroke|diabetes|cancer|kidney|epilepsy|thyroid|autoimmune|genetic)\b/.test(normalized);
  }
  if (intentId === 'alcohol' || intentId === 'substance_alcohol') {
    return /\b(coffee|black tea|energy drinks?|caffeine)\b/.test(normalized) && !/\b(alcohol|beer|wine|spirits)\b/.test(normalized);
  }
  if (intentId === 'lab_ast') {
    return !/\bast\b/.test(normalized);
  }
  if (intentId === 'lab_alt') {
    return !/\balt\b/.test(normalized);
  }
  if (intentId === 'hemoptysis') {
    return !/\b(blood|bloody|hemoptysis)\b/.test(normalized);
  }
  if (intentId === 'sputum_color' && contextualIntent !== 'sputum_color') {
    return !/\b(color|yellow|green|brown|clear|white|grey|gray)\b/.test(normalized);
  }
  if (intentId === 'living_situation') {
    return /\b(oxygen|inhaler|nebulizer|puffer)\b/.test(normalized);
  }
  if (intentId === 'oxygen_use') {
    return !/\boxygen\b/.test(normalized);
  }
  if (intentId === 'inhaler_medication') {
    return !/\b(inhaler|inhalers|puffer|nebulizer|spray|ventolin|tiotropium)\b/.test(normalized);
  }
  return false;
}

function expandSynonyms(intent) {
  const fromDictionary = [
    ...intent.id.split('_'),
    ...(intent.relatedSymptoms ?? []),
    intent.domain
  ].flatMap((key) => synonymDictionary[key] ?? []);
  return [...new Set([...(intent.synonyms ?? []), ...fromDictionary])];
}

function sameClinicalArea(intentA, intentB) {
  const a = intentDefinitions.find((intent) => intent.id === intentA);
  const b = intentDefinitions.find((intent) => intent.id === intentB);
  return Boolean(a && b && a.domain === b.domain);
}

function clarificationFor(normalized, state) {
  if (normalized.includes('down there')) return 'Do you mean urination, bowel movements, genital symptoms, or something else?';
  if (state.currentSymptom === 'breathing') return 'Do you mean my breathing, cough, phlegm, or general condition?';
  return 'Do you mean the pain, my breathing, medicines, or something else?';
}

function calculateConfidence(top, second, contextResolved) {
  if (top <= 0) return 0;
  const strength = clamp(top / 0.85, 0, 1);
  const separation = clamp((top - second) / Math.max(top, 0.01), 0, 1);
  return round(strength * 0.7 + separation * 0.2 + (contextResolved ? 0.1 : 0));
}

function emptyDetection(kind) {
  return {
    kind,
    normalized: '',
    bestIntent: null,
    confidence: 0,
    matchedIntents: [],
    candidates: [],
    clarification: null
  };
}

export function normalize(value) {
  return normalizeQuestion(value).normalized;
}

export function normalizeQuestion(value) {
  const normalized = String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bmeds\b/g, 'medication')
    .replace(/\bpills?\b|\btablets?\b/g, 'medication')
    .replace(/\bpee\b|\bpeeing\b/g, 'urination')
    .replace(/\bpoop\b|\bpoo\b/g, 'stool')
    .replace(/\bbreathless\b/g, 'short of breath')
    .replace(/\bheart racing\b|\bheart pounding\b/g, 'palpitations')
    .replace(/\bpassed out\b|\bblacked out\b/g, 'syncope')
    .replace(/\bcolour\b/g, 'color')
    .replace(/\bhaemoglobin\b/g, 'hemoglobin')
    .replace(/\bdiarrhoea\b/g, 'diarrhea')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = tokenizeNormalized(normalized);
  return {
    original: String(value ?? ''),
    normalized,
    tokens,
    ngrams: makeNgrams(tokens, 4)
  };
}

export function tokenize(value) {
  return tokenizeNormalized(normalize(value));
}

function tokenizeNormalized(value) {
  return value
    .split(' ')
    .filter((token) => token && !STOP_WORDS.has(token))
    .map((token) => TYPO_ALIASES[token] ?? token)
    .map(lightStem);
}

function lightStem(token) {
  return token
    .replace(/ies$/, 'y')
    .replace(/ing$/, '')
    .replace(/ed$/, '')
    .replace(/ly$/, '')
    .replace(/s$/, '');
}

function makeNgrams(tokens, maxSize = 4) {
  const grams = [];
  for (let size = 2; size <= maxSize; size += 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      grams.push(tokens.slice(index, index + size).join(' '));
    }
  }
  return grams;
}

function fuzzyClose(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 2) return false;
  const distance = levenshtein(a, b);
  return distance <= (Math.max(a.length, b.length) > 7 ? 2 : 1);
}

function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, (_, row) => [row]);
  for (let column = 1; column <= b.length; column += 1) matrix[0][column] = column;
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
