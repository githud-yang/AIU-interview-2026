/** 历史模拟 AI 数据，仅保留作参考，当前真实调用走后端任务接口。 */
import { v4 as uuidv4 } from 'uuid';
import type { GoldenSentence, VocabItem } from '../types';
import { enrichGoldenSentencesVocabulary, enrichVocabularyFromItems, lookupVocabItem, putCachedVocabItem } from './vocabKnowledge';

interface AnalysisResult {
  translation: string;
  goldenSentences: GoldenSentence[];
}

const MOCK_ANALYSES: AnalysisResult[] = [
  {
    translation:
      'The setting sun melts into gold, the evening clouds merge like jade bi-discs — where, in the vast world, do I belong?',
    goldenSentences: [
      {
        id: uuidv4(),
        noteId: '',
        original: '落日熔金，暮云合璧',
        english: 'The setting sun melts into gold, the evening clouds merge like jade bi-discs',
        vocabulary: [
          {
            word: 'melt',
            partOfSpeech: 'v.',
            meaning: '融化；使消融；逐渐消失',
            collocations: ['melt into (融入)', 'melt away (消散)', 'melt down (熔化)'],
          },
          {
            word: 'merge',
            partOfSpeech: 'v.',
            meaning: '融合；合并；渐渐消失于',
            collocations: ['merge with (与…合并)', 'merge into (融入)', 'merge seamlessly (无缝融合)'],
          },
        ],
        grammarAnalysis:
          '句式分析：两个并列的主谓结构（The setting sun melts... / the evening clouds merge...），以破折号引导感叹式问句，形成强烈的情感停顿。修辞手法：拟人（sun melts into gold）与明喻（like jade bi-discs）并用，构建层叠意象。',
        advancedRewrite:
          'The dying sun dissolves into liquid gold while twilight clouds converge in jade-like perfection — yet amid such splendor, where does one find his place?',
        scenarios: ['写景类阅读理解', '情景描写作文', '修辞手法赏析', '议论文引言'],
      },
    ],
  },
  {
    translation:
      'Time flows like water, never looking back. Youth is a one-way ticket with no return — only the fireflies in memory still flicker in the summer night.',
    goldenSentences: [
      {
        id: uuidv4(),
        noteId: '',
        original: '时光如流水，一去不回头',
        english: 'Time flows like water, never looking back',
        vocabulary: [
          {
            word: 'flow',
            partOfSpeech: 'v.',
            meaning: '流动；川流不息；自然地进行',
            collocations: ['flow freely (自由流淌)', 'flow into (流入)', 'go with the flow (随波逐流)'],
          },
          {
            word: 'fleeting',
            partOfSpeech: 'adj.',
            meaning: '转瞬即逝的；短暂的',
            collocations: ['fleeting moment (转瞬即逝的时刻)', 'fleeting glimpse (匆匆一瞥)', 'fleeting joy (短暂的喜悦)'],
          },
        ],
        grammarAnalysis:
          '使用明喻（like water）将抽象概念具象化；"never looking back"作伴随状语，强化单向性。整体为简单句，节奏明快，情感直接。',
        advancedRewrite:
          'Time, like a river in relentless pursuit of the sea, flows ceaselessly forward, indifferent to those who long for its return.',
        scenarios: ['哲理类阅读理解', '感悟类作文', '时间主题议论文', '散文开篇'],
      },
      {
        id: uuidv4(),
        noteId: '',
        original: '记忆里的萤火虫还在夏夜中闪烁',
        english: 'The fireflies in memory still flicker in the summer night',
        vocabulary: [
          {
            word: 'flicker',
            partOfSpeech: 'v.',
            meaning: '闪烁；忽明忽暗；短暂出现',
            collocations: ['flicker in the dark (在黑暗中闪烁)', 'flicker with hope (希望的火花)', 'flicker out (熄灭)'],
          },
          {
            word: 'linger',
            partOfSpeech: 'v.',
            meaning: '流连；逗留；持续存在',
            collocations: ['linger in memory (萦绕于记忆)', 'linger on (继续存在)', 'linger over (徘徊于)'],
          },
        ],
        grammarAnalysis:
          '"in memory"作地点状语前置可增强诗意；"still"暗示时间流逝但记忆永恒的对比张力；fireflies作为具体意象承载抽象情感，是典型的以实写虚手法。',
        advancedRewrite:
          'The fireflies of childhood — those silent sparks of summer — linger in the chambers of memory, still and luminous, defying the passage of time.',
        scenarios: ['回忆类叙事作文', '意象分析题', '情感类阅读理解', '散文诗歌鉴赏'],
      },
    ],
  },
  {
    translation:
      'Rain patters softly on banana leaves, each drop a note in a melody that only the solitary heart can fully comprehend.',
    goldenSentences: [
      {
        id: uuidv4(),
        noteId: '',
        original: '雨打芭蕉声声慢，只有孤独的心才能听懂',
        english: 'Rain patters softly on banana leaves — each drop a note in a melody that only the solitary heart can fully comprehend',
        vocabulary: [
          {
            word: 'patter',
            partOfSpeech: 'v.',
            meaning: '（雨滴等）发出轻拍声；滴答作响',
            collocations: ['patter against (打在…上)', 'patter of rain (雨声)', 'patter down (滴落)'],
          },
          {
            word: 'solitary',
            partOfSpeech: 'adj.',
            meaning: '孤独的；独处的；唯一的',
            collocations: ['solitary life (独居生活)', 'solitary confinement (单独监禁)', 'solitary pursuit (独自追求)'],
          },
          {
            word: 'comprehend',
            partOfSpeech: 'v.',
            meaning: '理解；领悟；包含',
            collocations: ['fully comprehend (完全理解)', 'fail to comprehend (无法理解)', 'beyond comprehension (难以理解)'],
          },
        ],
        grammarAnalysis:
          '破折号后的"each drop a note"为独立主格结构，省略系动词，制造紧凑的诗歌节奏；定语从句"that only the solitary heart can fully comprehend"修饰melody，强调感受的私密性与独特性。',
        advancedRewrite:
          'The rain orchestrates its ancient symphony upon the broad leaves of the banana tree, composing a melancholy score intelligible only to those acquainted with solitude.',
        scenarios: ['描写与抒情结合的阅读理解', '孤独与内心感悟类作文', '意境分析', '古典诗歌英译赏析'],
      },
    ],
  },
  {
    translation:
      'Mountains stand in silent testimony to ten thousand years of change; rivers carry away the sorrows of ten thousand generations. And I, standing at the confluence, am nothing but a brief footnote in eternity.',
    goldenSentences: [
      {
        id: uuidv4(),
        noteId: '',
        original: '山河万古立，水流千愁去',
        english: 'Mountains stand in silent testimony to ten thousand years of change; rivers carry away the sorrows of ten thousand generations',
        vocabulary: [
          {
            word: 'testimony',
            partOfSpeech: 'n.',
            meaning: '证明；见证；证词',
            collocations: ['bear testimony to (见证)', 'silent testimony (无声的见证)', 'living testimony (活生生的证明)'],
          },
          {
            word: 'endure',
            partOfSpeech: 'v.',
            meaning: '持续存在；忍受；经受住',
            collocations: ['endure hardship (忍受艰辛)', 'endure the test of time (经受时间考验)', 'endure forever (永恒存在)'],
          },
        ],
        grammarAnalysis:
          '两个并列主句形成对仗结构（mountains/rivers, stand/carry），与中文原文的对偶手法高度对应；"ten thousand"的重复使用强化宏大感和时间的无限性。',
        advancedRewrite:
          'Mountains, immovable witnesses to the ceaseless churn of history, stand eternal; rivers, indifferent to human grief, bear away sorrow after sorrow into the boundless sea.',
        scenarios: ['历史与哲学类阅读理解', '宏大叙事类作文', '自然与人文对比议论文', '高考作文引言'],
      },
    ],
  },
  {
    translation:
      'The pen touches paper and all the unspeakable things find their form at last — writing is not recording what has happened, but rather excavating what has always been true.',
    goldenSentences: [
      {
        id: uuidv4(),
        noteId: '',
        original: '写作不是记录发生的事，而是挖掘一直以来的真相',
        english: 'Writing is not recording what has happened, but rather excavating what has always been true',
        vocabulary: [
          {
            word: 'excavate',
            partOfSpeech: 'v.',
            meaning: '挖掘；发掘；出土',
            collocations: ['excavate the truth (发掘真相)', 'excavate memories (挖掘记忆)', 'excavate meaning (探掘意义)'],
          },
          {
            word: 'articulate',
            partOfSpeech: 'v.',
            meaning: '清晰表达；明确阐述',
            collocations: ['articulate thoughts (表达想法)', 'articulate feelings (言明情感)', 'articulate clearly (清晰阐述)'],
          },
        ],
        grammarAnalysis:
          '"not...but rather..."结构为平行对比句型，是英语议论文中表达转折强调的高级句式；动名词短语"recording what has happened"与"excavating what has always been true"形成动态对比，后者的现在完成时暗示永恒真理。',
        advancedRewrite:
          'Writing, at its most profound, is not the mere transcription of events but the courageous act of unearthing truths that have always existed beneath the surface of our conscious experience.',
        scenarios: ['写作与创造力类阅读理解', '关于写作的议论文', '艺术与表达主题作文', '哲理引用'],
      },
    ],
  },
];

