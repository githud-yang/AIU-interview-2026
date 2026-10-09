/** 随笔编辑与手动 AI 操作；切换前提交待保存内容，失败保留重试入口。 */
import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Loader2, PenLine, Flame, Wind, Vibrate, VibrateOff } from 'lucide-react';
import { useNoteStore } from '../../stores/useNoteStore';
import { analyzeNote, analyzeSelectedText } from '../../services/aiService';

function getChineseDateString(now: Date): string {
  const CN_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const WEEK_DAYS = ['日', '一', '二', '三', '四', '五', '六'];

  const toChineseNum = (n: number): string => {
    return String(n).split('').map(d => CN_DIGITS[parseInt(d)]).join('');
  };

  const year = toChineseNum(now.getFullYear());
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const weekDay = WEEK_DAYS[now.getDay()];
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');

  return `${year}年${month}月${day}日 · 星期${weekDay} · ${hours}:${minutes}:${seconds}`;
}

/** 方盒呼吸：0 上鼻吸 → 1 右屏息 → 2 下鼻呼 → 3 左屏息 */
const MEDITATION_EDGE_LABELS = ['鼻吸', '屏息', '鼻呼', '屏息'] as const;

const dimEdge = 'var(--yh-meditation-dim)';
const brightEdge = 'var(--yh-meditation-bright)';

