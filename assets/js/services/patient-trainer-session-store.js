export const PATIENT_TRAINER_SESSIONS_STORAGE_KEY = 'patient_trainer/sessions_v1';
const SESSIONS_KEY = PATIENT_TRAINER_SESSIONS_STORAGE_KEY;
const BROWSER_ANON_KEY = 'patient_trainer/browser_anonymous_id_v1';
const ACTIVE_ACCOUNT_KEY = 'patient_trainer/active_account_anonymous_id_v1';
const MAX_SESSIONS_PER_OWNER = 50;
const MAX_TOTAL_SESSIONS = 120;

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function clone(value) {
  if (value === undefined) return undefined;
  try { return structuredClone(value); } catch {}
  return JSON.parse(JSON.stringify(value));
}

export function createPatientTrainerUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getPatientTrainerBrowserAnonymousId() {
  const store = storage();
  const existing = String(store?.getItem(BROWSER_ANON_KEY) || '').trim();
  if (existing) return existing;
  const id = `pt-browser-${createPatientTrainerUuid()}`;
  try { store?.setItem(BROWSER_ANON_KEY, id); } catch {}
  return id;
}

export function getActivePatientTrainerAccountId() {
  try { return String(storage()?.getItem(ACTIVE_ACCOUNT_KEY) || '').trim(); } catch { return ''; }
}

export function setActivePatientTrainerAccountId(value) {
  const id = String(value || '').trim();
  try {
    if (id) storage()?.setItem(ACTIVE_ACCOUNT_KEY, id);
    else storage()?.removeItem(ACTIVE_ACCOUNT_KEY);
  } catch {}
  return id;
}

export function clearActivePatientTrainerAccountId() {
  setActivePatientTrainerAccountId('');
}

export function getPatientTrainerOwner() {
  const accountId = getActivePatientTrainerAccountId();
  return accountId
    ? { anonymousUserId: accountId, ownerType: 'account' }
    : { anonymousUserId: getPatientTrainerBrowserAnonymousId(), ownerType: 'guest' };
}

export function readAllPatientTrainerSessions() {
  const store = storage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(SESSIONS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object' && item.sessionId) : [];
  } catch {
    return [];
  }
}

export function readPatientTrainerSessions({ includeOtherOwners = false } = {}) {
  const sessions = readAllPatientTrainerSessions();
  if (includeOtherOwners) return sessions;
  const owner = getPatientTrainerOwner();
  return sessions.filter((session) => String(session.anonymousUserId || '') === owner.anonymousUserId);
}

export function getPatientTrainerSession(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) return null;
  const owner = getPatientTrainerOwner();
  const hit = readAllPatientTrainerSessions().find((session) => session.sessionId === id && String(session.anonymousUserId || '') === owner.anonymousUserId);
  return hit ? clone(hit) : null;
}

export function upsertPatientTrainerSession(session) {
  if (!session || typeof session !== 'object' || !String(session.sessionId || '').trim()) return null;
  const incoming = normalizeSession(session);
  const all = readAllPatientTrainerSessions();
  const index = all.findIndex((item) => item.sessionId === incoming.sessionId);
  if (index >= 0) all[index] = mergeSession(all[index], incoming);
  else all.push(incoming);
  writeSessions(pruneSessions(all));
  return getPatientTrainerSession(incoming.sessionId) || clone(incoming);
}

export function updatePatientTrainerSession(sessionId, patch) {
  const existing = getPatientTrainerSession(sessionId);
  if (!existing) return null;
  const nextPatch = typeof patch === 'function' ? patch(clone(existing)) : patch;
  return upsertPatientTrainerSession({ ...existing, ...(nextPatch || {}), sessionId: existing.sessionId });
}

export function createPatientTrainerSessionRecord({
  caseId,
  caseName,
  trainerType = 'anamnesis',
  mode = 'practice',
  difficulty = 'intermediate',
  clientVersion = ''
} = {}) {
  const owner = getPatientTrainerOwner();
  const now = new Date().toISOString();
  return normalizeSession({
    schemaVersion: 1,
    sessionId: createPatientTrainerUuid(),
    anonymousUserId: owner.anonymousUserId,
    ownerType: owner.ownerType,
    caseId: String(caseId || ''),
    caseName: String(caseName || ''),
    trainerType,
    mode,
    difficulty,
    startedAt: now,
    lastActivityAt: now,
    completedAt: '',
    durationSeconds: 0,
    messages: [],
    examinations: [],
    coveredTopics: [],
    uncoveredTopics: [],
    fallbackQuestions: [],
    completed: false,
    uploaded: false,
    uploadedAt: '',
    uploadId: '',
    uploadFilename: '',
    uploadRequested: false,
    uploadAttempts: 0,
    automaticRetryCount: 0,
    lastUploadError: '',
    clientVersion: String(clientVersion || '')
  });
}

