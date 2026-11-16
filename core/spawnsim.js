// Симуляция того, как одна пчела делает токены способностей — по правилам из данных игры
// (страница вики Ability Tokens + таблица датамайна токенов):
//  • пчела пытается сделать токены, когда останавливается у цветка (раз в цикл сбора);
//  • для каждого токена: если прошёл use cooldown и try cooldown — попытка с шансом success, удачный попадает в пул;
//  • из пула выпадает один случайный токен за остановку, остальные ждут следующей;
//  • Bee Ability Rate делит оба кулдауна и умножает шанс;
//  • сон: энергия тратится по 1 за цветок, на 0 пчела улетает в улей; у токенов с StartWithFullCooldown
//    (в таблице помечены *) кулдаун после сна начинается заново, у остальных он идёт и во время сна.
// Результат детерминирован (свой генератор случайных чисел с фиксированным зерном) и кэшируется.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const cache = new Map();

/**
 * @param p {
 *   cycle,          // секунд на один цветок в среднем (перелёт + сбор)
 *   gatherTime,     // из них сам сбор (фиксирован); перелёт случайный: от 0 до 2× среднего
 *   energy,         // цветков до сна (null — не спит)
 *   downtime,       // секунд на дорогу в улей, отдых и обратно
 *   abilityRate,    // Bee Ability Rate (1 = 100%)
 *   tokens: [{ name, useCooldown, tryCooldown, success, startWithFullCooldown }],
 * }
 * @returns { [tokenName]: токенов в секунду (по настоящему времени, со сном) }
 */
export function tokenRatesForBee(p) {
  if (!p.tokens.length) return {};
  const gatherTime = Math.min(p.gatherTime ?? p.cycle, p.cycle);
  const flight = p.cycle - gatherTime;
  const key = `${p.tokens.map((t) => t.name).join('+')}|${p.cycle.toFixed(3)}|${gatherTime}|${p.energy ?? '-'}|${(p.downtime ?? 0).toFixed(2)}|${p.abilityRate}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const r = p.abilityRate || 1;
  const tk = p.tokens.map((t) => ({
    name: t.name,
    use: t.useCooldown / r,
    tryCd: t.tryCooldown / r,
    s: Math.min(1, t.success * r),
    reset: !!t.startWithFullCooldown,
  }));
  // редкие токены (Inspire — раз в ~10 минут) требуют длинного прогона, чтобы шум был маленьким
  const slowest = Math.max(...tk.map((t) => t.use + Math.max(t.tryCd, p.cycle) / t.s));
  const warmup = Math.max(2000, 3 * slowest);
  const horizon = warmup + Math.min(600000, Math.max(60000, 400 * slowest));
  const rng = mulberry32(hash(key));

  const n = tk.length;
  const ready = tk.map((t) => (t.reset ? t.use : 0));
  const nextTry = new Array(n).fill(0);
  const inPool = new Array(n).fill(false);
  const counts = new Array(n).fill(0);
  let t = rng() * p.cycle;
  let energy = p.energy ?? Infinity;
  while (t < horizon) {
    // пчёлы летят к случайным цветкам рядом с игроком, поэтому время между остановками плавает
    t += gatherTime + flight * 2 * rng();
    // остановка у цветка: попытки
    for (let i = 0; i < n; i++) {
      // 1e-9: время копится сложением дробей, без допуска «ровно через 10 с» иногда считалось бы «чуть раньше»
      if (inPool[i] || t + 1e-9 < ready[i] || t + 1e-9 < nextTry[i]) continue;
      nextTry[i] = t + tk[i].tryCd;
      if (rng() < tk[i].s) inPool[i] = true;
    }
    // один токен из пула
    let poolSize = 0;
    for (let i = 0; i < n; i++) if (inPool[i]) poolSize++;
    if (poolSize) {
      let pick = Math.floor(rng() * poolSize);
      for (let i = 0; i < n; i++) {
        if (!inPool[i]) continue;
        if (pick-- === 0) {
          inPool[i] = false;
          ready[i] = t + tk[i].use;
          if (t >= warmup) counts[i]++;
          break;
        }
      }
    }
    // сон
    energy -= 1;
    if (energy <= 0) {
      t += p.downtime;
      energy = p.energy;
      for (let i = 0; i < n; i++) if (tk[i].reset) ready[i] = t + tk[i].use;
    }
  }
  const out = {};
  for (let i = 0; i < n; i++) out[tk[i].name] = (out[tk[i].name] ?? 0) + counts[i] / (horizon - warmup);
  if (cache.size > 5000) cache.clear();
  cache.set(key, out);
  return out;
}
