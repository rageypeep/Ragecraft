const JAGGED_PEAKS_METADATA = {
  key: 'jagged_peaks',
  label: 'Jagged Peaks',
  temperature: -0.7,
  downfall: 0.9,
  hasPrecipitation: true,
  snow: 'full',
  grassColor: '#80B497',
  foliageColor: '#60A17B',
  waterColor: '#3D57D6'
};

function createProfile(worldOptions) {
  return {
    biomeKey: JAGGED_PEAKS_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.jaggedPeaks,
    metadata: JAGGED_PEAKS_METADATA,
    allowWater: false,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.stone,
    surfaceBlockStateId: worldOptions.terrainBlockStateIds.snowBlock,
    soilBlockStateId: worldOptions.terrainBlockStateIds.stone,
    foundationBlockStateId: worldOptions.foundationBlockStateId,
    terrainAmplitudeOffset: 8
  };
}

function getTreeCandidate() {
  return null;
}

function getDecorationFeature() {
  return null;
}

module.exports = {
  metadata: JAGGED_PEAKS_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
