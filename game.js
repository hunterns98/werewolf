// ============================================================
// GAME.JS — CORE LOGIC MA SÓI (LAYER "BỘ NÃO") v4.0
// ============================================================
// v3.0: + Con Hoang, + Secret Log (bí mật/timeline), + luật Bảo Vệ
//       không lặp người 2 đêm liên tiếp, + originalRole cho reveal,
//       + relationship Cupid bền vững qua biến đổi vai trò.
// v4.0: + resolveWolfVote (vote Sói cần đa số tuyệt đối, hòa/không đa số
//       = không ai chết; Sói được vote đồng đội), + sửa lại đúng luật
//       Sói Nguyền (chỉ biến đúng mục tiêu đàn Sói vote chết, không tự
//       chọn nạn nhân riêng), + deathCause lưu trên player (để Player tự
//       biết lý do chết do VOTE — công khai — nhưng vẫn ẩn lý do ban đêm).
// Toàn bộ hàm trong file này là HÀM THUẦN (không đụng DOM/Firebase),
// được admin.js và player.js cùng import để đảm bảo 2 phía luôn
// tính ra kết quả giống nhau.
// ============================================================

export const ROLES = {
  WEREWOLF: "werewolf",
  SEER: "seer",
  WITCH: "witch",
  GUARDIAN: "guardian",
  CUPID: "cupid",
  VILLAGER: "villager",
  HUNTER: "hunter",
  ELDER: "elder",
  FLUTE_PLAYER: "flute_player",
  THIEF: "thief",
  TRAITOR: "traitor",
  CURSED_WOLF: "cursed_wolf",
  WILD_CHILD: "wild_child",
};

export const ROLE_LABEL_VI = {
  werewolf: "Ma Sói",
  seer: "Tiên Tri",
  witch: "Phù Thủy",
  guardian: "Bảo Vệ",
  cupid: "Cupid",
  villager: "Dân Làng",
  hunter: "Thợ Săn",
  elder: "Già Làng",
  flute_player: "Thổi Sáo",
  thief: "Ăn Trộm",
  traitor: "Phản Bội",
  cursed_wolf: "Sói Nguyền",
  wild_child: "Con Hoang",
};

export const ROLE_TEAM = {
  werewolf: "wolf",
  seer: "village",
  witch: "village",
  guardian: "village",
  cupid: "village",
  villager: "village",
  hunter: "village",
  elder: "village",
  flute_player: "third",
  thief: "village", // changes after setup
  traitor: "third",
  cursed_wolf: "wolf",
  wild_child: "village", // changes to "wolf" automatically once role becomes werewolf
};

// Thứ tự hành động đêm đầy đủ (tham khảo)
export const NIGHT_STEPS_FULL = [
  "cupid", "thief", "wild_child", "guardian", "werewolf",
  "cursed_wolf", "seer", "witch", "flute_player",
];

// ============================================================
// ROLE PRESETS by player count
// ============================================================

export function getRolePreset(count, options = {}) {
  // options: { cupid, witch, elder, flute_player, thief, traitor, cursed_wolf, wild_child }
  const base = buildBasePreset(count);
  return applyOptions(base, count, options);
}

function buildBasePreset(count) {
  if (count <= 9) {
    return {
      werewolf: 2, seer: 1, guardian: 1,
      hunter: count >= 9 ? 1 : 0,
      villager: count - 2 - 1 - 1 - (count >= 9 ? 1 : 0),
    };
  } else if (count <= 11) {
    return { werewolf: 3, seer: 1, guardian: 1, hunter: 1, villager: count - 6 };
  } else if (count <= 13) {
    return { werewolf: 3, seer: 1, guardian: 1, hunter: 1, cupid: 1, villager: count - 7 };
  } else if (count === 14) {
    return { werewolf: 3, seer: 1, guardian: 1, hunter: 1, cupid: 1, witch: 1, traitor: 1, villager: 5 };
  } else if (count === 15) {
    return { werewolf: 4, seer: 1, guardian: 1, hunter: 1, cupid: 1, witch: 1, villager: 6 };
  } else if (count === 16) {
    return { werewolf: 4, seer: 1, guardian: 1, hunter: 1, cupid: 1, witch: 1, elder: 1, villager: 6 };
  } else if (count <= 18) {
    return { werewolf: 4, seer: 1, guardian: 1, hunter: 1, cupid: 1, witch: 1, elder: 1, villager: count - 10 };
  } else {
    return { werewolf: 5, seer: 1, guardian: 1, hunter: 1, cupid: 1, witch: 1, elder: 1, villager: count - 11 };
  }
}

