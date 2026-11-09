// Transcribed from the runtime case HPI. Optional attributes are left out when
// the source does not specify them. Keys under each intent are question facets.
export const PRESENTING_SYMPTOMS = {
  chest_pain_acs_risk: { name: 'chest pressure', aliases: /\b(chest (?:pain|pressure|discomfort)|breastbone)\b/, region: 'chest' },
  abdominal_pain_cholecystitis: { name: 'upper abdominal pain', aliases: /\b((?:abdominal|stomach|belly) pain|right upper quadrant|right ribs)\b/, region: 'abdomen' },
  progressive_dyspnea_edema: { name: 'breathlessness', aliases: /\b(breathlessness|shortness of breath|breathing trouble|dyspnea)\b/, region: 'breathing' },
  fever_flank_dysuria: { name: 'right flank pain', aliases: /\b(flank pain|right side pain|side pain)\b/, region: 'flank' },
  melena_dizziness_nsaid: { name: 'black stools', aliases: /\b(black stools?|tarry stools?|melena)\b/, region: 'bowel' },
  exertional_syncope: { name: 'fainting spell', aliases: /\b(fainting|faint|fainted|pass(?:ed)? out|black(?:ed)? out|collapse|syncope)\b/, region: null },
  weight_loss_bowel_change: { name: 'change in bowel habit', aliases: /\b(bowel (?:change|changes|habit)|constipation|loose stools?)\b/, region: 'bowel' },
  recurrent_headache_migraine: { name: 'headache', aliases: /\b(headache|head pain|migraine)\b/, region: 'head' }
};

const elapsed = (value, unit, { about = false, reference = 'now' } = {}) => ({ value, unit, about, reference });
const timing = (phrase) => ({ phrase });
const rating = (value, qualifier = 'about') => ({ value, scale: 10, qualifier });
const sites = (...values) => ({ values });
const statement = (...clauses) => ({ overview: { clauses } });
const clause = (verb, complement, options = {}) => ({ verb, complement, ...options });
const absence = (verb, complement, options = {}) => ({ overview: { state: 'absent', clauses: [clause(verb, complement, { ...options, negative: true })] } });
const medication = (name, dose, unit, frequency, indication) => ({ name, dose, unit, frequency, indication });

const noRadiation = { values: [], state: 'absent' };

