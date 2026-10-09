/** 定义浏览器 IndexedDB 数据表及版本迁移。 */
import Dexie, { type Table } from 'dexie';
import type { NoteProject, Note, GoldenSentence, ChatMessage, VocabKnowledgeRow } from '../types';

export class YinghuoDB extends Dexie {
  projects!: Table<NoteProject>;
  notes!: Table<Note>;
  goldenSentences!: Table<GoldenSentence>;
  chatMessages!: Table<ChatMessage>;
  vocabKnowledge!: Table<VocabKnowledgeRow>;

  constructor() {
    super('YinghuoDB');
    this.version(1).stores({
      projects: 'id, name, createdAt',
      notes: 'id, projectId, createdAt, updatedAt',
      goldenSentences: 'id, noteId',
      chatMessages: 'id, projectId, timestamp',
    });
    this.version(2).stores({
      projects: 'id, name, createdAt',
      notes: 'id, projectId, createdAt, updatedAt',
      goldenSentences: 'id, noteId',
      chatMessages: 'id, projectId, timestamp',
      vocabKnowledge: '&wordKey, source, updatedAt',
    });
  }
}

export const db = new YinghuoDB();