function applyOptions(base, count, options) {
  const result = { ...base };
  const optionalRoles = ["cupid", "witch", "elder", "flute_player", "thief", "traitor", "cursed_wolf", "wild_child"];
  for (const role of optionalRoles) {
    if (options[role] === true && !result[role]) {
      result[role] = 1;
      // remove 1 villager to compensate
      if (result.villager > 1) result.villager--;
    } else if (options[role] === false && result[role]) {
      result.villager = (result.villager || 0) + result[role];
      delete result[role];
    }
  }
  return result;
}

export function buildRoleList(preset) {
  const list = [];
  for (const [role, count] of Object.entries(preset)) {
    if (count > 0) {
      for (let i = 0; i < count; i++) list.push(role);
    }
  }
  return list;
}

// ============================================================
// NIGHT STEPS FOR ROUND
// ============================================================

export function getNightStepsForRound(round, presentRoles) {
  // presentRoles: set of role strings actually in the game
  const steps = [];
  if (round === 1 && presentRoles.has("cupid")) steps.push("cupid");
  if (round === 1 && presentRoles.has("thief")) steps.push("thief");
  if (round === 1 && presentRoles.has("wild_child")) steps.push("wild_child");
  if (presentRoles.has("guardian")) steps.push("guardian");
  steps.push("werewolf");
  // Sói Nguyền: từ đêm thứ 2 trở đi, MỌI đêm (không chỉ đêm chẵn)
  if (presentRoles.has("cursed_wolf") && round >= 2) steps.push("cursed_wolf");
  if (presentRoles.has("seer")) steps.push("seer");
  if (presentRoles.has("witch")) steps.push("witch");
  if (presentRoles.has("flute_player")) steps.push("flute_player");
  return steps;
}

export function getNextNightStep(currentStep, round, presentRoles) {
  const steps = getNightStepsForRound(round, presentRoles);
  const idx = steps.indexOf(currentStep);
  if (idx === -1 || idx === steps.length - 1) return null;
  return steps[idx + 1];
}

export function getPresentRoles(playersMap) {
  const roles = new Set();
  Object.values(playersMap).forEach((p) => {
    if (p.role) roles.add(p.role);
  });
  return roles;
}

// ============================================================
// SHUFFLE
// ============================================================

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============================================================
// ASSIGN ROLES
// ============================================================

export function assignRoles(playersMap, roleList) {
  const ids = Object.keys(playersMap);
  if (ids.length !== roleList.length) {
    throw new Error(`Số người chơi (${ids.length}) không khớp với số vai trò (${roleList.length})`);
  }
  const roles = shuffle(roleList);
  const result = {};
  ids.forEach((id, idx) => {
    result[id] = {
      ...playersMap[id],
      role: roles[idx],
      originalRole: roles[idx], // giữ vai trò gốc để reveal cuối game, KHÔNG đổi theo biến đổi
      alive: true,
      isLover: false,
    };
    // Elder gets extra lives
    if (roles[idx] === "elder") {
      result[id].elderLives = 2;
    }
  });
  return result;
}

// ============================================================
// NIGHT STATE
// ============================================================

