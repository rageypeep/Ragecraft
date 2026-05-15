const { randomUUID } = require('node:crypto');
const { addItem, toProtocolSlot } = require('../inventory');

const ITEM_ENTITY_METADATA_INDEX = 8;
const ITEM_STACK_METADATA_TYPE = 'item_stack';
const DEFAULT_PICKUP_DELAY_MS = 400;
const DEFAULT_PICKUP_RADIUS = 1.75;
const DEFAULT_SCAN_INTERVAL_MS = 100;
const INITIAL_ENTITY_ID = 1_000_000;

function toDropPosition(position) {
  return {
    x: position.x + 0.5,
    y: position.y + 0.25,
    z: position.z + 0.5
  };
}

function createItemDropManager({
  connectedClients,
  mcData,
  sendInventorySlotUpdate,
  writePlayPacket
}) {
  const activeDrops = new Map();
  const itemEntityTypeId = mcData.entitiesByName.item.id;
  const pickupRadiusSquared = DEFAULT_PICKUP_RADIUS * DEFAULT_PICKUP_RADIUS;
  let nextEntityId = INITIAL_ENTITY_ID;

  function sendDropPackets(client, drop) {
    writePlayPacket(client, 'spawn_entity', {
      entityId: drop.entityId,
      objectUUID: drop.uuid,
      type: itemEntityTypeId,
      x: drop.position.x,
      y: drop.position.y,
      z: drop.position.z,
      velocity: drop.velocity,
      pitch: 0,
      yaw: 0,
      headPitch: 0,
      objectData: 1
    });

    writePlayPacket(client, 'entity_metadata', {
      entityId: drop.entityId,
      metadata: [{
        key: ITEM_ENTITY_METADATA_INDEX,
        type: ITEM_STACK_METADATA_TYPE,
        value: toProtocolSlot({
          itemId: drop.itemId,
          count: drop.count
        })
      }]
    });
  }

  function broadcastSpawn(drop) {
    for (const client of connectedClients()) {
      sendDropPackets(client, drop);
    }
  }

  function broadcastCollect(drop, collectorEntityId, pickupItemCount) {
    for (const client of connectedClients()) {
      writePlayPacket(client, 'collect', {
        collectedEntityId: drop.entityId,
        collectorEntityId,
        pickupItemCount
      });
    }
  }

  function broadcastDestroy(entityIds) {
    if (entityIds.length === 0) {
      return;
    }

    for (const client of connectedClients()) {
      writePlayPacket(client, 'entity_destroy', {
        entityIds
      });
    }
  }

  function broadcastMetadata(drop) {
    for (const client of connectedClients()) {
      writePlayPacket(client, 'entity_metadata', {
        entityId: drop.entityId,
        metadata: [{
          key: ITEM_ENTITY_METADATA_INDEX,
          type: ITEM_STACK_METADATA_TYPE,
          value: toProtocolSlot({
            itemId: drop.itemId,
            count: drop.count
          })
        }]
      });
    }
  }

  function spawnDrop(itemId, count, position) {
    if (!Number.isInteger(itemId) || count <= 0 || !position) {
      return null;
    }

    const drop = {
      entityId: nextEntityId++,
      uuid: randomUUID(),
      itemId,
      count,
      position: toDropPosition(position),
      velocity: {
        x: 0,
        y: 0.12,
        z: 0
      },
      pickupAt: Date.now() + DEFAULT_PICKUP_DELAY_MS
    };

    activeDrops.set(drop.entityId, drop);
    broadcastSpawn(drop);
    return drop;
  }

  function sendExistingDrops(client) {
    for (const drop of activeDrops.values()) {
      sendDropPackets(client, drop);
    }
  }

  function setClientPosition(client, positionUpdate = {}) {
    const currentPosition = client.playerPosition ?? { x: 0, y: 0, z: 0 };
    client.playerPosition = {
      x: positionUpdate.x ?? currentPosition.x,
      y: positionUpdate.y ?? currentPosition.y,
      z: positionUpdate.z ?? currentPosition.z
    };
  }

  function canClientPickupDrop(client, drop) {
    if (!client.inventoryState || !client.playerPosition || drop.pickupAt > Date.now()) {
      return false;
    }

    const dx = client.playerPosition.x - drop.position.x;
    const dy = client.playerPosition.y - drop.position.y;
    const dz = client.playerPosition.z - drop.position.z;

    return (dx * dx) + (dy * dy) + (dz * dz) <= pickupRadiusSquared;
  }

  function attemptPickup(client) {
    for (const drop of Array.from(activeDrops.values())) {
      if (!canClientPickupDrop(client, drop)) {
        continue;
      }

      const pickupResult = addItem(client.inventoryState, mcData, drop.itemId, drop.count);

      if (pickupResult.inserted <= 0) {
        continue;
      }

      for (const slot of pickupResult.updatedSlots) {
        sendInventorySlotUpdate(client, slot);
      }

      broadcastCollect(drop, client.id, pickupResult.inserted);

      if (pickupResult.remaining > 0) {
        drop.count = pickupResult.remaining;
        broadcastMetadata(drop);
        continue;
      }

      activeDrops.delete(drop.entityId);
      broadcastDestroy([drop.entityId]);
    }
  }

  const pickupInterval = setInterval(() => {
    for (const client of connectedClients()) {
      attemptPickup(client);
    }
  }, DEFAULT_SCAN_INTERVAL_MS);
  pickupInterval.unref?.();

  function cleanup() {
    clearInterval(pickupInterval);
    activeDrops.clear();
  }

  return {
    attemptPickup,
    cleanup,
    sendExistingDrops,
    setClientPosition,
    spawnDrop
  };
}

module.exports = {
  createItemDropManager
};
