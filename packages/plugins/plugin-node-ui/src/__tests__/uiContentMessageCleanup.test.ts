/**
 * 可视化节点的 window message 监听必须全部随卸载摘掉（2026-10-30 扫描发现）。
 *
 * UiContent 挂了四个 message 监听：bridge / debug / debug proxy / **debug SDK 事件**。
 * 前三个在卸载时有 removeEventListener，第四个（onDebugSdkEvent，负责把
 * connected / eval / result / error 转给标题旁那枚调试徽标）只加不减 ——
 * 每开过一个可视化节点，window 上就多留一个回调，节点一多消息分发越来越慢，
 * 而且它们还在给已经不存在的节点发事件。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../UiContent.vue', import.meta.url), 'utf-8')

describe('UiContent message 监听', () => {
  it('每个 addEventListener 都有对应的 removeEventListener', () => {
    const added = [...src.matchAll(/window\.addEventListener\('message',\s*(\w+)/g)].map((m) => m[1])
    expect(added.length, '找不到 message 监听').toBeGreaterThan(0)
    for (const fn of new Set(added)) {
      expect(src, `监听 ${fn} 卸载时没有摘掉`).toMatch(
        new RegExp(`removeEventListener\\('message',\\s*${fn}\\)`),
      )
    }
  })
})
