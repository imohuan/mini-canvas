/**
 * 边流光循环的成本守卫。
 *
 * 背景（2026-11-04 排查卡顿）：CustomEdge 以前在 onMounted 里无条件启动一个
 * requestAnimationFrame 循环；未激活的边每帧也会进回调（虽然开头就 return）。
 * 一条边"几乎零开销"，但几十上百条边时每帧都要唤醒同样多的回调，和拖拽/缩放抢帧。
 *
 * 现在只在 flowActive && edgeShowVisual 时启动，取消激活/卸载时 cancel。
 * 这里做静态结构守卫：这类"常驻循环"回退在浏览器里不容易一眼看出来（只是变卡）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.resolve(HERE, '../CustomEdge.vue'), 'utf8')

describe('CustomEdge 流光逐帧循环', () => {
  it('不再在 onMounted 里无条件启动 rAF', () => {
    expect(source, '出现 `onMounted(() => requestAnimationFrame(...))` 就是回退成每条边常驻循环').not.toMatch(
      /onMounted\(\s*\(\s*\)\s*=>\s*\{?\s*_capRaf\s*=\s*requestAnimationFrame/,
    )
  })

  it('只在激活时启动，并且用明确的运行标志判断（句柄每帧会变，不能拿它当开关）', () => {
    expect(source).toContain('let _capLooping = false')
    expect(source).toMatch(/function syncFlowLoop\(\): void \{/)
    // 启动必须同时受两个条件约束：本边在流光、且视觉层可见
    expect(source).toMatch(/if \(flowActive\.value && edgeShowVisual\.value\)/)
    // 启动前必须看标志，否则重复 watch 会叠出多条 rAF 链
    expect(source).toMatch(/if \(!_capLooping\) \{\s*_capLooping = true/)
  })

  it('卸载时一定取消循环', () => {
    expect(source).toMatch(/onUnmounted\(\(\) => \{[\s\S]*?cancelAnimationFrame\(_capRaf\)/)
  })
})
