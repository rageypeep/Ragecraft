const OCEAN_METADATA = {
  key: 'ocean',
  label: 'Ocean',
  temperature: 0.5,
  downfall: 0.5,
  hasPrecipitation: true,
  snow: 'none',
  grassColor: '#91BD59',
  foliageColor: '#77AB2F',
  waterColor: '#3F76E4'
};

function createProfile(worldOptions) {
  return {
    biomeKey: OCEAN_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.ocean,
    metadata: OCEAN_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.sand,
    surfaceBlockStateId: worldOptions.terrainBlockStateIds.sand,
    soilBlockStateId: worldOptions.terrainBlockStateIds.sand,
    foundationBlockStateId: worldOptions.terrainBlockStateIds.sandstone,
    terrainAmplitudeOffset: -5
  };
}

function getTreeCandidate() {
  return null;
}

function getDecorationFeature(context) {
  const {
    worldOptions,
    topStateId,
    topY,
    column,
    hashNoise2d,
    worldX,
    worldZ
  } = context;

  if (
    column?.waterTopY === null ||
    topY > column.waterTopY - 1 ||
    ![
      worldOptions.terrainBlockStateIds.sand,
      worldOptions.terrainBlockStateIds.gravel,
      worldOptions.terrainBlockStateIds.clay
    ].includes(topStateId)
  ) {
    return null;
  }

  if (hashNoise2d(worldX, worldZ, worldOptions.seedHash + 7301) <= 0.42) {
    return null;
  }

  return {
    lowerStateId: worldOptions.decorationBlockStateIds.seagrass,
    allowSubmerged: true
  };
}

module.exports = {
  metadata: OCEAN_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
