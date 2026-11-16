#!/usr/bin/env node
// Собирает data/*.json из сырых страниц вики (data/raw/pages, их качает fetch-wiki.mjs).
//   node scripts/build-data.mjs
// Пишет: data/bees.json, data/tokens.json, data/fields.json, data/quests.json и data/build-report.txt
// (что не удалось разобрать — смотреть туда после каждого обновления вики).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLuaTable } from './lua-table.mjs';
import { sameQuest } from './quest-match.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw', 'pages');
const OUT = path.join(ROOT, 'data');
const report = [];
const read = (title) => {
  const f = path.join(RAW, `${title.replace(/[\/\\:*?"<>|]/g, '_')}.wiki`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
};

// ---------- общие помощники для вики-разметки ----------

/** Убирает ссылки, жирный/курсив, {{Cost|X}} и html, оставляя читаемый текст. */
function plain(s) {
  return s
    .replace(/\{\{Cost\|([^|}]*)(\|([^|}]*))?[^}]*\}\}/g, (_, item, __, amount) => (amount ? `${amount} ${item}` : item))
    .replace(/\{\{Hover\|([^|}]*)\|[^}]*\}\}/g, '$1')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Находит шаблон {{Name ...}} (с учётом вложенных {{ }}) и возвращает его параметры. */
function template(text, name) {
  const re = new RegExp(`\\{\\{\\s*${name}\\s*[|}\\n]`, 'i');
  const m = re.exec(text);
  if (!m) return null;
  let depth = 0;
  let i = m.index;
  for (; i < text.length; i++) {
    if (text.startsWith('{{', i)) { depth++; i++; } else if (text.startsWith('}}', i)) { depth--; i++; if (depth === 0) break; }
  }
  const body = text.slice(m.index + 2, i - 1);
  // делим по | верхнего уровня
  const parts = [];
  let cur = '';
  let d = 0;
  for (let k = 0; k < body.length; k++) {
    const two = body.slice(k, k + 2);
    if (two === '{{' || two === '[[') { d++; cur += two; k++; continue; }
    if (two === '}}' || two === ']]') { d--; cur += two; k++; continue; }
    if (body[k] === '|' && d === 0) { parts.push(cur); cur = ''; continue; }
    cur += body[k];
  }
  parts.push(cur);
  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
  }
  return params;
}

/** Все скачанные страницы (имя файла = заголовок; ':' в имени файла записано как '_'). */
const pageTitles = () => fs.readdirSync(RAW).filter((f) => f.endsWith('.wiki')).map((f) => f.slice(0, -5));

const num = (v) => (v === undefined || v === '' ? null : Number(String(v).replace(/,/g, '')));

// ---------- токены (Module:Ability Tokens/data — скопировано из игры) ----------

function buildTokens() {
  const src = read('Module:Ability Tokens/data');
  const t = parseLuaTable(src);
  const out = {};
  for (const [name, v] of Object.entries(t)) {
    let contexts = v.Contexts ?? (v.Context ? [v.Context] : ['Gather', 'Battle', 'Idle']);
    if (typeof contexts === 'string') contexts = [contexts];
    const c = v.Collectible || {};
    const buff = typeof c.Buff === 'object' ? c.Buff : null;
    out[name] = {
      description: v.Description,
      useCooldown: v.UseCooldown,
      tryCooldown: v.TryCooldown,
      success: v.Success,
      contexts,
      startWithFullCooldown: !!v.StartWithFullCooldown,
      lifespan: c.Dur ?? 10,
      tags: c.Tags ?? [],
      bomb: c.Bomb ? { color: c.Bomb.Color, plus: !!c.Bomb.Plus, powers: c.Bomb.Powers } : undefined,
      mark: c.MarkParams ? { buff: c.MarkParams.Buff, radius: c.MarkParams.Radius, dur: c.MarkParams.Dur, durPerLvl: c.MarkParams.DurPerLvl } : undefined,
      buff: buff ? { dur: buff.Dur, stack: buff.Stack, maxCombo: buff.MaxCombo, mods: buff.Mods } : (typeof c.Buff === 'string' ? { name: c.Buff } : undefined),
      // среднее время появления без бонусов — как считает сама вики
      avgSpawnTime: v.UseCooldown + v.TryCooldown * Math.max(0, 1 / v.Success - 1),
    };
  }
  return out;
}

// ---------- пчёлы ----------

const COLOR = { colorless: 'white', white: 'white', red: 'red', blue: 'blue' };

