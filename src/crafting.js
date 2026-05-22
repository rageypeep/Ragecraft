const path = require('node:path');
const {
  addItem,
  cloneInventoryState,
  countItem,
  diffWindowSlots,
  removeItem
} = require('./inventory');

function loadRecipesData(minecraftVersion) {
  const minecraftDataRoot = path.dirname(require.resolve('minecraft-data'));
  const recipesPath = path.join(
    minecraftDataRoot,
    'minecraft-data',
    'data',
    'pc',
    minecraftVersion,
    'recipes.json'
  );

  return require(recipesPath);
}

function normalizeRecipeIngredients(entry) {
  const ingredientCounts = new Map();
  const sourceValues = entry.inShape
    ? entry.inShape.flat().filter((value) => Number.isInteger(value))
    : (entry.ingredients ?? []).filter((value) => Number.isInteger(value));

  for (const itemId of sourceValues) {
    ingredientCounts.set(itemId, (ingredientCounts.get(itemId) ?? 0) + 1);
  }

  return Array.from(ingredientCounts.entries()).map(([itemId, count]) => ({
    itemId,
    count
  }));
}

function trimGrid(grid) {
  let minRow = grid.length;
  let maxRow = -1;
  let minCol = grid[0]?.length ?? 0;
  let maxCol = -1;

  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      if (!Number.isInteger(grid[row][col])) {
        continue;
      }

      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
      minCol = Math.min(minCol, col);
      maxCol = Math.max(maxCol, col);
    }
  }

  if (maxRow === -1) {
    return {
      height: 0,
      width: 0,
      cells: [],
      originalSlots: []
    };
  }

  const cells = [];
  const originalSlots = [];

  for (let row = minRow; row <= maxRow; row++) {
    const trimmedRow = [];
    const slotRow = [];

    for (let col = minCol; col <= maxCol; col++) {
      trimmedRow.push(grid[row][col] ?? null);
      slotRow.push((row * grid[row].length) + col);
    }

    cells.push(trimmedRow);
    originalSlots.push(slotRow);
  }

  return {
    height: cells.length,
    width: cells[0]?.length ?? 0,
    cells,
    originalSlots
  };
}

