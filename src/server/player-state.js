function createPlayerState(initialTeleportId = null) {
  return {
    lastConfirmedTeleportId: null,
    pendingTeleportId: initialTeleportId,
    teleportConfirmCount: 0,
    abilities: {
      flags: 0,
      isFlying: false
    },
    entityAction: {
      lastAction: null,
      sprinting: false,
      elytraFlying: false,
      vehicleInventoryOpen: false,
      horseJumping: false,
      jumpBoost: 0
    },
    playerInput: {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
      shift: false,
      sprint: false
    },
    loaded: false,
    loadCount: 0,
    hand: {
      lastSwingHand: null,
      swingCount: 0,
      lastUseItemHand: null,
      lastUseItemSequence: null,
      lastUseItemRotation: null
    }
  };
}

function recordTeleportConfirm(playerState, packet = {}) {
  if (!playerState || !Number.isInteger(packet.teleportId)) {
    return;
  }

  playerState.lastConfirmedTeleportId = packet.teleportId;
  playerState.teleportConfirmCount += 1;

  if (playerState.pendingTeleportId === packet.teleportId) {
    playerState.pendingTeleportId = null;
  }
}

function recordRequestedAbilities(playerState, packet = {}) {
  if (!playerState || !Number.isInteger(packet.flags)) {
    return;
  }

  playerState.abilities.flags = packet.flags;
  playerState.abilities.isFlying = (packet.flags & 0x02) !== 0;
}

function recordEntityAction(playerState, packet = {}) {
  if (!playerState || typeof packet.actionId !== 'string') {
    return;
  }

  playerState.entityAction.lastAction = packet.actionId;
  playerState.entityAction.jumpBoost = Number.isInteger(packet.jumpBoost) ? packet.jumpBoost : 0;

  switch (packet.actionId) {
    case 'start_sprinting':
      playerState.entityAction.sprinting = true;
      break;
    case 'stop_sprinting':
      playerState.entityAction.sprinting = false;
      break;
    case 'start_horse_jump':
      playerState.entityAction.horseJumping = true;
      break;
    case 'stop_horse_jump':
      playerState.entityAction.horseJumping = false;
      break;
    case 'open_vehicle_inventory':
      playerState.entityAction.vehicleInventoryOpen = true;
      break;
    case 'start_elytra_flying':
      playerState.entityAction.elytraFlying = true;
      break;
  }
}

function recordPlayerInput(playerState, packet = {}) {
  if (!playerState || !packet.inputs) {
    return;
  }

  playerState.playerInput = {
    forward: Boolean(packet.inputs.forward),
    backward: Boolean(packet.inputs.backward),
    left: Boolean(packet.inputs.left),
    right: Boolean(packet.inputs.right),
    jump: Boolean(packet.inputs.jump),
    shift: Boolean(packet.inputs.shift),
    sprint: Boolean(packet.inputs.sprint)
  };
}

function recordPlayerLoaded(playerState) {
  if (!playerState) {
    return;
  }

  playerState.loaded = true;
  playerState.loadCount += 1;
}

function recordArmAnimation(playerState, packet = {}) {
  if (!playerState || !Number.isInteger(packet.hand)) {
    return;
  }

  playerState.hand.lastSwingHand = packet.hand;
  playerState.hand.swingCount += 1;
}

function recordUseItem(playerState, packet = {}) {
  if (!playerState) {
    return;
  }

  playerState.hand.lastUseItemHand = Number.isInteger(packet.hand) ? packet.hand : null;
  playerState.hand.lastUseItemSequence = Number.isInteger(packet.sequence) ? packet.sequence : null;
  playerState.hand.lastUseItemRotation = packet.rotation
    ? {
        x: packet.rotation.x ?? 0,
        y: packet.rotation.y ?? 0
      }
    : null;
}

module.exports = {
  createPlayerState,
  recordArmAnimation,
  recordEntityAction,
  recordPlayerInput,
  recordPlayerLoaded,
  recordRequestedAbilities,
  recordTeleportConfirm,
  recordUseItem
};