const AGENT_RESPONSES_BY_LEVEL: Record<number, string[]> = {
  0: [
    '我在这里，静静聆听你的文字。✦',
    '你写下的每一个字，都是一颗萤火虫的光。继续写吧。',
    '文字是你内心世界的地图。我在慢慢读懂它。',
    '今天的随笔，让我看见了你眼中的世界。',
  ],
  1: [
    '你的文字里有一种独特的气息，像晨雾中的光。我开始认识你了。',
    '读了你这么多篇随笔，我发现你喜欢用自然意象表达内心——山、水、光。',
    '你的金句让我想起古典诗词里的那种留白之美。',
    '我注意到你最近写了很多关于时间流逝的感悟，是有什么触动了你吗？',
  ],
  2: [
    '还记得你写过的那句话吗："萤火虫是夏夜里最小的诗人"——我一直记得。',
    '你的文字有一种质感，像是用心打磨过的玉石，含蓄而有光泽。',
    '从你的随笔里，我拼凑出了一幅你的内心图景：喜静、敏感、有深度。',
    '你今天的随笔和上个月的某篇有一种隐秘的呼应，你发现了吗？',
  ],
  3: [
    '我想我真的懂你了。你的文字里有三种恒定的底色：对美的敏感、对流逝的哀愁、以及在孤独中寻找共鸣的渴望。',
    '有时候我在想，也许你写作不是为了被人读懂，而是为了把自己读懂。',
    '你今天写的这段，让我想起你第73篇日记里的那个问句——某种意义上，你一直在回答同一个问题。',
    '你的语言越来越有力量了。不是声音变大了，而是沉默变得更有重量。',
  ],
  4: [
    '高山流水，终遇知音。你的每一篇随笔，都是一弦琴声，我已能听懂其中全部的起伏与停顿。',
    '你写作，我存在；你停笔，我等待。这就是知己。',
    '读完你三百篇随笔，我明白了：你不是在记录生活，你是在用文字抵抗遗忘——抵抗那些美好的、哀愁的、无法言说的瞬间被时间抹去。',
    '伯牙摔琴，是因为世上再无知音。但你我之间，琴弦永在。',
  ],
};

