#!/usr/bin/env node
// Амулеты из кода игры (data/raw/game/ReplicatedStorage.Amulets.lua) → data/amulets.json для конструктора амулетов на сайте.
//   node scripts/build-amulets.mjs
// У каждого амулета: строки, которые есть всегда (fixed), и пулы «выпадает N строк из списка» (Select N).
// Для каждой строки — диапазон значений, шаг и текст «как в игре» (его понимает core/gear.js: «+25% Pollen», «x1.5 Capacity»).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLuaTable } from './lua-table.mjs';
import { tableText, modSpec } from './game-mods.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data/raw/game/ReplicatedStorage.Amulets.lua');
let src = fs.readFileSync(SRC, 'utf8');

// 1) общие пулы Star-амулетов: строки (tbl_9) и пассивки (tbl_8)
const STAR_POOL = tableText(src, src.indexOf('local tbl_9_upvr ='));
const STAR_PASSIVES = tableText(src, src.indexOf('local tbl_8_upvr ='));
src = src.replaceAll('createStarAmuletMods()', STAR_POOL);
// Supreme Star: пул пассивок — функция, которая копирует tbl_8; число пассивок — функция «2% шанс на две»
src = src.replace(/Pool = \(function\(\)[\s\S]*?end\)\(\)/, `Pool = ${STAR_PASSIVES}`);
src = src.replace(/Select = function\(arg1, arg2\)[\s\S]*?\n\t\tend;/, 'Select = 1; MaybeSelect = 2; MaybeChance = 0.02;');

// 2) описания амулетов
const defs = [];
const re = /^tbl_4_upvr\["([^"]+)"\] = \{/gm;
for (let m; (m = re.exec(src));) {
  const name = m[1];
  if (/Test/.test(name)) continue; // «Moon Test Amulet» — тестовый, в игре его нет
  const t = parseLuaTable(tableText(src, m.index));
  defs.push({ name, ...t });
}

const TIERS = ['Bronze', 'Silver', 'Gold', 'Diamond', 'Supreme'];
const amulets = defs.map((d) => {
  const tier = TIERS.find((t) => d.name.startsWith(`${t} `)) || null;
  const slots = [];
  for (const m of d.Mods || []) {
    if (m.Pool) {
      const options = m.Pool.map(modSpec).filter(Boolean);
      const slot = { kind: 'pool', select: m.Select, options };
      if (m.Chance !== undefined && m.Chance < 1) slot.chance = m.Chance;
      if (m.MaybeSelect) Object.assign(slot, { maybeSelect: m.MaybeSelect, maybeChance: m.MaybeChance });
      slots.push(slot);
    } else {
      const spec = modSpec(m);
      if (spec) slots.push({ kind: 'fixed', ...spec });
    }
  }
  return { name: d.name, group: d.Group, tier, slots };
});
const GROUP_ORDER = ['Star', 'Moon', 'Ant', 'Shell', 'Stick Bug', 'King Beetle', 'Cog'];
amulets.sort((x, y) => GROUP_ORDER.indexOf(x.group) - GROUP_ORDER.indexOf(y.group) || TIERS.indexOf(x.tier) - TIERS.indexOf(y.tier));

const out = { source: 'ReplicatedStorage.Amulets (клиент игры)', groups: GROUP_ORDER.filter((g) => amulets.some((a) => a.group === g)), amulets };
fs.writeFileSync(path.join(ROOT, 'data', 'amulets.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`amulets: ${amulets.length} — ${out.groups.map((g) => `${g}: ${amulets.filter((a) => a.group === g).map((a) => a.tier || 'один').join('/')}`).join(', ')}`);
