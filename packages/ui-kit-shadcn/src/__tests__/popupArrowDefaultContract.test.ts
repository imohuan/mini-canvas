/**
 * 浮层箭头 prop 的缺省值契约。
 *
 * Vue 会把没有 `default` 的布尔 prop 当成 `false`。如果组件直接用
 * `popupArrowVisible(kind, props.arrow)`，这个 `false` 会被当成调用点显式关闭箭头，
 * 从而盖掉「设置 → 外观 → 浮层 → 全部显示」。
 *
 * 六类浮层都必须把 `arrow` 的缺省值写成 `undefined`，才能区分
 * 「没传」和「明确传 false」；调用点仍可显式关闭箭头。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../components/ui')

const popupFiles = [
  ['dropdown', 'dropdown-menu/DropdownMenuContent.vue'],
  ['dropdown sub', 'dropdown-menu/DropdownMenuSubContent.vue'],
  ['select', 'select/SelectContent.vue'],
  ['popover', 'popover/PopoverContent.vue'],
  ['tooltip', 'tooltip/TooltipContent.vue'],
  ['context', 'context-menu/ContextMenuContent.vue'],
  ['context sub', 'context-menu/ContextMenuSubContent.vue'],
  ['combobox', 'combobox/ComboboxList.vue'],
] as const

describe('浮层箭头 prop 缺省值', () => {
  for (const [label, relative] of popupFiles) {
    it(`${label} 未传 arrow 时交给全局配置，而不是误判为 false`, () => {
      const source = readFileSync(path.join(root, relative), 'utf-8')
      expect(source, `${label} 需要 withDefaults(... { arrow: undefined })`).toMatch(/arrow:\s*undefined/)
    })
  }
})

describe('下拉箭头形状', () => {
  it('用 rounded 路径：没有顶部横线，不会在面板边上压出「框」（用户 2026-11-05 截图）', () => {
    const source = readFileSync(path.join(root, 'dropdown-menu/DropdownMenuArrow.vue'), 'utf-8')
    expect(source, '箭头没有开 rounded').toMatch(/rounded:\s*true/)
    expect(source, '模板没有把 rounded 传给 reka').toMatch(/:rounded="props\.rounded"/)
  })
})
