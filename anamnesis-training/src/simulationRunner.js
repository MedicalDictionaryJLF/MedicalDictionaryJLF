import { PatientEngine } from './patientEngine.js';
import { PATIENT_CASES } from './patientCase.js';
import { simulationTests } from './simulationTests.js';

function normalizeList(value) {
  return Array.isArray(value) ? value : [value];
}

export function runSimulationTests() {
  const results = simulationTests.map((test) => {
    const patientCase = PATIENT_CASES.find((item) => item.id === test.caseId) || PATIENT_CASES[0];
    const engine = new PatientEngine(patientCase, { mode: 'simulation' });
    for (const setup of test.setupTurns ?? []) engine.ask(setup);
    const result = engine.ask(test.question);
    const detection = result.detection;
    const actualIds = detection.answerIntents.map((item) => item.id);
    const expectedIds = normalizeList(test.expectedPrimaryIntent);
    const failures = [];
    for (const id of expectedIds) if (!actualIds.includes(id) && detection.primaryIntent?.id !== id) failures.push(`Expected intent ${id}, got ${actualIds.join(', ') || detection.primaryIntent?.id || 'none'}`);
    if (test.expectedScope && detection.responseScope !== test.expectedScope) failures.push(`Expected scope ${test.expectedScope}, got ${detection.responseScope}`);
    if (test.shouldFallback === false && detection.responseScope === 'clarification') failures.push('Unexpected fallback/clarification');
    for (const term of test.mustContain ?? []) if (!result.reply.toLowerCase().includes(term.toLowerCase())) failures.push(`Reply must contain “${term}”`);
    for (const term of test.mustNotContain ?? []) if (result.reply.toLowerCase().includes(term.toLowerCase())) failures.push(`Reply must not contain “${term}”`);
    if (test.expectedTerminologySuggestion && !result.terminologySuggestion.toLowerCase().includes(test.expectedTerminologySuggestion.toLowerCase())) failures.push(`Expected terminology suggestion “${test.expectedTerminologySuggestion}”`);
    if (/\b(hpi_|ros_|pmh_|intent|classifier|domain)\b/i.test(result.reply)) failures.push('Patient reply exposes internal labels');
    return { id: test.id, question: test.question, caseId: test.caseId, expectedIntent: test.expectedPrimaryIntent, actualIntent: actualIds, expectedScope: test.expectedScope, actualScope: detection.responseScope, patientAnswer: result.reply, terminologySuggestion: result.terminologySuggestion, passed: failures.length === 0, failures, debug: detection };
  });
  const passed = results.filter((item) => item.passed).length;
  return { exportedAt: new Date().toISOString(), total: results.length, passed, failed: results.length - passed, passRate: Math.round((passed / Math.max(1, results.length)) * 100), results };
}
