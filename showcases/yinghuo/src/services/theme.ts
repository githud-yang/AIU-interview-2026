/** 管理界面主题偏好；展示链接只覆盖本次打开，不改随笔或个人默认主题。 */
export type Theme = 'day' | 'night';
export const THEME_STORAGE_KEY = 'yinghuo-ui-theme';

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;
type ThemeRoot = Pick<HTMLElement, 'dataset' | 'style'>;

function isTheme(value: unknown): value is Theme {
  return value === 'day' || value === 'night';
}

export function resolveTheme(search: string, storage?: Pick<ThemeStorage, 'getItem'>): Theme {
  const preview = new URLSearchParams(search).get('theme');
  if (isTheme(preview)) return preview;
  try {
    const saved = storage?.getItem(THEME_STORAGE_KEY);
    if (isTheme(saved)) return saved;
  } catch {
    // 存储不可用时仍可使用并切换主题。
  }
  return 'night';
}

export function applyTheme(theme: Theme, root: ThemeRoot): void {
  root.dataset.theme = theme;
  root.style.colorScheme = theme === 'day' ? 'light' : 'dark';
}

export function rememberTheme(theme: Theme, storage?: Pick<ThemeStorage, 'setItem'>): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 禁用本地存储不阻塞本页主题切换。
  }
}

function browserStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

export function initializeTheme(): Theme {
  const theme = resolveTheme(window.location.search, browserStorage());
  applyTheme(theme, document.documentElement);
  return theme;
}

export function currentTheme(): Theme {
  const theme = document.documentElement.dataset.theme;
  return isTheme(theme) ? theme : initializeTheme();
}

export function selectTheme(theme: Theme): void {
  applyTheme(theme, document.documentElement);
  rememberTheme(theme, browserStorage());
}