export function emptyNightState(round) {
  return {
    round,
    cupid: { done: false, lovers: [], confirmed: false },
    thief: { done: false, chosenRole: null, confirmed: false },
    wild_child: { done: false, adoptParentId: null, confirmed: false },
    guardian: { done: false, protect: null, confirmed: false },
    werewolf: { done: false, target: null, votes: {}, confirmedBy: {} },
    // Sói Nguyền KHÔNG còn chọn nạn nhân riêng — chỉ quyết định có "nguyền"
    // (biến thành Sói) đúng cái mục tiêu mà đàn Sói đã vote chết hay không.
    cursed_wolf: { done: false, curse: false, confirmed: false },
    seer: { done: false, target: null, result: null, confirmed: false },
    witch: { done: false, save: false, poisonTarget: null, confirmed: false },
    flute_player: { done: false, targets: [], confirmed: false },
  };
}

export function emptyWitchUsage() {
  return { healUsed: false, poisonUsed: false };
}

// ============================================================
// PLAYERS HELPERS
// ============================================================

export function getAlivePlayers(playersMap) {
  return Object.entries(playersMap)
    .filter(([, p]) => p.alive !== false)
    .map(([id, p]) => ({ id, ...p }));
}

export function applyCupid(playersMap, loverIds) {
  const updated = { ...playersMap };
  loverIds.forEach((id) => {
    updated[id] = { ...updated[id], isLover: true };
  });
  return updated;
}

export function applyThief(playersMap, thiefId, chosenRole) {
  const updated = { ...playersMap };
  if (thiefId && chosenRole) {
    updated[thiefId] = { ...updated[thiefId], role: chosenRole };
  }
  return updated;
}

// Con Hoang: chọn mẹ nuôi. Đây là trạng thái RIÊNG (adoptParentId), không
// phải role — y hệt cách Cupid lưu isLover/loverPartnerId riêng với role,
// để khi role biến đổi (vd: bị Sói Nguyền) thì liên kết Cupid/Con Hoang vẫn còn.
export function applyWildChildAdopt(playersMap, childId, parentId) {
  const updated = { ...playersMap };
  if (childId && parentId) {
    updated[childId] = { ...updated[childId], adoptParentId: parentId };
  }
  return updated;
}

// Kiểm tra & áp dụng biến đổi Con Hoang → Sói khi mẹ nuôi đã chết.
// Hàm thuần, an toàn gọi lại nhiều lần (idempotent).
export function checkWildChildTransform(playersMap) {
  const updated = JSON.parse(JSON.stringify(playersMap));
  const transforms = [];
  Object.entries(updated).forEach(([id, p]) => {
    if (p.role === "wild_child" && p.alive !== false && p.adoptParentId) {
      const parent = updated[p.adoptParentId];
      if (!parent || parent.alive === false) {
        updated[id].role = "werewolf";
        transforms.push({ id, name: p.name });
      }
    }
  });
  return { updatedPlayers: updated, transforms };
}

// Luật Bảo Vệ: không được bảo vệ cùng 1 người 2 đêm liên tiếp.
// targetId === null/undefined (bỏ qua) luôn hợp lệ.
export function isValidGuardianTarget(targetId, lastProtectedId) {
  if (!targetId) return true;
  return targetId !== lastProtectedId;
}

// Tổng hợp vote của đàn Sói thành 1 mục tiêu duy nhất.
// Luật: phải có ĐA SỐ TUYỆT ĐỐI (>50% số phiếu đã bỏ) mới có người chết.
// Hòa phiếu cao nhất, hoặc không ai đạt đa số tuyệt đối → không ai chết đêm đó.
// Sói được phép vote cho bất kỳ ai còn sống, kể cả đồng đội Sói (chiến thuật).
export function resolveWolfVote(votes) {
  const tally = {};
  Object.values(votes || {}).forEach((tid) => {
    if (tid) tally[tid] = (tally[tid] || 0) + 1;
  });
  const entries = Object.entries(tally);
  const totalVotes = entries.reduce((sum, [, c]) => sum + c, 0);
  if (entries.length === 0 || totalVotes === 0) {
    return { target: null, tally, hasMajority: false };
  }
  const maxVotes = Math.max(...entries.map(([, c]) => c));
  const topCandidates = entries.filter(([, c]) => c === maxVotes);
  if (topCandidates.length > 1) {
    return { target: null, tally, hasMajority: false }; // hòa phiếu cao nhất
  }
  const [topId, topCount] = topCandidates[0];
  if (topCount * 2 <= totalVotes) {
    return { target: null, tally, hasMajority: false }; // không đạt đa số tuyệt đối
  }
  return { target: topId, tally, hasMajority: true };
}

