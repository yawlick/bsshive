// Подбор лучшего улья: жадно заполняем слоты, потом улучшаем заменами «одну пчелу на другую».
import { evaluate, normalizeHive, prepare, resolveFieldName } from './model.js';
import { questsPlan } from './quests.js';

export const RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythic', 'event'];

/** Шансы Royal Jelly по редкостям (вики, Royal Jelly); внутри редкости все виды равновероятны. */
export const JELLY_ODDS = { rare: 0.69996, epic: 0.27, legendary: 0.03, mythic: 0.00004 };
/** Сколько Royal Jelly в среднем нужно, чтобы выбить эту пчелу (null — из Royal Jelly не выпадает). Gifted — ещё ×250. */
export function jellyCost(data, name, gifted = false) {
  const bee = data.beeByName.get(name);
  const p = JELLY_ODDS[bee?.rarity];
  if (!p) return null;
  const types = data.bees.filter((b) => b.rarity === bee.rarity).length;
  return (types / p) * (gifted ? 250 : 1);
}

/** Ивентовая пчела в игре бывает только одна каждого вида — больше одной в улей не ставим, какие бы ни были лимиты. */
export const EVENT_MAX = 1;
const capMax = (bee, max) => (bee.rarity === 'event' ? Math.min(max, EVENT_MAX) : max);

/**
 * @param opts {
 *   slots: 25,                  // сколько всего пчёл в улье
 *   level: 10, gifted: true,    // уровень и Gifted по умолчанию для подбираемых пчёл
 *   goal: 'honey' | 'pollen' | 'red' | 'blue' | 'white' | { quest } | { quests: [...] },
 *   field: 'Pine Tree Forest',
 *   fixed: 'Gifted Tabby Bee L12, ...' | [...],   // пчёлы, которые уже есть и остаются
 *   limits: { 'Frosty Bee': { allow: true, max: 8, maxGifted: 1, level: 8 }, ... },
 *                               // по каждой пчеле: можно ли, максимум штук, максимум Gifted, уровень
 *                               // (если limits заданы — пчёлы без записи не берутся)
 *   rarities, exclude, only, maxPerBee: { event: 1 }, maxMythic — старые ограничения, если limits нет
 *   timeLimitMs, player, calibration,
 * }
 */
