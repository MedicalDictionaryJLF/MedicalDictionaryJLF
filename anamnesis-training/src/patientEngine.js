import { INTENTS, QUESTION_AREAS } from './data/interviewSchema.js';
import { renderIntentAnswer } from './dialogue/responseTemplates.js';

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
const YES_WORDS = ['yes', 'yeah', 'yep', 'correct', 'exactly', 'that', 'yes that'];
const NO_WORDS = ['no', 'not that', 'no i mean'];

const ATTEMPT_RULES = [
  ['identity_dob', /\b(date of birth|birth date|when were you born|born exactly|exact date.*birth|birthday)\b/],
  ['identity_age', /\b(how old|what is your age|your age)\b/],
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
  ['chief_complaint', /\b(why did you come|why are you here|what brought you|main problem|what happened|what is wrong|how can i help)\b/],
  ['allergies', /\b(allerg\w*|alerg\w*)\b/],
  ['medication_regular', /\b(medication|medicine|meds|pills|tablets|what are you on)\b/],
  ['pmh_chronic_diseases', /\b(chronic diseases?|medical problems?|previous diseases?|hypertension|high blood pressure|diabetes|cholesterol)\b/],
  ['pmh_cardiovascular_disease', /\b(heart disease|cardiac disease|cardiovascular disease|heart attack|mi|stent|bypass|angina)\b/],
  ['family_history', /\b(family history|mother|father|parents|siblings|relatives)\b/],
  ['substance_smoking', /\b(smok\w*|cigarette\w*|tobacco)\b/]
];

export const MEDICAL_TERMINOLOGY = {
  dyspnea: { intent: 'ros_respiratory', patientFriendly: 'Do you feel short of breath?', difficulty: 'high' },
  dysuria: { intent: 'ros_genitourinary', patientFriendly: 'Do you have pain or burning when passing urine?', difficulty: 'high' },
  hemoptysis: { intent: 'ros_respiratory', patientFriendly: 'Have you coughed up blood?', difficulty: 'high' },
  orthopnea: { intent: 'ros_respiratory', patientFriendly: 'Do you feel short of breath when lying flat?', difficulty: 'high' },
  syncope: { intent: 'ros_cardiovascular', patientFriendly: 'Have you fainted or lost consciousness?', difficulty: 'medium' },
  palpitations: { intent: 'ros_cardiovascular', patientFriendly: 'Do you feel your heart racing or beating irregularly?', difficulty: 'medium' },
  edema: { intent: 'ros_cardiovascular', patientFriendly: 'Have you noticed swelling, especially in your legs or ankles?', difficulty: 'medium' },
  melena: { intent: 'ros_gastrointestinal', patientFriendly: 'Have your stools been black or tar-like?', difficulty: 'high' },
  hematemesis: { intent: 'ros_gastrointestinal', patientFriendly: 'Have you vomited blood?', difficulty: 'high' },
  nocturia: { intent: 'ros_genitourinary', patientFriendly: 'Do you wake up at night to urinate?', difficulty: 'medium' },
  polyuria: { intent: 'ros_genitourinary', patientFriendly: 'Are you urinating much more than usual?', difficulty: 'high' },
  polydipsia: { intent: 'ros_general', patientFriendly: 'Are you much more thirsty than usual?', difficulty: 'high' },
  dysphagia: { intent: 'ros_gastrointestinal', patientFriendly: 'Do you have difficulty swallowing?', difficulty: 'high' },
  paresthesia: { intent: 'ros_neurological', patientFriendly: 'Do you feel tingling, numbness, or pins and needles?', difficulty: 'high' },
  vertigo: { intent: 'ros_head_neck', patientFriendly: 'Do you feel like the room is spinning?', difficulty: 'medium' },
  cephalgia: { intent: 'ros_head_neck', patientFriendly: 'Do you have a headache?', difficulty: 'high' },
  cyanosis: { intent: 'ros_skin', patientFriendly: 'Have your lips or fingers turned blue?', difficulty: 'high' },
  diaphoresis: { intent: 'hpi_associated_symptoms', patientFriendly: 'Were you sweating unusually?', difficulty: 'high' }
};

