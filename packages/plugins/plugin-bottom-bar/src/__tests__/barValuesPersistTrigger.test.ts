/**
 * 参数落盘的触发点（用户 2026-11-09：切动作后参数不保存，重选节点又回默认）。
 *
 * 之前只有「提示词变化」会调 persistValuesSoon，切动作 / 改参数都不写盘。
 * 于是节点 data.barValues 一直停在上一次，重新挂载时按旧值恢复 ——
 * 表现是「切到另一个动作，参数回到默认」。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const bar = readFileSync(resolve(__dirname, '../NodeBottomBar.vue'), 'utf8')

describe('切动作 / 改参数要落盘', () => {
  it('同时盯住 currentId 与 values', () => {
    expect(bar).toMatch(/watch\(\s*\[currentId, values\]/)
  })

  it('变化时调用 persistValuesSoon', () => {
    const at = bar.indexOf('[currentId, values]')
    expect(at, '找不到 [currentId, values] 监听').toBeGreaterThan(-1)
    const block = bar.slice(at, at + 220)
    expect(block).toContain('persistValuesSoon()')
  })
})