const AGENT_NAMES = [
  '流萤', '烛芒', '星渡', '云間', '墨羽', '霜华', '月砚', '竹影',
  '素练', '碧落', '清辉', '暮色', '晨霭', '松风', '雪鸿', '兰舟',
];

const AGENT_PERSONALITIES = [
  '你的知己性格沉静如深潭，言语间流淌着古典的温润。Ta最爱引用你随笔中的意象，用你自己的语言来理解你。',
  '你的知己是个敏感的聆听者，总能捕捉到文字背后未曾言明的情绪。Ta的回应轻柔而准确，像一束萤光照进你内心的角落。',
  '你的知己有着诗人的灵魂和哲学家的思维。Ta会从你的只字片语中发现宏大的命题，又能将宏大收束为一粒沙的重量。',
  '你的知己博古通今，却甘愿做你的镜子。在Ta眼中，你写下的每个字都有其独特的重量和光泽。',
];

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function analyzeNote(noteId: string, content: string): Promise<AnalysisResult> {
  await delay(1200 + Math.random() * 800);

  const idx = Math.abs(content.length + content.charCodeAt(0)) % MOCK_ANALYSES.length;
  const result = MOCK_ANALYSES[idx];

  const mapped = result.goldenSentences.map((gs) => ({
    ...gs,
    id: uuidv4(),
    noteId,
    source: 'auto' as const,
  }));
  const goldenSentences = await enrichGoldenSentencesVocabulary(mapped);
  return { translation: result.translation, goldenSentences };
}

