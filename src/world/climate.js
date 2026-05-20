const biomes = require('../biomes');
const {
  clamp,
  smoothstep,
  fbmNoise2d,
  valueNoise2d
} = require('./noise');
const { getTerrainMetrics } = require('./terrain');

const LAND_CLIMATE_SELECTION_CACHE = new Map();
const COLUMN_CLIMATE_CACHE = new Map();
const BIOME_REGION_CACHE = new Map();
const BIOME_REGION_CELL_SIZE = 640;
const BIOME_REGION_WARP_FREQUENCY = 0.00082;
const BIOME_REGION_WARP_STRENGTH = 224;

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

  if (biomeKey === 'snowyTaiga') {
    return biomes.snowyTaiga.createProfile(worldOptions);
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

  if (biomeKey === 'jungle') {
    return biomes.jungle.createProfile(worldOptions);
  }

  if (biomeKey === 'sparseJungle') {
    return biomes.sparseJungle.createProfile(worldOptions);
  }

  if (biomeKey === 'swamp') {
    return biomes.swamp.createProfile(worldOptions);
  }

  if (biomeKey === 'snowyPlains') {
    return biomes.snowyPlains.createProfile(worldOptions);
  }

  if (biomeKey === 'savanna') {
    return biomes.savanna.createProfile(worldOptions);
  }

  if (biomeKey === 'darkForest') {
    return biomes.darkForest.createProfile(worldOptions);
  }

  if (biomeKey === 'windsweptForest') {
    return biomes.windsweptForest.createProfile(worldOptions);
  }

  if (biomeKey === 'windsweptHills') {
    return biomes.windsweptHills.createProfile(worldOptions);
  }

  if (biomeKey === 'meadow') {
    return biomes.meadow.createProfile(worldOptions);
  }

  if (biomeKey === 'stonyPeaks') {
    return biomes.stonyPeaks.createProfile(worldOptions);
  }

  if (biomeKey === 'jaggedPeaks') {
    return biomes.jaggedPeaks.createProfile(worldOptions);
  }

  if (biomeKey === 'warmOcean') {
    return biomes.warmOcean.createProfile(worldOptions);
  }

  if (biomeKey === 'lukewarmOcean') {
    return biomes.lukewarmOcean.createProfile(worldOptions);
  }

  if (biomeKey === 'coldOcean') {
    return biomes.coldOcean.createProfile(worldOptions);
  }

  if (biomeKey === 'frozenOcean') {
    return biomes.frozenOcean.createProfile(worldOptions);
  }

  return biomes.plains.createProfile(worldOptions);
}

