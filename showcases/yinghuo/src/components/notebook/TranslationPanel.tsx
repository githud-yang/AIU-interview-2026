/** 当前随笔译文和金句展示；手动词汇分析及撤回交由服务和存储完成。 */
import { useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Languages, Sparkles, Loader2, Flame } from 'lucide-react';
import { useNoteStore } from '../../stores/useNoteStore';
import GoldenSentenceCard from './GoldenSentence';
import { analyzeWord } from '../../services/aiService';

export default function TranslationPanel() {
  const { notes, activeNoteId, isAnalyzing, addVocabToGoldenSentence, removeGoldenSentence } = useNoteStore();
  const activeNote = notes.find(n => n.id === activeNoteId);

  const handleAddVocab = useCallback(async (gsId: string, word: string) => {
    if (!activeNoteId) return;
    const vocab = await analyzeWord(word);
    await addVocabToGoldenSentence(activeNoteId, gsId, vocab);
  }, [activeNoteId, addVocabToGoldenSentence]);

  const handleRemoveManual = useCallback(async (gsId: string) => {
    if (!activeNoteId) return;
    await removeGoldenSentence(activeNoteId, gsId);
  }, [activeNoteId, removeGoldenSentence]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Section: Translation */}
      <div
        className="shrink-0 px-5 py-4"
        style={{ borderBottom: '1px solid rgba(212,175,55,0.08)' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Languages size={13} style={{ color: 'rgba(212,175,55,0.5)' }} />
          <span style={{ color: 'rgba(212,175,55,0.5)', fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
            英文译文
          </span>
        </div>

        <AnimatePresence mode="wait">
          {isAnalyzing ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2 py-2"
            >
              <Loader2 size={14} className="animate-spin" style={{ color: 'rgba(212,175,55,0.4)' }} />
              <span style={{ color: 'rgba(212,175,55,0.4)', fontSize: '0.75rem', fontStyle: 'italic' }}>
                正在提炼…
              </span>
            </motion.div>
          ) : activeNote?.translation ? (
            <motion.p
              key="translation"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                color: 'rgba(232,220,200,0.75)',
                fontSize: '0.82rem',
                lineHeight: 1.8,
                fontFamily: 'Georgia, serif',
                fontStyle: 'italic',
              }}
            >
              {activeNote.translation}
            </motion.p>
          ) : (
            <motion.p
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{ color: 'rgba(212,175,55,0.2)', fontSize: '0.75rem', fontStyle: 'italic' }}
            >
              点击「提炼金句」生成译文
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Section: Golden Sentences */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={13} style={{ color: 'rgba(212,175,55,0.5)' }} />
          <span style={{ color: 'rgba(212,175,55,0.5)', fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
            金句提炼
          </span>
          {activeNote?.goldenSentences && activeNote.goldenSentences.length > 0 && (
            <span style={{
              background: 'rgba(212,175,55,0.1)',
              border: '1px solid rgba(212,175,55,0.2)',
              borderRadius: 99,
              padding: '0 6px',
              color: 'rgba(212,175,55,0.6)',
              fontSize: '0.6rem',
            }}>
              {activeNote.goldenSentences.length}
            </span>
          )}
        </div>

        <AnimatePresence mode="wait">
          {isAnalyzing ? (
            <motion.div
              key="loading-gs"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-3"
            >
              {[0, 1].map(i => (
                <div key={i} className="h-24 rounded-xl animate-pulse"
                  style={{ background: 'rgba(212,175,55,0.05)', border: '1px solid rgba(212,175,55,0.08)' }} />
              ))}
            </motion.div>
          ) : activeNote?.goldenSentences && activeNote.goldenSentences.length > 0 ? (
            <motion.div key="sentences" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {activeNote.goldenSentences.map((gs, i) => (
                <GoldenSentenceCard
                  key={gs.id}
                  sentence={gs}
                  index={i}
                  onAddVocab={handleAddVocab}
                  onRemoveManual={handleRemoveManual}
                />
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="empty-gs"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center py-12 text-center"
            >
              <Flame size={28} style={{ color: 'rgba(212,175,55,0.2)', marginBottom: '0.75rem' }} />
              <p style={{ color: 'rgba(212,175,55,0.25)', fontSize: '0.78rem', lineHeight: 1.8, fontStyle: 'italic' }}>
                写下你的随笔，<br />点击「提炼金句」<br />开始多维度英语分析
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
