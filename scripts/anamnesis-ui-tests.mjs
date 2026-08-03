import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PATIENT_CASES } from "../anamnesis-training/src/patientCase.js";
import { PatientEngine } from "../anamnesis-training/src/patientEngine.js";
import {
  getChecklistItemsByCategory,
  getKnownFactsByCategory,
  getQuestionVariantsByCategory,
} from "../anamnesis-training/src/ui/categoryModel.js";
import {
  showResponseLoading,
  removeResponseLoading,
} from "../anamnesis-training/src/ui/loadingIndicator.js";
import {
  DEFAULT_RECOGNITION_LANGUAGE,
  initVoiceInput,
} from "../anamnesis-training/src/ui/voiceInput.js";
import {
  getModeSectionIds,
  getModeSectionTitle,
  renderKnownSummary,
} from "../anamnesis-training/src/ui/modeLayout.js";
import { labsForGroup } from "../anamnesis-training/src/ui/actionPanels.js";

const patientCase = PATIENT_CASES[0];
const engine = new PatientEngine(patientCase, { mode: "teaching" });

assert.deepEqual(getModeSectionIds("teaching"), [
  "checklist",
  "questions",
  "summary",
]);
assert.deepEqual(getModeSectionIds("practice"), ["checklist", "summary"]);
assert.deepEqual(getModeSectionIds("exam"), ["summary"]);
assert.equal(getModeSectionTitle("questions"), "Predetermined Questions");

const checklist = getChecklistItemsByCategory(engine, patientCase);
assert.ok(checklist.some((group) => group.title === "Identification"));
assert.ok(
  checklist
    .flatMap((group) => group.items)
    .some((item) => item.label === "Name" && item.status === "notAsked"),
);

const emptyFacts = getKnownFactsByCategory(engine, patientCase);
assert.equal(emptyFacts.length, 0);
assert.ok(!renderKnownSummary(engine, patientCase).includes("Peter Novak"));

engine.ask("What is your name?");
const knownFacts = getKnownFactsByCategory(engine, patientCase);
assert.ok(
  knownFacts.some((group) =>
    group.facts.some(
      (fact) => fact.label === "Name" && /Peter Novak/.test(fact.value),
    ),
  ),
);
assert.ok(
  !knownFacts.some((group) => group.facts.some((fact) => fact.label === "Age")),
);

const questionGroups = getQuestionVariantsByCategory(patientCase, engine);
assert.ok(
  questionGroups.some((group) =>
    group.intents.some((intent) => intent.variants.length > 1),
  ),
);
assert.ok(
  questionGroups.some((group) =>
    group.intents.some((intent) => intent.covered),
  ),
);

const ordered = labsForGroup("fbc", patientCase);
assert.deepEqual(Object.keys(ordered), ["wbc"]);
assert.match(ordered.wbc, /WBC/i);

assert.equal(DEFAULT_RECOGNITION_LANGUAGE, "en-US");

global.window = {};
const fakeButton = {
  disabled: false,
  title: "",
  attrs: {},
  setAttribute(name, value) {
    this.attrs[name] = value;
  },
  addEventListener() {},
};
const voiceResult = initVoiceInput({
  button: fakeButton,
  input: {},
  status: { textContent: "" },
});
assert.equal(voiceResult.supported, false);
assert.equal(fakeButton.disabled, true);
assert.match(fakeButton.title, /not supported/i);

global.document = {
  createElement() {
    return {
      className: "",
      dataset: {},
      attrs: {},
      innerHTML: "",
      setAttribute(name, value) {
        this.attrs[name] = value;
      },
      remove() {
        this.removed = true;
      },
    };
  },
};
const fakeChat = {
  children: [],
  scrollTop: 0,
  scrollHeight: 200,
  classList: {
    empty: true,
    contains(name) {
      return name === "empty-chat" && this.empty;
    },
    remove(name) {
      if (name === "empty-chat") this.empty = false;
    },
  },
  innerHTML: "placeholder",
  appendChild(node) {
    this.children.push(node);
  },
  querySelector(selector) {
    return selector === '[data-loading-bubble="true"]'
      ? this.children.find((node) => node.dataset.loadingBubble === "true")
      : null;
  },
};
const loadingBubble = showResponseLoading(fakeChat);
assert.equal(loadingBubble.dataset.loadingBubble, "true");
assert.match(loadingBubble.innerHTML, /Generating response/);
removeResponseLoading(fakeChat);
assert.equal(loadingBubble.removed, true);

const html = readFileSync(
  new URL("../anamnesis-training/index.html", import.meta.url),
  "utf8",
);
assert.ok(htmlDoesNotExposeDiagnosticsPasswordContract());
for (const id of [
  "openVitalsBtn",
  "openEcgBtn",
  "orderLabsBtn",
  "administerMedicationBtn",
  "finishBtn",
  "voiceInputBtn",
  "detailsPanel",
]) {
  assert.ok(html.includes(`id="${id}"`), `Missing ${id}`);
}
assert.ok(!html.includes('id="suggestions"'));
assert.ok(!html.includes('id="engineDebug"'));

function htmlDoesNotExposeDiagnosticsPasswordContract() {
  return !html.includes("data-details-password=");
}

console.log("Anamnesis UI regression tests passed.");
