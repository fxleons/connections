"use strict";

const http = require("http");
const WebSocket = require("ws");

let RAFIT = null;

try {
    RAFIT = require("./rafit.js");
    console.log("[Connections] RAFIT loaded.");
} catch (e) {
    console.warn(
        "[Connections] RAFIT unavailable:",
        e.message
    );
}

const HOST = "0.0.0.0";
const PORT = Number(
    process.env.PORT || 3000
);

const MAX_ROOMS = 100;
const DEFAULT_MAX_PLAYERS = 8;
const HARD_MAX_PLAYERS = 32;

const rooms = new Map();
const clients = new Map();

let nextClientId = 1;
let nextRoomId = 1;

function log() {
    console.log(
        "[Connections]",
        ...arguments
    );
}

function warn() {
    console.warn(
        "[Connections]",
        ...arguments
    );
}

function makeClientId() {
    const id =
        "player_" +
        Date.now().toString(36) +
        "_" +
        nextClientId.toString(36);

    nextClientId++;

    return id;
}

function makeRoomId() {
    const id =
        "room_" +
        Date.now().toString(36) +
        "_" +
        nextRoomId.toString(36);

    nextRoomId++;

    return id;
}

function cleanName(name) {
    if (
        typeof name !==
        "string"
    ) {
        return "Player";
    }

    name =
        name
            .replace(/[\u0000-\u001f\u007f]/g, "")
            .trim()
            .slice(0, 24);

    return name || "Player";
}

function cleanRoomName(name) {
    if (
        typeof name !==
        "string"
    ) {
        return "Connections Room";
    }

    name =
        name
            .replace(/[\u0000-\u001f\u007f]/g, "")
            .trim()
            .slice(0, 40);

    return name || "Connections Room";
}

function cleanAvatar(avatar) {
    if (
        typeof avatar !==
        "string"
    ) {
        return null;
    }

    if (
        !avatar.startsWith(
            "data:image/"
        )
    ) {
        return null;
    }

    if (
        avatar.length >
        1000000
    ) {
        return null;
    }

    return avatar;
}

function number(value) {
    const n =
        Number(value);

    if (
        !Number.isFinite(n)
    ) {
        return 0;
    }

    return Math.max(
        -1000000,
        Math.min(
            1000000,
            n
        )
    );
}

function cleanState(state) {
    if (
        !state ||
        typeof state !==
        "object"
    ) {
        return {
            x: 0,
            y: 0,
            z: 0,
            yaw: 0,
            pitch: 0,
            alive: true,
            team: "CT",
            name: "Player"
        };
    }

    return {
        x: number(state.x),
        y: number(state.y),
        z: number(state.z),

        yaw: number(
            state.yaw
        ),

        pitch: number(
            state.pitch
        ),

        alive:
            state.alive !== false,

        team:
            state.team === "T"
                ? "T"
                : "CT",

        name:
            cleanName(
                state.name
            ),

        avatar:
            cleanAvatar(
                state.avatar
            )
    };
}

function safeSend(
    ws,
    packet
) {
    if (
        !ws ||
        ws.readyState !==
        WebSocket.OPEN
    ) {
        return false;
    }

    try {
        ws.send(
            JSON.stringify(packet)
        );

        return true;
    } catch (e) {
        warn(
            "send failed:",
            e.message
        );

        return false;
    }
}

function broadcast(
    room,
    packet,
    exceptId
) {
    if (!room) {
        return;
    }

    for (
        const id of
        room.players
    ) {
        if (
            exceptId &&
            String(id) ===
            String(exceptId)
        ) {
            continue;
        }

        const client =
            clients.get(
                String(id)
            );

        if (client) {
            safeSend(
                client.ws,
                packet
            );
        }
    }
}

function broadcastAll(
    packet
) {
    for (
        const client of
        clients.values()
    ) {
        safeSend(
            client.ws,
            packet
        );
    }
}

