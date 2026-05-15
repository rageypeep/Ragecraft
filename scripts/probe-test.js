const assert = require('node:assert/strict');
const {
  buildStatusResponse,
  decodeFrame,
  decodeHandshakeFrame,
  decodeLoginStartFrame
} = require('../src/probe/minecraft-probe');
const { writeString, writeVarInt } = require('../src/probe/varint');

function buildHandshakePacket({ protocolVersion, host, port, nextState }) {
  const payload = Buffer.concat([
    writeVarInt(protocolVersion),
    writeString(host),
    Buffer.from([port >> 8, port & 0xff]),
    writeVarInt(nextState)
  ]);
  const packet = Buffer.concat([writeVarInt(0x00), payload]);
  return Buffer.concat([writeVarInt(packet.length), packet]);
}

function buildLoginStartPacket(username) {
  const payload = writeString(username);
  const packet = Buffer.concat([writeVarInt(0x00), payload]);
  return Buffer.concat([writeVarInt(packet.length), packet]);
}

const handshakePacket = buildHandshakePacket({
  protocolVersion: 1234,
  host: 'localhost',
  port: 25565,
  nextState: 2
});

const handshake = decodeHandshakeFrame(handshakePacket);
assert.ok(handshake);
assert.equal(handshake.protocolVersion, 1234);
assert.equal(handshake.serverAddress, 'localhost');
assert.equal(handshake.serverPort, 25565);
assert.equal(handshake.nextState, 2);

const loginStartPacket = buildLoginStartPacket('SmokeTester');
const loginStart = decodeLoginStartFrame(loginStartPacket);
assert.ok(loginStart);
assert.equal(loginStart.username, 'SmokeTester');

const statusResponse = buildStatusResponse({
  version: { name: '26.1.2 probe', protocol: 1234 },
  players: { max: 0, online: 0, sample: [] },
  description: { text: 'probe' }
});

const frame = decodeFrame(statusResponse);
assert.ok(frame);
assert.equal(frame.packetId, 0x00);

console.log('Probe tests passed.');
