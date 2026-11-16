// Модель улья Bee Swarm Simulator: сколько пыльцы и мёда в час даёт заданный улей на заданном поле.
// Считается средними значениями (матожиданием), без посекундной симуляции.
// Формулы статов — со страниц вики Stats / System Page; кулдауны токенов — из данных игры (Module:Ability Tokens/data).
import { EFFECTS, GATHER_PASSIVES, passivePollen, beeAttack } from './effects.js';
import { tokenRatesForBee } from './spawnsim.js';
import { passivesA, passivesB } from './passives.js';

export const COLORS = ['white', 'red', 'blue'];

/** Числа, которых нет на вики. Подгоняются замерами в игре. */
export const CALIBRATION = {
  flightStuds: 8, // сколько пчела в среднем летит от цветка к цветку
  restSeconds: 15, // отдых в улье, когда кончилась энергия (код игры: SleepTime = 15, у Shocked Bee 7.5)
  hiveTripStuds: 150, // сколько пчеле лететь от поля до улья и обратно (в одну сторону)
  flowerSizeForBees: true, // умножается ли сбор пчёл на размер цветка (x1/x2/x3)
  tokenPickup: 0.95, // какую долю токенов игрок успевает собрать (пользователь: 95%)
  markStand: 0.5, // какую долю времени метки игрок стоит внутри неё
  walkSeconds: 20, // игроку сходить с поля к улью и обратно
  fuzzBombsCaught: 0.6, // доля fuzz-бомб, которые игрок задевает
  beamFlowers: 4, // ГРУБО: цветков на луч Beamstorm
  triangleFlowers: 15, // ГРУБО: цветков в треугольнике Triangulate (игрок, пчела и токен обычно рядом)
  targetsHit: 0.7, // доля мишеней Target Practice, на которые игрок успевает
  heatRefill: 6, // ГРУБО: за сколько секунд Flame Heat снова разогревается до максимума после выстрела Target Practice по игроку
  preciseMarkShare: 0.4, // ГРУБО: доля Target Practice у Gifted Precise, когда игрок ставит Precise Mark (только дальняя мишень)
  targetStand: 0.7, // ГРУБО: доля Target Practice, когда игрок стоит на мишени в момент выстрела (конвертация рюкзака) — как targetsHit
  pulseBase: 10, // ГРУБО: пыльца с цветка на первом прыжке импульса
  pulseHopGrowth: 0.1, // ГРУБО: рост силы за прыжок
  // поправочные коэффициенты по замерам в игре (core/calibrate.js; 1 = без поправки)
  gatherScale: 1, // сбор пчёл и пламя (то, что идёт само, пока стоишь на поле)
  tokenScale: 1, // пыльца с токенов и пузырей (то, что надо собрать/лопнуть)
  convertScale: 1, // конвертация в улье
  bubblesPopped: 0.7, // доля пузырей, которые игрок (или что-то ещё) успевает лопнуть за 4 с
  tokenWait: 2, // сколько секунд токен в среднем лежит, пока игрок его не подберёт (для Token Link)
  starsCaught: 0.75, // доля падающих звёзд Star Shower, которые игрок ловит (пользователь: 75%)
  coconutsCaught: 0.6, // доля кокосов (Inspire Coconuts), которые игрок ловит
  petalHits: 1, // ГРУБО: сколько пчёл задевает один сюрикен Petal Storm
  fetchKicks: 6, // ГРУБО: сколько раз пинают мяч Fetch
  stepFlowers: 2, // ГРУБО: сколько цветков в секунду игрок проходит (для Movement Collection)
  flamesForMaxHeat: 8, // ГРУБО: сколько пламени рядом нужно, чтобы Flame Heat дошёл до x2 красной пыльцы
  // слизь (goo): мёд = пыльца с покрытых цветков · √(размер лужи / 200) · Goo (вики Goo); код FlowerGoo — на сервере, его нет
  gooLife: 10, // ГРУБО: сколько секунд лужа слизи живёт (в среднем, с учётом того, что она бледнеет)
  gooZone: 150, // ГРУБО: сколько цветков вокруг игрока, где собирают он и пчёлы (слизь там, где собирают)
  barrageFlowers: 120, // ГРУБО: сколько цветков покрывает один Gumdrop Barrage
  barragePuddle: 30, // ГРУБО: размер одной лужи Gumdrop Barrage, цветков
  trailFlowers: 3, // ГРУБО: Goo Trail — сколько новых цветков в слизи на каждый пройденный цветок (5 вокруг, перекрываются)
  trailPuddle: 25, // ГРУБО: размер лужи-следа Goo Trail, цветков
  frogHop: 1.5, // ГРУБО: раз в сколько секунд прыгает лягушка Summon Frog
  coatShare: 0.5, // ГРУБО: Fuzzy Coat опыляет «до 5 (9 у Gifted)» цветков за сбор — какую долю от этого в среднем
  fuzzPollinate: 5, // ГРУБО: сколько цветков опыляет один пойманный Fuzz Bomb («may pollinate nearby flowers»)
  balloonNear: 0.5, // ГРУБО: доля шариков Buoyant, которые висят над тем местом, где собирают игрок и пчёлы (Balloon Aura, пыльца в шарик)
  balloonHold: 900, // ГРУБО: сколько секунд копится шар в улье, пока его не сконвертируют (если в улей ходишь реже — больше)
  blessingPerDecade: 12.5, // ГРУБО: стаков Balloon Blessing за каждые x10 пыльцы в шаре улья (10 трлн = 100 стаков, вики)
  comboStacks: 10, // ГРУБО: стаков Coconut Combo (их набирают пинки комбо-кокоса, чаще — другими игроками)
};

/** Статы игрока БЕЗ бонусов улья (их модель добавит сама). 1 = 100%. */
export const DEFAULT_PLAYER = {
  capacity: 250000, // рюкзак
  toolPollenPerSec: 0, // сбор инструментом (пыльцы/с до множителей)
  pollen: 1, white: 1, red: 1, blue: 1,
  beeGather: 1, abilityPollen: 1,
  bomb: 1, buzzBomb: 1, redBomb: 1, blueBomb: 1, bombPower: 1,
  tool: 1, giftedBeePollen: 1, bubblePollen: 1, flamePollen: 1, flameDuration: 1,
  movementPollen: 1, // множитель пыльцы от ходьбы (Movement Collection Pollen)
  // атака пчёл (BeeStats.GetAttack): + Bee Attack (всем и своего цвета), × Bee Attack Multiplier. Нужна выстрелам Target Practice
  beeAttack: 0, redBeeAttack: 0, blueBeeAttack: 0, whiteBeeAttack: 0, beeAttackMul: 1,
  instantFlame: 0, instantBubble: 0, instantGather: 0, instantTool: 0, instantAbility: 0, // + сбора пчёл / инструмента / способностей (желейные бобы) // мгновенная конвертация пыльцы пламени / пузырей (Demon/Fire Mask: +50% Instant Flame Conversion)
  eventBeePollen: 1, markAbilityPollen: 1, // амулеты Cog: пыльца ивентовых пчёл, способностей-меток (Mark Surge)
  critChance: 0, critPower: 2, superCritChance: 0, superCritPower: 2,
  convertRate: 1, convertRateHive: 1, convertAmount: 0, honeyPerPollen: 1, honeyFromTokens: 1,
  instantConversion: 0, instantWhite: 0, instantRed: 0, instantBlue: 0, instantBomb: 0,
  abilityRate: 1, beeMovespeed: 1, energy: 1,
  capacityMul: 1, fieldCapacityWhite: 0, fieldCapacityRed: 0, fieldCapacityBlue: 0,
  tabbyStacks: 1000, // сколько Tabby Love у Tabby Bee (максимум 1000)
  toolWhite: 1, toolRed: 1, toolBlue: 1, // множители инструмента по цвету (Scythe x2 красной и т.п.)
  fieldPollen: {}, // { 'Coconut Field': 1.15 } — множители пыльцы конкретного поля (снаряжение)
  honeyAtHive: 1, // Honey At Hive (бейдж Dandelion и др.)
  instantGifted: 0, // Instant Gifted Bee Conversion (бейдж Hive Hub)
  redBeeConvert: 1, blueBeeConvert: 1, whiteBeeConvert: 1, // Red/Blue/White Bee Convert Rate (Port-O-Hive, нектары)
  movementCollection: 0, // Movement Collection (ботинки)
  goo: 1, gooConversion: 0, honeyPerGoo: 1, // слизь (Gummy Mask/Boots, Shell Amulet): сколько слизи с пыльцы, мгновенная конвертация слизью
  passives: [], // пассивки снаряжения и амулетов: ['Pop Star', 'Coin Scatter', …]
  passivesInStats: false, // true — постоянные бонусы пассивок уже входят в статы (цифры из ⚙️)
};

/** Мутации пчёл (data/mutations.json, из данных игры): «%» умножает итоговый стат пчелы, число прибавляется к базе. */
export const MUTATIONS = {
  GatherMul: 'Gather Amount ×', GatherAdd: 'Gather Amount +', ConvRateMul: 'Convert Amount ×', ConvRateAdd: 'Convert Amount +',
  Energy: 'Energy ×', Movespeed: 'Movespeed +', InstantConversion: 'Instant Conversion +', CriticalChance: 'Critical Chance +',
  AbilityRate: 'Ability Rate ×', AttackMul: 'Attack ×', AttackAdd: 'Attack +',
};

// "x1.2 pollen" и т.п. из бонусов Gifted → ключ стата
const BONUS_STAT = {
  pollen: 'pollen', 'white pollen': 'white', 'red pollen': 'red', 'blue pollen': 'blue',
  'bomb pollen': 'bomb', 'buzz bomb pollen': 'buzzBomb', 'red bomb pollen': 'redBomb', 'blue bomb pollen': 'blueBomb', 'bomb power': 'bombPower',
  capacity: 'capacityMul', 'white field capacity': 'fieldCapacityWhite', 'red field capacity': 'fieldCapacityRed', 'blue field capacity': 'fieldCapacityBlue',
  'tool pollen': 'tool', 'pollen from bee gathering': 'beeGather', 'bee ability pollen': 'abilityPollen', 'gifted bee pollen': 'giftedBeePollen',
  'instant conversion': 'instantConversion', 'instant white conversion': 'instantWhite', 'instant red conversion': 'instantRed', 'instant blue conversion': 'instantBlue', 'instant bomb conversion': 'instantBomb',
  'critical chance': 'critChance', 'critical power': 'critPower', 'super-crit chance': 'superCritChance',
  'convert rate': 'convertRate', 'convert rate at hive': 'convertRateHive', 'honey per pollen': 'honeyPerPollen', 'honey from tokens': 'honeyFromTokens',
  'bee movespeed': 'beeMovespeed', 'bubble pollen': 'bubblePollen', 'flame pollen': 'flamePollen', 'flame duration': 'flameDuration',
  goo: 'goo', 'goo conversion': 'gooConversion', 'honey per goo': 'honeyPerGoo',
  'bee attack': 'beeAttack', // +1 Bee Attack (Brave); «+10% Bee Attack» (Rage) — в beeAttackMul, см. ниже
};

