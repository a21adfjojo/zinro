const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

const ROLES = {
  VILLAGER: "村人",
  WEREWOLF: "人狼",
  SEER: "占い師",
  MEDIUM: "霊媒師",
  HUNTER: "狩人",
};
let rooms = {};

// ===== ユーティリティ =====
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function assignRoles(players) {
  let n = players.length;
  let roles = [];
  if (n < 4) {
    for (let i = 0; i < n; i++) roles.push(ROLES.VILLAGER);
  } else if (n <= 5) {
    roles.push(ROLES.WEREWOLF, ROLES.SEER, ROLES.HUNTER);
    while (roles.length < n) roles.push(ROLES.VILLAGER);
  } else if (n <= 7) {
    roles.push(
      ROLES.WEREWOLF,
      ROLES.WEREWOLF,
      ROLES.SEER,
      ROLES.HUNTER,
      ROLES.MEDIUM
    );
    while (roles.length < n) roles.push(ROLES.VILLAGER);
  } else {
    roles.push(
      ROLES.WEREWOLF,
      ROLES.WEREWOLF,
      ROLES.WEREWOLF,
      ROLES.SEER,
      ROLES.HUNTER,
      ROLES.MEDIUM
    );
    while (roles.length < n) roles.push(ROLES.VILLAGER);
  }
  shuffle(roles);
  players.forEach((p, i) => (p.role = roles[i]));
}

function broadcastState(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  io.to(roomId).emit("state", {
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
    })),
    phase: room.phase,
    dayCount: room.dayCount,
  });
}

function checkWin(room) {
  const alive = room.players.filter((p) => p.alive);
  const wolves = alive.filter((p) => p.role === ROLES.WEREWOLF);
  const others = alive.filter((p) => p.role !== ROLES.WEREWOLF);
  if (wolves.length === 0) return "村人陣営の勝利！";
  if (wolves.length >= others.length) return "人狼陣営の勝利！";
  return null;
}

// ===== 夜行動 / 投票 =====
function resolveNight(room) {
  if (!room.nightActions)
    room.nightActions = { wolves: {}, seer: null, hunter: null };
  let victim = null;
  let tally = {};
  Object.values(room.nightActions.wolves).forEach((t) => {
    if (!t) return;
    tally[t] = (tally[t] || 0) + 1;
  });
  let max = 0;
  for (const [tid, c] of Object.entries(tally)) {
    if (c > max) {
      max = c;
      victim = tid;
    } else if (c === max) victim = null;
  }
  if (victim && room.nightActions.hunter === victim) victim = null;
  if (victim) {
    const v = room.players.find((p) => p.id === victim);
    if (v) {
      v.alive = false;
      io.to(room.id).emit("system", `⚰️ ${v.name} がやられた！`);
    }
  } else io.to(room.id).emit("system", "🌙 夜は平和だった。");

  if (room.nightActions.seer) {
    const target = room.players.find((p) => p.id === room.nightActions.seer);
    if (target) {
      const seer = room.players.find((p) => p.role === ROLES.SEER && p.alive);
      if (seer)
        io.to(seer.id).emit("seerResult", {
          name: target.name,
          isWolf: target.role === ROLES.WEREWOLF,
        });
    }
  }
  room.nightActions = { wolves: {}, seer: null, hunter: null };
}

function resolveVoting(room) {
  if (!room.votes) room.votes = {};
  let tally = {};
  Object.values(room.votes).forEach((t) => {
    tally[t] = (tally[t] || 0) + 1;
  });
  let executed = null;
  let max = 0;
  let dup = false;
  for (const [tid, c] of Object.entries(tally)) {
    if (c > max) {
      max = c;
      executed = tid;
      dup = false;
    } else if (c === max) {
      dup = true;
    }
  }
  if (!dup && executed) {
    const ex = room.players.find((p) => p.id === executed);
    if (ex) {
      ex.alive = false;
      io.to(room.id).emit("system", `⚰️ ${ex.name} が処刑された！`);
    }
    const medium = room.players.find((p) => p.role === ROLES.MEDIUM && p.alive);
    if (medium && ex)
      io.to(medium.id).emit("mediumResult", { name: ex.name, role: ex.role });
  } else io.to(room.id).emit("system", "⚖️ 処刑は行われなかった。");
  room.votes = {};
}

