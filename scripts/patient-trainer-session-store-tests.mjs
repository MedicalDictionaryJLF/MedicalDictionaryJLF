import assert from 'node:assert/strict';
import {
  buildAnonymizedPatientTrainerUpload,
  createPatientTrainerSessionRecord,
  deletePatientTrainerSession,
  getPatientTrainerSession,
  readPatientTrainerSessions,
  readAllPatientTrainerSessions,
  setActivePatientTrainerAccountId,
  clearActivePatientTrainerAccountId,
  updatePatientTrainerSession,
  upsertPatientTrainerSession,
  PATIENT_TRAINER_SESSIONS_STORAGE_KEY
} from '../assets/js/services/patient-trainer-session-store.js';

const data = new Map();
globalThis.localStorage = {
  getItem: key => data.get(key) || null,
  setItem: (key, value) => { data.set(key, value); },
  removeItem: key => { data.delete(key); }
};

const initial = createPatientTrainerSessionRecord({caseId:'simulated',caseName:'Demo patient',clientVersion:'test'});
assert.equal(initial.completed, false);
const stored = upsertPatientTrainerSession(initial);
assert.equal(stored.sessionId, initial.sessionId);
assert.equal(readPatientTrainerSessions().length, 1);
assert.ok(data.has(PATIENT_TRAINER_SESSIONS_STORAGE_KEY));
const completedAt = new Date().toISOString();
const updated = updatePatientTrainerSession(initial.sessionId, { completed: true, completedAt, messages:[
  {speaker:'student',text:'Any allergies?',normalizedQuestion:'any allergies'},
  {speaker:'patient',text:'Not in this simulation'}
] });
assert.equal(updated.completed, true);
assert.equal(getPatientTrainerSession(initial.sessionId).messages.length, 2);
const payload = buildAnonymizedPatientTrainerUpload(updated);
assert.equal(payload.sessionId, initial.sessionId);
assert.equal(payload.messages.length,2);
assert.equal(payload.accountEmail, undefined);
const uploaded = updatePatientTrainerSession(initial.sessionId, {uploaded:true,uploadId:'stored-file'});
assert.equal(uploaded.uploaded,true);
assert.equal(readPatientTrainerSessions().length,1);

globalThis.localStorage.setItem = () => { throw new Error('simulated storage quota exceeded'); };
const second = createPatientTrainerSessionRecord({caseId:'simulated2'});
assert.equal(upsertPatientTrainerSession(second), null);
assert.equal(readPatientTrainerSessions().length,1);

// Delete operates on the currently active owner only and preserves other owners.
globalThis.localStorage.setItem = (key, value) => { data.set(key, value); };
const accountId = 'pt-account-test-user';
setActivePatientTrainerAccountId(accountId);
const otherOwner = createPatientTrainerSessionRecord({ caseId: 'other-owner', caseName: 'Private case' });
assert.ok(upsertPatientTrainerSession(otherOwner));
assert.equal(deletePatientTrainerSession(initial.sessionId), false, 'Cannot delete another owner\'s session');
assert.equal(readPatientTrainerSessions().length, 1);
clearActivePatientTrainerAccountId();
assert.equal(readPatientTrainerSessions().length, 1);
assert.equal(deletePatientTrainerSession(''), false);
assert.equal(deletePatientTrainerSession('not-found'), false);
assert.equal(deletePatientTrainerSession(initial.sessionId), true);
assert.equal(getPatientTrainerSession(initial.sessionId), null);
assert.equal(deletePatientTrainerSession(initial.sessionId), false, 'Deletion is idempotent');
assert.equal(readPatientTrainerSessions().length, 0);
assert.equal(readAllPatientTrainerSessions().length, 1, 'Other-owner session must remain');
setActivePatientTrainerAccountId(accountId);
assert.equal(deletePatientTrainerSession(otherOwner.sessionId), true);
assert.equal(readAllPatientTrainerSessions().length, 0);
clearActivePatientTrainerAccountId();

// Deletion failure must leave the original record intact.
const toKeep = upsertPatientTrainerSession(createPatientTrainerSessionRecord({ caseId: 'keep' }));
assert.ok(toKeep);
globalThis.localStorage.setItem = () => { throw new Error('write failure'); };
assert.equal(deletePatientTrainerSession(toKeep.sessionId), false);
assert.ok(getPatientTrainerSession(toKeep.sessionId));
console.log('Patient Trainer session history: PASS (save/reload, deletion, owner isolation, upload state, payload, storage failure)');
