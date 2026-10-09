
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HistoryStore } = require('C:/Users/Administrator/.codex/visualizations/2026/10/06/01a11097-f93f-7d23-abfc-1821949e5c23/hist-test/tasks/history.js');

function entry(over = {}) {
  return {
    id: over.id ?? 'h1', jobId: 'j1', canvasId: 'default', nodeId: 'n1',
    actionId: 'web2api:x', title: 't', kind: over.kind || 'image',
    status: over.status || 'done', rating: 'passed',
    createdAt: 1000, finishedAt: over.finishedAt || 2000,
    ...over,
  };
}

async function main() {
  let passed = 0;
  const t = async (name, fn) => { try { await fn(); passed++; console.log('ok -', name); } catch (e) { console.error('FAIL -', name); console.error(e && e.message || e); process.exitCode = 1; } };

  await t('按类型筛：items/total 跟着筛；byKind 给全量分布', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hist-'));
    const h = new HistoryStore(root);
    await h.append('default', entry({ id: 'i1', kind: 'image', finishedAt: 100 }));
    await h.append('default', entry({ id: 'v1', kind: 'video', finishedAt: 200 }));
    await h.append('default', entry({ id: 'a1', kind: 'audio', finishedAt: 300 }));
    await h.append('default', entry({ id: 'e1', kind: 'image', status: 'error', finishedAt: 400 }));
    const r = await h.query({ kind: 'image' });
    assert.deepStrictEqual(r.items.map(e => e.id).sort(), ['e1', 'i1']);
    assert.deepStrictEqual(r.summary.byKind, { image: 2, video: 1, audio: 1 });
    assert.strictEqual(r.summary.total, 2);
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  await t('分页 + 汇总不受分页影响', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hist-'));
    const h = new HistoryStore(root);
    await h.append('default', entry({ id: 'i1', kind: 'image', finishedAt: 100 }));
    await h.append('default', entry({ id: 'v1', kind: 'video', finishedAt: 200 }));
    await h.append('default', entry({ id: 'a1', kind: 'audio', finishedAt: 300 }));
    await h.append('default', entry({ id: 'e1', kind: 'image', status: 'error', finishedAt: 400 }));
    const r = await h.query({ page: 1, pageSize: 2 });
    assert.strictEqual(r.items.length, 2);
    assert.strictEqual(r.total, 4);
    assert.strictEqual(r.summary.total, 4);
    assert.deepStrictEqual(r.summary.byKind, { image: 2, video: 1, audio: 1 });
    const r2 = await h.query({ page: 2, pageSize: 2 });
    assert.strictEqual(r2.items.length, 2);
    assert.strictEqual(r2.total, 4);
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  await t('跨画布合并（不筛 canvasId）', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hist-'));
    const h = new HistoryStore(root);
    await h.append('a', entry({ id: 'a-1', canvasId: 'a', finishedAt: 100 }));
    await h.append('b', entry({ id: 'b-1', canvasId: 'b', finishedAt: 200 }));
    const r = await h.query({});
    assert.deepStrictEqual(r.items.map(e => e.id), ['b-1', 'a-1']);
    assert.strictEqual(r.total, 2);
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  await t('筛某个画布', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hist-'));
    const h = new HistoryStore(root);
    await h.append('a', entry({ id: 'a-1', canvasId: 'a' }));
    await h.append('b', entry({ id: 'b-1', canvasId: 'b' }));
    const r = await h.query({ canvasId: 'a' });
    assert.deepStrictEqual(r.items.map(e => e.id), ['a-1']);
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  console.log('total passed:', passed);
}

main().catch(e => { console.error(e); process.exit(1); });

