"use strict";

const http = require("http");
const WebSocket = require("ws");

const HTTP_PORT = Number(process.env.PORT || 3000);

const MAX_STATE_RATE = 25; // packets/sec per client (client sends ~20/sec)
const MAX_CHAT_LENGTH = 300;
const MAX_NAME_LENGTH = 24;
const MAX_ROOM_NAME_LENGTH = 40;
const MAX_PLAYERS_HARD_LIMIT = 32;
const MAX_PAYLOAD = 1024 * 1024; // avatars are up to ~700 KB
const ROOM_TIMEOUT = 30 * 60 * 1000;
const CLIENT_TIMEOUT = 35 * 1000;

const rooms = new Map();
const clients = new Map();

let nextClientNumber = 1;
let nextRoomNumber = 1;

const now = () => Date.now();
const rnd = n => Math.random().toString(36).slice(2, 2 + n);
const makeId = prefix => prefix + "_" + now().toString(36) + "_" + rnd(7);
const makeClientId = () => "p_" + nextClientNumber++ + "_" + rnd(5);
const makeRoomId = () => "room_" + nextRoomNumber++ + "_" + rnd(5);

function cleanString(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  value = value.replace(/\s+/g, " ").trim();
  if (!value) return fallback;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function safeNumber(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTeam(team, fallback) {
  const t = String(team || "").toUpperCase();
  if (t === "T" || t === "TERRORIST") return "T";
  if (t === "CT" || t === "COUNTERTERRORIST") return "CT";
  return fallback || "CT";
}

function jsonSend(ws, packet) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(packet));
    return true;
  } catch (err) {
    return false;
  }
}

const sendClient = (client, packet) => (client ? jsonSend(client.ws, packet) : false);

function broadcastRoom(room, packet, exceptId) {
  if (!room) return;
  room.players.forEach(playerId => {
    if (exceptId && playerId === exceptId) return;
    const client = clients.get(playerId);
    if (client) sendClient(client, packet);
  });
}

function broadcastAll(packet) {
  clients.forEach(client => sendClient(client, packet));
}

function roomInfo(room) {
  if (!room) return null;
  return {
    id: room.id,
    roomId: room.id,
    name: room.name,
    host: room.host,
    maxPlayers: room.maxPlayers,
    players: room.players.size,
    playerCount: room.players.size,
    createdAt: room.createdAt,
    phase: room.phase,
    round: room.round,
    roundStartedAt: room.roundStartedAt,
    roundEndsAt: room.roundEndsAt
  };
}

function playerInfo(client) {
  if (!client) return null;
  return {
    id: client.id,
    name: client.name,
    room: client.room,
    avatar: client.avatar,
    avatarEnabled: client.avatarEnabled,
    state: client.state,
    headBoost: client.headBoost,
    musicKit: client.musicKit
  };
}

function publicState(client) {
  if (!client) return null;
  const s = client.state || {};
  return {
    id: client.id,
    x: safeNumber(s.x, 0),
    y: safeNumber(s.y, 0),
    z: safeNumber(s.z, 0),
    yaw: safeNumber(s.yaw, 0),
    pitch: safeNumber(s.pitch, 0),
    vx: safeNumber(s.vx, 0),
    vy: safeNumber(s.vy, 0),
    vz: safeNumber(s.vz, 0),
    onGround: !!s.onGround,
    crouching: !!s.crouching,
    alive: s.alive !== false,
    team: normalizeTeam(s.team), // string "CT" / "T" (client expects strings)
    name: client.name,
    avatar: client.avatar || null,
    avatarEnabled: client.avatarEnabled !== false,
    headBoost: client.headBoost || { active: false, targetId: null },
    timestamp: now()
  };
}

function roomPlayers(room) {
  const result = [];
  if (!room) return result;
  room.players.forEach(playerId => {
    const client = clients.get(playerId);
    if (client) result.push(playerInfo(client));
  });
  return result;
}

function sendRoomSnapshot(client) {
  const room = client.room ? rooms.get(client.room) : null;
  if (!room) return;
  sendClient(client, {
    type: "room_snapshot",
    room: roomInfo(room),
    players: roomPlayers(room)
  });
}

