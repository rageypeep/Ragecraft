const biomeUtils = require('./utils');

const JUNGLE_METADATA = {
  key: 'jungle',
  label: 'Jungle',
  temperature: 0.95,
  downfall: 0.9,
  hasPrecipitation: true,
  snow: 'none',
  grassColor: '#59C93C',
  foliageColor: '#30BB0B',
  waterColor: '#3F76E4'
};

function createProfile(worldOptions) {
  return {
    biomeKey: JUNGLE_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.jungle,
    metadata: JUNGLE_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.mud,
    surfaceBlockStateId: worldOptions.surfaceBlockStateId,
    soilBlockStateId: worldOptions.soilBlockStateId,
    foundationBlockStateId: worldOptions.foundationBlockStateId,
    terrainAmplitudeOffset: 2
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
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1411);
  const densityNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1437);
  const selectorNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1453);
  const localX = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1417) * 3);
  const localZ = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1423) * 3);
  const worldX = (cellX * 5) + localX;
  const worldZ = (cellZ * 5) + localZ;

  if (isNearSpawn(spawn, worldX, worldZ)) {
    return null;
  }

  const { topY } = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
  const surfaceVariation = getSurfaceVariation(worldOptions, surfaceY, spawn, worldX, worldZ, 1);
  const treeChance = 0.62 + (densityNoise * 0.22);

  if (candidateNoise > treeChance || surfaceVariation > 9) {
    return null;
  }

  const treeType = selectorNoise > 0.44 ? 'jungle_tall' : 'jungle_bushy';
  return buildTreeFeature(treeType, worldX, worldZ, topY);
}

function getDecorationFeature(context) {
  const { worldOptions, worldX, worldZ, topStateId, hashNoise2d } = context;

  if (!biomeUtils.isBiomeSurfaceState(worldOptions, topStateId, { allowMud: true })) {
    return null;
  }

  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 11401);
  const variantNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 11429);

  if (densityNoise > 0.92) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.largeFernLower,
      upperStateId: worldOptions.decorationBlockStateIds.largeFernUpper
    };
  }

  if (densityNoise > 0.82) {
    return {
      lowerStateId: variantNoise > 0.58
        ? worldOptions.decorationBlockStateIds.fern
        : worldOptions.decorationBlockStateIds.tallGrassLower,
      upperStateId: variantNoise > 0.58
        ? null
        : worldOptions.decorationBlockStateIds.tallGrassUpper
    };
  }

  if (densityNoise > 0.66) {
    return {
      lowerStateId: variantNoise > 0.34
        ? worldOptions.decorationBlockStateIds.shortGrass
        : worldOptions.decorationBlockStateIds.fern
    };
  }

  if (densityNoise > 0.985) {
    return {
      lowerStateId: variantNoise > 0.5
        ? worldOptions.decorationBlockStateIds.brownMushroom
        : worldOptions.decorationBlockStateIds.redMushroom
    };
  }

  return null;
}

module.exports = {
  metadata: JUNGLE_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
