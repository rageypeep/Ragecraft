const Chunk = require('prismarine-chunk')('1.21.11');
const { SmartBuffer } = require('smart-buffer');
const Vec3 = require('vec3');
const biomes = require('./biomes');

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
const TREE_CANOPY_RADIUS = 3;
const TREE_SPAWN_CLEAR_RADIUS = 10;
const CAVE_SPAWN_CLEAR_RADIUS = 18;
const CAVE_MIN_SURFACE_ROOF = 7;
const WATER_SPAWN_CLEAR_RADIUS = 16;
const DECORATION_SPAWN_CLEAR_RADIUS = 8;
const POND_CELL_SIZE = 18;
const POND_MAX_RADIUS = 5;
const POND_SHORE_WIDTH = 2;
const POND_SHELF_WIDTH = 1.25;
const POND_MAX_TERRAIN_DELTA = 1;
const POND_MIN_FLOOR_THICKNESS = 12;
const WATER_FLOW_HORIZONTAL_RADIUS = 8;
const WATER_FLOW_VERTICAL_UP_RADIUS = 6;
const WATER_FLOW_VERTICAL_DOWN_RADIUS = 18;
const WATER_FLOW_MAX_LEVEL = 7;
const WATER_FLOW_MAX_ITERATIONS = 24;
const DEFAULT_WORLD_OPTIONS = {
  biome: 'taiga',
  mixedBiomes: true,
  seed: 'ragecraft123',
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
      river: resolveBiomeId(mcData, ['river'], fallbackBiomeId),
      sunflowerPlains: resolveBiomeId(mcData, ['sunflower_plains', 'plains'], fallbackBiomeId),
      flowerForest: resolveBiomeId(mcData, ['flower_forest', 'forest'], fallbackBiomeId),
      forest: resolveBiomeId(mcData, ['forest'], fallbackBiomeId),
      taiga: resolveBiomeId(mcData, ['taiga'], fallbackBiomeId),
      birchForest: resolveBiomeId(mcData, ['birch_forest'], fallbackBiomeId),
      oldGrowthBirchForest: resolveBiomeId(mcData, ['old_growth_birch_forest', 'birch_forest'], fallbackBiomeId)
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
      birchLeaves: resolveConfiguredBlockStateId(mcData, 'birch_leaves', 'grass_block'),
      spruceLog: resolveConfiguredBlockStateId(mcData, 'spruce_log', 'stone'),
      spruceLeaves: resolveConfiguredBlockStateId(mcData, 'spruce_leaves', 'grass_block'),
      beeNest: resolveConfiguredBlockStateId(mcData, 'bee_nest', 'oak_log')
    },
    decorationBlockStateIds: {
      shortGrass: resolveConfiguredBlockStateId(mcData, 'short_grass', 'air'),
      tallGrassUpper: mcData.blocksByName.tall_grass?.minStateId ?? resolveConfiguredBlockStateId(mcData, 'short_grass', 'air'),
      tallGrassLower: resolveConfiguredBlockStateId(mcData, 'tall_grass', 'air'),
      sunflowerUpper: mcData.blocksByName.sunflower?.minStateId ?? resolveConfiguredBlockStateId(mcData, 'dandelion', 'air'),
      sunflowerLower: resolveConfiguredBlockStateId(mcData, 'sunflower', 'air'),
      fern: resolveConfiguredBlockStateId(mcData, 'fern', 'air'),
      largeFernUpper: resolveConfiguredBlockStateId(mcData, 'large_fern', 'air'),
      largeFernLower: mcData.blocksByName.large_fern?.minStateId ?? resolveConfiguredBlockStateId(mcData, 'fern', 'air'),
      seagrass: resolveConfiguredBlockStateId(mcData, 'seagrass', 'air'),
      dandelion: resolveConfiguredBlockStateId(mcData, 'dandelion', 'air'),
      poppy: resolveConfiguredBlockStateId(mcData, 'poppy', 'air'),
      azureBluet: resolveConfiguredBlockStateId(mcData, 'azure_bluet', 'dandelion'),
      oxeyeDaisy: resolveConfiguredBlockStateId(mcData, 'oxeye_daisy', 'dandelion'),
      cornflower: resolveConfiguredBlockStateId(mcData, 'cornflower', 'dandelion'),
      orangeTulip: resolveConfiguredBlockStateId(mcData, 'orange_tulip', 'dandelion'),
      pinkTulip: resolveConfiguredBlockStateId(mcData, 'pink_tulip', 'dandelion'),
      redTulip: resolveConfiguredBlockStateId(mcData, 'red_tulip', 'dandelion'),
      whiteTulip: resolveConfiguredBlockStateId(mcData, 'white_tulip', 'dandelion'),
      brownMushroom: resolveConfiguredBlockStateId(mcData, 'brown_mushroom', 'air'),
      redMushroom: resolveConfiguredBlockStateId(mcData, 'red_mushroom', 'air'),
      sugarCane: resolveConfiguredBlockStateId(mcData, 'sugar_cane', 'air'),
      sweetBerryBush: resolveConfiguredBlockStateId(mcData, 'sweet_berry_bush', 'air')
    },
    terrainBlockStateIds: {
      andesite: resolveConfiguredBlockStateId(mcData, 'andesite', worldConfig.foundationBlock),
      clay: resolveConfiguredBlockStateId(mcData, 'clay', worldConfig.soilBlock),
      coalOre: resolveConfiguredBlockStateId(mcData, 'coal_ore', worldConfig.foundationBlock),
      copperOre: resolveConfiguredBlockStateId(mcData, 'copper_ore', worldConfig.foundationBlock),
      diorite: resolveConfiguredBlockStateId(mcData, 'diorite', worldConfig.foundationBlock),
      granite: resolveConfiguredBlockStateId(mcData, 'granite', worldConfig.foundationBlock),
      gravel: resolveConfiguredBlockStateId(mcData, 'gravel', worldConfig.foundationBlock),
      ironOre: resolveConfiguredBlockStateId(mcData, 'iron_ore', worldConfig.foundationBlock),
      podzol: resolveConfiguredBlockStateId(mcData, 'podzol', worldConfig.surfaceBlock),
      rootedDirt: resolveConfiguredBlockStateId(mcData, 'rooted_dirt', worldConfig.soilBlock),
      sand: resolveConfiguredBlockStateId(mcData, 'sand', worldConfig.soilBlock),
      water: resolveConfiguredBlockStateId(mcData, 'water', 'air'),
      waterMax: mcData.blocksByName.water?.maxStateId ?? resolveConfiguredBlockStateId(mcData, 'water', 'air')
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

function getSunflowerPlainsNoise(worldX, worldZ, seedOffset = 0) {
  return valueNoise2d(worldX, worldZ, seedOffset + 983, 0.0065);
}

function getFlowerForestNoise(worldX, worldZ, seedOffset = 0) {
  return valueNoise2d(worldX, worldZ, seedOffset + 1019, 0.006);
}

function getOldGrowthBirchNoise(worldX, worldZ, seedOffset = 0) {
  return valueNoise2d(worldX, worldZ, seedOffset + 1051, 0.0065);
}

function getTaigaNoise(worldX, worldZ, seedOffset = 0) {
  return valueNoise2d(worldX, worldZ, seedOffset + 1097, 0.0058);
}

function getRiverDistance(worldX, worldZ, seedOffset = 0) {
  const warpX = worldX + (fbmNoise2d(worldX, worldZ, seedOffset + 1151, {
    frequency: 0.01,
    octaves: 2,
    persistence: 0.5,
    lacunarity: 2
  }) * 28);
  const warpZ = worldZ + (fbmNoise2d(worldX, worldZ, seedOffset + 1177, {
    frequency: 0.01,
    octaves: 2,
    persistence: 0.5,
    lacunarity: 2
  }) * 28);

  return Math.abs(signedValueNoise2d(warpX, warpZ, seedOffset + 1201, 0.0085));
}

function getRiverShape(worldX, worldZ, seedOffset = 0) {
  const distance = getRiverDistance(worldX, worldZ, seedOffset);
  const poolNoise = valueNoise2d(worldX, worldZ, seedOffset + 1237, 0.0042);
  const lakeStrength = clamp((poolNoise - 0.66) / 0.34, 0, 1);
  const channelWidth = lerp(0.068, 0.118, lakeStrength);
  const islandNoise = valueNoise2d(worldX, worldZ, seedOffset + 1279, 0.012);

  return {
    distance,
    poolNoise,
    lakeStrength,
    channelWidth,
    islandNoise
  };
}

function shouldUseRiverBiome(worldOptions, surfaceY, worldX, worldZ) {
  const riverShape = getRiverShape(worldX, worldZ, worldOptions.seedHash);

  if (riverShape.distance >= riverShape.channelWidth) {
    return false;
  }

  const localRelief = getTerrainRelief(worldOptions, surfaceY, worldX, worldZ, 3);
  const gentleReliefLimit = riverShape.lakeStrength > 0.82 ? 2 : 1;

  if (localRelief > gentleReliefLimit) {
    return false;
  }

  const baseTopY = getTerrainHeight(
    worldX,
    worldZ,
    surfaceY,
    worldOptions.terrainAmplitude,
    worldOptions.seedHash
  );
  const waterLevel = surfaceY - 1;

  if (baseTopY > waterLevel + 1) {
    return false;
  }

  return true;
}

function getTreeStyleForBiomeName(biomeName = '') {
  if (biomeName.includes('birch')) {
    return 'birch_forest';
  }

  if (biomeName.includes('forest')) {
    return 'forest';
  }

  if (biomeName.includes('plains') || biomeName.includes('meadow')) {
    return 'plains';
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

function getLegacyBiomeProfile(worldOptions, biomeKey) {
  if (biomeKey === 'river') {
    return biomes.river.createProfile(worldOptions);
  }

  if (biomeKey === 'sunflowerPlains') {
    return biomes.sunflowerPlains.createProfile(worldOptions);
  }

  if (biomeKey === 'flowerForest') {
    return biomes.flowerForest.createProfile(worldOptions);
  }

  if (biomeKey === 'forest') {
    return biomes.forest.createProfile(worldOptions);
  }

  if (biomeKey === 'taiga') {
    return biomes.taiga.createProfile(worldOptions);
  }

  if (biomeKey === 'birchForest') {
    return biomes.birchForest.createProfile(worldOptions);
  }

  if (biomeKey === 'oldGrowthBirchForest') {
    return biomes.oldGrowthBirchForest.createProfile(worldOptions);
  }

  return biomes.plains.createProfile(worldOptions);
}

function getBiomeProfile(worldOptions, worldX, worldZ) {
  if (!worldOptions.mixedBiomes) {
    if (worldOptions.biomeName.includes('river')) {
      return biomes.river.createProfile(worldOptions);
    }

    if (worldOptions.biomeName.includes('sunflower')) {
      return biomes.sunflowerPlains.createProfile(worldOptions);
    }

    if (worldOptions.biomeName.includes('flower')) {
      return biomes.flowerForest.createProfile(worldOptions);
    }

    if (worldOptions.biomeName.includes('taiga')) {
      return biomes.taiga.createProfile(worldOptions);
    }

    if (worldOptions.biomeName.includes('old_growth') || worldOptions.biomeName.includes('old-growth')) {
      return biomes.oldGrowthBirchForest.createProfile(worldOptions);
    }

    if (worldOptions.biomeName.includes('birch')) {
      return biomes.birchForest.createProfile(worldOptions);
    }

    if (worldOptions.biomeName.includes('forest') && !worldOptions.biomeName.includes('birch')) {
      return biomes.forest.createProfile(worldOptions);
    }

    if (worldOptions.biomeName.includes('plains') || worldOptions.biomeName.includes('meadow')) {
      return biomes.plains.createProfile(worldOptions);
    }

    return {
      ...getLegacyBiomeProfile(worldOptions, worldOptions.biomeName.includes('birch') ? 'birchForest' : worldOptions.biomeName.includes('forest') ? 'forest' : 'plains'),
      allowWater: true
    };
  }

  if (shouldUseRiverBiome(worldOptions, SAFE_SURFACE_Y, worldX, worldZ)) {
    return biomes.river.createProfile(worldOptions);
  }

  const biomeRegionNoise = getBiomeRegionNoise(worldX, worldZ, worldOptions.seedHash);

  if (biomeRegionNoise < 0.22) {
    if (getSunflowerPlainsNoise(worldX, worldZ, worldOptions.seedHash) > 0.77) {
      return biomes.sunflowerPlains.createProfile(worldOptions);
    }

    return biomes.plains.createProfile(worldOptions);
  }

  if (biomeRegionNoise < 0.60) {
    if (getFlowerForestNoise(worldX, worldZ, worldOptions.seedHash) > 0.79) {
      return biomes.flowerForest.createProfile(worldOptions);
    }

    return {
      ...getLegacyBiomeProfile(worldOptions, 'forest'),
      allowWater: true
    };
  }

  if (getTaigaNoise(worldX, worldZ, worldOptions.seedHash) > 0.76) {
    return {
      ...getLegacyBiomeProfile(worldOptions, 'taiga'),
      allowWater: true
    };
  }

  if (getOldGrowthBirchNoise(worldX, worldZ, worldOptions.seedHash) > 0.74) {
    return {
      ...getLegacyBiomeProfile(worldOptions, 'oldGrowthBirchForest'),
      allowWater: true
    };
  }

  return {
    ...getLegacyBiomeProfile(worldOptions, 'birchForest'),
    allowWater: true
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
  const waterLevel = surfaceY - 1;

  if (biomeProfile.biomeKey === 'river') {
    const riverShape = getRiverShape(worldX, worldZ, worldOptions.seedHash);
    const riverCenterStrength = 1 - clamp(riverShape.distance / riverShape.channelWidth, 0, 1);
    const bankBlend = clamp((riverCenterStrength - 0.3) / 0.7, 0, 1);
    const wetBlend = clamp((riverCenterStrength - 0.72) / 0.28, 0, 1);
    const bankSlope = Math.max(0, baseTopY - waterLevel);
    const localRelief = getTerrainRelief(worldOptions, surfaceY, worldX, worldZ, 2);
    const reliefPenalty = clamp((localRelief - 1) / 4, 0, 1);
    const baseMaxDepth = Math.min(3 + Math.floor(bankSlope * 0.1), 5);
    const poolDepthBoost = Math.round(riverShape.lakeStrength * 2);
    const depthCap = lerp(baseMaxDepth + poolDepthBoost, 3 + Math.round(riverShape.lakeStrength), reliefPenalty);
    const channelDepth = Math.round(lerp(1, depthCap, wetBlend));
    const riverbedY = Math.min(baseTopY - 1, waterLevel - channelDepth);
    const dryRiver = (
      wetBlend <= 0 ||
      baseTopY > waterLevel + 1 ||
      localRelief > 2 ||
      (localRelief > 1 && riverShape.lakeStrength < 0.9)
    );
    const supportBaseY = Math.min(baseTopY, riverbedY);

    if (riverCenterStrength < 0.18) {
      return {
        biomeProfile,
        floorStartY: baseTopY - (worldOptions.terrainThickness - 1),
        soilStartY: baseTopY - (soilDepth - 1),
        topBlockStateId: worldOptions.surfaceBlockStateId,
        topY: baseTopY,
        waterBottomY: null,
        waterTopY: null
      };
    }

    const bedNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 1259);
    const riverbedStateId = bedNoise > 0.82
      ? worldOptions.terrainBlockStateIds.clay
      : bedNoise > 0.56
        ? worldOptions.terrainBlockStateIds.gravel
        : bedNoise > 0.28
          ? worldOptions.terrainBlockStateIds.sand
          : worldOptions.soilBlockStateId;
    const bankCarveDepth = Math.max(0, Math.round(bankBlend * lerp(1.25, 0.5, reliefPenalty)));
    const carvedTopY = Math.max(riverbedY, baseTopY - bankCarveDepth);
    const islandStrength = riverShape.lakeStrength > 0.55 && riverCenterStrength > 0.8
      ? clamp((riverShape.islandNoise - 0.94) / 0.06, 0, 1) * riverShape.lakeStrength
      : 0;

    if (islandStrength > 0.2) {
      const islandTopY = waterLevel + Math.max(1, Math.round(islandStrength * 2));

      return {
        biomeProfile,
        floorStartY: Math.min(baseTopY, islandTopY) - (worldOptions.terrainThickness - 1),
        soilStartY: Math.max(Math.min(baseTopY, islandTopY) - (soilDepth - 1), islandTopY - 2),
        topBlockStateId: worldOptions.surfaceBlockStateId,
        topY: islandTopY,
        waterBottomY: null,
        waterTopY: null
      };
    }

    const finalTopY = wetBlend > 0 && !dryRiver ? riverbedY : carvedTopY;

    return {
      biomeProfile,
      floorStartY: supportBaseY - (worldOptions.terrainThickness - 1),
      soilStartY: Math.max(supportBaseY - (soilDepth - 1), finalTopY - 2),
      topBlockStateId: wetBlend > 0 && !dryRiver ? riverbedStateId : worldOptions.surfaceBlockStateId,
      topY: finalTopY,
      waterBottomY: wetBlend > 0 && !dryRiver ? riverbedY + 1 : null,
      waterTopY: wetBlend > 0 && !dryRiver ? waterLevel : null
    };
  }

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

function getSurfaceVariation(worldOptions, surfaceY, spawn, centerX, centerZ, radius = 1) {
  let minTopY = Number.POSITIVE_INFINITY;
  let maxTopY = Number.NEGATIVE_INFINITY;

  for (let worldX = centerX - radius; worldX <= centerX + radius; worldX++) {
    for (let worldZ = centerZ - radius; worldZ <= centerZ + radius; worldZ++) {
      const { topY } = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
      minTopY = Math.min(minTopY, topY);
      maxTopY = Math.max(maxTopY, topY);
    }
  }

  return maxTopY - minTopY;
}

function getTerrainRelief(worldOptions, surfaceY, centerX, centerZ, radius = 1) {
  let minTopY = Number.POSITIVE_INFINITY;
  let maxTopY = Number.NEGATIVE_INFINITY;

  for (let worldX = centerX - radius; worldX <= centerX + radius; worldX++) {
    for (let worldZ = centerZ - radius; worldZ <= centerZ + radius; worldZ++) {
      const topY = getTerrainHeight(
        worldX,
        worldZ,
        surfaceY,
        worldOptions.terrainAmplitude,
        worldOptions.seedHash
      );
      minTopY = Math.min(minTopY, topY);
      maxTopY = Math.max(maxTopY, topY);
    }
  }

  return maxTopY - minTopY;
}

function buildTreeFeature(worldOptions, treeType, worldX, worldZ, topY, seedA, seedB) {
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

function getTreeCandidate(worldOptions, surfaceY, spawn, cellX, cellZ) {
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
    buildTreeFeature
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

  const surfaceVariation = getSurfaceVariation(worldOptions, surfaceY, spawn, worldX, worldZ, treeStyle === 'stony_sparse' ? 1 : 2);
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

  return buildTreeFeature(worldOptions, treeType, worldX, worldZ, topY, cellX, cellZ);
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

  const candidate = {
    centerX,
    centerZ,
    depth,
    radius,
    shoreBlockStateId: centerColumn.biomeProfile.shoreBlockStateId,
    waterLevel
  };

  if (pondCandidateHasNearbyCaveRisk(worldOptions, surfaceY, spawn, candidate)) {
    return null;
  }

  return candidate;
}

function pondCandidateHasNearbyCaveRisk(worldOptions, surfaceY, spawn, pond) {
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
      const topProbeY = Math.min(column.topY - CAVE_MIN_SURFACE_ROOF, pond.waterLevel - 2);

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

        const column = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
        const biomeProfile = column.biomeProfile;
        const decorationFeature = biomeProfile.biomeModule?.getDecorationFeature
          ? biomeProfile.biomeModule.getDecorationFeature({
            column,
            worldOptions,
            worldX,
            worldZ,
            topY,
            topStateId,
            hashNoise2d,
            valueNoise2d
          })
          : (() => {
            const decorationStyle = biomeProfile.decorationStyle;
            const decorationStateId = getDecorationStateId(
              worldOptions,
              decorationStyle,
              worldX,
              worldZ,
              topY,
              topStateId
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

function sealPondEnvelope(chunk, chunkX, chunkZ, pond, supportStateId) {
  const sealRadius = pond.radius + POND_SHORE_WIDTH + 1;
  const minSealY = pond.waterLevel - POND_MIN_FLOOR_THICKNESS;

  for (let worldX = pond.centerX - sealRadius; worldX <= pond.centerX + sealRadius; worldX++) {
    for (let worldZ = pond.centerZ - sealRadius; worldZ <= pond.centerZ + sealRadius; worldZ++) {
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

        if (stateId === 0) {
          chunk.setBlockStateId(position, supportStateId);
        }
      }
    }
  }
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
          reinforcePondFloor(chunk, localX, localZ, actualFloorY, worldOptions.foundationBlockStateId);
          for (let y = actualFloorY + 1; y <= pond.waterLevel; y++) {
            chunk.setBlockStateId(new Vec3(localX, y, localZ), worldOptions.terrainBlockStateIds.water);
          }
          continue;
        }

        if (distance <= pond.radius) {
          const shelfFloorY = pond.waterLevel - 1;
          const actualShelfFloorY = shapeColumnTop(chunk, localX, localZ, shelfFloorY, pond.shoreBlockStateId);
          reinforcePondFloor(chunk, localX, localZ, actualShelfFloorY, worldOptions.foundationBlockStateId);
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

    sealPondEnvelope(chunk, chunkX, chunkZ, pond, worldOptions.foundationBlockStateId);
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

function getPondCellRangeForChunk(chunkX, chunkZ) {
  return {
    minCellX: Math.floor(((chunkX * 16) - POND_MAX_RADIUS - 1) / POND_CELL_SIZE),
    maxCellX: Math.floor((((chunkX + 1) * 16) - 1 + POND_MAX_RADIUS + 1) / POND_CELL_SIZE),
    minCellZ: Math.floor(((chunkZ * 16) - POND_MAX_RADIUS - 1) / POND_CELL_SIZE),
    maxCellZ: Math.floor((((chunkZ + 1) * 16) - 1 + POND_MAX_RADIUS + 1) / POND_CELL_SIZE)
  };
}

function getTreeCellRangeForChunk(chunkX, chunkZ) {
  return {
    minCellX: Math.floor(((chunkX * 16) - TREE_CANOPY_RADIUS) / TREE_CELL_SIZE),
    maxCellX: Math.floor((((chunkX + 1) * 16) - 1 + TREE_CANOPY_RADIUS) / TREE_CELL_SIZE),
    minCellZ: Math.floor(((chunkZ * 16) - TREE_CANOPY_RADIUS) / TREE_CELL_SIZE),
    maxCellZ: Math.floor((((chunkZ + 1) * 16) - 1 + TREE_CANOPY_RADIUS) / TREE_CELL_SIZE)
  };
}

function collectPopulationFeaturesForChunk(worldOptions, surfaceY, spawn, chunkX, chunkZ) {
  const ponds = [];
  const pondCellRange = getPondCellRangeForChunk(chunkX, chunkZ);

  for (let cellX = pondCellRange.minCellX; cellX <= pondCellRange.maxCellX; cellX++) {
    for (let cellZ = pondCellRange.minCellZ; cellZ <= pondCellRange.maxCellZ; cellZ++) {
      const pond = getPondCandidate(worldOptions, surfaceY, spawn, cellX, cellZ);

      if (pond) {
        ponds.push(pond);
      }
    }
  }

  const trees = [];
  const treeCellRange = getTreeCellRangeForChunk(chunkX, chunkZ);

  for (let cellX = treeCellRange.minCellX; cellX <= treeCellRange.maxCellX; cellX++) {
    for (let cellZ = treeCellRange.minCellZ; cellZ <= treeCellRange.maxCellZ; cellZ++) {
      const tree = getTreeCandidate(worldOptions, surfaceY, spawn, cellX, cellZ);

      if (!tree) {
        continue;
      }

      if (ponds.some((pond) => doesTreeOverlapPond(tree, pond))) {
        continue;
      }

      trees.push(tree);
    }
  }

  return { ponds, trees };
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

  if (column.waterTopY !== null) {
    return false;
  }

  if (worldY >= column.topY - CAVE_MIN_SURFACE_ROOF) {
    return false;
  }

  if (worldY <= column.floorStartY + 1) {
    return false;
  }

  const caveDepth = column.topY - worldY;

  if (caveDepth < CAVE_MIN_SURFACE_ROOF) {
    return false;
  }

  const caveThreshold = caveDepth > 8 ? 1.72 : 1.88;
  return getCaveSignal(worldOptions, worldX, worldY, worldZ) > caveThreshold;
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

function createGeneratedChunk(worldOptions, surfaceY, spawn, chunkX, chunkZ) {
  const chunk = new Chunk();
  const populationFeatures = collectPopulationFeaturesForChunk(worldOptions, surfaceY, spawn, chunkX, chunkZ);

  for (let localX = 0; localX < 16; localX++) {
    for (let localZ = 0; localZ < 16; localZ++) {
      const worldX = (chunkX * 16) + localX;
      const worldZ = (chunkZ * 16) + localZ;
      const column = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
      const { biomeProfile, floorStartY, soilStartY, topBlockStateId, topY } = column;

      for (let y = floorStartY; y < topY; y++) {
        if (
          !isBelowPondFootprint(worldX, y, worldZ, populationFeatures.ponds) &&
          shouldCarveCave(worldOptions, spawn, column, worldX, y, worldZ)
        ) {
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

      if (column.waterTopY !== null) {
        for (let y = column.waterBottomY ?? (topY + 1); y <= column.waterTopY; y++) {
          chunk.setBlockStateId(new Vec3(localX, y, localZ), worldOptions.terrainBlockStateIds.water);
        }
      }

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

  for (const pond of populationFeatures.ponds) {
    applyPondToChunk(chunk, chunkX, chunkZ, pond, worldOptions);
  }

  for (const tree of populationFeatures.trees) {
    applyTreeToChunk(chunk, chunkX, chunkZ, tree);
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

function countSectionFluidBlocks(chunk, sectionIndex, fluidStateId, maxFluidStateId = fluidStateId) {
  if (!Number.isInteger(fluidStateId) || !Number.isInteger(maxFluidStateId)) {
    return 0;
  }

  const sectionBaseY = chunk.minY + (sectionIndex * 16);
  let count = 0;

  for (let localY = 0; localY < 16; localY++) {
    for (let localZ = 0; localZ < 16; localZ++) {
      for (let localX = 0; localX < 16; localX++) {
        const stateId = chunk.getBlockStateId(new Vec3(localX, sectionBaseY + localY, localZ));

        if (stateId >= fluidStateId && stateId <= maxFluidStateId) {
          count += 1;
        }
      }
    }
  }

  return count;
}

function countSectionNonEmptyBlocks(chunk, sectionIndex) {
  const sectionBaseY = chunk.minY + (sectionIndex * 16);
  let count = 0;

  for (let localY = 0; localY < 16; localY++) {
    for (let localZ = 0; localZ < 16; localZ++) {
      for (let localX = 0; localX < 16; localX++) {
        if (chunk.getBlockStateId(new Vec3(localX, sectionBaseY + localY, localZ)) !== 0) {
          count += 1;
        }
      }
    }
  }

  return count;
}

function createChunkTemplate(chunk, surfaceY, worldOptions) {
  return {
    heightmaps: createHeightmapData(chunk, surfaceY),
    chunkData: encodeChunkData(chunk, worldOptions),
    blockEntities: []
  };
}

function createTranslatedChunk(sourceChunk, translateStateId) {
  const translatedChunk = new Chunk();

  for (let y = sourceChunk.minY; y < sourceChunk.minY + sourceChunk.worldHeight; y++) {
    for (let localZ = 0; localZ < 16; localZ++) {
      for (let localX = 0; localX < 16; localX++) {
        const position = new Vec3(localX, y, localZ);
        const stateId = sourceChunk.getBlockStateId(position);

        if (stateId !== 0) {
          translatedChunk.setBlockStateId(position, translateStateId(stateId));
        }

        translatedChunk.setSkyLight(position, sourceChunk.getSkyLight(position));
        translatedChunk.setBlockLight(position, sourceChunk.getBlockLight(position));
      }
    }
  }

  for (let y = sourceChunk.minY; y < sourceChunk.minY + sourceChunk.worldHeight; y += 4) {
    for (let localZ = 0; localZ < 16; localZ += 4) {
      for (let localX = 0; localX < 16; localX += 4) {
        const position = new Vec3(localX, y, localZ);
        translatedChunk.setBiome(position, sourceChunk.getBiome(position));
      }
    }
  }

  return translatedChunk;
}

function encodeChunkData(chunk, worldOptions) {
  const buffer = new SmartBuffer();

  for (let index = 0; index < chunk.sections.length; index++) {
    const section = chunk.sections[index];
    const biome = chunk.biomes[index];
    const nonEmptyBlockCount = countSectionNonEmptyBlocks(chunk, index);
    const fluidCount = countSectionFluidBlocks(
      chunk,
      index,
      worldOptions?.terrainBlockStateIds?.water,
      worldOptions?.terrainBlockStateIds?.waterMax
    );

    buffer.writeInt16BE(nonEmptyBlockCount);
    buffer.writeInt16BE(fluidCount);
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
  const minBuildY = new Chunk().minY + 1;
  const waterSourceStateId = worldOptions.terrainBlockStateIds.water;
  const maxWaterStateId = worldOptions.terrainBlockStateIds.waterMax;
  const lightTemplate = createChunkLightTemplate(
    createGeneratedChunk(worldOptions, surfaceY, config.spawn, spawnChunk.x, spawnChunk.z)
  );
  const chunks = new Map();
  const generatedChunks = new Map();
  const modifiedBlocks = new Map();

  function ensureChunk(chunkX, chunkZ) {
    const chunkKey = getChunkKey(chunkX, chunkZ);

    if (!chunks.has(chunkKey)) {
      const chunk = createGeneratedChunk(worldOptions, surfaceY, config.spawn, chunkX, chunkZ);
      chunks.set(chunkKey, { chunkX, chunkZ, chunk });
    }

    return chunks.get(chunkKey);
  }

  function ensureGeneratedChunk(chunkX, chunkZ) {
    const chunkKey = getChunkKey(chunkX, chunkZ);

    if (!generatedChunks.has(chunkKey)) {
      generatedChunks.set(
        chunkKey,
        createGeneratedChunk(worldOptions, surfaceY, config.spawn, chunkX, chunkZ)
      );
    }

    return generatedChunks.get(chunkKey);
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

    return normalizedPosition.y >= minBuildY && normalizedPosition.y <= maxBuildY;
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
    const generatedChunk = ensureGeneratedChunk(chunkX, chunkZ);

    return generatedChunk.getBlockStateId(localPosition);
  }

  function getBaseBlockState(position) {
    return getGeneratedBlockState(position);
  }

  function isWaterStateId(stateId) {
    return Number.isInteger(stateId) && stateId >= waterSourceStateId && stateId <= maxWaterStateId;
  }

  function getWaterDistanceFromStateId(stateId) {
    if (!isWaterStateId(stateId)) {
      return null;
    }

    const rawLevel = stateId - waterSourceStateId;
    return rawLevel >= 8 ? rawLevel - 8 : rawLevel;
  }

  function getWaterStateId(level = 0, falling = false) {
    return waterSourceStateId + clamp(level, 0, WATER_FLOW_MAX_LEVEL) + (falling ? 8 : 0);
  }

  function isEmptyBoundingBoxStateId(stateId) {
    if (stateId === airBlockStateId) {
      return true;
    }

    const blockDefinition = mcData.blocksByStateId[stateId];
    return blockDefinition?.boundingBox === 'empty';
  }

  function canWaterOccupyStateId(stateId) {
    return isWaterStateId(stateId) || isEmptyBoundingBoxStateId(stateId);
  }

  function canWaterRestOnStateId(stateId) {
    return isWaterStateId(stateId) || !isEmptyBoundingBoxStateId(stateId);
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

  function recomputeWaterAround(position) {
    const normalizedCenter = normalizePosition(position);

    if (!normalizedCenter || !isWithinBuildBounds(normalizedCenter)) {
      return [];
    }

    const minFlowY = clamp(
      normalizedCenter.y - WATER_FLOW_VERTICAL_DOWN_RADIUS,
      floorStartY,
      maxBuildY
    );
    const maxFlowY = clamp(
      normalizedCenter.y + WATER_FLOW_VERTICAL_UP_RADIUS,
      floorStartY,
      maxBuildY
    );
    const minFlowX = normalizedCenter.x - WATER_FLOW_HORIZONTAL_RADIUS;
    const maxFlowX = normalizedCenter.x + WATER_FLOW_HORIZONTAL_RADIUS;
    const minFlowZ = normalizedCenter.z - WATER_FLOW_HORIZONTAL_RADIUS;
    const maxFlowZ = normalizedCenter.z + WATER_FLOW_HORIZONTAL_RADIUS;
    const currentStates = new Map();
    const sourceKeys = new Set();
    const sampledPositions = [];

    function makeKey(x, y, z) {
      return `${x},${y},${z}`;
    }

    function getStateFromMap(stateMap, x, y, z) {
      return stateMap.get(makeKey(x, y, z)) ?? airBlockStateId;
    }

    for (let y = minFlowY; y <= maxFlowY; y++) {
      for (let z = minFlowZ; z <= maxFlowZ; z++) {
        for (let x = minFlowX; x <= maxFlowX; x++) {
          const sampledPosition = { x, y, z };
          const key = makeKey(x, y, z);

          sampledPositions.push(sampledPosition);
          currentStates.set(key, getBlockState(sampledPosition));

          if (getBaseBlockState(sampledPosition) === waterSourceStateId) {
            sourceKeys.add(key);
          }
        }
      }
    }

    for (let iteration = 0; iteration < WATER_FLOW_MAX_ITERATIONS; iteration++) {
      let changed = false;
      const nextStates = new Map(currentStates);

      for (let y = maxFlowY; y >= minFlowY; y--) {
        for (let z = minFlowZ; z <= maxFlowZ; z++) {
          for (let x = minFlowX; x <= maxFlowX; x++) {
            const key = makeKey(x, y, z);
            const currentStateId = currentStates.get(key) ?? airBlockStateId;

            if (sourceKeys.has(key)) {
              if (currentStateId !== waterSourceStateId) {
                nextStates.set(key, waterSourceStateId);
                changed = true;
              }

              continue;
            }

            if (!canWaterOccupyStateId(currentStateId)) {
              continue;
            }

            let desiredStateId = isWaterStateId(currentStateId) ? airBlockStateId : currentStateId;
            const aboveStateId = y < maxFlowY
              ? getStateFromMap(currentStates, x, y + 1, z)
              : airBlockStateId;

            if (isWaterStateId(aboveStateId)) {
              desiredStateId = getWaterStateId(getWaterDistanceFromStateId(aboveStateId) ?? 0, true);
            } else {
              let minNeighborDistance = Number.POSITIVE_INFINITY;

              for (const [offsetX, offsetZ] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const neighborStateId = getStateFromMap(currentStates, x + offsetX, y, z + offsetZ);

                if (!isWaterStateId(neighborStateId)) {
                  continue;
                }

                const neighborDistance = getWaterDistanceFromStateId(neighborStateId);

                if (neighborDistance !== null) {
                  minNeighborDistance = Math.min(minNeighborDistance, neighborDistance);
                }
              }

              if (Number.isFinite(minNeighborDistance) && minNeighborDistance < WATER_FLOW_MAX_LEVEL) {
                const belowStateId = y > minFlowY
                  ? getStateFromMap(currentStates, x, y - 1, z)
                  : airBlockStateId;
                desiredStateId = getWaterStateId(
                  minNeighborDistance + 1,
                  !canWaterRestOnStateId(belowStateId)
                );
              }
            }

            if (desiredStateId !== currentStateId) {
              nextStates.set(key, desiredStateId);
              changed = true;
            }
          }
        }
      }

      currentStates.clear();

      for (const [key, value] of nextStates.entries()) {
        currentStates.set(key, value);
      }

      if (!changed) {
        break;
      }
    }

    const changedPositions = [];

    for (const sampledPosition of sampledPositions) {
      const key = makeKey(sampledPosition.x, sampledPosition.y, sampledPosition.z);
      const currentStateId = getBlockState(sampledPosition);
      const desiredStateId = currentStates.get(key) ?? airBlockStateId;

      if (desiredStateId === currentStateId) {
        continue;
      }

      if (setBlockState(sampledPosition, desiredStateId)) {
        changedPositions.push(normalizePosition(sampledPosition));
      }
    }

    return changedPositions;
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

    const changedPositions = [normalizedPosition, ...recomputeWaterAround(normalizedPosition)];

    return {
      changedPositions,
      droppedItem: Number.isInteger(droppedItemId)
        ? { itemId: droppedItemId, count: 1 }
        : null,
      position: normalizedPosition,
      stateId: currentStateId
    };
  }

  function placeBlockDetailed(position, stateId = placementBlockStateId) {
    const normalizedPosition = normalizePosition(position);

    if (!isWithinBuildBounds(normalizedPosition)) {
      return false;
    }

    const currentStateId = getBlockState(normalizedPosition);

    if (currentStateId !== airBlockStateId && !isWaterStateId(currentStateId)) {
      return false;
    }

    if (!setBlockState(normalizedPosition, stateId)) {
      return false;
    }

    return {
      changedPositions: [normalizedPosition, ...recomputeWaterAround(normalizedPosition)],
      position: normalizedPosition,
      stateId
    };
  }

  function placeBlock(position, stateId = placementBlockStateId) {
    return Boolean(placeBlockDetailed(position, stateId));
  }

  function createChunkPackets() {
    return getChunkPackets(spawnChunk.x, spawnChunk.z, worldOptions.chunkRadius);
  }

  function getChunkPacket(chunkX, chunkZ, translateStateId = null) {
    const { chunk } = ensureChunk(chunkX, chunkZ);
    const packetChunk = typeof translateStateId === 'function'
      ? createTranslatedChunk(chunk, translateStateId)
      : chunk;

    return createChunkPacket(chunkX, chunkZ, {
      ...createChunkTemplate(packetChunk, surfaceY, worldOptions),
      ...lightTemplate
    });
  }

  function getChunkPackets(centerChunkX, centerChunkZ, radius, translateStateId = null) {
    const packets = [];

    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        packets.push(getChunkPacket(centerChunkX + dx, centerChunkZ + dz, translateStateId));
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
    placeBlockDetailed,
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
    biomeMetadata: {
      birch_forest: biomes.birchForest.metadata,
      flower_forest: biomes.flowerForest.metadata,
      forest: biomes.forest.metadata,
      old_growth_birch_forest: biomes.oldGrowthBirchForest.metadata,
      plains: biomes.plains.metadata,
      river: biomes.river.metadata,
      sunflower_plains: biomes.sunflowerPlains.metadata,
      taiga: biomes.taiga.metadata
    },
    topBlockStateId,
    treeBlockStateIds: worldOptions.treeBlockStateIds
    ,
    populationFeaturePasses: ['ponds', 'trees', 'decorations']
  };
}

module.exports = {
  createInitialWorldPackets
};