function publicClient(
    client
) {
    if (!client) {
        return null;
    }

    return {
        id: client.id,

        name:
            client.name,

        avatar:
            client.avatar,

        team:
            client.state.team,

        state: {
            x:
                client.state.x,

            y:
                client.state.y,

            z:
                client.state.z,

            yaw:
                client.state.yaw,

            pitch:
                client.state.pitch,

            alive:
                client.state.alive,

            team:
                client.state.team,

            name:
                client.name,

            avatar:
                client.avatar
        }
    };
}

function publicRoom(
    room
) {
    if (!room) {
        return null;
    }

    return {
        id:
            room.id,

        roomId:
            room.id,

        name:
            room.name,

        host:
            room.host,

        owner:
            room.host,

        maxPlayers:
            room.maxPlayers,

        players:
            room.players.size,

        playerCount:
            room.players.size,

        locked:
            false,

        createdAt:
            room.createdAt
    };
}

function getRoomsList() {
    return Array.from(
        rooms.values()
    ).map(
        publicRoom
    );
}

function sendRooms(
    ws
) {
    safeSend(
        ws,
        {
            type: "rooms",
            rooms:
                getRoomsList()
        }
    );
}

function sendRoomsToAll() {
    for (
        const client of
        clients.values()
    ) {
        sendRooms(
            client.ws
        );
    }
}

function getRoom(
    id
) {
    if (
        id === null ||
        id === undefined
    ) {
        return null;
    }

    return (
        rooms.get(
            String(id)
        ) || null
    );
}

function createRoom(
    name,
    maxPlayers
) {
    if (
        rooms.size >=
        MAX_ROOMS
    ) {
        return null;
    }

    let max =
        Number(
            maxPlayers
        );

    if (
        !Number.isFinite(max)
    ) {
        max =
            DEFAULT_MAX_PLAYERS;
    }

    max =
        Math.max(
            2,
            Math.min(
                HARD_MAX_PLAYERS,
                Math.floor(max)
            )
        );

    const room = {
        id:
            makeRoomId(),

        name:
            cleanRoomName(
                name
            ),

        host:
            null,

        maxPlayers:
            max,

        players:
            new Set(),

        createdAt:
            Date.now()
    };

    rooms.set(
        room.id,
        room
    );

    return room;
}

function leaveCurrentRoom(
    client,
    notifySelf
) {
    if (
        !client ||
        !client.room
    ) {
        return;
    }

    const room =
        getRoom(
            client.room
        );

    const oldRoomId =
        client.room;

    client.room =
        null;

    if (!room) {
        if (notifySelf) {
            safeSend(
                client.ws,
                {
                    type:
                        "left_room",
                    room:
                        oldRoomId
                }
            );
        }

        return;
    }

    room.players.delete(
        client.id
    );

    broadcast(
        room,
        {
            type:
                "player_left",

            id:
                client.id,

            playerId:
                client.id
        }
    );

    if (
        room.host ===
        client.id
    ) {
        const remaining =
            Array.from(
                room.players
            );

        if (
            remaining.length
        ) {
            room.host =
                remaining[0];
        } else {
            room.host =
                null;
        }
    }

    if (
        notifySelf
    ) {
        safeSend(
            client.ws,
            {
                type:
                    "left_room",

                room:
                    oldRoomId
            }
        );
    }

    if (
        room.players.size ===
        0
    ) {
        rooms.delete(
            room.id
        );

        broadcastAll({
            type:
                "room_deleted",

            room:
                room.id,

            roomId:
                room.id,

            reason:
                "Room is empty."
        });
    }

    sendRoomsToAll();
}

function checkRafit(
    client,
    professional
) {
    if (
        !RAFIT ||
        typeof RAFIT.canJoinRoom !==
        "function"
    ) {
        return {
            allowed: true
        };
    }

    try {
        const result =
            RAFIT.canJoinRoom(
                client.id,
                !!professional
            );

        if (
            result &&
            result.allowed === false
        ) {
            return result;
        }

        return {
            allowed: true,
            rtp:
                result &&
                result.rtp
        };
    } catch (e) {
        warn(
            "RAFIT check failed:",
            e.message
        );

        return {
            allowed: true
        };
    }
}

