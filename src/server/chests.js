const nbt = require('prismarine-nbt');
const { incrementInventoryState, toProtocolSlot } = require('../inventory');
const {
  applyDragClick,
  applyOutsideClick,
  applyQuickMoveClick,
  applyStandardSlotClick
} = require('./inventory-clicks');

const OUTSIDE_WINDOW_SLOT = -999;
const CHEST_MENU_TYPE_IDS = {
  27: 2,
  54: 5
};
const CHEST_TITLES = {
  27: nbt.comp({ text: nbt.string('Chest') }),
  54: nbt.comp({ text: nbt.string('Large Chest') })
};

function createChestContainer(windowId, interaction) {
  return {
    blockPosition: interaction.positions[0],
    positions: interaction.positions.map((position) => ({ ...position })),
    record: interaction.record,
    size: interaction.size,
    stateId: 0,
    type: 'minecraft:chest',
    windowId
  };
}

function positionsEqual(left, right) {
  return left?.x === right?.x && left?.y === right?.y && left?.z === right?.z;
}

function getChestQuickMoveTargets(slot, containerSize) {
  if (slot >= 0 && slot < containerSize) {
    return Array.from({ length: 36 }, (_, index) => index + containerSize);
  }

  if (slot >= containerSize && slot < containerSize + 36) {
    return Array.from({ length: containerSize }, (_, index) => index);
  }

  return [];
}

function createChestApi({ mcData, translateItemId = null, writePlayPacket }) {
  function allocateWindowId(client) {
    const nextWindowId = client.nextWindowId ?? 1;
    client.nextWindowId = nextWindowId >= 100 ? 1 : nextWindowId + 1;
    return nextWindowId;
  }

  function getChestWindowSlotItem(client, slot) {
    const container = client?.activeContainer;
    const inventory = client?.inventoryState;

    if (!container || !inventory || !Number.isInteger(slot)) {
      return null;
    }

    if (slot >= 0 && slot < container.size) {
      return container.record.items[slot] ?? null;
    }

    if (slot >= container.size && slot < container.size + 27) {
      return inventory.main[slot - container.size] ?? null;
    }

    if (slot >= container.size + 27 && slot < container.size + 36) {
      return inventory.hotbar[slot - (container.size + 27)] ?? null;
    }

    return null;
  }

  function setChestWindowSlotItem(client, slot, item) {
    const container = client?.activeContainer;
    const inventory = client?.inventoryState;

    if (!container || !inventory || !Number.isInteger(slot)) {
      return false;
    }

    if (slot >= 0 && slot < container.size) {
      container.record.items[slot] = item;
      return true;
    }

    if (slot >= container.size && slot < container.size + 27) {
      inventory.main[slot - container.size] = item;
      return true;
    }

    if (slot >= container.size + 27 && slot < container.size + 36) {
      inventory.hotbar[slot - (container.size + 27)] = item;
      return true;
    }

    return false;
  }

  function getChestWindowItems(client) {
    const container = client?.activeContainer;

    if (!container) {
      return [];
    }

    const items = [];
    const totalSlots = container.size + 36;

    for (let slot = 0; slot < totalSlots; slot++) {
      items.push(getChestWindowSlotItem(client, slot));
    }

    return items;
  }

  function sendChestState(client) {
    const container = client?.activeContainer;

    if (!container || container.type !== 'minecraft:chest') {
      return false;
    }

    writePlayPacket(client, 'window_items', {
      windowId: container.windowId,
      stateId: container.stateId ?? 0,
      items: getChestWindowItems(client).map((item) => toProtocolSlot(item, translateItemId)),
      carriedItem: toProtocolSlot(client.inventoryState?.cursor ?? null, translateItemId)
    });
    return true;
  }

  function openChest(client, interaction) {
    if (!client?.inventoryState || !interaction || !CHEST_MENU_TYPE_IDS[interaction.size]) {
      return false;
    }

    client.activeContainer = createChestContainer(allocateWindowId(client), interaction);
    writePlayPacket(client, 'open_window', {
      windowId: client.activeContainer.windowId,
      inventoryType: CHEST_MENU_TYPE_IDS[interaction.size],
      windowTitle: CHEST_TITLES[interaction.size]
    });
    sendChestState(client);
    return true;
  }

  function closeActiveWindow(client, { sendPacket = false } = {}) {
    const container = client?.activeContainer;

    if (!container || container.type !== 'minecraft:chest') {
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

    if (!container || container.type !== 'minecraft:chest') {
      return false;
    }

    incrementInventoryState(container);
    sendChestState(client);
    return true;
  }

  function handleWindowClick(client, packet) {
    const container = client?.activeContainer;

    if (!client?.inventoryState || !container || container.type !== 'minecraft:chest' || packet?.windowId !== container.windowId) {
      return false;
    }

    const totalSlots = container.size + 36;
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
      } else if (packet.slot >= 0 && packet.slot < totalSlots) {
        changed = applyStandardSlotClick({
          getCursorItem() {
            return client.inventoryState.cursor;
          },
          getSlotItem(slot) {
            return getChestWindowSlotItem(client, slot);
          },
          mcData,
          mouseButton: packet.mouseButton,
          setCursorItem(item) {
            client.inventoryState.cursor = item;
          },
          setSlotItem(slot, item) {
            setChestWindowSlotItem(client, slot, item);
          },
          slot: packet.slot
        });
      }
    } else if (packet.mode === 1 && packet.slot >= 0 && packet.slot < totalSlots) {
      handled = true;
      const result = applyQuickMoveClick({
        getSlotItem(slot) {
          return getChestWindowSlotItem(client, slot);
        },
        mcData,
        setSlotItem(slot, item) {
          setChestWindowSlotItem(client, slot, item);
        },
        slot: packet.slot,
        targetSlots: getChestQuickMoveTargets(packet.slot, container.size)
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
          return getChestWindowSlotItem(client, slot);
        },
        isSlotAllowed(slot) {
          return slot >= 0 && slot < totalSlots;
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
          setChestWindowSlotItem(client, slot, item);
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

      sendChestState(client);
      return false;
    }

    incrementInventoryState(container);
    sendChestState(client);
    return true;
  }

  function isChestAffected(client, positions = []) {
    const container = client?.activeContainer;

    if (!container || container.type !== 'minecraft:chest') {
      return false;
    }

    return positions.some((position) =>
      container.positions.some((openPosition) => positionsEqual(openPosition, position)));
  }

  return {
    closeActiveWindow,
    commitVisibleInventoryChange,
    handleWindowClick,
    isChestAffected,
    openChest,
    sendChestState
  };
}

module.exports = {
  createChestApi
};