// ============================================================
// RESOLVE NIGHT
// ============================================================

export function resolveNight(playersMap, nightState) {
  let updated = JSON.parse(JSON.stringify(playersMap));
  const deaths = [];
  const transforms = []; // Sói Nguyền: người bị biến thành Sói thay vì chết

  const wolfTarget = nightState.werewolf?.target || null;
  const guardTarget = nightState.guardian?.protect || null;
  const witchSaved = nightState.witch?.save === true;
  const poisonTarget = nightState.witch?.poisonTarget || null;
  const cursedChoice = nightState.cursed_wolf?.curse === true;

  // 1. Wolf target
  if (wolfTarget && updated[wolfTarget] && updated[wolfTarget].alive) {
    if (cursedChoice) {
      // Sói Nguyền chọn biến CHÍNH mục tiêu bị đàn Sói vote chết thành Sói,
      // thay vì giết. KHÔNG bị chặn bởi Bảo Vệ / Phù Thủy / Già Làng.
      // (Không thể "cắn A chết rồi nguyền B" — chỉ có 1 mục tiêu duy nhất.)
      updated[wolfTarget].role = "werewolf";
      transforms.push({ id: wolfTarget, name: updated[wolfTarget].name });
    } else {
      const protectedByGuardian = guardTarget === wolfTarget;
      const savedByWitch = witchSaved;

      if (!protectedByGuardian && !savedByWitch) {
        // Elder special: 2 lives
        if (updated[wolfTarget].role === "elder" && updated[wolfTarget].elderLives > 1) {
          updated[wolfTarget].elderLives = 1; // first bite
        } else {
          updated[wolfTarget].alive = false;
          updated[wolfTarget].deathCause = "werewolf";
          deaths.push({ id: wolfTarget, name: updated[wolfTarget].name, cause: "werewolf" });
        }
      }
    }
  }

  // 2. Poison
  if (poisonTarget && updated[poisonTarget] && updated[poisonTarget].alive) {
    // Poison + wolf on elder in same night = death regardless
    updated[poisonTarget].alive = false;
    updated[poisonTarget].deathCause = "poison";
    deaths.push({ id: poisonTarget, name: updated[poisonTarget].name, cause: "poison" });
  }

  // 3. Lovers chain
  updated = applyLoverChain(updated, deaths);

  return { updatedPlayers: updated, deaths, transforms };
}

function applyLoverChain(updated, deaths) {
  let changed = true;
  while (changed) {
    changed = false;
    const lovers = Object.entries(updated).filter(([, p]) => p.isLover);
    if (lovers.length === 2) {
      const [[idA, pA], [idB, pB]] = lovers;
      if (!pA.alive && pB.alive) {
        updated[idB].alive = false;
        updated[idB].deathCause = "lover";
        deaths.push({ id: idB, name: pB.name, cause: "lover" });
        changed = true;
      } else if (!pB.alive && pA.alive) {
        updated[idA].alive = false;
        updated[idA].deathCause = "lover";
        deaths.push({ id: idA, name: pA.name, cause: "lover" });
        changed = true;
      }
    }
  }
  return updated;
}

// ============================================================
// SEER
// ============================================================

export function resolveSeer(playersMap, targetId) {
  const target = playersMap[targetId];
  if (!target) return null;
  return {
    targetId,
    targetName: target.name,
    isWerewolf: target.role === ROLES.WEREWOLF || target.role === ROLES.CURSED_WOLF || target.role === ROLES.TRAITOR,
  };
}

// ============================================================
// DAY VOTE
// ============================================================

