# Конфигурация

Все параметры имеют безопасные значения по умолчанию (полный список — [examples/configs/default-config.json](../examples/configs/default-config.json)). Автор меняет любую часть JSON-ом:

- в `Zelda: Start Toolkit` → параметр **Config JSON** (применяется при загрузке карты);
- в любой момент — `Zelda: Configure`;
- из кода — `ZeldaMakerToolkit.configure({...})`.

Неизвестные ключи и значения неверного типа **игнорируются** с предупреждением в консоли (`[ZeldaMakerToolkit] Configure: sword.dammage: unknown option (ignored)`), поэтому опечатка не ломает остальные настройки. Время — в миллисекундах, расстояния — в пикселях, скорости — пиксели/с.

## Пресеты

Параметр `Preset` в `Zelda: Start Toolkit`: `alttp` (по умолчанию, ничего не меняет), `casual` (больше здоровья, длиннее неуязвимость, щит блокирует магию, бомбы не ранят игрока), `hardcore` (4 HP, слабый меч, меньше дропа). Пресет применяется до JSON из параметра Config.

## Разделы

### `features` — включение подсистем
`combat, items, inventory, enemies, interactions, puzzles, dungeons, ui, save, debugTools` — `true/false`. Отключение подсистемы не ломает остальные (проверено тестом для каждой): например, при `enemies: false` действие `Create Enemy` пишет предупреждение и ничего не создаёт.

### `controls` — привязка кнопок
`controls.move` — клавиши движения PS Maker (по умолчанию стрелки и WASD): Toolkit их не обрабатывает, а только использует как подсказку направления, чтобы игрок мог «повернуться» к стене/сундуку, не сдвигаясь (`player.facingFromInput`).

Коды клавиш `KeyboardEvent.code` (`KeyX`, `Space`, `ArrowUp`, `ShiftLeft`…) или короткие имена (`"x"`, `"5"`, `"Space"`). Действия: `sword, useItem, shield, action, nextItem, prevItem, inventory`. Геймпад: `controls.gamepad.{enabled, sword, useItem, shield, action, nextItem, prevItem, inventory}` — индексы кнопок стандартной раскладки; работает, только если в игре включён плагин Phaser Gamepad (в PS Maker не подтверждено).

```json
{"controls":{"sword":["Space","KeyJ"],"useItem":["KeyK"],"action":["KeyZ","Enter"]}}
```

### `player`
| Ключ | По умолчанию | Смысл |
|---|---|---|
| `heartValue` | 2 | очков здоровья в одном сердце (половинки сердец) |
| `maxHealth` / `startHealth` / `maxHealthCap` | 6 / 6 / 40 | здоровье в очках |
| `invulnerableMs` | 970 | неуязвимость после урона (58 кадров ALttP) |
| `knockbackSpeed` / `knockbackMs` | 180 / 150 | отбрасывание игрока |
| `hurtboxInset` | 2 | хартбокс меньше тела на N px с каждой стороны |
| `lockMovementWhileAttacking` / `lockMovementWhileUsingItem` | true / true | блокировка движения PS Maker на время действия |
| `facingFromInput` | true | направление по удерживаемым клавишам движения (`controls.move`) |
| `facingFromAnimation` | false | иначе — из имени текущей анимации (`…up…`, `…left…`); иначе — по смещению игрока |
| `deathBehavior` | `respawn` | `respawn` или `none` (возрождение действием `Zelda: Respawn Player`) |
| `respawnDelayMs` / `respawnHealth` | 1200 / 6 | |
| `maxMagic` / `startMagic` / `magicRegenPerSecond` | 32 / 32 / 0 | магия; 0 — восполняется только банками |
| `startItems` / `startCounts` | `["sword","shield"]` / `{}` | стартовый инвентарь новой игры |

### `sword`
`damage 2, range 18, width 10, windupMs 50, activeMs 130, recoveryMs 120, sweep true` (хитбокс проходит дугой от бока к фронту), `maxHitsPerTarget 1, knockback 220, lockUntilRecovered true` (иначе удар можно прервать новым в фазе восстановления).
`charge: { enabled true, chargeMs 800, spinDamageMultiplier 2, spinRadius 26, spinMs 300, pokeWhileCharging true, pokeDamage 1 }`.
`showBlade "auto" | "always" | "never"` — встроенный клинок (в `auto` скрыт, если задана анимация атаки); `pivotOffsetX 0, pivotOffsetY 0` — смещение точки вращения удара от центра спрайта игрока. Клинок всегда начинается у края тела и равен длине хитбокса во всех фазах (удар, заряд, круговой).

### `sprites` и `player.sprites`
Листы и анимации из `Zelda: Define Sprite Sheet` / `Zelda: Define Animation`: `sprites: { sheets: { id: { image, frameWidth, frameHeight, margin?, spacing? } }, animations: { id: { sheet, frames, fps?, loop?, flipX? } } }`. Анимации атаки игрока: `player.sprites: { attack, spin, charge, hurt, weaponAttack, weaponSpin, weaponCharge, weaponBehind ["up"], hidePlayer true, offsetX 0, offsetY 0 }`. Подробно — [SPRITES.md](SPRITES.md).

