/**
 * Persistent state. Everything lives in this browser's localStorage —
 * the API key never leaves the device except in calls to api.anthropic.com.
 *
 * A "character" bundles who she is (name, personality), how she sounds (voice)
 * and how she looks (VRM model). Switching character switches all three.
 */

const KEY = 'companion.v1';

const DEFAULTS = {
  apiKey: '',
  model: 'claude-opus-5',

  speak: false,        // read replies aloud
  handsFree: false,    // re-open the mic after each reply
  voiceURI: '',        // browser-engine voice, when no Piper server is set
  rate: 1,

  piperUrl: '',        // e.g. http://nas.local:8080/tts — blank uses browser voices

  characters: {},      // id -> character (see newCharacter below)
  activeCharacter: null,

  threads: {},         // id -> { id, title, created, updated, messages: [{role, content}] }
  activeThread: null,
  scores: {},          // gameId -> arbitrary per-game record

  migratedFrom1: false,
};

export const DEFAULT_VOICE = 'en_US-amy-medium';

function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function newCharacter(patch = {}) {
  return {
    id: newId('c'),
    name: 'Companion',
    persona: '',
    voice: DEFAULT_VOICE,
    source: 'none',    // 'none' | 'file' (blob in IndexedDB) | 'url'
    url: '',
    fileName: '',
    zoom: 2,           // 1 = face, 2 = head and shoulders, 3 = half body
    ...patch,
  };
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Fold the old flat single-avatar settings into one character.
 * Returns the id of the character that inherited a stored model file, if any,
 * so the caller can move the IndexedDB record across.
 */
function migrate(state) {
  if (state.migratedFrom1 || Object.keys(state.characters).length) return null;

  const first = newCharacter({
    name: state.name || 'Companion',
    persona: state.persona || '',
    voice: state.piperVoice || DEFAULT_VOICE,
    source: state.avatarSource || 'none',
    url: state.avatarUrl || '',
    fileName: state.avatarFileName || '',
    zoom: state.avatarZoom || 2,
  });

  state.characters = { [first.id]: first };
  state.activeCharacter = first.id;
  state.migratedFrom1 = true;

  // The old flat keys are no longer read; drop them so the blob stays small.
  for (const k of ['name', 'persona', 'piperVoice', 'avatarSource', 'avatarUrl', 'avatarFileName', 'avatarZoom']) {
    delete state[k];
  }

  return first.source === 'file' ? first.id : null;
}

let state = read();
export const pendingModelMigration = migrate(state);

const listeners = new Set();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    // Quota exceeded — most likely a very long chat history.
    console.warn('Could not save state:', err);
  }
}

if (pendingModelMigration !== null || state.migratedFrom1) persist();

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

  /* ---- characters ---- */

  /** Always returns one; creates a default the first time. */
  activeChar() {
    const cur = state.characters[state.activeCharacter];
    if (cur) return cur;

    const list = Object.values(state.characters);
    if (list.length) {
      this.set({ activeCharacter: list[0].id });
      return list[0];
    }

    const fresh = newCharacter();
    this.set({ characters: { [fresh.id]: fresh }, activeCharacter: fresh.id });
    return fresh;
  },

  charList() {
    return Object.values(state.characters).sort((a, b) => a.name.localeCompare(b.name));
  },

  addChar(patch) {
    const char = newCharacter(patch);
    this.set({ characters: { ...state.characters, [char.id]: char }, activeCharacter: char.id });
    return char;
  },

  updateChar(id, patch) {
    const cur = state.characters[id];
    if (!cur) return null;
    const next = { ...cur, ...patch };
    this.set({ characters: { ...state.characters, [id]: next } });
    return next;
  },

  deleteChar(id) {
    const characters = { ...state.characters };
    delete characters[id];
    const activeCharacter = state.activeCharacter === id
      ? (Object.keys(characters)[0] ?? null)
      : state.activeCharacter;
    this.set({ characters, activeCharacter });
  },

  setActiveChar(id) {
    if (state.characters[id]) this.set({ activeCharacter: id });
  },

  /* ---- threads ---- */

  newThread() {
    const id = newId('t');
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
    // The key is deliberately excluded — export files get emailed and synced
    // around. Model files are far too large for JSON and are left out too;
    // characters keep their settings, and their models are re-added per device.
    const { apiKey, ...safe } = state;
    return JSON.stringify({ version: 2, exported: new Date().toISOString(), ...safe }, null, 2);
  },

  importJSON(text) {
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('Not a Companion backup file.');
    const { version, exported, apiKey, ...rest } = parsed;

    // A v1 backup has flat avatar fields; run it through the same migration.
    if (!rest.characters || !Object.keys(rest.characters).length) {
      rest.characters = {};
      rest.migratedFrom1 = false;
      migrate(rest);
    }
    this.set(rest);
  },
};
