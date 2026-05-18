const fs = require('fs');
const http = require('http');
const path = require('path');
const biomes = require('../biomes');
const { getColumnDebugData, resolveWorldOptions } = require('../world/generation');

const DEFAULT_HOST = process.env.MC_DEBUG_MAP_HOST ?? '127.0.0.1';
const DEFAULT_PORT = Number.parseInt(process.env.MC_DEBUG_MAP_PORT ?? '3001', 10);
const DEFAULT_ENABLED = process.env.MC_DEBUG_MAP_ENABLED !== 'false';
const PAGE_PATH = path.join(__dirname, 'world-map.html');

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getBiomeDebugEntries() {
  const waterBiomeColors = {
    cold_ocean: '#3e6fb4',
    frozen_ocean: '#87b9e8',
    lake: '#4d88cf',
    lukewarm_ocean: '#4f91d8',
    ocean: '#467fc5',
    river: '#5a95db',
    warm_ocean: '#67a7ea'
  };
  const entries = Object.entries(biomes).flatMap(([moduleKey, biomeModule]) => {
    const metadata = biomeModule?.metadata;

    if (!metadata?.key) {
      return [];
    }

    const color = waterBiomeColors[metadata.key] ??
      metadata.grassColor ??
      metadata.foliageColor ??
      metadata.waterColor ??
      '#888888';

    return [[metadata.key, {
      color,
      key: metadata.key,
      label: metadata.label ?? moduleKey
    }]];
  });

  return Object.fromEntries(entries);
}

function buildSampleGrid({ cellsX, cellsZ, centerX, centerZ, spawn, step, surfaceY, worldOptions }) {
  const normalizedCellsX = clamp(cellsX, 8, 256);
  const normalizedCellsZ = clamp(cellsZ, 8, 256);
  const normalizedStep = clamp(step, 1, 128);
  const startX = centerX - Math.floor(normalizedCellsX / 2) * normalizedStep;
  const startZ = centerZ - Math.floor(normalizedCellsZ / 2) * normalizedStep;
  const samples = [];

  for (let row = 0; row < normalizedCellsZ; row++) {
    for (let column = 0; column < normalizedCellsX; column++) {
      const worldX = startX + (column * normalizedStep);
      const worldZ = startZ + (row * normalizedStep);
      const sample = getColumnDebugData(worldOptions, surfaceY, spawn, worldX, worldZ);
      samples.push(sample);
    }
  }

  return {
    cellsX: normalizedCellsX,
    cellsZ: normalizedCellsZ,
    samples,
    startX,
    startZ,
    step: normalizedStep
  };
}

function findNearestBiome({ biomeKey, originX, originZ, radius, spawn, step, surfaceY, worldOptions }) {
  const normalizedRadius = clamp(radius, 64, 32768);
  const normalizedStep = clamp(step, 1, 128);
  const originSample = getColumnDebugData(worldOptions, surfaceY, spawn, originX, originZ);

  if (originSample.biomeKey === biomeKey) {
    return originSample;
  }

  for (let ring = normalizedStep; ring <= normalizedRadius; ring += normalizedStep) {
    const minX = originX - ring;
    const maxX = originX + ring;
    const minZ = originZ - ring;
    const maxZ = originZ + ring;

    for (let x = minX; x <= maxX; x += normalizedStep) {
      for (const z of [minZ, maxZ]) {
        const sample = getColumnDebugData(worldOptions, surfaceY, spawn, x, z);

        if (sample.biomeKey === biomeKey) {
          return sample;
        }
      }
    }

    for (let z = minZ + normalizedStep; z <= maxZ - normalizedStep; z += normalizedStep) {
      for (const x of [minX, maxX]) {
        const sample = getColumnDebugData(worldOptions, surfaceY, spawn, x, z);

        if (sample.biomeKey === biomeKey) {
          return sample;
        }
      }
    }
  }

  return null;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, html) {
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/html; charset=utf-8'
  });
  response.end(html);
}

function createWorldMapServer({ config, protocolDataVersion, world }) {
  if (!DEFAULT_ENABLED) {
    return null;
  }

  const host = DEFAULT_HOST;
  const port = Number.isInteger(DEFAULT_PORT) ? DEFAULT_PORT : 3001;
  const mcData = require('minecraft-data')(protocolDataVersion);
  const worldOptions = resolveWorldOptions(mcData, config);
  const biomeEntries = getBiomeDebugEntries();
  const pageHtml = fs.readFileSync(PAGE_PATH, 'utf8');
  let listening = false;

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host ?? `${host}:${port}`}`);

    if (requestUrl.pathname === '/' || requestUrl.pathname === '/world-map') {
      sendHtml(response, pageHtml);
      return;
    }

    if (requestUrl.pathname === '/api/biomes') {
      sendJson(response, 200, {
        biomes: biomeEntries,
        seaLevel: world.surfaceY - 1,
        spawn: world.spawnReference
      });
      return;
    }

    if (requestUrl.pathname === '/api/sample') {
      const centerX = Number.parseInt(requestUrl.searchParams.get('centerX') ?? `${world.spawnReference.x}`, 10);
      const centerZ = Number.parseInt(requestUrl.searchParams.get('centerZ') ?? `${world.spawnReference.z}`, 10);
      const cellsX = Number.parseInt(requestUrl.searchParams.get('cellsX') ?? '128', 10);
      const cellsZ = Number.parseInt(requestUrl.searchParams.get('cellsZ') ?? '128', 10);
      const step = Number.parseInt(requestUrl.searchParams.get('step') ?? '16', 10);
      const grid = buildSampleGrid({
        cellsX,
        cellsZ,
        centerX,
        centerZ,
        spawn: world.spawnReference,
        step,
        surfaceY: world.surfaceY,
        worldOptions
      });

      sendJson(response, 200, {
        ...grid,
        seaLevel: world.surfaceY - 1,
        spawn: world.spawnReference
      });
      return;
    }

    if (requestUrl.pathname === '/api/find-biome') {
      const biomeKey = `${requestUrl.searchParams.get('biomeKey') ?? ''}`.trim();

      if (!biomeKey) {
        sendJson(response, 400, { error: 'Missing biomeKey.' });
        return;
      }

      const originX = Number.parseInt(requestUrl.searchParams.get('originX') ?? `${world.spawnReference.x}`, 10);
      const originZ = Number.parseInt(requestUrl.searchParams.get('originZ') ?? `${world.spawnReference.z}`, 10);
      const radius = Number.parseInt(requestUrl.searchParams.get('radius') ?? '8192', 10);
      const step = Number.parseInt(requestUrl.searchParams.get('step') ?? '16', 10);
      const match = findNearestBiome({
        biomeKey,
        originX,
        originZ,
        radius,
        spawn: world.spawnReference,
        step,
        surfaceY: world.surfaceY,
        worldOptions
      });

      if (!match) {
        sendJson(response, 404, {
          biomeKey,
          error: `No ${biomeKey} sample found within ${radius} blocks at step ${step}.`
        });
        return;
      }

      sendJson(response, 200, {
        biomeKey,
        match,
        seaLevel: world.surfaceY - 1,
        tpCommand: `/tp ${match.worldX} ${Math.max(match.waterTopY ?? match.topY, match.topY) + 2} ${match.worldZ}`
      });
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });

  return {
    close() {
      if (!listening) {
        return Promise.resolve();
      }

      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          listening = false;
          resolve();
        });
      });
    },
    host,
    port,
    start() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          listening = true;
          resolve();
        });
      });
    },
    url: `http://${host}:${port}/world-map`
  };
}

module.exports = {
  createWorldMapServer
};
