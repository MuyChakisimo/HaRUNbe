# HaRUNbe

An endless jungle runner. Jump over tigers and hawks, collect bananas, and spend them on skins for your gorilla.

## Adding a new skin

A skin is a single entry in [`skins.js`](skins.js). There are two kinds:

- **New artwork**: your own picture of the gorilla (for example, the Miku and Racer skins).
- **Recolour**: the default gorilla repainted in new colours. No image file is needed (for example, Yeti and Golden).

### Option A: a skin with new artwork

**1. Get the picture ready.**
It should show the character side-on and facing **right**. The background should be either
transparent or solid pure black, which is how most AI image tools export.

**2. Turn it into a sprite.**
From the project folder, run:

```powershell
powershell -ExecutionPolicy Bypass -File tools\make-skin.ps1 -Source C:\path\to\picture.png -Name PirateGorilla
```

The script:

- removes the black background (add `-KeepBackground` if the picture is already transparent),
- crops the character, scales it to the gorilla's size and stands it on the same ground line,
- saves `Assets\Player\256x256PirateGorilla.png` (used by the game) and
  `Assets\Player\PirateGorilla.png` (a full-size copy to keep as source art),
- tells you what `scale` to use if the character is much shorter than the gorilla.

Open the 256x256 file and check it. If specks of background are left, run the script again
with a higher `-Threshold`, such as `-Threshold 10`. If the character's dark outline gets eaten
away, use a lower value.

**3. Add it to `skins.js`.**
Add a line to the `SKINS` list:

```js
{ id: 'pirate', name: 'Pirate', price: 400, bestRun: 1000,
    image: 'Assets/Player/256x256PirateGorilla.png' },
```

Skins appear in the Skins screen in the same order as the list.

**4. Bump the version.**
Raise `VERSION` in [`sw.js`](sw.js) (for example `'3.1.1'` → `'3.1.2'`). Players then download
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
| `name` | yes | Name shown in the Skins screen. |
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
- **Where progress is saved:** banked bananas, lifetime distance and owned skins are stored in
  the browser (`localStorage`, key `harunbe.progress.v1`). Records are stored separately, under
  `harunbe.records.v2`.
- **Removing a skin:** players who bought it just lose it from the list, and the game falls
  back to the default gorilla if it was equipped.

## Project layout

| File | Contents |
|---|---|
| `skins.js` | The skin catalog. |
| `engine.js` | Game rules: physics, speed and difficulty (`CONFIG`), enemy patterns, fairness checks. |
| `game.js` | Everything in the browser: drawing, input, screens, records, the skin shop. |
| `sw.js` | Offline support (service worker). |
| `tools/make-skin.ps1` | Turns a picture into a skin sprite. |
| `tools/fairness-test.js` | `node tools/fairness-test.js` checks that every enemy group can be cleared. Run it after changing difficulty. |
