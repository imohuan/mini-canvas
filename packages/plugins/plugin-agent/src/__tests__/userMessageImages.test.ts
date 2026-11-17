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
    // 选择器必须带父级，否则组件库按钮的 rounded-md / size-8 会把单类名规则盖掉
    const card = rule('.ac-user-images .ac-user-image')
    const width = Number((card.match(/width:\s*(\d+)px/) ?? [])[1])
    expect(width).toBeGreaterThanOrEqual(120)
    expect(card).toMatch(/border-radius:\s*12px/)
  })
})