function sendRooms(client) {
  const list = [];
  rooms.forEach(room => {
    if (!room.closed) list.push(roomInfo(room));
  });
  list.sort((a, b) => b.createdAt - a.createdAt);
  sendClient(client, { type: "rooms", rooms: list });
}

function broadcastRooms() {
  clients.forEach(client => sendRooms(client));
}

const idleBoost = () => ({ active: false, targetId: null });

function leaveCurrentRoom(client, reason) {
  if (!client || !client.room) return;

  const room = rooms.get(client.room);

  if (!room) {
    client.room = null;
    return;
  }

  const oldRoomId = room.id;

  room.players.delete(client.id);
  client.room = null;
  client.headBoost = idleBoost();

  if (room.host === client.id) {
    const firstRemaining = room.players.values().next();
    if (!firstRemaining.done) {
      room.host = firstRemaining.value;
      const newHost = clients.get(room.host);
      if (newHost) {
        sendClient(newHost, { type: "host_changed", roomId: room.id, host: room.host });
      }
    }
  }

  broadcastRoom(room, {
    type: "player_left",
    id: client.id,
    playerId: client.id,
    reason: reason || "left"
  });

  sendClient(client, { type: "left_room", roomId: oldRoomId, reason: reason || "left" });

  if (room.players.size === 0) {
    room.closed = true;
    rooms.delete(room.id);
    broadcastAll({ type: "room_deleted", roomId: room.id, reason: reason || "empty" });
  } else {
    broadcastRoom(room, { type: "room_update", room: roomInfo(room) });
    broadcastRooms();
  }
}

function deleteRoom(room, reason) {
  if (!room || room.closed) return;

  room.closed = true;

  Array.from(room.players).forEach(playerId => {
    const client = clients.get(playerId);
    if (!client) return;
    client.room = null;
    client.headBoost = idleBoost();
    sendClient(client, { type: "left_room", roomId: room.id, reason: reason || "room_deleted" });
  });

  rooms.delete(room.id);

  broadcastAll({ type: "room_deleted", roomId: room.id, reason: reason || "deleted" });
  broadcastRooms();
}

function createRoom(client, data) {
  if (client.room) leaveCurrentRoom(client, "creating_new_room");

  const name = cleanString(data.name, client.name + "'s Room", MAX_ROOM_NAME_LENGTH);

  let maxPlayers = parseInt(data.maxPlayers, 10);
  if (!Number.isFinite(maxPlayers)) maxPlayers = 8;
  maxPlayers = clamp(maxPlayers, 2, MAX_PLAYERS_HARD_LIMIT);

  const room = {
    id: makeRoomId(),
    name,
    host: client.id,
    maxPlayers,
    players: new Set(),
    createdAt: now(),
    phase: "lobby",
    round: 0,
    roundStartedAt: 0,
    roundEndsAt: 0,
    lastRound: null, // last round_state packet, replayed to late joiners
    closed: false
  };

  rooms.set(room.id, room);
  room.players.add(client.id);
  client.room = room.id;
  client.headBoost = idleBoost();

  sendClient(client, {
    type: "room_joined",
    room: roomInfo(room),
    roomId: room.id,
    isHost: true,
    players: roomPlayers(room)
  });

  broadcastRooms();
}

function joinRoom(client, data) {
  const roomId = cleanString(data.roomId || data.room, "", 100);
  const room = rooms.get(roomId);

  if (!room || room.closed) {
    sendClient(client, { type: "error", code: "ROOM_NOT_FOUND", message: "Room not found." });
    return;
  }

  if (client.room === room.id) {
    sendRoomSnapshot(client);
    return;
  }

  if (room.players.size >= room.maxPlayers) {
    sendClient(client, { type: "error", code: "ROOM_FULL", message: "Room is full." });
    return;
  }

  if (client.room) leaveCurrentRoom(client, "joining_other_room");

  const existingPlayers = roomPlayers(room);

  room.players.add(client.id);
  client.room = room.id;
  client.headBoost = idleBoost();

  sendClient(client, {
    type: "room_joined",
    room: roomInfo(room),
    roomId: room.id,
    isHost: room.host === client.id,
    players: existingPlayers
  });

  broadcastRoom(
    room,
    { type: "player_joined", player: playerInfo(client), id: client.id, roomId: room.id },
    client.id
  );

  sendRoomSnapshot(client);

  if (room.lastRound) sendClient(client, room.lastRound);

  broadcastRoom(room, { type: "room_update", room: roomInfo(room) });
  broadcastRooms();
}

