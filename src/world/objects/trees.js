const TREE_CELL_SIZE = 5;
const TREE_CANOPY_RADIUS = 3;
const TREE_SPAWN_CLEAR_RADIUS = 6;

function buildTreeFeature(worldOptions, treeType, worldX, worldZ, topY, seedA, seedB, hashNoise2d) {
  const heightNoise = hashNoise2d(seedA, seedB, worldOptions.seedHash + 29);

  if (treeType === 'oak_bushy') {
    return {
      canopyLayers: [
        { yOffset: 0, radius: 2 },
        { yOffset: 1, radius: 3 },
        { yOffset: 2, radius: 2 },
        { yOffset: 3, radius: 1 }
      ],
      canopyBaseOffset: 1,
      height: 5 + Math.floor(heightNoise * 2),
      leafBlockStateId: worldOptions.treeBlockStateIds.oakLeaves,
      logBlockStateId: worldOptions.treeBlockStateIds.oakLog,
      topLeafOffset: 4,
      type: treeType,
      worldX,
      worldZ,
      topY
    };
  }

  if (treeType === 'oak_tall') {
    return {
      canopyLayers: [
        { yOffset: 0, radius: 2 },
        { yOffset: 1, radius: 2 },
        { yOffset: 2, radius: 1 }
      ],
      canopyBaseOffset: 1,
      height: 6 + Math.floor(heightNoise * 3),
      leafBlockStateId: worldOptions.treeBlockStateIds.oakLeaves,
      logBlockStateId: worldOptions.treeBlockStateIds.oakLog,
      topLeafOffset: 3,
      type: treeType,
      worldX,
      worldZ,
      topY
    };
  }

  if (treeType === 'birch_tall') {
    return {
      canopyLayers: [
        { yOffset: 0, radius: 2 },
        { yOffset: 1, radius: 1 },
        { yOffset: 2, radius: 1 }
      ],
      canopyBaseOffset: 1,
      height: 6 + Math.floor(heightNoise * 3),
      leafBlockStateId: worldOptions.treeBlockStateIds.birchLeaves,
      logBlockStateId: worldOptions.treeBlockStateIds.birchLog,
      topLeafOffset: 3,
      type: treeType,
      worldX,
      worldZ,
      topY
    };
  }

  if (treeType === 'birch_old_growth') {
    return {
      canopyLayers: [
        { yOffset: 0, radius: 2 },
        { yOffset: 1, radius: 2 },
        { yOffset: 2, radius: 1 },
        { yOffset: 3, radius: 1 }
      ],
      canopyBaseOffset: 1,
      height: 10 + Math.floor(heightNoise * 5),
      leafBlockStateId: worldOptions.treeBlockStateIds.birchLeaves,
      logBlockStateId: worldOptions.treeBlockStateIds.birchLog,
      topLeafOffset: 4,
      type: treeType,
      worldX,
      worldZ,
      topY
    };
  }

  if (treeType === 'spruce_narrow') {
    return {
      canopyLayers: [
        { yOffset: 0, radius: 2 },
        { yOffset: 1, radius: 2 },
        { yOffset: 2, radius: 1 },
        { yOffset: 3, radius: 1 }
      ],
      canopyBaseOffset: 1,
      height: 7 + Math.floor(heightNoise * 3),
      leafBlockStateId: worldOptions.treeBlockStateIds.spruceLeaves,
      logBlockStateId: worldOptions.treeBlockStateIds.spruceLog,
      topLeafOffset: 4,
      type: treeType,
      worldX,
      worldZ,
      topY
    };
  }

  if (treeType === 'spruce_tall') {
    return {
      canopyLayers: [
        { yOffset: 0, radius: 2 },
        { yOffset: 1, radius: 2 },
        { yOffset: 2, radius: 2 },
        { yOffset: 3, radius: 1 },
        { yOffset: 4, radius: 1 }
      ],
      canopyBaseOffset: 2,
      height: 8 + Math.floor(heightNoise * 4),
      leafBlockStateId: worldOptions.treeBlockStateIds.spruceLeaves,
      logBlockStateId: worldOptions.treeBlockStateIds.spruceLog,
      topLeafOffset: 5,
      type: treeType,
      worldX,
      worldZ,
      topY
    };
  }

  if (treeType === 'pine_tall') {
    return {
      canopyLayers: [
        { yOffset: 0, radius: 3 },
        { yOffset: 1, radius: 2 },
        { yOffset: 2, radius: 2 },
        { yOffset: 3, radius: 1 },
        { yOffset: 4, radius: 1 }
      ],
      canopyBaseOffset: 2,
      height: 9 + Math.floor(heightNoise * 4),
      leafBlockStateId: worldOptions.treeBlockStateIds.spruceLeaves,
      logBlockStateId: worldOptions.treeBlockStateIds.spruceLog,
      topLeafOffset: 5,
      type: treeType,
      worldX,
      worldZ,
      topY
    };
  }

  if (treeType === 'oak_small') {
    return {
      canopyLayers: [
        { yOffset: 0, radius: 2 },
        { yOffset: 1, radius: 2 },
        { yOffset: 2, radius: 1 }
      ],
      canopyBaseOffset: 1,
      height: 4 + Math.floor(heightNoise * 2),
      leafBlockStateId: worldOptions.treeBlockStateIds.oakLeaves,
      logBlockStateId: worldOptions.treeBlockStateIds.oakLog,
      topLeafOffset: 3,
      type: treeType,
      worldX,
      worldZ,
      topY
    };
  }

  return {
    canopyLayers: [
      { yOffset: 0, radius: 2 },
      { yOffset: 1, radius: 1 },
      { yOffset: 2, radius: 1 }
    ],
    canopyBaseOffset: 1,
    height: 5 + Math.floor(heightNoise * 2),
    leafBlockStateId: worldOptions.treeBlockStateIds.birchLeaves,
    logBlockStateId: worldOptions.treeBlockStateIds.birchLog,
    topLeafOffset: 3,
    type: 'birch_small',
    worldX,
    worldZ,
    topY
  };
}

