// db.js — small promise-based IndexedDB wrapper.
// Stores:
//   answers  (keyPath 'id')      -> full answer-sheet object + importedAt
//   pdfs     (keyPath 'testId')  -> { testId, name, bytes:ArrayBuffer, pageCount, importedAt }
//   attempts (autoIncrement)     -> attempt log rows (see stats.js shape)
//   sims     (autoIncrement)     -> completed simulation results (history)
//   kv       (keyPath 'k')       -> generic { k, v } (simState, reviewState, seen, meta)

const DB_NAME = 'pet-practice';
const DB_VERSION = 1;

let _dbp = null;

function openDB() {
  if (_dbp) return _dbp;
  _dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('answers')) {
        db.createObjectStore('answers', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('pdfs')) {
        db.createObjectStore('pdfs', { keyPath: 'testId' });
      }
      if (!db.objectStoreNames.contains('attempts')) {
        const s = db.createObjectStore('attempts', { keyPath: 'localId', autoIncrement: true });
        s.createIndex('timestamp', 'timestamp');
        s.createIndex('questionId', 'questionId');
        s.createIndex('topic', 'topic');
        s.createIndex('domain', 'domain');
        s.createIndex('testId', 'testId');
      }
      if (!db.objectStoreNames.contains('sims')) {
        const s = db.createObjectStore('sims', { keyPath: 'localId', autoIncrement: true });
        s.createIndex('finishedAt', 'finishedAt');
      }
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'k' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbp;
}

function tx(storeNames, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('tx aborted'));
    result = fn(t);
  }));
}

function reqP(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---- answers ---------------------------------------------------------------

export async function putAnswerSheet(sheet) {
  const rec = { ...sheet, importedAt: Date.now() };
  return tx('answers', 'readwrite', (t) => { t.objectStore('answers').put(rec); return rec; });
}
export async function getAnswerSheet(id) {
  return tx('answers', 'readonly', (t) => reqP(t.objectStore('answers').get(id)));
}
export async function getAllAnswerSheets() {
  return tx('answers', 'readonly', (t) => reqP(t.objectStore('answers').getAll()));
}
export async function deleteAnswerSheet(id) {
  return tx('answers', 'readwrite', (t) => { t.objectStore('answers').delete(id); });
}

// ---- pdfs ------------------------------------------------------------------

export async function putPdf(rec) {
  const r = { ...rec, importedAt: Date.now() };
  return tx('pdfs', 'readwrite', (t) => { t.objectStore('pdfs').put(r); return r; });
}
export async function getPdf(testId) {
  return tx('pdfs', 'readonly', (t) => reqP(t.objectStore('pdfs').get(testId)));
}
export async function getAllPdfMeta() {
  // returns records without the heavy bytes
  const all = await tx('pdfs', 'readonly', (t) => reqP(t.objectStore('pdfs').getAll()));
  return all.map(({ bytes, ...meta }) => ({ ...meta, hasBytes: !!bytes, size: bytes ? bytes.byteLength : 0 }));
}
export async function deletePdf(testId) {
  return tx('pdfs', 'readwrite', (t) => { t.objectStore('pdfs').delete(testId); });
}

// ---- attempts --------------------------------------------------------------

export async function addAttempt(row) {
  return tx('attempts', 'readwrite', (t) => { t.objectStore('attempts').add(row); });
}
export async function getAllAttempts() {
  return tx('attempts', 'readonly', (t) => reqP(t.objectStore('attempts').getAll()));
}
export async function clearAttempts() {
  return tx('attempts', 'readwrite', (t) => { t.objectStore('attempts').clear(); });
}
export async function importAttempts(rows) {
  return tx('attempts', 'readwrite', (t) => {
    const store = t.objectStore('attempts');
    for (const r of rows) { const { localId, ...rest } = r; store.add(rest); }
  });
}

// ---- sims (simulation history) ---------------------------------------------

export async function addSimResult(rec) {
  return tx('sims', 'readwrite', (t) => { t.objectStore('sims').add(rec); });
}
export async function getAllSimResults() {
  return tx('sims', 'readonly', (t) => reqP(t.objectStore('sims').getAll()));
}
export async function clearSimResults() {
  return tx('sims', 'readwrite', (t) => { t.objectStore('sims').clear(); });
}
export async function importSimResults(rows) {
  return tx('sims', 'readwrite', (t) => {
    const store = t.objectStore('sims');
    for (const r of rows) { const { localId, ...rest } = r; store.add(rest); }
  });
}

// ---- kv (generic) ----------------------------------------------------------

export async function kvGet(k, dflt = null) {
  const rec = await tx('kv', 'readonly', (t) => reqP(t.objectStore('kv').get(k)));
  return rec ? rec.v : dflt;
}
export async function kvSet(k, v) {
  return tx('kv', 'readwrite', (t) => { t.objectStore('kv').put({ k, v }); });
}
export async function kvDelete(k) {
  return tx('kv', 'readwrite', (t) => { t.objectStore('kv').delete(k); });
}

// ---- storage estimate ------------------------------------------------------

export async function requestPersistent() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch {}
  return false;
}

export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      return await navigator.storage.estimate();
    }
  } catch {}
  return null;
}
