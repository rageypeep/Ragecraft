const CHEST_FACING_VALUES = ['north', 'south', 'west', 'east'];
const CHEST_TYPE_VALUES = ['single', 'left', 'right'];
const CHEST_WATERLOGGED_VALUES = [true, false];
const CARDINAL_OFFSETS = {
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  west: { x: -1, y: 0, z: 0 },
  east: { x: 1, y: 0, z: 0 }
};
const LEFT_OF_FACING = {
  north: 'west',
  south: 'east',
  west: 'south',
  east: 'north'
};
const RIGHT_OF_FACING = {
  north: 'east',
  south: 'west',
  west: 'north',
  east: 'south'
};

function positionsEqual(left, right) {
  return left?.x === right?.x && left?.y === right?.y && left?.z === right?.z;
}

function offsetPosition(position, direction) {
  const offset = CARDINAL_OFFSETS[direction];

  if (!position || !offset) {
    return null;
  }

  return {
    x: position.x + offset.x,
    y: position.y + offset.y,
    z: position.z + offset.z
  };
}

function createChestStateHelpers(mcData) {
  const chestBlock = mcData.blocksByName.chest;
  const chestMinStateId = chestBlock?.minStateId ?? null;
  const chestMaxStateId = chestBlock?.maxStateId ?? null;

  function isChestStateId(stateId) {
    return Number.isInteger(stateId) &&
      chestMinStateId !== null &&
      chestMaxStateId !== null &&
      stateId >= chestMinStateId &&
      stateId <= chestMaxStateId;
  }

  function parseChestState(stateId) {
    if (!isChestStateId(stateId)) {
      return null;
    }

    const offset = stateId - chestMinStateId;
    const facingIndex = Math.floor(offset / 6);
    const remainder = offset % 6;
    const typeIndex = Math.floor(remainder / 2);
    const waterloggedIndex = remainder % 2;

    return {
      facing: CHEST_FACING_VALUES[facingIndex] ?? 'north',
      type: CHEST_TYPE_VALUES[typeIndex] ?? 'single',
      waterlogged: CHEST_WATERLOGGED_VALUES[waterloggedIndex] ?? false
    };
  }

  function resolveChestStateId({ facing = 'north', type = 'single', waterlogged = false } = {}) {
    if (chestMinStateId === null) {
      return null;
    }

    const facingIndex = Math.max(0, CHEST_FACING_VALUES.indexOf(facing));
    const typeIndex = Math.max(0, CHEST_TYPE_VALUES.indexOf(type));
    const waterloggedIndex = waterlogged ? 0 : 1;

    return chestMinStateId + (facingIndex * 6) + (typeIndex * 2) + waterloggedIndex;
  }

  function getLeftDirection(facing) {
    return LEFT_OF_FACING[facing] ?? 'west';
  }

  function getRightDirection(facing) {
    return RIGHT_OF_FACING[facing] ?? 'east';
  }

  function getDoubleChestSides(facing, firstPosition, secondPosition) {
    const leftPosition = offsetPosition(firstPosition, getLeftDirection(facing));
    const rightPosition = offsetPosition(firstPosition, getRightDirection(facing));

    if (positionsEqual(secondPosition, rightPosition)) {
      return {
        leftPosition: firstPosition,
        rightPosition: secondPosition
      };
    }

    if (positionsEqual(secondPosition, leftPosition)) {
      return {
        leftPosition: secondPosition,
        rightPosition: firstPosition
      };
    }

    return null;
  }

  return {
    getDoubleChestSides,
    getLeftDirection,
    getRightDirection,
    isChestStateId,
    offsetPosition,
    parseChestState,
    positionsEqual,
    resolveChestStateId
  };
}

module.exports = {
  createChestStateHelpers
};
