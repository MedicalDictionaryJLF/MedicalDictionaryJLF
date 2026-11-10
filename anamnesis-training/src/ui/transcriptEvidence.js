export function answeredTurns(engine) {
  const turns = new Map();
  for (const row of engine?.debugTurns ?? []) {
    if (!Number.isInteger(row.turnNumber) || row.turnNumber < 1) continue;
    for (const id of row.answeredIds ?? []) if (!turns.has(id)) turns.set(id, row.turnNumber);
  }
  return turns;
}

export function transcriptRows(messages = []) {
  let turn = 0;
  return messages.filter(message => ['student', 'patient'].includes(message?.speaker)).map(message => {
    if (message.speaker !== 'patient') return { message, turn: null };
    const explicit = Number.isInteger(message.engineTurn) && message.engineTurn > 0;
    const legacy = message.engineTurn === undefined && Boolean(message.responseScope && message.matchKind);
    if (!explicit && !legacy) return { message, turn: null };
    turn = explicit ? message.engineTurn : turn + 1;
    return { message, turn };
  });
}

export function transcriptLink(turn, label, scope = 'live') {
  return Number.isInteger(turn) && turn > 0
    ? `<a href="#pt-${scope}-turn-${turn}" data-transcript-link="${scope}" data-turn="${turn}">${label}</a>`
    : label;
}

export function jumpToTranscript(event, chatLog) {
  const link = event.target.closest?.('[data-transcript-link]');
  if (!link) return;
  const scope = link.dataset.transcriptLink;
  const turn = Number(link.dataset.turn);
  if (!Number.isInteger(turn) || turn < 1) return;
  const container = scope === 'live' ? chatLog : link.closest('.pt-debrief');
  const target = container?.querySelector(`[data-${scope === 'live' ? 'live' : 'debrief'}-turn="${turn}"]`);
  if (!target) return;
  event.preventDefault();
  const details = target.closest('details');
  if (details) details.open = true;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest' });
}
