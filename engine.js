/*
 * HaRUNbe simulation engine.
 *
 * Pure game logic with no DOM access: configuration, player physics, difficulty,
 * world generation, fairness checking and collision. game.js drives it from the
 * browser; tools/fairness-test.js drives it from Node to verify fairness.
 *
 * Coordinate system ("world units"):
 *   - The playfield is a 540-unit-tall band. The ground surface is at y = GROUND_Y.
 *   - y grows downward (like canvas). Player/obstacle heights use "alt" = units above ground.
 *   - x is a "track" coordinate: entities never move; the camera (trackPos) scrolls right.
 *     An entity's on-screen x is entity.x - trackPos.
 */
(function (root) {
    'use strict';

    const CONFIG = {
        VERSION: '3.6.0',

        WORLD_H: 540,          // height of the gameplay band that is always visible
        MIN_VIEW_W: 760,       // narrowest world width shown (portrait letterboxes vertically)
        GROUND_Y: 440,         // ground surface
        PLAYER_X: 150,         // gorilla's sprite left edge, relative to the camera
        UNITS_PER_METER: 50,

        STEP: 1 / 240,         // fixed simulation step (seconds)
        MAX_FRAME: 1 / 15,     // longest frame we simulate; anything longer is dropped

        physics: {
            gravity: 2600,     // units/s^2
            holdGravity: 700,  // gravity while the jump input is held during the rise
            jumpVelocity: 760, // initial upward velocity (units/s)
            maxHold: 0.26,     // seconds the hold can extend the rise
            jumpBuffer: 0.10   // a press this long before landing still jumps on landing
        },

        speed: {
            start: 440,        // units/s at 0 m  (~8.8 m/s)
            max: 860,          // hard cap        (~17.2 m/s)
            rampMeters: 1600   // speed (and difficulty) approaches the cap exponentially over distance
        },

        // How crowded the run gets. A gap is never shorter than minGap() (so the next cluster is
        // always fair), plus random "slack" that shrinks as the run gets harder. Less slack =
        // enemies arrive more often. Big multi-enemy patterns also become more common (see
        // `lateWeight` in PATTERNS). tools/density-report.js prints the resulting enemies/second.
        spawn: {
            rampMeters: 1000,    // crowding ramps up over this distance (faster than speed does)
            slackStart: 0.7,     // seconds of extra random spacing at the start of a run
            slackEnd: 0,         // ... and far into a run
            breatherStart: 0.12, // chance of an extra-long relaxing gap at the start
            breatherEnd: 0.02,   // ... and far into a run
            breatherSeconds: 0.9 // how much longer a breather gap is
        },

        cycle: {
            seconds: 120,      // one full day + night
            start: 0.07        // phase at run start (morning: sun already clear of the jungle)
        },

        fairness: {
            minWindow: 0.07,        // an obstacle must be clearable with >= 70 ms of timing slack
            minBananaWindow: 0.05,  // a banana must be collectable with >= 50 ms of slack
            reaction: 0.24,         // seconds on the ground after landing before the next obstacle
            pressStep: 1 / 240      // resolution of the timing search
        },

        aheadUnits: 2200,      // world is generated this far past the right edge of the view
        cullUnits: 240         // entities this far behind the camera are removed
    };

    // Sprite geometry, measured from the artwork's alpha channel (fractions of the drawn size).
    //   feet: fraction of the image height where the character touches the ground
    //   hit:  [left, top, right, bottom] gameplay hitbox, deliberately inside the visible art
    const SPRITES = {
        gorilla: { size: 104, feet: 0.943, hit: [0.22, 0.17, 0.78, 0.92] },
        tiger:   { size: 92,  feet: 0.826, hit: [0.15, 0.30, 0.88, 0.80] },
        hawk:    { size: 84,  feet: 0,     hit: [0.12, 0.32, 0.84, 0.76] },
        banana:  { size: 54,  feet: 0,     hit: [0.10, 0.04, 0.90, 0.96] }
    };

    const G = CONFIG.GROUND_Y;
    const GOR = SPRITES.gorilla;
    // Player hitbox offsets relative to trackPos, and relative to altitude.
    const PHX0 = CONFIG.PLAYER_X + GOR.hit[0] * GOR.size;
    const PHX1 = CONFIG.PLAYER_X + GOR.hit[2] * GOR.size;
    const PH_TOP = (GOR.feet - GOR.hit[1]) * GOR.size;     // altitude of hitbox top when alt = 0
    const PH_BOTTOM = (GOR.feet - GOR.hit[3]) * GOR.size;  // altitude of hitbox bottom when alt = 0

    // ---------------------------------------------------------------- utilities

    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
    function lerp(a, b, t) { return a + (b - a) * t; }

    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // ---------------------------------------------------------------- difficulty

    // 0 at the start, approaching 1 far into a run. Driven by distance, never by frame rate.
    function difficultyFor(distanceUnits) {
        const meters = Math.max(0, distanceUnits) / CONFIG.UNITS_PER_METER;
        return 1 - Math.exp(-meters / CONFIG.speed.rampMeters);
    }

    function speedFor(distanceUnits) {
        return lerp(CONFIG.speed.start, CONFIG.speed.max, difficultyFor(distanceUnits));
    }

    // Same shape as difficultyFor, on the spawn ramp: how crowded the world is.
    function crowdingFor(distanceUnits) {
        const meters = Math.max(0, distanceUnits) / CONFIG.UNITS_PER_METER;
        return 1 - Math.exp(-meters / CONFIG.spawn.rampMeters);
    }

    // ---------------------------------------------------------------- player physics

    function createPlayer() {
        return { alt: 0, vy: 0, onGround: true, holding: false, holdTime: 0, jumpBuffer: 0 };
    }

    // Request a jump. It happens on the next step if grounded, or on landing if the press
    // was within the buffer window. There is no air jump.
    function pressJump(p) {
        p.jumpBuffer = CONFIG.physics.jumpBuffer;
    }

    // Variable-height jump: while the input stays held during the rise (up to maxHold),
    // gravity is reduced. Releasing, running out of hold time, or reaching the apex restores
    // full gravity, so height is bounded and there is no way to fly.
    function stepPlayer(p, held, dt) {
        const P = CONFIG.physics;
        if (p.jumpBuffer > 0) {
            if (p.onGround) {
                p.vy = P.jumpVelocity;
                p.onGround = false;
                p.holding = true;
                p.holdTime = 0;
                p.jumpBuffer = 0;
            } else {
                p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);
            }
        }
        if (p.onGround) return;

        if (p.holding && (!held || p.holdTime >= P.maxHold || p.vy <= 0)) p.holding = false;
        let g = P.gravity;
        if (p.holding) {
            g = P.holdGravity;
            p.holdTime += dt;
        }
        p.vy -= g * dt;
        p.alt += p.vy * dt;
        if (p.alt <= 0) {
            p.alt = 0;
            p.vy = 0;
            p.onGround = true;
            p.holding = false;
        }
    }

    // ---------------------------------------------------------------- hitboxes

    function makeBox() { return { x0: 0, x1: 0, y0: 0, y1: 0 }; }

    function playerBox(alt, trackPos, out) {
        out.x0 = trackPos + PHX0;
        out.x1 = trackPos + PHX1;
        out.y0 = G - alt - PH_TOP;
        out.y1 = G - alt - PH_BOTTOM;
        return out;
    }

    function overlaps(a, b) {
        return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
    }

    // Entities live in track space. `top` is the sprite's top y; `hit` is its hitbox.
    // A moving enemy's `hit` also carries `mv` (its motion) and sy0/sy1: the full vertical
    // range it sweeps through, used to keep bananas clear of it.
    function makeEntity(type, x, top) {
        const def = SPRITES[type];
        const s = def.size;
        const y0 = top + def.hit[1] * s, y1 = top + def.hit[3] * s;
        return {
            type,
            x,
            top,
            size: s,
            phase: Math.random() * Math.PI * 2, // cosmetic animation offset
            hit: { x0: x + def.hit[0] * s, x1: x + def.hit[2] * s, y0, y1, sy0: y0, sy1: y1, mv: null }
        };
    }

    // ---------------------------------------------------------------- moving enemies

    /*
     * A moving enemy's motion is keyed to `dd`, the distance from the front of the player's
     * hitbox to the front of the enemy's hitbox (track units; 0 = touching). It never depends
     * on the clock, so a given enemy always does exactly the same thing as the player
     * approaches, and the fairness checker can replay it precisely. Returns the vertical
     * offset of the enemy from its base position (negative = up).
     *
     *   hop:    bounces in a steady rhythm            { h, period, phase }
     *   pounce: crouches, then leaps once when close   { h, start, span }
     *   glide:  moves from one height to another       { shift, far, near }
     */
    function motionOffset(mv, dd) {
        if (mv.kind === 'hop') return -mv.h * Math.abs(Math.sin(Math.PI * dd / mv.period + mv.phase));
        if (mv.kind === 'pounce') {
            const u = (mv.start - dd) / mv.span;
            return u > 0 && u < 1 ? -mv.h * 4 * u * (1 - u) : 0;
        }
        if (mv.kind === 'glide') {
            const t = clamp((mv.far - dd) / (mv.far - mv.near), 0, 1);
            return mv.shift * t * t * (3 - 2 * t);
        }
        return 0;
    }

    function obstacleOffset(ob, trackPos) {
        return ob.mv ? motionOffset(ob.mv, ob.x0 - (trackPos + PHX1)) : 0;
    }

    // The obstacle's hitbox where it is when the camera is at `trackPos`.
    function obstacleBox(ob, trackPos, out) {
        const o = obstacleOffset(ob, trackPos);
        out.x0 = ob.x0; out.x1 = ob.x1;
        out.y0 = ob.y0 + o; out.y1 = ob.y1 + o;
        return out;
    }

    function setMotion(e, mv, sweepUp, sweepDown) {
        e.hit.mv = mv;
        e.hit.sy0 = e.hit.y0 - sweepUp;
        e.hit.sy1 = e.hit.y1 + sweepDown;
        return e;
    }

    // Tiger that bounces up to `h` units, once every `period` track units.
    function makeHopper(x, h, period, phase) {
        return setMotion(makeTiger(x), { kind: 'hop', h, period, phase }, h, 0);
    }

    // Crouching tiger that leaps `h` units high, starting when the player is `start` units away.
    function makePouncer(x, h, start, span) {
        return setMotion(makeTiger(x), { kind: 'pounce', h, start, span }, h, 0);
    }

    // Hawk that glides from `altFar` to `altNear` (hitbox-bottom altitudes) as the player
    // approaches. The move starts ~1 s away and finishes ~0.45 s away, while on screen.
    function makeGlider(x, altFar, altNear, s) {
        const far = Math.min(s * 1.0, 520);
        const near = Math.min(s * 0.45, 340);
        const shift = altFar - altNear; // + = moves down
        return setMotion(makeHawk(x, altFar), { kind: 'glide', shift, far, near },
            Math.max(0, -shift), Math.max(0, shift));
    }

    function makeTiger(x) {
        const d = SPRITES.tiger;
        return makeEntity('tiger', x, G - d.feet * d.size);
    }

    // `hitAlt` = altitude of the hawk's hitbox bottom above the ground.
    function makeHawk(x, hitAlt) {
        const d = SPRITES.hawk;
        return makeEntity('hawk', x, G - hitAlt - d.hit[3] * d.size);
    }

    // `alt` = altitude of the banana's centre above the ground.
    function makeBanana(cx, alt) {
        const d = SPRITES.banana;
        return makeEntity('banana', cx - d.size / 2, G - alt - d.size / 2);
    }

    // ---------------------------------------------------------------- jump trajectories

    // Every jump the game can produce is one of these (a press followed by holding for
    // k steps). They are precomputed with the exact same stepPlayer used in play, so the
    // fairness checker reasons about the real physics.
    const HOLD_STEPS = Math.ceil(CONFIG.physics.maxHold / CONFIG.STEP) + 1;
    const TRAJECTORIES = (function build() {
        const out = [];
        const ks = [];
        for (let k = 0; k < HOLD_STEPS; k += 6) ks.push(k);
        ks.push(HOLD_STEPS);
        for (const k of ks) {
            const p = createPlayer();
            pressJump(p);
            const alts = [];
            let i = 0;
            do {
                stepPlayer(p, i < k, CONFIG.STEP);
                alts.push(p.alt);
                i++;
            } while (!p.onGround && i < 2000);
            let apex = 0;
            for (const a of alts) apex = Math.max(apex, a);
            out.push({ hold: k * CONFIG.STEP, alts: Float32Array.from(alts), steps: alts.length, apex });
        }
        return out;
    })();
    const MAX_AIR = TRAJECTORIES[TRAJECTORIES.length - 1].steps * CONFIG.STEP;
    const MIN_APEX = TRAJECTORIES[0].apex;
    const MAX_APEX = TRAJECTORIES[TRAJECTORIES.length - 1].apex;

    // ---------------------------------------------------------------- fairness checker

    function standsIn(ob) {
        // Does the obstacle's hitbox intersect the standing player's vertical span?
        return ob.y1 > G - PH_TOP && ob.y0 < G - PH_BOTTOM;
    }

    const scratchBox = makeBox();
    const scratchOb = makeBox();

    // Does a player running on the ground, while the camera moves from ta to tb, touch `ob`?
    // Moving obstacles are checked step by step (every `dx` track units).
    function groundHits(ob, ta, tb, dx) {
        if (!ob.mv) return standsIn(ob) && ob.x0 < tb + PHX1 && ob.x1 > ta + PHX0;
        const lo = Math.max(ta, ob.x0 - PHX1), hi = Math.min(tb, ob.x1 - PHX0);
        if (lo > hi) return false;
        const n = Math.max(1, Math.ceil((hi - lo) / dx));
        for (let i = 0; i <= n; i++) {
            const o = obstacleOffset(ob, lo + (hi - lo) * (i / n));
            if (ob.y1 + o > G - PH_TOP && ob.y0 + o < G - PH_BOTTOM) return true;
        }
        return false;
    }

    /*
     * Simulate: run on the ground, press when trackPos = px, follow trajectory `traj`,
     * land and keep running. Returns 0 on collision, 1 on success, 2 on success that also
     * touches `target` (a hitbox). Ground running is only checked inside
     * [px - preGround, landing + postGround] (in track units) so callers can restrict the
     * check to the neighbourhood of one jump.
     */
    function simulateJump(px, traj, s, obstacles, target, preGround, postGround) {
        const dx = s * CONFIG.STEP;
        let hitTarget = false;

        // Ground run before the press.
        if (preGround > 0) {
            for (let j = 0; j < obstacles.length; j++) {
                if (groundHits(obstacles[j], px - preGround, px, dx)) return 0;
            }
            if (target && groundHits(target, px - preGround, px, dx)) hitTarget = true;
        }

        // Airborne: for each obstacle, only test the steps where it overlaps horizontally.
        for (let j = 0; j < obstacles.length; j++) {
            if (airHits(px, dx, traj, obstacles[j])) return 0;
        }
        if (target && !hitTarget && airHits(px, dx, traj, target)) hitTarget = true;

        // Ground run after landing.
        const T = px + dx * traj.steps;
        if (postGround > 0) {
            for (let j = 0; j < obstacles.length; j++) {
                if (groundHits(obstacles[j], T, T + postGround, dx)) return 0;
            }
            if (target && groundHits(target, T, T + postGround, dx)) hitTarget = true;
        }
        return hitTarget ? 2 : 1;
    }

    function airHits(px, dx, traj, ob) {
        const i0 = Math.max(0, Math.floor((ob.x0 - PHX1 - px) / dx) - 1);
        const i1 = Math.min(traj.steps, Math.ceil((ob.x1 - PHX0 - px) / dx) + 1);
        const box = scratchBox;
        for (let i = i0; i < i1; i++) {
            const T = px + dx * (i + 1);
            playerBox(traj.alts[i], T, box);
            if (overlaps(box, ob.mv ? obstacleBox(ob, T, scratchOb) : ob)) return true;
        }
        return false;
    }

    function groundRunClear(obstacles, s) {
        for (const ob of obstacles) if (groundHits(ob, -Infinity, Infinity, s * CONFIG.STEP)) return false;
        return true;
    }

    /*
     * Find the best timing window for clearing `obstacles` (and touching `target` if given)
     * with a single jump (or no jump). Returns { seconds, traj, pxStart, pxEnd } or null.
     */
    function bestWindow(obstacles, s, opts) {
        opts = opts || {};
        const target = opts.target || null;
        const pre = opts.preGround === undefined ? Infinity : opts.preGround;
        const post = opts.postGround === undefined ? Infinity : opts.postGround;
        const need = target ? 2 : 1;
        const enough = opts.enough || Infinity; // stop searching once a window this long is found

        // Only presses whose jump can reach the target (or the obstacles) are worth searching.
        let lo = Infinity, hi = -Infinity;
        if (target) { lo = target.x0; hi = target.x1; }
        else for (const ob of obstacles) { lo = Math.min(lo, ob.x0); hi = Math.max(hi, ob.x1); }

        // Running without jumping.
        if (!target && groundRunClear(obstacles, s)) {
            return { seconds: Infinity, traj: null, pxStart: -Infinity, pxEnd: Infinity };
        }
        if (target && standsIn(target) && pre === Infinity && post === Infinity && groundRunClear(obstacles, s)) {
            return { seconds: Infinity, traj: null, pxStart: -Infinity, pxEnd: Infinity };
        }

        const stepX = s * (opts.pressStep || CONFIG.fairness.pressStep);
        const pxMin = lo - PHX1 - s * MAX_AIR - stepX;
        const pxMax = hi - PHX0 + stepX;
        // Obstacles the search could ever touch.
        const reachLo = pxMin + PHX0 - (pre === Infinity ? Infinity : pre);
        const reachHi = pxMax + PHX1 + s * MAX_AIR + (post === Infinity ? Infinity : post);
        const near = [];
        for (const ob of obstacles) if (ob.x1 > reachLo && ob.x0 < reachHi) near.push(ob);
        // A trajectory that cannot rise to the target is skipped outright.
        const targetAlt = target ? G - target.y1 - PH_TOP : -Infinity;

        let best = null;
        for (let t = 0; t < TRAJECTORIES.length; t++) {
            const traj = TRAJECTORIES[t];
            if (traj.apex < targetAlt) continue;
            let runStart = null, runLen = 0;
            for (let px = pxMin; px <= pxMax; px += stepX) {
                const r = simulateJump(px, traj, s, near, target, pre, post);
                if (r >= need) {
                    if (runStart === null) runStart = px;
                    runLen++;
                    if ((runLen * stepX) / s >= enough) return pickBest(best, runStart, runLen, stepX, s, traj);
                } else if (runStart !== null) {
                    best = pickBest(best, runStart, runLen, stepX, s, traj);
                    runStart = null; runLen = 0;
                }
            }
            if (runStart !== null) best = pickBest(best, runStart, runLen, stepX, s, traj);
        }
        return best;
    }

    function pickBest(best, start, len, stepX, s, traj) {
        const seconds = (len * stepX) / s;
        if (!best || seconds > best.seconds) {
            return { seconds, traj, pxStart: start, pxEnd: start + (len - 1) * stepX };
        }
        return best;
    }

    function hitboxes(entities) {
        const out = [];
        for (const e of entities) out.push(e.hit);
        return out;
    }

    // ---------------------------------------------------------------- patterns

    // Each pattern is a cluster of obstacles cleared by a single jump (or by staying down).
    // `from` = metres before the pattern can appear. `weight` = relative frequency at the start
    // of a run, `lateWeight` = relative frequency far into a run (it shifts gradually with the
    // spawn ramp), so single enemies give way to bigger groups as the run goes on.
    const PATTERNS = [
        { name: 'tiger', from: 0, weight: 10, lateWeight: 1.5,
            build: (x) => [makeTiger(x)] },
        { name: 'hawkHigh', from: 80, weight: 4, lateWeight: 1,     // stay on the ground and let it pass
            build: (x, r) => [makeHawk(x, lerp(100, 116, r()))] },
        { name: 'hawkLow', from: 180, weight: 4, lateWeight: 1,     // a short hop clears it
            build: (x, r) => [makeHawk(x, lerp(12, 24, r()))] },
        { name: 'hawkMid', from: 350, weight: 3, lateWeight: 1,     // needs a held (higher) jump
            build: (x, r) => [makeHawk(x, lerp(44, 58, r()))] },
        { name: 'tigerPair', from: 500, weight: 3, lateWeight: 5,   // two tigers: hold a little longer
            build: (x, r) => [makeTiger(x), makeTiger(x + lerp(62, 84, r()))] },
        { name: 'hawkLowPair', from: 700, weight: 2, lateWeight: 4, // two low hawks in a row: one long jump
            build: (x, r) => [makeHawk(x, lerp(12, 22, r())), makeHawk(x + lerp(70, 90, r()), lerp(12, 22, r()))] },
        { name: 'tigerUnderHawk', from: 900, weight: 2, lateWeight: 3, // short hop only: a high hawk follows
            build: (x, r) => [makeTiger(x), makeHawk(x + lerp(150, 175, r()), lerp(104, 116, r()))] },
        { name: 'tigerThenHawk', from: 1100, weight: 2, lateWeight: 4, // a tiger with a low hawk right behind it
            build: (x, r) => [makeTiger(x), makeHawk(x + lerp(80, 100, r()), lerp(14, 26, r()))] },
        { name: 'tigerTrio', from: 1400, weight: 1, lateWeight: 4,  // full-height jump
            build: (x, r) => [makeTiger(x), makeTiger(x + lerp(62, 70, r())), makeTiger(x + lerp(130, 140, r()))] },
        { name: 'tigerHawkTiger', from: 1800, weight: 1, lateWeight: 3, // tiger, low hawk, tiger: full jump
            build: (x, r) => [makeTiger(x), makeHawk(x + lerp(66, 74, r()), lerp(14, 22, r())), makeTiger(x + lerp(136, 146, r()))] },
        { name: 'tigerQuad', from: 2400, weight: 1, lateWeight: 3,  // four tigers: a perfectly timed full jump
            build: (x, r) => [makeTiger(x), makeTiger(x + lerp(60, 66, r())), makeTiger(x + lerp(122, 130, r())), makeTiger(x + lerp(184, 194, r()))] },

        // Moving enemies (see motionOffset). `s` is the running speed where the pattern spawns.
        { name: 'hopper', from: 600, weight: 2, lateWeight: 3,     // bouncing tiger: time the jump to its rhythm
            build: (x, r, s) => [makeHopper(x, lerp(44, 66, r()), s * lerp(0.6, 0.8, r()), r() * Math.PI)] },
        { name: 'diver', from: 800, weight: 2, lateWeight: 3,      // hawk swoops from high to low: hop it
            build: (x, r, s) => [makeGlider(x, lerp(102, 116, r()), lerp(14, 24, r()), s)] },
        { name: 'riser', from: 1000, weight: 2, lateWeight: 3,     // hawk climbs from low to high: don't jump
            build: (x, r, s) => [makeGlider(x, lerp(14, 22, r()), lerp(104, 116, r()), s)] },
        { name: 'pouncer', from: 1200, weight: 2, lateWeight: 3,   // crouching tiger leaps as you arrive: run under it
            build: (x, r, s) => [makePouncer(x, lerp(135, 160, r()), s * lerp(0.22, 0.32, r()), s * 0.7)] },
        { name: 'tigerThenPouncer', from: 1800, weight: 1, lateWeight: 2, // hop the tiger, then stay down
            build: (x, r, s) => [makeTiger(x), makePouncer(x + lerp(200, 240, r()), lerp(135, 160, r()), s * lerp(0.22, 0.32, r()), s * 0.7)] }
    ];

    // Minimum ground distance between clusters: enough to land from any jump that cleared the
    // previous cluster and still react. Verified by tools/fairness-test.js.
    function minGap(s) {
        return s * (MAX_AIR + CONFIG.fairness.reaction) + 40;
    }

    // ---------------------------------------------------------------- world generator

    function createGenerator(rng) {
        rng = rng || Math.random;
        return {
            rng,
            cursor: CONFIG.PLAYER_X + 1000, // first obstacle arrives ~2 s after the start
            prevObstacles: [],
            prevEnd: CONFIG.PLAYER_X + 300,
            count: 0
        };
    }

    function patternWeight(p, crowd) {
        return lerp(p.weight, p.lateWeight === undefined ? p.weight : p.lateWeight, crowd);
    }

    function pickPattern(gen, meters, crowd) {
        let total = 0;
        for (const p of PATTERNS) if (meters >= p.from) total += patternWeight(p, crowd);
        let r = gen.rng() * total;
        for (const p of PATTERNS) {
            if (meters < p.from) continue;
            r -= patternWeight(p, crowd);
            if (r <= 0) return p;
        }
        return PATTERNS[0];
    }

    function bounds(list) {
        let x0 = Infinity, x1 = -Infinity;
        for (const e of list) { x0 = Math.min(x0, e.hit.x0); x1 = Math.max(x1, e.hit.x1); }
        return { x0, x1 };
    }

    // Generate one cluster (plus bananas) at gen.cursor; append entities to `out`.
    function generateSegment(gen, out) {
        const r = gen.rng;
        const x = gen.cursor;
        const distance = x - CONFIG.PLAYER_X;
        const s = speedFor(distance);
        const crowd = crowdingFor(distance);
        const meters = distance / CONFIG.UNITS_PER_METER;

        // Choose a pattern whose instance is verifiably clearable at this speed.
        let obstacles = null, win = null;
        for (let attempt = 0; attempt < 4 && !obstacles; attempt++) {
            const pattern = attempt < 3 ? pickPattern(gen, meters, crowd) : PATTERNS[0];
            const list = pattern.build(x, r, s);
            const w = bestWindow(hitboxes(list), s, { enough: CONFIG.fairness.minWindow, pressStep: 1 / 120 });
            if (w && w.seconds >= CONFIG.fairness.minWindow) { obstacles = list; win = w; }
        }
        for (const e of obstacles) out.push(e);
        const b = bounds(obstacles);

        // Bananas in the gap before this cluster, checked against both neighbouring clusters.
        const neighbours = hitboxes(gen.prevObstacles.concat(obstacles));
        placeGapBananas(gen, out, gen.prevEnd, b.x0, s, neighbours);

        // Occasionally trace a banana arc along a jump that clears this cluster.
        if (win && win.traj && r() < 0.3) placeArcBananas(out, win, s, hitboxes(obstacles));

        // Space out the next cluster. Slack shrinks with difficulty but never below minGap.
        const SP = CONFIG.spawn;
        const slack = lerp(SP.slackStart, SP.slackEnd, crowd);
        let gap = minGap(s) + s * slack * r();
        if (r() < lerp(SP.breatherStart, SP.breatherEnd, crowd)) gap += s * SP.breatherSeconds;
        gen.prevObstacles = obstacles;
        gen.prevEnd = b.x1;
        gen.cursor = b.x1 + gap;
        gen.count++;
    }

    const BANANA_TIERS = [
        { name: 'ground', lo: 26, hi: 34 },     // run through
        { name: 'low', lo: 115, hi: 150 },      // short hop
        { name: 'high', lo: 185, hi: 250 }      // held jump
    ];

    function placeGapBananas(gen, out, from, to, s, neighbours) {
        const r = gen.rng;
        if (r() > 0.6) return;
        const margin = 70;
        const span = to - from - margin * 2;
        if (span < 120) return;

        const tier = BANANA_TIERS[Math.floor(r() * BANANA_TIERS.length)];
        const count = 1 + Math.floor(r() * Math.min(4, span / 70));
        const spacing = 62;
        const width = (count - 1) * spacing;
        if (width > span) return;
        const startX = from + margin + r() * (span - width);
        const alt = lerp(tier.lo, tier.hi, r());
        const opts = {
            preGround: s * 0.15,
            postGround: s * CONFIG.fairness.reaction,
            enough: CONFIG.fairness.minBananaWindow,
            pressStep: 1 / 120
        };
        for (let i = 0; i < count; i++) {
            const banana = makeBanana(startX + i * spacing, alt);
            if (!clearOf(banana.hit, neighbours, 24)) continue;
            opts.target = banana.hit;
            const w = bestWindow(neighbours, s, opts);
            if (!w || w.seconds < CONFIG.fairness.minBananaWindow) break; // rest of the row is no better
            out.push(banana);
        }
    }

    // Place bananas on the path of the centre of a known-good jump over the cluster.
    function placeArcBananas(out, win, s, obstacles) {
        const traj = win.traj;
        const px = (win.pxStart + win.pxEnd) / 2;
        const dx = s * CONFIG.STEP;
        const count = 3;
        const first = Math.floor(traj.steps * 0.3);
        const last = Math.floor(traj.steps * 0.7);
        for (let n = 0; n < count; n++) {
            const i = Math.round(lerp(first, last, n / (count - 1)));
            const T = px + dx * (i + 1);
            const box = playerBox(traj.alts[i], T, makeBox());
            const cx = (box.x0 + box.x1) / 2;
            const alt = G - (box.y0 + box.y1) / 2 + 8;
            const banana = makeBanana(cx, alt);
            if (clearOf(banana.hit, obstacles, 18)) out.push(banana);
        }
    }

    // Uses the full range a moving enemy sweeps through, so a banana never sits in its path.
    function clearOf(box, others, margin) {
        for (const o of others) {
            const y0 = o.sy0 === undefined ? o.y0 : o.sy0, y1 = o.sy1 === undefined ? o.y1 : o.sy1;
            if (box.x0 < o.x1 + margin && box.x1 > o.x0 - margin &&
                box.y0 < y1 + margin && box.y1 > y0 - margin) return false;
        }
        return true;
    }

    // Keep the world populated up to `limitX`.
    function generateUntil(gen, limitX, out) {
        let guard = 0;
        while (gen.cursor < limitX && guard++ < 50) generateSegment(gen, out);
    }

    // ---------------------------------------------------------------- export

    const api = {
        CONFIG, SPRITES,
        clamp, lerp, mulberry32,
        difficultyFor, speedFor, crowdingFor,
        createPlayer, pressJump, stepPlayer,
        makeBox, playerBox, overlaps,
        makeTiger, makeHawk, makeBanana, makeHopper, makePouncer, makeGlider,
        obstacleOffset, obstacleBox,
        createGenerator, generateSegment, generateUntil,
        bestWindow, simulateJump, hitboxes, minGap,
        PATTERNS, TRAJECTORIES, MAX_AIR, MIN_APEX, MAX_APEX,
        PLAYER_HITBOX: { PHX0, PHX1, PH_TOP, PH_BOTTOM }
    };
    root.HarunbeEngine = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
