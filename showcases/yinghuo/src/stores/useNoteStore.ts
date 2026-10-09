/** 日记状态与 IndexedDB 持久化；异步结果按日记集隔离，避免切换后写错界面或覆盖金句。 */
import { create } from 'zustand';
import { db } from '../db/database';
import type { NoteProject, Note, GoldenSentence, ChatMessage, AgentProfile } from '../types';
import { v4 as uuidv4 } from 'uuid';

let notesLoadVersion = 0;
let chatLoadVersion = 0;

async function updateSentences(noteId: string, transform: (sentences: GoldenSentence[]) => GoldenSentence[]) {
  return db.transaction('rw', db.notes, async () => {
    const note = await db.notes.get(noteId);
    if (!note) throw new Error('这篇随笔已删除，操作未保存。');
    const goldenSentences = transform(note.goldenSentences ?? []);
    await db.notes.update(noteId, { goldenSentences });
    return goldenSentences;
  });
}

function clearRecoveredSaveError() {
  const state = useNoteStore.getState();
  const pending = Object.values(state.failedDrafts).some(draft => draft.content !== undefined || draft.title !== undefined);
  if (!pending && /^(部分修改尚未保存|上一篇随笔的本地保存失败)/.test(state.storageError)) useNoteStore.setState({ storageError: '' });
}

interface NoteState {
  projects: NoteProject[];
  notes: Note[];
  activeProjectId: string | null;
  activeNoteId: string | null;
  chatMessages: ChatMessage[];
  totalNoteCount: number;
  isAnalyzing: boolean;
  storageError: string;
  clearStorageError: () => void;
  failedDrafts: Record<string, { content?: string; title?: string }>;
  rememberFailedDraft: (id: string, draft: { content?: string; title?: string }) => void;
  retryFailedDrafts: () => Promise<void>;
  flushActiveEdits: (() => Promise<void>) | null;
  pendingChatProjects: Record<string, boolean>;
  setChatReplying: (projectId: string, pending: boolean) => void;

