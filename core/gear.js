// Статы игрока из снаряжения, бейджей, амулетов и любых строк «как в игре» (+25% Pollen, x1.5 Red Pollen…).
// Как в игре: итог = (база + все «+») × все «x». Бонусы Gifted-улья сюда НЕ входят — их добавит модель.
import { DEFAULT_PLAYER, stripHiveBonuses } from './model.js';

export const SLOTS = [
  { key: 'tool', list: 'tools', label: 'Инструмент' },
  { key: 'bag', list: 'bags', label: 'Рюкзак' },
  { key: 'hat', list: 'hats', label: 'Маска / шапка' },
  { key: 'belt', list: 'belts', label: 'Ремень' },
  { key: 'boots', list: 'boots', label: 'Ботинки' },
  { key: 'guardL', list: 'guards', label: 'Щиток (левый)' },
  { key: 'guardR', list: 'guards', label: 'Щиток (правый)' },
];
export const BADGE_TIERS = ['Cadet', 'Hotshot', 'Ace', 'Master', 'Grandmaster'];

// имя стата (как в игре, в нижнем регистре) → ключ модели и вид: mult — база 100%, chance — база 0%, flat — число
const STATS = {
  pollen: ['pollen', 'mult'], 'white pollen': ['white', 'mult'], 'red pollen': ['red', 'mult'], 'blue pollen': ['blue', 'mult'],
  'pollen from bee gathering': ['beeGather', 'mult'], 'bee gather pollen': ['beeGather', 'mult'], 'bee gathering pollen': ['beeGather', 'mult'],
  'bee ability pollen': ['abilityPollen', 'mult'], 'gifted bee pollen': ['giftedBeePollen', 'mult'],
  'bomb pollen': ['bomb', 'mult'], 'buzz bomb pollen': ['buzzBomb', 'mult'], 'red bomb pollen': ['redBomb', 'mult'], 'blue bomb pollen': ['blueBomb', 'mult'], 'bomb power': ['bombPower', 'mult'],
  'bubble pollen': ['bubblePollen', 'mult'], 'flame pollen': ['flamePollen', 'mult'], 'flame duration': ['flameDuration', 'mult'],
  'tool pollen': ['tool', 'mult'],
  capacity: ['capacity', 'capacity'], 'capacity multiplier': ['capacityMul', 'mult'],
  'white field capacity': ['fieldCapacityWhite', 'fieldcap'], 'red field capacity': ['fieldCapacityRed', 'fieldcap'], 'blue field capacity': ['fieldCapacityBlue', 'fieldcap'],
  'convert rate': ['convertRate', 'mult'], 'convert rate at hive': ['convertRateHive', 'mult'], 'convert amount': ['convertAmount', 'flat'], 'bonus convert amount': ['convertAmount', 'flat'],
  'honey per pollen': ['honeyPerPollen', 'mult'], 'honey from tokens': ['honeyFromTokens', 'mult'], 'honey at hive': ['honeyAtHive', 'mult'],
  'instant conversion': ['instantConversion', 'chance'], 'instant white conversion': ['instantWhite', 'chance'], 'instant red conversion': ['instantRed', 'chance'],
  'instant blue conversion': ['instantBlue', 'chance'], 'instant bomb conversion': ['instantBomb', 'chance'],
  'critical chance': ['critChance', 'chance'], 'critical power': ['critPower', 'mult'], 'super-crit chance': ['superCritChance', 'chance'], 'super-crit power': ['superCritPower', 'mult'],
  'bee ability rate': ['abilityRate', 'mult'], 'bee movespeed': ['beeMovespeed', 'mult'], 'bee energy': ['energy', 'mult'],
  'instant gifted bee conversion': ['instantGifted', 'chance'], 'red bee convert rate': ['redBeeConvert', 'mult'], 'blue bee convert rate': ['blueBeeConvert', 'mult'], 'white bee convert rate': ['whiteBeeConvert', 'mult'],
  'movement collection': ['movementCollection', 'flat'],
  'event bee pollen': ['eventBeePollen', 'mult'], 'event bee ability pollen': ['eventBeePollen', 'mult'], 'mark ability pollen': ['markAbilityPollen', 'mult'],
  'instant flame conversion': ['instantFlame', 'chance'], 'instant bubble conversion': ['instantBubble', 'chance'],
  'movement collection pollen': ['movementPollen', 'mult'],
  'bee attack': ['beeAttack', 'flat'], 'red bee attack': ['redBeeAttack', 'flat'], 'blue bee attack': ['blueBeeAttack', 'flat'],
  'white bee attack': ['whiteBeeAttack', 'flat'], 'colorless bee attack': ['whiteBeeAttack', 'flat'],
  // слизь (goo): Goo — сколько слизи с пыльцы, Goo Conversion — мгновенно конвертирует столько пыльцы, сколько собрано слизи
  goo: ['goo', 'mult'], 'goo conversion': ['gooConversion', 'chance'], 'instant goo conversion': ['gooConversion', 'chance'], 'honey per goo': ['honeyPerGoo', 'mult'],
  'instant bee gather conversion': ['instantGather', 'chance'], 'instant tool conversion': ['instantTool', 'chance'], 'instant bee ability conversion': ['instantAbility', 'chance'],
};
// эти статы есть в игре, но на мёд и пыльцу в модели не влияют
const IGNORED = /ant field|hub field|loot luck|defense|attack|player movespeed|movespeed$|jump power|ticket|bond|mob|monster|lifespan|duplication|whirligig|planter|nectar|treat/i;

