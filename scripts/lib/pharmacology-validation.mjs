import { readFileSync } from "node:fs";

const MAJOR_OBJECT_FIELDS = [
  "names",
  "atc",
  "pharmacology",
  "clinical_uses",
  "administration",
  "contraindications_and_precautions",
  "adverse_effects",
  "interactions",
  "pharmacokinetics",
  "data_quality",
];

const ARRAY_FIELDS = [
  "names.synonyms",
  "atc.source_additional_codes",
  "atc.combined_atc_codes",
  "atc.classifications",
  "pharmacology.therapeutic_class",
  "pharmacology.chemical_class",
  "pharmacology.mechanisms_of_action",
  "clinical_uses.approved_indications",
  "clinical_uses.common_off_label_uses",
  "administration.routes",
  "administration.dosage_forms",
  "administration.representative_dosing",
  "adverse_effects.common",
  "adverse_effects.serious",
  "interactions.drug_drug",
  "interactions.drug_food",
  "interactions.drug_disease",
  "interactions.drug_laboratory",
  "interactions.pharmacogenomic",
  "data_quality.missing_fields",
  "data_quality.conflicts",
  "data_quality.inferences",
];

function getPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validAtcCode(value) {
  return /^[A-Z]\d{2}[A-Z]{2}\d{2}$/.test(
    String(value || "")
      .trim()
      .toUpperCase(),
  );
}

export function configuredPharmacologyRecordCount(serviceSource) {
  const match = String(serviceSource || "").match(
    /expectedRecordCount\s*=\s*(\d+)/,
  );
  return match ? Number(match[1]) : null;
}

export function validatePharmacologyFile(
  filePath,
  { expectedRecordCount = null } = {},
) {
  const errors = [];
  const warnings = [];
  let payload;

  try {
    payload = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    return {
      filePath,
      recordCount: 0,
      expectedRecordCount,
      expectedCountMatches: false,
      humanReviewCount: 0,
      errors: [`invalid JSON: ${error.message}`],
      warnings,
    };
  }

  if (!Array.isArray(payload?.drugs)) {
    errors.push("top-level drugs must be an array");
  }
  const drugs = Array.isArray(payload?.drugs) ? payload.drugs : [];
  if (drugs.length === 0)
    errors.push("drugs array must contain at least one record");
  if (!isObject(payload?.dataset))
    errors.push("top-level dataset metadata must be an object");

  const ids = new Map();
  let humanReviewCount = 0;
  for (const [index, record] of drugs.entries()) {
    const label = `record ${index + 1}`;
    const id = String(record?.id || "").trim();
    if (!id) errors.push(`${label}: id must be non-empty`);
    else if (ids.has(id))
      errors.push(
        `${label}: duplicate id "${id}" (first at record ${ids.get(id)})`,
      );
    else ids.set(id, index + 1);

    if (!isObject(record)) {
      errors.push(`${label}: record must be an object`);
      continue;
    }
    for (const field of MAJOR_OBJECT_FIELDS) {
      if (!isObject(record[field]))
        errors.push(`${label} (${id || "no id"}): ${field} must be an object`);
    }
    for (const field of ARRAY_FIELDS) {
      if (!Array.isArray(getPath(record, field))) {
        errors.push(`${label} (${id || "no id"}): ${field} must be an array`);
      }
    }

    const primaryAtc = record?.atc?.primary_code;
    if (primaryAtc && !validAtcCode(primaryAtc)) {
      errors.push(
        `${label} (${id || "no id"}): malformed primary ATC code "${primaryAtc}"`,
      );
    }
    const otherAtcCodes = [
      ...(record?.atc?.source_additional_codes || []),
      ...(record?.atc?.combined_atc_codes || []),
      ...(record?.atc?.classifications || []).map((item) => item?.atc_code),
    ].filter(Boolean);
    for (const code of otherAtcCodes) {
      if (!validAtcCode(code)) {
        errors.push(
          `${label} (${id || "no id"}): malformed ATC code "${code}"`,
        );
      }
    }

    if (typeof record?.data_quality?.requires_human_review !== "boolean") {
      errors.push(
        `${label} (${id || "no id"}): data_quality.requires_human_review must be boolean`,
      );
    } else if (record.data_quality.requires_human_review) {
      humanReviewCount += 1;
    }
    if (!String(record?.data_quality?.overall_status || "").trim()) {
      errors.push(
        `${label} (${id || "no id"}): data_quality.overall_status is required`,
      );
    }
  }

  const declaredCount = Number(payload?.dataset?.record_count);
  if (Number.isFinite(declaredCount) && declaredCount !== drugs.length) {
    errors.push(
      `dataset.record_count is ${declaredCount}, but the drugs array contains ${drugs.length} records`,
    );
  }
  if (expectedRecordCount !== null && drugs.length !== expectedRecordCount) {
    warnings.push(
      `service expects ${expectedRecordCount} records, but the dataset contains ${drugs.length}`,
    );
  }

  return {
    filePath,
    schemaVersion: payload?.schema_version || null,
    recordCount: drugs.length,
    expectedRecordCount,
    expectedCountMatches:
      expectedRecordCount === null
        ? null
        : drugs.length === expectedRecordCount,
    humanReviewCount,
    errors,
    warnings,
  };
}
