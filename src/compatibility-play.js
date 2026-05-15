const { Transform } = require('node:stream');
const { createSerializer } = require('minecraft-protocol/src/transforms/serializer');
const { readVarInt, writeVarInt } = require('./probe/varint');

const COMPATIBILITY_PLAY_PACKET_MAPS = {
  '26.1.2': require('../porting/26.1.2/play-packet-map.json')
};

const serializerCache = new Map();

function getCompatibilityPlayPacketMap(advertisedVersion) {
  return COMPATIBILITY_PLAY_PACKET_MAPS[advertisedVersion] ?? null;
}

function getPlaySerializer(baseVersion) {
  if (!serializerCache.has(baseVersion)) {
    serializerCache.set(
      baseVersion,
      createSerializer({
        isServer: true,
        state: 'play',
        version: baseVersion
      })
    );
  }

  return serializerCache.get(baseVersion);
}

function is2612Compatibility(server) {
  return server.compatibility?.advertisedVersion === '26.1.2';
}

function rewritePacketId(buffer, newPacketId) {
  const packetId = readVarInt(buffer, 0);

  if (!packetId) {
    throw new Error('Unable to decode packet id from compatibility packet buffer.');
  }

  return Buffer.concat([
    writeVarInt(newPacketId),
    buffer.subarray(packetId.size)
  ]);
}

function build2612SetTimePacket(packetId, params = {}) {
  const gameTimeValue = params.time ?? params.gameTime ?? 0n;
  const gameTime = typeof gameTimeValue === 'bigint' ? gameTimeValue : BigInt(gameTimeValue);
  const payload = Buffer.alloc(9);

  payload.writeBigInt64BE(gameTime, 0);
  payload[8] = 0; // empty clockUpdates map

  return Buffer.concat([
    writeVarInt(packetId),
    payload
  ]);
}

function rewriteIncomingPlayPacketBuffer(buffer, advertisedVersion) {
  const packetId = readVarInt(buffer, 0);

  if (!packetId) {
    return buffer;
  }

  const rewrittenPacketId = getCompatibilityPlayPacketMap(advertisedVersion)
    ?.serverboundPacketIdRewrites?.[packetId.value];

  if (rewrittenPacketId === undefined || rewrittenPacketId === packetId.value) {
    return buffer;
  }

  return rewritePacketId(buffer, rewrittenPacketId);
}

function createCompatibilityInboundPlayPacketRewriter(advertisedVersion) {
  return new Transform({
    transform(chunk, encoding, callback) {
      try {
        callback(null, rewriteIncomingPlayPacketBuffer(chunk, advertisedVersion));
      } catch (error) {
        callback(error);
      }
    }
  });
}

function buildCompatibilityPlayPacket(baseVersion, packetName, params, advertisedVersion) {
  const targetPacketId = getCompatibilityPlayPacketMap(advertisedVersion)
    ?.clientboundPacketIds?.[packetName];

  if (targetPacketId === undefined) {
    throw new Error(
      `No compatibility packet id override exists for ${advertisedVersion} play packet "${packetName}".`
    );
  }

  if (advertisedVersion === '26.1.2' && packetName === 'update_time') {
    return build2612SetTimePacket(targetPacketId, params);
  }

  const serializer = getPlaySerializer(baseVersion);
  const baseBuffer = serializer.createPacketBuffer({
    name: packetName,
    params
  });

  return rewritePacketId(baseBuffer, targetPacketId);
}

function writeCompatibilityLoginPacket(client, server, params) {
  writeCompatibilityPlayPacket(client, server, 'login', params);
}

function writeCompatibilityPositionPacket(client, server, params) {
  writeCompatibilityPlayPacket(client, server, 'position', params);
}

function writeCompatibilityPlayPacket(client, server, packetName, params) {
  client.writeRaw(
    buildCompatibilityPlayPacket(
      server.protocolDataVersion,
      packetName,
      params,
      server.advertisedVersion
    )
  );
}

module.exports = {
  buildCompatibilityPlayPacket,
  createCompatibilityInboundPlayPacketRewriter,
  getCompatibilityPlayPacketMap,
  is2612Compatibility,
  rewriteIncomingPlayPacketBuffer,
  writeCompatibilityPlayPacket,
  writeCompatibilityLoginPacket,
  writeCompatibilityPositionPacket
};
