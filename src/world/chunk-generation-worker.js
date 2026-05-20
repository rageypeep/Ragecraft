const { parentPort } = require('worker_threads');
const mcData = require('minecraft-data')('1.21.11');
const { createGeneratedChunk } = require('./generation');

parentPort.on('message', (message) => {
  const {
    jobId,
    chunkX,
    chunkZ,
    spawnReference,
    surfaceY,
    worldConfig
  } = message;

  try {
    const chunk = createGeneratedChunk(worldConfig, surfaceY, spawnReference, chunkX, chunkZ);

    parentPort.postMessage({
      chunkJson: chunk.toJson(),
      chunkX,
      chunkZ,
      jobId
    });
  } catch (error) {
    parentPort.postMessage({
      error: error instanceof Error ? error.message : String(error),
      jobId
    });
  }
});
