/*
 * Difficulty report for HaRUNbe (run with: node tools/density-report.js).
 * Generates many worlds and prints how many enemies arrive per second at each stage of a
 * run, so difficulty changes in engine.js can be compared with numbers instead of guesses.
 */
'use strict';
const E = require(process.argv[2] ? require('path').resolve(process.argv[2]) : '../engine.js');
const C = E.CONFIG;
const SEEDS = 30;

// Bonus stages (no enemies) would water down the enemies-per-second numbers, so they are
// switched off here and counted separately at the end.
const BONUS_CHANCE = C.bonus.chance;
C.bonus.chance = 0;
const BUCKETS = [[0, 30], [30, 60], [60, 90], [90, 120], [120, 180], [180, 240]]; // seconds

// Seconds needed to reach each track x, integrating the real speed curve.
function timeAt(x) {
    let t = 0;
    const dx = 50;
    for (let d = 0; d < x; d += dx) t += dx / E.speedFor(d);
    return t;
}

const totals = BUCKETS.map(() => ({ enemies: 0, clusters: 0 }));
let endX = 0;
while (timeAt(endX) < BUCKETS[BUCKETS.length - 1][1]) endX += 1000;
const times = new Map();
for (let seed = 1; seed <= SEEDS; seed++) {
    const gen = E.createGenerator(E.mulberry32(seed));
    const ents = [];
    while (gen.cursor < endX + C.PLAYER_X) E.generateSegment(gen, ents);
    let lastCluster = -Infinity;
    for (const e of ents) {
        if (e.type === 'banana') continue;
        const key = Math.round(e.x / 50);
        if (!times.has(key)) times.set(key, timeAt(e.x - C.PLAYER_X));
        const t = times.get(key);
        const b = BUCKETS.findIndex(([a, z]) => t >= a && t < z);
        if (b < 0) continue;
        totals[b].enemies++;
        if (e.x - lastCluster > 300) totals[b].clusters++;
        lastCluster = e.x;
    }
}
console.log('time       metres at end   enemies/s   groups/s   enemies/group');
for (let i = 0; i < BUCKETS.length; i++) {
    const [a, z] = BUCKETS[i];
    const secs = (z - a) * SEEDS;
    let x = 0;
    while (timeAt(x) < z) x += 200;
    const t = totals[i];
    console.log(`${String(a).padStart(3)}-${String(z).padEnd(3)} s   ${String(Math.round(x / C.UNITS_PER_METER)).padStart(7)} m      ` +
        `${(t.enemies / secs).toFixed(2)}        ${(t.clusters / secs).toFixed(2)}       ${(t.enemies / Math.max(1, t.clusters)).toFixed(2)}`);
}

// Bonus stages and golden bananas, with bonus stages switched back on.
C.bonus.chance = BONUS_CHANCE;
let zones = 0, golden = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
    const gen = E.createGenerator(E.mulberry32(seed));
    const ents = [];
    while (gen.cursor < 5000 * C.UNITS_PER_METER + C.PLAYER_X) E.generateSegment(gen, ents);
    zones += gen.bonusZones.length;
    golden += ents.filter((e) => e.golden).length;
}
console.log(`
Per 5 km: ${(zones / SEEDS).toFixed(1)} bonus stages, ${(golden / SEEDS).toFixed(1)} golden bananas`);
