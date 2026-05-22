const HOTBAR_SIZE = 9;
const MAIN_INVENTORY_SIZE = 27;
const CRAFTING_INPUT_SIZE = 4;
const ARMOR_SIZE = 4;
const PLAYER_INVENTORY_WINDOW_ID = 0;
const PLAYER_WINDOW_SLOT_COUNT = 46;
const HOTBAR_WINDOW_START = 36;
const OFFHAND_WINDOW_SLOT = 45;
const DEFAULT_HOTBAR_ITEMS = [
  { itemName: 'grass_block', count: 64 },
  { itemName: 'dirt', count: 64 },
  { itemName: 'stone', count: 64 },
  { itemName: 'oak_log', count: 32 }
];

function createInventoryItem(mcData, itemName, count) {
  const item = mcData.itemsByName[itemName];

  if (!item) {
    throw new Error(`Unknown inventory bootstrap item "${itemName}".`);
  }

  return {
    itemId: item.id,
    count
  };
}

function normalizeInventoryItem(mcData, item) {
  if (
    !item ||
    !Number.isInteger(item.itemId) ||
    !Number.isInteger(item.count) ||
    item.count <= 0 ||
    !mcData.items[item.itemId]
  ) {
    return null;
  }

  const stackSize = mcData.items[item.itemId]?.stackSize ?? 64;

  return {
    itemId: item.itemId,
    count: Math.min(item.count, stackSize)
  };
}

function buildDefaultPlayerInventory(mcData) {
  const hotbar = new Array(HOTBAR_SIZE).fill(null);

  for (let index = 0; index < DEFAULT_HOTBAR_ITEMS.length; index++) {
    const item = DEFAULT_HOTBAR_ITEMS[index];
    hotbar[index] = createInventoryItem(mcData, item.itemName, item.count);
  }

  return {
    craftResult: null,
    craftInput: new Array(CRAFTING_INPUT_SIZE).fill(null),
    armor: new Array(ARMOR_SIZE).fill(null),
    main: new Array(MAIN_INVENTORY_SIZE).fill(null),
    hotbar,
    offhand: null,
    cursor: null,
    selectedSlot: 0
  };
}

function normalizeInventoryState(mcData, inventoryState) {
  if (!inventoryState || typeof inventoryState !== 'object') {
    return null;
  }

  const normalizedCraftInput = new Array(CRAFTING_INPUT_SIZE).fill(null);
  const normalizedArmor = new Array(ARMOR_SIZE).fill(null);
  const normalizedMain = new Array(MAIN_INVENTORY_SIZE).fill(null);
  const normalizedHotbar = new Array(HOTBAR_SIZE).fill(null);
  const rawCraftInput = Array.isArray(inventoryState.craftInput) ? inventoryState.craftInput : [];
  const rawArmor = Array.isArray(inventoryState.armor) ? inventoryState.armor : [];
  const rawMain = Array.isArray(inventoryState.main) ? inventoryState.main : [];
  const rawHotbar = Array.isArray(inventoryState.hotbar) ? inventoryState.hotbar : [];

  for (let index = 0; index < CRAFTING_INPUT_SIZE; index++) {
    normalizedCraftInput[index] = normalizeInventoryItem(mcData, rawCraftInput[index]);
  }

  for (let index = 0; index < ARMOR_SIZE; index++) {
    normalizedArmor[index] = normalizeInventoryItem(mcData, rawArmor[index]);
  }

  for (let index = 0; index < MAIN_INVENTORY_SIZE; index++) {
    normalizedMain[index] = normalizeInventoryItem(mcData, rawMain[index]);
  }

  for (let index = 0; index < HOTBAR_SIZE; index++) {
    normalizedHotbar[index] = normalizeInventoryItem(mcData, rawHotbar[index]);
  }

  return {
    craftResult: null,
    craftInput: normalizedCraftInput,
    armor: normalizedArmor,
    main: normalizedMain,
    hotbar: normalizedHotbar,
    offhand: normalizeInventoryItem(mcData, inventoryState.offhand),
    cursor: normalizeInventoryItem(mcData, inventoryState.cursor),
    selectedSlot: Number.isInteger(inventoryState.selectedSlot) &&
      inventoryState.selectedSlot >= 0 &&
      inventoryState.selectedSlot < HOTBAR_SIZE
      ? inventoryState.selectedSlot
      : 0,
    stateId: Number.isInteger(inventoryState.stateId) ? inventoryState.stateId : 0
  };
}

