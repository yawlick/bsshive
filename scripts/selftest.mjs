#!/usr/bin/env node
// Быстрые проверки модели: node scripts/selftest.mjs (выход 1, если что-то сломано)
import { loadData } from '../core/data-node.js';
import fs from 'node:fs';
import { evaluate, comboStacks, refreshUptime, hiveStats, stripHiveBonuses, normalizeHive, beeStats, DEFAULT_PLAYER, CALIBRATION } from '../core/model.js';
import { playerFromSetup, buffLines } from '../core/gear.js';
import { optimize, nextSteps } from '../core/optimize.js';
import { bestLoadout, findLoadout, BEST_ID, BEST_AMULETS } from '../core/loadouts.js';
import { amuletDef, parseAmulet, amuletLines, emptyAmulet, modLine } from '../core/amulets.js';
import { findQuests, questPlan, questsPlan } from '../core/quests.js';
import { fitCalibration } from '../core/calibrate.js';
import { tokenRatesForBee } from '../core/spawnsim.js';

const d = loadData();
d.calibration = null; // проверяем модель «как по вики», без сохранённой подгонки
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };

check('данные: пчёлы', d.bees.length >= 40, `${d.bees.length}`);
check('данные: у всех пчёл есть сбор и конвертация', d.bees.every((b) => b.gather.amount > 0 && b.gather.time > 0 && b.convert.amount > 0 && b.convert.time > 0));
check('данные: поля', d.fields.length >= 15 && d.fields.every((f) => Math.abs(f.mix.white + f.mix.red + f.mix.blue - 1) < 1e-9));
check('данные: квесты', d.quests.length > 100);
check('comboStacks в пределах', comboStacks(0.01, 15, 10) < 0.5 && comboStacks(5, 15, 10) > 9.9 && comboStacks(0, 15, 10) === 0);
check('refreshUptime в пределах', refreshUptime(0, 30) === 0 && refreshUptime(10, 30) > 0.999);

const basic = evaluate(d, 'Basic Bee x10 L1', { field: 'Sunflower Field' });
check('10 Basic Bee: пыльца > 0', basic.pollenPerSec.total > 0, `${basic.pollenPerSec.total.toFixed(1)}/с`);
check('мёд не больше собранной пыльцы (без бонусов мёда)', basic.honeyPerHour <= basic.pollenPerHourEffective.total * 1.0001, `${Math.round(basic.honeyPerHour)} / ${Math.round(basic.pollenPerHourEffective.total)}`);
const red = evaluate(d, 'Rad Bee x10 L10', { field: 'Rose Field' });
const white = evaluate(d, 'Rad Bee x10 L10', { field: 'Spider Field' });
check('красные пчёлы на красном поле собирают больше, чем на белом (с поправкой на размер цветков)',
  red.pollenPerSec.total / d.fieldByName.get('Rose Field').avgSize > white.pollenPerSec.total / d.fieldByName.get('Spider Field').avgSize);
const g = evaluate(d, 'Gifted Basic Bee x10 L10', { field: 'Sunflower Field' });
const n = evaluate(d, 'Basic Bee x10 L10', { field: 'Sunflower Field' });
check('Gifted лучше обычных', g.pollenPerSec.total > n.pollenPerSec.total * 1.5);

const o = optimize(d, { slots: 15, level: 8, gifted: false, rarities: ['common', 'rare', 'epic'], goal: 'red', field: 'Rose Field' });
check('подбор: ровно 15 пчёл', o.hive.reduce((a, x) => a + x.count, 0) === 15, `${o.ms} мс`);
check('подбор: не хуже 15 Basic Bee', o.result.pollenPerHourEffective.red >= evaluate(d, 'Basic Bee x15 L8', { field: 'Rose Field' }).pollenPerHourEffective.red);
const q = findQuests(d, 'Trail Mix')[0];
const plan = q && questPlan(d, 'Basic Bee x20 L8', q);
check('план квеста считается', plan?.ok && plan.steps.length >= 2, plan ? `${Math.round(plan.seconds / 60)} мин` : 'нет квеста');

