const HOTBAR_SIZE = 9;
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

function createPlayerInventory(mcData) {
  const hotbar = new Array(HOTBAR_SIZE).fill(null);

  for (let index = 0; index < DEFAULT_HOTBAR_ITEMS.length; index++) {
    const item = DEFAULT_HOTBAR_ITEMS[index];
    hotbar[index] = createInventoryItem(mcData, item.itemName, item.count);
  }

  return {
    hotbar,
    selectedSlot: 0
  };
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

  for (let slot = 0; slot < inventory.hotbar.length && remaining > 0; slot++) {
    const slotItem = inventory.hotbar[slot];

    if (!slotItem || slotItem.itemId !== itemId || slotItem.count >= stackSize) {
      continue;
    }

    const transferred = Math.min(stackSize - slotItem.count, remaining);
    slotItem.count += transferred;
    remaining -= transferred;
    updatedSlots.push(slot);
  }

  for (let slot = 0; slot < inventory.hotbar.length && remaining > 0; slot++) {
    if (inventory.hotbar[slot]) {
      continue;
    }

    const transferred = Math.min(stackSize, remaining);
    inventory.hotbar[slot] = {
      itemId,
      count: transferred
    };
    remaining -= transferred;
    updatedSlots.push(slot);
  }

  return {
    inserted: count - remaining,
    remaining,
    updatedSlots
  };
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

function toProtocolSlot(item) {
  if (!item) {
    return {
      itemCount: 0
    };
  }

  return {
    itemCount: item.count,
    itemId: item.itemId,
    addedComponentCount: 0,
    removedComponentCount: 0,
    components: [],
    removeComponents: []
  };
}

module.exports = {
  HOTBAR_SIZE,
  addItem,
  consumeSelectedItem,
  createPlayerInventory,
  getHotbarItem,
  getSelectedHotbarSlot,
  resolveBlockStateIdForItem,
  setSelectedHotbarSlot,
  toProtocolSlot
};
