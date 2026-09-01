/**
 * Voice in and out, using what the browser already ships.
 *
 * Speech recognition is Chrome/Edge/Safari only (webkitSpeechRecognition).
 * Speech synthesis is close to universal. Both degrade to "button hidden"
 * rather than breaking the page.
 */

import { store } from './store.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const canListen = Boolean(SR);
export const canSpeak = typeof speechSynthesis !== 'undefined';

/* ---------------------------------------------------------------- listening */

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

/* ---------------------------------------------------------------- speaking */

let voices = [];

function loadVoices() {
  if (!canSpeak) return;
  voices = speechSynthesis.getVoices();
}
if (canSpeak) {
  loadVoices();
  speechSynthesis.addEventListener('voiceschanged', loadVoices);
}

export function listVoices() { return voices; }

/**
 * Read text aloud. Long replies are split on sentence boundaries because
 * some engines silently truncate anything much past ~200 characters.
 */
export function speak(text, { onDone } = {}) {
  if (!canSpeak) { onDone?.(); return; }
  const { voiceURI, rate } = store.get();

  shutUp();

  const clean = stripMarkup(text).trim();
  if (!clean) { onDone?.(); return; }

  const parts = chunk(clean);
  const voice = voices.find((v) => v.voiceURI === voiceURI) || null;

  parts.forEach((part, i) => {
    const u = new SpeechSynthesisUtterance(part);
    if (voice) { u.voice = voice; u.lang = voice.lang; }
    u.rate = rate || 1;
    if (i === parts.length - 1) {
      u.onend = () => onDone?.();
      u.onerror = () => onDone?.();
    }
    speechSynthesis.speak(u);
  });
}

export function shutUp() {
  if (canSpeak) { try { speechSynthesis.cancel(); } catch { /* noop */ } }
}

export function isSpeaking() {
  return canSpeak && speechSynthesis.speaking;
}

/** Code blocks and asterisks read terribly out loud. */
function stripMarkup(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' (code block) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)\*([^*]+)\*/g, '$1$2')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

function chunk(text, limit = 190) {
  const sentences = text.match(/[^.!?\n]+[.!?]*\s*/g) || [text];
  const out = [];
  let buf = '';
  for (const s of sentences) {
    if ((buf + s).length > limit && buf) { out.push(buf.trim()); buf = ''; }
    // A single sentence longer than the limit still has to go out whole.
    buf += s;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
