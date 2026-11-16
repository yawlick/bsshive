#!/usr/bin/env node
// Иконки пчёл как в меню игры: закруглённый квадрат цвета тела пчелы + лицо, окрашенное в цвет лица.
// Данные — из копии игры в Studio (ReplicatedStorage.BeeModels: цвет кубика, декаль FaceTexture с номером картинки и Color3),
// выгружены в data/raw/game/_bee_models.json. Картинки лиц — через публичный API миниатюр Roblox.
//   node scripts/fetch-bee-images.mjs
// Пишет site/img/faces/<Пчела>.png (белое лицо на прозрачном фоне) и data/bee-icons.json (цвета).
// Собирает иконку сайт (canvas: фон, затем лицо × цвет — как Decal.Color3 в Roblox).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data', 'raw', 'game', '_bee_models.json');
const OUT = path.join(ROOT, 'site', 'img', 'faces');
const UA = 'bsshive-image-fetcher/0.1';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const models = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const idOf = (s) => String(s || '').match(/(\d+)/)?.[1];
const wanted = Object.entries(models).filter(([, m]) => idOf(m.face)).map(([key, m]) => ({ key, id: idOf(m.face) }));

fs.mkdirSync(OUT, { recursive: true });
const urls = new Map();
for (let i = 0; i < wanted.length; i += 50) {
  const ids = [...new Set(wanted.slice(i, i + 50).map((w) => w.id))].join(',');
  const res = await fetch(`https://thumbnails.roblox.com/v1/assets?assetIds=${ids}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`, { headers: { 'User-Agent': UA } });
  for (const d of (await res.json()).data || []) if (d.state === 'Completed' && d.imageUrl) urls.set(String(d.targetId), d.imageUrl);
}
let ok = 0;
const missing = [];
for (const w of wanted) {
  const url = urls.get(w.id);
  if (!url || !/^https:\/\/[a-z0-9.-]+\.rbxcdn\.com\//.test(url)) { missing.push(w.key); continue; }
  const buf = Buffer.from(await (await fetch(url, { headers: { 'User-Agent': UA } })).arrayBuffer());
  if (!buf.subarray(0, 4).equals(PNG)) { missing.push(`${w.key} (не PNG)`); continue; }
  fs.writeFileSync(path.join(OUT, `${w.key}.png`), buf);
  ok++;
}
const icons = {};
for (const [key, m] of Object.entries(models)) {
  icons[key] = { body: m.body, faceColor: m.faceColor, face: fs.existsSync(path.join(OUT, `${key}.png`)), material: m.material };
}
fs.writeFileSync(path.join(ROOT, 'data', 'bee-icons.json'), `${JSON.stringify(icons, null, 1)}\n`);
console.log(`лиц скачано ${ok}/${wanted.length}${missing.length ? `; нет: ${missing.join(', ')}` : ''}`);