export const STAT_LABELS = {
  pollen: 'Pollen', white: 'White Pollen', red: 'Red Pollen', blue: 'Blue Pollen', beeGather: 'Bee Gather Pollen', abilityPollen: 'Bee Ability Pollen',
  giftedBeePollen: 'Gifted Bee Pollen', bomb: 'Bomb Pollen', buzzBomb: 'Buzz Bomb Pollen', redBomb: 'Red Bomb Pollen', blueBomb: 'Blue Bomb Pollen', bombPower: 'Bomb Power',
  bubblePollen: 'Bubble Pollen', flamePollen: 'Flame Pollen', flameDuration: 'Flame Duration', tool: 'Tool Pollen', capacity: 'Capacity', capacityMul: 'Capacity Multiplier',
  fieldCapacityWhite: 'White Field Capacity', fieldCapacityRed: 'Red Field Capacity', fieldCapacityBlue: 'Blue Field Capacity', convertRate: 'Convert Rate',
  convertRateHive: 'Convert Rate At Hive', convertAmount: 'Convert Amount', honeyPerPollen: 'Honey Per Pollen', honeyFromTokens: 'Honey From Tokens', honeyAtHive: 'Honey At Hive',
  instantConversion: 'Instant Conversion', instantWhite: 'Instant White Conversion', instantRed: 'Instant Red Conversion', instantBlue: 'Instant Blue Conversion',
  instantBomb: 'Instant Bomb Conversion', critChance: 'Critical Chance', critPower: 'Critical Power', superCritChance: 'Super-Crit Chance', superCritPower: 'Super-Crit Power',
  abilityRate: 'Bee Ability Rate', beeMovespeed: 'Bee Movespeed', energy: 'Bee Energy', toolPollenPerSec: 'Инструмент, пыльцы/с',
  instantGifted: 'Instant Gifted Bee Conversion', redBeeConvert: 'Red Bee Convert Rate', blueBeeConvert: 'Blue Bee Convert Rate', whiteBeeConvert: 'White Bee Convert Rate', movementCollection: 'Movement Collection',
  eventBeePollen: 'Event Bee Pollen', markAbilityPollen: 'Mark Ability Pollen', beeAttack: 'Bee Attack', redBeeAttack: 'Red Bee Attack',
  blueBeeAttack: 'Blue Bee Attack', whiteBeeAttack: 'Colorless Bee Attack', beeAttackMul: 'Bee Attack Multiplier', instantFlame: 'Instant Flame Conversion', instantBubble: 'Instant Bubble Conversion', instantGather: 'Instant Bee Gather Conversion', movementPollen: 'Movement Collection Pollen', instantTool: 'Instant Tool Conversion', instantAbility: 'Instant Bee Ability Conversion',
  goo: 'Goo', gooConversion: 'Goo Conversion', honeyPerGoo: 'Honey Per Goo',
};

/** Вид стата по ключу модели: mult (база 100%), chance (база 0%), flat (число), fieldcap, capacity. */
export function statKind(key) {
  if (key.startsWith('field:')) return 'mult';
  if (key === 'capacity' || key === 'toolPollenPerSec' || key === 'movementCollection') return 'flat';
  return Object.values(STATS).find(([k]) => k === key)?.[1] ?? 'mult';
}

