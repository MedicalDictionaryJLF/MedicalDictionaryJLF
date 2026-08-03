import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createPharmacologyService,
  normalizeAtcCode,
  normalizePharmacologyText,
} from "../../assets/js/pharmacology/pharmacology-service.js";
import {
  assertValidSimulationFixtures,
  validateSimulationFixtures,
} from "../../anamnesis-training/src/simulationRunner.js";
import {
  INTENTS,
  PATIENT_CASES,
} from "../../anamnesis-training/src/patientCase.js";
import { validatePharmacologyFile } from "../../scripts/lib/pharmacology-validation.mjs";

function emptyRecord(id) {
  return {
    id,
    names: { english: { source_value: id }, synonyms: [] },
    atc: {
      primary_code: "A01AA01",
      source_additional_codes: [],
      combined_atc_codes: [],
      classifications: [],
    },
    pharmacology: {
      therapeutic_class: [],
      chemical_class: [],
      mechanisms_of_action: [],
    },
    clinical_uses: { approved_indications: [], common_off_label_uses: [] },
    administration: { routes: [], dosage_forms: [], representative_dosing: [] },
    contraindications_and_precautions: {},
    adverse_effects: { common: [], serious: [] },
    interactions: {
      drug_drug: [],
      drug_food: [],
      drug_disease: [],
      drug_laboratory: [],
      pharmacogenomic: [],
    },
    pharmacokinetics: {},
    data_quality: {
      overall_status: "complete",
      requires_human_review: false,
      missing_fields: [],
      conflicts: [],
      inferences: [],
    },
  };
}

test("pharmacology normalization and indexing preserve basic lookup behavior", async () => {
  const database = {
    schema_version: "1",
    dataset: {},
    drugs: [emptyRecord("Aspirín")],
  };
  const service = createPharmacologyService({
    loadText: async () => JSON.stringify(database),
    expectedRecordCount: 1,
  });
  await service.ensureLoaded();
  assert.equal(normalizePharmacologyText("  Aspirín  "), "aspirin");
  assert.equal(normalizeAtcCode("a01-aa-01"), "A01AA01");
  assert.equal(service.searchDrugs("aspirin")[0].id, "Aspirín");
});

test("pharmacology validator rejects duplicate IDs", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "medical-dictionary-pharma-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "pharmacology.json");
  writeFileSync(
    file,
    JSON.stringify({
      dataset: { record_count: 2 },
      drugs: [emptyRecord("same"), emptyRecord("same")],
    }),
    "utf8",
  );
  const result = validatePharmacologyFile(file, { expectedRecordCount: 2 });
  assert.ok(
    result.errors.some((error) => error.includes('duplicate id "same"')),
  );
});

test("simulation fixtures reject unknown case and expected intent IDs", () => {
  const base = {
    id: "fixture",
    caseId: PATIENT_CASES[0].id,
    question: "What is your name?",
    expectedPrimaryIntent: "identity_name",
  };
  assert.throws(
    () =>
      assertValidSimulationFixtures({
        tests: [{ ...base, caseId: "unknown-case" }],
        patientCases: PATIENT_CASES,
        intents: INTENTS,
      }),
    /unknown caseId "unknown-case"/,
  );
  const validation = validateSimulationFixtures({
    tests: [{ ...base, expectedPrimaryIntent: "unknown-intent" }],
    patientCases: PATIENT_CASES,
    intents: INTENTS,
  });
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) =>
      error.includes('unknown expected intent id "unknown-intent"'),
    ),
  );
});
