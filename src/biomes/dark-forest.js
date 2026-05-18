const DARK_FOREST_METADATA = {
  key: 'dark_forest',
  label: 'Dark Forest',
  temperature: 0.7,
  downfall: 0.8,
  hasPrecipitation: true,
  snow: 'none',
  grassColor: '#507A32',
  foliageColor: '#59AE30',
  waterColor: '#3F76E4'
};

function createProfile(worldOptions) {
  return {
    biomeKey: DARK_FOREST_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.darkForest,
    metadata: DARK_FOREST_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.gravel,
    surfaceBlockStateId: worldOptions.surfaceBlockStateId,
    soilBlockStateId: worldOptions.soilBlockStateId,
    foundationBlockStateId: worldOptions.foundationBlockStateId,
    terrainAmplitudeOffset: 0
  };
}

function getTreeCandidate(context) {
  const {
    worldOptions,
    surfaceY,
    spawn,
    cellX,
    cellZ,
    hashNoise2d,
    getColumnDescriptor,
    getSurfaceVariation,
    isNearSpawn,
    buildTreeFeature
  } = context;
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 951);
  const selectorNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 957);
  const localX = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 963) * 3);
  const localZ = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 967) * 3);
  const worldX = (cellX * 5) + localX;
  const worldZ = (cellZ * 5) + localZ;

  if (isNearSpawn(spawn, worldX, worldZ)) {
    return null;
  }

  const { topY } = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
  const surfaceVariation = getSurfaceVariation(worldOptions, surfaceY, spawn, worldX, worldZ, 1);

  if (candidateNoise > 0.55 || surfaceVariation > 3) {
    return null;
  }

  if (selectorNoise > 0.6) {
    return buildTreeFeature('oak_tall', worldX, worldZ, topY);
  }
  return buildTreeFeature('oak_bushy', worldX, worldZ, topY);
}

function getDecorationFeature(context) {
  const { worldOptions, topStateId, hashNoise2d, worldX, worldZ } = context;

  if (topStateId !== worldOptions.surfaceBlockStateId) {
    return null;
  }

  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 9501);

  if (densityNoise > 0.92) {
    return { lowerStateId: worldOptions.decorationBlockStateIds.brownMushroom };
  }

  if (densityNoise > 0.88) {
    return { lowerStateId: worldOptions.decorationBlockStateIds.redMushroom };
  }

  return null;
}

module.exports = {
  metadata: DARK_FOREST_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
