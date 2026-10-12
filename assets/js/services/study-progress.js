// Shared Quiz + Flashcards progress model. Callers own persistence.
const DAY = 86400000;

export function normalizeStudyRecord(value = {}) {
  const row = value && typeof value === "object" ? value : {};
  return {
    ...row,
    correct: Math.max(0, Number(row.correct) || 0),
    wrong: Math.max(0, Number(row.wrong) || 0),
    reviews: Math.max(0, Number(row.reviews) || 0),
    streak: Math.max(0, Number(row.streak) || 0),
    lapses: Math.max(0, Number(row.lapses) || 0),
    intervalDays: Math.max(0, Number(row.intervalDays) || 0),
    manualDifficult: !!row.manualDifficult,
    firstSeen: row.firstSeen || null,
    lastSeen: row.lastSeen || null,
    nextReview: row.nextReview || null,
    lastRating: row.lastRating || null
  };
}

export function getMasteryState(previous) {
  const row = normalizeStudyRecord(previous);
  if (row.manualDifficult || (row.wrong >= 3 && row.wrong > row.correct)) return "difficult";
  if (!row.reviews && !row.correct && !row.wrong) return "new";
  if (row.streak >= 5 && row.correct >= 5 && row.intervalDays >= 7) return "mastered";
  if (row.streak >= 2 && row.correct >= 2) return "familiar";
  return "learning";
}

export function isDifficultStudyRecord(previous) {
  const row = normalizeStudyRecord(previous);
  return row.manualDifficult || row.wrong > row.correct || row.wrong >= 2;
}

export function setManualDifficult(previous, difficult, now = Date.now()) {
  const row = normalizeStudyRecord(previous);
  row.manualDifficult = !!difficult;
  if (!row.firstSeen) row.firstSeen = new Date(now).toISOString();
  row.lastSeen = row.lastSeen || row.firstSeen;
  return row;
}

export function recordStudyEvent(previous, event, now = Date.now()) {
  const row = normalizeStudyRecord(previous);
  const grade = event === "quiz-correct" ? "good" : event === "quiz-wrong" ? "again" : event;
  if (!["again", "hard", "good", "easy"].includes(grade)) return row;

  const timestamp = new Date(now).toISOString();
  row.reviews += 1;
  row.firstSeen = row.firstSeen || timestamp;
  row.lastSeen = timestamp;
  row.lastRating = grade;

  if (grade === "again") {
    row.wrong += 1;
    row.lapses += 1;
    row.streak = 0;
    row.intervalDays = 0;
    row.nextReview = new Date(now + 10 * 60000).toISOString();
  } else {
    row.correct += 1;
    row.streak += 1;
    const previousDays = row.intervalDays;
    row.intervalDays = grade === "hard"
      ? Math.max(0.5, previousDays ? previousDays * 1.2 : 0.5)
      : grade === "easy"
        ? Math.max(4, previousDays ? previousDays * 2.5 : 4)
        : Math.max(1, previousDays ? previousDays * 2 : 1);
    row.nextReview = new Date(now + row.intervalDays * DAY).toISOString();
  }
  return row;
}

export function studyWeight(previous, now = Date.now()) {
  const row = normalizeStudyRecord(previous);
  const mastery = getMasteryState(row);
  if (!row.reviews && !row.correct && !row.wrong) return 3.5;
  const due = row.nextReview && Date.parse(row.nextReview) <= now;
  const age = row.lastSeen ? Math.max(0, (now - Date.parse(row.lastSeen)) / DAY) : 30;
  const masteryBoost = mastery === "difficult" ? 5 : mastery === "learning" ? 2.5 : mastery === "new" ? 2 : mastery === "familiar" ? 0.5 : -1;
  return Math.max(0.25,
    1 + masteryBoost + Math.min(8, row.wrong * 1.4) + (due ? 4 : 0)
    + Math.min(4, age / 7) - Math.min(3, row.streak * 0.45)
  );
}

export function isStudyDue(previous, now = Date.now()) {
  const next = previous && previous.nextReview && Date.parse(previous.nextReview);
  return Number.isFinite(next) && next <= now;
}

export function normalizeAnswer(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
