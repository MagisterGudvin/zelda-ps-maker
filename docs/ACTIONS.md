# Справочник действий PS Maker / Action reference

Сгенерировано из `dist/zelda-maker-toolkit.ps-maker.js` (Zelda Maker Toolkit 0.16.0) скриптом `scripts/gen-actions-doc.mjs`. Не редактируйте вручную.

Всего действий: **37**. Все имена начинаются с `Zelda: `.

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
- [Zelda: Change Object](#zelda-change-object)
- [Zelda: Remove Target](#zelda-remove-target)
- [Zelda: Damage Target](#zelda-damage-target)
- [Zelda: Add Rule](#zelda-add-rule)
- [Zelda: Run Actions](#zelda-run-actions)
- [Zelda: Create Switch Sequence](#zelda-create-switch-sequence)
- [Zelda: Create Wave Room](#zelda-create-wave-room)
- [Zelda: Add Wave Enemy](#zelda-add-wave-enemy)
- [Zelda: Enter Dungeon](#zelda-enter-dungeon)
- [Zelda: Give Item](#zelda-give-item)
- [Zelda: Spend Resource](#zelda-spend-resource)
- [Zelda: Remove Item](#zelda-remove-item)
- [Zelda: Equip Item](#zelda-equip-item)
- [Zelda: Change Player Stats](#zelda-change-player-stats)
- [Zelda: Set Ability](#zelda-set-ability)
- [Zelda: Show Message](#zelda-show-message)
- [Zelda: Show Stat In Variable](#zelda-show-stat-in-variable)
- [Zelda: Set Respawn Point](#zelda-set-respawn-point)
- [Zelda: Respawn Player](#zelda-respawn-player)
- [Zelda: Save Progress](#zelda-save-progress)
- [Zelda: Load Progress](#zelda-load-progress)
- [Zelda: Reset Progress](#zelda-reset-progress)
- [Zelda: Define Item](#zelda-define-item)
- [Zelda: Define Enemy](#zelda-define-enemy)
- [Zelda: Set Player Sprites](#zelda-set-player-sprites)
- [Zelda: Set Sound](#zelda-set-sound)

## Zelda: Start Toolkit

Starts Zelda Maker Toolkit on this map with the main game settings. Put it first in the map's start events (same settings on every map). / Запускает Toolkit на карте (первым в событиях начала карты).

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `difficulty` (Difficulty) | string-enum | `"alttp"` | Easy: longer invulnerability and sword, shield blocks magic, own bombs harmless. Hard: short invulnerability, fewer drops. / Сложность. Варианты: Easy, Normal, Hard. |
| `hearts` (Hearts) | number | `3` | Starting and maximum hearts. / Сердца в начале игры. |
| `swordDamage` (Sword damage) | number | `2` | Damage of one sword hit (a slime has 2 HP). / Урон меча. |
| `hud` (Show HUD) | boolean | `true` | Hearts, item and counters on screen. Turn off if you build your own UI with PS Maker UI components. / Показывать интерфейс Toolkit. |
| `magicBar` (Magic bar) | boolean | `true` | Show the magic meter (needed for magic items). / Шкала магии. |
| `shieldButton` (Shield on a button) | boolean | `false` | Off: the shield is raised whenever you are not attacking (classic). On: hold the shield key. / Щит по кнопке. |
| `hudBottom` (HUD at the bottom) | boolean | `false` | Draw hearts and counters at the bottom of the screen. / Интерфейс внизу экрана. |
| `autosave` (Autosave) | boolean | `true` | Save after chests, doors, new items and dungeons. / Автосохранение. |
| `language` (Language) | string-enum | `"auto"` | Interface language. / Язык интерфейса. Варианты: Auto, English, Русский. |
| `tileUnits` (Positions in tiles) | boolean | `false` | Tick if objects appear about 16 times too close to the top-left: Position values are then read as tiles. / Координаты в тайлах. |
| `debugHitboxes` (Show hitboxes) | boolean | `false` | Draw collision/hitbox overlay (toggle with F9). / Показать хитбоксы. |
| `diagnostics` (Show diagnostics) | boolean | `false` | On-screen panel with positions and recent messages (toggle with F10). / Панель диагностики. |

## Zelda: Set Controls

Changes the toolkit keys with PS Maker's key picker (empty = keep). Defaults: sword X, item C, shield V, action Z, items Q/E, inventory I. / Клавиши Toolkit (пусто — не менять).

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `sword` (Sword) | key-bindings | `[]` | Default: X. |
| `useItem` (Use item) | key-bindings | `[]` | Default: C. |
| `shield` (Shield) | key-bindings | `[]` | Only with Shield on a button. Default: V. |
| `action` (Action) | key-bindings | `[]` | Open, lift, read. Default: Z. |
| `nextItem` (Next item) | key-bindings | `[]` | Default: E. |
| `prevItem` (Previous item) | key-bindings | `[]` | Default: Q. |
| `inventory` (Inventory) | key-bindings | `[]` | Default: I. |

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
| `template` (Template) | string-enum | `"slime"` | Behaviour and stats; Custom enemy 1–6 are made with Zelda: Define Enemy. / Шаблон врага. Варианты: slime, soldier, spitter, knight, sentry, ogre, Custom enemy 1, Custom enemy 2, Custom enemy 3, Custom enemy 4, Custom enemy 5, Custom enemy 6. |
| `position` (Position) | map-position | — | Where to spawn: pick it on the map. Empty = next to the player. / Точка появления. |
| `character` (Look (PS Maker character)) | npc | — | Optional (experimental): pick a character from your library, e.g. Slime. Its animations (Run/Walk, Idle, Attack, Hurt, Death) and collision box are used; it does not have to be on the map. / Внешний вид — персонаж PS Maker. |
| `group` (Group) | string-enum | `""` | Rules can wait until the whole group is defeated. / Группа врагов. Варианты: No group, Group 1, Group 2, Group 3, Group 4, Group 5, Group 6, Group 7, Group 8, Group 9. |
| `hp` (Health) | number | `0` | Hit points; 0 = template value. / Здоровье (0 — как в шаблоне). |
| `damage` (Damage) | number | `0` | Damage to the player; 0 = template value. / Урон (0 — как в шаблоне). |
| `speed` (Speed) | number | `0` | Pixels per second; 0 = template value. / Скорость (0 — как в шаблоне). |
| `walkAnimation` (Walk animation) | animation | `""` | Optional: a PS Maker animation (any direction; the whole sheet is used); also used when standing. Overrides Look. / Анимация ходьбы. |
| `attackAnimation` (Attack animation) | animation | `""` | Optional PS Maker animation. / Анимация атаки. |
| `hurtAnimation` (Hurt animation) | animation | `""` | Optional PS Maker animation. / Анимация урона. |
| `deathAnimation` (Death animation) | animation | `""` | Optional PS Maker animation. / Анимация смерти. |
| `spriteOffsetX` (Sprite offset X) | number | `0` | Move the picture relative to the hitbox, pixels. / Сдвиг картинки по X. |
| `spriteOffsetY` (Sprite offset Y) | number | `0` | e.g. -16 when the feet are low in a 64x64 frame. / Сдвиг картинки по Y. |
| `spriteScale` (Sprite scale) | number | `0` | 0 = template value (1). / Масштаб картинки. |
| `patrol` (Patrol route) | path | — | Optional: click the points of the route on the map; the enemy walks them in order. / Маршрут патруля. |

## Zelda: Enemy From NPC

Turns an NPC already on this map (placed or spawned earlier) into an enemy that keeps the NPC's sprite. / Превращает NPC на карте во врага.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `npc` (NPC) | in-map-npc | `""` | An NPC on this map (placed or spawned earlier) that becomes the enemy. / NPC на карте, который станет врагом. |
| `template` (Template) | string-enum | `"soldier"` | Behaviour and stats. / Шаблон врага. Варианты: slime, soldier, spitter, knight, sentry, ogre, Custom enemy 1, Custom enemy 2, Custom enemy 3, Custom enemy 4, Custom enemy 5, Custom enemy 6. |
| `group` (Group) | string-enum | `""` | Rules can wait until the whole group is defeated. / Группа врагов. Варианты: No group, Group 1, Group 2, Group 3, Group 4, Group 5, Group 6, Group 7, Group 8, Group 9. |
| `hp` (Health) | number | `0` | Hit points; 0 = template value. / Здоровье (0 — как в шаблоне). |
| `damage` (Damage) | number | `0` | Damage to the player; 0 = template value. / Урон (0 — как в шаблоне). |
| `speed` (Speed) | number | `0` | Pixels per second; 0 = template value. / Скорость (0 — как в шаблоне). |

## Zelda: Create Object

Creates an interactive object: bushes, pots, rocks, walls to bomb, levers, buttons, plates, blocks, torches, chests, doors, hidden passages, spikes, pits, signs... / Создаёт интерактивный объект.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `type` (Type) | string-enum | `"bush"` | Object type. / Тип объекта. Варианты: bush, grass, pot, rock, heavy_rock, breakable, bombable_wall, lever, button, pressure_plate, block, chest, door, hidden_passage, torch, reactive, spikes, pit, hook_post, sign. |
| `position` (Position) | map-position | — | Object center: pick it on the map. / Центр объекта. |
| `hidden` (Hidden) | boolean | `false` | Starts invisible; reveal it later. / Скрыт до открытия. |
| `staysOn` (Stays on) | boolean | `false` | Plates stay pressed and levers/buttons cannot be switched back. / Остаётся включённым. |
| `text` (Text) | string | `""` | Sign text, or a message shown when the object is used. / Текст таблички или сообщение. |
| `reactsTo` (Reacts to) | string-enum-multi | `[]` | For eye switches, crystals and breakables: what hits it. / Реагирует на. Варианты: sword, spin, poke, arrow, bomb, boomerang, hookshot, fire, ice, magic, thrown, contact, projectile, hazard, fall, script. |
| `look` (Look (map object)) | string-enum | `""` | A map object of your library (e.g. a Mana Seed bush): its picture and collision box. Built-in = the toolkit's sprite. / Вид — объект карты из библиотеки. Варианты: Built-in. |
| `lookUsed` (Look when used) | string-enum | `""` | Picture after use: cut bush, broken pot, lever on, plate pressed, torch lit, chest open... Built-in = the toolkit's sprite. / Вид после использования. Варианты: Built-in. |
| `sprite` (Sprite (image)) | image | — | Or an image of your library instead of a map object. / Или картинка из библиотеки. |
| `width` (Width) | number | `0` | Pixels; 0 = normal size (16). / Ширина. |
| `height` (Height) | number | `0` | Pixels; 0 = normal size (16). / Высота. |
| `turnOnVariable` (On use: turn on variable) | variable | `""` | Project variable set to true when the object is activated (opened, switched on, lit, destroyed). / Включить переменную при активации. |
| `openDoorAt` (On use: open door at) | map-position | — | Door picked on the map, opened when the object is activated. / Открыть дверь при активации. |
| `revealAt` (On use: reveal object at) | map-position | — | Hidden object picked on the map, revealed when the object is activated. / Показать объект при активации. |

## Zelda: Create Chest

Places a treasure chest with an item inside. Opened chests stay open. / Сундук с наградой.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `position` (Position) | map-position | — | Chest center. |
| `item` (Item) | string-enum | `"key"` | What is inside. / Что внутри. Варианты: Rupees, Heart (refill), Heart container (+1 max), Magic (refill), Bombs, Arrows, Small key, Big Key, Dungeon map, Compass, Sword, Shield, Power glove (lift rocks), Bomb bag (use bombs), Boomerang, Bow, Hookshot, Fire rod, Healing spell, Custom item 1, Custom item 2, Custom item 3, Custom item 4. |
| `count` (Count) | number | `1` | How many (rupees, bombs, arrows...). / Сколько. |
| `requiresBigKey` (Needs Big Key) | boolean | `false` | Big chest that needs the dungeon's Big Key. |
| `hidden` (Hidden) | boolean | `false` | Starts invisible; reveal it with a rule or Zelda: Change Object (reveal). |
| `look` (Look: closed) | string-enum | `""` | A map object of your library for the closed chest. Built-in = the toolkit's chest. / Вид закрытого сундука. Варианты: Built-in. |
| `lookOpen` (Look: open) | string-enum | `""` | Map object for the opened chest. / Вид открытого сундука. Варианты: Built-in. |

## Zelda: Create Door

Places a door. Lock: none (opens by action), small key, Big Key, or switch (only switches, rules and Change Object open it). / Дверь.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `position` (Position) | map-position | — | Door center. |
| `lock` (Lock) | string-enum | `"small_key"` | What opens it. / Замок. Варианты: None, Small key, Big Key, Switch / rule. |
| `startOpen` (Start open) | boolean | `false` | Shutter doors that close when a fight starts. |
| `width` (Width) | number | `0` | Pixels; 0 = normal size (16). / Ширина. |
| `height` (Height) | number | `0` | Pixels; 0 = normal size (16), e.g. 32 for a two-tile gate. / Высота. |
| `look` (Look: closed) | string-enum | `""` | A map object of your library for the closed door. Built-in = the toolkit's door. / Вид закрытой двери. Варианты: Built-in. |
| `lookOpen` (Look: open) | string-enum | `""` | Map object for the open door (empty passage if you like). / Вид открытой двери. Варианты: Built-in. |

## Zelda: Place Item

Puts a collectible on the ground (key, heart, rupees, bombs...). / Предмет на земле.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `item` (Item) | string-enum | `"key"` | What lies there. / Предмет. Варианты: Rupees, Heart (refill), Heart container (+1 max), Magic (refill), Bombs, Arrows, Small key, Big Key, Dungeon map, Compass, Sword, Shield, Power glove (lift rocks), Bomb bag (use bombs), Boomerang, Bow, Hookshot, Fire rod, Healing spell, Custom item 1, Custom item 2, Custom item 3, Custom item 4. |
| `count` (Count) | number | `1` | How many (rupees, bombs, arrows...). / Сколько. |
| `position` (Position) | map-position | — | Where it lies: pick it on the map. / Где лежит. |
| `once` (Only once) | boolean | `true` | Once taken it never comes back (keys, heart containers). / Не появляется снова. |
| `look` (Look (map object)) | string-enum | `""` | A map object of your library for the item on the ground. Built-in = the toolkit's sprite. / Вид предмета. Варианты: Built-in. |

## Zelda: Change Object

Changes a toolkit object picked on the map: open or close doors and chests, switch levers and plates, light torches, reveal, hide, reset or destroy. / Изменить объект.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `objectAt` (Object at) | map-position | — | Pick the object on the map. / Объект на карте. |
| `operation` (Operation) | string-enum | `"open"` | What to do with it. / Действие. Варианты: Open, Close, Switch on, Switch off, Toggle, Light (torch), Unlock, Reveal, Hide, Reset (forget saved state), Destroy. |

## Zelda: Remove Target

Removes every enemy of a group, or the object picked on the map. Defeat = counts as beaten in battle (drops, rules, boss rewards). / Убрать или победить цель.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `group` (Enemy group) | string-enum | `""` | All enemies of this group. / Группа врагов. Варианты: No group, Group 1, Group 2, Group 3, Group 4, Group 5, Group 6, Group 7, Group 8, Group 9. |
| `objectAt` (Object at) | map-position | — | Or an object picked on the map. / Или объект на карте. |
| `defeat` (Defeat) | boolean | `true` | Enemies die with drops and events instead of vanishing. |

## Zelda: Damage Target

Deals damage to the player, to every enemy of a group, or to an object picked on the map. / Наносит урон.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `player` (Hit the player) | boolean | `false` | Damage the player. / Урон игроку. |
| `group` (Enemy group) | string-enum | `""` | Damage every enemy of this group. / Урон группе врагов. Варианты: No group, Group 1, Group 2, Group 3, Group 4, Group 5, Group 6, Group 7, Group 8, Group 9. |
| `objectAt` (Object at) | map-position | — | Or an object picked on the map. / Или объект на карте. |
| `amount` (Amount) | number | `1` | Damage points (2 = one heart for the player). / Урон. |
| `damageType` (Damage type) | string-enum | `"script"` | Enemies may resist some types. / Тип урона. Варианты: sword, spin, poke, arrow, bomb, boomerang, hookshot, fire, ice, magic, thrown, contact, projectile, hazard, fall, script. |

## Zelda: Add Rule

When the conditions become true (every filled When field), do the filled actions. E.g. When object at: the plate → Open door at: the door. / Правило «условие → действия».

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `once` (Once) | boolean | `true` | Fire only the first time (remembered in saves). |
| `whenGroup` (When group defeated) | string-enum | `""` | Every enemy of this group is beaten (Group of Create Enemy). / Побеждена вся группа врагов. Варианты: No group, Group 1, Group 2, Group 3, Group 4, Group 5, Group 6, Group 7, Group 8, Group 9. |
| `whenObjectAt` (When object at) | map-position | — | Pick a switch, plate, lever, torch, chest or door on the map: it must be on / open / lit. / Объект включён или открыт. |
| `whenObjectAt2` (…and object at) | map-position | — | Optional second object. / Второй объект. |
| `whenVariable` (When variable is on) | variable | `""` | A project variable that must be true (or not 0). / Переменная проекта включена. |
| `whenItem` (When player has) | string-enum | `""` | Item the player must have. / У игрока есть предмет. Варианты: —, Rupees, Heart (refill), Heart container (+1 max), Magic (refill), Bombs, Arrows, Small key, Big Key, Dungeon map, Compass, Sword, Shield, Power glove (lift rocks), Bomb bag (use bombs), Boomerang, Bow, Hookshot, Fire rod, Healing spell, Custom item 1, Custom item 2, Custom item 3, Custom item 4. |
| `whenBoss` (When boss defeated) | boolean | `false` | The boss of the current dungeon (Enter Dungeon) is beaten. / Побеждён босс подземелья. |
| `openDoorAt` (Open door at) | map-position | — | Pick a door on the map. / Открыть дверь. |
| `revealAt` (Reveal object at) | map-position | — | Pick a hidden chest or passage on the map. / Показать скрытый объект. |
| `turnOnVariable` (Turn on variable) | variable | `""` | Set a project variable to true (or 1): PS Maker conditions can check it. / Включить переменную проекта. |
| `giveItem` (Give item) | string-enum | `""` | Item to give. / Выдать предмет. Варианты: —, Rupees, Heart (refill), Heart container (+1 max), Magic (refill), Bombs, Arrows, Small key, Big Key, Dungeon map, Compass, Sword, Shield, Power glove (lift rocks), Bomb bag (use bombs), Boomerang, Bow, Hookshot, Fire rod, Healing spell, Custom item 1, Custom item 2, Custom item 3, Custom item 4. |
| `giveCount` (Item count) | number | `1` | How many to give (rupees, bombs, arrows...). / Сколько. |
| `message` (Message) | string | `""` | Text to show. / Показать сообщение. |
| `spawnEnemy` (Spawn enemy) | string-enum | `""` | Enemy to create. / Создать врага. Варианты: —, slime, soldier, spitter, knight, sentry, ogre, Custom enemy 1, Custom enemy 2, Custom enemy 3, Custom enemy 4, Custom enemy 5, Custom enemy 6. |
| `spawnAt` (Spawn at) | map-position | — | Where the enemy appears. / Где появится. |

## Zelda: Run Actions

Does several things at once, optionally only when a toolkit condition holds (PS Maker conditions cannot read toolkit state). Empty When fields = always. / Несколько действий сразу, можно с условием.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `whenGroup` (When group defeated) | string-enum | `""` | Every enemy of this group is beaten (Group of Create Enemy). / Побеждена вся группа врагов. Варианты: No group, Group 1, Group 2, Group 3, Group 4, Group 5, Group 6, Group 7, Group 8, Group 9. |
| `whenObjectAt` (When object at) | map-position | — | Pick a switch, plate, lever, torch, chest or door on the map: it must be on / open / lit. / Объект включён или открыт. |
| `whenObjectAt2` (…and object at) | map-position | — | Optional second object. / Второй объект. |
| `whenVariable` (When variable is on) | variable | `""` | A project variable that must be true (or not 0). / Переменная проекта включена. |
| `whenItem` (When player has) | string-enum | `""` | Item the player must have. / У игрока есть предмет. Варианты: —, Rupees, Heart (refill), Heart container (+1 max), Magic (refill), Bombs, Arrows, Small key, Big Key, Dungeon map, Compass, Sword, Shield, Power glove (lift rocks), Bomb bag (use bombs), Boomerang, Bow, Hookshot, Fire rod, Healing spell, Custom item 1, Custom item 2, Custom item 3, Custom item 4. |
| `whenBoss` (When boss defeated) | boolean | `false` | The boss of the current dungeon (Enter Dungeon) is beaten. / Побеждён босс подземелья. |
| `openDoorAt` (Open door at) | map-position | — | Pick a door on the map. / Открыть дверь. |
| `revealAt` (Reveal object at) | map-position | — | Pick a hidden chest or passage on the map. / Показать скрытый объект. |
| `turnOnVariable` (Turn on variable) | variable | `""` | Set a project variable to true (or 1): PS Maker conditions can check it. / Включить переменную проекта. |
| `giveItem` (Give item) | string-enum | `""` | Item to give. / Выдать предмет. Варианты: —, Rupees, Heart (refill), Heart container (+1 max), Magic (refill), Bombs, Arrows, Small key, Big Key, Dungeon map, Compass, Sword, Shield, Power glove (lift rocks), Bomb bag (use bombs), Boomerang, Bow, Hookshot, Fire rod, Healing spell, Custom item 1, Custom item 2, Custom item 3, Custom item 4. |
| `giveCount` (Item count) | number | `1` | How many to give (rupees, bombs, arrows...). / Сколько. |
| `message` (Message) | string | `""` | Text to show. / Показать сообщение. |
| `spawnEnemy` (Spawn enemy) | string-enum | `""` | Enemy to create. / Создать врага. Варианты: —, slime, soldier, spitter, knight, sentry, ogre, Custom enemy 1, Custom enemy 2, Custom enemy 3, Custom enemy 4, Custom enemy 5, Custom enemy 6. |
| `spawnAt` (Spawn at) | map-position | — | Where the enemy appears. / Где появится. |

## Zelda: Create Switch Sequence

Switches must be activated in this order; a wrong one resets them. When solved, the filled actions run. Put it after the switches. / Переключатели в заданном порядке (ставить после них).

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `order` (Switches in order) | path | — | Click the switches on the map in the right order. / Переключатели по порядку. |
| `resetOnWrong` (Reset on wrong) | boolean | `true` | Turn all switches off after a wrong one. |
| `openDoorAt` (Open door at) | map-position | — | Pick a door on the map. / Открыть дверь. |
| `revealAt` (Reveal object at) | map-position | — | Pick a hidden chest or passage on the map. / Показать скрытый объект. |
| `turnOnVariable` (Turn on variable) | variable | `""` | Set a project variable to true (or 1): PS Maker conditions can check it. / Включить переменную проекта. |
| `giveItem` (Give item) | string-enum | `""` | Item to give. / Выдать предмет. Варианты: —, Rupees, Heart (refill), Heart container (+1 max), Magic (refill), Bombs, Arrows, Small key, Big Key, Dungeon map, Compass, Sword, Shield, Power glove (lift rocks), Bomb bag (use bombs), Boomerang, Bow, Hookshot, Fire rod, Healing spell, Custom item 1, Custom item 2, Custom item 3, Custom item 4. |
| `giveCount` (Item count) | number | `1` | How many to give (rupees, bombs, arrows...). / Сколько. |
| `message` (Message) | string | `""` | Text to show. / Показать сообщение. |
| `spawnEnemy` (Spawn enemy) | string-enum | `""` | Enemy to create. / Создать врага. Варианты: —, slime, soldier, spitter, knight, sentry, ogre, Custom enemy 1, Custom enemy 2, Custom enemy 3, Custom enemy 4, Custom enemy 5, Custom enemy 6. |
| `spawnAt` (Spawn at) | map-position | — | Where the enemy appears. / Где появится. |

## Zelda: Create Wave Room

A room with enemy waves: draw its area on the map. Doors inside the area stay shut until every wave is beaten; waves start when the player walks in. Add enemies with Zelda: Add Wave Enemy inside the area. / Комната с волнами врагов.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `area` (Room area) | map-rectangle-area | — | Draw the room on the map. / Область комнаты. |
| `startAtOnce` (Start at once) | boolean | `false` | Start when the map loads instead of when the player walks in. / Начать сразу. |
| `delayMs` (Pause between waves (ms)) | number | `800` | Time before the next wave: 1000 = one second. / Пауза между волнами. |
| `openDoorAt` (Open door at) | map-position | — | Pick a door on the map. / Открыть дверь. |
| `revealAt` (Reveal object at) | map-position | — | Pick a hidden chest or passage on the map. / Показать скрытый объект. |
| `turnOnVariable` (Turn on variable) | variable | `""` | Set a project variable to true (or 1): PS Maker conditions can check it. / Включить переменную проекта. |
| `giveItem` (Give item) | string-enum | `""` | Item to give. / Выдать предмет. Варианты: —, Rupees, Heart (refill), Heart container (+1 max), Magic (refill), Bombs, Arrows, Small key, Big Key, Dungeon map, Compass, Sword, Shield, Power glove (lift rocks), Bomb bag (use bombs), Boomerang, Bow, Hookshot, Fire rod, Healing spell, Custom item 1, Custom item 2, Custom item 3, Custom item 4. |
| `giveCount` (Item count) | number | `1` | How many to give (rupees, bombs, arrows...). / Сколько. |
| `message` (Message) | string | `""` | Text to show. / Показать сообщение. |
| `spawnEnemy` (Spawn enemy) | string-enum | `""` | Enemy to create. / Создать врага. Варианты: —, slime, soldier, spitter, knight, sentry, ogre, Custom enemy 1, Custom enemy 2, Custom enemy 3, Custom enemy 4, Custom enemy 5, Custom enemy 6. |
| `spawnAt` (Spawn at) | map-position | — | Where the enemy appears. / Где появится. |

## Zelda: Add Wave Enemy

Adds one enemy to a wave: it belongs to the wave room whose area contains its position. / Добавляет врага в волну комнаты, в которой стоит.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `wave` (Wave) | number | `1` | Wave number: 1 = first wave, 2 = second... / Номер волны. |
| `template` (Template) | string-enum | `"slime"` | Behaviour and stats. / Шаблон врага. Варианты: slime, soldier, spitter, knight, sentry, ogre, Custom enemy 1, Custom enemy 2, Custom enemy 3, Custom enemy 4, Custom enemy 5, Custom enemy 6. |
| `position` (Position) | map-position | — | Spawn point inside the room: pick it on the map. / Точка появления. |
| `hp` (Health) | number | `0` | Hit points; 0 = template value. / Здоровье (0 — как в шаблоне). |
| `damage` (Damage) | number | `0` | Damage to the player; 0 = template value. / Урон (0 — как в шаблоне). |
| `speed` (Speed) | number | `0` | Pixels per second; 0 = template value. / Скорость (0 — как в шаблоне). |

## Zelda: Enter Dungeon

Marks the current dungeon: small keys and the Big Key are counted per dungeon. Overworld = back outside. / Вход в подземелье.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `dungeonId` (Dungeon) | string-enum | `"dungeon_1"` | Keys, map and boss are counted per dungeon. / Подземелье. Варианты: Overworld (no dungeon), Dungeon 1, Dungeon 2, Dungeon 3, Dungeon 4, Dungeon 5, Dungeon 6, Dungeon 7, Dungeon 8, Dungeon 9. |
| `completeOnBoss` (Complete on boss) | boolean | `true` | Defeating a boss enemy completes the dungeon. |

## Zelda: Give Item

Gives an item or resource. / Выдаёт предмет.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `item` (Item) | string-enum | `"bombs"` | What to give. / Предмет. Варианты: Rupees, Heart (refill), Heart container (+1 max), Magic (refill), Bombs, Arrows, Small key, Big Key, Dungeon map, Compass, Sword, Shield, Power glove (lift rocks), Bomb bag (use bombs), Boomerang, Bow, Hookshot, Fire rod, Healing spell, Custom item 1, Custom item 2, Custom item 3, Custom item 4. |
| `count` (Count) | number | `1` | How many (rupees, bombs, arrows...). / Сколько. |
| `silent` (Silent) | boolean | `false` | Do not show the 'You got...' message. |

## Zelda: Spend Resource

Removes resources if there are enough (rupees, bombs, arrows, magic, key). / Тратит ресурс.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `resource` (Resource) | string-enum | `"rupees"` | What to spend. / Ресурс. Варианты: Rupees, Bombs, Arrows, Magic, Small keys. |
| `amount` (Amount) | number | `1` | How many. / Сколько. |

## Zelda: Remove Item

Takes an owned item away. / Забирает предмет.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `item` (Item) | string-enum | `"boomerang"` | Which item. / Предмет. Варианты: Sword, Shield, Power glove, Bombs, Boomerang, Bow, Hookshot, Fire rod, Healing spell, Custom item 1, Custom item 2, Custom item 3, Custom item 4. |

## Zelda: Equip Item

Puts an owned item into the quick-use slot. / Ставит предмет в быстрый слот.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `item` (Item) | string-enum | `"boomerang"` | Which item. / Предмет. Варианты: Sword, Shield, Power glove, Bombs, Boomerang, Bow, Hookshot, Fire rod, Healing spell, Custom item 1, Custom item 2, Custom item 3, Custom item 4. |

## Zelda: Change Player Stats

Adds to (or, with Set, replaces) the player's health, maximum health and magic. Health is in half-hearts: 2 = one heart. 0 = no change. / Здоровье и магия игрока.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `health` (Health) | number | `0` | Half-hearts to add (negative = damage). / Здоровье в половинках сердца. |
| `maxHealth` (Max health) | number | `0` | Half-hearts added to the maximum (also refills). / Максимум здоровья. |
| `magic` (Magic) | number | `0` | Magic points to add. / Магия. |
| `set` (Set instead of add) | boolean | `false` | Use the numbers as new values (fields left at 0 are not changed). / Установить вместо прибавления. |

## Zelda: Set Ability

Enables or disables an ability/item (sword, shield, bow, bomb...). / Включает/отключает способность.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `ability` (Ability) | string-enum | `"sword"` | Which item or ability. / Способность. Варианты: Sword, Shield, Power glove, Bombs, Boomerang, Bow, Hookshot, Fire rod, Healing spell, Custom item 1, Custom item 2, Custom item 3, Custom item 4. |
| `enabled` (Enabled) | boolean | `true` | Allow using it. / Разрешить. |

## Zelda: Show Message

Shows a short HUD message (not a PS Maker dialogue box). / Короткое сообщение в HUD.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `text` (Text) | string | `""` | Message to show. / Текст сообщения. |
| `durationMs` (Duration (ms)) | number | `2200` | How long it stays: 1000 = one second. / Сколько показывать. |

## Zelda: Show Stat In Variable

Keeps a project variable equal to a toolkit value (rupees, keys, hearts...). Use it in PS Maker conditions (a shop: if Rupees ≥ 50) or in UI components. Stays on for the whole game. / Значение Toolkit в переменной проекта.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `stat` (Value) | string-enum | `"rupees"` | What to copy. / Что показывать. Варианты: Rupees, Bombs, Arrows, Small keys (this dungeon), Hearts, Max hearts, Magic, Enemies left on the map. |
| `variableId` (Variable) | variable | `""` | A number variable of the project (true/false for 0 / not 0). / Переменная проекта. |

## Zelda: Set Respawn Point

Where the player revives after falling in battle on this map (empty = current position). / Точка возрождения.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `position` (Position) | map-position | — | Respawn point. |

## Zelda: Respawn Player

Revives the player at the respawn point (for deathBehavior 'none'). / Возрождает игрока.

_Без параметров._

## Zelda: Save Progress

Saves toolkit progress (health, items, chests, doors, switches, dungeons) to the browser. / Сохраняет прогресс.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `slot` (Slot) | string-enum | `"default"` | Save slot. / Ячейка сохранения. Варианты: Slot 1, Slot 2, Slot 3. |

## Zelda: Load Progress

Loads toolkit progress saved earlier. / Загружает прогресс.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `slot` (Slot) | string-enum | `"default"` | Save slot. / Ячейка сохранения. Варианты: Slot 1, Slot 2, Slot 3. |

## Zelda: Reset Progress

Deletes a save slot and optionally starts a new game. / Удаляет сохранение.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `slot` (Slot) | string-enum | `"default"` | Save slot. / Ячейка сохранения. Варианты: Slot 1, Slot 2, Slot 3. |
| `newGame` (New game) | boolean | `true` | Also reset current progress. |

## Zelda: Define Item

Adds a usable item without code: a shot (Damage > 0), a burst around the player (Area attack) or a healing item (Heal > 0). With none of these it is a quest item. / Свой предмет без кода.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `slot` (Item) | string-enum | `"custom_item_1"` | Which custom item this defines; then pick it in Give Item, chests, rules. / Какой свой предмет. Варианты: Custom item 1, Custom item 2, Custom item 3, Custom item 4. |
| `name` (Name) | string | `"Ice Rod"` | Shown in messages and the inventory. / Название. |
| `icon` (Icon) | image | — | Optional icon image. / Иконка. |
| `resource` (Uses) | string-enum | `"magic"` | What one use costs. / Что расходует. Варианты: Nothing, Rupees, Bombs, Arrows, Magic, Small keys. |
| `cost` (Cost) | number | `4` | How much of it per use (magic meter: 32 points). / Стоимость. |
| `damage` (Damage) | number | `3` | Damage of the shot or burst; 0 = no attack. / Урон. |
| `damageType` (Damage type) | string-enum | `"magic"` | Enemies may resist some types. / Тип урона. Варианты: sword, spin, poke, arrow, bomb, boomerang, hookshot, fire, ice, magic, thrown, contact, projectile, hazard, fall, script. |
| `area` (Area attack) | boolean | `false` | Hit everything around the player instead of shooting. / Удар вокруг игрока. |
| `stunMs` (Stun (ms)) | number | `0` | Freeze hit enemies; 1000 = one second. |
| `heal` (Heal) | number | `0` | Half-hearts restored per use (makes it a healing item). / Лечение. |
| `give` (Give now) | boolean | `false` | Also give the item to the player. |

## Zelda: Define Enemy

Makes your own enemy type from an existing one: other stats and a PS Maker character's look. Then choose it as Template in Create Enemy. / Свой тип врага.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `slot` (Enemy type) | string-enum | `"custom_enemy_1"` | Which custom type this defines. / Какой свой тип. Варианты: Custom enemy 1, Custom enemy 2, Custom enemy 3, Custom enemy 4, Custom enemy 5, Custom enemy 6. |
| `basedOn` (Based on) | string-enum | `"soldier"` | Behaviour to start from. / На основе шаблона. Варианты: slime, soldier, spitter, knight, sentry, ogre, Custom enemy 1, Custom enemy 2, Custom enemy 3, Custom enemy 4, Custom enemy 5, Custom enemy 6. |
| `look` (Look (PS Maker character)) | npc | — | Optional: a character from your library; its animations and collision box are used. / Внешний вид — персонаж PS Maker. |
| `hp` (Health) | number | `0` | Hit points; 0 = template value. / Здоровье (0 — как в шаблоне). |
| `damage` (Damage) | number | `0` | Damage to the player; 0 = template value. / Урон (0 — как в шаблоне). |
| `speed` (Speed) | number | `0` | Pixels per second; 0 = template value. / Скорость (0 — как в шаблоне). |
| `detectRange` (Sight range) | number | `0` | Pixels at which it notices the player; 0 = template value. / Дальность обзора. |
| `boss` (Boss) | boolean | `false` | Defeating it completes the dungeon (with Enter Dungeon). / Босс. |
| `immuneTo` (Immune to) | string-enum-multi | `[]` | Damage types that do nothing to it. / Неуязвим к. Варианты: sword, spin, poke, arrow, bomb, boomerang, hookshot, fire, ice, magic, thrown, contact, projectile, hazard, fall, script. |
| `spriteOffsetX` (Sprite offset X) | number | `0` | Move the picture relative to the hitbox, pixels. / Сдвиг картинки по X. |
| `spriteOffsetY` (Sprite offset Y) | number | `0` | e.g. -16 when the feet are low in a 64x64 frame. / Сдвиг картинки по Y. |
| `spriteScale` (Sprite scale) | number | `0` | 0 = template value (1). / Масштаб картинки. |

## Zelda: Set Player Sprites

Player animations from PS Maker (e.g. Mana Seed Sword Attack) for sword, items, lifting, pushing, shield and death: pick any direction, all directions of that sheet are used. Empty = not used (the normal PS Maker sprite or the built-in blade). / Анимации игрока из PS Maker.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `attack` (Attack) | player-animation-picker | `""` | Sword swing, e.g. Sword Attack. / Удар мечом. |
| `spin` (Spin attack) | player-animation-picker | `""` | Optional; empty = Attack. / Круговой удар. |
| `charge` (Charging) | player-animation-picker | `""` | Optional: while the sword is held; empty = last Attack frame. / Зарядка удара. |
| `chargeWalk` (Walking while charging) | player-animation-picker | `""` | Optional: walking with the sword held, e.g. Sword Walk; empty = normal walk with the built-in blade. / Ходьба с заряженным мечом. |
| `hurt` (Hurt) | player-animation-picker | `""` | Optional, e.g. Sword Hurt. / Получение урона. |
| `death` (Death) | player-animation-picker | `""` | Optional, e.g. Sword Death; the last frame stays until respawn. / Смерть. |
| `shield` (Shield up) | player-animation-picker | `""` | Optional: while the shield button is held (Start Toolkit: Shield on a button). / Щит поднят. |
| `bow` (Bow) | player-animation-picker | `""` | Optional: shooting an arrow; empty = Use item. / Лук. |
| `boomerang` (Boomerang) | player-animation-picker | `""` | Optional: throwing the boomerang; empty = Use item. / Бумеранг. |
| `bomb` (Bomb) | player-animation-picker | `""` | Optional: placing a bomb; empty = Use item. / Бомба. |
| `hookshot` (Hookshot) | player-animation-picker | `""` | Optional: firing the hookshot; empty = Use item. / Крюк. |
| `item` (Use item) | player-animation-picker | `""` | Optional: any other item (rods, magic, your own items) and the fallback for the four above. / Использование предмета. |
| `lift` (Lift) | player-animation-picker | `""` | Optional: picking up a pot, bush or rock. / Поднять. |
| `carry` (Carry) | player-animation-picker | `""` | Optional: walking with the object overhead; stands on the first frame. / Нести над головой. |
| `throw` (Throw) | player-animation-picker | `""` | Optional: throwing what you carry. / Бросить. |
| `push` (Push) | player-animation-picker | `""` | Optional: leaning on a block to push it. / Толкать блок. |
| `itemGet` (Item get) | player-animation-picker | `""` | Optional: holding up an item from a chest for a second (the player stands still meanwhile). / Достать предмет из сундука. |
| `weaponAttack` (Weapon layer: attack) | animation | `""` | Optional: a separate weapon sheet drawn over the body (when the weapon is not in the body frames). / Слой оружия: удар. |
| `weaponSpin` (Weapon layer: spin) | animation | `""` | Optional. / Слой оружия: круговой. |
| `weaponCharge` (Weapon layer: charging) | animation | `""` | Optional. / Слой оружия: зарядка. |
| `behindUp` (Weapon behind when facing up) | boolean | `true` | Draw the weapon layer behind the body. / Оружие за телом (вверх). |
| `behindDown` (Weapon behind when facing down) | boolean | `false` | Draw the weapon layer behind the body. / Оружие за телом (вниз). |
| `behindLeft` (Weapon behind when facing left) | boolean | `false` | Draw the weapon layer behind the body. / Оружие за телом (влево). |
| `behindRight` (Weapon behind when facing right) | boolean | `false` | Draw the weapon layer behind the body. / Оружие за телом (вправо). |
| `hidePlayer` (Hide PS Maker sprite) | boolean | `true` | Hide the normal sprite while an animation plays. / Скрывать обычный спрайт. |
| `offsetX` (Offset X) | number | `0` | Move the animation, pixels. / Сдвиг по X. |
| `offsetY` (Offset Y) | number | `0` | Move the animation, pixels. / Сдвиг по Y. |
| `pivotX` (Swing center X) | number | `0` | Move the point the sword swings around, pixels. / Центр взмаха по X. |
| `pivotY` (Swing center Y) | number | `0` | e.g. 4 to swing from lower on the body. / Центр взмаха по Y. |

## Zelda: Set Sound

Plays a sound at a toolkit moment: swordSwing, spinAttack, enemyHurt, enemyDefeated, playerHurt, playerDie, shieldBlock, bombExplode, objectBreak, pickup, itemGet, chestOpen, doorUnlock, puzzleSolved. Leave Audio empty to remove it. / Звук для момента игры.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `moment` (Moment) | string-enum | `"swordSwing"` | When the sound plays. / Когда звучит. Варианты: swordSwing, spinAttack, enemyHurt, enemyDefeated, playerHurt, playerDie, shieldBlock, bombExplode, objectBreak, pickup, itemGet, chestOpen, doorUnlock, puzzleSolved. |
| `sound` (Sound) | audio | — | Audio asset. |
| `volume` (Volume) | number | `1` | 0 = silent, 1 = full volume, 0.5 = half. / Громкость. |

