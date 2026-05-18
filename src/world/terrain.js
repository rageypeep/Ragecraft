const {
  clamp,
  smoothstep,
  fbmNoise2d,
  ridgeNoise2d,
  signedValueNoise2d,
  valueNoise2d
} = require('./noise');

const SPAWN_TERRAIN_CLEAR_RADIUS = 24;
const SPAWN_MAJOR_WATER_CLEAR_RADIUS = 56;
const TERRAIN_HEIGHT_CACHE = new Map();

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
  const continentalLift = ((-(amplitude * 0.5)) + ((amplitude * 5.1) - (-(amplitude * 0.5))) * continentalFactor);
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
        worldOptions.seedHash
      );
      minTopY = Math.min(minTopY, topY);
      maxTopY = Math.max(maxTopY, topY);
    }
  }

  return maxTopY - minTopY;
}

function getMountainBiomeKey(terrainMetrics, climate, elevationAboveWater) {
  if (terrainMetrics.mountainness < 0.38) {
    return null;
  }

  const effectiveTemperature = climate?.effectiveTemperature ?? climate?.temperature ?? 0;
  const freezeChance = climate?.freezeChance ?? 0;
  const severeCold = freezeChance > 0.66 || effectiveTemperature < -0.54;
  const coldAlpine = freezeChance > 0.44 || effectiveTemperature < -0.32;
  const temperateAlpine = freezeChance < 0.54 && effectiveTemperature > -0.18;
  const rockyMountain =
    terrainMetrics.mountainness >= 0.54 &&
    (
      terrainMetrics.ruggedness >= 0.42 ||
      terrainMetrics.cliffiness >= 0.24 ||
      elevationAboveWater >= 28
    );

  if (
    terrainMetrics.mountainness >= 0.72 &&
    terrainMetrics.ruggedness >= 0.48 &&
    severeCold
  ) {
    return 'jagged_peaks';
  }

  if (
    terrainMetrics.mountainness >= 0.44 &&
    temperateAlpine &&
    terrainMetrics.ruggedness < 0.64 &&
    terrainMetrics.cliffiness < 0.34
  ) {
    return 'meadow';
  }

  if (rockyMountain && (coldAlpine || terrainMetrics.ruggedness >= 0.52 || terrainMetrics.cliffiness >= 0.3)) {
    return 'stony_peaks';
  }

  if (terrainMetrics.mountainness >= 0.44 && effectiveTemperature > -0.42) {
    return 'meadow';
  }

  return rockyMountain ? 'stony_peaks' : null;
}

module.exports = {
  getSpawnTerrainBlend,
  getSpawnMajorWaterBlend,
  getTerrainMetrics,
  getTerrainHeight,
  getSpawnSafeTopY,
  getTerrainRelief,
  getMountainBiomeKey
};
