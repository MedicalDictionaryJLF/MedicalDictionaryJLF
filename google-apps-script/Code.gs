/**
 * Patient Trainer private Google Apps Script receiver.
 * Script properties: PATIENT_TRAINER_UPLOAD_SHARED_SECRET and PATIENT_TRAINER_LOG_FOLDER_ID.
 * Deploy as Web App executing as the script owner. Use /exec URL on Vercel only.
 */
function patientTrainerJson_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var properties = PropertiesService.getScriptProperties();
    var correctSecret = properties.getProperty('PATIENT_TRAINER_UPLOAD_SHARED_SECRET');
    var folderId = properties.getProperty('PATIENT_TRAINER_LOG_FOLDER_ID');
    if (!correctSecret || !folderId) return patientTrainerJson_({ ok: false, error: 'Not configured' });
    if (body.action !== 'patient-trainer-log' || body.secret !== correctSecret) {
      return patientTrainerJson_({ ok: false, error: 'Not authorized' });
    }
    var session = body.session;
    if (!session || !/^[0-9a-f-]{36}$/i.test(String(session.sessionId || '')) || !session.completedAt) {
      return patientTrainerJson_({ ok: false, error: 'Invalid session' });
    }
    var filename = 'patient-trainer-' + session.sessionId + '.json';
    locked = lock.tryLock(15000);
    if (!locked) return patientTrainerJson_({ ok: false, error: 'Storage busy' });
    var folder = DriveApp.getFolderById(folderId);
    var existing = folder.getFilesByName(filename);
    var file;
    if (existing.hasNext()) {
      file = existing.next();
    } else {
      file = folder.createFile(filename, JSON.stringify({
        receivedAt: new Date().toISOString(),
        session: session
      }, null, 2), MimeType.PLAIN_TEXT);
    }
    return patientTrainerJson_({
      ok: true, stored: true, sessionId: session.sessionId,
      filename: filename, uploadId: file.getId(), receivedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Patient Trainer receiver failed:', error && error.name || 'Error');
    return patientTrainerJson_({ ok: false, error: 'Storage unavailable' });
  } finally {
    if (locked) lock.releaseLock();
  }
}
