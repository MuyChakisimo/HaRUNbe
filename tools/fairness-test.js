/*
 * Offline fairness verification for HaRUNbe (run with: node tools/fairness-test.js).
 * Uses the real engine physics to prove that every obstacle pattern can be cleared at every
 * speed, that consecutive clusters at the minimum gap stay fair, and that generated bananas
 * are reachable.
 */
'use strict';
const E = require('../engine.js');
const { CONFIG, TRAJECTORIES, PATTERNS } = E;

let failures = 0;
function fail(msg) { failures++; console.log('  FAIL ' + msg); }

console.log('Jump trajectories (hold -> apex / airtime):');
for (const t of [TRAJECTORIES[0], TRAJECTORIES[Math.floor(TRAJECTORIES.length / 2)], TRAJECTORIES[TRAJECTORIES.length - 1]]) {
    console.log(`  hold ${(t.hold * 1000).toFixed(0).padStart(3)} ms -> apex ${t.apex.toFixed(1)} u, air ${(t.steps * CONFIG.STEP).toFixed(3)} s`);
}

const speeds = [];
for (let s = CONFIG.speed.start; s <= CONFIG.speed.max; s += 40) speeds.push(s);
speeds.push(CONFIG.speed.max);

// Distance at which a speed is reached (inverse of speedFor), used to respect pattern unlocks.
function metersForSpeed(s) {
    const d = (s - CONFIG.speed.start) / (CONFIG.speed.max - CONFIG.speed.start);
    if (d >= 1) return Infinity;
    return -Math.log(1 - d) * CONFIG.speed.rampMeters;
}

console.log('\n1) Every pattern instance is clearable (min window over 40 random instances):');
const rng = E.mulberry32(1234);
for (const p of PATTERNS) {
    const row = [];
    for (const s of speeds) {
        let min = Infinity;
        for (let i = 0; i < 40; i++) {
            const w = E.bestWindow(E.hitboxes(p.build(0, rng, s)), s);
            min = Math.min(min, w ? w.seconds : 0);
        }
        const unlocked = metersForSpeed(s) + 400 >= p.from;
        row.push((min === Infinity ? ' run' : (min * 1000).toFixed(0).padStart(4)) + (unlocked ? '' : '*'));
        if (unlocked && min < CONFIG.fairness.minWindow) fail(`${p.name} at speed ${s}: window ${(min * 1000).toFixed(0)} ms`);
    }
    console.log(`  ${p.name.padEnd(15)} ${row.join(' ')}`);
}
console.log('  (ms of timing slack; "run" = pass by staying on the ground; * = not yet unlocked at that speed)');

// All successful single-jump solutions for a cluster: [{px, land, traj}]
function solutions(boxes, s) {
    const out = [];
    let lo = Infinity, hi = -Infinity;
    for (const b of boxes) { lo = Math.min(lo, b.x0); hi = Math.max(hi, b.x1); }
    const stepX = s * CONFIG.fairness.pressStep;
    const { PHX0, PHX1 } = E.PLAYER_HITBOX;
    for (const traj of TRAJECTORIES) {
        for (let px = lo - PHX1 - s * E.MAX_AIR - stepX; px <= hi - PHX0 + stepX; px += stepX) {
            if (E.simulateJump(px, traj, s, boxes, null, Infinity, 0)) {
                out.push({ px, land: px + s * CONFIG.STEP * traj.steps, traj });
            }
        }
    }
    return out;
}

