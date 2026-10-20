# Правила, головоломки и подземелья

Ветвить события PS Maker по состоянию плагина нельзя (API не даёт регистрировать условия), поэтому логика уровней собирается из **правил Toolkit**: «когда условие станет истинным — выполнить действия».

## Позиции: координаты и маркеры

Для действий плагинов PS Maker показывает параметр *Position* как два числовых поля X/Y (кнопки **Set position**, как у встроенных событий, у плагинов нет — проверено в редакторе, PS Maker с плагином 0.2.0). Чтобы не подбирать числа вручную, включите в игре оверлей **F9** и **кликните по карте**: точка отметится, появится «X: … Y: …», а `x, y` скопируется в буфер обмена. Где точка нужна в правиле или маршруте патруля, поставьте `Zelda: Place Marker` один раз и дальше ссылайтесь на неё по имени (`"at": "boss_spot"`, *Patrol markers* = `p1,p2`).

Маркеры принадлежат карте, поэтому ставьте их в On-load событиях **до** действий, которые на них ссылаются. Числовые `"x"`/`"y"` по-прежнему принимаются.

Выяснить, есть ли у плагинов тип параметра со штатным выбором на карте, поможет зонд `tools/param-probe` — см. [TESTING.md](TESTING.md), сценарий M-14.

## Правило

`Zelda: Add Rule`:

| Поле | Пример |
|---|---|
| Rule ID | `open_gate` |
| When (JSON) | `{"switchOn":"gate_switch"}` |
| Then (JSON) | `[{"openDoor":"gate"},{"message":"Ворота открылись!"}]` |
| Else (JSON) | `[{"closeDoor":"gate"}]` — когда условие снова станет ложным |
| Once | `true` — сработать один раз (запоминается в сохранении флагом `rule:<id>`) |

Правила вычисляются только после событий Toolkit (не каждый кадр) и срабатывают по фронту: `false → true` запускает `then`, `true → false` — `else` (для `Once = false`).

Мгновенная проверка без правила — `Zelda: If`; выполнение списка действий — `Zelda: Run Actions`.

## Условия

Объект с несколькими ключами = все условия одновременно (И).

| Условие | Пример | Истинно, когда |
|---|---|---|
| `all` / `any` / `not` | `{"all":[{"flag":"a"},{"not":{"flag":"b"}}]}` | логика |
| `always` | `{"always":true}` | всегда |
| `flag` | `"lever_on"` или `{"name":"stage","equals":2}` | флаг истинен / равен |
| `notFlag` | `"door_seen"` | флаг не установлен |
| `switchOn` / `objectActive` / `chestOpened` / `doorOpen` | `"plate_1"` или `["plate_1","plate_2"]` | все объекты в активном состоянии (on/opened/unlocked/lit/destroyed/revealed) |
| `objectState` | `{"id":"torch_1","state":"lit"}` | точное состояние |
| `objectDestroyed` | `["pot_1","pot_2"]` | объекты разрушены |
| `enemiesDefeated` | `"room1"` | в группе был хотя бы один враг и живых не осталось |
| `enemyAlive` | `"boss"` | враг жив |
| `enemyState` | `{"id":"knight_1","state":"stunned"}` | состояние ИИ (idle, patrol, alert, chase, windup, attack, recover, hurt, stunned, dead) |
| `hasItem` | `"bow"` или `{"item":"rupees","count":50}` | есть предмет/количество |
| `resource` | `{"id":"arrows","lte":0}` | сравнение `gte/lte/gt/lt/eq` |
| `playerHealth` | `{"lte":2}` | здоровье игрока |
| `abilityEnabled` | `"bomb"` | способность не отключена |
| `bossDefeated` / `dungeonCompleted` | `"d1"` (или текущее подземелье) | |
| `puzzleSolved` | `"seq_1"` | последовательность решена |

## Действия

