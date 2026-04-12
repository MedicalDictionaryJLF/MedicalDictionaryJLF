export const ATTACHMENT_STATUS = Object.freeze({
  LOCAL_ONLY: "local-only",
  SYNCING: "syncing",
  SYNCED: "synced",
  DELETE_PENDING: "delete-pending",
  ERROR: "error"
});

export const ATTACHMENT_PENDING_ACTION = Object.freeze({
  NONE: "none",
  UPLOAD: "upload",
  DELETE: "delete"
});

export function normalizeAttachmentStatus(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (value === ATTACHMENT_STATUS.SYNCING || value === "uploading") return ATTACHMENT_STATUS.SYNCING;
  if (value === ATTACHMENT_STATUS.SYNCED || value === "synced") return ATTACHMENT_STATUS.SYNCED;
  if (value === ATTACHMENT_STATUS.DELETE_PENDING) return ATTACHMENT_STATUS.DELETE_PENDING;
  if (value === ATTACHMENT_STATUS.ERROR || value === "failed") return ATTACHMENT_STATUS.ERROR;
  return ATTACHMENT_STATUS.LOCAL_ONLY;
}

export function normalizePendingAction(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (value === ATTACHMENT_PENDING_ACTION.UPLOAD) return ATTACHMENT_PENDING_ACTION.UPLOAD;
  if (value === ATTACHMENT_PENDING_ACTION.DELETE) return ATTACHMENT_PENDING_ACTION.DELETE;
  return ATTACHMENT_PENDING_ACTION.NONE;
}

export function attachmentHasPendingUpload(record) {
  if (!record) return false;
  return normalizePendingAction(record.pendingAction) === ATTACHMENT_PENDING_ACTION.UPLOAD;
}

export function attachmentHasPendingDelete(record) {
  if (!record) return false;
  return normalizePendingAction(record.pendingAction) === ATTACHMENT_PENDING_ACTION.DELETE;
}

export function attachmentHasPendingOperation(record) {
  return attachmentHasPendingUpload(record) || attachmentHasPendingDelete(record);
}

export function countPendingAttachmentOperations(records) {
  return (Array.isArray(records) ? records : []).filter(attachmentHasPendingOperation).length;
}

export function summarizeAttachmentOperations(records) {
  const rows = Array.isArray(records) ? records : [];
  let pendingUploads = 0;
  let pendingDeletes = 0;
  let errors = 0;
  for (const row of rows) {
    const status = normalizeAttachmentStatus(row && row.status);
    if (attachmentHasPendingUpload(row)) pendingUploads += 1;
    if (attachmentHasPendingDelete(row)) pendingDeletes += 1;
    if (status === ATTACHMENT_STATUS.ERROR) errors += 1;
  }
  return {
    pendingUploads,
    pendingDeletes,
    pendingCount: pendingUploads + pendingDeletes,
    errors
  };
}

export function upsertRetryQueueItem(queue, item) {
  const rows = Array.isArray(queue) ? [...queue] : [];
  const next = item && typeof item === "object" ? item : null;
  if (!next || !next.id) return rows;
  const index = rows.findIndex((row) => row && row.id === next.id && row.action === next.action);
  if (index >= 0) rows[index] = next;
  else rows.push(next);
  rows.sort((a, b) => Number(a && a.dueAt || 0) - Number(b && b.dueAt || 0));
  return rows;
}

export function removeRetryQueueItem(queue, match) {
  const rows = Array.isArray(queue) ? queue : [];
  const id = String(match && match.id || "");
  const action = normalizePendingAction(match && match.action);
  return rows.filter((row) => !(String(row && row.id || "") === id && normalizePendingAction(row && row.action) === action));
}

export function getDueRetryQueueItems(queue, now = Date.now()) {
  const rows = Array.isArray(queue) ? queue : [];
  return rows.filter((row) => Number(row && row.dueAt || 0) <= now);
}
