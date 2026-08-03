import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parseCSVLines,
  rowsToObjectsWithHeaders,
} from "../../assets/js/services/csv-utils.js";
import {
  parseCsvStrict,
  validateCsvFile,
} from "../../scripts/lib/csv-validation.mjs";
import { TERMINOLOGY_SOURCES } from "../../assets/js/services/data-repository.js";

test("browser CSV helpers parse delimiters, escaped quotes, and objects", () => {
  const rows = parseCSVLines(
    'id;english_translation;note\n1;Heart;"said ""hello"""\n',
  );
  assert.deepEqual(rows, [
    ["id", "english_translation", "note"],
    ["1", "Heart", 'said "hello"'],
  ]);
  assert.deepEqual(rowsToObjectsWithHeaders(rows), {
    headers: ["id", "english_translation", "note"],
    objects: [{ id: "1", english_translation: "Heart", note: 'said "hello"' }],
  });
});

test("strict CSV parser supports quoted newlines and reports malformed quotes", () => {
  const valid = parseCsvStrict('id,name\n1,"two\nlines"\n');
  assert.deepEqual(valid.errors, []);
  assert.deepEqual(valid.rows[1].values, ["1", "two\nlines"]);

  const invalid = parseCsvStrict('id,name\n1,"unterminated\n');
  assert.ok(
    invalid.errors.some((error) => error.includes("unterminated quoted field")),
  );
});

test("CSV validator rejects duplicate headers, missing identities, and empty active datasets", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "medical-dictionary-csv-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const duplicateHeader = join(directory, "duplicate.csv");
  writeFileSync(duplicateHeader, "id,id\n1,1\n", "utf8");
  assert.ok(
    validateCsvFile(duplicateHeader).errors.some((error) =>
      error.includes("duplicate headers"),
    ),
  );

  const missingId = join(directory, "missing.csv");
  writeFileSync(missingId, "id,english_translation\n,Heart\n", "utf8");
  assert.ok(
    validateCsvFile(missingId).errors.some((error) =>
      error.includes("missing required identity"),
    ),
  );

  const empty = join(directory, "empty.csv");
  writeFileSync(empty, "id,english_translation\n", "utf8");
  assert.ok(
    validateCsvFile(empty).errors.includes("file contains no usable records"),
  );
});

test("CSV validator warns for empty planned datasets but still rejects malformed files", (t) => {
  const directory = mkdtempSync(
    join(tmpdir(), "medical-dictionary-planned-csv-"),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const emptyPlanned = join(directory, "empty-planned.csv");
  writeFileSync(emptyPlanned, "id,english_translation\n", "utf8");
  const emptyResult = validateCsvFile(emptyPlanned, { status: "planned" });
  assert.deepEqual(emptyResult.errors, []);
  assert.ok(
    emptyResult.warnings.includes("planned dataset contains no usable records"),
  );

  const malformedPlanned = join(directory, "malformed-planned.csv");
  writeFileSync(malformedPlanned, 'id,name\n1,"unterminated\n', "utf8");
  const malformedResult = validateCsvFile(malformedPlanned, {
    status: "planned",
  });
  assert.ok(
    malformedResult.errors.some((error) =>
      error.includes("unterminated quoted field"),
    ),
  );
});

test("only the unfinished terminology sources are marked planned", () => {
  const plannedKeys = TERMINOLOGY_SOURCES.filter(
    (source) => source.status === "planned",
  )
    .map((source) => source.key)
    .sort();

  assert.deepEqual(plannedKeys, [
    "anatomy",
    "diagnostic_methods",
    "disease_and_symptoms",
    "microorganisms",
    "physiology",
    "procedures",
  ]);
  assert.ok(
    TERMINOLOGY_SOURCES.every(
      (source) => source.status === undefined || source.status === "planned",
    ),
  );
});
