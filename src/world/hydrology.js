const biomes = require('../biomes');
const {
  clamp,
  lerp,
  smoothstep,
  fbmNoise2d,
  ridgeNoise2d,
  signedValueNoise2d,
  valueNoise2d
} = require('./noise');
const {
  getSpawnMajorWaterBlend,
  getSpawnSafeTopY,
  getTerrainMetrics,
  getTerrainRelief
} = require('./terrain');
const {
  getBlendedLandTerrainAmplitudeOffset,
  getTemperatureNoise
} = require('./climate');

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

  return (
    (terrainMetrics.cliffiness >= 0.18 || terrainMetrics.ruggedness >= 0.5 || localRelief >= 4) &&
    (cliffNoise > 0.36 || terrainMetrics.cliffiness >= 0.3)
  );
}

function getShoreMaterialStateId(worldOptions, worldX, worldZ, options = {}) {
  const allowDirt = options.allowDirt !== false;
  const clayThreshold = options.clayThreshold ?? 0.94;
  const dirtThreshold = options.dirtThreshold ?? 0.88;
  const gravelThreshold = options.gravelThreshold ?? 0.7;
  const shoreNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 1409, 0.018);
  const materialNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 1423, 0.031);

  if (materialNoise > clayThreshold) {
    return worldOptions.terrainBlockStateIds.clay;
  }

  if (allowDirt && materialNoise > dirtThreshold) {
    return worldOptions.soilBlockStateId;
  }

  if (shoreNoise > gravelThreshold) {
    return worldOptions.terrainBlockStateIds.gravel;
  }

  return worldOptions.terrainBlockStateIds.sand;
}

function getStonyShoreSurfaceStateId(worldOptions, worldX, worldZ) {
  const steepNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 2143, 0.024);

  if (steepNoise > 0.82) {
    return worldOptions.terrainBlockStateIds.gravel;
  }

  if (steepNoise > 0.58) {
    return worldOptions.terrainBlockStateIds.andesite;
  }

  return worldOptions.terrainBlockStateIds.stone;
}

function getSteepBankSurfaceStateId(worldOptions, worldX, worldZ) {
  const steepNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 2161, 0.026);

  if (steepNoise > 0.86) {
    return worldOptions.terrainBlockStateIds.gravel;
  }

  if (steepNoise > 0.64) {
    return worldOptions.terrainBlockStateIds.andesite;
  }

  return worldOptions.terrainBlockStateIds.stone;
}

function shouldUseStonyBankSurface(localRelief, elevationAboveWater, terrainMetrics = null) {
  const steepEnough = localRelief >= 10 || elevationAboveWater >= 9;

  if (!steepEnough) {
    return false;
  }

  if (!terrainMetrics) {
    return true;
  }

  const ruggedness = terrainMetrics.ruggedness ?? 0;
  const cliffiness = terrainMetrics.cliffiness ?? 0;

  return cliffiness >= 0.26 || (ruggedness >= 0.84 && localRelief >= 13);
}

