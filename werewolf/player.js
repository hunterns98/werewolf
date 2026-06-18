// ============================================================
// PLAYER.JS — GIAO DIỆN NGƯỜI CHƠI (LAYER "CHỈ ĐỌC")
// ============================================================
// Người chơi KHÔNG tự tính toán logic gì cả.
// Chỉ: (1) đọc state từ Firestore qua onSnapshot
//      (2) gửi vote ngày vào field riêng dayVotes.{myId} (tránh đè field khác)
// Vai trò cá nhân được hiển thị từ players[myId].role do admin gán.
// ============================================================

import { db, doc, setDoc, updateDoc, onSnapshot } from "./firebase.js";
import { ROLE_LABEL_VI, getAlivePlayers, WIN_LABEL_VI } from "./game.js";

let roomCode = null;
let myId = null;
let myName = null;
let roomRefDoc = null;
let currentRoom = null;
let unsubscribe = null;

const $ = (sel) => document.querySelector(sel);

// ============================================================
// 1. JOIN ROOM
// ============================================================

function genPlayerId() {
  return "p_" + Math.random().toString(36).substring(2, 10);
}

export async function joinRoom(code, name) {
  roomCode = code.trim().toUpperCase();
  roomRefDoc = doc(db, "rooms", roomCode);

  // Lưu localStorage để refresh trang không mất danh tính
  const storageKey = `maso_player_${roomCode}`;
  const saved = JSON.parse(localStorage.getItem(storageKey) || "null");

  if (saved && saved.id) {
    myId = saved.id;
    myName = saved.name;
  } else {
    myId = genPlayerId();
    myName = name.trim();
    localStorage.setItem(storageKey, JSON.stringify({ id: myId, name: myName }));
  }

  // Thêm player vào room (merge, không đè người khác)
  await updateDoc(roomRefDoc, {
    [`players.${myId}`]: { name: myName, alive: true },
  }).catch(async () => {
    // Nếu document chưa có field players (hiếm), fallback setDoc với merge
    await setDoc(roomRefDoc, { players: { [myId]: { name: myName, alive: true } } }, { merge: true });
  });

  listenRoom();
  $("#joinScreenPlayer").classList.add("hidden");
  $("#gameScreenPlayer").classList.remove("hidden");
}

function listenRoom() {
  if (unsubscribe) unsubscribe();
  unsubscribe = onSnapshot(roomRefDoc, (snap) => {
    if (!snap.exists()) return;
    currentRoom = snap.data();
    renderPlayerScreen();
  });
}

// Tự động điền lại tên nếu đã có session lưu trong localStorage
export function tryAutoJoin(code) {
  const storageKey = `maso_player_${code.toUpperCase()}`;
  const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
  if (saved && saved.id) {
    $("#inputPlayerName").value = saved.name;
  }
}

// ============================================================
// 2. GỬI VOTE BAN NGÀY
// ============================================================

export async function castVote(targetId) {
  if (!currentRoom || currentRoom.phase !== "day") return;
  const me = currentRoom.players[myId];
  if (!me || me.alive === false) {
    alert("Bạn đã chết, không thể vote!");
    return;
  }
  await updateDoc(roomRefDoc, {
    [`dayVotes.${myId}`]: targetId,
  });
}

// ============================================================
// 3. RENDER UI
// ============================================================

function renderPlayerScreen() {
  if (!currentRoom) return;
  const me = currentRoom.players[myId] || {};
  const isAlive = me.alive !== false;
  const isAssigned = !!me.role;

  renderStatusBar(me, isAlive);
  renderRoleCard(me, isAlive);
  renderPhaseInfo();
  renderAliveCounter();
  renderVotingArea(isAlive);
  renderDeathScreen(isAlive, isAssigned);
  renderRoleRevealDebug();
  renderLogsForPlayer();
  renderWinBanner();
}

function renderStatusBar(me, isAlive) {
  const bar = $("#statusBar");
  bar.textContent = isAlive ? `🟢 ${me.name} — Bạn còn sống` : `💀 ${me.name} — Bạn đã chết`;
  bar.className = `status-bar ${isAlive ? "alive" : "dead"}`;
}

function renderRoleCard(me, isAlive) {
  const card = $("#roleCard");
  if (!me.role) {
    card.innerHTML = `<p>⏳ Đang chờ Admin bắt đầu game...</p>`;
    return;
  }
  card.innerHTML = `
    <div class="role-name">${ROLE_LABEL_VI[me.role]}</div>
    ${me.isLover ? `<div class="lover-badge">💞 Bạn đang trong một cặp tình yêu (Lovers)</div>` : ""}
    <div class="role-desc">${getRoleDescription(me.role)}</div>
  `;
}