function joinRoom(
    client,
    room,
    data
) {
    if (
        !client ||
        !room
    ) {
        return false;
    }

    const rafit =
        checkRafit(
            client,
            data &&
            data.professional
        );

    if (
        !rafit.allowed
    ) {
        safeSend(
            client.ws,
            {
                type:
                    "error",

                message:
                    rafit.reason ||
                    "You cannot join this room.",

                error:
                    rafit.reason ||
                    "RAFIT_BLOCKED",

                bannedUntil:
                    rafit.bannedUntil ||
                    0,

                rtp:
                    rafit.rtp
            }
        );

        return false;
    }

    if (
        room.players.has(
            client.id
        )
    ) {
        safeSend(
            client.ws,
            {
                type:
                    "room_joined",

                room:
                    room.id,

                roomId:
                    room.id,

                id:
                    room.id,

                roomData:
                    publicRoom(room)
            }
        );

        return true;
    }

    if (
        room.players.size >=
        room.maxPlayers
    ) {
        safeSend(
            client.ws,
            {
                type:
                    "error",

                message:
                    "Room is full.",

                error:
                    "ROOM_FULL"
            }
        );

        return false;
    }

    if (
        client.room
    ) {
        leaveCurrentRoom(
            client,
            true
        );
    }

    room.players.add(
        client.id
    );

    client.room =
        room.id;

    if (
        !room.host
    ) {
        room.host =
            client.id;
    }

    safeSend(
        client.ws,
        {
            type:
                "room_joined",

            room:
                room.id,

            roomId:
                room.id,

            id:
                room.id,

            roomData:
                publicRoom(room)
        }
    );

    /*
     * Send the newcomer every player
     * already inside the room.
     */
    for (
        const otherId of
        room.players
    ) {
        if (
            String(otherId) ===
            String(client.id)
        ) {
            continue;
        }

        const other =
            clients.get(
                String(otherId)
            );

        if (!other) {
            continue;
        }

        safeSend(
            client.ws,
            {
                type:
                    "player_joined",

                id:
                    other.id,

                playerId:
                    other.id,

                name:
                    other.name,

                player:
                    publicClient(
                        other
                    )
            }
        );

        /*
         * Give the newcomer the latest state
         * immediately instead of waiting for
         * the next 50ms client tick.
         */
        safeSend(
            client.ws,
            {
                type:
                    "state",

                id:
                    other.id,

                playerId:
                    other.id,

                state:
                    other.state
            }
        );
    }

    /*
     * Tell everybody else that the newcomer
     * has entered.
     */
    broadcast(
        room,
        {
            type:
                "player_joined",

            id:
                client.id,

            playerId:
                client.id,

            name:
                client.name,

            player:
                publicClient(
                    client
                )
        },
        client.id
    );

    /*
     * Also send the new player's current
     * state to everybody else.
     */
    broadcast(
        room,
        {
            type:
                "state",

            id:
                client.id,

            playerId:
                client.id,

            state:
                client.state
        },
        client.id
    );

    sendRoomsToAll();

    log(
        "Player",
        client.name,
        "(" +
            client.id +
            ") joined",
        room.name,
        "(" +
            room.id +
            ")"
    );

    return true;
}

function handleHello(
    client,
    data
) {
    if (
        typeof data.name ===
        "string"
    ) {
        client.name =
            cleanName(
                data.name
            );
    }

    if (
        Object.prototype.hasOwnProperty.call(
            data,
            "avatar"
        )
    ) {
        client.avatar =
            cleanAvatar(
                data.avatar
            );
    }

    client.state.name =
        client.name;

    client.state.avatar =
        client.avatar;

    safeSend(
        client.ws,
        {
            type:
                "connected",

            id:
                client.id,

            clientId:
                client.id,

            playerId:
                client.id,

            name:
                client.name,

            avatar:
                client.avatar
        }
    );

    sendRooms(
        client.ws
    );
}

function handleListRooms(
    client
) {
    sendRooms(
        client.ws
    );
}

function handleCreateRoom(
    client,
    data
) {
    const room =
        createRoom(
            data.name,
            data.maxPlayers
        );

    if (!room) {
        safeSend(
            client.ws,
            {
                type:
                    "error",

                message:
                    "Could not create room.",

                error:
                    "ROOM_CREATE_FAILED"
            }
        );

        return;
    }

    joinRoom(
        client,
        room,
        data
    );
}

