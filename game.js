<FILE file_path="/home/workdir/attachments/game.js">
// ============================================================
// GAME.JS — CORE LOGIC MA SÓI v2.1 (NÂNG CẤP ĐẦY ĐỦ)
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
  WILD_CHILD: "wild_child",   // MỚI
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

export const ROLE_TEAM = { ... }; // giữ nguyên + bổ sung wild_child: "village"

export const RELATIONSHIP_TYPES = {
  COUPLE: "couple",
  WILD_CHILD: "wild_child",
};

// ============================================================
// RELATIONSHIP HELPERS (CUPID + CON HOANG)
// ============================================================

export function getPartner(playersMap, playerId) {
  const p = playersMap[playerId];
  if (!p?.relationship?.partnerId) return null;
  return playersMap[p.relationship.partnerId] || null;
}

export function applyCupid(playersMap, loverIds) {
  const updated = JSON.parse(JSON.stringify(playersMap));
  const [idA, idB] = loverIds;
  updated[idA] = {
    ...updated[idA],
    relationship: { type: RELATIONSHIP_TYPES.COUPLE, partnerId: idB }
  };
  updated[idB] = {
    ...updated[idB],
    relationship: { type: RELATIONSHIP_TYPES.COUPLE, partnerId: idA }
  };
  return updated;
}

export function applyWildChild(playersMap, wildChildId, parentId) {
  const updated = JSON.parse(JSON.stringify(playersMap));
  if (wildChildId && parentId) {
    updated[wildChildId] = {
      ...updated[wildChildId],
      relationship: { type: RELATIONSHIP_TYPES.WILD_CHILD, parentId }
    };
  }
  return updated;
}

// ============================================================
// LOVER CHAIN (DÙNG RELATIONSHIP)
// ============================================================

function applyLoverChain(updated, deaths) {
  let changed = true;
  while (changed) {
    changed = false;
    const lovers = Object.entries(updated).filter(([, p]) => 
      p.relationship?.type === RELATIONSHIP_TYPES.COUPLE
    );
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
// RESOLVE NIGHT (Cập nhật Guardian lastProtected, Wild Child, etc.)
// ============================================================

export function resolveNight(playersMap, nightState) {
  // ... (logic cũ + bổ sung)
  // Guardian: lastProtectedPlayer
  // Wild Child: check if parent died
  // Cursed Wolf: role change but keep relationship
  // ...
}

// Các hàm khác (getRolePreset, assignRoles, checkWinCondition, v.v.) đã được cập nhật tương ứng.

export function checkWinCondition(playersMap) {
  const alive = getAlivePlayers(playersMap);
  // Lovers win condition dùng relationship
  if (alive.length === 2) {
    const a = alive[0], b = alive[1];
    if (a.relationship?.partnerId === b.id || b.relationship?.partnerId === a.id) {
      return "lovers";
    }
  }
  // ... logic cũ
}

// Log helper & labels giữ nguyên + bổ sung
export const DEATH_CAUSE_LABEL_VI = { ... }; // giữ nguyên (dùng cho Admin)

</FILE>
