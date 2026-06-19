// ============================================================
// ADMIN.JS — ĐIỀU KHIỂN GAME v2.0
// ============================================================

import {
  db, doc, setDoc, getDoc, updateDoc, onSnapshot, deleteField, serverTimestamp,
} from "./firebase.js";
import {
  ROLES, ROLE_LABEL_VI, ROLE_TEAM, ROLE_TEAM_LABEL_VI,
  DEATH_CAUSE_LABEL_VI, WIN_LABEL_VI,
  assignRoles, emptyNightState, emptyWitchUsage,
  getNightStepsForRound, getNextNightStep, getPresentRoles,
  getAlivePlayers, applyCupid, applyThief, resolveNight, resolveSeer,
  resolveDayVote, applyDayVoteResult, applyHunterKill, checkWinCondition,
  makeLogEntry, getRolePreset, buildRoleList,
} from "./game.js";

let roomCode = null;
let roomRefDoc = null;
let currentRoom = null;
let unsubscribe = null;

// Timer state (local only — not stored in Firestore to avoid conflicts)
let timerInterval = null;
let timerRemaining = 0;
let timerRunning = false;

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
    chat: {},
    logs: [makeLogEntry(0, "lobby", "Phòng được tạo. Đang chờ người chơi vào...", "system")],
    settings: {
      debugMode: false,
      testMode: false,
      roleMode: "auto",
      roleOptions: {},
      playerCount: 11,
      gameMode: "adminControl", // "adminControl" | "playerAction"
    },
    winner: null,
    hunterPending: null,
    timerEndAt: null,
    timerDuration: null,
    timerPhase: null,
    seerHistory: {},
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
// 2. GAME CONTROL
// ============================================================

export async function startGame() {
  if (!currentRoom) return;
  const players = currentRoom.players || {};
  const count = Object.keys(players).length;

  if (count < 8 || count > 20) {
    alert(`Cần 8–20 người chơi để bắt đầu. Hiện tại: ${count}`);
    return;
  }

  const settings = currentRoom.settings || {};
  let roleList;

  if (settings.roleMode === "manual") {
    // Use manually configured roles
    const manualRoles = settings.manualRoles || [];
    if (manualRoles.length !== count) {
      alert(`Số vai trò (${manualRoles.length}) không khớp số người chơi (${count})`);
      return;
    }
    roleList = manualRoles;
  } else {
    // Auto balance
    const preset = getRolePreset(count, settings.roleOptions || {});
    roleList = buildRoleList(preset);
    if (roleList.length !== count) {
      // Adjust villagers to match
      const diff = count - roleList.length;
      for (let i = 0; i < Math.abs(diff); i++) {
        if (diff > 0) roleList.push("villager");
        else {
          const idx = roleList.lastIndexOf("villager");
          if (idx !== -1) roleList.splice(idx, 1);
        }
      }
    }
  }

  const withRoles = assignRoles(players, roleList);
  const round = 1;
  const nightState = emptyNightState(round);
  const presentRoles = getPresentRoles(withRoles);
  const steps = getNightStepsForRound(round, presentRoles);

  // Handle thief: pick 2 unused roles for thief to choose from
  let thiefOptions = [];
  if (presentRoles.has("thief")) {
    // generate 2 random village roles not already in preset as extra
    thiefOptions = ["villager", "villager"];
    // In a real game these would be the 2 "set-aside" cards
  }

  await updateDoc(roomRefDoc, {
    players: withRoles,
    phase: "night",
    round,
    nightStep: steps[0],
    nightState,
    witchUsage: emptyWitchUsage(),
    dayVotes: {},
    winner: null,
    hunterPending: null,
    seerHistory: {},
    timerEndAt: null,
    timerDuration: null,
    timerPhase: null,
    thiefOptions,
    logs: [
      ...currentRoom.logs,
      makeLogEntry(round, "night", `🎮 Game bắt đầu! ${count} người chơi. Đêm thứ 1 bắt đầu...`, "system"),
    ],
  });
  playSound("start");
}

export async function resetGame() {
  if (!currentRoom) return;
  const players = { ...currentRoom.players };
  Object.keys(players).forEach((id) => {
    players[id] = { name: players[id].name };
  });
  clearTimer();
  await updateDoc(roomRefDoc, {
    phase: "lobby",
    round: 0,
    nightStep: null,
    players,
    nightState: null,
    witchUsage: null,
    dayVotes: {},
    winner: null,
    hunterPending: null,
    seerHistory: {},
    timerEndAt: null,
    timerDuration: null,
    timerPhase: null,
    logs: [makeLogEntry(0, "lobby", "🔄 Game đã được reset.", "system")],
  });
}

export async function toggleDebugMode() {
  if (!currentRoom) return;
  await updateDoc(roomRefDoc, { "settings.debugMode": !currentRoom.settings?.debugMode });
}

export async function toggleTestMode() {
  if (!currentRoom) return;
  await updateDoc(roomRefDoc, { "settings.testMode": !currentRoom.settings?.testMode });
}

export async function toggleGameMode() {
  if (!currentRoom) return;
  const current = currentRoom.settings?.gameMode || "adminControl";
  const next = current === "adminControl" ? "playerAction" : "adminControl";
  await updateDoc(roomRefDoc, { "settings.gameMode": next });
}

// ============================================================
// 3. NIGHT ACTIONS
// ============================================================