export function resolveDayVote(votes) {
  const tally = {};
  Object.values(votes).forEach((targetId) => {
    if (!targetId) return;
    tally[targetId] = (tally[targetId] || 0) + 1;
  });

  const entries = Object.entries(tally);
  if (entries.length === 0) return { eliminatedId: null, isTie: false, tally };

  const maxVotes = Math.max(...entries.map(([, c]) => c));
  const topCandidates = entries.filter(([, c]) => c === maxVotes).map(([id]) => id);

  if (topCandidates.length > 1) return { eliminatedId: null, isTie: true, tally };
  return { eliminatedId: topCandidates[0], isTie: false, tally };
}

export function applyDayVoteResult(playersMap, eliminatedId) {
  const updated = JSON.parse(JSON.stringify(playersMap));
  const deaths = [];

  if (eliminatedId && updated[eliminatedId] && updated[eliminatedId].alive) {
    updated[eliminatedId].alive = false;
    updated[eliminatedId].deathCause = "vote";
    deaths.push({ id: eliminatedId, name: updated[eliminatedId].name, cause: "vote" });
  }

  applyLoverChain(updated, deaths);
  return { updatedPlayers: updated, deaths };
}

// Hunter: when dies, pulls 1 person with them
export function applyHunterKill(playersMap, hunterId, targetId) {
  const updated = JSON.parse(JSON.stringify(playersMap));
  const deaths = [];
  if (targetId && updated[targetId] && updated[targetId].alive) {
    updated[targetId].alive = false;
    updated[targetId].deathCause = "hunter";
    deaths.push({ id: targetId, name: updated[targetId].name, cause: "hunter" });
    applyLoverChain(updated, deaths);
  }
  return { updatedPlayers: updated, deaths };
}

// ============================================================
// WIN CONDITION
// ============================================================

export function checkWinCondition(playersMap) {
  const alive = getAlivePlayers(playersMap);
  const aliveWolves = alive.filter((p) => p.role === "werewolf" || p.role === "cursed_wolf");
  const aliveVillagers = alive.filter((p) => p.role !== "werewolf" && p.role !== "cursed_wolf");

  // Flute player wins when all alive players are charmed
  const aliveFlutePlayer = alive.find((p) => p.role === "flute_player");
  if (aliveFlutePlayer) {
    const allCharmed = alive.filter((p) => p.id !== aliveFlutePlayer.id).every((p) => p.isCharmed);
    if (allCharmed && alive.length > 1) return "flute_player";
  }

  // Lovers win: only 2 alive and both are lovers — bất kể role hiện tại của họ là gì
  // (vd: 1 người bị Sói Nguyền hóa Sói, người kia vẫn Dân Làng — vẫn thắng theo Cặp Đôi)
  if (alive.length === 2 && alive.every((p) => p.isLover)) return "lovers";

  if (aliveWolves.length === 0) return "village";
  if (aliveWolves.length >= aliveVillagers.length) return "werewolf";

  return null;
}

// ============================================================
// LOG HELPER (log công khai / log admin dạng text — giữ nguyên như v2.0)
// ============================================================

export function makeLogEntry(round, phase, text, type = "info") {
  return { round, phase, text, type, time: Date.now() };
}

export const DEATH_CAUSE_LABEL_VI = {
  werewolf: "Bị sói cắn 🐺",
  poison: "Bị phù thủy đầu độc ☠️",
  lover: "Chết theo người yêu 💔",
  vote: "Bị dân làng treo cổ 🪢",
  hunter: "Bị Thợ Săn kéo theo 🏹",
};

export const WIN_LABEL_VI = {
  werewolf: "MA SÓI THẮNG!",
  village: "DÂN LÀNG THẮNG!",
  lovers: "CẶP ĐÔI THẮNG!",
  flute_player: "THỔI SÁO THẮNG!",
};

export const ROLE_TEAM_LABEL_VI = {
  wolf: "Phe Sói 🐺",
  village: "Phe Dân 👥",
  third: "Phe Thứ 3 🟣",
};

// ============================================================
// SECRET LOG (v3.0) — lịch sử bí mật có cấu trúc:
// { round, phase, event, actor, target, result, time }
// Dùng cho: (1) bảng "Lịch sử bí mật" realtime của Admin,
//           (2) "Toàn bộ lịch sử trận đấu" mở khóa cho Player khi game kết thúc.
// Player KHÔNG đọc field này khi game đang chạy (UI tự khóa theo phase).
// ============================================================

