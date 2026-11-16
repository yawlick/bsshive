// Конструктор амулетов: описание амулетов из кода игры (data/amulets.json, scripts/build-amulets.mjs) ⇄ строки «как в игре».
// Источник правды для статов — строки амулета (их читает core/gear.js); конструктор лишь собирает их и разбирает обратно.
// Амулет в настройке: { name: 'Silver Star Amulet', type: 'Silver Star Amulet', lines: 'x1.5 Capacity\n+24% Red Pollen…' }.
import { parseLine } from './gear.js';

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
const round = (v, step) => {
  const r = Math.round(v / step) * step;
  return Number(r.toFixed(step < 1 ? 2 : 0));
};

/** Строка «как в игре» для мода из data/amulets.json и значения. */
export function modLine(spec, value) {
  if (spec.passive) return `+Passive: ${spec.passive}`;
  const v = round(value, spec.step || 0.01);
  if (spec.unit === 'x') return `x${v} ${spec.stat}`;
  if (spec.unit === '%') return `+${v}% ${spec.stat}`;
  return `+${v.toLocaleString('en-US')} ${spec.stat}`;
}

/** Значение в единицах мода из разобранной строки (parseLine): «+24% Red Pollen» → 24, «x1.5 Capacity» → 1.5. */
function lineMatches(spec, p) {
  if (!p) return false;
  if (spec.passive) return !!p.passive && norm(p.passive) === norm(spec.passive);
  if (!p.stat || norm(p.stat) !== norm(spec.stat)) return false;
  if (spec.unit === 'x') return p.op === 'mul';
  if (spec.unit === '%') return p.op === 'add' && p.percent;
  return p.op === 'add' && !p.percent;
}

/**
 * Разобрать строки амулета по описанию def.
 * @returns { fixed: [значение | null (строки нет)], pools: [[{ i (номер варианта), value }]], extra: [строки, которые не подошли],
 *            fit (сколько строк легли в диапазоны), bad (сколько не подошло / вне диапазона) }
 */
export function parseAmulet(def, lines) {
  const list = String(lines || '').split(/\n|;/).map((x) => x.trim()).filter(Boolean);
  const fixedSlots = def.slots.filter((s) => s.kind === 'fixed');
  const poolSlots = def.slots.filter((s) => s.kind === 'pool');
  const fixed = fixedSlots.map(() => null);
  const pools = poolSlots.map(() => []);
  const extra = [];
  let fit = 0;
  let bad = 0;
  const inRange = (spec, v) => spec.passive || (v >= spec.min - 1e-6 && v <= spec.max + 1e-6);
  for (const text of list) {
    const p = parseLine(text);
    const value = p?.passive ? 1 : p?.value;
    let done = false;
    for (let k = 0; k < fixedSlots.length && !done; k++) {
      if (fixed[k] === null && lineMatches(fixedSlots[k], p)) { fixed[k] = value; done = true; if (inRange(fixedSlots[k], value)) fit++; else bad++; }
    }
    for (let k = 0; k < poolSlots.length && !done; k++) {
      const s = poolSlots[k];
      const cap = s.maybeSelect || s.select;
      if (pools[k].length >= cap) continue;
      const i = s.options.findIndex((o, j) => !pools[k].some((x) => x.i === j) && lineMatches(o, p));
      if (i >= 0) { pools[k].push({ i, value }); done = true; if (inRange(s.options[i], value)) fit++; else bad++; }
    }
    if (!done) { extra.push(text); bad++; }
  }
  // обязательная строка (без шанса), которой нет, — тоже несовпадение
  fixedSlots.forEach((s, k) => { if (fixed[k] === null && !s.chance) bad++; });
  return { fixed, pools, extra, fit, bad };
}

/** Собрать строки амулета из разобранного состояния (обратное к parseAmulet). */
export function amuletLines(def, st) {
  const fixedSlots = def.slots.filter((s) => s.kind === 'fixed');
  const poolSlots = def.slots.filter((s) => s.kind === 'pool');
  const out = [];
  fixedSlots.forEach((s, k) => { if (st.fixed[k] !== null && st.fixed[k] !== undefined) out.push(modLine(s, st.fixed[k])); });
  poolSlots.forEach((s, k) => { for (const x of st.pools[k] || []) out.push(modLine(s.options[x.i], x.value)); });
  return [...out, ...(st.extra || [])].join('\n');
}

/** Пустое состояние: обязательные строки — на максимуме, редкие (с шансом) — выключены, из пулов ничего не выбрано. */
export function emptyAmulet(def) {
  const fixedSlots = def.slots.filter((s) => s.kind === 'fixed');
  return { fixed: fixedSlots.map((s) => (s.chance ? null : s.max)), pools: def.slots.filter((s) => s.kind === 'pool').map(() => []), extra: [] };
}

/** Группа амулета по названию: «Silver Star Amulet» / «Star Amulet» → «Star». */
export function amuletGroup(amulets, name) {
  const n = norm(name).replace(/ amulet$/, '').replace(/^(bronze|silver|gold|diamond|supreme) /, '');
  return amulets.groups.find((g) => norm(g) === n) || null;
}

/**
 * Какой это амулет: по type, если он есть, иначе — тир группы, в который строки ложатся лучше всего
 * (старые амулеты сохранены только строками и названием группы).
 * @returns def из data/amulets.json или null
 */
export function amuletDef(amulets, a) {
  if (!amulets) return null;
  const byType = a?.type && amulets.amulets.find((d) => d.name === a.type);
  if (byType) return byType;
  const exact = amulets.amulets.find((d) => d.name === a?.name);
  if (exact) return exact;
  const group = amuletGroup(amulets, a?.name || '');
  if (!group) return null;
  const tiers = amulets.amulets.filter((d) => d.group === group);
  let best = null;
  for (const d of tiers) {
    const r = parseAmulet(d, a.lines);
    const score = r.fit * 10 - r.bad * 15;
    if (!best || score > best.score) best = { d, score };
  }
  return best?.d || null;
}
