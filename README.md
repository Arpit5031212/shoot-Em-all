# Shoot 'Em All

Neon arcade shooter in plain HTML5 canvas + JavaScript (no dependencies).
You hold the centre; aim and hold to fire at waves of enemies coming from every side.
Pick a booster after every wave (max 3 held, drop one to swap); every 5 waves a boss arrives, drawn from 11 bosses with their own skills (see `BOSSES` in `src/js/game.js`).

- `npm run dev`: local server at http://localhost:5173/src/
- `npm run build`: writes `dist/` and `build/shoot-em-all.zip` for CrazyGames

Code: `src/js/game.js` (gameplay + rendering), `main.js` (UI/flow), `platform.js` (CrazyGames SDK v3 wrapper),
`audio.js` (synthesized sound effects). See `UPLOAD.md` for the publishing checklist.