function getLakeBedMaterialStateId(worldOptions, worldX, worldZ) {
  const bedNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 1949, 0.02);
  const patchNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 1973, 0.041);

  if (bedNoise > 0.84) {
    return worldOptions.terrainBlockStateIds.clay;
  }

  if (patchNoise > 0.8) {
    return worldOptions.terrainBlockStateIds.gravel;
  }

  if (patchNoise > 0.58) {
    return worldOptions.terrainBlockStateIds.sand;
  }

  return worldOptions.terrainBlockStateIds.mud;
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
  const trunkWidth = (forcedRiverWorld ? 0.16 : 0.095) +
    (getRiverWidthNoise(worldX, worldZ, worldOptions.seedHash + 31) * 0.032) +
    ((forcedRiverWorld ? 1 : terrainMetrics.inlandness) * 0.022);
  const tributaryWidth = (forcedRiverWorld ? 0.13 : 0.072) +
    (getRiverWidthNoise(worldX, worldZ, worldOptions.seedHash + 67) * 0.026) +
    ((forcedRiverWorld ? 1 : terrainMetrics.inlandness) * 0.016);
  const trunkEdgeNoise = signedValueNoise2d(worldX, worldZ, worldOptions.seedHash + 1711, 0.0095) * 0.018;
  const tributaryEdgeNoise = signedValueNoise2d(worldX, worldZ, worldOptions.seedHash + 1717, 0.017) * 0.035;
  const valleyFactor = smoothstep(clamp((-climate.weirdness + 0.1) / 0.55, 0, 1));
  const wetFactor = smoothstep(clamp((climate.moisture + 0.05) / 0.7, 0, 1));
  const drainageFactor = forcedRiverWorld
    ? 1
    : clamp(
      0.26 +
      (terrainMetrics.inlandness * 0.16) +
      (valleyFactor * 0.12) +
      (wetFactor * 0.08),
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

function getRiverBedMaterialStateId(worldOptions, worldX, worldZ) {
  const bedNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 2003, 0.018);
  const patchNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 2011, 0.034);

  if (bedNoise > 0.86) {
    return worldOptions.terrainBlockStateIds.clay;
  }

  if (patchNoise > 0.78) {
    return worldOptions.terrainBlockStateIds.gravel;
  }

  if (patchNoise > 0.62) {
    return worldOptions.terrainBlockStateIds.sand;
  }

  return worldOptions.terrainBlockStateIds.mud;
}

function getLakeShoreSurfaceStateId(worldOptions, worldX, worldZ, climate, elevationAboveWater, localRelief, terrainMetrics) {
  const ruggedness = terrainMetrics?.ruggedness ?? 0;
  const cliffiness = terrainMetrics?.cliffiness ?? 0;
  const useRockyShore =
    (localRelief >= 12 || elevationAboveWater >= 10) &&
    (ruggedness >= 0.68 || cliffiness >= 0.4);

  if (useRockyShore) {
    return getSteepBankSurfaceStateId(worldOptions, worldX, worldZ);
  }

  return climate.effectiveTemperature < -0.18
    ? worldOptions.terrainBlockStateIds.gravel
    : climate.moisture > 0.36
      ? worldOptions.soilBlockStateId
      : worldOptions.terrainBlockStateIds.sand;
}

function getRiverBankSurfaceStateIds(worldOptions, worldX, worldZ, climate, elevationAboveWater, localRelief, terrainMetrics) {
  const ruggedness = terrainMetrics?.ruggedness ?? 0;
  const cliffiness = terrainMetrics?.cliffiness ?? 0;
  const useRockyBank =
    (localRelief >= 12 || elevationAboveWater >= 10) &&
    (ruggedness >= 0.7 || cliffiness >= 0.42);

  if (useRockyBank) {
    const steepStateId = getSteepBankSurfaceStateId(worldOptions, worldX, worldZ);
    return {
      topBlockStateId: steepStateId,
      soilBlockStateId: steepStateId
    };
  }

  const bankNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 2099, 0.026);
  const patchNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 2123, 0.048);
  const moistTopStateId = climate.moisture > 0.36
    ? worldOptions.terrainBlockStateIds.mud
    : worldOptions.soilBlockStateId;

  if (patchNoise > 0.88) {
    return {
      topBlockStateId: worldOptions.terrainBlockStateIds.gravel,
      soilBlockStateId: worldOptions.terrainBlockStateIds.gravel
    };
  }

  if (bankNoise > 0.82) {
    return {
      topBlockStateId: worldOptions.terrainBlockStateIds.sand,
      soilBlockStateId: worldOptions.terrainBlockStateIds.sand
    };
  }

  if (bankNoise > 0.64 || patchNoise > 0.72) {
    return {
      topBlockStateId: worldOptions.terrainBlockStateIds.mud,
      soilBlockStateId: worldOptions.terrainBlockStateIds.mud
    };
  }

  return {
    topBlockStateId: moistTopStateId,
    soilBlockStateId: moistTopStateId
  };
}

