const nbt = require('prismarine-nbt');
const { incrementInventoryState, toProtocolSlot } = require('../inventory');
const {
  applyDragClick,
  applyOutsideClick,
  applyQuickMoveClick,
  applyStandardSlotClick
} = require('./inventory-clicks');

const OUTSIDE_WINDOW_SLOT = -999;
const FURNACE_WINDOW_SLOT_COUNT = 39;
const FURNACE_METADATA = {
  'minecraft:blast_furnace': {
    inventoryType: 10,
    title: nbt.comp({ text: nbt.string('Blast Furnace') })
  },
  'minecraft:furnace': {
    inventoryType: 14,
    title: nbt.comp({ text: nbt.string('Furnace') })
  },
  'minecraft:smoker': {
    inventoryType: 22,
    title: nbt.comp({ text: nbt.string('Smoker') })
  }
};

function cloneItem(item) {
  return item
    ? {
        itemId: item.itemId,
        count: item.count
      }
    : null;
}

function positionsEqual(left, right) {
  return left?.x === right?.x && left?.y === right?.y && left?.z === right?.z;
}

function getMaxStackSize(mcData, item) {
  return mcData.items[item?.itemId]?.stackSize ?? 64;
}

function canStackItems(left, right) {
  return Boolean(left && right && left.itemId === right.itemId);
}

function createProcessingState(record) {
  return {
    burnTime: Number.isInteger(record?.data?.burnTime) ? record.data.burnTime : 0,
    cookTime: Number.isInteger(record?.data?.cookTime) ? record.data.cookTime : 0,
    cookTimeTotal: Number.isInteger(record?.data?.cookTimeTotal) ? record.data.cookTimeTotal : 0,
    fuelTime: Number.isInteger(record?.data?.fuelTime) ? record.data.fuelTime : 0
  };
}

function createFurnaceContainer(windowId, interaction) {
  return {
    blockPosition: interaction.blockPosition,
    record: interaction.record,
    stateId: 0,
    type: interaction.type,
    windowId
  };
}

function canAcceptRecipeOutput(record, recipe, mcData) {
  if (!record || !recipe) {
    return false;
  }

  const outputItem = record.items[2] ?? null;

  if (!outputItem) {
    return true;
  }

  if (outputItem.itemId !== recipe.result.itemId) {
    return false;
  }

  return outputItem.count + recipe.result.count <= getMaxStackSize(mcData, outputItem);
}

function applyOutputSlotClick({
  getCursorItem,
  getOutputItem,
  mcData,
  mouseButton,
  setCursorItem,
  setOutputItem
}) {
  const outputItem = cloneItem(getOutputItem());
  const cursorItem = cloneItem(getCursorItem());

  if (!outputItem) {
    return false;
  }

  if (mouseButton === 0) {
    if (!cursorItem) {
      setCursorItem(outputItem);
      setOutputItem(null);
      return true;
    }

    if (!canStackItems(cursorItem, outputItem)) {
      return false;
    }

    const maxStackSize = getMaxStackSize(mcData, outputItem);

    if (cursorItem.count + outputItem.count > maxStackSize) {
      return false;
    }

    setCursorItem({
      itemId: cursorItem.itemId,
      count: cursorItem.count + outputItem.count
    });
    setOutputItem(null);
    return true;
  }

  if (mouseButton === 1) {
    if (!cursorItem) {
      const transfer = Math.ceil(outputItem.count / 2);
      setCursorItem({
        itemId: outputItem.itemId,
        count: transfer
      });
      setOutputItem(outputItem.count === transfer
        ? null
        : {
            itemId: outputItem.itemId,
            count: outputItem.count - transfer
          });
      return true;
    }

    if (!canStackItems(cursorItem, outputItem)) {
      return false;
    }

    const maxStackSize = getMaxStackSize(mcData, outputItem);

    if (cursorItem.count >= maxStackSize) {
      return false;
    }

    setCursorItem({
      itemId: cursorItem.itemId,
      count: cursorItem.count + 1
    });
    setOutputItem(outputItem.count === 1
      ? null
      : {
          itemId: outputItem.itemId,
          count: outputItem.count - 1
        });
    return true;
  }

  return false;
}

