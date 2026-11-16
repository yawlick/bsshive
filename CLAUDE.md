# BSS Hive

Калькулятор/подбор улья Bee Swarm Simulator. docs/MODEL.md — спецификация модели, структура и что приблизительно.

- Ядро — `core/` (ES-модули, без зависимостей); его используют и сайт (`site/worker.js`), и MCP (`mcp/server.mjs`).
- Данные `data/*.json` не править руками: `node scripts/fetch-wiki.mjs && node scripts/build-data.mjs`.
  Амулеты (`data/amulets.json`) — из кода игры: `node scripts/build-amulets.mjs` (нужен `data/raw/game`).
  Иконки токенов/баффов и баффы на выбор (`data/token-icons.json`, `data/buffs.json`, `site/img/icons`) — `node scripts/build-icons.mjs`.
  Что выгружено из Studio сверх модулей: `data/raw/game/_buff_decals.json` (Decal-иконки в Buffs), `_collectible_children.json` (дети модулей Collectibles).
- После правок модели: `node scripts/selftest.mjs`.
- Сайт для проверок запускать `PORT=8821 node site/server.mjs`, не `./run.sh` (он открывает браузер пользователю).
  Сайт пользователя на 8820 работает в фоне (`node --watch`, лог .server.log) и сам подхватывает правки — его не трогать.
  Headless-скриншот: `firefox --headless --no-remote --profile <scratch>/ffprof --screenshot out.png "http://127.0.0.1:8821/?auto=opt&wait=5000"`
  (`?auto=eval|opt|none` запускает расчёт, `wait` держит load, пока считается). С `?auto=` страница НИЧЕГО не сохраняет —
  без него сайт пишет «мой улей/статы» пользователя в data/my-hive.json и data/my-setup.json (POST /api/me), так что
  в тестах всегда добавлять `?auto=`. `#stats`, `#badges`, `#total`, `#goal`, `#calibrate` — открыть нужную вкладку.
  `&lo=<имя или id>` — открыть лодаут, `&edit=1` — изменить статы (у встроенного «Лучшее» должно появиться окно «скопировать?»).
- Лодауты пользователя — `data/loadouts.json` (истина); `data/my-hive.json` и `my-setup.json` — копия активного, их пишет сервер.
  Править руками — loadouts.json (и поднять `rev`), иначе открытый сайт перезапишет. Встроенный «Лучшее» — `core/loadouts.js`.
- Числа без источника — только в `CALIBRATION` (`core/model.js`) с пометкой ГРУБО; каждая грубая оценка видна пользователю в notes.
- `data/calibration.json` — подгонка пользователя по замерам из игры; в тестах не создавать/не перетирать (selftest её отключает).
- Квесты «убей N мобов» пользователь просил не считать вообще.
- Копия игры BSS в Roblox Studio (если открыта) — источник данных: только ЧИТАТЬ (run_code + HttpService:PostAsync в
  scripts/studio-receiver.mjs), ничего не менять в месте; `require` модулей не работает (декомпилятор оставил ошибки) —
  код разбирать как текст (scripts/build-game-bees.mjs). Игру (Sober) не трогать — замеры пользователь делает сам.
- Ответы пользователю — на русском.