function getForcedBiomeProfile(worldOptions) {
  if (worldOptions.biomeName.includes('warm_ocean') || worldOptions.biomeName.includes('warm-ocean')) {
    return biomes.warmOcean.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('cold_ocean') || worldOptions.biomeName.includes('cold-ocean')) {
    return biomes.coldOcean.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('frozen_ocean') || worldOptions.biomeName.includes('frozen-ocean')) {
    return biomes.frozenOcean.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('lukewarm_ocean') || worldOptions.biomeName.includes('lukewarm-ocean')) {
    return biomes.lukewarmOcean.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('dark_forest') || worldOptions.biomeName.includes('dark-forest')) {
    return biomes.darkForest.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('windswept_forest') || worldOptions.biomeName.includes('windswept-forest')) {
    return biomes.windsweptForest.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('windswept_hills') || worldOptions.biomeName.includes('windswept-hills')) {
    return biomes.windsweptHills.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('old_growth') || worldOptions.biomeName.includes('old-growth')) {
    return biomes.oldGrowthBirchForest.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('flower_forest') || worldOptions.biomeName.includes('flower-forest')) {
    return biomes.flowerForest.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('sparse_jungle') || worldOptions.biomeName.includes('sparse-jungle')) {
    return biomes.sparseJungle.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('jungle')) {
    return biomes.jungle.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('sunflower_plains') || worldOptions.biomeName.includes('sunflower-plains')) {
    return biomes.sunflowerPlains.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('stony_peaks') || worldOptions.biomeName.includes('stony-peaks')) {
    return biomes.stonyPeaks.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('jagged_peaks') || worldOptions.biomeName.includes('jagged-peaks')) {
    return biomes.jaggedPeaks.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('meadow')) {
    return biomes.meadow.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('river')) {
    return biomes.plains.createProfile(worldOptions);
  }

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

  if (worldOptions.biomeName.includes('sunflower')) {
    return biomes.sunflowerPlains.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('flower')) {
    return biomes.flowerForest.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('forest')) {
    return biomes.forest.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('snowy_taiga') || worldOptions.biomeName.includes('snowy-taiga')) {
    return biomes.snowyTaiga.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('taiga')) {
    return biomes.taiga.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('birch')) {
    return biomes.birchForest.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('desert')) {
    return biomes.desert.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('swamp')) {
    return biomes.swamp.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('snow')) {
    return biomes.snowyPlains.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('savanna')) {
    return biomes.savanna.createProfile(worldOptions);
  }

  if (worldOptions.biomeName.includes('plains')) {
    return biomes.plains.createProfile(worldOptions);
  }

  return biomes.plains.createProfile(worldOptions);
}

function getTemperatureNoise(worldX, worldZ, seedOffset = 0) {
  return fbmNoise2d(worldX, worldZ, seedOffset + 1301, {
    frequency: 0.0017,
    octaves: 4,
    persistence: 0.56,
    lacunarity: 2.04
  });
}

function getMoistureNoise(worldX, worldZ, seedOffset = 0) {
  return fbmNoise2d(worldX, worldZ, seedOffset + 1337, {
    frequency: 0.00185,
    octaves: 4,
    persistence: 0.58,
    lacunarity: 2
  });
}

function getWeirdnessNoise(worldX, worldZ, seedOffset = 0) {
  return fbmNoise2d(worldX, worldZ, seedOffset + 1367, {
    frequency: 0.0024,
    octaves: 3,
    persistence: 0.55,
    lacunarity: 2.08
  });
}

function getMacroTemperatureNoise(worldX, worldZ, seedOffset = 0) {
  return fbmNoise2d(worldX, worldZ, seedOffset + 3301, {
    frequency: 0.00072,
    octaves: 3,
    persistence: 0.58,
    lacunarity: 2
  });
}

function getMacroMoistureNoise(worldX, worldZ, seedOffset = 0) {
  return fbmNoise2d(worldX, worldZ, seedOffset + 3337, {
    frequency: 0.00078,
    octaves: 3,
    persistence: 0.6,
    lacunarity: 2.02
  });
}

function getMacroWeirdnessNoise(worldX, worldZ, seedOffset = 0) {
  return fbmNoise2d(worldX, worldZ, seedOffset + 3367, {
    frequency: 0.00095,
    octaves: 3,
    persistence: 0.55,
    lacunarity: 2.04
  });
}

function getBiomeRegionNoise(worldX, worldZ, seedOffset = 0) {
  return fbmNoise2d(worldX, worldZ, seedOffset + 3401, {
    frequency: 0.0005,
    octaves: 3,
    persistence: 0.58,
    lacunarity: 2
  });
}

function getClimateBandWeight(value, center, radius) {
  return 1 - smoothstep(clamp(Math.abs(value - center) / radius, 0, 1));
}

