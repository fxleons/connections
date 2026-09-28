"use strict";

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "rafit_players.json");

const MIN_RTP = 250;
const START_RTP = 1000;
const PRO_RTP = 2000;
const BAN_DAYS = 7;

let players = {};

function load() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      players = {};
      save();
      return;
    }

    const raw = fs.readFileSync(DATA_FILE, "utf8");
    players = JSON.parse(raw);

    if (!players || typeof players !== "object") {
      players = {};
    }
  } catch (e) {
    console.error("[RAFIT] Failed to load database:", e);
    players = {};
  }
}

function save() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(players, null, 2),
      "utf8"
    );
  } catch (e) {
    console.error("[RAFIT] Failed to save database:", e);
  }
}

load();

function now() {
  return Date.now();
}

function getPlayer(id, name) {
  id = String(id);

  if (!players[id]) {
    players[id] = {
      id,
      name: String(name || "Player"),
      rtp: START_RTP,
      strikes: 0,
      confirmedViolations: 0,
      bannedUntil: 0,
      createdAt: now(),
      updatedAt: now()
    };

    save();
  }

  players[id].name = String(name || players[id].name || "Player");
  players[id].updatedAt = now();

  return players[id];
}

function isBanned(id) {
  const p = players[String(id)];

  if (!p) return false;

  if (p.bannedUntil && p.bannedUntil > now()) {
    return true;
  }

  if (p.bannedUntil && p.bannedUntil <= now()) {
    p.bannedUntil = 0;
    save();
  }

  return false;
}

function getBanRemaining(id) {
  const p = players[String(id)];

  if (!p || !p.bannedUntil) {
    return 0;
  }

  return Math.max(0, p.bannedUntil - now());
}

function getRtp(id) {
  const p = players[String(id)];
  return p ? p.rtp : START_RTP;
}

function getProfile(id, name) {
  const p = getPlayer(id, name);

  return {
    id: p.id,
    name: p.name,
    rtp: p.rtp,
    strikes: p.strikes,
    confirmedViolations: p.confirmedViolations,
    banned: isBanned(id),
    bannedUntil: p.bannedUntil || 0
  };
}

function penalize(id, amount, reason) {
  const p = players[String(id)];

  if (!p) {
    return null;
  }

  amount = Math.max(1, Number(amount) || 0);

  p.rtp -= amount;
  p.strikes++;
  p.confirmedViolations++;
  p.updatedAt = now();

  let banned = false;

  if (p.rtp < MIN_RTP) {
    p.rtp = MIN_RTP;

    p.bannedUntil =
      now() +
      BAN_DAYS * 24 * 60 * 60 * 1000;

    banned = true;
  }

  save();

  console.warn(
    "[RAFIT] PENALTY",
    p.name,
    "-",
    amount,
    "RTP",
    "reason:",
    reason,
    "new RTP:",
    p.rtp,
    banned ? "BANNED" : ""
  );

  return {
    rtp: p.rtp,
    banned,
    bannedUntil: p.bannedUntil || 0,
    reason
  };
}

function canJoinRoom(id, professional) {
  if (isBanned(id)) {
    return {
      allowed: false,
      reason: "RAFIT_BANNED",
      bannedUntil: getBanRemaining(id)
    };
  }

  const rtp = getRtp(id);

  if (professional && rtp < PRO_RTP) {
    return {
      allowed: false,
      reason: "RAFIT_2000_REQUIRED",
      rtp
    };
  }

  return {
    allowed: true,
    rtp
  };
}

function flag(id, type, data) {
  const p = players[String(id)];

  if (!p) return null;

  const allowed = [
    "bhop",
    "bunnyhop",
    "bunny_hop",
    "strafe",
    "air_strafe",
    "normal_jump"
  ];

  if (allowed.includes(String(type).toLowerCase())) {
    return {
      ignored: true,
      reason: "movement_exempt"
    };
  }

  console.warn(
    "[RAFIT] suspicious event:",
    p.name,
    type,
    data || {}
  );

  return {
    ignored: false,
    type,
    data: data || {}
  };
}

function inspectMovement(id, sample) {
  const p = players[String(id)];

  if (!p || !sample) {
    return {
      suspicious: false
    };
  }

  const dx = Number(sample.x) - Number(sample.lastX);
  const dy = Number(sample.y) - Number(sample.lastY);
  const dz = Number(sample.z) - Number(sample.lastZ);

  const dt = Math.max(
    0.001,
    Number(sample.dt) || 0.05
  );

  const horizontal =
    Math.sqrt(dx * dx + dz * dz) / dt;

  const vertical =
    Math.abs(dy) / dt;

  const teleportDistance = 75;

  if (
    Number.isFinite(horizontal) &&
    Number.isFinite(vertical) &&
    Math.sqrt(dx * dx + dy * dy + dz * dz) >
      teleportDistance
  ) {
    return {
      suspicious: true,
      type: "teleport",
      severity: "high",
      horizontal,
      vertical
    };
  }

  return {
    suspicious: false,
    horizontal,
    vertical
  };
}

module.exports = {
  MIN_RTP,
  START_RTP,
  PRO_RTP,
  BAN_DAYS,
  getPlayer,
  getProfile,
  getRtp,
  isBanned,
  getBanRemaining,
  penalize,
  canJoinRoom,
  flag,
  inspectMovement
};
