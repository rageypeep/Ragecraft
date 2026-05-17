const OLD_GROWTH_BIRCH_FOREST_METADATA = {
  key: 'old_growth_birch_forest',
  label: 'Old Growth Birch Forest',
  temperature: 0.6,
  downfall: 0.6,
  hasPrecipitation: true,
  snow: 'none',
  grassColor: '#88BB67',
  foliageColor: '#6BA941',
  waterColor: '#3F76E4'
};

function createProfile(worldOptions) {
  return {
    biomeKey: OLD_GROWTH_BIRCH_FOREST_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.oldGrowthBirchForest,
    metadata: OLD_GROWTH_BIRCH_FOREST_METADATA,
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
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 411);
  const densityNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 437);
  const selectorNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 453);
  const normalVariantNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 467);
  const localX = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 417) * 3);
  const localZ = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 423) * 3);
  const worldX = (cellX * 5) + localX;
  const worldZ = (cellZ * 5) + localZ;

  if (isNearSpawn(spawn, worldX, worldZ)) {
    return null;
  }

  const { topY } = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
  const surfaceVariation = getSurfaceVariation(worldOptions, surfaceY, spawn, worldX, worldZ, 1);
  const treeChance = 0.52 + (densityNoise * 0.22);

  if (candidateNoise > treeChance || surfaceVariation > 9) {
    return null;
  }

  let treeType = 'birch_old_growth';

  if (selectorNoise <= 0.5) {
    treeType = normalVariantNoise > 0.52 ? 'birch_tall' : 'birch_small';
  }

  return buildTreeFeature(treeType, worldX, worldZ, topY);
}

function getDecorationFeature(context) {
  const { worldOptions, worldX, worldZ, topStateId, hashNoise2d } = context;
  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 1301);
  const variantNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 1327);
  const isSandy = topStateId === worldOptions.terrainBlockStateIds.sand;

  if (isSandy) {
    return null;
  }

  if (densityNoise > 0.92) {
    return {
      lowerStateId: variantNoise > 0.5
        ? worldOptions.decorationBlockStateIds.dandelion
        : worldOptions.decorationBlockStateIds.poppy
    };
  }

  if (densityNoise > 0.68) {
    return {
      lowerStateId: variantNoise > 0.4
        ? worldOptions.decorationBlockStateIds.fern
        : worldOptions.decorationBlockStateIds.shortGrass
    };
  }

  return null;
}

module.exports = {
  metadata: OLD_GROWTH_BIRCH_FOREST_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
