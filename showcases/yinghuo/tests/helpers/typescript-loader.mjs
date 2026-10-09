/** Compile a small local TypeScript import graph for Node tests without a browser or production data. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function compileTestModules(entries) {
  const localRoot = path.join(projectRoot, '.local');
  await fs.mkdir(localRoot, { recursive: true });
  const outputRoot = await fs.mkdtemp(path.join(localRoot, 'frontend-tests-'));
  await fs.writeFile(path.join(outputRoot, 'package.json'), '{"type":"module"}\n');
  const visited = new Set();

  async function compile(sourcePath) {
    if (visited.has(sourcePath)) return;
    visited.add(sourcePath);
    const relative = path.relative(projectRoot, sourcePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Test compiler source escaped project.');
    const source = await fs.readFile(sourcePath, 'utf8');
    if (sourcePath.endsWith('.json')) {
      const output = path.join(outputRoot, relative.replace(/\.json$/, '.js'));
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, `export default ${JSON.stringify(JSON.parse(source))};\n`);
      return;
    }
    const imports = ts.preProcessFile(source).importedFiles.map(item => item.fileName).filter(specifier => specifier.startsWith('.'));
    let compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    for (const specifier of new Set(imports)) {
      const base = path.resolve(path.dirname(sourcePath), specifier);
      const candidates = /\.(ts|tsx|json)$/.test(base) ? [base] : [base + '.ts', base + '.tsx', path.join(base, 'index.ts')];
      let dependency;
      for (const candidate of candidates) {
        try { if ((await fs.stat(candidate)).isFile()) { dependency = candidate; break; } } catch { /* Try the next source suffix. */ }
      }
      if (!dependency) throw new Error(`Cannot resolve ${specifier} from ${relative}`);
      await compile(dependency);
      let outputSpecifier = path.relative(path.dirname(sourcePath), dependency).replaceAll('\\', '/').replace(/\.(tsx?|json)$/, '.js');
      if (!outputSpecifier.startsWith('.')) outputSpecifier = './' + outputSpecifier;
      compiled = compiled.replaceAll(`'${specifier}'`, `'${outputSpecifier}'`).replaceAll(`"${specifier}"`, `"${outputSpecifier}"`);
    }
    const output = path.join(outputRoot, relative.replace(/\.tsx?$/, '.js'));
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, compiled);
  }

  try {
    for (const entry of entries) await compile(path.resolve(projectRoot, entry));
  } catch (error) {
    await fs.rm(outputRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    import: entry => import(pathToFileURL(path.join(outputRoot, entry.replace(/\.tsx?$/, '.js'))).href),
    cleanup: async () => {
      const relative = path.relative(localRoot, outputRoot);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(outputRoot).startsWith('frontend-tests-')) throw new Error('Unsafe test cleanup path.');
      await fs.rm(outputRoot, { recursive: true, force: true });
    },
  };
}
