const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function getFocusableElements(root) {
  if (!root) return [];
  return [...root.querySelectorAll(FOCUSABLE_SELECTOR)].filter((el) => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.hidden) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    return el.offsetParent !== null || el === document.activeElement;
  });
}

export function createDialogController({
  dialog,
  overlay,
  trigger,
  inertRoots = [],
  activeBodyClass = "dialog-open"
} = {}) {
  let lastTrigger = null;

  function setOpenState(open) {
    if (!(dialog instanceof HTMLElement) || !(overlay instanceof HTMLElement)) return;
    dialog.classList.toggle("open", !!open);
    overlay.classList.toggle("open", !!open);
    dialog.setAttribute("aria-hidden", open ? "false" : "true");
    overlay.setAttribute("aria-hidden", open ? "false" : "true");
    document.body.classList.toggle(activeBodyClass, !!open);
    inertRoots.forEach((root) => {
      if (!(root instanceof HTMLElement)) return;
      try {
        root.inert = !!open;
      } catch (error) {}
      root.setAttribute("aria-hidden", open ? "true" : "false");
    });
  }

  function focusFirstElement() {
    const focusables = getFocusableElements(dialog);
    const target = focusables[0] || dialog;
    if (target instanceof HTMLElement) {
      try {
        target.focus({ preventScroll: true });
      } catch (error) {}
    }
  }

  function onKeydown(event) {
    if (!(dialog instanceof HTMLElement) || !dialog.classList.contains("open")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = getFocusableElements(dialog);
    if (focusables.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function open(nextTrigger = null) {
    lastTrigger = nextTrigger instanceof HTMLElement ? nextTrigger : trigger instanceof HTMLElement ? trigger : document.activeElement;
    setOpenState(true);
    focusFirstElement();
    document.addEventListener("keydown", onKeydown, true);
  }

  function close() {
    setOpenState(false);
    document.removeEventListener("keydown", onKeydown, true);
    if (lastTrigger instanceof HTMLElement) {
      try {
        lastTrigger.focus({ preventScroll: true });
      } catch (error) {}
    }
  }

  return { open, close };
}

export function renderStatusMessage(container, { text = "", tone = "info" } = {}) {
  if (!(container instanceof HTMLElement)) return;
  container.textContent = String(text || "");
  container.dataset.statusTone = text ? tone : "";
  container.classList.toggle("hidden", !text);
}