/** "x1.2 Pollen" / "+15% Instant Blue Conversion" / "+1 Bee Attack" -> [{stat, op, value}] */
function parseBonus(text) {
  const res = [];
  for (const part of text.replace(/\.$/, '').split(/,\s*|\s+and\s+/)) {
    const m = part.trim().match(/^([x×+\-])\s*([\d.]+)\s*(%?)\s+(.+)$/i);
    if (!m) { if (part.trim()) res.push({ stat: part.trim(), op: 'text' }); continue; }
    const [, sign, v, pct, stat] = m;
    const key = stat.trim().toLowerCase().replace(/\.$/, '');
    if (sign === 'x' || sign === '×') res.push({ stat: key, op: 'mul', value: Number(v) });
    else res.push({ stat: key, op: 'add', value: (sign === '-' ? -1 : 1) * Number(v) / (pct ? 100 : 1), percent: !!pct });
  }
  return res;
}

function buildBees(tokens) {
  const list = pageTitles().filter((t) => / Bee$/.test(t));
  const bees = [];
  for (const title of list) {
    const text = read(title);
    if (!text) continue;
    const info = template(text, 'Bee');
    const stat = template(text, 'Stat');
    if (!info || !stat) { report.push(`bee skipped (no Bee/Stat template): ${title}`); continue; }
    const statsSection = (text.match(/==\s*Stats\s*==([\s\S]*?)(?:\{\{Stat|\n==[^=])/) || [])[1] || '';
    const abilitySection = (text.match(/==\s*Abilities\s*==+([\s\S]*?)(?:\{\{Stat|\n==[^=]|$)/) || [])[1] || '';
    const lines = statsSection.split('\n').filter((l) => l.startsWith('*')).map((l) => plain(l.replace(/^\*+\s*/, '')));
    const giftedLine = lines.find((l) => /Gifted Hive Bonus/i.test(l));
    const giftedText = giftedLine ? giftedLine.replace(/^.*Gifted Hive Bonus:?\s*/i, '').trim() : '';
    const extras = lines.filter((l) => l !== giftedLine && !/^Collects |^Makes /.test(l));
    const extraText = extras.join(' ');

    const abilities = [];
    const seen = new Set();
    for (const line of abilitySection.split('\n')) {
      if (!line.startsWith('*') || line.startsWith('**')) continue;
      const m = line.match(/\[\[(Ability[ _]Tokens|Passive[ _]Abilities)#[^|\]]*\|(?:''')?\[([^\]]+)\]/);
      if (!m) continue;
      let name = m[2].trim();
      const giftedOnly = /Gifted Ability:/i.test(name);
      name = name.replace(/^🌟\s*Gifted Ability:\s*/i, '').replace(/^Passive:\s*/i, '').trim();
      const passive = /Passive/.test(m[1]);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const desc = plain(line.replace(/^\*\s*/, '').replace(/^.*?\]\]'*\]?'*:?\s*/, ''));
      abilities.push({ name, giftedOnly, passive, known: passive || !!tokens[name], description: desc });
      if (!passive && !tokens[name]) report.push(`${title}: ability "${name}" has no token data`);
    }

    const ic = extraText.match(/\+(\d+)% Instant Conversion/i);
    bees.push({
      name: title,
      color: COLOR[(info.color || '').toLowerCase()] || 'white',
      rarity: (info.rarity || stat.rarity || '').toLowerCase(),
      energy: num(info.energy),
      speed: num(info.speed),
      attack: num(info.attack),
      gather: { amount: num(stat.pollen), time: num(stat.pollentime) },
      convert: { amount: num(stat.honey), time: num(stat.honeytime) },
      instantConversion: ic ? Number(ic[1]) / 100 : 0,
      noSleep: /require (Energy|Sleep)|Doesn't require/i.test(extraText),
      extras,
      giftedBonus: { text: giftedText, effects: parseBonus(giftedText) },
      abilities,
    });
  }
  // статы из кода игры (data/game-bees.json, scripts/build-game-bees.mjs) точнее вики — подменяем числа
  const gameFile = path.join(ROOT, 'data', 'game-bees.json');
  if (fs.existsSync(gameFile)) {
    const game = new Map(JSON.parse(fs.readFileSync(gameFile, 'utf8')).map((g) => [g.name, g]));
    for (const b of bees) {
      const g = game.get(b.name);
      if (!g) continue;
      const s = g.stats;
      const gs = { ...s, ...g.giftedStats };
      const changed = [];
      const set = (label, oldV, newV, apply) => { if (oldV !== newV) changed.push(`${label} ${oldV}→${+Number(newV).toFixed(4)}`); apply(); };
      set('сбор', b.gather.amount, s.GatherAmount, () => { b.gather.amount = s.GatherAmount; });
      set('время сбора', b.gather.time, s.GatherTime, () => { b.gather.time = s.GatherTime; });
      set('конвертация', b.convert.amount, s.HoneyProductionAmount, () => { b.convert.amount = s.HoneyProductionAmount; });
      set('время конвертации', b.convert.time, s.HoneyProductionTime, () => { b.convert.time = s.HoneyProductionTime; });
      const energy = s.MaxEnergy > 1e9 ? null : Math.round(s.MaxEnergy * 1000) / 1000;
      set('энергия', b.energy, energy, () => { b.energy = energy; b.noSleep = energy === null; });
      set('скорость', b.speed, Math.round(s.Movespeed * 1000) / 1000, () => { b.speed = Math.round(s.Movespeed * 1000) / 1000; });
      b.attack = s.AttackPower;
      b.instantConversion = s.InstantConversion;
      b.giftedInstantConversion = gs.InstantConversion;
      b.sleepTime = s.SleepTime;
      b.bubbleChance = [s.GatherBubbleChance, gs.GatherBubbleChance];
      b.flameChance = [s.GatherFlameSpireChance, gs.GatherFlameSpireChance];
      b.faceColor = g.faceColor;
      b.stripeColor = g.stripeColor;
      b.imageKey = g.key;
      b.source = 'game';
      if (changed.length) report.push(`${b.name}: из игры — ${changed.join(', ')}`);
    }
  }
  bees.sort((a, b) => a.name.localeCompare(b.name));
  return bees;
}

// ---------- поля ----------

function buildFields() {
  const list = pageTitles();
  const fields = [];
  for (const title of list) {
    const text = read(title);
    if (!text) continue;
    const info = template(text, 'Field');
    const ft = template(text, 'FieldTable');
    if (!info || !ft) continue;
    const bees = num(info.bees);
    fields.push({
      name: title,
      color: (info.fieldcolor || '').toLowerCase(),
      beesRequired: Number.isFinite(bees) ? bees : 0,
      width: num(info.width),
      height: num(info.height),
      flowers: num(ft.flowers),
      white: num(ft.white) || 0,
      red: num(ft.red) || 0,
      blue: num(ft.blue) || 0,
      single: num(ft.single) || 0,
      double: num(ft.double) || 0,
      triple: num(ft.triple) || 0,
      nectar: info.nectar || null,
    });
  }
  fields.sort((a, b) => a.beesRequired - b.beesRequired || a.name.localeCompare(b.name));
  return fields;
}

// ---------- квесты ----------

function singularMob(s) {
  const t = s.trim().replace(/\.$/, '');
  const special = { mantis: 'Mantis', mantises: 'Mantis', manti: 'Mantis', werewolves: 'Werewolf', werewolve: 'Werewolf', 'rhino beetles': 'Rhino Beetle', 'rhino beetle': 'Rhino Beetle' };
  if (special[t.toLowerCase()]) return special[t.toLowerCase()];
  return t.replace(/s$/, '').replace(/^./, (c) => c.toUpperCase());
}

const FIELD_ALIASES = { 'Pineapple Field': 'Pineapple Patch', 'Pumpkin Field': 'Pumpkin Patch', 'Pine Tree Field': 'Pine Tree Forest', 'Mountain Top': 'Mountain Top Field' };

function parseRequirement(raw, fieldNames) {
  const text = plain(raw).replace(/\.$/, '');
  let m = text.match(/^Collect ([\d,.]+)\s*(K|M|B)?\s+(Red |Blue |White )?(?:Pollen(?= |$))?\s*(?:from (?:the )?(.+))?$/i);
  if (m) {
    const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1;
    const req = { type: 'pollen', amount: Number(m[1].replace(/,/g, '')) * mult, text };
    if (m[3]) req.color = m[3].trim().toLowerCase();
    if (m[4]) {
      // поле может быть записано ссылкой с другим текстом — ищем настоящее имя в исходной строке
      const link = raw.match(/from (?:the )?\[\[([^\]|]+)/i);
      let f = (link ? link[1] : m[4]).trim();
      f = FIELD_ALIASES[f] || f;
      if (!fieldNames.has(f)) { const g = [...fieldNames].find((x) => x.toLowerCase().startsWith(f.toLowerCase().split(' ')[0])); if (g) f = g; }
      req.field = f;
    }
    return req;
  }
  m = text.match(/^Defeat ([\d,]+) (.+)$/i);
  if (m) return { type: 'mob', count: Number(m[1].replace(/,/g, '')), mob: singularMob(m[2]), text };
  m = text.match(/^Collect ([\d,]+) (.+?) (?:Ability )?Tokens?(?: .*)?$/i);
  if (m) {
    const token = m[2].trim();
    // токены способностей пчёл; остальное (Treat, Strawberry, Honey…) — это предметы с поля
    if (/^(Ability|Bomb|Boost|Mark|Link|Token Link|Red Boost|Blue Boost|White Boost|Haste|Focus|Inspire|Melody|Rage|Baby Love|Honey Gift)$/i.test(token)) return { type: 'token', count: Number(m[1].replace(/,/g, '')), token, text };
    return { type: 'other', text };
  }
  m = text.match(/^Collect ([\d,]+) Goo/i);
  if (m) return { type: 'goo', amount: Number(m[1].replace(/,/g, '')), text };
  return { type: 'other', text };
}

function buildQuests(fieldNames) {
  const text = read('Quests');
  const quests = [];
  let giver = null;
  let section = null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const tab = l.match(/^\|-\|\s*(.+?)\s*=\s*$/);
    if (tab) { giver = tab[1]; continue; }
    const h = l.match(/^==+\s*(.+?)\s*==+\s*$/);
    if (h) { section = plain(h[1]); continue; }
    // строка таблицы: "|Имя квеста" затем "|" затем "* требования" ... затем "|награда"
    if (l === '|-' && lines[i + 1] && /^\|[^-}]/.test(lines[i + 1]) || (l === '|-' && /^\|\s*$/.test(lines[i + 1] || '') && lines[i + 2] && !/^[|*!]/.test(lines[i + 2]))) {
      // имя квеста обычно «|Имя», но бывает «|» и имя на следующей строке
      let nameLine = lines[i + 1];
      let j = i + 2;
      if (/^\|\s*$/.test(nameLine)) { nameLine = `|${lines[i + 2]}`; j = i + 3; }
      const name = plain(nameLine.slice(1)).replace(/^[^:]*Bear:\s*/, (s) => s);
      const reqs = [];
      if (lines[j] && /^\|\s*$/.test(lines[j])) j++;
      for (; j < lines.length && !/^\|/.test(lines[j]); j++) {
        if (/^\*/.test(lines[j])) reqs.push(parseRequirement(lines[j].replace(/^\*+\s*/, ''), fieldNames));
      }
      if (!reqs.length) continue;
      let reward = '';
      for (; j < lines.length && !/^\|-|^\|\}/.test(lines[j]); j++) reward += ` ${lines[j].replace(/^\|/, '')}`;
      quests.push({ giver, section, name: name.replace(/^.*?:\s*/, ''), requirements: reqs, reward: plain(reward.replace(/<br\s*\/?>/g, ', ')) });
      i = j - 1;
    }
  }
  return quests;
}

// Награды и требования «собери пыльцу» из кода игры (data/game-quests.json, scripts/build-game-quests.mjs) — точнее вики.
// Вики-требования, которые заменили, остаются в wikiPollen (видно, что поменялось).
function wikiRewards(text) {
  const n = (re) => Number(text.match(re)?.[1]?.replace(/,/g, '') ?? 0);
  return { royalJelly: n(/([\d,]+)\s*x?\s*Royal Jell(?:y|ies)/i), treats: n(/([\d,]+)\s*x?\s*Treats?\b/i), honey: n(/([\d,]+)\s*Honey\b/i) };
}
function mergeGameQuests(quests) {
  const file = path.join(ROOT, 'data', 'game-quests.json');
  const game = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const COL = { white: 'White', red: 'Red', blue: 'Blue' };
  const key = (r) => `${r.field || '*'}|${r.color || '*'}|${r.amount}`;
  let fixed = 0;
  for (const q of quests) {
    const g = game.find((x) => sameQuest(q, x));
    q.rewards = g?.hasRewards
      ? { royalJelly: g.royalJelly, treats: g.items.Treat ?? 0, honey: g.honey, source: 'game' }
      : { ...wikiRewards(q.reward || ''), source: 'wiki' };
    if (!g || !g.pollen.length) continue;
    const wikiPollen = q.requirements.filter((r) => r.type === 'pollen');
    if (g.pollen.map(key).sort().join(';') === wikiPollen.map(key).sort().join(';')) continue;
    const text = (r) => `Collect ${r.amount.toLocaleString('en-US')} ${r.color ? `${COL[r.color]} ` : ''}Pollen${r.field ? ` from the ${r.field}` : ''}`;
    q.requirements = [...g.pollen.map((r) => ({ type: 'pollen', amount: r.amount, text: text(r), ...(r.field ? { field: r.field } : {}), ...(r.color ? { color: r.color } : {}) })),
      ...q.requirements.filter((r) => r.type !== 'pollen')];
    q.wikiPollen = wikiPollen;
    fixed++;
    report.push(`quest «${q.name}» (${q.giver}): pollen requirements taken from game code`);
  }
  report.push(`quests: rewards from game code ${quests.filter((q) => q.rewards.source === 'game').length}/${quests.length}, pollen fixed from game ${fixed}`);
}

// ---------- снаряжение и бейджи ----------

/** Строка стата: "+25% Pollen" / "x1.5 Red Pollen" / "+350,000 Capacity" / "+Passive: X" → объект. */
function parseStatLine(raw) {
  let t = raw
    .replace(/\{\{texttip\|([+x×-]?)[^|}]*\|([^|}]*)\}\}/gi, '$1$2') // {{texttip|+250k|250,000}} → +250,000
    .replace(/<[^>]+>/g, ' ');
  t = plain(t).replace(/\s*\(.*?\)\s*$/, '').replace(/\.$/, '').trim();
  if (!t) return null;
  if (/^\+?\s*Passive:/i.test(t)) return { text: t, passive: t.replace(/^\+?\s*Passive:\s*/i, '') };
  const m = t.match(/^([+x×\-])\s*([\d.,]+)\s*(%?)\s+(.+)$/i);
  if (!m) return { text: t };
  const value = Number(m[2].replace(/,/g, ''));
  return { text: t, op: /[x×]/i.test(m[1]) ? 'mul' : 'add', value: m[1] === '-' ? -value : value, percent: !!m[3], stat: m[4].trim() };
}
const statLines = (s) => (s || '').replace(/<!--[\s\S]*?-->/g, '').split(/<br\s*\/?>|\n/).map(parseStatLine).filter(Boolean);

function buildGear() {
  const titles = pageTitles();
  const byTemplate = (name) => titles.map((t) => ({ t, text: read(t) })).filter((x) => x.text && template(x.text, name));
  const gear = { tools: [], bags: [], hats: [], belts: [], boots: [], guards: [], amulets: [], badges: [] };
  const cats = { Hats: 'hats', Belts: 'belts', Boots: 'boots', Guards: 'guards' };
  for (const { t, text } of byTemplate('Tool')) {
    if (t === 'Tools') continue;
    const p = template(text, 'Tool');
    const first = (v) => num(String(v || '').match(/[\d.]+/)?.[0]);
    // Spark Staff: range — это зона поиска, а собирает он с 3 самых полных цветков
    const flowers = /3 flowers/i.test(p.pattern || '') ? 3 : first(p.range);
    const collect = first(p.collectbase);
    const time = first(p.time);
    if (!flowers || !collect || !time) { report.push(`tool skipped (no range/collect/time): ${t}`); continue; }
    gear.tools.push({
      name: t, flowers, collect, time,
      white: num(p.whitemultiplier) || 1, red: num(p.redmultiplier) || 1, blue: num(p.bluemultiplier) || 1,
      pollenPerSec: Math.round((flowers * collect / time) * 10) / 10,
      special: p.specialmultiplier ? plain(p.specialmultiplier) : '',
    });
  }
  // у Golden Rake нет карточки — числа из текста статьи: 7 пыльцы с 4 линий по 4 клетки за 0.75 с,
  // каждый 5-й взмах — 4 линии по 12 клеток → в среднем (4·16 + 48) / 5 = 22.4 цветка
  if (read('Golden Rake') && !gear.tools.some((x) => x.name === 'Golden Rake')) {
    gear.tools.push({ name: 'Golden Rake', flowers: 22.4, collect: 7, time: 0.75, white: 1, red: 1, blue: 1, pollenPerSec: Math.round((22.4 * 7 / 0.75) * 10) / 10, special: 'каждый 5-й взмах — 48 клеток' });
  }
  for (const { t, text } of byTemplate('Bag')) {
    const p = template(text, 'Bag');
    const cap = num(String(p.capacity || '').replace(/[^\d,.]/g, ''));
    gear.bags.push({ name: t, capacity: cap, stats: statLines(p.stats) });
  }
  for (const { t, text } of byTemplate('Accessory')) {
    const p = template(text, 'Accessory');
    const catLinks = [...text.matchAll(/\[\[Category:([^\]|]+)/g)].map((m) => m[1].trim());
    const slot = catLinks.map((c) => cats[c]).find(Boolean);
    if (!slot) continue;
    gear[slot].push({ name: t, stats: statLines(p.stats) });
  }
  // амулеты: статы случайные, игрок вписывает их строки сам — здесь только список видов
  for (const t of ['Star Amulet', 'Moon Amulet', 'Shell Amulet', 'Ant Amulet', 'Stick Bug Amulet', 'King Beetle Amulet', 'Cog Amulet']) {
    if (read(t)) gear.amulets.push({ name: t });
  }
  // бейджи: в каждой категории действует только самый высокий полученный уровень
  const text = read('Badges');
  const sections = text.split(/\n(?===[^=])/);
  for (const sec of sections) {
    const h = sec.match(/^==\s*(.+?)\s*==/);
    if (!h) continue;
    const category = plain(h[1]).replace(/\s*Badges$/, '');
    const tiers = [];
    for (const row of sec.split(/\n\|-/).slice(1)) {
      const tier = row.match(/\]\]\s*([A-Za-z]+)\s*\n/)?.[1];
      if (!tier) continue;
      const lines = row.split('\n').filter((l) => l.startsWith('*')).map((l) => parseStatLine(l.replace(/^\*+\s*/, ''))).filter((x) => x && x.op);
      if (lines.length) tiers.push({ tier, stats: lines });
    }
    if (tiers.length) gear.badges.push({ category, tiers });
  }
  for (const k of ['tools', 'bags', 'hats', 'belts', 'boots', 'guards']) gear[k].sort((a, b) => (a.pollenPerSec ?? a.capacity ?? 0) - (b.pollenPerSec ?? b.capacity ?? 0) || a.name.localeCompare(b.name));
  const unparsed = [...gear.bags, ...gear.hats, ...gear.belts, ...gear.boots, ...gear.guards].flatMap((g) => g.stats.filter((x) => !x.op && !x.passive).map((x) => `${g.name}: ${x.text}`));
  for (const u of unparsed) report.push(`gear stat not understood: ${u}`);
  return gear;
}

