#!/usr/bin/env node
// Локальный сервер сайта BSS Hive: только раздаёт файлы (всё считается в браузере, в Web Worker).
//   node site/server.mjs            → http://localhost:8820
//   PORT=9000 node site/server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BEST_ID, bestLoadout } from '../core/loadouts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8820);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
// что можно отдавать: страница и её файлы, модель, собранные данные (сырые страницы вики — нет)
const ALLOWED = [path.join(ROOT, 'site'), path.join(ROOT, 'core')];

const LOADOUTS_FILE = path.join(ROOT, 'data', 'loadouts.json');
const HIVE_FILE = path.join(ROOT, 'data', 'my-hive.json');
const SETUP_FILE = path.join(ROOT, 'data', 'my-setup.json');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f, v) => fs.writeFileSync(f, `${JSON.stringify(v, null, 1)}\n`);
const clampInt = (v, lo, hi, d) => Math.max(lo, Math.min(hi, Math.round(Number(v)) || d));
/** Улей из запроса: только понятные поля (мутация — { id, value }). */
function cleanHive(h) {
  if (!Array.isArray(h)) return [];
  return h.filter((g) => g && typeof g.name === 'string').slice(0, 60).map((g) => {
    const out = { name: g.name.slice(0, 60), count: clampInt(g.count, 1, 50, 1), level: clampInt(g.level, 1, 25, 1), gifted: !!g.gifted };
    if (g.mutation && typeof g.mutation.id === 'string' && Number.isFinite(Number(g.mutation.value))) out.mutation = { id: g.mutation.id.slice(0, 40), value: Number(g.mutation.value) };
    return out;
  });
}
const cleanObj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : undefined);
/** Статы лодаута без служебных полей (rev/savedAt есть только у копии в my-setup.json). */
function cleanSetup(o) {
  const out = { ...(cleanObj(o) || {}) };
  for (const k of ['rev', 'savedAt', 'loadout', 'tab']) delete out[k];
  return out;
}
/** Лодауты из запроса: { active, list: [{ id, name, hive, setup, opt } | { id: 'best', builtin: true, opt }] }. */
function cleanLoadouts(msg) {
  const seen = new Set();
  const list = [];
  for (const l of Array.isArray(msg?.list) ? msg.list.slice(0, 100) : []) {
    if (!l || typeof l.id !== 'string' || seen.has(l.id)) continue;
    seen.add(l.id);
    if (l.id === BEST_ID) { list.push({ id: BEST_ID, builtin: true, opt: cleanObj(l.opt) }); continue; }
    list.push({ id: l.id.slice(0, 40), name: String(l.name || 'Без названия').slice(0, 60), hive: cleanHive(l.hive), setup: cleanSetup(l.setup), opt: cleanObj(l.opt) });
  }
  if (!seen.has(BEST_ID)) list.unshift({ id: BEST_ID, builtin: true });
  const active = list.some((l) => l.id === msg?.active) ? msg.active : (list.find((l) => !l.builtin) || list[0]).id;
  return { active, list };
}
/** Активный лодаут → data/my-hive.json и data/my-setup.json (их читает MCP как "my" и старые вкладки сайта). */
function mirrorActive(lo, rev) {
  let a = lo.list.find((l) => l.id === lo.active);
  if (a?.builtin) a = bestLoadout(readJson(path.join(ROOT, 'data', 'gear.json')));
  if (!a) return;
  writeJson(HIVE_FILE, a.hive || []);
  writeJson(SETUP_FILE, { ...(a.setup || {}), loadout: a.name, rev, savedAt: new Date().toISOString() });
}

/**
 * POST /api/me — сайт сохраняет лодауты (улей + статы каждого), чтобы их видел и Claude (MCP: "my" — активный).
 *   { rev, loadouts: { active, list } }  — новый формат;
 *   { rev, hive, setup }                 — старый (вкладка, открытая до лодаутов): меняет активный лодаут.
 */