export function ensurePatientTrainerProfileShape(profile) {
  if (!profile || typeof profile !== 'object') return profile;
  const existing = profile.patient_trainer && typeof profile.patient_trainer === 'object' ? profile.patient_trainer : {};
  const anonymousId = String(existing.anonymous_user_id || '').trim() || `pt-account-${createPatientTrainerUuid()}`;
  profile.patient_trainer = {
    ...existing,
    anonymous_user_id: anonymousId,
    sessions: Array.isArray(existing.sessions) ? existing.sessions.filter((item) => item && item.sessionId).map(normalizeSession) : []
  };
  return profile;
}

export function mergePatientTrainerProfiles(targetProfile, otherProfile) {
  ensurePatientTrainerProfileShape(targetProfile);
  ensurePatientTrainerProfileShape(otherProfile);
  const targetId = targetProfile.patient_trainer.anonymous_user_id;
  const remoteId = otherProfile.patient_trainer.anonymous_user_id;
  const chosenId = String(targetId || remoteId || '').trim() || `pt-account-${createPatientTrainerUuid()}`;
  const sessions = mergeSessionLists(
    targetProfile.patient_trainer.sessions || [],
    otherProfile.patient_trainer.sessions || []
  ).map((session) => ({ ...session, anonymousUserId: chosenId, ownerType: 'account' }));
  targetProfile.patient_trainer = {
    ...otherProfile.patient_trainer,
    ...targetProfile.patient_trainer,
    anonymous_user_id: chosenId,
    sessions: sessions.slice(0, MAX_SESSIONS_PER_OWNER)
  };
  return targetProfile;
}

export function syncPatientTrainerHistoryWithProfile(profile, { claimGuestSessions = true } = {}) {
  ensurePatientTrainerProfileShape(profile);
  const accountId = profile.patient_trainer.anonymous_user_id;
  setActivePatientTrainerAccountId(accountId);

  const allLocal = readAllPatientTrainerSessions();
  const browserId = getPatientTrainerBrowserAnonymousId();
  const claimedLocal = allLocal.map((session) => {
    const belongsToAccount = String(session.anonymousUserId || '') === accountId;
    const isClaimableGuest = claimGuestSessions && session.ownerType === 'guest' && String(session.anonymousUserId || '') === browserId;
    return (belongsToAccount || isClaimableGuest)
      ? { ...session, anonymousUserId: accountId, ownerType: 'account' }
      : session;
  });

  const localForAccount = claimedLocal.filter((session) => String(session.anonymousUserId || '') === accountId);
  const merged = mergeSessionLists(profile.patient_trainer.sessions || [], localForAccount)
    .map((session) => ({ ...session, anonymousUserId: accountId, ownerType: 'account' }))
    .slice(0, MAX_SESSIONS_PER_OWNER);
  const before = JSON.stringify(profile.patient_trainer.sessions || []);
  profile.patient_trainer.sessions = merged;

  const otherOwners = claimedLocal.filter((session) => String(session.anonymousUserId || '') !== accountId);
  writeSessions(pruneSessions([...otherOwners, ...merged]));
  return { changed: before !== JSON.stringify(merged), anonymousUserId: accountId, sessionCount: merged.length };
}

export function buildAnonymizedPatientTrainerUpload(session) {
  const safe = normalizeSession(session || {});
  const messages = (safe.messages || []).map((message) => {
    const base = {
      timestamp: String(message.timestamp || message.at || ''),
      speaker: message.speaker === 'patient' ? 'patient' : 'student',
      text: String(message.text || '').slice(0, 6000)
    };
    const diagnosticKeys = [
      'normalizedQuestion', 'matchedIntent', 'matchedQuestionAnswerId', 'matchKind', 'responseScope',
      'confidence', 'matchScore', 'fallbackUsed', 'feedbackLabel', 'detectedIntent', 'returnedAnswer', 'aiSelectedIntent',
      'aiConfidence', 'aiAttempted', 'aiSucceeded', 'aiRescueUsed', 'finalResolutionSource'
    ];
    diagnosticKeys.forEach((key) => {
      if (message[key] !== undefined && message[key] !== null && message[key] !== '') base[key] = clone(message[key]);
    });
    if (Array.isArray(message.matchedIntentIds)) base.matchedIntentIds = message.matchedIntentIds.slice(0, 20).map(String);
    return base;
  });

  return {
    schemaVersion: 1,
    sessionId: safe.sessionId,
    anonymousUserId: safe.anonymousUserId,
    caseId: safe.caseId,
    caseName: safe.caseName,
    trainerType: safe.trainerType,
    mode: safe.mode,
    startedAt: safe.startedAt,
    completedAt: safe.completedAt,
    durationSeconds: Number(safe.durationSeconds || 0),
    messages,
    examinations: clone(safe.examinations || []),
    coveredTopics: clone(safe.coveredTopics || []),
    uncoveredTopics: clone(safe.uncoveredTopics || []),
    fallbackQuestions: clone(safe.fallbackQuestions || []),
    clientVersion: safe.clientVersion
  };
}

