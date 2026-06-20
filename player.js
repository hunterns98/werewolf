// ============================================================
// PLAYER.JS — GIAO DIỆN NGƯỜI CHƠI v3.0
// ============================================================
// v3.0 thêm: hiển thị vai trò người yêu (Cupid bền vững qua biến đổi),
// ẩn nguyên nhân chết, chặn chat khi đã chết, UI tự bấm hành động đêm
// (Player Action Mode) cho Sói/Tiên Tri/Bảo Vệ/Cupid/Phù Thủy/Ăn Trộm/
// Thổi Sáo/Sói Nguyền/Con Hoang, UI Thợ Săn tự chọn kéo theo, và màn
// hình cuối game: Reveal vai trò + Toàn bộ lịch sử trận đấu.
// Toàn bộ luồng v2.0 (join room, vote, chat, render cơ bản) GIỮ NGUYÊN.
// ============================================================

import { db, doc, setDoc, getDoc, updateDoc, onSnapshot } from "./firebase.js";
import {
  ROLE_LABEL_VI, ROLE_TEAM, ROLE_TEAM_LABEL_VI, getAlivePlayers, WIN_LABEL_VI,
  groupSecretLog, formatSecretEntry,
} from "./game.js";

let roomCode = null;
let myId = null;
let myName = null;
let roomRefDoc = null;
let currentRoom = null;
let unsubscribe = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

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
  const me = currentRoom.players[myId];
  if (!me || me.alive === false) { alert("Bạn đã mất, không thể chat với phe sống!"); return; }
  const chat = currentRoom.chat || {};
  const messages = [...(chat[channel] || [])];
  messages.push({ id: myId, name: myName, text: text.trim(), time: Date.now() });
  // Keep last 50 messages
  if (messages.length > 50) messages.splice(0, messages.length - 50);
  await updateDoc(roomRefDoc, { [`chat.${channel}`]: messages });
}

// ============================================================
// 3b. NIGHT ACTION — PLAYER ACTION MODE
// ============================================================
// Khi settings.actionMode === "player", người chơi tự ghi lựa chọn của
// mình thẳng vào nightState (qua field-path update, giống cách castVote
// đã ghi vào dayVotes.{myId}). Admin chỉ cần bấm 1 nút "Xác nhận" để
// chuyển bước — không tạo logic tính toán song song ở phía client này.

async function setNightField(path, value) {
  if (!roomRefDoc) return;
  await updateDoc(roomRefDoc, { [path]: value });
}

async function toggleMultiPending(stepKey, field, id, max) {
  const current = (currentRoom.nightState?.[stepKey]?.[field]) || [];
  let updated;
  if (current.includes(id)) {
    updated = current.filter((x) => x !== id);
  } else {
    if (current.length >= max) { alert(`Chỉ chọn tối đa ${max} người!`); return; }
    updated = [...current, id];
  }
  await setNightField(`nightState.${stepKey}.${field}`, updated);
}

function buildSelectButtonsHtml(list, selectedId, cls) {
  return `<div class="select-wrap">` + list.map((p) =>
    `<button class="select-option ${cls} ${selectedId === p.id ? "active" : ""}" data-id="${p.id}">${p.name}</button>`
  ).join("") + `</div>`;
}

function buildMultiSelectButtonsHtml(list, selectedIds, cls) {
  return `<div class="select-wrap">` + list.map((p) =>
    `<button class="select-option ${cls} ${selectedIds.includes(p.id) ? "active" : ""}" data-id="${p.id}">${p.name}</button>`
  ).join("") + `</div>`;
}

