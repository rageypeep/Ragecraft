const SNOWY_PLAINS_METADATA = {
  key: 'snowy_plains',
  label: 'Snowy Plains',
  temperature: 0.0,
  downfall: 0.5,
  hasPrecipitation: true,
  snow: 'full',
  grassColor: '#80B497',
  foliageColor: '#60A17B',
  waterColor: '#3D57D6'
};

function createProfile(worldOptions) {
  return {
    biomeKey: SNOWY_PLAINS_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.snowyPlains,
    metadata: SNOWY_PLAINS_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.gravel,
    surfaceBlockStateId: worldOptions.terrainBlockStateIds.snow,
    soilBlockStateId: worldOptions.soilBlockStateId,
    foundationBlockStateId: worldOptions.foundationBlockStateId,
    terrainAmplitudeOffset: -1
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
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 811);
  const selectorNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 853);
  const localX = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 817) * 3);
  const localZ = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 823) * 3);
  const worldX = (cellX * 5) + localX;
  const worldZ = (cellZ * 5) + localZ;

  if (isNearSpawn(spawn, worldX, worldZ)) {
    return null;
  }

  const { topY } = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
  const surfaceVariation = getSurfaceVariation(worldOptions, surfaceY, spawn, worldX, worldZ, 1);
  const treeChance = 0.02 + (hashNoise2d(cellX, cellZ, worldOptions.seedHash + 837) * 0.03);

  if (candidateNoise > treeChance || surfaceVariation > 4) {
    return null;
  }

  return buildTreeFeature(selectorNoise > 0.5 ? 'spruce_narrow' : 'spruce_tall', worldX, worldZ, topY);
}

function getDecorationFeature(context) {
  const { worldOptions, topStateId, hashNoise2d, worldX, worldZ } = context;
  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 8301);
  const isSnowy = topStateId === worldOptions.terrainBlockStateIds.snow;
  const isGrass = topStateId === worldOptions.surfaceBlockStateId;

  if (!isSnowy && !isGrass) {
    return null;
  }

  if (isGrass && densityNoise > 0.72) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.shortGrass
    };
  }

  return null;
}

module.exports = {
  metadata: SNOWY_PLAINS_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
