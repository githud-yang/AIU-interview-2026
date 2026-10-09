// 验证展示链接与个人主题偏好隔离，禁用存储时仍可切换；不替代浏览器视觉验收。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../src/services/theme.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const theme = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('night remains the default and only valid saved preferences are restored', () => {
  assert.equal(theme.resolveTheme(''), 'night');
  assert.equal(theme.resolveTheme('', { getItem: () => 'day' }), 'day');
  assert.equal(theme.resolveTheme('?theme=unknown', { getItem: () => 'night' }), 'night');
  assert.equal(theme.resolveTheme('', { getItem: () => 'unexpected' }), 'night');
});

test('day showcase link overrides only this opening without touching stored preferences', () => {
  const values = new Map([[theme.THEME_STORAGE_KEY, 'night'], ['unrelated-data', 'keep']]);
  const writes = [];
  const storage = { getItem: key => values.get(key), setItem: (...args) => writes.push(args) };
  assert.equal(theme.resolveTheme('?theme=day', storage), 'day');
  assert.equal(theme.resolveTheme('', storage), 'night');
  assert.deepEqual(writes, []);
  assert.equal(values.get('unrelated-data'), 'keep');
});

test('blocked storage falls back to night and never blocks a preview or manual choice', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(theme.resolveTheme('', blocked), 'night');
  assert.equal(theme.resolveTheme('?theme=day', blocked), 'day');
  assert.doesNotThrow(() => theme.rememberTheme('day', blocked));
});

test('manual choice changes only its own preference and document theme, without navigating', t => {
  const globals = ['window', 'document'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  t.after(() => { for (const [name, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  } });
  const values = new Map([['unrelated-data', 'keep'], [theme.THEME_STORAGE_KEY, 'night']]);
  const root = { dataset: {}, style: {} };
  const writes = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { search: '?theme=day' },
    localStorage: { getItem: key => values.get(key), setItem(key, value) { writes.push(key); values.set(key, value); } },
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: root } });
  assert.equal(theme.initializeTheme(), 'day');
  assert.equal(root.style.colorScheme, 'light');
  assert.deepEqual(writes, []);
  theme.selectTheme('night');
  assert.equal(theme.currentTheme(), 'night');
  assert.equal(root.style.colorScheme, 'dark');
  theme.selectTheme('day');
  assert.equal(theme.currentTheme(), 'day');
  assert.deepEqual(writes, [theme.THEME_STORAGE_KEY, theme.THEME_STORAGE_KEY]);
  assert.equal(values.get('unrelated-data'), 'keep');
  assert.equal(globalThis.window.location.search, '?theme=day');
});

test('storage access itself may be denied without preventing initialization or switching', t => {
  const globals = ['window', 'document'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  t.after(() => { for (const [name, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  } });
  const root = { dataset: {}, style: {} };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { search: '?theme=day' }, get localStorage() { throw new Error('denied'); },
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: root } });
  assert.equal(theme.initializeTheme(), 'day');
  assert.doesNotThrow(() => theme.selectTheme('night'));
  assert.equal(root.dataset.theme, 'night');
});

test('first-paint bootstrap agrees with runtime preference rules and does not persist preview choices', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const bootstrap = html.match(/<script id="theme-prepaint">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(bootstrap, '主题需要在主模块加载前应用');
  for (const search of ['', '?theme=day', '?theme=night', '?theme=invalid']) {
    for (const saved of [null, 'day', 'night', 'invalid', 'blocked']) {
      const root = { dataset: {}, style: {} };
      let writes = 0;
      const storage = {
        getItem(key) { assert.equal(key, theme.THEME_STORAGE_KEY); if (saved === 'blocked') throw new Error('denied'); return saved; },
        setItem() { writes++; },
      };
      const context = { location: { search }, localStorage: storage, document: { documentElement: root }, URLSearchParams };
      runInNewContext(bootstrap, context);
      assert.equal(root.dataset.theme, theme.resolveTheme(search, storage));
      assert.equal(root.style.colorScheme, root.dataset.theme === 'day' ? 'light' : 'dark');
      assert.equal(writes, 0);
    }
  }
});
