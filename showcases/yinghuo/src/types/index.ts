/** 定义前端随笔、词汇、对话和知己资料的数据类型。 */
export interface AgentProfile {
  traits: string[];
  tone: string;
  favoriteThemes: string[];
  representativeQuotes: string[];
  summary: string;
}

export interface NoteProject {
  id: string;
  name: string;
  createdAt: Date;
  agentName?: string;
  agentPersonality?: string;
  agentAvatar?: string;
  agentProfile?: AgentProfile;
}

export interface Note {
  id: string;
  projectId: string;
  title?: string;
  content: string;
  translation?: string;
  goldenSentences?: GoldenSentence[];
  createdAt: Date;
  updatedAt: Date;
}

export interface GoldenSentence {
  id: string;
  noteId: string;
  source?: 'auto' | 'manual';
  original: string;
  english: string;
  vocabulary: VocabItem[];
  grammarAnalysis: string;
  advancedRewrite: string;
  scenarios: string[];
}

export interface VocabItem {
  word: string;
  partOfSpeech: string;
  meaning: string;
  collocations: string[];
}

/** 本地词汇知识库（IndexedDB）—— 手写预置、高考3500、AI 缓存 */
export type VocabKnowledgeSource = 'preset' | 'gaokao3500' | 'cached';

export interface VocabKnowledgeRow {
  wordKey: string;
  word: string;
  partOfSpeech: string;
  meaning: string;
  collocations: string[];
  source: VocabKnowledgeSource;
  updatedAt: Date;
}

export interface ChatMessage {
  id: string;
  projectId: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: Date;
}

export type AgentLevel = {
  level: number;
  name: string;
  description: string;
  minNotes: number;
  maxNotes: number;
  unlocks: string;
};

export const AGENT_LEVELS: AgentLevel[] = [
  { level: 0, name: '初遇', description: '萤火微光', minNotes: 0, maxNotes: 49, unlocks: '基础翻译与金句分析' },
  { level: 1, name: '相识', description: '光芒渐明', minNotes: 50, maxNotes: 99, unlocks: '解锁 AI 知己基础对话' },
  { level: 2, name: '知交', description: '心有灵犀', minNotes: 100, maxNotes: 199, unlocks: '知己能引用你的金句' },
  { level: 3, name: '莫逆', description: '灵魂共鸣', minNotes: 200, maxNotes: 299, unlocks: '知己形成独特人格' },
  { level: 4, name: '伯牙子期', description: '高山流水遇知音', minNotes: 300, maxNotes: Infinity, unlocks: '最高境界，永世知己' },
];

export function getAgentLevel(noteCount: number): AgentLevel {
  for (let i = AGENT_LEVELS.length - 1; i >= 0; i--) {
    if (noteCount >= AGENT_LEVELS[i].minNotes) {
      return AGENT_LEVELS[i];
    }
  }
  return AGENT_LEVELS[0];
}

export function getLevelProgress(noteCount: number): { current: number; total: number; percentage: number } {
  const level = getAgentLevel(noteCount);
  if (level.maxNotes === Infinity) {
    return { current: noteCount, total: noteCount, percentage: 100 };
  }
  const rangeSize = level.maxNotes - level.minNotes + 1;
  const progress = noteCount - level.minNotes;
  return {
    current: progress,
    total: rangeSize,
    percentage: Math.min(100, (progress / rangeSize) * 100),
  };
}
