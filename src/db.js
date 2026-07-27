// ---------- IndexedDB persistence layer (replaces v2 artifact window.storage) ----------
// Two stores: `jobs` (markup meta) and `images` (plan image as Blob — no 5MB/key chunking needed).
const DB_NAME = "bml-markup";
const DB_VERSION = 1;

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("jobs")) db.createObjectStore("jobs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("images")) db.createObjectStore("images", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listJobs() {
  const store = await tx("jobs", "readonly");
  const all = await reqToPromise(store.getAll());
  return all
    .map((j) => ({ id: j.id, name: j.name, savedAt: j.savedAt }))
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
}

export async function getJob(id) {
  const store = await tx("jobs", "readonly");
  return (await reqToPromise(store.get(id))) || null;
}

export async function putJob(meta) {
  const store = await tx("jobs", "readwrite");
  await reqToPromise(store.put(meta));
}

// v5.0 — a job's plan images are keyed per floor. The FIRST floor keeps the bare jobId key so
// every pre-v5 job's image is found exactly where it already is (no migration, no orphans);
// additional floors use `${jobId}::${floorId}`.
export function imageKeyFor(jobId, floorId, firstFloorId) {
  return floorId === firstFloorId ? String(jobId) : `${jobId}::${floorId}`;
}

export async function deleteImageBlob(key) {
  const store = await tx("images", "readwrite");
  await reqToPromise(store.delete(key));
}

export async function deleteJob(id) {
  const jobStore = await tx("jobs", "readwrite");
  await reqToPromise(jobStore.delete(id));
  // remove the bare-key image AND every per-floor image, so deleting a job leaves nothing behind
  const imgStore = await tx("images", "readwrite");
  const keys = await reqToPromise(imgStore.getAllKeys());
  const prefix = `${id}::`;
  for (const k of keys) {
    if (k === id || (typeof k === "string" && k.startsWith(prefix))) await reqToPromise(imgStore.delete(k));
  }
}

export async function getImageBlob(id) {
  const store = await tx("images", "readonly");
  const rec = await reqToPromise(store.get(id));
  return rec ? rec.blob : null;
}

export async function putImageBlob(id, blob) {
  const store = await tx("images", "readwrite");
  await reqToPromise(store.put({ id, blob }));
}

// ---------- dataURL <-> Blob helpers (app state & v2.1 project files use dataURLs) ----------
export function dataURLToBlob(dataURL) {
  const [header, b64] = dataURL.split(",");
  const mime = /data:(.*?);base64/.exec(header)?.[1] || "image/png";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
