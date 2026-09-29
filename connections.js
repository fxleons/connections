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
      obj.location ||
      obj.transform?.position;

    if (!p) {
      return {
        x: 0,
        y: 0,
        z: 0
      };
    }

    return {
      x: Number(p.x) || 0,
      y: Number(p.y) || 0,
      z: Number(p.z) || 0
    };
  }

  function rotationOf(obj) {
    if (!obj) {
      return {
        x: 0,
        y: 0,
        z: 0,
        w: 1
      };
    }

    const r =
      obj.rotation ||
      obj.rot ||
      obj.euler ||
      obj.transform?.rotation;

    if (!r) {
      return {
        x: 0,
        y: 0,
        z: 0,
        w: 1
      };
    }

    return {
      x: Number(r.x) || 0,
      y: Number(r.y) || 0,
      z: Number(r.z) || 0,
      w:
        r.w === undefined
          ? 1
          : Number(r.w) || 0
    };
  }

  function setPosition(
    obj,
    pos
  ) {
    if (!obj || !pos) {
      return false;
    }

    try {
      if (
        obj.position &&
        typeof obj.position ===
        "object"
      ) {
        obj.position.x =
          Number(pos.x) || 0;

        obj.position.y =
          Number(pos.y) || 0;

        obj.position.z =
          Number(pos.z) || 0;

        return true;
      }

      if (
        obj.pos &&
        typeof obj.pos ===
        "object"
      ) {
        obj.pos.x =
          Number(pos.x) || 0;

        obj.pos.y =
          Number(pos.y) || 0;

        obj.pos.z =
          Number(pos.z) || 0;

        return true;
      }

      if (
        obj.transform &&
        obj.transform.position
      ) {
        obj.transform.position.x =
          Number(pos.x) || 0;

        obj.transform.position.y =
          Number(pos.y) || 0;

        obj.transform.position.z =
          Number(pos.z) || 0;

        return true;
      }
    } catch (e) {
      warn(
        "setPosition failed",
        e
      );
    }

    return false;
  }

  function setRotation(
    obj,
    rot
  ) {
    if (!obj || !rot) {
      return false;
    }

    try {
      if (
        obj.rotation &&
        typeof obj.rotation ===
        "object"
      ) {
        obj.rotation.x =
          Number(rot.x) || 0;

        obj.rotation.y =
          Number(rot.y) || 0;

        obj.rotation.z =
          Number(rot.z) || 0;

        if (
          "w" in obj.rotation
        ) {
          obj.rotation.w =
            rot.w === undefined
              ? 1
              : Number(rot.w) || 0;
        }

        return true;
      }

      if (
        obj.rot &&
        typeof obj.rot ===
        "object"
      ) {
        obj.rot.x =
          Number(rot.x) || 0;

        obj.rot.y =
          Number(rot.y) || 0;

        obj.rot.z =
          Number(rot.z) || 0;

        if (
          "w" in obj.rot
        ) {
          obj.rot.w =
            rot.w === undefined
              ? 1
              : Number(rot.w) || 0;
        }

        return true;
      }

      if (
        obj.transform &&
        obj.transform.rotation
      ) {
        obj.transform.rotation.x =
          Number(rot.x) || 0;

        obj.transform.rotation.y =
          Number(rot.y) || 0;

        obj.transform.rotation.z =
          Number(rot.z) || 0;

        if (
          "w" in
          obj.transform.rotation
        ) {
          obj.transform.rotation.w =
            rot.w === undefined
              ? 1
              : Number(rot.w) || 0;
        }

        return true;
      }
    } catch (e) {
      warn(
        "setRotation failed",
        e
      );
    }

    return false;
  }

  function distance(
    a,
    b
  ) {
    const dx =
      (a.x || 0) -
      (b.x || 0);

    const dy =
      (a.y || 0) -
      (b.y || 0);

    const dz =
      (a.z || 0) -
      (b.z || 0);

    return Math.sqrt(
      dx * dx +
      dy * dy +
      dz * dz
    );
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
        bot.transform &&
        bot.transform.position
      ) {
        bot.transform.position.x = x;
        bot.transform.position.y = y;
        bot.transform.position.z = z;
      }
    } catch {}

    try {
      if (
        bot.root &&
        bot.root.position
      ) {
        bot.root.position.x = x;
        bot.root.position.y = y;
        bot.root.position.z = z;
      }
    } catch {}

    try {
      if (
        bot.cs2Agent &&
        bot.cs2Agent.root &&
        bot.cs2Agent.root.position
      ) {
        bot.cs2Agent.root.position.x = x;
        bot.cs2Agent.root.position.y = y;
        bot.cs2Agent.root.position.z = z;
      }
    } catch {}

    return p;
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
        bot.transform &&
        bot.transform.rotation
      ) {
        bot.transform.rotation.y = yaw;
        bot.transform.rotation.x = pitch;
      }
    } catch {}

    try {
      if (
        bot.root &&
        bot.root.rotation
      ) {
        bot.root.rotation.y = yaw;
        bot.root.rotation.x = pitch;
      }
    } catch {}

    try {
      if (
        bot.cs2Agent &&
        bot.cs2Agent.root &&
        bot.cs2Agent.root.rotation
      ) {
        bot.cs2Agent.root.rotation.y = yaw;
        bot.cs2Agent.root.rotation.x = pitch;
      }
    } catch {}
  }

  function distance(
    a,
    b
  ) {
    const dx =
      (a.x || 0) -
      (b.x || 0);

    const dy =
      (a.y || 0) -
      (b.y || 0);

    const dz =
      (a.z || 0) -
      (b.z || 0);

    return Math.sqrt(
      dx * dx +
      dy * dy +
      dz * dz
    );
  }

