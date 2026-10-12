function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

export function weightedSampleWithoutReplacement(items, count, weightFn) {
  const pool = items.slice();
  const selected = [];
  const take = Math.min(count, pool.length);
  for (let index = 0; index < take; index += 1) {
    const weighted = pool.map((item) => ({
      item,
      weight: Math.max(0.01, Number(weightFn(item)) || 1)
    }));
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    let hit = Math.random() * total;
    let picked = weighted[weighted.length - 1].item;
    for (const entry of weighted) {
      hit -= entry.weight;
      if (hit <= 0) {
        picked = entry.item;
        break;
      }
    }
    selected.push(picked);
    const pickedIndex = pool.indexOf(picked);
    if (pickedIndex >= 0) {
      pool.splice(pickedIndex, 1);
    }
  }
  return selected;
}

import { normalizeAnswer, studyWeight } from "./study-progress.js?v=75";

function createQuizQuestions(candidates, questionCount, optionsCount, fromField, toField) {
  const chosen = candidates.slice(0, questionCount);
  return chosen.map((candidate, index) => {
    const options = [candidate.toTerm];
    const accepted = candidate.acceptedAnswers || [candidate.toTerm];
    const distractors = candidates.filter((other) => !accepted.some(answer => normalizeAnswer(answer) === normalizeAnswer(other.toTerm)));
    shuffle(distractors);
    const affinity = (other) => {
      let score = 0;
      if (other.category && candidate.category && other.category === candidate.category) score += 6;
      if (other.sourceDataset && candidate.sourceDataset && other.sourceDataset === candidate.sourceDataset) score += 3;
      if (other.sourceType && candidate.sourceType && other.sourceType === candidate.sourceType) score += 1;
      const targetLength = Math.max(1, String(candidate.toTerm || '').length);
      const lengthGap = Math.abs(String(other.toTerm || '').length - targetLength) / targetLength;
      score += Math.max(0, 1.5 - lengthGap);
      return score;
    };
    distractors.sort((a, b) => affinity(b) - affinity(a));
    for (let distractorIndex = 0; distractorIndex < distractors.length && options.length < optionsCount; distractorIndex += 1) {
      const answer = distractors[distractorIndex].toTerm;
      if (!options.some((value) => normalizeAnswer(value) === normalizeAnswer(answer))) options.push(answer);
    }
    shuffle(options);
    return {
      id: `q${index + 1}`,
      type: "multiple_choice",
      fromField,
      toField,
      number: index + 1,
      termId: candidate.termId,
      fromTerm: candidate.fromTerm,
      correctToTerm: candidate.toTerm,
      acceptedAnswers: accepted,
      options: options.map((text, optionIndex) => ({ id: `o${optionIndex + 1}`, text })),
      answered: false,
      selectedOptionId: null,
      isCorrect: null,
      sourceType: candidate.sourceType,
      sourceDataset: candidate.sourceDataset,
      category: candidate.category,
      baseTermKey: candidate.baseTermKey,
      userTermId: candidate.userTermId,
      explanation: candidate.explanation || ""
    };
  });
}

function createTypingQuestions(candidates, questionCount, fromField, toField) {
  const chosen = candidates.slice(0, questionCount);
  return chosen.map((candidate, index) => ({
    id: `q${index + 1}`,
    type: "typing",
    fromField,
    toField,
    number: index + 1,
    termId: candidate.termId,
    fromTerm: candidate.fromTerm,
    correctToTerm: candidate.toTerm,
    acceptedAnswers: candidate.acceptedAnswers || [candidate.toTerm],
    answered: false,
    typedAnswer: "",
    isCorrect: null,
    sourceType: candidate.sourceType,
    sourceDataset: candidate.sourceDataset,
    category: candidate.category,
    baseTermKey: candidate.baseTermKey,
    userTermId: candidate.userTermId,
    explanation: candidate.explanation || ""
  }));
}

