// ==UserScript==
// @name         Connections
// @namespace    conn
// @version      1.0.0
// @description  updated it alot bro
// @match        *://clutcher.io/*
// @match        *://*.clutcher.io/*
// @grant        unsafeWindow
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const W = unsafeWindow || window;

  // --- CONFIGURATION ---
  const CONFIG = {
    name: "Connections",
    theme: {
      primary: '#7289da',
      bg: 'rgba(15, 15, 15, 0.95)',
      text: '#e0e0e0',
      border: '1px solid rgba(114, 137, 218, 0.3)'
    },
    tabs: ["Servers", "Playermodel", "Avatar", "Settings"],
    models: [
        { name: "Tung Tung Sahur", url: "LINK_1" },
        { name: "Spy (TF2)", url: "LINK_2" }
    ]
  };

  // --- GLOBAL STATE ---
  const State = {
    engine: null,
    isLocked: true,
    isVisible: false,
    activeTab: "Servers",
    remotes: new Map(),
    isSyncing: false,
    // ... other state
  };

  const log = (...a) => console.log(`%c[Connections]`, "color: #7289da; font-weight: bold;", ...a);
  const warn = (...a) => console.warn(`[Connections]`, ...a);

  // --- 1. THE ENGINE HUNTER (Robust Version) ---
  async function findEngine() {
    log("Searching for Engine...");
    const candidates = ['app', 'engine', 'game', 'scene', 'renderer', 'world', 'clutcher'];
    
    while (true) {
      for (const cand of candidates) {
        if (W[cand] && typeof W[cand] === 'object') {
          W.connections_engine = W[cand];
          break;
        }
      }

      if (W.connections_engine) {
        log("ENGINE DETECTED!", "color: #00ff00;");
        return W.connections_engine;
      }

      // Deep Scan
      const keys = Object.keys(W);
      for (const key of keys) {
        try {
          const obj = W[key];
          if (obj && typeof obj === 'object' && (obj.isScene || obj.renderer || obj.player)) {
            W.connections_engine = obj;
            break;
          }
        } catch (e) {}
        if (W.connections_engine) break;
      }

      if (W.connections_engine) break;
      await new Promise(res => setTimeout(res, 1500));
    }
    return W.connections_engine;
  }

  // --- 2. THE SPAWNER (The Fixed version) ---
  async function spawnRemote(remote) {
    const engine = W.connections_engine;
    if (!engine) {
        console.error("[Connections] Engine missing!");
        return;
    }

    // Get THREE from engine or window
    const THREE = engine.THREE || W.THREE;
    if (!THREE) {
        console.error("[Connections] THREE.js library not found!");
        return;
    }

    const scene = engine.scene || engine.renderer?.scene || engine.world?.scene;
    if (!scene) {
        console.error("[Connections] Scene not found!");
        return;
    }

    log(`Spawning ${remote.name}...`);

    try {
      // Create Group
      const playerGroup = new THREE.Group();
      
      // Placeholder Mesh
      const geometry = new THREE.SphereGeometry(0.5, 16, 16);
      const material = new THREE.MeshBasicMaterial({ 
        color: remote.team === 'ct' ? 0x00ff00 : 0xff0000,
        wireframe: true 
      });
      const placeholderMesh = new THREE.Mesh(geometry, material);
      playerGroup.add(placeholderMesh);

      // Set metadata
      playerGroup.userData = {
        id: remote.id,
        name: remote.name,
        team: remote.team,
        targetX: remote.targetX || 0,
        targetY: remote.targetY || 0,
        targetZ: remote.targetZ || 0,
        targetYaw: remote.targetYaw || 0,
        targetPitch: remote.targetPitch || 0
      };

      // Set initial position
      playerGroup.position.set(remote.x, remote.y, remote.z);

      // Add to Scene
      scene.add(playerGroup);

      // Register
      W.connections_remote_players = W.connections_remote_players || {};
      W.connections_remote_players[remote.id] = playerGroup;

      log(`SUCCESS: ${remote.name} spawned!`, "color: #00ff00;");
      
      if (!W.connections_syncing) startSyncLoop();

    } catch (e) {
      console.error("[Connections] Spawn failed:", e);
    }
  }

  // --- 3. THE SYNC LOOP (Interpolation) ---
  function startSyncLoop() {
    W.connections_syncing = true;
    const loop = () => {
      if (W.connections_remote_players) {
        const players = W.connections_remote_players;
        for (const id in players) {
          const playerGroup = players[id];
          if (playerGroup && playerGroup.userData) {
            const data = playerGroup.userData;
            const lerp = 0.15; 
            playerGroup.position.x += (data.targetX - playerGroup.position.x) * lerp;
            playerGroup.position.y += (data.targetY - playerGroup.position.y) * lerp;
            playerGroup.position.z += (data.targetZ - playerGroup.position.z) * lerp;

            if (data.targetYaw !== undefined) playerGroup.rotation.y = data.targetYaw;
            if (data.targetPitch !== undefined) playerGroup.rotation.x = data.targetPitch;
          }
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // --- 4. UI ENGINE (The Shell) ---
  class ConnectionsUI {
    constructor() {
      this.container = null;
      this.header = null;
      this.content = null;
      this.init();
    }

    init() {
      this.container = document.createElement('div');
      Object.assign(this.container.style, {
        position: 'fixed', top: '150px', left: '50px', width: '300px', height: '400px',
        backgroundColor: CONFIG.theme.bg, border: CONFIG.theme.border, borderRadius: '6px',
        zIndex: '10000', display: 'none', flexDirection: 'column', boxShadow: '0 15px 40px rgba(0,0,0,0.8)',
        fontFamily: 'sans-serif', color: CONFIG.theme.text, userSelect: 'none'
      });

      this.header = document.createElement('div');
      this.header.innerText = CONFIG.name.toUpperCase();
      Object.assign(this.header.style, {
        padding: '12px', background: 'rgba(114, 137, 218, 0.1)', cursor: 'grab',
        fontSize: '12px', fontWeight: 'bold', textAlign: 'center', borderBottom: CONFIG.theme.border
      });

      this.content = document.createElement('div');
      Object.assign(this.content.style, { flex: '1', padding: '15px', overflowY: 'auto', fontSize: '13px' });

      this.container.appendChild(this.header);
      this.container.appendChild(this.content);
      document.body.appendChild(this.container);

      this.setupEventListeners();
    }

    setupEventListeners() {
      this.header.onmousedown = (e) => {
        this.isDragging = true;
        this.dragOffset = { x: e.clientX - this.container.offsetLeft, y: e.clientY - this.container.offsetTop };
      };

      window.onmousemove = (e) => {
        if (!this.isDragging) return;
        this.container.style.left = `${e.clientX - this.dragOffset.x}px`;
        this.container.style.top = `${e.clientY - this.dragOffset.y}px`;
      };

      window.onmouseup = () => { this.isDragging = false; };
    }

    toggle() {
      this.isVisible = !this.isVisible;
      this.container.style.display = this.isVisible ? 'flex' : 'none';
      if (this.isVisible) this.renderLockScreen();
    }

    renderLockScreen() {
      this.content.innerHTML = `
        <div id="lock-screen" style="text-align: center; margin-top: 20px;">
          <p style="color: #ff4444; font-weight: bold;">Make sure you are in a match to CONFIRM.</p>
          <button id="conn-scan-btn" style="width: 100%; padding: 10px; background: #7289da; border: none; color: white; cursor: pointer; border-radius: 4px;">
            START SCANNING
          </button>
          <p id="conn-scan-status" style="font-size: 10px; margin-top: 10px; opacity: 0.6;">Status: Idle</p>
        </div>
      `;
      document.getElementById('conn-scan-btn').onclick = () => this.startScan();
    }

    async startScan() {
      const status = document.getElementById('conn-status-text') || document.getElementById('conn-scan-status');
      status.innerText = "Scanning...";
      
      await findEngine();
      
      if (W.connections_engine) {
        this.renderTabs();
      } else {
        status.innerText = "Error. Try again.";
      }
    }

    renderTabs() {
      this.content.innerHTML = `
        <div class="conn-tabs" style="display: flex; gap: 5px; margin-bottom: 15px;">
          ${CONFIG.tabs.map(t => `<button class="conn-tab-btn" data-tab="${t}">${t}</button>`).join('')}
        </div>
        <div id="tab-content">
          <p>Module ready. Select a tab.</p>
        </div>
      `;
      
      // Tab switching logic
      this.content.addEventListener('click', (e) => {
        if (e.target.classList.contains('conn-tab-btn')) {
          this.switchTab(e.target.dataset.tab);
        }
      }, true);
    }

    switchTab(tabName) {
      this.content.innerHTML = `<p style="color: #7289da;">${tabName} Module Loading...</p>`;
      setTimeout(() => {
        this.content.innerHTML = `<p>${tabName} is coming in Sprint 2!</p>`;
      }, 500);
    }
  }

  // --- 4. INITIALIZATION ---
  async function init() {
    // 1. Search Engine
    await findEngine();

    // 2. Setup Globals
    W.spawnRemotePlayer = spawnRemote;
    W.connections_remote_players = W.connections_remote_players || {};

    // 3. Setup UI
    window.menu = new ConnectionsUI();

    // 4. Listen for Backspace
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        window.menu.toggle();
      }
    }, true);

    console.log("%c[Connections] MASTER CORE READY.", "color: #00ff00; font-weight: bold;");
  }

  init();

})();