/** "+25% Pollen" / "x1.5 Red Pollen"" / "+350,000 Capacity" / "+Passive: X" → { op, value, percent, stat } */
export function parseLine(text) {
  const t = String(text).replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  if (!t) return null;
  if (/^\+?\s*Passive:/i.test(t)) return { text: t, passive: t.replace(/^\+?\s*Passive:\s*/i, '') };
  const m = t.match(/^([+x×*\-])\s*([\d.,]+)\s*(%?)\s+(.+)$/i);
  if (!m) return { text: t };
  const value = Number(m[2].replace(/,/g, ''));
  return { text: t, op: /[x×*]/i.test(m[1]) ? 'mul' : 'add', value: m[1] === '-' ? -value : value, percent: !!m[3], stat: m[4].trim() };
}

/** Какой ключ модели у строки; для «<Поле> Pollen» — множитель пыльцы этого поля. */
function keyOf(stat, fieldNames) {
  const s = stat.toLowerCase().replace(/\s+/g, ' ').trim();
  if (STATS[s]) return { key: STATS[s][0], kind: STATS[s][1] };
  const fm = s.match(/^(.+?) pollen$/);
  if (fm) {
    const f = fieldNames.find((n) => n.toLowerCase() === fm[1] || n.toLowerCase().startsWith(`${fm[1]} `) || n.toLowerCase().replace(/ (field|patch|forest)$/, '') === fm[1].replace(/ (field|patch|forest)$/, ''));
    if (f) return { key: `field:${f}`, kind: 'mult', field: f };
  }
  return null;
}

/**
 * Строки баффа (data/buffs.json) при n стаках: «+» растёт на значение за стак (у желейных бобов — на perStack),
 * «x» — линейно, как Combo в игре: x(1 + (v − 1)·n).
 */
export function buffLines(def, n = 1) {
  const k = Math.max(1, Math.min(def.maxStacks || 1, Math.round(n) || 1));
  const r2 = (v) => Math.round(v * 1000) / 1000;
  return def.mods.map((m) => {
    const per = m.perStack ?? (m.op === 'mul' ? m.value - 1 : m.value);
    const v = m.op === 'mul' ? r2(m.value + per * (k - 1)) : r2(m.value + per * (k - 1));
    if (m.op === 'mul') return `x${v} ${m.stat}`;
    return `${v < 0 ? '' : '+'}${m.unit === '' ? v.toLocaleString('en-US') : v}${m.unit === '%' ? '%' : ''} ${m.stat}`;
  });
}

/**
 * Учитывает ли модель строку: 'used' — да, 'ignored' — стат есть в игре, но на мёд и пыльцу не влияет,
 * 'unknown' — не понятно, 'passive' — пассивка (+Passive: …), 'empty' — пусто.
 */
export function lineKind(text, fieldNames = []) {
  const line = parseLine(text);
  if (!line) return 'empty';
  if (line.passive) return 'passive';
  if (!line.op) return 'unknown';
  if (keyOf(line.stat, fieldNames)) return 'used';
  return IGNORED.test(line.stat) ? 'ignored' : 'unknown';
}

/**
 * @param data   { gear, fields }
 * @param setup  { tool, bag, hat, belt, boots, guardL, guardR,       // имена предметов
 *                 customTool: число пыльцы/с (если инструмента нет в списке),
 *                 badges: { [категория]: 'Cadet'|…|'Grandmaster' },
 *                 amulets: [{ name, lines: 'текст, строка на стат' }], extra: 'строки' }
 * @returns { player, breakdown, ignored, unknown, passives }
 */
