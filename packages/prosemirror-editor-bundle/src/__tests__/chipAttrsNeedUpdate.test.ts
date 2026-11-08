/**
 * 标签刷新要不要改文档 —— 内容没变就不能改。
 *
 * 用户 2026-10-27 报：点标签后光标先跳到标签**前面**，0.5s 后又跳到后面。
 * 根因是底栏 watcher 反复调 replaceResourceThumbByName / refreshChips，
 * 这两个函数以前无条件 setNodeMarkup —— attrs 一个字没变也算「文档改动」，
 * ProseMirror 重建节点、整颗选中被销毁，浏览器就把光标就近放到标签前面。
 *
 * 这里钉住判定规则：url / 名字都没变 → 不许碰文档。
 */
import { describe, expect, it } from 'vitest'
import { chipAttrsNeedUpdate } from '../useEditor.ts'

describe('chipAttrsNeedUpdate：标签要不要重写', () => {
  it('url 和名字都一样 → 不需要改文档（点标签时不能因此丢选中）', () => {
    expect(chipAttrsNeedUpdate({ url: 'a.png', name: '图片1' }, { url: 'a.png', name: '图片1' })).toBe(false)
  })

  it('空 url 的待输入标签，刷新成同一个空 url → 也不需要改', () => {
    expect(chipAttrsNeedUpdate({ url: '', name: '图片1' }, { url: '', name: '图片1' })).toBe(false)
  })

  it('换成另一张图 → 需要改', () => {
    expect(chipAttrsNeedUpdate({ url: 'a.png', name: '图片1' }, { url: 'b.png', name: '图片1' })).toBe(true)
  })

  it('删除资源（变成待输入）→ 需要改', () => {
    expect(chipAttrsNeedUpdate({ url: 'a.png', name: '图片1' }, { url: '', name: '图片1' })).toBe(true)
  })

  it('只比较 url（调用方不给名字时）→ 名字不参与判定', () => {
    expect(chipAttrsNeedUpdate({ url: 'a.png', name: '图片1' }, { url: 'a.png' })).toBe(false)
  })

  it('名字真的变了 → 需要改', () => {
    expect(chipAttrsNeedUpdate({ url: 'a.png', name: '图片1' }, { url: 'a.png', name: '图片2' })).toBe(true)
  })

  /*
   * 序号（用户 2026-11-08）：参考卡拖拽换序后，标签上的「N · 」要跟着变。
   *
   * 为什么必须写进文档属性：正文标签是 atom 节点，属性一个字没变时 ProseMirror
   * 不会重建 DOM —— 只改注册表的话用户看到的是「拖了，标签里还是旧号」。
   */
  it('只有序号变了 → 需要改文档（否则界面停在旧号）', () => {
    expect(chipAttrsNeedUpdate({ url: 'a.png', name: '图片1', chipIndex: 1 }, { url: 'a.png', name: '图片1', chipIndex: 2 })).toBe(true)
  })

  it('序号没变 → 不改文档', () => {
    expect(chipAttrsNeedUpdate({ url: 'a.png', name: '图片1', chipIndex: 2 }, { url: 'a.png', name: '图片1', chipIndex: 2 })).toBe(false)
  })

  it('旧文档没有序号（缺省）与 0 等价', () => {
    expect(chipAttrsNeedUpdate({ url: 'a.png', name: '图片1' }, { url: 'a.png', name: '图片1', chipIndex: 0 })).toBe(false)
  })

  it('调用方不提序号 → 序号不参与判定（老调用方行为不变）', () => {
    expect(chipAttrsNeedUpdate({ url: 'a.png', name: '图片1', chipIndex: 3 }, { url: 'a.png', name: '图片1' })).toBe(false)
  })
})
