import { initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  initializeFirestore,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
export const firebaseProjectId = firebaseConfig.projectId ?? "";
export const firestoreDatabaseId = import.meta.env.VITE_FIRESTORE_DATABASE_ID || "ferientausch";
export const firebaseConfigComplete = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.storageBucket &&
    firebaseConfig.messagingSenderId &&
    firebaseConfig.appId,
);

const app = firebaseEnabled ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const storage = app ? getStorage(app) : null;
export const db = app
  ? initializeFirestore(
      app,
      {
        experimentalForceLongPolling: true,
        ignoreUndefinedProperties: true,
      },
      firestoreDatabaseId,
    )
  : null;

export {
  addDoc,
  collection,
  createUserWithEmailAndPassword,
  deleteObject,
  deleteDoc,
  doc,
  onAuthStateChanged,
  onSnapshot,
  query,
  setDoc,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  storageRef,
  updateDoc,
  uploadBytes,
  where,
  getDownloadURL,
};