function createTrueFalseQuestions(candidates, questionCount, fromField, toField, truthOffset = 0) {
  const chosen = candidates.slice(0, questionCount);
  return chosen.map((candidate, index) => {
    const sameCategory = candidates.filter((other) => other !== candidate && other.category === candidate.category
      && normalizeAnswer(other.toTerm) !== normalizeAnswer(candidate.toTerm));
    const fallback = candidates.filter((other) => other !== candidate
      && normalizeAnswer(other.toTerm) !== normalizeAnswer(candidate.toTerm));
    shuffle(sameCategory);
    shuffle(fallback);
    const distractor = (sameCategory[0] || fallback[0] || null);
    const canBeFalse = !!distractor;
    const isTrue = !canBeFalse || (index + truthOffset) % 2 === 0;
    const proposedToTerm = isTrue ? candidate.toTerm : distractor.toTerm;
    return {
      id: `q${index + 1}`,
      type: "true_false",
      fromField,
      toField,
      number: index + 1,
      termId: candidate.termId,
      fromTerm: candidate.fromTerm,
      proposedToTerm,
      correctToTerm: candidate.toTerm,
      acceptedAnswers: candidate.acceptedAnswers || [candidate.toTerm],
      correctBoolean: isTrue,
      options: [
        { id: "true", text: "True" },
        { id: "false", text: "False" }
      ],
      answered: false,
      selectedOptionId: null,
      isCorrect: null,
      sourceType: candidate.sourceType,
      sourceDataset: candidate.sourceDataset,
      category: candidate.category,
      baseTermKey: candidate.baseTermKey,
      userTermId: candidate.userTermId,
      explanation: candidate.explanation || ""
    };
  });
}

function createMatchingQuestions(candidates, questionCount, fromField, toField) {
  const chosen = candidates.slice(0, questionCount);
  const choices = [...new Set(chosen.map((candidate) => candidate.toTerm).filter(Boolean))];
  shuffle(choices);
  const pairs = chosen.map((candidate, index) => ({
    pairId: `p${index + 1}`,
    termId: candidate.termId,
    fromTerm: candidate.fromTerm,
    correctToTerm: candidate.toTerm,
    selectedToTerm: "",
    isCorrect: null,
    sourceType: candidate.sourceType,
    sourceDataset: candidate.sourceDataset,
    baseTermKey: candidate.baseTermKey,
    userTermId: candidate.userTermId,
    explanation: candidate.explanation || ""
  }));
  return [{
    id: "m1",
    type: "matching",
    fromField,
    toField,
    number: 1,
    pairs,
    choices,
    answered: false
  }];
}

function buildWrongEntry(item, chosenValue, timestamp) {
  return {
    termId: item.termId,
    fromTerm: item.fromTerm,
    correctToTerm: item.correctToTerm,
    userChosen: chosenValue,
    timestamp,
    sourceType: item.sourceType,
    sourceDataset: item.sourceDataset,
    baseTermKey: item.baseTermKey,
    userTermId: item.userTermId,
    questionType: item.type || "multiple_choice",
    proposedToTerm: item.proposedToTerm || "",
    correctBoolean: typeof item.correctBoolean === "boolean" ? item.correctBoolean : null,
    explanation: item.explanation || ""
  };
}

