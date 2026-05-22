const {
  cloneInventoryState,
  diffWindowSlots,
  getHotbarWindowSlot,
  getWindowItems,
  getWindowSlotItem,
  incrementInventoryState,
  isHotbarWindowSlot,
  PLAYER_INVENTORY_WINDOW_ID,
  PLAYER_WINDOW_SLOT_COUNT,
  setWindowSlotItem,
  toProtocolSlot
} = require('../inventory');
const {
  applyCraftResultClick: applySharedCraftResultClick,
  applyOutsideClick: applySharedOutsideClick,
  applyStandardSlotClick: applySharedStandardSlotClick
} = require('./inventory-clicks');

const OUTSIDE_WINDOW_SLOT = -999;
const PLAYER_CRAFT_INPUT_SLOTS = [1, 2, 3, 4];

function getCraftInputWindowSlot(gridIndex) {
  return Number.isInteger(gridIndex) && gridIndex >= 0 && gridIndex < PLAYER_CRAFT_INPUT_SLOTS.length
    ? PLAYER_CRAFT_INPUT_SLOTS[gridIndex]
    : null;
}

function sendFullInventoryState(client, writePlayPacket, translateItemId = null) {
  if (!client?.inventoryState) {
    return;
  }

  writePlayPacket(client, 'window_items', {
    windowId: PLAYER_INVENTORY_WINDOW_ID,
    stateId: client.inventoryState.stateId ?? 0,
    items: getWindowItems(client.inventoryState).map((item) => toProtocolSlot(item, translateItemId)),
    carriedItem: toProtocolSlot(client.inventoryState.cursor, translateItemId)
  });
}

function sendInventoryWindowSlot(client, writePlayPacket, slot, translateItemId = null) {
  if (!client?.inventoryState || !Number.isInteger(slot)) {
    return;
  }

  writePlayPacket(client, 'set_slot', {
    windowId: PLAYER_INVENTORY_WINDOW_ID,
    stateId: client.inventoryState.stateId ?? 0,
    slot,
    item: toProtocolSlot(getWindowSlotItem(client.inventoryState, slot), translateItemId)
  });
}

function recomputeCraftingResult(inventory, crafting) {
  if (!inventory) {
    return null;
  }

  const match = crafting?.findMatchingGridRecipe(inventory.craftInput, 2, 2) ?? null;
  inventory.craftResult = match
    ? {
        itemId: match.recipe.result.itemId,
        count: match.recipe.result.count
      }
    : null;

  return match;
}

function decrementCraftingInputs(inventory, matchedSlots) {
  for (const gridIndex of matchedSlots) {
    const slot = getCraftInputWindowSlot(gridIndex);

    if (slot === null) {
      continue;
    }

    const item = getWindowSlotItem(inventory, slot);

    if (!item) {
      continue;
    }

    if (item.count <= 1) {
      setWindowSlotItem(inventory, slot, null);
      continue;
    }

    setWindowSlotItem(inventory, slot, {
      itemId: item.itemId,
      count: item.count - 1
    });
  }
}

function applyCraftResultClick(inventory, mcData, crafting, mouseButton) {
  return applySharedCraftResultClick({
    decrementMatchedInputs(matchedSlots) {
      decrementCraftingInputs(inventory, matchedSlots);
    },
    getCursorItem() {
      return inventory.cursor;
    },
    getResultItem() {
      return inventory.craftResult;
    },
    mcData,
    recomputeCraftingResult() {
      return recomputeCraftingResult(inventory, crafting);
    },
    setCursorItem(item) {
      inventory.cursor = item;
    }
  });
}

function applyStandardSlotClick(inventory, mcData, slot, mouseButton) {
  return applySharedStandardSlotClick({
    getCursorItem() {
      return inventory.cursor;
    },
    getSlotItem(currentSlot) {
      return getWindowSlotItem(inventory, currentSlot);
    },
    mcData,
    mouseButton,
    setCursorItem(item) {
      inventory.cursor = item;
    },
    setSlotItem(currentSlot, item) {
      setWindowSlotItem(inventory, currentSlot, item);
    },
    slot
  });
}

function applyOutsideClick(inventory, mouseButton) {
  return applySharedOutsideClick({
    getCursorItem() {
      return inventory.cursor;
    },
    mouseButton,
    setCursorItem(item) {
      inventory.cursor = item;
    }
  });
}

function createPlayerInventoryApi({ crafting, mcData, translateItemId = null, writePlayPacket }) {
  function sendInventoryBootstrap(client) {
    recomputeCraftingResult(client.inventoryState, crafting);
    sendFullInventoryState(client, writePlayPacket, translateItemId);
  }

  function sendHotbarSlotUpdate(client, hotbarSlot) {
    if (!client?.inventoryState || !Number.isInteger(hotbarSlot)) {
      return;
    }

    writePlayPacket(client, 'set_player_inventory', {
      slotId: hotbarSlot,
      contents: toProtocolSlot(client.inventoryState.hotbar[hotbarSlot] ?? null, translateItemId)
    });
  }

  function commitInventoryChange(client) {
    if (!client?.inventoryState) {
      return;
    }

    incrementInventoryState(client.inventoryState);
    sendFullInventoryState(client, writePlayPacket, translateItemId);
  }

  function syncHotbarWindowChanges(client, changedSlots) {
    for (const slot of changedSlots) {
      if (!isHotbarWindowSlot(slot)) {
        continue;
      }

      sendHotbarSlotUpdate(client, slot - getHotbarWindowSlot(0));
    }
  }

  function handleWindowClick(client, packet) {
    if (!client?.inventoryState || packet?.windowId !== PLAYER_INVENTORY_WINDOW_ID) {
      return false;
    }

    const previousInventory = cloneInventoryState(client.inventoryState);
    let changed = false;

    if (packet.mode === 0) {
      if (packet.slot === OUTSIDE_WINDOW_SLOT) {
        changed = applyOutsideClick(client.inventoryState, packet.mouseButton);
      } else if (packet.slot === 0) {
        changed = applyCraftResultClick(client.inventoryState, mcData, crafting, packet.mouseButton);
      } else if (packet.slot >= 1 && packet.slot < PLAYER_WINDOW_SLOT_COUNT) {
        changed = applyStandardSlotClick(client.inventoryState, mcData, packet.slot, packet.mouseButton);

        if (changed && PLAYER_CRAFT_INPUT_SLOTS.includes(packet.slot)) {
          recomputeCraftingResult(client.inventoryState, crafting);
        }
      }
    }

    if (!changed) {
      sendFullInventoryState(client, writePlayPacket, translateItemId);
      return false;
    }

    incrementInventoryState(client.inventoryState);
    const changedSlots = diffWindowSlots(previousInventory, client.inventoryState);
    syncHotbarWindowChanges(client, changedSlots);
    sendFullInventoryState(client, writePlayPacket, translateItemId);
    return true;
  }

  return {
    commitInventoryChange,
    handleWindowClick,
    recomputeCraftingResult(inventory) {
      return recomputeCraftingResult(inventory, crafting);
    },
    sendFullInventoryState(client) {
      sendFullInventoryState(client, writePlayPacket, translateItemId);
    },
    sendHotbarSlotUpdate,
    sendInventoryBootstrap
  };
}

module.exports = {
  createPlayerInventoryApi
};
