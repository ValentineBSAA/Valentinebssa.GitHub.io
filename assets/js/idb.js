/**
 * A one-record IndexedDB store for the VRM model file.
 *
 * localStorage is a string store with a ~5 MB budget; a character model is tens
 * of megabytes of binary, so it needs somewhere else to live.
 */

const DB = 'companion';
const STORE = 'files';
const KEY = 'avatar.vrm';

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

export function saveAvatar(blob) {
  return tx('readwrite', (s) => s.put(blob, KEY));
}

export function loadAvatar() {
  return tx('readonly', (s) => s.get(KEY));
}

export function clearAvatar() {
  return tx('readwrite', (s) => s.delete(KEY));
}

export const canStoreFiles = typeof indexedDB !== 'undefined';
