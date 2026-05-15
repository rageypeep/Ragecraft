const fs = require('node:fs');
const path = require('node:path');

const VERSION = '26.1.2';
const BASE_VERSION = '1.21.11';
const PACKETS_REPORT_PATH = path.join(
  process.cwd(),
  'porting',
  VERSION,
  'generated-reports',
  'reports',
  'packets.json'
);
const BASE_PROTOCOL_PATH = path.join(
  process.cwd(),
  'node_modules',
  'minecraft-data',
  'minecraft-data',
  'data',
  'pc',
  BASE_VERSION,
  'protocol.json'
);
const OUTPUT_PATH = path.join(process.cwd(), 'porting', VERSION, 'play-packet-map.json');

const CLIENTBOUND_NAME_ALIASES = {
  acknowledge_player_digging: 'minecraft:block_changed_ack',
  action_bar: 'minecraft:set_action_bar_text',
  advancements: 'minecraft:update_advancements',
  animation: 'minecraft:animate',
  add_resource_pack: 'minecraft:resource_pack_push',
  attach_entity: 'minecraft:set_entity_link',
  abilities: 'minecraft:player_abilities',
  block_action: 'minecraft:block_event',
  block_break_animation: 'minecraft:block_destruction',
  block_change: 'minecraft:block_update',
  boss_bar: 'minecraft:boss_event',
  camera: 'minecraft:set_camera',
  chat_suggestions: 'minecraft:custom_chat_completions',
  chunk_biomes: 'minecraft:chunks_biomes',
  clear_titles: 'minecraft:clear_titles',
  close_window: 'minecraft:container_close',
  collect: 'minecraft:take_item_entity',
  craft_progress_bar: 'minecraft:container_set_data',
  craft_recipe_response: 'minecraft:place_ghost_recipe',
  declare_recipes: 'minecraft:update_recipes',
  declare_commands: 'minecraft:commands',
  death_combat_event: 'minecraft:player_combat_kill',
  debug_block_value: 'minecraft:debug/block_value',
  debug_chunk_value: 'minecraft:debug/chunk_value',
  debug_entity_value: 'minecraft:debug/entity_value',
  debug_event: 'minecraft:debug/event',
  difficulty: 'minecraft:change_difficulty',
  end_combat_event: 'minecraft:player_combat_end',
  enter_combat_event: 'minecraft:player_combat_enter',
  entity_destroy: 'minecraft:remove_entities',
  entity_effect: 'minecraft:update_mob_effect',
  entity_equipment: 'minecraft:set_equipment',
  entity_head_rotation: 'minecraft:rotate_head',
  entity_look: 'minecraft:move_entity_rot',
  entity_metadata: 'minecraft:set_entity_data',
  entity_move_look: 'minecraft:move_entity_pos_rot',
  entity_sound_effect: 'minecraft:sound_entity',
  entity_status: 'minecraft:entity_event',
  entity_teleport: 'minecraft:teleport_entity',
  entity_update_attributes: 'minecraft:update_attributes',
  entity_velocity: 'minecraft:set_entity_motion',
  explosion: 'minecraft:explode',
  experience: 'minecraft:set_experience',
  face_player: 'minecraft:player_look_at',
  game_state_change: 'minecraft:game_event',
  held_item_slot: 'minecraft:set_held_slot',
  hide_message: 'minecraft:delete_chat',
  initialize_world_border: 'minecraft:initialize_border',
  kick_disconnect: 'minecraft:disconnect',
  map_chunk: 'minecraft:level_chunk_with_light',
  map: 'minecraft:map_item_data',
  move_minecart: 'minecraft:move_minecart_along_track',
  multi_block_change: 'minecraft:section_blocks_update',
  nbt_query_response: 'minecraft:tag_query',
  open_sign_entity: 'minecraft:open_sign_editor',
  open_window: 'minecraft:open_screen',
  open_horse_window: 'minecraft:horse_screen_open',
  ping_response: 'minecraft:pong_response',
  player_info: 'minecraft:player_info_update',
  player_remove: 'minecraft:player_info_remove',
  playerlist_header: 'minecraft:tab_list',
  position: 'minecraft:player_position',
  profileless_chat: 'minecraft:disguised_chat',
  recipe_book_add: 'minecraft:recipe_book_add',
  recipe_book_remove: 'minecraft:recipe_book_remove',
  recipe_book_settings: 'minecraft:recipe_book_settings',
  rel_entity_move: 'minecraft:move_entity_pos',
  remove_entity_effect: 'minecraft:remove_mob_effect',
  remove_resource_pack: 'minecraft:resource_pack_pop',
  scoreboard_display_objective: 'minecraft:set_display_objective',
  scoreboard_objective: 'minecraft:set_objective',
  scoreboard_score: 'minecraft:set_score',
  select_advancement_tab: 'minecraft:select_advancements_tab',
  set_cooldown: 'minecraft:cooldown',
  set_projectile_power: 'minecraft:projectile_power',
  set_slot: 'minecraft:container_set_slot',
  set_ticking_state: 'minecraft:ticking_state',
  set_title_subtitle: 'minecraft:set_subtitle_text',
  set_title_time: 'minecraft:set_titles_animation',
  simulation_distance: 'minecraft:set_simulation_distance',
  sound_effect: 'minecraft:sound',
  spawn_position: 'minecraft:set_default_spawn_position',
  spawn_entity: 'minecraft:add_entity',
  statistics: 'minecraft:award_stats',
  step_tick: 'minecraft:ticking_step',
  sync_entity_position: 'minecraft:entity_position_sync',
  tab_complete: 'minecraft:command_suggestions',
  tags: 'minecraft:update_tags',
  teams: 'minecraft:set_player_team',
  tile_entity_data: 'minecraft:block_entity_data',
  trade_list: 'minecraft:merchant_offers',
  tracked_waypoint: 'minecraft:waypoint',
  unload_chunk: 'minecraft:forget_level_chunk',
  update_health: 'minecraft:set_health',
  update_light: 'minecraft:light_update',
  update_time: 'minecraft:set_time',
  update_view_distance: 'minecraft:set_chunk_cache_radius',
  update_view_position: 'minecraft:set_chunk_cache_center',
  vehicle_move: 'minecraft:move_vehicle',
  window_items: 'minecraft:container_set_content',
  world_border_center: 'minecraft:set_border_center',
  world_border_lerp_size: 'minecraft:set_border_lerp_size',
  world_border_size: 'minecraft:set_border_size',
  world_border_warning_delay: 'minecraft:set_border_warning_delay',
  world_border_warning_reach: 'minecraft:set_border_warning_distance',
  world_event: 'minecraft:level_event',
  world_particles: 'minecraft:level_particles'
};

