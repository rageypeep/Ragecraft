const biomeUtils = require('./utils');

const SPARSE_JUNGLE_METADATA = {
  key: 'sparse_jungle',
  label: 'Sparse Jungle',
  temperature: 0.95,
  downfall: 0.8,
  hasPrecipitation: true,
  snow: 'none',
  grassColor: '#68C24A',
  foliageColor: '#43AE2A',
  waterColor: '#3F76E4'
};

function createProfile(worldOptions) {
  return {
    biomeKey: SPARSE_JUNGLE_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.sparseJungle,
    metadata: SPARSE_JUNGLE_METADATA,
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
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1511);
  const densityNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1537);
  const selectorNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1553);
  const localX = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1517) * 3);
  const localZ = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1523) * 3);
  const worldX = (cellX * 5) + localX;
  const worldZ = (cellZ * 5) + localZ;

  if (isNearSpawn(spawn, worldX, worldZ)) {
    return null;
  }

  const { topY } = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
  const surfaceVariation = getSurfaceVariation(worldOptions, surfaceY, spawn, worldX, worldZ, 1);
  const treeChance = 0.22 + (densityNoise * 0.1);

  if (candidateNoise > treeChance || surfaceVariation > 7) {
    return null;
  }

  const treeType = selectorNoise > 0.68 ? 'jungle_tall' : selectorNoise > 0.34 ? 'jungle_bushy' : 'oak_bushy';
  return buildTreeFeature(treeType, worldX, worldZ, topY);
}

function getDecorationFeature(context) {
  const { worldOptions, worldX, worldZ, topStateId, hashNoise2d } = context;

  if (!biomeUtils.isBiomeSurfaceState(worldOptions, topStateId, { allowMud: true })) {
    return null;
  }

  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 11501);
  const variantNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 11529);

  if (densityNoise > 0.9) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.tallGrassLower,
      upperStateId: worldOptions.decorationBlockStateIds.tallGrassUpper
    };
  }

  if (densityNoise > 0.8) {
    return {
      lowerStateId: variantNoise > 0.46
        ? worldOptions.decorationBlockStateIds.fern
        : worldOptions.decorationBlockStateIds.shortGrass
    };
  }

  if (densityNoise > 0.68) {
    return {
      lowerStateId: variantNoise > 0.7
        ? worldOptions.decorationBlockStateIds.dandelion
        : worldOptions.decorationBlockStateIds.shortGrass
    };
  }

  return null;
}

module.exports = {
  metadata: SPARSE_JUNGLE_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
