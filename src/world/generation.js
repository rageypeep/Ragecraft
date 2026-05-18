const Chunk = require('prismarine-chunk')('1.21.11');
const Vec3 = require('vec3');
const biomes = require('../biomes');
const treeObjects = require('./objects/trees');
const pondObjects = require('./objects/ponds');
const decorationObjects = require('./objects/decorations');

const SEA_LEVEL_Y = 63;
const SURFACE_REFERENCE_Y = SEA_LEVEL_Y + 1;
const BEDROCK_MAX_THICKNESS = 5;
const TREE_SPAWN_CLEAR_RADIUS = treeObjects.TREE_SPAWN_CLEAR_RADIUS;
const CAVE_SPAWN_CLEAR_RADIUS = 18;
const CAVE_MIN_SURFACE_ROOF = 7;
const WATER_SPAWN_CLEAR_RADIUS = 16;
const DECORATION_SPAWN_CLEAR_RADIUS = 8;
const SPAWN_TERRAIN_CLEAR_RADIUS = 24;
const SPAWN_MAJOR_WATER_CLEAR_RADIUS = 56;
const LAND_CLIMATE_SELECTION_CACHE = new Map();
const COLUMN_CLIMATE_CACHE = new Map();
const TERRAIN_HEIGHT_CACHE = new Map();
const COLUMN_DESCRIPTOR_CACHE = new Map();

const DEFAULT_WORLD_OPTIONS = {
  biome: 'taiga',
  mixedBiomes: true,
  seed: 'thisisjustatestseed',
  chunkRadius: 2,
  streamRadius: null,
  foundationBlock: 'stone',
  soilBlock: 'dirt',
  surfaceBlock: 'grass_block',
  terrainAmplitude: 4,
  terrainThickness: 12
};

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
  return clamp(SURFACE_REFERENCE_Y, minSurfaceY, maxSurfaceY);
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
  const probeChunk = new Chunk();
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
      beach: resolveBiomeId(mcData, ['beach'], fallbackBiomeId),
      lake: resolveBiomeId(mcData, ['river', 'swamp'], fallbackBiomeId),
      ocean: resolveBiomeId(mcData, ['ocean'], fallbackBiomeId),
      plains: resolveBiomeId(mcData, ['plains'], fallbackBiomeId),
      river: resolveBiomeId(mcData, ['river'], fallbackBiomeId),
      stonyShore: resolveBiomeId(mcData, ['stony_shore', 'stone_shore'], fallbackBiomeId),
      sunflowerPlains: resolveBiomeId(mcData, ['sunflower_plains', 'plains'], fallbackBiomeId),
      flowerForest: resolveBiomeId(mcData, ['flower_forest', 'forest'], fallbackBiomeId),
      forest: resolveBiomeId(mcData, ['forest'], fallbackBiomeId),
      taiga: resolveBiomeId(mcData, ['taiga'], fallbackBiomeId),
      birchForest: resolveBiomeId(mcData, ['birch_forest'], fallbackBiomeId),
      oldGrowthBirchForest: resolveBiomeId(mcData, ['old_growth_birch_forest', 'birch_forest'], fallbackBiomeId),
      desert: resolveBiomeId(mcData, ['desert'], fallbackBiomeId),
      swamp: resolveBiomeId(mcData, ['swamp'], fallbackBiomeId),
      snowyPlains: resolveBiomeId(mcData, ['snowy_plains', 'snowy_tundra', 'plains'], fallbackBiomeId)
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
      sweetBerryBush: resolveConfiguredBlockStateId(mcData, 'sweet_berry_bush', 'air'),
      deadBush: resolveConfiguredBlockStateId(mcData, 'dead_bush', 'air'),
      cactusLower: resolveConfiguredBlockStateId(mcData, 'cactus', 'air'),
      cactusUpper: resolveConfiguredBlockStateId(mcData, 'cactus', 'air'),
      lilyPad: resolveConfiguredBlockStateId(mcData, 'lily_pad', 'air')
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
      bedrock: resolveConfiguredBlockStateId(mcData, 'bedrock', worldConfig.foundationBlock),
      mud: resolveConfiguredBlockStateId(mcData, 'mud', worldConfig.soilBlock),
      podzol: resolveConfiguredBlockStateId(mcData, 'podzol', worldConfig.surfaceBlock),
      rootedDirt: resolveConfiguredBlockStateId(mcData, 'rooted_dirt', worldConfig.soilBlock),
      sand: resolveConfiguredBlockStateId(mcData, 'sand', worldConfig.soilBlock),
      sandstone: resolveConfiguredBlockStateId(mcData, 'sandstone', worldConfig.foundationBlock),
      snow: resolveConfiguredBlockStateId(mcData, 'snow', 'air'),
      snowBlock: resolveConfiguredBlockStateId(mcData, 'snow_block', worldConfig.surfaceBlock),
      ice: resolveConfiguredBlockStateId(mcData, 'ice', 'water'),
      stone: resolveConfiguredBlockStateId(mcData, 'stone', worldConfig.foundationBlock),
      deepslate: resolveConfiguredBlockStateId(mcData, 'deepslate', worldConfig.foundationBlock),
      tuff: resolveConfiguredBlockStateId(mcData, 'tuff', worldConfig.foundationBlock),
      goldOre: resolveConfiguredBlockStateId(mcData, 'gold_ore', worldConfig.foundationBlock),
      deepslateGoldOre: resolveConfiguredBlockStateId(mcData, 'deepslate_gold_ore', worldConfig.foundationBlock),
      diamondOre: resolveConfiguredBlockStateId(mcData, 'diamond_ore', worldConfig.foundationBlock),
      deepslateDiamondOre: resolveConfiguredBlockStateId(mcData, 'deepslate_diamond_ore', worldConfig.foundationBlock),
      lapisOre: resolveConfiguredBlockStateId(mcData, 'lapis_ore', worldConfig.foundationBlock),
      deepslateLapisOre: resolveConfiguredBlockStateId(mcData, 'deepslate_lapis_ore', worldConfig.foundationBlock),
      redstoneOre: resolveConfiguredBlockStateId(mcData, 'redstone_ore', worldConfig.foundationBlock),
      deepslateRedstoneOre: resolveConfiguredBlockStateId(mcData, 'deepslate_redstone_ore', worldConfig.foundationBlock),
      emeraldOre: resolveConfiguredBlockStateId(mcData, 'emerald_ore', worldConfig.foundationBlock),
      deepslateEmeraldOre: resolveConfiguredBlockStateId(mcData, 'deepslate_emerald_ore', worldConfig.foundationBlock),
      deepslateIronOre: resolveConfiguredBlockStateId(mcData, 'deepslate_iron_ore', worldConfig.foundationBlock),
      deepslateCopperOre: resolveConfiguredBlockStateId(mcData, 'deepslate_copper_ore', worldConfig.foundationBlock),
      deepslateCoalOre: resolveConfiguredBlockStateId(mcData, 'deepslate_coal_ore', worldConfig.foundationBlock),
      water: resolveConfiguredBlockStateId(mcData, 'water', 'air'),
      waterMax: mcData.blocksByName.water?.maxStateId ?? resolveConfiguredBlockStateId(mcData, 'water', 'air')
    },
    useBiomeSurfacePalettes,
    useNaturalUndergroundGeneration,
    terrainAmplitude: Math.max(0, worldConfig.terrainAmplitude),
    terrainThickness: Math.max(4, worldConfig.terrainThickness),
    minWorldY: probeChunk.minY,
    maxWorldY: probeChunk.minY + probeChunk.worldHeight - 1,
    _terrainHeightCache: new Map(),
    _columnDescriptorCache: new Map()
  };
}

function getContinentalnessNoise(worldX, worldZ, seedOffset = 0) {
  return fbmNoise2d(worldX, worldZ, seedOffset + 1177, {
    frequency: 0.0019,
    octaves: 5,
    persistence: 0.58,
    lacunarity: 2.04
  });
}

function getErosionNoise(worldX, worldZ, seedOffset = 0) {
  return fbmNoise2d(worldX, worldZ, seedOffset + 1213, {
    frequency: 0.0048,
    octaves: 4,
    persistence: 0.55,
    lacunarity: 2.12
  });
}

function getRiverSignedNoise(worldX, worldZ, seedOffset = 0) {
  const warpedX = worldX + (signedValueNoise2d(worldX, worldZ, seedOffset + 1523, 0.0047) * 42);
  const warpedZ = worldZ + (signedValueNoise2d(worldX, worldZ, seedOffset + 1549, 0.0047) * 42);

  const meanderWarpX = warpedX + (signedValueNoise2d(warpedX, warpedZ, seedOffset + 1563, 0.0018) * 76);
  const meanderWarpZ = warpedZ + (signedValueNoise2d(warpedX, warpedZ, seedOffset + 1589, 0.0018) * 76);

  return signedValueNoise2d(meanderWarpX, meanderWarpZ, seedOffset + 1571, 0.0024);
}

function getTrunkRiverSignedNoise(worldX, worldZ, seedOffset = 0) {
  const warpedX = worldX + (signedValueNoise2d(worldX, worldZ, seedOffset + 1493, 0.0024) * 88);
  const warpedZ = worldZ + (signedValueNoise2d(worldX, worldZ, seedOffset + 1507, 0.0024) * 88);
  const meanderWarpX = warpedX + (signedValueNoise2d(warpedX, warpedZ, seedOffset + 1519, 0.0011) * 132);
  const meanderWarpZ = warpedZ + (signedValueNoise2d(warpedX, warpedZ, seedOffset + 1531, 0.0011) * 132);

  return signedValueNoise2d(meanderWarpX, meanderWarpZ, seedOffset + 1543, 0.00145);
}

function getRiverDistanceNoise(worldX, worldZ, seedOffset = 0) {
  return Math.abs(getRiverSignedNoise(worldX, worldZ, seedOffset));
}

function getRiverWidthNoise(worldX, worldZ, seedOffset = 0) {
  const warpedX = worldX + (signedValueNoise2d(worldX, worldZ, seedOffset + 1597, 0.0061) * 28);
  const warpedZ = worldZ + (signedValueNoise2d(worldX, worldZ, seedOffset + 1609, 0.0061) * 28);

  return valueNoise2d(warpedX, warpedZ, seedOffset + 1637, 0.0054);
}

function getRiverNetworkData(worldOptions, worldX, worldZ, terrainMetrics, climate, forcedRiverWorld = false) {
  const trunkBias = signedValueNoise2d(worldX, worldZ, worldOptions.seedHash + 1651, 0.0034) * 0.018;
  const tributaryBias = signedValueNoise2d(worldX, worldZ, worldOptions.seedHash + 1681, 0.0065) * 0.028;
  const trunkSignal = getTrunkRiverSignedNoise(worldX, worldZ, worldOptions.seedHash) + trunkBias;
  const tributarySignal = getRiverSignedNoise(worldX, worldZ, worldOptions.seedHash) + tributaryBias;
  const trunkDistance = Math.abs(trunkSignal);
  const tributaryDistance = Math.abs(tributarySignal);
  const trunkWidth = (forcedRiverWorld ? 0.17 : 0.1) +
    (getRiverWidthNoise(worldX, worldZ, worldOptions.seedHash + 31) * 0.044) +
    ((forcedRiverWorld ? 1 : terrainMetrics.inlandness) * 0.028);
  const tributaryWidth = (forcedRiverWorld ? 0.14 : 0.078) +
    (getRiverWidthNoise(worldX, worldZ, worldOptions.seedHash + 67) * 0.03) +
    ((forcedRiverWorld ? 1 : terrainMetrics.inlandness) * 0.016);
  const trunkEdgeNoise = signedValueNoise2d(worldX, worldZ, worldOptions.seedHash + 1711, 0.0095) * 0.018;
  const tributaryEdgeNoise = signedValueNoise2d(worldX, worldZ, worldOptions.seedHash + 1717, 0.017) * 0.035;
  const valleyFactor = smoothstep(clamp((-climate.weirdness + 0.1) / 0.55, 0, 1));
  const wetFactor = smoothstep(clamp((climate.moisture + 0.05) / 0.7, 0, 1));
  const drainageFactor = forcedRiverWorld
    ? 1
    : clamp(
      (terrainMetrics.inlandness * 0.5) +
      (valleyFactor * 0.34) +
      (wetFactor * 0.22) -
      0.08,
      0,
      1
    );
  const trunkBlend = (1 - smoothstep(clamp((trunkDistance + trunkEdgeNoise) / trunkWidth, 0, 1))) * drainageFactor;
  const tributaryBlend = (1 - smoothstep(clamp((tributaryDistance + tributaryEdgeNoise) / tributaryWidth, 0, 1))) * drainageFactor;
  const confluenceBlend = Math.min(trunkBlend, tributaryBlend);
  const useTrunk = trunkBlend >= tributaryBlend;
  const primarySignal = useTrunk ? trunkSignal : tributarySignal;
  const primaryDistance = useTrunk ? trunkDistance : tributaryDistance;
  const primaryWidth = (useTrunk ? trunkWidth : tributaryWidth) + (confluenceBlend * 0.028);
  const networkBlend = Math.max(trunkBlend, tributaryBlend);

  return {
    confluenceBlend,
    networkBlend,
    primaryDistance,
    primarySignal,
    primaryWidth,
    tributaryBlend,
    trunkBlend,
    useTrunk
  };
}

