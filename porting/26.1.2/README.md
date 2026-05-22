# Porting 26.1.2

This directory tracks the local porting effort for Minecraft Java Edition `26.1.2`.

## Current status

- Official Mojang metadata confirms `26.1.2` is the latest release as of `2026-05-14`
- `minecraft-protocol@1.66.2` and `minecraft-data@3.110.2` do not support `26.1.2`
- The playable server in `src/` still targets the latest supported Prismarine version
- A raw TCP probe is available to capture the real `26.1.2` handshake and login-start packets
- An experimental compatibility mode now accepts protocol `775` while using `1.21.11` packet data as a fallback
- A generated compatibility report now lives in [compatibility-report.md](./compatibility-report.md)
- Chunk section serialization, light template shaping, top-surface skylight baking, and opaque side-wall skylight propagation were corrected enough to remove the visible terrain seam / striping artifact
- The expensive stream-time neighborhood gating workaround has been removed, and chunk loading performance is much closer to normal again

## Why the probe exists

`minecraft-protocol` needs exact protocol information before we can port server support cleanly:

- numeric protocol version
- packet framing compatibility
- login packet layout
- any early disconnect/compression/encryption differences

The probe gives us a safe way to capture that from a real `26.1.2` client without pretending support already exists.

## Confirmed findings

- The `26.1.2` client handshakes with protocol version `775`
- `login_start` still begins with the username field
- The captured `login_start` packet includes a trailing 16-byte player UUID
- The local compatibility server can parse a raw `775` handshake and login-start packet well enough to reach the `login` event
- The generated play packet map currently resolves `138` clientbound and `66` serverbound play packets
- The current compatibility layer needs `14` registry override roots and `15` configuration tag types

## How to use it

1. Run:

```powershell
npm run probe:26.1.2
```

2. In the Minecraft launcher, create a `26.1.2` installation and connect to `localhost:25566`.

3. Watch the terminal for:

- the numeric protocol version from the handshake
- the login-start packet bytes
- the username and next-state values

4. Save the output and use it as the baseline for the next porting pass.

## Next targets

- profile any remaining chunk-load hitch path now that the shadow artifact and the temporary send-time lighting workaround are both gone
- verify the now-fixed chunk/light behavior against a few fresh `26.1.2` reconnects so future protocol work does not accidentally reintroduce the old terrain shadow artifact
- keep treating `1.21.11` as the packet-data base while verifying each remaining `26.1.2` chunk/light assumption against Mojang reports or decompiled client/server behavior

## Native Port Checklist

The local shim layer is now large enough that the realistic long-term goal is native `26.1.2` Prismarine support, not indefinite compatibility patching inside Ragecraft.

The current Ragecraft-specific compatibility pieces already outline what native support must absorb:

- generated play packet id map
- inbound play packet id rewriter
- compatibility registry override loader
- compatibility tag loader
- block-state translator
- item-id translator
- custom light / inventory / slot packet adaptations discovered during testing

The practical native-port order should be:

1. Finish extracting authoritative `26.1.2` source data from Mojang reports.
   Required sets:
   - protocol packet ids and packet shapes
   - dynamic registries
   - tags
   - blocks / items / entities / menu ids

2. Build the missing `26.1.2` data additions in `minecraft-data`.
   Target areas:
   - `protocol.json`
   - registry datasets
   - tag datasets
   - item/block/entity/menu lookup tables

3. Patch `minecraft-protocol` for any real runtime/schema differences that `minecraft-data` alone does not solve.
   Most likely areas:
   - handshake/login/config/play transitions
   - serializer/deserializer expectations
   - slot / item / metadata layout differences
   - configuration-state sequencing

4. Re-run Ragecraft against that native `26.1.2` base with local rewriters disabled one by one.
   Remove in this order where possible:
   - packet remapper
   - inbound rewriter
   - registry overrides
   - tag overrides
   - item-id translator
   - block-state translator

5. Upstream what can be upstreamed and keep only Ragecraft-specific behavior local.

Success condition:

- Ragecraft runs `26.1.2` with native Prismarine data/code paths
- the current local compatibility files become migration history, not active runtime dependencies
