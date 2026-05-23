function cloneItem(item) {
  return item
    ? {
        itemId: item.itemId,
        count: item.count
      }
    : null;
}

function getMaxStackSize(mcData, item) {
  if (!item) {
    return 64;
  }

  return mcData.items[item.itemId]?.stackSize ?? 64;
}

function canStackItems(left, right) {
  return Boolean(left && right && left.itemId === right.itemId);
}

function getTransferCapacity({
  getSlotItem,
  item,
  mcData,
  slots
}) {
  if (!item) {
    return 0;
  }

  const maxStackSize = getMaxStackSize(mcData, item);
  let capacity = 0;

  for (const slot of slots) {
    const slotItem = getSlotItem(slot);

    if (!slotItem) {
      capacity += maxStackSize;
      continue;
    }

    if (canStackItems(slotItem, item)) {
      capacity += Math.max(0, maxStackSize - slotItem.count);
    }
  }

  return capacity;
}

function moveItemToSlots({
  getSlotItem,
  item,
  mcData,
  setSlotItem,
  slots
}) {
  if (!item) {
    return {
      changedSlots: [],
      movedCount: 0,
      remainingItem: null
    };
  }

  const maxStackSize = getMaxStackSize(mcData, item);
  let remaining = item.count;
  const changedSlots = [];

  for (const slot of slots) {
    if (remaining <= 0) {
      break;
    }

    const slotItem = cloneItem(getSlotItem(slot));

    if (!slotItem || !canStackItems(slotItem, item) || slotItem.count >= maxStackSize) {
      continue;
    }

    const transfer = Math.min(maxStackSize - slotItem.count, remaining);

    if (transfer <= 0) {
      continue;
    }

    setSlotItem(slot, {
      itemId: slotItem.itemId,
      count: slotItem.count + transfer
    });
    changedSlots.push(slot);
    remaining -= transfer;
  }

  for (const slot of slots) {
    if (remaining <= 0) {
      break;
    }

    if (getSlotItem(slot)) {
      continue;
    }

    const transfer = Math.min(maxStackSize, remaining);

    if (transfer <= 0) {
      continue;
    }

    setSlotItem(slot, {
      itemId: item.itemId,
      count: transfer
    });
    changedSlots.push(slot);
    remaining -= transfer;
  }

  return {
    changedSlots,
    movedCount: item.count - remaining,
    remainingItem: remaining > 0
      ? {
          itemId: item.itemId,
          count: remaining
        }
      : null
  };
}

function applyStandardSlotClick({
  getCursorItem,
  getSlotItem,
  mcData,
  mouseButton,
  setCursorItem,
  setSlotItem,
  slot
}) {
  const slotItem = cloneItem(getSlotItem(slot));
  const cursorItem = cloneItem(getCursorItem());

  if (mouseButton === 0) {
    if (!cursorItem) {
      setCursorItem(slotItem);
      setSlotItem(slot, null);
      return Boolean(slotItem);
    }

    if (!slotItem) {
      setSlotItem(slot, cursorItem);
      setCursorItem(null);
      return true;
    }

    const maxStackSize = getMaxStackSize(mcData, slotItem);

    if (slotItem.itemId === cursorItem.itemId && slotItem.count < maxStackSize) {
      const transfer = Math.min(maxStackSize - slotItem.count, cursorItem.count);
      setSlotItem(slot, {
        itemId: slotItem.itemId,
        count: slotItem.count + transfer
      });
      setCursorItem(cursorItem.count === transfer
        ? null
        : {
            itemId: cursorItem.itemId,
            count: cursorItem.count - transfer
          });
      return transfer > 0;
    }

    setSlotItem(slot, cursorItem);
    setCursorItem(slotItem);
    return true;
  }

  if (mouseButton === 1) {
    if (!cursorItem) {
      if (!slotItem) {
        return false;
      }

      const transfer = Math.ceil(slotItem.count / 2);
      setCursorItem({
        itemId: slotItem.itemId,
        count: transfer
      });
      setSlotItem(slot, slotItem.count === transfer
        ? null
        : {
            itemId: slotItem.itemId,
            count: slotItem.count - transfer
          });
      return true;
    }

    if (!slotItem) {
      setSlotItem(slot, {
        itemId: cursorItem.itemId,
        count: 1
      });
      setCursorItem(cursorItem.count === 1
        ? null
        : {
            itemId: cursorItem.itemId,
            count: cursorItem.count - 1
          });
      return true;
    }

    const maxStackSize = getMaxStackSize(mcData, slotItem);

    if (slotItem.itemId === cursorItem.itemId && slotItem.count < maxStackSize) {
      setSlotItem(slot, {
        itemId: slotItem.itemId,
        count: slotItem.count + 1
      });
      setCursorItem(cursorItem.count === 1
        ? null
        : {
            itemId: cursorItem.itemId,
            count: cursorItem.count - 1
          });
      return true;
    }

    setSlotItem(slot, cursorItem);
    setCursorItem(slotItem);
    return true;
  }

  return false;
}

