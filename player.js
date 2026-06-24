// ============================================================
// PLAYER.JS — GIAO DIỆN NGƯỜI CHƠI v4.0
// ============================================================
// v3.0: hiển thị vai trò người yêu, ẩn nguyên nhân chết, chặn chat khi
// chết, UI tự bấm hành động đêm cơ bản, UI Thợ Săn, Reveal cuối game.
// v4.0:
//  - Mỗi vai trò có thể "Bỏ qua" (Sói/Phù Thủy/Tiên Tri/Bảo Vệ) — Cupid
//    vẫn bắt buộc ghép đôi.
//  - Bấm lại đúng lựa chọn đang chọn → hủy chọn (trước khi Xác nhận).
//  - Xác nhận xong → KHÓA hoàn toàn, không thể đổi/thu hồi.
//  - Sói được vote bất kỳ ai còn sống, kể cả đồng đội Sói.
//  - Sói Nguyền: chỉ quyết định có biến đúng mục tiêu đàn Sói vừa chốt
//    thành Sói hay không (không tự chọn nạn nhân riêng).
//  - Thợ Săn LUÔN tự chọn người kéo theo ngay trên điện thoại (không cần
//    đợi Admin) — chỉ thấy màn "YOU ARE DEAD" SAU KHI đã thực hiện xong.
//  - Hiển thị "Đồng đội Sói" (kèm dấu hiệu nếu vừa bị hóa Sói).
//  - Hiển thị số phiếu đang nhận của chính mình vào ban ngày.
//  - Đồng hồ đêm (ở Player Action Mode) — hết giờ tự xử lý theo lựa
//    chọn hiện tại.
//  - Chat riêng với Admin (hỏi luật / báo lỗi / cần hỗ trợ).
//  - Lý do chết do VOTE hiển thị rõ ("Bạn bị dân làng treo cổ"); các lý
//    do bí mật khác (sói cắn/độc/cupid) vẫn ẩn như cũ.
// ============================================================

// v UI-Phase-2 (chỉ UI/UX/animation/audio — KHÔNG đổi gameplay):
//  - Sửa bug: cả 2 class "night"/"day" cùng tồn tại trên <body> → giờ
//    luôn remove cả 2 trước rồi add đúng 1.
//  - Sửa bug: icon lặp đôi ở phase banner (emoji cũ còn nằm trong text
//    trong khi đã thêm ảnh icon mới) → bỏ emoji khỏi text, icon hiển thị
//    DUY NHẤT qua roleIconHtml/phaseIconHtml/winIconHtml (ảnh, tự fallback
//    emoji nếu chưa có ảnh — không bao giờ hiện cả 2 cùng lúc).
//  - Reveal Role Cinematic khi vai trò được chia (1 lần/trận).
//  - PhaseTransition: màn chuyển cảnh khi Đêm xuống / Bình minh.
//  - Victory screen: icon lớn + animation.
//  - Hiệu ứng khi có người vừa chết (đổi từ còn sống ở lần render trước).
//  - Audio: night/day/vote/death/victory — không autoplay, tự bỏ qua lỗi.
// ============================================================

import { db, doc, setDoc, getDoc, updateDoc, onSnapshot } from "./firebase.js";
import {
  ROLE_LABEL_VI, ROLE_TEAM, ROLE_TEAM_LABEL_VI, getAlivePlayers, WIN_LABEL_VI,
  groupSecretLog, formatSecretEntry, roleIconHtml, phaseIconHtml, avatarHtml, winIconHtml,
} from "./game.js";

let roomCode = null;
let myId = null;
let myName = null;
let roomRefDoc = null;
let currentRoom = null;
let unsubscribe = null;
// UI Phase 2 — chỉ phục vụ hiệu ứng/âm thanh, KHÔNG phải state game:
let lastPhaseForTransition = null; // phase lần render trước, để phát hiện CHUYỂN phase
let roleRevealShown = false;       // đã chiếu màn "Bạn là..." cho trận này chưa
let previousAlivePlayerIds = new Set(); // ai còn sống ở lần render trước (phát hiện vừa chết)
let victorySoundPlayed = false; // chỉ phát victory.mp3 đúng 1 lần khi game vừa kết thúc

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
// 3. CHAT (Sói / Cặp Đôi / Hỗ trợ Admin)
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

// Chat riêng với Admin — hoạt động MỌI lúc (kể cả khi đã chết / chưa
// được chia vai trò), vì mục đích là hỏi luật / báo lỗi / cần hỗ trợ.
async function sendSupportMessage(text) {
  if (!text.trim() || !currentRoom) return;
  const support = currentRoom.chat?.support || {};
  const thread = [...(support[myId] || [])];
  thread.push({ from: "player", name: myName, text: text.trim(), time: Date.now() });
  if (thread.length > 50) thread.splice(0, thread.length - 50);
  await updateDoc(roomRefDoc, { [`chat.support.${myId}`]: thread });
}

// ============================================================
// 3b. NIGHT ACTION — TỰ CHỌN, TỰ XÁC NHẬN, KHÓA SAU KHI XÁC NHẬN
// ============================================================
// Mọi lựa chọn được ghi trực tiếp vào nightState qua field-path update
// (giống cách castVote ghi vào dayVotes.{myId}). Khi người chơi bấm
// "Xác nhận", field `confirmed` (hoặc `confirmedBy.{myId}` với Sói) được
// đặt true — Admin (admin.js) sẽ tự động chốt bước này, không cần thêm
// hành động nào từ Admin.

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

