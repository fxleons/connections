// ==UserScript==
// @name         Connections
// @namespace    conn
// @version      1.1.0
// @description  clutcher.io multiply players
// @match        *://clutcher.io/*
// @match        *://*.clutcher.io/*
// @grant        unsafeWindow
// @grant        GM_addStyle
// @connect      soil-certain-cement-dakota.trycloudflare.com
// ==/UserScript==

(() => {
  "use strict";

  const PAGE = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

  const CONFIG = {
    VERSION: "1.1.0",
    WS_URL: "wss://soil-certain-cement-dakota.trycloudflare.com",
    SEND_RATE: 50,
    INTERPOLATION: 100,
    MAX_REMOTE_BOTS: 32,
    MATCH_CHECK_RATE: 250,
    AVATAR_MAX_BYTES: 700000,
    AVATAR_SEND_INTERVAL: 3000
  };

  const State = {
    ws: null,
    connected: false,
    connecting: false,
    id: null,
    name: "Player",
    room: null,
    rooms: [],
    remotes: new Map(),
    game: null,
    confirmedMatch: false,
    preparingBots: false,
    matchEnding: false,
    outsideMatchSince: 0,
    isHost: false,
    originalBots: [],
    originalBotArray: null,
    botTemplate: null,
    botCtor: null,
    avatar: null,
    avatarEnabled: true,
    avatarDirty: true,
    lastAvatarSent: 0,
    ui: { open: false },
    profile: null,
    roomData: null,
    cheatTimer: null,
    cheatSig: "",
    sendTimer: null,
    monitorTimer: null,
    avatarTimer: null,
    visibilityTimer: null,
    matchSync: {
      hostId: null,
      roundSeq: 0,
      lastActive: null,
      roundEndAt: 0,
      endAt: 0,
      lastReceived: 0
    },
    hostRoundSeq: 0,
    hostLastActive: null,
    hostRoundEndAt: 0,
    hostEndAt: 0
  };

  function log(...a) { console.log("[Connections]", ...a); }
  function warn(...a) { console.warn("[Connections]", ...a); }
  function error(...a) { console.error("[Connections]", ...a); }

  function getGame() {
    try { if (PAGE.game) return PAGE.game; } catch {}
    try { if (window.game) return window.game; } catch {}
    return null;
  }

  function getPlayer() {
    const game = getGame();
    return game ? game.player || null : null;
  }

  function roomId(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (typeof value === "object") {
      return String(value.id ?? value.roomId ?? value._id ?? value.code ?? "") || null;
    }
    return null;
  }

  function getRoomObject(value) {
    if (!value) return null;
    if (typeof value === "object") return value;
    const id = String(value);
    if (State.roomData && String(roomId(State.roomData)) === id) return State.roomData;
    return State.rooms.find(r => String(r.id ?? r.roomId ?? "") === id) || null;
  }

function isInsideMatch(game = getGame()) {
  if (!game) return false;

  /*
   * Prefer Clutcher's own explicit match flags
   * when they're available.
   */
  try {
    if (typeof game.isInMatch === "function") {
      const r = game.isInMatch();

      if (r === true) {
        return true;
      }
    }
  } catch {}

  try {
    if (
      game.gameState === "playing" ||
      game.gameState === "teamselect"
    ) {
      return true;
    }
  } catch {}

  try {
    if (
      game.state === "playing" ||
      game.state === "teamselect"
    ) {
      return true;
    }
  } catch {}

  try {
    if (game.inMatch === true) {
      return true;
    }
  } catch {}

  try {
    if (
      game.match &&
      game.match.isStarted === true
    ) {
      return true;
    }
  } catch {}

  /*
   * Native structural fallback.
   *
   * During map/round rebuilds Clutcher can stop
   * exposing the high-level state above even
   * though the actual playable game has returned.
   */
  try {
    const player = game.player;

    if (
      player &&
      Number.isFinite(Number(player.x)) &&
      Number.isFinite(Number(player.y)) &&
      Number.isFinite(Number(player.z))
    ) {
      /*
       * These are native match systems we've
       * already seen Connections interact with.
       */
      const hasRoundSystem =
        typeof game.startRound === "function" ||
        typeof game.endRound === "function" ||
        typeof game.dealDamage === "function";

      if (hasRoundSystem) {
        return true;
      }
    }
  } catch {}

  return false;
}

  function getName() {
    try {
      const saved = localStorage.getItem("connections_player_name");
      if (saved && saved.trim()) return saved.trim();
    } catch {}

    let name = "Player";

    try {
      const input = prompt("Connections username:", "Player");
      if (input && input.trim()) name = input.trim().slice(0, 24);
    } catch {}

    try {
      localStorage.setItem("connections_player_name", name);
    } catch {}

    return name;
  }

  State.name = getName();

  function sendJSON(data) {
    if (!State.ws || State.ws.readyState !== WebSocket.OPEN) return false;

    try {
      State.ws.send(JSON.stringify(data));
      return true;
    } catch (e) {
      warn("WebSocket send failed:", e);
      return false;
    }
  }

  function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeTeam(team) {
    const t = String(team || "").toUpperCase();
    return t === "T" || t === "TERRORIST" ? "T" : "CT";
  }

  function getVectorPosition(object) {
    if (!object) return { x: 0, y: 0, z: 0 };

    let x = safeNumber(object.x, NaN);
    let y = safeNumber(object.y, NaN);
    let z = safeNumber(object.z, NaN);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      try {
        if (object.position) {
          x = safeNumber(object.position.x, 0);
          y = safeNumber(object.position.y, 0);
          z = safeNumber(object.position.z, 0);
        }
      } catch {}
    }

    return {
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
      z: Number.isFinite(z) ? z : 0
    };
  }

  function getYaw(object) {
    if (!object) return 0;

    for (const value of [object.yaw, object.rotationY, object.rotY]) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }

    try {
      if (object.rotation) {
        const n = Number(object.rotation.y);
        if (Number.isFinite(n)) return n;
      }
    } catch {}

    return 0;
  }

  function getPitch(object) {
    if (!object) return 0;

    for (const value of [
      object.pitch,
      object.lookPitch,
      object._lookPitch,
      object.rotationX,
      object.rotX
    ]) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }

    return 0;
  }

  function getVelocity(object) {
    if (!object) return { x: 0, y: 0, z: 0 };

    let vx = safeNumber(object.vx, NaN);
    let vy = safeNumber(object.vy, NaN);
    let vz = safeNumber(object.vz, NaN);

    try {
      if (object.velocity) {
        vx = safeNumber(object.velocity.x, 0);
        vy = safeNumber(object.velocity.y, 0);
        vz = safeNumber(object.velocity.z, 0);
      }
    } catch {}

    return {
      x: Number.isFinite(vx) ? vx : 0,
      y: Number.isFinite(vy) ? vy : 0,
      z: Number.isFinite(vz) ? vz : 0
    };
  }

  function getAlive(object) {
    if (!object) return false;
    if (typeof object.alive === "boolean") return object.alive;
    if (typeof object.dead === "boolean") return !object.dead;
    if (typeof object.health === "number") return object.health > 0;
    return true;
  }

  function getOnGround(object) {
    if (!object) return false;
    if (typeof object.onGround === "boolean") return object.onGround;
    if (typeof object.grounded === "boolean") return object.grounded;
    if (typeof object.isGrounded === "boolean") return object.isGrounded;
    return false;
  }

  function getCrouching(object) {
    if (!object) return false;
    return !!(object.crouching || object.crouched || object.isCrouching);
  }

  function getTeam(object) {
    if (!object) return "CT";
    return normalizeTeam(object.team || object.side || object.teamName);
  }

  function setTransform(object, x, y, z) {
    if (!object) return;

    try {
      object.x = x;
      object.y = y;
      object.z = z;
    } catch {}

    try {
      if (object.position) {
        object.position.x = x;
        object.position.y = y;
        object.position.z = z;
      }
    } catch {}
  }

  function setRotation(object, yaw, pitch) {
    if (!object) return;

    try { object.yaw = yaw; } catch {}
    try { object.rotationY = yaw; } catch {}
    try { object.rotY = yaw; } catch {}
    try { object.pitch = pitch; } catch {}
    try { object.lookPitch = pitch; } catch {}
    try { object._lookPitch = pitch; } catch {}
    try { if (object.rotation) object.rotation.y = yaw; } catch {}
  }

  function setVelocity(object, vx, vy, vz) {
    if (!object) return;

    try {
      object.vx = vx;
      object.vy = vy;
      object.vz = vz;
    } catch {}

    try {
      if (object.velocity) {
        object.velocity.x = vx;
        object.velocity.y = vy;
        object.velocity.z = vz;
      }
    } catch {}
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  const Avatar = {
    storeKey: "pp-avatar",
    stateKey: "pp-avatar-on",

    load() {
      try {
        const value = localStorage.getItem(this.storeKey);
        if (value && typeof value === "string") State.avatar = value;
      } catch {}

      try {
        State.avatarEnabled = localStorage.getItem(this.stateKey) !== "false";
      } catch {
        State.avatarEnabled = true;
      }

      State.avatarDirty = true;
    },

    isValid(value) {
      if (typeof value !== "string") return false;
      if (!value.startsWith("data:image/")) return false;
      return value.length <= CONFIG.AVATAR_MAX_BYTES;
    },

    async readFile(file) {
      if (!file) return null;

      if (!String(file.type || "").startsWith("image/")) {
        throw new Error("Please choose an image.");
      }

      if (file.size > CONFIG.AVATAR_MAX_BYTES) {
        throw new Error("Avatar is too large.");
      }

      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read avatar."));
        reader.readAsDataURL(file);
      });
    },

    async setFile(file) {
      try {
        const data = await this.readFile(file);

        if (!this.isValid(data)) {
          throw new Error("Invalid avatar.");
        }

        State.avatar = data;
        State.avatarEnabled = true;
        State.avatarDirty = true;

        try {
          localStorage.setItem(this.storeKey, data);
          localStorage.setItem(this.stateKey, "true");
        } catch {}

        UI.setMessage("Avatar updated.");
        UI.updateAvatarControls();
        RemoteBots.rebuildAvatars();
      } catch (e) {
        UI.setMessage(e?.message || "Avatar failed.");
      }
    },

    toggle() {
      State.avatarEnabled = !State.avatarEnabled;
      State.avatarDirty = true;

      try {
        localStorage.setItem(
          this.stateKey,
          State.avatarEnabled ? "true" : "false"
        );
      } catch {}

      RemoteBots.rebuildAvatars();
      UI.updateAvatarControls();
    },

    reset() {
      State.avatar = null;
      State.avatarEnabled = true;
      State.avatarDirty = true;

      try {
        localStorage.removeItem(this.storeKey);
        localStorage.setItem(this.stateKey, "true");
      } catch {}

      RemoteBots.rebuildAvatars();
      UI.updateAvatarControls();
      UI.setMessage("Avatar reset.");
    }
  };

  Avatar.load();

  const Network = {
    connect() {
      if (State.connected || State.connecting) return;
      if (!State.confirmedMatch) return;

      State.connecting = true;
      UI.updateStatus("Connecting...");
      log("Connecting:", CONFIG.WS_URL);

      let ws = null;

      try {
        ws = new WebSocket(CONFIG.WS_URL);
      } catch (e) {
        State.connecting = false;
        error("WebSocket creation failed:", e);
        UI.updateStatus("Connection failed");
        return;
      }

      State.ws = ws;

      ws.onopen = () => {
        State.connecting = false;
        State.connected = true;

        UI.updateStatus("Connected");
        log("WebSocket connected.");

        this.send({
          type: "hello",
          name: State.name,
          token: getRafitToken()
        });

        this.send({ type: "list_rooms" });
        startSync();
      };

      ws.onmessage = event => {
        let data = null;

        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }

        this.handle(data);
      };

      ws.onerror = event => {
        warn("WebSocket error:", event);
        UI.updateStatus("Socket error");
      };

      ws.onclose = () => {
        const wasConnected = State.connected;

        State.connected = false;
        State.connecting = false;
        State.ws = null;

        stopSync();
        UI.updateStatus("Disconnected");

        if (wasConnected) log("WebSocket disconnected.");
      };
    },

    disconnect() {
      if (State.ws) {
        try {
          State.ws.close();
        } catch {}
      }

      State.ws = null;
      State.connected = false;
      State.connecting = false;

      stopSync();
    },

    send(data) {
      return sendJSON(data);
    },

    handle(data) {
      if (!data || typeof data !== "object") return;

      const type = String(data.type || "");

      switch (type) {
        case "connected": {
          if (data.id) {
            State.id = String(data.id);
            log("Assigned ID:", State.id);
          }

          if (data.profile) {
            UI.setMessage(
              `RTP: ${safeNumber(data.profile.rtp, 1000)}`
            );
          }

          break;
        }

        case "hello": {
          if (data.id && !State.id) {
            State.id = String(data.id);
          }

          break;
        }

        case "rooms": {
          State.rooms = Array.isArray(data.rooms) ? data.rooms : [];
          UI.renderRooms();
          break;
        }

        case "room_snapshot": {
          if (Array.isArray(data.rooms)) {
            State.rooms = data.rooms;
            UI.renderRooms();
          }

          break;
        }

        case "room_joined": {
          const id = roomId(data.room || data.roomId);

          if (id) State.room = id;

          State.isHost = !!data.isHost;
          State.roomData =
            data.room && typeof data.room === "object"
              ? data.room
              : null;

          UI.renderRoom();
          log("Joined room:", State.room);

          break;
        }

        case "player_joined": {
          if (data.player) {
            RemoteBots.receive(data.player);
          }

          UI.renderRoom();
          break;
        }

        case "player_left": {
          const id = data.id || data.playerId;

          if (id) {
            RemoteBots.remove(id);
          }

          UI.renderRoom();
          break;
        }

        case "state": {
          this.receiveState(data);
          break;
        }

        case "left_room": {
          State.room = null;
          State.isHost = false;

          RemoteBots.clear();
          UI.renderRoom();

          break;
        }

        case "room_deleted": {
          const deleted = roomId(data.room || data.roomId);

          if (
            deleted &&
            String(State.room) === String(deleted)
          ) {
            State.room = null;
            State.isHost = false;

            RemoteBots.clear();
            UI.renderRoom();
          }

          State.rooms = State.rooms.filter(
            r =>
              String(r.id ?? r.roomId ?? "") !==
              String(deleted)
          );

          UI.renderRooms();
          break;
        }

        case "room_update": {
          if (data.room) {
            const id = roomId(data.room);

            const index = State.rooms.findIndex(
              r =>
                String(r.id ?? r.roomId ?? "") ===
                String(id)
            );

            if (index !== -1) {
              State.rooms[index] = data.room;
            } else {
              State.rooms.push(data.room);
            }

            if (
              State.room &&
              String(id) === String(State.room)
            ) {
              State.roomData = data.room;
              UI.renderRoom();
            }

            UI.renderRooms();
          }

          break;
        }

        case "chat": {
          UI.addChatMessage(data);
          break;
        }

        case "round_state":
        case "round": {
          applyMatchSnapshot(data);
          break;
        }

        case "music_event":
        case "music_kit": {
          Music.handleNetwork(data);
          break;
        }

        case "head_boost": {
          HeadBoost.receive(data);
          break;
        }

        case "rafit_profile": {
          if (data.profile) {
            State.profile = data.profile;
            UI.renderStatus();
          }

          if (data.penalty) {
            UI.setMessage(
              `RAFIT penalty: ${data.penalty.reason} (RTP ${data.penalty.rtp})`
            );
          }

          break;
        }

        case "rafit_ban": {
          UI.setMessage(
            "RAFIT ban until " +
              new Date(
                safeNumber(data.bannedUntil, 0)
              ).toLocaleString()
          );

          break;
        }

        case "rafit_flag":
        case "rafit_movement":
        case "pong":
          break;

        case "error": {
          UI.setMessage(
            data.message ||
              data.error ||
              "Server error."
          );

          warn("Server error:", data);
          break;
        }

        default:
          break;
      }
    },

    receiveState(data) {
      const id =
        data.id ||
        data.playerId ||
        data.senderId ||
        data.state?.id;

      if (
        !id ||
        String(id) === String(State.id)
      ) {
        return;
      }

      const state = data.state || data;

      RemoteBots.receive({
        id: String(id),
        name: state.name || data.name || "Player",
        team: normalizeTeam(
          state.team || data.team
        ),

        x: safeNumber(state.x, 0),
        y: safeNumber(state.y, 0),
        z: safeNumber(state.z, 0),

        yaw: safeNumber(state.yaw, 0),
        pitch: safeNumber(state.pitch, 0),

        vx: safeNumber(state.vx, 0),
        vy: safeNumber(state.vy, 0),
        vz: safeNumber(state.vz, 0),

        onGround: !!state.onGround,
        crouching: !!state.crouching,
        alive: state.alive !== false,

        avatar:
          state.avatar ??
          data.avatar ??
          null,

        avatarEnabled:
          state.avatarEnabled !== false
      });
    }
  };

  function buildLocalState() {
    const game = getGame();
    const player = getPlayer();

    if (!game || !player) return null;

    const position = getVectorPosition(player);
    const velocity = getVelocity(player);

    const sendAvatar =
      State.avatarDirty ||
      Date.now() - State.lastAvatarSent >=
        CONFIG.AVATAR_SEND_INTERVAL;

    return {
      x: position.x,
      y: position.y,
      z: position.z,

      yaw: getYaw(player),
      pitch: getPitch(player),

      vx: velocity.x,
      vy: velocity.y,
      vz: velocity.z,

onGround: getOnGround(player),
crouching: getCrouching(player),
alive: getAlive(player),

health: clamp(
  safeNumber(
    player.health,
    getAlive(player) ? 100 : 0
  ),
  0,
  100
),

team: getTeam(player),
name: State.name,

      avatar: sendAvatar
        ? State.avatarEnabled
          ? State.avatar
          : null
        : undefined,

      avatarEnabled: State.avatarEnabled
    };
  }

  function sendLocalState() {
    if (
      !State.confirmedMatch ||
      !State.connected ||
      !State.room
    ) {
      return;
    }

    const game = getGame();

    if (!game || !isInsideMatch(game)) {
      return;
    }

    const state = buildLocalState();

    if (!state) return;

    const sent = Network.send({
      type: "state",
      state
    });

    if (
      sent &&
      state.avatar !== undefined
    ) {
      State.avatarDirty = false;
      State.lastAvatarSent = Date.now();
    }
  }

  function startSync() {
    stopSync();

    State.sendTimer = setInterval(
      sendLocalState,
      CONFIG.SEND_RATE
    );
  }

  function stopSync() {
    if (State.sendTimer) {
      clearInterval(State.sendTimer);
      State.sendTimer = null;
    }
  }
  /* =========================================================
   * MATCH / ROUND SYNC
   * ========================================================= */

  function getRoundSnapshot() {
    const game = getGame();
    if (!game) return null;

    let active = false;

    try {
      active = game.roundActive === true;
    } catch {}

    try {
      if (!active && game.gameState === "playing") {
        active = true;
      }
    } catch {}

    const now = Date.now();

    if (active) {
      const remaining = Math.max(
        0,
        safeNumber(game.roundTimeLeft, 0)
      );

      if (
        State.hostLastActive !== true ||
        !State.hostRoundEndAt
      ) {
        State.hostRoundEndAt =
          now + remaining * 1000;
      }

      State.hostEndAt = 0;
    } else {
      const remaining = Math.max(
        0,
        safeNumber(game.endT, 0)
      );

      if (
        State.hostLastActive !== false ||
        !State.hostEndAt
      ) {
        State.hostEndAt =
          now + remaining * 1000;
      }

      State.hostRoundEndAt = 0;
    }

    return {
      active,
      roundSeq: State.hostRoundSeq,
      roundEndAt: State.hostRoundEndAt,
      endAt: State.hostEndAt
    };
  }

  function broadcastRoundState() {
    if (
      !State.isHost ||
      !State.connected ||
      !State.room
    ) {
      return;
    }

    const snapshot = getRoundSnapshot();

    if (!snapshot) return;

    const active = snapshot.active;

    if (State.hostLastActive !== active) {
      State.hostLastActive = active;
      State.hostRoundSeq++;
      snapshot.roundSeq =
        State.hostRoundSeq;
    }

    State.hostRoundEndAt =
      snapshot.roundEndAt;

    State.hostEndAt =
      snapshot.endAt;

    Network.send({
      type: "round_state",
      active: snapshot.active,
      roundSeq: snapshot.roundSeq,
      roundEndAt: snapshot.roundEndAt,
      endAt: snapshot.endAt
    });
  }

  function applyMatchAuthoritative(snapshot) {
    const game = getGame();

    if (
      !game ||
      !snapshot ||
      State.isHost
    ) {
      return;
    }

    const active =
      snapshot.active === true;

    const seq =
      Number(snapshot.roundSeq) || 0;

    const now = Date.now();

    if (
      State.matchSync.lastActive !== null &&
      State.matchSync.lastActive !== active
    ) {
      try {
        if (active) {
          if (
            typeof game.startRound ===
            "function"
          ) {
            game.startRound();
          } else {
            game.roundActive = true;
          }
        } else {
          if (
            typeof game.endRound ===
            "function"
          ) {
            game.endRound();
          } else {
            game.roundActive = false;
          }
        }
      } catch (e) {
        warn(
          "Match transition sync failed:",
          e
        );
      }
    }

    State.matchSync.lastActive = active;
    State.matchSync.roundSeq = seq;
    State.matchSync.lastReceived = now;

    State.matchSync.roundEndAt =
      Number(snapshot.roundEndAt) || 0;

    State.matchSync.endAt =
      Number(snapshot.endAt) || 0;

    try {
      if (active) {
        const remaining = Math.max(
          0,
          (
            State.matchSync.roundEndAt -
            now
          ) / 1000
        );

        game.roundActive = true;
        game.roundTimeLeft = remaining;
        game.endT = 0;
      } else {
        const remaining = Math.max(
          0,
          (
            State.matchSync.endAt -
            now
          ) / 1000
        );

        game.roundActive = false;
        game.roundTimeLeft = 0;
        game.endT = remaining;
      }

      if (game.hud) {
        if (
          typeof game.hud.updateHealth ===
          "function"
        ) {
          game.hud.updateHealth();
        }
      }
    } catch {}
  }

  function applyAuthoritativeMatchState() {
    if (
      !State.room ||
      !State.connected ||
      State.isHost
    ) {
      return;
    }

    if (!State.matchSync.lastReceived) {
      return;
    }

    applyMatchAuthoritative({
      active:
        State.matchSync.lastActive,

      roundSeq:
        State.matchSync.roundSeq,

      roundEndAt:
        State.matchSync.roundEndAt,

      endAt:
        State.matchSync.endAt
    });
  }

  function applyMatchSnapshot(snapshot) {
    applyMatchAuthoritative(snapshot);
  }

  /* =========================================================
   * HEAD BOOST
   * ========================================================= */

  const HeadBoost = {
    receive(data) {
      if (
        !data ||
        !data.targetId
      ) {
        return;
      }

      const target =
        State.remotes.get(
          String(data.targetId)
        );

      if (!target) return;

      target.headBoost = {
        active:
          data.active !== false,

        carrierId:
          data.carrierId || null
      };
    },

    send(
      targetId,
      active,
      carrierId
    ) {
      if (
        !State.connected ||
        !State.room
      ) {
        return;
      }

      Network.send({
        type: "head_boost",

        targetId:
          String(targetId),

        active:
          !!active,

        carrierId:
          carrierId
            ? String(carrierId)
            : null
      });
    }
  };

  /* =========================================================
   * MUSIC
   * ========================================================= */

  const Music = {
    current: null,
    audio: null,

    stop() {
      if (this.audio) {
        try {
          this.audio.pause();
          this.audio.currentTime = 0;
        } catch {}
      }

      this.audio = null;
      this.current = null;
    },

    play(url) {
      this.stop();

      if (
        !url ||
        typeof url !== "string" ||
        !/^https:\/\//i.test(url)
      ) {
        return;
      }

      try {
        const audio =
          new Audio(url);

        audio.volume = 0.75;
        audio.loop = false;

        this.audio = audio;
        this.current = url;

        const promise =
          audio.play();

        if (
          promise &&
          typeof promise.catch ===
            "function"
        ) {
          promise.catch(() => {});
        }
      } catch {}
    },

    handleNetwork(data) {
      if (!data) return;

      const event =
        String(
          data.event ||
          data.action ||
          ""
        );

      if (
        event === "stop" ||
        data.stop === true
      ) {
        this.stop();
        return;
      }

      if (data.url) {
        this.play(data.url);
      }
    },

    stopForMatchEnd() {
      this.stop();
    }
  };

  /* =========================================================
   * REMOTE BOT SYSTEM
   * ========================================================= */

  const RemoteBots = {
    preparePool() {
      const game = getGame();
      const mgr = game?.botMgr;

      if (
        !mgr ||
        !Array.isArray(mgr.bots)
      ) {
        warn(
          "botMgr.bots unavailable."
        );

        return false;
      }

      if (State.preparingBots) {
        return true;
      }

      if (State.botCtor) {
        return true;
      }

      State.preparingBots = true;

      const existingBots =
        [...mgr.bots];

      State.originalBotArray =
        mgr.bots;

      State.originalBots =
        existingBots;

      State.botTemplate =
        existingBots[0] || null;

      log(
        "Preparing native bot system:",
        existingBots.length
      );

      if (
        !State.botCtor &&
        !existingBots.length
      ) {
        try {
          const player =
            getPlayer();

          const team =
            player?.team === "T"
              ? "T"
              : "CT";

          if (
            typeof mgr.setup ===
            "function"
          ) {
            log(
              "No native bots present. Bootstrapping one temporary native bot to capture the constructor."
            );

            mgr.setup(
              1,
              3,
              team
            );

            const bootstrap =
              mgr.bots.find(
                b =>
                  b &&
                  b.team !==
                    undefined &&
                  typeof b.constructor ===
                    "function"
              );

            if (bootstrap) {
              State.botCtor =
                bootstrap.constructor;

              log(
                "REAL BOT CONSTRUCTOR CAPTURED:",
                State.botCtor.name ||
                  "(anonymous)"
              );
            }

            for (
              const bot of [
                ...mgr.bots
              ]
            ) {
              try {
                bot.alive = false;
                bot.dead = true;

                if (
                  typeof bot.die ===
                  "function"
                ) {
                  bot.die();
                }

                if (
                  typeof bot.despawn ===
                  "function"
                ) {
                  bot.despawn();
                }

                if (
                  bot.cs2Agent?.root
                    ?.parent
                ) {
                  bot.cs2Agent.root.parent.remove(
                    bot.cs2Agent.root
                  );
                }

                if (
                  bot.mesh?.parent
                ) {
                  bot.mesh.parent.remove(
                    bot.mesh
                  );
                }

                if (
                  bot.shadow?.parent
                ) {
                  bot.shadow.parent.remove(
                    bot.shadow
                  );
                }
              } catch {}
            }

            mgr.bots.length = 0;
          }
        } catch (e) {
          warn(
            "Temporary native bot bootstrap failed:",
            e
          );
        }
      }

      if (!State.botCtor) {
        const found =
          existingBots.find(
            b =>
              b &&
              b.team !== undefined &&
              typeof b.constructor ===
                "function"
          );

        if (found) {
          State.botCtor =
            found.constructor;

          log(
            "REAL BOT CONSTRUCTOR CAPTURED:",
            State.botCtor.name ||
              "(anonymous)"
          );
        }
      }

      if (!State.botCtor) {
        State.preparingBots = false;
        State.originalBots = [];
        State.originalBotArray = null;
        State.botTemplate = null;

        warn(
          "Could not capture the native bot constructor."
        );

        return false;
      }

      for (
        const bot of existingBots
      ) {
        RemoteBots.disableBot(bot);
      }

      try {
        mgr.bots.length = 0;
      } catch {}

      State.preparingBots = false;

      log(
        "Native AI bots removed from active manager.",
        existingBots.length
      );

      return true;
    },

    disableBot(bot) {
      if (!bot) return;

      bot.__connectionsPool =
        false;

      bot.__connectionsRemote =
        false;

      bot.__connectionsRemoved =
        true;

      bot.alive = false;
      bot.health = 0;

      try {
        if (
          typeof bot.die ===
          "function"
        ) {
          bot.die();
        }
      } catch {}

      try {
        if (
          typeof bot.despawn ===
          "function"
        ) {
          bot.despawn();
        }
      } catch {}

      try {
        if (bot.shadow) {
          bot.shadow.visible =
            false;
        }
      } catch {}

      try {
        if (bot.mesh) {
          bot.mesh.visible =
            false;
        }
      } catch {}

      try {
        if (
          bot.cs2Agent?.root
        ) {
          bot.cs2Agent.root.visible =
            false;
        }
      } catch {}

      try {
        if (
          typeof bot.update ===
          "function"
        ) {
          if (
            !bot.__connectionsOriginalUpdate
          ) {
            bot.__connectionsOriginalUpdate =
              bot.update;
          }

          bot.update =
            function () {};
        }
      } catch {}
    },

    getFreeBot() {
      return null;
    },

    createBot(remote) {
      const game = getGame();
      const mgr = game?.botMgr;

      if (
        !mgr ||
        !Array.isArray(mgr.bots)
      ) {
        return null;
      }

      if (
        mgr.bots.length >=
        CONFIG.MAX_REMOTE_BOTS
      ) {
        warn(
          "Maximum remote bot count reached."
        );

        return null;
      }

      const ctor =
        State.botCtor;

      if (
        typeof ctor !==
        "function"
      ) {
        warn(
          "No native bot constructor available."
        );

        return null;
      }

      let bot = null;

      try {
        bot = new ctor(
          game,
          remote.team === "T"
            ? "T"
            : "CT",
          remote.name ||
            "Player",
          3
        );
      } catch (e) {
        error(
          "Native bot constructor failed:",
          e
        );

        return null;
      }

      if (!bot) {
        return null;
      }

      bot.__connectionsPool =
        true;

      bot.__connectionsRemote =
        false;

      bot.__connectionsRemoteId =
        null;

      try {
        if (
          typeof bot.update ===
          "function"
        ) {
          bot.__connectionsOriginalUpdate =
            bot.update;
        }

        bot.update =
          function () {};
      } catch {}

      try {
        mgr.bots.push(bot);
      } catch {}

      return bot;
    },

    attach(remote) {
      const game = getGame();

      if (!game?.botMgr) {
        return;
      }

      if (remote.bot) {
        return;
      }

      const bot =
        RemoteBots.createBot(
          remote
        );

      if (!bot) {
        UI.setMessage(
          "Could not create remote player."
        );

        return;
      }

      remote.bot = bot;

      bot.__connectionsPool =
        true;

      bot.__connectionsRemote =
        true;

      bot.__connectionsRemoteId =
        remote.id;

      bot.name =
        remote.name;

      bot.team =
        normalizeTeam(
          remote.team
        );

      bot.difficulty = 3;

      // IMPORTANT:
      // Remote network players are
      // native bot bodies, NOT the
      // local player.
      bot.isPlayer = false;

      bot.alive =
        remote.alive !== false;

      bot.health =
        bot.alive
          ? 100
          : 0;

      try {
        if (
          typeof bot.spawn ===
          "function"
        ) {
          bot.spawn();
        }
      } catch (e) {
        warn(
          "Remote bot spawn failed:",
          e
        );
      }

      try {
        bot.update =
          function (dt) {
            RemoteBots.updateBot(
              remote,
              dt
            );
          };
      } catch {}

      RemoteBots.applyImmediate(
        remote
      );

      RemoteBots.rebuildAvatars();

      log(
        "Remote bot attached:",
        remote.name,
        "|",
        remote.id
      );
    },

    receive(data) {
      if (
        !data ||
        !data.id
      ) {
        return;
      }

      const id =
        String(data.id);

      if (
        id ===
        String(State.id)
      ) {
        return;
      }

      const incoming =
        data.state &&
        typeof data.state ===
          "object"
          ? data.state
          : data;

      if (
        !incoming ||
        typeof incoming !==
          "object"
      ) {
        return;
      }

      let remote =
        State.remotes.get(id);

      if (!remote) {
        const now =
          performance.now();

        remote = {
          id,

          name:
            String(
              incoming.name ||
              data.name ||
              "Player"
            ),

          team:
            normalizeTeam(
              incoming.team ||
              data.team ||
              "CT"
            ),

          x:
            safeNumber(
              incoming.x,
              0
            ),

          y:
            safeNumber(
              incoming.y,
              0
            ),

          z:
            safeNumber(
              incoming.z,
              0
            ),

          targetX:
            safeNumber(
              incoming.x,
              0
            ),

          targetY:
            safeNumber(
              incoming.y,
              0
            ),

          targetZ:
            safeNumber(
              incoming.z,
              0
            ),

          yaw:
            safeNumber(
              incoming.yaw,
              0
            ),

          pitch:
            safeNumber(
              incoming.pitch,
              0
            ),

          targetYaw:
            safeNumber(
              incoming.yaw,
              0
            ),

          targetPitch:
            safeNumber(
              incoming.pitch,
              0
            ),

          targetVx:
            safeNumber(
              incoming.vx,
              0
            ),

          targetVy:
            safeNumber(
              incoming.vy,
              0
            ),

          targetVz:
            safeNumber(
              incoming.vz,
              0
            ),

          targetOnGround:
            incoming.onGround !==
            undefined
              ? !!incoming.onGround
              : true,

          targetCrouching:
            !!incoming.crouching,

          alive:
            incoming.alive !==
            false,

          avatar:
            incoming.avatar !==
            undefined
              ? incoming.avatar
              : data.avatar ||
                null,

          avatarEnabled:
            incoming.avatarEnabled !==
            undefined
              ? incoming.avatarEnabled !==
                false
              : true,

          bot: null,

          lastUpdate: now,
          lastApplied: now,
          packetCount: 0
        };

        State.remotes.set(
          id,
          remote
        );

        log(
          "Remote player discovered:",
          remote.name,
          "|",
          id
        );
      }

      remote.name =
        String(
          incoming.name ||
          data.name ||
          remote.name ||
          "Player"
        );

      const previousTeam =
        remote.team;

      remote.team =
        normalizeTeam(
          incoming.team ||
          data.team ||
          remote.team ||
          "CT"
        );

      /*
       * Native CT/T agents are
       * constructed for a specific
       * team. Do not just change
       * bot.team or the visual model
       * can remain on the wrong side.
       */
      if (
        remote.bot &&
        previousTeam !==
          remote.team
      ) {
        try {
          this.destroyRemoteBot(
            remote.bot
          );
        } catch {}

        remote.bot = null;

        this.attach(remote);
      }

      remote.targetX =
        safeNumber(
          incoming.x,
          remote.targetX
        );

      remote.targetY =
        safeNumber(
          incoming.y,
          remote.targetY
        );

      remote.targetZ =
        safeNumber(
          incoming.z,
          remote.targetZ
        );

      remote.targetYaw =
        safeNumber(
          incoming.yaw,
          remote.targetYaw
        );

      remote.targetPitch =
        safeNumber(
          incoming.pitch,
          remote.targetPitch
        );

      remote.targetVx =
        safeNumber(
          incoming.vx,
          remote.targetVx
        );

      remote.targetVy =
        safeNumber(
          incoming.vy,
          remote.targetVy
        );

      remote.targetVz =
        safeNumber(
          incoming.vz,
          remote.targetVz
        );

      if (
        incoming.onGround !==
        undefined
      ) {
        remote.targetOnGround =
          !!incoming.onGround;
      }

      if (
        incoming.crouching !==
        undefined
      ) {
        remote.targetCrouching =
          !!incoming.crouching;
      }

      if (
        incoming.alive !==
        undefined
      ) {
        remote.alive =
          incoming.alive !==
          false;
      }

      let avatarChanged =
        false;

      if (
        incoming.avatar !==
          undefined &&
        incoming.avatar !==
          remote.avatar
      ) {
        remote.avatar =
          incoming.avatar;

        avatarChanged = true;
      }

      if (
        incoming.avatarEnabled !==
          undefined &&
        (
          incoming.avatarEnabled !==
          false
        ) !==
          remote.avatarEnabled
      ) {
        remote.avatarEnabled =
          incoming.avatarEnabled !==
          false;

        avatarChanged = true;
      }

      if (
        data.avatar !==
          undefined &&
        data.avatar !==
          remote.avatar
      ) {
        remote.avatar =
          data.avatar;

        avatarChanged = true;
      }

      if (
        data.avatarEnabled !==
          undefined &&
        (
          data.avatarEnabled !==
          false
        ) !==
          remote.avatarEnabled
      ) {
        remote.avatarEnabled =
          data.avatarEnabled !==
          false;

        avatarChanged = true;
      }

      remote.lastUpdate =
        performance.now();

      remote.packetCount++;

      if (!remote.bot) {
        this.attach(remote);
      }

      if (remote.bot) {
        try {
          remote.bot.name =
            remote.name;
        } catch {}

        try {
          remote.bot.alive =
            remote.alive;
        } catch {}
      }

      if (
        avatarChanged ||
        remote.packetCount === 1
      ) {
        try {
          this.applyAvatars(
            remote
          );
        } catch {}
      }
    },

    updateBot(remote, dt) {
      const bot =
        remote &&
        remote.bot;

      if (
        !remote ||
        !bot
      ) {
        return;
      }

      const g = getGame();

      if (!g) return;

      const now =
        performance.now();

      if (
        !Number.isFinite(
          remote.x
        )
      ) {
        remote.x = 0;
      }

      if (
        !Number.isFinite(
          remote.y
        )
      ) {
        remote.y = 0;
      }

      if (
        !Number.isFinite(
          remote.z
        )
      ) {
        remote.z = 0;
      }

      if (
        !Number.isFinite(
          remote.targetX
        )
      ) {
        remote.targetX =
          remote.x;
      }

      if (
        !Number.isFinite(
          remote.targetY
        )
      ) {
        remote.targetY =
          remote.y;
      }

      if (
        !Number.isFinite(
          remote.targetZ
        )
      ) {
        remote.targetZ =
          remote.z;
      }

      const px =
        Number(bot.x) || 0;

      const py =
        Number(bot.y) || 0;

      const pz =
        Number(bot.z) || 0;

      const tx =
        Number(
          remote.targetX
        );

      const ty =
        Number(
          remote.targetY
        );

      const tz =
        Number(
          remote.targetZ
        );

      const dx = tx - px;
      const dy = ty - py;
      const dz = tz - pz;

      const distance =
        Math.sqrt(
          dx * dx +
          dy * dy +
          dz * dz
        );

      const safeDt =
        Math.max(
          0.001,
          Math.min(
            0.1,
            Number(dt) ||
              0.05
          )
        );

      const TELEPORT_DISTANCE =
        12;

      const MAX_STEP =
        Math.max(
          0.55,
          30 * safeDt
        );

      let nx = px;
      let ny = py;
      let nz = pz;

      if (
        distance <=
          MAX_STEP ||
        distance >
          TELEPORT_DISTANCE
      ) {
        nx = tx;
        ny = ty;
        nz = tz;
      } else {
        const scale =
          MAX_STEP /
          distance;

        nx += dx * scale;
        ny += dy * scale;
        nz += dz * scale;
      }

      const vx =
        (nx - px) /
        safeDt;

      const vy =
        (ny - py) /
        safeDt;

      const vz =
        (nz - pz) /
        safeDt;

      remote.vx = vx;
      remote.vy = vy;
      remote.vz = vz;

      try {
        bot.vx = vx;
        bot.vy = vy;
        bot.vz = vz;
      } catch {}

      try {
        bot.velocity = {
          x: vx,
          y: vy,
          z: vz
        };
      } catch {}

      const onGround =
        !!remote.targetOnGround;

      const crouching =
        !!remote.targetCrouching;

      try {
        bot.onGround =
          onGround;
      } catch {}

      try {
        bot.crouching =
          crouching;
      } catch {}

      let applied = false;

      try {
        if (
          typeof bot.setPosition ===
          "function"
        ) {
          bot.setPosition(
            nx,
            ny,
            nz
          );

          applied = true;
        }
      } catch {}

      if (!applied) {
        try {
          if (
            typeof bot.setPos ===
            "function"
          ) {
            bot.setPos(
              nx,
              ny,
              nz
            );

            applied = true;
          }
        } catch {}
      }

      if (!applied) {
        try {
          if (bot.position) {
            bot.position.x = nx;
            bot.position.y = ny;
            bot.position.z = nz;

            applied = true;
          }
        } catch {}
      }

      try {
        bot.x = nx;
        bot.y = ny;
        bot.z = nz;
      } catch {}

      const yaw =
        Number.isFinite(
          Number(
            remote.targetYaw
          )
        )
          ? Number(
              remote.targetYaw
            )
          : Number(
              remote.yaw
            ) || 0;

      const pitch =
        Number.isFinite(
          Number(
            remote.targetPitch
          )
        )
          ? Number(
              remote.targetPitch
            )
          : Number(
              remote.pitch
            ) || 0;

      remote.yaw = yaw;
      remote.pitch = pitch;

      try {
        bot.yaw = yaw;
      } catch {}

      try {
        bot.pitch = pitch;
      } catch {}

      try {
        bot._lookPitch =
          pitch;
      } catch {}

      try {
        bot.rotationY =
          yaw;
      } catch {}

      try {
        if (
          typeof bot._updateCS2Body ===
          "function"
        ) {
          bot._updateCS2Body();
        }
      } catch {}

      try {
        const agent =
          bot.cs2Agent;

        if (agent) {
          if (
            typeof agent.setTransform ===
            "function"
          ) {
            agent.setTransform(
              nx,
              ny,
              nz,
              yaw
            );
          }

          if (
            typeof agent.setPitch ===
            "function"
          ) {
            agent.setPitch(
              pitch
            );
          }

          if (
            typeof agent.update ===
            "function"
          ) {
            agent.update(
              safeDt,
              onGround,
              crouching
            );
          }
        }
      } catch {}

      try {
        bot.name =
          remote.name ||
          bot.name;
      } catch {}

      try {
        bot.alive =
          remote.alive !==
          false;
      } catch {}

      try {
        if (
          remote.health !==
          undefined
        ) {
          bot.health =
            remote.health;
        }
      } catch {}

      if (
        remote.alive ===
        false
      ) {
        try {
          bot.alive = false;
        } catch {}

        try {
          if (
            typeof bot.visible !==
            "undefined"
          ) {
            bot.visible =
              false;
          }
        } catch {}
      } else {
        try {
          bot.visible = true;
        } catch {}
      }

      remote.lastApplied =
        now;
    },
    applyImmediate(remote) {
      if (!remote || !remote.bot) return;

      const bot = remote.bot;

      const x = safeNumber(remote.targetX, 0);
      const y = safeNumber(remote.targetY, 0);
      const z = safeNumber(remote.targetZ, 0);
      const yaw = safeNumber(remote.targetYaw, 0);
      const pitch = safeNumber(remote.targetPitch, 0);

      setTransform(bot, x, y, z);
      setRotation(bot, yaw, pitch);

      setVelocity(
        bot,
        safeNumber(remote.targetVx, 0),
        safeNumber(remote.targetVy, 0),
        safeNumber(remote.targetVz, 0)
      );

      try { bot.onGround = !!remote.targetOnGround; } catch {}
      try { bot.grounded = !!remote.targetOnGround; } catch {}
      try { bot.crouching = !!remote.targetCrouching; } catch {}
      try { bot.alive = remote.alive !== false; } catch {}
      try { bot.health = remote.alive !== false ? 100 : 0; } catch {}
      try { bot.name = remote.name; } catch {}

      try {
        if (typeof bot._updateCS2Body === "function") {
          bot._updateCS2Body();
        }
      } catch {}

      try {
        const agent = bot.cs2Agent;

        if (agent) {
          if (typeof agent.setTransform === "function") {
            agent.setTransform(x, y, z, yaw);
          }

          if (typeof agent.setPitch === "function") {
            agent.setPitch(pitch);
          }
        }
      } catch {}

      try {
        const root = bot.cs2Agent?.root;

        if (root) {
          if (root.position) {
            root.position.x = x;
            root.position.y = y;
            root.position.z = z;
          }

          if (root.rotation) {
            root.rotation.y = yaw;
          }

          root.visible = true;
        }
      } catch {}

      try {
        if (bot.mesh) bot.mesh.visible = true;
      } catch {}

      try {
        if (bot.shadow) bot.shadow.visible = true;
      } catch {}

      this.applyAvatars(remote);
    },

    remove(id) {
      id = String(id || "");

      if (!id) return;

      const remote = State.remotes.get(id);

      if (!remote) return;

      log("Remote player removed:", id);

      try {
        if (remote.bot) {
          this.destroyRemoteBot(remote.bot);
        }
      } catch (e) {
        warn("Failed destroying remote bot:", e);
      }

      State.remotes.delete(id);
    },

    destroyRemoteBot(bot) {
      if (!bot) return;

      try {
        bot.__connectionsRemote = false;
        bot.__connectionsRemoved = true;
        bot.alive = false;
        bot.health = 0;
      } catch {}

      try {
        if (typeof bot.die === "function") {
          bot.die();
        }
      } catch {}

      try {
        if (typeof bot.despawn === "function") {
          bot.despawn();
        }
      } catch {}

      try {
        if (bot.cs2Agent?.root?.parent) {
          bot.cs2Agent.root.parent.remove(
            bot.cs2Agent.root
          );
        }
      } catch {}

      try {
        if (bot.mesh?.parent) {
          bot.mesh.parent.remove(bot.mesh);
        }
      } catch {}

      try {
        if (bot.shadow?.parent) {
          bot.shadow.parent.remove(bot.shadow);
        }
      } catch {}

      try {
        const list = getGame()?.botMgr?.bots;

        if (list) {
          const index = list.indexOf(bot);

          if (index !== -1) {
            list.splice(index, 1);
          }
        }
      } catch {}

      try {
        bot.update = function () {};
      } catch {}
    },

    clear() {
      for (const remote of State.remotes.values()) {
        if (remote.bot) {
          this.destroyRemoteBot(remote.bot);
        }
      }

      State.remotes.clear();

      this.restoreOriginalBots();
      this.rebuildAvatars();

      log("Remote bots cleared.");
    },

    restoreOriginalBots() {
      const game = getGame();
      const mgr = game?.botMgr;

      if (!mgr || !Array.isArray(mgr.bots)) return;
      if (!State.originalBots.length) return;

      try {
        mgr.bots.length = 0;

        for (const bot of State.originalBots) {
          if (!bot) continue;

          bot.__connectionsPool = false;
          bot.__connectionsRemote = false;
          bot.__connectionsRemoved = false;

          try {
            bot.alive = true;
          } catch {}

          try {
            if (bot.health <= 0) {
              bot.health = 100;
            }
          } catch {}

          try {
            if (bot.__connectionsOriginalUpdate) {
              bot.update = bot.__connectionsOriginalUpdate;
            }
          } catch {}

          try {
            if (typeof bot.spawn === "function") {
              bot.spawn();
            }
          } catch {}

          try {
            if (bot.cs2Agent?.root) {
              bot.cs2Agent.root.visible = true;
            }
          } catch {}

          try {
            if (bot.mesh) {
              bot.mesh.visible = true;
            }
          } catch {}

          try {
            if (bot.shadow) {
              bot.shadow.visible = true;
            }
          } catch {}

          mgr.bots.push(bot);
        }

        log("Original AI bots restored.");
      } catch (e) {
        warn("Failed to restore original bots:", e);
      }

      State.originalBots = [];
      State.originalBotArray = null;
      State.botTemplate = null;
      State.preparingBots = false;
    },

    rebuildAvatars() {
      const game = getGame();

      if (!game) return;

      try {
        if (
          game.hud &&
          typeof game.hud.buildAvatars === "function"
        ) {
          game.hud.buildAvatars();
        }
      } catch {}

      setTimeout(() => {
        for (const remote of State.remotes.values()) {
          this.applyAvatars(remote);
        }
      }, 50);
    },

    applyAvatars(remote) {
      if (!remote) return;

      const avatar =
        remote.avatarEnabled !== false &&
        remote.avatar
          ? remote.avatar
          : null;

      const game = getGame();

      if (!game) return;

      try {
        const hud = game.hud;

        if (hud) {
          const roots = [
            hud.avatars,
            hud.avatarRows,
            hud.scoreboard,
            hud.scoreboardRows
          ];

          for (const root of roots) {
            if (!root) continue;

            this.walkAvatarObjects(
              root,
              remote,
              avatar
            );
          }
        }
      } catch {}

      try {
        const rows = document.querySelectorAll(
          "[data-player-id], [data-id]"
        );

        rows.forEach(row => {
          const rowId =
            row.getAttribute("data-player-id") ||
            row.getAttribute("data-id");

          if (
            String(rowId) !==
            String(remote.id)
          ) {
            return;
          }

          const image = row.querySelector("img");

          if (image && avatar) {
            image.src = avatar;
            image.style.display = "block";
          }
        });
      } catch {}
    },

    walkAvatarObjects(object, remote, avatar) {
      if (!object) return;

      if (object.nodeType === 1) {
        try {
          const id =
            object.getAttribute("data-player-id") ||
            object.getAttribute("data-id");

          if (
            id &&
            String(id) === String(remote.id)
          ) {
            const img = object.querySelector("img");

            if (img) {
              if (avatar) {
                img.src = avatar;
                img.style.display = "block";
              } else {
                img.style.display = "none";
              }
            }
          }
        } catch {}
      }

      if (typeof object !== "object") return;

      const visited = new Set();

      const walk = value => {
        if (!value || typeof value !== "object") return;
        if (visited.has(value)) return;

        visited.add(value);

        try {
          if (
            value.playerId !== undefined &&
            String(value.playerId) ===
              String(remote.id)
          ) {
            if (value.src !== undefined) {
              value.src = avatar || "";
            }

            if (value.texture !== undefined) {
              value.texture = avatar || "";
            }
          }
        } catch {}

        const keys = [
          "children",
          "avatars",
          "rows",
          "players",
          "items",
          "elements"
        ];

        for (const key of keys) {
          try {
            const child = value[key];

            if (Array.isArray(child)) {
              child.forEach(walk);
            } else if (
              child &&
              typeof child === "object"
            ) {
              walk(child);
            }
          } catch {}
        }
      };

      walk(object);
    }
  };

  /* =========================================================
   * CHAT
   * ========================================================= */

  const Chat = {
    send(message) {
      const text = String(message || "")
        .trim()
        .slice(0, 300);

      if (
        !text ||
        !State.connected ||
        !State.room
      ) {
        return;
      }

      Network.send({
        type: "chat",
        message: text,
        name: State.name
      });
    }
  };

  /* =========================================================
   * MATCH LIFECYCLE
   * ========================================================= */

  function handleMatchEnd() {
    if (State.matchEnding) return;

    State.matchEnding = true;

    log(
      "Match ended. Cleaning multiplayer state."
    );

    Music.stopForMatchEnd();

    if (State.connected) {
      Network.send({
        type: "leave_room"
      });
    }

    RemoteBots.clear();

    State.room = null;
    State.roomData = null;
    State.isHost = false;

    State.matchSync.hostId = null;
    State.matchSync.roundSeq = 0;
    State.matchSync.lastActive = null;
    State.matchSync.roundEndAt = 0;
    State.matchSync.endAt = 0;
    State.matchSync.lastReceived = 0;

    State.hostRoundSeq = 0;
    State.hostLastActive = null;
    State.hostRoundEndAt = 0;
    State.hostEndAt = 0;

    State.confirmedMatch = false;
    State.outsideMatchSince = 0;

    UI.setScanState(false);
    UI.renderRoom();

    UI.setMessage(
      "Lobby. Enter a match and press Confirm."
    );

    State.matchEnding = false;
  }

