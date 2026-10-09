/**
 * 将 3500_az.csv（word, ipa, zh）转为萤火 VocabItem 列表，写入 src/data/gaokao3500.generated.json
 *
 * 用法:
 *   node scripts/build-gaokao3500.mjs [path/to/3500_az.csv]
 *   或: GAOKAO3500_CSV=path node scripts/build-gaokao3500.mjs
 *
 * 默认尝试: 环境变量 GAOKAO3500_CSV，否则 argv[2]，否则相对本仓库的 tools/gaokao3500/3500_az.csv
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'src', 'data', 'gaokao3500.generated.json');

function splitZh(zh) {
  const s = String(zh ?? '').trim();
  if (!s) return { partOfSpeech: '—', meaning: '—' };
  const idx = s.search(/[\u4e00-\u9fff《（]/);
  if (idx <= 0 || idx > 36) return { partOfSpeech: '—', meaning: s };
  const head = s.slice(0, idx).trim();
  const tail = s.slice(idx).trim();
  if (!/^[a-zA-Z./\s]+$/.test(head.replace(/\s+/g, ''))) return { partOfSpeech: '—', meaning: s };
  return { partOfSpeech: head.replace(/\s+/g, ' ').slice(0, 24) || '—', meaning: tail || s };
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (!inQ && c === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function pickCsvPath() {
  const env = process.env.GAOKAO3500_CSV?.trim();
  if (env) return env;
  const arg = process.argv[2]?.trim();
  if (arg) return arg;
  return join(ROOT, 'tools', 'gaokao3500', '3500_az.csv');
}

function rowToItem(word, ipa, zh) {
  const w = String(word ?? '').trim();
  const ipaStr = String(ipa ?? '').trim();
  const { partOfSpeech, meaning } = splitZh(zh);
  const meanClip = meaning.length > 42 ? `${meaning.slice(0, 40)}…` : meaning;
  const ipaClip = ipaStr.length > 44 ? `${ipaStr.slice(0, 42)}…` : ipaStr;
  return {
    word: w,
    partOfSpeech,
    meaning,
    collocations: [ipaClip || '—', meanClip || '—', `${w} · 高考3500`],
  };
}

function main() {
  const csvPath = pickCsvPath();
  let text;
  try {
    text = readFileSync(csvPath, 'utf8');
  } catch (e) {
    console.error(`无法读取 CSV: ${csvPath}`);
    console.error(e?.message || e);
    process.exit(1);
  }

  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) {
    console.error('CSV 为空');
    process.exit(1);
  }

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const wi = header.indexOf('word');
  const ii = header.indexOf('ipa');
  const zi = header.indexOf('zh');
  if (wi < 0 || ii < 0 || zi < 0) {
    console.error('CSV 需包含表头: word, ipa, zh');
    process.exit(1);
  }

  const byKey = new Map();
  for (let r = 1; r < lines.length; r++) {
    const cols = parseCsvLine(lines[r]);
    if (cols.length < 3) continue;
    const word = cols[wi];
    const ipa = cols[ii];
    const zh = cols.slice(zi).join(','); // 若 zh 中含逗号且未加引号会错列；本数据源 zh 在引号内或单行
    if (!word) continue;
    const item = rowToItem(word, ipa, zh);
    const key = word.trim().toLowerCase().replace(/\s+/g, ' ');
    byKey.set(key, item);
  }

  const entries = [...byKey.values()];
  entries.sort((a, b) => a.word.localeCompare(b.word, 'en'));

  const payload = {
    dataVersion: 1,
    sourceNote: 'Derived from MIT-licensed gaokao3500-vocab (pluto0x0) 3500_az.csv — see NOTICE',
    count: entries.length,
    entries,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(payload)}\n`, 'utf8');
  console.log(`Wrote ${OUT} (${entries.length} entries) from ${csvPath}`);
}

main();