function getOceanBlend(worldOptions, surfaceY, spawn, worldX, worldZ, terrainMetrics, forcedOcean = false) {
  const waterLevel = surfaceY - 1;
  const oceanNoise = getOceanNoise(worldX, worldZ, worldOptions.seedHash);
  const regionalOceanNoise = getOceanRegionNoise(worldX, worldZ, worldOptions.seedHash);
  const coastWarp = signedValueNoise2d(worldX, worldZ, worldOptions.seedHash + 1387, 0.0055) * 0.14;
  const spawnBlend = getSpawnMajorWaterBlend(spawn, worldX, worldZ);
  const continentalness = terrainMetrics.continentalness + coastWarp;
  const regionalFactor = smoothstep(clamp((regionalOceanNoise - 0.08) / 0.48, 0, 1));
  const localFactor = smoothstep(clamp((oceanNoise - 0.12) / 0.56, 0, 1));
  const lowLandFactor = smoothstep(clamp(((waterLevel + 4) - terrainMetrics.topY) / 16, 0, 1));
  const continentalFactor = smoothstep(clamp(((-continentalness) - 0.06) / 0.72, 0, 1));
  const oceanBlend = clamp(
    Math.max(
      regionalFactor * 1.08,
      localFactor * 0.78,
      lowLandFactor * 0.74
    ) * continentalFactor * (1 - spawnBlend),
    0,
    1
  );

  return forcedOcean ? Math.max(oceanBlend, 0.94) : oceanBlend;
}

function getLakeBlend(worldOptions, surfaceY, spawn, worldX, worldZ, terrainMetrics, climate, forcedLake = false) {
  const waterLevel = surfaceY - 1;
  const regionalLakeNoise = getLakeRegionNoise(worldX, worldZ, worldOptions.seedHash);
  const localPocketNoise = getLakePocketNoise(worldX, worldZ, worldOptions.seedHash);
  const spawnBlend = getSpawnMajorWaterBlend(spawn, worldX, worldZ);
  const lowlandFactor = 1 - smoothstep(clamp((terrainMetrics.topY - (waterLevel + 10)) / 20, 0, 1));
  const valleyFactor = smoothstep(clamp(((-climate.weirdness) + 0.04) / 0.48, 0, 1));
  const shelteredFactor = 1 - smoothstep(clamp((climate.ruggedness - 0.46) / 0.28, 0, 1));
  const regionalFactor = smoothstep(clamp((regionalLakeNoise - 0.24) / 0.34, 0, 1));
  const pocketFactor = smoothstep(clamp((localPocketNoise - 0.62) / 0.24, 0, 1));
  const inlandFactor = smoothstep(clamp((terrainMetrics.inlandness - 0.08) / 0.38, 0, 1));
  const lakeBlend = clamp(
    (regionalFactor * 0.52 + pocketFactor * 0.48) *
      lowlandFactor *
      shelteredFactor *
      inlandFactor *
      Math.max(0.22, valleyFactor) *
      (1 - spawnBlend),
    0,
    1
  );

  return forcedLake ? Math.max(lakeBlend, 0.96) : lakeBlend;
}

