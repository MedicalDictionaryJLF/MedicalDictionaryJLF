import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const sourcePath = path.join(root, "assets/js/anatomy/clinical-correlation-search.js");
const source = fs.readFileSync(sourcePath, "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const { buildClinicalCorrelationIndex, searchClinicalCorrelations } = await import(moduleUrl);
const logic = JSON.parse(fs.readFileSync(path.join(root, "data/anatomy/clinical_correlations_logic.json"), "utf8"));
const synonyms = JSON.parse(fs.readFileSync(path.join(root, "data/anatomy/clinical_correlation_synonyms.json"), "utf8"));
const rules = JSON.parse(fs.readFileSync(path.join(root, "data/anatomy/clinical_query_normalization_rules.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(root, "data/schemas/clinical_correlation_synonyms.schema.json"), "utf8"));

assert.equal(Array.isArray(logic.correlations), true);
assert.equal(logic.correlations.length, 40);
assert.equal(rules.algorithm_id, "clinical_correlation_fuzzy_search_v1");
assert.ok(schema && typeof schema === "object");
const ids = logic.correlations.map(record => record.id);
assert.equal(new Set(ids).size, ids.length, "duplicate correlation IDs");
assert.ok(logic.correlations.every(record => record.query_support && typeof record.query_support === "object"), "every correlation requires query_support");
const index = buildClinicalCorrelationIndex(logic.correlations, synonyms);
assert.equal(index.length, logic.correlations.length);

const cases = [
  ["greater curvature artery", "cc_stomach_greater_curvature_gastro_omental"],
  ["inferior side stomach vessel", "cc_stomach_greater_curvature_gastro_omental"],
  ["gastroepiploic", "cc_stomach_greater_curvature_gastro_omental"],
  ["lesser curvature artery", "cc_stomach_lesser_curvature_gastric"],
  ["posterior duodenal ulcer bleeding", "cc_duodenal_ulcer_gastroduodenal"],
  ["foramen spinosum contents", "cc_middle_meningeal_foramen_spinosum"],
  ["cavernous sinus CN VI", "cc_cavernous_sinus_contents"],
  ["funny bone nerve", "cc_medial_epicondyle_ulnar"],
  ["carpal tunnel nerve", "cc_carpal_tunnel_contents"],
  ["femoral triangle NAVL", "cc_femoral_triangle_navl"],
  ["water under the bridge", "cc_ureter_under_uterine_artery"],
  ["CN III ptosis pupil", "cc_cranial_nerve_iii_pupil_ptosis"],
  ["bitemporal hemianopia", "cc_visual_pathway_optic_chiasm"]
];

for (const [query, expectedId] of cases) {
  const hits = searchClinicalCorrelations(query, index, synonyms, { minScore: 45, maxResults: 10 });
  assert.ok(hits.length > 0, `no results for ${query}`);
  assert.equal(hits[0].id, expectedId, `${query} returned ${hits[0].id}`);
}

console.log(`Clinical correlation tests passed: ${cases.length} expected-query cases, ${logic.correlations.length} records.`);
