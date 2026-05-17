const Vec3 = require('vec3');

function getTopSolidY(chunk, localX, localZ) {
  const minY = chunk.minY;
  const maxY = chunk.minY + chunk.worldHeight - 1;

  for (let y = maxY; y >= minY; y--) {
    if (chunk.getBlockStateId(new Vec3(localX, y, localZ)) !== 0) {
      return y;
    }
  }

  return minY;
}

function isGroundDecorationBase(worldOptions, stateId) {
  return [
    worldOptions.surfaceBlockStateId,
    worldOptions.soilBlockStateId,
    worldOptions.terrainBlockStateIds.podzol,
    worldOptions.terrainBlockStateIds.rootedDirt,
    worldOptions.terrainBlockStateIds.mud,
    worldOptions.terrainBlockStateIds.sand,
    worldOptions.terrainBlockStateIds.gravel,
    worldOptions.terrainBlockStateIds.clay,
    worldOptions.terrainBlockStateIds.stone
  ].includes(stateId);
}

function getDecorationStateId(worldOptions, decorationStyle, worldX, worldZ, topY, topStateId, hashNoise2d, safeSurfaceY) {
  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 1301);
  const variantNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 1327);
  const mushroomNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 1361);
  const isSandy = topStateId === worldOptions.terrainBlockStateIds.sand;

  if (isSandy || !decorationStyle) {
    return null;
  }

  if (decorationStyle === 'plains') {
    if (densityNoise > 0.92) {
      return variantNoise > 0.58
        ? worldOptions.decorationBlockStateIds.poppy
        : worldOptions.decorationBlockStateIds.dandelion;
    }

    if (densityNoise > 0.63) {
      return worldOptions.decorationBlockStateIds.shortGrass;
    }

    return null;
  }

  if (decorationStyle === 'birch') {
    if (densityNoise > 0.9) {
      return variantNoise > 0.5
        ? worldOptions.decorationBlockStateIds.dandelion
        : worldOptions.decorationBlockStateIds.poppy;
    }

    if (densityNoise > 0.66) {
      return variantNoise > 0.42
        ? worldOptions.decorationBlockStateIds.fern
        : worldOptions.decorationBlockStateIds.shortGrass;
    }

    return null;
  }

  if (decorationStyle === 'forest') {
    if (
      topStateId === worldOptions.terrainBlockStateIds.podzol &&
      topY < safeSurfaceY + 8 &&
      densityNoise > 0.88
    ) {
      return mushroomNoise > 0.55
        ? worldOptions.decorationBlockStateIds.brownMushroom
        : worldOptions.decorationBlockStateIds.redMushroom;
    }

    if (densityNoise > 0.58) {
      return variantNoise > 0.38
        ? worldOptions.decorationBlockStateIds.fern
        : worldOptions.decorationBlockStateIds.shortGrass;
    }
  }

  return null;
}

function getClimateDecorationFeature({ column, surfaceY, worldOptions, topY, topStateId }) {
  if (column.waterTopY !== null || !column.climate) {
    return null;
  }

  if (
    ![
      worldOptions.surfaceBlockStateId,
      worldOptions.soilBlockStateId,
      worldOptions.terrainBlockStateIds.podzol,
      worldOptions.terrainBlockStateIds.rootedDirt,
      worldOptions.terrainBlockStateIds.mud,
      worldOptions.terrainBlockStateIds.sand,
      worldOptions.terrainBlockStateIds.gravel,
      worldOptions.terrainBlockStateIds.stone
    ].includes(topStateId)
  ) {
    return null;
  }

  const snowlineY = surfaceY + 16;
  const elevatedColdGround = topY >= snowlineY && column.climate.freezeChance > 0.44;
  const exposedFrozenPeak = column.climate.heightFactor > 0.62 && column.climate.freezeChance > 0.68;

  if (!elevatedColdGround && !exposedFrozenPeak) {
    return null;
  }

  return {
    lowerStateId: worldOptions.terrainBlockStateIds.snow
  };
}

function getAdjacentFreshwaterColumns(worldOptions, surfaceY, spawn, worldX, worldZ, getColumnDescriptor) {
  return [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ].map(([dx, dz]) => getColumnDescriptor(worldOptions, surfaceY, spawn, worldX + dx, worldZ + dz))
    .filter((column) =>
      column.waterTopY !== null &&
      ['lake', 'river'].includes(column.biomeProfile.biomeKey)
    );
}

