const biomeUtils = require('./utils');

const PLAINS_METADATA = {
  key: 'plains',
  label: 'Plains',
  temperature: 0.8,
  downfall: 0.4,
  hasPrecipitation: true,
  snow: 'none'
};

function createProfile(worldOptions) {
  return {
    biomeKey: PLAINS_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.plains,
    metadata: PLAINS_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.sand,
    surfaceBlockStateId: worldOptions.surfaceBlockStateId,
    soilBlockStateId: worldOptions.soilBlockStateId,
    foundationBlockStateId: worldOptions.foundationBlockStateId,
    terrainAmplitudeOffset: -1
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
  const groveNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 47);
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
  const treeChance = groveNoise > 0.82
    ? 0.09 + (densityNoise * 0.06)
    : 0.015 + (densityNoise * 0.025);

  if (candidateNoise > treeChance || surfaceVariation > 6) {
    return null;
  }

  const treeType = selectorNoise < (1 / 3) ? 'oak_bushy' : 'oak_small';
  const tree = buildTreeFeature(treeType, worldX, worldZ, topY);

  if (hashNoise2d(cellX, cellZ, worldOptions.seedHash + 71) > 0.95) {
    tree.beeNest = {
      dx: 1,
      dz: 0,
      stateId: worldOptions.treeBlockStateIds.beeNest,
      y: tree.topY + Math.max(2, Math.min(3, tree.height - 1))
    };
  }

  return tree;
}

function getTulipStateId(worldOptions, variantNoise) {
  if (variantNoise < 0.25) {
    return worldOptions.decorationBlockStateIds.orangeTulip;
  }

  if (variantNoise < 0.5) {
    return worldOptions.decorationBlockStateIds.redTulip;
  }

  if (variantNoise < 0.75) {
    return worldOptions.decorationBlockStateIds.pinkTulip;
  }

  return worldOptions.decorationBlockStateIds.whiteTulip;
}

function getFlowerStateId(worldOptions, variantNoise) {
  if (variantNoise < 0.2) {
    return worldOptions.decorationBlockStateIds.dandelion;
  }

  if (variantNoise < 0.4) {
    return worldOptions.decorationBlockStateIds.poppy;
  }

  if (variantNoise < 0.6) {
    return worldOptions.decorationBlockStateIds.azureBluet;
  }

  if (variantNoise < 0.8) {
    return worldOptions.decorationBlockStateIds.oxeyeDaisy;
  }

  return worldOptions.decorationBlockStateIds.cornflower;
}

function getDecorationFeature(context) {
  const { worldOptions, worldX, worldZ, topStateId, hashNoise2d, valueNoise2d } = context;

  if (!biomeUtils.isBiomeSurfaceState(worldOptions, topStateId)) {
    return null;
  }

  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 1301);
  const variantNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 1327);
  const tulipPatchNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 1403, 0.018);
  const flowerPatchNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 1439, 0.012);

  if (tulipPatchNoise > 0.73 && densityNoise > 0.52) {
    return {
      lowerStateId: getTulipStateId(worldOptions, variantNoise)
    };
  }

  if (flowerPatchNoise > 0.68 && densityNoise > 0.6) {
    return {
      lowerStateId: getFlowerStateId(worldOptions, variantNoise)
    };
  }

  if (densityNoise > 0.9) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.tallGrassLower,
      upperStateId: worldOptions.decorationBlockStateIds.tallGrassUpper
    };
  }

  if (densityNoise > 0.52) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.shortGrass
    };
  }

  return null;
}

module.exports = {
  metadata: PLAINS_METADATA,
  createProfile,
  getFlowerStateId,
  getDecorationFeature,
  getTulipStateId,
  getTreeCandidate
};