function applyOutsideClick({
  getCursorItem,
  mouseButton,
  setCursorItem
}) {
  const cursorItem = getCursorItem();

  if (!cursorItem) {
    return false;
  }

  if (mouseButton === 0) {
    setCursorItem(null);
    return true;
  }

  if (mouseButton === 1) {
    setCursorItem(cursorItem.count <= 1
      ? null
      : {
          itemId: cursorItem.itemId,
          count: cursorItem.count - 1
        });
    return true;
  }

  return false;
}

function applyQuickMoveClick({
  getSlotItem,
  mcData,
  setSlotItem,
  slot,
  targetSlots
}) {
  const slotItem = cloneItem(getSlotItem(slot));

  if (!slotItem || !Array.isArray(targetSlots) || targetSlots.length === 0) {
    return {
      changed: false,
      changedSlots: []
    };
  }

  const transfer = moveItemToSlots({
    getSlotItem,
    item: slotItem,
    mcData,
    setSlotItem,
    slots: targetSlots
  });

  if (transfer.movedCount <= 0) {
    return {
      changed: false,
      changedSlots: []
    };
  }

  setSlotItem(slot, transfer.remainingItem);
  return {
    changed: true,
    changedSlots: [slot, ...transfer.changedSlots]
  };
}

function applyCraftResultClick({
  decrementMatchedInputs,
  getCursorItem,
  getResultItem,
  mcData,
  recomputeCraftingResult,
  setCursorItem
}) {
  const match = recomputeCraftingResult();
  const resultItem = cloneItem(getResultItem());

  if (!match || !resultItem) {
    return false;
  }

  const cursorItem = getCursorItem();
  const maxStackSize = getMaxStackSize(mcData, resultItem);

  if (!cursorItem) {
    setCursorItem(resultItem);
  } else if (cursorItem.itemId === resultItem.itemId && cursorItem.count + resultItem.count <= maxStackSize) {
    setCursorItem({
      itemId: cursorItem.itemId,
      count: cursorItem.count + resultItem.count
    });
  } else {
    return false;
  }

  decrementMatchedInputs(match.matchedSlots);
  recomputeCraftingResult();
  return true;
}

function applyCraftResultQuickMove({
  decrementMatchedInputs,
  getResultItem,
  getSlotItem,
  mcData,
  recomputeCraftingResult,
  setSlotItem,
  targetSlots
}) {
  let changed = false;
  const changedSlots = new Set();

  while (true) {
    const match = recomputeCraftingResult();
    const resultItem = cloneItem(getResultItem());

    if (!match || !resultItem) {
      break;
    }

    if (getTransferCapacity({
      getSlotItem,
      item: resultItem,
      mcData,
      slots: targetSlots
    }) < resultItem.count) {
      break;
    }

    const transfer = moveItemToSlots({
      getSlotItem,
      item: resultItem,
      mcData,
      setSlotItem,
      slots: targetSlots
    });

    if (transfer.movedCount !== resultItem.count) {
      break;
    }

    for (const slot of transfer.changedSlots) {
      changedSlots.add(slot);
    }

    decrementMatchedInputs(match.matchedSlots);
    changed = true;
  }

  recomputeCraftingResult();
  return {
    changed,
    changedSlots: Array.from(changedSlots)
  };
}

