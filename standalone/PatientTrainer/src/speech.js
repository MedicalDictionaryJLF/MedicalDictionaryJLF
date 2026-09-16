function getVoices() {
  return window.speechSynthesis?.getVoices?.() ?? [];
}

export function chooseVoiceForPatient(sex = 'unknown', preferredLanguage = 'en') {
  if (!('speechSynthesis' in window)) return null;
  const voices = getVoices();
  if (!voices.length) return null;
  const s = String(sex).toLowerCase();
  const wantsFemale = s.includes('female') || s.includes('woman') || s.includes('žena');
  const wantsMale = s.includes('male') || s.includes('man') || s.includes('muž');
  const femaleHints = ['female', 'woman', 'zira', 'hazel', 'susan', 'samantha', 'eva', 'helena', 'anna', 'victoria'];
  const maleHints = ['male', 'man', 'david', 'george', 'mark', 'daniel', 'matthew', 'alex', 'paul'];
  const preferred = wantsFemale ? femaleHints : wantsMale ? maleHints : [];
  const byHint = voices.find((voice) => preferred.some((hint) => `${voice.name} ${voice.voiceURI}`.toLowerCase().includes(hint)));
  if (byHint) return byHint;
  const byLanguage = voices.find((voice) => voice.lang?.toLowerCase().startsWith(preferredLanguage));
  return byLanguage || voices[0];
}

export function speak(text, patientCase = null, hooks = {}) {
  if (!('speechSynthesis' in window)) {
    hooks?.onError?.(new Error('Speech synthesis unavailable'));
    return null;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.95;
  utterance.pitch = 1;
  const voice = chooseVoiceForPatient(patientCase?.identity?.sex ?? 'unknown', 'en');
  if (voice) utterance.voice = voice;
  utterance.onstart = () => hooks?.onStart?.(utterance);
  utterance.onboundary = (event) => hooks?.onBoundary?.(event, utterance);
  utterance.onend = () => hooks?.onEnd?.(utterance);
  utterance.onerror = (event) => hooks?.onError?.(event, utterance);
  window.speechSynthesis.speak(utterance);
  return utterance;
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

export function initVoices(callback) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.onvoiceschanged = () => callback?.(getVoices());
}