export default function NoteEditor() {
  const { activeNoteId, notes, failedDrafts, updateNote, updateNoteTitle, saveNoteAnalysis, setAnalyzing, isAnalyzing, addManualGoldenSentence } = useNoteStore();
  const savedNote = notes.find(n => n.id === activeNoteId);
  const failedDraft = savedNote ? failedDrafts[savedNote.id] : undefined;
  const activeNote = useMemo(() => savedNote ? { ...savedNote, ...failedDraft } : undefined, [savedNote, failedDraft]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');
  const [title, setTitle] = useState(() => activeNote?.title ?? '');
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContentRef = useRef<{ id: string; html: string } | null>(null);
  const pendingTitleRef = useRef<{ id: string; title: string } | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const savingCountRef = useRef(0);
  const [saveError, setSaveError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [retryAction, setRetryAction] = useState<'analyze' | 'mark' | null>(null);
  const selectedForRetryRef = useRef<{ id: string; text: string } | null>(null);
  const mountedRef = useRef(true);

  const flushPending = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    const content = pendingContentRef.current;
    const pendingTitle = pendingTitleRef.current;
    pendingContentRef.current = null;
    pendingTitleRef.current = null;
    if (!content && !pendingTitle) return saveChainRef.current;
    savingCountRef.current++;
    const task = saveChainRef.current.catch(() => undefined).then(async () => {
      try {
        if (content) await updateNote(content.id, content.html);
        if (pendingTitle) await updateNoteTitle(pendingTitle.id, pendingTitle.title);
        if (mountedRef.current) setSaveError('');
      } catch (reason) {
        // Keep the latest unsaved edit available for retry rather than rolling back the editor.
        if (content && !pendingContentRef.current) pendingContentRef.current = content;
        if (pendingTitle && !pendingTitleRef.current) pendingTitleRef.current = pendingTitle;
        if (content) useNoteStore.getState().rememberFailedDraft(content.id, { content: pendingContentRef.current?.html ?? content.html });
        if (pendingTitle) useNoteStore.getState().rememberFailedDraft(pendingTitle.id, { title: pendingTitleRef.current?.title ?? pendingTitle.title });
        useNoteStore.setState({ storageError: '部分修改尚未保存，已暂存在当前页面。请重试保存后再关闭页面。' });
        if (mountedRef.current) setSaveError(reason instanceof Error ? reason.message : '本地保存失败，请重试。');
        throw reason;
      }
    }).finally(() => { savingCountRef.current--; });
    saveChainRef.current = task;
    return task;
  }, [updateNote, updateNoteTitle]);

  useEffect(() => {
    mountedRef.current = true;
    useNoteStore.setState({ flushActiveEdits: flushPending });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pendingContentRef.current || pendingTitleRef.current || savingCountRef.current > 0) { event.preventDefault(); event.returnValue = ''; }
    };
    const hide = () => { if (document.visibilityState === 'hidden') void flushPending().catch(() => undefined); };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', hide);
    return () => {
      mountedRef.current = false;
      if (useNoteStore.getState().flushActiveEdits === flushPending) useNoteStore.setState({ flushActiveEdits: null });
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('visibilitychange', hide);
      void flushPending().catch(() => {
        useNoteStore.setState({ storageError: '上一篇随笔的本地保存失败。请保持页面打开，检查浏览器存储权限。' });
      });
    };
  }, [flushPending]);

  const handleTitleChange = (v: string) => {
    setTitle(v);
    if (!activeNoteId) return;
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    pendingTitleRef.current = { id: activeNoteId, title: v };
    titleTimerRef.current = setTimeout(() => { void flushPending().catch(() => undefined); }, 400);
  };

  // Live clock
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Mark-mode state
  const [markMode, setMarkMode] = useState(false);
  const [markingGS, setMarkingGS] = useState(false);
  const [markDone, setMarkDone] = useState(false);
  const editorWrapRef = useRef<HTMLDivElement>(null);

  /** 冥想：顶栏四边按「上→右→下→左」逐边流光（每边 4s，方盒呼吸）；可选每边切换时短震 */
  const [meditationMode, setMeditationMode] = useState(false);
  const [meditationVibrate, setMeditationVibrate] = useState(false);
  /** 0 上 鼻吸 — 1 右 屏息 — 2 下 鼻呼 — 3 左 屏息 */
  const [meditationEdge, setMeditationEdge] = useState(0);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: '在此写下你的随笔……\n\n文字是时间的琥珀，将此刻凝固成永恒。',
      }),
      CharacterCount,
    ],
    content: activeNote?.content || '',
    editorProps: {
      attributes: {
        class: 'prose-custom',
        spellcheck: 'false',
      },
    },
    onUpdate: ({ editor }) => {
      if (!activeNoteId) return;
      const html = editor.getHTML();
      if (html === lastSavedRef.current) return;

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      pendingContentRef.current = { id: activeNoteId, html };
      lastSavedRef.current = html;
      saveTimerRef.current = setTimeout(() => { void flushPending().catch(() => undefined); }, 600);
    },
  });

  const initializedNoteIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editor || !activeNote || initializedNoteIdRef.current === activeNoteId) return;
    const content = activeNote?.content || '';
    initializedNoteIdRef.current = activeNoteId;
    if (editor.getHTML() !== content) {
      lastSavedRef.current = content;
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [activeNoteId, activeNote, editor]);

  // Exit mark mode when note changes
  useEffect(() => { setMarkMode(false); }, [activeNoteId]);

  // 关闭冥想时顺手关掉震动选项（避免无冥想仍在震）
  useEffect(() => {
    if (!meditationMode) setMeditationVibrate(false);
  }, [meditationMode]);

  const meditationVibrateRef = useRef(false);
  meditationVibrateRef.current = meditationVibrate;

  // 冥想起：从「上边 / 鼻吸」起；每 4s 蛇形进到下一边（上→右→下→左）。切换边时依 ref 短震，不把 vibrate 放进依赖以免重置相位
  useEffect(() => {
    if (!meditationMode) return;
    setMeditationEdge(0);
    const id = window.setInterval(() => {
      setMeditationEdge(e => {
        const next = (e + 1) % 4;
        if (meditationVibrateRef.current && typeof navigator.vibrate === 'function') {
          navigator.vibrate(32);
        }
        return next;
      });
    }, 4000);
    return () => clearInterval(id);
  }, [meditationMode]);

  const handleAnalyze = useCallback(async () => {
    if (!activeNoteId || !editor || isAnalyzing) return;
    const text = editor.getText();
    if (text.trim().length < 5) { setOperationError('请先写至少 5 个字，再提炼金句。'); setRetryAction(null); return; }

    setAnalyzing(true);
    setOperationError('');
    setRetryAction(null);
    const html = editor.getHTML();
    try {
      // Tiptap normalises HTML on load; persist the exact version used for this request.
      pendingContentRef.current = { id: activeNoteId, html };
      await flushPending();
      const result = await analyzeNote(activeNoteId, text);
      if (mountedRef.current && editor.getHTML() !== html) throw new Error('正文已更新，本次旧版本分析未保存。请再次提炼。');
      await saveNoteAnalysis(activeNoteId, result.translation, result.goldenSentences, html);
    } catch (reason) {
      if (mountedRef.current) {
        setOperationError(reason instanceof Error ? reason.message : '分析失败，请重试。');
        setRetryAction('analyze');
      }
    } finally {
      setAnalyzing(false);
    }
  }, [activeNoteId, editor, isAnalyzing, flushPending, saveNoteAnalysis, setAnalyzing]);

  const markText = useCallback(async (id: string, text: string) => {
    if (markingGS) return;
    selectedForRetryRef.current = { id, text };
    setMarkingGS(true);
    setOperationError('');
    setRetryAction(null);
    try {
      const gs = await analyzeSelectedText(id, text);
      await addManualGoldenSentence(id, gs);
      if (mountedRef.current) {
        setMarkDone(true);
        setTimeout(() => { if (mountedRef.current) setMarkDone(false); }, 1500);
      }
    } catch (reason) {
      if (mountedRef.current) { setOperationError(reason instanceof Error ? reason.message : '标记失败，请重试。'); setRetryAction('mark'); }
    } finally { if (mountedRef.current) setMarkingGS(false); }
  }, [markingGS, addManualGoldenSentence]);

  // mouseup handler: only fires in mark mode
  const handleEditorMouseUp = useCallback(async () => {
    if (!markMode || !editor || !activeNoteId || markingGS) return;

    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, ' ').trim();
    if (text.length < 2) return;

    await markText(activeNoteId, text);
  }, [markMode, editor, activeNoteId, markingGS, markText]);

  if (!activeNote) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="text-center" style={{ color: 'var(--yh-ink-020)' }}>
          <Flame size={36} style={{ color: 'var(--yh-ink-020)', marginBottom: '1rem' }} />
          <p style={{ fontSize: 'var(--yh-font-085)', letterSpacing: '0.2em', fontStyle: 'italic' }}>
            选择或创建一篇随笔
          </p>
        </div>
      </div>
    );
  }

  const charCount = editor?.storage.characterCount?.characters() || 0;
  const dateStr = getChineseDateString(now);

  return (
    <motion.div
      key={activeNoteId}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex-1 flex flex-col h-full overflow-hidden"
    >
      {/* Top Bar — 冥想时四边蛇形流光：上→右→下→左，每边 4s */}
      <div
        className="relative shrink-0 mx-2 mt-1 rounded"
        style={meditationMode ? { borderRadius: 3 } : { border: '1px solid var(--yh-line-022)', borderRadius: 2 }}
      >
        {meditationMode && (
          <div className="pointer-events-none absolute inset-0 z-0 rounded-[3px]" aria-hidden>
            {/* 上：左→右流光 */}
            <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-[2px]" style={{ clipPath: 'inset(-30px 0 -30px 0)' }}>
              <div className="absolute inset-0 transition-colors duration-300" style={{ background: meditationEdge === 0 ? brightEdge : dimEdge }} />
              {meditationEdge === 0 && <div className="meditation-sheen-bar-top" />}
            </div>
            {/* 右：上→下 */}
            <div className="absolute top-0 right-0 bottom-0 w-[3px]" style={{ clipPath: 'inset(0 -30px 0 -30px)' }}>
              <div className="absolute inset-0 transition-colors duration-300" style={{ background: meditationEdge === 1 ? brightEdge : dimEdge }} />
              {meditationEdge === 1 && <div className="meditation-sheen-bar-right" />}
            </div>
            {/* 下：右→左 */}
            <div className="absolute bottom-0 left-0 right-0 h-[3px] rounded-b-[2px]" style={{ clipPath: 'inset(-30px 0 -30px 0)' }}>
              <div className="absolute inset-0 transition-colors duration-300" style={{ background: meditationEdge === 2 ? brightEdge : dimEdge }} />
              {meditationEdge === 2 && <div className="meditation-sheen-bar-bottom" />}
            </div>
            {/* 左：下→上 */}
            <div className="absolute top-0 left-0 bottom-0 w-[3px]" style={{ clipPath: 'inset(0 -30px 0 -30px)' }}>
              <div className="absolute inset-0 transition-colors duration-300" style={{ background: meditationEdge === 3 ? brightEdge : dimEdge }} />
              {meditationEdge === 3 && <div className="meditation-sheen-bar-left" />}
            </div>
          </div>
        )}
        <div
          className={
            meditationMode
              ? 'editor-toolbar relative z-10 flex items-center justify-between px-6 py-2.5'
              : 'editor-toolbar flex items-center justify-between px-6 py-2.5'
          }
          style={meditationMode ? { margin: 2, background: 'var(--yh-bg)', borderRadius: 2 } : undefined}
        >
        <span
          className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2"
          style={{ color: 'var(--yh-ink-040)', fontSize: 'var(--yh-font-07)', letterSpacing: '0.15em', fontFamily: 'Georgia, serif' }}
        >
          {dateStr}
          {meditationMode && (
            <span
              style={{
                color: 'var(--yh-ink-050)',
                fontSize: 'var(--yh-font-062)',
                letterSpacing: '0.12em',
              }}
            >
              呼吸跟练 · {MEDITATION_EDGE_LABELS[meditationEdge]} · 上边起顺时针
            </span>
          )}
        </span>

        <div className="flex items-center gap-2">
          <motion.button
            type="button"
            onClick={() => setMeditationMode(v => !v)}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            title={
              meditationMode
                ? '关闭冥想'
                : '开启：边框流光按 鼻吸(上)→屏息(右)→鼻呼(下)→屏息(左) 每边4秒'
            }
            className="flex items-center gap-1 px-2.5 py-1 rounded-full transition-all"
            style={{
              background: meditationMode ? 'var(--yh-tint-012)' : 'transparent',
              border: `1px solid ${meditationMode ? 'var(--yh-line-045)' : 'var(--yh-line-016)'}`,
              color: meditationMode ? 'var(--yh-accent)' : 'var(--yh-ink-040)',
              fontSize: 'var(--yh-font-068)',
              letterSpacing: '0.1em',
              cursor: 'pointer',
            }}
          >
            <Wind size={12} />
            冥想
          </motion.button>

          <AnimatePresence>
            {meditationMode && (
              <motion.button
                type="button"
                key="vib"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.15 }}
                onClick={() => {
                  setMeditationVibrate(v => {
                    const next = !v;
                    if (next && typeof navigator.vibrate === 'function') {
                      navigator.vibrate(24);
                    }
                    return next;
                  });
                }}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                title={meditationVibrate ? '已开：每 4 秒短震（依设备）' : '开启：每 4 秒短震一次'}
                className="flex items-center justify-center w-7 h-7 rounded-full transition-all overflow-hidden"
                style={{
                  border: `1px solid ${meditationVibrate ? 'var(--yh-line-050)' : 'var(--yh-line-020)'}`,
                  color: meditationVibrate ? 'var(--yh-accent)' : 'var(--yh-ink-030)',
                  background: meditationVibrate ? 'var(--yh-tint-010)' : 'transparent',
                }}
              >
                {meditationVibrate ? <Vibrate size={12} /> : <VibrateOff size={12} />}
              </motion.button>
            )}
          </AnimatePresence>

          {/* Mark-mode toggle button */}
          <motion.button
            onClick={() => setMarkMode(v => !v)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title={markMode ? '退出标记模式' : '标记金句：开启后框选文字即可标记'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all"
            style={{
              background: markMode ? 'var(--yh-tint-018)' : 'transparent',
              border: `1px solid ${markMode ? 'var(--yh-line-055)' : 'var(--yh-line-020)'}`,
              color: markMode ? 'var(--yh-accent)' : 'var(--yh-ink-045)',
              fontSize: 'var(--yh-font-072)',
              letterSpacing: '0.08em',
              cursor: 'pointer',
            }}
          >
            <AnimatePresence mode="wait">
              {markingGS ? (
                <motion.span key="spinning" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <Loader2 size={12} className="animate-spin" />
                </motion.span>
              ) : (
                <motion.span key="pen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <PenLine size={12} />
                </motion.span>
              )}
            </AnimatePresence>
            {markDone ? '已标记 ✦' : markingGS ? '标记中…' : markMode ? '标记中' : '标记金句'}
          </motion.button>

          {/* Analyze button */}
          <motion.button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            whileHover={!isAnalyzing ? { scale: 1.03 } : {}}
            whileTap={!isAnalyzing ? { scale: 0.97 } : {}}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full transition-all"
            style={{
              background: isAnalyzing ? 'var(--yh-tint-005)' : 'var(--yh-tint-010)',
              border: '1px solid var(--yh-line-025)',
              color: isAnalyzing ? 'var(--yh-ink-040)' : 'var(--yh-accent)',
              fontSize: 'var(--yh-font-075)',
              letterSpacing: '0.1em',
              cursor: isAnalyzing ? 'not-allowed' : 'pointer',
            }}
          >
            <AnimatePresence mode="wait">
              {isAnalyzing ? (
                <motion.span key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <Loader2 size={12} className="animate-spin" />
                </motion.span>
              ) : (
                <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <Sparkles size={12} />
                </motion.span>
              )}
            </AnimatePresence>
            {isAnalyzing ? '提炼中…' : '提炼金句'}
          </motion.button>
        </div>
        </div>
      </div>

      {operationError && <div role="alert" className="px-8 py-2" style={{ color: 'var(--yh-error)', fontSize: 'var(--yh-font-075)' }}>
        {operationError}
        {retryAction && <button type="button" disabled={isAnalyzing || markingGS} className="ml-3 underline" onClick={() => {
          if (retryAction === 'analyze') void handleAnalyze();
          else if (selectedForRetryRef.current) void markText(selectedForRetryRef.current.id, selectedForRetryRef.current.text);
        }}>重试</button>}
      </div>}
      {saveError && <div role="alert" className="px-8 py-2" style={{ color: 'var(--yh-error)', fontSize: 'var(--yh-font-075)' }}>{saveError}<button type="button" className="ml-3 underline" onClick={() => void flushPending().catch(() => undefined)}>重试保存</button></div>}

      {/* Mark mode hint bar */}
      <AnimatePresence>
        {markMode && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              background: 'var(--yh-tint-006)',
              borderBottom: '1px solid var(--yh-line-015)',
              overflow: 'hidden',
            }}
          >
            <p className="px-8 py-1.5" style={{ color: 'var(--yh-ink-050)', fontSize: 'var(--yh-font-065)', letterSpacing: '0.08em' }}>
              ✦ 标记模式已开启 · 框选文字后松开即可标记为金句
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Title input + divider */}
      <div className="shrink-0 px-8 pt-4">
        <input
          aria-label="随笔标题"
          value={title}
          onChange={e => handleTitleChange(e.target.value)}
          placeholder="写个标题…"
          className="w-full bg-transparent outline-none"
          style={{
            color: 'var(--yh-text)',
            fontSize: '1.4rem',
            fontFamily: 'Georgia, "Noto Serif SC", serif',
            letterSpacing: '0.04em',
            border: 'none',
          }}
        />
        <div style={{ height: 1, background: 'linear-gradient(90deg, var(--yh-tint-045), var(--yh-tint-008) 70%, transparent)', marginTop: 8 }} />
      </div>

      {/* Editor */}
      <div
        ref={editorWrapRef}
        className="flex-1 overflow-y-auto px-8 py-4"
        style={{ cursor: markMode ? 'text' : 'auto' }}
        onMouseUp={handleEditorMouseUp}
      >
        <EditorContent editor={editor} />
      </div>

      {/* Bottom Bar */}
      <div
        className="flex items-center justify-between px-8 py-2 shrink-0"
        style={{ borderTop: '1px solid var(--yh-line-006)' }}
      >
        <span style={{ color: 'var(--yh-ink-020)', fontSize: 'var(--yh-font-062)', letterSpacing: '0.1em' }}>
          自动保存
        </span>
        <span style={{ color: 'var(--yh-ink-025)', fontSize: 'var(--yh-font-062)' }}>
          {charCount} 字
        </span>
      </div>
    </motion.div>
  );
}