### `shield`
`enabled true, mode "passive"` (поднят, пока игрок не атакует) или `"hold"` (клавиша щита), `blocks ["projectile","arrow"]` — блокируемые типы урона, `frontalDot 0.5` — ширина сектора (косинус половины угла), `blockPushback 60`.

### `combat`
`enemyHitCooldownMs 250, flashMs 250, bombsHurtPlayer true, damageTable {}` — глобальные множители по типам урона, например `{"arrow":1.5,"fire":0.5}`.

Типы урона: `sword, spin, poke, arrow, bomb, boomerang, hookshot, fire, ice, magic, thrown, contact, projectile, hazard, fall, script`.

### `items`
- `bomb: { fuseMs 2600, radius 26, damage 4, playerDamage 2, maxActive 2, knockback 260 }`
- `boomerang: { speed 220, range 110, damage 0, stunMs 2000, maxActive 1 }`
- `bow: { speed 300, range 220, damage 2, maxActive 3 }`
- `hookshot: { enabled false, speed 260, range 120, damage 0, stunMs 1500, pullSpeed 240 }` — экспериментально
- `fireRod: { speed 200, range 160, damage 4, magicCost 4 }`
- `healingSpell: { magicCost 8, heal 2 }`
- `thrown: { speed 200, range 64, damage 2 }` — брошенные горшки/кусты/камни

### `inventory`
`capacities { bombs 10, arrows 30, rupees 999 }` (можно добавить свои ресурсы), `order` — порядок быстрых предметов, `autoEquipFirst true`.

### `enemies` / `interactions`
`enemies: { thinkEveryTicks 4, deathFadeMs 300, alertMs 300, maxActive 64, dropLifetimeMs 8000, defaultDrops }`
`interactions: { pushMs 400, liftMs 200, reachDistance 10, chestOpenFrom "any" | "below", defaultDrops }`
Таблица дропа: `{ "chance": 0.4, "entries": [ { "item": "heart", "weight": 5 }, { "item": "rupees", "count": 5, "weight": 1 } ] }`.

### `world`
`positionUnits "pixels" | "tiles"`, `tileSize 16` (шаг толкания блоков и пересчёт координат в режиме `tiles`), `useArcadeStaticBodies true`, `useTilemapLayers true` (источники коллизий карты), `depthMode "auto" | "y" | "fixed"` (`auto`: если PS Maker сортирует персонажей по y — тоже по y, иначе на слое игрока с поправкой по y, чтобы объекты не оказывались под слоями карты), `depthBase 0`, `fixedStepHz 60`, `maxStepsPerFrame 5`, `collisionRefreshTicks 120`.

### `ui`
Классическая полоса: шкала магии, рамка предмета, счётчики (пиксельные цифры), «— LIFE —» и сердца справа (10 в ряд).
`enabled, showHearts, showMagic, showActiveItem, counters ["rupees","bombs","arrows","keys"], position "top" | "bottom"` (старые `top-left` и т.п. читаются как top/bottom), `scale 0` (0 = наибольший целый масштаб, при котором 256×224 помещается на экран), `safeArea { top 0, right 24, bottom 0, left 0 }` (место под собственный UI PS Maker — шестерёнку настроек справа сверху; в пикселях HUD), `messageMs 2200, inventoryPanel true, pauseWhileInventoryOpen true, fontFamily "monospace"`. Сообщения выводятся рамками внизу свободной области и не перекрывают полосу HUD.

### `save`
`enabled true, storageKey "zelda-maker-toolkit", slot "default", autoSave true` (сундуки, двери, новые предметы, завершение подземелья), `autoLoadOnStart false`.

### `debug`, `language`, `publicApi`
`debug: { hitboxes false, toggleKey "F9", logLevel "warn", rethrowErrors false, domEvents false, diagnostics false, diagnosticsKey "F10" }` — `diagnostics` включает экранную панель (позиции игрока и камеры, режим глубины, ближайшие объекты Toolkit, последние предупреждения и действия); полезно, когда консоль браузера недоступна; `language: "auto" | "en" | "ru"`; `publicApi: true`.

## Примеры

Динамичный бой, щит в руке:
```json
{"sword":{"damage":3,"recoveryMs":80,"lockUntilRecovered":false},"shield":{"mode":"hold","blocks":["projectile","arrow","contact"]},"player":{"lockMovementWhileAttacking":false}}
```

Метроидвания-магия с регенерацией:
```json
{"player":{"maxMagic":64,"startMagic":64,"magicRegenPerSecond":2},"items":{"fireRod":{"magicCost":6,"damage":5}}}
```

HUD справа, без магии, только сердца и рупии:
```json
{"ui":{"position":"top-right","showMagic":false,"counters":["rupees"]}}
```
