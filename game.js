// ============================================================
// GAME.JS — CORE LOGIC MA SÓI (LAYER "BỘ NÃO")
// ============================================================
// File này KHÔNG đụng tới DOM / UI.
// Chỉ chứa các hàm thuần (pure-ish) tính toán trạng thái game.
// admin.js sẽ import và gọi các hàm này, rồi ghi kết quả vào Firestore.
// ============================================================

export const ROLES = {
  WEREWOLF: "werewolf",
  SEER: "seer",
  WITCH: "witch",
  GUARDIAN: "guardian",
  CUPID: "cupid",
  VILLAGER: "villager",
};

export const ROLE_LABEL_VI = {
  werewolf: "Ma Sói",
  seer: "Tiên Tri",
  witch: "Phù Thủy",
  guardian: "Bảo Vệ",
  cupid: "Cupid",
  villager: "Dân Làng",
};

// Thứ tự hành động đêm CHUẨN (theo yêu cầu)
// cupid chỉ chạy ở round 1
export const NIGHT_STEPS = ["cupid", "guardian", "werewolf", "seer", "witch"];

// Bộ vai trò cho 11 người: 3 sói, 1 tiên tri, 1 phù thủy, 1 bảo vệ, 1 cupid, 4 dân làng = 11
const ROLE_SETUP_11 = [
  ROLES.WEREWOLF, ROLES.WEREWOLF, ROLES.WEREWOLF,
  ROLES.SEER,
  ROLES.WITCH,
  ROLES.GUARDIAN,
  ROLES.CUPID,
  ROLES.VILLAGER, ROLES.VILLAGER, ROLES.VILLAGER, ROLES.VILLAGER,
];

/**
 * Trộn ngẫu nhiên (Fisher-Yates)
 */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Gán role ngẫu nhiên cho danh sách player (object map playerId -> playerData)
 * Trả về object map mới đã có role.
 */
export function assignRoles(playersMap) {
  const ids = Object.keys(playersMap);
  if (ids.length !== 11) {
    throw new Error(`Cần đúng 11 người chơi, hiện có ${ids.length}`);
  }
  const roles = shuffle(ROLE_SETUP_11);
  const result = {};
  ids.forEach((id, idx) => {
    result[id] = {
      ...playersMap[id],
      role: roles[idx],
      alive: true,
      isLover: false,
    };
  });
  return result;
}

/**
 * Tạo state đêm rỗng cho 1 round
 * LƯU Ý: healUsed/poisonUsed của Witch KHÔNG nằm ở đây vì chúng phải tồn tại
 * xuyên suốt cả game (persistent), không reset theo từng round.
 * Chúng được lưu riêng ở room.witchUsage = { healUsed, poisonUsed }.
 */
export function emptyNightState(round) {
  return {
    round,
    cupid: { done: round !== 1, lovers: [] }, // nếu không phải round 1 thì coi như done luôn (skip)
    guardian: { done: false, protect: null },
    werewolf: { done: false, target: null },
    seer: { done: false, target: null, result: null },
    witch: { done: false, save: false, poisonTarget: null },
  };
}

/**
 * State ban đầu cho witchUsage (persistent toàn game, gọi 1 lần khi startGame)
 */
export function emptyWitchUsage() {
  return { healUsed: false, poisonUsed: false };
}

/**
 * Lấy danh sách step cần chạy trong đêm này (round 1 có cupid, các round sau không)
 */
export function getNightStepsForRound(round) {
  if (round === 1) return [...NIGHT_STEPS];
  return NIGHT_STEPS.filter((s) => s !== "cupid");
}

/**
 * Tính bước kế tiếp trong đêm
 */
export function getNextNightStep(currentStep, round) {
  const steps = getNightStepsForRound(round);
  const idx = steps.indexOf(currentStep);
  if (idx === -1 || idx === steps.length - 1) return null; // hết bước -> đêm xong
  return steps[idx + 1];
}

/**
 * Lấy player còn sống
 */
export function getAlivePlayers(playersMap) {
  return Object.entries(playersMap)
    .filter(([, p]) => p.alive !== false) // chưa có field alive (lobby) cũng coi là "còn sống"
    .map(([id, p]) => ({ id, ...p }));
}

