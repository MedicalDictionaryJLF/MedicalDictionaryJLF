import { resolveBundledDataUrl } from "./core/app-paths.js";

const PROGRESS_KEY = "pharmacology_flashcard_progress_v1";
const MOBILE_REVIEW_STYLE_ID = "pharmacology-review-mobile-style";
const SWIPE_MIN_DISTANCE = 72;
const SWIPE_MAX_VERTICAL_DRIFT = 80;
const DAY_NAMES = {
  1: "Day 1: General pharmacology / ADME",
  2: "Day 2: Autonomic + cardiovascular",
  3: "Day 3: CNS + pain + poisoning",
  4: "Day 4: Anti-infectives + respiratory + GI",
  5: "Day 5: Endocrine + cancer + immunology"
};
const CARD_DATA_FILES = [
  "pharmacology-course/review_cards.json",
  "pharmacology-course/review_cards_exam_additions.json"
];

const initialProgress = loadProgress();
const state = {
  loaded: false,
  bound: false,
  cards: [],
  deck: [],
  index: 0,
  showingBack: false,
  progress: initialProgress.cards,
  resetAt: initialProgress.resetAt,
  onProgressChange: null,
  swipe: null,
  lastSwipeAt: 0
};

function byId(id) {
  return document.getElementById(id);
}