function handleState(client, data) {
  if (!client.room) return;

  const currentTime = now();
  if (currentTime - client.lastStateAt < 1000 / MAX_STATE_RATE) return;
  client.lastStateAt = currentTime;

  const input = data.state && typeof data.state === "object" ? data.state : data;
  if (!input || typeof input !== "object") return;

  const prev = client.state;

  client.state = {
    x: clamp(safeNumber(input.x, prev.x), -100000, 100000),
    y: clamp(safeNumber(input.y, prev.y), -100000, 100000),
    z: clamp(safeNumber(input.z, prev.z), -100000, 100000),
    yaw: safeNumber(input.yaw, prev.yaw),
    pitch: clamp(safeNumber(input.pitch, prev.pitch), -90, 90),
    vx: clamp(safeNumber(input.vx, 0), -1000, 1000),
    vy: clamp(safeNumber(input.vy, 0), -1000, 1000),
    vz: clamp(safeNumber(input.vz, 0), -1000, 1000),
    onGround: !!input.onGround,
    crouching: !!input.crouching,
    alive: input.alive !== false,
    team: normalizeTeam(input.team, prev.team)
  };

  if (typeof input.name === "string") {
    client.name = cleanString(input.name, client.name, MAX_NAME_LENGTH);
  }

  if (typeof input.avatar === "string" && input.avatar.length <= 700000) {
    client.avatar = input.avatar;
  } else if (input.avatar === null) {
    client.avatar = null;
  }

  if (typeof input.avatarEnabled === "boolean") {
    client.avatarEnabled = input.avatarEnabled;
  }

  if (input.headBoost && typeof input.headBoost === "object") {
    updateHeadBoost(client, input.headBoost, true);
  }

  const room = rooms.get(client.room);
  if (!room) return;

  broadcastRoom(room, { type: "state", state: publicState(client) }, client.id);
}

function updateHeadBoost(client, data, fromState) {
  if (!client || !client.room) return;

  const room = rooms.get(client.room);
  if (!room) return;

  if (!data.active) {
    const oldTarget = client.headBoost.targetId;
    client.headBoost = idleBoost();
    if (oldTarget) {
      broadcastRoom(room, {
        type: "head_boost",
        id: client.id,
        playerId: client.id,
        carrierId: client.id,
        active: false,
        targetId: oldTarget,
        timestamp: now()
      });
    }
    return;
  }

  const targetId = cleanString(data.targetId || data.target || "", "", 100);
  if (!targetId || targetId === client.id) return;

  const target = clients.get(targetId);

  if (!target || target.room !== room.id) {
    sendClient(client, {
      type: "error",
      code: "HEAD_BOOST_TARGET_INVALID",
      message: "Head boost target is not in this room."
    });
    return;
  }

  client.headBoost = { active: true, targetId };

  broadcastRoom(room, {
    type: "head_boost",
    id: client.id,
    playerId: client.id,
    carrierId: client.id,
    active: true,
    targetId,
    timestamp: now()
  });
}

function handleChat(client, data) {
  if (!client.room) return;
  const room = rooms.get(client.room);
  if (!room) return;

  const message = cleanString(data.message, "", MAX_CHAT_LENGTH);
  if (!message) return;

  broadcastRoom(room, {
    type: "chat",
    id: makeId("msg"),
    playerId: client.id,
    name: client.name,
    message,
    timestamp: now()
  });
}

/*
 * The client host sends { active, roundSeq, roundEndAt, endAt } and
 * non-host clients read exactly those fields, so relay them unchanged.
 */
