const mc = require('minecraft-protocol');
const { loadConfig } = require('./config');
const {
  addItem,
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
const { buildPlayerBootstrapPackets, createLightUpdatePacket } = require('./server/bootstrap');
const { buildBlockChangePacket, extractSelectedSlot, shouldBreakBlock } = require('./server/blocks');
const { createChatApi, extractChatMessage, formatWelcomeMessage } = require('./server/chat');
const { resolveVersionTarget } = require('./versioning');

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

  function connectedClients(excludeClient = null) {
    return Object.values(server.clients).filter((client) => client !== excludeClient);
  }

  const { broadcastPlayerMessage, broadcastSystemMessage, sendMessage } = createChatApi({
    connectedClients,
    isCompatibilityActive: () => is2612Compatibility(server),
    mcData,
    server
  });

  function writePlayPacket(client, name, params) {
    if (is2612Compatibility(server)) {
      writeCompatibilityPlayPacket(client, server, name, params);
      return;
    }

    client.write(name, params);
  }

  function acknowledgeInteractionSequence(client, sequenceId) {
    if (!Number.isInteger(sequenceId)) {
      return;
    }

    writePlayPacket(client, 'acknowledge_player_digging', {
      sequenceId
    });
  }

  function sendAuthoritativeBlockState(client, position) {
    const blockChangePacket = buildBlockChangePacket(world, position);

    if (!blockChangePacket) {
      return;
    }

    writePlayPacket(client, 'block_change', blockChangePacket);
  }

  function sendModifiedBlockBootstrap(client) {
    for (const block of world.getModifiedBlocks()) {
      sendAuthoritativeBlockState(client, block);
    }
  }

  function broadcastAuthoritativeBlockState(position) {
    const blockChangePacket = buildBlockChangePacket(world, position);

    if (!blockChangePacket) {
      return;
    }

    for (const client of connectedClients()) {
      writePlayPacket(client, 'block_change', blockChangePacket);
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

  function saveWorld() {
    saveWorldState(config.worldSavePath, world.serialize());
  }

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

  function initializePlayer(client) {
    const address = `${client.socket.remoteAddress}:${client.socket.remotePort}`;
    client.inventoryState = createPlayerInventory(mcData);
    const bootstrapPackets = buildPlayerBootstrapPackets(client, config, world, loginPacket);

    console.log(`[join] ${client.username} (${address})`);

    client.on('end', () => {
      console.log(`[leave] ${client.username} (${address})`);
      broadcastSystemMessage(`${client.username} left the game.`, client);
    });

    if (is2612Compatibility(server)) {
      writeCompatibilityLoginPacket(client, server, bootstrapPackets.login);
    } else {
      client.write('login', bootstrapPackets.login);
    }

    writePlayPacket(client, 'initialize_world_border', bootstrapPackets.border);
    writePlayPacket(client, 'update_view_distance', bootstrapPackets.viewDistance);
    writePlayPacket(client, 'simulation_distance', bootstrapPackets.simulationDistance);
    writePlayPacket(client, 'update_view_position', bootstrapPackets.viewPosition);
    writePlayPacket(client, 'spawn_position', bootstrapPackets.spawnPosition);
    writePlayPacket(client, 'abilities', bootstrapPackets.abilities);
    writePlayPacket(client, 'game_state_change', bootstrapPackets.gameStateChange);

    for (const chunk of world.createChunkPackets()) {
      writePlayPacket(client, 'map_chunk', chunk);
      writePlayPacket(client, 'update_light', createLightUpdatePacket(chunk));
    }

    if (is2612Compatibility(server)) {
      writeCompatibilityPositionPacket(client, server, bootstrapPackets.position);
    } else {
      client.write('position', bootstrapPackets.position);
    }

    sendModifiedBlockBootstrap(client);

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
        broadcastAuthoritativeBlockState(packet.location);

        if (breakResult.droppedItem) {
          const pickupResult = addItem(
            client.inventoryState,
            mcData,
            breakResult.droppedItem.itemId,
            breakResult.droppedItem.count
          );

          for (const slot of pickupResult.updatedSlots) {
            sendInventorySlotUpdate(client, slot);
          }
        }

        return;
      }

      sendAuthoritativeBlockState(client, packet.location);
    };

    const handleBlockPlacePacket = (packet) => {
      acknowledgeInteractionSequence(client, packet.sequence);
      const placedBlockLocation = world.resolvePlacedBlockLocation(packet.location, packet.direction);
      const heldItem = getHotbarItem(client.inventoryState);
      const blockStateId = resolveBlockStateIdForItem(mcData, heldItem);

      if (placedBlockLocation && blockStateId !== null && world.placeBlock(placedBlockLocation, blockStateId)) {
        const consumed = consumeSelectedItem(client.inventoryState);
        saveWorld();
        broadcastAuthoritativeBlockState(placedBlockLocation);

        if (consumed) {
          sendInventorySlotUpdate(client, consumed.slot);
        }

        return;
      }

      sendAuthoritativeBlockState(client, packet.location);
      sendAuthoritativeBlockState(client, placedBlockLocation);
    };

    client.on('chat', handleChatPacket);
    client.on('chat_message', handleChatPacket);
    client.on('block_dig', handleBlockDigPacket);
    client.on('block_place', handleBlockPlacePacket);
    client.on('held_item_slot', (packet) => {
      setSelectedHotbarSlot(client.inventoryState, extractSelectedSlot(packet));
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
