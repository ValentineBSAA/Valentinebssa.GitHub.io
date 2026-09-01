/**
 * Persistent state. Everything lives in this browser's localStorage —
 * the API key never leaves the device except in calls to api.anthropic.com.
 */

const KEY = 'companion.v1';

const DEFAULTS = {
  apiKey: '',
  model: 'claude-opus-5',
  name: 'Companion',
  persona: '',
  speak: false,        // read replies aloud
  handsFree: false,    // re-open the mic after each reply
  voiceURI: '',        // browser-engine voice, when no Piper server is set
  rate: 1,

  piperUrl: '',                       // e.g. http://nas.local:8080/tts — blank uses browser voices
  piperVoice: 'en_US-amy-medium',     // must be one of tts.js PIPER_VOICES

  avatarSource: 'none',               // 'none' | 'file' (in IndexedDB) | 'url'
  avatarUrl: '',                      // .vrm URL when avatarSource === 'url'
  avatarFileName: '',                 // shown in settings when a file is stored
  avatarZoom: 1,                      // framing: 1 = head and shoulders

  threads: {},         // id -> { id, title, created, updated, messages: [{role, content}] }
  activeThread: null,
  scores: {},          // gameId -> arbitrary per-game record
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

let state = read();
const listeners = new Set();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    // Quota exceeded — most likely a very long chat history.
    console.warn('Could not save state:', err);
  }
}

export const store = {
  get() { return state; },

  set(patch) {
    state = { ...state, ...patch };
    persist();
    listeners.forEach((fn) => fn(state));
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /* ---- threads ---- */

  newThread() {
    const id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const thread = { id, title: 'New chat', created: Date.now(), updated: Date.now(), messages: [] };
    this.set({ threads: { ...state.threads, [id]: thread }, activeThread: id });
    return thread;
  },

  activeThreadOrNew() {
    const cur = state.threads[state.activeThread];
    return cur || this.newThread();
  },

  saveThread(thread) {
    thread.updated = Date.now();
    this.set({ threads: { ...state.threads, [thread.id]: thread } });
  },

  deleteThread(id) {
    const threads = { ...state.threads };
    delete threads[id];
    const activeThread = state.activeThread === id ? null : state.activeThread;
    this.set({ threads, activeThread });
  },

  threadsByRecency() {
    return Object.values(state.threads).sort((a, b) => b.updated - a.updated);
  },

  /* ---- scores ---- */

  score(gameId) { return state.scores[gameId] || {}; },

  bumpScore(gameId, patch) {
    const next = { ...this.score(gameId), ...patch };
    this.set({ scores: { ...state.scores, [gameId]: next } });
    return next;
  },

  /* ---- moving between devices ---- */

  exportJSON() {
    // The key is deliberately excluded — export files get emailed and synced around.
    const { apiKey, ...safe } = state;
    return JSON.stringify({ version: 1, exported: new Date().toISOString(), ...safe }, null, 2);
  },

  importJSON(text) {
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('Not a Companion backup file.');
    const { version, exported, apiKey, ...rest } = parsed;
    this.set(rest);
  },
};
