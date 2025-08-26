const socket = io();

let currentRoomId = null;
let myRole = null;

// DOM Elements
const roomSection = document.getElementById("roomSection");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const roomIdInput = document.getElementById("roomIdInput");
const nameInput = document.getElementById("nameInput");
const publicCheck = document.getElementById("publicCheck");
const listPublicBtn = document.getElementById("listPublicBtn");
const publicList = document.getElementById("publicList");

const gameSection = document.getElementById("game");
const hostStartDiv = document.getElementById("hostStartDiv");
const startBtn = document.getElementById("startBtn");
const playersUl = document.getElementById("players");
const phaseSpan = document.getElementById("phase");
const daySpan = document.getElementById("day");
const roleCard = document.getElementById("roleCard");

const seerBox = document.getElementById("seerBox");
const seerTarget = document.getElementById("seerTarget");
const seerBtn = document.getElementById("seerBtn");
const seerResult = document.getElementById("seerResult");

const hunterBox = document.getElementById("hunterBox");
const hunterTarget = document.getElementById("hunterTarget");
const hunterBtn = document.getElementById("hunterBtn");

const wolfBox = document.getElementById("wolfBox");
const wolfTarget = document.getElementById("wolfTarget");
const wolfBtn = document.getElementById("wolfBtn");

const chatInput = document.getElementById("chatInput");
const chatSend = document.getElementById("chatSend");
const chatLog = document.getElementById("chatLog");

const voteTarget = document.getElementById("voteTarget");
const voteBtn = document.getElementById("voteBtn");

// ===== Room参加 =====
joinRoomBtn.onclick = () => {
  const roomId = roomIdInput.value.trim();
  const name = nameInput.value.trim() || "名無し";
  const publicRoom = publicCheck.checked;
  if (!roomId) return alert("ルームIDを入力");
  currentRoomId = roomId;
  socket.emit("joinRoom", { roomId, name, publicRoom });
  roomSection.classList.add("hidden");
  gameSection.classList.remove("hidden");
};

// ===== 公開ルーム一覧 =====
listPublicBtn.onclick = () => {
  socket.emit("getPublicRooms");
};

socket.on("publicRooms", (list) => {
  publicList.innerHTML = "";
  if (list.length === 0) {
    publicList.textContent = "公開ルームはありません";
    return;
  }
  list.forEach((r) => {
    const btn = document.createElement("button");
    btn.textContent = `${r.id} (${r.players}人)`;
    btn.onclick = () => {
      roomIdInput.value = r.id;
      publicCheck.checked = true;
    };
    publicList.appendChild(btn);
  });
});

// ===== ホスト判定 =====
socket.on("isHost", (isHost) => {
  if (isHost) hostStartDiv.classList.remove("hidden");
});

// ===== ゲーム開始 =====
startBtn.onclick = () => {
  if (!currentRoomId) return;
  socket.emit("startGame", currentRoomId);
  hostStartDiv.classList.add("hidden");
};

// ===== 役職 =====
socket.on("role", (role) => {
  myRole = role;
  roleCard.textContent = role;

  // 初期非表示
  seerBox.classList.add("hidden");
  hunterBox.classList.add("hidden");
  wolfBox.classList.add("hidden");

  // 生存中で自分の役職なら表示
  if (role === "占い師") seerBox.classList.remove("hidden");
  if (role === "狩人") hunterBox.classList.remove("hidden");
  if (role === "人狼") wolfBox.classList.remove("hidden");
});

// ===== 夜行動 =====
seerBtn.onclick = () => {
  socket.emit("seerInspect", {
    roomId: currentRoomId,
    targetId: seerTarget.value,
  });
  seerResult.textContent = "🔮 行動を決定しました";
  seerBtn.disabled = true;
};

hunterBtn.onclick = () => {
  socket.emit("hunterProtect", {
    roomId: currentRoomId,
    targetId: hunterTarget.value,
  });
  alert("🛡 行動を決定しました");
  hunterBtn.disabled = true;
};

wolfBtn.onclick = () => {
  socket.emit("wolfVote", {
    roomId: currentRoomId,
    targetId: wolfTarget.value,
  });
  alert("🐺 行動を決定しました");
  wolfBtn.disabled = true;
};

// 夜が終わったらボタンを再度有効化する
socket.on("state", (s) => {
  const night = s.phase === "night";
  [seerBtn, hunterBtn, wolfBtn].forEach((btn) => {
    btn.disabled = !night;
  });

  // プレイヤーリスト更新
  playersUl.innerHTML = "";
  s.players.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p.name;
    if (!p.alive) li.classList.add("dead");
    playersUl.appendChild(li);
  });

  // フェーズ・日数
  phaseSpan.textContent = s.phase;
  daySpan.textContent = s.dayCount;

  // 夜行動・投票用セレクト更新
  const selects = [seerTarget, hunterTarget, wolfTarget, voteTarget];
  selects.forEach((sel) => (sel.innerHTML = ""));
  s.players
    .filter((p) => p.alive)
    .forEach((p) => {
      selects.forEach((sel) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name;
        sel.appendChild(opt);
      });
    });
});

// ===== 投票 =====
voteBtn.onclick = () => {
  socket.emit("vote", { roomId: currentRoomId, targetId: voteTarget.value });
};

// ===== チャット =====
chatSend.onclick = () => {
  const msg = chatInput.value.trim();
  if (!msg) return;
  socket.emit("chat", { roomId: currentRoomId, msg });
  chatInput.value = "";
};

socket.on("chat", (msg) => {
  const div = document.createElement("div");
  div.textContent = `${msg.from}: ${msg.text}`;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
});

// ===== 結果通知 =====
socket.on("seerResult", (res) => {
  seerResult.textContent = `${res.name}は${
    res.isWolf ? "人狼" : "人狼ではない"
  }`;
});
socket.on("mediumResult", (res) => {
  alert(`霊媒結果: ${res.name} は ${res.role}`);
});
socket.on("system", (msg) => {
  const div = document.createElement("div");
  div.textContent = `[SYSTEM] ${msg}`;
  div.classList.add("systemMsg");
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
});
