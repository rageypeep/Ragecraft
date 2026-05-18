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
const { buildPlayerBootstrapPackets } = require('../src/server/bootstrap');
const { createChatApi } = require('../src/server/chat');
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

function waitForCondition(predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function poll() {
      try {
        const result = predicate();

        if (result) {
          resolve(result);
          return;
        }

        if (Date.now() >= deadline) {
          reject(new Error('Timed out waiting for condition.'));
          return;
        }

        setTimeout(poll, 10);
      } catch (error) {
        reject(error);
      }
    }

    poll();
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

async function getAvailablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address?.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
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

function createMockMcData(features = {}) {
  return {
    supportFeature(name) {
      return features[name] ?? false;
    }
  };
}

function metadataContainsItem(packet, itemId, count) {
  return packet.metadata?.some((entry) =>
    entry.key === 8 &&
    entry.value?.itemId === itemId &&
    entry.value?.itemCount === count
  );
}

function assertSafeSpawn(world, spawn) {
  assert.equal(world.getBlockState({ x: spawn.x, y: spawn.y, z: spawn.z }), world.airBlockStateId);
  assert.equal(world.getBlockState({ x: spawn.x, y: spawn.y + 1, z: spawn.z }), world.airBlockStateId);
  assert.notEqual(world.getBlockState({ x: spawn.x, y: spawn.y - 1, z: spawn.z }), world.airBlockStateId);
}

function collectWorldSignature(world, positions) {
  return positions
    .map(({ x, y, z }) => `${x},${y},${z}:${world.getBlockState({ x, y, z })}:${world.getBiomeId({ x, y, z })}`)
    .join('|');
}

const NON_TERRAIN_SURFACE_BLOCK_NAMES = new Set([
  'air',
  'water',
  'spruce_leaves',
  'oak_leaves',
  'birch_leaves',
  'short_grass',
  'fern',
  'large_fern',
  'tall_grass',
  'sunflower',
  'snow',
  'dandelion',
  'poppy',
  'azure_bluet',
  'oxeye_daisy',
  'cornflower',
  'orange_tulip',
  'pink_tulip',
  'red_tulip',
  'white_tulip'
]);

function getTopTerrainY(world, mcData, x, z) {
  for (let y = world.maxBuildY; y >= world.minBuildY; y--) {
    const stateId = world.getBlockState({ x, y, z });
    const blockName = mcData.blocksByStateId[stateId]?.name;

    if (blockName && !NON_TERRAIN_SURFACE_BLOCK_NAMES.has(blockName)) {
      return y;
    }
  }

  return null;
}

function getTerrainWindowProfile(world, mcData, centerX, centerZ, radius = 32, step = 16) {
  let minTopY = Number.POSITIVE_INFINITY;
  let maxTopY = Number.NEGATIVE_INFINITY;
  let topYSum = 0;
  let topYCount = 0;

  for (let x = centerX - radius; x <= centerX + radius; x += step) {
    for (let z = centerZ - radius; z <= centerZ + radius; z += step) {
      const topY = getTopTerrainY(world, mcData, x, z);

      if (topY === null) {
        continue;
      }

      minTopY = Math.min(minTopY, topY);
      maxTopY = Math.max(maxTopY, topY);
      topYSum += topY;
      topYCount += 1;
    }
  }

  return {
    averageTopY: topYCount > 0 ? (topYSum / topYCount) : null,
    maxTopY,
    minTopY,
    relief: maxTopY - minTopY
  };
}

function countUndergroundAir(world, bounds) {
  let airCount = 0;

  for (let x = bounds.minX; x <= bounds.maxX; x++) {
    for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
      for (let y = bounds.minY; y <= bounds.maxY; y++) {
        if (world.getBlockState({ x, y, z }) === world.airBlockStateId) {
          airCount += 1;
        }
      }
    }
  }

  return airCount;
}

function countWaterBlocksAboveNearbyAir(world, bounds, maxGap) {
  let count = 0;

  for (let x = bounds.minX; x <= bounds.maxX; x++) {
    for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
      for (let y = bounds.maxY; y >= bounds.minY; y--) {
        if (world.getBlockState({ x, y, z }) !== world.waterBlockStateId) {
          continue;
        }

        for (let gap = 1; gap <= maxGap; gap++) {
          if (world.getBlockState({ x, y: y - gap, z }) === world.airBlockStateId) {
            count += 1;
            break;
          }
        }
      }
    }
  }

  return count;
}

function countMatchingStateIds(world, bounds, stateIds) {
  const stateIdSet = new Set(stateIds);
  let count = 0;

  for (let x = bounds.minX; x <= bounds.maxX; x++) {
    for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
      for (let y = bounds.minY; y <= bounds.maxY; y++) {
        if (stateIdSet.has(world.getBlockState({ x, y, z }))) {
          count += 1;
        }
      }
    }
  }

  return count;
}

function testCompatibilityChatFallback() {
  const calls = [];
  const firstClient = { id: 1 };
  const secondClient = { id: 2 };
  const chatApi = createChatApi({
    connectedClients(excludeClient = null) {
      return [firstClient, secondClient].filter((client) => client !== excludeClient);
    },
    isCompatibilityActive: () => true,
    mcData: createMockMcData(),
    server: {
      writeToClients(clients, packetName, params) {
        calls.push({ clients, packetName, params });
      }
    },
    writePacket(client, packetName, params) {
      calls.push({ client, packetName, params });
    }
  });

  chatApi.broadcastSystemMessage('Compatibility hello.', secondClient);
  chatApi.broadcastPlayerMessage('Foursix', 'hi');

  assert.equal(calls.length, 3);
  assert.equal(calls[0].packetName, 'system_chat');
  assert.equal(calls[0].client, firstClient);
  assert.equal(calls[0].params.content, JSON.stringify({ text: 'Compatibility hello.' }));
  assert.equal(calls[1].packetName, 'system_chat');
  assert.equal(calls[1].client, firstClient);
  assert.equal(calls[1].params.content, JSON.stringify({ text: '<Foursix> hi' }));
  assert.equal(calls[2].packetName, 'system_chat');
  assert.equal(calls[2].client, secondClient);
  assert.equal(calls[2].params.content, JSON.stringify({ text: '<Foursix> hi' }));
}