export const CONVERSATION_FACTS = {
  chest_pain_acs_risk: {
    hpi_site: { location: 'mainly in the middle of my chest, behind my breastbone' },
    hpi_onset: { 'onset.time': elapsed(2, 'hour', { about: true, reference: 'admission' }) },
    hpi_activity_at_onset: { 'onset.activity': 'walking from the parking lot toward work' },
    hpi_character: { 'character.qualities': { positive: ['heavy pressure', 'tightness'], negative: ['stabbing pain'] } },
    hpi_radiation: { 'radiation.sites': sites('left arm', 'jaw') },
    hpi_timing: { 'timing.pattern': 'comes back after easing with rest', 'timing.duration': { ...elapsed(30, 'minute', { about: true }), episode: 'worst spell' } },
    hpi_severity: { 'severity.current': rating(4, 'around'), 'severity.worst': rating(8, '') },
    hpi_course: { progression: 'improved after resting but has not disappeared completely' },
    ros_hemoptysis: { presence: { state: 'absent' } },
    allergies: absence('know of', 'any drug allergies'),
    transfusions: absence('had', 'a blood transfusion', { auxiliary: 'have' }),
    pmh_chronic_diseases: statement(clause('have', 'high blood pressure and high cholesterol'), clause('know of', 'any diabetes', { negative: true })),
    family_diabetes: statement(clause('has', 'type 2 diabetes', { subject: 'my mother' })),
    social_household: statement(clause('live with', 'my wife')),
    epi_travel: absence('travelled', 'abroad recently', { auxiliary: 'have' }),
    substance_smoking: statement(clause('smoke', 'cigarettes every day')),
    substance_drugs: absence('use', 'recreational drugs')
  },
  abdominal_pain_cholecystitis: {
    hpi_site: { location: 'under my right ribs, more toward the upper abdomen' },
    hpi_onset: { 'onset.time': timing('yesterday evening, about two hours after dinner') },
    hpi_character: { 'character.qualities': { positive: ['constant cramping', 'pressure'] } },
    hpi_radiation: { 'radiation.sites': sites('right shoulder blade') },
    hpi_timing: { 'timing.pattern': 'has been there most of the time since last evening' },
    hpi_severity: { 'severity.current': rating(7) },
    hpi_course: { progression: 'is getting worse compared with yesterday' },
    ros_hemoptysis: { presence: { state: 'absent' } },
    allergies: statement(clause('am allergic to', 'penicillin'), clause('had', 'a rash as a child')),
    transfusions: absence('had', 'a blood transfusion', { auxiliary: 'have' }),
    gyn_lmp: statement(clause('are', 'regular', { subject: 'my periods' }), clause('was', 'about two weeks ago', { subject: 'my last period' })),
    gyn_contraception: statement(clause('use', 'condoms for contraception', { subject: 'we' })),
    social_household: statement(clause('live with', 'my husband and our two children')),
    epi_travel: absence('travelled', 'recently', { auxiliary: 'have' }),
    substance_drugs: absence('use', 'recreational drugs')
  },
  progressive_dyspnea_edema: {
    hpi_onset: { 'onset.type': 'gradual', 'onset.time': { ...elapsed(3, 'week', { about: true, reference: 'interval' }), subject: 'My breathing', verb: 'has been getting worse over' } },
    hpi_activity_at_onset: { 'onset.activity': { activity: 'walking uphill', firstNoticed: true } },
    hpi_course: { progression: 'is steadily getting worse' },
    ros_hemoptysis: { presence: { state: 'absent' } },
    chief_complaint: statement(clause('have', 'swollen ankles'), clause('has been getting', 'steadily worse', { subject: 'my breathing' })),
    pmh_chronic_diseases: statement(clause('have', 'high blood pressure and type 2 diabetes')),
    social_household: statement(clause('live with', 'my wife')),
    substance_drugs: absence('use', 'recreational drugs')
  },
  fever_flank_dysuria: {
    hpi_site: { location: 'in my right side and back, just below my ribs' },
    hpi_radiation: { 'radiation.sites': noRadiation },
    hpi_timing: { 'timing.pattern': 'has been fairly constant since yesterday' },
    hpi_severity: { 'severity.current': rating(7) },
    hpi_course: { progression: 'is worse today' },
    chief_complaint: statement(clause('have', 'a fever, pain in my right side and pain when I pass urine')),
    pmh_chronic_diseases: absence('have', 'any chronic conditions'),
    gyn_obstetric: absence('been', 'pregnant before', { auxiliary: 'have' })
  },
  melena_dizziness_nsaid: {
    hpi_onset: { 'onset.time': { ...timing('yesterday'), subject: 'The black stools', verb: 'started' } },
    hpi_timing: { 'timing.frequency': { count: 2, event: 'black stool', period: 'since yesterday' } },
    chief_complaint: statement(clause('have', 'black stools'), clause('feel', 'weak and dizzy')),
    pmh_chronic_diseases: statement(clause('have', 'osteoarthritis and high blood pressure')),
    substance_drugs: absence('use', 'recreational drugs')
  },
  exertional_syncope: {
    hpi_onset: { 'onset.time': { ...timing('this afternoon'), verb: 'happened' }, 'onset.type': 'sudden' },
    hpi_activity_at_onset: { 'onset.activity': 'walking uphill' },
    hpi_timing: { 'timing.duration': { value: 1, unit: 'minute', limit: 'less than', episode: 'loss of consciousness', source: 'my granddaughter' } },
    chief_complaint: statement(clause('passed out', 'briefly while I was exerting myself'))
  },
  weight_loss_bowel_change: {
    hpi_onset: { 'onset.time': { ...elapsed(4, 'month', { about: true }), subject: 'The bowel changes' } },
    hpi_timing: { 'timing.pattern': 'is noticeable most weeks' },
    hpi_course: { progression: 'has gradually become more noticeable' },
    chief_complaint: statement(clause('have lost', 'weight without trying'), clause('have noticed', 'a change in my bowel habit')),
    family_cancer: statement(clause('had', 'colon cancer at age 68', { subject: 'my mother' }))
  },
  recurrent_headache_migraine: {
    hpi_site: { location: 'usually on the left side, around my temple and behind my eye' },
    hpi_onset: { 'onset.type': 'gradual' },
    hpi_activity_at_onset: { 'onset.activity': 'studying at my laptop' },
    hpi_character: { 'character.qualities': { positive: ['throbbing', 'pounding'] } },
    hpi_timing: { 'timing.duration': { value: 4, max: 12, unit: 'hour', condition: 'if I do not treat them', episode: 'attacks' } },
    hpi_severity: { 'severity.current': { ...rating(7), reference: 'today' } },
    chief_complaint: statement(clause('keep getting', 'severe headaches on one side')),
    gyn_obstetric: absence('been', 'pregnant before', { auxiliary: 'have' }),
    substance_drugs: absence('use', 'recreational drugs')
  }
};

// Only case-authored drug details. The general medication questions still
// use the original overview, which can include additional qualifications.
export const MEDICATION_DETAILS = {
  chest_pain_acs_risk: [
    medication('ramipril', 5, 'mg', 'once each morning', 'high blood pressure'),
    medication('atorvastatin', 20, 'mg', 'once at night', 'cholesterol'),
    medication('ibuprofen', 400, 'mg', 'only occasionally when I need it', 'back pain')
  ],
  abdominal_pain_cholecystitis: [medication('paracetamol', 500, 'mg', 'occasionally when needed', 'occasional pain')],
  progressive_dyspnea_edema: [
    medication('bisoprolol', 5, 'mg'), medication('ramipril', 5, 'mg'), medication('furosemide', 40, 'mg'),
    medication('metformin', 1, 'g', 'twice daily'), medication('atorvastatin', 40, 'mg')
  ],
  melena_dizziness_nsaid: [
    medication('amlodipine', 5, 'mg', 'daily', 'high blood pressure'),
    medication('ibuprofen', 400, 'mg', 'most days, often two or three times a day', 'knee pain')
  ],
  exertional_syncope: [medication('amlodipine', 5, 'mg', 'once daily', 'high blood pressure')],
  weight_loss_bowel_change: [medication('levothyroxine', 75, 'micrograms', 'once each morning', 'an underactive thyroid')],
  recurrent_headache_migraine: [medication('ibuprofen', 400, 'mg', 'when needed, usually one or two doses during an attack, perhaps twice a month', 'headache relief')]
};

export const MEDICATION_NAMES = [...new Set(Object.values(MEDICATION_DETAILS).flatMap(drugs => drugs.map(drug => drug.name)))];
