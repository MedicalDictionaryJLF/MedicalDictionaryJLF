import { PatientEngine } from "./patientEngine.js";
import { INTENTS, PATIENT_CASES } from "./patientCase.js";
import { simulationTests } from "./simulationTests.js";

const INTERNAL_LABEL_PATTERN = /\b(hpi_|ros_|pmh_|intent|classifier|domain)\b/i;

function normalizeList(value) {
  return Array.isArray(value) ? value : [value];
}

export function validateSimulationFixtures({
  tests = simulationTests,
  patientCases = PATIENT_CASES,
  intents = INTENTS,
} = {}) {
  const errors = [];
  const caseIds = new Set(
    patientCases.map((patientCase) => patientCase?.id).filter(Boolean),
  );
  const intentIds = new Set(Object.keys(intents || {}));
  const testIds = new Set();

  if (!Array.isArray(tests) || tests.length === 0) {
    errors.push("Simulation fixture set must contain at least one test.");
    return { valid: false, errors };
  }

  for (const [index, test] of tests.entries()) {
    const label = test?.id || `fixture at index ${index}`;
    if (!test?.id) errors.push(`${label}: test id must be non-empty.`);
    if (testIds.has(test?.id)) errors.push(`${label}: duplicate test id.`);
    if (test?.id) testIds.add(test.id);
    if (!caseIds.has(test?.caseId)) {
      errors.push(`${label}: unknown caseId "${test?.caseId || "(empty)"}".`);
    }
    if (!String(test?.question || "").trim()) {
      errors.push(`${label}: question must be non-empty.`);
    }

    const expectedIds = normalizeList(test?.expectedPrimaryIntent).filter(
      Boolean,
    );
    if (expectedIds.length === 0) {
      errors.push(
        `${label}: expectedPrimaryIntent must contain at least one intent id.`,
      );
    }
    for (const intentId of expectedIds) {
      if (!intentIds.has(intentId)) {
        errors.push(`${label}: unknown expected intent id "${intentId}".`);
      }
    }

    if (test?.setupTurns !== undefined && !Array.isArray(test.setupTurns)) {
      errors.push(`${label}: setupTurns must be an array when provided.`);
    }
    for (const field of ["mustContain", "mustNotContain"]) {
      if (test?.[field] !== undefined && !Array.isArray(test[field])) {
        errors.push(`${label}: ${field} must be an array when provided.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidSimulationFixtures(options = {}) {
  const validation = validateSimulationFixtures(options);
  if (!validation.valid) {
    throw new Error(
      `Simulation fixture validation failed:\n- ${validation.errors.join("\n- ")}`,
    );
  }
  return validation;
}

export function runSimulationTests({
  tests = simulationTests,
  patientCases = PATIENT_CASES,
  intents = INTENTS,
  Engine = PatientEngine,
} = {}) {
  const fixtureValidation = assertValidSimulationFixtures({
    tests,
    patientCases,
    intents,
  });
  const results = tests.map((test) => {
    const failures = [];
    const patientCase = patientCases.find((item) => item.id === test.caseId);
    let result = null;
    let detection = null;

    try {
      const engine = new Engine(patientCase, { mode: "simulation" });
      for (const setup of test.setupTurns ?? []) {
        const setupResult = engine.ask(setup);
        if (!setupResult || !String(setupResult.reply || "").trim()) {
          throw new Error(`setup turn returned no usable response: ${setup}`);
        }
      }
      result = engine.ask(test.question);
      detection = result?.detection;
    } catch (error) {
      failures.push(`Simulation execution failed: ${error?.message || error}`);
    }

    const reply = String(result?.reply || "");
    const actualIds = Array.isArray(detection?.answerIntents)
      ? detection.answerIntents.map((item) => item?.id).filter(Boolean)
      : [];
    const expectedIds = normalizeList(test.expectedPrimaryIntent);

    if (!reply.trim()) failures.push("Engine returned no usable response.");
    if (!detection || typeof detection !== "object") {
      failures.push("Engine returned no usable intent detection result.");
    } else {
      for (const id of expectedIds) {
        if (!actualIds.includes(id) && detection.primaryIntent?.id !== id) {
          failures.push(
            `Expected intent ${id}, got ${actualIds.join(", ") || detection.primaryIntent?.id || "none"}`,
          );
        }
      }
      if (
        test.expectedScope &&
        detection.responseScope !== test.expectedScope
      ) {
        failures.push(
          `Expected scope ${test.expectedScope}, got ${detection.responseScope || "none"}`,
        );
      }
      if (
        test.shouldFallback === false &&
        detection.responseScope === "clarification"
      ) {
        failures.push("Unexpected fallback/clarification.");
      }
    }

    for (const term of test.mustContain ?? []) {
      if (!reply.toLowerCase().includes(term.toLowerCase())) {
        failures.push(`Reply must contain "${term}".`);
      }
    }
    for (const term of test.mustNotContain ?? []) {
      if (reply.toLowerCase().includes(term.toLowerCase())) {
        failures.push(`Reply must not contain "${term}".`);
      }
    }

    const terminologySuggestion = String(result?.terminologySuggestion || "");
    if (
      test.expectedTerminologySuggestion &&
      !terminologySuggestion
        .toLowerCase()
        .includes(test.expectedTerminologySuggestion.toLowerCase())
    ) {
      failures.push(
        `Expected terminology suggestion "${test.expectedTerminologySuggestion}".`,
      );
    }
    if (INTERNAL_LABEL_PATTERN.test(reply))
      failures.push("Patient reply exposes internal labels.");

    return {
      id: test.id,
      question: test.question,
      caseId: test.caseId,
      expectedIntent: test.expectedPrimaryIntent,
      actualIntent: actualIds,
      expectedScope: test.expectedScope,
      actualScope: detection?.responseScope || null,
      patientAnswer: reply,
      terminologySuggestion,
      passed: failures.length === 0,
      failures,
      debug: detection,
    };
  });

  const passed = results.filter((item) => item.passed).length;
  const failedResults = results.filter((item) => !item.passed);
  const groupFailures = (selector) =>
    Object.fromEntries(
      [...new Set(failedResults.flatMap(selector))].map((key) => [
        key,
        failedResults
          .filter((item) => selector(item).includes(key))
          .map((item) => item.id),
      ]),
    );

  return {
    exportedAt: new Date().toISOString(),
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: Math.round((passed / Math.max(1, results.length)) * 100),
    fixtureValidation,
    failuresByCase: groupFailures((item) => [item.caseId]),
    failuresByExpectedIntent: groupFailures((item) =>
      normalizeList(item.expectedIntent),
    ),
    results,
  };
}
