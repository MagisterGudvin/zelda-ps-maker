# Интерактивные объекты

Создаются действием `Zelda: Create Object` или специализированными `Zelda: Create Chest`, `Zelda: Create Door`. Всё выбирается в форме: тип и замок — из списков, точки — на карте, переменные — из переменных проекта.

## Поля `Zelda: Create Object`

| Поле | Смысл |
|---|---|
| Type | тип объекта (список; таблица ниже) |
| Position | точка на карте |
| Sprite (image) | своя картинка из *Images* PS Maker вместо встроенной |
| Look (map object), Look when used | объект из библиотеки *Map objects* PS Maker: обычный вид и вид после использования (пень, осколки, нажатая кнопка); тело — его коробка коллизии (docs/SPRITES.md) |
| Hidden | создать скрытым (показать — *Reveal object at* в правиле или `Change Object` → Reveal) |
| Stays on | плита остаётся нажатой, рычаг/кнопка не выключаются обратно |
| Width, Height | размер в пикселях; 0 = 16 |
| Text | текст таблички или сообщение при использовании |
| Reacts to | чем можно воздействовать (несколько вариантов): меч, стрела, бомба, бумеранг, огонь… — для `reactive`, кнопок, разрушаемых |
| On use: turn on variable | переменная проекта, которая включается при активации |
| On use: open door at | дверь (выбрать на карте), которая открывается при активации |
| On use: reveal object at | скрытый объект (выбрать на карте), который появляется при активации |

Состояние объекта (открыт, включён, разрушен) запоминается по его типу и месту на карте — id вводить не нужно.

