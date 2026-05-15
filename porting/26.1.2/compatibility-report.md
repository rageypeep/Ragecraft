# 26.1.2 Compatibility Report

Generated: `2026-05-15T13:53:10.758Z`

## Confirmed Protocol Baseline

- Advertised Minecraft version: `26.1.2`
- Wire protocol: `775`
- Compatibility packet base: `1.21.11`
- Java runtime in Mojang metadata: `25`

## Generated Compatibility Artifacts

- Play packet map coverage: 138 clientbound, 66 serverbound
- Dynamic registry overrides: 14
- Configuration tag types: 15

### Registry Overrides

- `minecraft:cat_sound_variant`
- `minecraft:cat_variant`
- `minecraft:chicken_sound_variant`
- `minecraft:chicken_variant`
- `minecraft:cow_sound_variant`
- `minecraft:cow_variant`
- `minecraft:dimension_type`
- `minecraft:enchantment`
- `minecraft:pig_sound_variant`
- `minecraft:pig_variant`
- `minecraft:timeline`
- `minecraft:world_clock`
- `minecraft:wolf_sound_variant`
- `minecraft:wolf_variant`

### Unresolved Play Packet Base Names

- Clientbound: open_horse_window
- Serverbound: none

## Clientbound Packets Used By Ragecraft

| Packet | 26.1.2 id |
|---|---:|
| `abilities` | 64 |
| `acknowledge_player_digging` | 4 |
| `block_change` | 8 |
| `experience` | 103 |
| `game_state_change` | 38 |
| `held_item_slot` | 105 |
| `initialize_world_border` | 43 |
| `map_chunk` | 45 |
| `respawn` | 82 |
| `set_player_inventory` | 108 |
| `simulation_distance` | 111 |
| `spawn_position` | 97 |
| `unload_chunk` | 37 |
| `update_health` | 104 |
| `update_light` | 48 |
| `update_time` | 113 |
| `update_view_distance` | 95 |
| `update_view_position` | 94 |

### Mojang Packet Names Used Clientbound

- `minecraft:player_abilities`
- `minecraft:block_changed_ack`
- `minecraft:block_update`
- `minecraft:set_experience`
- `minecraft:game_event`
- `minecraft:set_held_slot`
- `minecraft:initialize_border`
- `minecraft:level_chunk_with_light`
- `minecraft:respawn`
- `minecraft:set_player_inventory`
- `minecraft:set_simulation_distance`
- `minecraft:set_default_spawn_position`
- `minecraft:forget_level_chunk`
- `minecraft:set_health`
- `minecraft:light_update`
- `minecraft:set_time`
- `minecraft:set_chunk_cache_radius`
- `minecraft:set_chunk_cache_center`

## Serverbound Packets Handled By Ragecraft

| Packet | 26.1.2 id observed by rewriter |
|---|---:|
| `abilities` | 40 |
| `arm_animation` | 63 |
| `block_dig` | 41 |
| `block_place` | 66 |
| `chat` | n/a |
| `chat_message` | 9 |
| `entity_action` | 42 |
| `flying` | 33 |
| `held_item_slot` | 53 |
| `look` | 32 |
| `player_input` | 43 |
| `player_loaded` | 44 |
| `position` | 30 |
| `position_look` | 31 |
| `teleport_confirm` | 0 |
| `use_item` | 67 |

### Mojang Packet Names Handled Serverbound

- `minecraft:player_abilities`
- `minecraft:swing`
- `minecraft:player_action`
- `minecraft:use_item_on`
- `minecraft:chat`
- `minecraft:chat`
- `minecraft:player_command`
- `minecraft:move_player_status_only`
- `minecraft:set_carried_item`
- `minecraft:move_player_rot`
- `minecraft:player_input`
- `minecraft:player_loaded`
- `minecraft:move_player_pos`
- `minecraft:move_player_pos_rot`
- `minecraft:accept_teleportation`
- `minecraft:use_item`

## Notes

- This report is generated from local Mojang packet reports plus the live Ragecraft source tree.
- It documents the concrete compatibility surface currently in use instead of hand-maintained notes.
