const DEFAULTS = {
  host: '0.0.0.0',
  port: 25565,
  version: '26.1.2',
  motd: 'Ragecraft Node Server',
  maxPlayers: 20,
  onlineMode: false,
  encryption: false,
  viewDistance: 4,
  isFlat: false,
  worldSavePath: 'data/world.json',
  welcomeMessage: 'Welcome to Ragecraft, {username}.',
  world: {
    biome: 'taiga',
    mixedBiomes: true,
    seed: 'peterdeacon1234',
    chunkRadius: 1,
    streamRadius: null,
    minY: -64,
    worldHeight: 384,
    foundationBlock: 'stone',
    soilBlock: 'dirt',
    surfaceBlock: 'grass_block',
    terrainAmplitude: 4,
    terrainThickness: 12
  },
  spawn: {
    x: 0,
    y: 96,
    z: 0,
    yaw: 0,
    pitch: 0
  }
};

function readNumber(name, fallback) {
  const rawValue = process.env[name];

  if (rawValue === undefined) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  if (Number.isNaN(parsedValue)) {
    throw new Error(`Environment variable ${name} must be a number. Received "${rawValue}".`);
  }

  return parsedValue;
}

function readBoolean(name, fallback) {
  const rawValue = process.env[name];

  if (rawValue === undefined) {
    return fallback;
  }

  if (rawValue === 'true') {
    return true;
  }

  if (rawValue === 'false') {
    return false;
  }

  throw new Error(`Environment variable ${name} must be "true" or "false". Received "${rawValue}".`);
}

function loadConfig(overrides = {}) {
  const hasExplicitSpawnX = process.env.MC_SPAWN_X !== undefined ||
    Object.prototype.hasOwnProperty.call(overrides.spawn ?? {}, 'x');
  const hasExplicitSpawnZ = process.env.MC_SPAWN_Z !== undefined ||
    Object.prototype.hasOwnProperty.call(overrides.spawn ?? {}, 'z');
  const useConfiguredSpawnPosition = hasExplicitSpawnX || hasExplicitSpawnZ;
  const mergedWorld = {
    biome: process.env.MC_WORLD_BIOME ?? DEFAULTS.world.biome,
    mixedBiomes: readBoolean('MC_WORLD_MIXED_BIOMES', DEFAULTS.world.mixedBiomes),
    seed: process.env.MC_WORLD_SEED ?? DEFAULTS.world.seed,
    chunkRadius: readNumber('MC_WORLD_CHUNK_RADIUS', DEFAULTS.world.chunkRadius),
    streamRadius: process.env.MC_WORLD_STREAM_RADIUS === undefined
      ? DEFAULTS.world.streamRadius
      : readNumber('MC_WORLD_STREAM_RADIUS', DEFAULTS.viewDistance),
    minY: readNumber('MC_WORLD_MIN_Y', DEFAULTS.world.minY),
    worldHeight: readNumber('MC_WORLD_HEIGHT', DEFAULTS.world.worldHeight),
    foundationBlock: process.env.MC_FOUNDATION_BLOCK ?? DEFAULTS.world.foundationBlock,
    soilBlock: process.env.MC_SOIL_BLOCK ?? DEFAULTS.world.soilBlock,
    surfaceBlock: process.env.MC_SURFACE_BLOCK ?? DEFAULTS.world.surfaceBlock,
    terrainAmplitude: readNumber('MC_TERRAIN_AMPLITUDE', DEFAULTS.world.terrainAmplitude),
    terrainThickness: readNumber('MC_TERRAIN_THICKNESS', DEFAULTS.world.terrainThickness),
    ...(overrides.world ?? {})
  };
  const mergedSpawn = {
    x: readNumber('MC_SPAWN_X', DEFAULTS.spawn.x),
    y: readNumber('MC_SPAWN_Y', DEFAULTS.spawn.y),
    z: readNumber('MC_SPAWN_Z', DEFAULTS.spawn.z),
    yaw: readNumber('MC_SPAWN_YAW', DEFAULTS.spawn.yaw),
    pitch: readNumber('MC_SPAWN_PITCH', DEFAULTS.spawn.pitch),
    useConfiguredPosition: useConfiguredSpawnPosition,
    ...(overrides.spawn ?? {})
  };

  return {
    host: process.env.MC_HOST ?? DEFAULTS.host,
    port: readNumber('MC_PORT', DEFAULTS.port),
    version: process.env.MC_VERSION ?? DEFAULTS.version,
    motd: process.env.MC_MOTD ?? DEFAULTS.motd,
    maxPlayers: readNumber('MC_MAX_PLAYERS', DEFAULTS.maxPlayers),
    onlineMode: readBoolean('MC_ONLINE_MODE', DEFAULTS.onlineMode),
    encryption: readBoolean('MC_ENCRYPTION', DEFAULTS.encryption),
    viewDistance: readNumber('MC_VIEW_DISTANCE', DEFAULTS.viewDistance),
    isFlat: readBoolean('MC_IS_FLAT', DEFAULTS.isFlat),
    worldSavePath: process.env.MC_WORLD_SAVE_PATH ?? DEFAULTS.worldSavePath,
    welcomeMessage: process.env.MC_WELCOME_MESSAGE ?? DEFAULTS.welcomeMessage,
    ...overrides,
    world: mergedWorld,
    spawn: mergedSpawn
  };
}

module.exports = {
  DEFAULTS,
  loadConfig
};