// симуляция токенов: без сна и с одним токеном частота ≈ 1 / (use + attempts) — сверка с ручным расчётом
const simple = tokenRatesForBee({ cycle: 5, gatherTime: 5, energy: null, downtime: 0, abilityRate: 1, tokens: [{ name: 'X', useCooldown: 10, tryCooldown: 5, success: 0.5 }] });
// после токена 10 с кулдауна, на 10-й секунде первая попытка, дальше каждые 5 с, шанс 0.5:
// в среднем 10 + 5·(1/0.5 − 1) = 15 с (формула вики)
check('симуляция токенов сходится с формулой вики', Math.abs(simple.X * 15 - 1) < 0.03, `${(1 / simple.X).toFixed(2)} с между токенами (ждём 15)`);

// калибровка: «замеры», сделанные моделью с известными коэффициентами, должны вернуть эти коэффициенты
const calHive = 'Gifted Rad Bee x6 L9, Rascal Bee x5 L9, Bomber Bee x4 L8, Bubble Bee x3 L8, Fire Bee x3 L8';
const truth = { gatherScale: 0.8, tokenScale: 1.3, convertScale: 1.5 };
const opts = { field: 'Clover Field', player: { capacity: 5e6 } };
const still = evaluate(d, calHive, { ...opts, calibration: { ...truth, tokenPickup: 0, bubblesPopped: 0 } }).bagPerSec * 300;
const withTok = evaluate(d, calHive, { ...opts, calibration: truth }).bagPerSec * 300;
const conv = evaluate(d, calHive, { ...opts, calibration: truth }).convertPerSec * 60;
const fit = fitCalibration(d, calHive, opts, { still: { minutes: 5, pollen: still }, tokens: { minutes: 5, pollen: withTok }, convert: { seconds: 60, pollen: conv } });
check('калибровка восстанавливает коэффициенты', Object.entries(truth).every(([k, v]) => Math.abs(fit.values[k] - v) < 0.01), JSON.stringify(Object.fromEntries(Object.entries(fit.values).map(([k, v]) => [k, Math.round(v * 1000) / 1000]))));

// снаряжение: (база + все «+») × все «x», плоская вместимость отдельно от множителя
d.gear = JSON.parse(fs.readFileSync(new URL('../data/gear.json', import.meta.url), 'utf8'));
const eq = playerFromSetup(d, { tool: 'Porcelain Dipper', bag: 'Porcelain Port-O-Hive', hat: 'Demon Mask', belt: 'Coconut Belt', badges: { Sunflower: 'Ace' }, amulets: [{ name: 'Star Amulet', lines: '+25% Pollen' }] });
check('снаряжение: множитель вместимости', Math.abs(eq.player.capacityMul - (1 + 0.75 + 0.3) * 1.5) < 1e-9, eq.player.capacityMul.toFixed(3));
check('снаряжение: вместимость рюкзака + плоские прибавки', eq.player.capacity === 600000 + 350000, String(eq.player.capacity));
check('снаряжение: Pollen = 100% + 25% (маска) + 25% (амулет)', Math.abs(eq.player.pollen - 1.5) < 1e-9, eq.player.pollen.toFixed(3));
check('снаряжение: инструмент', eq.player.toolPollenPerSec === 210 && eq.player.toolWhite === 1.5, `${eq.player.toolPollenPerSec}/с, белая ×${eq.player.toolWhite}`);
check('снаряжение: все строки поняты', eq.unknown.length === 0, eq.unknown.join('; '));
// статы «как в игре» → без бонусов улья → снова с бонусами = исходные
const hiveG = 'Gifted Rad Bee x5, Gifted Basic Bee, Gifted Bear Bee';
const shown = hiveStats(d, normalizeHive(d, hiveG), { pollen: 1.5, red: 1.3 }).stats;
const back = stripHiveBonuses(d, hiveG, { pollen: shown.pollen, red: shown.red });
check('вычитание бонусов улья обратимо', Math.abs(back.pollen - 1.5) < 1e-9 && Math.abs(back.red - 1.3) < 1e-9);

