function cloneNbtLike(value) {
  if (Array.isArray(value)) {
    return value.map(cloneNbtLike);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, childValue]) => [key, cloneNbtLike(childValue)])
    );
  }

  return value;
}

function patchDimensionBounds(dimensionEntryValue, world) {
  if (!dimensionEntryValue?.value) {
    return;
  }

  if (dimensionEntryValue.value.min_y?.type === 'int') {
    dimensionEntryValue.value.min_y.value = world.minWorldY;
  }

  if (dimensionEntryValue.value.height?.type === 'int') {
    dimensionEntryValue.value.height.value = world.maxBuildY - world.minWorldY + 1;
  }

  if (dimensionEntryValue.value.logical_height?.type === 'int') {
    dimensionEntryValue.value.logical_height.value = world.maxBuildY - world.minWorldY + 1;
  }
}

function applyWorldDimensionBounds(registryCodec, world) {
  const clonedRegistryCodec = cloneNbtLike(registryCodec ?? {});
  const dimensionRegistry = clonedRegistryCodec['minecraft:dimension_type'] ??
    clonedRegistryCodec.dimension_type;

  if (!dimensionRegistry?.entries) {
    return clonedRegistryCodec;
  }

  for (const entry of dimensionRegistry.entries) {
    if (entry?.key !== 'minecraft:overworld') {
      continue;
    }

    patchDimensionBounds(entry.value, world);
  }

  return clonedRegistryCodec;
}

module.exports = {
  applyWorldDimensionBounds
};
