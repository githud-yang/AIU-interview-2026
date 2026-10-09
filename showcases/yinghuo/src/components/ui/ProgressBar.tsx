/** 日记篇数等级的进度展示组件。 */
import { motion } from 'framer-motion';

interface ProgressBarProps {
  percentage: number;
  label?: string;
  height?: number;
}

export default function ProgressBar({ percentage, label, height = 4 }: ProgressBarProps) {
  return (
    <div className="w-full">
      {label && (
        <div className="flex justify-between mb-1"
          style={{ color: 'var(--yh-ink-050)', fontSize: 'var(--yh-font-065)', letterSpacing: '0.1em' }}>
          <span>{label}</span>
          <span>{Math.round(percentage)}%</span>
        </div>
      )}
      <div
        className="w-full rounded-full overflow-hidden"
        style={{ height, background: 'var(--yh-tint-010)' }}
      >
        <motion.div
          className="h-full rounded-full"
          style={{
            background: 'linear-gradient(90deg, var(--yh-tint-060) 0%, var(--yh-tint-100) 100%)',
            boxShadow: '0 0 8px var(--yh-tint-050)',
          }}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}
