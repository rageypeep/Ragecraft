const { Transform } = require('node:stream');
const { createSerializer } = require('minecraft-protocol/src/transforms/serializer');
const { readVarInt, writeVarInt } = require('./probe/varint');

const COMPATIBILITY_PLAY_PACKET_MAPS = {
  '26.1.2': require('../porting/26.1.2/play-packet-map.json')
};

const serializerCache = new Map();
const RECIPE_BOOK_CATEGORY_IDS_2612 = {
  crafting_building_blocks: 0,
  crafting_redstone: 1,
  crafting_equipment: 2,
  crafting_misc: 3,
  furnace_food: 4,
  furnace_blocks: 5,
  furnace_misc: 6,
  blast_furnace_blocks: 7,
  blast_furnace_misc: 8,
  smoker_food: 9,
  stonecutter: 10,
  smithing: 11,
  campfire: 12
};
const RECIPE_DISPLAY_TYPE_IDS_2612 = {
  crafting_shapeless: 0,
  crafting_shaped: 1
};
const SLOT_DISPLAY_TYPE_IDS_2612 = {
  empty: 0,
  item: 4,
  item_stack: 5
};

function getCompatibilityPlayPacketMap(advertisedVersion) {
  return COMPATIBILITY_PLAY_PACKET_MAPS[advertisedVersion] ?? null;
}

function getPlaySerializer(baseVersion) {
  if (!serializerCache.has(baseVersion)) {
    serializerCache.set(
      baseVersion,
      createSerializer({
        isServer: true,
        state: 'play',
        version: baseVersion
      })
    );
  }

  return serializerCache.get(baseVersion);
}

function is2612Compatibility(server) {
  return server.compatibility?.advertisedVersion === '26.1.2';
}

function rewritePacketId(buffer, newPacketId) {
  const packetId = readVarInt(buffer, 0);

  if (!packetId) {
    throw new Error('Unable to decode packet id from compatibility packet buffer.');
  }

  return Buffer.concat([
    writeVarInt(newPacketId),
    buffer.subarray(packetId.size)
  ]);
}

function writeBool(value) {
  return Buffer.from([value ? 1 : 0]);
}

function writeByte(value) {
  return Buffer.from([value & 0xff]);
}

function writeOptionalVarInt(value) {
  if (!Number.isInteger(value)) {
    return writeBool(false);
  }

  return Buffer.concat([
    writeBool(true),
    writeVarInt(value)
  ]);
}

function writeEmptyDataComponentPatch() {
  return Buffer.concat([
    writeVarInt(0),
    writeVarInt(0)
  ]);
}

function encode2612SlotDisplay(slotDisplay) {
  const type = slotDisplay?.type;
  const typeId = SLOT_DISPLAY_TYPE_IDS_2612[type];

  if (!Number.isInteger(typeId)) {
    throw new Error(`Unsupported 26.1.2 slot display type "${type}".`);
  }

  if (type === 'empty') {
    return writeVarInt(typeId);
  }

  if (type === 'item') {
    return Buffer.concat([
      writeVarInt(typeId),
      writeVarInt(slotDisplay.data)
    ]);
  }

  if (type === 'item_stack') {
    const item = slotDisplay.data ?? {};

    return Buffer.concat([
      writeVarInt(typeId),
      writeVarInt(item.itemId),
      writeVarInt(item.itemCount ?? 1),
      writeEmptyDataComponentPatch()
    ]);
  }

  throw new Error(`Unhandled 26.1.2 slot display type "${type}".`);
}

function encode2612RecipeDisplay(recipeDisplay) {
  const type = recipeDisplay?.type;
  const typeId = RECIPE_DISPLAY_TYPE_IDS_2612[type];

  if (!Number.isInteger(typeId)) {
    throw new Error(`Unsupported 26.1.2 recipe display type "${type}".`);
  }

  const data = recipeDisplay?.data ?? {};

  if (type === 'crafting_shapeless') {
    const ingredients = data.ingredients ?? [];

    return Buffer.concat([
      writeVarInt(typeId),
      writeVarInt(ingredients.length),
      ...ingredients.map((ingredient) => encode2612SlotDisplay(ingredient)),
      encode2612SlotDisplay(data.result),
      encode2612SlotDisplay(data.craftingStation)
    ]);
  }

  if (type === 'crafting_shaped') {
    const ingredients = data.ingredients ?? [];

    return Buffer.concat([
      writeVarInt(typeId),
      writeVarInt(data.width ?? 0),
      writeVarInt(data.height ?? 0),
      writeVarInt(ingredients.length),
      ...ingredients.map((ingredient) => encode2612SlotDisplay(ingredient)),
      encode2612SlotDisplay(data.result),
      encode2612SlotDisplay(data.craftingStation)
    ]);
  }

  throw new Error(`Unhandled 26.1.2 recipe display type "${type}".`);
}

