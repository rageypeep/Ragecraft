const FOREST_METADATA = {
  key: 'forest',
  label: 'Forest',
  temperature: 0.7,
  downfall: 0.8,
  hasPrecipitation: true,
  snow: 'none',
  grassColor: '#79C05A',
  foliageColor: '#59AE30'
};

function createProfile(worldOptions) {
  return {
    biomeKey: FOREST_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.forest,
    metadata: FOREST_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.sand,
    surfaceBlockStateId: worldOptions.surfaceBlockStateId,
    soilBlockStateId: worldOptions.soilBlockStateId,
    foundationBlockStateId: worldOptions.foundationBlockStateId,
    terrainAmplitudeOffset: 1
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
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 11);
  const densityNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 37);
  const selectorNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 53);
  const localX = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 17) * 5);
  const localZ = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 23) * 5);
  const worldX = (cellX * 7) + localX;
  const worldZ = (cellZ * 7) + localZ;

  if (isNearSpawn(spawn, worldX, worldZ)) {
    return null;
  }

  const { topY } = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
  const surfaceVariation = getSurfaceVariation(worldOptions, surfaceY, spawn, worldX, worldZ, 2);
  const treeChance = 0.28 + (densityNoise * 0.24);

  if (candidateNoise > treeChance || surfaceVariation > 3) {
    return null;
  }

  let treeType = 'oak_small';

  if (selectorNoise > 0.8) {
    treeType = 'oak_tall';
  } else if (selectorNoise > 0.45) {
    treeType = 'oak_bushy';
  }

  return buildTreeFeature(worldOptions, treeType, worldX, worldZ, topY, cellX, cellZ);
}

function getDecorationFeature(context) {
  const { worldOptions, worldX, worldZ, topY, topStateId, hashNoise2d } = context;
  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 1301);
  const variantNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 1327);
  const mushroomNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 1361);
  const isSandy = topStateId === worldOptions.terrainBlockStateIds.sand;

  if (isSandy) {
    return null;
  }

  if (
    topY < 103 &&
    densityNoise > 0.965
  ) {
    return {
      lowerStateId: mushroomNoise > 0.55
        ? worldOptions.decorationBlockStateIds.brownMushroom
        : worldOptions.decorationBlockStateIds.redMushroom
    };
  }

  if (densityNoise > 0.58) {
    return {
      lowerStateId: variantNoise > 0.38
        ? worldOptions.decorationBlockStateIds.fern
        : worldOptions.decorationBlockStateIds.shortGrass
    };
  }

  return null;
}

module.exports = {
  metadata: FOREST_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
