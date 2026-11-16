// Пассивки снаряжения и амулетов (вики: Passive Abilities). Почти все срабатывают «каждый N-й токен такого-то вида».
// Считается в два шага:
//   A (до общих множителей) — постоянные бонусы (вместимость), баффы, которые меняют множители (Pop Star, Scorching Star),
//     доп. частота Inspire; нужна только частота токенов.
//   B (после множителей) — пыльца от пассивок (импульсы, пузыри, пламя, падающие звёзды) и «пачки» конвертации на поле.
import { flowersPollen, passivePollen, pulsePollen } from './effects.js';

const COLORS = ['white', 'red', 'blue'];

/** Что делает пассивка — для подсказок на сайте; skip — почему не считается. */
export const PASSIVES = {
  'Haste Pulser': { info: 'каждый 30-й Haste — синий импульс по синим пчёлам' },
  'Focus Pulser': { info: 'каждый 30-й Focus — красный импульс по красным пчёлам' },
  'Bubble Bombs': { info: 'каждая 25-я бомба (раз в 2 мин) — 25 пузырей' },
  'Diamond Drain': { info: 'каждый 30-й синий токен (раз в 45 с) — конвертирует 5 млн + Convert Total' },
  Ignite: { info: 'каждый 15-й красный токен — 5 пламён' },
  'X-Flame': { info: 'каждый 25-й «боевой» токен (раз в 20 с) — 29 пламён' },
  'Coin Scatter': { info: 'каждая 20-я метка (раз в 2 мин) — 300% Convert Total в токены мёда' },
  'Inspire Coconuts': { info: 'каждый 5-й Inspire — 5 кокосов (пойманный конвертирует до 100% Convert Total)' },
  'Petal Storm': { info: 'каждый 30-й Boost (раз в 30 с) — 30 сюрикенов, пчела под сюрикеном конвертирует 10 000 + 7% её конвертации' },
  'Guiding Star': { info: 'постоянно x1.25 вместимости (сама звезда падает на поля, где ты мало собирал — не считается)' },
  'Star Shower': { info: 'постоянно x1.25 вместимости; каждый 40-й Boost/метка (раз в 30 с) — 10 падающих звёзд' },
  'Pop Star': { info: 'x1.25 Blue Field Capacity; каждый 30-й Boost (раз в минуту) — x2…x4.5 синей пыльцы на 45 с и Bubble Bloat до x6' },
  'Scorching Star': { info: 'x1.25 Red Field Capacity; каждый 30-й Boost (раз в минуту) — x2…x5 красной пыльцы и конвертации на 45 с, в конце конвертирует весь рюкзак' },
  'Gummy Star': { info: 'x1.25 White Field Capacity', partial: 'сама звезда появляется только от предмета Gumdrops (предметы модель не тратит)' },
  'Coconut Haste': { info: 'пойманный кокос — стак Haste (кокосы — от Inspire Coconuts)' },
  'Combo Coconuts': { info: 'каждый 40-й кокос — Combo Coconut: бафф Coconut Combo на 30 с (x1.2…x2 пыльцы, 25…75% мгновенной конвертации)' },
  'Goo Trail': { info: 'ходьба покрывает слизью 5 цветков вокруг' },
  'Gummy Morph': { info: 'каждый 10-й токен Gummy Bee — всё поле в слизи, 10 с +75% Goo, +100% Goo Conversion, Gummy Bee +1000% сбора' },
  'Emergency Coconut Shield': { irrelevant: 'только в бою' },
  'Star Saw': { info: 'каждый 3-й Stinger — пила на 30 с: 10 раз в секунду собирает и сразу конвертирует 3 (+0.5 за 100 Attack Total) с 5 цветков и столько же конвертирует из рюкзака' },
};
const canon = (name) => Object.keys(PASSIVES).find((k) => k.toLowerCase() === String(name).toLowerCase().trim()) ?? String(name).trim();

