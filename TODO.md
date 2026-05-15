# Ragecraft TODO

## Next

- [x] Replace the temporary compatibility remap table with a generated `26.1.2` packet map from Mojang reports.
- [x] Add authoritative block digging and placement handling so client-side fake mining is corrected immediately.
- [x] Send block update packets after denied interactions instead of letting the client believe blocks were broken.
- [x] Expand chat support for the `26.1.2` compatibility path instead of suppressing it.
- [x] Add proper inventory bootstrap and held-item state.
- [x] Add join/respawn safety checks so spawn is always on solid ground.
- [x] Add visible dropped item entities instead of immediate auto-pickup.

## World

- [x] Replace the temporary flat bootstrap platform with a real chunk generator.
- [x] Add configurable platform material, size, and thickness.
- [x] Populate biomes intentionally so grass and foliage colors are correct.
- [x] Stream chunks beyond the initial bootstrap area.
- [x] Add world seed support so terrain is reproducible from config.
- [x] Add cave carving so hills are not solid all the way through.
- [x] Add ore generation and underground stone variants.
- [x] Add water generation for ponds, lakes, and simple coastlines.
- [x] Add biome-specific surface palettes beyond the current grass/dirt/stone mix.
- [x] Add surface decoration like tall grass, flowers, and mushrooms.
- Add larger tree variety and better density rules per biome.
- [x] Add basic cliff, ridge, and shoreline shaping so biome borders feel less abrupt.
- Add chunk-population passes for features that must cross chunk borders cleanly.
- Add bedrock/foundation rules and proper world bottom shaping.
- Add a real server-side lighting model instead of the current pragmatic flat-sky path.
- Add simple mob-safe spawn area rules so new players do not appear inside dense terrain or trees.
- Add configurable world height/depth ranges instead of one fixed terrain band.

## Protocol

- [x] Replace compatibility-mode packet id guesses with generated codec metadata.
- [x] Cover more clientbound play packets beyond the current join path.
- [x] Cover more serverbound play packets beyond movement, settings, and keepalive.
- [x] Capture and document every confirmed `26.1.2` protocol difference in `porting/26.1.2/`.

## Server

- Add player persistence.
- Add commands.
- Add entity tracking.
- [x] Add world save/load support.
