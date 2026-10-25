# Интерактивные объекты

Создаются действием `Zelda: Create Object` или специализированными `Zelda: Create Chest`, `Zelda: Create Door`. Все поля — обычные поля формы, JSON не нужен.

## Поля `Zelda: Create Object`

| Поле | Смысл |
|---|---|
| Type | тип объекта (таблица ниже) |
| Position, ID | точка и имя (ID нужен для сохранения состояния и ссылок из других действий) |
| Sprite | своя картинка вместо встроенной |
| Hidden | создать скрытым (показать — *Reveal* в правиле или `Change Object` → reveal) |
| Stays on | плита остаётся нажатой, рычаг/кнопка не выключаются обратно |
| Width, Height | размер в пикселях; 0 = 16 |
| Text | текст таблички или сообщение при использовании |
| Reacts to | чем можно воздействовать: `sword, arrow, bomb, boomerang, fire…` (для `reactive`, кнопок, разрушаемых) |
| On use: set flag | флаг при активации |
| On use: open doors | двери, которые открываются при активации |
| On use: reveal | скрытые объекты, которые появляются при активации |

`Zelda: Create Door`: галочки *Needs a small key*, *Needs the Big Key*, *Opened by switch* (только переключатель, правило или `Change Object`); без галочек дверь открывается клавишей действия. *Width*/*Height* — для широких ворот (например, высота 32).

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
| `button` | да | sword, spin, arrow, boomerang, bomb, hookshot, fire, magic | переключается ударом, кулдаун 300 мс, постоянный |
| `pressure_plate` | нет | игрок / блок (настраивается) | `plateMode`: `hold` (пока нажата) или `latch` (остаётся нажатой) |
| `block` | да | толкание | шаг `tileSize`, `pushDirections`, `pushLimit`, постоянная позиция |
| `chest` | да | Z | содержимое, требование большого ключа, постоянный, можно цеплять крюком |
| `door` | да | касание/Z, правила | `lock`: none, small_key, big_key, switch; `startOpen` |
| `hidden_passage` | нет | правила, инструменты | появляется по `reveal` |
| `torch` | да | fire | состояние `lit` |
| `reactive` | да | настраивается | универсальный объект «реагирует на предмет» |
| `spikes` | нет | — | урон при касании (с учётом неуязвимости) |
| `pit` | нет | — | падение: урон и возврат на последнюю безопасную точку |
| `hook_post` | да | — | цель для крюка |
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
| `hookable` | bool | крюк подтягивает к объекту |
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

## Состояния

`idle, destroyed, on, off, opened, closed, locked, unlocked, lit, revealed, hidden, carried`. Активные (для условий `switchOn` и др.): `on, opened, unlocked, lit, destroyed, revealed`. Изменить вручную — `Zelda: Change Object` (операции open, close, on, off, toggle, reveal, hide, destroy, state); сбросить в исходное и забыть сохранённое — та же операция `reset`.

## Примеры

Глаз-мишень, реагирующий только на стрелы и открывающий дверь:
```
Zelda: Create Object  Type: reactive  ID: eye  Reacts to: arrow  [x] Stays on  On use: open doors: eye_door  Text: Щёлк!
```

Плита, которая остаётся нажатой, и ворота высотой в два тайла:
```
Zelda: Create Object  Type: pressure_plate  ID: plate_1  [x] Stays on  On use: open doors: gate
Zelda: Create Door    ID: gate  [x] Opened by switch  Height: 32
```

Из кода — поля, которых нет в форме (блок толкается только вверх и один раз):
```js
ZeldaMakerToolkit.createObject("block", 120, 80, { id: "b1", overrides: { pushDirections: ["up"], pushLimit: 1 } });
```
