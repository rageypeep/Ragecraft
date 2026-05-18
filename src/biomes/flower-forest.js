const biomeUtils = require('./utils');
const plains = require('./plains');

const FLOWER_FOREST_METADATA = {
  key: 'flower_forest',
  label: 'Flower Forest',
  temperature: 0.7,
  downfall: 0.8,
  hasPrecipitation: true,
  snow: 'none',
  grassColor: '#79C05A',
  foliageColor: '#59AE30'
};

function createProfile(worldOptions) {
  return {
    biomeKey: FLOWER_FOREST_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.flowerForest,
    metadata: FLOWER_FOREST_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.sand,
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
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 211);
  const densityNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 233);
  const selectorNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 257);
  const localX = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 271) * 3);
  const localZ = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 283) * 3);
  const worldX = (cellX * 5) + localX;
  const worldZ = (cellZ * 5) + localZ;

  if (isNearSpawn(spawn, worldX, worldZ)) {
    return null;
  }

  const { topY } = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
  const surfaceVariation = getSurfaceVariation(worldOptions, surfaceY, spawn, worldX, worldZ, 1);
  const treeChance = 0.32 + (densityNoise * 0.2);

  if (candidateNoise > treeChance || surfaceVariation > 9) {
    return null;
  }

  let treeType = 'oak_small';

  if (selectorNoise > 0.84) {
    treeType = 'oak_tall';
  } else if (selectorNoise > 0.42) {
    treeType = 'oak_bushy';
  }

  const tree = buildTreeFeature(treeType, worldX, worldZ, topY);

  if (hashNoise2d(cellX, cellZ, worldOptions.seedHash + 307) > 0.9) {
    tree.beeNest = {
      dx: 1,
      dz: 0,
      stateId: worldOptions.treeBlockStateIds.beeNest,
      y: tree.topY + Math.max(2, Math.min(3, tree.height - 1))
    };
  }

  return tree;
}

function getDecorationFeature(context) {
  const { worldOptions, worldX, worldZ, topStateId, hashNoise2d, valueNoise2d } = context;

  if (!biomeUtils.isBiomeSurfaceState(worldOptions, topStateId)) {
    return null;
  }

  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 3301);
  const variantNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 3327);
  const tulipPatchNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 3403, 0.018);
  const flowerPatchNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 3439, 0.012);

  if (tulipPatchNoise > 0.58 && densityNoise > 0.32) {
    return {
      lowerStateId: plains.getTulipStateId(worldOptions, variantNoise)
    };
  }

  if (flowerPatchNoise > 0.48 && densityNoise > 0.28) {
    return {
      lowerStateId: plains.getFlowerStateId(worldOptions, variantNoise)
    };
  }

  if (densityNoise > 0.88) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.tallGrassLower,
      upperStateId: worldOptions.decorationBlockStateIds.tallGrassUpper
    };
  }

  if (densityNoise > 0.72) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.shortGrass
    };
  }

  return null;
}

module.exports = {
  metadata: FLOWER_FOREST_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