function resolveTreeType(treeStyle, selectorNoise) {
  if (treeStyle === 'plains') {
    return selectorNoise > 0.82 ? 'oak_bushy' : 'oak_small';
  }

  if (treeStyle === 'forest') {
    if (selectorNoise > 0.8) {
      return 'oak_tall';
    }

    if (selectorNoise > 0.45) {
      return 'oak_bushy';
    }

    return 'oak_small';
  }

  if (treeStyle === 'birch_forest') {
    return selectorNoise > 0.52 ? 'birch_tall' : 'birch_small';
  }

  if (treeStyle === 'stony_sparse') {
    return 'spruce_narrow';
  }

  return null;
}

function getTreeCandidate({
  worldOptions,
  surfaceY,
  spawn,
  cellX,
  cellZ,
  hashNoise2d,
  valueNoise2d,
  getColumnDescriptor,
  getSurfaceVariation,
  isNearSpawn
}) {
  const buildFeature = (treeType, worldX, worldZ, topY) =>
    buildTreeFeature(worldOptions, treeType, worldX, worldZ, topY, cellX, cellZ, hashNoise2d);
  const treeContext = {
    worldOptions,
    surfaceY,
    spawn,
    cellX,
    cellZ,
    hashNoise2d,
    valueNoise2d,
    getColumnDescriptor,
    getSurfaceVariation,
    isNearSpawn,
    buildTreeFeature: buildFeature
  };
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 11);
  const densityNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 37);
  const selectorNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 53);
  const localX = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 17) * (TREE_CELL_SIZE - 2));
  const localZ = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 23) * (TREE_CELL_SIZE - 2));
  const worldX = (cellX * TREE_CELL_SIZE) + localX;
  const worldZ = (cellZ * TREE_CELL_SIZE) + localZ;

  if (isNearSpawn(spawn, worldX, worldZ)) {
    return null;
  }

  const { biomeProfile, topY } = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);

  if (biomeProfile.biomeModule?.getTreeCandidate) {
    return biomeProfile.biomeModule.getTreeCandidate(treeContext);
  }

  const treeStyle = biomeProfile.treeStyle;

  if (!treeStyle) {
    return null;
  }

  const surfaceVariation = getSurfaceVariation(
    worldOptions,
    surfaceY,
    spawn,
    worldX,
    worldZ,
    treeStyle === 'stony_sparse' ? 1 : 2
  );
  const treeChance = treeStyle === 'plains'
    ? 0.1 + (densityNoise * 0.1)
    : treeStyle === 'forest'
      ? 0.28 + (densityNoise * 0.24)
      : treeStyle === 'birch_forest'
        ? 0.24 + (densityNoise * 0.18)
        : 0.08 + (densityNoise * 0.08);
  const maxSurfaceVariation = treeStyle === 'plains'
    ? 1
    : treeStyle === 'stony_sparse'
      ? 2
      : 3;

  if (candidateNoise > treeChance || surfaceVariation > maxSurfaceVariation) {
    return null;
  }

  const treeType = resolveTreeType(treeStyle, selectorNoise);

  if (!treeType) {
    return null;
  }

  return buildFeature(treeType, worldX, worldZ, topY);
}

