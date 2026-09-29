// ==UserScript==
// @name         Connections
// @namespace    conn
// @version      1.2.0
// @description  clutcher.io multiplayer
// @match        *://clutcher.io/*
// @match        *://*.clutcher.io/*
// @grant        unsafeWindow
// @grant        GM_addStyle
// @connect      able-vpn-star-constitutional.trycloudflare.com
// ==/UserScript==

(() => {
    "use strict";

    const VERSION = "1.2.0";

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
        roomData: null,

        joinedRoom: false,
        leavingRoom: false,

        confirmedMatch: false,

        game: null,
        botManager: null,
        botArrayKey: "bots",

        originalBots: [],
        botPool: [],

        remotes: new Map(),

        dead: false,

        localAvatar:
            localStorage.getItem("pp-avatar") ||
            null,

        lastPosition: null,

        stateTimer: null,
        monitorTimer: null,

        UI: {},

        chat: {
            open: false,
            lobbyOpen: false,
            messages: [],
            maxMessages: 80,
            overlayTimers: new Map()
        }
    };

    const log = (...args) =>
        console.log("[Connections]", ...args);

    const warn = (...args) =>
        console.warn("[Connections]", ...args);

    const error = (...args) =>
        console.error("[Connections]", ...args);

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

        const w =
            typeof unsafeWindow !== "undefined"
                ? unsafeWindow
                : window;

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

        for (const player of candidates) {
            if (
                player &&
                typeof player === "object"
            ) {
                return player;
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
                game.match.started === true ||
                game.match.isStarted === true
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

    function NetworkSend(type, data = {}) {
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

        chat(text) {
            const clean =
                String(text || "")
                    .trim()
                    .slice(0, 300);

            if (!clean) {
                return;
            }

            if (!State.joinedRoom) {
                return;
            }

            NetworkSend(
                "chat",
                {
                    text: clean
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
                    this.handleRoomJoined(msg);
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
                    updateCurrentRoom();
                    break;

                case "leave":
                    if (msg.id) {
                        removeRemote(
                            String(msg.id)
                        );
                    }

                    updateRoomList();
                    updateCurrentRoom();

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
                    handleStateMessage(msg);
                    break;

                case "chat":
                    receiveChat(msg);
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
                    handleServerError(msg);
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
            updateCurrentRoom();
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
       CHAT
    ========================================================= */

    function receiveChat(msg) {
        const name =
            String(
                msg.name ||
                "Player"
            ).slice(0, 32);

        const text =
            String(
                msg.text ||
                ""
            ).slice(0, 300);

        if (!text) {
            return;
        }

        const entry = {
            id:
                String(
                    msg.id ||
                    ""
                ),

            name,
            text,
            time: Date.now()
        };

        State.chat.messages.push(entry);

        if (
            State.chat.messages.length >
            State.chat.maxMessages
        ) {
            State.chat.messages.shift();
        }

        renderLobbyChat();
        showGameChat(entry);
    }

    function showGameChat(entry) {
        const box =
            State.UI.gameChat;

        if (!box) {
            return;
        }

        const row =
            document.createElement(
                "div"
            );

        row.className =
            "conn-game-chat-row";

        const name =
            document.createElement(
                "span"
            );

        name.className =
            "conn-game-chat-name";

        name.textContent =
            entry.name + ":";

        const text =
            document.createElement(
                "span"
            );

        text.className =
            "conn-game-chat-text";

        text.textContent =
            " " + entry.text;

        row.appendChild(name);
        row.appendChild(text);

        box.appendChild(row);

        while (
            box.children.length >
            8
        ) {
            box.firstChild.remove();
        }

        clearTimeout(
            State.chat.overlayTimers.get(
                row
            )
        );

        const timer =
            setTimeout(
                () => {
                    row.classList.add(
                        "conn-chat-fade"
                    );

                    setTimeout(
                        () => {
                            row.remove();
                        },
                        500
                    );
                },
                7000
            );

        State.chat.overlayTimers.set(
            row,
            timer
        );
    }

    function openChat() {
        if (
            !State.joinedRoom
        ) {
            return;
        }

        if (
            State.chat.open
        ) {
            return;
        }

        State.chat.open = true;

        const input =
            State.UI.chatInput;

        if (!input) {
            return;
        }

        input.value = "";
        input.style.display =
            "block";

        input.focus();

        if (State.UI.chatHint) {
            State.UI.chatHint.style.display =
                "block";
        }
    }

    function closeChat() {
        State.chat.open = false;

        const input =
            State.UI.chatInput;

        if (input) {
            input.value = "";
            input.style.display =
                "none";
        }

        if (State.UI.chatHint) {
            State.UI.chatHint.style.display =
                "none";
        }
    }

    function submitChat() {
        const input =
            State.UI.chatInput;

        if (!input) {
            closeChat();
            return;
        }

        const text =
            input.value.trim();

        if (text) {
            Network.chat(text);
        }

        closeChat();
    }

    function renderLobbyChat() {
        const box =
            State.UI.lobbyChatMessages;

        if (!box) {
            return;
        }

        box.innerHTML = "";

        for (
            const message of
            State.chat.messages
        ) {
            const row =
                document.createElement(
                    "div"
                );

            row.className =
                "conn-lobby-chat-row";

            const name =
                document.createElement(
                    "span"
                );

            name.className =
                "conn-lobby-chat-name";

            name.textContent =
                message.name + ":";

            const text =
                document.createElement(
                    "span"
                );

            text.className =
                "conn-lobby-chat-text";

            text.textContent =
                " " + message.text;

            row.appendChild(name);
            row.appendChild(text);

            box.appendChild(row);
        }

        box.scrollTop =
            box.scrollHeight;
    }

    function clearChat() {
        State.chat.messages = [];

        renderLobbyChat();

        if (State.UI.gameChat) {
            State.UI.gameChat.innerHTML = "";
        }
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

        for (
            const data of
            list
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
                        "ct",

                    x:
                        Number(data.x) ||
                        0,

                    y:
                        Number(data.y) ||
                        0,

                    z:
                        Number(data.z) ||
                        0,

                    targetX:
                        Number(data.x) ||
                        0,

                    targetY:
                        Number(data.y) ||
                        0,

                    targetZ:
                        Number(data.z) ||
                        0,

                    yaw:
                        Number(data.yaw) ||
                        0,

                    pitch:
                        Number(data.pitch) ||
                        0,

                    targetYaw:
                        Number(data.yaw) ||
                        0,

                    targetPitch:
                        Number(data.pitch) ||
                        0,

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

                    pooledBot: false
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
                Number(data.x) ||
                0;

            remote.targetY =
                Number(data.y) ||
                0;

            remote.targetZ =
                Number(data.z) ||
                0;

            remote.targetYaw =
                Number(data.yaw) ||
                0;

            remote.targetPitch =
                Number(data.pitch) ||
                0;

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
                    createRemoteBot(remote);
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

        /*
         * This is intentionally first.
         *
         * The actual game uses:
         *
         * window.game.botMgr.bots
         */
        const candidates = [
            game.botMgr,
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

    function getBotArray(manager) {
        if (!manager) {
            return null;
        }

        /*
         * Actual Clutcher path.
         */
        if (
            Array.isArray(
                manager.bots
            )
        ) {
            State.botArrayKey =
                "bots";

            return manager.bots;
        }

        const keys = [
            "agents",
            "entities",
            "players"
        ];

        for (
            const key of
            keys
        ) {
            if (
                Array.isArray(
                    manager[key]
                )
            ) {
                State.botArrayKey =
                    key;

                return manager[key];
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
            if (
                bot.cs2Agent &&
                bot.cs2Agent.root
            ) {
                bot.cs2Agent.root.visible =
                    false;
            }
        } catch {}

        try {
            if (
                typeof bot.setVisible ===
                "function"
            ) {
                bot.setVisible(false);
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
            if (
                bot.cs2Agent &&
                bot.cs2Agent.root
            ) {
                bot.cs2Agent.root.visible =
                    true;
            }
        } catch {}

        try {
            if (
                typeof bot.setVisible ===
                "function"
            ) {
                bot.setVisible(true);
            }
        } catch {}
    }

    function prepareBots() {
        const game =
            getGame();

        const manager =
            game?.botMgr ||
            getBotManager();

        if (!manager) {
            warn(
                "botMgr not found."
            );

            return false;
        }

        State.game =
            game;

        State.botManager =
            manager;

        const arr =
            manager.bots;

        /*
         * Exact path proven by the user's
         * console test:
         *
         * window.game.botMgr.bots
         */
        if (
            !Array.isArray(arr)
        ) {
            warn(
                "game.botMgr.bots is not an array."
            );

            return false;
        }

        if (
            State.originalBots.length
        ) {
            return true;
        }

        /*
         * Capture the REAL existing bots.
         *
         * No constructor needed.
         */
        const bots =
            arr.slice();

        for (
            const bot of
            bots
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

            /*
             * Make the object less likely
             * to keep behaving as a normal AI.
             */
            try {
                bot.isPlayer = true;
            } catch {}

            try {
                bot.aiEnabled = false;
            } catch {}

            try {
                bot.enabled = false;
            } catch {}

            try {
                bot.alive = false;
            } catch {}
        }

        /*
         * These objects are now our remote-player pool.
         */
        State.botPool =
            State.originalBots.slice();

        /*
         * Remove the originals from the
         * active bot manager.
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
            "Remote bot pool:",
            State.botPool.length
        );

        /*
         * The constructor is only diagnostic now.
         * We don't depend on it.
         */
        try {
            const found =
                bots.find(
                    b =>
                        b &&
                        b.team !== undefined
                );

            if (found) {
                log(
                    "Verified bot constructor:",
                    found.constructor
                );
            }
        } catch {}

        return true;
    }

    function addToBotManager(bot) {
        const manager =
            getBotManager();

        if (
            !manager ||
            !bot
        ) {
            return false;
        }

        const arr =
            getBotArray(manager);

        if (!arr) {
            return false;
        }

        if (
            !arr.includes(bot)
        ) {
            arr.push(bot);
        }

        return true;
    }

    function removeBotFromManager(bot) {
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
            const key of
            keys
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
                ) !== -1
            ) {
                arr.splice(
                    index,
                    1
                );
            }
        }
    }

    function getFreePoolBot() {
        for (
            const bot of
            State.botPool
        ) {
            if (!bot) {
                continue;
            }

            let used = false;

            for (
                const remote of
                State.remotes.values()
            ) {
                if (
                    remote.bot ===
                    bot
                ) {
                    used = true;
                    break;
                }
            }

            if (!used) {
                return bot;
            }
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

        try {
            bot.isPlayer =
                true;
        } catch {}

        try {
            bot.aiEnabled =
                false;
        } catch {}

        try {
            bot.difficulty =
                0;
        } catch {}

        if (
            remote.avatar
        ) {
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

    function createRemoteBot(remote) {
        if (
            !remote ||
            remote.dead ||
            remote.bot
        ) {
            return;
        }

        const bot =
            getFreePoolBot();

        if (!bot) {
            warn(
                "No free original bot available for:",
                remote.name
            );

            return;
        }

        remote.bot =
            bot;

        remote.pooledBot =
            true;

        applyRemoteMetadata(
            bot,
            remote
        );

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
                typeof bot.init ===
                "function"
            ) {
                bot.init();
            }
        } catch {}

        addToBotManager(bot);

        showBot(bot);

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
            "REMOTE CREATED FROM POOL:",
            remote.name,
            remote.id
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

        try {
            if (bot.position) {
                bot.position.x = x;
                bot.position.y = y;
                bot.position.z = z;
                return;
            }
        } catch {}

        try {
            if (
                bot.transform &&
                bot.transform.position
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
                bot.cs2Agent &&
                bot.cs2Agent.root &&
                bot.cs2Agent.root.position
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
                bot.root &&
                bot.root.position
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
            if (bot.rotation) {
                bot.rotation.x =
                    pitch;

                bot.rotation.y =
                    yaw;

                return;
            }
        } catch {}

        try {
            if (bot.eulerAngles) {
                bot.eulerAngles.x =
                    pitch;

                bot.eulerAngles.y =
                    yaw;

                return;
            }
        } catch {}

        try {
            if (
                bot.transform &&
                bot.transform.rotation
            ) {
                bot.transform.rotation.x =
                    pitch;

                bot.transform.rotation.y =
                    yaw;

                return;
            }
        } catch {}

        try {
            if (
                bot.root &&
                bot.root.rotation
            ) {
                bot.root.rotation.x =
                    pitch;

                bot.root.rotation.y =
                    yaw;

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
                !remote.bot
            ) {
                if (
                    remote.alive &&
                    !remote.dead
                ) {
                    createRemoteBot(
                        remote
                    );
                }

                continue;
            }

            if (
                remote.dead ||
                !remote.alive
            ) {
                killRemote(
                    remote
                );

                continue;
            }

            /*
             * Smooth movement.
             */
            remote.x +=
                (
                    remote.targetX -
                    remote.x
                ) * 0.45;

            remote.y +=
                (
                    remote.targetY -
                    remote.y
                ) * 0.45;

            remote.z +=
                (
                    remote.targetZ -
                    remote.z
                ) * 0.45;

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

            try {
                remote.bot.dead =
                    false;
            } catch {}

            applyRemoteMetadata(
                remote.bot,
                remote
            );

            showBot(
                remote.bot
            );
        }
    }

    function killRemote(remote) {
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

        hideBot(
            remote.bot
        );
    }

    function removeRemote(id) {
        const remote =
            State.remotes.get(
                String(id)
            );

        if (!remote) {
            return;
        }

        if (remote.bot) {
            removeBotFromManager(
                remote.bot
            );

            hideBot(
                remote.bot
            );

            /*
             * Return it to the pool.
             */
            try {
                remote.bot.__connectionsRemote =
                    false;
            } catch {}

            try {
                remote.bot.__connectionsId =
                    null;
            } catch {}

            try {
                remote.bot.isPlayer =
                    false;
            } catch {}

            try {
                remote.bot.aiEnabled =
                    true;
            } catch {}

            try {
                remote.bot.alive =
                    false;
            } catch {}
        }

        State.remotes.delete(
            String(id)
        );

        log(
            "Remote removed:",
            id
        );
    }

    function clearRemoteBots() {
        for (
            const id of
            Array.from(
                State.remotes.keys()
            )
        ) {
            removeRemote(id);
        }

        /*
         * Return every original bot to
         * a hidden pool state.
         */
        for (
            const bot of
            State.originalBots
        ) {
            if (!bot) {
                continue;
            }

            removeBotFromManager(
                bot
            );

            hideBot(bot);

            try {
                bot.__connectionsRemote =
                    false;
            } catch {}

            try {
                bot.__connectionsId =
                    null;
            } catch {}

            try {
                bot.isPlayer =
                    false;
            } catch {}

            try {
                bot.aiEnabled =
                    true;
            } catch {}

            try {
                bot.alive =
                    false;
            } catch {}
        }

        State.remotes.clear();
        State.botPool =
            State.originalBots.slice();
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

        const pos =
            positionOf(
                player
            );

        const rot =
            rotationOf(
                player
            );

        const alive =
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

        let team =
            player?.team ||
            player?.side ||
            player?.teamName ||
            "ct";

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

                    name:
                        State.name,

                    team,

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
                "Game not found."
            );

            return false;
        }

        const manager =
            game.botMgr;

        if (!manager) {
            updateStatus(
                "botMgr not found."
            );

            warn(
                "window.game.botMgr missing."
            );

            return false;
        }

        const arr =
            manager.bots;

        if (
            !Array.isArray(arr)
        ) {
            updateStatus(
                "botMgr.bots not found."
            );

            return false;
        }

        log(
            "Match detected. Scanning bot manager..."
        );

        log(
            "botMgr:",
            manager
        );

        log(
            "bots:",
            arr
        );

        /*
         * IMPORTANT:
         *
         * Do the exact thing confirmed
         * by the user's console test.
         */
        const found =
            arr.find(
                b =>
                    b &&
                    b.team !== undefined
            );

        if (!found) {
            warn(
                "Could not find a bot with team."
            );
        } else {
            log(
                "Found bot:",
                found
            );

            log(
                "Bot constructor:",
                found.constructor
            );

            log(
                "Constructor name:",
                found.constructor?.name
            );
        }

        if (
            !prepareBots()
        ) {
            updateStatus(
                "Bot scan failed."
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
            "Connections multiplayer ready."
        );

        return true;
    }

    /* =========================================================
       ROOMS
    ========================================================= */

    function updateRoomList() {
        const list =
            State.UI.roomList;

        if (!list) {
            return;
        }

        list.innerHTML = "";

        if (
            !State.rooms.length
        ) {
            const empty =
                document.createElement(
                    "div"
                );

            empty.className =
                "conn-muted";

            empty.textContent =
                "No rooms.";

            list.appendChild(
                empty
            );

            return;
        }

        for (
            const room of
            State.rooms
        ) {
            const row =
                document.createElement(
                    "div"
                );

            row.className =
                "conn-room";

            const info =
                document.createElement(
                    "div"
                );

            const title =
                document.createElement(
                    "div"
                );

            title.className =
                "conn-room-title";

            title.textContent =
                room.name ||
                room.id ||
                "Room";

            const count =
                document.createElement(
                    "div"
                );

            count.className =
                "conn-room-count";

            count.textContent =
                (
                    room.players ??
                    room.count ??
                    0
                ) +
                " players";

            info.appendChild(
                title
            );

            info.appendChild(
                count
            );

            const join =
                document.createElement(
                    "button"
                );

            join.className =
                "conn-small";

            join.textContent =
                "Join";

            join.onclick =
                () =>
                    Network.joinRoom(
                        room.id
                    );

            row.appendChild(
                info
            );

            row.appendChild(
                join
            );

            list.appendChild(
                row
            );
        }
    }

    function updateCurrentRoom() {
        const current =
            State.UI.current;

        if (!current) {
            return;
        }

        if (
            !State.joinedRoom
        ) {
            current.textContent =
                "No room";

            return;
        }

        const room =
            State.roomData;

        current.textContent =
            room?.name ||
            State.room ||
            "Connected room";
    }

    function updateKickList() {
        const box =
            State.UI.kickList;

        if (!box) {
            return;
        }

        box.innerHTML = "";

        const players =
            State.roomData?.players;

        if (
            !Array.isArray(players)
        ) {
            return;
        }

        for (
            const player of
            players
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
                player.name ||
                "Player";

            const button =
                document.createElement(
                    "button"
                );

            button.className =
                "conn-kick";

            button.textContent =
                "Kick";

            button.onclick =
                () =>
                    Network.kick(
                        player.id
                    );

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

    function createRoomFromUI() {
        const name =
            State.UI.roomName?.value.trim() ||
            "Connections Room";

        const maxPlayers =
            Math.max(
                1,
                Number(
                    State.UI.maxPlayers?.value
                ) || 10
            );

        Network.createRoom({
            name,
            maxPlayers,
            team:
                "ct"
        });
    }

    /* =========================================================
       UI
    ========================================================= */

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
        updateCurrentRoom();
        updateKickList();
        updateScanUI();
        renderLobbyChat();
    }

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
        let dragging = false;

        let startX = 0;
        let startY = 0;

        let startLeft = 0;
        let startTop = 0;

        const stop =
            () => {
                dragging = false;

                document.body.style.userSelect =
                    "";

                document.removeEventListener(
                    "mousemove",
                    move
                );

                document.removeEventListener(
                    "mouseup",
                    stop
                );
            };

        const move =
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

                const rect =
                    panel.getBoundingClientRect();

                left =
                    Math.max(
                        8,
                        Math.min(
                            left,
                            window.innerWidth -
                            rect.width -
                            8
                        )
                    );

                top =
                    Math.max(
                        8,
                        Math.min(
                            top,
                            window.innerHeight -
                            rect.height -
                            8
                        )
                    );

                panel.style.left =
                    left + "px";

                panel.style.top =
                    top + "px";

                panel.style.right =
                    "auto";
            };

        handle.addEventListener(
            "mousedown",
            event => {
                if (
                    event.button !== 0
                ) {
                    return;
                }

                dragging = true;

                startX =
                    event.clientX;

                startY =
                    event.clientY;

                const rect =
                    panel.getBoundingClientRect();

                startLeft =
                    rect.left;

                startTop =
                    rect.top;

                document.body.style.userSelect =
                    "none";

                document.addEventListener(
                    "mousemove",
                    move
                );

                document.addEventListener(
                    "mouseup",
                    stop
                );
            }
        );
    }

    function createUI() {
        if (
            State.UI.panel
        ) {
            return;
        }

        const panel =
            document.createElement(
                "div"
            );

        panel.id =
            "connections-panel";

        panel.innerHTML = `
            <div class="conn-header">
                <div>
                    <div class="conn-title">
                        CONNECTIONS
                    </div>
                    <div class="conn-version">
                        v${VERSION}
                    </div>
                </div>

                <button
                    class="conn-close"
                    id="conn-close"
                >
                    ×
                </button>
            </div>

            <div class="conn-section">
                <div class="conn-section-title">
                    PROFILE
                </div>

                <input
                    id="conn-name"
                    class="conn-input"
                    maxlength="32"
                    placeholder="Player name"
                />
            </div>

            <div class="conn-section">
                <div class="conn-section-title">
                    MATCH CHECK
                </div>

                <button
                    id="conn-scan"
                    class="conn-scan"
                >
                    I AM INSIDE A MATCH
                </button>

                <div
                    id="conn-scan-status"
                    class="conn-scan-status"
                >
                    Enter a match, then scan.
                </div>
            </div>

            <div class="conn-section">
                <div class="conn-section-title">
                    CREATE ROOM
                </div>

                <input
                    id="conn-room-name"
                    class="conn-input"
                    maxlength="40"
                    placeholder="Room name"
                    value="Connections Room"
                />

                <input
                    id="conn-max"
                    class="conn-input"
                    type="number"
                    min="2"
                    max="32"
                    value="10"
                    placeholder="Max players"
                />

                <button
                    id="conn-create"
                    class="conn-btn"
                >
                    Create Room
                </button>
            </div>

            <div class="conn-section">
                <div class="conn-section-title">
                    ROOMS
                </div>

                <div id="conn-rooms"></div>
            </div>

            <div class="conn-section">
                <div class="conn-section-title">
                    CURRENT ROOM
                </div>

                <div
                    id="conn-current"
                    class="conn-current"
                >
                    No room
                </div>

                <button
                    id="conn-leave"
                    class="conn-small conn-leave"
                >
                    Leave Room
                </button>

                <div
                    id="conn-kicks"
                    class="conn-kicks"
                ></div>
            </div>

            <div class="conn-section conn-chat-section">
                <div class="conn-section-title">
                    CHAT
                </div>

                <div
                    id="conn-lobby-chat"
                    class="conn-lobby-chat"
                ></div>

                <div class="conn-chat-compose">
                    <input
                        id="conn-lobby-input"
                        class="conn-input"
                        maxlength="300"
                        placeholder="Message..."
                    />

                    <button
                        id="conn-lobby-send"
                        class="conn-small"
                    >
                        Send
                    </button>
                </div>

                <div class="conn-chat-help">
                    During match: press Y
                </div>
            </div>

            <div
                id="conn-status"
                class="conn-status"
            >
                Offline
            </div>

            <div class="conn-hotkey">
                Backspace = open/close
            </div>
        `;

        document.body.appendChild(
            panel
        );

        State.UI.panel =
            panel;

        State.UI.name =
            panel.querySelector(
                "#conn-name"
            );

        State.UI.name.value =
            State.name;

        State.UI.scanButton =
            panel.querySelector(
                "#conn-scan"
            );

        State.UI.scanStatus =
            panel.querySelector(
                "#conn-scan-status"
            );

        State.UI.roomName =
            panel.querySelector(
                "#conn-room-name"
            );

        State.UI.maxPlayers =
            panel.querySelector(
                "#conn-max"
            );

        State.UI.roomList =
            panel.querySelector(
                "#conn-rooms"
            );

        State.UI.current =
            panel.querySelector(
                "#conn-current"
            );

        State.UI.kickList =
            panel.querySelector(
                "#conn-kicks"
            );

        State.UI.status =
            panel.querySelector(
                "#conn-status"
            );

        State.UI.lobbyChatMessages =
            panel.querySelector(
                "#conn-lobby-chat"
            );

        State.UI.lobbyChatInput =
            panel.querySelector(
                "#conn-lobby-input"
            );

        State.UI.lobbyChatSend =
            panel.querySelector(
                "#conn-lobby-send"
            );

        /*
         * Match chat input.
         */
        const chatInput =
            document.createElement(
                "input"
            );

        chatInput.id =
            "connections-game-chat-input";

        chatInput.className =
            "conn-game-chat-input";

        chatInput.maxLength =
            300;

        chatInput.placeholder =
            "Say something...";

        chatInput.style.display =
            "none";

        document.body.appendChild(
            chatInput
        );

        State.UI.chatInput =
            chatInput;

        const chatHint =
            document.createElement(
                "div"
            );

        chatHint.className =
            "conn-game-chat-hint";

        chatHint.textContent =
            "ENTER send • ESC cancel";

        chatHint.style.display =
            "none";

        document.body.appendChild(
            chatHint
        );

        State.UI.chatHint =
            chatHint;

        /*
         * Match chat message overlay.
         */
        const gameChat =
            document.createElement(
                "div"
            );

        gameChat.className =
            "conn-game-chat";

        document.body.appendChild(
            gameChat
        );

        State.UI.gameChat =
            gameChat;

        panel.querySelector(
            "#conn-close"
        ).onclick =
            closeUI;

        State.UI.scanButton.onclick =
            confirmMatch;

        panel.querySelector(
            "#conn-create"
        ).onclick =
            createRoomFromUI;

        panel.querySelector(
            "#conn-leave"
        ).onclick =
            () =>
                Network.leaveRoom();

        State.UI.name.addEventListener(
            "change",
            () => {
                const name =
                    State.UI.name.value
                        .trim()
                        .slice(0, 32);

                State.name =
                    name ||
                    "Player";

                localStorage.setItem(
                    "connections_name",
                    State.name
                );
            }
        );

        State.UI.lobbyChatSend.onclick =
            () => {
                const input =
                    State.UI.lobbyChatInput;

                const value =
                    input.value.trim();

                if (value) {
                    Network.chat(value);
                    input.value = "";
                }
            };

        State.UI.lobbyChatInput.addEventListener(
            "keydown",
            event => {
                if (
                    event.key ===
                    "Enter"
                ) {
                    event.preventDefault();

                    State.UI.lobbyChatSend.click();
                }

                if (
                    event.key ===
                    "Escape"
                ) {
                    event.preventDefault();

                    State.UI.lobbyChatInput.value =
                        "";
                }
            }
        );

        chatInput.addEventListener(
            "keydown",
            event => {
                if (
                    event.key ===
                    "Enter"
                ) {
                    event.preventDefault();

                    submitChat();
                    return;
                }

                if (
                    event.key ===
                    "Escape"
                ) {
                    event.preventDefault();

                    closeChat();
                }
            }
        );

        makePanelDraggable(
            panel,
            panel.querySelector(
                ".conn-header"
            )
        );

        renderLobbyChat();
        updateUI();
    }

    /* =========================================================
       HOTKEYS
    ========================================================= */

    function installHotkeys() {
        document.addEventListener(
            "keydown",
            event => {

                /*
                 * Y opens match chat.
                 */
                if (
                    event.code ===
                    "KeyY"
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

                    if (
                        State.joinedRoom &&
                        State.confirmedMatch
                    ) {
                        event.preventDefault();
                        event.stopPropagation();

                        openChat();
                    }

                    return;
                }

                /*
                 * Don't let Backspace toggle
                 * Connections while typing.
                 */
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
                             * Keep remote objects around
                             * until explicit scan/leave,
                             * matching the old behavior.
                             */
                            updateScanUI();

                            updateStatus(
                                "Match ended. Scan again."
                            );
                        }
                    }

                    updateBots();
                    updateCurrentRoom();
                    updateKickList();

                },
                100
            );
    }

    /* =========================================================
       STYLES
    ========================================================= */

    function installStyles() {
        GM_addStyle(`
            #connections-panel {
                position: fixed;
                top: 90px;
                right: 25px;
                width: 370px;
                max-height: 82vh;
                overflow-y: auto;
                z-index: 2147483646;

                background:
                    linear-gradient(
                        145deg,
                        rgba(18,18,24,.98),
                        rgba(10,10,14,.98)
                    );

                color: #eeeeee;

                border:
                    1px solid
                    rgba(114,137,218,.45);

                border-radius: 14px;

                box-shadow:
                    0 18px 60px
                    rgba(0,0,0,.55),
                    0 0 35px
                    rgba(114,137,218,.08);

                font-family:
                    Arial,
                    Helvetica,
                    sans-serif;

                font-size: 13px;

                backdrop-filter:
                    blur(14px);

                scrollbar-width:
                    thin;
            }

            #connections-panel::-webkit-scrollbar {
                width: 6px;
            }

            #connections-panel::-webkit-scrollbar-thumb {
                background: #3b3f50;
                border-radius: 10px;
            }

            .conn-header {
                display: flex;
                align-items: center;
                justify-content: space-between;

                padding: 16px;

                cursor: move;

                border-bottom:
                    1px solid
                    rgba(255,255,255,.07);
            }

            .conn-title {
                font-size: 17px;
                font-weight: 800;
                letter-spacing: 1.4px;
            }

            .conn-version {
                margin-top: 3px;
                opacity: .45;
                font-size: 10px;
            }

            .conn-close {
                width: 30px;
                height: 30px;

                border: 0;
                border-radius: 8px;

                background:
                    rgba(255,255,255,.06);

                color: #aaa;

                font-size: 20px;
                cursor: pointer;
            }

            .conn-close:hover {
                background:
                    rgba(255,255,255,.12);

                color: #fff;
            }

            .conn-section {
                margin: 10px;
                padding: 12px;

                background:
                    rgba(255,255,255,.025);

                border:
                    1px solid
                    rgba(255,255,255,.055);

                border-radius: 10px;
            }

            .conn-section-title {
                margin-bottom: 9px;

                font-size: 10px;
                font-weight: 800;

                letter-spacing: 1.2px;

                opacity: .55;
            }

            .conn-input {
                box-sizing: border-box;

                width: 100%;

                margin-bottom: 7px;

                padding:
                    10px 11px;

                border:
                    1px solid
                    rgba(255,255,255,.09);

                outline: none;

                border-radius: 8px;

                background:
                    rgba(0,0,0,.28);

                color: #fff;

                font-size: 13px;
            }

            .conn-input:focus {
                border-color:
                    rgba(114,137,218,.8);
            }

            .conn-btn,
            .conn-scan,
            .conn-small {
                border: 0;
                border-radius: 8px;

                background:
                    #7289da;

                color: #fff;

                cursor: pointer;

                font-weight: 700;
            }

            .conn-btn {
                width: 100%;
                padding: 10px;
            }

            .conn-scan {
                width: 100%;
                padding: 12px;
            }

            .conn-scan:hover,
            .conn-btn:hover,
            .conn-small:hover {
                filter: brightness(1.12);
            }

            .conn-scan:disabled {
                opacity: .65;
                cursor: default;
            }

            .conn-scan-done {
                background:
                    #3c9c68 !important;
            }

            .conn-scan-status {
                margin-top: 8px;
                font-size: 11px;
                opacity: .55;
                text-align: center;
            }

            .conn-room {
                display: flex;
                align-items: center;
                justify-content: space-between;

                padding: 9px;

                margin-bottom: 6px;

                background:
                    rgba(255,255,255,.035);

                border-radius: 8px;
            }

            .conn-room-title {
                font-weight: 700;
            }

            .conn-room-count {
                margin-top: 2px;
                font-size: 10px;
                opacity: .45;
            }

            .conn-small {
                padding:
                    7px 10px;

                font-size: 11px;
            }

            .conn-leave {
                margin-top: 8px;
                background:
                    #9b4242;
            }

            .conn-current {
                font-weight: 700;
            }

            .conn-kicks {
                margin-top: 9px;
            }

            .conn-kick-row {
                display: flex;
                justify-content: space-between;
                align-items: center;

                padding: 6px 0;

                border-bottom:
                    1px solid
                    rgba(255,255,255,.04);
            }

            .conn-kick {
                border: 0;
                border-radius: 6px;

                padding:
                    4px 7px;

                background:
                    rgba(180,60,60,.75);

                color: white;

                font-size: 10px;
                cursor: pointer;
            }

            .conn-muted {
                opacity: .45;
                font-size: 11px;
                padding: 4px;
            }

            .conn-status {
                margin: 10px 12px 4px;

                padding: 8px;

                border-radius: 7px;

                background:
                    rgba(255,255,255,.035);

                color: #aeb8d8;

                font-size: 11px;

                text-align: center;
            }

            .conn-hotkey {
                padding:
                    9px 12px 14px;

                text-align: center;

                opacity: .35;

                font-size: 10px;
            }

            .conn-chat-section {
                padding-bottom: 10px;
            }

            .conn-lobby-chat {
                height: 170px;
                overflow-y: auto;

                padding: 8px;

                background:
                    rgba(0,0,0,.25);

                border-radius: 8px;

                scrollbar-width: thin;
            }

            .conn-lobby-chat-row {
                padding:
                    4px 2px;

                line-height: 1.35;

                word-break: break-word;
            }

            .conn-lobby-chat-name {
                color: #8ea2ed;
                font-weight: 700;
            }

            .conn-lobby-chat-text {
                color: #ddd;
            }

            .conn-chat-compose {
                display: flex;
                gap: 6px;

                margin-top: 7px;
            }

            .conn-chat-compose .conn-input {
                margin: 0;
            }

            .conn-chat-help {
                margin-top: 7px;

                font-size: 10px;

                opacity: .38;

                text-align: center;
            }

            .conn-game-chat {
                position: fixed;

                left: 25px;
                bottom: 125px;

                width: min(
                    550px,
                    55vw
                );

                z-index:
                    2147483640;

                pointer-events: none;

                font-family:
                    Arial,
                    Helvetica,
                    sans-serif;

                font-size: 14px;

                text-shadow:
                    1px 1px 3px
                    rgba(0,0,0,.95);
            }

            .conn-game-chat-row {
                display: block;

                margin-top: 4px;

                color: #fff;

                opacity: 1;

                transition:
                    opacity .5s;
            }

            .conn-game-chat-name {
                color: #9caef4;
                font-weight: 800;
            }

            .conn-game-chat-text {
                color: #fff;
            }

            .conn-chat-fade {
                opacity: 0;
            }

            .conn-game-chat-input {
                position: fixed;

                left: 25px;
                bottom: 78px;

                width: min(
                    500px,
                    50vw
                );

                height: 38px;

                z-index:
                    2147483641;

                box-sizing: border-box;

                padding:
                    0 12px;

                border:
                    1px solid
                    rgba(114,137,218,.7);

                border-radius: 6px;

                outline: none;

                background:
                    rgba(8,8,12,.92);

                color: #fff;

                font:
                    14px
                    Arial,
                    sans-serif;

                box-shadow:
                    0 8px 25px
                    rgba(0,0,0,.4);
            }

            .conn-game-chat-hint {
                position: fixed;

                left: 25px;
                bottom: 57px;

                z-index:
                    2147483641;

                color: rgba(255,255,255,.55);

                font:
                    10px
                    Arial,
                    sans-serif;

                pointer-events: none;
            }
        `);
    }

    /* =========================================================
       INIT
    ========================================================= */

    function init() {
        installStyles();

        createUI();

        installHotkeys();

        installMonitor();

        Network.connect();

        log(
            `Connections ${VERSION} loaded.`
        );

        log(
            "Press Backspace to open."
        );

        log(
            "Press Y during a match to chat."
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
})();
