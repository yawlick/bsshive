#!/usr/bin/env node
// MCP-сервер BSS Hive (Model Context Protocol, JSON-RPC 2.0 по stdio, одно сообщение на строку). Без npm-пакетов.
// Регистрация в Claude Code:
//   claude mcp add bsshive -s user -- node /path/to/bsshive/mcp/server.mjs
// В stdout — только протокол, логи — в stderr.
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadData, readCalibration, writeCalibration, resolveHiveArg, readMySetup, readMyHive, readLoadouts, loadoutOf, loadoutRef } from '../core/data-node.js';
import { findLoadout } from '../core/loadouts.js';
import { playerFromSetup, playerFromMySetup, SLOTS, buffLines } from '../core/gear.js';
import { fitCalibration } from '../core/calibrate.js';
import { evaluate, stripHiveBonuses, CALIBRATION, DEFAULT_PLAYER } from '../core/model.js';
import { optimize, compareFields, hiveToText, nextSteps, RARITIES } from '../core/optimize.js';
import { findQuests, questPlan } from '../core/quests.js';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const INFO = { name: 'bsshive', title: 'BSS Hive', version: '0.1.0' };
const INSTRUCTIONS = `BSS Hive: hive calculator for the Roblox game Bee Swarm Simulator (model spec: docs/MODEL.md in the project).
Data (bees, fields, ability-token cooldowns from the game, quests) comes from the BSS wiki; the model averages rates (no tick simulation).
Hives are text like "Gifted Rad Bee x5 L10, Basic Bee x10 L8" or arrays of {name, count, level, gifted}; "my" (or "мой улей") = the hive of the user's active loadout on the site.
Loadouts (bss_loadouts) are saved data packs on the site (hive + stats, e.g. one per Roblox account); "@Name" as hive or player picks loadout Name, e.g. hive "@Основной", player "@Лучшее". The built-in loadout "Лучшее" = best gear, all badges Grandmaster, max-roll best amulets, no hive.
player = the player's stats (1 = 100%); if they were copied from the in-game ⚙️ menu (which already includes the current hive's gifted bonuses) also pass statsFromGameHive = that hive. Keys: capacity, toolPollenPerSec, pollen, white, red, blue, critChance, critPower, convertRate, convertRateHive, honeyPerPollen, instantConversion, abilityRate, capacityMul, tabbyStacks…
Calibration from in-game measurements lives in data/calibration.json (written by the site or bss_calibrate) and is applied to every calculation automatically.
Quest requirements "defeat N mobs" are deliberately ignored (the user does not want them counted).
player "my" = the stats of the user's active loadout on the site (gear/badges/amulets/buffs kept up all the time → stats); setup.buffs = {name: stacks} adds consumable buffs (bss_gear slot "buffs": nectars, jelly beans, items, chick blessings); bss_gear lists equipment and badges; any tool also takes setup = {tool, bag, hat, belt, boots, guardL, guardR, badges: {category: tier}, amulets: [{name, lines}], extra} to compute stats from equipment.
Tools: bss_bees / bss_fields / bss_quests look things up; bss_evaluate scores a hive on a field; bss_compare_fields ranks fields for a hive; bss_optimize picks the best hive for honey, pollen, a color, or a quest; bss_quest_plan times a quest for a hive.
Any tool with a field also takes fieldBoostStacks (0–4): Field Boost stacks on that field (+100% pollen each; also boosts Target Practice/Star Shower/coconut/Flame Fuel conversion).
Answers carry notModeled/notes: abilities that are not modeled or only roughly estimated — mention them when they matter. Reply to the user in Russian.`;