function createRecipeCatalog(mcData) {
  const recipesData = loadRecipesData(mcData.version.minecraftVersion);
  const recipes = [];
  const recipesByResultId = new Map();
  const recipesByResultName = new Map();

  for (const [resultIdText, entries] of Object.entries(recipesData)) {
    const resultItemId = Number.parseInt(resultIdText, 10);
    const resultItem = mcData.items[resultItemId];

    if (!resultItem || !Array.isArray(entries)) {
      continue;
    }

    entries.forEach((entry, index) => {
      const recipeType = entry.inShape
        ? 'shaped'
        : entry.ingredients
          ? 'shapeless'
          : null;

      if (!recipeType || !entry.result || entry.result.count <= 0) {
        return;
      }

      const normalizedIngredients = normalizeRecipeIngredients(entry);

      if (normalizedIngredients.length === 0) {
        return;
      }

      const normalizedShape = entry.inShape
        ? trimGrid(entry.inShape.map((row) => row.map((value) => Number.isInteger(value) ? value : null)))
        : null;

      const normalizedRecipe = {
        id: `${resultItem.name}:${index}`,
        type: recipeType,
        width: entry.inShape ? Math.max(...entry.inShape.map((row) => row.length)) : null,
        height: entry.inShape ? entry.inShape.length : null,
        shape: normalizedShape?.cells ?? null,
        ingredients: normalizedIngredients.map((ingredient) => ({
          ...ingredient,
          name: mcData.items[ingredient.itemId]?.name ?? `item_${ingredient.itemId}`
        })),
        result: {
          itemId: entry.result.id,
          count: entry.result.count,
          name: mcData.items[entry.result.id]?.name ?? resultItem.name
        }
      };

      recipes.push(normalizedRecipe);

      if (!recipesByResultId.has(normalizedRecipe.result.itemId)) {
        recipesByResultId.set(normalizedRecipe.result.itemId, []);
      }

      recipesByResultId.get(normalizedRecipe.result.itemId).push(normalizedRecipe);

      if (!recipesByResultName.has(normalizedRecipe.result.name)) {
        recipesByResultName.set(normalizedRecipe.result.name, []);
      }

      recipesByResultName.get(normalizedRecipe.result.name).push(normalizedRecipe);
    });
  }

  return {
    getRecipeCount() {
      return recipes.length;
    },
    getRecipesForItemName(itemName) {
      return recipesByResultName.get(itemName) ?? [];
    },
    getRecipesForItemId(itemId) {
      return recipesByResultId.get(itemId) ?? [];
    },
    findMatchingGridRecipe(gridItems, gridWidth = 2, gridHeight = 2) {
      const grid = [];

      for (let row = 0; row < gridHeight; row++) {
        const rowItems = [];

        for (let col = 0; col < gridWidth; col++) {
          const item = gridItems[(row * gridWidth) + col];
          rowItems.push(Number.isInteger(item?.itemId) ? item.itemId : null);
        }

        grid.push(rowItems);
      }

      const normalizedGrid = trimGrid(grid);

      if (normalizedGrid.width === 0 || normalizedGrid.height === 0) {
        return null;
      }

      const occupiedCounts = new Map();

      for (const row of normalizedGrid.cells) {
        for (const itemId of row) {
          if (!Number.isInteger(itemId)) {
            continue;
          }

          occupiedCounts.set(itemId, (occupiedCounts.get(itemId) ?? 0) + 1);
        }
      }

      for (const recipe of recipes) {
        if (recipe.type === 'shaped') {
          if (!recipe.shape || recipe.shape.length !== normalizedGrid.height || recipe.shape[0].length !== normalizedGrid.width) {
            continue;
          }

          let matches = true;
          const matchedSlots = [];

          for (let row = 0; row < normalizedGrid.height && matches; row++) {
            for (let col = 0; col < normalizedGrid.width; col++) {
              if (recipe.shape[row][col] !== normalizedGrid.cells[row][col]) {
                matches = false;
                break;
              }

              if (Number.isInteger(recipe.shape[row][col])) {
                matchedSlots.push(normalizedGrid.originalSlots[row][col]);
              }
            }
          }

          if (matches) {
            return {
              recipe,
              matchedSlots
            };
          }

          continue;
        }

        if (recipe.ingredients.length !== Array.from(occupiedCounts.values()).reduce((total, count) => total + count, 0)) {
          continue;
        }

        const recipeCounts = new Map(recipe.ingredients.map((ingredient) => [ingredient.itemId, ingredient.count]));
        let matches = recipeCounts.size === occupiedCounts.size;

        for (const [itemId, count] of occupiedCounts.entries()) {
          if (recipeCounts.get(itemId) !== count) {
            matches = false;
            break;
          }
        }

        if (!matches) {
          continue;
        }

        return {
          recipe,
          matchedSlots: normalizedGrid.originalSlots.flat()
        };
      }

      return null;
    },
    listRecipeSummaries(itemName) {
      return this.getRecipesForItemName(itemName).map((recipe) => (
        `${recipe.result.count}x ${recipe.result.name} <= ${recipe.ingredients.map((ingredient) => `${ingredient.count}x ${ingredient.name}`).join(', ')}`
      ));
    },
    craftItem(inventory, itemName, times = 1) {
      if (!inventory || typeof itemName !== 'string') {
        return null;
      }

      const recipesForItem = this.getRecipesForItemName(itemName);

      if (recipesForItem.length === 0) {
        return null;
      }

      const requestedTimes = Math.max(1, Math.floor(times));
      let chosenRecipe = null;
      let workingInventory = null;
      let craftExecutions = 0;

      for (const recipe of recipesForItem) {
        const inventoryClone = cloneInventoryState(inventory);
        let crafted = 0;

        for (let iteration = 0; iteration < requestedTimes; iteration++) {
          const hasAllIngredients = recipe.ingredients.every((ingredient) => (
            countItem(inventoryClone, ingredient.itemId) >= ingredient.count
          ));

          if (!hasAllIngredients) {
            break;
          }

          let removedAllIngredients = true;

          for (const ingredient of recipe.ingredients) {
            const removal = removeItem(inventoryClone, ingredient.itemId, ingredient.count);

            if (removal.remaining > 0) {
              removedAllIngredients = false;
              break;
            }
          }

          if (!removedAllIngredients) {
            break;
          }

          const insertion = addItem(
            inventoryClone,
            mcData,
            recipe.result.itemId,
            recipe.result.count
          );

          if (insertion.remaining > 0) {
            break;
          }

          crafted += 1;
        }

        if (crafted > 0) {
          chosenRecipe = recipe;
          workingInventory = inventoryClone;
          craftExecutions = crafted;
          break;
        }
      }

      if (!chosenRecipe || !workingInventory || craftExecutions <= 0) {
        return null;
      }

      const changedSlots = diffWindowSlots(inventory, workingInventory);
      inventory.craftResult = workingInventory.craftResult;
      inventory.craftInput = workingInventory.craftInput;
      inventory.armor = workingInventory.armor;
      inventory.main = workingInventory.main;
      inventory.hotbar = workingInventory.hotbar;
      inventory.offhand = workingInventory.offhand;
      inventory.cursor = workingInventory.cursor;
      inventory.selectedSlot = workingInventory.selectedSlot;

      return {
        recipe: chosenRecipe,
        changedSlots,
        craftedExecutions: craftExecutions,
        outputCount: craftExecutions * chosenRecipe.result.count
      };
    }
  };
}

module.exports = {
  createRecipeCatalog
};