  loadProjects: () => Promise<void>;
  createProject: (name: string) => Promise<NoteProject>;
  deleteProject: (id: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  updateProjectAgent: (id: string, agentName: string, agentPersonality: string) => Promise<void>;
  updateProjectProfile: (id: string, agentName: string, agentPersonality: string, agentProfile: AgentProfile) => Promise<void>;
  regenerateAgentProfile: (projectId: string) => Promise<void>;
  setActiveProject: (id: string | null) => void;

  loadNotes: (projectId: string) => Promise<void>;
  createNote: (projectId: string) => Promise<Note>;
  updateNote: (id: string, content: string) => Promise<void>;
  updateNoteTitle: (id: string, title: string) => Promise<void>;
  saveNoteAnalysis: (id: string, translation: string, goldenSentences: GoldenSentence[], expectedContent?: string) => Promise<void>;
  addManualGoldenSentence: (noteId: string, gs: GoldenSentence) => Promise<void>;
  removeGoldenSentence: (noteId: string, gsId: string) => Promise<void>;
  addVocabToGoldenSentence: (noteId: string, gsId: string, vocab: import('../types').VocabItem) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  setActiveNote: (id: string | null) => void;
  getActiveNote: () => Note | undefined;

  loadChatMessages: (projectId: string) => Promise<void>;
  addChatMessage: (projectId: string, role: 'user' | 'agent', content: string) => Promise<void>;
  clearChat: (projectId: string) => Promise<void>;

  setAnalyzing: (v: boolean) => void;
  loadTotalCount: () => Promise<void>;
}

export const useNoteStore = create<NoteState>((set, get) => ({
  projects: [],
  notes: [],
  activeProjectId: null,
  activeNoteId: null,
  chatMessages: [],
  totalNoteCount: 0,
  isAnalyzing: false,
  storageError: '',
  clearStorageError: () => set({ storageError: '' }),
  failedDrafts: {},
  flushActiveEdits: null,
  pendingChatProjects: {},
  setChatReplying: (projectId, pending) => set(state => ({ pendingChatProjects: { ...state.pendingChatProjects, [projectId]: pending } })),
  rememberFailedDraft: (id, draft) => set(state => ({ failedDrafts: { ...state.failedDrafts, [id]: { ...state.failedDrafts[id], ...draft } } })),
  retryFailedDrafts: async () => {
    const drafts = get().failedDrafts;
    for (const [id, draft] of Object.entries(drafts)) {
      if (!await db.notes.get(id)) { set(state => ({ failedDrafts: Object.fromEntries(Object.entries(state.failedDrafts).filter(([key]) => key !== id)) })); continue; }
      if (draft.content !== undefined) await get().updateNote(id, draft.content);
      if (draft.title !== undefined) await get().updateNoteTitle(id, draft.title);
    }
    set({ storageError: '' });
  },

  loadProjects: async () => {
    const projects = await db.projects.orderBy('createdAt').reverse().toArray();
    set({ projects });
    await get().loadTotalCount();
  },

  createProject: async (name: string) => {
    const project: NoteProject = {
      id: uuidv4(),
      name,
      createdAt: new Date(),
    };
    await db.projects.add(project);
    await get().loadProjects();
    return project;
  },

  deleteProject: async (id: string) => {
    await db.transaction('rw', db.notes, db.chatMessages, db.projects, async () => {
      await db.notes.where('projectId').equals(id).delete();
      await db.chatMessages.where('projectId').equals(id).delete();
      await db.projects.delete(id);
    });
    const { activeProjectId } = get();
    if (activeProjectId === id) {
      set({ activeProjectId: null, activeNoteId: null, notes: [], chatMessages: [] });
    }
    await get().loadProjects();
  },

  renameProject: async (id: string, name: string) => {
    await db.projects.update(id, { name });
    await get().loadProjects();
  },

  updateProjectAgent: async (id: string, agentName: string, agentPersonality: string) => {
    await db.projects.update(id, { agentName, agentPersonality });
    await get().loadProjects();
  },

  updateProjectProfile: async (id: string, agentName: string, agentPersonality: string, agentProfile: AgentProfile) => {
    await db.projects.update(id, { agentName, agentPersonality, agentProfile });
    await get().loadProjects();
  },

  regenerateAgentProfile: async (projectId: string) => {
    const { generateAgentProfile } = await import('../services/aiService');
    const notes = await db.notes.where('projectId').equals(projectId).toArray();
    const project = get().projects.find(p => p.id === projectId);
    const result = await generateAgentProfile(notes, project?.agentName);
    await db.projects.update(projectId, {
      agentName: result.name,
      agentPersonality: result.personality,
      agentProfile: result.profile,
    });
    await get().loadProjects();
  },

  setActiveProject: (id: string | null) => {
    notesLoadVersion++;
    chatLoadVersion++;
    set({ activeProjectId: id, activeNoteId: null, notes: [], chatMessages: [] });
    if (id) {
      Promise.all([get().loadNotes(id), get().loadChatMessages(id)]).catch(() => {
        if (get().activeProjectId === id) set({ storageError: '读取本地日记失败，请重试或检查浏览器存储权限。' });
      });
    }
  },

  loadNotes: async (projectId: string) => {
    const version = ++notesLoadVersion;
    const notes = await db.notes
      .where('projectId')
      .equals(projectId)
      .sortBy('createdAt');
    if (get().activeProjectId === projectId && version === notesLoadVersion) set({ notes: notes.reverse() });
  },

  createNote: async (projectId: string) => {
    const now = new Date();
    const note: Note = {
      id: uuidv4(),
      projectId,
      content: '',
      createdAt: now,
      updatedAt: now,
    };
    await db.notes.add(note);
    await get().loadNotes(projectId);
    await get().loadTotalCount();
    return note;
  },

  updateNote: async (id: string, content: string) => {
    const updatedAt = new Date();
    if (!await db.notes.update(id, { content, updatedAt })) throw new Error('这篇随笔已删除，正文未保存。');
    const { activeProjectId, notes } = get();
    if (activeProjectId) {
      set({
        notes: notes.map(n => n.id === id ? { ...n, content, updatedAt } : n),
      });
    }
    if (get().failedDrafts[id]?.content !== undefined) set(state => {
      const draft = { ...state.failedDrafts[id] };
      delete draft.content;
      return { failedDrafts: { ...state.failedDrafts, [id]: draft } };
    });
    clearRecoveredSaveError();
  },

  updateNoteTitle: async (id: string, title: string) => {
    const updatedAt = new Date();
    if (!await db.notes.update(id, { title, updatedAt })) throw new Error('这篇随笔已删除，标题未保存。');
    const { activeProjectId, notes } = get();
    if (activeProjectId) {
      set({
        notes: notes.map(n => n.id === id ? { ...n, title, updatedAt } : n),
      });
    }
    if (get().failedDrafts[id]?.title !== undefined) set(state => {
      const draft = { ...state.failedDrafts[id] };
      delete draft.title;
      return { failedDrafts: { ...state.failedDrafts, [id]: draft } };
    });
    clearRecoveredSaveError();
  },

  saveNoteAnalysis: async (id: string, translation: string, goldenSentences: GoldenSentence[], expectedContent?: string) => {
    const merged = await db.transaction('rw', db.notes, async () => {
      const current = await db.notes.get(id);
      if (!current) throw new Error('这篇随笔已删除，分析结果未保存。');
      if (expectedContent !== undefined && current.content !== expectedContent) throw new Error('正文已更新，本次旧版本分析未保存。请再次提炼。');
      const preservedManual = (current.goldenSentences ?? []).filter(gs => gs.source !== 'auto');
      const result = [...goldenSentences, ...preservedManual];
      await db.notes.update(id, { translation, goldenSentences: result });
      return result;
    });
    const { notes } = get();
    set({
      notes: notes.map(n => n.id === id ? { ...n, translation, goldenSentences: merged } : n),
    });
  },

  addManualGoldenSentence: async (noteId: string, gs: GoldenSentence) => {
    const updated = await updateSentences(noteId, existing => [...existing, { ...gs, source: 'manual' as const }]);
    set({ notes: get().notes.map(n => n.id === noteId ? { ...n, goldenSentences: updated } : n) });
  },

  removeGoldenSentence: async (noteId: string, gsId: string) => {
    const updated = await updateSentences(noteId, existing => existing.filter(gs => gs.id !== gsId));
    set({ notes: get().notes.map(n => n.id === noteId ? { ...n, goldenSentences: updated } : n) });
  },

  addVocabToGoldenSentence: async (noteId: string, gsId: string, vocab: import('../types').VocabItem) => {
    const updated = await updateSentences(noteId, existing => existing.map(gs =>
      gs.id === gsId ? { ...gs, vocabulary: gs.vocabulary.some(item => item.word.toLowerCase() === vocab.word.toLowerCase()) ? gs.vocabulary : [...gs.vocabulary, vocab] } : gs
    ));
    set({ notes: get().notes.map(n => n.id === noteId ? { ...n, goldenSentences: updated } : n) });
  },

  deleteNote: async (id: string) => {
    await db.notes.delete(id);
    const { activeNoteId, notes } = get();
    const newNotes = notes.filter(n => n.id !== id);
    set({ notes: newNotes, activeNoteId: activeNoteId === id ? null : activeNoteId });
    await get().loadTotalCount();
  },

  setActiveNote: (id: string | null) => {
    set({ activeNoteId: id });
  },

  getActiveNote: () => {
    const { notes, activeNoteId } = get();
    return notes.find(n => n.id === activeNoteId);
  },

  loadChatMessages: async (projectId: string) => {
    const version = ++chatLoadVersion;
    const msgs = await db.chatMessages
      .where('projectId')
      .equals(projectId)
      .sortBy('timestamp');
    if (get().activeProjectId === projectId && version === chatLoadVersion) set({ chatMessages: msgs });
  },

  addChatMessage: async (projectId: string, role: 'user' | 'agent', content: string) => {
    const msg: ChatMessage = {
      id: uuidv4(),
      projectId,
      role,
      content,
      timestamp: new Date(),
    };
    await db.transaction('rw', db.projects, db.chatMessages, async () => {
      if (!await db.projects.get(projectId)) throw new Error('这本日记集已删除，消息未保存。');
      await db.chatMessages.add(msg);
    });
    if (get().activeProjectId === projectId) await get().loadChatMessages(projectId);
  },

  clearChat: async (projectId: string) => {
    await db.chatMessages.where('projectId').equals(projectId).delete();
    if (get().activeProjectId === projectId) set({ chatMessages: [] });
  },

  setAnalyzing: (v: boolean) => set({ isAnalyzing: v }),

  loadTotalCount: async () => {
    const count = await db.notes.count();
    set({ totalNoteCount: count });
  },
}));