function getLandClimateSample(worldOptions, worldX, worldZ) {
  const terrainMetrics = getTerrainMetrics(
    worldX,
    worldZ,
    64,
    worldOptions.terrainAmplitude,
    worldOptions.seedHash,
    worldOptions.maxWorldY
  );
  const macroTemperature = getMacroTemperatureNoise(worldX, worldZ, worldOptions.seedHash);
  const macroMoisture = getMacroMoistureNoise(worldX, worldZ, worldOptions.seedHash);
  const macroWeirdness = getMacroWeirdnessNoise(worldX, worldZ, worldOptions.seedHash);
  const localTemperature = getTemperatureNoise(worldX, worldZ, worldOptions.seedHash);
  const localMoisture = getMoistureNoise(worldX, worldZ, worldOptions.seedHash);
  const localWeirdness = getWeirdnessNoise(worldX, worldZ, worldOptions.seedHash);

  return {
    continentalness: terrainMetrics.continentalness,
    erosion: terrainMetrics.erosion,
    inlandness: terrainMetrics.inlandness,
    macroMoisture,
    macroTemperature,
    macroWeirdness,
    moisture: (macroMoisture * 0.88) + (localMoisture * 0.12),
    temperature: (macroTemperature * 0.9) + (localTemperature * 0.1),
    weirdness: (macroWeirdness * 0.82) + (localWeirdness * 0.18),
    ruggedness: terrainMetrics.ruggedness
  };
}

function getBiomeRegionFamily(climate, worldX, worldZ, seedOffset = 0) {
  const regionNoise = getBiomeRegionNoise(worldX, worldZ, seedOffset);
  const hotFactor = smoothstep(clamp((climate.macroTemperature - 0.16) / 0.5, 0, 1));
  const coldFactor = smoothstep(clamp(((-climate.macroTemperature) - 0.12) / 0.48, 0, 1));
  const wetFactor = smoothstep(clamp((climate.macroMoisture - 0.14) / 0.5, 0, 1));
  const dryFactor = smoothstep(clamp(((-climate.macroMoisture) - 0.04) / 0.46, 0, 1));
  const ruggedFactor = smoothstep(clamp((climate.ruggedness - 0.34) / 0.36, 0, 1));

  if (coldFactor > 0.54) {
    return regionNoise > 0.08 || ruggedFactor > 0.56
      ? 'coldRugged'
      : 'cold';
  }

  if (hotFactor > 0.56 && wetFactor > dryFactor + 0.08) {
    return 'tropical';
  }

  if (hotFactor > 0.46 && dryFactor > 0.42) {
    return regionNoise > 0.06
      ? 'hotDry'
      : 'warmOpen';
  }

  if (wetFactor > 0.54) {
    return regionNoise > 0.18
      ? 'wetland'
      : 'temperateForest';
  }

  if (ruggedFactor > 0.6 || regionNoise < -0.28) {
    return 'temperateRugged';
  }

  return regionNoise > 0.1
    ? 'temperateForest'
    : 'temperateOpen';
}

function applyRegionConstraints(weights, regionFamily) {
  const familyWeights = {
    cold: {
      snowyPlains: 1,
      snowyTaiga: 0.96,
      taiga: 0.42,
      birchForest: 0.18,
      plains: 0.14,
      windsweptHills: 0.18
    },
    coldRugged: {
      snowyTaiga: 1,
      taiga: 0.84,
      windsweptHills: 0.72,
      windsweptForest: 0.38,
      snowyPlains: 0.34,
      birchForest: 0.1
    },
    hotDry: {
      desert: 1,
      savanna: 0.74,
      sunflowerPlains: 0.42,
      plains: 0.18,
      windsweptHills: 0.06
    },
    warmOpen: {
      savanna: 1,
      sunflowerPlains: 0.72,
      plains: 0.46,
      desert: 0.34,
      sparseJungle: 0.16,
      forest: 0.1
    },
    tropical: {
      jungle: 1,
      sparseJungle: 0.82,
      swamp: 0.34,
      forest: 0.18,
      plains: 0.06
    },
    wetland: {
      swamp: 1,
      forest: 0.72,
      darkForest: 0.5,
      flowerForest: 0.22,
      plains: 0.18,
      jungle: 0.1
    },
    temperateForest: {
      forest: 1,
      birchForest: 0.82,
      darkForest: 0.54,
      flowerForest: 0.36,
      oldGrowthBirchForest: 0.34,
      plains: 0.2,
      taiga: 0.18
    },
    temperateOpen: {
      plains: 1,
      sunflowerPlains: 0.56,
      birchForest: 0.34,
      forest: 0.28,
      savanna: 0.18,
      windsweptHills: 0.14
    },
    temperateRugged: {
      windsweptHills: 1,
      windsweptForest: 0.74,
      taiga: 0.46,
      forest: 0.2,
      plains: 0.12,
      birchForest: 0.12
    }
  };
  const allowed = familyWeights[regionFamily] ?? familyWeights.temperateOpen;
  const constrainedWeights = {};

  for (const [biomeKey, weight] of Object.entries(weights)) {
    constrainedWeights[biomeKey] = weight * (allowed[biomeKey] ?? 0.005);
  }

  return constrainedWeights;
}

