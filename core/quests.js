// План прохождения квеста: сколько времени займёт квест этим ульем и на каких полях его делать.
import { COLORS, evaluate, prepare, resolveFieldName } from './model.js';

/** Найти квест по названию (и, если надо, по имени того, кто его даёт). */
export function findQuests(data, query, giver) {
  const q = String(query || '').toLowerCase().trim();
  const g = String(giver || '').toLowerCase().trim();
  return data.quests.filter((x) => (!q || x.name.toLowerCase().includes(q)) && (!g || String(x.giver).toLowerCase().includes(g)));
}

const TOKEN_GROUPS = {
  ability: () => true,
  bomb: (n) => /Bombs?\+?$/.test(n),
  boost: (n) => /Boost$/.test(n),
  mark: (n) => /Mark\+?$/.test(n),
  link: (n) => n === 'Token Link',
};
function tokenRate(rates, name) {
  const key = name.toLowerCase();
  const group = TOKEN_GROUPS[key];
  let r = 0;
  for (const [n, v] of Object.entries(rates)) if (group ? group(n) : n.toLowerCase() === key) r += v;
  return r;
}

/**
 * @param quest  объект квеста из data.quests или { requirements: [...] }
 * @returns { seconds, steps, tokenSteps, skipped, ok }
 */
