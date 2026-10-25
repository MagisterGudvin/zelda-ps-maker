# Справочник действий PS Maker / Action reference

Сгенерировано из `dist/zelda-maker-toolkit.ps-maker.js` (Zelda Maker Toolkit 0.5.3) скриптом `scripts/gen-actions-doc.mjs`. Не редактируйте вручную.

Всего действий: **42**. Все имена начинаются с `Zelda: `.

## Оглавление

- [Zelda: Start Toolkit](#zelda-start-toolkit)
- [Zelda: Set Controls](#zelda-set-controls)
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

Starts Zelda Maker Toolkit on this map with the main game settings. Put it first in the map's start events (same settings on every map). / Запускает Toolkit на карте (первым в событиях начала карты).

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `mapId` (Map ID) | string | `""` | Unique map name used to remember chests, doors and switches. / Уникальное имя карты для сохранения прогресса. |
| `difficulty` (Difficulty) | number | `2` | 1 = easy (longer invulnerability and sword, shield blocks magic, own bombs harmless), 2 = normal, 3 = hard (short invulnerability, fewer drops). / Сложность: 1 лёгкая, 2 обычная, 3 сложная. |
| `hearts` (Hearts) | number | `3` | Starting and maximum hearts. / Сердца в начале игры. |
| `swordDamage` (Sword damage) | number | `2` | Damage of one sword hit (a slime has 2 HP). / Урон меча. |
| `hud` (Show HUD) | boolean | `true` | Hearts, item and counters on screen. Turn off if you build your own UI with PS Maker UI components. / Показывать интерфейс Toolkit. |
| `magicBar` (Magic bar) | boolean | `true` | Show the magic meter (needed for magic items). / Шкала магии. |
| `shieldButton` (Shield on a button) | boolean | `false` | Off: the shield is raised whenever you are not attacking (classic). On: hold the shield key. / Щит по кнопке. |
| `hudBottom` (HUD at the bottom) | boolean | `false` | Draw hearts and counters at the bottom of the screen. / Интерфейс внизу экрана. |
| `autosave` (Autosave) | boolean | `true` | Save after chests, doors, new items and dungeons. / Автосохранение. |
| `language` (Language) | string | `"auto"` | auto, en or ru. / Язык интерфейса. |
| `tileUnits` (Positions in tiles) | boolean | `false` | Tick if objects appear about 16 times too close to the top-left: Position values are then read as tiles. / Координаты в тайлах. |
| `debugHitboxes` (Show hitboxes) | boolean | `false` | Draw collision/hitbox overlay (toggle with F9). / Показать хитбоксы. |
| `diagnostics` (Show diagnostics) | boolean | `false` | On-screen panel with positions and recent messages (toggle with F10). / Панель диагностики. |

## Zelda: Set Controls

Changes the keys. Key names: X, Z, C, Space, Enter, Shift, Tab, Up, 1... Several keys: X, Space. Empty = keep. / Клавиши управления (пусто — не менять).

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `sword` (Sword) | string | `""` | Default: X. |
| `useItem` (Use item) | string | `""` | Default: C. |
| `shield` (Shield) | string | `""` | Only with Shield on a button. Default: V. |
| `action` (Action) | string | `""` | Open, lift, read. Default: Z. |
| `nextItem` (Next item) | string | `""` | Default: E. |
| `prevItem` (Previous item) | string | `""` | Default: Q. |
| `inventory` (Inventory) | string | `""` | Default: I. |

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

Spawns an enemy from a template: slime, soldier, spitter, knight, sentry, ogre or your own (Define Enemy). / Создаёт врага по шаблону.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `template` (Template) | string | `"slime"` | slime, soldier, spitter, knight, sentry, ogre or a Define Enemy name. |
| `position` (Position) | position | — | Where to spawn, in map pixels. In playtest press F9 and click the map to read X and Y. Empty = next to the player. / Точка появления. |
| `character` (Look (PS Maker character)) | npc | — | Optional (experimental): pick a character from your library, e.g. Slime. Its animations (Run/Walk, Idle, Attack, Hurt, Death) and collision box are used; it does not have to be on the map. / Внешний вид — персонаж PS Maker. |
| `id` (ID) | string | `""` | Optional unique id (needed for persistent bosses). |
| `group` (Group) | string | `""` | Optional group name: rules can wait until the whole group is defeated. / Группа врагов. |
| `hp` (Health) | number | `0` | Hit points; 0 = template value. / Здоровье (0 — как в шаблоне). |
| `damage` (Damage) | number | `0` | Damage to the player; 0 = template value. / Урон (0 — как в шаблоне). |
| `speed` (Speed) | number | `0` | Pixels per second; 0 = template value. / Скорость (0 — как в шаблоне). |
| `walkAnimation` (Walk animation) | string | `""` | Optional animation id (Zelda: Define Animation); also used when standing. / Анимация ходьбы. |
| `attackAnimation` (Attack animation) | string | `""` | Optional animation id. / Анимация атаки. |
| `hurtAnimation` (Hurt animation) | string | `""` | Optional animation id. / Анимация урона. |
| `deathAnimation` (Death animation) | string | `""` | Optional animation id. / Анимация смерти. |
| `spriteOffsetX` (Sprite offset X) | number | `0` | Move the picture relative to the hitbox, pixels. / Сдвиг картинки по X. |
| `spriteOffsetY` (Sprite offset Y) | number | `0` | e.g. -16 when the feet are low in a 64x64 frame. / Сдвиг картинки по Y. |
| `spriteScale` (Sprite scale) | number | `0` | 0 = template value (1). / Масштаб картинки. |
| `patrol` (Patrol markers) | string | `""` | Optional: marker IDs placed with Zelda: Place Marker, walked in order, e.g. p1, p2, p3. / Маршрут патруля по маркерам. |

## Zelda: Enemy From NPC

Turns an NPC already on this map (placed or spawned earlier) into an enemy that keeps the NPC's sprite. / Превращает NPC на карте во врага.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `npc` (NPC) | npc | — | The NPC to turn into an enemy. / NPC, который станет врагом. |
| `template` (Template) | string | `"soldier"` | Enemy template name (behaviour and stats). |
| `id` (ID) | string | `""` | Optional unique id (needed for persistent bosses). |
| `group` (Group) | string | `""` | Optional group name for rules. / Группа врагов. |
| `hp` (Health) | number | `0` | Hit points; 0 = template value. / Здоровье (0 — как в шаблоне). |
| `damage` (Damage) | number | `0` | Damage to the player; 0 = template value. / Урон (0 — как в шаблоне). |
| `speed` (Speed) | number | `0` | Pixels per second; 0 = template value. / Скорость (0 — как в шаблоне). |

## Zelda: Create Object

Creates an interactive object: bush, grass, pot, rock, heavy_rock, breakable, bombable_wall, lever, button, pressure_plate, block, chest, door, hidden_passage, torch, reactive, spikes, pit, hook_post, sign. / Создаёт интерактивный объект.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `type` (Type) | string | `"bush"` | Object type (see description). |
| `position` (Position) | position | — | Object center. |
| `id` (ID) | string | `""` | Unique id (needed for saving and for other actions to refer to it). |
| `sprite` (Sprite) | image | — | Optional custom image for the object. |
| `hidden` (Hidden) | boolean | `false` | Starts invisible; Reveal it later. / Скрыт до открытия. |
| `staysOn` (Stays on) | boolean | `false` | Plates stay pressed and levers/buttons cannot be switched back. / Остаётся включённым. |
| `width` (Width) | number | `0` | Pixels; 0 = normal size (16). / Ширина. |
| `height` (Height) | number | `0` | Pixels; 0 = normal size (16). / Высота. |
| `text` (Text) | string | `""` | Sign text, or a message shown when the object is used. / Текст таблички или сообщение. |
| `reactsTo` (Reacts to) | string | `""` | For reactive objects (eye switches, crystals): sword, arrow, bomb, boomerang, fire... comma-separated. / Реагирует на. |
| `setFlag` (On use: set flag) | string | `""` | Flag set when the object is activated (opened, switched on, lit, destroyed). / Флаг при активации. |
| `openDoors` (On use: open doors) | string | `""` | Door ids opened when the object is activated. / Открыть двери при активации. |
| `reveal` (On use: reveal) | string | `""` | Hidden object ids revealed when the object is activated. / Показать объекты при активации. |

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

Places a door. With no lock ticked it opens by action; Opened by switch = only rules, switches and Change Object open it. / Дверь.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (ID) | string | `"door_1"` | Unique door id. |
| `position` (Position) | position | — | Door center. |
| `smallKey` (Needs a small key) | boolean | `true` | Opens with a small key of this dungeon. / Нужен маленький ключ. |
| `bigKey` (Needs the Big Key) | boolean | `false` | Boss door. / Нужен большой ключ. |
| `bySwitch` (Opened by switch) | boolean | `false` | Opens only from a switch, a rule or Change Object. / Открывается переключателем. |
| `startOpen` (Start open) | boolean | `false` | Shutter doors that close when a fight starts. |
| `width` (Width) | number | `0` | Pixels; 0 = normal size (16). / Ширина. |
| `height` (Height) | number | `0` | Pixels; 0 = normal size (16), e.g. 32 for a two-tile gate. / Высота. |

## Zelda: Place Item

Puts a collectible on the ground (key, heart, bombs...). With an ID it never respawns once taken. / Предмет на земле.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `item` (Item) | string | `"key"` | Item or resource id. |
| `count` (Count) | number | `1` | How many. |
| `position` (Position) | position | — | Where. |
| `id` (ID) | string | `""` | Optional id to make it persistent. |

## Zelda: Place Marker

Names a map point once (tip: press F9 in playtest and click the map to get X/Y), e.g. for patrol routes (Patrol markers of Create Enemy). / Именованная точка карты, например для маршрута патруля.

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

When the conditions become true (every filled When field), do the filled actions. E.g. When objects active: plate_1 → Open doors: door_2. / Правило «условие → действия».

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (Rule ID) | string | `"rule_1"` | Unique rule id. |
| `whenDefeated` (When group defeated) | string | `""` | Every enemy of this group is beaten (Group of Create Enemy). / Побеждены все враги группы. |
| `whenActive` (When objects active) | string | `""` | Object ids, comma-separated: switches and plates on, doors and chests open, torches lit. / Объекты включены или открыты. |
| `whenFlag` (When flag set) | string | `""` | Flag name. / Флаг установлен. |
| `whenItem` (When player has) | string | `""` | Item id, e.g. bow or big_key. / У игрока есть предмет. |
| `whenBoss` (When boss defeated) | boolean | `false` | The boss of the current dungeon (Enter Dungeon) is beaten. / Побеждён босс подземелья. |
| `openDoors` (Open doors) | string | `""` | Door ids, comma-separated. / Открыть двери. |
| `reveal` (Reveal) | string | `""` | Hidden object ids (chests, passages), comma-separated. / Показать скрытые объекты. |
| `setFlag` (Set flag) | string | `""` | Flag to set. / Установить флаг. |
| `giveItem` (Give item) | string | `""` | Item or resource id. / Выдать предмет. |
| `giveCount` (Item count) | number | `1` | How many to give. |
| `message` (Message) | string | `""` | Text to show. / Показать сообщение. |
| `spawnEnemy` (Spawn enemy) | string | `""` | Enemy template to create, e.g. ogre. / Создать врага. |
| `spawnAt` (Spawn at marker) | string | `""` | Marker id (Zelda: Place Marker) where it appears. / Маркер появления. |
| `once` (Once) | boolean | `true` | Fire only the first time (remembered in saves). |

## Zelda: Run Actions

Does several things at once, optionally only when a toolkit condition holds (PS Maker conditions cannot read toolkit state). Empty When fields = always. / Несколько действий сразу, можно с условием.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `whenDefeated` (When group defeated) | string | `""` | Every enemy of this group is beaten (Group of Create Enemy). / Побеждены все враги группы. |
| `whenActive` (When objects active) | string | `""` | Object ids, comma-separated: switches and plates on, doors and chests open, torches lit. / Объекты включены или открыты. |
| `whenFlag` (When flag set) | string | `""` | Flag name. / Флаг установлен. |
| `whenItem` (When player has) | string | `""` | Item id, e.g. bow or big_key. / У игрока есть предмет. |
| `whenBoss` (When boss defeated) | boolean | `false` | The boss of the current dungeon (Enter Dungeon) is beaten. / Побеждён босс подземелья. |
| `openDoors` (Open doors) | string | `""` | Door ids, comma-separated. / Открыть двери. |
| `reveal` (Reveal) | string | `""` | Hidden object ids (chests, passages), comma-separated. / Показать скрытые объекты. |
| `setFlag` (Set flag) | string | `""` | Flag to set. / Установить флаг. |
| `giveItem` (Give item) | string | `""` | Item or resource id. / Выдать предмет. |
| `giveCount` (Item count) | number | `1` | How many to give. |
| `message` (Message) | string | `""` | Text to show. / Показать сообщение. |
| `spawnEnemy` (Spawn enemy) | string | `""` | Enemy template to create, e.g. ogre. / Создать врага. |
| `spawnAt` (Spawn at marker) | string | `""` | Marker id (Zelda: Place Marker) where it appears. / Маркер появления. |

## Zelda: Create Switch Sequence

Switches must be activated in this order; a wrong one resets them. When solved, the filled actions run. / Переключатели в заданном порядке.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (Puzzle ID) | string | `"sequence_1"` | Unique id; solved state is saved as flag puzzle:<id>. |
| `switches` (Switch IDs) | string | `"switch_a,switch_b,switch_c"` | Comma-separated ids in the correct order. |
| `resetOnWrong` (Reset on wrong) | boolean | `true` | Turn all switches off after a wrong one. |
| `openDoors` (Open doors) | string | `""` | Door ids, comma-separated. / Открыть двери. |
| `reveal` (Reveal) | string | `""` | Hidden object ids (chests, passages), comma-separated. / Показать скрытые объекты. |
| `setFlag` (Set flag) | string | `""` | Flag to set. / Установить флаг. |
| `giveItem` (Give item) | string | `""` | Item or resource id. / Выдать предмет. |
| `giveCount` (Item count) | number | `1` | How many to give. |
| `message` (Message) | string | `""` | Text to show. / Показать сообщение. |
| `spawnEnemy` (Spawn enemy) | string | `""` | Enemy template to create, e.g. ogre. / Создать врага. |
| `spawnAt` (Spawn at marker) | string | `""` | Marker id (Zelda: Place Marker) where it appears. / Маркер появления. |

## Zelda: Create Wave Room

Room with enemy waves: doors stay shut until every wave is beaten, then the filled actions run. Add enemies with Zelda: Add Wave Enemy. / Комната с волнами врагов.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (Room ID) | string | `"arena"` | Unique room id (cleared state is saved). |
| `lockDoors` (Doors to lock) | string | `""` | Comma-separated door ids closed during the fight. |
| `autoStart` (Start at once) | boolean | `false` | Start when the map loads; otherwise use Zelda: Start Waves (e.g. from a trigger area). |
| `delayMs` (Pause between waves (ms)) | number | `800` | 1000 = one second. |
| `openDoors` (Open doors) | string | `""` | Door ids, comma-separated. / Открыть двери. |
| `reveal` (Reveal) | string | `""` | Hidden object ids (chests, passages), comma-separated. / Показать скрытые объекты. |
| `setFlag` (Set flag) | string | `""` | Flag to set. / Установить флаг. |
| `giveItem` (Give item) | string | `""` | Item or resource id. / Выдать предмет. |
| `giveCount` (Item count) | number | `1` | How many to give. |
| `message` (Message) | string | `""` | Text to show. / Показать сообщение. |
| `spawnEnemy` (Spawn enemy) | string | `""` | Enemy template to create, e.g. ogre. / Создать врага. |
| `spawnAt` (Spawn at marker) | string | `""` | Marker id (Zelda: Place Marker) where it appears. / Маркер появления. |

## Zelda: Add Wave Enemy

Adds one enemy to a wave of a wave room at the given point. / Добавляет врага в волну.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `roomId` (Room ID) | string | `"arena"` | Wave room id. |
| `wave` (Wave) | number | `1` | Wave number: 1, 2, 3... |
| `template` (Template) | string | `"slime"` | Enemy template. |
| `position` (Position) | position | — | Spawn point. |
| `hp` (Health) | number | `0` | Hit points; 0 = template value. / Здоровье (0 — как в шаблоне). |
| `damage` (Damage) | number | `0` | Damage to the player; 0 = template value. / Урон (0 — как в шаблоне). |
| `speed` (Speed) | number | `0` | Pixels per second; 0 = template value. / Скорость (0 — как в шаблоне). |

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

Adds to (or, with Set, replaces) the player's health, maximum health and magic. Health is in half-hearts: 2 = one heart. 0 = no change. / Здоровье и магия игрока.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `health` (Health) | number | `0` | Half-hearts to add (negative = damage). / Здоровье в половинках сердца. |
| `maxHealth` (Max health) | number | `0` | Half-hearts added to the maximum (also refills). / Максимум здоровья. |
| `magic` (Magic) | number | `0` | Magic points to add. / Магия. |
| `set` (Set instead of add) | boolean | `false` | Use the numbers as new values (fields left at 0 are not changed). / Установить вместо прибавления. |

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

Adds a usable item without code: a shot (Damage > 0), a burst around the player (Area attack) or a healing item (Heal > 0). With none of these it is a quest item. / Свой предмет без кода.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (Item ID) | string | `"ice_rod"` | Unique id, e.g. ice_rod. |
| `name` (Name) | string | `"Ice Rod"` | Shown in messages and the inventory. / Название. |
| `icon` (Icon) | image | — | Optional icon image. / Иконка. |
| `resource` (Uses) | string | `"magic"` | What one use costs: magic, arrows, bombs, rupees or empty = free. / Расходует. |
| `cost` (Cost) | number | `4` | How much of it per use. |
| `damage` (Damage) | number | `3` | Damage of the shot or burst; 0 = no attack. / Урон. |
| `damageType` (Damage type) | string | `"magic"` | magic, fire, ice, arrow, bomb... (enemies may resist). |
| `area` (Area attack) | boolean | `false` | Hit everything around the player instead of shooting. / Удар вокруг игрока. |
| `stunMs` (Stun (ms)) | number | `0` | Freeze hit enemies; 1000 = one second. |
| `heal` (Heal) | number | `0` | Half-hearts restored per use (makes it a healing item). / Лечение. |
| `give` (Give now) | boolean | `false` | Also give the item to the player. |

## Zelda: Define Enemy

Makes a new enemy type from an existing one with other stats; use its name as the Template of Create Enemy. / Новый тип врага на основе существующего.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `name` (Template name) | string | `"red_soldier"` | New template name. |
| `basedOn` (Based on) | string | `"soldier"` | slime, soldier, spitter, knight, sentry, ogre or another Define Enemy name. |
| `hp` (Health) | number | `0` | Hit points; 0 = template value. / Здоровье (0 — как в шаблоне). |
| `damage` (Damage) | number | `0` | Damage to the player; 0 = template value. / Урон (0 — как в шаблоне). |
| `speed` (Speed) | number | `0` | Pixels per second; 0 = template value. / Скорость (0 — как в шаблоне). |
| `detectRange` (Sight range) | number | `0` | Pixels at which it notices the player; 0 = template value. / Дальность обзора. |
| `boss` (Boss) | boolean | `false` | Defeating it completes the dungeon (with Enter Dungeon). / Босс. |
| `immuneTo` (Immune to) | string | `""` | Damage types that do nothing, comma-separated: arrow, fire, bomb... / Неуязвим к. |
| `spriteOffsetX` (Sprite offset X) | number | `0` | Move the picture relative to the hitbox, pixels. / Сдвиг картинки по X. |
| `spriteOffsetY` (Sprite offset Y) | number | `0` | e.g. -16 when the feet are low in a 64x64 frame. / Сдвиг картинки по Y. |
| `spriteScale` (Sprite scale) | number | `0` | 0 = template value (1). / Масштаб картинки. |

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

Names frames of a sprite sheet (numbers from Preview Sprite Sheet). Fill only Frames for one animation in every direction, or the four direction fields; Left mirrors Right when empty. FPS 0 = stretch over the action. / Анимация из кадров.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `id` (Animation ID) | string | `"hero_slash"` | e.g. hero_slash. |
| `sheet` (Sheet ID) | string | `"hero"` | From Zelda: Define Sprite Sheet. |
| `frames` (Frames (facing down)) | string | `""` | Frame numbers, e.g. 0, 1, 2, 3. Used for every direction that has no own frames. / Кадры (вниз или для всех). |
| `framesUp` (Frames facing up) | string | `""` | Optional, e.g. 8, 9, 10. |
| `framesLeft` (Frames facing left) | string | `""` | Optional; empty = mirrored Right. |
| `framesRight` (Frames facing right) | string | `""` | Optional, e.g. 16, 17, 18. |
| `fps` (FPS) | number | `0` | Frames per second; 0 = fit the action duration (attacks). |
| `loop` (Loop) | boolean | `false` | Repeat (walk/idle). |

## Zelda: Set Player Sprites

Uses sprite-sheet animations for the player's attacks (body and weapon layers, e.g. Mana Seed character + weapon sheets). Empty = built-in blade. / Анимации атаки игрока.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `usePsMaker` (Use the player's PS Maker animations) | boolean | `false` | Experimental: attack and hurt come from the player's own sheets in PS Maker (names with Attack / Hurt, e.g. Sword Attack, Sword Hurt). The fields below then stay empty. / Анимации игрока из PS Maker. |
| `attack` (Attack (body)) | string | `""` | Animation id for the sword swing. |
| `weaponAttack` (Attack (weapon)) | string | `""` | Weapon layer for the swing. |
| `spin` (Spin (body)) | string | `""` | Spin attack; empty = attack. |
| `weaponSpin` (Spin (weapon)) | string | `""` |  |
| `charge` (Charge (body)) | string | `""` | While charging; empty = last attack frame. |
| `weaponCharge` (Charge (weapon)) | string | `""` |  |
| `hurt` (Hurt (body)) | string | `""` | While knocked back. |
| `behindUp` (Weapon behind when facing up) | boolean | `true` | Draw the weapon layer behind the body. / Оружие за телом (вверх). |
| `behindDown` (Weapon behind when facing down) | boolean | `false` |  |
| `behindLeft` (Weapon behind when facing left) | boolean | `false` |  |
| `behindRight` (Weapon behind when facing right) | boolean | `false` |  |
| `hidePlayer` (Hide PS Maker sprite) | boolean | `true` | Hide the normal sprite while an animation plays. |
| `offsetX` (Offset X) | number | `0` | Pixels. |
| `offsetY` (Offset Y) | number | `0` | Pixels. |
| `pivotX` (Swing center X) | number | `0` | Move the point the sword swings around, pixels. / Центр взмаха по X. |
| `pivotY` (Swing center Y) | number | `0` | e.g. 4 to swing from lower on the body. / Центр взмаха по Y. |

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

