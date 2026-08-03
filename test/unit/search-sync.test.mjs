import assert from "node:assert/strict";
import test from "node:test";
import { createSearchService } from "../../assets/js/services/search-service.js";
import {
  getDueRetryQueueItems,
  removeRetryQueueItem,
  upsertRetryQueueItem,
} from "../../assets/js/sync.js";

test("search scoring preserves exact, prefix, contains, and ATC behavior", () => {
  const rows = [
    {
      id: "exact",
      english_translation: "heart",
      __lc: { english_translation: "heart" },
    },
    {
      id: "prefix",
      english_translation: "heartbeat",
      __lc: { english_translation: "heartbeat" },
    },
    {
      id: "contains",
      english_translation: "healthy heart",
      __lc: { english_translation: "healthy heart" },
    },
  ];
  const service = createSearchService({
    normalizeSearchText: (value) =>
      String(value || "")
        .trim()
        .toLowerCase(),
    getLoadedRows: () => rows,
    isRowInSelection: () => true,
    getLocalTerms: () => [],
    ensureUserSearchLowercaseCache: () => ({}),
    matchAnyHeader: () => false,
    searchPharmacology: () => [],
  });
  const result = service.collectMainSearchResults(
    "heart",
    "all",
    "english_translation",
    "english",
  );
  assert.deepEqual(
    result.results.map((item) => item.row.id),
    ["exact", "prefix", "contains"],
  );
  assert.equal(service.queryLooksLikeAtcCode("C08CA01"), true);
  assert.equal(service.queryLooksLikeAtcCode("aspirin"), false);
});

test("retry queue inserts, replaces, orders, filters, and removes operations", () => {
  let queue = upsertRetryQueueItem([], {
    id: "b",
    action: "upload",
    dueAt: 20,
  });
  queue = upsertRetryQueueItem(queue, { id: "a", action: "upload", dueAt: 10 });
  assert.deepEqual(
    queue.map((item) => item.id),
    ["a", "b"],
  );

  queue = upsertRetryQueueItem(queue, { id: "a", action: "upload", dueAt: 30 });
  assert.equal(queue.length, 2);
  assert.deepEqual(
    queue.map((item) => item.id),
    ["b", "a"],
  );
  assert.deepEqual(
    getDueRetryQueueItems(queue, 20).map((item) => item.id),
    ["b"],
  );

  queue = removeRetryQueueItem(queue, { id: "b", action: "upload" });
  assert.deepEqual(
    queue.map((item) => item.id),
    ["a"],
  );
});
