// Общее для разбора кода игры (data/raw/game): моды статов (StatModifiers) → строки «как в игре», которые понимает
// core/gear.js («+25% Pollen», «x1.5 Capacity»), и помощники для разбора Lua-таблиц с Color3.
import { parseLuaTable } from './lua-table.mjs';

/** Color3.fromRGB(r, g, b) / Color3.new(r, g, b) → литерал {r, g, b}, чтобы таблицу можно было разобрать. */
export function prepColors(src) {
  return src
    .replace(/Color3\.fromRGB\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g, '{$1, $2, $3}')
    .replace(/Color3\.new\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g, (_, a, b, c) => `{${Math.round(a * 255)}, ${Math.round(b * 255)}, ${Math.round(c * 255)}}`);
}

/** Текст литерала таблицы, который начинается с первой «{» после позиции from (с учётом строк). */
export function tableText(s, from) {
  const start = s.indexOf('{', from);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") { const q = c; i++; while (i < s.length && s[i] !== q) { if (s[i] === '\\') i++; i++; } continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

/** Разобрать таблицу, не падая: null, если внутри не литералы (функции, require…). */
export function tryParse(text) {
  try { return parseLuaTable(text); } catch { return null; }
}

/** Название стата для мода (без числа) — как его пишет игра; null — мод не про статы или неизвестен. */
export function statName(mod) {
  const p = mod.Params || {};
  switch (mod.Type) {
    case 'BaseProductionRate': return p.Color ? `${p.Color === 'Colorless' ? 'White' : p.Color} Bee Convert Rate` : 'Convert Rate';
    case 'BaseConversionRate': return 'Convert Amount';
    case 'ConversionAtHive': return 'Convert Rate At Hive';
    case 'HoneymakingSpeed': return 'Convert Rate At Hive'; // x2 Honey Speed — пчёлы в улье конвертируют быстрее
    case 'PollenConversion': return p.Color ? `Instant ${p.Color} Conversion` : p.Tag ? `Instant ${p.Tag} Conversion` : p.Zone ? `Instant ${p.Zone} Conversion` : 'Instant Conversion';
    case 'PollenValue': return 'Honey Per Pollen';
    case 'PollenBonus': {
      if (p.Color) return `${p.Color} Pollen`;
      if (p.Zone) return `${p.Zone} Pollen`;
      if (p.Tag) return `${p.Tag} Pollen`;
      return 'Pollen';
    }
    case 'ContainerSpace': case 'ContainerSpaceMultiplier': return p.Color ? `${p.Color} Field Capacity` : 'Capacity';
    case 'CriticalChance': return 'Critical Chance';
    case 'CriticalPower': return 'Critical Power';
    case 'SuperCritChance': return 'Super-Crit Chance';
    case 'SuperCritPower': return 'Super-Crit Power';
    case 'BeeAbilityRate': return 'Bee Ability Rate';
    case 'HoneyFromTokens': return 'Honey From Tokens';
    case 'HoneyAtHive': return 'Honey At Hive';
    case 'MovementCollection': return 'Movement Collection';
    case 'BeeMovespeedMultiplier': return 'Bee Movespeed';
    case 'MaxBeeEnergy': return 'Bee Energy';
    case 'BombPower': return 'Bomb Power';
    case 'BeeAttack': return `${Array.isArray(p.Color) ? '' : p.Color ? `${p.Color} ` : ''}Bee Attack`;
    case 'BeeAttackMultiplier': return 'Bee Attack';
    case 'BattleBondMultiplier': return 'Bond From Battle';
    case 'TreatBondMultiplier': return 'Bond From Treats';
    case 'GooAmount': return 'Goo';
    case 'GooConversion': return 'Goo Conversion';
    case 'DamageReduction': return 'Defense';
    case 'PlayerMovespeed': return 'Player Movespeed';
    case 'JumpPower': return 'Jump Power';
    case 'MonsterCooldownReduction': return 'Monster Respawn Time';
    case 'NectarMultiplier': return 'Nectar';
    case 'AbilityTokenLifespan': return 'Ability Token Lifespan';
    case 'TicketChance': return 'Ticket Chance';
    case 'Luck': return 'Loot Luck';
    default: return null;
  }
}
// эти моды в игре — числа (не проценты)
export const FLAT = new Set(['BaseConversionRate', 'ContainerSpace', 'MovementCollection', 'BeeAttack', 'PlayerMovespeed', 'JumpPower']);
const pct = (v) => Math.round(v * 1000) / 10;

/**
 * Мод игры → { stat, op: 'add'|'mul', unit: '%'|'x'|'', min, max, step } — значения в единицах строки
 * (у модов со шкалой MinValue…MaxValue — она же). null — мод не про статы (или значение вычисляется кодом).
 */
export function modSpec(mod) {
  if (mod.Type === 'PlayerAbility') return { passive: mod.Params?.Ability, stat: `Passive: ${mod.Params?.Ability}`, op: 'passive', unit: '', min: 1, max: 1, step: 1 };
  const stat = statName(mod);
  if (!stat || mod.Op === 'Set') return null;
  let a; let b;
  if (Array.isArray(mod.Value)) [a, b = a] = mod.Value;
  else if (typeof mod.Value === 'number') a = b = mod.Value;
  else if (typeof mod.MaxValue === 'number') { a = mod.MinValue ?? mod.MaxValue; b = mod.MaxValue; }
  if (typeof a !== 'number') return null;
  const out = { stat };
  if (mod.Op === 'Mul') Object.assign(out, { op: 'mul', unit: 'x', min: a, max: b, step: 0.01 });
  else if (FLAT.has(mod.Type)) Object.assign(out, { op: 'add', unit: '', min: a, max: b, step: mod.Resolution || 1 });
  else Object.assign(out, { op: 'add', unit: '%', min: pct(a), max: pct(b), step: mod.Resolution ? pct(mod.Resolution) : 1 });
  if (mod.Type === 'BeeAttack' && Array.isArray(mod.Params?.Color)) out.note = `цвет случайный: ${mod.Params.Color.join(' / ')}`;
  if (mod.Chance !== undefined && mod.Chance < 1) out.chance = mod.Chance;
  return out;
}
