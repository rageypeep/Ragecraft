const Chunk = require('prismarine-chunk')('1.21.11');
const Vec3 = require('vec3');
const biomes = require('../biomes');
const treeObjects = require('./objects/trees');
const pondObjects = require('./objects/ponds');
const decorationObjects = require('./objects/decorations');

const SAFE_SURFACE_Y = 95;
const BEDROCK_MAX_THICKNESS = 5;
const TREE_SPAWN_CLEAR_RADIUS = treeObjects.TREE_SPAWN_CLEAR_RADIUS;
const CAVE_SPAWN_CLEAR_RADIUS = 18;
const CAVE_MIN_SURFACE_ROOF = 7;
const WATER_SPAWN_CLEAR_RADIUS = 16;
const DECORATION_SPAWN_CLEAR_RADIUS = 8;
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
      ocean: resolveBiomeId(mcData, ['ocean'], fallbackBiomeId),
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
      bedrock: resolveConfiguredBlockStateId(mcData, 'bedrock', worldConfig.foundationBlock),
      podzol: resolveConfiguredBlockStateId(mcData, 'podzol', worldConfig.surfaceBlock),
      rootedDirt: resolveConfiguredBlockStateId(mcData, 'rooted_dirt', worldConfig.soilBlock),
      sand: resolveConfiguredBlockStateId(mcData, 'sand', worldConfig.soilBlock),
      sandstone: resolveConfiguredBlockStateId(mcData, 'sandstone', worldConfig.foundationBlock),
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