/**
 * Xử lý CUPID: ghép 2 người thành lovers (chỉ đêm 1)
 */
export function applyCupid(playersMap, loverIds) {
  const updated = { ...playersMap };
  loverIds.forEach((id) => {
    updated[id] = { ...updated[id], isLover: true };
  });
  return updated;
}

/**
 * LOGIC TỔNG HỢP: Resolve toàn bộ đêm sau khi đã đủ thông tin từ các bước
 * (guardian.protect, werewolf.target, witch.save, witch.poisonTarget)
 *
 * Trả về:
 * {
 *   updatedPlayers: { ...playersMap với alive đã update },
 *   deaths: [ {id, name, cause} ],   // cause: 'werewolf' | 'poison' | 'lover'
 * }
 *
 * Luật xử lý:
 * 1. Sói chọn nạn nhân -> nếu guardian bảo vệ đúng người đó -> không chết ("được cứu bởi bảo vệ")
 * 2. Nếu không được bảo vệ -> nạn nhân sẽ chết bởi sói, TRỪ KHI witch cứu (heal) người đó
 * 3. Witch độc 1 người khác (nếu dùng) -> người đó chết bởi thuốc độc
 * 4. Sau khi xác định người chết bởi sói/độc -> kiểm tra lover: nếu 1 trong 2 lover chết -> người còn lại chết theo
 */
export function resolveNight(playersMap, nightState) {
  const updated = JSON.parse(JSON.stringify(playersMap)); // deep clone tránh mutate
  const deaths = [];

  const wolfTarget = nightState.werewolf?.target || null;
  const guardTarget = nightState.guardian?.protect || null;
  const witchSaved = nightState.witch?.save === true;
  const poisonTarget = nightState.witch?.poisonTarget || null;

  // 1. Xác định nạn nhân sói có chết không
  if (wolfTarget) {
    const protectedByGuardian = guardTarget === wolfTarget;
    const savedByWitch = witchSaved && wolfTarget; // witch chỉ cứu được người sói cắn

    if (!protectedByGuardian && !savedByWitch) {
      if (updated[wolfTarget] && updated[wolfTarget].alive) {
        updated[wolfTarget].alive = false;
        deaths.push({ id: wolfTarget, name: updated[wolfTarget].name, cause: "werewolf" });
      }
    }
    // nếu được cứu (guardian hoặc witch) -> không chết, log "được cứu" do admin.js thêm
  }

  // 2. Xử lý độc của witch (độc người khác với nạn nhân sói, hoặc trùng cũng được nhưng đã chết rồi thì bỏ qua)
  if (poisonTarget && updated[poisonTarget] && updated[poisonTarget].alive) {
    updated[poisonTarget].alive = false;
    deaths.push({ id: poisonTarget, name: updated[poisonTarget].name, cause: "poison" });
  }

  // 3. Xử lý lovers chết theo nhau (linked lovers)
  // Lặp tới khi không còn ai chết theo nữa
  let loverChainAdded = true;
  while (loverChainAdded) {
    loverChainAdded = false;
    const lovers = Object.entries(updated).filter(([, p]) => p.isLover);
    if (lovers.length === 2) {
      const [idA, pA] = lovers[0];
      const [idB, pB] = lovers[1];
      if (!pA.alive && pB.alive) {
        updated[idB].alive = false;
        deaths.push({ id: idB, name: pB.name, cause: "lover" });
        loverChainAdded = true;
      } else if (!pB.alive && pA.alive) {
        updated[idA].alive = false;
        deaths.push({ id: idA, name: pA.name, cause: "lover" });
        loverChainAdded = true;
      }
    }
  }

  return { updatedPlayers: updated, deaths };
}

/**
 * Xử lý kết quả Tiên Tri xem vai trò
 */
export function resolveSeer(playersMap, targetId) {
  const target = playersMap[targetId];
  if (!target) return null;
  return {
    targetId,
    targetName: target.name,
    isWerewolf: target.role === ROLES.WEREWOLF,
  };
}