/** Индексы для быстрого поиска (делается один раз на набор данных). */
export function prepare(data) {
  if (data._ready) return data;
  data.beeByName = new Map(data.bees.map((b) => [b.name, b]));
  data.fieldByName = new Map(data.fields.map((f) => [f.name, f]));
  for (const f of data.fields) {
    const sum = f.white + f.red + f.blue || 1;
    f.mix = { white: f.white / sum, red: f.red / sum, blue: f.blue / sum };
    const s = f.single + f.double + f.triple || 1;
    f.avgSize = (f.single * 1 + f.double * 2 + f.triple * 3) / s;
  }
  data._ready = true;
  return data;
}

/** Улей из строки "Basic Bee x10 L7, Gifted Rad Bee x5 L9" или массива групп → [{name,count,level,gifted}] */
export function normalizeHive(data, hive) {
  const groups = typeof hive === 'string' ? parseHiveText(hive) : hive;
  const out = [];
  for (const g of groups) {
    const name = resolveBeeName(data, g.name);
    if (!name) throw new Error(`Неизвестная пчела: ${g.name}`);
    const count = Math.max(0, Math.round(g.count ?? 1));
    if (!count) continue;
    const mutation = g.mutation && MUTATIONS[g.mutation.id] && Number.isFinite(Number(g.mutation.value)) ? { id: g.mutation.id, value: Number(g.mutation.value) } : null;
    out.push({ name, count, level: Math.max(1, Math.min(25, Number(g.level ?? 10))), gifted: !!g.gifted, ...(mutation ? { mutation } : {}) });
  }
  return out;
}

export function parseHiveText(text) {
  return text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).map((s) => {
    let gifted = false;
    let rest = s;
    if (/^(gifted|g|🌟)\s+/i.test(rest)) { gifted = true; rest = rest.replace(/^(gifted|g|🌟)\s+/i, ''); }
    let count = 1;
    let level = 10;
    rest = rest.replace(/\s+[x×*]\s*(\d+)|\s+(\d+)\s*[x×*]$/i, (_, a, b) => { count = Number(a || b); return ''; });
    rest = rest.replace(/^(\d+)\s*[x×*]?\s+/, (_, a) => { count = Number(a); return ''; });
    rest = rest.replace(/\s+(?:L|lvl|lv|ур\.?)\s*(\d+)/i, (_, a) => { level = Number(a); return ''; });
    // мутация: «M:ConvRateMul=1.1»
    let mutation = null;
    rest = rest.replace(/\s+(?:M|☢)[:\s]?([A-Za-z]+)=([\d.]+)/i, (_, id, v) => { mutation = { id, value: Number(v) }; return ''; });
    return { name: rest.trim(), count, level, gifted, ...(mutation ? { mutation } : {}) };
  });
}

export function resolveBeeName(data, name) {
  if (!name) return null;
  if (data.beeByName.has(name)) return name;
  const n = String(name).toLowerCase().replace(/\s*bee$/, '').trim();
  for (const b of data.bees) if (b.name.toLowerCase().replace(/\s*bee$/, '') === n) return b.name;
  for (const b of data.bees) if (b.name.toLowerCase().startsWith(n)) return b.name;
  return null;
}

export function resolveFieldName(data, name) {
  if (!name) return null;
  if (data.fieldByName.has(name)) return name;
  const n = String(name).toLowerCase();
  for (const f of data.fields) if (f.name.toLowerCase().startsWith(n) || f.name.toLowerCase().includes(n)) return f.name;
  return null;
}

/** Сумма бонусов Gifted-улья (каждый вид пчелы — один раз): прибавки, множители и их список текстом. */
export function hiveBonusTotals(data, groups) {
  const adds = {};
  const muls = {};
  const applied = [];
  const byKey = {}; // ключ стата → тексты бонусов («Gifted Cool Bee: x1.1 blue pollen»)
  const seen = new Set();
  for (const g of groups) {
    if (!g.gifted || seen.has(g.name)) continue;
    seen.add(g.name);
    for (const e of data.beeByName.get(g.name).giftedBonus.effects) {
      const key = e.stat === 'bee attack' && e.percent ? 'beeAttackMul' : BONUS_STAT[e.stat];
      if (!key) continue;
      if (e.op === 'mul') muls[key] = (muls[key] ?? 1) * e.value;
      else adds[key] = (adds[key] ?? 0) + e.value;
      const text = `${g.name}: ${e.op === 'mul' ? 'x' : '+'}${e.op === 'mul' ? e.value : e.percent ? `${Math.round(e.value * 100)}%` : e.value} ${e.stat}`;
      applied.push(text);
      (byKey[key] ??= []).push(`🌟 Gifted ${text}`);
    }
  }
  return { adds, muls, applied, byKey };
}

/** Статы игрока + бонусы Gifted-улья: (стат + прибавки) × множители. */
export function hiveStats(data, groups, player) {
  const s = { ...DEFAULT_PLAYER, ...player };
  const { adds, muls, applied } = hiveBonusTotals(data, groups);
  // «+» улья идут в ту же сумму, что и «+» снаряжения, — до умножения на его «x» (mulParts от playerFromSetup):
  // (база + все «+») × все «x» = итог_снаряжения + «+»улья × «x»снаряжения (сверено с Blue Field Capacity 175% в ⚙️)
  for (const [k, v] of Object.entries(adds)) s[k] += v * (s.mulParts?.[k] ?? 1);
  for (const [k, v] of Object.entries(muls)) s[k] *= v;
  return { stats: s, applied };
}

/**
 * Обратное к hiveStats: статы «как в игре» (в меню ⚙️ они уже с бонусами улья) → статы без бонусов этого улья.
 * Нужно, чтобы при подборе другого улья не посчитать бонусы своего улья дважды.
 */
export function stripHiveBonuses(data, hive, shown) {
  prepare(data);
  const { adds, muls } = hiveBonusTotals(data, normalizeHive(data, hive));
  const s = { ...shown };
  for (const [k, v] of Object.entries(muls)) if (s[k] !== undefined) s[k] /= v;
  for (const [k, v] of Object.entries(adds)) if (s[k] !== undefined) s[k] = Math.max(0, s[k] - v * (s.mulParts?.[k] ?? 1));
  return s;
}

/** Среднее число стаков баффа, который продлевается каждым новым токеном и сгорает целиком (тип Combo). */
export function comboStacks(rate, dur, max) {
  if (rate <= 0) return 0;
  const p = 1 - Math.exp(-rate * dur); // следующий токен успел до конца баффа
  if (p >= 0.999999) return max;
  const tau = p / rate; // среднее время в одном состоянии
  let weighted = 0;
  let time = 0;
  let pk = 1;
  for (let k = 1; k < max; k++) { weighted += k * pk * tau; time += pk * tau; pk *= p; }
  const tail = (pk * tau) / (1 - p);
  weighted += max * tail;
  time += tail;
  return weighted / (1 / rate + time);
}
/** Доля времени, когда бафф (не стакающийся, длительность dur) активен. */
export const refreshUptime = (rate, dur) => (rate <= 0 ? 0 : 1 - Math.exp(-rate * dur));

/** Грубая оценка без симуляции: среднее время между токенами, пока пчела собирает (для сверки со spawnsim.js). */
export function tokenInterval(token, stats, cycle) {
  const r = stats.abilityRate;
  const use = token.useCooldown / r;
  const tryCd = token.tryCooldown / r;
  const success = Math.min(1, token.success * r);
  const step = Math.max(tryCd, cycle); // попытки бывают, когда пчела останавливается у цветка
  return use + step * (1 / success - 1) + cycle / 2;
}

/** Статы одной пчелы с учётом уровня и Gifted. */
const MARK_KEYS = { pollenMark: 1, honeyMark: 1, preciseMark: 1 };
/** Пассивки пчёл, которые модель считает (остальные попадают в «не учитывается»). */
const MODELED_PASSIVES = new Set(['Shimmering Honey', 'Steam Engine', 'Gathering Flames', 'Gathering Flames+', 'Gathering Bubbles', 'Gathering Bubbles+', 'Drive Expansion']);
/** Пассивки пчёл, которые на мёд с поля не влияют (код игры, BeeTypes). */
const IRRELEVANT_PASSIVES = { Sniper: 'только в бою (выстрелы по мобам)', 'Nectar Lover': 'только нектар из плантеров' };
/** Steam Engine: с Flame Heat (heat 0…1) пчела собирает и летает быстрее, до +100% — цикл короче, энергия тратится быстрее. */
function steamBoost(st, heat) {
  const k = 1 + Math.max(0, Math.min(1, heat));
  const cycle = st.cycle / k;
  let uptime = st.uptime;
  if (st.energy) { const active = Math.ceil(st.energy) * cycle; uptime = active / (active + st.downtime); }
  return { ...st, cycle, uptime, speed: st.speed * k };
}

/** Драйвы Digital Bee из статов игрока (digitalDrives: { red, blue, white, glitched }), по умолчанию — 500 каждого. */
export function digitalDrives(stats) {
  const d = stats.digitalDrives || {};
  const v = (k) => Math.max(0, Math.min(500, Number(d[k] ?? 500) || 0));
  const out = { red: v('red'), blue: v('blue'), white: v('white'), glitched: v('glitched') };
  out.full = out.red + out.blue + out.white + out.glitched >= 2000;
  return out;
}

