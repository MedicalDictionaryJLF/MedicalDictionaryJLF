export const DEFAULT_RECOGNITION_LANGUAGE = 'en-US';

export function initVoiceInput({ button, input, status, language = DEFAULT_RECOGNITION_LANGUAGE }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!button || !input) return { supported: false, stop: () => {} };
  if (!Recognition) {
    button.disabled = true;
    button.title = 'Voice input is not supported in this browser';
    button.setAttribute('aria-label', 'Voice input is not supported in this browser');
    if (status) status.textContent = '';
    return { supported: false, stop: () => {} };
  }

  let recognition = null;
  let listening = false;

  const setListening = (value, message = '') => {
    listening = value;
    button.classList.toggle('listening', listening);
    button.setAttribute('aria-pressed', String(listening));
    button.setAttribute('aria-label', listening ? 'Stop voice input' : 'Start voice input');
    button.textContent = listening ? 'Stop' : 'Mic';
    if (status) status.textContent = message;
  };

  const stop = () => {
    if (recognition && listening) recognition.stop();
    setListening(false, '');
  };

  button.addEventListener('click', () => {
    if (listening) {
      stop();
      return;
    }
    recognition = new Recognition();
    recognition.lang = language;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setListening(true, 'Listening...');
    recognition.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript?.trim();
      if (text) {
        input.value = input.value ? `${input.value.trim()} ${text}` : text;
        input.focus();
      }
    };
    recognition.onerror = (event) => {
      const messages = {
        'not-allowed': 'Microphone permission denied.',
        'no-speech': 'No speech detected.',
        aborted: 'Voice input stopped.'
      };
      if (status) status.textContent = messages[event.error] || 'Voice input error.';
    };
    recognition.onend = () => setListening(false, status?.textContent || '');
    try {
      recognition.start();
    } catch {
      setListening(false, 'Voice input could not start.');
    }
  });

  return { supported: true, stop };
}
