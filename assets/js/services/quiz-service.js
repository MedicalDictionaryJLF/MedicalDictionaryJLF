function shuffle(items, random = Math.random) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

export function weightedSampleWithoutReplacement(
  items,
  count,
  weightFn,
  random = Math.random,
) {
  const pool = items.slice();
  const selected = [];
  const take = Math.min(count, pool.length);
  for (let index = 0; index < take; index += 1) {
    const weighted = pool.map((item) => ({
      item,
      weight: Math.max(0.01, Number(weightFn(item)) || 1),
    }));
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    let hit = random() * total;
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

function createQuizQuestions(
  candidates,
  questionCount,
  optionsCount,
  fromField,
  toField,
  random,
) {
  const chosen = candidates.slice(0, questionCount);
  const allAnswers = [
    ...new Set(candidates.map((candidate) => candidate.toTerm).filter(Boolean)),
  ];
  return chosen.map((candidate, index) => {
    const options = [candidate.toTerm];
    const distractors = allAnswers.filter(
      (value) => value !== candidate.toTerm,
    );
    shuffle(distractors, random);
    for (
      let distractorIndex = 0;
      distractorIndex < distractors.length && options.length < optionsCount;
      distractorIndex += 1
    ) {
      options.push(distractors[distractorIndex]);
    }
    shuffle(options, random);
    return {
      id: `q${index + 1}`,
      type: "multiple_choice",
      fromField,
      toField,
      number: index + 1,
      termId: candidate.termId,
      fromTerm: candidate.fromTerm,
      correctToTerm: candidate.toTerm,
      options: options.map((text, optionIndex) => ({
        id: `o${optionIndex + 1}`,
        text,
      })),
      answered: false,
      selectedOptionId: null,
      isCorrect: null,
      sourceType: candidate.sourceType,
      sourceDataset: candidate.sourceDataset,
      baseTermKey: candidate.baseTermKey,
      userTermId: candidate.userTermId,
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
    answered: false,
    typedAnswer: "",
    isCorrect: null,
    sourceType: candidate.sourceType,
    sourceDataset: candidate.sourceDataset,
    baseTermKey: candidate.baseTermKey,
    userTermId: candidate.userTermId,
  }));
}

function createMatchingQuestions(
  candidates,
  questionCount,
  fromField,
  toField,
  random,
) {
  const chosen = candidates.slice(0, questionCount);
  const choices = [
    ...new Set(chosen.map((candidate) => candidate.toTerm).filter(Boolean)),
  ];
  shuffle(choices, random);
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
  }));
  return [
    {
      id: "m1",
      type: "matching",
      fromField,
      toField,
      number: 1,
      pairs,
      choices,
      answered: false,
    },
  ];
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
  };
}

