import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDZ7ZFsWh0Yesl5mYPDD-KNWwT0Z6WGazw",
  authDomain: "fitlog-294e5.firebaseapp.com",
  projectId: "fitlog-294e5",
  storageBucket: "fitlog-294e5.firebasestorage.app",
  messagingSenderId: "883214242310",
  appId: "1:883214242310:web:f751c4dcbe1357b36c6987"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
