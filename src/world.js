const Chunk = require('prismarine-chunk')('1.21.11');
const { SmartBuffer } = require('smart-buffer');
const Vec3 = require('vec3');

const HEIGHTMAP_TYPES = [
  'world_surface_wg',
  'world_surface',
  'ocean_floor_wg',
  'ocean_floor',
  'motion_blocking',
  'motion_blocking_no_leaves'
];

const SAFE_SURFACE_Y = 95;
const BUILD_HEIGHT = 32;
const TREE_CELL_SIZE = 7;
const TREE_CANOPY_RADIUS = 2;
const TREE_SPAWN_CLEAR_RADIUS = 10;
const CAVE_SPAWN_CLEAR_RADIUS = 18;
const WATER_SPAWN_CLEAR_RADIUS = 16;
const DECORATION_SPAWN_CLEAR_RADIUS = 8;
const POND_CELL_SIZE = 18;
const POND_MAX_RADIUS = 5;
const POND_SHORE_WIDTH = 2;
const POND_SHELF_WIDTH = 1.25;
const POND_MAX_TERRAIN_DELTA = 1;
const DEFAULT_WORLD_OPTIONS = {
  biome: 'plains',
  mixedBiomes: true,
  seed: 'ragecraft',
  chunkRadius: 2,
  streamRadius: null,
  foundationBlock: 'stone',
  soilBlock: 'dirt',
  surfaceBlock: 'grass_block',
  terrainAmplitude: 4,
  terrainThickness: 12
};
const FACE_OFFSETS = {
  0: { x: 0, y: -1, z: 0 },
  1: { x: 0, y: 1, z: 0 },
  2: { x: 0, y: 0, z: -1 },
  3: { x: 0, y: 0, z: 1 },
  4: { x: -1, y: 0, z: 0 },
  5: { x: 1, y: 0, z: 0 }
};