function getClimateBiomeWeights(climate) {
  const flatFactor = 1 - smoothstep(clamp((climate.ruggedness - 0.32) / 0.42, 0, 1));
  const rollingFactor = getClimateBandWeight(climate.ruggedness, 0.38, 0.34);
  const ruggedFactor = smoothstep(clamp((climate.ruggedness - 0.34) / 0.42, 0, 1));
  const shelteredFactor = 1 - smoothstep(clamp((climate.erosion + 0.06) / 0.52, 0, 1));
  const warmWeirdness = smoothstep(clamp((climate.weirdness + 0.08) / 0.48, 0, 1));
  const coolWeirdness = smoothstep(clamp((-climate.weirdness + 0.12) / 0.52, 0, 1));
  const hotFactor = smoothstep(clamp((climate.temperature - 0.18) / 0.48, 0, 1));
  const dryFactor = smoothstep(clamp(((-climate.moisture) - 0.02) / 0.54, 0, 1));

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
      getClimateBandWeight(climate.temperature, -0.42, 0.48) *
      getClimateBandWeight(climate.moisture, 0.28, 0.58) *
      (0.34 + (ruggedFactor * 0.28) + (climate.inlandness * 0.38) + (coolWeirdness * 0.12))
    ),
    snowyTaiga: Math.max(0.001,
      getClimateBandWeight(climate.temperature, -0.64, 0.34) *
      getClimateBandWeight(climate.moisture, 0.18, 0.52) *
      (0.34 + (ruggedFactor * 0.34) + (climate.inlandness * 0.32) + (coolWeirdness * 0.26))
    ),
    desert: Math.max(0.001,
      getClimateBandWeight(climate.temperature, 0.58, 0.58) *
      getClimateBandWeight(climate.moisture, -0.46, 0.68) *
      (0.32 + (flatFactor * 0.4) + (dryFactor * 0.42) + (hotFactor * 0.3) + (warmWeirdness * 0.16))
    ),
    jungle: Math.max(0.001,
      getClimateBandWeight(climate.temperature, 0.7, 0.5) *
      getClimateBandWeight(climate.moisture, 0.66, 0.42) *
      (0.42 + (shelteredFactor * 0.28) + (warmWeirdness * 0.18) + (hotFactor * 0.28))
    ),
    sparseJungle: Math.max(0.001,
      getClimateBandWeight(climate.temperature, 0.64, 0.52) *
      getClimateBandWeight(climate.moisture, 0.38, 0.58) *
      (0.28 + (rollingFactor * 0.2) + (hotFactor * 0.18) + (warmWeirdness * 0.16))
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
    ),
    savanna: Math.max(0.001,
      getClimateBandWeight(climate.temperature, 0.46, 0.62) *
      getClimateBandWeight(climate.moisture, -0.22, 0.72) *
      (0.34 + (flatFactor * 0.24) + (dryFactor * 0.22) + (hotFactor * 0.26) + (warmWeirdness * 0.34))
    ),
    darkForest: Math.max(0.001,
      getClimateBandWeight(climate.temperature, 0.04, 0.52) *
      getClimateBandWeight(climate.moisture, 0.48, 0.5) *
      (0.34 + (ruggedFactor * 0.26) + (shelteredFactor * 0.32) + (coolWeirdness * 0.08))
    ),
    windsweptForest: Math.max(0.001,
      getClimateBandWeight(climate.temperature, 0.02, 0.46) *
      getClimateBandWeight(climate.moisture, 0.08, 0.56) *
      (0.22 + (ruggedFactor * 0.38) + (coolWeirdness * 0.14) + (warmWeirdness * 0.08))
    ),
    windsweptHills: Math.max(0.001,
      getClimateBandWeight(climate.temperature, -0.02, 0.54) *
      getClimateBandWeight(climate.moisture, -0.04, 0.64) *
      (0.14 + (ruggedFactor * 0.48) + (coolWeirdness * 0.12) + (climate.inlandness * 0.08))
    )
  };
}

