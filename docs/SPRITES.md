# Спрайт-листы и анимации (Mana Seed и другие наборы)

Toolkit умеет рисовать атаки игрока и врагов кадрами из ваших спрайт-листов: тело персонажа и отдельный слой оружия (как в наборах **Mana Seed** — Character Base + Weapon sheets). Ассеты наборов не входят в плагин: используйте свои купленные файлы на условиях их лицензии.

## Анимации прямо из PS Maker (экспериментально, 0.5.1)

Если персонажи и листы уже заведены в библиотеке PS Maker (как Mana Seed у вас), их можно не описывать заново:

- `Zelda: Create Enemy` → выпадающий список **Look (PS Maker character)** — выберите, например, Slime (ставить его на карту не нужно): враг берёт листы персонажа по названиям (`… Run`/`Walk` — движение, `Idle`, `Attack`, `Hurt`, `Death`), порядок строк направлений из его набора анимаций и коллизию (размер хитбокса и сдвиг картинки).
- `Zelda: Set Player Sprites` → **Attack animation (PS Maker)** и **Hurt animation (PS Maker)**: выберите анимацию игрока в списке (например, Sword Attack — любое направление), Toolkit возьмёт все направления этого листа. У Mana Seed меч уже нарисован в кадрах, слой оружия не нужен.

Данные проекта PS Maker 1.2.1 хранит в `scene.data.story`, текстуры листов — под ключом `<id анимации>frames` (см. ENGINE_AUDIT, раздел 11); строка `PS Maker data:` в панели F10 показывает, что данные найдены.

## Как это устроено

1. **Лист** (`Zelda: Define Sprite Sheet`) — картинка, нарезанная на одинаковые кадры. Кадры нумеруются с 0 слева направо, сверху вниз.
2. **Анимация** (`Zelda: Define Animation`) — список номеров кадров, общий или для каждого направления.
3. **Где показывать**: атаки игрока — `Zelda: Set Player Sprites`; враги — поле *Animations* в `Zelda: Create Enemy` (или `animations` в `Zelda: Define Enemy`).

Во время атаки Toolkit скрывает обычный спрайт PS Maker и рисует поверх него кадры тела и оружия (с теми же origin/scale, что у игрока), затем возвращает спрайт. Тайминг удара (подготовка → удар → восстановление) остаётся игровым: анимация растягивается на всю длительность удара, если FPS = 0, поэтому хитбокс всегда совпадает с нужными кадрами.

## Пошагово для Mana Seed

> Номера кадров ниже — **пример**. Раскладка страниц Mana Seed отличается между версиями и наборами, поэтому номера берите из просмотрщика (шаг 3). Размер кадра у Character Base обычно 64×64 — сверьте с документацией набора.

1. Загрузите в PS Maker лист персонажа (страница с атаками) и лист оружия как изображения.
2. On-load события карты (или одной стартовой карты — настройки сохраняются до перезагрузки игры):

| Действие | Параметры |
|---|---|
| `Zelda: Define Sprite Sheet` | Sheet ID `hero`, Image — лист персонажа, Frame 64×64 |
| `Zelda: Define Sprite Sheet` | Sheet ID `sword`, Image — лист меча, Frame 64×64 |

   Если выбор картинки не сработал (в консоли/диагностике «no image»), впишите в *Image key or URL* ключ текстуры или путь к файлу.
3. `Zelda: Preview Sprite Sheet` (Sheet ID `hero`, Show = true) — в игре лист покажется на весь экран с номером каждого кадра. Запишите номера кадров удара для каждого направления. Закрыть — тем же действием с Show = false.
4. Анимации:

| Действие | Параметры |
|---|---|
| `Zelda: Define Animation` | ID `hero_slash`, Sheet `hero`, Frames (facing down) `A, B, C, D`, Frames facing up `E, F, G, H`, Frames facing right `I, J, K, L`, FPS 0 |
| `Zelda: Define Animation` | ID `sword_slash`, Sheet `sword`, те же номера кадров, FPS 0 |

   Если левое направление не указано, используется правое с отражением. Для наборов, где оружие нарисовано кадр-в-кадр поверх тела, номера у тела и оружия совпадают.
5. `Zelda: Set Player Sprites`: Attack (body) `hero_slash`, Attack (weapon) `sword_slash`, галочки *Weapon behind when facing …* (в каких направлениях оружие за телом; по умолчанию — вверх), Hide PS Maker sprite = true. При необходимости — Spin/Charge/Hurt и смещение Offset X/Y.

Встроенный клинок автоматически скрывается, когда задана анимация атаки (`sword.showBlade`: `auto` | `always` | `never`). Точку вращения удара сдвигают поля *Swing center X/Y* у `Set Player Sprites`.

## Враги из спрайт-листа

```
Zelda: Define Sprite Sheet   id=slime_sheet  image=...  64x64
Zelda: Define Animation      id=slime_walk   sheet=slime_sheet  frames="0,1,2,3"  fps=8  loop=true
Zelda: Define Animation      id=slime_hit    sheet=slime_sheet  frames="8"
Zelda: Create Enemy          Template: slime  Walk animation: slime_walk  Hurt animation: slime_hit
                             Sprite offset Y: -16
```

Состояния: `idle`, `walk`, `windup`, `attack`, `hurt` (также при оглушении), `death`. Отсутствующие состояния заменяются соседними (`windup` → `attack`, `idle` ↔ `walk`). Хитбокс врага остаётся от шаблона, а картинка двигается отдельно полями *Sprite offset X/Y* и *Sprite scale* (у `Create Enemy` и `Define Enemy`).

## Проверка

- **F10** (или `Zelda: Debug` → Diagnostics) показывает предупреждения: неизвестный лист, нет кадра с таким номером, картинка не загрузилась.
- Кадры, которых нет на листе (номер больше числа кадров), пропускаются с предупреждением.
