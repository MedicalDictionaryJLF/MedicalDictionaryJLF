import { createPharmacologyService, getEvidenceCategory } from "../assets/js/pharmacology/pharmacology-service.js";
import { createPharmacologyUi } from "../assets/js/pharmacology/pharmacology-ui.js";

const output = document.getElementById("results");
const results = [];

function test(name, callback) {
  try {
    const detail = callback();
    results.push({ name, pass: true, detail });
  } catch (error) {
    results.push({ name, pass: false, detail: error.message || String(error) });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  const service = createPharmacologyService({
    loadText: async (path) => {
      const response = await fetch(`../data/${path}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    }
  });

  const records = await service.ensureLoaded();
  test("loads exactly 1,000 records", () => {
    assert(records.length === 1000, `received ${records.length}`);
    return records.length;
  });
  test("all drug IDs are unique", () => {
    const ids = records.map((record) => record.id);
    assert(new Set(ids).size === 1000, "duplicate IDs found");
    return "1,000 unique IDs";
  });
  test("evidence categories match dataset provenance", () => {
    const counts = records.reduce((out, record) => {
      out[getEvidenceCategory(record)] += 1;
      return out;
    }, { "substance-specific": 0, "class-derived": 0 });
    assert(counts["substance-specific"] === 455, JSON.stringify(counts));
    assert(counts["class-derived"] === 545, JSON.stringify(counts));
    return JSON.stringify(counts);
  });

  const searchCases = [
    ["metoprolol", "metoprolol"],
    ["C07AB02", "metoprolol"],
    ["beta blocker", ""],
    ["hyperkalemia", ""],
    ["CYP3A4", ""],
    ["factor Xa", ""],
    ["antibiotic", ""],
    ["serotonin transporter", ""]
  ];
  for (const [query, expectedTopName] of searchCases) {
    test(`search: ${query}`, () => {
      const hits = service.searchDrugs(query, {}, { mode: query === "metoprolol" || query === "C07AB02" ? "drug" : "clinical" });
      assert(hits.length > 0, "no results");
      const topName = hits[0].record.names?.english?.source_value || "";
      if (expectedTopName) assert(topName.toLowerCase() === expectedTopName, `top result was ${topName}`);
      return `${hits.length} results; top=${topName}; score=${hits[0].score}`;
    });
  }

  test("combined filters narrow results", () => {
    const hits = service.searchDrugs("", {
      atcLevel1: "C",
      evidenceCategory: "substance-specific",
      hasPharmacokinetics: true
    });
    assert(hits.length > 0, "no filtered results");
    assert(hits.every((hit) => hit.record.atc?.primary_code?.startsWith("C")), "ATC filter leaked");
    assert(hits.every((hit) => getEvidenceCategory(hit.record) === "substance-specific"), "evidence filter leaked");
    return `${hits.length} results`;
  });

  test("ATC hierarchy is built dynamically", () => {
    const roots = service.getAtcTree();
    assert(roots.length > 0, "no ATC roots");
    assert(roots.some((node) => node.code === "C" && node.children.length), "cardiovascular hierarchy missing");
    return `${roots.length} level-1 groups`;
  });

  test("comparison and AI context handle records safely", () => {
    const ids = service.searchDrugs("metoprolol", {}, { mode: "drug", limit: 1 })
      .concat(service.searchDrugs("amlodipine", {}, { mode: "drug", limit: 1 }))
      .map((hit) => hit.id);
    const comparison = service.compareDrugs(ids);
    assert(comparison.length === 2, "comparison did not return two records");
    assert(comparison.every((item) => item.dosingDisclaimer && item.evidenceCategory), "context fields missing");
    return comparison.map((item) => item.name).join(" vs ");
  });

  history.replaceState(null, "", `${location.pathname}?query=metoprolol`);
  const uiScreen = document.getElementById("ui-test-screen");
  const ui = createPharmacologyUi({ service, screen: uiScreen });
  await ui.open();
  test("search page renders summary and ranked result cards", () => {
    assert(uiScreen.querySelector("#pharm-summary")?.textContent.includes("1,000"), "summary count missing");
    assert(uiScreen.querySelector(".pharm-result-card h3")?.textContent.toLowerCase() === "metoprolol", "metoprolol card missing");
    return "page, summary and result card rendered";
  });

  uiScreen.querySelector("[data-pharm-open]")?.click();
  test("drug detail dialog renders safely", () => {
    const dialog = uiScreen.querySelector("#pharm-detail-dialog");
    assert(dialog?.open, "detail dialog did not open");
    assert(dialog.textContent.includes("Mechanism of action"), "mechanism section missing");
    assert(dialog.textContent.includes("Sources and data quality"), "sources section missing");
    return "detail sections rendered";
  });
  uiScreen.querySelector("#pharm-detail-dialog [data-pharm-close-dialog]")?.click();

  const input = uiScreen.querySelector("#pharm-search-input");
  input.value = "abciximab";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 260));
  uiScreen.querySelector("[data-pharm-open]")?.click();
  test("class-derived profile shows its required warning", () => {
    const dialog = uiScreen.querySelector("#pharm-detail-dialog");
    assert(dialog?.textContent.includes("derived from the drug's ATC class"), "class-derived warning missing");
    return "warning visible";
  });
  uiScreen.querySelector("#pharm-detail-dialog [data-pharm-close-dialog]")?.click();

  input.value = "beta blocker";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 260));
  let compareInputs = [...uiScreen.querySelectorAll("[data-pharm-compare]")].slice(0, 2);
  compareInputs[0].checked = true;
  compareInputs[0].dispatchEvent(new Event("change", { bubbles: true }));
  compareInputs = [...uiScreen.querySelectorAll("[data-pharm-compare]")].slice(0, 2);
  compareInputs[1].checked = true;
  compareInputs[1].dispatchEvent(new Event("change", { bubbles: true }));
  uiScreen.querySelector("[data-pharm-open-compare]")?.click();
  test("two-drug comparison renders", () => {
    const dialog = uiScreen.querySelector("#pharm-compare-dialog");
    assert(compareInputs.length === 2, "fewer than two comparison candidates");
    assert(dialog?.open, "comparison dialog did not open");
    assert(dialog.querySelectorAll("thead th").length === 3, "comparison columns missing");
    return "two drug columns rendered";
  });

  const failed = results.filter((result) => !result.pass);
  output.dataset.status = failed.length ? "failed" : "passed";
  output.textContent = JSON.stringify({
    status: failed.length ? "failed" : "passed",
    passed: results.length - failed.length,
    failed: failed.length,
    results
  }, null, 2);
  document.title = failed.length ? "FAIL pharmacology tests" : "PASS pharmacology tests";
}

run().catch((error) => {
  output.dataset.status = "failed";
  output.textContent = JSON.stringify({ status: "failed", fatal: error.message || String(error) }, null, 2);
  document.title = "FAIL pharmacology tests";
});
