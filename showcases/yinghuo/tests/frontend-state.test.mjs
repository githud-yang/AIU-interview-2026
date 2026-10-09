/** Verify demo isolation and real Dexie state races using an in-memory IndexedDB, never a browser's personal database. */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { compileTestModules } from './helpers/typescript-loader.mjs';

const build = await compileTestModules(['src/services/demoData.ts', 'src/stores/useNoteStore.ts']);
const { db } = await build.import('src/db/database.ts');
const { createDemoRecords, importDemoCollection, DEMO_PROJECT_ID } = await build.import('src/services/demoData.ts');
const { useNoteStore } = await build.import('src/stores/useNoteStore.ts');

const note = (id, projectId, content = '<p>Original text</p>') => ({ id, projectId, content, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') });
const sentence = (id, noteId, source = 'manual') => ({ id, noteId, source, original: 'Original text', english: 'Original text', vocabulary: [], grammarAnalysis: 'Example', advancedRewrite: 'Example rewrite', scenarios: ['Example'] });

test('frontend persistence and fictional demonstration', async t => {
  try {
    await t.test('demo imports 50 fictional notes once and preserves personal and edited demo data', async () => {
      await db.projects.add({ id: 'personal', name: 'Personal', createdAt: new Date() });
      await db.notes.add(note('personal-note', 'personal', '<p>Private synthetic fixture</p>'));
      const personalBefore = await db.notes.get('personal-note');
      const savedFetch = globalThis.fetch;
      let fetchCount = 0;
      globalThis.fetch = async () => { fetchCount++; throw new Error('Demo must never call a network service.'); };
      try {
        await importDemoCollection();
        const demoId = `${DEMO_PROJECT_ID}-note-01`;
        await db.notes.update(demoId, { content: '<p>Edited demonstration</p>' });
        await importDemoCollection();
        assert.equal(await db.projects.count(), 2);
        assert.equal(await db.notes.where('projectId').equals(DEMO_PROJECT_ID).count(), 50);
        assert.deepEqual(await db.notes.get('personal-note'), personalBefore);
        assert.equal((await db.notes.get(demoId)).content, '<p>Edited demonstration</p>');
        assert.equal(fetchCount, 0);
        for (const demoNote of createDemoRecords().notes) {
          assert.match(demoNote.title, /虚构示例/);
          assert.match(demoNote.translation, /未调用 AI/);
          assert.ok(demoNote.content.includes(demoNote.goldenSentences[0].original));
          assert.ok(demoNote.goldenSentences[0].english.toLowerCase().includes(demoNote.goldenSentences[0].vocabulary[0].word.toLowerCase()));
        }
      } finally { globalThis.fetch = savedFetch; }
    });

    await t.test('slow earlier collection loads cannot replace the currently selected collection', async () => {
      await db.projects.bulkAdd([{ id: 'a', name: 'A', createdAt: new Date() }, { id: 'b', name: 'B', createdAt: new Date() }]);
      await db.notes.bulkAdd([note('a-note', 'a'), note('b-note', 'b')]);
      const originalWhere = db.notes.where;
      let release;
      let observed;
      const started = new Promise(resolve => { observed = resolve; });
      db.notes.where = function (...args) {
        const clause = originalWhere.apply(this, args);
        const equals = clause.equals.bind(clause);
        clause.equals = value => {
          const collection = equals(value);
          if (value === 'a') {
            const sortBy = collection.sortBy.bind(collection);
            collection.sortBy = async (...sortArgs) => {
              const rows = await sortBy(...sortArgs);
              observed();
              await new Promise(resolve => { release = resolve; });
              return rows;
            };
          }
          return collection;
        };
        return clause;
      };
      try {
        useNoteStore.setState({ activeProjectId: 'a', notes: [] });
        const previousLoad = useNoteStore.getState().loadNotes('a');
        await started;
        useNoteStore.setState({ activeProjectId: 'b', notes: [] });
        await useNoteStore.getState().loadNotes('b');
        release();
        await previousLoad;
        assert.deepEqual(useNoteStore.getState().notes.map(row => row.id), ['b-note']);
      } finally { db.notes.where = originalWhere; }
    });

    await t.test('background analysis preserves manual marks from persisted note and leaves other collection untouched', async () => {
      const manual = sentence('a-manual', 'a-note');
      await db.notes.update('a-note', { goldenSentences: [manual] });
      useNoteStore.setState({ activeProjectId: 'b', notes: [await db.notes.get('b-note')] });
      const currentBefore = useNoteStore.getState().notes;
      await useNoteStore.getState().saveNoteAnalysis('a-note', 'Translated', [sentence('a-auto', 'a-note', 'auto')], '<p>Original text</p>');
      assert.deepEqual((await db.notes.get('a-note')).goldenSentences.map(row => row.id), ['a-auto', 'a-manual']);
      assert.deepEqual(useNoteStore.getState().notes, currentBefore);
      await db.notes.update('a-note', { content: '<p>New revision</p>' });
      await assert.rejects(useNoteStore.getState().saveNoteAnalysis('a-note', 'Stale translation', [], '<p>Original text</p>'), /正文已更新/);
      assert.equal((await db.notes.get('a-note')).translation, 'Translated');
    });

    await t.test('concurrent golden sentence changes use one database transaction per mutation', async () => {
      await Promise.all([
        useNoteStore.getState().addManualGoldenSentence('a-note', sentence('a-mark-one', 'a-note')),
        useNoteStore.getState().addManualGoldenSentence('a-note', sentence('a-mark-two', 'a-note')),
      ]);
      const ids = (await db.notes.get('a-note')).goldenSentences.map(row => row.id);
      assert.ok(ids.includes('a-mark-one'));
      assert.ok(ids.includes('a-mark-two'));
    });

    await t.test('messages for another collection persist without entering the visible chat', async () => {
      useNoteStore.setState({ activeProjectId: 'b', chatMessages: [] });
      await useNoteStore.getState().addChatMessage('a', 'agent', 'Background fixture reply');
      assert.equal(await db.chatMessages.where('projectId').equals('a').count(), 1);
      assert.equal(useNoteStore.getState().chatMessages.length, 0);
    });

    await t.test('failed drafts retry by note id and a newer successful save replaces the old failed draft', async () => {
      useNoteStore.getState().rememberFailedDraft('a-note', { content: '<p>Recovered draft</p>', title: 'Recovered title' });
      await useNoteStore.getState().retryFailedDrafts();
      assert.equal((await db.notes.get('a-note')).content, '<p>Recovered draft</p>');
      assert.equal((await db.notes.get('a-note')).title, 'Recovered title');
      useNoteStore.getState().rememberFailedDraft('a-note', { content: '<p>Old failed draft</p>' });
      await useNoteStore.getState().updateNote('a-note', '<p>New successful edit</p>');
      await useNoteStore.getState().retryFailedDrafts();
      assert.equal((await db.notes.get('a-note')).content, '<p>New successful edit</p>');
      assert.ok(!Object.values(useNoteStore.getState().failedDrafts).some(draft => draft.content !== undefined || draft.title !== undefined));
    });
  } finally {
    db.close();
    await db.delete();
    await build.cleanup();
  }
});