| Действие | Аргумент |
|---|---|
| `openDoor` / `closeDoor` / `unlockDoor` | id или массив id |
| `reveal` / `hide` | id объекта (скрытый сундук, проход) |
| `destroyObject` / `resetObject` / `removeObject` | id или массив |
| `setState` | `{"id":"lever_1","state":"on"}` |
| `activateSwitch` | `"switch_a"` или `{"id":"switch_a","on":false}` |
| `createObject` | `{"type":"chest","id":"c2","at":"reward_spot","contents":{"item":"key","count":1}}` (+ любые поля ObjectConfig) |
| `setFlag` / `clearFlag` / `toggleFlag` | `"name"` или `{"name":"stage","value":2}` |
| `spawnEnemy` | `{"template":"slime","at":"m1","id":"s9","group":"room2","overrides":{"hp":4}}` |
| `killEnemy` / `killGroup` | id / группа |
| `giveItem` | `"bow"` или `{"item":"bombs","count":5,"silent":true}` |
| `spendResource` | `{"id":"rupees","count":20}` |
| `spawnPickup` | `{"item":"heart","at":"m2","id":"optional_persistent_id"}` |
| `enableAbility` | `{"ability":"sword","enabled":false}` |
| `heal` / `damagePlayer` | число |
| `setRespawn` | `"start_spot"` или `{"at":"start_spot"}` |
| `message` | `"Текст"` или `{"text":{"en":"...","ru":"..."},"durationMs":3000}` |
| `emit` | `"cutscene_done"` → событие `zelda:custom:cutscene_done` |
| `enterDungeon` / `completeDungeon` | id |
| `startWaves` | id комнаты волн |
| `save` | `true` |
| `if` | `{"when":{...},"then":[...],"else":[...]}` |

Точка в действиях — `"at": "<маркер>"`; запасной вариант — `"x"`, `"y"` в пикселях или тайлах (`world.positionUnits`).

## Последовательность переключателей

`Zelda: Create Switch Sequence`: ID `seq_1`, Switch IDs `s1,s2,s3`, Reset on wrong `true`, On solved `[{"openDoor":"door_3"}]`. Неверный переключатель выключает все переключатели последовательности; решение запоминается флагом `puzzle:seq_1`.

## Комнаты с волнами

1. `Zelda: Create Wave Room`: Room ID `arena`, Doors to lock `arena_door`, Start at once `false`, On cleared `[{"reveal":"arena_chest"}]`.
2. Для каждого врага — `Zelda: Add Wave Enemy`: Room ID `arena`, Wave `1`/`2`/…, Template, **Position** (X/Y; координаты удобно взять кликом по карте при F9), Overrides (необязательно).
3. На входе в комнату — триггерная зона PS Maker с действием `Zelda: Start Waves` (`arena`). С *Start at once* = `true` волны начнутся сразу после загрузки карты (после всех On-load действий).

Двери из списка закрываются на время боя и открываются после последней волны. Зачищенная комната запоминается флагом `waves:<id>`. Поле *Advanced JSON* принимает `{"delayMs":1000}` или целые волны `{"waves":[[{"template":"slime","at":"m1"}]]}`.

## Подземелья

`Zelda: Enter Dungeon` (ID, Complete on boss) — малые ключи, большой ключ, карта и компас считаются отдельно для каждого подземелья. Враг с `boss: true` (шаблон `ogre` или свой) при победе отмечает босса побеждённым и (по умолчанию) завершает подземелье: событие `zelda:dungeon:completed`, сообщение, автосохранение. `Zelda: Leave Dungeon` — вернуться к «наземному» счётчику ключей.

## Готовые рецепты

**Блок на плиту → дверь**
```
Zelda: Create Object  type=block            id=block_1
Zelda: Create Object  type=pressure_plate   id=plate_1   config={"plateMode":"latch"}
Zelda: Create Door    id=door_1 lock=switch
Zelda: Add Rule       when={"switchOn":"plate_1"}  then=[{"openDoor":"door_1"}]
```

**Бомба в стену → проход**
```
Zelda: Create Object  type=bombable_wall  id=crack_1   (разрушенная стена становится проходом сама)
```

**Победить всех → появляется сундук**
```
Zelda: Create Enemy   template=soldier group=room1  (×3)
Zelda: Create Chest   id=reward item=key hidden=true
Zelda: Add Rule       when={"enemiesDefeated":"room1"}  then=[{"reveal":"reward"}]
```

**Зажечь все факелы → лестница**
```
Zelda: Create Object  type=torch id=t1 / t2
Zelda: Create Object  type=hidden_passage id=stairs
Zelda: Add Rule       when={"switchOn":["t1","t2"]}  then=[{"reveal":"stairs"}]
```
