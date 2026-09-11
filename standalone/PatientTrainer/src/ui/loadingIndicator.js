const LOADING_TEXT = 'Generating response...';

export function showResponseLoading(chatLog) {
  removeResponseLoading(chatLog);
  if (chatLog.classList.contains('empty-chat')) {
    chatLog.innerHTML = '';
    chatLog.classList.remove('empty-chat');
  }
  const bubble = document.createElement('article');
  bubble.className = 'message patient loading-message';
  bubble.dataset.loadingBubble = 'true';
  bubble.setAttribute('aria-live', 'polite');
  bubble.setAttribute('aria-label', LOADING_TEXT);
  bubble.innerHTML = `
    <div class="message-label">Patient<span>Preparing answer</span></div>
    <p><span>${LOADING_TEXT}</span><span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span></p>
  `;
  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
  return bubble;
}

export function removeResponseLoading(chatLog) {
  chatLog?.querySelector('[data-loading-bubble="true"]')?.remove();
}
