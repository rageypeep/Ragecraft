# Ragecraft Server

Experimental Minecraft-compatible server software written in Node.js.

Ragecraft started as a protocol experiment built on top of `minecraft-protocol`. It has since turned into a small custom server project with a working world generator, block interaction, inventory bootstrap, chunk streaming, persistence, and a compatibility bridge for Minecraft Java `26.1.2`.

It is still not a full survival server. The project is primarily a learning playground for understanding how Minecraft multiplayer works under the hood.

## Current status

Ragecraft can currently:

- respond to the multiplayer server list ping
- accept offline-mode joins
- support Minecraft Java `26.1.2` through a compatibility shim
- complete login, configuration, registry loading, and play-state entry
- generate a seeded floating world with mixed biome regions
- stream chunks around the player as they move
- send chunk and lighting bootstrap data
- support basic movement
- support mining and block placement
- spawn visible dropped item entities and collect them on contact
- sync a simple hotbar/inventory
- persist modified world blocks to disk

The generated world currently includes:

- seeded terrain
- caves
- ore pockets and underground stone variants
- ponds and simple shoreline shaping
- biome-specific surface palettes
- trees
- surface decoration such as short grass, ferns, flowers, and mushrooms
- a dedicated `plains` biome pass with flatter grassland shaping, sparse oak trees, denser grass cover, and tulip / wildflower patches
- a dedicated `sunflower_plains` biome pass with sunflower-heavy grasslands built on top of the plains rules
- a dedicated `forest` biome pass with denser oak growth, grass-first terrain, and fern / mushroom decoration
- a dedicated `flower_forest` biome pass with lighter tree cover, heavier flower generation, and more frequent bee nests
- a dedicated `birch_forest` biome pass with dense birch growth and classic birch-forest decoration
- a dedicated `old_growth_birch_forest` biome pass with many taller birches, including trunks up to 14 blocks high
- a dedicated `taiga` biome pass with conifer-heavy tree generation, ferns, large ferns, and sweet berry bushes
- a dedicated `river` biome pass that carves water channels with mixed riverbeds, seagrass, and sparse bank vegetation
- ridge / cliff variation so terrain no longer looks like simple wave math

The `26.1.2` support is not native Prismarine support. Ragecraft uses `1.21.11` packet data as a base and patches newer registry, tag, and packet behavior manually.

## Why this exists

Minecraft multiplayer is much more complicated than it looks from the outside.

Ragecraft exists to explore:

- handshake, login, configuration, and play-state transitions
- dynamic registries and tag loading
- packet ID remapping across versions
- chunk and lighting bootstrapping
- block updates and inventory sync
- world generation and persistence
- eventually, custom gameplay systems and tooling

The long-term goal is to build a Minecraft-compatible experimental server with its own systems, web tooling, and potentially a Three.js or Nuxt-based admin interface.

## Quick start

Install dependencies:

```bash
npm install
```

Start the server:

```bash
npm start
```

Then join from Minecraft Java Edition using:

```text
localhost:25565
```

By default, `npm start` targets the current `26.1.2` compatibility path.

To explicitly run `26.1.2` mode:

```powershell
$env:MC_VERSION='26.1.2'
npm start
```

To run the older native Prismarine-supported base:

```powershell
$env:MC_VERSION='1.21.11'
npm start
```

## Configuration

Environment variables:

| Variable | Default | Description |
|---|---:|---|
| `MC_HOST` | `0.0.0.0` | Host address |
| `MC_PORT` | `25565` | Server port |
| `MC_VERSION` | `26.1.2` | Target Minecraft version |
| `MC_MOTD` | `Ragecraft Node Server` | Server list MOTD |
| `MC_MAX_PLAYERS` | `20` | Max player count |
| `MC_ONLINE_MODE` | `false` | Online-mode authentication |
| `MC_ENCRYPTION` | `false` | Encryption toggle |
| `MC_VIEW_DISTANCE` | `10` | View distance |
| `MC_IS_FLAT` | `false` | Flat-world flag exposed to the client |
| `MC_WELCOME_MESSAGE` | `Welcome to Ragecraft, {username}.` | Join message |
| `MC_SPAWN_X` | `0` | Spawn X |
| `MC_SPAWN_Y` | `96` | Spawn Y |
| `MC_SPAWN_Z` | `0` | Spawn Z |
| `MC_SPAWN_YAW` | `0` | Spawn yaw |
| `MC_SPAWN_PITCH` | `0` | Spawn pitch |
| `MC_WORLD_MIXED_BIOMES` | `true` | Enable simple biome regions instead of one uniform biome |
| `MC_WORLD_SEED` | `ragecraft` | Seed string used for deterministic terrain generation |
| `MC_WORLD_CHUNK_RADIUS` | `2` | Initial generated radius around spawn, in chunks |
| `MC_WORLD_STREAM_RADIUS` | `MC_VIEW_DISTANCE` | Streamed chunk radius around each player |
| `MC_TERRAIN_THICKNESS` | `12` | Terrain thickness |
| `MC_TERRAIN_AMPLITUDE` | `4` | Terrain height variation |
| `MC_WORLD_BIOME` | `plains` | Biome used when mixed biomes are disabled |
| `MC_SURFACE_BLOCK` | `grass_block` | Terrain surface block |
| `MC_SOIL_BLOCK` | `dirt` | Soil block under the surface |
| `MC_FOUNDATION_BLOCK` | `stone` | Deep terrain / foundation block |

