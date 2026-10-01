/*
 * HaRUNbe — browser front end: assets, input, game loop, rendering, UI, records, PWA.
 * Game rules and physics live in engine.js; the skin and power-up lists live in skins.js
 * and powerups.js.
 *
 * FILE MAP (search for the "=====" section headers)
 *   DOM ................... every page element the code uses (ids from index.html)
 *   Assets ................ image paths and loading (Start waits only for what a run needs)
 *   Records ............... best distance / most bananas / Top 5 lists (localStorage)
 *   Progress .............. banked bananas, owned skins, power-ups, per-skin goals (localStorage)
 *   Skin sprites .......... recolouring skins; Effect sprites: tints and glows
 *   View / canvas sizing .. how the world fits any screen (resize)
 *   Run state ............. everything about the current run (the `run` object)
 *   Input ................. touch, mouse and keyboard
 *   Game loop ............. fixed 240 Hz simulation, drawn every frame (frame, stepPlaying)
 *   Power-ups ............. activating and running Shield / Magnet / Double / Head start
 *   Day / night cycle ..... sky phase, sun and moon
 *   Rendering ............. everything drawn on the canvas, back to front (render)
 *   Bonus stages .......... BONUS! banner and golden glow
 *   HUD ................... banana and distance counters
 *   Flow .................. start, pause, countdown, death, results screen, menus
 *   Skins screen .......... the Shop (skins + power-ups tabs), card layout and paging
 *   Orientation ........... rotate prompt, fullscreen, landscape lock
 *   Install ............... Install button and Add to Home Screen guide
 *   PWA / Boot ............ service worker registration and start-up
 *
 * WHERE TO EDIT
 *   Colours of sky / hills / ground ... COLORS (Rendering)
 *   Enemy tints, banana glow .......... Effect sprites
 *   How long death / countdown take ... DIE_DURATION, COUNTDOWN_TICK
 *   Power-up effects .................. Power-ups section (numbers are in powerups.js)
 *   Shop card sizes ................... CARD_MIN_W / CARD_MAX_H (Skins screen)
 *   Saved data format ................. Records / Progress (keep old saves loading!)
 *
 * PERFORMANCE NOTES
 *   - The DOM (HUD, power-up buttons) is only touched when a shown value changes; the
 *     canvas does all per-frame drawing.
 *   - Recoloured skins, tints and glows are drawn once into canvases and reused.
 *   - Entities live in one array that is compacted in place (cullEntities): no garbage per frame.
 *   - The world is generated at most one enemy group per frame, well ahead of the screen.
 */
