const Vec3 = require('vec3');
const biomes = require('./biomes');
const chunkHelpers = require('./world/chunks');
const { createChunkFromJson } = require('./world/chunk-factory');
const { createFluidHelpers } = require('./world/fluids');
const { createSpawnHelpers } = require('./world/spawn');
const { collectLightingChunkCoordinates } = require('./world/light-runtime');
const { bakeChunkLightingRegion } = require('./world/lighting');
const runtimeUtils = require('./world/runtime-utils');
const generation = require('./world/generation');

const WATER_FLOW_HORIZONTAL_RADIUS = 8;
const WATER_FLOW_VERTICAL_UP_RADIUS = 6;
const WATER_FLOW_VERTICAL_DOWN_RADIUS = 18;
const WATER_FLOW_MAX_LEVEL = 7;
const WATER_FLOW_MAX_ITERATIONS = 24;
const FACE_OFFSETS = {
  0: { x: 0, y: -1, z: 0 },
  1: { x: 0, y: 1, z: 0 },
  2: { x: 0, y: 0, z: -1 },
  3: { x: 0, y: 0, z: 1 },
  4: { x: -1, y: 0, z: 0 },
  5: { x: 1, y: 0, z: 0 }
};

const { normalizePosition, getChunkKey, getBlockKey, toChunkCoordinates } = runtimeUtils;
const {
  createGeneratedChunk,
  getConfiguredSurfaceY,
  getSpawnChunk,
  resolveWorldOptions
} = generation;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function hashSeedValue(seedHash, salt) {
  let value = (seedHash ^ salt) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 2246822519) >>> 0;
  value ^= value >>> 13;
  value = Math.imul(value, 3266489917) >>> 0;
  value ^= value >>> 16;
  return value >>> 0;
}

function resolveSpawnReference(config, worldOptions) {
  const configuredSpawn = config.spawn ?? {};

  if (configuredSpawn.useConfiguredPosition !== false) {
    return {
      ...configuredSpawn,
      x: Math.floor(configuredSpawn.x ?? 0),
      z: Math.floor(configuredSpawn.z ?? 0)
    };
  }

  const chunkRadius = 96;
  const minimumAxisDistance = 12;
  let spawnChunkX = (hashSeedValue(worldOptions.seedHash, 0x9e3779b9) % ((chunkRadius * 2) + 1)) - chunkRadius;
  let spawnChunkZ = (hashSeedValue(worldOptions.seedHash, 0x85ebca6b) % ((chunkRadius * 2) + 1)) - chunkRadius;

  if (Math.abs(spawnChunkX) < minimumAxisDistance && Math.abs(spawnChunkZ) < minimumAxisDistance) {
    if ((hashSeedValue(worldOptions.seedHash, 0xc2b2ae35) & 1) === 0) {
      spawnChunkX += spawnChunkX < 0 ? -minimumAxisDistance : minimumAxisDistance;
    } else {
      spawnChunkZ += spawnChunkZ < 0 ? -minimumAxisDistance : minimumAxisDistance;
    }
  }

  const localX = 4 + (hashSeedValue(worldOptions.seedHash, 0x27d4eb2f) % 8);
  const localZ = 4 + (hashSeedValue(worldOptions.seedHash, 0x165667b1) % 8);

  return {
    ...configuredSpawn,
    x: (spawnChunkX * 16) + localX,
    z: (spawnChunkZ * 16) + localZ
  };
}

function createChunkTemplate(chunk, surfaceY, worldOptions) {
  return chunkHelpers.createChunkTemplate(chunk, surfaceY, worldOptions);
}

function createTranslatedChunk(sourceChunk, translateStateId) {
  return chunkHelpers.createTranslatedChunk(sourceChunk, translateStateId);
}

function createChunkPacket(x, z, template) {
  return chunkHelpers.createChunkPacket(x, z, template);
}