function renderNightActionPlayer(me, isAlive) {
  const el = $("#nightActionPlayer");
  if (!el) return;
  const actionMode = currentRoom.settings?.actionMode || "admin";
  if (actionMode !== "player" || currentRoom.phase !== "night" || !isAlive || !me.role) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  const step = currentRoom.nightStep;
  const round = currentRoom.round;
  const ns = currentRoom.nightState || {};
  const players = currentRoom.players;
  const alive = getAlivePlayers(players);

  let html = "";
  let canAct = false;

  if (step === "werewolf" && me.role === "werewolf") {
    canAct = true;
    const votes = ns.werewolf?.votes || {};
    const myVote = votes[myId];
    const targets = alive.filter((p) => p.role !== "werewolf" && p.role !== "cursed_wolf");
    html += `<h3>🐺 Chọn nạn nhân</h3>`;
    html += buildSelectButtonsHtml(targets, myVote, "wolf-target-btn");
    html += `<p class="note-disabled" style="margin-top:8px">Lựa chọn của các Sói (realtime):</p>`;
    const rows = Object.entries(votes)
      .map(([wid, tid]) => `<div class="vote-row"><span>${players[wid]?.name || "?"}</span><span>${tid ? players[tid]?.name : "(chưa chọn)"}</span></div>`)
      .join("");
    html += rows || `<p class="note-disabled">Chưa có Sói nào chọn.</p>`;
  } else if (step === "cursed_wolf" && me.role === "cursed_wolf") {
    canAct = true;
    const target = ns.cursed_wolf?.target;
    const targets = alive.filter((p) => p.role !== "werewolf" && p.role !== "cursed_wolf");
    html += `<h3>🌀 Biến 1 người thành Sói</h3>`;
    html += buildSelectButtonsHtml(targets, target, "cursed-target-btn");
  } else if (step === "seer" && me.role === "seer") {
    canAct = true;
    const target = ns.seer?.target;
    html += `<h3>🔮 Soi 1 người</h3>`;
    html += buildSelectButtonsHtml(alive.filter((p) => p.id !== myId), target, "seer-target-btn");
  } else if (step === "guardian" && me.role === "guardian") {
    canAct = true;
    const target = ns.guardian?.protect;
    const lastProtect = currentRoom.guardianLastProtect;
    const targets = alive.filter((p) => p.id !== lastProtect);
    html += `<h3>🛡️ Chọn người bảo vệ</h3>`;
    if (lastProtect && players[lastProtect]) {
      html += `<p class="note-disabled">(${players[lastProtect].name} không thể chọn lại đêm này — đã bảo vệ đêm trước)</p>`;
    }
    html += buildSelectButtonsHtml(targets, target, "guardian-target-btn");
  } else if (step === "cupid" && me.role === "cupid" && round === 1) {
    canAct = true;
    const lovers = ns.cupid?.lovers || [];
    html += `<h3>💘 Chọn 2 người yêu nhau</h3>`;
    html += buildMultiSelectButtonsHtml(alive, lovers, "cupid-btn");
  } else if (step === "thief" && me.role === "thief" && round === 1) {
    canAct = true;
    const options = currentRoom.thiefOptions || [];
    const chosen = ns.thief?.chosenRole;
    html += `<h3>🃏 Chọn 1 trong 2 vai trò</h3>`;
    html += `<div class="select-wrap">` + options.map((r, i) =>
      `<button class="select-option thief-opt-btn ${chosen === r ? "active" : ""}" data-role="${r}">${i + 1}. ${ROLE_LABEL_VI[r] || r}</button>`
    ).join("") + `</div>`;
  } else if (step === "witch" && me.role === "witch") {
    canAct = true;
    const wolfTargetId = ns.werewolf?.target;
    const wolfTarget = wolfTargetId ? players[wolfTargetId] : null;
    const witchUsage = currentRoom.witchUsage || {};
    const save = !!ns.witch?.save;
    const poisonTarget = ns.witch?.poisonTarget;
    html += `<h3>🧪 Hành động Phù Thủy</h3>`;
    html += `<p class="witch-info">${wolfTarget ? `🐺 Sói cắn: ${wolfTarget.name}` : "🐺 Sói không cắn ai."}</p>`;
    if (wolfTarget && !witchUsage.healUsed) {
      html += `<button class="select-option witch-save-btn ${save ? "active" : ""}">💊 Cứu ${wolfTarget.name}</button>`;
    } else if (witchUsage.healUsed) {
      html += `<p class="note-disabled">(Đã dùng thuốc cứu)</p>`;
    }
    if (!witchUsage.poisonUsed) {
      html += `<p style="margin-top:8px">☠️ Đầu độc (tùy chọn):</p>`;
      html += `<div class="select-wrap">` + alive.filter((p) => p.id !== wolfTargetId).map((p) =>
        `<button class="select-option witch-poison-btn ${poisonTarget === p.id ? "active" : ""}" data-id="${p.id}">${p.name}</button>`
      ).join("") + `</div>`;
    } else {
      html += `<p class="note-disabled">(Đã dùng thuốc độc)</p>`;
    }
  } else if (step === "flute_player" && me.role === "flute_player") {
    canAct = true;
    const targets = ns.flute_player?.targets || [];
    html += `<h3>🎶 Chọn 2 người để ru ngủ</h3>`;
    html += buildMultiSelectButtonsHtml(alive.filter((p) => p.id !== myId), targets, "flute-btn");
  } else if (step === "wild_child" && me.role === "wild_child" && round === 1) {
    canAct = true;
    const parentId = ns.wild_child?.adoptParentId;
    html += `<h3>👩 Chọn mẹ nuôi</h3>`;
    html += buildSelectButtonsHtml(alive.filter((p) => p.id !== myId), parentId, "wild-child-btn");
  }

  if (!canAct) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  html += `<p class="note-disabled" style="margin-top:8px">⏳ Admin sẽ xác nhận để chuyển sang bước tiếp theo.</p>`;
  el.classList.remove("hidden");
  el.innerHTML = html;
  bindNightActionPlayerEvents(step);
}

