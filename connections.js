// ==UserScript==
// @name         Connections
// @namespace    conn
// @version      1.0.0
// @description  clutcher.io multiply players
// @match        *://clutcher.io/*
// @match        *://*.clutcher.io/*
// @grant        unsafeWindow
// @grant        GM_addStyle
// @connect      diagram-candle-carried-forever.trycloudflare.com
// ==/UserScript==

(() => {
    "use strict";

    const PAGE =
        typeof unsafeWindow !== "undefined"
            ? unsafeWindow
            : window;

    const CONFIG = {
        VERSION: "1.0.0",

        WS_URL:
            "wss://diagram-candle-carried-forever.trycloudflare.com",

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

        isHost: false,

        originalBots: [],

        originalBotArray: null,

        botTemplate: null,

        avatar: null,

        avatarEnabled: true,

        avatarDirty: true,

        lastAvatarSent: 0,

        ui: {
            open: false
        },

        sendTimer: null,

        monitorTimer: null,

        avatarTimer: null,

        visibilityTimer: null
    };

    function log(...args) {
        console.log("[Connections]", ...args);
    }

    function warn(...args) {
        console.warn("[Connections]", ...args);
    }

    function error(...args) {
        console.error("[Connections]", ...args);
    }

    function getGame() {
        try {
            if (PAGE.game) {
                return PAGE.game;
            }
        } catch {}

        try {
            if (window.game) {
                return window.game;
            }
        } catch {}

        return null;
    }

    function getPlayer() {
        const game = getGame();

        if (!game) {
            return null;
        }

        return game.player || null;
    }

    function roomId(value) {
        if (
            value === null ||
            value === undefined
        ) {
            return null;
        }

        if (
            typeof value === "string" ||
            typeof value === "number"
        ) {
            return String(value);
        }

        if (typeof value === "object") {
            return String(
                value.id ??
                value.roomId ??
                value._id ??
                value.code ??
                ""
            ) || null;
        }

        return null;
    }

    function getRoomObject(value) {
        if (!value) {
            return null;
        }

        if (typeof value === "object") {
            return value;
        }

        const id = String(value);

        return State.rooms.find(room => {
            return String(
                room.id ??
                room.roomId ??
                ""
            ) === id;
        }) || null;
    }

    function isInsideMatch(game = getGame()) {
        if (!game) {
            return false;
        }

        try {
            if (
                typeof game.isInMatch ===
                "function"
            ) {
                const result =
                    game.isInMatch();

                if (
                    typeof result ===
                    "boolean"
                ) {
                    return result;
                }
            }
        } catch {}

        try {
            if (
                game.gameState ===
                "playing"
            ) {
                return true;
            }
        } catch {}

        try {
            if (
                game.state ===
                "playing"
            ) {
                return true;
            }
        } catch {}

        try {
            if (
                game.inMatch ===
                true
            ) {
                return true;
            }
        } catch {}

        try {
            if (
                game.match &&
                game.match.isStarted ===
                true
            ) {
                return true;
            }
        } catch {}

        return false;
    }

    function getName() {
        try {
            const saved =
                localStorage.getItem(
                    "connections_player_name"
                );

            if (
                saved &&
                saved.trim()
            ) {
                return saved
                    .trim()
                    .slice(0, 24);
            }
        } catch {}

        let name = "Player";

        try {
            const value =
                prompt(
                    "Connections username:",
                    "Player"
                );

            if (
                value &&
                value.trim()
            ) {
                name =
                    value
                        .trim()
                        .slice(0, 24);
            }
        } catch {}

        try {
            localStorage.setItem(
                "connections_player_name",
                name
            );
        } catch {}

        return name;
    }

    State.name = getName();

    /*
     * =========================================================
     * AVATAR
     * =========================================================
     */

    const Avatar = {

        load() {
            try {
                State.avatar =
                    localStorage.getItem(
                        "pp-avatar"
                    ) || null;

                State.avatarEnabled =
                    localStorage.getItem(
                        "pp-avatar-on"
                    ) !== "0";

            } catch {
                State.avatar = null;
                State.avatarEnabled = true;
            }

            State.avatarDirty = true;
        },

        get() {
            if (
                !State.avatarEnabled
            ) {
                return null;
            }

            if (
                typeof State.avatar !==
                "string"
            ) {
                return null;
            }

            if (
                !State.avatar.startsWith(
                    "data:image/"
                )
            ) {
                return null;
            }

            return State.avatar;
        },

        async setFile(file) {
            if (!file) {
                return;
            }

            if (
                !file.type.startsWith(
                    "image/"
                )
            ) {
                UI.setMessage(
                    "Choose an image file."
                );

                return;
            }

            if (
                file.size >
                CONFIG.AVATAR_MAX_BYTES
            ) {
                UI.setMessage(
                    "Avatar is too large."
                );

                return;
            }

            try {
                const data =
                    await Avatar.readFile(
                        file
                    );

                State.avatar =
                    data;

                State.avatarEnabled =
                    true;

                localStorage.setItem(
                    "pp-avatar",
                    data
                );

                localStorage.setItem(
                    "pp-avatar-on",
                    "1"
                );

                State.avatarDirty =
                    true;

                UI.updateAvatar();

                RemoteBots.applyAvatars();

                UI.setMessage(
                    "Avatar saved."
                );

            } catch (e) {

                error(
                    "Avatar load failed:",
                    e
                );

                UI.setMessage(
                    "Failed to load avatar."
                );
            }
        },

        readFile(file) {
            return new Promise(
                (resolve, reject) => {

                    const reader =
                        new FileReader();

                    reader.onload =
                        () => {
                            resolve(
                                String(
                                    reader.result
                                )
                            );
                        };

                    reader.onerror =
                        reject;

                    reader.readAsDataURL(
                        file
                    );
                }
            );
        },

        toggle() {
            State.avatarEnabled =
                !State.avatarEnabled;

            try {
                localStorage.setItem(
                    "pp-avatar-on",
                    State.avatarEnabled
                        ? "1"
                        : "0"
                );
            } catch {}

            State.avatarDirty =
                true;

            UI.updateAvatar();

            RemoteBots.applyAvatars();
        },

        reset() {
            State.avatar =
                null;

            State.avatarEnabled =
                true;

            try {
                localStorage.removeItem(
                    "pp-avatar"
                );

                localStorage.setItem(
                    "pp-avatar-on",
                    "1"
                );
            } catch {}

            State.avatarDirty =
                true;

            UI.updateAvatar();

            RemoteBots.applyAvatars();

            UI.setMessage(
                "Avatar reset."
            );
        }
    };

    Avatar.load();

    /*
     * =========================================================
     * NETWORK
     * =========================================================
     */

    const Network = {

        connect() {
            if (
                State.connected ||
                State.connecting
            ) {
                return;
            }

            if (
                !State.confirmedMatch
            ) {
                UI.setMessage(
                    "Click I AM IN A MATCH first."
                );

                return;
            }

            State.connecting = true;

            UI.updateStatus();

            log(
                "Connecting:",
                CONFIG.WS_URL
            );

            let ws;

            try {
                ws =
                    new WebSocket(
                        CONFIG.WS_URL
                    );
            } catch (e) {

                State.connecting =
                    false;

                error(
                    "WebSocket creation failed:",
                    e
                );

                UI.updateStatus();

                return;
            }

            State.ws = ws;

            ws.addEventListener(
                "open",
                () => {

                    State.connecting =
                        false;

                    State.connected =
                        true;

                    log(
                        "WebSocket connected."
                    );

                    Network.send({
                        type: "hello",

                        name:
                            State.name
                    });

                    Network.send({
                        type: "list_rooms"
                    });

                    State.avatarDirty =
                        true;

                    UI.setMessage(
                        "Connected. Loading rooms..."
                    );

                    UI.updateStatus();
                }
            );

            ws.addEventListener(
                "message",
                event => {

                    let msg;

                    try {
                        msg =
                            JSON.parse(
                                event.data
                            );
                    } catch {
                        return;
                    }

                    Network.handle(msg);
                }
            );

            ws.addEventListener(
                "close",
                () => {

                    State.connected =
                        false;

                    State.connecting =
                        false;

                    State.id =
                        null;

                    State.room =
                        null;

                    State.isHost =
                        false;

                    State.avatarDirty =
                        true;

                    RemoteBots.clear();

                    log(
                        "WebSocket closed."
                    );

                    UI.updateStatus();

                    UI.renderRoom();

                    UI.renderRooms();
                }
            );

            ws.addEventListener(
                "error",
                e => {

                    error(
                        "WebSocket error:",
                        e
                    );

                    UI.setMessage(
                        "Connection error."
                    );
                }
            );
        },

        send(data) {
            if (
                !State.ws ||
                State.ws.readyState !==
                WebSocket.OPEN
            ) {
                return false;
            }

            try {

                State.ws.send(
                    JSON.stringify(
                        data
                    )
                );

                return true;

            } catch (e) {

                error(
                    "Send failed:",
                    e
                );

                return false;
            }
        },

        handle(msg) {

            if (
                !msg ||
                !msg.type
            ) {
                return;
            }

            switch (
                msg.type
            ) {

                case "connected": {

                    const id =
                        msg.id ??
                        msg.clientId ??
                        msg.playerId ??
                        msg.client?.id;

                    if (
                        id != null
                    ) {
                        State.id =
                            String(id);
                    }

                    log(
                        "Assigned ID:",
                        State.id
                    );

                    break;
                }

                case "hello": {

                    const id =
                        msg.id ??
                        msg.clientId ??
                        msg.playerId ??
                        msg.client?.id;

                    if (
                        id != null
                    ) {
                        State.id =
                            String(id);
                    }

                    break;
                }

                case "rooms": {

                    State.rooms =
                        Array.isArray(
                            msg.rooms
                        )
                            ? msg.rooms
                            : [];

                    UI.renderRooms();

                    UI.renderRoom();

                    break;
                }

                case "room_joined": {

                    const raw =
                        msg.room ??
                        msg.roomId ??
                        msg.id ??
                        msg.data;

                    const id =
                        roomId(raw);

                    if (id) {

                        State.room =
                            id;

                        State.matchEnding =
                            false;

                        State.avatarDirty =
                            true;

                        const room =
                            getRoomObject(
                                id
                            );

                        State.isHost =
                            !!(
                                room?.host &&
                                State.id &&
                                String(
                                    room.host
                                ) ===
                                String(
                                    State.id
                                )
                            );

                        log(
                            "Joined room:",
                            id
                        );

                        UI.setMessage(
                            "Joined room."
                        );

                        UI.renderRooms();

                        UI.renderRoom();
                    }

                    break;
                }

                case "player_joined": {

                    const player =
                        msg.player ||
                        msg.client ||
                        msg.data ||
                        {};

                    const id =
                        msg.id ??
                        msg.playerId ??
                        player.id;

                    if (
                        id != null &&
                        String(id) !==
                        String(State.id)
                    ) {

                        let remote =
                            State.remotes.get(
                                String(id)
                            );

                        if (!remote) {

                            remote = {
                                id:
                                    String(id),

                                name:
                                    String(
                                        msg.name ??
                                        player.name ??
                                        "Player"
                                    ).slice(
                                        0,
                                        24
                                    ),

                                team:
                                    player.team ===
                                    "T"
                                        ? "T"
                                        : "CT",

                                avatar:
                                    player.avatar ||
                                    null,

                                current: {
                                    x: 0,
                                    y: 0,
                                    z: 0,
                                    yaw: 0,
                                    pitch: 0,
                                    alive: true
                                },

                                target: {
                                    x: 0,
                                    y: 0,
                                    z: 0,
                                    yaw: 0,
                                    pitch: 0,
                                    alive: true
                                },

                                lastPacket:
                                    performance.now(),

                                bot: null,

                                lastAlive:
                                    true
                            };

                            State.remotes.set(
                                String(id),
                                remote
                            );

                            RemoteBots.attach(
                                remote
                            );
                        }
                    }

                    State.avatarDirty =
                        true;

                    UI.renderRoom();

                    break;
                }

                case "player_left": {

                    const id =
                        msg.id ??
                        msg.playerId ??
                        msg.player?.id;

                    if (
                        id != null
                    ) {

                        RemoteBots.remove(
                            String(id)
                        );
                    }

                    UI.renderRoom();

                    break;
                }

                case "state": {

                    Network.receiveState(
                        msg
                    );

                    break;
                }

                case "left_room": {

                    RemoteBots.clear();

                    State.room =
                        null;

                    State.isHost =
                        false;

                    State.avatarDirty =
                        true;

                    UI.setMessage(
                        "Left room."
                    );

                    UI.renderRooms();

                    UI.renderRoom();

                    break;
                }

                case "room_deleted": {

                    RemoteBots.clear();

                    State.room =
                        null;

                    State.isHost =
                        false;

                    UI.setMessage(
                        msg.reason ||
                        "Room deleted."
                    );

                    UI.renderRooms();

                    UI.renderRoom();

                    break;
                }

                case "error": {

                    const message =
                        msg.message ??
                        msg.error ??
                        "Server error";

                    error(
                        "Server error:",
                        message
                    );

                    UI.setMessage(
                        message
                    );

                    break;
                }

                case "pong":
                    break;
            }
        },

        receiveState(msg) {

            let id =
                msg.id ??
                msg.playerId;

            if (
                !id &&
                msg.player
            ) {
                id =
                    msg.player.id;
            }

            if (
                id == null
            ) {
                return;
            }

            id =
                String(id);

            if (
                State.id &&
                id ===
                String(State.id)
            ) {
                return;
            }

            const state =
                msg.state ??
                msg.player ??
                msg.data;

            if (!state) {
                return;
            }

            RemoteBots.receive(
                id,
                state
            );
        },

        createRoom(
            name,
            maxPlayers
        ) {

            if (
                !State.connected
            ) {
                UI.setMessage(
                    "Connect first."
                );

                return;
            }

            Network.send({
                type: "create_room",

                name:
                    name ||
                    "Connections Room",

                maxPlayers:
                    Number(
                        maxPlayers
                    ) || 8
            });
        },

        joinRoom(id) {

            if (
                !State.connected
            ) {
                UI.setMessage(
                    "Not connected."
                );

                return;
            }

            const normalized =
                roomId(id);

            if (
                !normalized
            ) {
                return;
            }

            log(
                "Joining room:",
                normalized
            );

            Network.send({
                type: "join_room",

                room:
                    normalized,

                roomId:
                    normalized,

                id:
                    normalized
            });
        },

        leaveRoom() {

            if (
                !State.connected
            ) {
                return;
            }

            Network.send({
                type:
                    "leave_room"
            });

            /*
             * Do not wait for the backend
             * to clean the local game.
             */
            setTimeout(
                () => {

                    if (
                        State.room
                    ) {

                        RemoteBots.clear();

                        State.room =
                            null;

                        State.isHost =
                            false;

                        UI.renderRoom();

                        UI.renderRooms();
                    }

                },
                250
            );
        }
    };

    /*
     * =========================================================
     * NATIVE BOT SYSTEM
     * =========================================================
     */

    const RemoteBots = {

        preparePool() {

            const game =
                getGame();

            const mgr =
                game?.botMgr;

            if (
                !mgr ||
                !Array.isArray(
                    mgr.bots
                )
            ) {

                warn(
                    "botMgr.bots unavailable."
                );

                return false;
            }

            if (
                State.preparingBots
            ) {
                return true;
            }

            if (
                State.originalBots.length
            ) {
                return true;
            }

            State.preparingBots =
                true;

            log(
                "Preparing native bot removal:",
                mgr.bots.length
            );

            State.originalBotArray =
                mgr.bots;

            State.originalBots =
                [...mgr.bots];

            State.botTemplate =
                mgr.bots[0] || null;

            /*
             * Completely remove the normal
             * AI bots from the game's active
             * bot list.
             */
            for (
                const bot
                of State.originalBots
            ) {

                RemoteBots.disableBot(
                    bot
                );
            }

            try {

                mgr.bots.length =
                    0;

            } catch {}

            State.preparingBots =
                false;

            log(
                "Native AI bots removed from active manager."
            );

            return true;
        },

        disableBot(bot) {

            if (!bot) {
                return;
            }

            bot.__connectionsPool =
                false;

            bot.__connectionsRemote =
                false;

            bot.__connectionsRemoved =
                true;

            bot.alive =
                false;

            bot.health =
                0;

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
                if (
                    bot.shadow
                ) {
                    bot.shadow.visible =
                        false;
                }
            } catch {}

            try {
                if (
                    bot.mesh
                ) {
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
                        function() {};
                }

            } catch {}
        },

        getFreeBot() {
            return null;
        },

        createBot(remote) {

            const game =
                getGame();

            const mgr =
                game?.botMgr;

            if (
                !mgr ||
                !Array.isArray(
                    mgr.bots
                )
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

            const template =
                State.botTemplate;

            if (
                !template ||
                !template.constructor
            ) {

                warn(
                    "No native bot constructor available."
                );

                return null;
            }

            let bot = null;

            try {

                bot =
                    new template.constructor(
                        game,

                        remote.team,

                        remote.name,

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
                    function() {};

            } catch {}

            try {
                mgr.bots.push(
                    bot
                );
            } catch {}

            return bot;
        },

        attach(remote) {

            const game =
                getGame();

            if (
                !game?.botMgr
            ) {
                return;
            }

            if (
                remote.bot
            ) {
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

            remote.bot =
                bot;

            bot.__connectionsPool =
                true;

            bot.__connectionsRemote =
                true;

            bot.__connectionsRemoteId =
                remote.id;

            bot.name =
                remote.name;

            bot.team =
                remote.team;

            bot.difficulty =
                3;

            bot.isPlayer =
                false;

            bot.alive =
                remote.target.alive;

            if (
                typeof bot.health !==
                "number"
            ) {
                bot.health =
                    100;
            }

            try {

                if (
                    typeof bot.spawn ===
                    "function"
                ) {

                    bot.respawnT =
                        0;

                    bot.spawn();
                }

            } catch (e) {

                warn(
                    "bot.spawn() failed:",
                    e
                );
            }

            bot.update =
                function(dt) {

                    RemoteBots.updateBot(
                        remote,
                        dt
                    );
                };

            RemoteBots.applyImmediate(
                remote
            );

            RemoteBots.rebuildAvatars();

            RemoteBots.applyAvatars();

            log(
                "Remote bot attached:",
                remote.name,
                remote.id
            );
        },

        receive(
            id,
            state
        ) {

            id =
                String(id);

            let remote =
                State.remotes.get(id);

            if (!remote) {

                remote = {

                    id,

                    name:
                        String(
                            state.name ||
                            "Player"
                        ).slice(
                            0,
                            24
                        ),

                    team:
                        state.team ===
                        "T"
                            ? "T"
                            : "CT",

                    avatar:
                        typeof state.avatar ===
                        "string"
                            ? state.avatar
                            : null,

                    current: {
                        x:
                            Number(
                                state.x
                            ) || 0,

                        y:
                            Number(
                                state.y
                            ) || 0,

                        z:
                            Number(
                                state.z
                            ) || 0,

                        yaw:
                            Number(
                                state.yaw
                            ) || 0,

                        pitch:
                            Number(
                                state.pitch
                            ) || 0,

                        alive:
                            state.alive !==
                            false
                    },

                    target: {
                        x:
                            Number(
                                state.x
                            ) || 0,

                        y:
                            Number(
                                state.y
                            ) || 0,

                        z:
                            Number(
                                state.z
                            ) || 0,

                        yaw:
                            Number(
                                state.yaw
                            ) || 0,

                        pitch:
                            Number(
                                state.pitch
                            ) || 0,

                        alive:
                            state.alive !==
                            false
                    },

                    lastPacket:
                        performance.now(),

                    bot:
                        null,

                    lastAlive:
                        state.alive !==
                        false
                };

                State.remotes.set(
                    id,
                    remote
                );

                RemoteBots.attach(
                    remote
                );

                return;
            }

            const x =
                Number(
                    state.x
                );

            const y =
                Number(
                    state.y
                );

            const z =
                Number(
                    state.z
                );

            const yaw =
                Number(
                    state.yaw
                );

            const pitch =
                Number(
                    state.pitch
                );

            if (
                Number.isFinite(x)
            ) {
                remote.target.x =
                    x;
            }

            if (
                Number.isFinite(y)
            ) {
                remote.target.y =
                    y;
            }

            if (
                Number.isFinite(z)
            ) {
                remote.target.z =
                    z;
            }

            if (
                Number.isFinite(yaw)
            ) {
                remote.target.yaw =
                    yaw;
            }

            if (
                Number.isFinite(pitch)
            ) {
                remote.target.pitch =
                    pitch;
            }

            remote.target.alive =
                state.alive !==
                false;

            if (
                typeof state.avatar ===
                "string"
            ) {

                if (
                    remote.avatar !==
                    state.avatar
                ) {

                    remote.avatar =
                        state.avatar;

                    RemoteBots.applyAvatars();
                }

            } else if (
                state.avatar ===
                null
            ) {

                remote.avatar =
                    null;

                RemoteBots.applyAvatars();
            }

            if (
                state.name
            ) {

                remote.name =
                    String(
                        state.name
                    ).slice(
                        0,
                        24
                    );
            }

            if (
                state.team ===
                "T" ||
                state.team ===
                "CT"
            ) {

                if (
                    remote.team !==
                    state.team
                ) {

                    remote.team =
                        state.team;

                    if (
                        remote.bot
                    ) {
                        remote.bot.team =
                            state.team;
                    }
                }
            }

            remote.lastPacket =
                performance.now();

            if (
                !remote.bot
            ) {
                RemoteBots.attach(
                    remote
                );
            }
        },

        updateBot(
            remote,
            dt
        ) {

            const bot =
                remote.bot;

            if (
                !bot
            ) {
                return;
            }

            const delta =
                Math.max(
                    0.016,

                    Math.min(
                        Number(dt) ||
                        0.016,

                        0.1
                    )
                );

            const factor =
                1 -
                Math.exp(
                    -(
                        CONFIG.INTERPOLATION *
                        delta
                    ) /
                    100
                );

            const oldX =
                remote.current.x;

            const oldZ =
                remote.current.z;

            remote.current.x +=
                (
                    remote.target.x -
                    remote.current.x
                ) *
                factor;

            remote.current.y +=
                (
                    remote.target.y -
                    remote.current.y
                ) *
                factor;

            remote.current.z +=
                (
                    remote.target.z -
                    remote.current.z
                ) *
                factor;

            remote.current.yaw =
                RemoteBots.lerpAngle(
                    remote.current.yaw,

                    remote.target.yaw,

                    factor
                );

            remote.current.pitch +=
                (
                    remote.target.pitch -
                    remote.current.pitch
                ) *
                factor;

            remote.current.alive =
                remote.target.alive;

            const vx =
                (
                    remote.current.x -
                    oldX
                ) / delta;

            const vz =
                (
                    remote.current.z -
                    oldZ
                ) / delta;

            bot.x =
                remote.current.x;

            bot.y =
                remote.current.y;

            bot.z =
                remote.current.z;

            bot.yaw =
                remote.current.yaw;

            bot.pitch =
                remote.current.pitch;

            bot._lookPitch =
                remote.current.pitch;

            bot._visY =
                bot.y;

            bot.team =
                remote.team;

            bot.name =
                remote.name;

            /*
             * Do not overwrite health every frame.
             *
             * This lets the native damage system
             * actually damage the remote bot.
             */
            bot.alive =
                remote.current.alive;

            bot.vx =
                vx;

            bot.vy =
                0;

            bot.vz =
                vz;

            bot.onGround =
                true;

            try {

                if (
                    typeof bot._updateCS2Body ===
                    "function"
                ) {

                    bot._updateCS2Body(
                        delta,
                        getGame()
                    );
                }

            } catch (e) {

                if (
                    !bot.__connectionsBodyError
                ) {

                    bot.__connectionsBodyError =
                        true;

                    warn(
                        "CS2 body error:",
                        e
                    );
                }
            }

            try {

                const agent =
                    bot.cs2Agent;

                if (!agent) {
                    return;
                }

                if (
                    typeof agent.setTransform ===
                    "function"
                ) {

                    agent.setTransform(
                        bot.x,
                        bot._visY,
                        bot.z,
                        bot.yaw
                    );
                }

                if (
                    typeof agent.setPitch ===
                    "function"
                ) {

                    agent.setPitch(
                        bot._lookPitch ||
                        0
                    );
                }

                if (
                    typeof agent.update ===
                    "function"
                ) {

                    agent.update(
                        delta,
                        {
                            vx,

                            vz,

                            airborne:
                                false,

                            crouch:
                                0,

                            pitch:
                                bot._lookPitch ||
                                0
                        }
                    );
                }

                if (
                    agent.root
                ) {

                    agent.root.visible =
                        !!bot.alive;
                }

            } catch {}

            if (
                remote.lastAlive !==
                remote.current.alive
            ) {

                remote.lastAlive =
                    remote.current.alive;

                try {

                    if (
                        !remote.current.alive &&
                        typeof bot.cs2Agent?.die ===
                        "function"
                    ) {

                        bot.cs2Agent.die();
                    }

                } catch {}
            }

            RemoteBots.applyAvatars();
        },

        applyImmediate(remote) {

            const bot =
                remote.bot;

            if (
                !bot
            ) {
                return;
            }

            bot.x =
                remote.target.x;

            bot.y =
                remote.target.y;

            bot.z =
                remote.target.z;

            bot.yaw =
                remote.target.yaw;

            bot.pitch =
                remote.target.pitch;

            bot._lookPitch =
                remote.target.pitch;

            bot._visY =
                bot.y;

            bot.alive =
                remote.target.alive;

            try {

                const agent =
                    bot.cs2Agent;

                if (!agent) {
                    return;
                }

                if (
                    typeof agent.setTransform ===
                    "function"
                ) {

                    agent.setTransform(
                        bot.x,
                        bot._visY,
                        bot.z,
                        bot.yaw
                    );
                }

                if (
                    typeof agent.setPitch ===
                    "function"
                ) {

                    agent.setPitch(
                        bot._lookPitch ||
                        0
                    );
                }

                if (
                    typeof agent.update ===
                    "function"
                ) {

                    agent.update(
                        0.016,
                        {
                            vx: 0,
                            vz: 0,
                            airborne: false,
                            crouch: 0,
                            pitch:
                                bot._lookPitch ||
                                0
                        }
                    );
                }

                if (
                    agent.root
                ) {

                    agent.root.visible =
                        !!bot.alive;
                }

            } catch {}
        },

        remove(id) {

            id =
                String(id);

            const remote =
                State.remotes.get(
                    id
                );

            if (
                !remote
            ) {
                return;
            }

            const bot =
                remote.bot;

            if (
                bot
            ) {

                RemoteBots.destroyRemoteBot(
                    bot
                );
            }

            State.remotes.delete(
                id
            );

            RemoteBots.rebuildAvatars();

            UI.renderRoom();
        },

        destroyRemoteBot(bot) {

            if (!bot) {
                return;
            }

            try {

                bot.alive =
                    false;

                bot.health =
                    0;

            } catch {}

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
                    bot.cs2Agent?.root
                ) {

                    bot.cs2Agent.root.visible =
                        false;
                }

            } catch {}

            const game =
                getGame();

            const mgr =
                game?.botMgr;

            if (
                Array.isArray(
                    mgr?.bots
                )
            ) {

                const index =
                    mgr.bots.indexOf(
                        bot
                    );

                if (
                    index !== -1
                ) {

                    mgr.bots.splice(
                        index,
                        1
                    );
                }
            }

            bot.__connectionsRemote =
                false;

            bot.__connectionsRemoteId =
                null;

            bot.__connectionsPool =
                false;

            bot.update =
                function() {};
        },

        clear() {

            for (
                const remote
                of [
                    ...State.remotes.values()
                ]
            ) {

                if (
                    remote.bot
                ) {

                    RemoteBots.destroyRemoteBot(
                        remote.bot
                    );
                }
            }

            State.remotes.clear();

            RemoteBots.restoreOriginalBots();

            RemoteBots.rebuildAvatars();

            log(
                "Remote bots cleared."
            );
        },

        restoreOriginalBots() {

            const game =
                getGame();

            const mgr =
                game?.botMgr;

            if (
                !mgr
            ) {
                return;
            }

            if (
                !Array.isArray(
                    State.originalBots
                )
            ) {
                return;
            }

            try {

                mgr.bots.length =
                    0;

                for (
                    const bot
                    of State.originalBots
                ) {

                    if (!bot) {
                        continue;
                    }

                    bot.__connectionsRemoved =
                        false;

                    bot.__connectionsRemote =
                        false;

                    bot.__connectionsRemoteId =
                        null;

                    bot.__connectionsPool =
                        false;

                    if (
                        bot.__connectionsOriginalUpdate
                    ) {

                        bot.update =
                            bot.__connectionsOriginalUpdate;
                    }

                    try {

                        if (
                            typeof bot.spawn ===
                            "function"
                        ) {

                            bot.spawn();
                        }

                    } catch {}

                    try {

                        if (
                            bot.cs2Agent?.root
                        ) {

                            bot.cs2Agent.root.visible =
                                true;
                        }

                    } catch {}

                    mgr.bots.push(
                        bot
                    );
                }

            } catch (e) {

                warn(
                    "Failed to restore original bots:",
                    e
                );
            }

            State.originalBots =
                [];

            State.originalBotArray =
                null;

            State.botTemplate =
                null;

            log(
                "Original AI bots restored."
            );
        },

        rebuildAvatars() {

            const game =
                getGame();

            try {

                if (
                    game?.hud &&
                    typeof game.hud.buildAvatars ===
                    "function"
                ) {

                    game.hud.buildAvatars();
                }

            } catch (e) {

                warn(
                    "buildAvatars failed:",
                    e
                );
            }

            setTimeout(
                () => {
                    RemoteBots.applyAvatars();
                },
                50
            );
        },

        applyAvatars() {

            const game =
                getGame();

            if (!game) {
                return;
            }

            const lists = [];

            try {

                if (
                    Array.isArray(
                        game.hud?._avatars
                    )
                ) {

                    lists.push(
                        game.hud._avatars
                    );
                }

            } catch {}

            try {

                if (
                    Array.isArray(
                        game._avatars
                    )
                ) {

                    lists.push(
                        game._avatars
                    );
                }

            } catch {}

            for (
                const list
                of lists
            ) {

                for (
                    const item
                    of list
                ) {

                    const ent =
                        item?.ent;

                    if (
                        !ent ||
                        !ent.__connectionsRemote
                    ) {
                        continue;
                    }

                    const remoteId =
                        ent.__connectionsRemoteId;

                    const remote =
                        State.remotes.get(
                            String(
                                remoteId
                            )
                        );

                    if (
                        !remote
                    ) {
                        continue;
                    }

                    const avatar =
                        remote.avatar;

                    if (!avatar) {
                        continue;
                    }

                    const el =
                        item.el;

                    if (!el) {
                        continue;
                    }

                    try {

                        const img =
                            el.querySelector(
                                "img"
                            );

                        if (img) {

                            if (
                                !img.dataset
                                    .connectionsOriginalSrc
                            ) {

                                img.dataset
                                    .connectionsOriginalSrc =
                                    img.src;
                            }

                            img.src =
                                avatar;
                        }

                    } catch {}

                    try {

                        const bg =
                            el.querySelector(
                                ".CSGOAvatarImage"
                            );

                        if (bg) {

                            bg.style.backgroundImage =
                                `url("${avatar}")`;

                            bg.style.backgroundSize =
                                "100% 100%";

                            bg.style.backgroundPosition =
                                "center";

                            bg.style.backgroundRepeat =
                                "no-repeat";
                        }

                    } catch {}
                }
            }

            /*
             * Also cover scoreboard rows that
             * reference our remote native bot.
             */
            try {

                const rows =
                    document.querySelectorAll(
                        ".sb-row"
                    );

                for (
                    const row
                    of rows
                ) {

                    const name =
                        row.querySelector(
                            ".sb-name, .sb-row-name"
                        );

                    if (!name) {
                        continue;
                    }

                    const remote =
                        [
                            ...State.remotes.values()
                        ].find(
                            r =>
                                r.bot &&
                                String(
                                    r.name
                                ) ===
                                String(
                                    name.textContent
                                ).trim()
                        );

                    if (
                        !remote ||
                        !remote.avatar
                    ) {
                        continue;
                    }

                    const img =
                        row.querySelector(
                            "img"
                        );

                    if (img) {
                        img.src =
                            remote.avatar;
                    }

                    const bg =
                        row.querySelector(
                            ".CSGOAvatarImage"
                        );

                    if (bg) {
                        bg.style.backgroundImage =
                            `url("${remote.avatar}")`;
                    }
                }

            } catch {}
        },

        restoreAI() {
            RemoteBots.restoreOriginalBots();
        },

        lerpAngle(
            a,
            b,
            t
        ) {

            let diff =
                (
                    (
                        b -
                        a +
                        Math.PI
                    ) %
                    (
                        Math.PI *
                        2
                    )
                ) -
                Math.PI;

            return (
                a +
                diff * t
            );
        }
    };

    /*
     * =========================================================
     * LOCAL PLAYER SYNC
     * =========================================================
     */

    function sendLocalState() {

        if (
            !State.confirmedMatch ||
            !State.connected ||
            !State.room
        ) {
            return;
        }

        const game =
            getGame();

        const player =
            getPlayer();

        if (
            !game ||
            !player
        ) {
            return;
        }

        if (
            !isInsideMatch(
                game
            )
        ) {
            return;
        }

        const now =
            performance.now();

        const state = {

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
                ) || 0,

            yaw:
                Number(
                    player.yaw
                ) || 0,

            pitch:
                Number(
                    player.pitch
                ) || 0,

            alive:
                player.alive !==
                false,

            team:
                player.team ===
                "T"
                    ? "T"
                    : "CT",

            name:
                State.name
        };

        /*
         * Avatar is NOT sent every 50ms.
         * It is sent when changed and occasionally
         * so a player joining later can receive it.
         */
        const avatar =
            Avatar.get();

        if (
            State.avatarDirty ||
            (
                now -
                State.lastAvatarSent
            ) >=
            CONFIG.AVATAR_SEND_INTERVAL
        ) {

            state.avatar =
                avatar;

            State.avatarDirty =
                false;

            State.lastAvatarSent =
                now;
        }

        Network.send({

            type:
                "state",

            state
        });
    }

    function startSync() {

        stopSync();

        State.sendTimer =
            setInterval(
                sendLocalState,
                CONFIG.SEND_RATE
            );
    }

    function stopSync() {

        if (
            State.sendTimer
        ) {

            clearInterval(
                State.sendTimer
            );

            State.sendTimer =
                null;
        }
    }

    /*
     * =========================================================
     * TAB OUT / ONLINE MODE
     * =========================================================
     */

    const OnlineMode = {

        install() {

            /*
             * The browser still controls actual
             * rendering when the tab is hidden,
             * but we prevent Connections from treating
             * focus loss as a match end.
             */

            document.addEventListener(
                "visibilitychange",
                () => {

                    if (
                        !State.confirmedMatch
                    ) {
                        return;
                    }

                    /*
                     * Keep the game marked as playing
                     * when the game's pause logic exposes
                     * these fields.
                     */
                    const game =
                        getGame();

                    if (!game) {
                        return;
                    }

                    try {

                        if (
                            document.visibilityState ===
                            "visible"
                        ) {

                            if (
                                game.gameState !==
                                "playing"
                            ) {

                                if (
                                    game.state ===
                                    "playing"
                                ) {
                                    game.gameState =
                                        "playing";
                                }
                            }
                        }

                    } catch {}
                },
                true
            );

            /*
             * Some games pause on blur.
             * Do not let our monitor interpret
             * blur/focus as leaving the match.
             */
            window.addEventListener(
                "blur",
                () => {

                    if (
                        State.confirmedMatch
                    ) {

                        log(
                            "Window unfocused. Multiplayer remains active."
                        );
                    }

                },
                true
            );

            window.addEventListener(
                "focus",
                () => {

                    if (
                        State.confirmedMatch
                    ) {

                        const game =
                            getGame();

                        if (
                            game &&
                            game.state !==
                            "playing" &&
                            isInsideMatch(
                                game
                            )
                        ) {

                            try {
                                game.state =
                                    "playing";
                            } catch {}
                        }

                        State.avatarDirty =
                            true;
                    }

                },
                true
            );

            State.visibilityTimer =
                setInterval(
                    () => {

                        if (
                            !State.confirmedMatch
                        ) {
                            return;
                        }

                        /*
                         * WebSocket stays alive.
                         */
                        if (
                            State.connected &&
                            State.ws?.readyState ===
                            WebSocket.OPEN
                        ) {

                            Network.send({
                                type:
                                    "ping"
                            });
                        }

                        /*
                         * Re-apply remote avatars because
                         * the game's HUD can rebuild itself.
                         */
                        RemoteBots.applyAvatars();

                    },
                    1000
                );
        }
    };

    /*
     * =========================================================
     * MATCH END
     * =========================================================
     */

    function handleMatchEnd() {

        if (
            !State.confirmedMatch ||
            State.matchEnding
        ) {
            return;
        }

        State.matchEnding =
            true;

        log(
            "Match ended."
        );

        /*
         * IMPORTANT:
         *
         * Do NOT send end_room.
         *
         * Your current backend explicitly returned:
         * "unknown message type"
         *
         * So we only clean the local state and
         * send leave_room when applicable.
         */
        if (
            State.connected &&
            State.room
        ) {

            Network.send({
                type:
                    "leave_room"
            });
        }

        RemoteBots.clear();

        State.room =
            null;

        State.confirmedMatch =
            false;

        State.isHost =
            false;

        State.avatarDirty =
            true;

        UI.setMessage(
            "Match ended."
        );

        UI.renderRooms();

        UI.renderRoom();

        UI.updateStatus();
    }

    /*
     * =========================================================
     * ENGINE SCAN
     * =========================================================
     */

    function confirmMatch() {

        if (
            State.confirmedMatch
        ) {

            UI.setMessage(
                "Match already confirmed."
            );

            return;
        }

        const game =
            getGame();

        if (!game) {

            UI.setMessage(
                "Game engine not found."
            );

            warn(
                "window.game was not found."
            );

            return;
        }

        UI.setScanState(
            true
        );

        UI.setMessage(
            "Scanning game engine..."
        );

        log(
            "Scanning game engine..."
        );

        setTimeout(
            () => {

                const currentGame =
                    getGame();

                if (
                    !currentGame
                ) {

                    UI.setScanState(
                        false
                    );

                    UI.setMessage(
                        "Game engine disappeared."
                    );

                    return;
                }

                const playing =
                    isInsideMatch(
                        currentGame
                    );

                log(
                    "Engine scan:",
                    {
                        playing,

                        state:
                            currentGame.state,

                        gameState:
                            currentGame.gameState,

                        inMatch:
                            currentGame.inMatch,

                        player:
                            !!currentGame.player,

                        botManager:
                            !!currentGame.botMgr,

                        botCount:
                            currentGame
                                .botMgr
                                ?.bots
                                ?.length
                    }
                );

                if (!playing) {

                    UI.setScanState(
                        false
                    );

                    UI.setMessage(
                        "You must be inside a match."
                    );

                    return;
                }

                const poolReady =
                    RemoteBots.preparePool();

                if (!poolReady) {

                    UI.setScanState(
                        false
                    );

                    UI.setMessage(
                        "Native bot system was not found."
                    );

                    return;
                }

                State.game =
                    currentGame;

                State.confirmedMatch =
                    true;

                State.matchEnding =
                    false;

                State.avatarDirty =
                    true;

                UI.setScanState(
                    false
                );

                UI.setMessage(
                    "Match detected. Connecting..."
                );

                if (
                    State.connected
                ) {

                    Network.send({
                        type:
                            "list_rooms"
                    });

                } else {

                    Network.connect();
                }

                UI.updateStatus();

            },
            80
        );
    }

    /*
     * =========================================================
     * GAME MONITOR
     * =========================================================
     */

    function monitorGame() {

        const game =
            getGame();

        if (!game) {
            return;
        }

        if (
            State.game !==
            game
        ) {

            State.game =
                game;

            log(
                "Game engine detected."
            );
        }

        /*
         * Only treat an actual match state
         * change as match ending.
         *
         * Browser blur/tab visibility is ignored.
         */
        if (
            State.confirmedMatch &&
            State.room
        ) {

            if (
                !isInsideMatch(
                    game
                )
            ) {

                handleMatchEnd();
            }
        }
    }

    State.monitorTimer =
        setInterval(
            monitorGame,
            CONFIG.MATCH_CHECK_RATE
        );

    /*
     * =========================================================
     * UI
     * =========================================================
     */

    const UI = {

        root:
            null,

        roomList:
            null,

        roomInfo:
            null,

        status:
            null,

        message:
            null,

        scanButton:
            null,

        avatarPreview:
            null,

        avatarButton:
            null,

        avatarToggle:
            null,

        create() {

            if (
                document.getElementById(
                    "connections-real-ui"
                )
            ) {
                return;
            }

            GM_addStyle(`
                #connections-real-ui {
                    position: fixed;
                    left: 40px;
                    top: 120px;
                    width: 430px;
                    max-height: 760px;
                    background: rgba(13,13,18,.98);
                    color: #eee;
                    border: 1px solid #333;
                    border-radius: 14px;
                    z-index: 2147483647;
                    font-family: Arial,sans-serif;
                    box-shadow: 0 20px 70px rgba(0,0,0,.65);
                    overflow: hidden;
                    display: none;
                }

                #connections-real-ui * {
                    box-sizing: border-box;
                }

                .cr-head {
                    padding: 15px 17px;
                    background: #17171f;
                    border-bottom: 1px solid #292933;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .cr-title {
                    font-size: 17px;
                    font-weight: 800;
                }

                .cr-status {
                    font-size: 11px;
                    color: #888;
                    margin-top: 3px;
                }

                .cr-body {
                    padding: 15px;
                    overflow-y: auto;
                    max-height: 690px;
                }

                .cr-section {
                    margin-bottom: 14px;
                }

                .cr-label {
                    color: #999;
                    font-size: 11px;
                    text-transform: uppercase;
                    letter-spacing: .08em;
                    margin-bottom: 7px;
                }

                .cr-input {
                    width: 100%;
                    border: 1px solid #343440;
                    background: #101016;
                    color: white;
                    border-radius: 8px;
                    padding: 10px;
                    outline: none;
                }

                .cr-input:focus {
                    border-color: #7167ff;
                }

                .cr-row {
                    display: flex;
                    gap: 8px;
                }

                .cr-button {
                    border: 0;
                    border-radius: 8px;
                    padding: 9px 12px;
                    background: #262631;
                    color: #eee;
                    cursor: pointer;
                    font-weight: 700;
                }

                .cr-button:hover {
                    background: #343442;
                }

                .cr-button:disabled {
                    opacity: .55;
                    cursor: default;
                }

                .cr-primary {
                    background: #665cff;
                }

                .cr-primary:hover {
                    background: #766cff;
                }

                .cr-danger {
                    background: #8e3030;
                }

                .cr-scan {
                    width: 100%;
                    padding: 14px;
                    font-size: 14px;
                    margin-bottom: 14px;
                    background: #665cff;
                }

                .cr-scan:hover {
                    background: #766cff;
                }

                .cr-room {
                    background: #111118;
                    border: 1px solid #292933;
                    border-radius: 9px;
                    padding: 11px;
                    margin-bottom: 7px;
                }

                .cr-room-name {
                    font-weight: 800;
                }

                .cr-room-meta {
                    color: #888;
                    font-size: 11px;
                    margin-top: 4px;
                }

                .cr-room-actions {
                    margin-top: 8px;
                }

                .cr-message {
                    font-size: 12px;
                    color: #aaa;
                    min-height: 17px;
                    margin-top: 8px;
                }

                .cr-empty {
                    padding: 20px;
                    text-align: center;
                    color: #777;
                    border: 1px dashed #30303a;
                    border-radius: 9px;
                }

                .cr-room-current {
                    padding: 12px;
                    border: 1px solid #39365d;
                    background: #17162a;
                    border-radius: 9px;
                }

                .cr-match-ok {
                    color: #71d58b;
                    font-size: 11px;
                    margin-top: 5px;
                }

                .cr-match-no {
                    color: #e4c96b;
                    font-size: 11px;
                    margin-top: 5px;
                }

                .cr-avatar-box {
                    display: flex;
                    gap: 12px;
                    align-items: center;
                    background: #111118;
                    border: 1px solid #292933;
                    border-radius: 10px;
                    padding: 10px;
                }

                .cr-avatar-preview {
                    width: 58px;
                    height: 58px;
                    border-radius: 9px;
                    background: #20202a;
                    border: 1px solid #3a3a48;
                    object-fit: cover;
                    display: block;
                }

                .cr-avatar-info {
                    flex: 1;
                    min-width: 0;
                }

                .cr-avatar-name {
                    font-weight: 800;
                    font-size: 13px;
                }

                .cr-avatar-state {
                    color: #888;
                    font-size: 11px;
                    margin-top: 3px;
                    margin-bottom: 8px;
                }

                .cr-avatar-actions {
                    display: flex;
                    gap: 6px;
                    flex-wrap: wrap;
                }

                .cr-file {
                    display: none;
                }
            `);

            const root =
                document.createElement(
                    "div"
                );

            root.id =
                "connections-real-ui";

            root.innerHTML = `
                <div class="cr-head">

                    <div>

                        <div class="cr-title">
                            Connections
                        </div>

                        <div
                            class="cr-status"
                            id="cr-status"
                        >
                            Waiting for match
                        </div>

                    </div>

                    <button
                        class="cr-button"
                        id="cr-close"
                    >
                        ×
                    </button>

                </div>

                <div class="cr-body">

                    <div class="cr-section">

                        <button
                            class="cr-button cr-primary cr-scan"
                            id="cr-scan"
                        >
                            I AM IN A MATCH
                        </button>

                        <div
                            id="cr-match-state"
                            class="cr-match-no"
                        >
                            Click this after entering a match.
                        </div>

                    </div>

                    <div class="cr-section">

                        <div class="cr-label">
                            Player
                        </div>

                        <div class="cr-row">

                            <input
                                class="cr-input"
                                id="cr-name"
                                placeholder="Username"
                            >

                            <button
                                class="cr-button"
                                id="cr-name-save"
                            >
                                Save
                            </button>

                        </div>

                    </div>

                    <div class="cr-section">

                        <div class="cr-label">
                            Avatar
                        </div>

                        <div class="cr-avatar-box">

                            <img
                                class="cr-avatar-preview"
                                id="cr-avatar-preview"
                                alt=""
                            >

                            <div class="cr-avatar-info">

                                <div
                                    class="cr-avatar-name"
                                >
                                    Player Avatar
                                </div>

                                <div
                                    class="cr-avatar-state"
                                    id="cr-avatar-state"
                                >
                                    No avatar
                                </div>

                                <div
                                    class="cr-avatar-actions"
                                >

                                    <button
                                        class="cr-button cr-primary"
                                        id="cr-avatar-button"
                                    >
                                        Choose Avatar
                                    </button>

                                    <button
                                        class="cr-button"
                                        id="cr-avatar-toggle"
                                    >
                                        Disable
                                    </button>

                                    <button
                                        class="cr-button"
                                        id="cr-avatar-reset"
                                    >
                                        Reset
                                    </button>

                                </div>

                            </div>

                        </div>

                        <input
                            type="file"
                            id="cr-avatar-file"
                            class="cr-file"
                            accept="image/*"
                        >

                    </div>

                    <div class="cr-section">

                        <div class="cr-label">
                            Current room
                        </div>

                        <div id="cr-room-info">
                            Not in a room
                        </div>

                    </div>

                    <div class="cr-section">

                        <div class="cr-label">
                            Create room
                        </div>

                        <div class="cr-row">

                            <input
                                class="cr-input"
                                id="cr-room-name"
                                placeholder="Room name"
                            >

                            <input
                                class="cr-input"
                                id="cr-room-max"
                                type="number"
                                min="2"
                                max="32"
                                value="8"
                                style="width:80px"
                            >

                        </div>

                        <button
                            class="cr-button cr-primary"
                            id="cr-create"
                            style="margin-top:8px;width:100%"
                        >
                            Create Room
                        </button>

                    </div>

                    <div class="cr-section">

                        <div class="cr-label">
                            Servers
                        </div>

                        <div id="cr-rooms"></div>

                    </div>

                    <div
                        class="cr-message"
                        id="cr-message"
                    ></div>

                </div>
            `;

            document.body.appendChild(
                root
            );

            this.root =
                root;

            this.roomList =
                root.querySelector(
                    "#cr-rooms"
                );

            this.roomInfo =
                root.querySelector(
                    "#cr-room-info"
                );

            this.status =
                root.querySelector(
                    "#cr-status"
                );

            this.message =
                root.querySelector(
                    "#cr-message"
                );

            this.scanButton =
                root.querySelector(
                    "#cr-scan"
                );

            this.avatarPreview =
                root.querySelector(
                    "#cr-avatar-preview"
                );

            this.avatarButton =
                root.querySelector(
                    "#cr-avatar-button"
                );

            this.avatarToggle =
                root.querySelector(
                    "#cr-avatar-toggle"
                );

            const nameInput =
                root.querySelector(
                    "#cr-name"
                );

            nameInput.value =
                State.name;

            root.querySelector(
                "#cr-close"
            ).onclick =
                () => {
                    UI.toggle(false);
                };

            this.scanButton.onclick =
                () => {
                    confirmMatch();
                };

            this.avatarButton.onclick =
                () => {

                    root.querySelector(
                        "#cr-avatar-file"
                    ).click();

                };

            root.querySelector(
                "#cr-avatar-file"
            ).onchange =
                event => {

                    Avatar.setFile(
                        event.target.files?.[0]
                    );

                    event.target.value =
                        "";
                };

            this.avatarToggle.onclick =
                () => {
                    Avatar.toggle();
                };

            root.querySelector(
                "#cr-avatar-reset"
            ).onclick =
                () => {
                    Avatar.reset();
                };

            root.querySelector(
                "#cr-create"
            ).onclick =
                () => {

                    if (
                        !State.confirmedMatch
                    ) {

                        UI.setMessage(
                            "Click I AM IN A MATCH first."
                        );

                        return;
                    }

                    const name =
                        root.querySelector(
                            "#cr-room-name"
                        )
                            .value
                            .trim();

                    const max =
                        root.querySelector(
                            "#cr-room-max"
                        )
                            .value;

                    Network.createRoom(
                        name ||
                        "Connections Room",

                        max
                    );
                };

            root.querySelector(
                "#cr-name-save"
            ).onclick =
                () => {

                    const value =
                        nameInput.value
                            .trim();

                    if (!value) {
                        return;
                    }

                    State.name =
                        value.slice(
                            0,
                            24
                        );

                    try {

                        localStorage.setItem(
                            "connections_player_name",
                            State.name
                        );

                    } catch {}

                    State.avatarDirty =
                        true;

                    UI.setMessage(
                        "Username saved."
                    );
                };

            this.renderRooms();

            this.renderRoom();

            this.updateAvatar();

            this.updateStatus();
        },

        updateAvatar() {

            if (
                !this.avatarPreview
            ) {
                return;
            }

            const avatar =
                Avatar.get();

            if (avatar) {

                this.avatarPreview.src =
                    avatar;

                this.avatarPreview.style.display =
                    "block";

            } else {

                this.avatarPreview.removeAttribute(
                    "src"
                );

                this.avatarPreview.style.display =
                    "none";
            }

            const state =
                this.root?.querySelector(
                    "#cr-avatar-state"
                );

            if (state) {

                if (!State.avatar) {

                    state.textContent =
                        "No avatar";

                } else if (
                    State.avatarEnabled
                ) {

                    state.textContent =
                        "Enabled • synced to room";

                } else {

                    state.textContent =
                        "Disabled";
                }
            }

            if (
                this.avatarToggle
            ) {

                this.avatarToggle.textContent =
                    State.avatarEnabled
                        ? "Disable"
                        : "Enable";
            }
        },

        toggle(force) {

            this.create();

            State.ui.open =
                typeof force ===
                "boolean"
                    ? force
                    : !State.ui.open;

            this.root.style.display =
                State.ui.open
                    ? "block"
                    : "none";

            if (
                State.ui.open
            ) {

                this.renderRooms();

                this.renderRoom();

                this.updateAvatar();

                this.updateStatus();
            }
        },

        setScanState(
            scanning
        ) {

            if (
                !this.scanButton
            ) {
                return;
            }

            this.scanButton.disabled =
                scanning;

            this.scanButton.textContent =
                scanning
                    ? "SCANNING GAME..."
                    : "I AM IN A MATCH";
        },

        updateStatus() {

            if (
                !this.status
            ) {
                return;
            }

            if (
                State.room
            ) {

                this.status.textContent =
                    `Online • Room ${State.room}`;

                this.status.style.color =
                    "#71d58b";

                return;
            }

            if (
                State.connected
            ) {

                this.status.textContent =
                    "Online • No room";

                this.status.style.color =
                    "#71d58b";

                return;
            }

            if (
                State.connecting
            ) {

                this.status.textContent =
                    "Connecting...";

                this.status.style.color =
                    "#e4c96b";

                return;
            }

            if (
                State.confirmedMatch
            ) {

                this.status.textContent =
                    "Match confirmed";

                this.status.style.color =
                    "#71d58b";

                return;
            }

            this.status.textContent =
                "Waiting for match";

            this.status.style.color =
                "#888";
        },

        setMessage(
            text
        ) {

            if (
                !this.message
            ) {
                return;
            }

            this.message.textContent =
                String(
                    text || ""
                );

            clearTimeout(
                this._messageTimer
            );

            this._messageTimer =
                setTimeout(
                    () => {

                        if (
                            this.message
                        ) {

                            this.message.textContent =
                                "";
                        }

                    },
                    5000
                );
        },

        renderRooms() {

            if (
                !this.roomList
            ) {
                return;
            }

            const rooms =
                Array.isArray(
                    State.rooms
                )
                    ? State.rooms
                    : [];

            if (
                !rooms.length
            ) {

                this.roomList.innerHTML = `
                    <div class="cr-empty">
                        No rooms available.
                    </div>
                `;

                return;
            }

            this.roomList.innerHTML =
                "";

            for (
                const room
                of rooms
            ) {

                const id =
                    roomId(
                        room
                    );

                if (
                    !id
                ) {
                    continue;
                }

                const name =
                    room.name ||
                    "Unnamed Room";

                let players =
                    room.players ??
                    room.playerCount ??
                    room.currentPlayers ??
                    room.count;

                if (
                    players == null
                ) {

                    if (
                        Array.isArray(
                            room.clients
                        )
                    ) {

                        players =
                            room.clients.length;

                    } else if (
                        room.clients &&
                        typeof room.clients ===
                        "object"
                    ) {

                        players =
                            Object.keys(
                                room.clients
                            ).length;

                    } else {

                        players = 0;
                    }
                }

                const max =
                    Number(
                        room.maxPlayers ??
                        room.max ??
                        8
                    ) || 8;

                const div =
                    document.createElement(
                        "div"
                    );

                div.className =
                    "cr-room";

                div.innerHTML = `
                    <div class="cr-room-name">
                        ${escapeHtml(name)}
                    </div>

                    <div class="cr-room-meta">
                        ${Number(players) || 0}/${max} players
                    </div>

                    <div class="cr-room-actions">

                        <button
                            class="cr-button cr-primary"
                        >
                            ${
                                String(
                                    State.room
                                ) ===
                                String(id)
                                    ? "Joined"
                                    : "Join"
                            }
                        </button>

                    </div>
                `;

                const button =
                    div.querySelector(
                        "button"
                    );

                if (
                    String(
                        State.room
                    ) ===
                    String(id)
                ) {

                    button.disabled =
                        true;

                } else {

                    button.onclick =
                        () => {

                            if (
                                !State.confirmedMatch
                            ) {

                                UI.setMessage(
                                    "Click I AM IN A MATCH first."
                                );

                                return;
                            }

                            Network.joinRoom(
                                id
                            );
                        };
                }

                this.roomList.appendChild(
                    div
                );
            }
        },

        renderRoom() {

            if (
                !this.roomInfo
            ) {
                return;
            }

            if (
                !State.room
            ) {

                this.roomInfo.innerHTML = `
                    <div style="color:#777">
                        Not in a room
                    </div>
                `;

                this.updateStatus();

                return;
            }

            const room =
                getRoomObject(
                    State.room
                );

            const name =
                room?.name ||
                State.room;

            const players =
                room?.players ??
                room?.playerCount ??
                room?.currentPlayers ??
                (
                    State.remotes.size +
                    1
                );

            const max =
                room?.maxPlayers ??
                room?.max ??
                8;

            this.roomInfo.innerHTML = `
                <div class="cr-room-current">

                    <b>
                        ${escapeHtml(name)}
                    </b>

                    <div
                        style="
                            color:#999;
                            font-size:11px;
                            margin-top:4px
                        "
                    >
                        ${players}/${max} players
                    </div>

                    <div
                        style="
                            color:#777;
                            font-size:10px;
                            margin-top:3px
                        "
                    >
                        ${
                            State.isHost
                                ? "Host"
                                : "Client"
                        }
                    </div>

                    <button
                        class="cr-button cr-danger"
                        id="cr-leave"
                        style="margin-top:9px"
                    >
                        Leave Room
                    </button>

                </div>
            `;

            const leave =
                this.roomInfo.querySelector(
                    "#cr-leave"
                );

            if (
                leave
            ) {

                leave.onclick =
                    () => {
                        Network.leaveRoom();
                    };
            }

            this.updateStatus();
        }
    };

    function escapeHtml(
        value
    ) {

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

    /*
     * =========================================================
     * BACKSPACE
     * =========================================================
     */

    document.addEventListener(
        "keydown",

        event => {

            if (
                event.key !==
                "Backspace"
            ) {
                return;
            }

            if (
                event.target.matches(
                    "input, textarea"
                )
            ) {
                return;
            }

            event.preventDefault();

            UI.toggle();

        },

        true
    );

    /*
     * =========================================================
     * START
     * =========================================================
     */

    OnlineMode.install();

    UI.create();

    startSync();

    log(
        `Connections ${CONFIG.VERSION} loaded.`
    );

    log(
        "Press [Backspace] to open."
    );

    log(
        'Click "I AM IN A MATCH" after entering a match.'
    );

    /*
     * =========================================================
     * DEBUG
     * =========================================================
     */

    PAGE.__connections_multiplayer = {

        state:
            State,

        network:
            Network,

        remoteBots:
            RemoteBots,

        avatar:
            Avatar,

        getGame,

        getPlayer,

        isInsideMatch,

        confirmMatch,

        debug() {

            const game =
                getGame();

            console.log(
                "[Connections] DEBUG",

                {

                    version:
                        CONFIG.VERSION,

                    connected:
                        State.connected,

                    connecting:
                        State.connecting,

                    confirmedMatch:
                        State.confirmedMatch,

                    room:
                        State.room,

                    id:
                        State.id,

                    name:
                        State.name,

                    localAvatar:
                        !!Avatar.get(),

                    avatarEnabled:
                        State.avatarEnabled,

                    gameState:
                        game?.state,

                    gameGameState:
                        game?.gameState,

                    botCount:
                        game?.botMgr
                            ?.bots
                            ?.length,

                    originalBots:
                        State.originalBots
                            ?.length,

                    remoteCount:
                        State.remotes.size,

                    remoteBots:
                        game?.botMgr
                            ?.bots
                            ?.filter(
                                b =>
                                    b?.__connectionsRemote
                            )
                            ?.length,

                    remotes:
                        [
                            ...State.remotes.values()
                        ].map(
                            r => ({

                                id:
                                    r.id,

                                name:
                                    r.name,

                                team:
                                    r.team,

                                avatar:
                                    !!r.avatar,

                                bot:
                                    !!r.bot,

                                x:
                                    r.current.x,

                                y:
                                    r.current.y,

                                z:
                                    r.current.z,

                                yaw:
                                    r.current.yaw,

                                pitch:
                                    r.current.pitch,

                                alive:
                                    r.current.alive
                            })
                        )
                }
            );
        }
    };

})();
