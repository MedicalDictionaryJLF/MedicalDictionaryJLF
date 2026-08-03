import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const aiHealth = require("../../api/ai-health.js");
const contextResolve = require("../../api/context-resolve.js");
const intentRescue = require("../../api/intent-rescue.js");
const learningEvents = require("../../api/learning-events.js");
const patientPhrasing = require("../../api/patient-phrasing.js");

function createExchange({ method = "GET", origin, body } = {}) {
  const headers = {};
  const response = {
    statusCode: 200,
    body: "",
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = String(value);
    },
    end(value = "") {
      this.body = String(value);
    },
  };
  return {
    request: { method, headers: origin ? { origin } : {}, body },
    response,
    headers,
    json() {
      return JSON.parse(response.body);
    },
  };
}

async function withEnvironment(values, callback) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("unsupported methods return JSON 405 responses", async () => {
  for (const handler of [
    aiHealth,
    contextResolve,
    intentRescue,
    learningEvents,
    patientPhrasing,
  ]) {
    const exchange = createExchange({ method: "DELETE" });
    await handler(exchange.request, exchange.response);
    assert.equal(exchange.response.statusCode, 405);
    assert.match(exchange.headers["content-type"], /^application\/json/);
    assert.equal(exchange.json().success, false);
  }
});

test("invalid request bodies return controlled 400 responses", async () => {
  const cases = [
    [contextResolve, {}],
    [intentRescue, { question: "hello", intents: [] }],
    [patientPhrasing, {}],
    [learningEvents, "not-json"],
  ];
  for (const [handler, body] of cases) {
    const exchange = createExchange({ method: "POST", body });
    await handler(exchange.request, exchange.response);
    assert.equal(exchange.response.statusCode, 400);
    assert.match(exchange.headers["content-type"], /^application\/json/);
  }
});

test("CORS permits configured production/local origins and does not reflect arbitrary origins", async () => {
  for (const allowedOrigin of [
    "https://medicaldictionaryjlf.github.io",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]) {
    const exchange = createExchange({ method: "GET", origin: allowedOrigin });
    await aiHealth(exchange.request, exchange.response);
    assert.equal(
      exchange.headers["access-control-allow-origin"],
      allowedOrigin,
    );
  }

  const arbitrary = createExchange({
    method: "GET",
    origin: "https://attacker.example",
  });
  await aiHealth(arbitrary.request, arbitrary.response);
  assert.equal(arbitrary.headers["access-control-allow-origin"], undefined);
  assert.equal(arbitrary.headers.vary, "Origin");
});

test("health endpoint exposes stable fields without secret material", async () => {
  await withEnvironment(
    { GEMINI_API_KEY: "test-secret-that-must-not-leak" },
    async () => {
      const exchange = createExchange({ method: "GET" });
      await aiHealth(exchange.request, exchange.response);
      const body = exchange.json();
      assert.equal(exchange.response.statusCode, 200);
      assert.deepEqual(Object.keys(body).sort(), [
        "configured",
        "model",
        "runtime",
        "success",
      ]);
      assert.equal(body.configured, true);
      assert.ok(
        !exchange.response.body.includes("test-secret-that-must-not-leak"),
      );
    },
  );
});

test("missing Gemini configuration returns a controlled response without calling fetch", async () => {
  const previousFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error("fetch must not be called");
  };
  const previousConsoleError = console.error;
  console.error = () => {};
  try {
    await withEnvironment({ GEMINI_API_KEY: undefined }, async () => {
      const exchange = createExchange({
        method: "POST",
        body: {
          question: "What is this?",
          intents: [{ id: "identity", description: "Identity" }],
        },
      });
      await intentRescue(exchange.request, exchange.response);
      assert.equal(exchange.response.statusCode, 503);
      assert.equal(exchange.json().success, false);
      assert.equal(fetchCalled, false);
    });
  } finally {
    console.error = previousConsoleError;
    global.fetch = previousFetch;
  }
});

test("Gemini-backed handler uses mocked fetch and returns only the mocked safe payload", async () => {
  const previousFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({ answer: "A natural patient reply." }),
                },
              ],
            },
          },
        ],
      };
    },
  });
  try {
    await withEnvironment(
      { GEMINI_API_KEY: "mock-gemini-secret" },
      async () => {
        const exchange = createExchange({
          method: "POST",
          body: { deterministicAnswer: "The pain started two hours ago." },
        });
        await patientPhrasing(exchange.request, exchange.response);
        assert.equal(exchange.response.statusCode, 200);
        assert.equal(exchange.json().answer, "A natural patient reply.");
        assert.ok(!exchange.response.body.includes("mock-gemini-secret"));
      },
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("learning-event Google calls are mocked and secrets never appear in responses", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return {
        ok: true,
        async json() {
          return { access_token: "mock-access-token" };
        },
      };
    }
    return {
      ok: true,
      async json() {
        return { id: "mock-file" };
      },
    };
  };
  try {
    await withEnvironment(
      {
        GOOGLE_SERVICE_ACCOUNT_EMAIL: "mock-service@example.invalid",
        GOOGLE_PRIVATE_KEY: privateKeyPem,
        GOOGLE_DRIVE_FOLDER_ID: "mock-folder-secret",
      },
      async () => {
        const exchange = createExchange({
          method: "POST",
          body: { studentQuestion: "When did the pain start?" },
        });
        await learningEvents(exchange.request, exchange.response);
        assert.equal(exchange.response.statusCode, 200);
        assert.deepEqual(exchange.json(), {
          success: true,
          stored: true,
          configured: true,
        });
        assert.equal(calls.length, 2);
        assert.ok(!exchange.response.body.includes("mock-folder-secret"));
        assert.ok(
          !exchange.response.body.includes("mock-service@example.invalid"),
        );
      },
    );
  } finally {
    global.fetch = previousFetch;
  }
});
