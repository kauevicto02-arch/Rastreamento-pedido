import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAc0kW04HwmjY7zqeUWukvJXMfYSY3sBPA",
  authDomain: "rastreamento-pedidos-6391d.firebaseapp.com",
  projectId: "rastreamento-pedidos-6391d",
  storageBucket: "rastreamento-pedidos-6391d.firebasestorage.app",
  messagingSenderId: "368420613021",
  appId: "1:368420613021:web:1cb58435ebe3803e6a1d74"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
