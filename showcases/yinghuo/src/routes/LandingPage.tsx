/** 首页展示产品入口与萤火背景，不调用 AI 或读取私人日记。 */
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Flame } from 'lucide-react';
import FireflyCanvas from '../components/landing/FireflyCanvas';
import ThemeToggle from '../components/ui/ThemeToggle';

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="relative w-full h-screen overflow-hidden flex items-center justify-center"
      style={{ background: 'var(--yh-bg)' }}>
      <FireflyCanvas />
      <div className="absolute right-6 top-6 z-20">
        <ThemeToggle />
      </div>

      <div className="relative z-10 flex flex-col items-center text-center px-8 select-none">
        <motion.div
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          className="mb-2"
        >
          <span className="text-xs tracking-[0.5em] uppercase"
            style={{ color: 'var(--yh-ink-050)', fontFamily: 'Georgia, serif' }}>
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
                background: 'var(--yh-bg)',
                transform: 'rotate(12deg)',
                zIndex: 1,
              }}
            />
            {/* Flame 图标替换左撇 */}
            <motion.span
              aria-hidden
              className="landing-flame"
              animate={{
                filter: [
                  'drop-shadow(0 0 4px var(--yh-tint-050))',
                  'drop-shadow(0 0 14px var(--yh-tint-090))',
                  'drop-shadow(0 0 4px var(--yh-tint-050))',
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
                color: 'var(--yh-accent)',
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
            color: 'var(--yh-text-055)',
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
              border: '1px solid var(--yh-line-050)',
              background: 'var(--yh-tint-006)',
              color: 'var(--yh-accent)',
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
                background: 'radial-gradient(ellipse at center, var(--yh-tint-015) 0%, transparent 70%)',
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
          style={{ color: 'var(--yh-ink-025)', fontSize: 'var(--yh-font-07)', letterSpacing: '0.2em' }}
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
          background: 'radial-gradient(ellipse at 50% 50%, transparent 30%, var(--yh-vignette) 100%)',
        }}
      />
    </div>
  );
}
