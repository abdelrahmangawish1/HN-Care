import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";
import { getAuth, browserLocalPersistence, setPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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