function createPlayerInventory(mcData, savedInventoryState = null) {
  return normalizeInventoryState(mcData, savedInventoryState) ?? buildDefaultPlayerInventory(mcData);
}

function cloneInventoryState(inventory) {
  if (!inventory) {
    return null;
  }

  return {
    craftResult: inventory.craftResult
      ? {
          itemId: inventory.craftResult.itemId,
          count: inventory.craftResult.count
        }
      : null,
    craftInput: inventory.craftInput.map((item) => (
      item
        ? {
            itemId: item.itemId,
            count: item.count
          }
        : null
    )),
    armor: inventory.armor.map((item) => (
      item
        ? {
            itemId: item.itemId,
            count: item.count
          }
        : null
    )),
    main: inventory.main.map((item) => (
      item
        ? {
            itemId: item.itemId,
            count: item.count
          }
        : null
    )),
    hotbar: inventory.hotbar.map((item) => (
      item
        ? {
            itemId: item.itemId,
            count: item.count
          }
        : null
    )),
    offhand: inventory.offhand
      ? {
          itemId: inventory.offhand.itemId,
          count: inventory.offhand.count
        }
      : null,
    cursor: inventory.cursor
      ? {
          itemId: inventory.cursor.itemId,
          count: inventory.cursor.count
        }
      : null,
    selectedSlot: inventory.selectedSlot ?? 0,
    stateId: inventory.stateId ?? 0
  };
}

function listStorageSections(inventory) {
  return [inventory.main, inventory.hotbar];
}

function listStorageSlots(inventory) {
  const slots = [];

  for (const section of listStorageSections(inventory)) {
    for (let index = 0; index < section.length; index++) {
      slots.push({
        section,
        index,
        item: section[index]
      });
    }
  }

  return slots;
}

function getSelectedHotbarSlot(inventory) {
  return inventory?.selectedSlot ?? 0;
}

function setSelectedHotbarSlot(inventory, slot) {
  if (!inventory || !Number.isInteger(slot) || slot < 0 || slot >= HOTBAR_SIZE) {
    return false;
  }

  inventory.selectedSlot = slot;
  return true;
}

function getHotbarItem(inventory, slot = getSelectedHotbarSlot(inventory)) {
  if (!inventory || slot < 0 || slot >= HOTBAR_SIZE) {
    return null;
  }

  return inventory.hotbar[slot] ?? null;
}

function consumeSelectedItem(inventory, amount = 1) {
  const slot = getSelectedHotbarSlot(inventory);
  const item = getHotbarItem(inventory, slot);

  if (!item || item.count < amount) {
    return null;
  }

  item.count -= amount;

  if (item.count <= 0) {
    inventory.hotbar[slot] = null;
  }

  return {
    slot,
    item: inventory.hotbar[slot]
  };
}