function monitorGame() {
  const game = getGame();

  if (
    game &&
    State.game !== game
  ) {
    State.game = game;

    log(
      "Game engine detected."
    );
  }

  if (!game) return;

  if (State.confirmedMatch) {
    const inside =
      isInsideMatch(game);

    if (inside) {
      if (State.outsideMatchSince) {
        const outsideFor =
          Date.now() -
          State.outsideMatchSince;

        log(
          "Match state restored after transition. " +
          outsideFor +
          "ms"
        );
      }

      State.outsideMatchSince = 0;
    } else if (State.room) {
      /*
       * IMPORTANT:
       *
       * Clutcher temporarily stops looking like
       * an active match while rebuilding the map,
       * navigation, round state, etc.
       *
       * DO NOT call handleMatchEnd() here.
       * The multiplayer room must survive that
       * transition.
       */
      if (!State.outsideMatchSince) {
        State.outsideMatchSince =
          Date.now();

        log(
          "Temporarily outside match state. Preserving multiplayer room..."
        );
        console.log(
  "[Connections Match Debug]",
  {
    gameState: game.gameState,
    state: game.state,
    inMatch: game.inMatch,
    roundActive: game.roundActive,
    roundTimeLeft: game.roundTimeLeft,
    endT: game.endT,
    player: !!game.player,
    playerPosition: game.player
      ? {
          x: game.player.x,
          y: game.player.y,
          z: game.player.z
        }
      : null,
    dealDamage:
      typeof game.dealDamage,
    startRound:
      typeof game.startRound,
    endRound:
      typeof game.endRound
  }
);
      }
    }
  }

  /*
   * Only synchronize the actual game clock while
   * Clutcher currently has a usable match.
   *
   * We still KEEP the Connections room while the
   * native game is transitioning.
   */
  if (
    State.confirmedMatch &&
    State.room &&
    isInsideMatch(game)
  ) {
    if (State.isHost) {
      broadcastRoundState();
    } else {
      applyAuthoritativeMatchState();
    }
  }
}

  function startMonitor() {
    if (State.monitorTimer) return;

    State.monitorTimer =
      setInterval(
        monitorGame,
        CONFIG.MATCH_CHECK_RATE
      );
  }

  /* =========================================================
   * ENGINE SCANNER
   * ========================================================= */

  function scanEngine() {
    const game = getGame();

    if (!game) {
      warn(
        "Game engine not found."
      );

      return null;
    }

    State.game = game;

    const result = {
      game,
      player: getPlayer(),
      botMgr: game.botMgr || null,
      physics: game.physics || null,
      hud: game.hud || null
    };

    log(
      "Engine scan:",
      result
    );

    return result;
  }

  /* =========================================================
   * MATCH CONFIRMATION
   * ========================================================= */

  function confirmMatch() {
    if (State.confirmedMatch) return;

    const game = getGame();

    if (!game) {
      UI.setMessage(
        "Game engine not found."
      );

      return;
    }

    if (!isInsideMatch(game)) {
      UI.setMessage(
        "You must already be inside a match."
      );

      return;
    }

    UI.setScanState(true);

    UI.setMessage(
      "Scanning game engine..."
    );

    setTimeout(() => {
      const result =
        scanEngine();

      if (!result) {
        UI.setScanState(false);

        UI.setMessage(
          "Engine scan failed."
        );

        return;
      }

      if (
        !result.botMgr ||
        !Array.isArray(
          result.botMgr.bots
        )
      ) {
        UI.setScanState(false);

        UI.setMessage(
          "Native bot manager not found."
        );

        warn(
          "botMgr.bots unavailable."
        );

        return;
      }

      log(
        "Preparing native bot removal:",
        result.botMgr.bots.length
      );

      const prepared =
        RemoteBots.preparePool();

      if (!prepared) {
        UI.setScanState(false);

        UI.setMessage(
          "Could not prepare native bots."
        );

        return;
      }

      State.confirmedMatch = true;
      State.matchEnding = false;
      State.outsideMatchSince = 0;

      UI.setScanState(false);

      UI.setMessage(
        "Multiplayer active."
      );

      log(
        "Match confirmed."
      );

      Network.connect();
    }, 80);
  }

  /* =========================================================
   * ROOM MANAGEMENT
   * ========================================================= */

  function createRoom(opts) {
    opts = opts || {};

    if (!State.connected) {
      UI.setMessage(
        'Not connected. Enter a match and press "I AM INSIDE A MATCH" first.'
      );

      return;
    }

    if (!State.confirmedMatch) {
      UI.setMessage(
        "Confirm that you are inside a match first."
      );

      return;
    }

    const segments =
      (opts.segments || [])
        .map(seg => ({
          text:
            String(
              seg.text || ""
            ).trim(),

          color:
            /^#[0-9a-f]{6}$/i.test(
              seg.color
            )
              ? seg.color
              : "#ffffff"
        }))
        .filter(
          seg => seg.text
        );

    if (!segments.length) {
      UI.setMessage(
        "Enter a room name."
      );

      return;
    }

    /*
     * One setting controls capacity.
     * 1 = 1v1
     * 5 = 5v5
     * 10 = 10v10
     */
    const teamSize =
      clamp(
        parseInt(
          opts.teamSize,
          10
        ) || 5,
        1,
        10
      );

    const maxPlayers =
      teamSize * 2;

    const professional =
      !!opts.professional;

    Network.send({
      type: "create_room",

      name:
        segments
          .map(
            seg => seg.text
          )
          .join(" ")
          .slice(0, 40),

      nameSegments:
        segments,

      teamSize,
      maxPlayers,

      rafit:
        professional ||
        !!opts.rafit,

      professional
    });
  }

  function joinRoom(room) {
    if (!State.connected) {
      UI.setMessage(
        "Not connected."
      );

      return;
    }

    const id =
      roomId(room);

    if (!id) return;

    Network.send({
      type: "join_room",
      room: id,
      roomId: id,
      id
    });

    UI.setMessage(
      "Joining room..."
    );
  }

