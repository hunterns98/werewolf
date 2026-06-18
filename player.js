<FILE file_path="/home/workdir/attachments/player.js">
// ============================================================
// PLAYER.JS — GIAO DIỆN NGƯỜI CHƠI v2.1 (NÂNG CẤP)
// ============================================================

import { db, doc, setDoc, getDoc, updateDoc, onSnapshot } from "./firebase.js";
import { ROLE_LABEL_VI, ROLE_TEAM, getAlivePlayers, WIN_LABEL_VI, getPartner } from "./game.js";

let roomCode = null;
let myId = null;
let myName = null;
let roomRefDoc = null;
let currentRoom = null;
let unsubscribe = null;

const $ = (sel) => document.querySelector(sel);

// ... (giữ nguyên phần joinRoom, listenRoom, castVote, sendChatMessage cũ)

function renderPlayerScreen() {
  if (!currentRoom) return;
  const me = currentRoom.players[myId] || {};
  const isAlive = me.alive !== false;
  const isAssigned = !!me.role;

  renderStatusBar(me, isAlive);
  renderRoleCard(me, isAlive);
  renderLoverInfo(me);           // ← ĐÃ NÂNG CẤP
  renderPhaseInfo();
  renderAliveList();
  renderVotingArea(isAlive);
  renderDeathScreen(isAlive, isAssigned);
  renderLogsForPlayer();         // Ẩn lý do chết
  renderWinBanner();
  renderChatPanels(me, isAlive);
  renderSeerHistory(me);
  renderTimer();
}

// ====================== LOVER DISPLAY (Cập nhật) ======================
function renderLoverInfo(me) {
  const el = $("#loverInfoSection");
  if (!el) return;

  const partner = getPartner(currentRoom.players || {}, myId);
  if (!partner) {
    el.classList.add("hidden");
    return;
  }

  el.classList.remove("hidden");
  const partnerAlive = partner.alive !== false;
  const partnerRole = ROLE_LABEL_VI[partner.role] || partner.role;

  el.innerHTML = `
    <div class="lover-card">
      <div>❤️ <strong>Người yêu của bạn:</strong> ${partner.name}</div>
      <div>🎭 Vai trò: <strong>${partnerRole}</strong></div>
      <div>${partnerAlive ? "🟢 Còn sống" : "💔 Đã chết"}</div>
      ${!partnerAlive ? `<div class="lover-death-notice">💔 Người yêu đã mất... Bạn sẽ theo sau!</div>` : ""}
    </div>
  `;
}

// ====================== ẨN LÝ DO CHẾT ======================
function renderLogsForPlayer() {
  const el = $("#logPanelPlayer");
  const logs = (currentRoom.logs || []).filter(l => l.type !== "secret"); // chỉ log công khai
  el.innerHTML = logs.slice().reverse()
    .map((l) => `<div class="log-entry log-${l.type}">[V${l.round}] ${l.textPublic || l.text}</div>`)
    .join("");
}

// ... (phần còn lại giữ nguyên + bổ sung chat sói/cặp đôi realtime)

export function bindPlayerUI() {
  // ... code cũ + thêm event cho wolf vote nếu Player Action Mode
}

console.log("player.js v2.1 loaded with Lover + Hidden Death Cause");
</FILE>
