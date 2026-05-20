function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createSpawnHelpers({
  getBlockState,
  getBlockDefinition,
  minBuildY,
  maxBuildY,
  minX,
  maxX,
  minZ,
  maxZ,
  spawnReference
}) {
  function getBlockInfo(position) {
    const stateId = getBlockState(position);
    const block = getBlockDefinition(stateId);

    return {
      block,
      stateId
    };
  }

  function isPassableSpawnSpace(position) {
    const { stateId, block } = getBlockInfo(position);

    if (stateId === 0) {
      return true;
    }

    if (!block) {
      return false;
    }

    return block.transparent === true && block.boundingBox === 'empty';
  }

  function isUnsafeSupportBlock(position) {
    const { stateId, block } = getBlockInfo(position);
    const name = block?.name ?? '';

    if (stateId === 0 || !block) {
      return true;
    }

    if (block.boundingBox !== 'block') {
      return true;
    }

    if (
      name.includes('leaves') ||
      name.endsWith('_log') ||
      name.includes('mushroom_block') ||
      name === 'magma_block' ||
      name === 'ice' ||
      name === 'packed_ice' ||
      name === 'blue_ice' ||
      name === 'cactus'
    ) {
      return true;
    }

    return false;
  }

  function hasVerticalSpawnClearance(x, standingY, z) {
    for (let y = standingY; y <= standingY + 2; y++) {
      if (!isPassableSpawnSpace({ x, y, z })) {
        return false;
      }
    }

    return true;
  }

  function hasOpenSkyBuffer(x, standingY, z) {
    for (let y = standingY + 3; y <= Math.min(maxBuildY, standingY + 6); y++) {
      if (!isPassableSpawnSpace({ x, y, z })) {
        return false;
      }
    }

    return true;
  }

  function isNearTreeClutter(x, standingY, z) {
    for (let offsetZ = -2; offsetZ <= 2; offsetZ++) {
      for (let offsetX = -2; offsetX <= 2; offsetX++) {
        for (let offsetY = -1; offsetY <= 3; offsetY++) {
          const { block } = getBlockInfo({
            x: x + offsetX,
            y: standingY + offsetY,
            z: z + offsetZ
          });
          const name = block?.name ?? '';

          if (name.endsWith('_log') || name.includes('leaves')) {
            return true;
          }
        }
      }
    }

    return false;
  }

  function getLocalTerrainRelief(x, z) {
    const heights = [];

    for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        const standingY = findSafeStandingY(x + offsetX, z + offsetZ);

        if (standingY === null) {
          return Number.POSITIVE_INFINITY;
        }

        heights.push(standingY);
      }
    }

    const maxHeight = Math.max(...heights);
    const minHeight = Math.min(...heights);
    return maxHeight - minHeight;
  }

  function findSafeStandingY(x, z) {
    for (let blockY = maxBuildY - 2; blockY >= minBuildY; blockY--) {
      if (isUnsafeSupportBlock({ x, y: blockY, z })) {
        continue;
      }

      const standingY = blockY + 1;

      if (!hasVerticalSpawnClearance(x, standingY, z)) {
        continue;
      }

      if (!hasOpenSkyBuffer(x, standingY, z)) {
        continue;
      }

      return standingY;
    }

    return null;
  }

  function getSpawnSafetyScore(x, standingY, z, preferredX, preferredZ) {
    const relief = getLocalTerrainRelief(x, z);

    if (relief > 4) {
      return null;
    }

    if (isNearTreeClutter(x, standingY, z)) {
      return null;
    }

    const distanceScore = Math.abs(x - preferredX) + Math.abs(z - preferredZ);
    const reliefPenalty = relief * 8;
    const heightPenalty = Math.max(0, standingY - 140);
    return distanceScore + reliefPenalty + heightPenalty;
  }

  function getSafeSpawnPosition(preferredSpawn = spawnReference) {
    const preferredX = clamp(Math.floor(preferredSpawn?.x ?? spawnReference.x), minX, maxX);
    const preferredZ = clamp(Math.floor(preferredSpawn?.z ?? spawnReference.z), minZ, maxZ);
    let bestCandidate = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const standingY = findSafeStandingY(x, z);

        if (standingY === null) {
          continue;
        }

        const score = getSpawnSafetyScore(x, standingY, z, preferredX, preferredZ);

        if (!Number.isFinite(score) || score >= bestScore) {
          continue;
        }

        bestScore = score;
        bestCandidate = { x, y: standingY, z };
      }
    }

    if (bestCandidate) {
      return bestCandidate;
    }

    return {
      x: preferredX,
      y: clamp(Math.floor(preferredSpawn?.y ?? spawnReference.y), minBuildY + 1, maxBuildY - 2),
      z: preferredZ
    };
  }

  return {
    findSafeStandingY,
    getSafeSpawnPosition
  };
}

module.exports = {
  createSpawnHelpers
};
