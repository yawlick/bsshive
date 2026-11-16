// Что делает каждый токен способности — в виде, удобном для модели.
// Время появления токенов берётся из data/tokens.json (скопировано игрой → вики), а здесь — только эффект.
//
// Виды эффектов:
//   buff   — бафф игроку; stack: 'combo' (стаки растут, пока токены идут чаще, чем длится бафф) или
//            'refresh' (просто включён/выключен); value — прибавка за стак; stat — что усиливает.
//   pollen — сразу собирает пыльцу; perToken(ctx) -> { white, red, blue } до общих множителей.
//   honey  — даёт мёд; perToken(ctx) -> число.
//   mark   — метка на поле (бафф только пока игрок стоит в ней).
//   goo    — покрывает цветки слизью (puddle(ctx) -> { flowers: сколько цветков, size: размер лужи }); мёд от слизи — в model.js.
//   frog   — лягушка: прыгает и делает пузыри (bubbles(ctx) — сколько пузырей за одну лягушку).
//   none   — в модели пока не учитывается (note — почему).
//
// ctx: { level, gifted, bee (данные пчелы), field, stats, hive (сводка улья), cal (калибровка) }
// ГРУБО — значения, которых нет на вики; их надо подогнать замерами в игре (см. CALIBRATION в model.js).

const lvl10 = (level) => 1 + 0.1 * (level - 1); // «+10% за уровень»
const colors = ['white', 'red', 'blue'];

/** Пыльца с N цветков поля: power — сколько с одного цветка каждого цвета. */
export function flowersPollen(ctx, flowers, power) {
  const out = {};
  for (const c of colors) out[c] = flowers * ctx.field[c] * power[c] * ctx.field.size;
  return out;
}

function bomb(ctx, token) {
  const b = token.bomb;
  const flowers = b.plus ? 29 : 13;
  const lv = lvl10(ctx.level);
  const s = ctx.stats;
  // в данных игры ключи с большой буквы: { Red, White, Blue }
  const p = { white: b.powers.White || 0, red: b.powers.Red || 0, blue: b.powers.Blue || 0 };
  // Bomb Sync: красные/синие бомбы на время баффа собирают и белые цветки
  if (b.color === 'Red') p.white = 10 * (ctx.hive.buffs.redBombSync ?? 0);
  if (b.color === 'Blue') p.white = 10 * (ctx.hive.buffs.blueBombSync ?? 0);
  const kind = { Buzz: s.buzzBomb, Red: s.redBomb, Blue: s.blueBomb }[b.color] ?? 1;
  const mul = lv * s.bomb * kind * s.bombPower;
  for (const c of colors) p[c] = (p[c] || 0) * mul;
  return flowersPollen(ctx, flowers, p);
}

