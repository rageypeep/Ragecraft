const WARM_OCEAN_METADATA = {
  key: 'warm_ocean',
  label: 'Warm Ocean',
  temperature: 0.5,
  downfall: 0.5,
  hasPrecipitation: true,
  snow: 'none',
  grassColor: '#8EB971',
  foliageColor: '#71A74D',
  waterColor: '#43D5EE'
};

function createProfile(worldOptions) {
  return {
    biomeKey: WARM_OCEAN_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.warmOcean,
    metadata: WARM_OCEAN_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.sand,
    surfaceBlockStateId: worldOptions.terrainBlockStateIds.sand,
    soilBlockStateId: worldOptions.terrainBlockStateIds.sand,
    foundationBlockStateId: worldOptions.foundationBlockStateId,
    terrainAmplitudeOffset: -4
  };
}

function getTreeCandidate() {
  return null;
}

function getDecorationFeature() {
  return null;
}

module.exports = {
  metadata: WARM_OCEAN_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