export function optimize(data, opts = {}) {
  prepare(data);
  const t0 = Date.now();
  const slots = Math.max(1, Math.min(50, opts.slots ?? 25));
  const level = opts.level ?? 10;
  const gifted = opts.gifted ?? true;
  const goal = opts.goal ?? 'honey';
  const quests = typeof goal === 'object' ? (goal.quests || (goal.quest ? [goal.quest] : null)) : null;
  const field = resolveFieldName(data, opts.field || (goal === 'red' ? 'Rose Field' : goal === 'blue' ? 'Pine Tree Forest' : 'Sunflower Field'));
  const fixed = opts.fixed ? normalizeHive(data, opts.fixed) : [];
  const fixedCount = fixed.reduce((a, g) => a + g.count, 0);
  const free = Math.max(0, slots - fixedCount);

  // ограничения по каждой пчеле
  const limits = opts.limits || null;
  const rarities = new Set(opts.rarities ?? RARITIES);
  const exclude = new Set((opts.exclude ?? []).map((n) => n.toLowerCase()));
  const only = opts.only?.length ? new Set(opts.only.map((n) => n.toLowerCase())) : null;
  const maxPer = { common: Infinity, rare: Infinity, epic: Infinity, legendary: Infinity, mythic: Infinity, event: 1, ...opts.maxPerBee };
  const maxMythic = limits ? Infinity : (opts.maxMythic ?? Infinity);
  const lim = (bee) => {
    if (limits) {
      const l = limits[bee.name];
      if (!l || l.allow === false) return null;
      return { max: capMax(bee, l.max ?? Infinity), maxGifted: l.maxGifted ?? (gifted ? Infinity : 0), level: l.level ?? level };
    }
    const n = bee.name.toLowerCase();
    const short = n.replace(/ bee$/, '');
    if (!rarities.has(bee.rarity) || exclude.has(n) || exclude.has(short) || (only && !only.has(n) && !only.has(short))) return null;
    return { max: capMax(bee, maxPer[bee.rarity]), maxGifted: gifted ? Infinity : 0, level };
  };
  const candidates = data.bees.map((b) => ({ bee: b, l: lim(b) })).filter((x) => x.l && x.l.max > 0);
  const limByName = new Map(candidates.map((x) => [x.bee.name, x.l]));

  const fixedByName = new Map();
  const fixedGifted = new Map();
  for (const g of fixed) {
    fixedByName.set(g.name, (fixedByName.get(g.name) ?? 0) + g.count);
    if (g.gifted) fixedGifted.set(g.name, (fixedGifted.get(g.name) ?? 0) + g.count);
  }
  const fixedMythic = fixed.filter((g) => data.beeByName.get(g.name).rarity === 'mythic').reduce((a, g) => a + g.count, 0);

  const counts = new Map(); // имя -> сколько добавили
  // Gifted всегда не хуже обычной, поэтому из n пчёл вида Gifted — столько, сколько разрешено
  const groupsOf = (name, n) => {
    const l = limByName.get(name);
    const g = Math.max(0, Math.min(n, (l.maxGifted ?? 0) - (fixedGifted.get(name) ?? 0)));
    const out = [];
    if (g > 0) out.push({ name, count: g, level: l.level, gifted: true });
    if (n - g > 0) out.push({ name, count: n - g, level: l.level, gifted: false });
    return out;
  };
  const toHive = (c) => [...fixed, ...[...c].filter(([, n]) => n > 0).flatMap(([name, n]) => groupsOf(name, n))];
  const canAdd = (c, bee) => {
    const have = (c.get(bee.name) ?? 0) + (fixedByName.get(bee.name) ?? 0);
    if (have + 1 > limByName.get(bee.name).max) return false;
    if (bee.rarity === 'mythic' && Number.isFinite(maxMythic)) {
      let m = fixedMythic;
      for (const [n, k] of c) if (data.beeByName.get(n).rarity === 'mythic') m += k;
      if (m + 1 > maxMythic) return false;
    }
    return true;
  };

  let evals = 0;
  const score = (c) => {
    evals++;
    const hive = toHive(c);
    if (!hive.length) return -Infinity;
    if (quests) {
      const plan = questsPlan(data, hive, quests, { ...opts, field });
      return Number.isFinite(plan.seconds) ? -plan.seconds : -1e15;
    }
    const r = evaluate(data, hive, { field, player: opts.player, calibration: opts.calibration });
    if (goal === 'honey') return r.honeyPerHour;
    if (goal === 'pollen') return r.pollenPerHourEffective.total;
    return r.pollenPerHourEffective[goal];
  };

  const deadline = t0 + (opts.timeLimitMs ?? (quests ? 25000 : 30000));
  let lastTick = 0;
  // лучший найденный вариант за весь подбор: второй заход (от своего улья) начинается ниже первого,
  // поэтому в прогресс отдаём максимум по обоим, а не текущий счёт захода
  let bestSeen = -Infinity;
  const progress = (phase, done, total, cur) => {
    if (cur !== null && cur > bestSeen) bestSeen = cur;
    const now = Date.now();
    if (!opts.onProgress || now - lastTick < 150) return;
    lastTick = now;
    opts.onProgress({ phase, done, total, best: Number.isFinite(bestSeen) ? bestSeen : null, evals, ms: now - t0, deadlineMs: deadline - t0 });
  };

  // 1) жадно: каждый следующий слот — та пчела, что даёт больше всего прироста
  for (let i = 0; i < free; i++) {
    progress('greedy', i, free, null);
    let best = null;
    for (const { bee } of candidates) {
      if (!canAdd(counts, bee)) continue;
      counts.set(bee.name, (counts.get(bee.name) ?? 0) + 1);
      const s = score(counts);
      counts.set(bee.name, counts.get(bee.name) - 1);
      if (!best || s > best.s) best = { name: bee.name, s };
    }
    if (!best) break;
    counts.set(best.name, (counts.get(best.name) ?? 0) + 1);
  }

  // 2) улучшение заменами: убрать одну пчелу вида A, поставить вид B — пока становится лучше
  let timedOut = false;
  const better = (s, cur) => s > cur * (cur < 0 ? 1 - 1e-6 : 1 + 1e-6) + 1e-9;
  const improve = (c, until) => {
    let cur = score(c);
    for (let iter = 0; iter < 200; iter++) {
      if (Date.now() > until) { timedOut = true; break; }
      progress('swap', iter, 0, cur);
      let best = null;
      for (const [a, na] of c) {
        if (na <= 0) continue;
        c.set(a, na - 1);
        for (const { bee } of candidates) {
          if (bee.name === a || !canAdd(c, bee)) continue;
          c.set(bee.name, (c.get(bee.name) ?? 0) + 1);
          const s = score(c);
          c.set(bee.name, c.get(bee.name) - 1);
          if (better(s, cur) && (!best || s > best.s)) best = { a, b: bee.name, s };
        }
        c.set(a, na);
      }
      if (!best) break;
      c.set(best.a, c.get(best.a) - 1);
      c.set(best.b, (c.get(best.b) ?? 0) + 1);
      cur = best.s;
    }
    progress('swap', 0, 0, cur);
    return cur;
  };
  // запасной старт — свой улей (seed), урезанный под ограничения и слоты: результат не хуже своего улья
  let seedCounts = null;
  if (opts.seed && !fixed.length) {
    seedCounts = new Map();
    let n = 0;
    for (const g of normalizeHive(data, opts.seed)) {
      const bee = data.beeByName.get(g.name);
      if (!limByName.has(g.name)) continue;
      for (let k = 0; k < g.count && n < free; k++) { if (!canAdd(seedCounts, bee)) break; seedCounts.set(g.name, (seedCounts.get(g.name) ?? 0) + 1); n++; }
    }
    if (!n) seedCounts = null;
  }
  let current = improve(counts, seedCounts ? t0 + (deadline - t0) * 0.6 : deadline);
  if (seedCounts) {
    const fromSeed = improve(seedCounts, deadline);
    if (fromSeed > current) { counts.clear(); for (const [k, v] of seedCounts) counts.set(k, v); current = fromSeed; }
  }

  const hive = toHive(counts);
  const result = evaluate(data, hive, { field, player: opts.player, calibration: opts.calibration });
  let plan = null;
  if (quests) plan = questsPlan(data, hive, quests, { ...opts, field });
  const added = [...counts].filter(([, n]) => n > 0).flatMap(([name, n]) => groupsOf(name, n).map((g) => ({ ...g, rarity: data.beeByName.get(name).rarity })))
    .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
  return { field, goal, slots, fixed, added, hive, result, plan, score: current, evals, ms: Date.now() - t0, timedOut };
}

