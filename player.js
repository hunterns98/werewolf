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
// PLAYER ACTION MODE — submit night action to Firestore
// ============================================================

export async function submitPlayerNightAction(step, data) {
  if (!roomRefDoc) return;
  await updateDoc(roomRefDoc, {
    playerNightAction: { step, data, playerId: myId, processed: false, time: Date.now() },
  });
}

export async function submitPlayerHunterAction(targetId) {
  if (!roomRefDoc) return;
  await updateDoc(roomRefDoc, {
    playerHunterAction: { targetId, playerId: myId, processed: false, time: Date.now() },
  });
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
  // Người chết không được gửi
  const me = currentRoom?.players?.[myId];
  if (!me || me.alive === false) return;

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
  renderNightActionForPlayer(me, isAlive);
  renderHunterActionForPlayer(me, isAlive);
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

function renderNightActionForPlayer(me, isAlive) {
  const area = $("#playerNightActionArea");
  if (!area) return;
  area.innerHTML = "";

  const isPlayerActionMode = currentRoom.settings?.gameMode === "playerAction";
  if (!isPlayerActionMode || currentRoom.phase !== "night" || !isAlive || !me.role) {
    area.classList.add("hidden");
    return;
  }

  const step = currentRoom.nightStep;
  if (!step) { area.classList.add("hidden"); return; }

  // Check if it's my turn
  const myRoleIsActive = isMyRoleActiveForStep(step, me.role);
  if (!myRoleIsActive) { area.classList.add("hidden"); return; }

  // Check if already submitted
  const submitted = currentRoom.playerNightAction;
  if (submitted && submitted.step === step && submitted.playerId === myId && !submitted.processed) {
    area.classList.remove("hidden");
    area.innerHTML = `
      <div class="panel night-action-panel">
        <h3>${getStepTitle(step)}</h3>
        <div class="waiting-indicator submitted">✅ Đã gửi hành động. Đang chờ Admin xử lý...</div>
      </div>`;
    return;
  }

  area.classList.remove("hidden");
  const panel = document.createElement("div");
  panel.className = "panel night-action-panel";
  const h3 = document.createElement("h3");
  h3.textContent = getStepTitle(step);
  panel.appendChild(h3);

  const alive = Object.entries(currentRoom.players || {})
    .filter(([, p]) => p.alive !== false)
    .map(([id, p]) => ({ id, ...p }));

  buildPlayerNightUI(step, me, alive, panel);
  area.appendChild(panel);
}

function isMyRoleActiveForStep(step, myRole) {
  if (step === "werewolf") return myRole === "werewolf" || myRole === "cursed_wolf";
  if (step === "cursed_wolf") return myRole === "cursed_wolf";
  return myRole === step;
}

function getStepTitle(step) {
  const titles = {
    cupid: "💘 Bạn là Cupid — Chọn 2 người thành cặp đôi",
    thief: "🃏 Bạn là Ăn Trộm — Chọn vai trò muốn đổi",
    guardian: "🛡️ Bạn là Bảo Vệ — Chọn 1 người bảo vệ đêm nay",
    werewolf: "🐺 Bạn là Ma Sói — Chọn nạn nhân đêm nay",
    cursed_wolf: "🌀 Bạn là Sói Nguyền — Chọn 1 người biến thành Sói",
    seer: "🔮 Bạn là Tiên Tri — Chọn 1 người để soi",
    witch: "🧪 Bạn là Phù Thủy — Dùng thuốc của bạn",
    flute_player: "🎶 Bạn là Thổi Sáo — Chọn 2 người ru ngủ",
  };
  return titles[step] || step;
}

function buildPlayerNightUI(step, me, alive, container) {
  if (step === "cupid") {
    buildPlayerMultiSelect(alive, 2, container, "💘 Xác nhận ghép cặp", (selected) => {
      submitPlayerNightAction("cupid", { lovers: selected });
    });
  } else if (step === "guardian") {
    buildPlayerSingleSelect(alive, container, "🛡️ Bảo vệ người này", true, (id) => {
      submitPlayerNightAction("guardian", { protect: id });
    });
  } else if (step === "werewolf") {
    const targets = alive.filter(p => p.id !== me.id && p.role !== "werewolf" && p.role !== "cursed_wolf");
    // Show wolf allies
    const allies = alive.filter(p => p.id !== me.id && (p.role === "werewolf" || p.role === "cursed_wolf"));
    if (allies.length > 0) {
      const note = document.createElement("p");
      note.className = "note-disabled";
      note.textContent = `🐺 Đồng đội sói: ${allies.map(p => p.name).join(", ")}`;
      container.appendChild(note);
    }
    // Show current wolf's target if agreed
    const currentTarget = currentRoom.nightState?.werewolf?.target;
    if (currentTarget && currentRoom.players[currentTarget]) {
      const agreed = document.createElement("p");
      agreed.className = "note-disabled";
      agreed.style.color = "#f1c40f";
      agreed.textContent = `📌 Sói đang nhắm: ${currentRoom.players[currentTarget].name}`;
      container.appendChild(agreed);
    }
    buildPlayerSingleSelect(targets, container, "🐺 Xác nhận cắn", false, (id) => {
      submitPlayerNightAction("werewolf", { target: id });
    });
  } else if (step === "cursed_wolf") {
    const targets = alive.filter(p => p.id !== me.id && p.role !== "werewolf" && p.role !== "cursed_wolf");
    buildPlayerSingleSelect(targets, container, "🌀 Nguyền người này", true, (id) => {
      submitPlayerNightAction("cursed_wolf", { target: id });
    });
  } else if (step === "seer") {
    const seerHistory = currentRoom.seerHistory || {};
    if (Object.keys(seerHistory).length > 0) {
      const hist = document.createElement("div");
      hist.className = "seer-history";
      hist.innerHTML = "<strong>🔮 Lịch sử soi của bạn:</strong>";
      Object.entries(seerHistory).sort((a, b) => a[0] - b[0]).forEach(([round, entry]) => {
        const row = document.createElement("div");
        row.className = "seer-history-row";
        row.innerHTML = `Đêm ${round}: <b>${escapeHtml(entry.targetName)}</b> → ${entry.isWerewolf ? "🐺 LÀ SÓI" : "👤 Không phải sói"}`;
        hist.appendChild(row);
      });
      container.appendChild(hist);
    }
    const targets = alive.filter(p => p.id !== me.id);
    buildPlayerSingleSelect(targets, container, "🔮 Soi người này", false, (id) => {
      submitPlayerNightAction("seer", { target: id });
    });
  } else if (step === "witch") {
    buildPlayerWitchUI(alive, me, container);
  } else if (step === "flute_player") {
    const targets = alive.filter(p => p.id !== me.id);
    buildPlayerMultiSelect(targets, 2, container, "🎶 Ru ngủ 2 người này", (selected) => {
      submitPlayerNightAction("flute_player", { targets: selected });
    }, true);
  } else if (step === "thief") {
    buildPlayerThiefUI(me, container);
  }
}

function buildPlayerSingleSelect(players, container, btnLabel, allowSkip, onConfirm) {
  const wrap = document.createElement("div");
  wrap.className = "select-wrap";
  let selectedId = null;

  players.forEach(p => {
    const btn = document.createElement("button");
    btn.className = "select-option";
    btn.textContent = p.name;
    btn.onclick = () => {
      wrap.querySelectorAll(".select-option").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedId = p.id;
    };
    wrap.appendChild(btn);
  });

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn-big btn-confirm";
  confirmBtn.textContent = `✅ ${btnLabel}`;
  confirmBtn.onclick = () => {
    if (!selectedId) { alert("Vui lòng chọn 1 người!"); return; }
    onConfirm(selectedId);
  };
  wrap.appendChild(confirmBtn);

  if (allowSkip) {
    const skipBtn = document.createElement("button");
    skipBtn.className = "btn-big btn-skip";
    skipBtn.textContent = "⏭️ Bỏ qua (không làm gì)";
    skipBtn.onclick = () => onConfirm(null);
    wrap.appendChild(skipBtn);
  }

  container.appendChild(wrap);
}

function buildPlayerMultiSelect(players, maxCount, container, btnLabel, onConfirm, allowSkip = false) {
  const wrap = document.createElement("div");
  wrap.className = "select-wrap";
  let selected = [];

  players.forEach(p => {
    const btn = document.createElement("button");
    btn.className = "select-option";
    btn.textContent = p.name;
    btn.onclick = () => {
      if (selected.includes(p.id)) {
        selected = selected.filter(x => x !== p.id);
        btn.classList.remove("active");
      } else {
        if (selected.length >= maxCount) { alert(`Chỉ chọn tối đa ${maxCount} người!`); return; }
        selected.push(p.id);
        btn.classList.add("active");
      }
    };
    wrap.appendChild(btn);
  });

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn-big btn-confirm";
  confirmBtn.textContent = `✅ ${btnLabel}`;
  confirmBtn.onclick = () => {
    if (selected.length < 1) { alert("Cần chọn ít nhất 1 người!"); return; }
    onConfirm(selected);
  };
  wrap.appendChild(confirmBtn);

  if (allowSkip) {
    const skipBtn = document.createElement("button");
    skipBtn.className = "btn-big btn-skip";
    skipBtn.textContent = "⏭️ Bỏ qua";
    skipBtn.onclick = () => onConfirm([]);
    wrap.appendChild(skipBtn);
  }

  container.appendChild(wrap);
}

function buildPlayerWitchUI(alive, me, container) {
  const nightState = currentRoom.nightState;
  const wolfTargetId = nightState?.werewolf?.target;
  const wolfTarget = wolfTargetId ? currentRoom.players[wolfTargetId] : null;
  const witchUsage = currentRoom.witchUsage || { healUsed: false, poisonUsed: false };

  const info = document.createElement("p");
  info.className = "witch-info";
  info.textContent = wolfTarget ? `🐺 Sói cắn đêm nay: ${wolfTarget.name}` : "🐺 Sói không cắn ai đêm nay.";
  container.appendChild(info);

  let doSave = false;
  let poisonTarget = null;

  if (wolfTarget && !witchUsage.healUsed) {
    const saveBtn = document.createElement("button");
    saveBtn.className = "select-option";
    saveBtn.textContent = `💊 Cứu ${wolfTarget.name} (còn thuốc cứu)`;
    saveBtn.onclick = () => { doSave = !doSave; saveBtn.classList.toggle("active"); };
    container.appendChild(saveBtn);
  } else if (witchUsage.healUsed) {
    const n = document.createElement("p");
    n.className = "note-disabled";
    n.textContent = "💊 Đã dùng thuốc cứu rồi.";
    container.appendChild(n);
  }

  if (!witchUsage.poisonUsed) {
    const pl = document.createElement("p");
    pl.textContent = "☠️ Đầu độc ai? (tùy chọn):";
    container.appendChild(pl);

    const ps = document.createElement("div");
    ps.className = "select-wrap";
    alive.filter(p => p.id !== wolfTargetId).forEach(p => {
      const opt = document.createElement("button");
      opt.className = "select-option";
      opt.textContent = p.name;
      opt.onclick = () => {
        if (poisonTarget === p.id) {
          poisonTarget = null;
          opt.classList.remove("active");
        } else {
          ps.querySelectorAll(".select-option").forEach(b => b.classList.remove("active"));
          poisonTarget = p.id;
          opt.classList.add("active");
        }
      };
      ps.appendChild(opt);
    });
    container.appendChild(ps);
  } else {
    const n = document.createElement("p");
    n.className = "note-disabled";
    n.textContent = "☠️ Đã dùng thuốc độc rồi.";
    container.appendChild(n);
  }

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn-big btn-confirm";
  confirmBtn.textContent = "✅ Xác nhận hành động";
  confirmBtn.onclick = () => submitPlayerNightAction("witch", { save: doSave, poisonTarget });
  container.appendChild(confirmBtn);

  const skipBtn = document.createElement("button");
  skipBtn.className = "btn-big btn-skip";
  skipBtn.textContent = "⏭️ Không làm gì";
  skipBtn.onclick = () => submitPlayerNightAction("witch", { save: false, poisonTarget: null });
  container.appendChild(skipBtn);
}

function buildPlayerThiefUI(me, container) {
  const options = currentRoom.thiefOptions || ["villager", "villager"];
  const ROLE_LABEL_VI_LOCAL = {
    werewolf: "Ma Sói", seer: "Tiên Tri", witch: "Phù Thủy", guardian: "Bảo Vệ",
    cupid: "Cupid", villager: "Dân Làng", hunter: "Thợ Săn", elder: "Già Làng",
    flute_player: "Thổi Sáo", thief: "Ăn Trộm", traitor: "Phản Bội", cursed_wolf: "Sói Nguyền",
  };

  const lbl = document.createElement("p");
  lbl.textContent = "Chọn 1 trong 2 vai trò dự phòng:";
  container.appendChild(lbl);

  let chosenRole = null;
  options.forEach((role, i) => {
    const btn = document.createElement("button");
    btn.className = "select-option";
    btn.textContent = `${i + 1}. ${ROLE_LABEL_VI_LOCAL[role] || role}`;
    btn.onclick = () => {
      container.querySelectorAll(".select-option").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      chosenRole = role;
    };
    container.appendChild(btn);
  });

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn-big btn-confirm";
  confirmBtn.textContent = "✅ Đổi sang vai này";
  confirmBtn.onclick = () => {
    if (!chosenRole) { alert("Chọn 1 vai trò!"); return; }
    submitPlayerNightAction("thief", { thiefId: myId, chosenRole });
  };
  container.appendChild(confirmBtn);

  const skipBtn = document.createElement("button");
  skipBtn.className = "btn-big btn-skip";
  skipBtn.textContent = "⏭️ Giữ nguyên vai Ăn Trộm";
  skipBtn.onclick = () => submitPlayerNightAction("thief", { thiefId: null, chosenRole: null });
  container.appendChild(skipBtn);
}

function renderHunterActionForPlayer(me, isAlive) {
  const area = $("#playerHunterActionArea");
  if (!area) return;
  area.innerHTML = "";

  const isPlayerActionMode = currentRoom.settings?.gameMode === "playerAction";
  const pending = currentRoom.hunterPending;

  if (!isPlayerActionMode || !pending || pending.hunterId !== myId) {
    area.classList.add("hidden");
    return;
  }

  // Already submitted?
  const submitted = currentRoom.playerHunterAction;
  if (submitted && submitted.playerId === myId && !submitted.processed) {
    area.classList.remove("hidden");
    area.innerHTML = `
      <div class="panel night-action-panel">
        <h3>🏹 Thợ Săn — Bạn đã chết!</h3>
        <div class="waiting-indicator submitted">✅ Đã chọn người kéo theo. Đang xử lý...</div>
      </div>`;
    return;
  }

  area.classList.remove("hidden");
  const panel = document.createElement("div");
  panel.className = "panel night-action-panel hunter-panel";
  panel.innerHTML = `<h3>🏹 Bạn là Thợ Săn và vừa chết! Chọn 1 người kéo theo:</h3>`;

  const alive = Object.entries(currentRoom.players || {})
    .filter(([id, p]) => p.alive !== false && id !== myId)
    .map(([id, p]) => ({ id, ...p }));

  buildPlayerSingleSelect(alive, panel, "🏹 Kéo người này theo", true, (id) => {
    submitPlayerHunterAction(id);
  });

  area.appendChild(panel);
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
  // ── Wolf chat ──────────────────────────────────────────────
  // Hiện: sói còn sống, ban đêm
  // Ẩn input / disable send: nếu sói đã chết
  const wolfChatSection = $("#wolfChatSection");
  if (wolfChatSection) {
    const isWolf = me.role === "werewolf" || me.role === "cursed_wolf";
    const isNight = currentRoom.phase === "night";
    // Chỉ hiện cho sói — alive hay dead đều thấy khung, nhưng chỉ night
    if (isWolf && isNight) {
      wolfChatSection.classList.remove("hidden");
      renderChatMessages("wolfChatMessages", currentRoom.chat?.wolf || []);
      // Disable input nếu đã chết
      const wolfInput = $("#wolfChatInput");
      const wolfSend  = $("#wolfChatSend");
      if (wolfInput) wolfInput.disabled = !isAlive;
      if (wolfSend)  wolfSend.disabled  = !isAlive;
      if (wolfInput) wolfInput.placeholder = isAlive
        ? "Nhắn tin với đồng đội sói..."
        : "Bạn đã chết, không thể chat.";
    } else {
      wolfChatSection.classList.add("hidden");
    }
  }

  // ── Lover chat ─────────────────────────────────────────────
  // Hiện: cả khi sống lẫn chết (để theo dõi)
  // Disable gửi khi chết
  const loverChatSection = $("#loverChatSection");
  if (loverChatSection) {
    if (me.isLover) {
      loverChatSection.classList.remove("hidden");
      renderChatMessages("loverChatMessages", currentRoom.chat?.lovers || []);
      const loverInput = $("#loverChatInput");
      const loverSend  = $("#loverChatSend");
      if (loverInput) loverInput.disabled = !isAlive;
      if (loverSend)  loverSend.disabled  = !isAlive;
      if (loverInput) loverInput.placeholder = isAlive
        ? "Nhắn tin người yêu..."
        : "Bạn đã chết, không thể chat.";
    } else {
      loverChatSection.classList.add("hidden");
    }
  }
}

function renderChatMessages(elId, messages) {
  const el = $(`#${elId}`);
  if (!el) return;
  const last50 = messages.slice(-50);
  el.innerHTML = last50.map(m => {
    const isMine = m.id === myId;
    const timeStr = m.time ? new Date(m.time).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "";
    return `<div class="chat-msg ${isMine ? "chat-mine" : ""}">
      <span class="chat-sender">${isMine ? "Bạn" : escapeHtml(m.name)}</span>
      <span class="chat-time">${timeStr}</span>
      <div class="chat-text">${escapeHtml(m.text)}</div>
    </div>`;
  }).join("");
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