function getTerrainHeight(worldX, worldZ, surfaceY, amplitude, seedOffset = 0) {
  const cacheKey = `${worldX},${worldZ},${surfaceY},${amplitude},${seedOffset}`;

  if (TERRAIN_HEIGHT_CACHE.has(cacheKey)) {
    return TERRAIN_HEIGHT_CACHE.get(cacheKey);
  }

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
  const terrainHeight = surfaceY + Math.round(terrainOffset);

  if (TERRAIN_HEIGHT_CACHE.size > 250000) {
    TERRAIN_HEIGHT_CACHE.clear();
  }

  TERRAIN_HEIGHT_CACHE.set(cacheKey, terrainHeight);
  return terrainHeight;
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

function getLegacyBiomeProfile(worldOptions, biomeKey) {
  if (biomeKey === 'beach') {
    return biomes.beach.createProfile(worldOptions);
  }

  if (biomeKey === 'ocean') {
    return biomes.ocean.createProfile(worldOptions);
  }

  if (biomeKey === 'river') {
    return biomes.plains.createProfile(worldOptions);
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
    if (worldOptions.biomeName.includes('ocean')) {
      return biomes.ocean.createProfile(worldOptions);
    }

    if (worldOptions.biomeName.includes('beach')) {
      return biomes.beach.createProfile(worldOptions);
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

function getLandBiomeProfile(worldOptions, worldX, worldZ) {
  if (!worldOptions.mixedBiomes) {
    return getBiomeProfile(worldOptions, worldX, worldZ);
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

function shouldUseBeachBiome(worldOptions, surfaceY, worldX, worldZ, baseTopY) {
  const beachNoise = getBeachNoise(worldX, worldZ, worldOptions.seedHash);
  const localRelief = getTerrainRelief(worldOptions, surfaceY, worldX, worldZ, 2);
  const elevationAboveWater = baseTopY - (surfaceY - 1);

  if (elevationAboveWater > 2) {
    return false;
  }

  if (localRelief > 2) {
    return false;
  }

  return beachNoise > 0.62;
}

function shouldUseOceanBiome(worldOptions, surfaceY, worldX, worldZ, baseTopY) {
  const waterLevel = surfaceY - 1;
  const elevationAboveWater = baseTopY - waterLevel;
  const localRelief = getTerrainRelief(worldOptions, surfaceY, worldX, worldZ, 3);
  const oceanNoise = getOceanNoise(worldX, worldZ, worldOptions.seedHash);

  if (elevationAboveWater > 0) {
    return false;
  }

  if (localRelief > 4) {
    return false;
  }

  return oceanNoise > 0.08;
}

function getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ) {
  const cacheKey = [
    worldOptions.seedHash,
    surfaceY,
    worldX,
    worldZ,
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

  const landBiomeProfile = getLandBiomeProfile(worldOptions, worldX, worldZ);
  const baseTopY = getTerrainHeight(
    worldX,
    worldZ,
    surfaceY,
    worldOptions.terrainAmplitude + landBiomeProfile.terrainAmplitudeOffset,
    worldOptions.seedHash
  );
  const fixedOceanProfile = !worldOptions.mixedBiomes && worldOptions.biomeName.includes('ocean')
    ? biomes.ocean.createProfile(worldOptions)
    : null;
  const oceanProfile = fixedOceanProfile || (
    worldOptions.mixedBiomes &&
    shouldUseOceanBiome(worldOptions, surfaceY, worldX, worldZ, baseTopY)
      ? biomes.ocean.createProfile(worldOptions)
      : null
  );
  const biomeProfile = oceanProfile
    ? oceanProfile
    : (
      worldOptions.mixedBiomes &&
      shouldUseBeachBiome(worldOptions, surfaceY, worldX, worldZ, baseTopY)
    )
      ? biomes.beach.createProfile(worldOptions)
      : landBiomeProfile;
  const soilDepth = Math.max(3, Math.floor(worldOptions.terrainThickness / 3));
  const waterLevel = surfaceY - 1;

  if (biomeProfile.biomeKey === 'ocean') {
    const depthNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 1433, 0.011);
    const floorNoise = hashNoise2d(worldX, worldZ, worldOptions.seedHash + 1469);
    const floorDepth = 3 + Math.round(depthNoise * 6);
    const oceanFloorY = Math.min(baseTopY, waterLevel - floorDepth);
    const oceanFloorStateId = floorNoise > 0.88
      ? worldOptions.terrainBlockStateIds.clay
      : floorNoise > 0.62
        ? worldOptions.terrainBlockStateIds.gravel
        : worldOptions.terrainBlockStateIds.sand;

    return cacheAndReturn({
      biomeProfile,
      floorStartY: oceanFloorY - (worldOptions.terrainThickness - 1),
      soilStartY: Math.max(oceanFloorY - (soilDepth - 1), oceanFloorY - 3),
      topBlockStateId: oceanFloorStateId,
      topY: oceanFloorY,
      waterBottomY: oceanFloorY + 1,
      waterTopY: waterLevel
    });
  }

  return cacheAndReturn({
    biomeProfile,
    floorStartY: baseTopY - (worldOptions.terrainThickness - 1),
    soilStartY: baseTopY - (soilDepth - 1),
    topBlockStateId: biomeProfile.surfaceBlockStateId,
    topY: baseTopY,
    waterBottomY: null,
    waterTopY: null
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

function resolveUndergroundBlockStateId(worldOptions, biomeProfile, worldX, worldY, worldZ, topY) {
  if (!worldOptions.useNaturalUndergroundGeneration) {
    return biomeProfile.foundationBlockStateId;
  }

  const depth = topY - worldY;

  if (biomeProfile.biomeKey === 'beach' && depth <= 6) {
    return worldOptions.terrainBlockStateIds.sandstone;
  }

  if (biomeProfile.biomeKey === 'ocean') {
    if (depth <= 5) {
      return worldOptions.terrainBlockStateIds.sandstone;
    }
  }

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
    safeSurfaceY: SAFE_SURFACE_Y
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

  if (worldY <= worldOptions.minWorldY + BEDROCK_MAX_THICKNESS) {
    return false;
  }

  const caveDepth = column.topY - worldY;

  if (caveDepth < CAVE_MIN_SURFACE_ROOF) {
    return false;
  }

  const caveThreshold = caveDepth > 8 ? 1.72 : 1.88;
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
      const { biomeProfile, soilStartY, topBlockStateId, topY } = column;

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
