/**
 * fileStore 单测 —— 纯逻辑（真实 fs，临时目录）。
 *
 * 锁的核心：**按内容哈希命名** → 同内容重复上传只存一份、URL 与内容绑定；
 * 以及**扩展名白名单**（同源托管下 .html/.js 会带来 XSS 面，必须挡住）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FileStore, safeExt, mimeOf, isSafeFileId, contentId } from '../store/fileStore'

let dir: string
let store: FileStore

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'filestore-'));
  store = new FileStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('FileStore 存取', () => {
  it('存一个 png → 返回同源 url，读回字节完全一致', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const f = await store.save(bytes, '.png');
    expect(f.url).toBe('/uploads/' + f.id);
    expect(f.id.endsWith('.png')).toBe(true);
    expect(f.size).toBe(bytes.byteLength);
    expect(f.mime).toBe('image/png');
    const back = await store.read(f.id)
    expect(back).toEqual(bytes);
  });

  it('同内容上传两次 → 同一 id、磁盘只有一份（去重）', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const a = await store.save(bytes, '.png');
    const b = await store.save(bytes, '.png');
    expect(a.id).toBe(b.id);
    expect(a.url).toBe(b.url);
    expect(await store.ids()).toHaveLength(1);
  });

  it('不同内容 → 不同 id', async () => {
    const a = await store.save(new Uint8Array([1, 2]), '.png');
    const b = await store.save(new Uint8Array([3, 4]), '.png');
    expect(a.id).not.toBe(b.id);
    expect(await store.ids()).toHaveLength(2);
  });

  it('读不存在的文件 → undefined', async () => {
    expect(await store.read('0123456789abcdef.png')).toBeUndefined();
  });

  it('目录还不存在时 ids 返回 []（不抛）', async () => {
    expect(await store.ids()).toEqual([]);
  });
});

describe('FileStore 安全边界', () => {
  it('扩展名白名单：.html / .js 不接受（回落空串）', () => {
    expect(safeExt('evil.html')).toBe('');
    expect(safeExt('evil.js')).toBe('');
    expect(safeExt('ok.png')).toBe('.png');
    expect(safeExt('OK.PNG')).toBe('.png');
  });

  it('id 合法性挡住路径穿越', () => {
    const bytes = new Uint8Array([9, 9, 9])
    const id = contentId(bytes, '.png')
    expect(isSafeFileId(id)).toBe(true);
    expect(isSafeFileId('../../etc/passwd')).toBe(false);
    expect(isSafeFileId('a/b.png')).toBe(false);
    expect(isSafeFileId('zzzz.png')).toBe(false);
  });

  it('read 遇到非法 id 直接 undefined（不去碰文件系统）', async () => {
    expect(await store.read('../../etc/passwd')).toBeUndefined();
  });

  it('mimeOf 从扩展名推断；未知回落 octet-stream', () => {
    expect(mimeOf('abc.png')).toBe('image/png');
    expect(mimeOf('abc.mp4')).toBe('video/mp4');
    expect(mimeOf('abc.zzz')).toBe('application/octet-stream');
  });

  it('未知扩展名存进去也不报错（ext 空串）', async () => {
    const f = await store.save(new Uint8Array([7]), '');
    expect(f.id).toMatch(/^[0-9a-f]{16}$/);
    expect(f.mime).toBe('application/octet-stream');
  });
});