function createFurnaceApi({
  mcData,
  processingRecipes,
  translateItemId = null,
  writePlayPacket
}) {
  function allocateWindowId(client) {
    const nextWindowId = client.nextWindowId ?? 1;
    client.nextWindowId = nextWindowId >= 100 ? 1 : nextWindowId + 1;
    return nextWindowId;
  }

  function getWindowSlotItem(client, slot) {
    const container = client?.activeContainer;
    const inventory = client?.inventoryState;

    if (!container || !inventory || !Number.isInteger(slot)) {
      return null;
    }

    if (slot >= 0 && slot <= 2) {
      return container.record.items[slot] ?? null;
    }

    if (slot >= 3 && slot <= 29) {
      return inventory.main[slot - 3] ?? null;
    }

    if (slot >= 30 && slot <= 38) {
      return inventory.hotbar[slot - 30] ?? null;
    }

    return null;
  }

  function setWindowSlotItem(client, slot, item) {
    const container = client?.activeContainer;
    const inventory = client?.inventoryState;

    if (!container || !inventory || !Number.isInteger(slot)) {
      return false;
    }

    if (slot >= 0 && slot <= 2) {
      container.record.items[slot] = item;
      return true;
    }

    if (slot >= 3 && slot <= 29) {
      inventory.main[slot - 3] = item;
      return true;
    }

    if (slot >= 30 && slot <= 38) {
      inventory.hotbar[slot - 30] = item;
      return true;
    }

    return false;
  }

  function getWindowItems(client) {
    const items = [];

    for (let slot = 0; slot < FURNACE_WINDOW_SLOT_COUNT; slot++) {
      items.push(getWindowSlotItem(client, slot));
    }

    return items;
  }

  function sendProgressBars(client) {
    const container = client?.activeContainer;

    if (!container || !FURNACE_METADATA[container.type]) {
      return false;
    }

    const state = createProcessingState(container.record);
    const properties = [state.burnTime, state.fuelTime, state.cookTime, state.cookTimeTotal];

    properties.forEach((value, property) => {
      writePlayPacket(client, 'craft_progress_bar', {
        windowId: container.windowId,
        property,
        value
      });
    });

    return true;
  }

  function sendFurnaceState(client) {
    const container = client?.activeContainer;

    if (!container || !FURNACE_METADATA[container.type]) {
      return false;
    }

    writePlayPacket(client, 'window_items', {
      windowId: container.windowId,
      stateId: container.stateId ?? 0,
      items: getWindowItems(client).map((item) => toProtocolSlot(item, translateItemId)),
      carriedItem: toProtocolSlot(client.inventoryState?.cursor ?? null, translateItemId)
    });
    sendProgressBars(client);
    return true;
  }

  function openFurnace(client, interaction) {
    if (!client?.inventoryState || !interaction || !FURNACE_METADATA[interaction.type]) {
      return false;
    }

    const metadata = FURNACE_METADATA[interaction.type];
    client.activeContainer = createFurnaceContainer(allocateWindowId(client), interaction);
    writePlayPacket(client, 'open_window', {
      windowId: client.activeContainer.windowId,
      inventoryType: metadata.inventoryType,
      windowTitle: metadata.title
    });
    sendFurnaceState(client);
    return true;
  }

  function closeActiveWindow(client, { sendPacket = false } = {}) {
    const container = client?.activeContainer;

    if (!container || !FURNACE_METADATA[container.type]) {
      return false;
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

    if (!container || !FURNACE_METADATA[container.type]) {
      return false;
    }

    incrementInventoryState(container);
    sendFurnaceState(client);
    return true;
  }

  function getPlayerQuickMoveTargets(client, slot) {
    const slotItem = getWindowSlotItem(client, slot);
    const containerType = client?.activeContainer?.type;

    if (!slotItem || !containerType) {
      return [];
    }

    if (slot >= 3 && slot <= 29) {
      if (processingRecipes?.findRecipe(containerType, slotItem.itemId)) {
        return [0];
      }

      if (processingRecipes?.isFuel(slotItem.itemId)) {
        return [1];
      }

      return Array.from({ length: 9 }, (_, index) => index + 30);
    }

    if (slot >= 30 && slot <= 38) {
      if (processingRecipes?.findRecipe(containerType, slotItem.itemId)) {
        return [0];
      }

      if (processingRecipes?.isFuel(slotItem.itemId)) {
        return [1];
      }

      return Array.from({ length: 27 }, (_, index) => index + 3);
    }

    return [];
  }

  function handleWindowClick(client, packet) {
    const container = client?.activeContainer;

    if (
      !client?.inventoryState ||
      !container ||
      !FURNACE_METADATA[container.type] ||
      packet?.windowId !== container.windowId
    ) {
      return false;
    }

    let changed = false;
    let handled = false;

    if (packet.mode === 0) {
      handled = true;
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
      } else if (packet.slot === 2) {
        changed = applyOutputSlotClick({
          getCursorItem() {
            return client.inventoryState.cursor;
          },
          getOutputItem() {
            return getWindowSlotItem(client, 2);
          },
          mcData,
          mouseButton: packet.mouseButton,
          setCursorItem(item) {
            client.inventoryState.cursor = item;
          },
          setOutputItem(item) {
            setWindowSlotItem(client, 2, item);
          }
        });
      } else if (packet.slot >= 0 && packet.slot < FURNACE_WINDOW_SLOT_COUNT) {
        changed = applyStandardSlotClick({
          getCursorItem() {
            return client.inventoryState.cursor;
          },
          getSlotItem(slot) {
            return getWindowSlotItem(client, slot);
          },
          mcData,
          mouseButton: packet.mouseButton,
          setCursorItem(item) {
            client.inventoryState.cursor = item;
          },
          setSlotItem(slot, item) {
            setWindowSlotItem(client, slot, item);
          },
          slot: packet.slot
        });
      }
    } else if (packet.mode === 1 && packet.slot >= 0 && packet.slot < FURNACE_WINDOW_SLOT_COUNT) {
      handled = true;
      const targetSlots = packet.slot <= 2
        ? Array.from({ length: 36 }, (_, index) => index + 3)
        : getPlayerQuickMoveTargets(client, packet.slot);
      const result = applyQuickMoveClick({
        getSlotItem(slot) {
          return getWindowSlotItem(client, slot);
        },
        mcData,
        setSlotItem(slot, item) {
          setWindowSlotItem(client, slot, item);
        },
        slot: packet.slot,
        targetSlots
      });
      changed = result.changed;
    } else if (packet.mode === 5) {
      const result = applyDragClick({
        clearDragState() {
          client.dragState = null;
        },
        getCursorItem() {
          return client.inventoryState.cursor;
        },
        getDragState() {
          return client.dragState?.windowId === container.windowId ? client.dragState : null;
        },
        getSlotItem(slot) {
          return getWindowSlotItem(client, slot);
        },
        isSlotAllowed(slot) {
          return slot >= 0 && slot < FURNACE_WINDOW_SLOT_COUNT && slot !== 2;
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
                windowId: container.windowId
              }
            : null;
        },
        setSlotItem(slot, item) {
          setWindowSlotItem(client, slot, item);
        },
        slot: packet.slot
      });
      handled = result.handled;
      changed = result.changed;
    }

    if (!changed) {
      if (!handled) {
        return false;
      }

      sendFurnaceState(client);
      return false;
    }

    incrementInventoryState(container);
    sendFurnaceState(client);
    return true;
  }

  function isFurnaceAffected(client, positions = []) {
    const container = client?.activeContainer;

    if (!container || !FURNACE_METADATA[container.type]) {
      return false;
    }

    return positions.some((position) => positionsEqual(position, container.blockPosition));
  }

  function processRecord(record, tickAmount = 20) {
    if (!record || !FURNACE_METADATA[record.type] || !Array.isArray(record.items)) {
      return {
        changed: false,
        progressChanged: false,
        saveRecommended: false
      };
    }

    record.data = createProcessingState(record);
    const inputItem = record.items[0] ?? null;
    let recipe = inputItem ? processingRecipes?.findRecipe(record.type, inputItem.itemId) : null;
    let canProcess = recipe ? canAcceptRecipeOutput(record, recipe, mcData) : false;
    let changed = false;
    let progressChanged = false;
    let saveRecommended = false;

    if (record.data.burnTime <= 0 && canProcess) {
      const fuelItem = record.items[1] ?? null;
      const fuel = processingRecipes?.getFuel(fuelItem?.itemId);

      if (fuel) {
        record.data.burnTime = fuel.burnTime;
        record.data.fuelTime = fuel.burnTime;

        if (fuelItem.count <= 1) {
          record.items[1] = Number.isInteger(fuel.remainderItemId)
            ? { itemId: fuel.remainderItemId, count: 1 }
            : null;
        } else {
          record.items[1] = {
            itemId: fuelItem.itemId,
            count: fuelItem.count - 1
          };
        }

        changed = true;
        progressChanged = true;
        saveRecommended = true;
      }
    }

    if (record.data.burnTime > 0) {
      const burnStep = Math.min(tickAmount, record.data.burnTime);
      record.data.burnTime -= burnStep;
      progressChanged = true;

      if (canProcess) {
        if (record.data.cookTimeTotal !== recipe.cookTime) {
          record.data.cookTimeTotal = recipe.cookTime;
          progressChanged = true;
        }

        record.data.cookTime += burnStep;

        while (recipe && canAcceptRecipeOutput(record, recipe, mcData) && record.data.cookTime >= recipe.cookTime) {
          record.data.cookTime -= recipe.cookTime;
          const nextInput = record.items[0];

          if (!nextInput) {
            record.data.cookTime = 0;
            break;
          }

          record.items[0] = nextInput.count <= 1
            ? null
            : {
                itemId: nextInput.itemId,
                count: nextInput.count - 1
              };

          const outputItem = record.items[2];
          record.items[2] = outputItem
            ? {
                itemId: outputItem.itemId,
                count: outputItem.count + recipe.result.count
              }
            : {
                itemId: recipe.result.itemId,
                count: recipe.result.count
              };

          changed = true;
          saveRecommended = true;

          const upcomingInput = record.items[0] ?? null;
          recipe = upcomingInput ? processingRecipes?.findRecipe(record.type, upcomingInput.itemId) : null;
          canProcess = recipe ? canAcceptRecipeOutput(record, recipe, mcData) : false;

          if (!canProcess) {
            record.data.cookTime = 0;
            break;
          }

          if (record.data.cookTimeTotal !== recipe.cookTime) {
            record.data.cookTimeTotal = recipe.cookTime;
            progressChanged = true;
          }
        }
      } else if (record.data.cookTime > 0) {
        record.data.cookTime = Math.max(0, record.data.cookTime - (burnStep * 2));
        progressChanged = true;
      }
    }

    const nextInput = record.items[0] ?? null;
    recipe = nextInput ? processingRecipes?.findRecipe(record.type, nextInput.itemId) : null;
    canProcess = recipe ? canAcceptRecipeOutput(record, recipe, mcData) : false;

    if (!canProcess && record.data.cookTime !== 0) {
      record.data.cookTime = 0;
      progressChanged = true;
    }

    const nextCookTimeTotal = canProcess ? recipe.cookTime : 0;

    if (record.data.cookTimeTotal !== nextCookTimeTotal) {
      record.data.cookTimeTotal = nextCookTimeTotal;
      progressChanged = true;
    }

    if (record.data.burnTime <= 0 && record.data.fuelTime !== 0) {
      record.data.fuelTime = 0;
      progressChanged = true;
    }

    return {
      changed,
      progressChanged,
      saveRecommended
    };
  }

  function refreshViewersForRecord(record, clients) {
    let refreshed = false;

    for (const client of clients) {
      if (client?.activeContainer?.record !== record) {
        continue;
      }

      incrementInventoryState(client.activeContainer);
      sendFurnaceState(client);
      refreshed = true;
    }

    return refreshed;
  }

  return {
    closeActiveWindow,
    commitVisibleInventoryChange,
    handleWindowClick,
    isFurnaceAffected,
    openFurnace,
    processRecord,
    refreshViewersForRecord,
    sendFurnaceState
  };
}

module.exports = {
  createFurnaceApi
};