/** Тот же улей на всех полях — где ему лучше всего. */
export function compareFields(data, hive, opts = {}) {
  prepare(data);
  const groups = normalizeHive(data, hive);
  const bees = groups.reduce((a, g) => a + g.count, 0);
  return data.fields
    .filter((f) => f.beesRequired <= bees && !/Brick Field|Hub Field|Ant Field/.test(f.name))
    .map((f) => {
      const r = evaluate(data, groups, { ...opts, field: f.name });
      return { field: f.name, honeyPerHour: r.honeyPerHour, pollenPerHour: r.pollenPerHourEffective, mix: f.mix, beesRequired: f.beesRequired };
    })
    .sort((a, b) => b.honeyPerHour - a.honeyPerHour);
}

/** Текст улья для показа: "5× Gifted Rad Bee L10, ..." */
export function hiveToText(groups) {
  return groups.map((g) => `${g.count > 1 ? `${g.count}× ` : ''}${g.gifted ? 'Gifted ' : ''}${g.name} L${g.level}`).join(', ');
}

/**
 * «Следующий шаг»: какие одиночные замены в улье дают больше всего (заменить одну пчелу на другую, или добавить,
 * если есть свободный слот). Для тех, кто меняет пчёл по одной (Royal Jelly).
 * @param opts как у optimize (goal, limits, slots, level, player…); top — сколько вариантов вернуть
 * @returns { base, steps: [{ remove, add, score, gain }] } — gain: для квестов секунды выигрыша, иначе прирост цели
 */