async function testExperimental2612Compatibility() {
  const port = await getAvailablePort();
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
  assert.equal(compatibilityPlayPacketMap.clientboundPacketIds.system_chat, 121);
  assert.equal(compatibilityPlayPacketMap.clientboundPacketIds.set_player_inventory, 108);
  assert.equal(compatibilityPlayPacketMap.clientboundPacketIds.held_item_slot, 105);
  assert.equal(compatibilityPlayPacketMap.clientboundPacketIds.update_time, 113);
  assert.equal(compatibilityPlayPacketMap.clientboundPacketIds.update_health, 104);
  assert.equal(compatibilityPlayPacketMap.clientboundPacketIds.experience, 103);
  assert.equal(compatibilityPlayPacketMap.clientboundPacketIds.respawn, 82);
  assert.equal(compatibilityPlayPacketMap.serverboundPacketIdRewrites[39], 38);
  assert.equal(compatibilityPlayPacketMap.serverboundPacketIdRewrites[41], 40);
  assert.equal(compatibilityPlayPacketMap.serverboundPacketIdRewrites[42], 41);
  assert.equal(compatibilityPlayPacketMap.serverboundPacketIdRewrites[43], 42);
  assert.equal(compatibilityPlayPacketMap.serverboundPacketIdRewrites[60], 58);
  assert.equal(compatibilityPlayPacketMap.serverboundPacketIdRewrites[64], 61);
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
  const worldSafeSpawn = world.getSafeSpawnPosition({ x: 0, y: 96, z: 0 });
  const worldSurfaceBlockLocation = {
    x: worldSafeSpawn.x,
    y: worldSafeSpawn.y - 1,
    z: worldSafeSpawn.z
  };
  assert.equal(world.surfaceY, 64);
  assert.equal(world.chunks.length, 25);
  assert.equal(world.getBlockState(worldSurfaceBlockLocation), compatibilityBaseData.blocksByName.grass_block.defaultState);
  assert.notEqual(
    world.getBlockState({ x: worldSurfaceBlockLocation.x, y: worldSurfaceBlockLocation.y - 1, z: worldSurfaceBlockLocation.z }),
    compatibilityBaseData.blocksByName.air.defaultState
  );
  assert.equal(world.getBlockState(worldSafeSpawn), compatibilityBaseData.blocksByName.air.defaultState);
  assert(Number.isInteger(world.getBiomeId(worldSurfaceBlockLocation)));
  const sampledBiomeIds = new Set();
  let treeLogCount = 0;
  const treeLogStateIds = new Set([
    world.treeBlockStateIds.oakLog,
    world.treeBlockStateIds.birchLog,
    world.treeBlockStateIds.spruceLog
  ]);

  for (let x = -192; x <= 192; x += 8) {
    for (let z = -192; z <= 192; z += 8) {
      sampledBiomeIds.add(world.getBiomeId({ x, y: world.surfaceY, z }));
    }
  }

  for (let x = -48; x <= 48; x++) {
    for (let z = -48; z <= 48; z++) {
      for (let y = world.surfaceY + 1; y <= world.surfaceY + 12; y++) {
        if (treeLogStateIds.has(world.getBlockState({ x, y, z }))) {
          treeLogCount += 1;
        }
      }
    }
  }

  assert(sampledBiomeIds.size >= 3);
  assert(!sampledBiomeIds.has(compatibilityBaseData.biomesByName.river.id));
  assert(treeLogCount > 0);
  assert.deepEqual(
    world.resolvePlacedBlockLocation(
      {
        x: worldSurfaceBlockLocation.x,
        y: worldSurfaceBlockLocation.y,
        z: worldSurfaceBlockLocation.z
      },
      1
    ),
    worldSafeSpawn
  );
  assert.equal(world.placeBlock(worldSafeSpawn), true);
  assert.equal(world.getBlockState(worldSafeSpawn), compatibilityBaseData.blocksByName.grass_block.defaultState);
  assert.equal(world.breakBlock(worldSafeSpawn).droppedItem.itemId, compatibilityBaseData.itemsByName.dirt.id);
  assert.equal(world.getBlockState(worldSafeSpawn), compatibilityBaseData.blocksByName.air.defaultState);
  const obstructedSpawnWorld = createInitialWorldPackets(compatibilityBaseData, {
    spawn: { x: 0, y: 96, z: 0, yaw: 0, pitch: 0 }
  });
  obstructedSpawnWorld.placeBlock({ x: 0, y: 96, z: 0 }, compatibilityBaseData.blocksByName.stone.defaultState);
  obstructedSpawnWorld.placeBlock({ x: 0, y: 97, z: 0 }, compatibilityBaseData.blocksByName.stone.defaultState);
  const safeSpawn = obstructedSpawnWorld.getSafeSpawnPosition({ x: 0, y: 96, z: 0 });
  assertSafeSpawn(obstructedSpawnWorld, safeSpawn);
  const bootstrapPackets = buildPlayerBootstrapPackets(
    { id: 99 },
    {
      maxPlayers: 20,
      viewDistance: 10,
      spawn: { x: 0, y: 96, z: 0, yaw: 90, pitch: 15 }
    },
    obstructedSpawnWorld,
    compatibilityBaseData.loginPacket
  );
  assert.deepEqual(
    { x: bootstrapPackets.position.x, y: bootstrapPackets.position.y, z: bootstrapPackets.position.z },
    safeSpawn
  );

  const configuredWorld = createInitialWorldPackets(compatibilityBaseData, {
    spawn: { x: 0, y: 96, z: 0, yaw: 0, pitch: 0 },
    viewDistance: 7,
    world: {
      mixedBiomes: false,
      seed: 'alpha-seed',
      chunkRadius: 1,
      streamRadius: 6,
      surfaceBlock: 'stone',
      soilBlock: 'dirt',
      foundationBlock: 'oak_log',
      terrainThickness: 8
    }
  });
  assert.equal(configuredWorld.chunks.length, 9);
  assert.equal(configuredWorld.topBlockStateId, compatibilityBaseData.blocksByName.stone.defaultState);
  assert.equal(configuredWorld.foundationBlockStateId, compatibilityBaseData.blocksByName.oak_log.defaultState);
  assert.equal(configuredWorld.terrainThickness, 8);
  assert.equal(configuredWorld.streamRadius, 6);
  assert.equal(configuredWorld.seed, 'alpha-seed');
  assert.equal(configuredWorld.getChunkPacket(5, -3).x, 5);
  assert.equal(configuredWorld.getChunkPacket(5, -3).z, -3);

  const repeatSeedWorld = createInitialWorldPackets(compatibilityBaseData, {
    spawn: { x: 0, y: 96, z: 0, yaw: 0, pitch: 0 },
    world: {
      mixedBiomes: false,
      seed: 'alpha-seed',
      chunkRadius: 1,
      streamRadius: 6,
      surfaceBlock: 'stone',
      soilBlock: 'dirt',
      foundationBlock: 'oak_log',
      terrainThickness: 8
    }
  });
  const differentSeedWorld = createInitialWorldPackets(compatibilityBaseData, {
    spawn: { x: 0, y: 96, z: 0, yaw: 0, pitch: 0 },
    world: {
      mixedBiomes: false,
      seed: 'beta-seed',
      chunkRadius: 1,
      streamRadius: 6,
      surfaceBlock: 'stone',
      soilBlock: 'dirt',
      foundationBlock: 'oak_log',
      terrainThickness: 8
    }
  });
  const seedSamplePositions = [];

  for (let x = -40; x <= 40; x += 8) {
    for (let z = -40; z <= 40; z += 8) {
      seedSamplePositions.push({ x, y: configuredWorld.surfaceY - 2, z });
      seedSamplePositions.push({ x, y: configuredWorld.surfaceY + 3, z });
    }
  }

  const configuredSignature = collectWorldSignature(configuredWorld, seedSamplePositions);
  const repeatSeedSignature = collectWorldSignature(repeatSeedWorld, seedSamplePositions);
  const differentSeedSignature = collectWorldSignature(differentSeedWorld, seedSamplePositions);
  assert.equal(configuredSignature, repeatSeedSignature);
  assert.notEqual(configuredSignature, differentSeedSignature);

  const seededSpawnWorldA = createInitialWorldPackets(compatibilityBaseData, {
    spawn: { y: 96, yaw: 0, pitch: 0, useConfiguredPosition: false },
    world: {
      seed: 'spawn-seed-a'
    }
  });
  const seededSpawnWorldB = createInitialWorldPackets(compatibilityBaseData, {
    spawn: { y: 96, yaw: 0, pitch: 0, useConfiguredPosition: false },
    world: {
      seed: 'spawn-seed-b'
    }
  });
  assert.notDeepEqual(
    seededSpawnWorldA.spawnChunk,
    seededSpawnWorldB.spawnChunk
  );
  assert.notDeepEqual(
    seededSpawnWorldA.getSafeSpawnPosition(),
    seededSpawnWorldB.getSafeSpawnPosition()
  );

  const undergroundAirCount = countUndergroundAir(configuredWorld, {
    minX: -96,
    maxX: 96,
    minY: configuredWorld.floorStartY + 2,
    maxY: configuredWorld.surfaceY - 5,
    minZ: -96,
    maxZ: 96
  });
  assert(undergroundAirCount > 0);

  const decoratedWorld = createInitialWorldPackets(compatibilityBaseData, {
    spawn: { x: 0, y: 96, z: 0, yaw: 0, pitch: 0 },
    world: {
      seed: 'terrain-variety'
    }
  });
  const surfacePaletteCount = countMatchingStateIds(decoratedWorld, {
    minX: -192,
    maxX: 192,
    minY: decoratedWorld.surfaceY - 4,
    maxY: decoratedWorld.surfaceY + 2,
    minZ: -192,
    maxZ: 192
  }, decoratedWorld.surfacePaletteStateIds);
  const waterCount = countMatchingStateIds(decoratedWorld, {
    minX: -192,
    maxX: 192,
    minY: decoratedWorld.surfaceY - 4,
    maxY: decoratedWorld.surfaceY + 1,
    minZ: -192,
    maxZ: 192
  }, [decoratedWorld.waterBlockStateId]);
  const undergroundVariantCount = countMatchingStateIds(decoratedWorld, {
    minX: -192,
    maxX: 192,
    minY: decoratedWorld.floorStartY,
    maxY: decoratedWorld.surfaceY - 3,
    minZ: -192,
    maxZ: 192
  }, decoratedWorld.undergroundVariantStateIds);
  const oreCount = countMatchingStateIds(decoratedWorld, {
    minX: -192,
    maxX: 192,
    minY: decoratedWorld.floorStartY,
    maxY: decoratedWorld.surfaceY - 3,
    minZ: -192,
    maxZ: 192
  }, decoratedWorld.oreBlockStateIds);
  const decorationCount = countMatchingStateIds(decoratedWorld, {
    minX: -192,
    maxX: 192,
    minY: decoratedWorld.surfaceY,
    maxY: decoratedWorld.surfaceY + 2,
    minZ: -192,
    maxZ: 192
  }, decoratedWorld.decorationStateIds);
  const oakLogCount = countMatchingStateIds(decoratedWorld, {
    minX: -192,
    maxX: 192,
    minY: decoratedWorld.surfaceY + 1,
    maxY: decoratedWorld.surfaceY + 16,
    minZ: -192,
    maxZ: 192
  }, [decoratedWorld.treeBlockStateIds.oakLog]);
  const birchLogCount = countMatchingStateIds(decoratedWorld, {
    minX: -192,
    maxX: 192,
    minY: decoratedWorld.surfaceY + 1,
    maxY: decoratedWorld.surfaceY + 16,
    minZ: -192,
    maxZ: 192
  }, [decoratedWorld.treeBlockStateIds.birchLog]);
  const spruceLogCount = countMatchingStateIds(decoratedWorld, {
    minX: -192,
    maxX: 192,
    minY: decoratedWorld.surfaceY + 1,
    maxY: decoratedWorld.surfaceY + 18,
    minZ: -192,
    maxZ: 192
  }, [decoratedWorld.treeBlockStateIds.spruceLog]);
  const unsupportedPondWaterCount = countWaterBlocksAboveNearbyAir(decoratedWorld, {
    minX: -192,
    maxX: 192,
    minY: decoratedWorld.surfaceY - 8,
    maxY: decoratedWorld.surfaceY,
    minZ: -192,
    maxZ: 192
  }, 6);
  assert(surfacePaletteCount > 0);
  assert(waterCount > 0);
  assert(undergroundVariantCount > 0);
  assert(oreCount > 0);
  assert(decorationCount > 0);
  assert(oakLogCount > 0);
  assert([oakLogCount, birchLogCount, spruceLogCount].filter((count) => count > 0).length >= 2);
  assert.equal(unsupportedPondWaterCount, 0);
  assert.deepEqual(
    decoratedWorld.populationFeaturePasses,
    ['ponds', 'trees', 'decorations']
  );
  const decoratedBiomeIds = new Set();

  for (let x = -192; x <= 192; x += 8) {
    for (let z = -192; z <= 192; z += 8) {
      decoratedBiomeIds.add(decoratedWorld.getBiomeId({ x, y: decoratedWorld.surfaceY, z }));
    }
  }

  assert(!decoratedBiomeIds.has(compatibilityBaseData.biomesByName.river.id));
  const mountainWindowProfile = getTerrainWindowProfile(
    decoratedWorld,
    compatibilityBaseData,
    -512,
    128
  );
  assert(mountainWindowProfile.averageTopY >= 140);
  assert(mountainWindowProfile.maxTopY >= 220);
  assert(mountainWindowProfile.relief >= 80);

  const plainsWorld = createInitialWorldPackets(compatibilityBaseData, {
    spawn: { x: 0, y: 96, z: 0, yaw: 0, pitch: 0 },
    world: {
      biome: 'plains',
      mixedBiomes: false,
      seed: 'proper-plains'
    }
  });
  const plainsGrassCount = countMatchingStateIds(plainsWorld, {
    minX: -256,
    maxX: 256,
    minY: plainsWorld.surfaceY,
    maxY: plainsWorld.surfaceY + 2,
    minZ: -256,
    maxZ: 256
  }, [
    plainsWorld.decorationStateIds.find((stateId) => stateId === compatibilityBaseData.blocksByName.short_grass.defaultState),
    compatibilityBaseData.blocksByName.tall_grass.defaultState,
    compatibilityBaseData.blocksByName.tall_grass.minStateId
  ].filter(Boolean));
  const plainsFlowerCount = countMatchingStateIds(plainsWorld, {
    minX: -256,
    maxX: 256,
    minY: plainsWorld.surfaceY,
    maxY: plainsWorld.surfaceY + 2,
    minZ: -256,
    maxZ: 256
  }, [
    compatibilityBaseData.blocksByName.dandelion.defaultState,
    compatibilityBaseData.blocksByName.poppy.defaultState,
    compatibilityBaseData.blocksByName.azure_bluet.defaultState,
    compatibilityBaseData.blocksByName.oxeye_daisy.defaultState,
    compatibilityBaseData.blocksByName.cornflower.defaultState,
    compatibilityBaseData.blocksByName.orange_tulip.defaultState,
    compatibilityBaseData.blocksByName.pink_tulip.defaultState,
    compatibilityBaseData.blocksByName.red_tulip.defaultState,
    compatibilityBaseData.blocksByName.white_tulip.defaultState
  ]);
  const plainsTulipCount = countMatchingStateIds(plainsWorld, {
    minX: -256,
    maxX: 256,
    minY: plainsWorld.surfaceY,
    maxY: plainsWorld.surfaceY + 2,
    minZ: -256,
    maxZ: 256
  }, [
    compatibilityBaseData.blocksByName.orange_tulip.defaultState,
    compatibilityBaseData.blocksByName.pink_tulip.defaultState,
    compatibilityBaseData.blocksByName.red_tulip.defaultState,
    compatibilityBaseData.blocksByName.white_tulip.defaultState
  ]);
  const plainsOakLogCount = countMatchingStateIds(plainsWorld, {
    minX: -256,
    maxX: 256,
    minY: plainsWorld.surfaceY + 1,
    maxY: plainsWorld.surfaceY + 18,
    minZ: -256,
    maxZ: 256
  }, [plainsWorld.treeBlockStateIds.oakLog]);
  assert.deepEqual(plainsWorld.biomeMetadata.plains, {
    key: 'plains',
    label: 'Plains',
    temperature: 0.8,
    downfall: 0.4,
    hasPrecipitation: true,
    snow: 'none'
  });
  assert(plainsGrassCount > 200);
  assert(plainsFlowerCount > 0);
  assert(plainsTulipCount > 0);
  assert(plainsOakLogCount > 0);

  const sunflowerWorld = createInitialWorldPackets(compatibilityBaseData, {
    spawn: { x: 0, y: 96, z: 0, yaw: 0, pitch: 0 },
    world: {
      biome: 'sunflower_plains',
      mixedBiomes: false,
      seed: 'sunflower-country'
    }
  });
  const sunflowerCount = countMatchingStateIds(sunflowerWorld, {
    minX: -256,
    maxX: 256,
    minY: sunflowerWorld.surfaceY,
    maxY: sunflowerWorld.surfaceY + 3,
    minZ: -256,
    maxZ: 256
  }, [
    compatibilityBaseData.blocksByName.sunflower.defaultState,
    compatibilityBaseData.blocksByName.sunflower.minStateId
  ]);
  const sunflowerGrassCount = countMatchingStateIds(sunflowerWorld, {
    minX: -256,
    maxX: 256,
    minY: sunflowerWorld.surfaceY,
    maxY: sunflowerWorld.surfaceY + 2,
    minZ: -256,
    maxZ: 256
  }, [
    compatibilityBaseData.blocksByName.short_grass.defaultState,
    compatibilityBaseData.blocksByName.tall_grass.defaultState,
    compatibilityBaseData.blocksByName.tall_grass.minStateId
  ]);
  const sunflowerOakLogCount = countMatchingStateIds(sunflowerWorld, {
    minX: -256,
    maxX: 256,
    minY: sunflowerWorld.surfaceY + 1,
    maxY: sunflowerWorld.surfaceY + 18,
    minZ: -256,
    maxZ: 256
  }, [sunflowerWorld.treeBlockStateIds.oakLog]);
  assert.deepEqual(sunflowerWorld.biomeMetadata.sunflower_plains, {
    key: 'sunflower_plains',
    label: 'Sunflower Plains',
    temperature: 0.8,
    downfall: 0.4,
    hasPrecipitation: true,
    snow: 'none'
  });
  assert(sunflowerCount > 0);
  assert(sunflowerGrassCount > 200);
  assert(sunflowerOakLogCount > 0);

  const forestWorld = createInitialWorldPackets(compatibilityBaseData, {
    spawn: { x: 0, y: 96, z: 0, yaw: 0, pitch: 0 },
    world: {
      biome: 'forest',
      mixedBiomes: false,
      seed: 'deep-forest'
    }
  });
  const forestDecorationCount = countMatchingStateIds(forestWorld, {
    minX: -192,
    maxX: 192,
    minY: forestWorld.surfaceY,
    maxY: forestWorld.surfaceY + 2,
    minZ: -192,
    maxZ: 192
  }, [
    compatibilityBaseData.blocksByName.fern.defaultState,
    compatibilityBaseData.blocksByName.short_grass.defaultState,
    compatibilityBaseData.blocksByName.brown_mushroom.defaultState,
    compatibilityBaseData.blocksByName.red_mushroom.defaultState
  ]);
  const forestOakLogCount = countMatchingStateIds(forestWorld, {
    minX: -192,
    maxX: 192,
    minY: forestWorld.surfaceY + 1,
    maxY: forestWorld.surfaceY + 18,
    minZ: -192,
    maxZ: 192
  }, [forestWorld.treeBlockStateIds.oakLog]);
  assert.deepEqual(forestWorld.biomeMetadata.forest, {
    key: 'forest',
    label: 'Forest',
    temperature: 0.7,
    downfall: 0.8,
    hasPrecipitation: true,
    snow: 'none',
    grassColor: '#79C05A',
    foliageColor: '#59AE30'
  });
  assert(forestDecorationCount > 0);
  assert(forestOakLogCount > 0);

  const flowerForestWorld = createInitialWorldPackets(compatibilityBaseData, {
    spawn: { x: 0, y: 96, z: 0, yaw: 0, pitch: 0 },
    world: {
      biome: 'flower_forest',
      mixedBiomes: false,
      seed: 'flower-power'
    }
  });
  const flowerForestFlowerCount = countMatchingStateIds(flowerForestWorld, {
    minX: -192,
    maxX: 192,
    minY: flowerForestWorld.surfaceY,
    maxY: flowerForestWorld.surfaceY + 2,
    minZ: -192,
    maxZ: 192
  }, [
    compatibilityBaseData.blocksByName.dandelion.defaultState,
    compatibilityBaseData.blocksByName.poppy.defaultState,
    compatibilityBaseData.blocksByName.azure_bluet.defaultState,
    compatibilityBaseData.blocksByName.oxeye_daisy.defaultState,
    compatibilityBaseData.blocksByName.cornflower.defaultState,
    compatibilityBaseData.blocksByName.orange_tulip.defaultState,
    compatibilityBaseData.blocksByName.pink_tulip.defaultState,
    compatibilityBaseData.blocksByName.red_tulip.defaultState,
    compatibilityBaseData.blocksByName.white_tulip.defaultState
  ]);
  const flowerForestSunflowerCount = countMatchingStateIds(flowerForestWorld, {
    minX: -192,
    maxX: 192,
    minY: flowerForestWorld.surfaceY,
    maxY: flowerForestWorld.surfaceY + 3,
    minZ: -192,
    maxZ: 192
  }, [
    compatibilityBaseData.blocksByName.sunflower.defaultState,
    compatibilityBaseData.blocksByName.sunflower.minStateId
  ]);
  const flowerForestOakLogCount = countMatchingStateIds(flowerForestWorld, {
    minX: -192,
    maxX: 192,
    minY: flowerForestWorld.surfaceY + 1,
    maxY: flowerForestWorld.surfaceY + 18,
    minZ: -192,
    maxZ: 192
  }, [flowerForestWorld.treeBlockStateIds.oakLog]);
  assert.deepEqual(flowerForestWorld.biomeMetadata.flower_forest, {
    key: 'flower_forest',
    label: 'Flower Forest',
    temperature: 0.7,
    downfall: 0.8,
    hasPrecipitation: true,
    snow: 'none',
    grassColor: '#79C05A',
    foliageColor: '#59AE30'
  });
  assert(flowerForestFlowerCount > 200);
  assert.equal(flowerForestSunflowerCount, 0);
  assert(flowerForestOakLogCount > 0);

  const birchForestWorld = createInitialWorldPackets(compatibilityBaseData, {
    spawn: { x: 0, y: 96, z: 0, yaw: 0, pitch: 0 },
    world: {
      biome: 'birch_forest',
      mixedBiomes: false,
      seed: 'paper-bark'
    }
  });
  const birchForestDecorationCount = countMatchingStateIds(birchForestWorld, {
    minX: -192,
    maxX: 192,
    minY: birchForestWorld.surfaceY,
    maxY: birchForestWorld.surfaceY + 2,
    minZ: -192,
    maxZ: 192
  }, [
    compatibilityBaseData.blocksByName.fern.defaultState,
    compatibilityBaseData.blocksByName.short_grass.defaultState,
    compatibilityBaseData.blocksByName.dandelion.defaultState,
    compatibilityBaseData.blocksByName.poppy.defaultState
  ]);
  const birchForestBirchLogCount = countMatchingStateIds(birchForestWorld, {
    minX: -192,
    maxX: 192,
    minY: birchForestWorld.surfaceY + 1,
    maxY: birchForestWorld.surfaceY + 18,
    minZ: -192,
    maxZ: 192
  }, [birchForestWorld.treeBlockStateIds.birchLog]);
  assert.deepEqual(birchForestWorld.biomeMetadata.birch_forest, {
    key: 'birch_forest',
    label: 'Birch Forest',
    temperature: 0.6,
    downfall: 0.6,
    hasPrecipitation: true,
    snow: 'none',
    grassColor: '#88BB67',
    foliageColor: '#6BA941',
    waterColor: '#3F76E4'
  });
  assert(birchForestDecorationCount > 0);
  assert(birchForestBirchLogCount > 0);

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

  const compatibilityTimeUpdatePacket = buildCompatibilityPlayPacket(
    server.protocolDataVersion,
    'update_time',
    {
      age: 0n,
      time: 1000n,
      tickDayTime: true
    },
    server.advertisedVersion
  );
  assert.equal(readVarInt(compatibilityTimeUpdatePacket, 0)?.value, 113);
  assert.equal(compatibilityTimeUpdatePacket.length, 10);

  const compatibilityHealthPacket = buildCompatibilityPlayPacket(
    server.protocolDataVersion,
    'update_health',
    {
      health: 20,
      food: 20,
      foodSaturation: 5
    },
    server.advertisedVersion
  );
  assert.equal(readVarInt(compatibilityHealthPacket, 0)?.value, 104);

  const compatibilityExperiencePacket = buildCompatibilityPlayPacket(
    server.protocolDataVersion,
    'experience',
    {
      experienceBar: 0,
      level: 0,
      totalExperience: 0
    },
    server.advertisedVersion
  );
  assert.equal(readVarInt(compatibilityExperiencePacket, 0)?.value, 103);

  const compatibilityRespawnPacket = buildCompatibilityPlayPacket(
    server.protocolDataVersion,
    'respawn',
    {
      worldState: compatibilityBaseData.loginPacket.worldState,
      copyMetadata: 0
    },
    server.advertisedVersion
  );
  assert.equal(readVarInt(compatibilityRespawnPacket, 0)?.value, 82);

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
  loginSocket.destroy();
  await once(loginSocket, 'close');

  await closeMinecraftServer(server);
}