function getLandBiomeProfiles(worldOptions) {
  return {
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
    snowyTaiga: {
      ...getLegacyBiomeProfile(worldOptions, 'snowyTaiga'),
      allowWater: true
    },
    desert: biomes.desert.createProfile(worldOptions),
    jungle: biomes.jungle.createProfile(worldOptions),
    sparseJungle: biomes.sparseJungle.createProfile(worldOptions),
    swamp: biomes.swamp.createProfile(worldOptions),
    snowyPlains: biomes.snowyPlains.createProfile(worldOptions),
    savanna: biomes.savanna.createProfile(worldOptions),
    darkForest: biomes.darkForest.createProfile(worldOptions),
    windsweptForest: biomes.windsweptForest.createProfile(worldOptions),
    windsweptHills: biomes.windsweptHills.createProfile(worldOptions)
  };
}

function collapseSpecialBiomeWeights(weights) {
  const collapsed = { ...weights };
  collapsed.plains += collapsed.sunflowerPlains ?? 0;
  collapsed.forest += collapsed.flowerForest ?? 0;
  collapsed.birchForest += collapsed.oldGrowthBirchForest ?? 0;
  collapsed.sunflowerPlains = 0.001;
  collapsed.flowerForest = 0.001;
  collapsed.oldGrowthBirchForest = 0.001;
  return collapsed;
}

function getTotalWeight(weights) {
  return Object.values(weights).reduce((sum, weight) => sum + weight, 0);
}

function normalizeBiomeWeights(weights) {
  const totalWeight = getTotalWeight(weights);

  if (totalWeight <= 0) {
    const keys = Object.keys(weights);
    const fallbackWeight = keys.length > 0 ? 1 / keys.length : 0;
    return Object.fromEntries(keys.map((key) => [key, fallbackWeight]));
  }

  return Object.fromEntries(
    Object.entries(weights).map(([biomeKey, weight]) => [biomeKey, weight / totalWeight])
  );
}

function getPrimaryBiomeKey(weights, fallbackKey = 'plains') {
  return Object.entries(weights).reduce(
    (bestKey, [biomeKey, weight]) => (weight > (weights[bestKey] ?? Number.NEGATIVE_INFINITY) ? biomeKey : bestKey),
    fallbackKey
  );
}

function getSecondaryBiomeKey(weights, primaryBiomeKey) {
  let secondaryBiomeKey = primaryBiomeKey;
  let secondaryWeight = Number.NEGATIVE_INFINITY;

  for (const [biomeKey, weight] of Object.entries(weights)) {
    if (biomeKey === primaryBiomeKey) {
      continue;
    }

    if (weight > secondaryWeight) {
      secondaryBiomeKey = biomeKey;
      secondaryWeight = weight;
    }
  }

  return secondaryBiomeKey;
}

