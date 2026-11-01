/**
 * probeMcp 的收尾必须用同步、吞错的 closeQuietly（2026-10-30 扫描发现）。
 *
 * 根因：finally 里调 `provider.close()` —— SDK 的 close() 返回 Promise，而这里
 * 不能 await（探测结果已经拿到，收尾不该再拖住响应）。于是它的失败没人接：
 * 连接已坏 / 子进程正在退时 close() 会 reject，在 Node 里就是一条 unhandled
 * rejection（进程级告警，严重时把后台带崩）。SDK 专门为同步收尾给了 closeQuietly()。
 *
 * 这里用源码守卫（行为层看不出差别：两种关法都让下一次探测成功）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 实现已搬进 plugin-agent（cloud-server 只留兼容导出）：守卫跟着实现走，
// 否则这里读到的是一行 `export *`，测试永远找不到 probeMcp。
// 路径：本文件在 packages/cloud-server/src/__tests__/，
// ../../../ = src → cloud-server → packages，再进 plugins/plugin-agent。
const src = readFileSync(
  new URL('../../../plugins/plugin-agent/src/server/agent/config.ts', import.meta.url),
  'utf-8',
)

describe('probeMcp 收尾', () => {
  it('用 closeQuietly，而不是没人接的 close()', () => {
    const at = src.indexOf('async probeMcp(')
    expect(at, '找不到 probeMcp').toBeGreaterThan(0)
    const block = src.slice(at, src.indexOf('async resolvedTools(', at))
      // 先剥注释：解释「为什么不用 close()」的注释本身不该被当成调用
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ')
    expect(block, '收尾没走 closeQuietly').toMatch(/provider\.closeQuietly\(\)/)
    expect(block, '仍在调没人接的 provider.close()').not.toMatch(/provider\.close\(\)/)
  })
})
