# Ragecraft TODO

## Bugs

- [x] Investigate the underground pond/cave rendering artifact where repeated white "posts" appear under pond floors in generated terrain.
- [x] Investigate why blocks in that underground pond/cave artifact area can sometimes be broken but not placed back, suggesting a client/server state mismatch or chunk/interaction bounds bug.
- [x] Investigate the remaining thin black lighting seam artifact still visible across some terrain cuts and slopes; the final fix ended up being a combination of corrected chunk/light templates and better skylight propagation on top surfaces and opaque side walls.

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
- [x] Add larger tree variety and better density rules per biome.
- [x] Add basic cliff, ridge, and shoreline shaping so biome borders feel less abrupt.
- [x] Add chunk-population passes for features that must cross chunk borders cleanly.
- [x] Add bedrock/foundation rules and proper world bottom shaping.
- [x] Add a real landform pass above raw noise so continents have structural zones instead of only per-column biome picks.
- [x] Build explicit landform bands:
  coastal lowlands near sea level
  interior plains / rolling country
  uplands
  foothills
  mountain cores
  alpine shelves / basins
- [x] Route biome choice through landforms so plains, forests, meadows, foothills, and peaks spawn where the larger terrain shape supports them.
- [x] Keep coastal lowlands broad enough for beaches and stony shores to feel natural instead of squeezed between ocean and uplands.
- [x] Revisit mountain transitions after the landform pass so foothills and uplands carry more of the climb before peak terrain starts.
- [x] Rebuild rivers later as real terrain corridors that follow the landform pass, not as an overlay carved on top.
- [x] Add a real server-side lighting model instead of the current pragmatic flat-sky path.
- [x] Add dynamic light update packets after block changes so lighting stays correct without relying on full chunk resend behavior.
- [x] Add emissive / block-light propagation for torches, lava, glowstone, and other light sources instead of skylight-only baking.
- [x] Add border-aware relighting across neighboring chunks so lighting does not break at chunk edges.
- [x] Add simple mob-safe spawn area rules so new players do not appear inside dense terrain or trees.
- [x] Add configurable world height/depth ranges instead of one fixed terrain band.

## Protocol

- [x] Replace compatibility-mode packet id guesses with generated codec metadata.
- [x] Cover more clientbound play packets beyond the current join path.
- [x] Cover more serverbound play packets beyond movement, settings, and keepalive.
- [x] Capture and document every confirmed `26.1.2` protocol difference in `porting/26.1.2/`.

## Server

- [x] Rework the temporary chunk-stream lighting workaround in [src/server.js](/E:/games/MC%20server/src/server.js:1); the old neighbor-send gate and relight spam are gone, and chunk loading is much closer to normal again.
- [x] Target the remaining join hitch path, especially synchronous safe-spawn resolution and any chunk-stream warm-up stalls still visible after startup.
- [x] Add player persistence.
- [x] Add commands.
- [x] Add entity tracking.
- [x] Add world save/load support.
- [x] Turn the new vanilla recipe import and `/craft` groundwork into a basic real crafting UI flow with player-inventory packet handling.
- [x] Expand crafting beyond the player `2x2` inventory grid with opened-container `3x3` crafting-table support.

## Crafting

- [x] Expand container interactions further: shift-click, drag-splitting, and recipe-book sync.
- [x] Add proper container-close cleanup and item return behavior for every open inventory path, not just the current crafting table.
- [x] Add client-visible recipe discovery / declaration flow so the recipe book can become usable instead of only server-side matching.
- [x] Add more real block containers after crafting tables, starting with chest semantics and then furnace-style processing inventories.
- [x] Add furnace-style processing inventories after chest support.
- [x] Add authoritative inventory transfer rules for edge cases: full inventories, cursor overflow, invalid swaps, and disconnect/reconnect during open containers.
- [ ] Revisit persistence around open containers so mid-session saves and unclean disconnects cannot duplicate or lose items.
- [ ] Add gameplay smoke coverage for core recipes:
  logs -> planks
  planks -> crafting table
  planks ring -> chest
  sticks / tools / furnace / torch paths

## Native 26.1.2 Port

- [ ] Build a full item-id compatibility map from Mojang `26.1.2` registry reports instead of ad-hoc slot fixes, and route every slot/item-bearing packet through it consistently.
- [ ] Audit every compatibility packet that still depends on `1.21.11` structure assumptions, especially inventory, entity metadata, recipes, tags, and registry-driven payloads.
- [ ] Generate or import native `26.1.2` protocol metadata for Prismarine packet codecs instead of relying on the handwritten play packet remap layer.
- [ ] Replace the local compatibility registry override path with a native `26.1.2` registry dataset once enough Mojang schema is captured.
- [ ] Replace the local configuration-tag shim with native `26.1.2` tag data wired directly into the protocol stack.
- [ ] Identify the minimum upstream changes needed in `minecraft-data` for native `26.1.2` support:
  protocol.json
  registries
  tags
  blocks / items / entities / menu ids
- [ ] Identify the minimum upstream changes needed in `minecraft-protocol` for native `26.1.2` support:
  handshake/login/config/play state definitions
  serializer/deserializer support
  configuration transition behavior
  slot / item / NBT schema differences
- [ ] Prove that Ragecraft can boot cleanly on a native `26.1.2` Prismarine base with the local compatibility rewriters disabled.
- [ ] Remove shims in stages once native support exists:
  packet-id remapper
  inbound play rewriter
  registry override loader
  compatibility tag loader
  item-id translator
  block-state translator where native data makes it unnecessary
- [ ] Upstream what can be upstreamed, then shrink local Ragecraft-only protocol code to version-specific edge cases instead of carrying a parallel stack.
