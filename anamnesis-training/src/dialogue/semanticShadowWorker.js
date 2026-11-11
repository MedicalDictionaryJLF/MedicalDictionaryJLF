import { SHADOW_EXAMPLES, rankByIntent } from './semanticShadow.js?v=pilot-11';

const runtimeUrl = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const model = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const embeddingOptions = { pooling: 'mean', normalize: true };
let indexPromise;

async function buildIndex() {
  const { pipeline, env } = await import(runtimeUrl);
  env.allowLocalModels = false;
  env.backends.onnx.wasm.numThreads = 1;
  const embed = await pipeline('feature-extraction', model, { dtype: 'q8', device: 'wasm' });
  const indexed = [];
  for (let start = 0; start < SHADOW_EXAMPLES.length; start += 16) {
    const batch = SHADOW_EXAMPLES.slice(start, start + 16);
    const vectors = (await embed(batch.map(item => item.phrase), embeddingOptions)).tolist();
    indexed.push(...batch.map(({ intent }, i) => ({ intent, vector: vectors[i] })));
  }
  return { embed, indexed };
}

self.onmessage = async ({ data }) => {
  try {
    const { embed, indexed } = await (indexPromise ??= buildIndex());
    const [vector] = (await embed([data.question], embeddingOptions)).tolist();
    self.postMessage({ id: data.id, candidates: rankByIntent(vector, indexed) });
  } catch {
    self.postMessage({ id: data.id, unavailable: true });
  }
};
