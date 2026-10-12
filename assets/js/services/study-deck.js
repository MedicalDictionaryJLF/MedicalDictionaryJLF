import { isDifficultStudyRecord, isStudyDue, studyWeight } from './study-progress.js?v=75';

function sample(items, limit, weight, random){
  const pool = items.slice();
  const result = [];
  while(pool.length && result.length < limit){
    const weights = pool.map(item => Math.max(.01, Number(weight(item)) || 1));
    let hit = random() * weights.reduce((sum, value) => sum + value, 0);
    let index = weights.length - 1;
    for(let candidate = 0; candidate < weights.length; candidate += 1){
      hit -= weights[candidate];
      if(hit <= 0){ index = candidate; break; }
    }
    result.push(pool.splice(index, 1)[0]);
  }
  return result;
}

export function createStudyDeck({ query, terms = [], progress = {}, adapters = [], matchesSubdivision = () => true, now = Date.now(), random = Math.random }){
  const adapterMap = new Map(adapters.map(adapter => [adapter.key, adapter]));
  const domains = new Set((query.domains || []).map(String));
  const only = String(query.only || 'all');
  const reviewMode = String(query.reviewMode || 'smart');
  const candidates = [];

  for(const row of terms){
    if(!row || !domains.has(String(row._domain || ''))) continue;
    const adapter = adapterMap.get(row._domain);
    if(!adapter || !matchesSubdivision(row, adapter, query)) continue;
    const frontField = adapter.fieldByKey.get(query.frontFieldKey);
    const backField = adapter.fieldByKey.get(query.backFieldKey);
    if(!frontField || !backField) continue;
    const front = String(frontField.getValue(row) || '').trim();
    const back = String(backField.getValue(row) || '').trim();
    if(!front || !back || front === back) continue;
    const termId = String(row._id || '');
    if(!termId) continue;
    const itemProgress = progress[termId] || null;

    if(reviewMode === 'due' && !isStudyDue(itemProgress, now)) continue;
    if(only === 'new' && itemProgress && (itemProgress.reviews || itemProgress.correct || itemProgress.wrong)) continue;
    if(only === 'wrong' && !(Number(itemProgress?.wrong || 0) > 0)) continue;
    if(only === 'difficult' && !isDifficultStudyRecord(itemProgress)) continue;
    if(only === 'due' && !isStudyDue(itemProgress, now)) continue;
    if(only === 'saved' && !query.savedIds?.has(termId)) continue;
    if(only === 'recent'){
      const added = Date.parse(row.created_at || row.createdAt || row.added_at || '');
      if(!Number.isFinite(added) || added > now || now - added > 30 * 86400000) continue;
    }

    const secondaryFront = adapter.fieldByKey.get(query.frontFieldSecondaryKey);
    const secondaryBack = adapter.fieldByKey.get(query.backFieldSecondaryKey);
    candidates.push({
      termId, domain: row._domain, front, back,
      frontSecondary: secondaryFront ? String(secondaryFront.getValue(row) || '').trim() : '',
      backSecondary: secondaryBack ? String(secondaryBack.getValue(row) || '').trim() : '',
      meta: { domainLabel: adapter.label, frontLabel: frontField.label, backLabel: backField.label },
      _progress: itemProgress
    });
  }

  const requestedLimit = String(query.limit || '20') === 'all'
    ? candidates.length
    : Math.max(1, Number(query.limit) || 20);
  const limit = Math.min(requestedLimit, candidates.length);
  const weight = reviewMode === 'random'
    ? () => 1
    : item => only === 'new' || only === 'recent' ? 1 : studyWeight(item._progress, now);
  const chosen = sample(candidates, limit, weight, random);
  return chosen.map(({ _progress, ...card }) => card);
}
