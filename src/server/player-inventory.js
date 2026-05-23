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
  applyCraftResultQuickMove,
  applyDragClick,
  applyOutsideClick: applySharedOutsideClick,
  applyQuickMoveClick,
  applyStandardSlotClick: applySharedStandardSlotClick
} = require('./inventory-clicks');
const { applyRecipeBookSelection } = require('./recipe-book');

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

function getPlayerQuickMoveTargets(slot) {
  if (slot === 0 || (slot >= 1 && slot <= 8) || slot === 45) {
    return Array.from({ length: 36 }, (_, index) => index + 9);
  }

  if (slot >= 9 && slot <= 35) {
    return Array.from({ length: 9 }, (_, index) => index + 36);
  }

  if (slot >= 36 && slot <= 44) {
    return Array.from({ length: 27 }, (_, index) => index + 9);
  }

  return [];
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

  function applyRecipeSelection(client, recipe, makeAll = false) {
    if (!client?.inventoryState || !recipe) {
      return false;
    }

    const nextInventory = cloneInventoryState(client.inventoryState);
    const applied = applyRecipeBookSelection({
      grid: nextInventory.craftInput,
      gridHeight: 2,
      gridWidth: 2,
      makeAll,
      mcData,
      recipe,
      storageSections: [nextInventory.main, nextInventory.hotbar]
    });

    if (!applied.applied) {
      return false;
    }

    client.inventoryState.craftInput = nextInventory.craftInput;
    client.inventoryState.main = nextInventory.main;
    client.inventoryState.hotbar = nextInventory.hotbar;
    recomputeCraftingResult(client.inventoryState, crafting);
    incrementInventoryState(client.inventoryState);
    sendFullInventoryState(client, writePlayPacket, translateItemId);
    return true;
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
    let handled = false;

    if (packet.mode === 0) {
      handled = true;
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
    } else if (packet.mode === 1 && packet.slot >= 0 && packet.slot < PLAYER_WINDOW_SLOT_COUNT) {
      handled = true;

      if (packet.slot === 0) {
        const result = applyCraftResultQuickMove({
          decrementMatchedInputs(matchedSlots) {
            decrementCraftingInputs(client.inventoryState, matchedSlots);
          },
          getResultItem() {
            return client.inventoryState.craftResult;
          },
          getSlotItem(slot) {
            return getWindowSlotItem(client.inventoryState, slot);
          },
          mcData,
          recomputeCraftingResult() {
            return recomputeCraftingResult(client.inventoryState, crafting);
          },
          setSlotItem(slot, item) {
            setWindowSlotItem(client.inventoryState, slot, item);
          },
          targetSlots: Array.from({ length: 36 }, (_, index) => index + 9)
        });
        changed = result.changed;
      } else {
        const result = applyQuickMoveClick({
          getSlotItem(slot) {
            return getWindowSlotItem(client.inventoryState, slot);
          },
          mcData,
          setSlotItem(slot, item) {
            setWindowSlotItem(client.inventoryState, slot, item);
          },
          slot: packet.slot,
          targetSlots: getPlayerQuickMoveTargets(packet.slot)
        });
        changed = result.changed;

        if (changed && PLAYER_CRAFT_INPUT_SLOTS.includes(packet.slot)) {
          recomputeCraftingResult(client.inventoryState, crafting);
        }
      }
    } else if (packet.mode === 5) {
      const result = applyDragClick({
        clearDragState() {
          client.dragState = null;
        },
        getCursorItem() {
          return client.inventoryState.cursor;
        },
        getDragState() {
          return client.dragState?.windowId === PLAYER_INVENTORY_WINDOW_ID ? client.dragState : null;
        },
        getSlotItem(slot) {
          return getWindowSlotItem(client.inventoryState, slot);
        },
        isSlotAllowed(slot) {
          return slot >= 1 && slot < PLAYER_WINDOW_SLOT_COUNT;
        },
        mcData,
        mouseButton: packet.mouseButton,
        setCursorItem(item) {
          client.inventoryState.cursor = item;
        },
        setDragState(state) {
          client.dragState = state
            ? {
                ...state,
                windowId: PLAYER_INVENTORY_WINDOW_ID
              }
            : null;
        },
        setSlotItem(slot, item) {
          setWindowSlotItem(client.inventoryState, slot, item);
        },
        slot: packet.slot
      });
      handled = result.handled;
      changed = result.changed;

      if (changed && result.changedSlots.some((slot) => PLAYER_CRAFT_INPUT_SLOTS.includes(slot))) {
        recomputeCraftingResult(client.inventoryState, crafting);
      }
    }

    if (!changed) {
      if (!handled) {
        return false;
      }

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
    applyRecipeSelection,
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
