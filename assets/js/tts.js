/**
 * Speech output, with two engines.
 *
 *   piper   — a Piper server (on the NAS) returns WAV, which we play through an
 *             AnalyserNode so the avatar's mouth can follow the real waveform.
 *   browser — speechSynthesis, filtered to female voices. No way to tap the
 *             audio, so the mouth is driven by an estimated envelope instead.
 *
 * Long replies are split into sentence chunks and pipelined: chunk N+1 is
 * synthesised while chunk N is still playing. On a low-power NAS that is the
 * difference between speaking after half a second and speaking after five.
 */

import { store } from './store.js';

/* ------------------------------------------------------------------ voices */

/**
 * Piper ships no gender metadata, so this list is curated by hand.
 *
 * "verified" entries were checked by synthesising a fixed phrase and measuring
 * median fundamental frequency (female speech sits ~165-255 Hz, male ~85-155).
 * Amy 195 Hz, Lessac 193 Hz, southern_english_female 195 Hz, Kathleen 152 Hz —
 * against male controls Alan 95 Hz, Danny 117 Hz, Ryan 137 Hz. The rest are
 * included on dataset provenance: hfc_female and southern_english_female are
 * named female, LJSpeech is Linda Johnson, Jenny is the Jenny corpus.
 *
 * Voices whose speaker I could not stand behind are deliberately absent.
 */
export const PIPER_VOICES = [
  { id: 'en_US-amy-medium',                  label: 'Amy — US, warm',            size: '63 MB', verified: true },
  { id: 'en_US-amy-low',                     label: 'Amy — US, warm (fast)',     size: '28 MB', verified: true },
  { id: 'en_GB-jenny_dioco-medium',          label: 'Jenny — UK, bright',        size: '63 MB' },
  { id: 'en_GB-alba-medium',                 label: 'Alba — Scottish',           size: '63 MB' },
  { id: 'en_GB-southern_english_female-low', label: 'Southern English (fast)',   size: '28 MB', verified: true },
  { id: 'en_US-lessac-medium',               label: 'Lessac — US, clear',        size: '63 MB', verified: true },
  { id: 'en_US-lessac-high',                 label: 'Lessac — US, clear (best)', size: '113 MB', verified: true },
  { id: 'en_US-hfc_female-medium',           label: 'HFC — US, neutral',         size: '63 MB' },
  { id: 'en_US-kristin-medium',              label: 'Kristin — US, soft',        size: '63 MB' },
  { id: 'en_US-ljspeech-high',               label: 'LJSpeech — US (best)',      size: '113 MB' },
  { id: 'en_US-kathleen-low',                label: 'Kathleen — US, low (fast)', size: '28 MB', verified: true },
];

export const DEFAULT_VOICE = 'en_US-amy-medium';

/** Browser voices carry no gender field either, so match on known names. */
const FEMALE_NAME_RE = new RegExp([
  'female', 'samantha', 'karen', 'moira', 'tessa', 'fiona', 'victoria', 'allison',
  'ava', 'susan', 'zoe', 'serena', 'kate', 'stephanie', 'nicky', 'joana', 'alice',
  'amelie', 'anna', 'ellen', 'ioana', 'laura', 'lekha', 'luciana', 'mariska',
  'melina', 'milena', 'monica', 'nora', 'paulina', 'sara', 'satu', 'sinji', 'yuna',
  'zira', 'aria', 'jenny', 'michelle', 'hazel', 'linda', 'heera', 'catherine',
  'eva', 'hoda', 'zuzana', 'sonia', 'clara', 'natasha', 'libby', 'maisie',
].join('|'), 'i');

const MALE_NAME_RE = /\b(male|man)\b|daniel|alex|fred|thomas|jorge|juan|diego|luca|xander|rishi|aaron|arthur|gordon|oliver|reed|rocko|david|mark|george|james|ryan|guy|william|liam/i;

