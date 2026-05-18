const biomeUtils = require('./utils');

const BIRCH_FOREST_METADATA = {
  key: 'birch_forest',
  label: 'Birch Forest',
  temperature: 0.6,
  downfall: 0.6,
  hasPrecipitation: true,
  snow: 'none',
  grassColor: '#88BB67',
  foliageColor: '#6BA941',
  waterColor: '#3F76E4'
};

function createProfile(worldOptions) {
  return {
    biomeKey: BIRCH_FOREST_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.birchForest,
    metadata: BIRCH_FOREST_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.sand,
    surfaceBlockStateId: worldOptions.surfaceBlockStateId,
    soilBlockStateId: worldOptions.soilBlockStateId,
    foundationBlockStateId: worldOptions.foundationBlockStateId,
    terrainAmplitudeOffset: 1
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
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 11);
  const densityNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 37);
  const selectorNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 53);
  const localX = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 17) * 3);
  const localZ = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 23) * 3);
  const worldX = (cellX * 5) + localX;
  const worldZ = (cellZ * 5) + localZ;

  if (isNearSpawn(spawn, worldX, worldZ)) {
    return null;
  }

  const { topY } = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
  const surfaceVariation = getSurfaceVariation(worldOptions, surfaceY, spawn, worldX, worldZ, 1);
  const treeChance = 0.52 + (densityNoise * 0.22);

  if (candidateNoise > treeChance || surfaceVariation > 10) {
    return null;
  }

  const treeType = selectorNoise > 0.52 ? 'birch_tall' : 'birch_small';
  return buildTreeFeature(treeType, worldX, worldZ, topY);
}

function getDecorationFeature(context) {
  const { worldOptions, worldX, worldZ, topStateId, hashNoise2d } = context;
  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 1301);
  const variantNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 1327);

  if (!biomeUtils.isBiomeSurfaceState(worldOptions, topStateId)) {
    return null;
  }

  if (densityNoise > 0.9) {
    return {
      lowerStateId: variantNoise > 0.5
        ? worldOptions.decorationBlockStateIds.dandelion
        : worldOptions.decorationBlockStateIds.poppy
    };
  }

  if (densityNoise > 0.66) {
    return {
      lowerStateId: variantNoise > 0.42
        ? worldOptions.decorationBlockStateIds.fern
        : worldOptions.decorationBlockStateIds.shortGrass
    };
  }

  return null;
}

module.exports = {
  metadata: BIRCH_FOREST_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
