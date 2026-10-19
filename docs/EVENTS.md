# События и JavaScript API

Действия редактора (то, что автор вызывает из PS Maker) описаны в [ACTIONS.md](ACTIONS.md). Здесь — события, которые Toolkit **отправляет**, и программный API.

## Почему события не видны в редакторе PS Maker

API плагинов PS Maker 0.0.3 позволяет регистрировать только действия. Подписать событие PS Maker (группу событий, триггер) на событие плагина нельзя. Поэтому реакция на события Toolkit делается:

1. **Правилами Toolkit** (`Zelda: Add Rule`) — без кода, основной способ;
2. **JS API** — из плагинов-расширений или штатного события PS Maker «Run Code»;
3. **DOM-событиями** — при `{"debug":{"domEvents":true}}` каждое событие дублируется как `window` `CustomEvent` с тем же именем.

## События `zelda:*`

| Событие | Данные |
|---|---|
| `zelda:toolkit:started` | `{ mapId }` |
| `zelda:toolkit:stopped` | `{ mapId, reason }` |
| `zelda:player:attack` | `{ kind: "sword" \| "spin" \| "poke", facing }` |
| `zelda:player:charged` | `{ facing }` |
| `zelda:player:takeDamage` | `{ amount, type, sourceId }` |
| `zelda:player:blocked` | `{ type, sourceId }` — щит заблокировал |
| `zelda:player:healthChanged` | `{ hp, maxHp, delta }` |
| `zelda:player:magicChanged` | `{ magic, maxMagic, delta }` |
| `zelda:player:died` | `{ mapId }` |
| `zelda:player:respawned` | `{ x, y }` |
| `zelda:item:used` | `{ itemId }` |
| `zelda:item:failed` | `{ itemId, reason: noResource \| cooldown \| disabled \| busy \| maxActive \| notOwned }` |
| `zelda:item:collected` | `{ itemId, count, total }` |
| `zelda:item:equipped` | `{ itemId }` |
| `zelda:resource:changed` | `{ resource, value, max }` |
| `zelda:ability:changed` | `{ ability, enabled }` |
| `zelda:enemy:spawned` | `{ enemyId, template, group }` |
| `zelda:enemy:damaged` | `{ enemyId, amount, type, hp }` |
| `zelda:enemy:blocked` | `{ enemyId, type }` |
| `zelda:enemy:stunned` | `{ enemyId, ms }` |
| `zelda:enemy:phaseChanged` | `{ enemyId, phase }` |
| `zelda:enemy:defeated` | `{ enemyId, template, group }` |
| `zelda:boss:defeated` | `{ enemyId, dungeonId }` |
| `zelda:object:damaged` | `{ objectId, objectType, tool }` |
| `zelda:object:destroyed` | `{ objectId, objectType }` |
| `zelda:object:stateChanged` | `{ objectId, objectType, state }` |
| `zelda:object:lifted` / `zelda:object:thrown` | `{ objectId }` |
| `zelda:block:moved` | `{ objectId, x, y }` |
| `zelda:switch:activated` | `{ switchId, on }` |
| `zelda:chest:opened` | `{ chestId, itemId, count }` |
| `zelda:door:unlocked` | `{ doorId, lock }` |
| `zelda:door:opened` / `zelda:door:closed` | `{ doorId }` |
| `zelda:flag:changed` | `{ flag, value }` |
| `zelda:puzzle:progress` | `{ puzzleId, step, total }` |
| `zelda:puzzle:failed` / `zelda:puzzle:solved` | `{ puzzleId }` |
| `zelda:rule:fired` | `{ ruleId, branch: "then" \| "else" }` |
| `zelda:wave:started` | `{ roomId, wave, total }` |
| `zelda:wave:cleared` | `{ roomId }` |
| `zelda:dungeon:entered` / `zelda:dungeon:completed` | `{ dungeonId }` |
| `zelda:message` | `{ text, durationMs }` |
| `zelda:inventory:toggled` | `{ open }` |
| `zelda:save:written` / `zelda:save:loaded` / `zelda:save:reset` | `{ slot }` |
| `zelda:custom:<имя>` | произвольный объект — из действия правил `emit` или поля объекта `emit` |

Обработчики вызываются синхронно в порядке подписки; исключение в одном обработчике логируется и не мешает остальным. Рекурсия глубже 32 уровней обрывается с ошибкой в логе (защита от правил, вызывающих друг друга).

## JavaScript API: `globalThis.ZeldaMakerToolkit`

Доступен после первого действия Toolkit на карте (например, `Zelda: Start Toolkit`).

```js
const Z = window.ZeldaMakerToolkit;

// Подписки (возвращают функцию отписки)
const off = Z.on("zelda:enemy:defeated", (e) => console.log("defeated", e.enemyId));
Z.once("zelda:chest:opened", (e) => {});
Z.emitCustom("cutscene_done", { who: "sage" }); // → zelda:custom:cutscene_done

// Настройки и контент
Z.configure({ sword: { damage: 3 } });
Z.defineItem({ id: "ice_rod", resource: "magic", cost: 4, effect: "projectile", projectile: { damageType: "ice", damage: 3, stunMs: 1000 } });
Z.registerItem({ id: "lantern", icon: "icon_generic", quickUse: true, use(ctx) { /* ... */ return true; } });
Z.registerEnemyTemplate("red_soldier", { extends: "soldier", hp: 8, tint: 0xff5555 });
Z.registerCondition("isNight", () => myClock.hour >= 20);
Z.registerAction("playJingle", (arg, ctx) => { /* ... */ });
Z.extendStrings({ ru: { "item.lantern.name": "Фонарь" }, en: { "item.lantern.name": "Lantern" } });

// Состояние
Z.give("bombs", 5);  Z.spend("rupees", 10);  Z.has("bow");
Z.setFlag("talked_to_sage");  Z.getFlag("talked_to_sage");
Z.heal(2);  Z.damagePlayer(1);
Z.getState();            // глубокая копия GameState
Z.save();  Z.load();

// Текущая карта
Z.spawnEnemy("slime", 120, 80, { id: "s1", group: "room1" });
Z.createObject("chest", 64, 64, { id: "c9", overrides: { contents: { item: "key", count: 1 } } });
Z.session;   // текущая Session (или null)
Z.toolkit;   // экземпляр Toolkit (для продвинутых расширений)
```

### Интерфейс предмета

```ts
interface ItemDefinition {
  id: string;
  name?: string | { en?: string; ru?: string };
  description?: string | { en?: string; ru?: string };
  icon: string;               // встроенный спрайт или ключ текстуры PS Maker
  quickUse: boolean;          // можно поставить в быстрый слот
  stackable?: boolean;        // хранится как количество
  resource?: string;          // "bombs" | "arrows" | "magic" | свой ресурс
  cost?: number | ((s) => number);
  cooldownMs?: number | ((s) => number);
  maxActive?: number | ((s) => number); // лимит живых сущностей предмета
  useMs?: number;             // занятость игрока после использования
  counter?: string;           // ресурс, показываемый в HUD
  use?(ctx: ItemUseContext): boolean | Entity;
}
```

`ItemSystem` сам проверяет владение, способность, кулдаун, лимит и ресурс и списывает ресурс **только после** успешного `use`.
