const {
  clamp,
  smoothstep,
  signedValueNoise2d,
  valueNoise2d
} = require('./noise');
const { getSpawnMajorWaterBlend, getTerrainRelief } = require('./terrain');
const { LANDFORM_TYPES } = require('./landforms');

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

function getRiverBankSurfaceStateIds(worldOptions, worldX, worldZ, climate, elevationAboveWater, localRelief, terrainMetrics) {
  const ruggedness = terrainMetrics?.ruggedness ?? 0;
  const cliffiness = terrainMetrics?.cliffiness ?? 0;
  const useRockyBank =
    (localRelief >= 12 || elevationAboveWater >= 10) &&
    (ruggedness >= 0.7 || cliffiness >= 0.42);

  if (useRockyBank) {
    const steepNoise = valueNoise2d(worldX, worldZ, worldOptions.seedHash + 2161, 0.026);
    const steepStateId = steepNoise > 0.86
      ? worldOptions.terrainBlockStateIds.gravel
      : steepNoise > 0.64
        ? worldOptions.terrainBlockStateIds.andesite
        : worldOptions.terrainBlockStateIds.stone;
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

function getRiverSurfaceTargetY(surfaceY, baseTopY, landformType, riverNetwork, localRelief) {
  const waterLevel = surfaceY - 1;
  const trunkShelfBias = riverNetwork.useTrunk ? 1 : 0;

  if (landformType === LANDFORM_TYPES.COASTAL_LOWLANDS) {
    return waterLevel;
  }

  if (landformType === LANDFORM_TYPES.INTERIOR_LOWLANDS) {
    return Math.min(baseTopY - 1, waterLevel + 1);
  }

  if (landformType === LANDFORM_TYPES.ROLLING_UPLANDS) {
    return Math.min(baseTopY - 2, waterLevel + 2 + Math.round(localRelief * 0.08));
  }

  if (landformType === LANDFORM_TYPES.FOOTHILLS) {
    return Math.min(baseTopY - 3, waterLevel + 3 + Math.round(localRelief * 0.12) + trunkShelfBias);
  }

  return waterLevel;
}

function getRiverCorridorStrength(terrainMetrics, climate, riverNetwork, spawnBlend, elevationAboveWater, localRelief, landformType) {
  const valleyFactor = smoothstep(clamp(((-climate.weirdness) + 0.08) / 0.58, 0, 1));
  const moistureFactor = smoothstep(clamp((climate.moisture + 0.06) / 0.72, 0, 1));
  const slopeSuppression = smoothstep(clamp((terrainMetrics.ruggedness - 0.68) / 0.2, 0, 1));
  const elevatedSuppression = smoothstep(clamp((elevationAboveWater - 26) / 26, 0, 1));
  const reliefSuppression = smoothstep(clamp((localRelief - 14) / 12, 0, 1));
  const mountainSuppression = smoothstep(clamp((terrainMetrics.mountainness - 0.56) / 0.2, 0, 1));
  const cliffSuppression = smoothstep(clamp((terrainMetrics.cliffiness - 0.42) / 0.18, 0, 1));
  const landformAllowance = (
    landformType === LANDFORM_TYPES.COASTAL_LOWLANDS ? 1 :
      landformType === LANDFORM_TYPES.INTERIOR_LOWLANDS ? 0.96 :
        landformType === LANDFORM_TYPES.ROLLING_UPLANDS ? 0.82 :
          landformType === LANDFORM_TYPES.FOOTHILLS ? 0.62 : 0.18
  );

  return clamp(
    (
      0.16 +
      (terrainMetrics.inlandness * 0.14) +
      (valleyFactor * 0.1) +
      (moistureFactor * 0.08) +
      (riverNetwork.useTrunk ? 0.05 : 0.02) +
      (riverNetwork.confluenceBlend * 0.08)
    ) *
    landformAllowance *
    (1 - spawnBlend) *
    (1 - (slopeSuppression * 0.46)) *
    (1 - (elevatedSuppression * 0.5)) *
    (1 - (reliefSuppression * 0.34)) *
    (1 - (mountainSuppression * 0.78)) *
    (1 - (cliffSuppression * 0.64)),
    0,
    1
  );
}

function getRiverColumnDescriptor(worldOptions, surfaceY, spawn, worldX, worldZ, baseTopY, terrainMetrics, climate, oceanColumn, lakeColumn, landformType) {
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
  const corridorStrength = getRiverCorridorStrength(
    terrainMetrics,
    climate,
    riverNetwork,
    spawnBlend,
    elevationAboveWater,
    localRelief,
    landformType
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
  const valleyWidth = riverWidth * (2.2 + (riverNetwork.useTrunk ? 0.38 : 0.12) + (riverNetwork.confluenceBlend * 0.42));
  const bankWidth = riverWidth * (1.62 + (riverNetwork.useTrunk ? 0.28 : 0.08) + (riverNetwork.confluenceBlend * 0.26));
  const channelWidth = riverWidth * (0.52 + (riverNetwork.useTrunk ? 0.12 : 0.03) + (riverNetwork.confluenceBlend * 0.1));
  const valleyBlend = (1 - smoothstep(clamp((riverDistance + edgeNoise) / valleyWidth, 0, 1))) * corridorStrength;
  const riverBlend = valleyBlend;
  const bankBlend = (1 - smoothstep(clamp((riverDistance + (edgeNoise * 0.8)) / bankWidth, 0, 1))) * corridorStrength;
  const waterBlend = (1 - smoothstep(clamp((riverDistance + (edgeNoise * 0.55)) / channelWidth, 0, 1))) * corridorStrength;

  if (
    !forcedRiverWorld &&
    (
      landformType === LANDFORM_TYPES.MOUNTAIN_CORE ||
      landformType === LANDFORM_TYPES.ALPINE_SHELF ||
      elevationAboveWater > 40 ||
      terrainMetrics.cliffiness > 0.46
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

  const riverSurfaceY = getRiverSurfaceTargetY(surfaceY, baseTopY, landformType, riverNetwork, localRelief);
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
      Math.floor(((targetFloorY * (1 - channelDistanceFactor)) + ((riverSurfaceY - 1) * channelDistanceFactor)))
    )
  );
  const outerBankRise = Math.max(
    2,
    Math.min(
      5,
      2 +
      Math.round(localRelief * 0.12) +
      Math.round(terrainMetrics.ruggedness * 1.2) +
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
    Math.floor(((riverSurfaceY * (1 - bankDistanceFactor)) + (outerBankY * bankDistanceFactor)))
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
  const hasChannel = waterBlend > (forcedRiverWorld ? 0.12 : 0.24) &&
    topY < riverSurfaceY &&
    sculptedTopY >= riverSurfaceY;

  if (!hasChannel) {
    const hasMeaningfulBankCut = bankCutDepth >= 2 &&
      bankBlend > 0.22 &&
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
  getRiverColumnDescriptor
};
