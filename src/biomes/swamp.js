const biomeUtils = require('./utils');

const SWAMP_METADATA = {
  key: 'swamp',
  label: 'Swamp',
  temperature: 0.8,
  downfall: 0.9,
  hasPrecipitation: true,
  snow: 'none',
  grassColor: '#6A7039',
  foliageColor: '#6A7039',
  waterColor: '#617B64'
};

function createProfile(worldOptions) {
  return {
    biomeKey: SWAMP_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.swamp,
    metadata: SWAMP_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.mud,
    surfaceBlockStateId: worldOptions.surfaceBlockStateId,
    soilBlockStateId: worldOptions.terrainBlockStateIds.mud,
    foundationBlockStateId: worldOptions.foundationBlockStateId,
    terrainAmplitudeOffset: -3
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
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 711);
  const selectorNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 753);
  const localX = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 717) * 3);
  const localZ = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 723) * 3);
  const worldX = (cellX * 5) + localX;
  const worldZ = (cellZ * 5) + localZ;

  if (isNearSpawn(spawn, worldX, worldZ)) {
    return null;
  }

  const { topY } = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
  const surfaceVariation = getSurfaceVariation(worldOptions, surfaceY, spawn, worldX, worldZ, 1);
  const treeChance = 0.22 + (hashNoise2d(cellX, cellZ, worldOptions.seedHash + 737) * 0.14);

  if (candidateNoise > treeChance || surfaceVariation > 5) {
    return null;
  }

  const treeType = selectorNoise > 0.6 ? 'oak_bushy' : 'oak_small';
  return buildTreeFeature(treeType, worldX, worldZ, topY);
}

function getDecorationFeature(context) {
  const { worldOptions, worldX, worldZ, topStateId, hashNoise2d, valueNoise2d } = context;
  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 8201);
  const variantNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 8227);
  const patchNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 8261, 0.02);
  const isMud = topStateId === worldOptions.terrainBlockStateIds.mud;
  const isGrass = biomeUtils.isBiomeSurfaceState(worldOptions, topStateId);

  if (!isMud && !isGrass) {
    return null;
  }

  if (densityNoise > 0.96) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.brownMushroom
    };
  }

  if (densityNoise > 0.92) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.redMushroom
    };
  }

  if (isMud && patchNoise > 0.62 && densityNoise > 0.72) {
    return {
      lowerStateId: variantNoise > 0.54
        ? worldOptions.decorationBlockStateIds.fern
        : worldOptions.decorationBlockStateIds.shortGrass
    };
  }

  if (isGrass && densityNoise > 0.82) {
    return {
      lowerStateId: variantNoise > 0.5
        ? worldOptions.decorationBlockStateIds.shortGrass
        : worldOptions.decorationBlockStateIds.fern
    };
  }

  if (isGrass && densityNoise > 0.68) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.shortGrass
    };
  }

  return null;
}

module.exports = {
  metadata: SWAMP_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