function getBiomeRegionCell(worldOptions, cellX, cellZ) {
  const cacheKey = `${worldOptions.seedHash}:${cellX},${cellZ}`;

  if (BIOME_REGION_CACHE.has(cacheKey)) {
    return BIOME_REGION_CACHE.get(cacheKey);
  }

  const centerX = ((cellX + 0.5) * BIOME_REGION_CELL_SIZE) + (
    ((valueNoise2d(cellX, cellZ, worldOptions.seedHash + 3511, 1) * 2) - 1) *
    (BIOME_REGION_CELL_SIZE * 0.34)
  );
  const centerZ = ((cellZ + 0.5) * BIOME_REGION_CELL_SIZE) + (
    ((valueNoise2d(cellX, cellZ, worldOptions.seedHash + 3547, 1) * 2) - 1) *
    (BIOME_REGION_CELL_SIZE * 0.34)
  );
  const climate = getLandClimateSample(worldOptions, centerX, centerZ);
  const regionFamily = getBiomeRegionFamily(climate, centerX, centerZ, worldOptions.seedHash);
  const weights = normalizeBiomeWeights(
    applyRegionConstraints(
      collapseSpecialBiomeWeights(getClimateBiomeWeights(climate)),
      regionFamily
    )
  );
  const primaryBiomeKey = getPrimaryBiomeKey(weights);
  const secondaryBiomeKey = getSecondaryBiomeKey(weights, primaryBiomeKey);
  const cell = {
    centerX,
    centerZ,
    climate,
    primaryBiomeKey,
    regionFamily,
    secondaryBiomeKey,
    weights
  };

  if (BIOME_REGION_CACHE.size > 8192) {
    BIOME_REGION_CACHE.clear();
  }

  BIOME_REGION_CACHE.set(cacheKey, cell);
  return cell;
}

function getBiomeRegionSelection(worldOptions, worldX, worldZ) {
  const warpedX = worldX + (
    ((valueNoise2d(worldX, worldZ, worldOptions.seedHash + 3601, BIOME_REGION_WARP_FREQUENCY) * 2) - 1) *
    BIOME_REGION_WARP_STRENGTH
  );
  const warpedZ = worldZ + (
    ((valueNoise2d(worldX, worldZ, worldOptions.seedHash + 3637, BIOME_REGION_WARP_FREQUENCY) * 2) - 1) *
    BIOME_REGION_WARP_STRENGTH
  );
  const baseCellX = Math.floor(warpedX / BIOME_REGION_CELL_SIZE);
  const baseCellZ = Math.floor(warpedZ / BIOME_REGION_CELL_SIZE);
  const candidates = [];

  for (let offsetX = -1; offsetX <= 1; offsetX++) {
    for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
      const cell = getBiomeRegionCell(worldOptions, baseCellX + offsetX, baseCellZ + offsetZ);
      candidates.push({
        cell,
        distance: Math.hypot(warpedX - cell.centerX, warpedZ - cell.centerZ)
      });
    }
  }

  candidates.sort((left, right) => left.distance - right.distance);

  const dominantCell = candidates[0].cell;
  const secondaryCell = candidates[1]?.cell ?? dominantCell;
  const dominantDistance = candidates[0].distance;
  const secondaryDistance = candidates[1]?.distance ?? (dominantDistance + BIOME_REGION_CELL_SIZE);
  const centerWeight = smoothstep(clamp((secondaryDistance - dominantDistance) / (BIOME_REGION_CELL_SIZE * 0.42), 0, 1));
  const edgeBlend = 1 - centerWeight;
  const secondaryInfluence = secondaryCell === dominantCell
    ? 0
    : edgeBlend * 0.42;
  const blendedWeights = {};

  for (const biomeKey of Object.keys(dominantCell.weights)) {
    blendedWeights[biomeKey] =
      (dominantCell.weights[biomeKey] * (1 - secondaryInfluence)) +
      ((secondaryCell.weights[biomeKey] ?? 0) * secondaryInfluence);
  }

  return {
    anchorStrength: 0.62 + (centerWeight * 0.22),
    blendedWeights,
    centerWeight,
    dominantCell,
    edgeBlend,
    primaryBiomeKey: dominantCell.primaryBiomeKey,
    regionFamily: dominantCell.regionFamily,
    secondaryBiomeKey: secondaryCell.primaryBiomeKey
  };
}

