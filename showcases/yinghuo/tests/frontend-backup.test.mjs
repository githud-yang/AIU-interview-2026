// 检查备份输入及旧版本兼容，不读写浏览器个人数据。
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTestModules } from './helpers/typescript-loader.mjs';

test('backup input validation preserves valid v1/v2 data and rejects malformed records before import', async t => {
  const compiled = await compileTestModules(['src/services/backup.ts', 'src/services/demoData.ts']);
  t.after(compiled.cleanup);
  const { parseBackupJson } = await compiled.import('src/services/backup.ts');
  const { createDemoRecords } = await compiled.import('src/services/demoData.ts');
  const { project, notes } = createDemoRecords();
  const payload = { app: 'yinghuo', version: 2, exportedAt: new Date().toISOString(), projects: [project], notes, chatMessages: [] };
  const copy = () => JSON.parse(JSON.stringify(payload));
  assert.equal(parseBackupJson(JSON.stringify(payload)).notes.length, 50);
  assert.ok(parseBackupJson(JSON.stringify({ ...payload, version: 1 })).notes[0].createdAt instanceof Date);
  for (const invalid of [null, [], { ...payload, version: 0 }, { ...payload, version: 3 }]) assert.throws(() => parseBackupJson(JSON.stringify(invalid)));
  for (const mutate of [
    value => { value.notes[0].content = {}; },
    value => { value.notes[0].createdAt = 'invalid date'; },
    value => { value.notes[0].projectId = 'missing'; },
    value => { value.notes[0].goldenSentences[0].noteId = 'wrong note'; },
    value => { value.notes[0].goldenSentences[0].vocabulary = [null]; },
    value => { value.projects[0].agentProfile.traits = {}; },
    value => { value.notes.push(value.notes[0]); },
    value => { value.vocabKnowledge = {}; },
  ]) { const value = copy(); mutate(value); assert.throws(() => parseBackupJson(JSON.stringify(value)), /未导入任何数据/); }
});