function handleJoinRoom(
    client,
    data
) {
    const id =
        data.room ??
        data.roomId ??
        data.id;

    const room =
        getRoom(id);

    if (!room) {
        safeSend(
            client.ws,
            {
                type:
                    "error",

                message:
                    "Room not found.",

                error:
                    "ROOM_NOT_FOUND"
            }
        );

        return;
    }

    joinRoom(
        client,
        room,
        data
    );
}

function handleLeaveRoom(
    client
) {
    leaveCurrentRoom(
        client,
        true
    );
}

function handleState(
    client,
    data
) {
    if (
        !client.room
    ) {
        return;
    }

    const room =
        getRoom(
            client.room
        );

    if (!room) {
        client.room =
            null;

        return;
    }

    const incoming =
        data.state &&
        typeof data.state ===
        "object"
            ? data.state
            : data;

    const previous = {
        x:
            client.state.x,

        y:
            client.state.y,

        z:
            client.state.z
    };

    const next =
        cleanState(
            incoming
        );

    /*
     * Preserve old values if the client
     * didn't include an avatar.
     */
    if (
        !Object.prototype.hasOwnProperty.call(
            incoming,
            "avatar"
        )
    ) {
        next.avatar =
            client.avatar;
    }

    if (
        typeof incoming.name !==
        "string"
    ) {
        next.name =
            client.name;
    }

    client.state =
        next;

    client.name =
        next.name;

    if (
        Object.prototype.hasOwnProperty.call(
            incoming,
            "avatar"
        )
    ) {
        client.avatar =
            next.avatar;
    }

    /*
     * Optional RAFIT movement inspection.
     * It only logs suspicious movement;
     * it does not kick the player here.
     */
    if (
        RAFIT &&
        typeof RAFIT.inspectMovement ===
        "function"
    ) {
        try {
            const now =
                Date.now();

            const dt =
                Math.max(
                    0.001,
                    (
                        now -
                        client.lastStateAt
                    ) / 1000
                );

            const movement =
                RAFIT.inspectMovement(
                    client.id,
                    {
                        x:
                            next.x,

                        y:
                            next.y,

                        z:
                            next.z,

                        lastX:
                            previous.x,

                        lastY:
                            previous.y,

                        lastZ:
                            previous.z,

                        dt
                    }
                );

            if (
                movement &&
                movement.suspicious
            ) {
                warn(
                    "Suspicious movement:",
                    client.name,
                    movement
                );
            }
        } catch (e) {
            warn(
                "RAFIT movement check failed:",
                e.message
            );
        }
    }

    client.lastStateAt =
        Date.now();

    broadcast(
        room,
        {
            type:
                "state",

            id:
                client.id,

            playerId:
                client.id,

            state:
                client.state
        },
        client.id
    );
}

function handlePing(
    client
) {
    safeSend(
        client.ws,
        {
            type:
                "pong",

            time:
                Date.now()
        }
    );
}

function handleMessage(
    client,
    raw
) {
    let data;

    try {
        data =
            JSON.parse(
                raw.toString()
            );
    } catch (e) {
        safeSend(
            client.ws,
            {
                type:
                    "error",

                message:
                    "Invalid JSON.",

                error:
                    "INVALID_JSON"
            }
        );

        return;
    }

    if (
        !data ||
        typeof data !==
        "object"
    ) {
        return;
    }

    const type =
        String(
            data.type || ""
        );

    switch (type) {
        case "hello":
            handleHello(
                client,
                data
            );
            break;

        case "list_rooms":
        case "rooms":
            handleListRooms(
                client
            );
            break;

        case "create_room":
        case "room_create":
            handleCreateRoom(
                client,
                data
            );
            break;

        case "join_room":
        case "room_join":
            handleJoinRoom(
                client,
                data
            );
            break;

        case "leave_room":
        case "room_leave":
            handleLeaveRoom(
                client
            );
            break;

        case "state":
        case "player_state":
            handleState(
                client,
                data
            );
            break;

        case "ping":
            handlePing(
                client
            );
            break;

        case "heartbeat":
            handlePing(
                client
            );
            break;

        default:
            safeSend(
                client.ws,
                {
                    type:
                        "error",

                    message:
                        "Unknown message type: " +
                        type,

                    error:
                        "UNKNOWN_MESSAGE"
                }
            );

            break;
    }
}

