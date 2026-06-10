import { getEvidenceCategory, normalizeAtcCode } from "./pharmacology-service.js?v=2";

const PAGE_SIZE = 24;
const CLASS_DERIVED_WARNING = "Some information in this record is derived from the drug's ATC class and may not describe every substance-specific property. Verify current product information before clinical use.";
const DOSING_WARNING = "Representative educational dosing only. Verify the current product label and individual patient requirements.";

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const textOf = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(" ");
  if (typeof value === "object") return Object.values(value).map(textOf).filter(Boolean).join(" ");
  return "";
};

const listOf = (value) => Array.isArray(value)
  ? value.filter((item) => item !== null && item !== undefined && item !== "")
  : value === null || value === undefined || value === "" ? [] : [value];

const uniqueText = (values) => [...new Set(
  listOf(values).flatMap((value) => Array.isArray(value) ? value : [value]).map(textOf).filter(Boolean)
)];

const titleCase = (value) => String(value || "")
  .replace(/[_-]+/g, " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

function ensureStyles() {
  if (document.getElementById("pharmacology-module-styles")) return;
  const link = document.createElement("link");
  link.id = "pharmacology-module-styles";
  link.rel = "stylesheet";
  link.href = new URL("../../css/pharmacology.css?v=4", import.meta.url).href;
  document.head.appendChild(link);
}

function englishName(record) {
  return textOf(record?.names?.english?.source_value || record?.names?.english?.normalized || record?.id);
}

function slovakName(record) {
  return textOf(record?.names?.slovak?.verified_value || record?.names?.slovak?.source_value);
}

function mechanismSummary(record) {
  return textOf(record?.pharmacology?.summary) ||
    textOf(listOf(record?.pharmacology?.mechanisms_of_action)[0]?.description);
}

function indicationLabels(record, limit = Number.POSITIVE_INFINITY) {
  return uniqueText([
    listOf(record?.clinical_uses?.approved_indications).map((item) => item?.indication || item),
    listOf(record?.clinical_uses?.common_off_label_uses).map((item) => item?.indication || item)
  ]).slice(0, limit);
}

function evidenceBadge(record, compact = false) {
  const category = getEvidenceCategory(record);
  const classDerived = category === "class-derived";
  const label = classDerived ? "Class-derived" : "Substance-specific";
  const sublabel = classDerived ? "Educational summary" : "High confidence";
  const tooltip = classDerived
    ? "Some content is inferred from the ATC class and requires substance-specific verification."
    : "This record contains substance-specific source information.";
  return `<span class="pharm-evidence pharm-evidence-${classDerived ? "class" : "specific"}" title="${escapeHtml(tooltip)}">
    <span>${escapeHtml(label)}</span>${compact ? "" : `<small>${escapeHtml(sublabel)}</small>`}
  </span>`;
}

function renderInlineList(values, empty = "Not available") {
  const items = uniqueText(values);
  return items.length ? items.map(escapeHtml).join(" · ") : `<span class="pharm-unavailable">${escapeHtml(empty)}</span>`;
}

function renderBulletList(values, options = {}) {
  const items = listOf(values).map((item) => options.map ? options.map(item) : textOf(item)).filter(Boolean);
  if (!items.length) return "";
  return `<ul class="${escapeHtml(options.className || "pharm-detail-list")}">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderDetailSection(title, content, options = {}) {
  if (!content) return "";
  return `<section class="pharm-detail-section ${escapeHtml(options.className || "")}">
    <h3>${escapeHtml(title)}</h3>
    ${content}
  </section>`;
}

function renderKeyValues(rows) {
  const available = rows.filter(([, value]) => value !== null && value !== undefined && textOf(value));
  if (!available.length) return "";
  return `<dl class="pharm-key-values">${available.map(([label, value]) => `
    <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(textOf(value))}</dd></div>
  `).join("")}</dl>`;
}

function renderIndicationRows(rows) {
  const items = listOf(rows);
  if (!items.length) return "";
  return `<div class="pharm-stack">${items.map((item) => `
    <article class="pharm-subcard">
      <strong>${escapeHtml(textOf(item?.indication || item))}</strong>
      ${renderKeyValues([
        ["Population", item?.population],
        ["Jurisdiction", listOf(item?.jurisdictions).join(", ")],
        ["Approval", item?.approval_status],
        ["Notes", item?.notes]
      ])}
    </article>
  `).join("")}</div>`;
}

function formatDose(row) {
  const dose = row?.dose || {};
  const range = dose.minimum !== null && dose.minimum !== undefined
    ? `${dose.minimum}${dose.maximum !== null && dose.maximum !== undefined ? `-${dose.maximum}` : ""}`
    : dose.value;
  const amount = [range, dose.unit].filter((value) => value !== null && value !== undefined && String(value).trim()).join(" ");
  return [amount, row?.frequency].filter(Boolean).join(" ");
}

function renderDosing(record) {
  const administration = record?.administration || {};
  const dosing = listOf(administration.representative_dosing);
  const cards = dosing.map((row) => {
    const dose = formatDose(row);
    const meaningful = dose || row?.maximum_dose || row?.route || row?.formulation;
    if (!meaningful) return "";
    return `<article class="pharm-subcard">
      <strong>${escapeHtml(textOf(row?.indication) || "Representative dosing")}</strong>
      ${dose ? `<p class="pharm-dose">${escapeHtml(dose)}</p>` : ""}
      ${renderKeyValues([
        ["Population", row?.population],
        ["Route", row?.route],
        ["Maximum", row?.maximum_dose],
        ["Duration", row?.duration],
        ["Formulation", row?.formulation],
        ["Jurisdiction", row?.jurisdiction],
        ["Notes", row?.notes]
      ])}
    </article>`;
  }).filter(Boolean).join("");
  const adjustments = renderKeyValues([
    ["Renal adjustment", administration?.renal_adjustment?.summary],
    ["Hepatic adjustment", administration?.hepatic_adjustment?.summary],
    ["Pediatric considerations", administration?.pediatric_considerations],
    ["Geriatric considerations", administration?.geriatric_considerations]
  ]);
  const supporting = [
    renderBulletList(administration.administration_instructions),
    renderBulletList(administration.monitoring_requirements)
  ].filter(Boolean).join("");
  if (!cards && !adjustments && !supporting && !administration.routes?.length && !administration.dosage_forms?.length) return "";
  return `<div class="pharm-warning pharm-warning-dose">${escapeHtml(DOSING_WARNING)}</div>
    ${renderKeyValues([
      ["Routes", listOf(administration.routes).join(", ")],
      ["Dosage forms", listOf(administration.dosage_forms).join(", ")]
    ])}
    ${cards ? `<div class="pharm-stack">${cards}</div>` : ""}
    ${adjustments}
    ${supporting}`;
}

function renderMechanisms(record) {
  const mechanisms = listOf(record?.pharmacology?.mechanisms_of_action);
  const summary = mechanismSummary(record);
  if (!summary && !mechanisms.length) return "";
  return `${summary ? `<p class="pharm-lead">${escapeHtml(summary)}</p>` : ""}
    ${mechanisms.length ? `<div class="pharm-stack">${mechanisms.map((item) => `
      <article class="pharm-subcard">
        <p>${escapeHtml(textOf(item?.description))}</p>
        ${renderKeyValues([
          ["Target", item?.target],
          ["Target type", item?.target_type],
          ["Action", item?.action],
          ["Pathway", item?.pathway],
          ["Certainty", item?.certainty]
        ])}
      </article>
    `).join("")}</div>` : ""}`;
}

function renderInteractions(record) {
  const interactions = record?.interactions || {};
  const drugDrug = listOf(interactions.drug_drug);
  const drugDrugHtml = drugDrug.length ? `<div class="pharm-stack">${drugDrug.map((item) => `
    <article class="pharm-subcard">
      <div class="pharm-subcard-title">
        <strong>${escapeHtml(textOf(item?.interacting_agent_or_class) || "Interaction")}</strong>
        ${item?.severity ? `<span class="pharm-severity">${escapeHtml(titleCase(item.severity))}</span>` : ""}
      </div>
      ${renderKeyValues([
        ["Mechanism", item?.mechanism],
        ["Clinical effect", item?.clinical_effect],
        ["Management", item?.management]
      ])}
    </article>
  `).join("")}</div>` : "";
  const other = [
    ["Drug-food", interactions.drug_food],
    ["Drug-disease", interactions.drug_disease],
    ["Drug-laboratory", interactions.drug_laboratory],
    ["Pharmacogenomic", interactions.pharmacogenomic]
  ].map(([label, values]) => {
    const content = renderBulletList(values);
    return content ? `<h4>${escapeHtml(label)}</h4>${content}` : "";
  }).filter(Boolean).join("");
  return drugDrugHtml || other ? `${drugDrugHtml}${other}` : "";
}

function renderAdverseEffects(record) {
  const adverse = record?.adverse_effects || {};
  return [
    ["Common", adverse.common, ""],
    ["Serious", adverse.serious, "pharm-serious-list"],
    ["Rare", adverse.rare, ""],
    ["Dose-related", adverse.dose_related, ""],
    ["Class effects", adverse.class_effects, ""],
    ["Withdrawal or rebound", adverse.withdrawal_or_rebound, ""]
  ].map(([label, values, className]) => {
    const content = renderBulletList(values, { className });
    return content ? `<div class="pharm-detail-group"><h4>${escapeHtml(label)}</h4>${content}</div>` : "";
  }).filter(Boolean).join("");
}

function renderContraindications(record) {
  const safety = record?.contraindications_and_precautions || {};
  return [
    ["Absolute contraindications", safety.absolute_contraindications, "pharm-serious-list"],
    ["Relative contraindications", safety.relative_contraindications, ""],
    ["Warnings and precautions", safety.warnings_and_precautions, ""],
    ["Boxed warnings", safety.boxed_warnings, "pharm-serious-list"]
  ].map(([label, values, className]) => {
    const content = renderBulletList(values, { className });
    return content ? `<div class="pharm-detail-group"><h4>${escapeHtml(label)}</h4>${content}</div>` : "";
  }).filter(Boolean).join("") + renderKeyValues([
    ["Pregnancy", safety?.pregnancy?.summary],
    ["Pregnancy risk classification", safety?.pregnancy?.risk_classification],
    ["Lactation", safety?.lactation?.summary]
  ]);
}

function renderPharmacokinetics(record) {
  const pk = record?.pharmacokinetics || {};
  return renderKeyValues([
    ["Bioavailability", pk?.bioavailability?.value !== null && pk?.bioavailability?.value !== undefined
      ? `${pk.bioavailability.value}${pk.bioavailability.unit || "%"}`
      : pk?.bioavailability?.range],
    ["Time to peak", pk.time_to_peak],
    ["Onset", pk.onset],
    ["Duration", pk.duration],
    ["Half-life", pk?.half_life?.range || [pk?.half_life?.value, pk?.half_life?.unit].filter(Boolean).join(" ")],
    ["Half-life context", pk?.half_life?.context],
    ["Protein binding", pk.protein_binding_percent],
    ["Volume of distribution", pk.volume_of_distribution],
    ["Metabolism", pk?.metabolism?.summary],
    ["Enzymes", listOf(pk?.metabolism?.enzymes).join(", ")],
    ["Active metabolites", listOf(pk?.metabolism?.active_metabolites).join(", ")],
    ["Elimination", pk?.elimination?.summary],
    ["Dialyzability", pk.dialyzability],
    ["Notes", pk.pharmacokinetic_notes]
  ]);
}

function renderOverdose(record) {
  const overdose = record?.overdose_and_reversal || {};
  const groups = [
    ["Toxicity manifestations", overdose.toxicity_manifestations],
    ["Specific antidotes", listOf(overdose.specific_antidotes).map((item) => item?.name || item)],
    ["Reversal agents", listOf(overdose.reversal_agents).map((item) => item?.name || item)],
    ["Supportive management", overdose.supportive_management]
  ].map(([label, values]) => {
    const content = renderBulletList(values);
    return content ? `<div class="pharm-detail-group"><h4>${escapeHtml(label)}</h4>${content}</div>` : "";
  }).filter(Boolean).join("");
  return groups + renderKeyValues([
    ["Enhanced elimination", overdose.enhanced_elimination],
    ["Notes", overdose.notes]
  ]);
}

function renderSources(record) {
  const quality = record?.data_quality || {};
  const sources = listOf(record?.evidence?.sources);
  const sourceHtml = sources.length ? `<div class="pharm-source-list">${sources.map((source) => {
    const href = /^https?:\/\//i.test(String(source?.url || "")) ? String(source.url) : "";
    const label = textOf(source?.title || source?.publisher || source?.source_id || "Source");
    return `<article class="pharm-source">
      <strong>${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>` : escapeHtml(label)}</strong>
      ${renderKeyValues([
        ["Publisher", source?.publisher],
        ["Type", source?.source_type],
        ["Jurisdiction", source?.jurisdiction],
        ["Accessed", source?.accessed_at],
        ["Notes", source?.notes]
      ])}
    </article>`;
  }).join("")}</div>` : `<p class="pharm-unavailable">No evidence sources listed.</p>`;
  return `${renderKeyValues([
    ["Confidence", quality.confidence],
    ["Completion status", quality.overall_status],
    ["Completeness", quality.completeness_score !== null && quality.completeness_score !== undefined ? `${quality.completeness_score}%` : ""],
    ["Human review required", quality.requires_human_review === true ? "Yes" : "No"],
    ["Last verified", record?.evidence?.last_verified_at]
  ])}${sourceHtml}`;
}

function renderDrugDetail(record) {
  const classDerived = getEvidenceCategory(record) === "class-derived";
  const atcPath = ["level_1", "level_2", "level_3", "level_4", "level_5"]
    .map((key) => record?.atc?.primary_hierarchy?.[key])
    .filter((item) => item?.code || item?.name)
    .map((item) => [item.code, item.name].filter(Boolean).join(" - "));
  const synonyms = uniqueText([
    record?.names?.synonyms,
    record?.names?.international_nonproprietary_name,
    record?.names?.common_abbreviations
  ]);
  const clinical = record?.clinical_uses || {};
  const detailSections = [
    renderDetailSection("Overview", `
      ${renderKeyValues([
        ["English name", englishName(record)],
        ["Slovak name", slovakName(record)],
        ["Synonyms", synonyms.join(", ")],
        ["Record type", titleCase(record?.record_type)],
        ["Primary ATC code", record?.atc?.primary_code],
        ["ATC path", atcPath.join(" > ")],
        ["Therapeutic class", listOf(record?.pharmacology?.therapeutic_class).join(", ")],
        ["Confidence", record?.data_quality?.confidence]
      ])}
    `),
    renderDetailSection("Mechanism of action", renderMechanisms(record)),
    renderDetailSection("Clinical uses", [
      renderIndicationRows(clinical.approved_indications) ? `<h4>Approved indications</h4>${renderIndicationRows(clinical.approved_indications)}` : "",
      renderIndicationRows(clinical.common_off_label_uses) ? `<h4>Common off-label uses</h4>${renderIndicationRows(clinical.common_off_label_uses)}` : "",
      renderIndicationRows(clinical.not_recommended_uses) ? `<h4>Not recommended</h4>${renderIndicationRows(clinical.not_recommended_uses)}` : ""
    ].filter(Boolean).join("")),
    renderDetailSection("Administration and dosing", renderDosing(record)),
    renderDetailSection("Adverse effects", renderAdverseEffects(record)),
    renderDetailSection("Contraindications and precautions", renderContraindications(record)),
    renderDetailSection("Interactions", renderInteractions(record)),
    renderDetailSection("Pharmacokinetics", renderPharmacokinetics(record)),
    renderDetailSection("Overdose and reversal", renderOverdose(record)),
    renderDetailSection("Sources and data quality", renderSources(record))
  ].filter(Boolean).join("");

  return `<div class="pharm-dialog-head">
      <div>
        <p class="pharm-kicker">${escapeHtml(record?.atc?.primary_code || "Drug profile")}</p>
        <h2>${escapeHtml(titleCase(englishName(record)))}</h2>
        ${slovakName(record) ? `<p>${escapeHtml(slovakName(record))}</p>` : ""}
      </div>
      ${evidenceBadge(record)}
      <button type="button" class="pharm-icon-button" data-pharm-close-dialog aria-label="Close drug profile">×</button>
    </div>
    ${classDerived ? `<div class="pharm-warning pharm-warning-class">${escapeHtml(CLASS_DERIVED_WARNING)}</div>` : ""}
    <div class="pharm-detail-grid">${detailSections}</div>`;
}

function comparisonValue(record, key) {
  const pk = record?.pharmacokinetics || {};
  const safety = record?.contraindications_and_precautions || {};
  const firstTarget = listOf(record?.pharmacology?.mechanisms_of_action).map((item) => item?.target).filter(Boolean);
  const dosing = listOf(record?.administration?.representative_dosing).map(formatDose).filter(Boolean);
  const values = {
    atc: [record?.atc?.primary_code, listOf(record?.pharmacology?.therapeutic_class).join(", ")].filter(Boolean).join(" · "),
    mechanism: mechanismSummary(record),
    target: firstTarget.join(", "),
    indications: indicationLabels(record, 5).join(", "),
    common: listOf(record?.adverse_effects?.common).join(", "),
    serious: listOf(record?.adverse_effects?.serious).join(", "),
    contraindications: uniqueText([safety.absolute_contraindications, safety.relative_contraindications]).join(", "),
    interactions: listOf(record?.interactions?.drug_drug).map((item) => item?.interacting_agent_or_class || item).map(textOf).join(", "),
    dosing: dosing.join("; "),
    halfLife: pk?.half_life?.range || [pk?.half_life?.value, pk?.half_life?.unit].filter(Boolean).join(" "),
    metabolism: pk?.metabolism?.summary,
    elimination: pk?.elimination?.summary,
    evidence: getEvidenceCategory(record) === "class-derived"
      ? `Class-derived · ${textOf(record?.data_quality?.confidence) || "Not available"}`
      : `Substance-specific · ${textOf(record?.data_quality?.confidence) || "Not available"}`
  };
  return textOf(values[key]) || "Not available";
}

function renderComparison(records) {
  const rows = [
    ["ATC class", "atc"],
    ["Mechanism", "mechanism"],
    ["Molecular target", "target"],
    ["Main indications", "indications"],
    ["Common adverse effects", "common"],
    ["Serious adverse effects", "serious"],
    ["Contraindications", "contraindications"],
    ["Major interactions", "interactions"],
    ["Representative dosing", "dosing"],
    ["Half-life", "halfLife"],
    ["Metabolism", "metabolism"],
    ["Elimination", "elimination"],
    ["Evidence confidence", "evidence"]
  ];
  return `<div class="pharm-dialog-head">
      <div><p class="pharm-kicker">Comparison</p><h2>Compare drugs</h2></div>
      <button type="button" class="pharm-icon-button" data-pharm-close-dialog aria-label="Close comparison">×</button>
    </div>
    <div class="pharm-comparison-scroll">
      <table class="pharm-comparison-table">
        <thead><tr><th scope="col">Category</th>${records.map((record) => `<th scope="col">${escapeHtml(titleCase(englishName(record)))}</th>`).join("")}</tr></thead>
        <tbody>${rows.map(([label, key]) => `
          <tr><th scope="row">${escapeHtml(label)}</th>${records.map((record) => `<td data-label="${escapeHtml(englishName(record))}">${escapeHtml(comparisonValue(record, key))}</td>`).join("")}</tr>
        `).join("")}</tbody>
      </table>
    </div>`;
}

function findAtcNode(nodes, code, path = []) {
  for (const node of nodes || []) {
    const nextPath = [...path, node];
    if (node.code === code) return { node, path: nextPath };
    const found = findAtcNode(node.children, code, nextPath);
    if (found) return found;
  }
  return null;
}

function optionMarkup(values, current, placeholder, labeler = (value) => value) {
  return [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    ...listOf(values).map((value) => `<option value="${escapeHtml(value)}"${value === current ? " selected" : ""}>${escapeHtml(labeler(value))}</option>`)
  ].join("");
}

export function createPharmacologyUi({ service, screen, onNavigateToScreen } = {}) {
  if (!service || !screen) throw new TypeError("createPharmacologyUi requires a service and screen element.");
  ensureStyles();

  const state = {
    initialized: false,
    loading: false,
    query: "",
    mode: "drug",
    filters: {},
    compareIds: new Set(),
    visibleCount: PAGE_SIZE,
    atcCode: "",
    searchTimer: null,
    filterOpen: false
  };

  function renderShell() {
    const hidden = screen.classList.contains("hidden");
    screen.className = `screen pharmacology-module-screen${hidden ? " hidden" : ""}`;
    screen.innerHTML = `
      <div class="pharm-page" id="pharmacology-app">
        <section class="pharm-summary" aria-label="Database summary" id="pharm-summary"></section>

        <section class="pharm-search-panel" aria-label="Pharmacology search">
          <div class="pharm-mode-tabs" role="tablist" aria-label="Search mode">
            <button type="button" role="tab" data-pharm-mode="drug">Drug search</button>
            <button type="button" role="tab" data-pharm-mode="clinical">Clinical search</button>
            <button type="button" role="tab" data-pharm-mode="atc">ATC browser</button>
          </div>
          <div class="pharm-search-row">
            <label class="pharm-search-box" for="pharm-search-input">
              <span aria-hidden="true">⌕</span>
              <input id="pharm-search-input" type="search" autocomplete="off" placeholder="Search a drug, ATC code, mechanism, indication or adverse effect..." />
              <button type="button" class="pharm-clear-search" data-pharm-clear-search aria-label="Clear search">×</button>
            </label>
            <button type="button" class="pharm-filter-button" data-pharm-filter-toggle aria-expanded="false">Filters</button>
          </div>
          <div class="pharm-quick-search" aria-label="Quick searches">
            ${["Beta blockers", "ACE inhibitors", "Antibiotics", "Anticoagulants", "SSRIs", "NSAIDs", "Insulins", "Proton pump inhibitors"]
              .map((label) => `<button type="button" data-pharm-quick="${escapeHtml(label)}">${escapeHtml(label)}</button>`).join("")}
          </div>
        </section>

        <div class="pharm-layout">
          <aside class="pharm-filters" id="pharm-filters" aria-label="Pharmacology filters">
            <div class="pharm-filter-head">
              <div><p class="pharm-kicker">Narrow results</p><h2>Filters</h2></div>
              <button type="button" class="pharm-icon-button pharm-filter-close" data-pharm-filter-toggle aria-label="Close filters">×</button>
            </div>
            <label>ATC system group<select data-pharm-filter="atcLevel1"></select></label>
            <label>ATC therapeutic group<select data-pharm-filter="atcLevel2"></select></label>
            <label>Therapeutic class<select data-pharm-filter="therapeuticClass"></select></label>
            <label>Record type<select data-pharm-filter="recordType"></select></label>
            <label>Evidence<select data-pharm-filter="evidenceCategory"></select></label>
            <label>Confidence<select data-pharm-filter="confidence"></select></label>
            <label>Route<select data-pharm-filter="route"></select></label>
            <label class="pharm-check"><input type="checkbox" data-pharm-filter="hasDosing" /> Has representative dosing</label>
            <label class="pharm-check"><input type="checkbox" data-pharm-filter="hasPharmacokinetics" /> Has pharmacokinetic data</label>
            <label>Human review<select data-pharm-filter="requiresHumanReview">
              <option value="">Any review status</option>
              <option value="false">Review not required</option>
              <option value="true">Review required</option>
            </select></label>
            <button type="button" class="secondary pharm-reset-filters" data-pharm-reset-filters>Clear filters</button>
          </aside>

          <main class="pharm-results-area">
            <div id="pharm-atc-browser"></div>
            <div class="pharm-results-head">
              <div><p class="pharm-kicker">Results</p><h2 id="pharm-results-title">Search the database</h2></div>
              <button type="button" class="primary pharm-compare-button" data-pharm-open-compare disabled>Compare <span id="pharm-compare-count">0</span></button>
            </div>
            <div id="pharm-status" class="pharm-status" role="status" aria-live="polite"></div>
            <div id="pharm-results" class="pharm-results-grid"></div>
            <button type="button" class="secondary pharm-load-more hidden" data-pharm-load-more>Load more</button>
          </main>
        </div>
        <div class="pharm-filter-scrim" data-pharm-filter-toggle></div>
        <dialog class="pharm-dialog" id="pharm-detail-dialog"><div class="pharm-dialog-body" id="pharm-detail-content"></div></dialog>
        <dialog class="pharm-dialog pharm-compare-dialog" id="pharm-compare-dialog"><div class="pharm-dialog-body" id="pharm-compare-content"></div></dialog>
      </div>`;
  }

  function renderSummary() {
    const summary = service.getDatasetSummary();
    screen.querySelector("#pharm-summary").innerHTML = `
      <div><strong>${summary.recordCount.toLocaleString()}</strong><span>drugs</span></div>
      <div><strong>${summary.substanceSpecificCount.toLocaleString()}</strong><span>substance-specific records</span></div>
      <div><strong>${summary.classDerivedCount.toLocaleString()}</strong><span>class-derived educational records</span></div>
      <div><strong>ATC</strong><span>based classification</span></div>`;
  }

  function labelAtcCode(code) {
    const found = findAtcNode(service.getAtcTree(), code);
    return found ? `${code} - ${found.node.name}` : code;
  }

  function populateFilters() {
    const facets = service.getFacets();
    const setOptions = (key, values, placeholder, labeler) => {
      const select = screen.querySelector(`[data-pharm-filter="${key}"]`);
      if (select) select.innerHTML = optionMarkup(values, state.filters[key] || "", placeholder, labeler);
    };
    setOptions("atcLevel1", facets.atcLevel1, "All ATC system groups", labelAtcCode);
    const level2 = facets.atcLevel2.filter((code) => !state.filters.atcLevel1 || code.startsWith(state.filters.atcLevel1));
    setOptions("atcLevel2", level2, "All ATC therapeutic groups", labelAtcCode);
    setOptions("therapeuticClass", facets.therapeuticClasses, "All therapeutic classes");
    setOptions("recordType", facets.recordTypes, "All record types", titleCase);
    setOptions("evidenceCategory", facets.evidenceCategories, "All evidence categories", (value) =>
      value === "class-derived" ? "Class-derived" : "Substance-specific");
    setOptions("confidence", facets.confidence, "All confidence levels", titleCase);
    setOptions("route", facets.routes, "All routes", titleCase);
  }

  function hasFilters() {
    return Object.values(state.filters).some((value) => value !== "" && value !== null && value !== undefined && value !== false);
  }

  function currentResults() {
    if (state.mode === "atc") {
      if (!state.atcCode) return [];
      return service.searchDrugs(state.query, { ...state.filters, atcPrefix: state.atcCode }, { mode: "drug" });
    }
    if (!state.query && !hasFilters()) return [];
    return service.searchDrugs(state.query, state.filters, { mode: state.mode });
  }

  function renderAtcBrowser() {
    const host = screen.querySelector("#pharm-atc-browser");
    if (state.mode !== "atc") {
      host.innerHTML = "";
      host.classList.add("hidden");
      return;
    }
    host.classList.remove("hidden");
    const found = state.atcCode ? findAtcNode(service.getAtcTree(), state.atcCode) : null;
    const path = found?.path || [];
    const nodes = found ? found.node.children : service.getAtcTree();
    host.innerHTML = `<section class="pharm-atc-browser">
      <div class="pharm-atc-head">
        <div><p class="pharm-kicker">Browse hierarchy</p><h2>${found ? escapeHtml(`${found.node.code} - ${found.node.name}`) : "ATC level 1"}</h2></div>
        ${state.atcCode ? `<button type="button" class="secondary" data-pharm-atc-reset>Start over</button>` : ""}
      </div>
      <nav class="pharm-atc-breadcrumb" aria-label="ATC hierarchy">
        <button type="button" data-pharm-atc-code="">ATC</button>
        ${path.map((node) => `<span>/</span><button type="button" data-pharm-atc-code="${escapeHtml(node.code)}">${escapeHtml(node.code)}</button>`).join("")}
      </nav>
      <div class="pharm-atc-grid">
        ${nodes.length ? nodes.map((node) => `<button type="button" class="pharm-atc-card" data-pharm-atc-code="${escapeHtml(node.code)}">
          <strong>${escapeHtml(node.code)}</strong><span>${escapeHtml(node.name)}</span><small>${node.count} records</small>
        </button>`).join("") : `<p class="pharm-atc-leaf">This is the deepest category in the available hierarchy.</p>`}
      </div>
    </section>`;
  }

  function renderResultCard(result) {
    const record = result.record;
    const id = record.id;
    const selected = state.compareIds.has(id);
    const common = listOf(record?.adverse_effects?.common).slice(0, 3);
    const indications = indicationLabels(record, 3);
    const therapeuticClass = listOf(record?.pharmacology?.therapeutic_class)[0];
    return `<article class="pharm-result-card">
      <div class="pharm-card-top">
        <div>
          <p class="pharm-atc-label">${escapeHtml(record?.atc?.primary_code || "ATC not available")}</p>
          <h3>${escapeHtml(titleCase(englishName(record)))}</h3>
          ${slovakName(record) ? `<p class="pharm-slovak">${escapeHtml(slovakName(record))}</p>` : ""}
        </div>
        ${evidenceBadge(record, true)}
      </div>
      ${therapeuticClass ? `<p class="pharm-class">${escapeHtml(textOf(therapeuticClass))}</p>` : ""}
      <div class="pharm-card-section"><strong>Mechanism</strong><p>${escapeHtml(mechanismSummary(record) || "Not available")}</p></div>
      <div class="pharm-card-section"><strong>Main uses</strong><p>${renderInlineList(indications)}</p></div>
      <div class="pharm-card-section"><strong>Common adverse effects</strong><p>${renderInlineList(common)}</p></div>
      ${result.matchedFields?.length ? `<p class="pharm-match">Matched: ${escapeHtml(result.matchedFields.slice(0, 2).join(", "))}</p>` : ""}
      <div class="pharm-card-actions">
        <button type="button" class="primary" data-pharm-open="${escapeHtml(id)}">Open profile</button>
        <label class="pharm-compare-check">
          <input type="checkbox" data-pharm-compare="${escapeHtml(id)}"${selected ? " checked" : ""}${!selected && state.compareIds.size >= 3 ? " disabled" : ""} />
          Compare
        </label>
      </div>
    </article>`;
  }

  function renderResults() {
    const results = currentResults();
    const visible = results.slice(0, state.visibleCount);
    const status = screen.querySelector("#pharm-status");
    const grid = screen.querySelector("#pharm-results");
    const title = screen.querySelector("#pharm-results-title");
    const loadMore = screen.querySelector("[data-pharm-load-more]");
    const clearSearch = screen.querySelector("[data-pharm-clear-search]");

    clearSearch.classList.toggle("hidden", !state.query);
    title.textContent = results.length ? `${results.length.toLocaleString()} matching records` : "Search the database";
    if (!state.query && !hasFilters() && state.mode !== "atc") {
      status.innerHTML = `<div class="pharm-empty">
        <strong>Search for a drug, mechanism, indication, adverse effect or ATC code.</strong>
        <p>Use the quick searches above or switch to the ATC browser.</p>
      </div>`;
      grid.innerHTML = "";
    } else if (state.mode === "atc" && !state.atcCode) {
      status.innerHTML = `<div class="pharm-empty"><strong>Select an ATC category to browse its drug records.</strong></div>`;
      grid.innerHTML = "";
    } else if (!results.length) {
      status.innerHTML = `<div class="pharm-empty">
        <strong>No matching pharmacology records were found.</strong>
        <p>Check the spelling or clear active filters.</p>
        ${hasFilters() ? `<button type="button" class="secondary" data-pharm-reset-filters>Clear filters</button>` : ""}
      </div>`;
      grid.innerHTML = "";
    } else {
      status.textContent = `Showing ${visible.length} of ${results.length} records.`;
      grid.innerHTML = visible.map(renderResultCard).join("");
    }
    loadMore.classList.toggle("hidden", visible.length >= results.length);
    updateCompareButton();
  }

  function updateCompareButton() {
    const button = screen.querySelector("[data-pharm-open-compare]");
    const count = screen.querySelector("#pharm-compare-count");
    const size = state.compareIds.size;
    if (count) count.textContent = String(size);
    if (button) button.disabled = size < 2;
  }

  function renderModes() {
    screen.querySelectorAll("[data-pharm-mode]").forEach((button) => {
      const active = button.dataset.pharmMode === state.mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    const input = screen.querySelector("#pharm-search-input");
    input.placeholder = state.mode === "clinical"
      ? "Search a mechanism, indication, adverse effect, interaction or metabolism..."
      : state.mode === "atc"
        ? "Optionally search within the selected ATC category..."
        : "Search a drug, synonym, abbreviation or ATC code...";
  }

  function renderAll() {
    renderModes();
    populateFilters();
    renderAtcBrowser();
    renderResults();
  }

  function setFilterPanel(open) {
    state.filterOpen = !!open;
    screen.querySelector("#pharm-filters")?.classList.toggle("is-open", state.filterOpen);
    screen.querySelector(".pharm-filter-scrim")?.classList.toggle("is-open", state.filterOpen);
    screen.querySelector("[data-pharm-filter-toggle]")?.setAttribute("aria-expanded", state.filterOpen ? "true" : "false");
    document.body.classList.toggle("pharm-filters-open", state.filterOpen);
  }

  function resetFilters() {
    state.filters = {};
    state.visibleCount = PAGE_SIZE;
    screen.querySelectorAll("[data-pharm-filter]").forEach((control) => {
      if (control instanceof HTMLInputElement && control.type === "checkbox") control.checked = false;
      else control.value = "";
    });
    populateFilters();
    renderResults();
    syncUrl({ replace: true });
  }

  function syncUrl({ replace = true, detailId = "", comparison = false } = {}) {
    const url = new URL(window.location.href);
    ["query", "mode", "drug", "compare"].forEach((key) => url.searchParams.delete(key));
    if (state.query) url.searchParams.set("query", state.query);
    if (state.mode !== "drug") url.searchParams.set("mode", state.mode);
    if (detailId) url.searchParams.set("drug", detailId);
    if (comparison && state.compareIds.size) url.searchParams.set("compare", [...state.compareIds].join(","));
    history[replace ? "replaceState" : "pushState"](null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function applyUrlState() {
    const params = new URLSearchParams(window.location.search);
    state.query = params.get("query") || "";
    state.mode = ["drug", "clinical", "atc"].includes(params.get("mode")) ? params.get("mode") : "drug";
    const compare = (params.get("compare") || "").split(",").filter((id) => service.getDrugById(id)).slice(0, 3);
    state.compareIds = new Set(compare);
    const input = screen.querySelector("#pharm-search-input");
    if (input) input.value = state.query;
    const drugId = params.get("drug");
    window.setTimeout(() => {
      if (drugId && service.getDrugById(drugId)) openDetail(drugId, { updateUrl: false });
      else closeDialog(screen.querySelector("#pharm-detail-dialog"), { updateUrl: false });
      if (compare.length >= 2) openComparison({ updateUrl: false });
      else closeDialog(screen.querySelector("#pharm-compare-dialog"), { updateUrl: false });
    }, 0);
  }

  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }

  function closeDialog(dialog, { updateUrl = true } = {}) {
    if (!dialog) return;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
    if (updateUrl) syncUrl({ replace: false });
  }

  function openDetail(id, { updateUrl = true } = {}) {
    const record = service.getDrugById(id);
    if (!record) return;
    screen.querySelector("#pharm-detail-content").innerHTML = renderDrugDetail(record);
    openDialog(screen.querySelector("#pharm-detail-dialog"));
    if (updateUrl) syncUrl({ replace: false, detailId: id });
  }

  function openComparison({ updateUrl = true } = {}) {
    const records = [...state.compareIds].map((id) => service.getDrugById(id)).filter(Boolean);
    if (records.length < 2) return;
    screen.querySelector("#pharm-compare-content").innerHTML = renderComparison(records);
    openDialog(screen.querySelector("#pharm-compare-dialog"));
    if (updateUrl) syncUrl({ replace: false, comparison: true });
  }

  function setMode(mode) {
    if (!["drug", "clinical", "atc"].includes(mode)) return;
    state.mode = mode;
    state.visibleCount = PAGE_SIZE;
    renderAll();
    syncUrl({ replace: false });
  }

  function selectAtc(code) {
    state.atcCode = normalizeAtcCode(code);
    state.visibleCount = PAGE_SIZE;
    renderAtcBrowser();
    renderResults();
  }

  function bindEvents() {
    screen.addEventListener("input", (event) => {
      const target = event.target;
      if (target?.id === "pharm-search-input") {
        state.query = target.value;
        state.visibleCount = PAGE_SIZE;
        clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(() => {
          renderResults();
          syncUrl({ replace: true });
        }, 200);
        return;
      }
      const filter = target?.dataset?.pharmFilter;
      if (!filter) return;
      if (target instanceof HTMLInputElement && target.type === "checkbox") state.filters[filter] = target.checked;
      else if (filter === "requiresHumanReview") state.filters[filter] = target.value === "" ? "" : target.value === "true";
      else state.filters[filter] = target.value;
      if (filter === "atcLevel1" && state.filters.atcLevel2 && !state.filters.atcLevel2.startsWith(target.value)) {
        state.filters.atcLevel2 = "";
      }
      state.visibleCount = PAGE_SIZE;
      populateFilters();
      renderResults();
      syncUrl({ replace: true });
    });

    screen.addEventListener("change", (event) => {
      const id = event.target?.dataset?.pharmCompare;
      if (!id) return;
      if (event.target.checked) {
        if (state.compareIds.size >= 3) {
          event.target.checked = false;
          return;
        }
        state.compareIds.add(id);
      } else {
        state.compareIds.delete(id);
      }
      renderResults();
    });

    screen.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("button,[data-pharm-filter-toggle]") : null;
      if (!target) return;
      if (target.matches("[data-pharm-mode]")) setMode(target.dataset.pharmMode);
      else if (target.matches("[data-pharm-quick]")) {
        state.query = target.dataset.pharmQuick || "";
        state.mode = "clinical";
        state.visibleCount = PAGE_SIZE;
        screen.querySelector("#pharm-search-input").value = state.query;
        renderAll();
        syncUrl({ replace: false });
      } else if (target.matches("[data-pharm-clear-search]")) {
        state.query = "";
        screen.querySelector("#pharm-search-input").value = "";
        renderResults();
        syncUrl({ replace: true });
        screen.querySelector("#pharm-search-input").focus();
      } else if (target.matches("[data-pharm-filter-toggle]")) {
        setFilterPanel(!state.filterOpen);
      } else if (target.matches("[data-pharm-reset-filters]")) resetFilters();
      else if (target.matches("[data-pharm-load-more]")) {
        state.visibleCount += PAGE_SIZE;
        renderResults();
      } else if (target.matches("[data-pharm-open]")) openDetail(target.dataset.pharmOpen);
      else if (target.matches("[data-pharm-open-compare]")) openComparison();
      else if (target.matches("[data-pharm-close-dialog]")) closeDialog(target.closest("dialog"));
      else if (target.matches("[data-pharm-atc-code]")) selectAtc(target.dataset.pharmAtcCode);
      else if (target.matches("[data-pharm-atc-reset]")) selectAtc("");
    });

    screen.querySelectorAll("dialog").forEach((dialog) => {
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) closeDialog(dialog);
      });
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        closeDialog(dialog);
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.filterOpen) setFilterPanel(false);
    });
  }

  async function open() {
    if (typeof onNavigateToScreen === "function") onNavigateToScreen();
    if (!state.initialized) {
      renderShell();
      bindEvents();
      state.initialized = true;
    }
    const status = screen.querySelector("#pharm-status");
    state.loading = true;
    status.innerHTML = `<div class="pharm-loading"><span></span>Loading the pharmacology database...</div>`;
    try {
      await service.ensureLoaded();
      renderSummary();
      populateFilters();
      applyUrlState();
      renderAll();
    } catch (error) {
      console.error("The pharmacology database could not be loaded.", error);
      status.innerHTML = `<div class="pharm-empty pharm-error"><strong>The pharmacology database could not be loaded.</strong><p>Reload the page to try again.</p></div>`;
    } finally {
      state.loading = false;
    }
  }

  return {
    open,
    refreshFromUrl() {
      if (!state.initialized || !service.state.loaded) return open();
      applyUrlState();
      renderAll();
      return Promise.resolve();
    },
    getState() {
      return state;
    }
  };
}
