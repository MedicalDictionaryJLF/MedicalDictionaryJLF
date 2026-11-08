// Explicitly authorized educational approximations, never diagnostic recordings.
let context, master;
const active = new Set();
export function setBedsideVolume(volume) {
  if (master && context) master.gain.setValueAtTime(Math.max(0, Math.min(1, Number(volume) || 0)), context.currentTime);
}
export function stopBedsideAudio() {
  for (const node of active) { try { node.stop(); } catch {} }
  active.clear();
}
export async function playBedsideAudio(technique, siteId, { sound, volume = .6 } = {}) {
  if (!sound || sound.kind !== 'synthesized') return false;
  const AudioContextType = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextType) throw new Error('Web Audio unavailable');
  stopBedsideAudio();
  if (!context || context.state === 'closed') { context = new AudioContextType(); master = context.createGain(); master.connect(context.destination); }
  await context.resume();setBedsideVolume(volume);
  const now = context.currentTime;
  const track = node => { active.add(node);node.onended = () => active.delete(node);return node; };
  const tone = (frequency, start, duration, gain) => {
    const oscillator = track(context.createOscillator()), envelope = context.createGain();
    oscillator.type = 'sine';oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(.0001, start);envelope.gain.exponentialRampToValueAtTime(gain, start + .012);
    envelope.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(envelope).connect(master);oscillator.start(start);oscillator.stop(start + duration + .02);
  };
  if (sound.pattern === 'normal-heart') {
    const gain = siteId === 'heart-mitral' ? .065 : .05;
    for (const offset of [0, .85, 1.7]) { tone(82, now + offset, .12, gain);tone(105, now + offset + .2, .09, gain * .7); }
  } else if (sound.pattern === 'clear-breath') {
    const length = Math.floor(context.sampleRate * 2), buffer = context.createBuffer(1, length, context.sampleRate), samples = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) samples[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / length) * .07;
    const source = track(context.createBufferSource()), filter = context.createBiquadFilter();
    source.buffer = buffer;filter.type = 'lowpass';filter.frequency.value = siteId.includes('back') ? 550 : 650;
    source.connect(filter).connect(master);source.start(now);
  } else if (sound.pattern === 'bowel-present') {
    for (const offset of [.1, .38, .7, 1.02]) tone(170 + offset * 90, now + offset, .045, .025);
  } else return false;
  return true;
}
export function closeBedsideAudio() { stopBedsideAudio();if (context) { context.close().catch(() => {});context = null;master = null; } }
