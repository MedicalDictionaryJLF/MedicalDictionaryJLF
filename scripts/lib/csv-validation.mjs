import { readFileSync } from "node:fs";
import { basename } from "node:path";

const IDENTITY_FIELDS_BY_FILE = {
  "app_translations.csv": ["key"],
  "anamnesis_internal.csv": ["id_anamnesis"],
  "anamnesis_pediatrics.csv": ["id_anamnesis"],
  "anamnesis_psychiatry.csv": ["field_id", "section_id"],
  "latin_abbreviations.csv": ["abbreviation"],
  "latin_greek.csv": ["english_translation", "latin_translation"],
  "latin_remedies.csv": ["name"],
  "latin_units.csv": ["unit_number", "latin_term"],
  "muscles.csv": ["latin_muscle_name", "english_muscle_name"],
  "course_backbone_overview.csv": ["course", "unit"],
  "lesson1_declension_I_paradigms.csv": ["example_word", "number", "case"],
  "lesson1_noun_plus_adjective_paradigm.csv": [
    "dictionary_form_noun",
    "dictionary_form_adjective",
    "number",
    "case",
  ],
  "lesson1_noun_plus_noun_paradigm.csv": [
    "dictionary_form_1",
    "dictionary_form_2",
    "number_of_head",
    "case",
  ],
  "lesson1_preposition_paradigm.csv": [
    "preposition",
    "dictionary_form_noun",
    "number",
  ],
  "lesson1_pronunciation_backbone.csv": ["topic", "pattern"],
  "lesson1_theory_backbone.csv": ["section_order", "section_title"],
};

const TRANSLATION_HEADER_PATTERN =
  /(?:^|_)(?:english|german|deutsch|slovak|slovensky|latin|greek|en|de|sk)(?:_|$)/i;
const DATASET_STATUSES = new Set(["active", "planned"]);
const MOJIBAKE_PATTERN = /(?:Ã.|Â.|â(?:€|€™|€œ|€�|€“|€”|€¦)|ðŸ)/g;

function countDelimiter(line, delimiter) {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    else if (!quoted && line[index] === delimiter) count += 1;
  }
  return count;
}

export function detectDelimiter(text) {
  const firstLine =
    String(text || "")
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .find((line) => line.trim()) || "";
  return countDelimiter(firstLine, ";") > countDelimiter(firstLine, ",")
    ? ";"
    : ",";
}

export function parseCsvStrict(
  text,
  { delimiter = detectDelimiter(text) } = {},
) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  const errors = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let justClosedQuote = false;
  let line = 1;
  let rowLine = 1;

  const pushRow = () => {
    row.push(field);
    rows.push({ line: rowLine, values: row });
    row = [];
    field = "";
    justClosedQuote = false;
    rowLine = line + 1;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (inQuotes) {
      if (character === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
        justClosedQuote = true;
      } else {
        field += character;
        if (character === "\n") line += 1;
      }
      continue;
    }

    if (justClosedQuote && ![delimiter, "\r", "\n"].includes(character)) {
      errors.push(`line ${line}: unexpected character after a closing quote`);
      justClosedQuote = false;
    }

    if (character === '"') {
      if (field.length > 0)
        errors.push(`line ${line}: unexpected quote in an unquoted field`);
      inQuotes = true;
    } else if (character === delimiter) {
      row.push(field);
      field = "";
      justClosedQuote = false;
    } else if (character === "\n") {
      pushRow();
      line += 1;
    } else if (character !== "\r") {
      field += character;
      justClosedQuote = false;
    }
  }

  if (inQuotes) errors.push(`line ${line}: unterminated quoted field`);
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push({ line: rowLine, values: row });
  }

  return { delimiter, rows, errors };
}

function identityFieldsFor(filePath, headers) {
  const configured = IDENTITY_FIELDS_BY_FILE[basename(filePath)];
  if (configured) return configured.filter((field) => headers.includes(field));
  const conventional = [
    "id",
    "key",
    "field_id",
    "section_id",
    "name",
    "english_term",
  ];
  const found = conventional.filter((field) => headers.includes(field));
  return found.length ? found : headers.slice(0, 1);
}

