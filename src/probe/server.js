const net = require('node:net');
const {
  buildDisconnect,
  buildStatusResponse,
  decodeFrame,
  decodeHandshakeFrame,
  decodeLoginStartFrame,
  decodeStatusRequestFrame
} = require('./minecraft-probe');

const config = {
  host: process.env.MC_PROBE_HOST ?? '0.0.0.0',
  port: Number.parseInt(process.env.MC_PROBE_PORT ?? '25566', 10),
  advertisedVersionName: process.env.MC_PROBE_VERSION_NAME ?? '26.1.2 probe',
  motd: process.env.MC_PROBE_MOTD ?? '26.1.2 handshake probe',
  disconnectReason: process.env.MC_PROBE_DISCONNECT_REASON ?? 'Probe captured login; no play support yet.'
};

function buildStatus(protocolVersion = -1) {
  return {
    version: {
      name: config.advertisedVersionName,
      protocol: protocolVersion
    },
    players: {
      max: 0,
      online: 0,
      sample: []
    },
    description: {
      text: config.motd
    }
  };
}

function logPacket(prefix, details) {
  console.log(`[probe] ${prefix} ${JSON.stringify(details)}`);
}

const server = net.createServer((socket) => {
  const remote = `${socket.remoteAddress}:${socket.remotePort}`;
  let buffer = Buffer.alloc(0);
  let handshake = null;
  let state = 'handshake';

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      const frame = decodeFrame(buffer);

      if (!frame) {
        return;
      }

      const packetBuffer = buffer.subarray(0, frame.size);
      buffer = buffer.subarray(frame.size);

      if (state === 'handshake') {
        handshake = decodeHandshakeFrame(packetBuffer);

        if (!handshake) {
          logPacket('invalid-handshake', { remote, packetHex: packetBuffer.toString('hex') });
          socket.end();
          return;
        }

        logPacket('handshake', { remote, ...handshake });
        state = handshake.nextState === 1 ? 'status' : handshake.nextState === 2 ? 'login' : 'unknown';
        continue;
      }

      if (state === 'status') {
        const statusFrame = decodeStatusRequestFrame(packetBuffer);

        if (statusFrame?.packetId === 0x00) {
          logPacket('status-request', { remote, ...statusFrame });
          socket.write(buildStatusResponse(buildStatus(handshake?.protocolVersion)));
          continue;
        }

        if (statusFrame?.packetId === 0x01) {
          logPacket('status-ping', { remote, payloadHex: statusFrame.payloadHex });
          socket.write(packetBuffer);
          continue;
        }

        logPacket('status-unknown', { remote, packetHex: packetBuffer.toString('hex') });
        socket.end();
        return;
      }

      if (state === 'login') {
        const loginStart = decodeLoginStartFrame(packetBuffer);

        logPacket('login-start', {
          remote,
          protocolVersion: handshake?.protocolVersion ?? null,
          username: loginStart?.username ?? null,
          packetHex: packetBuffer.toString('hex'),
          payloadHex: loginStart?.payloadHex ?? null
        });

        socket.write(buildDisconnect(config.disconnectReason));
        socket.end();
        return;
      }

      logPacket('unexpected-state', { remote, state, packetHex: packetBuffer.toString('hex') });
      socket.end();
      return;
    }
  });

  socket.on('error', (error) => {
    console.error('[probe:error] socket', remote, error);
  });
});

server.on('listening', () => {
  const address = server.address();
  console.log(`[probe] listening on ${address.address}:${address.port}`);
  console.log('[probe] connect with a 26.1.2 client to capture its handshake and login-start packet');
});

server.on('error', (error) => {
  console.error('[probe:error] server', error);
  process.exitCode = 1;
});

server.listen(config.port, config.host);