export const EFFECTS = {
  // ---- баффы пыльцы ----
  'Red Boost': { kind: 'buff', key: 'redBoost', stack: 'combo', dur: 15, max: 10, value: 0.2, stat: 'red' },
  'Blue Boost': { kind: 'buff', key: 'blueBoost', stack: 'combo', dur: 15, max: 10, value: 0.2, stat: 'blue' },
  'White Boost': { kind: 'buff', key: 'whiteBoost', stack: 'combo', dur: 15, max: 10, value: 0.2, stat: 'white' },
  Inspire: { kind: 'buff', key: 'inspire', stack: 'combo', dur: 5, max: 50, value: 1, stat: 'pollenX' },
  'Baby Love': { kind: 'buff', key: 'babyLove', stack: 'refresh', dur: 30, value: 1, stat: 'pollenX' },
  'Bear Morph': { kind: 'buff', key: 'bearMorph', stack: 'refresh', dur: 15, value: 1, stat: 'pollenX', note: 'x2 пыльцы; редкие морфы Gifted Bear Bee не отличаются' },
  Focus: { kind: 'buff', key: 'focus', stack: 'combo', dur: 20, max: 10, value: 0.03, stat: 'critChance' },
  Melody: { kind: 'buff', key: 'melody', stack: 'refresh', dur: 30, value: 1, stat: 'critPower' },
  'Puppy Love': { kind: 'buff', key: 'puppyLove', stack: 'refresh', dur: (ctx) => 10 + ctx.level, value: 0.5, stat: 'beeGatherNearby' }, // +50% сбора у 10 пчёл рядом
  // сами стаки Tabby Love — в настройке tabbyStacks
  'Tabby Love': { kind: 'buff', key: 'tabbyBlessing', stack: 'refresh', dur: (ctx) => 20 + 2 * ctx.level, value: 1, stat: 'tabbyBlessing' },
  'Red Bomb Sync': { kind: 'buff', key: 'redBombSync', stack: 'refresh', dur: 30, value: 1, stat: 'sync' },
  'Blue Bomb Sync': { kind: 'buff', key: 'blueBombSync', stack: 'refresh', dur: 30, value: 1, stat: 'sync' },

  // ---- метки ----
  'Pollen Mark': { kind: 'mark', key: 'pollenMark', dur: (ctx) => 7 + 0.2 * ctx.level, value: 0.5, max: 3, stat: 'pollenX' },
  'Pollen Mark+': { kind: 'mark', key: 'pollenMark', dur: (ctx) => 8 + 0.25 * ctx.level, value: 0.5, max: 3, stat: 'pollenX', big: true },
  'Honey Mark': { kind: 'mark', key: 'honeyMark', dur: (ctx) => 7 + 0.2 * ctx.level, value: 2, max: 3, stat: 'links' },
  'Honey Mark+': { kind: 'mark', key: 'honeyMark', dur: (ctx) => 8 + 0.25 * ctx.level, value: 2, max: 3, stat: 'links', big: true },

  // ---- бомбы ----
  'Buzz Bomb': { kind: 'pollen', source: 'bomb', perToken: (ctx, t) => bomb(ctx, t) },
  'Buzz Bomb+': { kind: 'pollen', source: 'bomb', perToken: (ctx, t) => bomb(ctx, t) },
  'Red Bomb': { kind: 'pollen', source: 'bomb', perToken: (ctx, t) => bomb(ctx, t) },
  'Red Bomb+': { kind: 'pollen', source: 'bomb', perToken: (ctx, t) => bomb(ctx, t) },
  'Blue Bomb': { kind: 'pollen', source: 'bomb', perToken: (ctx, t) => bomb(ctx, t) },
  'Blue Bomb+': { kind: 'pollen', source: 'bomb', perToken: (ctx, t) => bomb(ctx, t) },
  'Fuzz Bombs': {
    kind: 'pollen', source: 'bomb',
    perToken: (ctx) => {
      const s = ctx.stats;
      const count = 2 + Math.floor(ctx.level / 5);
      const p = 7 * lvl10(ctx.level) * s.bomb * s.buzzBomb * s.bombPower;
      return flowersPollen(ctx, 29 * count * ctx.cal.fuzzBombsCaught, { white: p, red: p, blue: p });
    },
  },

  // ---- другие способности, собирающие пыльцу ----
  Scratch: {
    kind: 'pollen', source: 'ability',
    perToken: (ctx) => {
      const tabby = 1 + ctx.stats.tabbyStacks / 100;
      const p = (7 + ctx.level) * tabby * (ctx.gifted ? ctx.hive.critPowerAlways : 1); // у Gifted всегда крит
      return flowersPollen(ctx, 12, { white: p, red: p, blue: p });
    },
  },
  Beamstorm: {
    kind: 'pollen', source: 'ability',
    perToken: (ctx) => {
      // ГРУБО: 25 (+2/ур.) лучей; луч бьёт cal.beamFlowers цветков с силой как у бомбы (10, +10%/ур.) и удваивает её
      const beams = 25 + 2 * ctx.level;
      const per = 2 * 10 * lvl10(ctx.level);
      return flowersPollen(ctx, beams * ctx.cal.beamFlowers, { white: per * (ctx.gifted ? 1.5 : 1), red: per, blue: per });
    },
    instant: (ctx) => (ctx.gifted ? 1 : 0),
    note: 'ГРУБО: сколько цветков задевает луч — не опубликовано',
  },
  Triangulate: {
    kind: 'pollen', source: 'ability',
    perToken: (ctx) => {
      const p = (10 + 2 * ctx.level) * (1 + 0.5 * Math.min(1, ctx.hive.marksOnField));
      return flowersPollen(ctx, ctx.cal.triangleFlowers, { white: p, red: p, blue: p });
    },
    // в треугольнике Precise Mark — всегда крит (описание в игре); ГРУБО: игрок стоит в ней markStand времени
    alwaysCrit: (ctx) => ctx.hive.preciseMarkOn * ctx.cal.markStand,
    note: 'ГРУБО: площадь треугольника взята средней',
  },
  'Mark Surge': {
    kind: 'pollen', source: 'ability',
    perToken: (ctx) => {
      const p = 7 * lvl10(ctx.level);
      // каждая активная метка (радиус 14 стадов ≈ 38 цветков) собирает ещё раз; больше поля всё равно не собрать
      return flowersPollen(ctx, Math.min(ctx.field.flowers, 38 * ctx.hive.marksOnField), { white: p, red: p, blue: p });
    },
    // всплеск в Precise Mark — всегда крит: доля Precise Mark среди меток на поле
    alwaysCrit: (ctx) => ctx.hive.preciseMarkShareOfMarks,
  },
  'Target Practice': {
    kind: 'pollen', source: 'ability',
    perToken: (ctx) => {
      // 3 мишени, каждая — 29 цветков по 2×атака пчелы (+10%/ур.); ГРУБО: игрок успевает на cal.targetsHit мишеней.
      // Код игры (BeeAbilityDefs): с Flame Heat выстрелы дают до x4 пыльцы и до 50% мгновенной конвертации
      const p = 2 * beeAttack(ctx) * lvl10(ctx.level) * (1 + 3 * heatShare(ctx));
      return flowersPollen(ctx, 29 * 3 * ctx.cal.targetsHit, { white: p, red: p, blue: p });
    },
    instant: (ctx) => 0.5 * heatShare(ctx),
    // все 3 мишени активированы → стак Precision: +2% шанса суперкрита на 60 с, до 10 стаков (BuffDefs.Precision)
    // у Gifted часть токенов игрок тратит на Precise Mark (активирует только дальнюю мишень) — они не дают Precision
    buff: { key: 'precision', stack: 'combo', dur: 60, max: 10, value: 0.02, stat: 'superCritChance', share: (cal, gifted) => cal.targetsHit ** 3 * (gifted ? 1 - cal.preciseMarkShare : 1) },
    // Precise Mark (BuffDefs): +7% крита и суперкрита, до 3 стаков, пока стоишь в метке; ГРУБО: живёт как Pollen Mark+
    mark: { key: 'preciseMark', dur: (ctx) => 8 + 0.25 * ctx.level, max: 3, value: 0.07, giftedOnly: true, share: (cal) => cal.preciseMarkShare },
    // каждая активированная мишень даёт токен Focus, неактивированная — Red Boost (BeeAbilityDefs). В среднем активировано
    // 3·targetsHit мишеней, а когда игрок ставит Precise Mark (Gifted) — одна, дальняя
    spawns: (cal, gifted) => {
      const m = gifted ? cal.preciseMarkShare : 0;
      const hit = (1 - m) * 3 * cal.targetsHit + m * 1;
      return { Focus: hit, 'Red Boost': 3 - hit };
    },
    note: 'ГРУБО: все 3 мишени — с вероятностью targetsHit³; на мишени в момент выстрела игрок стоит в доле targetStand (конвертация рюкзака); Precise Mark (Gifted, только дальняя мишень) и бусты поля (до x3) не учитываются',
  },
  'Blue Pulse': {
    kind: 'pollen', source: 'ability',
    perToken: (ctx) => pulsePollen(ctx, 'blue'),
    fieldConvert: (ctx) => pulseConvert(ctx, 'blue'),
    note: 'ГРУБО: сила прыжка импульса не опубликована',
  },
  'Red Pulse': {
    kind: 'pollen', source: 'ability',
    perToken: (ctx) => pulsePollen(ctx, 'red'),
    fieldConvert: (ctx) => pulseConvert(ctx, 'red'),
    note: 'ГРУБО: сила прыжка импульса не опубликована',
  },

  // ---- мёд ----
  'Honey Gift': { kind: 'honey', perToken: (ctx) => 100 * ctx.level ** 2 },
  'Honey Gift+': { kind: 'honey', perToken: (ctx) => 250 * ctx.level ** 2 },
  'Token Link': { kind: 'honey', perToken: (ctx) => (25 + 10 * ctx.level) * ctx.hive.tokensPerLink, note: 'считается только мёд за собранные токены' },

  // ---- не учитываются (пока) ----
  // +10% скорости игрока за стак (20 с, до 10): игрок проходит больше цветков — больше сбора ботинками (Movement Collection)
  Haste: { kind: 'buff', key: 'haste', stack: 'combo', dur: 20, max: 10, value: 0.1, stat: 'playerSpeed' },
  // Rage (BuffDefs): +1 атаки всем пчёлам за стак, до 4, 45 с — усиливает выстрелы Target Practice
  Rage: { kind: 'buff', key: 'rage', stack: 'combo', dur: 45, max: 4, value: 1, stat: 'beeAttack' },
  // только в бою — на мёд с поля не влияют
  Impale: { kind: 'none', irrelevant: true, note: 'урон мобам и мёд с них' },
  'Mind Hack': { kind: 'none', irrelevant: true, note: 'против мобов' },
  Glitch: { kind: 'none', note: 'дубли токенов — пока нет' },
  'Map Corruption': { kind: 'none', note: 'дубли токенов — пока нет' },
  Tornado: { kind: 'none', note: 'зависит от стаков Haste — пока нет' },
  'Rain Cloud': { kind: 'none', irrelevant: true, note: 'облако появляется на другом поле' },
  Fetch: {
    kind: 'pollen', source: 'ability',
    perToken: (ctx) => {
      // ГРУБО: мяч живёт ~8 с, игрок и Puppy Bee пинают его cal.fetchKicks раз; каждый пинок собирает как бомба
      // (13 цветков, сила 10) и усиливается на 100% (+15%/ур.) — в среднем за серию пинков половина прироста
      const boost = 1 + (1 + 0.15 * ctx.level) / 2;
      const p = 10 * boost;
      return flowersPollen(ctx, 13 * ctx.cal.fetchKicks, { white: p, red: p, blue: p });
    },
    note: 'ГРУБО: сколько собирает мяч Fetch, на вики нет',
  },
  // Inferno: 6 пламён + 2 временные Fire Bee (считается в model.js: ringFlames, fireBeesOf)
  Inferno: { kind: 'inferno', note: 'ГРУБО: временные Fire Bee живут 15 с (+1 с за ур.) — их Red Bomb+ считаются как у постоянной пчелы' },
  // Flame Fuel: 15 с пламя горит на 50% дольше и при появлении конвертирует 50 тыс. + 10% Convert Total (model.js: fuelOf, chunks)
  'Flame Fuel': { kind: 'buff', key: 'flameFuel', stack: 'refresh', dur: 15, value: 1, stat: 'flameFuel' },
  // Лягушка живёт 20 с (+2 с за уровень; код игры Summon_Frog: 20 + 2·(ур.−1)) и прыгает по полю; пузыри — на 2-м, 3-м и 4-м
  // прыжке из каждых четырёх (вики Frog). ГРУБО: прыжок раз в cal.frogHop с. Языком она собирает токены (уже в tokenPickup)
  'Summon Frog': {
    kind: 'frog',
    bubbles: (ctx) => ((20 + 2 * (ctx.level - 1)) / ctx.cal.frogHop) * 0.75,
    note: 'ГРУБО: как часто прыгает лягушка (cal.frogHop); золотые пузыри Gifted-лягушки не учитываются',
  },
  // Шарики Buoyant Bee (BeeAbilityDefs + вики Balloon): шарик живёт 20 с (+2 с за ур.), вместимость — 1/6 рюкзака;
  // пыльца с цветков под ним (+10%, синяя +20%) идёт в шарик, а не в рюкзак; Gifted — шанс золотого (x2 вместимость, x1.25 пыльцы).
  // Сами шарики, Balloon Aura и Balloon Blessing считает model.js (balloonModel)
  'Inflate Balloons': {
    kind: 'balloon',
    life: (ctx) => 20 + 2 * (ctx.level - 1),
    gold: (ctx) => (ctx.gifted ? Math.min(1, (0.05 + 0.005 * ctx.level) * (ctx.boostStacks > 0 ? 2 : 1)) : 0),
    count: () => 1,
  },
  // Surprise Party (Gifted): золотые шарики (+1 каждые 5 ур.); если была за последние 8 мин — работает как Inflate с золотым
  'Surprise Party': {
    kind: 'balloon',
    life: (ctx) => 20 + 2 * (ctx.level - 1),
    gold: () => 1,
    count: (ctx) => 1 + Math.floor(ctx.level / 5),
    note: 'токены из шариков во время вечеринки не считаются',
  },
  // Pollen Haze: 30 с опыляет до 30 случайных цветков поля в секунду (опыление считает model.js, «4-»)
  'Pollen Haze': { kind: 'pollinate', note: 'быстрый рост цветков и автосбор бомб в дымке не считаются' },
  'Festive Gift': { kind: 'none', note: 'случайные подарки' },
  'Festive Mark': { kind: 'none', note: 'пока нет' },
  // Слизь: код игры (BeeAbilityDefs) — Glob покрывает 49 цветков (Gifted 81) одной лужей
  Glob: { kind: 'goo', puddle: (ctx) => { const n = ctx.gifted ? 81 : 49; return { flowers: n, size: n }; } },
  // Gumdrop Barrage (FlowerGoo.GummyStorm в коде сервера, его нет): ГРУБО — россыпь луж по cal.barrageFlowers цветков
  'Gumdrop Barrage': {
    kind: 'goo',
    puddle: (ctx) => ({ flowers: ctx.cal.barrageFlowers, size: ctx.cal.barragePuddle }),
    note: 'ГРУБО: сколько цветков покрывает залп (cal.barrageFlowers) и размер луж (cal.barragePuddle) — код на сервере игры',
  },
  'Snowglobe Shake': { kind: 'none', note: 'событие Beesmas' },
};