function getSpawnTerrainBlend(spawn, worldX, worldZ, radius = SPAWN_TERRAIN_CLEAR_RADIUS) {
  const distance = Math.max(
    Math.abs(worldX - Math.floor(spawn.x)),
    Math.abs(worldZ - Math.floor(spawn.z))
  );

  return 1 - smoothstep(clamp(distance / radius, 0, 1));
}

function getSpawnMajorWaterBlend(spawn, worldX, worldZ) {
  return getSpawnTerrainBlend(spawn, worldX, worldZ, SPAWN_MAJOR_WATER_CLEAR_RADIUS);
}

function getTerrainMetrics(worldX, worldZ, surfaceY, amplitude, seedOffset = 0) {
  const cacheKey = `${worldX},${worldZ},${surfaceY},${amplitude},${seedOffset}`;

  if (TERRAIN_HEIGHT_CACHE.has(cacheKey)) {
    return TERRAIN_HEIGHT_CACHE.get(cacheKey);
  }

  const waterLevel = surfaceY - 1;
  const continentalness = getContinentalnessNoise(worldX, worldZ, seedOffset);
  const erosion = getErosionNoise(worldX, worldZ, seedOffset);
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
  const mountainWarpX = worldX + (signedValueNoise2d(worldX, worldZ, seedOffset + 557, 0.0042) * 56);
  const mountainWarpZ = worldZ + (signedValueNoise2d(worldX, worldZ, seedOffset + 569, 0.0042) * 56);
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
  const mountainShape = fbmNoise2d(mountainWarpX, mountainWarpZ, seedOffset + 887, {
    frequency: 0.0044,
    octaves: 4,
    persistence: 0.55,
    lacunarity: 2.12
  });
  const mountainRidges = ridgeNoise2d(mountainWarpX, mountainWarpZ, seedOffset + 941, {
    frequency: 0.0095,
    octaves: 4,
    persistence: 0.58,
    lacunarity: 2.06
  });
  const escarpmentSignal = signedValueNoise2d(
    (mountainWarpX * 0.68) + (mountainWarpZ * 0.14),
    (mountainWarpZ * 0.66) - (mountainWarpX * 0.11),
    seedOffset + 983,
    0.016
  );
  const alpineReliefNoise = fbmNoise2d(mountainWarpX, mountainWarpZ, seedOffset + 1027, {
    frequency: 0.0115,
    octaves: 3,
    persistence: 0.54,
    lacunarity: 2.08
  });
  const rarePeakNoise = ridgeNoise2d(mountainWarpX, mountainWarpZ, seedOffset + 1089, {
    frequency: 0.0036,
    octaves: 3,
    persistence: 0.57,
    lacunarity: 2.02
  });
  const ultraPeakNoise = valueNoise2d(mountainWarpX, mountainWarpZ, seedOffset + 1127, 0.0018);
  const continentalFactor = smoothstep(clamp((continentalness + 0.72) / 1.7, 0, 1));
  const inlandness = smoothstep(clamp((continentalness + 0.28) / 1.05, 0, 1));
  const ruggedness = 1 - smoothstep(clamp((erosion + 1) / 2, 0, 1));
  const mountainMask = smoothstep(clamp((inlandness - 0.2) / 0.5, 0, 1)) *
    smoothstep(clamp((ruggedness - 0.14) / 0.5, 0, 1));
  const mountainRegion = smoothstep(clamp((mountainShape - 0.02) / 0.34, 0, 1)) * mountainMask;
  const mountainCore = smoothstep(clamp((mountainShape + (mountainRidges * 0.18) - 0.12) / 0.26, 0, 1)) * mountainMask;
  const highRangeMask = smoothstep(clamp((mountainRegion - 0.42) / 0.42, 0, 1));
  const continentalLift = lerp(-(amplitude * 0.5), amplitude * 5.1, continentalFactor);
  const macroRelief = macro * (amplitude * 1.2);
  const hillRelief = hills * (amplitude * (0.65 + (inlandness * 0.65)));
  const ridgeBoost = Math.max(0, ridges - (0.46 + (erosion * 0.08))) * (amplitude * (1.3 + (ruggedness * 1.2)));
  const cliffBoost = Math.max(0, cliffs - 0.68) * (amplitude * (0.95 + (ruggedness * 1.55)));
  const mountainPlateauLift = mountainRegion *
    (amplitude * (5.8 + (inlandness * 3.8) + (ruggedness * 3.2)));
  const mountainShoulderLift = mountainCore *
    (amplitude * (3.2 + (inlandness * 1.6) + (ruggedness * 1.8)));
  const alpineRelief = Math.max(0, alpineReliefNoise + (mountainRidges * 0.45) - 0.12) *
    (amplitude * (2.4 + (ruggedness * 2.8) + (mountainCore * 1.4))) *
    mountainCore;
  const peakBoost = Math.max(0, mountainRidges - (0.34 - (ruggedness * 0.06))) *
    (amplitude * (4.1 + (ruggedness * 4.4) + (inlandness * 1.6))) *
    mountainCore;
  const rarePeakMask = Math.pow(smoothstep(clamp((rarePeakNoise - 0.58) / 0.22, 0, 1)), 1.5) * mountainCore;
  const rarePeakBoost = rarePeakMask *
    (amplitude * (8.5 + (ruggedness * 6.8) + (inlandness * 2.8) + (highRangeMask * 4.2)));
  const ultraPeakMask = Math.pow(smoothstep(clamp((ultraPeakNoise - 0.84) / 0.12, 0, 1)), 2.4) * rarePeakMask;
  const ultraPeakBoost = ultraPeakMask *
    (amplitude * (14 + (ruggedness * 10) + (inlandness * 4)));
  const escarpmentBand = Math.max(0, 1 - (Math.abs(escarpmentSignal) / 0.17));
  const cliffFaceBoost = Math.pow(escarpmentBand, 2.35) *
    (amplitude * (1.2 + (ruggedness * 2.8) + (mountainCore * 1.4))) *
    mountainRegion;
  const valleyCut = Math.max(0, -valleyMask) * (amplitude * (0.55 + (inlandness * 0.85)));
  const terrainOffset =
    (amplitude * 1.15) +
    continentalLift +
    macroRelief +
    hillRelief +
    ridgeBoost +
    cliffBoost -
    valleyCut +
    mountainPlateauLift +
    mountainShoulderLift +
    alpineRelief +
    peakBoost +
    rarePeakBoost +
    ultraPeakBoost +
    cliffFaceBoost;
  const terrainMetrics = {
    cliffiness: clamp((cliffBoost + cliffFaceBoost + (peakBoost * 0.28) + (rarePeakBoost * 0.12)) / Math.max(1, amplitude * 12), 0, 1),
    continentalness,
    erosion,
    inlandness,
    mountainness: clamp(
      (mountainRegion * 0.52) +
      (mountainCore * 0.34) +
      ((mountainPlateauLift + mountainShoulderLift + peakBoost + rarePeakBoost) / Math.max(1, amplitude * 120)),
      0,
      1
    ),
    ruggedness,
    topY: waterLevel + Math.round(terrainOffset)
  };

  if (TERRAIN_HEIGHT_CACHE.size > 250000) {
    TERRAIN_HEIGHT_CACHE.clear();
  }

  TERRAIN_HEIGHT_CACHE.set(cacheKey, terrainMetrics);
  return terrainMetrics;
}

