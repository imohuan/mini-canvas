/**
 * 覆盖槽位（saveSlot）—— 「一个节点一份文件、原地覆盖」。
 *
 * 为什么单开这条：内容寻址（save）让每笔新内容都变一个新文件，
 * 可视化节点的输出画一笔就多一份，而历史版本一个都不需要。
 * 2026-10-13 与用户确认：参数进历史、输出走覆盖。
 */
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CanvasResourceStore, isSafeResourceName, isSafeSlotId, isSlotName } from '../store/canvasResources'

async function tmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'slot-'))
  return { store: new CanvasResourceStore(dir), dir }
}

describe('槽位命名与白名单', () => {
  it('槽位名合法（slot-<id> + 可选白名单扩展名）', () => {
    expect(isSafeResourceName('slot-2.png')).toBe(true)
    expect(isSafeResourceName('slot-node_2-x.mp4')).toBe(true)
    // 内容寻址那条仍然合法（老数据不能因为这次改动被挡）
    expect(isSafeResourceName('3a764aa46ab66a3f.png')).toBe(true)
  })

  it('路径穿越被挡：点号 / 斜杠都不在槽位 id 白名单里', () => {
    expect(isSafeSlotId('../evil')).toBe(false)
    expect(isSafeSlotId('a/b')).toBe(false)
    expect(isSafeSlotId('')).toBe(false)
    expect(isSafeResourceName('slot-../evil.png')).toBe(false)
  })

  it('isSlotName 分得清两种形态（决定缓存策略）', () => {
    expect(isSlotName('slot-2.png')).toBe(true)
    expect(isSlotName('3a764aa46ab66a3f.png')).toBe(false)
  })
})

describe('saveSlot：原地覆盖，永远只有一份', () => {
  it('写两次 → 地址不变、内容被换掉、磁盘上只有一个文件', async () => {
    const { store, dir } = await tmpStore()
    const a = await store.saveSlot('default', '2', new Uint8Array([1, 2, 3, 4]), '.png')
    const b = await store.saveSlot('default', '2', new Uint8Array([9, 9]), '.png')
    // 地址稳定（下游连着它，不能变）
    expect(b.url).toBe(a.url)
    expect(a.url).toBe('/api/canvases/default/resources/slot-2.png')
    // 内容是新的
    const bytes = await store.read('default', 'slot-2.png')
    expect(Array.from(bytes ?? [])).toEqual([9, 9])
    // 磁盘上就一个（没有 version1 / version2）
    const files = (await fs.readdir(path.join(dir, 'canvases', 'default', 'resources'))).filter((f) => !f.includes('.tmp-'))
    expect(files).toEqual(['slot-2.png'])
  })

  it('对比：内容寻址的 save 每次都新文件（说明为什么输出不能走它）', async () => {
    const { store } = await tmpStore()
    const a = await store.save('default', new Uint8Array([1]), '.png')
    const b = await store.save('default', new Uint8Array([2]), '.png')
    expect(a.url).not.toBe(b.url)
  })

  it('换扩展名（图片 → 视频）→ 旧扩展名那份被清掉，不会两份并存', async () => {
    const { store } = await tmpStore()
    await store.saveSlot('default', '2', new Uint8Array([1]), '.png')
    await store.saveSlot('default', '2', new Uint8Array([2]), '.mp4')
    expect(await store.read('default', 'slot-2.mp4')).toBeTruthy()
    expect(await store.read('default', 'slot-2.png')).toBeUndefined()
  })

  it('非法槽位 id → 抛错（不静默写出去）', async () => {
    const { store } = await tmpStore()
    await expect(store.saveSlot('default', '../evil', new Uint8Array([1]))).rejects.toThrow()
  })
})

