/** 备份导入导出 UI；操作前等待编辑保存，错误保持可见。 */
import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import Modal from '../ui/Modal';
import { useNoteStore } from '../../stores/useNoteStore';
import {
  collectBackupPayload,
  downloadBackupJson,
  parseBackupJson,
  importBackupReplace,
  importBackupMerge,
} from '../../services/backup';

type ImportMode = 'replace' | 'merge';

export default function NotebookBackup() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingJson, setPendingJson] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useNoteStore(s => s.loadProjects);

  const handleExport = async () => {
    setError(null);
    setBusy(true);
    try {
      await useNoteStore.getState().flushActiveEdits?.();
      await useNoteStore.getState().retryFailedDrafts();
      const payload = await collectBackupPayload();
      downloadBackupJson(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败');
    } finally {
      setBusy(false);
    }
  };

  const handlePickFile = () => fileRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      parseBackupJson(text);
      setPendingJson(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法读取文件');
    }
  };

  const runImport = async () => {
    if (!pendingJson) return;
    setBusy(true);
    setError(null);
    try {
      const payload = parseBackupJson(pendingJson);
      await useNoteStore.getState().flushActiveEdits?.();
      await useNoteStore.getState().retryFailedDrafts();
      if (importMode === 'replace') {
        await importBackupReplace(payload);
      } else {
        await importBackupMerge(payload);
      }
      useNoteStore.getState().setActiveProject(null);
      await loadProjects();
      setPendingJson(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <button
          aria-label="导出全部日记备份"
          type="button"
          onClick={handleExport}
          disabled={busy}
          title="导出全部日记到 JSON 文件"
          className="p-1.5 rounded transition-opacity opacity-40 hover:opacity-90"
          style={{ color: '#d4af37' }}
        >
          <Download size={14} />
        </button>
        <button
          aria-label="选择日记备份文件"
          type="button"
          onClick={handlePickFile}
          disabled={busy}
          title="从 JSON 文件导入"
          className="p-1.5 rounded transition-opacity opacity-40 hover:opacity-90"
          style={{ color: '#d4af37' }}
        >
          <Upload size={14} />
        </button>
      </div>
      {error && !pendingJson && <p role="alert" style={{ color: '#f1a59d', fontSize: '0.7rem', maxWidth: 240 }}>{error} 可再次点击导出或重新选择文件。</p>}
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileChange}
      />

      <Modal open={!!pendingJson} onClose={() => !busy && setPendingJson(null)} title="导入备份">
        <p style={{ color: 'rgba(232,220,200,0.7)', fontSize: '0.82rem', lineHeight: 1.7, marginBottom: '1rem' }}>
          请选择导入方式。建议先使用「导出」保存当前数据。
        </p>
        <div className="flex flex-col gap-2 mb-4">
          <label className="flex items-center gap-2 cursor-pointer" style={{ color: 'rgba(232,220,200,0.85)', fontSize: '0.8rem' }}>
            <input
              type="radio"
              name="importMode"
              checked={importMode === 'replace'}
              onChange={() => setImportMode('replace')}
            />
            替换本地数据（清空后导入备份中的全部内容）
          </label>
          <label className="flex items-center gap-2 cursor-pointer" style={{ color: 'rgba(232,220,200,0.85)', fontSize: '0.8rem' }}>
            <input
              type="radio"
              name="importMode"
              checked={importMode === 'merge'}
              onChange={() => setImportMode('merge')}
            />
            合并（相同 id 的记录以备份为准覆盖）
          </label>
        </div>
        {error && (
          <p role="alert" style={{ color: 'rgba(255,120,100,0.9)', fontSize: '0.78rem', marginBottom: '0.75rem' }}>{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setPendingJson(null)}
            className="px-4 py-2 rounded-lg text-sm"
            style={{ color: 'rgba(212,175,55,0.5)', background: 'transparent' }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={runImport}
            className="px-4 py-2 rounded-lg text-sm"
            style={{
              color: '#080818',
              background: busy ? 'rgba(212,175,55,0.3)' : '#d4af37',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? '导入中…' : '确认导入'}
          </button>
        </div>
      </Modal>
    </>
  );
}