function handleRoundState(client, data) {
  if (!client.room) return;
  const room = rooms.get(client.room);
  if (!room) return;

  if (room.host !== client.id) {
    sendClient(client, {
      type: "error",
      code: "NOT_HOST",
      message: "Only the room host can change the round state."
    });
    return;
  }

  const active = data.active === true;
  const roundSeq = Math.max(0, parseInt(data.roundSeq, 10) || 0);
  const roundEndAt = safeNumber(data.roundEndAt, 0);
  const endAt = safeNumber(data.endAt, 0);

  room.phase = active ? "playing" : "intermission";
  room.round = roundSeq;
  room.roundEndsAt = roundEndAt;

  room.lastRound = {
    type: "round_state",
    roomId: room.id,
    active,
    roundSeq,
    roundEndAt,
    endAt,
    timestamp: now()
  };

  broadcastRoom(room, room.lastRound, client.id);
}

function handleMusicEvent(client, data) {
  if (!client.room) return;
  const room = rooms.get(client.room);
  if (!room) return;

  const action = cleanString(data.action, "", 32);
  if (action !== "play" && action !== "stop" && action !== "pause") return;

  // The client plays `url`; only forward plain https links.
  const rawUrl = typeof data.url === "string" ? data.url.trim() : "";
  const url = /^https:\/\/[^\s]{1,290}$/i.test(rawUrl) ? rawUrl : "";

  broadcastRoom(room, {
    type: "music_event",
    playerId: client.id,
    name: client.name,
    action,
    url,
    kit: cleanString(data.kit || data.musicKit || "", "", 64),
    track: cleanString(data.track || data.trackId || "", "", 128),
    timestamp: now()
  });
}

function handleMusicKit(client, data) {
  if (!client.room) return;

  client.musicKit = cleanString(data.kit || data.musicKit, "", 64);

  const room = rooms.get(client.room);
  if (!room) return;

  broadcastRoom(room, {
    type: "music_kit",
    playerId: client.id,
    name: client.name,
    kit: client.musicKit,
    timestamp: now()
  });
}

function handlePing(client) {
  client.lastPing = now();
  sendClient(client, { type: "pong", timestamp: now() });
}

function handleHello(client, data) {
  if (typeof data.name === "string") {
    client.name = cleanString(data.name, client.name, MAX_NAME_LENGTH);
  }
  if (typeof data.avatar === "string" && data.avatar.length <= 700000) {
    client.avatar = data.avatar;
  }
  if (typeof data.avatarEnabled === "boolean") {
    client.avatarEnabled = data.avatarEnabled;
  }
  sendClient(client, { type: "hello", id: client.id, name: client.name });
}

function handleEndRoom(client, data) {
  if (!client.room) return;
  const room = rooms.get(client.room);
  if (!room) return;

  if (room.host !== client.id) {
    sendClient(client, { type: "error", code: "NOT_HOST", message: "Only the host can end the room." });
    return;
  }

  deleteRoom(room, cleanString(data.reason, "match ended", 120));
}

function handleMessage(client, raw) {
  let data;

  try {
    data = JSON.parse(raw);
  } catch (err) {
    sendClient(client, { type: "error", code: "INVALID_JSON", message: "Invalid JSON." });
    return;
  }

  if (!data || typeof data !== "object") return;

  switch (data.type) {
    case "hello": handleHello(client, data); break;
    case "list_rooms": sendRooms(client); break;
    case "create_room": createRoom(client, data); break;
    case "join_room": joinRoom(client, data); break;
    case "leave_room": leaveCurrentRoom(client, "left"); break;
    case "end_room": handleEndRoom(client, data); break;
    case "state": handleState(client, data); break;
    case "head_boost": updateHeadBoost(client, data, false); break;
    case "chat": handleChat(client, data); break;
    case "round_state":
    case "round": handleRoundState(client, data); break;
    case "music_event": handleMusicEvent(client, data); break;
    case "music_kit": handleMusicKit(client, data); break;
    case "ping": handlePing(client); break;
    case "pong": client.lastPing = now(); break;
    default:
      sendClient(client, {
        type: "error",
        code: "UNKNOWN_MESSAGE",
        message: "Unknown message type: " + String(data.type)
      });
      break;
  }
}

