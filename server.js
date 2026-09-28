'use strict';

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const CONFIG = {
  port: 8090,
  maxRooms: 100,
  maxPlayersPerRoom: 18,
  tickMs: 33,
  maxName: 16,
  maxRoomName: 32,
  maxChat: 140,
  maxAvatar: 30 * 1024,
  maxMessage: 256 * 1024,
  maxSpeed: 40,
  shotCooldown: 90,
  shotCastCooldown: 90,
  shotRange: 60,
  inputGap: 15,
  chatCooldown: 1000,
  roundPause: 3500,
  maxRoomTitleParts: 8
};

const MAX_HP = 100;

const rooms = new Map();

function randomId(length = 10) {
  return crypto
    .randomBytes(16)
    .toString('hex')
    .slice(0, length);
}

function cleanText(value, max) {
  return String(value || '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .trim()
    .slice(0, max);
}

function cleanColor(value) {
  const allowed = [
    'white',
    'red',
    'pink',
    'blue',
    'cyan',
    'green',
    'yellow',
    'orange',
    'purple',
    'gray'
  ];

  return allowed.includes(value) ? value : 'white';
}

function cleanTitleParts(parts) {
  if (!Array.isArray(parts)) return [];

  return parts
    .slice(0, CONFIG.maxRoomTitleParts)
    .map(part => ({
      text: cleanText(part && part.text, 24),
      color: cleanColor(part && part.color)
    }))
    .filter(part => part.text);
}

function makeRoomId() {
  let id;

  do {
    id = randomId(10);
  } while (rooms.has(id));

  return id;
}

function createRoom(options = {}) {
  if (rooms.size >= CONFIG.maxRooms) {
    return null;
  }

  const id = makeRoomId();

  const ctSlots = Math.max(
    1,
    Math.min(9, Number(options.ctSlots) || 5)
  );

  const tSlots = Math.max(
    1,
    Math.min(9, Number(options.tSlots) || 5)
  );

  const room = {
    id,

    name: cleanText(
      options.name || 'New Room',
      CONFIG.maxRoomName
    ) || 'New Room',

    titleParts: cleanTitleParts(options.titleParts),

    ctSlots,
    tSlots,

    players: new Map(),

    nextPlayerId: 1,

    hostId: null,

    tick: 0,

    score: {
      CT: 0,
      T: 0
    },

    round: {
      id: 1,
      phase: 'live'
    },

    roundTimer: null,

    nades: new Map(),
    nextNadeId: 1
  };

  rooms.set(id, room);

  return room;
}

function roomPlayerCount(room) {
  return room.players.size;
}

function publicRoom(room) {
  return {
    id: room.id,
    name: room.name,
    titleParts: room.titleParts,

    players: room.players.size,

    maxPlayers: room.ctSlots + room.tSlots,

    ctSlots: room.ctSlots,
    tSlots: room.tSlots,

    hostId: room.hostId,

    hostName:
      room.hostId && room.players.get(room.hostId)
        ? room.players.get(room.hostId).name
        : null
  };
}

function send(ws, data) {
  if (!ws || ws.readyState !== 1) return;

  try {
    ws.send(JSON.stringify(data));
  } catch {}
}

function broadcast(room, data, exceptId = null) {
  for (const [id, player] of room.players) {
    if (id === exceptId) continue;
    send(player.ws, data);
  }
}

function sendRoomList(ws) {
  send(ws, {
    type: 'rooms',
    rooms: [...rooms.values()].map(publicRoom)
  });
}

function broadcastRoomList() {
  const packet = {
    type: 'rooms',
    rooms: [...rooms.values()].map(publicRoom)
  };

  for (const ws of wss.clients) {
    send(ws, packet);
  }
}

function freeSlot(room, team) {
  const max = team === 'T'
    ? room.tSlots
    : room.ctSlots;

  const used = new Set();

  for (const player of room.players.values()) {
    if (player.team === team) {
      used.add(player.slot);
    }
  }

  for (let slot = 0; slot < max; slot++) {
    if (!used.has(slot)) {
      return slot;
    }
  }

  return -1;
}

function teamAliveCount(room, team) {
  let count = 0;

  for (const player of room.players.values()) {
    if (
      player.team === team &&
      player.alive
    ) {
      count++;
    }
  }

  return count;
}

function pubPlayer(player) {
  return {
    id: player.id,
    slot: player.slot,

    name: player.name,
    team: player.team,

    x: round2(player.x),
    y: round2(player.y),
    z: round2(player.z),

    yaw: round4(player.yaw),
    pitch: round4(player.pitch),

    vx: round2(player.vx),
    vy: round2(player.vy),
    vz: round2(player.vz),

    hp: player.hp,
    alive: player.alive,

    weapon: player.weapon,
    firing: player.firing,
    crouch: player.crouch,
    reloading: player.reloading,

    avatar: player.avatar || null,

    host: player.id === player.roomHost
  };
}

function round2(value) {
  value = Number(value) || 0;
  return Math.round(value * 100) / 100;
}

function round4(value) {
  value = Number(value) || 0;
  return Math.round(value * 10000) / 10000;
}

function checkRoundEnd(room, reason) {
  if (room.round.phase !== 'live') return;

  if (room.players.size < 2) return;

  const ctPlayers = [...room.players.values()]
    .filter(p => p.team === 'CT');

  const tPlayers = [...room.players.values()]
    .filter(p => p.team === 'T');

  if (!ctPlayers.length || !tPlayers.length) {
    return;
  }

  const ctAlive = teamAliveCount(room, 'CT');
  const tAlive = teamAliveCount(room, 'T');

  let winner = null;

  if (ctAlive === 0 && tAlive > 0) {
    winner = 'T';
  }

  if (tAlive === 0 && ctAlive > 0) {
    winner = 'CT';
  }

  if (!winner) return;

  room.round.phase = 'end';

  room.score[winner]++;

  broadcast(room, {
    type: 'round_end',

    round: room.round.id,

    winner,

    reason,

    score: {
      CT: room.score.CT,
      T: room.score.T
    }
  });

  if (room.roundTimer) {
    clearTimeout(room.roundTimer);
  }

  room.roundTimer = setTimeout(() => {
    startNextRound(room);
  }, CONFIG.roundPause);
}

function startNextRound(room) {
  room.roundTimer = null;

  room.round.id++;
  room.round.phase = 'live';

  for (const player of room.players.values()) {
    player.hp = MAX_HP;
    player.alive = true;

    player.vx = 0;
    player.vy = 0;
    player.vz = 0;

    player.lastMove = 0;
  }

  room.nades.clear();

  broadcast(room, {
    type: 'round_start',

    round: room.round.id,

    score: {
      CT: room.score.CT,
      T: room.score.T
    }
  });
}

function removePlayer(room, playerId) {
  const player = room.players.get(playerId);

  if (!player) return;

  room.players.delete(playerId);

  broadcast(room, {
    type: 'leave',
    id: playerId
  });

  if (room.hostId === playerId) {
    const next = room.players.values().next();

    if (!next.done) {
      const newHost = next.value;

      room.hostId = newHost.id;

      broadcast(room, {
        type: 'host_changed',
        id: newHost.id
      });
    } else {
      room.hostId = null;
    }
  }

  if (!room.players.size) {
    if (room.roundTimer) {
      clearTimeout(room.roundTimer);
      room.roundTimer = null;
    }

    rooms.delete(room.id);
  } else {
    checkRoundEnd(room, 'leave');
  }

  broadcastRoomList();
}

function joinRoom(room, ws, data) {
  if (room.players.size >= room.ctSlots + room.tSlots) {
    send(ws, {
      type: 'error',
      error: 'room-full'
    });

    return null;
  }

  const team =
    data.team === 'T'
      ? 'T'
      : 'CT';

  const slot = freeSlot(room, team);

  if (slot < 0) {
    send(ws, {
      type: 'error',
      error: 'team-full'
    });

    return null;
  }

  const id = room.nextPlayerId++;

  const player = {
    id,

    name: cleanText(
      data.name || 'Player',
      CONFIG.maxName
    ) || 'Player',

    team,

    slot,

    x: 0,
    y: 0,
    z: 0,

    yaw: 0,
    pitch: 0,

    vx: 0,
    vy: 0,
    vz: 0,

    hp: MAX_HP,
    alive: true,

    weapon: 'ak47',
    firing: false,
    crouch: false,
    reloading: false,

    avatar:
      typeof data.avatar === 'string' &&
      data.avatar.startsWith('data:image/') &&
      data.avatar.length <= CONFIG.maxAvatar
        ? data.avatar
        : null,

    ws,

    roomHost: room.hostId,

    lastInput: 0,
    lastMove: 0,
    lastShot: 0,
    lastShotCast: 0,
    lastChat: 0
  };

  room.players.set(id, player);

  if (!room.hostId) {
    room.hostId = id;
    player.roomHost = id;
  }

  send(ws, {
    type: 'welcome',

    id,

    roomId: room.id,

    hostId: room.hostId
  });

  send(ws, {
    type: 'room_info',
    room: publicRoom(room)
  });

  send(ws, {
    type: 'roster',

    players: [...room.players.values()].map(pubPlayer)
  });

  send(ws, {
    type: 'round_start',

    round: room.round.id,

    score: {
      CT: room.score.CT,
      T: room.score.T
    },

    resumed: true
  });

  broadcast(
    room,
    {
      type: 'join',
      player: pubPlayer(player)
    },
    id
  );

  broadcastRoomList();

  return player;
}

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });

  res.end(
    JSON.stringify({
      name: 'Connections Multiplayer Server',
      status: 'online',
      rooms: rooms.size,
      players: [...rooms.values()]
        .reduce((sum, room) => sum + room.players.size, 0)
    })
  );
});

