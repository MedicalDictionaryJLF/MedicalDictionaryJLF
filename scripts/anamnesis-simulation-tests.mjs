import { runSimulationTests } from "../anamnesis-training/src/simulationRunner.js";

try {
  const report = runSimulationTests();
  console.table([
    {
      total: report.total,
      passed: report.passed,
      failed: report.failed,
      passRate: `${report.passRate}%`,
    },
  ]);

  if (report.failed) {
    for (const result of report.results.filter((item) => !item.passed)) {
      console.error(
        `- ${result.caseId}/${result.id} [${[].concat(result.expectedIntent).join(", ")}]: ${result.failures.join("; ")}`,
      );
    }
    console.error(
      "Failures grouped by case:",
      JSON.stringify(report.failuresByCase, null, 2),
    );
    console.error(
      "Failures grouped by expected intent:",
      JSON.stringify(report.failuresByExpectedIntent, null, 2),
    );
    process.exitCode = 1;
  } else {
    console.log("All anamnesis simulation tests passed.");
  }
} catch (error) {
  console.error(error?.message || error);
  process.exitCode = 1;
}
