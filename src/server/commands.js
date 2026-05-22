function createLiteralCommandNode(name, childIndexes = []) {
  return {
    flags: {
      command_node_type: 1,
      has_command: 0,
      has_redirect_node: 0,
      has_custom_suggestions: 0,
      allows_restricted: 0
    },
    children: childIndexes,
    extraNodeData: {
      name
    }
  };
}

function createVec3ArgumentCommandNode(name) {
  return {
    flags: {
      command_node_type: 2,
      has_command: 1,
      has_redirect_node: 0,
      has_custom_suggestions: 0,
      allows_restricted: 0
    },
    children: [],
    extraNodeData: {
      name,
      parser: 'minecraft:vec3'
    }
  };
}

function createCommandDeclarationPacket() {
  return {
    nodes: [
      {
        flags: {
          command_node_type: 0,
          has_command: 0,
          has_redirect_node: 0,
          has_custom_suggestions: 0,
          allows_restricted: 0
        },
        children: [1, 3, 5, 6, 7, 14, 15]
      },
      createLiteralCommandNode('tp', [2]),
      createVec3ArgumentCommandNode('location'),
      createLiteralCommandNode('teleport', [4]),
      createVec3ArgumentCommandNode('location'),
      {
        ...createLiteralCommandNode('spawn'),
        flags: {
          ...createLiteralCommandNode('spawn').flags,
          has_command: 1
        }
      },
      {
        ...createLiteralCommandNode('help'),
        flags: {
          ...createLiteralCommandNode('help').flags,
          has_command: 1
        }
      },
      createLiteralCommandNode('time', [8, 9]),
      createLiteralCommandNode('set', [10, 11, 12, 13]),
      {
        ...createLiteralCommandNode('query'),
        flags: {
          ...createLiteralCommandNode('query').flags,
          has_command: 1
        }
      },
      {
        ...createLiteralCommandNode('day'),
        flags: {
          ...createLiteralCommandNode('day').flags,
          has_command: 1
        }
      },
      {
        ...createLiteralCommandNode('noon'),
        flags: {
          ...createLiteralCommandNode('noon').flags,
          has_command: 1
        }
      },
      {
        ...createLiteralCommandNode('night'),
        flags: {
          ...createLiteralCommandNode('night').flags,
          has_command: 1
        }
      },
      {
        ...createLiteralCommandNode('midnight'),
        flags: {
          ...createLiteralCommandNode('midnight').flags,
          has_command: 1
        }
      },
      {
        ...createLiteralCommandNode('craft'),
        flags: {
          ...createLiteralCommandNode('craft').flags,
          has_command: 1
        }
      },
      {
        ...createLiteralCommandNode('recipes'),
        flags: {
          ...createLiteralCommandNode('recipes').flags,
          has_command: 1
        }
      }
    ],
    rootIndex: 0
  };
}

function parseTeleportCoordinate(token, baseValue) {
  if (typeof token !== 'string' || !Number.isFinite(baseValue)) {
    return null;
  }

  if (token === '~') {
    return baseValue;
  }

  if (token.startsWith('~')) {
    const offset = token.slice(1);

    if (!offset) {
      return baseValue;
    }

    const numericOffset = Number(offset);
    return Number.isFinite(numericOffset) ? baseValue + numericOffset : null;
  }

  const absoluteValue = Number(token);
  return Number.isFinite(absoluteValue) ? absoluteValue : null;
}

