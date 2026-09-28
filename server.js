"use strict";

const http = require("http");
const crypto = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");

const RAFIT = require("./rafit");

const PORT = 8090;

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, {
      "Content-Type": "application/json"
    });

    res.end(
      JSON.stringify({
        name: "Connections Multiplayer Server",
        status: "online",
        rooms: rooms.size,
        players: clients.size
      })
    );

    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

const wss = new WebSocketServer({
  server
});

const clients = new Map();
const rooms = new Map();

function id() {
  return crypto.randomBytes(10).toString("hex");
}

function roomId() {
  return crypto.randomBytes(8).toString("hex");
}

function safeName(name) {
  name = String(name || "Player")
    .replace(/[<>]/g, "")
    .trim();

  if (!name) {
    name = "Player";
  }

  return name.slice(0, 24);
}

function safeSegmentText(text) {
  return String(text || "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 30);
}

function safeColor(color) {
  color = String(color || "#ffffff");

  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return "#ffffff";
  }

  return color;
}

function sanitizeSegments(segments) {
  if (!Array.isArray(segments)) {
    return [
      {
        text: "ROOM",
        color: "#ffffff"
      }
    ];
  }

  return segments
    .slice(0, 6)
    .map(s => ({
      text: safeSegmentText(s.text),
      color: safeColor(s.color)
    }))
    .filter(s => s.text.length > 0);
}

function makeRoom(options) {
  const room = {
    id: roomId(),

    segments: sanitizeSegments(
      options.segments
    ),

    ctSlots: Math.max(
      1,
      Math.min(
        32,
        Number(options.ctSlots) || 5
      )
    ),

    tSlots: Math.max(
      1,
      Math.min(
        32,
        Number(options.tSlots) || 5
      )
    ),

    rafit: !!options.rafit,

    professional: !!options.professional,

    hostId: null,

    players: new Map(),

    createdAt: Date.now()
  };

  rooms.set(room.id, room);

  return room;
}

function roomTitle(room) {
  return room.segments
    .map(s => s.text)
    .join(" ");
}

function publicPlayer(player) {
  const profile = RAFIT.getProfile(
    player.id,
    player.name
  );

  return {
    id: player.id,
    name: player.name,
    host: player.id === player.room.hostId,
    team: player.team,
    rtp: profile.rtp,
    rafit: player.room.rafit
  };
}

function publicRoom(room) {
  return {
    id: room.id,

    segments: room.segments,

    ctSlots: room.ctSlots,
    tSlots: room.tSlots,

    rafit: room.rafit,
    professional: room.professional,

    hostId: room.hostId,

    players: Array.from(
      room.players.values()
    ).map(publicPlayer),

    playerCount: room.players.size,

    title: roomTitle(room)
  };
}

function send(ws, type, data = {}) {
  if (
    !ws ||
    ws.readyState !== WebSocket.OPEN
  ) {
    return;
  }

  try {
    ws.send(
      JSON.stringify({
        type,
        ...data
      })
    );
  } catch {}
}

function broadcastRoom(room, type, data = {}) {
  for (const player of room.players.values()) {
    send(player.ws, type, data);
  }
}

function broadcastRooms() {
  const list = Array.from(
    rooms.values()
  ).map(publicRoom);

  for (const client of clients.values()) {
    send(client.ws, "rooms", {
      rooms: list
    });
  }
}

function sendRoster(room) {
  broadcastRoom(room, "roster", {
    room: publicRoom(room),
    players: Array.from(
      room.players.values()
    ).map(publicPlayer)
  });
}

function sendRoomJoined(player) {
  send(player.ws, "room_joined", {
    room: publicRoom(player.room),
    id: player.id,
    host: player.room.hostId === player.id,

    rafit: player.room.rafit,

    rtp: RAFIT.getRtp(player.id)
  });
}

function chooseHost(room) {
  if (room.players.size === 0) {
    room.hostId = null;
    return null;
  }

  const first = room.players.values().next().value;

  room.hostId = first.id;

  return first;
}

function removeFromRoom(player, reason) {
  const room = player.room;

  if (!room) {
    return;
  }

  room.players.delete(player.id);

  player.room = null;

  if (room.hostId === player.id) {
    const newHost = chooseHost(room);

    if (newHost) {
      broadcastRoom(room, "host_changed", {
        id: newHost.id
      });
    }
  }

  broadcastRoom(room, "leave", {
    id: player.id,
    name: player.name,
    reason: reason || "left"
  });

  sendRoster(room);

  if (room.players.size === 0) {
    rooms.delete(room.id);
  }

  broadcastRooms();
}

function closePlayer(player, code, reason) {
  if (!player) return;

  try {
    player.ws.close(
      code || 1000,
      reason || ""
    );
  } catch {}
}