// код игры: сбор +5% за уровень (BeeStats.BonusesPerLevel), конвертация +10%
const st1 = beeStats(d.beeByName.get('Basic Bee'), 1, false, { ...DEFAULT_PLAYER }, CALIBRATION);
const st11 = beeStats(d.beeByName.get('Basic Bee'), 11, false, { ...DEFAULT_PLAYER }, CALIBRATION);
check('уровень: сбор +5%, конвертация +10% за уровень', Math.abs(st11.gather / st1.gather - 1.5) < 1e-9 && Math.abs(st11.convert / st1.convert - 2) < 1e-9);
// мутация Convert Amount ×1.2 — ровно +20% конвертации этой пчелы
const mPlain = evaluate(d, [{ name: 'Puppy Bee', count: 1, level: 9 }], { field: 'Sunflower Field' }).convertPerSec;
const mMut = evaluate(d, [{ name: 'Puppy Bee', count: 1, level: 9, mutation: { id: 'ConvRateMul', value: 1.2 } }], { field: 'Sunflower Field' }).convertPerSec;
check('мутация Convert Amount ×1.2', Math.abs(mMut / mPlain - 1.2) < 1e-9);
// пассивки: Pop Star увеличивает синюю пыльцу у синего улья, Guiding Star — вместимость ×1.25
const blueHive = 'Gifted Bubble Bee x10 L10, Gifted Cool Bee x5 L10, Gifted Bucko Bee x3 L10';
const noP = evaluate(d, blueHive, { field: 'Pine Tree Forest' });
const popP = evaluate(d, blueHive, { field: 'Pine Tree Forest', player: { passives: ['Pop Star'] } });
check('Pop Star: больше синей пыльцы', popP.pollenPerSec.blue > noP.pollenPerSec.blue * 1.2, `×${(popP.pollenPerSec.blue / noP.pollenPerSec.blue).toFixed(2)}`);
const gs = evaluate(d, blueHive, { field: 'Pine Tree Forest', player: { passives: ['Guiding Star'] } });
check('Guiding Star: вместимость ×1.25', Math.abs(gs.cycle.capacity / noP.cycle.capacity - 1.25) < 1e-9);

// несколько квестов + ограничения по пчёлам + «следующий шаг»
const bb = d.quests.filter((q) => q.giver === 'Black Bear' && !/Repeatable/.test(q.section)).slice(-3);
check('квесты Black Bear: цепочка из 75', d.quests.filter((q) => q.giver === 'Black Bear' && !/Repeatable/.test(q.section)).length === 75);
const lim = { 'Rad Bee': { max: 5, maxGifted: 1, level: 8 }, 'Cool Bee': { max: 5, maxGifted: 0, level: 8 }, 'Basic Bee': { max: 50, maxGifted: 0, level: 8 } };
const mq = optimize(d, { slots: 10, goal: { quests: bb }, limits: lim, timeLimitMs: 4000 });
const cnt = (n, gifted) => mq.hive.filter((g) => g.name === n && (gifted === undefined || g.gifted === gifted)).reduce((a, g) => a + g.count, 0);
check('ограничения: не больше max и maxGifted', cnt('Rad Bee') <= 5 && cnt('Rad Bee', true) <= 1 && cnt('Cool Bee', true) === 0 && mq.hive.every((g) => lim[g.name]), mq.hive.map((g) => `${g.count}${g.gifted ? '🌟' : ''} ${g.name}`).join(', '));
check('несколько квестов: план по каждому', mq.plan?.perQuest?.length === 3 && Math.abs(mq.plan.seconds - mq.plan.perQuest.reduce((a, p) => a + p.seconds, 0)) < 1e-6);
const seedHive = 'Basic Bee x10 L8';
const seeded = optimize(d, { slots: 10, goal: { quests: bb }, limits: lim, seed: seedHive, timeLimitMs: 4000 });
check('подбор не хуже стартового улья', -seeded.score <= questsPlan(d, seedHive, bb, {}).seconds + 1e-6);
const ns = nextSteps(d, seedHive, { goal: { quests: bb }, limits: lim, slots: 10, top: 3 });
check('следующий шаг: замены с выигрышем', ns.steps.length > 0 && ns.steps.every((x) => x.gain > 0 && x.add && lim[x.add.name]), ns.steps.map((x) => `${x.remove?.name}→${x.add.name}`).join(', '));
const ns5 = nextSteps(d, 'Basic Bee x10 L5', { goal: { quests: bb }, limits: lim, slots: 10, level: 12, top: 3 });
check('Royal Jelly оставляет уровень заменённой пчелы', ns5.steps.length > 0 && ns5.steps.every((x) => x.add.level === 5), ns5.steps.map((x) => `${x.add.name} L${x.add.level}`).join(', '));

