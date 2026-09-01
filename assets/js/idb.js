/**
 * IndexedDB storage for character model files, one record per character.
 *
 * localStorage is a string store with a ~5 MB budget; a VRM is tens of
 * megabytes of binary, so it needs somewhere else to live.
 */

const DB = 'companion';
const STORE = 'files';
const LEGACY_KEY = 'avatar.vrm';   // single-avatar layout, before characters

const keyFor = (characterId) => `vrm:${characterId}`;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  }));
}

export function saveModel(characterId, blob) {
  return tx('readwrite', (s) => s.put(blob, keyFor(characterId)));
}

export function loadModel(characterId) {
  return tx('readonly', (s) => s.get(keyFor(characterId)));
}

export function deleteModel(characterId) {
  return tx('readwrite', (s) => s.delete(keyFor(characterId)));
}

/** How much space the stored models take, for showing in settings. */
export async function modelSizes() {
  const keys = await tx('readonly', (s) => s.getAllKeys());
  const out = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !key.startsWith('vrm:')) continue;
    const blob = await tx('readonly', (s) => s.get(key));
    if (blob) out[key.slice(4)] = blob.size;
  }
  return out;
}

/**
 * Move a model saved under the old single-avatar key onto a character.
 * Runs once at boot; a no-op after that.
 */
export async function migrateLegacyModel(characterId) {
  try {
    const blob = await tx('readonly', (s) => s.get(LEGACY_KEY));
    if (!blob) return false;
    await saveModel(characterId, blob);
    await tx('readwrite', (s) => s.delete(LEGACY_KEY));
    return true;
  } catch {
    return false;
  }
}

export const canStoreFiles = typeof indexedDB !== 'undefined';
