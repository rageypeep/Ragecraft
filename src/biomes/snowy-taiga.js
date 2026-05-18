const biomeUtils = require('./utils');

const SNOWY_TAIGA_METADATA = {
  key: 'snowy_taiga',
  label: 'Snowy Taiga',
  temperature: -0.5,
  downfall: 0.4,
  hasPrecipitation: true,
  snow: 'full',
  grassColor: '#80B497',
  foliageColor: '#60A17B',
  waterColor: '#3D57D6'
};

function createProfile(worldOptions) {
  return {
    biomeKey: SNOWY_TAIGA_METADATA.key,
    biomeModule: module.exports,
    biomeId: worldOptions.biomeIds.snowyTaiga,
    metadata: SNOWY_TAIGA_METADATA,
    allowWater: true,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.gravel,
    surfaceBlockStateId: worldOptions.terrainBlockStateIds.snow,
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
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1611);
  const densityNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1637);
  const selectorNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1653);
  const localX = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1617) * 3);
  const localZ = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 1623) * 3);
  const worldX = (cellX * 5) + localX;
  const worldZ = (cellZ * 5) + localZ;

  if (isNearSpawn(spawn, worldX, worldZ)) {
    return null;
  }

  const { topY } = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
  const surfaceVariation = getSurfaceVariation(worldOptions, surfaceY, spawn, worldX, worldZ, 1);
  const treeChance = 0.48 + (densityNoise * 0.16);

  if (candidateNoise > treeChance || surfaceVariation > 10) {
    return null;
  }

  const treeType = selectorNoise > 0.72 ? 'pine_tall' : selectorNoise > 0.36 ? 'spruce_tall' : 'spruce_narrow';
  return buildTreeFeature(treeType, worldX, worldZ, topY);
}

function getDecorationFeature(context) {
  const { worldOptions, worldX, worldZ, topStateId, hashNoise2d } = context;

  if (!biomeUtils.isBiomeSurfaceState(worldOptions, topStateId, { allowPodzol: true, allowRootedDirt: true, allowSnow: true })) {
    return null;
  }

  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 11601);
  const variantNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 11629);
  const isGrass = topStateId === worldOptions.soilBlockStateId;

  if (isGrass && densityNoise > 0.92) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.sweetBerryBush
    };
  }

  if (isGrass && densityNoise > 0.84) {
    return {
      lowerStateId: variantNoise > 0.4
        ? worldOptions.decorationBlockStateIds.fern
        : worldOptions.decorationBlockStateIds.shortGrass
    };
  }

  return null;
}

module.exports = {
  metadata: SNOWY_TAIGA_METADATA,
  createProfile,
  getDecorationFeature,
  getTreeCandidate
};
