const { getChunkKey, normalizePosition, toChunkCoordinates } = require('./runtime-utils');

function collectLightingChunkCoordinates(positions, radius = 1) {
  const chunkCoordinates = [];
  const seen = new Set();

  for (const position of positions ?? []) {
    const normalizedPosition = normalizePosition(position);

    if (!normalizedPosition) {
      continue;
    }

    const { chunkX, chunkZ } = toChunkCoordinates(normalizedPosition);

    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const targetChunkX = chunkX + dx;
        const targetChunkZ = chunkZ + dz;
        const chunkKey = getChunkKey(targetChunkX, targetChunkZ);

        if (seen.has(chunkKey)) {
          continue;
        }

        seen.add(chunkKey);
        chunkCoordinates.push({
          chunkX: targetChunkX,
          chunkZ: targetChunkZ
        });
      }
    }
  }

  return chunkCoordinates;
}

module.exports = {
  collectLightingChunkCoordinates
};
