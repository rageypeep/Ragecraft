# Ragecraft Server

Experimental Minecraft-compatible server software written in Node.js.

Ragecraft started as a protocol-level experiment using `minecraft-protocol`, but has now grown into a small custom server project with a working world bootstrap, basic block interaction, inventory sync, and a compatibility bridge for modern Minecraft Java clients.

It is not a full survival server yet. It is a research/playground project for learning how Minecraft multiplayer works under the hood.

## Current status

Ragecraft can currently:

- respond to the Minecraft multiplayer server list ping
- accept offline-mode joins
- support Minecraft Java `26.1.2` through a compatibility shim
- complete login, configuration, registry loading, and play-state entry
- spawn a player into a minimal world
- send chunks and lighting data
- allow basic movement
- support mining and block placement
- sync a simple hotbar/inventory
- persist early world/block state experiments

The current `26.1.2` support is not native. It uses `1.21.11` packet data as a base, with manual overrides for newer registry, tag, and packet behaviour.

In other words: it works, but it is gloriously cursed.

## Why this exists

Minecraft multiplayer is far more complex than it looks from the outside.

Ragecraft is a way to explore:

- the Minecraft Java protocol
- login/configuration/play state transitions
- dynamic registry loading
- packet ID remapping
- chunk and lighting bootstrapping
- block updates
- inventory packets
- world persistence
- eventually, custom gameplay systems

The long-term idea is to build a Minecraft-compatible experimental server with its own systems, web tooling, and possibly a Nuxt/Three.js admin interface.

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
```
localhost:25565
```
By default, ```npm start``` targets the current compatibility path.
To explicitly run the ```26.1.2``` compatibility mode:
```PowerShell
$env:MC_VERSION='26.1.2'
npm start
```
To run the older native Prismarine-supported base:
```PowerShell
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
| `MC_IS_FLAT` | `false` | Flat world flag |
| `MC_WELCOME_MESSAGE` | `Welcome to Ragecraft, {username}.` | Join message |
| `MC_SPAWN_X` | `0` | Spawn X |
| `MC_SPAWN_Y` | `256` | Spawn Y |
| `MC_SPAWN_Z` | `0` | Spawn Z |
| `MC_SPAWN_YAW` | `0` | Spawn yaw |
| `MC_SPAWN_PITCH` | `0` | Spawn pitch |

## 26.1.2 porting notes

Minecraft Java `26.1.2` uses protocol `775`.

The Prismarine stack does not currently provide full native support for this version, so Ragecraft uses a compatibility bridge:

```text
26.1.2 client
→ protocol 775
→ Ragecraft compatibility shim
→ 1.21.11 packet data base
→ manual packet/registry/tag overrides
```

Known areas that needed work:

- login-start UUID payload
- configuration registry loading
- dynamic registry schema changes
- tag payload changes
- play-state packet ID remapping
- light/bootstrap packet ordering
- inventory slot field mapping

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

## Roadmap

### Short-term

- dropped item entities
- item pickup
- better world save/load
- proper block/item ID mapping
- more stable chunk persistence
- clean up `26.1.2` packet remaps
- reduce compatibility hacks where possible

### Medium-term

- multiple players in the same world
- entity tracking
- player persistence
- command handling
- better world generation
- basic survival loop
- block breaking rules
- inventory merging and stack logic

### Long-term

- plugin/module system
- web dashboard
- Three.js world/admin viewer
- live server controls
- custom events
- AI/NPC experiments
- experimental gameplay systems

## Project philosophy

Ragecraft is not trying to be Paper, Spigot, Fabric, or a production-ready Minecraft server.

It is a learning project and protocol playground.

The goal is to understand the pieces Minecraft normally hides:

```text
handshake
→ login
→ configuration
→ registries
→ play state
→ chunks
→ lighting
→ block updates
→ inventory
→ world simulation
```

If it works, brilliant.

If it breaks, that probably means there is another packet to bully into submission.

## Disclaimer

Ragecraft is an unofficial experimental project.

It is not affiliated with Mojang, Microsoft, or Minecraft.

Minecraft is a trademark of Microsoft/Mojang. This project does not include Minecraft assets and is intended for protocol research, learning, and custom server experimentation.