const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: CONFIG.maxMessage
});

wss.on('connection', ws => {
  try {
    ws._socket.setNoDelay(true);
  } catch {}

  let room = null;
  let player = null;

  sendRoomList(ws);

  ws.on('message', raw => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!msg || typeof msg.type !== 'string') {
      return;
    }

    if (msg.type === 'ping') {
      send(ws, {
        type: 'pong',
        t: msg.t
      });

      return;
    }

    if (msg.type === 'rooms') {
      sendRoomList(ws);
      return;
    }

    if (msg.type === 'create_room') {
      if (room) {
        send(ws, {
          type: 'error',
          error: 'already-in-room'
        });

        return;
      }

      const newRoom = createRoom({
        name: msg.name,
        titleParts: msg.titleParts,
        ctSlots: msg.ctSlots,
        tSlots: msg.tSlots
      });

      if (!newRoom) {
        send(ws, {
          type: 'error',
          error: 'room-limit'
        });

        return;
      }

      room = newRoom;

      player = joinRoom(
        room,
        ws,
        {
          name: msg.playerName,
          team: msg.team,
          avatar: msg.avatar
        }
      );

      if (!player) {
        rooms.delete(newRoom.id);
        room = null;
        return;
      }

      send(ws, {
        type: 'created',
        room: publicRoom(room)
      });

      return;
    }

    if (msg.type === 'join_room') {
      if (room) {
        send(ws, {
          type: 'error',
          error: 'already-in-room'
        });

        return;
      }

      const roomId = String(
        msg.roomId ||
        msg.room ||
        ''
      );

      const target = rooms.get(roomId);

      if (!target) {
        send(ws, {
          type: 'error',
          error: 'room-not-found'
        });

        return;
      }

      room = target;

      player = joinRoom(
        room,
        ws,
        {
          name: msg.name,
          team: msg.team,
          avatar: msg.avatar
        }
      );

      if (!player) {
        room = null;
      }

      return;
    }

    if (msg.type === 'leave_room') {
      if (room && player) {
        const oldRoom = room;
        const oldId = player.id;

        room = null;
        player = null;

        removePlayer(oldRoom, oldId);
      }

      return;
    }

    if (!room || !player) {
      return;
    }

    if (msg.type === 'kick') {
      if (player.id !== room.hostId) {
        send(ws, {
          type: 'error',
          error: 'not-host'
        });

        return;
      }

      const targetId = Number(msg.targetId);

      if (!Number.isInteger(targetId)) {
        return;
      }

      if (targetId === player.id) {
        return;
      }

      const target = room.players.get(targetId);

      if (!target) {
        return;
      }

      send(target.ws, {
        type: 'kicked',
        reason: 'host'
      });

      const targetRoom = room;

      removePlayer(targetRoom, targetId);

      return;
    }

    if (msg.type === 'input') {
      if (!msg.state || typeof msg.state !== 'object') {
        return;
      }

      const now = Date.now();

      if (
        now - player.lastInput <
        CONFIG.inputGap
      ) {
        return;
      }

      player.lastInput = now;

      const state = msg.state;

      let nx = player.x;
      let ny = player.y;
      let nz = player.z;

      if (Number.isFinite(state.x)) nx = state.x;
      if (Number.isFinite(state.y)) ny = state.y;
      if (Number.isFinite(state.z)) nz = state.z;

      const dx = nx - player.x;
      const dy = ny - player.y;
      const dz = nz - player.z;

      const distance = Math.sqrt(
        dx * dx +
        dy * dy +
        dz * dz
      );

      const dt = player.lastMove
        ? Math.max(1, now - player.lastMove) / 1000
        : 0;

      if (
        !dt ||
        distance / dt <= CONFIG.maxSpeed
      ) {
        if (dt > 0 && dt < 1) {
          player.vx = dx / dt;
          player.vy = dy / dt;
          player.vz = dz / dt;
        }

        player.x = nx;
        player.y = ny;
        player.z = nz;

        player.lastMove = now;
      }

      if (Number.isFinite(state.yaw)) {
        player.yaw = state.yaw;
      }

      if (Number.isFinite(state.pitch)) {
        player.pitch = state.pitch;
      }

      if (typeof state.weapon === 'string') {
        player.weapon = state.weapon.slice(0, 32);
      }

      if (typeof state.firing === 'boolean') {
        player.firing = state.firing;
      }

      if (typeof state.crouch === 'boolean') {
        player.crouch = state.crouch;
      }

      if (typeof state.reloading === 'boolean') {
        player.reloading = state.reloading;
      }

      if (state.alive === false && player.alive) {
        player.alive = false;
        player.hp = 0;

        broadcast(room, {
          type: 'damage',

          targetId: player.id,

          hp: 0,

          alive: false,

          by: player.id,

          self: true
        });

        checkRoundEnd(
          room,
          'elimination'
        );
      }

      return;
    }

    if (msg.type === 'shot') {
      const now = Date.now();

      if (
        now - player.lastShotCast <
        CONFIG.shotCastCooldown
      ) {
        return;
      }

      player.lastShotCast = now;

      if (!msg.origin || !msg.dir) {
        return;
      }

      broadcast(
        room,
        {
          type: 'shot',

          by: player.id,

          weapon:
            String(
              msg.weapon ||
              player.weapon ||
              ''
            ).slice(0, 24),

          origin: {
            x: Number(msg.origin.x) || 0,
            y: Number(msg.origin.y) || 0,
            z: Number(msg.origin.z) || 0
          },

          dir: {
            x: Number(msg.dir.x) || 0,
            y: Number(msg.dir.y) || 0,
            z: Number(msg.dir.z) || 0
          },

          t: now
        },
        player.id
      );

      return;
    }

    if (msg.type === 'hit') {
      const targetId = Number(msg.targetId);

      const victim =
        room.players.get(targetId);

      if (!victim) return;

      if (!victim.alive) return;

      if (!player.alive) return;

      if (victim.team === player.team) {
        return;
      }

      const dx = victim.x - player.x;
      const dy = victim.y - player.y;
      const dz = victim.z - player.z;

      if (
        dx * dx +
        dy * dy +
        dz * dz >
        CONFIG.shotRange *
        CONFIG.shotRange
      ) {
        return;
      }

      const now = Date.now();

      if (
        now - player.lastShot <
        CONFIG.shotCooldown
      ) {
        return;
      }

      player.lastShot = now;

      const damage = Math.max(
        1,
        Math.min(
          150,
          Number(msg.damage) || 1
        )
      );

      victim.hp -= damage;

      if (victim.hp <= 0) {
        victim.hp = 0;
        victim.alive = false;
      }

      broadcast(room, {
        type: 'damage',

        targetId: victim.id,

        hp: victim.hp,

        alive: victim.alive,

        by: player.id,

        head: !!msg.head,

        weapon: player.weapon
      });

      if (!victim.alive) {
        checkRoundEnd(
          room,
          'elimination'
        );
      }

      return;
    }

    if (msg.type === 'respawn') {
      player.hp = MAX_HP;
      player.alive = true;

      broadcast(room, {
        type: 'damage',

        targetId: player.id,

        hp: MAX_HP,

        alive: true,

        by: player.id,

        respawn: true
      });

      return;
    }

    if (
      msg.type === 'switch' &&
      typeof msg.team === 'string'
    ) {
      const team =
        msg.team === 'T'
          ? 'T'
          : 'CT';

      if (team === player.team) {
        return;
      }

      const slot =
        freeSlot(room, team);

      if (slot < 0) {
        send(ws, {
          type: 'error',
          error: 'team-full'
        });

        return;
      }

      player.team = team;
      player.slot = slot;

      broadcast(room, {
        type: 'move',

        player: pubPlayer(player)
      });

      checkRoundEnd(
        room,
        'switch'
      );

      return;
    }

    if (
      msg.type === 'chat' &&
      typeof msg.text === 'string'
    ) {
      const now = Date.now();

      if (
        now - player.lastChat <
        CONFIG.chatCooldown
      ) {
        return;
      }

      player.lastChat = now;

      const text =
        cleanText(
          msg.text,
          CONFIG.maxChat
        );

      if (!text) return;

      const scope =
        msg.scope === 'team'
          ? 'team'
          : 'all';

      const packet = {
        type: 'chat',

        from: player.id,

        name: player.name,

        team: player.team,

        scope,

        text,

        t: now
      };

      if (scope === 'team') {
        for (const other of room.players.values()) {
          if (other.team === player.team) {
            send(other.ws, packet);
          }
        }
      } else {
        broadcast(room, packet);
      }

      return;
    }
  });

  ws.on('close', () => {
    if (!room || !player) {
      return;
    }

    const oldRoom = room;
    const oldId = player.id;

    room = null;
    player = null;

    removePlayer(
      oldRoom,
      oldId
    );
  });

  ws.on('error', () => {});
});

setInterval(() => {
  const now = Date.now();

  for (const room of rooms.values()) {
    if (!room.players.size) {
      continue;
    }

    room.tick++;

    const snapshot = {
      type: 'snap',

      tick: room.tick,

      t: now,

      round: room.round.id,

      score: {
        CT: room.score.CT,
        T: room.score.T
      },

      players:
        [...room.players.values()]
          .map(pubPlayer)
    };

    broadcast(room, snapshot);
  }
}, CONFIG.tickMs);

httpServer.listen(
  CONFIG.port,
  '0.0.0.0',
  () => {
    console.log('');
    console.log('====================================');
    console.log(' Connections Multiplayer Server');
    console.log('====================================');
    console.log(
      'HTTP : http://0.0.0.0:' +
      CONFIG.port
    );
    console.log(
      'WS   : ws://0.0.0.0:' +
      CONFIG.port
    );
    console.log(
      'Tick : ' +
      CONFIG.tickMs +
      'ms'
    );
    console.log('');
    console.log(
      'Start with: node server.js'
    );
    console.log(
      'Cloudflare Tunnel should point to:'
    );
    console.log(
      'http://localhost:' +
      CONFIG.port
    );
    console.log('====================================');
    console.log('');
  }
);
