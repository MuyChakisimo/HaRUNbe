/*
 * End-to-end browser tests for HaRUNbe (optional developer tool).
 *
 *   python3 -m http.server 8123        (from the project root)
 *   node tools/browser-test.js          (needs the "playwright" package)
 *
 * requestAnimationFrame is replaced by a fake clock so the real game loop can be driven at
 * any refresh rate deterministically.
 */
'use strict';
const { chromium } = require('playwright');
const PAGE_URL = process.env.HARUNBE_URL || 'http://localhost:8123/index.html?debug';

let failures = 0;
function check(cond, msg) {
    console.log((cond ? '  ok   ' : '  FAIL ') + msg);
    if (!cond) failures++;
}

const FAKE_CLOCK = () => {
    const callbacks = new Map();
    let nextId = 1;
    let now = 1000;
    window.requestAnimationFrame = (cb) => { const id = nextId++; callbacks.set(id, cb); return id; };
    window.cancelAnimationFrame = (id) => { callbacks.delete(id); };
    window.__tick = (frames, hz) => {
        for (let i = 0; i < frames; i++) {
            now += 1000 / hz;
            const cbs = [...callbacks.values()];
            callbacks.clear();
            for (const cb of cbs) cb(now);
        }
    };
    window.__key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code === 'Space' ? ' ' : code, bubbles: true }));
    // Autopilot: clears every cluster using the engine's own fairness solver.
    window.__bot = (seconds, hz) => {
        const D = window.HaRUNbeDebug, E = window.HarunbeEngine, run = D.run;
        const { PHX0 } = E.PLAYER_HITBOX;
        let plan = null, releaseAt = -1, t = 0, maxNight = 0, sawMoon = false, sawDusk = 0;
        const frames = Math.round(seconds * hz);
        for (let f = 0; f < frames && run.state === 'playing'; f++) {
            if (!plan && run.player.onGround) {
                const obs = run.entities.filter((e) => e.type !== 'banana' && e.hit.x1 > run.trackPos + PHX0)
                    .sort((a, b) => a.hit.x0 - b.hit.x0);
                if (obs.length) {
                    const cluster = [obs[0]];
                    for (let i = 1; i < obs.length && obs[i].hit.x0 - cluster[cluster.length - 1].hit.x1 < 300; i++) cluster.push(obs[i]);
                    const w = E.bestWindow(cluster.map((e) => e.hit), run.speed);
                    const end = Math.max(...cluster.map((e) => e.hit.x1));
                    plan = { end, press: w && w.traj ? (w.pxStart + w.pxEnd) / 2 : null, hold: w && w.traj ? w.traj.hold : 0, done: false };
                }
            }
            if (plan && plan.press !== null && !plan.done && run.trackPos >= plan.press - run.speed / hz / 2) {
                window.__key('keydown', 'Space');
                plan.done = true;
                releaseAt = t + plan.hold;
            }
            if (releaseAt >= 0 && t >= releaseAt) { window.__key('keyup', 'Space'); releaseAt = -1; }
            if (plan && run.trackPos > plan.end && run.player.onGround && releaseAt < 0) plan = null;
            window.__tick(1, hz);
            t += 1 / hz;
            maxNight = Math.max(maxNight, D.sky.night);
            sawDusk = Math.max(sawDusk, D.sky.dusk);
            if (D.sky.phase > 0.55 && D.sky.phase < 0.95) sawMoon = true;
        }
        return { state: run.state, meters: Math.floor(run.distance / 50), speed: run.speed, bananas: run.bananas, maxNight, sawMoon, sawDusk, t };
    };
};

