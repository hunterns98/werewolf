// ============================================================
// ADMIN.JS — ĐIỀU KHIỂN GAME (LAYER "RA LỆNH")
// ============================================================
// Admin KHÔNG tự tính toán logic phức tạp trong UI.
// Mọi tính toán đi qua các hàm thuần trong game.js.
// admin.js chỉ: đọc input UI -> gọi hàm logic -> ghi Firestore.
// ============================================================

import {
  db, doc, setDoc, getDoc, updateDoc, onSnapshot, deleteField, serverTimestamp,
} from "./firebase.js";
import {
  ROLES, ROLE_LABEL_VI, DEATH_CAUSE_LABEL_VI, WIN_LABEL_VI,
  assignRoles, emptyNightState, emptyWitchUsage, getNightStepsForRound, getNextNightStep,
  getAlivePlayers, applyCupid, resolveNight, resolveSeer,
  resolveDayVote, applyDayVoteResult, checkWinCondition, makeLogEntry,
} from "./game.js";

// ---------- STATE CỤC BỘ (chỉ cache để render, nguồn thật luôn là Firestore) ----------
let roomCode = null;
let roomRefDoc = null;
let currentRoom = null; // snapshot gần nhất từ Firestore
let unsubscribe = null;

// ---------- DOM HELPERS ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ============================================================
// 1. TẠO / VÀO PHÒNG
// ============================================================

function genRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

export async function createRoom() {
  const code = genRoomCode();
  const ref = doc(db, "rooms", code);
  await setDoc(ref, {
    phase: "lobby",
    round: 0,
    nightStep: null,
    players: {},
    nightState: null,
    dayVotes: {},
    logs: [makeLogEntry(0, "lobby", "Phòng được tạo. Đang chờ người chơi vào...", "system")],
    settings: { debugMode: false },
    winner: null,
    createdAt: serverTimestamp(),
  });
  enterRoom(code);
  return code;
}

export function enterRoom(code) {
  roomCode = code.toUpperCase();
  roomRefDoc = doc(db, "rooms", roomCode);
  if (unsubscribe) unsubscribe();
  unsubscribe = onSnapshot(roomRefDoc, (snap) => {
    if (!snap.exists()) return;
    currentRoom = snap.data();
    renderAll();
  });
  $("#roomCodeDisplay").textContent = roomCode;
  $("#joinScreen").classList.add("hidden");
  $("#adminScreen").classList.remove("hidden");
}

// ============================================================
// 2. ĐIỀU KHIỂN VÒNG CHƠI
// ============================================================

/**
 * Start game: yêu cầu đúng 11 người trong phòng, random role, chuyển sang night round 1
 */
export async function startGame() {
  if (!currentRoom) return;
  const players = currentRoom.players || {};
  const count = Object.keys(players).length;
  if (count !== 11) {
    alert(`Cần đúng 11 người chơi để bắt đầu. Hiện tại: ${count}`);
    return;
  }

  const withRoles = assignRoles(players);
  const round = 1;
  const nightState = emptyNightState(round);
  const steps = getNightStepsForRound(round);

  await updateDoc(roomRefDoc, {
    players: withRoles,
    phase: "night",
    round,
    nightStep: steps[0], // 'cupid'
    nightState,
    witchUsage: emptyWitchUsage(),
    dayVotes: {},
    winner: null,
    logs: [
      ...currentRoom.logs,
      makeLogEntry(round, "night", "🎮 Game bắt đầu! Vai trò đã được chia. Đêm thứ 1 bắt đầu...", "system"),
    ],
  });
  playSound("start");
}

/**
 * Reset game: xóa role, alive, về lobby
 */
export async function resetGame() {
  if (!currentRoom) return;
  const players = { ...currentRoom.players };
  Object.keys(players).forEach((id) => {
    players[id] = { name: players[id].name }; // chỉ giữ tên
  });
  await updateDoc(roomRefDoc, {
    phase: "lobby",
    round: 0,
    nightStep: null,
    players,
    nightState: null,
    witchUsage: null,
    dayVotes: {},
    winner: null,
    logs: [makeLogEntry(0, "lobby", "🔄 Game đã được reset. Đang chờ bắt đầu lại...", "system")],
  });
}

