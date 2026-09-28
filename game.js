/*
 * HaRUNbe — browser front end: assets, input, game loop, rendering, UI, records, PWA.
 * Game rules and physics live in engine.js.
 */
(function () {
    'use strict';

    const E = window.HarunbeEngine;
    const { CONFIG, SPRITES, clamp, lerp } = E;
    const GROUND_Y = CONFIG.GROUND_Y;
    const SKINS = window.HarunbeSkins;

    // =====================================================================
    // DOM
    // =====================================================================

    const $ = (id) => document.getElementById(id);
    const dom = {
        screens: { menu: $('menu-screen'), records: $('records-screen'), skins: $('skins-screen'), game: $('game-screen') },
        canvas: $('game-canvas'),
        startBtn: $('start-btn'),
        recordsBtn: $('records-btn'),
        recordsBackBtn: $('records-back-btn'),
        skinsBtn: $('skins-btn'),
        skinsBtnWallet: $('skins-btn-wallet'),
        skinsBackBtn: $('skins-back-btn'),
        skinsWallet: $('skins-wallet'),
        skinsGrid: $('skins-grid'),
        resWallet: $('res-wallet'),
        resUnlocks: $('res-unlocks'),
        menuBest: $('menu-best'),
        version: $('version-text'),
        updateBanner: $('update-banner'),
        updateBtn: $('update-btn'),
        hudBananas: $('hud-bananas'),
        hudDistance: $('hud-distance'),
        pauseBtn: $('pause-btn'),
        pauseOverlay: $('pause-overlay'),
        resumeBtn: $('resume-btn'),
        pauseMenuBtn: $('pause-menu-btn'),
        countdown: $('countdown'),
        countdownText: $('countdown-text'),
        results: $('results-overlay'),
        resDistance: $('res-distance'),
        resBananas: $('res-bananas'),
        resBestDistance: $('res-best-distance'),
        resMostBananas: $('res-most-bananas'),
        resDistanceBadge: $('res-distance-badge'),
        resBananasBadge: $('res-bananas-badge'),
        entry: $('leaderboard-entry'),
        entryText: $('entry-text'),
        nameInput: $('name-input'),
        saveNameBtn: $('save-name-btn'),
        restartBtn: $('restart-btn'),
        resultsMenuBtn: $('results-menu-btn'),
        recBestDistance: $('rec-best-distance'),
        recMostBananas: $('rec-most-bananas'),
        recDistanceList: $('rec-distance-list'),
        recBananaList: $('rec-banana-list'),
        rotate: $('rotate-overlay'),
        rotateAnywayBtn: $('rotate-anyway-btn')
    };
    const ctx = dom.canvas.getContext('2d', { alpha: false });

    // =====================================================================
    // Assets
    // =====================================================================

    const ASSET_PATHS = {
        gorilla: 'Assets/Player/256x256DefaultGorilla.png',
        tiger: 'Assets/Enemies/256x256Tiger.png',
        hawk: 'Assets/Enemies/256x256Hawk.png',
        banana: 'Assets/Items/256x256Banana.png',
        sun: 'Assets/Scenery/256x256Sun.png',
        moon: 'Assets/Scenery/256x256Moon.png',
        cloudDay: 'Assets/Scenery/256x256DayCloud.png',
        cloudNight: 'Assets/Scenery/256x256NightCloud.png',
        skyDay: 'Assets/Scenery/ClearSky.jpg',
        skyNight: 'Assets/Scenery/StarryNight.jpg'
    };
    const img = {};
    let assetsReady = false;

    // A missing image never blocks the game; it is drawn with a simple fallback shape.
    function loadAssets() {
        const paths = Object.assign({}, ASSET_PATHS);
        for (const skin of SKINS) paths['skin:' + skin.image] = skin.image;
        return Promise.all(Object.keys(paths).map((key) => new Promise((resolve) => {
            const im = new Image();
            im.decoding = 'async';
            im.onload = () => { img[key] = im; resolve(); };
            im.onerror = () => { img[key] = null; resolve(); };
            im.src = paths[key];
        })));
    }

    // =====================================================================
    // Records (localStorage)
    // =====================================================================

    const Records = (function () {
        const KEY = 'harunbe.records.v2';
        const LEGACY_KEY = 'haRUNbeHighScores'; // v2.x: [{name, score}] where score = bananas
        const BOARD_SIZE = 5;
        let data = blank();

        function blank() {
            return { version: 2, bestDistance: 0, mostBananas: 0, distanceBoard: [], bananaBoard: [], lastName: '' };
        }

        function read(key) {
            try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
        }

        function cleanBoard(list) {
            if (!Array.isArray(list)) return [];
            return list
                .filter((e) => e && Number.isFinite(Number(e.value)) && Number(e.value) > 0)
                .map((e) => ({ name: String(e.name || 'Harunbe').slice(0, 12), value: Math.floor(Number(e.value)), date: e.date || null }))
                .sort((a, b) => b.value - a.value)
                .slice(0, BOARD_SIZE);
        }

        function load() {
            const stored = read(KEY);
            data = blank();
            if (stored && typeof stored === 'object') {
                data.distanceBoard = cleanBoard(stored.distanceBoard);
                data.bananaBoard = cleanBoard(stored.bananaBoard);
                data.bestDistance = Math.max(0, Math.floor(Number(stored.bestDistance) || 0));
                data.mostBananas = Math.max(0, Math.floor(Number(stored.mostBananas) || 0));
                data.lastName = typeof stored.lastName === 'string' ? stored.lastName.slice(0, 12) : '';
            } else {
                // Migrate the old single "score" list. Its score counted bananas, so it
                // becomes the banana leaderboard; the old key is left untouched.
                const legacy = read(LEGACY_KEY);
                if (Array.isArray(legacy)) {
                    data.bananaBoard = cleanBoard(legacy.map((e) => ({ name: e && e.name, value: e && e.score })));
                    if (data.bananaBoard.length) save();
                }
            }
            // Records are never lower than the best leaderboard entry.
            if (data.distanceBoard[0]) data.bestDistance = Math.max(data.bestDistance, data.distanceBoard[0].value);
            if (data.bananaBoard[0]) data.mostBananas = Math.max(data.mostBananas, data.bananaBoard[0].value);
        }

        function save() {
            try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage full or blocked */ }
        }

        function qualifies(board, value) {
            return value > 0 && (board.length < BOARD_SIZE || value > board[board.length - 1].value);
        }

        // Called once per finished run. Updates records immediately and reports what happened.
        function finishRun(distance, bananas) {
            const result = {
                distance, bananas,
                newDistance: distance > data.bestDistance,
                newBananas: bananas > data.mostBananas,
                boardDistance: qualifies(data.distanceBoard, distance),
                boardBananas: qualifies(data.bananaBoard, bananas),
                committed: false
            };
            if (result.newDistance) data.bestDistance = distance;
            if (result.newBananas) data.mostBananas = bananas;
            save();
            return result;
        }

        function insert(board, name, value) {
            const date = new Date().toISOString().slice(0, 10);
            board.push({ name, value, date });
            board.sort((a, b) => b.value - a.value);
            board.length = Math.min(board.length, BOARD_SIZE);
        }

        function commitEntry(result, rawName) {
            if (!result || result.committed) return;
            result.committed = true;
            if (!result.boardDistance && !result.boardBananas) return;
            const name = (rawName || '').trim().slice(0, 12) || 'Harunbe';
            if (result.boardDistance) insert(data.distanceBoard, name, result.distance);
            if (result.boardBananas) insert(data.bananaBoard, name, result.bananas);
            data.lastName = name;
            save();
        }

        return { load, finishRun, commitEntry, get data() { return data; } };
    })();

    // =====================================================================
    // Progress: banked bananas, lifetime distance, owned skins (localStorage)
    // =====================================================================

    const Progress = (function () {
        const KEY = 'harunbe.progress.v1';
        let data = blank();

        function blank() {
            return { version: 1, bananas: 0, totalMeters: 0, owned: [], selected: SKINS[0].id };
        }

        function count(v) { return Math.max(0, Math.floor(Number(v) || 0)); }

        function load() {
            let stored = null;
            try { stored = JSON.parse(localStorage.getItem(KEY)); } catch { stored = null; }
            data = blank();
            if (stored && typeof stored === 'object') {
                data.bananas = count(stored.bananas);
                data.totalMeters = count(stored.totalMeters);
                if (Array.isArray(stored.owned)) data.owned = stored.owned.filter((id) => typeof id === 'string');
                if (typeof stored.selected === 'string') data.selected = stored.selected;
            }
            if (!owns(skinById(data.selected))) data.selected = SKINS[0].id;
        }

        function save() {
            try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage full or blocked */ }
        }

        function owns(skin) { return !!skin && (skin.price === 0 || data.owned.includes(skin.id)); }

        // The distance goals a skin needs before it can be bought.
        function requirementsMet(skin) {
            return (!skin.bestRun || Records.data.bestDistance >= skin.bestRun) &&
                (!skin.totalRun || data.totalMeters >= skin.totalRun);
        }

        function canBuy(skin) {
            return !owns(skin) && requirementsMet(skin) && data.bananas >= skin.price;
        }

        function buy(skin) {
            if (!canBuy(skin)) return false;
            data.bananas -= skin.price;
            data.owned.push(skin.id);
            data.selected = skin.id;
            save();
            return true;
        }

        function select(skin) {
            if (!owns(skin)) return;
            data.selected = skin.id;
            save();
        }

        function bank(meters, bananas) {
            data.bananas += count(bananas);
            data.totalMeters += count(meters);
            save();
        }

        return { load, owns, requirementsMet, canBuy, buy, select, bank, get data() { return data; } };
    })();

    function skinById(id) {
        for (const skin of SKINS) if (skin.id === id) return skin;
        return null;
    }

    // =====================================================================
    // Skin sprites (recoloured once, then cached)
    // =====================================================================

    const skinSprites = {};

    function skinSprite(skin) {
        if (!skin) skin = SKINS[0];
        if (skin.id in skinSprites) return skinSprites[skin.id];
        const base = img['skin:' + skin.image] || img.gorilla;
        if (!assetsReady) return base; // don't cache before the images have loaded
        let sprite = base;
        if (base && skin.recolor) {
            try { sprite = recolor(base, skin.recolor); } catch { sprite = base; } // e.g. file:// pages
        }
        skinSprites[skin.id] = sprite;
        return sprite;
    }

    function hexRgb(hex) {
        const n = parseInt(String(hex).replace('#', ''), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    // Repaint the dark fur and the brightly coloured parts (face, hands, feet) with new colours,
    // keeping the artwork's shading. The near-black outline is left alone.
    function recolor(image, spec) {
        const w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const g = canvas.getContext('2d');
        g.drawImage(image, 0, 0, w, h);
        const pixels = g.getImageData(0, 0, w, h);
        const px = pixels.data;
        const targets = [spec.fur ? hexRgb(spec.fur) : null, spec.skin ? hexRgb(spec.skin) : null];

        // Per pixel: region weight (0 = fur, 1 = skin), outline weight, brightness.
        const info = (i) => {
            const r = px[i], gr = px[i + 1], b = px[i + 2];
            const max = Math.max(r, gr, b), min = Math.min(r, gr, b);
            const sat = max ? (max - min) / max : 0;
            const lum = 0.299 * r + 0.587 * gr + 0.114 * b;
            return { lum, skin: smoothstep(0.2, 0.4, sat), paint: smoothstep(26, 50, lum) };
        };

        // Average brightness of each region, so shading is mapped around the new colour.
        const sum = [0, 0], weight = [0, 0];
        for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] < 200) continue;
            const p = info(i);
            const wf = (1 - p.skin) * p.paint, ws = p.skin * p.paint;
            sum[0] += p.lum * wf; weight[0] += wf;
            sum[1] += p.lum * ws; weight[1] += ws;
        }
        const ref = [sum[0] / (weight[0] || 1) || 1, sum[1] / (weight[1] || 1) || 1];

        for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] === 0) continue;
            const p = info(i);
            for (let region = 0; region < 2; region++) {
                const t = targets[region];
                if (!t) continue;
                const amount = (region ? p.skin : 1 - p.skin) * p.paint;
                if (amount <= 0) continue;
                const shade = p.lum / ref[region];
                for (let c = 0; c < 3; c++) {
                    const v = shade <= 1 ? t[c] * shade : t[c] + (255 - t[c]) * Math.min(1, (shade - 1) * 0.8);
                    px[i + c] = lerp(px[i + c], v, amount);
                }
            }
        }
        g.putImageData(pixels, 0, 0);
        return canvas;
    }

    // =====================================================================
    // View / canvas sizing
    // =====================================================================

    // The world is drawn in world units. The 540-unit gameplay band always fits the screen;
    // wider screens see further ahead, taller (portrait) screens get more sky and ground.
    const view = { cssW: 0, cssH: 0, dpr: 1, scale: 1, k: 1, w: CONFIG.MIN_VIEW_W, h: CONFIG.WORLD_H, top: 0 };
    let duskGradient = null;
    let needsRender = true;

    function resize() {
        const cssW = Math.max(1, window.innerWidth);
        const cssH = Math.max(1, window.innerHeight);
        let dpr = Math.min(window.devicePixelRatio || 1, 2);
        const maxPixels = 4000000; // keep the backing store reasonable on large/high-DPI screens
        if (cssW * cssH * dpr * dpr > maxPixels) dpr = Math.sqrt(maxPixels / (cssW * cssH));

        view.cssW = cssW;
        view.cssH = cssH;
        view.dpr = dpr;
        view.scale = Math.min(cssH / CONFIG.WORLD_H, cssW / CONFIG.MIN_VIEW_W);
        view.w = cssW / view.scale;
        view.h = cssH / view.scale;
        view.top = -(view.h - CONFIG.WORLD_H) * 0.7;
        view.k = view.scale * dpr;

        const bw = Math.round(cssW * dpr), bh = Math.round(cssH * dpr);
        if (dom.canvas.width !== bw || dom.canvas.height !== bh) {
            dom.canvas.width = bw;
            dom.canvas.height = bh;
        }
        duskGradient = null;
        needsRender = true;
        updateOrientationUI();
        if (loopRunning()) return;
        if (run.state !== 'menu') requestLoop();
    }

    // =====================================================================
    // Run state
    // =====================================================================

    // States: menu | playing | paused | countdown | dying | gameover
    const run = {
        state: 'menu',
        trackPos: 0, prevTrackPos: 0,
        distance: 0,          // world units travelled while actually playing
        speed: CONFIG.speed.start,
        bananas: 0,
        player: E.createPlayer(),
        prevAlt: 0,
        entities: [],
        gen: null,
        cycleTime: 0,
        clock: 0,             // cosmetic animation time (advances only when the world moves)
        dieTime: 0,
        countdown: 0,
        pauseReason: '',
        result: null,
        banked: true          // this run's bananas/distance were added to Progress
    };

    const clouds = [];
    const popups = []; // "+1" banana pop-ups, reused
    for (let i = 0; i < 8; i++) popups.push({ life: 0, x: 0, y: 0 });

    function resetRun() {
        run.trackPos = run.prevTrackPos = 0;
        run.distance = 0;
        run.speed = CONFIG.speed.start;
        run.bananas = 0;
        run.player = E.createPlayer();
        run.prevAlt = 0;
        run.entities.length = 0;
        run.gen = E.createGenerator();
        E.generateUntil(run.gen, view.w + CONFIG.aheadUnits, run.entities);
        run.cycleTime = 0;
        run.clock = 0;
        run.dieTime = 0;
        run.result = null;
        run.banked = false;
        run.pauseReason = '';
        for (const p of popups) p.life = 0;
        resetClouds();
        input.reset();
        hud.last.bananas = hud.last.meters = -1;
        updateHud();
    }

    function resetClouds() {
        clouds.length = 0;
        for (let i = 0; i < 5; i++) {
            clouds.push({
                x: (i + Math.random() * 0.6) * (view.w / 5),
                y: cloudY(),
                size: 110 + Math.random() * 70,
                drift: 4 + Math.random() * 6
            });
        }
    }

    // Clouds stay in the upper sky; portrait screens have more of it.
    function cloudY() { return view.top + 30 + Math.random() * (150 - view.top * 0.8); }

    function meters() { return Math.floor(run.distance / CONFIG.UNITS_PER_METER); }

    // =====================================================================
    // Input
    // =====================================================================

    const JUMP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW']);
    const input = {
        keys: new Set(),
        pointers: new Set(),
        get held() { return this.keys.size > 0 || this.pointers.size > 0; },
        reset() { this.keys.clear(); this.pointers.clear(); }
    };

    function isTyping(target) {
        return target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
    }

    function press() {
        if (run.state === 'playing') E.pressJump(run.player);
    }

    function setupInput() {
        const area = dom.canvas;
        area.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            if (run.state !== 'playing') return;
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            try { area.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
            input.pointers.add(e.pointerId);
            press();
        });
        const release = (e) => { input.pointers.delete(e.pointerId); };
        area.addEventListener('pointerup', release);
        area.addEventListener('pointercancel', release);
        area.addEventListener('lostpointercapture', release);
        window.addEventListener('pointerup', release);

        // Block long-press menus, double-tap zoom and scrolling on the game screen.
        dom.screens.game.addEventListener('contextmenu', (e) => e.preventDefault());
        area.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
        area.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

        window.addEventListener('keydown', (e) => {
            if (isTyping(e.target)) {
                if (e.key === 'Enter' && e.target === dom.nameInput) saveName();
                return;
            }
            const inGame = run.state !== 'menu';
            if (JUMP_KEYS.has(e.code)) {
                if (!inGame) return;                   // menus keep normal keyboard behaviour
                e.preventDefault();                   // no page scroll / button activation
                if (e.repeat || run.state !== 'playing') return;
                input.keys.add(e.code);
                press();
            } else if (e.code === 'KeyP' || e.code === 'Escape') {
                if (!inGame || e.repeat) return;
                e.preventDefault();
                togglePause();
            } else if (e.code === 'Enter' && run.state === 'paused') {
                e.preventDefault();
                resume();
            }
        });
        window.addEventListener('keyup', (e) => { input.keys.delete(e.code); });

        // Lost focus / backgrounded: drop held input and pause so returning is never fatal.
        window.addEventListener('blur', () => { input.reset(); pauseFor('blur'); });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { input.reset(); pauseFor('hidden'); }
        });
        window.addEventListener('pagehide', () => { input.reset(); pauseFor('hidden'); });
    }

    // =====================================================================
    // Game loop (fixed-step simulation, interpolated rendering)
    // =====================================================================

    let rafId = 0;
    let lastTime = -1;
    let accumulator = 0;

    function loopRunning() { return rafId !== 0; }

    function requestLoop() {
        if (rafId) return;
        lastTime = -1;
        rafId = requestAnimationFrame(frame);
    }

    function stopLoop() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
    }

    function frame(now) {
        rafId = requestAnimationFrame(frame);
        let dt = lastTime < 0 ? 0 : (now - lastTime) / 1000;
        lastTime = now;
        if (!(dt > 0) || dt > 0.25) dt = 0;          // stalled (tab switch, debugger): skip
        else if (dt > CONFIG.MAX_FRAME) dt = CONFIG.MAX_FRAME;

        const STEP = CONFIG.STEP;
        let alpha = 1;
        switch (run.state) {
            case 'playing':
            case 'dying':
                accumulator += dt;
                while (accumulator >= STEP) {
                    accumulator -= STEP;
                    if (run.state === 'playing') stepPlaying(STEP);
                    else if (run.state === 'dying') stepDying(STEP);
                    else { accumulator = 0; break; }
                }
                alpha = accumulator / STEP;
                if (run.state === 'playing') {
                    // Keep the world generated ahead of the view (at most one cluster per frame).
                    if (run.gen.cursor < run.trackPos + view.w + CONFIG.aheadUnits) {
                        E.generateSegment(run.gen, run.entities);
                    }
                    cullEntities();
                    updateHud();
                }
                needsRender = true;
                break;
            case 'countdown':
                run.countdown -= dt;
                if (run.countdown <= 0) {
                    beginPlaying();
                } else {
                    const n = String(Math.ceil(run.countdown / COUNTDOWN_TICK));
                    if (dom.countdownText.textContent !== n) dom.countdownText.textContent = n;
                }
                break;
            default:
                break;
        }

        if (needsRender) {
            render(alpha);
            needsRender = false;
        }
        if (run.state === 'paused' || run.state === 'gameover' || run.state === 'menu') stopLoop();
    }

    function stepPlaying(dt) {
        run.prevTrackPos = run.trackPos;
        run.prevAlt = run.player.alt;

        const s = E.speedFor(run.distance);
        run.speed = s;
        run.trackPos += s * dt;
        run.distance += s * dt;
        run.cycleTime += dt;
        run.clock += dt;
        E.stepPlayer(run.player, input.held, dt);
        updateClouds(dt, s);
        updatePopups(dt);
        checkCollisions();
    }

    const DIE_DURATION = 1.5;

    function stepDying(dt) {
        run.prevTrackPos = run.trackPos;
        run.prevAlt = run.player.alt;
        run.dieTime += dt;
        const slow = Math.max(0, 1 - run.dieTime / 0.8);
        run.trackPos += run.speed * slow * slow * dt;   // world skids to a halt
        run.clock += dt * slow;
        E.stepPlayer(run.player, false, dt);           // gorilla drops to the ground
        updateClouds(dt * slow, run.speed);
        updatePopups(dt);
        if (run.dieTime >= DIE_DURATION) showResults();
    }

    const playerBox = E.makeBox();
    const collectBox = E.makeBox();

    function checkCollisions() {
        E.playerBox(run.player.alt, run.trackPos, playerBox);
        // Bananas are collected with a slightly larger box: generous pickups feel good.
        collectBox.x0 = playerBox.x0 - 6; collectBox.x1 = playerBox.x1 + 6;
        collectBox.y0 = playerBox.y0 - 6; collectBox.y1 = playerBox.y1 + 6;

        const list = run.entities;
        for (let i = 0; i < list.length; i++) {
            const e = list[i];
            if (e.collected || e.hit.x0 > collectBox.x1 || e.hit.x1 < collectBox.x0) continue;
            if (e.type === 'banana') {
                if (E.overlaps(collectBox, e.hit)) {
                    e.collected = true;
                    run.bananas++;
                    spawnPopup(e.x - run.trackPos + e.size / 2, e.top);
                }
            } else if (E.overlaps(playerBox, e.hit)) {
                die();
                return;
            }
        }
    }

    function cullEntities() {
        const list = run.entities;
        const limit = run.trackPos - CONFIG.cullUnits;
        let j = 0;
        for (let i = 0; i < list.length; i++) {
            const e = list[i];
            if (e.x + e.size >= limit && !e.collected) list[j++] = e;
        }
        list.length = j;
    }

    function updateClouds(dt, speed) {
        for (const c of clouds) {
            c.x -= (speed * 0.06 + c.drift) * dt;
            if (c.x + c.size < 0) {
                c.x = view.w + Math.random() * 200;
                c.y = cloudY();
                c.size = 110 + Math.random() * 70;
            }
        }
    }

    function spawnPopup(x, y) {
        let p = popups[0];
        for (const q of popups) if (q.life <= 0) { p = q; break; }
        p.life = 0.7; p.x = x; p.y = y;
    }

    function updatePopups(dt) {
        for (const p of popups) if (p.life > 0) { p.life -= dt; p.y -= 60 * dt; }
    }

    // =====================================================================
    // Day / night cycle
    // =====================================================================

    // phase 0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight.
    const sky = { phase: 0, night: 0, dusk: 0, sunElev: 0 };

    function updateSky() {
        const phase = (CONFIG.cycle.start + run.cycleTime / CONFIG.cycle.seconds) % 1;
        const elev = Math.sin(phase * Math.PI * 2);
        sky.phase = phase;
        sky.sunElev = elev;
        sky.night = smoothstep(0.25, -0.25, elev);
        sky.dusk = Math.exp(-(elev * elev) / (0.28 * 0.28));
    }

    function smoothstep(a, b, x) {
        const t = clamp((x - a) / (b - a), 0, 1);
        return t * t * (3 - 2 * t);
    }

    // Position on the sky arc for progress q (0 = rising at the left, 1 = setting at the right).
    function arcPosition(q, out) {
        const horizon = GROUND_Y - 105; // roughly the jungle skyline: sun and moon sink behind the trees
        const peak = Math.max(view.top + 80, 70);
        const qc = clamp(q, 0, 1);
        out.x = lerp(0.07, 0.93, q) * view.w;
        out.y = horizon - Math.sin(qc * Math.PI) * (horizon - peak) + Math.abs(q - qc) * 900;
        return out;
    }

    // =====================================================================
    // Rendering
    // =====================================================================

    const COLORS = {
        farDay: [86, 158, 92], farNight: [24, 44, 60], farDusk: [150, 110, 90],
        treeDay: [40, 112, 52], treeNight: [14, 32, 36], treeDusk: [90, 70, 60],
        nearDay: [34, 120, 48], nearNight: [12, 36, 30],
        grassDay: [70, 170, 80], grassNight: [26, 70, 52],
        soilDay: [96, 70, 42], soilNight: [36, 32, 48],
        tuftDay: [44, 130, 56], tuftNight: [18, 52, 40]
    };

    function mixColor(day, night, n, dusk, d) {
        let r = lerp(day[0], night[0], n), g = lerp(day[1], night[1], n), b = lerp(day[2], night[2], n);
        if (dusk && d > 0) { r = lerp(r, dusk[0], d); g = lerp(g, dusk[1], d); b = lerp(b, dusk[2], d); }
        return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
    }

    function hash(i) {
        const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
    }

    const tmpPos = { x: 0, y: 0 };

    function render(alpha) {
        const k = view.k;
        const trackPos = lerp(run.prevTrackPos, run.trackPos, alpha);
        const alt = lerp(run.prevAlt, run.player.alt, alpha);
        updateSky();

        ctx.setTransform(k, 0, 0, k, 0, -view.top * k);
        ctx.globalAlpha = 1;

        drawSky();
        drawCelestial();
        drawClouds();
        drawLandscape(trackPos);
        drawGround(trackPos);
        drawEntities(trackPos);
        drawPlayer(alt);
        drawPopups();
        if (run.state === 'dying' || run.state === 'gameover') drawWasted();
    }

    function drawCover(image, x, y, w, h) {
        const ir = image.width / image.height, r = w / h;
        let sw = image.width, sh = image.height, sx = 0, sy = 0;
        if (ir > r) { sw = sh * r; sx = (image.width - sw) / 2; } else { sh = sw / r; sy = image.height - sh; }
        ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
    }

    function drawSky() {
        const top = view.top, h = GROUND_Y - top + 4;
        if (img.skyDay) drawCover(img.skyDay, 0, top, view.w, h);
        else { ctx.fillStyle = '#4a90d9'; ctx.fillRect(0, top, view.w, h); }

        if (sky.night > 0.001) {
            ctx.globalAlpha = sky.night;
            if (img.skyNight) drawCover(img.skyNight, 0, top, view.w, h);
            else { ctx.fillStyle = '#0b1530'; ctx.fillRect(0, top, view.w, h); }
        }
        if (sky.dusk > 0.01) {
            if (!duskGradient) {
                duskGradient = ctx.createLinearGradient(0, GROUND_Y, 0, top);
                duskGradient.addColorStop(0, 'rgba(255,140,60,0.9)');
                duskGradient.addColorStop(0.35, 'rgba(250,95,110,0.45)');
                duskGradient.addColorStop(1, 'rgba(90,50,140,0)');
            }
            ctx.globalAlpha = sky.dusk * 0.85;
            ctx.fillStyle = duskGradient;
            ctx.fillRect(0, top, view.w, h);
        }
        ctx.globalAlpha = 1;
    }

    function drawCelestial() {
        const p = sky.phase;
        // Sun: phase 0..0.5 (slightly extended so it slides in/out behind the jungle).
        const qs = p < 0.75 ? p / 0.5 : (p - 1) / 0.5;
        if (qs > -0.12 && qs < 1.12) {
            arcPosition(qs, tmpPos);
            drawSprite(img.sun, tmpPos.x - 48, tmpPos.y - 48, 96, '#ffd54a');
        }
        // Moon: phase 0.5..1.
        const qm = p >= 0.25 ? (p - 0.5) / 0.5 : (p + 0.5) / 0.5;
        if (qm > -0.12 && qm < 1.12) {
            arcPosition(qm, tmpPos);
            drawSprite(img.moon, tmpPos.x - 44, tmpPos.y - 44, 88, '#cfd6e0');
        }
    }

    function drawClouds() {
        const n = sky.night;
        for (const c of clouds) {
            if (n < 0.999 && img.cloudDay) {
                ctx.globalAlpha = 1 - n;
                ctx.drawImage(img.cloudDay, c.x, c.y, c.size, c.size);
            }
            if (n > 0.001 && img.cloudNight) {
                ctx.globalAlpha = n;
                ctx.drawImage(img.cloudNight, c.x, c.y, c.size, c.size);
            }
        }
        ctx.globalAlpha = 1;
    }

    // Distant hills and jungle, procedurally drawn with parallax so they tile forever and
    // stay sharp at any resolution. Colours follow the day/night cycle.
    function drawLandscape(trackPos) {
        const n = sky.night, d = sky.dusk * (1 - n) * 0.3;
        const w = view.w;

        // Far hills (parallax 0.12)
        let off = trackPos * 0.12;
        ctx.fillStyle = mixColor(COLORS.farDay, COLORS.farNight, n, COLORS.farDusk, d);
        ctx.beginPath();
        ctx.moveTo(0, GROUND_Y + 2);
        for (let x = 0; x <= w + 20; x += 20) {
            const X = x + off;
            const y = 350 + 22 * Math.sin(X * 0.004) + 14 * Math.sin(X * 0.011 + 1.3) - 10 * Math.abs(Math.sin(X * 0.03));
            ctx.lineTo(x, y);
        }
        ctx.lineTo(w + 20, GROUND_Y + 2);
        ctx.closePath();
        ctx.fill();

        // Jungle trees (parallax 0.3)
        off = trackPos * 0.3;
        const spacing = 150;
        const first = Math.floor((off - 120) / spacing), last = Math.floor((off + w + 120) / spacing);
        ctx.fillStyle = mixColor(COLORS.treeDay, COLORS.treeNight, n, COLORS.treeDusk, d);
        ctx.beginPath();
        for (let i = first; i <= last; i++) {
            const h1 = hash(i);
            if (h1 < 0.25) continue;
            const x = i * spacing - off + hash(i + 50) * 80;
            const height = 70 + hash(i + 99) * 70;
            const topY = GROUND_Y - height;
            ctx.rect(x - 5, topY, 10, height);
            const r = 26 + h1 * 22;
            ctx.moveTo(x + r, topY);
            ctx.arc(x, topY, r, 0, Math.PI * 2);
            ctx.moveTo(x - r * 0.6 + r * 0.8, topY + r * 0.35);
            ctx.arc(x - r * 0.6, topY + r * 0.35, r * 0.8, 0, Math.PI * 2);
            ctx.moveTo(x + r * 0.7 + r * 0.75, topY + r * 0.3);
            ctx.arc(x + r * 0.7, topY + r * 0.3, r * 0.75, 0, Math.PI * 2);
        }
        ctx.fill();

        // Near bushes (parallax 0.55)
        off = trackPos * 0.55;
        ctx.fillStyle = mixColor(COLORS.nearDay, COLORS.nearNight, n);
        ctx.beginPath();
        ctx.moveTo(0, GROUND_Y + 2);
        for (let x = 0; x <= w + 16; x += 16) {
            const X = x + off;
            const y = 412 + 8 * Math.sin(X * 0.013 + 2) - 14 * Math.abs(Math.sin(X * 0.045));
            ctx.lineTo(x, y);
        }
        ctx.lineTo(w + 16, GROUND_Y + 2);
        ctx.closePath();
        ctx.fill();
    }

    function drawGround(trackPos) {
        const n = sky.night, w = view.w;
        const bottom = view.top + view.h;

        ctx.fillStyle = mixColor(COLORS.soilDay, COLORS.soilNight, n);
        ctx.fillRect(0, GROUND_Y, w, bottom - GROUND_Y);
        ctx.fillStyle = mixColor(COLORS.grassDay, COLORS.grassNight, n);
        ctx.fillRect(0, GROUND_Y - 2, w, 20);

        // Grass blades and pebbles scroll with the track: this sells the running motion.
        ctx.fillStyle = mixColor(COLORS.tuftDay, COLORS.tuftNight, n);
        ctx.beginPath();
        const sp = 26;
        const first = Math.floor(trackPos / sp) - 1, last = Math.ceil((trackPos + w) / sp) + 1;
        for (let i = first; i <= last; i++) {
            const x = i * sp - trackPos + hash(i) * 10;
            const h = 6 + hash(i + 7) * 10;
            ctx.moveTo(x - 4, GROUND_Y);
            ctx.lineTo(x, GROUND_Y - h);
            ctx.lineTo(x + 4, GROUND_Y);
        }
        const ps = 70;
        const pf = Math.floor(trackPos / ps) - 1, pl = Math.ceil((trackPos + w) / ps) + 1;
        for (let i = pf; i <= pl; i++) {
            const x = i * ps - trackPos + hash(i + 3) * 40;
            const y = GROUND_Y + 28 + hash(i + 11) * Math.max(10, bottom - GROUND_Y - 40);
            ctx.rect(x, y, 10 + hash(i + 5) * 14, 4);
        }
        ctx.fill();
    }

    function drawSprite(image, x, y, size, fallbackColor) {
        if (image) ctx.drawImage(image, x, y, size, size);
        else {
            ctx.fillStyle = fallbackColor;
            ctx.beginPath();
            ctx.arc(x + size / 2, y + size / 2, size * 0.4, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawEntities(trackPos) {
        const t = run.clock;
        const list = run.entities;
        const maxX = view.w + 10;
        for (let i = 0; i < list.length; i++) {
            const e = list[i];
            const x = e.x - trackPos;
            if (x > maxX || x + e.size < -10 || e.collected) continue;
            if (e.type === 'banana') {
                drawSprite(img.banana, x, e.top + Math.sin(t * 4 + e.phase) * 3, e.size, '#ffe135');
            } else if (e.type === 'tiger') {
                // Bounding gait: purely cosmetic, the hitbox stays put.
                const bob = -Math.abs(Math.sin(t * 11 + e.phase)) * 4;
                drawSprite(img.tiger, x, e.top + bob, e.size, '#f39c12');
            } else {
                const bob = Math.sin(t * 6 + e.phase) * 3;
                const tilt = Math.sin(t * 6 + e.phase + 1) * 0.06;
                ctx.save();
                ctx.translate(x + e.size / 2, e.top + e.size / 2 + bob);
                ctx.rotate(tilt);
                drawSprite(img.hawk, -e.size / 2, -e.size / 2, e.size, '#7b4a2a');
                ctx.restore();
            }
        }
    }

    function drawPlayer(alt) {
        const def = SPRITES.gorilla;
        const size = def.size;
        const p = run.player;
        let y = GROUND_Y - alt - def.feet * size;
        let tilt = 0;
        if (p.onGround && run.state === 'playing') y -= Math.abs(Math.sin(run.clock * 13)) * 4;
        if (!p.onGround) tilt = clamp(-p.vy * 0.00018, -0.14, 0.14);
        // A skin's `scale` enlarges it around the feet, so it still stands on the ground.
        const skin = skinById(Progress.data.selected);
        const drawn = size * ((skin && skin.scale) || 1);
        ctx.save();
        ctx.translate(CONFIG.PLAYER_X + size / 2, y + size / 2);
        ctx.rotate(tilt);
        drawSprite(skinSprite(skin), -drawn / 2, def.feet * (size - drawn) - size / 2, drawn, '#333');
        ctx.restore();
    }

    function drawPopups() {
        ctx.font = 'bold 26px "Trebuchet MS", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffe135';
        ctx.strokeStyle = 'rgba(60,40,0,0.8)';
        ctx.lineWidth = 4;
        for (const p of popups) {
            if (p.life <= 0) continue;
            ctx.globalAlpha = clamp(p.life / 0.4, 0, 1);
            ctx.strokeText('+1', p.x, p.y);
            ctx.fillText('+1', p.x, p.y);
        }
        ctx.globalAlpha = 1;
    }

    function drawWasted() {
        const t = run.state === 'gameover' ? DIE_DURATION : run.dieTime;
        const flash = Math.max(0, 1 - t / 0.25);
        if (flash > 0) {
            ctx.globalAlpha = flash * 0.5;
            ctx.fillStyle = '#ff2020';
            ctx.fillRect(0, view.top, view.w, view.h);
        }
        const a = clamp((t - 0.15) / 0.6, 0, 1);
        ctx.globalAlpha = a * 0.6;
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(0, view.top, view.w, view.h);
        if (run.state === 'dying') {
            ctx.globalAlpha = a;
            ctx.font = 'bold 92px Impact, "Arial Black", sans-serif';
            ctx.textAlign = 'center';
            ctx.lineWidth = 8;
            ctx.strokeStyle = '#1a0000';
            ctx.fillStyle = '#d61f1f';
            ctx.strokeText('WASTED', view.w / 2, CONFIG.WORLD_H / 2);
            ctx.fillText('WASTED', view.w / 2, CONFIG.WORLD_H / 2);
        }
        ctx.globalAlpha = 1;
    }

    // =====================================================================
    // HUD (DOM, touched only when a displayed value changes)
    // =====================================================================

    const numberFormat = new Intl.NumberFormat();
    const hud = { last: { bananas: -1, meters: -1 } };

    function updateHud() {
        const m = meters();
        if (m !== hud.last.meters) { hud.last.meters = m; dom.hudDistance.textContent = numberFormat.format(m) + ' m'; }
        if (run.bananas !== hud.last.bananas) { hud.last.bananas = run.bananas; dom.hudBananas.textContent = numberFormat.format(run.bananas); }
    }

    // =====================================================================
    // Flow: screens, start, pause, countdown, game over
    // =====================================================================

    const COUNTDOWN_TICK = 0.75; // seconds per countdown number
    let portraitAccepted = false;

    function showScreen(name) {
        for (const key of Object.keys(dom.screens)) dom.screens[key].classList.toggle('active', key === name);
        document.body.classList.toggle('in-game', name === 'game');
        updateOrientationUI();
    }

    function setOverlay(el, visible) { el.classList.toggle('hidden', !visible); }

    function blurActive() {
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    }

    function startGame() {
        if (!assetsReady) return;
        if (run.state !== 'menu' && run.state !== 'gameover') return; // ignore double taps
        if (run.result) Records.commitEntry(run.result, dom.nameInput.value);
        requestLandscape();

        showScreen('game');
        resize();
        resetRun();
        setOverlay(dom.pauseOverlay, false);
        setOverlay(dom.countdown, false);
        setOverlay(dom.results, false);
        blurActive();
        beginPlaying();
        updateOrientationUI(); // portrait on a phone: pause behind the rotate prompt
    }

    function beginPlaying() {
        run.state = 'playing';
        accumulator = 0;
        input.reset();
        setOverlay(dom.countdown, false);
        dom.pauseBtn.classList.remove('hidden');
        requestLoop();
    }

    function pauseFor(reason) {
        if (run.state !== 'playing' && run.state !== 'countdown') return;
        run.state = 'paused';
        run.pauseReason = reason;
        input.reset();
        setOverlay(dom.countdown, false);
        setOverlay(dom.pauseOverlay, true);
        needsRender = true;
        requestLoop(); // draws the frozen frame once, then stops
    }

    function resume() {
        if (run.state !== 'paused' || needsRotate()) return;
        run.state = 'countdown';
        run.countdown = COUNTDOWN_TICK * 3;
        run.pauseReason = '';
        input.reset();
        blurActive();
        setOverlay(dom.pauseOverlay, false);
        dom.countdownText.textContent = '3';
        setOverlay(dom.countdown, true);
        requestLoop();
    }

    function togglePause() {
        if (run.state === 'playing' || run.state === 'countdown') pauseFor('user');
        else if (run.state === 'paused') resume();
    }

    // Add this run's bananas and distance to the player's bank (once per run). An abandoned
    // run still keeps its bananas, though it never counts toward records.
    function bankRun() {
        if (run.banked) return;
        run.banked = true;
        Progress.bank(meters(), run.bananas);
    }

    function purchasableIds() {
        return SKINS.filter((skin) => Progress.canBuy(skin)).map((skin) => skin.id);
    }

    function goToMenu() {
        if (run.result) Records.commitEntry(run.result, dom.nameInput.value);
        bankRun();
        run.state = 'menu';
        run.result = null;
        stopLoop();
        input.reset();
        setOverlay(dom.pauseOverlay, false);
        setOverlay(dom.countdown, false);
        setOverlay(dom.results, false);
        refreshMenu();
        showScreen('menu');
    }

    function die() {
        run.state = 'dying';
        run.dieTime = 0;
        input.reset();
        dom.pauseBtn.classList.add('hidden');
        if (navigator.vibrate) { try { navigator.vibrate(120); } catch { /* unsupported */ } }
        const before = purchasableIds();
        run.result = Records.finishRun(meters(), run.bananas);
        bankRun();
        run.result.newSkins = purchasableIds().filter((id) => !before.includes(id));
    }

    function showResults() {
        run.state = 'gameover';
        needsRender = true;
        const r = run.result;
        const rec = Records.data;
        dom.resDistance.textContent = numberFormat.format(r.distance) + ' m';
        dom.resBananas.textContent = numberFormat.format(r.bananas);
        dom.resBestDistance.textContent = numberFormat.format(rec.bestDistance) + ' m';
        dom.resMostBananas.textContent = numberFormat.format(rec.mostBananas);
        setOverlay(dom.resDistanceBadge, r.newDistance);
        setOverlay(dom.resBananasBadge, r.newBananas);
        dom.resWallet.textContent = '+' + numberFormat.format(r.bananas) + ' banked · Bank 🍌 ' +
            numberFormat.format(Progress.data.bananas);
        const names = r.newSkins.map((id) => skinById(id).name);
        dom.resUnlocks.textContent = names.length ? 'You can now buy: ' + names.join(', ') + '! Visit Skins.' : '';
        setOverlay(dom.resUnlocks, names.length > 0);

        const onBoard = r.boardDistance || r.boardBananas;
        setOverlay(dom.entry, onBoard);
        if (onBoard) {
            const which = r.boardDistance && r.boardBananas ? 'both Top 5 lists'
                : r.boardDistance ? 'the Top 5 distances' : 'the Top 5 banana hauls';
            dom.entryText.textContent = 'You made ' + which + '! Enter your name:';
            dom.nameInput.value = rec.lastName;
            dom.nameInput.disabled = false;
            dom.saveNameBtn.disabled = false;
            dom.saveNameBtn.textContent = 'Save';
        }
        setOverlay(dom.results, true);
    }

    function saveName() {
        if (!run.result || run.result.committed) return;
        Records.commitEntry(run.result, dom.nameInput.value);
        dom.nameInput.disabled = true;
        dom.saveNameBtn.disabled = true;
        dom.saveNameBtn.textContent = 'Saved';
        dom.nameInput.blur();
    }

    function refreshMenu() {
        const rec = Records.data;
        dom.menuBest.textContent = rec.bestDistance || rec.mostBananas
            ? 'Best ' + numberFormat.format(rec.bestDistance) + ' m  ·  🍌 ' + numberFormat.format(rec.mostBananas)
            : '';
        dom.skinsBtnWallet.textContent = numberFormat.format(Progress.data.bananas);
    }

    // =====================================================================
    // Skins screen
    // =====================================================================

    function showSkins() {
        renderSkins();
        showScreen('skins');
    }

    function requirementText(skin) {
        const parts = [];
        if (skin.bestRun && Records.data.bestDistance < skin.bestRun) {
            parts.push({ text: 'Run ' + numberFormat.format(skin.bestRun) + ' m in one run',
                have: Records.data.bestDistance, need: skin.bestRun });
        }
        if (skin.totalRun && Progress.data.totalMeters < skin.totalRun) {
            parts.push({ text: 'Run ' + numberFormat.format(skin.totalRun) + ' m in total',
                have: Progress.data.totalMeters, need: skin.totalRun });
        }
        return parts;
    }

    function renderSkins() {
        const bank = Progress.data.bananas;
        dom.skinsWallet.textContent = numberFormat.format(bank);
        dom.skinsGrid.textContent = '';
        for (const skin of SKINS) {
            const owned = Progress.owns(skin);
            const equipped = owned && Progress.data.selected === skin.id;
            const goals = owned ? [] : requirementText(skin);
            const locked = goals.length > 0;

            const card = document.createElement('div');
            card.className = 'skin-card' + (equipped ? ' equipped' : '') + (locked ? ' locked' : '');

            const thumb = document.createElement('canvas');
            thumb.className = 'skin-thumb';
            thumb.width = thumb.height = 160;
            const sprite = skinSprite(skin);
            if (sprite) {
                const g = thumb.getContext('2d');
                if (locked) g.globalAlpha = 0.4;
                g.drawImage(sprite, 0, 0, 160, 160);
            }

            const name = document.createElement('div');
            name.className = 'skin-name';
            name.textContent = skin.name;
            card.append(thumb, name);

            for (const goal of goals) {
                const req = document.createElement('div');
                req.className = 'skin-req';
                req.textContent = '🔒 ' + goal.text;
                const bar = document.createElement('div');
                bar.className = 'skin-bar';
                const fill = document.createElement('span');
                fill.style.width = Math.min(100, (goal.have / goal.need) * 100).toFixed(1) + '%';
                bar.appendChild(fill);
                const count = document.createElement('div');
                count.className = 'skin-count';
                count.textContent = numberFormat.format(goal.have) + ' / ' + numberFormat.format(goal.need) + ' m';
                card.append(req, bar, count);
            }

            const btn = document.createElement('button');
            btn.className = 'btn btn-small';
            btn.dataset.id = skin.id;
            if (equipped) {
                btn.textContent = 'Equipped';
                btn.disabled = true;
            } else if (owned) {
                btn.textContent = 'Equip';
            } else {
                btn.textContent = '🍌 ' + numberFormat.format(skin.price);
                btn.disabled = locked || bank < skin.price;
                if (!btn.disabled) btn.classList.add('btn-primary');
                if (!locked && bank < skin.price) {
                    const short = document.createElement('div');
                    short.className = 'skin-req';
                    short.textContent = 'Need ' + numberFormat.format(skin.price - bank) + ' more';
                    card.appendChild(short);
                }
            }
            card.appendChild(btn);
            dom.skinsGrid.appendChild(card);
        }
    }

    function onSkinButton(e) {
        const btn = e.target.closest('button[data-id]');
        if (!btn || btn.disabled) return;
        const skin = skinById(btn.dataset.id);
        if (!skin) return;
        if (Progress.owns(skin)) Progress.select(skin);
        else Progress.buy(skin);
        renderSkins();
    }

    function showRecords() {
        const rec = Records.data;
        dom.recBestDistance.textContent = numberFormat.format(rec.bestDistance) + ' m';
        dom.recMostBananas.textContent = numberFormat.format(rec.mostBananas);
        fillBoard(dom.recDistanceList, rec.distanceBoard, (v) => numberFormat.format(v) + ' m');
        fillBoard(dom.recBananaList, rec.bananaBoard, (v) => '🍌 ' + numberFormat.format(v));
        showScreen('records');
    }

    function fillBoard(list, board, format) {
        list.textContent = '';
        if (!board.length) {
            const li = document.createElement('li');
            li.className = 'empty';
            li.textContent = 'No runs yet';
            list.appendChild(li);
            return;
        }
        for (const entry of board) {
            const li = document.createElement('li');
            const name = document.createElement('span');
            name.className = 'name';
            name.textContent = entry.name;
            const value = document.createElement('span');
            value.className = 'value';
            value.textContent = format(entry.value);
            li.append(name, value);
            list.appendChild(li);
        }
    }

    function setupButtons() {
        dom.startBtn.addEventListener('click', startGame);
        dom.recordsBtn.addEventListener('click', showRecords);
        dom.recordsBackBtn.addEventListener('click', () => { refreshMenu(); showScreen('menu'); });
        dom.skinsBtn.addEventListener('click', showSkins);
        dom.skinsBackBtn.addEventListener('click', () => { refreshMenu(); showScreen('menu'); });
        dom.skinsGrid.addEventListener('click', onSkinButton);
        dom.pauseBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        dom.pauseBtn.addEventListener('click', () => { blurActive(); togglePause(); });
        dom.resumeBtn.addEventListener('click', resume);
        dom.pauseMenuBtn.addEventListener('click', goToMenu);
        dom.restartBtn.addEventListener('click', startGame);
        dom.resultsMenuBtn.addEventListener('click', goToMenu);
        dom.saveNameBtn.addEventListener('click', saveName);
        dom.rotateAnywayBtn.addEventListener('click', () => {
            portraitAccepted = true;
            updateOrientationUI();
        });
        dom.updateBtn.addEventListener('click', () => window.location.reload());
    }

    // =====================================================================
    // Orientation & fullscreen
    // =====================================================================

    const coarsePointer = window.matchMedia ? window.matchMedia('(pointer: coarse)') : { matches: false };

    function isPortrait() { return window.innerHeight > window.innerWidth; }

    // Only phones/tablets are asked to rotate; a narrow desktop window just plays letterboxed.
    function needsRotate() {
        const active = run.state === 'playing' || run.state === 'paused' || run.state === 'countdown';
        return active && coarsePointer.matches && isPortrait() && !portraitAccepted;
    }

    function updateOrientationUI() {
        const show = needsRotate();
        dom.rotate.classList.toggle('hidden', !show);
        if (show) {
            pauseFor('rotate');
        } else if (run.state === 'paused' && run.pauseReason === 'rotate') {
            resume(); // rotated back: go straight into the 3-2-1 countdown
        }
    }

    // Best effort: fullscreen + landscape lock where the platform allows it (Android Chrome,
    // installed PWAs). iOS Safari supports neither, so the rotate prompt is the fallback.
    function requestLandscape() {
        if (!coarsePointer.matches) return;
        const el = document.documentElement;
        const standalone = window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches;
        let fs = null;
        try {
            if (!standalone && !document.fullscreenElement) {
                if (el.requestFullscreen) fs = el.requestFullscreen({ navigationUI: 'hide' });
                else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
            }
        } catch { fs = null; }
        const lock = () => {
            try {
                if (screen.orientation && screen.orientation.lock) {
                    screen.orientation.lock('landscape').catch(() => { /* not allowed here */ });
                }
            } catch { /* unsupported */ }
        };
        if (fs && fs.then) fs.then(lock, lock); else lock();
    }

    function setupViewportEvents() {
        window.addEventListener('resize', resize);
        window.addEventListener('orientationchange', () => setTimeout(resize, 50));
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) pauseFor('fullscreen');
            resize();
        });
    }

    // =====================================================================
    // PWA
    // =====================================================================

    function registerServiceWorker() {
        if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
        const hadController = !!navigator.serviceWorker.controller;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            // A new version took over. Never reload mid-run; offer it on the menu instead.
            if (hadController) dom.updateBanner.classList.remove('hidden');
        });
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => { /* offline or unsupported */ });
        });
    }

    // =====================================================================
    // Boot
    // =====================================================================

    function boot() {
        dom.version.textContent = 'v' + CONFIG.VERSION;
        Records.load();
        Progress.load();
        refreshMenu();
        setupButtons();
        setupInput();
        setupViewportEvents();
        registerServiceWorker();
        resize();
        resetClouds();
        loadAssets().then(() => {
            assetsReady = true;
            dom.startBtn.disabled = false;
            dom.startBtn.textContent = 'Start';
        });
        if (/[?&]debug\b/.test(location.search)) {
            window.HaRUNbeDebug = { run, view, sky, input, records: () => Records.data, progress: () => Progress.data };
        }
    }

    boot();
})();