function joinRoom(player, requestedRoomId, data) {
  const room = rooms.get(
    String(requestedRoomId || "")
  );

  if (!room) {
    send(player.ws, "error", {
      code: "ROOM_NOT_FOUND",
      message: "Room does not exist."
    });
    return;
  }

  if (room.players.has(player.id)) {
    return;
  }

  const check = RAFIT.canJoinRoom(
    player.id,
    room.professional
  );

  if (!check.allowed) {
    send(player.ws, "error", {
      code: check.reason,
      rtp: check.rtp,
      bannedUntil: check.bannedUntil
    });
    return;
  }

  const maxPlayers =
    room.ctSlots +
    room.tSlots;

  if (room.players.size >= maxPlayers) {
    send(player.ws, "error", {
      code: "ROOM_FULL",
      message: "Room is full."
    });
    return;
  }

  if (player.room) {
    removeFromRoom(
      player,
      "switch_room"
    );
  }

  player.name = safeName(
    data.name || player.name
  );

  player.team =
    data.team === "t"
      ? "t"
      : "ct";

  player.avatar =
    typeof data.avatar === "string"
      ? data.avatar.slice(0, 500000)
      : null;

  player.room = room;

  room.players.set(
    player.id,
    player
  );

  if (!room.hostId) {
    room.hostId = player.id;
  }

  send(player.ws, "room_joined", {
    room: publicRoom(room),
    id: player.id,
    host: room.hostId === player.id,
    rafit: room.rafit,
    rtp: RAFIT.getRtp(player.id)
  });

  broadcastRoom(room, "join", {
    player: publicPlayer(player)
  });

  sendRoster(room);
  broadcastRooms();
}

function createRoom(player, data) {
  const check = RAFIT.canJoinRoom(
    player.id,
    !!data.professional
  );

  if (!check.allowed) {
    send(player.ws, "error", {
      code: check.reason,
      rtp: check.rtp,
      bannedUntil: check.bannedUntil
    });

    return;
  }

  const room = makeRoom({
    segments: data.segments,

    ctSlots: data.ctSlots,
    tSlots: data.tSlots,

    rafit: data.rafit,
    professional: data.professional
  });

  joinRoom(
    player,
    room.id,
    data
  );
}

function kickPlayer(host, targetId) {
  const room = host.room;

  if (!room) {
    return;
  }

  if (room.hostId !== host.id) {
    send(host.ws, "error", {
      code: "HOST_ONLY",
      message: "Only the host can kick players."
    });

    return;
  }

  const target =
    room.players.get(
      String(targetId)
    );

  if (!target) {
    send(host.ws, "error", {
      code: "PLAYER_NOT_FOUND"
    });

    return;
  }

  if (target.id === host.id) {
    send(host.ws, "error", {
      code: "CANNOT_KICK_HOST"
    });

    return;
  }

  send(target.ws, "kicked", {
    roomId: room.id,
    reason: "Kicked by host."
  });

  removeFromRoom(
    target,
    "kicked"
  );

  closePlayer(
    target,
    4003,
    "Kicked"
  );
}

function sendInitialRooms(player) {
  send(player.ws, "rooms", {
    rooms: Array.from(
      rooms.values()
    ).map(publicRoom)
  });
}

function broadcastGameState(room) {
  const players = [];

  for (const p of room.players.values()) {
    players.push({
      id: p.id,
      name: p.name,
      team: p.team,
      avatar: p.avatar,

      x: p.x,
      y: p.y,
      z: p.z,

      yaw: p.yaw,
      pitch: p.pitch,

      health: p.health,
      alive: p.alive,
      dead: !p.alive
    });
  }

  broadcastRoom(room, "state", {
    players
  });
}

function updatePlayerState(player, state) {
  if (!player.room) {
    return;
  }

  const room = player.room;

  const x = Number(state.x);
  const y = Number(state.y);
  const z = Number(state.z);

  const yaw = Number(state.yaw);
  const pitch = Number(state.pitch);

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z)
  ) {
    return;
  }

  const currentTime = Date.now();

  let dt =
    (currentTime - player.lastState) /
    1000;

  dt = Math.max(
    0.001,
    Math.min(1, dt)
  );

  const check = RAFIT.inspectMovement(
    player.id,
    {
      x,
      y,
      z,

      lastX: player.x,
      lastY: player.y,
      lastZ: player.z,

      dt
    }
  );

  if (check.suspicious) {
    const result = RAFIT.penalize(
      player.id,
      100,
      check.type
    );

    send(player.ws, "rafit_warning", {
      type: check.type,
      rtp: result.rtp,
      banned: result.banned
    });

    if (result.banned) {
      send(player.ws, "rafit_banned", {
        bannedUntil: result.bannedUntil
      });

      removeFromRoom(
        player,
        "rafit_ban"
      );

      closePlayer(
        player,
        4004,
        "RAFIT ban"
      );

      return;
    }

    /*
      Do not accept an obviously impossible
      teleport sample.
    */

    return;
  }

  player.x = x;
  player.y = y;
  player.z = z;

  if (Number.isFinite(yaw)) {
    player.yaw = yaw;
  }

  if (Number.isFinite(pitch)) {
    player.pitch = pitch;
  }

  if (
    typeof state.health === "number"
  ) {
    player.health =
      Math.max(
        0,
        Math.min(
          100,
          state.health
        )
      );
  }

  if (
    typeof state.alive === "boolean"
  ) {
    player.alive = state.alive;
  }

  if (
    typeof state.dead === "boolean"
  ) {
    player.alive = !state.dead;
  }

  if (
    typeof state.avatar === "string"
  ) {
    player.avatar =
      state.avatar.slice(0, 500000);
  }

  player.lastState =
    currentTime;

  if (
    currentTime -
      player.lastBroadcast >
    30
  ) {
    player.lastBroadcast =
      currentTime;

    broadcastGameState(room);
  }
}

