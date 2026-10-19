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

`Zelda: Define Item`, JSON:

```json
{
  "id": "ice_rod",
  "name": {"en": "Ice Rod", "ru": "Ледяной жезл"},
  "description": {"en": "Freezes enemies.", "ru": "Замораживает врагов."},
  "icon": "icon_fire_rod",
  "resource": "magic",
  "cost": 4,
  "cooldownMs": 400,
  "effect": "projectile",
  "projectile": {"damageType": "ice", "damage": 3, "stunMs": 1200, "speed": 180, "range": 150, "tint": 8965375}
}
```

Эффекты:

| `effect` | Параметры |
|---|---|
| `projectile` | `projectile: { damage, damageType, speed, range, sprite, stunMs, knockback, pierce, tint, size }` |
| `area` | `area: { radius, damage, damageType, knockback, stunMs, sprite }` — удар по площади вокруг игрока |
| `heal` | `amount` |
| `restoreMagic` | `amount` |
| `setFlag` | `flag`, `value` |
| `emit` | `event` → `zelda:custom:<event>` |
| `none` | предмет-ключ для сюжета/условий (`hasItem`) |

Общие поля: `id`, `name`, `description`, `icon`, `resource`, `cost`, `cooldownMs`, `maxActive`, `useMs`, `stackable`, `quickUse`.

Свой ресурс (например, «семена»): добавьте ёмкость `{"inventory":{"capacities":{"seeds":50}}}` и укажите `"resource":"seeds"` у предмета. Названия ресурсов для сообщений — через строки `item.seeds.name` (`ZeldaMakerToolkit.extendStrings`) или поле `name` у предмета с `"stackable": true`.

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