const LOCK_NOTE = `⚠️ Bạn chỉ có thể xác nhận một lần. Sau khi xác nhận sẽ không thể thay đổi.`;

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
  let locked = false;

  if (step === "werewolf" && (me.role === "werewolf" || me.role === "cursed_wolf")) {
    canAct = true;
    const votes = ns.werewolf?.votes || {};
    const confirmedBy = ns.werewolf?.confirmedBy || {};
    locked = !!confirmedBy[myId];
    const myVote = votes[myId];
    // Sói được vote bất kỳ ai còn sống, KỂ CẢ đồng đội Sói (chiến thuật tạo niềm tin với dân)
    const targets = alive;
    html += `<h3>🐺 Chọn nạn nhân</h3>`;
    if (locked) {
      html += `<p>✅ Bạn đã xác nhận: <strong>${myVote ? players[myVote]?.name : "Bỏ qua (không giết ai)"}</strong></p>`;
      html += `<p class="note-disabled">Đã xác nhận xong. Không thể thay đổi.</p>`;
    } else {
      html += buildSelectButtonsHtml(targets, myVote, "wolf-target-btn");
      html += `<div class="action-row">
        <button class="btn-big btn-confirm" id="wolfConfirmBtn" ${!myVote ? "disabled" : ""}>✅ Xác nhận</button>
        <button class="btn-big btn-skip" id="wolfSkipBtn">⏭️ Bỏ qua (không giết ai)</button>
      </div>`;
      html += `<p class="note-disabled">${LOCK_NOTE}</p>`;
    }
    html += `<p class="note-disabled" style="margin-top:8px">Lựa chọn của các Sói (realtime):</p>`;
    const wolfTeam = alive.filter((p) => p.role === "werewolf" || p.role === "cursed_wolf");
    const rows = wolfTeam.map((w) =>
      `<div class="vote-row"><span>${w.name} ${confirmedBy[w.id] ? "✅" : "⏳"}</span><span>${votes[w.id] ? players[votes[w.id]]?.name : "(chưa chọn)"}</span></div>`
    ).join("");
    html += rows || `<p class="note-disabled">Chưa có Sói nào chọn.</p>`;
  } else if (step === "cursed_wolf" && me.role === "cursed_wolf") {
    canAct = true;
    const wolfTargetId = ns.werewolf?.target;
    const wolfTargetName = wolfTargetId ? players[wolfTargetId]?.name : null;
    const curse = !!ns.cursed_wolf?.curse;
    locked = !!ns.cursed_wolf?.confirmed;
    html += `<h3>🌀 Biến mục tiêu thành Sói?</h3>`;
    if (!wolfTargetId) {
      html += `<p class="note-disabled">Đàn Sói đêm nay không đạt đa số/hòa phiếu — không có mục tiêu để nguyền.</p>`;
      if (!locked) {
        html += `<button class="btn-big btn-confirm" id="curseConfirmBtn">➡️ Tiếp tục</button>`;
      } else {
        html += `<p class="note-disabled">✅ Đã xác nhận xong.</p>`;
      }
    } else if (locked) {
      html += `<p>✅ Bạn đã xác nhận: <strong>${curse ? `Biến ${wolfTargetName} thành Sói` : `Không, cứ để ${wolfTargetName} chết bình thường`}</strong></p>`;
      html += `<p class="note-disabled">Đã xác nhận xong. Không thể thay đổi.</p>`;
    } else {
      html += `<p>Mục tiêu của đàn Sói đêm nay: <strong>${wolfTargetName}</strong></p>`;
      html += `<div class="select-wrap">
        <button class="select-option curse-yes-btn ${curse ? "active" : ""}">🌀 Biến thành Sói</button>
        <button class="select-option curse-no-btn ${!curse ? "active" : ""}">❌ Không, cứ giết</button>
      </div>`;
      html += `<button class="btn-big btn-confirm" id="curseConfirmBtn">✅ Xác nhận</button>`;
      html += `<p class="note-disabled">${LOCK_NOTE}</p>`;
    }
  } else if (step === "seer" && me.role === "seer") {
    canAct = true;
    locked = !!ns.seer?.confirmed;
    const target = ns.seer?.target;
    html += `<h3>🔮 Soi 1 người</h3>`;
    if (locked) {
      html += `<p>✅ Bạn đã xác nhận: <strong>${target ? players[target]?.name : "Bỏ qua"}</strong></p><p class="note-disabled">Đã xác nhận xong. Không thể thay đổi.</p>`;
    } else {
      html += buildSelectButtonsHtml(alive.filter((p) => p.id !== myId), target, "seer-target-btn");
      html += `<div class="action-row">
        <button class="btn-big btn-confirm" id="seerConfirmBtn" ${!target ? "disabled" : ""}>✅ Xác nhận</button>
        <button class="btn-big btn-skip" id="seerSkipBtn">⏭️ Bỏ qua</button>
      </div>`;
      html += `<p class="note-disabled">${LOCK_NOTE}</p>`;
    }
  } else if (step === "guardian" && me.role === "guardian") {
    canAct = true;
    locked = !!ns.guardian?.confirmed;
    const target = ns.guardian?.protect;
    const lastProtect = currentRoom.guardianLastProtect;
    html += `<h3>🛡️ Chọn người bảo vệ</h3>`;
    if (locked) {
      html += `<p>✅ Bạn đã xác nhận: <strong>${target ? players[target]?.name : "Bỏ qua"}</strong></p><p class="note-disabled">Đã xác nhận xong. Không thể thay đổi.</p>`;
    } else {
      const targets = alive.filter((p) => p.id !== lastProtect);
      if (lastProtect && players[lastProtect]) html += `<p class="note-disabled">(${players[lastProtect].name} không thể chọn lại đêm này)</p>`;
      html += buildSelectButtonsHtml(targets, target, "guardian-target-btn");
      html += `<div class="action-row">
        <button class="btn-big btn-confirm" id="guardianConfirmBtn" ${!target ? "disabled" : ""}>✅ Xác nhận</button>
        <button class="btn-big btn-skip" id="guardianSkipBtn">⏭️ Bỏ qua</button>
      </div>`;
      html += `<p class="note-disabled">${LOCK_NOTE}</p>`;
    }
  } else if (step === "cupid" && me.role === "cupid" && round === 1) {
    canAct = true;
    locked = !!ns.cupid?.confirmed;
    const lovers = ns.cupid?.lovers || [];
    html += `<h3>💘 Chọn 2 người yêu nhau</h3>`;
    if (locked) {
      html += `<p>✅ Bạn đã xác nhận ghép: <strong>${lovers.map((id) => players[id]?.name).join(" 💞 ")}</strong></p><p class="note-disabled">Đã xác nhận xong. Không thể thay đổi.</p>`;
    } else {
      html += buildMultiSelectButtonsHtml(alive, lovers, "cupid-btn");
      html += `<button class="btn-big btn-confirm" id="cupidConfirmBtn" ${lovers.length !== 2 ? "disabled" : ""}>✅ Xác nhận ghép cặp</button>`;
      html += `<p class="note-disabled">💘 Cupid bắt buộc phải ghép đôi — không có lựa chọn bỏ qua.</p>`;
      html += `<p class="note-disabled">${LOCK_NOTE}</p>`;
    }
  } else if (step === "thief" && me.role === "thief" && round === 1) {
    canAct = true;
    locked = !!ns.thief?.confirmed;
    const options = currentRoom.thiefOptions || [];
    const chosen = ns.thief?.chosenRole;
    html += `<h3>🃏 Chọn 1 trong 2 vai trò</h3>`;
    if (locked) {
      html += `<p>✅ Bạn đã xác nhận: <strong>${chosen ? (ROLE_LABEL_VI[chosen] || chosen) : "Giữ nguyên vai Ăn Trộm"}</strong></p><p class="note-disabled">Đã xác nhận xong.</p>`;
    } else {
      html += `<div class="select-wrap">` + options.map((r, i) =>
        `<button class="select-option thief-opt-btn ${chosen === r ? "active" : ""}" data-role="${r}">${i + 1}. ${ROLE_LABEL_VI[r] || r}</button>`
      ).join("") + `</div>`;
      html += `<div class="action-row">
        <button class="btn-big btn-confirm" id="thiefConfirmBtn" ${!chosen ? "disabled" : ""}>✅ Xác nhận</button>
        <button class="btn-big btn-skip" id="thiefSkipBtn">⏭️ Giữ nguyên vai Ăn Trộm</button>
      </div>`;
      html += `<p class="note-disabled">${LOCK_NOTE}</p>`;
    }
  } else if (step === "witch" && me.role === "witch") {
    canAct = true;
    locked = !!ns.witch?.confirmed;
    const wolfTargetId = ns.werewolf?.target;
    const wolfTarget = wolfTargetId ? players[wolfTargetId] : null;
    const witchUsage = currentRoom.witchUsage || {};
    const save = !!ns.witch?.save;
    const poisonTarget = ns.witch?.poisonTarget;
    html += `<h3>🧪 Hành động Phù Thủy</h3>`;
    if (locked) {
      html += `<p>✅ Đã xác nhận: ${save ? "Đã CỨU" : "Không cứu"}; ${poisonTarget ? `Độc ${players[poisonTarget]?.name}` : "Không độc ai"}</p><p class="note-disabled">Đã xác nhận xong.</p>`;
    } else {
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
      html += `<div class="action-row">
        <button class="btn-big btn-confirm" id="witchConfirmBtn">✅ Xác nhận</button>
        <button class="btn-big btn-skip" id="witchSkipBtn">⏭️ Không làm gì cả</button>
      </div>`;
      html += `<p class="note-disabled">${LOCK_NOTE}</p>`;
    }
  } else if (step === "flute_player" && me.role === "flute_player") {
    canAct = true;
    locked = !!ns.flute_player?.confirmed;
    const targets = ns.flute_player?.targets || [];
    html += `<h3>🎶 Chọn 2 người để ru ngủ</h3>`;
    if (locked) {
      html += `<p>✅ Đã xác nhận ru ngủ: <strong>${targets.map((id) => players[id]?.name).join(", ") || "Không ai"}</strong></p><p class="note-disabled">Đã xác nhận xong.</p>`;
    } else {
      html += buildMultiSelectButtonsHtml(alive.filter((p) => p.id !== myId), targets, "flute-btn");
      html += `<div class="action-row">
        <button class="btn-big btn-confirm" id="fluteConfirmBtn" ${targets.length === 0 ? "disabled" : ""}>✅ Xác nhận</button>
        <button class="btn-big btn-skip" id="fluteSkipBtn">⏭️ Bỏ qua</button>
      </div>`;
      html += `<p class="note-disabled">${LOCK_NOTE}</p>`;
    }
  } else if (step === "wild_child" && me.role === "wild_child" && round === 1) {
    canAct = true;
    locked = !!ns.wild_child?.confirmed;
    const parentId = ns.wild_child?.adoptParentId;
    html += `<h3>👩 Chọn mẹ nuôi</h3>`;
    if (locked) {
      html += `<p>✅ Đã xác nhận mẹ nuôi: <strong>${parentId ? players[parentId]?.name : "?"}</strong></p><p class="note-disabled">Đã xác nhận xong.</p>`;
    } else {
      html += buildSelectButtonsHtml(alive.filter((p) => p.id !== myId), parentId, "wild-child-btn");
      html += `<button class="btn-big btn-confirm" id="wildChildConfirmBtn" ${!parentId ? "disabled" : ""}>✅ Xác nhận</button>`;
      html += `<p class="note-disabled">${LOCK_NOTE}</p>`;
    }
  }

  if (!canAct) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = html;
  if (!locked) bindNightActionPlayerEvents(step);
}