const server =
    http.createServer(
        (req, res) => {
            res.statusCode = 200;

            res.setHeader(
                "Access-Control-Allow-Origin",
                "*"
            );

            res.setHeader(
                "Access-Control-Allow-Headers",
                "*"
            );

            res.setHeader(
                "Content-Type",
                "application/json; charset=utf-8"
            );

            if (
                req.url ===
                "/health"
            ) {
                res.end(
                    JSON.stringify({
                        name:
                            "Connections Multiplayer Server",

                        status:
                            "online",

                        rooms:
                            rooms.size,

                        players:
                            clients.size,

                        uptime:
                            process.uptime()
                    })
                );

                return;
            }

            res.end(
                JSON.stringify({
                    name:
                        "Connections Multiplayer Server",

                    status:
                        "online",

                    rooms:
                        rooms.size,

                    players:
                        clients.size
                })
            );
        }
    );

const wss =
    new WebSocket.Server({
        server
    });

wss.on(
    "connection",
    ws => {
        const id =
            makeClientId();

        const client = {
            id,

            ws,

            name:
                "Player",

            room:
                null,

            avatar:
                null,

            state: {
                x: 0,
                y: 0,
                z: 0,

                yaw: 0,
                pitch: 0,

                alive: true,

                team: "CT",

                name:
                    "Player",

                avatar:
                    null
            },

            lastStateAt:
                Date.now(),

            connectedAt:
                Date.now()
        };

        clients.set(
            id,
            client
        );

        log(
            "Client connected:",
            id
        );

        safeSend(
            ws,
            {
                type:
                    "connected",

                id,

                clientId:
                    id,

                playerId:
                    id
            }
        );

        sendRooms(
            ws
        );

        ws.on(
            "message",
            raw => {
                try {
                    handleMessage(
                        client,
                        raw
                    );
                } catch (e) {
                    console.error(
                        "[Connections] Message handler error:",
                        e
                    );

                    safeSend(
                        ws,
                        {
                            type:
                                "error",

                            message:
                                "Internal server error.",

                            error:
                                "INTERNAL_ERROR"
                        }
                    );
                }
            }
        );

        ws.on(
            "close",
            () => {
                log(
                    "Client disconnected:",
                    client.id,
                    client.name
                );

                leaveCurrentRoom(
                    client,
                    false
                );

                clients.delete(
                    client.id
                );

                sendRoomsToAll();
            }
        );

        ws.on(
            "error",
            error => {
                warn(
                    "WebSocket error:",
                    client.id,
                    error.message
                );
            }
        );
    }
);

const heartbeat =
    setInterval(
        () => {
            for (
                const client of
                clients.values()
            ) {
                if (
                    client.ws.readyState !==
                    WebSocket.OPEN
                ) {
                    continue;
                }

                try {
                    client.ws.ping();
                } catch {}
            }
        },
        30000
    );

heartbeat.unref();

server.listen(
    PORT,
    HOST,
    () => {
        log(
            "HTTP server:",
            `http://${HOST}:${PORT}`
        );

        log(
            "WebSocket:",
            `ws://${HOST}:${PORT}`
        );

        log(
            "Rooms:",
            rooms.size
        );

        log(
            "Players:",
            clients.size
        );

        log(
            "ONLINE"
        );
    }
);

process.on(
    "SIGINT",
    () => {
        log(
            "Shutting down..."
        );

        for (
            const client of
            clients.values()
        ) {
            try {
                client.ws.close(
                    1001,
                    "Server shutting down"
                );
            } catch {}
        }

        wss.close(
            () => {
                server.close(
                    () => {
                        process.exit(
                            0
                        );
                    }
                );
            }
        );
    }
);

process.on(
    "uncaughtException",
    error => {
        console.error(
            "[Connections] Uncaught exception:",
            error
        );
    }
);

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "[Connections] Unhandled rejection:",
            error
        );
    }
);