export function mergeSessionLists(first = [], second = []) {
  const map = new Map();
  [...first, ...second].forEach((item) => {
    if (!item || !item.sessionId) return;
    const normalized = normalizeSession(item);
    const current = map.get(normalized.sessionId);
    map.set(normalized.sessionId, current ? mergeSession(current, normalized) : normalized);
  });
  return [...map.values()].sort((a, b) => sessionTime(b) - sessionTime(a));
}

function normalizeSession(session) {
  const owner = session.anonymousUserId ? null : getPatientTrainerOwner();
  const mode = ['practice', 'teaching', 'exam'].includes(String(session.mode || '').toLowerCase()) ? String(session.mode).toLowerCase() : 'practice';
  const trainerType = ['anamnesis', 'anamnesis_examination'].includes(String(session.trainerType || '').toLowerCase())
    ? String(session.trainerType).toLowerCase()
    : 'anamnesis';
  return {
    ...clone(session),
    schemaVersion: 1,
    sessionId: String(session.sessionId || ''),
    anonymousUserId: String(session.anonymousUserId || owner?.anonymousUserId || ''),
    ownerType: session.ownerType === 'account' ? 'account' : (owner?.ownerType || 'guest'),
    caseId: String(session.caseId || ''),
    caseName: String(session.caseName || ''),
    trainerType,
    mode,
    difficulty: String(session.difficulty || 'intermediate'),
    startedAt: String(session.startedAt || new Date().toISOString()),
    lastActivityAt: String(session.lastActivityAt || session.startedAt || new Date().toISOString()),
    completedAt: String(session.completedAt || ''),
    durationSeconds: Math.max(0, Number(session.durationSeconds || 0)),
    messages: Array.isArray(session.messages) ? session.messages : [],
    examinations: Array.isArray(session.examinations) ? session.examinations : [],
    coveredTopics: Array.isArray(session.coveredTopics) ? session.coveredTopics : [],
    uncoveredTopics: Array.isArray(session.uncoveredTopics) ? session.uncoveredTopics : [],
    fallbackQuestions: Array.isArray(session.fallbackQuestions) ? session.fallbackQuestions : [],
    completed: Boolean(session.completed),
    uploaded: Boolean(session.uploaded),
    uploadedAt: String(session.uploadedAt || ''),
    uploadId: String(session.uploadId || ''),
    uploadFilename: String(session.uploadFilename || ''),
    uploadRequested: Boolean(session.uploadRequested),
    uploadAttempts: Math.max(0, Number(session.uploadAttempts || 0)),
    automaticRetryCount: Math.max(0, Number(session.automaticRetryCount || 0)),
    lastUploadError: String(session.lastUploadError || ''),
    clientVersion: String(session.clientVersion || '')
  };
}

function mergeSession(existing, incoming) {
  const oldSession = normalizeSession(existing);
  const newSession = normalizeSession(incoming);
  const oldTime = sessionTime(oldSession);
  const newTime = sessionTime(newSession);
  const newer = newTime >= oldTime ? newSession : oldSession;
  const older = newer === newSession ? oldSession : newSession;
  return normalizeSession({
    ...older,
    ...newer,
    uploaded: Boolean(oldSession.uploaded || newSession.uploaded),
    uploadedAt: newSession.uploadedAt || oldSession.uploadedAt,
    uploadId: newSession.uploadId || oldSession.uploadId,
    uploadFilename: newSession.uploadFilename || oldSession.uploadFilename,
    uploadRequested: Boolean(oldSession.uploadRequested || newSession.uploadRequested),
    completed: Boolean(oldSession.completed || newSession.completed),
    completedAt: newSession.completedAt || oldSession.completedAt
  });
}

function sessionTime(session) {
  return Date.parse(session?.lastActivityAt || session?.completedAt || session?.startedAt || '') || 0;
}

function pruneSessions(sessions) {
  const sorted = mergeSessionLists(sessions, []);
  const byOwner = new Map();
  sorted.forEach((session) => {
    const owner = String(session.anonymousUserId || 'unknown');
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    if (byOwner.get(owner).length < MAX_SESSIONS_PER_OWNER) byOwner.get(owner).push(session);
  });
  return [...byOwner.values()].flat().sort((a, b) => sessionTime(b) - sessionTime(a)).slice(0, MAX_TOTAL_SESSIONS);
}

function writeSessions(sessions) {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    return true;
  } catch (error) {
    // Prefer losing the oldest completed records over the current recoverable session.
    const trimmed = [...sessions]
      .sort((a, b) => Number(Boolean(a.completed)) - Number(Boolean(b.completed)) || sessionTime(b) - sessionTime(a))
      .slice(0, Math.max(10, Math.floor(sessions.length / 2)));
    try {
      store.setItem(SESSIONS_KEY, JSON.stringify(trimmed));
      return true;
    } catch {
      console.warn('Patient Trainer history could not be persisted in browser storage.', error);
      return false;
    }
  }
}