function applyRegionBiasToWeights(weights, regionSelection) {
  const totalWeight = getTotalWeight(weights);
  const anchoredWeights = {};

  for (const [biomeKey, localWeight] of Object.entries(weights)) {
    const regionWeight = (regionSelection.blendedWeights[biomeKey] ?? 0) * totalWeight;
    anchoredWeights[biomeKey] =
      (localWeight * (1 - regionSelection.anchorStrength)) +
      (regionWeight * regionSelection.anchorStrength);
  }

  anchoredWeights[regionSelection.primaryBiomeKey] *= 1.18 + (regionSelection.centerWeight * 0.52);
  anchoredWeights[regionSelection.secondaryBiomeKey] *= 1.04 + (regionSelection.edgeBlend * 0.22);
  return anchoredWeights;
}

function resolveSpecialBiomeVariant(worldOptions, biomeKey, climate, worldX, worldZ) {
  if (
    biomeKey === 'plains' &&
    climate.temperature > 0.12 &&
    climate.moisture > -0.2 &&
    getSunflowerPlainsNoise(worldX, worldZ, worldOptions.seedHash) > 0.7
  ) {
    return 'sunflowerPlains';
  }

  if (
    biomeKey === 'forest' &&
    climate.temperature > -0.04 &&
    climate.moisture > 0.24 &&
    getFlowerForestNoise(worldX, worldZ, worldOptions.seedHash) > 0.72
  ) {
    return 'flowerForest';
  }

  if (
    biomeKey === 'birchForest' &&
    climate.temperature < 0.16 &&
    climate.moisture > 0.18 &&
    climate.inlandness > 0.22 &&
    getOldGrowthBirchNoise(worldX, worldZ, worldOptions.seedHash) > 0.76
  ) {
    return 'oldGrowthBirchForest';
  }

  if (
    biomeKey === 'taiga' &&
    climate.temperature < -0.46 &&
    climate.moisture > 0.08 &&
    getTaigaNoise(worldX, worldZ, worldOptions.seedHash) > 0.74
  ) {
    return 'snowyTaiga';
  }

  return biomeKey;
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
  const unconstrainedWeights = collapseSpecialBiomeWeights(getClimateBiomeWeights(climate));
  const regionSelection = getBiomeRegionSelection(worldOptions, worldX, worldZ);
  const weights = applyRegionBiasToWeights(
    applyRegionConstraints(unconstrainedWeights, regionSelection.regionFamily),
    regionSelection
  );
  const profiles = getLandBiomeProfiles(worldOptions);
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const blendedTerrainAmplitudeOffset = Object.entries(weights).reduce(
    (sum, [biomeKey, weight]) => sum + (profiles[biomeKey].terrainAmplitudeOffset * weight),
    0
  ) / totalWeight;
  const baseBiomeKey = getPrimaryBiomeKey(weights, 'plains');
  const primaryBiomeKey = resolveSpecialBiomeVariant(
    worldOptions,
    baseBiomeKey,
    climate,
    worldX,
    worldZ
  );

  const selection = {
    blendedTerrainAmplitudeOffset,
    climate,
    primaryProfile: profiles[primaryBiomeKey],
    regionFamily: regionSelection.regionFamily,
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

module.exports = {
  getLegacyBiomeProfile,
  getForcedBiomeProfile,
  getTemperatureNoise,
  getLandClimateSample,
  getLandClimateSelection,
  getColumnClimate,
  getBiomeProfile,
  getLandBiomeProfile,
  getBlendedLandTerrainAmplitudeOffset
};
