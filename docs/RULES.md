# Правила, головоломки и подземелья

Ветвить события PS Maker по состоянию плагина нельзя (API не даёт регистрировать условия), поэтому логика уровней собирается из **правил Toolkit**: «когда условие станет истинным — выполнить действия». С версии 0.5.0 всё заполняется обычными полями формы — JSON писать не нужно.

## Позиции: координаты и маркеры

*Position* выбирается на карте кнопкой, как у встроенных событий (с 0.6.0). Запасной способ — в игре **F9** и клик по карте: «X: … Y: …» копируется в буфер обмена. На картах PS Maker начало координат может быть в центре карты, поэтому отрицательные X/Y — нормально.

`Zelda: Place Marker` даёт точке имя: его используют *Patrol markers* у `Create Enemy` и поле *Spawn at marker* у правил. Маркеры принадлежат карте — ставьте их **до** действий, которые на них ссылаются.

## Поля условий и действий

Одинаковые у `Zelda: Add Rule`, `Zelda: Run Actions` (только «Then»-часть у `Create Switch Sequence` и `Create Wave Room`). Пустое поле не участвует.

**Условия (When)** — должны выполняться все заполненные:

| Поле | Истинно, когда |
|---|---|
| When group defeated | побеждены все враги группы (поле *Group* у `Create Enemy`) |
| When objects active | все перечисленные объекты активны: переключатели и плиты включены, двери и сундуки открыты, факелы горят, разрушаемое разрушено (`plate_1, plate_2`) |
| When flag set | флаг установлен (`Set Flag`, поле *On use: set flag* у объектов, решённая последовательность — `puzzle:<id>`, зачищенная комната — `waves:<id>`) |
| When player has | у игрока есть предмет (`bow`, `big_key`) |
| When boss defeated | побеждён босс текущего подземелья (`Enter Dungeon`) |

**Действия (Then)** — выполняются все заполненные:

| Поле | Что делает |
|---|---|
| Open doors | открывает двери (`door_1, door_2`) |
| Reveal | показывает скрытые объекты (сундук с *Hidden*, `hidden_passage`) |
| Set flag | ставит флаг |
| Give item + Item count | выдаёт предмет или ресурс |
| Message | показывает сообщение |
| Spawn enemy + Spawn at marker | создаёт врага по шаблону в точке маркера |

## Правило

`Zelda: Add Rule`: *Rule ID*, поля условий, поля действий, *Once* (сработать один раз; запоминается в сохранении флагом `rule:<id>`). Без хотя бы одного условия правило не создаётся — в диагностике будет предупреждение.

Правила вычисляются только после событий Toolkit (не каждый кадр) и срабатывают по фронту: переход `false → true` запускает действия.

`Zelda: Run Actions` — то же без ожидания: проверить условия сейчас и выполнить действия (пустые условия = выполнить всегда). Нужен там, где событие PS Maker (триггер, диалог) должно сделать что-то в Toolkit с проверкой его состояния.

## Последовательность переключателей

`Zelda: Create Switch Sequence`: *Puzzle ID* `seq_1`, *Switch IDs* `s1, s2, s3`, *Reset on wrong*, плюс поля действий (например, *Open doors* `door_3`). Неверный переключатель выключает все переключатели последовательности; решение запоминается флагом `puzzle:seq_1`.

## Комнаты с волнами

1. `Zelda: Create Wave Room`: *Room ID* `arena`, *Doors to lock* `arena_door`, *Start at once*, *Pause between waves (ms)*, плюс поля действий после последней волны (например, *Reveal* `arena_chest` или *Spawn enemy* `ogre` + *Spawn at marker* `boss_spot`).
2. Для каждого врага — `Zelda: Add Wave Enemy`: *Room ID*, *Wave* `1`/`2`/…, *Template*, **Position**, при желании *Health*/*Damage*/*Speed*.
3. На входе в комнату — триггерная зона PS Maker с действием `Zelda: Start Waves` (`arena`). С *Start at once* волны начнутся сразу после загрузки карты (после всех действий начала карты).

Двери из списка закрываются на время боя и открываются после последней волны. Зачищенная комната запоминается флагом `waves:<id>`.

## Подземелья

`Zelda: Enter Dungeon` (ID, Complete on boss) — малые ключи, большой ключ, карта и компас считаются отдельно для каждого подземелья. Враг с `boss: true` (шаблон `ogre` или свой) при победе отмечает босса побеждённым и (по умолчанию) завершает подземелье: событие `zelda:dungeon:completed`, сообщение, автосохранение. `Zelda: Enter Dungeon` с пустым ID — вернуться к «наземному» счётчику ключей.

## Готовые рецепты

**Блок на плиту → дверь**
```
Zelda: Create Object  Type: block            ID: block_1
Zelda: Create Object  Type: pressure_plate   ID: plate_1   [x] Stays on
Zelda: Create Door    ID: door_1             [x] Opened by switch
Zelda: Add Rule       When objects active: plate_1    Open doors: door_1
```
Короче — без правила: у плиты *On use: open doors* = `door_1`.

**Бомба в стену → проход**
```
Zelda: Create Object  Type: bombable_wall  ID: crack_1   (разрушенная стена становится проходом сама)
```

**Победить всех → появляется сундук**
```
Zelda: Create Enemy   Template: soldier  Group: room1   (×3)
Zelda: Create Chest   ID: reward  Item: key  [x] Hidden
Zelda: Add Rule       When group defeated: room1    Reveal: reward
```

**Зажечь все факелы → лестница**
```
Zelda: Create Object  Type: torch  ID: t1 / t2
Zelda: Create Object  Type: hidden_passage  ID: stairs  [x] Hidden
Zelda: Add Rule       When objects active: t1, t2    Reveal: stairs
```

**Глаз-переключатель от стрелы**
```
Zelda: Create Object  Type: reactive  ID: eye  Reacts to: arrow  On use: open doors: door_2
```

## Для кода: полный словарь правил

Поля формы покрывают частые случаи. Сложная логика (ИЛИ, НЕ, сравнения, состояния ИИ, «иначе») доступна из кода — расширения-плагина или события PS Maker с JavaScript, если оно есть в вашей версии:

```js
ZeldaMakerToolkit.addRule({
  id: "low_hp_hint",
  when: { playerHealth: { lte: 2 }, not: { flag: "hint_shown" } },
  then: [{ message: "Найди сердце в кустах!" }, { setFlag: "hint_shown" }],
});
ZeldaMakerToolkit.runActions([{ spawnPickup: { item: "heart", at: "m2" } }]);
```

Объект с несколькими ключами = все условия одновременно (И). Точка в действиях — `"at": "<маркер>"` или `"x"`, `"y"`.

### Условия

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

### Действия

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