function stableId(front, back) {
  let hash = 2166136261;
  const text = `${front.trim()}\n---\n${back.trim()}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `card-${(hash >>> 0).toString(16)}`;
}

function timeMs(value) {
  const valueMs = new Date(String(value || "")).getTime();
  return Number.isFinite(valueMs) ? valueMs : 0;
}

function ensureReviewMobileStyles() {
  if (typeof document === "undefined" || document.getElementById(MOBILE_REVIEW_STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = MOBILE_REVIEW_STYLE_ID;
  link.rel = "stylesheet";
  link.href = "assets/css/pharmacology-review-mobile.css?v=1";
  document.head.appendChild(link);
}

export function normalizePharmacologyReviewProgress(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const cardsInput = input.cards && typeof input.cards === "object" ? input.cards : input;
  const resetAt = String(input.resetAt || "");
  const resetMs = timeMs(resetAt);
  const cards = {};
  for (const [id, row] of Object.entries(cardsInput || {})) {
    if (!id || id === "resetAt" || id === "updatedAt" || id === "cards" || !row || typeof row !== "object") continue;
    const updatedAt = String(row.updatedAt || row.updated_at || "");
    if (resetMs && timeMs(updatedAt) <= resetMs) continue;
    cards[id] = {
      reviewed: !!row.reviewed,
      lastResult: row.lastResult === "wrong" ? "wrong" : "correct",
      updatedAt
    };
  }
  const latestCardMs = Math.max(0, ...Object.values(cards).map(row => timeMs(row.updatedAt)));
  return {
    cards,
    resetAt,
    updatedAt: String(input.updatedAt || new Date(Math.max(resetMs, latestCardMs) || Date.now()).toISOString())
  };
}

export function mergePharmacologyReviewProgress(localProgress, remoteProgress) {
  const local = normalizePharmacologyReviewProgress(localProgress);
  const remote = normalizePharmacologyReviewProgress(remoteProgress);
  const resetAt = timeMs(local.resetAt) >= timeMs(remote.resetAt) ? local.resetAt : remote.resetAt;
  const resetMs = timeMs(resetAt);
  const cards = {};
  for (const id of new Set([...Object.keys(remote.cards), ...Object.keys(local.cards)])) {
    const localCard = local.cards[id];
    const remoteCard = remote.cards[id];
    const winner = !remoteCard || (localCard && timeMs(localCard.updatedAt) >= timeMs(remoteCard.updatedAt)) ? localCard : remoteCard;
    if (winner && timeMs(winner.updatedAt) > resetMs) cards[id] = { ...winner };
  }
  return { cards, resetAt, updatedAt: new Date().toISOString() };
}

function loadProgress() {
  try {
    return normalizePharmacologyReviewProgress(JSON.parse(globalThis.localStorage?.getItem(PROGRESS_KEY) || "{}"));
  } catch (error) {
    return normalizePharmacologyReviewProgress({});
  }
}

function saveProgress({ notify = true } = {}) {
  const snapshot = getPharmacologyReviewProgress();
  try {
    globalThis.localStorage?.setItem(PROGRESS_KEY, JSON.stringify(snapshot));
  } catch (error) {}
  if (notify && typeof state.onProgressChange === "function") state.onProgressChange(snapshot);
}

export function getPharmacologyReviewProgress() {
  return normalizePharmacologyReviewProgress({
    cards: state.progress,
    resetAt: state.resetAt,
    updatedAt: new Date().toISOString()
  });
}

export function setPharmacologyReviewProgress(progress, { notify = false } = {}) {
  const normalized = normalizePharmacologyReviewProgress(progress);
  state.progress = normalized.cards;
  state.resetAt = normalized.resetAt;
  saveProgress({ notify });
  if (state.bound) reloadDeck();
}

export function normalizeCards(payload) {
  if (!Array.isArray(payload)) return [];
  return payload
    .filter(card => card && card.front && card.back && DAY_NAMES[Number(card.day)])
    .map(card => ({
      id: stableId(String(card.front), String(card.back)),
      front: String(card.front),
      back: String(card.back),
      day: Number(card.day)
    }));
}

function mergeCards(cardGroups) {
  const seen = new Set();
  const cards = [];
  for (const card of cardGroups.flat()) {
    if (!card?.id || seen.has(card.id)) continue;
    seen.add(card.id);
    cards.push(card);
  }
  return cards;
}

async function loadCardFile(path) {
  const response = await fetch(resolveBundledDataUrl(path));
  if (!response.ok) throw new Error(`Failed to load pharmacology flashcards from ${path}: ${response.status}`);
  return normalizeCards(await response.json());
}

function shuffle(cards) {
  const next = [...cards];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}

function selectedDays() {
  return [...document.querySelectorAll("[data-pharm-review-day]:checked")].map(input => Number(input.value));
}

function reloadDeck() {
  const days = new Set(selectedDays());
  const hideReviewed = !!byId("pharm-review-hide-reviewed")?.checked;
  const wrongOnly = !!byId("pharm-review-wrong-only")?.checked;
  let cards = state.cards.filter(card => days.has(card.day));
  if (wrongOnly) cards = cards.filter(card => state.progress[card.id]?.lastResult === "wrong");
  else if (hideReviewed) cards = cards.filter(card => !state.progress[card.id]?.reviewed);
  if (byId("pharm-review-shuffle")?.checked) cards = shuffle(cards);
  else cards.sort((a, b) => a.day - b.day || a.front.localeCompare(b.front));
  state.deck = cards;
  state.index = 0;
  state.showingBack = false;
  clearSwipeStyles();
  render();
}

function render() {
  const card = state.deck[state.index];
  const reviewed = Object.values(state.progress).filter(item => item?.reviewed).length;
  const wrong = Object.values(state.progress).filter(item => item?.lastResult === "wrong").length;
  if (byId("pharm-review-total")) byId("pharm-review-total").textContent = String(state.cards.length);
  if (byId("pharm-review-count")) byId("pharm-review-count").textContent = String(state.deck.length);
  if (byId("pharm-review-wrong-count")) byId("pharm-review-wrong-count").textContent = String(wrong);
  if (byId("pharm-review-position")) byId("pharm-review-position").textContent = card ? `${state.index + 1} / ${state.deck.length}` : "0 / 0";
  if (byId("pharm-review-progress")) byId("pharm-review-progress").style.width = card ? `${((state.index + 1) / state.deck.length) * 100}%` : "0%";
  if (byId("pharm-review-side")) byId("pharm-review-side").textContent = state.showingBack ? "Back" : "Front";
  if (byId("pharm-review-day")) byId("pharm-review-day").textContent = card ? DAY_NAMES[card.day] : "";
  if (byId("pharm-review-content")) {
    byId("pharm-review-content").textContent = card
      ? (state.showingBack ? card.back : card.front)
      : (reviewed ? "No cards selected. Change the filters or reset progress to review completed cards." : "Select at least one revision day.");
  }
}

function flipCard() {
  if (!state.deck.length) return;
  state.showingBack = !state.showingBack;
  render();
}

function moveCard(offset) {
  if (!state.deck.length) return;
  state.index = (state.index + offset + state.deck.length) % state.deck.length;
  state.showingBack = false;
  clearSwipeStyles();
  render();
}

function markCard(result) {
  const card = state.deck[state.index];
  if (!card) return;
  state.progress[card.id] = { reviewed: true, lastResult: result, updatedAt: new Date().toISOString() };
  saveProgress();
  if (byId("pharm-review-hide-reviewed")?.checked || byId("pharm-review-wrong-only")?.checked) reloadDeck();
  else moveCard(1);
}

async function toggleFullscreen() {
  const study = byId("pharm-review-study");
  if (!study) return;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (study.requestFullscreen) await study.requestFullscreen({ navigationUI: "hide" });
  } catch (error) {
    try {
      if (study.webkitRequestFullscreen) study.webkitRequestFullscreen();
    } catch (fallbackError) {}
  }
}

function clearSwipeStyles() {
  const card = byId("pharm-review-card");
  if (!card) return;
  card.classList.remove("is-swiping", "is-swipe-tracking", "is-swipe-reset", "is-swipe-away");
  card.style.transform = "";
  card.style.opacity = "";
}

function setSwipeTransform(deltaX) {
  const card = byId("pharm-review-card");
  if (!card) return;
  const width = Math.max(1, card.getBoundingClientRect().width);
  const clamped = Math.max(-width, Math.min(width, deltaX));
  const rotate = Math.max(-8, Math.min(8, clamped / width * 9));
  const opacity = Math.max(0.72, 1 - Math.abs(clamped) / width * 0.25);
  card.style.transform = `translateX(${clamped}px) rotate(${rotate}deg)`;
  card.style.opacity = String(opacity);
}

function finishSwipe(direction) {
  const card = byId("pharm-review-card");
  if (!card) return;
  state.lastSwipeAt = Date.now();
  card.classList.remove("is-swipe-tracking");
  card.classList.add("is-swipe-away");
  const width = Math.max(320, card.getBoundingClientRect().width);
  card.style.transform = `translateX(${direction * width * 1.15}px) rotate(${direction * 9}deg)`;
  card.style.opacity = "0";
  window.setTimeout(() => moveCard(direction > 0 ? -1 : 1), 150);
}

function resetSwipe() {
  const card = byId("pharm-review-card");
  if (!card) return;
  card.classList.remove("is-swipe-tracking");
  card.classList.add("is-swipe-reset");
  card.style.transform = "";
  card.style.opacity = "";
  window.setTimeout(() => card.classList.remove("is-swiping", "is-swipe-reset"), 180);
}

function onSwipePointerDown(event) {
  if (!state.deck.length || event.pointerType === "mouse" && event.button !== 0) return;
  const card = byId("pharm-review-card");
  if (!card || event.target?.closest?.("button,input,select,textarea,label")) return;
  state.swipe = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    currentX: event.clientX,
    currentY: event.clientY,
    active: false,
    vertical: false
  };
  card.setPointerCapture?.(event.pointerId);
}

function onSwipePointerMove(event) {
  if (!state.swipe || state.swipe.pointerId !== event.pointerId) return;
  const swipe = state.swipe;
  swipe.currentX = event.clientX;
  swipe.currentY = event.clientY;
  const deltaX = swipe.currentX - swipe.startX;
  const deltaY = swipe.currentY - swipe.startY;
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  if (!swipe.active && !swipe.vertical) {
    if (absY > 12 && absY > absX * 1.15) {
      swipe.vertical = true;
      return;
    }
    if (absX > 14 && absX > absY * 1.1) {
      swipe.active = true;
      const card = byId("pharm-review-card");
      card?.classList.add("is-swiping", "is-swipe-tracking");
    }
  }
  if (!swipe.active) return;
  event.preventDefault();
  setSwipeTransform(deltaX);
}

function onSwipePointerEnd(event) {
  if (!state.swipe || state.swipe.pointerId !== event.pointerId) return;
  const swipe = state.swipe;
  state.swipe = null;
  if (!swipe.active) return;
  const deltaX = swipe.currentX - swipe.startX;
  const deltaY = swipe.currentY - swipe.startY;
  const card = byId("pharm-review-card");
  card?.releasePointerCapture?.(event.pointerId);
  const threshold = Math.min(Math.max(SWIPE_MIN_DISTANCE, (card?.getBoundingClientRect().width || 320) * 0.22), 140);
  if (Math.abs(deltaX) >= threshold && Math.abs(deltaY) <= SWIPE_MAX_VERTICAL_DRIFT) finishSwipe(Math.sign(deltaX));
  else resetSwipe();
}

function renderDayFilters() {
  const container = byId("pharm-review-days");
  if (!container || container.childElementCount) return;
  container.innerHTML = Object.entries(DAY_NAMES).map(([day, label]) => `
    <label><input type="checkbox" value="${day}" data-pharm-review-day checked /> <span>${label}</span></label>
  `).join("");
}

function bind() {
  if (state.bound) return;
  state.bound = true;
  ensureReviewMobileStyles();
  renderDayFilters();
  byId("pharm-review-days")?.addEventListener("change", reloadDeck);
  ["pharm-review-shuffle", "pharm-review-hide-reviewed", "pharm-review-wrong-only"].forEach(id => byId(id)?.addEventListener("change", reloadDeck));
  byId("pharm-review-previous")?.addEventListener("click", () => moveCard(-1));
  byId("pharm-review-next")?.addEventListener("click", () => moveCard(1));
  byId("pharm-review-flip")?.addEventListener("click", flipCard);
  byId("pharm-review-fullscreen")?.addEventListener("click", toggleFullscreen);
  byId("pharm-review-card")?.addEventListener("click", () => {
    if (Date.now() - state.lastSwipeAt < 260) return;
    flipCard();
  });
  byId("pharm-review-card")?.addEventListener("pointerdown", onSwipePointerDown);
  byId("pharm-review-card")?.addEventListener("pointermove", onSwipePointerMove);
  byId("pharm-review-card")?.addEventListener("pointerup", onSwipePointerEnd);
  byId("pharm-review-card")?.addEventListener("pointercancel", onSwipePointerEnd);
  byId("pharm-review-correct")?.addEventListener("click", () => markCard("correct"));
  byId("pharm-review-wrong")?.addEventListener("click", () => markCard("wrong"));
  byId("pharm-review-reset")?.addEventListener("click", () => {
    if (!window.confirm("Reset all pharmacology flashcard progress?")) return;
    state.progress = {};
    state.resetAt = new Date().toISOString();
    saveProgress();
    reloadDeck();
  });
  document.addEventListener("fullscreenchange", () => {
    const button = byId("pharm-review-fullscreen");
    if (button) button.textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
  });
  document.addEventListener("keydown", event => {
    if (byId("screen-pharmacology")?.classList.contains("hidden")) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    if (event.code === "Space") {
      event.preventDefault();
      flipCard();
    } else if (event.key === "ArrowLeft") moveCard(-1);
    else if (event.key === "ArrowRight") moveCard(1);
    else if (event.key.toLowerCase() === "c") markCard("correct");
    else if (event.key.toLowerCase() === "w") markCard("wrong");
    else if (event.key.toLowerCase() === "f") toggleFullscreen();
  });
}

export async function preparePharmacologyReview({ onProgressChange } = {}) {
  ensureReviewMobileStyles();
  if (typeof onProgressChange === "function") state.onProgressChange = onProgressChange;
  const stored = loadProgress();
  state.progress = stored.cards;
  state.resetAt = stored.resetAt;
  bind();
  if (!state.loaded) {
    state.cards = mergeCards(await Promise.all(CARD_DATA_FILES.map(loadCardFile)));
    state.loaded = true;
  }
  reloadDeck();
}