function clamp(
  value,
  min,
  max
) {
  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
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
        return null;
      }

      for (
        const bot of bots
      ) {
        if (!bot) continue;

        const ctor =
          bot.constructor;

        if (
          ctor &&
          ctor !== Object &&
          typeof ctor ===
            "function"
        ) {
          State.botCtor =
            ctor;

          log(
            "Captured bot constructor:",
            ctor.name ||
              "(anonymous)"
          );

          return ctor;
        }
      }
    } catch (e) {
      warn(
        "findBotConstructor failed",
        e
      );
    }

    return null;
  }

  function captureOriginalBots() {
    const bots =
      getBotArray();

    if (
      !Array.isArray(bots)
    ) {
      return false;
    }

    State.originalBots =
      bots.slice();

    findBotConstructor();

    return true;
  }

  function removeOriginalBots() {
    const mgr =
      getBotManager();

    if (!mgr) {
      return false;
    }

    const bots =
      getBotArray();

    if (
      !Array.isArray(bots)
    ) {
      return false;
    }

    /*
     * Only remove the bots that existed
     * before Connections started using the
     * bot system.
     */
    for (
      const bot of
        State.originalBots
    ) {
      if (!bot) continue;

      try {
        if (
          typeof bot.destroy ===
          "function"
        ) {
          bot.destroy();
        }
      } catch {}

      try {
        if (
          typeof bot.remove ===
          "function"
        ) {
          bot.remove();
        }
      } catch {}
    }

    try {
      mgr.bots =
        bots.filter(
          bot =>
            !State.originalBots
              .includes(bot)
        );
    } catch {}

    return true;
  }

  function createRemoteBot(
    remote
  ) {
    if (!remote) {
      return null;
    }

    const Ctor =
      findBotConstructor();

    if (!Ctor) {
      warn(
        "Cannot create remote bot: constructor unavailable"
      );

      return null;
    }

    let bot = null;

    try {
      bot =
        new Ctor();
    } catch (e) {
      warn(
        "new bot constructor failed",
        e
      );

      try {
        bot =
          Object.create(
            Ctor.prototype
          );
      } catch {
        return null;
      }
    }

    if (!bot) {
      return null;
    }

    const p =
      remote.position || {
        x: 0,
        y: 0,
        z: 0
      };

    const r =
      remote.rotation || {
        yaw: 0,
        pitch: 0
      };

    setPosition(
      bot,
      p.x,
      p.y,
      p.z
    );

    setRotation(
      bot,
      r.yaw,
      r.pitch
    );

    try {
      bot.__connectionsRemote =
        true;

      bot.__connectionsId =
        remote.id;

      bot.__connectionsName =
        remote.name || "Player";
    } catch {}

    State.remoteBots.add(
      bot
    );

    return bot;
  }

  function destroyRemoteBot(
    bot
  ) {
    if (!bot) return;

    try {
      if (
        typeof bot.destroy ===
        "function"
      ) {
        bot.destroy();
      }
    } catch {}

    try {
      if (
        typeof bot.remove ===
        "function"
      ) {
        bot.remove();
      }
    } catch {}

    State.remoteBots.delete(
      bot
    );
  }

  function destroyAllRemoteBots() {
    for (
      const bot of
        State.remoteBots
    ) {
      destroyRemoteBot(
        bot
      );
    }

    State.remoteBots.clear();
  }

  function addBotToManager(
    bot
  ) {
    const mgr =
      getBotManager();

    if (!mgr || !bot) {
      return false;
    }

    try {
      if (
        Array.isArray(
          mgr.bots
        )
      ) {
        if (
          !mgr.bots.includes(
            bot
          )
        ) {
          mgr.bots.push(
            bot
          );
        }

        return true;
      }
    } catch {}

    return false;
  }

  function removeBotFromManager(
    bot
  ) {
    const mgr =
      getBotManager();

    if (!mgr || !bot) {
      return false;
    }

    try {
      if (
        Array.isArray(
          mgr.bots
        )
      ) {
        const index =
          mgr.bots.indexOf(
            bot
          );

        if (index !== -1) {
          mgr.bots.splice(
            index,
            1
          );
        }

        return true;
      }
    } catch {}

    return false;
  }

  function syncRemoteBot(
    bot,
    remote
  ) {
    if (
      !bot ||
      !remote
    ) {
      return;
    }

    const p =
      remote.position || {
        x: 0,
        y: 0,
        z: 0
      };

    const r =
      remote.rotation || {
        yaw: 0,
        pitch: 0
      };

    setPosition(
      bot,
      Number(p.x) || 0,
      Number(p.y) || 0,
      Number(p.z) || 0
    );

    setRotation(
      bot,
      Number(r.yaw) || 0,
      Number(r.pitch) || 0
    );
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

    for (
      const bot of bots
    ) {
      destroyBot(bot);
    }

    log(
      "Removed",
      bots.length,
      "real bots."
    );

    return bots.length;
  }

  function createRealBot() {
    const Ctor =
      findBotConstructor();

    if (!Ctor) {
      return null;
    }

    let bot = null;

    try {
      bot = new Ctor();
    } catch (e) {
      err(
        "Could not instantiate real bot:",
        e
      );

      return null;
    }

    if (!bot) {
      return null;
    }

    try {
      bot.__connectionsRemote =
        true;
    } catch {}

    try {
      const arr =
        getBotArray();

      if (
        arr &&
        !arr.includes(bot)
      ) {
        arr.push(bot);
      }
    } catch {}

    State.remoteBots.add(
      bot
    );

    return bot;
  }

  function setupRemoteBot(
    remote
  ) {
    if (!remote) {
      return null;
    }

    let bot =
      remote.bot ||
      null;

    if (!bot) {
      bot =
        createRealBot();

      if (!bot) {
        return null;
      }

      remote.bot =
        bot;
    }

    try {
      bot.__connectionsRemote =
        true;

      bot.__connectionsId =
        remote.id;

      bot.__connectionsName =
        remote.name ||
        "Player";
    } catch {}

    const p =
      remote.position || {
        x: 0,
        y: 0,
        z: 0
      };

    const r =
      remote.rotation || {
        yaw: 0,
        pitch: 0
      };

    setPosition(
      bot,
      Number(p.x) || 0,
      Number(p.y) || 0,
      Number(p.z) || 0
    );

    setRotation(
      bot,
      Number(r.yaw) || 0,
      Number(r.pitch) || 0
    );

    return bot;
  }

  function destroyRemote(
    id
  ) {
    const remote =
      State.remotes.get(id);

    if (!remote) {
      return;
    }

    if (remote.bot) {
      destroyBot(
        remote.bot
      );

      State.remoteBots.delete(
        remote.bot
      );
    }

    State.remotes.delete(
      id
    );
  }

  function destroyAllRemotes() {
    for (
      const id of
        State.remotes.keys()
    ) {
      destroyRemote(id);
    }

    State.remotes.clear();
    State.remoteBots.clear();
  }

  function updateRemote(
    data
  ) {
    if (
      !data ||
      !data.id
    ) {
      return;
    }

    let remote =
      State.remotes.get(
        data.id
      );

    if (!remote) {
      remote = {
        id: data.id,
        name:
          data.name ||
          "Player",
        avatar:
          data.avatar ||
          null,
        position:
          data.position || {
            x: 0,
            y: 0,
            z: 0
          },
        rotation:
          data.rotation || {
            yaw: 0,
            pitch: 0
          },
        bot: null
      };

      State.remotes.set(
        data.id,
        remote
      );
    } else {
      if (
        data.name !==
        undefined
      ) {
        remote.name =
          data.name;
      }

      if (
        data.avatar !==
        undefined
      ) {
        remote.avatar =
          data.avatar;
      }

      if (
        data.position
      ) {
        remote.position =
          data.position;
      }

      if (
        data.rotation
      ) {
        remote.rotation =
          data.rotation;
      }
    }

    setupRemoteBot(
      remote
    );
  }

  /* =========================================================
     NETWORK
  ========================================================= */

  const Network = {
    connect() {
      if (
        State.connected ||
        State.connecting
      ) {
        return;
      }

      State.connecting =
        true;

      log(
        "Connecting to multiplayer server..."
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

        err(
          "WebSocket creation failed:",
          e
        );

        return;
      }

      State.ws = ws;

      ws.addEventListener(
        "open",
        () => {
          State.connected =
            true;

          State.connecting =
            false;

          log(
            "Multiplayer connected."
          );

          Network.send({
            type:
              "hello",
            name:
              State.name,
            avatar:
              State.localAvatar
          });

          updateUI();
        }
      );

      ws.addEventListener(
        "message",
        event => {
          Network.handleMessage(
            event.data
          );
        }
      );

      ws.addEventListener(
        "close",
        () => {
          State.connected =
            false;

          State.connecting =
            false;

          State.ws = null;

          destroyAllRemotes();

          log(
            "Multiplayer disconnected."
          );

          updateUI();

          setTimeout(
            () => {
              Network.connect();
            },
            3000
          );
        }
      );

      ws.addEventListener(
        "error",
        error => {
          warn(
            "WebSocket error:",
            error
          );
        }
      );
    },

    send(data) {
      if (
        !State.ws ||
        !State.connected
      ) {
        return false;
      }

      try {
        State.ws.send(
          JSON.stringify(data)
        );

        return true;
      } catch (e) {
        warn(
          "Network.send failed:",
          e
        );

        return false;
      }
    },

    handleMessage(raw) {
      let data;

      try {
        data =
          typeof raw ===
          "string"
            ? JSON.parse(raw)
            : raw;
      } catch {
        return;
      }

      if (
        !data ||
        typeof data !==
          "object"
      ) {
        return;
      }

      switch (
        data.type
      ) {
        case "welcome":
          State.id =
            data.id ||
            null;

          log(
            "Assigned network id:",
            State.id
          );

          break;

        case "rooms":
          State.rooms =
            Array.isArray(
              data.rooms
            )
              ? data.rooms
              : [];

          renderRooms();
          break;

        case "room_joined":
          State.room =
            data.room ||
            null;

          State.roomData =
            data.data ||
            null;

          State.joinedRoom =
            true;

          log(
            "Joined room:",
            State.room
          );

          updateCurrentRoom();
          break;

        case "room_left":
          State.room =
            null;

          State.roomData =
            null;

          State.joinedRoom =
            false;

          destroyAllRemotes();

          updateCurrentRoom();
          break;

        case "players":
          if (
            Array.isArray(
              data.players
            )
          ) {
            for (
              const player of
                data.players
            ) {
              if (
                !player ||
                player.id ===
                  State.id
              ) {
                continue;
              }

              updateRemote(
                player
              );
            }
          }

          updateUI();
          break;

        case "player_join":
          if (
            data.player &&
            data.player.id !==
              State.id
          ) {
            updateRemote(
              data.player
            );
          }

          break;

        case "player_leave":
          if (
            data.id
          ) {
            destroyRemote(
              data.id
            );
          }

          break;

        case "state":
        case "player_state":
          if (
            data.player &&
            data.player.id !==
              State.id
          ) {
            updateRemote(
              data.player
            );
          } else if (
            data.id &&
            data.id !==
              State.id
          ) {
            updateRemote(
              data
            );
          }

          break;

        case "chat":
          if (
            data.message
          ) {
            addChatMessage(
              data.message
            );
          }

          break;

        case "error":
          warn(
            "Server error:",
            data.message ||
              data.error ||
              data
          );

          setStatus(
            data.message ||
              data.error ||
              "Server error"
          );

          break;

        default:
          break;
      }
    }
  };
  /* =========================================================
     LOCAL PLAYER STATE
  ========================================================= */

  function getLocalPlayer() {
    try {
      if (
        window.game &&
        window.game.player
      ) {
        return window.game.player;
      }
    } catch {}

    try {
      if (
        window.player
      ) {
        return window.player;
      }
    } catch {}

    return null;
  }

  function readVector(
    value
  ) {
    if (!value) {
      return {
        x: 0,
        y: 0,
        z: 0
      };
    }

    try {
      return {
        x:
          Number(
            value.x
          ) || 0,

        y:
          Number(
            value.y
          ) || 0,

        z:
          Number(
            value.z
          ) || 0
      };
    } catch {
      return {
        x: 0,
        y: 0,
        z: 0
      };
    }
  }

  function readLocalTransform() {
    const player =
      getLocalPlayer();

    if (!player) {
      return {
        position: {
          x: 0,
          y: 0,
          z: 0
        },

        rotation: {
          yaw: 0,
          pitch: 0
        }
      };
    }

    let position = {
      x: 0,
      y: 0,
      z: 0
    };

    let rotation = {
      yaw: 0,
      pitch: 0
    };

    try {
      if (
        player.position
      ) {
        position =
          readVector(
            player.position
          );
      } else if (
        player.transform &&
        player.transform.position
      ) {
        position =
          readVector(
            player.transform.position
          );
      } else {
        position = {
          x:
            Number(
              player.x
            ) || 0,

          y:
            Number(
              player.y
            ) || 0,

          z:
            Number(
              player.z
            ) || 0
        };
      }
    } catch {}

    try {
      if (
        player.rotation
      ) {
        if (
          typeof player.rotation ===
          "object"
        ) {
          rotation = {
            yaw:
              Number(
                player.rotation.yaw ??
                player.rotation.y ??
                0
              ) || 0,

            pitch:
              Number(
                player.rotation.pitch ??
                0
              ) || 0
          };
        }
      }

      if (
        player.yaw !==
        undefined
      ) {
        rotation.yaw =
          Number(
            player.yaw
          ) || 0;
      }

      if (
        player.pitch !==
        undefined
      ) {
        rotation.pitch =
          Number(
            player.pitch
          ) || 0;
      }
    } catch {}

    return {
      position,
      rotation
    };
  }

  let lastSentState = null;

  function stateChanged(
    next
  ) {
    if (
      !lastSentState
    ) {
      return true;
    }

    const a =
      lastSentState.position;

    const b =
      next.position;

    const ar =
      lastSentState.rotation;

    const br =
      next.rotation;

    if (
      !a ||
      !b ||
      !ar ||
      !br
    ) {
      return true;
    }

    return (
      a.x !== b.x ||
      a.y !== b.y ||
      a.z !== b.z ||
      ar.yaw !== br.yaw ||
      ar.pitch !== br.pitch
    );
  }

  function sendLocalState() {
    if (
      !State.connected ||
      !State.joinedRoom
    ) {
      return;
    }

    if (
      !State.id
    ) {
      return;
    }

    const transform =
      readLocalTransform();

    if (
      !stateChanged(
        transform
      )
    ) {
      return;
    }

    lastSentState =
      JSON.parse(
        JSON.stringify(
          transform
        )
      );

    Network.send({
      type:
        "state",

      id:
        State.id,

      name:
        State.name,

      avatar:
        State.localAvatar,

      position:
        transform.position,

      rotation:
        transform.rotation
    });
  }

  let stateInterval =
    null;

  function startStateSync() {
    if (
      stateInterval
    ) {
      return;
    }

    stateInterval =
      setInterval(
        () => {
          try {
            sendLocalState();
          } catch (e) {
            warn(
              "State sync failed:",
              e
            );
          }
        },
        50
      );
  }

  function stopStateSync() {
    if (
      stateInterval
    ) {
      clearInterval(
        stateInterval
      );

      stateInterval =
        null;
    }
  }

  /* =========================================================
     REMOTE UPDATE LOOP
  ========================================================= */

  function refreshRemoteBots() {
    if (
      !State.remotes ||
      !State.remotes.size
    ) {
      return;
    }

    for (
      const remote of
        State.remotes.values()
    ) {
      if (
        !remote
      ) {
        continue;
      }

      try {
        setupRemoteBot(
          remote
        );
      } catch (e) {
        warn(
          "Failed to refresh remote:",
          remote.id,
          e
        );
      }
    }
  }

  let remoteRefreshInterval =
    null;

  function startRemoteRefresh() {
    if (
      remoteRefreshInterval
    ) {
      return;
    }

    remoteRefreshInterval =
      setInterval(
        () => {
          try {
            refreshRemoteBots();
          } catch {}
        },
        100
      );
  }

  function stopRemoteRefresh() {
    if (
      remoteRefreshInterval
    ) {
      clearInterval(
        remoteRefreshInterval
      );

      remoteRefreshInterval =
        null;
    }
  }

  /* =========================================================
     CHAT
  ========================================================= */

  function sendChat(
    message
  ) {
    if (
      !message
    ) {
      return false;
    }

    message =
      String(
        message
      ).trim();

    if (
      !message
    ) {
      return false;
    }

    if (
      message.length >
      500
    ) {
      message =
        message.slice(
          0,
          500
        );
    }

    return Network.send({
      type:
        "chat",

      message: {
        id:
          State.id,

        name:
          State.name,

        avatar:
          State.localAvatar,

        text:
          message,

        timestamp:
          Date.now()
      }
    });
  }

  function addChatMessage(
    message
  ) {
    if (
      !message
    ) {
      return;
    }

    let text =
      "";

    let name =
      "Player";

    if (
      typeof message ===
      "string"
    ) {
      text =
        message;
    } else {
      text =
        String(
          message.text ||
          message.message ||
          ""
        );

      name =
        String(
          message.name ||
          "Player"
        );
    }

    if (
      !text
    ) {
      return;
    }

    if (
      typeof window.__connectionsChatLog !==
      "object"
    ) {
      window.__connectionsChatLog =
        [];
    }

    window.__connectionsChatLog.push({
      name,
      text,
      timestamp:
        Date.now()
    });

    if (
      window.__connectionsChatLog.length >
      100
    ) {
      window.__connectionsChatLog.shift();
    }

    renderChat();
  }

  function renderChat() {
    const box =
      document.getElementById(
        "connections-chat-messages"
      );

    if (
      !box
    ) {
      return;
    }

    const logData =
      window.__connectionsChatLog ||
      [];

    box.innerHTML =
      "";

    for (
      const entry of
        logData
    ) {
      const row =
        document.createElement(
          "div"
        );

      row.style.cssText =
        [
          "padding:4px 0",
          "word-break:break-word"
        ].join(";");

      const name =
        document.createElement(
          "span"
        );

      name.textContent =
        entry.name +
        ": ";

      name.style.fontWeight =
        "700";

      const text =
        document.createElement(
          "span"
        );

      text.textContent =
        entry.text;

      row.appendChild(
        name
      );

      row.appendChild(
        text
      );

      box.appendChild(
        row
      );
    }

    box.scrollTop =
      box.scrollHeight;
  }

  /* =========================================================
     ROOM ACTIONS
  ========================================================= */

  function requestRooms() {
    return Network.send({
      type:
        "rooms"
    });
  }

  function createRoom(
    name
  ) {
    name =
      String(
        name ||
        ""
      ).trim();

    if (
      !name
    ) {
      return false;
    }

    return Network.send({
      type:
        "room_create",

      name
    });
  }

  function joinRoom(
    room
  ) {
    if (
      !room
    ) {
      return false;
    }

    return Network.send({
      type:
        "room_join",

      room:
        String(
          room
        )
    });
  }

  function leaveRoom() {
    if (
      !State.joinedRoom
    ) {
      return false;
    }

    const sent =
      Network.send({
        type:
          "room_leave"
      });

    if (
      sent
    ) {
      destroyAllRemotes();

      State.room =
        null;

      State.roomData =
        null;

      State.joinedRoom =
        false;

      updateCurrentRoom();
    }

    return sent;
  }

  /* =========================================================
     ROOM / PLAYER HELPERS
  ========================================================= */

  function getRemoteCount() {
    try {
      return State.remotes.size;
    } catch {
      return 0;
    }
  }

  function getRoomPlayerCount() {
    let count =
      getRemoteCount();

    if (
      State.joinedRoom
    ) {
      count++;
    }

    return count;
  }

  function updateCurrentRoom() {
    try {
      const room =
        document.getElementById(
          "connections-current-room"
        );

      if (
        room
      ) {
        room.textContent =
          State.joinedRoom
            ? (
                "Room: " +
                (
                  State.room ||
                  "unknown"
                )
              )
            : "No room";
      }

      const players =
        document.getElementById(
          "connections-player-count"
        );

      if (
        players
      ) {
        players.textContent =
          String(
            getRoomPlayerCount()
          );
      }
    } catch {}
  }

  function updateUI() {
    try {
      updateCurrentRoom();
    } catch {}

    try {
      const status =
        document.getElementById(
          "connections-status"
        );

      if (
        status
      ) {
        if (
          State.connected
        ) {
          status.textContent =
            State.joinedRoom
              ? "Connected"
              : "Connected - no room";
        } else if (
          State.connecting
        ) {
          status.textContent =
            "Connecting...";
        } else {
          status.textContent =
            "Disconnected";
        }
      }
    } catch {}

    try {
      renderRooms();
    } catch {}

    try {
      renderChat();
    } catch {}
  }

  /* =========================================================
     ROOM LIST
  ========================================================= */

  function renderRooms() {
    const container =
      document.getElementById(
        "connections-room-list"
      );

    if (
      !container
    ) {
      return;
    }

    container.innerHTML =
      "";

    const rooms =
      Array.isArray(
        State.rooms
      )
        ? State.rooms
        : [];

    if (
      !rooms.length
    ) {
      const empty =
        document.createElement(
          "div"
        );

      empty.textContent =
        "No rooms available.";

      empty.style.cssText =
        [
          "opacity:.6",
          "padding:12px"
        ].join(";");

      container.appendChild(
        empty
      );

      return;
    }

    for (
      const room of
        rooms
    ) {
      if (
        !room
      ) {
        continue;
      }

      const id =
        typeof room ===
        "string"
          ? room
          : (
              room.id ||
              room.name ||
              room.room
            );

      if (
        !id
      ) {
        continue;
      }

      const row =
        document.createElement(
          "div"
        );

      row.style.cssText =
        [
          "display:flex",
          "align-items:center",
          "justify-content:space-between",
          "gap:8px",
          "padding:8px",
          "margin-bottom:6px",
          "border:1px solid rgba(255,255,255,.08)",
          "border-radius:8px"
        ].join(";");

      const label =
        document.createElement(
          "span"
        );

      label.textContent =
        String(
          room.name ||
          room.id ||
          id
        );

      const button =
        document.createElement(
          "button"
        );

      button.textContent =
        "Join";

      button.type =
        "button";

      button.style.cssText =
        [
          "cursor:pointer",
          "border:0",
          "border-radius:6px",
          "padding:5px 10px",
          "background:#7289da",
          "color:#fff"
        ].join(";");

      button.addEventListener(
        "click",
        () => {
          joinRoom(
            id
          );
        }
      );

      row.appendChild(
        label
      );

      row.appendChild(
        button
      );

      container.appendChild(
        row
      );
    }
  }

  /* =========================================================
     NETWORK LIFECYCLE
  ========================================================= */

  function startMultiplayer() {
    startStateSync();
    startRemoteRefresh();

    if (
      !State.connected &&
      !State.connecting
    ) {
      Network.connect();
    }
  }

  function stopMultiplayer() {
    stopStateSync();
    stopRemoteRefresh();

    destroyAllRemotes();

    if (
      State.ws
    ) {
      try {
        State.ws.close();
      } catch {}
    }

    State.ws =
      null;

    State.connected =
      false;

    State.connecting =
      false;
  }

  /* =========================================================
     INITIAL MULTIPLAYER BOOT
  ========================================================= */

  try {
    startMultiplayer();
  } catch (e) {
    err(
      "Multiplayer startup failed:",
      e
    );
  }
  /* =========================================================
     PLAYER NAME / AVATAR
  ========================================================= */

  function loadLocalIdentity() {
    let name =
      null;

    let avatar =
      null;

    try {
      name =
        localStorage.getItem(
          "connections-player-name"
        );
    } catch {}

    try {
      avatar =
        localStorage.getItem(
          "pp-avatar"
        );
    } catch {}

    if (
      !name ||
      !String(name).trim()
    ) {
      name =
        "Player";
    }

    State.name =
      String(
        name
      ).trim().slice(
        0,
        32
      );

    State.localAvatar =
      avatar ||
      null;
  }

  function setLocalName(
    name
  ) {
    name =
      String(
        name ||
        ""
      ).trim();

    if (
      !name
    ) {
      name =
        "Player";
    }

    name =
      name.slice(
        0,
        32
      );

    State.name =
      name;

    try {
      localStorage.setItem(
        "connections-player-name",
        name
      );
    } catch {}

    if (
      State.connected
    ) {
      Network.send({
        type:
          "identity",

        name:
          State.name,

        avatar:
          State.localAvatar
      });
    }

    updateUI();

    return name;
  }

  function loadAvatarState() {
    try {
      const avatar =
        localStorage.getItem(
          "pp-avatar"
        );

      if (
        avatar
      ) {
        State.localAvatar =
          avatar;
      }
    } catch {}
  }

  function sendIdentity() {
    if (
      !State.connected
    ) {
      return false;
    }

    return Network.send({
      type:
        "identity",

      name:
        State.name,

      avatar:
        State.localAvatar
    });
  }

  function setupIdentityWatcher() {
    let lastName =
      State.name;

    let lastAvatar =
      State.localAvatar;

    setInterval(
      () => {
        let currentName =
          lastName;

        let currentAvatar =
          lastAvatar;

        try {
          const storedName =
            localStorage.getItem(
              "connections-player-name"
            );

          if (
            storedName
          ) {
            currentName =
              String(
                storedName
              ).trim().slice(
                0,
                32
              );
          }
        } catch {}

        try {
          const storedAvatar =
            localStorage.getItem(
              "pp-avatar"
            );

          currentAvatar =
            storedAvatar ||
            null;
        } catch {}

        if (
          currentName !==
          lastName
        ) {
          State.name =
            currentName ||
            "Player";

          lastName =
            State.name;

          sendIdentity();
        }

        if (
          currentAvatar !==
          lastAvatar
        ) {
          State.localAvatar =
            currentAvatar;

          lastAvatar =
            currentAvatar;

          sendIdentity();
        }
      },
      1000
    );
  }

  /* =========================================================
     CHAT UI
  ========================================================= */

  function createChatUI() {
    if (
      document.getElementById(
        "connections-chat"
      )
    ) {
      return;
    }

    const root =
      document.createElement(
        "div"
      );

    root.id =
      "connections-chat";

    root.style.cssText =
      [
        "position:absolute",
        "left:20px",
        "bottom:20px",
        "width:320px",
        "max-width:calc(100vw - 40px)",
        "background:rgba(15,15,20,.94)",
        "border:1px solid rgba(255,255,255,.1)",
        "border-radius:10px",
        "padding:10px",
        "color:#fff",
        "font-family:Arial,sans-serif",
        "font-size:13px",
        "z-index:2147483646",
        "box-sizing:border-box",
        "display:none",
        "backdrop-filter:blur(8px)"
      ].join(";");

    const messages =
      document.createElement(
        "div"
      );

    messages.id =
      "connections-chat-messages";

    messages.style.cssText =
      [
        "height:160px",
        "overflow-y:auto",
        "margin-bottom:8px",
        "padding:4px"
      ].join(";");

    const row =
      document.createElement(
        "div"
      );

    row.style.cssText =
      [
        "display:flex",
        "gap:6px"
      ].join(";");

    const input =
      document.createElement(
        "input"
      );

    input.id =
      "connections-chat-input";

    input.type =
      "text";

    input.placeholder =
      "type a message...";

    input.maxLength =
      500;

    input.style.cssText =
      [
        "flex:1",
        "min-width:0",
        "background:#202024",
        "border:1px solid rgba(255,255,255,.1)",
        "border-radius:6px",
        "padding:7px 9px",
        "color:#fff",
        "outline:none",
        "box-sizing:border-box"
      ].join(";");

    const send =
      document.createElement(
        "button"
      );

    send.type =
      "button";

    send.textContent =
      "Send";

    send.style.cssText =
      [
        "border:0",
        "border-radius:6px",
        "padding:7px 10px",
        "background:#7289da",
        "color:#fff",
        "cursor:pointer"
      ].join(";");

    send.addEventListener(
      "click",
      () => {
        const value =
          input.value.trim();

        if (
          !value
        ) {
          return;
        }

        if (
          sendChat(
            value
          )
        ) {
          input.value =
            "";
        }
      }
    );

    input.addEventListener(
      "keydown",
      event => {
        if (
          event.key ===
          "Enter"
        ) {
          event.preventDefault();

          send.click();
        }
      }
    );

    row.appendChild(
      input
    );

    row.appendChild(
      send
    );

    root.appendChild(
      messages
    );

    root.appendChild(
      row
    );

    document.body.appendChild(
      root
    );
  }

  function toggleChat(
    force
  ) {
    const chat =
      document.getElementById(
        "connections-chat"
      );

    if (
      !chat
    ) {
      return;
    }

    if (
      typeof force ===
      "boolean"
    ) {
      chat.style.display =
        force
          ? "block"
          : "none";

      return;
    }

    chat.style.display =
      chat.style.display ===
      "none"
        ? "block"
        : "none";
  }

  /* =========================================================
     IDENTITY UI
  ========================================================= */

  function createIdentityUI() {
    if (
      document.getElementById(
        "connections-identity"
      )
    ) {
      return;
    }

    const root =
      document.createElement(
        "div"
      );

    root.id =
      "connections-identity";

    root.style.cssText =
      [
        "position:absolute",
        "right:20px",
        "bottom:20px",
        "width:230px",
        "background:rgba(15,15,20,.94)",
        "border:1px solid rgba(255,255,255,.1)",
        "border-radius:10px",
        "padding:10px",
        "color:#fff",
        "font-family:Arial,sans-serif",
        "font-size:13px",
        "z-index:2147483646",
        "box-sizing:border-box",
        "display:none",
        "backdrop-filter:blur(8px)"
      ].join(";");

    const title =
      document.createElement(
        "div"
      );

    title.textContent =
      "player";

    title.style.cssText =
      [
        "font-weight:700",
        "margin-bottom:8px"
      ].join(";");

    const input =
      document.createElement(
        "input"
      );

    input.id =
      "connections-name-input";

    input.type =
      "text";

    input.value =
      State.name ||
      "Player";

    input.maxLength =
      32;

    input.placeholder =
      "player name";

    input.style.cssText =
      [
        "width:100%",
        "box-sizing:border-box",
        "background:#202024",
        "border:1px solid rgba(255,255,255,.1)",
        "border-radius:6px",
        "padding:7px 9px",
        "color:#fff",
        "outline:none"
      ].join(";");

    const save =
      document.createElement(
        "button"
      );

    save.type =
      "button";

    save.textContent =
      "Save";

    save.style.cssText =
      [
        "width:100%",
        "margin-top:7px",
        "border:0",
        "border-radius:6px",
        "padding:7px",
        "background:#7289da",
        "color:#fff",
        "cursor:pointer"
      ].join(";");

    save.addEventListener(
      "click",
      () => {
        setLocalName(
          input.value
        );
      }
    );

    input.addEventListener(
      "keydown",
      event => {
        if (
          event.key ===
          "Enter"
        ) {
          event.preventDefault();

          save.click();
        }
      }
    );

    root.appendChild(
      title
    );

    root.appendChild(
      input
    );

    root.appendChild(
      save
    );

    document.body.appendChild(
      root
    );
  }

  function toggleIdentity(
    force
  ) {
    const identity =
      document.getElementById(
        "connections-identity"
      );

    if (
      !identity
    ) {
      return;
    }

    if (
      typeof force ===
      "boolean"
    ) {
      identity.style.display =
        force
          ? "block"
          : "none";

      return;
    }

    identity.style.display =
      identity.style.display ===
      "none"
        ? "block"
        : "none";
  }

  /* =========================================================
     KEYBOARD CONTROLS
  ========================================================= */

  function setupKeyboard() {
    document.addEventListener(
      "keydown",
      event => {
        if (
          event.repeat
        ) {
          return;
        }

        if (
          event.key ===
          "F8"
        ) {
          event.preventDefault();

          toggleChat();
        }

        if (
          event.key ===
          "F9"
        ) {
          event.preventDefault();

          toggleIdentity();
        }
      },
      true
    );
  }

  /* =========================================================
     DOM INITIALIZATION
  ========================================================= */

  function initializeDOM() {
    if (
      !document.body
    ) {
      return;
    }

    createChatUI();
    createIdentityUI();

    renderChat();
    updateUI();
  }

  function waitForDOM() {
    if (
      document.body
    ) {
      initializeDOM();

      return;
    }

    const observer =
      new MutationObserver(
        () => {
          if (
            document.body
          ) {
            observer.disconnect();

            initializeDOM();
          }
        }
      );

    observer.observe(
      document.documentElement,
      {
        childList:
          true,

        subtree:
          true
      }
    );
  }

  /* =========================================================
     FINAL INITIALIZATION
  ========================================================= */

  loadLocalIdentity();
  loadAvatarState();

  setupIdentityWatcher();
  setupKeyboard();

  waitForDOM();

  log(
    "Connections multiplayer system initialized."
  );
  /* =========================================================
     MAIN MENU INTEGRATION
  ========================================================= */

  function createMultiplayerPanel() {
    if (
      document.getElementById(
        "connections-multiplayer-panel"
      )
    ) {
      return;
    }

    const panel =
      document.createElement(
        "div"
      );

    panel.id =
      "connections-multiplayer-panel";

    panel.style.cssText =
      [
        "position:fixed",
        "top:50%",
        "left:50%",
        "transform:translate(-50%,-50%)",
        "width:420px",
        "max-width:calc(100vw - 30px)",
        "max-height:calc(100vh - 30px)",
        "overflow:hidden",
        "background:rgba(15,15,20,.97)",
        "border:1px solid rgba(255,255,255,.12)",
        "border-radius:14px",
        "box-shadow:0 20px 60px rgba(0,0,0,.5)",
        "color:#fff",
        "font-family:Arial,sans-serif",
        "z-index:2147483647",
        "display:none",
        "box-sizing:border-box"
      ].join(";");

    const header =
      document.createElement(
        "div"
      );

    header.style.cssText =
      [
        "display:flex",
        "align-items:center",
        "justify-content:space-between",
        "padding:14px 16px",
        "border-bottom:1px solid rgba(255,255,255,.08)"
      ].join(";");

    const title =
      document.createElement(
        "div"
      );

    title.textContent =
      "connections multiplayer";

    title.style.cssText =
      [
        "font-size:16px",
        "font-weight:700"
      ].join(";");

    const close =
      document.createElement(
        "button"
      );

    close.type =
      "button";

    close.textContent =
      "×";

    close.style.cssText =
      [
        "border:0",
        "background:transparent",
        "color:#aaa",
        "font-size:22px",
        "cursor:pointer",
        "line-height:1"
      ].join(";");

    close.addEventListener(
      "click",
      () => {
        toggleMultiplayerPanel(
          false
        );
      }
    );

    header.appendChild(
      title
    );

    header.appendChild(
      close
    );

    const body =
      document.createElement(
        "div"
      );

    body.style.cssText =
      [
        "padding:14px",
        "overflow-y:auto",
        "max-height:calc(100vh - 100px)"
      ].join(";");

    const status =
      document.createElement(
        "div"
      );

    status.id =
      "connections-status";

    status.textContent =
      "Disconnected";

    status.style.cssText =
      [
        "font-size:12px",
        "opacity:.7",
        "margin-bottom:12px"
      ].join(";");

    const roomInfo =
      document.createElement(
        "div"
      );

    roomInfo.style.cssText =
      [
        "padding:10px",
        "background:rgba(255,255,255,.04)",
        "border-radius:8px",
        "margin-bottom:12px"
      ].join(";");

    const currentRoom =
      document.createElement(
        "div"
      );

    currentRoom.id =
      "connections-current-room";

    currentRoom.textContent =
      "No room";

    currentRoom.style.fontWeight =
      "700";

    const playerCount =
      document.createElement(
        "div"
      );

    playerCount.style.cssText =
      [
        "font-size:12px",
        "opacity:.65",
        "margin-top:4px"
      ].join(";");

    const countValue =
      document.createElement(
        "span"
      );

    countValue.id =
      "connections-player-count";

    countValue.textContent =
      "0";

    playerCount.textContent =
      "players: ";

    playerCount.appendChild(
      countValue
    );

    roomInfo.appendChild(
      currentRoom
    );

    roomInfo.appendChild(
      playerCount
    );

    const createRow =
      document.createElement(
        "div"
      );

    createRow.style.cssText =
      [
        "display:flex",
        "gap:7px",
        "margin-bottom:12px"
      ].join(";");

    const roomInput =
      document.createElement(
        "input"
      );

    roomInput.id =
      "connections-room-input";

    roomInput.type =
      "text";

    roomInput.placeholder =
      "room name";

    roomInput.maxLength =
      64;

    roomInput.style.cssText =
      [
        "flex:1",
        "min-width:0",
        "background:#202024",
        "border:1px solid rgba(255,255,255,.1)",
        "border-radius:7px",
        "padding:8px 9px",
        "color:#fff",
        "outline:none"
      ].join(";");

    const createButton =
      document.createElement(
        "button"
      );

    createButton.type =
      "button";

    createButton.textContent =
      "Create";

    createButton.style.cssText =
      [
        "border:0",
        "border-radius:7px",
        "padding:8px 11px",
        "background:#7289da",
        "color:#fff",
        "cursor:pointer"
      ].join(";");

    createButton.addEventListener(
      "click",
      () => {
        const name =
          roomInput.value.trim();

        if (
          !name
        ) {
          return;
        }

        createRoom(
          name
        );

        roomInput.value =
          "";
      }
    );

    roomInput.addEventListener(
      "keydown",
      event => {
        if (
          event.key ===
          "Enter"
        ) {
          event.preventDefault();

          createButton.click();
        }
      }
    );

    createRow.appendChild(
      roomInput
    );

    createRow.appendChild(
      createButton
    );

    const refreshButton =
      document.createElement(
        "button"
      );

    refreshButton.type =
      "button";

    refreshButton.textContent =
      "Refresh rooms";

    refreshButton.style.cssText =
      [
        "width:100%",
        "border:1px solid rgba(255,255,255,.1)",
        "border-radius:7px",
        "padding:8px",
        "background:rgba(255,255,255,.04)",
        "color:#fff",
        "cursor:pointer",
        "margin-bottom:10px"
      ].join(";");

    refreshButton.addEventListener(
      "click",
      () => {
        requestRooms();
      }
    );

    const leaveButton =
      document.createElement(
        "button"
      );

    leaveButton.type =
      "button";

    leaveButton.textContent =
      "Leave room";

    leaveButton.style.cssText =
      [
        "width:100%",
        "border:0",
        "border-radius:7px",
        "padding:8px",
        "background:#29292f",
        "color:#fff",
        "cursor:pointer",
        "margin-bottom:12px"
      ].join(";");

    leaveButton.addEventListener(
      "click",
      () => {
        leaveRoom();
      }
    );

    const roomsTitle =
      document.createElement(
        "div"
      );

    roomsTitle.textContent =
      "available rooms";

    roomsTitle.style.cssText =
      [
        "font-weight:700",
        "font-size:12px",
        "text-transform:uppercase",
        "opacity:.6",
        "margin-bottom:7px"
      ].join(";");

    const rooms =
      document.createElement(
        "div"
      );

    rooms.id =
      "connections-room-list";

    rooms.style.cssText =
      [
        "max-height:180px",
        "overflow-y:auto",
        "margin-bottom:12px"
      ].join(";");

    body.appendChild(
      status
    );

    body.appendChild(
      roomInfo
    );

    body.appendChild(
      createRow
    );

    body.appendChild(
      refreshButton
    );

    body.appendChild(
      leaveButton
    );

    body.appendChild(
      roomsTitle
    );

    body.appendChild(
      rooms
    );

    panel.appendChild(
      header
    );

    panel.appendChild(
      body
    );

    document.body.appendChild(
      panel
    );

    renderRooms();
    updateUI();
  }

  function toggleMultiplayerPanel(
    force
  ) {
    const panel =
      document.getElementById(
        "connections-multiplayer-panel"
      );

    if (
      !panel
    ) {
      createMultiplayerPanel();

      return toggleMultiplayerPanel(
        force
      );
    }

    if (
      typeof force ===
      "boolean"
    ) {
      panel.style.display =
        force
          ? "block"
          : "none";

      return;
    }

    panel.style.display =
      panel.style.display ===
      "none"
        ? "block"
        : "none";
  }

  /* =========================================================
     GLOBAL API
  ========================================================= */

  const ConnectionsAPI = {
    state:
      State,

    network:
      Network,

    connect:
      () => {
        Network.connect();
      },

    disconnect:
      () => {
        stopMultiplayer();
      },

    rooms:
      () => {
        requestRooms();
      },

    createRoom:
      room => {
        return createRoom(
          room
        );
      },

    joinRoom:
      room => {
        return joinRoom(
          room
        );
      },

    leaveRoom:
      () => {
        return leaveRoom();
      },

    sendChat:
      message => {
        return sendChat(
          message
        );
      },

    setName:
      name => {
        return setLocalName(
          name
        );
      },

    open:
      () => {
        toggleMultiplayerPanel(
          true
        );
      },

    close:
      () => {
        toggleMultiplayerPanel(
          false
        );
      },

    toggle:
      () => {
        toggleMultiplayerPanel();
      }
  };

  try {
    window.Connections =
      ConnectionsAPI;
  } catch {}

  try {
    window.__Connections =
      ConnectionsAPI;
  } catch {}

  /* =========================================================
     GLOBAL EVENTS
  ========================================================= */

  window.addEventListener(
    "connections:open",
    () => {
      toggleMultiplayerPanel(
        true
      );
    }
  );

  window.addEventListener(
    "connections:close",
    () => {
      toggleMultiplayerPanel(
        false
      );
    }
  );

  window.addEventListener(
    "connections:toggle",
    () => {
      toggleMultiplayerPanel();
    }
  );

  /* =========================================================
     INITIAL PANEL
  ========================================================= */

  try {
    createMultiplayerPanel();
  } catch (e) {
    err(
      "Could not create multiplayer panel:",
      e
    );
  }

  /* =========================================================
     CONNECTION EVENTS
  ========================================================= */

  function handleConnectionState() {
    updateUI();

    if (
      State.connected
    ) {
      try {
        sendIdentity();
      } catch {}

      try {
        requestRooms();
      } catch {}
    }
  }

  const originalConnect =
    Network.connect;

  if (
    typeof originalConnect ===
    "function"
  ) {
    Network.connect =
      function () {
        const result =
          originalConnect.apply(
            Network,
            arguments
          );

        setTimeout(
          () => {
            handleConnectionState();
          },
          250
        );

        return result;
      };
  }

  /* =========================================================
     PERIODIC UI SYNC
  ========================================================= */

  setInterval(
    () => {
      try {
        updateCurrentRoom();
        updateUI();
      } catch {}
    },
    1000
  );

  /* =========================================================
     FINAL READY STATE
  ========================================================= */

  try {
    window.dispatchEvent(
      new CustomEvent(
        "connections:ready",
        {
          detail: {
            api:
              ConnectionsAPI
          }
        }
      )
    );
  } catch {}

  log(
    "Connections API ready."
  );

  log(
    "Use window.Connections to access multiplayer."
  );
  /* =========================================================
     PLAYER LIST
  ========================================================= */

  function getPlayerList() {
    const players = [];

    try {
      if (
        State.id
      ) {
        players.push({
          id:
            State.id,

          name:
            State.name ||
            "Player",

          avatar:
            State.localAvatar ||
            null,

          local:
            true
        });
      }
    } catch {}

    try {
      for (
        const remote of
          State.remotes.values()
      ) {
        if (
          !remote ||
          !remote.id
        ) {
          continue;
        }

        players.push({
          id:
            remote.id,

          name:
            remote.name ||
            "Player",

          avatar:
            remote.avatar ||
            null,

          local:
            false,

          position:
            remote.position ||
            null,

          rotation:
            remote.rotation ||
            null
        });
      }
    } catch {}

    return players;
  }

  function renderPlayerList() {
    const container =
      document.getElementById(
        "connections-player-list"
      );

    if (
      !container
    ) {
      return;
    }

    container.innerHTML =
      "";

    const players =
      getPlayerList();

    if (
      !players.length
    ) {
      const empty =
        document.createElement(
          "div"
        );

      empty.textContent =
        "No players.";

      empty.style.cssText =
        [
          "opacity:.5",
          "padding:8px"
        ].join(";");

      container.appendChild(
        empty
      );

      return;
    }

    for (
      const player of
        players
    ) {
      const row =
        document.createElement(
          "div"
        );

      row.style.cssText =
        [
          "display:flex",
          "align-items:center",
          "gap:8px",
          "padding:7px",
          "border-radius:7px",
          "background:rgba(255,255,255,.035)",
          "margin-bottom:5px"
        ].join(";");

      const avatar =
        document.createElement(
          "div"
        );

      avatar.style.cssText =
        [
          "width:30px",
          "height:30px",
          "border-radius:50%",
          "overflow:hidden",
          "background:#25252b",
          "display:flex",
          "align-items:center",
          "justify-content:center",
          "flex-shrink:0"
        ].join(";");

      if (
        player.avatar
      ) {
        const image =
          document.createElement(
            "img"
          );

        image.src =
          player.avatar;

        image.alt =
          "";

        image.style.cssText =
          [
            "width:100%",
            "height:100%",
            "object-fit:cover"
          ].join(";");

        image.onerror =
          () => {
            image.remove();

            avatar.textContent =
              "👤";
          };

        avatar.appendChild(
          image
        );
      } else {
        avatar.textContent =
          "👤";
      }

      const info =
        document.createElement(
          "div"
        );

      info.style.cssText =
        [
          "min-width:0",
          "flex:1"
        ].join(";");

      const name =
        document.createElement(
          "div"
        );

      name.textContent =
        player.name;

      name.style.cssText =
        [
          "font-weight:600",
          "white-space:nowrap",
          "overflow:hidden",
          "text-overflow:ellipsis"
        ].join(";");

      const state =
        document.createElement(
          "div"
        );

      state.textContent =
        player.local
          ? "you"
          : "online";

      state.style.cssText =
        [
          "font-size:10px",
          "opacity:.5"
        ].join(";");

      info.appendChild(
        name
      );

      info.appendChild(
        state
      );

      row.appendChild(
        avatar
      );

      row.appendChild(
        info
      );

      container.appendChild(
        row
      );
    }
  }

  /* =========================================================
     PLAYER LIST PANEL
  ========================================================= */

  function createPlayerList() {
    if (
      document.getElementById(
        "connections-player-list"
      )
    ) {
      return;
    }

    const panel =
      document.getElementById(
        "connections-multiplayer-panel"
      );

    if (
      !panel
    ) {
      return;
    }

    const body =
      panel.querySelector(
        "div"
      );

    if (
      !body
    ) {
      return;
    }

    const title =
      document.createElement(
        "div"
      );

    title.textContent =
      "players";

    title.style.cssText =
      [
        "font-weight:700",
        "font-size:12px",
        "text-transform:uppercase",
        "opacity:.6",
        "margin-top:4px",
        "margin-bottom:7px"
      ].join(";");

    const list =
      document.createElement(
        "div"
      );

    list.id =
      "connections-player-list";

    list.style.cssText =
      [
        "max-height:160px",
        "overflow-y:auto",
        "margin-bottom:12px"
      ].join(";");

    body.appendChild(
      title
    );

    body.appendChild(
      list
    );

    renderPlayerList();
  }

  /* =========================================================
     REMOTE INTERPOLATION
  ========================================================= */

  function clonePosition(
    position
  ) {
    if (
      !position
    ) {
      return {
        x: 0,
        y: 0,
        z: 0
      };
    }

    return {
      x:
        Number(
          position.x
        ) || 0,

      y:
        Number(
          position.y
        ) || 0,

      z:
        Number(
          position.z
        ) || 0
    };
  }

  function cloneRotation(
    rotation
  ) {
    if (
      !rotation
    ) {
      return {
        yaw: 0,
        pitch: 0
      };
    }

    return {
      yaw:
        Number(
          rotation.yaw
        ) || 0,

      pitch:
        Number(
          rotation.pitch
        ) || 0
    };
  }

  function prepareRemoteInterpolation(
    remote,
    position,
    rotation
  ) {
    if (
      !remote
    ) {
      return;
    }

    const nextPosition =
      clonePosition(
        position
      );

    const nextRotation =
      cloneRotation(
        rotation
      );

    if (
      !remote.renderPosition
    ) {
      remote.renderPosition =
        clonePosition(
          nextPosition
        );
    }

    if (
      !remote.renderRotation
    ) {
      remote.renderRotation =
        cloneRotation(
          nextRotation
        );
    }

    remote.targetPosition =
      nextPosition;

    remote.targetRotation =
      nextRotation;
  }

  function interpolateNumber(
    current,
    target,
    amount
  ) {
    return (
      current +
      (
        target -
        current
      ) *
      amount
    );
  }

  function interpolateRemote(
    remote
  ) {
    if (
      !remote ||
      !remote.targetPosition ||
      !remote.targetRotation
    ) {
      return;
    }

    if (
      !remote.renderPosition
    ) {
      remote.renderPosition =
        clonePosition(
          remote.targetPosition
        );
    }

    if (
      !remote.renderRotation
    ) {
      remote.renderRotation =
        cloneRotation(
          remote.targetRotation
        );
    }

    const p =
      remote.renderPosition;

    const target =
      remote.targetPosition;

    const r =
      remote.renderRotation;

    const targetR =
      remote.targetRotation;

    const amount =
      0.35;

    p.x =
      interpolateNumber(
        p.x,
        target.x,
        amount
      );

    p.y =
      interpolateNumber(
        p.y,
        target.y,
        amount
      );

    p.z =
      interpolateNumber(
        p.z,
        target.z,
        amount
      );

    r.yaw =
      interpolateNumber(
        r.yaw,
        targetR.yaw,
        amount
      );

    r.pitch =
      interpolateNumber(
        r.pitch,
        targetR.pitch,
        amount
      );

    try {
      if (
        remote.bot
      ) {
        setPosition(
          remote.bot,
          p.x,
          p.y,
          p.z
        );

        setRotation(
          remote.bot,
          r.yaw,
          r.pitch
        );
      }
    } catch {}
  }

  function updateAllRemoteInterpolation() {
    try {
      for (
        const remote of
          State.remotes.values()
      ) {
        interpolateRemote(
          remote
        );
      }
    } catch {}
  }

  let interpolationFrame =
    null;

  function startInterpolation() {
    if (
      interpolationFrame
    ) {
      return;
    }

    const tick =
      () => {
        try {
          updateAllRemoteInterpolation();
        } catch {}

        interpolationFrame =
          requestAnimationFrame(
            tick
          );
      };

    interpolationFrame =
      requestAnimationFrame(
        tick
      );
  }

  function stopInterpolation() {
    if (
      interpolationFrame
    ) {
      cancelAnimationFrame(
        interpolationFrame
      );

      interpolationFrame =
        null;
    }
  }

  /* =========================================================
     PATCH REMOTE UPDATE
  ========================================================= */

  const originalUpdateRemote =
    updateRemote;

  updateRemote =
    function (
      data
    ) {
      originalUpdateRemote(
        data
      );

      if (
        !data ||
        !data.id ||
        data.id ===
          State.id
      ) {
        return;
      }

      const remote =
        State.remotes.get(
          data.id
        );

      if (
        !remote
      ) {
        return;
      }

      prepareRemoteInterpolation(
        remote,
        data.position ||
          remote.position,
        data.rotation ||
          remote.rotation
      );
    };

  /* =========================================================
     PATCH REMOTE CREATION
  ========================================================= */

  const originalSetupRemoteBot =
    setupRemoteBot;

  setupRemoteBot =
    function (
      remote
    ) {
      const bot =
        originalSetupRemoteBot(
          remote
        );

      if (
        remote
      ) {
        prepareRemoteInterpolation(
          remote,
          remote.position,
          remote.rotation
        );
      }

      return bot;
    };

  /* =========================================================
     PLAYER UI SYNC
  ========================================================= */

  setInterval(
    () => {
      try {
        renderPlayerList();
      } catch {}

      try {
        updateCurrentRoom();
      } catch {}
    },
    500
  );

  /* =========================================================
     ROOM JOIN RESET
  ========================================================= */

  function resetRoomState() {
    lastSentState =
      null;

    try {
      window.__connectionsChatLog =
        [];
    } catch {}

    destroyAllRemotes();

    updateUI();

    renderPlayerList();
    renderChat();
  }

  /* =========================================================
     PATCH ROOM ACTIONS
  ========================================================= */

  const originalJoinRoom =
    joinRoom;

  joinRoom =
    function (
      room
    ) {
      const result =
        originalJoinRoom(
          room
        );

      if (
        result
      ) {
        resetRoomState();
      }

      return result;
    };

  const originalLeaveRoom =
    leaveRoom;

  leaveRoom =
    function () {
      const result =
        originalLeaveRoom();

      if (
        result
      ) {
        resetRoomState();
      }

      return result;
    };

  /* =========================================================
     START RENDER SYSTEM
  ========================================================= */

  try {
    startInterpolation();
  } catch (e) {
    warn(
      "Interpolation startup failed:",
      e
    );
  }

  try {
    createPlayerList();
  } catch (e) {
    warn(
      "Player list creation failed:",
      e
    );
  }

  try {
    renderPlayerList();
  } catch {}

  /* =========================================================
     FINAL MULTIPLAYER READY EVENT
  ========================================================= */

  try {
    window.dispatchEvent(
      new CustomEvent(
        "connections:multiplayer-ready",
        {
          detail: {
            connected:
              State.connected,

            room:
              State.room,

            players:
              getPlayerList()
          }
        }
      )
    );
  } catch {}

  log(
    "Multiplayer player system ready."
  );
  /* =========================================================
     PLAYER AVATAR SYNC
  ========================================================= */

  function applyRemoteAvatar(
    remote
  ) {
    if (
      !remote ||
      !remote.bot
    ) {
      return;
    }

    const avatar =
      remote.avatar ||
      null;

    try {
      remote.bot.__connectionsAvatar =
        avatar;
    } catch {}

    try {
      if (
        typeof window.__connectionsApplyAvatar ===
        "function"
      ) {
        window.__connectionsApplyAvatar(
          remote.bot,
          avatar,
          remote
        );
      }
    } catch (e) {
      warn(
        "Remote avatar application failed:",
        e
      );
    }
  }

  function refreshRemoteAvatars() {
    try {
      for (
        const remote of
          State.remotes.values()
      ) {
        applyRemoteAvatar(
          remote
        );
      }
    } catch {}
  }

  /* =========================================================
     PATCH REMOTE DATA
  ========================================================= */

  function syncRemoteVisuals(
    remote
  ) {
    if (
      !remote
    ) {
      return;
    }

    try {
      if (
        remote.bot
      ) {
        remote.bot.__connectionsId =
          remote.id;

        remote.bot.__connectionsName =
          remote.name ||
          "Player";

        remote.bot.__connectionsAvatar =
          remote.avatar ||
          null;
      }
    } catch {}

    applyRemoteAvatar(
      remote
    );
  }

  const previousUpdateRemote =
    updateRemote;

  updateRemote =
    function (
      data
    ) {
      previousUpdateRemote(
        data
      );

      if (
        !data ||
        !data.id ||
        data.id ===
          State.id
      ) {
        return;
      }

      const remote =
        State.remotes.get(
          data.id
        );

      if (
        remote
      ) {
        syncRemoteVisuals(
          remote
        );
      }
    };

  /* =========================================================
     REMOTE CLEANUP
  ========================================================= */

  function cleanupInvalidRemotes() {
    const remove = [];

    try {
      for (
        const [
          id,
          remote
        ] of
          State.remotes.entries()
      ) {
        if (
          !remote ||
          !id
        ) {
          remove.push(
            id
          );

          continue;
        }

        if (
          remote.bot ===
          null
        ) {
          continue;
        }

        try {
          if (
            remote.bot.destroyed
          ) {
            remove.push(
              id
            );
          }
        } catch {}
      }
    } catch {}

    for (
      const id of
        remove
    ) {
      try {
        destroyRemote(
          id
        );
      } catch {}
    }
  }

  let cleanupInterval =
    null;

  function startRemoteCleanup() {
    if (
      cleanupInterval
    ) {
      return;
    }

    cleanupInterval =
      setInterval(
        () => {
          try {
            cleanupInvalidRemotes();
          } catch {}
        },
        2000
      );
  }

  function stopRemoteCleanup() {
    if (
      cleanupInterval
    ) {
      clearInterval(
        cleanupInterval
      );

      cleanupInterval =
        null;
    }
  }

  /* =========================================================
     ROOM STATE HANDLING
  ========================================================= */

  function handleRoomJoined(
    room,
    roomData
  ) {
    State.room =
      room ||
      null;

    State.roomData =
      roomData ||
      null;

    State.joinedRoom =
      true;

    lastSentState =
      null;

    destroyAllRemotes();

    try {
      requestRooms();
    } catch {}

    try {
      sendIdentity();
    } catch {}

    updateCurrentRoom();
    renderPlayerList();
  }

  function handleRoomLeft() {
    State.room =
      null;

    State.roomData =
      null;

    State.joinedRoom =
      false;

    lastSentState =
      null;

    destroyAllRemotes();

    try {
      window.__connectionsChatLog =
        [];
    } catch {}

    updateCurrentRoom();
    renderPlayerList();
    renderChat();
  }

  /* =========================================================
     ROOM MESSAGE PATCH
  ========================================================= */

  const previousHandleMessage =
    Network.handleMessage;

  Network.handleMessage =
    function (
      raw
    ) {
      let parsed =
        null;

      try {
        parsed =
          typeof raw ===
          "string"
            ? JSON.parse(
                raw
              )
            : raw;
      } catch {}

      if (
        parsed &&
        typeof parsed ===
          "object"
      ) {
        if (
          parsed.type ===
          "room_joined"
        ) {
          handleRoomJoined(
            parsed.room,
            parsed.data
          );
        }

        if (
          parsed.type ===
          "room_left"
        ) {
          handleRoomLeft();
        }

        if (
          parsed.type ===
          "player_join"
        ) {
          renderPlayerList();
        }

        if (
          parsed.type ===
          "player_leave"
        ) {
          renderPlayerList();
        }

        if (
          parsed.type ===
          "players"
        ) {
          setTimeout(
            () => {
              renderPlayerList();
              refreshRemoteAvatars();
            },
            0
          );
        }

        if (
          parsed.type ===
          "state" ||
          parsed.type ===
          "player_state"
        ) {
          setTimeout(
            () => {
              renderPlayerList();
            },
            0
          );
        }
      }

      return previousHandleMessage(
        raw
      );
    };

  /* =========================================================
     CONNECTION RECONNECT HANDLING
  ========================================================= */

  let reconnectTimer =
    null;

  function scheduleReconnect() {
    if (
      reconnectTimer
    ) {
      return;
    }

    reconnectTimer =
      setTimeout(
        () => {
          reconnectTimer =
            null;

          if (
            !State.connected &&
            !State.connecting
          ) {
            try {
              Network.connect();
            } catch {}
          }
        },
        3000
      );
  }

  function monitorConnection() {
    if (
      State.connected
    ) {
      return;
    }

    if (
      State.connecting
    ) {
      return;
    }

    scheduleReconnect();
  }

  let connectionMonitor =
    setInterval(
      () => {
        try {
          monitorConnection();
        } catch {}
      },
      5000
    );

  /* =========================================================
     WINDOW VISIBILITY
  ========================================================= */

  document.addEventListener(
    "visibilitychange",
    () => {
      if (
        document.hidden
      ) {
        return;
      }

      try {
        if (
          State.connected &&
          State.joinedRoom
        ) {
          lastSentState =
            null;

          sendLocalState();

          sendIdentity();
        }
      } catch {}
    }
  );

  /* =========================================================
     PAGE UNLOAD
  ========================================================= */

  function shutdownConnections() {
    try {
      stopStateSync();
    } catch {}

    try {
      stopRemoteRefresh();
    } catch {}

    try {
      stopInterpolation();
    } catch {}

    try {
      stopRemoteCleanup();
    } catch {}

    try {
      if (
        connectionMonitor
      ) {
        clearInterval(
          connectionMonitor
        );

        connectionMonitor =
          null;
      }
    } catch {}

    try {
      if (
        reconnectTimer
      ) {
        clearTimeout(
          reconnectTimer
        );

        reconnectTimer =
          null;
      }
    } catch {}

    try {
      destroyAllRemotes();
    } catch {}
  }

  window.addEventListener(
    "beforeunload",
    () => {
      shutdownConnections();
    }
  );

  window.addEventListener(
    "pagehide",
    () => {
      shutdownConnections();
    }
  );

  /* =========================================================
     START CLEANUP
  ========================================================= */

  try {
    startRemoteCleanup();
  } catch (e) {
    warn(
      "Remote cleanup startup failed:",
      e
    );
  }

  /* =========================================================
     FINAL API EXTENSIONS
  ========================================================= */

  try {
    if (
      window.Connections
    ) {
      window.Connections.players =
        () => {
          return getPlayerList();
        };

      window.Connections.remotes =
        () => {
          return Array.from(
            State.remotes.values()
          );
        };

      window.Connections.chat =
        message => {
          return sendChat(
            message
          );
        };

      window.Connections.openChat =
        () => {
          toggleChat(
            true
          );
        };

      window.Connections.closeChat =
        () => {
          toggleChat(
            false
          );
        };

      window.Connections.openIdentity =
        () => {
          toggleIdentity(
            true
          );
        };

      window.Connections.closeIdentity =
        () => {
          toggleIdentity(
            false
          );
        };

      window.Connections.multiplayer =
        () => {
          toggleMultiplayerPanel(
            true
          );
        };
    }
  } catch (e) {
    warn(
      "API extension failed:",
      e
    );
  }

  /* =========================================================
     FINAL STATUS
  ========================================================= */

  try {
    updateUI();
    updateCurrentRoom();
    renderPlayerList();
    renderChat();
    refreshRemoteAvatars();
  } catch {}

  log(
    "Connections multiplayer layer fully initialized."
  );
  /* =========================================================
     MULTIPLAYER EVENT BUS
  ========================================================= */

  const MultiplayerEvents = {
    listeners: new Map(),

    on(
      event,
      callback
    ) {
      if (
        typeof callback !==
        "function"
      ) {
        return () => {};
      }

      if (
        !this.listeners.has(
          event
        )
      ) {
        this.listeners.set(
          event,
          new Set()
        );
      }

      const set =
        this.listeners.get(
          event
        );

      set.add(
        callback
      );

      return () => {
        set.delete(
          callback
        );
      };
    },

    emit(
      event,
      data
    ) {
      const set =
        this.listeners.get(
          event
        );

      if (
        !set
      ) {
        return;
      }

      for (
        const callback of
          Array.from(set)
      ) {
        try {
          callback(
            data
          );
        } catch (e) {
          warn(
            "Multiplayer event error:",
            event,
            e
          );
        }
      }
    },

    clear(
      event
    ) {
      if (
        event ===
        undefined
      ) {
        this.listeners.clear();
        return;
      }

      this.listeners.delete(
        event
      );
    }
  };

  /* =========================================================
     NETWORK EVENT EMISSION
  ========================================================= */

  function emitNetworkEvent(
    event,
    data
  ) {
    try {
      MultiplayerEvents.emit(
        event,
        data
      );
    } catch {}
  }

  /* =========================================================
     CONNECTION STATE EVENTS
  ========================================================= */

  emitNetworkEvent(
    "initialized",
    {
      id:
        State.id,

      connected:
        State.connected
    }
  );

  /* =========================================================
     PLAYER STATE HELPERS
  ========================================================= */

  function getPlayerById(
    id
  ) {
    if (
      !id
    ) {
      return null;
    }

    if (
      id ===
      State.id
    ) {
      return {
        id:
          State.id,

        name:
          State.name,

        avatar:
          State.localAvatar,

        local:
          true
      };
    }

    try {
      return (
        State.remotes.get(
          id
        ) ||
        null
      );
    } catch {
      return null;
    }
  }

  function hasPlayer(
    id
  ) {
    return !!getPlayerById(
      id
    );
  }

  /* =========================================================
     PLAYER EVENTS
  ========================================================= */

  function notifyPlayerJoin(
    player
  ) {
    if (
      !player ||
      !player.id
    ) {
      return;
    }

    emitNetworkEvent(
      "playerJoin",
      player
    );

    emitNetworkEvent(
      "player_join",
      player
    );
  }

  function notifyPlayerLeave(
    id
  ) {
    if (
      !id
    ) {
      return;
    }

    emitNetworkEvent(
      "playerLeave",
      {
        id
      }
    );

    emitNetworkEvent(
      "player_leave",
      {
        id
      }
    );
  }

  function notifyPlayerState(
    player
  ) {
    if (
      !player ||
      !player.id
    ) {
      return;
    }

    emitNetworkEvent(
      "playerState",
      player
    );

    emitNetworkEvent(
      "player_state",
      player
    );
  }

  /* =========================================================
     MESSAGE EVENT PATCH
  ========================================================= */

  const eventHandleMessage =
    Network.handleMessage;

  Network.handleMessage =
    function (
      raw
    ) {
      let data =
        null;

      try {
        data =
          typeof raw ===
          "string"
            ? JSON.parse(
                raw
              )
            : raw;
      } catch {}

      if (
        data &&
        typeof data ===
          "object"
      ) {
        switch (
          data.type
        ) {
          case "welcome":
            emitNetworkEvent(
              "connected",
              data
            );
            break;

          case "rooms":
            emitNetworkEvent(
              "rooms",
              data.rooms ||
                []
            );
            break;

          case "room_joined":
            emitNetworkEvent(
              "roomJoined",
              data
            );
            break;

          case "room_left":
            emitNetworkEvent(
              "roomLeft",
              data
            );
            break;

          case "player_join":
            if (
              data.player
            ) {
              notifyPlayerJoin(
                data.player
              );
            }
            break;

          case "player_leave":
            notifyPlayerLeave(
              data.id
            );
            break;

          case "state":
          case "player_state":
            if (
              data.player
            ) {
              notifyPlayerState(
                data.player
              );
            } else if (
              data.id
            ) {
              notifyPlayerState(
                data
              );
            }
            break;

          case "chat":
            emitNetworkEvent(
              "chat",
              data.message ||
                data
            );
            break;

          case "error":
            emitNetworkEvent(
              "error",
              data
            );
            break;
        }
      }

      return eventHandleMessage(
        raw
      );
    };

  /* =========================================================
     PUBLIC EVENT API
  ========================================================= */

  try {
    if (
      window.Connections
    ) {
      window.Connections.on =
        (
          event,
          callback
        ) => {
          return MultiplayerEvents.on(
            event,
            callback
          );
        };

      window.Connections.off =
        (
          event,
          callback
        ) => {
          const set =
            MultiplayerEvents.listeners.get(
              event
            );

          if (
            !set
          ) {
            return;
          }

          set.delete(
            callback
          );
        };

      window.Connections.emit =
        (
          event,
          data
        ) => {
          MultiplayerEvents.emit(
            event,
            data
          );
        };

      window.Connections.getPlayer =
        id => {
          return getPlayerById(
            id
          );
        };

      window.Connections.hasPlayer =
        id => {
          return hasPlayer(
            id
          );
        };
    }
  } catch (e) {
    warn(
      "Could not expose event API:",
      e
    );
  }

  /* =========================================================
     ROOM PLAYER SNAPSHOT
  ========================================================= */

  function getRoomSnapshot() {
    const players =
      getPlayerList();

    return {
      room:
        State.room ||
        null,

      joined:
        !!State.joinedRoom,

      connected:
        !!State.connected,

      playerCount:
        players.length,

      players:
        players
    };
  }

  function emitRoomSnapshot() {
    emitNetworkEvent(
      "snapshot",
      getRoomSnapshot()
    );
  }

  setInterval(
    () => {
      try {
        emitRoomSnapshot();
      } catch {}
    },
    1000
  );

  /* =========================================================
     LOCAL STATE SNAPSHOT
  ========================================================= */

  function getLocalSnapshot() {
    const transform =
      readLocalTransform();

    return {
      id:
        State.id,

      name:
        State.name,

      avatar:
        State.localAvatar,

      position:
        transform.position,

      rotation:
        transform.rotation,

      room:
        State.room,

      connected:
        State.connected,

      joined:
        State.joinedRoom
    };
  }

  try {
    window.Connections.getLocal =
      () => {
        return getLocalSnapshot();
      };
  } catch {}

  /* =========================================================
     DEBUG INFORMATION
  ========================================================= */

  function getDebugInfo() {
    return {
      connected:
        !!State.connected,

      connecting:
        !!State.connecting,

      id:
        State.id,

      name:
        State.name,

      room:
        State.room,

      joinedRoom:
        !!State.joinedRoom,

      rooms:
        Array.isArray(
          State.rooms
        )
          ? State.rooms.length
          : 0,

      remotes:
        State.remotes
          ? State.remotes.size
          : 0,

      remoteBots:
        State.remoteBots
          ? State.remoteBots.size
          : 0
    };
  }

  try {
    window.Connections.debug =
      () => {
        const info =
          getDebugInfo();

        log(
          "Debug:",
          info
        );

        return info;
      };
  } catch {}

  /* =========================================================
     DEBUG COMMANDS
  ========================================================= */

  function debugDumpPlayers() {
    const players =
      getPlayerList();

    log(
      "Players:",
      players
    );

    return players;
  }

  function debugDumpRemotes() {
    const remotes =
      Array.from(
        State.remotes.values()
      );

    log(
      "Remotes:",
      remotes
    );

    return remotes;
  }

  try {
    window.Connections.dumpPlayers =
      debugDumpPlayers;

    window.Connections.dumpRemotes =
      debugDumpRemotes;
  } catch {}

  /* =========================================================
     FINAL MULTIPLAYER HOOK
  ========================================================= */

  try {
    window.dispatchEvent(
      new CustomEvent(
        "connections:network-ready",
        {
          detail: {
            state:
              getDebugInfo(),

            players:
              getPlayerList()
          }
        }
      )
    );
  } catch {}

  log(
    "Connections network event system ready."
  );
  /* =========================================================
     SERVER HEARTBEAT
  ========================================================= */

  let heartbeatInterval =
    null;

  function sendHeartbeat() {
    if (
      !State.connected
    ) {
      return;
    }

    Network.send({
      type:
        "heartbeat",

      id:
        State.id,

      timestamp:
        Date.now()
    });
  }

  function startHeartbeat() {
    if (
      heartbeatInterval
    ) {
      return;
    }

    heartbeatInterval =
      setInterval(
        () => {
          try {
            sendHeartbeat();
          } catch (e) {
            warn(
              "Heartbeat failed:",
              e
            );
          }
        },
        10000
      );
  }

  function stopHeartbeat() {
    if (
      heartbeatInterval
    ) {
      clearInterval(
        heartbeatInterval
      );

      heartbeatInterval =
        null;
    }
  }

  /* =========================================================
     CONNECTION HEALTH
  ========================================================= */

  let lastServerActivity =
    Date.now();

  function markServerActivity() {
    lastServerActivity =
      Date.now();
  }

  function getConnectionAge() {
    return (
      Date.now() -
      lastServerActivity
    );
  }

  function isConnectionHealthy() {
    if (
      !State.connected
    ) {
      return false;
    }

    return (
      getConnectionAge() <
      30000
    );
  }

  /* =========================================================
     NETWORK MESSAGE ACTIVITY
  ========================================================= */

  const previousNetworkHandler =
    Network.handleMessage;

  Network.handleMessage =
    function (
      raw
    ) {
      markServerActivity();

      return previousNetworkHandler(
        raw
      );
    };

  /* =========================================================
     CONNECTION HEALTH MONITOR
  ========================================================= */

  let healthInterval =
    null;

  function startHealthMonitor() {
    if (
      healthInterval
    ) {
      return;
    }

    healthInterval =
      setInterval(
        () => {
          try {
            if (
              State.connected &&
              !isConnectionHealthy()
            ) {
              warn(
                "Multiplayer connection appears stale."
              );

              try {
                if (
                  State.ws
                ) {
                  State.ws.close();
                }
              } catch {}
            }
          } catch {}
        },
        5000
      );
  }

  function stopHealthMonitor() {
    if (
      healthInterval
    ) {
      clearInterval(
        healthInterval
      );

      healthInterval =
        null;
    }
  }

  /* =========================================================
     PLAYER POSITION VALIDATION
  ========================================================= */

  function validNumber(
    value
  ) {
    return (
      typeof value ===
        "number" &&
      Number.isFinite(
        value
      )
    );
  }

  function validPosition(
    position
  ) {
    if (
      !position ||
      typeof position !==
        "object"
    ) {
      return false;
    }

    return (
      validNumber(
        Number(position.x)
      ) &&
      validNumber(
        Number(position.y)
      ) &&
      validNumber(
        Number(position.z)
      )
    );
  }

  function validRotation(
    rotation
  ) {
    if (
      !rotation ||
      typeof rotation !==
        "object"
    ) {
      return false;
    }

    return (
      validNumber(
        Number(rotation.yaw)
      ) &&
      validNumber(
        Number(rotation.pitch)
      )
    );
  }

  function sanitizePosition(
    position
  ) {
    if (
      !validPosition(
        position
      )
    ) {
      return {
        x: 0,
        y: 0,
        z: 0
      };
    }

    return {
      x:
        Number(
          position.x
        ),

      y:
        Number(
          position.y
        ),

      z:
        Number(
          position.z
        )
    };
  }

  function sanitizeRotation(
    rotation
  ) {
    if (
      !validRotation(
        rotation
      )
    ) {
      return {
        yaw: 0,
        pitch: 0
      };
    }

    return {
      yaw:
        Number(
          rotation.yaw
        ),

      pitch:
        Number(
          rotation.pitch
        )
    };
  }

  /* =========================================================
     REMOTE STATE SANITIZATION
  ========================================================= */

  function sanitizeRemoteData(
    data
  ) {
    if (
      !data ||
      typeof data !==
        "object"
    ) {
      return null;
    }

    if (
      !data.id
    ) {
      return null;
    }

    if (
      data.id ===
      State.id
    ) {
      return null;
    }

    const result = {
      id:
        String(
          data.id
        ),

      name:
        String(
          data.name ||
          "Player"
        ).slice(
          0,
          32
        ),

      avatar:
        data.avatar ||
        null,

      position:
        sanitizePosition(
          data.position
        ),

      rotation:
        sanitizeRotation(
          data.rotation
        )
    };

    return result;
  }

  /* =========================================================
     SAFE REMOTE UPDATE
  ========================================================= */

  function safelyUpdateRemote(
    data
  ) {
    const sanitized =
      sanitizeRemoteData(
        data
      );

    if (
      !sanitized
    ) {
      return null;
    }

    try {
      updateRemote(
        sanitized
      );
    } catch (e) {
      warn(
        "Remote update failed:",
        e
      );

      return null;
    }

    return (
      State.remotes.get(
        sanitized.id
      ) ||
      null
    );
  }

  /* =========================================================
     REMOTE MESSAGE FILTER
  ========================================================= */

  function shouldAcceptRemote(
    data
  ) {
    if (
      !data ||
      !data.id
    ) {
      return false;
    }

    if (
      data.id ===
      State.id
    ) {
      return false;
    }

    if (
      !State.joinedRoom
    ) {
      return false;
    }

    return true;
  }

  /* =========================================================
     PATCH STATE PROCESSING
  ========================================================= */

  const previousStateHandler =
    Network.handleMessage;

  Network.handleMessage =
    function (
      raw
    ) {
      let data =
        null;

      try {
        data =
          typeof raw ===
          "string"
            ? JSON.parse(
                raw
              )
            : raw;
      } catch {}

      if (
        data &&
        (
          data.type ===
            "state" ||
          data.type ===
            "player_state"
        )
      ) {
        const player =
          data.player ||
          data;

        if (
          shouldAcceptRemote(
            player
          )
        ) {
          safelyUpdateRemote(
            player
          );
        }

        return;
      }

      return previousStateHandler(
        raw
      );
    };

  /* =========================================================
     ROOM SNAPSHOT REQUEST
  ========================================================= */

  function requestRoomSnapshot() {
    if (
      !State.connected ||
      !State.joinedRoom
    ) {
      return false;
    }

    return Network.send({
      type:
        "room_state",

      room:
        State.room
    });
  }

  /* =========================================================
     PERIODIC ROOM SYNC
  ========================================================= */

  let roomSyncInterval =
    null;

  function startRoomSync() {
    if (
      roomSyncInterval
    ) {
      return;
    }

    roomSyncInterval =
      setInterval(
        () => {
          try {
            if (
              State.connected &&
              State.joinedRoom
            ) {
              requestRoomSnapshot();
            }
          } catch {}
        },
        5000
      );
  }

  function stopRoomSync() {
    if (
      roomSyncInterval
    ) {
      clearInterval(
        roomSyncInterval
      );

      roomSyncInterval =
        null;
    }
  }

  /* =========================================================
     MULTIPLAYER STARTUP EXTENSIONS
  ========================================================= */

  try {
    startHeartbeat();
  } catch (e) {
    warn(
      "Heartbeat startup failed:",
      e
    );
  }

  try {
    startHealthMonitor();
  } catch (e) {
    warn(
      "Health monitor startup failed:",
      e
    );
  }

  try {
    startRoomSync();
  } catch (e) {
    warn(
      "Room sync startup failed:",
      e
    );
  }

  /* =========================================================
     SHUTDOWN EXTENSIONS
  ========================================================= */

  const previousShutdown =
    shutdownConnections;

  shutdownConnections =
    function () {
      try {
        stopHeartbeat();
      } catch {}

      try {
        stopHealthMonitor();
      } catch {}

      try {
        stopRoomSync();
      } catch {}

      try {
        previousShutdown();
      } catch {}
    };

  /* =========================================================
     EXTENDED PUBLIC API
  ========================================================= */

  try {
    if (
      window.Connections
    ) {
      window.Connections.heartbeat =
        () => {
          sendHeartbeat();
        };

      window.Connections.health =
        () => {
          return {
            connected:
              State.connected,

            healthy:
              isConnectionHealthy(),

            lastActivity:
              lastServerActivity,

            age:
              getConnectionAge()
          };
        };

      window.Connections.snapshot =
        () => {
          return getRoomSnapshot();
        };

      window.Connections.syncRoom =
        () => {
          return requestRoomSnapshot();
        };
    }
  } catch (e) {
    warn(
      "Extended API setup failed:",
      e
    );
  }

  /* =========================================================
     FINAL READY CHECK
  ========================================================= */

  try {
    updateUI();
    updateCurrentRoom();
    renderPlayerList();
    refreshRemoteAvatars();
  } catch {}

  log(
    "Connections synchronization layer ready."
  );
  /* =========================================================
     MULTIPLAYER RATE LIMITING
  ========================================================= */

  const NetworkRate = {
    lastState:
      0,

    lastChat:
      0,

    lastRoomRequest:
      0,

    stateInterval:
      50,

    chatInterval:
      250,

    roomInterval:
      500,

    canState() {
      const now =
        Date.now();

      if (
        now -
          this.lastState <
        this.stateInterval
      ) {
        return false;
      }

      this.lastState =
        now;

      return true;
    },

    canChat() {
      const now =
        Date.now();

      if (
        now -
          this.lastChat <
        this.chatInterval
      ) {
        return false;
      }

      this.lastChat =
        now;

      return true;
    },

    canRoomRequest() {
      const now =
        Date.now();

      if (
        now -
          this.lastRoomRequest <
        this.roomInterval
      ) {
        return false;
      }

      this.lastRoomRequest =
        now;

      return true;
    }
  };

  /* =========================================================
     SAFE NETWORK SEND
  ========================================================= */

  function safeNetworkSend(
    packet
  ) {
    if (
      !packet ||
      typeof packet !==
        "object"
    ) {
      return false;
    }

    if (
      !State.connected
    ) {
      return false;
    }

    try {
      return Network.send(
        packet
      );
    } catch (e) {
      warn(
        "Network send failed:",
        e
      );

      return false;
    }
  }

  /* =========================================================
     SAFE CHAT SEND
  ========================================================= */

  function safeSendChat(
    message
  ) {
    if (
      !NetworkRate.canChat()
    ) {
      return false;
    }

    if (
      typeof message !==
      "string"
    ) {
      return false;
    }

    message =
      message
        .trim()
        .slice(
          0,
          256
        );

    if (
      !message
    ) {
      return false;
    }

    return safeNetworkSend({
      type:
        "chat",

      message:
        message
    });
  }

  /* =========================================================
     PATCH CHAT
  ========================================================= */

  const previousSendChat =
    sendChat;

  sendChat =
    function (
      message
    ) {
      return safeSendChat(
        message
      );
    };

  /* =========================================================
     LOCAL STATE PACKET
  ========================================================= */

  function buildLocalStatePacket() {
    const transform =
      readLocalTransform();

    return {
      type:
        "state",

      id:
        State.id,

      name:
        State.name,

      avatar:
        State.localAvatar,

      position:
        sanitizePosition(
          transform.position
        ),

      rotation:
        sanitizeRotation(
          transform.rotation
        ),

      timestamp:
        Date.now()
    };
  }

  /* =========================================================
     STATE TRANSMISSION
  ========================================================= */

  function transmitLocalState() {
    if (
      !State.connected ||
      !State.joinedRoom
    ) {
      return false;
    }

    if (
      !NetworkRate.canState()
    ) {
      return false;
    }

    const packet =
      buildLocalStatePacket();

    return safeNetworkSend(
      packet
    );
  }

  /* =========================================================
     STATE LOOP
  ========================================================= */

  let stateTransmitTimer =
    null;

  function startStateTransmission() {
    if (
      stateTransmitTimer
    ) {
      return;
    }

    stateTransmitTimer =
      setInterval(
        () => {
          try {
            transmitLocalState();
          } catch (e) {
            warn(
              "State transmission error:",
              e
            );
          }
        },
        50
      );
  }

  function stopStateTransmission() {
    if (
      stateTransmitTimer
    ) {
      clearInterval(
        stateTransmitTimer
      );

      stateTransmitTimer =
        null;
    }
  }

  /* =========================================================
     ROOM REQUEST WRAPPERS
  ========================================================= */

  function safeRequestRooms() {
    if (
      !NetworkRate.canRoomRequest()
    ) {
      return false;
    }

    if (
      !State.connected
    ) {
      return false;
    }

    try {
      return requestRooms();
    } catch (e) {
      warn(
        "Room request failed:",
        e
      );

      return false;
    }
  }

  function safeCreateRoom(
    name
  ) {
    if (
      !State.connected
    ) {
      return false;
    }

    if (
      typeof name !==
      "string"
    ) {
      name =
        "Room";
    }

    name =
      name
        .trim()
        .slice(
          0,
          32
        );

    if (
      !name
    ) {
      name =
        "Room";
    }

    return Network.send({
      type:
        "room_create",

      name:
        name
    });
  }

  function safeJoinRoom(
    roomId
  ) {
    if (
      !State.connected
    ) {
      return false;
    }

    if (
      !roomId
    ) {
      return false;
    }

    return Network.send({
      type:
        "room_join",

      room:
        String(
          roomId
        )
    });
  }

  function safeLeaveRoom() {
    if (
      !State.connected ||
      !State.joinedRoom
    ) {
      return false;
    }

    return Network.send({
      type:
        "room_leave"
    });
  }

  /* =========================================================
     PUBLIC NETWORK API
  ========================================================= */

  try {
    if (
      window.Connections
    ) {
      window.Connections.send =
        safeNetworkSend;

      window.Connections.sendChat =
        safeSendChat;

      window.Connections.sendState =
        transmitLocalState;

      window.Connections.requestRooms =
        safeRequestRooms;

      window.Connections.createRoom =
        safeCreateRoom;

      window.Connections.joinRoom =
        safeJoinRoom;

      window.Connections.leaveRoom =
        safeLeaveRoom;
    }
  } catch (e) {
    warn(
      "Could not expose network API:",
      e
    );
  }

  /* =========================================================
     CONNECTION LIFECYCLE
  ========================================================= */

  function handleMultiplayerConnected() {
    lastServerActivity =
      Date.now();

    try {
      startHeartbeat();
    } catch {}

    try {
      startHealthMonitor();
    } catch {}

    try {
      startStateTransmission();
    } catch {}

    try {
      startRoomSync();
    } catch {}

    try {
      safeRequestRooms();
    } catch {}

    emitNetworkEvent(
      "connectionReady",
      {
        id:
          State.id,

        name:
          State.name
      }
    );
  }

  function handleMultiplayerDisconnected() {
    stopStateTransmission();

    stopRoomSync();

    emitNetworkEvent(
      "connectionLost",
      {
        id:
          State.id
      }
    );
  }

  /* =========================================================
     CONNECTION STATE MONITOR
  ========================================================= */

  let previousConnected =
    !!State.connected;

  setInterval(
    () => {
      try {
        const connected =
          !!State.connected;

        if (
          connected &&
          !previousConnected
        ) {
          handleMultiplayerConnected();
        }

        if (
          !connected &&
          previousConnected
        ) {
          handleMultiplayerDisconnected();
        }

        previousConnected =
          connected;
      } catch {}
    },
    250
  );

  /* =========================================================
     VISIBILITY NETWORK CONTROL
  ========================================================= */

  document.addEventListener(
    "visibilitychange",
    () => {
      if (
        document.hidden
      ) {
        stopStateTransmission();

        return;
      }

      if (
        State.connected &&
        State.joinedRoom
      ) {
        startStateTransmission();

        try {
          transmitLocalState();
        } catch {}
      }
    }
  );

  /* =========================================================
     ROOM JOIN STATE SYNC
  ========================================================= */

  MultiplayerEvents.on(
    "roomJoined",
    () => {
      try {
        resetRoomState();
      } catch {}

      try {
        startStateTransmission();
      } catch {}

      try {
        requestRoomSnapshot();
      } catch {}

      try {
        transmitLocalState();
      } catch {}
    }
  );

  MultiplayerEvents.on(
    "roomLeft",
    () => {
      stopStateTransmission();

      try {
        destroyAllRemotes();
      } catch {}

      try {
        renderPlayerList();
      } catch {}
    }
  );

  /* =========================================================
     PLAYER JOIN SYNC
  ========================================================= */

  MultiplayerEvents.on(
    "playerJoin",
    player => {
      if (
        !player ||
        !player.id
      ) {
        return;
      }

      try {
        safelyUpdateRemote(
          player
        );
      } catch {}

      try {
        renderPlayerList();
      } catch {}

      try {
        syncRemoteVisuals();
      } catch {}
    }
  );

  /* =========================================================
     PLAYER LEAVE SYNC
  ========================================================= */

  MultiplayerEvents.on(
    "playerLeave",
    data => {
      if (
        !data ||
        !data.id
      ) {
        return;
      }

      try {
        destroyRemote(
          data.id
        );
      } catch {}

      try {
        renderPlayerList();
      } catch {}
    }
  );

  /* =========================================================
     PLAYER STATE SYNC
  ========================================================= */

  MultiplayerEvents.on(
    "playerState",
    player => {
      if (
        !player ||
        !player.id
      ) {
        return;
      }

      try {
        safelyUpdateRemote(
          player
        );
      } catch {}
    }
  );

  /* =========================================================
     CHAT EVENT SYNC
  ========================================================= */

  MultiplayerEvents.on(
    "chat",
    message => {
      try {
        if (
          typeof message ===
          "string"
        ) {
          addChatMessage(
            "Server",
            message
          );
        } else if (
          message &&
          typeof message ===
            "object"
        ) {
          addChatMessage(
            message.name ||
              "Player",

            message.message ||
              ""
          );
        }
      } catch {}
    }
  );

  /* =========================================================
     DEBUG NETWORK STATUS
  ========================================================= */

  function networkStatus() {
    return {
      connected:
        !!State.connected,

      connecting:
        !!State.connecting,

      joined:
        !!State.joinedRoom,

      room:
        State.room ||
        null,

      playerCount:
        getPlayerList()
          .length,

      remotes:
        State.remotes
          ? State.remotes.size
          : 0,

      healthy:
        isConnectionHealthy()
    };
  }

  try {
    window.Connections.networkStatus =
      networkStatus;
  } catch {}

  /* =========================================================
     START STATE TRANSMISSION
  ========================================================= */

  try {
    if (
      State.connected &&
      State.joinedRoom
    ) {
      startStateTransmission();
    }
  } catch {}

  /* =========================================================
     FINAL SYNC CHECK
  ========================================================= */

  try {
    renderPlayerList();
  } catch {}

  try {
    updateCurrentRoom();
  } catch {}

  try {
    updateUI();
  } catch {}

  log(
    "Connections multiplayer transmission layer ready."
  );
  /* =========================================================
     PLAYER INTERPOLATION TUNING
  ========================================================= */

  const InterpolationConfig = {
    enabled:
      true,

    delay:
      75,

    speed:
      12,

    teleportDistance:
      8,

    snapDistance:
      30
  };

  function setInterpolationEnabled(
    enabled
  ) {
    InterpolationConfig.enabled =
      !!enabled;
  }

  function setInterpolationDelay(
    delay
  ) {
    const value =
      Number(
        delay
      );

    if (
      !Number.isFinite(
        value
      )
    ) {
      return;
    }

    InterpolationConfig.delay =
      Math.max(
        0,
        Math.min(
          500,
          value
        )
      );
  }

  function setInterpolationSpeed(
    speed
  ) {
    const value =
      Number(
        speed
      );

    if (
      !Number.isFinite(
        value
      )
    ) {
      return;
    }

    InterpolationConfig.speed =
      Math.max(
        1,
        Math.min(
          60,
          value
        )
      );
  }

  /* =========================================================
     VECTOR DISTANCE
  ========================================================= */

  function distanceBetween(
    a,
    b
  ) {
    if (
      !a ||
      !b
    ) {
      return Infinity;
    }

    const dx =
      Number(
        a.x
      ) -
      Number(
        b.x
      );

    const dy =
      Number(
        a.y
      ) -
      Number(
        b.y
      );

    const dz =
      Number(
        a.z
      ) -
      Number(
        b.z
      );

    return Math.sqrt(
      dx * dx +
      dy * dy +
      dz * dz
    );
  }

  /* =========================================================
     REMOTE INTERPOLATION TARGET
  ========================================================= */

  function setRemoteTarget(
    remote,
    position,
    rotation
  ) {
    if (
      !remote
    ) {
      return;
    }

    const targetPosition =
      sanitizePosition(
        position
      );

    const targetRotation =
      sanitizeRotation(
        rotation
      );

    if (
      !remote.__connectionsInterpolation
    ) {
      remote.__connectionsInterpolation =
        {
          current:
            {
              ...targetPosition
            },

          target:
            {
              ...targetPosition
            },

          currentRotation:
            {
              ...targetRotation
            },

          targetRotation:
            {
              ...targetRotation
            },

          timestamp:
            Date.now()
        };

      return;
    }

    const interpolation =
      remote.__connectionsInterpolation;

    const current =
      interpolation.current;

    const distance =
      distanceBetween(
        current,
        targetPosition
      );

    if (
      distance >
      InterpolationConfig.snapDistance
    ) {
      interpolation.current =
        {
          ...targetPosition
        };
    }

    interpolation.target =
      {
        ...targetPosition
      };

    interpolation.targetRotation =
      {
        ...targetRotation
      };

    interpolation.timestamp =
      Date.now();
  }

  /* =========================================================
     INTERPOLATION MATH
  ========================================================= */

  function lerp(
    a,
    b,
    t
  ) {
    return (
      a +
      (
        b -
        a
      ) *
      t
    );
  }

  function lerpPosition(
    current,
    target,
    alpha
  ) {
    return {
      x:
        lerp(
          current.x,
          target.x,
          alpha
        ),

      y:
        lerp(
          current.y,
          target.y,
          alpha
        ),

      z:
        lerp(
          current.z,
          target.z,
          alpha
        )
    };
  }

  function lerpRotation(
    current,
    target,
    alpha
  ) {
    return {
      yaw:
        lerpAngle(
          current.yaw,
          target.yaw,
          alpha
        ),

      pitch:
        lerp(
          current.pitch,
          target.pitch,
          alpha
        )
    };
  }

  function lerpAngle(
    a,
    b,
    t
  ) {
    let difference =
      b -
      a;

    while (
      difference >
      180
    ) {
      difference -=
        360;
    }

    while (
      difference <
      -180
    ) {
      difference +=
        360;
    }

    return (
      a +
      difference *
        t
    );
  }

  /* =========================================================
     APPLY REMOTE TRANSFORM
  ========================================================= */

  function applyRemoteTransform(
    remote,
    position,
    rotation
  ) {
    if (
      !remote
    ) {
      return;
    }

    const bot =
      remote.bot ||
      remote.object ||
      remote.gameObject ||
      remote;

    if (
      !bot
    ) {
      return;
    }

    try {
      if (
        bot.transform
      ) {
        if (
          bot.transform.position
        ) {
          bot.transform.position =
            position;
        }

        if (
          bot.transform.rotation
        ) {
          bot.transform.rotation =
            rotation;
        }

        return;
      }
    } catch {}

    try {
      if (
        typeof bot.setPosition ===
        "function"
      ) {
        bot.setPosition(
          position
        );
      }
    } catch {}

    try {
      if (
        typeof bot.setRotation ===
        "function"
      ) {
        bot.setRotation(
          rotation
        );
      }
    } catch {}
  }

  /* =========================================================
     REMOTE INTERPOLATION UPDATE
  ========================================================= */

  function updateRemoteInterpolation(
    remote
  ) {
    if (
      !remote ||
      !remote.__connectionsInterpolation
    ) {
      return;
    }

    if (
      !InterpolationConfig.enabled
    ) {
      return;
    }

    const interpolation =
      remote.__connectionsInterpolation;

    const current =
      interpolation.current;

    const target =
      interpolation.target;

    const currentRotation =
      interpolation.currentRotation;

    const targetRotation =
      interpolation.targetRotation;

    const alpha =
      Math.min(
        1,
        InterpolationConfig.speed *
          0.016
      );

    const nextPosition =
      lerpPosition(
        current,
        target,
        alpha
      );

    const nextRotation =
      lerpRotation(
        currentRotation,
        targetRotation,
        alpha
      );

    interpolation.current =
      nextPosition;

    interpolation.currentRotation =
      nextRotation;

    applyRemoteTransform(
      remote,
      nextPosition,
      nextRotation
    );
  }

  /* =========================================================
     UPDATE ALL REMOTES
  ========================================================= */

  function updateRemoteInterpolations() {
    if (
      !State.remotes
    ) {
      return;
    }

    for (
      const remote of
        State.remotes.values()
    ) {
      try {
        updateRemoteInterpolation(
          remote
        );
      } catch (e) {
        warn(
          "Remote interpolation error:",
          e
        );
      }
    }
  }

  /* =========================================================
     INTERPOLATION LOOP
  ========================================================= */

  let interpolationFrame =
    null;

  function interpolationLoop() {
    try {
      updateRemoteInterpolations();
    } catch {}

    interpolationFrame =
      requestAnimationFrame(
        interpolationLoop
      );
  }

  function startInterpolationLoop() {
    if (
      interpolationFrame !==
      null
    ) {
      return;
    }

    interpolationFrame =
      requestAnimationFrame(
        interpolationLoop
      );
  }

  function stopInterpolationLoop() {
    if (
      interpolationFrame !==
      null
    ) {
      cancelAnimationFrame(
        interpolationFrame
      );

      interpolationFrame =
        null;
    }
  }

  /* =========================================================
     PATCH REMOTE UPDATE
  ========================================================= */

  const previousSafeRemoteUpdate =
    safelyUpdateRemote;

  safelyUpdateRemote =
    function (
      data
    ) {
      const remote =
        previousSafeRemoteUpdate(
          data
        );

      if (
        remote
      ) {
        try {
          setRemoteTarget(
            remote,
            data.position,
            data.rotation
          );
        } catch {}
      }

      return remote;
    };

  /* =========================================================
     INTERPOLATION API
  ========================================================= */

  try {
    if (
      window.Connections
    ) {
      window.Connections.interpolation =
        {
          get enabled() {
            return (
              InterpolationConfig.enabled
            );
          },

          setEnabled:
            setInterpolationEnabled,

          setDelay:
            setInterpolationDelay,

          setSpeed:
            setInterpolationSpeed,

          config:
            InterpolationConfig
        };
    }
  } catch {}

  /* =========================================================
     REMOTE PLAYER METADATA
  ========================================================= */

  function updateRemoteMetadata(
    remote,
    data
  ) {
    if (
      !remote ||
      !data
    ) {
      return;
    }

    if (
      data.name
    ) {
      remote.name =
        String(
          data.name
        ).slice(
          0,
          32
        );
    }

    if (
      Object.prototype.hasOwnProperty.call(
        data,
        "avatar"
      )
    ) {
      remote.avatar =
        data.avatar ||
        null;
    }

    remote.lastUpdate =
      Date.now();
  }

  /* =========================================================
     METADATA UPDATE PATCH
  ========================================================= */

  const previousRemoteMetadataUpdate =
    safelyUpdateRemote;

  safelyUpdateRemote =
    function (
      data
    ) {
      const remote =
        previousRemoteMetadataUpdate(
          data
        );

      if (
        remote
      ) {
        try {
          updateRemoteMetadata(
            remote,
            data
          );
        } catch {}
      }

      return remote;
    };

  /* =========================================================
     REMOTE TIMEOUT
  ========================================================= */

  const RemoteTimeout =
    15000;

  function removeTimedOutRemotes() {
    if (
      !State.remotes
    ) {
      return;
    }

    const now =
      Date.now();

    for (
      const [
        id,
        remote
      ] of
        State.remotes.entries()
    ) {
      if (
        !remote
      ) {
        continue;
      }

      const lastUpdate =
        Number(
          remote.lastUpdate ||
          remote.__connectionsInterpolation?.timestamp ||
          now
        );

      if (
        now -
          lastUpdate >
        RemoteTimeout
      ) {
        try {
          destroyRemote(
            id
          );
        } catch {}
      }
    }
  }

  setInterval(
    () => {
      try {
        removeTimedOutRemotes();
      } catch {}
    },
    5000
  );

  /* =========================================================
     START INTERPOLATION
  ========================================================= */

  try {
    startInterpolationLoop();
  } catch (e) {
    warn(
      "Could not start interpolation loop:",
      e
    );
  }

  /* =========================================================
     FINAL PLAYER UPDATE
  ========================================================= */

  try {
    updateRemoteInterpolations();
  } catch {}

  log(
    "Connections remote interpolation layer ready."
  );
  /* =========================================================
     REMOTE PLAYER ENTITY CONTROL
  ========================================================= */

  function getRemoteEntity(
    remote
  ) {
    if (
      !remote
    ) {
      return null;
    }

    return (
      remote.bot ||
      remote.object ||
      remote.gameObject ||
      remote.entity ||
      null
    );
  }

  function remoteEntityExists(
    remote
  ) {
    const entity =
      getRemoteEntity(
        remote
      );

    if (
      !entity
    ) {
      return false;
    }

    try {
      if (
        entity.destroyed ===
        true
      ) {
        return false;
      }
    } catch {}

    return true;
  }

  /* =========================================================
     REMOTE VISIBILITY
  ========================================================= */

  function setRemoteVisible(
    remote,
    visible
  ) {
    if (
      !remote
    ) {
      return;
    }

    remote.visible =
      !!visible;

    const entity =
      getRemoteEntity(
        remote
      );

    if (
      !entity
    ) {
      return;
    }

    try {
      if (
        typeof entity.setActive ===
        "function"
      ) {
        entity.setActive(
          !!visible
        );
      }
    } catch {}

    try {
      if (
        "active" in entity
      ) {
        entity.active =
          !!visible;
      }
    } catch {}

    try {
      if (
        entity.style
      ) {
        entity.style.display =
          visible
            ? ""
            : "none";
      }
    } catch {}
  }

  /* =========================================================
     REMOTE PLAYER NAME
  ========================================================= */

  function getRemoteDisplayName(
    remote
  ) {
    if (
      !remote
    ) {
      return "Player";
    }

    const name =
      remote.name;

    if (
      typeof name !==
      "string"
    ) {
      return "Player";
    }

    return (
      name
        .trim()
        .slice(
          0,
          32
        ) ||
      "Player"
    );
  }

  /* =========================================================
     REMOTE LABEL CREATION
  ========================================================= */

  function createRemoteLabel(
    remote
  ) {
    if (
      !remote
    ) {
      return null;
    }

    if (
      remote.__connectionsLabel
    ) {
      return remote.__connectionsLabel;
    }

    const label =
      document.createElement(
        "div"
      );

    label.className =
      "connections-remote-label";

    label.textContent =
      getRemoteDisplayName(
        remote
      );

    label.style.cssText =
      [
        "position:fixed",
        "pointer-events:none",
        "z-index:99997",
        "padding:3px 7px",
        "border-radius:5px",
        "background:rgba(0,0,0,.7)",
        "color:#fff",
        "font:12px Arial,sans-serif",
        "white-space:nowrap",
        "display:none",
        "transform:translate(-50%,-100%)"
      ].join(";");

    document.body.appendChild(
      label
    );

    remote.__connectionsLabel =
      label;

    return label;
  }

  /* =========================================================
     REMOTE LABEL UPDATE
  ========================================================= */

  function updateRemoteLabel(
    remote
  ) {
    if (
      !remote
    ) {
      return;
    }

    const label =
      createRemoteLabel(
        remote
      );

    if (
      !label
    ) {
      return;
    }

    label.textContent =
      getRemoteDisplayName(
        remote
      );

    const entity =
      getRemoteEntity(
        remote
      );

    if (
      !entity
    ) {
      label.style.display =
        "none";

      return;
    }

    try {
      if (
        entity.getScreenPosition
      ) {
        const point =
          entity.getScreenPosition();

        if (
          point &&
          Number.isFinite(
            point.x
          ) &&
          Number.isFinite(
            point.y
          )
        ) {
          label.style.left =
            `${point.x}px`;

          label.style.top =
            `${point.y}px`;

          label.style.display =
            "block";

          return;
        }
      }
    } catch {}

    try {
      if (
        entity.screenPosition
      ) {
        const point =
          entity.screenPosition;

        label.style.left =
          `${point.x}px`;

        label.style.top =
          `${point.y}px`;

        label.style.display =
          "block";

        return;
      }
    } catch {}

    label.style.display =
      "none";
  }

  /* =========================================================
     REMOTE LABEL LOOP
  ========================================================= */

  let remoteLabelFrame =
    null;

  function remoteLabelLoop() {
    if (
      State.remotes
    ) {
      for (
        const remote of
          State.remotes.values()
      ) {
        try {
          updateRemoteLabel(
            remote
          );
        } catch {}
      }
    }

    remoteLabelFrame =
      requestAnimationFrame(
        remoteLabelLoop
      );
  }

  function startRemoteLabelLoop() {
    if (
      remoteLabelFrame !==
      null
    ) {
      return;
    }

    remoteLabelFrame =
      requestAnimationFrame(
        remoteLabelLoop
      );
  }

  function stopRemoteLabelLoop() {
    if (
      remoteLabelFrame !==
      null
    ) {
      cancelAnimationFrame(
        remoteLabelFrame
      );

      remoteLabelFrame =
        null;
    }
  }

  /* =========================================================
     REMOTE VISUAL STATE
  ========================================================= */

  function updateRemoteVisualState(
    remote
  ) {
    if (
      !remote
    ) {
      return;
    }

    try {
      setRemoteVisible(
        remote,
        true
      );
    } catch {}

    try {
      updateRemoteLabel(
        remote
      );
    } catch {}
  }

  function updateAllRemoteVisuals() {
    if (
      !State.remotes
    ) {
      return;
    }

    for (
      const remote of
        State.remotes.values()
    ) {
      try {
        updateRemoteVisualState(
          remote
        );
      } catch {}
    }
  }

  /* =========================================================
     REMOTE CLEANUP LABEL
  ========================================================= */

  function removeRemoteLabel(
    remote
  ) {
    if (
      !remote
    ) {
      return;
    }

    const label =
      remote.__connectionsLabel;

    if (
      !label
    ) {
      return;
    }

    try {
      label.remove();
    } catch {
      try {
        if (
          label.parentNode
        ) {
          label.parentNode.removeChild(
            label
          );
        }
      } catch {}
    }

    remote.__connectionsLabel =
      null;
  }

  /* =========================================================
     PATCH REMOTE DESTROY
  ========================================================= */

  const previousDestroyRemote =
    destroyRemote;

  destroyRemote =
    function (
      id
    ) {
      let remote =
        null;

      try {
        remote =
          State.remotes.get(
            id
          );
      } catch {}

      try {
        removeRemoteLabel(
          remote
        );
      } catch {}

      try {
        previousDestroyRemote(
          id
        );
      } catch (e) {
        warn(
          "Remote destroy failed:",
          e
        );
      }
    };

  /* =========================================================
     REMOTE VISUAL PATCH
  ========================================================= */

  const previousSyncRemoteVisuals =
    syncRemoteVisuals;

  syncRemoteVisuals =
    function () {
      try {
        previousSyncRemoteVisuals();
      } catch {}

      try {
        updateAllRemoteVisuals();
      } catch {}
    };

  /* =========================================================
     REMOTE UPDATE VISUAL PATCH
  ========================================================= */

  const previousUpdateRemoteMetadata =
    updateRemoteMetadata;

  updateRemoteMetadata =
    function (
      remote,
      data
    ) {
      try {
        previousUpdateRemoteMetadata(
          remote,
          data
        );
      } catch {}

      try {
        updateRemoteVisualState(
          remote
        );
      } catch {}
    };

  /* =========================================================
     REMOTE PLAYER COUNT
  ========================================================= */

  function getVisibleRemoteCount() {
    if (
      !State.remotes
    ) {
      return 0;
    }

    let count =
      0;

    for (
      const remote of
        State.remotes.values()
    ) {
      if (
        remoteEntityExists(
          remote
        )
      ) {
        count++;
      }
    }

    return count;
  }

  /* =========================================================
     EXTENDED PLAYER SNAPSHOT
  ========================================================= */

  function getExtendedPlayerSnapshot() {
    const players =
      getPlayerList();

    return players.map(
      player => ({
        ...player,

        local:
          player.id ===
          State.id,

        displayName:
          player.local
            ? State.name
            : getRemoteDisplayName(
                State.remotes.get(
                  player.id
                )
              )
      })
    );
  }

  /* =========================================================
     PUBLIC VISUAL API
  ========================================================= */

  try {
    if (
      window.Connections
    ) {
      window.Connections.getRemoteEntity =
        id => {
          const remote =
            State.remotes.get(
              id
            );

          return getRemoteEntity(
            remote
          );
        };

      window.Connections.getRemoteCount =
        () => {
          return getVisibleRemoteCount();
        };

      window.Connections.getPlayers =
        () => {
          return getExtendedPlayerSnapshot();
        };

      window.Connections.refreshVisuals =
        () => {
          syncRemoteVisuals();
          updateAllRemoteVisuals();
        };
    }
  } catch (e) {
    warn(
      "Visual API setup failed:",
      e
    );
  }

  /* =========================================================
     PLAYER LIST REFRESH LOOP
  ========================================================= */

  let playerRefreshTimer =
    null;

  function startPlayerRefreshLoop() {
    if (
      playerRefreshTimer
    ) {
      return;
    }

    playerRefreshTimer =
      setInterval(
        () => {
          try {
            renderPlayerList();
          } catch {}

          try {
            updateCurrentRoom();
          } catch {}
        },
        1000
      );
  }

  function stopPlayerRefreshLoop() {
    if (
      playerRefreshTimer
    ) {
      clearInterval(
        playerRefreshTimer
      );

      playerRefreshTimer =
        null;
    }
  }

  /* =========================================================
     START VISUAL SYSTEM
  ========================================================= */

  try {
    startRemoteLabelLoop();
  } catch {}

  try {
    startPlayerRefreshLoop();
  } catch {}

  try {
    updateAllRemoteVisuals();
  } catch {}

  /* =========================================================
     FINAL VISUAL READY EVENT
  ========================================================= */

  try {
    window.dispatchEvent(
      new CustomEvent(
        "connections:visuals-ready",
        {
          detail: {
            players:
              getExtendedPlayerSnapshot(),

            remotes:
              getVisibleRemoteCount()
          }
        }
      )
    );
  } catch {}

  log(
    "Connections remote visual system ready."
  );
  /* =========================================================
     MULTIPLAYER ROOM MANAGEMENT
  ========================================================= */

  const RoomManager = {
    selected:
      null,

    busy:
      false,

    select(room) {
      if (
        !room
      ) {
        this.selected =
          null;

        return null;
      }

      this.selected =
        room;

      return room;
    },

    clear() {
      this.selected =
        null;
      this.busy =
        false;
    },

    getSelected() {
      return this.selected;
    }
  };

  /* =========================================================
     ROOM NORMALIZATION
  ========================================================= */

  function normalizeRoom(
    room
  ) {
    if (
      !room ||
      typeof room !==
        "object"
    ) {
      return null;
    }

    const id =
      room.id ||
      room.room ||
      room.roomId;

    if (
      !id
    ) {
      return null;
    }

    return {
      id:
        String(
          id
        ),

      name:
        String(
          room.name ||
          room.title ||
          "Room"
        ).slice(
          0,
          48
        ),

      players:
        Number.isFinite(
          Number(
            room.players
          )
        )
          ? Number(
              room.players
            )
          : Number(
              room.playerCount ||
              0
            ),

      maxPlayers:
        Number.isFinite(
          Number(
            room.maxPlayers
          )
        )
          ? Number(
              room.maxPlayers
            )
          : 16,

      locked:
        !!room.locked,

      owner:
        room.owner ||
        null
    };
  }

  function normalizeRooms(
    rooms
  ) {
    if (
      !Array.isArray(
        rooms
      )
    ) {
      return [];
    }

    const result =
      [];

    for (
      const room of
        rooms
    ) {
      const normalized =
        normalizeRoom(
          room
        );

      if (
        normalized
      ) {
        result.push(
          normalized
        );
      }
    }

    return result;
  }

  /* =========================================================
     ROOM CACHE
  ========================================================= */

  let roomCache =
    [];

  function updateRoomCache(
    rooms
  ) {
    roomCache =
      normalizeRooms(
        rooms
      );

    State.rooms =
      roomCache;

    try {
      renderRooms(
        roomCache
      );
    } catch {}

    return roomCache;
  }

  function getRoomCache() {
    return roomCache.slice();
  }

  /* =========================================================
     ROOM EVENT
  ========================================================= */

  MultiplayerEvents.on(
    "rooms",
    rooms => {
      updateRoomCache(
        rooms
      );
    }
  );

  /* =========================================================
     ROOM SELECTION
  ========================================================= */

  function selectRoom(
    room
  ) {
    const normalized =
      normalizeRoom(
        room
      );

    if (
      !normalized
    ) {
      return null;
    }

    return RoomManager.select(
      normalized
    );
  }

  /* =========================================================
     JOIN SELECTED ROOM
  ========================================================= */

  function joinSelectedRoom() {
    const room =
      RoomManager.getSelected();

    if (
      !room
    ) {
      return false;
    }

    if (
      room.locked
    ) {
      warn(
        "Selected room is locked."
      );

      return false;
    }

    return safeJoinRoom(
      room.id
    );
  }

  /* =========================================================
     ROOM CREATE DIALOG
  ========================================================= */

  function createRoomPrompt() {
    let name =
      null;

    try {
      name =
        window.prompt(
          "Room name:",
          "Connections Room"
        );
    } catch {}

    if (
      name ===
      null
    ) {
      return false;
    }

    return safeCreateRoom(
      name
    );
  }

  /* =========================================================
     ROOM LIST UI
  ========================================================= */

  function createRoomListUI() {
    if (
      document.getElementById(
        "connections-room-browser"
      )
    ) {
      return document.getElementById(
        "connections-room-browser"
      );
    }

    const root =
      document.createElement(
        "div"
      );

    root.id =
      "connections-room-browser";

    root.style.cssText =
      [
        "position:fixed",
        "top:50%",
        "left:50%",
        "transform:translate(-50%,-50%)",
        "width:420px",
        "max-width:calc(100vw - 30px)",
        "max-height:70vh",
        "overflow:hidden",
        "z-index:99996",
        "display:none",
        "background:#111",
        "border:1px solid #333",
        "border-radius:12px",
        "box-shadow:0 15px 50px rgba(0,0,0,.55)",
        "font-family:Arial,sans-serif",
        "color:#fff"
      ].join(";");

    const header =
      document.createElement(
        "div"
      );

    header.style.cssText =
      [
        "display:flex",
        "align-items:center",
        "justify-content:space-between",
        "padding:12px",
        "border-bottom:1px solid #292929"
      ].join(";");

    const title =
      document.createElement(
        "div"
      );

    title.textContent =
      "Multiplayer Rooms";

    title.style.fontWeight =
      "700";

    const close =
      document.createElement(
        "button"
      );

    close.textContent =
      "×";

    close.style.cssText =
      [
        "border:0",
        "background:transparent",
        "color:#aaa",
        "font-size:22px",
        "cursor:pointer"
      ].join(";");

    close.onclick =
      () => {
        root.style.display =
          "none";
      };

    header.appendChild(
      title
    );

    header.appendChild(
      close
    );

    const controls =
      document.createElement(
        "div"
      );

    controls.style.cssText =
      [
        "display:flex",
        "gap:7px",
        "padding:10px",
        "border-bottom:1px solid #222"
      ].join(";");

    const create =
      document.createElement(
        "button"
      );

    create.textContent =
      "Create Room";

    create.style.cssText =
      [
        "flex:1",
        "padding:8px",
        "border:0",
        "border-radius:7px",
        "background:#7289da",
        "color:#fff",
        "cursor:pointer"
      ].join(";");

    create.onclick =
      () => {
        createRoomPrompt();
      };

    const refresh =
      document.createElement(
        "button"
      );

    refresh.textContent =
      "Refresh";

    refresh.style.cssText =
      [
        "padding:8px 12px",
        "border:1px solid #444",
        "border-radius:7px",
        "background:#1b1b1b",
        "color:#fff",
        "cursor:pointer"
      ].join(";");

    refresh.onclick =
      () => {
        safeRequestRooms();
      };

    controls.appendChild(
      create
    );

    controls.appendChild(
      refresh
    );

    const list =
      document.createElement(
        "div"
      );

    list.id =
      "connections-room-list";

    list.style.cssText =
      [
        "padding:10px",
        "max-height:45vh",
        "overflow-y:auto"
      ].join(";");

    root.appendChild(
      header
    );

    root.appendChild(
      controls
    );

    root.appendChild(
      list
    );

    document.body.appendChild(
      root
    );

    return root;
  }

  /* =========================================================
     RENDER ROOM BROWSER
  ========================================================= */

  function renderRoomBrowser(
    rooms
  ) {
    const root =
      createRoomListUI();

    const list =
      root.querySelector(
        "#connections-room-list"
      );

    if (
      !list
    ) {
      return;
    }

    list.innerHTML =
      "";

    const normalized =
      normalizeRooms(
        rooms
      );

    if (
      !normalized.length
    ) {
      const empty =
        document.createElement(
          "div"
        );

      empty.textContent =
        "No rooms available.";

      empty.style.cssText =
        [
          "padding:20px",
          "text-align:center",
          "color:#888"
        ].join(";");

      list.appendChild(
        empty
      );

      return;
    }

    for (
      const room of
        normalized
    ) {
      const item =
        document.createElement(
          "div"
        );

      item.style.cssText =
        [
          "display:flex",
          "align-items:center",
          "gap:10px",
          "padding:10px",
          "margin-bottom:7px",
          "background:#181818",
          "border:1px solid #292929",
          "border-radius:8px"
        ].join(";");

      const info =
        document.createElement(
          "div"
        );

      info.style.flex =
        "1";

      const name =
        document.createElement(
          "div"
        );

      name.textContent =
        room.name;

      name.style.fontWeight =
        "700";

      const players =
        document.createElement(
          "div"
        );

      players.textContent =
        `${room.players}/${room.maxPlayers}`;

      players.style.cssText =
        [
          "margin-top:3px",
          "font-size:11px",
          "color:#888"
        ].join(";");

      info.appendChild(
        name
      );

      info.appendChild(
        players
      );

      const join =
        document.createElement(
          "button"
        );

      join.textContent =
        room.locked
          ? "Locked"
          : "Join";

      join.disabled =
        room.locked ||
        room.players >=
          room.maxPlayers;

      join.style.cssText =
        [
          "padding:7px 12px",
          "border:0",
          "border-radius:6px",
          "background:#7289da",
          "color:#fff",
          "cursor:pointer"
        ].join(";");

      join.onclick =
        () => {
          selectRoom(
            room
          );

          if (
            joinSelectedRoom()
          ) {
            root.style.display =
              "none";
          }
        };

      item.appendChild(
        info
      );

      item.appendChild(
        join
      );

      list.appendChild(
        item
      );
    }
  }

  /* =========================================================
     ROOM BROWSER TOGGLE
  ========================================================= */

  function toggleRoomBrowser(
    force
  ) {
    const root =
      createRoomListUI();

    if (
      typeof force ===
      "boolean"
    ) {
      root.style.display =
        force
          ? "block"
          : "none";
    } else {
      root.style.display =
        root.style.display ===
        "none"
          ? "block"
          : "none";
    }

    if (
      root.style.display ===
      "block"
    ) {
      safeRequestRooms();
      renderRoomBrowser(
        roomCache
      );
    }
  }

  /* =========================================================
     ROOM BROWSER API
  ========================================================= */

  try {
    if (
      window.Connections
    ) {
      window.Connections.rooms =
        {
          list:
            getRoomCache,

          select:
            selectRoom,

          selected:
            () =>
              RoomManager.getSelected(),

          joinSelected:
            joinSelectedRoom,

          create:
            createRoomPrompt,

          refresh:
            safeRequestRooms,

          open:
            () =>
              toggleRoomBrowser(
                true
              ),

          close:
            () =>
              toggleRoomBrowser(
                false
              ),

          toggle:
            toggleRoomBrowser
        };
    }
  } catch (e) {
    warn(
      "Room browser API failed:",
      e
    );
  }

  /* =========================================================
     ROOM BROWSER ROOM EVENT
  ========================================================= */

  const previousRenderRooms =
    renderRooms;

  renderRooms =
    function (
      rooms
    ) {
      try {
        previousRenderRooms(
          rooms
        );
      } catch {}

      try {
        renderRoomBrowser(
          rooms
        );
      } catch {}
    };

  /* =========================================================
     KEYBOARD SHORTCUT
  ========================================================= */

  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key ===
        "F7"
      ) {
        if (
          event.repeat
        ) {
          return;
        }

        toggleRoomBrowser();
      }
    }
  );

  /* =========================================================
     FINAL ROOM SYSTEM
  ========================================================= */

  try {
    createRoomListUI();
    renderRoomBrowser(
      roomCache
    );
  } catch {}

  log(
    "Connections room browser ready."
  );
  /* =========================================================
     FINAL MULTIPLAYER CONTROLLER
  ========================================================= */

  const MultiplayerController = {
    started: false,

    start() {
      if (this.started) {
        return;
      }

      this.started = true;

      try {
        startInterpolationLoop();
      } catch {}

      try {
        startRemoteLabelLoop();
      } catch {}

      try {
        startPlayerRefreshLoop();
      } catch {}

      try {
        if (
          State.connected &&
          State.joinedRoom
        ) {
          startStateTransmission();
        }
      } catch {}

      log(
        "Multiplayer controller started."
      );
    },

    stop() {
      if (!this.started) {
        return;
      }

      this.started = false;

      try {
        stopStateTransmission();
      } catch {}

      try {
        stopInterpolationLoop();
      } catch {}

      try {
        stopRemoteLabelLoop();
      } catch {}

      try {
        stopPlayerRefreshLoop();
      } catch {}

      log(
        "Multiplayer controller stopped."
      );
    },

    status() {
      return {
        started:
          this.started,

        connected:
          !!State.connected,

        joined:
          !!State.joinedRoom,

        room:
          State.room ||
          null,

        players:
          getPlayerList().length,

        remotes:
          State.remotes
            ? State.remotes.size
            : 0
      };
    }
  };

  /* =========================================================
     PUBLIC CONTROLLER
  ========================================================= */

  try {
    window.Connections =
      window.Connections ||
      {};

    window.Connections.multiplayerController =
      MultiplayerController;

    window.Connections.start =
      () =>
        MultiplayerController.start();

    window.Connections.stop =
      () =>
        MultiplayerController.stop();

    window.Connections.status =
      () =>
        MultiplayerController.status();
  } catch {}

  /* =========================================================
     NETWORK CONNECT HOOK
  ========================================================= */

  MultiplayerEvents.on(
    "connected",
    () => {
      try {
        MultiplayerController.start();
      } catch {}
    }
  );

  MultiplayerEvents.on(
    "connectionLost",
    () => {
      try {
        stopStateTransmission();
      } catch {}
    }
  );

  /* =========================================================
     ROOM STATE HOOK
  ========================================================= */

  MultiplayerEvents.on(
    "roomJoined",
    data => {
      try {
        State.joinedRoom =
          true;
      } catch {}

      try {
        State.room =
          data.room ||
          data.id ||
          State.room;
      } catch {}

      try {
        MultiplayerController.start();
      } catch {}

      try {
        transmitLocalState();
      } catch {}
    }
  );

  MultiplayerEvents.on(
    "roomLeft",
    () => {
      try {
        State.joinedRoom =
          false;
      } catch {}

      try {
        stopStateTransmission();
      } catch {}

      try {
        destroyAllRemotes();
      } catch {}
    }
  );

  /* =========================================================
     PLAYER CLEANUP
  ========================================================= */

  function clearMultiplayerPlayers() {
    try {
      destroyAllRemotes();
    } catch {}

    try {
      renderPlayerList();
    } catch {}

    try {
      updateCurrentRoom();
    } catch {}
  }

  try {
    window.Connections.clearPlayers =
      clearMultiplayerPlayers;
  } catch {}

  /* =========================================================
     PAGE UNLOAD
  ========================================================= */

  function finalMultiplayerShutdown() {
    try {
      stopStateTransmission();
    } catch {}

    try {
      stopInterpolationLoop();
    } catch {}

    try {
      stopRemoteLabelLoop();
    } catch {}

    try {
      stopPlayerRefreshLoop();
    } catch {}

    try {
      stopHeartbeat();
    } catch {}

    try {
      stopHealthMonitor();
    } catch {}

    try {
      stopRoomSync();
    } catch {}

    try {
      destroyAllRemotes();
    } catch {}
  }

  window.addEventListener(
    "beforeunload",
    finalMultiplayerShutdown
  );

  window.addEventListener(
    "pagehide",
    finalMultiplayerShutdown
  );

  /* =========================================================
     INITIALIZE
  ========================================================= */

  try {
    MultiplayerController.start();
  } catch (e) {
    warn(
      "Multiplayer controller failed:",
      e
    );
  }

  /* =========================================================
     FINAL API
  ========================================================= */

  try {
    window.Connections.version =
      "multiplayer-final";

    window.Connections.state =
      State;

    window.Connections.roomsList =
      () =>
        getRoomCache();

    window.Connections.playersList =
      () =>
        getPlayerList();

    window.Connections.isConnected =
      () =>
        !!State.connected;

    window.Connections.isInRoom =
      () =>
        !!State.joinedRoom;
  } catch {}

  /* =========================================================
     READY
  ========================================================= */

  try {
    window.dispatchEvent(
      new CustomEvent(
        "connections:ready",
        {
          detail: {
            version:
              "multiplayer-final",

            connected:
              !!State.connected,

            room:
              State.room ||
              null,

            players:
              getPlayerList()
          }
        }
      )
    );
  } catch {}

  log(
    "Connections multiplayer system fully initialized."
  );

})();