(async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2 });
    await context.addInitScript(FAKE_CLOCK);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(PAGE_URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('start-btn').disabled);
    const state = () => page.evaluate(() => window.HaRUNbeDebug.run.state);
    const start = async () => {
        await page.evaluate(() => { const r = window.HaRUNbeDebug.run; if (r.state !== 'menu' && r.state !== 'gameover') { r.state = 'gameover'; } });
        await page.evaluate(() => document.getElementById(window.HaRUNbeDebug.run.state === 'menu' ? 'start-btn' : 'restart-btn').click());
    };

    console.log('Refresh-rate independence (5 s of running, no input):');
    const dist = {};
    for (const hz of [60, 90, 120, 144]) {
        await start();
        // Disable enemies for this measurement.
        dist[hz] = await page.evaluate((hz) => {
            const r = window.HaRUNbeDebug.run;
            r.entities.length = 0; r.gen.cursor = 1e12;
            window.__tick(hz * 5, hz);
            return { d: r.distance, cycle: r.cycleTime };
        }, hz);
    }
    // Frames never land exactly on the same simulated time, so compare distance per simulated time.
    const ref = dist[60];
    console.log('  distance/time:', Object.entries(dist).map(([h, v]) => `${h}Hz=${v.d.toFixed(1)}u/${v.cycle.toFixed(3)}s`).join(' '));
    const drift = Math.max(...Object.values(dist).map((v) => Math.abs((v.d - ref.d) - 420 * (v.cycle - ref.cycle))));
    check(drift < 1, `distance for the same simulated time matches across 60/90/120/144 Hz (max drift ${drift.toFixed(3)} units)`);

    console.log('Variable jump (tap vs hold) at each refresh rate:');
    for (const hz of [60, 144]) {
        const res = {};
        for (const holdMs of [0, 100, 400]) {
            await start();
            res[holdMs] = await page.evaluate(({ hz, holdMs }) => {
                const r = window.HaRUNbeDebug.run;
                r.entities.length = 0; r.gen.cursor = 1e12;
                window.__tick(5, hz);
                window.__key('keydown', 'Space');
                if (holdMs === 0) window.__key('keyup', 'Space');
                let apex = 0, t = 0, released = holdMs === 0;
                for (let f = 0; f < hz * 2; f++) {
                    window.__tick(1, hz); t += 1000 / hz;
                    if (!released && t >= holdMs) { window.__key('keyup', 'Space'); released = true; }
                    apex = Math.max(apex, r.player.alt);
                }
                return apex;
            }, { hz, holdMs });
        }
        console.log(`  ${hz}Hz apex: tap ${res[0].toFixed(0)}, hold100 ${res[100].toFixed(0)}, hold400 ${res[400].toFixed(0)}`);
        check(res[0] > 100 && res[0] < res[100] && res[100] < res[400] && res[400] < 245, `${hz}Hz: tap < short hold < long hold, capped`);
    }

    console.log('Holding Space forever does not fly or re-jump:');
    await start();
    const holdForever = await page.evaluate(() => {
        const r = window.HaRUNbeDebug.run;
        r.entities.length = 0; r.gen.cursor = 1e12;
        window.__key('keydown', 'Space');
        let apex = 0;
        for (let f = 0; f < 60 * 4; f++) {
            window.__tick(1, 60);
            apex = Math.max(apex, r.player.alt);
        }
        window.__key('keyup', 'Space');
        return { apex, onGround: r.player.onGround };
    });
    check(holdForever.apex < 245, `apex while holding stays capped (${holdForever.apex.toFixed(0)})`);

    console.log('Pause / countdown freeze the simulation:');
    await start();
    const pauseRes = await page.evaluate(() => {
        const D = window.HaRUNbeDebug, r = D.run;
        r.entities.length = 0; r.gen.cursor = 1e12;
        window.__tick(60, 60);
        window.__key('keydown', 'Space');           // jump, then pause mid-air while holding
        window.__tick(6, 60);
        window.__key('keydown', 'KeyP');
        const d0 = r.distance, alt0 = r.player.alt, c0 = r.cycleTime, held0 = D.input.held;
        window.__tick(300, 60);
        const pausedOk = r.state === 'paused' && r.distance === d0 && r.player.alt === alt0 && r.cycleTime === c0;
        document.getElementById('resume-btn').click();
        const s1 = r.state;
        window.__tick(60, 60);
        const duringCountdown = r.distance === d0 && r.state === 'countdown';
        window.__tick(120, 60);
        window.__key('keyup', 'Space');
        return { pausedOk, held0, s1, duringCountdown, after: r.state, moved: r.distance > d0 };
    });
    check(pauseRes.pausedOk, 'distance, jump and day/night frozen while paused');
    check(pauseRes.held0 === false, 'held jump input is released on pause');
    check(pauseRes.s1 === 'countdown' && pauseRes.duringCountdown, 'resume starts a countdown that does not advance the game');
    check(pauseRes.after === 'playing' && pauseRes.moved, 'game continues after the countdown');

    console.log('Tab hidden / window blur auto-pause:');
    const hidden = await page.evaluate(() => {
        const r = window.HaRUNbeDebug.run;
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        const s = r.state;
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.getElementById('resume-btn').click();
        window.__tick(200, 60);
        window.dispatchEvent(new Event('blur'));
        return { s, s2: r.state };
    });
    check(hidden.s === 'paused' && hidden.s2 === 'paused', 'visibility change and blur pause the run');

    console.log('Pointer input and cancellation:');
    await page.evaluate(() => document.getElementById('resume-btn').click());
    await page.evaluate(() => window.__tick(200, 60));
    const ptr = await page.evaluate(() => {
        const D = window.HaRUNbeDebug, c = document.getElementById('game-canvas');
        c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, bubbles: true, pointerType: 'touch', isPrimary: true }));
        const heldDown = D.input.held;
        window.__tick(2, 60);
        const jumped = !D.run.player.onGround;
        c.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7, bubbles: true, pointerType: 'touch' }));
        return { heldDown, jumped, heldAfter: D.input.held };
    });
    check(ptr.heldDown && ptr.jumped, 'touch press starts a jump');
    check(ptr.heldAfter === false, 'pointercancel releases the held jump');
    const pauseBtn = await page.evaluate(() => {
        const D = window.HaRUNbeDebug;
        window.__tick(120, 60);
        const b = document.getElementById('pause-btn');
        b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, bubbles: true }));
        b.click();
        return { state: D.run.state, air: !D.run.player.onGround };
    });
    check(pauseBtn.state === 'paused' && !pauseBtn.air, 'pause button pauses without jumping');

    console.log('Resize mid-run keeps the world consistent:');
    await page.setViewportSize({ width: 600, height: 900 });
    await page.evaluate(() => window.__tick(2, 60));
    const rz = await page.evaluate(() => { const D = window.HaRUNbeDebug; return { alt: D.run.player.alt, viewH: D.view.h, viewW: D.view.w }; });
    check(rz.alt >= 0 && rz.viewW >= 759, `portrait-shaped window: world width ${rz.viewW.toFixed(0)} >= 760, player alt ${rz.alt.toFixed(0)}`);
    if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/portrait-desktop.png' });
    await page.setViewportSize({ width: 915, height: 412 });
    await page.evaluate(() => window.__tick(2, 60));

    console.log('Long autopilot runs (the bot uses the fairness solver):');
    for (const hz of [60, 144]) {
        await page.evaluate(() => window.HaRUNbeDebug && (window.HaRUNbeDebug.run.state = 'gameover'));
        await page.evaluate(() => document.getElementById('restart-btn').click());
        const res = await page.evaluate((hz) => window.__bot(300, hz), hz);
        console.log(`  ${hz}Hz: ${JSON.stringify(res)}`);
        check(res.state === 'playing', `${hz}Hz: survived 5 simulated minutes (${res.meters} m)`);
        check(res.maxNight > 0.99 && res.sawMoon && res.sawDusk > 0.9, `${hz}Hz: went through dusk, full night and moon`);
        check(res.speed > 600 && res.speed <= 820, `${hz}Hz: difficulty ramped (speed ${res.speed.toFixed(0)})`);
        if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/bot-${hz}.png` });
    }

    console.log('Game over, records, restart:');
    const go = await page.evaluate(() => {
        const D = window.HaRUNbeDebug, r = D.run, E = window.HarunbeEngine;
        r.entities.push(E.makeTiger(r.trackPos + 150));
        window.__tick(120, 60);
        return { state: r.state, meters: Math.floor(r.distance / 50), bananas: r.bananas };
    });
    check(go.state === 'gameover', 'colliding with a tiger ends the run');
    const results = await page.evaluate(() => ({
        dist: document.getElementById('res-distance').textContent,
        bananas: document.getElementById('res-bananas').textContent,
        records: window.HaRUNbeDebug.records()
    }));
    check(results.records.bestDistance === go.meters && results.records.mostBananas === go.bananas, `records saved: ${results.dist}, ${results.bananas} bananas`);
    await page.fill('#name-input', 'Koko');
    await page.click('#restart-btn');
    const rs = await page.evaluate(() => ({ s: window.HaRUNbeDebug.run.state, d: window.HaRUNbeDebug.run.distance, b: window.HaRUNbeDebug.run.bananas, board: window.HaRUNbeDebug.records().distanceBoard }));
    check(rs.s === 'playing' && rs.d === 0 && rs.b === 0, 'restart resets the run without reloading');
    check(rs.board[0] && rs.board[0].name === 'Koko', 'leaderboard name saved when restarting');
    await page.evaluate(() => { document.getElementById('restart-btn').click(); document.getElementById('restart-btn').click(); });
    check((await state()) === 'playing', 'rapid restart clicks are harmless');

    await page.reload();
    await page.waitForFunction(() => !document.getElementById('start-btn').disabled);
    const persisted = await page.evaluate(() => window.HaRUNbeDebug.records());
    check(persisted.bestDistance === go.meters && persisted.distanceBoard.length === 1, 'records survive a reload');

    console.log('Legacy save migration:');
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('haRUNbeHighScores', JSON.stringify([{ name: 'Old', score: 42 }, { name: 'Older', score: 7 }])); });
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('start-btn').disabled);
    const mig = await page.evaluate(() => window.HaRUNbeDebug.records());
    check(mig.mostBananas === 42 && mig.bananaBoard.length === 2 && mig.bestDistance === 0, 'old banana scores become the banana records');
    await page.evaluate(() => localStorage.setItem('harunbe.records.v2', '{corrupt'));
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('start-btn').disabled);
    check((await page.evaluate(() => typeof window.HaRUNbeDebug.records().bestDistance)) === 'number', 'corrupt storage falls back safely');

    check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    await browser.close();
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll browser checks passed.');
    process.exit(failures ? 1 : 0);
})();
