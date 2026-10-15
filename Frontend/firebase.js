import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getAuth, browserLocalPersistence, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDLEbFDZdyuuNId6GfWsgH48nZ-rembZK4",
  authDomain: "hn-care-f709b.firebaseapp.com",
  projectId: "hn-care-f709b",
  storageBucket: "hn-care-f709b.firebasestorage.app",
  messagingSenderId: "792256037855",
  appId: "1:792256037855:web:05256afbc2fc71a1537a6a",
  measurementId: "G-5DVKXK8LKH",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const authPersistence = setPersistence(auth, browserLocalPersistence);

isSupported()
  .then((supported) => {
    if (supported) {
      getAnalytics(app);
    }
  })
  .catch((error) => {
    console.error("Firebase Analytics initialization failed:", error);
  });