export function playerFromSetup(data, setup = {}) {
  const gear = data.gear;
  const fieldNames = data.fields.map((f) => f.name);
  const lines = []; // { from, line }
  const add = (from, list) => { for (const l of list || []) if (l) lines.push({ from, line: l }); };
  const find = (list, name) => (name ? gear[list].find((x) => x.name === name) : null);

  let capacityBase = 0;
  let tool = null;
  for (const slot of SLOTS) {
    const item = find(slot.list, setup[slot.key]);
    if (!item) continue;
    if (slot.key === 'tool') tool = item;
    else if (slot.key === 'bag') { capacityBase = item.capacity || 0; add(item.name, item.stats); } else add(item.name, item.stats);
  }
  for (const [category, tier] of Object.entries(setup.badges || {})) {
    const b = gear.badges.find((x) => x.category === category);
    const t = b?.tiers.find((x) => x.tier === tier);
    if (t) add(`бейдж ${category} ${tier}`, t.stats);
  }
  for (const a of setup.amulets || []) add(a.name || 'амулет', String(a.lines || '').split(/\n|;/).map(parseLine));
  // баффы, которые держишь всё время фарма (вкладка «Баффы»): { имя: стаков }
  const forced = {};
  for (const [name, n] of Object.entries(setup.buffs || {})) {
    const def = data.buffs?.find((b) => b.name === name);
    if (!def || !(n > 0)) continue;
    // бафф, который модель считает сама (Red Boost, Focus, метки…): не строками, а «держу всегда» — модель возьмёт больше из двух
    if (def.modelKey) { (forced[def.modelKey] = Math.max(forced[def.modelKey] ?? 0, Math.min(def.maxStacks || 1, n))); continue; }
    add(`бафф ${name}${def.maxStacks > 1 ? ` ×${n}` : ''}`, buffLines(def, n).map(parseLine));
  }
  // постоянные баффы с квестов (код игры, Buffs/BuffDefs): стаки Combo — «+» умножается на стаки, «x» растёт линейно
  const science = Number(setup.scienceStacks) || 0; // Science Bear: +25% Convert Rate за стак (до 31)
  if (science > 0) add(`Science Enhancement ×${science}`, [parseLine(`+${25 * Math.min(31, science)}% Convert Rate`)]);
  const polar = Number(setup.polarPower) || 0; // Polar Bear: x1.05 энергии пчёл за стак → 1 + 0.05·стаки
  if (polar > 0) add(`Polar Power ×${polar}`, [parseLine(`x${(1 + 0.05 * polar).toFixed(4)} Bee Energy`)]);
  add('прочее', String(setup.extra || '').split(/\n|;/).map(parseLine));

  const adds = {};
  const muls = {};
  const sources = {};
  const ignored = [];
  const unknown = [];
  const passives = [];
  let capacityFlat = 0;
  for (const { from, line } of lines) {
    if (line.passive) { passives.push(`${from}: ${line.passive}`); continue; }
    if (!line.op) { unknown.push(`${from}: ${line.text}`); continue; }
    let k = keyOf(line.stat, fieldNames);
    if (k?.key === 'beeAttack' && (line.percent || line.op === 'mul')) k = { key: 'beeAttackMul', kind: 'mult' }; // «+15% Bee Attack» — множитель
    if (!k) { (IGNORED.test(line.stat) ? ignored : unknown).push(`${from}: ${line.text}`); continue; }
    if (k.kind === 'capacity') {
      // «+350,000 Capacity» — к объёму рюкзака; «+75% Capacity» и «x1.5 Capacity» — к множителю
      if (line.op === 'add' && !line.percent) { capacityFlat += line.value; (sources.capacity ??= []).push(`${from}: ${line.text}`); continue; }
      const key = 'capacityMul';
      (sources[key] ??= []).push(`${from}: ${line.text}`);
      if (line.op === 'mul') muls[key] = (muls[key] ?? 1) * line.value; else adds[key] = (adds[key] ?? 0) + line.value / 100;
      continue;
    }
    (sources[k.key] ??= []).push(`${from}: ${line.text}`);
    if (line.op === 'mul') muls[k.key] = (muls[k.key] ?? 1) * line.value;
    else adds[k.key] = (adds[k.key] ?? 0) + (line.percent ? line.value / 100 : line.value);
  }

  const player = { ...DEFAULT_PLAYER, fieldPollen: {}, mulParts: {} };
  const kindOf = statKind;
  for (const key of new Set([...Object.keys(adds), ...Object.keys(muls)])) {
    const kind = kindOf(key);
    if (key.startsWith('field:')) { player.fieldPollen[key.slice(6)] = (1 + (adds[key] ?? 0)) * (muls[key] ?? 1); continue; }
    if (muls[key] && muls[key] !== 1) player.mulParts[key] = muls[key]; // нужно, чтобы «+» улья встали до «x» снаряжения
    if (kind === 'fieldcap') { player[key] = (1 + (adds[key] ?? 0)) * (muls[key] ?? 1) - 1; continue; }
    const base = kind === 'chance' || kind === 'flat' ? 0 : key === 'critPower' || key === 'superCritPower' ? 2 : 1;
    player[key] = (base + (adds[key] ?? 0)) * (muls[key] ?? 1);
  }
  player.capacity = capacityBase + capacityFlat || DEFAULT_PLAYER.capacity;
  if (tool) {
    player.toolPollenPerSec = tool.pollenPerSec;
    player.toolWhite = tool.white; player.toolRed = tool.red; player.toolBlue = tool.blue;
  } else if (setup.customTool > 0) {
    player.toolPollenPerSec = Number(setup.customTool);
  }
  if (setup.tabbyStacks !== undefined && setup.tabbyStacks !== '') player.tabbyStacks = Number(setup.tabbyStacks);
  // пассивки снаряжения и амулетов: «+Passive: Pop Star» → считает модель (core/passives.js)
  player.passives = [...new Set(passives.map((x) => x.split(': ').slice(1).join(': ').trim()))];
  if (Object.keys(forced).length) player.forcedBuffs = forced; // «держу всегда» для баффов, которые считает модель
  // бафф Stinger «держу всегда» (30 с) — значит, Stinger используется раз в 30 с (нужно пассивке Star Saw)
  if (Number(setup.buffs?.Stinger) > 0) player.stingerEvery = 30;
  balloonBuffs(player, setup.buffs);
  player.passivesInStats = false;

  const breakdown = Object.keys(STAT_LABELS)
    .filter((k) => sources[k] || (k === 'capacity' && capacityBase) || (k === 'toolPollenPerSec' && player.toolPollenPerSec))
    .map((k) => ({ key: k, label: STAT_LABELS[k], value: player[k], sources: sources[k] ?? [] }));
  if (capacityBase) breakdown.find((b) => b.key === 'capacity')?.sources.unshift(`рюкзак: ${capacityBase.toLocaleString('ru')}`);
  for (const [f, v] of Object.entries(player.fieldPollen)) breakdown.push({ key: `field:${f}`, label: `${f} Pollen`, value: v, sources: sources[`field:${f}`] ?? [] });
  return { player, breakdown, ignored, unknown, passives };
}