/**
 * Toggle debug mode (cho phép người chết xem hết role)
 */
export async function toggleDebugMode() {
  if (!currentRoom) return;
  const newVal = !currentRoom.settings?.debugMode;
  await updateDoc(roomRefDoc, { "settings.debugMode": newVal });
}

// ============================================================
// 3. NIGHT ACTIONS — TỪNG BƯỚC THEO THỨ TỰ CHUẨN
// ============================================================

/**
 * Gọi khi admin xác nhận xong 1 bước hành động đêm (đã chọn target trên UI)
 * stepData: dữ liệu cụ thể cho từng bước, ví dụ:
 *  - cupid: { lovers: [idA, idB] }
 *  - guardian: { protect: id }
 *  - werewolf: { target: id }
 *  - seer: { target: id }
 *  - witch: { save: bool, poisonTarget: id|null }
 */
export async function submitNightAction(step, stepData) {
  if (!currentRoom) return;
  const round = currentRoom.round;
  const nightState = { ...currentRoom.nightState };
  let playersUpdate = currentRoom.players;
  let logs = [...currentRoom.logs];

  if (step === "cupid") {
    nightState.cupid = { done: true, lovers: stepData.lovers };
    playersUpdate = applyCupid(currentRoom.players, stepData.lovers);
    const names = stepData.lovers.map((id) => currentRoom.players[id].name).join(" 💞 ");
    logs.push(makeLogEntry(round, "night", `Cupid đã ghép cặp: ${names}`, "info"));
  }

  if (step === "guardian") {
    nightState.guardian = { done: true, protect: stepData.protect };
    logs.push(makeLogEntry(round, "night", `Bảo Vệ đã chọn bảo vệ 1 người (bí mật).`, "info"));
  }

  if (step === "werewolf") {
    nightState.werewolf = { done: true, target: stepData.target };
    logs.push(makeLogEntry(round, "night", `Sói đã chọn nạn nhân (bí mật).`, "info"));
  }

  if (step === "seer") {
    const result = resolveSeer(currentRoom.players, stepData.target);
    nightState.seer = { done: true, target: stepData.target, result };
    logs.push(
      makeLogEntry(
        round,
        "night",
        `Tiên Tri đã soi ${result.targetName}: ${result.isWerewolf ? "LÀ SÓI 🐺" : "không phải sói"}`,
        "info"
      )
    );
  }

  let witchUsageUpdate = currentRoom.witchUsage || emptyWitchUsage();

  if (step === "witch") {
    nightState.witch = {
      done: true,
      save: stepData.save,
      poisonTarget: stepData.poisonTarget || null,
    };
    witchUsageUpdate = {
      healUsed: witchUsageUpdate.healUsed || stepData.save === true,
      poisonUsed: witchUsageUpdate.poisonUsed || !!stepData.poisonTarget,
    };
    logs.push(makeLogEntry(round, "night", `Phù Thủy đã hành động (bí mật).`, "info"));
  }

  // Tính bước kế tiếp TRƯỚC khi ghi, để gộp vào 1 lần update duy nhất
  // (tránh 2 lần updateDoc liên tiếp gây race condition khi đọc currentRoom cũ)
  const nextStep = getNextNightStep(step, round);

  if (nextStep) {
    await updateDoc(roomRefDoc, {
      players: playersUpdate,
      nightState,
      witchUsage: witchUsageUpdate,
      logs,
      nightStep: nextStep,
    });
  } else {
    // Hết các bước đêm -> ghi state cuối cùng rồi resolve toàn bộ đêm ngay (dùng data local, không chờ snapshot quay lại)
    await updateDoc(roomRefDoc, {
      players: playersUpdate,
      nightState,
      witchUsage: witchUsageUpdate,
      logs,
    });
    await resolveNightAndGoToDay({
      ...currentRoom,
      players: playersUpdate,
      nightState,
      witchUsage: witchUsageUpdate,
      logs,
    });
  }
}

/**
 * Resolve toàn bộ đêm: tính ai chết, cập nhật alive, log, check win, rồi chuyển sang Day
 */