export function validateCsvFile(filePath, { status = "active" } = {}) {
  const errors = [];
  const warnings = [];
  if (!DATASET_STATUSES.has(status)) {
    errors.push(`unsupported dataset status: ${String(status)}`);
  }
  let text;

  try {
    const buffer = readFileSync(filePath);
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    return {
      filePath,
      status,
      rows: 0,
      usableRows: 0,
      errors: [
        ...errors,
        `file cannot be read as valid UTF-8: ${error.message}`,
      ],
      warnings,
      missingTranslations: {},
    };
  }

  const parsed = parseCsvStrict(text);
  errors.push(...parsed.errors);
  if (parsed.rows.length === 0) {
    errors.push("file contains no header row");
    return {
      filePath,
      status,
      rows: 0,
      usableRows: 0,
      errors,
      warnings,
      missingTranslations: {},
    };
  }

  const headers = parsed.rows[0].values.map((header) => header.trim());
  const nonEmptyHeaders = headers.filter(Boolean);
  if (headers.some((header) => !header))
    errors.push("headers must be non-empty");
  const duplicateHeaders = [
    ...new Set(
      nonEmptyHeaders.filter(
        (header, index) => nonEmptyHeaders.indexOf(header) !== index,
      ),
    ),
  ];
  if (duplicateHeaders.length)
    errors.push(`duplicate headers: ${duplicateHeaders.join(", ")}`);

  const dataRows = parsed.rows.slice(1);
  const identityFields = identityFieldsFor(filePath, headers);
  if (identityFields.length === 0)
    errors.push("no usable identity field is present in the header");
  const translationIndexes = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => TRANSLATION_HEADER_PATTERN.test(header));
  const missingTranslations = Object.fromEntries(
    translationIndexes.map(({ header }) => [header, 0]),
  );
  const recordKeys = new Map();
  let usableRows = 0;
  const emptyRowLines = [];
  const shortRowLines = [];
  const longEmptyRowLines = [];

  for (const record of dataRows) {
    let values = record.values;
    if (values.every((value) => !String(value).trim())) {
      emptyRowLines.push(record.line);
      continue;
    }
    if (values.length < headers.length) {
      shortRowLines.push(record.line);
      values = [...values, ...Array(headers.length - values.length).fill("")];
    } else if (
      values.length > headers.length &&
      values.slice(headers.length).every((value) => !String(value).trim())
    ) {
      longEmptyRowLines.push(record.line);
      values = values.slice(0, headers.length);
    } else if (values.length > headers.length) {
      errors.push(
        `line ${record.line}: expected ${headers.length} columns, received ${values.length}`,
      );
      continue;
    }

    const rowObject = Object.fromEntries(
      headers.map((header, index) => [header, values[index].trim()]),
    );
    if (!identityFields.some((field) => rowObject[field])) {
      errors.push(
        `line ${record.line}: missing required identity value (${identityFields.join(" or ")})`,
      );
      continue;
    }

    const recordKey = JSON.stringify(values);
    if (recordKeys.has(recordKey)) {
      warnings.push(
        `line ${record.line}: exact duplicate of line ${recordKeys.get(recordKey)}`,
      );
    } else {
      recordKeys.set(recordKey, record.line);
    }
    for (const { header, index } of translationIndexes) {
      if (!String(values[index] || "").trim()) missingTranslations[header] += 1;
    }
    usableRows += 1;
  }

  if (emptyRowLines.length) {
    warnings.push(
      `${emptyRowLines.length} completely empty row(s) at lines ${emptyRowLines.slice(0, 10).join(", ")}${emptyRowLines.length > 10 ? ", ..." : ""}`,
    );
  }
  if (shortRowLines.length) {
    warnings.push(
      `${shortRowLines.length} row(s) omitted trailing columns and were padded at lines ${shortRowLines.slice(0, 10).join(", ")}${shortRowLines.length > 10 ? ", ..." : ""}`,
    );
  }
  if (longEmptyRowLines.length) {
    warnings.push(
      `${longEmptyRowLines.length} row(s) had extra empty trailing columns at lines ${longEmptyRowLines.slice(0, 10).join(", ")}${longEmptyRowLines.length > 10 ? ", ..." : ""}`,
    );
  }

  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  const mojibakeCount = (text.match(MOJIBAKE_PATTERN) || []).length;
  if (replacementCount)
    warnings.push(`${replacementCount} Unicode replacement character(s) found`);
  if (mojibakeCount)
    warnings.push(`${mojibakeCount} likely mojibake marker(s) found`);
  for (const [header, count] of Object.entries(missingTranslations)) {
    if (count) warnings.push(`${header}: ${count} missing value(s)`);
  }
  if (usableRows === 0) {
    if (status === "planned") {
      warnings.push("planned dataset contains no usable records");
    } else {
      errors.push("file contains no usable records");
    }
  }

  return {
    filePath,
    status,
    delimiter: parsed.delimiter,
    headers,
    rows: dataRows.length,
    usableRows,
    errors,
    warnings,
    missingTranslations,
  };
}