function normalizePosition(position) {
  if (!position) {
    return null;
  }

  return {
    x: Math.floor(position.x),
    y: Math.floor(position.y),
    z: Math.floor(position.z)
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function lerp(start, end, amount) {
  return start + ((end - start) * amount);
}

function smoothstep(value) {
  return value * value * (3 - (2 * value));
}

function getSpawnChunk(spawn) {
  return {
    x: Math.floor(spawn.x / 16),
    z: Math.floor(spawn.z / 16)
  };
}

function getSurfaceY(spawnY) {
  const probeChunk = new Chunk();
  const minSurfaceY = probeChunk.minY + 1;
  const maxSurfaceY = probeChunk.minY + probeChunk.worldHeight - 1;
  const requestedSurfaceY = Math.floor(spawnY) - 1;
  return clamp(Math.min(requestedSurfaceY, SAFE_SURFACE_Y), minSurfaceY, maxSurfaceY);
}

function resolveConfiguredBlockStateId(mcData, blockName, fallbackBlockName) {
  const configuredBlock = mcData.blocksByName[blockName];

  if (configuredBlock) {
    return configuredBlock.defaultState;
  }

  return mcData.blocksByName[fallbackBlockName].defaultState;
}

function resolveBiomeId(mcData, names, fallbackId) {
  for (const name of names) {
    const biome = mcData.biomesByName[name];

    if (biome) {
      return biome.id;
    }
  }

  return fallbackId;
}

function hashNoise2d(x, z, seed = 0) {
  const value = Math.sin((x * 12.9898) + (z * 78.233) + (seed * 37.719)) * 43758.5453123;
  return value - Math.floor(value);
}

function valueNoise2d(x, z, seed = 0, frequency = 1) {
  const scaledX = x * frequency;
  const scaledZ = z * frequency;
  const baseX = Math.floor(scaledX);
  const baseZ = Math.floor(scaledZ);
  const fracX = smoothstep(scaledX - baseX);
  const fracZ = smoothstep(scaledZ - baseZ);
  const topLeft = hashNoise2d(baseX, baseZ, seed);
  const topRight = hashNoise2d(baseX + 1, baseZ, seed);
  const bottomLeft = hashNoise2d(baseX, baseZ + 1, seed);
  const bottomRight = hashNoise2d(baseX + 1, baseZ + 1, seed);
  const top = lerp(topLeft, topRight, fracX);
  const bottom = lerp(bottomLeft, bottomRight, fracX);

  return lerp(top, bottom, fracZ);
}

function signedValueNoise2d(x, z, seed = 0, frequency = 1) {
  return (valueNoise2d(x, z, seed, frequency) * 2) - 1;
}

function fbmNoise2d(x, z, seed = 0, options = {}) {
  const octaves = options.octaves ?? 4;
  const persistence = options.persistence ?? 0.5;
  const lacunarity = options.lacunarity ?? 2;
  const frequency = options.frequency ?? 1;
  let amplitude = 1;
  let currentFrequency = frequency;
  let total = 0;
  let weight = 0;

  for (let octave = 0; octave < octaves; octave++) {
    total += signedValueNoise2d(x, z, seed + (octave * 101), currentFrequency) * amplitude;
    weight += amplitude;
    amplitude *= persistence;
    currentFrequency *= lacunarity;
  }

  return weight > 0 ? total / weight : 0;
}

function ridgeNoise2d(x, z, seed = 0, options = {}) {
  const base = fbmNoise2d(x, z, seed, options);
  return 1 - Math.abs(base);
}

function hashStringSeed(seed) {
  const normalizedSeed = `${seed ?? DEFAULT_WORLD_OPTIONS.seed}`;
  let hash = 2166136261;

  for (let index = 0; index < normalizedSeed.length; index++) {
    hash ^= normalizedSeed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function isNearSpawn(spawn, x, z, radius = TREE_SPAWN_CLEAR_RADIUS) {
  return Math.abs(x - spawn.x) <= radius && Math.abs(z - spawn.z) <= radius;
}

function resolveWorldOptions(mcData, config = {}) {
  const worldConfig = {
    ...DEFAULT_WORLD_OPTIONS,
    ...(config.world ?? {})
  };
  const configuredStreamRadius = worldConfig.streamRadius ?? config.viewDistance ?? DEFAULT_WORLD_OPTIONS.chunkRadius;
  const fallbackBiomeId = mcData.biomesByName[worldConfig.biome]?.id ?? mcData.biomesByName.plains.id;
  const configuredFoundationUsesDefault = worldConfig.foundationBlock === DEFAULT_WORLD_OPTIONS.foundationBlock;
  const configuredSurfaceUsesDefault = worldConfig.surfaceBlock === DEFAULT_WORLD_OPTIONS.surfaceBlock;
  const configuredSoilUsesDefault = worldConfig.soilBlock === DEFAULT_WORLD_OPTIONS.soilBlock;
  const useBiomeSurfacePalettes = configuredSurfaceUsesDefault && configuredSoilUsesDefault;
  const useNaturalUndergroundGeneration = configuredFoundationUsesDefault;

  return {
    biomeId: fallbackBiomeId,
    biomeName: worldConfig.biome,
    mixedBiomes: worldConfig.mixedBiomes !== false,
    seed: `${worldConfig.seed ?? DEFAULT_WORLD_OPTIONS.seed}`,
    seedHash: hashStringSeed(worldConfig.seed ?? DEFAULT_WORLD_OPTIONS.seed),
    chunkRadius: Math.max(1, worldConfig.chunkRadius),
    streamRadius: Math.max(1, configuredStreamRadius),
    biomeIds: {
      plains: resolveBiomeId(mcData, ['plains'], fallbackBiomeId),
      forest: resolveBiomeId(mcData, ['forest'], fallbackBiomeId),
      birchForest: resolveBiomeId(mcData, ['birch_forest', 'old_growth_birch_forest'], fallbackBiomeId),
      stony: resolveBiomeId(mcData, ['windswept_hills', 'stony_peaks', 'stony_shore'], fallbackBiomeId)
    },
    foundationBlockStateId: resolveConfiguredBlockStateId(
      mcData,
      worldConfig.foundationBlock,
      DEFAULT_WORLD_OPTIONS.foundationBlock
    ),
    soilBlockStateId: resolveConfiguredBlockStateId(
      mcData,
      worldConfig.soilBlock,
      DEFAULT_WORLD_OPTIONS.soilBlock
    ),
    surfaceBlockStateId: resolveConfiguredBlockStateId(
      mcData,
      worldConfig.surfaceBlock,
      DEFAULT_WORLD_OPTIONS.surfaceBlock
    ),
    treeBlockStateIds: {
      oakLog: resolveConfiguredBlockStateId(mcData, 'oak_log', 'stone'),
      oakLeaves: resolveConfiguredBlockStateId(mcData, 'oak_leaves', 'grass_block'),
      birchLog: resolveConfiguredBlockStateId(mcData, 'birch_log', 'stone'),
      birchLeaves: resolveConfiguredBlockStateId(mcData, 'birch_leaves', 'grass_block')
    },
    decorationBlockStateIds: {
      shortGrass: resolveConfiguredBlockStateId(mcData, 'short_grass', 'air'),
      fern: resolveConfiguredBlockStateId(mcData, 'fern', 'air'),
      dandelion: resolveConfiguredBlockStateId(mcData, 'dandelion', 'air'),
      poppy: resolveConfiguredBlockStateId(mcData, 'poppy', 'air'),
      brownMushroom: resolveConfiguredBlockStateId(mcData, 'brown_mushroom', 'air'),
      redMushroom: resolveConfiguredBlockStateId(mcData, 'red_mushroom', 'air')
    },
    terrainBlockStateIds: {
      andesite: resolveConfiguredBlockStateId(mcData, 'andesite', worldConfig.foundationBlock),
      coalOre: resolveConfiguredBlockStateId(mcData, 'coal_ore', worldConfig.foundationBlock),
      copperOre: resolveConfiguredBlockStateId(mcData, 'copper_ore', worldConfig.foundationBlock),
      diorite: resolveConfiguredBlockStateId(mcData, 'diorite', worldConfig.foundationBlock),
      granite: resolveConfiguredBlockStateId(mcData, 'granite', worldConfig.foundationBlock),
      gravel: resolveConfiguredBlockStateId(mcData, 'gravel', worldConfig.foundationBlock),
      ironOre: resolveConfiguredBlockStateId(mcData, 'iron_ore', worldConfig.foundationBlock),
      podzol: resolveConfiguredBlockStateId(mcData, 'podzol', worldConfig.surfaceBlock),
      rootedDirt: resolveConfiguredBlockStateId(mcData, 'rooted_dirt', worldConfig.soilBlock),
      sand: resolveConfiguredBlockStateId(mcData, 'sand', worldConfig.soilBlock),
      water: resolveConfiguredBlockStateId(mcData, 'water', 'air')
    },
    useBiomeSurfacePalettes,
    useNaturalUndergroundGeneration,
    terrainAmplitude: Math.max(0, worldConfig.terrainAmplitude),
    terrainThickness: Math.max(4, worldConfig.terrainThickness)
  };
}

function packHeightmap(heightValues, worldHeight) {
  const bitsPerEntry = Math.ceil(Math.log2(worldHeight + 1));
  const entriesPerLong = Math.floor(64 / bitsPerEntry);
  const longs = [];
  let current = 0n;
  let used = 0;

  for (let index = 0; index < heightValues.length; index++) {
    const normalizedHeight = BigInt(heightValues[index]);
    current |= normalizedHeight << BigInt(used * bitsPerEntry);
    used += 1;

    if (used === entriesPerLong || index === heightValues.length - 1) {
      longs.push(current);
      current = 0n;
      used = 0;
    }
  }

  return longs;
}

function getTerrainHeight(worldX, worldZ, surfaceY, amplitude, seedOffset = 0) {
  const macro = fbmNoise2d(worldX, worldZ, seedOffset + 401, {
    frequency: 0.0065,
    octaves: 4,
    persistence: 0.52,
    lacunarity: 2.08
  });
  const hills = fbmNoise2d(worldX, worldZ, seedOffset + 503, {
    frequency: 0.018,
    octaves: 3,
    persistence: 0.48,
    lacunarity: 2.2
  });
  const ridges = ridgeNoise2d(worldX, worldZ, seedOffset + 607, {
    frequency: 0.013,
    octaves: 4,
    persistence: 0.56,
    lacunarity: 2.05
  });
  const cliffs = ridgeNoise2d(worldX, worldZ, seedOffset + 709, {
    frequency: 0.031,
    octaves: 2,
    persistence: 0.6,
    lacunarity: 2
  });
  const valleyMask = fbmNoise2d(worldX, worldZ, seedOffset + 811, {
    frequency: 0.009,
    octaves: 2,
    persistence: 0.5,
    lacunarity: 2
  });
  const ridgeBoost = Math.max(0, ridges - 0.52) * (amplitude * 1.9);
  const cliffBoost = Math.max(0, cliffs - 0.7) * (amplitude * 2.6);
  const valleyCut = Math.max(0, -valleyMask) * (amplitude * 0.9);
  const terrainOffset =
    (macro * (amplitude * 1.6)) +
    (hills * (amplitude * 0.95)) +
    ridgeBoost +
    cliffBoost -
    valleyCut;

  return surfaceY + Math.round(terrainOffset);
}

function getBiomeRegionNoise(worldX, worldZ, seedOffset = 0) {
  return fbmNoise2d(worldX, worldZ, seedOffset + 907, {
    frequency: 0.0055,
    octaves: 4,
    persistence: 0.58,
    lacunarity: 2
  }) - 0.12;
}

function getTreeStyleForBiomeName(biomeName = '') {
  if (biomeName.includes('birch')) {
    return 'birch';
  }

  if (biomeName.includes('forest')) {
    return 'oak';
  }

  if (biomeName.includes('plains') || biomeName.includes('meadow')) {
    return 'oak_sparse';
  }

  return null;
}

function getDecorationStyleForBiomeName(biomeName = '') {
  if (biomeName.includes('birch')) {
    return 'birch';
  }

  if (biomeName.includes('forest')) {
    return 'forest';
  }

  if (biomeName.includes('plains') || biomeName.includes('meadow')) {
    return 'plains';
  }

  return null;
}

function getBiomeProfile(worldOptions, worldX, worldZ) {
  if (!worldOptions.mixedBiomes) {
    return {
      allowWater: true,
      biomeId: worldOptions.biomeId,
      shoreBlockStateId: worldOptions.terrainBlockStateIds.sand,
      surfaceBlockStateId: worldOptions.surfaceBlockStateId,
      soilBlockStateId: worldOptions.soilBlockStateId,
      foundationBlockStateId: worldOptions.foundationBlockStateId,
      terrainAmplitudeOffset: 0,
      treeStyle: getTreeStyleForBiomeName(worldOptions.biomeName),
      decorationStyle: getDecorationStyleForBiomeName(worldOptions.biomeName)
    };
  }

  const biomeRegionNoise = getBiomeRegionNoise(worldX, worldZ, worldOptions.seedHash);

  if (biomeRegionNoise < -0.45) {
    return {
      allowWater: true,
      biomeId: worldOptions.biomeIds.stony,
      shoreBlockStateId: worldOptions.terrainBlockStateIds.gravel,
      surfaceBlockStateId: worldOptions.useBiomeSurfacePalettes
        ? worldOptions.terrainBlockStateIds.gravel
        : worldOptions.surfaceBlockStateId,
      soilBlockStateId: worldOptions.useBiomeSurfacePalettes
        ? worldOptions.terrainBlockStateIds.andesite
        : worldOptions.soilBlockStateId,
      foundationBlockStateId: worldOptions.foundationBlockStateId,
      terrainAmplitudeOffset: 3,
      treeStyle: null,
      decorationStyle: null
    };
  }

  if (biomeRegionNoise < 0.15) {
    return {
      allowWater: true,
      biomeId: worldOptions.biomeIds.plains,
      shoreBlockStateId: worldOptions.terrainBlockStateIds.sand,
      surfaceBlockStateId: worldOptions.surfaceBlockStateId,
      soilBlockStateId: worldOptions.soilBlockStateId,
      foundationBlockStateId: worldOptions.foundationBlockStateId,
      terrainAmplitudeOffset: 0,
      treeStyle: 'oak_sparse',
      decorationStyle: 'plains'
    };
  }

  if (biomeRegionNoise < 0.60) {
    return {
      allowWater: true,
      biomeId: worldOptions.biomeIds.forest,
      shoreBlockStateId: worldOptions.terrainBlockStateIds.sand,
      surfaceBlockStateId: worldOptions.useBiomeSurfacePalettes
        ? worldOptions.terrainBlockStateIds.podzol
        : worldOptions.surfaceBlockStateId,
      soilBlockStateId: worldOptions.useBiomeSurfacePalettes
        ? worldOptions.terrainBlockStateIds.rootedDirt
        : worldOptions.soilBlockStateId,
      foundationBlockStateId: worldOptions.foundationBlockStateId,
      terrainAmplitudeOffset: 1,
      treeStyle: 'oak',
      decorationStyle: 'forest'
    };
  }

  return {
    allowWater: true,
    biomeId: worldOptions.biomeIds.birchForest,
    shoreBlockStateId: worldOptions.terrainBlockStateIds.sand,
    surfaceBlockStateId: worldOptions.surfaceBlockStateId,
    soilBlockStateId: worldOptions.useBiomeSurfacePalettes
      ? worldOptions.terrainBlockStateIds.rootedDirt
      : worldOptions.soilBlockStateId,
    foundationBlockStateId: worldOptions.foundationBlockStateId,
    terrainAmplitudeOffset: 1,
    treeStyle: 'birch',
    decorationStyle: 'birch'
  };
}

function getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ) {
  const biomeProfile = getBiomeProfile(worldOptions, worldX, worldZ);
  const baseTopY = getTerrainHeight(
    worldX,
    worldZ,
    surfaceY,
    worldOptions.terrainAmplitude + biomeProfile.terrainAmplitudeOffset,
    worldOptions.seedHash
  );
  const soilDepth = Math.max(3, Math.floor(worldOptions.terrainThickness / 3));

  return {
    biomeProfile,
    floorStartY: baseTopY - (worldOptions.terrainThickness - 1),
    soilStartY: baseTopY - (soilDepth - 1),
    topBlockStateId: biomeProfile.surfaceBlockStateId,
    topY: baseTopY,
    waterBottomY: null,
    waterTopY: null
  };
}

function getTreeCandidate(worldOptions, surfaceY, spawn, cellX, cellZ) {
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 11);
  const localX = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 17) * (TREE_CELL_SIZE - 2));
  const localZ = 1 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 23) * (TREE_CELL_SIZE - 2));
  const worldX = (cellX * TREE_CELL_SIZE) + localX;
  const worldZ = (cellZ * TREE_CELL_SIZE) + localZ;

  if (isNearSpawn(spawn, worldX, worldZ)) {
    return null;
  }

  const { biomeProfile, topY } = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
  const treeStyle = biomeProfile.treeStyle;

  if (!treeStyle) {
    return null;
  }

  const treeChance = treeStyle === 'oak_sparse'
    ? 0.18
    : treeStyle === 'oak'
      ? 0.42
      : 0.35;

  if (candidateNoise > treeChance) {
    return null;
  }

  const heightBase = treeStyle === 'birch' ? 5 : 4;
  const height = heightBase + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 29) * 3);

  return {
    height,
    leafBlockStateId: treeStyle === 'birch'
      ? worldOptions.treeBlockStateIds.birchLeaves
      : worldOptions.treeBlockStateIds.oakLeaves,
    logBlockStateId: treeStyle === 'birch'
      ? worldOptions.treeBlockStateIds.birchLog
      : worldOptions.treeBlockStateIds.oakLog,
    topY,
    worldX,
    worldZ
  };
}