function bindNightActionPlayerEvents(step) {
  if (step === "werewolf") {
    $$(".wolf-target-btn").forEach((btn) => btn.onclick = () => setNightField(`nightState.werewolf.votes.${myId}`, btn.dataset.id));
  } else if (step === "cursed_wolf") {
    $$(".cursed-target-btn").forEach((btn) => btn.onclick = () => setNightField("nightState.cursed_wolf.target", btn.dataset.id));
  } else if (step === "seer") {
    $$(".seer-target-btn").forEach((btn) => btn.onclick = () => setNightField("nightState.seer.target", btn.dataset.id));
  } else if (step === "guardian") {
    $$(".guardian-target-btn").forEach((btn) => btn.onclick = () => setNightField("nightState.guardian.protect", btn.dataset.id));
  } else if (step === "cupid") {
    $$(".cupid-btn").forEach((btn) => btn.onclick = () => toggleMultiPending("cupid", "lovers", btn.dataset.id, 2));
  } else if (step === "thief") {
    $$(".thief-opt-btn").forEach((btn) => btn.onclick = () => setNightField("nightState.thief.chosenRole", btn.dataset.role));
  } else if (step === "witch") {
    const saveBtn = $(".witch-save-btn");
    if (saveBtn) saveBtn.onclick = () => setNightField("nightState.witch.save", !saveBtn.classList.contains("active"));
    $$(".witch-poison-btn").forEach((btn) => btn.onclick = () => {
      const cur = currentRoom.nightState?.witch?.poisonTarget;
      setNightField("nightState.witch.poisonTarget", cur === btn.dataset.id ? null : btn.dataset.id);
    });
  } else if (step === "flute_player") {
    $$(".flute-btn").forEach((btn) => btn.onclick = () => toggleMultiPending("flute_player", "targets", btn.dataset.id, 2));
  } else if (step === "wild_child") {
    $$(".wild-child-btn").forEach((btn) => btn.onclick = () => setNightField("nightState.wild_child.adoptParentId", btn.dataset.id));
  }
}

function renderHunterPullPlayer() {
  const el = $("#hunterPullPlayer");
  if (!el) return;
  const pending = currentRoom.hunterPending;
  const actionMode = currentRoom.settings?.actionMode || "admin";
  if (!pending || pending.hunterId !== myId || actionMode !== "player") {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  const alive = getAlivePlayers(currentRoom.players).filter((p) => p.id !== myId);
  const target = pending.pendingTarget;
  el.innerHTML = `<h3>🏹 Bạn vừa chết! Chọn người kéo theo:</h3>` +
    buildSelectButtonsHtml(alive, target, "hunter-pull-btn") +
    `<p class="note-disabled" style="margin-top:8px">⏳ Admin sẽ xác nhận lựa chọn này.</p>`;
  $$(".hunter-pull-btn").forEach((btn) => btn.onclick = () => setNightField("hunterPending.pendingTarget", btn.dataset.id));
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
  renderNightActionPlayer(me, isAlive);
  renderHunterPullPlayer();
  renderDeathScreen(isAlive, isAssigned);
  renderRoleRevealDebug();
  renderLogsForPlayer();
  renderWinBanner();
  renderChatPanels(me, isAlive);
  renderSeerHistory(me);
  renderLoverInfo(me, isAlive);
  renderTimer();
  renderEndGameReveal();
  renderTimelineReveal();
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
  const partner = me.isLover && me.loverPartnerId ? currentRoom.players[me.loverPartnerId] : null;
  card.innerHTML = `
    <div class="role-name">${ROLE_LABEL_VI[me.role] || me.role}</div>
    ${me.isLover ? `<div class="lover-badge">💞 Cặp đôi với ${partner ? partner.name : "?"}</div>` : ""}
    <div class="role-desc">${getRoleDescription(me.role)}</div>
  `;
}

function getRoleDescription(role) {
  const desc = {
    werewolf: "Mỗi đêm cùng đồng đội chọn 1 người để cắn chết. Hãy giả vờ là dân làng ban ngày!",
    seer: "Mỗi đêm soi 1 người để biết có phải Sói hay không.",
    witch: "Có 1 thuốc cứu và 1 thuốc độc, mỗi loại dùng 1 lần cả game.",
    guardian: "Mỗi đêm chọn 1 người bảo vệ khỏi sói. Không được bảo vệ cùng 1 người 2 đêm liên tiếp.",
    cupid: "Đêm đầu tiên ghép 2 người thành cặp đôi. Nếu 1 người chết, người còn lại chết theo!",
    villager: "Không có khả năng đặc biệt. Hãy dùng lý lẽ để tìm ra Sói ban ngày!",
    hunter: "Khi bị chết (bất kỳ lý do), có thể kéo 1 người chết theo.",
    elder: "Có 2 mạng! Sói cắn lần đầu không chết. Nhưng thuốc độc + sói cùng đêm thì chết.",
    flute_player: "Phe thứ 3. Mỗi đêm ru ngủ 2 người. Thắng khi tất cả người sống bị mê hoặc.",
    thief: "Đêm đầu tiên chọn 1 trong 2 vai trò dự phòng để đổi sang vai đó.",
    traitor: "Phe thứ 3. Có thể quan sát sói ban đêm. Có điều kiện thắng riêng.",
    cursed_wolf: "Từ đêm thứ 2, mỗi đêm có thể biến 1 người thành Sói. Không bị Bảo vệ/Phù Thủy/Già Làng chặn.",
    wild_child: "Ban đầu phe Dân. Đêm đầu chọn 1 'mẹ nuôi'. Nếu mẹ nuôi còn sống, bạn vẫn là Dân Làng. Nếu mẹ nuôi chết, bạn hóa thành Sói và thắng theo phe Sói!",
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
    .map((l) => {
      // Ẩn nguyên nhân chết với Player — format gốc luôn là "💀 Tên đã chết — Nguyên nhân"
      const text = l.type === "death" ? l.text.split(" — ")[0] : l.text;
      return `<div class="log-entry log-${l.type}">[V${l.round}] ${text}</div>`;
    })
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
      <div>❤️ Bạn là cặp đôi với: <strong>${partner.name}</strong></div>
      <div>${partnerAlive ? "🟢 Còn sống" : "💔 Đã mất"}</div>
      <div class="lover-role-info">🎭 Chức năng hiện tại của ${partner.name}: <strong>${ROLE_LABEL_VI[partner.role] || "?"}</strong></div>
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
      toggleChatInput("wolfChatInput", "wolfChatSend", isAlive);
    } else {
      wolfChatSection.classList.add("hidden");
    }
  }

  // Lover chat — always shown to lovers (kể cả sau khi role biến đổi)
  const loverChatSection = $("#loverChatSection");
  if (loverChatSection) {
    if (me.isLover) {
      loverChatSection.classList.remove("hidden");
      renderChatMessages("loverChatMessages", currentRoom.chat?.lovers || []);
      toggleChatInput("loverChatInput", "loverChatSend", isAlive);
    } else {
      loverChatSection.classList.add("hidden");
    }
  }
}

