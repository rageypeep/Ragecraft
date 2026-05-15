const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const mc = require('minecraft-protocol');
const {
  buildCompatibilityPlayPacket,
  getCompatibilityPlayPacketMap,
  rewriteIncomingPlayPacketBuffer
} = require('../src/compatibility-play');
const { createPlayerInventory, toProtocolSlot } = require('../src/inventory');
const { closeMinecraftServer, createMinecraftServer } = require('../src/server');
const { createInitialWorldPackets } = require('../src/world');
const { decodeFrame } = require('../src/probe/minecraft-probe');
const { readString, readVarInt, writeString, writeVarInt } = require('../src/probe/varint');

function waitForPacket(emitter, eventName, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      emitter.off(eventName, onPacket);
      reject(new Error(`Timed out waiting for ${eventName}.`));
    }, timeoutMs);

    function onPacket(packet) {
      if (!predicate(packet)) {
        return;
      }

      clearTimeout(timeout);
      emitter.off(eventName, onPacket);
      resolve(packet);
    }

    emitter.on(eventName, onPacket);
  });
}

async function pingServer(host, port, version) {
  return new Promise((resolve, reject) => {
    mc.ping({ host, port, version }, (error, response) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(response);
    });
  });
}

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

function buildLoginStartPacket(username, playerUuidHex) {
  const payload = Buffer.concat([
    writeString(username),
    Buffer.from(playerUuidHex, 'hex')
  ]);
  const packet = Buffer.concat([writeVarInt(0x00), payload]);
  return Buffer.concat([writeVarInt(packet.length), packet]);
}

