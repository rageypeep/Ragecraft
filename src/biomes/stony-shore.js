const STONY_SHORE_METADATA = {
  key: 'stony_shore',
  label: 'Stony Shore',
  temperature: 0.2,
  downfall: 0.3,
  hasPrecipitation: true,
  snow: 'none',
  grassColor: '#8AB689',
  foliageColor: '#6DA36B'
};

function createProfile(worldOptions) {
  return {
    biomeKey: STONY_SHORE_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.stonyShore,
    metadata: STONY_SHORE_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.gravel,
    surfaceBlockStateId: worldOptions.terrainBlockStateIds.stone,
    soilBlockStateId: worldOptions.terrainBlockStateIds.stone,
    foundationBlockStateId: worldOptions.terrainBlockStateIds.stone,
    terrainAmplitudeOffset: 1
  };
}

function getDecorationFeature() {
  return null;
}

function getTreeCandidate() {
  return null;
}

module.exports = {
  metadata: STONY_SHORE_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
