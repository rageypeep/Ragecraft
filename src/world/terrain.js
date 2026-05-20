const {
  clamp,
  smoothstep,
  fbmNoise2d,
  ridgeNoise2d,
  signedValueNoise2d,
  valueNoise2d
} = require('./noise');
const { LANDFORM_TYPES, getLandformType } = require('./landforms');

const SPAWN_TERRAIN_CLEAR_RADIUS = 24;
const SPAWN_MAJOR_WATER_CLEAR_RADIUS = 56;
const TERRAIN_HEIGHT_CACHE = new Map();
const TERRAIN_MAX_TOP_HEADROOM = 8;
const TERRAIN_SOFT_CEILING_RANGE = 40;

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

function applyTerrainCeiling(topY, maxTopY) {
  if (!Number.isFinite(maxTopY)) {
    return topY;
  }

  const ceilingTopY = maxTopY - TERRAIN_MAX_TOP_HEADROOM;
  const softCeilingStartY = ceilingTopY - TERRAIN_SOFT_CEILING_RANGE;

  if (topY <= softCeilingStartY) {
    return topY;
  }

  const overflow = topY - softCeilingStartY;
  const compressedOverflow = overflow / (1 + (overflow / (TERRAIN_SOFT_CEILING_RANGE * 0.9)));
  return Math.min(ceilingTopY, Math.round(softCeilingStartY + compressedOverflow));
}