function createClient(ws) {
  const id = makeClientId();

  const client = {
    id,
    ws,
    name: "Player " + nextClientNumber,
    room: null,
    avatar: null,
    avatarEnabled: true,
    musicKit: null,
    headBoost: idleBoost(),
    state: {
      x: 0, y: 0, z: 0,
      yaw: 0, pitch: 0,
      vx: 0, vy: 0, vz: 0,
      onGround: false,
      crouching: false,
      alive: true,
      team: "CT"
    },
    connectedAt: now(),
    lastPing: now(),
    lastStateAt: 0
  };

  clients.set(id, client);
  return client;
}

function cleanupClient(client) {
  if (!client) return;
  if (client.room) leaveCurrentRoom(client, "disconnect");
  clients.delete(client.id);
}

const httpServer = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/health") {
    const body = JSON.stringify(
      req.url === "/"
        ? {
            name: "Connections Multiplayer Server",
            status: "online",
            rooms: rooms.size,
            players: clients.size,
            version: "2.1.0"
          }
        : { status: "ok", rooms: rooms.size, players: clients.size, uptime: process.uptime() }
    );

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body)
    });
    res.end(body);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

const wss = new WebSocket.Server({
  server: httpServer,
  perMessageDeflate: false,
  maxPayload: MAX_PAYLOAD
});

wss.on("connection", (ws, request) => {
  const client = createClient(ws);

  console.log(
    "[Connections] client connected:",
    client.id,
    request && request.socket ? request.socket.remoteAddress : "unknown"
  );

  sendClient(client, {
    type: "connected",
    id: client.id,
    serverTime: now(),
    version: "2.1.0"
  });

  sendRooms(client);

  ws.on("message", raw => {
    const current = clients.get(client.id);
    if (!current) return;
    handleMessage(current, raw.toString());
  });

  ws.on("close", () => {
    console.log("[Connections] client disconnected:", client.id);
    cleanupClient(client);
  });

  ws.on("error", err => {
    console.log("[Connections] websocket error:", client.id, err && err.message ? err.message : err);
    cleanupClient(client);
  });

  ws.on("pong", () => {
    client.lastPing = now();
  });
});

httpServer.listen(HTTP_PORT, "0.0.0.0", () => {
  console.log("");
  console.log("========================================");
  console.log(" Connections Multiplayer Server");
  console.log("========================================");
  console.log(" HTTP/WS :", HTTP_PORT);
  console.log(" ONLINE");
  console.log("========================================");
  console.log("");
});

const heartbeat = setInterval(() => {
  const currentTime = now();

  clients.forEach(client => {
    if (!client.ws || client.ws.readyState !== WebSocket.OPEN) {
      cleanupClient(client);
      return;
    }

    if (currentTime - client.lastPing > CLIENT_TIMEOUT) {
      try { client.ws.terminate(); } catch (err) {}
      cleanupClient(client);
      return;
    }

    try { client.ws.ping(); } catch (err) {}
  });
}, 10000);

const roomCleanup = setInterval(() => {
  const currentTime = now();

  rooms.forEach(room => {
    if (room.players.size === 0) {
      rooms.delete(room.id);
      return;
    }

    if (currentTime - room.createdAt > ROOM_TIMEOUT && room.phase === "lobby") {
      deleteRoom(room, "room timeout");
    }
  });
}, 60000);

function shutdown(signal) {
  console.log("[Connections] shutting down:", signal);

  clearInterval(heartbeat);
  clearInterval(roomCleanup);

  rooms.forEach(room => { room.closed = true; });

  clients.forEach(client => {
    try {
      sendClient(client, { type: "server_shutdown" });
      client.ws.close(1001, "Server shutting down");
    } catch (err) {}
  });

  try { wss.close(); } catch (err) {}

  try {
    httpServer.close(() => process.exit(0));
  } catch (err) {
    process.exit(0);
  }

  setTimeout(() => process.exit(0), 3000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", err => console.error("[Connections] uncaught exception:", err));
process.on("unhandledRejection", err => console.error("[Connections] unhandled rejection:", err));
