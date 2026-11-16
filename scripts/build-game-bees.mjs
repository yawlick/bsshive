#!/usr/bin/env node
// Статы пчёл прямо из кода игры: ReplicatedStorage.BeeTypes (копия игры в Studio, выгружена в data/raw/game/).
//   node scripts/build-game-bees.mjs
// Пишет data/game-bees.json и печатает расхождения с вики (data/bees.json).
// Код игры только разбирается как текст (scripts/lua-table.mjs) — ничего из него не выполняется.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLuaTable } from './lua-table.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'data', 'raw', 'game', 'ReplicatedStorage.BeeTypes.lua'), 'utf8');

const hex = (r, g, b) => `#${[r, g, b].map((x) => Math.round(Number(x)).toString(16).padStart(2, '0')).join('')}`;
// именованные цвета (local tbl_4 = { Black = Color3.fromRGB(...) ... })
const named = {};
const colorsBlock = src.match(/local tbl_4 = \{([\s\S]*?)\n\}/)[1];
for (const m of colorsBlock.matchAll(/(\w+) = Color3\.fromRGB\(([\d.]+), ([\d.]+), ([\d.]+)\)/g)) named[m[1]] = hex(m[2], m[3], m[4]);

/** Делает кусок декомпилированного Lua литералом: цвета → строки, ссылки на переменные → строки. */
function literal(block) {
  return block
    .replace(/Color3\.fromRGB\(([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/g, (_, r, g, b) => `"${hex(r, g, b)}"`)
    .replace(/tbl_4\.(\w+)/g, (_, n) => `"${named[n] || n}"`)
    .replace(/tbl_3\[("[^"]*")\]/g, '$1').replace(/tbl_3\.(\w+)/g, '"$1"')
    .replace(/\b(Vector3|Vector2|CFrame|UDim2|UDim|NumberRange|NumberSequence|ColorSequence|BrickColor)\.\w+\(([^()]|\([^()]*\))*\)/g, '"$1"')
    .replace(/=\s*(?!true\b|false\b|nil\b)([A-Za-z_][\w.:]*)\s*([;,}\n])/g, '= "$1"$2');
}
const grab = (re) => {
  const start = src.search(re);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(src.indexOf('{', start), i + 1);
  }
  throw new Error('не нашёл блок');
};
const defaults = parseLuaTable(literal(grab(/\nlocal tbl = \{/)));
const bees = parseLuaTable(literal(grab(/\nlocal tbl_2_upvr = \{/)));

const NUM = ['GatherTime', 'GatherAmount', 'HoneyProductionTime', 'HoneyProductionAmount', 'MaxEnergy', 'Movespeed', 'AttackPower', 'AbilityRate',
  'CriticalChance', 'SuperCritChance', 'InstantConversion', 'GatherBubbleChance', 'GatherFlameSpireChance', 'GatherPollinateChance', 'SleepTime',
  'WhiteGatherBonus', 'RedGatherBonus', 'BlueGatherBonus', 'HiveConvertBonusHoney', 'HiveConvertBonusHoneyPerLvl'];
const applyBonuses = (base, bonuses) => {
  const out = { ...base };
  for (const [stat, b] of Object.entries(bonuses || {})) {
    if (typeof out[stat] !== 'number' && b.Add === undefined) continue;
    out[stat] = ((out[stat] ?? 0) + (b.Add ?? 0)) * (b.Mul ?? 1);
  }
  return out;
};

const out = [];
for (const [key, b] of Object.entries(bees)) {
  const merged = { ...defaults, ...b };
  const final = applyBonuses(Object.fromEntries(NUM.map((k) => [k, merged[k]])), merged.Bonuses);
  // у Bubble и Tadpole в игре ключ с опечаткой «GiftedBonues» — игра читает только GiftedBonuses, так что он не работает
  const gifted = applyBonuses({ ...final }, merged.GiftedBonuses);
  const giftedDiff = Object.fromEntries(NUM.filter((k) => gifted[k] !== final[k]).map((k) => [k, gifted[k]]));
  out.push({
    key, name: `${key} Bee`, id: merged.ID, rarity: String(merged.Rarity || '').toLowerCase(),
    color: { None: 'white', Red: 'red', Blue: 'blue' }[merged.ColorType] || 'white',
    faceColor: merged.FaceColor, stripeColor: merged.StripeColor,
    stats: Object.fromEntries(NUM.map((k) => [k, final[k]])),
    giftedStats: giftedDiff,
    giftedTypo: !!b.GiftedBonues,
    giftedPerk: merged.GiftedPerk || merged.GiftedPerks || null,
    giftedPerkDesc: merged.GiftedPerkDesc,
    abilities: (merged.Abilities || []).map((a) => (Array.isArray(a) ? a[0] : a)),
    gatherPowers: merged.GatherPowers,
  });
}
out.sort((a, b) => a.id - b.id);
fs.writeFileSync(path.join(ROOT, 'data', 'game-bees.json'), `${JSON.stringify(out, null, 1)}\n`);

// сверка с вики
const wiki = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bees.json'), 'utf8')).map((b) => [b.name, b]));
const diffs = [];
for (const g of out) {
  const w = wiki.get(g.name);
  if (!w) { diffs.push(`${g.name}: нет на вики`); continue; }
  const s = g.stats;
  const cmp = [['сбор', s.GatherAmount, w.gather.amount], ['время сбора', s.GatherTime, w.gather.time], ['конвертация', s.HoneyProductionAmount, w.convert.amount],
    ['время конвертации', s.HoneyProductionTime, w.convert.time], ['энергия', s.MaxEnergy, w.energy], ['скорость', s.Movespeed, w.speed]];
  const bad = cmp.filter(([, a, b]) => b !== null && Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(b)) + 0.051);
  if (bad.length) diffs.push(`${g.name}: ${bad.map(([n, a, b]) => `${n} игра ${+a.toFixed(3)} / вики ${b}`).join('; ')}`);
}
console.log(`пчёл из игры: ${out.length}; расхождений с вики: ${diffs.length}`);
for (const d of diffs) console.log(`  ${d}`);
