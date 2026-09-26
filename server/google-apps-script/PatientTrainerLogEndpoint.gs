var PT_TIME_ZONE = 'Europe/Bratislava';
var PT_MAX_BYTES = 512 * 1024;
var PT_ALLOWED_MODES = { practice: true, teaching: true, exam: true };
var PT_ALLOWED_TYPES = { anamnesis: true, anamnesis_examination: true };
var PT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var PT_ANON_RE = /^pt-(?:browser|account)-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function doGet() {
  return ptJson_({ ok: false, error: 'POST required.' });
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? String(e.postData.contents) : '';
    if (!raw || raw.length > PT_MAX_BYTES) return ptJson_({ ok: false, error: 'Invalid or oversized request.' });

    if (!ptRateAllowed_()) return ptJson_({ ok: false, error: 'Rate limit exceeded.' });

    var wrapper;
    try { wrapper = JSON.parse(raw); } catch (parseError) { return ptJson_({ ok: false, error: 'Invalid JSON.' }); }
    var properties = PropertiesService.getScriptProperties();
    var expectedSecret = String(properties.getProperty('PATIENT_TRAINER_UPLOAD_SHARED_SECRET') || '');
    if (!expectedSecret || !ptSafeEqual_(String(wrapper.sharedSecret || ''), expectedSecret)) {
      return ptJson_({ ok: false, error: 'Unauthorized.' });
    }

    var checked = ptValidate_(wrapper.payload);
    if (checked.error) return ptJson_({ ok: false, error: checked.error });
    var payload = checked.value;

    var folderId = String(properties.getProperty('PATIENT_TRAINER_DRIVE_FOLDER_ID') || '');
    if (!folderId) return ptJson_({ ok: false, error: 'Target Drive folder is not configured.' });
    var folder = DriveApp.getFolderById(folderId);

    var suffix = '_' + payload.sessionId + '.json';
    var files = folder.getFiles();
    while (files.hasNext()) {
      var existing = files.next();
      if (String(existing.getName()).slice(-suffix.length) === suffix) {
        return ptJson_({
          ok: true,
          sessionId: payload.sessionId,
          receivedAt: new Date().toISOString(),
          filename: existing.getName(),
          duplicate: true
        });
      }
    }

    var completed = new Date(payload.completedAt);
    var timestamp = Utilities.formatDate(completed, PT_TIME_ZONE, 'yyyy-MM-dd_HH-mm-ss');
    var safeSessionId = payload.sessionId.replace(/[^0-9a-f-]/ig, '');
    var filename = 'PatientTrainer_' + timestamp + '_' + safeSessionId + '.json';
    var blob = Utilities.newBlob(JSON.stringify(payload, null, 2), 'application/json', filename);
    var file = folder.createFile(blob);

    return ptJson_({
      ok: true,
      sessionId: payload.sessionId,
      receivedAt: new Date().toISOString(),
      filename: filename
    });
  } catch (error) {
    console.error(error);
    return ptJson_({ ok: false, error: 'Server-side Drive upload failed.' });
  }
}

function ptValidate_(payload) {
  if (!payload || typeof payload !== 'object') return { error: 'Payload object required.' };
  if (Number(payload.schemaVersion) !== 1) return { error: 'Unsupported schemaVersion.' };
  var sessionId = String(payload.sessionId || '');
  var anonymousUserId = String(payload.anonymousUserId || '');
  var mode = String(payload.mode || '').toLowerCase();
  var trainerType = String(payload.trainerType || '').toLowerCase();
  if (!PT_UUID_RE.test(sessionId)) return { error: 'Invalid sessionId.' };
  if (!PT_ANON_RE.test(anonymousUserId)) return { error: 'Invalid anonymousUserId.' };
  if (!String(payload.caseId || '')) return { error: 'caseId is required.' };
  if (!PT_ALLOWED_MODES[mode]) return { error: 'Invalid mode.' };
  if (!PT_ALLOWED_TYPES[trainerType]) return { error: 'Invalid trainerType.' };
  if (String(payload.caseId || '').length > 120 || String(payload.caseName || '').length > 200) return { error: 'Case fields are too long.' };
  if (String(payload.anonymousUserId || '').length > 100 || String(payload.clientVersion || '').length > 100) return { error: 'Metadata field is too long.' };
  if (!ptValidDate_(payload.startedAt) || !ptValidDate_(payload.completedAt)) return { error: 'Invalid timestamps.' };
  if (new Date(payload.completedAt).getTime() < new Date(payload.startedAt).getTime()) return { error: 'Invalid timestamp order.' };
  if (!Array.isArray(payload.messages) || payload.messages.length > 1000) return { error: 'Invalid messages array.' };
  if (!Array.isArray(payload.examinations) || payload.examinations.length > 500) return { error: 'Invalid examinations array.' };
  if (!Array.isArray(payload.fallbackQuestions) || payload.fallbackQuestions.length > 500) return { error: 'Invalid fallbackQuestions array.' };
  if (!Array.isArray(payload.coveredTopics) || payload.coveredTopics.length > 300) return { error: 'Invalid coveredTopics array.' };
  if (!Array.isArray(payload.uncoveredTopics) || payload.uncoveredTopics.length > 300) return { error: 'Invalid uncoveredTopics array.' };

  for (var i = 0; i < payload.messages.length; i += 1) {
    var message = payload.messages[i] || {};
    if (message.speaker !== 'student' && message.speaker !== 'patient') return { error: 'Invalid message speaker.' };
    if (!ptValidDate_(message.timestamp) || String(message.text || '').length > 6000) return { error: 'Invalid message.' };
  }
  var serialized = JSON.stringify(payload);
  if (serialized.length > PT_MAX_BYTES) return { error: 'Payload is too large.' };
  return { value: payload };
}

function ptRateAllowed_() {
  var cache = CacheService.getScriptCache();
  var minute = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmm');
  var key = 'pt_rate_' + minute;
  var count = Number(cache.get(key) || '0') + 1;
  cache.put(key, String(count), 120);
  return count <= 60;
}

function ptValidDate_(value) {
  var date = new Date(String(value || ''));
  return !isNaN(date.getTime());
}

function ptSafeEqual_(left, right) {
  if (left.length !== right.length) return false;
  var mismatch = 0;
  for (var i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

function ptJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