function getCoastProximityBlend(worldOptions, surfaceY, spawn, worldX, worldZ) {
  const waterLevel = surfaceY - 1;
  const sampleOffsets = [
    [0, 0, 1],
    [4, 0, 0.88],
    [-4, 0, 0.88],
    [0, 4, 0.88],
    [0, -4, 0.88],
    [8, 0, 0.72],
    [-8, 0, 0.72],
    [0, 8, 0.72],
    [0, -8, 0.72],
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
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [2, 0, 0.96], [-2, 0, 0.96], [0, 2, 0.96], [0, -2, 0.96],
    [2, 2, 0.92], [2, -2, 0.92], [-2, 2, 0.92], [-2, -2, 0.92],
    [3, 0, 0.86], [-3, 0, 0.86], [0, 3, 0.86], [0, -3, 0.86],
    [4, 0, 0.8], [-4, 0, 0.8], [0, 4, 0.8], [0, -4, 0.8],
    [4, 2, 0.74], [4, -2, 0.74], [-4, 2, 0.74], [-4, -2, 0.74],
    [2, 4, 0.74], [2, -4, 0.74], [-2, 4, 0.74], [-2, -4, 0.74],
    [6, 0, 0.62], [-6, 0, 0.62], [0, 6, 0.62], [0, -6, 0.62],
    [6, 3, 0.54], [6, -3, 0.54], [-6, 3, 0.54], [-6, -3, 0.54],
    [3, 6, 0.54], [3, -6, 0.54], [-3, 6, 0.54], [-3, -6, 0.54]
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

    strongestLandBlend = Math.max(strongestLandBlend, weight * landCandidateStrength);
  }

  return strongestLandBlend;
}

function getOceanColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ, baseTopY, terrainMetrics) {
  const forcedOcean = !worldOptions.mixedBiomes && worldOptions.biomeName.includes('ocean');
  const waterLevel = surfaceY - 1;
  const oceanBlend = getOceanBlend(worldOptions, surfaceY, spawn, worldX, worldZ, terrainMetrics, forcedOcean);

  if (!forcedOcean && oceanBlend <= 0.1) {
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
  const shallowOceanDepth = 3 + Math.round(depthNoise * 3) + Math.round(basinNoise * 2);
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
  let floorDepth = Math.max(1, Math.round(lerp(openWaterFloorDepth, enforcedNearshoreDepth, underwaterShelfBlend)));
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
  let shoreBlend = forcedLake ? 1 : smoothstep(clamp((lakeBlend - 0.14) / 0.22, 0, 1));
  let shelfBlend = forcedLake ? 1 : smoothstep(clamp((lakeBlend - 0.3) / 0.16, 0, 1));
  let deepBlend = forcedLake ? 1 : smoothstep(clamp((lakeBlend - 0.54) / 0.12, 0, 1));

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
  const depth = 2 + Math.round(depthNoise * 2) + Math.round((1 - terrainMetrics.ruggedness) * 1);
  const targetFloorY = waterLevel - depth + Math.round(shelfNoise * 0.8);
  const targetShelfY = waterLevel - 1 -
    Math.round(shelfNoise * 0.35) -
    Math.round(Math.max(0, terrainMetrics.ruggedness - 0.28) * 2);
  const targetShoreY = waterLevel + 1 +
    Math.round((1 - shoreBlend) * 5) +
    Math.round(terrainMetrics.ruggedness * 1);
  const shoreCarveBlend = forcedLake ? 1 : clamp(Math.max(shoreBlend, lakeBlend * 0.58), 0, 1);
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
    localRelief,
    terrainMetrics
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

function getRiverSurfaceTargetY(worldOptions, surfaceY, worldX, worldZ, baseTopY, terrainMetrics, climate, riverNetwork, forcedRiverWorld = false) {
  return surfaceY - 1;
}

function getRiverColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ, baseTopY, terrainMetrics, climate, oceanColumn, lakeColumn) {
  const forcedRiverWorld = !worldOptions.mixedBiomes && worldOptions.biomeName.includes('river');
  const waterLevel = surfaceY - 1;
  const spawnBlend = getSpawnMajorWaterBlend(spawn, worldX, worldZ);

  if (oceanColumn.active || lakeColumn.active) {
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
  const valleyFactor = smoothstep(clamp(((-climate.weirdness) + 0.08) / 0.58, 0, 1));
  const moistureFactor = smoothstep(clamp((climate.moisture + 0.06) / 0.72, 0, 1));
  const slopeSuppression = smoothstep(clamp((terrainMetrics.ruggedness - 0.68) / 0.2, 0, 1));
  const elevatedSuppression = smoothstep(clamp((elevationAboveWater - 26) / 26, 0, 1));
  const reliefSuppression = smoothstep(clamp((localRelief - 14) / 12, 0, 1));
  const mountainSuppression = smoothstep(clamp((terrainMetrics.mountainness - 0.56) / 0.2, 0, 1));
  const cliffSuppression = smoothstep(clamp((terrainMetrics.cliffiness - 0.42) / 0.18, 0, 1));
  const corridorStrength = clamp(
    (
      0.14 +
      (terrainMetrics.inlandness * 0.14) +
      (valleyFactor * 0.1) +
      (moistureFactor * 0.08) +
      (riverNetwork.useTrunk ? 0.04 : 0) +
      (riverNetwork.confluenceBlend * 0.08)
    ) *
    (1 - spawnBlend) *
    (1 - (slopeSuppression * 0.46)) *
    (1 - (elevatedSuppression * 0.5)) *
    (1 - (reliefSuppression * 0.34)) *
    (1 - (mountainSuppression * 0.78)) *
    (1 - (cliffSuppression * 0.64)),
    0,
    1
  );
  const bankSide = riverSignal === 0 ? 1 : Math.sign(riverSignal);
  const bendNoise = (
    signedValueNoise2d(worldX, worldZ, worldOptions.seedHash + 1771, 0.0072) +
    (signedValueNoise2d(worldX, worldZ, worldOptions.seedHash + 1793, 0.015) * 0.35)
  ) * bankSide;
  const innerBankFactor = smoothstep(clamp((bendNoise + 1) / 2, 0, 1));
  const outerBankFactor = smoothstep(clamp(((-bendNoise) + 1) / 2, 0, 1));
  const trunkDepthFactor = smoothstep(clamp((riverNetwork.trunkBlend - 0.08) / 0.5, 0, 1));
  const confluenceFactor = smoothstep(clamp((riverNetwork.confluenceBlend - 0.04) / 0.44, 0, 1));
  const edgeNoise = signedValueNoise2d(worldX, worldZ, worldOptions.seedHash + 1867, 0.0115) * 0.02;
  const valleyWidth = riverWidth * (1.95 + (riverNetwork.useTrunk ? 0.32 : 0.08) + (riverNetwork.confluenceBlend * 0.38));
  const bankWidth = riverWidth * (1.48 + (riverNetwork.useTrunk ? 0.24 : 0.06) + (riverNetwork.confluenceBlend * 0.22));
  const channelWidth = riverWidth * (0.5 + (riverNetwork.useTrunk ? 0.1 : 0.03) + (riverNetwork.confluenceBlend * 0.08));
  const valleyBlend = (1 - smoothstep(clamp((riverDistance + edgeNoise) / valleyWidth, 0, 1))) * corridorStrength;
  const riverBlend = valleyBlend;
  const bankBlend = (1 - smoothstep(clamp((riverDistance + (edgeNoise * 0.8)) / bankWidth, 0, 1))) * corridorStrength;
  const waterBlend = (1 - smoothstep(clamp((riverDistance + (edgeNoise * 0.55)) / channelWidth, 0, 1))) * corridorStrength;

  if (
    !forcedRiverWorld &&
    (
      elevationAboveWater > 28 ||
      terrainMetrics.mountainness > 0.62 ||
      terrainMetrics.cliffiness > 0.38 ||
      (localRelief > 11 && elevationAboveWater > 18)
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

  if (riverBlend <= 0.16) {
    return {
      active: false,
      riverBlend,
      bankBlend: 0,
      bankTopBlockStateId: null,
      bankSoilBlockStateId: null,
      bankTopY: null
    };
  }

  const riverSurfaceY = getRiverSurfaceTargetY(
    worldOptions,
    surfaceY,
    worldX,
    worldZ,
    baseTopY,
    terrainMetrics,
    climate,
    riverNetwork,
    forcedRiverWorld
  );
  const depthNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 1667, 0.0115);
  const channelNoise = signedValueNoise2d(worldX, worldZ, worldOptions.seedHash + 1741, 0.024);
  const channelDepth = Math.max(2, Math.min(5, 2 +
    Math.round(depthNoise * 2) +
    Math.round((forcedRiverWorld ? 1 : Math.max(0, terrainMetrics.inlandness - 0.25)) * 2) +
    Math.round(outerBankFactor * 1) +
    Math.round(trunkDepthFactor * 1) +
    Math.round(confluenceFactor * 2)));
  const targetFloorY = Math.max(
    worldOptions.minWorldY + 4,
    Math.min(
      riverSurfaceY - 2,
      (riverSurfaceY - channelDepth) + Math.round(channelNoise * 0.6)
    )
  );
  const channelDistanceFactor = smoothstep(clamp(
    (riverDistance + (edgeNoise * 0.35)) / Math.max(0.001, channelWidth),
    0,
    1
  ));
  const topY = Math.max(
    targetFloorY,
    Math.min(
      riverSurfaceY - 1,
      Math.floor(lerp(targetFloorY, riverSurfaceY - 1, channelDistanceFactor))
    )
  );
  const outerBankRise = Math.max(
    2,
    Math.min(
      5,
      2 +
      Math.round(localRelief * 0.12) +
      Math.round(terrainMetrics.ruggedness * 1.4) +
      Math.round(confluenceFactor * 1)
    )
  );
  const outerBankY = Math.min(baseTopY, riverSurfaceY + outerBankRise);
  const bankDistanceFactor = smoothstep(clamp(
    (riverDistance - channelWidth) / Math.max(0.001, bankWidth - channelWidth),
    0,
    1
  ));
  const sculptedTopY = Math.min(
    baseTopY,
    Math.floor(lerp(riverSurfaceY, outerBankY, bankDistanceFactor))
  );
  const bankCutDepth = baseTopY - sculptedTopY;
  const riverBankSurfaceStates = getRiverBankSurfaceStateIds(
    worldOptions,
    worldX,
    worldZ,
    climate,
    Math.max(0, sculptedTopY - riverSurfaceY),
    localRelief,
    terrainMetrics
  );
  const hasChannel = waterBlend > (forcedRiverWorld ? 0.12 : 0.26) &&
    topY < riverSurfaceY &&
    sculptedTopY >= riverSurfaceY;

  if (!hasChannel) {
    const hasMeaningfulBankCut = bankCutDepth >= 2 &&
      bankBlend > 0.24 &&
      sculptedTopY <= baseTopY - 2;

    return {
      active: false,
      riverBlend,
      bankBlend: hasMeaningfulBankCut ? bankBlend : 0,
      bankTopBlockStateId: hasMeaningfulBankCut ? riverBankSurfaceStates.topBlockStateId : null,
      bankSoilBlockStateId: hasMeaningfulBankCut ? riverBankSurfaceStates.soilBlockStateId : null,
      bankTopY: hasMeaningfulBankCut ? sculptedTopY : null
    };
  }

  const topBlockStateId = getRiverBedMaterialStateId(worldOptions, worldX, worldZ);
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
    waterBottomY: topY + 1,
    waterTopY: riverSurfaceY
  };
}

module.exports = {
  shouldUseBeachBiome,
  shouldUseStonyShoreBiome,
  getStonyShoreSurfaceStateId,
  getSteepBankSurfaceStateId,
  shouldUseStonyBankSurface,
  getOceanBlend,
  getCoastProximityBlend,
  getOceanColumnDescriptor,
  getLakeColumnDescriptor,
  getRiverColumnDescriptor
};
