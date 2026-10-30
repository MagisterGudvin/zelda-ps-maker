# Конфигурация

Все параметры имеют безопасные значения по умолчанию (полный список — [examples/configs/default-config.json](../examples/configs/default-config.json)).

**В редакторе** (без JSON) настраивается главное:

| Где | Поля |
|---|---|
| `Zelda: Start Toolkit` | Difficulty (Easy / Normal / Hard), Hearts, Sword damage, Show HUD, Magic bar, Shield (hold its key / always up), HUD at the bottom, Progress variable, Language, Positions in tiles, Show hitboxes, Show diagnostics |
| `Zelda: Set Controls` | клавиши меча, предмета, щита, действия, смены предмета, инвентаря — штатным выбором клавиш PS Maker (можно выбрать и управление проекта, например Interact) |
| `Zelda: Set Player Sprites` | анимации атаки из PS Maker, слой оружия, центр взмаха |
| `Zelda: Set Sound` | звуки моментов |

Поля *Hearts* и *Sword damage* применяются поверх сложности. Если действие `Start Toolkit` сохранено старой версией плагина и новых полей у него нет, они не применяются — ничего не сбрасывается.

**Из кода** доступна любая настройка ниже: `ZeldaMakerToolkit.configure({...})` (расширение-плагин или событие PS Maker с JavaScript, если оно есть в вашей версии).

Неизвестные ключи и значения неверного типа **игнорируются** с предупреждением в консоли (`[ZeldaMakerToolkit] Configure: sword.dammage: unknown option (ignored)`), поэтому опечатка не ломает остальные настройки. Время — в миллисекундах, расстояния — в пикселях, скорости — пиксели/с.

## Пресеты

Поле *Difficulty* в `Zelda: Start Toolkit`: Normal — `alttp` (по умолчанию, ничего не меняет), Easy — `casual` (длиннее неуязвимость и меч, щит блокирует магию, бомбы не ранят игрока), Hard — `hardcore` (короткая неуязвимость, меньше дропа). Здоровье и урон меча берутся из полей *Hearts* и *Sword damage*.

## Разделы

### `features` — включение подсистем
`combat, items, inventory, enemies, interactions, puzzles, dungeons, ui, save, debugTools` — `true/false`. Отключение подсистемы не ломает остальные (проверено тестом для каждой): например, при `enemies: false` действие `Create Enemy` пишет предупреждение и ничего не создаёт.

### `controls` — привязка кнопок (в редакторе — `Zelda: Set Controls`)
`controls.move` — клавиши движения PS Maker (по умолчанию стрелки и WASD): игрока ими двигает PS Maker; Toolkit использует их как подсказку направления, чтобы игрок мог «повернуться» к стене/сундуку, не сдвигаясь (`player.facingFromInput`), и для выбора кнопок на экранах меню.

Коды клавиш `KeyboardEvent.code` (`KeyX`, `Space`, `ArrowUp`, `ShiftLeft`…) или короткие имена (`"x"`, `"5"`, `"Space"`). Действия: `sword, useItem, useItem2, shield, action, nextItem, prevItem, inventory, menu` (`useItem` — первая кнопка предмета, по умолчанию C; `useItem2` — вторая, по умолчанию B) (`menu`, по умолчанию Escape — с 0.26.0, до этого Enter, — открывает и закрывает экран с ролью *Pause menu*; пока такого экрана нет, Escape остаётся меню опций PS Maker). `controls.hotbar` — девять клавиш слотов быстрого доступа (по умолчанию `Digit1`…`Digit9`): клавиша берёт в руку предмет своего слота, пока в HUD есть элементы *Quick slot*. Мышь: в списках клавиш можно указать `MouseLeft`, `MouseRight`, `MouseMiddle` (так кнопки мыши называет и PS Maker); с `MouseRight` браузерное меню над игрой отключается.

Геймпад (с 0.32.0 — через браузерный Gamepad API, без плагинов; PS Maker 1.2.1 геймпад сам не поддерживает): `controls.gamepad.{enabled, sword, useItem, useItem2, shield, action, nextItem, prevItem, inventory, menu}` — номера кнопок стандартной раскладки (0 — нижняя: A / Cross / B; 1 — правая; 2 — левая; 3 — верхняя; 4/5 — LB/RB; 6/7 — LT/RT; 8 — View/Share/Minus; 9 — Menu/Options/Plus; 12–15 — крестовина). Кнопки и левый стик превращаются в нажатия клавиш: своих клавиш Toolkit, клавиш движения PS Maker (первые клавиши его управления *Move up/down/left/right*) и клавиш из `controls.gamepad.extra: [{ button, key }]` — так на геймпаде работают и триггеры PS Maker по клавише (*Add event trigger* → *Keyboard*), и свои управления проекта. `controls.gamepad.deadzone 0.5` — насколько наклонить стик. Подключено несколько геймпадов — работают все. Всё это задаётся и в `Zelda: Set Controls` (группы *Gamepad* и *Gamepad: extra buttons*).

