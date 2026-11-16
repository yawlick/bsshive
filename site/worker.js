// Считает в фоне, чтобы страница не подвисала во время подбора.
import { evaluate, prepare, stripHiveBonuses, hiveStats, hiveBonusTotals, normalizeHive } from '/core/model.js';
import { optimize, compareFields, nextSteps, swapPlan } from '/core/optimize.js';
import { questPlan, questsPlan } from '/core/quests.js';
import { fitCalibration } from '/core/calibrate.js';
import { playerFromSetup, playerFromMySetup, SLOTS, statKind } from '/core/gear.js';
import { PASSIVES } from '/core/passives.js';

let data = null;
const loadJson = (n) => fetch(`/data/${n}.json`).then((r) => {
  if (!r.ok) throw new Error(`сервер не отдал data/${n}.json (${r.status}) — перезапусти ./run.sh`);
  return r.json();
});
const ready = Promise.all(['bees', 'tokens', 'fields', 'quests', 'gear'].map(loadJson))
  .then(async ([bees, tokens, fields, quests, gear]) => {
    data = prepare({ bees, tokens, fields, quests, gear });
    data.buffs = (await fetch('/data/buffs.json').then((r) => (r.ok ? r.json() : null)).catch(() => null))?.buffs || [];
    // сохранённая подгонка по замерам (может не быть)
    data.calibration = await fetch('/data/calibration.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  });

// статы: из снаряжения (setup.mode 'gear') или из ⚙️ (manual; там уже есть бонусы Gifted моего улья — вычитаем)
const fix = (a) => {
  let out = a;
  if (a.setup) out = { ...a, player: playerFromMySetup(data, a.setup, a.myHive) };
  else if (a.statsFromGame && a.myHive?.length) out = { ...a, player: stripHiveBonuses(data, a.myHive, a.player) };
  // буст поля: стаки Field Boost выбранного поля (код игры, Zone_Buffs: до 4, каждый +100% пыльцы поля — к той же сумме,
  // что и «+X% <Поле> Pollen»); модель ещё усиливает от них конвертацию (Target Practice, Star Shower, кокосы, Flame Fuel)
  const fb = a.fieldBoost;
  if (fb?.stacks > 0 && fb.field && out.player) {
    const n = Math.min(4, fb.stacks);
    const fp = { ...(out.player.fieldPollen || {}) };
    fp[fb.field] = (fp[fb.field] ?? 1) + n;
    out = { ...out, player: { ...out.player, fieldPollen: fp, fieldBoostStacks: { [fb.field]: n } } };
  }
  return out;
};

const run = {
  evaluate: (a) => { const { hive, field, player, calibration } = fix(a); return evaluate(data, hive, { field, player, calibration }); },
  compare: (a) => { const { hive, player, calibration } = fix(a); return compareFields(data, hive, { player, calibration }); },
  quest: (a) => { const { hive, quest, field, player, calibration } = fix(a); return questPlan(data, hive, quest, { field, player, calibration }); },
  optimize: (a, id) => optimize(data, { ...fix(a), onProgress: (p) => self.postMessage({ id, progress: p }) }),
  nextSteps: (a) => { const f = fix(a); return nextSteps(data, f.hive, f); },
  swapPlan: (a, id) => { const f = fix(a); return swapPlan(data, f.hive, { ...f, onProgress: (p) => self.postMessage({ id, progress: p }) }, f.k || 5); },
  quests: (a) => { const { hive, quests, field, player, calibration } = fix(a); return questsPlan(data, hive, quests, { field, player, calibration }); },
  calibrate: (a) => { const { hive, field, player, calibration, measurements } = fix(a); return fitCalibration(data, hive, { field, player, calibration }, measurements); },
  setCalibration: (cal) => { data.calibration = cal; return true; },
  getCalibration: () => data.calibration,
  slots: () => SLOTS,
  passiveList: () => Object.entries(PASSIVES).map(([name, p]) => ({ name, info: p.info || '', skip: p.skip || '' })),
  gearStats: ({ gear, myHive }) => {
    const r = playerFromSetup(data, gear);
    // как в ⚙️ игры: те же статы, но с бонусами Gifted моего улья
    const groups = myHive?.length ? normalizeHive(data, myHive) : [];
    const withHive = hiveStats(data, groups, r.player).stats;
    const hb = hiveBonusTotals(data, groups).byKey;
    for (const b of r.breakdown) { b.inGame = withHive[b.key] ?? b.value; b.hiveSources = hb[b.key] || []; }
    for (const [key, texts] of Object.entries(hb)) {
      if (!r.breakdown.some((b) => b.key === key)) r.breakdown.push({ key, label: key, value: r.player[key], inGame: withHive[key], sources: [], hiveSources: texts });
    }
    const passiveInfo = r.passives.map((x) => {
      const [from, ...rest] = x.split(': ');
      const name = rest.join(': ').trim();
      const p = Object.entries(PASSIVES).find(([k]) => k.toLowerCase() === name.toLowerCase());
      return { name, from, counted: !!p && !p[1].skip, text: p ? (p[1].skip ? `не считается: ${p[1].skip}` : p[1].info + (p[1].partial ? ` (${p[1].partial})` : '')) : 'неизвестная пассивка' };
    });
    return { ...r, player: undefined, passiveInfo, breakdown: r.breakdown.map((b) => ({ ...b, kind: statKind(b.key) })) };
  },
};

self.onmessage = async (e) => {
  await ready;
  const { id, type, args } = e.data;
  try {
    self.postMessage({ id, result: run[type](args, id) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