export async function submitNightAction(step, stepData) {
  if (!currentRoom) return;
  const round = currentRoom.round;
  const nightState = { ...currentRoom.nightState };
  let playersUpdate = currentRoom.players;
  let logs = [...currentRoom.logs];
  let seerHistory = currentRoom.seerHistory || {};

  if (step === "cupid") {
    nightState.cupid = { done: true, lovers: stepData.lovers };
    playersUpdate = applyCupid(currentRoom.players, stepData.lovers);
    const names = stepData.lovers.map((id) => currentRoom.players[id].name).join(" 💞 ");
    logs.push(makeLogEntry(round, "night", `💘 Cupid đã ghép cặp: ${names}`, "info"));
    // Notify lovers via their player data (set loverPartnerId)
    const [idA, idB] = stepData.lovers;
    playersUpdate[idA] = { ...playersUpdate[idA], loverPartnerId: idB };
    playersUpdate[idB] = { ...playersUpdate[idB], loverPartnerId: idA };
  }

  if (step === "thief") {
    nightState.thief = { done: true, chosenRole: stepData.chosenRole };
    if (stepData.thiefId && stepData.chosenRole) {
      playersUpdate = applyThief(currentRoom.players, stepData.thiefId, stepData.chosenRole);
    }
    logs.push(makeLogEntry(round, "night", `🃏 Ăn Trộm đã chọn vai trò: ${ROLE_LABEL_VI[stepData.chosenRole] || "?"}`, "info"));
  }

  if (step === "guardian") {
    nightState.guardian = { done: true, protect: stepData.protect };
    const name = stepData.protect ? currentRoom.players[stepData.protect]?.name : "Không ai";
    logs.push(makeLogEntry(round, "night", `🛡️ Bảo Vệ đã bảo vệ: ${name}`, "info"));
  }

  if (step === "werewolf") {
    nightState.werewolf = { done: true, target: stepData.target };
    const name = stepData.target ? currentRoom.players[stepData.target]?.name : "Không ai";
    logs.push(makeLogEntry(round, "night", `🐺 Sói đã chọn cắn: ${name}`, "info"));
  }

  if (step === "cursed_wolf") {
    nightState.cursed_wolf = { done: true, target: stepData.target };
    const name = stepData.target ? currentRoom.players[stepData.target]?.name : "Không ai";
    logs.push(makeLogEntry(round, "night", `🌀 Sói Nguyền đã nguyền: ${name}`, "info"));
  }

  if (step === "seer") {
    const result = resolveSeer(currentRoom.players, stepData.target);
    nightState.seer = { done: true, target: stepData.target, result };
    // Store seer history (admin secret log)
    seerHistory[round] = {
      targetId: result.targetId,
      targetName: result.targetName,
      isWerewolf: result.isWerewolf,
    };
    logs.push(
      makeLogEntry(round, "night",
        `🔮 Tiên Tri đã soi ${result.targetName}: ${result.isWerewolf ? "LÀ SÓI 🐺" : "không phải sói 👤"}`,
        "info"
      )
    );
  }

  let witchUsageUpdate = currentRoom.witchUsage || emptyWitchUsage();

  if (step === "witch") {
    nightState.witch = { done: true, save: stepData.save, poisonTarget: stepData.poisonTarget || null };
    witchUsageUpdate = {
      healUsed: witchUsageUpdate.healUsed || stepData.save === true,
      poisonUsed: witchUsageUpdate.poisonUsed || !!stepData.poisonTarget,
    };
    const saveMsg = stepData.save ? "đã cứu nạn nhân" : "không cứu";
    const poisonMsg = stepData.poisonTarget
      ? `đầu độc ${currentRoom.players[stepData.poisonTarget]?.name}`
      : "không độc ai";
    logs.push(makeLogEntry(round, "night", `🧪 Phù Thủy: ${saveMsg}, ${poisonMsg}`, "info"));
  }

  if (step === "flute_player") {
    nightState.flute_player = { done: true, targets: stepData.targets || [] };
    const names = (stepData.targets || []).map((id) => currentRoom.players[id]?.name).join(", ");
    logs.push(makeLogEntry(round, "night", `🎶 Thổi Sáo đã ru ngủ: ${names || "Không ai"}`, "info"));
    // Mark charmed players
    (stepData.targets || []).forEach((id) => {
      if (playersUpdate[id]) {
        playersUpdate = { ...playersUpdate, [id]: { ...playersUpdate[id], isCharmed: true } };
      }
    });
  }

  const presentRoles = getPresentRoles(currentRoom.players);
  const nextStep = getNextNightStep(step, round, presentRoles);

  if (nextStep) {
    await updateDoc(roomRefDoc, {
      players: playersUpdate,
      nightState,
      witchUsage: witchUsageUpdate,
      seerHistory,
      logs,
      nightStep: nextStep,
    });
  } else {
    await updateDoc(roomRefDoc, {
      players: playersUpdate,
      nightState,
      witchUsage: witchUsageUpdate,
      seerHistory,
      logs,
    });
    await resolveNightAndGoToDay({
      ...currentRoom,
      players: playersUpdate,
      nightState,
      witchUsage: witchUsageUpdate,
      seerHistory,
      logs,
    });
  }
}

// ============================================================
// PLAYER ACTION MODE — process submitted player actions
// Called from renderAll when gameMode === "playerAction" and
// a playerNightAction arrives in Firestore that hasn't been processed yet.
// ============================================================

export async function processPlayerNightAction() {
  if (!currentRoom) return;
  const step = currentRoom.nightStep;
  const action = currentRoom.playerNightAction;
  if (!action || action.step !== step || action.processed) return;

  // Mark as processing to prevent double-fire (optimistic lock via field)
  await updateDoc(roomRefDoc, { "playerNightAction.processed": true });

  // Delegate to existing submitNightAction with the player's data
  await submitNightAction(action.step, action.data);
}