console.log('\n2) Consecutive clusters at the minimum gap (and at the tighter rush-wave gap):');
let pairChecks = 0;
for (const mode of ['normal', 'rush']) for (const s of speeds) {
    const meters = metersForSpeed(s) + 400;
    if (mode === 'rush' && meters < CONFIG.rush.fromMeters) continue;
    const avail = PATTERNS.filter(p => meters >= p.from && (mode === 'normal' || E.isMultiPattern(p)));
    for (const A of avail) for (const B of avail) {
        const a = A.build(0, rng, s);
        const boxesA = E.hitboxes(a);
        const aEnd = Math.max(...boxesA.map(b => b.x1));
        const bStart = aEnd + (mode === 'rush' ? E.rushGap(s) : E.minGap(s));
        const b = B.build(bStart, rng, s);
        const shift = bStart - Math.min(...E.hitboxes(b).map(h => h.x0));
        const boxesB = E.hitboxes(b).map(h => Object.assign({}, h, { x0: h.x0 + shift, x1: h.x1 + shift }, h.sx0 === undefined ? {} : { sx0: h.sx0 + shift })) // keeps any motion;
        const solsA = E.bestWindow(boxesA, s).traj === null ? [{ land: -Infinity }] : solutions(boxesA, s);
        // Latest landing from any way of clearing A:
        let worstLand = -Infinity;
        for (const sol of solsA) worstLand = Math.max(worstLand, sol.land);
        // B must be clearable with the player starting from that landing (ground run limited
        // to after the landing), with a normal timing window.
        const pre = worstLand === -Infinity ? Infinity : 0;
        const bw = bestWindowAfter(boxesB, s, worstLand + s * 0.2);
        pairChecks++;
        if (!bw || bw < CONFIG.fairness.minWindow) {
            fail(`[${mode}] ${A.name} -> ${B.name} at ${s}: window after worst landing ${(bw * 1000 || 0).toFixed(0)} ms`);
        }
        void pre;
    }
}
console.log(`  ${pairChecks} pair checks done`);

// Best window among presses no earlier than `earliest`.
function bestWindowAfter(boxes, s, earliest) {
    const full = E.bestWindow(boxes, s);
    if (!full) return 0;
    if (full.traj === null) return Infinity;
    let best = 0;
    const stepX = s * CONFIG.fairness.pressStep;
    const { PHX0, PHX1 } = E.PLAYER_HITBOX;
    let lo = Infinity, hi = -Infinity;
    for (const b of boxes) { lo = Math.min(lo, b.x0); hi = Math.max(hi, b.x1); }
    for (const traj of TRAJECTORIES) {
        let run = 0;
        for (let px = Math.max(earliest, lo - PHX1 - s * E.MAX_AIR - stepX); px <= hi - PHX0 + stepX; px += stepX) {
            if (E.simulateJump(px, traj, s, boxes, null, px - earliest, Infinity)) { run++; best = Math.max(best, run * stepX / s); }
            else run = 0;
        }
    }
    return best;
}

console.log('\n3) Generated world (long simulated runs):');
for (const seed of [1, 2, 3, 4, 5]) {
    const gen = E.createGenerator(E.mulberry32(seed));
    const ents = [];
    const target = 20000 * CONFIG.UNITS_PER_METER; // 20 km
    E.generateUntil(gen, 400000, ents);
    while (gen.cursor < target) E.generateSegment(gen, ents);
    const counts = {};
    let bad = 0;
    const obs = ents.filter(e => e.type !== 'banana');
    const bananas = ents.filter(e => e.type === 'banana');
    for (const e of obs) counts[e.type] = (counts[e.type] || 0) + 1;
    for (const bnn of bananas) {
        const alt = CONFIG.GROUND_Y - (bnn.hit.y0 + bnn.hit.y1) / 2;
        if (alt < 0 || alt > E.MAX_APEX + E.PLAYER_HITBOX.PH_TOP) bad++;
        // Against the whole range a moving enemy sweeps through, not just its start position.
        for (const o of obs) if (E.overlaps(bnn.hit, { x0: o.hit.x0, x1: o.hit.x1, y0: o.hit.sy0, y1: o.hit.sy1 })) bad++;
        if (bnn.hit.y1 > CONFIG.GROUND_Y) bad++;
    }
    for (const t of obs) if (t.type === 'tiger' && Math.abs(t.hit.y1 - (CONFIG.GROUND_Y - 2.4)) > 1) bad++;
    for (const h of obs) if (h.type === 'hawk' && h.hit.y1 > CONFIG.GROUND_Y - 10) bad++;
    if (bad) fail(`seed ${seed}: ${bad} invalid placements`);
    console.log(`  seed ${seed}: ${gen.count} clusters, ${counts.tiger} tigers, ${counts.hawk} hawks, ${bananas.length} bananas, invalid: ${bad}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll fairness checks passed.');
process.exit(failures ? 1 : 0);
