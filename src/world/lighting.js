const Vec3 = require('vec3');

const LIGHT_NEIGHBOR_OFFSETS = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 }
];

function addStateRangeToSet(target, minStateId, maxStateId) {
  if (!Number.isInteger(minStateId) || !Number.isInteger(maxStateId)) {
    return;
  }

  for (let stateId = minStateId; stateId <= maxStateId; stateId++) {
    target.add(stateId);
  }
}

function addEmissionRangeToMap(target, minStateId, maxStateId, emitLight) {
  if (!Number.isInteger(minStateId) || !Number.isInteger(maxStateId) || !Number.isInteger(emitLight) || emitLight <= 0) {
    return;
  }

  for (let stateId = minStateId; stateId <= maxStateId; stateId++) {
    target.set(stateId, emitLight);
  }
}

function createLightingLookup(worldOptions) {
  if (worldOptions?._lightingLookup) {
    return worldOptions._lightingLookup;
  }

  const translucentStateIds = new Set();
  const emissiveStateIds = new Map();
  const decorationStateIds = Object.values(worldOptions?.decorationBlockStateIds ?? {}).filter(Number.isInteger);

  for (const stateId of decorationStateIds) {
    translucentStateIds.add(stateId);
  }

  const treeStateIds = Object.values(worldOptions?.treeBlockStateIds ?? {}).filter(Number.isInteger);
  for (const stateId of treeStateIds) {
    if (
      stateId === worldOptions?.treeBlockStateIds?.oakLeaves ||
      stateId === worldOptions?.treeBlockStateIds?.birchLeaves ||
      stateId === worldOptions?.treeBlockStateIds?.spruceLeaves ||
      stateId === worldOptions?.treeBlockStateIds?.jungleLeaves
    ) {
      translucentStateIds.add(stateId);
    }
  }

  const terrainBlockStateIds = worldOptions?.terrainBlockStateIds ?? {};
  if (Number.isInteger(terrainBlockStateIds.ice)) {
    translucentStateIds.add(terrainBlockStateIds.ice);
  }

  for (const range of worldOptions?.lightPassThroughStateRanges ?? []) {
    addStateRangeToSet(translucentStateIds, range.minStateId, range.maxStateId);
  }

  for (const range of worldOptions?.lightEmissionStateRanges ?? []) {
    addEmissionRangeToMap(emissiveStateIds, range.minStateId, range.maxStateId, range.emitLight);
  }

  const lookup = {
    emissiveStateIds,
    translucentStateIds
  };

  worldOptions._lightingLookup = lookup;
  return lookup;
}

function getSkyLightAbsorption(stateId, worldOptions, translucentStateIds) {
  if (stateId === 0) {
    return 0;
  }

  const waterMin = worldOptions?.terrainBlockStateIds?.water;
  const waterMax = worldOptions?.terrainBlockStateIds?.waterMax ?? waterMin;

  if (Number.isInteger(waterMin) && stateId >= waterMin && stateId <= waterMax) {
    return 1;
  }

  if (translucentStateIds.has(stateId)) {
    return 1;
  }

  return 15;
}

function getBlockLightEmission(stateId, emissiveStateIds) {
  return emissiveStateIds.get(stateId) ?? 0;
}

function getWorldPosition(chunkX, localX, y, chunkZ, localZ) {
  return {
    x: (chunkX * 16) + localX,
    y,
    z: (chunkZ * 16) + localZ
  };
}

function toChunkAndLocal(worldX, worldZ) {
  const chunkX = Math.floor(worldX / 16);
  const chunkZ = Math.floor(worldZ / 16);

  return {
    chunkX,
    chunkZ,
    localX: worldX - (chunkX * 16),
    localZ: worldZ - (chunkZ * 16)
  };
}

function getBlockStateIdAtWorld(getChunkAt, worldX, y, worldZ) {
  const coordinates = toChunkAndLocal(worldX, worldZ);
  const chunk = getChunkAt(coordinates.chunkX, coordinates.chunkZ);

  if (!chunk) {
    return 0;
  }

  return chunk.getBlockStateId(new Vec3(coordinates.localX, y, coordinates.localZ));
}

function getSkyLightAtWorld(getChunkAt, worldX, y, worldZ) {
  const coordinates = toChunkAndLocal(worldX, worldZ);
  const chunk = getChunkAt(coordinates.chunkX, coordinates.chunkZ);

  if (!chunk) {
    return 0;
  }

  return chunk.getSkyLight(new Vec3(coordinates.localX, y, coordinates.localZ));
}

