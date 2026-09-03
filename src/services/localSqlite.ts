import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

const DB_KEY = "dsmdh-sqlite-v2";
const DB_STORE = "sqlite";
let dbPromise: Promise<Database> | null = null;

function idbAvailable() {
  return typeof indexedDB !== "undefined";
}

function readIndexedDb(): Promise<Uint8Array | undefined> {
  if (!idbAvailable()) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const req = indexedDB.open("ds-mobile-digital-hub", 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => {
      const tx = req.result.transaction(DB_STORE, "readonly");
      const get = tx.objectStore(DB_STORE).get(DB_KEY);
      get.onsuccess = () => {
        const value = get.result ? new Uint8Array(get.result) : undefined;
        tx.oncomplete = () => { try { req.result.close(); } catch {} };
        resolve(value);
      };
      get.onerror = () => { try { req.result.close(); } catch {}; resolve(undefined); };
    };
    req.onerror = () => resolve(undefined);
  });
}

function writeIndexedDb(bytes: Uint8Array): Promise<void> {
  if (!idbAvailable()) return Promise.resolve();
  return new Promise((resolve) => {
    const req = indexedDB.open("ds-mobile-digital-hub", 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => {
      const tx = req.result.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(bytes.buffer, DB_KEY);
      tx.oncomplete = () => { try { req.result.close(); } catch {} ; resolve(); };
      tx.onerror = () => { try { req.result.close(); } catch {} ; resolve(); };
    };
    req.onerror = () => resolve();
  });
}

async function readLegacyLocalStorage(): Promise<Uint8Array | undefined> {
  try {
    const raw = localStorage.getItem(DB_KEY.replace("-v2", "-v1"));
    if (!raw) return undefined;
    return Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
}

async function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const bytes = (await readIndexedDb()) || (await readLegacyLocalStorage());
    const db = new SQL.Database(bytes);
    db.run(`
      CREATE TABLE IF NOT EXISTS offline_queue (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        entity TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      )
    `);
    return db;
  })();
  return dbPromise;
}

async function persist(db: Database) {
  const bytes = db.export();
  await writeIndexedDb(bytes);
  // Small legacy fallback for environments without IndexedDB.
  if (!idbAvailable()) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    localStorage.setItem(DB_KEY, btoa(binary));
  }
}

export async function sqliteEnqueue(operation: string, entity: string, payload: unknown, id = crypto.randomUUID()) {
  const db = await openDb();
  db.run(
    "INSERT INTO offline_queue (id,operation,entity,payload,created_at) VALUES (?,?,?,?,?)",
    [id, operation, entity, JSON.stringify(payload), new Date().toISOString()]
  );
  await persist(db);
  return id;
}

export async function sqliteList() {
  const db = await openDb();
  const result = db.exec(
    "SELECT id,operation,entity,payload,created_at,attempts,last_error FROM offline_queue ORDER BY created_at"
  );
  return result[0]?.values ?? [];
}

export async function sqliteRemove(id: string) {
  const db = await openDb();
  db.run("DELETE FROM offline_queue WHERE id=?", [id]);
  await persist(db);
}

export async function sqliteTransaction<T>(fn: (db: Database) => T) {
  const db = await openDb();
  db.run("BEGIN IMMEDIATE");
  try {
    const result = fn(db);
    db.run("COMMIT");
    await persist(db);
    return result;
  } catch (e) {
    db.run("ROLLBACK");
    throw e;
  }
}
