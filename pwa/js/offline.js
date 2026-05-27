// Offline detection, IndexedDB queue, and network status

const DB_NAME = 'ssn-offline';
const DB_VERSION = 1;

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('queue')) {
                db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains('cache')) {
                db.createObjectStore('cache', { keyPath: 'id' });
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

export async function addToQueue(note) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('queue', 'readwrite');
        tx.objectStore('queue').add({ ...note, queued_at: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

export async function getQueue() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('queue', 'readonly');
        const req = tx.objectStore('queue').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

export async function removeFromQueue(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('queue', 'readwrite');
        tx.objectStore('queue').delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

export async function cacheNotes(notes) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('cache', 'readwrite');
        const store = tx.objectStore('cache');
        store.clear();
        notes.forEach(n => store.put(n));
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

export async function getCachedNotes() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('cache', 'readonly');
        const req = tx.objectStore('cache').getAll();
        req.onsuccess = () => resolve(
            req.result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        );
        req.onerror = (e) => reject(e.target.error);
    });
}

export function isOnline() {
    return navigator.onLine;
}

export function onNetworkChange(callback) {
    window.addEventListener('online', () => callback(true));
    window.addEventListener('offline', () => callback(false));
}

export async function flushQueue(sendFn) {
    const queue = await getQueue();
    if (queue.length === 0) return 0;
    let sent = 0;
    for (const item of queue) {
        try {
            await sendFn(item);
            await removeFromQueue(item.id);
            sent++;
        } catch (e) {
            console.error('Failed to send queued item:', e);
            break;
        }
    }
    return sent;
}

export async function getQueueCount() {
    const queue = await getQueue();
    return queue.length;
}