async function resolveNightAndGoToDay(roomData) {
  const room = roomData || currentRoom;
  const round = room.round;
  const nightState = room.nightState;
  const { updatedPlayers, deaths } = resolveNight(room.players, nightState);

  let logs = [...room.logs];

  if (deaths.length === 0) {
    logs.push(makeLogEntry(round, "night", `🌙 Đêm thứ ${round}: Không có ai chết!`, "death"));
  } else {
    deaths.forEach((d) => {
      logs.push(
        makeLogEntry(round, "night", `💀 ${d.name} đã chết — ${DEATH_CAUSE_LABEL_VI[d.cause]}`, "death")
      );
    });
  }

  const winner = checkWinCondition(updatedPlayers);

  if (winner) {
    logs.push(makeLogEntry(round, "night", WIN_LABEL_VI[winner], "system"));
    await updateDoc(roomRefDoc, {
      players: updatedPlayers,
      phase: "ended",
      nightStep: null,
      winner,
      logs,
    });
    playSound("death");
    return;
  }

  logs.push(makeLogEntry(round, "day", `☀️ Ngày thứ ${round} bắt đầu. Hãy thảo luận và vote!`, "system"));

  await updateDoc(roomRefDoc, {
    players: updatedPlayers,
    phase: "day",
    nightStep: null,
    dayVotes: {},
    logs,
  });
  playSound("day");
}

/**
 * Admin bấm "Next Phase" ở Day -> resolve vote -> qua Night round kế tiếp (hoặc kết thúc)
 */
export async function resolveDayAndGoToNight() {
  if (!currentRoom) return;
  const round = currentRoom.round;
  const votes = currentRoom.dayVotes || {};
  const { eliminatedId, isTie, tally } = resolveDayVote(votes);

  let logs = [...currentRoom.logs];
  let playersAfterVote = currentRoom.players;

  if (isTie) {
    logs.push(makeLogEntry(round, "day", `⚖️ Vote bị hòa phiếu cao nhất — Không ai bị treo cổ.`, "vote"));
  } else if (!eliminatedId) {
    logs.push(makeLogEntry(round, "day", `Không có phiếu vote nào — Không ai bị treo cổ.`, "vote"));
  } else {
    const { updatedPlayers, deaths } = applyDayVoteResult(currentRoom.players, eliminatedId);
    playersAfterVote = updatedPlayers;
    deaths.forEach((d) => {
      logs.push(
        makeLogEntry(round, "day", `💀 ${d.name} đã chết — ${DEATH_CAUSE_LABEL_VI[d.cause]}`, "death")
      );
    });
  }

  const winner = checkWinCondition(playersAfterVote);
  if (winner) {
    logs.push(makeLogEntry(round, "day", WIN_LABEL_VI[winner], "system"));
    await updateDoc(roomRefDoc, {
      players: playersAfterVote,
      phase: "ended",
      winner,
      logs,
    });
    playSound("death");
    return;
  }

  // Sang đêm kế tiếp
  const nextRound = round + 1;
  const nightState = emptyNightState(nextRound);
  const steps = getNightStepsForRound(nextRound);

  logs.push(makeLogEntry(nextRound, "night", `🌙 Đêm thứ ${nextRound} bắt đầu...`, "system"));

  await updateDoc(roomRefDoc, {
    players: playersAfterVote,
    phase: "night",
    round: nextRound,
    nightStep: steps[0],
    nightState,
    dayVotes: {},
    logs,
  });
  playSound("night");
}

// ============================================================
// 4. PLAYER MANAGEMENT (admin xem/chỉnh sửa danh sách người chơi trong lobby)
// ============================================================

export async function kickPlayer(playerId) {
  if (!currentRoom) return;
  const players = { ...currentRoom.players };
  delete players[playerId];
  await updateDoc(roomRefDoc, { players });
}

// ============================================================
// 5. SOUND
// ============================================================
const SOUNDS = {
  start: "assets/start.mp3",
  night: "assets/night.mp3",
  day: "assets/day.mp3",
  death: "assets/death.mp3",
};
function playSound(key) {
  try {
    const audio = new Audio(SOUNDS[key]);
    audio.volume = 0.6;
    audio.play().catch(() => {});
  } catch (e) {
    /* ignore audio errors silently */
  }
}

