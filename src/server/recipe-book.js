function cloneItem(item) {
  return item
    ? {
        itemId: item.itemId,
        count: item.count
      }
    : null;
}

function getItemStackSize(mcData, itemId) {
  return mcData.items[itemId]?.stackSize ?? 64;
}

function buildRecipeGridPlan(recipe, gridWidth, gridHeight) {
  const gridSize = gridWidth * gridHeight;
  const plan = new Array(gridSize).fill(null);

  if (!recipe) {
    return null;
  }

  if (recipe.type === 'shaped') {
    const recipeHeight = recipe.shape?.length ?? 0;
    const recipeWidth = recipe.shape?.[0]?.length ?? 0;

    if (recipeWidth > gridWidth || recipeHeight > gridHeight) {
      return null;
    }

    for (let row = 0; row < recipeHeight; row++) {
      for (let col = 0; col < recipeWidth; col++) {
        const itemId = recipe.shape[row][col];
        plan[(row * gridWidth) + col] = Number.isInteger(itemId) ? itemId : null;
      }
    }

    return plan;
  }

  const ingredientIds = [];

  for (const ingredient of recipe.ingredients ?? []) {
    for (let count = 0; count < ingredient.count; count++) {
      ingredientIds.push(ingredient.itemId);
    }
  }

  if (ingredientIds.length > gridSize) {
    return null;
  }

  for (let index = 0; index < ingredientIds.length; index++) {
    plan[index] = ingredientIds[index];
  }

  return plan;
}

function countPlannedIngredients(plan) {
  const counts = new Map();

  for (const itemId of plan) {
    if (!Number.isInteger(itemId)) {
      continue;
    }

    counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  }

  return counts;
}

function countAvailableItems(storageSections, grid) {
  const counts = new Map();
  const order = [];

  function recordItem(item) {
    if (!item || !Number.isInteger(item.itemId) || !Number.isInteger(item.count) || item.count <= 0) {
      return;
    }

    if (!counts.has(item.itemId)) {
      order.push(item.itemId);
    }

    counts.set(item.itemId, (counts.get(item.itemId) ?? 0) + item.count);
  }

  for (const section of storageSections) {
    for (const item of section) {
      recordItem(item);
    }
  }

  for (const item of grid) {
    recordItem(item);
  }

  return { counts, order };
}

function listStorageSlots(storageSections) {
  const slots = [];

  for (const section of storageSections) {
    for (let index = 0; index < section.length; index++) {
      slots.push({
        index,
        originalItemId: section[index]?.itemId ?? null,
        section
      });
    }
  }

  return slots;
}

function clearSlots(storageSections, grid) {
  for (const section of storageSections) {
    for (let index = 0; index < section.length; index++) {
      section[index] = null;
    }
  }

  for (let index = 0; index < grid.length; index++) {
    grid[index] = null;
  }
}

function refillStorage(storageSlots, leftoverCounts, itemOrder, mcData) {
  for (const slot of storageSlots) {
    if (!Number.isInteger(slot.originalItemId)) {
      continue;
    }

    const remaining = leftoverCounts.get(slot.originalItemId) ?? 0;

    if (remaining <= 0) {
      continue;
    }

    const transfer = Math.min(remaining, getItemStackSize(mcData, slot.originalItemId));
    slot.section[slot.index] = {
      itemId: slot.originalItemId,
      count: transfer
    };
    leftoverCounts.set(slot.originalItemId, remaining - transfer);
  }

  const orderedLeftovers = Array.from(new Set([
    ...itemOrder,
    ...leftoverCounts.keys()
  ])).filter((itemId) => (leftoverCounts.get(itemId) ?? 0) > 0);

  let nextItemIndex = 0;

  for (const slot of storageSlots) {
    if (slot.section[slot.index]) {
      continue;
    }

    while (
      nextItemIndex < orderedLeftovers.length &&
      (leftoverCounts.get(orderedLeftovers[nextItemIndex]) ?? 0) <= 0
    ) {
      nextItemIndex += 1;
    }

    if (nextItemIndex >= orderedLeftovers.length) {
      break;
    }

    const itemId = orderedLeftovers[nextItemIndex];
    const remaining = leftoverCounts.get(itemId) ?? 0;
    const transfer = Math.min(remaining, getItemStackSize(mcData, itemId));

    slot.section[slot.index] = {
      itemId,
      count: transfer
    };
    leftoverCounts.set(itemId, remaining - transfer);
  }
}

function applyRecipeBookSelection({
  grid,
  gridHeight,
  gridWidth,
  makeAll,
  mcData,
  recipe,
  storageSections
}) {
  if (!Array.isArray(grid) || !Array.isArray(storageSections) || !recipe) {
    return {
      applied: false,
      craftCount: 0
    };
  }

  const plan = buildRecipeGridPlan(recipe, gridWidth, gridHeight);

  if (!plan) {
    return {
      applied: false,
      craftCount: 0
    };
  }

  const requiredPerCraft = countPlannedIngredients(plan);

  if (requiredPerCraft.size === 0) {
    return {
      applied: false,
      craftCount: 0
    };
  }

  const { counts: availableCounts, order: itemOrder } = countAvailableItems(storageSections, grid);
  let maxCraftCount = Number.MAX_SAFE_INTEGER;

  for (const [itemId, requiredCount] of requiredPerCraft.entries()) {
    const availableCount = availableCounts.get(itemId) ?? 0;

    if (availableCount < requiredCount) {
      return {
        applied: false,
        craftCount: 0
      };
    }

    maxCraftCount = Math.min(maxCraftCount, Math.floor(availableCount / requiredCount));
  }

  for (const itemId of plan) {
    if (!Number.isInteger(itemId)) {
      continue;
    }

    maxCraftCount = Math.min(maxCraftCount, getItemStackSize(mcData, itemId));
  }

  const craftCount = makeAll ? maxCraftCount : 1;

  if (!Number.isInteger(craftCount) || craftCount <= 0) {
    return {
      applied: false,
      craftCount: 0
    };
  }

  const leftoverCounts = new Map(availableCounts);

  for (const [itemId, requiredCount] of requiredPerCraft.entries()) {
    leftoverCounts.set(itemId, (leftoverCounts.get(itemId) ?? 0) - (requiredCount * craftCount));
  }

  const storageSlots = listStorageSlots(storageSections);
  clearSlots(storageSections, grid);

  for (let slot = 0; slot < plan.length; slot++) {
    const itemId = plan[slot];

    if (!Number.isInteger(itemId)) {
      continue;
    }

    grid[slot] = {
      itemId,
      count: craftCount
    };
  }

  refillStorage(storageSlots, leftoverCounts, itemOrder, mcData);

  const hasRemainder = Array.from(leftoverCounts.values()).some((count) => count > 0);

  if (hasRemainder) {
    return {
      applied: false,
      craftCount: 0
    };
  }

  return {
    applied: true,
    craftCount
  };
}

module.exports = {
  applyRecipeBookSelection
};
