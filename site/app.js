// Страница калькулятора: собирает ввод, отправляет расчёт в worker.js и рисует результат.
import { BEST_ID, bestLoadout, newLoadoutId } from '/core/loadouts.js';
import { amuletDef, parseAmulet, amuletLines, emptyAmulet, modLine } from '/core/amulets.js';
import { lineKind, buffLines } from '/core/gear.js';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- форматирование ----------
function fmt(n) {
  if (!Number.isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(2)} трлн`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)} млрд`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)} млн`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)} тыс.`;
  return Math.round(n).toLocaleString('ru');
}
function fmtTime(sec) {
  if (!Number.isFinite(sec)) return 'никогда';
  if (sec < 60) return `${Math.round(sec)} с`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} ч ${String(m % 60).padStart(2, '0')} мин`;
  return `${(h / 24).toFixed(1)} дн.`;
}
const BUFF_RU = {
  redBoost: 'Red Boost, стаков', blueBoost: 'Blue Boost, стаков', whiteBoost: 'White Boost, стаков', inspire: 'Inspire, стаков',
  focus: 'Focus, стаков', babyLove: 'Baby Love, доля времени', bearMorph: 'Bear Morph, доля времени', melody: 'Melody, доля времени',
  puppyLove: 'Puppy Love, доля времени', tabbyBlessing: 'Tabby Blessing, доля времени', redBombSync: 'Red Bomb Sync, доля времени',
  blueBombSync: 'Blue Bomb Sync, доля времени', pollenMark: 'Pollen Mark, стаков (пока стоишь)', honeyMark: 'Honey Mark, стаков (пока стоишь)',
  flameHeat: 'Flame Heat, множитель красной', haste: 'Haste, стаков (скорость игрока)',
  balloonAura: 'Balloon Aura, стаков (шарики Buoyant)', balloonBlessing: 'Balloon Blessing, стаков (ГРУБО)',
  popStar: 'Pop Star, доля времени', bubbleBloat: 'Bubble Bloat, множитель', scorchingStar: 'Scorching Star, доля времени',
  precision: 'Precision, стаков (+2% суперкрита)', preciseMark: 'Precise Mark, стаков (пока стоишь)', flameFuel: 'Flame Fuel, доля времени',
  coconutCombo: 'Coconut Combo, доля времени',
};
// ---------- иконки пчёл ----------
// Как в меню пчёл в игре: закруглённый квадрат цвета тела пчелы и лицо, окрашенное в цвет лица
// (картинка лица белая, игра умножает её на Decal.Color3 — делаем так же на canvas). Данные: data/bee-icons.json.
const beeIcons = new Map(); // ключ пчелы (Bumble) → data:URL
function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function buildBeeIcons(meta) {
  const S = 96; // рисуем крупно — на экране иконка 20…40 px, на ретине остаётся чёткой
  return Promise.all(Object.entries(meta || {}).map(([key, m]) => new Promise((resolve) => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    roundRectPath(g, 0, 0, S, S, S * 0.2);
    g.fillStyle = m.body || '#1b2a35';
    g.fill();
    const done = () => { beeIcons.set(key, c.toDataURL('image/png')); resolve(); };
    if (!m.face) { done(); return; }
    const img = new Image();
    img.onload = () => {
      const f = document.createElement('canvas');
      f.width = f.height = S;
      const fg = f.getContext('2d');
      fg.drawImage(img, 0, 0, S, S);
      fg.globalCompositeOperation = 'multiply'; // лицо × цвет лица
      fg.fillStyle = m.faceColor || '#ffffff';
      fg.fillRect(0, 0, S, S);
      fg.globalCompositeOperation = 'destination-in'; // вернуть прозрачность рисунка
      fg.drawImage(img, 0, 0, S, S);
      g.save();
      roundRectPath(g, 0, 0, S, S, S * 0.2);
      g.clip();
      g.drawImage(f, 0, 0);
      g.restore();
      done();
    };
    img.onerror = done;
    img.src = `/img/faces/${key}.png`;
  })));
}
/** Иконка пчелы; у Gifted — звёздочка в углу. */
function beeImg(name, gifted, size = 26) {
  const b = beeByName.get(name);
  const url = b?.imageKey && beeIcons.get(b.imageKey);
  if (!url) return `<span class="dot ${b?.color || 'white'}"></span>`;
  return `<span class="bee-ico${gifted ? ' gifted' : ''}" style="width:${size}px;height:${size}px" title="${esc(name)}${gifted ? ' (Gifted)' : ''}"><img src="${url}" alt=""></span>`;
}
// ---------- иконки токенов и баффов ----------
// Как в игре (Collectibles.<Тип>.Visuals, описания баффов): круг цвета фона и картинка, умноженная на свой цвет
// (белые шаблоны красятся, цветные картинки остаются как есть). Данные — data/token-icons.json (scripts/build-icons.mjs).
const roundIcons = new Map(); // "фон|картинка|цвет" → data:URL
const lookKey = (l) => `${l.bg}|${l.icon}|${l.iconColor}`;
function buildRoundIcons(looks) {
  const S = 64;
  const todo = [...new Map(looks.filter((l) => l?.icon && l.img !== false).map((l) => [lookKey(l), l])).values()].filter((l) => !roundIcons.has(lookKey(l)));
  return Promise.all(todo.map((l) => new Promise((resolve) => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1.5, 0, Math.PI * 2); g.closePath();
    g.fillStyle = l.bg || '#222'; g.fill();
    g.lineWidth = 2.5; g.strokeStyle = 'rgba(0,0,0,.28)'; g.stroke();
    const done = () => { roundIcons.set(lookKey(l), c.toDataURL('image/png')); resolve(); };
    const img = new Image();
    img.onload = () => {
      const f = document.createElement('canvas');
      f.width = f.height = S;
      const fg = f.getContext('2d');
      const p = S * 0.14;
      fg.drawImage(img, p, p, S - 2 * p, S - 2 * p);
      fg.globalCompositeOperation = 'multiply'; // картинка × её цвет (Decal.Color3 / IconColor)
      fg.fillStyle = l.iconColor || '#ffffff';
      fg.fillRect(0, 0, S, S);
      fg.globalCompositeOperation = 'destination-in';
      fg.drawImage(img, p, p, S - 2 * p, S - 2 * p);
      g.drawImage(f, 0, 0);
      done();
    };
    img.onerror = done;
    img.src = `/img/icons/${l.icon}.png`;
  })));
}
/** Иконка по описанию вида { bg, icon, iconColor } (или пусто). */
function lookImg(l, size = 22, title = '') {
  const url = l && roundIcons.get(lookKey(l));
  return url ? `<span class="tok" style="width:${size}px;height:${size}px"${title ? ` title="${esc(title)}"` : ''}><img src="${url}" alt=""></span>` : '';
}
// ключи баффов модели → имена баффов в игре (для иконок в «Баффах и множителях»)
const BUFF_GAME_NAME = {
  redBoost: 'Red Boost', blueBoost: 'Blue Boost', whiteBoost: 'White Boost', inspire: 'Inspire', focus: 'Focus', babyLove: 'Baby Love',
  bearMorph: 'Brown Bear Morph', melody: 'Melody', puppyLove: 'Puppy Love', tabbyBlessing: 'Tabby Blessing', redBombSync: 'Red Bomb Sync',
  blueBombSync: 'Blue Bomb Sync', pollenMark: 'Pollen Mark', honeyMark: 'Honey Mark', flameHeat: 'Flame Heat', haste: 'Haste',
  bubbleBloat: 'Bubble Bloat', balloonAura: 'Balloon Aura', balloonBlessing: 'Balloon Blessing', precision: 'Precision', preciseMark: 'Precise Mark', flameFuel: 'Flame Fuel',
};
/** Иконка токена / баффа по имени из модели («Red Bomb», «Target Practice (выстрел по игроку)», ключ redBoost…). */
function iconFor(name, size = 20) {
  const T = data.icons;
  if (!T) return '';
  const base = String(name).replace(/ \(.*\)$/, '');
  const l = T.tokens[name] || T.tokens[base] || T.buffs[name] || T.buffs[base] || T.buffs[BUFF_GAME_NAME[name]] || T.tokens[BUFF_GAME_NAME[name]];
  return lookImg(l, size, base);
}

const RARITY_RU = { common: 'обычная', rare: 'редкая', epic: 'эпическая', legendary: 'легендарная', mythic: 'мифическая', event: 'ивентовая' };
const COLOR_RU = { white: 'белая', red: 'красная', blue: 'синяя' };

// ---------- состояние ----------
// ручной режим: цифры из меню ⚙️ в игре
const STATS = [
  ['capacity', 'Рюкзак, пыльцы', 'num', 250000],
  ['toolPollenPerSec', 'Инструмент, пыльцы/с', 'num', 0],
  ['pollen', 'Pollen', 'pct', 1],
  ['white', 'White Pollen', 'pct', 1],
  ['red', 'Red Pollen', 'pct', 1],
  ['blue', 'Blue Pollen', 'pct', 1],
  ['beeGather', 'Bee Gather Pollen', 'pct', 1],
  ['bomb', 'Bomb Pollen', 'pct', 1],
  ['critChance', 'Critical Chance', 'chance', 0],
  ['critPower', 'Critical Power', 'pct', 2],
  ['superCritChance', 'Super-Crit Chance', 'chance', 0],
  ['convertRate', 'Convert Rate', 'pct', 1],
  ['convertRateHive', 'Convert Rate At Hive', 'pct', 1],
  ['honeyPerPollen', 'Honey Per Pollen', 'pct', 1],
  ['instantConversion', 'Instant Conversion', 'chance', 0],
  ['abilityRate', 'Bee Ability Rate', 'pct', 1],
  ['capacityMul', 'Capacity Multiplier', 'pct', 1],
];
const RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythic', 'event'];

const saved = (() => { try { return JSON.parse(localStorage.getItem('bsshive') || '{}'); } catch { return {}; } })();
const state = {
  hive: saved.hive || [],
  goal: saved.goal || 'honey',
  field: saved.field || 'Sunflower Field',
  quest: saved.quest ?? null,
  // откуда статы: mode 'gear' — из снаряжения/бейджей/амулетов, 'manual' — цифры из ⚙️
  setup: {
    mode: 'gear',
    gear: { badges: {}, amulets: [], extra: '' },
    manual: { ...Object.fromEntries(STATS.map(([k, , , d]) => [k, d])), ...saved.stats },
    statsFromGame: saved.statsFromGame ?? true,
    walkSeconds: saved.stats?.walkSeconds ?? 20,
    tabbyStacks: saved.stats?.tabbyStacks ?? '',
    tab: 'gear',
    ...saved.setup,
  },
  opt: { slots: 0, level: 0, keep: false, limits: null, ...saved.opt }, // limits: имя → { allow, max, maxGifted }
  quests: saved.quests || [], // выбранные квесты (ключи «медведь|раздел|название»)
  questGiver: saved.questGiver ?? 'Black Bear',
  pick: { level: 10, gifted: false, ...saved.pick }, // настройки окна «добавить пчёл»
  // лодауты: { active, list: [{ id, name, hive, setup, opt } | { id: 'best', builtin: true, opt }] };
  // state.hive / state.setup / state.opt — рабочая копия активного лодаута (save() переносит её в список)
  loadouts: saved.loadouts?.list ? saved.loadouts : null,
};
delete state.stats;
let meTimer = null;
// проверочные запуски (?auto=… из headless-браузера) ничего не сохраняют — ни в браузер, ни в проект
const TEST_RUN = /[?&]auto=/.test(location.search);
let lastSent = null; // лодауты, которые последними ушли в проект (или пришли из него) — одинаковое не отправляем
const save = () => {
  // встроенный лодаут менять нельзя: изменение откатываем и предлагаем копию (до TEST_RUN — чтобы проверялось и в тестах)
  if (guardReadonly()) return;
  syncActive();
  if (TEST_RUN) return;
  try { localStorage.setItem('bsshive', JSON.stringify(state)); } catch { /* приватный режим и т.п. */ }
  // лодауты — ещё и в проект (data/loadouts.json; активный — в data/my-hive.json и my-setup.json), чтобы их видел Claude
  clearTimeout(meTimer);
  meTimer = setTimeout(postMe, 800);
};
async function postMe() {
  if (!state.loadouts) return;
  const payload = JSON.stringify(state.loadouts);
  if (payload === lastSent) return;
  // rev — какую версию данных видела эта страница; если файл поменяли в другом месте (другая вкладка, Claude),
  // сервер вернёт 409, и мы подтянем свежие данные вместо того, чтобы затереть их
  const res = await fetch('/api/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rev: state.rev ?? 0, loadouts: state.loadouts }) }).catch(() => null);
  if (!res) return;
  const j = await res.json().catch(() => ({}));
  if (res.ok && j.rev !== undefined) { state.rev = j.rev; lastSent = payload; }
  else if (res.status === 409) reloadMine('Данные изменились в другом месте — подтянул свежие');
}
const fetchJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
/** Подтянуть лодауты из проекта (после конфликта версий). */
async function reloadMine(message) {
  const lf = await fetchJson('/data/loadouts.json');
  if (!lf?.list) {
    // лодаутов в проекте ещё нет — значит, поменялся my-setup.json; берём его версию и сохраняем своё
    state.rev = (await fetchJson('/data/my-setup.json'))?.rev ?? 0;
    lastSent = null; save();
    return;
  }
  setLoadouts(lf);
  applyLoadout(state.loadouts.active);
  try { localStorage.setItem('bsshive', JSON.stringify(state)); } catch { /* ничего */ }
  renderAfterSwitch();
  if (message) toast(message);
}
/** Всплывающее сообщение; action — { label, run } для кнопки (например «Вернуть»). */
function toast(text, action) {
  document.querySelectorAll('.toast').forEach((x) => x.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.append(text);
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.addEventListener('click', () => { action.run(); t.remove(); });
    t.append(b);
  }
  document.body.append(t);
  setTimeout(() => t.classList.add('hide'), action ? 5200 : 3200);
  setTimeout(() => t.remove(), action ? 5700 : 3700);
}

// ---------- отмена изменений улья (Ctrl+Z и «Вернуть» во всплывашке) ----------
const hiveHistory = [];
/** Запомнить улей перед изменением. */
function rememberHive() {
  hiveHistory.push(JSON.stringify(state.hive));
  if (hiveHistory.length > 50) hiveHistory.shift();
}
function undoHive() {
  const prev = hiveHistory.pop();
  if (!prev) { toast('Нечего отменять'); return; }
  state.hive = JSON.parse(prev);
  closeEditor();
  renderHive();
  toast('Отменено');
}

let data = null;
let beeByName = new Map();

// ---------- лодауты ----------
// Наборы «улей + статы + настройки подбора» (например, для разных аккаунтов). Встроенный «Лучшее» строится в
// core/loadouts.js и не меняется: любое изменение откатывается, а страница предлагает сделать копию с этим изменением.
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const DEFAULT_SETUP = () => ({ mode: 'gear', gear: { badges: {}, amulets: [], extra: '' }, manual: Object.fromEntries(STATS.map(([k, , , d]) => [k, d])), statsFromGame: true, walkSeconds: 20, tabbyStacks: '' });
const DEFAULT_OPT = () => ({ slots: 0, level: 0, keep: false, limits: null });
/** Настройка статов со всеми полями по умолчанию (без служебных rev/savedAt и вкладки). */
function fullSetup(src) {
  const d = DEFAULT_SETUP();
  const c = clone(src) || {};
  for (const k of ['rev', 'savedAt', 'loadout', 'tab']) delete c[k];
  return { ...d, ...c, gear: { ...d.gear, ...c.gear }, manual: { ...d.manual, ...c.manual } };
}
let builtinBest = null; // встроенный «Лучшее» (bestLoadout), строится после загрузки данных
let readonlySig = null; // данные встроенного лодаута, как они загружены (если активен он)
const loadoutById = (id) => state.loadouts?.list.find((l) => l.id === id);
const activeLoadout = () => loadoutById(state.loadouts?.active);
/** Имя, улей и статы лодаута (у встроенного — из bestLoadout). */
const loadoutData = (l) => (l?.builtin ? builtinBest : l);
const dataSig = () => JSON.stringify([state.hive, { ...state.setup, tab: undefined }]);
function setLoadouts(file) {
  state.loadouts = { active: file.active, list: clone(file.list) };
  if (!state.loadouts.list.some((l) => l.id === BEST_ID)) state.loadouts.list.unshift({ id: BEST_ID, builtin: true });
  state.rev = file.rev ?? 0;
  lastSent = JSON.stringify(state.loadouts);
}
/** Рабочую копию (state.hive / setup / opt) — в запись активного лодаута. */
function syncActive() {
  const l = activeLoadout();
  if (!l) return;
  if (!l.builtin) { l.hive = clone(state.hive); l.setup = clone({ ...state.setup, tab: undefined }); }
  l.opt = clone(state.opt);
}
/** Сделать лодаут id рабочим (без отрисовки). */
function applyLoadout(id) {
  const list = state.loadouts.list;
  const l = loadoutById(id) || list.find((x) => !x.builtin) || list[0];
  state.loadouts.active = l.id;
  const d = loadoutData(l);
  const tab = state.setup?.tab || 'gear';
  state.hive = (clone(d.hive) || []).filter((g) => beeByName.has(g.name));
  state.setup = fullSetup(d.setup);
  state.setup.tab = tab;
  state.opt = { ...DEFAULT_OPT(), ...clone(l.opt) };
  normalizeHive();
  hiveHistory.length = 0; // «Вернуть» не должен переносить улей из другого лодаута
  closeEditor();
  readonlySig = l.builtin ? dataSig() : null;
}
/** Перерисовать всё, что зависит от лодаута. */
function renderAfterSwitch() {
  if ($('runOpt').disabled) { cancelWork(); busy(false); }
  renderHive(); renderStatsCard(); renderOpt(); renderLoadouts(); renderRoBanner();
  $('out').innerHTML = ''; // результаты были для другого лодаута
  $('emptyState').hidden = false;
}
function switchLoadout(id) {
  if (!state.loadouts || id === state.loadouts.active) return;
  syncActive();
  applyLoadout(id);
  renderAfterSwitch();
  save();
}
/** Встроенный лодаут изменили — откатить и предложить копию. true — изменение было и его откатили. */
function guardReadonly() {
  if (readonlySig === null || !activeLoadout()?.builtin || dataSig() === readonlySig) return false;
  const pending = { hive: clone(state.hive), setup: clone({ ...state.setup, tab: undefined }) };
  const tab = state.setup.tab;
  state.hive = clone(builtinBest.hive);
  state.setup = fullSetup(builtinBest.setup);
  state.setup.tab = tab;
  normalizeHive();
  closeEditor();
  renderHive(); renderStatsCard();
  openCopyDialog(pending);
  return true;
}
let pendingCopy = null;
function openCopyDialog(pending) {
  pendingCopy = pending;
  const d = $('roDialog');
  if (!d.hidden) return;
  d.hidden = false;
  requestAnimationFrame(() => d.classList.add('show'));
  setTimeout(() => d.querySelector('[data-ro="copy"]')?.focus(), 40);
}
function closeCopyDialog() {
  const d = $('roDialog');
  d.classList.remove('show');
  setTimeout(() => { d.hidden = true; }, 160);
  pendingCopy = null;
}
function uniqueName(base) {
  const names = new Set(state.loadouts.list.map((l) => loadoutData(l).name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}
/** Копия лодаута srcId (сразу за ним); override — улей/статы, которые положить в копию вместо исходных. */
function copyLoadout(srcId, override = null) {
  syncActive();
  const src = loadoutById(srcId);
  const d = loadoutData(src);
  const l = { id: newLoadoutId(), name: uniqueName(`${d.name} — копия`), hive: clone(override?.hive ?? d.hive) || [], setup: clone(override?.setup ?? d.setup) || {}, opt: clone(src.opt) };
  delete l.setup.tab;
  state.loadouts.list.splice(state.loadouts.list.indexOf(src) + 1, 0, l);
  applyLoadout(l.id);
  renderAfterSwitch();
  save();
  toast(`Создан лодаут «${l.name}» — его можно менять`);
  return l;
}
function newLoadout() {
  syncActive();
  const setup = fullSetup(null);
  const l = { id: newLoadoutId(), name: uniqueName('Новый лодаут'), hive: [], setup, opt: DEFAULT_OPT() };
  state.loadouts.list.push(l);
  applyLoadout(l.id);
  renderAfterSwitch();
  save();
  startRename(l.id);
}
function deleteLoadout(id) {
  const list = state.loadouts.list;
  const i = list.findIndex((l) => l.id === id);
  const l = list[i];
  if (!l || l.builtin) return;
  syncActive();
  const snapshot = clone(state.loadouts);
  list.splice(i, 1);
  if (state.loadouts.active === id) { applyLoadout((list[i] || list[i - 1] || list[0]).id); renderAfterSwitch(); } else renderLoadouts();
  save();
  toast(`Удалён лодаут «${l.name}»`, { label: 'Вернуть', run: () => { state.loadouts = snapshot; applyLoadout(snapshot.active); renderAfterSwitch(); save(); } });
}
function moveLoadout(id, delta) {
  const list = state.loadouts.list;
  const i = list.findIndex((l) => l.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  save(); renderLoadouts();
  $('loList').querySelector(`[data-id="${CSS.escape(id)}"] .lo-main`)?.focus();
}
function startRename(id) {
  const l = loadoutById(id);
  const li = $('loList').querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!l || l.builtin || !li) return;
  const inp = document.createElement('input');
  inp.type = 'text'; inp.className = 'lo-rename'; inp.value = l.name; inp.maxLength = 60; inp.setAttribute('aria-label', 'Название лодаута');
  li.querySelector('.lo-main').replaceWith(inp);
  inp.focus(); inp.select();
  let done = false;
  const finish = (ok) => {
    if (done) return;
    done = true;
    const v = inp.value.trim();
    if (ok && v && v !== l.name) { l.name = v; save(); }
    renderLoadouts();
  };
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
}
function loadoutMeta(l) {
  const d = loadoutData(l);
  const n = (d.hive || []).reduce((a, g) => a + g.count, 0);
  const st = d.setup?.mode === 'manual' ? 'статы вручную' : (d.setup?.gear?.tool || 'без инструмента');
  return `${n ? `${n} ${plural(n, 'пчела', 'пчелы', 'пчёл')}` : 'без улья'} · ${st}`;
}
function renderLoadouts() {
  if (!state.loadouts) return;
  const act = state.loadouts.active;
  $('loList').innerHTML = state.loadouts.list.map((l) => {
    const d = loadoutData(l);
    const on = l.id === act;
    return `<li class="lo-item${on ? ' active' : ''}${l.builtin ? ' builtin' : ''}" data-id="${esc(l.id)}">
      <span class="lo-grip" title="Перетащи, чтобы переставить">⋮⋮</span>
      <button class="lo-main" data-lo="open" ${on ? 'aria-current="true"' : ''} title="${l.builtin ? 'Встроенный: лучшие вещи, бейджи и амулеты. Менять нельзя — только скопировать' : 'Открыть · двойной клик — переименовать · Alt+↑/↓ — переставить'}">
        <b class="lo-name">${l.builtin ? '🔒 ' : ''}${esc(d.name)}</b><span class="lo-meta">${esc(loadoutMeta(l))}</span></button>
      <span class="lo-actions">${l.builtin ? '' : '<button data-lo="rename" title="Переименовать" aria-label="Переименовать">✎</button>'}<button data-lo="copy" title="Сделать копию" aria-label="Сделать копию">⧉</button>${l.builtin ? '' : '<button data-lo="delete" title="Удалить" aria-label="Удалить">✕</button>'}</span>
    </li>`;
  }).join('');
  // на телефоне список — полоса с прокруткой вбок: показать активный
  const list = $('loList');
  const a = list.querySelector('.lo-item.active');
  if (a && list.scrollWidth > list.clientWidth) list.scrollLeft += a.getBoundingClientRect().left - list.getBoundingClientRect().left - 8;
}
/** Полоса над вкладками, когда открыт встроенный лодаут. */
function renderRoBanner() {
  const on = !!activeLoadout()?.builtin;
  $('roBanner').hidden = !on;
}
/** Перетаскивание лодаутов в списке (мышью — за всю строку, пальцем — за ⋮⋮). */
function bindLoadoutDrag() {
  const list = $('loList');
  let drag = null;
  let justDragged = false;
  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('.lo-item');
    if (!li || e.button !== 0 || e.target.closest('.lo-actions, input')) return;
    if (e.pointerType !== 'mouse' && !e.target.closest('.lo-grip')) return;
    drag = { li, y0: e.clientY, pid: e.pointerId, started: false };
  });
  const move = (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    if (!drag.started) {
      if (Math.abs(e.clientY - drag.y0) < 6) return;
      drag.started = true;
      drag.li.classList.add('dragging');
      document.body.classList.add('lo-dragging');
    }
    e.preventDefault();
    // переставляем, пока центр строки перешёл середину соседа; y0 сдвигаем на столько, на сколько сдвинулась строка
    for (;;) {
      const top0 = drag.li.offsetTop;
      const r = drag.li.getBoundingClientRect();
      const c = (r.top + r.bottom) / 2 + (e.clientY - drag.y0) - (drag.shown ?? 0);
      const prev = drag.li.previousElementSibling;
      const next = drag.li.nextElementSibling;
      const mid = (el) => { const b = el.getBoundingClientRect(); return (b.top + b.bottom) / 2; };
      if (prev && c < mid(prev)) list.insertBefore(drag.li, prev);
      else if (next && c > mid(next)) list.insertBefore(drag.li, next.nextElementSibling);
      else break;
      drag.y0 += drag.li.offsetTop - top0;
    }
    drag.shown = e.clientY - drag.y0;
    drag.li.style.transform = `translateY(${drag.shown}px)`;
  };
  const end = (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    drag = null;
    if (!d.started) return;
    d.li.classList.remove('dragging');
    d.li.style.transform = '';
    document.body.classList.remove('lo-dragging');
    justDragged = true;
    setTimeout(() => { justDragged = false; }, 0);
    const order = [...list.children].map((li) => li.dataset.id);
    const before = state.loadouts.list.map((l) => l.id).join();
    state.loadouts.list = order.map(loadoutById).filter(Boolean);
    if (order.join() !== before) save();
    renderLoadouts();
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  list.addEventListener('click', (e) => {
    if (justDragged) { e.stopPropagation(); return; }
    const btn = e.target.closest('[data-lo]');
    const id = e.target.closest('.lo-item')?.dataset.id;
    if (!btn || !id) return;
    const act = btn.dataset.lo;
    if (act === 'open') switchLoadout(id);
    else if (act === 'rename') startRename(id);
    else if (act === 'copy') copyLoadout(id);
    else if (act === 'delete') deleteLoadout(id);
  }, true);
  list.addEventListener('dblclick', (e) => { const id = e.target.closest('.lo-main') && e.target.closest('.lo-item')?.dataset.id; if (id) startRename(id); });
  list.addEventListener('keydown', (e) => {
    const id = e.target.closest('.lo-main') && e.target.closest('.lo-item')?.dataset.id;
    if (!id) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveLoadout(id, e.key === 'ArrowUp' ? -1 : 1); }
    else if (e.key === 'F2') { e.preventDefault(); startRename(id); }
  });
}

// ---------- worker ----------
// расчёты — в отдельном потоке; долгий подбор можно отменить (поток пересоздаётся)
let worker = null;
let seq = 0;
const pending = new Map();
function startWorker() {
  worker = new Worker('/worker.js', { type: 'module' });
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    if (e.data.progress) { p.onProgress?.(e.data.progress); return; }
    pending.delete(e.data.id);
    if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.result);
  };
}
startWorker();
const call = (type, args, onProgress) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject, onProgress }); worker.postMessage({ id, type, args }); });
function cancelWork() {
  worker.terminate();
  for (const p of pending.values()) p.reject(Object.assign(new Error('Отменено'), { cancelled: true }));
  pending.clear();
  startWorker();
  if (data?.calibration !== undefined) call('setCalibration', data.calibration);
}

// ---------- ввод ----------
const calibration = () => ({ walkSeconds: Number(state.setup.walkSeconds) || 20 });
/** То, что уходит в каждый расчёт: настройка статов (worker сам посчитает из неё статы), мой улей и калибровка. */
const base = () => ({ setup: state.setup, myHive: state.hive, calibration: calibration(), fieldBoost: { field: state.field, stacks: state.fieldBoostStacks || 0 } });
const totalBees = () => state.hive.reduce((a, g) => a + g.count, 0);

// ---------- улей: сетка лиц ----------
// цвета редкостей — из игры (ReplicatedStorage.BeeTypes.ColorCommon…ColorEvent)
const RARITY_COLOR = { common: '#ae792f', rare: '#dcdde4', epic: '#f5d010', legendary: '#4bf6e0', mythic: '#bda4ff', event: '#9eea6a' };
const sig = (g) => `${g.name}|${g.level}|${g.gifted ? 1 : 0}|${g.mutation ? `${g.mutation.id}=${g.mutation.value}` : ''}`;
/** Склеить одинаковых пчёл в группы (порядок сохраняется). */
function normalizeHive() {
  const out = [];
  const at = new Map();
  for (const g of state.hive) {
    if (!(g.count > 0)) continue;
    const k = sig(g);
    if (at.has(k)) out[at.get(k)].count += g.count;
    else { at.set(k, out.length); out.push({ ...g }); }
  }
  state.hive = out;
}
const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
let freshSig = null; // только что добавленная/изменённая пчела — ей анимация появления
let hiveIntro = true; // первая отрисовка — плитки появляются волной

function beeTile(g, gi, k, idx) {
  const b = beeByName.get(g.name);
  const url = b?.imageKey && beeIcons.get(b.imageKey);
  const mut = g.mutation && mutDef(g.mutation.id);
  const fresh = freshSig === sig(g) && k === g.count - 1;
  return `<button class="bee-tile${g.gifted ? ' gifted' : ''}${fresh ? ' pop' : ''}" data-gi="${gi}" style="--rar:${RARITY_COLOR[b?.rarity] || '#999'};--i:${Math.min(idx, 50)}" aria-label="${esc(g.name)}, уровень ${g.level}${g.gifted ? ', Gifted' : ''}">
    <span class="face">${url ? `<img src="${url}" alt="" draggable="false">` : `<span class="noimg">${esc(g.name[0])}</span>`}<span class="lvl"${mut ? ` style="color:${mut.color}"` : ''}>${g.level}</span></span>
  </button>`;
}

function renderHive() {
  normalizeHive();
  if (state.opt.slots) slotsHint();
  const tiles = [];
  let idx = 0;
  state.hive.forEach((g, gi) => { for (let k = 0; k < g.count; k++) tiles.push(beeTile(g, gi, k, idx++)); });
  const grid = $('hiveGrid');
  grid.classList.toggle('intro', hiveIntro);
  grid.innerHTML = `${tiles.join('')}<button class="bee-tile add" data-add="1" title="Добавить пчёл"><span class="face">+</span></button>`;
  hiveIntro = false;
  freshSig = null;
  const n = totalBees();
  const gifted = state.hive.filter((g) => g.gifted).reduce((a, g) => a + g.count, 0);
  const avg = n ? state.hive.reduce((a, g) => a + g.level * g.count, 0) / n : 0;
  $('hiveTabCount').textContent = n ? `· ${n}` : '';
  $('hiveCount').textContent = n ? `${n} ${plural(n, 'пчела', 'пчелы', 'пчёл')}${n > 50 ? ' — больше 50!' : ''}` : '';
  $('hiveMeta').innerHTML = n
    ? `<span>🌟 Gifted: <b>${gifted}</b></span><span>средний уровень <b>${avg.toFixed(1)}</b></span><span class="muted">ЛКМ — изменить · ПКМ — убрать</span>`
    : activeLoadout()?.builtin ? '<span class="muted">Во встроенном лодауте улья нет: нажми «Подобрать лучший» или скопируй лодаут и добавь своих пчёл</span>'
      : '<span class="muted">Пусто — нажми «+», чтобы добавить пчёл</span>';
  $('hiveText').value = state.hive.map((g) => `${g.gifted ? 'Gifted ' : ''}${g.name} x${g.count} L${g.level}${g.mutation ? ` M:${g.mutation.id}=${g.mutation.value}` : ''}`).join(', ');
  save();
}

/** Убрать одну пчелу из группы gi — с анимацией. */
function removeBee(gi, el) {
  if (!el || el.classList.contains('bye')) return;
  hideTip();
  el.classList.add('bye');
  setTimeout(() => {
    const g = state.hive[gi];
    rememberHive();
    if (g) g.count -= 1;
    if (editing && editing.sig === sig(g || {}) && !(g?.count > 0)) closeEditor();
    renderHive();
    if (editing) placeEditor();
    toast(`Убрана: ${g?.name || 'пчела'}`, { label: 'Вернуть', run: undoHive });
  }, 240);
}

/** Изменить одну пчелу из группы gi: она отделяется от группы и встаёт сразу за ней. */
function editOne(gi, patch) {
  const g = state.hive[gi];
  if (!g) return;
  const one = { ...g, count: 1, ...patch };
  if (patch.mutation === null) delete one.mutation;
  rememberHive();
  g.count -= 1;
  state.hive.splice(gi + 1, 0, one);
  freshSig = sig(one);
  editing = { sig: sig(one) };
  renderHive();
  placeEditor();
}

// ---------- подсказка при наведении ----------
function showTip(el) {
  const g = state.hive[Number(el.dataset.gi)];
  if (!g) return;
  const b = beeByName.get(g.name);
  const mut = g.mutation && mutDef(g.mutation.id);
  const tip = $('beeTip');
  tip.innerHTML = `<b>${esc(g.name)}</b><span><span class="rar-pill" style="--rar:${RARITY_COLOR[b?.rarity]}">${RARITY_RU[b?.rarity] || ''}</span></span>
    <span>уровень ${g.level}${g.gifted ? ' · 🌟 Gifted' : ''}</span>${mut ? `<span style="color:${mut.color}">☢ ${esc(mutLabel(g.mutation))}</span>` : ''}
    <span class="muted">${b?.color === 'red' ? '🔴 красная' : b?.color === 'blue' ? '🔵 синяя' : '⚪ белая'}</span>`;
  const r = el.getBoundingClientRect();
  tip.hidden = false;
  const w = tip.offsetWidth;
  tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  tip.style.top = `${r.top - tip.offsetHeight - 10 < 8 ? r.bottom + 10 : r.top - tip.offsetHeight - 10}px`;
  tip.classList.add('show');
}
function hideTip() { const t = $('beeTip'); t.classList.remove('show'); t.hidden = true; }

// ---------- редактор пчелы (ЛКМ по лицу) ----------
let editing = null; // { sig } — какую пчелу редактируем
function editorGroup() { const gi = state.hive.findIndex((g) => sig(g) === editing?.sig); return gi < 0 ? null : { gi, g: state.hive[gi] }; }
function closeEditor() { editing = null; const p = $('beePop'); p.classList.remove('show'); p.hidden = true; }
function placeEditor() {
  const eg = editorGroup();
  if (!eg) { closeEditor(); return; }
  const { gi, g } = eg;
  const b = beeByName.get(g.name);
  const url = b?.imageKey && beeIcons.get(b.imageKey);
  const d = g.mutation && mutDef(g.mutation.id);
  const pop = $('beePop');
  pop.innerHTML = `<div class="pop-head">
      <span class="face big${g.gifted ? ' gifted' : ''}">${url ? `<img src="${url}" alt="">` : ''}</span>
      <div><b>${esc(g.name)}</b><div class="small"><span class="rar-pill" style="--rar:${RARITY_COLOR[b?.rarity]}">${RARITY_RU[b?.rarity] || ''}</span>${g.count > 1 ? ` <span class="muted">таких в улье ${g.count}</span>` : ''}</div></div>
      <button class="x" data-act="close" title="Закрыть">×</button></div>
    <div class="pop-row"><span>Уровень</span><div class="stepper"><button data-act="lvl-" ${g.level <= 1 ? 'disabled' : ''}>−</button><b>${g.level}</b><button data-act="lvl+" ${g.level >= 25 ? 'disabled' : ''}>+</button></div></div>
    <div class="pop-row"><span>Gifted</span><button class="toggle${g.gifted ? ' on' : ''}" data-act="gift" aria-pressed="${g.gifted}"><i></i></button></div>
    <div class="pop-row col"><span>Мутация <span class="muted small">(цвет цифры уровня)</span></span>
      <select data-act="mut"><option value="">— нет —</option>${data.mutations.map((m) => `<option value="${m.id}" ${g.mutation?.id === m.id ? 'selected' : ''}>${esc(m.name)} ${m.op === 'mul' ? '×' : '+'} · ${esc(m.colorName)}</option>`).join('')}</select>
      ${d ? `<div class="row"><input type="number" data-act="mutval" step="${d.step}" value="${g.mutation.value}"><span class="muted small">${d.min} … ${d.max}</span></div>` : ''}</div>
    <div class="pop-actions"><button class="btn small" data-act="dup">+1 такая же</button><button class="btn small danger" data-act="del">Убрать</button></div>`;
  pop.dataset.gi = gi;
  pop.hidden = false;
  const tile = [...document.querySelectorAll(`.bee-tile[data-gi="${gi}"]`)].pop();
  const r = tile ? tile.getBoundingClientRect() : { left: 100, bottom: 100, top: 100, width: 0 };
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const below = r.bottom + 10 + h < window.innerHeight;
  pop.style.left = `${left + window.scrollX}px`;
  pop.style.top = `${(below ? r.bottom + 10 : Math.max(8, r.top - h - 10)) + window.scrollY}px`;
  requestAnimationFrame(() => pop.classList.add('show'));
}

// ---------- выбор пчёл («+») ----------
function renderPicker() {
  const q = $('pickSearch').value.trim().toLowerCase();
  const have = new Map();
  for (const g of state.hive) have.set(g.name, (have.get(g.name) || 0) + g.count);
  $('pickLevel').textContent = state.pick.level;
  $('pickGifted').classList.toggle('on', state.pick.gifted);
  $('pickList').innerHTML = RARITIES.map((r) => {
    const list = data.bees.filter((b) => b.rarity === r && (!q || b.name.toLowerCase().includes(q)));
    if (!list.length) return '';
    return `<h3><span class="rar-pill" style="--rar:${RARITY_COLOR[r]}">${RARITY_RU[r]}</span></h3><div class="pick-grid">${list.map((b) => {
      const url = b.imageKey && beeIcons.get(b.imageKey);
      const n = have.get(b.name) || 0;
      return `<button class="pick" data-name="${esc(b.name)}" style="--rar:${RARITY_COLOR[r]}"><span class="face${state.pick.gifted ? ' gifted' : ''}">${url ? `<img src="${url}" alt="">` : ''}${n ? `<span class="have">${n}</span>` : ''}</span><span class="pname">${esc(b.name.replace(/ Bee$/, ''))}</span></button>`;
    }).join('')}</div>`;
  }).join('') || '<p class="muted">Ничего не нашлось.</p>';
}
function openPicker() { closeEditor(); $('picker').hidden = false; renderPicker(); requestAnimationFrame(() => $('picker').classList.add('show')); setTimeout(() => $('pickSearch').focus(), 50); }
function closePicker() { const p = $('picker'); p.classList.remove('show'); setTimeout(() => { p.hidden = true; }, 180); }

// ---------- мутации ----------
const mutDef = (id) => data.mutations.find((m) => m.id === id);
function mutLabel(m) {
  const d = mutDef(m.id);
  if (!d) return m.id;
  const v = d.op === 'mul' ? `×${m.value}` : d.step < 1 ? `+${Math.round(m.value * 100)}%` : `+${m.value}`;
  return `${d.name} ${v}`;
}

function renderFields() {
  $('fieldSelect').innerHTML = data.fields.filter((f) => !/Brick Field|Hub Field/.test(f.name)).map((f) => {
    const mix = `${Math.round(f.mix.white * 100)}/${Math.round(f.mix.red * 100)}/${Math.round(f.mix.blue * 100)}`;
    return `<option value="${esc(f.name)}" ${f.name === state.field ? 'selected' : ''}>${esc(f.name)} — ⚪/🔴/🔵 ${mix}${f.beesRequired ? ` · от ${f.beesRequired} пчёл` : ''}</option>`;
  }).join('');
}

// ---------- статы: вкладки ----------
const TABS = { gear: 'Снаряжение', badges: 'Бейджи', amulets: 'Амулеты', buffs: 'Баффы', total: 'Итог' };

// вкладки сверху: улей / статы / цель и подбор / калибровка / результат
function renderSide() {
  const cur = state.side || 'hive';
  for (const b of document.querySelectorAll('#sideTabs button')) { b.classList.toggle('active', b.dataset.side === cur); b.setAttribute('aria-selected', b.dataset.side === cur); }
  for (const p of document.querySelectorAll('[data-side-pane]')) p.hidden = p.dataset.sidePane !== cur;
}
function setSide(side) {
  state.side = side; save(); renderSide();
  if (side === 'stats') renderStatsCard();
  if (side === 'goal') requestAnimationFrame(scrollToSelectedQuest);
}
function renderStatsCard() {
  const st = state.setup;
  for (const b of document.querySelectorAll('#statsMode button')) b.classList.toggle('active', b.dataset.mode === st.mode);
  $('gearTabs').hidden = st.mode !== 'gear';
  $('manualPane').hidden = st.mode !== 'manual';
  if (!TABS[st.tab]) st.tab = 'gear';
  const nBuffs = Object.values(st.gear.buffs || {}).filter((n) => n > 0).length;
  $('gearTabs').querySelector('.tabs').innerHTML = Object.entries(TABS).map(([k, l]) => `<button class="tab ${k === st.tab ? 'active' : ''}" data-tab="${k}" role="tab" aria-selected="${k === st.tab}">${l}${k === 'buffs' && nBuffs ? ` <span class="muted">· ${nBuffs}</span>` : ''}</button>`).join('');
  for (const pane of document.querySelectorAll('[data-pane]')) pane.hidden = pane.dataset.pane !== st.tab;
  $('walkSeconds').value = st.walkSeconds;
  $('tabbyStacks').value = st.tabbyStacks;
  $('polarPower').value = st.polarPower ?? '';
  $('scienceStacks').value = st.scienceStacks ?? '';
  for (const inp of document.querySelectorAll('[data-drive]')) inp.value = st.digitalDrives?.[inp.dataset.drive] ?? '';
  $('scienceStacks').closest('label').hidden = st.mode === 'manual'; // в ручном режиме Science уже в Convert Rate
  if (st.mode === 'gear') { renderGear(); renderBadges(); renderAmulets(); if (st.tab === 'buffs') renderBuffs(); if (st.tab === 'total') renderTotal(); }
  else renderManual();
}

const itemSummary = (it, slot) => {
  if (!it) return '';
  if (slot === 'tool') return `${it.pollenPerSec} пыльцы/с (${it.flowers} цветков × ${it.collect} за ${it.time} с)${it.red > 1 ? ` · ×${it.red} красной` : ''}${it.blue > 1 ? ` · ×${it.blue} синей` : ''}${it.white > 1 && (it.red === 1 || it.white !== it.red) ? ` · ×${it.white} белой` : ''}${it.white > 1 && it.white === it.red && it.red === it.blue ? ` · ×${it.white} всей` : ''}`;
  const lines = it.stats.map((x) => x.text);
  return `${it.capacity ? `${it.capacity.toLocaleString('ru')} пыльцы · ` : ''}${lines.join(' · ')}`;
};
function renderGear() {
  const g = state.setup.gear;
  $('gearSlots').innerHTML = data.slots.map((slot) => {
    const list = data.gear[slot.list];
    const cur = list.find((x) => x.name === g[slot.key]);
    return `<div class="slot"><label>${esc(slot.label)}
      <select data-slot="${slot.key}"><option value="">— нет —</option>${list.map((x) => `<option ${x.name === g[slot.key] ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <div class="muted small">${esc(itemSummary(cur, slot.key))}</div></div>`;
  }).join('');
  $('customTool').value = g.customTool ?? '';
  $('customToolRow').hidden = !!g.tool;
}
function renderBadges() {
  const g = state.setup.gear;
  const fields = new Set(data.fields.map((f) => f.name.replace(/ (Field|Patch|Forest)$/, '')));
  const groups = [['Общие', data.gear.badges.filter((b) => !fields.has(b.category) && b.category !== 'Hive Hub')], ['Поля', data.gear.badges.filter((b) => fields.has(b.category) || b.category === 'Hive Hub')]];
  $('badgeGrid').innerHTML = groups.map(([title, list]) => `<h3>${title}</h3><div class="badges">${list.map((b) => {
    const cur = g.badges?.[b.category] || '';
    const tier = b.tiers.find((t) => t.tier === cur);
    const hint = tier ? tier.stats.map((x) => x.text).join(' · ') : `до ${b.tiers.at(-1).stats.map((x) => x.text).join(' · ')}`;
    return `<label class="badge ${cur ? 'on' : ''}"><span>${esc(b.category)}</span>
      <select data-badge="${esc(b.category)}"><option value="">—</option>${b.tiers.map((t) => `<option ${t.tier === cur ? 'selected' : ''}>${t.tier}</option>`).join('')}</select>
      <span class="muted small">${esc(hint)}</span></label>`;
  }).join('')}</div>`).join('');
}
// ---------- баффы, которые держишь всё время фарма ----------
// Предметы, коды, нектары, желейные бобы, благословения цыплят (data/buffs.json ← scripts/build-icons.mjs, код игры).
// Выбор — setup.gear.buffs = { имя: стаков }; их строки идут в статы как «бафф X» (core/gear.js buffLines).
function renderBuffs() {
  const list = data.buffs || [];
  const sel = state.setup.gear.buffs || {};
  const q = $('buffSearch').value.trim().toLowerCase();
  const grp = $('buffGroup').value;
  const only = $('buffOnly').checked;
  const shown = list.filter((b) => (!q || b.name.toLowerCase().includes(q)) && (!grp || b.group === grp) && (!only || sel[b.name] > 0));
  let group = null;
  $('buffGrid').innerHTML = shown.map((b) => {
    const n = sel[b.name] || 0;
    const head = b.group !== group ? `<h3 class="buff-group">${esc(b.groupRu || b.group)}</h3>` : '';
    group = b.group;
    const lines = buffLines(b, n || 1).map((l) => `<span class="${lineKind(l, fieldNames()) === 'used' ? '' : 'muted am-offline'}" title="${lineKind(l, fieldNames()) === 'used' ? '' : 'На мёд и пыльцу не влияет'}">${esc(l)}</span>`).join(' · ');
    const stepper = b.maxStacks > 1 ? `<div class="stepper buff-stack" title="Стаков (до ${b.maxStacks})"><button data-bf="minus" aria-label="Меньше стаков">−</button><b>${n || 0}<span class="muted">/${b.maxStacks}</span></b><button data-bf="plus" aria-label="Больше стаков">+</button></div>` : '';
    return `${head}<div class="buff${n ? ' on' : ''}" data-buff="${esc(b.name)}">
      <button class="buff-main" data-bf="toggle" aria-pressed="${!!n}">${lookImg(b.look, 34) || '<span class="tok"></span>'}<span class="buff-text"><b>${esc(b.name)}</b><span class="small">${lines}${b.modelKey ? ' <span class="muted">· модель считает сама; включено — держится всегда (берётся больше из двух)</span>' : ''}</span></span></button>${stepper}</div>`;
  }).join('') || '<p class="muted small">Ничего не нашлось.</p>';
  const on = list.filter((b) => sel[b.name] > 0);
  $('buffSummary').innerHTML = on.length
    ? `Включено: ${on.map((b) => `<span class="chip buff-chip">${lookImg(b.look, 18)}${esc(b.name)}${b.maxStacks > 1 ? ` ×${sel[b.name]}` : ''}</span>`).join(' ')} <button class="btn small ghost" data-bf="clear">выключить все</button>`
    : '<span class="muted">Пока ничего не включено — модель считает без этих баффов.</span>';
}
function bindBuffs() {
  $('buffSearch').addEventListener('input', renderBuffs);
  $('buffGroup').addEventListener('change', renderBuffs);
  $('buffOnly').addEventListener('change', renderBuffs);
  const set = (name, n) => {
    const sel = (state.setup.gear.buffs ??= {});
    if (n > 0) sel[name] = n; else delete sel[name];
    save();
    renderStatsCard();
  };
  $('buffPane').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bf]');
    if (!b) return;
    if (b.dataset.bf === 'clear') { state.setup.gear.buffs = {}; save(); renderStatsCard(); return; }
    const name = e.target.closest('[data-buff]')?.dataset.buff;
    const def = data.buffs.find((x) => x.name === name);
    if (!def) return;
    const n = state.setup.gear.buffs?.[name] || 0;
    if (b.dataset.bf === 'toggle') set(name, n ? 0 : (def.maxStacks > 1 ? def.maxStacks : 1)); // стаковые — сразу на максимум
    if (b.dataset.bf === 'plus') set(name, Math.min(def.maxStacks, n + 1));
    if (b.dataset.bf === 'minus') set(name, Math.max(0, n - 1));
  });
}

