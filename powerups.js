/*
 * HaRUNbe power-up catalog. Power-ups are bought in the Shop with banked bananas, stored
 * (up to `max` of each), and used during a run by pressing their button or key. Each one can
 * be used once per run; any you don't press stay in storage.
 *
 *   id        Unique and permanent. Players' saves store it, so never rename it after release.
 *   name      Shown in the Shop and on the button.
 *   icon      Emoji shown on the button and in the Shop.
 *   price     Cost of one, in banked bananas.
 *   key       Keyboard key that uses it during a run.
 *   info      One-line description for the Shop.
 *   effect    What it does (handled in game.js):
 *               'shield'  blocks the next hit, for the rest of the run
 *               'magnet'  pulls in nearby bananas for `seconds`
 *               'double'  bananas count twice for `seconds`
 *               'warp'    head start: jumps `meters` ahead. Only usable in the first few
 *                         seconds of a run, and only one head start per run.
 */
(function (root) {
    'use strict';

    const POWERUPS = [
        { id: 'shield', name: 'Shield', icon: '🛡️', price: 150, key: '1', effect: 'shield',
            info: 'Survive one hit' },
        { id: 'magnet', name: 'Magnet', icon: '🧲', price: 60, key: '2', effect: 'magnet', seconds: 15,
            info: 'Pulls in bananas, 15 s' },
        { id: 'double', name: 'Double', icon: '×2', price: 80, key: '3', effect: 'double', seconds: 20,
            info: '2× bananas, 20 s' },
        { id: 'warp600', name: 'Head start', icon: '⚡', price: 150, key: '4', effect: 'warp', meters: 600,
            info: 'Skip ahead 600 m' },
        { id: 'warp800', name: 'Head start', icon: '⚡', price: 250, key: '5', effect: 'warp', meters: 800,
            info: 'Skip ahead 800 m' },
        { id: 'warp1000', name: 'Head start', icon: '⚡', price: 400, key: '6', effect: 'warp', meters: 1000,
            info: 'Skip ahead 1,000 m' }
    ];

    root.HarunbePowerups = {
        list: POWERUPS,
        max: 99,            // most of each power-up a player can store
        warpWindow: 60      // head starts can be used until the run reaches this many metres
    };
})(typeof self !== 'undefined' ? self : this);