function getRoleDescription(role) {
  const desc = {
    werewolf: "Mỗi đêm bạn cùng đồng đội chọn 1 người để cắn chết. Hãy giả vờ là dân làng vào ban ngày!",
    seer: "Mỗi đêm bạn được soi 1 người để biết họ có phải Sói hay không.",
    witch: "Bạn có 1 lọ thuốc cứu (cứu người bị sói cắn) và 1 lọ thuốc độc (giết 1 người), mỗi loại chỉ dùng được 1 lần cả game.",
    guardian: "Mỗi đêm bạn chọn 1 người để bảo vệ khỏi sói.",
    cupid: "Đêm đầu tiên, bạn chọn 2 người để ghép thành một cặp tình yêu. Nếu 1 người chết, người còn lại chết theo!",
    villager: "Bạn không có khả năng đặc biệt. Hãy dùng lý lẽ để tìm ra Sói vào ban ngày!",
  };
  return desc[role] || "";
}

function renderPhaseInfo() {
  const el = $("#phaseInfoPlayer");
  const { phase, round } = currentRoom;
  const labels = {
    lobby: "🛋️ Đang chờ trong phòng chờ...",
    night: `🌙 ĐÊM ${round} — Mọi người im lặng, admin đang điều hành...`,
    day: `☀️ NGÀY ${round} — Thảo luận và bỏ phiếu!`,
    ended: "🏁 GAME ĐÃ KẾT THÚC",
  };
  el.textContent = labels[phase] || "";
  el.className = `phase-info phase-${phase}`;
}

function renderAliveCounter() {
  const el = $("#aliveCounter");
  const alive = getAlivePlayers(currentRoom.players || {});
  const total = Object.keys(currentRoom.players || {}).length;
  el.textContent = `👥 Còn sống: ${alive.length} / ${total}`;
}

function renderVotingArea(isAlive) {
  const area = $("#votingArea");
  area.innerHTML = "";
  if (currentRoom.phase !== "day" || !isAlive) {
    area.classList.add("hidden");
    return;
  }
  area.classList.remove("hidden");

  const title = document.createElement("h3");
  title.textContent = "🗳️ Bỏ phiếu treo cổ ai?";
  area.appendChild(title);

  const myVote = (currentRoom.dayVotes || {})[myId];

  getAlivePlayers(currentRoom.players).forEach((p) => {
    if (p.id === myId) return; // không tự vote bản thân
    const btn = document.createElement("button");
    btn.className = "select-option vote-btn";
    if (myVote === p.id) btn.classList.add("active");
    btn.textContent = p.name;
    btn.onclick = () => castVote(p.id);
    area.appendChild(btn);
  });

  if (myVote) {
    const note = document.createElement("p");
    note.className = "note-disabled";
    note.textContent = `Bạn đã vote cho: ${currentRoom.players[myVote]?.name || "?"}`;
    area.appendChild(note);
  }
}

function renderDeathScreen(isAlive, isAssigned) {
  const overlay = $("#deathOverlay");
  if (!isAlive && isAssigned) {
    overlay.classList.remove("hidden");
  } else {
    overlay.classList.add("hidden");
  }
}

/**
 * Mode 2: nếu admin bật debugMode, người chết xem được role tất cả
 * Mode 1 (mặc định): chết rồi vẫn KHÔNG xem được role người khác
 */
function renderRoleRevealDebug() {
  const section = $("#debugRevealSection");
  const me = currentRoom.players[myId] || {};
  const isAlive = me.alive !== false;
  const debugOn = currentRoom.settings?.debugMode;

  if (!debugOn || isAlive) {
    section.classList.add("hidden");
    section.innerHTML = "";
    return;
  }

  section.classList.remove("hidden");
  section.innerHTML = `<h3>🔍 (Debug Mode) Vai trò tất cả người chơi:</h3>`;
  Object.values(currentRoom.players).forEach((p) => {
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `<span>${p.alive === false ? "💀" : "🟢"} ${p.name}</span><span>${p.role ? ROLE_LABEL_VI[p.role] : "?"}</span>`;
    section.appendChild(row);
  });
}

function renderLogsForPlayer() {
  const el = $("#logPanelPlayer");
  // Ẩn log loại "info" (chứa thông tin bí mật hành động đêm), chỉ hiện log công khai
  const logs = (currentRoom.logs || []).filter((l) => l.type !== "info");
  el.innerHTML = logs
    .slice()
    .reverse()
    .map((l) => `<div class="log-entry log-${l.type}">[V${l.round}] ${l.text}</div>`)
    .join("");
}

function renderWinBanner() {
  const el = $("#winBannerPlayer");
  if (currentRoom.phase === "ended" && currentRoom.winner) {
    el.classList.remove("hidden");
    el.innerHTML = `<h1>${WIN_LABEL_VI[currentRoom.winner]}</h1>`;
  } else {
    el.classList.add("hidden");
  }
}

// ============================================================
// 4. BIND UI EVENTS
// ============================================================
export function bindPlayerUI() {
  $("#btnJoinGame").onclick = () => {
    const code = $("#inputRoomCodePlayer").value.trim();
    const name = $("#inputPlayerName").value.trim();
    if (!code || !name) {
      alert("Vui lòng nhập đầy đủ Mã phòng và Tên!");
      return;
    }
    joinRoom(code, name);
  };
}

window.addEventListener("DOMContentLoaded", bindPlayerUI);