// ---------- конструктор амулетов ----------
// Амулеты из кода игры (data/amulets.json): обязательные строки и пулы «N строк из списка» с диапазонами значений.
// Источник правды — строки амулета (a.lines): конструктор разбирает их (parseAmulet) и собирает обратно (amuletLines).
const fmtNum = (v, spec) => (spec.unit === '' ? Number(v).toLocaleString('ru') : String(v));
const rangeText = (o) => (o.passive ? '' : o.min === o.max ? `${o.unit === 'x' ? 'x' : ''}${fmtNum(o.min, o)}${o.unit === '%' ? '%' : ''}` : `${o.unit === 'x' ? 'x' : ''}${fmtNum(o.min, o)}–${fmtNum(o.max, o)}${o.unit === '%' ? '%' : ''}`);
const fieldNames = () => data.fields.map((f) => f.name);
/** Пометка у строки, которую модель не учитывает. */
function kindMark(spec) {
  if (spec.passive) {
    const p = data.passives.find((x) => x.name.toLowerCase() === spec.passive.toLowerCase());
    return !p || p.skip ? `<span class="am-off" title="${esc(p?.skip || 'пассивка пока не считается')}">не считается</span>` : '';
  }
  const k = lineKind(modLine(spec, spec.max), fieldNames());
  return k === 'used' ? '' : `<span class="am-off" title="${k === 'ignored' ? 'На мёд и пыльцу не влияет' : 'Модель эту строку пока не учитывает'}">не влияет</span>`;
}
/** Строка значения: ползунок + число (у строки с одним значением — просто текст). */
function amValueRow(spec, value, key, { removable = false, optional = false } = {}) {
  const fixed = spec.passive || spec.min === spec.max;
  const unitL = spec.unit === 'x' ? 'x' : spec.unit === '' ? '+' : '+';
  const unitR = spec.unit === '%' ? '%' : '';
  const on = value !== null && value !== undefined;
  const label = spec.passive ? `Passive: ${esc(spec.passive)}` : esc(spec.stat);
  const ctrl = !on ? '<span class="muted small">нет</span>' : fixed ? `<b class="am-fixed">${spec.passive ? '' : `${unitL}${fmtNum(spec.min, spec)}${unitR}`}</b>`
    : `<input type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${value}" data-am-v="${key}" aria-label="${label}">
       <span class="am-num">${unitL}<input type="number" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${value}" data-am-v="${key}" aria-label="${label}">${unitR}</span>`;
  const chance = optional ? `<label class="am-chance" title="${spec.chance ? `Редкая строка: выпадает с шансом ${Math.round(spec.chance * 1000) / 10}%` : 'Эта строка у амулета есть всегда, но в твоих строках её нет'}"><input type="checkbox" data-am-chance="${key}" ${on ? 'checked' : ''}>${spec.chance ? 'редкая' : 'есть'}</label>` : '';
  return `<div class="am-row${on ? '' : ' off'}"><span class="am-label">${label} ${kindMark(spec)}</span>${chance}<span class="am-ctrl">${ctrl}</span>
    ${removable ? `<button class="am-x" data-am-unpick="${key}" title="Убрать строку" aria-label="Убрать строку">×</button>` : ''}</div>`;
}
function amuletCard(a, i, groupCount) {
  const A = data.amulets;
  const def = A && !a.manual ? amuletDef(A, a) : null;
  const typeSelect = A ? `<select data-am="type" aria-label="Какой амулет">${a.manual || !def ? '<option value="">— свой (строками) —</option>' : ''}${A.groups.map((g) => `<optgroup label="${esc(g)}">${A.amulets.filter((d) => d.group === g).map((d) => `<option value="${esc(d.name)}" ${def?.name === d.name ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</optgroup>`).join('')}</select>` : '';
  const head = `<div class="am-head">${typeSelect}
    ${def ? '<button class="btn small" data-am-max title="Все значения — на максимум">Всё на максимум</button>' : ''}
    <button class="btn small ghost" data-am-mode title="${def ? 'Писать строки вручную' : 'Собрать в конструкторе'}">${def ? 'Строками' : 'Конструктор'}</button>
    <button class="btn small ghost am-del" data-am-del="${i}" title="Убрать амулет" aria-label="Убрать амулет">×</button></div>`;
  const dup = def && groupCount.get(def.group) > 1 ? `<p class="warn small">В игре амулет ${esc(def.group)} надевается только один.</p>` : '';
  if (!def) {
    return `<div class="amulet" data-i="${i}">${head}
      <textarea data-am="lines" rows="4" placeholder="+25% Pollen&#10;x1.1 Blue Pollen&#10;+3% Critical Chance">${esc(a.lines || '')}</textarea></div>`;
  }
  const st = parseAmulet(def, a.lines);
  const fixedSlots = def.slots.filter((x) => x.kind === 'fixed');
  const poolSlots = def.slots.filter((x) => x.kind === 'pool');
  const rows = fixedSlots.map((spec, k) => amValueRow(spec, st.fixed[k], `f:${k}`, { optional: !!spec.chance || st.fixed[k] === null })).join('');
  const pools = poolSlots.map((pool, k) => {
    const picked = st.pools[k];
    const cap = pool.maybeSelect || pool.select;
    const full = picked.length >= cap;
    const note = [pool.chance ? `весь список выпадает с шансом ${Math.round(pool.chance * 1000) / 10}%` : '', pool.maybeSelect ? `с шансом ${Math.round(pool.maybeChance * 100)}% — ${pool.maybeSelect}` : ''].filter(Boolean).join('; ');
    const chips = pool.options.map((o, j) => {
      const on = picked.some((x) => x.i === j);
      return `<button class="am-opt${on ? ' on' : ''}" data-am-pick="${k}:${j}" ${!on && full ? 'disabled' : ''} aria-pressed="${on}">${o.passive ? esc(o.passive) : esc(o.stat)} <span class="muted">${rangeText(o)}</span></button>`;
    }).join('');
    const values = picked.map((x, n) => amValueRow(pool.options[x.i], x.value, `p:${k}:${n}`, { removable: true })).join('');
    return `<div class="am-pool"><div class="am-pool-head"><b>${pool.select === 1 && !pool.maybeSelect ? 'Одна строка' : `${pool.select} ${plural(pool.select, 'строка', 'строки', 'строк')}`} из списка</b>
      <span class="am-count${picked.length === pool.select ? ' done' : ''}">${picked.length}/${pool.select}</span>${note ? `<span class="muted small">${esc(note)}</span>` : ''}</div>
      <div class="am-opts">${chips}</div>${values}</div>`;
  }).join('');
  const extra = st.extra.length ? `<label class="small muted">Строки, которых у этого амулета не бывает (оставлены как есть):</label>
    <textarea data-am="extra" rows="2">${esc(st.extra.join('\n'))}</textarea>` : '';
  return `<div class="amulet builder" data-i="${i}">${head}${dup}<div class="am-rows">${rows}</div>${pools}${extra}</div>`;
}
function renderAmulets() {
  const g = state.setup.gear;
  g.amulets ??= [];
  const groupCount = new Map();
  for (const a of g.amulets) { const d = data.amulets && !a.manual && amuletDef(data.amulets, a); if (d) groupCount.set(d.group, (groupCount.get(d.group) || 0) + 1); }
  $('amuletList').innerHTML = g.amulets.map((a, i) => amuletCard(a, i, groupCount)).join('')
    || '<p class="muted small">Амулетов нет — нажми «+ амулет» и выбери, какой.</p>';
  $('extraLines').value = g.extra || '';
}
/** Изменить разобранное состояние амулета i (fn(st, def)) и пересобрать его строки. */
function editAmulet(i, fn, rerender = true) {
  const a = state.setup.gear.amulets[i];
  const def = a && amuletDef(data.amulets, a);
  if (!def) return;
  const st = parseAmulet(def, a.lines);
  fn(st, def);
  a.type = def.name;
  a.name = def.name;
  a.lines = amuletLines(def, st);
  save();
  if (rerender) renderAmulets();
}
const clampTo = (spec, v) => Math.max(spec.min, Math.min(spec.max, Math.round(v / spec.step) * spec.step));
/** Спецификация и место значения по ключу «f:k» / «p:k:n». */
function amSlot(def, st, key) {
  const [kind, a, b] = key.split(':').map((x, j) => (j ? Number(x) : x));
  if (kind === 'f') return { spec: def.slots.filter((x) => x.kind === 'fixed')[a], get: () => st.fixed[a], set: (v) => { st.fixed[a] = v; } };
  const pool = def.slots.filter((x) => x.kind === 'pool')[a];
  const item = st.pools[a][b];
  return { spec: pool.options[item.i], get: () => item.value, set: (v) => { item.value = v; } };
}
function bindAmulets() {
  const list = $('amuletList');
  const idx = (e) => Number(e.target.closest('.amulet')?.dataset.i);
  list.addEventListener('input', (e) => {
    const t = e.target;
    const i = idx(e);
    if (t.dataset.am === 'lines') { state.setup.gear.amulets[i].lines = t.value; save(); return; }
    if (t.dataset.am === 'extra') { editAmulet(i, (st) => { st.extra = t.value.split('\n').map((x) => x.trim()).filter(Boolean); }, false); return; }
    const key = t.dataset.amV;
    if (!key || t.value === '') return;
    // ползунок и число двигаются вместе; число не переписываем, пока его печатают (поправим на change)
    editAmulet(i, (st, def) => {
      const slot = amSlot(def, st, key);
      const v = clampTo(slot.spec, Number(t.value));
      slot.set(v);
      for (const x of t.closest('.am-row').querySelectorAll('[data-am-v]')) if (x !== t) x.value = v;
    }, false);
  });
  list.addEventListener('change', (e) => {
    const t = e.target;
    const i = idx(e);
    if (t.dataset.am === 'type') {
      const def = data.amulets.amulets.find((d) => d.name === t.value);
      const a = state.setup.gear.amulets[i];
      if (!def) { a.manual = true; save(); renderAmulets(); return; }
      // другой амулет: подходящие строки остаются (значения — в его диапазоны), обязательных не хватает — на максимум
      const st = parseAmulet(def, a.lines);
      const base = emptyAmulet(def);
      const fixedSlots = def.slots.filter((x) => x.kind === 'fixed');
      st.fixed = st.fixed.map((v, k) => (v === null ? base.fixed[k] : clampTo(fixedSlots[k], v)));
      def.slots.filter((x) => x.kind === 'pool').forEach((pool, k) => { st.pools[k] = st.pools[k].slice(0, pool.select).map((x) => ({ ...x, value: clampTo(pool.options[x.i], x.value) })); });
      st.extra = [];
      Object.assign(a, { type: def.name, name: def.name, manual: false, lines: amuletLines(def, st) });
      save(); renderAmulets();
      return;
    }
    if (t.dataset.amChance) { editAmulet(i, (st, def) => { const slot = amSlot(def, st, t.dataset.amChance); slot.set(t.checked ? slot.spec.max : null); }); return; }
    if (t.dataset.amV && t.type === 'number') renderAmulets(); // после ввода числа — показать его поправленным
  });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const i = idx(e);
    if (b.dataset.amDel !== undefined) { state.setup.gear.amulets.splice(i, 1); save(); renderAmulets(); return; }
    if (b.dataset.amMode !== undefined) {
      const a = state.setup.gear.amulets[i];
      a.manual = !a.manual && !!amuletDef(data.amulets, a);
      if (!a.manual && !amuletDef(data.amulets, a)) toast('Эти строки не похожи ни на один амулет — выбери его в списке');
      save(); renderAmulets();
      return;
    }
    if (b.dataset.amMax !== undefined) {
      editAmulet(i, (st, def) => {
        def.slots.filter((x) => x.kind === 'fixed').forEach((spec, k) => { if (st.fixed[k] !== null) st.fixed[k] = spec.max; });
        def.slots.filter((x) => x.kind === 'pool').forEach((pool, k) => { for (const x of st.pools[k]) x.value = pool.options[x.i].max; });
      });
      return;
    }
    if (b.dataset.amPick) {
      const [k, j] = b.dataset.amPick.split(':').map(Number);
      editAmulet(i, (st, def) => {
        const pool = def.slots.filter((x) => x.kind === 'pool')[k];
        const at = st.pools[k].findIndex((x) => x.i === j);
        if (at >= 0) st.pools[k].splice(at, 1);
        else if (st.pools[k].length < (pool.maybeSelect || pool.select)) st.pools[k].push({ i: j, value: pool.options[j].max });
      });
      return;
    }
    if (b.dataset.amUnpick) {
      const [, k, n] = b.dataset.amUnpick.split(':').map(Number);
      editAmulet(i, (st) => { st.pools[k].splice(n, 1); });
    }
  });
}
/** Новый амулет: первый вид, которого ещё нет, высшего тира; обязательные строки — на максимуме. */
function addAmulet() {
  const A = data.amulets;
  const g = state.setup.gear;
  if (!A) { g.amulets.push({ name: 'амулет', lines: '', manual: true }); save(); renderAmulets(); return; }
  const used = new Set(g.amulets.map((a) => amuletDef(A, a)?.group));
  const group = A.groups.find((x) => !used.has(x)) || A.groups[0];
  const def = A.amulets.filter((d) => d.group === group).at(-1);
  g.amulets.push({ name: def.name, type: def.name, lines: amuletLines(def, emptyAmulet(def)) });
  save(); renderAmulets();
  $('amuletList').lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
// подписи для статов, которые есть только в бонусах улья
const STAT_LABEL_RU = { fieldCapacityBlue: 'Blue Field Capacity', fieldCapacityRed: 'Red Field Capacity', fieldCapacityWhite: 'White Field Capacity', capacityMul: 'Capacity Multiplier', beeMovespeed: 'Bee Movespeed', blueBomb: 'Blue Bomb Pollen', instantBlue: 'Instant Blue Conversion', instantRed: 'Instant Red Conversion', critPower: 'Critical Power', critChance: 'Critical Chance' };
const fmtStat = (b) => {
  if (b.kind === 'flat') return Math.round(b.value).toLocaleString('ru');
  if (b.kind === 'chance') return `${(b.value * 100).toFixed(1).replace(/\.0$/, '')}%`;
  if (b.kind === 'fieldcap') return `${((1 + b.value) * 100).toFixed(0)}%`;
  return `${(b.value * 100).toFixed(1).replace(/\.0$/, '')}%`;
};
async function renderTotal() {
  const r = await call('gearStats', { gear: { ...state.setup.gear, polarPower: state.setup.polarPower, scienceStacks: state.setup.scienceStacks }, myHive: state.hive });
  $('statsTotal').innerHTML = `<p class="muted small">«В игре» — как в меню ⚙️: вместе с бонусами Gifted твоего улья. «Без улья» — то, что даёт только снаряжение (бонусы улья калькулятор добавляет сам для того улья, который считает).</p>
    <table class="list"><thead><tr><th>Стат</th><th class="num">В игре</th><th class="num muted">без улья</th><th>Откуда</th></tr></thead><tbody>
    ${r.breakdown.map((b) => `<tr><td>${esc(STAT_LABEL_RU[b.key] || b.label)}</td><td class="num"><b>${fmtStat({ ...b, value: b.inGame ?? b.value })}</b></td><td class="num muted">${b.inGame !== undefined && Math.abs(b.inGame - b.value) > 1e-9 ? fmtStat(b) : ''}</td>
      <td class="muted small">${[...b.sources, ...(b.hiveSources || [])].map(esc).join('<br>')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Пока ничего не выбрано.</td></tr>'}
    </tbody></table>
    ${r.unknown.length ? `<p class="small warn">Не понял (проверь написание, как в игре: «+25% Pollen», «x1.5 Red Pollen»):</p><ul class="notes">${r.unknown.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${r.ignored.length ? `<p class="small muted">На мёд и пыльцу не влияют (атака, защита, удача…):</p><ul class="notes">${r.ignored.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${r.passiveInfo.length ? `<h3>Пассивки</h3><ul class="notes">${r.passiveInfo.map((p) => `<li>${p.counted ? '✓' : '✗'} <b>${esc(p.name)}</b> <span class="muted">(${esc(p.from)})</span> — ${esc(p.text)}</li>`).join('')}</ul>` : ''}`;
}
function renderManual() {
  const m = state.setup.manual;
  $('statsFromGame').checked = state.setup.statsFromGame;
  const on = new Set(state.setup.manualPassives || []);
  $('manualPassives').innerHTML = data.passives.filter((p) => !p.skip).map((p) => `<label class="chk small" title="${esc(p.info)}"><input type="checkbox" data-passive="${esc(p.name)}" ${on.has(p.name) ? 'checked' : ''}>${esc(p.name)}</label>`).join('');
  $('stats').innerHTML = STATS.map(([k, label, kind]) => {
    const v = m[k];
    const shown = kind === 'pct' || kind === 'chance' ? Math.round(v * 1000) / 10 : v;
    const unit = kind === 'pct' || kind === 'chance' ? '%' : '';
    return `<label>${esc(label)} <span><input type="number" step="any" data-stat="${k}" value="${shown}">${unit}</span></label>`;
  }).join('');
}

// ---------- подбор: ограничения по пчёлам ----------
/** Что у меня есть: имя → { count, gifted, level }. */
function myBees() {
  const m = new Map();
  for (const g of state.hive) {
    const x = m.get(g.name) || { count: 0, gifted: 0, level: 0 };
    x.count += g.count;
    if (g.gifted) x.gifted += g.count;
    x.level = Math.max(x.level, g.level);
    m.set(g.name, x);
  }
  return m;
}
const OBTAINABLE = new Set(['common', 'rare', 'epic', 'legendary']); // выбиваются из Royal Jelly
const EVENT_MAX = 1; // ивентовая пчела каждого вида в игре одна (как EVENT_MAX в core/optimize.js)
const maxFor = (b) => (b?.rarity === 'event' ? EVENT_MAX : 50);
function applyPreset(kind) {
  const mine = myBees();
  const L = {};
  for (const b of data.bees) {
    const my = mine.get(b.name);
    const allow = kind === 'all' || (kind === 'mine' ? !!my : OBTAINABLE.has(b.rarity) || !!my);
    let max = kind === 'mine' ? (my?.count ?? 0) : kind === 'all' ? '' : OBTAINABLE.has(b.rarity) ? '' : (my?.count ?? 0);
    if (kind === 'real' && b.rarity === 'legendary') max = (my?.count ?? 0) + 2; // легендарка ~267 Royal Jelly за штуку
    if (b.rarity === 'event') max = Math.min(max === '' ? EVENT_MAX : max, EVENT_MAX); // каждой ивентовой — одна на улей
    // убирать ивентовых не страшно: за них дают особое желе, и пчелу можно вернуть — замки только в «Только мои»
    const lock = !!my && kind === 'mine';
    L[b.name] = { allow, max, maxGifted: state.opt.limits?.[b.name]?.maxGifted ?? (my?.gifted ?? 0), lock };
  }
  state.opt.limits = L;
  save(); renderLimits();
}
function applyGiftedPreset(kind) {
  const mine = myBees();
  for (const b of data.bees) {
    const l = (state.opt.limits[b.name] ??= { allow: true, max: '', maxGifted: 0 });
    l.maxGifted = kind === 'all' ? '' : kind === 'none' ? 0 : (mine.get(b.name)?.gifted ?? 0);
  }
  save(); renderLimits();
}
function renderOpt() {
  const o = state.opt;
  const n = totalBees();
  if (!o.slots) o.slots = n || 25;
  if (!o.level) o.level = n ? Math.round(state.hive.reduce((a, g) => a + g.level * g.count, 0) / n) : 10;
  $('optSlots').value = o.slots; $('optLevel').value = o.level; $('optKeep').checked = !!o.keep;
  slotsHint();
  if (!o.limits || !Object.keys(o.limits).length) applyPreset('real'); else renderLimits();
}
/** Слотов не столько, сколько пчёл в улье (например, улей вырос после того, как задали число) — подсказка с кнопкой. */
function slotsHint() {
  const n = totalBees();
  const h = $('slotsHint');
  h.hidden = !n || state.opt.slots === n;
  h.querySelector('span').textContent = `В твоём улье ${n} ${plural(n, 'пчела', 'пчелы', 'пчёл')}, а слотов для подбора — ${state.opt.slots}.`;
}
function renderLimits() {
  const L = state.opt.limits || {};
  const mine = myBees();
  $('limitsGrid').innerHTML = RARITIES.map((r) => {
    const list = data.bees.filter((b) => b.rarity === r);
    return `<h3><span class="rar-pill" style="--rar:${RARITY_COLOR[r]}">${RARITY_RU[r]}</span></h3><div class="limit-grid">${list.map((b) => {
      const l = L[b.name] || { allow: false, max: '', maxGifted: 0 };
      const my = mine.get(b.name);
      const url = b.imageKey && beeIcons.get(b.imageKey);
      return `<div class="limit${l.allow ? '' : ' off'}" data-bee="${esc(b.name)}">
        <button class="limit-face" data-lim="toggle" title="${l.allow ? 'Можно — нажми, чтобы запретить' : 'Нельзя — нажми, чтобы разрешить'}">${url ? `<img src="${url}" alt="">` : ''}</button>
        ${my ? `<button class="lock${l.lock ? ' on' : ''}" data-lim="lock" title="${l.lock ? 'Свои закреплены — подбор их не уберёт' : 'Закрепить своих: подбор не будет их убирать'}">${l.lock ? '🔒' : '🔓'}</button>` : ''}
        <div class="limit-body"><b>${esc(b.name.replace(/ Bee$/, ''))}</b>
          <span class="muted small">${my ? `у меня ${my.count}${my.gifted ? ` · 🌟${my.gifted}` : ''}` : '—'}</span>
          <div class="limit-inputs"><label title="${b.rarity === 'event' ? 'Ивентовая — не больше одной каждого вида' : 'Максимум штук (пусто = сколько угодно)'}">до <input type="number" min="0" max="${maxFor(b)}" data-lim="max" value="${l.max ?? ''}" placeholder="${b.rarity === 'event' ? EVENT_MAX : '∞'}"></label>
          <label title="Максимум Gifted">🌟 <input type="number" min="0" max="${maxFor(b)}" data-lim="maxGifted" value="${l.maxGifted ?? ''}" placeholder="${b.rarity === 'event' ? EVENT_MAX : '∞'}"></label></div>
        </div></div>`;
    }).join('')}</div>`;
  }).join('');
}
/** Ограничения для подбора: уровень своих пчёл — их, остальных — «уровень новых пчёл». */
function limitsForOptimizer() {
  const mine = myBees();
  const out = {};
  for (const [name, l] of Object.entries(state.opt.limits || {})) {
    if (!l.allow) continue;
    const cap = maxFor(beeByName.get(name));
    out[name] = {
      allow: true,
      max: Math.min(cap, l.max === '' || l.max === undefined ? 50 : Number(l.max)),
      maxGifted: Math.min(cap, l.maxGifted === '' || l.maxGifted === undefined ? 50 : Number(l.maxGifted)),
      level: mine.get(name)?.level || state.opt.level,
      lock: !!l.lock,
    };
  }
  return out;
}

// ---------- квесты (можно несколько) ----------
const questKey = (q) => `${q.giver || ''}|${q.section || ''}|${q.name}`;
const selectedQuests = () => { const set = new Set(state.quests || []); return data.quests.filter((q) => set.has(questKey(q))); };
/** Что дадут выбранные квесты (награды из кода игры, где нашлись, иначе с вики). */
function questRewards(qs = selectedQuests()) {
  return qs.reduce((a, q) => ({ royalJelly: a.royalJelly + (q.rewards?.royalJelly ?? 0), treats: a.treats + (q.rewards?.treats ?? 0) }), { royalJelly: 0, treats: 0 });
}
/** «202 RJ с квестов хватит на первые K замен» — для плана замен и разницы ульев. */
function questJellyNote(costs) {
  if (state.goal !== 'quest') return '';
  const rw = questRewards();
  if (!rw.royalJelly) return '';
  let sum = 0;
  let k = 0;
  for (const c of costs) { if (c === null || c === undefined || sum + c > rw.royalJelly) break; sum += c; k++; }
  const tail = costs.length ? (k >= costs.length ? ' — хватит на все эти замены' : k ? ` — хватит на первые ${k}` : ' — на первую замену не хватит') : '';
  return `<span class="muted"> · выбранные квесты сами дадут ${rw.royalJelly.toLocaleString('ru')} Royal Jelly${tail}</span>`;
}
function questList() {
  const giver = $('questGiver').value;
  const q = $('questSearch').value.trim().toLowerCase();
  const only = $('questOnlySel').checked ? new Set(state.quests || []) : null;
  return data.quests.filter((x) => (!giver || x.giver === giver) && (!q || x.name.toLowerCase().includes(q))
    && (!only || only.has(questKey(x)))
    && x.requirements.some((r) => r.type === 'pollen' || r.type === 'token'));
}
function renderQuests() {
  const set = new Set(state.quests || []);
  let section = null;
  $('questList').innerHTML = questList().map((x) => {
    const head = x.section !== section ? `<div class="quest-section">${esc(x.giver || '')} · ${esc(x.section || '')}</div>` : '';
    section = x.section;
    const k = questKey(x);
    const reqs = x.requirements.filter((r) => r.type !== 'mob').map((r) => r.text.replace(/^Collect /, '')).join(' · ');
    const rj = x.rewards?.royalJelly ? ` · награда ${x.rewards.royalJelly} RJ` : '';
    return `${head}<label class="quest-item${set.has(k) ? ' on' : ''}"><input type="checkbox" data-q="${esc(k)}" ${set.has(k) ? 'checked' : ''}>
      <span><b>${esc(x.name)}</b><span class="muted small">${esc(reqs)}${rj}</span></span></label>`;
  }).join('') || '<p class="muted small">Ничего не нашлось.</p>';
  const n = set.size;
  const rw = questRewards();
  $('questCount').textContent = n ? `выбрано: ${n}${rw.royalJelly || rw.treats ? ` · награда: ${rw.royalJelly.toLocaleString('ru')} Royal Jelly, ${rw.treats.toLocaleString('ru')} Treats` : ''}` : 'ничего не выбрано';
}
/** Прокрутить список квестов к первому выбранному. */
function scrollToSelectedQuest() {
  const first = $('questList').querySelector('.quest-item.on');
  if (first) $('questList').scrollTo({ top: first.offsetTop - $('questList').offsetTop - 40, behavior: 'smooth' });
}
function setGoal(g) {
  state.goal = g;
  $('questBox').hidden = g !== 'quest';
  $('fieldRow').hidden = g === 'quest';
  for (const inp of document.querySelectorAll('input[name=goal]')) inp.checked = inp.value === g;
  save();
}

// ---------- результаты ----------
function bars(rows, valueFmt) {
  const max = Math.max(...rows.map((r) => r.value), 1e-9);
  return `<div class="bars">${rows.map((r) => `<div class="bar-row" title="${esc(r.title || `${r.label}: ${valueFmt(r.value)}`)}">
    <span class="lbl">${r.labelHtml || esc(r.label)}</span>
    <span class="track"><span class="fill" style="width:${Math.max(0.5, (r.value / max) * 100)}%;display:block"></span></span>
    <span class="val">${valueFmt(r.value)}</span></div>`).join('')}</div>`;
}
function mixBar(m) {
  return `<span class="mix" title="белые ${Math.round(m.white * 100)}%, красные ${Math.round(m.red * 100)}%, синие ${Math.round(m.blue * 100)}%">
    <span style="width:${m.white * 100}%;background:var(--white)"></span><span style="width:${m.red * 100}%;background:var(--red)"></span><span style="width:${m.blue * 100}%;background:var(--blue)"></span></span>`;
}
const goalColor = () => (['red', 'blue', 'white'].includes(state.goal) ? state.goal : 'total');
const goalLabel = { honey: 'мёд', pollen: 'пыльца', red: 'красная пыльца', blue: 'синяя пыльца', white: 'белая пыльца', quest: 'квест' };

/** Квесты: время каждого (и сколько было бы моим ульем), поля, общий итог. */
function questPlanHtml(plan, mine) {
  const per = plan.perQuest;
  const mineBy = new Map((mine?.perQuest || []).map((p) => [p.key, p]));
  const total = `<div class="quest-total"><div><span class="muted small">Все выбранные квесты</span><b>${fmtTime(plan.seconds)}</b></div>
    ${mine ? `<div><span class="muted small">моим ульем</span><b class="muted">${fmtTime(mine.seconds)}</b></div><div><span class="muted small">выигрыш</span><b class="good">${mine.seconds > plan.seconds ? `−${Math.round((1 - plan.seconds / mine.seconds) * 100)}%` : '0%'}</b></div>` : ''}</div>`;
  return `${total}<details class="quest-details" ${per.length <= 5 ? 'open' : ''}><summary>Разбивка по квестам (${per.length})</summary><table class="list quest-plan"><thead><tr><th>Квест</th><th>Где собирать</th><th class="num">Время</th>${mine ? '<th class="num muted">моим</th>' : ''}</tr></thead><tbody>
    ${per.map((p) => `<tr><td><b>${esc(p.name)}</b>${p.skipped.length ? `<div class="muted small">${p.skipped.map(esc).join('; ')}</div>` : ''}</td>
      <td class="small">${p.steps.map((s) => `${esc(s.field)} <span class="muted">${fmtTime(s.seconds)}</span>`).join('<br>')}${p.tokenSteps.map((s) => `<br><span class="muted">${esc(s.text)} — ${fmtTime(s.seconds)}</span>`).join('')}</td>
      <td class="num"><b>${fmtTime(p.seconds)}</b></td>${mine ? `<td class="num muted">${fmtTime(mineBy.get(p.key)?.seconds)}</td>` : ''}</tr>`).join('')}
  </tbody></table></details>`;
}

/** Чем подобранный улей отличается от моего: по видам пчёл и Gifted. */
function hiveDiff(mine, rec) {
  const count = (h) => { const m = new Map(); for (const g of h) { const k = `${g.name}|${g.gifted ? 1 : 0}`; m.set(k, (m.get(k) || 0) + g.count); } return m; };
  const a = count(mine);
  const b = count(rec);
  const out = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const d = (b.get(k) || 0) - (a.get(k) || 0);
    if (d) { const [name, g] = k.split('|'); out.push({ name, gifted: g === '1', d }); }
  }
  return out.sort((x, y) => x.d - y.d);
}
/** Сколько Royal Jelly в среднем стоит выбить пчелу (шансы с вики; Gifted ×250; null — не из Royal Jelly). */
const JELLY_ODDS = { rare: 0.69996, epic: 0.27, legendary: 0.03, mythic: 0.00004 };
function jellyCost(name, gifted) {
  const b = beeByName.get(name);
  const p = JELLY_ODDS[b?.rarity];
  if (!p) return null;
  return (data.bees.filter((x) => x.rarity === b.rarity).length / p) * (gifted ? 250 : 1);
}
function diffHtml(diff) {
  if (!diff.length) return '<p class="muted small">Подобранный улей совпадает с твоим.</p>';
  const adds = diff.filter((x) => x.d > 0);
  const jelly = adds.reduce((a, x) => a + (jellyCost(x.name, x.gifted) ?? 0) * x.d, 0);
  const noJelly = adds.filter((x) => jellyCost(x.name, x.gifted) === null).map((x) => x.name.replace(/ Bee$/, ''));
  const cost = `<p class="small">Собрать такой улей: примерно <b>~${Math.round(jelly).toLocaleString('ru')} Royal Jelly</b>${noJelly.length ? ` + не из Royal Jelly: ${esc(noJelly.join(', '))}` : ''}
    <span class="muted">(в среднем; Gifted через Royal Jelly — 1 из 250, поэтому лучше ограничить Gifted своими)</span>${questJellyNote([])}</p>`;
  const chip = (x) => `<span class="chip diff ${x.d > 0 ? 'plus' : 'minus'}">${beeImg(x.name, x.gifted, 22)}<b>${x.d > 0 ? '+' : '−'}${Math.abs(x.d)}</b> ${x.gifted ? '🌟 ' : ''}${esc(x.name.replace(/ Bee$/, ''))}</span>`;
  const hidden = diffHidden();
  return `<div class="diff-box${hidden ? ' collapsed' : ''}"><h3 class="diff-head">Что поменять в твоём улье <button class="eye" type="button" data-diff-eye aria-pressed="${hidden}" title="${hidden ? 'Показать' : 'Скрыть'}">${hidden ? EYE_OFF : EYE}</button></h3>
    <div class="diff-body"><div class="recommend">${diff.filter((x) => x.d < 0).map(chip).join('')}</div><div class="recommend">${adds.map(chip).join('')}</div>${cost}</div></div>`;
}
// глазик у «Что поменять в твоём улье»: скрыть/показать (запоминается в этом браузере)
const EYE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>';
function diffHidden() { try { return localStorage.getItem('bsshive.diffHidden') === '1'; } catch { return false; } }
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-diff-eye]');
  if (!btn) return;
  const box = btn.closest('.diff-box');
  const hide = !box.classList.contains('collapsed');
  for (const b of document.querySelectorAll('.diff-box')) {
    b.classList.toggle('collapsed', hide);
    const eb = b.querySelector('[data-diff-eye]');
    eb.innerHTML = hide ? EYE_OFF : EYE; eb.title = hide ? 'Показать' : 'Скрыть'; eb.setAttribute('aria-pressed', hide);
  }
  try { localStorage.setItem('bsshive.diffHidden', hide ? '1' : '0'); } catch {}
});
/** «Следующий шаг»: лучшие одиночные замены в моём улье (+ цена в Royal Jelly и план из N замен). */
const jellyText = (j) => (j === null || j === undefined ? 'не из Royal Jelly' : `~${Math.round(j)} RJ`);
function swapRow(s, i, extra = '') {
  return `<div class="next-step" style="--i:${i}">
    ${extra}${s.remove ? `<span class="chip diff minus">${beeImg(s.remove.name, s.remove.gifted, 22)}${s.remove.gifted ? '🌟 ' : ''}${esc(s.remove.name.replace(/ Bee$/, ''))} L${s.remove.level}</span>` : '<span class="chip">свободный слот</span>'}
    <span class="arrow">→</span>
    <span class="chip diff plus">${beeImg(s.add.name, s.add.gifted, 22)}${s.add.gifted ? '🌟 ' : ''}${esc(s.add.name.replace(/ Bee$/, ''))} L${s.add.level}</span>
    <span class="muted small" title="Сколько Royal Jelly в среднем нужно, чтобы выбить эту пчелу">${jellyText(s.jelly)}</span>`;
}
function nextStepsHtml(ns) {
  const sort = state.nextSort || 'gain';
  const head = `<h2>Следующий шаг</h2><p class="muted small">Если менять по одной пчеле: какая замена даст больше всего. Учитываются ограничения с вкладки «Цель». Цена — сколько Royal Jelly в среднем нужно, чтобы выбить пчелу (редкая ~13, эпическая ~41, легендарная ~267).</p>
    <div class="row next-tools"><label class="small">Сортировать <select id="nextSort"><option value="gain" ${sort === 'gain' ? 'selected' : ''}>по выигрышу</option><option value="perJelly" ${sort === 'perJelly' ? 'selected' : ''}>по выигрышу на 1 Royal Jelly</option></select></label>
    <span class="small">План из</span><input id="planK" type="number" min="1" max="15" value="${state.planK || 5}"><span class="small">замен</span><button class="btn small" id="runPlan">Построить</button></div>`;
  if (!ns) return `<div class="card" id="nextCard">${head}<p class="muted"><span class="spinner"></span>Ищу, какую одну пчелу выгоднее всего заменить…</p></div>`;
  const gain = (s) => (ns.quests ? `−${fmtTime(s.gain)}` : `+${fmt(s.gain)}${state.goal === 'honey' ? ' мёда/ч' : ' пыльцы/ч'}`);
  return `<div class="card" id="nextCard">${head}
    ${ns.steps.length ? `<div class="next-list">${ns.steps.map((s, i) => `${swapRow(s, i)}<b class="good">${gain(s)}</b></div>`).join('')}</div>` : '<p class="muted">Ни одна одиночная замена не помогает — улей уже хорош для этой цели.</p>'}
    <div id="planOut"></div></div>`;
}
/** План замен по порядку: после каждой — сколько станет. */
function planHtml(r) {
  const val = (v) => (r.quests ? fmtTime(-v) : fmt(v));
  const totalJelly = r.plan.reduce((a, p) => a + (p.jelly ?? 0), 0);
  const hasNonJelly = r.plan.some((p) => p.jelly === null || p.jelly === undefined);
  return `<h3>План замен</h3><p class="small">Сейчас: <b>${val(r.base)}</b> → после ${r.plan.length} ${plural(r.plan.length, 'замены', 'замен', 'замен')}: <b class="good">${val(r.plan.at(-1)?.after ?? r.base)}</b>
    · всего ~${Math.round(totalJelly)} Royal Jelly${hasNonJelly ? ' (+ пчёлы не из Royal Jelly)' : ''}${questJellyNote(r.plan.map((p) => p.jelly))}</p>
    <div class="next-list">${r.plan.map((p, i) => `${swapRow(p, i, `<span class="step-n">${i + 1}</span>`)}<b>${val(p.after)}</b></div>`).join('')}</div>
    <div class="row"><button class="btn small ghost" id="usePlan">Сделать моим ульем (как после плана)</button></div>`;
}
let lastPlanHive = null;
let lastNextArgs = null;
function bindNextCard() {
  $('nextSort')?.addEventListener('change', (e) => {
    state.nextSort = e.target.value; save();
    const c = $('nextCard');
    if (!c || !lastNextArgs) return;
    c.outerHTML = nextStepsHtml(null); bindNextCard();
    call('nextSteps', { ...lastNextArgs, sortBy: state.nextSort }).then((ns) => { const cc = $('nextCard'); if (cc) { cc.outerHTML = nextStepsHtml(ns); bindNextCard(); } }).catch(() => {});
  });
  $('planK')?.addEventListener('input', (e) => { state.planK = Math.max(1, Math.min(15, Number(e.target.value) || 5)); save(); });
  $('runPlan')?.addEventListener('click', async () => {
    if (!lastNextArgs) return;
    const out = $('planOut');
    out.innerHTML = '<p class="muted"><span class="spinner"></span>Строю план… <span id="planProg"></span></p>';
    try {
      const r = await call('swapPlan', { ...lastNextArgs, sortBy: state.nextSort || 'gain', k: state.planK || 5 }, (p) => { const el = $('planProg'); if (el) el.textContent = `шаг ${p.done + 1} из ${p.total}`; });
      lastPlanHive = r.hive;
      out.innerHTML = planHtml(r);
      $('usePlan')?.addEventListener('click', () => { rememberHive(); state.hive = lastPlanHive.map((g) => ({ ...g })); renderHive(); toast('Улей заменён на улей после плана', { label: 'Вернуть', run: undoHive }); });
    } catch (e) { if (!e.cancelled) out.innerHTML = `<p class="warn">${esc(e.message)}</p>`; }
  });
}