function getTerrainMetrics(worldX, worldZ, surfaceY, amplitude, seedOffset = 0, maxTopY = null) {
  const cacheKey = `${worldX},${worldZ},${surfaceY},${amplitude},${seedOffset},${maxTopY ?? 'none'}`;

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
  const coastalRise = smoothstep(clamp((inlandness - 0.02) / 0.24, 0, 1));
  const coastalPlainFactor = 1 - smoothstep(clamp((inlandness - 0.16) / 0.24, 0, 1));
  const inlandReliefFreedom = 0.42 + (inlandness * 0.58);
  const inlandCliffFreedom = 0.28 + (inlandness * 0.72);
  const mountainMask = smoothstep(clamp((inlandness - 0.2) / 0.5, 0, 1)) *
    smoothstep(clamp((ruggedness - 0.14) / 0.5, 0, 1));
  const foothillMask = smoothstep(clamp((mountainShape + 0.24) / 0.72, 0, 1)) *
    smoothstep(clamp((inlandness - 0.02) / 0.62, 0, 1)) *
    smoothstep(clamp((ruggedness - 0.04) / 0.62, 0, 1));
  const mountainRegion = smoothstep(clamp((mountainShape - 0.03) / 0.5, 0, 1)) * mountainMask;
  const mountainCore = smoothstep(clamp((mountainShape + (mountainRidges * 0.14) - 0.22) / 0.4, 0, 1)) * mountainMask;
  const mountainTransition = smoothstep(clamp((foothillMask - 0.12) / 0.62, 0, 1));
  const plateauEscalation = smoothstep(clamp((mountainRegion - 0.3) / 0.56, 0, 1));
  const coreEscalation = smoothstep(clamp((mountainCore - 0.24) / 0.52, 0, 1));
  const highRangeMask = smoothstep(clamp((mountainCore - 0.34) / 0.46, 0, 1));
  const continentalLift = ((-(amplitude * 0.95)) + ((amplitude * 3.9) - (-(amplitude * 0.95))) * Math.pow(continentalFactor, 1.12));
  const lowlandRise = coastalRise * (amplitude * 0.35);
  const inlandUplift = smoothstep(clamp((inlandness - 0.26) / 0.42, 0, 1)) * (amplitude * 1.35);
  const macroRelief = macro * (amplitude * 1.2) * inlandReliefFreedom;
  const hillRelief = hills * (amplitude * (0.45 + (inlandness * 0.7))) * inlandReliefFreedom;
  const ridgeBoost = Math.max(0, ridges - (0.46 + (erosion * 0.08))) * (amplitude * (1.15 + (ruggedness * 1.05))) * inlandCliffFreedom;
  const cliffBoost = Math.max(0, cliffs - 0.68) * (amplitude * (0.8 + (ruggedness * 1.35))) * inlandCliffFreedom;
  const foothillLift = foothillMask *
    (amplitude * (3.5 + (inlandness * 3.8) + (ruggedness * 2.4)));
  const mountainPlateauLift = mountainRegion *
    (0.18 + (plateauEscalation * 0.82)) *
    (amplitude * (4.3 + (inlandness * 3.1) + (ruggedness * 2.3)));
  const mountainShoulderLift = mountainCore *
    (0.16 + (coreEscalation * 0.84)) *
    (amplitude * (2.6 + (inlandness * 1.4) + (ruggedness * 1.5)));
  const alpineRelief = Math.max(0, alpineReliefNoise + (mountainRidges * 0.45) - 0.12) *
    (0.18 + (coreEscalation * 0.82)) *
    (amplitude * (2.2 + (ruggedness * 2.4) + (mountainCore * 1.2))) *
    mountainCore;
  const peakBoost = Math.max(0, mountainRidges - (0.34 - (ruggedness * 0.06))) *
    (0.14 + (highRangeMask * 0.86)) *
    (amplitude * (3.6 + (ruggedness * 3.8) + (inlandness * 1.5))) *
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
    mountainRegion *
    (0.18 + (plateauEscalation * 0.82));
  const valleyCut = Math.max(0, -valleyMask) * (amplitude * (0.72 + (coastalPlainFactor * 0.3) + (inlandness * 0.72)));
  const terrainOffset =
    (amplitude * 1.15) +
    continentalLift +
    lowlandRise +
    inlandUplift +
    macroRelief +
    hillRelief +
    ridgeBoost +
    cliffBoost -
    valleyCut +
    foothillLift +
    mountainPlateauLift +
    mountainShoulderLift +
    alpineRelief +
    peakBoost +
    rarePeakBoost +
    ultraPeakBoost +
    cliffFaceBoost;
  const unclampedTopY = waterLevel + Math.round(terrainOffset);
  const terrainMetrics = {
    cliffiness: clamp((cliffBoost + cliffFaceBoost + (peakBoost * 0.28) + (rarePeakBoost * 0.12)) / Math.max(1, amplitude * 12), 0, 1),
    continentalness,
    erosion,
    foothillness: clamp(
      (foothillMask * 0.72) +
      (mountainTransition * 0.22) -
      (highRangeMask * 0.18),
      0,
      1
    ),
    inlandness,
    mountainness: clamp(
      (foothillMask * 0.16) +
      (mountainRegion * 0.52) +
      (mountainCore * 0.34) +
      ((foothillLift + mountainPlateauLift + mountainShoulderLift + peakBoost + rarePeakBoost) / Math.max(1, amplitude * 138)),
      0,
      1
    ),
    ruggedness,
    topY: applyTerrainCeiling(unclampedTopY, maxTopY)
  };

  if (TERRAIN_HEIGHT_CACHE.size > 250000) {
    TERRAIN_HEIGHT_CACHE.clear();
  }

  TERRAIN_HEIGHT_CACHE.set(cacheKey, terrainMetrics);
  return terrainMetrics;
}

function getTerrainHeight(worldX, worldZ, surfaceY, amplitude, seedOffset = 0, maxTopY = null) {
  return getTerrainMetrics(worldX, worldZ, surfaceY, amplitude, seedOffset, maxTopY).topY;
}

function getSpawnSafeTopY(worldOptions, surfaceY, spawn, worldX, worldZ, baseTopY) {
  const minSpawnTopY = surfaceY + 2;
  const spawnBlend = getSpawnTerrainBlend(spawn, worldX, worldZ);
  if (spawnBlend <= 0) {
    return baseTopY;
  }

  return Math.max(
    baseTopY,
    Math.round(baseTopY + ((minSpawnTopY - baseTopY) * spawnBlend))
  );
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
        worldOptions.seedHash,
        worldOptions.maxWorldY
      );
      minTopY = Math.min(minTopY, topY);
      maxTopY = Math.max(maxTopY, topY);
    }
  }

  return maxTopY - minTopY;
}