function getTerrainHeight(worldX, worldZ, surfaceY, amplitude, seedOffset = 0) {
  return getTerrainMetrics(worldX, worldZ, surfaceY, amplitude, seedOffset).topY;
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

function getBeachNoise(worldX, worldZ, seedOffset = 0) {
  return valueNoise2d(worldX, worldZ, seedOffset + 1119, 0.009);
}

function getOceanNoise(worldX, worldZ, seedOffset = 0) {
  return fbmNoise2d(worldX, worldZ, seedOffset + 1141, {
    frequency: 0.0044,
    octaves: 3,
    persistence: 0.55,
    lacunarity: 2
  });
}

function getOceanRegionNoise(worldX, worldZ, seedOffset = 0) {
  const warpedX = worldX + (signedValueNoise2d(worldX, worldZ, seedOffset + 1153, 0.0018) * 96);
  const warpedZ = worldZ + (signedValueNoise2d(worldX, worldZ, seedOffset + 1169, 0.0018) * 96);

  return fbmNoise2d(warpedX, warpedZ, seedOffset + 1187, {
    frequency: 0.00135,
    octaves: 3,
    persistence: 0.6,
    lacunarity: 2.08
  });
}

function getLakeRegionNoise(worldX, worldZ, seedOffset = 0) {
  const warpedX = worldX + (signedValueNoise2d(worldX, worldZ, seedOffset + 1201, 0.0024) * 58);
  const warpedZ = worldZ + (signedValueNoise2d(worldX, worldZ, seedOffset + 1229, 0.0024) * 58);

  return fbmNoise2d(warpedX, warpedZ, seedOffset + 1259, {
    frequency: 0.0021,
    octaves: 3,
    persistence: 0.58,
    lacunarity: 2.06
  });
}

function getLakePocketNoise(worldX, worldZ, seedOffset = 0) {
  const warpedX = worldX + (signedValueNoise2d(worldX, worldZ, seedOffset + 1277, 0.0085) * 18);
  const warpedZ = worldZ + (signedValueNoise2d(worldX, worldZ, seedOffset + 1291, 0.0085) * 18);

  return valueNoise2d(warpedX, warpedZ, seedOffset + 1307, 0.0072);
}

function getLegacyBiomeProfile(worldOptions, biomeKey) {
  if (biomeKey === 'beach') {
    return biomes.beach.createProfile(worldOptions);
  }

  if (biomeKey === 'ocean') {
    return biomes.ocean.createProfile(worldOptions);
  }

  if (biomeKey === 'lake') {
    return biomes.lake.createProfile(worldOptions);
  }

  if (biomeKey === 'river') {
    return biomes.plains.createProfile(worldOptions);
  }

  if (biomeKey === 'stonyShore') {
    return biomes.stonyShore.createProfile(worldOptions);
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

  if (biomeKey === 'desert') {
    return biomes.desert.createProfile(worldOptions);
  }

  if (biomeKey === 'swamp') {
    return biomes.swamp.createProfile(worldOptions);
  }

  if (biomeKey === 'snowyPlains') {
    return biomes.snowyPlains.createProfile(worldOptions);
  }

  return biomes.plains.createProfile(worldOptions);
}

function getForcedBiomeProfile(worldOptions) {
  if (worldOptions.biomeName.includes('ocean')) {
    return biomes.ocean.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('lake')) {
    return biomes.lake.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('beach')) {
    return biomes.beach.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('stony')) {
    return biomes.stonyShore.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('river')) {
    return biomes.plains.createProfile(worldOptions);
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

  if (worldOptions.biomeName.includes('desert')) {
    return biomes.desert.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('swamp')) {
    return biomes.swamp.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('snowy') || worldOptions.biomeName.includes('snow')) {
    return biomes.snowyPlains.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('plains') || worldOptions.biomeName.includes('meadow')) {
    return biomes.plains.createProfile(worldOptions);
  }

  return {
    ...getLegacyBiomeProfile(
      worldOptions,
      worldOptions.biomeName.includes('birch')
        ? 'birchForest'
        : worldOptions.biomeName.includes('forest')
          ? 'forest'
          : 'plains'
    ),
    allowWater: true
  };
}

function getTemperatureNoise(worldX, worldZ, seedOffset = 0) {
  const warpedX = worldX + (signedValueNoise2d(worldX, worldZ, seedOffset + 2111, 0.0022) * 68);
  const warpedZ = worldZ + (signedValueNoise2d(worldX, worldZ, seedOffset + 2137, 0.0022) * 68);

  return fbmNoise2d(warpedX, warpedZ, seedOffset + 2161, {
    frequency: 0.00185,
    octaves: 4,
    persistence: 0.58,
    lacunarity: 2.04
  });
}

function getMoistureNoise(worldX, worldZ, seedOffset = 0) {
  const warpedX = worldX + (signedValueNoise2d(worldX, worldZ, seedOffset + 2203, 0.0025) * 74);
  const warpedZ = worldZ + (signedValueNoise2d(worldX, worldZ, seedOffset + 2239, 0.0025) * 74);

  return fbmNoise2d(warpedX, warpedZ, seedOffset + 2273, {
    frequency: 0.00195,
    octaves: 4,
    persistence: 0.6,
    lacunarity: 2.08
  });
}

function getWeirdnessNoise(worldX, worldZ, seedOffset = 0) {
  return fbmNoise2d(worldX, worldZ, seedOffset + 2311, {
    frequency: 0.0034,
    octaves: 3,
    persistence: 0.56,
    lacunarity: 2.1
  });
}

function getClimateBandWeight(value, center, radius) {
  return 1 - smoothstep(clamp(Math.abs(value - center) / radius, 0, 1));
}

function getLandClimateSample(worldOptions, worldX, worldZ) {
  const continentalness = getContinentalnessNoise(worldX, worldZ, worldOptions.seedHash);
  const erosion = getErosionNoise(worldX, worldZ, worldOptions.seedHash);
  const inlandness = smoothstep(clamp((continentalness + 0.28) / 1.05, 0, 1));
  const ruggedness = 1 - smoothstep(clamp((erosion + 1) / 2, 0, 1));

  return {
    continentalness,
    erosion,
    inlandness,
    moisture: getMoistureNoise(worldX, worldZ, worldOptions.seedHash),
    ruggedness,
    temperature: getTemperatureNoise(worldX, worldZ, worldOptions.seedHash),
    weirdness: getWeirdnessNoise(worldX, worldZ, worldOptions.seedHash)
  };
}

function getClimateBiomeWeights(climate) {
  const flatFactor = 1 - smoothstep(clamp((climate.ruggedness - 0.32) / 0.42, 0, 1));
  const rollingFactor = getClimateBandWeight(climate.ruggedness, 0.38, 0.34);
  const ruggedFactor = smoothstep(clamp((climate.ruggedness - 0.34) / 0.42, 0, 1));
  const shelteredFactor = 1 - smoothstep(clamp((climate.erosion + 0.06) / 0.52, 0, 1));
  const warmWeirdness = smoothstep(clamp((climate.weirdness + 0.08) / 0.48, 0, 1));
  const coolWeirdness = smoothstep(clamp((-climate.weirdness + 0.12) / 0.52, 0, 1));

  return {
    birchForest: Math.max(0.001,
      getClimateBandWeight(climate.temperature, -0.08, 0.44) *
      getClimateBandWeight(climate.moisture, 0.12, 0.6) *
      (0.42 + (rollingFactor * 0.34) + (flatFactor * 0.24))
    ),
    flowerForest: Math.max(0.001,
      getClimateBandWeight(climate.temperature, 0.14, 0.5) *
      getClimateBandWeight(climate.moisture, 0.56, 0.42) *
      (0.34 + (rollingFactor * 0.26) + (warmWeirdness * 0.4))
    ),
    forest: Math.max(0.001,
      getClimateBandWeight(climate.temperature, 0.08, 0.66) *
      getClimateBandWeight(climate.moisture, 0.26, 0.62) *
      (0.4 + (rollingFactor * 0.34) + (shelteredFactor * 0.26))
    ),
    oldGrowthBirchForest: Math.max(0.001,
      getClimateBandWeight(climate.temperature, -0.2, 0.34) *
      getClimateBandWeight(climate.moisture, 0.42, 0.46) *
      (0.34 + (shelteredFactor * 0.28) + (climate.inlandness * 0.38))
    ),
    plains: Math.max(0.001,
      getClimateBandWeight(climate.temperature, 0.18, 0.8) *
      getClimateBandWeight(climate.moisture, -0.04, 0.95) *
      (0.48 + (flatFactor * 0.42) + ((1 - climate.inlandness) * 0.1))
    ),
    sunflowerPlains: Math.max(0.001,
      getClimateBandWeight(climate.temperature, 0.42, 0.48) *
      getClimateBandWeight(climate.moisture, -0.24, 0.52) *
      (0.34 + (flatFactor * 0.3) + (warmWeirdness * 0.36))
    ),
    taiga: Math.max(0.001,
      getClimateBandWeight(climate.temperature, -0.5, 0.48) *
      getClimateBandWeight(climate.moisture, 0.16, 0.72) *
      (0.34 + (ruggedFactor * 0.28) + (climate.inlandness * 0.38) + (coolWeirdness * 0.12))
    ),
    desert: Math.max(0.001,
      getClimateBandWeight(climate.temperature, 0.72, 0.38) *
      getClimateBandWeight(climate.moisture, -0.62, 0.44) *
      (0.38 + (flatFactor * 0.34) + ((1 - climate.inlandness) * 0.28))
    ),
    swamp: Math.max(0.001,
      getClimateBandWeight(climate.temperature, 0.32, 0.52) *
      getClimateBandWeight(climate.moisture, 0.52, 0.46) *
      (0.32 + (flatFactor * 0.38) + (warmWeirdness * 0.3))
    ),
    snowyPlains: Math.max(0.001,
      getClimateBandWeight(climate.temperature, -0.72, 0.36) *
      getClimateBandWeight(climate.moisture, -0.08, 0.82) *
      (0.36 + (flatFactor * 0.28) + (coolWeirdness * 0.36))
    )
  };
}

function getLandClimateSelection(worldOptions, worldX, worldZ) {
  if (!worldOptions.mixedBiomes) {
    const profile = getForcedBiomeProfile(worldOptions);
    const climate = getLandClimateSample(worldOptions, worldX, worldZ);
    return {
      blendedTerrainAmplitudeOffset: profile.terrainAmplitudeOffset,
      climate,
      primaryProfile: profile,
      weights: null
    };
  }

  const cacheKey = `${worldOptions.seedHash}:${worldX},${worldZ}`;

  if (LAND_CLIMATE_SELECTION_CACHE.has(cacheKey)) {
    return LAND_CLIMATE_SELECTION_CACHE.get(cacheKey);
  }

  const climate = getLandClimateSample(worldOptions, worldX, worldZ);
  const weights = getClimateBiomeWeights(climate);
  const profiles = {
    birchForest: biomes.birchForest.createProfile(worldOptions),
    flowerForest: biomes.flowerForest.createProfile(worldOptions),
    forest: {
      ...getLegacyBiomeProfile(worldOptions, 'forest'),
      allowWater: true
    },
    oldGrowthBirchForest: {
      ...getLegacyBiomeProfile(worldOptions, 'oldGrowthBirchForest'),
      allowWater: true
    },
    plains: biomes.plains.createProfile(worldOptions),
    sunflowerPlains: biomes.sunflowerPlains.createProfile(worldOptions),
    taiga: {
      ...getLegacyBiomeProfile(worldOptions, 'taiga'),
      allowWater: true
    },
    desert: biomes.desert.createProfile(worldOptions),
    swamp: biomes.swamp.createProfile(worldOptions),
    snowyPlains: biomes.snowyPlains.createProfile(worldOptions)
  };
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const blendedTerrainAmplitudeOffset = Object.entries(weights).reduce(
    (sum, [biomeKey, weight]) => sum + (profiles[biomeKey].terrainAmplitudeOffset * weight),
    0
  ) / totalWeight;
  const primaryBiomeKey = Object.entries(weights).reduce(
    (bestKey, [biomeKey, weight]) => (weight > weights[bestKey] ? biomeKey : bestKey),
    'plains'
  );

  const selection = {
    blendedTerrainAmplitudeOffset,
    climate,
    primaryProfile: profiles[primaryBiomeKey],
    weights
  };

  if (LAND_CLIMATE_SELECTION_CACHE.size > 250000) {
    LAND_CLIMATE_SELECTION_CACHE.clear();
  }

  LAND_CLIMATE_SELECTION_CACHE.set(cacheKey, selection);
  return selection;
}

function getColumnClimate(worldOptions, surfaceY, worldX, worldZ, topY, terrainMetrics, landClimateSelection = null) {
  const cacheKey = `${worldOptions.seedHash}:${surfaceY}:${worldX},${worldZ}:${topY}`;

  if (COLUMN_CLIMATE_CACHE.has(cacheKey)) {
    return COLUMN_CLIMATE_CACHE.get(cacheKey);
  }

  const climateSelection = landClimateSelection ?? getLandClimateSelection(worldOptions, worldX, worldZ);
  const baseClimate = climateSelection.climate ?? getLandClimateSample(worldOptions, worldX, worldZ);
  const heightFactor = smoothstep(clamp((topY - (surfaceY + 8)) / 30, 0, 1));
  const freezeLift = smoothstep(clamp((topY - (surfaceY + 20)) / 26, 0, 1));
  const effectiveTemperature = baseClimate.temperature -
    (heightFactor * 0.58) -
    (terrainMetrics.ruggedness * 0.06) +
    (terrainMetrics.inlandness * 0.05);
  const freezeChance = smoothstep(clamp((-effectiveTemperature - 0.1) / 0.34, 0, 1)) *
    Math.max(heightFactor, freezeLift * 0.72, effectiveTemperature < -0.28 ? 0.42 : 0);
  const climate = {
    ...baseClimate,
    effectiveTemperature,
    freezeChance,
    heightFactor
  };

  if (COLUMN_CLIMATE_CACHE.size > 250000) {
    COLUMN_CLIMATE_CACHE.clear();
  }

  COLUMN_CLIMATE_CACHE.set(cacheKey, climate);
  return climate;
}

function getBiomeProfile(worldOptions, worldX, worldZ) {
  return getLandClimateSelection(worldOptions, worldX, worldZ).primaryProfile;
}

function getLandBiomeProfile(worldOptions, worldX, worldZ) {
  return getLandClimateSelection(worldOptions, worldX, worldZ).primaryProfile;
}

function getBlendedLandTerrainAmplitudeOffset(worldOptions, worldX, worldZ, fallbackProfile = null) {
  if (!worldOptions.mixedBiomes) {
    return (fallbackProfile ?? getLandBiomeProfile(worldOptions, worldX, worldZ)).terrainAmplitudeOffset;
  }

  return getLandClimateSelection(worldOptions, worldX, worldZ).blendedTerrainAmplitudeOffset;
}

function shouldUseBeachBiome(worldOptions, surfaceY, worldX, worldZ, topY, coastBlend, riverBlend = 0) {
  const beachNoise = getBeachNoise(worldX, worldZ, worldOptions.seedHash);
  const localRelief = getTerrainRelief(worldOptions, surfaceY, worldX, worldZ, 2);
  const waterLevel = surfaceY - 1;
  const elevationAboveWater = topY - waterLevel;

  if (riverBlend > 0.12) {
    return false;
  }

  if (coastBlend < 0.06 || coastBlend > 0.55) {
    return false;
  }

  if (elevationAboveWater < 0 || elevationAboveWater > 3) {
    return false;
  }

  if (localRelief > 3) {
    return false;
  }

  return beachNoise > 0.35;
}

function shouldUseStonyShoreBiome(worldOptions, surfaceY, worldX, worldZ, topY, coastBlend, riverBlend, terrainMetrics) {
  const waterLevel = surfaceY - 1;
  const elevationAboveWater = topY - waterLevel;
  const localRelief = getTerrainRelief(worldOptions, surfaceY, worldX, worldZ, 2);
  const cliffNoise = ridgeNoise2d(worldX, worldZ, worldOptions.seedHash + 1861, {
    frequency: 0.02,
    octaves: 2,
    persistence: 0.58,
    lacunarity: 2
  });

  if (riverBlend > 0.08) {
    return false;
  }

  if (coastBlend < 0.14 || coastBlend > 0.84) {
    return false;
  }

  if (elevationAboveWater < 0 || elevationAboveWater > 6) {
    return false;
  }

  const nearOceanFactor = smoothstep(clamp((coastBlend - 0.18) / 0.34, 0, 1));
  const slopeFactor = smoothstep(clamp((localRelief - 5) / 4, 0, 1));
  const ruggedFactor = smoothstep(clamp((terrainMetrics.ruggedness - 0.56) / 0.18, 0, 1));
  const cliffFactor = smoothstep(clamp((terrainMetrics.cliffiness - 0.22) / 0.14, 0, 1));
  const stonyScore =
    (nearOceanFactor * 0.12) +
    (slopeFactor * 0.4) +
    (ruggedFactor * 0.24) +
    (cliffFactor * 0.24) +
    (cliffNoise > 0.44 ? 0.1 : 0);

  return stonyScore >= 0.72;
}

function getShoreMaterialStateId(worldOptions, worldX, worldZ, options = {}) {
  const {
    allowDirt = false,
    dirtThreshold = 0.8,
    noiseOffset = 0,
    gravelThreshold = 0.58,
    clayThreshold = 0.84
  } = options;
  const floorNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 1469 + noiseOffset);
  const patchNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 1777 + noiseOffset, 0.024);

  if (allowDirt && patchNoise > dirtThreshold) {
    return worldOptions.soilBlockStateId;
  }

  if (floorNoise > clayThreshold) {
    return worldOptions.terrainBlockStateIds.clay;
  }

  if (floorNoise > gravelThreshold) {
    return worldOptions.terrainBlockStateIds.gravel;
  }

  return worldOptions.terrainBlockStateIds.sand;
}

function getStonyShoreSurfaceStateId(worldOptions, worldX, worldZ) {
  const gravelBandNoise = valueNoise2d(
    (worldX * 0.72) + (worldZ * 0.18),
    (worldZ * 0.22) - (worldX * 0.08),
    worldOptions.seedHash + 1897,
    0.034
  );
  const gravelPatchNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 1931, 0.022);

  if (gravelBandNoise > 0.62 || gravelPatchNoise > 0.86) {
    return worldOptions.terrainBlockStateIds.gravel;
  }

  return worldOptions.terrainBlockStateIds.stone;
}

