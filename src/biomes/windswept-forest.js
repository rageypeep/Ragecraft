const biomeUtils = require('./utils');

const WINDSWEPT_FOREST_METADATA = {
  key: 'windswept_forest',
  label: 'Windswept Forest',
  temperature: 0.2,
  downfall: 0.3,
  hasPrecipitation: true,
  snow: 'none',
  grassColor: '#7DAA5A',
  foliageColor: '#61913D',
  waterColor: '#3F76E4'
};

function createProfile(worldOptions) {
  return {
    biomeKey: WINDSWEPT_FOREST_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.windsweptForest,
    metadata: WINDSWEPT_FOREST_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.gravel,
    surfaceBlockStateId: worldOptions.surfaceBlockStateId,
    soilBlockStateId: worldOptions.soilBlockStateId,
    foundationBlockStateId: worldOptions.foundationBlockStateId,
    terrainAmplitudeOffset: 3
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
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1711);
  const densityNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1737);
  const selectorNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1753);
  const localX = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1717) * 3);
  const localZ = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1723) * 3);
  const worldX = (cellX * 5) + localX;
  const worldZ = (cellZ * 5) + localZ;

  if (isNearSpawn(spawn, worldX, worldZ)) {
    return null;
  }

  const { topY } = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
  const surfaceVariation = getSurfaceVariation(worldOptions, surfaceY, spawn, worldX, worldZ, 1);
  const treeChance = 0.18 + (densityNoise * 0.12);

  if (candidateNoise > treeChance || surfaceVariation > 8) {
    return null;
  }

  const treeType = selectorNoise > 0.66 ? 'spruce_tall' : selectorNoise > 0.33 ? 'spruce_narrow' : 'oak_bushy';
  return buildTreeFeature(treeType, worldX, worldZ, topY);
}

function getDecorationFeature(context) {
  const { worldOptions, worldX, worldZ, topStateId, hashNoise2d } = context;

  if (!biomeUtils.isBiomeSurfaceState(worldOptions, topStateId)) {
    return null;
  }

  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 11701);
  const variantNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 11729);

  if (densityNoise > 0.88) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.largeFernLower,
      upperStateId: worldOptions.decorationBlockStateIds.largeFernUpper
    };
  }

  if (densityNoise > 0.74) {
    return {
      lowerStateId: variantNoise > 0.4
        ? worldOptions.decorationBlockStateIds.fern
        : worldOptions.decorationBlockStateIds.shortGrass
    };
  }

  return null;
}

module.exports = {
  metadata: WINDSWEPT_FOREST_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
