/** 工作页只组装 UI、显示本地状态和手动操作；AI 配置和演示入口保持独立。 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, Sparkles, ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/notebook/Sidebar';
import NoteEditor from '../components/notebook/NoteEditor';
import TranslationPanel from '../components/notebook/TranslationPanel';
import ChatDialog from '../components/notebook/ChatDialog';
import AgentProfile from '../components/notebook/AgentProfile';
import NotebookBackup from '../components/notebook/NotebookBackup';
import AISettings from '../components/notebook/AISettings';
import { DEMO_PROJECT_ID, importDemoCollection } from '../services/demoData';
import { useNoteStore } from '../stores/useNoteStore';

type RightTab = 'analysis' | 'chat';

export default function NotebookPage() {
  const navigate = useNavigate();
  const { loadProjects, activeProjectId, activeNoteId, setActiveProject, loadNotes, setActiveNote, storageError, failedDrafts, retryFailedDrafts } = useNoteStore();
  const [rightTab, setRightTab] = useState<RightTab>('analysis');
  const [pageError, setPageError] = useState('');
  const [loadingDemo, setLoadingDemo] = useState(false);

  useEffect(() => {
    void loadProjects().catch(() => setPageError('无法读取本地日记，请检查浏览器存储权限后重试。'));
  }, [loadProjects]);

  const hasFailedDrafts = Object.values(failedDrafts).some(draft => draft.content !== undefined || draft.title !== undefined);
  useEffect(() => {
    if (!hasFailedDrafts) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [hasFailedDrafts]);

  const openDemo = async () => {
    if (loadingDemo) return;
    setLoadingDemo(true);
    setPageError('');
    try {
      const id = await importDemoCollection();
      await loadProjects();
      setActiveProject(id);
      await loadNotes(id);
      if (useNoteStore.getState().activeProjectId === id) setActiveNote(`${DEMO_PROJECT_ID}-note-50`);
      setRightTab('analysis');
    } catch { setPageError('导入演示失败，请检查本地存储后再次点击。个人日记不会被覆盖。'); }
    finally { setLoadingDemo(false); }
  };

  return (
    <div
      className="flex h-screen w-screen overflow-hidden"
      style={{ background: '#080818' }}
    >
      {/* Subtle background gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 20% 50%, rgba(212,175,55,0.03) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(150,120,80,0.02) 0%, transparent 50%)',
        }}
      />

      {/* Sidebar */}
      <Sidebar />

      {/* Main Editor Area */}
      <main
        className="flex-1 flex flex-col min-w-0 relative"
        style={{ borderRight: '1px solid rgba(212,175,55,0.08)' }}
      >
        {/* Top Nav */}
        <div
          className="flex items-center justify-between px-6 py-3 shrink-0"
          style={{ borderBottom: '1px solid rgba(212,175,55,0.07)' }}
        >
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 opacity-30 hover:opacity-70 transition-opacity"
            style={{ color: '#d4af37', fontSize: '0.72rem', letterSpacing: '0.1em' }}
          >
            <ChevronLeft size={13} />
            萤火
          </button>
          <div style={{ color: 'rgba(212,175,55,0.2)', fontSize: '0.62rem', letterSpacing: '0.2em' }}>
            {activeProjectId ? '' : '· 请先选择日记集 ·'}
          </div>
          <div className="flex items-center gap-4">
            <button type="button" disabled={loadingDemo} onClick={() => void openDemo()} style={{ color: '#d4af37', fontSize: '0.72rem' }}>{loadingDemo ? '准备演示…' : '虚构演示集'}</button>
            <AISettings />
            <NotebookBackup />
          </div>
        </div>

        {(pageError || storageError) && <div role="alert" className="px-6 py-2" style={{ color: '#f1a59d', fontSize: '0.75rem' }}>
          {pageError || storageError}
          <button type="button" className="ml-3 underline" onClick={() => {
            void (async () => {
              try {
                await useNoteStore.getState().flushActiveEdits?.();
                await retryFailedDrafts();
                await loadProjects();
                const id = useNoteStore.getState().activeProjectId;
                if (id) await loadNotes(id);
                setPageError('');
              } catch { setPageError('本地保存或读取仍失败，请保持页面打开，检查浏览器存储权限后重试。'); }
            })();
          }}>重试本地保存与读取</button>
        </div>}
        {activeProjectId === DEMO_PROJECT_ID && <p role="status" className="px-6 py-2" style={{ color: '#e0c580', fontSize: '0.72rem', background: 'rgba(212,175,55,0.06)' }}>虚构演示集 · 50 篇示例随笔；现有译文、金句和画像为预先编写的样例，未调用 AI。点击提炼、生成画像或发送消息才会请求 DeepSeek。</p>}
        <NoteEditor key={activeNoteId ?? 'empty'} />
      </main>

      {/* Right Panel */}
      <aside
        className="flex flex-col shrink-0"
        style={{
          width: 360,
          background: 'rgba(10,10,24,0.97)',
        }}
      >
        {/* Agent Profile */}
        {activeProjectId && <AgentProfile key={activeProjectId} projectId={activeProjectId} />}

        {/* Tab Switcher */}
        <div
          className="flex shrink-0"
          style={{ borderBottom: '1px solid rgba(212,175,55,0.08)' }}
        >
          {([
            { id: 'analysis' as RightTab, label: '金句分析', icon: Sparkles },
            { id: 'chat' as RightTab, label: '知己对话', icon: MessageCircle },
          ] as const).map(tab => {
            const Icon = tab.icon;
            const isActive = rightTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setRightTab(tab.id)}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 transition-all"
                style={{
                  color: isActive ? '#d4af37' : 'rgba(212,175,55,0.35)',
                  borderBottom: isActive ? '1px solid rgba(212,175,55,0.5)' : '1px solid transparent',
                  fontSize: '0.72rem',
                  letterSpacing: '0.1em',
                  cursor: 'pointer',
                  background: 'transparent',
                }}
              >
                <Icon size={12} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <AnimatePresence mode="wait">
            {rightTab === 'analysis' ? (
              <motion.div
                key="analysis"
                className="h-full"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
              >
                <TranslationPanel />
              </motion.div>
            ) : (
              <motion.div
                key="chat"
                className="h-full"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
              >
                {activeProjectId ? (
                  <ChatDialog key={activeProjectId} projectId={activeProjectId} />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <p style={{ color: 'rgba(212,175,55,0.2)', fontSize: '0.75rem', fontStyle: 'italic' }}>
                      请先选择笔记集
                    </p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </aside>
    </div>
  );
}