function saveMe(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 2000000) req.destroy(); });
  req.on('end', () => {
    try {
      const msg = JSON.parse(body || '{}');
      // защита от затирания: страница присылает номер версии, которую она загрузила;
      // если файл с тех пор поменяли (другая вкладка, Claude), отвечаем 409 — страница подтянет свежие данные
      const file = readJson(LOADOUTS_FILE);
      const curRev = file?.rev ?? readJson(SETUP_FILE)?.rev ?? 0;
      if (msg.rev !== curRev) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, conflict: true, rev: curRev }));
        return;
      }
      const rev = curRev + 1;
      let lo = null;
      if (msg.loadouts) lo = cleanLoadouts(msg.loadouts);
      else if (file) {
        // старая вкладка: её улей и статы — в активный лодаут (во встроенный «Лучшее» не пишем)
        lo = cleanLoadouts(file);
        const a = lo.list.find((l) => l.id === lo.active);
        if (a && !a.builtin) { if (Array.isArray(msg.hive)) a.hive = cleanHive(msg.hive); if (cleanObj(msg.setup)) a.setup = cleanSetup(msg.setup); }
      }
      if (lo) {
        writeJson(LOADOUTS_FILE, { rev, savedAt: new Date().toISOString(), ...lo });
        mirrorActive(lo, rev);
      } else {
        // лодаутов ещё нет — как раньше, только «мой улей» и «мои статы»
        if (Array.isArray(msg.hive)) writeJson(HIVE_FILE, cleanHive(msg.hive));
        if (cleanObj(msg.setup)) writeJson(SETUP_FILE, { ...msg.setup, rev, savedAt: new Date().toISOString() });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rev }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
  });
}
const CALIBRATION_FILE = path.join(ROOT, 'data', 'calibration.json');
const SCALE_KEYS = ['gatherScale', 'tokenScale', 'convertScale'];

/** POST /api/calibration { values: {gatherScale, tokenScale, convertScale}, ... } — сохранить подгонку; { reset: true } — удалить. */
function saveCalibration(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 20000) req.destroy(); });
  req.on('end', () => {
    try {
      const msg = JSON.parse(body || '{}');
      if (msg.reset) {
        fs.rmSync(CALIBRATION_FILE, { force: true });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true,"reset":true}');
        return;
      }
      const values = {};
      for (const k of SCALE_KEYS) {
        const v = Number(msg.values?.[k]);
        if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error(`плохое значение ${k}`);
        values[k] = Math.round(v * 10000) / 10000;
      }
      const out = { values, savedAt: new Date().toISOString(), field: String(msg.field || ''), hive: msg.hive ?? null, measured: msg.measured ?? null, report: msg.report ?? [] };
      fs.writeFileSync(CALIBRATION_FILE, `${JSON.stringify(out, null, 1)}\n`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, calibration: out }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
  });
}

function resolve(urlPath) {
  const p = decodeURIComponent(urlPath.split('?')[0]);
  if (p === '/' || p === '/index.html') return path.join(ROOT, 'site', 'index.html');
  // любые файлы данных верхнего уровня data/*.json (сырые страницы и код игры в data/raw — нет)
  const m = p.match(/^\/data\/([a-z0-9-]+\.json)$/);
  if (m) return path.join(ROOT, 'data', m[1]);
  const file = path.normalize(path.join(ROOT, p.startsWith('/core/') ? '' : 'site', p));
  return ALLOWED.some((dir) => file.startsWith(dir + path.sep)) ? file : null;
}

const server = http.createServer((req, res) => {
  // для скриншотов в headless-браузере: ?auto=… вставляет картинку /__wait, она держит событие load
  if (req.url.startsWith('/__wait')) {
    const ms = Math.min(120000, Number(new URL(req.url, 'http://x').searchParams.get('ms')) || 4000);
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'image/gif' }); res.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64')); }, ms);
    return;
  }
  if (req.method === 'POST' && req.url === '/api/calibration') { saveCalibration(req, res); return; }
  if (req.method === 'POST' && req.url === '/api/me') { saveMe(req, res); return; }
  const file = resolve(req.url || '/');
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});
server.listen(PORT, '127.0.0.1', () => console.log(`BSS Hive: http://localhost:${PORT}`));
