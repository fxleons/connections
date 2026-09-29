// ==UserScript==
// @name         Connections
// @namespace    conn
// @version      2.0.0
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

  const VERSION = "2.0.0";
  const WS_URL =
    "wss://able-vpn-star-constitutional.trycloudflare.com";

  const RAFIT_LOGO =
    "https://raw.githubusercontent.com/fxleons/connections/main/rafit_logo.png";

  const W = unsafeWindow || window;

  const State = {
    ws: null,
    connected: false,
    connecting: false,

    id: null,

    name:
      localStorage.getItem("connections_name") ||
      "Player",

    nameColor:
      localStorage.getItem(
        "connections_name_color"
      ) || "#7289da",

    room: null,
    roomData: null,
    rooms: [],

    joinedRoom: false,
    confirmedMatch: false,

    game: null,
    botManager: null,

    /*
     * IMPORTANT:
     *
     * We DO NOT reuse the original bots anymore.
     *
     * The constructor is captured from one of the
     * original bots BEFORE they are destroyed.
     */
    botCtor: null,

    originalBots: [],

    /*
     * Kept only so old UI/code references don't
     * explode if something still expects it.
     *
     * It is NEVER used as a bot pool anymore.
     */
    botPool: [],

    /*
     * Actual bots currently controlled by
     * Connections remote players.
     */
    remoteBots: new Set(),

    remotes: new Map(),

    localAvatar:
      localStorage.getItem("pp-avatar") ||
      null,

    UI: {},

    stateTimer: null,
    monitorTimer: null,

    chat: {
      open: false,
      input: null,
      messages: []
    },

    chatSound: {
      context: null,
      enabled:
        localStorage.getItem(
          "connections_chat_sound"
        ) !== "off",

      type:
        localStorage.getItem(
          "connections_chat_sound_type"
        ) || "pop",

      volume:
        Math.max(
          0,
          Math.min(
            1,
            Number(
              localStorage.getItem(
                "connections_chat_volume"
              ) || 0.35
            )
          )
        )
    },

    rtp:
      Number(
        localStorage.getItem(
          "connections_rtp"
        ) || 0
      ),

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
      localStorage.setItem(
        "connections_name",
        State.name
      );

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
    if (
      State.game &&
      typeof State.game === "object"
    ) {
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
      if (
        g &&
        typeof g === "object"
      ) {
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
    const g = getGame();

    if (!g) return false;

    try {
      if (
        typeof g.isInMatch ===
        "function" &&
        g.isInMatch()
      ) {
        return true;
      }
    } catch {}

    if (
      g.gameState ===
      "playing"
    ) {
      return true;
    }

    if (
      g.state ===
      "playing"
    ) {
      return true;
    }

    if (
      g.inMatch === true
    ) {
      return true;
    }

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
      typeof State.botManager ===
      "object"
    ) {
      return State.botManager;
    }

    const g = getGame();

    if (!g) return null;

    /*
     * The real game uses:
     *
     * window.game.botMgr.bots
     */
    const manager =
      g.botMgr ||
      g.botManager ||
      g.bots ||
      g.ai ||
      g.botSystem ||
      g.enemyManager;

    if (
      manager &&
      typeof manager ===
      "object"
    ) {
      State.botManager =
        manager;

      return manager;
    }

    return null;
  }

  function getBotArray() {
    const mgr =
      getBotManager();

    if (!mgr) return null;

    if (
      Array.isArray(
        mgr.bots
      )
    ) {
      return mgr.bots;
    }

    if (
      Array.isArray(
        mgr.agents
      )
    ) {
      return mgr.agents;
    }

    if (
      Array.isArray(
        mgr.entities
      )
    ) {
      return mgr.entities;
    }

    if (
      Array.isArray(
        mgr.players
      )
    ) {
      return mgr.players;
    }

    return null;
  }

  /* =========================================================
     POSITION / ROTATION
  ========================================================= */

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

  function setPosition(
    bot,
    x,
    y,
    z
  ) {
    if (!bot) return;

    const p = {
      x,
      y,
      z
    };

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
      if (
        bot.transform?.position
      ) {
        bot.transform.position.x = x;
        bot.transform.position.y = y;
        bot.transform.position.z = z;
      }
    } catch {}

    try {
      if (
        bot.root?.position
      ) {
        bot.root.position.x = x;
        bot.root.position.y = y;
        bot.root.position.z = z;
      }
    } catch {}

    try {
      if (
        bot.cs2Agent?.root?.position
      ) {
        bot.cs2Agent.root.position.x = x;
        bot.cs2Agent.root.position.y = y;
        bot.cs2Agent.root.position.z = z;
      }
    } catch {}

    try {
      if (
        typeof bot.setPosition ===
        "function"
      ) {
        bot.setPosition(p);
      }
    } catch {}
  }

  function setRotation(
    bot,
    yaw,
    pitch
  ) {
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
      if (
        bot.transform?.rotation
      ) {
        bot.transform.rotation.y =
          yaw;

        bot.transform.rotation.x =
          pitch;
      }
    } catch {}

    try {
      if (
        bot.root?.rotation
      ) {
        bot.root.rotation.y =
          yaw;

        bot.root.rotation.x =
          pitch;
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
      }
    } catch {}

    try {
      if (
        typeof bot.setRotation ===
        "function"
      ) {
        bot.setRotation(
          yaw,
          pitch
        );
      }
    } catch {}
  }

  /* =========================================================
     REAL BOT SYSTEM
  ========================================================= */

  function findBotConstructor() {
    try {
      /*
       * Once captured, NEVER search again.
       */
      if (State.botCtor) {
        return State.botCtor;
      }

      const g =
        getGame();

      const mgr =
        g?.botMgr;

      const bots =
        mgr?.bots;

      if (
        !Array.isArray(bots)
      ) {
        warn(
          "game.botMgr.bots not found."
        );

        return null;
      }

      /*
       * EXACTLY the same strategy as the
       * Force Bot Count script.
       */
      const found =
        bots.find(
          b =>
            b &&
            b.team !== undefined &&
            b.constructor
        );

      if (!found) {
        warn(
          "No bot with a valid constructor found."
        );

        return null;
      }

      State.botCtor =
        found.constructor;

      log(
        "REAL BOT CONSTRUCTOR CAPTURED:",
        State.botCtor
      );

      return State.botCtor;

    } catch (e) {
      err(
        "findBotConstructor:",
        e
      );

      return null;
    }
  }

  function destroyBot(bot) {
    if (!bot) return;

    const arr =
      getBotArray();

    /*
     * Remove it from botMgr.bots.
     */
    try {
      if (arr) {
        const index =
          arr.indexOf(bot);

        if (index !== -1) {
          arr.splice(
            index,
            1
          );
        }
      }
    } catch {}

    /*
     * Destroy its actual Unity root.
     */
    try {
      const root =
        bot.cs2Agent &&
        bot.cs2Agent.root;

      if (
        root &&
        root.parent
      ) {
        root.parent.remove(
          root
        );
      }
    } catch {}

    /*
     * Make absolutely sure the
     * game considers the bot dead.
     */
    try {
      bot.alive = false;
    } catch {}

    try {
      bot.dead = true;
    } catch {}

    try {
      bot.enabled = false;
    } catch {}

    try {
      bot.visible = false;
    } catch {}

    try {
      bot.__connectionsRemote =
        false;
    } catch {}
  }

  function removeAllBots() {
    const arr =
      getBotArray();

    if (!arr) {
      warn(
        "Cannot remove bots: bot array missing."
      );

      return 0;
    }

    const bots =
      arr.slice();

    log(
      "Removing ALL original bots:",
      bots.length
    );

    for (
      const bot
      of bots
    ) {
      destroyBot(
        bot
      );
    }

    /*
     * Force empty array.
     */
    try {
      arr.length = 0;
    } catch {}

    State.originalBots =
      bots;

    /*
     * This is intentionally NOT a pool.
     */
    State.botPool = [];

    log(
      "botMgr.bots after cleanup:",
      arr.length
    );

    return bots.length;
  }

  /* =========================================================
     REMOTE BOT AI CONTROL
  ========================================================= */

  function disableRemoteAI(
    bot
  ) {
    if (!bot) return;

    /*
     * Tell the game this isn't a normal
     * autonomous bot.
     */
    try {
      bot.isPlayer = true;
    } catch {}

    try {
      bot.remoteControlled =
        true;
    } catch {}

    try {
      bot.__connectionsRemote =
        true;
    } catch {}

    /*
     * Remove common AI targets.
     */
    try {
      if (
        "target" in bot
      ) {
        bot.target = null;
      }
    } catch {}

    try {
      if (
        "enemy" in bot
      ) {
        bot.enemy = null;
      }
    } catch {}

    try {
      if (
        "destination" in bot
      ) {
        bot.destination = null;
      }
    } catch {}

    /*
     * Only call methods if they actually exist.
     */
    try {
      if (
        typeof bot.disableAI ===
        "function"
      ) {
        bot.disableAI();
      }
    } catch {}

    try {
      if (
        typeof bot.stopAI ===
        "function"
      ) {
        bot.stopAI();
      }
    } catch {}

    try {
      if (
        typeof bot.setAIEnabled ===
        "function"
      ) {
        bot.setAIEnabled(
          false
        );
      }
    } catch {}
  }

  /* =========================================================
     AVATAR SUPPORT
  ========================================================= */

  function rebuildAvatars() {
    try {
      const g =
        getGame();

      const hud =
        g?.hud;

      if (
        hud &&
        typeof hud.buildAvatars ===
        "function"
      ) {
        hud.buildAvatars();
      }
    } catch {}
  }

  /* =========================================================
     BOT DATA
  ========================================================= */

  function applyBotData(
    bot,
    remote
  ) {
    if (
      !bot ||
      !remote
    ) {
      return;
    }

    disableRemoteAI(
      bot
    );

    try {
      bot.name =
        remote.name;
    } catch {}

    try {
      bot.playerName =
        remote.name;
    } catch {}

    try {
      bot.team =
        remote.team;
    } catch {}

    try {
      bot.health =
        remote.health;
    } catch {}

    try {
      bot.alive =
        remote.alive;
    } catch {}

    try {
      bot.dead =
        !remote.alive;
    } catch {}

    try {
      bot.isPlayer =
        true;
    } catch {}

    /*
     * Avatar URL.
     */
    try {
      bot.avatar =
        remote.avatar ||
        null;
    } catch {}

    try {
      bot.avatarUrl =
        remote.avatar ||
        null;
    } catch {}

    /*
     * Position.
     */
    setPosition(
      bot,
      remote.x,
      remote.y,
      remote.z
    );

    /*
     * Rotation.
     */
    setRotation(
      bot,
      remote.yaw,
      remote.pitch
    );
  }

  /* =========================================================
     CREATE REAL REMOTE BOT
  ========================================================= */

  function createRemoteBot(
    remote
  ) {
    if (!remote) {
      return null;
    }

    if (remote.bot) {
      return remote.bot;
    }

    const g =
      getGame();

    const arr =
      getBotArray();

    const ctor =
      findBotConstructor();

    if (
      !g ||
      !arr ||
      !ctor
    ) {
      warn(
        "Unable to create remote bot:",
        {
          game: !!g,
          bots: !!arr,
          constructor: !!ctor
        }
      );

      return null;
    }

    let bot = null;

    /*
     * THIS is the important difference
     * from the old Connections version.
     *
     * We create a BRAND NEW bot.
     */
    try {
      bot =
        new ctor(
          g,
          remote.team ||
            "CT",
          remote.name ||
            "Player",
          "normal"
        );
    } catch (e) {
      err(
        "REAL BOT CONSTRUCTOR FAILED:",
        e
      );

      return null;
    }

    if (!bot) {
      return null;
    }

    /*
     * Same spawn path used by
     * Force Bot Count.
     */
    try {
      if (
        typeof bot.spawn ===
        "function"
      ) {
        bot.spawn();
      }
    } catch (e) {
      warn(
        "bot.spawn() failed:",
        e
      );
    }

    /*
     * Manager registration.
     */
    try {
      if (
        !arr.includes(bot)
      ) {
        arr.push(bot);
      }
    } catch {}

    /*
     * Register ownership.
     */
    remote.bot =
      bot;

    State.remoteBots.add(
      bot
    );

    /*
     * Stop AI from taking control.
     */
    disableRemoteAI(
      bot
    );

    /*
     * Immediately apply the
     * remote player's state.
     */
    applyBotData(
      bot,
      remote
    );

    /*
     * Ask HUD to rebuild player
     * avatars.
     */
    rebuildAvatars();

    log(
      "REAL REMOTE BOT CREATED:",
      remote.name,
      "| team:",
      remote.team,
      "| id:",
      remote.id
    );

    return bot;
  }

  /* =========================================================
     REMOTE BOT UPDATE
  ========================================================= */

  function updateBots() {
    for (
      const remote
      of State.remotes.values()
    ) {
      /*
       * Dead remote:
       * destroy its actual bot.
       */
      if (
        remote.dead
      ) {
        if (
          remote.bot
        ) {
          const bot =
            remote.bot;

          State.remoteBots.delete(
            bot
          );

          destroyBot(
            bot
          );

          remote.bot =
            null;
        }

        continue;
      }

      /*
       * Player joined but doesn't
       * have a bot yet.
       */
      if (
        !remote.bot
      ) {
        createRemoteBot(
          remote
        );

        continue;
      }

      /*
       * Smooth network interpolation.
       */
      remote.x +=
        (
          remote.targetX -
          remote.x
        ) * 0.65;

      remote.y +=
        (
          remote.targetY -
          remote.y
        ) * 0.65;

      remote.z +=
        (
          remote.targetZ -
          remote.z
        ) * 0.65;

      remote.yaw +=
        (
          remote.targetYaw -
          remote.yaw
        ) * 0.65;

      remote.pitch +=
        (
          remote.targetPitch -
          remote.pitch
        ) * 0.65;

      /*
       * Re-assert remote control every tick.
       */
      applyBotData(
        remote.bot,
        remote
      );
    }

    /*
     * The actual game may attempt to
     * recreate its own bots.
     *
     * Remove anything that isn't
     * owned by a remote player.
     */
    purgeNonRemoteBots();
  }

  /* =========================================================
     BOT PURGE
  ========================================================= */

  function purgeNonRemoteBots() {
    if (
      !State.confirmedMatch
    ) {
      return;
    }

    const arr =
      getBotArray();

    if (!arr) {
      return;
    }

    const allowed =
      State.remoteBots;

    for (
      const bot
      of arr.slice()
    ) {
      if (
        !allowed.has(
          bot
        )
      ) {
        destroyBot(
          bot
        );
      }
    }
  }

  /* =========================================================
     REMOVE REMOTE
  ========================================================= */

  function removeRemote(
    id
  ) {
    const key =
      String(id);

    const remote =
      State.remotes.get(
        key
      );

    if (!remote) {
      return;
    }

    if (
      remote.bot
    ) {
      State.remoteBots.delete(
        remote.bot
      );

      destroyBot(
        remote.bot
      );

      remote.bot =
        null;
    }

    State.remotes.delete(
      key
    );

    rebuildAvatars();
  }

  /* =========================================================
     CLEAR ALL REMOTES
  ========================================================= */

  function clearRemoteBots() {
    for (
      const remote
      of State.remotes.values()
    ) {
      if (
        remote.bot
      ) {
        State.remoteBots.delete(
          remote.bot
        );

        destroyBot(
          remote.bot
        );

        remote.bot =
          null;
      }
    }

    State.remotes.clear();
    State.remoteBots.clear();

    /*
     * When multiplayer is completely
     * leaving the match, don't leave
     * any original bots behind.
     */
    if (
      State.confirmedMatch
    ) {
      removeAllBots();
    }

    rebuildAvatars();
  }

  /* =========================================================
     MATCH SCANNER
  ========================================================= */

  function confirmMatch() {
    if (
      !State.joinedRoom
    ) {
      setStatus(
        "Join a room first."
      );

      return;
    }

    if (
      !isInsideMatch()
    ) {
      setStatus(
        "You must be inside a real match first."
      );

      return;
    }

    const mgr =
      getBotManager();

    const arr =
      getBotArray();

    if (
      !mgr ||
      !arr
    ) {
      setStatus(
        "Bot manager not found."
      );

      warn(
        "Game:",
        getGame()
      );

      warn(
        "Bot manager:",
        mgr
      );

      warn(
        "Bot array:",
        arr
      );

      return;
    }

    /*
     * CRITICAL:
     *
     * Capture the constructor BEFORE
     * deleting the original bots.
     */
    const ctor =
      findBotConstructor();

    if (!ctor) {
      setStatus(
        "Could not find bot constructor."
      );

      return;
    }

    log(
      "Real constructor captured."
    );

    /*
     * NOW delete every original bot.
     */
    const removed =
      removeAllBots();

    State.confirmedMatch =
      true;

    setStatus(
      "Match confirmed. Multiplayer ready."
    );

    updateScanUI();

    startStateLoop();

    log(
      "Original bots removed:",
      removed
    );

    log(
      "botMgr.bots:",
      getBotArray()
    );

    log(
      "Connections multiplayer ready."
    );
  }

  /* =========================================================
     MATCH MONITOR
  ========================================================= */

  function monitorMatch() {
    if (
      State.confirmedMatch &&
      !isInsideMatch()
    ) {
      log(
        "Left match."
      );

      State.confirmedMatch =
        false;

      stopStateLoop();

      clearRemoteBots();

      State.botCtor =
        null;

      State.botManager =
        null;

      updateScanUI();

      return;
    }

    if (
      State.confirmedMatch
    ) {
      /*
       * Prevent original bots from
       * returning.
       */
      purgeNonRemoteBots();

      /*
       * Update remote players.
       */
      updateBots();
    }
  }

  /* =========================================================
     CHAT SOUND
  ========================================================= */

  function saveChatSoundSettings() {
    try {
      localStorage.setItem(
        "connections_chat_sound",
        State.chatSound.enabled
          ? "on"
          : "off"
      );

      localStorage.setItem(
        "connections_chat_sound_type",
        State.chatSound.type
      );

      localStorage.setItem(
        "connections_chat_volume",
        String(
          State.chatSound.volume
        )
      );
    } catch {}
  }

  function playChatNotification() {
    try {
      if (
        !State.chatSound.enabled
      ) {
        return;
      }

      const AC =
        W.AudioContext ||
        W.webkitAudioContext;

      if (!AC) {
        return;
      }

      if (
        !State.chatSound.context
      ) {
        State.chatSound.context =
          new AC();
      }

      const ctx =
        State.chatSound.context;

      if (
        ctx.state ===
        "suspended"
      ) {
        ctx.resume().catch(
          () => {}
        );
      }

      const now =
        ctx.currentTime;

      const osc =
        ctx.createOscillator();

      const gain =
        ctx.createGain();

      const type =
        State.chatSound.type;

      if (
        type === "soft"
      ) {
        osc.type =
          "sine";

        osc.frequency.setValueAtTime(
          520,
          now
        );

        osc.frequency.exponentialRampToValueAtTime(
          720,
          now + 0.08
        );

      } else if (
        type === "blip"
      ) {
        osc.type =
          "square";

        osc.frequency.setValueAtTime(
          720,
          now
        );

        osc.frequency.exponentialRampToValueAtTime(
          980,
          now + 0.06
        );

      } else if (
        type === "click"
      ) {
        osc.type =
          "triangle";

        osc.frequency.setValueAtTime(
          900,
          now
        );

      } else {
        osc.type =
          "sine";

        osc.frequency.setValueAtTime(
          420,
          now
        );

        osc.frequency.exponentialRampToValueAtTime(
          680,
          now + 0.07
        );
      }

      gain.gain.setValueAtTime(
        0.0001,
        now
      );

      gain.gain.exponentialRampToValueAtTime(
        Math.max(
          0.0001,
          State.chatSound.volume
        ),
        now + 0.008
      );

      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + 0.14
      );

      osc.connect(
        gain
      );

      gain.connect(
        ctx.destination
      );

      osc.start(
        now
      );

      osc.stop(
        now + 0.15
      );

    } catch (e) {
      warn(
        "Chat sound failed:",
        e
      );
    }
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

      setStatus(
        "Connecting..."
      );

      let ws;

      try {
        ws =
          new WebSocket(
            WS_URL
          );
      } catch (e) {
        State.connecting =
          false;

        setStatus(
          "WebSocket error"
        );

        return;
      }

      State.ws = ws;

      ws.onopen = () => {
        State.connected =
          true;

        State.connecting =
          false;

        setStatus(
          "Connected"
        );

        send(
          "list_rooms"
        );

        updateUI();
      };

      ws.onmessage = e => {
        let msg;

        try {
          msg =
            JSON.parse(
              e.data
            );
        } catch {
          return;
        }

        Network.handle(
          msg
        );
      };

      ws.onerror = () => {
        State.connected =
          false;

        setStatus(
          "Connection error"
        );

        updateUI();
      };

      ws.onclose = () => {
        State.connected =
          false;

        State.connecting =
          false;

        State.joinedRoom =
          false;

        State.ws =
          null;

        stopStateLoop();

        clearRemoteBots();

        State.confirmedMatch =
          false;

        State.botCtor =
          null;

        State.botManager =
          null;

        setStatus(
          "Disconnected"
        );

        updateUI();
      };
    },

    createRoom(data) {
      if (!State.connected) {
        this.connect();

        setTimeout(
          () =>
            this.createRoom(
              data
            ),
          500
        );

        return;
      }

      send(
        "create_room",
        {
          ...data,

          name:
            State.name,

          avatar:
            State.localAvatar
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
          () =>
            this.joinRoom(
              roomId
            ),
          500
        );

        return;
      }

      send(
        "join_room",
        {
          roomId,

          name:
            State.name,

          avatar:
            State.localAvatar
        }
      );

      setStatus(
        "Joining room..."
      );
    },

    leaveRoom() {
      if (
        !State.joinedRoom
      ) {
        return;
      }

      State.confirmedMatch =
        false;

      stopStateLoop();

      clearRemoteBots();

      send(
        "leave_room"
      );
    },

    kick(id) {
      send(
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

      switch (
        msg.type
      ) {
        case "connected":
        case "hello":

          if (msg.id) {
            State.id =
              String(
                msg.id
              );
          }

          break;

        case "rooms":

          State.rooms =
            Array.isArray(
              msg.rooms
            )
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
            msg.room ||
            null;

          if (msg.id) {
            State.id =
              String(
                msg.id
              );
          }

          State.joinedRoom =
            true;

          setStatus(
            "Room joined. Enter your match and scan."
          );

          updateScanUI();

          updateUI();

          break;

        case "roster":

          if (msg.room) {
            State.roomData =
              msg.room;
          }

          renderRooms();

          updateUI();

          break;

        case "join":

          renderRooms();

          break;

        case "leave":

          if (msg.id) {
            removeRemote(
              msg.id
            );
          }

          renderRooms();

          break;

        case "host_changed":

          renderRooms();

          break;

        case "left_room":
        case "kicked":

          State.joinedRoom =
            false;

          State.room =
            null;

          State.roomData =
            null;

          State.confirmedMatch =
            false;

          stopStateLoop();

          clearRemoteBots();

          State.botCtor =
            null;

          State.botManager =
            null;

          updateScanUI();

          updateUI();

          setStatus(
            msg.type ===
              "kicked"
              ? "You were kicked."
              : "Left room."
          );

          break;

        case "state":

          handleState(
            msg
          );

          break;

        case "chat":

          receiveChat(
            msg
          );

          break;

        case "rafit_warning":

          setStatus(
            "RAFIT warning: " +
            (msg.type || "") +
            " | RTP " +
            (
              msg.rtp ??
              State.rtp
            )
          );

          break;

        case "rafit_banned":

          State.confirmedMatch =
            false;

          stopStateLoop();

          setStatus(
            "RAFIT: banned."
          );

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
      Array.isArray(
        msg.players
      )
        ? msg.players
        : [];

    /*
     * Track IDs received from this packet.
     * If the server sends a roster without somebody
     * anymore, that remote player is removed.
     */
    const received =
      new Set();

    for (
      const data
      of players
    ) {
      if (
        !data?.id
      ) {
        continue;
      }

      const id =
        String(
          data.id
        );

      /*
       * Never create a bot for ourselves.
       */
      if (
        State.id &&
        id ===
          String(
            State.id
          )
      ) {
        continue;
      }

      received.add(
        id
      );

      let remote =
        State.remotes.get(
          id
        );

      /*
       * NEW REMOTE PLAYER
       */
      if (!remote) {
        remote = {
          id,

          name:
            data.name ||
            "Player",

          team:
            data.team ||
            "CT",

          x:
            Number(
              data.x
            ) || 0,

          y:
            Number(
              data.y
            ) || 0,

          z:
            Number(
              data.z
            ) || 0,

          targetX:
            Number(
              data.x
            ) || 0,

          targetY:
            Number(
              data.y
            ) || 0,

          targetZ:
            Number(
              data.z
            ) || 0,

          yaw:
            Number(
              data.yaw
            ) || 0,

          pitch:
            Number(
              data.pitch
            ) || 0,

          targetYaw:
            Number(
              data.yaw
            ) || 0,

          targetPitch:
            Number(
              data.pitch
            ) || 0,

          health:
            typeof data.health ===
            "number"
              ? data.health
              : 100,

          alive:
            data.alive !==
            false,

          dead:
            data.dead ===
            true,

          avatar:
            data.avatar ||
            null,

          bot:
            null
        };

        State.remotes.set(
          id,
          remote
        );

        log(
          "Remote player joined:",
          remote.name,
          id
        );
      }

      /*
       * Update identity.
       */
      remote.name =
        data.name ||
        remote.name;

      remote.team =
        data.team ||
        remote.team;

      /*
       * Network target.
       *
       * We don't immediately overwrite x/y/z.
       * updateBots() interpolates toward these values.
       */
      remote.targetX =
        Number(
          data.x
        ) || 0;

      remote.targetY =
        Number(
          data.y
        ) || 0;

      remote.targetZ =
        Number(
          data.z
        ) || 0;

      remote.targetYaw =
        Number(
          data.yaw
        ) || 0;

      remote.targetPitch =
        Number(
          data.pitch
        ) || 0;

      /*
       * Health.
       */
      if (
        typeof data.health ===
        "number"
      ) {
        remote.health =
          data.health;
      }

      /*
       * Alive state.
       */
      remote.alive =
        data.alive !== false &&
        data.dead !== true &&
        remote.health > 0;

      remote.dead =
        !remote.alive;

      /*
       * Avatar.
       */
      if (
        data.avatar
      ) {
        remote.avatar =
          data.avatar;
      }

      /*
       * Create a REAL bot immediately when
       * a remote player appears.
       */
      if (
        remote.dead
      ) {
        if (
          remote.bot
        ) {
          State.remoteBots.delete(
            remote.bot
          );

          destroyBot(
            remote.bot
          );

          remote.bot =
            null;
        }
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

    /*
     * Remove remote players that disappeared
     * from the server state.
     *
     * Don't do this if the packet is empty,
     * because an empty state packet can happen
     * during room transitions.
     */
    if (
      players.length > 0
    ) {
      for (
        const id
        of Array.from(
          State.remotes.keys()
        )
      ) {
        if (
          !received.has(
            id
          )
        ) {
          removeRemote(
            id
          );
        }
      }
    }

    updateBots();
  }

  /* =========================================================
     LOCAL PLAYER STATE
  ========================================================= */

  function getLocalState() {
    const player =
      getLocalPlayer();

    if (!player) {
      return null;
    }

    const p =
      positionOf(
        player
      );

    const r =
      rotationOf(
        player
      );

    let health =
      100;

    if (
      typeof player.health ===
      "number"
    ) {
      health =
        player.health;
    }

    let alive =
      true;

    if (
      typeof player.alive ===
      "boolean"
    ) {
      alive =
        player.alive;
    }

    if (
      typeof player.dead ===
      "boolean"
    ) {
      alive =
        !player.dead;
    }

    if (
      health <= 0
    ) {
      alive =
        false;
    }

    const team =
      player.team ||
      player.side ||
      player.faction ||
      "CT";

    return {
      x:
        p.x,

      y:
        p.y,

      z:
        p.z,

      yaw:
        r.yaw,

      pitch:
        r.pitch,

      alive,

      dead:
        !alive,

      health,

      name:
        State.name,

      team,

      avatar:
        State.localAvatar
    };
  }

  /* =========================================================
     STATE SEND LOOP
  ========================================================= */

  function startStateLoop() {
    stopStateLoop();

    State.stateTimer =
      setInterval(
        () => {
          if (
            !State.joinedRoom
          ) {
            return;
          }

          if (
            !State.confirmedMatch
          ) {
            return;
          }

          if (
            !isInsideMatch()
          ) {
            return;
          }

          const state =
            getLocalState();

          if (!state) {
            return;
          }

          send(
            "state",
            {
              state
            }
          );
        },
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

  /* =========================================================
     MATCH MONITOR LOOP
  ========================================================= */

  function startMatchMonitor() {
    if (
      State.monitorTimer
    ) {
      clearInterval(
        State.monitorTimer
      );
    }

    State.monitorTimer =
      setInterval(
        () => {
          try {
            monitorMatch();
          } catch (e) {
            warn(
              "Match monitor:",
              e
            );
          }
        },
        250
      );
  }

  /* =========================================================
     CHAT
  ========================================================= */

  function receiveChat(msg) {
    if (!msg) {
      return;
    }

    const name =
      msg.name ||
      msg.player ||
      "Player";

    const text =
      String(
        msg.text ||
        ""
      ).slice(
        0,
        300
      );

    if (!text) {
      return;
    }

    /*
     * Notification sound only for other players.
     */
    const senderId =
      msg.id ||
      msg.playerId ||
      msg.senderId ||
      null;

    if (
      !senderId ||
      String(
        senderId
      ) !==
      String(
        State.id
      )
    ) {
      if (State.chatSoundEnabled !== false) {   playChatNotification(); }
    }

    /*
     * Chat remains completely separate from
     * the Connections menu.
     */
    createChat();

    const container =
      document.querySelector(
        "#connections-game-chat .conn-chat-messages"
      );

    if (!container) {
      return;
    }

    const row =
      document.createElement(
        "div"
      );

    row.style.cssText =
      `
        color:#fff;
        font-size:14px;
        line-height:19px;
        opacity:1;
        margin-top:2px;
        text-shadow:
          0 1px 2px #000;
      `;

    const sender =
      document.createElement(
        "span"
      );

    sender.textContent =
      name +
      ": ";

    sender.style.cssText =
      `
        color:#7289da;
        font-weight:700;
      `;

    const message =
      document.createElement(
        "span"
      );

    message.textContent =
      text;

    row.appendChild(
      sender
    );

    row.appendChild(
      message
    );

    container.appendChild(
      row
    );

    while (
      container.children.length >
      8
    ) {
      container.removeChild(
        container.firstChild
      );
    }

    setTimeout(
      () => {
        row.style.transition =
          "opacity .4s";

        row.style.opacity =
          "0";

        setTimeout(
          () => {
            try {
              row.remove();
            } catch {}
          },
          450
        );
      },
      7000
    );
  }

  function sendChat(text) {
    const value =
      String(
        text ||
        ""
      )
      .trim()
      .slice(
        0,
        300
      );

    if (!value) {
      return;
    }

    send(
      "chat",
      {
        text:
          value
      }
    );
  }

  /* =========================================================
     CHAT NOTIFICATION SOUND
  ========================================================= */

  function playChatNotification() {
    try {
      if (
        !State.chatSound.enabled
      ) {
        return;
      }

      const AC =
        W.AudioContext ||
        W.webkitAudioContext;

      if (!AC) {
        return;
      }

      if (
        !State.chatSound.context
      ) {
        State.chatSound.context =
          new AC();
      }

      const ctx =
        State.chatSound.context;

      if (
        ctx.state ===
        "suspended"
      ) {
        ctx.resume().catch(
          () => {}
        );
      }

      const now =
        ctx.currentTime;

      const osc =
        ctx.createOscillator();

      const gain =
        ctx.createGain();

      switch (
        State.chatSound.type
      ) {
        case "soft":

          osc.type =
            "sine";

          osc.frequency.setValueAtTime(
            520,
            now
          );

          osc.frequency.exponentialRampToValueAtTime(
            720,
            now + 0.08
          );

          break;

        case "blip":

          osc.type =
            "square";

          osc.frequency.setValueAtTime(
            720,
            now
          );

          osc.frequency.exponentialRampToValueAtTime(
            980,
            now + 0.06
          );

          break;

        case "click":

          osc.type =
            "triangle";

          osc.frequency.setValueAtTime(
            900,
            now
          );

          break;

        default:

          osc.type =
            "sine";

          osc.frequency.setValueAtTime(
            420,
            now
          );

          osc.frequency.exponentialRampToValueAtTime(
            680,
            now + 0.07
          );

          break;
      }

      gain.gain.setValueAtTime(
        0.0001,
        now
      );

      gain.gain.exponentialRampToValueAtTime(
        Math.max(
          0.0001,
          State.chatSound.volume
        ),
        now + 0.008
      );

      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + 0.14
      );

      osc.connect(
        gain
      );

      gain.connect(
        ctx.destination
      );

      osc.start(
        now
      );

      osc.stop(
        now + 0.15
      );

    } catch (e) {
      warn(
        "Chat notification:",
        e
      );
    }
  }
  /* =========================================================
   MATCH SCANNER
========================================================= */

function findBotConstructor() {
  try {
    if (State.botCtor) return State.botCtor;

    const g = getGame();
    const mgr = getBotManager();
    const bots = getBotArray();

    if (!g || !mgr || !Array.isArray(bots)) {
      return null;
    }

    const found = bots.find(
      b =>
        b &&
        b.team !== undefined &&
        typeof b.constructor === "function"
    );

    if (found) {
      State.botCtor = found.constructor;

      log(
        "Bot constructor found:",
        State.botCtor.name || "(anonymous)"
      );

      return State.botCtor;
    }
  } catch (e) {
    warn("findBotConstructor failed:", e);
  }

  return null;
}

function destroyGameBot(bot) {
  if (!bot) return;

  try {
    bot.alive = false;
  } catch (e) {}

  try {
    bot.dead = true;
  } catch (e) {}

  try {
    if (bot.cs2Agent && bot.cs2Agent.root) {
      const root = bot.cs2Agent.root;

      if (root.parent) {
        root.parent.remove(root);
      }
    }
  } catch (e) {}

  try {
    if (typeof bot.destroy === "function") {
      bot.destroy();
    }
  } catch (e) {}
}

function removeAllOriginalBots() {
  try {
    const arr = getBotArray();

    if (!arr) {
      warn("Could not get bot array.");
      return 0;
    }

    const originals = arr.slice();

    State.originalBots = originals;

    for (const bot of originals) {
      destroyGameBot(bot);

      const index = arr.indexOf(bot);

      if (index >= 0) {
        arr.splice(index, 1);
      }
    }

    State.botPool = [];

    log(
      "Removed original bots:",
      originals.length
    );

    return originals.length;
  } catch (e) {
    warn(
      "removeAllOriginalBots failed:",
      e
    );

    return 0;
  }
}

function disableRemoteAI(bot) {
  if (!bot) return;

  const possibleObjects = [
    bot,
    bot.ai,
    bot.agent,
    bot.cs2Agent,
    bot.controller
  ];

  for (const obj of possibleObjects) {
    if (!obj) continue;

    try {
      if ("enabled" in obj) {
        obj.enabled = false;
      }
    } catch (e) {}

    try {
      if ("active" in obj) {
        obj.active = false;
      }
    } catch (e) {}

    try {
      if ("isAI" in obj) {
        obj.isAI = false;
      }
    } catch (e) {}

    try {
      if ("canThink" in obj) {
        obj.canThink = false;
      }
    } catch (e) {}

    try {
      if ("thinking" in obj) {
        obj.thinking = false;
      }
    } catch (e) {}
  }
}

function spawnRemoteBot(remote) {
  try {
    if (!remote) return null;

    const g = getGame();

    if (!g) {
      warn("Cannot spawn remote bot: game missing.");
      return null;
    }

    const mgr = getBotManager();
    const arr = getBotArray();
    const ctor = findBotConstructor();

    if (!mgr || !arr || !ctor) {
      warn(
        "Cannot spawn remote bot:",
        {
          manager: !!mgr,
          array: !!arr,
          ctor: !!ctor
        }
      );

      return null;
    }

    const team =
      remote.team ||
      "CT";

    const name =
      remote.name ||
      "Player";

    let bot = null;

    try {
      bot = new ctor(
        g,
        team,
        name,
        "normal"
      );
    } catch (e) {
      warn(
        "Remote bot constructor failed:",
        e
      );
      return null;
    }

    if (!bot) return null;

    try {
      arr.push(bot);
    } catch (e) {
      warn(
        "Could not add remote bot to manager:",
        e
      );
    }

    try {
      if (typeof bot.spawn === "function") {
        bot.spawn();
      }
    } catch (e) {
      warn(
        "Remote bot spawn failed:",
        e
      );
    }

    disableRemoteAI(bot);

    remote.bot = bot;

    applyBotData(
      bot,
      remote
    );

    try {
      rebuildAvatars();
    } catch (e) {}

    log(
      "Created remote bot:",
      remote.id,
      remote.name
    );

    return bot;
  } catch (e) {
    warn(
      "spawnRemoteBot failed:",
      e
    );

    return null;
  }
}

function applyBotData(bot, remote) {
  if (!bot || !remote) return;

  try {
    bot.name =
      remote.name ||
      bot.name ||
      "Player";
  } catch (e) {}

  try {
    bot.playerName =
      remote.name ||
      bot.playerName ||
      "Player";
  } catch (e) {}

  try {
    bot.team =
      remote.team ||
      bot.team ||
      "CT";
  } catch (e) {}

  try {
    bot.health =
      typeof remote.health === "number"
        ? remote.health
        : 100;
  } catch (e) {}

  try {
    bot.alive =
      remote.alive !== false;
  } catch (e) {}

  try {
    bot.dead =
      remote.dead === true;
  } catch (e) {}

  try {
    bot.isPlayer = true;
  } catch (e) {}

  try {
    bot.avatar =
      remote.avatar || null;
  } catch (e) {}

  try {
    bot.avatarUrl =
      remote.avatar || null;
  } catch (e) {}

  try {
    setPosition(
      bot,
      remote.x,
      remote.y,
      remote.z
    );
  } catch (e) {}

  try {
    setRotation(
      bot,
      remote.yaw,
      remote.pitch
    );
  } catch (e) {}

  disableRemoteAI(bot);
}

function updateRemoteBots() {
  try {
    for (const id in State.remoteBots) {
      const remote =
        State.remoteBots[id];

      if (!remote) continue;

      if (
        remote.dead ||
        remote.alive === false
      ) {
        if (remote.bot) {
          destroyGameBot(
            remote.bot
          );

          const arr =
            getBotArray();

          if (arr) {
            const index =
              arr.indexOf(
                remote.bot
              );

            if (index >= 0) {
              arr.splice(
                index,
                1
              );
            }
          }

          remote.bot = null;
        }

        continue;
      }

      if (!remote.bot) {
        spawnRemoteBot(remote);
        continue;
      }

      applyBotData(
        remote.bot,
        remote
      );
    }

    rebuildAvatars();
  } catch (e) {
    warn(
      "updateRemoteBots failed:",
      e
    );
  }
}

function purgeNonRemoteBots() {
  try {
    if (!State.confirmedMatch) return;

    const arr =
      getBotArray();

    if (!arr) return;

    const allowed =
      new Set();

    for (const id in State.remoteBots) {
      const remote =
        State.remoteBots[id];

      if (
        remote &&
        remote.bot
      ) {
        allowed.add(
          remote.bot
        );
      }
    }

    for (
      let i = arr.length - 1;
      i >= 0;
      i--
    ) {
      const bot = arr[i];

      if (!bot) {
        arr.splice(i, 1);
        continue;
      }

      if (!allowed.has(bot)) {
        destroyGameBot(bot);
        arr.splice(i, 1);
      }
    }
  } catch (e) {
    warn(
      "purgeNonRemoteBots failed:",
      e
    );
  }
}

function removeRemote(id) {
  try {
    const remote =
      State.remoteBots[id];

    if (!remote) return;

    if (remote.bot) {
      const bot =
        remote.bot;

      destroyGameBot(bot);

      const arr =
        getBotArray();

      if (arr) {
        const index =
          arr.indexOf(bot);

        if (index >= 0) {
          arr.splice(
            index,
            1
          );
        }
      }

      remote.bot = null;
    }

    delete State.remoteBots[id];

    try {
      rebuildAvatars();
    } catch (e) {}
  } catch (e) {
    warn(
      "removeRemote failed:",
      e
    );
  }
}

function clearRemoteBots() {
  try {
    for (const id in State.remoteBots) {
      const remote =
        State.remoteBots[id];

      if (
        remote &&
        remote.bot
      ) {
        destroyGameBot(
          remote.bot
        );

        const arr =
          getBotArray();

        if (arr) {
          const index =
            arr.indexOf(
              remote.bot
            );

          if (index >= 0) {
            arr.splice(
              index,
              1
            );
          }
        }
      }
    }
  } catch (e) {
    warn(
      "clearRemoteBots failed:",
      e
    );
  }

  State.remoteBots = {};
}

function rebuildAvatars() {
  try {
    const g = getGame();

    if (!g) return;

    const hud = g.hud;

    if (
      hud &&
      typeof hud.buildAvatars === "function"
    ) {
      hud.buildAvatars();
    }
  } catch (e) {}
}

function confirmMatch() {
  if (!State.joinedRoom) {
    setStatus(
      "Join a room first."
    );
    return;
  }

  if (!isInsideMatch()) {
    setStatus(
      "You must be inside a real match first."
    );
    return;
  }

  const mgr =
    getBotManager();

  const arr =
    getBotArray();

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
   * VERY IMPORTANT:
   *
   * Find the real constructor BEFORE
   * deleting the original bots.
   */
  const ctor =
    findBotConstructor();

  if (!ctor) {
    setStatus(
      "Could not find bot constructor."
    );

    return;
  }

  State.botManager =
    mgr;

  /*
   * Remove the original game bots.
   */
  const removed =
    removeAllOriginalBots();

  State.confirmedMatch = true;

  setStatus(
    "Match confirmed. Multiplayer ready."
  );

  updateScanUI();

  startStateLoop();

  log(
    "Bot constructor:",
    ctor.name || "(anonymous)"
  );

  log(
    "Original bots removed:",
    removed
  );

  log(
    "Connections multiplayer ready."
  );

  rebuildAvatars();
}

function monitorMatch() {
  if (
    State.confirmedMatch &&
    !isInsideMatch()
  ) {
    State.confirmedMatch =
      false;

    stopStateLoop();

    clearRemoteBots();

    State.originalBots = [];
    State.botPool = [];
    State.botManager = null;
    State.botCtor = null;

    updateScanUI();

    return;
  }

  if (
    State.confirmedMatch
  ) {
    updateRemoteBots();
    purgeNonRemoteBots();
  }
}


/* =========================================================
   CHAT - IN GAME ONLY
========================================================= */

function createChat() {
  if (
    document.getElementById(
      "connections-game-chat"
    )
  ) {
    return;
  }

  const box =
    document.createElement("div");

  box.id =
    "connections-game-chat";

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
    left:20px;
    bottom:20px;
    width:360px;
    max-width:calc(100vw - 40px);
    z-index:999998;
    pointer-events:none;
    font-family:Arial,sans-serif;
  `;

  const messages =
    box.querySelector(
      ".conn-chat-messages"
    );

  messages.style.cssText = `
    max-height:180px;
    overflow:hidden;
    margin-bottom:8px;
    text-shadow:
      0 1px 3px #000,
      0 0 4px #000;
  `;

  const input =
    box.querySelector(
      ".conn-chat-input"
    );

  input.style.cssText = `
    display:none;
    pointer-events:auto;
    width:100%;
    height:34px;
    border:1px solid #343744;
    border-radius:8px;
    background:rgba(12,13,17,.94);
    color:#fff;
    padding:0 10px;
    outline:none;
  `;

  document.body.appendChild(box);

  input.addEventListener(
    "keydown",
    e => {
      if (e.key !== "Enter") {
        if (e.key === "Escape") {
          closeChat();
        }

        return;
      }

      e.preventDefault();

      const text =
        input.value.trim();

      if (text) {
        send(
          "chat",
          {
            text
          }
        );
      }

      input.value = "";

      closeChat();
    }
  );
}

function openChat() {
  if (!isInsideMatch()) {
    return;
  }

  createChat();

  const input =
    document.querySelector(
      "#connections-game-chat .conn-chat-input"
    );

  if (!input) return;

  input.style.display =
    "block";

  input.focus();
}

function closeChat() {
  const input =
    document.querySelector(
      "#connections-game-chat .conn-chat-input"
    );

  if (!input) return;

  input.style.display =
    "none";

  input.blur();
}

function playChatNotification() {
  try {
    const AudioContext =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContext) return;

    if (!State.chatAudioContext) {
      State.chatAudioContext =
        new AudioContext();
    }

    const ctx =
      State.chatAudioContext;

    if (
      ctx.state === "suspended"
    ) {
      ctx.resume().catch(
        () => {}
      );
    }

    const osc =
      ctx.createOscillator();

    const gain =
      ctx.createGain();

    osc.type =
      State.chatSound ||
      "pop";

    const now =
      ctx.currentTime;

    osc.frequency.setValueAtTime(
      620,
      now
    );

    osc.frequency.exponentialRampToValueAtTime(
      880,
      now + 0.07
    );

    gain.gain.setValueAtTime(
      0.0001,
      now
    );

    gain.gain.exponentialRampToValueAtTime(
      Number(
        State.chatVolume ?? 0.08
      ),
      now + 0.01
    );

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + 0.11
    );

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.12);
  } catch (e) {}
}

function receiveChat(msg) {
  const name =
    msg.name ||
    msg.player ||
    "Player";

  const text =
    String(
      msg.text || ""
    ).slice(0, 300);

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

  message.textContent =
    text;

  row.appendChild(sender);
  row.appendChild(message);

  container.appendChild(row);

  while (
    container.children.length > 8
  ) {
    container.removeChild(
      container.firstChild
    );
  }

  if (State.chatSoundEnabled !== false) {   playChatNotification(); }

  setTimeout(
    () => {
      row.style.transition =
        "opacity .4s";

      row.style.opacity =
        "0";

      setTimeout(
        () => {
          row.remove();
        },
        450
      );
    },
    7000
  );
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
    background:#181a21;
    color:#eee;
    padding:9px 12px;
    cursor:pointer;
  }

  .conn-btn:hover {
    background:#22252e;
  }

  .conn-btn.primary {
    background:#7289da;
    border-color:#7289da;
    color:#fff;
  }

  .conn-btn.primary:hover {
    background:#687bc5;
  }

  .conn-btn:disabled {
    opacity:.5;
    cursor:not-allowed;
  }

  .conn-status {
    display:flex;
    align-items:center;
    gap:8px;
    font-size:13px;
    font-weight:700;
  }

  .conn-dot {
    width:8px;
    height:8px;
    border-radius:50%;
    display:inline-block;
  }

  .conn-dot.online {
    background:#55d187;
    box-shadow:0 0 10px rgba(85,209,135,.55);
  }

  .conn-dot.offline {
    background:#777;
  }

  .conn-status-text {
    margin-top:8px;
    color:#8e93a1;
    font-size:12px;
  }

  .conn-input {
    width:100%;
    height:36px;
    border:1px solid #30333f;
    border-radius:8px;
    background:#0f1015;
    color:#fff;
    outline:none;
    padding:0 10px;
  }

  .conn-input:focus {
    border-color:#7289da;
  }

  .conn-color {
    width:46px;
    height:36px;
    border:1px solid #30333f;
    border-radius:8px;
    background:#0f1015;
  }

  .conn-profile {
    display:flex;
    gap:8px;
    margin-bottom:8px;
  }

  .conn-profile .conn-input {
    flex:1;
  }

  .conn-create-row {
    display:flex;
    gap:8px;
  }

  .conn-segments {
    display:flex;
    flex-direction:column;
    gap:7px;
    margin-top:8px;
  }

  .conn-segment {
    display:grid;
    grid-template-columns:
      minmax(120px,1fr)
      70px
      70px
      46px
      auto
      40px;
    gap:6px;
    align-items:center;
  }

  .segment-ct,
  .segment-tt {
    height:36px;
    border:1px solid #30333f;
    border-radius:8px;
    background:#0f1015;
    color:#fff;
    padding:0 8px;
  }

  .segment-color {
    width:46px;
    height:36px;
    border:1px solid #30333f;
    border-radius:8px;
    background:#0f1015;
  }

  .conn-check {
    display:flex;
    align-items:center;
    gap:7px;
    margin-top:9px;
    color:#ccc;
    font-size:13px;
  }

  .conn-tag {
    display:inline-flex;
    align-items:center;
    justify-content:center;
    padding:3px 7px;
    border-radius:6px;
    border:1px solid #353947;
    background:#1b1e27;
    color:#bfc3d0;
    font-size:10px;
    font-weight:800;
    white-space:nowrap;
  }

  .conn-tag.rafit {
    color:#fff;
    border-color:#7289da;
    background:#7289da22;
  }

  .conn-tag.rtp {
    color:#aab0c0;
  }

  .conn-brand {
    margin-left:auto;
    display:flex;
    align-items:center;
    gap:5px;
  }

  .conn-room-card {
    border:1px solid #292c36;
    border-radius:10px;
    background:#101219;
    padding:11px;
    margin-bottom:8px;
  }

  .conn-room-head {
    display:flex;
    align-items:center;
    gap:6px;
  }

  .conn-room-name {
    font-weight:800;
    flex:1;
  }

  .conn-room-meta {
    color:#858a99;
    font-size:11px;
    margin-top:5px;
  }

  .conn-room-players {
    margin-top:7px;
    color:#cdd0d8;
    font-size:12px;
    line-height:18px;
  }

  .conn-room-actions {
    margin-top:9px;
  }

  .conn-current-player {
    display:flex;
    align-items:center;
    gap:7px;
    margin-top:6px;
    font-size:12px;
  }

  .conn-player-name {
    font-weight:700;
    flex:1;
  }

  .conn-kick {
    border:1px solid #55363b;
    border-radius:6px;
    background:#24161a;
    color:#e58b95;
    padding:4px 7px;
    cursor:pointer;
  }

  .conn-footer {
    margin-top:14px;
    color:#777c8c;
    font-size:11px;
    line-height:17px;
  }
`);


function buildUI() {
  if (
    document.getElementById(
      "connections-panel"
    )
  ) {
    return;
  }

  const panel =
    document.createElement("div");

  panel.id =
    "connections-panel";

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
        CHAT NOTIFICATIONS
      </div>

      <label class="conn-check">
        <input
          id="conn-chat-sound-enabled"
          type="checkbox"
        >
        Sound
      </label>

      <select
        id="conn-chat-sound"
        class="conn-input"
        style="margin-top:7px"
      >
        <option value="sine">Sine</option>
        <option value="square">Square</option>
        <option value="sawtooth">Saw</option>
        <option value="triangle">Soft</option>
      </select>

      <input
        id="conn-chat-volume"
        type="range"
        min="0"
        max="0.2"
        step="0.01"
        style="width:100%;margin-top:8px"
      >
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

  State.UI.panel =
    panel;

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
  const panel =
    State.UI.panel;

  panel.querySelector(
    ".conn-close"
  ).onclick = () => {
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
      State.name =
        name;
    }

    if (color) {
      State.nameColor =
        color;
    }

    saveProfile();

    setStatus(
      "Profile saved."
    );
  };

  panel.querySelector(
    "#conn-add-segment"
  ).onclick =
    addSegment;

  panel.querySelector(
    "#conn-create-room"
  ).onclick =
    createRoomFromUI;

  panel.querySelector(
    "#conn-leave-room"
  ).onclick = () => {
    Network.leaveRoom();
  };

  panel.querySelector(
    "#conn-name"
  ).value =
    State.name;

  panel.querySelector(
    "#conn-name-color"
  ).value =
    State.nameColor;

  const soundEnabled =
    panel.querySelector(
      "#conn-chat-sound-enabled"
    );

  const soundSelect =
    panel.querySelector(
      "#conn-chat-sound"
    );

  const volume =
    panel.querySelector(
      "#conn-chat-volume"
    );

  soundEnabled.checked =
    State.chatSoundEnabled !== false;

  soundSelect.value =
    State.chatSound ||
    "sine";

  volume.value =
    String(
      State.chatVolume ?? 0.08
    );

  soundEnabled.onchange =
    () => {
      State.chatSoundEnabled =
        soundEnabled.checked;

      try {
        localStorage.setItem(
          "connections-chat-sound-enabled",
          String(
            State.chatSoundEnabled
          )
        );
      } catch (e) {}
    };

  soundSelect.onchange =
    () => {
      State.chatSound =
        soundSelect.value;

      try {
        localStorage.setItem(
          "connections-chat-sound",
          State.chatSound
        );
      } catch (e) {}
    };

  volume.oninput =
    () => {
      State.chatVolume =
        Number(
          volume.value
        );

      try {
        localStorage.setItem(
          "connections-chat-volume",
          String(
            State.chatVolume
          )
        );
      } catch (e) {}
    };

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

  container.appendChild(
    row
  );
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
  ].map(
    row => ({
      name:
        row.querySelector(
          ".segment-name"
        ).value ||
        "Segment",

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
        ).value ||
        "#7289da"
    })
  );

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
  const container =
    State.UI.rooms;

  if (!container) return;

  if (!State.rooms.length) {
    container.innerHTML = `
      <div class="conn-status-text">
        No rooms available.
      </div>
    `;

    return;
  }

  container.innerHTML =
    "";

  for (
    const room of State.rooms
  ) {
    const card =
      document.createElement(
        "div"
      );

    card.className =
      "conn-room-card";

    const players =
      Array.isArray(
        room.players
      )
        ? room.players
        : [];

    const playerText =
      players.length
        ? players
            .map(
              p => {
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
                        p.name ||
                        "Player"
                      )}
                    </span>
                  </div>
                `;
              }
            )
            .join("")
        : "No players";

    card.innerHTML = `
      <div class="conn-room-head">
        <div class="conn-room-name">
          ${escapeHtml(
            room.name ||
            "Room"
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
          RTP ${Number(
            room.rtp || 0
          )}
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

    container.appendChild(
      card
    );
  }
}

function updateCurrentRoom() {
  if (
    !State.UI.currentRoom
  ) {
    return;
  }

  if (!State.joinedRoom) {
    State.UI.currentRoom.innerHTML =
      "Not in a room.";

    State.UI.currentPlayers.innerHTML =
      "";

    return;
  }

  const room =
    State.roomData ||
    {};

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
    Array.isArray(
      room.players
    )
      ? room.players
      : [];

  State.UI.currentPlayers.innerHTML =
    players
      .map(
        p => {
          const id =
            String(
              p.id || ""
            );

          const color =
            p.color ||
            p.nameColor ||
            "#7289da";

          const isMe =
            State.id &&
            id ===
              String(
                State.id
              );

          return `
            <div class="conn-current-player">
              <span
                class="conn-player-name"
                style="color:${escapeHtml(color)}"
              >
                ${escapeHtml(
                  p.name ||
                  "Player"
                )}
              </span>

              ${
                isMe
                  ? `<span class="conn-tag">YOU</span>`
                  : ""
              }

              ${
                !isMe &&
                room.host ===
                  State.id
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
        }
      )
      .join("");

  State.UI.currentPlayers
    .querySelectorAll(
      "[data-kick]"
    )
    .forEach(
      btn => {
        btn.onclick =
          () => {
            Network.kick(
              btn.dataset.kick
            );
          };
      }
    );
}

function updateScanUI() {
  if (
    !State.UI.matchBtn
  ) {
    return;
  }

  if (
    State.confirmedMatch
  ) {
    State.UI.matchBtn.textContent =
      "MATCH CONFIRMED";

    State.UI.matchBtn.disabled =
      true;

    State.UI.matchStatus.textContent =
      `Ready • ${State.originalBots.length} original bots captured`;
  } else {
    State.UI.matchBtn.textContent =
      "I AM INSIDE A MATCH";

    State.UI.matchBtn.disabled =
      false;

    State.UI.matchStatus.textContent =
      State.joinedRoom
        ? "Not confirmed."
        : "Join a room first.";
  }
}

function updateUI() {
  if (!State.UI.panel)
    return;

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
  if (
    State.UI.status
  ) {
    State.UI.status.textContent =
      text;
  }

  log(text);
}

function toggleUI(force) {
  const panel =
    State.UI.panel;

  if (!panel) return;

  const visible =
    force !== undefined
      ? force
      : panel.style.display !==
        "block";

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

  let dragging =
    false;

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

      dragging =
        true;

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
        rect.left +
        "px";

      panel.style.top =
        rect.top +
        "px";

      e.preventDefault();
    }
  );

  document.addEventListener(
    "mousemove",
    e => {
      if (!dragging)
        return;

      panel.style.left =
        Math.max(
          5,
          Math.min(
            window.innerWidth -
              panel.offsetWidth -
              5,
            e.clientX -
              ox
          )
        ) + "px";

      panel.style.top =
        Math.max(
          5,
          Math.min(
            window.innerHeight -
              panel.offsetHeight -
              5,
            e.clientY -
              oy
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
      if (
        isInsideMatch()
      ) {
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
  return String(
    value ?? ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}


/* =========================================================
   INIT
========================================================= */

function init() {
  try {
    const enabled =
      localStorage.getItem(
        "connections-chat-sound-enabled"
      );

    if (
      enabled !== null
    ) {
      State.chatSoundEnabled =
        enabled !== "false";
    }
  } catch (e) {}

  try {
    const sound =
      localStorage.getItem(
        "connections-chat-sound"
      );

    if (sound) {
      State.chatSound =
        sound;
    }
  } catch (e) {}

  try {
    const volume =
      localStorage.getItem(
        "connections-chat-volume"
      );

    if (volume !== null) {
      State.chatVolume =
        Number(volume);
    }
  } catch (e) {}

  buildUI();

  Network.connect();

  if (
    State.monitorTimer
  ) {
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
    {
      once: true
    }
  );
} else {
  init();
}
