const biomeUtils = require('./utils');

const TAIGA_METADATA = {
  key: 'taiga',
  label: 'Taiga',
  temperature: 0.25,
  downfall: 0.8,
  hasPrecipitation: true,
  snow: 'none',
  grassColor: '#86B783',
  foliageColor: '#68A464',
  waterColor: '#287082'
};

function createProfile(worldOptions) {
  return {
    biomeKey: TAIGA_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.taiga,
    metadata: TAIGA_METADATA,
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
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 511);
  const densityNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 537);
  const selectorNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 553);
  const localX = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 517) * 3);
  const localZ = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 523) * 3);
  const worldX = (cellX * 5) + localX;
  const worldZ = (cellZ * 5) + localZ;

  if (isNearSpawn(spawn, worldX, worldZ)) {
    return null;
  }

  const { topY } = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
  const surfaceVariation = getSurfaceVariation(worldOptions, surfaceY, spawn, worldX, worldZ, 1);
  const treeChance = 0.58 + (densityNoise * 0.22);

  if (candidateNoise > treeChance || surfaceVariation > 11) {
    return null;
  }

  let treeType = 'spruce_narrow';

  if (selectorNoise > 0.78) {
    treeType = 'pine_tall';
  } else if (selectorNoise > 0.42) {
    treeType = 'spruce_tall';
  }

  return buildTreeFeature(treeType, worldX, worldZ, topY);
}

function getDecorationFeature(context) {
  const { worldOptions, worldX, worldZ, topStateId, hashNoise2d } = context;
  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 5301);
  const variantNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 5327);

  if (!biomeUtils.isBiomeSurfaceState(worldOptions, topStateId, { allowPodzol: true, allowRootedDirt: true })) {
    return null;
  }

  if (densityNoise > 0.93) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.sweetBerryBush
    };
  }

  if (densityNoise > 0.84) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.largeFernLower,
      upperStateId: worldOptions.decorationBlockStateIds.largeFernUpper
    };
  }

  if (densityNoise > 0.7) {
    return {
      lowerStateId: variantNoise > 0.35
        ? worldOptions.decorationBlockStateIds.fern
        : worldOptions.decorationBlockStateIds.shortGrass
    };
  }

  if (densityNoise > 0.64) {
    return {
      lowerStateId: variantNoise > 0.5
        ? worldOptions.decorationBlockStateIds.dandelion
        : worldOptions.decorationBlockStateIds.poppy
    };
  }

  return null;
}

module.exports = {
  metadata: TAIGA_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
