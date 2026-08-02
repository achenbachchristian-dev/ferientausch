import {
  addDoc,
  collection,
  db,
  deleteDoc,
  doc,
  firebaseEnabled,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from "./firebase";
import { createSeedState } from "./demoData";

const STORAGE_KEY = "ferientausch-state-v1";

export function loadLocalState() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seed = createSeedState();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }

  try {
    return JSON.parse(raw);
  } catch {
    const seed = createSeedState();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }
}

export function saveLocalState(nextState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
}

export function createId(prefix) {
  const randomPart =
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `${prefix}-${randomPart}`;
}

export function subscribeCollection(name, onValue, onError) {
  if (!firebaseEnabled) {
    return () => {};
  }

  return onSnapshot(
    collection(db, name),
    (snapshot) => {
      onValue(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    },
    onError,
  );
}

export function subscribeRequestsForUser(userId, isAdmin, onValue, onError) {
  if (!firebaseEnabled || !userId) {
    return () => {};
  }

  if (isAdmin) {
    return subscribeCollection("exchangeRequests", onValue, onError);
  }

  const requestsById = new Map();

  const publish = () => {
    onValue(Array.from(requestsById.values()));
  };

  const handleSnapshot = (snapshot, ownedField) => {
    snapshot.docs.forEach((entry) => {
      requestsById.set(entry.id, { id: entry.id, ...entry.data() });
    });

    snapshot.docChanges().forEach((change) => {
      if (change.type === "removed") {
        const data = change.doc.data();
        if (data[ownedField] === userId) {
          requestsById.delete(change.doc.id);
        }
      }
    });

    publish();
  };

  const sentQuery = query(collection(db, "exchangeRequests"), where("fromUserId", "==", userId));
  const receivedQuery = query(collection(db, "exchangeRequests"), where("toUserId", "==", userId));

  const unsubscribeSent = onSnapshot(sentQuery, (snapshot) => handleSnapshot(snapshot, "fromUserId"), onError);
  const unsubscribeReceived = onSnapshot(receivedQuery, (snapshot) => handleSnapshot(snapshot, "toUserId"), onError);

  return () => {
    unsubscribeSent();
    unsubscribeReceived();
  };
}

export async function saveRecord(collectionName, record) {
  if (!firebaseEnabled) {
    return record;
  }

  if (record.id) {
    const { id, ...data } = record;
    await setDoc(doc(db, collectionName, id), data, { merge: true });
    return record;
  }

  const created = await addDoc(collection(db, collectionName), record);
  return { id: created.id, ...record };
}

export async function patchRecord(collectionName, id, updates) {
  if (!firebaseEnabled) {
    return;
  }

  await updateDoc(doc(db, collectionName, id), updates);
}

export async function removeRecord(collectionName, id) {
  if (!firebaseEnabled) {
    return;
  }

  await deleteDoc(doc(db, collectionName, id));
}
