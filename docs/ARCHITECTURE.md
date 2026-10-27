# Архитектура Zelda Maker Toolkit

## Принципы

- **Один бандл, стандартный формат PS Maker.** `src/index.ts` → официальный `@ps-maker/plugin-cli` → `dist/zelda-maker-toolkit.ps-maker.js` (ESM, es2020). Внешних зависимостей во время выполнения нет.
- **Движок-независимое ядро.** Вся игровая логика работает с интерфейсом `HostAdapter` (`src/host/types.ts`). Phaser используется только в `src/host/*`. Это позволяет тестировать логику без браузера и изолирует риски неизвестного внутреннего устройства PS Maker.
- **Никаких изменений ядра PS Maker.** Плагин не патчит классы движка, не создаёт Phaser `Key`-объекты (слушает сырые `keydown/keyup`), не трогает переменные/сохранения PS Maker. Единственный глобальный объект — `globalThis.ZeldaMakerToolkit` (отключается `publicApi: false`), появляется при первом действии.
- **Детерминизм.** Фиксированный шаг 60 Гц (`world.fixedStepHz`), seed-RNG (`src/core/rng.ts`) от id карты, разрешение урона через `AttackInstance`.
- **Один цикл обновления.** Ни одна сущность не создаёт собственных таймеров/циклов: всё обновляется из `Session.step()`.

## Слои и модули

```
src/
  index.ts                  definePlugin(...) — точка входа для CLI
  editor/                   интеграция с PS Maker
    actions.ts              37 действий редактора (defineEvent)
    runtime.ts              синглтон Toolkit, привязка к сцене, авто-старт
    mapReplay.ts            возврат на карту: повтор действий карты по wake сцены
    paramResolvers.ts       разбор параметров position / npc / image
    fields.ts               поля форм: типы виджетов PS Maker, чтение со значениями по умолчанию, группы When/Then
    ui.ts                   вид в редакторе: разделы, видимость полей, превью, ключевые слова поиска
    publicApi.ts            globalThis.ZeldaMakerToolkit
    pageErrors.ts           ошибки страницы, console.error/warn → панель диагностики
    pluginShape.ts          events + actions (совместимость версий API)
  core/                     ядро
    toolkit.ts              Toolkit: config, state, bus, реестры, сохранения
    session.ts              Session: одна карта — host, world, подсистемы, цикл
    world.ts, entity.ts     сущности, отложенное удаление, broad phase
    spatialHash.ts          равномерная сетка без аллокаций в горячем пути
    events.ts               типизированная шина событий + Subscriptions
    config.ts               конфигурация, валидация, пресеты
    state.ts                постоянный GameState
    math.ts, rng.ts, units.ts, logger.ts, types.ts
  host/                     Phaser / PS Maker
    phaserHost.ts           HostAdapter: игрок, коллизии карты, рендер, отладка
    keyboardInput.ts        клавиатура и геймпад с защёлкиванием нажатий
    phaserHud.ts            HUD-сцена (одна на игру)
    textures.ts             оригинальные процедурные спрайты, пиксельные цифры/иконки HUD
    sheets.ts               нарезка спрайт-листов авторов (по ключу текстуры или URL)
    psmakerAssets.ts        данные проекта PS Maker: персонажи и их листы → анимации Toolkit (экспериментально)
  player/                   PlayerSystem (направление, урон, щит, смерть, оверлей анимаций), health.ts, overlay.ts
  combat/                   AttackInstance, resolveHit, scaleDamage; SwordSystem
  items/                    реестр предметов, ItemSystem, бомба, бумеранг, крюк, снаряды, подбираемое
  inventory/                модель инвентаря (на GameState) и InventorySystem (ввод, панель)
  enemies/                  Enemy, поведения, шаблоны, spawn
  interactions/             Interactable (все типы объектов), InteractionSystem, пресеты
  puzzles/                  RuleRegistry, RulesEngine, встроенные условия/действия, последовательности
  dungeons/                 DungeonSystem: подземелья, ключи, боссы, волны
  ui/                       HudSystem (модель HUD), hudLayout (раскладка без наложений), sound (звуки моментов), i18n
  save/                     SaveManager: формат, версии, миграции, санитизация
  debug/                    DebugSystem: оверлей хитбоксов
locales/{en,ru}/strings.ts  строки интерфейса
```

## Жизненный цикл

У API PS Maker нет хуков загрузки/выгрузки, поэтому:

1. Импорт бандла ничего не делает (проверено тестом `lifecycle.test.ts`).
2. Первое действие `Zelda: …` создаёт `Toolkit` (синглтон) и `Session` для `ctx.scene`. `Zelda: Start Toolkit` делает это явно; карта узнаётся по id карты PS Maker (ключ сцены, `GameMap.map.id`); любое другое действие без старта поднимет сессию с настройками по умолчанию.
3. `PhaserHost.attach` подписывается на `scene.events`:
   - `postupdate` — кадр: сначала принудительная блокировка игрока, затем `Session.update(delta)`. Событие идёт **после** синхронизации Arcade Physics спрайтов с телами, поэтому коррекции позиции (отбрасывание, выталкивание из твёрдых объектов) не перетираются физикой. (Проверено по исходникам Phaser `Body.preUpdate/postUpdate` и интеграционным тестом.)
   - `shutdown` / `destroy` — `Toolkit.stop()`: освобождаются все подписки шины, слушатели клавиатуры и `blur`, игровые объекты, отладочная графика; HUD скрывается; игрок возвращается в исходное состояние (видимость, тинт, разблокировка).
4. Повторный `Zelda: Start Toolkit` на той же карте и сцене (или с тем же спрайтом игрока, даже если PS Maker передал другой `ctx.scene`) не создаёт вторую сессию, и созданные между вызовами объекты сохраняются; с другим `Map ID` — перезапускает (на случай, если PS Maker меняет карту без перезапуска сцены). Причина перезапуска пишется в журнал (`Restarting: …`), остановка — `Stopped on map … (причина)`.
5. `Toolkit` и `GameState` переживают смену карты; `Session` и все сущности — нет.

## Цикл обновления (`Session.step`)

```
host.beginTick → input.latch → world.reindex
debug.handleInput, inventoryUi.tick            (работают и на паузе)
если не пауза:
  player → sword → items → interactions        (системы, порядок важен)
  сущности: enemy → object → projectile → pickup → effect
  dungeons.tick → rules.tick (только если были события) → world.flush
sync views → hud.tick (только при изменениях) → debug.tick
```

## Модель боя

- `AttackInstance` — один удар/взрыв/снаряд. Хранит счётчик попаданий по каждой цели и не даёт превысить `maxHitsPerTarget` (по умолчанию 1). Это главный механизм «один удар не наносит урон каждый кадр».
- Цели (`Damageable`) дополнительно имеют собственный кулдаун (`combat.enemyHitCooldownMs`, неуязвимость игрока), как `sprite_hit_timer` в ALttP.
- `scaleDamage`: `база × combat.damageTable[тип] × resistances[тип]`; 0 = иммунитет.
- Результаты: `damaged | killed | blocked | immune | ignored`. «ignored» не считается попаданием, «blocked» вызывает отскок атакующего.
- Игрок имеет два бокса: тело (`box`, для коллизий с объектами) и хартбокс (`hurtbox`, меньше на `player.hurtboxInset`), которого должны коснуться враги и снаряды.

## Сохранения

- Ключ: `<save.storageKey>:<slot>` в `localStorage`; данные PS Maker не затрагиваются.
- Конверт: `{ format: "zelda-maker-toolkit-save", version: 1, savedAt, toolkitVersion, state }`.
- Загрузка: проверка формата → отказ от более новой версии → цепочка миграций `MIGRATIONS[v]` → `sanitizeState` (каждое поле проверяется, некорректное заменяется значением по умолчанию; здоровье 0 не загружается, чтобы не попасть в цикл смертей).
- После загрузки `Session.onStateReplaced()` пересинхронизирует объекты текущей карты (сундуки, двери, блоки, побеждённые боссы).
- Постоянные объекты сохраняются, только если у них задан явный `id` (ключ `<mapId>/<id>`).

## Точки расширения

| Что | Как |
|---|---|
| Предмет | Поля `Zelda: Define Item` или `ZeldaMakerToolkit.registerItem(def)` (интерфейс `ItemDefinition`). |
| Враг | Поля `Zelda: Define Enemy` (на основе встроенного шаблона) или `registerEnemyTemplate`. |
| Условие / действие правил | `registerCondition(name, fn)`, `registerAction(name, fn)`. |
| Объект | Комбинация полей `ObjectConfig` (инструменты, флаги, действия) без кода. |
| Строки | `extendStrings({ ru: {...}, en: {...} })`. |
| Реакция на события | `ZeldaMakerToolkit.on("zelda:enemy:defeated", fn)` — из плагина-расширения или события PS Maker «Run Code». |
| Другой движок / тесты | Реализация `HostAdapter` (см. `tests/helpers/fakeHost.ts`). |

## Производительность

- Broad phase — `SpatialHash` с переиспользуемыми корзинами; запросы пишут в массивы вызывающего.
- ИИ «думает» раз в `enemies.thinkEveryTicks` тиков со сдвигом по индексу врага (как `(j ^ frame_counter) & 3` в zelda3); движение — каждый тик.
- Проверка линии видимости — только в фазе «думать».
- Кэш статических тел карты пересобирается раз в `world.collisionRefreshTicks` или при изменении их числа.
- HUD перерисовывается только при изменениях; правила вычисляются только после событий.
- Лимит живых врагов `enemies.maxActive`.
