# Справочник действий PS Maker / Action reference

Сгенерировано из `dist/zelda-maker-toolkit.ps-maker.js` (Zelda Maker Toolkit 0.4.2) скриптом `scripts/gen-actions-doc.mjs`. Не редактируйте вручную.

Всего действий: **42**. Все имена начинаются с `Zelda: `.

## Оглавление

- [Zelda: Start Toolkit](#zelda-start-toolkit)
- [Zelda: Configure](#zelda-configure)
- [Zelda: Stop Toolkit](#zelda-stop-toolkit)
- [Zelda: Pause Combat](#zelda-pause-combat)
- [Zelda: Debug](#zelda-debug)
- [Zelda: Create Enemy](#zelda-create-enemy)
- [Zelda: Enemy From NPC](#zelda-enemy-from-npc)
- [Zelda: Create Object](#zelda-create-object)
- [Zelda: Create Chest](#zelda-create-chest)
- [Zelda: Create Door](#zelda-create-door)
- [Zelda: Place Item](#zelda-place-item)
- [Zelda: Place Marker](#zelda-place-marker)
- [Zelda: Change Object](#zelda-change-object)
- [Zelda: Remove Target](#zelda-remove-target)
- [Zelda: Damage Target](#zelda-damage-target)
- [Zelda: Add Rule](#zelda-add-rule)
- [Zelda: Run Actions](#zelda-run-actions)
- [Zelda: Create Switch Sequence](#zelda-create-switch-sequence)
- [Zelda: Create Wave Room](#zelda-create-wave-room)
- [Zelda: Add Wave Enemy](#zelda-add-wave-enemy)
- [Zelda: Start Waves](#zelda-start-waves)
- [Zelda: Enter Dungeon](#zelda-enter-dungeon)
- [Zelda: Give Item](#zelda-give-item)
- [Zelda: Spend Resource](#zelda-spend-resource)
- [Zelda: Remove Item](#zelda-remove-item)
- [Zelda: Equip Item](#zelda-equip-item)
- [Zelda: Change Player Stats](#zelda-change-player-stats)
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
- [Zelda: Define Sprite Sheet](#zelda-define-sprite-sheet)
- [Zelda: Define Animation](#zelda-define-animation)
- [Zelda: Set Player Sprites](#zelda-set-player-sprites)
- [Zelda: Preview Sprite Sheet](#zelda-preview-sprite-sheet)
- [Zelda: Set Sound](#zelda-set-sound)

## Zelda: Start Toolkit

Starts Zelda Maker Toolkit on this map. Put it first in the map's On-load events. / Запускает Toolkit на карте (первым в On-load событиях).

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `mapId` (Map ID) | string | `""` | Unique map name used to remember chests, doors and switches. / Уникальное имя карты для сохранения прогресса. |
| `preset` (Preset) | string | `"alttp"` | Balance preset: alttp, casual, hardcore. / Пресет баланса. |
| `config` (Config JSON) | string | `""` | Optional JSON overrides, e.g. {"sword":{"damage":3}}. / JSON-настройки. |
| `language` (Language) | string | `"auto"` | auto, en or ru. / Язык интерфейса. |
| `debugHitboxes` (Show hitboxes) | boolean | `false` | Draw collision/hitbox overlay (toggle with F9). / Показать хитбоксы. |
| `diagnostics` (Show diagnostics) | boolean | `false` | On-screen panel with positions and recent messages (toggle with F10). / Панель диагностики. |

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

## Zelda: Debug

Hitbox overlay (F9; click the map to read coordinates) and the diagnostics panel (F10): positions, nearby objects, recent warnings. / Отладка и диагностика.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `hitboxes` (Hitboxes) | boolean | `true` | Show hitboxes (F9). |
| `diagnostics` (Diagnostics) | boolean | `false` | Show the diagnostics panel (F10). |

## Zelda: Create Enemy

Spawns an enemy from a template (slime, soldier, spitter, knight, sentry, ogre or your own). / Создаёт врага по шаблону.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `template` (Template) | string | `"slime"` | Enemy template name. |
| `position` (Position) | position | — | Where to spawn, in map pixels. In playtest press F9 and click the map to read X and Y. / Точка появления. |
| `id` (ID) | string | `""` | Optional unique id (needed for persistent bosses and rules). |
| `group` (Group) | string | `""` | Group for rules like {"enemiesDefeated":"room1"}. |
| `animations` (Animations) | string | `""` | Optional sprite-sheet animations: walk=slime_walk, attack=slime_attack, hurt=..., death=..., idle=... (ids from Zelda: Define Animation). / Анимации из спрайт-листа. |
| `patrol` (Patrol markers) | string | `""` | Optional: marker IDs placed with Zelda: Place Marker, walked in order, e.g. p1,p2,p3. / Маршрут патруля по маркерам. |
| `overrides` (Overrides JSON) | string | `""` | Change stats, e.g. {"hp":6,"speed":50,"resistances":{"arrow":0}} |

## Zelda: Enemy From NPC

Turns an NPC already on this map (placed or spawned earlier) into an enemy that keeps the NPC's sprite. / Превращает NPC на карте во врага.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `npc` (NPC) | npc | — | The NPC to turn into an enemy. / NPC, который станет врагом. |
| `template` (Template) | string | `"soldier"` | Enemy template name (behaviour and stats). |
| `id` (ID) | string | `""` | Optional unique id (needed for persistent bosses and rules). |
| `group` (Group) | string | `""` | Group for rules like {"enemiesDefeated":"room1"}. |
| `overrides` (Overrides JSON) | string | `""` | Change stats, e.g. {"hp":6,"speed":50} |

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
| `hidden` (Hidden) | boolean | `false` | Starts invisible; reveal it with a rule or Zelda: Change Object (reveal). |

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

## Zelda: Place Marker

Names a map point once (tip: press F9 in playtest and click the map to get X/Y). Use the name instead of coordinates: patrol routes, Add Wave Enemy, and rule actions like {"spawnEnemy":{"template":"ogre","at":"boss_spot"}}. / Именованная точка карты вместо ввода координат.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (Marker ID) | string | `"marker_1"` | Name of the point, e.g. boss_spot. |
| `position` (Position) | position | — | Point in map pixels. In playtest press F9 and click the map to read/copy X and Y. |

## Zelda: Change Object

Changes an object by id. Operation: open, close (doors, chests), on, off, toggle (levers, buttons, plates), reveal, hide, reset (forget saved progress), destroy, or state (any state name). / Изменить объект.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (ID) | string | `""` | Object id. |
| `operation` (Operation) | string | `"open"` | open \| close \| on \| off \| toggle \| reveal \| hide \| reset \| destroy \| state |
| `state` (State) | string | `""` | Only for operation "state": on, off, opened, closed, locked, unlocked, lit, destroyed, revealed, hidden. |

## Zelda: Remove Target

Removes an enemy or object by id, or every enemy of a group. Defeat = counts as beaten in battle (drops, rules, boss rewards). / Убрать или победить цель.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (ID) | string | `""` | Enemy or object id (empty to use Group). |
| `group` (Group) | string | `""` | Enemy group. |
| `defeat` (Defeat) | boolean | `true` | Enemies die with drops and events instead of vanishing. |

## Zelda: Damage Target

Deals damage to an enemy or object by id (use 'player' for the player). / Наносит урон по id.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (ID) | string | `""` | Enemy/object id or 'player'. |
| `amount` (Amount) | number | `1` | Damage points. |
| `damageType` (Damage type) | string | `"script"` | sword, bomb, arrow, fire, ice, magic, script... |

## Zelda: Add Rule

When a condition becomes true, run actions. E.g. when {"switchOn":["plate_1"]} then [{"openDoor":"door_2"}]. / Правило «условие → действия».

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (Rule ID) | string | `"rule_1"` | Unique rule id. |
| `when` (When (JSON)) | string | `""` | Condition, e.g. {"enemiesDefeated":"room1"} |
| `then` (Then (JSON)) | string | `"[]"` | Actions, e.g. [{"reveal":"chest_2"},{"message":"A chest appeared!"}] |
| `else` (Else (JSON)) | string | `""` | Optional actions when the condition turns false again (needs Once = false). |
| `once` (Once) | boolean | `true` | Fire only the first time (remembered in saves). |

## Zelda: Run Actions

Runs toolkit actions, optionally only when a toolkit condition holds (item, flag, enemy state...). PS Maker conditionals cannot read toolkit state, so check it here. E.g. When {"hasItem":"bow"}, Then [{"openDoor":"d1"}]. / Действия Toolkit с условием.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `when` (When (JSON, optional)) | string | `""` | Condition, e.g. {"flag":"talked_to_sage"}. Empty = always. |
| `then` (Then (JSON)) | string | `"[]"` | Actions, e.g. [{"giveItem":{"item":"bombs","count":5}}] |
| `else` (Else (JSON)) | string | `""` | Actions when the condition is false. |

## Zelda: Create Switch Sequence

Switches must be activated in this order; a wrong one resets them. / Переключатели в заданном порядке.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (Puzzle ID) | string | `"sequence_1"` | Unique id; solved state is saved as flag puzzle:<id>. |
| `switches` (Switch IDs) | string | `"switch_a,switch_b,switch_c"` | Comma-separated ids in the correct order. |
| `resetOnWrong` (Reset on wrong) | boolean | `true` | Turn all switches off after a wrong one. |
| `onSolved` (On solved (JSON)) | string | `"[]"` | Actions, e.g. [{"openDoor":"door_3"}] |

## Zelda: Create Wave Room

Room with enemy waves: doors stay shut until every wave is beaten. Add enemies with Zelda: Add Wave Enemy. / Комната с волнами врагов.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (Room ID) | string | `"arena"` | Unique room id (cleared state is saved). |
| `lockDoors` (Doors to lock) | string | `""` | Comma-separated door ids closed during the fight. |
| `autoStart` (Start at once) | boolean | `false` | Start when the map loads; otherwise use Zelda: Start Waves (e.g. from a trigger area). |
| `onCleared` (On cleared (JSON)) | string | `"[]"` | Actions after the last wave, e.g. [{"reveal":"arena_chest"}] |
| `advanced` (Advanced JSON) | string | `""` | Optional: extra fields, e.g. {"delayMs":1000} or whole waves [[{"template":"slime","at":"m1"}]]. |

## Zelda: Add Wave Enemy

Adds one enemy to a wave of a wave room at the given point. / Добавляет врага в волну.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `roomId` (Room ID) | string | `"arena"` | Wave room id. |
| `wave` (Wave) | number | `1` | Wave number: 1, 2, 3... |
| `template` (Template) | string | `"slime"` | Enemy template. |
| `position` (Position) | position | — | Spawn point. |
| `overrides` (Overrides JSON) | string | `""` | Optional stat changes, e.g. {"hp":4}. |

## Zelda: Start Waves

Starts a wave room (e.g. from a trigger area at the room entrance). / Запускает волны врагов.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `roomId` (Room ID) | string | `""` | Wave room id. |

## Zelda: Enter Dungeon

Marks the current dungeon: small keys and the Big Key are counted per dungeon. Empty ID = back to the overworld. / Вход в подземелье (пусто — выход).

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `dungeonId` (Dungeon ID) | string | `"dungeon_1"` | Unique dungeon id; empty to leave. |
| `completeOnBoss` (Complete on boss) | boolean | `true` | Defeating a boss enemy completes the dungeon. |

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

## Zelda: Change Player Stats

Stat: health, max health (also refills) or magic. Mode: add (+/-) or set. 1 heart = 2 health points by default. / Здоровье и магия игрока.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `stat` (Stat) | string | `"health"` | health \| max health \| magic |
| `mode` (Mode) | string | `"add"` | add \| set |
| `amount` (Amount) | number | `2` | Points. |

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

## Zelda: Define Sprite Sheet

Registers a sprite sheet image cut into equal frames (Mana Seed: 64x64). Frames are numbered from 0, left to right, top to bottom; check them with Zelda: Preview Sprite Sheet. / Спрайт-лист.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (Sheet ID) | string | `"hero"` | Name used by animations, e.g. hero. |
| `image` (Image) | image | — | The sheet image. |
| `imageKey` (Image key or URL) | string | `""` | Optional: texture key or image URL if the Image picker does not work. |
| `frameWidth` (Frame width) | number | `64` | Pixels. |
| `frameHeight` (Frame height) | number | `64` | Pixels. |
| `margin` (Margin) | number | `0` | Empty pixels around the sheet. |
| `spacing` (Spacing) | number | `0` | Empty pixels between frames. |

## Zelda: Define Animation

Names frames of a sprite sheet. Frames: "8,9,10,11" for all directions or JSON per direction {"down":[0,1,2],"up":[8,9,10],"right":[16,17,18]} (left mirrors right if omitted). FPS 0 = stretch over the action. / Анимация из кадров.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (Animation ID) | string | `"hero_slash"` | e.g. hero_slash. |
| `sheet` (Sheet ID) | string | `"hero"` | From Zelda: Define Sprite Sheet. |
| `frames` (Frames) | string | `""` | Frame numbers (see Preview Sprite Sheet). |
| `fps` (FPS) | number | `0` | Frames per second; 0 = fit the action duration (attacks). |
| `loop` (Loop) | boolean | `false` | Repeat (walk/idle). |

## Zelda: Set Player Sprites

Uses sprite-sheet animations for the player's attacks (body and weapon layers, e.g. Mana Seed character + weapon sheets). Empty = built-in blade. / Анимации атаки игрока.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `attack` (Attack (body)) | string | `""` | Animation id for the sword swing. |
| `weaponAttack` (Attack (weapon)) | string | `""` | Weapon layer for the swing. |
| `spin` (Spin (body)) | string | `""` | Spin attack; empty = attack. |
| `weaponSpin` (Spin (weapon)) | string | `""` |  |
| `charge` (Charge (body)) | string | `""` | While charging; empty = last attack frame. |
| `weaponCharge` (Charge (weapon)) | string | `""` |  |
| `hurt` (Hurt (body)) | string | `""` | While knocked back. |
| `weaponBehind` (Weapon behind in) | string | `"up"` | Directions where the weapon is drawn behind the body: up, left... |
| `hidePlayer` (Hide PS Maker sprite) | boolean | `true` | Hide the normal sprite while an animation plays. |
| `offsetX` (Offset X) | number | `0` | Pixels. |
| `offsetY` (Offset Y) | number | `0` | Pixels. |

## Zelda: Preview Sprite Sheet

Shows a sprite sheet full screen with every frame number, to pick frames for Define Animation. Run it again with Show off to close. / Просмотр кадров.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `sheet` (Sheet ID) | string | `"hero"` | Sheet to show. |
| `show` (Show) | boolean | `true` | Open or close. |

## Zelda: Set Sound

Plays a sound at a toolkit moment: swordSwing, spinAttack, enemyHurt, enemyDefeated, playerHurt, playerDie, shieldBlock, bombExplode, objectBreak, pickup, itemGet, chestOpen, doorUnlock, puzzleSolved. Leave Audio empty to remove it. / Звук для момента игры.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `moment` (Moment) | string | `"swordSwing"` | swordSwing \| spinAttack \| enemyHurt \| enemyDefeated \| playerHurt \| playerDie \| shieldBlock \| bombExplode \| objectBreak \| pickup \| itemGet \| chestOpen \| doorUnlock \| puzzleSolved |
| `sound` (Sound) | audio | — | Audio asset. |
| `soundKey` (Sound key or URL) | string | `""` | Optional: audio key or file URL if the Sound picker does not work. |
| `volume` (Volume) | number | `1` | 0..1 |

