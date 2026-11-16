#!/usr/bin/env node
// Квесты прямо из кода игры: ReplicatedStorage.NPCs.*Init.lua (копия игры в Studio, выгружена в data/raw/game/).
//   node scripts/build-game-quests.mjs
// Пишет data/game-quests.json (задания, Royal Jelly, мёд, предметы-награды) и печатает расхождения с вики (data/quests.json).
// scripts/build-data.mjs берёт отсюда награды (они точнее вики) и требования «собери пыльцу», если они расходятся.
// Код игры только разбирается как текст (scripts/lua-table.mjs) — ничего из него не выполняется.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLuaTable } from './lua-table.mjs';
import { sameQuest } from './quest-match.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'data', 'raw', 'game');

// файл → кто даёт квесты (как на вики)
const GIVERS = [
  [/^BlackBear/, 'Black Bear'], [/^BrownBear(?!InitOld)/, 'Brown Bear'], [/^MotherBear/, 'Mother Bear'], [/^PandaBear/, 'Panda Bear'],
  [/^ScienceBear/, 'Science Bear'], [/^PolarBear/, 'Polar Bear'], [/^SpiritBear/, 'Spirit Bear'], [/^DapperBearInit(?!Backup)/, 'Dapper Bear'],
  [/^BuckoBee/, 'Gifted Bucko Bee'], [/^RileyBee/, 'Gifted Riley Bee'], [/^Onett/, 'Onett'], [/^SunBear/, 'Sun Bear'],
  [/^BeeBear\d*Init/, 'Bee Bear'], [/^GummyBear/, 'Gummy Bear'], [/^BubbleBeeMan/, 'Bubble Bee Man'],
];

/** Кусок декомпилированного Lua → литерал: ссылки на переменные и вызовы — строками. */
const literal = (block) => block
  .replace(/\b(Vector3|Vector2|CFrame|UDim2|UDim|Color3|BrickColor|os|tick|math)\.?\w*\(([^()]|\([^()]*\))*\)/g, '"$1"')
  .replace(/=\s*(?!true\b|false\b|nil\b)([A-Za-z_][\w.:]*)\s*([;,}\n])/g, '= "$1"$2')
  .replace(/=\s*(?!true\b|false\b|nil\b)([A-Za-z_][\w.:]*\[[^\]]*\])\s*([;,}\n])/g, '= "$1"$2');

/** Сбалансированный блок «{ ... }», начиная с первой «{» после from. */
function block(src, from) {
  const start = src.indexOf('{', from);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") { // строки пропускаем целиком
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return { start, end: i + 1, text: src.slice(start, i + 1) };
  }
  return null;
}

function parseFile(src) {
  const out = [];
  for (const m of src.matchAll(/\n(\t+)Tasks = \{/g)) {
    const indent = m[1];
    const tb = block(src, m.index + 1);
    if (!tb) continue;
    // имя квеста — ближайшее «Name =» с тем же отступом выше; конец квеста — следующее «Name =» с тем же отступом
    const before = src.slice(Math.max(0, m.index - 4000), m.index);
    const names = [...before.matchAll(new RegExp(`\\n${indent}Name = "([^"]*)";`, 'g'))];
    if (!names.length) continue;
    const head = before.slice(names.at(-1).index);
    const nextName = src.slice(tb.end).search(new RegExp(`\\n${indent}Name = "`));
    const tail = src.slice(tb.end, nextName < 0 ? src.length : tb.end + nextName);
    const display = head.match(new RegExp(`\\n${indent}DisplayName = "([^"]*)";`))?.[1];
    let tasks;
    try { tasks = parseLuaTable(literal(tb.text)); } catch { continue; }
    if (!Array.isArray(tasks)) continue;
    const rewardsAt = tail.search(new RegExp(`\\n${indent}Rewards = \\{`));
    let rewards = [];
    if (rewardsAt >= 0) {
      try { rewards = parseLuaTable(literal(block(tail, rewardsAt + 1).text)); } catch { rewards = []; }
    }
    const num = (key) => tail.match(new RegExp(`\\n${indent}${key} = ([\\d.]+)`))?.[1];
    const rj = num('RoyalJelly');
    const honey = num('Honey');
    // награды не всегда рядом с заданиями (у Science Bear они уровнем выше) — тогда берём награды с вики
    const hasRewards = rewardsAt >= 0 || rj !== undefined || honey !== undefined;
    out.push({ name: display || names.at(-1)[1], id: names.at(-1)[1], tasks, hasRewards, royalJelly: Number(rj ?? 0), honey: Number(honey ?? 0), rewards: Array.isArray(rewards) ? rewards : [] });
  }
  return out;
}

const quests = [];
for (const file of fs.readdirSync(DIR).filter((f) => /^ReplicatedStorage\.NPCs\..*\.lua$/.test(f)).sort()) {
  const stem = file.replace(/^ReplicatedStorage\.NPCs\./, '');
  const giver = GIVERS.find(([re]) => re.test(stem))?.[1];
  if (!giver) continue;
  for (const q of parseFile(fs.readFileSync(path.join(DIR, file), 'utf8'))) quests.push({ giver, file: stem, ...q });
}

// требования «собери пыльцу» в формате data/quests.json
const COLOR = { White: 'white', Red: 'red', Blue: 'blue' };
export function pollenReqs(tasks) {
  return tasks.filter((t) => (!t.Type || t.Type === 'Collect Pollen') && typeof t.Amount === 'number')
    .map((t) => ({ field: t.Zone || null, color: COLOR[t.Color] || null, amount: t.Amount }));
}
const items = (q) => {
  const o = {};
  for (const r of q.rewards) if (r && r.Type && typeof r.Amount === 'number') o[r.Type] = (o[r.Type] ?? 0) + r.Amount;
  return o;
};
const out = quests.map((q) => ({ giver: q.giver, name: q.name, id: q.id, file: q.file, hasRewards: q.hasRewards, royalJelly: q.royalJelly, honey: q.honey, items: items(q), pollen: pollenReqs(q.tasks), otherTasks: q.tasks.filter((t) => t.Type && t.Type !== 'Collect Pollen').map((t) => t.Type) }));
fs.writeFileSync(path.join(ROOT, 'data', 'game-quests.json'), `${JSON.stringify(out, null, 1)}\n`);

// сверка с вики
const wiki = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'quests.json'), 'utf8'));
const key = (r) => `${r.field || '*'}|${r.color || '*'}|${r.amount}`;
let matched = 0;
const diffs = [];
for (const g of out) {
  const w = wiki.find((x) => sameQuest(x, g));
  if (!w) continue;
  matched++;
  const a = g.pollen.map(key).sort().join(' ; ');
  const b = (w.wikiPollen ?? w.requirements.filter((r) => r.type === 'pollen')).map(key).sort().join(' ; '); // как на вики
  if (a !== b) diffs.push(`${g.giver} «${g.name}»:\n    игра ${a || '—'}\n    вики ${b || '—'}`);
}
console.log(`квестов из игры: ${out.length}, совпало с вики по названию: ${matched}; расхождений в пыльце: ${diffs.length}`);
for (const d of diffs) console.log(`  ${d}`);