const data = loadData();
const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1) }] });
const round = (n) => (Number.isFinite(n) ? Math.round(n) : n);
const hiveSchema = { description: 'Hive: text "Gifted Rad Bee x5 L10, Basic Bee x10" or [{name, count, level, gifted}]', oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'object' } }] };
const playerSchema = { description: `"my" = stats of the user's active loadout on the site (gear, badges, amulets or numbers from the game); "@Name" = loadout Name. Or an object of player stats without hive bonuses (1 = 100%). Defaults: ${JSON.stringify(DEFAULT_PLAYER)}`, oneOf: [{ type: 'string' }, { type: 'object' }] };
const fromGameSchema = { ...hiveSchema, description: 'If player stats were copied from the in-game ⚙️ menu, pass the hive the player had at that moment: its gifted hive bonuses are removed from the stats first (so they are not counted twice).' };
/**
 * Статы игрока для расчёта:
 *   player: "my"   — статы пользователя с сайта (data/my-setup.json: снаряжение/бейджи/амулеты или цифры из ⚙️);
 *   setup: {...}   — посчитать из снаряжения (tool, bag, hat, belt, boots, guardL, guardR, badges, amulets, extra);
 *   statsFromGameHive — цифры из ⚙️ уже с бонусами этого улья: вычесть их.
 */
function playerOf(args) {
  const p = playerOfBase(args);
  // стаки буста поля (Field Booster): +100% пыльцы поля за стак, до 4; модель ещё усиливает от них конвертацию
  const n = Math.min(4, Number(args.fieldBoostStacks) || 0);
  if (!(n > 0) || !args.field) return p;
  const field = data.fields.find((f) => f.name.toLowerCase().startsWith(String(args.field).toLowerCase()))?.name || args.field;
  const base = p || { ...DEFAULT_PLAYER };
  return { ...base, fieldPollen: { ...(base.fieldPollen || {}), [field]: (base.fieldPollen?.[field] ?? 1) + n }, fieldBoostStacks: { [field]: n } };
}
function playerOfBase(args) {
  const ref = args.player === 'my' || args.player === 'мои' ? 'my' : loadoutRef(args.player);
  if (ref !== null) {
    const l = loadoutOf(ref);
    if (!l) throw new Error(`Нет лодаута «${ref}». Список — bss_loadouts`);
    if (!l.setup) throw new Error('Пользователь ещё не вводил статы на сайте (нет data/my-setup.json)');
    return playerFromMySetup(data, l.setup, l.hive);
  }
  if (args.setup) return playerFromSetup(data, args.setup).player;
  return args.statsFromGameHive ? stripHiveBonuses(data, args.statsFromGameHive, args.player || {}) : args.player;
}
const calSchema = { type: 'object', description: `Calibration constants. Defaults: ${JSON.stringify(CALIBRATION)}` };