async function testExperimental2612Compatibility() {
  const port = 25571;
  const compatibilityBaseData = require('minecraft-data')('1.21.11');
  const worldSavePath = path.join(process.cwd(), 'tmp', 'smoke-test', 'compat-world.json');
  const { server } = createMinecraftServer({
    host: '127.0.0.1',
    port,
    version: '26.1.2',
    motd: '26.1.2 Compatibility Test',
    worldSavePath
  });

  await once(server, 'listening');

  const catVariant = server.options.registryCodec['minecraft:cat_variant'].entries
    .find((entry) => entry.key === 'minecraft:all_black');
  assert.equal(
    catVariant.value.value.baby_asset_id?.value,
    'minecraft:entity/cat/cat_all_black_baby'
  );

  const catSoundVariantKeys = server.options.registryCodec['minecraft:cat_sound_variant'].entries
    .map((entry) => entry.key)
    .sort();
  assert.deepEqual(catSoundVariantKeys, ['minecraft:classic', 'minecraft:royal']);

  const chickenSoundVariantKeys = server.options.registryCodec['minecraft:chicken_sound_variant'].entries
    .map((entry) => entry.key)
    .sort();
  assert.deepEqual(chickenSoundVariantKeys, ['minecraft:classic', 'minecraft:picky']);

  const cowSoundVariantKeys = server.options.registryCodec['minecraft:cow_sound_variant'].entries
    .map((entry) => entry.key)
    .sort();
  assert.deepEqual(cowSoundVariantKeys, ['minecraft:classic', 'minecraft:moody']);

  const pigSoundVariantKeys = server.options.registryCodec['minecraft:pig_sound_variant'].entries
    .map((entry) => entry.key)
    .sort();
  assert.deepEqual(pigSoundVariantKeys, ['minecraft:big', 'minecraft:classic', 'minecraft:mini']);

  const overworld = server.options.registryCodec['minecraft:dimension_type'].entries
    .find((entry) => entry.key === 'minecraft:overworld');
  assert.equal(overworld.value.value.default_clock?.value, 'minecraft:overworld');

  const worldClockKeys = server.options.registryCodec['minecraft:world_clock'].entries
    .map((entry) => entry.key)
    .sort();
  assert.deepEqual(worldClockKeys, ['minecraft:overworld', 'minecraft:the_end']);

  const compatibilityTagTypes = server.compatibilityTags.map((tag) => tag.tagType);
  assert(compatibilityTagTypes.includes('minecraft:item'));
  assert(compatibilityTagTypes.includes('minecraft:block'));
  assert(compatibilityTagTypes.includes('minecraft:entity_type'));
  assert(compatibilityTagTypes.includes('minecraft:enchantment'));

  const compatibilityPlayPacketMap = getCompatibilityPlayPacketMap(server.advertisedVersion);
  assert.equal(compatibilityPlayPacketMap.baseVersion, '1.21.11');
  assert.equal(compatibilityPlayPacketMap.clientboundPacketIds.login, 49);
  assert.equal(compatibilityPlayPacketMap.clientboundPacketIds.map_chunk, 45);
  assert.equal(compatibilityPlayPacketMap.clientboundPacketIds.abilities, 64);
  assert.equal(compatibilityPlayPacketMap.clientboundPacketIds.set_player_inventory, 108);
  assert.equal(compatibilityPlayPacketMap.clientboundPacketIds.held_item_slot, 105);
  assert.equal(compatibilityPlayPacketMap.serverboundPacketIdRewrites[14], 13);
  assert.equal(compatibilityPlayPacketMap.serverboundPacketIdRewrites[28], 27);

  const aquaAffinity = server.options.registryCodec['minecraft:enchantment'].entries
    .find((entry) => entry.key === 'minecraft:aqua_affinity');
  assert.equal(aquaAffinity.value.value.effects.value['minecraft:attributes'].value.type, 'compound');
  assert.equal(
    aquaAffinity.value.value.effects.value['minecraft:attributes'].value.value[0]
      .amount.value.base.type,
    'float'
  );

  const quickCharge = server.options.registryCodec['minecraft:enchantment'].entries
    .find((entry) => entry.key === 'minecraft:quick_charge');
  assert.equal(
    quickCharge.value.value.effects.value['minecraft:crossbow_charge_time'].value.value.value.base.type,
    'float'
  );

  const soulSpeed = server.options.registryCodec['minecraft:enchantment'].entries
    .find((entry) => entry.key === 'minecraft:soul_speed');
  assert.equal(
    soulSpeed.value.value.effects.value['minecraft:location_changed'].value.value[0]
      .effect.value.effects.value.value[1].amount.type,
    'float'
  );

  const compatibilityLoginPacket = buildCompatibilityPlayPacket(
    server.protocolDataVersion,
    'login',
    {
      ...compatibilityBaseData.loginPacket,
      entityId: 7,
      isHardcore: false,
      gameMode: 0,
      previousGameMode: 1,
      hashedSeed: [0, 0],
      maxPlayers: 20,
      viewDistance: 10,
      reducedDebugInfo: false,
      enableRespawnScreen: true,
      isDebug: false,
      isFlat: true,
      enforceSecureChat: false
    },
    server.advertisedVersion
  );
  assert.equal(readVarInt(compatibilityLoginPacket, 0)?.value, 49);

  const compatibilityKeepAlivePacket = buildCompatibilityPlayPacket(
    server.protocolDataVersion,
    'keep_alive',
    {
      keepAliveId: 123
    },
    server.advertisedVersion
  );
  assert.equal(readVarInt(compatibilityKeepAlivePacket, 0)?.value, 44);

  const rewrittenClientInformationPacket = rewriteIncomingPlayPacketBuffer(
    Buffer.concat([
      writeVarInt(14),
      writeString('en_gb'),
      Buffer.from([0x08, 0x00, 0x01]),
      writeVarInt(0),
      Buffer.from([0x01, 0x00, 0x01])
    ]),
    server.advertisedVersion
  );
  assert.equal(readVarInt(rewrittenClientInformationPacket, 0)?.value, 13);

  const rewrittenClientTickEndPacket = rewriteIncomingPlayPacketBuffer(
    writeVarInt(13),
    server.advertisedVersion
  );
  assert.equal(readVarInt(rewrittenClientTickEndPacket, 0)?.value, 12);

  const compatibilityPositionPacket = buildCompatibilityPlayPacket(
    server.protocolDataVersion,
    'position',
    {
      teleportId: 0,
      x: 0,
      y: 80,
      z: 0,
      dx: 0,
      dy: 0,
      dz: 0,
      yaw: 0,
      pitch: 0,
      flags: 0
    },
    server.advertisedVersion
  );
  assert.equal(readVarInt(compatibilityPositionPacket, 0)?.value, 72);

  const world = createInitialWorldPackets(compatibilityBaseData, {
    spawn: { x: 0, y: 96, z: 0, yaw: 0, pitch: 0 }
  });
  assert.equal(world.surfaceY, 95);
  assert.equal(world.chunks.length, 25);
  assert.equal(world.getBlockState({ x: 0, y: 95, z: 0 }), compatibilityBaseData.blocksByName.grass_block.defaultState);
  assert.equal(world.getBlockState({ x: 0, y: 94, z: 0 }), compatibilityBaseData.blocksByName.dirt.defaultState);
  assert.equal(world.getBlockState({ x: 0, y: 96, z: 0 }), compatibilityBaseData.blocksByName.air.defaultState);
  assert.deepEqual(
    world.resolvePlacedBlockLocation({ x: 0, y: 95, z: 0 }, 1),
    { x: 0, y: 96, z: 0 }
  );
  assert.equal(world.placeBlock({ x: 0, y: 96, z: 0 }), true);
  assert.equal(world.getBlockState({ x: 0, y: 96, z: 0 }), compatibilityBaseData.blocksByName.grass_block.defaultState);
  assert.equal(world.breakBlock({ x: 0, y: 96, z: 0 }).droppedItem.itemId, compatibilityBaseData.itemsByName.dirt.id);
  assert.equal(world.getBlockState({ x: 0, y: 96, z: 0 }), compatibilityBaseData.blocksByName.air.defaultState);

  const compatibilityMapChunkPacket = buildCompatibilityPlayPacket(
    server.protocolDataVersion,
    'map_chunk',
    world.chunks[0],
    server.advertisedVersion
  );
  assert.equal(readVarInt(compatibilityMapChunkPacket, 0)?.value, 45);

  const compatibilityAbilitiesPacket = buildCompatibilityPlayPacket(
    server.protocolDataVersion,
    'abilities',
    {
      flags: 0x02,
      flyingSpeed: 0.05,
      walkingSpeed: 0.1
    },
    server.advertisedVersion
  );
  assert.equal(readVarInt(compatibilityAbilitiesPacket, 0)?.value, 64);

  const compatibilityInventory = createPlayerInventory(compatibilityBaseData);
  const compatibilitySetInventoryPacket = buildCompatibilityPlayPacket(
    server.protocolDataVersion,
    'set_player_inventory',
    {
      slotId: 0,
      contents: toProtocolSlot(compatibilityInventory.hotbar[0])
    },
    server.advertisedVersion
  );
  assert.equal(readVarInt(compatibilitySetInventoryPacket, 0)?.value, 108);

  const compatibilityGameEventPacket = buildCompatibilityPlayPacket(
    server.protocolDataVersion,
    'game_state_change',
    {
      reason: 'level_chunks_load_start',
      gameMode: 0
    },
    server.advertisedVersion
  );
  assert.equal(readVarInt(compatibilityGameEventPacket, 0)?.value, 38);

  const compatibilityLightUpdatePacket = buildCompatibilityPlayPacket(
    server.protocolDataVersion,
    'update_light',
    {
      chunkX: 0,
      chunkZ: 0,
      skyLightMask: world.chunks[0].skyLightMask,
      blockLightMask: world.chunks[0].blockLightMask,
      emptySkyLightMask: world.chunks[0].emptySkyLightMask,
      emptyBlockLightMask: world.chunks[0].emptyBlockLightMask,
      skyLight: world.chunks[0].skyLight,
      blockLight: world.chunks[0].blockLight
    },
    server.advertisedVersion
  );
  assert.equal(readVarInt(compatibilityLightUpdatePacket, 0)?.value, 48);

  const compatibilityViewPositionPacket = buildCompatibilityPlayPacket(
    server.protocolDataVersion,
    'update_view_position',
    {
      chunkX: 0,
      chunkZ: 0
    },
    server.advertisedVersion
  );
  assert.equal(readVarInt(compatibilityViewPositionPacket, 0)?.value, 94);

  const status = await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(buildHandshakePacket({
        protocolVersion: 775,
        host: 'localhost',
        port,
        nextState: 1
      }));
      socket.write(Buffer.from([0x01, 0x00]));
    });

    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const frame = decodeFrame(buffer);

      if (!frame) {
        return;
      }

      if (frame.packetId !== 0x00) {
        reject(new Error(`Unexpected status response packet id ${frame.packetId}`));
        socket.destroy();
        return;
      }

      const parsed = readString(frame.payload, 0);
      resolve(JSON.parse(parsed.value));
      socket.end();
    });

    socket.on('error', reject);
  });

  assert.equal(status.version.name, '26.1.2');
  assert.equal(status.version.protocol, 775);

  const loginPromise = once(server, 'login');
  const loginSocket = net.createConnection({ host: '127.0.0.1', port }, () => {
    loginSocket.write(buildHandshakePacket({
      protocolVersion: 775,
      host: 'localhost',
      port,
      nextState: 2
    }));
    loginSocket.write(buildLoginStartPacket('CompatTester', '1ad3cb1c50604ee4bf1fd891afbd9876'));
  });
  loginSocket.on('error', () => {});
  loginSocket.on('data', () => {});

  const [client] = await loginPromise;
  assert.equal(client.username, 'CompatTester');
  loginSocket.end();
  await once(loginSocket, 'close');

  await closeMinecraftServer(server);
}