// ============================================================
// 6. RENDER UI (đọc currentRoom -> vẽ lại DOM)
// ============================================================

function renderAll() {
  if (!currentRoom) return;
  renderPlayerList();
  renderPhaseBanner();
  renderNightActionPanel();
  renderDayVotePanel();
  renderLogs();
  renderWinScreen();
  renderDebugToggle();
}

function renderPhaseBanner() {
  const banner = $("#phaseBanner");
  const { phase, round } = currentRoom;
  const labels = {
    lobby: `🛋️ Phòng chờ (${Object.keys(currentRoom.players || {}).length}/11 người)`,
    night: `🌙 ĐÊM ${round}`,
    day: `☀️ NGÀY ${round}`,
    ended: `🏁 KẾT THÚC`,
  };
  banner.textContent = labels[phase] || "";
  banner.className = `phase-banner phase-${phase}`;
}

function renderPlayerList() {
  const container = $("#playerListAdmin");
  container.innerHTML = "";
  const players = currentRoom.players || {};
  Object.entries(players).forEach(([id, p]) => {
    const div = document.createElement("div");
    div.className = `player-row ${p.alive === false ? "dead" : ""}`;
    const roleText = p.role ? `(${ROLE_LABEL_VI[p.role]})` : "";
    div.innerHTML = `
      <span class="player-name">${p.alive === false ? "💀" : "🟢"} ${p.name} ${p.isLover ? "💞" : ""}</span>
      <span class="player-role">${roleText}</span>
      ${currentRoom.phase === "lobby" ? `<button class="btn-kick" data-id="${id}">Xóa</button>` : ""}
    `;
    container.appendChild(div);
  });

  $$(".btn-kick").forEach((btn) => {
    btn.onclick = () => kickPlayer(btn.dataset.id);
  });
}

function renderNightActionPanel() {
  const panel = $("#nightActionPanel");
  panel.innerHTML = "";
  if (currentRoom.phase !== "night" || !currentRoom.nightStep) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");

  const step = currentRoom.nightStep;
  const round = currentRoom.round;
  const alive = getAlivePlayers(currentRoom.players);

  const stepTitles = {
    cupid: "💘 BƯỚC 1: Cupid chọn 2 người yêu nhau",
    guardian: "🛡️ BƯỚC 2: Bảo Vệ chọn người để bảo vệ",
    werewolf: "🐺 BƯỚC 3: Sói chọn nạn nhân",
    seer: "🔮 BƯỚC 4: Tiên Tri chọn người để soi",
    witch: "🧪 BƯỚC 5: Phù Thủy quyết định cứu / độc",
  };

  const title = document.createElement("h3");
  title.textContent = `${stepTitles[step]} (Đêm ${round})`;
  panel.appendChild(title);

  if (step === "cupid") {
    panel.appendChild(buildMultiSelect(alive, 2, (selected) => {
      submitNightAction("cupid", { lovers: selected });
    }));
  } else if (step === "guardian") {
    panel.appendChild(buildSingleSelect(alive, "Bảo vệ", (id) => {
      submitNightAction("guardian", { protect: id });
    }, true));
  } else if (step === "werewolf") {
    panel.appendChild(buildSingleSelect(alive, "Sói cắn", (id) => {
      submitNightAction("werewolf", { target: id });
    }, false));
  } else if (step === "seer") {
    panel.appendChild(buildSingleSelect(alive, "Soi vai trò", (id) => {
      submitNightAction("seer", { target: id });
    }, false));
  } else if (step === "witch") {
    panel.appendChild(buildWitchPanel(alive));
  }
}

