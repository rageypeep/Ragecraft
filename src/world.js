const Chunk = require('prismarine-chunk')('1.21.11');
const { SmartBuffer } = require('smart-buffer');
const Vec3 = require('vec3');

const HEIGHTMAP_TYPES = [
  'world_surface_wg',
  'world_surface',
  'ocean_floor_wg',
  'ocean_floor',
  'motion_blocking',
  'motion_blocking_no_leaves'
];

const PLATFORM_CHUNK_RADIUS = 2;
const PLATFORM_THICKNESS = 4;
const SAFE_SURFACE_Y = 95;
const BUILD_HEIGHT = 32;
const FACE_OFFSETS = {
  0: { x: 0, y: -1, z: 0 },
  1: { x: 0, y: 1, z: 0 },
  2: { x: 0, y: 0, z: -1 },
  3: { x: 0, y: 0, z: 1 },
  4: { x: -1, y: 0, z: 0 },
  5: { x: 1, y: 0, z: 0 }
};

function normalizePosition(position) {
  if (!position) {
    return null;
  }

  return {
    x: Math.floor(position.x),
    y: Math.floor(position.y),
    z: Math.floor(position.z)
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getSpawnChunk(spawn) {
  return {
    x: Math.floor(spawn.x / 16),
    z: Math.floor(spawn.z / 16)
  };
}

function getSurfaceY(spawnY) {
  const probeChunk = new Chunk();
  const minSurfaceY = probeChunk.minY + 1;
  const maxSurfaceY = probeChunk.minY + probeChunk.worldHeight - 1;
  const requestedSurfaceY = Math.floor(spawnY) - 1;
  return clamp(Math.min(requestedSurfaceY, SAFE_SURFACE_Y), minSurfaceY, maxSurfaceY);
}

function packHeightmap(heightValues, worldHeight) {
  const bitsPerEntry = Math.ceil(Math.log2(worldHeight + 1));
  const entriesPerLong = Math.floor(64 / bitsPerEntry);
  const longs = [];
  let current = 0n;
  let used = 0;

  for (let index = 0; index < heightValues.length; index++) {
    const normalizedHeight = BigInt(heightValues[index]);
    current |= normalizedHeight << BigInt(used * bitsPerEntry);
    used += 1;

    if (used === entriesPerLong || index === heightValues.length - 1) {
      longs.push(current);
      current = 0n;
      used = 0;
    }
  }

  return longs;
}

function createFlatChunk(mcData, surfaceY) {
  const chunk = new Chunk();
  const topBlockStateId = mcData.blocksByName.grass_block?.defaultState ?? mcData.blocksByName.dirt.defaultState;
  const fillBlockStateId = mcData.blocksByName.dirt.defaultState;
  const floorStartY = surfaceY - (PLATFORM_THICKNESS - 1);

  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      for (let y = floorStartY; y < surfaceY; y++) {
        chunk.setBlockStateId(new Vec3(x, y, z), fillBlockStateId);
      }

      chunk.setBlockStateId(new Vec3(x, surfaceY, z), topBlockStateId);

      for (let y = chunk.minY; y < chunk.minY + chunk.worldHeight; y++) {
        chunk.setSkyLight(new Vec3(x, y, z), 15);
      }
    }
  }

  return chunk;
}

function createChunkLightTemplate(chunk) {
  const light = chunk.dumpLight();

  return {
    skyLightMask: light.skyLightMask,
    blockLightMask: light.blockLightMask,
    emptySkyLightMask: light.emptySkyLightMask,
    emptyBlockLightMask: light.emptyBlockLightMask,
    skyLight: light.skyLight.map((section) => Array.from(section)),
    blockLight: light.blockLight.map((section) => Array.from(section))
  };
}

function createHeightmapData(chunk, fallbackSurfaceY) {
  const minY = chunk.minY;
  const maxY = chunk.minY + chunk.worldHeight - 1;
  const airStateId = 0;
  const heightValues = [];

  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      let topY = fallbackSurfaceY;

      for (let y = maxY; y >= minY; y--) {
        if (chunk.getBlockStateId(new Vec3(x, y, z)) !== airStateId) {
          topY = y;
          break;
        }
      }

      heightValues.push(topY - minY + 1);
    }
  }

  return HEIGHTMAP_TYPES.map((type) => ({
    type,
    data: packHeightmap(heightValues, chunk.worldHeight)
  }));
}

function createChunkTemplate(chunk, surfaceY) {
  return {
    heightmaps: createHeightmapData(chunk, surfaceY),
    chunkData: encodeChunkData(chunk),
    blockEntities: []
  };
}

