// ============================================================
// FIREBASE CONFIG & INIT
// ============================================================
// 1. Vào https://console.firebase.google.com → Tạo project mới
// 2. Vào Project Settings → General → "Your apps" → Web app (</>) 
// 3. Copy config dán vào FIREBASE_CONFIG dưới đây
// 4. Vào Firestore Database → Create database → Start in TEST MODE
//    (sau này có thể siết rule lại, xem firestore.rules.txt)
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  doc,
  collection,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  deleteField,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 🔧 DÁN CONFIG FIREBASE CỦA BẠN VÀO ĐÂY
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAOXe77w0cGGk-BWUG7oDLDsUyKl5jrBaI",
  authDomain: "werewolf-4e914.firebaseapp.com",
  projectId: "werewolf-4e914",
  storageBucket: "werewolf-4e914.firebasestorage.app",
  messagingSenderId: "547501821336",
  appId: "1:547501821336:web:71748d5a8f1c1d9c792fed",
};

const app = initializeApp(FIREBASE_CONFIG);
export const db = getFirestore(app);

// Re-export các hàm Firestore cần dùng để game.js / admin.js / player UI import gọn từ 1 nơi
export {
  doc,
  collection,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  deleteField,
  runTransaction,
};

// Helper: lấy reference tới document phòng chơi
export function roomRef(roomCode) {
  return doc(db, "rooms", roomCode);
}