const DIRECT_RULES = [
  [/\b(what is your name|your name|who are you|full name)\b/, ['identity_name'], 'single_intent'],
  [/\b(date of birth|birth date|when were you born|born exactly|exact date of birth|birthday)\b/, ['identity_dob'], 'single_intent'],
  [/\b(how old|what is your age|age\??)\b/, ['identity_age'], 'single_intent'],
  [/\b(male or female|sex|gender)\b/, ['identity_sex'], 'single_intent'],
  [/\b(where are you from|where do you live|which town|what town|what city|address|residence)\b/, ['identity_residence'], 'single_intent'],
  [/\b(when did (they )?admit you|when were you admitted|when did you come|when did you arrive|what time did you come|when did you get here)\b/, ['administrative_admission_time'], 'single_intent'],
  [/\b(how did you get here|how did you arrive|how did you get to (the )?hospital|by which mode of transport did you (come|get to (the )?hospital)|what transportation brought you here|did you come by ambulance|did someone drive you|who brought you|did you walk here|were you brought by emergency services|come alone|came alone|ambulance|how did you come)\b/, ['administrative_arrival_method'], 'single_intent'],
  [/\b(what brought you|why did you come|why are you here|what happened|what is wrong|main problem|how can i help|tell me about the problem|what was the reason|what is the reason|reason for coming|reason for admission|reason you came)\b/, ['chief_complaint'], 'broad_open_history'],
  [/\b(where is the pain|where does it hurt|site of pain|location of pain)\b/, ['hpi_site'], 'single_intent'],
  [/\b(when did (the )?(pain|symptom|problem) start|onset of pain|when did it start|since when)\b/, ['hpi_onset'], 'single_intent'],
  [/\b(what were you doing|doing when it started|activity at onset|circumstances at onset)\b/, ['hpi_activity_at_onset'], 'single_intent'],
  [/\b(character of (the )?pain|what is the character|what is its character|what character is (the )?pain|what type of pain|what type is it|what kind of pain|what kind is it|what is the pain like|what does it feel like|how would you describe (it|your pain|the pain)|describe (your|the) pain)\b/, ['hpi_character'], 'single_intent'],
  [/\b(radiation of (the )?pain|does it radiate|is it radiating|does the pain radiate|does it spread|does the pain spread|does it go anywhere|was the pain moving somewhere|does it move|does it travel|does it shoot|go to (your )?(arm|jaw|back))\b/, ['hpi_radiation'], 'single_intent'],
  [/\b(associated symptoms|any other symptoms|anything else with it|symptoms accompanying|accompanying the pain)\b/, ['hpi_associated_symptoms'], 'single_intent'],
  [/\b(shortness of breath|feel short of breath|breathless|trouble breathing|problem with breathing)\b/, ['ros_respiratory'], 'single_intent'],
  [/\b(for how long|how long (did|does|was|is|has|had) (the )?(pain|symptom|problem|it)?.*(last|lasting|continue)|how long was (the )?(pain|symptom|problem) lasting|duration|timing|lasting|lasted|constant|continuous|intermittent|comes and goes|come and go)\b/, ['hpi_timing'], 'single_intent'],
  [/\b(what makes it worse|makes the pain worse|does anything worsen it|is something worsening it|is something worsening the pain|what worsens the pain|aggravating factors|exacerbating factors|trigger)\b/, ['hpi_exacerbating'], 'single_intent'],
  [/\b(what makes it better|makes the pain better|go away|relieving factors|alleviating|what relieves|helps the pain|help ease the pain|helping with the pain|anything help.*pain|anything helping.*pain|ease the pain|eased the pain|improve the pain|improved the pain)\b/, ['hpi_relieving'], 'single_intent'],
  [/\b(how bad|how strong|severity|vas|scale from|scale 1|scale of 1|rate it)\b/, ['hpi_severity'], 'single_intent'],
  [/\b(getting worse over time|getting better over time|course since onset|has it changed|changed since it started|progressing|improving over time|worsening over time)\b/, ['hpi_course'], 'single_intent'],
  [/\b(heart condition|cvs condition|heart disease|cardiac condition|cardiovascular disease|coronary disease|angina|previous mi|heart attack|stent|bypass|arrhythmia|heart failure)\b/, ['pmh_cardiovascular_disease'], 'single_intent'],
  [/\b(chronic disease|medical problems|previous diseases|high blood pressure|hypertension|diabetes|cholesterol|kidney disease|thyroid|liver disease)\b/, ['pmh_chronic_diseases'], 'single_intent'],
  [/\b(any operation|operation history|any surgery|surgeries|were you operated)\b/, ['pmh_operations'], 'single_intent'],
  [/\b(hospitalized before|previous admission|hospitalisation|hospitalization)\b/, ['pmh_hospitalizations'], 'single_intent'],
  [/\b(open or laparoscopic|laparoscopic|open surgery|type of procedure)\b/, ['operation_approach'], 'contextual_followup'],
  [/\b(date of operation|what year was (the )?(operation|surgery)|when was (the )?(operation|surgery))\b/, ['operation_date'], 'contextual_followup'],
  [/\b(ct scan|computed tomography)\b/, ['pmh_previous_exams'], 'single_intent'],
  [/\b(ecg|blood tests|ultrasound|mri|previous examination)\b/, ['pmh_previous_exams'], 'single_intent'],
  [/\b(any allergies|allergies|are you allergic|drug allergy|latex allergy)\b/, ['allergies'], 'single_intent'],
  [/\b(for environment or food|food or environment|food allergy|environmental allergy)\b/, ['allergy_environment_food'], 'contextual_followup'],
  [/\b(pollen|hay fever)\b/, ['allergy_pollen'], 'contextual_followup'],
  [/\b(what reaction|reaction|what happens)\b/, ['allergy_reaction'], 'contextual_followup'],
  [/\b(transfusion|blood transfusion|received blood)\b/, ['transfusions'], 'single_intent'],
  [/\b(nitroglycerin|nitroglycerine|nitroglicerin|\bntg\b|\bnitro\b|spray under tongue|tablet under tongue)\b/, ['medication_nitroglycerin_previous'], 'single_intent'],
  [/\b(what medications|do you take medication|medicines|meds|pills|tablets|what are you on)\b/, ['medication_regular'], 'single_intent'],
  [/\b(over the counter|otc|supplements|vitamins|herbal)\b/, ['medication_otc_supplements'], 'single_intent'],
  [/\b(forget|adherence|do you take them regularly|took today|miss)\b/, ['medication_adherence'], 'single_intent'],
  [/\b(family history|parents|mother|father|heart attack in family|stroke in family|diabetes in family|cancer in family|genetic disease)\b/, ['family_history'], 'single_intent'],
  [/\b(travel|abroad|pets|farm animals|animals|covid|vaccination|sick contact|infectious contact|tick|suspicious food)\b/, ['epidemiology'], 'single_intent'],
  [/\b(do you work|occupation|job|retired|unemployed)\b/, ['identity_occupation'], 'single_intent'],
  [/\b(married|single|divorced|widowed|who do you live with|live alone|house or apartment|which floor|elevator|housing)\b/, ['social_living'], 'single_intent'],
  [/\b(do you smoke|smoking|cigarettes|pack years)\b/, ['substance_smoking'], 'single_intent'],
  [/\b(alcohol|drink alcohol|beer|wine|spirits)\b/, ['substance_alcohol'], 'single_intent'],
  [/\b(coffee|black tea|energy drinks|caffeine)\b/, ['substance_caffeine'], 'single_intent'],
  [/\b(recreational drugs|street drugs|marijuana|cocaine)\b/, ['substance_drugs'], 'single_intent'],
  [/\b(period|menstruation|last period|menopause|contraception|pregnant|children|deliveries|miscarriage|abortion|pelvic pain)\b/, ['gyn_history'], 'single_intent'],
  [/\b(blood pressure|\bbp\b)\b/, ['vital_bp'], 'objective_exam_request'],
  [/\b(heart rate|pulse|\bhr\b)\b/, ['vital_hr'], 'objective_exam_request'],
  [/\b(respiratory rate|\brr\b)\b/, ['vital_rr'], 'objective_exam_request'],
  [/\b(oxygen saturation|spo2|saturation)\b/, ['vital_spo2'], 'objective_exam_request'],
  [/\b(temperature)\b/, ['vital_temperature'], 'objective_exam_request'],
  [/\b(lungs|wheezing|crackles|breath sounds|auscultation lungs)\b/, ['exam_lungs'], 'objective_exam_request'],
  [/\b(heart sounds|murmur|rhythm|auscultation heart)\b/, ['exam_heart'], 'objective_exam_request'],
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
    this.lastMeaningfulIntent = null;
    this.lastMeaningfulDomain = null;
    this.currentSymptom = null;
    this.lastQuestionType = null;
    this.lastContextResolutionReason = '';
    this.lastDetection = null;
    this.pendingClarification = null;
    this.rapport = patientCase.personality?.baselineRapport ?? 70;
    this.rapportEvents = [];
    this.lastRapportEvent = null;
    this.turn = 0;
    return '';
  }

  ask(question, detectionOverride = null) {
    this.turn += 1;
    const detection = detectionOverride || this.detect(question);
    const rapportEvent = this.updateRapport(question, detection);
    const attemptedIntentIds = this.inferAttemptedIntents(question, detection);
    const previouslyAttempted = new Set(this.attemptedIntents);
    const previouslyResolved = new Set(this.askedIntents);
    attemptedIntentIds.forEach((intentId) => this.attemptedIntents.add(intentId));
    const reply = this.composeReply(question, detection);
    const communicationAssessment = this.assessCommunication(question, detection, attemptedIntentIds, previouslyAttempted, previouslyResolved);
    const feedbackLabel = this.makeFeedbackLabel(detection, communicationAssessment);

    this.pushStudent(question, detection.primaryIntent?.id ?? 'unknown', feedbackLabel);
    this.pushPatient(reply, detection.primaryIntent?.id ?? 'unknown');
    this.lastDetection = detection;
    if (detection.primaryIntent && detection.responseScope !== 'terminology_not_understood') {
      for (const intent of detection.answerIntents ?? [detection.primaryIntent]) this.askedIntents.add(intent.id);
      this.lastIntent = detection.primaryIntent.id;
      this.lastMeaningfulIntent = detection.primaryIntent.id;
      this.lastMeaningfulDomain = INTENTS[detection.primaryIntent.id]?.domain ?? null;
      this.updateCurrentSymptom(detection.primaryIntent.id);
    }
    const resolvedIds = new Set((detection.answerIntents ?? []).map((intent) => intent.id));
    attemptedIntentIds.forEach((intentId) => {
      this.attemptEvents.push({
        turnNumber: this.turn,
        intentId,
        question,
        resolved: resolvedIds.has(intentId) && detection.responseScope !== 'clarification' && detection.responseScope !== 'terminology_not_understood',
        engineIntentIds: [...resolvedIds],
        responseScope: detection.responseScope,
        matchKind: detection.kind,
        previouslyAttempted: previouslyAttempted.has(intentId),
        previouslyResolved: previouslyResolved.has(intentId)
      });
    });
    this.communicationEvents.push({ turnNumber: this.turn, question, ...communicationAssessment });
    if (detection.terminologyEvent) this.terminologyEvents.push(detection.terminologyEvent);
    this.debugTurns.push(this.makeDebugTurn(question, detection, reply, feedbackLabel, attemptedIntentIds, communicationAssessment));

    return { reply, detectedIntent: detection.primaryIntent?.id ?? 'unknown', confidence: detection.confidence, detection, coverage: this.getCoverage(), rapport: this.rapport, rapportEvent, feedbackLabel, terminologySuggestion: detection.terminologyEvent?.suggestedPatientFriendlyQuestion ?? '' };
  }

  detectionForResolvedIntent(question, intentId, reason = 'AI helper resolved an existing deterministic intent.') {
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
      confidence: 1,
      contextUsed: true,
      contextResolutionReason: reason
    });
  }

  replaceLastPatientReply(reply) {
    const last = this.transcript.at(-1);
    if (last?.role === 'patient') last.text = reply;
  }

  detect(question) {
    const normalized = normalize(question);
    const tokens = tokenize(normalized);
    const phrases = makeNgrams(tokens, 4);
    const questionType = this.classifyQuestionType(normalized, question);
    this.lastQuestionType = questionType;
    if (!normalized) return this.makeDetection({ kind: 'empty', responseScope: 'clarification', normalized, tokens, phrases, questionType });

    const yesNoResolution = this.resolvePendingClarification(normalized);
    if (yesNoResolution) return yesNoResolution;

    const term = this.detectMedicalTerminology(tokens);
    if (term && !term.patientUnderstood) {
      return this.makeDetection({ kind: 'terminology', responseScope: 'terminology_not_understood', normalized, tokens, phrases, primaryIntent: this.toCandidate(term.intent, 5, ['medical-term']), answerIntents: [], terminologyEvent: term });
    }

    const explicit = this.detectExplicitMultiIntent(normalized, tokens);
    if (explicit.length > 1) {
      return this.makeDetection({ kind: 'direct', responseScope: 'multi_intent_explicit', normalized, tokens, phrases, primaryIntent: explicit[0], answerIntents: explicit, candidates: explicit });
    }

    const direct = this.detectDirectIntent(normalized, tokens);
    if (direct) {
      return this.makeDetection({ kind: 'direct', responseScope: direct.scope, normalized, tokens, phrases, primaryIntent: direct.candidates[0], answerIntents: direct.scope === 'broad_open_history' ? [direct.candidates[0]] : direct.candidates, candidates: direct.candidates, contextUsed: direct.contextUsed, contextResolutionReason: direct.contextResolutionReason });
    }

    const candidates = Object.entries(INTENTS).map(([id, intent]) => this.scoreCandidate(id, intent, normalized, tokens, phrases)).sort((a, b) => b.score - a.score);
    const suppressed = this.applySuppression(candidates, normalized, tokens);
    const usable = candidates.filter((c) => c.score > 0.18 && !suppressed.find((s) => s.intentId === c.id));
    const top = usable[0] || candidates[0];
    const second = usable[1] || candidates[1];
    const confidence = calculateConfidence(top?.score ?? 0, second?.score ?? 0, normalized.length);
    const strong = confidence >= MATCH_THRESHOLD || (top?.score ?? 0) >= MIN_TOP_SCORE_FOR_MATCH;
    const weak = confidence >= WEAK_MATCH_THRESHOLD || (top?.score ?? 0) >= MIN_TOP_SCORE_FOR_WEAK_MATCH;
    if (strong || weak) {
      const scope = this.classifyResponseScope(normalized, tokens, [top], strong ? 'strong' : 'weak_answered');
      const answers = scope === 'single_intent' || scope === 'contextual_followup' || scope === 'objective_exam_request' ? [top] : this.selectMultipleIntents(usable, normalized, tokens);
      return this.makeDetection({ kind: strong ? 'matched' : 'weak_answered', responseScope: scope, normalized, tokens, phrases, primaryIntent: top, answerIntents: answers.length ? answers : [top], candidates: usable.slice(0, 5), suppressedCandidates: suppressed, confidence });
    }

    return this.makeDetection({ kind: 'uncertain', responseScope: 'clarification', normalized, tokens, phrases, primaryIntent: null, answerIntents: [], candidates: candidates.slice(0, 5), suppressedCandidates: suppressed, confidence });
  }

  inferAttemptedIntents(question, detection) {
    const normalized = normalize(question);
    const explicitAttempts = ATTEMPT_RULES
      .filter(([, pattern]) => pattern.test(normalized))
      .map(([intentId]) => intentId)
      .filter((intentId, index, list) => INTENTS[intentId] && list.indexOf(intentId) === index);

    if (explicitAttempts.length) {
      const hpiAttempts = explicitAttempts.filter((intentId) => intentId.startsWith('hpi_'));
      if (hpiAttempts.length) return hpiAttempts.slice(0, 2);
      return explicitAttempts.slice(0, 3);
    }

    if (detection?.responseScope === 'terminology_not_understood' && detection.primaryIntent?.id) {
      return [detection.primaryIntent.id];
    }

    return [...new Set((detection?.answerIntents ?? []).map((intent) => intent.id).filter((intentId) => INTENTS[intentId]))];
  }

  makeDetection(data) {
    return { kind: data.kind ?? 'matched', responseScope: data.responseScope ?? 'single_intent', primaryIntent: data.primaryIntent ?? null, bestIntent: data.primaryIntent ?? null, answerIntents: data.answerIntents ?? [], confidence: data.confidence ?? (data.primaryIntent ? 1 : 0), candidates: data.candidates ?? (data.primaryIntent ? [data.primaryIntent] : []), suppressedCandidates: data.suppressedCandidates ?? [], normalized: data.normalized ?? '', tokens: data.tokens ?? [], phrases: data.phrases ?? [], directMappingUsed: data.kind === 'direct', contextUsed: Boolean(data.contextUsed), terminologyEvent: data.terminologyEvent ?? null, questionType: data.questionType ?? this.lastQuestionType ?? 'question', contextResolutionReason: data.contextResolutionReason ?? this.lastContextResolutionReason ?? '' };
  }

  resolvePendingClarification(normalized) {
    if (!this.pendingClarification) return null;
    if (YES_WORDS.includes(normalized)) {
      const candidate = this.toCandidate(this.pendingClarification.proposedIntent, 5, ['clarification-yes']);
      this.pendingClarification = null;
      return this.makeDetection({ kind: 'clarification_yes', responseScope: 'contextual_followup', normalized, tokens: tokenize(normalized), primaryIntent: candidate, answerIntents: [candidate], candidates: [candidate], contextUsed: true });
    }
    if (NO_WORDS.some((word) => normalized.startsWith(word))) this.pendingClarification = null;
    return null;
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

  detectDirectIntent(normalized, tokens) {
    const statementMatch = this.resolveStatement(normalized);
    if (statementMatch) return statementMatch;

    const contextMatch = this.resolveContextualFollowup(normalized);
    if (contextMatch) return contextMatch;

    for (const [pattern, ids, scope] of DIRECT_RULES) {
      if (!pattern.test(normalized)) continue;
      const candidates = ids.map((id) => this.toCandidate(id, 6, ['direct'])).filter(Boolean);
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
    this.lastContextResolutionReason = reason;
    return { candidates: [this.toCandidate(id, score, ['context-followup'])], scope: 'contextual_followup', contextUsed: true, contextResolutionReason: reason };
  }

  resolveContextualFollowup(normalized) {
    this.lastContextResolutionReason = '';
    const last = this.lastMeaningfulIntent || this.lastIntent;
    const lastDomain = this.lastMeaningfulDomain;

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

    if (last === 'medication_regular' && /\b(what dose|dose|how often|frequency|why do you take it|why|indication)\b/.test(normalized)) {
      if (/\b(dose)\b/.test(normalized)) return this.contextCandidate('medication_regular', 'Medication dose follow-up.');
      if (/\b(how often|frequency)\b/.test(normalized)) return this.contextCandidate('medication_regular', 'Medication frequency follow-up.');
      return this.contextCandidate('medication_regular', 'Medication indication follow-up.');
    }

    if (this.currentSymptom?.type === 'pain' && !this.isClearlyNonHpi(normalized)) {
      if (/\b(where do you feel it|where is it|where exactly is it|where exactly|where do you feel the pain)\b/.test(normalized)) return this.contextCandidate('hpi_site', 'Pronoun/location follow-up resolved to active pain symptom.');
      if (/\b(what is its character|what is the character|what type is it|what kind is it|what is it like|what does it feel like|how would you describe it|describe it)\b/.test(normalized)) return this.contextCandidate('hpi_character', 'Pronoun/character follow-up resolved to active pain symptom.');
      if (/\b(does it radiate|is it radiating|does it move|does it go anywhere|does it spread|does it travel|does it shoot|go to arm|go to jaw|go to back)\b/.test(normalized)) return this.contextCandidate('hpi_radiation', 'Pronoun/radiation follow-up resolved to active pain symptom.');
      if (/\b(how strong is it|how bad is it|how severe is it|rate it|scale)\b/.test(normalized)) return this.contextCandidate('hpi_severity', 'Pronoun/severity follow-up resolved to active pain symptom.');
      if (/\b(what makes it worse|does anything worsen it|is something worsening it|is something worsening the pain|what worsens it|what worsens the pain)\b/.test(normalized)) return this.contextCandidate('hpi_exacerbating', 'Worsening trigger follow-up resolved to active pain symptom.');
      if (/\b(what makes it better|does anything relieve it|what relieves it|does anything help|what helps it|does it go away|did anything help|anything help|anything helping|help ease|ease the pain|eased the pain|improve the pain|make the pain better)\b/.test(normalized)) return this.contextCandidate('hpi_relieving', 'Relieving factor follow-up resolved to active pain symptom.');
      if (/\b(for how long|how long (did|does|was|is|has|had)|duration|lasting|lasted|constant|continuous|intermittent|comes and goes|come and go|how often)\b/.test(normalized)) return this.contextCandidate('hpi_timing', 'Timing/duration follow-up resolved to active pain symptom.');
      if (/\b(anything else|other symptoms|with it)\b/.test(normalized)) return this.contextCandidate('hpi_associated_symptoms', 'Associated symptom follow-up resolved to active pain symptom.');
    }
    return null;
  }

  isClearlyNonHpi(normalized) {
    return /\b(name|age|old|born|address|city|town|live|from|admitted|hospital|medication|allerg|operation|surgery|family|smok|alcohol|work|job|blood pressure|pulse|heart rate|spo2|saturation|temperature|lab|ecg|ct|mri|ultrasound)\b/.test(normalized);
  }

  detectExplicitMultiIntent(normalized, tokens) {
    const hits = [];
    const add = (condition, id, reason) => { if (condition && !hits.find((h) => h.id === id)) hits.push(this.toCandidate(id, 4, [reason])); };
    const hasJoiner = /\b(and|or|,|plus|with)\b/.test(normalized);
    if (!hasJoiner) return hits;
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

  scoreCandidate(id, intent, normalized, tokens, phrases) {
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
    if (this.askedIntents.has(id)) score -= 0.35;
    if (!/female/i.test(String(this.case.identity?.sex || '')) && id === 'gyn_history') score -= 2.5;
    if (this.nextNeededIntents().includes(id)) score += 0.08;

    return this.toCandidate(id, Math.max(0, score * (1 + ((intent.priority ?? 4) / 100))), reasons);
  }

  hasObjectiveTrigger(normalized) {
    return /\b(bp|blood pressure|heart rate|pulse|respiratory rate|oxygen saturation|spo2|temperature|vitals|monitor|ecg|lab|blood test|examination|exam|auscultation|palpation|wbc|crp|creatinine|potassium|glucose|tsh|murmur|wheezing|crackles|guarding|blumberg|murphy|mcburney|bowel sounds)\b/.test(normalized);
  }

  updateCurrentSymptom(intentId) {
    if (intentId === 'chief_complaint' || intentId.startsWith('hpi_')) {
      const complaint = [this.case.chiefComplaint, this.case.hpi?.site, this.case.patientCard].join(' ').toLowerCase();
      if (/pain|pressure|chest|abdomen|stomach/.test(complaint)) {
        const bodyArea = /chest|pressure/.test(complaint) ? 'chest' : /abdomen|stomach/.test(complaint) ? 'abdomen' : '';
        if (!this.currentSymptom || this.currentSymptom.type !== 'pain') {
          this.currentSymptom = {
            type: 'pain',
            bodyArea,
            active: true,
            rootSourceIntent: 'chief_complaint',
            sourceIntent: 'chief_complaint',
            lastPropertyIntent: intentId
          };
        } else {
          this.currentSymptom = {
            ...this.currentSymptom,
            bodyArea: this.currentSymptom.bodyArea || bodyArea,
            active: true,
            rootSourceIntent: this.currentSymptom.rootSourceIntent || 'chief_complaint',
            sourceIntent: this.currentSymptom.rootSourceIntent || this.currentSymptom.sourceIntent || 'chief_complaint',
            lastPropertyIntent: intentId
          };
        }
      }
    }
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
    if (/\b(what happened|what brought you|why did you come|how can i help|tell me about the problem)\b/.test(normalized)) return 'broad_open_history';
    return 'single_intent';
  }

  selectMultipleIntents(candidates, normalized) {
    if (!candidates.length) return [];
    const explicit = this.detectExplicitMultiIntent(normalized, tokenize(normalized));
    if (explicit.length > 1) return explicit;
    return [candidates[0]];
  }

  composeReply(question, detection) {
    if (detection.kind === 'empty') return 'I did not catch a question. Could you ask me something specific?';
    if (detection.responseScope === 'terminology_not_understood') return this.terminologyConfusionReply(detection);
    if (detection.responseScope === 'clarification' || detection.kind === 'uncertain') return this.uncertainReply(question, detection);

    if (detection.questionType === 'statement_assertion' && detection.primaryIntent?.id === 'identity_sex') {
      return /^you (are|re)|^youre|^you seem/.test(detection.normalized) ? 'Yes.' : this.answerFor('identity_sex');
    }

    const parts = [];
    for (const candidate of detection.answerIntents ?? []) {
      const raw = this.answerFor(candidate.id);
      if (raw) parts.push(raw);
    }
    if (!parts.length) return this.uncertainReply(question, detection);
    const reply = this.mergeAnswers(parts, detection);
    return this.applyPatientPersonality(reply, detection);
  }

  terminologyConfusionReply(detection) {
    const variants = ['I’m sorry, I don’t understand what that means.', 'I don’t understand that word.', 'I don’t understand that term.'];
    return variants[this.turn % variants.length];
  }

  answerFor(intentId) {
    const intent = INTENTS[intentId];
    if (!intent) return '';
    return renderIntentAnswer(intentId, this.case, intent.answerKeys ?? []);
  }

  mergeAnswers(parts, detection) {
    const unique = [...new Set(parts.map((part) => String(part).trim()).filter(Boolean))];
    if (unique.length === 1) return unique[0];
    if (detection.responseScope === 'multi_intent_explicit') return unique.join(' ');
    return unique[0];
  }

  uncertainReply(question, detection) {
    const lowTop = detection.candidates?.[0];
    if (lowTop && lowTop.score > 0.9 && lowTop.id) {
      this.pendingClarification = { proposedIntent: lowTop.id, createdAtTurn: this.turn };
      return 'I am not sure what you mean. Could you ask that another way?';
    }
    return 'I am not sure what you mean. Could you ask that more directly?';
  }

  applyPatientPersonality(reply, detection) {
    let styled = reply;
    const p = this.case.personality ?? {};
    if ((p.anxiety ?? 0) > 0.72 && detection.primaryIntent?.id?.startsWith('hpi_') && this.turn < 5 && detection.responseScope !== 'terminology_not_understood') styled = `${styled} It really worries me.`;
    if (this.rapport < 35) styled = `${styled} I am getting a bit stressed, please ask one thing at a time.`;
    return styled;
  }

  assessCommunication(question, detection, attemptedIntentIds = [], previouslyAttempted = new Set(), previouslyResolved = new Set()) {
    const normalized = normalize(question);
    const words = normalized.split(' ').filter(Boolean);
    const issues = [];

    const shorthand = detection.questionType === 'fragment_or_statement' && words.length <= 4 && /\b(factors?|history|timing|duration|severity|radiation|onset|character|allergies|medication)\b/.test(normalized);
    if (shorthand) issues.push({ type: 'checklist_shorthand', message: 'Phrase this as a patient-facing question rather than a checklist heading.' });
    if (detection.responseScope === 'terminology_not_understood') issues.push({ type: 'too_technical', message: 'Use patient-friendly wording instead of unexplained medical terminology.' });
    if (normalized.length > 180) issues.push({ type: 'overlong', message: 'Ask one focused question at a time.' });

    const unnecessaryRepeats = attemptedIntentIds.filter((intentId) => previouslyAttempted.has(intentId) && previouslyResolved.has(intentId));
    if (unnecessaryRepeats.length) issues.push({ type: 'repeated_resolved_area', message: 'This area had already been successfully covered.' });

    const penalty = issues.reduce((sum, issue) => sum + ({ checklist_shorthand: 6, too_technical: 8, overlong: 3, repeated_resolved_area: 2 }[issue.type] ?? 0), 0);
    return { score: Math.max(0, 100 - penalty), issues, shorthand, unnecessaryRepeats };
  }

  makeFeedbackLabel(detection, communicationAssessment = null) {
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
    const required = QUESTION_AREAS
      .filter((area) => area.required && (area.id !== 'gynecological' || /female/i.test(this.case.identity.sex)))
      .flatMap((area) => area.intents);
    const essential = [...new Set(configured.essential ?? [
      'chief_complaint', 'hpi_site', 'hpi_onset', 'hpi_character', 'hpi_radiation', 'hpi_associated_symptoms', 'hpi_severity',
      'pmh_chronic_diseases', 'allergies', 'medication_regular'
    ])].filter((id) => INTENTS[id]);
    const caseCritical = [...new Set(configured.caseCritical ?? [])].filter((id) => INTENTS[id] && !essential.includes(id));
    const comprehensive = required.filter((id) => !essential.includes(id) && !caseCritical.includes(id));
    const criticalSafety = [...new Set(configured.criticalSafety ?? [...essential, ...caseCritical])].filter((id) => INTENTS[id]);
    return { essential, caseCritical, comprehensive, criticalSafety };
  }

  percentForIntents(intentIds, intentSet = this.attemptedIntents) {
    if (!intentIds.length) return 100;
    const complete = intentIds.filter((id) => this.isIntentSatisfied(id, intentSet)).length;
    return Math.round((complete / intentIds.length) * 100);
  }

  getCommunicationAssessment() {
    const allIssues = this.communicationEvents.flatMap((event) => (event.issues ?? []).map((issue) => ({ ...issue, turnNumber: event.turnNumber, question: event.question })));
    const penalty = allIssues.reduce((sum, issue) => sum + ({ checklist_shorthand: 6, too_technical: 8, overlong: 3, repeated_resolved_area: 2 }[issue.type] ?? 0), 0);
    return {
      score: Math.max(0, 100 - Math.min(35, penalty)),
      issues: allIssues
    };
  }

  getScoreBreakdown() {
    const priorities = this.getDebriefPriorities();
    const essential = this.percentForIntents(priorities.essential);
    const caseCritical = this.percentForIntents(priorities.caseCritical);
    const comprehensive = this.percentForIntents(priorities.comprehensive);
    const communication = this.getCommunicationAssessment().score;
    const overall = Math.round((essential * 0.50) + (caseCritical * 0.30) + (comprehensive * 0.15) + (communication * 0.05));
    const requiredResolved = this.getCoverage().filter((area) => area.required);
    const resolvedAsked = requiredResolved.reduce((sum, area) => sum + area.asked, 0);
    const resolvedTotal = requiredResolved.reduce((sum, area) => sum + area.total, 0);
    const engineResolvedCoverage = resolvedTotal ? Math.round((resolvedAsked / resolvedTotal) * 100) : 0;
    return { overall, essential, caseCritical, comprehensive, communication, engineResolvedCoverage };
  }

  getScore() { return this.getScoreBreakdown().overall; }

  getCriticalMisses() {
    return this.getDebriefPriorities().criticalSafety.filter((intent) => !this.isIntentSatisfied(intent, this.attemptedIntents));
  }

  getMissedFeedback() {
    return this.getStudentCoverage()
      .filter((area) => area.required && area.percent < 100)
      .map((area) => ({ title: area.title, missing: area.missing, modelQuestion: area.modelQuestion }));
  }

  getResolutionIssues() {
    const eventuallyResolved = this.askedIntents;
    return this.attemptEvents
      .filter((event) => !event.resolved)
      .map((event) => ({
        ...event,
        label: INTENTS[event.intentId]?.title ?? event.intentId,
        laterResolved: this.isIntentSatisfied(event.intentId, eventuallyResolved)
      }));
  }

  getDebrief() {
    const priorities = this.getDebriefPriorities();
    return {
      score: this.getScore(),
      scoreBreakdown: this.getScoreBreakdown(),
      studentCoverage: this.getStudentCoverage(),
      engineResolvedCoverage: this.getCoverage(),
      missedRequired: this.getMissedFeedback(),
      missedCaseCritical: priorities.caseCritical.filter((intent) => !this.isIntentSatisfied(intent, this.attemptedIntents)),
      criticalSafetyMisses: this.getCriticalMisses(),
      resolutionIssues: this.getResolutionIssues(),
      communication: this.getCommunicationAssessment()
    };
  }

  legacyGenerateSummary() {
    const section = (title, intentIds) => [title, intentIds.filter((id) => this.askedIntents.has(id)).map((id) => this.answerFor(id)).filter(Boolean).join(' ') || '[Not asked / incomplete]'].join('\n');
    const gyn = /female/i.test(this.case.identity.sex) ? section('Gynecological History:', ['gyn_history']) : 'Gynecological History:\nNot applicable.';
    return ['Anamnesis Summary', '', `Patient: ${strip(this.case.identity.age)}, ${strip(this.case.identity.sex).toLowerCase()}, ${strip(this.case.identity.name)}, ${strip(this.case.identity.residence)}.`, '', section('Chief Complaint:', ['chief_complaint']), '', section('History Of Present Illness:', ['hpi_site', 'hpi_onset', 'hpi_activity_at_onset', 'hpi_character', 'hpi_radiation', 'hpi_associated_symptoms', 'hpi_timing', 'hpi_exacerbating', 'hpi_relieving', 'hpi_severity', 'hpi_course']), '', section('Review Of Systems:', ['ros_general', 'ros_head_neck', 'ros_cardiovascular', 'ros_respiratory', 'ros_gastrointestinal', 'ros_genitourinary', 'ros_neurological', 'ros_musculoskeletal', 'ros_skin']), '', section('Past Medical History:', ['pmh_chronic_diseases', 'pmh_cardiovascular_disease', 'pmh_specialists', 'pmh_hospitalizations', 'pmh_operations', 'pmh_previous_exams']), '', section('Medication:', ['medication_regular', 'medication_nitroglycerin_previous', 'medication_otc_supplements', 'medication_adherence']), '', section('Allergies And Transfusions:', ['allergies', 'allergy_environment_food', 'allergy_pollen', 'allergy_reaction', 'transfusions']), '', gyn, '', section('Family History:', ['family_history']), '', section('Epidemiological History:', ['epidemiology']), '', section('Social And Functional History:', ['identity_occupation', 'social_living', 'daily_independence']), '', section('Substance Use:', ['substance_smoking', 'substance_alcohol', 'substance_caffeine', 'substance_drugs']), '', 'Terminology feedback:', ...(this.terminologyEvents.length ? this.terminologyEvents.map((e) => `- Used “${e.term}”; patient-friendly wording: ${e.suggestedPatientFriendlyQuestion}`) : ['None.']), '', 'Clinical Direction:', this.case.expectedDiagnosisIdea].join('\n');
  }

  generateSummary() {
    const section = (title, intentIds) => [title, intentIds.filter((id) => this.askedIntents.has(id)).map((id) => this.answerFor(id)).filter(Boolean).join(' ') || '[Not asked / incomplete]'].join('\n');
    const patient = ['identity_name', 'identity_age', 'identity_dob', 'identity_sex', 'identity_residence'].filter((id) => this.askedIntents.has(id)).map((id) => this.answerFor(id)).filter(Boolean).join(' ') || '[Identity not assessed]';
    const gyn = /female/i.test(this.case.identity.sex) ? section('Gynecological History:', ['gyn_history']) : 'Gynecological History:\nNot applicable.';
    return ['Anamnesis Summary', '', `Patient: ${patient}`, '', section('Chief Complaint:', ['chief_complaint']), '', section('History Of Present Illness:', ['hpi_site', 'hpi_onset', 'hpi_activity_at_onset', 'hpi_character', 'hpi_radiation', 'hpi_associated_symptoms', 'hpi_timing', 'hpi_exacerbating', 'hpi_relieving', 'hpi_severity', 'hpi_course']), '', section('Review Of Systems:', ['ros_general', 'ros_head_neck', 'ros_cardiovascular', 'ros_respiratory', 'ros_gastrointestinal', 'ros_genitourinary', 'ros_neurological', 'ros_musculoskeletal', 'ros_skin']), '', section('Past Medical History:', ['pmh_chronic_diseases', 'pmh_cardiovascular_disease', 'pmh_specialists', 'pmh_hospitalizations', 'pmh_operations', 'pmh_previous_exams']), '', section('Medication:', ['medication_regular', 'medication_nitroglycerin_previous', 'medication_otc_supplements', 'medication_adherence']), '', section('Allergies And Transfusions:', ['allergies', 'allergy_environment_food', 'allergy_pollen', 'allergy_reaction', 'transfusions']), '', gyn, '', section('Family History:', ['family_history']), '', section('Epidemiological History:', ['epidemiology']), '', section('Social And Functional History:', ['identity_occupation', 'social_living', 'daily_independence']), '', section('Substance Use:', ['substance_smoking', 'substance_alcohol', 'substance_caffeine', 'substance_drugs']), '', 'Terminology feedback:', ...(this.terminologyEvents.length ? this.terminologyEvents.map((event) => `- Used "${event.term}"; patient-friendly wording: ${event.suggestedPatientFriendlyQuestion}`) : ['None.'])].join('\n');
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

  makeDebugTurn(question, detection, reply, feedbackLabel, attemptedIntentIds = [], communicationAssessment = null) {
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
      studentEngineMismatch: attemptedIntentIds.length > 0 && attemptedIntentIds.some((id) => !resolvedIds.includes(id)),
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

export function normalize(text) { return String(text ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
function tokenize(text) { return normalize(text).split(' ').filter((token) => token.length > 1).map(lightStem); }
function lightStem(token) { const keep = ['is','was','has','does','this','his','as','its','it','ct','mi','bp','hr','rr','tsh','crp','wbc','ntg','dyspnea','dysuria','hemoptysis','orthopnea','syncope','palpitations','edema','melena','hematemesis','nocturia','polyuria','polydipsia','dysphagia','paresthesia','vertigo','cephalgia','cyanosis','diaphoresis']; if (keep.includes(token)) return token; return token.replace(/ies$/, 'y').replace(/ing$/, '').replace(/ed$/, '').replace(/s$/, ''); }
function makeNgrams(tokens, maxSize = 4) { const grams = []; for (let size = 2; size <= maxSize; size += 1) for (let i = 0; i <= tokens.length - size; i += 1) grams.push(tokens.slice(i, i + size).join(' ')); return grams; }
function calculateConfidence(top, second, length) { if (top <= 0) return 0; const separation = Math.max(0, top - second) / Math.max(top, 1); const strength = Math.min(1, top / 5.5); const lengthFactor = length < 8 ? 0.88 : 1; return round2(((strength * 0.75) + (separation * 0.25)) * lengthFactor); }
function round2(value) { return Math.round(value * 100) / 100; }
function strip(value) { return String(value ?? '').replace(/^I am /i, '').replace(/^My name is /i, '').replace(/^I live in /i, 'from '); }
function dice(a, b) { if (a === b) return 1; if (a.length < 2 || b.length < 2) return 0; const bigrams = (s) => Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2)); const aGrams = bigrams(a); const bGrams = bigrams(b); let hits = 0; const used = new Set(); for (const g of aGrams) { const idx = bGrams.findIndex((x, i) => x === g && !used.has(i)); if (idx >= 0) { hits += 1; used.add(idx); } } return (2 * hits) / (aGrams.length + bGrams.length); }