function encodeChunkData(chunk) {
  const buffer = new SmartBuffer();

  for (let index = 0; index < chunk.sections.length; index++) {
    const section = chunk.sections[index];
    const biome = chunk.biomes[index];

    buffer.writeInt16BE(section?.solidBlockCount ?? 0);
    buffer.writeInt16BE(0);
    section.data.write(buffer);
    biome.write(buffer);
  }

  return buffer.toBuffer();
}

function createChunkPacket(x, z, template) {
  return {
    x,
    z,
    heightmaps: template.heightmaps,
    chunkData: template.chunkData,
    blockEntities: template.blockEntities,
    skyLightMask: template.skyLightMask,
    blockLightMask: template.blockLightMask,
    emptySkyLightMask: template.emptySkyLightMask,
    emptyBlockLightMask: template.emptyBlockLightMask,
    skyLight: template.skyLight,
    blockLight: template.blockLight
  };
}

function getChunkKey(chunkX, chunkZ) {
  return `${chunkX},${chunkZ}`;
}

function getBlockKey(position) {
  const normalizedPosition = normalizePosition(position);
  return `${normalizedPosition.x},${normalizedPosition.y},${normalizedPosition.z}`;
}

function toChunkCoordinates(position) {
  const { x, y, z } = normalizePosition(position);
  const chunkX = Math.floor(x / 16);
  const chunkZ = Math.floor(z / 16);

  return {
    chunkX,
    chunkZ,
    localPosition: new Vec3(x - (chunkX * 16), y, z - (chunkZ * 16)),
    worldPosition: { x, y, z }
  };
}

