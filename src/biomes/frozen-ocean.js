const FROZEN_OCEAN_METADATA = {
  key: 'frozen_ocean',
  label: 'Frozen Ocean',
  temperature: 0.0,
  downfall: 0.5,
  hasPrecipitation: true,
  snow: 'full',
  grassColor: '#80B497',
  foliageColor: '#60A17B',
  waterColor: '#3938C9'
};

function createProfile(worldOptions) {
  return {
    biomeKey: FROZEN_OCEAN_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.frozenOcean,
    metadata: FROZEN_OCEAN_METADATA,
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
  metadata: FROZEN_OCEAN_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