function resultCards(r, { title, recommend, plan, fields, compare, inject = '' }) {
  const c = goalColor();
  let html = `<div class="card"><h2>${esc(title)}</h2>`;
  if (recommend) {
    html += `<div class="recommend">${recommend.map((g) => `<span class="chip">${beeImg(g.name, g.gifted, 24)}<b>${g.count}×</b> ${g.gifted ? '🌟 ' : ''}${esc(g.name)} <span class="muted">L${g.level}</span></span>`).join('')}</div>
      <div class="row"><button class="btn small" id="useRec">Сделать моим ульем</button><button class="btn small ghost" id="copyRec">Скопировать текстом</button><span class="muted small">${recommend.extra || ''}</span></div>
      ${recommend.diff ? diffHtml(recommend.diff) : ''}`;
  }
  if (!r.canEnter) html += `<p class="warn">На ${esc(r.field)} пускают только с ${r.beesRequired} пчёл.</p>`;
  html += `<div class="tiles" style="margin-top:10px">
    <div class="tile"><div class="label">Мёд в час</div><div class="value">${fmt(r.honeyPerHour)}</div><div class="hint">${esc(r.field)}</div></div>
    <div class="tile"><div class="label">Пыльцы в час (с походами в улей)</div><div class="value">${fmt(r.pollenPerHourEffective[c])}</div><div class="hint">${c === 'total' ? 'вся' : COLOR_RU[c]}</div></div>
    <div class="tile"><div class="label">Пыльцы в секунду на поле</div><div class="value">${fmt(r.pollenPerSec.total)}</div><div class="hint">⚪ ${fmt(r.pollenPerSec.white)} · 🔴 ${fmt(r.pollenPerSec.red)} · 🔵 ${fmt(r.pollenPerSec.blue)}</div></div>
    <div class="tile"><div class="label">Цикл рюкзака</div>${r.cycle.mode === 'stay'
      ? `<div class="value">в улей не ходить</div><div class="hint" title="При полном рюкзаке сбор останавливается: пыльцы собирается столько, сколько успевает сконвертироваться на поле (Honey Mark, Star Shower, кокосы…). Это выгоднее, чем ходить в улей.">рюкзак полон, собираешь ${Math.round(r.cycle.stayShare * 100)}% — сколько успевает сконвертироваться на поле</div>`
      : r.cycle.mode === 'never' ? '<div class="value">не наполняется</div><div class="hint">всё конвертируется прямо на поле</div>'
        : `<div class="value">${fmtTime(r.cycle.fillSeconds)}</div><div class="hint">набрать; конвертация ${fmtTime(r.cycle.convertSeconds)}, дорога ${fmtTime(r.cycle.walkSeconds)}</div>`}</div>
  </div>`;
  if (plan) html += questPlanHtml(plan, compare);
  html += `</div><div class="res-cols"><div class="res-col">${inject}`;

  const conv = (r.fieldConvert || []).filter((x) => x.pollenPerSec > 0);
  const goo = r.goo?.honeyPerSec > 0 ? `<p class="small muted">Слизь (goo): в ней ~${Math.round(r.goo.cover * 100)}% цветков, где собираешь, — <b>+${fmt(r.goo.honeyPerSec)} мёда/с</b>${r.goo.convertPerSec > 0 ? `, Goo Conversion мгновенно конвертирует ещё ${fmt(r.goo.convertPerSec)} пыльцы/с` : ''}${r.goo.morph > 0 ? `; Gummy Morph ${Math.round(r.goo.morph * 100)}% времени` : ''}.</p>` : '';
  const convHtml = conv.length || r.instantShare || goo ? `<h3>Конвертация</h3>${goo}<p class="small muted">Мгновенно в мёд: <b>${Math.round((r.instantShare || 0) * 100)}%</b> собранной пыльцы (Instant Conversion, суперкриты, пламя…). В рюкзак идёт ${fmt(r.toBagPerSec || 0)}/с; прямо на поле его может опустошать:</p>
    ${conv.length ? bars(conv.map((x) => ({ label: x.name, labelHtml: `${iconFor(x.name)}${esc(x.name)}`, value: x.pollenPerSec })), (v) => `${fmt(v)}/с`) : '<p class="small muted">ничего — рюкзак опустошается только в улье.</p>'}` : '';
  const pollenHtml = `<div class="card pollen-card"><h2>Откуда пыльца</h2>${bars(r.bySource.map((s) => ({ label: s.name, labelHtml: `${iconFor(s.name)}${esc(s.name)}`, value: s.pollenPerSec })), (v) => `${fmt(v)}/с`)}${convHtml}
    <h3>Вклад пчёл</h3>${bars(r.perBee.map((b) => {
      // временные пчёлы (Fire Bee от Inferno у Spicy Bee) — сколько их в среднем на поле
      const n = b.virtual ? `≈${b.count.toFixed(1)}` : b.count;
      const tail = b.virtual ? ` <span class="muted">(${esc(b.virtual)}, временные)</span>` : '';
      return { label: `${n}× ${b.name}`, labelHtml: `${beeImg(b.name, b.gifted, 22)}${n}× ${b.gifted ? '🌟 ' : ''}${esc(b.name)}${tail}`, value: b.share,
        title: b.virtual ? `${b.name} от ${b.virtual}: в среднем ${b.count.toFixed(1)} на поле, ${(b.share * 100).toFixed(1)}% пыльцы` : `${b.name}: ${(b.share * 100).toFixed(1)}% пыльцы, бодрствует ${(b.uptime * 100).toFixed(0)}% времени` };
    }), (v) => `${(v * 100).toFixed(1)}%`)}</div>`;

  const buffs = Object.entries(r.buffs);
  html += `<div class="card buffs-card"><h2>Баффы и множители</h2>
    <table class="list"><tbody>
      <tr><td>Пыльца (все баффы)</td><td class="num">×${r.multipliers.pollen.toFixed(2)}</td></tr>
      <tr><td>⚪ / 🔴 / 🔵</td><td class="num">×${r.multipliers.white.toFixed(2)} / ×${r.multipliers.red.toFixed(2)} / ×${r.multipliers.blue.toFixed(2)}</td></tr>
      <tr><td>Криты (в среднем)</td><td class="num">×${r.multipliers.crit.toFixed(2)}</td></tr>
      ${buffs.map(([k, v]) => `<tr><td class="muted"><span class="buff-row">${iconFor(k, 18)}${esc(BUFF_RU[k] || k)}</span></td><td class="num">${v}</td></tr>`).join('')}
    </tbody></table>
    ${r.hiveBonuses.length ? `<h3>Бонусы Gifted-улья</h3><ul class="notes">${r.hiveBonuses.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}</div>`;

  if (fields?.length) {
    const best = fields[0].field;
    html += `<div class="card fields-card"><h2>Этот улей на других полях</h2><table class="list"><thead><tr><th>Поле</th><th>Цвета</th><th class="num">Мёд/час</th><th class="num">${c === 'total' ? 'Пыльца' : COLOR_RU[c][0].toUpperCase() + COLOR_RU[c].slice(1)}/час</th></tr></thead><tbody>
      ${fields.slice(0, 12).map((f) => `<tr class="${f.field === best ? 'best' : ''}" data-field="${esc(f.field)}" style="cursor:pointer"><td>${esc(f.field)}</td><td>${mixBar(f.mix)}</td><td class="num">${fmt(f.honeyPerHour)}</td><td class="num">${fmt(f.pollenPerHour[c])}</td></tr>`).join('')}
    </tbody></table><p class="muted small">Нажми на поле, чтобы выбрать его.</p></div>`;
  }
  html += `</div><div class="res-col">${pollenHtml}</div></div>`;
  const irrelevant = r.irrelevant || [];
  if (r.notModeled.length || r.notes.length || irrelevant.length) {
    html += `<div class="card"><h2>Что посчитано приблизительно</h2>
      ${r.notModeled.length ? `<p class="small">Не учитываются:</p><ul class="notes">${r.notModeled.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      ${r.notes.length ? `<p class="small">Грубые оценки (числа можно подогнать калибровкой):</p><ul class="notes">${r.notes.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      ${irrelevant.length ? `<p class="small muted">На мёд с поля не влияют:</p><ul class="notes muted">${irrelevant.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}</div>`;
  }
  return html;
}

function busy(on, text, cancellable = false) {
  $('runEval').disabled = on; $('runOpt').disabled = on;
  if (on) {
    $('emptyState').hidden = true;
    $('out').innerHTML = `<div class="card busy-card"><div class="row"><span class="spinner"></span><span>${esc(text)}</span>${cancellable ? '<button class="btn small ghost" id="cancelWork">Отменить</button>' : ''}</div>
      ${cancellable ? '<div class="progress"><i id="progressBar"></i></div><div class="muted small" id="progressText"></div>' : ''}</div>`;
    $('cancelWork')?.addEventListener('click', () => { cancelWork(); busy(false); $('out').innerHTML = '<div class="card muted">Подбор отменён.</div>'; });
    if (state.side !== 'result') { state.side = 'result'; renderSide(); }
    window.scrollTo({ top: 0 });
  }
}
function fail(err) { if (err?.cancelled) return; $('out').innerHTML = `<div class="card warn">Ошибка: ${esc(err.message || err)}</div>`; }
/** Прогресс подбора: жадное заполнение слотов, потом улучшение заменами до лимита времени. */
function showProgress(p, slots) {
  const bar = $('progressBar');
  const txt = $('progressText');
  if (!bar || !txt) return;
  const frac = p.phase === 'greedy' ? 0.35 * (p.done / Math.max(1, p.total)) : 0.35 + 0.65 * Math.min(1, p.ms / Math.max(1, p.deadlineMs));
  bar.style.width = `${Math.round(frac * 100)}%`;
  const best = p.best === null || p.best === undefined ? '' : state.goal === 'quest' ? ` · лучший пока: ${fmtTime(-p.best)}` : ` · лучший пока: ${fmt(p.best)}`;
  txt.textContent = p.phase === 'greedy' ? `заполняю слоты: ${p.done} из ${slots}` : `улучшаю заменами пчёл · проверено ${p.evals.toLocaleString('ru')} вариантов${best}`;
}

async function runEvaluate() {
  if (!state.hive.length) { fail(new Error('Улей пустой — добавь пчёл.')); return; }
  busy(true, 'Считаю…');
  try {
    const args = { ...base(), hive: state.hive, field: state.field };
    const qs = state.goal === 'quest' ? selectedQuests() : [];
    const [r, fields, plan] = await Promise.all([
      call('evaluate', args),
      call('compare', args),
      qs.length ? call('quests', { ...args, quests: qs }) : null,
    ]);
    $('out').innerHTML = resultCards(r, { title: `Мой улей (${totalBees()} пчёл)`, plan, fields, inject: nextStepsHtml(null) });
    bindResult();
    // «следующий шаг» считается дольше — дорисуем, когда будет готов
    const limits = limitsForOptimizer();
    const goal = qs.length ? { quests: qs } : state.goal === 'quest' ? 'honey' : state.goal;
    lastNextArgs = { ...args, goal, limits, slots: state.opt.slots || totalBees(), level: state.opt.level, top: 8 };
    bindNextCard();
    call('nextSteps', { ...lastNextArgs, sortBy: state.nextSort || 'gain' })
      .then((ns) => {
        const c = $('nextCard');
        if (c) { c.outerHTML = nextStepsHtml(ns); bindNextCard(); }
        if (TEST_RUN && new URLSearchParams(location.search).get('plan')) $('runPlan')?.click(); // для проверки: &plan=1
      })
      .catch((e) => { const c = $('nextCard'); if (c && !e.cancelled) c.innerHTML = `<h2>Следующий шаг</h2><p class="warn">${esc(e.message)}</p>`; });
  } catch (e) { fail(e); } finally { busy(false); }
}

async function runOptimize() {
  const o = state.opt;
  let goal = state.goal;
  const qs = goal === 'quest' ? selectedQuests() : [];
  if (goal === 'quest') {
    if (!qs.length) { setSide('goal'); toast('Выбери квесты на вкладке «Цель»'); return; }
    goal = { quests: qs };
  }
  const limits = limitsForOptimizer();
  if (!Object.keys(limits).length) { setSide('goal'); toast('Разреши хотя бы одну пчелу'); return; }
  busy(true, `Подбираю улей на ${o.slots} слотов — ${goal.quests ? `${qs.length} ${plural(qs.length, 'квест', 'квеста', 'квестов')}` : goalLabel[state.goal]}…`, true);
  try {
    // закреплённые свои пчёлы (замок) остаются как есть; «оставить мой улей» — закрепить весь улей
    const locked = o.keep ? state.hive : state.hive.filter((g) => state.opt.limits?.[g.name]?.lock);
    const opts = { slots: o.slots, level: o.level, goal, field: state.field, fixed: locked.length ? locked : undefined, seed: o.keep ? undefined : state.hive.filter((g) => !state.opt.limits?.[g.name]?.lock), limits, ...base() };
    const res = await call('optimize', opts, (p) => showProgress(p, o.slots));
    const [fields, mine] = await Promise.all([
      call('compare', { ...base(), hive: res.hive }),
      qs.length && state.hive.length ? call('quests', { ...base(), hive: state.hive, quests: qs }) : null,
    ]);
    const rec = [...(res.fixed || []), ...res.added];
    rec.extra = `${res.evals} вариантов за ${(res.ms / 1000).toFixed(1)} с${res.timedOut ? ' (остановился по времени)' : ''}`;
    lastRecommend = res.hive;
    const title = qs.length ? `Лучший улей для ${qs.length} ${plural(qs.length, 'квеста', 'квестов', 'квестов')}` : `Лучший улей: ${goalLabel[state.goal]} · ${res.field}`;
    rec.diff = hiveDiff(state.hive, res.hive);
    $('out').innerHTML = resultCards(res.result, { title, recommend: rec, plan: res.plan, fields, compare: mine });
    bindResult();
  } catch (e) { fail(e); } finally { busy(false); }
}
let lastRecommend = null;

function bindResult() {
  $('useRec')?.addEventListener('click', () => { rememberHive(); state.hive = lastRecommend.map((g) => ({ ...g })); renderHive(); toast('Мой улей заменён на подобранный', { label: 'Вернуть', run: undoHive }); });
  $('copyRec')?.addEventListener('click', () => {
    const text = lastRecommend.map((g) => `${g.gifted ? 'Gifted ' : ''}${g.name} x${g.count} L${g.level}`).join(', ');
    navigator.clipboard?.writeText(text);
  });
  for (const tr of document.querySelectorAll('tr[data-field]')) tr.addEventListener('click', () => { state.field = tr.dataset.field; renderFields(); save(); });
}

/** Улей из текста "Gifted Rad Bee x5 L10, Basic Bee x10" → { groups, bad } */
function parseHive(text) {
  const groups = [];
  const bad = [];
  for (const part of text.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean)) {
    let gifted = false; let count = 1; let level = 10; let rest = part;
    if (/^(gifted|g|🌟)\s+/i.test(rest)) { gifted = true; rest = rest.replace(/^(gifted|g|🌟)\s+/i, ''); }
    rest = rest.replace(/\s+[x×*]\s*(\d+)/i, (_, a) => { count = Number(a); return ''; });
    rest = rest.replace(/^(\d+)\s*[x×*]?\s+/, (_, a) => { count = Number(a); return ''; });
    rest = rest.replace(/\s+(?:L|lvl|lv|ур\.?)\s*(\d+)/i, (_, a) => { level = Number(a); return ''; });
    const n = rest.trim().toLowerCase().replace(/\s*bee$/, '');
    const bee = data.bees.find((b) => b.name.toLowerCase().replace(/\s*bee$/, '') === n) || data.bees.find((b) => b.name.toLowerCase().startsWith(n));
    if (bee) groups.push({ name: bee.name, count, level, gifted }); else bad.push(part);
  }
  return { groups, bad };
}

// ---------- калибровка ----------
async function renderCalNow() {
  const cal = await call('getCalibration');
  const v = cal?.values;
  $('calNow').innerHTML = v
    ? `Сейчас: сбор пчёл ×${v.gatherScale.toFixed(2)} · токены ×${v.tokenScale.toFixed(2)} · конвертация ×${v.convertScale.toFixed(2)} <span class="muted">(${esc(cal.field || '')}, ${new Date(cal.savedAt).toLocaleDateString('ru')})</span>`
    : '<span class="muted">Пока не откалибровано — числа модели «как по вики».</span>';
}
async function runCalibrate() {
  const num = (id) => Number($(id).value) || 0;
  const measurements = {
    still: { minutes: num('calStillMin'), pollen: num('calStillPollen') },
    tokens: { minutes: num('calTokMin'), pollen: num('calTokPollen') },
    convert: { seconds: num('calConvSec'), pollen: num('calConvPollen') },
  };
  if (!state.hive.length) { $('calReport').innerHTML = '<li class="warn">Сначала введи свой улей.</li>'; return; }
  try {
    const fit = await call('calibrate', { ...base(), hive: state.hive, field: state.field, measurements });
    $('calReport').innerHTML = fit.report.map((l) => `<li>${esc(l)}</li>`).join('') || '<li>Нет замеров — заполни хотя бы первый.</li>';
    if (!fit.ok) return;
    const res = await fetch('/api/calibration', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: fit.values, field: state.field, hive: state.hive, measured: measurements, report: fit.report }),
    }).then((r) => r.json());
    if (!res.ok) throw new Error(res.error);
    await call('setCalibration', res.calibration);
    $('calReport').insertAdjacentHTML('beforeend', '<li>Сохранено в data/calibration.json — сайт и Claude (MCP) теперь считают с этой поправкой.</li>');
    renderCalNow();
  } catch (e) { $('calReport').innerHTML = `<li class="warn">Ошибка: ${esc(e.message || e)}</li>`; }
}
async function resetCalibrate() {
  await fetch('/api/calibration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"reset":true}' });
  await call('setCalibration', null);
  $('calReport').innerHTML = '<li>Калибровка сброшена.</li>';
  renderCalNow();
}

