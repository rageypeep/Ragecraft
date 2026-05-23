const fs = require('node:fs');
const path = require('node:path');

function normalizeInventoryItems(items, expectedLength = null) {
  const normalized = Array.isArray(items)
    ? items.map((item) => (
        item &&
        Number.isInteger(item.itemId) &&
        Number.isInteger(item.count) &&
        item.count > 0
          ? {
              itemId: item.itemId,
              count: item.count
            }
          : null
      ))
    : [];

  if (!Number.isInteger(expectedLength) || expectedLength < 0) {
    return normalized;
  }

  return Array.from({ length: expectedLength }, (_, index) => normalized[index] ?? null);
}

function normalizeContainerPositions(positions) {
  return Array.isArray(positions)
    ? positions
        .filter((position) =>
          position &&
          Number.isInteger(position.x) &&
          Number.isInteger(position.y) &&
          Number.isInteger(position.z)
        )
        .map((position) => ({
          x: position.x,
          y: position.y,
          z: position.z
        }))
    : [];
}

function normalizeContainerData(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeContainerData(entry));
  }

  if (value && typeof value === 'object') {
    const normalized = {};

    for (const [key, entry] of Object.entries(value)) {
      const normalizedEntry = normalizeContainerData(entry);

      if (normalizedEntry !== undefined) {
        normalized[key] = normalizedEntry;
      }
    }

    return normalized;
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    Number.isFinite(value)
  ) {
    return value;
  }

  return undefined;
}

function normalizeContainers(rawContainers) {
  if (!Array.isArray(rawContainers)) {
    return [];
  }

  return rawContainers
    .filter((container) => container && typeof container === 'object' && typeof container.type === 'string')
    .map((container) => ({
      type: container.type,
      positions: normalizeContainerPositions(container.positions),
      items: normalizeInventoryItems(container.items),
      data: normalizeContainerData(container.data) ?? {}
    }))
    .filter((container) => container.positions.length > 0);
}

function normalizeWorldState(rawWorldState) {
  if (!rawWorldState || typeof rawWorldState !== 'object') {
    return { blocks: [], containers: [], players: {} };
  }

  const normalizedPlayers = {};
  const rawPlayers = rawWorldState.players && typeof rawWorldState.players === 'object'
    ? rawWorldState.players
    : {};

  for (const [username, playerState] of Object.entries(rawPlayers)) {
    if (!username || !playerState || typeof playerState !== 'object') {
      continue;
    }

    const position = playerState.position;
    const hasValidPosition = position &&
      Number.isFinite(position.x) &&
      Number.isFinite(position.y) &&
      Number.isFinite(position.z);

    normalizedPlayers[username] = {
      position: hasValidPosition
        ? {
            x: position.x,
            y: position.y,
            z: position.z,
            yaw: Number.isFinite(position.yaw) ? position.yaw : 0,
            pitch: Number.isFinite(position.pitch) ? position.pitch : 0
          }
        : null,
      inventory: playerState.inventory && typeof playerState.inventory === 'object'
        ? {
            craftInput: normalizeInventoryItems(playerState.inventory.craftInput, 4),
            armor: normalizeInventoryItems(playerState.inventory.armor, 4),
            main: normalizeInventoryItems(playerState.inventory.main, 27),
            hotbar: normalizeInventoryItems(playerState.inventory.hotbar, 9),
            offhand: normalizeInventoryItems([playerState.inventory.offhand], 1)[0],
            selectedSlot: Number.isInteger(playerState.inventory.selectedSlot)
              ? playerState.inventory.selectedSlot
              : 0
          }
        : null
    };
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
      : [],
    containers: normalizeContainers(rawWorldState.containers),
    players: normalizedPlayers
  };
}

function loadWorldState(worldSavePath) {
  if (!worldSavePath || !fs.existsSync(worldSavePath)) {
    return { blocks: [], containers: [], players: {} };
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
