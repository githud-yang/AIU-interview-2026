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
          style={{ color: 'rgba(212,175,55,0.5)', fontSize: '0.65rem', letterSpacing: '0.1em' }}>
          <span>{label}</span>
          <span>{Math.round(percentage)}%</span>
        </div>
      )}
      <div
        className="w-full rounded-full overflow-hidden"
        style={{ height, background: 'rgba(212,175,55,0.1)' }}
      >
        <motion.div
          className="h-full rounded-full"
          style={{
            background: 'linear-gradient(90deg, rgba(212,175,55,0.6) 0%, rgba(212,175,55,1) 100%)',
            boxShadow: '0 0 8px rgba(212,175,55,0.5)',
          }}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}
