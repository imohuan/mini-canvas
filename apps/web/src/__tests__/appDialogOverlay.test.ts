/**
 * AppDialog 遮罩层级契约。
 *
 * 用户口径（2026-11-02）：点“生成历史”按钮，弹窗像没打开。
 * 实测根因：AppDialog 把 DialogOverlay 写进了 DialogContent 的默认插槽，
 * fixed inset-0 的遮罩因此铺在弹窗内容之上（第一个子元素就是 0.35 不透明度的黑层）。
 *
 * 这里读源码锁结构：遮罩只能是 DialogContent 的兄弟，不能再出现在它的插槽里。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const source = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../components/AppDialog.vue'),
  'utf-8',
)

const template = source.slice(source.indexOf('<template>'), source.indexOf('</template>') + 11)
const contentStart = template.indexOf('<DialogContent')
const contentEnd = template.lastIndexOf('</DialogContent>')

describe('AppDialog：遮罩不能盖住面板', () => {
  it('模板里有 DialogContent', () => {
    expect(contentStart).toBeGreaterThan(-1)
    expect(contentEnd).toBeGreaterThan(contentStart)
  })

  it('DialogOverlay 不在 DialogContent 的插槽里', () => {
    const inner = template.slice(contentStart, contentEnd)
    expect(inner, '遮罩写进内容插槽会铺满整个面板').not.toMatch(/<DialogOverlay/)
  })

  it('生成历史使用透明遮罩（withOverlay=false）而不是被深色层挡住', () => {
    const modals = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../components/areas/modals-area/HistoryModal.vue'),
      'utf-8',
    )
    expect(modals).toMatch(/s\.historyOpen[\s\S]{0,200}:with-overlay="false"/)
  })
})

/**
 * 无障碍标题契约。
 *
 * reka-ui 的 DialogContent 在挂载时检查有没有 DialogTitle / DialogDescription，
 * 缺了就在控制台刷两条 warn（2026-11-05 打开「生成历史」实测）。标题在这里统一
 * 渲染成 sr-only，调用方只传文案 —— 漏掉的话这里会红。
 */
describe('AppDialog：无障碍标题与描述', () => {
  const inner = template.slice(contentStart, contentEnd)

  it('面板里渲染 DialogTitle 和 DialogDescription', () => {
    expect(inner).toMatch(/<DialogTitle/)
    expect(inner).toMatch(/<DialogDescription/)
  })

  it('默认值兜底，调用方不传也不会留下空的标签', () => {
    expect(source).toMatch(/title:\s*'/)
    expect(source).toMatch(/description:\s*'/)
  })
})
