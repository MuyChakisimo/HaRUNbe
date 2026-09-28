# HaRUNbe v3.0.0: audit and rebuild notes

## Problems found in v2.1

**Game loop and timing**
- All movement was measured per frame (`gravity 0.3`, `ENEMY_SPEED 3`, `timeToNextEnemy--`). On a 120/144 Hz screen the whole game, including gravity, spawning and the day/night cycle, ran 2–2.4× faster than at 60 Hz.
- There was no delta-time handling at all. Coming back from another tab resumed immediately with no pause.
- Starting, resuming and restarting could each schedule their own `requestAnimationFrame` chain.

**Jumping**
- The "variable jump" was a per-frame velocity hack (`velocityY += 1.0` when released), so it also depended on frame rate.
- Pressing Space did not set `isJumping`, so keyboard jumps were always the short hop. `keyup` was never handled.
- There was no jump buffer and no protection against key-repeat.

**Pause**
- The code referenced a `#pause-buttons` element that did not exist. It worked around that with null checks and `console.error`.
- Once paused, P could not resume.
- Countdown timers used `setInterval` and ran separately from the game state.
- A jump that was held while pausing stayed held.

**World and spawning**
- Bananas moved at 0.8 px/frame while enemies moved at 3 px/frame, so collectibles drifted through the world at a different speed from everything else.
- Spawn heights were fixed pixel offsets (`groundLevel - 200`). On short phone screens hawks could spawn at impossible or overlapping heights.
- Nothing checked for fairness. A tiger and a hawk could spawn so that no action avoided both. Bananas could spawn above the maximum jump height.
- Difficulty never increased. `speedMultiplier` was forced back to 1.0 every frame.

**Collision**
- Hitboxes were the full image rectangles, transparent padding included, so collisions felt unfair.
- The collision test counted touching edges as a hit.

**Rendering and layout**
- The sky images were stretched to the canvas, which distorted them.
- The sun only moved down the centre of the screen.
- `#grass` was a DOM element placed over the canvas. It doubled as the only touch area, so a tap on the sky did nothing.
- The canvas ignored `devicePixelRatio`, so it looked blurry on phones.
- A resize rebuilt the ground from pixel values, which could leave the player underground.

**Scoring and records**
- "Score" was just the banana count. Distance was not tracked.
- The high-score list mixed the two ideas into one ambiguous "score".

**Assets**
- Loading hung forever if any single image failed.
- The day and night skies were 1–2.8 MB PNGs.

**PWA**
- The service worker precached `'/'`. On a GitHub Pages sub-path that is the wrong URL, and `addAll` rejects, so offline support could fail to install.
- Its offline fallback pointed at `/index.html`, which is also wrong on a sub-path.
- It was cache-first for everything, `game.js` and `style.css` included. Updates stayed stuck until the cache name was changed by hand.
- It cached any response, including errors and cross-origin requests.

**Orientation**
- In portrait the whole app was hidden (`display: none`), menus included.
- The game never requested fullscreen or a landscape lock.

**Debugging leftovers**
- 50 `console` calls (47 in `game.js`, 3 in `sw.js`), commented-out code, and layered "MODIFICATION" workarounds.

## Architecture

| File | Contents |
|---|---|
| `engine.js` | Pure simulation with no DOM. Configuration, sprite hitboxes, fixed-step jump physics, difficulty, pattern-based world generation, and a fairness solver that replays the real physics. |
| `game.js` | Browser layer: assets, input, fixed-step game loop with interpolated rendering, drawing, HUD, screens, records, orientation/fullscreen, and service-worker registration. |
| `sw.js` | Versioned precache. Network-first for code, cache-first for images. |
| `tools/fairness-test.js` | `node tools/fairness-test.js`. Proves every pattern is clearable at every speed, that consecutive clusters stay fair at the minimum gap, and checks 100 km of generated world. |
| `tools/browser-test.js` | Playwright end-to-end tests driven by a fake 60/90/120/144 Hz clock. Includes a 5-minute autopilot run. |

## Gameplay tuning (all in `CONFIG`, `engine.js`)

- **Jump.** A tap gives about 110 units of apex height and 0.58 s in the air. Holding for up to 0.26 s gives about 238 units and 0.91 s. A tiger is about 50 units tall, so a tap clears it. There is a 100 ms press buffer before landing, with no air jumps and no flying.
- **Speed.** Starts at 440 u/s (8.8 m/s) and rises smoothly with distance toward a hard cap of 860 u/s (17.2 m/s), using `1 - e^(-m/1600)`. Gaps between clusters are tuned in `CONFIG.spawn`.
- **Obstacle patterns.** Each unlocks at a set distance:

  | Pattern | Unlocks at | How to clear it |
  |---|---|---|
  | tiger | 0 m | short hop |
  | high hawk | 80 m | stay on the ground |
  | low hawk | 180 m | short hop |
  | mid hawk | 350 m | held jump |
  | tiger pair | 500 m | a slightly longer hold |
  | two low hawks | 700 m | one long jump |
  | tiger then high hawk | 900 m | short hop only |
  | tiger then low hawk | 1,100 m | long held jump |
  | tiger trio | 1,400 m | full jump |
  | tiger, low hawk, tiger | 1,800 m | full jump |
  | four tigers | 2,400 m | perfectly timed full jump |

  Each pattern has a `weight` (how common it is at the start of a run) and a `lateWeight` (how common far into a run). Single enemies give way to big groups as the run goes on.
- **Crowding.** `CONFIG.spawn` sets how fast the world fills up (`rampMeters`, faster than the speed ramp) and the random extra spacing between groups. `node tools/density-report.js` prints the resulting enemies per second at each stage of a run (about 0.5/s at the start and 1.4/s after three minutes).
- **Fairness.** Every instance is checked when it is generated and needs at least 70 ms of timing slack.
- **Bananas.** They sit in three height tiers (ground, short hop, held jump) or on arcs traced along a real clearing jump. Each one is checked to be reachable, and the landing afterwards leaves 0.24 s before the next hazard.
- **Skins.** Defined in `skins.js` (name, price, distance goals, image or recolour). Bananas from every run are banked in `harunbe.progress.v1` and spent in the Skins screen. Skins are cosmetic; the hitbox never changes.
- **Distance.** 50 units = 1 m, counted only during active play.
- **Day/night.** A 120 s cycle starting in the morning. The sun and moon travel left-to-right arcs and set behind the jungle. The starry sky and the dusk/dawn glow crossfade according to the sun's elevation.

## Platform limitations

- **iPhone (Safari, including an installed web app).** Neither fullscreen for page elements nor `screen.orientation.lock` is supported, so HaRUNbe shows the rotate prompt instead. You can also choose to play in portrait.
- **Android Chrome.** Fullscreen and a landscape lock are requested when you press Start. The lock is honoured in fullscreen and in installed apps.
- **Desktop.** No fullscreen request is made. Narrow windows play letterboxed.
- **Unfinished runs.** A run abandoned through Pause → Main Menu does not count toward records.