function createInitialWorldPackets(mcData, config, savedWorldState = { blocks: [] }) {
  const worldOptions = resolveWorldOptions(mcData, config);
  const chunkWorkerPool = config._chunkWorkerPool ?? null;
  const spawnReference = resolveSpawnReference(config, worldOptions);
  const spawnChunk = getSpawnChunk(spawnReference);
  const surfaceY = getConfiguredSurfaceY(worldOptions, spawnReference.y);
  const minChunkX = spawnChunk.x - worldOptions.chunkRadius;
  const maxChunkX = spawnChunk.x + worldOptions.chunkRadius;
  const minChunkZ = spawnChunk.z - worldOptions.chunkRadius;
  const maxChunkZ = spawnChunk.z + worldOptions.chunkRadius;
  const minX = minChunkX * 16;
  const maxX = ((maxChunkX + 1) * 16) - 1;
  const minZ = minChunkZ * 16;
  const maxZ = ((maxChunkZ + 1) * 16) - 1;
  const floorStartY = surfaceY - (worldOptions.terrainThickness - 1);
  const maxBuildY = worldOptions.maxWorldY;
  const topBlockStateId = worldOptions.surfaceBlockStateId;
  const fillBlockStateId = worldOptions.soilBlockStateId;
  const placementBlockStateId = topBlockStateId;
  const airBlockStateId = mcData.blocksByName.air.defaultState;
  const minBuildY = worldOptions.minWorldY;
  const waterSourceStateId = worldOptions.terrainBlockStateIds.water;
  const maxWaterStateId = worldOptions.terrainBlockStateIds.waterMax;
  const chunks = new Map();
  const generatedChunks = new Map();
  const modifiedBlocks = new Map();

  function shouldPerformImmediateLightUpdate(previousStateId, nextStateId) {
    const previousBlock = mcData.blocksByStateId[previousStateId];
    const nextBlock = mcData.blocksByStateId[nextStateId];

    return (
      (previousBlock?.emitLight ?? 0) > 0 ||
      (nextBlock?.emitLight ?? 0) > 0
    );
  }

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

  function markChunkLightingNeighborhoodDirty(chunkX, chunkZ, radius = 1) {
    markLightingDirtyForChunkCoordinates(collectChunkNeighborhood(chunkX, chunkZ, radius));
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
      markChunkLightingNeighborhoodDirty(chunkX, chunkZ);
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

      markChunkLightingNeighborhoodDirty(chunkX, chunkZ);
      chunkEntry.generationPromise = null;
    }).catch((error) => {
      chunkEntry.generationPromise = null;
      chunks.delete(chunkKey);
      throw error;
    });

    return chunkEntry.generationPromise;
  }

  function isWithinPlatformBounds(position) {
    const normalizedPosition = normalizePosition(position);

    if (!normalizedPosition) {
      return false;
    }

    return (
      normalizedPosition.x >= minX &&
      normalizedPosition.x <= maxX &&
      normalizedPosition.z >= minZ &&
      normalizedPosition.z <= maxZ &&
      normalizedPosition.y >= floorStartY &&
      normalizedPosition.y <= surfaceY
    );
  }

  function isWithinBuildBounds(position) {
    const normalizedPosition = normalizePosition(position);

    if (!normalizedPosition) {
      return false;
    }

    return normalizedPosition.y >= minBuildY && normalizedPosition.y <= maxBuildY;
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
    const rebakedChunks = [];

    for (const { chunkX, chunkZ } of chunkCoordinates) {
      const chunkKey = getChunkKey(chunkX, chunkZ);

      if (!chunks.has(chunkKey)) {
        continue;
      }

      const chunkEntry = chunks.get(chunkKey);
      materializeChunkEntry(chunkEntry);

      bakeChunkLightingRegion(chunkX, chunkZ, worldOptions, getChunkAt);
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

    bakeChunkLightingRegion(chunkX, chunkZ, worldOptions, getChunkAt);
    chunkEntry.lightingDirty = false;
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

  const { getSafeSpawnPosition } = createSpawnHelpers({
    getBlockState,
    getBlockDefinition: (stateId) => mcData.blocksByStateId[stateId],
    maxBuildY,
    maxX,
    maxZ,
    minBuildY,
    minX,
    minZ,
    spawnReference
  });

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

  const {
    isWaterStateId,
    recomputeWaterAround
  } = createFluidHelpers({
    airBlockStateId,
    waterSourceStateId,
    maxWaterStateId,
    waterFlowMaxLevel: WATER_FLOW_MAX_LEVEL,
    waterFlowHorizontalRadius: WATER_FLOW_HORIZONTAL_RADIUS,
    waterFlowVerticalUpRadius: WATER_FLOW_VERTICAL_UP_RADIUS,
    waterFlowVerticalDownRadius: WATER_FLOW_VERTICAL_DOWN_RADIUS,
    waterFlowMaxIterations: WATER_FLOW_MAX_ITERATIONS,
    minFlowFloorY: floorStartY,
    maxBuildY,
    normalizePosition,
    clamp,
    getBlockState,
    getBaseBlockState,
    setBlockState,
    isWithinBuildBounds,
    getBlockDefinition: (stateId) => mcData.blocksByStateId[stateId]
  });

  function breakBlock(position) {
    if (!isWithinBuildBounds(position)) {
      return null;
    }

    const currentStateId = getBlockState(position);

    if (currentStateId === airBlockStateId) {
      return null;
    }

    const blockDefinition = mcData.blocksByStateId[currentStateId];
    const droppedItemId = blockDefinition?.drops?.[0];
    const normalizedPosition = normalizePosition(position);

    if (!setBlockState(normalizedPosition, airBlockStateId)) {
      return null;
    }

    const changedPositions = [normalizedPosition, ...recomputeWaterAround(normalizedPosition)];
    const lightChunkCoordinates = shouldPerformImmediateLightUpdate(currentStateId, airBlockStateId)
      ? rebakeLightingForPositions([normalizedPosition])
      : [];

    return {
      changedPositions,
      lightChunkCoordinates,
      droppedItem: Number.isInteger(droppedItemId)
        ? { itemId: droppedItemId, count: 1 }
        : null,
      position: normalizedPosition,
      stateId: currentStateId
    };
  }

  function placeBlockDetailed(position, stateId = placementBlockStateId) {
    const normalizedPosition = normalizePosition(position);

    if (!isWithinBuildBounds(normalizedPosition)) {
      return false;
    }

    const currentStateId = getBlockState(normalizedPosition);

    if (currentStateId !== airBlockStateId && !isWaterStateId(currentStateId)) {
      return false;
    }

    if (!setBlockState(normalizedPosition, stateId)) {
      return false;
    }

    const changedPositions = [normalizedPosition, ...recomputeWaterAround(normalizedPosition)];
    const lightChunkCoordinates = shouldPerformImmediateLightUpdate(currentStateId, stateId)
      ? rebakeLightingForPositions([normalizedPosition])
      : [];

    return {
      changedPositions,
      lightChunkCoordinates,
      position: normalizedPosition,
      stateId
    };
  }

  function placeBlock(position, stateId = placementBlockStateId) {
    return Boolean(placeBlockDetailed(position, stateId));
  }

  function createChunkPackets() {
    return getChunkPackets(spawnChunk.x, spawnChunk.z, worldOptions.chunkRadius);
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
    const lightTemplate = chunkHelpers.createChunkLightTemplate(chunkEntry.chunk);

    return createChunkPacket(chunkX, chunkZ, {
      ...template,
      ...lightTemplate
    });
  }

  function getChunkLightUpdate(chunkX, chunkZ) {
    const chunkEntry = ensureChunkLighting(chunkX, chunkZ);
    const lightTemplate = chunkHelpers.createChunkLightTemplate(chunkEntry.chunk);

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

  function resolvePlacedBlockLocation(position, direction) {
    const normalizedPosition = normalizePosition(position);
    const offset = FACE_OFFSETS[direction];

    if (!normalizedPosition || !offset) {
      return null;
    }

    return {
      x: normalizedPosition.x + offset.x,
      y: normalizedPosition.y + offset.y,
      z: normalizedPosition.z + offset.z
    };
  }

  function serialize() {
    return {
      blocks: Array.from(modifiedBlocks.values())
    };
  }

  function getModifiedBlocks() {
    return Array.from(modifiedBlocks.values());
  }

  for (const block of savedWorldState.blocks ?? []) {
    setBlockState(block, block.stateId);
  }

  if ((savedWorldState.blocks ?? []).length > 0) {
    rebakeLightingForPositions(savedWorldState.blocks);
  }

  return {
    airBlockStateId,
    breakBlock,
    get chunks() {
      return createChunkPackets();
    },
    createChunkPackets,
    fillBlockStateId,
    foundationBlockStateId: worldOptions.foundationBlockStateId,
    floorStartY,
    getBiomeId(position) {
      const chunkEntry = getChunkEntry(position);
      return chunkEntry ? chunkEntry.chunkEntry.chunk.getBiome(chunkEntry.localPosition) : worldOptions.biomeId;
    },
    getBlockState,
    getChunkLightUpdate,
    getChunkPacket,
    getChunkPackets,
    getSafeSpawnPosition,
    isWithinBuildBounds,
    isWithinPlatformBounds,
    maxX,
    maxZ,
    maxBuildY,
    minBuildY,
    minX,
    minZ,
    minWorldY: worldOptions.minWorldY,
    placementBlockStateId,
    placeBlock,
    placeBlockDetailed,
    resolvePlacedBlockLocation,
    getModifiedBlocks,
    serialize,
    setBlockState,
    surfaceY,
    surfacePaletteStateIds: [
      worldOptions.surfaceBlockStateId,
      worldOptions.terrainBlockStateIds.gravel,
      worldOptions.terrainBlockStateIds.podzol,
      worldOptions.terrainBlockStateIds.sand
    ],
    spawnChunk,
    spawnReference,
    seed: worldOptions.seed,
    streamRadius: worldOptions.streamRadius,
    terrainThickness: worldOptions.terrainThickness,
    undergroundVariantStateIds: [
      worldOptions.terrainBlockStateIds.andesite,
      worldOptions.terrainBlockStateIds.diorite,
      worldOptions.terrainBlockStateIds.granite
    ],
    oreBlockStateIds: [
      worldOptions.terrainBlockStateIds.coalOre,
      worldOptions.terrainBlockStateIds.copperOre,
      worldOptions.terrainBlockStateIds.ironOre
    ],
    bedrockBlockStateId: worldOptions.terrainBlockStateIds.bedrock,
    waterBlockStateId: worldOptions.terrainBlockStateIds.water,
    decorationStateIds: Object.values(worldOptions.decorationBlockStateIds).filter(Boolean),
    biomeMetadata: {
      beach: biomes.beach.metadata,
      birch_forest: biomes.birchForest.metadata,
      flower_forest: biomes.flowerForest.metadata,
      forest: biomes.forest.metadata,
      lake: biomes.lake.metadata,
      old_growth_birch_forest: biomes.oldGrowthBirchForest.metadata,
      ocean: biomes.ocean.metadata,
      plains: biomes.plains.metadata,
      river: biomes.river.metadata,
      stony_shore: biomes.stonyShore.metadata,
      sunflower_plains: biomes.sunflowerPlains.metadata,
      taiga: biomes.taiga.metadata
    },
    topBlockStateId,
    treeBlockStateIds: worldOptions.treeBlockStateIds
    ,
    populationFeaturePasses: ['ponds', 'trees', 'decorations'],
    hasChunk(chunkX, chunkZ) {
      const chunkEntry = chunks.get(getChunkKey(chunkX, chunkZ));
      return Boolean(chunkEntry?.chunk || chunkEntry?.chunkJson);
    },
    preGenerateChunk(chunkX, chunkZ) {
      return preGenerateChunkAsync(chunkX, chunkZ);
    },
    getChunkNeighborhood(chunkX, chunkZ, radius = 1) {
      return collectChunkNeighborhood(chunkX, chunkZ, radius);
    }
  };
}

module.exports = {
  createInitialWorldPackets
};
