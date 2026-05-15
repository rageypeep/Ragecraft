# Ragecraft TODO

## Next

- [x] Replace the temporary compatibility remap table with a generated `26.1.2` packet map from Mojang reports.
- [x] Add authoritative block digging and placement handling so client-side fake mining is corrected immediately.
- Send block update packets after denied interactions instead of letting the client believe blocks were broken.
- Expand chat support for the `26.1.2` compatibility path instead of suppressing it.
- [x] Add proper inventory bootstrap and held-item state.
- Add join/respawn safety checks so spawn is always on solid ground.
- Add visible dropped item entities instead of immediate auto-pickup.

## World

- Replace the temporary flat bootstrap platform with a real chunk generator.
- Add configurable platform material, size, and thickness.
- Populate biomes intentionally so grass and foliage colors are correct.
- Stream chunks beyond the initial bootstrap area.

## Protocol

- Replace compatibility-mode packet id guesses with generated codec metadata.
- Cover more clientbound play packets beyond the current join path.
- Cover more serverbound play packets beyond movement, settings, and keepalive.
- Capture and document every confirmed `26.1.2` protocol difference in `porting/26.1.2/`.

## Server

- Add player persistence.
- Add commands.
- Add entity tracking.
- [x] Add world save/load support.
