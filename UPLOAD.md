# Shoot 'Em All: CrazyGames upload checklist

## 1. Build
```
npm run build
```
Upload **`build/shoot-em-all.zip`** (index.html sits at the zip root, about 16 KB, 6 files).

Test locally first with `npm run dev` and open http://localhost:5173/src/.
On localhost the CrazyGames SDK runs in `local` mode and shows demo ads, so the
continue and play-again ad flows can be tested.
Add `?debug` to the URL for test hooks (`Game.debug.god(true)`, `Game.debug.drop('bomb')`).
These hooks only switch on with that parameter.

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
> Hold the centre. Blast everything. Survive endless waves of neon enemies, chain kills into combos and shoot power-ups to grab them.

**Description**
> You're the core, and everything on screen wants to reach you. Aim and hold to fire as waves of
> enemies close in from every side. Darts rush in, zigzaggers weave, splitters break into
> swarms and tanks soak up your bullets. Chain kills for up to x5 score, and shoot power-ups to
> grab Spread Shot, Rapid Fire, Shields, Bombs and extra lives. How many waves can you survive?

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

## 4. Preview video (you still need to record this)
Requirements: 15–20 s, max 50 MB, **no sound**, no cursor, no fast-forward,
no black bars, no promo text. Needs **two versions: 1080p landscape (16:9) and portrait (2:3)**.
Start on the cover art.

Suggested way to record it:
1. Open `http://localhost:5173/src/?debug` in Chrome at 1920×1080 (F11 fullscreen).
2. Press Play. In DevTools run `Game.debug.god(true); Game.S.wave = 6`.
   That gives you a busy screen and you can't die while recording.
3. Shoot a few power-ups (`Game.debug.drop('spread')`, `'bomb'`) to show them off.
4. Record with OBS (cursor hidden), trim to about 18 s.
5. Repeat in a 800×1200 window (DevTools device toolbar) for the portrait version.

## 5. What the SDK integration does (for the QA form)
- `loadingStart` / `loadingStop` around boot
- `gameplayStart` when a run starts, resumes or continues; `gameplayStop` on pause, game over and menu
- **Midgame ad** before each *Play Again* (never on the first play, never during gameplay)
- **Rewarded ad**: one "Continue" per run on the game-over screen. The player gets 1 life and a shield
  only after `adFinished`; on `adError` they get nothing and see "No ad available"
- Audio mutes on `adStarted` and unmutes on `adFinished` / `adError`; UI is blocked while an ad runs
- Respects `settings.muteAudio` (live, via the settings listener)
- `happytime()` on a new best score
- Saves go through `SDK.data` (falls back to localStorage when the SDK isn't there)
- Speed is the same at any refresh rate (time-based movement); pauses itself when the tab is hidden
- `user-select: none`, no page scroll or zoom on touch, safe-area padding, no fullscreen button,
  no external links. The only external request is the CrazyGames SDK script.