function getSteepBankSurfaceStateId(worldOptions, worldX, worldZ) {
  const gravelBandNoise = valueNoise2d(
    (worldX * 0.61) + (worldZ * 0.14),
    (worldZ * 0.27) - (worldX * 0.11),
    worldOptions.seedHash + 1999,
    0.03
  );

  return gravelBandNoise > 0.54
    ? worldOptions.terrainBlockStateIds.gravel
    : worldOptions.terrainBlockStateIds.stone;
}

function shouldUseStonyBankSurface(localRelief, elevationAboveWater) {
  return localRelief >= 6 || elevationAboveWater >= 7;
}

function getLakeBedMaterialStateId(worldOptions, worldX, worldZ) {
  const bedNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 1949);
  const patchNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 1987, 0.028);

  if (patchNoise > 0.82) {
    return worldOptions.soilBlockStateId;
  }

  if (bedNoise > 0.84) {
    return worldOptions.terrainBlockStateIds.clay;
  }

  if (bedNoise > 0.56) {
    return worldOptions.terrainBlockStateIds.gravel;
  }

  if (bedNoise > 0.38) {
    return worldOptions.terrainBlockStateIds.sand;
  }

  return worldOptions.soilBlockStateId;
}

function getRiverBedMaterialStateId(worldOptions, worldX, worldZ) {
  const bedNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 2089);
  const bandNoise = valueNoise2d(
    (worldX * 0.68) + (worldZ * 0.16),
    (worldZ * 0.31) - (worldX * 0.09),
    worldOptions.seedHash + 2129,
    0.026
  );
  const patchNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 2167, 0.031);

  if (patchNoise > 0.91) {
    return worldOptions.terrainBlockStateIds.clay;
  }

  if (bedNoise > 0.56 || bandNoise > 0.7) {
    return worldOptions.terrainBlockStateIds.gravel;
  }

  if (bedNoise > 0.83 && bandNoise > 0.52) {
    return worldOptions.terrainBlockStateIds.sand;
  }

  return worldOptions.terrainBlockStateIds.mud;
}

function getLakeShoreSurfaceStateId(worldOptions, worldX, worldZ, climate, elevationAboveWater, localRelief) {
  if (localRelief >= 8 || elevationAboveWater >= 7) {
    return getSteepBankSurfaceStateId(worldOptions, worldX, worldZ);
  }

  const shoreNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 2017);
  const moistShore = climate.moisture > 0.18;

  if (shoreNoise > 0.8) {
    return worldOptions.terrainBlockStateIds.gravel;
  }

  if (shoreNoise > 0.54) {
    return worldOptions.terrainBlockStateIds.sand;
  }

  return moistShore
    ? worldOptions.soilBlockStateId
    : worldOptions.terrainBlockStateIds.sand;
}

function getRiverBankSurfaceStateIds(worldOptions, worldX, worldZ, climate, elevationAboveWater, localRelief) {
  if (localRelief >= 4 || elevationAboveWater >= 3) {
    const steepStateId = getSteepBankSurfaceStateId(worldOptions, worldX, worldZ);
    return {
      topBlockStateId: steepStateId,
      soilBlockStateId: steepStateId
    };
  }

  const bankNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 2219);
  const patchNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 2251, 0.028);
  const moistBank = climate.moisture > -0.02;
  const muddySoilStateId = moistBank
    ? worldOptions.terrainBlockStateIds.mud
    : worldOptions.soilBlockStateId;

  if (patchNoise > 0.84) {
    return {
      topBlockStateId: worldOptions.terrainBlockStateIds.gravel,
      soilBlockStateId: worldOptions.terrainBlockStateIds.gravel
    };
  }

  if (bankNoise > 0.93 && elevationAboveWater <= 1) {
    return {
      topBlockStateId: worldOptions.terrainBlockStateIds.sand,
      soilBlockStateId: worldOptions.terrainBlockStateIds.sand
    };
  }

  if (bankNoise > 0.62 || patchNoise > 0.7) {
    return {
      topBlockStateId: worldOptions.terrainBlockStateIds.mud,
      soilBlockStateId: worldOptions.terrainBlockStateIds.mud
    };
  }

  return {
    topBlockStateId: worldOptions.surfaceBlockStateId,
    soilBlockStateId: muddySoilStateId
  };
}

function getOceanBlend(worldOptions, surfaceY, spawn, worldX, worldZ, terrainMetrics, forcedOcean = false) {
  const spawnBlend = getSpawnMajorWaterBlend(spawn, worldX, worldZ);
  const oceanRegionFactor = smoothstep(clamp(
    (getOceanRegionNoise(worldX, worldZ, worldOptions.seedHash) + 0.14) / 0.46,
    0,
    1
  ));
  const inlandSuppression = smoothstep(clamp((terrainMetrics.inlandness - 0.04) / 0.2, 0, 1));
  const elevationGate = smoothstep(clamp((terrainMetrics.topY - (surfaceY + 3)) / 6, 0, 1));
  let oceanBlend = forcedOcean
    ? 1
    : smoothstep(clamp(
      ((-0.28 - terrainMetrics.continentalness) / 0.34) +
      ((oceanRegionFactor - 0.38) * 1.1) +
      ((getOceanNoise(worldX, worldZ, worldOptions.seedHash) - 0.5) * 0.14),
      0,
      1
    ));
  oceanBlend *= 1 - (inlandSuppression * 0.98);
  oceanBlend *= 1 - (elevationGate * 0.95);
  oceanBlend *= 1 - spawnBlend;

  return oceanBlend;
}

function getLakeBlend(worldOptions, surfaceY, spawn, worldX, worldZ, terrainMetrics, climate, forcedLake = false) {
  const spawnBlend = getSpawnMajorWaterBlend(spawn, worldX, worldZ);
  const lakeRegionFactor = smoothstep(clamp(
    (getLakeRegionNoise(worldX, worldZ, worldOptions.seedHash) + 0.18) / 0.52,
    0,
    1
  ));
  const lakePocketFactor = smoothstep(clamp(
    (getLakePocketNoise(worldX, worldZ, worldOptions.seedHash) - 0.53) / 0.23,
    0,
    1
  ));
  const inlandFactor = smoothstep(clamp((terrainMetrics.inlandness - 0.16) / 0.34, 0, 1));
  const calmFactor = 1 - smoothstep(clamp((terrainMetrics.ruggedness - 0.64) / 0.22, 0, 1));
  const wetFactor = smoothstep(clamp((climate.moisture + 0.08) / 0.66, 0, 1));
  const valleyFactor = smoothstep(clamp((-climate.weirdness + 0.14) / 0.56, 0, 1));
  let lakeBlend = forcedLake
    ? 1
    : smoothstep(clamp(
      (lakeRegionFactor * 0.82) +
      (lakePocketFactor * 0.56) +
      (inlandFactor * 0.72) +
      (calmFactor * 0.18) +
      (wetFactor * 0.24) +
      (valleyFactor * 0.18) -
      1.6,
      0,
      1
    ));
  const lakeElevationGate = forcedLake
    ? 0
    : smoothstep(clamp((terrainMetrics.topY - (surfaceY + 3)) / 5, 0, 1));
  lakeBlend *= 1 - (lakeElevationGate * 0.92);
  lakeBlend *= 1 - spawnBlend;

  return lakeBlend;
}

function getSpawnSafeTopY(worldOptions, surfaceY, spawn, worldX, worldZ, baseTopY) {
  const waterLevel = surfaceY - 1;
  const spawnBlend = getSpawnTerrainBlend(spawn, worldX, worldZ);

  if (spawnBlend <= 0) {
    return baseTopY;
  }

  const spawnSafeTopY = waterLevel + 2 + Math.round(hashNoise2d(worldX, worldZ, worldOptions.seedHash + 1733) * 2);
  return Math.max(baseTopY, Math.floor(lerp(baseTopY, spawnSafeTopY, spawnBlend)));
}