function resolveUndergroundBlockStateId(worldOptions, biomeProfile, worldX, worldY, worldZ, topY) {
  if (!worldOptions.useNaturalUndergroundGeneration) {
    return biomeProfile.foundationBlockStateId;
  }

  const depth = topY - worldY;
  const oreNoise = hashNoise2d(
    (worldX * 0.91) + (worldY * 1.73),
    (worldZ * 0.87) - (worldY * 1.21),
    worldOptions.seedHash + 101
  );

  if (depth >= 7 && oreNoise > 0.993) {
    return worldOptions.terrainBlockStateIds.ironOre;
  }

  if (depth >= 5 && oreNoise > 0.987) {
    return worldOptions.terrainBlockStateIds.copperOre;
  }

  if (depth >= 4 && oreNoise > 0.978) {
    return worldOptions.terrainBlockStateIds.coalOre;
  }

  const variantNoise = hashNoise2d(
    (worldX * 0.63) - (worldY * 0.44),
    (worldZ * 0.69) + (worldY * 0.58),
    worldOptions.seedHash + 131
  );

  if (variantNoise > 0.83) {
    return worldOptions.terrainBlockStateIds.granite;
  }

  if (variantNoise > 0.68) {
    return worldOptions.terrainBlockStateIds.diorite;
  }

  if (variantNoise > 0.52) {
    return worldOptions.terrainBlockStateIds.andesite;
  }

  return biomeProfile.foundationBlockStateId;
}

