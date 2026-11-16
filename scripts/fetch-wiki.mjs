#!/usr/bin/env node
// Скачивает вики-текст страниц Bee Swarm Simulator Wiki (fandom) в data/raw/pages/<Title>.wiki.
// Использование:
//   node scripts/fetch-wiki.mjs                 — все страницы из списков ниже
//   node scripts/fetch-wiki.mjs "Page" "Page 2" — только указанные
//   node scripts/fetch-wiki.mjs --cat Fields    — все страницы категории
// Это сырые данные из интернета: скрипты их только читают и разбирают, ничего из них не запускают.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'raw', 'pages');
const API = 'https://bee-swarm-simulator.fandom.com/api.php';
const UA = 'bsshive-data-fetcher/0.1 (personal hive calculator)';

const CATEGORIES = ['Bees', 'Fields'];
const PAGES = [
  'Pollen', 'Honey', 'Flowers', 'Fields', 'Ability Tokens', 'Stats', 'System Page', 'Bond', 'Hive',
  'Gifted Bee', 'Bee Quests', 'Quests', 'Hive Bonus', 'Backpacks', 'Collectors', 'Conversion',
  'Black Bear', 'Brown Bear', 'Panda Bear', 'Polar Bear', 'Science Bear', 'Mother Bear', 'Spirit Bear',
  'Bucko Bee (NPC)', 'Riley Bee (NPC)', 'Honey Bee (NPC)', 'Onett', 'Dapper Bear', 'Stick Bug',
  'Gummy Bear', 'Bee Bear', 'Mutation', 'Bee Level', 'Bee Abilities', 'Pollen Collection',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fileFor = (title) => path.join(OUT, `${title.replace(/[\/\\:*?"<>|]/g, '_')}.wiki`);

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function categoryMembers(cat) {
  const titles = [];
  let cont = {};
  for (;;) {
    const d = await api({ action: 'query', list: 'categorymembers', cmtitle: `Category:${cat}`, cmlimit: '500', ...cont });
    for (const m of d.query.categorymembers) if (m.ns === 0) titles.push(m.title);
    if (!d.continue) return titles;
    cont = d.continue;
  }
}

async function fetchPage(title) {
  const d = await api({ action: 'parse', page: title, prop: 'wikitext', redirects: '1' });
  if (d.error) return { title, error: d.error.info };
  fs.writeFileSync(fileFor(title), d.parse.wikitext);
  return { title, resolved: d.parse.title, bytes: d.parse.wikitext.length };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const args = process.argv.slice(2);
  let titles;
  if (args[0] === '--cat') titles = await categoryMembers(args[1]);
  else if (args.length) titles = args;
  else {
    titles = [...PAGES];
    for (const c of CATEGORIES) titles.push(...(await categoryMembers(c)));
  }
  titles = [...new Set(titles)];
  const report = [];
  for (const t of titles) {
    try { report.push(await fetchPage(t)); } catch (e) { report.push({ title: t, error: String(e.message || e) }); }
    await sleep(250);
  }
  fs.writeFileSync(path.join(ROOT, 'data', 'raw', 'fetch-report.json'), JSON.stringify({ at: new Date().toISOString(), report }, null, 1));
  const bad = report.filter((r) => r.error);
  console.log(`fetched ${report.length - bad.length}/${report.length}`);
  for (const b of bad) console.log(`  missing: ${b.title} — ${b.error}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