export function browserVoices() {
  if (typeof speechSynthesis === 'undefined') return [];
  return speechSynthesis.getVoices();
}

export function femaleBrowserVoices() {
  return browserVoices().filter(
    (v) => FEMALE_NAME_RE.test(v.name) && !MALE_NAME_RE.test(v.name),
  );
}

/**
 * What to offer in the picker.
 *
 * Some platforms name their voices after a person, which is what the filter
 * above keys on. Android does not — Chrome there reports "English (United
 * States)" and nothing else, so the female filter finds nothing and the picker
 * would be an empty dead end. In that case, offer every voice for the user's
 * own language and let them choose by ear, saying plainly why.
 */
export function pickableBrowserVoices() {
  const female = femaleBrowserVoices();
  if (female.length) return { voices: female, genderKnown: true };

  const all = browserVoices();
  const lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
  const mine = all.filter((v) => v.lang?.toLowerCase().startsWith(lang));
  return { voices: (mine.length ? mine : all), genderKnown: false };
}

export const canBrowserSpeak = typeof speechSynthesis !== 'undefined';

/* ------------------------------------------------------------- audio graph */

let audioCtx = null;
let analyser = null;
let levelData = null;

function ctx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.55;
    analyser.connect(audioCtx.destination);
    levelData = new Uint8Array(analyser.fftSize);
  }
  return audioCtx;
}

/**
 * Browsers refuse to start audio until the user has interacted with the page.
 * Call this from a click/tap so the first reply is not silently swallowed.
 */
export async function unlockAudio() {
  try {
    const c = ctx();
    if (c.state === 'suspended') await c.resume();
    return c.state === 'running';
  } catch {
    return false;
  }
}

/** Current loudness, 0..1. The avatar reads this every frame. */
export function level() {
  if (!speaking) return 0;

  // speechSynthesis gives no access to its audio, so approximate a talking
  // mouth: two detuned oscillations shaped so it never sits fully open.
  if (engine() === 'browser') {
    const t = performance.now() / 1000;
    const env = 0.55 + 0.45 * Math.sin(t * 11.3) * Math.sin(t * 4.1 + 1.7);
    return Math.max(0, Math.min(1, env));
  }

  if (!analyser) return 0;
  analyser.getByteTimeDomainData(levelData);
  let sum = 0;
  for (let i = 0; i < levelData.length; i++) {
    const v = (levelData[i] - 128) / 128;
    sum += v * v;
  }
  // Voice rarely fills the range, so scale up and clamp rather than showing a
  // mouth that barely moves.
  return Math.min(1, Math.sqrt(sum / levelData.length) * 4.2);
}

/* ---------------------------------------------------------------- chunking */

