// Лодауты — готовые наборы данных «улей + статы + настройки подбора» (например, свой для каждого аккаунта).
// Хранятся в data/loadouts.json (пишет сайт через POST /api/me); активный дублируется в data/my-hive.json и
// data/my-setup.json — их читает MCP как "my". Встроенный лодаут «Лучшее» не хранится, а строится здесь.

export const BEST_ID = 'best';

/**
 * Лучшее снаряжение: в каждом слоте — то, что даёт больше всего мёда в модели (подбор по слотам, среднее по
 * Pine Tree Forest, Rose Field, Pumpkin Patch, Coconut Field и Mountain Top Field, 2026-11-14).
 * Diamond Mask обгоняет Demon/Gummy Mask за счёт x3 вместимости.
 */
export const BEST_GEAR = {
  tool: 'Dark Scythe', bag: 'Coconut Canister', hat: 'Diamond Mask', belt: 'Coconut Belt', boots: 'Gummy Boots',
  guardL: 'Cobalt Guard', guardR: 'Crimson Guard',
};

/**
 * Лучшие амулеты: высший вид каждого (Supreme, у Stick Bug — Diamond) с максимальными значениями строк из кода игры
 * (data/amulets.json ← ReplicatedStorage.Amulets). Строки из пулов «Select N» выбраны перебором: больше мёда в модели
 * (при равенстве — больше пыльцы), строки, которые модель не считает (атака, бонд), — только если в пуле больше нечего взять.
 * Строки про поля (Zone) — для средних полей, на остальных они ничего не дают.
 */
export const BEST_AMULETS = [
  { name: 'Supreme Star Amulet', type: 'Supreme Star Amulet', lines: 'x2.5 Capacity\nx1.25 Convert Rate\n+20% Pollen\n+70% White Pollen\n+70% Red Pollen\n+70% Blue Pollen\n+Passive: Guiding Star' },
  { name: 'Moon Amulet', type: 'Moon Amulet', lines: '+250,000 Capacity\n+3 Movement Collection\n+50% White Pollen\n+5% Pollen' },
  { name: 'Supreme Ant Amulet', type: 'Supreme Ant Amulet', lines: '+110% Convert Rate\n+3% Critical Chance\n+50% Critical Power\n+5% Pollen\n+30% White Pollen\n+30% Red Pollen' },
  { name: 'Supreme Shell Amulet', type: 'Supreme Shell Amulet', lines: '+15% Goo\n+65% Stump Field Pollen\n+50% Honey From Tokens\n+25 Convert Amount\n+30% Cactus Field Pollen\n+30% Pineapple Patch Pollen\n+30% Pumpkin Patch Pollen' },
  { name: 'Diamond Stick Bug Amulet', type: 'Diamond Stick Bug Amulet', lines: '+300,000 Capacity\nx1.25 Convert Rate\n+20% Tool Pollen\n+10% Monster Respawn Time\n+1 Red Bee Attack\n+30% White Pollen\n+100% Honey From Tokens' },
  { name: 'King Beetle Amulet', type: 'King Beetle Amulet', lines: '+100% Convert Rate\n+1 Red Bee Attack\n+100% Mushroom Field Pollen\n+100% Blue Flower Field Pollen' },
  { name: 'Supreme Cog Amulet', type: 'Supreme Cog Amulet', lines: '+250,000 Capacity\n+15% Bee Attack\n+30% White Pollen\n+30% Bubble Pollen\n+25% Super-Crit Power\n+5% Instant White Conversion' },
];

/** Встроенный лодаут «Лучшее»: лучшие вещи, все бейджи Grandmaster, лучшие амулеты; улья нет (его подбирают). */
export function bestLoadout(gear) {
  return {
    id: BEST_ID,
    name: 'Лучшее',
    builtin: true,
    hive: [],
    setup: {
      mode: 'gear',
      gear: {
        ...BEST_GEAR,
        badges: Object.fromEntries((gear?.badges || []).map((b) => [b.category, 'Grandmaster'])),
        amulets: BEST_AMULETS.map((a) => ({ ...a })),
        extra: '',
      },
      statsFromGame: true,
      walkSeconds: 20,
      tabbyStacks: 1000, // максимум Tabby Love
      scienceStacks: 31, // максимум Science Enhancement (BuffDefs: MaxCombo 31)
      polarPower: 0, // у Polar Power предела нет — не выдумываем
    },
  };
}

/** Новый id лодаута. */
export const newLoadoutId = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Найти лодаут по имени или id (без учёта регистра); "my"/"мой" — активный.
 * @param file содержимое data/loadouts.json ({ active, list }) или null
 * @returns { id, name, builtin, hive, setup } или null
 */
export function findLoadout(file, gear, nameOrId) {
  const best = bestLoadout(gear);
  const list = (file?.list || []).map((l) => (l.builtin || l.id === BEST_ID ? { ...best, opt: l.opt } : l));
  if (!list.some((l) => l.id === BEST_ID)) list.unshift(best);
  const q = String(nameOrId ?? '').trim().toLowerCase();
  if (!q || /^(my|мой|мои|active|активный)$/.test(q)) return list.find((l) => l.id === file?.active) || list.find((l) => !l.builtin) || best;
  return list.find((l) => l.id.toLowerCase() === q) || list.find((l) => l.name.toLowerCase() === q)
    || list.find((l) => l.name.toLowerCase().startsWith(q)) || null;
}
