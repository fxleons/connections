// ==UserScript==
// @name         Connections
// @namespace    conn
// @version      1.1.0
// @description  clutcher.io multiplayer
// @match        *://clutcher.io/*
// @match        *://*.clutcher.io/*
// @grant        unsafeWindow
// @grant        GM_addStyle
// @connect      able-vpn-star-constitutional.trycloudflare.com
// ==/UserScript==

(() => {
  "use strict";

  const VERSION = "1.1.0";

  const WS_URL =
    "wss://able-vpn-star-constitutional.trycloudflare.com";

  const RAFIT_LOGO =
    "https://raw.githubusercontent.com/fxleons/connections/main/rafit_logo.png";

  const State = {
    ws: null,
    connected: false,
    connecting: false,

    id: null,

    name:
      localStorage.getItem("connections_name") ||
      "Player",

    room: null,
    rooms: [],

    joinedRoom: false,
    leavingRoom: false,

    roomData: null,

    confirmedMatch: false,

    remotes: new Map(),

    game: null,

    botManager: null,
    botConstructor: null,

    originalBots: [],

    botArrayKey: null,

    dead: false,

    localAvatar:
      localStorage.getItem("pp-avatar") ||
      null,

    UI: {},

    stateTimer: null,
    monitorTimer: null,

    lastPosition: null,

    lastRemoteStateLog: 0
  };

  const log = (...a) =>
    console.log("[Connections]", ...a);

  const warn = (...a) =>
    console.warn("[Connections]", ...a);

  const error = (...a) =>
    console.error("[Connections]", ...a);

  /* =========================================================
     GAME DISCOVERY
  ========================================================= */

  function getGame() {
    if (
      State.game &&
      typeof State.game === "object"
    ) {
      return State.game;
    }

    const w = unsafeWindow || window;

    const candidates = [
      w.game,
      w.Game,
      w.clutcher,
      w.__game,
      w.app,
      w.engine
    ];

    for (const game of candidates) {
      if (
        game &&
        typeof game === "object"
      ) {
        State.game = game;

        log(
          "Game found:",
          game
        );

        return game;
      }
    }

    return null;
  }

  function getLocalPlayer() {
    const game = getGame();

    if (!game) {
      return null;
    }

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
      if (
        p &&
        typeof p === "object"
      ) {
        return p;
      }
    }

    return null;
  }

  function isInsideMatch() {
    const game = getGame();

    if (!game) {
      return false;
    }

    try {
      if (
        typeof game.isInMatch ===
        "function"
      ) {
        if (game.isInMatch()) {
          return true;
        }
      }
    } catch {}

    if (
      game.gameState ===
      "playing"
    ) {
      return true;
    }

    if (
      game.state ===
      "playing"
    ) {
      return true;
    }

    if (
      game.inMatch === true
    ) {
      return true;
    }

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

  function positionOf(obj) {
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
      obj.root?.position ||
      obj.cs2Agent?.root?.position;

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

  function rotationOf(obj) {
    if (!obj) {
      return {
        yaw: 0,
        pitch: 0
      };
    }

    const r =
      obj.rotation ||
      obj.eulerAngles ||
      obj.transform?.rotation ||
      obj.root?.rotation ||
      obj.cs2Agent?.root?.rotation;

    if (r) {
      return {
        yaw: Number(r.y) || 0,
        pitch: Number(r.x) || 0
      };
    }

    return {
      yaw: Number(obj.yaw) || 0,
      pitch: Number(obj.pitch) || 0
    };
  }

  function getAlive(player) {
    if (!player) {
      return !State.dead;
    }

    if (
      typeof player.alive ===
      "boolean"
    ) {
      return player.alive;
    }

    if (
      typeof player.isAlive ===
      "boolean"
    ) {
      return player.isAlive;
    }

    if (
      typeof player.dead ===
      "boolean"
    ) {
      return !player.dead;
    }

    if (
      typeof player.health ===
      "number"
    ) {
      return player.health > 0;
    }

    return true;
  }

  /* =========================================================
     NETWORK
  ========================================================= */

  function NetworkSend(
    type,
    data = {}
  ) {
    if (
      !State.ws ||
      State.ws.readyState !==
      WebSocket.OPEN
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
      error(
        "NetworkSend failed:",
        e
      );

      return false;
    }
  }

  const Network = {
    connect() {
      if (
        State.connecting ||
        (
          State.ws &&
          State.ws.readyState ===
          WebSocket.OPEN
        )
      ) {
        return;
      }

      State.connecting = true;

      updateStatus(
        "Connecting..."
      );

      let ws;

      try {
        ws = new WebSocket(
          WS_URL
        );
      } catch (e) {
        State.connecting = false;

        error(
          "WebSocket failed:",
          e
        );

        updateStatus(
          "WebSocket error"
        );

        return;
      }

      State.ws = ws;

      ws.onopen = () => {
        State.connected = true;
        State.connecting = false;

        log(
          "Multiplayer connected."
        );

        updateStatus(
          "Connected"
        );

        NetworkSend(
          "list_rooms"
        );

        updateUI();
      };

      ws.onmessage = event => {
        let msg;

        try {
          msg = JSON.parse(
            event.data
          );
        } catch {
          return;
        }

        Network.handle(msg);
      };

      ws.onerror = () => {
        State.connected = false;

        updateStatus(
          "Connection error"
        );

        updateUI();
      };

      ws.onclose = () => {
        State.connected = false;
        State.connecting = false;
        State.joinedRoom = false;

        State.ws = null;

        stopStateLoop();

        clearRemoteBots();

        updateStatus(
          "Disconnected"
        );

        updateUI();
      };
    },

    createRoom(data) {
      if (!State.connected) {
        this.connect();

        setTimeout(
          () => {
            this.createRoom(data);
          },
          500
        );

        return;
      }

      NetworkSend(
        "create_room",
        {
          ...data,
          name: State.name,
          avatar: State.localAvatar
        }
      );
    },

    joinRoom(roomId) {
      if (!roomId) {
        return;
      }

      if (!State.connected) {
        this.connect();

        setTimeout(
          () => {
            this.joinRoom(roomId);
          },
          500
        );

        return;
      }

      NetworkSend(
        "join_room",
        {
          roomId,
          name: State.name,
          avatar: State.localAvatar
        }
      );

      updateStatus(
        "Joining room..."
      );
    },

    leaveRoom() {
      if (!State.joinedRoom) {
        return;
      }

      State.leavingRoom = true;
      State.confirmedMatch = false;

      stopStateLoop();

      clearRemoteBots();

      updateScanUI();

      NetworkSend(
        "leave_room"
      );
    },

    kick(id) {
      NetworkSend(
        "kick",
        {
          targetId: id
        }
      );
    },

    handle(msg) {
      if (!msg) {
        return;
      }

      switch (msg.type) {
        case "connected":
          if (msg.id) {
            State.id =
              String(msg.id);
          }

          log(
            "Assigned id:",
            State.id
          );

          break;

        case "hello":
          if (msg.id) {
            State.id =
              String(msg.id);
          }

          break;

        case "rooms":
          State.rooms =
            Array.isArray(msg.rooms)
              ? msg.rooms
              : [];

          updateRoomList();
          updateUI();

          break;

        case "room_joined":
          this.handleRoomJoined(
            msg
          );

          break;

        case "roster":
          if (msg.room) {
            State.roomData =
              msg.room;
          }

          updateRoomList();
          updateUI();

          break;

        case "join":
          updateRoomList();

          break;

        case "leave":
          if (msg.id) {
            removeRemote(
              String(msg.id)
            );
          }

          updateRoomList();

          break;

        case "host_changed":
          updateRoomList();

          break;

        case "kicked":
          State.joinedRoom = false;
          State.room = null;
          State.roomData = null;
          State.confirmedMatch = false;

          stopStateLoop();
          clearRemoteBots();

          updateScanUI();

          updateStatus(
            "You were kicked."
          );

          updateUI();

          break;

        case "left_room":
          State.joinedRoom = false;
          State.room = null;
          State.roomData = null;
          State.leavingRoom = false;
          State.confirmedMatch = false;

          stopStateLoop();
          clearRemoteBots();

          updateScanUI();

          updateStatus(
            "Left room."
          );

          updateUI();

          break;

        case "state":
          handleStateMessage(
            msg
          );

          break;

        case "rafit_warning":
          updateStatus(
            "RAFIT warning: " +
            msg.type +
            " | RTP " +
            msg.rtp
          );

          break;

        case "rafit_banned":
          updateStatus(
            "RAFIT: banned."
          );

          State.confirmedMatch =
            false;

          stopStateLoop();

          break;

        case "error":
          handleServerError(
            msg
          );

          break;

        case "pong":
          break;

        default:
          break;
      }
    },

    handleRoomJoined(msg) {
      State.room =
        msg.room?.id ||
        msg.roomId ||
        null;

      State.roomData =
        msg.room ||
        null;

      if (msg.id) {
        State.id =
          String(msg.id);
      }

      State.joinedRoom = true;
      State.leavingRoom = false;

      log(
        "Joined room:",
        State.room
      );

      updateStatus(
        "Room joined. Enter your match and scan."
      );

      updateRoomList();
      updateUI();
      updateScanUI();
    }
  };

  function handleServerError(msg) {
    const code =
      msg.code ||
      msg.message ||
      "Unknown error";

    const names = {
      ROOM_NOT_FOUND:
        "Room not found.",

      ROOM_FULL:
        "Room is full.",

      HOST_ONLY:
        "Only the host can do that.",

      CANNOT_KICK_HOST:
        "You cannot kick yourself.",

      PLAYER_NOT_FOUND:
        "Player not found.",

      RAFIT_BANNED:
        "You are currently RAFIT banned.",

      RAFIT_2000_REQUIRED:
        "You need 2000+ RTP for this server."
    };

    updateStatus(
      names[code] ||
      code
    );

    warn(
      "Server error:",
      msg
    );
  }

  /* =========================================================
     REMOTE STATE
  ========================================================= */

  function handleStateMessage(msg) {
    const list =
      Array.isArray(msg.players)
        ? msg.players
        : [];

    if (!list.length) {
      return;
    }

    for (const data of list) {
      if (!data?.id) {
        continue;
      }

      const id =
        String(data.id);

      if (
        State.id &&
        id ===
        String(State.id)
      ) {
        continue;
      }

      let remote =
        State.remotes.get(id);

      if (!remote) {
        remote = {
          id,

          name:
            data.name ||
            "Player",

          team:
            data.team ||
            "ct",

          x:
            Number(data.x) || 0,

          y:
            Number(data.y) || 0,

          z:
            Number(data.z) || 0,

          targetX:
            Number(data.x) || 0,

          targetY:
            Number(data.y) || 0,

          targetZ:
            Number(data.z) || 0,

          yaw:
            Number(data.yaw) || 0,

          pitch:
            Number(data.pitch) || 0,

          targetYaw:
            Number(data.yaw) || 0,

          targetPitch:
            Number(data.pitch) || 0,

          health:
            typeof data.health ===
            "number"
              ? data.health
              : 100,

          alive:
            data.alive !== false,

          dead:
            data.dead === true,

          avatar:
            data.avatar ||
            null,

          bot: null,

          created: false
        };

        State.remotes.set(
          id,
          remote
        );

        log(
          "New remote player:",
          remote.name,
          id
        );
      }

      remote.name =
        data.name ||
        remote.name;

      remote.team =
        data.team ||
        remote.team;

      remote.targetX =
        Number(data.x) || 0;

      remote.targetY =
        Number(data.y) || 0;

      remote.targetZ =
        Number(data.z) || 0;

      remote.targetYaw =
        Number(data.yaw) || 0;

      remote.targetPitch =
        Number(data.pitch) || 0;

      remote.health =
        typeof data.health ===
        "number"
          ? data.health
          : remote.health;

      remote.alive =
        data.alive !== false &&
        data.dead !== true &&
        remote.health > 0;

      remote.dead =
        !remote.alive;

      remote.avatar =
        data.avatar ||
        remote.avatar ||
        null;

      if (remote.dead) {
        killRemote(remote);
      } else {
        if (!remote.bot) {
          createRemoteBot(
            remote
          );
        }
      }
    }

    updateBots();
  }

  /* =========================================================
     BOT MANAGER
  ========================================================= */

  function getBotManager() {
    if (
      State.botManager &&
      typeof State.botManager ===
      "object"
    ) {
      return State.botManager;
    }

    const game =
      getGame();

    if (!game) {
      return null;
    }

    const candidates = [
      game.botMgr,
      game.botManager,
      game.bots,
      game.ai,
      game.botSystem,
      game.enemyManager,
      game.agents
    ];

    for (const manager of candidates) {
      if (
        manager &&
        typeof manager ===
        "object"
      ) {
        State.botManager =
          manager;

        return manager;
      }
    }

    return null;
  }

  function getBotArrays(manager) {
    if (!manager) {
      return [];
    }

    const result = [];

    const keys = [
      "bots",
      "agents",
      "entities",
      "players"
    ];

    for (const key of keys) {
      const arr =
        manager[key];

      if (
        Array.isArray(arr)
      ) {
        result.push({
          key,
          arr
        });
      }
    }

    return result;
  }

  /*
   * IMPORTANT:
   *
   * The old version cleared manager.bots and ONLY THEN
   * tried to discover the constructor.
   *
   * That destroyed the only source of the constructor.
   *
   * This function is deliberately called BEFORE
   * the original bot array gets cleared.
   */

  function findBotConstructor(
    manager = getBotManager()
  ) {
    if (!manager) {
      return null;
    }

    const directCandidates = [
      manager.Bot,
      manager.botConstructor,
      manager.BotClass
    ];

    for (
      const Constructor of
      directCandidates
    ) {
      if (
        typeof Constructor ===
        "function"
      ) {
        return Constructor;
      }
    }

    try {
      const arrays =
        getBotArrays(
          manager
        );

      for (
        const item of arrays
      ) {
        const arr =
          item.arr;

        for (
          const bot of
          arr
        ) {
          if (!bot) {
            continue;
          }

          /*
           * Prefer an actual bot-like object.
           */
          const looksLikeBot =
            bot.team !== undefined ||
            bot.health !== undefined ||
            bot.cs2Agent !== undefined ||
            bot.root !== undefined ||
            bot.position !== undefined;

          if (!looksLikeBot) {
            continue;
          }

          if (
            typeof bot.constructor ===
            "function" &&
            bot.constructor !==
            Object
          ) {
            return bot.constructor;
          }
        }
      }

      /*
       * Fallback: any non-Object constructor.
       */
      for (
        const item of arrays
      ) {
        for (
          const bot of
          item.arr
        ) {
          if (
            bot &&
            typeof bot.constructor ===
            "function" &&
            bot.constructor !==
            Object
          ) {
            return bot.constructor;
          }
        }
      }
    } catch (e) {
      warn(
        "Constructor scan failed:",
        e
      );
    }

    return null;
  }

  function hideBot(bot) {
    if (!bot) {
      return;
    }

    try {
      bot.visible = false;
    } catch {}

    try {
      bot.enabled = false;
    } catch {}

    try {
      if (bot.gameObject) {
        bot.gameObject.active =
          false;
      }
    } catch {}

    try {
      if (bot.root) {
        bot.root.visible =
          false;
      }
    } catch {}

    try {
      const root =
        bot.cs2Agent &&
        bot.cs2Agent.root;

      if (root) {
        root.visible =
          false;
      }
    } catch {}

    try {
      if (
        typeof bot.setVisible ===
        "function"
      ) {
        bot.setVisible(
          false
        );
      }
    } catch {}
  }

  function showBot(bot) {
    if (!bot) {
      return;
    }

    try {
      bot.visible = true;
    } catch {}

    try {
      bot.enabled = true;
    } catch {}

    try {
      if (bot.gameObject) {
        bot.gameObject.active =
          true;
      }
    } catch {}

    try {
      if (bot.root) {
        bot.root.visible =
          true;
      }
    } catch {}

    try {
      const root =
        bot.cs2Agent &&
        bot.cs2Agent.root;

      if (root) {
        root.visible =
          true;
      }
    } catch {}

    try {
      if (
        typeof bot.setVisible ===
        "function"
      ) {
        bot.setVisible(
          true
        );
      }
    } catch {}
  }

  function prepareBots() {
    const manager =
      getBotManager();

    if (!manager) {
      warn(
        "Bot manager not found."
      );

      return false;
    }

    State.botManager =
      manager;

    /*
     * CRITICAL FIX:
     *
     * Capture the constructor BEFORE clearing the array.
     */
    if (
      !State.botConstructor
    ) {
      State.botConstructor =
        findBotConstructor(
          manager
        );
    }

    if (
      State.botConstructor
    ) {
      log(
        "Remote bot constructor captured:",
        State.botConstructor.name ||
        "(anonymous)"
      );
    } else {
      warn(
        "Could not capture bot constructor before cleanup."
      );
    }

    /*
     * Don't scan the same bots twice.
     */
    if (
      State.originalBots.length
    ) {
      return true;
    }

    const arrays =
      getBotArrays(
        manager
      );

    if (!arrays.length) {
      warn(
        "Bot manager found, but no bot array exists."
      );

      /*
       * We still allow multiplayer if a constructor
       * was exposed directly on the manager.
       */
      return !!State.botConstructor;
    }

    /*
     * Find the actual populated array.
     */
    let selected = null;

    for (
      const item of arrays
    ) {
      if (
        item.arr.length
      ) {
        selected = item;
        break;
      }
    }

    /*
     * If all arrays are empty, keep the captured constructor.
     */
    if (!selected) {
      State.botArrayKey =
        arrays[0].key;

      log(
        "Bot arrays exist but are empty."
      );

      return !!State.botConstructor;
    }

    State.botArrayKey =
      selected.key;

    const arr =
      selected.arr;

    /*
     * Save and hide every original bot.
     */
    for (
      const bot of
      arr.slice()
    ) {
      if (!bot) {
        continue;
      }

      if (
        bot.__connectionsRemote
      ) {
        continue;
      }

      State.originalBots.push(
        bot
      );

      hideBot(bot);

      try {
        bot.alive =
          false;
      } catch {}
    }

    /*
     * Remove originals from the active manager.
     */
    try {
      arr.length = 0;
    } catch (e) {
      warn(
        "Could not clear bot array:",
        e
      );
    }

    log(
      "Bot scan:",
      State.originalBots.length,
      "original bots found."
    );

    log(
      "Remote constructor:",
      State.botConstructor
    );

    return true;
  }

  /* =========================================================
     REMOTE BOT CREATION
  ========================================================= */

  function addToBotManager(
    bot
  ) {
    const manager =
      getBotManager();

    if (!manager || !bot) {
      return false;
    }

    /*
     * Prefer the array we used during the scan.
     */
    if (
      State.botArrayKey &&
      Array.isArray(
        manager[
          State.botArrayKey
        ]
      )
    ) {
      const arr =
        manager[
          State.botArrayKey
        ];

      if (
        !arr.includes(bot)
      ) {
        arr.push(bot);
      }

      return true;
    }

    const keys = [
      "bots",
      "agents",
      "entities",
      "players"
    ];

    for (
      const key of keys
    ) {
      if (
        Array.isArray(
          manager[key]
        )
      ) {
        if (
          !manager[key].includes(
            bot
          )
        ) {
          manager[key].push(
            bot
          );
        }

        State.botArrayKey =
          key;

        return true;
      }
    }

    return false;
  }

  function tryConstructBot(
    Constructor,
    remote
  ) {
    const attempts = [
      () => new Constructor(
        State.game,
        remote.team,
        remote.name,
        3
      ),

      () => new Constructor(
        State.game,
        remote.team,
        remote.name,
        "normal"
      ),

      () => new Constructor(
        State.game,
        remote.team,
        remote.name
      ),

      () => new Constructor(
        State.game
      ),

      () => new Constructor()
    ];

    for (
      const attempt of
      attempts
    ) {
      try {
        const bot =
          attempt();

        if (bot) {
          return bot;
        }
      } catch {}
    }

    return null;
  }

  function applyRemoteMetadata(
    bot,
    remote
  ) {
    if (!bot) {
      return;
    }

    try {
      bot.__connectionsRemote =
        true;
    } catch {}

    try {
      bot.__connectionsId =
        remote.id;
    } catch {}

    try {
      bot.name =
        remote.name;
    } catch {}

    try {
      bot.username =
        remote.name;
    } catch {}

    try {
      bot.team =
        remote.team;
    } catch {}

    /*
     * Keep avatar data on the remote entity.
     *
     * This doesn't force a particular player-model
     * implementation, but allows the game's entity/
     * avatar code to consume the URL if it exposes one.
     */
    if (remote.avatar) {
      try {
        bot.avatar =
          remote.avatar;
      } catch {}

      try {
        bot.avatarUrl =
          remote.avatar;
      } catch {}

      try {
        bot.skin =
          remote.avatar;
      } catch {}

      try {
        bot.modelUrl =
          remote.avatar;
      } catch {}
    }
  }

  function createRemoteBot(
    remote
  ) {
    if (
      !remote ||
      remote.dead
    ) {
      return;
    }

    if (
      remote.bot
    ) {
      return;
    }

    const manager =
      getBotManager();

    if (!manager) {
      warn(
        "Cannot create remote: bot manager missing."
      );

      return;
    }

    /*
     * If for some reason the constructor was not captured,
     * try again BEFORE doing anything to the arrays.
     */
    if (
      !State.botConstructor
    ) {
      State.botConstructor =
        findBotConstructor(
          manager
        );
    }

    const Constructor =
      State.botConstructor;

    if (
      typeof Constructor !==
      "function"
    ) {
      warn(
        "Remote bot constructor not found for:",
        remote.name,
        remote.id
      );

      return;
    }

    const bot =
      tryConstructBot(
        Constructor,
        remote
      );

    if (!bot) {
      warn(
        "All remote bot constructor attempts failed:",
        remote.name
      );

      return;
    }

    remote.bot =
      bot;

    remote.created =
      true;

    applyRemoteMetadata(
      bot,
      remote
    );

    /*
     * Some game entities expose spawn().
     */
    try {
      if (
        typeof bot.spawn ===
        "function"
      ) {
        bot.spawn();
      }
    } catch {}

    /*
     * Some expose init().
     */
    try {
      if (
        typeof bot.init ===
        "function"
      ) {
        bot.init();
      }
    } catch {}

    /*
     * Add it AFTER construction.
     */
    addToBotManager(
      bot
    );

    showBot(
      bot
    );

    setBotPosition(
      bot,
      remote.x,
      remote.y,
      remote.z
    );

    setBotRotation(
      bot,
      remote.yaw,
      remote.pitch
    );

    try {
      bot.health =
        remote.health;
    } catch {}

    try {
      bot.alive =
        true;
    } catch {}

    try {
      bot.dead =
        false;
    } catch {}

    log(
      "REMOTE CREATED:",
      remote.name,
      remote.id,
      "pos:",
      remote.x,
      remote.y,
      remote.z
    );
  }

  /* =========================================================
     REMOTE TRANSFORM
  ========================================================= */

  function setBotPosition(
    bot,
    x,
    y,
    z
  ) {
    if (!bot) {
      return;
    }

    const values = {
      x,
      y,
      z
    };

    try {
      if (
        bot.position
      ) {
        bot.position.x =
          x;

        bot.position.y =
          y;

        bot.position.z =
          z;

        return;
      }
    } catch {}

    try {
      if (
        bot.transform?.position
      ) {
        bot.transform.position.x =
          x;

        bot.transform.position.y =
          y;

        bot.transform.position.z =
          z;

        return;
      }
    } catch {}

    try {
      if (
        bot.cs2Agent?.root?.position
      ) {
        bot.cs2Agent.root.position.x =
          x;

        bot.cs2Agent.root.position.y =
          y;

        bot.cs2Agent.root.position.z =
          z;

        return;
      }
    } catch {}

    try {
      if (
        bot.root?.position
      ) {
        bot.root.position.x =
          x;

        bot.root.position.y =
          y;

        bot.root.position.z =
          z;

        return;
      }
    } catch {}

    try {
      bot.x =
        values.x;

      bot.y =
        values.y;

      bot.z =
        values.z;
    } catch {}
  }

  function setBotRotation(
    bot,
    yaw,
    pitch
  ) {
    if (!bot) {
      return;
    }

    try {
      if (
        bot.rotation
      ) {
        bot.rotation.y =
          yaw;

        bot.rotation.x =
          pitch;

        return;
      }
    } catch {}

    try {
      if (
        bot.transform?.rotation
      ) {
        bot.transform.rotation.y =
          yaw;

        bot.transform.rotation.x =
          pitch;

        return;
      }
    } catch {}

    try {
      if (
        bot.cs2Agent?.root?.rotation
      ) {
        bot.cs2Agent.root.rotation.y =
          yaw;

        bot.cs2Agent.root.rotation.x =
          pitch;

        return;
      }
    } catch {}

    try {
      bot.yaw =
        yaw;

      bot.pitch =
        pitch;
    } catch {}
  }

  function updateBots() {
    for (
      const remote of
      State.remotes.values()
    ) {
      if (
        !remote
      ) {
        continue;
      }

      if (
        remote.dead
      ) {
        continue;
      }

      /*
       * If the state arrived before the entity could
       * be constructed, retry here.
       */
      if (
        !remote.bot
      ) {
        createRemoteBot(
          remote
        );
      }

      if (
        !remote.bot
      ) {
        continue;
      }

      remote.x +=
        (
          remote.targetX -
          remote.x
        ) * 0.35;

      remote.y +=
        (
          remote.targetY -
          remote.y
        ) * 0.35;

      remote.z +=
        (
          remote.targetZ -
          remote.z
        ) * 0.35;

      remote.yaw =
        remote.targetYaw;

      remote.pitch =
        remote.targetPitch;

      setBotPosition(
        remote.bot,
        remote.x,
        remote.y,
        remote.z
      );

      setBotRotation(
        remote.bot,
        remote.yaw,
        remote.pitch
      );

      try {
        remote.bot.health =
          remote.health;
      } catch {}

      try {
        remote.bot.alive =
          true;
      } catch {}

      /*
       * Keep avatar metadata updated if the server
       * changes it after entity creation.
       */
      if (remote.avatar) {
        try {
          remote.bot.avatar =
            remote.avatar;
        } catch {}

        try {
          remote.bot.avatarUrl =
            remote.avatar;
        } catch {}

        try {
          remote.bot.skin =
            remote.avatar;
        } catch {}
      }

      showBot(
        remote.bot
      );
    }
  }

  function killRemote(
    remote
  ) {
    if (
      !remote ||
      !remote.bot
    ) {
      return;
    }

    try {
      remote.bot.health =
        0;
    } catch {}

    try {
      remote.bot.alive =
        false;
    } catch {}

    try {
      remote.bot.dead =
        true;
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
          typeof remote.bot[fn] ===
          "function"
        ) {
          remote.bot[fn]();

          break;
        }
      } catch {}
    }

    hideBot(
      remote.bot
    );
  }

  function removeRemote(
    id
  ) {
    const remote =
      State.remotes.get(
        String(id)
      );

    if (!remote) {
      return;
    }

    if (
      remote.bot
    ) {
      removeBotFromManager(
        remote.bot
      );

      hideBot(
        remote.bot
      );
    }

    State.remotes.delete(
      String(id)
    );

    log(
      "Remote removed:",
      id
    );
  }

  function removeBotFromManager(
    bot
  ) {
    if (!bot) {
      return;
    }

    const manager =
      getBotManager();

    if (!manager) {
      return;
    }

    const keys = [
      "bots",
      "agents",
      "entities",
      "players"
    ];

    for (
      const key of keys
    ) {
      const arr =
        manager[key];

      if (
        !Array.isArray(arr)
      ) {
        continue;
      }

      let index;

      while (
        (
          index =
          arr.indexOf(bot)
        ) >= 0
      ) {
        arr.splice(
          index,
          1
        );
      }
    }
  }

  function clearRemoteBots() {
    for (
      const remote of
      State.remotes.values()
    ) {
      if (
        remote.bot
      ) {
        removeBotFromManager(
          remote.bot
        );

        hideBot(
          remote.bot
        );
      }
    }

    State.remotes.clear();

    /*
     * Restore original bots when leaving the
     * multiplayer match/room.
     */
    if (
      State.originalBots.length
    ) {
      const manager =
        getBotManager();

      if (
        manager &&
        State.botArrayKey &&
        Array.isArray(
          manager[
            State.botArrayKey
          ]
        )
      ) {
        const arr =
          manager[
            State.botArrayKey
          ];

        for (
          const bot of
          State.originalBots
        ) {
          if (
            !arr.includes(bot)
          ) {
            arr.push(
              bot
            );
          }

          showBot(
            bot
          );

          try {
            bot.alive =
              true;
          } catch {}
        }
      } else {
        for (
          const bot of
          State.originalBots
        ) {
          showBot(
            bot
          );
        }
      }
    }

    State.originalBots = [];

    log(
      "Remote bots cleared."
    );
  }

  /* =========================================================
     LOCAL STATE
  ========================================================= */

  function sendLocalState() {
    if (
      !State.joinedRoom ||
      !State.confirmedMatch
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
      positionOf(
        player
      );

    const rot =
      rotationOf(
        player
      );

    const alive =
      !State.dead &&
      getAlive(
        player
      );

    const health =
      State.dead
        ? 0
        : (
          typeof player?.health ===
          "number"
            ? player.health
            : 100
        );

    State.lastPosition =
      pos;

    NetworkSend(
      "state",
      {
        state: {
          x: pos.x,
          y: pos.y,
          z: pos.z,

          yaw: rot.yaw,
          pitch: rot.pitch,

          alive,

          dead:
            !alive,

          health,

          name:
            State.name,

          avatar:
            State.localAvatar
        }
      }
    );
  }

  function startStateLoop() {
    if (
      State.stateTimer
    ) {
      return;
    }

    State.stateTimer =
      setInterval(
        sendLocalState,
        50
      );

    /*
     * Send one immediately instead of waiting 50 ms.
     */
    sendLocalState();
  }

  function stopStateLoop() {
    if (
      State.stateTimer
    ) {
      clearInterval(
        State.stateTimer
      );

      State.stateTimer =
        null;
    }
  }

  /* =========================================================
     MATCH SCAN
  ========================================================= */

  function updateScanUI() {
    const button =
      State.UI.scanButton;

    const status =
      State.UI.scanStatus;

    if (!button) {
      return;
    }

    if (
      State.confirmedMatch
    ) {
      button.textContent =
        "MATCH SCANNED";

      button.classList.add(
        "conn-scan-done"
      );

      button.disabled =
        true;

      if (status) {
        status.textContent =
          "Multiplayer ready";
      }

      return;
    }

    button.classList.remove(
      "conn-scan-done"
    );

    button.disabled =
      false;

    button.textContent =
      "I AM INSIDE A MATCH";

    if (status) {
      status.textContent =
        "Enter a match, then scan.";
    }
  }

  function confirmMatch() {
    if (
      State.confirmedMatch
    ) {
      return true;
    }

    if (
      !isInsideMatch()
    ) {
      updateStatus(
        "Enter a match first."
      );

      if (
        State.UI.scanStatus
      ) {
        State.UI.scanStatus.textContent =
          "No active match detected.";
      }

      log(
        "Match scan rejected: not inside a match."
      );

      return false;
    }

    const game =
      getGame();

    if (!game) {
      updateStatus(
        "Game engine not found."
      );

      return false;
    }

    log(
      "Match detected."
    );

    log(
      "Scanning bot manager..."
    );

    const manager =
      getBotManager();

    if (!manager) {
      updateStatus(
        "Bot manager not found."
      );

      warn(
        "Could not find bot manager."
      );

      return false;
    }

    State.botManager =
      manager;

    /*
     * THIS IS THE IMPORTANT PART:
     *
     * prepareBots() now captures the constructor BEFORE
     * removing the original bots.
     */
    const prepared =
      prepareBots();

    if (!prepared) {
      updateStatus(
        "Could not scan bots."
      );

      return false;
    }

    State.confirmedMatch =
      true;

    startStateLoop();

    updateStatus(
      "Match confirmed."
    );

    updateScanUI();

    log(
      "Match confirmed."
    );

    log(
      "Original bots:",
      State.originalBots.length
    );

    log(
      "Remote constructor:",
      State.botConstructor
    );

    log(
      "Connections multiplayer ready."
    );

    return true;
  }

  /* =========================================================
     ROOM UI
  ========================================================= */

  function updateRoomList() {
    const box =
      State.UI.roomList;

    if (!box) {
      return;
    }

    box.innerHTML = "";

    if (
      !State.rooms.length
    ) {
      const empty =
        document.createElement(
          "div"
        );

      empty.className =
        "conn-empty";

      empty.textContent =
        "No rooms yet. Create the first one.";

      box.appendChild(
        empty
      );

      return;
    }

    for (
      const room of
      State.rooms
    ) {
      const card =
        document.createElement(
          "div"
        );

      card.className =
        "conn-room";

      const title =
        document.createElement(
          "div"
        );

      title.className =
        "conn-room-title";

      const segments =
        Array.isArray(
          room.segments
        )
          ? room.segments
          : [];

      if (
        segments.length
      ) {
        for (
          const segment of
          segments
        ) {
          const span =
            document.createElement(
              "span"
            );

          span.textContent =
            segment.text ||
            "";

          span.style.color =
            segment.color ||
            "#fff";

          span.style.marginRight =
            "7px";

          title.appendChild(
            span
          );
        }
      } else {
        title.textContent =
          room.title ||
          "Room";
      }

      const meta =
        document.createElement(
          "div"
        );

      meta.className =
        "conn-room-meta";

      meta.textContent =
        `${room.playerCount || 0}/${(room.ctSlots || 0) + (room.tSlots || 0)} players`;

      if (
        room.rafit
      ) {
        const r =
          document.createElement(
            "span"
          );

        r.className =
          "conn-room-rafit";

        r.textContent =
          "RAFIT";

        meta.appendChild(
          r
        );
      }

      if (
        room.professional
      ) {
        const p =
          document.createElement(
            "span"
          );

        p.className =
          "conn-room-pro";

        p.textContent =
          "PRO";

        meta.appendChild(
          p
        );
      }

      const players =
        document.createElement(
          "div"
        );

      players.className =
        "conn-players";

      if (
        Array.isArray(
          room.players
        )
      ) {
        for (
          const player of
          room.players
        ) {
          const row =
            document.createElement(
              "div"
            );

          row.className =
            "conn-player";

          const name =
            document.createElement(
              "span"
            );

          name.textContent =
            player.name ||
            "Player";

          row.appendChild(
            name
          );

          players.appendChild(
            row
          );
        }
      }

      const buttons =
        document.createElement(
          "div"
        );

      buttons.className =
        "conn-room-buttons";

      const join =
        document.createElement(
          "button"
        );

      join.className =
        "conn-btn";

      join.textContent =
        "JOIN";

      join.onclick = () => {
        Network.joinRoom(
          room.id
        );
      };

      buttons.appendChild(
        join
      );

      card.appendChild(
        title
      );

      card.appendChild(
        meta
      );

      if (
        players.children.length
      ) {
        card.appendChild(
          players
        );
      }

      card.appendChild(
        buttons
      );

      box.appendChild(
        card
      );
    }
  }

  function renderKickList() {
    const box =
      State.UI.kickList;

    if (!box) {
      return;
    }

    box.innerHTML = "";

    if (
      !State.roomData ||
      !Array.isArray(
        State.roomData.players
      )
    ) {
      return;
    }

    const me =
      State.roomData.players.find(
        p =>
          String(p.id) ===
          String(State.id)
      );

    if (!me?.host) {
      return;
    }

    for (
      const player of
      State.roomData.players
    ) {
      if (
        String(player.id) ===
        String(State.id)
      ) {
        continue;
      }

      const row =
        document.createElement(
          "div"
        );

      row.className =
        "conn-kick-row";

      const name =
        document.createElement(
          "span"
        );

      name.textContent =
        `${player.name || "Player"}${State.roomData.rafit ? " (" + (player.rtp || 0) + " RTP)" : ""}`;

      const button =
        document.createElement(
          "button"
        );

      button.className =
        "conn-small conn-danger";

      button.textContent =
        "KICK";

      button.onclick =
        () => {
          Network.kick(
            player.id
          );
        };

      row.appendChild(
        name
      );

      row.appendChild(
        button
      );

      box.appendChild(
        row
      );
    }
  }

  function updateStatus(
    text
  ) {
    if (
      State.UI.status
    ) {
      State.UI.status.textContent =
        text;
    }
  }

  function updateUI() {
    updateRoomList();

    if (
      State.UI.connection
    ) {
      State.UI.connection.textContent =
        State.connected
          ? "ONLINE"
          : "OFFLINE";

      State.UI.connection.className =
        State.connected
          ? "conn-online"
          : "conn-offline";
    }

    if (
      State.UI.current
    ) {
      State.UI.current.textContent =
        State.roomData
          ? (
            State.roomData.title ||
            "Room"
          )
          : "No room";
    }

    renderKickList();

    updateScanUI();
  }

  /* =========================================================
     CREATE ROOM
  ========================================================= */

  function collectSegments() {
    return (
      State.UI.segmentRows ||
      []
    )
      .map(
        row => ({
          text:
            row.querySelector(
              ".conn-segment-text"
            )?.value
              ?.trim() ||
            "",

          color:
            row.querySelector(
              ".conn-segment-color"
            )?.value ||
            "#ffffff"
        })
      )
      .filter(
        x =>
          x.text.length > 0
      );
  }

  function renderSegmentsPreview() {
    const preview =
      State.UI.preview;

    if (!preview) {
      return;
    }

    preview.innerHTML = "";

    const segments =
      collectSegments();

    for (
      const segment of
      segments
    ) {
      const span =
        document.createElement(
          "span"
        );

      span.textContent =
        segment.text;

      span.style.color =
        segment.color;

      span.style.marginRight =
        "7px";

      preview.appendChild(
        span
      );
    }
  }

  function addSegment(
    text = "",
    color = "#ffffff"
  ) {
    const box =
      State.UI.segmentBox;

    if (!box) {
      return;
    }

    const row =
      document.createElement(
        "div"
      );

    row.className =
      "conn-segment";

    const input =
      document.createElement(
        "input"
      );

    input.type =
      "text";

    input.className =
      "conn-segment-text";

    input.value =
      text;

    input.placeholder =
      "Server name";

    const picker =
      document.createElement(
        "input"
      );

    picker.type =
      "color";

    picker.className =
      "conn-segment-color";

    picker.value =
      color;

    const remove =
      document.createElement(
        "button"
      );

    remove.className =
      "conn-small";

    remove.textContent =
      "×";

    remove.onclick =
      () => {
        row.remove();

        State.UI.segmentRows =
          State.UI.segmentRows.filter(
            x =>
              x !== row
          );

        renderSegmentsPreview();
      };

    input.oninput =
      renderSegmentsPreview;

    picker.oninput =
      renderSegmentsPreview;

    row.appendChild(
      input
    );

    row.appendChild(
      picker
    );

    row.appendChild(
      remove
    );

    box.appendChild(
      row
    );

    State.UI.segmentRows.push(
      row
    );

    renderSegmentsPreview();
  }

  function createRoomFromUI() {
    const segments =
      collectSegments();

    if (!segments.length) {
      updateStatus(
        "Give the room a name."
      );

      return;
    }

    const ctSlots =
      Number(
        State.UI.ctSlots.value
      ) ||
      5;

    const tSlots =
      Number(
        State.UI.tSlots.value
      ) ||
      5;

    Network.createRoom({
      segments,

      ctSlots,

      tSlots,

      rafit:
        State.UI.rafit.checked,

      professional:
        State.UI.professional.checked,

      team:
        "ct"
    });
  }

  /* =========================================================
     PANEL
  ========================================================= */

  function toggleUI() {
    const panel =
      State.UI.panel;

    if (!panel) {
      return;
    }

    panel.style.display =
      panel.style.display ===
      "none"
        ? "block"
        : "none";
  }

  function closeUI() {
    if (
      State.UI.panel
    ) {
      State.UI.panel.style.display =
        "none";
    }
  }

  function makePanelDraggable(
    panel,
    handle
  ) {
    let dragging =
      false;

    let startX =
      0;

    let startY =
      0;

    let startLeft =
      0;

    let startTop =
      0;

    const stopDrag =
      () => {
        dragging =
          false;

        document.body.style.userSelect =
          "";

        document.removeEventListener(
          "mousemove",
          onMouseMove
        );

        document.removeEventListener(
          "mouseup",
          stopDrag
        );
      };

    const onMouseMove =
      event => {
        if (!dragging) {
          return;
        }

        let left =
          startLeft +
          (
            event.clientX -
            startX
          );

        let top =
          startTop +
          (
            event.clientY -
            startY
          );

        const margin =
          10;

        const rect =
          panel.getBoundingClientRect();

        const maxLeft =
          window.innerWidth -
          rect.width -
          margin;

        const maxTop =
          window.innerHeight -
          rect.height -
          margin;

        left =
          Math.max(
            margin,
            Math.min(
              left,
              Math.max(
                margin,
                maxLeft
              )
            )
          );

        top =
          Math.max(
            margin,
            Math.min(
              top,
              Math.max(
                margin,
                maxTop
              )
            )
          );

        panel.style.left =
          `${left}px`;

        panel.style.top =
          `${top}px`;
      };

    handle.addEventListener(
      "mousedown",
      event => {
        if (
          event.button !== 0
        ) {
          return;
        }

        if (
          event.target.closest(
            "button,input,textarea,select,a"
          )
        ) {
          return;
        }

        const rect =
          panel.getBoundingClientRect();

        panel.style.transform =
          "none";

        panel.style.left =
          `${rect.left}px`;

        panel.style.top =
          `${rect.top}px`;

        startX =
          event.clientX;

        startY =
          event.clientY;

        startLeft =
          rect.left;

        startTop =
          rect.top;

        dragging =
          true;

        document.body.style.userSelect =
          "none";

        document.addEventListener(
          "mousemove",
          onMouseMove
        );

        document.addEventListener(
          "mouseup",
          stopDrag
        );

        event.preventDefault();
      }
    );

    window.addEventListener(
      "blur",
      stopDrag
    );
  }

  function buildUI() {
    GM_addStyle(`
      #connections-panel {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 780px;
        max-width: calc(100vw - 30px);
        max-height: calc(100vh - 30px);
        overflow: auto;
        z-index: 999999;
        background: #101116;
        color: #eee;
        border: 1px solid #2c2f3a;
        border-radius: 16px;
        box-shadow: 0 20px 80px rgba(0,0,0,.65);
        font-family: Arial, sans-serif;
        padding: 18px;
        display: none;
      }

      #connections-panel * {
        box-sizing: border-box;
      }

      .conn-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 15px;
        cursor: grab;
        user-select: none;
      }

      .conn-header:active {
        cursor: grabbing;
      }

      .conn-logo {
        width: 38px;
        height: 38px;
        object-fit: contain;
        border-radius: 8px;
        pointer-events: none;
      }

      .conn-title {
        font-size: 22px;
        font-weight: 900;
      }

      .conn-subtitle {
        color: #777d8b;
        font-size: 12px;
        margin-top: 2px;
      }

      .conn-close {
        margin-left: auto;
        background: #292c35;
        color: #fff;
        border: 0;
        width: 34px;
        height: 34px;
        border-radius: 9px;
        cursor: pointer;
        font-size: 20px;
      }

      .conn-section {
        background: #15171d;
        border: 1px solid #282c36;
        border-radius: 12px;
        padding: 12px;
        margin-bottom: 10px;
      }

      .conn-section-title {
        font-size: 11px;
        font-weight: 900;
        color: #888f9e;
        letter-spacing: .08em;
        margin-bottom: 9px;
      }

      .conn-match {
        background: #11141a;
        border: 1px solid #303746;
      }

      .conn-match-title {
        font-size: 16px;
        font-weight: 900;
      }

      .conn-match-description {
        color: #858c9b;
        font-size: 12px;
        line-height: 1.4;
        margin-top: 5px;
      }

      .conn-scan {
        width: 100%;
        margin-top: 10px;
        padding: 11px 13px;
        background: #7289da;
        color: white;
        border: 0;
        border-radius: 8px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 900;
      }

      .conn-scan:hover {
        background: #8298e8;
      }

      .conn-scan:disabled {
        opacity: .65;
        cursor: default;
      }

      .conn-scan-done {
        background: #3ba55d !important;
      }

      .conn-scan-status {
        margin-top: 6px;
        color: #7f8696;
        font-size: 11px;
        text-align: center;
      }

      .conn-input {
        width: 100%;
        background: #0d0f13;
        color: #fff;
        border: 1px solid #303440;
        border-radius: 8px;
        padding: 9px;
        margin-bottom: 8px;
      }

      .conn-btn {
        background: #5865f2;
        color: white;
        border: 0;
        border-radius: 8px;
        padding: 9px 13px;
        cursor: pointer;
        font-weight: 700;
      }

      .conn-btn:hover {
        filter: brightness(1.08);
      }

      .conn-btn:disabled {
        opacity: .45;
        cursor: default;
      }

      .conn-small {
        background: #292c35;
        color: #fff;
        border: 0;
        border-radius: 7px;
        padding: 7px 9px;
        cursor: pointer;
      }

      .conn-danger {
        background: #a32d3a;
      }

      .conn-segment {
        display: flex;
        gap: 6px;
        margin-bottom: 6px;
      }

      .conn-segment-text {
        flex: 1;
        background: #0d0f13;
        color: #fff;
        border: 1px solid #303440;
        border-radius: 8px;
        padding: 8px;
      }

      .conn-segment-color {
        width: 42px;
        height: 34px;
        border: 0;
        padding: 2px;
        background: #0d0f13;
        border-radius: 8px;
      }

      .conn-preview {
        min-height: 28px;
        padding: 7px;
        background: #0d0f13;
        border-radius: 8px;
        margin: 8px 0;
        font-weight: 800;
      }

      .conn-slots {
        display: flex;
        gap: 8px;
        margin-bottom: 8px;
      }

      .conn-slot {
        flex: 1;
      }

      .conn-room {
        background: #0e1014;
        border: 1px solid #282c36;
        border-radius: 11px;
        padding: 11px;
        margin-bottom: 8px;
      }

      .conn-room-title {
        font-size: 16px;
        font-weight: 800;
        margin-bottom: 5px;
      }

      .conn-room-meta {
        color: #8d93a2;
        font-size: 12px;
        margin-bottom: 7px;
      }

      .conn-room-rafit {
        display: inline-block;
        margin-left: 7px;
        color: #ff4fd8;
        font-weight: 800;
      }

      .conn-room-pro {
        display: inline-block;
        margin-left: 7px;
        color: #ffd35a;
        font-weight: 800;
      }

      .conn-players {
        display: grid;
        gap: 3px;
        margin-bottom: 8px;
      }

      .conn-player {
        display: flex;
        justify-content: space-between;
        padding: 4px 6px;
        border-radius: 6px;
        background: #15171d;
        font-size: 12px;
      }

      .conn-room-buttons {
        display: flex;
        justify-content: flex-end;
      }

      .conn-empty {
        color: #777d8b;
        text-align: center;
        padding: 20px;
      }

      .conn-status {
        color: #9298a7;
        font-size: 12px;
        margin-top: 8px;
      }

      .conn-online {
        color: #5cff8d;
        font-weight: 800;
      }

      .conn-offline {
        color: #ff6262;
        font-weight: 800;
      }

      .conn-kick-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: #0d0f13;
        border-radius: 7px;
        padding: 7px;
        margin-bottom: 5px;
        font-size: 12px;
      }

      .conn-hotkey {
        color: #747a89;
        font-size: 11px;
      }

      .conn-checks {
        display: flex;
        gap: 8px;
        margin-bottom: 8px;
        color: #bbb;
        font-size: 12px;
      }

      .conn-checks label {
        display: flex;
        align-items: center;
        gap: 5px;
      }
    `);

    const panel =
      document.createElement(
        "div"
      );

    panel.id =
      "connections-panel";

    const header =
      document.createElement(
        "div"
      );

    header.className =
      "conn-header";

    const logo =
      document.createElement(
        "img"
      );

    logo.className =
      "conn-logo";

    logo.src =
      RAFIT_LOGO;

    logo.onerror =
      () => {
        logo.style.display =
          "none";
      };

    const title =
      document.createElement(
        "div"
      );

    title.innerHTML = `
      <div class="conn-title">
        Connections
      </div>
      <div class="conn-subtitle">
        Multiplayer
      </div>
    `;

    const close =
      document.createElement(
        "button"
      );

    close.className =
      "conn-close";

    close.textContent =
      "×";

    close.onclick =
      closeUI;

    header.appendChild(
      logo
    );

    header.appendChild(
      title
    );

    header.appendChild(
      close
    );

    panel.appendChild(
      header
    );

    /*
     * MATCH CHECK
     */

    const match =
      document.createElement(
        "div"
      );

    match.className =
      "conn-section conn-match";

    match.innerHTML = `
      <div class="conn-section-title">
        MATCH CHECK
      </div>

      <div class="conn-match-title">
        Multiplayer Match Scanner
      </div>

      <div class="conn-match-description">
        Enter a real match first, then click the button.
        Connections will scan the game and remove the
        original bots so remote players can be rendered.
      </div>
    `;

    const scanButton =
      document.createElement(
        "button"
      );

    scanButton.className =
      "conn-scan";

    scanButton.textContent =
      "I AM INSIDE A MATCH";

    scanButton.onclick =
      confirmMatch;

    const scanStatus =
      document.createElement(
        "div"
      );

    scanStatus.className =
      "conn-scan-status";

    scanStatus.textContent =
      "Enter a match, then scan.";

    match.appendChild(
      scanButton
    );

    match.appendChild(
      scanStatus
    );

    panel.appendChild(
      match
    );

    /*
     * CONNECTION
     */

    const connectionSection =
      document.createElement(
        "div"
      );

    connectionSection.className =
      "conn-section";

    connectionSection.innerHTML = `
      <div class="conn-section-title">
        CONNECTION
      </div>
    `;

    const connection =
      document.createElement(
        "div"
      );

    connection.className =
      "conn-offline";

    connection.textContent =
      "OFFLINE";

    connectionSection.appendChild(
      connection
    );

    panel.appendChild(
      connectionSection
    );

    /*
     * CREATE ROOM
     */

    const create =
      document.createElement(
        "div"
      );

    create.className =
      "conn-section";

    create.innerHTML = `
      <div class="conn-section-title">
        CREATE ROOM
      </div>
    `;

    const segmentBox =
      document.createElement(
        "div"
      );

    const preview =
      document.createElement(
        "div"
      );

    preview.className =
      "conn-preview";

    const add =
      document.createElement(
        "button"
      );

    add.className =
      "conn-small";

    add.textContent =
      "+ Add segment";

    add.onclick =
      () => {
        addSegment(
          "SERVER",
          "#ffffff"
        );
      };

    const slots =
      document.createElement(
        "div"
      );

    slots.className =
      "conn-slots";

    const ct =
      document.createElement(
        "input"
      );

    ct.type =
      "number";

    ct.min =
      "1";

    ct.value =
      "5";

    ct.className =
      "conn-input conn-slot";

    const tt =
      document.createElement(
        "input"
      );

    tt.type =
      "number";

    tt.min =
      "1";

    tt.value =
      "5";

    tt.className =
      "conn-input conn-slot";

    slots.appendChild(
      ct
    );

    slots.appendChild(
      tt
    );

    const checks =
      document.createElement(
        "div"
      );

    checks.className =
      "conn-checks";

    const rafitLabel =
      document.createElement(
        "label"
      );

    const rafit =
      document.createElement(
        "input"
      );

    rafit.type =
      "checkbox";

    rafitLabel.appendChild(
      rafit
    );

    rafitLabel.append(
      " RAFIT"
    );

    const proLabel =
      document.createElement(
        "label"
      );

    const pro =
      document.createElement(
        "input"
      );

    pro.type =
      "checkbox";

    proLabel.appendChild(
      pro
    );

    proLabel.append(
      " Professional"
    );

    checks.appendChild(
      rafitLabel
    );

    checks.appendChild(
      proLabel
    );

    const createButton =
      document.createElement(
        "button"
      );

    createButton.className =
      "conn-btn";

    createButton.textContent =
      "Create Room";

    createButton.onclick =
      createRoomFromUI;

    create.appendChild(
      segmentBox
    );

    create.appendChild(
      preview
    );

    create.appendChild(
      add
    );

    create.appendChild(
      slots
    );

    create.appendChild(
      checks
    );

    create.appendChild(
      createButton
    );

    panel.appendChild(
      create
    );

    /*
     * ROOMS
     */

    const rooms =
      document.createElement(
        "div"
      );

    rooms.className =
      "conn-section";

    rooms.innerHTML = `
      <div class="conn-section-title">
        ROOMS
      </div>
    `;

    const roomList =
      document.createElement(
        "div"
      );

    rooms.appendChild(
      roomList
    );

    panel.appendChild(
      rooms
    );

    /*
     * CURRENT ROOM
     */

    const current =
      document.createElement(
        "div"
      );

    current.className =
      "conn-section";

    current.innerHTML = `
      <div class="conn-section-title">
        CURRENT ROOM
      </div>
    `;

    const currentName =
      document.createElement(
        "div"
      );

    currentName.textContent =
      "No room";

    const leave =
      document.createElement(
        "button"
      );

    leave.className =
      "conn-small";

    leave.style.marginTop =
      "8px";

    leave.textContent =
      "Leave Room";

    leave.onclick =
      () =>
        Network.leaveRoom();

    const kickList =
      document.createElement(
        "div"
      );

    kickList.style.marginTop =
      "10px";

    current.appendChild(
      currentName
    );

    current.appendChild(
      leave
    );

    current.appendChild(
      kickList
    );

    panel.appendChild(
      current
    );

    /*
     * STATUS
     */

    const status =
      document.createElement(
        "div"
      );

    status.className =
      "conn-status";

    status.textContent =
      "Offline";

    panel.appendChild(
      status
    );

    const hotkey =
      document.createElement(
        "div"
      );

    hotkey.className =
      "conn-hotkey";

    hotkey.textContent =
      "Backspace = open/close";

    panel.appendChild(
      hotkey
    );

    document.body.appendChild(
      panel
    );

    State.UI.panel =
      panel;

    State.UI.roomList =
      roomList;

    State.UI.current =
      currentName;

    State.UI.status =
      status;

    State.UI.connection =
      connection;

    State.UI.kickList =
      kickList;

    State.UI.segmentBox =
      segmentBox;

    State.UI.preview =
      preview;

    State.UI.segmentRows =
      [];

    State.UI.ctSlots =
      ct;

    State.UI.tSlots =
      tt;

    State.UI.rafit =
      rafit;

    State.UI.professional =
      pro;

    State.UI.scanButton =
      scanButton;

    State.UI.scanStatus =
      scanStatus;

    makePanelDraggable(
      panel,
      header
    );

    addSegment(
      "MY SERVER",
      "#ff3030"
    );

    addSegment(
      "pros only",
      "#ff4fd8"
    );

    renderSegmentsPreview();

    updateScanUI();
  }

  /* =========================================================
     HOTKEY
  ========================================================= */

  function installHotkeys() {
    document.addEventListener(
      "keydown",
      event => {
        if (
          event.code !==
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

        toggleUI();
      },
      true
    );
  }

  /* =========================================================
     MONITOR
  ========================================================= */

  function installMonitor() {
    State.monitorTimer =
      setInterval(
        () => {
          if (
            State.confirmedMatch
          ) {
            if (
              !isInsideMatch()
            ) {
              State.confirmedMatch =
                false;

              State.dead =
                false;

              stopStateLoop();

              /*
               * Don't immediately restore bots here if
               * the game is transitioning between states.
               * The next explicit scan/room leave handles it.
               */
              updateScanUI();

              updateStatus(
                "Match ended. Scan again."
              );
            }
          }

          updateBots();
        },
        100
      );
  }

  /* =========================================================
     DEBUG API
  ========================================================= */

  function installDebug() {
    unsafeWindow.__connections_multiplayer =
      {
        version:
          VERSION,

        connected:
          () =>
            State.connected,

        room:
          () =>
            State.room,

        rooms:
          () =>
            State.rooms,

        confirm:
          confirmMatch,

        scan:
          confirmMatch,

        isInsideMatch:
          isInsideMatch,

        connect:
          () =>
            Network.connect(),

        createRoom:
          data =>
            Network.createRoom(
              data
            ),

        joinRoom:
          id =>
            Network.joinRoom(
              id
            ),

        leave:
          () =>
            Network.leaveRoom(),

        kick:
          id =>
            Network.kick(
              id
            ),

        state:
          () => ({
            id:
              State.id,

            name:
              State.name,

            room:
              State.room,

            connected:
              State.connected,

            joined:
              State.joinedRoom,

            confirmedMatch:
              State.confirmedMatch,

            remotes:
              State.remotes.size,

            originalBots:
              State.originalBots.length,

            botConstructor:
              !!State.botConstructor,

            botArrayKey:
              State.botArrayKey,

            roomData:
              State.roomData
          })
      };
  }

  /* =========================================================
     BOOT
  ========================================================= */

  function boot() {
    buildUI();

    installHotkeys();

    installMonitor();

    installDebug();

    Network.connect();

    log(
      "Connections",
      VERSION,
      "loaded."
    );

    log(
      "Press Backspace to open."
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
