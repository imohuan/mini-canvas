/**
 * 输入框里待发送图片卡片的删除按钮（用户口径 2026-11-23）。
 *
 * 之前用的是组件库 icon-sm（32px），盖在 56px 的卡片右上角，几乎占掉一半，
 * 还会压住图片。这里锁住三点：按钮本身要小、不能超过卡片一半、要有可见的点击区。
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSfcWithStyles } from './readSfcWithStyles'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const composer = readSfcWithStyles(path.resolve(HERE, '../ui/conversation/AgentComposer.vue'))

function rule(selector: string): string {
  const at = composer.indexOf(selector + ' {')
  expect(at, '找不到样式块：' + selector).toBeGreaterThanOrEqual(0)
  return composer.slice(at, composer.indexOf('}', at) + 1)
}

describe('输入框图片卡片的删除按钮', () => {
  it('按钮尺寸明显小于 32px 的 icon-sm，并小于卡片一半', () => {
    const card = rule('.ac-attach')
    const cardSize = Number((card.match(/width:\s*(\d+)px/) ?? [])[1])
    const del = rule('.ac-attach-del')
    const size = Number((del.match(/width:\s*(\d+)px/) ?? [])[1])
    const height = Number((del.match(/height:\s*(\d+)px/) ?? [])[1])
    expect(size).toBeGreaterThan(0)
    expect(height).toBe(size)
    expect(size).toBeLessThan(32)
    expect(size * 2).toBeLessThanOrEqual(cardSize)
  })

  it('是圆形、紧贴右上角，图标尺寸跟按钮一起收小', () => {
    const del = rule('.ac-attach-del')
    expect(del).toMatch(/border-radius:\s*(999px|50%)/)
    expect(del).toMatch(/top:\s*\d+px/)
    expect(del).toMatch(/right:\s*\d+px/)
  })
})