function bindNightActionPlayerEvents(step) {
  if (step === "werewolf") {
    $$(".wolf-target-btn").forEach((btn) => btn.onclick = () => {
      const cur = currentRoom.nightState?.werewolf?.votes?.[myId];
      setNightField(`nightState.werewolf.votes.${myId}`, cur === btn.dataset.id ? null : btn.dataset.id);
    });
    const confirmBtn = $("#wolfConfirmBtn");
    if (confirmBtn) confirmBtn.onclick = () => setNightField(`nightState.werewolf.confirmedBy.${myId}`, true);
    const skipBtn = $("#wolfSkipBtn");
    if (skipBtn) skipBtn.onclick = async () => {
      await setNightField(`nightState.werewolf.votes.${myId}`, null);
      await setNightField(`nightState.werewolf.confirmedBy.${myId}`, true);
    };
  } else if (step === "cursed_wolf") {
    const yesBtn = $(".curse-yes-btn");
    const noBtn = $(".curse-no-btn");
    if (yesBtn) yesBtn.onclick = () => setNightField("nightState.cursed_wolf.curse", true);
    if (noBtn) noBtn.onclick = () => setNightField("nightState.cursed_wolf.curse", false);
    const confirmBtn = $("#curseConfirmBtn");
    if (confirmBtn) confirmBtn.onclick = () => setNightField("nightState.cursed_wolf.confirmed", true);
  } else if (step === "seer") {
    $$(".seer-target-btn").forEach((btn) => btn.onclick = () => {
      const cur = currentRoom.nightState?.seer?.target;
      setNightField("nightState.seer.target", cur === btn.dataset.id ? null : btn.dataset.id);
    });
    const confirmBtn = $("#seerConfirmBtn");
    if (confirmBtn) confirmBtn.onclick = () => setNightField("nightState.seer.confirmed", true);
    const skipBtn = $("#seerSkipBtn");
    if (skipBtn) skipBtn.onclick = async () => {
      await setNightField("nightState.seer.target", null);
      await setNightField("nightState.seer.confirmed", true);
    };
  } else if (step === "guardian") {
    $$(".guardian-target-btn").forEach((btn) => btn.onclick = () => {
      const cur = currentRoom.nightState?.guardian?.protect;
      setNightField("nightState.guardian.protect", cur === btn.dataset.id ? null : btn.dataset.id);
    });
    const confirmBtn = $("#guardianConfirmBtn");
    if (confirmBtn) confirmBtn.onclick = () => setNightField("nightState.guardian.confirmed", true);
    const skipBtn = $("#guardianSkipBtn");
    if (skipBtn) skipBtn.onclick = async () => {
      await setNightField("nightState.guardian.protect", null);
      await setNightField("nightState.guardian.confirmed", true);
    };
  } else if (step === "cupid") {
    $$(".cupid-btn").forEach((btn) => btn.onclick = () => toggleMultiPending("cupid", "lovers", btn.dataset.id, 2));
    const confirmBtn = $("#cupidConfirmBtn");
    if (confirmBtn) confirmBtn.onclick = () => setNightField("nightState.cupid.confirmed", true);
  } else if (step === "thief") {
    $$(".thief-opt-btn").forEach((btn) => btn.onclick = () => {
      const cur = currentRoom.nightState?.thief?.chosenRole;
      setNightField("nightState.thief.chosenRole", cur === btn.dataset.role ? null : btn.dataset.role);
    });
    const confirmBtn = $("#thiefConfirmBtn");
    if (confirmBtn) confirmBtn.onclick = () => setNightField("nightState.thief.confirmed", true);
    const skipBtn = $("#thiefSkipBtn");
    if (skipBtn) skipBtn.onclick = async () => {
      await setNightField("nightState.thief.chosenRole", null);
      await setNightField("nightState.thief.confirmed", true);
    };
  } else if (step === "witch") {
    const saveBtn = $(".witch-save-btn");
    if (saveBtn) saveBtn.onclick = () => setNightField("nightState.witch.save", !saveBtn.classList.contains("active"));
    $$(".witch-poison-btn").forEach((btn) => btn.onclick = () => {
      const cur = currentRoom.nightState?.witch?.poisonTarget;
      setNightField("nightState.witch.poisonTarget", cur === btn.dataset.id ? null : btn.dataset.id);
    });
    const confirmBtn = $("#witchConfirmBtn");
    if (confirmBtn) confirmBtn.onclick = () => setNightField("nightState.witch.confirmed", true);
    const skipBtn = $("#witchSkipBtn");
    if (skipBtn) skipBtn.onclick = async () => {
      await setNightField("nightState.witch.save", false);
      await setNightField("nightState.witch.poisonTarget", null);
      await setNightField("nightState.witch.confirmed", true);
    };
  } else if (step === "flute_player") {
    $$(".flute-btn").forEach((btn) => btn.onclick = () => toggleMultiPending("flute_player", "targets", btn.dataset.id, 2));
    const confirmBtn = $("#fluteConfirmBtn");
    if (confirmBtn) confirmBtn.onclick = () => setNightField("nightState.flute_player.confirmed", true);
    const skipBtn = $("#fluteSkipBtn");
    if (skipBtn) skipBtn.onclick = async () => {
      await setNightField("nightState.flute_player.targets", []);
      await setNightField("nightState.flute_player.confirmed", true);
    };
  } else if (step === "wild_child") {
    $$(".wild-child-btn").forEach((btn) => btn.onclick = () => {
      const cur = currentRoom.nightState?.wild_child?.adoptParentId;
      setNightField("nightState.wild_child.adoptParentId", cur === btn.dataset.id ? null : btn.dataset.id);
    });
    const confirmBtn = $("#wildChildConfirmBtn");
    if (confirmBtn) confirmBtn.onclick = () => setNightField("nightState.wild_child.confirmed", true);
  }
}