function encode2612RecipeBookAddEntry(entry) {
  const recipe = entry?.recipe ?? {};
  const categoryId = RECIPE_BOOK_CATEGORY_IDS_2612[recipe.category];

  if (!Number.isInteger(categoryId)) {
    throw new Error(`Unsupported 26.1.2 recipe book category "${recipe.category}".`);
  }

  const flags = (
    (entry?.flags?.notification ? 1 : 0) |
    (entry?.flags?.highlight ? 2 : 0)
  );

  return Buffer.concat([
    writeVarInt(recipe.displayId ?? 0),
    encode2612RecipeDisplay(recipe.display),
    writeOptionalVarInt(recipe.group),
    writeVarInt(categoryId),
    writeBool(false),
    writeByte(flags)
  ]);
}

function build2612RecipeBookAddPacket(packetId, params = {}) {
  const entries = Array.isArray(params.entries) ? params.entries : [];

  return Buffer.concat([
    writeVarInt(packetId),
    writeVarInt(entries.length),
    ...entries.map((entry) => encode2612RecipeBookAddEntry(entry)),
    writeBool(Boolean(params.replace))
  ]);
}

function build2612SetTimePacket(packetId, params = {}) {
  const gameTimeValue = params.time ?? params.gameTime ?? 0n;
  const gameTime = typeof gameTimeValue === 'bigint' ? gameTimeValue : BigInt(gameTimeValue);
  const payload = Buffer.alloc(9);

  payload.writeBigInt64BE(gameTime, 0);
  payload[8] = 0; // empty clockUpdates map

  return Buffer.concat([
    writeVarInt(packetId),
    payload
  ]);
}

function rewriteIncomingPlayPacketBuffer(buffer, advertisedVersion) {
  const packetId = readVarInt(buffer, 0);

  if (!packetId) {
    return buffer;
  }

  const rewrittenPacketId = getCompatibilityPlayPacketMap(advertisedVersion)
    ?.serverboundPacketIdRewrites?.[packetId.value];

  if (rewrittenPacketId === undefined || rewrittenPacketId === packetId.value) {
    return buffer;
  }

  return rewritePacketId(buffer, rewrittenPacketId);
}

function createCompatibilityInboundPlayPacketRewriter(advertisedVersion) {
  return new Transform({
    transform(chunk, encoding, callback) {
      try {
        callback(null, rewriteIncomingPlayPacketBuffer(chunk, advertisedVersion));
      } catch (error) {
        callback(error);
      }
    }
  });
}

function buildCompatibilityPlayPacket(baseVersion, packetName, params, advertisedVersion) {
  const targetPacketId = getCompatibilityPlayPacketMap(advertisedVersion)
    ?.clientboundPacketIds?.[packetName];

  if (targetPacketId === undefined) {
    throw new Error(
      `No compatibility packet id override exists for ${advertisedVersion} play packet "${packetName}".`
    );
  }

  if (advertisedVersion === '26.1.2' && packetName === 'update_time') {
    return build2612SetTimePacket(targetPacketId, params);
  }

  if (advertisedVersion === '26.1.2' && packetName === 'recipe_book_add') {
    return build2612RecipeBookAddPacket(targetPacketId, params);
  }

  const serializer = getPlaySerializer(baseVersion);
  const baseBuffer = serializer.createPacketBuffer({
    name: packetName,
    params
  });

  return rewritePacketId(baseBuffer, targetPacketId);
}

function writeCompatibilityLoginPacket(client, server, params) {
  writeCompatibilityPlayPacket(client, server, 'login', params);
}

function writeCompatibilityPositionPacket(client, server, params) {
  writeCompatibilityPlayPacket(client, server, 'position', params);
}

function writeCompatibilityPlayPacket(client, server, packetName, params) {
  client.writeRaw(
    buildCompatibilityPlayPacket(
      server.protocolDataVersion,
      packetName,
      params,
      server.advertisedVersion
    )
  );
}

module.exports = {
  buildCompatibilityPlayPacket,
  createCompatibilityInboundPlayPacketRewriter,
  getCompatibilityPlayPacketMap,
  is2612Compatibility,
  rewriteIncomingPlayPacketBuffer,
  writeCompatibilityPlayPacket,
  writeCompatibilityLoginPacket,
  writeCompatibilityPositionPacket
};