function handleMessage(player, msg) {
  if (!msg || !msg.type) {
    return;
  }

  switch (msg.type) {
    case "list_rooms":
      sendInitialRooms(player);
      break;

    case "create_room":
      createRoom(player, msg);
      break;

    case "join_room":
      joinRoom(
        player,
        msg.roomId || msg.room,
        msg
      );
      break;

    case "leave_room":
      if (player.room) {
        removeFromRoom(
          player,
          "left"
        );

        send(
          player.ws,
          "left_room"
        );
      }
      break;

    case "kick":
      kickPlayer(
        player,
        msg.targetId
      );
      break;

    case "state":
      updatePlayerState(
        player,
        msg.state || msg
      );
      break;

    case "input":
      /*
        Reserved for future authoritative
        input simulation.
      */
      break;

    case "shot":
      if (player.room) {
        broadcastRoom(
          player.room,
          "shot",
          {
            id: player.id,
            shot: msg.shot || {}
          }
        );
      }
      break;

    case "hit":
      if (player.room) {
        broadcastRoom(
          player.room,
          "damage",
          {
            id: player.id,
            targetId: msg.targetId,
            damage: Number(msg.damage) || 0
          }
        );
      }
      break;

    case "chat":
      if (player.room) {
        broadcastRoom(
          player.room,
          "chat",
          {
            id: player.id,
            name: player.name,
            text: String(
              msg.text || ""
            ).slice(0, 300)
          }
        );
      }
      break;

    case "ping":
      send(player.ws, "pong", {
        time: Date.now()
      });
      break;

    default:
      send(player.ws, "error", {
        code: "UNKNOWN_MESSAGE",
        message:
          "Unknown message type: " +
          msg.type
      });
      break;
  }
}

wss.on("connection", ws => {
  const playerId = id();

  const player = {
    id: playerId,
    ws,

    name: "Player",
    room: null,

    team: "ct",
    avatar: null,

    x: 0,
    y: 0,
    z: 0,

    yaw: 0,
    pitch: 0,

    health: 100,
    alive: true,

    lastState: Date.now(),
    lastBroadcast: 0
  };

  clients.set(
    playerId,
    player
  );

  RAFIT.getPlayer(
    player.id,
    player.name
  );

  send(ws, "connected", {
    id: player.id,
    version: "1.0.0"
  });

  send(ws, "hello", {
    id: player.id
  });

  sendInitialRooms(player);

  ws.on("message", raw => {
    let msg;

    try {
      msg = JSON.parse(
        raw.toString()
      );
    } catch {
      return;
    }

    handleMessage(
      player,
      msg
    );
  });

  ws.on("close", () => {
    if (player.room) {
      removeFromRoom(
        player,
        "disconnect"
      );
    }

    clients.delete(
      player.id
    );

    broadcastRooms();
  });

  ws.on("error", () => {
    try {
      ws.close();
    } catch {}
  });
});

setInterval(() => {
  for (const player of clients.values()) {
    send(player.ws, "ping", {
      time: Date.now()
    });
  }
}, 15000);

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.players.size > 0) {
      broadcastGameState(room);
    }
  }
}, 50);

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("");
    console.log(
      "======================================"
    );
    console.log(
      " Connections Multiplayer Server"
    );
    console.log(
      "======================================"
    );
    console.log(
      "[SERVER] HTTP : " + PORT
    );
    console.log(
      "[SERVER] WS   : ws://0.0.0.0:" + PORT
    );
    console.log(
      "[SERVER] RAFIT enabled"
    );
    console.log(
      "[SERVER] No default room"
    );
    console.log(
      "[SERVER] ONLINE"
    );
    console.log(
      "======================================"
    );
    console.log("");
  }
);
