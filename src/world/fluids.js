function createFluidHelpers(options) {
  const {
    airBlockStateId,
    waterSourceStateId,
    maxWaterStateId,
    waterFlowMaxLevel,
    waterFlowHorizontalRadius,
    waterFlowVerticalUpRadius,
    waterFlowVerticalDownRadius,
    waterFlowMaxIterations,
    minFlowFloorY,
    maxBuildY,
    normalizePosition,
    clamp,
    getBlockState,
    getBaseBlockState,
    setBlockState,
    isWithinBuildBounds,
    getBlockDefinition
  } = options;

  function isWaterStateId(stateId) {
    return Number.isInteger(stateId) && stateId >= waterSourceStateId && stateId <= maxWaterStateId;
  }

  function getWaterDistanceFromStateId(stateId) {
    if (!isWaterStateId(stateId)) {
      return null;
    }

    const rawLevel = stateId - waterSourceStateId;
    return rawLevel >= 8 ? rawLevel - 8 : rawLevel;
  }

  function getWaterStateId(level = 0, falling = false) {
    return waterSourceStateId + clamp(level, 0, waterFlowMaxLevel) + (falling ? 8 : 0);
  }

  function isEmptyBoundingBoxStateId(stateId) {
    if (stateId === airBlockStateId) {
      return true;
    }

    const blockDefinition = getBlockDefinition(stateId);
    return blockDefinition?.boundingBox === 'empty';
  }

  function canWaterOccupyStateId(stateId) {
    return isWaterStateId(stateId) || isEmptyBoundingBoxStateId(stateId);
  }

  function canWaterRestOnStateId(stateId) {
    return isWaterStateId(stateId) || !isEmptyBoundingBoxStateId(stateId);
  }

  function recomputeWaterAround(position) {
    const normalizedCenter = normalizePosition(position);

    if (!normalizedCenter || !isWithinBuildBounds(normalizedCenter)) {
      return [];
    }

    const minFlowY = clamp(
      normalizedCenter.y - waterFlowVerticalDownRadius,
      minFlowFloorY,
      maxBuildY
    );
    const maxFlowY = clamp(
      normalizedCenter.y + waterFlowVerticalUpRadius,
      minFlowFloorY,
      maxBuildY
    );
    const minFlowX = normalizedCenter.x - waterFlowHorizontalRadius;
    const maxFlowX = normalizedCenter.x + waterFlowHorizontalRadius;
    const minFlowZ = normalizedCenter.z - waterFlowHorizontalRadius;
    const maxFlowZ = normalizedCenter.z + waterFlowHorizontalRadius;
    const currentStates = new Map();
    const sourceKeys = new Set();
    const sampledPositions = [];

    function makeKey(x, y, z) {
      return `${x},${y},${z}`;
    }

    function getStateFromMap(stateMap, x, y, z) {
      return stateMap.get(makeKey(x, y, z)) ?? airBlockStateId;
    }

    for (let y = minFlowY; y <= maxFlowY; y++) {
      for (let z = minFlowZ; z <= maxFlowZ; z++) {
        for (let x = minFlowX; x <= maxFlowX; x++) {
          const sampledPosition = { x, y, z };
          const key = makeKey(x, y, z);

          sampledPositions.push(sampledPosition);
          currentStates.set(key, getBlockState(sampledPosition));

          if (getBaseBlockState(sampledPosition) === waterSourceStateId) {
            sourceKeys.add(key);
          }
        }
      }
    }

    for (let iteration = 0; iteration < waterFlowMaxIterations; iteration++) {
      let changed = false;
      const nextStates = new Map(currentStates);

      for (let y = maxFlowY; y >= minFlowY; y--) {
        for (let z = minFlowZ; z <= maxFlowZ; z++) {
          for (let x = minFlowX; x <= maxFlowX; x++) {
            const key = makeKey(x, y, z);
            const currentStateId = currentStates.get(key) ?? airBlockStateId;

            if (sourceKeys.has(key)) {
              if (currentStateId !== waterSourceStateId) {
                nextStates.set(key, waterSourceStateId);
                changed = true;
              }

              continue;
            }

            if (!canWaterOccupyStateId(currentStateId)) {
              continue;
            }

            let desiredStateId = isWaterStateId(currentStateId) ? airBlockStateId : currentStateId;
            const aboveStateId = y < maxFlowY
              ? getStateFromMap(currentStates, x, y + 1, z)
              : airBlockStateId;

            if (isWaterStateId(aboveStateId)) {
              desiredStateId = getWaterStateId(getWaterDistanceFromStateId(aboveStateId) ?? 0, true);
            } else {
              let minNeighborDistance = Number.POSITIVE_INFINITY;

              for (const [offsetX, offsetZ] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const neighborStateId = getStateFromMap(currentStates, x + offsetX, y, z + offsetZ);

                if (!isWaterStateId(neighborStateId)) {
                  continue;
                }

                const neighborDistance = getWaterDistanceFromStateId(neighborStateId);

                if (neighborDistance !== null) {
                  minNeighborDistance = Math.min(minNeighborDistance, neighborDistance);
                }
              }

              if (Number.isFinite(minNeighborDistance) && minNeighborDistance < waterFlowMaxLevel) {
                const belowStateId = y > minFlowY
                  ? getStateFromMap(currentStates, x, y - 1, z)
                  : airBlockStateId;
                desiredStateId = getWaterStateId(
                  minNeighborDistance + 1,
                  !canWaterRestOnStateId(belowStateId)
                );
              }
            }

            if (desiredStateId !== currentStateId) {
              nextStates.set(key, desiredStateId);
              changed = true;
            }
          }
        }
      }

      currentStates.clear();

      for (const [key, value] of nextStates.entries()) {
        currentStates.set(key, value);
      }

      if (!changed) {
        break;
      }
    }

    const changedPositions = [];

    for (const sampledPosition of sampledPositions) {
      const key = makeKey(sampledPosition.x, sampledPosition.y, sampledPosition.z);
      const currentStateId = getBlockState(sampledPosition);
      const desiredStateId = currentStates.get(key) ?? airBlockStateId;

      if (desiredStateId === currentStateId) {
        continue;
      }

      if (setBlockState(sampledPosition, desiredStateId)) {
        changedPositions.push(normalizePosition(sampledPosition));
      }
    }

    return changedPositions;
  }

  return {
    canWaterOccupyStateId,
    canWaterRestOnStateId,
    getWaterDistanceFromStateId,
    getWaterStateId,
    isEmptyBoundingBoxStateId,
    isWaterStateId,
    recomputeWaterAround
  };
}

module.exports = {
  createFluidHelpers
};
