function createWorldStateHelpers(options) {
  const {
    airBlockStateId,
    bakeChunkLightingRegion,
    chunkWorkerPool,
    collectLightingChunkCoordinates,
    createChunkFromJson,
    createChunkLightTemplate,
    createChunkPacket,
    createChunkTemplate,
    createGeneratedChunk,
    createTranslatedChunk,
    getBlockKey,
    getChunkKey,
    isWithinBuildBounds,
    normalizePosition,
    savedBlocks = [],
    spawnReference,
    surfaceY,
    toChunkCoordinates,
    worldOptions
  } = options;

  const chunks = new Map();
  const generatedChunks = new Map();
  const modifiedBlocks = new Map();

  function createChunkEntry(chunkX, chunkZ) {
    return {
      chunk: null,
      chunkJson: null,
      chunkX,
      chunkZ,
      generationPromise: null,
      lightingDirty: false,
      packetTemplate: null,
      translatedPacketTemplates: new Map()
    };
  }

  function collectChunkNeighborhood(chunkX, chunkZ, radius = 1) {
    const coordinates = [];

    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        coordinates.push({
          chunkX: chunkX + dx,
          chunkZ: chunkZ + dz
        });
      }
    }

    return coordinates;
  }

  function materializeChunkEntry(chunkEntry) {
    if (chunkEntry.chunk) {
      return chunkEntry.chunk;
    }

    if (chunkEntry.chunkJson) {
      chunkEntry.chunk = createChunkFromJson(chunkEntry.chunkJson);
      return chunkEntry.chunk;
    }

    return null;
  }

  function ensureChunk(chunkX, chunkZ) {
    const chunkKey = getChunkKey(chunkX, chunkZ);

    if (!chunks.has(chunkKey)) {
      const chunkEntry = createChunkEntry(chunkX, chunkZ);
      chunkEntry.chunk = createGeneratedChunk(worldOptions, surfaceY, spawnReference, chunkX, chunkZ);
      chunks.set(chunkKey, chunkEntry);
    }

    const chunkEntry = chunks.get(chunkKey);

    if (!chunkEntry.chunk) {
      materializeChunkEntry(chunkEntry);
    }

    return chunkEntry;
  }

  function ensureGeneratedChunk(chunkX, chunkZ) {
    const chunkKey = getChunkKey(chunkX, chunkZ);

    if (!generatedChunks.has(chunkKey)) {
      generatedChunks.set(
        chunkKey,
        createGeneratedChunk(worldOptions, surfaceY, spawnReference, chunkX, chunkZ)
      );
    }

    return generatedChunks.get(chunkKey);
  }

  function getChunkAt(chunkX, chunkZ) {
    return ensureChunk(chunkX, chunkZ).chunk;
  }

  function getExistingChunkAt(chunkX, chunkZ) {
    const chunkEntry = chunks.get(getChunkKey(chunkX, chunkZ));

    if (!chunkEntry) {
      return null;
    }

    return materializeChunkEntry(chunkEntry);
  }

  function preGenerateChunkAsync(chunkX, chunkZ) {
    if (!chunkWorkerPool) {
      ensureChunk(chunkX, chunkZ);
      return Promise.resolve();
    }

    const chunkKey = getChunkKey(chunkX, chunkZ);
    let chunkEntry = chunks.get(chunkKey);

    if (!chunkEntry) {
      chunkEntry = createChunkEntry(chunkX, chunkZ);
      chunks.set(chunkKey, chunkEntry);
    }

    if (chunkEntry.chunk || chunkEntry.chunkJson || chunkEntry.generationPromise) {
      return chunkEntry.generationPromise ?? Promise.resolve();
    }

    chunkEntry.generationPromise = chunkWorkerPool.generateChunk({
      chunkX,
      chunkZ,
      spawnReference,
      surfaceY,
      worldConfig: worldOptions
    }).then((result) => {
      if (!chunkEntry.chunk) {
        chunkEntry.chunkJson = result.chunkJson;
      }

      chunkEntry.generationPromise = null;
    }).catch((error) => {
      chunkEntry.generationPromise = null;
      chunks.delete(chunkKey);
      throw error;
    });

    return chunkEntry.generationPromise;
  }

  function getChunkEntry(position) {
    const coordinates = toChunkCoordinates(position);
    const chunkEntry = ensureChunk(coordinates.chunkX, coordinates.chunkZ);

    return {
      ...coordinates,
      chunkEntry
    };
  }

  function getGeneratedBlockState(position) {
    if (!isWithinBuildBounds(position)) {
      return airBlockStateId;
    }

    const { chunkX, chunkZ, localPosition } = toChunkCoordinates(position);
    const generatedChunk = ensureGeneratedChunk(chunkX, chunkZ);

    return generatedChunk.getBlockStateId(localPosition);
  }

  function invalidateChunkPacketTemplates(chunkEntry) {
    if (!chunkEntry) {
      return;
    }

    chunkEntry.packetTemplate = null;
    chunkEntry.translatedPacketTemplates?.clear();
  }

  function rebakeLightingForChunkCoordinates(chunkCoordinates) {
    const queued = new Map();

    for (const { chunkX, chunkZ } of chunkCoordinates) {
      for (const neighbor of collectChunkNeighborhood(chunkX, chunkZ, 1)) {
        const chunkKey = getChunkKey(neighbor.chunkX, neighbor.chunkZ);

        if (!chunks.has(chunkKey)) {
          continue;
        }

        queued.set(chunkKey, neighbor);
      }
    }

    const rebakeTargets = Array.from(queued.values());

    for (const { chunkX, chunkZ } of rebakeTargets) {
      materializeChunkEntry(chunks.get(getChunkKey(chunkX, chunkZ)));
    }

    for (let pass = 0; pass < 2; pass++) {
      for (const { chunkX, chunkZ } of rebakeTargets) {
        bakeChunkLightingRegion(chunkX, chunkZ, worldOptions, getExistingChunkAt);
      }
    }

    const rebakedChunks = [];

    for (const { chunkX, chunkZ } of rebakeTargets) {
      const chunkEntry = chunks.get(getChunkKey(chunkX, chunkZ));
      chunkEntry.lightingDirty = false;
      rebakedChunks.push({ chunkX, chunkZ });
    }

    return rebakedChunks;
  }

  function markLightingDirtyForChunkCoordinates(chunkCoordinates) {
    for (const { chunkX, chunkZ } of chunkCoordinates) {
      const chunkKey = getChunkKey(chunkX, chunkZ);

      if (!chunks.has(chunkKey)) {
        continue;
      }

      chunks.get(chunkKey).lightingDirty = true;
    }
  }

  function markLightingDirtyForPositions(positions) {
    markLightingDirtyForChunkCoordinates(collectLightingChunkCoordinates(positions));
  }

  function rebakeLightingForPositions(positions) {
    return rebakeLightingForChunkCoordinates(collectLightingChunkCoordinates(positions));
  }

  function ensureChunkLighting(chunkX, chunkZ) {
    const chunkEntry = ensureChunk(chunkX, chunkZ);

    if (!chunkEntry.lightingDirty) {
      return chunkEntry;
    }

    rebakeLightingForChunkCoordinates([{ chunkX, chunkZ }]);
    return chunkEntry;
  }

  function getCachedChunkTemplate(chunkEntry, translateStateId = null) {
    materializeChunkEntry(chunkEntry);

    if (typeof translateStateId !== 'function') {
      if (!chunkEntry.packetTemplate) {
        chunkEntry.packetTemplate = createChunkTemplate(chunkEntry.chunk, surfaceY, worldOptions);
      }

      return chunkEntry.packetTemplate;
    }

    if (!chunkEntry.translatedPacketTemplates) {
      chunkEntry.translatedPacketTemplates = new Map();
    }

    if (!chunkEntry.translatedPacketTemplates.has(translateStateId)) {
      const translatedChunk = createTranslatedChunk(chunkEntry.chunk, translateStateId);
      chunkEntry.translatedPacketTemplates.set(
        translateStateId,
        createChunkTemplate(translatedChunk, surfaceY, worldOptions)
      );
    }

    return chunkEntry.translatedPacketTemplates.get(translateStateId);
  }

  function getBaseBlockState(position) {
    return getGeneratedBlockState(position);
  }

  function getBlockState(position) {
    if (!isWithinBuildBounds(position)) {
      return airBlockStateId;
    }

    const chunkEntry = getChunkEntry(position);

    if (!chunkEntry) {
      return airBlockStateId;
    }

    return chunkEntry.chunkEntry.chunk.getBlockStateId(chunkEntry.localPosition);
  }

  function getBiomeId(position, fallbackBiomeId = worldOptions.biomeId) {
    const chunkEntry = getChunkEntry(position);
    return chunkEntry ? chunkEntry.chunkEntry.chunk.getBiome(chunkEntry.localPosition) : fallbackBiomeId;
  }

  function setBlockState(position, stateId) {
    if (!isWithinBuildBounds(position)) {
      return false;
    }

    const chunkEntry = getChunkEntry(position);

    if (!chunkEntry) {
      return false;
    }

    const previousStateId = chunkEntry.chunkEntry.chunk.getBlockStateId(chunkEntry.localPosition);
    chunkEntry.chunkEntry.chunk.setBlockStateId(chunkEntry.localPosition, stateId);
    invalidateChunkPacketTemplates(chunkEntry.chunkEntry);

    const worldPosition = normalizePosition(chunkEntry.worldPosition);
    markLightingDirtyForPositions([worldPosition]);
    const blockKey = getBlockKey(worldPosition);
    const baseStateId = modifiedBlocks.has(blockKey)
      ? getBaseBlockState(worldPosition)
      : previousStateId;

    if (stateId === baseStateId) {
      modifiedBlocks.delete(blockKey);
    } else {
      modifiedBlocks.set(blockKey, {
        ...worldPosition,
        stateId
      });
    }

    return true;
  }

  function getChunkPacket(chunkX, chunkZ, translateStateId = null) {
    const chunkKey = getChunkKey(chunkX, chunkZ);

    if (chunkWorkerPool && chunks.has(chunkKey)) {
      const existingEntry = chunks.get(chunkKey);

      if (!existingEntry.chunk && !existingEntry.chunkJson) {
        return null;
      }
    }

    const chunkEntry = ensureChunkLighting(chunkX, chunkZ);
    const template = getCachedChunkTemplate(chunkEntry, translateStateId);
    const lightTemplate = createChunkLightTemplate(chunkEntry.chunk);

    return createChunkPacket(chunkX, chunkZ, {
      ...template,
      ...lightTemplate
    });
  }

  function getChunkLightUpdate(chunkX, chunkZ) {
    const chunkEntry = ensureChunkLighting(chunkX, chunkZ);
    const lightTemplate = createChunkLightTemplate(chunkEntry.chunk);

    return {
      chunkX,
      chunkZ,
      skyLightMask: lightTemplate.skyLightMask,
      blockLightMask: lightTemplate.blockLightMask,
      emptySkyLightMask: lightTemplate.emptySkyLightMask,
      emptyBlockLightMask: lightTemplate.emptyBlockLightMask,
      skyLight: lightTemplate.skyLight,
      blockLight: lightTemplate.blockLight
    };
  }

  function getChunkPackets(centerChunkX, centerChunkZ, radius, translateStateId = null) {
    const packets = [];

    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        packets.push(getChunkPacket(centerChunkX + dx, centerChunkZ + dz, translateStateId));
      }
    }

    return packets;
  }

  function serialize() {
    return {
      blocks: Array.from(modifiedBlocks.values())
    };
  }

  function getModifiedBlocks() {
    return Array.from(modifiedBlocks.values());
  }

  function hasChunk(chunkX, chunkZ) {
    const chunkEntry = chunks.get(getChunkKey(chunkX, chunkZ));
    return Boolean(chunkEntry?.chunk || chunkEntry?.chunkJson);
  }

  for (const block of savedBlocks) {
    setBlockState(block, block.stateId);
  }

  if (savedBlocks.length > 0) {
    rebakeLightingForPositions(savedBlocks);
  }

  return {
    collectChunkNeighborhood,
    getBaseBlockState,
    getBiomeId,
    getBlockState,
    getChunkLightUpdate,
    getChunkPacket,
    getChunkPackets,
    getModifiedBlocks,
    hasChunk,
    preGenerateChunk: preGenerateChunkAsync,
    rebakeLightingForPositions,
    serialize,
    setBlockState
  };
}

module.exports = {
  createWorldStateHelpers
};
