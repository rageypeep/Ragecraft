const fs = require('node:fs');
const path = require('node:path');

const COOKING_RECIPE_TYPES = {
  'minecraft:blasting': 'minecraft:blast_furnace',
  'minecraft:smelting': 'minecraft:furnace',
  'minecraft:smoking': 'minecraft:smoker'
};

const TAG_FUEL_BURN_TIMES = {
  'minecraft:logs_that_burn': 300,
  'minecraft:planks': 300,
  'minecraft:wooden_buttons': 100,
  'minecraft:wooden_doors': 200,
  'minecraft:wooden_fences': 300,
  'minecraft:wooden_pressure_plates': 300,
  'minecraft:wooden_slabs': 150,
  'minecraft:wooden_stairs': 300,
  'minecraft:wooden_trapdoors': 300
};

const ITEM_FUEL_BURN_TIMES = {
  blaze_rod: 2400,
  bamboo: 50,
  coal: 1600,
  coal_block: 16000,
  charcoal: 1600,
  dried_kelp_block: 4000,
  lava_bucket: 20000,
  stick: 100
};

const ITEM_FUEL_REMAINDERS = {
  lava_bucket: 'bucket'
};

function loadJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findExtractedDataRoot(version) {
  const candidateRoots = [
    path.join(__dirname, '..', 'porting', version, `server-${version}-extract`, 'data', 'minecraft'),
    path.join(__dirname, '..', 'porting', '26.1.2', 'server-26.1.2-extract', 'data', 'minecraft')
  ];

  for (const candidate of candidateRoots) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function createTagResolver(itemsTagRoot, mcData) {
  const rawTags = new Map();
  const resolvedTags = new Map();

  if (itemsTagRoot && fs.existsSync(itemsTagRoot)) {
    for (const fileName of fs.readdirSync(itemsTagRoot)) {
      if (!fileName.endsWith('.json')) {
        continue;
      }

      const relativeName = fileName.replace(/\.json$/u, '');
      rawTags.set(`minecraft:${relativeName}`, loadJsonFile(path.join(itemsTagRoot, fileName)).values ?? []);
    }
  }

  function resolveTag(tagName, visiting = new Set()) {
    if (resolvedTags.has(tagName)) {
      return resolvedTags.get(tagName);
    }

    if (visiting.has(tagName)) {
      return new Set();
    }

    visiting.add(tagName);
    const values = rawTags.get(tagName) ?? [];
    const resolved = new Set();

    for (const value of values) {
      if (typeof value !== 'string') {
        continue;
      }

      if (value.startsWith('#')) {
        const nested = resolveTag(value.slice(1), visiting);

        for (const itemId of nested) {
          resolved.add(itemId);
        }

        continue;
      }

      const itemName = value.replace(/^minecraft:/u, '');
      const itemId = mcData.itemsByName[itemName]?.id;

      if (Number.isInteger(itemId)) {
        resolved.add(itemId);
      }
    }

    visiting.delete(tagName);
    resolvedTags.set(tagName, resolved);
    return resolved;
  }

  return {
    resolveTag
  };
}

function createProcessingRecipeCatalog(mcData, extractedVersion = '26.1.2') {
  const dataRoot = findExtractedDataRoot(extractedVersion);
  const recipeRoot = dataRoot ? path.join(dataRoot, 'recipe') : null;
  const tagRoot = dataRoot ? path.join(dataRoot, 'tags', 'item') : null;
  const tagResolver = createTagResolver(tagRoot, mcData);
  const recipesByContainerType = new Map();
  const fuelByItemId = new Map();

  function expandIngredient(ingredient) {
    const resolved = new Set();

    if (Array.isArray(ingredient)) {
      for (const entry of ingredient) {
        const expanded = expandIngredient(entry);

        for (const itemId of expanded) {
          resolved.add(itemId);
        }
      }

      return resolved;
    }

    if (typeof ingredient !== 'string') {
      return resolved;
    }

    if (ingredient.startsWith('#')) {
      return tagResolver.resolveTag(ingredient.slice(1));
    }

    const itemName = ingredient.replace(/^minecraft:/u, '');
    const itemId = mcData.itemsByName[itemName]?.id;

    if (Number.isInteger(itemId)) {
      resolved.add(itemId);
    }

    return resolved;
  }

  function registerFuelItem(itemId, burnTime, remainderItemId = null) {
    if (!Number.isInteger(itemId) || !Number.isInteger(burnTime) || burnTime <= 0) {
      return;
    }

    fuelByItemId.set(itemId, {
      burnTime,
      remainderItemId: Number.isInteger(remainderItemId) ? remainderItemId : null
    });
  }

  for (const [itemName, burnTime] of Object.entries(ITEM_FUEL_BURN_TIMES)) {
    const itemId = mcData.itemsByName[itemName]?.id;
    const remainderItemId = mcData.itemsByName[ITEM_FUEL_REMAINDERS[itemName] ?? '']?.id ?? null;
    registerFuelItem(itemId, burnTime, remainderItemId);
  }

  for (const [tagName, burnTime] of Object.entries(TAG_FUEL_BURN_TIMES)) {
    for (const itemId of tagResolver.resolveTag(tagName)) {
      registerFuelItem(itemId, burnTime);
    }
  }

  if (recipeRoot && fs.existsSync(recipeRoot)) {
    for (const fileName of fs.readdirSync(recipeRoot)) {
      if (!fileName.endsWith('.json')) {
        continue;
      }

      const recipe = loadJsonFile(path.join(recipeRoot, fileName));
      const containerType = COOKING_RECIPE_TYPES[recipe.type];

      if (!containerType) {
        continue;
      }

      const resultName = recipe.result?.id?.replace(/^minecraft:/u, '');
      const resultItemId = mcData.itemsByName[resultName]?.id;

      if (!Number.isInteger(resultItemId)) {
        continue;
      }

      const ingredientIds = expandIngredient(recipe.ingredient);

      if (ingredientIds.size === 0) {
        continue;
      }

      if (!recipesByContainerType.has(containerType)) {
        recipesByContainerType.set(containerType, new Map());
      }

      const recipesByInput = recipesByContainerType.get(containerType);
      const normalizedRecipe = {
        containerType,
        cookTime: Number.isInteger(recipe.cookingtime) && recipe.cookingtime > 0
          ? recipe.cookingtime
          : 200,
        experience: Number.isFinite(recipe.experience) ? recipe.experience : 0,
        id: fileName.replace(/\.json$/u, ''),
        result: {
          count: Number.isInteger(recipe.result?.count) && recipe.result.count > 0
            ? recipe.result.count
            : 1,
          itemId: resultItemId
        },
        type: recipe.type
      };

      for (const itemId of ingredientIds) {
        if (!recipesByInput.has(itemId)) {
          recipesByInput.set(itemId, normalizedRecipe);
        }
      }
    }
  }

  return {
    findRecipe(containerType, itemId) {
      if (!Number.isInteger(itemId)) {
        return null;
      }

      return recipesByContainerType.get(containerType)?.get(itemId) ?? null;
    },
    getFuel(itemId) {
      return Number.isInteger(itemId) ? fuelByItemId.get(itemId) ?? null : null;
    },
    isFuel(itemId) {
      return Number.isInteger(itemId) && fuelByItemId.has(itemId);
    }
  };
}

module.exports = {
  createProcessingRecipeCatalog
};
