# Противники

`Zelda: Create Enemy`:
- *Template* — список: slime, soldier, spitter, knight, sentry, ogre и Custom enemy 1–6 (свои типы из `Define Enemy`);
- *Position* — точка на карте (пусто — рядом с игроком);
- *Look (PS Maker character)* — внешний вид и коллизия персонажа из библиотеки PS Maker ([SPRITES.md](SPRITES.md));
- *Group* — Group 1–9: правило *When group defeated* ждёт победы над всей группой;
- *Health*, *Damage*, *Speed* — числа, 0 = как в шаблоне;
- *Walk / Attack / Hurt / Death animation* — анимации PS Maker вручную;
- *Patrol route* — путь на карте: кликните точки маршрута, враг обходит их по порядку;
- *Sprite offset X/Y*, *Sprite scale* — положение картинки относительно хитбокса.

`Zelda: Enemy From NPC` — *NPC* (список NPC на карте), *Template*, *Group*, *Health*, *Damage*, *Speed* (см. ниже).

`Zelda: Define Enemy` — свой тип: *Enemy type* (Custom enemy 1–6), *Based on*, *Look*, *Health*, *Damage*, *Speed*, *Sight range*, *Boss*, *Immune to* (несколько типов урона), *Sprite offset/scale*. Затем выберите этот тип в *Template* у `Create Enemy`.

Побеждённый босс запоминается по месту на карте — id не нужен.

**Касание игрока.** Враг, задевший игрока, прерывает выпад и отскакивает назад (`enemies.contactRecoil`, меньше у врагов с `knockbackResist`), игрок отлетает в противоположную сторону. Пока игрок мигает после удара, враги его не перекрывают — их выталкивает. Поэтому враг не «проскакивает» сквозь игрока.

## Встроенные шаблоны

Имена и графика оригинальные.

| Шаблон | Поведение | HP | Урон | Особенности |
|---|---|---|---|---|
| `slime` | melee | 2 | 1 | медленный, прыжок-выпад |
| `soldier` | melee | 4 | 2 | быстрее, большая дальность обнаружения |
| `spitter` | shooter | 3 | 1 (снаряд 2) | держит дистанцию, стреляет по осям; снаряды блокируются щитом |
| `knight` | guardian | 6 | 2 | периодически поднимает щит: спереди неуязвим, кроме bomb/fire/spin; стойкий к отбрасыванию; стрелы ×0.5 |
| `sentry` | patroller | 3 | 1 | патрулирует (случайно в радиусе или по точкам), не преследует |
| `ogre` | miniboss | 24 | 2 | 3 фазы: выпады → залпы на 8 сторон → призыв слизней; босс, постоянный, роняет контейнер сердца |

## Состояния ИИ

`idle → patrol → alert → chase → windup → attack → recover`, а также `hurt` (отбрасывание), `stunned` (бумеранг), `dead`. Общие состояния обрабатывает класс `Enemy`, поэтому мёртвый враг сразу перестаёт двигаться, атаковать и наносить контактный урон (тест `a dead enemy never attacks…`). Решения (обнаружение, линия видимости, выбор атаки) принимаются раз в `enemies.thinkEveryTicks` тиков со сдвигом, движение — каждый тик.

## Поля конфигурации врага

В формах доступны самые нужные (Health, Damage, Speed, Sight range, Boss, Immune to, Sprite offset/scale, анимации, патруль). Полный список — для кода (`ZeldaMakerToolkit.registerEnemyTemplate(name, { extends, ... })`):

| Поле | Смысл |
|---|---|
| `behavior` | `melee`, `shooter`, `guardian`, `patroller`, `miniboss` |
| `sprite`, `tint`, `width`, `height` | вид и размер |
| `hp`, `damage`, `contactDamage` | здоровье, контактный урон |
| `speed`, `chaseSpeed`, `lungeSpeed` | скорости |
| `detectRange`, `loseRange`, `attackRange`, `preferredDistance`, `lineOfSight` | восприятие |
| `attackCooldownMs`, `windupMs`, `attackMs`, `hurtMs` | тайминги |
| `knockbackResist` | 0..1 |
| `resistances` | множители по типам урона, 0 — иммунитет: `{"arrow":0,"fire":2}` |
| `stunImmune` | не оглушается |
| `drops` | таблица дропа (null — общая `enemies.defaultDrops`) |
| `projectile` | `{ speed, damage, range, type, blockable, sprite, count }` |
| `patrol` | `{ mode: "wander" \| "path", points: ["p1","p2"] (маркеры) или [{x,y}], radius, pauseMs, chase }` |
| `guard` | `{ upMs, downMs, frontalDot, breakers: [типы урона, пробивающие щит] }` |
| `phases` | `[{ hpBelow, speedMultiplier, cooldownMultiplier, pattern: "chase" \| "burst" \| "summon", burstCount, summonTemplate, summonMax }]` |
| `boss` | победа = `zelda:boss:defeated`, завершение подземелья |
| `persistent` | не появляется снова после победы (нужен ID) |
| `tags` | метки для своих правил |
| `animations` | `{ idle, walk, windup, attack, hurt, death }` — id анимаций из спрайт-листа ([SPRITES.md](SPRITES.md)) |
| `spriteScale`, `spriteOffsetX`, `spriteOffsetY` | масштаб и смещение картинки относительно хитбокса |

## Свой шаблон

```
Zelda: Define Enemy   Enemy type: Custom enemy 1  Based on: soldier  Health: 6  Immune to: [fire]
Zelda: Create Enemy   Template: Custom enemy 1  Position: ●
```

Из кода — поля, которых нет в форме (стрелок с веером из трёх снарядов):
```js
ZeldaMakerToolkit.registerEnemyTemplate("fan_spitter", { extends: "spitter", projectile: { count: 3, speed: 110 } });
```

## NPC из редактора как враг

Действие **`Zelda: Enemy From NPC`**: выберите размещённого NPC — Toolkit возьмёт его позицию и использует его спрайт (с анимациями PS Maker) как визуал врага; собственное физическое тело NPC отключается на время «усыновления». После победы NPC скрывается. Формат значения параметра `npc` в PS Maker не задокументирован; поддерживаются объект Phaser, id и имя (поиск по `name`, `id`, `npcId`, `instanceId`, `uuid`, `key`, данным `getData`). Если NPC не найден, враг не создаётся и пишется предупреждение. (До 0.4.2 это был параметр *Use NPC* у `Create Enemy`; вынесен, чтобы пустое поле NPC не мешало обычному созданию врага.)
