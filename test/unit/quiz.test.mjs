import assert from "node:assert/strict";
import test from "node:test";
import { createQuizEngine } from "../../assets/js/services/quiz-service.js";

const candidates = [
  { termId: "1", fromTerm: "cor", toTerm: "heart", sourceType: "base" },
  { termId: "2", fromTerm: "pulmo", toTerm: "lung", sourceType: "base" },
  { termId: "3", fromTerm: "ren", toTerm: "kidney", sourceType: "base" },
];

test("multiple-choice quiz records correct and incorrect answers and completes", () => {
  const attempts = [];
  const engine = createQuizEngine({
    random: () => 0,
    recordAttempt: (...values) => attempts.push(values),
  });
  assert.deepEqual(
    engine.startQuiz({
      candidates,
      fromField: "latin",
      toField: "english",
      questionCount: 2,
      optionsCount: 3,
    }),
    { ok: true },
  );

  let state = engine.getQuizState();
  const first = state.currentQuestion;
  const correct = first.options.find(
    (option) => option.text === first.correctToTerm,
  );
  assert.equal(
    engine.answerQuestion(first.id, correct.id).question.isCorrect,
    true,
  );
  engine.nextQuestion();

  state = engine.getQuizState();
  const second = state.currentQuestion;
  const incorrect = second.options.find(
    (option) => option.text !== second.correctToTerm,
  );
  assert.equal(
    engine.answerQuestion(second.id, incorrect.id).question.isCorrect,
    false,
  );
  engine.nextQuestion();

  state = engine.getQuizState();
  assert.equal(state.finished, true);
  assert.equal(state.active, false);
  assert.equal(state.score, 1);
  assert.equal(state.answered, 2);
  assert.equal(state.wrongAnswers.length, 1);
  assert.equal(attempts.length, 2);
});

test("typing normalization matches current trim and case-insensitive behavior", () => {
  const engine = createQuizEngine({ random: () => 0 });
  engine.startQuiz({
    candidates,
    fromField: "latin",
    toField: "english",
    questionCount: 1,
    optionsCount: 2,
    quizType: "typing",
  });
  const question = engine.getQuizState().currentQuestion;
  assert.equal(
    engine.answerQuestion(
      question.id,
      `  ${question.correctToTerm.toUpperCase()}  `,
    ).question.isCorrect,
    true,
  );
});

test("matching questions score every pair without timer-dependent transitions", () => {
  const engine = createQuizEngine({ random: () => 0 });
  engine.startQuiz({
    candidates,
    fromField: "latin",
    toField: "english",
    questionCount: 3,
    optionsCount: 3,
    quizType: "matching",
    filters: { timerSeconds: 0 },
  });
  const question = engine.getQuizState().currentQuestion;
  const answers = Object.fromEntries(
    question.pairs.map((pair, index) => [
      pair.pairId,
      index === 0 ? pair.correctToTerm : "wrong",
    ]),
  );
  const result = engine.submitMatching(question.id, answers);
  assert.equal(result.ok, true);
  assert.equal(engine.getQuizState().score, 1);
  assert.equal(engine.getQuizState().answered, 3);
  engine.nextQuestion();
  assert.equal(engine.getQuizState().finished, true);
});
