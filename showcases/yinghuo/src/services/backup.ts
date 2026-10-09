/** 封装用户本地数据的 JSON 备份、导入与版本兼容。 */
import { db } from '../db/database';
import type { NoteProject, Note, ChatMessage, VocabKnowledgeRow } from '../types';
import { VOCAB_BUNDLE_STORAGE_KEY, getCurrentBundleVersionString } from './vocabKnowledge';

export const BACKUP_VERSION = 2;

export interface BackupPayload {
  version: number;
  app: 'yinghuo';
  exportedAt: string;
  projects: NoteProject[];
  notes: Note[];
  chatMessages: ChatMessage[];
  /** 本地词库（预置 + 缓存），v1 备份无此字段 */
  vocabKnowledge?: VocabKnowledgeRow[];
}

function asDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number') return new Date(v);
  return new Date();
}

function reviveProject(raw: NoteProject): NoteProject {
  return {
    ...raw,
    createdAt: asDate(raw.createdAt as unknown as Date),
  };
}

function reviveNote(raw: Note): Note {
  return {
    ...raw,
    createdAt: asDate(raw.createdAt as unknown as Date),
    updatedAt: asDate(raw.updatedAt as unknown as Date),
  };
}

function reviveChat(raw: ChatMessage): ChatMessage {
  return {
    ...raw,
    timestamp: asDate(raw.timestamp as unknown as Date),
  };
}

export function parseBackupJson(text: string): BackupPayload {
  const data = JSON.parse(text) as Partial<BackupPayload>;
  if (!data || typeof data !== 'object' || data.app !== 'yinghuo' || typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) {
    throw new Error('不是有效的萤火备份文件');
  }
  if (data.version > BACKUP_VERSION) {
    throw new Error(`备份版本 ${data.version} 高于当前应用支持版本，请更新应用`);
  }
  if (!Array.isArray(data.projects) || !Array.isArray(data.notes) || !Array.isArray(data.chatMessages)) {
    throw new Error('备份文件结构不完整');
  }
  validateBackupRecords(data as BackupPayload);
  return {
    version: data.version,
    app: 'yinghuo',
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : new Date().toISOString(),
    projects: data.projects.map(p => reviveProject(p as NoteProject)),
    notes: data.notes.map(n => reviveNote(n as Note)),
    chatMessages: data.chatMessages.map(c => reviveChat(c as ChatMessage)),
    vocabKnowledge: Array.isArray((data as Partial<BackupPayload>).vocabKnowledge)
      ? (data as Partial<BackupPayload>).vocabKnowledge!.map((v) => reviveVocab(v as VocabKnowledgeRow))
      : undefined,
  };
}

/** 在导入事务开始前检查记录与关联，避免无效字段进入现有数据库。 */
function validateBackupRecords(data: BackupPayload): void {
  const fail = () => { throw new Error('备份记录的字段、日期或关联不完整，未导入任何数据。'); };
  const record = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
    return value as Record<string, unknown>;
  };
  const required = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
  const stringArray = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string');
  const date = (value: unknown) => (value instanceof Date || typeof value === 'string' || typeof value === 'number') && Number.isFinite(new Date(value).getTime());
  const unique = (rows: unknown[]) => {
    const ids = rows.map(row => record(row).id);
    if (ids.some(id => !required(id)) || new Set(ids).size !== ids.length) fail();
  };
  const vocabulary = (value: unknown) => {
    const item = record(value);
    if (!required(item.word) || typeof item.partOfSpeech !== 'string' || typeof item.meaning !== 'string' || !stringArray(item.collocations)) fail();
  };
  unique(data.projects); unique(data.notes); unique(data.chatMessages);
  const projectIds = new Set(data.projects.map(project => project.id));
  for (const raw of data.projects) {
    const item = record(raw);
    if (!required(item.name) || !date(item.createdAt)) fail();
    for (const key of ['agentName', 'agentPersonality', 'agentAvatar']) if (item[key] !== undefined && typeof item[key] !== 'string') fail();
    if (item.agentProfile !== undefined) {
      const profile = record(item.agentProfile);
      if (!stringArray(profile.traits) || !stringArray(profile.favoriteThemes) || !stringArray(profile.representativeQuotes) || typeof profile.tone !== 'string' || typeof profile.summary !== 'string') fail();
    }
  }
  for (const raw of data.notes) {
    const item = record(raw);
    if (!projectIds.has(raw.projectId) || typeof item.content !== 'string' || !date(item.createdAt) || !date(item.updatedAt)) fail();
    for (const key of ['title', 'translation']) if (item[key] !== undefined && typeof item[key] !== 'string') fail();
    if (item.goldenSentences !== undefined) {
      if (!Array.isArray(item.goldenSentences)) fail();
      const sentences = item.goldenSentences as unknown[];
      unique(sentences);
      for (const sentence of sentences) {
        const gs = record(sentence);
        if (gs.noteId !== item.id || !required(gs.original) || typeof gs.english !== 'string' || typeof gs.grammarAnalysis !== 'string' || typeof gs.advancedRewrite !== 'string' || !stringArray(gs.scenarios) || !Array.isArray(gs.vocabulary)) fail();
        if (gs.source !== undefined && !['auto', 'manual'].includes(String(gs.source))) fail();
        (gs.vocabulary as unknown[]).forEach(vocabulary);
      }
    }
  }
  for (const raw of data.chatMessages) {
    const item = record(raw);
    if (!projectIds.has(raw.projectId) || !['user', 'agent'].includes(raw.role) || typeof item.content !== 'string' || !date(item.timestamp)) fail();
  }
  if (data.vocabKnowledge !== undefined) {
    if (!Array.isArray(data.vocabKnowledge)) fail();
    const keys = new Set<string>();
    for (const raw of data.vocabKnowledge) {
      vocabulary(raw);
      if (!required(raw.wordKey) || keys.has(raw.wordKey) || !['preset', 'gaokao3500', 'cached'].includes(raw.source) || !date(raw.updatedAt)) fail();
      keys.add(raw.wordKey);
    }
  }
}