const SERVERBOUND_NAME_ALIASES = {
  abilities: 'minecraft:player_abilities',
  advancement_tab: 'minecraft:seen_advancements',
  arm_animation: 'minecraft:swing',
  block_place: 'minecraft:use_item_on',
  block_dig: 'minecraft:player_action',
  chat_message: 'minecraft:chat',
  change_gamemode: 'minecraft:change_game_mode',
  close_window: 'minecraft:container_close',
  craft_recipe_request: 'minecraft:place_recipe',
  displayed_recipe: 'minecraft:recipe_book_seen_recipe',
  enchant_item: 'minecraft:container_button_click',
  entity_action: 'minecraft:player_command',
  flying: 'minecraft:move_player_status_only',
  generate_structure: 'minecraft:jigsaw_generate',
  held_item_slot: 'minecraft:set_carried_item',
  look: 'minecraft:move_player_rot',
  message_acknowledgement: 'minecraft:chat_ack',
  name_item: 'minecraft:rename_item',
  position: 'minecraft:move_player_pos',
  position_look: 'minecraft:move_player_pos_rot',
  query_block_nbt: 'minecraft:block_entity_tag_query',
  query_entity_nbt: 'minecraft:entity_tag_query',
  recipe_book: 'minecraft:recipe_book_change_settings',
  resource_pack_receive: 'minecraft:resource_pack',
  select_bundle_item: 'minecraft:bundle_item_selected',
  vehicle_move: 'minecraft:move_vehicle',
  set_slot_state: 'minecraft:container_slot_state_changed',
  set_beacon_effect: 'minecraft:set_beacon',
  set_creative_slot: 'minecraft:set_creative_mode_slot',
  set_difficulty: 'minecraft:change_difficulty',
  settings: 'minecraft:client_information',
  spectate: 'minecraft:teleport_to_entity',
  steer_boat: 'minecraft:paddle_boat',
  tab_complete: 'minecraft:command_suggestion',
  teleport_confirm: 'minecraft:accept_teleportation',
  tick_end: 'minecraft:client_tick_end',
  update_command_block: 'minecraft:set_command_block',
  update_command_block_minecart: 'minecraft:set_command_minecart',
  update_jigsaw_block: 'minecraft:set_jigsaw_block',
  update_sign: 'minecraft:sign_update',
  update_structure_block: 'minecraft:set_structure_block',
  use_entity: 'minecraft:interact',
  window_click: 'minecraft:container_click'
};

const REQUIRED_CLIENTBOUND_PACKETS = [
  'game_state_change',
  'initialize_world_border',
  'keep_alive',
  'map_chunk',
  'login',
  'abilities',
  'position',
  'update_view_position',
  'update_view_distance',
  'spawn_position',
  'simulation_distance'
];

const REQUIRED_SERVERBOUND_PACKETS = [
  'teleport_confirm',
  'tick_end',
  'settings',
  'keep_alive',
  'position',
  'position_look',
  'look',
  'flying',
  'abilities',
  'block_dig',
  'entity_action',
  'player_input',
  'player_loaded'
];

function buildBasePacketMaps(baseProtocol, direction) {
  const packet = baseProtocol.play[direction].types.packet;
  const idToName = packet[1][0].type[1].mappings;
  const nameToId = Object.fromEntries(
    Object.entries(idToName).map(([hexId, name]) => [name, Number.parseInt(hexId, 16)])
  );

  return {
    idToName,
    nameToId
  };
}