/**
 * Шаг A.
 * @param names  список пассивок игрока
 * @param R      частота собранных токенов по видам (в секунду): boost, mark, bomb, blueAbility, redAbility, battle, haste, focus, inspire; bubbles — лопнутых пузырей
 * @param o      { permanent: учитывать ли постоянные бонусы (в статах «из игры» они уже есть), flamesActive, cal }
 */
export function passivesA(names, R, o) {
  const A = {
    list: [], skipped: [], irrelevant: [],
    hasteRate: 0, combo: null, gooTrail: false, gummyMorph: false,
    capacityMul: 1, fieldCapMul: { white: 1, red: 1, blue: 1 }, hiveConvertMul: 1,
    colorMul: { red: 1, blue: 1 }, icAdd: { red: 0, blue: 0 }, flameIc: 0,
    inspireRate: 0, inspireBurst: null, events: [], scorching: null, buffs: {},
  };
  const every = (n, rate, cooldown = 0) => (rate > 0 ? 1 / Math.max(cooldown, n / rate) : 0); // активаций в секунду
  for (const raw of new Set((names || []).map(canon))) {
    const p = PASSIVES[raw];
    if (!p) { A.skipped.push(`${raw}: неизвестная пассивка`); continue; }
    if (p.skip) { A.skipped.push(`${raw}: ${p.skip}`); continue; }
    if (p.irrelevant) { A.irrelevant.push(`${raw}: ${p.irrelevant}`); continue; }
    A.list.push(raw);
    if (p.partial) A.skipped.push(`${raw}: ${p.partial}`);
    switch (raw) {
      case 'Haste Pulser': A.events.push({ kind: 'pulse', name: raw, color: 'blue', rate: R.haste / 30 }); break;
      case 'Focus Pulser': A.events.push({ kind: 'pulse', name: raw, color: 'red', rate: R.focus / 30 }); break;
      case 'Bubble Bombs': A.events.push({ kind: 'bubbles', name: raw, count: 25, rate: every(25, R.bomb, 120) }); break;
      case 'Diamond Drain': A.events.push({ kind: 'diamondDrain', name: raw, rate: every(30, R.blueAbility, 45) }); break;
      case 'Ignite': A.events.push({ kind: 'flames', name: raw, count: 5, power: { red: 4, white: 2, blue: 1 }, rate: R.redAbility / 15 }); break;
      case 'X-Flame': A.events.push({ kind: 'flames', name: raw, count: 29, power: { red: 5, white: 3, blue: 2 }, rate: every(25, R.battle, 20) }); break;
      case 'Coin Scatter': A.events.push({ kind: 'coinScatter', name: raw, rate: every(20, R.mark, 120) }); break;
      case 'Petal Storm': A.events.push({ kind: 'petalStorm', name: raw, rate: every(30, R.boost, 30) }); break;
      case 'Guiding Star': if (o.permanent) A.capacityMul *= 1.25; break;
      case 'Gummy Star': if (o.permanent) A.fieldCapMul.white *= 1.25; break;
      case 'Star Shower': {
        if (o.permanent) A.capacityMul *= 1.25;
        const rate = every(40, R.boost + R.mark, 30);
        A.inspireRate += rate * 10 * o.cal.starsCaught; // пойманная звезда — стак Inspire
        A.inspireBurst = { rate, stacks: 10 * o.cal.starsCaught }; // звёзды падают пачкой, а не по одной (см. model.js)
        A.events.push({ kind: 'starShower', name: raw, rate });
        break;
      }
      case 'Inspire Coconuts': A.events.push({ kind: 'coconuts', name: raw }); break; // частота — после Star Shower (её звёзды тоже считаются)
      case 'Star Saw': {
        // код игры (PlayerAbilities): каждый 3-й Stinger — пила на 30 с; Stinger используют раз в o.stingerEvery с
        const every = Number(o.stingerEvery) || 0;
        if (every > 0) A.events.push({ kind: 'starSaw', name: raw, uptime: Math.min(1, 30 / (3 * every)), rate: 10 * Math.min(1, 30 / (3 * every)) });
        else A.skipped.push(`${raw}: нужно использовать Stinger — включи бафф Stinger во вкладке «Баффы» (Stinger раз в 30 с)`);
        break;
      }
      case 'Goo Trail': A.gooTrail = true; break;
      case 'Gummy Morph': A.gummyMorph = true; break;
      case 'Pop Star': {
        if (o.permanent) A.fieldCapMul.blue *= 1.25;
        const T = R.boost > 0 ? Math.max(60, 30 / R.boost) : Infinity;
        const u = Math.min(1, 45 / T);
        // каждый лопнутый пузырь, пока звезда горит, +1% синей (до x4.5); в среднем за 45 с — половина набранного
        const m = 2 + Math.min(2.5, 0.01 * R.bubbles * 22.5);
        A.colorMul.blue *= 1 + u * (m - 1);
        A.icAdd.blue += 0.1 * u;
        // Bubble Bloat: +2 мин за звезду и +4 с за пузырь во время звезды, до 2.5 ч; сила до x6
        const gain = Number.isFinite(T) ? 120 + 4 * R.bubbles * 45 : 0;
        const bloat = !Number.isFinite(T) ? 0 : gain >= T ? 9000 : Math.min(9000, (gain * gain) / (2 * T));
        const bloatMul = 1 + 5 * (bloat / 9000); // ГРУБО: сила растёт с запасом времени линейно
        A.fieldCapMul.blue *= bloatMul;
        A.hiveConvertMul *= bloatMul;
        A.buffs.popStar = u;
        A.buffs.bubbleBloat = bloatMul;
        break;
      }
      case 'Scorching Star': {
        if (o.permanent) A.fieldCapMul.red *= 1.25;
        const T = R.boost > 0 ? Math.max(60, 30 / R.boost) : Infinity;
        const u = Math.min(1, 45 / T);
        const g = Math.min(1, (o.flamesActive || 0) / o.cal.flamesForMaxHeat); // ГРУБО: звезда растёт, пока рядом пламя
        const m = 2 + 3 * g;
        A.colorMul.red *= 1 + u * (m - 1);
        A.flameIc += 0.5 * u;
        A.scorching = { period: T, uptime: u, convertMul: m, links: 5 + 25 * g };
        A.buffs.scorchingStar = u;
        break;
      }
      default: break;
    }
  }
  const coco = A.events.find((e) => e.kind === 'coconuts');
  if (coco) coco.rate = (R.inspire + A.inspireRate) / 5;
  const drops = coco ? coco.rate * 5 : 0; // кокосов в секунду падает на поле
  const caught = drops * o.cal.coconutsCaught;
  // Coconut Haste (код игры PlayerAbilities): пойманный кокос — стак Haste
  if (A.list.includes('Coconut Haste')) A.hasteRate += caught;
  // Combo Coconuts: каждый 40-й кокос — комбо-кокос; поймал — бафф Coconut Combo (BuffDefs: 30 с, до 100 стаков, значения
  // линейно от 1 до 100 стаков); когда его не поймают — бафф накладывается ещё раз. ГРУБО: стаков cal.comboStacks
  if (A.list.includes('Combo Coconuts') && caught > 0) {
    const t = (Math.max(1, Math.min(100, o.cal.comboStacks)) - 1) / 99;
    const u = 1 - Math.exp(-(caught / 40) * 60); // 30 с + повторно ещё 30 с
    A.combo = { uptime: u, ic: 0.25 + 0.5 * t, pollenMul: 1.2 + 0.8 * t, colorAdd: 0.01 + 0.49 * t };
    A.buffs.coconutCombo = u;
  }
  return A;
}