function toggleChatInput(inputId, sendId, isAlive) {
  const input = $(`#${inputId}`);
  const send = $(`#${sendId}`);
  if (input) {
    input.disabled = !isAlive;
    input.placeholder = isAlive ? input.placeholder.replace("Bạn đã mất, không thể chat", "Nhắn tin...") : "Bạn đã mất, không thể chat";
  }
  if (send) send.disabled = !isAlive;
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
// 4b. END GAME — ROLE REVEAL & FULL TIMELINE REVEAL
// ============================================================

function renderEndGameReveal() {
  const el = $("#endGameRevealSection");
  if (!el) return;
  if (currentRoom.phase !== "ended") {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  const players = currentRoom.players || {};
  let html = `<h3>🎉 Kết quả game — Vai trò tất cả</h3>`;
  Object.values(players).forEach((p) => {
    const changed = p.originalRole && p.originalRole !== p.role;
    const team = ROLE_TEAM[p.role];
    html += `<div class="player-row ${p.alive === false ? "dead" : ""}">
      <span>${p.alive === false ? "💀" : "🟢"} ${p.name}</span>
      <span class="player-role">
        Ban đầu: ${ROLE_LABEL_VI[p.originalRole] || ROLE_LABEL_VI[p.role] || "?"}${changed ? ` → Hiện tại: ${ROLE_LABEL_VI[p.role] || p.role}` : ""}
        · ${ROLE_TEAM_LABEL_VI[team] || ""}
      </span>
    </div>`;
  });
  el.innerHTML = html;
}

function renderTimelineReveal() {
  const el = $("#timelineRevealSection");
  if (!el) return;
  if (currentRoom.phase !== "ended") {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  const groups = groupSecretLog(currentRoom.secretLog || []);
  let html = `<h3>📜 Toàn bộ lịch sử trận đấu</h3>`;
  if (groups.length === 0) {
    html += `<p class="note-disabled">Không có dữ liệu lịch sử.</p>`;
  } else {
    groups.forEach((g) => {
      html += `<div class="timeline-header">${g.phase === "night" ? "🌙 Đêm" : "☀️ Ngày"} ${g.round}</div>`;
      g.entries.forEach((e) => {
        html += `<div class="log-entry">${formatSecretEntry(e)}</div>`;
      });
    });
  }
  el.innerHTML = html;
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
