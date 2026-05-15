const fs = require('node:fs');
const path = require('node:path');

const VERSION = '26.1.2';
const ROOT = process.cwd();
const PORTING_DIR = path.join(ROOT, 'porting', VERSION);
const PACKET_MAP_PATH = path.join(PORTING_DIR, 'play-packet-map.json');
const TAGS_PATH = path.join(PORTING_DIR, 'configuration-tags.json');
const REGISTRY_OVERRIDES_PATH = path.join(PORTING_DIR, 'registry-overrides.json');
const VERSION_DETAIL_PATH = path.join(PORTING_DIR, 'version-detail-full.json');
const SERVER_PATH = path.join(ROOT, 'src', 'server.js');
const OUTPUT_PATH = path.join(PORTING_DIR, 'compatibility-report.md');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort();
}

function extractClientboundPacketNames(source) {
  const packetNames = [];
  const packetRegex = /writePlayPacket\(\s*client\s*,\s*'([^']+)'/g;

  for (const match of source.matchAll(packetRegex)) {
    packetNames.push(match[1]);
  }

  return uniqueSorted(packetNames);
}

function extractServerboundPacketNames(source) {
  const eventNames = [];
  const eventRegex = /client\.on\(\s*'([^']+)'/g;

  for (const match of source.matchAll(eventRegex)) {
    eventNames.push(match[1]);
  }

  return uniqueSorted(eventNames.filter((name) => !name.startsWith('raw.')));
}

function toMojangPacketNames(packetNames, aliasMap) {
  return packetNames.map((packetName) => aliasMap[packetName] ?? `minecraft:${packetName}`);
}

function formatList(items) {
  return items.length > 0 ? items.map((item) => `- \`${item}\``).join('\n') : '- none';
}

function buildClientboundTable(packetNames, packetMap) {
  const rows = packetNames.map((name) => {
    const mappedId = packetMap.clientboundPacketIds[name];
    return `| \`${name}\` | ${mappedId ?? 'missing'} |`;
  });

  return [
    '| Packet | 26.1.2 id |',
    '|---|---:|',
    ...rows
  ].join('\n');
}

function buildServerboundTable(packetNames, packetMap) {
  const rows = packetNames.map((name) => {
    const mojangId = Object.entries(packetMap.serverboundPacketIdRewrites)
      .find(([, baseId]) => packetMap.baseProtocolServerboundNameToId?.[name] === baseId)?.[0];
    return `| \`${name}\` | ${mojangId ?? 'n/a'} |`;
  });

  return [
    '| Packet | 26.1.2 id observed by rewriter |',
    '|---|---:|',
    ...rows
  ].join('\n');
}

function main() {
  const packetMap = readJson(PACKET_MAP_PATH);
  const tags = readJson(TAGS_PATH);
  const registryOverrides = readJson(REGISTRY_OVERRIDES_PATH);
  const versionDetail = readJson(VERSION_DETAIL_PATH);
  const serverSource = fs.readFileSync(SERVER_PATH, 'utf8');
  const compatibilitySource = fs.readFileSync(path.join(ROOT, 'scripts', 'generate-2612-packet-map.js'), 'utf8');
  const baseProtocol = readJson(path.join(
    ROOT,
    'node_modules',
    'minecraft-data',
    'minecraft-data',
    'data',
    'pc',
    packetMap.baseVersion,
    'protocol.json'
  ));
  const serverboundMappings = baseProtocol.play.toServer.types.packet[1][0].type[1].mappings;
  const baseProtocolServerboundNameToId = Object.fromEntries(
    Object.entries(serverboundMappings).map(([hexId, name]) => [name, Number.parseInt(hexId, 16)])
  );

  const clientboundAliasMatch = compatibilitySource.match(/const CLIENTBOUND_NAME_ALIASES = ({[\s\S]*?^});/m);
  const serverboundAliasMatch = compatibilitySource.match(/const SERVERBOUND_NAME_ALIASES = ({[\s\S]*?^});/m);

  const clientboundAliases = clientboundAliasMatch ? Function(`return (${clientboundAliasMatch[1]})`)() : {};
  const serverboundAliases = serverboundAliasMatch ? Function(`return (${serverboundAliasMatch[1]})`)() : {};

  const clientboundPacketNames = extractClientboundPacketNames(serverSource);
  const serverboundPacketNames = extractServerboundPacketNames(serverSource)
    .filter((name) =>
      name in baseProtocolServerboundNameToId ||
      name in serverboundAliases ||
      ['chat', 'chat_message', 'block_dig', 'block_place', 'held_item_slot'].includes(name)
    );

  const report = [
    `# ${VERSION} Compatibility Report`,
    '',
    `Generated: \`${new Date().toISOString()}\``,
    '',
    '## Confirmed Protocol Baseline',
    '',
    `- Advertised Minecraft version: \`${packetMap.advertisedVersion}\``,
    `- Wire protocol: \`775\``,
    `- Compatibility packet base: \`${packetMap.baseVersion}\``,
    `- Java runtime in Mojang metadata: \`${versionDetail.javaVersion?.majorVersion ?? 'unknown'}\``,
    '',
    '## Generated Compatibility Artifacts',
    '',
    `- Play packet map coverage: ${packetMap.coverage.clientbound.resolved} clientbound, ${packetMap.coverage.serverbound.resolved} serverbound`,
    `- Dynamic registry overrides: ${Object.keys(registryOverrides.registries ?? {}).length}`,
    `- Configuration tag types: ${tags.tags.length}`,
    '',
    '### Registry Overrides',
    '',
    formatList(Object.keys(registryOverrides.registries ?? {})),
    '',
    '### Unresolved Play Packet Base Names',
    '',
    `- Clientbound: ${packetMap.unresolvedBaseNames.clientbound.join(', ') || 'none'}`,
    `- Serverbound: ${packetMap.unresolvedBaseNames.serverbound.join(', ') || 'none'}`,
    '',
    '## Clientbound Packets Used By Ragecraft',
    '',
    buildClientboundTable(clientboundPacketNames, packetMap),
    '',
    '### Mojang Packet Names Used Clientbound',
    '',
    formatList(toMojangPacketNames(clientboundPacketNames, clientboundAliases)),
    '',
    '## Serverbound Packets Handled By Ragecraft',
    '',
    buildServerboundTable(serverboundPacketNames, {
      ...packetMap,
      baseProtocolServerboundNameToId
    }),
    '',
    '### Mojang Packet Names Handled Serverbound',
    '',
    formatList(toMojangPacketNames(serverboundPacketNames, serverboundAliases)),
    '',
    '## Notes',
    '',
    '- This report is generated from local Mojang packet reports plus the live Ragecraft source tree.',
    '- It documents the concrete compatibility surface currently in use instead of hand-maintained notes.'
  ].join('\n');

  fs.writeFileSync(OUTPUT_PATH, `${report}\n`);
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