export function makeSecretEntry(round, phase, event, actor, target, result) {
  return { round, phase, event, actor: actor || null, target: target || null, result: result || null, time: Date.now() };
}

export const SECRET_EVENT_LABEL_VI = {
  cupid_pair: "💘 Cupid ghép cặp",
  thief_swap: "🃏 Ăn Trộm đổi vai",
  wild_child_adopt: "👩 Con Hoang chọn mẹ nuôi",
  wild_child_transform: "🌀 Con Hoang hóa Sói",
  guardian_protect: "🛡️ Bảo Vệ chọn bảo vệ",
  wolf_target: "🐺 Sói chọn nạn nhân",
  cursed_wolf_curse: "🌀 Sói Nguyền nguyền",
  seer_check: "🔮 Tiên Tri soi",
  witch_save: "🧪 Phù Thủy cứu",
  witch_poison: "☠️ Phù Thủy đầu độc",
  flute_charm: "🎶 Thổi Sáo ru ngủ",
  hunter_pull: "🏹 Thợ Săn kéo theo",
  vote_result: "🗳️ Kết quả vote",
  death: "💀 Tử vong",
  role_transform: "🌀 Biến đổi vai trò",
};

export function formatSecretEntry(e) {
  const label = SECRET_EVENT_LABEL_VI[e.event] || e.event;
  let line = label;
  if (e.actor) line += ` — ${e.actor}`;
  if (e.target) line += ` → ${e.target}`;
  if (e.result) line += ` (${e.result})`;
  return line;
}

// Gom secretLog theo (round, phase) để hiển thị dạng timeline.
// Trả về danh sách [{round, phase, entries: [...]}] theo thứ tự xuất hiện sớm nhất trước
// (đêm 1, ngày 1, đêm 2, ngày 2, ...). Phía hiển thị có thể .slice().reverse() nếu cần mới-nhất-trước.
export function groupSecretLog(secretLog) {
  const order = [];
  const groups = {};
  (secretLog || []).forEach((e) => {
    const key = `${e.round}_${e.phase}`;
    if (!groups[key]) {
      groups[key] = { round: e.round, phase: e.phase, entries: [] };
      order.push(key);
    }
    groups[key].entries.push(e);
  });
  return order.map((k) => groups[k]);
}

// ============================================================
// UI ASSETS (v UI-Phase-1/2) — CHỈ DATA HIỂN THỊ, KHÔNG PHẢI LOGIC GAME.
// ============================================================
// Đường dẫn icon từng role, dùng chung cho admin.js & player.js để không
// bị lệch tên file giữa 2 nơi. Đặt ở đây vì cùng triết lý với ROLE_LABEL_VI:
// 1 nguồn duy nhất, không phụ thuộc DOM/Firebase.
export const ROLE_ICON_PATH = {
  werewolf: "assets/roles/werewolf.png",
  seer: "assets/roles/seer.png",
  witch: "assets/roles/witch.png",
  guardian: "assets/roles/guardian.png",
  cupid: "assets/roles/cupid.png",
  villager: "assets/roles/villager.png",
  hunter: "assets/roles/hunter.png",
  elder: "assets/roles/elder.png",
  flute_player: "assets/roles/flute_player.png",
  thief: "assets/roles/thief.png",
  traitor: "assets/roles/traitor.png",
  cursed_wolf: "assets/roles/cursed_wolf.png",
  wild_child: "assets/roles/wild_child.png",
};

// Emoji thay thế khi CHƯA có ảnh role tương ứng — dùng làm fallback DUY NHẤT
// (không hiển thị cùng lúc với ảnh, tránh lặp icon).
export const ROLE_EMOJI_FALLBACK = {
  werewolf: "🐺",
  seer: "🔮",
  witch: "🧪",
  guardian: "🛡️",
  cupid: "💘",
  villager: "👤",
  hunter: "🏹",
  elder: "👴",
  flute_player: "🎶",
  thief: "🃏",
  traitor: "🕵️",
  cursed_wolf: "🌀",
  wild_child: "👩",
};

