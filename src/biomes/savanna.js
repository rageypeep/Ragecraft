const biomeUtils = require('./utils');

const SAVANNA_METADATA = {
  key: 'savanna',
  label: 'Savanna',
  temperature: 1.2,
  downfall: 0.0,
  hasPrecipitation: false,
  snow: 'none',
  grassColor: '#BFB755',
  foliageColor: '#AEA42A',
  waterColor: '#3F76E4'
};

function createProfile(worldOptions) {
  return {
    biomeKey: SAVANNA_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.savanna,
    metadata: SAVANNA_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.gravel,
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
    valueNoise2d,
    getColumnDescriptor,
    getSurfaceVariation,
    isNearSpawn,
    buildTreeFeature
  } = context;
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 931);
  const densityNoise = valueNoise2d(cellX, cellZ, worldOptions.seedHash + 949, 0.18);
  const localX = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 937) * 3);
  const localZ = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 943) * 3);
  const worldX = (cellX * 5) + localX;
  const worldZ = (cellZ * 5) + localZ;

  if (isNearSpawn(spawn, worldX, worldZ)) {
    return null;
  }

  const { topY } = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
  const surfaceVariation = getSurfaceVariation(worldOptions, surfaceY, spawn, worldX, worldZ, 1);
  const treeChance = 0.028 + (densityNoise * 0.04);

  if (candidateNoise > treeChance || surfaceVariation > 4) {
    return null;
  }

  return buildTreeFeature(densityNoise > 0.54 ? 'oak_bushy' : 'oak_small', worldX, worldZ, topY);
}

function getDecorationFeature(context) {
  const { worldOptions, topStateId, hashNoise2d, worldX, worldZ } = context;

  if (!biomeUtils.isBiomeSurfaceState(worldOptions, topStateId)) {
    return null;
  }

  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 9301);
  const variantNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 9329);

  if (densityNoise > 0.92) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.tallGrassLower,
      upperStateId: worldOptions.decorationBlockStateIds.tallGrassUpper
    };
  }

  if (densityNoise > 0.82) {
    return {
      lowerStateId: variantNoise > 0.44
        ? worldOptions.decorationBlockStateIds.shortGrass
        : worldOptions.decorationBlockStateIds.deadBush
    };
  }

  if (densityNoise > 0.62) {
    return { lowerStateId: worldOptions.decorationBlockStateIds.shortGrass };
  }

  return null;
}

module.exports = {
  metadata: SAVANNA_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