function summary(r) {
  return {
    field: r.field, bees: r.bees, canEnter: r.canEnter, beesRequired: r.beesRequired,
    honeyPerHour: round(r.honeyPerHour),
    pollenPerSecOnField: Object.fromEntries(Object.entries(r.pollenPerSec).map(([k, v]) => [k, round(v)])),
    pollenPerHourWithHiveTrips: Object.fromEntries(Object.entries(r.pollenPerHourEffective).map(([k, v]) => [k, round(v)])),
    cycle: { fillSeconds: round(r.cycle.fillSeconds), convertSeconds: round(r.cycle.convertSeconds), walkSeconds: r.cycle.walkSeconds, capacity: round(r.cycle.capacity) },
    bySource: r.bySource.map((s) => ({ name: s.name, pollenPerSec: round(s.pollenPerSec) })),
    perBee: r.perBee.map((b) => ({ bee: `${b.virtual ? `≈${b.count.toFixed(1)}` : b.count}× ${b.gifted ? 'Gifted ' : ''}${b.name} L${b.level}${b.virtual ? ` (временные, ${b.virtual})` : ''}`, share: `${(b.share * 100).toFixed(1)}%`, awake: `${(b.uptime * 100).toFixed(0)}%` })),
    buffs: r.buffs,
    multipliers: Object.fromEntries(Object.entries(r.multipliers).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    tokensPerMinute: Object.fromEntries(Object.entries(r.tokenRates).map(([k, v]) => [k, Math.round(v * 600) / 10])),
    hiveBonuses: r.hiveBonuses,
    notModeled: r.notModeled,
    notes: r.notes,
    notAffectingFieldHoney: r.irrelevant,
    goo: r.goo?.perSec > 0 ? { gooPerSec: round(r.goo.perSec), honeyPerSec: round(r.goo.honeyPerSec), coverShare: Math.round(r.goo.cover * 100) / 100, gummyMorphUptime: Math.round(r.goo.morph * 100) / 100 } : undefined,
  };
}

function pickQuest(args) {
  if (args.requirements) return { name: args.quest || 'custom', requirements: args.requirements };
  const found = findQuests(data, args.quest, args.giver);
  if (!found.length) throw new Error(`Квест не найден: ${args.quest}${args.giver ? ` (${args.giver})` : ''}. Используй bss_quests для поиска.`);
  return found[0];
}

const TOOLS = [
  {
    name: 'bss_bees',
    description: 'List bees with stats (color, rarity, energy, speed, gather, convert, abilities, gifted hive bonus). Filter by name/color/rarity.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, color: { enum: ['white', 'red', 'blue'] }, rarity: { enum: RARITIES } } },
    run: ({ name, color, rarity }) => {
      const n = (name || '').toLowerCase();
      const list = data.bees.filter((b) => (!n || b.name.toLowerCase().includes(n)) && (!color || b.color === color) && (!rarity || b.rarity === rarity));
      return text(list.map((b) => ({
        name: b.name, color: b.color, rarity: b.rarity, energy: b.energy, speed: b.speed, attack: b.attack,
        gather: `${b.gather.amount} / ${b.gather.time}s`, convert: `${b.convert.amount} / ${b.convert.time}s`,
        abilities: b.abilities.map((a) => `${a.giftedOnly ? '(gifted) ' : ''}${a.passive ? '(passive) ' : ''}${a.name}`),
        giftedHiveBonus: b.giftedBonus.text, ...(list.length <= 3 ? { extras: b.extras } : {}),
      })));
    },
  },
  {
    name: 'bss_loadouts',
    description: 'The user\'s loadouts from the site: saved data packs (hive + stats from gear/badges/amulets), e.g. one per Roblox account; which one is active ("my"). The built-in "Лучшее" (best gear, all Grandmaster badges, max-roll amulets) is read-only. With name: that loadout\'s hive, setup and computed stats. Use a loadout in other tools as hive "@Name" / player "@Name".',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'loadout name or id; "my" = active' } } },
    run: ({ name }) => {
      const file = readLoadouts();
      if (name) {
        const l = loadoutOf(name);
        if (!l) return text(`Нет лодаута «${name}».`);
        const computed = l.setup?.mode === 'manual' ? null : playerFromSetup(data, { ...(l.setup?.gear || {}), polarPower: l.setup?.polarPower, scienceStacks: l.setup?.scienceStacks });
        return text({ name: l.name, id: l.id, builtin: !!l.builtin, active: l.id === (file?.active ?? 'my'), hive: l.hive ? hiveToText(l.hive) : null, setup: l.setup,
          stats: computed ? computed.breakdown.map((b) => `${b.label}: ${Math.round(b.value * 1000) / 1000}`) : playerFromMySetup(data, l.setup, l.hive), unknownLines: computed?.unknown });
      }
      if (!file) return text('Лодаутов ещё нет: сайт не сохранял их (есть только «мой улей» и «мои статы» — hive/player "my").');
      return text(file.list.map((x) => {
        const l = findLoadout(file, data.gear, x.id);
        const bees = (l.hive || []).reduce((a, g) => a + g.count, 0);
        return { name: l.name, id: l.id, active: l.id === file.active, builtin: !!l.builtin, bees, stats: l.setup?.mode === 'manual' ? 'вручную из ⚙️' : [l.setup?.gear?.tool, l.setup?.gear?.bag, l.setup?.gear?.hat].filter(Boolean).join(', ') };
      }));
    },
  },
  {
    name: 'bss_gear',
    description: 'Equipment and badges from the wiki: tools (pollen/sec, color multipliers), bags (capacity), hats/masks, belts, boots, guards, badge tiers per category; amulets — from the game code: every tier (Bronze…Supreme), its fixed lines and "N lines out of this list" pools with value ranges. With mine=true also shows the setup of the user\'s active loadout and the stats computed from it (other loadouts: bss_loadouts).',
    inputSchema: { type: 'object', properties: { slot: { enum: ['tools', 'bags', 'hats', 'belts', 'boots', 'guards', 'amulets', 'badges', 'buffs'] }, name: { type: 'string' }, mine: { type: 'boolean' } } },
    run: ({ slot, name, mine }) => {
      if (mine) {
        const setup = readMySetup();
        if (!setup) return text('Пользователь ещё не вводил статы на сайте.');
        const computed = setup.mode === 'manual' ? null : playerFromSetup(data, setup.gear || {});
        return text({ setup, stats: computed ? computed.breakdown.map((b) => `${b.label}: ${Math.round(b.value * 1000) / 1000}`) : playerFromMySetup(data, setup, readMyHive()), unknownLines: computed?.unknown, notCounted: computed?.passives });
      }
      const n = (name || '').toLowerCase();
      const pick = (list) => list.filter((x) => !n || (x.name || x.category).toLowerCase().includes(n));
      const out = {};
      for (const k of slot ? [slot] : ['tools', 'bags', 'hats', 'belts', 'boots', 'guards', 'amulets', 'badges']) {
        if (k === 'amulets') { out[k] = amuletList(n); continue; }
        if (k === 'buffs') { out[k] = (data.buffs || []).filter((b) => !n || b.name.toLowerCase().includes(n)).map((b) => ({ name: b.name, group: b.groupRu, maxStacks: b.maxStacks, lines: buffLines(b, b.maxStacks) })); continue; }
        out[k] = pick(data.gear[k]).map((x) => (k === 'badges' ? { category: x.category, tiers: x.tiers.map((t) => `${t.tier}: ${t.stats.map((s) => s.text).join(', ')}`) }
          : k === 'tools' ? { name: x.name, pollenPerSec: x.pollenPerSec, colors: { white: x.white, red: x.red, blue: x.blue }, special: x.special }
            : { name: x.name, capacity: x.capacity, stats: x.stats?.map((s) => s.text) }));
      }
      return text(out);
    },
  },
  {
    name: 'bss_fields',
    description: 'List fields: flower colors (white/red/blue share), flower sizes, bees required to enter.',
    inputSchema: { type: 'object', properties: {} },
    run: () => text(data.fields.map((f) => ({ name: f.name, beesRequired: f.beesRequired, flowers: f.flowers, mix: Object.fromEntries(Object.entries(f.mix).map(([k, v]) => [k, Math.round(v * 100) / 100])), avgFlowerSize: Math.round(f.avgSize * 100) / 100 }))),
  },
  {
    name: 'bss_quests',
    description: 'Find quests by name and/or giver (e.g. giver "Polar Bear"). Returns requirements and rewards.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, giver: { type: 'string' }, limit: { type: 'number' } } },
    run: ({ query, giver, limit = 20 }) => {
      const list = findQuests(data, query, giver);
      return text({ found: list.length, quests: list.slice(0, limit).map((q) => ({ giver: q.giver, section: q.section, name: q.name, requirements: q.requirements.map((r) => r.text), reward: q.reward, royalJelly: q.rewards?.royalJelly, treats: q.rewards?.treats, rewardSource: q.rewards?.source, ...(q.wikiPollen ? { note: 'pollen requirements from game code (wiki differs)' } : {}) })) });
    },
  },
  {
    name: 'bss_evaluate',
    description: 'Score a hive on a field: honey/hour, pollen/sec by color, where pollen comes from, each bee\'s share, buffs, cycle times.',
    inputSchema: { type: 'object', properties: { hive: hiveSchema, field: { type: 'string' }, fieldBoostStacks: { type: 'number', description: 'Field Boost stacks on that field, 0–4' }, player: playerSchema, setup: { type: 'object', description: 'compute player stats from equipment instead of player' }, statsFromGameHive: fromGameSchema, calibration: calSchema }, required: ['hive'] },
    run: (args) => text(summary(evaluate(data, args.hive, { field: args.field, player: playerOf(args), calibration: args.calibration }))),
  },
  {
    name: 'bss_compare_fields',
    description: 'Rank all enterable fields for a hive by honey/hour (also pollen per color).',
    inputSchema: { type: 'object', properties: { hive: hiveSchema, player: playerSchema, setup: { type: 'object', description: 'compute player stats from equipment instead of player' }, statsFromGameHive: fromGameSchema, calibration: calSchema }, required: ['hive'] },
    run: (args) => text(compareFields(data, args.hive, { player: playerOf(args), calibration: args.calibration }).map((f) => ({
      field: f.field, honeyPerHour: round(f.honeyPerHour), pollenPerHour: Object.fromEntries(Object.entries(f.pollenPerHour).map(([k, v]) => [k, round(v)])),
    }))),
  },
  {
    name: 'bss_optimize',
    description: 'Find the best hive for a goal: "honey", "pollen", "red", "blue", "white", or a quest (pass quest name, optional giver). Greedy fill + swap search. Use fixed to keep bees the player already has and fill the remaining slots.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'honey | pollen | red | blue | white | quest | quests' },
        quest: { type: 'string', description: 'quest name when goal = quest' },
        quests: { type: 'array', items: { type: 'string' }, description: 'several quest names (goal = quests): minimize the total time' },
        lastQuests: { type: 'number', description: 'goal = quests: take the last N quests of giver\'s chain (default giver Black Bear)' },
        limits: { type: 'object', description: 'per bee: { "Frosty Bee": { allow: true, max: 8, maxGifted: 1, level: 8 } } — bees not listed are not used' },
        giver: { type: 'string' },
        field: { type: 'string', description: 'field to farm (for quests: default field for generic requirements)' },
        slots: { type: 'number' }, level: { type: 'number' }, gifted: { type: 'boolean' },
        fixed: hiveSchema,
        rarities: { type: 'array', items: { enum: RARITIES } },
        exclude: { type: 'array', items: { type: 'string' } },
        only: { type: 'array', items: { type: 'string' }, description: 'only these bee types may be added' },
        maxMythic: { type: 'number' },
        maxPerBee: { type: 'object', description: 'max copies per rarity, default {event: 1}' },
        player: playerSchema, setup: { type: 'object', description: 'compute player stats from equipment instead of player' }, statsFromGameHive: fromGameSchema, calibration: calSchema,
      },
    },
    run: (args) => {
      args = { ...args, player: playerOf(args) };
      let goal;
      if (args.lastQuests || args.quests?.length || args.goal === 'quests') {
        const giver = args.giver || 'Black Bear';
        const list = args.quests?.length
          ? args.quests.map((n) => { const f = findQuests(data, n, args.giver); if (!f.length) throw new Error(`Квест не найден: ${n}`); return f[0]; })
          : data.quests.filter((q) => q.giver === giver && !/Repeatable/i.test(q.section || '')).slice(-(args.lastQuests || 15));
        goal = { quests: list };
      } else goal = args.goal === 'quest' || (args.quest && !args.goal) ? { quest: pickQuest(args) } : (args.goal || 'honey');
      const r = optimize(data, { ...args, goal });
      return text({
        goal: typeof goal === 'object' ? `quests: ${(goal.quests || [goal.quest]).map((q) => q.name).join(', ')}` : goal,
        field: r.field,
        hive: hiveToText(r.hive),
        added: hiveToText(r.added),
        result: summary(r.result),
        questRewards: goal.quests ? { royalJelly: goal.quests.reduce((a, q) => a + (q.rewards?.royalJelly ?? 0), 0), treats: goal.quests.reduce((a, q) => a + (q.rewards?.treats ?? 0), 0) } : undefined,
        questPlan: r.plan ? { totalMinutes: Math.round(r.plan.seconds / 60), perQuest: r.plan.perQuest.map((p) => ({ quest: p.name, minutes: Math.round(p.seconds / 60), steps: p.steps.map((s) => `${s.field}: ${Math.round(s.seconds / 60)} min`), skipped: p.skipped })) } : undefined,
        searched: `${r.evals} hives in ${r.ms} ms`,
      });
    },
  },
  {
    name: 'bss_next_step',
    description: 'Best single bee swaps for a hive (what to replace first when changing one bee at a time with Royal Jelly). Same goal/quests/limits options as bss_optimize; gain = seconds saved for quests, otherwise honey or pollen per hour gained.',
    inputSchema: {
      type: 'object',
      properties: {
        hive: hiveSchema, goal: { type: 'string' }, quests: { type: 'array', items: { type: 'string' } }, lastQuests: { type: 'number' }, giver: { type: 'string' },
        field: { type: 'string' }, fieldBoostStacks: { type: 'number', description: 'Field Boost stacks on that field, 0–4' }, slots: { type: 'number' }, level: { type: 'number' }, limits: { type: 'object' }, top: { type: 'number' },
        player: playerSchema, setup: { type: 'object' }, statsFromGameHive: fromGameSchema, calibration: calSchema,
      },
      required: ['hive'],
    },
    run: (args) => {
      args = { ...args, player: playerOf(args) };
      let goal = args.goal || 'honey';
      if (args.lastQuests || args.quests?.length || args.goal === 'quests') {
        const giver = args.giver || 'Black Bear';
        goal = { quests: args.quests?.length ? args.quests.map((n) => findQuests(data, n, args.giver)[0]).filter(Boolean) : data.quests.filter((q) => q.giver === giver && !/Repeatable/i.test(q.section || '')).slice(-(args.lastQuests || 15)) };
      }
      const r = nextSteps(data, args.hive, { ...args, goal });
      const fmtGain = (g) => (r.quests ? `-${Math.round(g / 60)} min` : `+${Math.round(g).toLocaleString('en')}`);
      return text({
        base: r.quests ? `${Math.round(-r.base / 60)} min total` : Math.round(r.base),
        steps: r.steps.map((s) => `${s.remove ? `${s.remove.gifted ? 'Gifted ' : ''}${s.remove.name} L${s.remove.level}` : '(free slot)'} → ${s.add.gifted ? 'Gifted ' : ''}${s.add.name} L${s.add.level}: ${fmtGain(s.gain)}${s.jelly ? `, ~${Math.round(s.jelly)} Royal Jelly` : ''}`),
        ...(goal.quests ? { questsGiveRoyalJelly: goal.quests.reduce((a, q) => a + (q.rewards?.royalJelly ?? 0), 0) } : {}),
        note: 'Royal Jelly keeps the bee level; gifted status and mutation are lost.',
      });
    },
  },
  {
    name: 'bss_calibrate',
    description: 'Fit the model to in-game measurements for the user\'s hive on a field. still = stood on the field N minutes without collecting tokens or clicking (backpack pollen); tokens = same but collecting tokens and popping bubbles; convert = pollen converted at the hive in S seconds. save=true writes data/calibration.json (used by the site and all tools). Without measurements returns the current calibration.',
    inputSchema: {
      type: 'object',
      properties: {
        hive: hiveSchema, field: { type: 'string' }, fieldBoostStacks: { type: 'number', description: 'Field Boost stacks on that field, 0–4' }, player: playerSchema, setup: { type: 'object', description: 'compute player stats from equipment instead of player' }, statsFromGameHive: fromGameSchema,
        still: { type: 'object', properties: { minutes: { type: 'number' }, pollen: { type: 'number' } } },
        tokens: { type: 'object', properties: { minutes: { type: 'number' }, pollen: { type: 'number' } } },
        convert: { type: 'object', properties: { seconds: { type: 'number' }, pollen: { type: 'number' } } },
        save: { type: 'boolean' },
      },
    },
    run: (args) => {
      if (!args.hive || !(args.still || args.tokens || args.convert)) return text({ current: data.calibration ?? 'not calibrated (all scales = 1)' });
      const fit = fitCalibration(data, args.hive, { field: args.field, player: playerOf(args) }, { still: args.still, tokens: args.tokens, convert: args.convert });
      if (args.save && fit.ok) {
        writeCalibration({ values: fit.values, savedAt: new Date().toISOString(), field: args.field || '', hive: args.hive, measured: { still: args.still, tokens: args.tokens, convert: args.convert }, report: fit.report });
      }
      return text({ values: fit.values, report: fit.report, saved: !!(args.save && fit.ok) });
    },
  },
  {
    name: 'bss_quest_plan',
    description: 'How long a quest takes with a given hive, and on which fields. Pass quest name (+giver) or explicit requirements.',
    inputSchema: { type: 'object', properties: { hive: hiveSchema, quest: { type: 'string' }, giver: { type: 'string' }, requirements: { type: 'array', items: { type: 'object' } }, player: playerSchema, setup: { type: 'object', description: 'compute player stats from equipment instead of player' }, statsFromGameHive: fromGameSchema, calibration: calSchema }, required: ['hive'] },
    run: (args) => {
      const q = pickQuest(args);
      const plan = questPlan(data, args.hive, q, { player: playerOf(args), calibration: args.calibration });
      return text({ quest: q.name, giver: q.giver, minutes: Math.round(plan.seconds / 60), steps: plan.steps.map((s) => ({ field: s.field, minutes: Math.round(s.seconds / 6) / 10, for: s.for })), tokens: plan.tokenSteps, skipped: plan.skipped });
    },
  },
];

