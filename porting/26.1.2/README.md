# Porting 26.1.2

This directory tracks the local porting effort for Minecraft Java Edition `26.1.2`.

## Current status

- Official Mojang metadata confirms `26.1.2` is the latest release as of `2026-05-14`
- `minecraft-protocol@1.66.2` and `minecraft-data@3.110.2` do not support `26.1.2`
- The playable server in `src/` still targets the latest supported Prismarine version
- A raw TCP probe is available to capture the real `26.1.2` handshake and login-start packets
- An experimental compatibility mode now accepts protocol `775` while using `1.21.11` packet data as a fallback
- A generated compatibility report now lives in [compatibility-report.md](./compatibility-report.md)

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

- capture and record the `26.1.2` protocol number
- compare early packet flow against `1.21.11`
- vendor local protocol metadata instead of waiting on upstream
- patch the server bootstrap so it can instantiate a `26.1.2` serializer/deserializer path
- identify the first packet after login/configuration where `26.1.2` diverges from `1.21.11`
