// Public frontend configuration only. Never put Google credentials, OAuth tokens,
// service-account keys, Drive folder IDs, Apps Script secrets, or other reusable secrets here.
// Change only this public application endpoint if the Patient Trainer API is hosted elsewhere.
export const PATIENT_TRAINER_LOG_ENDPOINT = String(
  globalThis.PATIENT_TRAINER_LOG_ENDPOINT || 'https://medical-dictionary-jlf.vercel.app/api/patient-trainer-log'
).trim();
export const PATIENT_TRAINER_CLIENT_VERSION = '2.4.0-session-history';
export const PATIENT_TRAINER_AUTO_RETRY_LIMIT = 3;