function leaveRoom() {
  console.trace(
    "[Connections DEBUG] leaveRoom() CALLED"
  );

  if (!State.room) return;

  Music.stop();

  Network.send({
    type: "leave_room"
  });

  const oldRoom =
    State.room;

  State.room = null;
  State.roomData = null;
  State.isHost = false;

  RemoteBots.clear();
  UI.renderRoom();

  UI.setMessage(
    "Left room."
  );

  log(
    "Left room:",
    oldRoom
  );
}

  /* =========================================================
   * RAFIT IDENTITY + CHEAT SIGNATURE SCAN
   * ========================================================= */

  function getRafitToken() {
    try {
      let t =
        localStorage.getItem(
          "connections_rafit_token"
        );

      if (
        t &&
        /^[a-f0-9]{32,128}$/i.test(t)
      ) {
        return t;
      }

      const bytes =
        new Uint8Array(24);

      (
        PAGE.crypto ||
        window.crypto
      ).getRandomValues(bytes);

      t =
        Array.from(
          bytes,
          b =>
            b
              .toString(16)
              .padStart(2, "0")
        ).join("");

      localStorage.setItem(
        "connections_rafit_token",
        t
      );

      return t;
    } catch {
      return null;
    }
  }

  function scanCheatMarkers() {
    const found = [];

    try {
      for (
        const id of [
          "pp-root",
          "pp-theme",
          "pp-hud",
          "pp-wnum",
          "pp-wicons"
        ]
      ) {
        if (
          document.getElementById(id)
        ) {
          found.push(
            "el:" + id
          );
        }
      }
    } catch {}

    try {
      for (
        const k of [
          "_ppDd",
          "_ppAsp"
        ]
      ) {
        if (PAGE[k]) {
          found.push(
            "win:" + k
          );
        }
      }
    } catch {}

    try {
      const g = getGame();

      if (g?.player?.update?._pp) {
        found.push(
          "fn:player.update"
        );
      }

      if (g?.hud?.update?._pp) {
        found.push(
          "fn:hud.update"
        );
      }

      if (g?.weapons?.fire?._pp) {
        found.push(
          "fn:weapons.fire"
        );
      }
    } catch {}

    return found;
  }

  function startCheatScan() {
    if (State.cheatTimer) {
      return;
    }

    State.cheatTimer =
      setInterval(() => {
        if (
          !State.connected ||
          !State.room
        ) {
          return;
        }

        if (
          !getRoomObject(
            State.room
          )?.rafit
        ) {
          return;
        }

        const markers =
          scanCheatMarkers();

        if (!markers.length) {
          return;
        }

        const sig =
          markers
            .slice()
            .sort()
            .join("|");

        if (
          sig ===
          State.cheatSig
        ) {
          return;
        }

        State.cheatSig = sig;

        Network.send({
          type: "rafit_flag",
          flag:
            "cheat_signature",
          markers
        });
      }, 5000);
  }

  /* =========================================================
   * UI
   * ========================================================= */

  function safeColor(c, fallback) {
    return /^#[0-9a-f]{6}$/i.test(
      String(c)
    )
      ? String(c)
      : fallback ||
          "#ffffff";
  }

  function coloredName(
    segments,
    fallback
  ) {
    if (
      Array.isArray(segments) &&
      segments.length
    ) {
      return segments
        .slice(0, 8)
        .map(
          s =>
            `<span style="color:${safeColor(
              s && s.color
            )}">${escapeHtml(
              s && s.text
            )}</span>`
        )
        .join(" ");
    }

    return escapeHtml(
      fallback || "Room"
    );
  }

  function roomBadges(room) {
    if (!room) return "";

    return (
      (
        room.rafit
          ? '<span class="cn-badge">RAFIT</span>'
          : ""
      ) +
      (
        room.professional
          ? '<span class="cn-badge pro">PRO</span>'
          : ""
      )
    );
  }

  const UI = {
    root: null,
    els: {},
    segments: [
      {
        text: "",
        color: "#ff3b3b"
      }
    ],
    chatLog: null,
    avatarToggle: null,
    scanButton: null,

    init() {
      if (this.root) return;

      const style =
        document.createElement(
          "style"
        );

      style.textContent = `
        #connections-root { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
          width: 760px; max-width: 94vw; max-height: 94vh; overflow-y: auto; z-index: 2147483647;
          background: #14151a; color: #f4f4f5; border: 1px solid #2a2c35; border-radius: 14px;
          box-shadow: 0 20px 70px rgba(0,0,0,.65); font-family: Inter, Arial, sans-serif; font-size: 13px;
          padding: 18px; display: none; box-sizing: border-box; }
        #connections-root * { box-sizing: border-box; }
        .cn-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
        .cn-titles { flex: 1; }
        .cn-title { font-size: 22px; font-weight: 800; line-height: 1.1; }
        .cn-sub { font-size: 11px; color: #8a8f9c; }
        .cn-x { width: 32px; height: 32px; border: 0; border-radius: 8px; background: #262832; color: #fff; font-size: 16px; cursor: pointer; }
        .cn-card { background: #1a1b21; border: 1px solid #2a2c35; border-radius: 12px; padding: 14px; margin-bottom: 12px; }
        .cn-h { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: #c9cbd3; margin-bottom: 10px; }
        .cn-input { width: 100%; border: 1px solid #30333d; background: #0d0e12; color: #fff; border-radius: 10px; padding: 10px 12px; outline: none; font-size: 13px; }
        .cn-input:focus { border-color: #7289da; }
        .cn-btn { border: 0; border-radius: 9px; background: #5b5ff0; color: #fff; padding: 9px 14px; font-weight: 700; cursor: pointer; font-size: 13px; }
        .cn-btn:hover { filter: brightness(1.1); }
        .cn-btn:disabled { opacity: .5; cursor: default; }
        .cn-dark { background: #262832; }
        .cn-scan { width: 100%; padding: 14px; background: #7088d8; font-size: 13px; letter-spacing: .02em; }
        .cn-hint { color: #747b88; font-size: 11px; text-align: center; margin-top: 8px; }
        .cn-hint.left { text-align: left; margin-top: 4px; }
        .cn-seg { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
        .cn-color { width: 40px; height: 34px; padding: 0; border: 1px solid #30333d; border-radius: 8px; background: #0d0e12; cursor: pointer; flex: none; }
        .cn-del { width: 34px; height: 34px; padding: 0; flex: none; }
        .cn-preview { background: #0d0e12; border-radius: 10px; padding: 12px 14px; font-size: 17px; font-weight: 800; margin: 4px 0 10px; min-height: 44px; }
        .cn-ph { color: #4e535f; font-weight: 600; }
        .cn-row2 { display: flex; gap: 10px; margin: 10px 0; }
        .cn-check { display: flex; align-items: center; gap: 8px; color: #c9cbd3; margin: 6px 0; cursor: pointer; }
        .cn-rooms-empty { text-align: center; color: #747b88; padding: 26px 0; font-size: 14px; }
        .cn-room-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-radius: 10px; background: #101218; margin-top: 8px; }
        .cn-rn { font-size: 15px; font-weight: 800; }
        .cn-badge { display: inline-block; margin-left: 8px; padding: 2px 6px; border-radius: 6px; font-size: 10px; font-weight: 800; background: #1f3a2b; color: #5fe39a; vertical-align: middle; }
        .cn-badge.pro { background: #3d3216; color: #f5c451; }
        .cn-status { font-size: 16px; font-weight: 800; margin-top: 4px; }
        .cn-status.off { color: #ff5c5c; }
        .cn-status.on { color: #4ade80; }
        .cn-status.wait { color: #f5c451; }
        .cn-msg { min-height: 16px; color: #8e96a5; font-size: 11px; margin-top: 4px; }
        .cn-more summary { cursor: pointer; font-size: 12px; font-weight: 800; text-transform: uppercase; color: #8f96a3; }
        .cn-avatar { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; background: #0b0d11; border: 1px solid #30343e; }
        .cn-chat { height: 120px; overflow-y: auto; background: #0d0f13; border-radius: 8px; border: 1px solid #272b34; padding: 8px; font-size: 12px; margin: 8px 0; }
        .cn-chat-line { padding: 3px 0; word-break: break-word; }
        .cn-chat-name { font-weight: 800; color: #aebcff; }
        .cn-flex { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
      `;

      document.head.appendChild(
        style
      );

      const root =
        document.createElement(
          "div"
        );

      root.id =
        "connections-root";

      root.innerHTML = `
        <div class="cn-head">
          <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
            <circle cx="22" cy="22" r="19" fill="none" stroke="#e5383b" stroke-width="3"/>
            <path d="M14 15l6 6m0-6l-6 6M24 15l6 6m0-6l-6 6" stroke="#e5383b" stroke-width="2.5" stroke-linecap="round"/>
            <path d="M15 29q7 -5 14 0" fill="none" stroke="#e5383b" stroke-width="2.5" stroke-linecap="round"/>
            <path d="M8 8l28 28" stroke="#e5383b" stroke-width="3" stroke-linecap="round"/>
          </svg>

          <div class="cn-titles">
            <div class="cn-title">Connections</div>
            <div class="cn-sub">Multiplayer</div>
          </div>

          <button id="cn-close" class="cn-x" title="Close">×</button>
        </div>

        <div class="cn-card">
          <div class="cn-h">Player</div>
          <input id="cn-name" class="cn-input" maxlength="24" placeholder="Username" />
        </div>

        <div class="cn-card">
          <div class="cn-h">Match</div>
          <button id="cn-scan" class="cn-btn cn-scan">I AM INSIDE A MATCH</button>
          <div class="cn-hint">Enter a match, then scan.</div>
        </div>

        <div class="cn-card">
          <div class="cn-h">Create Room</div>

          <div id="cn-segs"></div>
          <div id="cn-preview" class="cn-preview"></div>

          <button id="cn-addseg" class="cn-btn cn-dark">+ Add color segment</button>

          <div class="cn-hint left" style="margin-top:8px;">
            Max players on each team
          </div>

          <input
            id="cn-team"
            class="cn-input"
            type="number"
            min="1"
            max="10"
            value="5"
            title="Max players on each team"
          />

          <label class="cn-check">
            <input type="checkbox" id="cn-rafit" />
            Enable RAFIT
          </label>

          <label class="cn-check">
            <input type="checkbox" id="cn-pro" />
            Professional Server (2000+ RTP)
          </label>

          <button id="cn-create" class="cn-btn" style="margin-top:8px;">
            Create Room
          </button>
        </div>

        <div class="cn-card">
          <div class="cn-h">Rooms</div>
          <div id="cn-rooms"></div>
        </div>

        <div class="cn-card">
          <div class="cn-h">Current Room</div>
          <div id="cn-room" style="font-size:15px;margin-bottom:10px;">No room</div>
          <button id="cn-leave" class="cn-btn cn-dark">Leave Room</button>
        </div>

        <details class="cn-card cn-more">
          <summary>Avatar &amp; chat</summary>

          <div class="cn-flex">
            <img id="cn-avatar-preview" class="cn-avatar" alt="" />
            <input id="cn-avatar-input" class="cn-input" type="file" accept="image/*" />
          </div>

          <div class="cn-flex">
            <button id="cn-avatar-toggle" class="cn-btn cn-dark">Avatar: ON</button>
            <button id="cn-avatar-reset" class="cn-btn cn-dark">Reset</button>
          </div>

          <div id="cn-chat" class="cn-chat"></div>

          <div class="cn-flex">
            <input id="cn-chat-input" class="cn-input" maxlength="300" placeholder="Message..." />
            <button id="cn-chat-send" class="cn-btn">Send</button>
          </div>
        </details>

        <div id="cn-status" class="cn-status off">OFFLINE</div>
        <div class="cn-hint left">Backspace = open/close</div>
        <div id="cn-msg" class="cn-msg"></div>
      `;

      document.body.appendChild(
        root
      );

      this.root = root;

      const $ =
        s =>
          root.querySelector(s);

      this.els = {
        status:
          $("#cn-status"),

        msg:
          $("#cn-msg"),

        scan:
          $("#cn-scan"),

        name:
          $("#cn-name"),

        segs:
          $("#cn-segs"),

        preview:
          $("#cn-preview"),

        add:
          $("#cn-addseg"),

        team:
          $("#cn-team"),

        rafit:
          $("#cn-rafit"),

        pro:
          $("#cn-pro"),

        rooms:
          $("#cn-rooms"),

        room:
          $("#cn-room"),

        chat:
          $("#cn-chat"),

        avatarToggle:
          $("#cn-avatar-toggle"),

        avatarPreview:
          $("#cn-avatar-preview"),

        avatarInput:
          $("#cn-avatar-input")
      };

      this.chatLog =
        this.els.chat;

      this.avatarToggle =
        this.els.avatarToggle;

      this.scanButton =
        this.els.scan;

      this.els.name.value =
        State.name;

      const saveName = () => {
        const value =
          String(
            this.els.name.value ||
            ""
          )
            .trim()
            .slice(0, 24);

        if (
          !value ||
          value === State.name
        ) {
          return;
        }

        State.name = value;

        try {
          localStorage.setItem(
            "connections_player_name",
            value
          );
        } catch {}

        Network.send({
          type: "hello",
          name: value
        });

        this.setMessage(
          "Username saved."
        );
      };

      this.els.name.addEventListener(
        "change",
        saveName
      );

      this.els.name.addEventListener(
        "keydown",
        e => {
          if (e.key === "Enter") {
            e.preventDefault();
            saveName();
          }
        }
      );

      $("#cn-close").addEventListener(
        "click",
        () => this.toggle()
      );

      this.els.scan.addEventListener(
        "click",
        confirmMatch
      );

      this.els.add.addEventListener(
        "click",
        () => {
          if (
            this.segments.length >= 6
          ) {
            return;
          }

          this.segments.push({
            text: "",
            color: "#ff4fd8"
          });

          this.renderSegments();
        }
      );

      this.els.pro.addEventListener(
        "change",
        () => {
          if (
            this.els.pro.checked
          ) {
            this.els.rafit.checked =
              true;
          }

          this.els.rafit.disabled =
            this.els.pro.checked;
        }
      );

      $("#cn-create").addEventListener(
        "click",
        () => {
          createRoom({
            segments:
              this.segments,

            teamSize:
              this.els.team.value,

            rafit:
              this.els.rafit.checked,

            professional:
              this.els.pro.checked
          });
        }
      );

      $("#cn-leave").addEventListener(
        "click",
        leaveRoom
      );

      this.els.rooms.addEventListener(
        "click",
        e => {
          const b =
            e.target.closest(
              "[data-join-room]"
            );

          if (b) {
            joinRoom(
              b.getAttribute(
                "data-join-room"
              )
            );
          }
        }
      );
      this.els.avatarInput.addEventListener(
        "change",
        async e => {
          const file =
            e.target.files &&
            e.target.files[0];

          if (file) {
            await Avatar.setFile(file);
          }

          e.target.value = "";
        }
      );

      this.els.avatarToggle.addEventListener(
        "click",
        () => {
          Avatar.toggle();
        }
      );

      $("#cn-avatar-reset").addEventListener(
        "click",
        () => {
          Avatar.reset();
        }
      );

      const sendChat = () => {
        const input =
          $("#cn-chat-input");

        const value =
          String(
            input.value || ""
          ).trim();

        if (!value) return;

        Chat.send(value);
        input.value = "";
      };

      $("#cn-chat-send").addEventListener(
        "click",
        sendChat
      );

      $("#cn-chat-input").addEventListener(
        "keydown",
        e => {
          if (e.key === "Enter") {
            e.preventDefault();
            sendChat();
          }
        }
      );

      this.renderSegments();
      this.renderRooms();
      this.renderRoom();
      this.renderStatus();
      this.updateAvatarControls();

      this.setMessage(
        'Enter a match, then press "I AM INSIDE A MATCH".'
      );
    },

    toggle(force) {
      if (!this.root) {
        this.init();
      }

      if (
        typeof force === "boolean"
      ) {
        State.ui.open = force;
      } else {
        State.ui.open =
          !State.ui.open;
      }

      this.root.style.display =
        State.ui.open
          ? "block"
          : "none";
    },

    setMessage(text) {
      if (!this.els.msg) return;

      this.els.msg.textContent =
        String(text || "");
    },

    setScanState(scanning) {
      if (!this.scanButton) return;

      if (scanning) {
        this.scanButton.disabled =
          true;

        this.scanButton.textContent =
          "SCANNING...";
      } else if (
        State.confirmedMatch
      ) {
        this.scanButton.disabled =
          true;

        this.scanButton.textContent =
          "MULTIPLAYER ACTIVE";
      } else {
        this.scanButton.disabled =
          false;

        this.scanButton.textContent =
          "I AM INSIDE A MATCH";
      }
    },

    updateStatus(text) {
      if (!this.els.status) return;

      if (text) {
        this.els.status.textContent =
          String(text);
      }

      this.renderStatus();
    },

    renderStatus() {
      const el =
        this.els.status;

      if (!el) return;

      let text =
        "OFFLINE";

      let cls =
        "cn-status off";

      if (State.connecting) {
        text =
          "CONNECTING...";

        cls =
          "cn-status wait";
      } else if (
        State.connected
      ) {
        text =
          State.room
            ? "ONLINE • IN ROOM"
            : "ONLINE";

        cls =
          "cn-status on";
      }

      if (
        State.profile &&
        Number.isFinite(
          Number(
            State.profile.rtp
          )
        )
      ) {
        text +=
          " • RTP " +
          Number(
            State.profile.rtp
          );
      }

      el.textContent = text;
      el.className = cls;
    },

    renderSegments() {
      if (!this.els.segs) return;

      this.els.segs.innerHTML =
        "";

      this.segments.forEach(
        (seg, index) => {
          const row =
            document.createElement(
              "div"
            );

          row.className =
            "cn-seg";

          const input =
            document.createElement(
              "input"
            );

          input.className =
            "cn-input";

          input.placeholder =
            index === 0
              ? "Room name"
              : "More text";

          input.maxLength = 40;

          input.value =
            seg.text || "";

          const color =
            document.createElement(
              "input"
            );

          color.type =
            "color";

          color.className =
            "cn-color";

          color.value =
            safeColor(
              seg.color,
              "#ffffff"
            );

          const del =
            document.createElement(
              "button"
            );

          del.className =
            "cn-btn cn-dark cn-del";

          del.textContent =
            "×";

          del.title =
            "Remove segment";

          input.addEventListener(
            "input",
            () => {
              seg.text =
                input.value;

              this.updatePreview();
            }
          );

          color.addEventListener(
            "input",
            () => {
              seg.color =
                color.value;

              this.updatePreview();
            }
          );

          del.addEventListener(
            "click",
            () => {
              if (
                this.segments.length <=
                1
              ) {
                seg.text = "";
                input.value = "";

                this.updatePreview();

                return;
              }

              this.segments.splice(
                index,
                1
              );

              this.renderSegments();
            }
          );

          row.appendChild(
            input
          );

          row.appendChild(
            color
          );

          row.appendChild(
            del
          );

          this.els.segs.appendChild(
            row
          );
        }
      );

      this.updatePreview();
    },

    updatePreview() {
      if (!this.els.preview) {
        return;
      }

      const active =
        this.segments.filter(
          s =>
            String(
              s.text || ""
            ).trim()
        );

      if (!active.length) {
        this.els.preview.innerHTML =
          '<span class="cn-ph">Room name preview</span>';

        return;
      }

      this.els.preview.innerHTML =
        active
          .map(
            s =>
              `<span style="color:${safeColor(
                s.color
              )}">${escapeHtml(
                s.text
              )}</span>`
          )
          .join(" ");
    },

    renderRooms() {
      const root =
        this.els.rooms;

      if (!root) return;

      if (
        !Array.isArray(
          State.rooms
        ) ||
        !State.rooms.length
      ) {
        root.innerHTML =
          '<div class="cn-rooms-empty">No rooms found.</div>';

        return;
      }

      root.innerHTML =
        State.rooms
          .map(room => {
            const id =
              roomId(room);

            const name =
              coloredName(
                room.nameSegments,
                room.name ||
                  id ||
                  "Room"
              );

            const teamSize =
              clamp(
                parseInt(
                  room.teamSize,
                  10
                ) ||
                  Math.ceil(
                    safeNumber(
                      room.maxPlayers,
                      10
                    ) / 2
                  ),
                1,
                10
              );

            const maxPlayers =
              teamSize * 2;

            const players =
              Array.isArray(
                room.players
              )
                ? room.players.length
                : safeNumber(
                    room.playerCount ??
                      room.playersCount ??
                      room.count,
                    0
                  );

            const full =
              players >=
              maxPlayers;

            return `
              <div class="cn-room-item">
                <div style="min-width:0;flex:1;">
                  <div class="cn-rn">
                    ${name}
                    ${roomBadges(room)}
                  </div>

                  <div class="cn-sub">
                    ${players}/${maxPlayers} players
                    • ${teamSize} per team
                  </div>
                </div>

                <button
                  class="cn-btn ${full ? "cn-dark" : ""}"
                  data-join-room="${escapeHtml(id || "")}"
                  ${full || !id ? "disabled" : ""}
                >
                  ${full ? "Full" : "Join"}
                </button>
              </div>
            `;
          })
          .join("");
    },

    renderRoom() {
      const root =
        this.els.room;

      if (!root) return;

      if (!State.room) {
        root.innerHTML =
          '<span style="color:#777f8c;">No room</span>';

        this.renderStatus();

        return;
      }

      const room =
        getRoomObject(
          State.room
        );

      if (!room) {
        root.innerHTML =
          `<strong>${escapeHtml(
            State.room
          )}</strong>`;

        this.renderStatus();

        return;
      }

      const name =
        coloredName(
          room.nameSegments,
          room.name ||
            State.room
        );

      const teamSize =
        clamp(
          parseInt(
            room.teamSize,
            10
          ) ||
            Math.ceil(
              safeNumber(
                room.maxPlayers,
                10
              ) / 2
            ),
          1,
          10
        );

      const maxPlayers =
        teamSize * 2;

      const players =
        Array.isArray(
          room.players
        )
          ? room.players.length
          : safeNumber(
              room.playerCount ??
                room.playersCount ??
                room.count,
              0
            );

      root.innerHTML = `
        <div class="cn-rn">
          ${name}
          ${roomBadges(room)}
        </div>

        <div class="cn-sub" style="margin-top:4px;">
          ${players}/${maxPlayers} players
          • ${teamSize} per team
          ${State.isHost ? " • Host" : ""}
        </div>
      `;

      this.renderStatus();
    },

    addChatMessage(data) {
      if (!this.chatLog) return;

      const line =
        document.createElement(
          "div"
        );

      line.className =
        "cn-chat-line";

      const name =
        String(
          data.name ||
            data.playerName ||
            "Player"
        );

      const message =
        String(
          data.message ||
            data.text ||
            ""
        );

      const nameEl =
        document.createElement(
          "span"
        );

      nameEl.className =
        "cn-chat-name";

      nameEl.textContent =
        name + ": ";

      const msgEl =
        document.createElement(
          "span"
        );

      msgEl.textContent =
        message;

      line.appendChild(
        nameEl
      );

      line.appendChild(
        msgEl
      );

      this.chatLog.appendChild(
        line
      );

      while (
        this.chatLog.children
          .length > 100
      ) {
        this.chatLog.removeChild(
          this.chatLog.firstChild
        );
      }

      this.chatLog.scrollTop =
        this.chatLog.scrollHeight;
    },

    updateAvatarControls() {
      if (
        this.avatarToggle
      ) {
        this.avatarToggle.textContent =
          State.avatarEnabled
            ? "Avatar: ON"
            : "Avatar: OFF";
      }

      if (
        this.els.avatarPreview
      ) {
        if (
          State.avatar &&
          State.avatarEnabled
        ) {
          this.els.avatarPreview.src =
            State.avatar;

          this.els.avatarPreview.style.display =
            "block";
        } else {
          this.els.avatarPreview.removeAttribute(
            "src"
          );

          this.els.avatarPreview.style.display =
            "none";
        }
      }
    }
  };

  /* =========================================================
   * BACKGROUND ROUND CLOCK
   * ========================================================= */

  function updateHostBackgroundClock() {
    if (
      !State.confirmedMatch ||
      !State.connected ||
      !State.room ||
      !State.isHost
    ) {
      return;
    }

    const game =
      getGame();

    if (!game) return;

    const now =
      Date.now();

    let active = false;

    try {
      active =
        game.roundActive ===
        true;
    } catch {}

    /*
     * When the game tab is hidden,
     * Clutcher's requestAnimationFrame
     * can stop advancing its native
     * delta-time countdown.
     *
     * Connections keeps absolute
     * deadlines so the clock can still
     * progress.
     */
    if (active) {
      if (
        !State.hostRoundEndAt
      ) {
        const remaining =
          Math.max(
            0,
            safeNumber(
              game.roundTimeLeft,
              0
            )
          );

        State.hostRoundEndAt =
          now +
          remaining * 1000;
      }

      const remaining =
        Math.max(
          0,
          (
            State.hostRoundEndAt -
            now
          ) / 1000
        );

      try {
        game.roundTimeLeft =
          remaining;
      } catch {}

      if (
        remaining <= 0
      ) {
        /*
         * Clear the deadline before
         * calling endRound so the next
         * phase receives a new one.
         */
        State.hostRoundEndAt =
          0;

        try {
          if (
            typeof game.endRound ===
            "function"
          ) {
            game.endRound();
          } else {
            game.roundActive =
              false;
          }
        } catch (e) {
          warn(
            "Background endRound failed:",
            e
          );
        }
      }
    } else {
      if (
        !State.hostEndAt
      ) {
        const remaining =
          Math.max(
            0,
            safeNumber(
              game.endT,
              0
            )
          );

        State.hostEndAt =
          now +
          remaining * 1000;
      }

      const remaining =
        Math.max(
          0,
          (
            State.hostEndAt -
            now
          ) / 1000
        );

      try {
        game.endT =
          remaining;
      } catch {}

      if (
        remaining <= 0
      ) {
        State.hostEndAt =
          0;

        try {
          if (
            typeof game.startRound ===
            "function"
          ) {
            game.startRound();
          } else {
            game.roundActive =
              true;
          }
        } catch (e) {
          warn(
            "Background startRound failed:",
            e
          );
        }
      }
    }
  }

  function backgroundHeartbeat() {
    if (
      State.confirmedMatch &&
      State.room
    ) {
      if (State.isHost) {
        updateHostBackgroundClock();
        broadcastRoundState();
      } else {
        applyAuthoritativeMatchState();
      }
    }

    /*
     * Keep UI information fresh without
     * touching the game's HUD update()
     * method with invalid arguments.
     */
    if (
      State.ui.open
    ) {
      try {
        UI.renderStatus();
      } catch {}
    }
  }

  /* =========================================================
   * VISIBILITY / FOCUS
   * ========================================================= */

  function handleVisibilityChange() {
    /*
     * Do NOT leave the room or delete
     * remote players when focus changes.
     *
     * Multiplayer must survive Alt+Tab
     * and background tabs.
     */
    if (
      document.hidden
    ) {
      log(
        "Tab hidden. Keeping multiplayer active."
      );
    } else {
      log(
        "Tab visible."
      );

      if (
        State.connected &&
        State.room
      ) {
        Network.send({
          type: "ping",
          time: Date.now()
        });
      }
    }
  }

  document.addEventListener(
    "visibilitychange",
    handleVisibilityChange
  );

  window.addEventListener(
    "focus",
    () => {
      if (
        State.connected &&
        State.room
      ) {
        Network.send({
          type: "ping",
          time: Date.now()
        });
      }
    }
  );

  /* =========================================================
   * KEYBOARD
   * ========================================================= */

  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key !==
        "Backspace"
      ) {
        return;
      }

      const target =
        event.target;

      if (
        target &&
        (
          target.tagName ===
            "INPUT" ||
          target.tagName ===
            "TEXTAREA" ||
          target.isContentEditable
        )
      ) {
        return;
      }

      event.preventDefault();

      UI.toggle();
    },
    true
  );

  /* =========================================================
   * CLEANUP
   * ========================================================= */

  window.addEventListener(
    "beforeunload",
    () => {
      try {
        if (
          State.connected &&
          State.room
        ) {
          Network.send({
            type: "leave_room"
          });
        }
      } catch {}

      try {
        Music.stop();
      } catch {}
    }
  );

  /* =========================================================
   * DEBUG API
   * ========================================================= */

  PAGE.Connections = {
    version:
      CONFIG.VERSION,

    state:
      State,

    network:
      Network,

    remotes:
      RemoteBots,

    avatar:
      Avatar,

    music:
      Music,

    headBoost:
      HeadBoost,

    ui:
      UI,

    scan:
      scanEngine,

    confirm:
      confirmMatch,

    createRoom:
      createRoom,

    joinRoom:
      joinRoom,

    leaveRoom:
      leaveRoom,

    getGame,
    getPlayer,

    getRoom() {
      return getRoomObject(
        State.room
      );
    },

    sendState() {
      return sendLocalState();
    },

    roundSnapshot() {
      return getRoundSnapshot();
    },

    clearRemotes() {
      RemoteBots.clear();
    },

    reconnect() {
      Network.disconnect();

      setTimeout(
        () => {
          if (
            State.confirmedMatch
          ) {
            Network.connect();
          }
        },
        250
      );
    }
  };

  /* =========================================================
   * INITIALIZATION
   * ========================================================= */

  function initialize() {
    UI.init();

    startMonitor();
    startCheatScan();

    /*
     * Separate heartbeat from the game's
     * render loop.
     */
    if (
      !State.visibilityTimer
    ) {
      State.visibilityTimer =
        setInterval(
          backgroundHeartbeat,
          CONFIG.MATCH_CHECK_RATE
        );
    }

    log(
      "v" +
        CONFIG.VERSION +
        " ready."
    );

    log(
      "Press Backspace to open Connections."
    );

    /*
     * Start closed, matching the old
     * Connections behavior.
     */
    UI.toggle(false);

    /*
     * Detect the engine early, but do
     * not connect until the user confirms
     * they're inside a match.
     */
    const game =
      getGame();

    if (game) {
      State.game = game;

      log(
        "Game engine available."
      );
    }
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      initialize,
      {
        once: true
      }
    );
  } else {
    initialize();
  }

})();