function getPondCandidate(worldOptions, surfaceY, spawn, cellX, cellZ) {
  const candidateNoise = hashNoise2d(cellX, cellZ, worldOptions.seedHash + 211);
  const centerX = (cellX * POND_CELL_SIZE) + 3 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 223) * 12);
  const centerZ = (cellZ * POND_CELL_SIZE) + 3 + Math.floor(hashNoise2d(cellX, cellZ, worldOptions.seedHash + 227) * 12);

  if (candidateNoise > 0.22 || isNearSpawn(spawn, centerX, centerZ, WATER_SPAWN_CLEAR_RADIUS)) {
    return null;
  }

  const centerColumn = getColumnDescriptor(worldOptions, surfaceY, spawn, centerX, centerZ);
  const waterLevel = surfaceY - 1;

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

  return {
    centerX,
    centerZ,
    depth,
    radius,
    shoreBlockStateId: centerColumn.biomeProfile.shoreBlockStateId,
    waterLevel
  };
}

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
    worldOptions.terrainBlockStateIds.sand
  ].includes(stateId);
}

function getDecorationStateId(worldOptions, decorationStyle, worldX, worldZ, topY, topStateId) {
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
      topY < SAFE_SURFACE_Y + 8 &&
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

function applySurfaceDecorationsToChunk(chunk, chunkX, chunkZ, worldOptions, surfaceY, spawn) {
  for (let localX = 0; localX < 16; localX++) {
    for (let localZ = 0; localZ < 16; localZ++) {
      const worldX = (chunkX * 16) + localX;
      const worldZ = (chunkZ * 16) + localZ;

      if (isNearSpawn(spawn, worldX, worldZ, DECORATION_SPAWN_CLEAR_RADIUS)) {
        continue;
      }

      const topY = getTopSolidY(chunk, localX, localZ);
      const topStateId = chunk.getBlockStateId(new Vec3(localX, topY, localZ));

      if (!isGroundDecorationBase(worldOptions, topStateId)) {
        continue;
      }

      if (chunk.getBlockStateId(new Vec3(localX, topY + 1, localZ)) !== 0) {
        continue;
      }

      const decorationStyle = getBiomeProfile(worldOptions, worldX, worldZ).decorationStyle;
      const decorationStateId = getDecorationStateId(
        worldOptions,
        decorationStyle,
        worldX,
        worldZ,
        topY,
        topStateId
      );

      if (!decorationStateId) {
        continue;
      }

      chunk.setBlockStateId(new Vec3(localX, topY + 1, localZ), decorationStateId);
    }
  }
}

function shapeColumnTop(chunk, localX, localZ, targetTopY, stateId) {
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

function applyPondToChunk(chunk, chunkX, chunkZ, pond, worldOptions) {
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
        const actualFloorY = shapeColumnTop(chunk, localX, localZ, floorY, pond.shoreBlockStateId);
        for (let y = actualFloorY + 1; y <= pond.waterLevel; y++) {
          chunk.setBlockStateId(new Vec3(localX, y, localZ), worldOptions.terrainBlockStateIds.water);
        }
        continue;
      }

      if (distance <= pond.radius) {
        const shelfFloorY = pond.waterLevel - 1;
        const actualShelfFloorY = shapeColumnTop(chunk, localX, localZ, shelfFloorY, pond.shoreBlockStateId);
        for (let y = actualShelfFloorY + 1; y <= pond.waterLevel; y++) {
          chunk.setBlockStateId(new Vec3(localX, y, localZ), worldOptions.terrainBlockStateIds.water);
        }
        continue;
      }

      if (distance <= outerRadius) {
        shapeColumnTop(chunk, localX, localZ, bankTopY, pond.shoreBlockStateId);
      }
    }
  }
}

