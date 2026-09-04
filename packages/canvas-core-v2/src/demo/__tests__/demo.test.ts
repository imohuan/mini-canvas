import { describe, it, expect } from 'vitest'
import { bootCanvas } from '../host'
import { MemoryStorageAdapter } from '../../services/storage/memoryAdapter'

describe('M4 最小 demo 全链（tracer bullet）', () => {
  it('建内核→装text插件→放节点→编辑→保存', async () => {
    const host = await bootCanvas()

    // 插件在 setup 里注册了 text 类型，并经 ctx.inject 暴露 'text' 服务
    const text = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string; editText(id: string, t: string): void }>('text')

    // 放一个文本节点 → 返回短 id（数字累加）
    const id = text.addTextNode({ x: 0, y: 0 })
    expect(id).toBe('1') // 短数字 id，非 v1 的 'node-text-171...'

    // 节点 type 是业务类型 'text'，不是 'custom'
    const node = host.nodeStore.getNode(id)!
    expect(node.type).toBe('text')
    expect(node.data.text).toBe('双击编辑')

    // 编辑文本 → 写回 data + 落盘(canvas:graph)
    text.editText(id, '你好 v2')
    expect(host.nodeStore.getNode(id)!.data.text).toBe('你好 v2')

    // flush 确保落盘完成
    await host.save.flush()

    host.stop() // 卸载全部副作用
  })

  it('刷新恢复：同一存储后端，第二次 boot 文本还在', async () => {
    // 共享同一个 memory adapter = 模拟同一浏览器的 localStorage
    const storage = new MemoryStorageAdapter()

    // 第一次会话：建 + 编辑 + 落盘 + 正常卸载
    {
      const host = await bootCanvas(storage)
      const text = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string; editText(id: string, t: string): void }>('text')
      text.addTextNode({ x: 0, y: 0 })
      text.editText('1', '刷新后还在')
      await host.save.flush()
      host.stop()
    }

    // 第二次会话：全新内核（模拟刷新页面），读同一存储 → 自动恢复画布
    {
      const host = await bootCanvas(storage)
      const node = host.nodeStore.getNode('1')!
      expect(node.type).toBe('text')
      expect(node.data.text).toBe('刷新后还在')
      host.stop()
    }
  })

  it('多个节点 id 依次累加、互不撞号', async () => {
    const host = await bootCanvas()
    const text = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string }>('text')
    expect(text.addTextNode({ x: 0, y: 0 })).toBe('1')
    expect(text.addTextNode({ x: 10, y: 10 })).toBe('2')
    expect(host.nodeStore.getNodes()).toHaveLength(2)
    host.stop()
  })
})
