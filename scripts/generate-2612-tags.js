const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const minecraftData = require('minecraft-data');
const {
  buildCompatibilityRegistryCodec,
  loadCompatibilityRegistryOverrides
} = require('../src/compatibility-registry');
const { resolveVersionTarget } = require('../src/versioning');

const VERSION = '26.1.2';
const JAR_PATH = path.join(process.cwd(), 'porting', VERSION, 'server-26.1.2.jar');
const OUTPUT_PATH = path.join(process.cwd(), 'porting', VERSION, 'configuration-tags.json');
const REGISTRY_DUMP_PATH = path.join(
  process.cwd(),
  'porting',
  VERSION,
  'generated-reports',
  'reports',
  'registries.json'
);

function listJarEntries(jarPath) {
  const output = execFileSync('tar', ['-tf', jarPath], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  return output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readJarEntryJson(jarPath, entryPath) {
  const output = execFileSync('tar', ['-xOf', jarPath, entryPath], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  return JSON.parse(output);
}

function normalizeRegistryTagPath(registryId) {
  return registryId.replace('minecraft:', '');
}

function loadRegistryProtocolEntries() {
  if (!fs.existsSync(REGISTRY_DUMP_PATH)) {
    throw new Error(
      `Missing ${REGISTRY_DUMP_PATH}. Generate the official 26.1.2 reports before rebuilding tags.`
    );
  }

  const registries = JSON.parse(fs.readFileSync(REGISTRY_DUMP_PATH, 'utf8'));
  const protocolEntriesByRegistry = new Map();

  for (const [registryId, registry] of Object.entries(registries)) {
    if (!registry?.entries || typeof registry.entries !== 'object') {
      continue;
    }

    const entryIndexes = new Map();

    for (const [entryId, entry] of Object.entries(registry.entries)) {
      if (typeof entry?.protocol_id === 'number') {
        entryIndexes.set(entryId, entry.protocol_id);
      }
    }

    if (entryIndexes.size > 0) {
      protocolEntriesByRegistry.set(registryId, entryIndexes);
    }
  }

  return protocolEntriesByRegistry;
}

function loadDynamicRegistryEntries() {
  const versionTarget = resolveVersionTarget(VERSION);
  const mcData = minecraftData(versionTarget.protocolDataVersion);
  const baseCodec = mcData.loginPacket?.dimensionCodec || mcData.registryCodec || {};
  const overrides = loadCompatibilityRegistryOverrides(VERSION);
  const codec = buildCompatibilityRegistryCodec(baseCodec, overrides);
  const dynamicEntriesByRegistry = new Map();

  for (const [registryId, registry] of Object.entries(codec)) {
    if (!Array.isArray(registry?.entries)) {
      continue;
    }

    dynamicEntriesByRegistry.set(
      registryId,
      new Map(registry.entries.map((entry, index) => [entry.key, index]))
    );
  }

  return dynamicEntriesByRegistry;
}

function buildRegistryTagDefinitions(jarPath, registryId, entryPaths) {
  const tagPrefix = `data/minecraft/tags/${normalizeRegistryTagPath(registryId)}/`;
  const tagFiles = entryPaths.filter(
    (entryPath) => entryPath.startsWith(tagPrefix) && entryPath.endsWith('.json')
  );

  const definitions = new Map();

  for (const tagFile of tagFiles) {
    const relativeTagPath = tagFile.slice(tagPrefix.length, -'.json'.length);
    const tagName = `minecraft:${relativeTagPath.replace(/\\/g, '/')}`;
    const definition = readJarEntryJson(jarPath, tagFile);
    definitions.set(tagName, Array.isArray(definition.values) ? definition.values : []);
  }

  return definitions;
}

function expandTag(definitions, tagName, entryIndexes, stack = new Set()) {
  if (stack.has(tagName)) {
    throw new Error(`Circular tag reference detected: ${[...stack, tagName].join(' -> ')}`);
  }

  const values = definitions.get(tagName) ?? [];
  const nextStack = new Set(stack);
  nextStack.add(tagName);

  const indexes = new Set();

  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    if (value.startsWith('#')) {
      const nestedTag = value.slice(1);

      for (const index of expandTag(definitions, nestedTag, entryIndexes, nextStack)) {
        indexes.add(index);
      }

      continue;
    }

    const entryIndex = entryIndexes.get(value);

    if (entryIndex !== undefined) {
      indexes.add(entryIndex);
    }
  }

  return [...indexes].sort((left, right) => left - right);
}

function buildConfigurationTags() {
  const entryPaths = listJarEntries(JAR_PATH);
  const protocolEntriesByRegistry = loadRegistryProtocolEntries();
  const dynamicEntriesByRegistry = loadDynamicRegistryEntries();
  const tags = [];

  for (const [registryId, entryIndexes] of dynamicEntriesByRegistry.entries()) {
    if (!protocolEntriesByRegistry.has(registryId) || protocolEntriesByRegistry.get(registryId).size === 0) {
      protocolEntriesByRegistry.set(registryId, entryIndexes);
    }
  }

  for (const [registryId, entryIndexes] of [...protocolEntriesByRegistry.entries()].sort()) {
    const definitions = buildRegistryTagDefinitions(JAR_PATH, registryId, entryPaths);

    if (definitions.size === 0) {
      continue;
    }

    const registryTags = [];

    for (const tagName of [...definitions.keys()].sort()) {
      const entries = expandTag(definitions, tagName, entryIndexes);

      registryTags.push({
        tagName,
        entries
      });
    }

    tags.push({
      tagType: registryId,
      tags: registryTags
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceJar: JAR_PATH,
    registryDump: REGISTRY_DUMP_PATH,
    advertisedVersion: VERSION,
    tags
  };
}

function main() {
  if (!fs.existsSync(JAR_PATH)) {
    throw new Error(`Missing ${JAR_PATH}. Extract the inner 26.1.2 server jar first.`);
  }

  const payload = buildConfigurationTags();
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
