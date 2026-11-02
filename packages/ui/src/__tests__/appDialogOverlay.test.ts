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
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../components/areas/ModalsArea.vue'),
      'utf-8',
    )
    expect(modals).toMatch(/s\.historyOpen[\s\S]{0,200}:with-overlay="false"/)
  })
})
