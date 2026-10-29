# Правила, головоломки и подземелья

Логика уровней собирается как в конструкторе: объекты выбираются кликом по карте, группы и предметы — из списков, состояние для PS Maker — через переменные проекта. Писать имена и id не нужно.

## Как выбираются объекты

- **Position** и все поля «… at» — кнопка выбора точки на карте. Toolkit находит объект в этой точке (или ближайший в 12 px), причём учитывает, о чём поле: *Open door at* ищет дверь, *Reveal object at* — скрытый объект, условия не путают плиту с блоком, задвинутым на неё. Поэтому ставьте объект и правило про него в любом порядке — объект ищется, когда правило проверяется.
- Прогресс (открытые сундуки и двери, побеждённые боссы) запоминается по типу и месту объекта на карте, отдельно для каждой карты.
- Запасной способ узнать координаты — в игре **F9** и клик по карте: «X: … Y: …» копируется в буфер обмена. Отрицательные X/Y на картах PS Maker — норма.

## Связь с PS Maker: переменные проекта

- *When variable is on* — условие по переменной проекта (истинно: `true`, число ≠ 0).
- *Turn on variable* и *On use: turn on variable* у объектов — Toolkit ставит переменной `true` (или 1). Её видят условия PS Maker (if/else в событиях), UI-компоненты и сохранения PS Maker.
- `Zelda: Show Stat In Variable` — держит переменную равной значению Toolkit: рупии, бомбы, стрелы, ключи, сердца, магия, оставшиеся враги. Пример — магазин на событиях PS Maker: условие «Рупии ≥ 50» → `Zelda: Spend Resource` 50 + `Zelda: Give Item`.

## Поля условий и действий

Одинаковые у `Zelda: Add Rule` и `Zelda: Run Actions` (только действия — у `Create Switch Sequence` и `Create Wave Room`). Пустое поле не участвует.

**Условия (When)** — должны выполняться все заполненные:

| Поле | Истинно, когда |
|---|---|
| When group defeated | побеждены все враги группы (Group 1–9 у `Create Enemy`) |
| When object at / …and object at | выбранные на карте объекты активны: переключатель или плита включены, дверь или сундук открыты, факел горит, разрушаемое разрушено |
| When variable is on | переменная проекта включена |
| When player has | у игрока есть предмет (список) |
| When boss defeated | побеждён босс текущего подземелья (`Enter Dungeon`) |

**Действия (Then)** — выполняются все заполненные:

| Поле | Что делает |
|---|---|
| Open door at | открывает дверь, выбранную на карте |
| Reveal object at | показывает скрытый объект (сундук с *Hidden*, `hidden_passage`) |
| Turn on variable | включает переменную проекта |
| Give item + Item count | выдаёт предмет или ресурс |
| Message | показывает сообщение |
| Spawn enemy + Spawn at | создаёт врага в точке на карте |

## Правило

`Zelda: Add Rule`: поля условий, поля действий, *Once* (сработать один раз; запоминается в сохранении). Без хотя бы одного условия правило не создаётся — в диагностике будет предупреждение. Правила проверяются после событий Toolkit (не каждый кадр) и срабатывают по фронту: переход «ложно → истинно» запускает действия.

`Zelda: Run Actions` — то же без ожидания: проверить условия сейчас и выполнить действия (пустые условия = всегда). Нужен там, где событие PS Maker (триггер, диалог) должно сделать что-то в Toolkit.

## Последовательность переключателей

`Zelda: Create Switch Sequence`: *Switches in order* — путь по карте: кликните переключатели в правильном порядке; *Reset on wrong*; поля действий (например, *Open door at*). Ставьте действие **после** переключателей. Неверный переключатель выключает все переключатели последовательности; решение запоминается.

## Комнаты с волнами

1. `Zelda: Create Wave Room`: *Room area* — нарисуйте комнату на карте; *Pause between waves (ms)*; поля действий после последней волны (например, *Reveal object at* — сундук или *Spawn enemy* `ogre` + *Spawn at*).
2. Для каждого врага — `Zelda: Add Wave Enemy`: *Wave* (1, 2, …), *Template*, **Position** внутри комнаты; при желании *Health* / *Damage* / *Speed*. Комната определяется по точке — указывать её не нужно.
3. Волны начинаются, когда игрок входит в область (или сразу с *Start at once*). Двери внутри области закрываются на время боя и открываются после последней волны. Зачищенная комната запоминается.

## Подземелья

`Zelda: Enter Dungeon` (*Dungeon*: Dungeon 1–9 или Overworld, *Complete on boss*) — малые ключи, большой ключ, карта и компас считаются отдельно для каждого подземелья. Враг с `boss: true` (шаблон `ogre` или свой) при победе отмечает босса побеждённым и (по умолчанию) завершает подземелье: событие `zelda:dungeon:completed`, сообщение, автосохранение. *Overworld* — вернуться к «наземному» счётчику ключей.

## Готовые рецепты

**Блок на плиту → дверь**
```
Zelda: Create Object  Type: Block           Position: ●
Zelda: Create Object  Type: Pressure plate  Position: ●   [x] Stays on   On use: open door at: ● (дверь)
Zelda: Create Door    Lock: Switch / rule   Position: ●
```

**Бомба в стену → проход**
```
Zelda: Create Object  Type: Bombable wall  Position: ●   (разрушенная стена становится проходом сама)
```

**Победить всех → появляется сундук**
```
Zelda: Create Enemy   Template: Soldier  Group: Group 1  Position: ●   (×3)
Zelda: Create Chest   Item: Small key  [x] Hidden  Position: ●
Zelda: Add Rule       When group defeated: Group 1    Reveal object at: ● (сундук)
```

**Зажечь два факела → лестница**
```
Zelda: Create Object  Type: Torch           Position: ●  (×2)
Zelda: Create Object  Type: Hidden passage  Position: ●
Zelda: Add Rule       When object at: ● (факел 1)  …and object at: ● (факел 2)   Reveal object at: ● (лестница)
```

**Глаз-переключатель от стрелы**
```
Zelda: Create Object  Type: Reactive  Reacts to: Arrow  On use: open door at: ●
```

**Магазин на событиях PS Maker**
```
Zelda: Show Stat In Variable   Value: Rupees  Variable: Рупии        (один раз, в начале игры)
Событие продавца: Если «Рупии» ≥ 50 → Zelda: Spend Resource (Rupees, 50) → Zelda: Give Item (Bow)
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
| `if` | `{"when":{...},"then":[...],"else":[...]}` |

Точка в действиях — `"at": "<маркер>"`; запасной вариант — `"x"`, `"y"` в пикселях или тайлах (`world.positionUnits`).
