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
    worldOptions.terrainBlockStateIds.sand,
    worldOptions.terrainBlockStateIds.gravel,
    worldOptions.terrainBlockStateIds.clay
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
      const decorationFeature = biomeProfile.biomeModule?.getDecorationFeature
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
        })();

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
