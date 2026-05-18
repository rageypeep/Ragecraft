const { closeMinecraftServer, createMinecraftServer } = require('./server');
const { createWorldMapServer } = require('./debug/world-map-server');

const { config, server } = createMinecraftServer();
const debugMapServer = createWorldMapServer({
  config,
  protocolDataVersion: server.protocolDataVersion,
  world: server.world
});

if (debugMapServer) {
  void debugMapServer.start()
    .then(() => {
      console.log(`[debug-map] listening on ${debugMapServer.url}`);
    })
    .catch((error) => {
      console.error('[debug-map:error] failed to start', error);
    });
}

server.on('listening', () => {
  const address = server.socketServer.address();
  console.log(
    `[server] listening on ${address.address}:${address.port} for Minecraft ${server.advertisedVersion} (protocol ${server.advertisedProtocolVersion}, packet base ${server.protocolDataVersion})`
  );
  console.log(
    `[server] requested version ${server.requestedVersion}, advertised version ${server.advertisedVersion}`
  );
  if (server.compatibility) {
    console.log(
      `[server] compatibility mode active for protocol ${server.advertisedProtocolVersion} using ${server.compatibility.baseVersion} packet data`
    );
    console.log(
      `[server] loaded ${server.compatibilityRegistryOverrideCount} registry overrides and ${server.compatibilityTagTypeCount} tag types for ${server.advertisedVersion}`
    );
  }
  console.log('[server] press Ctrl+C to stop');
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[server] ${signal} received, shutting down`);

  try {
    if (debugMapServer) {
      await debugMapServer.close().catch((error) => {
        console.error('[debug-map:error] failed to close cleanly', error);
      });
    }
    await closeMinecraftServer(server);
    console.log('[server] closed cleanly');
    process.exit(0);
  } catch (error) {
    console.error('[server:error] failed to close cleanly', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('uncaughtException', (error) => {
  console.error('[server:error] uncaught exception', error);
});

process.on('unhandledRejection', (error) => {
  console.error('[server:error] unhandled rejection', error);
});

module.exports = {
  config,
  server
};