// ивентовых каждого вида — не больше одной, даже если в лимитах «сколько угодно»
{
  const events = d.bees.filter((b) => b.rarity === 'event');
  const limits = Object.fromEntries(d.bees.map((b) => [b.name, { allow: true, max: 50, maxGifted: 50, level: 15 }]));
  const r = optimize(d, { slots: 50, goal: 'honey', field: 'Pine Tree Forest', limits, timeLimitMs: 3000 });
  const dup = r.hive.filter((g) => events.some((e) => e.name === g.name)).reduce((m, g) => m.set(g.name, (m.get(g.name) ?? 0) + g.count), new Map());
  const worst = Math.max(0, ...dup.values());
  check('подбор: каждой ивентовой пчелы не больше одной', worst <= 1, `ивентовых видов в улье: ${dup.size}`);
  const ns = nextSteps(d, r.hive, { goal: 'honey', field: 'Pine Tree Forest', limits, slots: 50, top: 50 });
  check('следующий шаг: не предлагает вторую такую же ивентовую', ns.steps.every((st) => !dup.has(st.add.name) || st.remove?.name === st.add.name));
}
// «лучший пока» в прогрессе подбора не уменьшается (второй заход от своего улья начинается ниже первого)
{
  const seen = [];
  optimize(d, { slots: 25, level: 10, goal: 'honey', field: 'Sunflower Field', seed: 'Basic Bee x25 L1', timeLimitMs: 2500, onProgress: (p) => { if (p.best !== null) seen.push(p.best); } });
  const drops = seen.filter((v, i) => i && v < seen[i - 1]).length;
  check('прогресс подбора: лучший вариант не уменьшается', drops === 0, `${seen.length} отметок`);
}
// встроенный лодаут «Лучшее»: все строки понятны, все бейджи Grandmaster
{
  const best = bestLoadout(d.gear);
  const r = playerFromSetup(d, best.setup.gear);
  check('лодаут «Лучшее»: все строки снаряжения и амулетов понятны', !r.unknown.length && best.setup.gear.amulets.length === 7, r.unknown.join('; '));
  check('лодаут «Лучшее»: все бейджи Grandmaster', Object.keys(best.setup.gear.badges).length === d.gear.badges.length);
  const f = { active: 'a', list: [{ id: BEST_ID, builtin: true }, { id: 'a', name: 'Основной', hive: [], setup: {} }] };
  check('лодауты: "my" — активный, по имени — нужный, встроенный строится сам', findLoadout(f, d.gear, 'my').id === 'a' && findLoadout(f, d.gear, 'лучшее').builtin && findLoadout(f, d.gear, 'Осн').id === 'a' && !findLoadout(f, d.gear, 'нет такого'));
}

