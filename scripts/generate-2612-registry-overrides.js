const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const VERSION = '26.1.2';
const JAR_PATH = path.join(process.cwd(), 'porting', VERSION, 'server-26.1.2.jar');
const OUTPUT_PATH = path.join(process.cwd(), 'porting', VERSION, 'registry-overrides.json');

const TARGET_REGISTRIES = {
  'minecraft:cat_sound_variant': 'cat_sound_variant',
  'minecraft:cat_variant': 'cat_variant',
  'minecraft:chicken_sound_variant': 'chicken_sound_variant',
  'minecraft:chicken_variant': 'chicken_variant',
  'minecraft:cow_sound_variant': 'cow_sound_variant',
  'minecraft:cow_variant': 'cow_variant',
  'minecraft:dimension_type': 'dimension_type',
  'minecraft:enchantment': 'enchantment',
  'minecraft:pig_sound_variant': 'pig_sound_variant',
  'minecraft:pig_variant': 'pig_variant',
  'minecraft:timeline': 'timeline',
  'minecraft:world_clock': 'world_clock',
  'minecraft:wolf_sound_variant': 'wolf_sound_variant',
  'minecraft:wolf_variant': 'wolf_variant'
};

function listJarEntries(jarPath) {
  return execFileSync('tar', ['-tf', jarPath], {
    cwd: process.cwd(),
    encoding: 'utf8'
  })
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

function buildOverrides() {
  const entries = listJarEntries(JAR_PATH);
  const registries = {};

  for (const [registryId, folderName] of Object.entries(TARGET_REGISTRIES)) {
    const prefix = `data/minecraft/${folderName}/`;
    const files = entries
      .filter((entry) => entry.startsWith(prefix) && entry.endsWith('.json'))
      .sort();

    registries[registryId] = {};

    for (const file of files) {
      const name = file.slice(prefix.length, -'.json'.length);
      registries[registryId][`minecraft:${name}`] = readJarEntryJson(JAR_PATH, file);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceJar: JAR_PATH,
    advertisedVersion: VERSION,
    registries
  };
}

function main() {
  if (!fs.existsSync(JAR_PATH)) {
    throw new Error(`Missing ${JAR_PATH}. Extract the inner 26.1.2 server jar first.`);
  }

  const payload = buildOverrides();
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
