const http = require("http");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";

const MAX_ROOMS = 100;
const MAX_PLAYERS_PER_ROOM = 16;

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/") {
    return res.end(
      JSON.stringify({
        name: "Connections Multiplayer Server",
        status: "online",
        rooms: rooms.size,
        players: getTotalPlayers()
      })
    );
  }

  if (req.url === "/health") {
    return res.end(
      JSON.stringify({
        status: "ok",
        rooms: rooms.size,
        players: getTotalPlayers(),
        uptime: process.uptime()
      })
    );
  }

  res.statusCode = 404;

  res.end(
    JSON.stringify({
      error: "Not found"
    })
  );
});

const wss = new WebSocket.Server({
  server
});

const players = new Map();
const rooms = new Map();

let nextPlayerId = 1;

function log() {
  console.log(
    "[Connections]",
    ...arguments
  );
}

function makeId() {
  return (
    "player_" +
    Date.now().toString(36) +
    "_" +
    (nextPlayerId++).toString(36)
  );
}

function cleanName(name) {
  if (
    typeof name !== "string"
  ) {
    return "Player";
  }

  name = name
    .trim()
    .slice(0, 32);

  return name || "Player";
}

function cleanAvatar(avatar) {
  if (
    typeof avatar !== "string"
  ) {
    return null;
  }

  avatar = avatar.trim();

  if (!avatar) {
    return null;
  }

  return avatar.slice(0, 2048);
}

function cleanVector(value) {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return {
      x: 0,
      y: 0,
      z: 0
    };
  }

  return {
    x: finiteNumber(value.x),
    y: finiteNumber(value.y),
    z: finiteNumber(value.z)
  };
}

function cleanRotation(value) {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return {
      yaw: 0,
      pitch: 0
    };
  }

  return {
    yaw: finiteNumber(value.yaw),
    pitch: finiteNumber(value.pitch)
  };
}

function finiteNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(
    -1000000,
    Math.min(
      1000000,
      number
    )
  );
}

function getPlayer(ws) {
  if (!ws || !ws.__playerId) {
    return null;
  }

  return players.get(
    ws.__playerId
  ) || null;
}

function getTotalPlayers() {
  let count = 0;

  for (const player of players.values()) {
    if (
      player.ws &&
      player.ws.readyState ===
        WebSocket.OPEN
    ) {
      count++;
    }
  }

  return count;
}

function getRoomPlayers(room) {
  if (!room) {
    return [];
  }

  return Array.from(
    room.players
  )
    .map(id => players.get(id))
    .filter(Boolean);
}

function publicPlayer(player) {
  if (!player) {
    return null;
  }

  return {
    id: player.id,
    name: player.name,
    avatar: player.avatar,
    position: player.position,
    rotation: player.rotation
  };
}

function publicRoom(room) {
  if (!room) {
    return null;
  }

  return {
    id: room.id,
    name: room.name,
    players: room.players.size,
    playerCount: room.players.size,
    maxPlayers: room.maxPlayers,
    locked: room.locked,
    owner: room.owner
  };
}

function send(ws, data) {
  if (
    !ws ||
    ws.readyState !==
      WebSocket.OPEN
  ) {
    return false;
  }

  try {
    ws.send(
      JSON.stringify(data)
    );

    return true;
  } catch (error) {
    log(
      "Send error:",
      error.message
    );

    return false;
  }
}

function broadcastRoom(
  room,
  data,
  exceptId
) {
  if (!room) {
    return;
  }

  for (const id of room.players) {
    if (
      exceptId &&
      id === exceptId
    ) {
      continue;
    }

    const player =
      players.get(id);

    if (player) {
      send(
        player.ws,
        data
      );
    }
  }
}

function sendRooms(ws) {
  send(ws, {
    type: "rooms",

    rooms:
      Array.from(
        rooms.values()
      ).map(publicRoom)
  });
}

function sendRoomPlayers(
  room,
  ws
) {
  if (!room) {
    return;
  }

  const list =
    getRoomPlayers(room)
      .map(publicPlayer);

  send(ws, {
    type: "players",
    players: list
  });
}

function broadcastRoomPlayers(
  room
) {
  if (!room) {
    return;
  }

  const list =
    getRoomPlayers(room)
      .map(publicPlayer);

  broadcastRoom(
    room,
    {
      type: "players",
      players: list
    }
  );
}

function createRoom(
  name,
  ownerId
) {
  if (
    rooms.size >=
    MAX_ROOMS
  ) {
    return null;
  }

  const id =
    "room_" +
    Date.now().toString(36) +
    "_" +
    Math.random()
      .toString(36)
      .slice(2, 8);

  const room = {
    id,

    name:
      cleanName(name),

    owner:
      ownerId || null,

    maxPlayers:
      MAX_PLAYERS_PER_ROOM,

    locked:
      false,

    players:
      new Set(),

    createdAt:
      Date.now()
  };

  rooms.set(
    id,
    room
  );

  return room;
}