// полный рюкзак: в игре сбор останавливается, поэтому больше пыльцы не может дать меньше мёда. Раньше улей на границе
// «рюкзак не наполняется» терял мёд от каждой лишней пыльцы (походы в улей) — и подбор набирал слабых сборщиков (16 Demo Bee)
{
  const gear = { ...bestLoadout(d.gear).setup.gear, hat: 'Demon Mask', polarPower: 1000, scienceStacks: 31, amulets: [
    { name: 'Star', lines: 'x2.5 Capacity\n+70% Blue Pollen\n+70% Red Pollen\n+20% Pollen\n+7% Critical Chance\n+7% Bee Ability Rate\n+Passive: Star Shower' },
    { name: 'Moon', lines: '+250,000 Capacity\n+50% White Pollen\n+8% Honey Per Pollen' },
    { name: 'Ant', lines: '+110% Convert Rate\n+50% Critical Power\n+3% Critical Chance\n+5% Pollen\n+30% White Pollen\n+30% Red Pollen' },
    { name: 'Stick Bug', lines: '+300,000 Capacity\nx1.25 Convert Rate\n+20% Tool Pollen\n+10% Pollen\n+100% Honey From Tokens' },
  ] };
  const p1 = { ...playerFromSetup(d, gear).player, tabbyStacks: 1000 };
  const hive = 'Gifted Demo Bee x16 L25, Gifted Shy Bee x10 L25, Gifted Diamond Bee x8 L25, Gifted Bear Bee L25, Gifted Demon Bee L25, Gifted Gummy Bee L25, Gifted Honey Bee L25, Gifted Photon Bee L25, Gifted Puppy Bee L25, Gifted Rad Bee L25, Gifted Spicy Bee L25, Gifted Tabby Bee L25, Gifted Vector Bee L25';
  let worst = Infinity;
  for (const k of [1, 1.2, 1.5, 2, 3]) {
    const a = evaluate(d, hive, { field: 'Pepper Patch', player: { ...p1, pollen: p1.pollen * k } }).honeyPerHour;
    const b = evaluate(d, hive, { field: 'Pepper Patch', player: { ...p1, pollen: p1.pollen * k * 1.2 } }).honeyPerHour;
    worst = Math.min(worst, b / a);
  }
  check('больше пыльцы — не меньше мёда (можно стоять на поле с полным рюкзаком)', worst >= 0.999, `худшее отношение ${worst.toFixed(3)}`);
}
// суперкрит: 100% мгновенная конвертация; Precise Bee даёт стаки Precision
{
  const base = { ...DEFAULT_PLAYER, critChance: 0.5, superCritPower: 1 }; // сила суперкрита 1 — пыльцы столько же, разница только в конвертации
  const a = evaluate(d, 'Gifted Rad Bee x20 L15', { field: 'Rose Field', player: { ...base, superCritChance: 0 } });
  const b = evaluate(d, 'Gifted Rad Bee x20 L15', { field: 'Rose Field', player: { ...base, superCritChance: 0.5 } });
  check('суперкрит конвертирует пыльцу мгновенно', b.honeyOnFieldPerSec > a.honeyOnFieldPerSec * 1.2, `${Math.round(a.honeyOnFieldPerSec)} → ${Math.round(b.honeyOnFieldPerSec)} мёда/с на поле`);
  // большой рюкзак: в улей почти не ходим, баффы не сгорают (проверяем только стаки)
  const pr = evaluate(d, 'Gifted Precise Bee x10 L15, Gifted Rad Bee x10 L15', { field: 'Rose Field', player: { ...DEFAULT_PLAYER, capacity: 1e12 } });
  check('Precise Bee: стаки Precision (+2% суперкрита)', pr.buffs.precision > 1, `${pr.buffs.precision}`);
  // маленький рюкзак: после каждого похода в улей баффы разгоняются заново — стаков меньше
  const small = evaluate(d, 'Gifted Precise Bee x10 L15, Gifted Rad Bee x10 L15', { field: 'Rose Field' });
  check('баффы сгорают за поход в улей и разгоняются заново', small.buffs.precision < pr.buffs.precision * 0.8, `${pr.buffs.precision} → ${small.buffs.precision}`);
}
// амулеты из кода игры: строки разбираются обратно без потерь, «Лучшее» и старые амулеты пользователя ложатся в диапазоны
{
  const A = JSON.parse(fs.readFileSync(new URL('../data/amulets.json', import.meta.url), 'utf8'));
  let bad = 0;
  for (const def of A.amulets) {
    const st = emptyAmulet(def);
    def.slots.filter((x) => x.kind === 'pool').forEach((pool, k) => { st.pools[k] = pool.options.slice(0, pool.select).map((o, i) => ({ i, value: o.min })); });
    const lines = amuletLines(def, st);
    const back = parseAmulet(def, lines);
    if (back.bad || amuletLines(def, back) !== lines) bad++;
  }
  check('амулеты: строки собираются и разбираются обратно', A.amulets.length >= 20 && !bad, `${A.amulets.length} амулетов, ошибок ${bad}`);
  check('амулеты «Лучшего» — в пределах игры', BEST_AMULETS.every((a) => !parseAmulet(amuletDef(A, a), a.lines).bad));
  const legacy = amuletDef(A, { name: 'Star Amulet', lines: 'x1.5 Capacity\n+24% Red Pollen\n+27% Blue Pollen\n+6% Instant Conversion' });
  check('амулеты: тир старого амулета определяется по строкам', legacy?.name === 'Silver Star Amulet', legacy?.name);
  const all = new Set(A.amulets.flatMap((def) => def.slots.flatMap((sl) => (sl.kind === 'pool' ? sl.options : [sl]).map((o) => modLine(o, o.max)))));
  const un = playerFromSetup(d, { extra: [...all].join('\n') }).unknown;
  check('амулеты: модель понимает все строки (или знает, что они не про мёд)', !un.length, un.join('; '));
}

