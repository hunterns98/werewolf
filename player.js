// ============================================================
// PLAYER.JS — GIAO DIỆN NGƯỜI CHƠI v2.0
// ============================================================

import { db, doc, setDoc, getDoc, updateDoc, onSnapshot } from "./firebase.js";
import { ROLE_LABEL_VI, ROLE_TEAM, getAlivePlayers, WIN_LABEL_VI } from "./game.js";

let roomCode = null;
let myId = null;
let myName = null;
let roomRefDoc = null;
let currentRoom = null;
let unsubscribe = null;

const $ = (sel) => document.querySelector(sel);

function genPlayerId() {
  return "p_" + Math.random().toString(36).substring(2, 10);
}

// ============================================================
// 1. JOIN ROOM
// ============================================================

export async function joinRoom(code, name) {
  roomCode = code.trim().toUpperCase();
  roomRefDoc = doc(db, "rooms", roomCode);

  let testMode = false;
  try {
    const snap = await getDoc(roomRefDoc);
    if (snap.exists()) testMode = !!snap.data().settings?.testMode;
  } catch (e) { testMode = false; }

  const storageKey = `maso_player_${roomCode}`;

  if (testMode) {
    myId = genPlayerId();
    myName = name.trim();
  } else {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (saved && saved.id) {
      myId = saved.id;
      myName = saved.name;
    } else {
      myId = genPlayerId();
      myName = name.trim();
      localStorage.setItem(storageKey, JSON.stringify({ id: myId, name: myName }));
    }
  }

  await updateDoc(roomRefDoc, {
    [`players.${myId}`]: { name: myName, alive: true },
  }).catch(async () => {
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

export function tryAutoJoin(code) {
  const storageKey = `maso_player_${code.toUpperCase()}`;
  const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
  if (saved && saved.id) {
    $("#inputPlayerName").value = saved.name;
  }
}

// ============================================================
// 2. VOTE
// ============================================================

export async function castVote(targetId) {
  if (!currentRoom || currentRoom.phase !== "day") return;
  const me = currentRoom.players[myId];
  if (!me || me.alive === false) { alert("Bạn đã chết, không thể vote!"); return; }
  // Allow un-vote by passing null
  await updateDoc(roomRefDoc, {
    [`dayVotes.${myId}`]: targetId,
  });
}

// ============================================================
// 3. CHAT
// ============================================================

async function sendChatMessage(channel, text) {
  if (!text.trim()) return;
  const chat = currentRoom.chat || {};
  const messages = [...(chat[channel] || [])];
  messages.push({ id: myId, name: myName, text: text.trim(), time: Date.now() });
  // Keep last 50 messages
  if (messages.length > 50) messages.splice(0, messages.length - 50);
  await updateDoc(roomRefDoc, { [`chat.${channel}`]: messages });
}

// ============================================================
// 4. RENDER
// ============================================================

function renderPlayerScreen() {
  if (!currentRoom) return;
  const me = currentRoom.players[myId] || {};
  const isAlive = me.alive !== false;
  const isAssigned = !!me.role;

  renderStatusBar(me, isAlive);
  renderRoleCard(me, isAlive);
  renderPhaseInfo();
  renderAliveList();
  renderVotingArea(isAlive);
  renderDeathScreen(isAlive, isAssigned);
  renderRoleRevealDebug();
  renderLogsForPlayer();
  renderWinBanner();
  renderChatPanels(me, isAlive);
  renderSeerHistory(me);
  renderLoverInfo(me, isAlive);
  renderTimer();
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
    <div class="role-name">${ROLE_LABEL_VI[me.role] || me.role}</div>
    ${me.isLover ? `<div class="lover-badge">💞 Bạn là cặp đôi</div>` : ""}
    <div class="role-desc">${getRoleDescription(me.role)}</div>
  `;
}

function getRoleDescription(role) {
  const desc = {
    werewolf: "Mỗi đêm cùng đồng đội chọn 1 người để cắn chết. Hãy giả vờ là dân làng ban ngày!",
    seer: "Mỗi đêm soi 1 người để biết có phải Sói hay không.",
    witch: "Có 1 thuốc cứu và 1 thuốc độc, mỗi loại dùng 1 lần cả game.",
    guardian: "Mỗi đêm chọn 1 người bảo vệ khỏi sói.",
    cupid: "Đêm đầu tiên ghép 2 người thành cặp đôi. Nếu 1 người chết, người còn lại chết theo!",
    villager: "Không có khả năng đặc biệt. Hãy dùng lý lẽ để tìm ra Sói ban ngày!",
    hunter: "Khi bị chết (bất kỳ lý do), có thể kéo 1 người chết theo.",
    elder: "Có 2 mạng! Sói cắn lần đầu không chết. Nhưng thuốc độc + sói cùng đêm thì chết.",
    flute_player: "Phe thứ 3. Mỗi đêm ru ngủ 2 người. Thắng khi tất cả người sống bị mê hoặc.",
    thief: "Đêm đầu tiên chọn 1 trong 2 vai trò dự phòng để đổi sang vai đó.",
    traitor: "Phe thứ 3. Có thể quan sát sói ban đêm. Có điều kiện thắng riêng.",
    cursed_wolf: "Mỗi đêm thứ 2 có thể biến 1 người thành Sói. Không bị Bảo vệ/Phù Thủy chặn.",
  };
  return desc[role] || "";
}

function renderPhaseInfo() {
  const el = $("#phaseInfoPlayer");
  const { phase, round } = currentRoom;
  const labels = {
    lobby: "🛋️ Đang chờ trong phòng chờ...",
    night: `🌙 ĐÊM ${round} — Mọi người im lặng...`,
    day: `☀️ NGÀY ${round} — Thảo luận và bỏ phiếu!`,
    ended: "🏁 GAME ĐÃ KẾT THÚC",
  };
  el.textContent = labels[phase] || "";
  el.className = `phase-info phase-${phase}`;
}

function renderAliveList() {
  const el = $("#aliveListPlayer");
  if (!el) return;
  const players = currentRoom.players || {};
  const alive = getAlivePlayers(players);
  const dead = Object.entries(players).filter(([, p]) => p.alive === false);

  let html = `<div class="alive-counter">👥 Còn sống: ${alive.length} / ${Object.keys(players).length}</div>`;
  html += `<div class="player-list-compact">`;
  alive.forEach(p => {
    html += `<span class="player-chip alive">🟢 ${p.name}</span>`;
  });
  dead.forEach(([, p]) => {
    html += `<span class="player-chip dead">🔴 ${p.name}</span>`;
  });
  html += `</div>`;
  el.innerHTML = html;
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
  const votes = currentRoom.dayVotes || {};

  // Sort by vote count
  const voteCount = {};
  Object.values(votes).forEach(tid => { if (tid) voteCount[tid] = (voteCount[tid] || 0) + 1; });

  const alivePlayers = getAlivePlayers(currentRoom.players)
    .filter(p => p.id !== myId)
    .sort((a, b) => (voteCount[b.id] || 0) - (voteCount[a.id] || 0));

  alivePlayers.forEach((p) => {
    const btn = document.createElement("button");
    btn.className = "select-option vote-btn";
    if (myVote === p.id) btn.classList.add("active");
    const vc = voteCount[p.id] || 0;
    btn.textContent = `${p.name}${vc > 0 ? ` (${vc} phiếu)` : ""}`;
    btn.onclick = () => castVote(myVote === p.id ? null : p.id); // toggle vote
    area.appendChild(btn);
  });

  if (myVote) {
    const note = document.createElement("p");
    note.className = "note-disabled";
    note.textContent = `Bạn đã vote cho: ${currentRoom.players[myVote]?.name || "?"}. Bấm lại để bỏ vote.`;
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
  section.innerHTML = `<h3>🔍 (Debug) Vai trò tất cả:</h3>`;
  Object.values(currentRoom.players).forEach((p) => {
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `<span>${p.alive === false ? "💀" : "🟢"} ${p.name}</span><span>${p.role ? ROLE_LABEL_VI[p.role] : "?"}</span>`;
    section.appendChild(row);
  });
}

function renderLogsForPlayer() {
  const el = $("#logPanelPlayer");
  const logs = (currentRoom.logs || []).filter((l) => l.type !== "info");
  el.innerHTML = logs.slice().reverse()
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

function renderSeerHistory(me) {
  const el = $("#seerHistorySection");
  if (!el) return;
  if (me.role !== "seer") {
    el.classList.add("hidden");
    return;
  }
  const seerHistory = currentRoom.seerHistory || {};
  if (Object.keys(seerHistory).length === 0) {
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = `<h3>🔮 Lịch sử soi của bạn:</h3>`;
  Object.entries(seerHistory).sort((a, b) => a[0] - b[0]).forEach(([round, entry]) => {
    const div = document.createElement("div");
    div.className = "seer-history-row";
    div.innerHTML = `<strong>Đêm ${round}:</strong> Đã soi <b>${entry.targetName}</b> → ${entry.isWerewolf ? "🐺 LÀ MA SÓI" : "👤 Không phải Ma Sói"}`;
    el.appendChild(div);
  });
}

function renderLoverInfo(me, isAlive) {
  const el = $("#loverInfoSection");
  if (!el) return;
  if (!me.isLover || !me.loverPartnerId) {
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  const partner = currentRoom.players[me.loverPartnerId];
  if (!partner) return;

  const partnerAlive = partner.alive !== false;
  el.innerHTML = `
    <div class="lover-card">
      <div>❤️ Người yêu của bạn: <strong>${partner.name}</strong></div>
      <div>${partnerAlive ? "🟢 Còn sống" : "💔 Đã chết"}</div>
      ${!partnerAlive ? `<div class="lover-death-notice">💔 Người yêu của bạn đã mất... Bạn cũng sẽ ra đi theo.</div>` : ""}
    </div>
  `;
}

function renderChatPanels(me, isAlive) {
  // Wolf chat — shown to werewolves at night
  const wolfChatSection = $("#wolfChatSection");
  if (wolfChatSection) {
    const isWolf = me.role === "werewolf" || me.role === "cursed_wolf";
    const isNight = currentRoom.phase === "night";
    if (isWolf && isNight) {
      wolfChatSection.classList.remove("hidden");
      renderChatMessages("wolfChatMessages", currentRoom.chat?.wolf || []);
    } else {
      wolfChatSection.classList.add("hidden");
    }
  }

  // Lover chat — always shown to lovers
  const loverChatSection = $("#loverChatSection");
  if (loverChatSection) {
    if (me.isLover) {
      loverChatSection.classList.remove("hidden");
      renderChatMessages("loverChatMessages", currentRoom.chat?.lovers || []);
    } else {
      loverChatSection.classList.add("hidden");
    }
  }
}

function renderChatMessages(elId, messages) {
  const el = $(`#${elId}`);
  if (!el) return;
  const last20 = messages.slice(-20);
  el.innerHTML = last20.map(m =>
    `<div class="chat-msg ${m.id === myId ? "chat-mine" : ""}">
      <strong>${m.id === myId ? "Bạn" : m.name}:</strong> ${escapeHtml(m.text)}
    </div>`
  ).join("");
  el.scrollTop = el.scrollHeight;
}

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderTimer() {
  const el = $("#playerTimerDisplay");
  if (!el) return;
  if (currentRoom.phase !== "day" || !currentRoom.timerEndAt) {
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  const remaining = Math.max(0, Math.floor((currentRoom.timerEndAt - Date.now()) / 1000));
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  el.textContent = `⏱️ Còn lại: ${m}:${s.toString().padStart(2, "0")}`;
  el.className = `timer-display ${remaining <= 30 ? "timer-urgent" : ""}`;
  if (remaining > 0) {
    setTimeout(renderTimer, 1000);
  }
}

// ============================================================
// 5. BIND UI EVENTS
// ============================================================
export function bindPlayerUI() {
  $("#btnJoinGame").onclick = () => {
    const code = $("#inputRoomCodePlayer").value.trim();
    const name = $("#inputPlayerName").value.trim();
    if (!code || !name) { alert("Vui lòng nhập đầy đủ Mã phòng và Tên!"); return; }
    joinRoom(code, name);
  };

  // Wolf chat send
  const wolfSendBtn = $("#wolfChatSend");
  if (wolfSendBtn) {
    wolfSendBtn.onclick = () => {
      const input = $("#wolfChatInput");
      if (input?.value.trim()) {
        sendChatMessage("wolf", input.value);
        input.value = "";
      }
    };
  }

  // Lover chat send
  const loverSendBtn = $("#loverChatSend");
  if (loverSendBtn) {
    loverSendBtn.onclick = () => {
      const input = $("#loverChatInput");
      if (input?.value.trim()) {
        sendChatMessage("lovers", input.value);
        input.value = "";
      }
    };
  }

  // Enter key for chat inputs
  ["wolfChatInput", "loverChatInput"].forEach(id => {
    const input = $(`#${id}`);
    if (input) {
      input.onkeydown = (e) => {
        if (e.key === "Enter") $(`#${id.replace("Input", "Send")}`).click();
      };
    }
  });
}

window.addEventListener("DOMContentLoaded", bindPlayerUI);