Chunk streaming note:

- Ragecraft streams chunks in a radius around the player, like the real game.
- The default `MC_VIEW_DISTANCE=10` means a `21x21` loaded area around the player.
- If you want something closer to "about 32 chunks across", set `MC_WORLD_STREAM_RADIUS=16`, which gives a `33x33` area.

World generation note:

- By default, Ragecraft mixes plains, sunflower plains, flower forest, forest, birch forest, old growth birch forest, taiga, and river regions.
- Generation is deterministic. Changing `MC_WORLD_SEED` creates a different world while keeping chunk streaming and reloads consistent.
- Trees, caves, ponds, surface decoration, and underground variants are generated from the same seed.
- Biome work is now being split into dedicated files under `src/biomes/`, with `src/biomes/plains.js`, `src/biomes/sunflower-plains.js`, `src/biomes/forest.js`, `src/biomes/flower-forest.js`, `src/biomes/birch-forest.js`, `src/biomes/old-growth-birch-forest.js`, `src/biomes/taiga.js`, and `src/biomes/river.js` in place so far.
- Tree placement now has biome-specific density and shape rules across plains, sunflower plains, flower forest, forest, and birch forest.
- Cross-chunk terrain features are applied through dedicated population passes so ponds and trees stay clean across chunk borders.
- Surface palettes and decoration vary by biome so the mixed world does not collapse into one repeated grass-over-dirt look.
- Terrain height now comes from layered seeded noise, with ridge and cliff modulation, instead of obvious repeating wave patterns.
- If you want one uniform biome again, set `MC_WORLD_MIXED_BIOMES=false`.

## 26.1.2 compatibility

Minecraft Java `26.1.2` uses protocol `775`.

The Prismarine stack does not currently provide full native support for this version, so Ragecraft uses a compatibility bridge:

```text
26.1.2 client
-> protocol 775
-> Ragecraft compatibility shim
-> 1.21.11 packet data base
-> manual packet / registry / tag overrides
```

Areas that required custom work include:

- login-start UUID payload handling
- configuration registry loading
- dynamic registry schema changes
- tag payload changes
- play-state packet ID remapping
- light / bootstrap packet ordering
- inventory slot field mapping

Detailed notes live in [porting/26.1.2/README.md](porting/26.1.2/README.md) and [porting/26.1.2/compatibility-report.md](porting/26.1.2/compatibility-report.md).

## Useful scripts

Run the server:

```bash
npm start
```

Run in watch mode:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

Capture a raw `26.1.2` handshake/login-start packet:

```bash
npm run probe:26.1.2
```

Then connect a `26.1.2` client to:

```text
localhost:25566
```

Fetch Mojang version metadata:

```bash
npm run fetch:version-meta
```

Generate `26.1.2` configuration tags:

```bash
npm run generate:2612-tags
```

Generate `26.1.2` registry override data:

```bash
npm run generate:2612-registry-overrides
```

Generate `26.1.2` packet map:

```bash
npm run generate:2612-packet-map
```

Generate the `26.1.2` compatibility report:

```bash
npm run generate:2612-compat-report
```

## Roadmap

Current high-value next steps:

- larger tree variety and better density rules per biome
- chunk-population passes for features that must cross chunk borders cleanly
- bedrock / foundation rules and proper world bottom shaping
- real server-side lighting instead of the current pragmatic flat-sky approach
- player persistence
- commands
- entity tracking

See [TODO.md](TODO.md) for the working backlog.

## Project philosophy

Ragecraft is not trying to be Paper, Spigot, Fabric, or a production-ready Minecraft server.

It is a protocol playground and learning project.

The point is to understand the parts Minecraft normally hides:

```text
handshake
-> login
-> configuration
-> registries
-> play state
-> chunks
-> lighting
-> block updates
-> inventory
-> world simulation
```

If it works, good.

If it breaks, there is probably another packet to bully into submission.

## Disclaimer

Ragecraft is an unofficial experimental project.

It is not affiliated with Mojang, Microsoft, or Minecraft.

Minecraft is a trademark of Microsoft / Mojang. This project does not include Minecraft assets and is intended for protocol research, learning, and custom server experimentation.