function addItem(inventory, mcData, itemId, count = 1) {
  if (!inventory || !mcData || !Number.isInteger(itemId) || count <= 0) {
    return {
      inserted: 0,
      remaining: count,
      updatedSlots: []
    };
  }

  const itemDefinition = mcData.items[itemId];
  const stackSize = itemDefinition?.stackSize ?? 64;
  let remaining = count;
  const updatedSlots = [];

  for (const slotInfo of listStorageSlots(inventory)) {
    if (remaining <= 0) {
      break;
    }

    const slotItem = slotInfo.item;

    if (!slotItem || slotItem.itemId !== itemId || slotItem.count >= stackSize) {
      continue;
    }

    const transferred = Math.min(stackSize - slotItem.count, remaining);
    slotItem.count += transferred;
    remaining -= transferred;
    updatedSlots.push(slotInfo);
  }

  for (const slotInfo of listStorageSlots(inventory)) {
    if (remaining <= 0) {
      break;
    }

    if (slotInfo.section[slotInfo.index]) {
      continue;
    }

    const transferred = Math.min(stackSize, remaining);
    slotInfo.section[slotInfo.index] = {
      itemId,
      count: transferred
    };
    remaining -= transferred;
    updatedSlots.push({
      ...slotInfo,
      item: slotInfo.section[slotInfo.index]
    });
  }

  return {
    inserted: count - remaining,
    remaining,
    updatedSlots
  };
}

function countItem(inventory, itemId) {
  if (!inventory || !Number.isInteger(itemId)) {
    return 0;
  }

  return listStorageSections(inventory).reduce((sectionTotal, section) => (
    sectionTotal + section.reduce((total, item) => (
      item?.itemId === itemId ? total + item.count : total
    ), 0)
  ), 0);
}

function removeItem(inventory, itemId, count = 1) {
  if (!inventory || !Number.isInteger(itemId) || count <= 0) {
    return {
      removed: 0,
      remaining: count,
      updatedSlots: []
    };
  }

  let remaining = count;
  const updatedSlots = [];

  for (const slotInfo of listStorageSlots(inventory)) {
    if (remaining <= 0) {
      break;
    }

    const slotItem = slotInfo.section[slotInfo.index];

    if (!slotItem || slotItem.itemId !== itemId) {
      continue;
    }

    const removed = Math.min(slotItem.count, remaining);
    slotItem.count -= removed;
    remaining -= removed;
    updatedSlots.push(slotInfo);

    if (slotItem.count <= 0) {
      slotInfo.section[slotInfo.index] = null;
    }
  }

  return {
    removed: count - remaining,
    remaining,
    updatedSlots
  };
}

function diffHotbarSlots(previousInventory, nextInventory) {
  const changedSlots = [];

  if (!previousInventory || !nextInventory) {
    return changedSlots;
  }

  for (let slot = 0; slot < HOTBAR_SIZE; slot++) {
    const previousItem = previousInventory.hotbar[slot];
    const nextItem = nextInventory.hotbar[slot];

    if (
      previousItem?.itemId !== nextItem?.itemId ||
      previousItem?.count !== nextItem?.count
    ) {
      changedSlots.push(slot);
    }
  }

  return changedSlots;
}

function diffWindowSlots(previousInventory, nextInventory) {
  const changedSlots = [];

  if (!previousInventory || !nextInventory) {
    return changedSlots;
  }

  for (let slot = 0; slot < PLAYER_WINDOW_SLOT_COUNT; slot++) {
    const previousItem = getWindowSlotItem(previousInventory, slot);
    const nextItem = getWindowSlotItem(nextInventory, slot);

    if (
      previousItem?.itemId !== nextItem?.itemId ||
      previousItem?.count !== nextItem?.count
    ) {
      changedSlots.push(slot);
    }
  }

  if (
    previousInventory.cursor?.itemId !== nextInventory.cursor?.itemId ||
    previousInventory.cursor?.count !== nextInventory.cursor?.count
  ) {
    changedSlots.push(-1);
  }

  return changedSlots;
}

function incrementInventoryState(inventory) {
  if (!inventory) {
    return 0;
  }

  inventory.stateId = (inventory.stateId ?? 0) + 1;
  return inventory.stateId;
}

function isHotbarWindowSlot(slot) {
  return Number.isInteger(slot) && slot >= HOTBAR_WINDOW_START && slot < HOTBAR_WINDOW_START + HOTBAR_SIZE;
}

