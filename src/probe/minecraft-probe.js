const {
  readString,
  readUnsignedShort,
  readVarInt,
  writeString,
  writeVarInt
} = require('./varint');

function decodeFrame(buffer) {
  const packetLength = readVarInt(buffer, 0);

  if (!packetLength) {
    return null;
  }

  const frameEnd = packetLength.size + packetLength.value;

  if (buffer.length < frameEnd) {
    return null;
  }

  const packetData = buffer.subarray(packetLength.size, frameEnd);
  const packetId = readVarInt(packetData, 0);

  if (!packetId) {
    return null;
  }

  return {
    packetId: packetId.value,
    payload: packetData.subarray(packetId.size),
    size: frameEnd
  };
}

function decodeHandshakePayload(payload) {
  let offset = 0;

  const protocolVersion = readVarInt(payload, offset);
  if (!protocolVersion) return null;
  offset += protocolVersion.size;

  const serverAddress = readString(payload, offset);
  if (!serverAddress) return null;
  offset += serverAddress.size;

  const serverPort = readUnsignedShort(payload, offset);
  if (!serverPort) return null;
  offset += serverPort.size;

  const nextState = readVarInt(payload, offset);
  if (!nextState) return null;

  return {
    protocolVersion: protocolVersion.value,
    serverAddress: serverAddress.value,
    serverPort: serverPort.value,
    nextState: nextState.value
  };
}

function decodeHandshakeFrame(buffer) {
  const frame = decodeFrame(buffer);

  if (!frame || frame.packetId !== 0x00) {
    return null;
  }

  const handshake = decodeHandshakePayload(frame.payload);

  if (!handshake) {
    return null;
  }

  return {
    ...handshake,
    frameSize: frame.size
  };
}

function decodeLoginStartFrame(buffer) {
  const frame = decodeFrame(buffer);

  if (!frame || frame.packetId !== 0x00) {
    return null;
  }

  const username = readString(frame.payload, 0);

  return {
    frameSize: frame.size,
    packetId: frame.packetId,
    username: username?.value ?? null,
    payloadHex: frame.payload.toString('hex')
  };
}

function decodeStatusRequestFrame(buffer) {
  const frame = decodeFrame(buffer);

  if (!frame) {
    return null;
  }

  return {
    frameSize: frame.size,
    packetId: frame.packetId,
    payloadHex: frame.payload.toString('hex')
  };
}

function buildPacket(packetId, payload = Buffer.alloc(0)) {
  const body = Buffer.concat([writeVarInt(packetId), payload]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

function buildStatusResponse(status) {
  const json = JSON.stringify(status);
  return buildPacket(0x00, writeString(json));
}

function buildDisconnect(reasonText) {
  return buildPacket(0x00, writeString(JSON.stringify({ text: reasonText })));
}

module.exports = {
  buildDisconnect,
  buildStatusResponse,
  decodeFrame,
  decodeHandshakeFrame,
  decodeLoginStartFrame,
  decodeStatusRequestFrame
};