// ---------- мутации (Module:Mutation Stats/data — скопировано из игры) ----------

function buildMutations() {
  const src = read('Module:Mutation Stats/data');
  if (!src) return [];
  const t = parseLuaTable(src.replace(/^[\s\S]*?local data = /, 'local data = '));
  return Object.entries(t)
    .filter(([, v]) => v && v.DisplayName)
    .map(([id, v]) => ({
      id, name: v.DisplayName, op: v.Op === 'Mul' ? 'mul' : 'add', stat: v.StatName, color: v.Color, colorName: v.ColorDesc,
      min: v.MinValue?.[1] ?? v.MinValue?.[0], max: v.MaxValue?.[2] ?? v.MaxValue?.[1], step: v.Interval, order: v.DisplayOrder,
    }))
    .sort((a, b) => a.order - b.order);
}

// ---------- сборка ----------

const tokens = buildTokens();
const bees = buildBees(tokens);
const fields = buildFields();
const quests = buildQuests(new Set(fields.map((f) => f.name)));
mergeGameQuests(quests);
const write = (name, data) => fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(data, null, 1)}\n`);
write('tokens.json', tokens);
write('bees.json', bees);
write('fields.json', fields);
write('quests.json', quests);
const gear = buildGear();
write('gear.json', gear);
const mutations = buildMutations();
write('mutations.json', mutations);
const otherReqs = quests.flatMap((q) => q.requirements).filter((r) => r.type === 'other');
report.push(`quest requirements not understood: ${otherReqs.length}`);
for (const r of otherReqs.slice(0, 60)) report.push(`  ? ${r.text}`);
fs.writeFileSync(path.join(OUT, 'build-report.txt'), `${report.join('\n')}\n`);
console.log(`tokens ${Object.keys(tokens).length}, bees ${bees.length}, fields ${fields.length}, quests ${quests.length}, gear ${['tools', 'bags', 'hats', 'belts', 'boots', 'guards'].map((k) => `${k} ${gear[k].length}`).join(' ')}, badges ${gear.badges.length}; notes: data/build-report.txt (${report.length} lines)`);