function createCommandApi({
  config,
  crafting,
  saveWorld,
  sendMessage,
  sendFullInventoryState,
  server,
  teleportClient,
  updateWorldTime,
  world
}) {
  function sendUsage(client) {
    sendMessage(
      [client],
      'Commands: /help, /spawn, /tp <x> <y> <z>, /teleport <x> <y> <z>, /time query, /time set <day|noon|night|midnight|ticks>, /save, /recipes <item>, /craft <item> [times]',
      'Server',
      'system'
    );
  }

  function tryHandleRecipesCommand(client, tokens) {
    if (!crafting) {
      sendMessage([client], 'Crafting recipes are not available on this server build.', 'Server', 'system');
      return true;
    }

    const itemName = tokens.shift()?.toLowerCase();

    if (!itemName) {
      sendMessage(
        [client],
        `Loaded ${crafting.getRecipeCount()} vanilla crafting recipes. Usage: /recipes <item_name>`,
        'Server',
        'system'
      );
      return true;
    }

    const summaries = crafting.listRecipeSummaries(itemName);

    if (summaries.length === 0) {
      sendMessage([client], `No crafting recipes found for ${itemName}.`, 'Server', 'system');
      return true;
    }

    for (const summary of summaries.slice(0, 6)) {
      sendMessage([client], summary, 'Server', 'system');
    }

    if (summaries.length > 6) {
      sendMessage([client], `...and ${summaries.length - 6} more recipe variants.`, 'Server', 'system');
    }

    return true;
  }

  function tryHandleCraftCommand(client, tokens) {
    if (!crafting) {
      sendMessage([client], 'Crafting is not available on this server build.', 'Server', 'system');
      return true;
    }

    const itemName = tokens.shift()?.toLowerCase();

    if (!itemName) {
      sendMessage([client], 'Usage: /craft <item_name> [times]', 'Server', 'system');
      return true;
    }

    const timesToken = tokens.shift();
    const times = timesToken ? Number.parseInt(timesToken, 10) : 1;

    if (!Number.isInteger(times) || times <= 0) {
      sendMessage([client], 'Craft count must be a positive integer.', 'Server', 'system');
      return true;
    }

    const craftResult = crafting.craftItem(client.inventoryState, itemName, times);

    if (!craftResult) {
      sendMessage([client], `Unable to craft ${itemName} with the items currently in your inventory.`, 'Server', 'system');
      return true;
    }

    sendFullInventoryState(client);

    saveWorld();
    sendMessage(
      [client],
      `Crafted ${craftResult.outputCount}x ${craftResult.recipe.result.name} using ${craftResult.craftedExecutions} recipe execution(s).`,
      'Server',
      'system'
    );
    return true;
  }

  function tryHandleTimeCommand(client, tokens) {
    const subcommand = tokens.shift()?.toLowerCase();

    if (subcommand === 'query') {
      sendMessage([client], `World time: ${server.worldTimeState.time}.`, 'Server', 'system');
      return true;
    }

    if (subcommand !== 'set') {
      sendMessage([client], 'Usage: /time query or /time set <day|noon|night|midnight|ticks>', 'Server', 'system');
      return true;
    }

    const valueToken = tokens.shift()?.toLowerCase();

    if (!valueToken) {
      sendMessage([client], 'Usage: /time set <day|noon|night|midnight|ticks>', 'Server', 'system');
      return true;
    }

    const namedTimes = {
      day: 1000n,
      noon: 6000n,
      night: 13000n,
      midnight: 18000n
    };
    let nextTime = namedTimes[valueToken];

    if (nextTime === undefined) {
      const numericTime = Number.parseInt(valueToken, 10);

      if (!Number.isInteger(numericTime)) {
        sendMessage([client], `Invalid time value: ${valueToken}`, 'Server', 'system');
        return true;
      }

      nextTime = BigInt(((numericTime % 24000) + 24000) % 24000);
    }

    updateWorldTime(nextTime);
    sendMessage([client], `Set world time to ${nextTime}.`, 'Server', 'system');
    return true;
  }

  function tryHandlePlayerCommand(client, rawMessage) {
    if (typeof rawMessage !== 'string' || !rawMessage.startsWith('/')) {
      return false;
    }

    const tokens = rawMessage.slice(1).trim().split(/\s+/).filter(Boolean);

    if (tokens.length === 0) {
      return true;
    }

    const command = tokens.shift()?.toLowerCase();

    if (command === 'help') {
      sendUsage(client);
      return true;
    }

    if (command === 'spawn') {
      teleportClient(client, world.safeSpawn);
      sendMessage([client], 'Teleported to spawn.', 'Server', 'system');
      return true;
    }

    if (command === 'save') {
      saveWorld();
      sendMessage([client], 'World and player state saved.', 'Server', 'system');
      return true;
    }

    if (command === 'recipes') {
      return tryHandleRecipesCommand(client, tokens);
    }

    if (command === 'craft') {
      return tryHandleCraftCommand(client, tokens);
    }

    if (command === 'time') {
      return tryHandleTimeCommand(client, tokens);
    }

    if (command !== 'tp' && command !== 'teleport') {
      sendMessage([client], `Unknown command: /${command}`, 'Server', 'system');
      return true;
    }

    if (tokens[0] === '@s') {
      tokens.shift();
    }

    if (tokens.length !== 3) {
      sendMessage([client], 'Usage: /tp [@s] <x> <y> <z> (supports ~ relative coordinates)', 'Server', 'system');
      return true;
    }

    const currentPosition = client.playerPosition ?? {
      x: 0,
      y: config.spawn.y,
      z: 0
    };
    const x = parseTeleportCoordinate(tokens[0], currentPosition.x ?? 0);
    const y = parseTeleportCoordinate(tokens[1], currentPosition.y ?? config.spawn.y);
    const z = parseTeleportCoordinate(tokens[2], currentPosition.z ?? 0);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      sendMessage([client], 'Invalid teleport coordinates.', 'Server', 'system');
      return true;
    }

    teleportClient(client, { x, y, z });
    sendMessage([client], `Teleported to ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)}.`, 'Server', 'system');
    return true;
  }

  return {
    createCommandDeclarationPacket,
    tryHandlePlayerCommand
  };
}

module.exports = {
  createCommandApi
};
