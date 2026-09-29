```javascript
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
      localStorage.getItem(
        "connections_name"
      ) || "Player",

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

    dead: false,

    localAvatar:
      localStorage.getItem(
        "pp-avatar"
      ) || null,

    UI: {},

    stateTimer: null,
    monitorTimer: null,
    botTimer: null,

    lastPosition: null
  };

  const log = (...a) =>
    console.log(
      "[Connections]",
      ...a
    );

  const warn = (...a) =>
    console.warn(
      "[Connections]",
      ...a
    );

  const error = (...a) =>
    console.error(
      "[Connections]",
      ...a
    );

  function getGame() {
    if (State.game) {
      return State.game;
    }

    const w = unsafeWindow;

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
        game.match.isStarted ===
          true ||
        game.match.started ===
          true
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
      obj.transform?.rotation;

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
        updateStatus(
          "Connection error"
        );
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
            this.createRoom(
              data
            );
          },
          500
        );

        return;
      }

      NetworkSend(
        "create_room",
        {
          ...data,
          name: State.name
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
            this.joinRoom(
              roomId
            );
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
          break;

        case "hello":
          if (msg.id) {
            State.id =
              String(msg.id);
          }
          break;

        case "rooms":
          State.rooms =
            Array.isArray(
              msg.rooms
            )
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

          stopStateLoop();
          clearRemoteBots();

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

          stopStateLoop();
          clearRemoteBots();

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
          break;

        case "error":
          handleServerError(
            msg
          );
          break;

        case "pong":
          break;
      }
    },

    handleRoomJoined(msg) {
      State.room =
        msg.room?.id ||
        msg.roomId ||
        null;

      State.roomData =
        msg.room || null;

      if (msg.id) {
        State.id =
          String(msg.id);
      }

      State.joinedRoom = true;
      State.leavingRoom = false;

      log(
        "Joined:",
        State.room
      );

      updateStatus(
        "Room joined"
      );

      updateRoomList();
      updateUI();
    }
  };

  function handleServerError(
    msg
  ) {
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
      names[code] || code
    );

    warn(
      "Server error:",
      msg
    );
  }

  function handleStateMessage(
    msg
  ) {
    const list =
      Array.isArray(
        msg.players
      )
        ? msg.players
        : [];

    for (
      const data of list
    ) {
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
            null,

          x: Number(data.x) || 0,
          y: Number(data.y) || 0,
          z: Number(data.z) || 0,

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

          bot: null
        };

        State.remotes.set(
          id,
          remote
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
        null;

      if (
        remote.dead
      ) {
        killRemote(
          remote
        );
      } else {
        if (
          !remote.bot
        ) {
          createRemoteBot(
            remote
          );
        }
      }
    }

    updateBots();
  }

  function getBotManager() {
    if (
      State.botManager
    ) {
      return State.botManager;
    }

    const game =
      getGame();

    if (!game) {
      return null;
    }

    const candidates = [
      game.botManager,
      game.bots,
      game.ai,
      game.botSystem,
      game.enemyManager,
      game.agents
    ];

    for (
      const manager of
      candidates
    ) {
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

  function findBotConstructor() {
    const manager =
      getBotManager();

    if (!manager) {
      return null;
    }

    const candidates = [
      manager.Bot,
      manager.botConstructor,
      manager.BotClass,
      manager.constructor
    ];

    for (
      const c of
      candidates
    ) {
      if (
        typeof c ===
        "function"
      ) {
        return c;
      }
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
      bot.gameObject.active =
        false;
    } catch {}

    try {
      bot.root.visible =
        false;
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
      bot.gameObject.active =
        true;
    } catch {}

    try {
      bot.root.visible =
        true;
    } catch {}
  }

  function prepareBots() {
    const manager =
      getBotManager();

    if (!manager) {
      return;
    }

    if (
      State.originalBots.length
    ) {
      return;
    }

    const arrays = [
      manager.bots,
      manager.agents,
      manager.entities,
      manager.players
    ];

    for (
      const arr of arrays
    ) {
      if (
        Array.isArray(arr)
      ) {
        for (
          const bot of arr
        ) {
          if (
            bot &&
            !bot.__connectionsRemote
          ) {
            State.originalBots.push(
              bot
            );

            hideBot(bot);
          }
        }

        try {
          arr.length = 0;
        } catch {}

        break;
      }
    }

    State.botConstructor =
      findBotConstructor();
  }

  function createRemoteBot(
    remote
  ) {
    if (
      remote.bot ||
      remote.dead
    ) {
      return;
    }

    prepareBots();

    const manager =
      getBotManager();

    const Constructor =
      State.botConstructor;

    if (
      !manager ||
      typeof Constructor !==
        "function"
    ) {
      return;
    }

    try {
      let bot;

      try {
        bot = new Constructor(
          State.game,
          remote.team,
          remote.name,
          3
        );
      } catch {
        try {
          bot = new Constructor(
            State.game
          );
        } catch {
          bot = null;
        }
      }

      if (!bot) {
        return;
      }

      bot.__connectionsRemote =
        true;

      bot.__connectionsId =
        remote.id;

      remote.bot =
        bot;

      try {
        if (
          Array.isArray(
            manager.bots
          )
        ) {
          manager.bots.push(
            bot
          );
        } else if (
          Array.isArray(
            manager.agents
          )
        ) {
          manager.agents.push(
            bot
          );
        }
      } catch {}

      showBot(bot);

      setBotPosition(
        bot,
        remote.x,
        remote.y,
        remote.z
      );
    } catch (e) {
      warn(
        "Remote bot creation failed:",
        e
      );
    }
  }

  function setBotPosition(
    bot,
    x,
    y,
    z
  ) {
    if (!bot) {
      return;
    }

    try {
      if (
        bot.position
      ) {
        bot.position.x = x;
        bot.position.y = y;
        bot.position.z = z;
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
      bot.x = x;
      bot.y = y;
      bot.z = z;
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
      bot.yaw = yaw;
      bot.pitch = pitch;
    } catch {}
  }

  function updateBots() {
    for (
      const remote of
      State.remotes.values()
    ) {
      if (
        !remote.bot ||
        remote.dead
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
    }
  }

  function killRemote(
    remote
  ) {
    if (!remote.bot) {
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
      State.remotes.get(id);

    if (!remote) {
      return;
    }

    if (remote.bot) {
      hideBot(
        remote.bot
      );

      try {
        const manager =
          getBotManager();

        for (
          const key of [
            "bots",
            "agents",
            "entities",
            "players"
          ]
        ) {
          const arr =
            manager?.[key];

          if (
            Array.isArray(arr)
          ) {
            const index =
              arr.indexOf(
                remote.bot
              );

            if (
              index >= 0
            ) {
              arr.splice(
                index,
                1
              );
            }
          }
        }
      } catch {}
    }

    State.remotes.delete(
      id
    );
  }

  function clearRemoteBots() {
    for (
      const remote of
      State.remotes.values()
    ) {
      if (remote.bot) {
        hideBot(
          remote.bot
        );
      }
    }

    State.remotes.clear();

    if (
      State.originalBots.length
    ) {
      for (
        const bot of
        State.originalBots
      ) {
        showBot(bot);
      }
    }

    State.originalBots = [];
  }

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
      positionOf(player);

    const rot =
      rotationOf(player);

    const alive =
      !State.dead &&
      getAlive(player);

    const health =
      State.dead
        ? 0
        : (
          typeof player?.health ===
          "number"
            ? player.health
            : 100
        );

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
          dead: !alive,

          health,

          name: State.name,

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

      for (
        const segment of
        room.segments || []
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

        title.appendChild(
          span
        );
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
        const rafit =
          document.createElement(
            "span"
          );

        rafit.className =
          "conn-room-rafit";

        rafit.textContent =
          "RAFIT";

        meta.appendChild(
          rafit
        );
      }

      if (
        room.professional
      ) {
        const pro =
          document.createElement(
            "span"
          );

        pro.className =
          "conn-room-pro";

        pro.textContent =
          "PRO 2000+";

        meta.appendChild(
          pro
        );
      }

      const players =
        document.createElement(
          "div"
        );

      players.className =
        "conn-players";

      for (
        const p of
        room.players || []
      ) {
        const row =
          document.createElement(
            "div"
          );

        row.className =
          "conn-player";

        const left =
          document.createElement(
            "span"
          );

        left.textContent =
          (
            p.host
              ? "👑 "
              : ""
          ) +
          p.name;

        const rtp =
          document.createElement(
            "span"
          );

        rtp.className =
          "conn-rtp";

        rtp.textContent =
          room.rafit
            ? `${p.rtp} RTP`
            : "";

        row.appendChild(
          left
        );

        row.appendChild(
          rtp
        );

        players.appendChild(
          row
        );
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
        "conn-btn conn-join";

      join.textContent =
        State.room === room.id
          ? "JOINED"
          : "JOIN";

      join.disabled =
        State.room === room.id;

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

      card.appendChild(
        players
      );

      card.appendChild(
        buttons
      );

      box.appendChild(
        card
      );
    }
  }

  function renderSegmentsPreview() {
    const preview =
      State.UI.preview;

    if (!preview) {
      return;
    }

    preview.innerHTML = "";

    const rows =
      State.UI.segmentRows
        || [];

    for (
      const row of rows
    ) {
      const text =
        row.querySelector(
          ".conn-segment-text"
        )?.value || "";

      const color =
        row.querySelector(
          ".conn-segment-color"
        )?.value || "#ffffff";

      if (!text.trim()) {
        continue;
      }

      const span =
        document.createElement(
          "span"
        );

      span.textContent =
        text.trim();

      span.style.color =
        color;

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

    input.className =
      "conn-segment-text";

    input.placeholder =
      "Text";

    input.value =
      text;

    const picker =
      document.createElement(
        "input"
      );

    picker.className =
      "conn-segment-color";

    picker.type =
      "color";

    picker.value =
      /^#[0-9a-fA-F]{6}$/.test(
        color
      )
        ? color
        : "#ffffff";

    const remove =
      document.createElement(
        "button"
      );

    remove.textContent =
      "×";

    remove.className =
      "conn-small";

    remove.onclick = () => {
      row.remove();

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

    State.UI.segmentBox.appendChild(
      row
    );

    State.UI.segmentRows.push(
      row
    );

    renderSegmentsPreview();
  }

  function collectSegments() {
    return (
      State.UI.segmentRows
        || []
    )
      .map(row => ({
        text:
          row.querySelector(
            ".conn-segment-text"
          )?.value
            ?.trim() || "",

        color:
          row.querySelector(
            ".conn-segment-color"
          )?.value ||
          "#ffffff"
      }))
      .filter(
        x =>
          x.text.length > 0
      );
  }

  function createRoomFromUI() {
    const segments =
      collectSegments();

    if (
      !segments.length
    ) {
      updateStatus(
        "Give the room a name."
      );

      return;
    }

    const ctSlots =
      Number(
        State.UI.ctSlots.value
      ) || 5;

    const tSlots =
      Number(
        State.UI.tSlots.value
      ) || 5;

    Network.createRoom({
      segments,

      ctSlots,

      tSlots,

      rafit:
        State.UI.rafit.checked,

      professional:
        State.UI.professional.checked,

      team: "ct"
    });
  }

  function updateStatus(text) {
    if (
      State.UI.status
    ) {
      State.UI.status.textContent =
        text;
    }
  }

  function updateUI() {
    updateRoomList();

    const connected =
      State.connected;

    if (
      State.UI.connection
    ) {
      State.UI.connection.textContent =
        connected
          ? "ONLINE"
          : "OFFLINE";

      State.UI.connection.className =
        connected
          ? "conn-online"
          : "conn-offline";
    }

    if (
      State.UI.current
    ) {
      if (
        State.roomData
      ) {
        State.UI.current.textContent =
          State.roomData.title ||
          "Room";
      } else {
        State.UI.current.textContent =
          "No room";
      }
    }

    if (
      State.UI.kickList
    ) {
      renderKickList();
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

    if (
      !me?.host
    ) {
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
        `${player.name} ${State.roomData.rafit ? "(" + player.rtp + " RTP)" : ""}`;

      const button =
        document.createElement(
          "button"
        );

      button.className =
        "conn-small conn-danger";

      button.textContent =
        "KICK";

      button.onclick = () => {
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

  function openUI() {
    State.UI.panel.style.display =
      "block";

    updateUI();
  }

  function closeUI() {
    State.UI.panel.style.display =
      "none";
  }

  function toggleUI() {
    if (
      State.UI.panel.style.display ===
      "none"
    ) {
      openUI();
    } else {
      closeUI();
    }
  }

  function makePanelDraggable(
    panel,
    handle
  ) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const stopDrag = () => {
      if (!dragging) {
        return;
      }

      dragging = false;

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

    const onMouseMove = event => {
      if (!dragging) {
        return;
      }

      const dx =
        event.clientX - startX;

      const dy =
        event.clientY - startY;

      let left =
        startLeft + dx;

      let top =
        startTop + dy;

      const rect =
        panel.getBoundingClientRect();

      const margin = 8;

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
            "button, input, textarea, select, a"
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

        dragging = true;

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
        font-weight: 800;
      }

      .conn-subtitle {
        color: #858b9a;
        font-size: 12px;
      }

      .conn-close {
        margin-left: auto;
        background: #252833;
        color: #fff;
        border: 0;
        border-radius: 8px;
        padding: 8px 12px;
        cursor: pointer;
      }

      .conn-section {
        background: #17191f;
        border: 1px solid #252833;
        border-radius: 12px;
        padding: 13px;
        margin-top: 12px;
      }

      .conn-section-title {
        font-size: 13px;
        font-weight: 800;
        margin-bottom: 10px;
        color: #b9becb;
      }

      .conn-input {
        width: 100%;
        background: #0d0f13;
        color: #fff;
        border: 1px solid #303440;
        border-radius: 8px;
        padding: 9px;
        outline: none;
      }

      .conn-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .conn-check {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 9px;
        color: #c9cdd7;
        font-size: 13px;
      }

      .conn-segment {
        display: flex;
        gap: 6px;
        margin-bottom: 6px;
      }

      .conn-segment input[type=text] {
        flex: 1;
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

      .conn-btn {
        background: #5865f2;
        color: white;
        border: 0;
        border-radius: 8px;
        padding: 9px 13px;
        cursor: pointer;
        font-weight: 700;
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

      .conn-rtp {
        color: #ff4fd8;
        font-weight: 800;
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

    logo.onerror = () => {
      logo.style.display =
        "none";
    };

    const title =
      document.createElement(
        "div"
      );

    title.innerHTML =
      `
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

    const profile =
      document.createElement(
        "div"
      );

    profile.className =
      "conn-section";

    profile.innerHTML =
      `
        <div class="conn-section-title">
          PLAYER
        </div>
      `;

    const name =
      document.createElement(
        "input"
      );

    name.className =
      "conn-input";

    name.placeholder =
      "Player name";

    name.value =
      State.name;

    name.onchange = () => {
      State.name =
        name.value.trim()
          .slice(0, 24)
        || "Player";

      localStorage.setItem(
        "connections_name",
        State.name
      );
    };

    profile.appendChild(
      name
    );

    panel.appendChild(
      profile
    );

    const create =
      document.createElement(
        "div"
      );

    create.className =
      "conn-section";

    create.innerHTML =
      `
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
      "+ Add color segment";

    add.onclick = () =>
      addSegment();

    const slots =
      document.createElement(
        "div"
      );

    slots.className =
      "conn-grid";

    const ct =
      document.createElement(
        "input"
      );

    ct.className =
      "conn-input";

    ct.type =
      "number";

    ct.min = "1";
    ct.max = "32";
    ct.value = "5";

    const tt =
      document.createElement(
        "input"
      );

    tt.className =
      "conn-input";

    tt.type =
      "number";

    tt.min = "1";
    tt.max = "32";
    tt.value = "5";

    slots.appendChild(
      ct
    );

    slots.appendChild(
      tt
    );

    const rafitLabel =
      document.createElement(
        "label"
      );

    rafitLabel.className =
      "conn-check";

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
      " Enable RAFIT"
    );

    const proLabel =
      document.createElement(
        "label"
      );

    proLabel.className =
      "conn-check";

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
      " Professional Server (2000+ RTP)"
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
      rafitLabel
    );

    create.appendChild(
      proLabel
    );

    create.appendChild(
      createButton
    );

    panel.appendChild(
      create
    );

    const rooms =
      document.createElement(
        "div"
      );

    rooms.className =
      "conn-section";

    rooms.innerHTML =
      `
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

    const current =
      document.createElement(
        "div"
      );

    current.className =
      "conn-section";

    current.innerHTML =
      `
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

    current.appendChild(
      currentName
    );

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
      () => Network.leaveRoom();

    current.appendChild(
      leave
    );

    const kickList =
      document.createElement(
        "div"
      );

    kickList.style.marginTop =
      "10px";

    current.appendChild(
      kickList
    );

    panel.appendChild(
      current
    );

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
      status;

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
  }

  function confirmMatch() {
    if (
      !isInsideMatch()
    ) {
      updateStatus(
        "Enter a match first."
      );

      return;
    }

    State.confirmedMatch =
      true;

    prepareBots();

    startStateLoop();

    updateStatus(
      "Match confirmed."
    );

    log(
      "Match confirmed."
    );
  }

  function installHotkeys() {
    document.addEventListener(
      "keydown",
      event => {
        if (
          event.code ===
          "Backspace"
        ) {
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
        }

        if (
          event.code ===
          "KeyC" &&
          event.ctrlKey &&
          event.shiftKey
        ) {
          confirmMatch();
        }
      },
      true
    );
  }

  function installMonitor() {
    State.monitorTimer =
      setInterval(() => {
        if (
          State.confirmedMatch
        ) {
          if (
            !isInsideMatch()
          ) {
            State.confirmedMatch =
              false;

            stopStateLoop();
          }
        }

        updateBots();
      }, 100);
  }

  function installDebug() {
    unsafeWindow.__connections_multiplayer =
      {
        version: VERSION,

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
            Network.kick(id),

        state:
          () => ({
            id: State.id,

            name: State.name,

            room: State.room,

            connected:
              State.connected,

            joined:
              State.joinedRoom,

            confirmedMatch:
              State.confirmedMatch,

            remotes:
              State.remotes.size,

            roomData:
              State.roomData
          })
      };
  }

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
```
