/** 管理浏览器本地词表初始化、查询和词条缓存。 */
import { db } from '../db/database';
import type { GoldenSentence, VocabItem, VocabKnowledgeRow, VocabKnowledgeSource } from '../types';
import { PRESET_VOCAB, PRESET_VOCAB_VERSION } from '../data/presetVocab';
import { GAOKAO3500_DATA_VERSION, GAOKAO3500_ENTRIES } from '../data/gaokao3500Bundle';

/** 组合版本：手写预置 + 高考3500 数据版本 */
export const VOCAB_BUNDLE_STORAGE_KEY = 'yinghuo_vocab_bundle_v';

/** @deprecated 旧版 localStorage 键，灌库成功后会移除 */
const VOCAB_LEGACY_PRESET_KEY = 'yinghuo_vocab_preset_v';

const BULK_CHUNK = 400;

export function getCurrentBundleVersionString(): string {
  return JSON.stringify({ hand: PRESET_VOCAB_VERSION, gaokao: GAOKAO3500_DATA_VERSION });
}

export function normalizeWordKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?…]+$/g, '')
    .replace(/\s+/g, ' ');
}

function rowToVocabItem(r: VocabKnowledgeRow): VocabItem {
  return {
    word: r.word,
    partOfSpeech: r.partOfSpeech,
    meaning: r.meaning,
    collocations: r.collocations,
  };
}

function itemToRow(item: VocabItem, source: VocabKnowledgeSource, updatedAt: Date): VocabKnowledgeRow {
  return {
    wordKey: normalizeWordKey(item.word),
    word: item.word.trim(),
    partOfSpeech: item.partOfSpeech,
    meaning: item.meaning,
    collocations: [...(item.collocations || [])].slice(0, 8),
    source,
    updatedAt,
  };
}

async function seedVocabBundle(): Promise<void> {
  const now = new Date();
  await db.transaction('rw', db.vocabKnowledge, async () => {
    const gaokaoRows: VocabKnowledgeRow[] = GAOKAO3500_ENTRIES.map((item) =>
      itemToRow(item, 'gaokao3500', now),
    );
    for (let i = 0; i < gaokaoRows.length; i += BULK_CHUNK) {
      await db.vocabKnowledge.bulkPut(gaokaoRows.slice(i, i + BULK_CHUNK));
    }
    for (const item of PRESET_VOCAB) {
      const key = normalizeWordKey(item.word);
      if (!key) continue;
      await db.vocabKnowledge.put(itemToRow(item, 'preset', now));
    }
  });
  localStorage.removeItem(VOCAB_LEGACY_PRESET_KEY);
  localStorage.setItem(VOCAB_BUNDLE_STORAGE_KEY, getCurrentBundleVersionString());
}

let seeding: Promise<void> | null = null;

/**
 * 将高考3500 + 手写预置词写入 IndexedDB；版本变化时全量重灌。
 */
export function ensureVocabBundleSeeded(): Promise<void> {
  if (seeding) return seeding;
  if (localStorage.getItem(VOCAB_BUNDLE_STORAGE_KEY) === getCurrentBundleVersionString()) {
    return Promise.resolve();
  }
  seeding = (async () => {
    if (localStorage.getItem(VOCAB_BUNDLE_STORAGE_KEY) === getCurrentBundleVersionString()) return;
    await seedVocabBundle();
  })().finally(() => {
    seeding = null;
  });
  return seeding;
}

/** 兼容旧调用名 */
export function ensurePresetVocabSeeded(): Promise<void> {
  return ensureVocabBundleSeeded();
}

export async function lookupVocabItem(raw: string): Promise<VocabItem | null> {
  await ensureVocabBundleSeeded();
  const key = normalizeWordKey(raw);
  if (!key) return null;
  const row = await db.vocabKnowledge.get(key);
  return row ? rowToVocabItem(row) : null;
}

/**
 * 将 AI 返回的词条写入缓存（不覆盖手写预置与高考3500）。
 */
export async function putCachedVocabItem(item: VocabItem): Promise<void> {
  const key = normalizeWordKey(item.word);
  if (!key) return;
  const existing = await db.vocabKnowledge.get(key);
  if (existing?.source === 'preset' || existing?.source === 'gaokao3500') return;
  const row: VocabKnowledgeRow = {
    wordKey: key,
    word: item.word.trim(),
    partOfSpeech: item.partOfSpeech,
    meaning: item.meaning,
    collocations: [...(item.collocations || [])].slice(0, 5),
    source: 'cached',
    updatedAt: new Date(),
  };
  await db.vocabKnowledge.put(row);
}

/**
 * 用本地知识库覆盖金句中的词汇；未命中则保留模型结果并写入缓存。
 */
export async function enrichVocabularyFromItems(items: VocabItem[]): Promise<VocabItem[]> {
  if (!items.length) return items;
  await ensureVocabBundleSeeded();
  const out: VocabItem[] = [];
  for (const item of items) {
    const key = normalizeWordKey(item.word);
    if (!key) {
      out.push(item);
      continue;
    }
    const row = await db.vocabKnowledge.get(key);
    if (row) {
      out.push(rowToVocabItem(row));
    } else {
      out.push(item);
      await putCachedVocabItem(item);
    }
  }
  return out;
}

export async function enrichGoldenSentencesVocabulary(sentences: GoldenSentence[]): Promise<GoldenSentence[]> {
  if (!sentences.length) return sentences;
  return Promise.all(
    sentences.map(async (gs) => ({
      ...gs,
      vocabulary: await enrichVocabularyFromItems(gs.vocabulary || []),
    })),
  );
}
