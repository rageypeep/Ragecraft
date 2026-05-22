const mc = require('minecraft-protocol');
const { createCompatibilityBlockStateTranslator } = require('./block-state-translator');
const { loadConfig } = require('./config');
const { createRecipeCatalog } = require('./crafting');
const { createCompatibilityItemIdTranslator } = require('./item-id-translator');
const {
  addItem,
  cloneInventoryState,
  consumeSelectedItem,
  createPlayerInventory,
  getHotbarItem,
  resolveBlockStateIdForItem,
  setSelectedHotbarSlot
} = require('./inventory');
const { createInitialWorldPackets } = require('./world');
const { loadWorldState, saveWorldState } = require('./world-persistence');
const {
  buildCompatibilityRegistryCodec,
  loadCompatibilityRegistryOverrides
} = require('./compatibility-registry');
const { applyWorldDimensionBounds } = require('./world/dimension-codec');
const { createChunkWorkerPool } = require('./world/chunk-worker-pool');
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
  createLightUpdatePacket,
  resolvePlayerSpawn
} = require('./server/bootstrap');
const { buildBlockChangePacket, extractSelectedSlot, shouldBreakBlock } = require('./server/blocks');
const { createChatApi, extractChatMessage, formatWelcomeMessage } = require('./server/chat');
const { createCommandApi } = require('./server/commands');
const { createCraftingTableApi } = require('./server/crafting-table');
const { createPlayerTracker } = require('./server/entity-tracking');
const { createItemDropManager } = require('./server/item-entities');
const { createPlayerInventoryApi } = require('./server/player-inventory');
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

const VOID_RESPAWN_MARGIN = 32;
const WORLD_TIME_TICK_INTERVAL_MS = 1000;
const WORLD_TIME_TICK_AMOUNT = 20n;
const DAY_LENGTH_TICKS = 24000n;
const CHUNK_SEND_INTERVAL_MS = 25;
const CHUNK_SEND_BATCH_SIZE = 10;
const CHUNK_SEND_TIME_BUDGET_MS = 30;
const CHUNK_GEN_TIME_BUDGET_MS = 15;