function applyTreeToChunk({ chunk, chunkX, chunkZ, tree, setChunkBlock }) {
  if (!tree) {
    return;
  }

  for (let trunkY = tree.topY + 1; trunkY <= tree.topY + tree.height; trunkY++) {
    setChunkBlock(chunk, chunkX, chunkZ, tree.worldX, trunkY, tree.worldZ, tree.logBlockStateId);
  }

  const canopyBaseY = tree.topY + tree.height - tree.canopyLayers.length + (tree.canopyBaseOffset ?? 0);

  for (const layer of tree.canopyLayers) {
    const y = canopyBaseY + layer.yOffset;
    const radius = layer.radius;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.abs(dx) === radius && Math.abs(dz) === radius && radius > 1) {
          continue;
        }

        if (tree.type === 'spruce_narrow' && radius === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 1) {
          continue;
        }

        setChunkBlock(
          chunk,
          chunkX,
          chunkZ,
          tree.worldX + dx,
          y,
          tree.worldZ + dz,
          tree.leafBlockStateId,
          true
        );
      }
    }
  }

  setChunkBlock(
    chunk,
    chunkX,
    chunkZ,
    tree.worldX,
    canopyBaseY + tree.topLeafOffset,
    tree.worldZ,
    tree.leafBlockStateId,
    true
  );

  if (tree.beeNest) {
    setChunkBlock(
      chunk,
      chunkX,
      chunkZ,
      tree.worldX + tree.beeNest.dx,
      tree.beeNest.y,
      tree.worldZ + tree.beeNest.dz,
      tree.beeNest.stateId,
      true
    );
  }
}

function doesTreeOverlapPond(tree, pond) {
  const dx = tree.worldX - pond.centerX;
  const dz = tree.worldZ - pond.centerZ;
  const distance = Math.sqrt((dx * dx) + (dz * dz));
  return distance <= pond.radius + TREE_CANOPY_RADIUS;
}

function getTreeCellRangeForChunk(chunkX, chunkZ) {
  return {
    minCellX: Math.floor(((chunkX * 16) - TREE_CANOPY_RADIUS) / TREE_CELL_SIZE),
    maxCellX: Math.floor((((chunkX + 1) * 16) - 1 + TREE_CANOPY_RADIUS) / TREE_CELL_SIZE),
    minCellZ: Math.floor(((chunkZ * 16) - TREE_CANOPY_RADIUS) / TREE_CELL_SIZE),
    maxCellZ: Math.floor((((chunkZ + 1) * 16) - 1 + TREE_CANOPY_RADIUS) / TREE_CELL_SIZE)
  };
}

module.exports = {
  TREE_CANOPY_RADIUS,
  TREE_CELL_SIZE,
  TREE_SPAWN_CLEAR_RADIUS,
  applyTreeToChunk,
  buildTreeFeature,
  doesTreeOverlapPond,
  getTreeCandidate,
  getTreeCellRangeForChunk
};