// ===== フェーズループ =====
function startPhaseLoop(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  room.phase = "night";
  room.dayCount = 1;
  broadcastState(roomId);
  io.to(roomId).emit("system", "🌙 夜になりました。役職は行動してください。");

  function nextPhase() {
    const room = rooms[roomId];
    if (!room) return;
    if (room.phase === "night") {
      resolveNight(room);
      const w = checkWin(room);
      if (w) {
        room.phase = "result";
        io.to(roomId).emit("system", w);
        return;
      }
      room.phase = "day";
      broadcastState(roomId);
      io.to(roomId).emit("system", "☀️ 昼になりました。議論してください。");
      setTimeout(nextPhase, 60000);
    } else if (room.phase === "day") {
      room.phase = "voting";
      broadcastState(roomId);
      io.to(roomId).emit("system", "🗳️ 投票時間です。");
      setTimeout(nextPhase, 30000);
    } else if (room.phase === "voting") {
      resolveVoting(room);
      const w = checkWin(room);
      if (w) {
        room.phase = "result";
        io.to(roomId).emit("system", w);
        return;
      }
      room.dayCount++;
      room.phase = "night";
      broadcastState(roomId);
      io.to(roomId).emit("system", "🌙 夜になりました。");
      setTimeout(nextPhase, 60000);
    }
  }
  setTimeout(nextPhase, 60000);
}

// ===== Socket.IO =====
io.on("connection", (socket) => {
  // ルーム参加
  socket.on("joinRoom", (data) => {
    const { roomId, name, publicRoom } = data;
    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId,
        name: roomId,
        players: [],
        phase: "lobby",
        dayCount: 0,
        votes: {},
        nightActions: { wolves: {}, seer: null, hunter: null },
        public: !!publicRoom,
      };
    }
    const room = rooms[roomId];
    const isHost = room.players.length === 0;
    const player = {
      id: socket.id,
      name: name || "名無し",
      alive: true,
      role: null,
      host: isHost,
    };
    room.players.push(player);
    socket.join(roomId);
    socket.emit("isHost", isHost);
    broadcastState(roomId);
  });

  // ゲーム開始
  socket.on("startGame", (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    assignRoles(room.players);
    room.players.forEach((p) => io.to(p.id).emit("role", p.role));
    startPhaseLoop(roomId);
  });

  // 夜行動: 人狼
  socket.on("wolfVote", (data) => {
    const { roomId, targetId } = data;
    const room = rooms[roomId];
    if (!room) return;
    if (!room.nightActions)
      room.nightActions = { wolves: {}, seer: null, hunter: null };
    const me = room.players.find(
      (p) => p.id === socket.id && p.role === ROLES.WEREWOLF && p.alive
    );
    if (!me) return;
    room.nightActions.wolves[socket.id] = targetId;
  });

  // 夜行動: 占い師
  socket.on("seerInspect", (data) => {
    const { roomId, targetId } = data;
    const room = rooms[roomId];
    if (!room) return;
    if (!room.nightActions)
      room.nightActions = { wolves: {}, seer: null, hunter: null };
    const me = room.players.find(
      (p) => p.id === socket.id && p.role === ROLES.SEER && p.alive
    );
    if (!me) return;
    room.nightActions.seer = targetId;
  });

  // 夜行動: 狩人
  socket.on("hunterProtect", (data) => {
    const { roomId, targetId } = data;
    const room = rooms[roomId];
    if (!room) return;
    if (!room.nightActions)
      room.nightActions = { wolves: {}, seer: null, hunter: null };
    const me = room.players.find(
      (p) => p.id === socket.id && p.role === ROLES.HUNTER && p.alive
    );
    if (!me) return;
    room.nightActions.hunter = targetId;
  });

  // 投票
  socket.on("vote", (data) => {
    const { roomId, targetId } = data;
    const room = rooms[roomId];
    if (!room) return;
    if (!room.votes) room.votes = {};
    const me = room.players.find((p) => p.id === socket.id && p.alive);
    if (!me || room.phase !== "voting") return;
    room.votes[socket.id] = targetId;
    io.to(roomId).emit(
      "system",
      `${me.name} が ${
        room.players.find((p) => p.id === targetId)?.name
      } に投票した。`
    );
  });

  // チャット
  socket.on("chat", (data) => {
    const { roomId, msg } = data;
    const room = rooms[roomId];
    if (!room) return;
    const me = room.players.find((p) => p.id === socket.id);
    if (!me) return;
    io.to(roomId).emit("chat", { from: me.name, text: msg });
  });

  // 公開ルーム一覧
  socket.on("getPublicRooms", () => {
    const list = Object.values(rooms)
      .filter((r) => r.public)
      .map((r) => ({ id: r.id, players: r.players.length }));
    socket.emit("publicRooms", list);
  });

  // 切断
  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const idx = room.players.findIndex((p) => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) delete rooms[roomId];
      }
    }
  });
});

server.listen(PORT, () => console.log("http://localhost:" + PORT));
