/**
 * 模型下拉的交互契约（用户 2026-11-06）。
 *
 * 用户实测：Select 版本展开后，再点 trigger 收不回去，点画布空白也不消失。
 * 现在改成 DropdownMenu：trigger 点击是开/关切换，点外由菜单自己关。
 * 这里钉住「用哪个组件」，具体开合行为在 Chrome 里实测。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readBottomBarCss } from './readBottomBarCss'

const SFC = readFileSync(fileURLToPath(new URL('../node-bottom-bar/BottomBarActions.vue', import.meta.url)), 'utf8')
const CSS = readBottomBarCss()

describe('模型下拉：DropdownMenu', () => {
  it('触发器 / 菜单 / 选项都取自全局注册的 DropdownMenu 家族', () => {
    for (const name of ['DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuItem']) {
      expect(SFC).toContain("useUiComponent('" + name + "')")
    }
  })

  it('不再用 Select 渲染模型（它的 trigger 无法切换关闭）', () => {
    expect(SFC).not.toContain("useUiComponent('Select')")
    expect(SFC).not.toContain('<SelectTrigger')
  })

  it('每一项点下去会选中该模型，并标出当前项', () => {
    expect(SFC).toContain('@select="pickAction(String(o.value))"')
    expect(SFC).toContain("o.value === currentId ? 'checked' : undefined")
  })
})

describe('模型下拉的默认观感（用户 2026-11-06）', () => {
  it('选中勾是默认灰，不用强调色', () => {
    const i = CSS.indexOf('.nb-model-item-check {')
    expect(i).toBeGreaterThan(-1)
    const block = CSS.slice(CSS.indexOf('{', i) + 1, CSS.indexOf('}', i))
    expect(block).toMatch(/color\s*:\s*var\(--ui-ink-mute/)
    expect(block).not.toMatch(/--ui-accent/)
  })

  it('展开时箭头旋转 180 度（和右侧参数下拉一致）', () => {
    const i = CSS.indexOf(".nb-model-trigger[aria-expanded='true'] .nb-model-trigger-caret")
    expect(i).toBeGreaterThan(-1)
    const block = CSS.slice(CSS.indexOf('{', i) + 1, CSS.indexOf('}', i))
    expect(block).toMatch(/transform\s*:\s*rotate\(180deg\)/)
    // 有过渡，才看得出是「转」而不是瞬切
    const caret = CSS.indexOf('.nb-model-trigger-caret {')
    expect(CSS.slice(caret, CSS.indexOf('}', caret))).toMatch(/transition\s*:\s*transform/)
  })

  it('减少动效偏好下取消旋转过渡', () => {
    expect(CSS).toMatch(/prefers-reduced-motion[\s\S]{0,160}\.nb-model-trigger-caret\s*\{[^}]*transition\s*:\s*none/)
  })
})