function createInitialWorldPackets(mcData, config, savedWorldState = { blocks: [] }) {
  const spawnChunk = getSpawnChunk(config.spawn);
  const surfaceY = getSurfaceY(config.spawn.y);
  const minChunkX = spawnChunk.x - PLATFORM_CHUNK_RADIUS;
  const maxChunkX = spawnChunk.x + PLATFORM_CHUNK_RADIUS;
  const minChunkZ = spawnChunk.z - PLATFORM_CHUNK_RADIUS;
  const maxChunkZ = spawnChunk.z + PLATFORM_CHUNK_RADIUS;
  const minX = minChunkX * 16;
  const maxX = ((maxChunkX + 1) * 16) - 1;
  const minZ = minChunkZ * 16;
  const maxZ = ((maxChunkZ + 1) * 16) - 1;
  const floorStartY = surfaceY - (PLATFORM_THICKNESS - 1);
  const maxBuildY = surfaceY + BUILD_HEIGHT;
  const topBlockStateId = mcData.blocksByName.grass_block?.defaultState ?? mcData.blocksByName.dirt.defaultState;
  const fillBlockStateId = mcData.blocksByName.dirt.defaultState;
  const placementBlockStateId = topBlockStateId;
  const airBlockStateId = mcData.blocksByName.air.defaultState;
  const lightTemplate = createChunkLightTemplate(createFlatChunk(mcData, surfaceY));
  const chunks = new Map();
  const modifiedBlocks = new Map();

  for (let dz = -PLATFORM_CHUNK_RADIUS; dz <= PLATFORM_CHUNK_RADIUS; dz++) {
    for (let dx = -PLATFORM_CHUNK_RADIUS; dx <= PLATFORM_CHUNK_RADIUS; dx++) {
      const chunkX = spawnChunk.x + dx;
      const chunkZ = spawnChunk.z + dz;
      const chunk = createFlatChunk(mcData, surfaceY);

      chunks.set(getChunkKey(chunkX, chunkZ), { chunkX, chunkZ, chunk });
    }
  }

  function isWithinPlatformBounds(position) {
    const normalizedPosition = normalizePosition(position);

    if (!normalizedPosition) {
      return false;
    }

    return (
      normalizedPosition.x >= minX &&
      normalizedPosition.x <= maxX &&
      normalizedPosition.z >= minZ &&
      normalizedPosition.z <= maxZ &&
      normalizedPosition.y >= floorStartY &&
      normalizedPosition.y <= surfaceY
    );
  }

  function isWithinBuildBounds(position) {
    const normalizedPosition = normalizePosition(position);

    if (!normalizedPosition) {
      return false;
    }

    return (
      normalizedPosition.x >= minX &&
      normalizedPosition.x <= maxX &&
      normalizedPosition.z >= minZ &&
      normalizedPosition.z <= maxZ &&
      normalizedPosition.y >= floorStartY &&
      normalizedPosition.y <= maxBuildY
    );
  }

  function getChunkEntry(position) {
    const coordinates = toChunkCoordinates(position);
    const chunkEntry = chunks.get(getChunkKey(coordinates.chunkX, coordinates.chunkZ));

    if (!chunkEntry) {
      return null;
    }

    return {
      ...coordinates,
      chunkEntry
    };
  }

  function getBaseBlockState(position) {
    if (!isWithinBuildBounds(position)) {
      return airBlockStateId;
    }

    if (!isWithinPlatformBounds(position)) {
      return airBlockStateId;
    }

    return Math.floor(position.y) === surfaceY
      ? topBlockStateId
      : fillBlockStateId;
  }

  function getBlockState(position) {
    if (!isWithinBuildBounds(position)) {
      return airBlockStateId;
    }

    const chunkEntry = getChunkEntry(position);

    if (!chunkEntry) {
      return airBlockStateId;
    }

    return chunkEntry.chunkEntry.chunk.getBlockStateId(chunkEntry.localPosition);
  }

  function setBlockState(position, stateId) {
    if (!isWithinBuildBounds(position)) {
      return false;
    }

    const chunkEntry = getChunkEntry(position);

    if (!chunkEntry) {
      return false;
    }

    chunkEntry.chunkEntry.chunk.setBlockStateId(chunkEntry.localPosition, stateId);

    const worldPosition = normalizePosition(chunkEntry.worldPosition);
    const baseStateId = getBaseBlockState(worldPosition);
    const blockKey = getBlockKey(worldPosition);

    if (stateId === baseStateId) {
      modifiedBlocks.delete(blockKey);
    } else {
      modifiedBlocks.set(blockKey, {
        ...worldPosition,
        stateId
      });
    }

    return true;
  }

  function breakBlock(position) {
    if (!isWithinBuildBounds(position)) {
      return null;
    }

    const currentStateId = getBlockState(position);

    if (currentStateId === airBlockStateId) {
      return null;
    }

    const blockDefinition = mcData.blocksByStateId[currentStateId];
    const droppedItemId = blockDefinition?.drops?.[0];
    const normalizedPosition = normalizePosition(position);

    if (!setBlockState(normalizedPosition, airBlockStateId)) {
      return null;
    }

    return {
      droppedItem: Number.isInteger(droppedItemId)
        ? { itemId: droppedItemId, count: 1 }
        : null,
      position: normalizedPosition,
      stateId: currentStateId
    };
  }

  function placeBlock(position, stateId = placementBlockStateId) {
    const normalizedPosition = normalizePosition(position);

    if (!isWithinBuildBounds(normalizedPosition)) {
      return false;
    }

    if (getBlockState(normalizedPosition) !== airBlockStateId) {
      return false;
    }

    return setBlockState(normalizedPosition, stateId);
  }

  function createChunkPackets() {
    return Array.from(chunks.values()).map(({ chunkX, chunkZ, chunk }) =>
      createChunkPacket(chunkX, chunkZ, {
        ...createChunkTemplate(chunk, surfaceY),
        ...lightTemplate
      })
    );
  }

  function resolvePlacedBlockLocation(position, direction) {
    const normalizedPosition = normalizePosition(position);
    const offset = FACE_OFFSETS[direction];

    if (!normalizedPosition || !offset) {
      return null;
    }

    return {
      x: normalizedPosition.x + offset.x,
      y: normalizedPosition.y + offset.y,
      z: normalizedPosition.z + offset.z
    };
  }

  function serialize() {
    return {
      blocks: Array.from(modifiedBlocks.values())
    };
  }

  function getModifiedBlocks() {
    return Array.from(modifiedBlocks.values());
  }

  for (const block of savedWorldState.blocks ?? []) {
    setBlockState(block, block.stateId);
  }

  return {
    airBlockStateId,
    breakBlock,
    chunks: createChunkPackets(),
    createChunkPackets,
    fillBlockStateId,
    floorStartY,
    getBlockState,
    isWithinBuildBounds,
    isWithinPlatformBounds,
    maxX,
    maxZ,
    maxBuildY,
    minX,
    minZ,
    placementBlockStateId,
    placeBlock,
    resolvePlacedBlockLocation,
    getModifiedBlocks,
    serialize,
    setBlockState,
    surfaceY,
    spawnChunk,
    topBlockStateId
  };
}

module.exports = {
  createInitialWorldPackets
};
