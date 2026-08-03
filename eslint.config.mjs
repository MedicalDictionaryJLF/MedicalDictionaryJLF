import eslint from "@eslint/js";
import globals from "globals";

const sharedRules = {
  ...eslint.configs.recommended.rules,
  "no-unused-vars": "off",
  "no-empty": "off",
  "no-constant-condition": ["error", { checkLoops: false }],
  "no-unreachable": "off",
  "no-useless-assignment": "off",
};

export default [
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    ignores: [
      "node_modules/**",
      "dist/**",
      ".artifacts/**",
      "coverage/**",
      "assets/**/*.min.js",
    ],
  },
  {
    files: ["scripts/pharmacology-tests.js"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: [
      "assets/js/**/*.js",
      "src/**/*.js",
      "anamnesis-training/src/**/*.js",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        google: "readonly",
      },
    },
    rules: sharedRules,
  },
  {
    files: ["api/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: sharedRules,
  },
  {
    files: [
      "scripts/**/*.js",
      "scripts/**/*.mjs",
      "test/**/*.mjs",
      "vite.config.mjs",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
    rules: sharedRules,
  },
  {
    files: ["assets/js/app.js"],
    rules: {
      "no-dupe-keys": "off",
      "no-irregular-whitespace": "off",
      "no-undef": "off",
      "no-useless-escape": "off",
    },
  },
];