async function main() {
  const port = await getAvailablePort();
  const reloadPort = await getAvailablePort();
  const defaultPort = await getAvailablePort();
  const baseData = require('minecraft-data')('1.21.11');
  const tempDataDir = path.join(process.cwd(), 'tmp', 'smoke-test');
  const worldSavePath = path.join(tempDataDir, 'world.json');

  fs.rmSync(tempDataDir, { recursive: true, force: true });

  const { server } = createMinecraftServer({
    host: '127.0.0.1',
    port,
    version: '1.21.11',
    motd: 'Smoke Test Server',
    worldSavePath,
    world: {
      streamRadius: 2
    }
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
  const bootstrapTimePromise = waitForPacket(
    client,
    'update_time',
    (packet) =>
      packet &&
      Object.hasOwn(packet, 'age') &&
      Object.hasOwn(packet, 'time') &&
      typeof packet.tickDayTime === 'boolean'
  );
  const bootstrapHealthPromise = waitForPacket(
    client,
    'update_health',
    (packet) => packet.health === 20 && packet.food === 20 && packet.foodSaturation === 5
  );
  const bootstrapExperiencePromise = waitForPacket(
    client,
    'experience',
    (packet) => packet.experienceBar === 0 && packet.level === 0 && packet.totalExperience === 0
  );

  await once(client, 'login');
  await bootstrapInventoryPromise;
  await bootstrapHeldSlotPromise;
  await bootstrapTimePromise;
  await bootstrapHealthPromise;
  await bootstrapExperiencePromise;

  const serverClient = Object.values(server.clients)[0];
  assert(serverClient?.playerState);
  assert.equal(serverClient.playerState.pendingTeleportId, 0);
  const activeSpawn = server.world.getSafeSpawnPosition({ x: 0, y: 96, z: 0 });
  const minedBlockLocation = {
    x: activeSpawn.x,
    y: activeSpawn.y - 1,
    z: activeSpawn.z
  };
  const placementSupportLocation = {
    x: activeSpawn.x,
    y: activeSpawn.y - 2,
    z: activeSpawn.z
  };
  const initialBreakStateId = server.world.getBlockState(minedBlockLocation);
  const initialBreakDropItemId = baseData.blocksByStateId[initialBreakStateId]?.drops?.[0] ?? null;
  assert(Number.isInteger(initialBreakDropItemId));

  client.write('teleport_confirm', {
    teleportId: 0
  });
  client.write('abilities', {
    flags: 0x02
  });
  client.write('entity_action', {
    entityId: serverClient.id,
    actionId: 'start_sprinting',
    jumpBoost: 0
  });
  client.write('player_input', {
    inputs: {
      forward: true,
      backward: false,
      left: false,
      right: true,
      jump: true,
      shift: false,
      sprint: true
    }
  });
  client.write('player_loaded', {});
  client.write('arm_animation', {
    hand: 0
  });
  client.write('use_item', {
    hand: 0,
    sequence: 40,
    rotation: {
      x: 1.5,
      y: -2.5
    }
  });

  await waitForCondition(() =>
    serverClient.playerState.lastConfirmedTeleportId === 0 &&
    serverClient.playerState.teleportConfirmCount === 1 &&
    serverClient.playerState.pendingTeleportId === null &&
    serverClient.playerState.abilities.isFlying === true &&
    serverClient.playerState.entityAction.sprinting === true &&
    serverClient.playerState.entityAction.lastAction === 'start_sprinting' &&
    serverClient.playerState.playerInput.forward === true &&
    serverClient.playerState.playerInput.right === true &&
    serverClient.playerState.playerInput.jump === true &&
    serverClient.playerState.playerInput.sprint === true &&
    serverClient.playerState.loaded === true &&
    serverClient.playerState.loadCount === 1 &&
    serverClient.playerState.hand.lastSwingHand === 0 &&
    serverClient.playerState.hand.swingCount === 1 &&
    serverClient.playerState.hand.lastUseItemHand === 0 &&
    serverClient.playerState.hand.lastUseItemSequence === 40 &&
    serverClient.playerState.hand.lastUseItemRotation?.x === 1.5 &&
    serverClient.playerState.hand.lastUseItemRotation?.y === -2.5
  );

  const digAckPromise = waitForPacket(
    client,
    'acknowledge_player_digging',
    (packet) => packet.sequenceId === 41
  );
  const digCorrectionPromise = waitForPacket(
    client,
    'block_change',
    (packet) =>
      packet.location.x === minedBlockLocation.x &&
      packet.location.y === minedBlockLocation.y &&
      packet.location.z === minedBlockLocation.z
  );
  const initialDropSpawnPromise = waitForPacket(
    client,
    'spawn_entity',
    (packet) => packet.type === baseData.entitiesByName.item.id
  );
  const initialDropMetadataPromise = waitForPacket(
    client,
    'entity_metadata',
    (packet) => metadataContainsItem(packet, initialBreakDropItemId, 1)
  );

  client.write('block_dig', {
    status: 0,
    location: minedBlockLocation,
    face: 1,
    sequence: 41
  });

  const digAck = await digAckPromise;
  const digCorrection = await digCorrectionPromise;
  const initialDropSpawn = await initialDropSpawnPromise;
  await initialDropMetadataPromise;
  assert.equal(digAck.sequenceId, 41);
  assert.equal(digCorrection.type, baseData.blocksByName.air.defaultState);
  assert.equal(server.world.getBlockState(minedBlockLocation), baseData.blocksByName.air.defaultState);

  const initialCollectPromise = waitForPacket(
    client,
    'collect',
    (packet) => packet.collectedEntityId === initialDropSpawn.entityId && packet.pickupItemCount === 1
  );
  const initialDestroyPromise = waitForPacket(
    client,
    'entity_destroy',
    (packet) => packet.entityIds.includes(initialDropSpawn.entityId)
  );
  const initialPickupInventoryUpdatePromise = waitForPacket(
    client,
    'set_player_inventory',
    (packet) =>
      packet.slotId === 4 &&
      packet.contents.itemId === initialBreakDropItemId &&
      packet.contents.itemCount === 1
  );

  await initialCollectPromise;
  await initialDestroyPromise;
  await initialPickupInventoryUpdatePromise;

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
    (packet) =>
      packet.location.x === minedBlockLocation.x &&
      packet.location.y === minedBlockLocation.y &&
      packet.location.z === minedBlockLocation.z
  );

  client.write('held_item_slot', {
    slotId: 1
  });

  client.write('block_place', {
    hand: 0,
    location: placementSupportLocation,
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
  assert.equal(server.world.getBlockState(minedBlockLocation), baseData.blocksByName.dirt.defaultState);

  const pickupAckPromise = waitForPacket(
    client,
    'acknowledge_player_digging',
    (packet) => packet.sequenceId === 43
  );
  const pickupDropSpawnPromise = waitForPacket(
    client,
    'spawn_entity',
    (packet) => packet.type === baseData.entitiesByName.item.id
  );
  const pickupDropMetadataPromise = waitForPacket(
    client,
    'entity_metadata',
    (packet) => metadataContainsItem(packet, baseData.itemsByName.dirt.id, 1)
  );
  const pickupCorrectionPromise = waitForPacket(
    client,
    'block_change',
    (packet) =>
      packet.location.x === minedBlockLocation.x &&
      packet.location.y === minedBlockLocation.y &&
      packet.location.z === minedBlockLocation.z
  );

  client.write('block_dig', {
    status: 0,
    location: minedBlockLocation,
    face: 1,
    sequence: 43
  });

  const pickupAck = await pickupAckPromise;
  const pickupDropSpawn = await pickupDropSpawnPromise;
  await pickupDropMetadataPromise;
  const pickupCorrection = await pickupCorrectionPromise;
  assert.equal(pickupAck.sequenceId, 43);
  assert.equal(pickupCorrection.type, baseData.blocksByName.air.defaultState);
  assert.equal(server.world.getBlockState(minedBlockLocation), baseData.blocksByName.air.defaultState);

  const pickupCollectPromise = waitForPacket(
    client,
    'collect',
    (packet) => packet.collectedEntityId === pickupDropSpawn.entityId && packet.pickupItemCount === 1
  );
  const pickupDestroyPromise = waitForPacket(
    client,
    'entity_destroy',
    (packet) => packet.entityIds.includes(pickupDropSpawn.entityId)
  );
  const pickupInventoryUpdatePromise = waitForPacket(
    client,
    'set_player_inventory',
    (packet) =>
      packet.slotId === 1 &&
      packet.contents.itemId === baseData.itemsByName.dirt.id &&
      packet.contents.itemCount === 64
  );

  await pickupCollectPromise;
  await pickupDestroyPromise;
  await pickupInventoryUpdatePromise;

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
    (packet) =>
      packet.location.x === minedBlockLocation.x &&
      packet.location.y === minedBlockLocation.y &&
      packet.location.z === minedBlockLocation.z
  );

  client.write('held_item_slot', {
    slotId: 2
  });

  client.write('block_place', {
    hand: 0,
    location: placementSupportLocation,
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
  assert.equal(server.world.getBlockState(minedBlockLocation), baseData.blocksByName.stone.defaultState);

  const deniedDigAckPromise = waitForPacket(
    client,
    'acknowledge_player_digging',
    (packet) => packet.sequenceId === 45
  );
  const deniedDigCorrectionPromise = waitForPacket(
    client,
    'block_change',
    (packet) =>
      packet.location.x === minedBlockLocation.x &&
      packet.location.y === minedBlockLocation.y &&
      packet.location.z === minedBlockLocation.z &&
      packet.type === baseData.blocksByName.stone.defaultState
  );

  client.write('block_dig', {
    status: 1,
    location: minedBlockLocation,
    face: 1,
    sequence: 45
  });

  const deniedDigAck = await deniedDigAckPromise;
  const deniedDigCorrection = await deniedDigCorrectionPromise;
  assert.equal(deniedDigAck.sequenceId, 45);
  assert.equal(deniedDigCorrection.type, baseData.blocksByName.stone.defaultState);
  assert.equal(server.world.getBlockState(minedBlockLocation), baseData.blocksByName.stone.defaultState);

  client.write('held_item_slot', {
    slotId: 3
  });

  const deniedPlaceAckPromise = waitForPacket(
    client,
    'acknowledge_player_digging',
    (packet) => packet.sequenceId === 46
  );
  const deniedPlaceTargetCorrectionPromise = waitForPacket(
    client,
    'block_change',
    (packet) =>
      packet.location.x === minedBlockLocation.x &&
      packet.location.y === minedBlockLocation.y &&
      packet.location.z === minedBlockLocation.z &&
      packet.type === baseData.blocksByName.stone.defaultState
  );

  client.write('block_place', {
    hand: 0,
    location: placementSupportLocation,
    direction: 1,
    cursorX: 0.5,
    cursorY: 1,
    cursorZ: 0.5,
    insideBlock: false,
    worldBorderHit: false,
    sequence: 46
  });

  const deniedPlaceAck = await deniedPlaceAckPromise;
  const deniedPlaceTargetCorrection = await deniedPlaceTargetCorrectionPromise;
  assert.equal(deniedPlaceAck.sequenceId, 46);
  assert.equal(deniedPlaceTargetCorrection.type, baseData.blocksByName.stone.defaultState);
  assert.equal(server.world.getBlockState(minedBlockLocation), baseData.blocksByName.stone.defaultState);
  assert.equal(Object.values(server.clients)[0].inventoryState.hotbar[3].count, 32);

  const streamedChunkPromise = waitForPacket(
    client,
    'map_chunk',
    (packet) => packet.x === 8 && packet.z === 0
  );
  const unloadChunkPromise = waitForPacket(
    client,
    'unload_chunk',
    (packet) => packet.chunkX === -2 && packet.chunkZ === -2
  );
  const viewCenterPromise = waitForPacket(
    client,
    'update_view_position',
    (packet) => packet.chunkX === 6 && packet.chunkZ === 0
  );

  client.write('position', {
    x: 96,
    y: 96,
    z: 0,
    flags: {
      onGround: true,
      hasHorizontalCollision: false
    }
  });

  const streamedChunk = await streamedChunkPromise;
  const unloadedChunk = await unloadChunkPromise;
  const newViewCenter = await viewCenterPromise;
  assert.equal(streamedChunk.x, 8);
  assert.equal(unloadedChunk.chunkX, -2);
  assert.equal(unloadedChunk.chunkZ, -2);
  assert.equal(newViewCenter.chunkX, 6);
  assert.equal(newViewCenter.chunkZ, 0);

  const respawnPacketPromise = waitForPacket(
    client,
    'respawn',
    () => true
  );
  const respawnPositionPromise = waitForPacket(
    client,
    'position',
    (packet) => packet.teleportId === 1 && packet.y === server.world.getSafeSpawnPosition({ x: 0, y: 96, z: 0 }).y
  );
  const respawnTimePromise = waitForPacket(
    client,
    'update_time',
    (packet) => packet && Object.hasOwn(packet, 'age')
  );

  client.write('position', {
    x: 96,
    y: -80,
    z: 0,
    flags: {
      onGround: false,
      hasHorizontalCollision: false
    }
  });

  const respawnPacket = await respawnPacketPromise;
  const respawnPosition = await respawnPositionPromise;
  await respawnTimePromise;
  assert.equal(respawnPacket.copyMetadata, 0);
  assert.equal(respawnPosition.teleportId, 1);
  assert.equal(serverClient.playerState.pendingTeleportId, 1);

  client.write('teleport_confirm', {
    teleportId: 1
  });

  await waitForCondition(() => serverClient.playerState.lastConfirmedTeleportId === 1);

  client.end('smoke test complete');
  await once(client, 'end');

  await closeMinecraftServer(server);

  const { server: reloadedServer } = createMinecraftServer({
    host: '127.0.0.1',
    port: reloadPort,
    version: '1.21.11',
    motd: 'Reloaded Smoke Test Server',
    worldSavePath,
    world: {
      streamRadius: 2
    }
  });
  await once(reloadedServer, 'listening');
  assert.equal(
    reloadedServer.world.getBlockState(minedBlockLocation),
    baseData.blocksByName.stone.defaultState
  );
  await closeMinecraftServer(reloadedServer);

  const { server: defaultServer } = createMinecraftServer({
    host: '127.0.0.1',
    port: defaultPort,
    worldSavePath: path.join(tempDataDir, 'default-world.json')
  });
  await once(defaultServer, 'listening');
  assert.equal(defaultServer.requestedVersion, '26.1.2');
  assert.equal(defaultServer.advertisedVersion, '26.1.2');
  assert.equal(defaultServer.world.streamRadius, 10);
  await closeMinecraftServer(defaultServer);

  await testExperimental2612Compatibility();
  testCompatibilityChatFallback();
  fs.rmSync(tempDataDir, { recursive: true, force: true });
  console.log('Smoke test passed.');
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
