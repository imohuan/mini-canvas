/**
 * 用户消息里的图片（用户口径 2026-11-17）：
 * ① 图要够大，不能只是按钮的默认 32px 小方块；
 * ② 要和用户气泡一样靠右对齐。
 *
 * 之前规则写在 AgentComposer 的 `<style scoped>` 里 —— scoped 只作用于输入组件自己，
 * 消息流里的图片完全拿不到，所以只剩 Button 的 icon-sm 尺寸、而且被拉成整行靠左。
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSfcWithStyles } from './readSfcWithStyles'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const list = readSfcWithStyles(path.resolve(HERE, '../ui/conversation/AgentMessageList.vue'))

function rule(selector: string): string {
  const at = list.indexOf(selector + ' {')
  expect(at, '找不到样式块：' + selector).toBeGreaterThanOrEqual(0)
  return list.slice(at, list.indexOf('}', at) + 1)
}

describe('用户消息图片', () => {
  it('图片容器靠右对齐', () => {
    const box = rule('.ac-user-images')
    expect(box).toMatch(/justify-content:\s*flex-end/)
    expect(box).toMatch(/align-self:\s*flex-end/)
  })

  it('图片卡片比按钮默认尺寸大（至少 120px）', () => {
    // 尺寸现在由图片按原比例撑开；上限必须明显大于按钮默认的 32px，
    // 否则又退回「图片只剩小方块」。
    const card = rule('.ac-user-images .ac-user-image')
    const maxWidth = Number((card.match(/max-width:\s*min\((\d+)px/) ?? [])[1])
    expect(maxWidth).toBeGreaterThanOrEqual(120)
    expect(card).toMatch(/border-radius:\s*12px/)
  })

  it('按原比例展示：最长边有上限，不强制正方形（用户口径 2026-11-23）', () => {
    // 之前写死 width/height 200px + object-fit: cover，横图会被裁成正方形
    const card = rule('.ac-user-images .ac-user-image')
    expect(card).not.toMatch(/^\s*width:\s*\d+px/m)
    expect(card).not.toMatch(/^\s*height:\s*\d+px/m)
    expect(card).toMatch(/max-height:\s*\d+px/)

    const img = rule('.ac-user-image img')
    expect(img).not.toMatch(/object-fit:\s*cover/)
    expect(img).toMatch(/max-height:\s*\d+px/)
    expect(img).toMatch(/height:\s*auto/)
    expect(img).toMatch(/width:\s*auto/)
  })
})
