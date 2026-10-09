/** 提供主题订阅，供按钮和需要真实颜色的画布使用。 */
import { createContext, useContext } from 'react';
import type { Theme } from '../../services/theme';

export const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void } | null>(null);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('主题组件需要放在 ThemeProvider 中');
  return context;
}