function buildSingleSelect(alivePlayers, btnLabel, onConfirm, allowSkip) {
  const wrap = document.createElement("div");
  wrap.className = "select-wrap";
  let selectedId = null;

  alivePlayers.forEach((p) => {
    const opt = document.createElement("button");
    opt.className = "select-option";
    opt.textContent = p.name;
    opt.onclick = () => {
      wrap.querySelectorAll(".select-option").forEach((b) => b.classList.remove("active"));
      opt.classList.add("active");
      selectedId = p.id;
    };
    wrap.appendChild(opt);
  });

  const actions = document.createElement("div");
  actions.className = "action-row";

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn-big btn-confirm";
  confirmBtn.textContent = `✅ Xác nhận ${btnLabel}`;
  confirmBtn.onclick = () => {
    if (!selectedId) {
      alert("Vui lòng chọn 1 người!");
      return;
    }
    onConfirm(selectedId);
  };
  actions.appendChild(confirmBtn);

  if (allowSkip) {
    const skipBtn = document.createElement("button");
    skipBtn.className = "btn-big btn-skip";
    skipBtn.textContent = "⏭️ Không bảo vệ ai";
    skipBtn.onclick = () => onConfirm(null);
    actions.appendChild(skipBtn);
  }

  wrap.appendChild(actions);
  return wrap;
}

function buildMultiSelect(alivePlayers, maxCount, onConfirm) {
  const wrap = document.createElement("div");
  wrap.className = "select-wrap";
  let selected = [];

  alivePlayers.forEach((p) => {
    const opt = document.createElement("button");
    opt.className = "select-option";
    opt.textContent = p.name;
    opt.onclick = () => {
      if (selected.includes(p.id)) {
        selected = selected.filter((x) => x !== p.id);
        opt.classList.remove("active");
      } else {
        if (selected.length >= maxCount) {
          alert(`Chỉ chọn tối đa ${maxCount} người!`);
          return;
        }
        selected.push(p.id);
        opt.classList.add("active");
      }
    };
    wrap.appendChild(opt);
  });

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn-big btn-confirm";
  confirmBtn.textContent = "✅ Xác nhận ghép cặp";
  confirmBtn.onclick = () => {
    if (selected.length !== maxCount) {
      alert(`Cần chọn đúng ${maxCount} người!`);
      return;
    }
    onConfirm(selected);
  };
  wrap.appendChild(confirmBtn);

  return wrap;
}

function buildWitchPanel(alivePlayers) {
  const wrap = document.createElement("div");
  wrap.className = "select-wrap witch-panel";

  const nightState = currentRoom.nightState;
  const wolfTargetId = nightState.werewolf?.target;
  const wolfTarget = wolfTargetId ? currentRoom.players[wolfTargetId] : null;
  const witchUsage = currentRoom.witchUsage || { healUsed: false, poisonUsed: false };
  const healUsed = witchUsage.healUsed;
  const poisonUsed = witchUsage.poisonUsed;

  const info = document.createElement("p");
  info.className = "witch-info";
  info.textContent = wolfTarget
    ? `🐺 Sói đã chọn cắn: ${wolfTarget.name}`
    : "🐺 Sói không cắn ai đêm nay.";
  wrap.appendChild(info);

  let doSave = false;
  let poisonTarget = null;

  if (wolfTarget && !healUsed) {
    const saveBtn = document.createElement("button");
    saveBtn.className = "select-option";
    saveBtn.textContent = `💊 Cứu ${wolfTarget.name}`;
    saveBtn.onclick = () => {
      doSave = !doSave;
      saveBtn.classList.toggle("active");
    };
    wrap.appendChild(saveBtn);
  } else if (healUsed) {
    const usedNote = document.createElement("p");
    usedNote.className = "note-disabled";
    usedNote.textContent = "(Đã dùng thuốc cứu trước đó — không còn lượt cứu)";
    wrap.appendChild(usedNote);
  }

  if (!poisonUsed) {
    const poisonLabel = document.createElement("p");
    poisonLabel.textContent = "☠️ Chọn người để đầu độc (tùy chọn):";
    wrap.appendChild(poisonLabel);

    const poisonSelect = document.createElement("div");
    poisonSelect.className = "select-wrap";
    alivePlayers
      .filter((p) => p.id !== wolfTargetId) // witch không độc trùng người sói vừa cắn (tránh trùng lặp vô lý)
      .forEach((p) => {
        const opt = document.createElement("button");
        opt.className = "select-option";
        opt.textContent = p.name;
        opt.onclick = () => {
          if (poisonTarget === p.id) {
            poisonTarget = null;
            opt.classList.remove("active");
          } else {
            poisonSelect.querySelectorAll(".select-option").forEach((b) => b.classList.remove("active"));
            poisonTarget = p.id;
            opt.classList.add("active");
          }
        };
        poisonSelect.appendChild(opt);
      });
    wrap.appendChild(poisonSelect);
  } else {
    const usedNote = document.createElement("p");
    usedNote.className = "note-disabled";
    usedNote.textContent = "(Đã dùng thuốc độc trước đó — không còn lượt độc)";
    wrap.appendChild(usedNote);
  }

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn-big btn-confirm";
  confirmBtn.textContent = "✅ Xác nhận hành động Phù Thủy";
  confirmBtn.onclick = () => {
    submitNightAction("witch", { save: doSave, poisonTarget });
  };
  wrap.appendChild(confirmBtn);

  const skipBtn = document.createElement("button");
  skipBtn.className = "btn-big btn-skip";
  skipBtn.textContent = "⏭️ Không làm gì cả";
  skipBtn.onclick = () => submitNightAction("witch", { save: false, poisonTarget: null });
  wrap.appendChild(skipBtn);

  return wrap;
}

