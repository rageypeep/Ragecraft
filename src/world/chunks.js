const { SmartBuffer } = require('smart-buffer');
const Vec3 = require('vec3');
const { createChunk } = require('./chunk-factory');

const HEIGHTMAP_TYPES = [
  'world_surface_wg',
  'world_surface',
  'ocean_floor_wg',
  'ocean_floor',
  'motion_blocking',
  'motion_blocking_no_leaves'
];

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

function countSectionFluidBlocks(chunk, sectionIndex, fluidStateId, maxFluidStateId = fluidStateId) {
  if (!Number.isInteger(fluidStateId) || !Number.isInteger(maxFluidStateId)) {
    return 0;
  }

  const sectionBaseY = chunk.minY + (sectionIndex * 16);
  let count = 0;

  for (let localY = 0; localY < 16; localY++) {
    for (let localZ = 0; localZ < 16; localZ++) {
      for (let localX = 0; localX < 16; localX++) {
        const stateId = chunk.getBlockStateId(new Vec3(localX, sectionBaseY + localY, localZ));

        if (stateId >= fluidStateId && stateId <= maxFluidStateId) {
          count += 1;
        }
      }
    }
  }

  return count;
}

function encodeChunkData(chunk, worldOptions) {
  const buffer = new SmartBuffer();
  const includeFluidCount = worldOptions?.chunkSectionIncludesFluidCount === true;

  for (let index = 0; index < chunk.sections.length; index++) {
    const section = chunk.sections[index];
    const biome = chunk.biomes[index];

    if (includeFluidCount) {
      buffer.writeInt16BE(section.solidBlockCount ?? 0);
      buffer.writeInt16BE(countSectionFluidBlocks(
        chunk,
        index,
        worldOptions?.terrainBlockStateIds?.water,
        worldOptions?.terrainBlockStateIds?.waterMax
      ));
      section.data.write(buffer);
      biome.write(buffer);
      continue;
    }

    section.write(buffer);
    biome.write(buffer);
  }

  return buffer.toBuffer();
}

function createChunkTemplate(chunk, surfaceY, worldOptions) {
  return {
    heightmaps: createHeightmapData(chunk, surfaceY),
    chunkData: encodeChunkData(chunk, worldOptions),
    blockEntities: []
  };
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

function createTranslatedChunk(sourceChunk, translateStateId) {
  const translatedChunk = createChunk({
    minWorldY: sourceChunk.minY,
    worldHeight: sourceChunk.worldHeight
  });

  for (let y = sourceChunk.minY; y < sourceChunk.minY + sourceChunk.worldHeight; y++) {
    for (let localZ = 0; localZ < 16; localZ++) {
      for (let localX = 0; localX < 16; localX++) {
        const position = new Vec3(localX, y, localZ);
        const stateId = sourceChunk.getBlockStateId(position);

        if (stateId !== 0) {
          translatedChunk.setBlockStateId(position, translateStateId(stateId));
        }

        translatedChunk.setSkyLight(position, sourceChunk.getSkyLight(position));
        translatedChunk.setBlockLight(position, sourceChunk.getBlockLight(position));
      }
    }
  }

  for (let y = sourceChunk.minY; y < sourceChunk.minY + sourceChunk.worldHeight; y += 4) {
    for (let localZ = 0; localZ < 16; localZ += 4) {
      for (let localX = 0; localX < 16; localX += 4) {
        const position = new Vec3(localX, y, localZ);
        translatedChunk.setBiome(position, sourceChunk.getBiome(position));
      }
    }
  }

  return translatedChunk;
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

module.exports = {
  createChunkLightTemplate,
  createChunkPacket,
  createChunkTemplate,
  createTranslatedChunk
};
