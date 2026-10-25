# Предметы, ресурсы и инвентарь

## Предметы и ресурсы

| ID | Тип | Использование |
|---|---|---|
| `sword` | экипировка | кнопка меча |
| `shield` | экипировка | пассивная/удерживаемая блокировка спереди |
| `glove` | экипировка | подъём камней |
| `bomb` | быстрый предмет, ресурс `bombs` | положить бомбу (выдаётся автоматически вместе с бомбами) |
| `boomerang` | быстрый предмет | оглушает, возвращается, нажимает кнопки, приносит предметы |
| `bow` | быстрый предмет, ресурс `arrows` | стрела |
| `hookshot` | быстрый предмет | **экспериментально**, включается `items.hookshot.enabled` |
| `fire_rod` | быстрый предмет, ресурс `magic` | огненный шар, зажигает факелы |
| `healing_spell` | быстрый предмет, ресурс `magic` | лечение (не тратит магию при полном здоровье) |
| `bombs`, `arrows`, `rupees` | ресурсы | ёмкость `inventory.capacities` |
| `magic` | ресурс | банка магии |
| `heart` | подбор | +1 сердце здоровья |
| `heart_container` | подбор | +1 сердце максимума и полное лечение |
| `key`, `big_key`, `map`, `compass` | подземелье | считаются для текущего подземелья |

Выдать — `Zelda: Give Item` (сундук, NPC, магазин). Потратить — `Zelda: Spend Resource`. Забрать — `Zelda: Remove Item`. Поставить в быстрый слот — `Zelda: Equip Item`. Временно запретить (например, меч в деревне) — `Zelda: Set Ability` (`sword`, `false`).

Ресурс списывается только при успешном использовании; при нехватке — сообщение «Недостаточно: …» и событие `zelda:item:failed` с `reason: "noResource"`.

## Быстрый слот и панель

- **C** — использовать активный предмет, **Q/E** — переключить; порядок — `inventory.order`, затем порядок получения.
- **I** — панель предметов (по умолчанию ставит игру на паузу); Q/E внутри панели выбирают предмет, показываются название, количество и описание.
- HUD показывает активный предмет и количество его ресурса.

## Свой предмет без кода

`Zelda: Define Item` — поля формы:

| Поле | Смысл |
|---|---|
| Item ID, Name, Icon | имя предмета, название в сообщениях, иконка (картинка PS Maker) |
| Uses, Cost | что тратит одно использование: `magic`, `arrows`, `bombs`, `rupees` или пусто (бесплатно) и сколько |
| Damage, Damage type | урон выстрела; тип урона (`magic`, `fire`, `ice`…) — враги могут быть к нему устойчивы |
| Area attack | бить всё вокруг игрока вместо выстрела |
| Stun (ms) | оглушить врагов при попадании |
| Heal | восстановить половинок сердца (предмет становится лечебным) |
| Give now | сразу выдать игроку |

Что получится: *Heal* > 0 — лечебный предмет; иначе *Damage* > 0 — выстрел (или удар вокруг с *Area attack*); иначе — сюжетный предмет для условий *When player has*.

Пример «Ледяной жезл»: Item ID `ice_rod`, Name `Ледяной жезл`, Uses `magic`, Cost `4`, Damage `3`, Damage type `ice`, Stun `1200`.

Из кода доступны все поля (скорость и дальность выстрела, пробивание, эффекты `restoreMagic`, `setFlag`, `emit`, перевод названия): `ZeldaMakerToolkit.defineItem({ id, name: { en, ru }, effect: "projectile", projectile: { speed, range, pierce } })`.

Свой ресурс (например, «семена») пока объявляется из кода: `ZeldaMakerToolkit.configure({ inventory: { capacities: { seeds: 50 } } })`; затем *Uses* = `seeds`, пополнение — `Give Item`. Названия ресурсов для сообщений — через строки `item.seeds.name` (`ZeldaMakerToolkit.extendStrings`) или поле `name` у предмета с `"stackable": true`.

## Предмет из кода

```js
ZeldaMakerToolkit.registerItem({
  id: "pegasus_dash",
  icon: "icon_generic",
  quickUse: true,
  cooldownMs: 800,
  use(ctx) {
    // ctx: { session, facing, x, y, frontX, frontY, dirX, dirY }
    ctx.session.player.moveWithCollision(ctx.dirX * 32, ctx.dirY * 32);
    return true; // или Entity, чтобы учитывать maxActive
  },
});
```
