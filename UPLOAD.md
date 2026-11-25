# Shoot 'Em All: CrazyGames upload checklist

## 1. Build
```
npm run build
```
Upload **`build/shoot-em-all.zip`** (index.html sits at the zip root, about 34 KB, 6 files).

Test locally first with `npm run dev` and open http://localhost:5173/src/.
On localhost the CrazyGames SDK runs in `local` mode and shows demo ads, so the
continue and play-again ad flows can be tested.
Add `?debug` to the URL for test hooks. These hooks only switch on with that parameter:
- `Game.debug.god(true)`: you can't die
- `Game.debug.wave(5)`: jump to a wave (every 5th wave is a boss)
- `Game.debug.boss('pincers')`: fight a specific boss now (`Game.debug.bosses()` lists them)
- `Game.debug.upgrade('drone', 3)`: give yourself boosters (ignores the 3-slot limit)
- `Game.debug.drop('bomb')`: spawn a power-up

## 2. Developer portal (developer.crazygames.com)
You need to do this part yourself: create the account, fill in the form, submit.

| Field | Suggested value |
|---|---|
| Title | Shoot 'Em All |
| Category | Action → Shooting (alt: Arcade) |
| Tags | shooter, arcade, survival, neon, one-button, mouse, touch |
| Engine | HTML5 / Other (plain JavaScript) |
| Orientation | Both (responsive, works in landscape and portrait) |
| Mobile | Yes (touch: hold to fire) |
| Progress Save | **ON**. The game stores best score and mute setting through the SDK data module. |
| Launch type | Start with **Basic Launch**. The SDK is already integrated, so request **Full Launch** once you have the stats. |

**Short description**
> Hold the centre. Blast everything. Build your gun from three boosters and survive 11 different bosses.

**Description**
> You're the core, and everything on screen wants to reach you. Aim and hold to fire as waves of
> enemies close in from every side. Darts rush in, zigzaggers weave, splitters break into
> swarms and tanks soak up your bullets, and every enemy that gets through takes a bite out of
> your health bar. You have three lives.
> After every wave, pick a booster: piercing bullets, side cannons, orbiting drones, chain
> lightning, critical hits, a damage-soaking shield and more. You can only hold three at a time,
> so every pick is a trade-off. Push your fire rate too hard and the gun overheats, so watch the
> heat meter.
> Every 5 waves one of 11 bosses arrives, each with its own trick: a Teleporter that blinks across
> the screen, Pincers that revive each other, a Slider that races along the walls, a Jack in the
> Box with a Hive inside, and more. Every boss bursts out a swarm of enemies each time it loses a
> quarter of its health. Beat a boss to restore your health and win back a life. Mini bosses
> crash the regular waves too.
> Lose a life and your boosters scatter across the arena: shoot them to get them back.
> Chain kills for up to x5 score and shoot power-ups to grab Spread Shot, Rapid Fire, Shields,
> Heals and Bombs. How many waves can you survive?

**Controls**
- Mouse: aim, click or hold to fire
- Touch: tap or hold where you want to shoot
- Space: fire · P / Esc: pause · M: mute

## 3. Covers (already generated in `store/`)
- `store/cover-landscape-1920x1080.png` (16:9)
- `store/cover-portrait-800x1200.png` (2:3)
- `store/cover-square-800x800.png` (1:1)

To regenerate them: run `npm run dev`, open http://localhost:5173/store/covers.html and press **Save**.
They follow the cover rules: only the title as text, no borders, logos or "Play" text.

## 4. Preview videos (already recorded in `store/`)
- `store/preview-landscape-1920x1080.mp4` (16:9, 18.5 s, about 28 MB)
- `store/preview-portrait-1080x1620.mp4` (2:3, 18.5 s, about 30 MB)

They meet the rules: 15–20 s, under 50 MB, **no sound**, no cursor, real speed, no black bars,
no promo text, and each **opens on its static cover**, then fades into gameplay.
The gameplay is a busy wave 12 with mini bosses, Spread and Rapid pick-ups, ending on a bomb.
The videos are large, so git ignores them. Keep a copy before cleaning the folder.

To re-record them (for example after changing the look of the game):
1. `npm run dev`, then open `http://localhost:5173/src/?debug` in Chrome.
2. In DevTools, turn on the device toolbar and set the size to 1920×1080 (DPR 1).
3. In the console run:
   ```js
   await import('/tools/record-preview.js')
   recordPreview({ name: 'preview-landscape-1920x1080.mp4', cover: '/store/cover-landscape-1920x1080.png', W: 1920, H: 1080 })
   ```
   It takes about 19 s and writes the MP4 into `store/`.
4. Reload at 1080×1620 and run it again with
   `{ name: 'preview-portrait-1080x1620.mp4', cover: '/store/cover-portrait-800x1200.png', W: 1080, H: 1620 }`.

## 5. What the SDK integration does (for the QA form)
- `loadingStart` / `loadingStop` around boot
- `gameplayStart` when a run starts, resumes or continues; `gameplayStop` on pause, booster choice, game over and menu
- **Midgame ad** before each *Play Again* (never on the first play, never during gameplay)
- **Rewarded ad**: one "Continue" per run on the game-over screen. The player gets 1 life (full HP), a 5-second revive shield, and a chance to shoot their boosters back
  only after `adFinished`; on `adError` they get nothing and see "No ad available"
- Audio mutes on `adStarted` and unmutes on `adFinished` / `adError`; UI is blocked while an ad runs
- Respects `settings.muteAudio` (live, via the settings listener)
- `happytime()` on a new best score
- Saves go through `SDK.data` (falls back to localStorage when the SDK isn't there)
- Speed is the same at any refresh rate (time-based movement); pauses itself when the tab is hidden
- `user-select: none`, no page scroll or zoom on touch, safe-area padding, no fullscreen button,
  no external links. The only external request is the CrazyGames SDK script.