export function beeStats(bee, level, gifted, stats, cal, mutation = null) {
  // код игры (BeeStats.BonusesPerLevel): сбор +5% за уровень, конвертация +10%, энергия +5%, скорость +3%
  const lvGather = 1 + 0.05 * (level - 1);
  const lv = 1 + 0.1 * (level - 1);
  const gm = gifted ? 1.5 : 1;
  const tabby = bee.name === 'Tabby Bee' ? 1 + stats.tabbyStacks / 100 : 1;
  const mut = (id, dflt) => (mutation?.id === id ? mutation.value : dflt);
  // как в игре (BeeTypes.GetLvlSummary, сверено с Gather Total в ⚙️): база × уровень округляется до целого, потом Gifted и Tabby Love
  // Digital Bee: драйвы (Drive Expansion в коде игры) — за каждый White +0.25 сбора, Blue +2 Convert Amount, Red +0.03 атаки,
  // Glitched +0.05% Ability Rate, до 500 каждого; все 2000 — ещё +10 скорости. По умолчанию — полная (500 каждого)
  const dv = bee.name === 'Digital Bee' ? digitalDrives(stats) : null;
  const gather = Math.floor((bee.gather.amount + mut('GatherAdd', 0) + (dv ? 0.25 * dv.white : 0)) * lvGather + 0.5) * gm * tabby * mut('GatherMul', 1);
  const speed = (bee.speed + mut('Movespeed', 0) + (dv?.full ? 10 : 0)) * (1 + 0.03 * (level - 1)) * stats.beeMovespeed;
  const cycle = bee.gather.time + cal.flightStuds / speed;
  let uptime = 1;
  let energy = null;
  let downtime = 0;
  if (!bee.noSleep && bee.energy) {
    energy = bee.energy * (1 + 0.05 * (level - 1)) * stats.energy * mut('Energy', 1);
    const active = Math.ceil(energy) * cycle;
    const rest = bee.sleepTime ? (bee.sleepTime / 15) * cal.restSeconds : cal.restSeconds; // у Shocked Bee отдых вдвое короче
    downtime = rest + cal.hiveTripStuds / (0.5 * speed) + cal.hiveTripStuds / (1.5 * speed);
    uptime = active / (active + downtime);
  }
  const colorConvert = bee.color === 'red' ? stats.redBeeConvert : bee.color === 'blue' ? stats.blueBeeConvert : stats.whiteBeeConvert;
  let convert = ((bee.convert.amount * tabby + (dv ? 2 * dv.blue : 0) + stats.convertAmount + mut('ConvRateAdd', 0)) * lv * gm * stats.convertRate * colorConvert * mut('ConvRateMul', 1)) / bee.convert.time;
  let convertHoney = convert;
  if (bee.name === 'Diamond Bee') convertHoney *= 1 + (0.25 + 0.025 * level) * (gifted ? 2 : 1); // Shimmering Honey
  return {
    gather, speed, cycle, uptime, energy, downtime, convert, convertHoney,
    abilityRate: mut('AbilityRate', 1) * (dv ? 1 + 0.0005 * dv.glitched : 1),
    instantConversion: (gifted && bee.giftedInstantConversion !== undefined ? bee.giftedInstantConversion : bee.instantConversion) + mut('InstantConversion', 0),
    critChance: mut('CriticalChance', 0),
  };
}

/**
 * Главный расчёт.
 * @param data   { bees, tokens, fields } из data/*.json
 * @param hive   строка или [{name, count, level, gifted}]
 * @param opts   { field, player, calibration }
 */
/**
 * Часть расчёта, которая не зависит от поля: статы пчёл, частота токенов, баффы, множители.
 * Для одного и того же улья (тот же объект hive, статы и калибровка) кэшируется — квестам нужно ~20 полей подряд.
 */
