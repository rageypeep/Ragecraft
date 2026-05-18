const STONY_PEAKS_METADATA = {
  key: 'stony_peaks',
  label: 'Stony Peaks',
  temperature: 1.0,
  downfall: 0.3,
  hasPrecipitation: true,
  snow: 'none',
  grassColor: '#9ABE4B',
  foliageColor: '#82AC1E',
  waterColor: '#3F76E4'
};

function createProfile(worldOptions) {
  return {
    biomeKey: STONY_PEAKS_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.stonyPeaks,
    metadata: STONY_PEAKS_METADATA,
    allowWater: false,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.stone,
    surfaceBlockStateId: worldOptions.terrainBlockStateIds.stone,
    soilBlockStateId: worldOptions.terrainBlockStateIds.stone,
    foundationBlockStateId: worldOptions.foundationBlockStateId,
    terrainAmplitudeOffset: 6
  };
}

function getTreeCandidate() {
  return null;
}

function getDecorationFeature() {
  return null;
}

module.exports = {
  metadata: STONY_PEAKS_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
