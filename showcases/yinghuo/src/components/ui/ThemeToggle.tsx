/** 在当前位置切换白天/夜间主题，并显示当前模式。 */
import { Moon, Sun } from 'lucide-react';
import { useTheme } from './theme-context';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === 'day' ? '切换到夜间模式' : '切换到白天模式';
  const Icon = theme === 'day' ? Sun : Moon;

  return (
    <button className="theme-toggle" type="button" onClick={toggleTheme} title={label} aria-label={label}>
      <Icon size={16} aria-hidden="true" />
      <span>{theme === 'day' ? '白天模式' : '夜间模式'}</span>
    </button>
  );
}