function renderDayVotePanel() {
  const panel = $("#dayVotePanel");
  if (currentRoom.phase !== "day") {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  panel.innerHTML = "<h3>🗳️ Kết quả vote hiện tại (realtime từ người chơi)</h3>";

  const votes = currentRoom.dayVotes || {};
  const tallyDiv = document.createElement("div");
  tallyDiv.className = "vote-tally";

  const alive = getAlivePlayers(currentRoom.players);
  alive.forEach((p) => {
    const count = Object.values(votes).filter((v) => v === p.id).length;
    const row = document.createElement("div");
    row.className = "vote-row";
    row.innerHTML = `<span>${p.name}</span><span class="vote-count">${count} phiếu</span>`;
    tallyDiv.appendChild(row);
  });
  panel.appendChild(tallyDiv);

  const nextBtn = document.createElement("button");
  nextBtn.className = "btn-big btn-confirm";
  nextBtn.textContent = "➡️ KẾT THÚC VOTE & CHUYỂN ĐÊM";
  nextBtn.onclick = () => {
    if (confirm("Chốt kết quả vote và chuyển sang đêm tiếp theo?")) {
      resolveDayAndGoToNight();
    }
  };
  panel.appendChild(nextBtn);
}

function renderLogs() {
  const logPanel = $("#logPanel");
  const logs = currentRoom.logs || [];
  logPanel.innerHTML = logs
    .slice()
    .reverse()
    .map((l) => `<div class="log-entry log-${l.type}">[V${l.round}] ${l.text}</div>`)
    .join("");
}

function renderWinScreen() {
  const winDiv = $("#winScreen");
  if (currentRoom.phase === "ended" && currentRoom.winner) {
    winDiv.classList.remove("hidden");
    winDiv.innerHTML = `
      <h1>${WIN_LABEL_VI[currentRoom.winner]}</h1>
      <button id="btnResetAfterWin" class="btn-big btn-confirm">🔄 Chơi lại</button>
    `;
    $("#btnResetAfterWin").onclick = resetGame;
  } else {
    winDiv.classList.add("hidden");
  }
}

function renderDebugToggle() {
  const toggle = $("#debugToggle");
  if (toggle) toggle.checked = !!currentRoom.settings?.debugMode;
}

// ============================================================
// 7. BIND UI EVENTS (gọi khi DOM load xong, từ admin.html)
// ============================================================
export function bindAdminUI() {
  $("#btnCreateRoom").onclick = createRoom;
  $("#btnJoinRoom").onclick = () => {
    const code = $("#inputRoomCode").value.trim();
    if (code) enterRoom(code);
  };
  $("#btnStartGame").onclick = startGame;
  $("#btnResetGame").onclick = () => {
    if (confirm("Reset toàn bộ game? Mọi vai trò và trạng thái sẽ bị xóa.")) resetGame();
  };
  $("#debugToggle").onchange = toggleDebugMode;
}

window.addEventListener("DOMContentLoaded", bindAdminUI);
