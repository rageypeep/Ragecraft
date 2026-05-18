const biomeUtils = require('./utils');

const WINDSWEPT_HILLS_METADATA = {
  key: 'windswept_hills',
  label: 'Windswept Hills',
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
    biomeKey: WINDSWEPT_HILLS_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.windsweptHills,
    metadata: WINDSWEPT_HILLS_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.gravel,
    surfaceBlockStateId: worldOptions.surfaceBlockStateId,
    soilBlockStateId: worldOptions.soilBlockStateId,
    foundationBlockStateId: worldOptions.foundationBlockStateId,
    terrainAmplitudeOffset: 4
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
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1811);
  const densityNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1837);
  const selectorNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1853);
  const localX = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1817) * 3);
  const localZ = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1823) * 3);
  const worldX = (cellX * 5) + localX;
  const worldZ = (cellZ * 5) + localZ;

  if (isNearSpawn(spawn, worldX, worldZ)) {
    return null;
  }

  const { topY } = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
  const surfaceVariation = getSurfaceVariation(worldOptions, surfaceY, spawn, worldX, worldZ, 1);
  const treeChance = 0.06 + (densityNoise * 0.05);

  if (candidateNoise > treeChance || surfaceVariation > 9) {
    return null;
  }

  const treeType = selectorNoise > 0.55 ? 'spruce_narrow' : 'oak_small';
  return buildTreeFeature(treeType, worldX, worldZ, topY);
}

function getDecorationFeature(context) {
  const { worldOptions, worldX, worldZ, topStateId, hashNoise2d } = context;

  if (!biomeUtils.isBiomeSurfaceState(worldOptions, topStateId)) {
    return null;
  }

  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 11801);
  const variantNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 11829);

  if (densityNoise > 0.82) {
    return {
      lowerStateId: variantNoise > 0.46
        ? worldOptions.decorationBlockStateIds.fern
        : worldOptions.decorationBlockStateIds.shortGrass
    };
  }

  if (densityNoise > 0.66) {
    return {
      lowerStateId: variantNoise > 0.6
        ? worldOptions.decorationBlockStateIds.dandelion
        : worldOptions.decorationBlockStateIds.shortGrass
    };
  }

  return null;
}

module.exports = {
  metadata: WINDSWEPT_HILLS_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
