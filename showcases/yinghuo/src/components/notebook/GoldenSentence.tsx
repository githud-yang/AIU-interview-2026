/** 金句分析卡片与手动词汇补充；失败保留选择内容供重试。 */
import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, BookOpen, Layers, Tag, Loader2, X } from 'lucide-react';
import type { GoldenSentence as GoldenSentenceType } from '../../types';

interface Props {
  sentence: GoldenSentenceType;
  index: number;
  onAddVocab?: (gsId: string, word: string) => Promise<void>;
  onRemoveManual?: (gsId: string) => Promise<void>;
}

type Tab = 'vocab' | 'grammar' | 'scene';

const TAB_CONFIG: { id: Tab; label: string; icon: typeof BookOpen }[] = [
  { id: 'vocab', label: '词汇', icon: BookOpen },
  { id: 'grammar', label: '语法', icon: Layers },
  { id: 'scene', label: '场景', icon: Tag },
];

export default function GoldenSentenceCard({ sentence, index, onAddVocab, onRemoveManual }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('vocab');
  const [expanded, setExpanded] = useState(true);
  const isManual = sentence.source === 'manual';

  // Word selection state
  const [selectedWord, setSelectedWord] = useState('');
  const [wordPopupPos, setWordPopupPos] = useState<{ x: number; y: number } | null>(null);
  const [analyzingWord, setAnalyzingWord] = useState(false);
  const [wordDone, setWordDone] = useState(false);
  const originalRef = useRef<HTMLParagraphElement>(null);
  const [error, setError] = useState('');
  const [failedAction, setFailedAction] = useState<'word' | 'remove' | null>(null);

  const handleOriginalMouseUp = () => {
    if (!onAddVocab) return;
    const sel = window.getSelection();
    const word = sel?.toString().trim() ?? '';
    if (!word || word.length < 1) {
      setWordPopupPos(null);
      return;
    }
    // Position popup near the selection anchor
    const range = sel?.getRangeAt(0);
    const rect = range?.getBoundingClientRect();
    if (rect) {
      setSelectedWord(word);
      setWordPopupPos({ x: rect.left + rect.width / 2, y: rect.top - 8 });
    }
  };

  const handleAddVocab = async () => {
    if (!onAddVocab || !selectedWord || analyzingWord) return;
    setAnalyzingWord(true);
    setError('');
    setFailedAction(null);
    try {
      await onAddVocab(sentence.id, selectedWord);
      setWordDone(true);
      setActiveTab('vocab');
      setTimeout(() => {
        setWordDone(false);
        setWordPopupPos(null);
        setSelectedWord('');
      }, 1200);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '词汇解析失败，请重试。');
      setFailedAction('word');
    } finally {
      setAnalyzingWord(false);
    }
  };

  return (
    <>
      {/* Floating word popup — rendered in place, fixed position */}
      {wordPopupPos && onAddVocab && (
        <div
          style={{
            position: 'fixed',
            left: wordPopupPos.x,
            top: wordPopupPos.y,
            transform: 'translate(-50%, -100%)',
            zIndex: 9999,
            pointerEvents: 'auto',
          }}
        >
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={handleAddVocab}
            disabled={analyzingWord}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 11px',
              borderRadius: 99,
              background: wordDone ? 'rgba(212,175,55,0.25)' : 'rgba(10,10,26,0.97)',
              border: '1px solid rgba(212,175,55,0.45)',
              color: wordDone ? '#d4af37' : 'rgba(212,175,55,0.9)',
              fontSize: '0.68rem',
              letterSpacing: '0.06em',
              cursor: analyzingWord ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
              whiteSpace: 'nowrap',
            }}
          >
            {analyzingWord
              ? <Loader2 size={10} className="animate-spin" />
              : <span style={{ fontSize: '0.6rem' }}>✦</span>}
            {wordDone ? '已添加' : analyzingWord ? '解析中…' : `解释「${selectedWord}」`}
          </button>
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.12, duration: 0.5 }}
        className={`rounded-xl overflow-hidden mb-4 card-hover ${isManual ? 'manual-gs-card' : ''}`}
        style={{
          background: 'rgba(20,18,40,0.8)',
          border: '1px solid rgba(212,175,55,0.18)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(212,175,55,0.08)',
        }}
      >
        {isManual && (
          <motion.span
            aria-hidden
            className="manual-gs-orb"
            animate={{
              opacity: [0.45, 1, 0.45],
              scale: [1, 1.22, 1],
            }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        {/* Card Header */}
        <div
          className="px-4 py-3 cursor-pointer flex items-start justify-between gap-2"
          onClick={() => setExpanded(!expanded)}
          style={{ borderBottom: expanded ? '1px solid rgba(212,175,55,0.1)' : 'none' }}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span style={{
                color: 'rgba(212,175,55,0.5)', fontSize: '0.55rem',
                background: 'rgba(212,175,55,0.1)', padding: '1px 6px',
                borderRadius: 99, letterSpacing: '0.1em',
              }}>
                金句 {String(index + 1).padStart(2, '0')}
              </span>
              {onAddVocab && (
                <span style={{ color: 'rgba(212,175,55,0.25)', fontSize: '0.55rem', fontStyle: 'italic' }}>
                  框选原文可解释词语
                </span>
              )}
            </div>
            {sentence.original && (
              <p
                ref={originalRef}
                onMouseUp={e => { e.stopPropagation(); handleOriginalMouseUp(); }}
                onClick={e => e.stopPropagation()}
                style={{
                  color: 'rgba(232,220,200,0.6)',
                  fontSize: '0.75rem',
                  fontStyle: 'italic',
                  marginBottom: '0.35rem',
                  lineHeight: 1.6,
                  userSelect: 'text',
                  cursor: onAddVocab ? 'text' : 'default',
                }}
              >
                {sentence.original}
              </p>
            )}
            <p style={{ color: '#d4af37', fontSize: '0.82rem', lineHeight: 1.65, fontFamily: 'Georgia, serif' }}>
              "{sentence.english}"
            </p>
          </div>
          {isManual && onRemoveManual && (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                try { await onRemoveManual(sentence.id); }
                catch { setError('撤回标记失败，请重试。'); setFailedAction('remove'); }
              }}
              title="撤回这条手动标记"
              className="manual-gs-remove-btn"
              style={{
                marginTop: 2,
                marginRight: 2,
                border: '1px solid rgba(240,198,88,0.25)',
                background: 'rgba(18,16,34,0.78)',
                color: 'rgba(240,198,88,0.55)',
                borderRadius: 999,
                width: 20,
                height: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                opacity: 0,
                transition: 'opacity 0.2s, transform 0.2s, color 0.2s',
                flexShrink: 0,
              }}
            >
              <X size={11} />
            </button>
          )}
          <motion.div
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            style={{ color: 'rgba(212,175,55,0.4)', flexShrink: 0, marginTop: 4 }}
          >
            <ChevronDown size={14} />
          </motion.div>
        </div>

        {error && <p role="alert" className="px-4 py-2" style={{ color: '#f1a59d', fontSize: '0.7rem' }}>{error}
          <button type="button" className="ml-2 underline" disabled={analyzingWord} onClick={() => {
            if (failedAction === 'word') void handleAddVocab();
            else if (failedAction === 'remove' && onRemoveManual) void onRemoveManual(sentence.id).then(() => setError('')).catch(() => setError('撤回标记失败，请重试。'));
          }}>重试</button>
        </p>}

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {/* Tabs */}
              <div className="flex px-4 pt-3 gap-1">
                {TAB_CONFIG.map(tab => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs transition-all"
                      style={{
                        background: isActive ? 'rgba(212,175,55,0.15)' : 'transparent',
                        border: isActive ? '1px solid rgba(212,175,55,0.25)' : '1px solid transparent',
                        color: isActive ? '#d4af37' : 'rgba(212,175,55,0.4)',
                        fontSize: '0.72rem',
                        letterSpacing: '0.05em',
                        cursor: 'pointer',
                      }}
                    >
                      <Icon size={10} />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div className="px-4 py-3">
                <AnimatePresence mode="wait">
                  {activeTab === 'vocab' && (
                    <motion.div key="vocab" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                      {sentence.vocabulary.length === 0 ? (
                        <p style={{ color: 'rgba(212,175,55,0.25)', fontSize: '0.72rem', fontStyle: 'italic' }}>
                          框选原文中的词语即可添加解释
                        </p>
                      ) : (
                        sentence.vocabulary.map((vocab, i) => (
                          <div
                            key={i}
                            className="mb-3 pb-3 last:mb-0 last:pb-0"
                            style={{ borderBottom: i < sentence.vocabulary.length - 1 ? '1px solid rgba(212,175,55,0.08)' : 'none' }}
                          >
                            <div className="flex items-baseline gap-2 mb-1.5">
                              <span style={{ color: '#d4af37', fontSize: '0.9rem', fontFamily: 'Georgia, serif', fontWeight: 600 }}>
                                {vocab.word}
                              </span>
                              <span style={{ color: 'rgba(212,175,55,0.45)', fontSize: '0.65rem', fontStyle: 'italic' }}>
                                {vocab.partOfSpeech}
                              </span>
                              <span style={{ color: 'rgba(232,220,200,0.65)', fontSize: '0.72rem' }}>
                                {vocab.meaning}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {vocab.collocations.map((col, j) => (
                                <span
                                  key={j}
                                  style={{
                                    background: 'rgba(212,175,55,0.07)',
                                    border: '1px solid rgba(212,175,55,0.15)',
                                    borderRadius: 6,
                                    padding: '2px 8px',
                                    color: 'rgba(212,175,55,0.7)',
                                    fontSize: '0.68rem',
                                    fontFamily: 'Georgia, serif',
                                  }}
                                >
                                  {col}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                    </motion.div>
                  )}

                  {activeTab === 'grammar' && (
                    <motion.div key="grammar" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                      <div className="mb-3">
                        <p style={{ color: 'rgba(212,175,55,0.5)', fontSize: '0.65rem', letterSpacing: '0.1em', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
                          句式分析
                        </p>
                        <p style={{ color: 'rgba(232,220,200,0.7)', fontSize: '0.78rem', lineHeight: 1.75 }}>
                          {sentence.grammarAnalysis}
                        </p>
                      </div>
                      <div
                        className="rounded-lg p-3"
                        style={{ background: 'rgba(212,175,55,0.05)', border: '1px solid rgba(212,175,55,0.12)' }}
                      >
                        <p style={{ color: 'rgba(212,175,55,0.5)', fontSize: '0.63rem', letterSpacing: '0.1em', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
                          高级替换
                        </p>
                        <p style={{ color: '#c8a84a', fontSize: '0.8rem', fontFamily: 'Georgia, serif', lineHeight: 1.65, fontStyle: 'italic' }}>
                          "{sentence.advancedRewrite}"
                        </p>
                      </div>
                    </motion.div>
                  )}

                  {activeTab === 'scene' && (
                    <motion.div key="scene" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                      <p style={{ color: 'rgba(212,175,55,0.5)', fontSize: '0.65rem', letterSpacing: '0.1em', marginBottom: '0.75rem', textTransform: 'uppercase' }}>
                        适用场景
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {sentence.scenarios.map((scene, i) => (
                          <span
                            key={i}
                            className="flex items-center gap-1"
                            style={{
                              background: 'rgba(212,175,55,0.08)',
                              border: '1px solid rgba(212,175,55,0.2)',
                              borderRadius: 8,
                              padding: '4px 10px',
                              color: 'rgba(212,175,55,0.85)',
                              fontSize: '0.72rem',
                            }}
                          >
                            <span style={{ color: 'rgba(212,175,55,0.4)', fontSize: '0.6rem' }}>✦</span>
                            {scene}
                          </span>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </>
  );
}
