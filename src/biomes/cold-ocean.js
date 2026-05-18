const COLD_OCEAN_METADATA = {
  key: 'cold_ocean',
  label: 'Cold Ocean',
  temperature: 0.5,
  downfall: 0.5,
  hasPrecipitation: true,
  snow: 'none',
  grassColor: '#8EB971',
  foliageColor: '#71A74D',
  waterColor: '#3D57D6'
};

function createProfile(worldOptions) {
  return {
    biomeKey: COLD_OCEAN_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.coldOcean,
    metadata: COLD_OCEAN_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.gravel,
    surfaceBlockStateId: worldOptions.terrainBlockStateIds.gravel,
    soilBlockStateId: worldOptions.terrainBlockStateIds.gravel,
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
  metadata: COLD_OCEAN_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