async function main() {
  const port = 25570;
  const baseData = require('minecraft-data')('1.21.11');
  const tempDataDir = path.join(process.cwd(), 'tmp', 'smoke-test');
  const worldSavePath = path.join(tempDataDir, 'world.json');

  fs.rmSync(tempDataDir, { recursive: true, force: true });

  const { server } = createMinecraftServer({
    host: '127.0.0.1',
    port,
    version: '1.21.11',
    motd: 'Smoke Test Server',
    worldSavePath
  });

  await once(server, 'listening');

  const status = await pingServer('127.0.0.1', port, server.version);
  const descriptionText = typeof status.description === 'string'
    ? status.description
    : status.description?.text;

  assert.equal(descriptionText, 'Smoke Test Server');

  const client = mc.createClient({
    host: '127.0.0.1',
    port,
    username: 'SmokeTester',
    auth: 'offline',
    version: server.version
  });

  const bootstrapInventoryPromise = waitForPacket(
    client,
    'set_player_inventory',
    (packet) =>
      packet.slotId === 0 &&
      packet.contents.itemId === baseData.itemsByName.grass_block.id &&
      packet.contents.itemCount === 64
  );
  const bootstrapHeldSlotPromise = waitForPacket(
    client,
    'held_item_slot',
    (packet) => packet.slot === 0
  );

  await once(client, 'login');
  await bootstrapInventoryPromise;
  await bootstrapHeldSlotPromise;

  const digAckPromise = waitForPacket(
    client,
    'acknowledge_player_digging',
    (packet) => packet.sequenceId === 41
  );
  const digCorrectionPromise = waitForPacket(
    client,
    'block_change',
    (packet) => packet.location.x === 0 && packet.location.y === 95 && packet.location.z === 0
  );

  client.write('block_dig', {
    status: 0,
    location: { x: 0, y: 95, z: 0 },
    face: 1,
    sequence: 41
  });

  const digAck = await digAckPromise;
  const digCorrection = await digCorrectionPromise;
  assert.equal(digAck.sequenceId, 41);
  assert.equal(digCorrection.type, baseData.blocksByName.air.defaultState);
  assert.equal(server.world.getBlockState({ x: 0, y: 95, z: 0 }), baseData.blocksByName.air.defaultState);

  const placeAckPromise = waitForPacket(
    client,
    'acknowledge_player_digging',
    (packet) => packet.sequenceId === 42
  );
  const placeInventoryUpdatePromise = waitForPacket(
    client,
    'set_player_inventory',
    (packet) =>
      packet.slotId === 1 &&
      packet.contents.itemId === baseData.itemsByName.dirt.id &&
      packet.contents.itemCount === 63
  );
  const placeCorrectionPromise = waitForPacket(
    client,
    'block_change',
    (packet) => packet.location.x === 0 && packet.location.y === 95 && packet.location.z === 0
  );

  client.write('held_item_slot', {
    slotId: 1
  });

  client.write('block_place', {
    hand: 0,
    location: { x: 0, y: 94, z: 0 },
    direction: 1,
    cursorX: 0.5,
    cursorY: 1,
    cursorZ: 0.5,
    insideBlock: false,
    worldBorderHit: false,
    sequence: 42
  });

  const placeAck = await placeAckPromise;
  await placeInventoryUpdatePromise;
  const placeCorrection = await placeCorrectionPromise;
  assert.equal(placeAck.sequenceId, 42);
  assert.equal(placeCorrection.type, baseData.blocksByName.dirt.defaultState);
  assert.equal(server.world.getBlockState({ x: 0, y: 95, z: 0 }), baseData.blocksByName.dirt.defaultState);

  const pickupAckPromise = waitForPacket(
    client,
    'acknowledge_player_digging',
    (packet) => packet.sequenceId === 43
  );
  const pickupInventoryUpdatePromise = waitForPacket(
    client,
    'set_player_inventory',
    (packet) =>
      packet.slotId === 1 &&
      packet.contents.itemId === baseData.itemsByName.dirt.id &&
      packet.contents.itemCount === 64
  );
  const pickupCorrectionPromise = waitForPacket(
    client,
    'block_change',
    (packet) => packet.location.x === 0 && packet.location.y === 95 && packet.location.z === 0
  );

  client.write('block_dig', {
    status: 0,
    location: { x: 0, y: 95, z: 0 },
    face: 1,
    sequence: 43
  });

  const pickupAck = await pickupAckPromise;
  await pickupInventoryUpdatePromise;
  const pickupCorrection = await pickupCorrectionPromise;
  assert.equal(pickupAck.sequenceId, 43);
  assert.equal(pickupCorrection.type, baseData.blocksByName.air.defaultState);
  assert.equal(server.world.getBlockState({ x: 0, y: 95, z: 0 }), baseData.blocksByName.air.defaultState);

  const stoneAckPromise = waitForPacket(
    client,
    'acknowledge_player_digging',
    (packet) => packet.sequenceId === 44
  );
  const stoneInventoryUpdatePromise = waitForPacket(
    client,
    'set_player_inventory',
    (packet) =>
      packet.slotId === 2 &&
      packet.contents.itemId === baseData.itemsByName.stone.id &&
      packet.contents.itemCount === 63
  );
  const stoneCorrectionPromise = waitForPacket(
    client,
    'block_change',
    (packet) => packet.location.x === 0 && packet.location.y === 95 && packet.location.z === 0
  );

  client.write('held_item_slot', {
    slotId: 2
  });

  client.write('block_place', {
    hand: 0,
    location: { x: 0, y: 94, z: 0 },
    direction: 1,
    cursorX: 0.5,
    cursorY: 1,
    cursorZ: 0.5,
    insideBlock: false,
    worldBorderHit: false,
    sequence: 44
  });

  const stoneAck = await stoneAckPromise;
  await stoneInventoryUpdatePromise;
  const stoneCorrection = await stoneCorrectionPromise;
  assert.equal(stoneAck.sequenceId, 44);
  assert.equal(stoneCorrection.type, baseData.blocksByName.stone.defaultState);
  assert.equal(server.world.getBlockState({ x: 0, y: 95, z: 0 }), baseData.blocksByName.stone.defaultState);

  client.end('smoke test complete');

  await closeMinecraftServer(server);

  const { server: reloadedServer } = createMinecraftServer({
    host: '127.0.0.1',
    port: 25573,
    version: '1.21.11',
    motd: 'Reloaded Smoke Test Server',
    worldSavePath
  });
  await once(reloadedServer, 'listening');
  assert.equal(
    reloadedServer.world.getBlockState({ x: 0, y: 95, z: 0 }),
    baseData.blocksByName.stone.defaultState
  );
  await closeMinecraftServer(reloadedServer);

  const { server: defaultServer } = createMinecraftServer({
    host: '127.0.0.1',
    port: 25572,
    worldSavePath: path.join(tempDataDir, 'default-world.json')
  });
  await once(defaultServer, 'listening');
  assert.equal(defaultServer.requestedVersion, '26.1.2');
  assert.equal(defaultServer.advertisedVersion, '26.1.2');
  await closeMinecraftServer(defaultServer);

  await testExperimental2612Compatibility();
  fs.rmSync(tempDataDir, { recursive: true, force: true });
  console.log('Smoke test passed.');
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
