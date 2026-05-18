const DESERT_METADATA = {
  key: 'desert',
  label: 'Desert',
  temperature: 2.0,
  downfall: 0.0,
  hasPrecipitation: false,
  snow: 'none',
  grassColor: '#BFB755',
  foliageColor: '#AEA42A',
  waterColor: '#32A598'
};

function createProfile(worldOptions) {
  return {
    biomeKey: DESERT_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.desert,
    metadata: DESERT_METADATA,
    allowWater: false,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.sand,
    surfaceBlockStateId: worldOptions.terrainBlockStateIds.sand,
    soilBlockStateId: worldOptions.terrainBlockStateIds.sand,
    foundationBlockStateId: worldOptions.terrainBlockStateIds.sandstone,
    terrainAmplitudeOffset: -2
  };
}

function getTreeCandidate() {
  return null;
}

function getDecorationFeature(context) {
  const { worldOptions, topStateId, hashNoise2d, worldX, worldZ } = context;

  if (topStateId !== worldOptions.terrainBlockStateIds.sand) {
    return null;
  }

  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 8101);
  const variantNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 8127);

  if (densityNoise > 0.992) {
    return {
      lowerStateId: variantNoise > 0.5
        ? worldOptions.decorationBlockStateIds.deadBush
        : worldOptions.decorationBlockStateIds.cactusLower,
      upperStateId: variantNoise <= 0.5
        ? worldOptions.decorationBlockStateIds.cactusUpper
        : null
    };
  }

  if (densityNoise > 0.985) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.deadBush
    };
  }

  return null;
}

module.exports = {
  metadata: DESERT_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
