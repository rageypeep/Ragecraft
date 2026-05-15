# Ragecraft Handoff

## Current Goal

The last task was to complete the top two unchecked `World` TODO items:

- `Add world seed support so terrain is reproducible from config.`
- `Add cave carving so hills are not solid all the way through.`

That work is partially implemented, but the test suite is currently not in a clean passing state.

## What Was Changed

### `src/world.js`

Seeded world generation was added:

- `DEFAULT_WORLD_OPTIONS.seed = 'ragecraft'`
- `hashStringSeed(...)` added
- terrain, biome region selection, and tree generation now use `worldOptions.seedHash`
- `world.seed` is now exposed from `createInitialWorldPackets(...)`

Simple cave carving was added:

- `CAVE_SPAWN_CLEAR_RADIUS` added
- `getCaveSignal(...)`
- `shouldCarveCave(...)`
- chunk fill loop now skips some underground blocks to create air pockets

### `src/config.js`

World seed config was added:

- `DEFAULTS.world.seed = 'ragecraft'`
- env var support: `MC_WORLD_SEED`

### `README.md`

Docs were updated to mention:

- seeded terrain generation
- `MC_WORLD_SEED`
- caves in the current world generator

### `TODO.md`

These two items were ticked off:

- `[x] Add world seed support so terrain is reproducible from config.`
- `[x] Add cave carving so hills are not solid all the way through.`

### `scripts/smoke-test.js`

I started updating the smoke test to stop assuming a perfectly flat spawn column:

- added `collectWorldSignature(...)`
- added `countUndergroundAir(...)`
- added assertions for deterministic same-seed / different-seed behavior
- added a cave-presence assertion
- started converting block interaction checks to use the live safe-spawn column

I also added temporary stage logs while debugging:

- `console.log('[smoke] ...')`

Those are still in the file and should be removed once the test hang is resolved.

## Current Problem

`npm test` is hanging.

Observed behavior:

- `npm test` times out instead of failing fast with a normal assertion
- `node scripts/smoke-test.js` also stalled
- I confirmed separately that:
  - `createInitialWorldPackets(...)` is still fast
  - basic server startup is still fast
  - basic `1.21.11` login works
  - isolated raw `26.1.2` compatibility login + shutdown also works

So the problem is likely inside the updated smoke-test flow, not the basic runtime server path.

## Likely Next Investigation Steps

1. Fix `scripts/smoke-test.js` first before trusting the new TODO completion.
2. Narrow the exact stall point in the smoke test.
3. Remove temporary `[smoke]` debug logs after the hang is resolved.
4. Re-run:
   - `node scripts/smoke-test.js`
   - `node scripts/probe-test.js`
   - `npm test`

## Likely Causes To Check

- The smoke test still has some assumptions tied to the old flat world.
- One or more `waitForPacket(...)` or `once(...)` paths may now wait forever because the world interaction coordinates changed.
- The new seed/cave assertions may be valid, but the test may still be using stale hardcoded locations in later sections.
- The temporary debug logs did not print during the stalled run, so the hang may happen very early in `main()` or output may not be flushing before the external timeout.

## Files To Revisit First

- [scripts/smoke-test.js](</E:/games/MC server/scripts/smoke-test.js:1>)
- [src/world.js](</E:/games/MC server/src/world.js:1>)
- [src/config.js](</E:/games/MC server/src/config.js:1>)
- [TODO.md](</E:/games/MC server/TODO.md:1>)

## Suggested Cleanup Once Fixed

- remove temporary `[smoke]` debug logging
- only keep the seed/cave assertions that are stable and high-signal
- re-check whether `TODO.md` should keep those two items ticked, based on the final passing test state
