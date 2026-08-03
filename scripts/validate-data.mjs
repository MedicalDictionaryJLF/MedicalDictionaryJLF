import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { validateCsvFile } from "./lib/csv-validation.mjs";
import {
  configuredPharmacologyRecordCount,
  validatePharmacologyFile,
} from "./lib/pharmacology-validation.mjs";
import { ARTIFACTS_DIRECTORY, REPOSITORY_ROOT } from "./project-config.mjs";
import { toPosixPath, walkFiles } from "./lib/file-references.mjs";

const csvFiles = walkFiles(
  resolve(REPOSITORY_ROOT, "data/terminology"),
  (file) => file.toLowerCase().endsWith(".csv"),
).sort();
const csvResults = csvFiles.map((file) => validateCsvFile(file));

const pharmacologyFile = resolve(
  REPOSITORY_ROOT,
  "data/pharmacology_database_test.json",
);
const pharmacologyServiceSource = readFileSync(
  resolve(REPOSITORY_ROOT, "assets/js/pharmacology/pharmacology-service.js"),
  "utf8",
);
const expectedRecordCount = configuredPharmacologyRecordCount(
  pharmacologyServiceSource,
);
const pharmacology = validatePharmacologyFile(pharmacologyFile, {
  expectedRecordCount,
});

const report = {
  generatedAt: new Date().toISOString(),
  csv: csvResults.map((result) => ({
    ...result,
    filePath: toPosixPath(relative(REPOSITORY_ROOT, result.filePath)),
  })),
  pharmacology: {
    ...pharmacology,
    filePath: toPosixPath(relative(REPOSITORY_ROOT, pharmacology.filePath)),
  },
};

mkdirSync(ARTIFACTS_DIRECTORY, { recursive: true });
writeFileSync(
  resolve(ARTIFACTS_DIRECTORY, "dataset-validation.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

console.table(
  report.csv.map((result) => ({
    dataset: result.filePath,
    rows: result.rows,
    usable: result.usableRows,
    errors: result.errors.length,
    warnings: result.warnings.length,
  })),
);
console.table([
  {
    dataset: report.pharmacology.filePath,
    records: report.pharmacology.recordCount,
    serviceExpected:
      report.pharmacology.expectedRecordCount ?? "not configured",
    countMatches: report.pharmacology.expectedCountMatches ?? "n/a",
    humanReview: report.pharmacology.humanReviewCount,
    errors: report.pharmacology.errors.length,
    warnings: report.pharmacology.warnings.length,
  },
]);

for (const result of report.csv) {
  for (const warning of result.warnings)
    console.warn(`Warning: ${result.filePath}: ${warning}.`);
  for (const error of result.errors)
    console.error(`Error: ${result.filePath}: ${error}.`);
}
for (const warning of report.pharmacology.warnings) {
  console.warn(`Warning: ${report.pharmacology.filePath}: ${warning}.`);
}
for (const error of report.pharmacology.errors) {
  console.error(`Error: ${report.pharmacology.filePath}: ${error}.`);
}

const errorCount =
  report.csv.reduce((sum, result) => sum + result.errors.length, 0) +
  report.pharmacology.errors.length;
if (errorCount) {
  console.error(`Dataset validation failed with ${errorCount} error(s).`);
  process.exitCode = 1;
} else {
  const csvRows = report.csv.reduce(
    (sum, result) => sum + result.usableRows,
    0,
  );
  console.log(
    `Dataset validation passed: ${report.csv.length} CSV files (${csvRows} usable rows) and ${report.pharmacology.recordCount} pharmacology records.`,
  );
}