// Thợ Săn LUÔN tự chọn người kéo theo ngay trên điện thoại (bất kể Admin
// đang ở chế độ nào) — không cần chờ Admin xử lý. Sau khi xác nhận, hệ
// thống (admin.js) tự động chốt; "YOU ARE DEAD" chỉ hiện SAU khi xong.
function renderHunterPullPlayer() {
  const el = $("#hunterPullPlayer");
  if (!el) return;
  const pending = currentRoom.hunterPending;
  if (!pending || pending.hunterId !== myId) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  if (pending.confirmed) {
    el.innerHTML = `<h3>🏹 Bạn là Thợ Săn</h3>
      <p>✅ Đã xác nhận: <strong>${pending.pendingTarget ? currentRoom.players[pending.pendingTarget]?.name : "Không kéo ai"}</strong></p>
      <p class="note-disabled">Đang xử lý...</p>`;
    return;
  }
  const alive = getAlivePlayers(currentRoom.players).filter((p) => p.id !== myId);
  const target = pending.pendingTarget;
  el.innerHTML = `<h3>🏹 Bạn là Thợ Săn. Chọn 1 người chết cùng bạn.</h3>` +
    buildSelectButtonsHtml(alive, target, "hunter-pull-btn") +
    `<div class="action-row">
      <button class="btn-big btn-confirm" id="hunterConfirmBtn" ${!target ? "disabled" : ""}>✅ Xác nhận</button>
      <button class="btn-big btn-skip" id="hunterSkipBtn">⏭️ Không kéo ai</button>
    </div>
    <p class="note-disabled">${LOCK_NOTE}</p>`;
  $$(".hunter-pull-btn").forEach((btn) => btn.onclick = () => {
    const cur = currentRoom.hunterPending?.pendingTarget;
    setNightField("hunterPending.pendingTarget", cur === btn.dataset.id ? null : btn.dataset.id);
  });
  const confirmBtn = $("#hunterConfirmBtn");
  if (confirmBtn) confirmBtn.onclick = () => setNightField("hunterPending.confirmed", true);
  const skipBtn = $("#hunterSkipBtn");
  if (skipBtn) skipBtn.onclick = async () => {
    await setNightField("hunterPending.pendingTarget", null);
    await setNightField("hunterPending.confirmed", true);
  };
}

