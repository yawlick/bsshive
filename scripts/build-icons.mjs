#!/usr/bin/env node
// Иконки токенов и баффов из кода игры (копия в Roblox Studio → data/raw/game) + баффы для выбора на сайте.
//   node scripts/build-icons.mjs [--no-download]
// Как в игре: токен — круг цвета «фона» с картинкой, окрашенной в свой цвет (Collectibles.<Тип>.Visuals → фон, текстура, цвет);
// токен-бафф берёт вид из описания баффа (Color, Icon, IconColor; иконка по умолчанию — Decal «<Бафф> Icon» в Buffs).
// Пишет data/token-icons.json ({ tokens, buffs }), data/buffs.json (баффы, которые можно держать всё время фарма)
// и картинки site/img/icons/<id>.png (через публичный API миниатюр Roblox, как лица пчёл).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepColors, tableText, tryParse, modSpec } from './game-mods.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const G = (n) => path.join(ROOT, 'data', 'raw', 'game', n);
// script["X"].Texture → номер картинки из выгруженных Decal (иконки благословений цыплят и т.п.)
let decalTex = new Map();
const read = (n) => prepColors(fs.readFileSync(G(n), 'utf8')).replace(/script\["([^"]+)"\]\.Texture/g, (_, x) => `"${decalTex.get(x) || ''}"`);
const hex = (c) => (Array.isArray(c) && c.length === 3 ? `#${c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}` : null);
const idOf = (s) => String(s || '').match(/(\d{3,})/)?.[1] || null;
const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const DEFAULT_ICON = '65867881';

// ---------- Decal-иконки баффов (Buffs/<Имя> Icon) и дети модулей Collectibles ----------
const decals = JSON.parse(fs.readFileSync(G('_buff_decals.json'), 'utf8'));
const decalByName = new Map(decals.map((d) => [d.name, d]));
decalTex = new Map(decals.map((d) => [d.name, d.texture]));
const kids = JSON.parse(fs.readFileSync(G('_collectible_children.json'), 'utf8'));
const kid = (mod, name) => (kids[mod] || []).find((k) => k.name === name);

