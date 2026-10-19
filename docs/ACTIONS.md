# Справочник действий PS Maker / Action reference

Сгенерировано из `dist/zelda-maker-toolkit.ps-maker.js` (Zelda Maker Toolkit 0.1.0) скриптом `scripts/gen-actions-doc.mjs`. Не редактируйте вручную.

Всего действий: **43**. Все имена начинаются с `Zelda: `.

## Оглавление

- [Zelda: Start Toolkit](#zelda-start-toolkit)
- [Zelda: Configure](#zelda-configure)
- [Zelda: Stop Toolkit](#zelda-stop-toolkit)
- [Zelda: Pause Combat](#zelda-pause-combat)
- [Zelda: Toggle Debug](#zelda-toggle-debug)
- [Zelda: Create Enemy](#zelda-create-enemy)
- [Zelda: Create Object](#zelda-create-object)
- [Zelda: Create Chest](#zelda-create-chest)
- [Zelda: Create Door](#zelda-create-door)
- [Zelda: Place Item](#zelda-place-item)
- [Zelda: Remove Target](#zelda-remove-target)
- [Zelda: Damage Target](#zelda-damage-target)
- [Zelda: Defeat Enemy](#zelda-defeat-enemy)
- [Zelda: Add Rule](#zelda-add-rule)
- [Zelda: If](#zelda-if)
- [Zelda: Run Actions](#zelda-run-actions)
- [Zelda: Create Switch Sequence](#zelda-create-switch-sequence)
- [Zelda: Create Wave Room](#zelda-create-wave-room)
- [Zelda: Start Waves](#zelda-start-waves)
- [Zelda: Enter Dungeon](#zelda-enter-dungeon)
- [Zelda: Leave Dungeon](#zelda-leave-dungeon)
- [Zelda: Activate Switch](#zelda-activate-switch)
- [Zelda: Open Door](#zelda-open-door)
- [Zelda: Close Door](#zelda-close-door)
- [Zelda: Set Object State](#zelda-set-object-state)
- [Zelda: Reveal Object](#zelda-reveal-object)
- [Zelda: Reset Object](#zelda-reset-object)
- [Zelda: Give Item](#zelda-give-item)
- [Zelda: Spend Resource](#zelda-spend-resource)
- [Zelda: Remove Item](#zelda-remove-item)
- [Zelda: Equip Item](#zelda-equip-item)
- [Zelda: Change Player Health](#zelda-change-player-health)
- [Zelda: Change Magic](#zelda-change-magic)
- [Zelda: Set Flag](#zelda-set-flag)
- [Zelda: Set Ability](#zelda-set-ability)
- [Zelda: Show Message](#zelda-show-message)
- [Zelda: Set Respawn Point](#zelda-set-respawn-point)
- [Zelda: Respawn Player](#zelda-respawn-player)
- [Zelda: Save Progress](#zelda-save-progress)
- [Zelda: Load Progress](#zelda-load-progress)
- [Zelda: Reset Progress](#zelda-reset-progress)
- [Zelda: Define Item](#zelda-define-item)
- [Zelda: Define Enemy](#zelda-define-enemy)

## Zelda: Start Toolkit

Starts Zelda Maker Toolkit on this map. Put it first in the map's On-load events. / Запускает Toolkit на карте (первым в On-load событиях).

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `mapId` (Map ID) | string | `""` | Unique map name used to remember chests, doors and switches. / Уникальное имя карты для сохранения прогресса. |
| `preset` (Preset) | string | `"alttp"` | Balance preset: alttp, casual, hardcore. / Пресет баланса. |
| `config` (Config JSON) | string | `""` | Optional JSON overrides, e.g. {"sword":{"damage":3}}. / JSON-настройки. |
| `language` (Language) | string | `"auto"` | auto, en or ru. / Язык интерфейса. |
| `debugHitboxes` (Show hitboxes) | boolean | `false` | Draw collision/hitbox overlay (toggle with F9). / Показать хитбоксы. |

## Zelda: Configure

Changes toolkit settings with JSON at any time (controls, balance, UI). / Меняет настройки JSON-ом.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `config` (Config JSON) | string | `""` | e.g. {"controls":{"sword":["Space"]},"ui":{"position":"top-right"}} |

## Zelda: Stop Toolkit

Removes all toolkit objects from this map (progress is kept). / Убирает объекты Toolkit с карты (прогресс сохраняется).

_Без параметров._

## Zelda: Pause Combat

Pauses or resumes the toolkit simulation (use around cutscenes and dialogue). / Пауза боёвки на время сцен и диалогов.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `paused` (Paused) | boolean | `true` | true = pause, false = resume. |

## Zelda: Toggle Debug

Shows or hides the hitbox/state overlay. / Показ отладочных хитбоксов.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `enabled` (Enabled) | boolean | `true` | Show the overlay. |

## Zelda: Create Enemy

Spawns an enemy from a template (slime, soldier, spitter, knight, sentry, ogre or your own). / Создаёт врага по шаблону.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `template` (Template) | string | `"slime"` | Enemy template name. |
| `position` (Position) | position | — | Where to spawn (ignored if an NPC is chosen). |
| `npc` (Use NPC) | npc | — | Optional: turn this placed NPC into the enemy (uses its sprite). / Превратить NPC во врага. |
| `id` (ID) | string | `""` | Optional unique id (needed for persistent bosses and rules). |
| `group` (Group) | string | `""` | Group for rules like {"enemiesDefeated":"room1"}. |
| `overrides` (Overrides JSON) | string | `""` | Change stats, e.g. {"hp":6,"speed":50,"resistances":{"arrow":0}} |

## Zelda: Create Object

Creates an interactive object: bush, grass, pot, rock, heavy_rock, breakable, bombable_wall, lever, button, pressure_plate, block, chest, door, hidden_passage, torch, reactive, spikes, pit, hook_post, sign. / Создаёт интерактивный объект.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `type` (Type) | string | `"bush"` | Object type (see description). |
| `position` (Position) | position | — | Object center. |
| `id` (ID) | string | `""` | Unique id (required for persistence and rules). |
| `config` (Config JSON) | string | `""` | Overrides, e.g. {"tools":["arrow"],"setFlag":"eye_hit","onActivate":[{"openDoor":"d1"}]} |
| `sprite` (Sprite) | image | — | Optional custom image for the object. |

## Zelda: Create Chest

Places a treasure chest with an item inside. Opened chests stay open. / Сундук с наградой.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (ID) | string | `"chest_1"` | Unique chest id. |
| `position` (Position) | position | — | Chest center. |
| `item` (Item) | string | `"key"` | Item or resource id: key, big_key, bombs, arrows, rupees, boomerang, bow, heart_container... |
| `count` (Count) | number | `1` | How many. |
| `requiresBigKey` (Needs Big Key) | boolean | `false` | Big chest that needs the dungeon's Big Key. |
| `hidden` (Hidden) | boolean | `false` | Starts invisible; reveal it with a rule or `Zelda: Reveal Object`. |

## Zelda: Create Door

Places a door. Lock: none, small_key, big_key or switch (opened by rules). / Дверь: замок small_key, big_key или switch.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (ID) | string | `"door_1"` | Unique door id. |
| `position` (Position) | position | — | Door center. |
| `lock` (Lock) | string | `"small_key"` | none \| small_key \| big_key \| switch |
| `startOpen` (Start open) | boolean | `false` | Shutter doors that close when a fight starts. |

## Zelda: Place Item

Puts a collectible on the ground (key, heart, bombs...). With an ID it never respawns once taken. / Предмет на земле.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `item` (Item) | string | `"key"` | Item or resource id. |
| `count` (Count) | number | `1` | How many. |
| `position` (Position) | position | — | Where. |
| `id` (ID) | string | `""` | Optional id to make it persistent. |

## Zelda: Remove Target

Removes an enemy or object by id (enemies die without drops). / Удаляет врага или объект.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (ID) | string | `""` | Enemy or object id. |

## Zelda: Damage Target

Deals damage to an enemy or object by id (use 'player' for the player). / Наносит урон по id.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (ID) | string | `""` | Enemy/object id or 'player'. |
| `amount` (Amount) | number | `1` | Damage points. |
| `damageType` (Damage type) | string | `"script"` | sword, bomb, arrow, fire, ice, magic, script... |

## Zelda: Defeat Enemy

Defeats an enemy (or every enemy of a group) as if killed in battle. / Побеждает врага или группу.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (ID) | string | `""` | Enemy id (leave empty to use Group). |
| `group` (Group) | string | `""` | Enemy group. |

## Zelda: Add Rule

When a condition becomes true, run actions. E.g. when {"switchOn":["plate_1"]} then [{"openDoor":"door_2"}]. / Правило «условие → действия».

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (Rule ID) | string | `"rule_1"` | Unique rule id. |
| `when` (When (JSON)) | string | `""` | Condition, e.g. {"enemiesDefeated":"room1"} |
| `then` (Then (JSON)) | string | `"[]"` | Actions, e.g. [{"reveal":"chest_2"},{"message":"A chest appeared!"}] |
| `else` (Else (JSON)) | string | `""` | Optional actions when the condition turns false again (needs Once = false). |
| `once` (Once) | boolean | `true` | Fire only the first time (remembered in saves). |

## Zelda: If

Checks a toolkit condition now (item, flag, enemy state...) and runs toolkit actions. E.g. when {"hasItem":"bow"}. / Проверка условия и действия.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `when` (When (JSON)) | string | `""` | e.g. {"flag":"talked_to_sage"} or {"enemyState":{"id":"boss","state":"dead"}} |
| `then` (Then (JSON)) | string | `"[]"` | Actions if true. |
| `else` (Else (JSON)) | string | `"[]"` | Actions if false. |

## Zelda: Run Actions

Runs a list of toolkit actions, e.g. [{"giveItem":{"item":"bombs","count":5}},{"openDoor":"d1"}]. / Выполняет список действий.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `actions` (Actions (JSON)) | string | `"[]"` | Array of action objects. |

## Zelda: Create Switch Sequence

Switches must be activated in this order; a wrong one resets them. / Переключатели в заданном порядке.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (Puzzle ID) | string | `"sequence_1"` | Unique id; solved state is saved as flag puzzle:<id>. |
| `switches` (Switch IDs) | string | `"switch_a,switch_b,switch_c"` | Comma-separated ids in the correct order. |
| `resetOnWrong` (Reset on wrong) | boolean | `true` | Turn all switches off after a wrong one. |
| `onSolved` (On solved (JSON)) | string | `"[]"` | Actions, e.g. [{"openDoor":"door_3"}] |

## Zelda: Create Wave Room

Enemy waves; doors stay shut until all waves are beaten. JSON: {"id":"r1","lockDoors":["d1"],"waves":[[{"template":"slime","x":80,"y":60}]],"onCleared":[{"reveal":"chest_1"}]}

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `config` (Config JSON) | string | `""` | Wave room definition (see description). |

## Zelda: Start Waves

Starts a wave room created with "autoStart": false. / Запускает волны врагов.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `roomId` (Room ID) | string | `""` | Wave room id. |

## Zelda: Enter Dungeon

Marks the current dungeon: small keys and the Big Key are counted per dungeon. / Вход в подземелье.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `dungeonId` (Dungeon ID) | string | `"dungeon_1"` | Unique dungeon id. |
| `completeOnBoss` (Complete on boss) | boolean | `true` | Defeating a boss enemy completes the dungeon. |

## Zelda: Leave Dungeon

Back to the overworld key counter. / Выход из подземелья.

_Без параметров._

## Zelda: Activate Switch

Turns a lever/button/plate on or off. / Включает или выключает переключатель.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (ID) | string | `""` | Switch id. |
| `on` (On) | boolean | `true` | true = on, false = off. |

## Zelda: Open Door

Opens a door (or chest) by id. / Открывает дверь или сундук.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (ID) | string | `""` | Door id. |

## Zelda: Close Door

Closes a door by id. / Закрывает дверь.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (ID) | string | `""` | Door id. |

## Zelda: Set Object State

Sets an object's state: on, off, opened, closed, locked, unlocked, lit, destroyed, revealed, hidden. / Меняет состояние объекта.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (ID) | string | `""` | Object id. |
| `state` (State) | string | `"on"` | New state. |

## Zelda: Reveal Object

Makes a hidden object (chest, passage...) appear. / Показывает скрытый объект.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (ID) | string | `""` | Object id. |

## Zelda: Reset Object

Restores an object to its initial state and forgets its saved progress. / Сбрасывает объект.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (ID) | string | `""` | Object id. |

## Zelda: Give Item

Gives an item or resource (sword, shield, bow, boomerang, bombs, arrows, rupees, key, big_key, heart_container, magic...). / Выдаёт предмет.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `item` (Item) | string | `"bombs"` | Item or resource id. |
| `count` (Count) | number | `1` | How many. |
| `silent` (Silent) | boolean | `false` | Do not show the 'You got...' message. |

## Zelda: Spend Resource

Removes resources if there are enough (rupees, bombs, arrows, magic, key). / Тратит ресурс.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `resource` (Resource) | string | `"rupees"` | Resource id. |
| `amount` (Amount) | number | `1` | How many. |

## Zelda: Remove Item

Takes an owned item away. / Забирает предмет.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `item` (Item) | string | `""` | Item id. |

## Zelda: Equip Item

Puts an owned item into the quick-use slot. / Ставит предмет в быстрый слот.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `item` (Item) | string | `""` | Item id. |

## Zelda: Change Player Health

mode add (+/-), set (exact value) or max (change maximum and refill). 1 heart = 2 points by default. / Здоровье игрока.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `mode` (Mode) | string | `"add"` | add \| set \| max |
| `amount` (Amount) | number | `2` | Health points. |

## Zelda: Change Magic

Adds or removes magic points. / Изменяет магию.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `amount` (Amount) | number | `8` | Magic points (+/-). |

## Zelda: Set Flag

Sets a toolkit flag used by rules (true/false/number/text). / Устанавливает флаг.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `flag` (Flag) | string | `""` | Flag name. |
| `value` (Value) | string | `"true"` | true, false, a number or text. |

## Zelda: Set Ability

Enables or disables an ability/item (sword, shield, bow, bomb...). / Включает/отключает способность.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `ability` (Ability) | string | `"sword"` | Item/ability id. |
| `enabled` (Enabled) | boolean | `true` | Allow using it. |

## Zelda: Show Message

Shows a short HUD message (not a PS Maker dialogue box). / Короткое сообщение в HUD.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `text` (Text) | string | `""` | Message text or localization key. |
| `durationMs` (Duration (ms)) | number | `2200` | How long. |

## Zelda: Set Respawn Point

Where the player revives after falling in battle on this map (empty = current position). / Точка возрождения.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `position` (Position) | position | — | Respawn point. |

## Zelda: Respawn Player

Revives the player at the respawn point (for deathBehavior 'none'). / Возрождает игрока.

_Без параметров._

## Zelda: Save Progress

Saves toolkit progress (health, items, chests, doors, switches, dungeons) to the browser. / Сохраняет прогресс.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `slot` (Slot) | string | `"default"` | Save slot name. |

## Zelda: Load Progress

Loads toolkit progress saved earlier. / Загружает прогресс.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `slot` (Slot) | string | `"default"` | Save slot name. |

## Zelda: Reset Progress

Deletes a save slot and optionally starts a new game. / Удаляет сохранение.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `slot` (Slot) | string | `"default"` | Save slot name. |
| `newGame` (New game) | boolean | `true` | Also reset current progress. |

## Zelda: Define Item

Adds a custom item without code. JSON: {"id":"ice_rod","name":{"en":"Ice Rod","ru":"Ледяной жезл"},"resource":"magic","cost":4,"effect":"projectile","projectile":{"damageType":"ice","damage":3,"stunMs":1000}}

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `json` (Item JSON) | string | `""` | Item definition (see description and docs/ITEMS.md). |
| `give` (Give now) | boolean | `false` | Also give the item to the player. |

## Zelda: Define Enemy

Adds an enemy template. JSON: {"extends":"soldier","hp":8,"tint":16729156,"resistances":{"fire":0}}

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `name` (Template name) | string | `"red_soldier"` | New template name. |
| `json` (Template JSON) | string | `""` | Fields of the enemy config (see docs/ENEMIES.md). |

