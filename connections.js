// ==UserScript==
// @name         Connections
// @namespace    conn
// @version      1.0.1
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
        VERSION: "1.0.1",

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

        ui: {
            open: false
        },

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
                return saved.trim();
            }
        } catch {}

        let name = "Player";

        try {
            const input =
                prompt(
                    "Connections username:",
                    "Player"
                );

            if (
                input &&
                input.trim()
            ) {
                name =
                    input
                        .trim()
                        .slice(
                            0,
                            24
                        );
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

    function sendJSON(data) {
        if (
            !State.ws ||
            State.ws.readyState !==
            WebSocket.OPEN
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
                "WebSocket send failed:",
                e
            );

            return false;
        }
    }

    function safeNumber(value, fallback = 0) {
        const n =
            Number(value);

        return Number.isFinite(n)
            ? n
            : fallback;
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

    function normalizeTeam(team) {
        const t =
            String(
                team ||
                ""
            ).toUpperCase();

        if (
            t === "T" ||
            t === "TERRORIST"
        ) {
            return "T";
        }

        return "CT";
    }

    function getVectorPosition(
        object
    ) {
        if (!object) {
            return {
                x: 0,
                y: 0,
                z: 0
            };
        }

        let x =
            safeNumber(
                object.x,
                NaN
            );

        let y =
            safeNumber(
                object.y,
                NaN
            );

        let z =
            safeNumber(
                object.z,
                NaN
            );

        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            !Number.isFinite(z)
        ) {
            try {
                if (
                    object.position
                ) {
                    x =
                        safeNumber(
                            object.position.x,
                            0
                        );

                    y =
                        safeNumber(
                            object.position.y,
                            0
                        );

                    z =
                        safeNumber(
                            object.position.z,
                            0
                        );
                }
            } catch {}
        }

        return {
            x: Number.isFinite(x)
                ? x
                : 0,

            y: Number.isFinite(y)
                ? y
                : 0,

            z: Number.isFinite(z)
                ? z
                : 0
        };
    }

    function getYaw(object) {
        if (!object) {
            return 0;
        }

        const candidates = [
            object.yaw,
            object.rotationY,
            object.rotY
        ];

        for (
            const value
            of candidates
        ) {
            const n =
                Number(value);

            if (
                Number.isFinite(n)
            ) {
                return n;
            }
        }

        try {
            if (
                object.rotation
            ) {
                const n =
                    Number(
                        object.rotation.y
                    );

                if (
                    Number.isFinite(n)
                ) {
                    return n;
                }
            }
        } catch {}

        return 0;
    }

    function getPitch(object) {
        if (!object) {
            return 0;
        }

        const candidates = [
            object.pitch,
            object.lookPitch,
            object._lookPitch,
            object.rotationX,
            object.rotX
        ];

        for (
            const value
            of candidates
        ) {
            const n =
                Number(value);

            if (
                Number.isFinite(n)
            ) {
                return n;
            }
        }

        return 0;
    }

    function getVelocity(
        object
    ) {
        if (!object) {
            return {
                x: 0,
                y: 0,
                z: 0
            };
        }

        let vx =
            safeNumber(
                object.vx,
                NaN
            );

        let vy =
            safeNumber(
                object.vy,
                NaN
            );

        let vz =
            safeNumber(
                object.vz,
                NaN
            );

        try {
            if (
                object.velocity
            ) {
                vx =
                    safeNumber(
                        object.velocity.x,
                        0
                    );

                vy =
                    safeNumber(
                        object.velocity.y,
                        0
                    );

                vz =
                    safeNumber(
                        object.velocity.z,
                        0
                    );
            }
        } catch {}

        return {
            x: Number.isFinite(vx)
                ? vx
                : 0,

            y: Number.isFinite(vy)
                ? vy
                : 0,

            z: Number.isFinite(vz)
                ? vz
                : 0
        };
    }

    function getAlive(
        object
    ) {
        if (!object) {
            return false;
        }

        if (
            typeof object.alive ===
            "boolean"
        ) {
            return object.alive;
        }

        if (
            typeof object.dead ===
            "boolean"
        ) {
            return !object.dead;
        }

        if (
            typeof object.health ===
            "number"
        ) {
            return object.health > 0;
        }

        return true;
    }

    function getOnGround(
        object
    ) {
        if (!object) {
            return false;
        }

        if (
            typeof object.onGround ===
            "boolean"
        ) {
            return object.onGround;
        }

        if (
            typeof object.grounded ===
            "boolean"
        ) {
            return object.grounded;
        }

        if (
            typeof object.isGrounded ===
            "boolean"
        ) {
            return object.isGrounded;
        }

        return false;
    }

    function getCrouching(
        object
    ) {
        if (!object) {
            return false;
        }

        return !!(
            object.crouching ||
            object.crouched ||
            object.isCrouching
        );
    }

    function getTeam(
        object
    ) {
        if (!object) {
            return "CT";
        }

        return normalizeTeam(
            object.team ||
            object.side ||
            object.teamName
        );
    }

    function setTransform(
        object,
        x,
        y,
        z
    ) {
        if (!object) {
            return;
        }

        try {
            object.x = x;
            object.y = y;
            object.z = z;
        } catch {}

        try {
            if (
                object.position
            ) {
                object.position.x = x;
                object.position.y = y;
                object.position.z = z;
            }
        } catch {}
    }

    function setRotation(
        object,
        yaw,
        pitch
    ) {
        if (!object) {
            return;
        }

        try {
            object.yaw = yaw;
        } catch {}

        try {
            object.rotationY =
                yaw;
        } catch {}

        try {
            object.rotY =
                yaw;
        } catch {}

        try {
            object.pitch =
                pitch;
        } catch {}

        try {
            object.lookPitch =
                pitch;
        } catch {}

        try {
            object._lookPitch =
                pitch;
        } catch {}

        try {
            if (
                object.rotation
            ) {
                object.rotation.y =
                    yaw;
            }
        } catch {}
    }

    function setVelocity(
        object,
        vx,
        vy,
        vz
    ) {
        if (!object) {
            return;
        }

        try {
            object.vx = vx;
            object.vy = vy;
            object.vz = vz;
        } catch {}

        try {
            if (
                object.velocity
            ) {
                object.velocity.x =
                    vx;

                object.velocity.y =
                    vy;

                object.velocity.z =
                    vz;
            }
        } catch {}
    }

    function escapeHtml(
        value
    ) {
        return String(
            value ??
            ""
        )
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /</g,
                "&lt;"
            )
            .replace(
                />/g,
                "&gt;"
            )
            .replace(
                /"/g,
                "&quot;"
            )
            .replace(
                /'/g,
                "&#039;"
            );
    }

    /*
     * =========================================================
     * AVATAR SYSTEM
     * =========================================================
     */

    const Avatar = {

        storeKey:
            "pp-avatar",

        stateKey:
            "pp-avatar-on",

        load() {
            try {
                const value =
                    localStorage.getItem(
                        this.storeKey
                    );

                if (
                    value &&
                    typeof value ===
                    "string"
                ) {
                    State.avatar =
                        value;
                }
            } catch {}

            try {
                State.avatarEnabled =
                    localStorage.getItem(
                        this.stateKey
                    ) !== "false";
            } catch {
                State.avatarEnabled =
                    true;
            }

            State.avatarDirty =
                true;
        },

        isValid(
            value
        ) {
            if (
                typeof value !==
                "string"
            ) {
                return false;
            }

            if (
                !value.startsWith(
                    "data:image/"
                )
            ) {
                return false;
            }

            return (
                value.length <=
                CONFIG.AVATAR_MAX_BYTES
            );
        },

        async readFile(
            file
        ) {
            if (!file) {
                return null;
            }

            if (
                !String(
                    file.type ||
                    ""
                ).startsWith(
                    "image/"
                )
            ) {
                throw new Error(
                    "Please choose an image."
                );
            }

            if (
                file.size >
                CONFIG.AVATAR_MAX_BYTES
            ) {
                throw new Error(
                    "Avatar is too large."
                );
            }

            return await new Promise(
                (
                    resolve,
                    reject
                ) => {
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
                        () => {
                            reject(
                                new Error(
                                    "Could not read avatar."
                                )
                            );
                        };

                    reader.readAsDataURL(
                        file
                    );
                }
            );
        },

        async setFile(
            file
        ) {
            try {
                const data =
                    await this.readFile(
                        file
                    );

                if (
                    !this.isValid(
                        data
                    )
                ) {
                    throw new Error(
                        "Invalid avatar."
                    );
                }

                State.avatar =
                    data;

                State.avatarEnabled =
                    true;

                State.avatarDirty =
                    true;

                try {
                    localStorage.setItem(
                        this.storeKey,
                        data
                    );

                    localStorage.setItem(
                        this.stateKey,
                        "true"
                    );
                } catch {}

                UI.setMessage(
                    "Avatar updated."
                );

                RemoteBots.rebuildAvatars();

            } catch (e) {
                UI.setMessage(
                    e?.message ||
                    "Avatar failed."
                );
            }
        },

        toggle() {
            State.avatarEnabled =
                !State.avatarEnabled;

            State.avatarDirty =
                true;

            try {
                localStorage.setItem(
                    this.stateKey,
                    State.avatarEnabled
                        ? "true"
                        : "false"
                );
            } catch {}

            RemoteBots.rebuildAvatars();

            UI.updateAvatarControls();
        },

        reset() {
            State.avatar =
                null;

            State.avatarEnabled =
                true;

            State.avatarDirty =
                true;

            try {
                localStorage.removeItem(
                    this.storeKey
                );

                localStorage.setItem(
                    this.stateKey,
                    "true"
                );
            } catch {}

            RemoteBots.rebuildAvatars();

            UI.updateAvatarControls();

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
                return;
            }

            State.connecting =
                true;

            UI.updateStatus(
                "Connecting..."
            );

            log(
                "Connecting:",
                CONFIG.WS_URL
            );

            let ws = null;

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

                UI.updateStatus(
                    "Connection failed"
                );

                return;
            }

            State.ws =
                ws;

            ws.onopen =
                () => {
                    State.connecting =
                        false;

                    State.connected =
                        true;

                    UI.updateStatus(
                        "Connected"
                    );

                    log(
                        "WebSocket connected."
                    );

                    this.send({
                        type:
                            "hello",

                        name:
                            State.name
                    });

                    this.send({
                        type:
                            "list_rooms"
                    });

                    startSync();
                };

            ws.onmessage =
                event => {
                    let data = null;

                    try {
                        data =
                            JSON.parse(
                                event.data
                            );
                    } catch {
                        return;
                    }

                    this.handle(
                        data
                    );
                };

            ws.onerror =
                event => {
                    warn(
                        "WebSocket error:",
                        event
                    );

                    UI.updateStatus(
                        "Socket error"
                    );
                };

            ws.onclose =
                () => {
                    const wasConnected =
                        State.connected;

                    State.connected =
                        false;

                    State.connecting =
                        false;

                    State.ws =
                        null;

                    stopSync();

                    UI.updateStatus(
                        "Disconnected"
                    );

                    if (
                        wasConnected
                    ) {
                        log(
                            "WebSocket disconnected."
                        );
                    }
                };
        },

        disconnect() {
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

            stopSync();
        },

        send(data) {
            return sendJSON(
                data
            );
        },

        handle(data) {
            if (
                !data ||
                typeof data !==
                "object"
            ) {
                return;
            }

            const type =
                String(
                    data.type ||
                    ""
                );

            switch (type) {

                case "connected": {
                    if (
                        data.id
                    ) {
                        State.id =
                            String(
                                data.id
                            );

                        log(
                            "Assigned ID:",
                            State.id
                        );
                    }

                    if (
                        data.profile
                    ) {
                        UI.setMessage(
                            `RTP: ${safeNumber(
                                data.profile.rtp,
                                1000
                            )}`
                        );
                    }

                    break;
                }

                case "hello": {
                    if (
                        data.id &&
                        !State.id
                    ) {
                        State.id =
                            String(
                                data.id
                            );
                    }

                    break;
                }

                case "rooms": {
                    State.rooms =
                        Array.isArray(
                            data.rooms
                        )
                            ? data.rooms
                            : [];

                    UI.renderRooms();

                    break;
                }

                case "room_snapshot": {
                    if (
                        Array.isArray(
                            data.rooms
                        )
                    ) {
                        State.rooms =
                            data.rooms;

                        UI.renderRooms();
                    }

                    break;
                }

                case "room_joined": {
                    const id =
                        roomId(
                            data.room ||
                            data.roomId
                        );

                    if (
                        id
                    ) {
                        State.room =
                            id;
                    }

                    State.isHost =
                        !!(
                            data.isHost
                        );

                    UI.renderRoom();

                    log(
                        "Joined room:",
                        State.room
                    );

                    break;
                }

                case "player_joined": {
                    if (
                        data.player
                    ) {
                        RemoteBots.receive(
                            data.player
                        );
                    }

                    UI.renderRoom();

                    break;
                }

                case "player_left": {
                    const id =
                        data.id ||
                        data.playerId;

                    if (
                        id
                    ) {
                        RemoteBots.remove(
                            id
                        );
                    }

                    UI.renderRoom();

                    break;
                }

                case "state": {
                    this.receiveState(
                        data
                    );

                    break;
                }

                case "left_room": {
                    State.room =
                        null;

                    State.isHost =
                        false;

                    RemoteBots.clear();

                    UI.renderRoom();

                    break;
                }

                case "room_deleted": {
                    const deleted =
                        roomId(
                            data.room ||
                            data.roomId
                        );

                    if (
                        deleted &&
                        String(
                            State.room
                        ) ===
                        String(
                            deleted
                        )
                    ) {
                        State.room =
                            null;

                        State.isHost =
                            false;

                        RemoteBots.clear();

                        UI.renderRoom();
                    }

                    State.rooms =
                        State.rooms.filter(
                            room =>
                                String(
                                    room.id ??
                                    room.roomId ??
                                    ""
                                ) !==
                                String(
                                    deleted
                                )
                        );

                    UI.renderRooms();

                    break;
                }

                case "room_update": {
                    if (
                        data.room
                    ) {
                        const id =
                            roomId(
                                data.room
                            );

                        const index =
                            State.rooms.findIndex(
                                room =>
                                    String(
                                        room.id ??
                                        room.roomId ??
                                        ""
                                    ) ===
                                    String(
                                        id
                                    )
                            );

                        if (
                            index !== -1
                        ) {
                            State.rooms[
                                index
                            ] =
                                data.room;
                        } else {
                            State.rooms.push(
                                data.room
                            );
                        }

                        UI.renderRooms();
                    }

                    break;
                }

                case "chat": {
                    UI.addChatMessage(
                        data
                    );

                    break;
                }

                case "round_state":
                case "round": {
                    applyMatchSnapshot(
                        data
                    );

                    break;
                }

                case "music_event":
                case "music_kit": {
                    Music.handleNetwork(
                        data
                    );

                    break;
                }

                case "head_boost": {
                    HeadBoost.receive(
                        data
                    );

                    break;
                }

                case "rafit_profile": {
                    if (
                        data.profile
                    ) {
                        UI.setMessage(
                            `RTP ${safeNumber(
                                data.profile.rtp,
                                1000
                            )}`
                        );
                    }

                    break;
                }

                case "rafit_flag":
                case "rafit_movement": {
                    break;
                }

                case "pong": {
                    break;
                }

                case "error": {
                    UI.setMessage(
                        data.message ||
                        data.error ||
                        "Server error."
                    );

                    warn(
                        "Server error:",
                        data
                    );

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
                data.senderId;

            if (
                !id ||
                String(id) ===
                String(State.id)
            ) {
                return;
            }

            const state =
                data.state ||
                data;

            RemoteBots.receive({
                id:
                    String(id),

                name:
                    state.name ||
                    data.name ||
                    "Player",

                team:
                    normalizeTeam(
                        state.team ||
                        data.team
                    ),

                x:
                    safeNumber(
                        state.x,
                        0
                    ),

                y:
                    safeNumber(
                        state.y,
                        0
                    ),

                z:
                    safeNumber(
                        state.z,
                        0
                    ),

                yaw:
                    safeNumber(
                        state.yaw,
                        0
                    ),

                pitch:
                    safeNumber(
                        state.pitch,
                        0
                    ),

                vx:
                    safeNumber(
                        state.vx,
                        0
                    ),

                vy:
                    safeNumber(
                        state.vy,
                        0
                    ),

                vz:
                    safeNumber(
                        state.vz,
                        0
                    ),

                onGround:
                    !!state.onGround,

                crouching:
                    !!state.crouching,

                alive:
                    state.alive !==
                    false,

                avatar:
                    state.avatar ??
                    data.avatar ??
                    null,

                avatarEnabled:
                    state.avatarEnabled !==
                    false
            });
        }
    };

    /*
     * =========================================================
     * LOCAL STATE SYNC
     * =========================================================
     */

    function buildLocalState() {
        const game =
            getGame();

        const player =
            getPlayer();

        if (
            !game ||
            !player
        ) {
            return null;
        }

        const position =
            getVectorPosition(
                player
            );

        const velocity =
            getVelocity(
                player
            );

        return {
            x:
                position.x,

            y:
                position.y,

            z:
                position.z,

            yaw:
                getYaw(
                    player
                ),

            pitch:
                getPitch(
                    player
                ),

            vx:
                velocity.x,

            vy:
                velocity.y,

            vz:
                velocity.z,

            onGround:
                getOnGround(
                    player
                ),

            crouching:
                getCrouching(
                    player
                ),

            alive:
                getAlive(
                    player
                ),

            team:
                getTeam(
                    player
                ),

            name:
                State.name,

            avatar:
                State.avatarDirty ||
                Date.now() -
                    State.lastAvatarSent >=
                    CONFIG.AVATAR_SEND_INTERVAL
                    ? (
                        State.avatarEnabled
                            ? State.avatar
                            : null
                    )
                    : undefined,

            avatarEnabled:
                State.avatarEnabled
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

        const game =
            getGame();

        if (
            !game ||
            !isInsideMatch(
                game
            )
        ) {
            return;
        }

        const state =
            buildLocalState();

        if (
            !state
        ) {
            return;
        }

        const sent =
            Network.send({
                type:
                    "state",

                state
            });

        if (
            sent
        ) {
            if (
                state.avatar !==
                undefined
            ) {
                State.avatarDirty =
                    false;

                State.lastAvatarSent =
                    Date.now();
            }
        }
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
     * MATCH / ROUND SYNC
     * =========================================================
     */

    function getRoundSnapshot() {
        const game =
            getGame();

        if (
            !game
        ) {
            return null;
        }

        let active = false;

        try {
            active =
                game.roundActive ===
                true;
        } catch {}

        try {
            if (
                !active &&
                game.gameState ===
                "playing"
            ) {
                active = true;
            }
        } catch {}

        let roundEndAt =
            safeNumber(
                game.roundEndAt,
                0
            );

        let endAt =
            safeNumber(
                game.endAt,
                0
            );

        if (
            !roundEndAt
        ) {
            try {
                roundEndAt =
                    safeNumber(
                        game.roundEndT,
                        0
                    );
            } catch {}
        }

        if (
            !endAt
        ) {
            try {
                endAt =
                    safeNumber(
                        game.endT,
                        0
                    );
            } catch {}
        }

        return {
            active,
            roundSeq:
                State.hostRoundSeq,

            roundEndAt,
            endAt
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

        const snapshot =
            getRoundSnapshot();

        if (
            !snapshot
        ) {
            return;
        }

        const active =
            snapshot.active;

        if (
            State.hostLastActive !==
            active
        ) {
            State.hostLastActive =
                active;

            State.hostRoundSeq++;

            snapshot.roundSeq =
                State.hostRoundSeq;
        }

        State.hostRoundEndAt =
            snapshot.roundEndAt;

        State.hostEndAt =
            snapshot.endAt;

        Network.send({
            type:
                "round_state",

            active:
                snapshot.active,

            roundSeq:
                snapshot.roundSeq,

            roundEndAt:
                snapshot.roundEndAt,

            endAt:
                snapshot.endAt
        });
    }

    function applyMatchAuthoritative(
        snapshot
    ) {
        const game =
            getGame();

        if (
            !game ||
            !snapshot ||
            State.isHost
        ) {
            return;
        }

        const active =
            snapshot.active ===
            true;

        const seq =
            Number(
                snapshot.roundSeq
            ) || 0;

        const now =
            Date.now();

        if (
            State.matchSync.lastActive !==
            null &&
            State.matchSync.lastActive !==
            active
        ) {
            try {
                if (
                    active
                ) {
                    if (
                        typeof game.startRound ===
                        "function"
                    ) {
                        game.startRound();
                    } else {
                        game.roundActive =
                            true;
                    }
                } else {
                    if (
                        typeof game.endRound ===
                        "function"
                    ) {
                        game.endRound();
                    } else {
                        game.roundActive =
                            false;
                    }
                }
            } catch (e) {
                warn(
                    "Match transition sync failed:",
                    e
                );
            }
        }

        State.matchSync.lastActive =
            active;

        State.matchSync.roundSeq =
            seq;

        State.matchSync.lastReceived =
            now;

        State.matchSync.roundEndAt =
            Number(
                snapshot.roundEndAt
            ) || 0;

        State.matchSync.endAt =
            Number(
                snapshot.endAt
            ) || 0;

        try {
            if (
                active
            ) {
                const remaining =
                    Math.max(
                        0,
                        (
                            State.matchSync.roundEndAt -
                            now
                        ) / 1000
                    );

                game.roundActive =
                    true;

                game.roundTimeLeft =
                    remaining;

                game.endT =
                    0;
            } else {
                const remaining =
                    Math.max(
                        0,
                        (
                            State.matchSync.endAt -
                            now
                        ) / 1000
                    );

                game.roundActive =
                    false;

                game.roundTimeLeft =
                    0;

                game.endT =
                    remaining;
            }

            if (
                game.hud
            ) {
                if (
                    typeof game.hud.update ===
                    "function"
                ) {
                    game.hud.update();
                }

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

        if (
            !State.matchSync.lastReceived
        ) {
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

    function applyMatchSnapshot(
        snapshot
    ) {
        applyMatchAuthoritative(
            snapshot
        );
    }

    /*
     * =========================================================
     * HEAD BOOST
     * =========================================================
     */

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
                    String(
                        data.targetId
                    )
                );

            if (
                !target
            ) {
                return;
            }

            target.headBoost =
                {
                    active:
                        data.active !==
                        false,

                    carrierId:
                        data.carrierId ||
                        null
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
                type:
                    "head_boost",

                targetId:
                    String(
                        targetId
                    ),

                active:
                    !!active,

                carrierId:
                    carrierId
                        ? String(
                            carrierId
                        )
                        : null
            });
        }
    };

    /*
     * =========================================================
     * MUSIC
     * =========================================================
     */

    const Music = {

        current:
            null,

        audio:
            null,

        stop() {
            if (
                this.audio
            ) {
                try {
                    this.audio.pause();
                    this.audio.currentTime =
                        0;
                } catch {}
            }

            this.audio =
                null;

            this.current =
                null;
        },

        play(url) {
            this.stop();

            if (
                !url ||
                typeof url !==
                "string"
            ) {
                return;
            }

            try {
                const audio =
                    new Audio(
                        url
                    );

                audio.volume =
                    0.75;

                audio.loop =
                    false;

                this.audio =
                    audio;

                this.current =
                    url;

                const promise =
                    audio.play();

                if (
                    promise &&
                    typeof promise.catch ===
                    "function"
                ) {
                    promise.catch(
                        () => {}
                    );
                }
            } catch {}
        },

        handleNetwork(data) {
            if (
                !data
            ) {
                return;
            }

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

            if (
                data.url
            ) {
                this.play(
                    data.url
                );
            }
        },

        stopForMatchEnd() {
            this.stop();
        }
    };

    /*
     * =========================================================
     * REMOTE BOT SYSTEM
     * =========================================================
     */

    function collisionSafeRemoteTarget(
        bot,
        target,
        dt
    ) {
        const game =
            getGame();

        const physics =
            game &&
            game.physics;

        if (
            !physics ||
            typeof physics.raycast !==
            "function"
        ) {
            return target;
        }

        const fromX =
            Number(bot.x) ||
            0;

        const fromY =
            Number(bot.y) ||
            0;

        const fromZ =
            Number(bot.z) ||
            0;

        const toX =
            Number(target.x) ||
            fromX;

        const toY =
            Number(target.y) ||
            fromY;

        const toZ =
            Number(target.z) ||
            fromZ;

        let dx =
            toX -
            fromX;

        let dy =
            toY -
            fromY;

        let dz =
            toZ -
            fromZ;

        const distance =
            Math.sqrt(
                dx * dx +
                dy * dy +
                dz * dz
            );

        if (
            !Number.isFinite(
                distance
            ) ||
            distance <
            0.0001
        ) {
            return target;
        }

        const maxStep =
            Math.max(
                0.35,
                Math.min(
                    2.5,
                    7.0 *
                    Math.max(
                        dt,
                        0.016
                    )
                )
            );

        if (
            distance >
            maxStep
        ) {
            const scale =
                maxStep /
                distance;

            dx *= scale;
            dy *= scale;
            dz *= scale;
        }

        const stepDistance =
            Math.sqrt(
                dx * dx +
                dy * dy +
                dz * dz
            );

        if (
            stepDistance <
            0.0001
        ) {
            return {
                x:
                    fromX,

                y:
                    fromY,

                z:
                    fromZ
            };
        }

        try {
            const result =
                physics.raycast(
                    fromX,
                    fromY,
                    fromZ,
                    dx,
                    dy,
                    dz,
                    stepDistance
                );

            if (
                result
            ) {
                return {
                    x:
                        fromX,

                    y:
                        fromY,

                    z:
                        fromZ
                };
            }
        } catch {}

        return {
            x:
                fromX +
                dx,

            y:
                fromY +
                dy,

            z:
                fromZ +
                dz
        };
    }

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
                State.botCtor
            ) {
                return true;
            }

            State.preparingBots =
                true;

            const existingBots =
                [
                    ...mgr.bots
                ];

            State.originalBotArray =
                mgr.bots;

            State.originalBots =
                existingBots;

            State.botTemplate =
                existingBots[0] ||
                null;

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
                        player?.team ===
                        "T"
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

                        if (
                            bootstrap
                        ) {
                            State.botCtor =
                                bootstrap.constructor;

                            log(
                                "REAL BOT CONSTRUCTOR CAPTURED:",
                                State.botCtor.name ||
                                "(anonymous)"
                            );
                        }

                        for (
                            const bot
                            of [
                                ...mgr.bots
                            ]
                        ) {
                            try {
                                bot.alive =
                                    false;

                                bot.dead =
                                    true;

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
                                    bot.cs2Agent?.root?.parent
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

                        mgr.bots.length =
                            0;
                    }
                } catch (e) {
                    warn(
                        "Temporary native bot bootstrap failed:",
                        e
                    );
                }
            }

            if (
                !State.botCtor
            ) {
                const found =
                    existingBots.find(
                        b =>
                            b &&
                            b.team !==
                                undefined &&
                            typeof b.constructor ===
                                "function"
                    );

                if (
                    found
                ) {
                    State.botCtor =
                        found.constructor;

                    log(
                        "REAL BOT CONSTRUCTOR CAPTURED:",
                        State.botCtor.name ||
                        "(anonymous)"
                    );
                }
            }

            if (
                !State.botCtor
            ) {
                State.preparingBots =
                    false;

                State.originalBots =
                    [];

                State.originalBotArray =
                    null;

                State.botTemplate =
                    null;

                warn(
                    "Could not capture the native bot constructor."
                );

                return false;
            }

            for (
                const bot
                of existingBots
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
                "Native AI bots removed from active manager.",
                existingBots.length
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

            let bot =
                null;

            try {
                bot =
                    new ctor(
                        game,
                        remote.team ===
                            "T"
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

            if (
                !bot
            ) {
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
                normalizeTeam(
                    remote.team
                );

            bot.difficulty =
                3;

            bot.isPlayer =
                true;

            bot.alive =
                remote.alive !==
                false;

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
                    function(
                        dt
                    ) {
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
            if (!data || !data.id) {
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
                typeof data.state === "object"
                    ? data.state
                    : data;

            if (
                !incoming ||
                typeof incoming !== "object"
            ) {
                return;
            }

            let remote =
                this.remotes.get(id);

            if (!remote) {
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
                            : (
                                data.avatar ||
                                null
                            ),

                    avatarEnabled:
                        incoming.avatarEnabled !==
                        undefined
                            ? incoming.avatarEnabled !==
                              false
                            : true,

                    bot:
                        null,

                    lastUpdate:
                        performance.now(),

                    lastApplied:
                        performance.now(),

                    packetCount:
                        0
                };

                this.remotes.set(
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

            remote.team =
                normalizeTeam(
                    incoming.team ||
                    data.team ||
                    remote.team ||
                    "CT"
                );

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

            if (
                incoming.avatar !==
                undefined
            ) {
                remote.avatar =
                    incoming.avatar;
            }

            if (
                incoming.avatarEnabled !==
                undefined
            ) {
                remote.avatarEnabled =
                    incoming.avatarEnabled !==
                    false;
            }

            if (
                data.avatar !==
                undefined
            ) {
                remote.avatar =
                    data.avatar;
            }

            if (
                data.avatarEnabled !==
                undefined
            ) {
                remote.avatarEnabled =
                    data.avatarEnabled !==
                    false;
            }

            remote.lastUpdate =
                performance.now();

            remote.packetCount++;

            /*
             * MUITO IMPORTANTE:
             *
             * Aqui chamamos SOMENTE attach().
             *
             * Não chamamos createBot() antes,
             * porque attach() já cria o bot.
             */
            if (
                !remote.bot
            ) {
                this.attach(
                    remote
                );
            }

            /*
             * Se o bot já existe, apenas atualiza
             * os dados. Nunca recria.
             */
            if (
                remote.bot
            ) {
                try {
                    remote.bot.name =
                        remote.name;
                } catch {}

                try {
                    remote.bot.team =
                        remote.team;
                } catch {}

                try {
                    remote.bot.alive =
                        remote.alive;
                } catch {}
            }

            try {
                this.applyAvatars(
                    remote
                );
            } catch {}
        },
updateBot(remote, dt) {
  const bot = remote && remote.bot;
  if (!remote || !bot) return;

  const g = getGame();
  if (!g) return;

  const now = performance.now();

  if (!Number.isFinite(remote.x)) remote.x = 0;
  if (!Number.isFinite(remote.y)) remote.y = 0;
  if (!Number.isFinite(remote.z)) remote.z = 0;

  if (!Number.isFinite(remote.targetX)) remote.targetX = remote.x;
  if (!Number.isFinite(remote.targetY)) remote.targetY = remote.y;
  if (!Number.isFinite(remote.targetZ)) remote.targetZ = remote.z;

  const px = Number(bot.x) || 0;
  const py = Number(bot.y) || 0;
  const pz = Number(bot.z) || 0;

  const tx = Number(remote.targetX);
  const ty = Number(remote.targetY);
  const tz = Number(remote.targetZ);

  let dx = tx - px;
  let dy = ty - py;
  let dz = tz - pz;

  const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  /*
   * Network packets podem chegar atrasados.
   * Nunca tenta atravessar uma parede com um único salto gigante.
   */
  const MAX_STEP = 0.55;

  let nx = px;
  let ny = py;
  let nz = pz;

  if (distance <= MAX_STEP) {
    nx = tx;
    ny = ty;
    nz = tz;
  } else {
    const scale = MAX_STEP / distance;

    nx += dx * scale;
    ny += dy * scale;
    nz += dz * scale;
  }

  /*
   * Guarda velocidade estimada.
   */
  const safeDt = Math.max(0.001, Math.min(0.1, Number(dt) || 0.05));

  const vx = (nx - px) / safeDt;
  const vy = (ny - py) / safeDt;
  const vz = (nz - pz) / safeDt;

  remote.vx = vx;
  remote.vy = vy;
  remote.vz = vz;

  /*
   * Atualiza os campos básicos do bot.
   */
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

  /*
   * Não força onGround.
   */
  if (remote.onGround !== undefined) {
    try {
      bot.onGround = !!remote.onGround;
    } catch {}
  }

  /*
   * Posição.
   *
   * Primeiro tentamos o método físico/nativo do bot.
   * Só usamos os campos diretos como fallback.
   */
  let applied = false;

  try {
    if (typeof bot.setPosition === "function") {
      bot.setPosition(nx, ny, nz);
      applied = true;
    }
  } catch {}

  if (!applied) {
    try {
      if (typeof bot.setPos === "function") {
        bot.setPos(nx, ny, nz);
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

  /*
   * Rotação.
   */
  const yaw = Number.isFinite(Number(remote.targetYaw))
    ? Number(remote.targetYaw)
    : Number(remote.yaw) || 0;

  const pitch = Number.isFinite(Number(remote.targetPitch))
    ? Number(remote.targetPitch)
    : Number(remote.pitch) || 0;

  remote.yaw = yaw;
  remote.pitch = pitch;

  try {
    bot.yaw = yaw;
  } catch {}

  try {
    bot.pitch = pitch;
  } catch {}

  try {
    bot._lookPitch = pitch;
  } catch {}

  try {
    bot.rotationY = yaw;
  } catch {}

  /*
   * CS2 body/agent.
   */
  try {
    if (typeof bot._updateCS2Body === "function") {
      bot._updateCS2Body();
    }
  } catch {}

  try {
    const agent = bot.cs2Agent;

    if (agent) {
      if (typeof agent.setTransform === "function") {
        agent.setTransform(nx, ny, nz, yaw);
      }

      if (typeof agent.setPitch === "function") {
        agent.setPitch(pitch);
      }

      if (typeof agent.update === "function") {
        agent.update(
          safeDt,
          !!remote.onGround,
          !!remote.crouching
        );
      }
    }
  } catch {}

  /*
   * Estado visual.
   */
  try {
    bot.team = remote.team || bot.team;
  } catch {}

  try {
    bot.name = remote.name || bot.name;
  } catch {}

  try {
    bot.alive = remote.alive !== false;
  } catch {}

  try {
    if (remote.health !== undefined) {
      bot.health = remote.health;
    }
  } catch {}

  /*
   * Nunca deixa o remote ser destruído só porque
   * um pacote atrasou.
   */
  if (remote.alive === false) {
    try {
      bot.alive = false;
    } catch {}

    try {
      if (typeof bot.visible !== "undefined") {
        bot.visible = false;
      }
    } catch {}
  } else {
    try {
      bot.visible = true;
    } catch {}
  }

  remote.lastApplied = now;

  try {
    RemoteBots.applyAvatars();
  } catch {}
}

        applyImmediate(remote) {
            if (
                !remote ||
                !remote.bot
            ) {
                return;
            }

            const bot =
                remote.bot;

            const x =
                safeNumber(
                    remote.targetX,
                    0
                );

            const y =
                safeNumber(
                    remote.targetY,
                    0
                );

            const z =
                safeNumber(
                    remote.targetZ,
                    0
                );

            const yaw =
                safeNumber(
                    remote.targetYaw,
                    0
                );

            const pitch =
                safeNumber(
                    remote.targetPitch,
                    0
                );

            setTransform(
                bot,
                x,
                y,
                z
            );

            setRotation(
                bot,
                yaw,
                pitch
            );

            setVelocity(
                bot,
                safeNumber(
                    remote.targetVx,
                    0
                ),
                safeNumber(
                    remote.targetVy,
                    0
                ),
                safeNumber(
                    remote.targetVz,
                    0
                )
            );

            try {
                bot.onGround =
                    !!remote.targetOnGround;
            } catch {}

            try {
                bot.grounded =
                    !!remote.targetOnGround;
            } catch {}

            try {
                bot.crouching =
                    !!remote.targetCrouching;
            } catch {}

            try {
                bot.alive =
                    remote.alive !==
                    false;
            } catch {}

            try {
                bot.health =
                    remote.alive !==
                    false
                        ? 100
                        : 0;
            } catch {}

            try {
                bot.team =
                    normalizeTeam(
                        remote.team
                    );
            } catch {}

            try {
                bot.name =
                    remote.name;
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

                if (
                    agent
                ) {
                    if (
                        typeof agent.setTransform ===
                        "function"
                    ) {
                        agent.setTransform(
                            x,
                            y,
                            z
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
                }
            } catch {}

            try {
                const root =
                    bot.cs2Agent?.root;

                if (
                    root
                ) {
                    if (
                        root.position
                    ) {
                        root.position.x =
                            x;

                        root.position.y =
                            y;

                        root.position.z =
                            z;
                    }

                    if (
                        root.rotation
                    ) {
                        root.rotation.y =
                            yaw;
                    }

                    root.visible =
                        true;
                }
            } catch {}

            try {
                if (
                    bot.mesh
                ) {
                    bot.mesh.visible =
                        true;
                }
            } catch {}

            try {
                if (
                    bot.shadow
                ) {
                    bot.shadow.visible =
                        true;
                }
            } catch {}

            this.applyAvatars(
                remote
            );
        },

remove(id) {
  id = String(id || "");

  if (!id) return;

  const remote = this.remotes.get(id);

  if (!remote) {
    return;
  }

  /*
   * Só remove quando o servidor realmente mandar
   * player_left.
   *
   * Não chamamos isso por timeout, state vazio,
   * mudança de round ou perda temporária de foco.
   */
  console.log(
    "[Connections] Remote player removed:",
    id
  );

  try {
    this.destroyRemoteBot(remote);
  } catch (e) {
    console.warn(
      "[Connections] Failed destroying remote bot:",
      e
    );
  }

  this.remotes.delete(id);
}

        destroyRemoteBot(bot) {
            if (
                !bot
            ) {
                return;
            }

            try {
                bot.__connectionsRemote =
                    false;

                bot.__connectionsRemoved =
                    true;

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
                    typeof bot.despawn ===
                    "function"
                ) {
                    bot.despawn();
                }
            } catch {}

            try {
                if (
                    bot.cs2Agent?.root?.parent
                ) {
                    bot.cs2Agent.root.parent.remove(
                        bot.cs2Agent.root
                    );
                }
            } catch {}

            try {
                if (
                    bot.mesh?.parent
                ) {
                    bot.mesh.parent.remove(
                        bot.mesh
                    );
                }
            } catch {}

            try {
                if (
                    bot.shadow?.parent
                ) {
                    bot.shadow.parent.remove(
                        bot.shadow
                    );
                }
            } catch {}

            try {
                if (
                    State.game?.botMgr?.bots
                ) {
                    const list =
                        State.game.botMgr.bots;

                    const index =
                        list.indexOf(
                            bot
                        );

                    if (
                        index !==
                        -1
                    ) {
                        list.splice(
                            index,
                            1
                        );
                    }
                }
            } catch {}

            try {
                bot.update =
                    function() {};
            } catch {}
        },

        clear() {
            for (
                const remote
                of State.remotes.values()
            ) {
                if (
                    remote.bot
                ) {
                    this.destroyRemoteBot(
                        remote.bot
                    );
                }
            }

            State.remotes.clear();

            this.restoreOriginalBots();

            this.rebuildAvatars();

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
                !mgr ||
                !Array.isArray(
                    mgr.bots
                )
            ) {
                return;
            }

            if (
                !State.originalBots.length
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
                    if (
                        !bot
                    ) {
                        continue;
                    }

                    bot.__connectionsPool =
                        false;

                    bot.__connectionsRemote =
                        false;

                    bot.__connectionsRemoved =
                        false;

                    try {
                        bot.alive =
                            true;
                    } catch {}

                    try {
                        if (
                            bot.health <=
                            0
                        ) {
                            bot.health =
                                100;
                        }
                    } catch {}

                    try {
                        if (
                            bot.__connectionsOriginalUpdate
                        ) {
                            bot.update =
                                bot.__connectionsOriginalUpdate;
                        }
                    } catch {}

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

                    try {
                        if (
                            bot.mesh
                        ) {
                            bot.mesh.visible =
                                true;
                        }
                    } catch {}

                    try {
                        if (
                            bot.shadow
                        ) {
                            bot.shadow.visible =
                                true;
                        }
                    } catch {}

                    mgr.bots.push(
                        bot
                    );
                }

                log(
                    "Original AI bots restored."
                );
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

            State.preparingBots =
                false;
        },

        rebuildAvatars() {
            const game =
                getGame();

            if (
                !game
            ) {
                return;
            }

            try {
                if (
                    game.hud &&
                    typeof game.hud.buildAvatars ===
                    "function"
                ) {
                    game.hud.buildAvatars();
                }
            } catch {}

            setTimeout(
                () => {
                    for (
                        const remote
                        of State.remotes.values()
                    ) {
                        this.applyAvatars(
                            remote
                        );
                    }
                },
                50
            );
        },

        applyAvatars(remote) {
            if (
                !remote
            ) {
                return;
            }

            const avatar =
                remote.avatarEnabled !==
                    false &&
                remote.avatar
                    ? remote.avatar
                    : null;

            const game =
                getGame();

            if (
                !game
            ) {
                return;
            }

            try {
                const hud =
                    game.hud;

                if (
                    hud
                ) {
                    const roots = [
                        hud.avatars,
                        hud.avatarRows,
                        hud.scoreboard,
                        hud.scoreboardRows
                    ];

                    for (
                        const root
                        of roots
                    ) {
                        if (
                            !root
                        ) {
                            continue;
                        }

                        this.walkAvatarObjects(
                            root,
                            remote,
                            avatar
                        );
                    }
                }
            } catch {}

            try {
                const rows =
                    document.querySelectorAll(
                        "[data-player-id], [data-id]"
                    );

                rows.forEach(
                    row => {
                        const rowId =
                            row.getAttribute(
                                "data-player-id"
                            ) ||
                            row.getAttribute(
                                "data-id"
                            );

                        if (
                            String(
                                rowId
                            ) !==
                            String(
                                remote.id
                            )
                        ) {
                            return;
                        }

                        const image =
                            row.querySelector(
                                "img"
                            );

                        if (
                            image &&
                            avatar
                        ) {
                            image.src =
                                avatar;

                            image.style.display =
                                "block";
                        }
                    }
                );
            } catch {}
        },

        walkAvatarObjects(
            object,
            remote,
            avatar
        ) {
            if (
                !object
            ) {
                return;
            }

            if (
                object.nodeType ===
                1
            ) {
                try {
                    const id =
                        object.getAttribute(
                            "data-player-id"
                        ) ||
                        object.getAttribute(
                            "data-id"
                        );

                    if (
                        id &&
                        String(id) ===
                        String(remote.id)
                    ) {
                        const img =
                            object.querySelector(
                                "img"
                            );

                        if (
                            img
                        ) {
                            if (
                                avatar
                            ) {
                                img.src =
                                    avatar;

                                img.style.display =
                                    "block";
                            } else {
                                img.style.display =
                                    "none";
                            }
                        }
                    }
                } catch {}
            }

            if (
                typeof object !==
                "object"
            ) {
                return;
            }

            const visited =
                new Set();

            const walk = value => {
                if (
                    !value ||
                    typeof value !==
                    "object"
                ) {
                    return;
                }

                if (
                    visited.has(
                        value
                    )
                ) {
                    return;
                }

                visited.add(
                    value
                );

                try {
                    if (
                        value.playerId !==
                        undefined &&
                        String(
                            value.playerId
                        ) ===
                        String(
                            remote.id
                        )
                    ) {
                        if (
                            value.src !==
                            undefined
                        ) {
                            value.src =
                                avatar ||
                                "";
                        }

                        if (
                            value.texture !==
                            undefined
                        ) {
                            value.texture =
                                avatar ||
                                "";
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

                for (
                    const key
                    of keys
                ) {
                    try {
                        const child =
                            value[key];

                        if (
                            Array.isArray(
                                child
                            )
                        ) {
                            child.forEach(
                                walk
                            );
                        } else if (
                            child &&
                            typeof child ===
                            "object"
                        ) {
                            walk(
                                child
                            );
                        }
                    } catch {}
                }
            };

            walk(
                object
            );
        }
    };

    /*
     * =========================================================
     * CHAT
     * =========================================================
     */

    const Chat = {

        send(message) {
            const text =
                String(
                    message ||
                    ""
                )
                    .trim()
                    .slice(
                        0,
                        300
                    );

            if (
                !text ||
                !State.connected ||
                !State.room
            ) {
                return;
            }

            Network.send({
                type:
                    "chat",

                message:
                    text,

                name:
                    State.name
            });
        }
    };
    /*
     * =========================================================
     * MATCH LIFECYCLE
     * =========================================================
     */

    function handleMatchEnd() {
        if (
            State.matchEnding
        ) {
            return;
        }

        State.matchEnding =
            true;

        log(
            "Match ended. Cleaning multiplayer state."
        );

        Music.stopForMatchEnd();

        if (
            State.connected
        ) {
            Network.send({
                type:
                    "leave_room"
            });
        }

        RemoteBots.clear();

        State.room =
            null;

        State.isHost =
            false;

        State.matchSync.hostId =
            null;

        State.matchSync.roundSeq =
            0;

        State.matchSync.lastActive =
            null;

        State.matchSync.roundEndAt =
            0;

        State.matchSync.endAt =
            0;

        State.matchSync.lastReceived =
            0;

        State.hostRoundSeq =
            0;

        State.hostLastActive =
            null;

        State.hostRoundEndAt =
            0;

        State.hostEndAt =
            0;

        State.confirmedMatch =
            false;

        State.outsideMatchSince =
            0;

        UI.setScanState(
            false
        );

        UI.renderRoom();

        UI.setMessage(
            "Lobby. Enter a match and press Confirm."
        );

        State.matchEnding =
            false;
    }

    function monitorGame() {
        const game =
            getGame();

        if (
            game &&
            State.game !==
            game
        ) {
            State.game =
                game;

            log(
                "Game engine detected."
            );
        }

        if (
            !game
        ) {
            return;
        }

        if (
            State.confirmedMatch
        ) {
            const inside =
                isInsideMatch(
                    game
                );

            if (
                inside
            ) {
                State.outsideMatchSince =
                    0;
            } else if (
                State.room
            ) {
                if (
                    !State.outsideMatchSince
                ) {
                    State.outsideMatchSince =
                        Date.now();

                    log(
                        "Temporarily outside match state. Waiting for transition..."
                    );
                }

                /*
                 * Team selection / round transitions can briefly
                 * report a non-playing state. Do not instantly
                 * destroy all remote players.
                 */
                if (
                    Date.now() -
                    State.outsideMatchSince >
                    1800
                ) {
                    handleMatchEnd();
                }
            }
        }

        if (
            State.confirmedMatch &&
            State.room &&
            State.isHost
        ) {
            broadcastRoundState();
        }

        if (
            State.confirmedMatch &&
            State.room &&
            !State.isHost
        ) {
            applyAuthoritativeMatchState();
        }
    }

    function startMonitor() {
        if (
            State.monitorTimer
        ) {
            return;
        }

        State.monitorTimer =
            setInterval(
                monitorGame,
                CONFIG.MATCH_CHECK_RATE
            );
    }

    /*
     * =========================================================
     * ENGINE SCANNER
     * =========================================================
     */

    function scanEngine() {
        const game =
            getGame();

        if (
            !game
        ) {
            warn(
                "Game engine not found."
            );

            return null;
        }

        State.game =
            game;

        const result = {
            game,
            player:
                getPlayer(),

            botMgr:
                game.botMgr ||
                null,

            physics:
                game.physics ||
                null,

            hud:
                game.hud ||
                null
        };

        log(
            "Engine scan:",
            result
        );

        return result;
    }

    /*
     * =========================================================
     * MATCH CONFIRMATION
     * =========================================================
     */

    function confirmMatch() {
        if (
            State.confirmedMatch
        ) {
            return;
        }

        const game =
            getGame();

        if (
            !game
        ) {
            UI.setMessage(
                "Game engine not found."
            );

            return;
        }

        if (
            !isInsideMatch(
                game
            )
        ) {
            UI.setMessage(
                "You must already be inside a match."
            );

            return;
        }

        UI.setScanState(
            true
        );

        UI.setMessage(
            "Scanning game engine..."
        );

        setTimeout(
            () => {
                const result =
                    scanEngine();

                if (
                    !result
                ) {
                    UI.setScanState(
                        false
                    );

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
                    UI.setScanState(
                        false
                    );

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

                if (
                    !prepared
                ) {
                    UI.setScanState(
                        false
                    );

                    UI.setMessage(
                        "Could not prepare native bots."
                    );

                    return;
                }

                State.confirmedMatch =
                    true;

                State.matchEnding =
                    false;

                State.outsideMatchSince =
                    0;

                UI.setScanState(
                    false
                );

                UI.setMessage(
                    "Multiplayer active."
                );

                log(
                    "Match confirmed."
                );

                Network.connect();
            },
            80
        );
    }

    /*
     * =========================================================
     * ROOM MANAGEMENT
     * =========================================================
     */

    function createRoom(
        name,
        maxPlayers
    ) {
        if (
            !State.connected
        ) {
            UI.setMessage(
                "Not connected."
            );

            return;
        }

        if (
            !State.confirmedMatch
        ) {
            UI.setMessage(
                "Confirm that you are inside a match first."
            );

            return;
        }

        const roomName =
            String(
                name ||
                ""
            )
                .trim()
                .slice(
                    0,
                    32
                );

        const max =
            clamp(
                Number(
                    maxPlayers
                ) || 8,
                2,
                32
            );

        Network.send({
            type:
                "create_room",

            name:
                roomName ||
                "Connections Room",

            maxPlayers:
                max
        });
    }

    function joinRoom(
        room
    ) {
        if (
            !State.connected
        ) {
            UI.setMessage(
                "Not connected."
            );

            return;
        }

        const id =
            roomId(
                room
            );

        if (
            !id
        ) {
            return;
        }

        Network.send({
            type:
                "join_room",

            room:
                id,

            roomId:
                id,

            id
        });

        UI.setMessage(
            "Joining room..."
        );
    }

    function leaveRoom() {
        if (
            !State.room
        ) {
            return;
        }

        Music.stop();

        Network.send({
            type:
                "leave_room"
        });

        const oldRoom =
            State.room;

        State.room =
            null;

        State.isHost =
            false;

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

    /*
     * =========================================================
     * UI
     * =========================================================
     */

    const UI = {

        root:
            null,

        serverList:
            null,

        roomInfo:
            null,

        status:
            null,

        message:
            null,

        chatLog:
            null,

        avatarInput:
            null,

        avatarToggle:
            null,

        scanButton:
            null,

        roomName:
            null,

        roomMax:
            null,

        init() {
            if (
                this.root
            ) {
                return;
            }

            const style =
                document.createElement(
                    "style"
                );

            style.textContent = `
                #connections-root {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 430px;
                    max-height: 86vh;
                    overflow-y: auto;
                    z-index: 2147483647;
                    background: #111318;
                    color: #f4f4f5;
                    border: 1px solid #2c2f38;
                    border-radius: 14px;
                    box-shadow: 0 20px 70px rgba(0,0,0,.65);
                    font-family: Inter, Arial, sans-serif;
                    padding: 16px;
                    display: none;
                    box-sizing: border-box;
                }

                #connections-root * {
                    box-sizing: border-box;
                }

                .connections-title {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 14px;
                }

                .connections-title h2 {
                    margin: 0;
                    font-size: 20px;
                    font-weight: 800;
                }

                .connections-version {
                    font-size: 11px;
                    color: #737985;
                }

                .connections-status {
                    padding: 9px 10px;
                    border-radius: 8px;
                    background: #191c23;
                    color: #9ca3af;
                    font-size: 12px;
                    margin-bottom: 12px;
                }

                .connections-section {
                    background: #171a20;
                    border: 1px solid #262a33;
                    border-radius: 10px;
                    padding: 12px;
                    margin-bottom: 10px;
                }

                .connections-section-title {
                    font-size: 12px;
                    font-weight: 800;
                    text-transform: uppercase;
                    letter-spacing: .06em;
                    color: #8f96a3;
                    margin-bottom: 9px;
                }

                .connections-row {
                    display: flex;
                    gap: 7px;
                    align-items: center;
                }

                .connections-row + .connections-row {
                    margin-top: 7px;
                }

                .connections-input {
                    width: 100%;
                    border: 1px solid #30343e;
                    background: #0e1014;
                    color: #fff;
                    border-radius: 8px;
                    padding: 9px 10px;
                    outline: none;
                }

                .connections-input:focus {
                    border-color: #7289da;
                }

                .connections-button {
                    border: 0;
                    border-radius: 8px;
                    background: #7289da;
                    color: white;
                    padding: 9px 11px;
                    font-weight: 700;
                    cursor: pointer;
                    white-space: nowrap;
                }

                .connections-button:hover {
                    filter: brightness(1.08);
                }

                .connections-button.secondary {
                    background: #252932;
                }

                .connections-button.danger {
                    background: #7f2932;
                }

                .connections-button:disabled {
                    opacity: .5;
                    cursor: default;
                }

                .connections-scan {
                    width: 100%;
                    padding: 12px;
                    font-size: 13px;
                    margin-bottom: 10px;
                }

                .connections-room {
                    font-size: 13px;
                    color: #d5d7dc;
                }

                .connections-room strong {
                    color: #fff;
                }

                .connections-room-item {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                    padding: 9px;
                    border-radius: 8px;
                    background: #101218;
                    margin-top: 6px;
                }

                .connections-room-name {
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .connections-room-meta {
                    font-size: 10px;
                    color: #747a86;
                    margin-top: 2px;
                }

                .connections-message {
                    min-height: 18px;
                    font-size: 11px;
                    color: #8e96a5;
                    margin-top: 8px;
                }

                .connections-avatar-preview {
                    width: 48px;
                    height: 48px;
                    border-radius: 50%;
                    object-fit: cover;
                    background: #0b0d11;
                    border: 1px solid #30343e;
                }

                .connections-chat {
                    height: 145px;
                    overflow-y: auto;
                    background: #0d0f13;
                    border-radius: 8px;
                    border: 1px solid #272b34;
                    padding: 8px;
                    font-size: 12px;
                }

                .connections-chat-line {
                    padding: 4px 0;
                    word-break: break-word;
                }

                .connections-chat-name {
                    font-weight: 800;
                    color: #aebcff;
                }

                .connections-help {
                    color: #747b88;
                    font-size: 10px;
                    line-height: 1.5;
                }
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
                <div class="connections-title">
                    <h2>Connections</h2>
                    <span class="connections-version">
                        v${escapeHtml(
                            CONFIG.VERSION
                        )}
                    </span>
                </div>

                <div
                    id="connections-status"
                    class="connections-status"
                >
                    Disconnected
                </div>

                <button
                    id="connections-scan"
                    class="connections-button connections-scan"
                >
                    I AM IN A MATCH
                </button>

                <div class="connections-section">
                    <div class="connections-section-title">
                        Player
                    </div>

                    <div class="connections-row">
                        <input
                            id="connections-name"
                            class="connections-input"
                            maxlength="24"
                            placeholder="Username"
                        />

                        <button
                            id="connections-name-save"
                            class="connections-button"
                        >
                            Save
                        </button>
                    </div>
                </div>

                <div class="connections-section">
                    <div class="connections-section-title">
                        Avatar
                    </div>

                    <div class="connections-row">
                        <img
                            id="connections-avatar-preview"
                            class="connections-avatar-preview"
                            alt=""
                        />

                        <input
                            id="connections-avatar-input"
                            type="file"
                            accept="image/*"
                            class="connections-input"
                        />
                    </div>

                    <div class="connections-row">
                        <button
                            id="connections-avatar-toggle"
                            class="connections-button secondary"
                        >
                            Avatar: ON
                        </button>

                        <button
                            id="connections-avatar-reset"
                            class="connections-button danger"
                        >
                            Reset
                        </button>
                    </div>
                </div>

                <div class="connections-section">
                    <div class="connections-section-title">
                        Current room
                    </div>

                    <div
                        id="connections-room-info"
                        class="connections-room"
                    >
                        Not in a room.
                    </div>

                    <div class="connections-row" style="margin-top:8px;">
                        <button
                            id="connections-leave"
                            class="connections-button danger"
                        >
                            Leave
                        </button>
                    </div>
                </div>

                <div class="connections-section">
                    <div class="connections-section-title">
                        Create room
                    </div>

                    <div class="connections-row">
                        <input
                            id="connections-room-name"
                            class="connections-input"
                            maxlength="32"
                            placeholder="Room name"
                        />

                        <input
                            id="connections-room-max"
                            class="connections-input"
                            type="number"
                            min="2"
                            max="32"
                            value="8"
                            style="max-width:75px;"
                        />

                        <button
                            id="connections-create"
                            class="connections-button"
                        >
                            Create
                        </button>
                    </div>
                </div>

                <div class="connections-section">
                    <div class="connections-section-title">
                        Servers
                    </div>

                    <div
                        id="connections-servers"
                    ></div>
                </div>

                <div class="connections-section">
                    <div class="connections-section-title">
                        Chat
                    </div>

                    <div
                        id="connections-chat"
                        class="connections-chat"
                    ></div>

                    <div class="connections-row">
                        <input
                            id="connections-chat-input"
                            class="connections-input"
                            maxlength="300"
                            placeholder="Message..."
                        />

                        <button
                            id="connections-chat-send"
                            class="connections-button"
                        >
                            Send
                        </button>
                    </div>
                </div>

                <div
                    id="connections-message"
                    class="connections-message"
                ></div>

                <div class="connections-help">
                    Backspace: open/close menu.<br>
                    Enter a match first, then press
                    "I AM IN A MATCH".
                </div>
            `;

            document.body.appendChild(
                root
            );

            this.root =
                root;

            this.serverList =
                root.querySelector(
                    "#connections-servers"
                );

            this.roomInfo =
                root.querySelector(
                    "#connections-room-info"
                );

            this.status =
                root.querySelector(
                    "#connections-status"
                );

            this.message =
                root.querySelector(
                    "#connections-message"
                );

            this.chatLog =
                root.querySelector(
                    "#connections-chat"
                );

            this.avatarInput =
                root.querySelector(
                    "#connections-avatar-input"
                );

            this.avatarToggle =
                root.querySelector(
                    "#connections-avatar-toggle"
                );

            this.scanButton =
                root.querySelector(
                    "#connections-scan"
                );

            this.roomName =
                root.querySelector(
                    "#connections-room-name"
                );

            this.roomMax =
                root.querySelector(
                    "#connections-room-max"
                );

            const nameInput =
                root.querySelector(
                    "#connections-name"
                );

            nameInput.value =
                State.name;

            root.querySelector(
                "#connections-name-save"
            ).addEventListener(
                "click",
                () => {
                    const value =
                        String(
                            nameInput.value ||
                            ""
                        )
                            .trim()
                            .slice(
                                0,
                                24
                            );

                    if (
                        !value
                    ) {
                        return;
                    }

                    State.name =
                        value;

                    try {
                        localStorage.setItem(
                            "connections_player_name",
                            value
                        );
                    } catch {}

                    UI.setMessage(
                        "Username saved."
                    );
                }
            );

            this.scanButton.addEventListener(
                "click",
                confirmMatch
            );

            this.avatarInput.addEventListener(
                "change",
                event => {
                    const file =
                        event.target
                            ?.files?.[0];

                    Avatar.setFile(
                        file
                    );
                }
            );

            this.avatarToggle.addEventListener(
                "click",
                () => {
                    Avatar.toggle();
                }
            );

            root.querySelector(
                "#connections-avatar-reset"
            ).addEventListener(
                "click",
                () => {
                    Avatar.reset();
                }
            );

            root.querySelector(
                "#connections-create"
            ).addEventListener(
                "click",
                () => {
                    createRoom(
                        this.roomName.value,
                        this.roomMax.value
                    );
                }
            );

            root.querySelector(
                "#connections-leave"
            ).addEventListener(
                "click",
                leaveRoom
            );

            root.querySelector(
                "#connections-chat-send"
            ).addEventListener(
                "click",
                () => {
                    const input =
                        root.querySelector(
                            "#connections-chat-input"
                        );

                    Chat.send(
                        input.value
                    );

                    input.value =
                        "";
                }
            );

            root.querySelector(
                "#connections-chat-input"
            ).addEventListener(
                "keydown",
                event => {
                    if (
                        event.key ===
                        "Enter"
                    ) {
                        event.preventDefault();

                        const input =
                            event.currentTarget;

                        Chat.send(
                            input.value
                        );

                        input.value =
                            "";
                    }
                }
            );

            this.updateAvatarControls();
            this.renderRooms();
            this.renderRoom();
        },

        toggle() {
            this.init();

            State.ui.open =
                !State.ui.open;

            this.root.style.display =
                State.ui.open
                    ? "block"
                    : "none";
        },

        setScanState(
            scanning
        ) {
            this.init();

            if (
                scanning
            ) {
                this.scanButton.disabled =
                    true;

                this.scanButton.textContent =
                    "SCANNING...";
            } else {
                this.scanButton.disabled =
                    false;

                this.scanButton.textContent =
                    State.confirmedMatch
                        ? "MATCH CONFIRMED"
                        : "I AM IN A MATCH";
            }
        },

        updateStatus(
            text
        ) {
            this.init();

            this.status.textContent =
                String(
                    text ||
                    ""
                );
        },

        setMessage(
            text
        ) {
            this.init();

            this.message.textContent =
                String(
                    text ||
                    ""
                );
        },

        updateAvatarControls() {
            if (
                !this.avatarToggle
            ) {
                return;
            }

            this.avatarToggle.textContent =
                `Avatar: ${
                    State.avatarEnabled
                        ? "ON"
                        : "OFF"
                }`;

            const preview =
                this.root.querySelector(
                    "#connections-avatar-preview"
                );

            if (
                preview
            ) {
                if (
                    State.avatar &&
                    State.avatarEnabled
                ) {
                    preview.src =
                        State.avatar;
                } else {
                    preview.removeAttribute(
                        "src"
                    );
                }
            }
        },

        renderRooms() {
            if (
                !this.serverList
            ) {
                return;
            }

            if (
                !State.rooms.length
            ) {
                this.serverList.innerHTML =
                    `
                    <div class="connections-help">
                        No rooms available.
                    </div>
                    `;

                return;
            }

            this.serverList.innerHTML =
                State.rooms
                    .map(
                        room => {
                            const id =
                                room.id ??
                                room.roomId ??
                                "";

                            const name =
                                room.name ??
                                "Room";

                            const players =
                                room.players ??
                                room.count ??
                                0;

                            const max =
                                room.maxPlayers ??
                                0;

                            return `
                                <div class="connections-room-item">
                                    <div class="connections-room-name">
                                        <div>
                                            ${escapeHtml(
                                                name
                                            )}
                                        </div>
                                        <div class="connections-room-meta">
                                            ${escapeHtml(
                                                players
                                            )}/${escapeHtml(
                                                max
                                            )}
                                        </div>
                                    </div>

                                    <button
                                        class="connections-button"
                                        data-join-room="${escapeHtml(
                                            id
                                        )}"
                                    >
                                        Join
                                    </button>
                                </div>
                            `;
                        }
                    )
                    .join("");

            this.serverList
                .querySelectorAll(
                    "[data-join-room]"
                )
                .forEach(
                    button => {
                        button.addEventListener(
                            "click",
                            () => {
                                joinRoom(
                                    button.getAttribute(
                                        "data-join-room"
                                    )
                                );
                            }
                        );
                    }
                );
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
                this.roomInfo.innerHTML =
                    "Not in a room.";

                return;
            }

            const room =
                getRoomObject(
                    State.room
                );

            const roomName =
                room?.name ||
                State.room;

            const count =
                room?.players ??
                room?.count ??
                State.remotes.size +
                1;

            const max =
                room?.maxPlayers ??
                "?";

            this.roomInfo.innerHTML = `
                <strong>
                    ${escapeHtml(
                        roomName
                    )}
                </strong>
                <br>
                ID:
                ${escapeHtml(
                    State.room
                )}
                <br>
                Players:
                ${escapeHtml(
                    count
                )}/${escapeHtml(
                    max
                )}
            `;
        },

        addChatMessage(data) {
            if (
                !this.chatLog
            ) {
                return;
            }

            const name =
                data.name ||
                data.playerName ||
                "Player";

            const message =
                data.message ||
                "";

            const line =
                document.createElement(
                    "div"
                );

            line.className =
                "connections-chat-line";

            line.innerHTML = `
                <span class="connections-chat-name">
                    ${escapeHtml(
                        name
                    )}
                </span>
                :
                ${escapeHtml(
                    message
                )}
            `;

            this.chatLog.appendChild(
                line
            );

            while (
                this.chatLog.children
                    .length > 100
            ) {
                this.chatLog.firstChild
                    ?.remove();
            }

            this.chatLog.scrollTop =
                this.chatLog.scrollHeight;
        }
    };

    /*
     * =========================================================
     * KEYBOARD / VISIBILITY
     * =========================================================
     */

    function installKeyboard() {
        window.addEventListener(
            "keydown",
            event => {
                if (
                    event.repeat
                ) {
                    return;
                }

                if (
                    event.key ===
                    "Backspace"
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

                    if (
                        typing
                    ) {
                        return;
                    }

                    event.preventDefault();

                    UI.toggle();
                }
            },
            true
        );
    }

    function installVisibilityHooks() {
        document.addEventListener(
            "visibilitychange",
            () => {
                if (
                    document.hidden
                ) {
                    log(
                        "Window unfocused. Multiplayer remains active."
                    );

                    return;
                }

                log(
                    "Window focused."
                );

                if (
                    State.confirmedMatch
                ) {
                    State.avatarDirty =
                        true;

                    RemoteBots.rebuildAvatars();
                }
            }
        );

        window.addEventListener(
            "focus",
            () => {
                if (
                    State.confirmedMatch
                ) {
                    State.avatarDirty =
                        true;
                }
            }
        );

        window.addEventListener(
            "blur",
            () => {
                /*
                 * Intentionally do not disconnect.
                 */
            }
        );
    }

    /*
     * =========================================================
     * HEARTBEAT
     * =========================================================
     */

    function startHeartbeat() {
        if (
            State.visibilityTimer
        ) {
            return;
        }

        State.visibilityTimer =
            setInterval(
                () => {
                    if (
                        State.connected
                    ) {
                        Network.send({
                            type:
                                "ping",
                            t:
                                Date.now()
                        });
                    }
                },
                1000
            );
    }

    /*
     * =========================================================
     * GLOBAL DEBUG API
     * =========================================================
     */

    function installDebugAPI() {
        try {
            PAGE.__connections_multiplayer = {
                state:
                    State,

                network:
                    Network,

                remoteBots:
                    RemoteBots,

                avatar:
                    Avatar,

                music:
                    Music,

                headBoost:
                    HeadBoost,

                chat:
                    Chat,

                getGame,

                getPlayer,

                isInsideMatch,

                confirmMatch,

                createRoom,

                joinRoom,

                leaveRoom,

                scanEngine,

                sendLocalState,

                debug() {
                    return {
                        version:
                            CONFIG.VERSION,

                        connected:
                            State.connected,

                        id:
                            State.id,

                        room:
                            State.room,

                        confirmedMatch:
                            State.confirmedMatch,

                        remotes:
                            State.remotes.size,

                        isHost:
                            State.isHost,

                        game:
                            !!getGame(),

                        inMatch:
                            isInsideMatch(),

                        botConstructor:
                            !!State.botCtor
                    };
                }
            };
        } catch (e) {
            warn(
                "Could not install debug API:",
                e
            );
        }
    }

    /*
     * =========================================================
     * INITIALIZATION
     * =========================================================
     */

    function init() {
        UI.init();

        installKeyboard();

        installVisibilityHooks();

        startMonitor();

        startHeartbeat();

        installDebugAPI();

        State.game =
            getGame();

        log(
            `Connections ${CONFIG.VERSION} loaded.`
        );

        log(
            'Press [Backspace] to open.'
        );

        log(
            'Click "I AM IN A MATCH" after entering a match.'
        );

        if (
            State.game
        ) {
            log(
                "Game engine detected."
            );
        }
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
