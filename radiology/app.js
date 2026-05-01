const STORAGE_KEY = "radiologyTrainerProgress.v2";

const elements = {
  cardMeta: document.getElementById("cardMeta"),
  knownCount: document.getElementById("knownCount"),
  reviewCount: document.getElementById("reviewCount"),
  unseenCount: document.getElementById("unseenCount"),
  positionText: document.getElementById("positionText"),
  percentText: document.getElementById("percentText"),
  progressFill: document.getElementById("progressFill"),
  flashcard: document.getElementById("flashcard"),
  cardImage: document.getElementById("cardImage"),
  answerTitle: document.getElementById("answerTitle"),
  answerBody: document.getElementById("answerBody"),
  cardList: document.getElementById("cardList"),
  prevButton: document.getElementById("prevButton"),
  flipButton: document.getElementById("flipButton"),
  nextButton: document.getElementById("nextButton"),
  reviewButton: document.getElementById("reviewButton"),
  knownButton: document.getElementById("knownButton"),
  resetButton: document.getElementById("resetButton"),
};

let cards = [];
let state = {
  index: 0,
  flipped: false,
  results: {},
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    state = {
      index: Number.isInteger(saved.index) ? saved.index : 0,
      flipped: false,
      results: saved.results && typeof saved.results === "object" ? saved.results : {},
    };
  } catch {
    saveState();
  }
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      index: state.index,
      results: state.results,
    }),
  );
}

function clampIndex() {
  state.index = Math.max(0, Math.min(state.index, cards.length - 1));
}

function currentCard() {
  return cards[state.index];
}

function resultFor(card) {
  return state.results[card.id]?.status || "unseen";
}

function counts() {
  let known = 0;
  let review = 0;
  for (const card of cards) {
    const status = resultFor(card);
    if (status === "known") known += 1;
    if (status === "review") review += 1;
  }
  return {
    known,
    review,
    unseen: cards.length - known - review,
  };
}

function setFlipped(nextValue) {
  state.flipped = nextValue;
  elements.flashcard.classList.toggle("is-flipped", state.flipped);
  elements.flipButton.textContent = state.flipped ? "Image" : "Flip";
}

function displayTitle(card) {
  const title = (card.title || "").trim();
  if (!title || title.startsWith("\u2022") || /^o\s+/i.test(title)) {
    return card.label;
  }
  return title.replace(/:$/, "");
}

function answerLines(card) {
  const lines = (card.description || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const title = (card.title || "").trim();
  if (title && lines[0] === title) {
    lines.shift();
  }
  return lines;
}

function renderAnswerLine(line) {
  const row = document.createElement("p");
  row.className = "answer-line";

  if (line.startsWith("\u2022")) {
    row.classList.add("bullet");
    row.append(marker("\u2022"), textSpan(line.slice(1).trim()));
    return row;
  }

  if (/^o\s+/.test(line)) {
    row.classList.add("subbullet");
    row.append(marker("-"), textSpan(line.slice(2).trim()));
    return row;
  }

  row.textContent = line;
  return row;
}

function renderAnswerImage(card) {
  if (!card.answerImage) return null;

  const img = document.createElement("img");
  img.className = "answer-image";
  img.src = card.answerImage;
  img.alt = `${card.label} answer source`;
  return img;
}

function marker(value) {
  const span = document.createElement("span");
  span.className = "marker";
  span.textContent = value;
  return span;
}

function textSpan(value) {
  const span = document.createElement("span");
  span.textContent = value;
  return span;
}

function renderCard() {
  const card = currentCard();
  const completed = counts();
  const done = completed.known + completed.review;
  const percent = cards.length ? Math.round((done / cards.length) * 100) : 0;

  elements.cardMeta.textContent = `${card.label} | source page ${card.page}`;
  elements.positionText.textContent = `${state.index + 1} / ${cards.length}`;
  elements.percentText.textContent = `${percent}%`;
  elements.progressFill.style.width = `${percent}%`;
  elements.knownCount.textContent = completed.known;
  elements.reviewCount.textContent = completed.review;
  elements.unseenCount.textContent = completed.unseen;

  elements.cardImage.src = card.image;
  elements.cardImage.alt = `${card.label} radiology image`;
  elements.answerTitle.textContent = displayTitle(card);
  const answerNodes = answerLines(card).map(renderAnswerLine);
  const answerImage = renderAnswerImage(card);
  if (answerImage) answerNodes.push(answerImage);
  elements.answerBody.replaceChildren(...answerNodes);

  elements.prevButton.disabled = state.index === 0;
  elements.nextButton.disabled = state.index === cards.length - 1;

  setFlipped(state.flipped);
  renderQueue();
  saveState();
}

function renderQueue() {
  const fragment = document.createDocumentFragment();

  cards.forEach((card, index) => {
    const button = document.createElement("button");
    const status = resultFor(card);
    button.type = "button";
    button.className = `card-jump ${status}`;
    button.textContent = card.number;
    button.title = `${card.label} | ${status}`;
    button.setAttribute("aria-label", `${card.label}, ${status}`);
    if (index === state.index) button.classList.add("current");
    button.addEventListener("click", () => {
      state.index = index;
      setFlipped(false);
      renderCard();
    });
    fragment.append(button);
  });

  elements.cardList.replaceChildren(fragment);
}

function move(delta) {
  state.index += delta;
  clampIndex();
  setFlipped(false);
  renderCard();
}

function mark(status) {
  const card = currentCard();
  const previous = state.results[card.id];
  state.results[card.id] = {
    status,
    attempts: (previous?.attempts || 0) + 1,
    updatedAt: new Date().toISOString(),
  };

  if (state.index < cards.length - 1) {
    state.index += 1;
  }
  setFlipped(false);
  renderCard();
}

function resetProgress() {
  const shouldReset = window.confirm("Reset all recorded progress?");
  if (!shouldReset) return;

  state = {
    index: 0,
    flipped: false,
    results: {},
  };
  saveState();
  renderCard();
}

function bindEvents() {
  elements.flashcard.addEventListener("click", () => setFlipped(!state.flipped));
  elements.flipButton.addEventListener("click", () => setFlipped(!state.flipped));
  elements.prevButton.addEventListener("click", () => move(-1));
  elements.nextButton.addEventListener("click", () => move(1));
  elements.reviewButton.addEventListener("click", () => mark("review"));
  elements.knownButton.addEventListener("click", () => mark("known"));
  elements.resetButton.addEventListener("click", resetProgress);

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }

    if (event.key === " ") {
      event.preventDefault();
      setFlipped(!state.flipped);
    }
    if (event.key === "ArrowLeft") move(-1);
    if (event.key === "ArrowRight") move(1);
    if (event.key === "1") mark("review");
    if (event.key === "2") mark("known");
  });
}

async function init() {
  bindEvents();
  loadState();

  try {
    const response = await fetch("data/cards.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    cards = payload.cards || [];
    clampIndex();
    renderCard();
  } catch (error) {
    elements.cardMeta.textContent = "Could not load card data";
    elements.answerTitle.textContent = "Card data failed to load";
    elements.answerBody.textContent = String(error);
    setFlipped(true);
  }
}

init();
