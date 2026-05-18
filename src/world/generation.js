const Chunk = require('prismarine-chunk')('1.21.11');
const Vec3 = require('vec3');
const biomes = require('../biomes');
const treeObjects = require('./objects/trees');
const pondObjects = require('./objects/ponds');
const decorationObjects = require('./objects/decorations');
const {
  clamp,
  lerp,
  smoothstep,
  hashNoise2d,
  valueNoise2d,
  fbmNoise3d,
  hashStringSeed
} = require('./noise');
const {
  getTerrainMetrics,
  getTerrainHeight,
  getSpawnSafeTopY,
  getTerrainRelief,
  getMountainBiomeKey
} = require('./terrain');
const {
  getTemperatureNoise,
  getLandClimateSelection,
  getColumnClimate
} = require('./climate');
const {
  shouldUseStonyShoreBiome,
  getStonyShoreSurfaceStateId,
  getSteepBankSurfaceStateId,
  shouldUseStonyBankSurface,
  getCoastProximityBlend,
  getOceanColumnDescriptor,
  getLakeColumnDescriptor,
  getRiverColumnDescriptor
} = require('./hydrology');

const SEA_LEVEL_Y = 63;
const SURFACE_REFERENCE_Y = SEA_LEVEL_Y + 1;
const BEDROCK_MAX_THICKNESS = 5;
const TREE_SPAWN_CLEAR_RADIUS = treeObjects.TREE_SPAWN_CLEAR_RADIUS;
const CAVE_SPAWN_CLEAR_RADIUS = 18;
const CAVE_MIN_SURFACE_ROOF = 7;
const WATER_SPAWN_CLEAR_RADIUS = 16;
const DECORATION_SPAWN_CLEAR_RADIUS = 8;
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
      snowyTaiga: resolveBiomeId(mcData, ['snowy_taiga', 'taiga'], fallbackBiomeId),
      birchForest: resolveBiomeId(mcData, ['birch_forest'], fallbackBiomeId),
      oldGrowthBirchForest: resolveBiomeId(mcData, ['old_growth_birch_forest', 'birch_forest'], fallbackBiomeId),
      desert: resolveBiomeId(mcData, ['desert'], fallbackBiomeId),
      jungle: resolveBiomeId(mcData, ['jungle'], fallbackBiomeId),
      sparseJungle: resolveBiomeId(mcData, ['sparse_jungle', 'jungle'], fallbackBiomeId),
      swamp: resolveBiomeId(mcData, ['swamp'], fallbackBiomeId),
      snowyPlains: resolveBiomeId(mcData, ['snowy_plains', 'snowy_tundra', 'plains'], fallbackBiomeId),
      meadow: resolveBiomeId(mcData, ['meadow', 'plains'], fallbackBiomeId),
      stonyPeaks: resolveBiomeId(mcData, ['stony_peaks', 'stony_shore'], fallbackBiomeId),
      jaggedPeaks: resolveBiomeId(mcData, ['jagged_peaks', 'snowy_plains', 'plains'], fallbackBiomeId),
      savanna: resolveBiomeId(mcData, ['savanna', 'plains'], fallbackBiomeId),
      darkForest: resolveBiomeId(mcData, ['dark_forest', 'forest'], fallbackBiomeId),
      windsweptHills: resolveBiomeId(mcData, ['windswept_hills', 'windswept_gravelly_hills', 'plains'], fallbackBiomeId),
      windsweptForest: resolveBiomeId(mcData, ['windswept_forest', 'forest'], fallbackBiomeId),
      warmOcean: resolveBiomeId(mcData, ['warm_ocean', 'ocean'], fallbackBiomeId),
      lukewarmOcean: resolveBiomeId(mcData, ['lukewarm_ocean', 'ocean'], fallbackBiomeId),
      coldOcean: resolveBiomeId(mcData, ['cold_ocean', 'ocean'], fallbackBiomeId),
      frozenOcean: resolveBiomeId(mcData, ['frozen_ocean', 'ocean'], fallbackBiomeId)
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
      jungleLog: resolveConfiguredBlockStateId(mcData, 'jungle_log', 'oak_log'),
      jungleLeaves: resolveConfiguredBlockStateId(mcData, 'jungle_leaves', 'oak_leaves'),
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
    localRelief <= 14 &&
    preCoastElevationAboveWater <= 14 &&
    coastShoreTopY !== null &&
    (coastShoreTopY - waterLevel) <= 3;
  const coastShoreSurfaceStateId = coastalLandColumn
    ? (
      useStonyShore
        ? getStonyShoreSurfaceStateId(worldOptions, worldX, worldZ)
        : useBeach
          ? worldOptions.terrainBlockStateIds.sand
          : (
            shouldUseStonyBankSurface(localRelief, coastShoreTopY - waterLevel, baseTerrainMetrics)
              ? getSteepBankSurfaceStateId(worldOptions, worldX, worldZ)
              : worldOptions.terrainBlockStateIds.sand
          )
    )
    : null;
  const topY = coastalLandColumn && coastShoreTopY !== null
    ? coastShoreTopY
    : preCoastTopY;
  const elevationAboveWater = topY - waterLevel;
  const mountainBiomeKey = getMountainBiomeKey(baseTerrainMetrics, columnClimate, elevationAboveWater);
  const mountainCliffSurfaceStateId = !oceanColumn.active &&
    !lakeColumn.active &&
    !riverColumn.active &&
    !lakeShoreColumn &&
    !riverBankColumn &&
    !coastalLandColumn &&
    mountainBiomeKey !== 'meadow' &&
    elevationAboveWater >= 8 &&
    localRelief >= 8 &&
    baseTerrainMetrics.cliffiness >= 0.42 &&
    baseTerrainMetrics.ruggedness >= 0.58
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
  const mountainBiomeProfile = !oceanColumn.active &&
    !lakeColumn.active &&
    !riverColumn.active &&
    !shoreBiomeProfile &&
    mountainBiomeKey
    ? (
      mountainBiomeKey === 'jagged_peaks'
        ? biomes.jaggedPeaks.createProfile(worldOptions)
        : mountainBiomeKey === 'stony_peaks'
          ? biomes.stonyPeaks.createProfile(worldOptions)
          : biomes.meadow.createProfile(worldOptions)
    )
    : null;
  const oceanTemperatureNoise = oceanColumn.active
    ? getTemperatureNoise(worldX, worldZ, worldOptions.seedHash + 7701)
    : 0;
  const oceanBiomeProfile = oceanColumn.active
    ? (
      oceanTemperatureNoise > 0.28
        ? biomes.warmOcean.createProfile(worldOptions)
        : oceanTemperatureNoise > 0.04
          ? biomes.lukewarmOcean.createProfile(worldOptions)
          : oceanTemperatureNoise > -0.2
            ? biomes.ocean.createProfile(worldOptions)
            : oceanTemperatureNoise > -0.5
              ? biomes.coldOcean.createProfile(worldOptions)
              : biomes.frozenOcean.createProfile(worldOptions)
    )
    : null;
  const biomeProfile = oceanColumn.active
    ? oceanBiomeProfile
    : lakeColumn.active
      ? biomes.lake.createProfile(worldOptions)
    : riverColumn.active
      ? biomes.river.createProfile(worldOptions)
      : shoreBiomeProfile
        ? shoreBiomeProfile
        : mountainBiomeProfile
          ? mountainBiomeProfile
          : landBiomeProfile;
  const soilDepth = Math.max(3, Math.floor(worldOptions.terrainThickness / 3));
  const steepBankSurfaceStateId = shouldUseStonyBankSurface(localRelief, elevationAboveWater, baseTerrainMetrics)
    ? getSteepBankSurfaceStateId(worldOptions, worldX, worldZ)
    : null;
  let soilBlockStateId = oceanColumn.active
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
  let topBlockStateId = oceanColumn.active
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
  const isLowlandLandBiome =
    biomeProfile.biomeKey === 'plains' ||
    biomeProfile.biomeKey === 'sunflower_plains' ||
    biomeProfile.biomeKey === 'forest' ||
    biomeProfile.biomeKey === 'flower_forest' ||
    biomeProfile.biomeKey === 'birch_forest' ||
    biomeProfile.biomeKey === 'old_growth_birch_forest' ||
    biomeProfile.biomeKey === 'taiga' ||
    biomeProfile.biomeKey === 'snowy_taiga' ||
    biomeProfile.biomeKey === 'jungle' ||
    biomeProfile.biomeKey === 'sparse_jungle' ||
    biomeProfile.biomeKey === 'windswept_forest' ||
    biomeProfile.biomeKey === 'dark_forest' ||
    biomeProfile.biomeKey === 'swamp' ||
    biomeProfile.biomeKey === 'snowy_plains';
  const isRockSurface =
    topBlockStateId === worldOptions.terrainBlockStateIds.stone ||
    topBlockStateId === worldOptions.terrainBlockStateIds.andesite ||
    topBlockStateId === worldOptions.terrainBlockStateIds.gravel ||
    topBlockStateId === worldOptions.terrainBlockStateIds.diorite ||
    topBlockStateId === worldOptions.terrainBlockStateIds.granite;

  if (
    isLowlandLandBiome &&
    isRockSurface &&
    !oceanColumn.active &&
    !lakeColumn.active &&
    !riverColumn.active &&
    !lakeShoreColumn &&
    !riverBankColumn &&
    !shoreBiomeProfile &&
    baseTerrainMetrics.cliffiness < 0.18 &&
    baseTerrainMetrics.mountainness < 0.18
  ) {
    topBlockStateId = biomeProfile.surfaceBlockStateId;
    soilBlockStateId = biomeProfile.soilBlockStateId;
  }

  return cacheAndReturn({
    baseTerrainMetrics,
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

function getColumnDebugData(worldOptions, surfaceY, spawn, worldX, worldZ) {
  const column = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
  const terrainMetrics = column.baseTerrainMetrics ?? {};
  const climate = column.climate ?? {};

  return {
    biomeKey: column.biomeProfile?.biomeKey ?? 'unknown',
    cliffiness: terrainMetrics.cliffiness ?? 0,
    continentalness: terrainMetrics.continentalness ?? 0,
    effectiveTemperature: climate.effectiveTemperature ?? climate.temperature ?? 0,
    erosion: terrainMetrics.erosion ?? 0,
    freezeChance: climate.freezeChance ?? 0,
    heightFactor: climate.heightFactor ?? 0,
    inlandness: terrainMetrics.inlandness ?? 0,
    moisture: climate.moisture ?? 0,
    mountainness: terrainMetrics.mountainness ?? 0,
    ruggedness: terrainMetrics.ruggedness ?? 0,
    temperature: climate.temperature ?? 0,
    topY: column.topY,
    waterBottomY: column.waterBottomY ?? null,
    waterTopY: column.waterTopY ?? null,
    weirdness: climate.weirdness ?? 0,
    worldX,
    worldZ
  };
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

function getSurfaceShapeContext(worldOptions, surfaceY, spawn, worldX, worldZ, column) {
  if (!column?.baseTerrainMetrics || column.waterTopY !== null) {
    return null;
  }

  if (isNearSpawn(spawn, worldX, worldZ, CAVE_SPAWN_CLEAR_RADIUS)) {
    return null;
  }

  const biomeKey = column.biomeProfile?.biomeKey;
  if (
    biomeKey === 'beach' ||
    biomeKey === 'stony_shore' ||
    biomeKey === 'desert' ||
    biomeKey === 'lake' ||
    biomeKey === 'river' ||
    biomeKey === 'ocean' ||
    biomeKey === 'warm_ocean' ||
    biomeKey === 'lukewarm_ocean' ||
    biomeKey === 'cold_ocean' ||
    biomeKey === 'frozen_ocean'
  ) {
    return null;
  }

  const terrainMetrics = column.baseTerrainMetrics;
  const waterLevel = surfaceY - 1;
  const elevationAboveWater = column.topY - waterLevel;
  const terrainShapeFactor = clamp(
    Math.max(
      (terrainMetrics.cliffiness - 0.08) / 0.72,
      (terrainMetrics.mountainness - 0.16) / 0.72,
      (terrainMetrics.ruggedness - 0.34) / 0.56
    ),
    0,
    1
  );

  if (terrainShapeFactor <= 0.16) {
    return null;
  }

  if (
    elevationAboveWater < 12 &&
    terrainMetrics.mountainness < 0.24 &&
    terrainMetrics.cliffiness < 0.22
  ) {
    return null;
  }

  const neighborOffsets = [
    [0, -1],
    [0, 1],
    [1, 0],
    [-1, 0],
    [1, -1],
    [1, 1],
    [-1, -1],
    [-1, 1],
    [0, -2],
    [0, 2],
    [2, 0],
    [-2, 0]
  ];
  const neighborColumns = neighborOffsets.map(([offsetX, offsetZ]) => (
    getColumnDescriptor(worldOptions, surfaceY, spawn, worldX + offsetX, worldZ + offsetZ)
  ));
  const nearWater = neighborColumns.some((neighborColumn) => (
    neighborColumn.waterTopY !== null ||
    neighborColumn.biomeProfile?.biomeKey === 'river'
  ));

  if (nearWater) {
    return null;
  }

  const neighborTopYN = neighborColumns[0].topY;
  const neighborTopYS = neighborColumns[1].topY;
  const neighborTopYE = neighborColumns[2].topY;
  const neighborTopYW = neighborColumns[3].topY;
  const drops = [
    column.topY - neighborTopYN,
    column.topY - neighborTopYS,
    column.topY - neighborTopYE,
    column.topY - neighborTopYW
  ].map((drop) => Math.max(0, drop));
  const maxDrop = Math.max(...drops);
  const exposedFaces = drops.filter((drop) => drop >= 2).length;
  const averageDrop = drops.reduce((sum, drop) => sum + drop, 0) / drops.length;
  const exposureFactor = clamp(
    Math.max(
      (maxDrop - 1) / 9,
      (averageDrop - 0.5) / 4.5,
      (exposedFaces - 1) / 3
    ),
    0,
    1
  );

  if (exposureFactor <= 0.12) {
    return null;
  }

  if (
    (biomeKey === 'plains' || biomeKey === 'sunflower_plains' || biomeKey === 'swamp') &&
    (terrainShapeFactor < 0.68 || maxDrop < 8)
  ) {
    return null;
  }

  if (maxDrop < 5 && terrainShapeFactor < 0.5) {
    return null;
  }

  return {
    averageDrop,
    exposedFaces,
    exposureFactor,
    maxDrop,
    terrainShapeFactor
  };
}

function shouldCarveSurfaceShape(worldOptions, column, shapeContext, worldX, worldY, worldZ) {
  if (!shapeContext) {
    return false;
  }

  if (worldY >= column.soilStartY - 3) {
    return false;
  }

  if (worldY >= column.topY - 1) {
    return false;
  }

  const surfaceDepth = column.topY - worldY;
  if (surfaceDepth < 2 || surfaceDepth > 14) {
    return false;
  }

  const topMask = smoothstep(clamp((surfaceDepth - 2) / 4, 0, 1));
  const lowerFade = 1 - smoothstep(clamp((surfaceDepth - 12) / 8, 0, 1));
  const depthMask = topMask * lowerFade;

  if (depthMask <= 0.04) {
    return false;
  }

  if (surfaceDepth <= 4 && shapeContext.exposureFactor < 0.5) {
    return false;
  }

  const macroNoise = (fbmNoise3d(worldX, worldY, worldZ, worldOptions.seedHash + 9101, {
    frequency: 0.026,
    octaves: 3,
    persistence: 0.56,
    lacunarity: 2.08
  }) + 1) * 0.5;
  const detailNoise = (fbmNoise3d(worldX, worldY, worldZ, worldOptions.seedHash + 9137, {
    frequency: 0.061,
    octaves: 2,
    persistence: 0.58,
    lacunarity: 2.22
  }) + 1) * 0.5;
  const shelfNoise = (fbmNoise3d(worldX * 0.9, worldY * 1.42, worldZ * 0.9, worldOptions.seedHash + 9173, {
    frequency: 0.034,
    octaves: 2,
    persistence: 0.52,
    lacunarity: 2
  }) + 1) * 0.5;
  const cavitySignal = (macroNoise * 0.58) + (detailNoise * 0.28) + (shelfNoise * 0.14);
  const threshold = 0.72 -
    (shapeContext.terrainShapeFactor * 0.14) -
    (shapeContext.exposureFactor * 0.16) -
    (depthMask * 0.12);

  return cavitySignal > threshold;
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

function shouldPlaceWaterSpring(worldOptions, surfaceY, spawn, worldX, y, worldZ) {
  const springNoise = hashNoise2d(worldX + (y * 7), worldZ + (y * 13), worldOptions.seedHash + 8801);
  if (springNoise > 0.006) {
    return false;
  }
  if (y < surfaceY + 8 || y > surfaceY + 80) {
    return false;
  }
  const column = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ);
  if (column.waterTopY !== null) {
    return false;
  }
  const terrainMetrics = column.baseTerrainMetrics;
  if (!terrainMetrics || terrainMetrics.cliffiness < 0.32 || terrainMetrics.mountainness < 0.28) {
    return false;
  }
  const neighborTopYN = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ - 1).topY;
  const neighborTopYS = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ + 1).topY;
  const neighborTopYE = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX + 1, worldZ).topY;
  const neighborTopYW = getColumnDescriptor(worldOptions, surfaceY, spawn, worldX - 1, worldZ).topY;
  const localDropN = column.topY - neighborTopYN;
  const localDropS = column.topY - neighborTopYS;
  const localDropE = column.topY - neighborTopYE;
  const localDropW = column.topY - neighborTopYW;
  const maxDrop = Math.max(localDropN, localDropS, localDropE, localDropW);
  return maxDrop >= 3 && y >= column.topY - 4 && y <= column.topY - 1;
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
      const surfaceShapeContext = getSurfaceShapeContext(worldOptions, surfaceY, spawn, worldX, worldZ, column);

      for (let y = chunk.minY; y < topY; y++) {
        const bedrockStateId = resolveBedrockStateId(worldOptions, worldX, y, worldZ);

        if (bedrockStateId !== null) {
          chunk.setBlockStateId(new Vec3(localX, y, localZ), bedrockStateId);
          continue;
        }

        if (shouldCarveSurfaceShape(worldOptions, column, surfaceShapeContext, worldX, y, worldZ)) {
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

      for (let y = topY - 4; y <= topY - 1; y++) {
        if (y >= chunk.minY && shouldPlaceWaterSpring(worldOptions, surfaceY, spawn, worldX, y, worldZ)) {
          chunk.setBlockStateId(new Vec3(localX, y, localZ), worldOptions.terrainBlockStateIds.water);
        }
      }

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
  getColumnDebugData,
  getSpawnChunk,
  getSurfaceY,
  resolveWorldOptions
};