const coreCache = new WeakMap();
function hiveCore(data, hive, opts) {
  if (hive && typeof hive === 'object') {
    let list = coreCache.get(hive);
    if (!list) { list = []; coreCache.set(hive, list); }
    if (opts.buffRamp) return hiveCoreCompute(data, hive, opts); // второй проход (разгон баффов) — не кэшируем
    for (const e of list) if (e.player === opts.player && e.calibration === opts.calibration && e.dataCal === data.calibration) return e.core;
    const core = hiveCoreCompute(data, hive, opts);
    list.push({ player: opts.player, calibration: opts.calibration, dataCal: data.calibration, core });
    if (list.length > 4) list.shift();
    return core;
  }
  return hiveCoreCompute(data, hive, opts);
}
function hiveCoreCompute(data, hive, opts) {
  prepare(data);
  // калибровка: значения по умолчанию ← сохранённая подгонка (data/calibration.json) ← переданные в вызов
  const cal = { ...CALIBRATION, ...data.calibration?.values, ...opts.calibration };
  const groups = normalizeHive(data, hive);
  const hs = hiveStats(data, groups, opts.player);
  let stats = hs.stats;
  const applied = hs.applied;
  const totalBees = groups.reduce((a, g) => a + g.count, 0);
  const notes = new Set();
  const notModeled = new Map();
  const irrelevant = new Map(); // есть в улье/снаряжении, но на мёд с поля не влияет (бой, плантеры…)

  // 1) пчёлы: сбор и токены. heat — разогрев Flame Heat (0…1) для Steam Engine (Spicy Bee): сбор и скорость до +100%
  const steamGroups = groups.some((g) => data.beeByName.get(g.name).abilities.some((a) => a.passive && a.name === 'Steam Engine'));
  const makeGroup = (g, heat) => {
    const bee = data.beeByName.get(g.name);
    let st = beeStats(bee, g.level, g.gifted, stats, cal, g.mutation);
    if (heat > 0 && bee.abilities.some((a) => a.passive && a.name === 'Steam Engine')) st = steamBoost(st, heat);
    const tokens = [];
    const abilityList = bee.abilities.filter((a) => !a.passive && (!a.giftedOnly || g.gifted)).map((a) => a.name);
    if (g.gifted) abilityList.push('Inspire');
    const gatherTokens = [];
    for (const name of abilityList) {
      const t = data.tokens[name];
      if (!t) { notModeled.set(name, 'нет данных о токене'); continue; }
      if (t.contexts.includes('Gather')) gatherTokens.push({ name, ...t });
    }
    // частота токенов — симуляцией по правилам игры (пул, кулдауны, сон); считаем для всех токенов
    // (нужна квестам «собери N токенов»), а эффект — только для описанных в effects.js
    const rates = tokenRatesForBee({ cycle: st.cycle, gatherTime: bee.gather.time, energy: st.energy, downtime: st.downtime, abilityRate: stats.abilityRate * st.abilityRate, tokens: gatherTokens });
    for (const t of gatherTokens) {
      const eff = EFFECTS[t.name];
      const e = eff && eff.kind !== 'none' ? eff : { kind: 'none' };
      if (!eff) notModeled.set(t.name, 'эффект не описан');
      else if (eff.kind === 'none' && eff.irrelevant) irrelevant.set(t.name, eff.note);
      else if (eff.kind === 'none') notModeled.set(t.name, eff.note);
      else if (eff.note) notes.add(`${t.name}: ${eff.note}`);
      tokens.push({ name: t.name, token: data.tokens[t.name], eff: e, rate: rates[t.name] * g.count * cal.tokenPickup });
    }
    for (const a of bee.abilities) {
      if (!a.passive || !a.name || MODELED_PASSIVES.has(a.name)) continue;
      if (IRRELEVANT_PASSIVES[a.name]) irrelevant.set(`${a.name} (пассивка)`, IRRELEVANT_PASSIVES[a.name]);
      else notModeled.set(`${a.name} (пассивка)`, 'пока нет');
    }
    // пузыри / пламя: шанс на каждый сбор цветка
    // шанс пузыря/пламени на каждый сбор — из кода игры (bee.bubbleChance / flameChance: [обычная, Gifted]), иначе таблица из вики
    const gp = bee.bubbleChance?.[0] > 0 ? { kind: 'bubble', chance: bee.bubbleChance } : bee.flameChance?.[0] > 0 ? { kind: 'flame', chance: bee.flameChance } : GATHER_PASSIVES[g.name];
    const passive = gp ? { kind: gp.kind, rate: (gp.chance[g.gifted ? 1 : 0] / st.cycle) * st.uptime * g.count } : null;
    const inferno = tokens.find((t) => t.name === 'Inferno');
    // Inferno: кольцо из 6 пламён на каждый токен
    const ringFlames = inferno ? inferno.rate * 6 : 0;
    return { ...g, bee, st, tokens, passive, ringFlames };
  };
  /**
   * Inferno (Spicy Bee): 2 временные Fire Bee на 15 с (+1 с за уровень), уровень на 2 ниже; у Gifted Spicy каждая
   * Gifted с шансом 10% (+1% за уровень). В среднем на поле их «токенов в секунду × 2 × длительность».
   * Они собирают и зажигают пламя (Gathering Flames), но в улей не летают — в конвертацию в улье не входят.
   */
  const fireBeesOf = (pg) => {
    const fire = data.beeByName.get('Fire Bee');
    const out = [];
    for (const g of pg) {
      const t = g.tokens.find((x) => x.name === 'Inferno');
      if (!t || !fire) continue;
      const n = t.rate * 2 * (15 + g.level);
      const lvl = Math.max(1, g.level - 2);
      const pg2 = g.gifted ? Math.min(1, 0.1 + 0.01 * g.level) : 0;
      for (const [gifted, count] of [[true, n * pg2], [false, n * (1 - pg2)]]) {
        if (!(count > 0)) continue;
        const st = { ...beeStats(fire, lvl, gifted, stats, cal), uptime: 1 };
        const chance = fire.flameChance?.[gifted ? 1 : 0] ?? GATHER_PASSIVES['Fire Bee'].chance[gifted ? 1 : 0];
        // их способности (Red Bomb+) — по тем же правилам, что у постоянной пчелы
        const ft = fire.abilities.filter((a) => !a.passive && (!a.giftedOnly || gifted)).map((a) => ({ name: a.name, ...data.tokens[a.name] })).filter((x) => x.contexts?.includes('Gather') && EFFECTS[x.name]?.kind === 'pollen');
        const fr = ft.length ? tokenRatesForBee({ cycle: st.cycle, gatherTime: fire.gather.time, energy: null, downtime: 0, abilityRate: stats.abilityRate * st.abilityRate, tokens: ft }) : {};
        const tokens = ft.map((x) => ({ name: x.name, token: data.tokens[x.name], eff: EFFECTS[x.name], rate: fr[x.name] * count * cal.tokenPickup }));
        out.push({ name: 'Fire Bee', count, level: lvl, gifted, bee: fire, st, tokens, passive: { kind: 'flame', rate: (chance / st.cycle) * count }, ringFlames: 0, virtual: 'Inferno' });
      }
    }
    return out;
  };
  // Flame Fuel (Gifted Spicy): 15 с пламя горит на 50% дольше и при появлении конвертирует пыльцу (это — в evaluate)
  const fuelOf = (pg) => refreshUptime(pg.reduce((a, g) => a + g.tokens.filter((t) => t.name === 'Flame Fuel').reduce((x, t) => x + t.rate, 0), 0), 15);
  const flamesOf = (pg, extra, flameDur) => [...pg, ...extra].reduce((a, g) => a + ((g.passive?.kind === 'flame' ? g.passive.rate : 0) + (g.ringFlames || 0)) * 4 * flameDur, 0);
  const heatOf = (flames) => (flames > 0 ? 0.2 + 0.8 * Math.min(1, flames / cal.flamesForMaxHeat) : 0);
  // Target Practice: выстрел по игроку на мишени съедает Flame Heat (код игры). Выстрел раз в T с, разогрев с нуля — за
  // cal.heatRefill с: средний разогрев heatAvg (доля от полного), к выстрелу успевает накопиться heatAtShot
  const heatUse = (pg) => {
    const shots = pg.reduce((a, g) => a + g.tokens.filter((t) => t.name === 'Target Practice').reduce((x, t) => x + t.rate, 0), 0) * cal.targetStand;
    if (!(shots > 0)) return { avg: 1, atShot: 1, period: Infinity };
    const T = 1 / shots;
    const Rf = cal.heatRefill;
    return { avg: T >= Rf ? 1 - Rf / (2 * T) : T / (2 * Rf), atShot: Math.min(1, T / Rf), period: T };
  };
  let perGroup = groups.map((g) => makeGroup(g, 0));
  const forced = stats.forcedBuffs || {}; // баффы «держу всегда» с вкладки «Баффы»: модель берёт больше из своего и этого
  let fuelUptime = Math.max(fuelOf(perGroup), forced.flameFuel ? 1 : 0);
  let fireBees = fireBeesOf(perGroup);
  if (steamGroups) {
    // второй проход: Steam Engine зависит от Flame Heat, а тот — от пламени, которое даёт улей
    const heat0 = heatOf(flamesOf(perGroup, fireBees, stats.flameDuration * (1 + 0.5 * fuelUptime))) * heatUse(perGroup).avg;
    perGroup = groups.map((g) => makeGroup(g, heat0));
    fuelUptime = Math.max(fuelOf(perGroup), forced.flameFuel ? 1 : 0);
    fireBees = fireBeesOf(perGroup);
  }
  if (fuelUptime > 0) stats = { ...stats, flameDuration: stats.flameDuration * (1 + 0.5 * fuelUptime) };

  // 2) пассивки снаряжения, шаг A: частота токенов по видам → постоянные бонусы, Pop/Scorching Star, лишний Inspire
  const R = { boost: 0, mark: 0, bomb: 0, blueAbility: 0, redAbility: 0, battle: 0, haste: 0, focus: 0, inspire: 0, bubbles: 0 };
  for (const g of perGroup) {
    for (const t of g.tokens) {
      const tags = t.token.tags || [];
      if (/Boost$/.test(t.name)) R.boost += t.rate;
      if (tags.includes('Mark')) R.mark += t.rate;
      if (tags.includes('Bomb')) R.bomb += t.rate;
      if (tags.includes('Blue Ability')) R.blueAbility += t.rate;
      if (tags.includes('Red Ability')) R.redAbility += t.rate;
      if (t.token.contexts.includes('Battle')) R.battle += t.rate;
      if (t.name === 'Haste') R.haste += t.rate;
      if (t.name === 'Focus') R.focus += t.rate;
      if (t.name === 'Inspire') R.inspire += t.rate;
      // токены, которые появляются из другого токена (мишени Target Practice → Focus / Red Boost)
      for (const [name, n] of Object.entries(t.eff.spawns?.(cal, g.gifted) || {})) {
        const r = t.rate * n * cal.tokenPickup;
        if (/Boost$/.test(name)) R.boost += r;
        if (name === 'Focus') R.focus += r;
      }
    }
    if (g.passive?.kind === 'bubble') R.bubbles += g.passive.rate * cal.bubblesPopped;
    for (const t of g.tokens) if (t.eff.kind === 'frog') R.bubbles += t.rate * t.eff.bubbles({ level: g.level, cal }) * cal.bubblesPopped;
  }
  const flamesActive = flamesOf(perGroup, fireBees, stats.flameDuration);
  const PA = passivesA(stats.passives, R, { permanent: !stats.passivesInStats, flamesActive, cal, stingerEvery: stats.stingerEvery });
  for (const s of PA.skipped) notModeled.set(s.split(':')[0], s.split(':').slice(1).join(':').trim());
  for (const s of PA.irrelevant) irrelevant.set(s.split(':')[0], s.split(':').slice(1).join(':').trim());
  // Combo Coconuts: бафф Coconut Combo — +% цветной пыльцы, Honey From Tokens и Bee Attack Multiplier (остальное — ниже)
  const combo = PA.combo;
  if (combo) {
    const a = combo.uptime * combo.colorAdd;
    stats = { ...stats, white: stats.white + a, red: stats.red + a, blue: stats.blue + a, honeyFromTokens: stats.honeyFromTokens + a, beeAttackMul: (stats.beeAttackMul ?? 1) + a };
  }
  // Gummy Morph (Gummy Mask): каждый 10-й токен Gummy Bee (Glob, Gumdrop Barrage) — 10 с морфа
  const gummyRate = perGroup.reduce((a, g) => a + g.tokens.filter((t) => t.eff.kind === 'goo').reduce((x, t) => x + t.rate, 0), 0);
  const morphRate = PA.gummyMorph ? gummyRate / 10 : 0;
  const morph = { rate: morphRate, on: refreshUptime(morphRate, 10), field: refreshUptime(morphRate, 10 + cal.gooLife) };
  if (morph.on > 0) notes.add('Gummy Morph: ГРУБО — всё поле в слизи на 10 с морфа и ещё cal.gooLife с, пока лужа не высохнет');

  // 3) баффы от токенов
  const buffRates = {};
  if (PA.hasteRate > 0) buffRates.haste = { rate: PA.hasteRate, durRate: PA.hasteRate * EFFECTS.Haste.dur, eff: EFFECTS.Haste };
  const markRates = {};
  let allTokenRate = 0;
  for (const g of perGroup) for (const t of g.tokens) {
    allTokenRate += t.rate;
    const ctx = { level: g.level, gifted: g.gifted, bee: g.bee };
    if (t.eff.kind === 'buff') {
      const dur = typeof t.eff.dur === 'function' ? t.eff.dur(ctx) : t.eff.dur;
      const b = (buffRates[t.eff.key] ??= { rate: 0, durRate: 0, eff: t.eff });
      b.rate += t.rate;
      b.durRate += t.rate * dur;
    }
    // токен, который кроме своего эффекта иногда даёт бафф (Target Practice → Precision)
    if (t.eff.buff) {
      const eb = t.eff.buff;
      const r = t.rate * (eb.share ? eb.share(cal, g.gifted) : 1);
      const b = (buffRates[eb.key] ??= { rate: 0, durRate: 0, eff: eb });
      b.rate += r;
      b.durRate += r * eb.dur;
    }
    // токены из токена: их баффы (Focus — крит, Red Boost — красная пыльца)
    for (const [name, n] of Object.entries(t.eff.spawns?.(cal, g.gifted) || {})) {
      const se = EFFECTS[name];
      if (se?.kind !== 'buff') continue;
      const r = t.rate * n * cal.tokenPickup;
      const b = (buffRates[se.key] ??= { rate: 0, durRate: 0, eff: se });
      b.rate += r;
      b.durRate += r * (typeof se.dur === 'function' ? se.dur(ctx) : se.dur);
    }
    // и иногда — метку (Target Practice у Gifted → Precise Mark)
    if (t.eff.mark && (!t.eff.mark.giftedOnly || g.gifted)) {
      const em = t.eff.mark;
      const r = t.rate * (em.share ? em.share(cal) : 1);
      const m = (markRates[em.key] ??= { rate: 0, durRate: 0, eff: em });
      m.rate += r;
      m.durRate += r * em.dur(ctx);
    }
    if (t.eff.kind === 'mark') {
      const dur = t.eff.dur(ctx);
      const m = (markRates[t.eff.key] ??= { rate: 0, durRate: 0, eff: t.eff });
      m.rate += t.rate;
      m.durRate += t.rate * dur * (t.eff.big ? 1.65 : 1); // Mark+ больше по площади (18 против 14 стадов)
    }
  }
  const buffs = {};
  for (const [key, b] of Object.entries(buffRates)) {
    const dur = b.durRate / b.rate;
    buffs[key] = b.eff.stack === 'combo' ? comboStacks(b.rate, dur, b.eff.max) : refreshUptime(b.rate, dur);
    if (opts.buffRamp?.[key] !== undefined) buffs[key] *= opts.buffRamp[key]; // разгон после похода в улей
  }
  const buffInfo = Object.fromEntries(Object.entries(buffRates).map(([key, b]) => [key, { rate: b.rate, dur: b.durRate / b.rate, combo: b.eff.stack === 'combo' }]));
  const marks = {};
  let marksOnField = 0;
  // Mark Surge (Gifted Vector Bee): каждый всплеск продлевает все активные метки на 1 с (+0.1 с за уровень), не больше 5 раз
  // на метку. Метка живёт D' = D + (всплесков за её жизнь)·e, всплесков — min(5, S·D')
  let surgeRate = 0;
  let surgeExt = 0;
  for (const g of perGroup) for (const t of g.tokens) if (t.name === 'Mark Surge') { surgeRate += t.rate; surgeExt += t.rate * (1 + 0.1 * g.level); }
  const ext = surgeRate > 0 ? surgeExt / surgeRate : 0;
  const extend = (D) => (surgeRate > 0 ? (surgeRate * ext < 1 ? Math.min(D + 5 * ext, D / (1 - surgeRate * ext)) : D + 5 * ext) : D);
  const marksPresent = {}; // сколько меток каждого вида в среднем на поле
  for (const [key, m] of Object.entries(markRates)) {
    const dur = extend(m.durRate / m.rate);
    marksOnField += m.rate * dur;
    marksPresent[key] = m.rate * dur;
    // стоим в метке cal.markStand времени; стаки растут, если метки перекрываются
    marks[key] = Math.min(m.eff.max, m.rate * dur) * cal.markStand;
  }

  // Star Shower: пойманные звёзды дают стаки Inspire пачкой (10 звёзд за раз), а не равномерно — комбо из пачки живёт,
  // пока его продлевают токены Inspire: от пачки остаётся «стаков × время до обрыва цепочки» (Inspire: 5 с, до 50)
  if (PA.inspireBurst) {
    const r = buffRates.inspire?.rate ?? 0;
    const d = EFFECTS.Inspire.dur;
    const life = r > 0 ? Math.expm1(r * d) / r : d;
    buffs.inspire = Math.min(EFFECTS.Inspire.max, (buffs.inspire ?? 0) + PA.inspireBurst.rate * PA.inspireBurst.stacks * life);
  }
  for (const [k, v] of Object.entries(PA.buffs)) buffs[k] = v;
  for (const [k, v] of Object.entries(forced)) {
    if (k === 'flameHeat' || k === 'flameFuel') continue;
    if (k in MARK_KEYS) marks[k] = Math.max(marks[k] ?? 0, v); else buffs[k] = Math.max(buffs[k] ?? 0, v);
  }
  // 4) общие множители
  // Flame Heat: чем больше пламени рядом, тем больше красной пыльцы (x1.2 … x2)
  const heatUsage = heatUse(perGroup);
  const flameHeatFull = forced.flameHeat ? 2 : flamesActive > 0 ? 1.2 + 0.8 * Math.min(1, flamesActive / cal.flamesForMaxHeat) : 1;
  const flameHeat = 1 + (flameHeatFull - 1) * heatUsage.avg; // в среднем, с учётом выстрелов Target Practice
  if (flamesActive > 0) buffs.flameHeat = flameHeat;
  // Bomb Sync (Crimson/Cobalt): пока активен — +10% пыльцы своего цвета и +10% мгновенной конвертации этого цвета
  const redSync = buffs.redBombSync ?? 0;
  const blueSync = buffs.blueBombSync ?? 0;
  const boostMul = {
    white: stats.white * (1 + 0.2 * (buffs.whiteBoost ?? 0)),
    red: stats.red * (1 + 0.2 * (buffs.redBoost ?? 0)) * (buffs.flameHeat ?? 1) * (1 + 0.1 * redSync) * PA.colorMul.red,
    blue: stats.blue * (1 + 0.2 * (buffs.blueBoost ?? 0)) * (1 + 0.1 * blueSync) * PA.colorMul.blue,
  };
  const pollenX = stats.pollen
    * (combo ? 1 + combo.uptime * (combo.pollenMul - 1) : 1)
    * (1 + (buffs.inspire ?? 0))
    * (1 + (buffs.babyLove ?? 0))
    * (1 + (buffs.bearMorph ?? 0))
    * (1 + 0.5 * (marks.pollenMark ?? 0));
  const preciseMark = marks.preciseMark ?? 0; // Precise Mark: +7% крита и суперкрита за стак, пока стоишь в ней
  const critChance = Math.min(0.88, stats.critChance + 0.03 * (buffs.focus ?? 0) + 0.01 * (buffs.tabbyBlessing ?? 0) + 0.07 * preciseMark);
  const critPower = stats.critPower + (buffs.melody ?? 0) + 0.25 * (buffs.tabbyBlessing ?? 0);
  // суперкрит бывает только у крита; Precision (Target Practice) — +2% за стак
  const superCrit = Math.min(1, stats.superCritChance + 0.02 * (buffs.precision ?? 0) + 0.07 * preciseMark);
  const critFactorFor = (extra) => 1 + Math.min(0.88, critChance + extra) * (critPower * (1 + superCrit * (stats.superCritPower - 1)) - 1);
  const critFactor = critFactorFor(0);
  const critPowerAlways = critPower * (1 + superCrit * (stats.superCritPower - 1));
  // какая доля пыльцы пришла суперкритами: она конвертируется мгновенно на 100% (код игры, описание Target Practice)
  const superShareFor = (extra) => {
    const cc = Math.min(0.88, critChance + extra);
    return (cc * superCrit * critPower * stats.superCritPower) / critFactorFor(extra);
  };
  const nearby = Math.min(1, 10 / Math.max(1, totalBees));
  const beeGatherX = stats.beeGather * (1 + 0.5 * (buffs.puppyLove ?? 0) * nearby);

  const activeByColor = { white: 0, red: 0, blue: 0 };
  for (const g of perGroup) activeByColor[g.bee.color] += g.count * g.st.uptime;
  // Token Link забирает токены, которые игрок ещё не подобрал; один токен — только одной ссылкой
  const linkRate = perGroup.reduce((a, g) => a + g.tokens.filter((t) => t.name === 'Token Link').reduce((x, t) => x + t.rate, 0), 0);
  const otherTokens = allTokenRate - linkRate;
  const q = (linkRate * cal.tokenWait) / (1 + linkRate * cal.tokenWait);
  const tokensPerLink = linkRate > 0 ? (otherTokens * q) / linkRate : 0;
  const giftedTypes = (color) => new Set(groups.filter((g) => g.gifted && data.beeByName.get(g.name).color === color).map((g) => g.name)).size;
  const redBees = groups.filter((g) => data.beeByName.get(g.name).color === 'red').reduce((a, g) => a + g.count, 0);
  const giftedRedBees = groups.filter((g) => g.gifted && data.beeByName.get(g.name).color === 'red').reduce((a, g) => a + g.count, 0);
  const convertAmountByColor = { white: 0, red: 0, blue: 0 };
  for (const g of perGroup) convertAmountByColor[g.bee.color] += g.count * g.st.uptime * g.st.convert * g.bee.convert.time;
  for (const c of COLORS) convertAmountByColor[c] = activeByColor[c] ? convertAmountByColor[c] / activeByColor[c] : 0;
  const hiveCtx = {
    buffs, marksOnField, tokensPerLink, critPowerAlways, activeByColor, convertAmountByColor, flameHeat,
    preciseMarkOn: Math.min(1, marksPresent.preciseMark ?? 0), // есть ли Precise Mark на поле (доля времени)
    preciseMarkShareOfMarks: marksOnField > 0 ? (marksPresent.preciseMark ?? 0) / marksOnField : 0,
    giftedBlueTypes: giftedTypes('blue'), redBees, giftedRedBees,
  };

  const ic = {
    white: Math.min(1, stats.instantConversion + stats.instantWhite),
    red: Math.min(1, stats.instantConversion + stats.instantRed + 0.1 * redSync + PA.icAdd.red),
    blue: Math.min(1, stats.instantConversion + stats.instantBlue + 0.1 * blueSync + PA.icAdd.blue),
  };
  // Coconut Combo: «Unique Instant Conversion» (код игры: PollenPreserved x0.75…x0.25) — отдельный шанс поверх остальных
  if (combo) for (const c of COLORS) ic[c] = 1 - (1 - ic[c]) * (1 - combo.uptime * combo.ic);
  return { buffInfo, cal, groups, totalBees, notes, notModeled, irrelevant, morph, perGroup, fireBees, fuelUptime, heatUsage, flameHeatFull, R, flamesActive, PA, buffRates, markRates, allTokenRate, buffs, marks, marksOnField, flameHeat, redSync, blueSync, boostMul, pollenX, critChance, critPower, superCrit, critFactorFor, critFactor, critPowerAlways, superShareFor, nearby, beeGatherX, activeByColor, linkRate, otherTokens, q, tokensPerLink, giftedTypes, redBees, giftedRedBees, convertAmountByColor, hiveCtx, ic, stats, applied };
}

