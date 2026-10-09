/** 首页展示产品入口与萤火背景，不调用 AI 或读取私人日记。 */
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Flame } from 'lucide-react';
import FireflyCanvas from '../components/landing/FireflyCanvas';

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="relative w-full h-screen overflow-hidden flex items-center justify-center"
      style={{ background: '#08081a' }}>
      <FireflyCanvas />

      <div className="relative z-10 flex flex-col items-center text-center px-8 select-none">
        <motion.div
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          className="mb-2"
        >
          <span className="text-xs tracking-[0.5em] uppercase"
            style={{ color: 'rgba(212,175,55,0.5)', fontFamily: 'Georgia, serif' }}>
            随笔 · 诗心 · 英文
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.4, delay: 0.3, ease: 'easeOut' }}
          className="title-breathe shimmer-text"
          style={{
            fontSize: 'clamp(5rem, 15vw, 10rem)',
            fontFamily: '"Noto Serif SC", "Source Han Serif CN", Georgia, serif',
            fontWeight: 700,
            letterSpacing: '0.15em',
            lineHeight: 1,
            marginBottom: '0.2em',
            display: 'flex',
            alignItems: 'center',
            gap: '0.05em',
          }}
        >
          <span>萤</span>
          {/* 火字：左边撇点换成 Flame 图标，右侧笔划保留 */}
          <span style={{ position: 'relative', display: 'inline-block' }}>
            {/* 原字保留，仅在左下撇位置覆盖 */}
            <span>火</span>
            {/* 盖住左下撇 */}
            <span
              aria-hidden
              style={{
                position: 'absolute',
                bottom: '4%',
                left: '-4%',
                width: '36%',
                height: '52%',
                background: '#08081a',
                transform: 'rotate(12deg)',
                zIndex: 1,
              }}
            />
            {/* Flame 图标替换左撇 */}
            <motion.span
              aria-hidden
              animate={{
                filter: [
                  'drop-shadow(0 0 4px rgba(212,175,55,0.5))',
                  'drop-shadow(0 0 14px rgba(212,175,55,0.9))',
                  'drop-shadow(0 0 4px rgba(212,175,55,0.5))',
                ],
              }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                position: 'absolute',
                bottom: '2%',
                left: '-3%',
                width: '32%',
                display: 'flex',
                alignItems: 'flex-end',
                zIndex: 2,
                color: '#d4af37',
              }}
            >
              <Flame style={{ width: '100%', height: 'auto' }} />
            </motion.span>
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.8 }}
          style={{
            color: 'rgba(232, 220, 200, 0.55)',
            fontFamily: 'Georgia, "Noto Serif SC", serif',
            fontSize: '1.05rem',
            letterSpacing: '0.3em',
            marginBottom: '3.5rem',
            fontStyle: 'italic',
          }}
        >
          随笔成诗，萤火相伴
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 1.2 }}
        >
          <motion.button
            onClick={() => navigate('/notebook')}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.97 }}
            className="relative group overflow-hidden px-12 py-4 rounded-full"
            style={{
              border: '1px solid rgba(212,175,55,0.5)',
              background: 'rgba(212,175,55,0.06)',
              color: '#d4af37',
              fontFamily: 'Georgia, "Noto Serif SC", serif',
              fontSize: '1rem',
              letterSpacing: '0.35em',
              cursor: 'pointer',
              backdropFilter: 'blur(8px)',
            }}
          >
            <motion.span
              className="absolute inset-0 rounded-full"
              initial={{ opacity: 0 }}
              whileHover={{ opacity: 1 }}
              style={{
                background: 'radial-gradient(ellipse at center, rgba(212,175,55,0.15) 0%, transparent 70%)',
              }}
            />
            <span className="relative z-10">开始 Ode 之旅</span>
          </motion.button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 2 }}
          className="absolute bottom-10 flex flex-col items-center gap-2"
          style={{ color: 'rgba(212,175,55,0.25)', fontSize: '0.7rem', letterSpacing: '0.2em' }}
        >
          <motion.div
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          >
            ↓
          </motion.div>
        </motion.div>
      </div>

      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 50%, transparent 30%, rgba(8,8,26,0.7) 100%)',
        }}
      />
    </div>
  );
}
