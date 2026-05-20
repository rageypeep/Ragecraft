const Vec3 = require('vec3');

const POND_CELL_SIZE = 18;
const POND_MAX_RADIUS = 5;
const POND_SHORE_WIDTH = 2;
const POND_SHELF_WIDTH = 1.25;
const POND_MAX_TERRAIN_DELTA = 1;
const POND_MIN_FLOOR_THICKNESS = 12;

function getPondCandidate({
  worldOptions,
  surfaceY,
  spawn,
  cellX,
  cellZ,
  hashNoise2d,
  getColumnDescriptor,
  isNearSpawn,
  shouldCarveCave,
  waterSpawnClearRadius,
  caveMinSurfaceRoof
}) {
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 211);
  const centerX = (cellX * POND_CELL_SIZE) + 3 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 223) * 12);
  const centerZ = (cellZ * POND_CELL_SIZE) + 3 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 227) * 12);

  if (candidateNoise > 0.22 || isNearSpawn(spawn, centerX, centerZ, waterSpawnClearRadius)) {
    return null;
  }

  const centerColumn = getColumnDescriptor(worldOptions, surfaceY, spawn, centerX, centerZ);
  const waterLevel = surfaceY - 1;

  if (
    centerColumn.waterTopY !== null ||
    ['river', 'lake', 'ocean', 'warm_ocean', 'lukewarm_ocean', 'cold_ocean', 'frozen_ocean'].includes(
      centerColumn.biomeProfile?.biomeKey
    )
  ) {
    return null;
  }

  if (centerColumn.topY > waterLevel + 2) {
    return null;
  }

  const radius = 2 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 229) * (POND_MAX_RADIUS - 1));
  const depth = 2 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 233) * 3);
  const shelfRadius = Math.max(1.5, radius - POND_SHELF_WIDTH);
  const outerRadius = radius + POND_SHORE_WIDTH;
  let minTopY = Number.POSITIVE_INFINITY;
  let maxTopY = Number.NEGATIVE_INFINITY;

  for (let worldX = centerX - outerRadius - 1; worldX <= centerX + outerRadius + 1; worldX++) {
    for (let worldZ = centerZ - outerRadius - 1; worldZ <= centerZ + outerRadius + 1; worldZ++) {
      const dx = worldX - centerX;
      const dz = worldZ - centerZ;
      const distance = Math.sqrt((dx * dx) + (dz * dz));

      if (distance > outerRadius + 0.25) {
        continue;
      }

      const sampleColumn = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
      if (sampleColumn.waterTopY !== null) {
        return null;
      }
      minTopY = Math.min(minTopY, sampleColumn.topY);
      maxTopY = Math.max(maxTopY, sampleColumn.topY);

      if (distance <= shelfRadius && sampleColumn.topY < waterLevel - depth) {
        return null;
      }

      if (distance > shelfRadius && distance <= radius && sampleColumn.topY < waterLevel - 1) {
        return null;
      }

      if (distance > radius && distance <= outerRadius && sampleColumn.topY < waterLevel + 1) {
        return null;
      }
    }
  }

  if ((maxTopY - minTopY) > POND_MAX_TERRAIN_DELTA) {
    return null;
  }

  const candidate = {
    centerX,
    centerZ,
    depth,
    radius,
    shoreBlockStateId: centerColumn.biomeProfile.shoreBlockStateId,
    waterLevel
  };

  if (
    pondCandidateHasNearbyCaveRisk(
      worldOptions,
      surfaceY,
      spawn,
      candidate,
      getColumnDescriptor,
      shouldCarveCave,
      caveMinSurfaceRoof
    )
  ) {
    return null;
  }

  return candidate;
}

function pondCandidateHasNearbyCaveRisk(
  worldOptions,
  surfaceY,
  spawn,
  pond,
  getColumnDescriptor,
  shouldCarveCave,
  caveMinSurfaceRoof
) {
  const outerRadius = pond.radius + POND_SHORE_WIDTH + 1;
  const minProbeY = pond.waterLevel - (pond.depth + 10);

  for (let worldX = pond.centerX - outerRadius; worldX <= pond.centerX + outerRadius; worldX++) {
    for (let worldZ = pond.centerZ - outerRadius; worldZ <= pond.centerZ + outerRadius; worldZ++) {
      const dx = worldX - pond.centerX;
      const dz = worldZ - pond.centerZ;
      const distance = Math.sqrt((dx * dx) + (dz * dz));

      if (distance > outerRadius + 0.25) {
        continue;
      }

      const column = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
      const topProbeY = Math.min(column.topY - caveMinSurfaceRoof, pond.waterLevel - 2);

      if (topProbeY <= minProbeY) {
        continue;
      }

      for (let worldY = topProbeY; worldY >= minProbeY; worldY--) {
        if (shouldCarveCave(worldOptions, spawn, column, worldX, worldY, worldZ)) {
          return true;
        }
      }
    }
  }

  return false;
}

