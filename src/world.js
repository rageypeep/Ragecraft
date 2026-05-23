const fs = require('node:fs');
const path = require('node:path');
const biomes = require('./biomes');
const {
  createChunkLightTemplate,
  createChunkPacket,
  createChunkTemplate,
  createTranslatedChunk
} = require('./world/chunks');
const { createChestStateHelpers } = require('./world/chests');
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

function loadCompatibilityRegistriesReport(version) {
  if (!version) {
    return null;
  }

  const candidatePaths = [
    path.join(__dirname, '..', 'porting', version, 'generated-reports', 'reports', 'registries.json'),
    path.join(__dirname, '..', 'porting', version, 'generated-reports-2', 'reports', 'registries.json')
  ];

  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      return JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
    }
  }

  return null;
}

function resolveBlockEntityTypeIds(version) {
  const registriesReport = loadCompatibilityRegistriesReport(version);
  const blockEntityEntries = registriesReport?.['minecraft:block_entity_type']?.entries ?? {};
  const chestTypeId = blockEntityEntries['minecraft:chest']?.protocol_id;
  const furnaceTypeId = blockEntityEntries['minecraft:furnace']?.protocol_id;
  const blastFurnaceTypeId = blockEntityEntries['minecraft:blast_furnace']?.protocol_id;
  const smokerTypeId = blockEntityEntries['minecraft:smoker']?.protocol_id;

  return {
    chest: Number.isInteger(chestTypeId) ? chestTypeId : 1,
    furnace: Number.isInteger(furnaceTypeId) ? furnaceTypeId : null,
    blast_furnace: Number.isInteger(blastFurnaceTypeId) ? blastFurnaceTypeId : null,
    smoker: Number.isInteger(smokerTypeId) ? smokerTypeId : null
  };
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
  const chestItemId = mcData.itemsByName.chest?.id ?? null;
  const blockEntityTypeIds = resolveBlockEntityTypeIds(config.version);
  const thinSnowMinStateId = mcData.blocksByName.snow?.minStateId ?? null;
  const thinSnowMaxStateId = mcData.blocksByName.snow?.maxStateId ?? null;
  const chestStateHelpers = createChestStateHelpers(mcData);
  const processingBlockDefinitions = [
    {
      containerType: 'minecraft:furnace',
      itemId: mcData.itemsByName.furnace?.id ?? null,
      maxStateId: mcData.blocksByName.furnace?.maxStateId ?? null,
      minStateId: mcData.blocksByName.furnace?.minStateId ?? null
    },
    {
      containerType: 'minecraft:blast_furnace',
      itemId: mcData.itemsByName.blast_furnace?.id ?? null,
      maxStateId: mcData.blocksByName.blast_furnace?.maxStateId ?? null,
      minStateId: mcData.blocksByName.blast_furnace?.minStateId ?? null
    },
    {
      containerType: 'minecraft:smoker',
      itemId: mcData.itemsByName.smoker?.id ?? null,
      maxStateId: mcData.blocksByName.smoker?.maxStateId ?? null,
      minStateId: mcData.blocksByName.smoker?.minStateId ?? null
    }
  ].filter((entry) => Number.isInteger(entry.minStateId) && Number.isInteger(entry.maxStateId));
  const processingContainerTypes = new Set(processingBlockDefinitions.map((entry) => entry.containerType));

  function shouldPerformImmediateLightUpdate(previousStateId, nextStateId) {
    const previousBlock = mcData.blocksByStateId[previousStateId];
    const nextBlock = mcData.blocksByStateId[nextStateId];

    return (
      (previousBlock?.emitLight ?? 0) > 0 ||
      (nextBlock?.emitLight ?? 0) > 0
    );
  }

  function isReplaceablePlacementStateId(stateId) {
    return Number.isInteger(stateId) &&
      thinSnowMinStateId !== null &&
      thinSnowMaxStateId !== null &&
      stateId >= thinSnowMinStateId &&
      stateId <= thinSnowMaxStateId;
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
    blockEntityTypeIds,
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
    savedContainers: savedWorldState.containers ?? [],
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

  const {
    getDoubleChestSides,
    isChestStateId,
    offsetPosition,
    parseChestState,
    positionsEqual,
    resolveChestStateId
  } = chestStateHelpers;

  function cloneItemStack(item) {
    return item
      ? {
          itemId: item.itemId,
          count: item.count
        }
      : null;
  }

  function createEmptyChestItems(size = 27) {
    return new Array(size).fill(null);
  }

  function createEmptyProcessingItems() {
    return new Array(3).fill(null);
  }

  function createDefaultProcessingData() {
    return {
      burnTime: 0,
      cookTime: 0,
      cookTimeTotal: 0,
      fuelTime: 0
    };
  }

  function splitChestItems(items = [], start, end) {
    return Array.from({ length: end - start }, (_, index) => cloneItemStack(items[start + index] ?? null));
  }

  function getChestRecord(position) {
    const record = stateHelpers.getContainerAt(position);
    return record?.type === 'chest' ? record : null;
  }

  function getProcessingBlockDefinitionByStateId(stateId) {
    if (!Number.isInteger(stateId)) {
      return null;
    }

    return processingBlockDefinitions.find((entry) =>
      stateId >= entry.minStateId && stateId <= entry.maxStateId) ?? null;
  }

  function getProcessingRecord(position) {
    const record = stateHelpers.getContainerAt(position);
    return processingContainerTypes.has(record?.type) ? record : null;
  }

  function ensureProcessingRecord(position, containerType) {
    const existingRecord = getProcessingRecord(position);

    if (existingRecord) {
      if (existingRecord.items.length !== 3) {
        stateHelpers.setContainerItems(existingRecord, createEmptyProcessingItems());
      }

      stateHelpers.setContainerPositions(existingRecord, [position]);
      stateHelpers.setContainerData(existingRecord, {
        ...createDefaultProcessingData(),
        ...(existingRecord.data ?? {})
      });
      return existingRecord;
    }

    return stateHelpers.createContainer(
      containerType,
      [position],
      createEmptyProcessingItems(),
      createDefaultProcessingData()
    );
  }

  function ensureSingleChestRecord(position) {
    const existingRecord = getChestRecord(position);

    if (existingRecord) {
      if (existingRecord.items.length !== 27) {
        stateHelpers.setContainerItems(existingRecord, splitChestItems(existingRecord.items, 0, 27));
      }

      stateHelpers.setContainerPositions(existingRecord, [position]);
      return existingRecord;
    }

    return stateHelpers.createContainer('chest', [position], createEmptyChestItems(27));
  }

  function getAdjacentChestPositions(position) {
    return ['north', 'south', 'west', 'east']
      .map((direction) => offsetPosition(position, direction))
      .filter(Boolean)
      .filter((neighborPosition) => isChestStateId(stateHelpers.getBlockState(neighborPosition)));
  }

  function getHalfItems(record, side) {
    if (!record) {
      return createEmptyChestItems(27);
    }

    if (record.items.length <= 27) {
      return splitChestItems(record.items, 0, 27);
    }

    return side === 'left'
      ? splitChestItems(record.items, 0, 27)
      : splitChestItems(record.items, 27, 54);
  }

  function mergeChestRecords(facing, leftPosition, rightPosition) {
    const leftRecord = ensureSingleChestRecord(leftPosition);
    const rightRecord = ensureSingleChestRecord(rightPosition);
    const mergedItems = [
      ...getHalfItems(leftRecord, 'left'),
      ...getHalfItems(rightRecord, 'right')
    ];

    if (rightRecord !== leftRecord) {
      stateHelpers.deleteContainer(rightRecord);
    }

    stateHelpers.setContainerItems(leftRecord, mergedItems);
    stateHelpers.setContainerPositions(leftRecord, [leftPosition, rightPosition]);

    stateHelpers.setBlockState(leftPosition, resolveChestStateId({ facing, type: 'left', waterlogged: false }));
    stateHelpers.setBlockState(rightPosition, resolveChestStateId({ facing, type: 'right', waterlogged: false }));
    return leftRecord;
  }

  function splitDoubleChestRecord(record, removedPosition, remainingPosition, facing, removedType) {
    const removedItems = removedType === 'left'
      ? getHalfItems(record, 'left')
      : getHalfItems(record, 'right');
    const remainingItems = removedType === 'left'
      ? getHalfItems(record, 'right')
      : getHalfItems(record, 'left');

    stateHelpers.setContainerItems(record, remainingItems);
    stateHelpers.setContainerPositions(record, [remainingPosition]);
    stateHelpers.setBlockState(remainingPosition, resolveChestStateId({ facing, type: 'single', waterlogged: false }));

    return removedItems.filter(Boolean);
  }

  function resolveChestFacingFromYaw(yaw = 0) {
    const normalizedYaw = ((yaw % 360) + 360) % 360;

    if (normalizedYaw >= 45 && normalizedYaw < 135) {
      return 'east';
    }

    if (normalizedYaw >= 135 && normalizedYaw < 225) {
      return 'north';
    }

    if (normalizedYaw >= 225 && normalizedYaw < 315) {
      return 'west';
    }

    return 'south';
  }

  function resolvePlacedChestFacing(playerYaw = 0) {
    const playerFacing = resolveChestFacingFromYaw(playerYaw);

    switch (playerFacing) {
      case 'north':
        return 'south';
      case 'south':
        return 'north';
      case 'west':
        return 'east';
      case 'east':
      default:
        return 'west';
    }
  }

  function getChestInteraction(position) {
    const state = parseChestState(stateHelpers.getBlockState(position));

    if (!state) {
      return null;
    }

    const record = getChestRecord(position) ?? ensureSingleChestRecord(position);

    return {
      positions: record.positions.map((entry) => ({ ...entry })),
      record,
      size: record.items.length,
      state
    };
  }

  function getProcessingInteraction(position) {
    const normalizedPosition = normalizePosition(position);
    const blockDefinition = getProcessingBlockDefinitionByStateId(stateHelpers.getBlockState(normalizedPosition));

    if (!blockDefinition) {
      return null;
    }

    return {
      blockPosition: normalizedPosition,
      record: ensureProcessingRecord(normalizedPosition, blockDefinition.containerType),
      type: blockDefinition.containerType
    };
  }

  function placeChestDetailed(position, playerYaw = 0) {
    const normalizedPosition = normalizePosition(position);

    if (!isWithinBuildBounds(normalizedPosition)) {
      return false;
    }

    const currentStateId = stateHelpers.getBlockState(normalizedPosition);

    if (currentStateId !== airBlockStateId && !isWaterStateId(currentStateId) && !isReplaceablePlacementStateId(currentStateId)) {
      return false;
    }

    const adjacentChestPositions = getAdjacentChestPositions(normalizedPosition);
    const eligibleNeighbors = adjacentChestPositions.filter((neighborPosition) => {
      const neighborState = parseChestState(stateHelpers.getBlockState(neighborPosition));
      return neighborState?.type === 'single';
    });
    const joinNeighbor = eligibleNeighbors.length === 1 ? eligibleNeighbors[0] : null;
    const chestFacing = joinNeighbor
      ? parseChestState(stateHelpers.getBlockState(joinNeighbor))?.facing ?? resolvePlacedChestFacing(playerYaw)
      : resolvePlacedChestFacing(playerYaw);
    const singleChestStateId = resolveChestStateId({
      facing: chestFacing,
      type: 'single',
      waterlogged: false
    });

    if (!stateHelpers.setBlockState(normalizedPosition, singleChestStateId)) {
      return false;
    }

    ensureSingleChestRecord(normalizedPosition);
    const changedPositions = [normalizedPosition];

    if (joinNeighbor) {
      const doubleChestSides = getDoubleChestSides(chestFacing, normalizedPosition, joinNeighbor);

      if (doubleChestSides) {
        mergeChestRecords(
          chestFacing,
          doubleChestSides.leftPosition,
          doubleChestSides.rightPosition
        );
        changedPositions.push(joinNeighbor);
      }
    }

    const lightChunkCoordinates = shouldPerformImmediateLightUpdate(currentStateId, singleChestStateId)
      ? stateHelpers.rebakeLightingForPositions(changedPositions)
      : [];

    return {
      changedPositions,
      lightChunkCoordinates,
      position: normalizedPosition,
      stateId: stateHelpers.getBlockState(normalizedPosition)
    };
  }

  function breakChestDetailed(position, stateId) {
    const normalizedPosition = normalizePosition(position);
    const chestState = parseChestState(stateId);
    const record = getChestRecord(normalizedPosition) ?? ensureSingleChestRecord(normalizedPosition);
    const originalPositions = record.positions.map((entry) => ({ ...entry }));
    const droppedItems = [];

    if (record.items.length > 27 && chestState?.type !== 'single' && originalPositions.length === 2) {
      const remainingPosition = originalPositions.find((entry) => !positionsEqual(entry, normalizedPosition));

      if (remainingPosition) {
        droppedItems.push(...splitDoubleChestRecord(
          record,
          normalizedPosition,
          remainingPosition,
          chestState.facing,
          chestState.type
        ));
      }
    } else {
      droppedItems.push(...record.items.filter(Boolean).map(cloneItemStack));
      stateHelpers.deleteContainer(record);
    }

    stateHelpers.setBlockState(normalizedPosition, airBlockStateId);

    if (Number.isInteger(chestItemId)) {
      droppedItems.push({
        itemId: chestItemId,
        count: 1
      });
    }

    const changedPositions = [normalizedPosition, ...originalPositions.filter((entry) => !positionsEqual(entry, normalizedPosition))];
    const lightChunkCoordinates = shouldPerformImmediateLightUpdate(stateId, airBlockStateId)
      ? stateHelpers.rebakeLightingForPositions(changedPositions)
      : [];

    return {
      changedPositions,
      droppedItems,
      lightChunkCoordinates,
      position: normalizedPosition,
      stateId
    };
  }

  function breakProcessingDetailed(position, stateId, blockDefinition) {
    const normalizedPosition = normalizePosition(position);
    const record = getProcessingRecord(normalizedPosition) ??
      ensureProcessingRecord(normalizedPosition, blockDefinition.containerType);
    const droppedItems = record.items.filter(Boolean).map(cloneItemStack);

    stateHelpers.deleteContainer(record);
    stateHelpers.setBlockState(normalizedPosition, airBlockStateId);

    if (Number.isInteger(blockDefinition.itemId)) {
      droppedItems.push({
        itemId: blockDefinition.itemId,
        count: 1
      });
    }

    const lightChunkCoordinates = shouldPerformImmediateLightUpdate(stateId, airBlockStateId)
      ? stateHelpers.rebakeLightingForPositions([normalizedPosition])
      : [];

    return {
      changedPositions: [normalizedPosition],
      droppedItems,
      lightChunkCoordinates,
      position: normalizedPosition,
      stateId
    };
  }

  function breakBlock(position) {
    if (!isWithinBuildBounds(position)) {
      return null;
    }

    const currentStateId = stateHelpers.getBlockState(position);

    if (currentStateId === airBlockStateId) {
      return null;
    }

    if (isChestStateId(currentStateId)) {
      return breakChestDetailed(position, currentStateId);
    }

    const processingBlockDefinition = getProcessingBlockDefinitionByStateId(currentStateId);

    if (processingBlockDefinition) {
      return breakProcessingDetailed(position, currentStateId, processingBlockDefinition);
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

    if (
      currentStateId !== airBlockStateId &&
      !isWaterStateId(currentStateId) &&
      !isReplaceablePlacementStateId(currentStateId)
    ) {
      return false;
    }

    if (!stateHelpers.setBlockState(normalizedPosition, stateId)) {
      return false;
    }

    const processingBlockDefinition = getProcessingBlockDefinitionByStateId(stateId);

    if (processingBlockDefinition) {
      ensureProcessingRecord(normalizedPosition, processingBlockDefinition.containerType);
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

    if (isReplaceablePlacementStateId(stateHelpers.getBlockState(normalizedPosition))) {
      return normalizedPosition;
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
    getChestInteraction,
    getChunkLightUpdate: stateHelpers.getChunkLightUpdate,
    getChunkPacket: stateHelpers.getChunkPacket,
    getChunkPackets: stateHelpers.getChunkPackets,
    getContainers: stateHelpers.getContainers,
    getContainersInChunk: stateHelpers.getContainersInChunk,
    getContainerAt: stateHelpers.getContainerAt,
    blockEntityTypeIds,
    getProcessingInteraction,
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
    placeChestDetailed,
    placeBlockDetailed,
    resolvePlacedBlockLocation,
    getModifiedBlocks: stateHelpers.getModifiedBlocks,
    setContainerData: stateHelpers.setContainerData,
    serialize: stateHelpers.serialize,
    setBlockState: stateHelpers.setBlockState,
    setContainerItems: stateHelpers.setContainerItems,
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
