const Chunk = require('prismarine-chunk')('1.21.11');

function getDefaultChunkDimensions() {
  const probeChunk = new Chunk();

  return {
    maxWorldY: probeChunk.minY + probeChunk.worldHeight - 1,
    minWorldY: probeChunk.minY,
    worldHeight: probeChunk.worldHeight
  };
}

function createChunk(worldOptions = null) {
  if (!worldOptions) {
    return new Chunk();
  }

  return new Chunk({
    minY: worldOptions.minWorldY,
    worldHeight: worldOptions.worldHeight
  });
}

function createChunkFromJson(chunkJson) {
  return Chunk.fromJson(chunkJson);
}

module.exports = {
  createChunk,
  createChunkFromJson,
  getDefaultChunkDimensions
};
