import { osceCategories } from './medicalDomains.js';

export const scoringRubrics = {
  osceCategories,
  penalties: {
    repeatedQuestion: 2,
    leadingQuestion: 2,
    tooTechnicalQuestion: 2,
    vagueQuestion: 1,
    harshTone: 3
  },
  difficultyMultipliers: {
    beginner: 1.08,
    intermediate: 1,
    advanced: 0.94
  }
};