function setChunkBlock(chunk, chunkX, chunkZ, worldX, worldY, worldZ, stateId, overwriteAirOnly = false) {
  if (
    worldX < chunkX * 16 ||
    worldX >= ((chunkX + 1) * 16) ||
    worldZ < chunkZ * 16 ||
    worldZ >= ((chunkZ + 1) * 16)
  ) {
    return;
  }

  const localPosition = new Vec3(worldX - (chunkX * 16), worldY, worldZ - (chunkZ * 16));

  if (overwriteAirOnly && chunk.getBlockStateId(localPosition) !== 0) {
    return;
  }

  chunk.setBlockStateId(localPosition, stateId);
}

function applyTreeToChunk(chunk, chunkX, chunkZ, tree) {
  if (!tree) {
    return;
  }

  for (let trunkY = tree.topY + 1; trunkY <= tree.topY + tree.height; trunkY++) {
    setChunkBlock(chunk, chunkX, chunkZ, tree.worldX, trunkY, tree.worldZ, tree.logBlockStateId);
  }

  const canopyBaseY = tree.topY + tree.height - 2;

  for (let y = canopyBaseY; y <= canopyBaseY + 2; y++) {
    const radius = y === canopyBaseY + 2 ? 1 : TREE_CANOPY_RADIUS;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.abs(dx) === radius && Math.abs(dz) === radius && radius > 1) {
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
    canopyBaseY + 3,
    tree.worldZ,
    tree.leafBlockStateId,
    true
  );
}

function getCaveSignal(worldOptions, worldX, worldY, worldZ) {
  const seedOffset = worldOptions.seedHash;

  return (
    (Math.sin((worldX + (seedOffset * 0.11)) * 0.115) * 0.95) +
    (Math.cos((worldZ - (seedOffset * 0.07)) * 0.110) * 0.90) +
    (Math.sin((worldY + (seedOffset * 0.05)) * 0.235) * 0.75) +
    (Math.cos((worldX + worldZ + worldY + (seedOffset * 0.03)) * 0.052) * 0.70)
  );
}

function shouldCarveCave(worldOptions, spawn, column, worldX, worldY, worldZ) {
  if (isNearSpawn(spawn, worldX, worldZ, CAVE_SPAWN_CLEAR_RADIUS)) {
    return false;
  }

  if (worldY >= column.topY - 4) {
    return false;
  }

  if (worldY <= column.floorStartY + 1) {
    return false;
  }

  const caveDepth = column.topY - worldY;

  if (caveDepth < 4) {
    return false;
  }

  const caveThreshold = caveDepth > 8 ? 1.72 : 1.88;
  return getCaveSignal(worldOptions, worldX, worldY, worldZ) > caveThreshold;
}

