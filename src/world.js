const biomes = require('./biomes');
const {
  createChunkLightTemplate,
  createChunkPacket,
  createChunkTemplate,
  createTranslatedChunk
} = require('./world/chunks');
const { createChunkFromJson } = require('./world/chunk-factory');
const { createFluidHelpers } = require('./world/fluids');
const { collectLightingChunkCoordinates } = require('./world/light-runtime');
const { bakeChunkLightingRegion } = require('./world/lighting');
const runtimeUtils = require('./world/runtime-utils');
const { createSpawnHelpers } = require('./world/spawn');
const { createWorldStateHelpers } = require('./world/state');
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

const {
  normalizePosition,
  getBlockKey,
  getChunkKey,
  toChunkCoordinates
} = runtimeUtils;
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

  function shouldPerformImmediateLightUpdate(previousStateId, nextStateId) {
    const previousBlock = mcData.blocksByStateId[previousStateId];
    const nextBlock = mcData.blocksByStateId[nextStateId];

    return (
      (previousBlock?.emitLight ?? 0) > 0 ||
      (nextBlock?.emitLight ?? 0) > 0
    );
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

  const stateHelpers = createWorldStateHelpers({
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
    savedBlocks: savedWorldState.blocks ?? [],
    spawnReference,
    surfaceY,
    toChunkCoordinates,
    worldOptions
  });

  const { getSafeSpawnPosition } = createSpawnHelpers({
    getBlockState: stateHelpers.getBlockState,
    getBlockDefinition: (stateId) => mcData.blocksByStateId[stateId],
    maxBuildY,
    maxX,
    maxZ,
    minBuildY,
    minX,
    minZ,
    spawnReference
  });
  const safeSpawn = getSafeSpawnPosition();

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
    getBlockState: stateHelpers.getBlockState,
    getBaseBlockState: stateHelpers.getBaseBlockState,
    setBlockState: stateHelpers.setBlockState,
    isWithinBuildBounds,
    getBlockDefinition: (stateId) => mcData.blocksByStateId[stateId]
  });

  function breakBlock(position) {
    if (!isWithinBuildBounds(position)) {
      return null;
    }

    const currentStateId = stateHelpers.getBlockState(position);

    if (currentStateId === airBlockStateId) {
      return null;
    }

    const blockDefinition = mcData.blocksByStateId[currentStateId];
    const droppedItemId = blockDefinition?.drops?.[0];
    const normalizedPosition = normalizePosition(position);

    if (!stateHelpers.setBlockState(normalizedPosition, airBlockStateId)) {
      return null;
    }

    const changedPositions = [normalizedPosition, ...recomputeWaterAround(normalizedPosition)];
    const lightChunkCoordinates = shouldPerformImmediateLightUpdate(currentStateId, airBlockStateId)
      ? stateHelpers.rebakeLightingForPositions([normalizedPosition])
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

    const currentStateId = stateHelpers.getBlockState(normalizedPosition);

    if (currentStateId !== airBlockStateId && !isWaterStateId(currentStateId)) {
      return false;
    }

    if (!stateHelpers.setBlockState(normalizedPosition, stateId)) {
      return false;
    }

    const changedPositions = [normalizedPosition, ...recomputeWaterAround(normalizedPosition)];
    const lightChunkCoordinates = shouldPerformImmediateLightUpdate(currentStateId, stateId)
      ? stateHelpers.rebakeLightingForPositions([normalizedPosition])
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
    return stateHelpers.getChunkPackets(spawnChunk.x, spawnChunk.z, worldOptions.chunkRadius);
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
      return stateHelpers.getBiomeId(position, worldOptions.biomeId);
    },
    getBlockState: stateHelpers.getBlockState,
    getChunkLightUpdate: stateHelpers.getChunkLightUpdate,
    getChunkPacket: stateHelpers.getChunkPacket,
    getChunkPackets: stateHelpers.getChunkPackets,
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
    getModifiedBlocks: stateHelpers.getModifiedBlocks,
    serialize: stateHelpers.serialize,
    setBlockState: stateHelpers.setBlockState,
    surfaceY,
    surfacePaletteStateIds: [
      worldOptions.surfaceBlockStateId,
      worldOptions.terrainBlockStateIds.gravel,
      worldOptions.terrainBlockStateIds.podzol,
      worldOptions.terrainBlockStateIds.sand
    ],
    spawnChunk,
    spawnReference,
    safeSpawn,
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
    treeBlockStateIds: worldOptions.treeBlockStateIds,
    populationFeaturePasses: ['ponds', 'trees', 'decorations'],
    hasChunk: stateHelpers.hasChunk,
    preGenerateChunk: stateHelpers.preGenerateChunk,
    getChunkNeighborhood: stateHelpers.collectChunkNeighborhood
  };
}

module.exports = {
  createInitialWorldPackets
};
