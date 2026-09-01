/**
 * Speech input, using what the browser already ships.
 *
 * Recognition is Chrome/Edge/Safari only (webkitSpeechRecognition); elsewhere
 * `canListen` is false and the mic controls simply never appear.
 *
 * Speech *output* lives in tts.js, which also handles the Piper engine.
 */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const canListen = Boolean(SR);

let recognition = null;
let listening = false;

/**
 * Start the mic. Calls onInterim(text) as you speak and onFinal(text) once
 * you stop. Returns false if the browser can't do it.
 */
export function listen({ onInterim, onFinal, onEnd, onError }) {
  if (!SR) return false;
  stopListening();

  recognition = new SR();
  recognition.lang = navigator.language || 'en-US';
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  let finalText = '';

  recognition.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const chunk = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) finalText += chunk;
      else interim += chunk;
    }
    if (interim) onInterim?.(interim);
  };

  recognition.onerror = (ev) => {
    listening = false;
    // "aborted" and "no-speech" are ordinary — the user just stopped talking.
    if (ev.error !== 'aborted' && ev.error !== 'no-speech') onError?.(ev.error);
  };

  recognition.onend = () => {
    listening = false;
    const said = finalText.trim();
    if (said) onFinal?.(said);
    onEnd?.();
  };

  try {
    recognition.start();
    listening = true;
    return true;
  } catch {
    listening = false;
    return false;
  }
}

export function stopListening() {
  if (recognition) {
    try { recognition.abort(); } catch { /* already stopped */ }
    recognition = null;
  }
  listening = false;
}

export function isListening() { return listening; }
