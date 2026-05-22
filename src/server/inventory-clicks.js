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

module.exports = {
  applyCraftResultClick,
  applyOutsideClick,
  applyStandardSlotClick,
  cloneItem
};
