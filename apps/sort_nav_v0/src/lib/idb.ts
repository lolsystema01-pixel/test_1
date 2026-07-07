// スキャン済みの最小 IndexedDB ストア（依存なし）。
//   ・キー＝`${office}:${dateKey}` 単位で、スキャン済みの問合番号配列を保持。
//   ・DB（サーバ）には書かない＝仕分済の永続化は「書き込みRLS整備」後（指示書の範囲外）。
const DB_NAME = 'lol-sortnav';
const STORE = 'scanned';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(key: string): Promise<string[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as string[] | undefined) ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSet(key: string, value: string[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
