'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const handler = require('../api/patient-trainer-log.js');

const id = 'a7afc5c9-27a5-48b0-b193-fb4f5a4a602a';
const anon = 'pt-browser-f1b06e12-42f2-4510-b435-7f82fcac6fd9';
const filename = `patient-trainer-${id}.json`;
const record = () => ({
  schemaVersion: 1, sessionId: id, anonymousUserId: anon, caseId: 'chest_pain_acs_risk',
  caseName: 'Simulated case', trainerType: 'anamnesis', mode: 'practice',
  startedAt: '2026-11-08T16:00:00Z', completedAt: '2026-11-08T16:10:00Z',
  messages: [{ speaker: 'student', text: 'Where does it hurt?', timestamp: '2026-11-08T16:01:00Z',
    detectedIntent: 'hpi_site', matchScore: 0.91, matchedIntentIds: ['hpi_site']}],
  coveredTopics: ['hpi_site'], fallbackQuestions: []
});
const setup = () => {
  process.env.PATIENT_TRAINER_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/test/exec';
  process.env.PATIENT_TRAINER_UPLOAD_SHARED_SECRET = 'mock-secret';
};
function response() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    end(body) { this.body = body; } };
}
async function call(body, method = 'POST', origin = 'https://medicaldictionaryjlf.github.io') {
  const res = response();
  await handler({ method, headers: { origin }, body }, res);
  return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body || '{}') };
}

test('validates session before writing', async () => {
  setup(); let called = false; global.fetch = async () => { called = true; throw Error('should not fetch'); };
  for (const invalid of [
    { ...record(), sessionId: 'bad' }, { ...record(), anonymousUserId: 'test@example.com' },
    { ...record(), messages: 'bad' }, { ...record(), completedAt: '' },
    { ...record(), schemaVersion: 999 }, { ...record(), messages: [{ speaker: 'doctor', text: 'fake' }] }
  ]) assert.equal((await call(invalid)).status, 400);
  assert.equal(called, false);
});

test('actual CORS accepts published GitHub origin only', async () => {
  setup();
  const good = await call({}, 'OPTIONS');
  assert.equal(good.status, 204);
  assert.equal(good.headers['Access-Control-Allow-Origin'], 'https://medicaldictionaryjlf.github.io');
  const bad = await call({}, 'OPTIONS', 'https://attacker.example');
  assert.equal(bad.headers['Access-Control-Allow-Origin'], undefined);
  assert.equal((await call({}, 'GET')).status, 405);
});

test('sanitizes payload and requires storage acknowledgement', async () => {
  setup();
  global.fetch = async (url, opts) => {
    assert.match(url, /^https:\/\/script\.google\.com\//);
    assert.equal(opts.method, 'POST');
    assert.match(opts.headers['Content-Type'], /text\/plain/);
    const body = JSON.parse(opts.body);
    assert.equal(body.secret, 'mock-secret');
    assert.equal(body.session.sessionId, id);
    assert.equal(body.filename, filename);
    assert.equal(body.session.unrelatedAccountData, undefined);
    assert.equal(body.session.messages[0].matchScore, 0.91);
    assert.deepEqual(body.session.messages[0].matchedIntentIds, ['hpi_site']);
    return { ok: true, status: 200, json: async () => ({ ok: true, stored: true,
      sessionId: id, filename, uploadId: 'mock-drive-file' }) };
  };
  const out = await call({ ...record(), unrelatedAccountData: 'never upload' });
  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true);
  assert.equal(out.body.uploadId, 'mock-drive-file');
});

test('wrong session and false acknowledgements never count as success', async () => {
  setup();
  for (const reply of [
    { ok: true, stored: true, sessionId: 'wrong', filename },
    { ok: true, stored: false, sessionId: id, filename },
    { ok: false, stored: true, sessionId: id, filename },
    { ok: true, stored: true, sessionId: id }
  ]) {
    global.fetch = async () => ({ ok: true, status: 200, json: async () => reply });
    assert.equal((await call(record())).status, 503);
  }
});

test('reports missing storage configuration', async () => {
  setup(); delete process.env.PATIENT_TRAINER_APPS_SCRIPT_URL;
  assert.equal((await call(record())).status, 503);
});

test('handles non-JSON response, HTTP failure and network failure', async () => {
  setup();
  global.fetch = async () => ({ ok: true, status: 200, json: async () => { throw Error('html') } });
  assert.equal((await call(record())).status, 503);
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  assert.equal((await call(record())).status, 503);
  global.fetch = async () => { throw Error('network down') };
  assert.equal((await call(record())).status, 503);
});

test('blocks oversized request before upstream call', async () => {
  setup(); let called = false; global.fetch = async () => { called = true; throw Error('bad'); };
  const oversized = { ...record(), messages: [{ speaker: 'student', text: 'z'.repeat(3_050_000) }] };
  assert.equal((await call(oversized)).status, 413);
  assert.equal(called, false);
});

function makeReceiver() {
  const saved = [];
  let created = 0;
  const folder = {
    getFilesByName(name) {
      const hits = saved.filter(x => x.name === name);
      let i = 0;
      return { hasNext: () => i < hits.length, next: () => hits[i++] };
    },
    createFile(name, contents) {
      const file = { name, contents, getId: () => 'file-' + (++created) };
      saved.push(file);
      return file;
    }
  };
  const context = {
    JSON, Date, String, RegExp, MimeType: { PLAIN_TEXT: 'text/plain' },
    console: { error() {} },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput(text) {
      return { text, setMimeType() { return this; } };
    } },
    PropertiesService: { getScriptProperties() { return {
      getProperty(key) { return {
        PATIENT_TRAINER_UPLOAD_SHARED_SECRET: 'mock-secret',
        PATIENT_TRAINER_LOG_FOLDER_ID: 'mock-folder'
      }[key] || null; }
    }; } },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    DriveApp: { getFolderById(key) { assert.equal(key, 'mock-folder'); return folder; } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../google-apps-script/Code.gs'), 'utf8'), context);
  return { submit: body => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) } }).text), saved };
}

test('receiver rejects invalid secret and is idempotent on retries', () => {
  const gas = makeReceiver();
  const packet = { action: 'patient-trainer-log', secret: 'mock-secret', filename, session: record() };
  assert.equal(gas.submit({ ...packet, secret: 'wrong' }).ok, false);
  assert.equal(gas.saved.length, 0);
  const first = gas.submit(packet);
  assert.equal(first.ok, true);
  assert.equal(first.stored, true);
  assert.equal(first.sessionId, id);
  assert.equal(gas.submit(packet).ok, true);
  assert.equal(gas.saved.length, 1);
  const stored = JSON.parse(gas.saved[0].contents);
  assert.equal(stored.session.sessionId, id);
});