function setTargetChunkSkyLight(targetChunk, targetChunkX, targetChunkZ, worldX, y, worldZ, skyLight) {
  const localX = worldX - (targetChunkX * 16);
  const localZ = worldZ - (targetChunkZ * 16);
  targetChunk.setSkyLight(new Vec3(localX, y, localZ), skyLight);
}

function setTargetChunkBlockLight(targetChunk, targetChunkX, targetChunkZ, worldX, y, worldZ, blockLight) {
  const localX = worldX - (targetChunkX * 16);
  const localZ = worldZ - (targetChunkZ * 16);
  targetChunk.setBlockLight(new Vec3(localX, y, localZ), blockLight);
}

function bakeSkyLightForChunk(targetChunk, targetChunkX, targetChunkZ, worldOptions, translucentStateIds) {
  const minY = targetChunk.minY;
  const maxY = targetChunk.minY + targetChunk.worldHeight - 1;

  for (let localX = 0; localX < 16; localX++) {
    for (let localZ = 0; localZ < 16; localZ++) {
      let skyLight = 15;

      for (let y = maxY; y >= minY; y--) {
        const position = new Vec3(localX, y, localZ);
        const stateId = targetChunk.getBlockStateId(position);
        const absorption = getSkyLightAbsorption(stateId, worldOptions, translucentStateIds);

        if (absorption >= 15) {
          targetChunk.setSkyLight(position, 0);
          targetChunk.setBlockLight(position, 0);
          skyLight = 0;
          continue;
        }

        targetChunk.setSkyLight(position, skyLight);
        targetChunk.setBlockLight(position, 0);
        skyLight = Math.max(0, skyLight - absorption);
      }
    }
  }
}

function softenSkyLightForChunk(targetChunk, targetChunkX, targetChunkZ, worldOptions, getChunkAt, lightingLookup, passes = 2) {
  const minY = worldOptions.minWorldY;
  const maxY = worldOptions.maxWorldY;
  const minWorldX = (targetChunkX - 1) * 16;
  const maxWorldX = ((targetChunkX + 2) * 16) - 1;
  const minWorldZ = (targetChunkZ - 1) * 16;
  const maxWorldZ = ((targetChunkZ + 2) * 16) - 1;

  for (let pass = 0; pass < passes; pass++) {
    const updates = [];

    for (let localX = 0; localX < 16; localX++) {
      for (let localZ = 0; localZ < 16; localZ++) {
        for (let y = minY; y <= maxY; y++) {
          const worldPosition = getWorldPosition(targetChunkX, localX, y, targetChunkZ, localZ);
          const stateId = targetChunk.getBlockStateId(new Vec3(localX, y, localZ));
          const absorption = getSkyLightAbsorption(stateId, worldOptions, lightingLookup.translucentStateIds);

          if (absorption >= 15) {
            continue;
          }

          const currentSkyLight = targetChunk.getSkyLight(new Vec3(localX, y, localZ));
          let brightestNeighbor = currentSkyLight;

          for (const offset of LIGHT_NEIGHBOR_OFFSETS) {
            const neighborX = worldPosition.x + offset.x;
            const neighborY = y + offset.y;
            const neighborZ = worldPosition.z + offset.z;

            if (
              neighborY < minY ||
              neighborY > maxY ||
              neighborX < minWorldX ||
              neighborX > maxWorldX ||
              neighborZ < minWorldZ ||
              neighborZ > maxWorldZ
            ) {
              continue;
            }

            const neighborSkyLight = getSkyLightAtWorld(getChunkAt, neighborX, neighborY, neighborZ);
            brightestNeighbor = Math.max(brightestNeighbor, Math.max(0, neighborSkyLight - 1));
          }

          if (brightestNeighbor > currentSkyLight) {
            updates.push({
              skyLight: brightestNeighbor,
              worldX: worldPosition.x,
              worldY: y,
              worldZ: worldPosition.z
            });
          }
        }
      }
    }

    if (updates.length === 0) {
      break;
    }

    for (const update of updates) {
      setTargetChunkSkyLight(
        targetChunk,
        targetChunkX,
        targetChunkZ,
        update.worldX,
        update.worldY,
        update.worldZ,
        update.skyLight
      );
    }
  }
}

function enqueueLight(queue, lightLevels, worldX, y, worldZ, lightLevel) {
  const key = `${worldX},${y},${worldZ}`;
  const currentLight = lightLevels.get(key) ?? -1;

  if (lightLevel <= currentLight) {
    return;
  }

  lightLevels.set(key, lightLevel);
  queue.push({ x: worldX, y, z: worldZ, lightLevel });
}

