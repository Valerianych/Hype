
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyArTfja1Bl9A1ShmBX78-TBPk8q5fxy5vY",
  authDomain: "shalost-5fe61.firebaseapp.com",
  projectId: "shalost-5fe61",
  storageBucket: "shalost-5fe61.firebasestorage.app",
  messagingSenderId: "1007456875902",
  appId: "1:1007456875902:web:f82e0329aa5eba94036f2f",
  measurementId: "G-DHY606LCZ4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Realtime Database with the specific URL provided
export const db = getDatabase(app, "https://shalost-5fe61-default-rtdb.firebaseio.com/");

// Initialize Firebase Auth
export const auth = getAuth(app);
