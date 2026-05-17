const LAKE_METADATA = {
  key: 'lake',
  label: 'Lake',
  temperature: 0.6,
  downfall: 0.8,
  hasPrecipitation: true,
  snow: 'none',
  grassColor: '#7FAE6B',
  foliageColor: '#67985B',
  waterColor: '#3F76E4'
};

function createProfile(worldOptions) {
  return {
    biomeKey: LAKE_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.lake,
    metadata: LAKE_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.gravel,
    surfaceBlockStateId: worldOptions.surfaceBlockStateId,
    soilBlockStateId: worldOptions.soilBlockStateId,
    foundationBlockStateId: worldOptions.foundationBlockStateId,
    terrainAmplitudeOffset: -1
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
    valueNoise2d,
    worldX,
    worldZ
  } = context;

  if (
    column?.waterTopY === null ||
    topY > column.waterTopY - 1 ||
    ![
      worldOptions.terrainBlockStateIds.sand,
      worldOptions.terrainBlockStateIds.gravel,
      worldOptions.terrainBlockStateIds.clay,
      worldOptions.soilBlockStateId
    ].includes(topStateId)
  ) {
    return null;
  }

  const shallowDepth = column.waterTopY - topY;
  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 7601);
  const patchNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 7649, 0.03);

  if (shallowDepth <= 3 && densityNoise > 0.34) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.seagrass,
      allowSubmerged: true
    };
  }

  if (patchNoise > 0.72 && densityNoise > 0.52) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.seagrass,
      allowSubmerged: true
    };
  }

  return null;
}

module.exports = {
  metadata: LAKE_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
