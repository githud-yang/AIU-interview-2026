/** 创建独立的虚构演示日记集；重复导入保留已有内容，不调用 AI。 */
import { db } from '../db/database';
import type { Note, NoteProject } from '../types';

export const DEMO_PROJECT_ID = 'yinghuo-demo-fictional-v1';
export const DEMO_LABEL = '演示日记集（虚构）';

const scenes = [
  ['窗边的清晨', '今天的虚构主人公小禾在窗边读书。阳光落在纸上，缓慢的一页也值得认真对待。', 'This morning, Xiaohe, our fictional character, reads by the window. Sunlight rests on the page; even a slowly turned page deserves care.', '缓慢的一页也值得认真对待。', 'Even a slowly turned page deserves care.'],
  ['雨后的散步', '雨停后，小禾沿着熟悉的街道散步。路边的树叶很亮，普通的一天也藏着新的发现。', 'After the rain, Xiaohe walks along a familiar street. The leaves shine, and an ordinary day holds new discoveries.', '普通的一天也藏着新的发现。', 'An ordinary day holds new discoveries.'],
  ['练习与耐心', '小禾练习了一段英文表达，第一次并不顺利。把问题拆小一点，明天就能多迈一步。', 'Xiaohe practises an English expression, and the first attempt is difficult. Breaking a problem into smaller steps makes tomorrow a little easier.', '把问题拆小一点，明天就能多迈一步。', 'Breaking a problem into smaller steps makes tomorrow a little easier.'],
  ['朋友的来信', '小禾收到一封虚构朋友的来信。认真倾听之后才发现，一句简单的问候也能成为力量。', 'Xiaohe receives a letter from a fictional friend. By listening carefully, Xiaohe discovers that a simple greeting can offer strength.', '一句简单的问候也能成为力量。', 'A simple greeting can offer strength.'],
  ['傍晚的灯', '傍晚，小禾把今天的事情记下来。记录是为了记住真实的感受。', 'At dusk, Xiaohe writes about the day. Keeping a journal is a way to remember feelings.', '记录是为了记住真实的感受。', 'Keeping a journal is a way to remember feelings.'],
] as const;

export function createDemoRecords(): { project: NoteProject; notes: Note[] } {
  const project: NoteProject = {
    id: DEMO_PROJECT_ID,
    name: DEMO_LABEL,
    createdAt: new Date('2026-01-01T09:00:00+08:00'),
    agentName: '流萤 · 示例',
    agentPersonality: '预先编写的虚构示例画像，用于演示界面，并非真实 AI 分析或模型训练结果。',
    agentProfile: {
      traits: ['示例 · 温和', '示例 · 好奇', '示例 · 耐心'],
      tone: '示例语气：温和、简洁',
      favoriteThemes: ['阅读', '散步', '学习'],
      representativeQuotes: ['普通的一天也藏着新的发现。', '一句简单的问候也能成为力量。'],
      summary: '这是预先编写的演示画像，来源为虚构随笔，未调用 AI。真实画像需要主动点击生成。',
    },
  };
  const notes = Array.from({ length: 50 }, (_, index): Note => {
    const [title, text, translation, original, english] = scenes[index % scenes.length];
    const id = `${DEMO_PROJECT_ID}-note-${String(index + 1).padStart(2, '0')}`;
    const date = new Date(Date.UTC(2026, 0, index + 1, 1));
    const vocabulary = [
      { word: 'care', partOfSpeech: 'n.', meaning: '用心；关怀（演示词条）', collocations: ['with care', 'deserve care'] },
      { word: 'ordinary', partOfSpeech: 'adj.', meaning: '普通的（演示词条）', collocations: ['an ordinary day', 'ordinary life'] },
      { word: 'steps', partOfSpeech: 'n.', meaning: '步骤（演示词条）', collocations: ['smaller steps', 'take steps'] },
      { word: 'greeting', partOfSpeech: 'n.', meaning: '问候（演示词条）', collocations: ['a simple greeting', 'a warm greeting'] },
      { word: 'journal', partOfSpeech: 'n.', meaning: '日记（演示词条）', collocations: ['keep a journal', 'a personal journal'] },
    ][index % scenes.length];
    return {
      id,
      projectId: DEMO_PROJECT_ID,
      title: `虚构示例 ${String(index + 1).padStart(2, '0')} · ${title}`,
      content: `<p>【虚构演示随笔 ${index + 1} / 50，非个人记录】</p><p>${text}</p>`,
      translation: `[预先编写的示例译文，未调用 AI] ${translation}`,
      goldenSentences: [{
        id: `${id}-golden`, noteId: id, source: 'auto', original, english,
        vocabulary: [vocabulary],
        grammarAnalysis: '预先编写的语法示例：观察主语和谓语的搭配，再比较中文表达。此处用于展示分析卡片。',
        advancedRewrite: 'Small moments can become meaningful when we pay attention to them.',
        scenarios: ['示例 · 日常随笔', '示例 · 英语学习'],
      }],
      createdAt: date, updatedAt: date,
    };
  });
  return { project, notes };
}

export async function importDemoCollection(): Promise<string> {
  const { project, notes } = createDemoRecords();
  await db.transaction('rw', db.projects, db.notes, async () => {
    const existingProject = await db.projects.get(project.id);
    if (!existingProject) await db.projects.add(project);
    const existingIds = new Set(await db.notes.where('projectId').equals(project.id).primaryKeys());
    const missingNotes = notes.filter(note => !existingIds.has(note.id));
    if (missingNotes.length) await db.notes.bulkAdd(missingNotes);
  });
  return project.id;
}
