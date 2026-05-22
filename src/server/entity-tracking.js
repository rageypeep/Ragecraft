const { createHash } = require('node:crypto');

function toAngleByte(angle = 0) {
  return Math.floor((((angle % 360) + 360) % 360) * 256 / 360) & 0xff;
}

function toSignedAngleByte(angle = 0) {
  const unsigned = toAngleByte(angle);
  return unsigned > 127 ? unsigned - 256 : unsigned;
}

function toRelativeMoveDelta(current = 0, previous = 0) {
  return Math.round((current - previous) * 4096);
}

function buildOfflineUuid(username) {
  const source = Buffer.from(`OfflinePlayer:${username}`, 'utf8');
  const digest = createHash('md5').update(source).digest();

  digest[6] = (digest[6] & 0x0f) | 0x30;
  digest[8] = (digest[8] & 0x3f) | 0x80;

  const hex = digest.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createTrackedPlayerProfile(client) {
  return {
    entityId: client.id,
    uuid: client.uuid ?? client.profile?.id ?? buildOfflineUuid(client.username),
    username: client.username
  };
}

function createPlayerTracker({
  connectedClients,
  mcData,
  writePlayPacket
}) {
  const playerEntityTypeId = mcData.entitiesByName.player.id;

  function sendPlayerInfoPacket(observer, target) {
    writePlayPacket(observer, 'player_info', {
      action: {
        add_player: true,
        update_game_mode: true,
        update_listed: true,
        update_latency: true
      },
      data: [{
        uuid: target.trackedProfile.uuid,
        player: {
          name: target.username,
          properties: []
        },
        gamemode: 0,
        listed: 1,
        latency: 0
      }]
    });
  }

  function sendPlayerRemovePacket(observer, target) {
    writePlayPacket(observer, 'player_remove', {
      players: [target.trackedProfile.uuid]
    });
  }

  function sendSpawnPacket(observer, target) {
    if (!target.playerPosition || !target.trackedProfile) {
      return;
    }

    writePlayPacket(observer, 'spawn_entity', {
      entityId: target.trackedProfile.entityId,
      objectUUID: target.trackedProfile.uuid,
      type: playerEntityTypeId,
      x: target.playerPosition.x,
      y: target.playerPosition.y,
      z: target.playerPosition.z,
      velocity: {
        x: 0,
        y: 0,
        z: 0
      },
      pitch: toSignedAngleByte(target.playerPosition.pitch),
      yaw: toSignedAngleByte(target.playerPosition.yaw),
      headPitch: toSignedAngleByte(target.playerPosition.pitch),
      objectData: 0
    });

    writePlayPacket(observer, 'entity_head_rotation', {
      entityId: target.trackedProfile.entityId,
      headYaw: toSignedAngleByte(target.playerPosition.yaw)
    });
  }

  function registerPlayer(client) {
    client.trackedProfile = createTrackedPlayerProfile(client);
  }

  function syncPlayersForClient(client) {
    for (const otherClient of connectedClients()) {
      if (otherClient === client || !otherClient.trackedProfile || !otherClient.playerPosition) {
        continue;
      }

      sendPlayerInfoPacket(client, otherClient);
      sendSpawnPacket(client, otherClient);
    }

    if (client.trackedProfile) {
      sendPlayerInfoPacket(client, client);
    }
  }

  function broadcastJoin(client) {
    for (const otherClient of connectedClients(client)) {
      if (!otherClient.trackedProfile) {
        continue;
      }

      sendPlayerInfoPacket(otherClient, client);
      sendSpawnPacket(otherClient, client);
    }
  }

  function broadcastLeave(client) {
    for (const otherClient of connectedClients(client)) {
      if (!otherClient.trackedProfile) {
        continue;
      }

      writePlayPacket(otherClient, 'entity_destroy', {
        entityIds: [client.trackedProfile.entityId]
      });
      sendPlayerRemovePacket(otherClient, client);
    }
  }

  function broadcastTeleport(client) {
    if (!client.trackedProfile || !client.playerPosition) {
      return;
    }

    for (const otherClient of connectedClients(client)) {
      if (!otherClient.trackedProfile) {
        continue;
      }

      writePlayPacket(otherClient, 'entity_teleport', {
        entityId: client.trackedProfile.entityId,
        x: client.playerPosition.x,
        y: client.playerPosition.y,
        z: client.playerPosition.z,
        yaw: toSignedAngleByte(client.playerPosition.yaw),
        pitch: toSignedAngleByte(client.playerPosition.pitch),
        onGround: false
      });
      writePlayPacket(otherClient, 'entity_head_rotation', {
        entityId: client.trackedProfile.entityId,
        headYaw: toSignedAngleByte(client.playerPosition.yaw)
      });
    }
  }

  function broadcastMovement(client, previousPosition) {
    if (!client.trackedProfile || !client.playerPosition || !previousPosition) {
      return;
    }

    const dX = toRelativeMoveDelta(client.playerPosition.x, previousPosition.x);
    const dY = toRelativeMoveDelta(client.playerPosition.y, previousPosition.y);
    const dZ = toRelativeMoveDelta(client.playerPosition.z, previousPosition.z);
    const moved = dX !== 0 || dY !== 0 || dZ !== 0;
    const yaw = toSignedAngleByte(client.playerPosition.yaw);
    const pitch = toSignedAngleByte(client.playerPosition.pitch);
    const previousYaw = toSignedAngleByte(previousPosition.yaw);
    const previousPitch = toSignedAngleByte(previousPosition.pitch);
    const rotated = yaw !== previousYaw || pitch !== previousPitch;
    const requiresTeleport = Math.abs(dX) > 32767 || Math.abs(dY) > 32767 || Math.abs(dZ) > 32767;

    for (const otherClient of connectedClients(client)) {
      if (!otherClient.trackedProfile) {
        continue;
      }

      if (requiresTeleport) {
        writePlayPacket(otherClient, 'entity_teleport', {
          entityId: client.trackedProfile.entityId,
          x: client.playerPosition.x,
          y: client.playerPosition.y,
          z: client.playerPosition.z,
          yaw,
          pitch,
          onGround: false
        });
      } else if (moved && rotated) {
        writePlayPacket(otherClient, 'entity_move_look', {
          entityId: client.trackedProfile.entityId,
          dX,
          dY,
          dZ,
          yaw,
          pitch,
          onGround: false
        });
      } else if (moved) {
        writePlayPacket(otherClient, 'rel_entity_move', {
          entityId: client.trackedProfile.entityId,
          dX,
          dY,
          dZ,
          onGround: false
        });
      } else if (rotated) {
        writePlayPacket(otherClient, 'entity_look', {
          entityId: client.trackedProfile.entityId,
          yaw,
          pitch,
          onGround: false
        });
      }

      if (rotated) {
        writePlayPacket(otherClient, 'entity_head_rotation', {
          entityId: client.trackedProfile.entityId,
          headYaw: yaw
        });
      }
    }
  }

  return {
    broadcastJoin,
    broadcastLeave,
    broadcastMovement,
    broadcastTeleport,
    registerPlayer,
    syncPlayersForClient
  };
}

module.exports = {
  createPlayerTracker
};
