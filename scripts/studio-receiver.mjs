#!/usr/bin/env node
// Запуск: node scripts/studio-receiver.mjs data/raw/game   (см. docs/MODEL.md → «Данные из копии игры в Studio»)
// Принимает исходники модулей из Roblox Studio (POST /save?name=X) и кладёт их в отдельную папку как текст.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
let saved = 0;
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method !== 'POST' || url.pathname !== '/save') { res.writeHead(404); res.end(); return; }
  const name = (url.searchParams.get('name') || '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120);
  if (!name) { res.writeHead(400); res.end(); return; }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    fs.writeFileSync(path.join(OUT, name), Buffer.concat(chunks));
    saved++;
    res.writeHead(200);
    res.end(`ok ${saved}`);
  });
}).listen(8899, '127.0.0.1', () => console.log('receiver on 8899 →', OUT));
