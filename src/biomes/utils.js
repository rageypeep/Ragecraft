function isBiomeSurfaceState(worldOptions, topStateId, options = {}) {
  const {
    allowMud = false,
    allowPodzol = true,
    allowRootedDirt = true,
    allowSnow = false
  } = options;
  const allowedStateIds = [
    worldOptions.surfaceBlockStateId,
    worldOptions.soilBlockStateId
  ];

  if (allowMud) {
    allowedStateIds.push(worldOptions.terrainBlockStateIds.mud);
  }

  if (allowPodzol) {
    allowedStateIds.push(worldOptions.terrainBlockStateIds.podzol);
  }

  if (allowRootedDirt) {
    allowedStateIds.push(worldOptions.terrainBlockStateIds.rootedDirt);
  }

  if (allowSnow) {
    allowedStateIds.push(
      worldOptions.terrainBlockStateIds.snow,
      worldOptions.terrainBlockStateIds.snowBlock
    );
  }

  return allowedStateIds.includes(topStateId);
}

module.exports = {
  isBiomeSurfaceState
};