(function () {
    'use strict';

    const E = window.HarunbeEngine;
    const { CONFIG, SPRITES, clamp, lerp } = E;
    const GROUND_Y = CONFIG.GROUND_Y;
    const SKINS = window.HarunbeSkins;
    const POWER = window.HarunbePowerups;

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
        skinsPager: $('skins-pager'),
        skinsPageText: $('skins-page'),
        skinsPrev: $('skins-prev'),
        skinsNext: $('skins-next'),
        shopTabs: document.querySelectorAll('#skins-screen .shop-tab'),
        installBtn: $('install-btn'),
        installOverlay: $('install-overlay'),
        installCloseBtn: $('install-close-btn'),
        installTabs: document.querySelectorAll('.install-tab'),
        installToast: $('install-toast'),
        powerBar: $('power-bar'),
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
    // Loaded images by key: an Image once loaded, null if it failed, undefined while loading.
    const img = {};
    let assetsReady = false;

    // A missing image never blocks the game; it is drawn with a simple fallback shape.
    function loadImage(key, src) {
        return new Promise((resolve) => {
            const im = new Image();
            im.decoding = 'async';
            im.onload = () => { img[key] = im; resolve(); };
            im.onerror = () => { img[key] = null; resolve(); };
            im.src = src;
        });
    }

    // Start waits only for what a run needs: scenery, enemies, bananas and the equipped skin.
    // The other skins load afterwards in the background (they're only needed in the Shop),
    // so adding more skins never slows down the first start.
    function loadAssets() {
        const selected = skinById(Progress.data.selected) || SKINS[0];
        const core = Object.keys(ASSET_PATHS).map((key) => loadImage(key, ASSET_PATHS[key]));
        core.push(loadImage('skin:' + selected.image, selected.image));
        return Promise.all(core);
    }

    function loadRestOfSkins() {
        const pending = [];
        for (const skin of SKINS) {
            const key = 'skin:' + skin.image;
            if (key in img || pending.some((p) => p.key === key)) continue;
            pending.push({ key, src: skin.image });
        }
        return Promise.all(pending.map((p) => loadImage(p.key, p.src)));
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
    // Progress: banked bananas, lifetime distance, owned skins and power-ups (localStorage)
    // =====================================================================

    const Progress = (function () {
        const KEY = 'harunbe.progress.v1';
        // Skins that existed before per-skin goals (v3.7). For players who already had a save,
        // their goals keep counting every past run, so nobody loses progress they had.
        const LEGACY_SKINS = ['classic', 'silverback', 'yeti', 'tie', 'miku', 'lava', 'toxic',
            'pirate', 'golden', 'racer', 'samurai', 'robopirate'];
        let data = blank();

        function blank() {
            return { version: 1, bananas: 0, totalMeters: 0, owned: [], selected: SKINS[0].id, powerups: {}, goals: {} };
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
                if (stored.powerups && typeof stored.powerups === 'object') {
                    for (const p of POWER.list) data.powerups[p.id] = Math.min(POWER.max, count(stored.powerups[p.id]));
                }
                if (stored.goals && typeof stored.goals === 'object') {
                    for (const id of Object.keys(stored.goals)) {
                        const g = stored.goals[id];
                        if (g === null) data.goals[id] = null; // counts every past run (see startGoals)
                        else if (g && typeof g === 'object') data.goals[id] = { best: count(g.best), start: count(g.start) };
                    }
                }
            }
            if (!owns(skinById(data.selected))) data.selected = SKINS[0].id;
            if (startGoals(stored)) save();
        }

        // A skin the player hasn't seen before starts its own goal tracker now: its distance
        // goals only count runs from this moment on (the best single run since, and the
        // metres run since). So a new skin with a lower goal than the player's record still
        // has to be earned. A `null` entry marks an older skin that counts every past run.
        function startGoals(stored) {
            // A save from before per-skin goals, or a player from before the Shop existed
            // (records but no progress save yet).
            const oldSave = (stored && typeof stored === 'object' && !stored.goals) ||
                (!stored && Records.data.bestDistance > 0);
            let added = false;
            for (const skin of SKINS) {
                if (!(skin.bestRun || skin.totalRun) || skin.id in data.goals) continue;
                data.goals[skin.id] = oldSave && LEGACY_SKINS.includes(skin.id)
                    ? null
                    : { best: 0, start: data.totalMeters };
                added = true;
            }
            return added;
        }

        // How far the player has got toward a skin's goals.
        function goalProgress(skin) {
            const g = data.goals[skin.id];
            if (!g) return { best: Records.data.bestDistance, total: data.totalMeters, fresh: false };
            return { best: g.best, total: Math.max(0, data.totalMeters - g.start), fresh: true };
        }

        // A finished run counts toward every skin's "best single run since it arrived".
        function noteFinishedRun(meters) {
            for (const g of Object.values(data.goals)) if (g) g.best = Math.max(g.best, count(meters));
            save();
        }

        function save() {
            try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage full or blocked */ }
        }

        function owns(skin) { return !!skin && (skin.price === 0 || data.owned.includes(skin.id)); }

        // The distance goals a skin needs before it can be bought.
        function requirementsMet(skin) {
            const p = goalProgress(skin);
            const runOk = !skin.bestRun || p.best >= skin.bestRun;
            const totalOk = !skin.totalRun || p.total >= skin.totalRun;
            // `either`: one long run OR enough total distance unlocks it.
            if (skin.either && skin.bestRun && skin.totalRun) return p.best >= skin.bestRun || p.total >= skin.totalRun;
            return runOk && totalOk;
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

        // Power-ups: stored up to POWER.max of each; one is removed from storage when used.
        function powerCount(p) { return data.powerups[p.id] || 0; }

        function canBuyPower(p) { return powerCount(p) < POWER.max && data.bananas >= p.price; }

        function buyPower(p) {
            if (!canBuyPower(p)) return false;
            data.bananas -= p.price;
            data.powerups[p.id] = powerCount(p) + 1;
            save();
            return true;
        }

        function usePower(p) {
            if (powerCount(p) <= 0) return false;
            data.powerups[p.id] = powerCount(p) - 1;
            save();
            return true;
        }

        return {
            load, owns, requirementsMet, canBuy, buy, select, bank, goalProgress, noteFinishedRun,
            powerCount, canBuyPower, buyPower, usePower,
            get data() { return data; }
        };
    })();

    function skinById(id) {
        for (const skin of SKINS) if (skin.id === id) return skin;
        return null;
    }

    // =====================================================================
    // Skin sprites (recoloured once, then cached)
    // =====================================================================

    const skinSprites = {};

    // The image to draw for a skin: its artwork, recoloured if the skin has `recolor`.
    function skinSprite(skin) {
        if (!skin) skin = SKINS[0];
        if (skin.id in skinSprites) return skinSprites[skin.id];
        const loaded = img['skin:' + skin.image];
        // Still loading: show the default gorilla for now, and don't cache it.
        if (!assetsReady || loaded === undefined) return loaded || img.gorilla;
        const base = loaded || img.gorilla; // failed to load: default gorilla
        let sprite = base;
        if (base && skin.recolor) {
            try { sprite = recolor(base, skin.recolor); } catch { sprite = base; } // e.g. file:// pages
        }
        skinSprites[skin.id] = sprite;
        return sprite;
    }

    // =====================================================================
    // Effect sprites: tinted enemies and glowing bananas (built once, then cached)
    // =====================================================================

    const effectSprites = {};

    // Build an effect image once (after images load) and reuse it every frame.
    function effectSprite(key, build) {
        if (key in effectSprites) return effectSprites[key];
        if (!assetsReady) return null; // don't cache before the images have loaded
        let sprite = null;
        try { sprite = build(); } catch { sprite = null; }
        effectSprites[key] = sprite;
        return sprite;
    }

    // Multiply the artwork by `color` (keeps its shading and dark outline), clipped to its shape.
    function tintSprite(image, color, strength) {
        const w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const g = canvas.getContext('2d');
        g.drawImage(image, 0, 0, w, h);
        g.globalCompositeOperation = 'multiply';
        g.globalAlpha = strength;
        g.fillStyle = color;
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'destination-in';
        g.globalAlpha = 1;
        g.drawImage(image, 0, 0, w, h);
        return canvas;
    }

    // Diving and rising hawks: a shade of red. Pouncing tigers: a deeper orange.
    const glideHawkSprite = () => img.hawk && effectSprite('hawk:glide', () => tintSprite(img.hawk, '#ff4a3a', 0.45));
    const pounceTigerSprite = () => img.tiger && effectSprite('tiger:pounce', () => tintSprite(img.tiger, '#ff9a2a', 0.4));

    // White tiger: the tiger with its orange drained to white and a cool blue tint; the black
    // stripes and outline stay dark.
    const whiteTigerSprite = () => img.tiger && effectSprite('tiger:white', () => {
        const image = img.tiger;
        const w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const g = canvas.getContext('2d');
        g.drawImage(image, 0, 0, w, h);
        g.globalCompositeOperation = 'saturation';  // remove the colour (orange -> grey)
        g.fillStyle = '#808080';
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'screen';      // lift the greys toward white
        g.globalAlpha = 0.75;
        g.fillStyle = '#c8c8c8';
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'multiply';    // a cool, icy tint
        g.globalAlpha = 1;
        g.fillStyle = '#e4f1ff';
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(image, 0, 0, w, h);             // keep only the tiger's shape
        return canvas;
    });

    // Banana with a soft yellow glow around its outline. The canvas is padded by
    // BANANA_GLOW_PAD (a fraction of the sprite size) on every side to leave room for the glow.
    const BANANA_GLOW_PAD = 0.25;
    const bananaGlowSprite = () => img.banana && effectSprite('banana:glow', () => {
        const image = img.banana;
        const w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
        const pad = Math.round(w * BANANA_GLOW_PAD);
        const canvas = document.createElement('canvas');
        canvas.width = w + pad * 2;
        canvas.height = h + pad * 2;
        const g = canvas.getContext('2d');
        g.shadowColor = 'rgba(255, 226, 60, 0.95)';
        g.shadowBlur = w * 0.14;
        g.drawImage(image, pad, pad, w, h);
        g.shadowBlur = w * 0.06;              // a second, tighter pass brightens the rim
        g.drawImage(image, pad, pad, w, h);
        return canvas;
    });

    // Golden banana: the banana tinted deep gold with a brighter, warmer glow.
    const goldenBananaSprite = () => img.banana && effectSprite('banana:golden', () => {
        const image = img.banana;
        const w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
        const gold = tintSprite(image, '#ff9500', 0.8);
        const pad = Math.round(w * BANANA_GLOW_PAD);
        const canvas = document.createElement('canvas');
        canvas.width = w + pad * 2;
        canvas.height = h + pad * 2;
        const g = canvas.getContext('2d');
        g.shadowColor = 'rgba(255, 190, 30, 1)';
        g.shadowBlur = w * 0.2;
        g.drawImage(gold, pad, pad, w, h);
        g.shadowColor = 'rgba(255, 255, 210, 0.95)';
        g.shadowBlur = w * 0.07;
        g.drawImage(gold, pad, pad, w, h);
        return canvas;
    });

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

    // Fit the world to the window: canvas size, pixel ratio, and how much sky/ground shows.
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
        rushVignette = null;
        needsRender = true;
        if (dom.screens.skins.classList.contains('active')) renderSkins(); // re-fit the cards
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
        banked: true,         // this run's bananas/distance were added to Progress
        pw: null              // power-ups in this run (see resetPowers)
    };

    const clouds = [];
    const popups = []; // "+1" banana pop-ups, reused
    for (let i = 0; i < 8; i++) popups.push({ life: 0, x: 0, y: 0, text: '+1' });

    // Fresh run: reset the player, world generator, power-ups, clouds and HUD.
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
        resetPowers();
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

    // Touch / mouse / keyboard. Tapping or holding anywhere on the canvas jumps.
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
            } else if (POWER_KEYS[e.code]) {
                if (run.state !== 'playing' || e.repeat) return;
                e.preventDefault();
                activatePower(POWER_KEYS[e.code]);
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

    // One animation frame: advance the fixed-step simulation, then draw once.
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

    // One 1/240 s simulation step while running: move, jump, power-ups, collisions.
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
        stepPowers(dt);
        checkCollisions();
    }

    const DIE_DURATION = 1.5;

    // After a hit: the world skids to a stop, then the results screen appears.
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
    const enemyBox = E.makeBox();

    // Collect bananas the gorilla touches; hitting an enemy ends the run (unless shielded).
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
                    const n = (e.value || 1) * (run.pw.double > 0 ? 2 : 1);
                    run.bananas += n;
                    spawnPopup(e.x - run.trackPos + e.size / 2, e.top, '+' + n);
                }
            } else if (!e.harmless && E.overlaps(playerBox, e.hit.mv ? E.obstacleBox(e.hit, run.trackPos, enemyBox) : e.hit)) {
                if (run.pw.shield) { breakShield(e); continue; }
                die();
                return;
            }
        }
    }

    // Drop entities (and bonus zones) that are behind the camera, compacting the array in place.
    function cullEntities() {
        const list = run.entities;
        const limit = run.trackPos - CONFIG.cullUnits;
        const zones = run.gen.bonusZones;
        while (zones.length && zones[0].x1 < limit) zones.shift();
        const rushes = run.gen.rushZones;
        while (rushes.length && rushes[0].x1 < limit) rushes.shift();
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

    function spawnPopup(x, y, text) {
        let p = popups[0];
        for (const q of popups) if (q.life <= 0) { p = q; break; }
        p.life = 0.7; p.x = x; p.y = y; p.text = text || '+1';
    }

    // =====================================================================
    // Power-ups (catalog in powerups.js). Each can be used once per run, by its
    // button or key; one is taken from storage only when it is actually used.
    // =====================================================================

    const POWER_KEYS = {};
    for (const p of POWER.list) { POWER_KEYS['Digit' + p.key] = p; POWER_KEYS['Numpad' + p.key] = p; }
    const WARP_FX = 0.9;       // seconds of head-start animation
    const SHIELD_BLINK = 0.9;  // seconds the gorilla blinks after the shield breaks

    function resetPowers() {
        run.pw = {
            used: {},          // effect -> true once used this run (one of each per run)
            shield: false,
            blink: 0,
            magnet: 0, magnetMax: 1,
            double: 0, doubleMax: 1,
            warpFx: 0, warpFrom: 0
        };
        buildPowerBar();
    }

    function powerAvailable(p) {
        if (run.pw.used[p.effect] || Progress.powerCount(p) <= 0) return false;
        return p.effect !== 'warp' || meters() < POWER.warpWindow;
    }

    function powerActive(p) {
        const pw = run.pw;
        if (p.effect === 'shield') return pw.shield;
        if (p.effect === 'magnet') return pw.magnet > 0;
        if (p.effect === 'double') return pw.double > 0;
        return false;
    }

    // Use a power-up now (button or key): once per run, and only if the player has one.
    function activatePower(p) {
        if (run.state !== 'playing' || !powerAvailable(p) || !Progress.usePower(p)) return;
        const pw = run.pw;
        pw.used[p.effect] = true;
        if (p.effect === 'shield') pw.shield = true;
        else if (p.effect === 'magnet') pw.magnet = pw.magnetMax = p.seconds;
        else if (p.effect === 'double') pw.double = pw.doubleMax = p.seconds;
        else if (p.effect === 'warp') warp(p.meters);
        buildPowerBar();
    }

    // Head start: jump ahead, skipping that stretch of world (and its bananas). The run then
    // continues at the speed and difficulty of the new distance, after a clear runway.
    function warp(metersAhead) {
        const pw = run.pw;
        pw.warpFrom = meters();
        pw.warpFx = WARP_FX;
        const d = metersAhead * CONFIG.UNITS_PER_METER;
        run.trackPos += d;
        run.prevTrackPos = run.trackPos;
        run.distance += d;
        run.entities.length = 0;
        const gen = run.gen;
        gen.cursor = run.trackPos + CONFIG.PLAYER_X + E.speedFor(run.distance) * 2.2 + 300;
        gen.prevObstacles = [];
        gen.prevEnd = run.trackPos + CONFIG.PLAYER_X + 300;
        gen.bonusZones.length = 0; // skipped along with that stretch of world
        gen.rushZones.length = 0;
        gen.rushEnd = 0;
        E.generateUntil(gen, run.trackPos + view.w + CONFIG.aheadUnits, run.entities);
    }

    // The shield absorbs the hit: the enemy group that caused it can't hurt the player any
    // more (the next group is always at least a jump and a reaction time away).
    function breakShield(hitEnemy) {
        const pw = run.pw;
        pw.shield = false;
        pw.blink = SHIELD_BLINK;
        for (const e of run.entities) {
            if (e.type !== 'banana' && e.x > hitEnemy.x - 250 && e.x < hitEnemy.x + 400) e.harmless = true;
        }
        if (navigator.vibrate) { try { navigator.vibrate(60); } catch { /* unsupported */ } }
        buildPowerBar();
    }

    // Count down running power-ups each simulation step.
    function stepPowers(dt) {
        const pw = run.pw;
        if (pw.blink > 0) pw.blink = Math.max(0, pw.blink - dt);
        if (pw.warpFx > 0) pw.warpFx = Math.max(0, pw.warpFx - dt);
        if (pw.double > 0) pw.double = Math.max(0, pw.double - dt);
        if (pw.magnet > 0) {
            pw.magnet = Math.max(0, pw.magnet - dt);
            pullBananas(dt);
        }
    }

    // Magnet: bananas ahead of (and just behind) the gorilla fly toward it.
    function pullBananas(dt) {
        const size = SPRITES.gorilla.size;
        const px = run.trackPos + CONFIG.PLAYER_X + size / 2;
        const py = GROUND_Y - run.player.alt - size * 0.45;
        const k = 1 - Math.exp(-9 * dt);
        for (const e of run.entities) {
            if (e.type !== 'banana' || e.collected) continue;
            const cx = e.x + e.size / 2, cy = e.top + e.size / 2;
            const ahead = cx - px;
            if (ahead < -60 || ahead > 430) continue;
            const mx = (px - cx) * k, my = (py - cy) * k;
            e.x += mx; e.top += my;
            e.hit.x0 += mx; e.hit.x1 += mx; e.hit.y0 += my; e.hit.y1 += my;
        }
    }

    // Buttons along the bottom of the screen: one per power-up the player can use now,
    // plus the ones currently running (with a timer ring).
    const powerBarState = { warpShown: false, sig: '' };

    // Rebuild the power-up buttons (only when one starts, ends, or becomes unusable).
    function buildPowerBar() {
        const bar = dom.powerBar;
        bar.textContent = '';
        for (const p of POWER.list) {
            const inUse = run.pw.used[p.effect] && powerActive(p);
            if (!inUse && !powerAvailable(p)) continue;
            const btn = document.createElement('button');
            btn.className = 'power-btn' + (inUse ? ' active' : '') + (p.effect === 'warp' ? ' warp' : '');
            btn.dataset.id = p.id;
            btn.setAttribute('aria-label', p.name + (p.miles ? ' ' + p.miles + ' mi' : '') + ' (key ' + p.key + ')');
            const icon = document.createElement('span');
            icon.className = 'pw-icon';
            icon.textContent = p.icon;
            const label = document.createElement('span');
            label.className = 'pw-label';
            label.textContent = p.miles ? p.miles + ' mi' : p.name;
            const key = document.createElement('span');
            key.className = 'pw-key';
            key.textContent = p.key;
            btn.append(icon, label, key);
            if (!inUse) {
                const count = document.createElement('span');
                count.className = 'pw-count';
                count.textContent = String(Progress.powerCount(p));
                btn.appendChild(count);
            }
            btn.disabled = inUse;
            bar.appendChild(btn);
        }
        setOverlay(bar, bar.childElementCount > 0);
        powerBarState.warpShown = !!bar.querySelector('.warp');
        powerBarState.sig = powerSignature();
        updatePowerRings();
    }

    function powerSignature() {
        const pw = run.pw;
        return (pw.shield ? 's' : '') + (pw.magnet > 0 ? 'm' : '') + (pw.double > 0 ? 'd' : '');
    }

    // Called every frame: rebuild when something starts or runs out, else just move the rings.
    function updatePowerBar() {
        if (!run.pw) return;
        if ((powerBarState.warpShown && meters() >= POWER.warpWindow) || powerSignature() !== powerBarState.sig) {
            buildPowerBar();
        } else {
            updatePowerRings();
        }
    }

    // Timer bars on running power-ups. Only touched when the bar moves by a visible step
    // (1%), so the page isn't restyled every frame.
    function updatePowerRings() {
        const pw = run.pw;
        for (const btn of dom.powerBar.children) {
            if (!btn.classList.contains('active')) continue;
            const id = btn.dataset.id;
            const left = id === 'magnet' ? pw.magnet / pw.magnetMax : id === 'double' ? pw.double / pw.doubleMax : 1;
            const v = left.toFixed(2);
            if (btn.dataset.left !== v) { btn.dataset.left = v; btn.style.setProperty('--left', v); }
        }
    }

    function onPowerButton(e) {
        const btn = e.target.closest('.power-btn');
        if (!btn || btn.disabled) return;
        const p = POWER.list.find((q) => q.id === btn.dataset.id);
        if (p) activatePower(p);
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

    // Draw one frame, back to front. `alpha` blends the last two simulation steps for smoothness.
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
        const bonus = run.state === 'playing' || run.state === 'paused' || run.state === 'countdown' ? bonusAt(trackPos) : null;
        if (bonus) drawBonusGlow(bonus);
        drawEntities(trackPos);
        drawPlayer(alt);
        drawPopups();
        if (bonus) drawBonusBanner(bonus);
        const rush = bonus || !(run.state === 'playing' || run.state === 'paused' || run.state === 'countdown') ? null : rushAt(trackPos);
        if (rush) drawRush(rush);
        if (run.pw && run.pw.warpFx > 0) drawWarp(run.pw.warpFx / WARP_FX);
        if (run.state === 'dying' || run.state === 'gameover') drawWasted();
    }

    function drawCover(image, x, y, w, h) {
        const ir = image.width / image.height, r = w / h;
        let sw = image.width, sh = image.height, sx = 0, sy = 0;
        if (ir > r) { sw = sh * r; sx = (image.width - sw) / 2; } else { sh = sw / r; sy = image.height - sh; }
        ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
    }

    // Day sky, fading into the starry night sky, with a warm glow at dawn and dusk.
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

    // Sun by day, moon by night, each on an arc that sets behind the jungle.
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

    // Soil and grass; the tufts and pebbles scroll with the track to sell the speed.
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

    // Bananas and enemies on screen (anything off screen is skipped).
    function drawEntities(trackPos) {
        const t = run.clock;
        const list = run.entities;
        const maxX = view.w + 10;
        for (let i = 0; i < list.length; i++) {
            const e = list[i];
            const x = e.x - trackPos;
            if (e.collected) continue;
            // Chargers decide for themselves (they sprint in from off screen, with a warning).
            const charger = e.hit.mv && e.hit.mv.kind === 'charge';
            if (!charger && (x > maxX || x + e.size < -10)) continue;
            if (e.type === 'banana') {
                const by = e.top + Math.sin(t * 4 + e.phase) * 3;
                const glow = e.golden ? goldenBananaSprite() : bananaGlowSprite();
                if (glow) {
                    const pad = e.size * BANANA_GLOW_PAD;
                    ctx.drawImage(glow, x - pad, by - pad, e.size + pad * 2, e.size + pad * 2);
                } else {
                    drawSprite(img.banana, x, by, e.size, e.golden ? '#ffb000' : '#ffe135');
                }
                if (e.golden) drawSparkle(x + e.size * 0.78, by + e.size * 0.2, t * 5 + e.phase);
            } else if (e.hit.mv) {
                drawMover(e, x, trackPos, t);
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

    // Moving enemies. The sprite is drawn exactly where its hitbox is; the squash, tilt,
    // shadow and arrow are warning signs so the player can read what it is about to do.
    function drawMover(e, x, trackPos, t) {
        const mv = e.hit.mv;
        const s = e.size;
        const off = E.obstacleOffset(e.hit, trackPos);
        const ahead = E.obstacleOffset(e.hit, trackPos + 12);
        const feetY = e.top + s * SPRITES[e.type].feet; // ground contact line (tigers)

        if (mv.kind === 'charge') { drawCharger(e, x, trackPos, t, feetY); return; }

        if (e.type === 'tiger') {
            let sx = 1, sy = 1, rot = 0, wiggle = 0;
            if (mv.kind === 'hop') {
                const air = clamp(-off / mv.h, 0, 1);
                sy = air < 0.15 ? 0.86 + air : 1.04;     // squash on landing, stretch in the air
                sx = 2 - sy;
            } else {
                const dd = e.hit.x0 - (trackPos + E.PLAYER_HITBOX.PHX1);
                if (dd > mv.start) {                      // crouched and wiggling: about to pounce
                    sy = 0.8; sx = 1.1;
                    wiggle = Math.sin(t * 22 + e.phase) * 2.5;
                } else if (off < -1) {                    // mid-leap: nose up, then down
                    rot = clamp(-(ahead - off) * 0.05, -0.45, 0.45);
                    sy = 1.08; sx = 0.94;
                }
            }
            drawShadow(x + s / 2, s * 0.55, off);
            ctx.save();
            ctx.translate(x + s / 2 + wiggle, feetY + off);
            ctx.rotate(rot);
            ctx.scale(sx, sy);
            const sprite = mv.kind === 'pounce' ? (pounceTigerSprite() || img.tiger) : img.tiger;
            drawSprite(sprite, -s / 2, -s * SPRITES.tiger.feet, s, '#f39c12');
            ctx.restore();
            return;
        }

        // Gliding hawk (red-tinted): tilts toward where it is heading.
        const moving = Math.abs(ahead - off) > 0.05;
        const rot = moving ? clamp(-(ahead - off) * 0.04, -0.5, 0.5) : Math.sin(t * 6 + e.phase + 1) * 0.06;
        const cy = e.top + s / 2 + off + (moving ? 0 : Math.sin(t * 6 + e.phase) * 3);
        drawShadow(x + s / 2, s * 0.5, (e.hit.y1 + off) - GROUND_Y);
        ctx.save();
        ctx.translate(x + s / 2, cy);
        ctx.rotate(rot);
        drawSprite(glideHawkSprite() || img.hawk, -s / 2, -s / 2, s, '#7b4a2a');
        ctx.restore();
    }

    // White tiger: waits (slow breathing), then sprints at you: fast bounding gait, leaning
    // forward, dust kicked up behind. While it is still off screen, a pulsing marker at the
    // right edge warns that it is coming.
    function drawCharger(e, baseX, trackPos, t, feetY) {
        const mv = e.hit.mv;
        const s = e.size;
        const dd = e.hit.x0 - (trackPos + E.PLAYER_HITBOX.PHX1);
        const charging = dd < mv.trigger;
        const x = baseX + E.obstacleShift(e.hit, trackPos);

        if (charging && x > view.w - s * 0.3) { drawChargeWarning(feetY - s * 0.45, t); return; }
        if (x > view.w + 10 || x + s < -10) return;

        let bob = 0, rot = 0, sy = 1;
        if (charging) {
            bob = -Math.abs(Math.sin(t * 18 + e.phase)) * 7;
            rot = -0.07;                                       // leaning into the sprint
            for (let i = 0; i < 3; i++) {                      // dust puffs behind it
                const q = (t * 3 + i / 3 + e.phase) % 1;
                ctx.globalAlpha = 0.35 * (1 - q);
                ctx.fillStyle = '#d9c9a3';
                ctx.beginPath();
                ctx.arc(x + s * (0.85 + q * 0.6), feetY - 6 - q * 10, 6 + q * 10, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
        } else {
            sy = 0.96 + 0.03 * Math.sin(t * 3 + e.phase);      // waiting, breathing
        }
        drawShadow(x + s / 2, s * 0.55, bob);
        ctx.save();
        ctx.translate(x + s / 2, feetY + bob);
        ctx.rotate(rot);
        ctx.scale(2 - sy, sy);
        drawSprite(whiteTigerSprite() || img.tiger, -s / 2, -s * SPRITES.tiger.feet, s, '#f2f2f2');
        ctx.restore();
    }

    function drawChargeWarning(y, t) {
        const x = view.w - 34;
        const k = 0.6 + 0.4 * Math.abs(Math.sin(t * 9));
        ctx.globalAlpha = k;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath();
        ctx.arc(x, y, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.font = 'bold 28px "Trebuchet MS", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('⚠️', x, y + 1);
        ctx.textBaseline = 'alphabetic';
    }

    // Soft shadow on the ground; smaller and fainter the higher the enemy is (`off` < 0 = up).
    function drawShadow(cx, w, off) {
        const k = clamp(1 + off / 160, 0.35, 1);
        ctx.globalAlpha = 0.28 * k;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(cx, GROUND_Y + 3, w * k * 0.5, 5 * k, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    // Twinkling four-point star on golden bananas.
    function drawSparkle(cx, cy, t) {
        const k = 0.5 + 0.5 * Math.sin(t);
        const r = 5 + 7 * k;
        ctx.globalAlpha = 0.35 + 0.65 * k;
        ctx.fillStyle = '#fffbe0';
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r * 0.25, cy - r * 0.25);
        ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx + r * 0.25, cy + r * 0.25);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r * 0.25, cy + r * 0.25);
        ctx.lineTo(cx - r, cy);
        ctx.lineTo(cx - r * 0.25, cy - r * 0.25);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    // =====================================================================
    // Bonus stages (generated by the engine: a stretch with bananas and no enemies)
    // =====================================================================

    const BONUS_LEAD = 1.0; // seconds of "BONUS!" warning before the stage starts

    // The bonus stage the gorilla is in (or about to enter): { zone, q, into } where q is how
    // much of it is left (1 -> 0) and `into` is seconds since it started (negative = not yet).
    function bonusAt(trackPos) {
        if (!run.gen) return null;
        const pos = trackPos + CONFIG.PLAYER_X;
        const s = Math.max(1, run.speed);
        for (const z of run.gen.bonusZones) {
            if (pos >= z.x0 - s * BONUS_LEAD && pos <= z.x1) {
                return { zone: z, q: clamp((z.x1 - pos) / (z.x1 - z.x0), 0, 1), into: (pos - z.x0) / s, left: (z.x1 - pos) / s };
            }
        }
        return null;
    }

    // The rush wave the gorilla is in or about to enter (same shape as bonusAt's result).
    function rushAt(trackPos) {
        if (!run.gen) return null;
        const pos = trackPos + CONFIG.PLAYER_X;
        const s = Math.max(1, run.speed);
        for (const z of run.gen.rushZones) {
            if (pos >= z.x0 - s * BONUS_LEAD && pos <= z.x1) {
                return { zone: z, q: clamp((z.x1 - pos) / (z.x1 - z.x0), 0, 1), into: (pos - z.x0) / s, left: (z.x1 - pos) / s };
            }
        }
        return null;
    }

    // Rush wave: a red glow around the screen edges, and a red banner with a timer bar.
    function drawRush(b) {
        const k = clamp(Math.min(b.into + BONUS_LEAD, b.left) / 0.5, 0, 1);
        if (k > 0) {
            if (!rushVignette) {
                rushVignette = ctx.createRadialGradient(view.w / 2, CONFIG.WORLD_H / 2, Math.min(view.w, view.h) * 0.35,
                    view.w / 2, CONFIG.WORLD_H / 2, Math.max(view.w, view.h) * 0.75);
                rushVignette.addColorStop(0, 'rgba(220,30,30,0)');
                rushVignette.addColorStop(1, 'rgba(220,30,30,0.55)');
            }
            ctx.globalAlpha = k * (0.75 + 0.25 * Math.sin(run.clock * 6));
            ctx.fillStyle = rushVignette;
            ctx.fillRect(0, view.top, view.w, view.h);
            ctx.globalAlpha = 1;
        }
        drawBanner(b, b.into < 0 ? 'RUSH INCOMING!' : '⚠️ RUSH! ⚠️', '#ff4a3a', '#3a0000', '#ff4a3a');
    }
    let rushVignette = null;

    // Warm golden light over the world while a bonus stage is on (fades in and out).
    function drawBonusGlow(b) {
        const k = clamp(Math.min(b.into + BONUS_LEAD, b.left) / 0.6, 0, 1);
        if (k <= 0) return;
        ctx.globalAlpha = 0.2 * k;
        ctx.fillStyle = '#ffc63a';
        ctx.fillRect(0, view.top, view.w, view.h);
        ctx.globalAlpha = 1;
    }

    // "BONUS!" banner at the top with a bar showing how much of the stage is left.
    function drawBonusBanner(b) {
        drawBanner(b, b.into < 0 ? 'BONUS STAGE!' : '🍌 BONUS! 🍌', '#ffe135', '#5a3500', '#ffe135');
    }

    // Pulsing title at the top of the screen, plus a timer bar once the stage has started.
    function drawBanner(b, text, fill, outline, barColor) {
        const cx = view.w / 2;
        const y = Math.max(view.top + 62, 62);
        const pulse = 1 + 0.06 * Math.sin(run.clock * 8);
        ctx.save();
        ctx.translate(cx, y);
        ctx.scale(pulse, pulse);
        ctx.font = 'bold 44px Impact, "Arial Black", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 7;
        ctx.lineJoin = 'round'; // no spikes on the font's sharp corners
        ctx.strokeStyle = outline;
        ctx.fillStyle = fill;
        ctx.strokeText(text, 0, 0);
        ctx.fillText(text, 0, 0);
        ctx.restore();
        if (b.into >= 0) {
            const w = 220, h = 10, x = cx - w / 2, by = y + 32;
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fillRect(x - 2, by - 2, w + 4, h + 4);
            ctx.fillStyle = barColor;
            ctx.fillRect(x, by, w * b.q, h);
        }
    }

    // The gorilla in its equipped skin, with bob, jump tilt and power-up effects.
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
        const pw = run.pw;
        ctx.save();
        ctx.translate(CONFIG.PLAYER_X + size / 2, y + size / 2);
        ctx.rotate(tilt);
        if (pw && pw.blink > 0 && Math.floor(pw.blink * 14) % 2 === 0) ctx.globalAlpha = 0.35; // just lost the shield
        drawSprite(skinSprite(skin), -drawn / 2, def.feet * (size - drawn) - size / 2, drawn, '#333');
        ctx.globalAlpha = 1;
        if (pw && pw.shield) drawShieldBubble(size, run.clock);
        if (pw && pw.blink > SHIELD_BLINK - 0.3) drawShieldBurst(size, (SHIELD_BLINK - pw.blink) / 0.3);
        if (pw && pw.magnet > 0) drawMagnetField(size, run.clock);
        ctx.restore();
    }

    function drawShieldBubble(size, t) {
        const r = size * 0.62 + Math.sin(t * 6) * 2;
        const g = ctx.createRadialGradient(0, 0, r * 0.55, 0, 0, r);
        g.addColorStop(0, 'rgba(120,200,255,0)');
        g.addColorStop(1, 'rgba(120,200,255,0.45)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(200,235,255,0.9)';
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    // Expanding ring when the shield absorbs a hit (q goes 0 -> 1).
    function drawShieldBurst(size, q) {
        ctx.globalAlpha = 1 - q;
        ctx.strokeStyle = '#bfe6ff';
        ctx.lineWidth = 6 * (1 - q) + 1;
        ctx.beginPath();
        ctx.arc(0, 0, size * (0.62 + q * 0.6), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    // Faint pulsing rings reaching forward: bananas in range are being pulled in.
    function drawMagnetField(size, t) {
        ctx.strokeStyle = 'rgba(255,225,53,0.5)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
            const q = (t * 1.2 + i / 3) % 1;
            ctx.globalAlpha = 1 - q;
            ctx.beginPath();
            ctx.arc(size * 0.2, 0, size * (0.5 + q * 1.3), -0.7, 0.7);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    // Head start: white flash and speed streaks rushing past (q goes 1 -> 0).
    function drawWarp(q) {
        ctx.globalAlpha = q * q * 0.7;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, view.top, view.w, view.h);
        ctx.globalAlpha = q;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 22; i++) {
            const y = view.top + hash(i + 17) * view.h;
            const x = ((hash(i + 3) * view.w) - (1 - q) * view.w * 3) % view.w;
            const xx = x < 0 ? x + view.w : x;
            const len = 80 + hash(i + 9) * 220;
            ctx.moveTo(xx, y);
            ctx.lineTo(xx + len, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
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
            ctx.fillStyle = p.text === '+1' ? '#ffe135' : '#ff9d2e'; // doubled bananas stand out
            ctx.strokeText(p.text, p.x, p.y);
            ctx.fillText(p.text, p.x, p.y);
        }
        ctx.globalAlpha = 1;
    }

    // Red flash, darkening and the WASTED title after a hit.
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
            ctx.lineJoin = 'round';
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

    // Distances are counted in metres internally but always shown in miles (2 decimals).
    const METERS_PER_MILE = 1609.344;
    const milesFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    function miles(m) { return milesFormat.format(m / METERS_PER_MILE) + ' mi'; }
    const hud = { last: { bananas: -1, meters: -1 } };

    // Banana and distance counters; the DOM is only touched when a number changes.
    function updateHud() {
        const pw = run.pw;
        // During the head-start animation the distance counter spins up to the new distance.
        const m = pw && pw.warpFx > 0
            ? Math.round(lerp(meters(), pw.warpFrom, (pw.warpFx / WARP_FX) ** 2))
            : meters();
        updatePowerBar();
        if (m !== hud.last.meters) {
            hud.last.meters = m;
            const text = miles(m);
            if (dom.hudDistance.textContent !== text) dom.hudDistance.textContent = text;
        }
        if (run.bananas !== hud.last.bananas) { hud.last.bananas = run.bananas; dom.hudBananas.textContent = numberFormat.format(run.bananas); }
    }

    // =====================================================================
    // Flow: screens, start, pause, countdown, game over
    // =====================================================================

    const COUNTDOWN_TICK = 0.75; // seconds per countdown number
    let portraitAccepted = false;

    // Show one screen (menu, records, shop, game) and hide the others.
    function showScreen(name) {
        for (const key of Object.keys(dom.screens)) dom.screens[key].classList.toggle('active', key === name);
        document.body.classList.toggle('in-game', name === 'game');
        updateOrientationUI();
    }

    function setOverlay(el, visible) { el.classList.toggle('hidden', !visible); }

    function blurActive() {
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    }

    // Start (or restart) a run from the menu or the results screen.
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

    // Hand control to the player (after start or after the resume countdown).
    function beginPlaying() {
        run.state = 'playing';
        accumulator = 0;
        input.reset();
        setOverlay(dom.countdown, false);
        dom.pauseBtn.classList.remove('hidden');
        requestLoop();
    }

    // Pause the run (button, P/Esc, tab switch, rotating the phone...). `reason` says why.
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

    // Leave the pause with a 3-2-1 countdown.
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

    // Back to the main menu; an unfinished run still banks its bananas.
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

    // The run ends: save records, bank bananas and distance, note newly buyable skins.
    function die() {
        run.state = 'dying';
        run.dieTime = 0;
        input.reset();
        dom.pauseBtn.classList.add('hidden');
        setOverlay(dom.powerBar, false);
        if (navigator.vibrate) { try { navigator.vibrate(120); } catch { /* unsupported */ } }
        const before = purchasableIds();
        run.result = Records.finishRun(meters(), run.bananas);
        Progress.noteFinishedRun(meters());
        bankRun();
        run.result.newSkins = purchasableIds().filter((id) => !before.includes(id));
    }

    // Fill in and show the Run Over screen.
    function showResults() {
        run.state = 'gameover';
        needsRender = true;
        const r = run.result;
        const rec = Records.data;
        dom.resDistance.textContent = miles(r.distance);
        dom.resBananas.textContent = numberFormat.format(r.bananas);
        dom.resBestDistance.textContent = miles(rec.bestDistance);
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

    // Update the best-run line and the banana count on the Shop button.
    function refreshMenu() {
        const rec = Records.data;
        dom.menuBest.textContent = rec.bestDistance || rec.mostBananas
            ? 'Best ' + miles(rec.bestDistance) + '  ·  🍌 ' + numberFormat.format(rec.mostBananas)
            : '';
        dom.skinsBtnWallet.textContent = numberFormat.format(Progress.data.bananas);
    }

    // =====================================================================
    // Skins screen
    // =====================================================================

    let skinsPage = 0;
    let shopTab = 'skins'; // 'skins' | 'powerups'
    // Goal distances on Shop cards: short miles, no trailing zeros (0.75 mi, 1.5 mi, 3 mi).
    const goalFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
    const goalMi = (m) => goalFormat.format(m / METERS_PER_MILE);
    // Narrowest comfortable card and tallest a card may grow, in CSS pixels. The shortest card
    // is measured from a real card, so it always matches the current fonts and screen size.
    const CARD_MIN_W = 190, CARD_MAX_H = 140;

    function showSkins() {
        skinsPage = 0;
        showScreen('skins'); // visible first, so the grid can be measured
        renderSkins();
    }

    function setShopTab(tab) {
        if (tab === shopTab) return;
        shopTab = tab;
        skinsPage = 0;
        renderSkins();
    }

    function buildPowerCard(p) {
        const bank = Progress.data.bananas;
        const have = Progress.powerCount(p);
        const full = have >= POWER.max;

        const card = document.createElement('div');
        card.className = 'skin-card power-card';
        const thumb = document.createElement('div');
        thumb.className = 'skin-thumb power-thumb';
        thumb.textContent = p.icon;

        const info = document.createElement('div');
        info.className = 'skin-info';
        const name = document.createElement('div');
        name.className = 'skin-name';
        name.textContent = p.miles ? p.miles + ' mi start' : p.name;
        const desc = document.createElement('div');
        desc.className = 'skin-status';
        desc.textContent = p.info;
        const owned = document.createElement('div');
        owned.className = 'skin-status power-owned';
        owned.textContent = full ? 'Owned: ' + have + ' (max)' : 'Owned: ' + have + ' · key ' + p.key;
        info.append(name, desc, owned);

        const btn = document.createElement('button');
        btn.className = 'btn btn-small';
        btn.dataset.id = p.id;
        btn.dataset.kind = 'power';
        btn.textContent = full ? 'Max ' + POWER.max : '🍌 ' + numberFormat.format(p.price);
        btn.disabled = full || bank < p.price;
        if (!btn.disabled) btn.classList.add('btn-primary');
        info.appendChild(btn);
        card.append(thumb, info);
        return card;
    }

    // The first distance goal the player still has to reach, or null.
    function nextGoal(skin) {
        const p = Progress.goalProgress(skin);
        const since = p.fresh ? ' (runs since this skin was added)' : '';
        if (skin.either && skin.bestRun && skin.totalRun) {
            if (Progress.requirementsMet(skin)) return null;
            // Either goal unlocks it: show both, and fill the bar with whichever is closer.
            return {
                text: '🔒 ' + goalMi(skin.bestRun) + ' run/' + goalMi(skin.totalRun) + ' total',
                small: true,
                frac: Math.max(p.best / skin.bestRun, p.total / skin.totalRun),
                full: 'Run ' + goalMi(skin.bestRun) + ' mi in one run (best: ' + miles(p.best) +
                    '), or ' + goalMi(skin.totalRun) + ' mi in total (so far: ' + miles(p.total) + ')' + since
            };
        }
        if (skin.bestRun && p.best < skin.bestRun) {
            // "New run" when the player's all-time record already beats the goal.
            const label = p.fresh && Records.data.bestDistance >= skin.bestRun ? 'New run' : '1 run';
            return { label, have: p.best, need: skin.bestRun,
                full: 'Run ' + goalMi(skin.bestRun) + ' mi in one run' + since };
        }
        if (skin.totalRun && p.total < skin.totalRun) {
            return { label: 'Total', have: p.total, need: skin.totalRun,
                full: 'Run ' + goalMi(skin.totalRun) + ' mi in total' + since };
        }
        return null;
    }

    // One Shop card for a skin: thumbnail, name, status/goal and its button.
    function buildSkinCard(skin, goal) {
        const bank = Progress.data.bananas;
        const owned = Progress.owns(skin);
        const equipped = owned && Progress.data.selected === skin.id;

        const card = document.createElement('div');
        card.className = 'skin-card' + (equipped ? ' equipped' : '') + (goal ? ' locked' : '');

        const thumb = document.createElement('canvas');
        thumb.className = 'skin-thumb';
        thumb.width = thumb.height = 160;
        const sprite = skinSprite(skin);
        if (sprite) {
            const g = thumb.getContext('2d');
            if (goal) g.globalAlpha = 0.4;
            g.drawImage(sprite, 0, 0, 160, 160);
        }

        const info = document.createElement('div');
        info.className = 'skin-info';
        const name = document.createElement('div');
        name.className = 'skin-name';
        name.textContent = skin.name;
        const status = document.createElement('div');
        status.className = 'skin-status';
        info.append(name, status);

        const btn = document.createElement('button');
        btn.className = 'btn btn-small';
        btn.dataset.id = skin.id;
        if (equipped) {
            status.textContent = 'Equipped';
            btn.textContent = 'Equipped';
            btn.disabled = true;
        } else if (owned) {
            status.textContent = 'Owned';
            btn.textContent = 'Equip';
        } else {
            btn.textContent = '🍌 ' + numberFormat.format(skin.price);
            btn.disabled = !!goal || bank < skin.price;
            if (!btn.disabled) btn.classList.add('btn-primary');
            if (goal) {
                // Short form to fit the card (always miles); the card's tooltip has the full sentence.
                if (goal.small) status.classList.add('skin-status-small');
                status.textContent = goal.text || ('🔒 ' + goalMi(goal.have) + '/' + goalMi(goal.need) + ' ' +
                    (goal.label === 'Total' ? 'total' : goal.label === 'New run' ? 'new run' : 'run'));
                card.title = goal.full;
                const bar = document.createElement('div');
                bar.className = 'skin-bar';
                const fill = document.createElement('span');
                const frac = goal.frac !== undefined ? goal.frac : goal.have / goal.need;
                fill.style.width = Math.min(100, frac * 100).toFixed(1) + '%';
                bar.appendChild(fill);
                info.appendChild(bar);
            } else if (bank < skin.price) {
                status.textContent = 'Need ' + numberFormat.format(skin.price - bank) + ' more';
            } else {
                status.textContent = 'Ready to buy';
            }
        }
        info.appendChild(btn);
        card.append(thumb, info);
        return card;
    }

    // Pick columns/rows so every card fits on screen; extra cards go onto further pages.
    function layoutSkins(count) {
        const grid = dom.skinsGrid;
        const gap = parseFloat(getComputedStyle(grid).rowGap) || 10;

        // Measure the tallest kind of card on this tab (a locked skin with a progress bar, or
        // a power-up) at its natural height.
        grid.textContent = '';
        grid.style.setProperty('--cols', 1);
        grid.style.setProperty('--rows', 1);
        grid.style.setProperty('--row-h', 'auto');
        grid.style.setProperty('--thumb', '40px');
        const probe = shopTab === 'skins'
            ? buildSkinCard({ id: '__probe', name: 'Probe', price: 1, image: SKINS[0].image },
                { label: 'Total', have: 1, need: 2, full: '' })
            : buildPowerCard(POWER.list[0]);
        grid.appendChild(probe);
        const minH = Math.ceil(probe.offsetHeight);
        grid.textContent = '';

        const w = grid.clientWidth, h = grid.clientHeight;
        const maxCols = Math.max(1, Math.floor((w + gap) / (CARD_MIN_W + gap)));
        const maxRows = Math.max(1, Math.floor((h + gap) / (minH + gap)));
        const perPage = maxCols * maxRows;
        const pages = Math.max(1, Math.ceil(count / perPage));
        const onPage = Math.min(count, perPage);
        const rows = Math.min(maxRows, Math.ceil(onPage / maxCols));
        const cols = Math.ceil(onPage / rows); // balance the rows (e.g. 4 + 4 rather than 5 + 3)
        const rowH = Math.max(minH, Math.min(CARD_MAX_H, (h - gap * (rows - 1)) / rows));
        grid.style.setProperty('--cols', cols);
        grid.style.setProperty('--rows', rows);
        grid.style.setProperty('--row-h', Math.floor(rowH) + 'px');
        // Thumbnail: as tall as the card allows, but never more than ~40% of its width.
        const cardW = (w - gap * (cols - 1)) / cols;
        grid.style.setProperty('--thumb', Math.floor(Math.min(rowH - 10, cardW * 0.4)) + 'px');
        return { perPage, pages };
    }

    // Draw the current Shop tab and page, sized so every card fits without scrolling.
    function renderSkins() {
        dom.skinsWallet.textContent = numberFormat.format(Progress.data.bananas);
        for (const tab of dom.shopTabs) {
            const on = tab.dataset.tab === shopTab;
            tab.classList.toggle('active', on);
            tab.setAttribute('aria-selected', String(on));
        }
        const items = shopTab === 'skins' ? SKINS : POWER.list;
        let { perPage, pages } = layoutSkins(items.length);
        if (pages > 1 !== !dom.skinsPager.classList.contains('hidden')) {
            // Showing/hiding the pager can change the header height (it wraps on narrow
            // screens), so lay out again with the pager in its final state.
            setOverlay(dom.skinsPager, pages > 1);
            ({ perPage, pages } = layoutSkins(items.length));
            setOverlay(dom.skinsPager, pages > 1);
        }
        skinsPage = clamp(skinsPage, 0, pages - 1);
        dom.skinsPageText.textContent = (skinsPage + 1) + '/' + pages;
        dom.skinsPrev.disabled = skinsPage === 0;
        dom.skinsNext.disabled = skinsPage === pages - 1;
        for (const item of items.slice(skinsPage * perPage, (skinsPage + 1) * perPage)) {
            dom.skinsGrid.appendChild(shopTab === 'skins'
                ? buildSkinCard(item, Progress.owns(item) ? null : nextGoal(item))
                : buildPowerCard(item));
        }
    }

    // Shop button clicks: buy or equip a skin, or buy a power-up.
    function onSkinButton(e) {
        const btn = e.target.closest('button[data-id]');
        if (!btn || btn.disabled) return;
        if (btn.dataset.kind === 'power') {
            const p = POWER.list.find((q) => q.id === btn.dataset.id);
            if (p) Progress.buyPower(p);
            renderSkins();
            return;
        }
        const skin = skinById(btn.dataset.id);
        if (!skin) return;
        if (Progress.owns(skin)) Progress.select(skin);
        else Progress.buy(skin);
        renderSkins();
    }

    // Fill in and show the Records screen.
    function showRecords() {
        const rec = Records.data;
        dom.recBestDistance.textContent = miles(rec.bestDistance);
        dom.recMostBananas.textContent = numberFormat.format(rec.mostBananas);
        fillBoard(dom.recDistanceList, rec.distanceBoard, miles);
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

    // Wire up every menu / overlay button.
    function setupButtons() {
        dom.startBtn.addEventListener('click', startGame);
        dom.recordsBtn.addEventListener('click', showRecords);
        dom.recordsBackBtn.addEventListener('click', () => { refreshMenu(); showScreen('menu'); });
        dom.skinsBtn.addEventListener('click', showSkins);
        dom.skinsBackBtn.addEventListener('click', () => { refreshMenu(); showScreen('menu'); });
        dom.skinsGrid.addEventListener('click', onSkinButton);
        dom.skinsPrev.addEventListener('click', () => { skinsPage--; renderSkins(); });
        for (const tab of dom.shopTabs) tab.addEventListener('click', () => setShopTab(tab.dataset.tab));
        dom.powerBar.addEventListener('pointerdown', (e) => e.stopPropagation());
        dom.powerBar.addEventListener('click', (e) => { onPowerButton(e); blurActive(); });
        dom.skinsNext.addEventListener('click', () => { skinsPage++; renderSkins(); });
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

    // Phones in portrait during a run: pause behind the rotate prompt.
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
    // Install (Add to Home Screen)
    // =====================================================================

    // Chrome, Edge and Samsung Internet (Android and desktop) offer an install prompt, which
    // the Install button opens directly. iPhone/iPad have no prompt, so the button shows a
    // step-by-step guide instead (as it also does on Android browsers without a prompt).
    const Install = (function () {
        const ua = navigator.userAgent || '';
        const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const isAndroid = /Android/i.test(ua);
        // Checked once at start-up, before the game asks for fullscreen (which would also
        // match "display-mode: fullscreen").
        let installed = false;
        let prompt = null;   // the browser's install prompt, when it offers one
        let toastTimer = 0;

        function runningAsApp() {
            const mm = (q) => window.matchMedia && window.matchMedia(q).matches;
            return mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)') || navigator.standalone === true;
        }

        function update() {
            setOverlay(dom.installBtn, !installed && (!!prompt || isIOS || isAndroid));
        }

        async function onClick() {
            if (prompt) {
                const p = prompt;
                prompt = null; // a prompt can only be shown once
                try {
                    await p.prompt();
                    const choice = await p.userChoice;
                    if (choice && choice.outcome === 'accepted') installed = true;
                } catch { /* prompt unavailable */ }
                update();
                return;
            }
            openGuide(isAndroid ? 'android' : 'ios');
        }

        function openGuide(os) {
            showTab(os);
            setOverlay(dom.installOverlay, true);
            dom.installCloseBtn.focus();
        }

        function closeGuide() {
            setOverlay(dom.installOverlay, false);
            dom.installBtn.focus();
        }

        function showTab(os) {
            for (const tab of dom.installTabs) {
                const on = tab.dataset.os === os;
                tab.classList.toggle('active', on);
                tab.setAttribute('aria-selected', String(on));
            }
            for (const el of dom.installOverlay.querySelectorAll('.install-steps, .install-note')) {
                el.classList.toggle('hidden', el.dataset.os !== os);
            }
        }

        function toast(text) {
            dom.installToast.textContent = text;
            setOverlay(dom.installToast, true);
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => setOverlay(dom.installToast, false), 3500);
        }

        function init() {
            installed = runningAsApp();
            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault(); // use our button instead of the browser's own banner
                prompt = e;
                update();
            });
            window.addEventListener('appinstalled', () => {
                installed = true;
                prompt = null;
                update();
                toast('HaRUNbe was added to your home screen!');
            });
            dom.installBtn.addEventListener('click', onClick);
            dom.installCloseBtn.addEventListener('click', closeGuide);
            dom.installOverlay.addEventListener('click', (e) => { if (e.target === dom.installOverlay) closeGuide(); });
            for (const tab of dom.installTabs) tab.addEventListener('click', () => showTab(tab.dataset.os));
            window.addEventListener('keydown', (e) => {
                if (e.code === 'Escape' && !dom.installOverlay.classList.contains('hidden')) closeGuide();
            });
            update();
        }

        return { init };
    })();

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
        Install.init();
        registerServiceWorker();
        resize();
        resetClouds();
        loadAssets().then(() => {
            assetsReady = true;
            // Then fetch the other skins quietly; refresh the Shop if it's open.
            loadRestOfSkins().then(() => {
                if (dom.screens.skins.classList.contains('active')) renderSkins();
            });
            dom.startBtn.disabled = false;
            dom.startBtn.textContent = 'Start';
        });
        if (/[?&]debug\b/.test(location.search)) {
            window.HaRUNbeDebug = { run, view, sky, input, records: () => Records.data, progress: () => Progress.data };
        }
    }

    boot();
})();
