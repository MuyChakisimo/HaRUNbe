/*
 * HaRUNbe skin catalog. To add a skin, add one entry to the list below.
 *
 *   id        Unique and permanent. Players' saves store it, so never rename it after release.
 *   name      Shown in the Skins screen.
 *   price     Cost in banked bananas. 0 = free and owned from the start.
 *   bestRun   Optional. Metres the player must reach in a single run before it can be bought.
 *   totalRun  Optional. Lifetime metres (all runs added together) before it can be bought.
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
        { id: 'yeti', name: 'Yeti', price: 150, bestRun: 1100,
            recolor: { fur: '#eef3f7', skin: '#8ec5e8' } },
        { id: 'tie', name: 'Big Tie', price: 200, bestRun: 1250,
            image: 'Assets/Player/256x256TieGorilla.png' },
        { id: 'miku', name: 'Miku', price: 300, bestRun: 1500,
            image: 'Assets/Player/256x256MikuGorilla.png' },
        { id: 'lava', name: 'Lava', price: 450, bestRun: 2200,
            recolor: { fur: '#4a1510', skin: '#ff6a1f' } },
        { id: 'toxic', name: 'Toxic', price: 700, totalRun: 20000,
            recolor: { fur: '#1d3b2a', skin: '#8dff4f' } },
        { id: 'pirate', name: 'Pirate', price: 800, bestRun: 1800,
            image: 'Assets/Player/256x256PirateGorilla.png' },
        { id: 'golden', name: 'Golden', price: 1500, bestRun: 3500,
            recolor: { fur: '#c8921a', skin: '#fff0a0' } },
        { id: 'racer', name: 'Racer', price: 1000, bestRun: 2700,
            image: 'Assets/Player/256x256RaceCarGorilla.png', scale: 1.25 },
        { id: 'samurai', name: 'Samurai', price: 2000, bestRun: 4200,
            image: 'Assets/Player/256x256SamuraiGorilla.png' },
        { id: 'robopirate', name: 'Robo Pirate', price: 2500, bestRun: 5000,
            image: 'Assets/Player/256x256RoboPirateGorilla.png' }
    ];

    for (const skin of SKINS) if (!skin.image) skin.image = DEFAULT_IMAGE;

    root.HarunbeSkins = SKINS;
})(typeof self !== 'undefined' ? self : this);
