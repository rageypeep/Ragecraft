const mc = require('minecraft-protocol');
const { createCompatibilityBlockStateTranslator } = require('./block-state-translator');
const { loadConfig } = require('./config');
const {
  consumeSelectedItem,
  createPlayerInventory,
  getHotbarItem,
  resolveBlockStateIdForItem,
  setSelectedHotbarSlot,
  toProtocolSlot
} = require('./inventory');
const { createInitialWorldPackets } = require('./world');
const { loadWorldState, saveWorldState } = require('./world-persistence');
const {
  buildCompatibilityRegistryCodec,
  loadCompatibilityRegistryOverrides
} = require('./compatibility-registry');
const {
  createCompatibilityInboundPlayPacketRewriter,
  is2612Compatibility,
  writeCompatibilityPlayPacket,
  writeCompatibilityLoginPacket,
  writeCompatibilityPositionPacket
} = require('./compatibility-play');
const { loadCompatibilityTags } = require('./compatibility-tags');
const {
  buildPlayerBootstrapPackets,
  buildPlayerStatusPackets,
  buildRespawnPacket,
  createLightUpdatePacket
} = require('./server/bootstrap');
const { buildBlockChangePacket, extractSelectedSlot, shouldBreakBlock } = require('./server/blocks');
const { createChatApi, extractChatMessage, formatWelcomeMessage } = require('./server/chat');
const { createItemDropManager } = require('./server/item-entities');
const {
  createPlayerState,
  recordArmAnimation,
  recordEntityAction,
  recordPlayerInput,
  recordPlayerLoaded,
  recordRequestedAbilities,
  recordTeleportConfirm,
  recordUseItem
} = require('./server/player-state');
const { resolveVersionTarget } = require('./versioning');

const VOID_RESPAWN_Y = -32;
const WORLD_TIME_TICK_INTERVAL_MS = 1000;
const WORLD_TIME_TICK_AMOUNT = 20n;
const DAY_LENGTH_TICKS = 24000n;
const CHUNK_SEND_INTERVAL_MS = 25;
const CHUNK_SEND_BATCH_SIZE = 2;
const CHUNK_SEND_TIME_BUDGET_MS = 16;

