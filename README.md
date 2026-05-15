# Ragecraft Server

Starter Minecraft server software built with `minecraft-protocol`.

This is a protocol-level scaffold, not a full survival server yet. Right now it does four useful things:

- responds to the multiplayer server list ping
- accepts offline-mode joins
- spawns players into a minimal empty world state
- relays chat messages between connected players

It also includes an experimental compatibility mode for `26.1.2` that accepts protocol `775` while still using `1.21.11` packet data underneath. That is a bridge for porting, not full native support.

## Quick start

1. Install dependencies:

```powershell
npm install
```

2. Start the server:

```powershell
npm start
```

3. Join from Minecraft Java Edition using `localhost:25565`.

`npm start` now defaults to the `26.1.2` compatibility path. To force another target explicitly, start with:

```powershell
$env:MC_VERSION='26.1.2'
npm start
```

To run the old native Prismarine-supported base instead:

```powershell
$env:MC_VERSION='1.21.11'
npm start
```

## 26.1.2 porting

`26.1.2` is the current Java release, but the Prismarine stack in this project does not ship native support for it yet. A manual porting workspace now exists in [porting/26.1.2/README.md](</E:/games/MC server/porting/26.1.2/README.md:1>).

To capture the real handshake and login-start packet from a `26.1.2` client, run:

```powershell
npm run probe:26.1.2
```

Then connect from a `26.1.2` client to `localhost:25566`.

The probe already confirmed:

- `26.1.2` uses protocol `775`
- `login_start` still carries username plus a 16-byte player UUID payload
- the first compatibility break is in configuration registry loading

You can generate a `26.1.2` configuration tag payload from Mojang's inner server jar with:

```powershell
npm run generate:2612-tags
```

You can also generate raw `26.1.2` registry override data for the currently failing registries with:

```powershell
npm run generate:2612-registry-overrides
```

## Scripts

- `npm start` runs the server
- `npm run dev` runs the server in watch mode
- `npm test` runs a local smoke test
- `npm run probe:26.1.2` runs a raw TCP probe for the `26.1.2` handshake
- `npm run fetch:version-meta` fetches Mojang metadata for `26.1.2`

## Environment variables

- `MC_HOST` default `0.0.0.0`
- `MC_PORT` default `25565`
- `MC_VERSION` default `26.1.2`
- `MC_MOTD` default `Ragecraft Node Server`
- `MC_MAX_PLAYERS` default `20`
- `MC_ONLINE_MODE` default `false`
- `MC_ENCRYPTION` default `false`
- `MC_VIEW_DISTANCE` default `10`
- `MC_IS_FLAT` default `false`
- `MC_WELCOME_MESSAGE` default `Welcome to Ragecraft, {username}.`
- `MC_SPAWN_X` default `0`
- `MC_SPAWN_Y` default `256`
- `MC_SPAWN_Z` default `0`
- `MC_SPAWN_YAW` default `0`
- `MC_SPAWN_PITCH` default `0`

## What to build next

- chunk streaming so players have a real world instead of the void
- movement validation and entity tracking
- command handling
- persistence for players and world state
- plugin or module hooks once the core loop is stable
