const nbt = require('prismarine-nbt');
const { addItem, incrementInventoryState, toProtocolSlot } = require('../inventory');
const {
  applyCraftResultClick,
  applyOutsideClick,
  applyStandardSlotClick
} = require('./inventory-clicks');

const OUTSIDE_WINDOW_SLOT = -999;
const CRAFTING_TABLE_INPUT_SIZE = 9;
const CRAFTING_TABLE_MENU_TYPE_ID = 12;
const CRAFTING_TABLE_WINDOW_SLOT_COUNT = 46;
const CRAFTING_TABLE_TITLE = nbt.comp({ text: nbt.string('Crafting') });

function createCraftingTableContainer(windowId, blockPosition) {
  return {
    blockPosition,
    craftInput: new Array(CRAFTING_TABLE_INPUT_SIZE).fill(null),
    craftResult: null,
    stateId: 0,
    type: 'minecraft:crafting_table',
    windowId
  };
}

function getCraftingGridWindowSlot(gridIndex) {
  return Number.isInteger(gridIndex) && gridIndex >= 0 && gridIndex < CRAFTING_TABLE_INPUT_SIZE
    ? gridIndex + 1
    : null;
}

function getCraftingTableWindowSlotItem(client, slot) {
  const container = client?.activeContainer;
  const inventory = client?.inventoryState;

  if (!container || !inventory || !Number.isInteger(slot)) {
    return null;
  }

  if (slot === 0) {
    return container.craftResult ?? null;
  }

  if (slot >= 1 && slot <= 9) {
    return container.craftInput[slot - 1] ?? null;
  }

  if (slot >= 10 && slot <= 36) {
    return inventory.main[slot - 10] ?? null;
  }

  if (slot >= 37 && slot <= 45) {
    return inventory.hotbar[slot - 37] ?? null;
  }

  return null;
}

function setCraftingTableWindowSlotItem(client, slot, item) {
  const container = client?.activeContainer;
  const inventory = client?.inventoryState;

  if (!container || !inventory || !Number.isInteger(slot)) {
    return false;
  }

  if (slot === 0) {
    container.craftResult = item;
    return true;
  }

  if (slot >= 1 && slot <= 9) {
    container.craftInput[slot - 1] = item;
    return true;
  }

  if (slot >= 10 && slot <= 36) {
    inventory.main[slot - 10] = item;
    return true;
  }

  if (slot >= 37 && slot <= 45) {
    inventory.hotbar[slot - 37] = item;
    return true;
  }

  return false;
}

function getCraftingTableWindowItems(client) {
  const items = [];

  for (let slot = 0; slot < CRAFTING_TABLE_WINDOW_SLOT_COUNT; slot++) {
    items.push(getCraftingTableWindowSlotItem(client, slot));
  }

  return items;
}