function applyDragClick({
  clearDragState,
  getCursorItem,
  getDragState,
  getSlotItem,
  isSlotAllowed,
  mcData,
  mouseButton,
  setCursorItem,
  setDragState,
  setSlotItem,
  slot
}) {
  const startMode = mouseButton === 0 ? 'left' : mouseButton === 4 ? 'right' : null;
  const addMode = mouseButton === 1 ? 'left' : mouseButton === 5 ? 'right' : null;
  const endMode = mouseButton === 2 ? 'left' : mouseButton === 6 ? 'right' : null;

  if (startMode) {
    if (!getCursorItem()) {
      clearDragState();
      return {
        changed: false,
        changedSlots: [],
        handled: true
      };
    }

    setDragState({
      mode: startMode,
      slots: []
    });
    return {
      changed: false,
      changedSlots: [],
      handled: true
    };
  }

  const dragState = getDragState();

  if (!dragState) {
    return {
      changed: false,
      changedSlots: [],
      handled: false
    };
  }

  if (addMode) {
    if (dragState.mode !== addMode) {
      clearDragState();
      return {
        changed: false,
        changedSlots: [],
        handled: true
      };
    }

    if (
      !Number.isInteger(slot) ||
      !isSlotAllowed(slot) ||
      dragState.slots.includes(slot)
    ) {
      return {
        changed: false,
        changedSlots: [],
        handled: true
      };
    }

    dragState.slots.push(slot);
    setDragState(dragState);
    return {
      changed: false,
      changedSlots: [],
      handled: true
    };
  }

  if (!endMode) {
    clearDragState();
    return {
      changed: false,
      changedSlots: [],
      handled: false
    };
  }

  if (dragState.mode !== endMode) {
    clearDragState();
    return {
      changed: false,
      changedSlots: [],
      handled: true
    };
  }

  const cursorItem = cloneItem(getCursorItem());

  if (!cursorItem || dragState.slots.length === 0) {
    clearDragState();
    return {
      changed: false,
      changedSlots: [],
      handled: true
    };
  }

  const changedSlots = new Set();
  let remaining = cursorItem.count;
  let progress = true;

  if (dragState.mode === 'right') {
    for (const targetSlot of dragState.slots) {
      if (remaining <= 0) {
        break;
      }

      const slotItem = cloneItem(getSlotItem(targetSlot));

      if (slotItem) {
        const maxStackSize = getMaxStackSize(mcData, slotItem);

        if (!canStackItems(slotItem, cursorItem) || slotItem.count >= maxStackSize) {
          continue;
        }

        setSlotItem(targetSlot, {
          itemId: slotItem.itemId,
          count: slotItem.count + 1
        });
      } else {
        setSlotItem(targetSlot, {
          itemId: cursorItem.itemId,
          count: 1
        });
      }

      changedSlots.add(targetSlot);
      remaining -= 1;
    }
  } else {
    while (remaining > 0 && progress) {
      progress = false;

      for (const targetSlot of dragState.slots) {
        if (remaining <= 0) {
          break;
        }

        const slotItem = cloneItem(getSlotItem(targetSlot));

        if (slotItem) {
          const maxStackSize = getMaxStackSize(mcData, slotItem);

          if (!canStackItems(slotItem, cursorItem) || slotItem.count >= maxStackSize) {
            continue;
          }

          setSlotItem(targetSlot, {
            itemId: slotItem.itemId,
            count: slotItem.count + 1
          });
        } else {
          setSlotItem(targetSlot, {
            itemId: cursorItem.itemId,
            count: 1
          });
        }

        changedSlots.add(targetSlot);
        remaining -= 1;
        progress = true;
      }
    }
  }

  setCursorItem(remaining > 0
    ? {
        itemId: cursorItem.itemId,
        count: remaining
      }
    : null);
  clearDragState();
  return {
    changed: changedSlots.size > 0,
    changedSlots: Array.from(changedSlots),
    handled: true
  };
}

module.exports = {
  applyCraftResultClick,
  applyCraftResultQuickMove,
  applyDragClick,
  applyOutsideClick,
  applyQuickMoveClick,
  applyStandardSlotClick,
  cloneItem
};
