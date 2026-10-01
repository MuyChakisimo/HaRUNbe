/*
 * HaRUNbe skin catalog. To add a skin, add one entry to the list below.
 *
 *   id        Unique and permanent. Players' saves store it, so never rename it after release.
 *   name      Shown in the Skins screen.
 *   price     Cost in banked bananas. 0 = free and owned from the start.
 *   bestRun   Optional. Miles the player must reach in a single run before it can be bought.
 *   totalRun  Optional. Miles the player must run in total (all runs added together).
 *   either    Optional. With both bestRun and totalRun: true = reaching EITHER one unlocks it
 *             (one long run, or the total over many runs). Without it, both are needed.
 *             House rule so far: the total is double the one-run distance.
 *             Keep every goal above 0.6 mi (the biggest head start), so a head start alone
 *             never unlocks a skin.
 *             For skins added after a player started playing, both goals only count runs
 *             made after the skin arrived: past runs never unlock a new skin straight away.
 *   image     Optional. A 256x256 PNG with a transparent background, drawn in the same pose and
 *             position as Assets/Player/256x256DefaultGorilla.png. Defaults to that image.
 *   scale     Optional. Draws the skin bigger (e.g. 1.25) while keeping it on the ground. Use it
 *             when the character is much shorter than the gorilla; tools/make-skin.ps1 suggests it.
 *   recolor   Optional. Repaints the image without new artwork:
 *               fur:  colour for the dark fur
 *               skin: colour for the face, hands and feet (anything brightly coloured)
 *             The artwork's shading and outline are kept.
 *
 * Skins are cosmetic only: every skin uses the same hitbox.
 * After adding a skin with a new image file, bump VERSION in sw.js so it is cached for offline play.
 */
(function (root) {
    'use strict';

    const DEFAULT_IMAGE = 'Assets/Player/256x256DefaultGorilla.png';

    const SKINS = [
        { id: 'classic', name: 'Harunbe', price: 0 },
        { id: 'silverback', name: 'Silverback', price: 60,
            recolor: { fur: '#9aa1a8' } },
        { id: 'yeti', name: 'Yeti', price: 150, bestRun: 0.75,
            recolor: { fur: '#eef3f7', skin: '#8ec5e8' } },
        { id: 'tie', name: 'Big Tie', price: 200, totalRun: 1.5,
            image: 'Assets/Player/256x256TieGorilla.png' },
        { id: 'miku', name: 'Miku', price: 300, bestRun: 1, totalRun: 2, either: true,
            image: 'Assets/Player/256x256MikuGorilla.png' },
        { id: 'lava', name: 'Lava', price: 450, bestRun: 1.5,
            recolor: { fur: '#4a1510', skin: '#ff6a1f' } },
        { id: 'toxic', name: 'Toxic', price: 700, totalRun: 12.5,
            recolor: { fur: '#1d3b2a', skin: '#8dff4f' } },
        { id: 'pirate', name: 'Pirate', price: 800, totalRun: 2.25,
            image: 'Assets/Player/256x256PirateGorilla.png' },
        { id: 'spiky', name: 'Spiky', price: 900, bestRun: 1.5, totalRun: 3, either: true,
            image: 'Assets/Player/256x256SpikyGorilla.png' },
        { id: 'ninja', name: 'Ninja', price: 1100, bestRun: 2, totalRun: 4, either: true,
            image: 'Assets/Player/256x256NinjaGorilla.png' },
        { id: 'strawhat', name: 'Straw Hat', price: 1300, totalRun: 4,
            image: 'Assets/Player/256x256StrawHatGorilla.png' },
        { id: 'bananasuit', name: 'Banana Suit', price: 1200, totalRun: 3.75,
            image: 'Assets/Player/256x256BananaSuitGorilla.png' },
        { id: 'golden', name: 'Golden', price: 1500, bestRun: 2.25,
            recolor: { fur: '#c8921a', skin: '#fff0a0' } },
        { id: 'racer', name: 'Racer', price: 1000, bestRun: 1.75, totalRun: 3.5, either: true,
            image: 'Assets/Player/256x256RaceCarGorilla.png', scale: 1.25 },
        { id: 'samurai', name: 'Samurai', price: 2000, bestRun: 2.5, totalRun: 5, either: true,
            image: 'Assets/Player/256x256SamuraiGorilla.png' },
        { id: 'robopirate', name: 'Robo Pirate', price: 2500, bestRun: 3,
            image: 'Assets/Player/256x256RoboPirateGorilla.png' },
        { id: 'kaiju', name: 'Kaiju', price: 3000, bestRun: 3.75, totalRun: 7.5, either: true,
            image: 'Assets/Player/256x256KaijuGorilla.png' }
    ];

    // Goals are written in miles above; the game counts distance in metres internally.
    const METERS_PER_MILE = 1609.344;
    for (const skin of SKINS) {
        if (!skin.image) skin.image = DEFAULT_IMAGE;
        if (skin.bestRun) skin.bestRun = Math.round(skin.bestRun * METERS_PER_MILE);
        if (skin.totalRun) skin.totalRun = Math.round(skin.totalRun * METERS_PER_MILE);
    }

    root.HarunbeSkins = SKINS;
})(typeof self !== 'undefined' ? self : this);