function resolveMojangPacketName(baseName, aliasMap, mojangPacketMap) {
  const exactName = `minecraft:${baseName}`;

  if (mojangPacketMap[exactName]) {
    return exactName;
  }

  const alias = aliasMap[baseName];
  return alias && mojangPacketMap[alias] ? alias : null;
}

function buildClientboundPacketIds(baseNameToId, mojangClientbound) {
  const clientboundPacketIds = {};
  const resolvedBaseNames = [];
  const unresolvedBaseNames = [];

  for (const baseName of Object.keys(baseNameToId)) {
    const mojangName = resolveMojangPacketName(baseName, CLIENTBOUND_NAME_ALIASES, mojangClientbound);

    if (!mojangName) {
      unresolvedBaseNames.push(baseName);
      continue;
    }

    clientboundPacketIds[baseName] = mojangClientbound[mojangName].protocol_id;
    resolvedBaseNames.push(baseName);
  }

  return {
    clientboundPacketIds,
    resolvedBaseNames,
    unresolvedBaseNames
  };
}

function buildServerboundPacketRewrites(baseNameToId, mojangServerbound) {
  const serverboundPacketIdRewrites = {};
  const resolvedBaseNames = [];
  const unresolvedBaseNames = [];

  for (const [baseName, baseId] of Object.entries(baseNameToId)) {
    const mojangName = resolveMojangPacketName(baseName, SERVERBOUND_NAME_ALIASES, mojangServerbound);

    if (!mojangName) {
      unresolvedBaseNames.push(baseName);
      continue;
    }

    const targetId = mojangServerbound[mojangName].protocol_id;
    serverboundPacketIdRewrites[targetId] = baseId;
    resolvedBaseNames.push(baseName);
  }

  return {
    serverboundPacketIdRewrites,
    resolvedBaseNames,
    unresolvedBaseNames
  };
}

function assertRequiredMappings(requiredPacketNames, mappedPacketNames, label) {
  const missingPacketNames = requiredPacketNames.filter((packetName) => !mappedPacketNames.includes(packetName));

  if (missingPacketNames.length > 0) {
    throw new Error(
      `Generated ${label} map is missing required packets: ${missingPacketNames.join(', ')}`
    );
  }
}

function buildPacketMap() {
  const packetsReport = JSON.parse(fs.readFileSync(PACKETS_REPORT_PATH, 'utf8'));
  const baseProtocol = JSON.parse(fs.readFileSync(BASE_PROTOCOL_PATH, 'utf8'));
  const clientboundBase = buildBasePacketMaps(baseProtocol, 'toClient');
  const serverboundBase = buildBasePacketMaps(baseProtocol, 'toServer');
  const clientboundResult = buildClientboundPacketIds(
    clientboundBase.nameToId,
    packetsReport.play.clientbound
  );
  const serverboundResult = buildServerboundPacketRewrites(
    serverboundBase.nameToId,
    packetsReport.play.serverbound
  );

  assertRequiredMappings(
    REQUIRED_CLIENTBOUND_PACKETS,
    clientboundResult.resolvedBaseNames,
    'clientbound'
  );
  assertRequiredMappings(
    REQUIRED_SERVERBOUND_PACKETS,
    serverboundResult.resolvedBaseNames,
    'serverbound'
  );

  return {
    advertisedVersion: VERSION,
    baseVersion: BASE_VERSION,
    generatedAt: new Date().toISOString(),
    sourcePacketsReport: PACKETS_REPORT_PATH,
    coverage: {
      clientbound: {
        resolved: Object.keys(clientboundResult.clientboundPacketIds).length,
        unresolved: clientboundResult.unresolvedBaseNames.length
      },
      serverbound: {
        resolved: Object.keys(serverboundResult.serverboundPacketIdRewrites).length,
        unresolved: serverboundResult.unresolvedBaseNames.length
      }
    },
    clientboundPacketIds: clientboundResult.clientboundPacketIds,
    serverboundPacketIdRewrites: serverboundResult.serverboundPacketIdRewrites,
    unresolvedBaseNames: {
      clientbound: clientboundResult.unresolvedBaseNames,
      serverbound: serverboundResult.unresolvedBaseNames
    }
  };
}

function main() {
  if (!fs.existsSync(PACKETS_REPORT_PATH)) {
    throw new Error(`Missing ${PACKETS_REPORT_PATH}. Generate Mojang reports first.`);
  }

  if (!fs.existsSync(BASE_PROTOCOL_PATH)) {
    throw new Error(`Missing ${BASE_PROTOCOL_PATH}. Install project dependencies first.`);
  }

  const packetMap = buildPacketMap();
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(packetMap, null, 2)}\n`);
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(
    `Resolved ${packetMap.coverage.clientbound.resolved} clientbound and ${packetMap.coverage.serverbound.resolved} serverbound play packets.`
  );
}

main();
