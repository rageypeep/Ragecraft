const fs = require('node:fs');
const path = require('node:path');

function normalizeWorldState(rawWorldState) {
  if (!rawWorldState || typeof rawWorldState !== 'object') {
    return { blocks: [] };
  }

  return {
    blocks: Array.isArray(rawWorldState.blocks)
      ? rawWorldState.blocks
          .filter((block) =>
            block &&
            Number.isInteger(block.x) &&
            Number.isInteger(block.y) &&
            Number.isInteger(block.z) &&
            Number.isInteger(block.stateId)
          )
          .map((block) => ({
            x: block.x,
            y: block.y,
            z: block.z,
            stateId: block.stateId
          }))
      : []
  };
}

function loadWorldState(worldSavePath) {
  if (!worldSavePath || !fs.existsSync(worldSavePath)) {
    return { blocks: [] };
  }

  const rawContents = fs.readFileSync(worldSavePath, 'utf8');
  return normalizeWorldState(JSON.parse(rawContents));
}

function saveWorldState(worldSavePath, worldState) {
  if (!worldSavePath) {
    return;
  }

  const normalizedWorldState = normalizeWorldState(worldState);
  fs.mkdirSync(path.dirname(worldSavePath), { recursive: true });
  fs.writeFileSync(worldSavePath, `${JSON.stringify(normalizedWorldState, null, 2)}\n`);
}

module.exports = {
  loadWorldState,
  saveWorldState
};
