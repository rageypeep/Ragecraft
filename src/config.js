const DEFAULTS = {
  host: '0.0.0.0',
  port: 25565,
  version: '26.1.2',
  motd: 'Ragecraft Node Server',
  maxPlayers: 20,
  onlineMode: false,
  encryption: false,
  viewDistance: 10,
  isFlat: false,
  worldSavePath: 'data/world.json',
  welcomeMessage: 'Welcome to Ragecraft, {username}.',
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
  const mergedSpawn = {
    x: readNumber('MC_SPAWN_X', DEFAULTS.spawn.x),
    y: readNumber('MC_SPAWN_Y', DEFAULTS.spawn.y),
    z: readNumber('MC_SPAWN_Z', DEFAULTS.spawn.z),
    yaw: readNumber('MC_SPAWN_YAW', DEFAULTS.spawn.yaw),
    pitch: readNumber('MC_SPAWN_PITCH', DEFAULTS.spawn.pitch),
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
    spawn: mergedSpawn
  };
}

module.exports = {
  DEFAULTS,
  loadConfig
};
