const plains = require('./plains');

const SUNFLOWER_PLAINS_METADATA = {
  key: 'sunflower_plains',
  label: 'Sunflower Plains',
  temperature: 0.8,
  downfall: 0.4,
  hasPrecipitation: true,
  snow: 'none'
};

function createProfile(worldOptions) {
  return {
    biomeKey: SUNFLOWER_PLAINS_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.sunflowerPlains,
    metadata: SUNFLOWER_PLAINS_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.sand,
    surfaceBlockStateId: worldOptions.surfaceBlockStateId,
    soilBlockStateId: worldOptions.soilBlockStateId,
    foundationBlockStateId: worldOptions.foundationBlockStateId,
    terrainAmplitudeOffset: -1
  };
}

function getDecorationFeature(context) {
  const { worldOptions, worldX, worldZ, topStateId, hashNoise2d, valueNoise2d } = context;
  const isSandy = topStateId === worldOptions.terrainBlockStateIds.sand;

  if (isSandy) {
    return null;
  }

  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 1501);
  const variantNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 1529);
  const sunflowerPatchNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 1571, 0.014);
  const tulipPatchNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 1597, 0.018);
  const flowerPatchNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 1613, 0.012);

  if (sunflowerPatchNoise > 0.58 && densityNoise > 0.42) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.sunflowerLower,
      upperStateId: worldOptions.decorationBlockStateIds.sunflowerUpper
    };
  }

  if (tulipPatchNoise > 0.76 && densityNoise > 0.54) {
    return {
      lowerStateId: plains.getTulipStateId(worldOptions, variantNoise)
    };
  }

  if (flowerPatchNoise > 0.7 && densityNoise > 0.6) {
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

  if (densityNoise > 0.48) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.shortGrass
    };
  }

  return null;
}

module.exports = {
  metadata: SUNFLOWER_PLAINS_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate: plains.getTreeCandidate
};