async function resolveNightAndGoToDay(roomData) {
  const room = roomData || currentRoom;
  const round = room.round;
  const { updatedPlayers, deaths } = resolveNight(room.players, room.nightState);

  let logs = [...room.logs];

  if (deaths.length === 0) {
    logs.push(makeLogEntry(round, "night", `🌙 Đêm thứ ${round}: Bình yên, không ai chết!`, "death"));
  } else {
    deaths.forEach((d) => {
      logs.push(makeLogEntry(round, "night", `💀 ${d.name} đã chết — ${DEATH_CAUSE_LABEL_VI[d.cause]}`, "death"));
    });
  }

  // Check if Hunter died and needs to pull someone
  const hunterDeath = deaths.find((d) => updatedPlayers[d.id]?.role === "hunter" || room.players[d.id]?.role === "hunter");
  if (hunterDeath) {
    const winner = checkWinCondition(updatedPlayers);
    if (winner) {
      logs.push(makeLogEntry(round, "night", WIN_LABEL_VI[winner], "system"));
      await updateDoc(roomRefDoc, { players: updatedPlayers, phase: "ended", nightStep: null, winner, logs });
      playSound("death");
      return;
    }
    // Pause for hunter action
    await updateDoc(roomRefDoc, {
      players: updatedPlayers,
      nightStep: null,
      hunterPending: { hunterId: hunterDeath.id, phase: "night", round },
      logs,
    });
    return;
  }

  // Check cursed wolf role change
  const curseTarget = room.nightState?.cursed_wolf?.target;
  if (curseTarget && updatedPlayers[curseTarget] && updatedPlayers[curseTarget].role === "werewolf") {
    logs.push(makeLogEntry(round, "night", `🌀 Sói Nguyền đã biến ${updatedPlayers[curseTarget].name} thành Ma Sói!`, "death"));
  }

  const winner = checkWinCondition(updatedPlayers);
  if (winner) {
    logs.push(makeLogEntry(round, "night", WIN_LABEL_VI[winner], "system"));
    await updateDoc(roomRefDoc, { players: updatedPlayers, phase: "ended", nightStep: null, winner, logs });
    playSound("death");
    return;
  }

  const count = Object.keys(updatedPlayers).length;
  const timerDuration = count <= 11 ? 180 : count <= 15 ? 300 : 420;
  logs.push(makeLogEntry(round, "day", `☀️ Ngày thứ ${round} bắt đầu. Thảo luận và vote!`, "system"));

  await updateDoc(roomRefDoc, {
    players: updatedPlayers,
    phase: "day",
    nightStep: null,
    dayVotes: {},
    timerDuration,
    timerEndAt: null,
    timerPhase: "day",
    logs,
  });
  playSound("day");
}

export async function resolveDayAndGoToNight() {
  if (!currentRoom) return;
  const round = currentRoom.round;
  const votes = currentRoom.dayVotes || {};
  const { eliminatedId, isTie, tally } = resolveDayVote(votes);

  let logs = [...currentRoom.logs];
  let playersAfterVote = currentRoom.players;

  if (isTie) {
    logs.push(makeLogEntry(round, "day", `⚖️ Hòa phiếu — Không ai bị treo cổ.`, "vote"));
  } else if (!eliminatedId) {
    logs.push(makeLogEntry(round, "day", `Không có phiếu nào — Không ai bị treo cổ.`, "vote"));
  } else {
    const { updatedPlayers, deaths } = applyDayVoteResult(currentRoom.players, eliminatedId);
    playersAfterVote = updatedPlayers;
    deaths.forEach((d) => {
      logs.push(makeLogEntry(round, "day", `💀 ${d.name} đã chết — ${DEATH_CAUSE_LABEL_VI[d.cause]}`, "death"));
    });

    // Hunter triggered?
    const hunterDeath = deaths.find((d) => currentRoom.players[d.id]?.role === "hunter");
    if (hunterDeath) {
      const winner = checkWinCondition(playersAfterVote);
      if (winner) {
        logs.push(makeLogEntry(round, "day", WIN_LABEL_VI[winner], "system"));
        await updateDoc(roomRefDoc, { players: playersAfterVote, phase: "ended", winner, logs });
        playSound("death");
        return;
      }
      await updateDoc(roomRefDoc, {
        players: playersAfterVote,
        hunterPending: { hunterId: hunterDeath.id, phase: "day", round },
        logs,
      });
      clearTimer();
      return;
    }
  }

  const winner = checkWinCondition(playersAfterVote);
  if (winner) {
    logs.push(makeLogEntry(round, "day", WIN_LABEL_VI[winner], "system"));
    await updateDoc(roomRefDoc, { players: playersAfterVote, phase: "ended", winner, logs });
    playSound("death");
    return;
  }

  const nextRound = round + 1;
  const nightState = emptyNightState(nextRound);
  const presentRoles = getPresentRoles(playersAfterVote);
  const steps = getNightStepsForRound(nextRound, presentRoles);

  logs.push(makeLogEntry(nextRound, "night", `🌙 Đêm thứ ${nextRound} bắt đầu...`, "system"));
  clearTimer();

  await updateDoc(roomRefDoc, {
    players: playersAfterVote,
    phase: "night",
    round: nextRound,
    nightStep: steps[0],
    nightState,
    dayVotes: {},
    timerEndAt: null,
    timerPhase: null,
    logs,
  });
  playSound("night");
}

// ============================================================
// HUNTER ACTION
// ============================================================

export async function submitHunterKill(targetId) {
  if (!currentRoom || !currentRoom.hunterPending) return;
  const { hunterId, phase, round } = currentRoom.hunterPending;
  const { updatedPlayers, deaths } = applyHunterKill(currentRoom.players, hunterId, targetId);

  let logs = [...currentRoom.logs];
  deaths.forEach((d) => {
    logs.push(makeLogEntry(round, phase, `💀 ${d.name} đã chết — ${DEATH_CAUSE_LABEL_VI[d.cause]}`, "death"));
  });

  const winner = checkWinCondition(updatedPlayers);
  if (winner) {
    logs.push(makeLogEntry(round, phase, WIN_LABEL_VI[winner], "system"));
    await updateDoc(roomRefDoc, { players: updatedPlayers, phase: "ended", winner, hunterPending: null, logs });
    playSound("death");
    return;
  }

  if (phase === "night") {
    // Continue to day
    const count = Object.keys(updatedPlayers).length;
    const timerDuration = count <= 11 ? 180 : count <= 15 ? 300 : 420;
    logs.push(makeLogEntry(round, "day", `☀️ Ngày thứ ${round} bắt đầu.`, "system"));
    await updateDoc(roomRefDoc, {
      players: updatedPlayers,
      phase: "day",
      dayVotes: {},
      hunterPending: null,
      timerDuration,
      timerEndAt: null,
      timerPhase: "day",
      logs,
    });
  } else {
    // Continue to next night
    const nextRound = round + 1;
    const nightState = emptyNightState(nextRound);
    const presentRoles = getPresentRoles(updatedPlayers);
    const steps = getNightStepsForRound(nextRound, presentRoles);
    logs.push(makeLogEntry(nextRound, "night", `🌙 Đêm thứ ${nextRound} bắt đầu...`, "system"));
    await updateDoc(roomRefDoc, {
      players: updatedPlayers,
      phase: "night",
      round: nextRound,
      nightStep: steps[0],
      nightState,
      dayVotes: {},
      hunterPending: null,
      timerEndAt: null,
      logs,
    });
    playSound("night");
  }
}