export function nextSteps(data, hive, opts = {}) {
  prepare(data);
  const goal = opts.goal ?? 'honey';
  const quests = typeof goal === 'object' ? (goal.quests || (goal.quest ? [goal.quest] : null)) : null;
  const field = resolveFieldName(data, opts.field || 'Sunflower Field');
  const groups = normalizeHive(data, hive);
  const score = (h) => {
    if (quests) { const p = questsPlan(data, h, quests, { ...opts, field }); return Number.isFinite(p.seconds) ? -p.seconds : -1e15; }
    const r = evaluate(data, h, { field, player: opts.player, calibration: opts.calibration });
    return goal === 'honey' ? r.honeyPerHour : goal === 'pollen' ? r.pollenPerHourEffective.total : r.pollenPerHourEffective[goal];
  };
  const base = score(groups);
  const limits = opts.limits || {};
  const owned = new Map();
  const ownedGifted = new Map();
  for (const g of groups) { owned.set(g.name, (owned.get(g.name) ?? 0) + g.count); if (g.gifted) ownedGifted.set(g.name, (ownedGifted.get(g.name) ?? 0) + g.count); }
  const adds = data.bees.filter((b) => limits[b.name]?.allow !== false && (!opts.limits || limits[b.name]))
    .filter((b) => (owned.get(b.name) ?? 0) < capMax(b, limits[b.name]?.max ?? 50))
    .map((b) => {
      const l = limits[b.name] || {};
      return { name: b.name, count: 1, level: l.level ?? opts.level ?? 10, gifted: (ownedGifted.get(b.name) ?? 0) < (l.maxGifted ?? 0) };
    });
  const total = groups.reduce((a, g) => a + g.count, 0);
  const steps = [];
  // закреплённых (lock) не убираем
  const removable = groups.map((g, i) => i).filter((i) => !limits[groups[i].name]?.lock);
  const removes = total < (opts.slots ?? total) ? [null, ...removable] : removable;
  for (const ri of removes) {
    const without = groups.map((g) => ({ ...g }));
    if (ri !== null) without[ri].count -= 1;
    for (const a0 of adds) {
      if (ri !== null && without[ri].name === a0.name && without[ri].gifted === a0.gifted) continue;
      // Royal Jelly оставляет пчеле уровень (и бонд), а Gifted и мутация пропадают (слова NPC в игре + вики)
      const add = ri === null ? a0 : { ...a0, level: groups[ri].level };
      const h = [...without.filter((g) => g.count > 0), add];
      const sc = score(h);
      if (sc > base + Math.abs(base) * 1e-6) {
        const cost = jellyCost(data, add.name, add.gifted);
        steps.push({ remove: ri === null ? null : { name: groups[ri].name, gifted: groups[ri].gifted, level: groups[ri].level }, add, score: sc, gain: sc - base, jelly: cost, perJelly: cost ? (sc - base) / cost : 0 });
      }
    }
  }
  // сортировка: по выигрышу или по выигрышу на одну Royal Jelly (пчёлы не из Royal Jelly — в конец)
  if (opts.sortBy === 'perJelly') steps.sort((a, b) => b.perJelly - a.perJelly || b.gain - a.gain);
  else steps.sort((a, b) => b.gain - a.gain);
  // по одной лучшей замене на каждую добавляемую пчелу — разнообразнее советы
  const seen = new Set();
  const top = [];
  for (const st of steps) { const k = `${st.add.name}|${st.add.gifted}`; if (seen.has(k)) continue; seen.add(k); top.push(st); if (top.length >= (opts.top ?? 8)) break; }
  return { base, steps: top, quests: !!quests };
}

/**
 * План замен по порядку: k раз берём лучшую одиночную замену (по выигрышу или по выигрышу на Royal Jelly)
 * и применяем её. Итог — последовательность шагов и время/цель после каждого.
 */
export function swapPlan(data, hive, opts = {}, k = 5) {
  prepare(data);
  let cur = normalizeHive(data, hive).map((g) => ({ ...g }));
  const plan = [];
  let base = null;
  for (let i = 0; i < k; i++) {
    opts.onProgress?.({ phase: 'plan', done: i, total: k });
    const ns = nextSteps(data, cur, { ...opts, top: 1 });
    if (base === null) base = ns.base;
    const st = ns.steps[0];
    if (!st) break;
    if (st.remove) {
      const g = cur.find((x) => x.name === st.remove.name && x.gifted === st.remove.gifted && x.level === st.remove.level);
      g.count -= 1;
    }
    cur = normalizeHive(data, [...cur.filter((g) => g.count > 0), st.add]);
    plan.push({ ...st, after: st.score });
  }
  return { base, plan, hive: cur, quests: typeof opts.goal === 'object' };
}