function getCoastProximityBlend(worldOptions, surfaceY, spawn, worldX, worldZ) {
  const waterLevel = surfaceY - 1;
  const sampleOffsets = [
    [0, 0, 1],
    [2, 0, 0.96],
    [-2, 0, 0.96],
    [0, 2, 0.96],
    [0, -2, 0.96],
    [2, 2, 0.92],
    [2, -2, 0.92],
    [-2, 2, 0.92],
    [-2, -2, 0.92],
    [4, 0, 0.88],
    [-4, 0, 0.88],
    [0, 4, 0.88],
    [0, -4, 0.88],
    [4, 2, 0.84],
    [4, -2, 0.84],
    [-4, 2, 0.84],
    [-4, -2, 0.84],
    [2, 4, 0.84],
    [2, -4, 0.84],
    [-2, 4, 0.84],
    [-2, -4, 0.84],
    [4, 4, 0.8],
    [4, -4, 0.8],
    [-4, 4, 0.8],
    [-4, -4, 0.8],
    [6, 0, 0.74],
    [-6, 0, 0.74],
    [0, 6, 0.74],
    [0, -6, 0.74],
    [6, 3, 0.68],
    [6, -3, 0.68],
    [-6, 3, 0.68],
    [-6, -3, 0.68],
    [3, 6, 0.68],
    [3, -6, 0.68],
    [-3, 6, 0.68],
    [-3, -6, 0.68],
    [8, 0, 0.62],
    [-8, 0, 0.62],
    [0, 8, 0.62],
    [0, -8, 0.62],
    [8, 4, 0.56],
    [8, -4, 0.56],
    [-8, 4, 0.56],
    [-8, -4, 0.56],
    [4, 8, 0.56],
    [4, -8, 0.56],
    [-4, 8, 0.56],
    [-4, -8, 0.56],
    [10, 0, 0.48],
    [-10, 0, 0.48],
    [0, 10, 0.48],
    [0, -10, 0.48],
    [10, 5, 0.42],
    [10, -5, 0.42],
    [-10, 5, 0.42],
    [-10, -5, 0.42],
    [5, 10, 0.42],
    [5, -10, 0.42],
    [-5, 10, 0.42],
    [-5, -10, 0.42],
    [12, 0, 0.34],
    [-12, 0, 0.34],
    [0, 12, 0.34],
    [0, -12, 0.34]
  ];
  let strongestOceanBlend = 0;

  for (const [offsetX, offsetZ, weight] of sampleOffsets) {
    const sampleX = worldX + offsetX;
    const sampleZ = worldZ + offsetZ;
    const sampleLandOffset = getBlendedLandTerrainAmplitudeOffset(worldOptions, sampleX, sampleZ);
    const sampleTerrainMetrics = getTerrainMetrics(
      sampleX,
      sampleZ,
      surfaceY,
      worldOptions.terrainAmplitude + sampleLandOffset,
      worldOptions.seedHash
    );
    const sampleTopY = getSpawnSafeTopY(
      worldOptions,
      surfaceY,
      spawn,
      sampleX,
      sampleZ,
      sampleTerrainMetrics.topY
    );
    const sampleOceanBlend = getOceanBlend(
      worldOptions,
      surfaceY,
      spawn,
      sampleX,
      sampleZ,
      sampleTerrainMetrics
    );

    const carvedOceanCandidate = sampleOceanBlend > 0.18;
    const naturallyLowCandidate = sampleTopY <= waterLevel + 1 && sampleTerrainMetrics.continentalness < -0.08;

    if (!carvedOceanCandidate && !naturallyLowCandidate) {
      continue;
    }

    strongestOceanBlend = Math.max(
      strongestOceanBlend,
      Math.max(sampleOceanBlend, naturallyLowCandidate ? 0.22 : 0) * weight
    );
  }

  return strongestOceanBlend;
}

function getNearshoreLandBlend(worldOptions, surfaceY, spawn, worldX, worldZ) {
  const waterLevel = surfaceY - 1;
  const sampleOffsets = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [2, 0, 0.96],
    [-2, 0, 0.96],
    [0, 2, 0.96],
    [0, -2, 0.96],
    [2, 2, 0.92],
    [2, -2, 0.92],
    [-2, 2, 0.92],
    [-2, -2, 0.92],
    [3, 0, 0.86],
    [-3, 0, 0.86],
    [0, 3, 0.86],
    [0, -3, 0.86],
    [4, 0, 0.8],
    [-4, 0, 0.8],
    [0, 4, 0.8],
    [0, -4, 0.8],
    [4, 2, 0.74],
    [4, -2, 0.74],
    [-4, 2, 0.74],
    [-4, -2, 0.74],
    [2, 4, 0.74],
    [2, -4, 0.74],
    [-2, 4, 0.74],
    [-2, -4, 0.74],
    [6, 0, 0.62],
    [-6, 0, 0.62],
    [0, 6, 0.62],
    [0, -6, 0.62],
    [6, 3, 0.54],
    [6, -3, 0.54],
    [-6, 3, 0.54],
    [-6, -3, 0.54],
    [3, 6, 0.54],
    [3, -6, 0.54],
    [-3, 6, 0.54],
    [-3, -6, 0.54]
  ];
  let strongestLandBlend = 0;

  for (const [offsetX, offsetZ, weight] of sampleOffsets) {
    const sampleX = worldX + offsetX;
    const sampleZ = worldZ + offsetZ;
    const sampleLandOffset = getBlendedLandTerrainAmplitudeOffset(worldOptions, sampleX, sampleZ);
    const sampleTerrainMetrics = getTerrainMetrics(
      sampleX,
      sampleZ,
      surfaceY,
      worldOptions.terrainAmplitude + sampleLandOffset,
      worldOptions.seedHash
    );
    const sampleTopY = getSpawnSafeTopY(
      worldOptions,
      surfaceY,
      spawn,
      sampleX,
      sampleZ,
      sampleTerrainMetrics.topY
    );
    const sampleOceanBlend = getOceanBlend(
      worldOptions,
      surfaceY,
      spawn,
      sampleX,
      sampleZ,
      sampleTerrainMetrics
    );
    const sampleElevationAboveWater = sampleTopY - waterLevel;
    const aboveWaterCandidate = sampleElevationAboveWater >= 0;
    const nonOceanCandidate = sampleOceanBlend <= 0.14;

    if (!aboveWaterCandidate || !nonOceanCandidate) {
      continue;
    }

    const lowCoastFactor = 1 - smoothstep(clamp((sampleElevationAboveWater - 7) / 8, 0, 1));
    const landCandidateStrength = clamp(
      0.42 +
      (Math.max(0, sampleTerrainMetrics.inlandness) * 0.8) +
      (lowCoastFactor * 0.4),
      0,
      1
    );

    strongestLandBlend = Math.max(
      strongestLandBlend,
      weight * landCandidateStrength
    );
  }

  return strongestLandBlend;
}

function getOceanColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ, baseTopY, terrainMetrics) {
  const forcedOcean = !worldOptions.mixedBiomes && worldOptions.biomeName.includes('ocean');
  const waterLevel = surfaceY - 1;
  const oceanBlend = getOceanBlend(worldOptions, surfaceY, spawn, worldX, worldZ, terrainMetrics, forcedOcean);

  if (!forcedOcean && oceanBlend <= 0.18) {
    return {
      active: false,
      oceanBlend
    };
  }

  const depthNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 1433, 0.0105);
  const basinNoise = Math.max(0, fbmNoise2d(worldX, worldZ, worldOptions.seedHash + 1481, {
    frequency: 0.0038,
    octaves: 3,
    persistence: 0.58,
    lacunarity: 2
  }));
  const shallowOceanDepth = 3 +
    Math.round(depthNoise * 3) +
    Math.round(basinNoise * 2);
  const deepOceanDepth = 12 +
    Math.round(depthNoise * 8) +
    Math.round(basinNoise * 10) +
    Math.round(Math.max(0, oceanBlend - 0.56) * 16);
  const deepOceanFactor = smoothstep(clamp((oceanBlend - 0.46) / 0.24, 0, 1));
  const openWaterFloorDepth = Math.max(
    shallowOceanDepth,
    Math.round(lerp(shallowOceanDepth, deepOceanDepth, deepOceanFactor))
  );
  const nearshoreLandBlend = worldOptions.mixedBiomes
    ? getNearshoreLandBlend(worldOptions, surfaceY, spawn, worldX, worldZ)
    : 0;
  const nearshoreShelfBlend = smoothstep(clamp((nearshoreLandBlend - 0.08) / 0.56, 0, 1));
  const shorelineCliffSuppression = smoothstep(clamp((terrainMetrics.cliffiness - 0.28) / 0.24, 0, 1));
  const shorelineRuggedSuppression = smoothstep(clamp((terrainMetrics.ruggedness - 0.58) / 0.18, 0, 1));
  const underwaterShelfBlend = clamp(
    (nearshoreShelfBlend * (1 - (shorelineCliffSuppression * 0.32)) * (1 - (shorelineRuggedSuppression * 0.16))) +
    (nearshoreLandBlend * 0.18),
    0,
    1
  );
  const shelfDepthNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 1519, 0.017);
  const nearshoreShelfDepth = 1 +
    Math.round(shelfDepthNoise * 1) +
    Math.round(Math.max(0, terrainMetrics.ruggedness - 0.58) * 1);
  const enforcedNearshoreDepth = nearshoreLandBlend > 0.72
    ? 1
    : nearshoreLandBlend > 0.48
      ? Math.min(nearshoreShelfDepth, 2)
      : nearshoreShelfDepth;
  let floorDepth = Math.max(
    1,
    Math.round(lerp(openWaterFloorDepth, enforcedNearshoreDepth, underwaterShelfBlend))
  );
  if (nearshoreLandBlend > 0.42 && oceanBlend < 0.42) {
    floorDepth = Math.min(floorDepth, 2);
  }
  const floorY = Math.min(baseTopY, waterLevel - floorDepth);
  const shallowWaterDepth = waterLevel - floorY;
  const topBlockStateId = getShoreMaterialStateId(worldOptions, worldX, worldZ, {
    allowDirt: shallowWaterDepth <= 3 || oceanBlend < 0.42 || nearshoreLandBlend > 0.34,
    clayThreshold: 0.88,
    dirtThreshold: 0.83,
    gravelThreshold: 0.56
  });
  const soilBlockStateId = topBlockStateId === worldOptions.soilBlockStateId
    ? worldOptions.soilBlockStateId
    : worldOptions.terrainBlockStateIds.sand;

  return {
    active: true,
    oceanBlend,
    nearshoreLandBlend,
    floorY,
    soilBlockStateId,
    topBlockStateId,
    waterBottomY: floorY + 1,
    waterTopY: waterLevel
  };
}

function getLakeColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ, baseTopY, terrainMetrics, climate, oceanColumn) {
  const forcedLake = !worldOptions.mixedBiomes && worldOptions.biomeName.includes('lake');
  const waterLevel = surfaceY - 1;

  if (oceanColumn.active && !forcedLake) {
    return {
      active: false,
      lakeBlend: 0
    };
  }

  const lakeBlend = getLakeBlend(worldOptions, surfaceY, spawn, worldX, worldZ, terrainMetrics, climate, forcedLake);
  const elevationAboveWater = baseTopY - waterLevel;
  const localRelief = getTerrainRelief(worldOptions, surfaceY, worldX, worldZ, 2);
  const elevationSuppression = smoothstep(clamp((elevationAboveWater - 2) / 4, 0, 1));
  const ruggedSuppression = smoothstep(clamp((terrainMetrics.ruggedness - 0.46) / 0.22, 0, 1));
  let shoreBlend = forcedLake
    ? 1
    : smoothstep(clamp((lakeBlend - 0.14) / 0.22, 0, 1));
  let shelfBlend = forcedLake
    ? 1
    : smoothstep(clamp((lakeBlend - 0.3) / 0.16, 0, 1));
  let deepBlend = forcedLake
    ? 1
    : smoothstep(clamp((lakeBlend - 0.54) / 0.12, 0, 1));

  shoreBlend *= 1 - (elevationSuppression * 0.75);
  shoreBlend *= 1 - (ruggedSuppression * 0.4);
  shelfBlend *= 1 - (elevationSuppression * 0.85);
  shelfBlend *= 1 - (ruggedSuppression * 0.5);
  deepBlend *= 1 - (elevationSuppression * 0.95);
  deepBlend *= 1 - (ruggedSuppression * 0.62);

  if (!forcedLake && shoreBlend <= 0.04 && shelfBlend <= 0.04) {
    return {
      active: false,
      lakeBlend,
      shoreBlend: 0,
      shoreSurfaceStateId: null,
      shoreTopY: null
    };
  }

  const depthNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 2027, 0.011);
  const shelfNoise = signedValueNoise2d(worldX, worldZ, worldOptions.seedHash + 2063, 0.0205);
  const depth = 2 +
    Math.round(depthNoise * 2) +
    Math.round((1 - terrainMetrics.ruggedness) * 1);
  const targetFloorY = waterLevel - depth + Math.round(shelfNoise * 0.8);
  const targetShelfY = waterLevel -
    1 -
    Math.round(shelfNoise * 0.35) -
    Math.round(Math.max(0, terrainMetrics.ruggedness - 0.28) * 2);
  const targetShoreY = waterLevel + 1 +
    Math.round((1 - shoreBlend) * 5) +
    Math.round(terrainMetrics.ruggedness * 1);
  const shoreCarveBlend = forcedLake
    ? 1
    : clamp(Math.max(shoreBlend, lakeBlend * 0.58), 0, 1);
  const sculptedTopY = Math.min(baseTopY, Math.floor(lerp(baseTopY, targetShoreY, shoreCarveBlend)));
  const shelfTopY = Math.min(sculptedTopY, Math.floor(lerp(sculptedTopY, targetShelfY, shelfBlend)));
  const carvedTopY = Math.min(shelfTopY, Math.floor(lerp(shelfTopY, targetFloorY, deepBlend)));
  const topY = Math.min(carvedTopY, waterLevel - 1);
  const shoreSurfaceStateId = getLakeShoreSurfaceStateId(
    worldOptions,
    worldX,
    worldZ,
    climate,
    Math.max(0, sculptedTopY - waterLevel),
    localRelief
  );

  if (!forcedLake && (deepBlend <= 0.08 || topY >= waterLevel)) {
    return {
      active: false,
      lakeBlend,
      shoreBlend: 0,
      shoreSurfaceStateId: null,
      shoreTopY: null
    };
  }

  const topBlockStateId = getLakeBedMaterialStateId(worldOptions, worldX, worldZ);
  const soilBlockStateId = topBlockStateId === worldOptions.terrainBlockStateIds.clay
    ? worldOptions.terrainBlockStateIds.clay
    : topBlockStateId === worldOptions.terrainBlockStateIds.gravel
      ? worldOptions.terrainBlockStateIds.gravel
      : topBlockStateId === worldOptions.terrainBlockStateIds.sand
        ? worldOptions.terrainBlockStateIds.sand
        : worldOptions.soilBlockStateId;

  return {
    active: true,
    lakeBlend,
    soilBlockStateId,
    shoreBlend,
    shoreSurfaceStateId,
    shoreTopY: sculptedTopY,
    topY,
    topBlockStateId,
    waterBottomY: topY + 1,
    waterTopY: waterLevel
  };
}

function getRiverColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ, baseTopY, terrainMetrics, climate, oceanColumn, lakeColumn) {
  const forcedRiverWorld = !worldOptions.mixedBiomes && worldOptions.biomeName.includes('river');
  const waterLevel = surfaceY - 1;
  const spawnBlend = getSpawnMajorWaterBlend(spawn, worldX, worldZ);

  if ((oceanColumn.active || lakeColumn.active) && !forcedRiverWorld) {
    return {
      active: false,
      riverBlend: 0,
      bankBlend: 0,
      bankTopBlockStateId: null,
      bankSoilBlockStateId: null,
      bankTopY: null
    };
  }

  const riverNetwork = getRiverNetworkData(
    worldOptions,
    worldX,
    worldZ,
    terrainMetrics,
    climate,
    forcedRiverWorld
  );
  const riverSignal = riverNetwork.primarySignal;
  const riverDistance = riverNetwork.primaryDistance;
  const riverWidth = riverNetwork.primaryWidth;
  const localRelief = getTerrainRelief(worldOptions, surfaceY, worldX, worldZ, 2);
  const elevationAboveWater = baseTopY - waterLevel;
  const slopeSuppression = smoothstep(clamp((terrainMetrics.ruggedness - 0.42) / 0.22, 0, 1));
  const elevatedSuppression = smoothstep(clamp((elevationAboveWater - 2) / 5, 0, 1));
  const valleyReadiness = 1 - smoothstep(clamp((elevationAboveWater - 3) / 6, 0, 1));
  const reliefSuppression = smoothstep(clamp((localRelief - 5) / 5, 0, 1));
  const mountainSuppression = smoothstep(clamp((terrainMetrics.mountainness - 0.18) / 0.22, 0, 1));
  const cliffSuppression = smoothstep(clamp((terrainMetrics.cliffiness - 0.14) / 0.16, 0, 1));
  const riverBlend = riverNetwork.networkBlend *
    (1 - spawnBlend) *
    (forcedRiverWorld ? 1 : valleyReadiness) *
    (1 - (slopeSuppression * 0.7)) *
    (1 - (elevatedSuppression * 0.8)) *
    (1 - (reliefSuppression * 0.8)) *
    (1 - (mountainSuppression * 0.9)) *
    (1 - (cliffSuppression * 0.95));
  const bankSide = riverSignal === 0 ? 1 : Math.sign(riverSignal);
  const bendNoise = (
    signedValueNoise2d(worldX, worldZ, worldOptions.seedHash + 1771, 0.0072) +
    (signedValueNoise2d(worldX, worldZ, worldOptions.seedHash + 1793, 0.015) * 0.35)
  ) * bankSide;
  const innerBankFactor = smoothstep(clamp((bendNoise + 1) / 2, 0, 1));
  const outerBankFactor = smoothstep(clamp(((-bendNoise) + 1) / 2, 0, 1));
  const trunkDepthFactor = smoothstep(clamp((riverNetwork.trunkBlend - 0.1) / 0.45, 0, 1));
  let bankBlend = forcedRiverWorld
    ? 1
    : smoothstep(clamp((riverBlend - 0.08) / (0.22 + (innerBankFactor * 0.08) + (riverNetwork.confluenceBlend * 0.05)), 0, 1));
  let waterBlend = forcedRiverWorld
    ? 1
    : smoothstep(clamp(
      (riverBlend - 0.17) / (0.2 + (riverNetwork.confluenceBlend * 0.08) + (trunkDepthFactor * 0.06)),
      0,
      1
    ));

  bankBlend *= 1 - (elevatedSuppression * 0.25);
  waterBlend *= 1 - (elevatedSuppression * 0.5);

  if (
    !forcedRiverWorld &&
    (
      elevationAboveWater > 9 ||
      localRelief > 8 ||
      terrainMetrics.mountainness > 0.4 ||
      terrainMetrics.cliffiness > 0.28
    )
  ) {
    return {
      active: false,
      riverBlend: 0,
      bankBlend: 0,
      bankTopBlockStateId: null,
      bankSoilBlockStateId: null,
      bankTopY: null
    };
  }

  if (riverBlend <= 0.08) {
    return {
      active: false,
      riverBlend,
      bankBlend: 0,
      bankTopBlockStateId: null,
      bankSoilBlockStateId: null,
      bankTopY: null
    };
  }

  const depthNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 1667, 0.0115);
  const riverShelfNoise = signedValueNoise2d(worldX, worldZ, worldOptions.seedHash + 1741, 0.024);
  const channelDepth = 1 +
    Math.round(depthNoise * 2) +
    Math.round((forcedRiverWorld ? 1 : terrainMetrics.inlandness) * 1) +
    Math.round(outerBankFactor * 1) +
    Math.round(trunkDepthFactor * 1) +
    Math.round(riverNetwork.confluenceBlend * 1);
  const maxBankCutDepth = forcedRiverWorld
    ? Math.max(2, Math.min(7, elevationAboveWater))
    : Math.max(
      1,
      Math.min(
        4,
        Math.floor((elevationAboveWater * 0.45) + 1),
        1 + Math.floor(localRelief / 3) + Math.round(trunkDepthFactor)
      )
    );
  const maxChannelInset = forcedRiverWorld
    ? Math.max(2, Math.min(5, channelDepth))
    : Math.max(
      1,
      Math.min(
        3,
        channelDepth,
        1 + Math.round(riverNetwork.confluenceBlend) + Math.round(trunkDepthFactor)
      )
    );
  const targetFloorY = waterLevel - channelDepth +
    Math.round(riverShelfNoise * (0.4 + (innerBankFactor * 0.35))) -
    Math.round(outerBankFactor * (1 + trunkDepthFactor)) -
    Math.round(riverNetwork.confluenceBlend * 1);
  const targetBankY = waterLevel + 1 +
    Math.round((1 - bankBlend) * (2 + (innerBankFactor * 2))) +
    Math.round(terrainMetrics.ruggedness * 1) +
    Math.round(innerBankFactor * 1) -
    Math.round(outerBankFactor * 1) +
    Math.round(riverNetwork.confluenceBlend * 1);
  const minimumBankY = Math.max(waterLevel + 1, baseTopY - maxBankCutDepth);
  const sculptedTopY = Math.max(
    minimumBankY,
    Math.min(baseTopY, Math.floor(lerp(baseTopY, targetBankY, bankBlend)))
  );
  const minimumFloorY = Math.max(waterLevel - maxChannelInset, sculptedTopY - maxChannelInset);
  const topY = Math.max(
    minimumFloorY,
    Math.min(sculptedTopY, Math.floor(lerp(sculptedTopY, targetFloorY, waterBlend)))
  );
  const bankCutDepth = baseTopY - sculptedTopY;
  const riverBankSurfaceStates = getRiverBankSurfaceStateIds(
    worldOptions,
    worldX,
    worldZ,
    climate,
    Math.max(0, sculptedTopY - waterLevel),
    localRelief
  );

  if (!forcedRiverWorld && (waterBlend <= 0.06 || topY >= waterLevel)) {
    return {
      active: false,
      riverBlend,
      bankBlend: bankCutDepth >= 1 && riverBlend > 0.16 ? bankBlend : 0,
      bankTopBlockStateId: bankCutDepth >= 1 && riverBlend > 0.16 ? riverBankSurfaceStates.topBlockStateId : null,
      bankSoilBlockStateId: bankCutDepth >= 1 && riverBlend > 0.16 ? riverBankSurfaceStates.soilBlockStateId : null,
      bankTopY: bankCutDepth >= 1 && riverBlend > 0.16 ? sculptedTopY : null
    };
  }

  const topBlockStateId = topY < waterLevel
    ? getRiverBedMaterialStateId(worldOptions, worldX, worldZ)
    : null;
  const soilBlockStateId = topBlockStateId === worldOptions.terrainBlockStateIds.clay
    ? worldOptions.terrainBlockStateIds.clay
    : topBlockStateId === worldOptions.terrainBlockStateIds.gravel
      ? worldOptions.terrainBlockStateIds.gravel
      : topBlockStateId === worldOptions.terrainBlockStateIds.sand
        ? worldOptions.terrainBlockStateIds.sand
        : topBlockStateId === worldOptions.terrainBlockStateIds.mud
          ? worldOptions.terrainBlockStateIds.mud
          : worldOptions.soilBlockStateId;

  return {
    active: true,
    riverBlend,
    bankBlend,
    bankTopBlockStateId: riverBankSurfaceStates.topBlockStateId,
    bankSoilBlockStateId: riverBankSurfaceStates.soilBlockStateId,
    bankTopY: sculptedTopY,
    soilBlockStateId,
    topY,
    topBlockStateId,
    waterBottomY: topY < waterLevel ? topY + 1 : null,
    waterTopY: topY < waterLevel ? waterLevel : null
  };
}

function getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ) {
  const cacheKey = [
    worldOptions.seedHash,
    surfaceY,
    worldX,
    worldZ,
    Math.floor(spawn.x),
    Math.floor(spawn.z),
    worldOptions.mixedBiomes ? 1 : 0,
    worldOptions.biomeName,
    worldOptions.terrainAmplitude,
    worldOptions.terrainThickness
  ].join(':');

  if (COLUMN_DESCRIPTOR_CACHE.has(cacheKey)) {
    return COLUMN_DESCRIPTOR_CACHE.get(cacheKey);
  }

  const cacheAndReturn = (descriptor) => {
    if (COLUMN_DESCRIPTOR_CACHE.size > 250000) {
      COLUMN_DESCRIPTOR_CACHE.clear();
    }

    COLUMN_DESCRIPTOR_CACHE.set(cacheKey, descriptor);
    return descriptor;
  };

  const landClimateSelection = getLandClimateSelection(worldOptions, worldX, worldZ);
  const landBiomeProfile = landClimateSelection.primaryProfile;
  const blendedLandTerrainOffset = worldOptions.mixedBiomes
    ? landClimateSelection.blendedTerrainAmplitudeOffset
    : landBiomeProfile.terrainAmplitudeOffset;
  const baseTerrainMetrics = getTerrainMetrics(
    worldX,
    worldZ,
    surfaceY,
    worldOptions.terrainAmplitude + blendedLandTerrainOffset,
    worldOptions.seedHash
  );
  const waterLevel = surfaceY - 1;
  const baseTopY = getSpawnSafeTopY(worldOptions, surfaceY, spawn, worldX, worldZ, baseTerrainMetrics.topY);
  const baseLandTopY = Math.max(baseTopY, waterLevel + 1);
  const columnClimate = getColumnClimate(
    worldOptions,
    surfaceY,
    worldX,
    worldZ,
    baseLandTopY,
    baseTerrainMetrics,
    landClimateSelection
  );

  const oceanColumn = getOceanColumnDescriptor(
    worldOptions,
    surfaceY,
    spawn,
    worldX,
    worldZ,
    baseLandTopY,
    baseTerrainMetrics
  );
  const lakeColumn = getLakeColumnDescriptor(
    worldOptions,
    surfaceY,
    spawn,
    worldX,
    worldZ,
    oceanColumn.active ? oceanColumn.floorY : baseLandTopY,
    baseTerrainMetrics,
    columnClimate,
    oceanColumn
  );
  const riverColumn = getRiverColumnDescriptor(
    worldOptions,
    surfaceY,
    spawn,
    worldX,
    worldZ,
    oceanColumn.active
      ? oceanColumn.floorY
      : lakeColumn.active
        ? lakeColumn.topY
        : baseLandTopY,
    baseTerrainMetrics,
    columnClimate,
    oceanColumn,
    lakeColumn
  );
  const lakeShoreColumn = !oceanColumn.active &&
    !lakeColumn.active &&
    !riverColumn.active &&
    lakeColumn.shoreTopY !== null &&
    lakeColumn.shoreSurfaceStateId !== null &&
    (lakeColumn.shoreBlend ?? 0) > 0.12 &&
    lakeColumn.shoreTopY <= baseLandTopY - 1;
  const riverBankColumn = !oceanColumn.active &&
    !lakeColumn.active &&
    !riverColumn.active &&
    riverColumn.bankTopY !== null &&
    riverColumn.bankTopBlockStateId !== null &&
    riverColumn.bankSoilBlockStateId !== null &&
    (riverColumn.bankBlend ?? 0) > 0.12 &&
    riverColumn.bankTopY <= baseLandTopY - 1;
  const preCoastTopY = oceanColumn.active
    ? oceanColumn.floorY
    : lakeColumn.active
      ? lakeColumn.topY
      : riverColumn.active
        ? riverColumn.topY
        : lakeShoreColumn
          ? Math.min(baseLandTopY, lakeColumn.shoreTopY)
          : riverBankColumn
            ? Math.min(baseLandTopY, riverColumn.bankTopY)
            : baseLandTopY;
  const coastBlend = worldOptions.mixedBiomes
    ? getCoastProximityBlend(worldOptions, surfaceY, spawn, worldX, worldZ)
    : oceanColumn.oceanBlend ?? 0;
  const preCoastElevationAboveWater = preCoastTopY - waterLevel;
  const localRelief = getTerrainRelief(worldOptions, surfaceY, worldX, worldZ, 2);
  const coastalShelfFactor = 1 - smoothstep(clamp((baseTerrainMetrics.inlandness - 0.28) / 0.26, 0, 1));
  const coastalShelfBlend = smoothstep(clamp((coastBlend - 0.02) / 0.48, 0, 1)) * coastalShelfFactor;
  const coastalLandColumn = worldOptions.mixedBiomes &&
    !oceanColumn.active &&
    !lakeColumn.active &&
    !riverColumn.active &&
    coastalShelfBlend > 0.03 &&
    preCoastElevationAboveWater >= 0 &&
    preCoastElevationAboveWater <= 24;
  const useStonyShore = coastalLandColumn && (
    shouldUseStonyShoreBiome(
      worldOptions,
      surfaceY,
      worldX,
      worldZ,
      preCoastTopY,
      coastBlend,
      riverColumn.riverBlend ?? 0,
      baseTerrainMetrics
    )
  );
  const coastDistanceBlend = coastalLandColumn
    ? coastalShelfBlend
    : 0;
  const coastElevationBlend = coastalLandColumn
    ? smoothstep(clamp((preCoastElevationAboveWater - 1) / 12, 0, 1))
    : 0;
  const coastShoreBlend = coastalLandColumn
    ? Math.max(
      coastDistanceBlend,
      clamp((coastDistanceBlend * 0.9) + (coastElevationBlend * 0.55), 0, 1)
    )
    : 0;
  const beachEdgeBlend = coastalLandColumn
    ? smoothstep(clamp((coastDistanceBlend - 0.16) / 0.56, 0, 1))
    : 0;
  const beachCarveBlend = coastalLandColumn
    ? Math.max(
      coastShoreBlend,
      smoothstep(clamp((coastDistanceBlend - 0.08) / 0.64, 0, 1)) * 0.96
    )
    : 0;
  const coastTargetTopY = coastalLandColumn
    ? (
      useStonyShore
        ? waterLevel + 1 +
          Math.round((1 - coastDistanceBlend) * 2) +
          Math.round(baseTerrainMetrics.ruggedness * 1)
        : waterLevel +
          Math.round((1 - beachEdgeBlend) * 2)
    )
    : null;
  const coastShoreTopY = coastalLandColumn
    ? Math.min(
      preCoastTopY,
      Math.floor(lerp(preCoastTopY, coastTargetTopY, useStonyShore ? coastShoreBlend : beachCarveBlend))
    )
    : null;
  const useBeach = coastalLandColumn &&
    !useStonyShore &&
    coastDistanceBlend > 0.02 &&
    coastalShelfFactor > 0.005 &&
    localRelief <= 10 &&
    preCoastElevationAboveWater <= 12 &&
    coastShoreTopY !== null &&
    (coastShoreTopY - waterLevel) <= 3;
  const coastShoreSurfaceStateId = coastalLandColumn
    ? (
      useStonyShore
        ? getStonyShoreSurfaceStateId(worldOptions, worldX, worldZ)
        : useBeach
          ? worldOptions.terrainBlockStateIds.sand
          : (
            shouldUseStonyBankSurface(localRelief, coastShoreTopY - waterLevel)
              ? getSteepBankSurfaceStateId(worldOptions, worldX, worldZ)
              : worldOptions.terrainBlockStateIds.sand
          )
    )
    : null;
  const topY = coastalLandColumn && coastShoreTopY !== null
    ? coastShoreTopY
    : preCoastTopY;
  const elevationAboveWater = topY - waterLevel;
  const mountainCliffSurfaceStateId = !oceanColumn.active &&
    !lakeColumn.active &&
    !riverColumn.active &&
    !lakeShoreColumn &&
    !riverBankColumn &&
    !coastalLandColumn &&
    elevationAboveWater >= 5 &&
    localRelief >= 5 &&
    baseTerrainMetrics.cliffiness >= 0.26
    ? getSteepBankSurfaceStateId(worldOptions, worldX, worldZ)
    : null;
  const shoreBiomeProfile = coastalLandColumn
    ? (
      useStonyShore
        ? biomes.stonyShore.createProfile(worldOptions)
        : useBeach
          ? biomes.beach.createProfile(worldOptions)
          : null
    )
    : null;
  const biomeProfile = oceanColumn.active
    ? biomes.ocean.createProfile(worldOptions)
    : lakeColumn.active
      ? biomes.lake.createProfile(worldOptions)
    : riverColumn.active
      ? biomes.river.createProfile(worldOptions)
      : shoreBiomeProfile
        ? shoreBiomeProfile
        : landBiomeProfile;
  const soilDepth = Math.max(3, Math.floor(worldOptions.terrainThickness / 3));
  const steepBankSurfaceStateId = shouldUseStonyBankSurface(localRelief, elevationAboveWater)
    ? getSteepBankSurfaceStateId(worldOptions, worldX, worldZ)
    : null;
  const soilBlockStateId = oceanColumn.active
    ? oceanColumn.soilBlockStateId ?? biomeProfile.soilBlockStateId
    : lakeColumn.active
      ? lakeColumn.soilBlockStateId ?? biomeProfile.soilBlockStateId
    : riverColumn.active
      ? riverColumn.soilBlockStateId ?? biomeProfile.soilBlockStateId
      : lakeShoreColumn
        ? lakeColumn.shoreSurfaceStateId
      : riverBankColumn
        ? riverColumn.bankSoilBlockStateId
      : coastalLandColumn && coastShoreSurfaceStateId
        ? coastShoreSurfaceStateId
      : mountainCliffSurfaceStateId
        ? mountainCliffSurfaceStateId
      : biomeProfile.biomeKey === 'beach' && steepBankSurfaceStateId
        ? steepBankSurfaceStateId
      : biomeProfile.biomeKey === 'stony_shore'
        ? getStonyShoreSurfaceStateId(worldOptions, worldX, worldZ)
      : biomeProfile.biomeKey === 'beach'
        ? worldOptions.terrainBlockStateIds.sand
        : biomeProfile.soilBlockStateId;
  const topBlockStateId = oceanColumn.active
    ? oceanColumn.topBlockStateId
    : lakeColumn.active
      ? lakeColumn.topBlockStateId
      : lakeShoreColumn
        ? lakeColumn.shoreSurfaceStateId
        : riverBankColumn
          ? riverColumn.bankTopBlockStateId
        : coastalLandColumn && coastShoreSurfaceStateId
          ? coastShoreSurfaceStateId
        : mountainCliffSurfaceStateId
          ? mountainCliffSurfaceStateId
        : riverColumn.topBlockStateId
          ?? (
            biomeProfile.biomeKey === 'beach' && steepBankSurfaceStateId
              ? steepBankSurfaceStateId
              : (
                biomeProfile.biomeKey === 'stony_shore'
                  ? getStonyShoreSurfaceStateId(worldOptions, worldX, worldZ)
                  : biomeProfile.surfaceBlockStateId
              )
          );

  return cacheAndReturn({
    biomeProfile,
    climate: columnClimate,
    floorStartY: topY - (worldOptions.terrainThickness - 1),
    soilStartY: Math.max(topY - (soilDepth - 1), topY - 3),
    soilBlockStateId,
    topBlockStateId,
    topY,
    waterBottomY: oceanColumn.active
      ? oceanColumn.waterBottomY
      : lakeColumn.active
        ? lakeColumn.waterBottomY
      : riverColumn.waterBottomY ?? null,
    waterTopY: oceanColumn.active
      ? oceanColumn.waterTopY
      : lakeColumn.active
        ? lakeColumn.waterTopY
      : riverColumn.waterTopY ?? null
  });
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
  return treeObjects.buildTreeFeature(worldOptions, treeType, worldX, worldZ, topY, seedA, seedB, hashNoise2d);
}

function getTreeCandidate(worldOptions, surfaceY, spawn, cellX, cellZ) {
  return treeObjects.getTreeCandidate({
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
  });
}