function createGeneratedChunk(worldOptions, surfaceY, spawn, chunkX, chunkZ) {
  const chunk = new Chunk();

  for (let localX = 0; localX < 16; localX++) {
    for (let localZ = 0; localZ < 16; localZ++) {
      const worldX = (chunkX * 16) + localX;
      const worldZ = (chunkZ * 16) + localZ;
      const column = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
      const { biomeProfile, floorStartY, soilStartY, topBlockStateId, topY } = column;

      for (let y = floorStartY; y < topY; y++) {
        if (shouldCarveCave(worldOptions, spawn, column, worldX, y, worldZ)) {
          continue;
        }

        chunk.setBlockStateId(
          new Vec3(localX, y, localZ),
          y >= soilStartY
            ? biomeProfile.soilBlockStateId
            : resolveUndergroundBlockStateId(worldOptions, biomeProfile, worldX, y, worldZ, topY)
        );
      }

      chunk.setBlockStateId(new Vec3(localX, topY, localZ), topBlockStateId);

      for (let y = chunk.minY; y < chunk.minY + chunk.worldHeight; y++) {
        chunk.setSkyLight(new Vec3(localX, y, localZ), 15);
      }
    }
  }

  for (let y = chunk.minY; y < chunk.minY + chunk.worldHeight; y += 4) {
    for (let x = 0; x < 16; x += 4) {
      for (let z = 0; z < 16; z += 4) {
        const worldX = (chunkX * 16) + x;
        const worldZ = (chunkZ * 16) + z;
        chunk.setBiome(new Vec3(x, y, z), getBiomeProfile(worldOptions, worldX, worldZ).biomeId);
      }
    }
  }

  const minPondCellX = Math.floor(((chunkX * 16) - POND_MAX_RADIUS - 1) / POND_CELL_SIZE);
  const maxPondCellX = Math.floor((((chunkX + 1) * 16) - 1 + POND_MAX_RADIUS + 1) / POND_CELL_SIZE);
  const minPondCellZ = Math.floor(((chunkZ * 16) - POND_MAX_RADIUS - 1) / POND_CELL_SIZE);
  const maxPondCellZ = Math.floor((((chunkZ + 1) * 16) - 1 + POND_MAX_RADIUS + 1) / POND_CELL_SIZE);

  for (let cellX = minPondCellX; cellX <= maxPondCellX; cellX++) {
    for (let cellZ = minPondCellZ; cellZ <= maxPondCellZ; cellZ++) {
      applyPondToChunk(chunk, chunkX, chunkZ, getPondCandidate(worldOptions, surfaceY, spawn, cellX, cellZ), worldOptions);
    }
  }

  const minTreeCellX = Math.floor(((chunkX * 16) - TREE_CANOPY_RADIUS) / TREE_CELL_SIZE);
  const maxTreeCellX = Math.floor((((chunkX + 1) * 16) - 1 + TREE_CANOPY_RADIUS) / TREE_CELL_SIZE);
  const minTreeCellZ = Math.floor(((chunkZ * 16) - TREE_CANOPY_RADIUS) / TREE_CELL_SIZE);
  const maxTreeCellZ = Math.floor((((chunkZ + 1) * 16) - 1 + TREE_CANOPY_RADIUS) / TREE_CELL_SIZE);

  for (let cellX = minTreeCellX; cellX <= maxTreeCellX; cellX++) {
    for (let cellZ = minTreeCellZ; cellZ <= maxTreeCellZ; cellZ++) {
      applyTreeToChunk(chunk, chunkX, chunkZ, getTreeCandidate(worldOptions, surfaceY, spawn, cellX, cellZ));
    }
  }

  applySurfaceDecorationsToChunk(chunk, chunkX, chunkZ, worldOptions, surfaceY, spawn);

  return chunk;
}

function createChunkLightTemplate(chunk) {
  const light = chunk.dumpLight();

  return {
    skyLightMask: light.skyLightMask,
    blockLightMask: light.blockLightMask,
    emptySkyLightMask: light.emptySkyLightMask,
    emptyBlockLightMask: light.emptyBlockLightMask,
    skyLight: light.skyLight.map((section) => Array.from(section)),
    blockLight: light.blockLight.map((section) => Array.from(section))
  };
}

function createHeightmapData(chunk, fallbackSurfaceY) {
  const minY = chunk.minY;
  const maxY = chunk.minY + chunk.worldHeight - 1;
  const airStateId = 0;
  const heightValues = [];

  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      let topY = fallbackSurfaceY;

      for (let y = maxY; y >= minY; y--) {
        if (chunk.getBlockStateId(new Vec3(x, y, z)) !== airStateId) {
          topY = y;
          break;
        }
      }

      heightValues.push(topY - minY + 1);
    }
  }

  return HEIGHTMAP_TYPES.map((type) => ({
    type,
    data: packHeightmap(heightValues, chunk.worldHeight)
  }));
}

function createChunkTemplate(chunk, surfaceY) {
  return {
    heightmaps: createHeightmapData(chunk, surfaceY),
    chunkData: encodeChunkData(chunk),
    blockEntities: []
  };
}

function encodeChunkData(chunk) {
  const buffer = new SmartBuffer();

  for (let index = 0; index < chunk.sections.length; index++) {
    const section = chunk.sections[index];
    const biome = chunk.biomes[index];

    buffer.writeInt16BE(section?.solidBlockCount ?? 0);
    buffer.writeInt16BE(0);
    section.data.write(buffer);
    biome.write(buffer);
  }

  return buffer.toBuffer();
}

