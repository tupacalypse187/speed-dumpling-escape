# CLAUDE.md — Guidance for AI Coding Assistants

## Project Overview

**Speed Dumpling Escape** is a 2D side-view incremental platformer ("+1 Speed" obby genre)
built with React 19 + TypeScript + Vite 7 + Tailwind CSS 3. All gameplay renders on a
single HTML5 canvas inside a React shell (title screen, HUD, panels). There is no game
engine — physics, rendering, audio and persistence are hand-rolled in `src/game/`.

## Commands

```bash
npm run dev       # dev server (vite; CLI --port/--host flags pass through)
npm run build     # tsc -b && vite build — MUST pass clean before committing
npm run preview   # serve the production build
```

**Always run `npm run build` before committing.** The build type-checks strictly
(`noUnusedLocals`, `noUnusedParameters`, strict null checks).

## Architecture Map (`src/game/`)

| Module | Responsibility |
| --- | --- |
| `game.ts` | The `Game` class: RAF loop, player physics, camera, hub/obby worlds, ALL canvas rendering (player, pets, platforms, pads, portals, particles), interactions, records, ceremonies. Talks to React only through `GameCallbacks` (onHud / onToast / onPauseToggle / onPetsToggle / onOpenShop / onSaveChanged). |
| `levels.ts` | Infinite-level math (`levelThreshold`, ~2.2× growth past Lv 4, 2-sig-fig rounding), level colors/names, milestone skins, shared physics constants (`GRAV`, `JUMP_V`, `JUMP_AIRTIME`, `JUMP_HEIGHT`), world types (`ObbyDef`, `Platform`, `PadDef`, `MovingPlatformDef`, `Hazard`), hand-crafted Obbies 1–3, and `PRACTICE_OBBY` (id `-2`, reqLevel 0): a free-play drill course with `labels` + `checkpoints` (optional `ObbyDef` fields) and no rewards. |
| `generator.ts` | Seeded deterministic procedural obbies (mulberry32). `generateSeededObby` is the shared core (numbered obbies + weekly). Exports `verifyObby` / `verifyCoins` — feasibility re-checkers. |
| `weekly.ts` | ISO-week key, Monday rollover countdown, weekly course builder + reward rules. |
| `pets.ts` | Pet definitions: passive bonuses + progression-based unlock predicates. |
| `shop.ts` | Hats, trail color packs, speed charms (price curves). |
| `achievements.ts` | Achievement definitions + `checkAchievements(ctx, unlockedSet)`. |
| `audio.ts` | `AudioManager`: 100% Web Audio synthesis — SFX + chiptune BGM scheduler. Music/SFX volume buses under a master mute gain. No audio files. |
| `save.ts` | `SaveData` schema (versioned; v5 adds `settings.ghost` + `ghosts`), `loadSave` with **graceful migration** from every older shape, `storeSave`, `fmtTime`. Same localStorage key across versions; migrate in place. |

Ghost replays (v5): `Game` records non-practice obby runs at 10 Hz as
`GhostSample = [t, x, y, facing, airborne]`; on a new best time the recording is
stored under `ghosts[String(obbyId)]` (or `ghosts["w:<weekKey>"]` for weekly,
older weeks pruned). `renderGhost` replays it as a translucent cyan dumpling;
`settings.ghost` toggles playback from the pause menu. Practice mode never
records and never plays ghosts.

React side (`src/App.tsx`): title screen, HUD overlay, Trophy Room, Pets panel,
Shop panel, Pause menu, toast stack. Any open overlay pauses the game loop.

## Key Conventions

- **Canvas rendering**: logical view is 1280×720, letterboxed + devicePixelRatio-scaled.
  World rendering happens inside a camera transform; screen-space FX (speed lines,
  flash, motes) after `ctx.restore()`. Squash-and-stretch via scale transforms.
- **Difficulty philosophy**: obbies must be *comfortable at the required level's speed*.
  Generated gaps use 55–70% of the jump distance at the requirement; hard cap 95%.
  Challenge comes from spikes/movers/timing. NEVER generate a barely-makeable jump.
- **Generator discipline**: everything procedural is seeded + deterministic (mulberry32).
  After changing the generator, re-run `verifyObby`/`verifyCoins` over a wide id range
  (bundle with `npx esbuild … --format=esm --platform=node` and check in node).
- **Persistence discipline**: every new piece of state goes into `SaveData` with a
  migration-safe default in `loadSave` (never break old saves; bump the schema comment
  version). Save via `storeSave` through the game's `snapshot()`/`flushSave()`.
- **Audio discipline**: synthesize everything with oscillators; add new SFX as methods
  on `AudioManager`; respect the music/SFX volume buses and mute.
- **Performance**: hold 60fps. Particles are pooled/capped (`MAX_PARTICLES`), HUD emits
  throttle to ~8Hz, saves flush dirty-flagged every 2s + on events.
- **React ↔ game boundary**: React never reaches into game internals; use public methods
  (`activateMultiplier`, `tryRebirth`, `equipPet`, `buyHat`, …) and callbacks.

## Rules

1. Run `npm run build` clean before every commit.
2. Never commit `node_modules/`, `dist/`, logs, or env files (see `.gitignore`).
3. New persisted state ⇒ extend `SaveData` + migration in the same change.
4. New procedural content ⇒ seeded + deterministic + verifier-checked.
5. Keep the cute smoosh-dumpling aesthetic: pastel palette, rounded shapes, big juice.
6. Commits are GPG-signed (repo-local config); do not disable signing.
