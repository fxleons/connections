// ==UserScript==
// @name         Connections
// @namespace    conn
// @version      1.0.0
// @description  clutcher.io multiplayer
// @match        *://clutcher.io/*
// @match        *://*.clutcher.io/*
// @grant        unsafeWindow
// @grant        GM_addStyle
// @connect      able-vpn-star-constitutional.trycloudflare.com
// @run-at       document-start
// ==/UserScript==

(() => {
  "use strict";

  const VERSION = "1.0.0";
  const WS_URL = "wss://able-vpn-star-constitutional.trycloudflare.com";
  const RAFIT_LOGO =
    "https://raw.githubusercontent.com/fxleons/connections/main/rafit_logo.png";

  const W = unsafeWindow || window;

  const State = {
    ws: null,
    connected: false,
    connecting: false,

    id: null,
    name: localStorage.getItem("connections_name") || "Player",
    nameColor: localStorage.getItem("connections_name_color") || "#7289da",

    room: null,
    roomData: null,
    rooms: [],

    joinedRoom: false,
    confirmedMatch: false,

    game: null,
    botManager: null,

    originalBots: [],
    botPool: [],

    remotes: new Map(),

    localAvatar: localStorage.getItem("pp-avatar") || null,

    UI: {},

    stateTimer: null,
    monitorTimer: null,

    chat: {
      open: false,
      input: null,
      messages: []
    },

    rtp: Number(localStorage.getItem("connections_rtp") || 0),
    rafit: true
  };

  const log = (...a) =>
    console.log("[Connections]", ...a);

  const warn = (...a) =>
    console.warn("[Connections]", ...a);

  const err = (...a) =>
    console.error("[Connections]", ...a);

  function saveProfile() {
    try {
      localStorage.setItem("connections_name", State.name);
      localStorage.setItem(
        "connections_name_color",
        State.nameColor
      );
    } catch {}
  }

  /* =========================================================
     GAME
  ========================================================= */

  function getGame() {
    if (State.game && typeof State.game === "object") {
      return State.game;
    }

    const candidates = [
      W.game,
      W.Game,
      W.clutcher,
      W.__game,
      W.app,
      W.engine
    ];

    for (const g of candidates) {
      if (g && typeof g === "object") {
        State.game = g;
        return g;
      }
    }

    return null;
  }

  function getLocalPlayer() {
    const g = getGame();

    if (!g) return null;

    const players = [
      g.player,
      g.localPlayer,
      g.me,
      g.character,
      g.local,
      g.myPlayer,
      g.playerEntity
    ];

    for (const p of players) {
      if (p && typeof p === "object") {
        return p;
      }
    }

    return null;
  }

  function isInsideMatch() {
    const g = getGame();

    if (!g) return false;

    try {
      if (
        typeof g.isInMatch === "function" &&
        g.isInMatch()
      ) {
        return true;
      }
    } catch {}

    if (g.gameState === "playing") return true;
    if (g.state === "playing") return true;
    if (g.inMatch === true) return true;

    if (
      g.match &&
      (
        g.match.isStarted === true ||
        g.match.started === true
      )
    ) {
      return true;
    }

    return false;
  }

  function getBotManager() {
    if (
      State.botManager &&
      typeof State.botManager === "object"
    ) {
      return State.botManager;
    }

    const g = getGame();

    if (!g) return null;

    const manager =
      g.botMgr ||
      g.botManager ||
      g.bots ||
      g.ai ||
      g.botSystem ||
      g.enemyManager;

    if (manager && typeof manager === "object") {
      State.botManager = manager;
      return manager;
    }

    return null;
  }

  function getBotArray() {
    const mgr = getBotManager();

    if (!mgr) return null;

    if (Array.isArray(mgr.bots)) {
      return mgr.bots;
    }

    if (Array.isArray(mgr.agents)) {
      return mgr.agents;
    }

    if (Array.isArray(mgr.entities)) {
      return mgr.entities;
    }

    if (Array.isArray(mgr.players)) {
      return mgr.players;
    }

    return null;
  }

  function positionOf(obj) {
    if (!obj) {
      return { x: 0, y: 0, z: 0 };
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
      return { yaw: 0, pitch: 0 };
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

  function setPosition(bot, x, y, z) {
    if (!bot) return;

    const p = { x, y, z };

    try {
      if (bot.position) {
        bot.position.x = x;
        bot.position.y = y;
        bot.position.z = z;
      }
    } catch {}

    try {
      if (bot.pos) {
        bot.pos.x = x;
        bot.pos.y = y;
        bot.pos.z = z;
      }
    } catch {}

    try {
      if (bot.transform?.position) {
        bot.transform.position.x = x;
        bot.transform.position.y = y;
        bot.transform.position.z = z;
      }
    } catch {}

    try {
      if (bot.root?.position) {
        bot.root.position.x = x;
        bot.root.position.y = y;
        bot.root.position.z = z;
      }
    } catch {}

    try {
      if (bot.cs2Agent?.root?.position) {
        bot.cs2Agent.root.position.x = x;
        bot.cs2Agent.root.position.y = y;
        bot.cs2Agent.root.position.z = z;
      }
    } catch {}

    try {
      if (typeof bot.setPosition === "function") {
        bot.setPosition(p);
      }
    } catch {}
  }

  function setRotation(bot, yaw, pitch) {
    if (!bot) return;

    try {
      if (bot.rotation) {
        bot.rotation.y = yaw;
        bot.rotation.x = pitch;
      }
    } catch {}

    try {
      if (bot.eulerAngles) {
        bot.eulerAngles.y = yaw;
        bot.eulerAngles.x = pitch;
      }
    } catch {}

    try {
      if (bot.transform?.rotation) {
        bot.transform.rotation.y = yaw;
        bot.transform.rotation.x = pitch;
      }
    } catch {}

    try {
      if (bot.root?.rotation) {
        bot.root.rotation.y = yaw;
        bot.root.rotation.x = pitch;
      }
    } catch {}

    try {
      if (typeof bot.setRotation === "function") {
        bot.setRotation(yaw, pitch);
      }
    } catch {}
  }

  function hideBot(bot) {
    if (!bot) return;

    try { bot.visible = false; } catch {}
    try { bot.enabled = false; } catch {}
    try { bot.isPlayer = false; } catch {}

    try {
      if (bot.gameObject) {
        bot.gameObject.active = false;
      }
    } catch {}

    try {
      if (bot.root) {
        bot.root.visible = false;
      }
    } catch {}

    try {
      if (bot.cs2Agent?.root) {
        bot.cs2Agent.root.visible = false;
      }
    } catch {}

    try {
      if (typeof bot.setVisible === "function") {
        bot.setVisible(false);
      }
    } catch {}
  }

  function showBot(bot) {
    if (!bot) return;

    try { bot.visible = true; } catch {}
    try { bot.enabled = true; } catch {}

    try {
      if (bot.gameObject) {
        bot.gameObject.active = true;
      }
    } catch {}

    try {
      if (bot.root) {
        bot.root.visible = true;
      }
    } catch {}

    try {
      if (bot.cs2Agent?.root) {
        bot.cs2Agent.root.visible = true;
      }
    } catch {}

    try {
      if (typeof bot.setVisible === "function") {
        bot.setVisible(true);
      }
    } catch {}
  }

  /* =========================================================
     BOT POOL
  ========================================================= */

  function captureOriginalBots() {
    const mgr = getBotManager();
    const arr = getBotArray();

    if (!mgr || !arr) {
      warn("Bot manager/array not found.");
      return false;
    }

    if (State.originalBots.length) {
      return true;
    }

    const bots = arr.slice();

    log(
      "Bot scan:",
      bots.length,
      "original bots found."
    );

    State.originalBots = bots;
    State.botPool = bots.slice();

    /*
     * IMPORTANT:
     * capture FIRST, remove SECOND.
     */
    for (const bot of bots) {
      hideBot(bot);

      const i = arr.indexOf(bot);

      if (i !== -1) {
        arr.splice(i, 1);
      }
    }

    log(
      "Captured bot pool:",
      State.botPool.length
    );

    return true;
  }

  function acquireBot() {
    const bot = State.botPool.find(
      b => b && !State.remotesHasBot?.(b)
    );

    if (!bot) {
      return null;
    }

    const i = State.botPool.indexOf(bot);

    if (i !== -1) {
      State.botPool.splice(i, 1);
    }

    return bot;
  }

  function releaseBot(bot) {
    if (!bot) return;

    const arr = getBotArray();

    if (arr) {
      const i = arr.indexOf(bot);

      if (i !== -1) {
        arr.splice(i, 1);
      }
    }

    hideBot(bot);

    if (!State.botPool.includes(bot)) {
      State.botPool.push(bot);
    }
  }

  function addBotToManager(bot) {
    const arr = getBotArray();

    if (!arr || !bot) return;

    if (!arr.includes(bot)) {
      arr.push(bot);
    }

    showBot(bot);
  }

  State.remotesHasBot = function(bot) {
    for (const remote of State.remotes.values()) {
      if (remote.bot === bot) {
        return true;
      }
    }

    return false;
  };

  function applyBotData(bot, remote) {
    if (!bot || !remote) return;

    try { bot.name = remote.name; } catch {}
    try { bot.team = remote.team; } catch {}
    try { bot.health = remote.health; } catch {}
    try { bot.alive = remote.alive; } catch {}
    try { bot.dead = !remote.alive; } catch {}
    try { bot.isPlayer = true; } catch {}

    try {
      bot.playerName = remote.name;
    } catch {}

    try {
      bot.avatar = remote.avatar;
    } catch {}

    setPosition(
      bot,
      remote.x,
      remote.y,
      remote.z
    );

    setRotation(
      bot,
      remote.yaw,
      remote.pitch
    );
  }

  function createRemoteBot(remote) {
    if (!remote || remote.bot) {
      return remote?.bot || null;
    }

    const bot = acquireBot();

    if (!bot) {
      warn(
        "No free bot in pool for remote:",
        remote.name
      );
      return null;
    }

    remote.bot = bot;

    applyBotData(bot, remote);
    addBotToManager(bot);

    log(
      "Remote bot assigned:",
      remote.name
    );

    return bot;
  }

  function updateBots() {
    for (const remote of State.remotes.values()) {
      if (!remote.bot) {
        if (!remote.dead) {
          createRemoteBot(remote);
        }

        continue;
      }

      if (remote.dead) {
        releaseBot(remote.bot);
        remote.bot = null;
        continue;
      }

      remote.x +=
        (remote.targetX - remote.x) * 0.35;

      remote.y +=
        (remote.targetY - remote.y) * 0.35;

      remote.z +=
        (remote.targetZ - remote.z) * 0.35;

      remote.yaw +=
        (remote.targetYaw - remote.yaw) * 0.35;

      remote.pitch +=
        (remote.targetPitch - remote.pitch) * 0.35;

      applyBotData(remote.bot, remote);
    }
  }

  function removeRemote(id) {
    const remote = State.remotes.get(String(id));

    if (!remote) return;

    if (remote.bot) {
      releaseBot(remote.bot);
      remote.bot = null;
    }

    State.remotes.delete(String(id));
  }

  function clearRemoteBots() {
    for (const remote of State.remotes.values()) {
      if (remote.bot) {
        releaseBot(remote.bot);
        remote.bot = null;
      }
    }

    State.remotes.clear();
  }

  /* =========================================================
     NETWORK
  ========================================================= */

  function send(type, data = {}) {
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
      err(e);
      return false;
    }
  }

  const Network = {
    connect() {
      if (
        State.connecting ||
        (
          State.ws &&
          State.ws.readyState === WebSocket.OPEN
        )
      ) {
        return;
      }

      State.connecting = true;
      setStatus("Connecting...");

      let ws;

      try {
        ws = new WebSocket(WS_URL);
      } catch (e) {
        State.connecting = false;
        setStatus("WebSocket error");
        return;
      }

      State.ws = ws;

      ws.onopen = () => {
        State.connected = true;
        State.connecting = false;

        setStatus("Connected");

        send("list_rooms");

        updateUI();
      };

      ws.onmessage = e => {
        let msg;

        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }

        Network.handle(msg);
      };

      ws.onerror = () => {
        State.connected = false;
        setStatus("Connection error");
        updateUI();
      };

      ws.onclose = () => {
        State.connected = false;
        State.connecting = false;
        State.joinedRoom = false;

        State.ws = null;

        stopStateLoop();
        clearRemoteBots();

        setStatus("Disconnected");
        updateUI();
      };
    },

    createRoom(data) {
      if (!State.connected) {
        this.connect();

        setTimeout(
          () => this.createRoom(data),
          500
        );

        return;
      }

      send("create_room", {
        ...data,
        name: State.name,
        avatar: State.localAvatar
      });
    },

    joinRoom(roomId) {
      if (!roomId) return;

      if (!State.connected) {
        this.connect();

        setTimeout(
          () => this.joinRoom(roomId),
          500
        );

        return;
      }

      send("join_room", {
        roomId,
        name: State.name,
        avatar: State.localAvatar
      });

      setStatus("Joining room...");
    },

    leaveRoom() {
      if (!State.joinedRoom) return;

      State.confirmedMatch = false;

      stopStateLoop();
      clearRemoteBots();

      send("leave_room");
    },

    kick(id) {
      send("kick", {
        targetId: id
      });
    },

    handle(msg) {
      if (!msg) return;

      switch (msg.type) {
        case "connected":
        case "hello":
          if (msg.id) {
            State.id = String(msg.id);
          }
          break;

        case "rooms":
          State.rooms =
            Array.isArray(msg.rooms)
              ? msg.rooms
              : [];

          renderRooms();
          break;

        case "room_joined":
          State.room =
            msg.room?.id ||
            msg.roomId ||
            null;

          State.roomData =
            msg.room || null;

          if (msg.id) {
            State.id = String(msg.id);
          }

          State.joinedRoom = true;

          setStatus(
            "Room joined. Enter your match and scan."
          );

          updateScanUI();
          updateUI();
          break;

        case "roster":
          if (msg.room) {
            State.roomData = msg.room;
          }

          renderRooms();
          updateUI();
          break;

        case "join":
          renderRooms();
          break;

        case "leave":
          if (msg.id) {
            removeRemote(msg.id);
          }

          renderRooms();
          break;

        case "host_changed":
          renderRooms();
          break;

        case "left_room":
        case "kicked":
          State.joinedRoom = false;
          State.room = null;
          State.roomData = null;
          State.confirmedMatch = false;

          stopStateLoop();
          clearRemoteBots();

          updateScanUI();
          updateUI();

          setStatus(
            msg.type === "kicked"
              ? "You were kicked."
              : "Left room."
          );
          break;

        case "state":
          handleState(msg);
          break;

        case "chat":
          receiveChat(msg);
          break;

        case "rafit_warning":
          setStatus(
            "RAFIT warning: " +
            (msg.type || "") +
            " | RTP " +
            (msg.rtp ?? State.rtp)
          );
          break;

        case "rafit_banned":
          State.confirmedMatch = false;
          stopStateLoop();
          setStatus("RAFIT: banned.");
          break;

        case "error":
          setStatus(
            msg.code ||
            msg.message ||
            "Server error"
          );
          break;
      }
    }
  };

  /* =========================================================
     STATE
  ========================================================= */

  function handleState(msg) {
    const players =
      Array.isArray(msg.players)
        ? msg.players
        : [];

    for (const data of players) {
      if (!data?.id) continue;

      const id = String(data.id);

      if (
        State.id &&
        id === String(State.id)
      ) {
        continue;
      }

      let remote = State.remotes.get(id);

      if (!remote) {
        remote = {
          id,

          name: data.name || "Player",
          team: data.team || "CT",

          x: Number(data.x) || 0,
          y: Number(data.y) || 0,
          z: Number(data.z) || 0,

          targetX: Number(data.x) || 0,
          targetY: Number(data.y) || 0,
          targetZ: Number(data.z) || 0,

          yaw: Number(data.yaw) || 0,
          pitch: Number(data.pitch) || 0,

          targetYaw: Number(data.yaw) || 0,
          targetPitch: Number(data.pitch) || 0,

          health:
            typeof data.health === "number"
              ? data.health
              : 100,

          alive: data.alive !== false,
          dead: data.dead === true,

          avatar: data.avatar || null,

          bot: null
        };

        State.remotes.set(id, remote);
      }

      remote.name =
        data.name || remote.name;

      remote.team =
        data.team || remote.team;

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
        typeof data.health === "number"
          ? data.health
          : remote.health;

      remote.alive =
        data.alive !== false &&
        data.dead !== true &&
        remote.health > 0;

      remote.dead = !remote.alive;

      remote.avatar =
        data.avatar ||
        remote.avatar ||
        null;

      if (remote.dead) {
        if (remote.bot) {
          releaseBot(remote.bot);
          remote.bot = null;
        }
      } else if (!remote.bot) {
        createRemoteBot(remote);
      }
    }

    updateBots();
  }

  function getLocalState() {
    const player = getLocalPlayer();

    if (!player) return null;

    const p = positionOf(player);
    const r = rotationOf(player);

    let health = 100;

    if (typeof player.health === "number") {
      health = player.health;
    }

    let alive = true;

    if (typeof player.alive === "boolean") {
      alive = player.alive;
    }

    if (typeof player.dead === "boolean") {
      alive = !player.dead;
    }

    if (health <= 0) {
      alive = false;
    }

    const team =
      player.team ||
      player.side ||
      player.faction ||
      "CT";

    return {
      x: p.x,
      y: p.y,
      z: p.z,

      yaw: r.yaw,
      pitch: r.pitch,

      alive,
      dead: !alive,

      health,

      name: State.name,
      team,

      avatar: State.localAvatar
    };
  }

  function startStateLoop() {
    stopStateLoop();

    State.stateTimer = setInterval(() => {
      if (!State.joinedRoom) return;
      if (!State.confirmedMatch) return;
      if (!isInsideMatch()) return;

      const state = getLocalState();

      if (!state) return;

      send("state", {
        state
      });
    }, 50);
  }

  function stopStateLoop() {
    if (State.stateTimer) {
      clearInterval(State.stateTimer);
      State.stateTimer = null;
    }
  }

  /* =========================================================
     MATCH SCANNER
  ========================================================= */

  function confirmMatch() {
    if (!State.joinedRoom) {
      setStatus("Join a room first.");
      return;
    }

    if (!isInsideMatch()) {
      setStatus(
        "You must be inside a real match first."
      );
      return;
    }

    const mgr = getBotManager();
    const arr = getBotArray();

    if (!mgr || !arr) {
      setStatus(
        "Bot manager not found."
      );

      warn(
        "window.game:",
        getGame()
      );

      return;
    }

    log(
      "Match detected. Scanning bot manager..."
    );

    /*
     * This happens BEFORE touching the original
     * bot array.
     */
    const ok = captureOriginalBots();

    if (!ok) {
      setStatus(
        "Could not capture original bots."
      );
      return;
    }

    State.confirmedMatch = true;

    setStatus(
      "Match confirmed. Multiplayer ready."
    );

    updateScanUI();

    startStateLoop();

    log(
      "Original bots:",
      State.originalBots.length
    );

    log(
      "Connections multiplayer ready."
    );
  }

  function monitorMatch() {
    if (
      State.confirmedMatch &&
      !isInsideMatch()
    ) {
      State.confirmedMatch = false;

      stopStateLoop();
      clearRemoteBots();

      State.originalBots = [];
      State.botPool = [];
      State.botManager = null;

      updateScanUI();
    }

    updateBots();
  }

  /* =========================================================
     CHAT - IN GAME ONLY
     ========================================================= */

  function createChat() {
    if (document.getElementById("connections-game-chat")) {
      return;
    }

    const box = document.createElement("div");

    box.id = "connections-game-chat";

    box.innerHTML = `
      <div class="conn-chat-messages"></div>
      <input
        class="conn-chat-input"
        maxlength="300"
        autocomplete="off"
        placeholder="Say something..."
      >
    `;

    box.style.cssText = `
      position:fixed;
      left:18px;
      bottom:18px;
      width:420px;
      z-index:2147483646;
      pointer-events:none;
      font-family:Arial,sans-serif;
      display:none;
    `;

    const messages =
      box.querySelector(".conn-chat-messages");

    messages.style.cssText = `
      display:flex;
      flex-direction:column;
      gap:3px;
      max-height:220px;
      overflow:hidden;
      margin-bottom:8px;
      text-shadow:0 2px 4px #000;
    `;

    const input =
      box.querySelector(".conn-chat-input");

    input.style.cssText = `
      width:100%;
      box-sizing:border-box;
      padding:9px 11px;
      border:1px solid #444;
      border-radius:7px;
      outline:none;
      background:rgba(10,10,14,.92);
      color:#fff;
      font-size:14px;
      pointer-events:auto;
    `;

    document.body.appendChild(box);

    State.chat.input = input;

    input.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();

        const text = input.value.trim();

        if (text) {
          send("chat", {
            text
          });
        }

        closeChat();
      }

      if (e.key === "Escape") {
        e.preventDefault();
        closeChat();
      }
    });
  }

  function openChat() {
    if (!isInsideMatch()) return;

    createChat();

    const box =
      document.getElementById(
        "connections-game-chat"
      );

    if (!box) return;

    State.chat.open = true;

    box.style.display = "block";

    State.chat.input.value = "";

    setTimeout(() => {
      State.chat.input?.focus();
    }, 0);
  }

  function closeChat() {
    State.chat.open = false;

    const box =
      document.getElementById(
        "connections-game-chat"
      );

    if (box) {
      box.style.display = "none";
    }
  }

  function receiveChat(msg) {
    const name =
      msg.name ||
      msg.player ||
      "Player";

    const text =
      String(msg.text || "").slice(0, 300);

    if (!text) return;

    createChat();

    const container =
      document.querySelector(
        "#connections-game-chat .conn-chat-messages"
      );

    if (!container) return;

    const row =
      document.createElement("div");

    row.style.cssText = `
      color:#fff;
      font-size:14px;
      line-height:19px;
      opacity:1;
    `;

    const sender =
      document.createElement("span");

    sender.textContent =
      name + ": ";

    sender.style.cssText = `
      color:#7289da;
      font-weight:700;
    `;

    const message =
      document.createElement("span");

    message.textContent = text;

    row.appendChild(sender);
    row.appendChild(message);

    container.appendChild(row);

    while (container.children.length > 8) {
      container.removeChild(
        container.firstChild
      );
    }

    setTimeout(() => {
      row.style.transition =
        "opacity .4s";

      row.style.opacity = "0";

      setTimeout(() => {
        row.remove();
      }, 450);
    }, 7000);
  }

  /* =========================================================
     UI
  ========================================================= */

  GM_addStyle(`
    #connections-panel,
    #connections-panel * {
      box-sizing:border-box;
    }

    #connections-panel {
      position:fixed;
      top:50%;
      left:50%;
      transform:translate(-50%,-50%);
      width:780px;
      max-width:calc(100vw - 30px);
      max-height:calc(100vh - 30px);
      overflow:auto;
      z-index:999999;
      background:#101116;
      color:#eee;
      border:1px solid #2c2f3a;
      border-radius:16px;
      box-shadow:0 20px 80px rgba(0,0,0,.65);
      font-family:Arial,sans-serif;
      padding:18px;
      display:none;
    }

    #connections-panel::-webkit-scrollbar {
      width:8px;
    }

    #connections-panel::-webkit-scrollbar-thumb {
      background:#2c2f3a;
      border-radius:10px;
    }

    .conn-header {
      display:flex;
      align-items:center;
      gap:12px;
      margin-bottom:18px;
      cursor:move;
      user-select:none;
    }

    .conn-logo {
      width:48px;
      height:48px;
      object-fit:contain;
      border-radius:10px;
    }

    .conn-title {
      font-size:22px;
      font-weight:800;
    }

    .conn-subtitle {
      color:#8d91a0;
      font-size:12px;
      margin-top:2px;
    }

    .conn-close {
      margin-left:auto;
      width:34px;
      height:34px;
      border:1px solid #30333f;
      border-radius:9px;
      background:#181a21;
      color:#aaa;
      font-size:22px;
      cursor:pointer;
    }

    .conn-close:hover {
      background:#22252e;
      color:#fff;
    }

    .conn-section {
      margin-top:14px;
      padding:14px;
      border:1px solid #292c36;
      border-radius:12px;
      background:#14161d;
    }

    .conn-section-title {
      color:#777c8c;
      font-size:11px;
      font-weight:800;
      letter-spacing:1.2px;
      margin-bottom:10px;
    }

    .conn-match-title {
      font-size:16px;
      font-weight:700;
      margin-bottom:5px;
    }

    .conn-match-description {
      color:#969aa8;
      font-size:12px;
      line-height:18px;
      margin-bottom:12px;
    }

    .conn-btn {
      border:1px solid #383c49;
      border-radius:8px;
      background:#1b1e27;
      color:#fff;
      padding:9px 12px;
      cursor:pointer;
      font-weight:700;
    }

    .conn-btn:hover {
      background:#252936;
    }

    .conn-btn.primary {
      background:#7289da;
      border-color:#7289da;
      color:#fff;
    }

    .conn-btn.primary:hover {
      background:#6379c7;
    }

    .conn-status {
      display:flex;
      align-items:center;
      gap:8px;
      font-size:13px;
    }

    .conn-dot {
      width:8px;
      height:8px;
      border-radius:50%;
      background:#666;
    }

    .conn-dot.online {
      background:#43d17a;
      box-shadow:0 0 8px rgba(67,209,122,.55);
    }

    .conn-dot.offline {
      background:#e25555;
    }

    .conn-profile {
      display:flex;
      gap:8px;
      margin-bottom:10px;
    }

    .conn-input {
      width:100%;
      background:#0e1015;
      color:#fff;
      border:1px solid #30333e;
      border-radius:8px;
      padding:9px;
      outline:none;
    }

    .conn-color {
      width:44px;
      height:36px;
      padding:2px;
      border:1px solid #30333e;
      background:#0e1015;
      border-radius:8px;
    }

    .conn-room-card {
      border:1px solid #292c36;
      background:#101218;
      border-radius:10px;
      padding:11px;
      margin-top:8px;
    }

    .conn-room-head {
      display:flex;
      align-items:center;
      gap:8px;
    }

    .conn-room-name {
      font-weight:800;
    }

    .conn-room-meta {
      color:#777c8c;
      font-size:11px;
      margin-top:4px;
    }

    .conn-room-players {
      color:#aaa;
      font-size:12px;
      margin-top:8px;
      line-height:18px;
    }

    .conn-room-actions {
      margin-top:9px;
      display:flex;
      gap:7px;
    }

    .conn-tag {
      display:inline-block;
      font-size:10px;
      font-weight:800;
      padding:3px 6px;
      border-radius:5px;
      background:#252936;
      color:#aaa;
    }

    .conn-tag.rafit {
      background:#25213a;
      color:#b5a7ff;
    }

    .conn-tag.rtp {
      background:#202d39;
      color:#8ac8ff;
    }

    .conn-create-row {
      display:flex;
      gap:8px;
      margin-top:8px;
    }

    .conn-segments {
      display:flex;
      flex-direction:column;
      gap:7px;
    }

    .conn-segment {
      display:grid;
      grid-template-columns:1fr 80px 80px 42px 42px 36px;
      gap:6px;
      align-items:center;
    }

    .conn-segment input[type="number"] {
      width:100%;
      background:#0e1015;
      color:#fff;
      border:1px solid #30333e;
      border-radius:7px;
      padding:7px;
    }

    .conn-segment input[type="color"] {
      width:36px;
      height:32px;
      border:1px solid #30333e;
      border-radius:7px;
      background:#0e1015;
      padding:2px;
    }

    .conn-check {
      display:flex;
      gap:8px;
      align-items:center;
      color:#aaa;
      font-size:12px;
      margin-top:9px;
    }

    .conn-footer {
      color:#666b79;
      text-align:center;
      font-size:11px;
      margin-top:15px;
    }

    .conn-current-player {
      display:flex;
      align-items:center;
      gap:8px;
      padding:7px;
      background:#0f1117;
      border-radius:7px;
      margin-top:5px;
    }

    .conn-player-name {
      font-weight:700;
    }

    .conn-kick {
      margin-left:auto;
      background:#321c22;
      border:1px solid #542630;
      color:#ff8b9d;
      border-radius:6px;
      padding:4px 7px;
      cursor:pointer;
      font-size:11px;
    }

    .conn-status-text {
      margin-top:8px;
      color:#8e93a1;
      font-size:12px;
    }

    .conn-brand {
      margin-left:auto;
      display:flex;
      align-items:center;
      gap:5px;
    }
  `);

  function buildUI() {
    if (document.getElementById("connections-panel")) {
      return;
    }

    const panel =
      document.createElement("div");

    panel.id = "connections-panel";

    panel.innerHTML = `
      <div class="conn-header">
        <img
          class="conn-logo"
          src="${RAFIT_LOGO}"
        >

        <div>
          <div class="conn-title">
            Connections
          </div>

          <div class="conn-subtitle">
            Multiplayer
          </div>
        </div>

        <div class="conn-brand">
          <span class="conn-tag rafit">
            RAFIT
          </span>

          <span class="conn-tag rtp">
            RTP ${State.rtp}
          </span>
        </div>

        <button class="conn-close">
          ×
        </button>
      </div>

      <div class="conn-section">
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

        <button
          id="conn-match-btn"
          class="conn-btn primary"
        >
          I AM INSIDE A MATCH
        </button>

        <div
          id="conn-match-status"
          class="conn-status-text"
        >
          Not confirmed.
        </div>
      </div>

      <div class="conn-section">
        <div class="conn-section-title">
          CONNECTION
        </div>

        <div class="conn-status">
          <span
            id="conn-dot"
            class="conn-dot offline"
          ></span>

          <span id="conn-connection-text">
            OFFLINE
          </span>
        </div>
      </div>

      <div class="conn-section">
        <div class="conn-section-title">
          PROFILE
        </div>

        <div class="conn-profile">
          <input
            id="conn-name"
            class="conn-input"
            placeholder="Player name"
            maxlength="24"
          >

          <input
            id="conn-name-color"
            class="conn-color"
            type="color"
          >
        </div>

        <button
          id="conn-save-profile"
          class="conn-btn"
        >
          Save Profile
        </button>
      </div>

      <div class="conn-section">
        <div class="conn-section-title">
          CREATE ROOM
        </div>

        <div class="conn-create-row">
          <input
            id="conn-room-name"
            class="conn-input"
            placeholder="Room name"
            maxlength="32"
          >
        </div>

        <div
          id="conn-segments"
          class="conn-segments"
        ></div>

        <button
          id="conn-add-segment"
          class="conn-btn"
          style="margin-top:8px"
        >
          + Add segment
        </button>

        <label class="conn-check">
          <input
            id="conn-rafit"
            type="checkbox"
            checked
          >
          RAFIT
        </label>

        <label class="conn-check">
          <input
            id="conn-professional"
            type="checkbox"
          >
          Professional
        </label>

        <button
          id="conn-create-room"
          class="conn-btn primary"
          style="margin-top:10px"
        >
          Create Room
        </button>
      </div>

      <div class="conn-section">
        <div class="conn-section-title">
          ROOMS
        </div>

        <div id="conn-rooms">
          Loading rooms...
        </div>
      </div>

      <div class="conn-section">
        <div class="conn-section-title">
          CURRENT ROOM
        </div>

        <div
          id="conn-current-room"
          class="conn-status-text"
        >
          Not in a room.
        </div>

        <button
          id="conn-leave-room"
          class="conn-btn"
          style="margin-top:8px"
        >
          Leave Room
        </button>

        <div
          id="conn-current-players"
          style="margin-top:9px"
        ></div>
      </div>

      <div class="conn-footer">
        <span id="conn-status">
          Offline
        </span>
        <br>
        Backspace = open/close
      </div>
    `;

    document.body.appendChild(panel);

    State.UI.panel = panel;

    State.UI.matchBtn =
      panel.querySelector(
        "#conn-match-btn"
      );

    State.UI.rooms =
      panel.querySelector(
        "#conn-rooms"
      );

    State.UI.currentRoom =
      panel.querySelector(
        "#conn-current-room"
      );

    State.UI.currentPlayers =
      panel.querySelector(
        "#conn-current-players"
      );

    State.UI.status =
      panel.querySelector(
        "#conn-status"
      );

    State.UI.matchStatus =
      panel.querySelector(
        "#conn-match-status"
      );

    bindUI();

    addSegment();
  }

  function bindUI() {
    const panel = State.UI.panel;

    panel
      .querySelector(".conn-close")
      .onclick = () => {
        toggleUI(false);
      };

    State.UI.matchBtn.onclick =
      confirmMatch;

    panel.querySelector(
      "#conn-save-profile"
    ).onclick = () => {
      const name =
        panel.querySelector(
          "#conn-name"
        ).value.trim();

      const color =
        panel.querySelector(
          "#conn-name-color"
        ).value;

      if (name) {
        State.name = name;
      }

      if (color) {
        State.nameColor = color;
      }

      saveProfile();

      setStatus(
        "Profile saved."
      );
    };

    panel.querySelector(
      "#conn-add-segment"
    ).onclick = addSegment;

    panel.querySelector(
      "#conn-create-room"
    ).onclick = createRoomFromUI;

    panel.querySelector(
      "#conn-leave-room"
    ).onclick = () => {
      Network.leaveRoom();
    };

    panel.querySelector(
      "#conn-name"
    ).value = State.name;

    panel.querySelector(
      "#conn-name-color"
    ).value = State.nameColor;

    makeDraggable(panel);
  }

  function addSegment(
    defaults = {}
  ) {
    const container =
      document.getElementById(
        "conn-segments"
      );

    if (!container) return;

    const row =
      document.createElement("div");

    row.className =
      "conn-segment";

    row.innerHTML = `
      <input
        class="conn-input segment-name"
        placeholder="Segment"
        value="${defaults.name || "Segment"}"
      >

      <input
        type="number"
        class="segment-ct"
        min="0"
        max="32"
        value="${defaults.ct ?? 5}"
      >

      <input
        type="number"
        class="segment-tt"
        min="0"
        max="32"
        value="${defaults.tt ?? 5}"
      >

      <input
        type="color"
        class="segment-color"
        value="${defaults.color || "#7289da"}"
      >

      <span class="conn-tag">
        CT/TT
      </span>

      <button
        class="conn-btn segment-remove"
      >
        ×
      </button>
    `;

    row.querySelector(
      ".segment-remove"
    ).onclick = () => {
      row.remove();
    };

    container.appendChild(row);
  }

  function createRoomFromUI() {
    const name =
      document.getElementById(
        "conn-room-name"
      )?.value.trim();

    if (!name) {
      setStatus(
        "Enter a room name."
      );
      return;
    }

    const segments = [
      ...document.querySelectorAll(
        "#conn-segments .conn-segment"
      )
    ].map(row => ({
      name:
        row.querySelector(
          ".segment-name"
        ).value || "Segment",

      ct:
        Number(
          row.querySelector(
            ".segment-ct"
          ).value
        ) || 0,

      tt:
        Number(
          row.querySelector(
            ".segment-tt"
          ).value
        ) || 0,

      color:
        row.querySelector(
          ".segment-color"
        ).value || "#7289da"
    }));

    const rafit =
      document.getElementById(
        "conn-rafit"
      ).checked;

    const professional =
      document.getElementById(
        "conn-professional"
      ).checked;

    Network.createRoom({
      name,
      segments,
      rafit,
      professional,
      rtp: State.rtp
    });
  }

  function renderRooms() {
    const container = State.UI.rooms;

    if (!container) return;

    if (!State.rooms.length) {
      container.innerHTML = `
        <div class="conn-status-text">
          No rooms available.
        </div>
      `;

      return;
    }

    container.innerHTML = "";

    for (const room of State.rooms) {
      const card =
        document.createElement("div");

      card.className =
        "conn-room-card";

      const players =
        Array.isArray(room.players)
          ? room.players
          : [];

      const playerText =
        players.length
          ? players.map(p => {
              const color =
                p.color ||
                p.nameColor ||
                "#7289da";

              return `
                <div>
                  <span
                    style="
                      color:${escapeHtml(color)};
                      font-weight:700;
                    "
                  >
                    ${escapeHtml(
                      p.name || "Player"
                    )}
                  </span>
                </div>
              `;
            }).join("")
          : "No players";

      card.innerHTML = `
        <div class="conn-room-head">
          <div class="conn-room-name">
            ${escapeHtml(
              room.name || "Room"
            )}
          </div>

          ${
            room.rafit
              ? `<span class="conn-tag rafit">RAFIT</span>`
              : ""
          }

          ${
            room.professional
              ? `<span class="conn-tag">Professional</span>`
              : ""
          }

          <span class="conn-tag rtp">
            RTP ${Number(room.rtp || 0)}
          </span>
        </div>

        <div class="conn-room-meta">
          ${players.length} player(s)
        </div>

        <div class="conn-room-players">
          ${playerText}
        </div>

        <div class="conn-room-actions">
          <button class="conn-btn join-room">
            Join
          </button>
        </div>
      `;

      card.querySelector(
        ".join-room"
      ).onclick = () => {
        Network.joinRoom(
          room.id ||
          room.roomId
        );
      };

      container.appendChild(card);
    }
  }

  function updateCurrentRoom() {
    if (!State.UI.currentRoom) return;

    if (!State.joinedRoom) {
      State.UI.currentRoom.innerHTML =
        "Not in a room.";

      State.UI.currentPlayers.innerHTML =
        "";

      return;
    }

    const room =
      State.roomData || {};

    State.UI.currentRoom.innerHTML = `
      <strong>
        ${escapeHtml(
          room.name ||
          State.room ||
          "Current Room"
        )}
      </strong>
    `;

    const players =
      Array.isArray(room.players)
        ? room.players
        : [];

    State.UI.currentPlayers.innerHTML =
      players.map(p => {
        const id =
          String(p.id || "");

        const color =
          p.color ||
          p.nameColor ||
          "#7289da";

        const isMe =
          State.id &&
          id === String(State.id);

        return `
          <div class="conn-current-player">
            <span
              class="conn-player-name"
              style="color:${escapeHtml(color)}"
            >
              ${escapeHtml(
                p.name || "Player"
              )}
            </span>

            ${
              isMe
                ? `<span class="conn-tag">YOU</span>`
                : ""
            }

            ${
              !isMe &&
              room.host === State.id
                ? `
                  <button
                    class="conn-kick"
                    data-kick="${escapeHtml(id)}"
                  >
                    Kick
                  </button>
                `
                : ""
            }
          </div>
        `;
      }).join("");

    State.UI.currentPlayers
      .querySelectorAll(
        "[data-kick]"
      )
      .forEach(btn => {
        btn.onclick = () => {
          Network.kick(
            btn.dataset.kick
          );
        };
      });
  }

  function updateScanUI() {
    if (!State.UI.matchBtn) return;

    if (State.confirmedMatch) {
      State.UI.matchBtn.textContent =
        "MATCH CONFIRMED";

      State.UI.matchBtn.disabled = true;

      State.UI.matchStatus.textContent =
        `Ready • ${State.originalBots.length} original bots captured`;
    } else {
      State.UI.matchBtn.textContent =
        "I AM INSIDE A MATCH";

      State.UI.matchBtn.disabled = false;

      State.UI.matchStatus.textContent =
        State.joinedRoom
          ? "Not confirmed."
          : "Join a room first.";
    }
  }

  function updateUI() {
    if (!State.UI.panel) return;

    const dot =
      State.UI.panel.querySelector(
        "#conn-dot"
      );

    const connectionText =
      State.UI.panel.querySelector(
        "#conn-connection-text"
      );

    if (State.connected) {
      dot.className =
        "conn-dot online";

      connectionText.textContent =
        "ONLINE";
    } else {
      dot.className =
        "conn-dot offline";

      connectionText.textContent =
        "OFFLINE";
    }

    updateScanUI();
    updateCurrentRoom();
    renderRooms();

    const rtp =
      State.UI.panel.querySelector(
        ".conn-tag.rtp"
      );

    if (rtp) {
      rtp.textContent =
        `RTP ${State.rtp}`;
    }
  }

  function setStatus(text) {
    if (State.UI.status) {
      State.UI.status.textContent =
        text;
    }

    log(text);
  }

  function toggleUI(force) {
    const panel = State.UI.panel;

    if (!panel) return;

    const visible =
      force !== undefined
        ? force
        : panel.style.display !== "block";

    panel.style.display =
      visible
        ? "block"
        : "none";

    if (visible) {
      updateUI();
    }
  }

  /* =========================================================
     DRAG
  ========================================================= */

  function makeDraggable(panel) {
    const header =
      panel.querySelector(
        ".conn-header"
      );

    if (!header) return;

    let dragging = false;
    let ox = 0;
    let oy = 0;

    header.addEventListener(
      "mousedown",
      e => {
        if (
          e.target.closest(
            ".conn-close"
          )
        ) {
          return;
        }

        dragging = true;

        const rect =
          panel.getBoundingClientRect();

        ox =
          e.clientX -
          rect.left;

        oy =
          e.clientY -
          rect.top;

        panel.style.transform =
          "none";

        panel.style.left =
          rect.left + "px";

        panel.style.top =
          rect.top + "px";

        e.preventDefault();
      }
    );

    document.addEventListener(
      "mousemove",
      e => {
        if (!dragging) return;

        panel.style.left =
          Math.max(
            5,
            Math.min(
              window.innerWidth -
                panel.offsetWidth -
                5,
              e.clientX - ox
            )
          ) + "px";

        panel.style.top =
          Math.max(
            5,
            Math.min(
              window.innerHeight -
                panel.offsetHeight -
                5,
              e.clientY - oy
            )
          ) + "px";
      }
    );

    document.addEventListener(
      "mouseup",
      () => {
        dragging = false;
      }
    );
  }

  /* =========================================================
     INPUT / HOTKEYS
  ========================================================= */

  document.addEventListener(
    "keydown",
    e => {
      if (
        e.key === "Backspace" &&
        !e.target.matches(
          "input,textarea,select"
        )
      ) {
        e.preventDefault();
        toggleUI();
        return;
      }

      if (
        e.key.toLowerCase() === "y" &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        !e.target.matches(
          "input,textarea,select"
        )
      ) {
        if (isInsideMatch()) {
          e.preventDefault();
          openChat();
        }
      }
    },
    true
  );

  /* =========================================================
     UTIL
  ========================================================= */

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /* =========================================================
     INIT
  ========================================================= */

  function init() {
    buildUI();

    Network.connect();

    if (State.monitorTimer) {
      clearInterval(
        State.monitorTimer
      );
    }

    State.monitorTimer =
      setInterval(
        monitorMatch,
        250
      );

    log(
      `Connections ${VERSION} loaded.`
    );

    log(
      "Backspace = open/close"
    );
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );
  } else {
    init();
  }
})();
