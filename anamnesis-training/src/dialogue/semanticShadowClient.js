import { evaluateShadow, validShadowRanking } from './semanticShadow.js?v=pilot-11';

export function createShadowObserver(mode, createWorker = () => new Worker(
  new URL('./semanticShadowWorker.js?v=pilot-11', import.meta.url), { type: 'module' }
), timeoutMs = 90000) {
  if (!['1', 'benchmark'].includes(mode)) return null;
  let worker;
  let pending = null;
  let unavailable = false;
  let nextId = 0;

  function settle(value) {
    if (!pending) return;
    clearTimeout(pending.timer);
    const { resolve, started } = pending;
    pending = null;
    resolve({ ...value, elapsedMs: Math.round(performance.now() - started) });
  }

  function disable() {
    unavailable = true;
    const failedWorker = worker;
    worker = null;
    settle({ status: 'unavailable' });
    try { failedWorker?.terminate(); } catch { /* The worker is already detached. */ }
  }

  function rank(question) {
    if (typeof question !== 'string' || !question.trim() || question.length > 240) {
      return Promise.resolve({ status: 'invalid' });
    }
    if (unavailable) return Promise.resolve({ status: 'unavailable' });
    if (pending) return Promise.resolve({ status: 'busy' });
    if (!worker) {
      try {
        worker = createWorker();
        worker.onmessage = ({ data }) => {
          if (!pending) return;
          if (!data || !Number.isSafeInteger(data.id)) return disable();
          if (pending.id !== data.id) return;
          if (data.unavailable || !validShadowRanking(data.candidates)) disable();
          else settle({ status: 'ranked', candidates: data.candidates });
        };
        worker.onerror = disable;
        worker.onmessageerror = disable;
      } catch {
        disable();
        return Promise.resolve({ status: 'unavailable' });
      }
    }
    return new Promise(resolve => {
      const id = ++nextId;
      pending = { id, resolve, started: performance.now(), timer: setTimeout(disable, timeoutMs) };
      try { worker.postMessage({ id, question }); } catch { disable(); }
    });
  }

  async function benchmark() {
    return evaluateShadow(async phrase => {
      const result = await rank(phrase);
      if (result.status !== 'ranked') throw new Error('The local language model is unavailable.');
      return result.candidates;
    });
  }

  return { rank, benchmark };
}