// ============================================================
// 3c. AUDIO (UI Phase 2) — không autoplay ngoài ý người dùng, tự bỏ qua
// nếu thiếu file hoặc bị mobile chặn. Mirror đúng cơ chế đã có ở admin.js
// để 2 phía nhất quán, không chia sẻ qua game.js (game.js không đụng API
// trình duyệt như Audio()).
// ============================================================
const SOUNDS = {
  night: "assets/audio/night.mp3",
  day: "assets/audio/day.mp3",
  death: "assets/audio/death.mp3",
  victory: "assets/audio/victory.mp3",
};
function playSound(key) {
  try {
    const audio = new Audio(SOUNDS[key]);
    audio.volume = 0.6;
    audio.play().catch(() => {}); // thiếu file hoặc bị chặn autoplay → bỏ qua êm, không lỗi
  } catch (e) {}
}

// ============================================================
// 3d. PHASE TRANSITION (UI Phase 2) — màn chuyển cảnh "Đêm xuống" /
// "Bình minh" khi phase thực sự ĐỔI (không chiếu ở lần load đầu tiên).
// ============================================================
function handlePhaseTransition(phase) {
  if (lastPhaseForTransition === null) {
    // Lần đầu vào phòng — chỉ ghi nhận mốc, không chiếu hiệu ứng đột ngột
    lastPhaseForTransition = phase;
    return;
  }
  if (phase !== lastPhaseForTransition) {
    if (phase === "night") {
      showPhaseTransition("night", "ĐÊM XUỐNG", "Sói bắt đầu săn mồi...");
      playSound("night");
    } else if (phase === "day") {
      showPhaseTransition("day", "BÌNH MINH", "Một ngày mới bắt đầu...");
      playSound("day");
    }
    lastPhaseForTransition = phase;
  }
}
function showPhaseTransition(kind, title, sub) {
  const el = $("#phaseTransitionOverlay");
  if (!el) return;
  el.innerHTML = `
    <div class="phase-transition-content">
      <div class="phase-transition-icon">${phaseIconHtml(kind, 56)}</div>
      <h1>${title}</h1>
      <p>${sub}</p>
    </div>
  `;
  el.className = `phase-transition-overlay show ${kind}`;
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.className = "phase-transition-overlay";
  }, 2000);
}

