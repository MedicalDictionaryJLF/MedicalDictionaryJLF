const DB_NAME = "mdict_user_data_v1";
const DB_VERSION = 1;

function openDb(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains("decks")){
        const store = db.createObjectStore("decks", { keyPath: "id" });
        store.createIndex("name", "name", { unique: false });
      }
      if(!db.objectStoreNames.contains("cards")){
        const store = db.createObjectStore("cards", { keyPath: "id" });
        store.createIndex("deckId", "deckId", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if(!db.objectStoreNames.contains("scheduling")){
        const store = db.createObjectStore("scheduling", { keyPath: "key" });
        store.createIndex("deckId", "deckId", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx){
  return new Promise((resolve, reject)=>{
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
}

function reqToPromise(req){
  return new Promise((resolve, reject)=>{
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function clone(v){
  return JSON.parse(JSON.stringify(v));
}

function nowIso(){
  return new Date().toISOString();
}

function makeId(prefix){
  if(typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function"){
    return `${prefix}${crypto.randomUUID()}`;
  }
  return `${prefix}${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

export function createAppStorage(){
  let db = null;
  let ready = false;
  let pendingWrite = Promise.resolve();
  const cache = {
    decks: [],
    cards: [],
    scheduling: {}
  };

  function queueWrite(work){
    pendingWrite = pendingWrite.then(work).catch((err)=>{
      console.warn("storage write failed:", err);
    });
    return pendingWrite;
  }

  async function readAllFromStore(storeName){
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const rows = await reqToPromise(store.getAll());
    await txDone(tx);
    return Array.isArray(rows) ? rows : [];
  }

  function ensureReady(){
    if(!ready) throw new Error("Storage not initialized");
  }

  async function init(){
    if(ready) return;
    db = await openDb();
    const [decks, cards, schedulingRows] = await Promise.all([
      readAllFromStore("decks"),
      readAllFromStore("cards"),
      readAllFromStore("scheduling")
    ]);
    cache.decks = decks.map(clone);
    cache.cards = cards.map(row => ({ ...clone(row), tags: Array.isArray(row.tags) ? row.tags : [] }));
    const scheduling = {};
    for(const row of schedulingRows){
      if(row && row.key) scheduling[String(row.key)] = clone(row);
    }
    cache.scheduling = scheduling;
    ready = true;
  }

  function getDecksSync(){
    ensureReady();
    return cache.decks.map(clone);
  }

  function getCardsSync(){
    ensureReady();
    return cache.cards.map(clone);
  }

  function getCardsByDeckSync(deckId){
    ensureReady();
    return cache.cards.filter(c => String(c.deckId || "") === String(deckId || "")).map(clone);
  }

  function getSchedulingRecordSync(key){
    ensureReady();
    return cache.scheduling[String(key || "")] ? clone(cache.scheduling[String(key || "")]) : null;
  }

  function getSchedulingMapSync(){
    ensureReady();
    return clone(cache.scheduling);
  }

  function createDeck({ id, name, termIds = [] }){
    ensureReady();
    const row = {
      id: String(id || makeId("deck:")),
      name: String(name || "").trim() || "Custom deck",
      termIds: Array.isArray(termIds) ? [...new Set(termIds.map(x => String(x || "").trim()).filter(Boolean))] : [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    cache.decks.unshift(row);
    queueWrite(async ()=>{
      const tx = db.transaction("decks", "readwrite");
      tx.objectStore("decks").put(row);
      await txDone(tx);
    });
    return clone(row);
  }

  function updateDeck(deckId, patch){
    ensureReady();
    const id = String(deckId || "");
    const idx = cache.decks.findIndex(d => d && String(d.id || "") === id);
    if(idx < 0) return null;
    const current = cache.decks[idx];
    const next = {
      ...current,
      ...(patch || {}),
      updatedAt: nowIso()
    };
    if(!Array.isArray(next.termIds)) next.termIds = [];
    next.termIds = [...new Set(next.termIds.map(x => String(x || "").trim()).filter(Boolean))];
    cache.decks[idx] = next;
    queueWrite(async ()=>{
      const tx = db.transaction("decks", "readwrite");
      tx.objectStore("decks").put(next);
      await txDone(tx);
    });
    return clone(next);
  }

  function deleteDeck(deckId){
    ensureReady();
    const id = String(deckId || "");
    const hit = cache.decks.find(d => d && String(d.id || "") === id);
    if(!hit) return false;
    cache.decks = cache.decks.filter(d => String((d && d.id) || "") !== id);
    const removedCardIds = new Set(cache.cards.filter(c => String(c.deckId || "") === id).map(c => String(c.id || "")));
    cache.cards = cache.cards.filter(c => String(c.deckId || "") !== id);
    const prefix = `custom:${id}::`;
    Object.keys(cache.scheduling).forEach(key => {
      if(key.startsWith(prefix)) delete cache.scheduling[key];
    });
    queueWrite(async ()=>{
      const tx = db.transaction(["decks", "cards", "scheduling"], "readwrite");
      tx.objectStore("decks").delete(id);
      for(const cardId of removedCardIds){
        tx.objectStore("cards").delete(cardId);
      }
      const schedStore = tx.objectStore("scheduling");
      const all = await reqToPromise(schedStore.getAllKeys());
      for(const key of all){
        if(String(key || "").startsWith(prefix)) schedStore.delete(key);
      }
      await txDone(tx);
    });
    return true;
  }

  function upsertCard(card){
    ensureReady();
    const now = nowIso();
    const row = {
      id: String((card && card.id) || makeId("card:")),
      deckId: String((card && card.deckId) || ""),
      frontText: String((card && card.frontText) || "").trim(),
      backText: String((card && card.backText) || "").trim(),
      notes: String((card && card.notes) || "").trim(),
      tags: Array.isArray(card && card.tags) ? [...new Set(card.tags.map(t => String(t || "").trim()).filter(Boolean))] : [],
      createdAt: String((card && card.createdAt) || now),
      updatedAt: now
    };
    const idx = cache.cards.findIndex(c => c && String(c.id || "") === row.id);
    if(idx >= 0) cache.cards[idx] = row;
    else cache.cards.unshift(row);
    queueWrite(async ()=>{
      const tx = db.transaction("cards", "readwrite");
      tx.objectStore("cards").put(row);
      await txDone(tx);
    });
    return clone(row);
  }

  function deleteCard(cardId){
    ensureReady();
    const id = String(cardId || "");
    const hit = cache.cards.find(c => c && String(c.id || "") === id);
    if(!hit) return false;
    cache.cards = cache.cards.filter(c => String((c && c.id) || "") !== id);
    const termId = `customcard:${id}`;
    Object.keys(cache.scheduling).forEach(key => {
      if(key.includes(`::${termId}`)) delete cache.scheduling[key];
    });
    queueWrite(async ()=>{
      const tx = db.transaction(["cards", "scheduling"], "readwrite");
      tx.objectStore("cards").delete(id);
      const schedStore = tx.objectStore("scheduling");
      const keys = await reqToPromise(schedStore.getAllKeys());
      for(const key of keys){
        if(String(key || "").includes(`::${termId}`)) schedStore.delete(key);
      }
      await txDone(tx);
    });
    return true;
  }

  function upsertScheduling(record){
    ensureReady();
    const key = String((record && record.key) || "");
    if(!key) return null;
    const row = { ...(record || {}), key, updatedAt: nowIso() };
    cache.scheduling[key] = row;
    queueWrite(async ()=>{
      const tx = db.transaction("scheduling", "readwrite");
      tx.objectStore("scheduling").put(row);
      await txDone(tx);
    });
    return clone(row);
  }

  function removeSchedulingByPrefix(prefix){
    ensureReady();
    const p = String(prefix || "");
    if(!p) return 0;
    let count = 0;
    Object.keys(cache.scheduling).forEach(key => {
      if(key.startsWith(p)){
        delete cache.scheduling[key];
        count += 1;
      }
    });
    queueWrite(async ()=>{
      const tx = db.transaction("scheduling", "readwrite");
      const store = tx.objectStore("scheduling");
      const keys = await reqToPromise(store.getAllKeys());
      for(const key of keys){
        if(String(key || "").startsWith(p)) store.delete(key);
      }
      await txDone(tx);
    });
    return count;
  }

  function dumpSnapshot(){
    ensureReady();
    return {
      decks: getDecksSync(),
      cards: getCardsSync(),
      scheduling: getSchedulingMapSync()
    };
  }

  return {
    init,
    getDecksSync,
    getCardsSync,
    getCardsByDeckSync,
    getSchedulingRecordSync,
    getSchedulingMapSync,
    createDeck,
    updateDeck,
    deleteDeck,
    upsertCard,
    deleteCard,
    upsertScheduling,
    removeSchedulingByPrefix,
    dumpSnapshot
  };
}
