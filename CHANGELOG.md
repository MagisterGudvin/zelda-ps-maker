# Changelog

Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — [SemVer](https://semver.org/lang/ru/).

## [0.5.3] — 2026-10-25

По скриншоту playtest 0.5.2: данные проекта найдены (`scene.data.story`), но PS Maker снова вызвал только `Start Toolkit` (×5), а `Create Enemy` — ни разу, без ошибок.

### Добавлено
- **Запуск действий из данных карты.** Toolkit читает сохранённые события текущей карты (`scene.data.story.maps`, карта = ключ сцены). Действия `Zelda:`, сохранённые сразу после `Start Toolkit` в том же списке (до первого действия другого типа — ожидания, диалога и т.п.), которые PS Maker не вызвал за 0,5 с, Toolkit выполняет сам. В панели: предупреждение `PS Maker did not call … ran from the map data`, в `actions run:` — пометка `(map data)`. Если PS Maker всё-таки вызовет такое действие позже, повторный вызов пропускается.
- Строка диагностики `map events (saved): …` — какие действия сохранены в событиях карты.

## [0.5.2] — 2026-10-25

### Изменено
- `Create Enemy`: персонаж PS Maker выбирается **выпадающим списком** (*Look (PS Maker character)*, тип поля `npc`), а не вписывается текстом. Персонаж не обязан стоять на карте.
- `Set Player Sprites`: вместо полей с названиями листов — одна галочка *Use the player's PS Maker animations*; листы атаки и урона находятся по названиям сами.

## [0.5.1] — 2026-10-25

По файлу проекта PS Maker 1.2.1 (story.json), см. `docs/ENGINE_AUDIT.md`, раздел 10.

### Исправлено
- PS Maker не сохраняет нетронутое поле *Position* (в проекте у `Create Enemy` не было ключа `position`). Теперь враг или объект без Position ставится рядом с игроком, а в диагностике — предупреждение; раньше действие ничего не создавало.

### Добавлено (экспериментально)
- `Create Enemy` → **PS Maker character**: анимации персонажа из библиотеки PS Maker (листы `… Run/Walk`, `Idle`, `Attack`, `Hurt`, `Death`), порядок направлений и коллизия.
- `Set Player Sprites` → **Attack sheet (PS Maker)**, **Hurt sheet (PS Maker)**: листы игрока по названию (например, `Sword Attack`).
- Toolkit ищет данные проекта во время игры и показывает результат строкой `PS Maker data:` в диагностике. Где именно PS Maker хранит их в игре, не подтверждено.
- В диагностику попадают и `console.warn` страницы (не только ошибки).

### Тесты
- Имена действий закреплены тестом: PS Maker сохраняет действие под ключом из имени (`plugin:zelda-maker-toolkit:zelda-create-enemy`), переименование потеряло бы его в проектах.
- Интеграционная проверка «ключ из сундука» ждёт результат опросом вместо фиксированной паузы (под нагрузкой сундук открывался на несколько кадров позже).

## [0.5.0] — 2026-10-25

### Изменено: формы без JSON
Все поля, где нужно было писать JSON, заменены обычными полями: галочками, числами, короткими списками через запятую. Выпадающих списков и кнопок API плагинов PS Maker (0.0.3) не даёт — выбор из вариантов сделан галочками и числами.

| Действие | Было | Стало |
|---|---|---|
| `Start Toolkit` | Preset (текст), Config JSON | Difficulty (1–3), Hearts, Sword damage, Show HUD, Magic bar, Shield on a button, HUD at the bottom, Autosave, Positions in tiles |
| `Configure` | Config JSON | заменено на `Zelda: Set Controls` — клавиши по полям (`X`, `Space`, `Shift`, `Tab`, `Up`…) |
| `Create Enemy`, `Enemy From NPC`, `Add Wave Enemy` | Overrides JSON, Animations `walk=…` | Health, Damage, Speed (0 = как в шаблоне), Walk/Attack/Hurt/Death animation, Sprite offset X/Y, Sprite scale |
| `Create Object` | Config JSON | Hidden, Stays on, Width, Height, Text, Reacts to, On use: set flag / open doors / reveal |
| `Create Door` | Lock (текст) | галочки Needs a small key, Needs the Big Key, Opened by switch; Width, Height |
| `Add Rule`, `Run Actions` | When/Then/Else JSON | When group defeated, When objects active, When flag set, When player has, When boss defeated → Open doors, Reveal, Set flag, Give item + count, Message, Spawn enemy + marker |
| `Create Switch Sequence`, `Create Wave Room` | On solved / On cleared / Advanced JSON | те же поля действий; у комнаты — Pause between waves (ms) |
| `Change Player Stats` | Stat, Mode (текст) | Health, Max health, Magic + галочка Set instead of add |
| `Define Item` | Item JSON | Item ID, Name, Icon, Uses, Cost, Damage, Damage type, Area attack, Stun, Heal |
| `Define Enemy` | Template JSON | Based on, Health, Damage, Speed, Sight range, Boss, Immune to, Sprite offset/scale |
| `Define Animation` | Frames JSON по направлениям | Frames (facing down), Frames facing up / left / right |
| `Set Player Sprites` | Weapon behind in (текст) | четыре галочки направлений; Swing center X/Y |

**Совместимость.** Действия, сохранённые старыми версиями, продолжают работать: старые JSON-поля применяются с предупреждением «re-open the action», а новые поля, которых у старого действия нет, ничего не сбрасывают. Полный словарь правил и все настройки остаются в JS API (`ZeldaMakerToolkit.addRule`, `runActions` — новые, `configure`, `registerEnemyTemplate`, `defineItem`).

### Добавлено
- Названия клавиш без учёта регистра: `shift`, `tab`, `esc`, `up`/`down`/`left`/`right`.

## [0.4.2] — 2026-10-25

По скриншоту playtest 0.4.1: `Start Toolkit x3`, `Create Enemy` ни разу.

### Изменено (несовместимо)
- Параметр *Use NPC* вынесен из `Zelda: Create Enemy` в новое действие `Zelda: Enemy From NPC` (42 действия). У `Create Enemy` теперь только текстовые поля и Position: пустое поле выбора NPC больше не может помешать PS Maker запустить действие. Действия `Create Enemy` с выбранным NPC нужно заменить на `Enemy From NPC`.

### Добавлено
- Ошибки страницы, необработанные отклонения промисов и `console.error` вне плагина попадают в раздел `problems:` панели диагностики (вывод в консоль не меняется). Если PS Maker не может подготовить действие, причина будет видна в игре.
- В строке остановки — сколько секунд проработала карта (`Stopped on map "1" after 21.8 s (scene shutdown)`), чтобы отличить перезапуск сцены от нового playtest.

### Исправлено
- Если в окне осталась старая копия плагина (заменили файл без перезапуска PS Maker), `globalThis.ZeldaMakerToolkit` переходит к новой версии; предупреждение объясняет, что PS Maker нужно перезапустить.
- Предупреждение о Position 0, 0 больше не называет эту точку «левым верхним углом»: на картах PS Maker начало координат может быть в центре.

## [0.4.1] — 2026-10-25

По скриншоту playtest 0.4.0 в PS Maker: `Start Toolkit` выполнился дважды, `Create Enemy` — ни разу.

### Исправлено
- Повторный `Zelda: Start Toolkit` с тем же Map ID больше не пересоздаёт сессию, если PS Maker передал другой `ctx.scene` для того же игрока: враги и объекты, созданные между вызовами, не пропадают.
- Диагностика: «enemys» → «enemies».

### Добавлено
- Строка `actions run:` в панели диагностики — какие действия `Zelda:` фактически выполнены и сколько раз (если `Create Enemy` там нет, PS Maker его не запускал).
- В журнал пишутся причина перезапуска (`Restarting: map id changed / scene changed`), `Already running…` и остановка сессии (`Stopped on map … (scene shutdown)`); в панели видно 6 последних сообщений вместо 4.

## [0.4.0] — 2026-10-24

Сверено с PS Maker 1.0–1.2 (см. `docs/ENGINE_AUDIT.md`, раздел 9).

### Изменено (несовместимо): действия объединены, 50 → 41
| Было | Стало |
|---|---|
| `Open Door`, `Close Door`, `Activate Switch`, `Set Object State`, `Reveal Object`, `Reset Object` | `Zelda: Change Object` (Operation: open, close, on, off, toggle, reveal, hide, reset, destroy, state) |
| `Toggle Debug`, `Diagnostics` | `Zelda: Debug` (Hitboxes, Diagnostics) |
| `If`, `Run Actions` | `Zelda: Run Actions` (When — необязательно, Then, Else) |
| `Leave Dungeon` | `Zelda: Enter Dungeon` с пустым ID |
| `Defeat Enemy` | `Zelda: Remove Target` (Defeat = true, Group) |
| `Change Player Health`, `Change Magic` | `Zelda: Change Player Stats` (Stat: health, max health, magic; Mode: add, set) |

### Добавлено
- `Zelda: Set Sound` — звуки моментов боя (взмах, круговой удар, попадание, победа над врагом, урон, блок, взрыв, разрушение, подбор, получение предмета, сундук, дверь, головоломка) из аудио-ассетов PS Maker или по URL; `audio.volume`, `audio.enabled`.
- NPC PS Maker (подвижные тела Arcade, коллизии появились в PS Maker 1.1) — препятствия для врагов и снарядов (`world.npcsBlock`).
- `docs/PS_MAKER_INTEGRATION.md`: титульный экран и сохранения PS Maker, карты, Spawned NPC, диалоги, звук, UI.

### Улучшено
- Поиск NPC для *Use NPC* учитывает экземпляры «Spawned NPC» (id/имя ассета, текстура).

### Удалено
- `debug.domEvents` (дублировал `ZeldaMakerToolkit.on`).

## [0.3.0] — 2026-10-20

### Добавлено
- Классический HUD (в стиле A Link to the Past): шкала магии, рамка предмета, пиксельные цифры и иконки, «— LIFE —» и сердца по 10 в ряд, сообщения в рамках внизу. Раскладка — чистая функция, проверенная тестами на отсутствие наложений на 10 разрешениях; зона `ui.safeArea` под шестерёнку PS Maker; перестройка при изменении размера окна.
- Спрайт-листы и анимации: `Zelda: Define Sprite Sheet`, `Zelda: Define Animation`, `Zelda: Set Player Sprites` (тело + слой оружия поверх спрайта PS Maker, оружие за телом в выбранных направлениях), поле *Animations* у `Create Enemy`, анимации врагов по состояниям, `Zelda: Preview Sprite Sheet` — лист с номерами кадров. Листы — по ключу текстуры или по URL/data URI. Руководство для Mana Seed: `docs/SPRITES.md`.
- Экранная диагностика: F10 / `Zelda: Diagnostics` / параметр *Show diagnostics* у `Start Toolkit` — сцена, камера, игрок, режим глубины, ближайшие объекты Toolkit, последние предупреждения и параметры, переданные действиям.
- В журнал записываются параметры каждого действия и координаты созданных врагов и объектов.

### Исправлено
- Меч: точка вращения — центр спрайта игрока, клинок начинается у края тела и равен длине хитбокса во всех фазах; при заряде меч больше не «подтягивается» к персонажу.
- Объекты Toolkit создаются в сцене игрока (`player.scene`), а глубина отрисовки по умолчанию подстраивается под сортировку PS Maker (`world.depthMode: "auto"`), чтобы враги не прятались под слоями карты.
- Разбор позиции принимает также `{X, Y}` и вложенные `{value: {x, y}}`.

## [0.2.1] — 2026-10-20

### Исправлено
- Документация 0.2.0 ошибочно утверждала, что *Position* у действий плагина — штатная кнопка **Set position**. Проверка в редакторе показала: PS Maker рисует параметр `position` плагинов двумя числовыми полями X/Y. Документы исправлены.

### Добавлено
- Выбор координат в игре: при включённом оверлее F9 клик по карте отмечает точку, показывает «X: … Y: …» и копирует `x, y` в буфер обмена.
- Предупреждение в консоли, если *Position* оставлен равным 0, 0.
- Плагин-зонд `tools/param-probe/zelda-param-probe.ps-maker.js` (`npm run build:probe`): 14 вариантов типа параметра и вывод значений `npc`/`image`/`audio`, чтобы выяснить в редакторе, даёт ли какой-то тип штатный выбор на карте.

### Подтверждено в PS Maker
- Плагин загружается из `/plugins`, действия видны в редакторе с формами параметров (поле `events` подходит).

## [0.2.0] — 2026-10-19

### Добавлено
- `Zelda: Place Marker` — именованная точка, выбираемая штатным выбором позиции PS Maker. Правила (`spawnEnemy`, `spawnPickup`, `createObject`, `setRespawn`), волны и маршруты патруля ссылаются на неё через `"at": "<маркер>"` вместо ввода координат.
- `Zelda: Add Wave Enemy` — враг волны с точкой появления, выбранной на карте.
- Параметр *Patrol markers* у `Zelda: Create Enemy`.

### Изменено
- `Zelda: Create Wave Room` вместо одного JSON получил отдельные поля (Room ID, Doors to lock, Start at once, On cleared, Advanced JSON); волны заполняются через `Add Wave Enemy`. Автостарт происходит на следующем тике, чтобы учесть все On-load действия.
- Демо-проект больше не содержит координат в JSON.

## [0.1.0] — 2026-10-19

Первый MVP.

### Добавлено
- Аудит API плагинов PS Maker (`docs/ENGINE_AUDIT.md`) по `@ps-maker/plugin-api@0.0.3`, официальному CLI и публичному CHANGELOG PS Maker.
- Ядро: типизированная конфигурация с валидацией и пресетами, шина событий `zelda:*`, постоянное состояние игры, сессия на карту с фиксированным шагом 60 Гц, broad phase на равномерной сетке, seed-RNG.
- Хост PS Maker на Phaser: чтение тела игрока, отбрасывание и блокировка после шага Arcade Physics, коллизии карты по статическим телам и слоям tilemap, процедурные оригинальные спрайты, клавиатура без перехвата клавиш PS Maker, геймпад, HUD в отдельной сцене, отладочный оверлей.
- Бой: меч с фазами и дуговым хитбоксом, заряд и круговой удар, тычок, `AttackInstance` (не более N попаданий за удар), неуязвимость, щит, смерть и возрождение.
- Предметы: бомбы, бумеранг, лук, огненный жезл, лечебное заклинание, крюк (экспериментально), подбираемые предметы, предметы из JSON.
- Враги: 5 поведений, 6 шаблонов, фазы мини-босса, сопротивления, оглушение, дроп, усыновление NPC.
- Интерактивные объекты: 20 типов на одном конфигурируемом классе; подъём и броски, блоки, плиты, двери с ключами.
- Правила (22 условия, 31 действие), последовательности переключателей, комнаты с волнами, подземелья, ключи, боссы.
- Инвентарь с быстрым слотом и панелью, HUD, локализация ru/en.
- Версионированные сохранения в `localStorage` с миграциями и санитизацией.
- 43 действия редактора PS Maker, JS API `ZeldaMakerToolkit`.
- 81 юнит-тест, 15 интеграционных проверок в Phaser/Chromium, демо из двух карт, документация.

### Известные ограничения
- Не проверено в самом редакторе PS Maker (см. `docs/TESTING.md`, сценарии M-01…M-13).
- Ветвления событий PS Maker, встроенные переменные/инвентарь/диалоги/сохранения PS Maker плагину недоступны.
- Крюк экспериментальный и выключен по умолчанию.