Свои клавиши игрока (экран с элементом *Key bindings*, docs/UI.md) лежат поверх этих настроек и хранятся в браузере.

```json
{"controls":{"sword":["Space","KeyJ"],"useItem":["KeyK"],"action":["KeyZ","KeyL"]}}
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
| `startItems` / `startCounts` | `["sword"]` / `{}` | стартовый инвентарь новой игры (до 0.26.0 — и щит) |

### `sword`
`damage 2, range 18, width 10, windupMs 50, activeMs 130, recoveryMs 120, sweep true` (хитбокс проходит дугой от бока к фронту), `maxHitsPerTarget 1, knockback 220, lockUntilRecovered true` (иначе удар можно прервать новым в фазе восстановления).
`charge: { enabled true, chargeMs 800, spinDamageMultiplier 2, spinRadius 26, spinMs 300, pokeWhileCharging true, pokeDamage 1 }`.
`showBlade "auto" | "always" | "never"` — встроенный клинок (в `auto` скрыт, если задана анимация атаки); `pivotOffsetX 0, pivotOffsetY 0` — смещение точки вращения удара от центра спрайта игрока. Клинок всегда начинается у края тела и равен длине хитбокса во всех фазах (удар, заряд, круговой).

### `sprites` и `player.sprites`
Листы и анимации из `Zelda: Define Sprite Sheet` / `Zelda: Define Animation`: `sprites: { sheets: { id: { image, frameWidth, frameHeight, margin?, spacing? } }, animations: { id: { sheet, frames, fps?, loop?, flipX? } } }`. Анимации атаки игрока: `player.sprites: { attack, spin, charge, hurt, weaponAttack, weaponSpin, weaponCharge, weaponBehind ["up"], hidePlayer true, offsetX 0, offsetY 0 }`. Подробно — [SPRITES.md](SPRITES.md).

### `shield`
`enabled true, mode "hold"` (блокирует, только пока зажата клавиша щита; с 0.26.0 по умолчанию) или `"passive"` (поднят всегда, пока игрок не атакует), `blocks ["projectile","arrow","contact"]` — блокируемые типы урона (`contact` — враг, наткнувшийся на поднятый щит спереди), `frontalDot 0.5` — ширина сектора (косинус половины угла), `blockPushback 60`. С 0.29.0: `walkSpeed 0.5` — скорость ходьбы с поднятым щитом (доля скорости игрока PS Maker), `lockFacing true` — с поднятым щитом игрок смотрит в ту же сторону и отступает боком и назад, `bashKnockback 220` — с какой скоростью отлетает враг, наткнувшийся на щит, `reflects ["projectile","magic","fire"]` — что Зеркальный щит (`mirror_shield`) отражает в стрелка. Щит работает, только если он есть у игрока (сундук, `Give Item`); без анимации «Shield up» (`Set Player Sprites`) поднятый щит рисуется встроенной иконкой перед игроком.

### `items.boots`, `items.feather` (с 0.29.0)
`items.boots: { chargeMs 300, speed 190, bounce 90 }` — разбег (мс), скорость рывка (пикс/с), скорость отскока от стены. Урон рывка — урон меча (`sword.damage`, `sword.knockback`). `items.feather: { jumpMs 480, height 10, cooldownMs 120 }` — длительность прыжка, высота (пикс), пауза до следующего. С 0.30.0: `items.shovel.drops` — что даёт обычная земля (по умолчанию шанс 0.2: рупия, 5 рупий, сердце); `items.powder: { damage 2, radius 14, stunMs 800 }`; `items.bombArrow.comboMs 100`; `inventory.capacities.powder 20`. С 0.31.0: `items.hookshot: { range 96, speed 300, pullSpeed 220, damage 1, stunMs 1500, grabs ["hook_post","chest","block","rock","heavy_rock","pot","sign","torch","lever"] }`; тип урона `hookshot` (враги могут быть к нему устойчивы).

### `combat`
`enemyHitCooldownMs 250, flashMs 250, bombsHurtPlayer true, pauseDuringDialogue true` (враги и снаряды замирают, пока открыт диалог PS Maker), `damageTable {}` — глобальные множители по типам урона, например `{"arrow":1.5,"fire":0.5}`.

Типы урона: `sword, spin, poke, arrow, bomb, boomerang, fire, ice, magic, thrown, contact, projectile, hazard, fall, script`.

### `items`
- `bomb: { fuseMs 2600, radius 26, damage 4, playerDamage 2, maxActive 2, knockback 260 }`
- `boomerang: { speed 220, range 110, damage 0, stunMs 2000, maxActive 1 }`
- `bow: { speed 300, range 220, damage 2, maxActive 3 }`
- `fireRod: { speed 200, range 160, damage 4, magicCost 4 }`
- `healingSpell: { magicCost 8, heal 2 }`
- `thrown: { speed 200, range 64, damage 2 }` — брошенные горшки/кусты/камни

### `inventory`
`capacities { bombs 10, arrows 30, rupees 999 }` (можно добавить свои ресурсы), `order` — порядок быстрых предметов, `autoEquipFirst true`.

### `enemies` / `interactions`
`enemies: { thinkEveryTicks 4, deathFadeMs 300, alertMs 300, maxActive 64, dropLifetimeMs 8000, contactRecoil 140, defaultDrops }` — `contactRecoil`: скорость (пикс./с), с которой враг отскакивает, коснувшись игрока
`interactions: { pushMs 400, liftMs 200, reachDistance 10, chestOpenFrom "any" | "below", defaultDrops }`
Таблица дропа: `{ "chance": 0.4, "entries": [ { "item": "heart", "weight": 5 }, { "item": "rupees", "count": 5, "weight": 1 } ] }`.

### `world`
`positionUnits "pixels" | "tiles"`, `tileSize 16` (шаг толкания блоков и пересчёт координат в режиме `tiles`), `useArcadeStaticBodies true` (коллизии карты PS Maker — статические тела Arcade), `npcsBlock true` (NPC PS Maker — препятствия для врагов и снарядов), `depthMode "auto" | "y" | "fixed"` (`auto`: если PS Maker сортирует персонажей по y — тоже по y, иначе на слое игрока с поправкой по y, чтобы объекты не оказывались под слоями карты), `depthBase 0`, `fixedStepHz 60`, `maxStepsPerFrame 5`, `collisionRefreshTicks 120`.

### `ui`
Классический HUD (пока на карте нет `Zelda: UI Layout`): шкала магии, рамка предмета, счётчики (пиксельные цифры), «— LIFE —» и сердца справа (10 в ряд), левее шестерёнки настроек PS Maker. Свой HUD и экраны меню — дизайнер `Zelda: UI Layout` ([UI.md](UI.md)).
`enabled, showMagic, position "top" | "bottom"` (старые `top-left` и т.п. читаются как top/bottom; для классического HUD), `scale 0` (размер пикселя макета на экране, если в макете 0: 0 = как у карты), `messageMs 2200, inventoryPanel true, pauseWhileInventoryOpen true`. Сообщения выводятся рамками внизу свободной области и не перекрывают HUD.

### `audio`
`enabled true, volume 1, sounds {}` — звуки моментов (`Zelda: Set Sound`): `{"audio":{"sounds":{"swordSwing":{"src":"sfx/swing.ogg","volume":0.8}}}}`. Список моментов — в [PS_MAKER_INTEGRATION.md](PS_MAKER_INTEGRATION.md#звук).

### `debug`, `language`, `publicApi`
`debug: { hitboxes false, toggleKey "F9", logLevel "warn", rethrowErrors false, diagnostics false, diagnosticsKey "F10" }` — `diagnostics` включает экранную панель (позиции игрока и камеры, режим глубины, ближайшие объекты Toolkit, строка `actions run:` — какие действия `Zelda:` PS Maker фактически выполнил и сколько раз, последние предупреждения и действия, а также ошибки страницы и `console.error` вне плагина — например, если PS Maker не смог подготовить параметры действия); полезно, когда консоль браузера недоступна; `language: "auto" | "en" | "ru"`; `publicApi: true`.

## Примеры (из кода)

Динамичный бой, щит в руке:
```json
{"sword":{"damage":3,"recoveryMs":80,"lockUntilRecovered":false},"shield":{"mode":"hold","blocks":["projectile","arrow","contact"]},"player":{"lockMovementWhileAttacking":false}}
```

Метроидвания-магия с регенерацией:
```json
{"player":{"maxMagic":64,"startMagic":64,"magicRegenPerSecond":2},"items":{"fireRod":{"magicCost":6,"damage":5}}}
```

Классический HUD внизу, без шкалы магии:
```json
{"ui":{"position":"bottom","showMagic":false}}
```