function getFreshwaterBankDecorationFeature({
  column,
  surfaceY,
  spawn,
  worldOptions,
  worldX,
  worldZ,
  topY,
  topStateId,
  hashNoise2d,
  valueNoise2d,
  getColumnDescriptor
}) {
  if (column.waterTopY !== null) {
    return null;
  }

  const adjacentFreshwaterColumns = getAdjacentFreshwaterColumns(
    worldOptions,
    surfaceY,
    spawn,
    worldX,
    worldZ,
    getColumnDescriptor
  );

  if (adjacentFreshwaterColumns.length === 0) {
    return null;
  }

  const densityNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 7703);
  const variantNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 7727);
  const reedPatchNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 7759, 0.024);
  const flowerPatchNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 7789, 0.016);
  const mudFlatNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 7823, 0.02);
  const grassyBank = [
    worldOptions.surfaceBlockStateId,
    worldOptions.soilBlockStateId,
    worldOptions.terrainBlockStateIds.rootedDirt
  ].includes(topStateId);
  const muddyBank = topStateId === worldOptions.terrainBlockStateIds.mud;
  const gravellyBank = topStateId === worldOptions.terrainBlockStateIds.gravel;
  const softBank = grassyBank || muddyBank || topStateId === worldOptions.terrainBlockStateIds.sand;

  if (softBank && reedPatchNoise > 0.58 && densityNoise > 0.42) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.sugarCane,
      upperStateId: variantNoise > 0.58 ? worldOptions.decorationBlockStateIds.sugarCane : null
    };
  }

  if ((muddyBank || gravellyBank) && mudFlatNoise > 0.6 && densityNoise > 0.56) {
    return {
      lowerStateId: variantNoise > 0.44
        ? worldOptions.decorationBlockStateIds.fern
        : worldOptions.decorationBlockStateIds.shortGrass
    };
  }

  if (grassyBank && flowerPatchNoise > 0.72 && densityNoise > 0.58) {
    return {
      lowerStateId: variantNoise > 0.66
        ? worldOptions.decorationBlockStateIds.cornflower
        : variantNoise > 0.33
          ? worldOptions.decorationBlockStateIds.oxeyeDaisy
          : worldOptions.decorationBlockStateIds.azureBluet
    };
  }

  if (grassyBank && densityNoise > 0.88) {
    return {
      lowerStateId: worldOptions.decorationBlockStateIds.tallGrassLower,
      upperStateId: worldOptions.decorationBlockStateIds.tallGrassUpper
    };
  }

  if (grassyBank && densityNoise > 0.54) {
    return {
      lowerStateId: variantNoise > 0.48
        ? worldOptions.decorationBlockStateIds.fern
        : worldOptions.decorationBlockStateIds.shortGrass
    };
  }

  return null;
}

function placeDecorationFeature(chunk, localX, localZ, topY, decorationFeature, worldOptions) {
  if (!decorationFeature?.lowerStateId) {
    return false;
  }

  const lowerPosition = new Vec3(localX, topY + 1, localZ);
  const lowerStateId = chunk.getBlockStateId(lowerPosition);

  if (
    lowerStateId !== 0 &&
    !(decorationFeature.allowSubmerged && lowerStateId === worldOptions.terrainBlockStateIds.water)
  ) {
    return false;
  }

  if (decorationFeature.upperStateId) {
    const upperPosition = new Vec3(localX, topY + 2, localZ);
    const upperStateId = chunk.getBlockStateId(upperPosition);

    if (
      upperStateId !== 0 &&
      !(decorationFeature.allowSubmerged && upperStateId === worldOptions.terrainBlockStateIds.water)
    ) {
      return false;
    }
  }

  chunk.setBlockStateId(lowerPosition, decorationFeature.lowerStateId);

  if (decorationFeature.upperStateId) {
    chunk.setBlockStateId(new Vec3(localX, topY + 2, localZ), decorationFeature.upperStateId);
  }

  return true;
}

function applySurfaceDecorationsToChunk({
  chunk,
  chunkX,
  chunkZ,
  worldOptions,
  surfaceY,
  spawn,
  isNearSpawn,
  getColumnDescriptor,
  hashNoise2d,
  valueNoise2d,
  decorationSpawnClearRadius,
  safeSurfaceY
}) {
  for (let localX = 0; localX < 16; localX++) {
    for (let localZ = 0; localZ < 16; localZ++) {
      const worldX = (chunkX * 16) + localX;
      const worldZ = (chunkZ * 16) + localZ;

      if (isNearSpawn(spawn, worldX, worldZ, decorationSpawnClearRadius)) {
        continue;
      }

      const topY = getTopSolidY(chunk, localX, localZ);
      const topStateId = chunk.getBlockStateId(new Vec3(localX, topY, localZ));

      if (!isGroundDecorationBase(worldOptions, topStateId)) {
        continue;
      }

      const column = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
      const biomeProfile = column.biomeProfile;
      const climateDecorationFeature = getClimateDecorationFeature({
        column,
        surfaceY,
        worldOptions,
        topY,
        topStateId
      });
      const freshwaterBankDecorationFeature = getFreshwaterBankDecorationFeature({
        column,
        surfaceY,
        spawn,
        worldOptions,
        worldX,
        worldZ,
        topY,
        topStateId,
        hashNoise2d,
        valueNoise2d,
        getColumnDescriptor
      });
      const decorationFeature = climateDecorationFeature ?? freshwaterBankDecorationFeature ?? (
        biomeProfile.biomeModule?.getDecorationFeature
          ? biomeProfile.biomeModule.getDecorationFeature({
            column,
            surfaceY,
            spawn,
            worldOptions,
            worldX,
            worldZ,
            topY,
            topStateId,
            hashNoise2d,
            valueNoise2d,
            getColumnDescriptor
          })
          : (() => {
            const decorationStyle = biomeProfile.decorationStyle;
            const decorationStateId = getDecorationStateId(
              worldOptions,
              decorationStyle,
              worldX,
              worldZ,
              topY,
              topStateId,
              hashNoise2d,
              safeSurfaceY
            );

            return decorationStateId
              ? { lowerStateId: decorationStateId }
              : null;
          })()
      );

      if (!decorationFeature) {
        continue;
      }

      placeDecorationFeature(chunk, localX, localZ, topY, decorationFeature, worldOptions);
    }
  }
}

module.exports = {
  applySurfaceDecorationsToChunk,
  getTopSolidY
};