function isInOreVein(worldOptions, worldX, worldY, worldZ, seedOffset, veinScale) {
  const veinNoise1 = hashNoise2d(
    (worldX * 0.73) + (worldY * 1.41),
    (worldZ * 0.81) - (worldY * 0.93),
    worldOptions.seedHash + seedOffset
  );
  const veinNoise2 = hashNoise2d(
    (worldX * 0.57) - (worldY * 0.68),
    (worldZ * 0.62) + (worldY * 1.17),
    worldOptions.seedHash + seedOffset + 7
  );
  const veinCenter = veinNoise1 > 0.5;
  const veinSpread = veinNoise2 > (1 - veinScale);
  return veinCenter && veinSpread;
}

function resolveUndergroundBlockStateId(worldOptions, biomeProfile, worldX, worldY, worldZ, topY) {
  if (!worldOptions.useNaturalUndergroundGeneration) {
    return biomeProfile.foundationBlockStateId;
  }

  const depth = topY - worldY;
  const isDeepslateLevel = worldY < 0;
  const isTransitionLevel = worldY >= 0 && worldY < 8;
  const transitionNoise = isTransitionLevel
    ? hashNoise2d(worldX * 0.47 + worldY, worldZ * 0.53 - worldY, worldOptions.seedHash + 97)
    : 0;
  const useDeepslate = isDeepslateLevel || (isTransitionLevel && transitionNoise > (worldY / 8));

  if (biomeProfile.biomeKey === 'beach' && depth <= 6) {
    return worldOptions.terrainBlockStateIds.sandstone;
  }

  if (biomeProfile.biomeKey === 'desert' && depth <= 8) {
    return worldOptions.terrainBlockStateIds.sandstone;
  }

  if (biomeProfile.biomeKey === 'ocean' && depth <= 5) {
    return worldOptions.terrainBlockStateIds.sandstone;
  }

  const oreNoise = hashNoise2d(
    (worldX * 0.91) + (worldY * 1.73),
    (worldZ * 0.87) - (worldY * 1.21),
    worldOptions.seedHash + 101
  );

  if (depth >= 48 && worldY < -20 && isInOreVein(worldOptions, worldX, worldY, worldZ, 401, 0.14)) {
    if (oreNoise > 0.6) {
      return worldOptions.terrainBlockStateIds.deepslateDiamondOre;
    }
  }

  if (depth >= 32 && worldY < 16 && isInOreVein(worldOptions, worldX, worldY, worldZ, 411, 0.18)) {
    if (oreNoise > 0.55) {
      return useDeepslate
        ? worldOptions.terrainBlockStateIds.deepslateRedstoneOre
        : worldOptions.terrainBlockStateIds.redstoneOre;
    }
  }

  if (depth >= 24 && worldY < 32 && isInOreVein(worldOptions, worldX, worldY, worldZ, 421, 0.16)) {
    if (oreNoise > 0.58) {
      return useDeepslate
        ? worldOptions.terrainBlockStateIds.deepslateGoldOre
        : worldOptions.terrainBlockStateIds.goldOre;
    }
  }

  if (depth >= 16 && worldY < 32 && isInOreVein(worldOptions, worldX, worldY, worldZ, 431, 0.15)) {
    if (oreNoise > 0.6) {
      return useDeepslate
        ? worldOptions.terrainBlockStateIds.deepslateLapisOre
        : worldOptions.terrainBlockStateIds.lapisOre;
    }
  }

  if (depth >= 32 && worldY < 48 && isInOreVein(worldOptions, worldX, worldY, worldZ, 441, 0.12)) {
    const rugged = hashNoise2d(worldX * 0.31, worldZ * 0.37, worldOptions.seedHash + 449);
    if (rugged > 0.72) {
      return useDeepslate
        ? worldOptions.terrainBlockStateIds.deepslateEmeraldOre
        : worldOptions.terrainBlockStateIds.emeraldOre;
    }
  }

  if (depth >= 7 && isInOreVein(worldOptions, worldX, worldY, worldZ, 201, 0.22)) {
    if (oreNoise > 0.52) {
      return useDeepslate
        ? worldOptions.terrainBlockStateIds.deepslateIronOre
        : worldOptions.terrainBlockStateIds.ironOre;
    }
  }

  if (depth >= 5 && worldY < 96 && isInOreVein(worldOptions, worldX, worldY, worldZ, 211, 0.2)) {
    if (oreNoise > 0.54) {
      return useDeepslate
        ? worldOptions.terrainBlockStateIds.deepslateCopperOre
        : worldOptions.terrainBlockStateIds.copperOre;
    }
  }

  if (depth >= 4 && isInOreVein(worldOptions, worldX, worldY, worldZ, 221, 0.24)) {
    if (oreNoise > 0.48) {
      return useDeepslate
        ? worldOptions.terrainBlockStateIds.deepslateCoalOre
        : worldOptions.terrainBlockStateIds.coalOre;
    }
  }

  if (useDeepslate) {
    const tuffNoise = hashNoise2d(
      (worldX * 0.41) + (worldY * 0.73),
      (worldZ * 0.47) - (worldY * 0.31),
      worldOptions.seedHash + 151
    );
    if (tuffNoise > 0.88) {
      return worldOptions.terrainBlockStateIds.tuff;
    }

    return worldOptions.terrainBlockStateIds.deepslate;
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
  return pondObjects.getPondCandidate({
    worldOptions,
    surfaceY,
    spawn,
    cellX,
    cellZ,
    hashNoise2d,
    getColumnDescriptor,
    isNearSpawn,
    shouldCarveCave,
    waterSpawnClearRadius: WATER_SPAWN_CLEAR_RADIUS,
    caveMinSurfaceRoof: CAVE_MIN_SURFACE_ROOF
  });
}

function applySurfaceDecorationsToChunk(chunk, chunkX, chunkZ, worldOptions, surfaceY, spawn) {
  return decorationObjects.applySurfaceDecorationsToChunk({
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
    decorationSpawnClearRadius: DECORATION_SPAWN_CLEAR_RADIUS,
    safeSurfaceY: SURFACE_REFERENCE_Y
  });
}

function applyPondToChunk(chunk, chunkX, chunkZ, pond, worldOptions) {
  return pondObjects.applyPondToChunk({
    chunk,
    chunkX,
    chunkZ,
    pond,
    worldOptions,
    getTopSolidY: decorationObjects.getTopSolidY
  });
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
  return treeObjects.applyTreeToChunk({ chunk, chunkX, chunkZ, tree, setChunkBlock });
}

function doesTreeOverlapPond(tree, pond) {
  return treeObjects.doesTreeOverlapPond(tree, pond);
}

function getPondCellRangeForChunk(chunkX, chunkZ) {
  return pondObjects.getPondCellRangeForChunk(chunkX, chunkZ);
}

function getTreeCellRangeForChunk(chunkX, chunkZ) {
  return treeObjects.getTreeCellRangeForChunk(chunkX, chunkZ);
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
  const seed = worldOptions.seedHash;

  const worm1 = hashNoise2d(
    (worldX * 0.052) + (worldY * 0.087),
    (worldZ * 0.048) - (worldY * 0.063),
    seed + 301
  );
  const worm2 = hashNoise2d(
    (worldX * 0.041) - (worldY * 0.072),
    (worldZ * 0.058) + (worldY * 0.049),
    seed + 317
  );
  const worm3 = hashNoise2d(
    (worldX * 0.068) + (worldZ * 0.037),
    (worldY * 0.093) - (worldX * 0.028),
    seed + 331
  );

  const wormSignal = (worm1 * 0.45) + (worm2 * 0.35) + (worm3 * 0.2);

  const spaghetti1 = hashNoise2d(
    (worldX * 0.031) + (worldY * 0.112),
    (worldZ * 0.027) - (worldY * 0.081),
    seed + 347
  );
  const spaghetti2 = hashNoise2d(
    (worldX * 0.024) - (worldY * 0.098),
    (worldZ * 0.033) + (worldY * 0.067),
    seed + 359
  );
  const spaghettiSignal = Math.abs(spaghetti1 - 0.5) + Math.abs(spaghetti2 - 0.5);

  const cheese = hashNoise2d(
    (worldX * 0.019) + (worldZ * 0.023),
    (worldY * 0.041) + (worldX * 0.012),
    seed + 373
  );

  return (wormSignal * 2.2) + ((1 - spaghettiSignal) * 1.5) + (cheese * 0.8);
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

  if (worldY <= worldOptions.minWorldY + BEDROCK_MAX_THICKNESS) {
    return false;
  }

  const caveDepth = column.topY - worldY;

  if (caveDepth < CAVE_MIN_SURFACE_ROOF) {
    return false;
  }

  const depthFactor = clamp((caveDepth - CAVE_MIN_SURFACE_ROOF) / 16, 0, 1);
  const caveThreshold = 2.8 - (depthFactor * 0.35);
  return getCaveSignal(worldOptions, worldX, worldY, worldZ) > caveThreshold;
}

function resolveBedrockStateId(worldOptions, worldX, worldY, worldZ) {
  const depthFromBottom = worldY - worldOptions.minWorldY;

  if (depthFromBottom <= 0) {
    return worldOptions.terrainBlockStateIds.bedrock;
  }

  if (depthFromBottom >= BEDROCK_MAX_THICKNESS) {
    return null;
  }

  const threshold = 0.88 - (depthFromBottom * 0.18);
  const noise = hashNoise2d(
    (worldX * 0.37) + worldY,
    (worldZ * 0.41) - worldY,
    worldOptions.seedHash + 1447
  );

  return noise > threshold ? worldOptions.terrainBlockStateIds.bedrock : null;
}

function isBelowPondFootprint(worldX, worldY, worldZ, ponds = []) {
  return pondObjects.isBelowPondFootprint(worldX, worldY, worldZ, ponds);
}

function createGeneratedChunk(worldOptions, surfaceY, spawn, chunkX, chunkZ) {
  const chunk = new Chunk();
  const populationFeatures = collectPopulationFeaturesForChunk(worldOptions, surfaceY, spawn, chunkX, chunkZ);

  for (let localX = 0; localX < 16; localX++) {
    for (let localZ = 0; localZ < 16; localZ++) {
      const worldX = (chunkX * 16) + localX;
      const worldZ = (chunkZ * 16) + localZ;
      const column = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
      const { biomeProfile, soilBlockStateId, soilStartY, topBlockStateId, topY } = column;

      for (let y = chunk.minY; y < topY; y++) {
        const bedrockStateId = resolveBedrockStateId(worldOptions, worldX, y, worldZ);

        if (bedrockStateId !== null) {
          chunk.setBlockStateId(new Vec3(localX, y, localZ), bedrockStateId);
          continue;
        }

        if (
          !isBelowPondFootprint(worldX, y, worldZ, populationFeatures.ponds) &&
          shouldCarveCave(worldOptions, spawn, column, worldX, y, worldZ)
        ) {
          continue;
        }

        chunk.setBlockStateId(
          new Vec3(localX, y, localZ),
          y >= soilStartY
            ? soilBlockStateId
            : resolveUndergroundBlockStateId(worldOptions, biomeProfile, worldX, y, worldZ, topY)
        );
      }

      chunk.setBlockStateId(new Vec3(localX, topY, localZ), topBlockStateId);

      if (column.waterTopY !== null) {
        const isFreezing = biomeProfile.metadata && biomeProfile.metadata.temperature <= 0.15;
        for (let y = column.waterBottomY ?? (topY + 1); y <= column.waterTopY; y++) {
          if (isFreezing && y === column.waterTopY) {
            chunk.setBlockStateId(new Vec3(localX, y, localZ), worldOptions.terrainBlockStateIds.ice);
          } else {
            chunk.setBlockStateId(new Vec3(localX, y, localZ), worldOptions.terrainBlockStateIds.water);
          }
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
        chunk.setBiome(
          new Vec3(x, y, z),
          getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ).biomeProfile.biomeId
        );
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

module.exports = {
  createGeneratedChunk,
  getSpawnChunk,
  getSurfaceY,
  resolveWorldOptions
};