/**
 * Balloon Aura / Balloon Blessing, отмеченные вручную, уже вошли в статы. Модель считает их сама от шариков улья
 * и заменяет ручные (balloonModel в model.js), поэтому запоминаем, сколько стаков в статах.
 */
function balloonBuffs(player, buffs) {
  const n = (k, max) => Math.min(max, Math.max(0, Number(buffs?.[k]) || 0));
  player.manualBalloonAura = n('Balloon Aura', 10);
  player.manualBalloonBlessing = n('Balloon Blessing', 100);
}

/**
 * Статы игрока из сохранённой настройки сайта (data/my-setup.json или state.setup):
 *   mode 'gear'   — считаем из снаряжения (бонусов улья там нет);
 *   mode 'manual' — цифры из ⚙️; если statsFromGame, вычитаем бонусы Gifted улья hive.
 */
export function playerFromMySetup(data, setup, hive) {
  if (!setup) return undefined;
  let player;
  if (setup.mode === 'manual') {
    player = { ...setup.manual };
    if (setup.statsFromGame && hive?.length) player = stripHiveBonuses(data, hive, player);
    // энергии в ⚙️ нет — Polar Power добавляем и в ручном режиме (Science уже входит в Convert Rate из ⚙️)
    const polar = Number(setup.polarPower) || 0;
    if (polar > 0) player.energy = (player.energy ?? 1) * (1 + 0.05 * polar);
    // в ручном режиме пассивки отмечают галочками; их постоянные бонусы (вместимость) уже есть в цифрах из ⚙️
    player.passives = setup.manualPassives || [];
    if (Number(setup.gear?.buffs?.Stinger) > 0) player.stingerEvery = 30;
    balloonBuffs(player, setup.gear?.buffs);
    player.passivesInStats = true;
  } else {
    player = playerFromSetup(data, { ...(setup.gear || {}), polarPower: setup.polarPower, scienceStacks: setup.scienceStacks }).player;
  }
  if (setup.tabbyStacks !== undefined && setup.tabbyStacks !== '' && setup.tabbyStacks !== null) player.tabbyStacks = Number(setup.tabbyStacks);
  if (setup.digitalDrives) player.digitalDrives = { ...setup.digitalDrives }; // драйвы Digital Bee (по умолчанию в модели — 500 каждого)
  return player;
}