export const PHASE_ICON_PATH = {
  lobby: "assets/ui/icon-lobby.png",
  night: "assets/ui/icon-night.png",
  day: "assets/ui/icon-day.png",
  ended: "assets/ui/icon-ended.png",
};
export const PHASE_EMOJI_FALLBACK = {
  lobby: "🛋️",
  night: "🌙",
  day: "☀️",
  ended: "🏁",
};

export const WIN_ICON_PATH = {
  werewolf: "assets/ui/victory-werewolf.png",
  village: "assets/ui/victory-village.png",
  lovers: "assets/ui/victory-lovers.png",
  flute_player: "assets/ui/victory-flute.png",
};
export const WIN_EMOJI_FALLBACK = {
  werewolf: "🐺",
  village: "🏠",
  lovers: "💞",
  flute_player: "🎶",
};

// Helper nội bộ: HTML 1 icon "ảnh ưu tiên, lỗi/chưa có thì tự thay bằng
// emoji fallback" — emoji KHÔNG hiển thị cùng lúc với ảnh, nên không bao
// giờ bị lặp icon (đây chính là bug đã sửa ở UI Phase 2).
function iconWithFallback(path, emoji, sizePx, cssClass) {
  if (!path) return emoji || "";
  const fallbackSpan = emoji
    ? `<span class="icon-fallback" style="font-size:${Math.round(sizePx * 0.85)}px; display:none;">${emoji}</span>`
    : "";
  return `<span class="icon-wrap">` +
    `<img src="${path}" class="${cssClass}" style="width:${sizePx}px;height:${sizePx}px" alt=""` +
    ` onerror="this.style.display='none'; this.nextElementSibling && (this.nextElementSibling.style.display='inline');" />` +
    fallbackSpan +
    `</span>`;
}

// Icon 1 role — ảnh assets/roles/<role>.png, lỗi/chưa có thì tự dùng emoji
// tương ứng. alt="" vì icon chỉ trang trí, tên role đã có chữ riêng cạnh nó.
export function roleIconHtml(role, sizePx = 22) {
  return iconWithFallback(ROLE_ICON_PATH[role], ROLE_EMOJI_FALLBACK[role], sizePx, "role-icon");
}

// Icon phase — ảnh assets/ui/icon-<phase>.png, lỗi/chưa có thì tự dùng
// emoji tương ứng. KHÔNG còn nhúng thêm emoji trong text phase ở nơi khác
// để tránh lặp icon (vd: "🌙 🌙 ĐÊM 1").
export function phaseIconHtml(phase, sizePx = 28) {
  return iconWithFallback(PHASE_ICON_PATH[phase], PHASE_EMOJI_FALLBACK[phase], sizePx, "phase-icon");
}

// Icon lớn cho màn thắng/thua — ảnh assets/ui/victory-<winner>.png, lỗi/
// chưa có thì tự dùng emoji tương ứng. WIN_LABEL_VI không còn nhúng emoji
// riêng (xem định nghĩa phía trên) để icon này là nguồn icon DUY NHẤT.
export function winIconHtml(winner, sizePx = 64) {
  return iconWithFallback(WIN_ICON_PATH[winner], WIN_EMOJI_FALLBACK[winner], sizePx, "win-icon");
}

// Avatar tròn theo chữ cái đầu tên — không cần ảnh per-player (chưa có cơ
// chế upload avatar riêng từng người), nhưng vẫn nhận 1 ảnh avatar mặc định
// chung (assets/ui/default-avatar.png) nếu bạn muốn dùng ảnh thay chữ cái.
export function avatarHtml(name, sizePx = 36) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return `
    <span class="avatar-circle" style="width:${sizePx}px;height:${sizePx}px;line-height:${sizePx}px;font-size:${Math.round(sizePx * 0.45)}px">
      <img src="assets/ui/default-avatar.png" class="avatar-img" onerror="this.remove()" alt="" />
      <span class="avatar-initial">${initial}</span>
    </span>
  `;
}