function getHotbarWindowSlot(slot) {
  return HOTBAR_WINDOW_START + slot;
}

function getWindowSlotItem(inventory, slot) {
  if (!inventory || !Number.isInteger(slot)) {
    return null;
  }

  if (slot === 0) {
    return inventory.craftResult ?? null;
  }

  if (slot >= 1 && slot <= 4) {
    return inventory.craftInput[slot - 1] ?? null;
  }

  if (slot >= 5 && slot <= 8) {
    return inventory.armor[slot - 5] ?? null;
  }

  if (slot >= 9 && slot <= 35) {
    return inventory.main[slot - 9] ?? null;
  }

  if (slot >= HOTBAR_WINDOW_START && slot <= 44) {
    return inventory.hotbar[slot - HOTBAR_WINDOW_START] ?? null;
  }

  if (slot === OFFHAND_WINDOW_SLOT) {
    return inventory.offhand ?? null;
  }

  return null;
}

function setWindowSlotItem(inventory, slot, item) {
  if (!inventory || !Number.isInteger(slot)) {
    return false;
  }

  if (slot === 0) {
    inventory.craftResult = item;
    return true;
  }

  if (slot >= 1 && slot <= 4) {
    inventory.craftInput[slot - 1] = item;
    return true;
  }

  if (slot >= 5 && slot <= 8) {
    inventory.armor[slot - 5] = item;
    return true;
  }

  if (slot >= 9 && slot <= 35) {
    inventory.main[slot - 9] = item;
    return true;
  }

  if (slot >= HOTBAR_WINDOW_START && slot <= 44) {
    inventory.hotbar[slot - HOTBAR_WINDOW_START] = item;
    return true;
  }

  if (slot === OFFHAND_WINDOW_SLOT) {
    inventory.offhand = item;
    return true;
  }

  return false;
}

function getWindowItems(inventory) {
  const items = [];

  for (let slot = 0; slot < PLAYER_WINDOW_SLOT_COUNT; slot++) {
    items.push(getWindowSlotItem(inventory, slot));
  }

  return items;
}

function resolveBlockStateIdForItem(mcData, item) {
  if (!item) {
    return null;
  }

  const itemDefinition = mcData.items[item.itemId];

  if (!itemDefinition) {
    return null;
  }

  const blockDefinition = mcData.blocksByName[itemDefinition.name];
  return blockDefinition?.defaultState ?? null;
}

function toProtocolSlot(item, translateItemId = null) {
  if (!item) {
    return {
      itemCount: 0
    };
  }

  const resolvedItemId = typeof translateItemId === 'function'
    ? translateItemId(item.itemId)
    : item.itemId;

  return {
    itemCount: item.count,
    itemId: resolvedItemId,
    addedComponentCount: 0,
    removedComponentCount: 0,
    components: [],
    removeComponents: []
  };
}

module.exports = {
  ARMOR_SIZE,
  CRAFTING_INPUT_SIZE,
  HOTBAR_SIZE,
  HOTBAR_WINDOW_START,
  MAIN_INVENTORY_SIZE,
  OFFHAND_WINDOW_SLOT,
  PLAYER_INVENTORY_WINDOW_ID,
  PLAYER_WINDOW_SLOT_COUNT,
  addItem,
  cloneInventoryState,
  consumeSelectedItem,
  countItem,
  createPlayerInventory,
  diffHotbarSlots,
  diffWindowSlots,
  getHotbarItem,
  getHotbarWindowSlot,
  getSelectedHotbarSlot,
  getWindowItems,
  getWindowSlotItem,
  incrementInventoryState,
  isHotbarWindowSlot,
  normalizeInventoryState,
  removeItem,
  resolveBlockStateIdForItem,
  setSelectedHotbarSlot,
  setWindowSlotItem,
  toProtocolSlot
};