// ---------- события ----------
function bind() {
  // улей: ЛКМ — редактор, ПКМ — убрать, «+» — выбор пчёл, наведение — подсказка
  const grid = $('hiveGrid');
  grid.addEventListener('click', (e) => {
    const t = e.target.closest('.bee-tile');
    if (!t) return;
    if (t.dataset.add) { openPicker(); return; }
    hideTip();
    const g = state.hive[Number(t.dataset.gi)];
    if (editing && editing.sig === sig(g)) { closeEditor(); return; }
    editing = { sig: sig(g) };
    placeEditor();
  });
  grid.addEventListener('contextmenu', (e) => {
    const t = e.target.closest('.bee-tile');
    if (!t || t.dataset.add) return;
    e.preventDefault();
    removeBee(Number(t.dataset.gi), t);
  });
  grid.addEventListener('keydown', (e) => {
    const t = e.target.closest('.bee-tile');
    if (t && !t.dataset.add && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); removeBee(Number(t.dataset.gi), t); }
  });
  grid.addEventListener('mouseover', (e) => { const t = e.target.closest('.bee-tile'); if (t && !t.dataset.add) showTip(t); });
  grid.addEventListener('mouseout', (e) => { const t = e.target.closest('.bee-tile'); if (t && !t.contains(e.relatedTarget)) hideTip(); });
  // редактор
  $('beePop').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const eg = editorGroup();
    if (!act || !eg) return;
    const { gi, g } = eg;
    if (act === 'close') closeEditor();
    else if (act === 'lvl-') editOne(gi, { level: Math.max(1, g.level - 1) });
    else if (act === 'lvl+') editOne(gi, { level: Math.min(25, g.level + 1) });
    else if (act === 'gift') editOne(gi, { gifted: !g.gifted });
    else if (act === 'dup') { rememberHive(); g.count += 1; freshSig = sig(g); renderHive(); placeEditor(); }
    else if (act === 'del') { const tile = [...document.querySelectorAll(`.bee-tile[data-gi="${gi}"]`)].pop(); removeBee(gi, tile); }
  });
  $('beePop').addEventListener('change', (e) => {
    const act = e.target.dataset.act;
    const eg = editorGroup();
    if (!eg) return;
    if (act === 'mut') {
      const d = mutDef(e.target.value);
      editOne(eg.gi, { mutation: d ? { id: d.id, value: eg.g.mutation?.id === d.id ? eg.g.mutation.value : d.min } : null });
    } else if (act === 'mutval') {
      const v = Number(e.target.value);
      if (Number.isFinite(v) && eg.g.mutation) editOne(eg.gi, { mutation: { ...eg.g.mutation, value: v } });
    }
  });
  document.addEventListener('mousedown', (e) => {
    if (editing && !e.target.closest('#beePop') && !e.target.closest('.bee-tile')) closeEditor();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('picker').hidden) closePicker(); else if (editing) closeEditor();
  });
  window.addEventListener('resize', () => { if (editing) placeEditor(); });
  // выбор пчёл
  $('pickSearch').addEventListener('input', renderPicker);
  $('picker').addEventListener('click', (e) => {
    if (e.target === $('picker') || e.target.closest('[data-pick="close"]')) { closePicker(); return; }
    const lv = e.target.closest('[data-pick]')?.dataset.pick;
    if (lv === 'lvl-') state.pick.level = Math.max(1, state.pick.level - 1);
    if (lv === 'lvl+') state.pick.level = Math.min(25, state.pick.level + 1);
    if (lv === 'gift') state.pick.gifted = !state.pick.gifted;
    if (lv) { save(); renderPicker(); return; }
    const p = e.target.closest('.pick');
    if (!p) return;
    const one = { name: p.dataset.name, count: 1, level: state.pick.level, gifted: state.pick.gifted };
    rememberHive();
    state.hive.push(one);
    freshSig = sig(one);
    p.classList.remove('added'); void p.offsetWidth; p.classList.add('added');
    renderHive();
    renderPicker();
  });
  $('parseText').addEventListener('click', () => {
    const { groups, bad } = parseHive($('hiveText').value);
    rememberHive();
    state.hive = groups;
    renderHive();
    if (bad.length) alert(`Не понял: ${bad.join(', ')}`);
  });
  $('clearHive').addEventListener('click', () => { rememberHive(); state.hive = []; renderHive(); toast('Улей очищен', { label: 'Вернуть', run: undoHive }); });
  document.addEventListener('keydown', (e) => {
    // Ctrl+Z — отменить изменение улья (кроме полей ввода, там своя отмена)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !e.target.closest('input, textarea, select')) { e.preventDefault(); undoHive(); }
  });
  $('shareHive').addEventListener('click', () => {
    const url = `${location.origin}/?hive=${encodeURIComponent($('hiveText').value)}`;
    navigator.clipboard?.writeText(url);
    $('shareHive').textContent = 'Ссылка скопирована';
  });
  $('goalSeg').addEventListener('change', (e) => setGoal(e.target.value));
  $('fieldSelect').addEventListener('change', (e) => { state.field = e.target.value; save(); });
  $('questGiver').addEventListener('change', () => { state.questGiver = $('questGiver').value; save(); renderQuests(); });
  $('questSearch').addEventListener('input', renderQuests);
  $('questList').addEventListener('change', (e) => {
    const k = e.target.dataset.q;
    if (!k) return;
    const set = new Set(state.quests || []);
    if (e.target.checked) set.add(k); else set.delete(k);
    state.quests = [...set];
    save(); renderQuests();
  });
  $('questPickLast').addEventListener('click', () => {
    // последние N квестов цепочки выбранного медведя (без повторяющихся)
    const giver = $('questGiver').value || 'Black Bear';
    const n = Math.max(1, Number($('questLastN').value) || 15);
    const chain = data.quests.filter((q) => q.giver === giver && !/Repeatable/i.test(q.section || '') && q.requirements.some((r) => r.type === 'pollen' || r.type === 'token'));
    state.quests = chain.slice(-n).map(questKey);
    save(); renderQuests(); scrollToSelectedQuest();
    toast(`Выбрано ${Math.min(n, chain.length)}: ${giver}`);
  });
  $('questClear').addEventListener('click', () => { state.quests = []; save(); renderQuests(); });
  $('questOnlySel').addEventListener('change', renderQuests);
  $('sideTabs').addEventListener('click', (e) => { const t = e.target.closest('button')?.dataset.side; if (t) setSide(t); });
  // статы: режим, вкладки, снаряжение, бейджи, амулеты, ручной ввод
  $('statsMode').addEventListener('click', (e) => { const m = e.target.closest('button')?.dataset.mode; if (m) { state.setup.mode = m; save(); renderStatsCard(); } });
  $('gearTabs').addEventListener('click', (e) => { const t = e.target.closest('button.tab')?.dataset.tab; if (t) { state.setup.tab = t; save(); renderStatsCard(); } });
  $('walkSeconds').addEventListener('input', (e) => { state.setup.walkSeconds = Number(e.target.value) || 20; save(); });
  $('tabbyStacks').addEventListener('input', (e) => { state.setup.tabbyStacks = e.target.value === '' ? '' : Math.max(0, Math.min(1000, Number(e.target.value) || 0)); save(); });
  $('polarPower').addEventListener('input', (e) => { state.setup.polarPower = Math.max(0, Number(e.target.value) || 0); save(); });
  for (const inp of document.querySelectorAll('[data-drive]')) inp.addEventListener('input', (e) => {
    const k = e.target.dataset.drive;
    state.setup.digitalDrives = { ...(state.setup.digitalDrives || {}) };
    if (e.target.value === '') delete state.setup.digitalDrives[k];
    else state.setup.digitalDrives[k] = Math.max(0, Math.min(500, Math.round(Number(e.target.value) || 0)));
    save();
  });
  $('scienceStacks').addEventListener('input', (e) => { state.setup.scienceStacks = Math.max(0, Math.min(31, Number(e.target.value) || 0)); save(); });
  $('gearSlots').addEventListener('change', (e) => { const k = e.target.dataset.slot; if (k) { state.setup.gear[k] = e.target.value; save(); renderGear(); } });
  $('customTool').addEventListener('input', (e) => { state.setup.gear.customTool = Number(e.target.value) || ''; save(); });
  $('badgeGrid').addEventListener('change', (e) => {
    const b = e.target.dataset.badge;
    if (!b) return;
    state.setup.gear.badges ??= {};
    if (e.target.value) state.setup.gear.badges[b] = e.target.value; else delete state.setup.gear.badges[b];
    save(); renderBadges();
  });
  $('allBadges').addEventListener('change', (e) => {
    if (!e.target.value) return;
    state.setup.gear.badges = Object.fromEntries(data.gear.badges.map((b) => [b.category, e.target.value === 'none' ? '' : e.target.value]).filter(([, v]) => v));
    e.target.value = '';
    save(); renderBadges();
  });
  $('addAmulet').addEventListener('click', addAmulet);
  bindBuffs();
  bindAmulets();
  $('extraLines').addEventListener('input', (e) => { state.setup.gear.extra = e.target.value; save(); });
  $('statsFromGame').addEventListener('change', (e) => { state.setup.statsFromGame = e.target.checked; save(); });
  $('manualPassives').addEventListener('change', () => {
    state.setup.manualPassives = [...document.querySelectorAll('[data-passive]')].filter((x) => x.checked).map((x) => x.dataset.passive);
    save();
  });
  // буст поля — стаки Field Boost (раньше было «+% пыльцы»: 100% = 1 стак)
  if (state.fieldBoostStacks === undefined && state.fieldBoost) state.fieldBoostStacks = Math.min(4, Math.round(state.fieldBoost / 100));
  delete state.fieldBoost;
  $('fieldBoost').value = state.fieldBoostStacks || '';
  $('fieldBoost').addEventListener('input', (e) => { state.fieldBoostStacks = Math.max(0, Math.min(4, Math.round(Number(e.target.value) || 0))); save(); });
  $('stats').addEventListener('input', (e) => {
    const k = e.target.dataset.stat;
    if (!k) return;
    const kind = STATS.find((x) => x[0] === k)[2];
    const v = Number(e.target.value);
    if (!Number.isFinite(v)) return;
    state.setup.manual[k] = kind === 'pct' || kind === 'chance' ? v / 100 : v;
    save();
  });
  $('optSlots').addEventListener('input', (e) => { state.opt.slots = Math.max(1, Math.min(50, Number(e.target.value) || 1)); slotsHint(); save(); });
  $('slotsHint').querySelector('button').addEventListener('click', () => { state.opt.slots = totalBees(); $('optSlots').value = state.opt.slots; slotsHint(); save(); });
  $('optLevel').addEventListener('input', (e) => { state.opt.level = Math.max(1, Math.min(25, Number(e.target.value) || 1)); save(); });
  $('optKeep').addEventListener('change', (e) => { state.opt.keep = e.target.checked; save(); });
  $('optCard').addEventListener('click', (e) => {
    const p = e.target.closest('[data-preset]')?.dataset.preset;
    const gp = e.target.closest('[data-gpreset]')?.dataset.gpreset;
    if (p) applyPreset(p);
    if (gp) applyGiftedPreset(gp);
    const lk = e.target.closest('[data-lim="lock"]');
    if (lk) {
      const name = lk.closest('.limit').dataset.bee;
      const l = (state.opt.limits[name] ??= { allow: true, max: '', maxGifted: 0 });
      l.lock = !l.lock;
      if (l.lock) l.allow = true;
      save(); renderLimits();
      return;
    }
    const tog = e.target.closest('[data-lim="toggle"]');
    if (tog) {
      const name = tog.closest('.limit').dataset.bee;
      const l = (state.opt.limits[name] ??= { allow: false, max: '', maxGifted: 0 });
      l.allow = !l.allow;
      save();
      const card = tog.closest('.limit');
      card.classList.toggle('off', !l.allow);
      card.classList.remove('flip'); void card.offsetWidth; card.classList.add('flip');
    }
  });
  $('limitsGrid').addEventListener('input', (e) => {
    const k = e.target.dataset.lim;
    if (k !== 'max' && k !== 'maxGifted') return;
    const name = e.target.closest('.limit').dataset.bee;
    const l = (state.opt.limits[name] ??= { allow: true, max: '', maxGifted: 0 });
    l[k] = e.target.value === '' ? '' : Math.max(0, Math.min(maxFor(beeByName.get(name)), Number(e.target.value) || 0));
    if (e.target.value !== '' && Number(e.target.value) !== l[k]) e.target.value = l[k];
    save();
  });
  // лодауты: список слева, окно «встроенный менять нельзя — скопировать?», полоса над вкладками
  bindLoadoutDrag();
  $('loNew').addEventListener('click', newLoadout);
  $('roBanner').addEventListener('click', (e) => { if (e.target.closest('[data-ro="copy"]')) copyLoadout(state.loadouts.active); });
  $('roDialog').addEventListener('click', (e) => {
    const a = e.target.closest('[data-ro]')?.dataset.ro;
    if (e.target === $('roDialog') || a === 'cancel') { closeCopyDialog(); return; }
    if (a === 'copy') { const p = pendingCopy; closeCopyDialog(); copyLoadout(state.loadouts.active, p); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('roDialog').hidden) { e.stopPropagation(); closeCopyDialog(); } }, true);
  $('calFit').addEventListener('click', runCalibrate);
  $('calReset').addEventListener('click', resetCalibrate);
  $('runEval').addEventListener('click', runEvaluate);
  $('runOpt').addEventListener('click', runOptimize);
}