`Zelda: Create Door`: *Lock* — None (открывается клавишей действия), Small key, Big Key, Switch / rule (только переключатель, правило или `Change Object`); *Width*/*Height* — для широких ворот (например, высота 32); *Look: closed* / *Look: open* — свои картинки из *Map objects*.

`Zelda: Create Chest`: *Item* (список), *Count*, *Needs Big Key*, *Hidden*, *Look: closed* / *Look: open*. `Zelda: Place Item`: *Item*, *Count*, *Only once* (взятый предмет не появляется снова), *Look (map object)*.

Внутри все типы — один класс `Interactable` с конфигурацией `ObjectConfig` (таблица полей ниже); поля, которых нет в форме, доступны из кода (`ZeldaMakerToolkit.createObject(type, x, y, { overrides })`).

## Типы

| Тип | Твёрдый | Реагирует на | Особенности |
|---|---|---|---|
| `bush` | да | sword, spin, bomb, fire, magic | поднимается (Z) и бросается; дроп |
| `grass` | нет | sword, spin, bomb, fire | дроп |
| `pot` | да | bomb, thrown | поднимается и бросается; дроп |
| `rock` | да | bomb | поднимается только с `glove` |
| `heavy_rock` | да | bomb (2 попадания) | не поднимается |
| `breakable` | да | bomb | постоянный |
| `bombable_wall` | да | bomb | после взрыва — проход (не твёрдый), постоянный |
| `lever` | да | Z (действие) | переключается, постоянный |
| `button` | да | sword, spin, arrow, boomerang, bomb, fire, magic | переключается ударом, кулдаун 300 мс, постоянный |
| `pressure_plate` | нет | игрок / блок (настраивается) | `plateMode`: `hold` (пока нажата) или `latch` (остаётся нажатой) |
| `block` | да | толкание | шаг `tileSize`, `pushDirections`, `pushLimit`, постоянная позиция |
| `chest` | да | Z | содержимое, требование большого ключа, постоянный |
| `door` | да | касание/Z, правила | `lock`: none, small_key, big_key, switch; `startOpen` |
| `hidden_passage` | нет | правила, инструменты | появляется по `reveal` |
| `torch` | да | fire | состояние `lit` |
| `reactive` | да | настраивается | универсальный объект «реагирует на предмет» |
| `spikes` | нет | — | урон при касании (с учётом неуязвимости) |
| `pit` | нет | — | падение: урон и возврат на последнюю безопасную точку |
| `sign` | да | Z | показывает `message` |

## Поля `ObjectConfig`

| Поле | Тип | Смысл |
|---|---|---|
| `sprite`, `activeSprite` | строка | встроенный спрайт или ключ текстуры PS Maker (обычное и активное состояние) |
| `width`, `height` | число | размер в пикселях (по умолчанию 16×16) |
| `solid` | bool | блокирует игрока, врагов, снаряды |
| `hidden` | bool | создаётся скрытым |
| `tools` | массив типов урона | чем можно воздействовать |
| `durability` | число | сколько попаданий нужно |
| `liftable`, `liftRequires` | bool, id предмета | подъём и броски |
| `actionable` | bool | реагирует на клавишу действия (для `reactive`) |
| `requires` | `{ item?, flag?, bigKey? }` | условие взаимодействия (сообщение при невыполнении) |
| `persistent` | bool | помнить состояние (нужен явный ID) |
| `drops` | таблица / `"default"` / `null` | выпадение при разрушении |
| `contents` | `{ item, count }` | содержимое сундука |
| `lock`, `startOpen`, `unlockOnTouch` | | двери |
| `toggle` | bool | рычаг/кнопка переключается туда-обратно |
| `plateMode`, `activators` | `hold`/`latch`, `["player","block","enemy"]` | плиты |
| `pushDirections`, `pushLimit`, `pushDistance` | | блоки |
| `hazardDamage` | число | шипы, ямы |
| `message` | текст / `{en, ru}` | сообщение при активации / на табличке |
| `setFlag` | строка | флаг при активации (снимается при выключении для `toggle`) |
| `emit` | строка | событие `zelda:custom:<emit>` при активации |
| `onActivate`, `onDeactivate` | массив действий правил | что выполнить |
| `tint` | число | цветовой тинт |
| `spriteOffsetX`, `spriteOffsetY` | число | сдвиг картинки относительно центра тела |
| `spriteScale` | число | масштаб картинки; 0 = растянуть до размера объекта (встроенные — кратно) |
| `keepWhenDestroyed` | bool | разрушенный объект остаётся на месте с картинкой `activeSprite` (пень, осколки) |

## Состояния

`idle, destroyed, on, off, opened, closed, locked, unlocked, lit, revealed, hidden, carried`. Активные (для условий `switchOn` и др.): `on, opened, unlocked, lit, destroyed, revealed`. Изменить вручную — `Zelda: Change Object`: *Object at* (выбрать на карте) и *Operation* из списка: Open, Close, Switch on/off, Toggle, Light, Unlock, Reveal, Hide, Reset (забыть сохранённое), Destroy.

## Примеры

Глаз-мишень, реагирующий только на стрелы и открывающий дверь:
```
Zelda: Create Object  Type: Reactive  Reacts to: Arrow  [x] Stays on  On use: open door at: ●  Text: Щёлк!
```

Плита, которая остаётся нажатой, и ворота высотой в два тайла:
```
Zelda: Create Object  Type: Pressure plate  [x] Stays on  On use: open door at: ● (ворота)
Zelda: Create Door    Lock: Switch / rule   Height: 32
```

Из кода — поля, которых нет в форме (блок толкается только вверх и один раз):
```js
ZeldaMakerToolkit.createObject("block", 120, 80, { id: "b1", overrides: { pushDirections: ["up"], pushLimit: 1 } });
```

## `hook_post` и `buried` (с 0.30–0.31)

- `hook_post` — столб, за который цепляется крюк-кошка (`Create Object` → Type *hook_post*); твёрдый, ничем не разрушается.
- `buried` — закопанный клад (`Create Chest` → *Buried*): невидим, лопата выкапывает его, ямка остаётся.

