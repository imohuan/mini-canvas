/**
 * 性能探针不允许改浏览器标签页标题（2026-10-30 扫描发现）。
 *
 * main.ts 里的探针是 2026-10-15 卡死排查留下的取证工具：每 5 秒把长任务统计写
 * localStorage，并且**下一次打开页面时**把上一轮统计写进 document.title（前缀 PERF）。
 * 后果：用户看到的是「PERF lt=12 ms=4300 wall=95s」这种调试串，不是画布标题；
 * 而且这个标题会一直跟着用户。取证需要的数据 localStorage 里已经有了，
 * 窗口标题这一条纯属副作用。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../main.ts', import.meta.url), 'utf-8')

describe('性能探针', () => {
  it('不改 document.title', () => {
    expect(src, '探针仍在写 document.title（用户会看到 PERF 调试串）').not.toMatch(/document\.title\s*=/)
  })

  it('仍然把统计数据写进 localStorage（取证能力保留）', () => {
    expect(src).toMatch(/mc-perf-probe-last/)
    expect(src).toMatch(/__readPerfProbe/)
  })
})
