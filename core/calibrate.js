// Подгонка модели по замерам из игры. Три независимых замера, каждый подгоняет свой коэффициент:
//   still   — стоял на поле N минут, токены не собирал, инструментом не кликал → gatherScale (сбор пчёл + пламя)
//   tokens  — то же, но собирал токены и лопал пузыри                     → tokenScale (пыльца способностей и пузырей)
//   convert — в улье за S секунд сконвертировалось P пыльцы               → convertScale
// Пыльца меряется в рюкзаке (цифра на полоске), рюкзак не должен заполниться до конца замера.
import { CALIBRATION, evaluate } from './model.js';

export const SCALE_KEYS = ['gatherScale', 'tokenScale', 'convertScale'];

/**
 * @param m { still?: {minutes, pollen}, tokens?: {minutes, pollen}, convert?: {seconds, pollen} }
 * @returns { values: {gatherScale, tokenScale, convertScale}, report: [строки], ok }
 */
export function fitCalibration(data, hive, opts, m) {
  const base = { ...CALIBRATION, ...data.calibration?.values, ...opts.calibration };
  const values = { gatherScale: base.gatherScale, tokenScale: base.tokenScale, convertScale: base.convertScale };
  const report = [];
  const noTool = { ...opts.player, toolPollenPerSec: 0 };
  const run = (cal) => evaluate(data, hive, { field: opts.field, player: noTool, calibration: { ...base, ...cal } });
  let ok = false;

  if (m.still?.minutes > 0 && m.still?.pollen > 0) {
    const sec = m.still.minutes * 60;
    const r = run({ gatherScale: 1, tokenPickup: 0, bubblesPopped: 0 });
    const predicted = r.bagPerSec * sec;
    if (predicted > 0) {
      values.gatherScale = m.still.pollen / predicted;
      ok = true;
      report.push(`Сбор пчёл: модель ждала ${Math.round(predicted).toLocaleString('ru')}, в игре ${Math.round(m.still.pollen).toLocaleString('ru')} → ×${values.gatherScale.toFixed(2)}`);
      if (m.still.pollen >= r.cycle.capacity * 0.98) report.push('⚠ рюкзак был полон — замер занижен, повтори короче');
    }
  }

  if (m.tokens?.minutes > 0 && m.tokens?.pollen > 0) {
    const sec = m.tokens.minutes * 60;
    const bag = (scale) => run({ gatherScale: values.gatherScale, tokenScale: scale }).bagPerSec * sec;
    const withoutTokens = bag(0);
    if (m.tokens.pollen <= withoutTokens) {
      values.tokenScale = 0;
      report.push(`Токены: в игре (${Math.round(m.tokens.pollen).toLocaleString('ru')}) не больше, чем без токенов по модели (${Math.round(withoutTokens).toLocaleString('ru')}) → ×0. Проверь замер «стоял на месте».`);
    } else {
      // пыльца растёт с tokenScale монотонно — ищем делением пополам
      let lo = 0;
      let hi = 1;
      while (bag(hi) < m.tokens.pollen && hi < 100) hi *= 2;
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (bag(mid) < m.tokens.pollen) lo = mid; else hi = mid; }
      values.tokenScale = (lo + hi) / 2;
      report.push(`Токены и пузыри: модель ждала ${Math.round(bag(1)).toLocaleString('ru')}, в игре ${Math.round(m.tokens.pollen).toLocaleString('ru')} → ×${values.tokenScale.toFixed(2)}`);
    }
    ok = true;
  }

  if (m.convert?.seconds > 0 && m.convert?.pollen > 0) {
    const r = run({ convertScale: 1 });
    const measured = m.convert.pollen / m.convert.seconds;
    if (r.convertPerSec > 0) {
      values.convertScale = measured / r.convertPerSec;
      ok = true;
      report.push(`Конвертация: модель ${Math.round(r.convertPerSec).toLocaleString('ru')}/с, в игре ${Math.round(measured).toLocaleString('ru')}/с → ×${values.convertScale.toFixed(2)}`);
    }
  }

  for (const k of SCALE_KEYS) if (values[k] > 3 || (values[k] < 0.33 && values[k] !== 0)) report.push(`⚠ ${k} = ${values[k].toFixed(2)} — сильно отличается от 1: проверь, что улей, поле и статы введены как в игре`);
  return { values, report, ok };
}