/**
 * Атака пчелы, как BeeStats.GetAttack: (база + Bee Attack всем + своего цвета + Rage) · 1.5 у Gifted ·
 * Bee Attack Multiplier (снаряжение, Gifted Rage Bee, Flame Heat: +2…25% от разогрева).
 */
export function beeAttack(ctx) {
  const s = ctx.stats;
  const color = { red: s.redBeeAttack, blue: s.blueBeeAttack, white: s.whiteBeeAttack }[ctx.bee.color] ?? 0;
  const drives = ctx.bee.name === 'Digital Bee' ? 0.03 * Math.max(0, Math.min(500, Number(s.digitalDrives?.red ?? 500) || 0)) : 0; // Red Drive: +0.03
  const base = (ctx.bee.attack || 0) + drives + (s.beeAttack || 0) + (color || 0) + (ctx.hive.buffs?.rage ?? 0);
  const heat = heatShare(ctx);
  const mul = (s.beeAttackMul ?? 1) + (heat > 0 ? 0.02 + 0.23 * heat : 0);
  return Math.max(0, base) * (ctx.gifted ? 1.5 : 1) * mul;
}

/** Насколько разогрет Flame Heat: 0 — нет, 1 — максимум (в модели Flame Heat даёт x1…x2 красной пыльцы). */
function heatShare(ctx) {
  return Math.max(0, Math.min(1, (ctx.hive.flameHeat ?? 1) - 1));
}

