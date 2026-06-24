// ============================================================
// ADMIN.JS — ĐIỀU KHIỂN GAME v4.0
// ============================================================
// v3.0: Secret History, Player Action Mode, Con Hoang, luật Bảo Vệ
// không lặp người 2 đêm liên tiếp, Role Balance (Auto/Manual), End Game
// Reveal đầy đủ.
// v4.0: + cho phép Sói/Phù Thủy/Tiên Tri/Bảo Vệ "Bỏ qua" hành động,
// + Sói được vote đồng đội, + vote Sói cần đa số tuyệt đối (hòa/không đa
// số = không ai chết), + sửa đúng luật Sói Nguyền (chỉ biến đúng mục
// tiêu đàn Sói đã vote chết, không tự chọn nạn nhân riêng), + Player tự
// xác nhận hành động đêm (khóa sau khi xác nhận, không cần Admin bấm),
// + Auto timer phase đêm (60s/bước, tự xử lý theo trạng thái hiện tại
// khi hết giờ, ở Player Action Mode), + Thợ Săn tự chọn kéo theo ngay
// trên điện thoại (không cần Admin), + Chat riêng Player-Admin, + Reset
// xóa luôn lịch sử chat, + lý do chết do vote hiển thị rõ cho Player.
// Toàn bộ hàm/luồng các bản trước được GIỮ NGUYÊN — chỉ bổ sung/sửa đúng
// phần được yêu cầu, không xóa logic không liên quan.
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
  applyWildChildAdopt, checkWildChildTransform, isValidGuardianTarget,
  makeSecretEntry, groupSecretLog, formatSecretEntry, resolveWolfVote,
  roleIconHtml, phaseIconHtml, avatarHtml, winIconHtml,
} from "./game.js";
let roomCode = null;
let roomRefDoc = null;
let currentRoom = null;
let unsubscribe = null;
// Timer state (local only — not stored in Firestore to avoid conflicts)
let timerInterval = null;
let timerRemaining = 0;
let timerRunning = false;
// Player Action Mode — admin có thể "thao tác thay" cho 1 bước cụ thể
// nếu người chơi bị kẹt; các biến này reset mỗi khi bước đêm / hunterPending đổi.
let manualOverrideActive = false;
let lastNightStepSeen = null;
let hunterManualOverride = false;
let lastHunterPendingKey = null;
// UI Phase 2: theo dõi ai còn sống ở lần render TRƯỚC, chỉ để gắn 1 class
// animation "vừa chết" đúng 1 lần (không phải state game, không lưu Firebase).
let previousAlivePlayerIds = new Set();
// v4.0: thời gian mỗi bước đêm ở Player Action Mode (giây) + cờ chống
// gọi trùng khi watcher tự động chốt bước.
const NIGHT_STEP_SECONDS = 60;
let autoAdvanceInFlight = false;
let globalTickInterval = null;
// Tiêu đề từng bước đêm — dùng chung cho cả UI thao tác thủ công và UI
// trạng thái (Player Action Mode).
const stepTitles = {
  cupid: "💘 Cupid chọn 2 người yêu nhau",
  thief: "🃏 Ăn Trộm chọn vai trò",
  wild_child: "👩 Con Hoang chọn mẹ nuôi",
  guardian: "🛡️ Bảo Vệ chọn người bảo vệ",
  werewolf: "🐺 Sói chọn nạn nhân",
  cursed_wolf: "🌀 Sói Nguyền — biến mục tiêu thành Sói?",
  seer: "🔮 Tiên Tri soi 1 người",
  witch: "🧪 Phù Thủy hành động",
  flute_player: "🎶 Thổi Sáo ru ngủ 2 người",
};
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
    secretLog: [],
    guardianLastProtect: null,
    settings: {
      debugMode: false,
      testMode: false,
      roleMode: "auto",
      roleOptions: {},
      playerCount: 11,
      actionMode: "admin",
      manualRoleCounts: null,
      manualRoles: [],
    },
    winner: null,
    hunterPending: null,
    timerEndAt: null,
    timerDuration: null,
    timerPhase: null,
    nightTimerEndAt: null,
    seerHistory: {},
    thiefOptions: [],
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
  startGlobalTicker();
}
// Tick mỗi giây: cập nhật đồng hồ đêm hiển thị + kiểm tra auto-watcher
// (Player Action Mode: tự chốt bước khi mọi người đã xác nhận, hoặc khi
// hết 60s thì coi như bỏ qua hành động chưa chọn).
function startGlobalTicker() {
  if (globalTickInterval) return;
  globalTickInterval = setInterval(() => {
    updateNightTimerDisplay();
    runAutoWatchers();
  }, 1000);
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
      alert(`Số vai trò (${manualRoles.length}) không khớp số người chơi (${count}). Vào "⚙️ Cài đặt Game" → "🛠️ Tự chọn vai trò" để cấu hình lại.`);
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
    guardianLastProtect: null,
    timerEndAt: null,
    timerDuration: null,
    timerPhase: null,
    nightTimerEndAt: Date.now() + NIGHT_STEP_SECONDS * 1000,
    thiefOptions,
    chat: {}, // bắt đầu game mới — không giữ chat cũ từ trước
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
    secretLog: [],
    guardianLastProtect: null,
    timerEndAt: null,
    timerDuration: null,
    timerPhase: null,
    nightTimerEndAt: null,
    chat: {}, // reset toàn bộ: xóa lịch sử chat Sói + Cặp Đôi + Hỗ trợ, không giữ dữ liệu cũ
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
// ============================================================
// 3. NIGHT ACTIONS
// ============================================================
export async function submitNightAction(step, stepData) {
  if (!currentRoom) return;
  const round = currentRoom.round;
  const nightState = { ...currentRoom.nightState };
  let playersUpdate = currentRoom.players;
  let logs = [...currentRoom.logs];
  let secretLog = [...(currentRoom.secretLog || [])];
  let seerHistory = currentRoom.seerHistory || {};
  let extraFields = {};
  if (step === "cupid") {
    nightState.cupid = { done: true, lovers: stepData.lovers, confirmed: true };
    playersUpdate = applyCupid(currentRoom.players, stepData.lovers);
    const names = stepData.lovers.map((id) => currentRoom.players[id].name).join(" 💞 ");
    logs.push(makeLogEntry(round, "night", `💘 Cupid đã ghép cặp: ${names}`, "info"));
    // Notify lovers via their player data (set loverPartnerId)
    const [idA, idB] = stepData.lovers;
    playersUpdate[idA] = { ...playersUpdate[idA], loverPartnerId: idB };
    playersUpdate[idB] = { ...playersUpdate[idB], loverPartnerId: idA };
    secretLog.push(makeSecretEntry(round, "night", "cupid_pair", "Cupid", names, null));
  }
  if (step === "thief") {
    nightState.thief = { done: true, chosenRole: stepData.chosenRole, confirmed: true };
    if (stepData.thiefId && stepData.chosenRole) {
      playersUpdate = applyThief(currentRoom.players, stepData.thiefId, stepData.chosenRole);
    }
    const thiefName = currentRoom.players[stepData.thiefId]?.name || "Ăn Trộm";
    logs.push(makeLogEntry(round, "night", stepData.chosenRole ? `🃏 Ăn Trộm đã chọn vai trò: ${ROLE_LABEL_VI[stepData.chosenRole] || "?"}` : `🃏 Ăn Trộm giữ nguyên vai trò.`, "info"));
    secretLog.push(makeSecretEntry(round, "night", "thief_swap", thiefName, stepData.chosenRole ? (ROLE_LABEL_VI[stepData.chosenRole] || stepData.chosenRole) : "Giữ nguyên", null));
  }
  if (step === "wild_child") {
    nightState.wild_child = { done: true, adoptParentId: stepData.parentId || null, confirmed: true };
    if (stepData.childId && stepData.parentId) {
      playersUpdate = applyWildChildAdopt(currentRoom.players, stepData.childId, stepData.parentId);
    }
    const childName = currentRoom.players[stepData.childId]?.name || "Con Hoang";
    const parentName = stepData.parentId ? currentRoom.players[stepData.parentId]?.name : "Không ai";
    logs.push(makeLogEntry(round, "night", `👩 Con Hoang đã chọn mẹ nuôi: ${parentName}`, "info"));
    secretLog.push(makeSecretEntry(round, "night", "wild_child_adopt", childName, parentName, null));
  }
  if (step === "guardian") {
    if (!isValidGuardianTarget(stepData.protect, currentRoom.guardianLastProtect)) {
      alert("⚠️ Không thể bảo vệ cùng 1 người 2 đêm liên tiếp! Hãy chọn người khác.");
      return;
    }
    nightState.guardian = { done: true, protect: stepData.protect, confirmed: true };
    const name = stepData.protect ? currentRoom.players[stepData.protect]?.name : "Không ai (bỏ qua)";
    logs.push(makeLogEntry(round, "night", `🛡️ Bảo Vệ đã bảo vệ: ${name}`, "info"));
    secretLog.push(makeSecretEntry(round, "night", "guardian_protect", "Bảo Vệ", name, null));
    extraFields.guardianLastProtect = stepData.protect || null;
  }
  if (step === "werewolf") {
    // target ở đây đã là kết quả CUỐI (đã qua resolveWolfVote nếu là Player Action
    // Mode, hoặc do Admin tự chọn trực tiếp ở Admin Control Mode) — null nghĩa là
    // Sói bỏ qua / không đạt đa số tuyệt đối / hòa phiếu cao nhất ⇒ không ai chết.
    nightState.werewolf = {
      done: true,
      target: stepData.target || null,
      votes: nightState.werewolf?.votes || {},
      confirmedBy: nightState.werewolf?.confirmedBy || {},
    };
    const name = stepData.target ? currentRoom.players[stepData.target]?.name : "Không ai";
    logs.push(makeLogEntry(round, "night", `🐺 Sói đã chọn cắn: ${name}`, "info"));
    secretLog.push(makeSecretEntry(round, "night", "wolf_target", "Sói", name, null));
  }
  if (step === "cursed_wolf") {
    // Sói Nguyền KHÔNG tự chọn nạn nhân riêng — chỉ quyết định CÓ biến đúng
    // mục tiêu mà đàn Sói đã chốt (nightState.werewolf.target) thành Sói hay không.
    nightState.cursed_wolf = { done: true, curse: !!stepData.curse, confirmed: true };
    const wolfTargetId = currentRoom.nightState?.werewolf?.target;
    const wolfTargetName = wolfTargetId ? currentRoom.players[wolfTargetId]?.name : null;
    if (wolfTargetId) {
      logs.push(makeLogEntry(round, "night", stepData.curse ? `🌀 Sói Nguyền chọn biến mục tiêu thành Sói (thay vì giết).` : `🌀 Sói Nguyền không can thiệp — mục tiêu vẫn bị giết như thường.`, "info"));
      secretLog.push(makeSecretEntry(round, "night", "cursed_wolf_curse", "Sói Nguyền", wolfTargetName, stepData.curse ? "Biến thành Sói" : "Không can thiệp"));
    }
  }
  if (step === "seer") {
    const result = stepData.target ? resolveSeer(currentRoom.players, stepData.target) : null;
    nightState.seer = { done: true, target: stepData.target || null, result, confirmed: true };
    // Store seer history (admin secret log)
    if (result) {
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
      secretLog.push(makeSecretEntry(round, "night", "seer_check", "Tiên Tri", result.targetName, result.isWerewolf ? "LÀ SÓI" : "Không phải sói"));
    } else {
      logs.push(makeLogEntry(round, "night", `🔮 Tiên Tri chọn không soi ai (bỏ qua).`, "info"));
      secretLog.push(makeSecretEntry(round, "night", "seer_check", "Tiên Tri", null, "Bỏ qua"));
    }
  }
  let witchUsageUpdate = currentRoom.witchUsage || emptyWitchUsage();
  if (step === "witch") {
    nightState.witch = { done: true, save: !!stepData.save, poisonTarget: stepData.poisonTarget || null, confirmed: true };
    witchUsageUpdate = {
      healUsed: witchUsageUpdate.healUsed || stepData.save === true,
      poisonUsed: witchUsageUpdate.poisonUsed || !!stepData.poisonTarget,
    };
    const saveMsg = stepData.save ? "đã cứu nạn nhân" : "không cứu";
    const poisonMsg = stepData.poisonTarget
      ? `đầu độc ${currentRoom.players[stepData.poisonTarget]?.name}`
      : "không độc ai";
    logs.push(makeLogEntry(round, "night", `🧪 Phù Thủy: ${saveMsg}, ${poisonMsg}`, "info"));
    const wolfTargetIdForLog = currentRoom.nightState?.werewolf?.target;
    const wolfTargetNameForLog = wolfTargetIdForLog ? currentRoom.players[wolfTargetIdForLog]?.name : null;
    if (stepData.save) {
      secretLog.push(makeSecretEntry(round, "night", "witch_save", "Phù Thủy", wolfTargetNameForLog, null));
    }
    if (stepData.poisonTarget) {
      secretLog.push(makeSecretEntry(round, "night", "witch_poison", "Phù Thủy", currentRoom.players[stepData.poisonTarget]?.name, null));
    }
  }
  if (step === "flute_player") {
    nightState.flute_player = { done: true, targets: stepData.targets || [], confirmed: true };
    const names = (stepData.targets || []).map((id) => currentRoom.players[id]?.name).join(", ");
    logs.push(makeLogEntry(round, "night", `🎶 Thổi Sáo đã ru ngủ: ${names || "Không ai"}`, "info"));
    secretLog.push(makeSecretEntry(round, "night", "flute_charm", "Thổi Sáo", names || null, null));
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
      secretLog,
      nightStep: nextStep,
      nightTimerEndAt: Date.now() + NIGHT_STEP_SECONDS * 1000,
      ...extraFields,
    });
    manualOverrideActive = false;
  } else {
    await updateDoc(roomRefDoc, {
      players: playersUpdate,
      nightState,
      witchUsage: witchUsageUpdate,
      seerHistory,
      logs,
      secretLog,
      nightTimerEndAt: null,
      ...extraFields,
    });
    await resolveNightAndGoToDay({
      ...currentRoom,
      players: playersUpdate,
      nightState,
      witchUsage: witchUsageUpdate,
      seerHistory,
      logs,
      secretLog,
      guardianLastProtect: extraFields.guardianLastProtect !== undefined ? extraFields.guardianLastProtect : currentRoom.guardianLastProtect,
    });
  }
}
async function resolveNightAndGoToDay(roomData) {
  const room = roomData || currentRoom;
  const round = room.round;
  const { updatedPlayers: resolvedPlayers, deaths, transforms: curseTransforms } = resolveNight(room.players, room.nightState);
  // Con Hoang: nếu mẹ nuôi vừa chết trong đêm nay → hóa Sói realtime
  const { updatedPlayers, transforms } = checkWildChildTransform(resolvedPlayers);
  let logs = [...room.logs];
  let secretLog = [...(room.secretLog || [])];
  if (deaths.length === 0) {
    logs.push(makeLogEntry(round, "night", `🌙 Đêm thứ ${round}: Bình yên, không ai chết!`, "death"));
  } else {
    deaths.forEach((d) => {
      logs.push(makeLogEntry(round, "night", `💀 ${d.name} đã chết — ${DEATH_CAUSE_LABEL_VI[d.cause]}`, "death"));
      secretLog.push(makeSecretEntry(round, "night", "death", null, d.name, DEATH_CAUSE_LABEL_VI[d.cause]));
    });
    playSound("death");
  }
  // Sói Nguyền biến đổi vai trò (curse-transform) — thông tin BÍ MẬT, chỉ vào secretLog
  curseTransforms.forEach((t) => {
    secretLog.push(makeSecretEntry(round, "night", "role_transform", t.name, null, "Bị Sói Nguyền biến thành Ma Sói (thay vì bị giết)"));
  });
  transforms.forEach((t) => {
    secretLog.push(makeSecretEntry(round, "night", "wild_child_transform", t.name, null, "Mẹ nuôi đã chết → hóa Sói"));
  });
  // Check if Hunter died and needs to pull someone
  const hunterDeath = deaths.find((d) => updatedPlayers[d.id]?.role === "hunter" || room.players[d.id]?.role === "hunter");
  if (hunterDeath) {
    const winner = checkWinCondition(updatedPlayers);
    if (winner) {
      logs.push(makeLogEntry(round, "night", WIN_LABEL_VI[winner], "system"));
      await updateDoc(roomRefDoc, { players: updatedPlayers, phase: "ended", nightStep: null, winner, logs, secretLog, nightTimerEndAt: null });
      playSound("victory");
      return;
    }
    // Pause for hunter action
    await updateDoc(roomRefDoc, {
      players: updatedPlayers,
      nightStep: null,
      hunterPending: { hunterId: hunterDeath.id, phase: "night", round, pendingTarget: null, confirmed: false },
      logs,
      secretLog,
      nightTimerEndAt: null,
    });
    return;
  }
  const winner = checkWinCondition(updatedPlayers);
  if (winner) {
    logs.push(makeLogEntry(round, "night", WIN_LABEL_VI[winner], "system"));
    await updateDoc(roomRefDoc, { players: updatedPlayers, phase: "ended", nightStep: null, winner, logs, secretLog, nightTimerEndAt: null });
    playSound("victory");
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
    nightTimerEndAt: null,
    logs,
    secretLog,
  });
  playSound("day");
}
export async function resolveDayAndGoToNight() {
  if (!currentRoom) return;
  const round = currentRoom.round;
  const votes = currentRoom.dayVotes || {};
  const { eliminatedId, isTie, tally } = resolveDayVote(votes);
  let logs = [...currentRoom.logs];
  let secretLog = [...(currentRoom.secretLog || [])];
  let playersAfterVote = currentRoom.players;
  const tallyStr = Object.entries(tally)
    .map(([id, c]) => `${currentRoom.players[id]?.name || "?"}: ${c} phiếu`)
    .join(", ");
  if (tallyStr) secretLog.push(makeSecretEntry(round, "day", "vote_result", null, null, tallyStr));
  playSound("vote"); // vote ban ngày kết thúc (bất kể có ai bị treo cổ hay không)
  if (isTie) {
    logs.push(makeLogEntry(round, "day", `⚖️ Hòa phiếu — Không ai bị treo cổ.`, "vote"));
  } else if (!eliminatedId) {
    logs.push(makeLogEntry(round, "day", `Không có phiếu nào — Không ai bị treo cổ.`, "vote"));
  } else {
    const { updatedPlayers, deaths } = applyDayVoteResult(currentRoom.players, eliminatedId);
    playersAfterVote = updatedPlayers;
    deaths.forEach((d) => {
      logs.push(makeLogEntry(round, "day", `💀 ${d.name} đã chết — ${DEATH_CAUSE_LABEL_VI[d.cause]}`, "death"));
      secretLog.push(makeSecretEntry(round, "day", "death", null, d.name, DEATH_CAUSE_LABEL_VI[d.cause]));
    });
    if (deaths.length > 0) playSound("death");
    // Con Hoang: mẹ nuôi vừa bị treo cổ → hóa Sói realtime
    const wildChildCheck = checkWildChildTransform(playersAfterVote);
    playersAfterVote = wildChildCheck.updatedPlayers;
    wildChildCheck.transforms.forEach((t) => {
      secretLog.push(makeSecretEntry(round, "day", "wild_child_transform", t.name, null, "Mẹ nuôi đã chết → hóa Sói"));
    });
    // Hunter triggered?
    const hunterDeath = deaths.find((d) => currentRoom.players[d.id]?.role === "hunter");
    if (hunterDeath) {
      const winner = checkWinCondition(playersAfterVote);
      if (winner) {
        logs.push(makeLogEntry(round, "day", WIN_LABEL_VI[winner], "system"));
        await updateDoc(roomRefDoc, { players: playersAfterVote, phase: "ended", winner, logs, secretLog });
        playSound("victory");
        return;
      }
      await updateDoc(roomRefDoc, {
        players: playersAfterVote,
        hunterPending: { hunterId: hunterDeath.id, phase: "day", round, pendingTarget: null, confirmed: false },
        logs,
        secretLog,
      });
      clearTimer();
      return;
    }
  }
  const winner = checkWinCondition(playersAfterVote);
  if (winner) {
    logs.push(makeLogEntry(round, "day", WIN_LABEL_VI[winner], "system"));
    await updateDoc(roomRefDoc, { players: playersAfterVote, phase: "ended", winner, logs, secretLog });
    playSound("victory");
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
    nightTimerEndAt: Date.now() + NIGHT_STEP_SECONDS * 1000,
    logs,
    secretLog,
  });
  playSound("night");
}
// ============================================================
// HUNTER ACTION
// ============================================================
export async function submitHunterKill(targetId) {
  if (!currentRoom || !currentRoom.hunterPending) return;
  const { hunterId, phase, round } = currentRoom.hunterPending;
  const { updatedPlayers: resolvedPlayers, deaths } = applyHunterKill(currentRoom.players, hunterId, targetId);
  const { updatedPlayers, transforms } = checkWildChildTransform(resolvedPlayers);
  let logs = [...currentRoom.logs];
  let secretLog = [...(currentRoom.secretLog || [])];
  const hunterName = currentRoom.players[hunterId]?.name || "Thợ Săn";
  const targetName = targetId ? currentRoom.players[targetId]?.name : null;
  secretLog.push(makeSecretEntry(round, phase, "hunter_pull", hunterName, targetName, null));
  deaths.forEach((d) => {
    logs.push(makeLogEntry(round, phase, `💀 ${d.name} đã chết — ${DEATH_CAUSE_LABEL_VI[d.cause]}`, "death"));
    secretLog.push(makeSecretEntry(round, phase, "death", null, d.name, DEATH_CAUSE_LABEL_VI[d.cause]));
  });
  if (deaths.length > 0) playSound("death");
  transforms.forEach((t) => {
    secretLog.push(makeSecretEntry(round, phase, "wild_child_transform", t.name, null, "Mẹ nuôi đã chết → hóa Sói"));
  });
  const winner = checkWinCondition(updatedPlayers);
  if (winner) {
    logs.push(makeLogEntry(round, phase, WIN_LABEL_VI[winner], "system"));
    await updateDoc(roomRefDoc, { players: updatedPlayers, phase: "ended", winner, hunterPending: null, logs, secretLog });
    playSound("victory");
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
      nightTimerEndAt: null,
      logs,
      secretLog,
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
      nightTimerEndAt: Date.now() + NIGHT_STEP_SECONDS * 1000,
      logs,
      secretLog,
    });
    playSound("night");
  }
}
// ============================================================
// 3b. AUTO WATCHER & NIGHT TIMER (Player Action Mode)
// ============================================================
// Đọc trạng thái "đã chọn" hiện tại từ nightState cho 1 bước, dùng để:
// (1) tự động chốt bước khi mọi người liên quan đã xác nhận, và
// (2) chốt theo trạng thái hiện tại khi hết giờ (chưa chọn = bỏ qua).
function getPendingStepData(step, alive, round) {
  const ns = currentRoom.nightState || {};
  if (step === "werewolf") {
    const votes = ns.werewolf?.votes || {};
    const resolved = resolveWolfVote(votes);
    return { target: resolved.target };
  }
  if (step === "cursed_wolf") {
    return { curse: !!ns.cursed_wolf?.curse };
  }
  if (step === "guardian") {
    return { protect: ns.guardian?.protect || null };
  }
  if (step === "seer") {
    return { target: ns.seer?.target || null };
  }
  if (step === "cupid") {
    return { lovers: ns.cupid?.lovers || [] };
  }
  if (step === "thief") {
    const thiefPlayer = alive.find((p) => p.role === "thief");
    return { thiefId: thiefPlayer?.id, chosenRole: ns.thief?.chosenRole || null };
  }
  if (step === "witch") {
    return { save: !!ns.witch?.save, poisonTarget: ns.witch?.poisonTarget || null };
  }
  if (step === "flute_player") {
    return { targets: ns.flute_player?.targets || [] };
  }
  if (step === "wild_child") {
    const child = alive.find((p) => p.role === "wild_child");
    return { childId: child?.id, parentId: ns.wild_child?.adoptParentId || null };
  }
  return {};
}
// Chạy mỗi giây + mỗi khi có snapshot mới. CHỈ tác động ở Player Action
// Mode (Admin Control Mode vẫn hoàn toàn thủ công như trước — không bị
// timer này ảnh hưởng, tránh cắt ngang lúc Admin đang nhập hộ).
async function runAutoWatchers() {
  if (!currentRoom || autoAdvanceInFlight || !roomRefDoc) return;

  // (a) Thợ Săn tự xác nhận kéo theo → LUÔN tự xử lý ngay (bất kể Admin
  // đang ở chế độ nào), không cần Admin bấm gì. Sửa bug: trước đây hành
  // động này chỉ chạy ở Player Action Mode khiến Thợ Săn bị kẹt ở Admin
  // Control Mode.
  if (currentRoom.hunterPending) {
    if (currentRoom.hunterPending.confirmed && !hunterManualOverride) {
      autoAdvanceInFlight = true;
      try { await submitHunterKill(currentRoom.hunterPending.pendingTarget || null); }
      finally { autoAdvanceInFlight = false; }
    }
    return;
  }

  // (b) Auto-advance bước đêm + timer 60s — CHỈ áp dụng ở Player Action
  // Mode (Admin Control Mode vẫn hoàn toàn thủ công, không bị giới hạn
  // thời gian, tránh cắt ngang lúc Admin đang nhập hộ).
  const actionMode = currentRoom.settings?.actionMode || "admin";
  if (actionMode !== "player") return;
  if (currentRoom.phase !== "night" || !currentRoom.nightStep || manualOverrideActive) return;
  const step = currentRoom.nightStep;
  const round = currentRoom.round;
  const alive = getAlivePlayers(currentRoom.players);
  const ns = currentRoom.nightState || {};
  const timedOut = currentRoom.nightTimerEndAt && currentRoom.nightTimerEndAt <= Date.now();

  let ready = false;
  if (step === "werewolf") {
    const wolves = alive.filter((p) => p.role === "werewolf" || p.role === "cursed_wolf");
    const confirmedBy = ns.werewolf?.confirmedBy || {};
    ready = wolves.length > 0 && wolves.every((w) => confirmedBy[w.id]);
  } else {
    ready = !!ns[step]?.confirmed;
  }
  if (!ready && !timedOut) return;

  const stepData = getPendingStepData(step, alive, round);
  if (step === "cupid" && (!stepData.lovers || stepData.lovers.length !== 2)) {
    return; // Cupid bắt buộc ghép đủ 2 người — không thể tự chốt thiếu, chờ Admin can thiệp nếu cần
  }
  autoAdvanceInFlight = true;
  try {
    await submitNightAction(step, stepData);
  } finally {
    autoAdvanceInFlight = false;
  }
}
function updateNightTimerDisplay() {
  const el = $("#nightTimerDisplay");
  if (!el) return;
  const endAt = currentRoom?.nightTimerEndAt;
  if (!endAt) { el.textContent = ""; return; }
  const remaining = Math.max(0, Math.floor((endAt - Date.now()) / 1000));
  el.textContent = `⏱️ Còn lại: ${remaining}s`;
  el.className = `timer-display ${remaining <= 15 ? "timer-urgent" : ""}`;
}
export async function forceEndNightTimer() {
  if (!currentRoom) return;
  await updateDoc(roomRefDoc, { nightTimerEndAt: Date.now() - 1 });
}

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
  start: "assets/audio/start.mp3",
  night: "assets/audio/night.mp3",
  day: "assets/audio/day.mp3",
  vote: "assets/audio/vote.mp3",
  death: "assets/audio/death.mp3",
  victory: "assets/audio/victory.mp3",
};
function playSound(key) {
  try {
    const audio = new Audio(SOUNDS[key]);
    audio.volume = 0.6;
    // .catch() nuốt lỗi nếu file chưa tồn tại hoặc trình duyệt chặn autoplay
    // (mobile yêu cầu phải có tương tác người dùng trước đó trong cùng phiên).
    audio.play().catch(() => {});
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
  renderSecretHistory();
  renderWinScreen();
  renderDebugToggle();
  renderTestModeToggle();
  renderGameSetupPanel();
  renderChatPanel();
  renderSupportPanel();
  // Sync timer from Firestore if running
  if (currentRoom.timerEndAt && currentRoom.timerEndAt > Date.now()) {
    runLocalTimer(currentRoom.timerEndAt);
  }
  runAutoWatchers();
}
function renderPhaseBanner() {
  const banner = $("#phaseBanner");
  const { phase, round } = currentRoom;
  const count = Object.keys(currentRoom.players || {}).length;
  const labels = {
    lobby: { title: `Phòng chờ (${count}/${currentRoom.settings?.playerCount || "?"} người)`, sub: "Đang chờ mọi người vào làng..." },
    night: { title: `ĐÊM ${round}`, sub: "Sói đang săn mồi trong bóng tối..." },
    day: { title: `NGÀY ${round}`, sub: "Một ngày mới — thảo luận và bỏ phiếu!" },
    ended: { title: `KẾT THÚC`, sub: "Trận đấu đã ngã ngũ." },
  };
  const cur = labels[phase] || { title: "", sub: "" };
  // Icon hiển thị DUY NHẤT qua phaseIconHtml() (ảnh, tự fallback emoji nếu
  // chưa có ảnh) — text không còn nhúng emoji riêng để tránh lặp icon.
  banner.innerHTML = `${phaseIconHtml(phase)}${cur.title}<span class="phase-sub">${cur.sub}</span>`;
  banner.className = `phase-banner phase-${phase}`;
  // UI Phase 1/2: theme nền night/day theo phase hiện tại (chỉ đổi giao diện).
  // Luôn remove cả 2 trước rồi add đúng 1 — không dùng toggle(name, force) vì
  // có thể để lại cả 2 class cùng lúc nếu gọi nhiều lần liên tiếp.
  document.body.classList.remove("night", "day");
  document.body.classList.add(phase === "night" ? "night" : "day");
}
function renderPlayerList() {
  const container = $("#playerListAdmin");
  container.innerHTML = "";
  const players = currentRoom.players || {};
  const votes = currentRoom.dayVotes || {};
  // Count votes per player
  const voteTally = {};
  Object.values(votes).forEach((tid) => { if (tid) voteTally[tid] = (voteTally[tid] || 0) + 1; });
  const currentAliveIds = new Set(Object.entries(players).filter(([, p]) => p.alive !== false).map(([id]) => id));
  Object.entries(players).forEach(([id, p]) => {
    const isDead = p.alive === false;
    // Vừa chết SO VỚI lần render trước → gắn class animation 1 lần (UI Phase 2)
    const justDied = isDead && previousAlivePlayerIds.has(id) && previousAlivePlayerIds.size > 0;
    const div = document.createElement("div");
    div.className = `player-row ${isDead ? "dead" : ""} ${justDied ? "just-died" : ""}`;
    const roleText = p.role ? `${roleIconHtml(p.role, 18)}${ROLE_LABEL_VI[p.role]}` : "";
    const voteText = currentRoom.phase === "day" && voteTally[id] ? `🗳️ ${voteTally[id]}` : "";
    const loverName = p.loverPartnerId && players[p.loverPartnerId] ? `💞${players[p.loverPartnerId].name}(${ROLE_LABEL_VI[players[p.loverPartnerId].role] || "?"})` : "";
    // Lobby chưa chia vai trò → hiện trạng thái "Đang chờ" thân thiện kiểu Ngôi Làng
    const statusOrRole = p.role
      ? `<span class="player-role">${roleText} ${voteText}</span>`
      : currentRoom.phase === "lobby"
        ? `<span class="player-status-waiting">🟢 Đang chờ</span>`
        : `<span class="player-role">${voteText}</span>`;
    div.innerHTML = `
      <span class="player-name">${avatarHtml(p.name, 32)} ${isDead ? "💀" : "🟢"} ${p.name} ${loverName}</span>
      ${statusOrRole}
      ${currentRoom.phase === "lobby" ? `<button class="btn-kick" data-id="${id}">Xóa</button>` : ""}
    `;
    container.appendChild(div);
  });
  previousAlivePlayerIds = currentAliveIds;
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
  const actionMode = currentRoom.settings?.actionMode || "admin";

  if (step !== lastNightStepSeen) {
    lastNightStepSeen = step;
    manualOverrideActive = false;
  }

  const title = document.createElement("h3");
  title.textContent = `${stepTitles[step] || step} (Đêm ${round})`;
  panel.appendChild(title);

  if (actionMode === "player" && !manualOverrideActive) {
    panel.appendChild(buildNightTimerWidget());
    panel.appendChild(buildPlayerModeStatusPanel(step, alive));
    const overrideBtn = document.createElement("button");
    overrideBtn.className = "btn-big btn-skip";
    overrideBtn.textContent = "🛠️ Admin thao tác thay";
    overrideBtn.onclick = () => { manualOverrideActive = true; renderNightActionPanel(); };
    panel.appendChild(overrideBtn);
    return;
  }
  if (actionMode === "player" && manualOverrideActive) {
    const note = document.createElement("p");
    note.className = "note-disabled";
    note.textContent = "🛠️ Admin đang thao tác thay cho bước này (người chơi vẫn tự bấm ở các bước sau).";
    panel.appendChild(note);
  }

  if (step === "cupid") {
    panel.appendChild(buildMultiSelect(alive, 2, (selected) => {
      submitNightAction("cupid", { lovers: selected });
    }, "Xác nhận ghép cặp")); // Cupid bắt buộc — không có lựa chọn bỏ qua
  } else if (step === "thief") {
    panel.appendChild(buildThiefPanel(alive));
  } else if (step === "wild_child") {
    const child = alive.find((p) => p.role === "wild_child");
    const eligible = alive.filter((p) => p.id !== child?.id);
    panel.appendChild(buildSingleSelect(eligible, "chọn mẹ nuôi", (id) => {
      submitNightAction("wild_child", { childId: child?.id, parentId: id });
    }, true));
  } else if (step === "guardian") {
    const lastProtect = currentRoom.guardianLastProtect;
    const eligible = alive.filter((p) => p.id !== lastProtect);
    if (lastProtect && currentRoom.players[lastProtect]) {
      const note = document.createElement("p");
      note.className = "note-disabled";
      note.textContent = `(${currentRoom.players[lastProtect].name} không thể chọn lại — đã bảo vệ đêm trước)`;
      panel.appendChild(note);
    }
    panel.appendChild(buildSingleSelect(eligible, "Bảo vệ", (id) => {
      submitNightAction("guardian", { protect: id });
    }, true));
  } else if (step === "werewolf") {
    // Sói được phép vote/chọn bất kỳ ai còn sống, kể cả đồng đội Sói (chiến
    // thuật tạo niềm tin với dân) — và có thể "Bỏ qua" (không giết ai).
    panel.appendChild(buildSingleSelect(alive, "Sói cắn", (id) => {
      submitNightAction("werewolf", { target: id });
    }, true));
  } else if (step === "cursed_wolf") {
    panel.appendChild(buildCursedWolfPanel());
  } else if (step === "seer") {
    panel.appendChild(buildSeerPanel(alive));
  } else if (step === "witch") {
    panel.appendChild(buildWitchPanel(alive));
  } else if (step === "flute_player") {
    panel.appendChild(buildMultiSelect(alive.filter(p => p.role !== "flute_player"), 2, (selected) => {
      submitNightAction("flute_player", { targets: selected });
    }, "Xác nhận ru ngủ", true));
  }
}
// Sói Nguyền (v4.0): KHÔNG tự chọn nạn nhân riêng. Chỉ quyết định có biến
// đúng mục tiêu mà đàn Sói đã chốt thành Sói (thay vì giết) hay không.
function buildCursedWolfPanel() {
  const wrap = document.createElement("div");
  wrap.className = "select-wrap";
  const wolfTargetId = currentRoom.nightState?.werewolf?.target;
  const wolfTarget = wolfTargetId ? currentRoom.players[wolfTargetId] : null;
  if (!wolfTargetId) {
    wrap.innerHTML = `<p class="note-disabled">Đàn Sói đêm nay không đạt đa số tuyệt đối để giết ai (hoặc hòa phiếu/bỏ qua) — không có mục tiêu để nguyền.</p>`;
    const btn = document.createElement("button");
    btn.className = "btn-big btn-confirm";
    btn.textContent = "➡️ Tiếp tục";
    btn.onclick = () => submitNightAction("cursed_wolf", { curse: false });
    wrap.appendChild(btn);
    return wrap;
  }
  const info = document.createElement("p");
  info.innerHTML = `Mục tiêu đàn Sói đã chốt đêm nay: <strong>${wolfTarget?.name}</strong>. Biến người này thành Sói thay vì giết?`;
  wrap.appendChild(info);
  let curse = false;
  const optWrap = document.createElement("div");
  optWrap.className = "select-wrap";
  const yesBtn = document.createElement("button");
  yesBtn.className = "select-option";
  yesBtn.textContent = "🌀 Biến thành Sói";
  const noBtn = document.createElement("button");
  noBtn.className = "select-option active";
  noBtn.textContent = "❌ Không, cứ giết";
  yesBtn.onclick = () => { curse = true; yesBtn.classList.add("active"); noBtn.classList.remove("active"); };
  noBtn.onclick = () => { curse = false; noBtn.classList.add("active"); yesBtn.classList.remove("active"); };
  optWrap.appendChild(yesBtn);
  optWrap.appendChild(noBtn);
  wrap.appendChild(optWrap);
  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn-big btn-confirm";
  confirmBtn.textContent = "✅ Xác nhận";
  confirmBtn.onclick = () => submitNightAction("cursed_wolf", { curse });
  wrap.appendChild(confirmBtn);
  return wrap;
}
// Đồng hồ đêm (chỉ hiển thị/áp dụng ở Player Action Mode — Admin Control
// Mode vẫn hoàn toàn thủ công, không bị giới hạn thời gian).
function buildNightTimerWidget() {
  const wrap = document.createElement("div");
  const display = document.createElement("div");
  display.id = "nightTimerDisplay";
  display.className = "timer-display";
  wrap.appendChild(display);
  const forceBtn = document.createElement("button");
  forceBtn.className = "btn-big btn-danger";
  forceBtn.textContent = "⏭ Hết giờ ngay (chốt theo lựa chọn hiện tại)";
  forceBtn.onclick = () => forceEndNightTimer();
  wrap.appendChild(forceBtn);
  updateNightTimerDisplay();
  return wrap;
}
// Player Action Mode: CHỈ hiển thị trạng thái (người chơi tự chọn + tự xác
// nhận ngay trên điện thoại của họ — xem player.js). Admin không cần bấm gì,
// hệ thống tự chốt bước khi đủ điều kiện hoặc khi hết giờ. Vẫn có nút
// "Admin thao tác thay" (render ở ngoài) để dự phòng người chơi bị kẹt.
function buildPlayerModeStatusPanel(step, alive) {
  const wrap = document.createElement("div");
  wrap.className = "select-wrap";
  const ns = currentRoom.nightState || {};
  const players = currentRoom.players;

  if (step === "werewolf") {
    const wolves = alive.filter((p) => p.role === "werewolf" || p.role === "cursed_wolf");
    const votes = ns.werewolf?.votes || {};
    const confirmedBy = ns.werewolf?.confirmedBy || {};
    const confirmedCount = wolves.filter((w) => confirmedBy[w.id]).length;
    const rows = wolves.map((w) =>
      `<div class="vote-row"><span>${w.name} ${confirmedBy[w.id] ? "✅" : "⏳"}</span><span>${votes[w.id] ? players[votes[w.id]]?.name : "(chưa chọn)"}</span></div>`
    ).join("");
    wrap.innerHTML = `<p>🐺 Sói đang tự chọn realtime trên điện thoại (${confirmedCount}/${wolves.length} đã xác nhận):</p>${rows || `<p class="note-disabled">Chưa có Sói nào.</p>`}`;
  } else {
    const confirmed = !!ns[step]?.confirmed;
    wrap.innerHTML = `<p>${stepTitles[step] || step}: ${confirmed ? "✅ Đã xác nhận — đang xử lý..." : "⏳ Đang chờ người chơi tự chọn & xác nhận trên điện thoại..."}</p>`;
  }
  return wrap;
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
      if (selectedId === p.id) {
        // Bấm lại chính người đã chọn → hủy lựa chọn (chưa Xác nhận thì chưa khóa)
        wrap.querySelectorAll(".select-option").forEach((b) => b.classList.remove("active"));
        selectedId = null;
        return;
      }
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
  }, true));
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
    lastHunterPendingKey = null;
    return;
  }
  panel.classList.remove("hidden");
  const hunter = currentRoom.players[pending.hunterId];
  panel.innerHTML = `<h3>🏹 Thợ Săn "${hunter?.name || "?"}" vừa chết!</h3>`;

  const pendingKey = `${pending.hunterId}_${pending.round}_${pending.phase}`;
  if (pendingKey !== lastHunterPendingKey) {
    lastHunterPendingKey = pendingKey;
    hunterManualOverride = false;
  }

  // Thợ Săn LUÔN tự chọn người kéo theo ngay trên điện thoại của họ (xem
  // player.js) — không cần biết Admin đang ở chế độ nào. Ở đây Admin chỉ
  // theo dõi trạng thái + có nút thao tác thay nếu Thợ Săn bị kẹt/AFK.
  if (!hunterManualOverride) {
    const target = pending.pendingTarget;
    const info = document.createElement("p");
    info.innerHTML = pending.confirmed
      ? `✅ Thợ Săn đã tự xác nhận: <strong>${target ? currentRoom.players[target]?.name : "Không kéo ai"}</strong> — đang xử lý...`
      : `⏳ Đang chờ Thợ Săn tự chọn trên điện thoại: <strong>${target ? currentRoom.players[target]?.name : "(chưa chọn)"}</strong>`;
    panel.appendChild(info);
    const overrideBtn = document.createElement("button");
    overrideBtn.className = "btn-big btn-skip";
    overrideBtn.textContent = "🛠️ Admin thao tác thay";
    overrideBtn.onclick = () => { hunterManualOverride = true; renderHunterPanel(); };
    panel.appendChild(overrideBtn);
    return;
  }

  const alive = getAlivePlayers(currentRoom.players).filter(p => p.id !== pending.hunterId);
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
  panel.appendChild(wrap);
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
  const roleMode = settings.roleMode || "auto";
  const actionMode = settings.actionMode || "admin";

  let html = `<h2>⚙️ Cài đặt Game</h2>`;
  html += `<p class="note-disabled">Số người hiện tại: <strong>${playerCount}</strong> / Cần 8-20</p>`;

  html += `
    <div class="toggle-row">
      <label for="actionModeSelect">🕹️ Chế độ hành động đêm</label>
      <select id="actionModeSelect">
        <option value="admin" ${actionMode === "admin" ? "selected" : ""}>🛠️ Admin điều khiển</option>
        <option value="player" ${actionMode === "player" ? "selected" : ""}>📱 Người chơi tự bấm</option>
      </select>
    </div>
    <p class="note-disabled">${actionMode === "player" ? "Người chơi tự chọn hành động trên điện thoại realtime — Admin chỉ cần bấm 1 nút Xác nhận để chuyển bước." : "Admin nhập hộ toàn bộ hành động đêm theo lời người chơi nói (kiểu truyền thống)."}</p>
  `;

  html += `
    <div class="toggle-row">
      <label for="roleModeSelect">🎲 Cách chia vai trò</label>
      <select id="roleModeSelect">
        <option value="auto" ${roleMode === "auto" ? "selected" : ""}>🤖 Tự động cân bằng</option>
        <option value="manual" ${roleMode === "manual" ? "selected" : ""}>🛠️ Tự chọn vai trò</option>
      </select>
    </div>
  `;

  if (roleMode === "auto") {
    const preset = getRolePreset(playerCount || 11, settings.roleOptions || {});
    const roleList = buildRoleList(preset);
    const wolves = roleList.filter(r => r === "werewolf" || r === "cursed_wolf").length;
    const villagers = roleList.filter(r => ROLE_TEAM[r] === "village").length;
    const thirds = roleList.filter(r => ROLE_TEAM[r] === "third").length;
    html += `
      <div class="team-summary">
        <span>🐺 Phe Sói: ${wolves}</span>
        <span>👥 Phe Dân: ${villagers}</span>
        ${thirds > 0 ? `<span>🟣 Phe 3: ${thirds}</span>` : ""}
      </div>
      <div class="role-options">
        <p><strong>Vai trò tùy chọn:</strong></p>
        ${buildRoleCheckboxes(settings.roleOptions || {})}
      </div>
      <p class="note-disabled" style="margin-top:8px">Vai trò trong preset: ${roleList.map(r => ROLE_LABEL_VI[r]).join(", ")}</p>
    `;
  } else {
    html += buildManualRoleEditor(settings, playerCount || 11);
  }

  panel.innerHTML = html;

  const actionSelect = $("#actionModeSelect");
  if (actionSelect) {
    actionSelect.onchange = async () => {
      await updateDoc(roomRefDoc, { "settings.actionMode": actionSelect.value });
    };
  }
  const roleModeSelect = $("#roleModeSelect");
  if (roleModeSelect) {
    roleModeSelect.onchange = async () => {
      await updateDoc(roomRefDoc, { "settings.roleMode": roleModeSelect.value });
    };
  }
  panel.querySelectorAll(".role-option-cb").forEach(cb => {
    cb.onchange = async () => {
      const opts = { ...(currentRoom.settings?.roleOptions || {}) };
      opts[cb.dataset.role] = cb.checked;
      await updateDoc(roomRefDoc, { "settings.roleOptions": opts });
    };
  });
  if (roleMode === "manual") {
    bindManualRoleEditor(playerCount || 11);
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
    { key: "wild_child", label: "👩 Con Hoang" },
  ];
  return optionalRoles.map(r => `
    <label class="toggle-row">
      <span>${r.label}</span>
      <input type="checkbox" class="role-option-cb" data-role="${r.key}" ${options[r.key] ? "checked" : ""} />
    </label>
  `).join("");
}
function buildManualRoleEditor(settings, playerCount) {
  const counts = settings.manualRoleCounts || getRolePreset(playerCount, settings.roleOptions || {});
  const rows = Object.keys(ROLE_LABEL_VI).map((role) => `
    <div class="manual-role-row">
      <span>${ROLE_LABEL_VI[role]}</span>
      <input type="number" min="0" max="${playerCount}" value="${counts[role] || 0}" class="manual-role-input" data-role="${role}" />
    </div>
  `).join("");
  return `
    <div id="manualRoleEditorWrap">
      <p><strong>Tự chọn số lượng từng vai trò:</strong></p>
      ${rows}
      <p id="manualRoleTotal" class="note-disabled"></p>
      <button id="btnSaveManualRoles" class="btn-big btn-confirm">💾 Lưu cấu hình vai trò</button>
    </div>
  `;
}
function bindManualRoleEditor(playerCount) {
  const inputs = $$(".manual-role-input");
  if (!inputs.length) return;
  const updateTotal = () => {
    let total = 0;
    inputs.forEach((i) => { total += parseInt(i.value, 10) || 0; });
    const totalEl = $("#manualRoleTotal");
    if (totalEl) {
      totalEl.textContent = `Tổng: ${total} / cần ${playerCount}`;
      totalEl.style.color = total === playerCount ? "var(--accent-good)" : "var(--accent-blood)";
    }
  };
  inputs.forEach((i) => { i.oninput = updateTotal; });
  updateTotal();
  const saveBtn = $("#btnSaveManualRoles");
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const preset = {};
      let total = 0;
      inputs.forEach((i) => {
        const v = parseInt(i.value, 10) || 0;
        if (v > 0) preset[i.dataset.role] = v;
        total += v;
      });
      if (total !== playerCount) {
        alert(`Tổng vai trò (${total}) phải bằng đúng số người chơi (${playerCount})!`);
        return;
      }
      const roleList = buildRoleList(preset);
      await updateDoc(roomRefDoc, { "settings.manualRoles": roleList, "settings.manualRoleCounts": preset });
      alert("✅ Đã lưu cấu hình vai trò!");
    };
  }
}
function renderChatPanel() {
  // (Lưu ý: bản v2.0 trước đây có 1 dòng guard tham chiếu tới "#chatPanel" —
  // id này không tồn tại trong admin.html nên hàm này luôn return sớm và
  // khung Wolf Chat/Lover Chat của Admin chưa từng thực sự cập nhật. Đã bỏ
  // guard này để Secret Chat Monitor hoạt động đúng như yêu cầu.)
  const chat = currentRoom.chat || {};
  const players = currentRoom.players || {};
  // wolf chat
  const wolfChatEl = $("#wolfChat");
  if (wolfChatEl && currentRoom.phase === "night") {
    wolfChatEl.classList.remove("hidden");
    const messages = (chat.wolf || []).slice(-20);
    const msgDiv = wolfChatEl.querySelector(".chat-messages");
    if (msgDiv) {
      msgDiv.innerHTML = messages.map(m =>
        `<div class="chat-msg"><strong>${m.name}:</strong> ${escapeHtml(m.text)}</div>`
      ).join("");
      msgDiv.scrollTop = msgDiv.scrollHeight;
    }
  } else if (wolfChatEl) {
    wolfChatEl.classList.add("hidden");
  }
  // admin can see all chats
  const loverChatEl = $("#loverChat");
  if (loverChatEl) {
    const messages = (chat.lovers || []).slice(-20);
    const msgDiv = loverChatEl.querySelector(".chat-messages");
    if (msgDiv) {
      msgDiv.innerHTML = messages.map(m =>
        `<div class="chat-msg"><strong>${m.name}:</strong> ${escapeHtml(m.text)}</div>`
      ).join("");
      msgDiv.scrollTop = msgDiv.scrollHeight;
    }
    loverChatEl.classList.remove("hidden");
  }
}
// Chat riêng Player ↔ Admin (hỏi luật / báo lỗi / cần hỗ trợ). Mỗi player
// có 1 thread riêng (chat.support.{playerId}), Admin xem & trả lời từng
// thread. Hoạt động ở MỌI phase (lobby/đêm/ngày/kết thúc).
function renderSupportPanel() {
  const panel = $("#supportPanel");
  if (!panel) return;
  const support = currentRoom.chat?.support || {};
  const playerIds = Object.keys(support).filter((id) => (support[id] || []).length > 0);
  if (playerIds.length === 0) {
    panel.innerHTML = `<h2>💬 Hỗ trợ Player</h2><p class="note-disabled">Chưa có player nào cần hỗ trợ.</p>`;
    return;
  }
  let html = `<h2>💬 Hỗ trợ Player</h2>`;
  playerIds.forEach((pid) => {
    const name = currentRoom.players[pid]?.name || "(đã rời phòng)";
    const thread = support[pid] || [];
    html += `
      <div class="support-thread">
        <h3>${name}</h3>
        <div class="chat-messages support-msgs" data-pid="${pid}">
          ${thread.slice(-15).map((m) => `<div class="chat-msg ${m.from === "admin" ? "chat-mine" : ""}"><strong>${m.from === "admin" ? "Bạn" : name}:</strong> ${escapeHtml(m.text)}</div>`).join("")}
        </div>
        <div class="chat-input-row">
          <input type="text" class="support-reply-input" data-pid="${pid}" placeholder="Trả lời ${name}..." />
          <button class="btn-send support-reply-send" data-pid="${pid}">Gửi</button>
        </div>
      </div>
    `;
  });
  panel.innerHTML = html;
  panel.querySelectorAll(".support-msgs").forEach((el) => { el.scrollTop = el.scrollHeight; });
  panel.querySelectorAll(".support-reply-send").forEach((btn) => {
    btn.onclick = async () => {
      const pid = btn.dataset.pid;
      const input = panel.querySelector(`.support-reply-input[data-pid="${pid}"]`);
      if (!input?.value.trim()) return;
      const thread = [...((currentRoom.chat?.support?.[pid]) || [])];
      thread.push({ from: "admin", name: "Admin", text: input.value.trim(), time: Date.now() });
      await updateDoc(roomRefDoc, { [`chat.support.${pid}`]: thread });
      input.value = "";
    };
  });
  panel.querySelectorAll(".support-reply-input").forEach((input) => {
    input.onkeydown = (e) => {
      if (e.key === "Enter") panel.querySelector(`.support-reply-send[data-pid="${input.dataset.pid}"]`)?.click();
    };
  });
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
// Lịch sử bí mật có cấu trúc — chỉ Admin thấy realtime trong lúc chơi.
// Khi game kết thúc, player.js sẽ tự mở khóa hiển thị field secretLog này.
function renderSecretHistory() {
  const panel = $("#secretHistoryPanel");
  if (!panel) return;
  const groups = groupSecretLog(currentRoom.secretLog || []).slice().reverse();
  if (groups.length === 0) {
    panel.innerHTML = `<h2>🕵️ Lịch sử bí mật (chỉ Admin)</h2><p class="note-disabled">Chưa có hành động bí mật nào.</p>`;
    return;
  }
  let html = `<h2>🕵️ Lịch sử bí mật (chỉ Admin)</h2>`;
  groups.forEach((g) => {
    html += `<div class="timeline-header">${g.phase === "night" ? "🌙 Đêm" : "☀️ Ngày"} ${g.round}</div>`;
    g.entries.forEach((e) => {
      html += `<div class="log-entry">${formatSecretEntry(e)}</div>`;
    });
  });
  panel.innerHTML = html;
}
function renderWinScreen() {
  const winDiv = $("#winScreen");
  if (currentRoom.phase === "ended" && currentRoom.winner) {
    winDiv.classList.remove("hidden");
    // Show full role reveal: vai trò ban đầu / hiện tại / phe
    const players = currentRoom.players || {};
    const roleReveal = Object.values(players).map(p => {
      const changed = p.originalRole && p.originalRole !== p.role;
      const team = ROLE_TEAM[p.role];
      return `<div class="player-row ${p.alive ? "" : "dead"}">
        <span class="player-name">${avatarHtml(p.name, 30)} ${p.alive === false ? "💀" : "🟢"} ${p.name}</span>
        <span class="player-role">
          ${roleIconHtml(p.originalRole || p.role, 18)}Ban đầu: ${ROLE_LABEL_VI[p.originalRole] || ROLE_LABEL_VI[p.role] || "?"}${changed ? ` → Hiện tại: ${roleIconHtml(p.role, 18)}${ROLE_LABEL_VI[p.role] || p.role}` : ""}
          · ${ROLE_TEAM_LABEL_VI[team] || ""}
        </span>
      </div>`;
    }).join("");
    winDiv.innerHTML = `
      <div class="victory-icon">${winIconHtml(currentRoom.winner, 64)}</div>
      <h1>${WIN_LABEL_VI[currentRoom.winner]}</h1>
      <div style="margin:16px 0">${roleReveal}</div>
      <p class="note-disabled">📜 Người chơi giờ có thể xem toàn bộ vai trò và lịch sử trận đấu ngay trên điện thoại của họ.</p>
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
