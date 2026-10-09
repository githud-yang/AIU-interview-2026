/** 组装主题状态；切换仅更新样式，不重载路由、编辑器或模型任务。 */
import { useState, type ReactNode } from 'react';
import { currentTheme, selectTheme } from '../../services/theme';
import { ThemeContext } from './theme-context';

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState(currentTheme);

  function toggleTheme() {
    const next = theme === 'day' ? 'night' : 'day';
    selectTheme(next);
    setTheme(next);
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}