/** Загрузить data/<name>.json; если сервер его не отдаёт — понятная ошибка вместо «not found is not valid JSON». */
async function loadJson(name) {
  const r = await fetch(`/data/${name}.json`);
  if (!r.ok) throw new Error(`сервер не отдал data/${name}.json (${r.status}). Скорее всего, запущена старая версия — перезапусти ./run.sh`);
  return r.json();
}

async function init() {
  const [bees, fields, quests, gear] = await Promise.all(['bees', 'fields', 'quests', 'gear'].map(loadJson));
  for (const f of fields) {
    const s = f.white + f.red + f.blue || 1;
    f.mix = { white: f.white / s, red: f.red / s, blue: f.blue / s };
  }
  data = { bees, fields, quests, gear, slots: await call('slots'), passives: await call('passiveList'), mutations: await loadJson('mutations'), amulets: await loadJson('amulets').catch(() => null) };
  // иконки токенов и баффов, баффы на выбор (scripts/build-icons.mjs); без них сайт работает, просто без картинок
  data.icons = await loadJson('token-icons').catch(() => null);
  data.buffs = (await loadJson('buffs').catch(() => null))?.buffs || [];
  if (data.icons) await buildRoundIcons([...Object.values(data.icons.tokens), ...Object.values(data.icons.buffs), ...data.buffs.map((b) => b.look)]);
  $('buffGroup').innerHTML = `<option value="">все</option>${[...new Map(data.buffs.map((b) => [b.group, b.groupRu])).entries()].map(([g, l]) => `<option value="${esc(g)}">${esc(l || g)}</option>`).join('')}`;
  beeByName = new Map(bees.map((b) => [b.name, b]));
  // иконки пчёл (если файла нет — будут цветные точки)
  await buildBeeIcons(await loadJson('bee-icons').catch(() => null));
  state.hive = state.hive.filter((g) => beeByName.has(g.name));
  $('dataInfo').textContent = `${bees.length} пчёл · ${fields.length} полей · ${quests.length} квестов`;
  const givers = [...new Set(quests.map((q) => q.giver).filter(Boolean))];
  $('questGiver').innerHTML = `<option value="">все</option>${givers.map((g) => `<option ${g === state.questGiver ? 'selected' : ''}>${esc(g)}</option>`).join('')}`;
  // ссылка вида ?hive=Gifted Rad Bee x5 L10, … подставляет улей (и им можно делиться)
  // «мой улей» и «мои статы» из проекта (data/my-hive.json, my-setup.json) главнее браузера:
  // сайт сам пишет туда каждое изменение, а Claude может поправить файлы — и это сразу видно здесь
  // лодауты из проекта (data/loadouts.json) главнее браузера: сайт сам пишет туда каждое изменение,
  // а Claude может поправить файл — и это сразу видно здесь
  builtinBest = bestLoadout(data.gear);
  const lf = await fetchJson('/data/loadouts.json');
  if (lf?.list?.length) setLoadouts(lf);
  else {
    // лодаутов ещё нет: всё, что было («мой улей» и «мои статы» из проекта или браузера), становится лодаутом «Основной»
    const [mine, mySetup] = await Promise.all([fetchJson('/data/my-hive.json'), fetchJson('/data/my-setup.json')]);
    const main = { id: newLoadoutId(), name: 'Основной', hive: Array.isArray(mine) && mine.length ? mine : state.hive, setup: fullSetup(mySetup?.mode ? mySetup : state.setup) };
    setLoadouts({ active: main.id, list: [{ id: BEST_ID, builtin: true }, main], rev: mySetup?.rev ?? 0 });
    lastSent = null;
  }
  // настройки подбора раньше жили только в браузере — отдаём их лодаутам, у которых своих ещё нет.
  // Замки на ивентовых и мифических ставил старый пресет «Реалистично» (будто их потом не вернуть) — снимаем
  if (saved.opt) {
    for (const l of state.loadouts.list) {
      if (l.builtin || l.opt) continue;
      l.opt = clone(saved.opt);
      for (const [name, lim] of Object.entries(l.opt.limits || {})) if (lim.lock && ['event', 'mythic'].includes(beeByName.get(name)?.rarity)) lim.lock = false;
    }
  }
  applyLoadout(state.loadouts.active);
  // ссылка вида ?hive=Gifted Rad Bee x5 L10, … подставляет улей (и им можно делиться)
  const linkHive = new URLSearchParams(location.search).get('hive');
  if (linkHive) state.hive = parseHive(linkHive).groups;
  renderLoadouts(); renderRoBanner();
  renderHive(); renderFields(); renderStatsCard(); renderOpt(); renderQuests();
  setGoal(state.goal);
  bind();
  renderCalNow();
  // http://localhost:8820/#calibrate, #stats, #goal, #hive — сразу открыть нужную вкладку
  const hash = location.hash.slice(1);
  const side = { calibrate: 'cal', cal: 'cal', stats: 'stats', gear: 'stats', badges: 'stats', amulets: 'stats', buffs: 'stats', total: 'stats', goal: 'goal', hive: 'hive', result: 'result' }[hash];
  if (side) state.side = side;
  if (TABS[hash]) { state.setup.tab = hash; state.setup.mode = 'gear'; renderStatsCard(); }
  if ((side || state.side) === 'goal') requestAnimationFrame(scrollToSelectedQuest);
  if (hash === 'add') { state.side = 'hive'; renderSide(); openPicker(); }
  // для проверки: ?auto=…&open=edit — сразу открыть редактор первой пчелы
  if (TEST_RUN && new URLSearchParams(location.search).get('open') === 'edit' && state.hive.length) { state.side = 'hive'; renderSide(); editing = { sig: sig(state.hive[0]) }; placeEditor(); }
  renderSide();
  // для проверки: ?auto=…&last=15 — выбрать последние N квестов Black Bear
  const lastN = TEST_RUN && Number(new URLSearchParams(location.search).get('last'));
  if (lastN) {
    state.quests = data.quests.filter((q) => q.giver === 'Black Bear' && !/Repeatable/i.test(q.section || '')).slice(-lastN).map(questKey);
    setGoal('quest'); renderQuests();
  }
  // для проверки: ?auto=…&lo=Лучшее — открыть лодаут; &edit=1 — изменить статы (у встроенного — окно «скопировать?»)
  const loParam = TEST_RUN && new URLSearchParams(location.search).get('lo');
  if (loParam) { const l = state.loadouts.list.find((x) => x.id === loParam || loadoutData(x).name === loParam); if (l) switchLoadout(l.id); }
  const fieldParam = TEST_RUN && new URLSearchParams(location.search).get('field'); // &field=Pepper Patch
  if (fieldParam) { state.field = fieldParam; renderFields(); }
  if (TEST_RUN && new URLSearchParams(location.search).get('edit')) { state.setup.walkSeconds = 99; save(); }
  // для проверки: ?auto=eval или ?auto=opt сразу запускает расчёт
  const auto = new URLSearchParams(location.search).get('auto');
  if (auto === 'eval') runEvaluate(); else if (auto === 'opt') runOptimize();
}
init().catch((e) => {
  // показываем ошибку там, где её видно сразу
  state.side = 'result';
  renderSide();
  $('emptyState').hidden = true;
  fail(e);
});
