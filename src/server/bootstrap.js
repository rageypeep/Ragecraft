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

function buildPlayerBootstrapPackets(client, config, world, loginPacket) {
  const login = {
    ...loginPacket,
    enforceSecureChat: false,
    entityId: client.id,
    isHardcore: false,
    gameMode: 0,
    previousGameMode: 1,
    hashedSeed: [0, 0],
    maxPlayers: config.maxPlayers,
    viewDistance: config.viewDistance,
    simulationDistance: config.viewDistance,
    reducedDebugInfo: false,
    enableRespawnScreen: true,
    isDebug: false,
    isFlat: true,
    worldState: {
      ...loginPacket.worldState,
      isFlat: true,
      seaLevel: world.surfaceY + 1
    }
  };

  return {
    abilities: {
      flags: 0x02,
      flyingSpeed: 0.05,
      walkingSpeed: 0.1
    },
    border: {
      x: config.spawn.x,
      z: config.spawn.z,
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
    position: {
      teleportId: 0,
      x: config.spawn.x,
      y: config.spawn.y,
      z: config.spawn.z,
      dx: 0,
      dy: 0,
      dz: 0,
      yaw: config.spawn.yaw,
      pitch: config.spawn.pitch,
      flags: 0x00
    },
    simulationDistance: {
      distance: config.viewDistance
    },
    spawnPosition: {
      globalPos: {
        dimensionName: 'minecraft:overworld',
        location: {
          x: Math.floor(config.spawn.x),
          y: world.surfaceY + 1,
          z: Math.floor(config.spawn.z)
        }
      },
      yaw: config.spawn.yaw,
      pitch: config.spawn.pitch
    },
    viewDistance: {
      viewDistance: config.viewDistance
    },
    viewPosition: {
      chunkX: world.spawnChunk.x,
      chunkZ: world.spawnChunk.z
    }
  };
}

module.exports = {
  buildPlayerBootstrapPackets,
  createLightUpdatePacket
};
