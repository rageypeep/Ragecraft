const Vec3 = require('vec3');
const biomes = require('./biomes');
const chunkHelpers = require('./world/chunks');
const { createFluidHelpers } = require('./world/fluids');
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
  getSpawnChunk,
  getSurfaceY,
  resolveWorldOptions
} = generation;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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
  const spawnChunk = getSpawnChunk(config.spawn);
  const surfaceY = getSurfaceY(config.spawn.y);
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
  const lightTemplate = chunkHelpers.createChunkLightTemplate(
    createGeneratedChunk(worldOptions, surfaceY, config.spawn, spawnChunk.x, spawnChunk.z)
  );
  const chunks = new Map();
  const generatedChunks = new Map();
  const modifiedBlocks = new Map();

  function ensureChunk(chunkX, chunkZ) {
    const chunkKey = getChunkKey(chunkX, chunkZ);

    if (!chunks.has(chunkKey)) {
      const chunk = createGeneratedChunk(worldOptions, surfaceY, config.spawn, chunkX, chunkZ);
      chunks.set(chunkKey, {
        chunkX,
        chunkZ,
        chunk,
        packetTemplate: null,
        translatedPacketTemplates: new Map()
      });
    }

    return chunks.get(chunkKey);
  }

  function ensureGeneratedChunk(chunkX, chunkZ) {
    const chunkKey = getChunkKey(chunkX, chunkZ);

    if (!generatedChunks.has(chunkKey)) {
      generatedChunks.set(
        chunkKey,
        createGeneratedChunk(worldOptions, surfaceY, config.spawn, chunkX, chunkZ)
      );
    }

    return generatedChunks.get(chunkKey);
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

  function getCachedChunkTemplate(chunkEntry, translateStateId = null) {
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

  function isAirBlock(position) {
    return getBlockState(position) === airBlockStateId;
  }

  function findSafeStandingY(x, z) {
    for (let blockY = maxBuildY - 2; blockY >= minBuildY; blockY--) {
      const feetPosition = { x, y: blockY + 1, z };
      const headPosition = { x, y: blockY + 2, z };

      if (
        !isAirBlock({ x, y: blockY, z }) &&
        isAirBlock(feetPosition) &&
        isAirBlock(headPosition)
      ) {
        return feetPosition.y;
      }
    }

    return null;
  }

  function getSafeSpawnPosition(preferredSpawn = config.spawn) {
    const preferredX = clamp(Math.floor(preferredSpawn?.x ?? config.spawn.x), minX, maxX);
    const preferredZ = clamp(Math.floor(preferredSpawn?.z ?? config.spawn.z), minZ, maxZ);
    let bestCandidate = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const standingY = findSafeStandingY(x, z);

        if (standingY === null) {
          continue;
        }

        const score = Math.abs(x - preferredX) + Math.abs(z - preferredZ);

        if (score < bestScore) {
          bestScore = score;
          bestCandidate = { x, y: standingY, z };
        }
      }
    }

    if (bestCandidate) {
      return bestCandidate;
    }

    return {
      x: preferredX,
      y: surfaceY + 1,
      z: preferredZ
    };
  }

  function setBlockState(position, stateId) {
    if (!isWithinBuildBounds(position)) {
      return false;
    }

    const chunkEntry = getChunkEntry(position);

    if (!chunkEntry) {
      return false;
    }

    chunkEntry.chunkEntry.chunk.setBlockStateId(chunkEntry.localPosition, stateId);
    invalidateChunkPacketTemplates(chunkEntry.chunkEntry);

    const worldPosition = normalizePosition(chunkEntry.worldPosition);
    const baseStateId = getBaseBlockState(worldPosition);
    const blockKey = getBlockKey(worldPosition);

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

    return {
      changedPositions,
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

    return {
      changedPositions: [normalizedPosition, ...recomputeWaterAround(normalizedPosition)],
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
    const chunkEntry = ensureChunk(chunkX, chunkZ);
    const template = getCachedChunkTemplate(chunkEntry, translateStateId);

    return createChunkPacket(chunkX, chunkZ, {
      ...template,
      ...lightTemplate
    });
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

  return {
    airBlockStateId,
    breakBlock,
    chunks: createChunkPackets(),
    createChunkPackets,
    fillBlockStateId,
    foundationBlockStateId: worldOptions.foundationBlockStateId,
    floorStartY,
    getBiomeId(position) {
      const chunkEntry = getChunkEntry(position);
      return chunkEntry ? chunkEntry.chunkEntry.chunk.getBiome(chunkEntry.localPosition) : worldOptions.biomeId;
    },
    getBlockState,
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
      return chunks.has(getChunkKey(chunkX, chunkZ));
    },
    preGenerateChunk(chunkX, chunkZ) {
      ensureChunk(chunkX, chunkZ);
    }
  };
}

module.exports = {
  createInitialWorldPackets
};
