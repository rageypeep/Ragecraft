function normalizeBlockPosition(position) {
  if (!position) {
    return null;
  }

  return {
    x: Math.floor(position.x),
    y: Math.floor(position.y),
    z: Math.floor(position.z)
  };
}

function shouldBreakBlock(packet) {
  return packet?.status === 0 || packet?.status === 2;
}

function extractSelectedSlot(packet) {
  if (!packet || typeof packet !== 'object') {
    return null;
  }

  if (Number.isInteger(packet.slotId)) {
    return packet.slotId;
  }

  if (Number.isInteger(packet.slot)) {
    return packet.slot;
  }

  return null;
}

function buildBlockChangePacket(world, position) {
  const location = normalizeBlockPosition(position);

  if (!location) {
    return null;
  }

  return {
    location,
    type: world.getBlockState(location)
  };
}

module.exports = {
  buildBlockChangePacket,
  extractSelectedSlot,
  normalizeBlockPosition,
  shouldBreakBlock
};
