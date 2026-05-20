function createLightUpdatePacket(chunkPacket) {
  return {
    chunkX: chunkPacket.x,
    chunkZ: chunkPacket.z,
    skyLightMask: chunkPacket.skyLightMask,
    blockLightMask: chunkPacket.blockLightMask,
    emptySkyLightMask: chunkPacket.emptySkyLightMask,
    emptyBlockLightMask: chunkPacket.emptyBlockLightMask,
    skyLight: chunkPacket.skyLight,
    blockLight: chunkPacket.blockLight
  };
}

function buildWorldState(loginPacket, world) {
  return {
    ...loginPacket.worldState,
    isFlat: true,
    seaLevel: world.surfaceY - 1
  };
}

function buildPlayerStatusPackets() {
  return {
    experience: {
      experienceBar: 0,
      level: 0,
      totalExperience: 0
    },
    health: {
      health: 20,
      food: 20,
      foodSaturation: 5
    },
    time: {
      age: 0n,
      time: 1000n,
      tickDayTime: true
    }
  };
}

function buildRespawnPacket(loginPacket, world, copyMetadata = 0) {
  return {
    worldState: buildWorldState(loginPacket, world),
    copyMetadata
  };
}

function buildPlayerBootstrapPackets(client, config, world, loginPacket) {
  const safeSpawn = world.getSafeSpawnPosition();
  const worldState = buildWorldState(loginPacket, world);
  const playerStatus = buildPlayerStatusPackets();
  const chunkDistance = world.streamRadius;
  const login = {
    ...loginPacket,
    enforceSecureChat: false,
    entityId: client.id,
    isHardcore: false,
    gameMode: 0,
    previousGameMode: 1,
    hashedSeed: [0, 0],
    maxPlayers: config.maxPlayers,
    viewDistance: chunkDistance,
    simulationDistance: chunkDistance,
    reducedDebugInfo: false,
    enableRespawnScreen: true,
    isDebug: false,
    isFlat: true,
    worldState
  };

  return {
    abilities: {
      flags: 0x02,
      flyingSpeed: 0.05,
      walkingSpeed: 0.1
    },
    border: {
      x: safeSpawn.x,
      z: safeSpawn.z,
      oldDiameter: 5.9999968e7,
      newDiameter: 5.9999968e7,
      speed: 0,
      portalTeleportBoundary: 29999984,
      warningBlocks: 5,
      warningTime: 15
    },
    gameStateChange: {
      reason: 'level_chunks_load_start',
      gameMode: 0
    },
    login,
    playerStatus,
    position: {
      teleportId: 0,
      x: safeSpawn.x,
      y: safeSpawn.y,
      z: safeSpawn.z,
      dx: 0,
      dy: 0,
      dz: 0,
      yaw: config.spawn.yaw,
      pitch: config.spawn.pitch,
      flags: 0x00
    },
    respawn: buildRespawnPacket(loginPacket, world),
    safeSpawn,
    simulationDistance: {
      distance: chunkDistance
    },
    spawnPosition: {
      globalPos: {
        dimensionName: 'minecraft:overworld',
        location: {
          x: safeSpawn.x,
          y: safeSpawn.y,
          z: safeSpawn.z
        }
      },
      yaw: config.spawn.yaw,
      pitch: config.spawn.pitch
    },
    viewDistance: {
      viewDistance: chunkDistance
    },
    viewPosition: {
      chunkX: world.spawnChunk.x,
      chunkZ: world.spawnChunk.z
    }
  };
}

module.exports = {
  buildPlayerStatusPackets,
  buildPlayerBootstrapPackets,
  buildRespawnPacket,
  buildWorldState,
  createLightUpdatePacket
};
