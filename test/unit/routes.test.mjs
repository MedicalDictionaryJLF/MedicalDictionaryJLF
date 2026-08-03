import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAppPathForRoute,
  currentSection,
  getAppBasePath,
  getRouteForScreen,
  getScreenForRoute,
  normalizeRoutePath,
  resolveAppShellUrl,
  resolveBundledDataUrl,
} from "../../assets/js/core/app-paths.js";

test("route normalization and mappings preserve supported routes", () => {
  assert.equal(normalizeRoutePath(" /PHARMACOLOGY/ "), "pharmacology");
  assert.equal(getRouteForScreen("screen-quiz"), "quiz");
  assert.equal(getScreenForRoute("/FLASHCARDS/"), "screen-flashcards");
  assert.equal(currentSection("/quiz/index.html"), "quiz");
  assert.equal(
    currentSection("/MedicalDictionaryJLF/anamnesis-training/"),
    "root",
  );
});

test("route base paths work at root and under the GitHub Pages repository path", () => {
  assert.equal(getAppBasePath("/menu/"), "/");
  assert.equal(getAppBasePath("/index.html"), "/");
  assert.equal(
    getAppBasePath("/MedicalDictionaryJLF/menu/"),
    "/MedicalDictionaryJLF/",
  );
  assert.equal(
    getAppBasePath("/MedicalDictionaryJLF/search/index.html"),
    "/MedicalDictionaryJLF/",
  );
  assert.equal(
    buildAppPathForRoute("quiz", {
      pathname: "/MedicalDictionaryJLF/menu/",
      search: "?language=English&page=menu",
    }),
    "/MedicalDictionaryJLF/quiz/?language=English",
  );
});

test("runtime shell and dataset URLs retain the current hosting base", () => {
  const options = {
    pathname: "/MedicalDictionaryJLF/search/",
    origin: "https://medicaldictionaryjlf.github.io",
  };
  assert.equal(
    resolveAppShellUrl(options),
    "https://medicaldictionaryjlf.github.io/MedicalDictionaryJLF/index.html",
  );
  assert.equal(
    resolveBundledDataUrl("terminology/anatomy.csv", options),
    "https://medicaldictionaryjlf.github.io/MedicalDictionaryJLF/data/terminology/anatomy.csv",
  );
});
