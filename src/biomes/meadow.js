const MEADOW_METADATA = {
  key: 'meadow',
  label: 'Meadow',
  temperature: 0.5,
  downfall: 0.8,
  hasPrecipitation: true,
  snow: 'none',
  grassColor: '#83BB6D',
  foliageColor: '#63A948',
  waterColor: '#0E4ECF'
};

function createProfile(worldOptions) {
  return {
    biomeKey: MEADOW_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.meadow,
    metadata: MEADOW_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.gravel,
    surfaceBlockStateId: worldOptions.surfaceBlockStateId,
    soilBlockStateId: worldOptions.soilBlockStateId,
    foundationBlockStateId: worldOptions.foundationBlockStateId,
    terrainAmplitudeOffset: 3
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
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 911);
  const localX = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 917) * 3);
  const localZ = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 923) * 3);
  const worldX = (cellX * 5) + localX;
  const worldZ = (cellZ * 5) + localZ;

  if (isNearSpawn(spawn, worldX, worldZ)) {
    return null;
  }

  const { topY } = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
  const surfaceVariation = getSurfaceVariation(worldOptions, surfaceY, spawn, worldX, worldZ, 1);

  if (candidateNoise > 0.04 || surfaceVariation > 3) {
    return null;
  }

  return buildTreeFeature('oak_small', worldX, worldZ, topY);
}

function getDecorationFeature(context) {
  const { worldOptions, topStateId, hashNoise2d, worldX, worldZ } = context;

  if (topStateId !== worldOptions.surfaceBlockStateId) {
    return null;
  }

  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 9101);
  const variantNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 9127);

  if (densityNoise > 0.55) {
    if (variantNoise > 0.7) {
      return { lowerStateId: worldOptions.decorationBlockStateIds.oxeyeDaisy };
    }
    if (variantNoise > 0.4) {
      return { lowerStateId: worldOptions.decorationBlockStateIds.cornflower };
    }
    return { lowerStateId: worldOptions.decorationBlockStateIds.shortGrass };
  }

  return null;
}

module.exports = {
  metadata: MEADOW_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