// ============================================================
// 4. PLAYER MANAGEMENT
// ============================================================

export async function kickPlayer(playerId) {
  if (!currentRoom) return;
  const players = { ...currentRoom.players };
  delete players[playerId];
  await updateDoc(roomRefDoc, { players });
}

// ============================================================
// 5. TIMER
// ============================================================

function clearTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerRunning = false;
  timerRemaining = 0;
}

export async function startTimer() {
  if (!currentRoom) return;
  const duration = currentRoom.timerDuration || 180;
  const endAt = Date.now() + duration * 1000;
  await updateDoc(roomRefDoc, { timerEndAt: endAt, timerRunning: true });
  runLocalTimer(endAt);
}

export async function pauseTimer() {
  if (!currentRoom) return;
  clearTimer();
  const remaining = currentRoom.timerEndAt ? Math.max(0, Math.floor((currentRoom.timerEndAt - Date.now()) / 1000)) : 0;
  await updateDoc(roomRefDoc, { timerEndAt: null, timerRunning: false, timerDuration: remaining });
  renderTimerControls();
}

export async function skipDiscussion() {
  clearTimer();
  await updateDoc(roomRefDoc, { timerEndAt: null, timerRunning: false });
  renderDayVotePanel();
}

function runLocalTimer(endAt) {
  clearTimer();
  timerRunning = true;
  timerInterval = setInterval(() => {
    const remaining = Math.max(0, Math.floor((endAt - Date.now()) / 1000));
    renderTimerDisplay(remaining);
    if (remaining <= 0) {
      clearTimer();
      renderTimerDisplay(0);
    }
  }, 500);
}

function renderTimerDisplay(seconds) {
  const el = $("#timerDisplay");
  if (!el) return;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  el.textContent = `⏱️ ${m}:${s.toString().padStart(2, "0")}`;
  el.className = `timer-display ${seconds <= 30 ? "timer-urgent" : ""}`;
}

function renderTimerControls() {
  const el = $("#timerControls");
  if (!el) return;
  const endAt = currentRoom?.timerEndAt;
  const isRunning = endAt && endAt > Date.now();

  if (isRunning) runLocalTimer(endAt);

  el.innerHTML = `
    <div id="timerDisplay" class="timer-display">⏱️ ${formatTimerDuration(currentRoom?.timerDuration || 180)}</div>
    <div class="btn-row" style="margin-top:8px">
      <button class="btn-big btn-confirm" onclick="window._adminAction('startTimer')" ${isRunning ? "disabled" : ""}>▶ Bắt đầu thảo luận</button>
      <button class="btn-big btn-skip" onclick="window._adminAction('pauseTimer')" ${!isRunning ? "disabled" : ""}>⏸ Tạm dừng</button>
      <button class="btn-big btn-danger" onclick="window._adminAction('skipDiscussion')">⏭ Skip</button>
    </div>
  `;
}

function formatTimerDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ============================================================
// 6. SOUND
// ============================================================
const SOUNDS = {
  start: "assets/start.mp3",
  night: "assets/night.mp3",
  day: "assets/day.mp3",
  death: "assets/death.mp3",
};
function playSound(key) {
  try {
    new Audio(SOUNDS[key]).play().catch(() => {});
  } catch (e) {}
}

// ============================================================
// 7. RENDER
// ============================================================

function renderAll() {
  if (!currentRoom) return;
  renderPlayerList();
  renderPhaseBanner();
  renderNightActionPanel();
  renderDayVotePanel();
  renderHunterPanel();
  renderLogs();
  renderWinScreen();
  renderDebugToggle();
  renderTestModeToggle();
  renderGameModeBadge();
  renderGameSetupPanel();
  renderChatPanel();

  // Sync timer from Firestore if running
  if (currentRoom.timerEndAt && currentRoom.timerEndAt > Date.now()) {
    runLocalTimer(currentRoom.timerEndAt);
  }

  // Player Action Mode: auto-process submitted player actions
  if (currentRoom.settings?.gameMode === "playerAction") {
    const action = currentRoom.playerNightAction;
    if (action && action.step === currentRoom.nightStep && !action.processed) {
      processPlayerNightAction();
    }
    // Hunter self-action
    const hunterAction = currentRoom.playerHunterAction;
    if (hunterAction && currentRoom.hunterPending && !hunterAction.processed) {
      (async () => {
        await updateDoc(roomRefDoc, { "playerHunterAction.processed": true });
        await submitHunterKill(hunterAction.targetId);
      })();
    }
  }
}

