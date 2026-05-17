const Vec3 = require('vec3');

function normalizePosition(position) {
  if (!position) {
    return null;
  }

  return {
    x: Math.floor(position.x),
    y: Math.floor(position.y),
    z: Math.floor(position.z)
  };
}

function getChunkKey(chunkX, chunkZ) {
  return `${chunkX},${chunkZ}`;
}

function getBlockKey(position) {
  const normalizedPosition = normalizePosition(position);
  return `${normalizedPosition.x},${normalizedPosition.y},${normalizedPosition.z}`;
}

function toChunkCoordinates(position) {
  const { x, y, z } = normalizePosition(position);
  const chunkX = Math.floor(x / 16);
  const chunkZ = Math.floor(z / 16);

  return {
    chunkX,
    chunkZ,
    localPosition: new Vec3(x - (chunkX * 16), y, z - (chunkZ * 16)),
    worldPosition: { x, y, z }
  };
}

module.exports = {
  getBlockKey,
  getChunkKey,
  normalizePosition,
  toChunkCoordinates
};