function createCraftingTableApi({
  crafting,
  mcData,
  onOverflowItem,
  translateItemId = null,
  writePlayPacket
}) {
  function allocateWindowId(client) {
    const nextWindowId = client.nextWindowId ?? 1;
    client.nextWindowId = nextWindowId >= 100 ? 1 : nextWindowId + 1;
    return nextWindowId;
  }

  function recomputeCraftingTableResult(client) {
    const container = client?.activeContainer;

    if (!container) {
      return null;
    }

    const match = crafting?.findMatchingGridRecipe(container.craftInput, 3, 3) ?? null;
    container.craftResult = match
      ? {
          itemId: match.recipe.result.itemId,
          count: match.recipe.result.count
        }
      : null;
    return match;
  }

  function sendCraftingTableState(client) {
    const container = client?.activeContainer;

    if (!container || container.type !== 'minecraft:crafting_table') {
      return false;
    }

    writePlayPacket(client, 'window_items', {
      windowId: container.windowId,
      stateId: container.stateId ?? 0,
      items: getCraftingTableWindowItems(client).map((item) => toProtocolSlot(item, translateItemId)),
      carriedItem: toProtocolSlot(client.inventoryState?.cursor ?? null, translateItemId)
    });
    return true;
  }

  function decrementCraftingInputs(client, matchedSlots) {
    for (const gridIndex of matchedSlots) {
      const slot = getCraftingGridWindowSlot(gridIndex);

      if (slot === null) {
        continue;
      }

      const item = getCraftingTableWindowSlotItem(client, slot);

      if (!item) {
        continue;
      }

      if (item.count <= 1) {
        setCraftingTableWindowSlotItem(client, slot, null);
        continue;
      }

      setCraftingTableWindowSlotItem(client, slot, {
        itemId: item.itemId,
        count: item.count - 1
      });
    }
  }

  function openCraftingTable(client, blockPosition) {
    if (!client?.inventoryState) {
      return false;
    }

    if (client.activeContainer) {
      closeActiveWindow(client, { sendPacket: true });
    }

    client.activeContainer = createCraftingTableContainer(allocateWindowId(client), blockPosition);
    recomputeCraftingTableResult(client);
    writePlayPacket(client, 'open_window', {
      windowId: client.activeContainer.windowId,
      inventoryType: CRAFTING_TABLE_MENU_TYPE_ID,
      windowTitle: CRAFTING_TABLE_TITLE
    });
    sendCraftingTableState(client);
    return true;
  }

  function closeActiveWindow(client, { sendPacket = false } = {}) {
    const container = client?.activeContainer;

    if (!container) {
      return false;
    }

    for (const item of container.craftInput) {
      if (!item) {
        continue;
      }

      const insertion = addItem(client.inventoryState, mcData, item.itemId, item.count);

      if (insertion.remaining > 0) {
        onOverflowItem?.(client, {
          itemId: item.itemId,
          count: insertion.remaining
        });
      }
    }

    if (sendPacket) {
      writePlayPacket(client, 'close_window', {
        windowId: container.windowId
      });
    }

    client.activeContainer = null;
    return true;
  }

  function commitVisibleInventoryChange(client) {
    const container = client?.activeContainer;

    if (!container) {
      return false;
    }

    incrementInventoryState(container);
    sendCraftingTableState(client);
    return true;
  }

  function handleWindowClick(client, packet) {
    const container = client?.activeContainer;

    if (!client?.inventoryState || !container || packet?.windowId !== container.windowId) {
      return false;
    }

    let changed = false;

    if (packet.mode === 0) {
      if (packet.slot === OUTSIDE_WINDOW_SLOT) {
        changed = applyOutsideClick({
          getCursorItem() {
            return client.inventoryState.cursor;
          },
          mouseButton: packet.mouseButton,
          setCursorItem(item) {
            client.inventoryState.cursor = item;
          }
        });
      } else if (packet.slot === 0) {
        changed = applyCraftResultClick({
          decrementMatchedInputs(matchedSlots) {
            decrementCraftingInputs(client, matchedSlots);
          },
          getCursorItem() {
            return client.inventoryState.cursor;
          },
          getResultItem() {
            return client.activeContainer?.craftResult ?? null;
          },
          mcData,
          recomputeCraftingResult() {
            return recomputeCraftingTableResult(client);
          },
          setCursorItem(item) {
            client.inventoryState.cursor = item;
          }
        });
      } else if (packet.slot >= 1 && packet.slot < CRAFTING_TABLE_WINDOW_SLOT_COUNT) {
        changed = applyStandardSlotClick({
          getCursorItem() {
            return client.inventoryState.cursor;
          },
          getSlotItem(slot) {
            return getCraftingTableWindowSlotItem(client, slot);
          },
          mcData,
          mouseButton: packet.mouseButton,
          setCursorItem(item) {
            client.inventoryState.cursor = item;
          },
          setSlotItem(slot, item) {
            setCraftingTableWindowSlotItem(client, slot, item);
          },
          slot: packet.slot
        });

        if (changed && packet.slot >= 1 && packet.slot <= 9) {
          recomputeCraftingTableResult(client);
        }
      }
    }

    if (!changed) {
      sendCraftingTableState(client);
      return false;
    }

    incrementInventoryState(container);
    sendCraftingTableState(client);
    return true;
  }

  return {
    closeActiveWindow,
    commitVisibleInventoryChange,
    handleWindowClick,
    openCraftingTable,
    recomputeCraftingTableResult,
    sendCraftingTableState
  };
}

module.exports = {
  createCraftingTableApi
};