/**
 * Оценка улья на поле. Баффы из токенов (Blue Boost, Focus, Haste…) в hiveCore — средние при непрерывном сборе.
 * Пока игрок в улье, пчёлы не собирают и токенов нет: бафф короче похода сгорает, и на поле он заново разгоняется.
 * Поэтому два прохода: 1) цикл «поле → улей»; 2) баффы × доля «разогнанного» времени на поле, пересчёт.
 */
export function evaluate(data, hive, opts = {}) {
  const r1 = evaluateOnce(data, hive, opts);
  if (opts.buffRamp || !r1._buffInfo) return r1;
  const isHive = (r) => r.cycle.mode === 'hive' && Number.isFinite(r.cycle.fillSeconds);
  if (!isHive(r1)) return r1;
  // разгон по времени на поле F и времени без токенов away
  const rampFor = (F, away) => {
    const ramp = {};
    const lost = [];
    for (const [key, b] of Object.entries(r1._buffInfo)) {
      if (!(b.rate > 0) || b.dur >= away) continue; // бафф переживает поход
      const S = r1._buffsRaw[key] ?? 0;
      if (!(S > 0)) continue;
      let k;
      if (b.combo) {
        // стаки растут примерно на 1 за токен: до среднего S — за S/rate с, потеря — треугольник S·(S/rate)/2
        const T = S / b.rate;
        k = T <= F ? 1 - T / (2 * F) : (b.rate * F) / (2 * S);
      } else {
        k = Math.max(0, 1 - 1 / (b.rate * F)); // бафф без стаков: до первого токена в среднем 1/rate с
      }
      if (k < 0.999) { ramp[key] = k; lost.push(`${key} −${Math.round((1 - k) * 100)}%`); }
    }
    return { ramp, lost };
  };
  // слабее баффы → меньше пыльцы → рюкзак наполняется дольше → баффы меньше сгорают: ищем согласованное F
  // (F_{n+1} = √(F_n · F(баффы от F_n)), несколько шагов)
  let F = r1.cycle.fillSeconds;
  let away = r1.cycle.convertSeconds + r1.cycle.walkSeconds;
  let best = r1;
  let info = rampFor(F, away);
  if (!info.lost.length) return r1;
  for (let i = 0; i < 6; i++) {
    const r = evaluateOnce(data, hive, { ...opts, buffRamp: info.ramp });
    best = r;
    const g = isHive(r) ? r.cycle.fillSeconds : 1e9;
    if (Math.abs(Math.log(g / F)) < 0.05) break;
    F = Math.sqrt(F * Math.min(g, 1e9));
    if (isHive(r)) away = r.cycle.convertSeconds + r.cycle.walkSeconds;
    info = rampFor(F, away);
    if (!info.lost.length) { best = r1; break; }
  }
  if (info.lost.length && best !== r1) best.notes.push(`Баффы разгоняются заново после улья (${Math.round(away)} с без токенов, на поле ${Math.round(F)} с): ${info.lost.join(', ')}`);
  return best;
}

