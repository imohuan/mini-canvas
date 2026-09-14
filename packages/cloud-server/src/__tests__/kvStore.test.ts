/**
 * kvStore 单测 —— 纯逻辑（真实 fs，临时目录）。
 *
 * 锁的核心是 `get` 的"未命中 = undefined"语义：HttpAdapter 靠它判"从未保存过"，
 * 与客户端 `saved === undefined` 对齐。若这里返回 null，空画布刷新后会重新长 seed。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { KvStore, kvFileName, isKvType } from '../store/kvStore'

let dir: string
let store: KvStore

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kvstore-'));
  store = new KvStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('KvStore 基本读写', () => {
  it('未保存过 → get 返回 undefined（不是 null）', async () => {
    expect(await store.get('canvas', 'graph')).toBeUndefined();
  });

  it('set 后 get 读回同一份值；磁盘上确实有文件', async () => {
    const nodes = [{ id: '1', type: 'text' }]
    await store.set('canvas', 'graph', nodes);
    expect(await store.get('canvas', 'graph')).toEqual(nodes);
    const files = await fs.readdir(path.join(dir, 'kv'));
    expect(files).toContain('canvas%3Agraph.json');
  });

  it('保存空数组 → 读回 []（必须与"未保存过"区分开）', async () => {
    await store.set('canvas', 'graph', []);
    const got = await store.get('canvas', 'graph');
    expect(got).toEqual([]);
    expect(got).not.toBeUndefined();
  });

  it('remove 后回到 undefined，重复 remove 返回 false', async () => {
    await store.set('canvas', 'graph', [1]);
    expect(await store.remove('canvas', 'graph')).toBe(true);
    expect(await store.get('canvas', 'graph')).toBeUndefined();
    expect(await store.remove('canvas', 'graph')).toBe(false);
  });

  it('特殊字符 key 可安全落盘并读回', async () => {
    await store.set('config', 'theme/accent', '#fff');
    expect(await store.get('config', 'theme/accent')).toBe('#fff');
  });
});

describe('KvStore 作用域隔离与列举', () => {
  it('不同 type 互不干扰', async () => {
    await store.set('canvas', 'graph', ['c']);
    await store.set('config', 'graph', ['f']);
    expect(await store.get('canvas', 'graph')).toEqual(['c']);
    expect(await store.get('config', 'graph')).toEqual(['f']);
  });

  it('keys 只列该作用域、去掉前缀，且不含临时文件', async () => {
    await store.set('canvas', 'graph', 1);
    await store.set('canvas', 'graph-edges', 2);
    await store.set('config', 'x', 3);
    expect(await store.keys('canvas')).toEqual(['graph', 'graph-edges']);
    expect(await store.keys('shortcut')).toEqual([]);
  });

  it('目录还不存在时 keys 返回 []（不抛）', async () => {
    expect(await store.keys('canvas')).toEqual([]);
  });
});

describe('KvStore 健壮性', () => {
  it('文件内容坏掉（非法 JSON）→ 当缺失处理，不抛', async () => {
    await fs.mkdir(path.join(dir, 'kv'), { recursive: true });
    await fs.writeFile(path.join(dir, 'kv', 'canvas%3Abad.json'), '{not json', 'utf8');
    expect(await store.get('canvas', 'bad')).toBeUndefined();
  });

  it('kvFileName 逃逸文件名（含 : 与路径分隔符）', () => {
    expect(kvFileName('canvas', 'graph')).toBe('canvas%3Agraph.json');
    expect(kvFileName('canvas', 'a/b')).not.toContain('/');
  });

  it('isKvType 只认四类作用域', () => {
    expect(isKvType('canvas')).toBe(true);
    expect(isKvType('config')).toBe(true);
    expect(isKvType('resource')).toBe(true);
    expect(isKvType('shortcut')).toBe(true);
    expect(isKvType('evil')).toBe(false);
    expect(isKvType('../etc')).toBe(false);
  });
});

