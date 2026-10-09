// 验证任务订阅的生命周期、容量和重放语义，不调用实际模型。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobRegistry } from '../server/jobs.mjs';
import { ServiceError } from '../server/ai/errors.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function terminal(registry, id) {
  return new Promise(resolve => {
    let unsubscribe = () => {};
    unsubscribe = registry.subscribe(id, state => {
      if (state.status !== 'running') { resolve(state); unsubscribe(); }
    });
  });
}

test('invalid commands fail before the registry starts model work', () => {
  let calls = 0;
  const registry = createJobRegistry({ prepare: () => { throw new ServiceError('invalid input'); }, execute: () => { calls++; } });
  assert.throws(() => registry.create('unknown', {}), ServiceError);
  assert.equal(registry.hasRunning(), false);
  assert.equal(calls, 0);
  registry.close();
});

test('capacity does not evict running work, and a completed task remains replayable until a new command needs room', async () => {
  const work = deferred();
  let calls = 0;
  const registry = createJobRegistry({ execute: async () => { calls++; return work.promise; } }, { maxRetained: 1 });
  const job = registry.create('demo', {});
  assert.throws(() => registry.create('other', {}), error => error.status === 503);
  const done = terminal(registry, job.id);
  work.resolve({ value: 1 });
  assert.deepEqual((await done).result, { value: 1 });
  assert.equal(registry.hasRunning(), false);
  const replays = [];
  registry.subscribe(job.id, state => replays.push(state))();
  assert.equal(replays.length, 1);
  assert.equal(replays[0].status, 'completed');
  assert.equal(calls, 1);
  const replacement = registry.create('second', {});
  assert.notEqual(replacement.id, job.id);
  assert.throws(() => registry.subscribe(job.id, () => {}), error => error.status === 404);
  await terminal(registry, replacement.id);
  registry.close();
});

test('disconnecting a subscriber stops delivery without restarting or cancelling shared work', async () => {
  const work = deferred();
  let calls = 0;
  const registry = createJobRegistry({ execute: async () => { calls++; return work.promise; } });
  const job = registry.create('demo', {});
  const first = [];
  const unsubscribe = registry.subscribe(job.id, value => first.push(value));
  assert.equal(first.length, 1);
  unsubscribe();
  const done = terminal(registry, job.id);
  work.resolve({ value: 2 });
  await done;
  assert.equal(first.length, 1);
  assert.equal(calls, 1);
  registry.close();
  assert.throws(() => registry.subscribe(job.id, () => {}), error => error.status === 404);
});