function chunk(text, limit = 220) {
  const sentences = text.match(/[^.!?\n]+[.!?]*\s*/g) || [text];
  const out = [];
  let buf = '';
  for (const s of sentences) {
    if ((buf + s).length > limit && buf) { out.push(buf.trim()); buf = ''; }
    buf += s;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Markup reads terribly out loud. */
export function stripMarkup(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)\*([^*]+)\*/g, '$1$2')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/* ----------------------------------------------------------------- speaking */

let speaking = false;
let generation = 0;      // bumped on stop, so stale chunks never play
let activeSources = [];

export function isSpeaking() { return speaking; }

export function shutUp() {
  generation += 1;
  speaking = false;
  for (const src of activeSources) {
    try { src.stop(); } catch { /* already ended */ }
  }
  activeSources = [];
  if (canBrowserSpeak) {
    try { speechSynthesis.cancel(); } catch { /* noop */ }
  }
}

/** Where the Piper server lives, or '' when we should use browser voices. */
export function piperURL() {
  return (store.get().piperUrl || '').replace(/\/+$/, '');
}

export function engine() {
  return piperURL() ? 'piper' : 'browser';
}

/**
 * Speak `text`. Resolves when the last word has played (or when stopped).
 * `onStart` fires as soon as audio actually begins.
 */
export async function speak(text, { onStart, onDone } = {}) {
  const clean = stripMarkup(text);
  if (!clean) { onDone?.(); return; }

  shutUp();
  const myGen = ++generation;
  speaking = true;

  try {
    if (piperURL()) await speakPiper(clean, myGen, onStart);
    else await speakBrowser(clean, myGen, onStart);
  } catch (err) {
    if (myGen === generation) {
      console.warn('Speech failed:', err);
      // A dead Piper server should not mean silence — fall back for this turn.
      if (piperURL()) {
        try { await speakBrowser(clean, myGen, onStart); } catch { /* give up quietly */ }
      }
    }
  } finally {
    if (myGen === generation) speaking = false;
    onDone?.();
  }
}

/* ---- Piper ---- */

async function synthesize(text, signal) {
  const { rate } = store.get();
  const piperVoice = store.activeChar().voice;
  const res = await fetch(`${piperURL()}/synthesize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      voice: piperVoice || DEFAULT_VOICE,
      // Piper's length_scale stretches time, so it is the inverse of "speed".
      length_scale: 1 / (rate || 1),
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Piper returned ${res.status}`);
  return res.arrayBuffer();
}

async function speakPiper(text, myGen, onStart) {
  const c = ctx();
  if (c.state === 'suspended') await c.resume();

  const parts = chunk(text);
  let started = false;

  // Kick off the first synthesis, then keep exactly one request in flight ahead
  // of playback. Each promise swallows its own rejection into a marker object so
  // that bailing out of the loop can never leave an unhandled rejection behind.
  const start = (t) => synthesize(t).then((b) => ({ buf: b }), (err) => ({ err }));
  let pending = start(parts[0]);

  for (let i = 0; i < parts.length; i++) {
    const { buf, err } = await pending;
    if (err) {
      if (i === 0) throw err;      // nothing played yet — let the caller fall back
      break;                       // partial speech is better than a hard stop
    }
    if (myGen !== generation) return;

    if (i + 1 < parts.length) pending = start(parts[i + 1]);

    const audio = await c.decodeAudioData(buf.slice(0));
    if (myGen !== generation) return;

    if (!started) { started = true; onStart?.(); }
    await playBuffer(audio, myGen);
    if (myGen !== generation) return;
  }
}

function playBuffer(audioBuffer, myGen) {
  return new Promise((resolve) => {
    const src = audioCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(analyser);
    activeSources.push(src);
    src.onended = () => {
      activeSources = activeSources.filter((s) => s !== src);
      resolve();
    };
    if (myGen !== generation) { resolve(); return; }
    src.start();
  });
}

/* ---- browser ---- */

function speakBrowser(text, myGen, onStart) {
  if (!canBrowserSpeak) return Promise.resolve();

  return new Promise((resolve) => {
    const { voiceURI, rate } = store.get();
    // Honour an explicit choice from any voice the platform offers; otherwise
    // prefer one we can actually identify as female.
    const voice = browserVoices().find((v) => v.voiceURI === voiceURI)
      || femaleBrowserVoices()[0]
      || null;

    const parts = chunk(text, 190);
    let started = false;

    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      u.rate = rate || 1;
      u.pitch = 1.05;
      if (!started && i === 0) {
        u.onstart = () => { started = true; onStart?.(); };
      }
      if (i === parts.length - 1) {
        u.onend = resolve;
        u.onerror = resolve;
      }
      if (myGen === generation) speechSynthesis.speak(u);
    });

    if (!parts.length) resolve();
  });
}

/* ---------------------------------------------------------------- server IO */

/** Ask a Piper server which voices it actually has installed. */
export async function probePiper(url) {
  const base = url.replace(/\/+$/, '');
  const res = await fetch(`${base}/voices`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Server answered ${res.status}`);
  const data = await res.json();
  const installed = Object.keys(data);
  if (!installed.length) throw new Error('Server is up but has no voices installed.');
  return installed;
}
