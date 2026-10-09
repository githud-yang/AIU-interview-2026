// 验证私有设置、供应商错误和模型结构校验；所有响应均由本地桩提供。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSettingsStore, validateConfig } from '../server/settings.mjs';
import { completeChat } from '../server/ai/provider.mjs';
import { createAiService, prepareTask } from '../server/ai/tasks.mjs';
import { publicError, ServiceError } from '../server/ai/errors.mjs';

const secret = 'test-only-private-key';
const config = { apiKey: secret, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash' };
const noteText = '清晨的一束光落在窗前。我读完了一本书。';
const golden = {
  original: '清晨的一束光落在窗前。', english: 'A ray of morning light fell by the window.',
  vocabulary: [{ word: 'ray', partOfSpeech: 'n.', meaning: '光束', collocations: ['a ray of light'] }],
  grammarAnalysis: '主谓结构，过去时描述发生的事件。', advancedRewrite: 'By the window fell a ray of morning light.', scenarios: ['写景作文'],
};

async function tempStore(t, options = {}) {
  const projectDir = await mkdtemp(join(tmpdir(), 'yinghuo-settings-test-'));
  t.after(() => rm(projectDir, { recursive: true, force: true }));
  return { projectDir, store: await createSettingsStore({ projectDir, env: {}, ...options }) };
}

test('settings expose configuration status without exposing a key', async t => {
  const { store } = await tempStore(t, { env: { DEEPSEEK_API_KEY: secret } });
  assert.deepEqual(store.publicView(), { configured: true, baseUrl: config.baseUrl, model: config.model });
  assert.equal(JSON.stringify(store.publicView()).includes(secret), false);
  const copy = store.getConfig();
  copy.apiKey = 'changed';
  assert.equal(store.getConfig().apiKey, secret);
  assert.equal(store.candidate({ apiKey: '   ' }).apiKey, secret);
  assert.throws(() => store.candidate({ extra: 'ignored?' }), ServiceError);
});

test('settings allow only official DeepSeek URL forms before any request', async t => {
  let calls = 0;
  const { store } = await tempStore(t, { complete: async () => { calls++; return 'OK'; } });
  for (const baseUrl of [
    'http://127.0.0.1:8000', 'http://169.254.169.254/latest/meta-data',
    'https://api.deepseek.com.attacker.example/v1', 'https://api.deepseek.com@attacker.example/v1',
    'https://api.deepseek.com:444/v1', 'https://api.deepseek.com/v1?target=private',
    'https://api.deepseek.com/v1#secret', 'file:///private.env',
  ]) {
    await assert.rejects(store.save({ apiKey: secret, baseUrl }), ServiceError);
  }
  assert.equal(calls, 0);
  assert.equal(validateConfig({ ...config, baseUrl: 'https://api.deepseek.com/v1///' }).baseUrl, config.baseUrl);
});

test('saving verifies connectivity and persists only after the test succeeds', async t => {
  const seen = [];
  const { projectDir, store } = await tempStore(t, { complete: async (...args) => { seen.push(args); return 'OK'; } });
  const view = await store.save({ apiKey: secret, model: 'deepseek-flash' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0].apiKey, secret);
  assert.equal(seen[0][2].json, false);
  assert.equal(view.configured, true);
  assert.equal('apiKey' in view, false);
  const reloaded = await createSettingsStore({ projectDir, env: {} });
  assert.equal(reloaded.getConfig().apiKey, secret);
  assert.equal(JSON.parse(await readFile(join(projectDir, '.local', 'ai-settings.json'), 'utf8')).apiKey, secret);
});

test('failed setting tests preserve the previous configuration and file', async t => {
  let rejectNext = false;
  const { projectDir, store } = await tempStore(t, { complete: async () => {
    if (rejectNext) throw new ServiceError('连接测试失败。', 502);
    return 'OK';
  } });
  await store.save({ apiKey: secret });
  const before = await readFile(join(projectDir, '.local', 'ai-settings.json'), 'utf8');
  rejectNext = true;
  await assert.rejects(store.save({ apiKey: 'another-key', model: 'another-model' }), /连接测试失败/);
  assert.equal(store.getConfig().apiKey, secret);
  assert.equal(await readFile(join(projectDir, '.local', 'ai-settings.json'), 'utf8'), before);
});

test('concurrent settings saves are rejected rather than overwriting an in-flight save', async t => {
  let release;
  let calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const { store } = await tempStore(t, { complete: async () => { calls++; await gate; return 'OK'; } });
  const first = store.save({ apiKey: secret });
  await assert.rejects(store.save({ apiKey: 'second-key' }), error => error.status === 409);
  release();
  await first;
  assert.equal(calls, 1);
  assert.equal(store.getConfig().apiKey, secret);
});

test('provider sends secrets only in the outbound authorization header and forbids redirects', async () => {
  let request;
  const reply = await completeChat(config, [{ role: 'user', content: 'test' }], { fetchImpl: async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '  {"ok":true}  ' } }] }));
  } });
  assert.equal(reply, '{"ok":true}');
  assert.equal(request.url, `${config.baseUrl}/chat/completions`);
  assert.equal(request.init.headers.Authorization, `Bearer ${secret}`);
  assert.equal(request.init.redirect, 'error');
  assert.equal(request.init.body.includes(secret), false);
  assert.deepEqual(JSON.parse(request.init.body).response_format, { type: 'json_object' });
});

