/** 日记集与随笔导航；所有增删改失败均在当前界面显示。 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Edit3, ChevronRight, Flame, X } from 'lucide-react';
import { useNoteStore } from '../../stores/useNoteStore';
import { getAgentLevel, getLevelProgress, AGENT_LEVELS } from '../../types';
import ProgressBar from '../ui/ProgressBar';
import Modal from '../ui/Modal';

export default function Sidebar() {
  const {
    projects, notes, activeProjectId, activeNoteId,
    createProject, deleteProject, renameProject, deleteNote,
    setActiveProject, setActiveNote, createNote,
  } = useNoteStore();

  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [hoveredNoteId, setHoveredNoteId] = useState<string | null>(null);
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const [creatingForProject, setCreatingForProject] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);

  // Per-project note count (notes is always the active project's notes)
  const projectNoteCount = activeProjectId ? notes.length : 0;
  const currentLevel = getAgentLevel(projectNoteCount);
  const progress = getLevelProgress(projectNoteCount);
  const nextLevel = AGENT_LEVELS[currentLevel.level + 1];

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || creatingProject) return;
    setCreatingProject(true);
    setError('');
    try {
      const project = await createProject(newProjectName.trim());
      setActiveProject(project.id);
      setNewProjectName('');
      setShowNewProject(false);
    } catch { setError('创建日记集失败，请检查本地存储后重试。'); }
    finally { setCreatingProject(false); }
  };

  const handleCreateNote = async (projectId: string) => {
    if (creatingForProject) return;

    if (activeProjectId !== projectId) {
      setActiveProject(projectId);
    }

    setCreatingForProject(projectId);
    setError('');
    try {
      const note = await createNote(projectId);
      if (useNoteStore.getState().activeProjectId === projectId) setActiveNote(note.id);
    } catch {
      setError('创建随笔失败，请再次点击重试。');
    } finally {
      setCreatingForProject(null);
    }
  };

  const handleRename = async (id: string) => {
    if (!renameValue.trim()) return;
    try {
      await renameProject(id, renameValue.trim());
      setRenamingId(null);
      setError('');
    } catch { setError('重命名失败，请重试。'); }
  };

  return (
    <aside
      className="flex flex-col h-full"
      style={{
        width: 240,
        minWidth: 240,
        background: 'var(--yh-sidebar)',
        borderRight: '1px solid var(--yh-line-012)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-4"
        style={{ borderBottom: '1px solid var(--yh-line-010)' }}>
        <Flame size={16} style={{ color: 'var(--yh-accent)' }} />
        <span style={{ color: 'var(--yh-accent)', fontFamily: 'Georgia, serif', fontSize: '0.95rem', letterSpacing: '0.1em' }}>
          萤火
        </span>
      </div>

      {error && <p role="alert" className="px-4 py-2" style={{ color: 'var(--yh-error)', fontSize: 'var(--yh-font-07)' }}>{error}</p>}

      {/* Progress / Level */}
      <div className="px-4 py-4" style={{ borderBottom: '1px solid var(--yh-line-035)' }}>
        <div className="flex items-center justify-between mb-2">
          <span style={{ color: 'var(--yh-accent)', fontSize: 'var(--yh-font-08)', letterSpacing: '0.15em', fontFamily: 'Georgia, serif' }}>
            {currentLevel.name}
          </span>
          <span style={{ color: 'var(--yh-ink-040)', fontSize: 'var(--yh-font-065)' }}>
            {projectNoteCount} 篇
          </span>
        </div>
        <ProgressBar percentage={progress.percentage} height={3} />
        {nextLevel && (
          <p className="mt-1" style={{ color: 'var(--yh-ink-030)', fontSize: 'var(--yh-font-06)', letterSpacing: '0.05em' }}>
            再写 {nextLevel.minNotes - projectNoteCount} 篇解锁「{nextLevel.name}」
          </p>
        )}
        <p className="mt-1" style={{ color: 'var(--yh-text-030)', fontSize: 'var(--yh-font-06)', fontStyle: 'italic' }}>
          {currentLevel.description}
        </p>
      </div>

      {/* Projects header */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <span style={{ color: 'var(--yh-accent)', fontSize: 'var(--yh-font-072)', fontWeight: 700, letterSpacing: '0.2em' }}>
          日记集
        </span>
        <button
          type="button"
          aria-label="新建日记集"
          onClick={() => setShowNewProject(true)}
          className="p-1 rounded opacity-50 hover:opacity-100 transition-opacity"
          style={{ color: 'var(--yh-accent)' }}
        >
          <Plus size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <AnimatePresence>
          {projects.map(project => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="mb-1"
            >
              {/* Project row */}
              <div
                className="flex items-center gap-1.5 px-2 py-2 rounded-lg cursor-pointer transition-all"
                style={{
                  background: activeProjectId === project.id
                    ? 'var(--yh-tint-010)'
                    : 'transparent',
                  border: activeProjectId === project.id
                    ? '1px solid var(--yh-tint-020)'
                    : '1px solid transparent',
                }}
                onClick={() => setActiveProject(project.id)}
                onMouseEnter={() => setHoveredProjectId(project.id)}
                onMouseLeave={() => setHoveredProjectId(null)}
              >
                {renamingId === project.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={() => handleRename(project.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRename(project.id);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onClick={e => e.stopPropagation()}
                    className="flex-1 bg-transparent outline-none"
                    style={{ color: 'var(--yh-accent)', fontSize: 'var(--yh-font-08)' }}
                  />
                ) : (
                  <>
                    <ChevronRight
                      size={10}
                      style={{
                        color: 'var(--yh-ink-040)',
                        flexShrink: 0,
                        transform: activeProjectId === project.id ? 'rotate(90deg)' : 'none',
                        transition: 'transform 0.2s',
                      }}
                    />
                    <span
                      className="flex-1 truncate flex items-center gap-1"
                      style={{
                        color: activeProjectId === project.id ? 'var(--yh-accent)' : 'var(--yh-text-060)',
                        fontSize: 'var(--yh-font-082)',
                      }}
                    >
                      {project.name}
                      {project.agentName && (
                        <span
                          title={`知己「${project.agentName}」已觉醒`}
                          style={{ lineHeight: 1, flexShrink: 0 }}
                        >
                          <Flame size={9} style={{ color: 'var(--yh-ink-060)' }} />
                        </span>
                      )}
                    </span>
                    {/* Project action buttons — visible on hover */}
                    <div
                      className="project-actions flex gap-1"
                      style={{
                        opacity: hoveredProjectId === project.id ? 1 : 0,
                        pointerEvents: hoveredProjectId === project.id ? 'auto' : 'none',
                        transition: 'opacity 0.15s',
                      }}
                    >
                      <button
                        onClick={e => { e.stopPropagation(); setRenamingId(project.id); setRenameValue(project.name); }}
                        className="p-0.5 rounded"
                        style={{ color: 'var(--yh-ink-050)' }}
                        title="重命名"
                      >
                        <Edit3 size={10} />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); setDeleteConfirmId(project.id); }}
                        className="p-0.5 rounded"
                        style={{ color: 'var(--yh-ink-050)' }}
                        title="删除日记集"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Notes list — only when project is active */}
              {activeProjectId === project.id && (
                <div className="ml-4 mt-1">
                  {notes.map((note, index) => {
                    const d = new Date(note.createdAt);
                    const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
                    const seq = notes.length - index;
                    const circled = seq <= 20
                      ? String.fromCodePoint(0x2460 + seq - 1)
                      : seq <= 35
                        ? String.fromCodePoint(0x3251 + seq - 21)
                        : `(${seq})`;
                    const preview = note.title?.trim() || '无题';
                    const isHovered = hoveredNoteId === note.id;
                    const isActive = activeNoteId === note.id;
                    return (
                      <div
                        key={note.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-all"
                        style={{
                          background: isActive ? 'var(--yh-tint-008)' : 'transparent',
                          borderLeft: isActive ? '2px solid var(--yh-line-050)' : '2px solid transparent',
                        }}
                        onClick={() => setActiveNote(note.id)}
                        onMouseEnter={() => setHoveredNoteId(note.id)}
                        onMouseLeave={() => setHoveredNoteId(null)}
                      >
                        <span style={{ color: 'var(--yh-ink-050)', fontSize: 'var(--yh-font-065)', flexShrink: 0, lineHeight: 1 }}>
                          {circled}
                        </span>
                        <span style={{ color: 'var(--yh-ink-028)', fontSize: 'var(--yh-font-058)', flexShrink: 0 }}>
                          {dateStr}
                        </span>
                        <span
                          className="truncate flex-1"
                          style={{
                            color: isActive ? 'var(--yh-text-085)' : 'var(--yh-text-045)',
                            fontSize: 'var(--yh-font-075)',
                          }}
                        >
                          {preview}
                        </span>
                        <button
                          onClick={e => { e.stopPropagation(); void deleteNote(note.id).catch(() => setError('删除随笔失败，请重试。')); }}
                          className="transition-opacity p-0.5 rounded shrink-0"
                          style={{
                            color: 'var(--yh-ink-060)',
                            opacity: isHovered ? 1 : 0.25,
                            pointerEvents: 'auto',
                          }}
                          title="删除随笔"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* New note button — always visible under every project */}
              <button
                onClick={() => handleCreateNote(project.id)}
                disabled={!!creatingForProject}
                className="flex items-center gap-1.5 px-2 py-1 w-full rounded transition-all"
                style={{
                  color: creatingForProject === project.id ? 'var(--yh-ink-030)' : 'var(--yh-ink-040)',
                  fontSize: 'var(--yh-font-07)',
                  cursor: creatingForProject ? 'not-allowed' : 'pointer',
                  marginLeft: '1rem',
                  marginTop: '2px',
                }}
              >
                <Plus size={9} />
                <span>{creatingForProject === project.id ? '创建中…' : '新建随笔'}</span>
              </button>
            </motion.div>
          ))}
        </AnimatePresence>

        {projects.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p style={{ color: 'var(--yh-ink-025)', fontSize: 'var(--yh-font-075)', lineHeight: 1.8, fontStyle: 'italic' }}>
              点击 + 创建<br />你的第一个日记集
            </p>
          </div>
        )}
      </div>

      {/* New Project Modal */}
      <Modal open={showNewProject} onClose={() => setShowNewProject(false)} title="新建日记集">
        <div className="flex flex-col gap-3">
          {error && <p role="alert" style={{ color: 'var(--yh-error)', fontSize: 'var(--yh-font-075)' }}>{error}</p>}
          <input
            aria-label="日记集名称"
            autoFocus
            value={newProjectName}
            onChange={e => setNewProjectName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateProject(); }}
            placeholder="日记集名称…"
            className="w-full px-3 py-2.5 rounded-lg bg-transparent outline-none"
            style={{
              border: '1px solid var(--yh-line-025)',
              color: 'var(--yh-text)',
              fontSize: '0.9rem',
              fontFamily: 'Georgia, serif',
            }}
          />
          <button
            onClick={handleCreateProject}
            disabled={!newProjectName.trim() || creatingProject}
            className="py-2.5 rounded-lg transition-all"
            style={{
              background: newProjectName.trim() ? 'var(--yh-tint-015)' : 'var(--yh-tint-005)',
              border: '1px solid var(--yh-line-030)',
              color: newProjectName.trim() ? 'var(--yh-accent)' : 'var(--yh-ink-030)',
              fontSize: 'var(--yh-font-085)',
              letterSpacing: '0.1em',
              cursor: newProjectName.trim() ? 'pointer' : 'default',
            }}
          >
            {creatingProject ? '创建中…' : '创建'}
          </button>
        </div>
      </Modal>

      {/* Delete Project Confirm Modal */}
      <Modal open={!!deleteConfirmId} onClose={() => setDeleteConfirmId(null)} title="删除日记集">
        {error && <p role="alert" style={{ color: 'var(--yh-error)', fontSize: 'var(--yh-font-075)' }}>{error}</p>}
        <p style={{ color: 'var(--yh-text-070)', fontSize: 'var(--yh-font-085)', marginBottom: '1rem', lineHeight: 1.7 }}>
          确认删除「{projects.find(p => p.id === deleteConfirmId)?.name}」？<br />
          <span style={{ color: 'var(--yh-ink-050)', fontSize: 'var(--yh-font-078)' }}>其中所有随笔将被永久删除。</span>
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setDeleteConfirmId(null)}
            className="flex-1 py-2 rounded-lg"
            style={{ border: '1px solid var(--yh-line-020)', color: 'var(--yh-ink-060)', fontSize: 'var(--yh-font-082)', cursor: 'pointer' }}
          >
            取消
          </button>
          <button
            onClick={async () => {
              if (deleteConfirmId) {
                try {
                  await deleteProject(deleteConfirmId);
                  setDeleteConfirmId(null);
                  setError('');
                } catch { setError('删除日记集失败，请重试。'); }
              }
            }}
            className="flex-1 py-2 rounded-lg"
            style={{
              background: 'var(--yh-danger-fill)',
              border: '1px solid var(--yh-danger-border)',
              color: 'var(--yh-danger-ink)',
              fontSize: 'var(--yh-font-082)',
              cursor: 'pointer',
            }}
          >
            删除
          </button>
        </div>
      </Modal>
    </aside>
  );
}
