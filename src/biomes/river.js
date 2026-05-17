const RIVER_METADATA = {
  key: 'river',
  label: 'River',
  temperature: 0.5,
  downfall: 0.5,
  hasPrecipitation: true,
  snow: 'none',
  grassColor: '#8EB971',
  foliageColor: '#71A74D',
  waterColor: '#3F76E4'
};

function createProfile(worldOptions) {
  return {
    biomeKey: RIVER_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.river,
    metadata: RIVER_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.mud,
    surfaceBlockStateId: worldOptions.surfaceBlockStateId,
    soilBlockStateId: worldOptions.soilBlockStateId,
    foundationBlockStateId: worldOptions.foundationBlockStateId,
    terrainAmplitudeOffset: 0
  };
}

function getTreeCandidate(context) {
  const {
    worldOptions,
    surfaceY,
    spawn,
    cellX,
    cellZ,
    hashNoise2d,
    getColumnDescriptor,
    getSurfaceVariation,
    isNearSpawn,
    buildTreeFeature
  } = context;
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 611);
  const selectorNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 653);
  const localX = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 617) * 3);
  const localZ = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 623) * 3);
  const worldX = (cellX * 5) + localX;
  const worldZ = (cellZ * 5) + localZ;

  if (isNearSpawn(spawn, worldX, worldZ)) {
    return null;
  }

  const column = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
  const surfaceVariation = getSurfaceVariation(worldOptions, surfaceY, spawn, worldX, worldZ, 2);

  if (
    column.biomeProfile.biomeKey !== RIVER_METADATA.key ||
    column.waterTopY !== null ||
    column.topBlockStateId !== worldOptions.surfaceBlockStateId ||
    candidateNoise > 0.04 ||
    surfaceVariation > 2
  ) {
    return null;
  }

  const treeType = selectorNoise > 0.7 ? 'oak_bushy' : 'oak_small';
  return buildTreeFeature(treeType, worldX, worldZ, column.topY);
}

function getDecorationFeature(context) {
  const {
    worldOptions,
    topStateId,
    topY,
    column,
    hashNoise2d,
    worldX,
    worldZ,
    surfaceY,
    spawn,
    getColumnDescriptor
  } = context;
  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 6301);
  const variantNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 6327);

  if (column?.waterTopY !== null) {
    if (
      topY <= column.waterTopY - 1 &&
      densityNoise > 0.28 &&
      [
        worldOptions.terrainBlockStateIds.sand,
        worldOptions.terrainBlockStateIds.gravel,
        worldOptions.terrainBlockStateIds.clay,
        worldOptions.terrainBlockStateIds.mud,
        worldOptions.soilBlockStateId
      ].includes(topStateId)
    ) {
      return {
        lowerStateId: worldOptions.decorationBlockStateIds.seagrass,
        allowSubmerged: true
      };
    }

    return null;
  }

  if (![worldOptions.surfaceBlockStateId, worldOptions.terrainBlockStateIds.mud].includes(topStateId)) {
    return null;
  }

  const adjacentToWater = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ].some(([dx, dz]) => {
    const neighbourColumn = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX + dx, worldZ + dz);
    return neighbourColumn.waterTopY !== null;
  });

  if (adjacentToWater && densityNoise > 0.987) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.sugarCane
    };
  }

  if (densityNoise > 0.72) {
    return {
      lowerStateId: variantNoise > 0.55
        ? worldOptions.decorationBlockStateIds.shortGrass
        : worldOptions.decorationBlockStateIds.fern
    };
  }

  return null;
}

module.exports = {
  metadata: RIVER_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
