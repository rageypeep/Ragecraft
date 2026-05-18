const biomeUtils = require('./utils');

const DARK_FOREST_METADATA = {
  key: 'dark_forest',
  label: 'Dark Forest',
  temperature: 0.7,
  downfall: 0.8,
  hasPrecipitation: true,
  snow: 'none',
  grassColor: '#507A32',
  foliageColor: '#59AE30',
  waterColor: '#3F76E4'
};

function createProfile(worldOptions) {
  return {
    biomeKey: DARK_FOREST_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.darkForest,
    metadata: DARK_FOREST_METADATA,
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
    getColumnDescriptor,
    getSurfaceVariation,
    isNearSpawn,
    buildTreeFeature
  } = context;
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 951);
  const selectorNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 957);
  const localX = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 963) * 3);
  const localZ = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 967) * 3);
  const worldX = (cellX * 5) + localX;
  const worldZ = (cellZ * 5) + localZ;

  if (isNearSpawn(spawn, worldX, worldZ)) {
    return null;
  }

  const { topY } = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
  const surfaceVariation = getSurfaceVariation(worldOptions, surfaceY, spawn, worldX, worldZ, 1);

  if (candidateNoise > 0.48 || surfaceVariation > 6) {
    return null;
  }

  if (selectorNoise > 0.82) {
    return buildTreeFeature('oak_tall', worldX, worldZ, topY);
  }

  return buildTreeFeature(selectorNoise > 0.28 ? 'oak_bushy' : 'oak_small', worldX, worldZ, topY);
}

function getDecorationFeature(context) {
  const { worldOptions, topStateId, hashNoise2d, valueNoise2d, worldX, worldZ } = context;

  if (!biomeUtils.isBiomeSurfaceState(worldOptions, topStateId)) {
    return null;
  }

  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 9501);
  const variantNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 9527);
  const patchNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 9563, 0.02);

  if (densityNoise > 0.9) {
    return { lowerStateId: worldOptions.decorationBlockStateIds.brownMushroom };
  }

  if (densityNoise > 0.86) {
    return { lowerStateId: worldOptions.decorationBlockStateIds.redMushroom };
  }

  if (patchNoise > 0.58 && densityNoise > 0.66) {
    return {
      lowerStateId: variantNoise > 0.42
        ? worldOptions.decorationBlockStateIds.fern
        : worldOptions.decorationBlockStateIds.shortGrass
    };
  }

  return null;
}

module.exports = {
  metadata: DARK_FOREST_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