function propagateBlockLightForChunk(targetChunk, targetChunkX, targetChunkZ, worldOptions, getChunkAt, lightingLookup) {
  const minY = worldOptions.minWorldY;
  const maxY = worldOptions.maxWorldY;
  const minWorldX = (targetChunkX - 1) * 16;
  const maxWorldX = ((targetChunkX + 2) * 16) - 1;
  const minWorldZ = (targetChunkZ - 1) * 16;
  const maxWorldZ = ((targetChunkZ + 2) * 16) - 1;
  const queue = [];
  const lightLevels = new Map();

  for (let sampleChunkZ = targetChunkZ - 1; sampleChunkZ <= targetChunkZ + 1; sampleChunkZ++) {
    for (let sampleChunkX = targetChunkX - 1; sampleChunkX <= targetChunkX + 1; sampleChunkX++) {
      const sampleChunk = getChunkAt(sampleChunkX, sampleChunkZ);

      if (!sampleChunk) {
        continue;
      }

      for (let localX = 0; localX < 16; localX++) {
        for (let localZ = 0; localZ < 16; localZ++) {
          for (let y = minY; y <= maxY; y++) {
            const stateId = sampleChunk.getBlockStateId(new Vec3(localX, y, localZ));
            const emitLight = getBlockLightEmission(stateId, lightingLookup.emissiveStateIds);

            if (emitLight <= 0) {
              continue;
            }

            const worldPosition = getWorldPosition(sampleChunkX, localX, y, sampleChunkZ, localZ);
            enqueueLight(queue, lightLevels, worldPosition.x, worldPosition.y, worldPosition.z, emitLight);
          }
        }
      }
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();

    if (current.lightLevel <= 1) {
      continue;
    }

    for (const offset of LIGHT_NEIGHBOR_OFFSETS) {
      const neighborX = current.x + offset.x;
      const neighborY = current.y + offset.y;
      const neighborZ = current.z + offset.z;

      if (
        neighborY < minY ||
        neighborY > maxY ||
        neighborX < minWorldX ||
        neighborX > maxWorldX ||
        neighborZ < minWorldZ ||
        neighborZ > maxWorldZ
      ) {
        continue;
      }

      const neighborStateId = getBlockStateIdAtWorld(getChunkAt, neighborX, neighborY, neighborZ);
      const absorption = getSkyLightAbsorption(neighborStateId, worldOptions, lightingLookup.translucentStateIds);

      if (absorption >= 15) {
        continue;
      }

      enqueueLight(queue, lightLevels, neighborX, neighborY, neighborZ, current.lightLevel - 1);
    }
  }

  for (let localX = 0; localX < 16; localX++) {
    for (let localZ = 0; localZ < 16; localZ++) {
      for (let y = minY; y <= maxY; y++) {
        const worldPosition = getWorldPosition(targetChunkX, localX, y, targetChunkZ, localZ);
        const key = `${worldPosition.x},${worldPosition.y},${worldPosition.z}`;
        const blockLight = lightLevels.get(key) ?? 0;
        setTargetChunkBlockLight(targetChunk, targetChunkX, targetChunkZ, worldPosition.x, y, worldPosition.z, blockLight);
      }
    }
  }
}

function bakeChunkLighting(chunk, worldOptions) {
  const lightingLookup = createLightingLookup(worldOptions);
  bakeSkyLightForChunk(chunk, 0, 0, worldOptions, lightingLookup.translucentStateIds);
  softenSkyLightForChunk(chunk, 0, 0, worldOptions, () => chunk, lightingLookup);
  propagateBlockLightForChunk(chunk, 0, 0, worldOptions, () => chunk, lightingLookup);
}

function bakeChunkLightingRegion(chunkX, chunkZ, worldOptions, getChunkAt) {
  const targetChunk = getChunkAt(chunkX, chunkZ);

  if (!targetChunk) {
    return false;
  }

  const lightingLookup = createLightingLookup(worldOptions);
  bakeSkyLightForChunk(targetChunk, chunkX, chunkZ, worldOptions, lightingLookup.translucentStateIds);
  softenSkyLightForChunk(targetChunk, chunkX, chunkZ, worldOptions, getChunkAt, lightingLookup);
  propagateBlockLightForChunk(targetChunk, chunkX, chunkZ, worldOptions, getChunkAt, lightingLookup);
  return true;
}

module.exports = {
  bakeChunkLighting,
  bakeChunkLightingRegion
};