function shapeColumnTop(chunk, localX, localZ, targetTopY, stateId, getTopSolidY) {
  const currentTopY = getTopSolidY(chunk, localX, localZ);
  const clampedTargetTopY = Math.min(currentTopY, targetTopY);

  if (currentTopY > clampedTargetTopY) {
    for (let y = currentTopY; y > clampedTargetTopY; y--) {
      chunk.setBlockStateId(new Vec3(localX, y, localZ), 0);
    }
  }

  chunk.setBlockStateId(new Vec3(localX, clampedTargetTopY, localZ), stateId);
  return clampedTargetTopY;
}

function reinforcePondFloor(chunk, localX, localZ, floorY, supportStateId) {
  for (let y = floorY - 1; y >= floorY - POND_MIN_FLOOR_THICKNESS; y--) {
    if (y < chunk.minY) {
      break;
    }

    if (chunk.getBlockStateId(new Vec3(localX, y, localZ)) === 0) {
      chunk.setBlockStateId(new Vec3(localX, y, localZ), supportStateId);
    }
  }
}

function isWithinChunk(worldX, worldZ, chunkX, chunkZ) {
  return (
    worldX >= chunkX * 16 &&
    worldX < ((chunkX + 1) * 16) &&
    worldZ >= chunkZ * 16 &&
    worldZ < ((chunkZ + 1) * 16)
  );
}

function getChunkStateId(chunk, chunkX, chunkZ, worldX, worldY, worldZ) {
  if (!isWithinChunk(worldX, worldZ, chunkX, chunkZ) || worldY < chunk.minY || worldY >= chunk.minY + chunk.worldHeight) {
    return null;
  }

  return chunk.getBlockStateId(new Vec3(worldX - (chunkX * 16), worldY, worldZ - (chunkZ * 16)));
}

function sealPondEdges(chunk, chunkX, chunkZ, pond, supportStateId, waterStateId) {
  const sealRadius = pond.radius + POND_SHORE_WIDTH + 1;
  const minSealY = pond.waterLevel - Math.max(pond.depth + 3, 5);

  for (let worldX = pond.centerX - sealRadius; worldX <= pond.centerX + sealRadius; worldX++) {
    for (let worldZ = pond.centerZ - sealRadius; worldZ <= pond.centerZ + sealRadius; worldZ++) {
      if (!isWithinChunk(worldX, worldZ, chunkX, chunkZ)) {
        continue;
      }

      const dx = worldX - pond.centerX;
      const dz = worldZ - pond.centerZ;
      const distance = Math.sqrt((dx * dx) + (dz * dz));

      if (distance > sealRadius + 0.25) {
        continue;
      }

      const localX = worldX - (chunkX * 16);
      const localZ = worldZ - (chunkZ * 16);

      for (let y = pond.waterLevel - 1; y >= minSealY; y--) {
        if (y < chunk.minY) {
          break;
        }

        const position = new Vec3(localX, y, localZ);
        const stateId = chunk.getBlockStateId(position);

        if (stateId !== 0) {
          continue;
        }

        const adjacentToWater =
          getChunkStateId(chunk, chunkX, chunkZ, worldX + 1, y, worldZ) === waterStateId ||
          getChunkStateId(chunk, chunkX, chunkZ, worldX - 1, y, worldZ) === waterStateId ||
          getChunkStateId(chunk, chunkX, chunkZ, worldX, y, worldZ + 1) === waterStateId ||
          getChunkStateId(chunk, chunkX, chunkZ, worldX, y, worldZ - 1) === waterStateId ||
          getChunkStateId(chunk, chunkX, chunkZ, worldX, y + 1, worldZ) === waterStateId;

        if (adjacentToWater) {
          chunk.setBlockStateId(position, supportStateId);
        }
      }
    }
  }
}

