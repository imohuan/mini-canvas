// @vitest-environment happy-dom
/**
 * 设置面板的「控件尺寸」必须真的作用到面板自己的控件上。
 *
 * 用户实测 2026-11-05：把「外观 → 尺寸」切到「大」，设置界面里的下拉、行、按钮一个都没变。
 * 根因有两条，都是“写死”：
 * 1. 字段渲染器直接 import 组件库，绕过了按名取件那层 size 注入；
 * 2. 模板写死 `size="sm"`，CSS 又写死 30/32px 高度。
 *
 * 这条用真实 DOM（happy-dom）挂载字段控件，量出来的 `data-size` 与行高必须随档位变化。
 * 只读源码的断言挡不住“属性写对了但样式没生效”，所以这里读的是渲染结果。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { componentConfig, resetComponentConfig } from '@plume-canvas/ui-kit-shadcn/componentConfig'
import type { SettingEntry, SettingsPanelSource } from '@plume-canvas/canvas-render'
import SettingsSchemaField from '../SettingsSchemaField.vue'
import ShadcnSettingsRow from '../ShadcnSettingsRow.vue'

/** 只有一个 select 字段的最小设置源：足够走真实渲染路径。 */
function settingsWith(entry: SettingEntry): SettingsPanelSource {
  return {
    groups: () => [entry.group],
    groupOf: () => [entry],
    set: () => true,
    onChange: () => ({ dispose() {} }),
  }
}

const selectEntry: SettingEntry = {
  group: '外观/浮层',
  key: 'demoSelect',
  schema: {
    type: 'select',
    default: 'a',
    label: '演示下拉',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
  },
  value: 'a',
}

let app: App | undefined

beforeEach(() => {
  document.body.innerHTML = ''
  resetComponentConfig()
})

afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ''
  resetComponentConfig()
})

function mount(node: () => ReturnType<typeof h>): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: node })
  app.mount(host)
  return host
}

describe('设置面板控件跟「尺寸」档位走', () => {
  it('下拉触发器的 data-size 随全局档位切换（不再写死 sm）', async () => {
    const host = mount(() => h(SettingsSchemaField, {
      group: selectEntry.group,
      fieldKey: selectEntry.key,
      settings: settingsWith(selectEntry),
    }))
    await nextTick()

    const triggerOf = (): Element | null => host.querySelector('[data-slot="select-trigger"]')
    expect(triggerOf(), '设置里的下拉没有渲染出来').toBeTruthy()
    expect(triggerOf()!.getAttribute('data-size')).toBe('default')

    componentConfig.size = 'lg'
    await nextTick()
    expect(triggerOf()!.getAttribute('data-size')).toBe('lg')

    componentConfig.size = 'sm'
    await nextTick()
    expect(triggerOf()!.getAttribute('data-size')).toBe('sm')
  })

  /**
   * 设置行的行高来自 --plume-size-control-h：themeBridge 按尺寸档写进 <html>，
   * 行组件用自己的 min-height 读它。
   *
   * 为什么分两段量：happy-dom 不做布局、也不解析 CSS 自定义属性继承，
   * `getComputedStyle(row).minHeight` 恒为空。所以一段量**真实运行**的写入，
   * 一段量**组件样式确实引用这个变量**；中间那层继承是浏览器标准行为。
   */
  it('尺寸档把行高变量写进根节点（小 < 标准 < 大）', async () => {
    const { applyThemeBridge } = await import('@plume-canvas/theme-contract')
    const rowVar = (): number => {
      const value = document.documentElement.style.getPropertyValue('--plume-size-control-h').trim()
      const rem = /^([\d.]+)rem$/.exec(value)
      expect(rem, '行高变量没有写到根节点：' + value).toBeTruthy()
      return Number(rem![1]) * 16
    }

    applyThemeBridge({ radius: 'inherit', font: 'inherit', heading: 'inherit', size: 'sm' })
    const small = rowVar()
    applyThemeBridge({ radius: 'inherit', font: 'inherit', heading: 'inherit', size: 'default' })
    const normal = rowVar()
    applyThemeBridge({ radius: 'inherit', font: 'inherit', heading: 'inherit', size: 'lg' })
    const large = rowVar()

    expect(small, '小档没有比标准档矮').toBeLessThan(normal)
    expect(large, '大档没有比标准档高').toBeGreaterThan(normal)
  })

  it('设置行真的读这个变量，且行元素真的渲染出来', async () => {
    const host = mount(() => h(ShadcnSettingsRow, { label: '演示' }, () => h('span', 'x')))
    await nextTick()
    expect(host.querySelector('.shadcn-settings-row'), '设置行没有渲染').toBeTruthy()

    // 组件样式必须消费同一个变量名；写死 px 就又回到「改尺寸没反应」。
    // happy-dom 下 import.meta.url 不是 file 协议，按测试运行目录拼绝对路径。
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const rowSource = readFileSync(
      join(process.cwd(), 'src/components/settings/ShadcnSettingsRow.vue'),
      'utf8',
    )
    const rule = /\.shadcn-settings-row\s*\{([^}]*)\}/s.exec(rowSource)?.[1] ?? ''
    expect(rule, '设置行样式块没找到').toBeTruthy()
    expect(rule).toContain('min-height')
    expect(rule).toContain('--plume-size-control-h')
    expect(rule, '行高不该写死像素').not.toMatch(/min-height:\s*\d+px/)
  })
})