/**
 * Шаг B: пыльца и конвертация от событий пассивок.
 * @param c { field, stats, cal, pollenX, boostMul, critFactor, hive (activeByColor…), level (средний уровень улья),
 *            redBees, giftedRedBees, blueBees, giftedBlueTypes, giftedTypes, convertTotal, avgConvertAmount, avgConvertRate }
 * @returns { sources: [{ name, amounts, ic }], chunks: [{ name, pollenPerSec, honeyMul }] }
 */
export function passivesB(A, c) {
  const sources = [];
  const chunks = [];
  const scale = (per, rate) => {
    const out = {};
    for (const col of COLORS) out[col] = per[col] * rate * c.pollenX * c.boostMul[col] * c.critFactor * c.cal.tokenScale;
    return out;
  };
  const ctx = { level: c.level, gifted: false, field: c.field, stats: c.stats, hive: c.hive, cal: c.cal };
  for (const e of A.events) {
    if (!(e.rate > 0)) continue;
    switch (e.kind) {
      case 'pulse': sources.push({ name: e.name, amounts: scale(pulsePollen(ctx, e.color), e.rate) }); break;
      case 'bubbles': sources.push({ name: e.name, amounts: scale(passivePollen('bubble', ctx), e.rate * e.count), bubble: true }); break;
      case 'flames': {
        const mul = (1 + 0.02 * c.redBees + 0.04 * c.giftedRedBees) * c.stats.flamePollen * 4 * c.stats.flameDuration;
        const per = flowersPollen(ctx, 9, { white: e.power.white * mul, red: e.power.red * mul, blue: e.power.blue * mul });
        sources.push({ name: e.name, amounts: scale(per, e.rate * e.count), ic: A.flameIc, flame: true });
        break;
      }
      case 'starShower': {
        // 10 звёзд, каждая собирает и сразу конвертирует 30 (+50% за вид Gifted) с 5 цветков; пойманная — ещё 1 млн + 200% Convert Total
        const p = 30 * (1 + 0.5 * c.giftedTypes);
        sources.push({ name: e.name, amounts: scale(flowersPollen(ctx, 50, { white: p, red: p, blue: p }), e.rate), ic: 1 });
        // +100% Convert Total за стак буста поля (описание пассивки в игре)
        chunks.push({ name: e.name, pollenPerSec: e.rate * 10 * c.cal.starsCaught * (1e6 + (2 + (c.boostStacks || 0)) * c.convertTotal), honeyMul: 1 });
        break;
      }
      case 'diamondDrain':
        chunks.push({ name: e.name, pollenPerSec: e.rate * (5e6 + c.convertTotal * (1 + 0.1 * c.blueBees + 0.5 * c.giftedBlueTypes)), honeyMul: 1 });
        break;
      case 'coinScatter': chunks.push({ name: e.name, pollenPerSec: e.rate * 3 * c.convertTotal, honeyMul: c.stats.honeyFromTokens }); break;
      case 'coconuts': chunks.push({ name: e.name, pollenPerSec: e.rate * 5 * c.cal.coconutsCaught * (1 + 0.25 * (c.boostStacks || 0)) * c.convertTotal, honeyMul: c.stats.honeyFromTokens }); break;
      case 'starSaw': {
        // e.rate — касаний в секунду (10/с, пока пила есть); каждое — 5 цветков по 3 (+0.5 за 100 Attack Total), сразу в мёд
        const p = 3 + 0.5 * (c.attackTotal || 0) / 100;
        const amounts = scale(flowersPollen(ctx, 5, { white: p, red: p, blue: p }), e.rate);
        sources.push({ name: e.name, amounts, ic: 1 });
        // «конвертирует из рюкзака столько же, сколько собирает»
        chunks.push({ name: e.name, pollenPerSec: amounts.white + amounts.red + amounts.blue, honeyMul: 1 });
        break;
      }
      case 'petalStorm': chunks.push({ name: e.name, pollenPerSec: e.rate * 30 * c.cal.petalHits * (10000 + 0.07 * c.avgConvertAmount), honeyMul: 1 }); break;
      default: break;
    }
  }
  // Scorching Star: 5…30 «ссылок конвертации» конвертируют через случайных пчёл, x2…x5 Convert Rate
  if (A.scorching) {
    const s = A.scorching;
    chunks.push({ name: 'Scorching Star', pollenPerSec: s.uptime * s.links * c.avgConvertRate * s.convertMul, honeyMul: 1 });
  }
  return { sources, chunks };
}