function findRoom(roomId) {
  if (!roomId) {
    return null;
  }

  return (
    rooms.get(
      String(roomId)
    ) || null
  );
}

function leaveRoom(
  player
) {
  if (
    !player ||
    !player.roomId
  ) {
    return;
  }

  const room =
    rooms.get(
      player.roomId
    );

  if (!room) {
    player.roomId =
      null;

    return;
  }

  room.players.delete(
    player.id
  );

  player.roomId =
    null;

  send(player.ws, {
    type: "room_left"
  });

  broadcastRoom(
    room,
    {
      type: "player_leave",
      id: player.id
    }
  );

  broadcastRoomPlayers(
    room
  );

  if (
    room.owner ===
    player.id
  ) {
    const remaining =
      getRoomPlayers(room);

    if (remaining.length) {
      room.owner =
        remaining[0].id;
    }
  }

  if (
    room.players.size ===
    0
  ) {
    rooms.delete(
      room.id
    );
  }

  sendRoomsToEveryone();
}

function joinRoom(
  player,
  room
) {
  if (
    !player ||
    !room
  ) {
    return false;
  }

  if (
    room.locked
  ) {
    send(player.ws, {
      type: "error",
      error:
        "Room is locked."
    });

    return false;
  }

  if (
    room.players.size >=
    room.maxPlayers
  ) {
    send(player.ws, {
      type: "error",
      error:
        "Room is full."
    });

    return false;
  }

  if (
    player.roomId ===
    room.id
  ) {
    sendRoomPlayers(
      room,
      player.ws
    );

    return true;
  }

  if (
    player.roomId
  ) {
    leaveRoom(
      player
    );
  }

  room.players.add(
    player.id
  );

  player.roomId =
    room.id;

  send(player.ws, {
    type: "room_joined",

    room: room.id,

    roomData:
      publicRoom(room)
  });

  sendRoomPlayers(
    room,
    player.ws
  );

  broadcastRoom(
    room,
    {
      type: "player_join",

      player:
        publicPlayer(player)
    },
    player.id
  );

  broadcastRoomPlayers(
    room
  );

  sendRoomsToEveryone();

  return true;
}

function sendRoomsToEveryone() {
  for (
    const player of
      players.values()
  ) {
    sendRooms(
      player.ws
    );
  }
}

function handleHello(
  ws,
  data
) {
  const player =
    getPlayer(ws);

  if (!player) {
    return;
  }

  player.name =
    cleanName(
      data.name
    );

  player.avatar =
    cleanAvatar(
      data.avatar
    );

  send(ws, {
    type: "welcome",

    id:
      player.id,

    name:
      player.name,

    avatar:
      player.avatar
  });

  sendRooms(ws);
}

function handleState(
  ws,
  data
) {
  const player =
    getPlayer(ws);

  if (!player) {
    return;
  }

  if (
    !player.roomId
  ) {
    return;
  }

  player.position =
    cleanVector(
      data.position
    );

  player.rotation =
    cleanRotation(
      data.rotation
    );

  if (
    typeof data.name ===
    "string"
  ) {
    player.name =
      cleanName(
        data.name
      );
  }

  if (
    Object.prototype
      .hasOwnProperty.call(
        data,
        "avatar"
      )
  ) {
    player.avatar =
      cleanAvatar(
        data.avatar
      );
  }

  const packet = {
    type:
      "player_state",

    player:
      publicPlayer(
        player
      )
  };

  const room =
    rooms.get(
      player.roomId
    );

  broadcastRoom(
    room,
    packet,
    player.id
  );
}

function handleChat(
  ws,
  data
) {
  const player =
    getPlayer(ws);

  if (
    !player ||
    !player.roomId
  ) {
    return;
  }

  let message =
    typeof data.message ===
    "string"
      ? data.message
      : "";

  message =
    message
      .trim()
      .slice(0, 256);

  if (!message) {
    return;
  }

  const room =
    rooms.get(
      player.roomId
    );

  const packet = {
    type: "chat",

    id:
      player.id,

    name:
      player.name,

    message:
      message,

    timestamp:
      Date.now()
  };

  broadcastRoom(
    room,
    packet
  );
}

function handleCreateRoom(
  ws,
  data
) {
  const player =
    getPlayer(ws);

  if (!player) {
    return;
  }

  const room =
    createRoom(
      data.name,
      player.id
    );

  if (!room) {
    send(ws, {
      type: "error",
      error:
        "Could not create room."
    });

    return;
  }

  joinRoom(
    player,
    room
  );
}