export function pulsePollen(ctx, color) {
  // Импульс прыгает по активным пчёлам своего цвета; каждый прыжок — 9 цветков, сила растёт с прыжком.
  const hops = ctx.hive.activeByColor[color] || 0;
  if (!hops) return { white: 0, red: 0, blue: 0 };
  let total = 0;
  for (let i = 0; i < hops; i++) total += ctx.cal.pulseBase * (1 + ctx.cal.pulseHopGrowth * i);
  const p = total * lvl10(ctx.level);
  return flowersPollen(ctx, 9, { white: p, red: p, blue: p });
}

/** Gifted-импульс: каждая пчела на пути мгновенно конвертирует 25% своего Convert Amount (вики Cobalt/Crimson Bee). */
function pulseConvert(ctx, color) {
  if (!ctx.gifted) return 0;
  return (ctx.hive.activeByColor[color] || 0) * 0.25 * (ctx.hive.convertAmountByColor[color] || 0);
}

/**
 * Пассивки, которые срабатывают при сборе (шанс на каждый цветок). Цифры — со страниц вики Bubble и Flame.
 *   bubble: лопнутый пузырь собирает 4 красной, 6 белой, 8 синей с 29 цветков
 *           (+15% за каждый вид Gifted синей пчелы в улье, +5% за уровень пчелы)
 *   flame:  пламя живёт 4 с и каждую секунду собирает 5 красной, 3 белой, 2 синей с 9 цветков
 *           (+2% за каждую красную пчелу, +4% за Gifted красную, +10% за уровень пчелы)
 * Shimmering Honey (Diamond Bee) считается прямо в model.js (beeStats).
 */