function renderPhaseBanner() {
  const banner = $("#phaseBanner");
  const { phase, round } = currentRoom;
  const count = Object.keys(currentRoom.players || {}).length;
  const labels = {
    lobby: `🛋️ Phòng chờ (${count}/${currentRoom.settings?.playerCount || "?"} người)`,
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
  const votes = currentRoom.dayVotes || {};

  // Count votes per player
  const voteTally = {};
  Object.values(votes).forEach((tid) => { if (tid) voteTally[tid] = (voteTally[tid] || 0) + 1; });

  Object.entries(players).forEach(([id, p]) => {
    const div = document.createElement("div");
    div.className = `player-row ${p.alive === false ? "dead" : ""}`;
    const roleText = p.role ? `(${ROLE_LABEL_VI[p.role]})` : "";
    const voteText = currentRoom.phase === "day" && voteTally[id] ? `🗳️ ${voteTally[id]}` : "";
    const loverName = p.loverPartnerId && players[p.loverPartnerId] ? `💞${players[p.loverPartnerId].name}` : "";
    div.innerHTML = `
      <span class="player-name">${p.alive === false ? "💀" : "🟢"} ${p.name} ${loverName}</span>
      <span class="player-role">${roleText} ${voteText}</span>
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
  if (currentRoom.phase !== "night" || !currentRoom.nightStep || currentRoom.hunterPending) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");

  const step = currentRoom.nightStep;
  const round = currentRoom.round;
  const alive = getAlivePlayers(currentRoom.players);
  const isPlayerActionMode = currentRoom.settings?.gameMode === "playerAction";

  const stepTitles = {
    cupid: "💘 Cupid chọn 2 người yêu nhau",
    thief: "🃏 Ăn Trộm chọn vai trò",
    guardian: "🛡️ Bảo Vệ chọn người bảo vệ",
    werewolf: "🐺 Sói chọn nạn nhân",
    cursed_wolf: "🌀 Sói Nguyền biến 1 người thành Sói",
    seer: "🔮 Tiên Tri soi 1 người",
    witch: "🧪 Phù Thủy hành động",
    flute_player: "🎶 Thổi Sáo ru ngủ 2 người",
  };

  const title = document.createElement("h3");
  title.textContent = `${stepTitles[step] || step} (Đêm ${round})`;
  panel.appendChild(title);

  // Player Action Mode: show waiting status + override toggle
  if (isPlayerActionMode) {
    // Find the player whose turn it is
    const roleForStep = step === "cursed_wolf" ? ["cursed_wolf"] : step === "werewolf" ? ["werewolf", "cursed_wolf"] : [step];
    const actionPlayer = alive.find(p => roleForStep.includes(p.role));
    const playerName = actionPlayer?.name || "người chơi";

    const waitDiv = document.createElement("div");
    waitDiv.className = "player-action-waiting";
    waitDiv.innerHTML = `
      <div class="waiting-indicator">⏳ Đang chờ <strong>${escapeHtml(playerName)}</strong> thao tác trên điện thoại...</div>
      <button class="btn-big btn-skip" id="btnToggleOverride" style="margin-top:10px">🎛️ Admin override thay thế</button>
    `;
    panel.appendChild(waitDiv);

    // Show override panel (collapsed by default)
    const overrideDiv = document.createElement("div");
    overrideDiv.id = "adminOverridePanel";
    overrideDiv.className = "hidden";
    overrideDiv.innerHTML = `<p class="note-disabled" style="margin-bottom:8px">⚠️ Admin override — thao tác thay người chơi:</p>`;
    panel.appendChild(overrideDiv);

    const btn = panel.querySelector("#btnToggleOverride");
    btn.onclick = () => {
      overrideDiv.classList.toggle("hidden");
      btn.textContent = overrideDiv.classList.contains("hidden") ? "🎛️ Admin override thay thế" : "✖️ Đóng override";
    };

    // Render the action UI inside override panel
    renderNightActionControls(step, alive, overrideDiv);
    return;
  }

  // Admin Control Mode: render directly
  renderNightActionControls(step, alive, panel);
}

function renderNightActionControls(step, alive, container) {
  if (step === "cupid") {
    container.appendChild(buildMultiSelect(alive, 2, (selected) => {
      submitNightAction("cupid", { lovers: selected });
    }, "Xác nhận ghép cặp"));
  } else if (step === "thief") {
    container.appendChild(buildThiefPanel(alive));
  } else if (step === "guardian") {
    container.appendChild(buildSingleSelect(alive, "Bảo vệ", (id) => {
      submitNightAction("guardian", { protect: id });
    }, true));
  } else if (step === "werewolf") {
    const nonWolves = alive.filter((p) => p.role !== "werewolf" && p.role !== "cursed_wolf");
    container.appendChild(buildSingleSelect(nonWolves, "Sói cắn", (id) => {
      submitNightAction("werewolf", { target: id });
    }, false));
  } else if (step === "cursed_wolf") {
    const targets = alive.filter((p) => p.role !== "werewolf" && p.role !== "cursed_wolf");
    container.appendChild(buildSingleSelect(targets, "Nguyền", (id) => {
      submitNightAction("cursed_wolf", { target: id });
    }, true));
  } else if (step === "seer") {
    container.appendChild(buildSeerPanel(alive));
  } else if (step === "witch") {
    container.appendChild(buildWitchPanel(alive));
  } else if (step === "flute_player") {
    container.appendChild(buildMultiSelect(alive.filter(p => p.role !== "flute_player"), 2, (selected) => {
      submitNightAction("flute_player", { targets: selected });
    }, "Xác nhận ru ngủ", true));
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
    if (!selectedId) { alert("Vui lòng chọn 1 người!"); return; }
    onConfirm(selectedId);
  };
  actions.appendChild(confirmBtn);

  if (allowSkip) {
    const skipBtn = document.createElement("button");
    skipBtn.className = "btn-big btn-skip";
    skipBtn.textContent = "⏭️ Bỏ qua";
    skipBtn.onclick = () => onConfirm(null);
    actions.appendChild(skipBtn);
  }

  wrap.appendChild(actions);
  return wrap;
}

function buildMultiSelect(alivePlayers, maxCount, onConfirm, btnLabel, allowSkip = false) {
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
        if (selected.length >= maxCount) { alert(`Chỉ chọn tối đa ${maxCount} người!`); return; }
        selected.push(p.id);
        opt.classList.add("active");
      }
    };
    wrap.appendChild(opt);
  });

  const actions = document.createElement("div");
  actions.className = "action-row";

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn-big btn-confirm";
  confirmBtn.textContent = `✅ ${btnLabel || "Xác nhận"}`;
  confirmBtn.onclick = () => {
    if (selected.length < 1) { alert(`Cần chọn ít nhất 1 người!`); return; }
    onConfirm(selected);
  };
  actions.appendChild(confirmBtn);

  if (allowSkip) {
    const skipBtn = document.createElement("button");
    skipBtn.className = "btn-big btn-skip";
    skipBtn.textContent = "⏭️ Bỏ qua";
    skipBtn.onclick = () => onConfirm([]);
    actions.appendChild(skipBtn);
  }

  wrap.appendChild(actions);
  return wrap;
}

function buildThiefPanel(alivePlayers) {
  const wrap = document.createElement("div");
  wrap.className = "select-wrap";

  const thiefPlayer = getAlivePlayers(currentRoom.players).find(p => p.role === "thief");
  const options = currentRoom.thiefOptions || ["villager", "villager"];

  const label = document.createElement("p");
  label.textContent = `🃏 ${thiefPlayer?.name || "Ăn Trộm"} chọn 1 trong 2 vai trò sau:`;
  wrap.appendChild(label);

  let chosenRole = null;
  options.forEach((role, i) => {
    const btn = document.createElement("button");
    btn.className = "select-option";
    btn.textContent = `${i+1}. ${ROLE_LABEL_VI[role] || role}`;
    btn.onclick = () => {
      wrap.querySelectorAll(".select-option").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      chosenRole = role;
    };
    wrap.appendChild(btn);
  });

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn-big btn-confirm";
  confirmBtn.textContent = "✅ Xác nhận";
  confirmBtn.onclick = () => {
    if (!chosenRole) { alert("Chọn 1 vai trò!"); return; }
    submitNightAction("thief", { thiefId: thiefPlayer?.id, chosenRole });
  };
  wrap.appendChild(confirmBtn);

  const skipBtn = document.createElement("button");
  skipBtn.className = "btn-big btn-skip";
  skipBtn.textContent = "⏭️ Giữ nguyên vai Ăn Trộm";
  skipBtn.onclick = () => submitNightAction("thief", { thiefId: null, chosenRole: null });
  wrap.appendChild(skipBtn);

  return wrap;
}

function buildSeerPanel(alivePlayers) {
  const wrap = document.createElement("div");
  wrap.className = "select-wrap";

  // Show seer history
  const seerHistory = currentRoom.seerHistory || {};
  if (Object.keys(seerHistory).length > 0) {
    const histDiv = document.createElement("div");
    histDiv.className = "seer-history";
    histDiv.innerHTML = "<strong>🔮 Lịch sử soi (chỉ Admin thấy):</strong>";
    Object.entries(seerHistory).sort((a, b) => a[0] - b[0]).forEach(([round, entry]) => {
      const row = document.createElement("div");
      row.className = "seer-history-row";
      row.innerHTML = `Đêm ${round}: <b>${entry.targetName}</b> → ${entry.isWerewolf ? "🐺 LÀ SÓI" : "👤 Không phải sói"}`;
      histDiv.appendChild(row);
    });
    wrap.appendChild(histDiv);
  }

  wrap.appendChild(buildSingleSelect(alivePlayers, "Soi", (id) => {
    submitNightAction("seer", { target: id });
  }, false));

  return wrap;
}

function buildWitchPanel(alivePlayers) {
  const wrap = document.createElement("div");
  wrap.className = "select-wrap witch-panel";

  const nightState = currentRoom.nightState;
  const wolfTargetId = nightState.werewolf?.target;
  const wolfTarget = wolfTargetId ? currentRoom.players[wolfTargetId] : null;
  const witchUsage = currentRoom.witchUsage || { healUsed: false, poisonUsed: false };

  const info = document.createElement("p");
  info.className = "witch-info";
  info.textContent = wolfTarget ? `🐺 Sói cắn: ${wolfTarget.name}` : "🐺 Sói không cắn ai.";
  wrap.appendChild(info);

  let doSave = false;
  let poisonTarget = null;

  if (wolfTarget && !witchUsage.healUsed) {
    const saveBtn = document.createElement("button");
    saveBtn.className = "select-option";
    saveBtn.textContent = `💊 Cứu ${wolfTarget.name}`;
    saveBtn.onclick = () => { doSave = !doSave; saveBtn.classList.toggle("active"); };
    wrap.appendChild(saveBtn);
  } else if (witchUsage.healUsed) {
    const n = document.createElement("p");
    n.className = "note-disabled";
    n.textContent = "(Đã dùng thuốc cứu)";
    wrap.appendChild(n);
  }

  if (!witchUsage.poisonUsed) {
    const pl = document.createElement("p");
    pl.textContent = "☠️ Đầu độc (tùy chọn):";
    wrap.appendChild(pl);

    const ps = document.createElement("div");
    ps.className = "select-wrap";
    alivePlayers.filter((p) => p.id !== wolfTargetId).forEach((p) => {
      const opt = document.createElement("button");
      opt.className = "select-option";
      opt.textContent = p.name;
      opt.onclick = () => {
        if (poisonTarget === p.id) {
          poisonTarget = null;
          opt.classList.remove("active");
        } else {
          ps.querySelectorAll(".select-option").forEach((b) => b.classList.remove("active"));
          poisonTarget = p.id;
          opt.classList.add("active");
        }
      };
      ps.appendChild(opt);
    });
    wrap.appendChild(ps);
  } else {
    const n = document.createElement("p");
    n.className = "note-disabled";
    n.textContent = "(Đã dùng thuốc độc)";
    wrap.appendChild(n);
  }

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn-big btn-confirm";
  confirmBtn.textContent = "✅ Xác nhận Phù Thủy";
  confirmBtn.onclick = () => submitNightAction("witch", { save: doSave, poisonTarget });
  wrap.appendChild(confirmBtn);

  const skipBtn = document.createElement("button");
  skipBtn.className = "btn-big btn-skip";
  skipBtn.textContent = "⏭️ Không làm gì";
  skipBtn.onclick = () => submitNightAction("witch", { save: false, poisonTarget: null });
  wrap.appendChild(skipBtn);

  return wrap;
}

function renderHunterPanel() {
  const panel = $("#hunterPanel");
  if (!panel) return;
  const pending = currentRoom.hunterPending;

  if (!pending) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  const hunter = currentRoom.players[pending.hunterId];
  panel.innerHTML = `<h3>🏹 Thợ Săn "${hunter?.name || "?"}" vừa chết! Chọn người kéo theo:</h3>`;

  const isPlayerActionMode = currentRoom.settings?.gameMode === "playerAction";
  const alive = getAlivePlayers(currentRoom.players).filter(p => p.id !== pending.hunterId);

  // In playerAction mode, show waiting and collapse admin controls
  if (isPlayerActionMode) {
    const waitDiv = document.createElement("div");
    waitDiv.className = "player-action-waiting";
    waitDiv.innerHTML = `
      <div class="waiting-indicator">⏳ Đang chờ <strong>${escapeHtml(hunter?.name || "Thợ Săn")}</strong> chọn người kéo theo trên điện thoại...</div>
      <button class="btn-big btn-skip" id="btnToggleHunterOverride" style="margin-top:10px">🎛️ Admin override</button>
    `;
    panel.appendChild(waitDiv);

    const overrideDiv = document.createElement("div");
    overrideDiv.id = "hunterOverridePanel";
    overrideDiv.className = "hidden";
    panel.appendChild(overrideDiv);

    waitDiv.querySelector("#btnToggleHunterOverride").onclick = () => {
      overrideDiv.classList.toggle("hidden");
    };

    renderHunterControls(alive, overrideDiv);
    return;
  }

  renderHunterControls(alive, panel);
}

function renderHunterControls(alive, container) {
  const wrap = document.createElement("div");
  wrap.className = "select-wrap";
  let selectedId = null;

  alive.forEach((p) => {
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
  confirmBtn.textContent = "🏹 Xác nhận kéo theo";
  confirmBtn.onclick = () => {
    if (!selectedId) { alert("Chọn người Thợ Săn kéo!"); return; }
    submitHunterKill(selectedId);
  };
  wrap.appendChild(confirmBtn);

  const skipBtn = document.createElement("button");
  skipBtn.className = "btn-big btn-skip";
  skipBtn.textContent = "⏭️ Không kéo ai";
  skipBtn.onclick = () => submitHunterKill(null);
  wrap.appendChild(skipBtn);

  container.appendChild(wrap);
}

function renderDayVotePanel() {
  const panel = $("#dayVotePanel");
  if (currentRoom.phase !== "day" || currentRoom.hunterPending) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  panel.innerHTML = "<h3>🗳️ Kết quả vote (realtime)</h3>";

  // Timer controls
  const timerWrap = document.createElement("div");
  timerWrap.id = "timerControls";
  panel.appendChild(timerWrap);
  renderTimerControls();

  const votes = currentRoom.dayVotes || {};
  const alive = getAlivePlayers(currentRoom.players);

  // Sort by vote count desc
  const voteRows = alive.map((p) => ({
    ...p,
    count: Object.values(votes).filter((v) => v === p.id).length,
  })).sort((a, b) => b.count - a.count);

  const tallyDiv = document.createElement("div");
  tallyDiv.className = "vote-tally";
  voteRows.forEach((p) => {
    const row = document.createElement("div");
    row.className = "vote-row";
    const whoVoted = Object.entries(votes)
      .filter(([, tid]) => tid === p.id)
      .map(([vid]) => currentRoom.players[vid]?.name || "?")
      .join(", ");
    row.innerHTML = `
      <span>${p.name}</span>
      <span class="vote-count">${p.count} phiếu${whoVoted ? ` (${whoVoted})` : ""}</span>
    `;
    tallyDiv.appendChild(row);
  });
  panel.appendChild(tallyDiv);

  // Show who hasn't voted
  const votedIds = new Set(Object.keys(votes).filter(k => votes[k]));
  const notVoted = alive.filter(p => !votedIds.has(p.id));
  if (notVoted.length > 0) {
    const nv = document.createElement("p");
    nv.className = "note-disabled";
    nv.textContent = `Chưa vote: ${notVoted.map(p => p.name).join(", ")}`;
    panel.appendChild(nv);
  }

  const nextBtn = document.createElement("button");
  nextBtn.className = "btn-big btn-confirm";
  nextBtn.style.marginTop = "12px";
  nextBtn.textContent = "➡️ KẾT THÚC VOTE & CHUYỂN ĐÊM";
  nextBtn.onclick = () => {
    if (confirm("Chốt kết quả vote và chuyển sang đêm tiếp theo?")) {
      resolveDayAndGoToNight();
    }
  };
  panel.appendChild(nextBtn);
}

function renderGameSetupPanel() {
  const panel = $("#gameSetupPanel");
  if (!panel || currentRoom.phase !== "lobby") {
    panel?.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");

  const settings = currentRoom.settings || {};
  const playerCount = Object.keys(currentRoom.players || {}).length;
  const preset = getRolePreset(playerCount || 11, settings.roleOptions || {});
  const roleList = buildRoleList(preset);

  const wolves = roleList.filter(r => r === "werewolf" || r === "cursed_wolf").length;
  const villagers = roleList.filter(r => ROLE_TEAM[r] === "village").length;
  const thirds = roleList.filter(r => ROLE_TEAM[r] === "third").length;

  panel.innerHTML = `
    <h2>⚙️ Cài đặt Game</h2>
    <p class="note-disabled">Số người hiện tại: <strong>${playerCount}</strong> / Cần 8-20</p>
    <div class="team-summary">
      <span>🐺 Phe Sói: ${wolves}</span>
      <span>👥 Phe Dân: ${villagers}</span>
      ${thirds > 0 ? `<span>🟣 Phe 3: ${thirds}</span>` : ""}
    </div>
    <div class="role-options">
      <p><strong>Vai trò tùy chọn:</strong></p>
      ${buildRoleCheckboxes(settings.roleOptions || {})}
    </div>
    <label class="toggle-row" style="margin-top:12px;border-top:1px solid var(--border-color);padding-top:12px">
      <span>🎮 Chế độ người chơi tự thao tác đêm</span>
      <input type="checkbox" id="gameModeToggle" ${(settings.gameMode || "adminControl") === "playerAction" ? "checked" : ""} />
    </label>
    <p class="note-disabled" style="margin-top:4px">Bật: các vai tự bấm hành động đêm trên điện thoại. Admin vẫn có thể override.</p>
    <p class="note-disabled" style="margin-top:2px">Vai trò trong preset: ${roleList.map(r => ROLE_LABEL_VI[r]).join(", ")}</p>
  `;

  // Bind checkboxes
  panel.querySelectorAll(".role-option-cb").forEach(cb => {
    cb.onchange = async () => {
      const opts = { ...(currentRoom.settings?.roleOptions || {}) };
      opts[cb.dataset.role] = cb.checked;
      await updateDoc(roomRefDoc, { "settings.roleOptions": opts });
    };
  });

  const gameModeToggle = panel.querySelector("#gameModeToggle");
  if (gameModeToggle) {
    gameModeToggle.onchange = toggleGameMode;
  }
}

function buildRoleCheckboxes(options) {
  const optionalRoles = [
    { key: "cupid", label: "💘 Cupid" },
    { key: "witch", label: "🧪 Phù Thủy" },
    { key: "hunter", label: "🏹 Thợ Săn" },
    { key: "elder", label: "👴 Già Làng" },
    { key: "flute_player", label: "🎶 Thổi Sáo" },
    { key: "thief", label: "🃏 Ăn Trộm" },
    { key: "traitor", label: "🕵️ Phản Bội" },
    { key: "cursed_wolf", label: "🌀 Sói Nguyền" },
  ];
  return optionalRoles.map(r => `
    <label class="toggle-row">
      <span>${r.label}</span>
      <input type="checkbox" class="role-option-cb" data-role="${r.key}" ${options[r.key] ? "checked" : ""} />
    </label>
  `).join("");
}

function renderChatPanel() {
  const chat = currentRoom.chat || {};

  // Wolf chat — admin thấy mọi lúc (để theo dõi lịch sử)
  const wolfChatEl = $("#wolfChat");
  if (wolfChatEl) {
    const messages = (chat.wolf || []).slice(-50);
    const msgDiv = wolfChatEl.querySelector(".chat-messages");
    if (msgDiv) {
      if (messages.length === 0) {
        msgDiv.innerHTML = `<div class="chat-empty">Chưa có tin nhắn nào.</div>`;
      } else {
        msgDiv.innerHTML = messages.map(m => {
          const timeStr = m.time ? new Date(m.time).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "";
          return `<div class="chat-msg">
            <span class="chat-sender">🐺 ${escapeHtml(m.name)}</span>
            <span class="chat-time">${timeStr}</span>
            <div class="chat-text">${escapeHtml(m.text)}</div>
          </div>`;
        }).join("");
      }
      msgDiv.scrollTop = msgDiv.scrollHeight;
    }
    wolfChatEl.classList.remove("hidden");
  }

  // Lover chat — admin thấy mọi lúc
  const loverChatEl = $("#loverChat");
  if (loverChatEl) {
    const messages = (chat.lovers || []).slice(-50);
    const msgDiv = loverChatEl.querySelector(".chat-messages");
    if (msgDiv) {
      if (messages.length === 0) {
        msgDiv.innerHTML = `<div class="chat-empty">Chưa có tin nhắn nào.</div>`;
      } else {
        msgDiv.innerHTML = messages.map(m => {
          const timeStr = m.time ? new Date(m.time).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "";
          return `<div class="chat-msg">
            <span class="chat-sender">💞 ${escapeHtml(m.name)}</span>
            <span class="chat-time">${timeStr}</span>
            <div class="chat-text">${escapeHtml(m.text)}</div>
          </div>`;
        }).join("");
      }
      msgDiv.scrollTop = msgDiv.scrollHeight;
    }
    loverChatEl.classList.remove("hidden");
  }
}

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderLogs() {
  const logPanel = $("#logPanel");
  const logs = currentRoom.logs || [];
  logPanel.innerHTML = logs.slice().reverse()
    .map((l) => `<div class="log-entry log-${l.type}">[V${l.round}] ${l.text}</div>`)
    .join("");
}

function renderWinScreen() {
  const winDiv = $("#winScreen");
  if (currentRoom.phase === "ended" && currentRoom.winner) {
    winDiv.classList.remove("hidden");
    // Show full role reveal
    const players = currentRoom.players || {};
    const roleReveal = Object.values(players).map(p =>
      `<div class="player-row ${p.alive ? "" : "dead"}">
        <span>${p.alive === false ? "💀" : "🟢"} ${p.name}</span>
        <span class="player-role">${ROLE_LABEL_VI[p.role] || "?"}</span>
      </div>`
    ).join("");
    winDiv.innerHTML = `
      <h1>${WIN_LABEL_VI[currentRoom.winner]}</h1>
      <div style="margin:16px 0">${roleReveal}</div>
      <button id="btnResetAfterWin" class="btn-big btn-confirm">🔄 Chơi lại</button>
    `;
    $("#btnResetAfterWin").onclick = resetGame;
  } else {
    winDiv.classList.add("hidden");
  }
}

function renderGameModeBadge() {
  const badge = $("#gameModeBadge");
  if (!badge) return;
  const mode = currentRoom.settings?.gameMode || "adminControl";
  badge.textContent = mode === "playerAction" ? "🎮 Chế độ: Người chơi tự thao tác" : "🎛️ Chế độ: Admin kiểm soát";
  badge.className = `game-mode-badge ${mode === "playerAction" ? "mode-player" : "mode-admin"}`;
}

function renderDebugToggle() {
  const toggle = $("#debugToggle");
  if (toggle) toggle.checked = !!currentRoom.settings?.debugMode;
}

function renderTestModeToggle() {
  const toggle = $("#testModeToggle");
  const testModeOn = !!currentRoom.settings?.testMode;
  if (toggle) toggle.checked = testModeOn;
  const badge = $("#testModeBadge");
  if (badge) badge.classList.toggle("hidden", !testModeOn);
}

// ============================================================
// 8. GLOBAL ACTION BRIDGE (for onclick in rendered HTML)
// ============================================================
window._adminAction = (action) => {
  const actions = { startTimer, pauseTimer, skipDiscussion };
  if (actions[action]) actions[action]();
};

// ============================================================
// 9. BIND UI EVENTS
// ============================================================
export function bindAdminUI() {
  $("#btnCreateRoom").onclick = createRoom;
  $("#btnJoinRoom").onclick = () => {
    const code = $("#inputRoomCode").value.trim();
    if (code) enterRoom(code);
  };
  $("#btnStartGame").onclick = startGame;
  $("#btnResetGame").onclick = () => {
    if (confirm("Reset toàn bộ game?")) resetGame();
  };
  $("#debugToggle").onchange = toggleDebugMode;
  $("#testModeToggle").onchange = toggleTestMode;
}

window.addEventListener("DOMContentLoaded", bindAdminUI);
