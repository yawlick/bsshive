// Загрузка data/*.json для Node (сайт грузит их через fetch, см. site/app.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare } from './model.js';
import { findLoadout } from './loadouts.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let cached = null;
export function loadData() {
  if (cached) return cached;
  const read = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', n), 'utf8'));
  cached = prepare({ bees: read('bees.json'), tokens: read('tokens.json'), fields: read('fields.json'), quests: read('quests.json') });
  cached.gear = read('gear.json');
  try { cached.buffs = read('buffs.json').buffs; } catch { cached.buffs = []; } // баффы для «держу всё время» (scripts/build-icons.mjs)
  cached.calibration = readCalibration();
  return cached;
}

export const MY_HIVE_FILE = path.join(ROOT, 'data', 'my-hive.json');
export const MY_SETUP_FILE = path.join(ROOT, 'data', 'my-setup.json');
export const LOADOUTS_FILE = path.join(ROOT, 'data', 'loadouts.json');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/** Лодауты с сайта (data/loadouts.json): { rev, active, list } или null, если сайт их ещё не сохранял. */
export const readLoadouts = () => readJson(LOADOUTS_FILE);
/**
 * Лодаут по имени/id; "my" — активный. Если лодаутов ещё нет — «мой улей» и «мои статы» из my-hive/my-setup.
 * @returns { id, name, builtin, hive, setup } или null
 */
export function loadoutOf(nameOrId = 'my') {
  const file = readLoadouts();
  if (!file) {
    if (!/^(my|мой|мои|active)?$/i.test(String(nameOrId).trim())) return findLoadout(null, loadData().gear, nameOrId); // встроенный «Лучшее»
    return { id: 'my', name: 'мой', hive: readJson(MY_HIVE_FILE), setup: readJson(MY_SETUP_FILE) };
  }
  return findLoadout(file, loadData().gear, nameOrId);
}
/** "@Основной" / "loadout:Основной" → "Основной"; иначе null. */
export function loadoutRef(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(?:@|loadout:\s*|лодаут:\s*)(.+)$/i);
  return m ? m[1].trim() : null;
}
/** Улей пользователя: активного лодаута (data/my-hive.json — его копия), или null. */
export function readMyHive() {
  return loadoutOf('my')?.hive ?? readJson(MY_HIVE_FILE);
}
/** "my" / "мой улей" → улей активного лодаута; "@Имя" → улей лодаута «Имя»; остальное как есть. */
export function resolveHiveArg(h) {
  const isMy = typeof h === 'string' && /^\s*(my( hive)?|мой( улей)?)\s*$/i.test(h);
  const ref = isMy ? 'my' : loadoutRef(h);
  if (ref === null) return h;
  const l = loadoutOf(ref);
  if (!l) throw new Error(`Нет лодаута «${ref}». Список — bss_loadouts`);
  if (!l.hive?.length) throw new Error(l.hive ? `В лодауте «${l.name}» улей пустой — передай hive явно или возьми другой лодаут` : 'Нет data/my-hive.json — улей пользователя ещё не сохранён');
  return l.hive;
}

/** Статы пользователя с сайта (активный лодаут): { mode: 'gear'|'manual', gear: {...}, manual: {...}, statsFromGame, walkSeconds } или null. */
export function readMySetup() {
  return loadoutOf('my')?.setup ?? readJson(MY_SETUP_FILE);
}

export const CALIBRATION_FILE = path.join(ROOT, 'data', 'calibration.json');
/** Подгонка по замерам из игры, если она есть (иначе null). */
export function readCalibration() {
  try { return JSON.parse(fs.readFileSync(CALIBRATION_FILE, 'utf8')); } catch { return null; }
}
export function writeCalibration(cal) {
  fs.writeFileSync(CALIBRATION_FILE, `${JSON.stringify(cal, null, 1)}\n`);
  if (cached) cached.calibration = cal;
}