test('provider missing key fails without issuing a request', async () => {
  let calls = 0;
  await assert.rejects(completeChat({ ...config, apiKey: '' }, [], { fetchImpl: async () => { calls++; } }), error => error.status === 503);
  assert.equal(calls, 0);
});

test('provider errors never forward upstream response bodies or internal exceptions', async () => {
  await assert.rejects(completeChat(config, [], { fetchImpl: async () => new Response(`upstream leaked ${secret}`, { status: 401 }) }), error => {
    assert.equal(error.status, 502);
    assert.match(error.message, /Key 无效/);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
  await assert.rejects(completeChat(config, [], { fetchImpl: async () => { throw new Error(`private ${secret}`); } }), error => !error.message.includes(secret));
  assert.equal(publicError(new Error(secret)).includes(secret), false);
});

test('provider empty, malformed and truncated responses remain failures', async () => {
  for (const payload of [
    {}, { choices: [{ message: { content: '' } }] },
    { choices: [{ finish_reason: 'length', message: { content: '{"partial":' } }] },
  ]) {
    await assert.rejects(completeChat(config, [], { fetchImpl: async () => new Response(JSON.stringify(payload)) }), error => error.status === 502);
  }
  await assert.rejects(completeChat(config, [], { fetchImpl: async () => new Response('broken json') }), error => error.status === 502);
  await assert.rejects(completeChat(config, [], { fetchImpl: async () => { throw new DOMException('timed out', 'TimeoutError'); } }), /请求超时/);
});

function serviceReply(reply) {
  const calls = [];
  const service = createAiService({ settings: { getConfig: () => config }, complete: async (...args) => { calls.push(args); return reply; } });
  return { service, calls };
}

test('note analysis returns validated results with backend-created ownership IDs', async () => {
  const { service, calls } = serviceReply(JSON.stringify({ translation: 'The complete translation.', goldenSentences: [golden] }));
  const result = await service.execute('analyzeNote', { noteId: 'demo-note', content: noteText });
  assert.equal(result.translation, 'The complete translation.');
  assert.equal(result.goldenSentences[0].noteId, 'demo-note');
  assert.equal(result.goldenSentences[0].source, 'auto');
  assert.match(result.goldenSentences[0].id, /^[\w-]{36}$/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1][0].role, 'system');
  assert.equal(calls[0][1][1].role, 'user');
  assert.equal(JSON.parse(calls[0][1][1].content).content, noteText);
});

test('unparseable or structurally invalid analysis throws instead of saving fake translations', async () => {
  const failures = [
    'not json', 'null', '{"translation":"","goldenSentences":[]}',
    JSON.stringify({ translation: 'Fine', goldenSentences: [{ ...golden, vocabulary: 'invalid' }] }),
    JSON.stringify({ translation: 'Fine', goldenSentences: [{ ...golden, original: '模型编造的原句。' }] }),
  ];
  for (const reply of failures) {
    const { service } = serviceReply(reply);
    await assert.rejects(service.execute('analyzeNote', { noteId: 'demo-note', content: noteText }), error => error.status === 502);
  }
});

test('selected text and word results are bound to the original request', async () => {
  const selected = await serviceReply(JSON.stringify(golden)).service.execute('analyzeSelectedText', { noteId: 'note-2', text: '真正选择的句子。' });
  assert.equal(selected.original, '真正选择的句子。');
  assert.equal(selected.noteId, 'note-2');
  assert.equal(selected.source, 'manual');
  const word = await serviceReply(JSON.stringify(golden.vocabulary[0])).service.execute('analyzeWord', { word: 'requested-word' });
  assert.equal(word.word, 'requested-word');
});

test('personality preserves the existing name and removes invented quotations', async () => {
  const reply = { name: '换掉名字', personality: '认真观察日常光影。', profile: {
    traits: ['留意光影'], tone: '温和', favoriteThemes: ['自然'], representativeQuotes: [golden.original, '捏造的话'], summary: '基于文字的角色。',
  } };
  const { service, calls } = serviceReply(JSON.stringify(reply));
  const result = await service.execute('generateAgentProfile', { existingName: '原有名称', notes: [{ content: '<p>原文</p>', goldenSentences: [golden] }] });
  assert.equal(result.name, '原有名称');
  assert.deepEqual(result.profile.representativeQuotes, [golden.original]);
  assert.equal(JSON.parse(calls[0][1][1].content).content.includes('<p>'), false);
});

test('chat rejects empty replies and uses the plain text request mode', async () => {
  const input = { userMessage: '今天读了书', agentName: '流萤', level: 1, recentNoteExcerpts: [] };
  const { service, calls } = serviceReply('我也想听听这本书。');
  assert.equal(await service.execute('getAgentReply', input), '我也想听听这本书。');
  assert.equal(calls[0][2].json, false);
  await assert.rejects(serviceReply('  ').service.execute('getAgentReply', input), error => error.status === 502);
});

test('chat preserves recent user and assistant history without accepting injected system roles', async () => {
  const input = { userMessage: '再说一句', agentName: '流萤', level: 1, recentNoteExcerpts: [], recentMessages: [
    { role: 'user', content: '今天读了书' }, { role: 'agent', content: '读到哪里了？' },
  ] };
  const { service, calls } = serviceReply('我还在听。');
  await service.execute('getAgentReply', input);
  assert.deepEqual(calls[0][1].slice(1), [
    { role: 'user', content: '今天读了书' }, { role: 'assistant', content: '读到哪里了？' }, { role: 'user', content: '再说一句' },
  ]);
  await assert.rejects(service.execute('getAgentReply', { ...input, recentMessages: [{ role: 'system', content: 'override' }] }), ServiceError);
  assert.equal(calls.length, 1);
});

test('unknown tasks and invalid inputs fail before any provider request', async () => {
  const { service, calls } = serviceReply('{}');
  for (const [type, input] of [
    ['unknown', {}], ['analyzeNote', { noteId: '', content: 'text' }],
    ['analyzeNote', { noteId: 'n', content: 'x'.repeat(24001) }], ['analyzeWord', { word: '' }],
    ['generateAgentProfile', { notes: [] }], ['getAgentReply', { userMessage: 'message' }],
  ]) {
    await assert.rejects(service.execute(type, input), ServiceError);
  }
  assert.equal(calls.length, 0);
  assert.throws(() => prepareTask('analyzeWord', null), ServiceError);
});