// ---------- описания баффов ----------
/** Все записи вида `["Имя"] = {…}` / `Имя = {…}` / `module["Имя"] = {…}` в тексте модуля. */
function entries(src) {
  const out = {};
  const re = /^(?:\t\["([^"]+)"\]|\t([A-Za-z_][A-Za-z0-9_]*)|(?:module|tbl)(?:_upvr)?\["([^"]+)"\]|(?:module|tbl)(?:_upvr)?\.([A-Za-z_][A-Za-z0-9_]*)) = \{/gm;
  for (let m; (m = re.exec(src));) {
    const t = tryParse(tableText(src, m.index));
    if (t && typeof t === 'object') out[m[1] || m[2] || m[3] || m[4]] = t;
  }
  // «local tbl = {…}» … «module_upvr.Имя = tbl» (так в NectarTypes записан Comforting)
  for (let m, re2 = /^(?:module|tbl)(?:_upvr)?\.([A-Za-z_][A-Za-z0-9_]*) = ([A-Za-z_][A-Za-z0-9_]*)$/gm; (m = re2.exec(src));) {
    if (out[m[1]]) continue;
    const at = src.lastIndexOf(`local ${m[2]} = {`, m.index);
    const t = at >= 0 ? tryParse(tableText(src, at)) : null;
    if (t && typeof t === 'object') out[m[1]] = t;
  }
  return out;
}
const buffs = {}; // имя → { def, group }
const addBuffs = (obj, group) => { for (const [n, d] of Object.entries(obj)) if (d && (d.Mods || d.Color || d.Icon)) buffs[n] ??= { def: d, group }; };
addBuffs(entries(read('ReplicatedStorage.Buffs.Init.BuffDefs.lua')), 'items');
addBuffs(tryParse(tableText(read('ReplicatedStorage.Buffs.Init.Voucher_Buffs.lua'), 0)) || {}, 'vouchers');
addBuffs(entries(read('ReplicatedStorage.Buffs.Init.Chick_Blessings.lua')), 'chicks');
// нектары: NectarTypes → «<Имя> Nectar», фон — цвет нектара на 70% к чёрному, иконка — его цветом
for (const [n, t] of Object.entries(entries(read('ReplicatedStorage.NectarTypes.lua')))) {
  if (!t.Mods || !t.Color) continue;
  buffs[`${n} Nectar`] = { def: { Mods: t.Mods, Color: lerp([0, 0, 0], t.Color, 0.7), IconColor: t.Color, Icon: t.Icon, Stack: 'Extend', MaxCombo: 1 }, group: 'nectars' };
}
// желейные бобы: JellyBeanTypes → «<Имя> Jelly Bean», фон — цвет боба наполовину к белому
// звуки бобов — ссылки на таблицу (Sound = tbl[1]), для разбора не нужны
for (const [n, t] of Object.entries(entries(read('ReplicatedStorage.JellyBeanTypes.lua').replace(/= tbl\[\d+\];/g, '= nil;')))) {
  if (!t.Color || !t.Mod) continue;
  buffs[`${n} Jelly Bean`] = { def: { Mods: [t.Mod], Color: lerp(t.Color, [255, 255, 255], 0.5), IconColor: t.Color, Icon: 'rbxassetid://3080529618', Stack: 'Combo', MaxCombo: t.MaxCombo ?? 3 }, group: 'beans' }; // MaxCombo по умолчанию 3 (JellyBeanTypes)
}

// ---------- способности: их токены и баффы прямо в описании ----------
const abilitySrc = read('ReplicatedStorage.BeeAbilityDefs.lua');
const abilities = {};
for (let m, re = /^\tvar1_upvw(?:\["([^"]+)"\]|\.([A-Za-z_][A-Za-z0-9_]*)) = \{/gm; (m = re.exec(abilitySrc));) {
  const name = m[1] || m[2];
  const body = tableText(abilitySrc, m.index);
  const ci = body.search(/\n\t\tCollectible = \{/);
  if (ci < 0) continue;
  const col = tryParse(tableText(body, ci));
  if (col) abilities[name] = col;
}
for (const [n, c] of Object.entries(abilities)) if (c.Buff && typeof c.Buff === 'object') buffs[n] ??= { def: c.Buff, group: 'ability' };

/** Вид баффа: фон, иконка (номер картинки), её цвет. */
function buffLook(name, def = buffs[name]?.def) {
  if (!def) return null;
  // как Buffs.lua: нет Icon — берётся Decal «<Имя> Icon» в Buffs, и цвет фона — тоже его (Decal.Color3)
  const d = !idOf(def.Icon) && decalByName.get(`${name} Icon`);
  const icon = idOf(def.Icon) || idOf(d?.texture) || DEFAULT_ICON;
  return { bg: hex(d ? d.color : def.Color) || '#1b1b1b', icon, iconColor: hex(def.IconColor) || '#ffffff' };
}

// ---------- вид токенов (Collectibles.<Тип>.Visuals) ----------
const iconOf = (mod) => kid(mod, 'Icon');
const T = (mod, bg, iconColor) => { const i = iconOf(mod); return i ? { bg: hex(bg), icon: idOf(i.texture), iconColor: hex(iconColor ?? i.color) } : null; };
const bombColorOf = (mod) => kid(mod, 'BombColor')?.value || [0, 0, 0];
const beeModels = JSON.parse(fs.readFileSync(G('_bee_models.json'), 'utf8'));
const rgbOfHex = (h) => (h ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : null);
const TYPE_LOOK = {
  // «return script.BombColor.Value, Icon.Texture, Icon.Color3»
  ...Object.fromEntries(['Beamstorm', 'Inspire', 'Glob', 'Gummy Storm', 'Bear Morph', 'BondToken', 'Scratch'].map((m) => [m, () => T(m, bombColorOf(m))])),
  'Token Link': () => T('Token Link', [255, 255, 255]),
  Fetch: () => T('Fetch', [250, 255, 250]),
  Inferno: () => T('Inferno', [183, 42, 24]),
  Triangulate: () => T('Triangulate', [183, 188, 200], [255, 255, 255]),
  'Mark Surge': () => T('Mark Surge', [145, 149, 159], [255, 255, 255]),
  'Summon Frog': () => T('Summon Frog', [79, 217, 168], [61, 110, 63]),
  Impale: () => T('Impale', [2, 2, 5], [152, 211, 255]),
  Glitch: () => T('Glitch', [0, 0, 0], [255, 0, 255]),
  'Map Corruption': () => T('Map Corruption', [0, 0, 255], [255, 0, 255]),
  'Mind Hack': () => T('Mind Hack', [0, 0, 0], [255, 0, 0]),
  'Fuzz Bombs': () => T('Fuzz Bombs', iconOf('Fuzz Bombs')?.color, [255, 255, 255]),
  'Pollen Haze': () => T('Pollen Haze', iconOf('Pollen Haze')?.color, [255, 255, 255]),
  'Rain Call': () => T('Rain Call', [159, 177, 197], [255, 255, 255]),
  Tornado: () => T('Tornado', [159, 177, 197], [255, 255, 255]),
  'Surprise Party': () => T('Surprise Party', [250, 253, 56], [255, 255, 255]),
  'Blue Balloon': () => T('Blue Balloon', [250, 253, 56], [35, 75, 255]),
  'Smile Token': () => T('Smile Token', [255, 255, 255], [0, 0, 0]),
  Cog: () => ({ bg: hex([27, 211, 52]), icon: '183390139', iconColor: hex([14, 109, 30]) }),
  'Festive Gift': () => ({ ...buffLook('Festive Blessing'), bg: hex([100, 3, 1]), iconColor: '#ffffff' }),
  'Festive Mark': () => ({ ...buffLook('Festive Mark'), bg: hex([232, 68, 71]), iconColor: '#ffffff' }),
  'Snowglobe Shake': () => T('Snowglobe Shake', [248, 249, 249], [255, 255, 255]),
  // Puppy Love: тело и лицо Puppy Bee
  'Puppy Love': () => { const p = beeModels.Puppy || {}; return { bg: p.body || '#e8c88a', icon: idOf(p.face), iconColor: p.faceColor || '#ffffff' }; },
  // модуль не декомпилирован («Too Many Requests»): иконка из его Decal, фон — красный, как у Precise Bee
  'Target Practice': () => ({ bg: beeModels.Precise?.body || '#c8232c', icon: idOf(iconOf('Target Practice')?.texture), iconColor: '#ffffff' }),
};
const PULSE = { Red: [252, 0, 44], Blue: [0, 33, 251] };

function tokenLook(name, c) {
  if (typeof c.Buff === 'string') return buffLook(c.Buff);
  if (c.Buff && typeof c.Buff === 'object') return buffLook(name, c.Buff);
  if (c.Bomb) {
    // PollenBomb.Visuals: фон BombColor / BombPlusColor, текстура Icon / IconPlus, цвет — по самой сильной пыльце бомбы
    const p = c.Bomb.Powers || {};
    const iconColor = p.Red > p.Blue && p.Red > p.White ? [248, 73, 40] : p.Blue > p.White ? [70, 126, 251] : [250, 250, 250];
    const plus = /\+$/.test(name);
    return { bg: hex(kid('PollenBomb', plus ? 'BombPlusColor' : 'BombColor')?.value || [0, 0, 0]), icon: idOf(kid('PollenBomb', plus ? 'IconPlus' : 'Icon')?.texture), iconColor: hex(iconColor) };
  }
  if (c.Type === 'Mark') return buffLook(c.MarkParams?.Buff); // Collectibles.Mark не декомпилирован — вид метки
  if (c.Type === 'Pulse') { const i = iconOf('Pulse') || {}; return { bg: hex(PULSE[c.ColorType] || PULSE.Red), icon: idOf(i.texture) || idOf(iconOf('Token Link')?.texture), iconColor: hex(i.color || [255, 255, 255]) }; }
  if (c.Type && TYPE_LOOK[c.Type]) return TYPE_LOOK[c.Type]();
  return null;
}
const tokens = {};
const noLook = [];
for (const [n, c] of Object.entries(abilities)) { const l = tokenLook(n, c); if (l?.icon) tokens[n] = l; else noLook.push(n); }
// Inspire (у всех Gifted) — свой модуль
tokens.Inspire ??= TYPE_LOOK.Inspire();

// ---------- баффы, которые можно держать всё время фарма ----------
// не предлагаем: баффы способностей пчёл и снаряжения (их считает модель), метки, морфы, дебаффы, тестовые и боевые
// не предлагаем только дебаффы и то, что уже задаётся отдельно (Polar Power, Science — поля на вкладке «Статы»)
const SKIP = /^(Spoiled Jelly Bean|Splinter Trap|Frozen|Cheater Debuff|Polar Power|Science Enhancement)$/;
// баффы, которые модель считает сама (от токенов пчёл и пассивок): выбор = «держу всегда», модель берёт больше из двух
const MODEL_KEY = {
  'Red Boost': 'redBoost', 'Blue Boost': 'blueBoost', 'White Boost': 'whiteBoost', Inspire: 'inspire', Focus: 'focus', 'Baby Love': 'babyLove',
  Melody: 'melody', Precision: 'precision', Haste: 'haste', 'Tabby Blessing': 'tabbyBlessing', 'Pollen Mark': 'pollenMark', 'Honey Mark': 'honeyMark',
  'Precise Mark': 'preciseMark', 'Flame Heat': 'flameHeat', 'Flame Fuel': 'flameFuel', 'Puppy Love': 'puppyLove', Rage: 'rage',
  'Red Bomb Sync': 'redBombSync', 'Blue Bomb Sync': 'blueBombSync', 'Brown Bear Morph': 'bearMorph', 'Black Bear Morph': 'bearMorph',
  'Panda Bear Morph': 'bearMorph', 'Polar Bear Morph': 'bearMorph',
};
// морфы медведей описаны функцией (bearMorphMods) — для показа: x2 пыльцы, как считает модель
for (const n of ['Brown Bear Morph', 'Black Bear Morph', 'Panda Bear Morph', 'Polar Bear Morph']) buffs[n] ??= { def: { Mods: [{ Type: 'PollenBonus', Value: 2, Op: 'Mul' }] }, group: 'ability' };
const GROUP_RU = { model: 'От пчёл и снаряжения (модель считает сама — включи, если держишь всегда)', ability: 'Прочие от способностей', items: 'Предметы и коды', vouchers: 'Ваучеры', chicks: 'Благословения цыплят', nectars: 'Нектары', beans: 'Желейные бобы' };
const pick = [];
for (const [name, { def, group }] of Object.entries(buffs)) {
  if (SKIP.test(name) || !Array.isArray(def.Mods)) continue;
  if (MODEL_KEY[name]) continue; // их модель считает сама из токенов пчёл и пассивок — в выбор не идут
  const modelKey = null;
  const grp = group;
  // значение первого стака и прибавка за каждый следующий (ValuePerStack у желейных бобов; иначе — то же значение)
  const mods = def.Mods.map((m) => ({ m, s: modSpec(m) })).filter(({ s }) => s && !s.passive).map(({ m, s }) => {
    const per = typeof m.ValuePerStack === 'number' ? (s.unit === '%' ? Math.round(m.ValuePerStack * 1000) / 10 : m.ValuePerStack) : undefined;
    return { stat: s.stat, op: s.op, unit: s.unit, value: s.max, ...(per !== undefined ? { perStack: per } : {}) };
  });
  if (!mods.length && !modelKey) continue;
  const combo = def.Stack === 'Combo' && (def.MaxCombo ?? 0) !== 1;
  pick.push({ name, group: grp, groupRu: GROUP_RU[grp] || grp, look: buffLook(name, def) || { bg: '#444', icon: null }, maxStacks: combo ? (def.MaxCombo || 100) : 1, mods, ...(modelKey ? { modelKey } : {}) });
}
const ORDER = Object.keys(GROUP_RU);
pick.sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || a.name.localeCompare(b.name));

// вид баффов для страницы: все, что нашли (в т.ч. баффы способностей — для таблицы «Баффы и множители»)
const buffLooks = {};
for (const n of Object.keys(buffs)) { const l = buffLook(n); if (l) buffLooks[n] = l; }

// ---------- картинки ----------
const OUT = path.join(ROOT, 'site', 'img', 'icons');
const ids = new Set([...Object.values(tokens), ...Object.values(buffLooks), ...pick.map((p) => p.look)].map((l) => l?.icon).filter(Boolean));
let downloaded = 0;
const missing = [];
if (!process.argv.includes('--no-download')) {
  fs.mkdirSync(OUT, { recursive: true });
  const UA = 'bsshive-image-fetcher/0.1';
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const need = [...ids].filter((id) => !fs.existsSync(path.join(OUT, `${id}.png`)));
  const urls = new Map();
  for (let i = 0; i < need.length; i += 50) {
    const res = await fetch(`https://thumbnails.roblox.com/v1/assets?assetIds=${need.slice(i, i + 50).join(',')}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`, { headers: { 'User-Agent': UA } });
    for (const d of (await res.json()).data || []) if (d.state === 'Completed' && d.imageUrl) urls.set(String(d.targetId), d.imageUrl);
  }
  for (const id of need) {
    const url = urls.get(id);
    if (!url || !/^https:\/\/[a-z0-9.-]+\.rbxcdn\.com\//.test(url)) { missing.push(id); continue; }
    const buf = Buffer.from(await (await fetch(url, { headers: { 'User-Agent': UA } })).arrayBuffer());
    if (!buf.subarray(0, 4).equals(PNG)) { missing.push(`${id} (не PNG)`); continue; }
    fs.writeFileSync(path.join(OUT, `${id}.png`), buf);
    downloaded++;
  }
}
const have = (l) => l && fs.existsSync(path.join(OUT, `${l.icon}.png`));
for (const m of [tokens, buffLooks]) for (const l of Object.values(m)) l.img = have(l);
for (const p of pick) p.look.img = have(p.look);

fs.writeFileSync(path.join(ROOT, 'data', 'token-icons.json'), `${JSON.stringify({ source: 'ReplicatedStorage.Collectibles / Buffs (клиент игры)', tokens, buffs: buffLooks }, null, 1)}\n`);
fs.writeFileSync(path.join(ROOT, 'data', 'buffs.json'), `${JSON.stringify({ source: 'ReplicatedStorage.Buffs.Init.* / NectarTypes / JellyBeanTypes (клиент игры)', groups: GROUP_RU, buffs: pick }, null, 1)}\n`);
console.log(`токенов: ${Object.keys(tokens).length} (без вида: ${noLook.join(', ') || 'нет'}); баффов с видом: ${Object.keys(buffLooks).length}; для выбора: ${pick.length} (${ORDER.map((g) => `${GROUP_RU[g]} ${pick.filter((p) => p.group === g).length}`).join(', ')})`);
console.log(`картинок: ${ids.size}, скачано сейчас ${downloaded}${missing.length ? `, нет: ${missing.join(', ')}` : ''}`);
