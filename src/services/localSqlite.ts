import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

const DB_KEY = "dsmdh-sqlite-v2";
const DB_STORE = "sqlite";
let sqlPromise: ReturnType<typeof initSqlJs> | null = null;
let localTail:Promise<unknown>=Promise.resolve();
const QUEUE_LOCK="dsmdh-offline-queue-v2";
function serialized<T>(work:()=>Promise<T>):Promise<T>{
  if(typeof navigator!=="undefined"&&navigator.locks?.request)return navigator.locks.request(QUEUE_LOCK,{mode:"exclusive"},work);
  const next=localTail.then(work,work);localTail=next.catch(()=>{});return next;
}

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
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("ds-mobile-digital-hub", 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => {
      const tx = req.result.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(bytes.buffer, DB_KEY);
      tx.oncomplete = () => { try { req.result.close(); } catch {} ; resolve(); };
      tx.onerror = () => { try { req.result.close(); } catch {} ; reject(tx.error || new Error("Offline queue persistence failed")); };
      tx.onabort = () => { try { req.result.close(); } catch {} ; reject(tx.error || new Error("Offline queue persistence aborted")); };
    };
    req.onerror = () => reject(req.error || new Error("Offline queue storage unavailable"));
  });
}

async function readLegacyLocalStorage(): Promise<Uint8Array | undefined> {
  try {
    const raw = localStorage.getItem(DB_KEY) || localStorage.getItem(DB_KEY.replace("-v2", "-v1"));
    if (!raw) return undefined;
    return Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
}

async function withDb<T>(work:(db:Database)=>Promise<T>):Promise<T>{
 return serialized(async()=>{
  sqlPromise??=initSqlJs({locateFile:()=>wasmUrl});
  const SQL=await sqlPromise;
  const bytes=(await readIndexedDb())||(await readLegacyLocalStorage());
  const db=new SQL.Database(bytes);
  try{
   db.run(`CREATE TABLE IF NOT EXISTS offline_queue (
      id TEXT PRIMARY KEY,operation TEXT NOT NULL,entity TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT
    )`);
   return await work(db);
  }finally{db.close();}
 });
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

export async function sqliteEnqueue(operation:string,entity:string,payload:unknown,id=crypto.randomUUID()){
 return withDb(async db=>{
  db.run("INSERT INTO offline_queue (id,operation,entity,payload,created_at) VALUES (?,?,?,?,?)",[id,operation,entity,JSON.stringify(payload),new Date().toISOString()]);
  await persist(db);return id;
 });
}
export async function sqliteReplace(operation:string,entity:string,payload:unknown,id:string){
 return withDb(async db=>{db.run("INSERT OR REPLACE INTO offline_queue (id,operation,entity,payload,created_at) VALUES (?,?,?,?,?)",[id,operation,entity,JSON.stringify(payload),new Date().toISOString()]);await persist(db);});
}
export async function sqliteList(){
 return withDb(async db=>db.exec("SELECT id,operation,entity,payload,created_at,attempts,last_error FROM offline_queue ORDER BY created_at")[0]?.values??[]);
}
export async function sqliteRemove(id:string){
 return withDb(async db=>{db.run("DELETE FROM offline_queue WHERE id=?",[id]);await persist(db);});
}
export async function sqliteTransaction<T>(fn:(db:Database)=>T){
 return withDb(async db=>{db.run("BEGIN IMMEDIATE");let result:T;try{result=fn(db);db.run("COMMIT");}catch(e){db.run("ROLLBACK");throw e;}await persist(db);return result;});
}