function evaluateOnce(data, hive, opts = {}) {
  prepare(data);
  const core = hiveCore(data, hive, opts);
  const { cal, groups, totalBees, perGroup, fireBees, fuelUptime, heatUsage, flameHeatFull, R, flamesActive, PA, buffRates, markRates, allTokenRate, buffs, marks, marksOnField, flameHeat, redSync, blueSync, boostMul, critChance, critPower, superCrit, critFactorFor, critFactor, critPowerAlways, superShareFor, nearby, beeGatherX, activeByColor, linkRate, otherTokens, q, tokensPerLink, giftedTypes, redBees, giftedRedBees, convertAmountByColor, hiveCtx, ic, stats, applied } = core;
  // заметки дополняются ниже — копии, чтобы не портить кэш
  const notes = new Set(core.notes);
  const notModeled = new Map(core.notModeled);
  const { morph } = core;
  const fieldName = resolveFieldName(data, opts.field || 'Sunflower Field');
  if (!fieldName) throw new Error(`Неизвестное поле: ${opts.field}`);
  const fieldData = data.fieldByName.get(fieldName);
  const field = { ...fieldData.mix, size: cal.flowerSizeForBees ? fieldData.avgSize : 1, flowers: fieldData.flowers };
  const pollenX = core.pollenX * (stats.fieldPollen?.[fieldName] ?? 1); // множитель пыльцы этого поля (снаряжение, буст)

  let pollination = null;
  // 4-) опыление (вики Pollination): опылённый цветок на 1 ярус выше (одинарный → двойной → … → звезда, x1…x5 пыльцы),
  // держится 1 мин, стакается до 5 раз, потом раз в минуту падает на ярус. В среднем прибавка ярусов на цветок =
  // опылений в секунду × 60 / цветков, где они рассыпаны: Fuzzy Coat и Fuzz Bombs — вокруг игрока (cal.gooZone),
  // Pollen Haze, Diamond Drain — по всему полю. Ярус не выше 5.
  {
    const zone = Math.min(field.flowers, cal.gooZone);
    let local = 0; // опылений/с в зоне сбора
    let wide = 0; // опылений/с по всему полю
    for (const g of perGroup) {
      if (g.name === 'Fuzzy Bee') local += (g.count * g.st.uptime / g.st.cycle) * (g.gifted ? 9 : 5) * cal.coatShare;
      for (const t of g.tokens) {
        if (t.name === 'Fuzz Bombs') local += t.rate * (2 + Math.floor(g.level / 5)) * cal.fuzzBombsCaught * cal.fuzzPollinate;
        if (t.name === 'Pollen Haze') wide += t.rate * 30 * 30;
      }
    }
    const blueBeesP = groups.filter((g) => data.beeByName.get(g.name).color === 'blue').reduce((a, g) => a + g.count, 0);
    for (const e of PA.events || []) if (e.kind === 'diamondDrain') wide += (e.rate || 0) * (10 + 3 * blueBeesP);
    const avg = fieldData.avgSize;
    const added = Math.min(5 - avg, (local * 60) / zone + (wide * 60) / field.flowers);
    if (added > 0) {
      field.size *= (avg + added) / avg;
      pollination = { perSec: local + wide, tiers: added };
      notes.add(`Опыление: цветки в среднем на ${added.toFixed(2)} яруса выше (ГРУБО: cal.coatShare, cal.fuzzPollinate)`);
    }
  }

  // 4) пыльца по источникам
  const zero = () => ({ white: 0, red: 0, blue: 0 });
  const pollen = zero(); // всего пыльцы/с (для квестов)
  const instantHoney = { v: 0 };
  const sources = {};
  const superShare = superShareFor(0);
  // superPart — доля пыльцы источника от суперкритов (по умолчанию — общая; у источников без критов 0)
  const addSource = (name, amounts, extraIc = 0, superPart = superShare) => {
    const src = (sources[name] ??= zero());
    for (const c of COLORS) {
      const v = amounts[c];
      if (!v) continue;
      src[c] += v;
      pollen[c] += v;
      const share = 1 - (1 - Math.min(1, ic[c] + extraIc)) * (1 - superPart);
      instantHoney.v += v * share * stats.honeyPerPollen;
    }
  };
  const perBee = [];
  const gooPuddles = []; // лужи слизи: сколько цветков в среднем покрыто и какого размера лужи
  let honeyTokens = 0;
  let tokenConvert = 0; // пыльца из рюкзака, которую способности конвертируют прямо на поле
  for (const g of [...perGroup, ...fireBees]) {
    const bee = g.bee;
    const beeColor = bee.color;
    const gift = g.gifted ? stats.giftedBeePollen : 1;
    const eventX = bee.rarity === 'event' ? stats.eventBeePollen : 1; // Event Bee Pollen (амулет Cog)
    // Gummy Morph: Gummy Bee 10 с собирает +1000%
    const morphX = g.name === 'Gummy Bee' ? 1 + 10 * morph.on : 1;
    const gatherPS = zero();
    const beeCrit = critFactorFor(g.st.critChance); // мутация Critical Chance — только у этой пчелы
    for (const c of COLORS) {
      const colorBonus = beeColor === c && c !== 'white' ? 1.5 : 1;
      gatherPS[c] = (field[c] * g.st.gather * colorBonus * field.size / g.st.cycle) * g.st.uptime * g.count
        * beeGatherX * pollenX * boostMul[c] * beeCrit * gift * eventX * morphX * cal.gatherScale;
    }
    addSource('сбор пчёл', gatherPS, g.st.instantConversion + stats.instantGather + (g.gifted ? stats.instantGifted : 0), superShareFor(g.st.critChance));
    let beeTotal = gatherPS.white + gatherPS.red + gatherPS.blue;
    for (const t of g.tokens) {
      const ctx = { level: g.level, gifted: g.gifted, bee, field, stats, hive: hiveCtx, cal };
      if (t.eff.kind === 'pollen') {
        const per = t.eff.perToken(ctx, t.token);
        const amounts = zero();
        const markX = (t.token.tags || []).includes('Mark') ? stats.markAbilityPollen : 1;
        // способности, которые иногда «всегда критуют» (Triangulate / Mark Surge в Precise Mark): доля p — средний крит critPowerAlways
        const p = t.eff.alwaysCrit ? Math.min(1, t.eff.alwaysCrit(ctx)) : 0;
        const crit = critFactor + p * (critPowerAlways - critFactor);
        for (const c of COLORS) amounts[c] = per[c] * t.rate * pollenX * boostMul[c] * crit * stats.abilityPollen * markX * eventX * cal.tokenScale;
        const extra = (t.eff.source === 'bomb' ? stats.instantBomb : 0) + (t.eff.instant ? t.eff.instant(ctx) : 0) + stats.instantAbility;
        addSource(t.name, amounts, extra);
        beeTotal += amounts.white + amounts.red + amounts.blue;
        if (t.eff.fieldConvert) tokenConvert += t.eff.fieldConvert(ctx) * t.rate;
      } else if (t.eff.kind === 'honey') {
        honeyTokens += t.eff.perToken(ctx) * t.rate * stats.honeyFromTokens;
      } else if (t.eff.kind === 'frog') {
        // пузыри лягушки — как пузыри Tadpole Bee того же уровня
        const per = passivePollen('bubble', ctx);
        const amounts = zero();
        const n = t.rate * t.eff.bubbles(ctx);
        for (const c of COLORS) amounts[c] = per[c] * n * pollenX * boostMul[c] * critFactor * stats.abilityPollen * cal.tokenScale;
        addSource('Summon Frog', amounts, stats.instantBubble);
        beeTotal += amounts.white + amounts.red + amounts.blue;
        if (t.eff.note) notes.add(`Summon Frog: ${t.eff.note}`);
      } else if (t.eff.kind === 'goo') {
        const pd = t.eff.puddle(ctx);
        gooPuddles.push({ name: t.name, covered: t.rate * pd.flowers * cal.gooLife, size: pd.size });
      }
    }
    if (g.passive) {
      const ctx = { level: g.level, gifted: g.gifted, bee, field, stats, hive: hiveCtx, cal };
      const per = passivePollen(g.passive.kind, ctx);
      const amounts = zero();
      // пламя горит само (как сбор пчёл), пузыри надо лопать (как токены)
      const scale = g.passive.kind === 'flame' ? cal.gatherScale : cal.tokenScale;
      for (const c of COLORS) amounts[c] = per[c] * g.passive.rate * pollenX * boostMul[c] * critFactor * stats.abilityPollen * scale;
      addSource(g.passive.kind === 'bubble' ? 'пузыри' : 'пламя', amounts, g.passive.kind === 'flame' ? PA.flameIc + stats.instantFlame : stats.instantBubble);
      beeTotal += amounts.white + amounts.red + amounts.blue;
    }
    if (g.ringFlames > 0) {
      // Inferno: кольцо из 6 пламён (горят как обычное пламя этой пчелы)
      const ctx = { level: g.level, gifted: g.gifted, bee, field, stats, hive: hiveCtx, cal };
      const per = passivePollen('flame', ctx);
      const amounts = zero();
      for (const c of COLORS) amounts[c] = per[c] * g.ringFlames * pollenX * boostMul[c] * critFactor * stats.abilityPollen * cal.gatherScale;
      addSource('Inferno', amounts, PA.flameIc + stats.instantFlame);
      beeTotal += amounts.white + amounts.red + amounts.blue;
    }
    perBee.push({ name: g.name, virtual: g.virtual || undefined, count: g.count, level: g.level, gifted: g.gifted, pollenPerSec: beeTotal, uptime: g.st.uptime, cycle: g.st.cycle });
  }
  if (stats.toolPollenPerSec > 0) {
    const tool = zero();
    const toolColor = { white: stats.toolWhite, red: stats.toolRed, blue: stats.toolBlue };
    for (const c of COLORS) tool[c] = stats.toolPollenPerSec * field[c] * field.size * stats.tool * toolColor[c] * pollenX * boostMul[c] * critFactor;
    addSource('инструмент', tool, stats.instantTool);
  }
  if (stats.movementCollection > 0) {
    // ГРУБО: ходьба по полю собирает Movement Collection с каждого цветка под ногами
    const walk = zero();
    const haste = 1 + 0.1 * (buffs.haste ?? 0); // Haste ускоряет игрока — больше цветков под ногами
    for (const c of COLORS) walk[c] = stats.movementCollection * stats.movementPollen * cal.stepFlowers * haste * field[c] * field.size * pollenX * boostMul[c] * critFactor;
    addSource('ходьба (ботинки)', walk);
    notes.add('Movement Collection: ГРУБО — сколько цветков в секунду проходит игрок');
  }

  // пассивки, шаг B: их пыльца и «пачки» конвертации на поле
  const convertTotal = perGroup.reduce((a, g) => a + g.st.convert * g.bee.convert.time * g.count, 0); // Convert Total из ⚙️
  const levelAvg = totalBees ? groups.reduce((a, g) => a + g.level * g.count, 0) / totalBees : 1;
  const giftedTypesAll = new Set(groups.filter((g) => g.gifted).map((g) => g.name)).size;
  const blueBees = groups.filter((g) => data.beeByName.get(g.name).color === 'blue').reduce((a, g) => a + g.count, 0);
  const PB = passivesB(PA, {
    field, stats, cal, pollenX, boostMul, critFactor, hive: hiveCtx, level: levelAvg, redBees, giftedRedBees, blueBees,
    boostStacks: Math.min(4, stats.fieldBoostStacks?.[fieldName] ?? 0),
    giftedBlueTypes: hiveCtx.giftedBlueTypes, giftedTypes: giftedTypesAll, convertTotal,
    avgConvertAmount: totalBees ? convertTotal / totalBees : 0,
    // Attack Total из ⚙️: сумма атаки пчёл (BeeStats.GetAttack) — нужна Star Saw
    attackTotal: perGroup.reduce((a, g) => a + g.count * beeAttack({ stats, bee: g.bee, gifted: g.gifted, hive: hiveCtx }), 0),
    avgConvertRate: totalBees ? perGroup.reduce((a, g) => a + g.st.convert * g.count, 0) / totalBees : 0,
  });
  for (const s of PB.sources) addSource(s.name, s.amounts, (s.ic || 0) + (s.flame ? stats.instantFlame : 0) + (s.bubble ? stats.instantBubble : 0));

  // 4а) шарики Buoyant Bee (Inflate Balloons, Surprise Party). Вики Balloon + BeeAbilityDefs + BuffDefs:
  //   шарик: живёт 20 с (+2 с за ур.), вместимость 1/6 рюкзака (золотой x2), тень — 5 клеток (~78 цветков);
  //   пыльца с цветков в тени (+10%, синяя +20%, золотой ещё x1.25) идёт в шарик, а не в рюкзак, потом — в шар улья;
  //   каждый Inflate добавляет 5% (+0.01% за ур.) пыльцы во все шарики поля (до 10 раз на шарик);
  //   Balloon Aura: стак за каждый шарик над игроком (до 10): x1.02 пыльцы и +2% Honey From Tokens за стак;
  //   Balloon Blessing (1 ч): x1.03 вместимости и x1.015 Honey At Hive за стак (до 100) — за конвертацию шара улья;
  //   золотые шарики делают пузыри под собой золотыми: x2 пыльцы и мгновенная конвертация.
  const boostStacksB = Math.min(4, stats.fieldBoostStacks?.[fieldName] ?? 0);
  const balloons = { rate: 0, alive: 0, gold: 0, goldAlive: 0, lifeSum: 0, inflateRate: 0, inflateLvl: 0 };
  for (const g of perGroup) {
    for (const t of g.tokens) {
      if (t.eff.kind !== 'balloon' || !(t.rate > 0)) continue;
      const ctx = { level: g.level, gifted: g.gifted, boostStacks: boostStacksB };
      const n = t.rate * t.eff.count(ctx);
      const life = t.eff.life(ctx);
      const gold = t.eff.gold(ctx);
      balloons.rate += n;
      balloons.gold += n * gold;
      balloons.alive += n * life;
      balloons.goldAlive += n * gold * life;
      balloons.lifeSum += n * life;
      if (t.name === 'Inflate Balloons') { balloons.inflateRate += t.rate; balloons.inflateLvl += t.rate * g.level; }
      if (t.eff.note) notes.add(`${t.name}: ${t.eff.note}`);
    }
  }
  const manualAura = stats.manualBalloonAura || 0;
  const manualBlessing = stats.manualBalloonBlessing || 0;
  let auraStacks = 0;
  let balloonShare = 0; // доля пыльцы, которая шла бы в рюкзак, а уходит в шарики
  let balloonBonus = 1; // во сколько раз пыльца в шарике больше собранной
  if (balloons.rate > 0) {
    const near = balloons.alive * cal.balloonNear; // шариков над зоной сбора
    auraStacks = Math.min(10, near);
    const zone = Math.min(field.flowers, cal.gooZone);
    const rho = Math.min(1, 78 / zone);
    balloonShare = 1 - Math.pow(1 - rho, near);
    const goldShare = balloons.alive > 0 ? balloons.goldAlive / balloons.alive : 0;
    const life = balloons.lifeSum / balloons.rate;
    const inflLvl = balloons.inflateRate > 0 ? balloons.inflateLvl / balloons.inflateRate : 0;
    // за жизнь шарика его надувают min(10, Inflate за это время) раз; в среднем пыльца в нём — половина, отсюда /2
    const inflates = Math.min(10, balloons.inflateRate * life);
    balloonBonus = (1 + 0.1 + 0.1 * field.blue) * (1 + 0.25 * goldShare) * (1 + (0.05 + 0.0001 * inflLvl) * (1 + boostStacksB) * inflates / 2);
    notes.add('Шарики Buoyant: ГРУБО — сколько шариков висит над зоной сбора (cal.balloonNear) и стаки Balloon Blessing от пыльцы в шаре улья (cal.blessingPerDecade)');
  }
  // Balloon Aura заменяет отмеченную вручную (она уже в статах)
  const auraX = (1 + 0.02 * auraStacks) / (1 + 0.02 * manualAura);
  if (auraX !== 1) {
    for (const src of Object.values(sources)) for (const c of COLORS) src[c] *= auraX;
    for (const c of COLORS) pollen[c] *= auraX;
    instantHoney.v *= auraX;
    for (const b of perBee) b.pollenPerSec *= auraX;
    honeyTokens *= (stats.honeyFromTokens + 0.02 * (auraStacks - manualAura)) / stats.honeyFromTokens;
  }
  // золотые пузыри: пузыри под золотыми шариками собирают x2 и сразу в мёд
  if (balloons.goldAlive > 0) {
    const zone = Math.min(field.flowers, cal.gooZone);
    const goldCover = 1 - Math.pow(1 - Math.min(1, 78 / zone), balloons.goldAlive * cal.balloonNear);
    const extra = zero();
    for (const name of ['пузыри', 'Summon Frog', 'Bubble Bombs']) for (const c of COLORS) extra[c] += (sources[name]?.[c] ?? 0) * goldCover;
    if (extra.white + extra.red + extra.blue > 0) addSource('золотые пузыри (шарики)', extra, 1);
  }
  const chunks = [...PB.chunks];
  const boostStacks = Math.min(4, stats.fieldBoostStacks?.[fieldName] ?? 0); // стаки Field Boost этого поля
  const heat = Math.max(0, flameHeatFull - 1) * heatUsage.atShot; // разогрев Flame Heat к моменту выстрела Target Practice
  // Flame Fuel (Gifted Spicy Bee, код игры): пока действует, каждое новое пламя сразу конвертирует 50 тыс. + 10% Convert Total
  if (fuelUptime > 0) {
    const paFlames = (PA.events || []).filter((e) => e.kind === 'flames').reduce((a, e) => a + (e.rate || 0) * e.count, 0);
    const spawn = [...perGroup, ...fireBees].reduce((a, g) => a + (g.passive?.kind === 'flame' ? g.passive.rate : 0) + (g.ringFlames || 0), 0) + paFlames;
    chunks.push({ name: 'Flame Fuel', pollenPerSec: spawn * fuelUptime * (50000 + (0.1 + 0.05 * boostStacks) * convertTotal) * cal.convertScale, honeyMul: 1 });
  }
  // Target Practice (Precise Bee): игрок стоит на мишени, когда она стреляет, — конвертирует рюкзак: 50% Convert Total +
  // 10× конвертации этой пчелы, до x10 от Flame Heat (ГРУБО: 1 + 9·разогрев); половина — токенами мёда (Honey From Tokens)
  for (const g of perGroup) {
    const t = g.tokens.find((x) => x.name === 'Target Practice');
    if (!t) continue;
    // до x3 от стаков буста поля (их максимум 4)
    const amount = (0.5 * convertTotal + 10 * g.st.convert * g.bee.convert.time) * (1 + 9 * heat) * (1 + 0.5 * boostStacks);
    chunks.push({ name: 'Target Practice (выстрел по игроку)', pollenPerSec: t.rate * cal.targetStand * amount * cal.convertScale, honeyMul: 0.5 + 0.5 * stats.honeyFromTokens });
  }
  let chunkConvert = 0;
  let chunkHoney = 0;
  for (const ch of chunks) { chunkConvert += ch.pollenPerSec; chunkHoney += ch.pollenPerSec * ch.honeyMul; }

  // 4б) слизь (goo). Вики Goo: с лужи из f цветков бонусный мёд = собранная пыльца · √(f/200); стат Goo умножает слизь,
  // Honey Per Goo — мёд за неё, Goo Conversion — мгновенно конвертирует столько пыльцы, сколько собрано слизи.
  // Слизь не тратится, пока её не заберёт Gummyballer; собирают её игрок, пчёлы и способности
  let gooHoney = 0;
  let gooConvertPollen = 0;
  let gooCover = 0;
  let gooPerSec = 0;
  if (PA.gooTrail) {
    const haste = 1 + 0.1 * (buffs.haste ?? 0);
    gooPuddles.push({ name: 'Goo Trail', covered: cal.stepFlowers * haste * cal.trailFlowers * cal.gooLife, size: cal.trailPuddle });
    notes.add('Goo Trail: ГРУБО — сколько цветков в слизи за игроком (cal.trailFlowers) и размер следа (cal.trailPuddle)');
  }
  const pollenNow = pollen.white + pollen.red + pollen.blue;
  if ((gooPuddles.length || morph.field > 0) && pollenNow > 0) {
    const zone = Math.min(field.flowers, cal.gooZone);
    const covered = gooPuddles.reduce((a, p) => a + p.covered, 0);
    const root = covered > 0 ? gooPuddles.reduce((a, p) => a + p.covered * Math.sqrt(Math.min(p.size, field.flowers) / 200), 0) / covered : 0;
    const share = Math.min(1, covered / zone); // доля собираемых цветков в слизи (вне морфа)
    // Gummy Morph: всё поле — одна лужа
    gooCover = morph.field + (1 - morph.field) * share;
    const perPollen = morph.field * Math.sqrt(field.flowers / 200) + (1 - morph.field) * share * root;
    const gooMul = stats.goo + 0.75 * morph.on; // Gummy Morph: +75% Goo
    const goo = pollenNow * perPollen * gooMul; // слизи в секунду
    gooPerSec = goo;
    gooHoney = goo * stats.honeyPerGoo;
    // Goo Conversion (+100% в морфе): пыльца, которая иначе пошла бы в рюкзак
    const toBagNow = pollenNow - instantHoney.v / stats.honeyPerPollen;
    gooConvertPollen = Math.max(0, Math.min(toBagNow, goo * Math.min(1, stats.gooConversion + morph.on)));
    instantHoney.v += gooConvertPollen * stats.honeyPerPollen;
    notes.add('Слизь: ГРУБО — сколько живёт лужа (cal.gooLife) и в какой зоне вокруг игрока собирают (cal.gooZone)');
  }

  // 5) конвертация: рюкзак → улей
  const totalPollen = pollen.white + pollen.red + pollen.blue;
  const toBag = COLORS.reduce((a, c) => a + pollen[c], 0) - instantHoney.v / stats.honeyPerPollen;
  const hiveConvert = perGroup.reduce((a, g) => a + g.st.convert * g.count, 0) * stats.convertRateHive * PA.hiveConvertMul * cal.convertScale;
  const hiveHoneyRate = perGroup.reduce((a, g) => a + g.st.convertHoney * g.count, 0) * stats.convertRateHive * PA.hiveConvertMul * stats.honeyPerPollen * stats.honeyAtHive * cal.convertScale;
  // Honey Mark: 2 «ссылки конвертации» на стак, пока игрок стоит в метке, конвертируют пыльцу прямо на поле
  const avgBeeConvert = totalBees ? hiveConvert / (stats.convertRateHive * PA.hiveConvertMul) / totalBees : 0;
  // всё, что конвертирует пыльцу из рюкзака прямо на поле: Honey Mark, Gifted-импульсы, пассивки; больше, чем приходит, не съесть
  const wantConvert = (marks.honeyMark ?? 0) * 2 * avgBeeConvert * 1.25 + tokenConvert + chunkConvert;
  const fieldConvert = Math.min(Math.max(0, toBag), wantConvert);
  const chunkShare = wantConvert > 0 ? fieldConvert / wantConvert : 0;
  const bagInflow0 = Math.max(0, toBag - fieldConvert);
  const fcap = (c, extra) => (1 + extra) * PA.fieldCapMul[c] - 1; // Field Capacity с пассивками (Pop/Scorching/Gummy Star, Bubble Bloat)
  const capacity0 = stats.capacity * stats.capacityMul * PA.capacityMul
    * (1 + field.white * fcap('white', stats.fieldCapacityWhite) + field.red * fcap('red', stats.fieldCapacityRed) + field.blue * fcap('blue', stats.fieldCapacityBlue));
  // шарики забирают часть пыльцы рюкзака, но не больше, чем в них влезает (1/6 рюкзака, золотой — x2)
  // «Balloon capacity and inflation scales with number of field boosts» (BeeAbilityDefs) — ГРУБО как пыльца поля: x(1 + стаки)
  const balloonRoom = (balloons.rate + balloons.gold) * capacity0 / 6 * (1 + boostStacksB);
  const toBalloon = Math.min(bagInflow0 * balloonShare, balloonRoom / balloonBonus);
  const bagInflow = bagInflow0 - toBalloon;
  const balloonPollen = toBalloon * balloonBonus; // в шар улья, пыльцы/с
  // Balloon Blessing: стаки от пыльцы в шаре улья при конвертации (копится цикл рюкзака или cal.balloonHold)
  let blessing = 0;
  if (balloonPollen > 0) {
    const fill0 = bagInflow > 0 ? capacity0 / bagInflow : Infinity;
    const P = balloonPollen * Math.max(Math.min(fill0, 3600), cal.balloonHold);
    blessing = Math.max(0, Math.min(100, 100 - cal.blessingPerDecade * Math.log10(1e13 / P)));
  }
  const blessCap = (1 + 0.03 * blessing) / (1 + 0.03 * manualBlessing);
  const blessHive = (1 + 0.015 * blessing) / (1 + 0.015 * manualBlessing);
  const capacity = capacity0 * blessCap;
  // шар улья конвертируют те же пчёлы после рюкзака; Buoyant Bee (Balloon Enthusiast) — x3 конвертации из шариков
  const buoyantConvert = perGroup.reduce((a, g) => a + (g.name === 'Buoyant Bee' ? g.st.convert * g.count * 2 : 0), 0) * stats.convertRateHive * PA.hiveConvertMul * cal.convertScale;
  const balloonConvert = hiveConvert + buoyantConvert;
  const balloonHoneyPerPollen = hiveConvert > 0 ? (hiveHoneyRate / hiveConvert) * blessHive : stats.honeyPerPollen * stats.honeyAtHive * blessHive;
  // на каждую секунду на поле — столько секунд в улье на конвертацию шара
  const balloonTimePerSec = balloonConvert > 0 ? balloonPollen / balloonConvert : 0;
  const balloonHoney = balloonPollen * balloonHoneyPerPollen; // мёда за секунду на поле
  // мёд от конвертации на поле: обычная — по Honey Per Pollen, «пачки» пассивок с токенами мёда — ещё × Honey From Tokens
  const fieldHoney = (fieldConvert - chunkConvert * chunkShare) * stats.honeyPerPollen + chunkHoney * chunkShare * stats.honeyPerPollen;
  const onFieldHoney = instantHoney.v + fieldHoney + honeyTokens + gooHoney;
  // Цикл «поле → улей». bt/bh — время на конвертацию шара улья и мёд с него на секунду поля. Шар можно и не
  // конвертировать целиком (лишнее просто сдувается, вики Balloon): игрок выберет, что выгоднее.
  const cycleFor = (bt, bh) => {
    let honeyPerHour;
    let fill = Infinity;
    let convertTime = 0;
    let fieldShare = 1;
    if (bagInflow <= 1e-9) {
      // в улей — только сконвертировать шар (дорога не считается: можно ходить редко)
      fieldShare = 1 / (1 + bt);
      honeyPerHour = (onFieldHoney + bh) * fieldShare * 3600;
    } else {
      fill = capacity / bagInflow;
      convertTime = (hiveConvert > 0 ? capacity / hiveConvert : Infinity) + fill * bt;
      const cycle = fill + convertTime + cal.walkSeconds;
      fieldShare = fill / cycle;
      const hiveHoney = (hiveConvert > 0 ? capacity * (hiveHoneyRate / hiveConvert) * blessHive : 0) + bh * fill;
      honeyPerHour = Number.isFinite(cycle) ? ((hiveHoney + onFieldHoney * fill) / cycle) * 3600 : 0;
      // Scorching Star в конце конвертирует весь рюкзак: если он не успевает заполниться — в улей ходить не нужно
      const T = PA.scorching?.period;
      if (Number.isFinite(T)) {
        const dumpHoney = capacity * stats.honeyPerPollen;
        const viaStar = fill >= T
          ? (bagInflow * stats.honeyPerPollen + onFieldHoney) * 3600
          : ((dumpHoney + onFieldHoney * fill) / T) * 3600; // рюкзак полон раньше — ждём звезду
        if (viaStar > honeyPerHour) {
          honeyPerHour = viaStar;
          fieldShare = fill >= T ? 1 : fill / T;
          convertTime = 0;
          notes.add('Scorching Star опустошает рюкзак — ходить в улей не нужно');
        }
      }
    }
    // Третий вариант — не ходить в улей, а стоять на поле с полным рюкзаком. В игре при полном рюкзаке сбор
    // останавливается (Collectors.LocalCollect.HasCapacity), поэтому пыльцы собирается столько, сколько успевает
    // сконвертироваться на поле (Honey Mark, Star Shower, кокосы…): доля stayShare. Мёд из токенов от этого не зависит.
    let mode = bagInflow <= 1e-9 ? 'never' : 'hive';
    let stayShare = 1;
    if (mode === 'hive' && toBag > 0) {
      stayShare = Math.min(1, fieldConvert / toBag);
      // шарики при полном рюкзаке тоже стоят (сбор остановлен) — их доля как у остального сбора
      const stayHoney = ((instantHoney.v + gooHoney + bh) * stayShare + fieldHoney + honeyTokens) * 3600 / (1 + bt * stayShare);
      if (stayHoney > honeyPerHour) {
        honeyPerHour = stayHoney;
        mode = 'stay';
        fill = Infinity;
        convertTime = 0;
      }
    }
    // для квестов на пыльцу игрок выберет то, что даёт больше пыльцы
    if (mode !== 'never' && stayShare > fieldShare) fieldShare = stayShare;
    return { honeyPerHour, fill, convertTime, fieldShare, mode, stayShare };
  };
  const withBalloon = cycleFor(balloonTimePerSec, balloonHoney);
  const noBalloon = balloonHoney > 0 ? cycleFor(0, 0) : null;
  const balloonConverted = !noBalloon || withBalloon.honeyPerHour >= noBalloon.honeyPerHour;
  // eslint-disable-next-line prefer-const
  let { honeyPerHour, fill, convertTime, fieldShare, mode, stayShare } = balloonConverted ? withBalloon : noBalloon;
  if (!balloonConverted) notes.add('Шар улья выгоднее не конвертировать целиком: на поле мёд идёт быстрее, чем конвертируется шар (Balloon Blessing всё равно держится)');

  const bySource = Object.entries(sources)
    .map(([name, v]) => ({ name, pollenPerSec: v.white + v.red + v.blue }))
    .sort((a, b) => b.pollenPerSec - a.pollenPerSec);
  for (const b of perBee) b.share = totalPollen ? b.pollenPerSec / totalPollen : 0;
  perBee.sort((a, b) => b.pollenPerSec - a.pollenPerSec);

  return {
    field: fieldName,
    bees: totalBees,
    beesRequired: fieldData.beesRequired,
    canEnter: totalBees >= fieldData.beesRequired,
    honeyPerHour,
    pollenPerSec: { ...pollen, total: totalPollen }, // пока игрок на поле
    // в среднем за всё время, с походами в улей (для квестов на пыльцу)
    pollenPerHourEffective: { white: pollen.white * fieldShare * 3600, red: pollen.red * fieldShare * 3600, blue: pollen.blue * fieldShare * 3600, total: totalPollen * fieldShare * 3600 },
    // mode: never — рюкзак не наполняется; hive — ходить в улей; stay — стоять с полным рюкзаком (сбор stayShare от полного)
    cycle: { fillSeconds: fill, convertSeconds: convertTime, walkSeconds: cal.walkSeconds, capacity, fieldShare, mode, stayShare },
    // шарики Buoyant: сколько их на поле, стаки Aura/Blessing (модель; ручные из «Баффов» заменены), пыльца в шар улья
    pollination,
    balloons: balloons.rate > 0 ? { alive: balloons.alive, gold: balloons.goldAlive, aura: auraStacks, blessing, share: bagInflow0 > 0 ? toBalloon / bagInflow0 : 0, pollenPerSec: balloonPollen, honeyPerSec: balloonHoney, converted: balloonConverted } : null,
    convertPerSec: hiveConvert,
    bagPerSec: bagInflow, // сколько пыльцы в секунду остаётся в рюкзаке (после мгновенной конвертации)
    // чем конвертируется пыльца из рюкзака прямо на поле (сколько могло бы в секунду) и сколько уходит в рюкзак
    fieldConvert: [
      ...((marks.honeyMark ?? 0) > 0 ? [{ name: 'Honey Mark', pollenPerSec: (marks.honeyMark ?? 0) * 2 * avgBeeConvert * 1.25 }] : []),
      ...(tokenConvert > 0 ? [{ name: 'импульсы Gifted Cobalt/Crimson', pollenPerSec: tokenConvert }] : []),
      ...chunks.map((c) => ({ name: c.name, pollenPerSec: c.pollenPerSec })),
    ].sort((a, b) => b.pollenPerSec - a.pollenPerSec),
    toBagPerSec: toBag,
    instantShare: totalPollen ? (instantHoney.v / stats.honeyPerPollen) / totalPollen : 0,
    honeyOnFieldPerSec: onFieldHoney,
    bySource,
    perBee,
    buffs: Object.fromEntries(Object.entries({ ...buffs, ...marks, ...(balloons.rate > 0 ? { balloonAura: auraStacks, balloonBlessing: blessing } : {}) }).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    multipliers: { pollen: pollenX, white: boostMul.white, red: boostMul.red, blue: boostMul.blue, crit: critFactor, beeGather: beeGatherX },
    tokenRates: Object.fromEntries(perGroup.flatMap((g) => g.tokens).reduce((m, t) => m.set(t.name, (m.get(t.name) ?? 0) + t.rate), new Map())),
    hiveBonuses: applied,
    passives: PA.list,
    notModeled: [...notModeled].map(([k, v]) => `${k}: ${v}`),
    irrelevant: [...core.irrelevant].map(([k, v]) => `${k}: ${v}`),
    goo: { perSec: gooPerSec, byColor: Object.fromEntries(COLORS.map((c) => [c, pollenNow > 0 ? gooPerSec * pollen[c] / pollenNow : 0])), honeyPerSec: gooHoney, convertPerSec: gooConvertPollen, cover: gooCover, morph: morph.on },
    notes: [...notes],
    _buffInfo: core.buffInfo,
    _buffsRaw: opts.buffRamp ? null : core.buffs,
  };
}