/** Амулеты из кода игры (data/amulets.json): обязательные строки и пулы «N из списка» с диапазонами. */
function amuletList(filter) {
  let A = null;
  try { A = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'amulets.json'), 'utf8')); } catch { return 'нет data/amulets.json — node scripts/build-amulets.mjs'; }
  const r = (o) => (o.passive ? `Passive: ${o.passive}` : `${o.unit === 'x' ? 'x' : '+'}${o.min === o.max ? o.min : `${o.min}…${o.max}`}${o.unit === '%' ? '%' : ''} ${o.stat}${o.chance ? ` (редко, ${o.chance * 100}%)` : ''}`);
  return A.amulets.filter((a) => !filter || a.name.toLowerCase().includes(filter)).map((a) => ({
    name: a.name,
    lines: a.slots.map((s) => (s.kind === 'fixed' ? r(s) : `${s.select}${s.maybeSelect ? ` (${s.maybeChance * 100}%: ${s.maybeSelect})` : ''} из: ${s.options.map(r).join(' | ')}${s.chance ? ` [весь пул — шанс ${s.chance * 100}%]` : ''}`)),
  }));
}

const toolList = TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
const byName = new Map(TOOLS.map((t) => [t.name, t]));
const write = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const reply = (id, result) => write({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params = {} } = msg;
  const isRequest = id !== undefined && id !== null;
  try {
    switch (method) {
      case 'initialize': {
        const asked = params.protocolVersion;
        return reply(id, { protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[1], capabilities: { tools: { listChanged: false } }, serverInfo: INFO, instructions: INSTRUCTIONS });
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return undefined;
      case 'ping': return reply(id, {});
      case 'tools/list': return reply(id, { tools: toolList });
      case 'tools/call': {
        const tool = byName.get(params.name);
        if (!tool) return fail(id, -32602, `Unknown tool ${params.name}`);
        data.calibration = readCalibration(); // сайт мог сохранить новую подгонку, пока сервер работал
        try {
          const args = { ...(params.arguments || {}) };
          for (const k of ['hive', 'fixed', 'statsFromGameHive']) if (args[k] !== undefined) args[k] = resolveHiveArg(args[k]);
          return reply(id, await tool.run(args));
        } catch (e) {
          return reply(id, { content: [{ type: 'text', text: e.message }], isError: true });
        }
      }
      case 'resources/list': return reply(id, { resources: [] });
      case 'prompts/list': return reply(id, { prompts: [] });
      default:
        if (isRequest) return fail(id, -32601, `Method not found: ${method}`);
        return undefined;
    }
  } catch (e) {
    if (isRequest) fail(id, e.code || -32603, e.message);
    else process.stderr.write(`bsshive mcp: ${e.stack || e}\n`);
    return undefined;
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { fail(null, -32700, 'Parse error'); return; }
  if (Array.isArray(msg)) msg.forEach(handle); else handle(msg);
});
rl.on('close', () => process.exit(0));