function reviveVocab(raw: VocabKnowledgeRow): VocabKnowledgeRow {
  return {
    ...raw,
    updatedAt: asDate((raw as unknown as { updatedAt: unknown }).updatedAt as Date),
  };
}

export async function collectBackupPayload(): Promise<BackupPayload> {
  const [projects, notes, chatMessages, vocabKnowledge] = await Promise.all([
    db.projects.toArray(),
    db.notes.toArray(),
    db.chatMessages.toArray(),
    db.vocabKnowledge.toArray(),
  ]);
  return {
    version: BACKUP_VERSION,
    app: 'yinghuo',
    exportedAt: new Date().toISOString(),
    projects,
    notes,
    chatMessages,
    vocabKnowledge: vocabKnowledge.length > 0 ? vocabKnowledge : undefined,
  };
}

export function downloadBackupJson(payload: BackupPayload): void {
  const text = JSON.stringify(payload, null, 2);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const name = `yinghuo-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** 清空后写入（与备份文件完全一致） */
export async function importBackupReplace(payload: BackupPayload): Promise<void> {
  await db.transaction('rw', db.projects, db.notes, db.chatMessages, db.vocabKnowledge, async () => {
    await db.projects.clear();
    await db.notes.clear();
    await db.chatMessages.clear();
    await db.vocabKnowledge.clear();
    if (payload.projects.length) await db.projects.bulkAdd(payload.projects);
    if (payload.notes.length) await db.notes.bulkAdd(payload.notes);
    if (payload.chatMessages.length) await db.chatMessages.bulkAdd(payload.chatMessages);
    const vk = payload.vocabKnowledge;
    if (vk?.length) await db.vocabKnowledge.bulkAdd(vk);
  });
  if (payload.vocabKnowledge?.length) {
    localStorage.setItem(VOCAB_BUNDLE_STORAGE_KEY, getCurrentBundleVersionString());
  } else {
    localStorage.removeItem(VOCAB_BUNDLE_STORAGE_KEY);
    localStorage.removeItem('yinghuo_vocab_preset_v');
  }
}

/** 按 id 合并（同 id 覆盖为备份中的版本） */
export async function importBackupMerge(payload: BackupPayload): Promise<void> {
  await db.transaction('rw', db.projects, db.notes, db.chatMessages, db.vocabKnowledge, async () => {
    if (payload.projects.length) await db.projects.bulkPut(payload.projects);
    if (payload.notes.length) await db.notes.bulkPut(payload.notes);
    if (payload.chatMessages.length) await db.chatMessages.bulkPut(payload.chatMessages);
    if (payload.vocabKnowledge?.length) await db.vocabKnowledge.bulkPut(payload.vocabKnowledge);
  });
}