export function createQuizEngine({
  onTick = () => {},
  getTermStats = () => ({ correct: 0, wrong: 0 }),
  recordAttempt = () => {},
  recordSession = () => {},
  appendWrongTermsLog = () => {},
  persistSession = () => {}
} = {}) {
  const state = {
    active: false,
    finished: false,
    quizType: "multiple_choice",
    fromField: null,
    toField: null,
    settings: null,
    pool: [],
    questions: [],
    currentIndex: 0,
    score: 0,
    answered: 0,
    skipped: 0,
    streak: 0,
    bestStreak: 0,
    wrongAnswers: [],
    skippedAnswers: [],
    startedAt: null,
    finishedAt: null,
    timerSeconds: 0,
    timeLeftSeconds: null,
    timerHandle: null
  };

  function clearTimer() {
    if (state.timerHandle) {
      clearInterval(state.timerHandle);
      state.timerHandle = null;
    }
  }

  function getCurrentQuestion() {
    return state.questions[state.currentIndex] || null;
  }

  function getQuizState() {
    return {
      active: state.active,
      finished: state.finished,
      quizType: state.quizType,
      fromField: state.fromField,
      toField: state.toField,
      settings: state.settings,
      questions: state.questions,
      currentIndex: state.currentIndex,
      currentQuestion: getCurrentQuestion(),
      score: state.score,
      answered: state.answered,
      skipped: state.skipped,
      streak: state.streak,
      bestStreak: state.bestStreak,
      wrongAnswers: state.wrongAnswers,
      skippedAnswers: state.skippedAnswers,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      timeLeftSeconds: state.timeLeftSeconds
    };
  }

  function logWrongAnswer(item, fromField, toField, chosenValue, timestamp) {
    const wrongEntry = buildWrongEntry(item, chosenValue, timestamp);
    state.wrongAnswers.push(wrongEntry);
    appendWrongTermsLog({
      termId: wrongEntry.termId,
      fromField,
      toField,
      chosen: wrongEntry.userChosen || "",
      correct: wrongEntry.correctToTerm || "",
      timestamp: wrongEntry.timestamp
    });
    return wrongEntry;
  }

  function finishQuiz() {
    if (!state.active && state.finished) return getQuizState();
    clearTimer();
    state.active = false;
    state.finished = true;
    state.finishedAt = new Date().toISOString();
    const summary = {
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      fromField: state.fromField,
      toField: state.toField,
      score: state.score,
      skipped: state.skipped,
      total: state.settings && state.settings.questionCount ? state.settings.questionCount : state.questions.length,
      wrongAnswers: state.wrongAnswers.slice(),
      skippedAnswers: state.skippedAnswers.slice(),
      settings: state.settings
    };
    recordSession(summary);
    persistSession();
    onTick(getQuizState());
    return getQuizState();
  }

  function startTimer() {
    clearTimer();
    if (!(state.timerSeconds > 0)) return;
    const deadline = Date.now() + state.timerSeconds * 1000;
    state.timeLeftSeconds = state.timerSeconds;
    state.timerHandle = setInterval(() => {
      const leftMs = deadline - Date.now();
      state.timeLeftSeconds = Math.max(0, Math.ceil(leftMs / 1000));
      if (leftMs <= 0) {
        finishQuiz();
      } else {
        onTick(getQuizState());
      }
    }, 250);
  }

  function startQuiz({
    candidates,
    fromField,
    toField,
    questionCount,
    optionsCount,
    quizType = "multiple_choice",
    filters = {}
  }) {
    const normalizedQuizType = ["multiple_choice", "matching", "typing", "true_false", "mixed"].includes(String(quizType || ""))
      ? String(quizType)
      : "multiple_choice";
    const preferWrong = !!filters.preferWrong;
    const usableCandidates = (candidates || []).filter((candidate) => candidate && candidate.fromTerm && candidate.toTerm);
    const answersByPrompt = new Map();
    for(const candidate of usableCandidates){
      const key = normalizeAnswer(candidate.fromTerm);
      if(!answersByPrompt.has(key)) answersByPrompt.set(key, new Map());
      answersByPrompt.get(key).set(normalizeAnswer(candidate.toTerm), candidate.toTerm);
    }
    usableCandidates.forEach(candidate => { candidate.acceptedAnswers = [...answersByPrompt.get(normalizeAnswer(candidate.fromTerm)).values()]; });
    const seenPrompts = new Set();
    const uniquePrompts = usableCandidates.filter(candidate => {
      const prompt = normalizeAnswer(candidate.fromTerm);
      if(seenPrompts.has(prompt)) return false;
      seenPrompts.add(prompt);
      return true;
    });
    const uniqueMatching = [];
    const matchingAnswers = new Set();
    const matchingPrompts = new Set();
    for(const candidate of usableCandidates){
      const answer = normalizeAnswer(candidate.toTerm);
      const prompt = normalizeAnswer(candidate.fromTerm);
      if(matchingAnswers.has(answer) || matchingPrompts.has(prompt) || candidate.acceptedAnswers.length !== 1) continue;
      matchingAnswers.add(answer);
      matchingPrompts.add(prompt);
      uniqueMatching.push(candidate);
    }
    const available = normalizedQuizType === "matching" ? uniqueMatching : uniquePrompts;
    if (available.length < 1) {
      return { ok: false, reason: "quiz_err_no_pairs" };
    }
    if (normalizedQuizType === "matching" && available.length < 2) {
      return { ok: false, reason: "quiz_err_need_two_pairs" };
    }
    if (["multiple_choice", "mixed"].includes(normalizedQuizType) && new Set(available.map(candidate => normalizeAnswer(candidate.toTerm))).size < 2) {
      return { ok: false, reason: "quiz_err_need_two_pairs" };
    }

    const maxQuestions = Math.max(normalizedQuizType === "matching" ? 2 : 1, Math.min(Number(questionCount) || 5, available.length));
    const answersPerQuestion = Math.max(2, Math.min(Number(optionsCount) || 4, 6));

    const selectionMode = String(filters.selectionMode || "smart") === "random" ? "random" : "smart";
    const selected = weightedSampleWithoutReplacement(available, maxQuestions, (candidate) => {
        if (selectionMode === "random") return 1;
        const stats = getTermStats(candidate.termId, fromField, toField);
        return studyWeight(stats) * (preferWrong ? 1 + Math.min(3, Number(stats.wrong || 0)) : 1);
      });

    state.active = true;
    state.finished = false;
    state.quizType = normalizedQuizType;
    state.fromField = fromField;
    state.toField = toField;
    state.settings = {
      questionCount: maxQuestions,
      optionsCount: answersPerQuestion,
      type: normalizedQuizType,
      filters: {
        onlyStarred: !!filters.onlyStarred,
        preferWrong,
        doubleConfirm: !!filters.doubleConfirm,
        selectionMode,
        sessionMode: String(filters.sessionMode || "study") === "exam" ? "exam" : "study"
      },
      customFilters: filters.customFilters || null,
      timer: Number(filters.timerSeconds || 0)
    };
    state.pool = available;
    if (normalizedQuizType === "typing") {
      state.questions = createTypingQuestions(selected, maxQuestions, fromField, toField);
    } else if (normalizedQuizType === "true_false") {
      state.questions = createTrueFalseQuestions(selected, maxQuestions, fromField, toField);
    } else if (normalizedQuizType === "matching") {
      state.questions = createMatchingQuestions(selected, maxQuestions, fromField, toField);
    } else if (normalizedQuizType === "mixed") {
      state.questions = selected.map((candidate, index) => {
        const pool = [candidate, ...available.filter(item => item !== candidate)];
        const mode = index % 3;
        const question = mode === 1
          ? createTypingQuestions(pool, 1, fromField, toField)[0]
          : mode === 2
            ? createTrueFalseQuestions(pool, 1, fromField, toField, index)[0]
            : createQuizQuestions(pool, 1, answersPerQuestion, fromField, toField)[0];
        return { ...question, id: `q${index + 1}`, number: index + 1 };
      });
    } else {
      state.questions = createQuizQuestions([...selected, ...available.filter(item => !selected.includes(item))], maxQuestions, answersPerQuestion, fromField, toField);
    }
    state.currentIndex = 0;
    state.score = 0;
    state.answered = 0;
    state.skipped = 0;
    state.streak = 0;
    state.bestStreak = 0;
    state.wrongAnswers = [];
    state.skippedAnswers = [];
    state.startedAt = new Date().toISOString();
    state.finishedAt = null;
    state.timerSeconds = Number(filters.timerSeconds || 0);
    state.timeLeftSeconds = state.timerSeconds > 0 ? state.timerSeconds : null;
    startTimer();
    return { ok: true };
  }

  function answerQuestion(questionId, selectedOptionId) {
    if (!state.active) return { ok: false, reason: "Quiz not active." };
    const question = getCurrentQuestion();
    if (!question || question.id !== questionId || question.answered) {
      return { ok: false, reason: "Question already answered." };
    }

    if (question.type === "typing") {
      const typed = String(selectedOptionId || "").trim();
      question.answered = true;
      question.typedAnswer = typed;
      question.isCorrect = (question.acceptedAnswers || [question.correctToTerm]).some(answer => normalizeAnswer(typed) === normalizeAnswer(answer));
      state.answered += 1;
      if (question.isCorrect) {
        state.score += 1;
        state.streak += 1;
        state.bestStreak = Math.max(state.bestStreak, state.streak);
      } else {
        state.streak = 0;
        logWrongAnswer(question, question.fromField, question.toField, typed, new Date().toISOString());
      }
      recordAttempt(question.termId, question.fromField, question.toField, question.isCorrect);
      question.pendingOptionId = "";
      return { ok: true, question };
    }

    if (question.type === "matching") {
      return { ok: false, reason: "Use matching submit." };
    }

    if (question.type === "true_false") {
      const selected = question.options.find((option) => option.id === selectedOptionId);
      if (!selected) return { ok: false, reason: "Invalid option." };
      question.answered = true;
      question.selectedOptionId = selectedOptionId;
      question.isCorrect = (selectedOptionId === "true") === !!question.correctBoolean;
      state.answered += 1;
      if (question.isCorrect) {
        state.score += 1;
        state.streak += 1;
        state.bestStreak = Math.max(state.bestStreak, state.streak);
      } else {
        state.streak = 0;
        logWrongAnswer(question, question.fromField, question.toField, selected.text, new Date().toISOString());
      }
      recordAttempt(question.termId, question.fromField, question.toField, question.isCorrect);
      return { ok: true, question };
    }

    const selected = question.options.find((option) => option.id === selectedOptionId);
    if (!selected) return { ok: false, reason: "Invalid option." };

    question.answered = true;
    question.selectedOptionId = selectedOptionId;
    question.isCorrect = (question.acceptedAnswers || [question.correctToTerm]).some(answer => normalizeAnswer(selected.text) === normalizeAnswer(answer));
    state.answered += 1;
    if (question.isCorrect) {
      state.score += 1;
      state.streak += 1;
      state.bestStreak = Math.max(state.bestStreak, state.streak);
    } else {
      state.streak = 0;
      logWrongAnswer(question, question.fromField, question.toField, selected.text, new Date().toISOString());
    }
    recordAttempt(question.termId, question.fromField, question.toField, question.isCorrect);
    question.pendingOptionId = "";
    return { ok: true, question };
  }

  function submitMatching(questionId, answersByPairId) {
    if (!state.active) return { ok: false, reason: "Quiz not active." };
    const question = getCurrentQuestion();
    if (!question || question.id !== questionId || question.answered || question.type !== "matching") {
      return { ok: false, reason: "Matching question unavailable." };
    }
    const answerMap = answersByPairId && typeof answersByPairId === "object" ? answersByPairId : {};
    let correctCount = 0;
    let wrongCount = 0;
    const timestamp = new Date().toISOString();
    for (const pair of question.pairs) {
      const chosen = String(answerMap[pair.pairId] || "").trim();
      pair.selectedToTerm = chosen;
      pair.isCorrect = chosen.toLowerCase() === String(pair.correctToTerm || "").trim().toLowerCase();
      state.answered += 1;
      if (pair.isCorrect) {
        correctCount += 1;
      } else {
        wrongCount += 1;
        logWrongAnswer(pair, question.fromField, question.toField, chosen, timestamp);
      }
      recordAttempt(pair.termId, question.fromField, question.toField, pair.isCorrect);
    }
    state.score += correctCount;
    state.streak = wrongCount === 0 ? state.streak + 1 : 0;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    question.answered = true;
    return { ok: true, question };
  }

  function nextQuestion() {
    if (!state.active) return;
    const question = getCurrentQuestion();
    if (!question || !question.answered) return;
    if (state.currentIndex >= state.questions.length - 1) {
      finishQuiz();
      return;
    }
    state.currentIndex += 1;
  }

  function skipQuestion() {
    if (!state.active) return;
    const question = getCurrentQuestion();
    if (!question || question.answered || question.type === "matching") return;
    question.answered = true;
    question.skipped = true;
    question.isCorrect = false;
    state.skipped += 1;
    state.skippedAnswers.push(buildWrongEntry(question, "Skipped", new Date().toISOString()));
    state.streak = 0;
  }

  return {
    startQuiz,
    answerQuestion,
    submitMatching,
    getQuizState,
    finishQuiz,
    nextQuestion,
    skipQuestion
  };
}
