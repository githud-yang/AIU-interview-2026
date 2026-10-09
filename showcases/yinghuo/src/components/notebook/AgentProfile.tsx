/** 画像展示与手动生成；打开页面、达到篇数或导入演示时均不自动请求 AI。 */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, RefreshCw } from 'lucide-react';
import { useNoteStore } from '../../stores/useNoteStore';
import { getAgentLevel, getLevelProgress, AGENT_LEVELS } from '../../types';
import ProgressBar from '../ui/ProgressBar';

interface Props {
  projectId: string;
}

const LEVEL_COLORS = [
  'var(--yh-ink-030)',
  'var(--yh-ink-050)',
  'var(--yh-ink-070)',
  'var(--yh-ink-090)',
  'var(--yh-accent)',
];

export default function AgentProfile({ projectId }: Props) {
  const { notes, projects, regenerateAgentProfile } = useNoteStore();
  const [regenerating, setRegenerating] = useState(false);
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const noteCount = notes.length;
  const currentLevel = getAgentLevel(noteCount);
  const progress = getLevelProgress(noteCount);
  const project = projects.find(p => p.id === projectId);
  const profile = project?.agentProfile;
  const quotes = profile?.representativeQuotes ?? [];

  // Rotate representative quotes
  useEffect(() => {
    if (quotes.length <= 1) return;
    const timer = setInterval(() => {
      setQuoteIndex(i => (i + 1) % quotes.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [quotes.length]);

  const handleRegenerate = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setRegenerating(true);
    setError('');
    try {
      await regenerateAgentProfile(projectId);
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : '画像生成失败，请重试。');
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setRegenerating(false);
    }
  };

  return (
    <div
      className="agent-profile shrink-0 px-5 py-4"
      style={{ borderBottom: '1px solid var(--yh-line-008)' }}
    >
      {/* Level Progress */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span
              style={{
                color: LEVEL_COLORS[currentLevel.level],
                fontSize: '0.9rem',
                fontFamily: 'Georgia, "Noto Serif SC", serif',
                letterSpacing: '0.1em',
                textShadow: currentLevel.level >= 3 ? `0 0 10px ${LEVEL_COLORS[currentLevel.level]}` : 'none',
              }}
            >
              {currentLevel.name}
            </span>
            <span style={{ color: 'var(--yh-ink-030)', fontSize: 'var(--yh-font-06)', fontStyle: 'italic' }}>
              · {currentLevel.description}
            </span>
          </div>
          <span style={{ color: 'var(--yh-ink-040)', fontSize: 'var(--yh-font-065)' }}>
            {noteCount} / {currentLevel.maxNotes === Infinity ? '∞' : currentLevel.maxNotes + 1}
          </span>
        </div>

        <ProgressBar percentage={progress.percentage} height={4} />

        <div className="flex justify-between mt-2">
          {AGENT_LEVELS.map(level => (
            <div
              key={level.level}
              className="agent-level-marker flex flex-col items-center"
              style={{ opacity: noteCount >= level.minNotes ? 1 : 0.25 }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full mb-1"
                style={{
                  background: noteCount >= level.minNotes ? LEVEL_COLORS[level.level] : 'var(--yh-tint-015)',
                  boxShadow: noteCount >= level.minNotes ? `0 0 4px ${LEVEL_COLORS[level.level]}` : 'none',
                }}
              />
              <span style={{ color: 'var(--yh-ink-040)', fontSize: 'var(--yh-font-05)', textAlign: 'center', width: 32 }}>
                {level.name.slice(0, 2)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Agent Card */}
      <AnimatePresence mode="wait">
        {noteCount >= 50 ? (
          <motion.div
            key="unlocked"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="rounded-xl p-4"
            style={{
              background: 'var(--yh-tint-004)',
              border: '1px solid var(--yh-line-015)',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <motion.div
                  className="ambient-glow w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: 'var(--yh-tint-010)', border: '1px solid var(--yh-line-025)' }}
                  animate={{ boxShadow: ['0 0 6px var(--yh-tint-030)', '0 0 14px var(--yh-tint-060)', '0 0 6px var(--yh-tint-030)'] }}
                  transition={{ duration: 2.5, repeat: Infinity }}
                >
                  <Flame size={16} style={{ color: 'var(--yh-accent)' }} />
                </motion.div>
                <div>
                  <div style={{ color: 'var(--yh-accent)', fontSize: 'var(--yh-font-085)', fontFamily: 'Georgia, serif', letterSpacing: '0.1em' }}>
                    {regenerating ? '觉醒中…' : (project?.agentName || '流萤')}
                  </div>
                  <div style={{ color: 'var(--yh-ink-040)', fontSize: 'var(--yh-font-06)' }}>
                    你的知己
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={regenerating}
                title="手动请求 DeepSeek 提炼知己画像"
                style={{
                  color: 'var(--yh-ink-035)',
                  background: 'transparent',
                  border: 'none',
                  cursor: regenerating ? 'not-allowed' : 'pointer',
                  padding: 4,
                }}
              >
                <RefreshCw
                  size={11}
                  style={{ animation: regenerating ? 'spin 1s linear infinite' : 'none' }}
                />
                <span style={{ marginLeft: 4, fontSize: 'var(--yh-font-065)' }}>{profile ? '更新画像' : '生成画像'}</span>
              </button>
            </div>

            {/* Traits */}
            {profile?.traits && profile.traits.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {profile.traits.map((trait, i) => (
                  <span
                    key={i}
                    style={{
                      background: 'var(--yh-tint-008)',
                      border: '1px solid var(--yh-line-018)',
                      borderRadius: 99,
                      padding: '1px 7px',
                      color: 'var(--yh-ink-070)',
                      fontSize: 'var(--yh-font-058)',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {trait}
                  </span>
                ))}
              </div>
            )}

            {/* Favorite themes */}
            {profile?.favoriteThemes && profile.favoriteThemes.length > 0 && (
              <div className="mb-3">
                <p style={{ color: 'var(--yh-ink-030)', fontSize: 'var(--yh-font-055)', letterSpacing: '0.1em', marginBottom: 4 }}>
                  偏爱主题
                </p>
                <p style={{ color: 'var(--yh-text-045)', fontSize: 'var(--yh-font-068)', lineHeight: 1.5 }}>
                  {profile.favoriteThemes.join(' · ')}
                </p>
              </div>
            )}

            {/* Representative quote rotator */}
            {quotes.length > 0 && (
              <div
                className="rounded-lg p-2.5 mb-3"
                style={{ background: 'var(--yh-tint-004)', border: '1px solid var(--yh-line-010)', minHeight: 44 }}
              >
                <p style={{ color: 'var(--yh-ink-025)', fontSize: 'var(--yh-font-052)', letterSpacing: '0.1em', marginBottom: 3 }}>
                  你的金句
                </p>
                <AnimatePresence mode="wait">
                  <motion.p
                    key={quoteIndex}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.5 }}
                    style={{
                      color: 'var(--yh-text-055)',
                      fontSize: 'var(--yh-font-068)',
                      fontStyle: 'italic',
                      lineHeight: 1.6,
                      fontFamily: 'Georgia, serif',
                    }}
                  >
                    "{quotes[quoteIndex % quotes.length]}"
                  </motion.p>
                </AnimatePresence>
              </div>
            )}

            {/* Summary */}
            {profile?.summary && (
              <p style={{ color: 'var(--yh-text-040)', fontSize: 'var(--yh-font-067)', lineHeight: 1.7, fontStyle: 'italic' }}>
                {profile.summary}
              </p>
            )}
            {!profile && !regenerating && project?.agentPersonality && (
              <p style={{ color: 'var(--yh-text-040)', fontSize: 'var(--yh-font-067)', lineHeight: 1.7, fontStyle: 'italic' }}>
                {project.agentPersonality.slice(0, 80)}…
              </p>
            )}
            {regenerating && (
              <p style={{ color: 'var(--yh-ink-030)', fontSize: 'var(--yh-font-067)', fontStyle: 'italic', lineHeight: 1.7 }}>
                正在从你的文字中提炼知己人格……
              </p>
            )}
            {!profile && !regenerating && <p style={{ color: 'var(--yh-hint)', fontSize: 'var(--yh-font-067)', lineHeight: 1.7 }}>画像尚未生成。主动点击“生成画像”后，相关随笔会发送给 DeepSeek。</p>}
            {error && <p role="alert" style={{ color: 'var(--yh-error)', fontSize: 'var(--yh-font-07)', lineHeight: 1.6 }}>{error}<button type="button" className="ml-2 underline" disabled={regenerating} onClick={() => void handleRegenerate()}>重试生成</button></p>}
          </motion.div>
        ) : (
          <motion.div
            key="locked"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-xl p-4 text-center"
            style={{ background: 'var(--yh-tint-002)', border: '1px dashed var(--yh-line-010)' }}
          >
            <Flame size={24} style={{ color: 'var(--yh-ink-015)', marginBottom: '0.4rem' }} />
            <p style={{ color: 'var(--yh-ink-025)', fontSize: 'var(--yh-font-07)', lineHeight: 1.7, fontStyle: 'italic' }}>
              再写 {50 - noteCount} 篇随笔<br />
              唤醒你的专属知己
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
