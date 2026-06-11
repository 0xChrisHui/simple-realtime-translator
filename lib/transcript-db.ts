import { normalizeStoredTranscriptSession, sortStoredTranscriptSessions } from "./transcript-session";
import type { StoredTranscriptSession } from "./types";

const TRANSCRIPT_DB_NAME = "simple-realtime-translator";
const TRANSCRIPT_DB_VERSION = 1;
const TRANSCRIPT_SESSION_STORE = "transcriptSessions";

function openTranscriptDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not available."));
      return;
    }

    const request = window.indexedDB.open(TRANSCRIPT_DB_NAME, TRANSCRIPT_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRANSCRIPT_SESSION_STORE)) {
        db.createObjectStore(TRANSCRIPT_SESSION_STORE, { keyPath: "id" });
      }
    };

    request.onblocked = () => reject(new Error("Transcript database upgrade is blocked by another tab."));
    request.onerror = () => reject(request.error ?? new Error("Could not open transcript database."));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

export async function loadStoredTranscriptSessions() {
  const db = await openTranscriptDb();

  return new Promise<StoredTranscriptSession[]>((resolve, reject) => {
    const transaction = db.transaction(TRANSCRIPT_SESSION_STORE, "readonly");
    const request = transaction.objectStore(TRANSCRIPT_SESSION_STORE).getAll();

    request.onsuccess = () => {
      const sessions = (request.result as unknown[])
        .map(normalizeStoredTranscriptSession)
        .filter((session): session is StoredTranscriptSession => Boolean(session));
      resolve(sortStoredTranscriptSessions(sessions));
    };
    request.onerror = () => reject(request.error ?? new Error("Could not load transcript sessions."));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Could not load transcript sessions."));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error ?? new Error("Transcript session load was aborted."));
    };
  });
}

export async function saveStoredTranscriptSession(session: StoredTranscriptSession) {
  const db = await openTranscriptDb();

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(TRANSCRIPT_SESSION_STORE, "readwrite");
    transaction.objectStore(TRANSCRIPT_SESSION_STORE).put(session);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Could not save transcript session."));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error ?? new Error("Transcript session save was aborted."));
    };
  });
}

export async function deleteStoredTranscriptSession(sessionId: string) {
  const db = await openTranscriptDb();

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(TRANSCRIPT_SESSION_STORE, "readwrite");
    transaction.objectStore(TRANSCRIPT_SESSION_STORE).delete(sessionId);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Could not delete transcript session."));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error ?? new Error("Transcript session delete was aborted."));
    };
  });
}

export async function clearStoredTranscriptSessions(options: { preserveSessionId?: string } = {}) {
  const db = await openTranscriptDb();

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(TRANSCRIPT_SESSION_STORE, "readwrite");
    const store = transaction.objectStore(TRANSCRIPT_SESSION_STORE);

    if (!options.preserveSessionId) {
      store.clear();
    } else {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (cursor.key !== options.preserveSessionId) cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error("Could not clear transcript sessions."));
    }

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Could not clear transcript sessions."));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error ?? new Error("Transcript session clear was aborted."));
    };
  });
}
