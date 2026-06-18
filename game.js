// ============================================================
// GAME.JS — CORE LOGIC MA SÓI (LAYER "BỘ NÃO") v2.0
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
};

// Thứ tự hành động đêm đầy đủ
export const NIGHT_STEPS_FULL = ["cupid", "thief", "guardian", "werewolf", "cursed_wolf", "seer", "witch", "flute_player"];

// ============================================================
// ROLE PRESETS by player count
// ============================================================

export function getRolePreset(count, options = {}) {
  // options: { cupid, witch, elder, flute_player, thief, traitor, cursed_wolf }
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
  const optionalRoles = ["cupid", "witch", "elder", "flute_player", "thief", "traitor", "cursed_wolf"];
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
  if (presentRoles.has("guardian")) steps.push("guardian");
  steps.push("werewolf");
  if (presentRoles.has("cursed_wolf") && round % 2 === 0) steps.push("cursed_wolf");
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
    cupid: { done: false, lovers: [] },
    thief: { done: false, chosenRole: null },
    guardian: { done: false, protect: null },
    werewolf: { done: false, target: null },
    cursed_wolf: { done: false, target: null },
    seer: { done: false, target: null, result: null },
    witch: { done: false, save: false, poisonTarget: null },
    flute_player: { done: false, targets: [] },
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

// ============================================================
// RESOLVE NIGHT
// ============================================================

export function resolveNight(playersMap, nightState) {
  let updated = JSON.parse(JSON.stringify(playersMap));
  const deaths = [];

  const wolfTarget = nightState.werewolf?.target || null;
  const guardTarget = nightState.guardian?.protect || null;
  const witchSaved = nightState.witch?.save === true;
  const poisonTarget = nightState.witch?.poisonTarget || null;

  // 1. Wolf target
  if (wolfTarget && updated[wolfTarget]) {
    const protectedByGuardian = guardTarget === wolfTarget;
    const savedByWitch = witchSaved;

    if (!protectedByGuardian && !savedByWitch) {
      if (updated[wolfTarget].alive) {
        // Elder special: 2 lives
        if (updated[wolfTarget].role === "elder" && updated[wolfTarget].elderLives > 1) {
          updated[wolfTarget].elderLives = 1; // first bite
        } else {
          updated[wolfTarget].alive = false;
          deaths.push({ id: wolfTarget, name: updated[wolfTarget].name, cause: "werewolf" });
        }
      }
    }
  }

  // 2. Poison
  if (poisonTarget && updated[poisonTarget] && updated[poisonTarget].alive) {
    // Poison + wolf on elder in same night = death regardless
    if (updated[poisonTarget].role === "elder") {
      updated[poisonTarget].alive = false;
      deaths.push({ id: poisonTarget, name: updated[poisonTarget].name, cause: "poison" });
    } else {
      updated[poisonTarget].alive = false;
      deaths.push({ id: poisonTarget, name: updated[poisonTarget].name, cause: "poison" });
    }
  }

  // 3. Cursed wolf: turn someone into werewolf (no death, just role change)
  const curseTarget = nightState.cursed_wolf?.target || null;
  if (curseTarget && updated[curseTarget] && updated[curseTarget].alive) {
    updated[curseTarget].role = "werewolf";
  }

  // 4. Lovers chain
  updated = applyLoverChain(updated, deaths);

  return { updatedPlayers: updated, deaths };
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
        deaths.push({ id: idB, name: pB.name, cause: "lover" });
        changed = true;
      } else if (!pB.alive && pA.alive) {
        updated[idA].alive = false;
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

  // Lovers win: only 2 alive and both are lovers
  if (alive.length === 2 && alive.every((p) => p.isLover)) return "lovers";

  if (aliveWolves.length === 0) return "village";
  if (aliveWolves.length >= aliveVillagers.length) return "werewolf";

  return null;
}

// ============================================================
// LOG HELPER
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
  werewolf: "🐺 MA SÓI THẮNG!",
  village: "🏡 DÂN LÀNG THẮNG!",
  lovers: "💞 CẶP ĐÔI THẮNG!",
  flute_player: "🎶 THỔI SÁO THẮNG!",
};

export const ROLE_TEAM_LABEL_VI = {
  wolf: "Phe Sói 🐺",
  village: "Phe Dân 👥",
  third: "Phe Thứ 3 🟣",
};