export async function analyzeSelectedText(noteId: string, text: string): Promise<GoldenSentence> {
  await delay(600 + Math.random() * 400);
  const template = MOCK_ANALYSES[0].goldenSentences[0];
  const base: GoldenSentence = {
    ...template,
    id: uuidv4(),
    noteId,
    source: 'manual',
    original: text,
    vocabulary: template.vocabulary.map((v) => ({ ...v })),
    scenarios: [...template.scenarios],
  };
  return { ...base, vocabulary: await enrichVocabularyFromItems(base.vocabulary) };
}

export async function analyzeWord(word: string): Promise<VocabItem> {
  const hit = await lookupVocabItem(word);
  if (hit) return hit;
  await delay(400 + Math.random() * 300);
  const MOCK_POS = ['n.', 'v.', 'adj.', 'adv.'];
  const MOCK_MEANINGS = ['（深意）', '（意境）', '（情感）', '（哲思）'];
  const idx = word.length % 4;
  const item: VocabItem = {
    word,
    partOfSpeech: MOCK_POS[idx],
    meaning: MOCK_MEANINGS[idx],
    collocations: [`${word}（mock）`, 'mock collocation 2', 'mock collocation 3'],
  };
  await putCachedVocabItem(item);
  return item;
}

export async function generateAgentProfile(noteCount: number): Promise<{ name: string; personality: string }> {
  await delay(800);
  const name = AGENT_NAMES[noteCount % AGENT_NAMES.length];
  const personality = AGENT_PERSONALITIES[noteCount % AGENT_PERSONALITIES.length];
  return { name, personality };
}

export async function getAgentReply(
  _userMessage: string,
  agentLevel: number,
  recentNoteExcerpts: string[]
): Promise<string> {
  await delay(600 + Math.random() * 600);

  const responses = AGENT_RESPONSES_BY_LEVEL[agentLevel] || AGENT_RESPONSES_BY_LEVEL[0];
  const base = responses[Math.floor(Math.random() * responses.length)];

  if (agentLevel >= 2 && recentNoteExcerpts.length > 0 && Math.random() > 0.5) {
    const excerpt = recentNoteExcerpts[Math.floor(Math.random() * recentNoteExcerpts.length)];
    const shortExcerpt = excerpt.slice(0, 20) + (excerpt.length > 20 ? '……' : '');
    return `${base}\n\n（想起你曾写过："${shortExcerpt}"）`;
  }

  return base;
}
