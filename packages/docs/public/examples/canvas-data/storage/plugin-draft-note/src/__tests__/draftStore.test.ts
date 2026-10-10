// 文件：packages/docs/public/examples/canvas-data/storage/plugin-draft-note/src/__tests__/draftStore.test.ts
// 格式：TypeScript 测试（vitest，environment: 'node'）
// 位置：验证“两个抽屉互不干扰”与“换后端能重读”

import { describe, expect, it, vi } from 'vitest'
import { MemoryStorageAdapter, SaveServiceImpl } from '@mini-canvas/canvas-data'
import { createDraftStore, DRAFT_KEY, PANEL_KEY } from '../draftStore'

describe('draftStore', () => {
  it('草稿进 canvas 抽屉、面板名进 config 抽屉；物理 key 带前缀', async () => {
    const adapter = new MemoryStorageAdapter()
    const save = new SaveServiceImpl(adapter)
    const store = createDraftStore(save, () => {})

    store.save(['a', 'b'])
    store.rememberPanel('panel-x')
    await save.flush()   // set 是入队，flush 才落盘

    // 读回来：两个抽屉各自独立
    expect(await store.load()).toEqual(['a', 'b'])
    expect(await store.lastPanel()).toBe('panel-x')

    // adapter 只看到带前缀的物理 key（这就是“四个抽屉互不干扰”的实现）
    expect(await adapter.get('canvas:' + DRAFT_KEY)).toEqual(['a', 'b'])
    expect(await adapter.get('config:' + PANEL_KEY)).toBe('panel-x')
  })

  it('切到新后端后能重读（onAdapterChange）', async () => {
    const save = new SaveServiceImpl(new MemoryStorageAdapter())
    const onReload = vi.fn()
    const store = createDraftStore(save, onReload)

    // 新后端里已经有一份“服务器上的真身”
    const cloud = new MemoryStorageAdapter()
    await cloud.set('canvas:' + DRAFT_KEY, ['来自云端'])
    save.useAdapter('canvas', cloud)

    // 订阅是异步触发的：等一个微任务
    await new Promise((r) => setTimeout(r, 0))
    expect(onReload).toHaveBeenCalledWith(['来自云端'])
    store.dispose()
  })
})