function createMinecraftServer(overrides = {}) {
  const config = loadConfig(overrides);
  const versionTarget = resolveVersionTarget(config.version);
  const mcData = require('minecraft-data')(versionTarget.protocolDataVersion);
  const chunkWorkerPool = createChunkWorkerPool();
  const persistedWorldState = loadWorldState(config.worldSavePath);
  const persistedPlayers = new Map(Object.entries(persistedWorldState.players ?? {}));
  const world = createInitialWorldPackets(mcData, {
    ...config,
    _chunkWorkerPool: chunkWorkerPool
  }, persistedWorldState);
  const baseRegistryCodec = mcData.registryCodec || mcData.loginPacket?.dimensionCodec || {};
  const crafting = createRecipeCatalog(mcData);
  const registryOverrides = versionTarget.compatibility
    ? loadCompatibilityRegistryOverrides(versionTarget.advertisedVersion)
    : null;
  const blockStateTranslator = versionTarget.compatibility
    ? createCompatibilityBlockStateTranslator(mcData, versionTarget.advertisedVersion)
    : null;
  const itemIdTranslator = versionTarget.compatibility
    ? createCompatibilityItemIdTranslator(mcData, versionTarget.advertisedVersion)
    : null;
  const registryCodec = versionTarget.compatibility
    ? buildCompatibilityRegistryCodec(baseRegistryCodec, registryOverrides)
    : baseRegistryCodec;
  const resolvedRegistryCodec = applyWorldDimensionBounds(registryCodec, world);
  const voidRespawnY = world.minWorldY - VOID_RESPAWN_MARGIN;
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
    registryCodec: resolvedRegistryCodec,
    ...versionTarget.createServerOptions
  });
  const loginPacket = mcData.loginPacket;
  const craftingTableBlockStateId = mcData.blocksByName.crafting_table?.defaultState ?? null;

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
  server.crafting = crafting;
  server.world = world;
  server.registryCodec = resolvedRegistryCodec;
  server.worldTimeState = buildPlayerStatusPackets().time;
  server._ragecraftCleanupHandlers = [];
  server._ragecraftCleanupHandlers.push(() => {
    chunkWorkerPool.close().catch((error) => {
      console.error('[chunk-worker:close:error]', error);
    });
  });

  function serializePersistedPlayers() {
    return Object.fromEntries(persistedPlayers.entries());
  }

  function snapshotPlayerState(client) {
    if (!client?.username) {
      return null;
    }

    const inventorySnapshot = client.inventoryState
      ? cloneInventoryState(client.inventoryState)
      : null;

    if (inventorySnapshot && client.activeContainer?.type === 'minecraft:crafting_table') {
      for (const item of client.activeContainer.craftInput ?? []) {
        if (!item) {
          continue;
        }

        addItem(inventorySnapshot, mcData, item.itemId, item.count);
      }
    }

    const playerPosition = client.playerPosition && Number.isFinite(client.playerPosition.x)
      ? {
          x: client.playerPosition.x,
          y: client.playerPosition.y,
          z: client.playerPosition.z,
          yaw: Number.isFinite(client.playerPosition.yaw) ? client.playerPosition.yaw : 0,
          pitch: Number.isFinite(client.playerPosition.pitch) ? client.playerPosition.pitch : 0
        }
      : null;

    return {
      position: playerPosition,
      inventory: inventorySnapshot
        ? {
            craftInput: inventorySnapshot.craftInput.map((item) => (
              item
                ? {
                    itemId: item.itemId,
                    count: item.count
                  }
                : null
            )),
            armor: inventorySnapshot.armor.map((item) => (
              item
                ? {
                    itemId: item.itemId,
                    count: item.count
                  }
                : null
            )),
            main: inventorySnapshot.main.map((item) => (
              item
                ? {
                    itemId: item.itemId,
                    count: item.count
                  }
                : null
            )),
            hotbar: inventorySnapshot.hotbar.map((item) => (
              item
                ? {
                    itemId: item.itemId,
                    count: item.count
                  }
                : null
            )),
            offhand: inventorySnapshot.offhand
              ? {
                  itemId: inventorySnapshot.offhand.itemId,
                  count: inventorySnapshot.offhand.count
                }
              : null,
            selectedSlot: inventorySnapshot.selectedSlot ?? 0
          }
        : null
    };
  }

  function rememberPlayerState(client) {
    const snapshot = snapshotPlayerState(client);

    if (!snapshot) {
      return;
    }

    persistedPlayers.set(client.username, snapshot);
  }

  function connectedClients(excludeClient = null) {
    return Object.values(server.clients).filter((client) => client !== excludeClient);
  }

  function prewarmSpawnChunks() {
    const spawnNeighborhood = world.getChunkNeighborhood(
      world.spawnChunk.x,
      world.spawnChunk.z,
      world.streamRadius
    );

    return Promise.allSettled(
      spawnNeighborhood.map(({ chunkX, chunkZ }) => world.preGenerateChunk(chunkX, chunkZ))
    );
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

  function broadcastLightUpdates(chunkCoordinates) {
    const seen = new Set();

    for (const { chunkX, chunkZ } of chunkCoordinates ?? []) {
      const chunkKey = `${chunkX},${chunkZ}`;

      if (seen.has(chunkKey)) {
        continue;
      }

      seen.add(chunkKey);
      const lightUpdatePacket = world.getChunkLightUpdate(chunkX, chunkZ);

      for (const client of connectedClients()) {
        writePlayPacket(client, 'update_light', lightUpdatePacket);
      }
    }
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
      yaw: Number.isFinite(position.yaw) ? position.yaw : config.spawn.yaw,
      pitch: Number.isFinite(position.pitch) ? position.pitch : config.spawn.pitch,
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

  function updateWorldTime(nextTime) {
    server.worldTimeState = {
      ...server.worldTimeState,
      time: nextTime
    };

    for (const client of connectedClients()) {
      if (!client.worldStateReady) {
        continue;
      }

      writePlayPacket(client, 'update_time', server.worldTimeState);
    }
  }

  function saveWorld() {
    saveWorldState(config.worldSavePath, {
      ...world.serialize(),
      players: serializePersistedPlayers()
    });
  }
  server._ragecraftCleanupHandlers.push(() => saveWorld());

  let craftingTableApi = null;
  const playerInventoryApi = createPlayerInventoryApi({
    crafting,
    mcData,
    translateItemId: itemIdTranslator?.translate,
    writePlayPacket
  });

  function sendVisibleInventoryState(client) {
    if (craftingTableApi?.commitVisibleInventoryChange(client)) {
      rememberPlayerState(client);
      return;
    }

    playerInventoryApi.commitInventoryChange(client);
    rememberPlayerState(client);
  }

  function closeOpenContainer(client, sendPacket = false) {
    if (!craftingTableApi?.closeActiveWindow(client, { sendPacket })) {
      return false;
    }

    playerInventoryApi.commitInventoryChange(client);
    rememberPlayerState(client);
    return true;
  }

  function sendInventorySlotUpdate(client, slot) {
    if (craftingTableApi?.commitVisibleInventoryChange(client)) {
      rememberPlayerState(client);
      return;
    }

    playerInventoryApi.sendHotbarSlotUpdate(client, slot);
    rememberPlayerState(client);
  }

  const itemDropManager = createItemDropManager({
    connectedClients,
    mcData,
    onInventoryChanged: rememberPlayerState,
    sendInventoryState: sendVisibleInventoryState,
    translateItemId: itemIdTranslator?.translate,
    writePlayPacket
  });
  craftingTableApi = createCraftingTableApi({
    crafting,
    mcData,
    onOverflowItem(client, item) {
      if (!client?.playerPosition || !item) {
        return;
      }

      itemDropManager.spawnDrop(item.itemId, item.count, client.playerPosition);
    },
    translateItemId: itemIdTranslator?.translate,
    writePlayPacket
  });
  const playerTracker = createPlayerTracker({
    connectedClients,
    mcData,
    writePlayPacket
  });
  const { createCommandDeclarationPacket, tryHandlePlayerCommand } = createCommandApi({
    config,
    crafting,
    saveWorld,
    sendFullInventoryState: sendVisibleInventoryState,
    sendMessage,
    server,
    teleportClient,
    updateWorldTime,
    world
  });
  server._ragecraftCleanupHandlers.push(() => itemDropManager.cleanup());
  const chunkQueueInterval = setInterval(() => {
    for (const client of connectedClients()) {
      processChunkQueue(client);
    }
  }, CHUNK_SEND_INTERVAL_MS);
  server._ragecraftCleanupHandlers.push(() => clearInterval(chunkQueueInterval));
  server.spawnChunkWarmupPromise = prewarmSpawnChunks().catch((error) => {
    console.error('[chunk-warmup:error]', error);
  });

  function teleportClient(client, targetPosition) {
    if (!client || !targetPosition) {
      return false;
    }

    const currentPosition = client.playerPosition ?? {
      x: 0,
      y: config.spawn.y,
      z: 0,
      yaw: config.spawn.yaw,
      pitch: config.spawn.pitch
    };
    const resolvedPosition = {
      x: targetPosition.x,
      y: targetPosition.y,
      z: targetPosition.z,
      yaw: targetPosition.yaw ?? currentPosition.yaw ?? config.spawn.yaw,
      pitch: targetPosition.pitch ?? currentPosition.pitch ?? config.spawn.pitch
    };
    const teleportId = allocateTeleportId(client);

    closeOpenContainer(client, true);
    cancelChunkGeneration(client);
    itemDropManager.setClientPosition(client, resolvedPosition);
    rememberPlayerState(client);

    if (client.playerState) {
      client.playerState.pendingTeleportId = teleportId;
    }

    syncClientChunks(client, true);
    writePositionPacket(client, buildPositionPacket(resolvedPosition, teleportId));
    playerTracker.broadcastTeleport(client);
    itemDropManager.attemptPickup(client);
    return true;
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
      distanceSquared,
      preGenerationRequested: false
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

  function cancelChunkGeneration(client) {
    if (client._chunkGenHandle) {
      clearImmediate(client._chunkGenHandle);
      client._chunkGenHandle = null;
    }

    client._chunkGenRunning = false;
  }

  function scheduleChunkGeneration(client) {
    if (client._chunkGenRunning || !client.pendingChunkQueue || client.pendingChunkQueue.length === 0) {
      return;
    }

    client._chunkGenRunning = true;

    const generateNextBatch = () => {
      client._chunkGenHandle = null;

      if (!client.pendingChunkQueue || client.pendingChunkQueue.length === 0) {
        client._chunkGenRunning = false;
        return;
      }

      const startedAt = process.hrtime.bigint();
      let hitBudget = false;

      for (const entry of client.pendingChunkQueue) {
        const chunkKey = `${entry.chunkX},${entry.chunkZ}`;

        if (client.loadedChunkKeys && client.loadedChunkKeys.has(chunkKey)) {
          continue;
        }

        if (entry.preGenerationRequested || world.hasChunk(entry.chunkX, entry.chunkZ)) {
          continue;
        }

        entry.preGenerationRequested = true;
        world.preGenerateChunk(entry.chunkX, entry.chunkZ).then(() => {
          entry.preGenerationRequested = false;
        }).catch((error) => {
          entry.preGenerationRequested = false;
          console.error('[chunk-worker:error]', error);
        });

        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

        if (elapsedMs >= CHUNK_GEN_TIME_BUDGET_MS) {
          hitBudget = true;
          break;
        }
      }

      if (hitBudget) {
        client._chunkGenHandle = setImmediate(generateNextBatch);
      } else {
        client._chunkGenRunning = false;
      }
    };

    client._chunkGenHandle = setImmediate(generateNextBatch);
  }

  function processChunkQueue(client) {
    if (!client || !client.pendingChunkQueue || client.pendingChunkQueue.length === 0) {
      return;
    }

    client.pendingChunkQueue.sort((left, right) => compareChunkQueueEntries(left, right, client));
    const startedAt = process.hrtime.bigint();
    let sent = 0;
    const toRemove = new Set();

    for (let i = 0; i < client.pendingChunkQueue.length; i++) {
      if (sent >= CHUNK_SEND_BATCH_SIZE) {
        break;
      }

      if (sent > 0) {
        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

        if (elapsedMs >= CHUNK_SEND_TIME_BUDGET_MS) {
          break;
        }
      }

      const entry = client.pendingChunkQueue[i];
      const chunkKey = `${entry.chunkX},${entry.chunkZ}`;

      if (client.loadedChunkKeys.has(chunkKey)) {
        toRemove.add(i);
        client.pendingChunkKeys.delete(chunkKey);
        continue;
      }

      if (!world.hasChunk(entry.chunkX, entry.chunkZ)) {
        continue;
      }

      const chunkPacket = world.getChunkPacket(
        entry.chunkX,
        entry.chunkZ,
        blockStateTranslator ? translateBlockStateId : null
      );
      writePlayPacket(client, 'map_chunk', chunkPacket);
      writePlayPacket(client, 'update_light', createLightUpdatePacket(chunkPacket));
      client.loadedChunkKeys.add(chunkKey);
      client.pendingChunkKeys.delete(chunkKey);
      toRemove.add(i);
      sent += 1;
    }

    if (toRemove.size > 0) {
      client.pendingChunkQueue = client.pendingChunkQueue.filter((_, i) => !toRemove.has(i));
    }

    scheduleChunkGeneration(client);
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

      for (const entry of client.pendingChunkQueue) {
        entry.deltaX = entry.chunkX - currentChunk.chunkX;
        entry.deltaZ = entry.chunkZ - currentChunk.chunkZ;
        entry.distance = Math.abs(entry.deltaX) + Math.abs(entry.deltaZ);
        entry.distanceSquared = (entry.deltaX * entry.deltaX) + (entry.deltaZ * entry.deltaZ);
      }
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
    const safeSpawn = resolvePlayerSpawn(world);
    const teleportId = allocateTeleportId(client);

    closeOpenContainer(client, true);
    cancelChunkGeneration(client);
    itemDropManager.setClientPosition(client, safeSpawn);
    rememberPlayerState(client);
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
    playerTracker.broadcastTeleport(client);
    finalizeClientWorldState(client, client.playerStatus);
  }

  function initializePlayer(client) {
    const address = `${client.socket.remoteAddress}:${client.socket.remotePort}`;
    const persistedPlayer = persistedPlayers.get(client.username) ?? null;
    const bootstrapPackets = buildPlayerBootstrapPackets(client, config, world, loginPacket, persistedPlayer);
    client.inventoryState = createPlayerInventory(mcData, persistedPlayer?.inventory ?? null);
    playerInventoryApi.recomputeCraftingResult(client.inventoryState);
    client.playerState = createPlayerState(bootstrapPackets.position.teleportId);
    client.playerStatus = bootstrapPackets.playerStatus;
    client.nextTeleportId = 1;
    client.activeContainer = null;
    client.worldStateReady = false;
    itemDropManager.setClientPosition(client, bootstrapPackets.position);
    client.loadedChunkKeys = new Set();
    client.pendingChunkKeys = new Set();
    client.pendingChunkQueue = [];
    client.chunkCenter = null;
    playerTracker.registerPlayer(client);
    rememberPlayerState(client);

    console.log(`[join] ${client.username} (${address})`);

    client.on('end', () => {
      closeOpenContainer(client, false);
      cancelChunkGeneration(client);
      playerTracker.broadcastLeave(client);
      rememberPlayerState(client);
      saveWorld();
      console.log(`[leave] ${client.username} (${address})`);
      broadcastSystemMessage(`${client.username} left the game.`, client);
    });

    writeLoginPacket(client, bootstrapPackets.login);

    writePlayPacket(client, 'initialize_world_border', bootstrapPackets.border);
    writePlayPacket(client, 'update_view_distance', bootstrapPackets.viewDistance);
    writePlayPacket(client, 'simulation_distance', bootstrapPackets.simulationDistance);
    writePlayPacket(client, 'declare_commands', createCommandDeclarationPacket());
    writePlayPacket(client, 'spawn_position', bootstrapPackets.spawnPosition);
    writePlayPacket(client, 'abilities', bootstrapPackets.abilities);
    writePlayPacket(client, 'game_state_change', bootstrapPackets.gameStateChange);
    syncClientChunks(client, true);
    writePositionPacket(client, bootstrapPackets.position);
    finalizeClientWorldState(client, bootstrapPackets.playerStatus);
    playerTracker.syncPlayersForClient(client);
    playerTracker.broadcastJoin(client);

    sendModifiedBlockBootstrap(client);
    itemDropManager.sendExistingDrops(client);

    playerInventoryApi.sendInventoryBootstrap(client);
    writePlayPacket(client, 'held_item_slot', {
      slot: client.inventoryState.selectedSlot
    });

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

      if (tryHandlePlayerCommand(client, message)) {
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
        broadcastLightUpdates(breakResult.lightChunkCoordinates);

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
      const targetedBlockStateId = world.getBlockState(packet.location);

      if (craftingTableBlockStateId !== null && targetedBlockStateId === craftingTableBlockStateId) {
        craftingTableApi.openCraftingTable(client, packet.location);
        return;
      }

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
        broadcastLightUpdates(placeResult.lightChunkCoordinates);

        if (consumed) {
          sendInventorySlotUpdate(client, consumed.slot);
        }

        return;
      }

      sendDeniedInteractionCorrections(client, [packet.location, placedBlockLocation]);
    };

    client.on('chat', handleChatPacket);
    client.on('chat_message', handleChatPacket);
    client.on('chat_command', (packet) => {
      tryHandlePlayerCommand(client, `/${packet.command ?? ''}`);
    });
    client.on('chat_command_signed', (packet) => {
      tryHandlePlayerCommand(client, `/${packet.command ?? ''}`);
    });
    client.on('block_dig', handleBlockDigPacket);
    client.on('block_place', handleBlockPlacePacket);
    client.on('window_click', (packet) => {
      if (craftingTableApi.handleWindowClick(client, packet) || playerInventoryApi.handleWindowClick(client, packet)) {
        rememberPlayerState(client);
        saveWorld();
      }
    });
    client.on('close_window', (packet) => {
      if (packet?.windowId === client.activeContainer?.windowId && closeOpenContainer(client, false)) {
        saveWorld();
      }
    });
    client.on('position', (packet) => {
      const previousPosition = client.playerPosition ? { ...client.playerPosition } : null;
      itemDropManager.setClientPosition(client, packet);
      rememberPlayerState(client);

      if ((packet.y ?? 0) < voidRespawnY) {
        respawnPlayer(client);
        return;
      }

      playerTracker.broadcastMovement(client, previousPosition);
      syncClientChunks(client);
      itemDropManager.attemptPickup(client);
    });
    client.on('position_look', (packet) => {
      const previousPosition = client.playerPosition ? { ...client.playerPosition } : null;
      itemDropManager.setClientPosition(client, packet);
      rememberPlayerState(client);

      if ((packet.y ?? 0) < voidRespawnY) {
        respawnPlayer(client);
        return;
      }

      playerTracker.broadcastMovement(client, previousPosition);
      syncClientChunks(client);
      itemDropManager.attemptPickup(client);
    });
    client.on('look', (packet) => {
      const previousPosition = client.playerPosition ? { ...client.playerPosition } : null;
      itemDropManager.setClientPosition(client, packet);
      rememberPlayerState(client);
      playerTracker.broadcastMovement(client, previousPosition);
      processChunkQueue(client);
      itemDropManager.attemptPickup(client);
    });
    client.on('flying', () => {
      itemDropManager.attemptPickup(client);
    });
    client.on('held_item_slot', (packet) => {
      setSelectedHotbarSlot(client.inventoryState, extractSelectedSlot(packet));
      rememberPlayerState(client);
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