// ============================================================
// 3e. REVEAL ROLE CINEMATIC (UI Phase 2) — chiếu đúng 1 lần khi vai trò
// vừa được chia (không chiếu lại ở các lần render sau trong cùng trận).
// ============================================================
function maybeShowRoleReveal(me) {
  const el = $("#roleRevealOverlay");
  if (!el) return;
  if (!me.role) {
    roleRevealShown = false; // chưa có role (lobby/đã reset) → sẵn sàng chiếu lại cho trận sau
    return;
  }
  if (roleRevealShown) return;
  roleRevealShown = true;
  el.innerHTML = `
    <div class="reveal-content">
      <p class="reveal-label">Bạn là...</p>
      <div class="reveal-icon">${roleIconHtml(me.role, 88)}</div>
      <h1 class="reveal-role-name">${(ROLE_LABEL_VI[me.role] || me.role).toUpperCase()}</h1>
    </div>
  `;
  el.classList.add("show");
  setTimeout(() => {
    el.classList.remove("show");
  }, 2400);
}

// ============================================================
// 4. RENDER
// ============================================================

function renderPlayerScreen() {
  if (!currentRoom) return;
  const me = currentRoom.players[myId] || {};
  const isAlive = me.alive !== false;
  const isAssigned = !!me.role;
  const isPendingHunter = !!(currentRoom.hunterPending && currentRoom.hunterPending.hunterId === myId);

  renderStatusBar(me, isAlive);
  renderRoleCard(me, isAlive);
  maybeShowRoleReveal(me);
  renderPhaseInfo();
  renderAliveList();
  renderWolfTeamInfo(me, isAlive);
  renderMyVoteCount(isAlive);
  renderVotingArea(isAlive);
  renderNightActionPlayer(me, isAlive);
  renderHunterPullPlayer();
  renderDeathScreen(isAlive, isAssigned, isPendingHunter, me);
  renderRoleRevealDebug();
  renderLogsForPlayer();
  renderWinBanner();
  renderChatPanels(me, isAlive);
  renderSupportChat();
  renderSeerHistory(me);
  renderLoverInfo(me, isAlive);
  renderTimer();
  renderEndGameReveal();
  renderTimelineReveal();
}

