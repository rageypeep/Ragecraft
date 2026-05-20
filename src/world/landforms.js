const LANDFORM_TYPES = {
  ALPINE_SHELF: 'alpine_shelf',
  COASTAL_LOWLANDS: 'coastal_lowlands',
  FOOTHILLS: 'foothills',
  INTERIOR_LOWLANDS: 'interior_lowlands',
  MOUNTAIN_CORE: 'mountain_core',
  ROLLING_UPLANDS: 'rolling_uplands'
};

function getLandformType(terrainMetrics, elevationAboveWater, localRelief = Number.POSITIVE_INFINITY) {
  if (!terrainMetrics) {
    return LANDFORM_TYPES.INTERIOR_LOWLANDS;
  }

  const inlandness = terrainMetrics.inlandness ?? 0;
  const foothillness = terrainMetrics.foothillness ?? 0;
  const mountainness = terrainMetrics.mountainness ?? 0;
  const cliffiness = terrainMetrics.cliffiness ?? 0;
  const ruggedness = terrainMetrics.ruggedness ?? 0;

  if (
    elevationAboveWater >= 20 &&
    localRelief <= 14 &&
    mountainness >= 0.42 &&
    cliffiness < 0.28 &&
    ruggedness < 0.66
  ) {
    return LANDFORM_TYPES.ALPINE_SHELF;
  }

  if (
    mountainness >= 0.58 &&
    (
      ruggedness >= 0.42 ||
      cliffiness >= 0.24 ||
      elevationAboveWater >= 34
    )
  ) {
    return LANDFORM_TYPES.MOUNTAIN_CORE;
  }

  if (
    inlandness < 0.18 &&
    elevationAboveWater <= 18 &&
    localRelief <= 16
  ) {
    return LANDFORM_TYPES.COASTAL_LOWLANDS;
  }

  if (
    foothillness >= 0.34 &&
    inlandness >= 0.16 &&
    elevationAboveWater >= 10 &&
    localRelief >= 3 &&
    localRelief <= 26 &&
    cliffiness <= 0.28 &&
    mountainness >= 0.12
  ) {
    return LANDFORM_TYPES.FOOTHILLS;
  }

  if (
    elevationAboveWater >= 10 &&
    inlandness >= 0.22 &&
    localRelief >= 4
  ) {
    return LANDFORM_TYPES.ROLLING_UPLANDS;
  }

  return LANDFORM_TYPES.INTERIOR_LOWLANDS;
}

function remapBiomeKeyForLandform(biomeKey, landformType, climate = null) {
  if (
    landformType !== LANDFORM_TYPES.COASTAL_LOWLANDS &&
    landformType !== LANDFORM_TYPES.INTERIOR_LOWLANDS
  ) {
    return biomeKey;
  }

  if (
    biomeKey !== 'windswept_hills' &&
    biomeKey !== 'windswept_forest' &&
    biomeKey !== 'stony_peaks' &&
    biomeKey !== 'jagged_peaks' &&
    biomeKey !== 'meadow'
  ) {
    return biomeKey;
  }

  const effectiveTemperature = climate?.effectiveTemperature ?? climate?.temperature ?? 0;
  const moisture = climate?.moisture ?? 0;
  const freezeChance = climate?.freezeChance ?? 0;

  if (freezeChance > 0.48 || effectiveTemperature < -0.42) {
    return 'snowy_plains';
  }

  if (effectiveTemperature > 0.52 && moisture < -0.16) {
    return 'savanna';
  }

  if (moisture > 0.08) {
    return 'forest';
  }

  return 'plains';
}

module.exports = {
  LANDFORM_TYPES,
  getLandformType,
  remapBiomeKeyForLandform
};