export function questPlan(data, hive, quest, opts = {}) {
  prepare(data);
  const cache = opts._cache || new Map(); // общий кэш, если считаем несколько квестов для одного улья
  const evalAt = (field) => {
    if (!cache.has(field)) cache.set(field, evaluate(data, hive, { ...opts, field }));
    return cache.get(field);
  };
  const first = evalAt(resolveFieldName(data, opts.field || 'Sunflower Field'));
  const bees = first.bees;
  const enterable = data.fields.filter((f) => f.beesRequired <= bees && f.name !== 'Ant Field' && !/Brick Field|Hub Field/.test(f.name));

  const steps = [];
  const skipped = [];
  const collected = { white: 0, red: 0, blue: 0, total: 0 };
  const add = (r, sec) => {
    for (const c of COLORS) collected[c] += (r.pollenPerHourEffective[c] / 3600) * sec;
    collected.total += (r.pollenPerHourEffective.total / 3600) * sec;
  };
  const rateOf = (r, color) => (color ? r.pollenPerHourEffective[color] : r.pollenPerHourEffective.total) / 3600;

  // 1) требования с конкретным полем
  const byField = new Map();
  for (const req of quest.requirements) {
    if (req.type !== 'pollen' || !req.field) continue;
    const f = resolveFieldName(data, req.field);
    if (!f) { skipped.push(`${req.text} (поле не найдено)`); continue; }
    if (!byField.has(f)) byField.set(f, []);
    byField.get(f).push(req);
  }
  for (const [field, reqs] of byField) {
    const fd = data.fieldByName.get(field);
    if (fd.beesRequired > bees) { skipped.push(`${field}: нужно ${fd.beesRequired} пчёл`); continue; }
    const r = evalAt(field);
    const sec = Math.max(...reqs.map((q) => q.amount / Math.max(1e-9, rateOf(r, q.color))));
    steps.push({ field, seconds: sec, for: reqs.map((q) => q.text) });
    add(r, sec);
  }

  // 2) требования без поля: «собери N (красной) пыльцы» — на лучшем доступном поле
  const generic = quest.requirements.filter((q) => q.type === 'pollen' && !q.field).map((q) => ({ ...q, left: q.amount }));
  const leftOf = (q) => Math.max(0, q.amount - (q.color ? collected[q.color] : collected.total));
  for (let guard = 0; guard < 10; guard++) {
    const open = generic.filter((q) => leftOf(q) > 0);
    if (!open.length) break;
    // делаем самое большое из оставшихся требований на его лучшем поле (остальные копятся заодно)
    const longest = open.sort((a, b) => leftOf(b) - leftOf(a))[0];
    let pick = null;
    for (const f of candidateFields(enterable, longest.color)) {
      const r = evalAt(f.name);
      const sec = leftOf(longest) / Math.max(1e-9, rateOf(r, longest.color));
      if (!pick || sec < pick.sec) pick = { field: f.name, r, sec };
    }
    if (!pick) break;
    steps.push({ field: pick.field, seconds: pick.sec, for: [longest.text] });
    add(pick.r, pick.sec);
  }
  // одно поле могло закрывать несколько требований (сначала «с поля», потом «N пыльцы цвета») — склеиваем
  const merged = [];
  for (const st of steps) {
    const same = merged.find((m) => m.field === st.field);
    if (same) { same.seconds += st.seconds; same.for.push(...st.for.filter((t) => !same.for.includes(t))); } else merged.push({ ...st, for: [...st.for] });
  }
  steps.length = 0;
  steps.push(...merged);
  const pollenSeconds = steps.reduce((a, s) => a + s.seconds, 0);

  // 3) токены: копятся параллельно со сбором (на каком поле — неважно)
  const tokenSteps = [];
  for (const req of quest.requirements.filter((q) => q.type === 'token')) {
    const rate = tokenRate(first.tokenRates, req.token) * first.cycle.fieldShare;
    tokenSteps.push({ text: req.text, seconds: rate > 0 ? req.count / rate : Infinity });
  }
  // мобов не считаем совсем (по решению пользователя), только запоминаем, что они были
  const mobs = quest.requirements.filter((q) => q.type === 'mob').map((q) => q.text);
  // слизь: копится заодно со сбором; «с поля X» — на этом поле, «с белых цветков» — на текущем поле, доля этого цвета
  for (const req of quest.requirements.filter((q) => q.type === 'goo')) {
    const fm = req.text.match(/from (?:the )?(.+?)$/i);
    const color = /white/i.test(req.text) ? 'white' : /red/i.test(req.text) ? 'red' : /blue/i.test(req.text) ? 'blue' : null;
    const fieldName = fm && !color ? resolveFieldName(data, fm[1]) : null;
    const r = fieldName ? evalAt(fieldName) : first;
    const rate = (color ? r.goo?.byColor?.[color] : r.goo?.perSec) * r.cycle.fieldShare;
    if (rate > 0) tokenSteps.push({ text: req.text, seconds: req.amount / rate });
    else skipped.push(`${req.text} (в улье и снаряжении нет слизи)`);
  }
  for (const req of quest.requirements) {
    if (req.type === 'other') skipped.push(`${req.text} (не считается)`);
  }
  const tokenSeconds = tokenSteps.reduce((a, s) => Math.max(a, s.seconds), 0);
  const seconds = Math.max(pollenSeconds, tokenSeconds);
  return { seconds, pollenSeconds, tokenSeconds, steps, tokenSteps, skipped, mobs, ok: Number.isFinite(seconds) };
}

/** Лучшие поля под цвет: где этого цвета больше всего и цветки крупнее. */
function candidateFields(fields, color) {
  const score = (f) => (color ? f.mix[color] : 1) * f.avgSize;
  return [...fields].sort((a, b) => score(b) - score(a)).slice(0, 4);
}

/** Ключ квеста, не зависящий от порядка в данных: «Black Bear|Quests to Mythic Egg (20)|Myth In The Making». */
export const questKey = (q) => `${q.giver || ''}|${q.section || ''}|${q.name}`;

/** Несколько квестов одним ульем: время каждого и сумма (поля считаются один раз для всех). */
export function questsPlan(data, hive, quests, opts = {}) {
  const cache = new Map();
  const perQuest = quests.map((q) => ({ name: q.name, giver: q.giver, key: questKey(q), ...questPlan(data, hive, q, { ...opts, _cache: cache }) }));
  return { seconds: perQuest.reduce((a, p) => a + p.seconds, 0), perQuest, ok: perQuest.every((p) => p.ok) };
}