function getMountainBiomeKey(terrainMetrics, climate, elevationAboveWater, localRelief = Number.POSITIVE_INFINITY) {
  if (terrainMetrics.mountainness < 0.38) {
    return null;
  }

  const landformType = getLandformType(terrainMetrics, elevationAboveWater, localRelief);
  const effectiveTemperature = climate?.effectiveTemperature ?? climate?.temperature ?? 0;
  const freezeChance = climate?.freezeChance ?? 0;
  const severeCold = freezeChance > 0.66 || effectiveTemperature < -0.54;
  const coldAlpine = freezeChance > 0.44 || effectiveTemperature < -0.32;
  const temperateAlpine = freezeChance < 0.54 && effectiveTemperature > -0.18;
  const alpineBench =
    elevationAboveWater >= 20 &&
    localRelief <= 14 &&
    terrainMetrics.cliffiness < 0.28 &&
    terrainMetrics.ruggedness < 0.66;
  const rockyMountain =
    terrainMetrics.mountainness >= 0.58 &&
    (
      terrainMetrics.ruggedness >= 0.42 ||
      terrainMetrics.cliffiness >= 0.24 ||
      elevationAboveWater >= 34
    );

  if (landformType !== LANDFORM_TYPES.MOUNTAIN_CORE && landformType !== LANDFORM_TYPES.ALPINE_SHELF) {
    return null;
  }

  if (
    terrainMetrics.mountainness >= 0.76 &&
    terrainMetrics.ruggedness >= 0.48 &&
    severeCold
  ) {
    return 'jagged_peaks';
  }

  if (
    terrainMetrics.mountainness >= 0.44 &&
    temperateAlpine &&
    alpineBench
  ) {
    return 'meadow';
  }

  if (rockyMountain && (coldAlpine || terrainMetrics.ruggedness >= 0.52 || terrainMetrics.cliffiness >= 0.3)) {
    return 'stony_peaks';
  }

  if (
    terrainMetrics.mountainness >= 0.44 &&
    effectiveTemperature > -0.42 &&
    alpineBench
  ) {
    return 'meadow';
  }

  return rockyMountain ? 'stony_peaks' : null;
}

function getFoothillBiomeKey(terrainMetrics, climate, elevationAboveWater, localRelief = Number.POSITIVE_INFINITY) {
  if (!terrainMetrics) {
    return null;
  }

  const landformType = getLandformType(terrainMetrics, elevationAboveWater, localRelief);
  if (landformType !== LANDFORM_TYPES.FOOTHILLS) {
    return null;
  }

  const foothillness = terrainMetrics.foothillness ?? 0;

  if (
    foothillness < 0.34 ||
    elevationAboveWater < 10 ||
    localRelief < 3 ||
    localRelief > 26 ||
    terrainMetrics.cliffiness > 0.28 ||
    terrainMetrics.mountainness < 0.12
  ) {
    return null;
  }

  const effectiveTemperature = climate?.effectiveTemperature ?? climate?.temperature ?? 0;
  const moisture = climate?.moisture ?? 0;
  const freezeChance = climate?.freezeChance ?? 0;
  const woodedFoothills =
    moisture > 0.04 &&
    effectiveTemperature > -0.28 &&
    freezeChance < 0.66 &&
    terrainMetrics.ruggedness < 0.68;

  return woodedFoothills ? 'windswept_forest' : 'windswept_hills';
}

module.exports = {
  getFoothillBiomeKey,
  getSpawnTerrainBlend,
  getSpawnMajorWaterBlend,
  getTerrainMetrics,
  getTerrainHeight,
  getSpawnSafeTopY,
  getTerrainRelief,
  getMountainBiomeKey
};
