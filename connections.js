// ==UserScript==
// @name         Connections
// @namespace    conn
// @version      1.0.0
// @description  clutcher.io multiply players
// @match        *://clutcher.io/*
// @match        *://*.clutcher.io/*
// @grant        unsafeWindow
// @grant        GM_addStyle
// @connect      able-vpn-star-constitutional.trycloudflare.com
// ==/UserScript==

(() => {
  "use strict";

  const VERSION = "1.0.0";
  const WS_URL = "wss://able-vpn-star-constitutional.trycloudflare.com";

  const State = {
    ws: null,
    connected: false,
    connecting: false,

    id: null,
    name: "Player",

    room: null,
    rooms: [],

    joinedRoom: false,
    leavingRoom: false,

    remotes: new Map(),

    game: null,

    confirmedMatch: false,
    preparingBots: false,

    matchEnding: false,

    dead: false,
    deathSent: false,
    deathTime: 0,

    originalBots: [],
    botManager: null,
    botConstructor: null,
    botTemplate: null,

    UI: {},

    sendTimer: null,
    monitorTimer: null,
    botTimer: null,
    avatarTimer: null,

    localAvatar: null,
    avatarDirty: true,

    lastBotUpdate: 0
  };

  const log = (...a) => console.log("[Connections]", ...a);
  const warn = (...a) => console.warn("[Connections]", ...a);
  const error = (...a) => console.error("[Connections]", ...a);

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function randomRoom() {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";

    for (let i = 0; i < 14; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }

    return out;
  }

  function getGame() {
    if (State.game) return State.game;

    const w = unsafeWindow;

    const candidates = [
      w.game,
      w.Game,
      w.clutcher,
      w.__game,
      w.app,
      w.engine
    ];

    for (const candidate of candidates) {
      if (candidate && typeof candidate === "object") {
        State.game = candidate;
        return candidate;
      }
    }

    return null;
  }

  function getLocalPlayer() {
    const game = getGame();

    if (!game) return null;

    const candidates = [
      game.player,
      game.localPlayer,
      game.me,
      game.character,
      game.local,
      game.myPlayer,
      game.playerEntity
    ];

    for (const p of candidates) {
      if (p && typeof p === "object") {
        return p;
      }
    }

    return null;
  }

  function isInsideMatch() {
    const game = getGame();

    if (!game) return false;

    try {
      if (typeof game.isInMatch === "function") {
        if (game.isInMatch()) {
          return true;
        }
      }
    } catch {}

    if (game.gameState === "playing") return true;
    if (game.state === "playing") return true;
    if (game.inMatch === true) return true;

    if (
      game.match &&
      (
        game.match.isStarted === true ||
        game.match.started === true
      )
    ) {
      return true;
    }

    return false;
  }

  function getPosition(obj) {
    if (!obj) {
      return {
        x: 0,
        y: 0,
        z: 0
      };
    }

    const p =
      obj.position ||
      obj.pos ||
      obj.transform?.position ||
      obj.root?.position;

    if (p) {
      return {
        x: Number(p.x) || 0,
        y: Number(p.y) || 0,
        z: Number(p.z) || 0
      };
    }

    return {
      x: Number(obj.x) || 0,
      y: Number(obj.y) || 0,
      z: Number(obj.z) || 0
    };
  }

  function getRotation(obj) {
    if (!obj) {
      return {
        yaw: 0,
        pitch: 0
      };
    }

    const rot =
      obj.rotation ||
      obj.eulerAngles ||
      obj.transform?.rotation;

    if (rot) {
      return {
        yaw: Number(rot.y) || 0,
        pitch: Number(rot.x) || 0
      };
    }

    return {
      yaw: Number(obj.yaw) || 0,
      pitch: Number(obj.pitch) || 0
    };
  }

  function setPosition(obj, x, y, z) {
    if (!obj) return;

    try {
      if (obj.position) {
        obj.position.x = x;
        obj.position.y = y;
        obj.position.z = z;
        return;
      }

      if (obj.transform?.position) {
        obj.transform.position.x = x;
        obj.transform.position.y = y;
        obj.transform.position.z = z;
        return;
      }

      obj.x = x;
      obj.y = y;
      obj.z = z;
    } catch {}
  }

  function setVisible(obj, visible) {
    if (!obj) return;

    try {
      if ("visible" in obj) {
        obj.visible = visible;
      }
    } catch {}

    try {
      if ("enabled" in obj) {
        obj.enabled = visible;
      }
    } catch {}

    try {
      if (obj.gameObject && "active" in obj.gameObject) {
        obj.gameObject.active = visible;
      }
    } catch {}

    try {
      if (obj.root) {
        obj.root.visible = visible;
      }
    } catch {}

    try {
      if (obj.mesh) {
        obj.mesh.visible = visible;
      }
    } catch {}
  }

  function getAliveValue(player) {
    if (!player) return true;

    if (typeof player.alive === "boolean") {
      return player.alive;
    }

    if (typeof player.isAlive === "boolean") {
      return player.isAlive;
    }

    if (typeof player.dead === "boolean") {
      return !player.dead;
    }

    if (typeof player.health === "number") {
      return player.health > 0;
    }

    return true;
  }

  function readLocalAlive() {
    const player = getLocalPlayer();

    if (!player) {
      return !State.dead;
    }

    if (State.dead) {
      return false;
    }

    if (
      typeof player.alive === "boolean" &&
      !player.alive
    ) {
      return false;
    }

    if (
      typeof player.isAlive === "boolean" &&
      !player.isAlive
    ) {
      return false;
    }

    if (
      typeof player.dead === "boolean" &&
      player.dead
    ) {
      return false;
    }

    if (
      typeof player.health === "number" &&
      player.health <= 0
    ) {
      return false;
    }

    return true;
  }

  function forceLocalDeath(reason = "unknown") {
    if (State.dead) return;

    State.dead = true;
    State.deathSent = false;
    State.deathTime = performance.now();

    log("Local player died:", reason);

    const player = getLocalPlayer();

    if (!player) return;

    try {
      player.health = 0;
    } catch {}

    try {
      player.alive = false;
    } catch {}

    try {
      player.isAlive = false;
    } catch {}

    try {
      player.dead = true;
    } catch {}

    const funcs = [
      "die",
      "kill",
      "onDeath",
      "death",
      "handleDeath"
    ];

    for (const fn of funcs) {
      try {
        if (typeof player[fn] === "function") {
          player[fn]();
          break;
        }
      } catch {}
    }
  }

  function checkLocalDeath() {
    if (State.dead) return;

    if (!readLocalAlive()) {
      forceLocalDeath("engine reported dead");
    }
  }

  function enforceLocalDeath() {
    if (!State.dead) return;

    const player = getLocalPlayer();

    if (!player) return;

    try {
      player.health = 0;
    } catch {}

    try {
      player.alive = false;
    } catch {}

    try {
      player.isAlive = false;
    } catch {}

    try {
      player.dead = true;
    } catch {}
  }

  function getAvatar() {
    try {
      if (
        localStorage.getItem("pp-avatar-on") === "0"
      ) {
        return null;
      }

      return localStorage.getItem("pp-avatar") || null;
    } catch {
      return null;
    }
  }

  function saveAvatar(data) {
    try {
      localStorage.setItem("pp-avatar", data);
      localStorage.setItem("pp-avatar-on", "1");

      State.localAvatar = data;
      State.avatarDirty = true;

      log("Avatar saved.");
    } catch (e) {
      error("Could not save avatar.", e);
    }
  }

  function resetAvatar() {
    try {
      localStorage.removeItem("pp-avatar");
      localStorage.setItem("pp-avatar-on", "0");

      State.localAvatar = null;
      State.avatarDirty = true;
    } catch {}
  }

  function NetworkSend(type, data = {}) {
    if (
      !State.ws ||
      State.ws.readyState !== WebSocket.OPEN
    ) {
      return false;
    }

    try {
      State.ws.send(
        JSON.stringify({
          type,
          ...data
        })
      );

      return true;
    } catch (e) {
      error("NetworkSend failed:", e);
      return false;
    }
  }

  const Network = {
    connect() {
      if (State.connecting) {
        return;
      }

      if (!State.room) {
        warn("No room selected.");
        updateStatus("Enter a room ID.");
        return;
      }

      if (
        State.ws &&
        State.ws.readyState === WebSocket.OPEN
      ) {
        if (!State.joinedRoom && !State.leavingRoom) {
          this.joinRoom();
        }

        return;
      }

      State.connecting = true;

      log("Connecting to multiplayer server...");

      let ws;

      try {
        ws = new WebSocket(WS_URL);
      } catch (e) {
        State.connecting = false;
        error("WebSocket creation failed:", e);
        return;
      }

      State.ws = ws;

      ws.onopen = () => {
        State.connecting = false;
        State.connected = true;
        State.joinedRoom = false;
        State.leavingRoom = false;

        log("Network connected.");

        NetworkSend("hello", {
          name: State.name
        });

        this.joinRoom();

        updateRoomUI();
      };

      ws.onmessage = event => {
        let msg;

        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        Network.handle(msg);
      };

      ws.onerror = e => {
        warn("WebSocket error.", e);
      };

      ws.onclose = () => {
        State.connected = false;
        State.connecting = false;
        State.joinedRoom = false;
        State.ws = null;

        stopStateLoop();

        BotSystem.clear();

        log("Network disconnected.");

        if (State.leavingRoom) {
          State.room = null;
          State.leavingRoom = false;

          try {
            localStorage.removeItem(
              "connections_room"
            );
          } catch {}
        }

        updateRoomUI();
      };
    },

    joinRoom() {
      if (!State.room) {
        warn("Cannot join: no room selected.");
        return false;
      }

      if (
        !State.ws ||
        State.ws.readyState !== WebSocket.OPEN
      ) {
        return false;
      }

      State.leavingRoom = false;

      const sent = NetworkSend(
        "join_room",
        {
          room: State.room,
          roomId: State.room,
          id: State.id,
          name: State.name
        }
      );

      if (sent) {
        log("Joining room:", State.room);
        updateStatus(
          `Joining • ${State.room}`
        );
      }

      return sent;
    },

    leaveRoom() {
      if (
        !State.ws ||
        State.ws.readyState !== WebSocket.OPEN
      ) {
        return false;
      }

      if (!State.joinedRoom && !State.confirmedMatch) {
        return false;
      }

      State.leavingRoom = true;

      stopStateLoop();

      State.confirmedMatch = false;

      BotSystem.clear();

      const sent = NetworkSend(
        "leave_room"
      );

      if (sent) {
        log("Leaving room:", State.room);

        updateStatus(
          "Leaving room..."
        );
      }

      return sent;
    },

    handle(msg) {
      if (!msg || !msg.type) {
        return;
      }

      switch (msg.type) {
        case "connected": {
          const id =
            msg.id ??
            msg.clientId ??
            msg.playerId ??
            msg.data?.id ??
            msg.data?.clientId ??
            msg.data?.playerId;

          if (id != null) {
            State.id = String(id);
          }

          break;
        }

        case "hello": {
          const id =
            msg.id ??
            msg.clientId ??
            msg.playerId ??
            msg.client?.id ??
            msg.player?.id ??
            msg.data?.id ??
            msg.data?.clientId ??
            msg.data?.playerId;

          if (id != null) {
            State.id = String(id);
          }

          break;
        }

        case "rooms": {
          const rooms =
            msg.rooms ??
            msg.data?.rooms ??
            [];

          if (Array.isArray(rooms)) {
            State.rooms = rooms;
          }

          break;
        }

        case "room_joined": {
          const room =
            msg.room ??
            msg.roomId ??
            msg.data?.room ??
            msg.data?.roomId;

          if (room) {
            State.room = String(room);

            try {
              localStorage.setItem(
                "connections_room",
                State.room
              );
            } catch {}
          }

          const id =
            msg.id ??
            msg.clientId ??
            msg.playerId ??
            msg.data?.id ??
            msg.data?.clientId ??
            msg.data?.playerId;

          if (id != null) {
            State.id = String(id);
          }

          State.joinedRoom = true;
          State.leavingRoom = false;

          log(
            "Joined room:",
            State.room
          );

          updateRoomUI();

          if (
            State.confirmedMatch &&
            !State.sendTimer
          ) {
            startStateLoop();
          }

          break;
        }

        case "player_joined": {
          State.avatarDirty = true;

          log(
            "Player joined:",
            msg.name ||
            msg.player?.name ||
            msg.data?.name ||
            "unknown"
          );

          break;
        }

        case "player_left": {
          const id =
            msg.id ??
            msg.clientId ??
            msg.playerId ??
            msg.player?.id ??
            msg.data?.id ??
            msg.data?.clientId ??
            msg.data?.playerId;

          if (id != null) {
            BotSystem.remove(
              String(id)
            );
          }

          break;
        }

        case "state": {
          Network.handleState(msg);
          break;
        }

        case "left_room": {
          State.joinedRoom = false;

          stopStateLoop();

          State.confirmedMatch = false;

          BotSystem.clear();

          if (State.leavingRoom) {
            State.room = null;
            State.leavingRoom = false;

            try {
              localStorage.removeItem(
                "connections_room"
              );
            } catch {}

            updateRoomUI();

            log("Left room.");
          } else {
            updateRoomUI();

            log(
              "Server confirmed room leave."
            );
          }

          break;
        }

        case "room_deleted": {
          State.joinedRoom = false;
          State.leavingRoom = false;

          stopStateLoop();

          State.confirmedMatch = false;

          State.room = null;

          BotSystem.clear();

          try {
            localStorage.removeItem(
              "connections_room"
            );
          } catch {}

          updateRoomUI();

          log(
            "Room deleted by server."
          );

          break;
        }

        case "error": {
          console.error(
            "[Connections] Server error:",
            msg.error ||
            msg.message ||
            msg.data ||
            msg
          );

          break;
        }

        case "pong":
          break;
      }
    },

    handleState(msg) {
      const rawState =
        msg.state ||
        msg.player ||
        msg.data;

      if (
        !rawState ||
        typeof rawState !== "object"
      ) {
        return;
      }

      const id =
        msg.id ??
        msg.clientId ??
        msg.playerId ??
        msg.client?.id ??
        msg.player?.id ??
        rawState.id ??
        rawState.clientId ??
        rawState.playerId ??
        msg.data?.id ??
        msg.data?.clientId ??
        msg.data?.playerId;

      let remoteId =
        id != null
          ? String(id)
          : null;

      if (!remoteId) {
        const remoteName =
          rawState.name ||
          msg.name ||
          msg.player?.name ||
          msg.data?.name;

        if (
          remoteName &&
          String(remoteName) ===
            String(State.name)
        ) {
          return;
        }

        return;
      }

      if (
        State.id != null &&
        remoteId === String(State.id)
      ) {
        return;
      }

      let remote =
        State.remotes.get(
          remoteId
        );

      if (!remote) {
        remote = {
          id: remoteId,

          name:
            rawState.name ||
            msg.name ||
            "Player",

          team:
            rawState.team ??
            null,

          x:
            Number(rawState.x) || 0,

          y:
            Number(rawState.y) || 0,

          z:
            Number(rawState.z) || 0,

          yaw:
            Number(rawState.yaw) || 0,

          pitch:
            Number(rawState.pitch) || 0,

          targetX:
            Number(rawState.x) || 0,

          targetY:
            Number(rawState.y) || 0,

          targetZ:
            Number(rawState.z) || 0,

          targetYaw:
            Number(rawState.yaw) || 0,

          targetPitch:
            Number(rawState.pitch) || 0,

          alive: true,
          dead: false,
          health: 100,

          avatar:
            rawState.avatar ||
            null,

          bot: null,
          spawned: false,

          lastUpdate:
            performance.now()
        };

        State.remotes.set(
          remoteId,
          remote
        );

        log(
          "Remote player detected:",
          remote.name
        );
      }

      remote.name =
        rawState.name ||
        remote.name;

      remote.team =
        rawState.team ??
        remote.team;

      remote.targetX =
        Number(rawState.x) || 0;

      remote.targetY =
        Number(rawState.y) || 0;

      remote.targetZ =
        Number(rawState.z) || 0;

      remote.targetYaw =
        Number(rawState.yaw) || 0;

      remote.targetPitch =
        Number(rawState.pitch) || 0;

      if (
        typeof rawState.health ===
        "number"
      ) {
        remote.health =
          rawState.health;
      }

      remote.avatar =
        rawState.avatar ||
        null;

      const reportedAlive =
        rawState.alive !== false &&
        rawState.dead !== true &&
        remote.health > 0;

      remote.alive =
        reportedAlive;

      remote.dead =
        !reportedAlive;

      remote.lastUpdate =
        performance.now();

      if (remote.dead) {
        BotSystem.kill(remote);
        return;
      }

      if (!remote.bot) {
        BotSystem.create(remote);
      }
    }
  };

  function sendLocalState() {
    checkLocalDeath();

    if (!State.confirmedMatch) {
      return;
    }

    if (!State.joinedRoom) {
      return;
    }

    if (
      !State.ws ||
      State.ws.readyState !==
        WebSocket.OPEN
    ) {
      return;
    }

    const player =
      getLocalPlayer();

    if (
      !player &&
      !State.dead
    ) {
      return;
    }

    const pos =
      getPosition(player);

    const rot =
      getRotation(player);

    const alive =
      !State.dead &&
      readLocalAlive();

    const health =
      State.dead
        ? 0
        : (
          typeof player?.health ===
          "number"
            ? player.health
            : 100
        );

    const state = {
      x: pos.x,
      y: pos.y,
      z: pos.z,

      yaw: rot.yaw,
      pitch: rot.pitch,

      alive,
      dead: State.dead,
      health,

      team:
        player?.team ??
        null,

      name:
        State.name,

      avatar:
        State.localAvatar ||
        getAvatar() ||
        null
    };

    if (State.dead) {
      state.alive = false;
      state.dead = true;
      state.health = 0;
    }

    NetworkSend(
      "state",
      {
        state
      }
    );

    if (State.dead) {
      State.deathSent = true;
    }
  }

  function startStateLoop() {
    stopStateLoop();

    if (!State.confirmedMatch) {
      return;
    }

    if (!State.joinedRoom) {
      return;
    }

    State.sendTimer =
      setInterval(
        sendLocalState,
        50
      );
  }

  function stopStateLoop() {
    if (State.sendTimer) {
      clearInterval(
        State.sendTimer
      );

      State.sendTimer = null;
    }
  }

  const BotSystem = {
    findManager() {
      const game =
        getGame();

      if (!game) {
        return null;
      }

      const candidates = [
        game.botManager,
        game.bots,
        game.botMgr,
        game.aiManager,
        game.entities?.botManager
      ];

      for (
        const manager of candidates
      ) {
        if (!manager) {
          continue;
        }

        if (
          Array.isArray(manager)
        ) {
          return {
            bots: manager
          };
        }

        if (
          Array.isArray(
            manager.bots
          )
        ) {
          return manager;
        }

        if (
          Array.isArray(
            manager.entities
          )
        ) {
          return {
            bots:
              manager.entities
          };
        }
      }

      return null;
    },

    preparePool() {
      if (State.preparingBots) {
        return;
      }

      State.preparingBots = true;

      const manager =
        this.findManager();

      if (!manager) {
        warn(
          "Could not find native bot manager."
        );

        State.preparingBots = false;
        return;
      }

      State.botManager =
        manager;

      const bots =
        Array.isArray(manager)
          ? manager
          : manager.bots;

      if (!Array.isArray(bots)) {
        State.preparingBots = false;
        return;
      }

      State.originalBots =
        bots.slice();

      if (
        State.originalBots.length &&
        State.originalBots[0]
      ) {
        State.botConstructor =
          State.originalBots[0]
            .constructor;

        State.botTemplate =
          State.originalBots[0];
      }

      for (
        const bot of
        State.originalBots
      ) {
        try {
          bot.__connectionsNative =
            true;

          bot.__connectionsPooled =
            true;
        } catch {}

        setVisible(
          bot,
          false
        );

        try {
          if ("enabled" in bot) {
            bot.enabled = false;
          }
        } catch {}
      }

      bots.length = 0;

      log(
        "Native bots removed from manager:",
        State.originalBots.length
      );

      State.preparingBots = false;
    },

    create(remote) {
      if (!remote) {
        return null;
      }

      if (
        remote.dead ||
        remote.alive === false
      ) {
        return null;
      }

      if (remote.bot) {
        return remote.bot;
      }

      if (remote.spawned) {
        return remote.bot || null;
      }

      remote.spawned = true;

      const manager =
        State.botManager;

      if (!manager) {
        remote.spawned = false;
        return null;
      }

      const bots =
        Array.isArray(manager)
          ? manager
          : manager.bots;

      if (!Array.isArray(bots)) {
        remote.spawned = false;
        return null;
      }

      let bot = null;

      try {
        if (
          typeof State.botConstructor ===
          "function"
        ) {
          const game =
            getGame();

          bot =
            new State.botConstructor(
              game,
              remote.team,
              remote.name,
              3
            );
        }
      } catch (e) {
        warn(
          "Native bot constructor failed:",
          e
        );
      }

      if (!bot) {
        remote.spawned = false;
        return null;
      }

      bot.__connectionsRemote =
        true;

      bot.__connectionsRemoteId =
        remote.id;

      try {
        bot.__connectionsOriginalName =
          bot.name;
      } catch {}

      try {
        bot.name =
          remote.name;
      } catch {}

      try {
        bot.health =
          Number.isFinite(
            remote.health
          )
            ? remote.health
            : 100;
      } catch {}

      try {
        bot.alive = true;
      } catch {}

      try {
        bot.isAlive = true;
      } catch {}

      try {
        bot.dead = false;
      } catch {}

      setVisible(
        bot,
        true
      );

      setPosition(
        bot,
        remote.targetX,
        remote.targetY,
        remote.targetZ
      );

      try {
        if (
          typeof bot.spawn ===
          "function"
        ) {
          bot.spawn();
        }
      } catch {}

      bots.push(bot);

      remote.bot =
        bot;

      State.avatarDirty = true;

      log(
        "Remote bot created:",
        remote.name,
        remote.id
      );

      return bot;
    },

    kill(remote) {
      if (!remote) {
        return;
      }

      remote.alive = false;
      remote.dead = true;
      remote.health = 0;

      const bot =
        remote.bot;

      if (!bot) {
        return;
      }

      try {
        bot.health = 0;
      } catch {}

      try {
        bot.alive = false;
      } catch {}

      try {
        bot.isAlive = false;
      } catch {}

      try {
        bot.dead = true;
      } catch {}

      const funcs = [
        "die",
        "kill",
        "onDeath",
        "death",
        "handleDeath"
      ];

      for (
        const fn of funcs
      ) {
        try {
          if (
            typeof bot[fn] ===
            "function"
          ) {
            bot[fn]();
            break;
          }
        } catch {}
      }

      try {
        if (
          bot.agent &&
          typeof bot.agent.die ===
          "function"
        ) {
          bot.agent.die();
        }
      } catch {}

      setVisible(
        bot,
        false
      );
    },

    update(remote, dt) {
      if (
        !remote ||
        !remote.bot
      ) {
        return;
      }

      const bot =
        remote.bot;

      if (
        remote.dead ||
        remote.alive === false ||
        remote.health <= 0
      ) {
        this.kill(remote);
        return;
      }

      const smooth =
        Math.min(
          1,
          Math.max(
            0.05,
            dt * 12
          )
        );

      remote.x +=
        (
          remote.targetX -
          remote.x
        ) *
        smooth;

      remote.y +=
        (
          remote.targetY -
          remote.y
        ) *
        smooth;

      remote.z +=
        (
          remote.targetZ -
          remote.z
        ) *
        smooth;

      remote.yaw +=
        (
          remote.targetYaw -
          remote.yaw
        ) *
        smooth;

      remote.pitch +=
        (
          remote.targetPitch -
          remote.pitch
        ) *
        smooth;

      const oldX =
        getPosition(bot).x;

      const oldZ =
        getPosition(bot).z;

      setPosition(
        bot,
        remote.x,
        remote.y,
        remote.z
      );

      try {
        bot.health =
          Number.isFinite(
            remote.health
          )
            ? remote.health
            : bot.health;
      } catch {}

      try {
        bot.alive = true;
      } catch {}

      try {
        bot.isAlive = true;
      } catch {}

      try {
        bot.dead = false;
      } catch {}

      try {
        if (
          bot.cs2Agent &&
          typeof bot.cs2Agent.update ===
          "function"
        ) {
          const vx =
            (
              remote.x -
              oldX
            ) /
            Math.max(
              dt,
              0.001
            );

          const vz =
            (
              remote.z -
              oldZ
            ) /
            Math.max(
              dt,
              0.001
            );

          bot.cs2Agent.update(
            dt,
            {
              vx,
              vz,
              airborne: false,
              crouch: 0,
              pitch:
                remote.pitch
            }
          );
        }
      } catch {}
    },

    updateAll(dt) {
      for (
        const remote of
        State.remotes.values()
      ) {
        if (
          remote.dead ||
          remote.alive === false
        ) {
          this.kill(remote);
          continue;
        }

        if (!remote.bot) {
          this.create(remote);
          continue;
        }

        this.update(
          remote,
          dt
        );
      }
    },

    remove(id) {
      const remote =
        State.remotes.get(
          String(id)
        );

      if (!remote) {
        return;
      }

      const bot =
        remote.bot;

      if (
        bot &&
        State.botManager
      ) {
        const bots =
          Array.isArray(
            State.botManager
          )
            ? State.botManager
            : State.botManager.bots;

        if (Array.isArray(bots)) {
          const index =
            bots.indexOf(bot);

          if (index !== -1) {
            bots.splice(
              index,
              1
            );
          }
        }
      }

      State.remotes.delete(
        String(id)
      );

      State.avatarDirty =
        true;

      log(
        "Remote removed:",
        id
      );
    },

    clear() {
      if (State.botManager) {
        const bots =
          Array.isArray(
            State.botManager
          )
            ? State.botManager
            : State.botManager.bots;

        if (Array.isArray(bots)) {
          for (
            let i =
              bots.length - 1;
            i >= 0;
            i--
          ) {
            const bot =
              bots[i];

            if (
              bot &&
              bot.__connectionsRemote
            ) {
              try {
                if (
                  typeof bot.die ===
                  "function"
                ) {
                  bot.die();
                }
              } catch {}

              bots.splice(
                i,
                1
              );
            }
          }

          if (
            State.originalBots.length &&
            State.leavingRoom
          ) {
            for (
              const original of
              State.originalBots
            ) {
              if (
                !bots.includes(
                  original
                )
              ) {
                try {
                  original.__connectionsPooled =
                    false;
                } catch {}

                try {
                  original.__connectionsNative =
                    true;
                } catch {}

                try {
                  original.health =
                    100;
                } catch {}

                try {
                  original.alive =
                    true;
                } catch {}

                try {
                  original.isAlive =
                    true;
                } catch {}

                try {
                  original.dead =
                    false;
                } catch {}

                setVisible(
                  original,
                  true
                );

                bots.push(
                  original
                );
              }
            }
          }
        }
      }

      State.remotes.clear();
      State.avatarDirty =
        true;
    }
  };

  function updateRemoteBots() {
    const now =
      performance.now();

    if (!State.lastBotUpdate) {
      State.lastBotUpdate =
        now;
    }

    const dt =
      Math.min(
        0.1,
        Math.max(
          0.001,
          (
            now -
            State.lastBotUpdate
          ) / 1000
        )
      );

    State.lastBotUpdate =
      now;

    if (
      State.confirmedMatch &&
      State.connected &&
      State.joinedRoom
    ) {
      BotSystem.updateAll(
        dt
      );
    }
  }

  function startBotLoop() {
    if (State.botTimer) {
      clearInterval(
        State.botTimer
      );
    }

    State.botTimer =
      setInterval(
        updateRemoteBots,
        100
      );
  }

  function stopBotLoop() {
    if (State.botTimer) {
      clearInterval(
        State.botTimer
      );

      State.botTimer = null;
    }
  }

  const RemoteAvatars = {
    getElements() {
      const game =
        getGame();

      if (!game) {
        return [];
      }

      const result = [];

      const sources = [
        game.hud?._avatars,
        game._avatars
      ];

      for (
        const list of sources
      ) {
        if (
          !Array.isArray(list)
        ) {
          continue;
        }

        for (
          const item of list
        ) {
          if (!item) {
            continue;
          }

          if (
            item.ent &&
            item.el
          ) {
            result.push(
              item
            );
          }
        }
      }

      return result;
    },

    apply() {
      const elements =
        this.getElements();

      if (!elements.length) {
        return;
      }

      const remoteList =
        Array.from(
          State.remotes.values()
        );

      for (
        const item of elements
      ) {
        const ent =
          item.ent;

        const el =
          item.el;

        if (
          !ent ||
          !el
        ) {
          continue;
        }

        if (
          !ent.__connectionsRemote
        ) {
          continue;
        }

        const id =
          ent.__connectionsRemoteId;

        const remote =
          State.remotes.get(
            String(id)
          );

        if (!remote) {
          continue;
        }

        if (!remote.avatar) {
          continue;
        }

        try {
          el.src =
            remote.avatar;

          el.style.display =
            "";
        } catch {}
      }

      for (
        const remote of
        remoteList
      ) {
        if (!remote.avatar) {
          continue;
        }

        const bot =
          remote.bot;

        if (!bot) {
          continue;
        }

        try {
          bot.__connectionsAvatar =
            remote.avatar;
        } catch {}
      }
    }
  };

  function startAvatarLoop() {
    if (State.avatarTimer) {
      clearInterval(
        State.avatarTimer
      );
    }

    State.avatarTimer =
      setInterval(
        () => {
          RemoteAvatars.apply();
        },
        250
      );
  }

  function stopAvatarLoop() {
    if (State.avatarTimer) {
      clearInterval(
        State.avatarTimer
      );

      State.avatarTimer = null;
    }
  }

  function keepGameUnpaused() {
    if (!State.confirmedMatch) {
      return;
    }

    const game =
      getGame();

    if (!game) {
      return;
    }

    try {
      game.paused = false;
    } catch {}

    try {
      game.isPaused = false;
    } catch {}

    try {
      game.pauseOnBlur = false;
    } catch {}

    try {
      game.pauseOnHidden = false;
    } catch {}

    try {
      game.shouldPauseOnBlur =
        false;
    } catch {}

    try {
      game.shouldPauseOnVisibility =
        false;
    } catch {}
  }

  function installTabGuard() {
    if (
      unsafeWindow.__connectionsTabGuard
    ) {
      return;
    }

    unsafeWindow.__connectionsTabGuard =
      true;

    try {
      Object.defineProperty(
        document,
        "hidden",
        {
          configurable: true,

          get() {
            return false;
          }
        }
      );
    } catch {}

    try {
      Object.defineProperty(
        document,
        "visibilityState",
        {
          configurable: true,

          get() {
            return "visible";
          }
        }
      );
    } catch {}

    const stop =
      event => {
        if (
          !unsafeWindow.__connectionsTabGuard
        ) {
          return;
        }

        if (
          !State.confirmedMatch
        ) {
          return;
        }

        try {
          event.stopImmediatePropagation();
        } catch {}
      };

    [
      "blur",
      "pagehide",
      "visibilitychange",
      "webkitvisibilitychange"
    ].forEach(
      type => {
        window.addEventListener(
          type,
          stop,
          true
        );

        document.addEventListener(
          type,
          stop,
          true
        );
      }
    );

    setInterval(
      keepGameUnpaused,
      250
    );
  }

  async function prepareMatch() {
    if (State.preparingBots) {
      return;
    }

    State.preparingBots =
      true;

    updateStatus(
      "Scanning engine..."
    );

    await sleep(150);

    State.game =
      getGame();

    if (!State.game) {
      State.preparingBots =
        false;

      updateStatus(
        "Engine not found."
      );

      return;
    }

    BotSystem.preparePool();

    State.localAvatar =
      getAvatar();

    State.confirmedMatch =
      true;

    State.matchEnding =
      false;

    State.dead =
      false;

    State.deathSent =
      false;

    installTabGuard();

    updateStatus(
      "Ready"
    );

    State.preparingBots =
      false;

    Network.connect();

    if (
      State.connected &&
      State.joinedRoom
    ) {
      startStateLoop();
    }

    startBotLoop();
    startAvatarLoop();

    log(
      "Match confirmed. Multiplayer enabled."
    );
  }

  function endMatch() {
    if (!State.confirmedMatch) {
      return;
    }

    State.confirmedMatch =
      false;

    State.matchEnding =
      true;

    stopStateLoop();

    BotSystem.clear();

    State.dead =
      false;

    State.deathSent =
      false;

    log(
      "Match ended."
    );
  }

  function createUI() {
    if (State.UI.root) {
      return;
    }

    GM_addStyle(`
      #connections-root {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 430px;
        max-width: calc(100vw - 30px);
        background: rgba(12,12,16,.97);
        border: 1px solid #34343d;
        border-radius: 14px;
        padding: 16px;
        z-index: 2147483647;
        color: #eee;
        font-family: Arial, sans-serif;
        box-shadow: 0 20px 80px rgba(0,0,0,.6);
        display: none;
      }

      #connections-root * {
        box-sizing: border-box;
      }

      #connections-title {
        font-size: 20px;
        font-weight: 700;
        margin-bottom: 4px;
      }

      #connections-version {
        color: #777;
        font-size: 11px;
        margin-bottom: 15px;
      }

      .connections-label {
        display: block;
        color: #999;
        font-size: 11px;
        margin-bottom: 5px;
      }

      .connections-input {
        width: 100%;
        background: #18181e;
        border: 1px solid #33333c;
        color: #eee;
        border-radius: 8px;
        padding: 10px;
        outline: none;
        margin-bottom: 10px;
      }

      .connections-input:focus {
        border-color: #666675;
      }

      .connections-row {
        display: flex;
        gap: 8px;
      }

      .connections-btn {
        flex: 1;
        border: 1px solid #35353e;
        background: #1b1b22;
        color: #eee;
        border-radius: 8px;
        padding: 10px;
        cursor: pointer;
        font-weight: 600;
      }

      .connections-btn:hover {
        background: #25252e;
      }

      .connections-btn.primary {
        background: #5b45ff;
        border-color: #725fff;
      }

      .connections-btn.primary:hover {
        background: #6a55ff;
      }

      .connections-btn.danger {
        background: #35191c;
        border-color: #5b282d;
      }

      #connections-status {
        margin-top: 12px;
        padding: 9px;
        border-radius: 8px;
        background: #15151a;
        color: #999;
        font-size: 12px;
      }

      #connections-match {
        margin-top: 12px;
        padding: 12px;
        border-radius: 9px;
        background: #17171d;
        border: 1px solid #292932;
      }

      #connections-avatar-preview {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        object-fit: cover;
        background: #222;
        border: 1px solid #3a3a44;
      }

      #connections-avatar-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 12px;
      }

      #connections-debug {
        margin-top: 10px;
        color: #666;
        font-size: 10px;
        word-break: break-all;
      }
    `);

    const root =
      document.createElement(
        "div"
      );

    root.id =
      "connections-root";

    root.innerHTML = `
      <div id="connections-title">
        Connections
      </div>

      <div id="connections-version">
        v${VERSION}
      </div>

      <label class="connections-label">
        Name
      </label>

      <input
        id="connections-name"
        class="connections-input"
        placeholder="Player"
        maxlength="24"
      >

      <label class="connections-label">
        Room
      </label>

      <div class="connections-row">
        <input
          id="connections-room"
          class="connections-input"
          style="margin-bottom:0"
          placeholder="Room ID"
        >

        <button
          id="connections-random"
          class="connections-btn"
          style="max-width:110px"
        >
          Random
        </button>
      </div>

      <div id="connections-match">
        <button
          id="connections-confirm"
          class="connections-btn primary"
        >
          I AM IN A MATCH
        </button>

        <button
          id="connections-leave"
          class="connections-btn danger"
          style="margin-top:8px"
        >
          Leave Room
        </button>
      </div>

      <div id="connections-avatar-row">
        <img
          id="connections-avatar-preview"
        >

        <div style="flex:1">
          <div class="connections-label">
            Avatar
          </div>

          <div class="connections-row">
            <button
              id="connections-avatar"
              class="connections-btn"
            >
              Choose
            </button>

            <button
              id="connections-avatar-reset"
              class="connections-btn"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <input
        id="connections-avatar-file"
        type="file"
        accept="image/*"
        style="display:none"
      >

      <div id="connections-status">
        Disconnected
      </div>

      <div id="connections-debug"></div>
    `;

    document.body.appendChild(
      root
    );

    State.UI.root =
      root;

    State.UI.name =
      root.querySelector(
        "#connections-name"
      );

    State.UI.room =
      root.querySelector(
        "#connections-room"
      );

    State.UI.random =
      root.querySelector(
        "#connections-random"
      );

    State.UI.confirm =
      root.querySelector(
        "#connections-confirm"
      );

    State.UI.leave =
      root.querySelector(
        "#connections-leave"
      );

    State.UI.status =
      root.querySelector(
        "#connections-status"
      );

    State.UI.avatar =
      root.querySelector(
        "#connections-avatar"
      );

    State.UI.avatarReset =
      root.querySelector(
        "#connections-avatar-reset"
      );

    State.UI.avatarFile =
      root.querySelector(
        "#connections-avatar-file"
      );

    State.UI.avatarPreview =
      root.querySelector(
        "#connections-avatar-preview"
      );

    State.UI.debug =
      root.querySelector(
        "#connections-debug"
      );

    const savedName =
      localStorage.getItem(
        "connections_name"
      );

    const savedRoom =
      localStorage.getItem(
        "connections_room"
      );

    State.name =
      savedName ||
      State.name;

    State.room =
      savedRoom ||
      randomRoom();

    State.UI.name.value =
      State.name;

    State.UI.room.value =
      State.room;

    State.localAvatar =
      getAvatar();

    updateAvatarPreview();

    State.UI.name.addEventListener(
      "input",
      () => {
        State.name =
          State.UI.name.value.trim() ||
          "Player";

        localStorage.setItem(
          "connections_name",
          State.name
        );
      }
    );

    State.UI.room.addEventListener(
      "input",
      () => {
        const value =
          State.UI.room.value.trim();

        if (
          State.connected &&
          State.joinedRoom
        ) {
          return;
        }

        State.room =
          value;

        localStorage.setItem(
          "connections_room",
          State.room
        );
      }
    );

    State.UI.random.addEventListener(
      "click",
      () => {
        if (
          State.connected &&
          State.joinedRoom
        ) {
          updateStatus(
            "Leave the current room first."
          );

          return;
        }

        const room =
          randomRoom();

        State.room =
          room;

        State.UI.room.value =
          room;

        localStorage.setItem(
          "connections_room",
          room
        );

        updateStatus(
          "New room generated."
        );
      }
    );

    State.UI.confirm.addEventListener(
      "click",
      async () => {
        if (!isInsideMatch()) {
          updateStatus(
            "You must already be inside a match."
          );

          return;
        }

        State.name =
          State.UI.name.value.trim() ||
          "Player";

        const selectedRoom =
          State.UI.room.value.trim();

        if (!selectedRoom) {
          updateStatus(
            "Enter a room ID."
          );

          return;
        }

        if (
          State.connected &&
          State.joinedRoom &&
          String(State.room) !==
            String(selectedRoom)
        ) {
          updateStatus(
            "Leave the current room first."
          );

          return;
        }

        State.room =
          selectedRoom;

        localStorage.setItem(
          "connections_name",
          State.name
        );

        localStorage.setItem(
          "connections_room",
          State.room
        );

        await prepareMatch();
      }
    );

    State.UI.leave.addEventListener(
      "click",
      () => {
        Network.leaveRoom();
      }
    );

    State.UI.avatar.addEventListener(
      "click",
      () => {
        State.UI.avatarFile.click();
      }
    );

    State.UI.avatarReset.addEventListener(
      "click",
      () => {
        resetAvatar();
        updateAvatarPreview();
      }
    );

    State.UI.avatarFile.addEventListener(
      "change",
      async event => {
        const file =
          event.target.files?.[0];

        if (!file) {
          return;
        }

        try {
          const data =
            await compressAvatar(
              file
            );

          saveAvatar(data);
          updateAvatarPreview();
        } catch (e) {
          error(
            "Avatar processing failed:",
            e
          );
        }

        event.target.value =
          "";
      }
    );

    updateRoomUI();
  }

  function compressAvatar(file) {
    return new Promise(
      (resolve, reject) => {
        const reader =
          new FileReader();

        reader.onerror =
          () =>
            reject(
              new Error(
                "Could not read image."
              )
            );

        reader.onload =
          () => {
            const img =
              new Image();

            img.onerror =
              () =>
                reject(
                  new Error(
                    "Could not load image."
                  )
                );

            img.onload =
              () => {
                const canvas =
                  document.createElement(
                    "canvas"
                  );

                const size =
                  128;

                canvas.width =
                  size;

                canvas.height =
                  size;

                const ctx =
                  canvas.getContext(
                    "2d"
                  );

                ctx.clearRect(
                  0,
                  0,
                  size,
                  size
                );

                const scale =
                  Math.max(
                    size / img.width,
                    size / img.height
                  );

                const width =
                  img.width *
                  scale;

                const height =
                  img.height *
                  scale;

                const x =
                  (size - width) /
                  2;

                const y =
                  (size - height) /
                  2;

                ctx.drawImage(
                  img,
                  x,
                  y,
                  width,
                  height
                );

                resolve(
                  canvas.toDataURL(
                    "image/webp",
                    0.82
                  )
                );
              };

            img.src =
              reader.result;
          };

        reader.readAsDataURL(
          file
        );
      }
    );
  }

  function updateAvatarPreview() {
    if (
      !State.UI.avatarPreview
    ) {
      return;
    }

    const avatar =
      State.localAvatar ||
      getAvatar();

    if (avatar) {
      State.UI.avatarPreview.src =
        avatar;
    } else {
      State.UI.avatarPreview.removeAttribute(
        "src"
      );
    }
  }

  function updateRoomUI() {
    if (!State.UI.status) {
      return;
    }

    if (
      State.connected &&
      State.joinedRoom
    ) {
      updateStatus(
        State.room
          ? `Connected • ${State.room}`
          : "Connected"
      );

      return;
    }

    if (
      State.connected &&
      !State.joinedRoom
    ) {
      updateStatus(
        State.room
          ? `Connected • waiting for room`
          : "Connected"
      );

      return;
    }

    updateStatus(
      State.room
        ? `Ready • ${State.room}`
        : "No room"
    );
  }

  function updateStatus(text) {
    if (State.UI.status) {
      State.UI.status.textContent =
        text;
    }
  }

  function updateDebug() {
    if (!State.UI.debug) {
      return;
    }

    const game =
      getGame();

    State.UI.debug.textContent =
      [
        `connected=${State.connected}`,

        `joinedRoom=${State.joinedRoom}`,

        `confirmedMatch=${State.confirmedMatch}`,

        `room=${
          State.room ||
          "null"
        }`,

        `id=${
          State.id ||
          "null"
        }`,

        `remotePlayers=${
          State.remotes.size
        }`,

        `remoteBots=${
          Array.from(
            State.remotes.values()
          ).filter(
            r => !!r.bot
          ).length
        }`,

        `dead=${State.dead}`,

        `gameState=${
          game?.gameState ??
          "undefined"
        }`
      ].join(
        " | "
      );
  }

  function toggleUI() {
    if (!State.UI.root) {
      return;
    }

    const visible =
      State.UI.root.style.display !==
      "none";

    State.UI.root.style.display =
      visible
        ? "none"
        : "block";

    if (!visible) {
      updateAvatarPreview();
      updateRoomUI();
    }
  }

  function installKeyboard() {
    window.addEventListener(
      "keydown",
      event => {
        if (
          event.key ===
            "Backspace" &&
          !event.repeat
        ) {
          const target =
            event.target;

          const typing =
            target &&
            (
              target.tagName ===
                "INPUT" ||
              target.tagName ===
                "TEXTAREA" ||
              target.isContentEditable
            );

          if (typing) {
            return;
          }

          event.preventDefault();

          toggleUI();
        }
      },
      true
    );
  }

  function installMatchMonitor() {
    if (State.monitorTimer) {
      clearInterval(
        State.monitorTimer
      );
    }

    State.monitorTimer =
      setInterval(
        () => {
          const inside =
            isInsideMatch();

          if (
            inside &&
            !State.confirmedMatch
          ) {
            updateDebug();
            return;
          }

          if (
            !inside &&
            State.confirmedMatch
          ) {
            endMatch();
          }

          if (
            State.confirmedMatch
          ) {
            checkLocalDeath();
            enforceLocalDeath();
            keepGameUnpaused();
          }

          updateDebug();
        },
        250
      );
  }

  function exposeDebug() {
    unsafeWindow.__connections_multiplayer =
      {
        version: VERSION,

        get connected() {
          return State.connected;
        },

        get joinedRoom() {
          return State.joinedRoom;
        },

        get confirmedMatch() {
          return State.confirmedMatch;
        },

        get room() {
          return State.room;
        },

        get id() {
          return State.id;
        },

        get name() {
          return State.name;
        },

        get remoteCount() {
          return State.remotes.size;
        },

        get remoteBots() {
          return Array.from(
            State.remotes.values()
          ).filter(
            remote =>
              !!remote.bot
          ).length;
        },

        get botCount() {
          if (
            !State.botManager
          ) {
            return 0;
          }

          const bots =
            Array.isArray(
              State.botManager
            )
              ? State.botManager
              : State.botManager.bots;

          return Array.isArray(
            bots
          )
            ? bots.length
            : 0;
        },

        get dead() {
          return State.dead;
        },

        get localAvatar() {
          return State.localAvatar;
        },

        get gameState() {
          return getGame()?.gameState;
        },

        get gameGameState() {
          return getGame()?.gameState;
        },

        get localAvatarExists() {
          return !!getAvatar();
        },

        forceDeath() {
          forceLocalDeath(
            "debug"
          );
        },

        connect() {
          Network.connect();
        },

        join() {
          Network.joinRoom();
        },

        leave() {
          Network.leaveRoom();
        },

        dump() {
          return {
            version: VERSION,

            connected:
              State.connected,

            joinedRoom:
              State.joinedRoom,

            confirmedMatch:
              State.confirmedMatch,

            room:
              State.room,

            id:
              State.id,

            name:
              State.name,

            dead:
              State.dead,

            remoteCount:
              State.remotes.size,

            remoteBots:
              Array.from(
                State.remotes.values()
              ).filter(
                r => !!r.bot
              ).length,

            botCount:
              this.botCount,

            gameState:
              getGame()?.gameState,

            localAvatar:
              !!getAvatar()
          };
        }
      };

    log(
      "Debug:",
      "window.__connections_multiplayer"
    );
  }

  function boot() {
    createUI();

    installKeyboard();

    installMatchMonitor();

    installTabGuard();

    State.localAvatar =
      getAvatar();

    startAvatarLoop();

    exposeDebug();

    log(
      "Connections",
      VERSION,
      "loaded. Press [Backspace] to open."
    );
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      boot,
      {
        once: true
      }
    );
  } else {
    boot();
  }
})();