function renderStatusBar(me, isAlive) {
  const bar = $("#statusBar");
  const deathLabel = me.deathCause === "vote" ? "Bạn bị dân làng treo cổ 🪢" : "Bạn đã chết";
  bar.textContent = isAlive ? `🟢 ${me.name} — Bạn còn sống` : `💀 ${me.name} — ${deathLabel}`;
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
    <div class="role-name">${roleIconHtml(me.role, 32)}${ROLE_LABEL_VI[me.role] || me.role}</div>
    ${me.isLover ? `<div class="lover-badge">💞 Cặp đôi với ${partner ? partner.name : "?"}</div>` : ""}
    <div class="role-desc">${getRoleDescription(me.role)}</div>
  `;
}

function getRoleDescription(role) {
  const desc = {
    werewolf: "Mỗi đêm cùng đồng đội chọn 1 người để cắn chết (được phép chọn cả đồng đội Sói để tạo niềm tin với dân!). Cần đa số tuyệt đối mới có người chết — hòa phiếu thì không ai chết. Có thể bỏ qua không giết ai. Hãy giả vờ là dân làng ban ngày!",
    seer: "Mỗi đêm soi 1 người để biết có phải Sói hay không. Có thể bỏ qua nếu không muốn soi ai.",
    witch: "Có 1 thuốc cứu và 1 thuốc độc, mỗi loại dùng 1 lần cả game. Có thể không làm gì cả.",
    guardian: "Mỗi đêm chọn 1 người bảo vệ khỏi sói. Không được bảo vệ cùng 1 người 2 đêm liên tiếp. Có thể bỏ qua.",
    cupid: "Đêm đầu tiên ghép 2 người thành cặp đôi. Nếu 1 người chết, người còn lại chết theo! Bắt buộc phải ghép, không có lựa chọn bỏ qua.",
    villager: "Không có khả năng đặc biệt. Hãy dùng lý lẽ để tìm ra Sói ban ngày!",
    hunter: "Khi bị chết (bất kỳ lý do), bạn sẽ tự chọn 1 người kéo theo chết cùng ngay trên điện thoại.",
    elder: "Có 2 mạng! Sói cắn lần đầu không chết. Nhưng thuốc độc + sói cùng đêm thì chết.",
    flute_player: "Phe thứ 3. Mỗi đêm ru ngủ 2 người. Thắng khi tất cả người sống bị mê hoặc.",
    thief: "Đêm đầu tiên chọn 1 trong 2 vai trò dự phòng để đổi sang vai đó, hoặc giữ nguyên.",
    traitor: "Phe thứ 3. Có thể quan sát sói ban đêm. Có điều kiện thắng riêng.",
    cursed_wolf: "Từ đêm thứ 2, sau khi đàn Sói chốt mục tiêu, bạn quyết định có biến CHÍNH mục tiêu đó thành Sói (thay vì để chết) hay không. Không tự chọn nạn nhân riêng. Không bị Bảo vệ/Phù Thủy/Già Làng chặn.",
    wild_child: "Ban đầu phe Dân. Đêm đầu chọn 1 'mẹ nuôi'. Nếu mẹ nuôi còn sống, bạn vẫn là Dân Làng. Nếu mẹ nuôi chết, bạn hóa thành Sói và thắng theo phe Sói!",
  };
  return desc[role] || "";
}

function renderPhaseInfo() {
  const el = $("#phaseInfoPlayer");
  const { phase, round } = currentRoom;
  const labels = {
    lobby: { title: "Đang chờ trong phòng chờ...", sub: "Chuẩn bị màn đêm sắp tới" },
    night: { title: `ĐÊM ${round}`, sub: "Mọi người im lặng, Sói đang săn mồi..." },
    day: { title: `NGÀY ${round}`, sub: "Thảo luận và bỏ phiếu!" },
    ended: { title: "GAME ĐÃ KẾT THÚC", sub: "Cùng xem lại toàn bộ trận đấu" },
  };
  const cur = labels[phase] || { title: "", sub: "" };
  // Icon hiển thị DUY NHẤT qua phaseIconHtml() (ảnh, tự fallback emoji nếu
  // chưa có ảnh) — text không còn nhúng emoji riêng để tránh lặp icon.
  el.innerHTML = `${phaseIconHtml(phase)}${cur.title}<span class="phase-sub">${cur.sub}</span>`;
  el.className = `phase-info phase-${phase}`;
  // UI Phase 1/2: theme nền night/day theo phase hiện tại (chỉ đổi giao diện).
  // Luôn remove cả 2 trước rồi add đúng 1 — tránh bug cũ (cả 2 class cùng tồn tại).
  document.body.classList.remove("night", "day");
  document.body.classList.add(phase === "night" ? "night" : "day");
  // UI Phase 2: phát hiện chuyển phase → hiệu ứng PhaseTransition + âm thanh
  handlePhaseTransition(phase);
}

function renderAliveList() {
  const el = $("#aliveListPlayer");
  if (!el) return;
  const players = currentRoom.players || {};
  const alive = getAlivePlayers(players);
  const dead = Object.entries(players).filter(([, p]) => p.alive === false);
  const currentAliveIds = new Set(alive.map((p) => p.id));

  // UI Phase 2: phát hiện người VỪA chết so với lần render trước, để gắn
  // class animation 1 lần (skull/fade) + phát death.mp3 đúng 1 lần.
  let justDiedCount = 0;
  if (previousAlivePlayerIds.size > 0) {
    dead.forEach(([id]) => {
      if (previousAlivePlayerIds.has(id)) justDiedCount++;
    });
  }
  if (justDiedCount > 0) playSound("death");

  let html = `<div class="alive-counter">👥 Còn sống: ${alive.length} / ${Object.keys(players).length}</div>`;
  html += `<div class="player-list-compact">`;
  alive.forEach(p => {
    html += `<span class="player-chip alive">🟢 ${p.name}</span>`;
  });
  dead.forEach(([id, p]) => {
    const justDied = previousAlivePlayerIds.size > 0 && previousAlivePlayerIds.has(id);
    html += `<span class="player-chip dead ${justDied ? "just-died" : ""}">💀 ${p.name}</span>`;
  });
  html += `</div>`;
  el.innerHTML = html;
  previousAlivePlayerIds = currentAliveIds;
}

// "Đồng đội Sói" — chỉ hiện cho người chơi đang là Sói/Sói Nguyền còn sống.
// Đánh dấu 🌀 cho đồng đội nào VỪA hóa Sói (role hiện tại khác role gốc) —
// chỉ hiện dấu hiệu này khi thực sự có người bị hóa Sói.
function renderWolfTeamInfo(me, isAlive) {
  const el = $("#wolfTeamSection");
  if (!el) return;
  const isWolf = me.role === "werewolf" || me.role === "cursed_wolf";
  if (!isWolf || !isAlive) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  const teammates = getAlivePlayers(currentRoom.players).filter(
    (p) => (p.role === "werewolf" || p.role === "cursed_wolf") && p.id !== myId
  );
  el.classList.remove("hidden");
  if (teammates.length === 0) {
    el.innerHTML = `<h3>🐺 Đồng đội Sói:</h3><p class="note-disabled">Bạn là Sói duy nhất còn sống.</p>`;
    return;
  }
  const chips = teammates.map((p) => {
    const justTransformed = p.originalRole && p.originalRole !== p.role;
    return `<span class="player-chip alive">${p.name}${justTransformed ? " 🌀" : ""}</span>`;
  }).join(" ");
  el.innerHTML = `<h3>🐺 Đồng đội Sói:</h3><div class="player-list-compact">${chips}</div>`;
}

// Player tự thấy số phiếu mình đang nhận vào ban ngày (point #9 feedback) —
// dùng banner nổi bật (không phải chữ mờ note-disabled) để không bị bỏ sót,
// và tự nhấn mạnh thêm (đổi màu/nhịp nháy nhẹ) khi đang có ít nhất 1 phiếu.
function renderMyVoteCount(isAlive) {
  const el = $("#myVoteCountDisplay");
  if (!el) return;
  if (currentRoom.phase !== "day" || !isAlive) {
    el.classList.add("hidden");
    return;
  }
  const votes = currentRoom.dayVotes || {};
  const myVotes = Object.values(votes).filter((v) => v === myId).length;
  el.classList.remove("hidden");
  el.classList.toggle("has-votes", myVotes > 0);
  el.textContent = `📊 Bạn đang bị vote: ${myVotes} phiếu`;
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

function renderDeathScreen(isAlive, isAssigned, isPendingHunter, me) {
  const overlay = $("#deathOverlay");
  // Thợ Săn vừa chết nhưng CHƯA thực hiện xong hành động kéo theo →
  // chưa hiện "YOU ARE DEAD", để họ còn thấy & dùng được #hunterPullPlayer.
  if (!isAlive && isAssigned && !isPendingHunter) {
    overlay.classList.remove("hidden");
    const reasonEl = $("#deathReasonText");
    if (reasonEl) {
      reasonEl.textContent = me.deathCause === "vote"
        ? "Bạn bị dân làng treo cổ. Hãy tiếp tục theo dõi trong im lặng..."
        : "Bạn đã chết. Hãy tiếp tục theo dõi trong im lặng...";
    }
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
    el.innerHTML = `<div class="victory-icon">${winIconHtml(currentRoom.winner, 72)}</div><h1>${WIN_LABEL_VI[currentRoom.winner]}</h1>`;
    if (!victorySoundPlayed) {
      victorySoundPlayed = true;
      playSound("victory");
    }
  } else {
    el.classList.add("hidden");
    victorySoundPlayed = false; // game mới (lobby/đang chơi) → sẵn sàng phát lại cho lần kết thúc sau
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
      <div class="lover-role-info">🎭 Chức năng hiện tại của ${partner.name}: <strong>${roleIconHtml(partner.role, 18)}${ROLE_LABEL_VI[partner.role] || "?"}</strong></div>
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

// Chat riêng với Admin — luôn hiển thị, mọi phase, không bị chặn khi chết
// (vì mục đích là hỏi luật/báo lỗi/cần hỗ trợ, không phải chat với phe sống).
function renderSupportChat() {
  const el = $("#supportChatMessages");
  if (!el || !currentRoom) return;
  const thread = (currentRoom.chat?.support?.[myId]) || [];
  el.innerHTML = thread.slice(-20).map((m) =>
    `<div class="chat-msg ${m.from === "player" ? "chat-mine" : ""}">
      <strong>${m.from === "player" ? "Bạn" : "🛠️ Admin"}:</strong> ${escapeHtml(m.text)}
    </div>`
  ).join("");
  el.scrollTop = el.scrollHeight;
}

function toggleChatInput(inputId, sendId, isAlive) {
  const input = $(`#${inputId}`);
  const send = $(`#${sendId}`);
  if (input) input.disabled = !isAlive;
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
  let endAt = null;
  if (currentRoom.phase === "day") {
    endAt = currentRoom.timerEndAt;
  } else if (currentRoom.phase === "night" && (currentRoom.settings?.actionMode || "admin") === "player") {
    // Đồng hồ đêm chỉ áp dụng ở Player Action Mode
    endAt = currentRoom.nightTimerEndAt;
  }
  if (!endAt) {
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  const remaining = Math.max(0, Math.floor((endAt - Date.now()) / 1000));
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  el.textContent = `⏱️ Còn lại: ${m}:${s.toString().padStart(2, "0")}`;
  el.className = `timer-display ${remaining <= 15 ? "timer-urgent" : ""}`;
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
      <span class="player-name">${avatarHtml(p.name, 30)} ${p.alive === false ? "💀" : "🟢"} ${p.name}</span>
      <span class="player-role">
        ${roleIconHtml(p.originalRole || p.role, 18)}Ban đầu: ${ROLE_LABEL_VI[p.originalRole] || ROLE_LABEL_VI[p.role] || "?"}${changed ? ` → Hiện tại: ${roleIconHtml(p.role, 18)}${ROLE_LABEL_VI[p.role] || p.role}` : ""}
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

  // Support chat send (chat riêng với Admin)
  const supportSendBtn = $("#supportChatSend");
  if (supportSendBtn) {
    supportSendBtn.onclick = () => {
      const input = $("#supportChatInput");
      if (input?.value.trim()) {
        sendSupportMessage(input.value);
        input.value = "";
      }
    };
  }

  // Enter key for chat inputs
  ["wolfChatInput", "loverChatInput", "supportChatInput"].forEach(id => {
    const input = $(`#${id}`);
    if (input) {
      input.onkeydown = (e) => {
        if (e.key === "Enter") $(`#${id.replace("Input", "Send")}`).click();
      };
    }
  });
}

window.addEventListener("DOMContentLoaded", bindPlayerUI);