export const GATHER_PASSIVES = {
  // запасной вариант, если в данных нет шансов из игры; в игре у Bubble/Tadpole бонус Gifted не работает (опечатка в коде)
  'Bubble Bee': { kind: 'bubble', chance: [0.35, 0.35] },
  'Tadpole Bee': { kind: 'bubble', chance: [0.65, 0.65] },
  'Fire Bee': { kind: 'flame', chance: [0.35, 0.5] },
  'Demon Bee': { kind: 'flame', chance: [0.65, 0.85] },
};

/** Пыльца с одного пузыря / пламени до общих множителей. */
export function passivePollen(kind, ctx) {
  const h = ctx.hive;
  if (kind === 'bubble') {
    const mul = (1 + 0.15 * h.giftedBlueTypes + 0.05 * ctx.level) * ctx.stats.bubblePollen * ctx.cal.bubblesPopped;
    return flowersPollen(ctx, 29, { white: 6 * mul, red: 4 * mul, blue: 8 * mul });
  }
  const mul = (1 + 0.02 * h.redBees + 0.04 * h.giftedRedBees + 0.1 * (ctx.level - 1)) * ctx.stats.flamePollen * 4 * ctx.stats.flameDuration;
  return flowersPollen(ctx, 9, { white: 3 * mul, red: 5 * mul, blue: 2 * mul });
}