function applyPondToChunk({ chunk, chunkX, chunkZ, pond, worldOptions, getTopSolidY }) {
  if (!pond) {
    return;
  }

  const outerRadius = pond.radius + POND_SHORE_WIDTH;
  const bankTopY = pond.waterLevel + 1;

  for (let worldX = pond.centerX - outerRadius; worldX <= pond.centerX + outerRadius; worldX++) {
    for (let worldZ = pond.centerZ - outerRadius; worldZ <= pond.centerZ + outerRadius; worldZ++) {
      if (
        worldX < chunkX * 16 ||
        worldX >= ((chunkX + 1) * 16) ||
        worldZ < chunkZ * 16 ||
        worldZ >= ((chunkZ + 1) * 16)
      ) {
        continue;
      }

      const dx = worldX - pond.centerX;
      const dz = worldZ - pond.centerZ;
      const distance = Math.sqrt((dx * dx) + (dz * dz));
      const localX = worldX - (chunkX * 16);
      const localZ = worldZ - (chunkZ * 16);
      const shelfRadius = Math.max(1.5, pond.radius - POND_SHELF_WIDTH);

      if (distance <= shelfRadius) {
        const normalizedDistance = distance / shelfRadius;
        const bowlDepth = Math.max(2, Math.round((1 - normalizedDistance) * pond.depth) + 1);
        const floorY = pond.waterLevel - bowlDepth;
        const actualFloorY = shapeColumnTop(chunk, localX, localZ, floorY, pond.shoreBlockStateId, getTopSolidY);
        reinforcePondFloor(chunk, localX, localZ, actualFloorY, worldOptions.foundationBlockStateId);
        for (let y = actualFloorY + 1; y <= pond.waterLevel; y++) {
          chunk.setBlockStateId(new Vec3(localX, y, localZ), worldOptions.terrainBlockStateIds.water);
        }
        continue;
      }

      if (distance <= pond.radius) {
        const shelfFloorY = pond.waterLevel - 1;
        const actualShelfFloorY = shapeColumnTop(chunk, localX, localZ, shelfFloorY, pond.shoreBlockStateId, getTopSolidY);
        reinforcePondFloor(chunk, localX, localZ, actualShelfFloorY, worldOptions.foundationBlockStateId);
        for (let y = actualShelfFloorY + 1; y <= pond.waterLevel; y++) {
          chunk.setBlockStateId(new Vec3(localX, y, localZ), worldOptions.terrainBlockStateIds.water);
        }
        continue;
      }

      if (distance <= outerRadius) {
        shapeColumnTop(chunk, localX, localZ, bankTopY, pond.shoreBlockStateId, getTopSolidY);
      }
    }
  }

  sealPondEdges(
    chunk,
    chunkX,
    chunkZ,
    pond,
    worldOptions.foundationBlockStateId,
    worldOptions.terrainBlockStateIds.water
  );
}

function isBelowPondFootprint(worldX, worldY, worldZ, ponds = []) {
  for (const pond of ponds) {
    const dx = worldX - pond.centerX;
    const dz = worldZ - pond.centerZ;
    const distance = Math.sqrt((dx * dx) + (dz * dz));

    if (distance > pond.radius + POND_SHORE_WIDTH + 1) {
      continue;
    }

    if (worldY <= pond.waterLevel - 1) {
      return true;
    }
  }

  return false;
}

function getPondCellRangeForChunk(chunkX, chunkZ) {
  return {
    minCellX: Math.floor(((chunkX * 16) - POND_MAX_RADIUS - 1) / POND_CELL_SIZE),
    maxCellX: Math.floor((((chunkX + 1) * 16) - 1 + POND_MAX_RADIUS + 1) / POND_CELL_SIZE),
    minCellZ: Math.floor(((chunkZ * 16) - POND_MAX_RADIUS - 1) / POND_CELL_SIZE),
    maxCellZ: Math.floor((((chunkZ + 1) * 16) - 1 + POND_MAX_RADIUS + 1) / POND_CELL_SIZE)
  };
}

module.exports = {
  POND_CELL_SIZE,
  POND_MAX_RADIUS,
  POND_MAX_TERRAIN_DELTA,
  POND_MIN_FLOOR_THICKNESS,
  POND_SHELF_WIDTH,
  POND_SHORE_WIDTH,
  applyPondToChunk,
  getPondCandidate,
  getPondCellRangeForChunk,
  isBelowPondFootprint
};
