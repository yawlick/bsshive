// Разбор литерала Lua-таблицы (как в Module:Ability Tokens/data) в обычный JS-объект.
// Ничего не выполняет: понимает только строки, числа, true/false/nil, таблицы,
// склейку литералов через `..` и комментарии (-- и --[[ ]]).
export function parseLuaTable(src) {
  let i = 0;
  const n = src.length;

  function skip() {
    for (;;) {
      while (i < n && /\s/.test(src[i])) i++;
      if (src.startsWith('--', i)) {
        const block = src.slice(i + 2).match(/^\[(=*)\[/);
        if (block) {
          const close = `]${block[1]}]`;
          const end = src.indexOf(close, i + 2 + block[0].length);
          i = end < 0 ? n : end + close.length;
        } else {
          const nl = src.indexOf('\n', i);
          i = nl < 0 ? n : nl + 1;
        }
        continue;
      }
      return;
    }
  }

  function str() {
    const q = src[i++];
    let out = '';
    while (i < n && src[i] !== q) {
      if (src[i] === '\\') {
        const c = src[i + 1];
        if (/[0-9]/.test(c)) {
          const m = src.slice(i + 1).match(/^[0-9]{1,3}/)[0];
          out += String.fromCharCode(Number(m));
          i += 1 + m.length;
          continue;
        }
        out += { n: '\n', t: '\t', r: '\r', '"': '"', "'": "'", '\\': '\\' }[c] ?? c;
        i += 2;
        continue;
      }
      out += src[i++];
    }
    i++;
    // Lua-строки — байты; \226\128\162 и т.п. собираем обратно в UTF-8
    return Buffer.from(out, 'latin1').toString('utf8');
  }

  function atom() {
    skip();
    const c = src[i];
    if (c === '{') return table();
    if (c === '"' || c === "'") return str();
    if (src.startsWith('[[', i)) {
      const end = src.indexOf(']]', i + 2);
      const s = src.slice(i + 2, end);
      i = end + 2;
      return s;
    }
    const num = src.slice(i).match(/^-?(0x[0-9a-fA-F]+|[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)/);
    if (num) { i += num[0].length; return Number(num[0]); }
    const word = src.slice(i).match(/^[A-Za-z_][A-Za-z_0-9]*/);
    if (word) {
      i += word[0].length;
      if (word[0] === 'true') return true;
      if (word[0] === 'false') return false;
      if (word[0] === 'nil') return null;
      throw new Error(`Не литерал: ${word[0]} около позиции ${i}`);
    }
    throw new Error(`Неожиданный символ "${c}" около позиции ${i}`);
  }

  function value() {
    let v = atom();
    for (;;) {
      skip();
      if (!src.startsWith('..', i)) return v;
      i += 2;
      v = String(v) + String(atom());
    }
  }

  function table() {
    i++; // {
    const arr = [];
    const obj = {};
    let isArr = true;
    for (;;) {
      skip();
      if (src[i] === '}') { i++; break; }
      let key = null;
      if (src[i] === '[' && src[i + 1] !== '[') {
        i++;
        key = value();
        skip();
        if (src[i] !== ']') throw new Error(`Ожидалась ] около ${i}`);
        i++;
        skip();
        i++; // =
      } else {
        const m = src.slice(i).match(/^([A-Za-z_][A-Za-z_0-9]*)\s*=(?!=)/);
        if (m) { key = m[1]; i += m[0].length; }
      }
      const v = value();
      if (key === null) arr.push(v);
      else { isArr = false; obj[key] = v; }
      skip();
      if (src[i] === ',' || src[i] === ';') i++;
    }
    if (isArr) return arr;
    arr.forEach((v, k) => { obj[k + 1] = v; });
    return obj;
  }

  const start = src.indexOf('{');
  i = start;
  return table();
}