function createChunkPacket(x, z, template) {
  return {
    x,
    z,
    heightmaps: template.heightmaps,
    chunkData: template.chunkData,
    blockEntities: template.blockEntities,
    skyLightMask: template.skyLightMask,
    blockLightMask: template.blockLightMask,
    emptySkyLightMask: template.emptySkyLightMask,
    emptyBlockLightMask: template.emptyBlockLightMask,
    skyLight: template.skyLight,
    blockLight: template.blockLight
  };
}

function getChunkKey(chunkX, chunkZ) {
  return `${chunkX},${chunkZ}`;
}

function getBlockKey(position) {
  const normalizedPosition = normalizePosition(position);
  return `${normalizedPosition.x},${normalizedPosition.y},${normalizedPosition.z}`;
}

function toChunkCoordinates(position) {
  const { x, y, z } = normalizePosition(position);
  const chunkX = Math.floor(x / 16);
  const chunkZ = Math.floor(z / 16);

  return {
    chunkX,
    chunkZ,
    localPosition: new Vec3(x - (chunkX * 16), y, z - (chunkZ * 16)),
    worldPosition: { x, y, z }
  };
}

function createInitialWorldPackets(mcData, config, savedWorldState = { blocks: [] }) {
  const worldOptions = resolveWorldOptions(mcData, config);
  const spawnChunk = getSpawnChunk(config.spawn);
  const surfaceY = getSurfaceY(config.spawn.y);
  const minChunkX = spawnChunk.x - worldOptions.chunkRadius;
  const maxChunkX = spawnChunk.x + worldOptions.chunkRadius;
  const minChunkZ = spawnChunk.z - worldOptions.chunkRadius;
  const maxChunkZ = spawnChunk.z + worldOptions.chunkRadius;
  const minX = minChunkX * 16;
  const maxX = ((maxChunkX + 1) * 16) - 1;
  const minZ = minChunkZ * 16;
  const maxZ = ((maxChunkZ + 1) * 16) - 1;
  const floorStartY = surfaceY - (worldOptions.terrainThickness - 1);
  const maxBuildY = surfaceY + BUILD_HEIGHT;
  const topBlockStateId = worldOptions.surfaceBlockStateId;
  const fillBlockStateId = worldOptions.soilBlockStateId;
  const placementBlockStateId = topBlockStateId;
  const airBlockStateId = mcData.blocksByName.air.defaultState;
  const lightTemplate = createChunkLightTemplate(
    createGeneratedChunk(worldOptions, surfaceY, config.spawn, spawnChunk.x, spawnChunk.z)
  );
  const chunks = new Map();
  const modifiedBlocks = new Map();

  function ensureChunk(chunkX, chunkZ) {
    const chunkKey = getChunkKey(chunkX, chunkZ);

    if (!chunks.has(chunkKey)) {
      const chunk = createGeneratedChunk(worldOptions, surfaceY, config.spawn, chunkX, chunkZ);
      chunks.set(chunkKey, { chunkX, chunkZ, chunk });
    }

    return chunks.get(chunkKey);
  }

  function isWithinPlatformBounds(position) {
    const normalizedPosition = normalizePosition(position);

    if (!normalizedPosition) {
      return false;
    }

    return (
      normalizedPosition.x >= minX &&
      normalizedPosition.x <= maxX &&
      normalizedPosition.z >= minZ &&
      normalizedPosition.z <= maxZ &&
      normalizedPosition.y >= floorStartY &&
      normalizedPosition.y <= surfaceY
    );
  }

  function isWithinBuildBounds(position) {
    const normalizedPosition = normalizePosition(position);

    if (!normalizedPosition) {
      return false;
    }

    return normalizedPosition.y >= floorStartY && normalizedPosition.y <= maxBuildY;
  }

  function getChunkEntry(position) {
    const coordinates = toChunkCoordinates(position);
    const chunkEntry = ensureChunk(coordinates.chunkX, coordinates.chunkZ);

    return {
      ...coordinates,
      chunkEntry
    };
  }

  function getGeneratedBlockState(position) {
    if (!isWithinBuildBounds(position)) {
      return airBlockStateId;
    }

    const { chunkX, chunkZ, localPosition } = toChunkCoordinates(position);
    const generatedChunk = createGeneratedChunk(worldOptions, surfaceY, config.spawn, chunkX, chunkZ);

    return generatedChunk.getBlockStateId(localPosition);
  }

  function getBaseBlockState(position) {
    return getGeneratedBlockState(position);
  }

  function getBlockState(position) {
    if (!isWithinBuildBounds(position)) {
      return airBlockStateId;
    }

    const chunkEntry = getChunkEntry(position);

    if (!chunkEntry) {
      return airBlockStateId;
    }

    return chunkEntry.chunkEntry.chunk.getBlockStateId(chunkEntry.localPosition);
  }

  function isAirBlock(position) {
    return getBlockState(position) === airBlockStateId;
  }

  function findSafeStandingY(x, z) {
    for (let blockY = maxBuildY - 2; blockY >= floorStartY; blockY--) {
      const feetPosition = { x, y: blockY + 1, z };
      const headPosition = { x, y: blockY + 2, z };

      if (
        !isAirBlock({ x, y: blockY, z }) &&
        isAirBlock(feetPosition) &&
        isAirBlock(headPosition)
      ) {
        return feetPosition.y;
      }
    }

    return null;
  }

  function getSafeSpawnPosition(preferredSpawn = config.spawn) {
    const preferredX = clamp(Math.floor(preferredSpawn?.x ?? config.spawn.x), minX, maxX);
    const preferredZ = clamp(Math.floor(preferredSpawn?.z ?? config.spawn.z), minZ, maxZ);
    let bestCandidate = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const standingY = findSafeStandingY(x, z);

        if (standingY === null) {
          continue;
        }

        const score = Math.abs(x - preferredX) + Math.abs(z - preferredZ);

        if (score < bestScore) {
          bestScore = score;
          bestCandidate = { x, y: standingY, z };
        }
      }
    }

    if (bestCandidate) {
      return bestCandidate;
    }

    return {
      x: preferredX,
      y: surfaceY + 1,
      z: preferredZ
    };
  }

  function setBlockState(position, stateId) {
    if (!isWithinBuildBounds(position)) {
      return false;
    }

    const chunkEntry = getChunkEntry(position);

    if (!chunkEntry) {
      return false;
    }

    chunkEntry.chunkEntry.chunk.setBlockStateId(chunkEntry.localPosition, stateId);

    const worldPosition = normalizePosition(chunkEntry.worldPosition);
    const baseStateId = getBaseBlockState(worldPosition);
    const blockKey = getBlockKey(worldPosition);

    if (stateId === baseStateId) {
      modifiedBlocks.delete(blockKey);
    } else {
      modifiedBlocks.set(blockKey, {
        ...worldPosition,
        stateId
      });
    }

    return true;
  }

  function breakBlock(position) {
    if (!isWithinBuildBounds(position)) {
      return null;
    }

    const currentStateId = getBlockState(position);

    if (currentStateId === airBlockStateId) {
      return null;
    }

    const blockDefinition = mcData.blocksByStateId[currentStateId];
    const droppedItemId = blockDefinition?.drops?.[0];
    const normalizedPosition = normalizePosition(position);

    if (!setBlockState(normalizedPosition, airBlockStateId)) {
      return null;
    }

    return {
      droppedItem: Number.isInteger(droppedItemId)
        ? { itemId: droppedItemId, count: 1 }
        : null,
      position: normalizedPosition,
      stateId: currentStateId
    };
  }

  function placeBlock(position, stateId = placementBlockStateId) {
    const normalizedPosition = normalizePosition(position);

    if (!isWithinBuildBounds(normalizedPosition)) {
      return false;
    }

    if (getBlockState(normalizedPosition) !== airBlockStateId) {
      return false;
    }

    return setBlockState(normalizedPosition, stateId);
  }

  function createChunkPackets() {
    return getChunkPackets(spawnChunk.x, spawnChunk.z, worldOptions.chunkRadius);
  }

  function getChunkPacket(chunkX, chunkZ) {
    const { chunk } = ensureChunk(chunkX, chunkZ);

    return createChunkPacket(chunkX, chunkZ, {
      ...createChunkTemplate(chunk, surfaceY),
      ...lightTemplate
    });
  }

  function getChunkPackets(centerChunkX, centerChunkZ, radius) {
    const packets = [];

    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        packets.push(getChunkPacket(centerChunkX + dx, centerChunkZ + dz));
      }
    }

    return packets;
  }

  function resolvePlacedBlockLocation(position, direction) {
    const normalizedPosition = normalizePosition(position);
    const offset = FACE_OFFSETS[direction];

    if (!normalizedPosition || !offset) {
      return null;
    }

    return {
      x: normalizedPosition.x + offset.x,
      y: normalizedPosition.y + offset.y,
      z: normalizedPosition.z + offset.z
    };
  }

  function serialize() {
    return {
      blocks: Array.from(modifiedBlocks.values())
    };
  }

  function getModifiedBlocks() {
    return Array.from(modifiedBlocks.values());
  }

  for (const block of savedWorldState.blocks ?? []) {
    setBlockState(block, block.stateId);
  }

  return {
    airBlockStateId,
    breakBlock,
    chunks: createChunkPackets(),
    createChunkPackets,
    fillBlockStateId,
    foundationBlockStateId: worldOptions.foundationBlockStateId,
    floorStartY,
    getBiomeId(position) {
      const chunkEntry = getChunkEntry(position);
      return chunkEntry ? chunkEntry.chunkEntry.chunk.getBiome(chunkEntry.localPosition) : worldOptions.biomeId;
    },
    getBlockState,
    getChunkPacket,
    getChunkPackets,
    getSafeSpawnPosition,
    isWithinBuildBounds,
    isWithinPlatformBounds,
    maxX,
    maxZ,
    maxBuildY,
    minX,
    minZ,
    placementBlockStateId,
    placeBlock,
    resolvePlacedBlockLocation,
    getModifiedBlocks,
    serialize,
    setBlockState,
    surfaceY,
    surfacePaletteStateIds: [
      worldOptions.surfaceBlockStateId,
      worldOptions.terrainBlockStateIds.gravel,
      worldOptions.terrainBlockStateIds.podzol,
      worldOptions.terrainBlockStateIds.sand
    ],
    spawnChunk,
    seed: worldOptions.seed,
    streamRadius: worldOptions.streamRadius,
    terrainThickness: worldOptions.terrainThickness,
    undergroundVariantStateIds: [
      worldOptions.terrainBlockStateIds.andesite,
      worldOptions.terrainBlockStateIds.diorite,
      worldOptions.terrainBlockStateIds.granite
    ],
    oreBlockStateIds: [
      worldOptions.terrainBlockStateIds.coalOre,
      worldOptions.terrainBlockStateIds.copperOre,
      worldOptions.terrainBlockStateIds.ironOre
    ],
    waterBlockStateId: worldOptions.terrainBlockStateIds.water,
    decorationStateIds: Object.values(worldOptions.decorationBlockStateIds).filter(Boolean),
    topBlockStateId,
    treeBlockStateIds: worldOptions.treeBlockStateIds
  };
}

module.exports = {
  createInitialWorldPackets
};