function createMinecraftServer(overrides = {}) {
  const config = loadConfig(overrides);
  const versionTarget = resolveVersionTarget(config.version);
  const mcData = require('minecraft-data')(versionTarget.protocolDataVersion);
  const persistedWorldState = loadWorldState(config.worldSavePath);
  const world = createInitialWorldPackets(mcData, config, persistedWorldState);
  const baseRegistryCodec = mcData.registryCodec || mcData.loginPacket?.dimensionCodec || {};
  const registryOverrides = versionTarget.compatibility
    ? loadCompatibilityRegistryOverrides(versionTarget.advertisedVersion)
    : null;
  const blockStateTranslator = versionTarget.compatibility
    ? createCompatibilityBlockStateTranslator(mcData, versionTarget.advertisedVersion)
    : null;
  const registryCodec = versionTarget.compatibility
    ? buildCompatibilityRegistryCodec(baseRegistryCodec, registryOverrides)
    : baseRegistryCodec;
  const server = mc.createServer({
    host: config.host,
    port: config.port,
    motd: config.motd,
    'max-players': config.maxPlayers,
    'online-mode': config.onlineMode,
    encryption: config.encryption,
    errorHandler: (client, err) => {
      console.error(`[client:error] ${client.username ?? 'unknown'} (${client.socket?.remoteAddress ?? 'n/a'}:${client.socket?.remotePort ?? 'n/a'})`, err);
      client.end(err instanceof Error ? err.message : String(err));
    },
    registryCodec,
    ...versionTarget.createServerOptions
  });
  const loginPacket = mcData.loginPacket;

  server.requestedVersion = versionTarget.requestedVersion;
  server.protocolDataVersion = versionTarget.protocolDataVersion;
  server.advertisedVersion = versionTarget.advertisedVersion;
  server.advertisedProtocolVersion = versionTarget.protocolVersion;
  server.compatibility = versionTarget.compatibility;
  server.compatibilityTags = versionTarget.compatibility
    ? loadCompatibilityTags(versionTarget.advertisedVersion)
    : [];
  server.compatibilityRegistryOverrideCount = registryOverrides
    ? Object.keys(registryOverrides.registries ?? {}).length
    : 0;
  server.compatibilityTagTypeCount = server.compatibilityTags.length;
  server.world = world;
  server.worldTimeState = buildPlayerStatusPackets().time;
  server._ragecraftCleanupHandlers = [];

  function connectedClients(excludeClient = null) {
    return Object.values(server.clients).filter((client) => client !== excludeClient);
  }

  function translateBlockStateId(stateId) {
    return blockStateTranslator ? blockStateTranslator.translate(stateId) : stateId;
  }

  function writePlayPacket(client, name, params) {
    if (is2612Compatibility(server)) {
      writeCompatibilityPlayPacket(client, server, name, params);
      return;
    }

    client.write(name, params);
  }

  function writeLoginPacket(client, params) {
    if (is2612Compatibility(server)) {
      writeCompatibilityLoginPacket(client, server, params);
      return;
    }

    client.write('login', params);
  }

  function writePositionPacket(client, params) {
    if (is2612Compatibility(server)) {
      writeCompatibilityPositionPacket(client, server, params);
      return;
    }

    client.write('position', params);
  }

  const { broadcastPlayerMessage, broadcastSystemMessage, sendMessage } = createChatApi({
    connectedClients,
    isCompatibilityActive: () => is2612Compatibility(server),
    mcData,
    server,
    writePacket: writePlayPacket
  });

  function acknowledgeInteractionSequence(client, sequenceId) {
    if (!Number.isInteger(sequenceId)) {
      return;
    }

    writePlayPacket(client, 'acknowledge_player_digging', {
      sequenceId
    });
  }

  function sendAuthoritativeBlockState(client, position) {
    const blockChangePacket = buildBlockChangePacket(world, position, translateBlockStateId);

    if (!blockChangePacket) {
      return;
    }

    writePlayPacket(client, 'block_change', blockChangePacket);
  }

  function sendDeniedInteractionCorrections(client, positions) {
    const seen = new Set();

    for (const position of positions) {
      const blockChangePacket = buildBlockChangePacket(world, position, translateBlockStateId);

      if (!blockChangePacket) {
        continue;
      }

      const blockKey = `${blockChangePacket.location.x},${blockChangePacket.location.y},${blockChangePacket.location.z}`;

      if (seen.has(blockKey)) {
        continue;
      }

      seen.add(blockKey);
      writePlayPacket(client, 'block_change', blockChangePacket);
    }
  }

  function sendModifiedBlockBootstrap(client) {
    for (const block of world.getModifiedBlocks()) {
      sendAuthoritativeBlockState(client, block);
    }
  }

  function broadcastAuthoritativeBlockState(position) {
    const blockChangePacket = buildBlockChangePacket(world, position, translateBlockStateId);

    if (!blockChangePacket) {
      return;
    }

    for (const client of connectedClients()) {
      writePlayPacket(client, 'block_change', blockChangePacket);
    }
  }

  function broadcastAuthoritativeBlockStates(positions) {
    const seen = new Set();

    for (const position of positions) {
      const blockChangePacket = buildBlockChangePacket(world, position, translateBlockStateId);

      if (!blockChangePacket) {
        continue;
      }

      const blockKey = `${blockChangePacket.location.x},${blockChangePacket.location.y},${blockChangePacket.location.z}`;

      if (seen.has(blockKey)) {
        continue;
      }

      seen.add(blockKey);

      for (const client of connectedClients()) {
        writePlayPacket(client, 'block_change', blockChangePacket);
      }
    }
  }

  function sendInventorySlotUpdate(client, slot) {
    if (!client.inventoryState) {
      return;
    }

    writePlayPacket(client, 'set_player_inventory', {
      slotId: slot,
      contents: toProtocolSlot(client.inventoryState.hotbar[slot] ?? null)
    });
  }

  function allocateTeleportId(client) {
    const teleportId = client.nextTeleportId ?? 1;
    client.nextTeleportId = teleportId + 1;
    return teleportId;
  }

  function buildPositionPacket(position, teleportId = 0) {
    return {
      teleportId,
      x: position.x,
      y: position.y,
      z: position.z,
      dx: 0,
      dy: 0,
      dz: 0,
      yaw: config.spawn.yaw,
      pitch: config.spawn.pitch,
      flags: 0x00
    };
  }

  function createSpawnPositionPacket(position) {
    return {
      globalPos: {
        dimensionName: 'minecraft:overworld',
        location: {
          x: position.x,
          y: position.y,
          z: position.z
        }
      },
      yaw: config.spawn.yaw,
      pitch: config.spawn.pitch
    };
  }

  function sendPlayerStatusPackets(client, playerStatus) {
    writePlayPacket(client, 'update_time', server.worldTimeState);
    writePlayPacket(client, 'update_health', playerStatus.health);
    writePlayPacket(client, 'experience', playerStatus.experience);
  }

  function finalizeClientWorldState(client, playerStatus) {
    client.worldStateReady = true;
    sendPlayerStatusPackets(client, playerStatus);
  }

  function saveWorld() {
    saveWorldState(config.worldSavePath, world.serialize());
  }

  const itemDropManager = createItemDropManager({
    connectedClients,
    mcData,
    sendInventorySlotUpdate,
    writePlayPacket
  });
  server._ragecraftCleanupHandlers.push(() => itemDropManager.cleanup());
  const chunkQueueInterval = setInterval(() => {
    for (const client of connectedClients()) {
      processChunkQueue(client);
    }
  }, CHUNK_SEND_INTERVAL_MS);
  server._ragecraftCleanupHandlers.push(() => clearInterval(chunkQueueInterval));

  function sendInventoryBootstrap(client) {
    if (!client.inventoryState) {
      return;
    }

    for (let slot = 0; slot < client.inventoryState.hotbar.length; slot++) {
      sendInventorySlotUpdate(client, slot);
    }

    writePlayPacket(client, 'held_item_slot', {
      slot: client.inventoryState.selectedSlot
    });
  }

  function getChunkPosition(position = {}) {
    return {
      chunkX: Math.floor((position.x ?? 0) / 16),
      chunkZ: Math.floor((position.z ?? 0) / 16)
    };
  }

  function ensureChunkQueueState(client) {
    if (!client.pendingChunkQueue) {
      client.pendingChunkQueue = [];
    }

    if (!client.pendingChunkKeys) {
      client.pendingChunkKeys = new Set();
    }
  }

  function enqueueChunkLoad(client, chunkX, chunkZ, centerChunk) {
    ensureChunkQueueState(client);
    const chunkKey = `${chunkX},${chunkZ}`;

    if (client.loadedChunkKeys?.has(chunkKey) || client.pendingChunkKeys.has(chunkKey)) {
      return;
    }

    const deltaX = chunkX - centerChunk.chunkX;
    const deltaZ = chunkZ - centerChunk.chunkZ;
    const distanceSquared = (deltaX * deltaX) + (deltaZ * deltaZ);

    client.pendingChunkKeys.add(chunkKey);
    client.pendingChunkQueue.push({
      chunkX,
      chunkZ,
      deltaX,
      deltaZ,
      distance: Math.abs(deltaX) + Math.abs(deltaZ),
      distanceSquared
    });
  }

  function getChunkQueuePriority(entry, client) {
    if (!client?.playerPosition || !Number.isFinite(client.playerPosition.yaw)) {
      return {
        distanceSquared: entry.distanceSquared,
        score: entry.distanceSquared
      };
    }

    const yawRadians = (client.playerPosition.yaw * Math.PI) / 180;
    const forwardX = -Math.sin(yawRadians);
    const forwardZ = Math.cos(yawRadians);
    const sampleDeltaX = entry.deltaX + (entry.deltaX === 0 ? 0 : Math.sign(entry.deltaX) * 0.5);
    const sampleDeltaZ = entry.deltaZ + (entry.deltaZ === 0 ? 0 : Math.sign(entry.deltaZ) * 0.5);
    const forwardDistance = (sampleDeltaX * forwardX) + (sampleDeltaZ * forwardZ);
    const sideDistance = Math.abs((sampleDeltaX * -forwardZ) + (sampleDeltaZ * forwardX));
    const score = entry.distanceSquared +
      (sideDistance * 0.75) -
      (Math.max(0, forwardDistance) * 2.5) +
      (Math.max(0, -forwardDistance) * 3);

    return {
      distanceSquared: entry.distanceSquared,
      forwardDistance,
      score,
      sideDistance
    };
  }

  function compareChunkQueueEntries(left, right, client) {
    const leftPriority = getChunkQueuePriority(left, client);
    const rightPriority = getChunkQueuePriority(right, client);

    if (leftPriority.score !== rightPriority.score) {
      return leftPriority.score - rightPriority.score;
    }

    if (left.distanceSquared !== right.distanceSquared) {
      return left.distanceSquared - right.distanceSquared;
    }

    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }

    if ((leftPriority.forwardDistance ?? 0) !== (rightPriority.forwardDistance ?? 0)) {
      return (rightPriority.forwardDistance ?? 0) - (leftPriority.forwardDistance ?? 0);
    }

    const leftAxisBias = Math.abs(left.deltaX) === Math.abs(left.deltaZ) ? 1 : 0;
    const rightAxisBias = Math.abs(right.deltaX) === Math.abs(right.deltaZ) ? 1 : 0;

    if (leftAxisBias !== rightAxisBias) {
      return leftAxisBias - rightAxisBias;
    }

    if (left.deltaZ !== right.deltaZ) {
      return left.deltaZ - right.deltaZ;
    }

    return left.deltaX - right.deltaX;
  }

  function processChunkQueue(client) {
    if (!client || !client.pendingChunkQueue || client.pendingChunkQueue.length === 0) {
      return;
    }

    client.pendingChunkQueue.sort((left, right) => compareChunkQueueEntries(left, right, client));
    const startedAt = process.hrtime.bigint();
    let sent = 0;

    while (client.pendingChunkQueue.length > 0 && sent < CHUNK_SEND_BATCH_SIZE) {
      if (sent > 0) {
        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

        if (elapsedMs >= CHUNK_SEND_TIME_BUDGET_MS) {
          break;
        }
      }

      const nextChunk = client.pendingChunkQueue.shift();
      const chunkKey = `${nextChunk.chunkX},${nextChunk.chunkZ}`;

      client.pendingChunkKeys.delete(chunkKey);

      if (client.loadedChunkKeys.has(chunkKey)) {
        continue;
      }

      const chunkPacket = world.getChunkPacket(
        nextChunk.chunkX,
        nextChunk.chunkZ,
        blockStateTranslator ? translateBlockStateId : null
      );
      writePlayPacket(client, 'map_chunk', chunkPacket);
      writePlayPacket(client, 'update_light', createLightUpdatePacket(chunkPacket));
      client.loadedChunkKeys.add(chunkKey);
      sent += 1;
    }
  }

  function syncClientChunks(client, force = false) {
    if (!client.playerPosition) {
      return;
    }

    const radius = world.streamRadius;
    const currentChunk = getChunkPosition(client.playerPosition);
    const desiredChunkKeys = new Set();

    if (!client.loadedChunkKeys) {
      client.loadedChunkKeys = new Set();
    }

    ensureChunkQueueState(client);

    if (
      force ||
      !client.chunkCenter ||
      client.chunkCenter.chunkX !== currentChunk.chunkX ||
      client.chunkCenter.chunkZ !== currentChunk.chunkZ
    ) {
      client.chunkCenter = currentChunk;
      writePlayPacket(client, 'update_view_position', currentChunk);
    } else if (!force) {
      return;
    }

    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const chunkX = currentChunk.chunkX + dx;
        const chunkZ = currentChunk.chunkZ + dz;
        const chunkKey = `${chunkX},${chunkZ}`;
        desiredChunkKeys.add(chunkKey);
        enqueueChunkLoad(client, chunkX, chunkZ, currentChunk);
      }
    }

    for (const chunkKey of Array.from(client.loadedChunkKeys)) {
      if (desiredChunkKeys.has(chunkKey)) {
        continue;
      }

      const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
      writePlayPacket(client, 'unload_chunk', {
        chunkX,
        chunkZ
      });
      client.loadedChunkKeys.delete(chunkKey);
    }

    for (const chunkKey of Array.from(client.pendingChunkKeys)) {
      if (desiredChunkKeys.has(chunkKey)) {
        continue;
      }

      client.pendingChunkKeys.delete(chunkKey);
    }

    client.pendingChunkQueue = client.pendingChunkQueue.filter((entry) =>
      desiredChunkKeys.has(`${entry.chunkX},${entry.chunkZ}`));

    processChunkQueue(client);
  }

  function respawnPlayer(client) {
    const safeSpawn = world.getSafeSpawnPosition(config.spawn);
    const teleportId = allocateTeleportId(client);

    itemDropManager.setClientPosition(client, safeSpawn);
    client.loadedChunkKeys = new Set();
    client.pendingChunkKeys = new Set();
    client.pendingChunkQueue = [];
    client.chunkCenter = null;
    client.worldStateReady = false;

    if (client.playerState) {
      client.playerState.pendingTeleportId = teleportId;
    }

    writePlayPacket(client, 'respawn', {
      ...buildRespawnPacket(loginPacket, world)
    });
    writePlayPacket(client, 'spawn_position', createSpawnPositionPacket(safeSpawn));
    syncClientChunks(client, true);
    writePositionPacket(client, buildPositionPacket(safeSpawn, teleportId));
    finalizeClientWorldState(client, client.playerStatus);
  }

  function initializePlayer(client) {
    const address = `${client.socket.remoteAddress}:${client.socket.remotePort}`;
    const bootstrapPackets = buildPlayerBootstrapPackets(client, config, world, loginPacket);
    client.inventoryState = createPlayerInventory(mcData);
    client.playerState = createPlayerState(bootstrapPackets.position.teleportId);
    client.playerStatus = bootstrapPackets.playerStatus;
    client.nextTeleportId = 1;
    client.worldStateReady = false;
    itemDropManager.setClientPosition(client, bootstrapPackets.position);
    client.loadedChunkKeys = new Set();
    client.pendingChunkKeys = new Set();
    client.pendingChunkQueue = [];
    client.chunkCenter = null;

    console.log(`[join] ${client.username} (${address})`);

    client.on('end', () => {
      console.log(`[leave] ${client.username} (${address})`);
      broadcastSystemMessage(`${client.username} left the game.`, client);
    });

    writeLoginPacket(client, bootstrapPackets.login);

    writePlayPacket(client, 'initialize_world_border', bootstrapPackets.border);
    writePlayPacket(client, 'update_view_distance', bootstrapPackets.viewDistance);
    writePlayPacket(client, 'simulation_distance', bootstrapPackets.simulationDistance);
    writePlayPacket(client, 'spawn_position', bootstrapPackets.spawnPosition);
    writePlayPacket(client, 'abilities', bootstrapPackets.abilities);
    writePlayPacket(client, 'game_state_change', bootstrapPackets.gameStateChange);
    syncClientChunks(client, true);
    writePositionPacket(client, bootstrapPackets.position);
    finalizeClientWorldState(client, bootstrapPackets.playerStatus);

    sendModifiedBlockBootstrap(client);
    itemDropManager.sendExistingDrops(client);

    sendInventoryBootstrap(client);

    sendMessage(
      [client],
      formatWelcomeMessage(config.welcomeMessage, client.username),
      'Server',
      'system'
    );

    broadcastSystemMessage(`${client.username} joined the game.`, client);

    const handleChatPacket = (packet) => {
      const message = extractChatMessage(packet).trim();

      if (!message) {
        return;
      }

      console.log(`[chat] <${client.username}> ${message}`);
      broadcastPlayerMessage(client.username, message);
    };

    const handleBlockDigPacket = (packet) => {
      acknowledgeInteractionSequence(client, packet.sequence);

      const breakResult = shouldBreakBlock(packet)
        ? world.breakBlock(packet.location)
        : null;

      if (breakResult) {
        saveWorld();
        broadcastAuthoritativeBlockStates(breakResult.changedPositions ?? [packet.location]);

        if (breakResult.droppedItem) {
          itemDropManager.spawnDrop(
            breakResult.droppedItem.itemId,
            breakResult.droppedItem.count,
            breakResult.position
          );
        }

        return;
      }

      sendDeniedInteractionCorrections(client, [packet.location]);
    };

    const handleBlockPlacePacket = (packet) => {
      acknowledgeInteractionSequence(client, packet.sequence);
      const placedBlockLocation = world.resolvePlacedBlockLocation(packet.location, packet.direction);
      const heldItem = getHotbarItem(client.inventoryState);
      const blockStateId = resolveBlockStateIdForItem(mcData, heldItem);

      const placeResult = placedBlockLocation && blockStateId !== null
        ? world.placeBlockDetailed(placedBlockLocation, blockStateId)
        : false;

      if (placeResult) {
        const consumed = consumeSelectedItem(client.inventoryState);
        saveWorld();
        broadcastAuthoritativeBlockStates(placeResult.changedPositions ?? [placedBlockLocation]);

        if (consumed) {
          sendInventorySlotUpdate(client, consumed.slot);
        }

        return;
      }

      sendDeniedInteractionCorrections(client, [packet.location, placedBlockLocation]);
    };

    client.on('chat', handleChatPacket);
    client.on('chat_message', handleChatPacket);
    client.on('block_dig', handleBlockDigPacket);
    client.on('block_place', handleBlockPlacePacket);
    client.on('position', (packet) => {
      itemDropManager.setClientPosition(client, packet);

      if ((packet.y ?? 0) < VOID_RESPAWN_Y) {
        respawnPlayer(client);
        return;
      }

      syncClientChunks(client);
      itemDropManager.attemptPickup(client);
    });
    client.on('position_look', (packet) => {
      itemDropManager.setClientPosition(client, packet);

      if ((packet.y ?? 0) < VOID_RESPAWN_Y) {
        respawnPlayer(client);
        return;
      }

      syncClientChunks(client);
      itemDropManager.attemptPickup(client);
    });
    client.on('look', (packet) => {
      itemDropManager.setClientPosition(client, packet);
      processChunkQueue(client);
      itemDropManager.attemptPickup(client);
    });
    client.on('flying', () => {
      itemDropManager.attemptPickup(client);
    });
    client.on('held_item_slot', (packet) => {
      setSelectedHotbarSlot(client.inventoryState, extractSelectedSlot(packet));
    });
    client.on('teleport_confirm', (packet) => {
      recordTeleportConfirm(client.playerState, packet);
    });
    client.on('abilities', (packet) => {
      recordRequestedAbilities(client.playerState, packet);
    });
    client.on('entity_action', (packet) => {
      recordEntityAction(client.playerState, packet);
    });
    client.on('player_input', (packet) => {
      recordPlayerInput(client.playerState, packet);
    });
    client.on('player_loaded', () => {
      recordPlayerLoaded(client.playerState);
    });
    client.on('arm_animation', (packet) => {
      recordArmAnimation(client.playerState, packet);
    });
    client.on('use_item', (packet) => {
      recordUseItem(client.playerState, packet);
    });
  }

  server.on('login', (client) => {
    if (!server.compatibility || !client.supportFeature('hasConfigurationState')) {
      return;
    }

    const inboundPlayRewriter = createCompatibilityInboundPlayPacketRewriter(server.advertisedVersion);

    const installInboundPlayRewriter = () => {
      const source = client.compressor ? client.decompressor : client.splitter;

      if (!source || !client.deserializer) {
        return;
      }

      source.unpipe(client.deserializer);
      source.unpipe(inboundPlayRewriter);
      inboundPlayRewriter.unpipe(client.deserializer);
      source.pipe(inboundPlayRewriter).pipe(client.deserializer);
    };

    client.on('state', (state) => {
      if (state === 'play') {
        installInboundPlayRewriter();
      }
    });

    client.prependOnceListener('login_acknowledged', () => {
      const originalWrite = client.write.bind(client);
      let injectedTags = false;

      client.write = (name, params) => {
        if (!injectedTags && name === 'finish_configuration') {
          injectedTags = true;

          if (server.compatibilityTags.length > 0) {
            originalWrite('tags', {
              tags: server.compatibilityTags
            });
          }
        }

        if (is2612Compatibility(server) && client.state === 'play' && name === 'keep_alive') {
          writeCompatibilityPlayPacket(client, server, name, params);
          return undefined;
        }

        return originalWrite(name, params);
      };
    });
  });

  const worldTimeInterval = setInterval(() => {
    server.worldTimeState = {
      age: server.worldTimeState.age + WORLD_TIME_TICK_AMOUNT,
      time: (server.worldTimeState.time + WORLD_TIME_TICK_AMOUNT) % DAY_LENGTH_TICKS,
      tickDayTime: server.worldTimeState.tickDayTime
    };

    for (const client of connectedClients()) {
      if (!client.worldStateReady) {
        continue;
      }

      writePlayPacket(client, 'update_time', server.worldTimeState);
    }
  }, WORLD_TIME_TICK_INTERVAL_MS);
  worldTimeInterval.unref?.();
  server._ragecraftCleanupHandlers.push(() => clearInterval(worldTimeInterval));

  server.on('playerJoin', initializePlayer);
  server.on('error', (error) => {
    console.error('[server:error]', error);
  });

  return {
    config,
    server,
    versionTarget
  };
}

function closeMinecraftServer(server) {
  return new Promise((resolve, reject) => {
    if (server?._ragecraftCleanupHandlers) {
      for (const cleanup of server._ragecraftCleanupHandlers.splice(0)) {
        try {
          cleanup();
        } catch (error) {
          console.error('[server:cleanup:error]', error);
        }
      }
    }

    if (!server || !server.socketServer) {
      resolve();
      return;
    }

    server.socketServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

module.exports = {
  closeMinecraftServer,
  createMinecraftServer
};