function handleJoinRoom(
  ws,
  data
) {
  const player =
    getPlayer(ws);

  if (!player) {
    return;
  }

  const room =
    findRoom(
      data.room ||
      data.roomId
    );

  if (!room) {
    send(ws, {
      type: "error",
      error:
        "Room not found."
    });

    return;
  }

  joinRoom(
    player,
    room
  );
}

function handleLeaveRoom(
  ws
) {
  const player =
    getPlayer(ws);

  if (!player) {
    return;
  }

  leaveRoom(
    player
  );
}

function handleRoomState(
  ws
) {
  const player =
    getPlayer(ws);

  if (
    !player ||
    !player.roomId
  ) {
    return;
  }

  const room =
    rooms.get(
      player.roomId
    );

  if (!room) {
    return;
  }

  sendRoomPlayers(
    room,
    ws
  );
}

function handleHeartbeat(
  ws
) {
  const player =
    getPlayer(ws);

  if (!player) {
    return;
  }

  player.lastHeartbeat =
    Date.now();

  send(ws, {
    type:
      "heartbeat",

    timestamp:
      Date.now()
  });
}

function handleMessage(
  ws,
  raw
) {
  let data;

  try {
    data =
      JSON.parse(
        raw.toString()
      );
  } catch {
    send(ws, {
      type: "error",
      error:
        "Invalid JSON."
    });

    return;
  }

  if (
    !data ||
    typeof data !==
      "object"
  ) {
    return;
  }

  const type =
    String(
      data.type || ""
    );

  switch (type) {
    case "hello":
      handleHello(
        ws,
        data
      );
      break;

    case "state":
    case "player_state":
      handleState(
        ws,
        data
      );
      break;

    case "chat":
      handleChat(
        ws,
        data
      );
      break;

    case "room_create":
    case "create_room":
      handleCreateRoom(
        ws,
        data
      );
      break;

    case "room_join":
    case "join_room":
      handleJoinRoom(
        ws,
        data
      );
      break;

    case "room_leave":
    case "leave_room":
      handleLeaveRoom(
        ws
      );
      break;

    case "room_state":
      handleRoomState(
        ws
      );
      break;

    case "rooms":
    case "room_list":
      sendRooms(ws);
      break;

    case "heartbeat":
      handleHeartbeat(
        ws
      );
      break;

    default:
      send(ws, {
        type: "error",
        error:
          "Unknown message type: " +
          type
      });
      break;
  }
}

wss.on(
  "connection",
  ws => {
    const id =
      makeId();

    const player = {
      id,

      ws,

      name:
        "Player",

      avatar:
        null,

      roomId:
        null,

      position: {
        x: 0,
        y: 0,
        z: 0
      },

      rotation: {
        yaw: 0,
        pitch: 0
      },

      lastHeartbeat:
        Date.now(),

      connectedAt:
        Date.now()
    };

    ws.__playerId =
      id;

    players.set(
      id,
      player
    );

    log(
      "Player connected:",
      id
    );

    send(ws, {
      type: "welcome",

      id,

      name:
        player.name,

      avatar:
        player.avatar
    });

    sendRooms(ws);

    ws.on(
      "message",
      raw => {
        try {
          handleMessage(
            ws,
            raw
          );
        } catch (error) {
          log(
            "Message error:",
            error.message
          );

          send(ws, {
            type: "error",
            error:
              "Internal server error."
          });
        }
      }
    );

    ws.on(
      "close",
      () => {
        const current =
          getPlayer(ws);

        if (!current) {
          return;
        }

        log(
          "Player disconnected:",
          current.id
        );

        leaveRoom(
          current
        );

        players.delete(
          current.id
        );

        sendRoomsToEveryone();
      }
    );

    ws.on(
      "error",
      error => {
        log(
          "WebSocket error:",
          error.message
        );
      }
    );
  }
);

/* =========================================================
   HEARTBEAT CLEANUP
========================================================= */

setInterval(
  () => {
    const now =
      Date.now();

    for (
      const player of
        players.values()
    ) {
      if (
        now -
          player.lastHeartbeat >
        45000
      ) {
        try {
          player.ws.terminate();
        } catch {}
      }
    }
  },
  15000
);

/* =========================================================
   SERVER START
========================================================= */

server.listen(
  PORT,
  HOST,
  () => {
    log(
      "HTTP:",
      `http://${HOST}:${PORT}`
    );

    log(
      "WS:",
      `ws://${HOST}:${PORT}`
    );

    log(
      "ONLINE"
    );
  }
);

/* =========================================================
   PROCESS SAFETY
========================================================= */

process.on(
  "uncaughtException",
  error => {
    console.error(
      "[Connections] Uncaught exception:",
      error
    );
  }
);

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "[Connections] Unhandled rejection:",
      error
    );
  }
);
