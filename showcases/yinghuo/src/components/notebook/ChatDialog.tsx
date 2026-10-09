/** 日记集独立对话；手动请求并保留失败重试，异步回复不会混入其他日记集。 */
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Loader2, MessageCircle, Trash2, Flame } from 'lucide-react';
import { useNoteStore } from '../../stores/useNoteStore';
import { getAgentLevel } from '../../types';
import { getAgentReply } from '../../services/aiService';

interface Props {
  projectId: string;
}

export default function ChatDialog({ projectId }: Props) {
  const { chatMessages, notes, projects, addChatMessage, clearChat, pendingChatProjects, setChatReplying } = useNoteStore();
  const [input, setInput] = useState('');
  const replying = !!pendingChatProjects[projectId];
  const bottomRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [failedRequest, setFailedRequest] = useState<{ message: string; userSaved: boolean } | null>(null);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const noteCount = notes.length;
  const currentLevel = getAgentLevel(noteCount);
  const project = projects.find(p => p.id === projectId);
  const agentName = project?.agentName || '萤火';
  const agentProfile = project?.agentProfile;

  const recentExcerpts = notes
    .slice(0, 5)
    .map(n => n.content.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, replying]);

  const sendMessage = async (msg: string, saveUser: boolean) => {
    if (!msg || busyRef.current || useNoteStore.getState().pendingChatProjects[projectId]) return;
    busyRef.current = true;
    setChatReplying(projectId, true);
    setError('');
    setFailedRequest(null);
    let userSaved = !saveUser;
    try {
      if (saveUser) { await addChatMessage(projectId, 'user', msg); userSaved = true; }
      const history = chatMessages.slice(-10);
      if (!saveUser && history.at(-1)?.role === 'user' && history.at(-1)?.content === msg) history.pop();
      const reply = await getAgentReply(msg, agentName, agentProfile, currentLevel.level, recentExcerpts, history.map(({ role, content }) => ({ role, content })));
      await addChatMessage(projectId, 'agent', reply);
    } catch (reason) {
      if (mountedRef.current) {
        setError(reason instanceof Error ? reason.message : '消息发送失败，请重试。');
        setFailedRequest({ message: msg, userSaved });
      }
    } finally {
      busyRef.current = false;
      setChatReplying(projectId, false);
    }
  };

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || busyRef.current || useNoteStore.getState().pendingChatProjects[projectId]) return;
    setInput('');
    await sendMessage(msg, true);
  };

  const isLocked = noteCount < 50;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--yh-line-008)' }}
      >
        <div className="flex items-center gap-2">
          <MessageCircle size={13} style={{ color: 'var(--yh-ink-050)' }} />
          <span style={{ color: 'var(--yh-ink-050)', fontSize: 'var(--yh-font-065)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
            与 {agentName} 对话
          </span>
        </div>
        {chatMessages.length > 0 && (
          <button
            type="button"
            aria-label="清空当前日记集的对话"
            disabled={replying}
            onClick={() => {
              if (window.confirm('确认清空当前日记集的对话？随笔不会删除。')) void clearChat(projectId).then(() => { setError(''); setFailedRequest(null); }).catch(() => setError('清空对话失败，请重试。'));
            }}
            className="p-1 opacity-30 hover:opacity-70 transition-opacity"
            style={{ color: 'var(--yh-accent)' }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {isLocked ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center px-6">
              <Flame size={28} style={{ color: 'var(--yh-ink-020)', marginBottom: '0.75rem' }} />
              <p style={{ color: 'var(--yh-ink-030)', fontSize: 'var(--yh-font-075)', lineHeight: 1.8, fontStyle: 'italic' }}>
                写满 50 篇随笔<br />
                唤醒你的专属知己<br />
                <span style={{ fontSize: 'var(--yh-font-065)', color: 'var(--yh-ink-020)' }}>
                  高山流水遇知音
                </span>
              </p>
              <div
                className="mt-4 mx-auto h-1 rounded-full overflow-hidden"
                style={{ width: 80, background: 'var(--yh-tint-008)' }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(noteCount / 50) * 100}%`,
                    background: 'linear-gradient(90deg, var(--yh-tint-040), var(--yh-tint-080))',
                  }}
                />
              </div>
              <p style={{ color: 'var(--yh-ink-020)', fontSize: 'var(--yh-font-06)', marginTop: '0.4rem' }}>
                {noteCount} / 50
              </p>
            </div>
          </div>
        ) : (
          <>
            {chatMessages.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-start gap-2 mt-2"
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: 'var(--yh-tint-012)', border: '1px solid var(--yh-line-025)' }}
                >
                  <span style={{ fontSize: 'var(--yh-font-055)', color: 'var(--yh-accent)' }}>✦</span>
                </div>
                <div
                  className="rounded-2xl rounded-tl-none px-3 py-2.5 max-w-xs"
                  style={{ background: 'var(--yh-tint-007)', border: '1px solid var(--yh-line-012)' }}
                >
                  <p style={{ color: 'var(--yh-text-070)', fontSize: 'var(--yh-font-078)', lineHeight: 1.65 }}>
                    你好，我是{agentName}。发送消息后，我会参考当前日记集的近期随笔与你交流。
                  </p>
                </div>
              </motion.div>
            )}

            <AnimatePresence>
              {chatMessages.map(msg => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className={`flex items-end gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                >
                  {msg.role === 'agent' && (
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: 'var(--yh-tint-012)', border: '1px solid var(--yh-line-025)' }}
                    >
                      <span style={{ fontSize: 'var(--yh-font-055)', color: 'var(--yh-accent)' }}>✦</span>
                    </div>
                  )}
                  <div
                    className={`rounded-2xl px-3 py-2.5 max-w-xs ${msg.role === 'user' ? 'rounded-br-none' : 'rounded-bl-none'}`}
                    style={{
                      background: msg.role === 'user'
                        ? 'var(--yh-tint-012)'
                        : 'var(--yh-tint-006)',
                      border: `1px solid ${msg.role === 'user' ? 'var(--yh-line-020)' : 'var(--yh-line-010)'}`,
                    }}
                  >
                    <p style={{
                      color: msg.role === 'user' ? 'var(--yh-accent)' : 'var(--yh-text-075)',
                      fontSize: 'var(--yh-font-078)',
                      lineHeight: 1.65,
                      whiteSpace: 'pre-wrap',
                    }}>
                      {msg.content}
                    </p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {replying && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-end gap-2"
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: 'var(--yh-tint-012)', border: '1px solid var(--yh-line-025)' }}
                >
                  <span style={{ fontSize: 'var(--yh-font-055)', color: 'var(--yh-accent)' }}>✦</span>
                </div>
                <div
                  className="rounded-2xl rounded-bl-none px-4 py-3"
                  style={{ background: 'var(--yh-tint-006)', border: '1px solid var(--yh-line-010)' }}
                >
                  <div className="flex items-center gap-1.5">
                    {[0, 1, 2].map(i => (
                      <motion.div
                        key={i}
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: 'var(--yh-tint-050)' }}
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                      />
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Input */}
      {!isLocked && (
        <div
          className="shrink-0 px-4 py-3"
          style={{ borderTop: '1px solid var(--yh-line-008)' }}
        >
          {error && <p role="alert" style={{ color: 'var(--yh-error)', fontSize: 'var(--yh-font-072)', marginBottom: 8 }}>{error}
            {failedRequest && <button type="button" disabled={replying} className="ml-2 underline" onClick={() => void sendMessage(failedRequest.message, !failedRequest.userSaved)}>重试这条消息</button>}
          </p>}
          <div
            className="flex items-end gap-2 rounded-xl px-3 py-2"
            style={{ background: 'var(--yh-tint-004)', border: '1px solid var(--yh-line-012)' }}
          >
            <textarea
              aria-label="发送给知己的消息"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="与知己倾诉…"
              rows={1}
              className="flex-1 bg-transparent outline-none resize-none"
              style={{
                color: 'var(--yh-text)',
                fontSize: 'var(--yh-font-08)',
                lineHeight: 1.6,
                maxHeight: 96,
                fontFamily: 'Georgia, serif',
              }}
            />
            <motion.button
              type="button"
              aria-label="发送消息"
              onClick={handleSend}
              disabled={!input.trim() || replying}
              whileHover={input.trim() && !replying ? { scale: 1.1 } : {}}
              whileTap={input.trim() && !replying ? { scale: 0.9 } : {}}
              className="p-1.5 rounded-lg shrink-0 transition-all"
              style={{
                background: input.trim() && !replying ? 'var(--yh-tint-015)' : 'transparent',
                color: input.trim() && !replying ? 'var(--yh-accent)' : 'var(--yh-ink-020)',
                cursor: input.trim() && !replying ? 'pointer' : 'default',
              }}
            >
              {replying ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </motion.button>
          </div>
          <p style={{ color: 'var(--yh-ink-020)', fontSize: 'var(--yh-font-058)', marginTop: '0.4rem', textAlign: 'right' }}>
            Enter 发送 · Shift+Enter 换行
          </p>
        </div>
      )}
    </div>
  );
}