/**
 * Tính kết quả vote ban ngày.
 * votes: { voterId: targetId }
 * Trả về { eliminatedId: string|null, isTie: boolean, tally: {targetId: count} }
 * Luật: hòa phiếu cao nhất -> không ai chết
 */
export function resolveDayVote(votes) {
  const tally = {};
  Object.values(votes).forEach((targetId) => {
    if (!targetId) return;
    tally[targetId] = (tally[targetId] || 0) + 1;
  });

  const entries = Object.entries(tally);
  if (entries.length === 0) {
    return { eliminatedId: null, isTie: false, tally };
  }

  const maxVotes = Math.max(...entries.map(([, c]) => c));
  const topCandidates = entries.filter(([, c]) => c === maxVotes).map(([id]) => id);

  if (topCandidates.length > 1) {
    // Hòa phiếu cao nhất -> không ai chết
    return { eliminatedId: null, isTie: true, tally };
  }

  return { eliminatedId: topCandidates[0], isTie: false, tally };
}

/**
 * Áp dụng kết quả vote vào playersMap, có xử lý lover chết theo
 * Trả về { updatedPlayers, deaths }
 */
export function applyDayVoteResult(playersMap, eliminatedId) {
  const updated = JSON.parse(JSON.stringify(playersMap));
  const deaths = [];

  if (eliminatedId && updated[eliminatedId] && updated[eliminatedId].alive) {
    updated[eliminatedId].alive = false;
    deaths.push({ id: eliminatedId, name: updated[eliminatedId].name, cause: "vote" });
  }

  // Lover chết theo (áp dụng tương tự đêm)
  let loverChainAdded = true;
  while (loverChainAdded) {
    loverChainAdded = false;
    const lovers = Object.entries(updated).filter(([, p]) => p.isLover);
    if (lovers.length === 2) {
      const [idA, pA] = lovers[0];
      const [idB, pB] = lovers[1];
      if (!pA.alive && pB.alive) {
        updated[idB].alive = false;
        deaths.push({ id: idB, name: pB.name, cause: "lover" });
        loverChainAdded = true;
      } else if (!pB.alive && pA.alive) {
        updated[idA].alive = false;
        deaths.push({ id: idA, name: pA.name, cause: "lover" });
        loverChainAdded = true;
      }
    }
  }

  return { updatedPlayers: updated, deaths };
}

/**
 * Kiểm tra điều kiện thắng
 * Trả về: null (chưa kết thúc) | 'werewolf' | 'village' | 'lovers'
 * Luật đơn giản chuẩn:
 * - Nếu lovers (2 người) là 2 người cuối cùng còn sống -> Lovers thắng
 * - Nếu hết sói -> Dân làng thắng
 * - Nếu số sói còn sống >= số người không phải sói còn sống -> Sói thắng
 */
export function checkWinCondition(playersMap) {
  const alive = getAlivePlayers(playersMap);
  const aliveWolves = alive.filter((p) => p.role === ROLES.WEREWOLF);
  const aliveVillagers = alive.filter((p) => p.role !== ROLES.WEREWOLF);

  // Check lovers win: chỉ còn đúng 2 người sống và cả 2 là lovers
  if (alive.length === 2 && alive.every((p) => p.isLover)) {
    return "lovers";
  }

  if (aliveWolves.length === 0) {
    return "village";
  }

  if (aliveWolves.length >= aliveVillagers.length) {
    return "werewolf";
  }

  return null;
}

/**
 * Log entry helper
 */
export function makeLogEntry(round, phase, text, type = "info") {
  return {
    round,
    phase,
    text,
    type, // 'info' | 'death' | 'system' | 'vote'
    time: Date.now(),
  };
}

export const DEATH_CAUSE_LABEL_VI = {
  werewolf: "Bị sói cắn 🐺",
  poison: "Bị phù thủy đầu độc ☠️",
  lover: "Chết theo người yêu 💔",
  vote: "Bị dân làng treo cổ 🪢",
};

export const WIN_LABEL_VI = {
  werewolf: "🐺 MA SÓI THẮNG!",
  village: "🏡 DÂN LÀNG THẮNG!",
  lovers: "💞 CẶP ĐÔI THẮNG!",
};
