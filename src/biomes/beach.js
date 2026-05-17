const BEACH_METADATA = {
  key: 'beach',
  label: 'Beach',
  temperature: 0.8,
  downfall: 0.4,
  hasPrecipitation: true,
  snow: 'none',
  grassColor: '#91BD59',
  foliageColor: '#77AB2F',
  waterColor: '#157CAB'
};

function createProfile(worldOptions) {
  return {
    biomeKey: BEACH_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.beach,
    metadata: BEACH_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.sand,
    surfaceBlockStateId: worldOptions.terrainBlockStateIds.sand,
    soilBlockStateId: worldOptions.terrainBlockStateIds.sand,
    foundationBlockStateId: worldOptions.terrainBlockStateIds.sandstone,
    terrainAmplitudeOffset: -2
  };
}

function getDecorationFeature() {
  return null;
}

function getTreeCandidate() {
  return null;
}

module.exports = {
  metadata: BEACH_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
