# HaRUNbe

An endless jungle runner. Jump over tigers and hawks, collect bananas, and spend them on skins for your gorilla.

## Installing the game (Add to Home Screen)

HaRUNbe is a PWA, so it can be installed and played full screen and offline. The **📲 Install**
button on the main menu handles each device:

- **Android (Chrome, Edge, Samsung Internet) and desktop Chrome/Edge:** opens the browser's own
  install prompt. The button disappears once the game is installed.
- **iPhone / iPad:** Apple has no install prompt, so the button shows the steps: Safari →
  **Share** → **Add to Home Screen** → **Add**. On iPhone the installed app keeps its own save,
  separate from Safari, so progress from Safari doesn't carry over.
- **Other Android browsers:** shows the Android steps (menu ⋮ → **Add to Home screen**).
- The button is hidden when the game is already running as an installed app, and on desktop
  browsers that can't install it.

## Adding a new skin

A skin is a single entry in [`skins.js`](skins.js). There are two kinds:

- **New artwork**: your own picture of the gorilla (for example, the Miku and Racer skins).
- **Recolour**: the default gorilla repainted in new colours. No image file is needed (for example, Yeti and Golden).

### Option A: a skin with new artwork

**1. Get the picture ready.**
It should show the character side-on and facing **right**. PNG or JPG both work. The
background should be one of:

- **transparent** (PNG),
- **solid black**, or
- **solid white**, which is common for JPGs.

**2. Turn it into a sprite.**
From the project folder, run the line that matches your picture's background:

```powershell
# Black background
powershell -ExecutionPolicy Bypass -File tools\make-skin.ps1 -Source C:\path\to\picture.png -Name NinjaGorilla

# White background
powershell -ExecutionPolicy Bypass -File tools\make-skin.ps1 -Source C:\path\to\picture.jpg -Name NinjaGorilla -Background White

# Already transparent
powershell -ExecutionPolicy Bypass -File tools\make-skin.ps1 -Source C:\path\to\picture.png -Name NinjaGorilla -KeepBackground
```

The script:

- removes the background,
- crops the character, scales it to the gorilla's size and stands it on the same ground line,
- saves `Assets\Player\256x256NinjaGorilla.png` (used by the game) and
  `Assets\Player\NinjaGorilla.png` (a full-size copy to keep as source art),
- tells you what `scale` to use if the character is much shorter than the gorilla.

Open the 256x256 file and check it:

- **Patches of background trapped inside the character**, such as inside a sword's hand
  guard or between an arm and the body: run it again with `-FillHoles` added. It only clears
  large, flat patches of pure background colour, so white clothing is kept.
- **Specks of background left around the edge:** run it again with a higher `-Threshold`, for
  example `-Threshold 10` for black backgrounds (the default is 3) or `-Threshold 60` for white
  ones (the default is 40).
- **The character's outline or pale parts get eaten away:** use a lower `-Threshold`.

**3. Add it to `skins.js`.**
Add a line to the `SKINS` list:

```js
{ id: 'ninja', name: 'Ninja', price: 400, bestRun: 1000,
    image: 'Assets/Player/256x256NinjaGorilla.png' },
```

Skins appear in the Shop's Skins tab in the same order as the list.

**4. Bump the version.**
Raise `VERSION` in [`sw.js`](sw.js) (for example `'3.6.0'` → `'3.6.1'`). Players then download
the new image and keep it for offline play. Also raise `VERSION` in [`engine.js`](engine.js),
which is the version number shown on the menu.

**5. Test it.**
Serve the folder with a local web server. For example, run `npx serve .` in the project folder,
or use the VS Code "Live Server" extension. Then open the address it prints. Opening `index.html` directly as a file works, but recoloured skins
then show in their original colours.

### Option B: a recoloured skin (no image)

Skip steps 1 and 2 and give the entry a `recolor` instead of an `image`:

```js
{ id: 'ocean', name: 'Ocean', price: 250, bestRun: 600,
    recolor: { fur: '#1c4f8a', skin: '#7fe0ff' } },
```

- `fur` repaints the dark fur.
- `skin` repaints the face, hands and feet.

You can give one colour or both. The artwork's shading and black outline are kept. Then bump
the versions (step 4).

## Skin settings

| Setting | Required | What it does |
|---|---|---|
| `id` | yes | Unique internal name. Players' saves store it, so **never change it** after the skin has been released. |
| `name` | yes | Name shown in the Shop. |
| `price` | yes | Cost in banked bananas. `0` makes it free and owned from the start. |
| `bestRun` | no | Metres the player must reach **in one run** before they can buy it. |
| `totalRun` | no | Metres the player must run **across all runs** before they can buy it. |
| `image` | no | Path to the 256x256 sprite. Leave it out to use the default gorilla. |
| `recolor` | no | `{ fur: '#hex', skin: '#hex' }` repaints the image. |
| `scale` | no | Draws the skin bigger while keeping it on the ground, for example `1.25` for the Racer. |

If a skin has both `bestRun` and `totalRun`, the player needs both. A locked skin shows a
progress bar for each goal it's missing.

## Good to know

- **Skins are only cosmetic.** Every skin uses the gorilla's hitbox, so a bigger or smaller
  character is never easier or harder to play.
- **Balancing prices:** a run earns roughly 1 banana for every 8–10 metres. A 500 m run
  banks about 50–60 bananas.
- **Skin distance goals are all above 1,000 m.** The biggest head start power-up puts you at
  1,000 m, so a head start alone never unlocks a skin. Keep new goals above that too.
- **Where progress is saved:** banked bananas, lifetime distance, owned skins and stored
  power-ups are kept in the browser (`localStorage`, key `harunbe.progress.v1`). Records are
  stored separately, under `harunbe.records.v2`.
- **Removing a skin:** players who bought it just lose it from the list, and the game falls
  back to the default gorilla if it was equipped.

## Power-ups

Power-ups are bought in the Shop's **Power-ups** tab and stored, up to 99 of each. During a run
they show as buttons along the bottom of the screen. Press a button, or its number key, to use
one. Each power-up can be used once per run, and any you don't press stay in storage.

| Power-up | Key | Effect | Price |
|---|---|---|---|
| 🛡️ Shield | 1 | Blocks the next hit, for the rest of the run | 🍌 150 |
| 🧲 Magnet | 2 | Pulls in nearby bananas for 15 s | 🍌 60 |
| ×2 Double | 3 | Bananas count double for 20 s | 🍌 80 |
| ⚡ Head start 600 / 800 / 1,000 m | 4 / 5 / 6 | Skips ahead. Only in the first 60 m, one per run | 🍌 150 / 250 / 400 |

All of these (prices, durations, keys, the 99 cap and the 60 m head-start window) are in
[`powerups.js`](powerups.js). A head start's distance counts toward the run, the Top 5 lists and
skin goals. It skips that stretch's bananas.

## Project layout

| File | Contents |
|---|---|
| `skins.js` | The skin catalog. |
| `powerups.js` | The power-up catalog: prices, durations, keys, storage cap. |
| `engine.js` | Game rules: physics, speed and difficulty (`CONFIG`), enemy patterns, fairness checks. |
| `game.js` | Everything in the browser: drawing, input, screens, records, the Shop, power-ups. |
| `sw.js` | Offline support (service worker). |
| `tools/make-skin.ps1` | Turns a picture into a skin sprite. |
| `tools/fairness-test.js` | `node tools/fairness-test.js` checks that every enemy group can be cleared. Run it after changing difficulty. |
| `tools/density-report.js` | `node tools/density-report.js` prints how many enemies arrive per second at each stage of a run. |