// красный улей: мета (Spicy + Precise + Vector) должна обгонять «половину Diamond Bee» — Diamond раньше брались только потому,
// что модель не знала конвертацию Precise (выстрел по игроку), Flame Fuel, Inferno и Instant Flame Conversion у Demon Mask
{
  const gear = { ...bestLoadout(d.gear).setup.gear, hat: 'Demon Mask' };
  const player = { ...playerFromSetup(d, gear).player, tabbyStacks: 1000 };
  const H = (str) => str.split(', ').map((x) => { const [n, b] = x.split('×'); return `Gifted ${b} Bee x${n} L21`; }).join(', ');
  const meta = evaluate(d, H('13×Spicy, 9×Precise, 8×Vector, 5×Baby, 2×Music, 2×Shy, 1×Rage, 1×Rad, 1×Stubborn, 1×Bear, 1×Crimson, 1×Festive, 1×Tabby, 1×Photon, 1×Gummy, 1×Windy, 1×Puppy'), { field: 'Pepper Patch', player });
  const diam = evaluate(d, H('16×Diamond, 13×Precise, 5×Demon, 2×Baby, 2×Shy, 1×Basic, 1×Bear, 1×Commander, 1×Crimson, 1×Gummy, 1×Honey, 1×Looker, 1×Music, 1×Photon, 1×Rad, 1×Tabby, 1×Vector'), { field: 'Pepper Patch', player });
  check('красный мета-улей лучше улья с 16 Diamond Bee (Pepper Patch)', meta.honeyPerHour > diam.honeyPerHour * 1.3, `${(meta.honeyPerHour / 1e9).toFixed(0)} против ${(diam.honeyPerHour / 1e9).toFixed(0)} млрд/ч`);
  check('Spicy Bee: Inferno, Flame Fuel и Steam Engine считаются', !meta.notModeled.some((x) => /Inferno|Flame Fuel|Steam Engine/.test(x)) && meta.buffs.flameFuel > 0 && meta.bySource.some((x) => x.name === 'Inferno'));
}

// баффы «держу всё время» (data/buffs.json из кода игры): модель понимает их строки, стаки растут, бафф меняет статы
{
  const B = d.buffs || [];
  const un = B.flatMap((b) => playerFromSetup(d, { extra: buffLines(b, b.maxStacks).join('\n') }).unknown);
  check('баффы: все строки понятны модели', B.length >= 40 && !un.length, `${B.length} баффов${un.length ? `; не понял: ${un.join('; ')}` : ''}`);
  const bean = B.find((b) => b.name === 'Red Jelly Bean');
  check('баффы: стаки желейного боба (25% + 12.5% за стак)', bean && buffLines(bean, 3)[0] === '+50% Red Pollen', bean && buffLines(bean, 3)[0]);
  const a = playerFromSetup(d, {}).player;
  const b2 = playerFromSetup(d, { buffs: { 'Super Smoothie': 1 } }).player;
  check('баффы: Super Smoothie поднимает статы', b2.instantConversion > a.instantConversion && b2.capacityMul > a.capacityMul);
  const icons = JSON.parse(fs.readFileSync(new URL('../data/token-icons.json', import.meta.url), 'utf8'));
  const need = ['Red Boost', 'Red Bomb', 'Inferno', 'Target Practice', 'Scratch', 'Inspire', 'Focus', 'Baby Love'];
  check('иконки токенов из игры', need.every((n) => icons.tokens[n]?.icon), need.filter((n) => !icons.tokens[n]?.icon).join(', '));
}

// атака пчёл (BeeStats.GetAttack) усиливает выстрелы Target Practice: «+2 Red Bee Attack», «+15% Bee Attack» — не пустые строки
{
  const base = evaluate(d, 'Gifted Precise Bee x10 L20', { field: 'Rose Field' });
  const p = playerFromSetup(d, { extra: '+5 Red Bee Attack\n+50% Bee Attack' });
  const more = evaluate(d, 'Gifted Precise Bee x10 L20', { field: 'Rose Field', player: p.player });
  const tp = (r) => r.bySource.find((x) => x.name === 'Target Practice')?.pollenPerSec ?? 0;
  check('атака: выстрелы Target Practice растут от Bee Attack', !p.ignored.length && tp(more) > tp(base) * 1.5, `${Math.round(tp(base))} → ${Math.round(tp(more))}/с`);
}

console.log(failed ? `\n${failed} проверок не прошло` : '\nвсё ок');
process.exit(failed ? 1 : 0);