export function createQuizEngine({
  random = Math.random,
  onTick = () => {},
  getTermStats = () => ({ correct: 0, wrong: 0 }),
  recordAttempt = () => {},
  recordSession = () => {},
  appendWrongTermsLog = () => {},
  persistSession = () => {},
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
    streak: 0,
    bestStreak: 0,
    wrongAnswers: [],
    startedAt: null,
    finishedAt: null,
    timerSeconds: 0,
    timeLeftSeconds: null,
    timerHandle: null,
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
      streak: state.streak,
      bestStreak: state.bestStreak,
      wrongAnswers: state.wrongAnswers,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      timeLeftSeconds: state.timeLeftSeconds,
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
      timestamp: wrongEntry.timestamp,
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
      total:
        state.settings && state.settings.questionCount
          ? state.settings.questionCount
          : state.questions.length,
      wrongAnswers: state.wrongAnswers.slice(),
      settings: state.settings,
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
    filters = {},
  }) {
    const normalizedQuizType = [
      "multiple_choice",
      "matching",
      "typing",
    ].includes(String(quizType || ""))
      ? String(quizType)
      : "multiple_choice";
    const preferWrong = !!filters.preferWrong;
    const usableCandidates = (candidates || []).filter(
      (candidate) => candidate && candidate.fromTerm && candidate.toTerm,
    );
    if (usableCandidates.length < 1) {
      return { ok: false, reason: "quiz_err_no_pairs" };
    }
    if (
      normalizedQuizType === "multiple_choice" &&
      usableCandidates.length < 2
    ) {
      return { ok: false, reason: "quiz_err_need_two_pairs" };
    }

    const maxQuestions = Math.max(
      1,
      Math.min(Number(questionCount) || 5, usableCandidates.length),
    );
    const answersPerQuestion = Math.max(
      2,
      Math.min(Number(optionsCount) || 4, 6),
    );

    let selected = usableCandidates.slice();
    if (preferWrong) {
      selected = weightedSampleWithoutReplacement(
        usableCandidates,
        maxQuestions,
        (candidate) => {
          const stats = getTermStats(candidate.termId, fromField, toField);
          const wrong = Number(stats.wrong || 0);
          const correct = Number(stats.correct || 0);
          return 1 + Math.max(0, wrong - correct) + Math.min(3, wrong);
        },
        random,
      );
    } else {
      shuffle(selected, random);
      selected = selected.slice(0, maxQuestions);
    }

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
      },
      customFilters: filters.customFilters || null,
      timer: Number(filters.timerSeconds || 0),
    };
    state.pool = usableCandidates;
    if (normalizedQuizType === "typing") {
      state.questions = createTypingQuestions(
        selected,
        maxQuestions,
        fromField,
        toField,
      );
    } else if (normalizedQuizType === "matching") {
      state.questions = createMatchingQuestions(
        selected,
        maxQuestions,
        fromField,
        toField,
        random,
      );
    } else {
      state.questions = createQuizQuestions(
        selected,
        maxQuestions,
        answersPerQuestion,
        fromField,
        toField,
        random,
      );
    }
    state.currentIndex = 0;
    state.score = 0;
    state.answered = 0;
    state.streak = 0;
    state.bestStreak = 0;
    state.wrongAnswers = [];
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
      question.isCorrect =
        typed.toLowerCase() ===
        String(question.correctToTerm || "")
          .trim()
          .toLowerCase();
      state.answered += 1;
      if (question.isCorrect) {
        state.score += 1;
        state.streak += 1;
        state.bestStreak = Math.max(state.bestStreak, state.streak);
      } else {
        state.streak = 0;
        logWrongAnswer(
          question,
          question.fromField,
          question.toField,
          typed,
          new Date().toISOString(),
        );
      }
      recordAttempt(
        question.termId,
        question.fromField,
        question.toField,
        question.isCorrect,
      );
      question.pendingOptionId = "";
      return { ok: true, question };
    }

    if (question.type === "matching") {
      return { ok: false, reason: "Use matching submit." };
    }

    const selected = question.options.find(
      (option) => option.id === selectedOptionId,
    );
    if (!selected) return { ok: false, reason: "Invalid option." };

    question.answered = true;
    question.selectedOptionId = selectedOptionId;
    question.isCorrect = selected.text === question.correctToTerm;
    state.answered += 1;
    if (question.isCorrect) {
      state.score += 1;
      state.streak += 1;
      state.bestStreak = Math.max(state.bestStreak, state.streak);
    } else {
      state.streak = 0;
      logWrongAnswer(
        question,
        question.fromField,
        question.toField,
        selected.text,
        new Date().toISOString(),
      );
    }
    recordAttempt(
      question.termId,
      question.fromField,
      question.toField,
      question.isCorrect,
    );
    question.pendingOptionId = "";
    return { ok: true, question };
  }

  function submitMatching(questionId, answersByPairId) {
    if (!state.active) return { ok: false, reason: "Quiz not active." };
    const question = getCurrentQuestion();
    if (
      !question ||
      question.id !== questionId ||
      question.answered ||
      question.type !== "matching"
    ) {
      return { ok: false, reason: "Matching question unavailable." };
    }
    const answerMap =
      answersByPairId && typeof answersByPairId === "object"
        ? answersByPairId
        : {};
    let correctCount = 0;
    let wrongCount = 0;
    const timestamp = new Date().toISOString();
    for (const pair of question.pairs) {
      const chosen = String(answerMap[pair.pairId] || "").trim();
      pair.selectedToTerm = chosen;
      pair.isCorrect =
        chosen.toLowerCase() ===
        String(pair.correctToTerm || "")
          .trim()
          .toLowerCase();
      state.answered += 1;
      if (pair.isCorrect) {
        correctCount += 1;
      } else {
        wrongCount += 1;
        logWrongAnswer(
          pair,
          question.fromField,
          question.toField,
          chosen,
          timestamp,
        );
      }
      recordAttempt(
        pair.termId,
        question.fromField,
        question.toField,
        pair.isCorrect,
      );
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

  return {
    startQuiz,
    answerQuestion,
    submitMatching,
    getQuizState,
    finishQuiz,
    nextQuestion,
  };
}
