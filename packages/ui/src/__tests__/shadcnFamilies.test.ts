/**
 * 「哪些组件算 shadcn 原始组件」必须只有一份名单。
 *
 * 用户口径（2026-11-02）：组件库使用标记里冒出 `SettingsRow` / `SettingsSection` 这类
 * 本项目在组件库里补的布局件；他只想看 shadcn 生成的组件。
 *
 * 名单有两处消费方：
 *   ① Vite 插件（Node 里跑，不能 import .vue）—— 决定给哪些模板标签加定位属性；
 *   ② registry（浏览器里跑）—— 决定哪些组件登记进 ui 目录。
 * 两边各写一份就会漂移，所以统一从 shadcnFamilies.ts 取。
 *
 * 2026-11-03：登记名不再带 shadcn 前缀；这里多钉一条「清单键 = 源码导出名」。
 */
import { describe, expect, it } from 'vitest'
import {
  SHADCN_FAMILY_NAMES,
  isShadcnPrimitive,
} from '@mini-canvas/ui-kit-shadcn/shadcnFamilies'
import { SHADCN_COMPONENT_NAMES } from '@mini-canvas/ui-kit-shadcn'

describe('shadcn 原始组件名单', () => {
  it('认得出 shadcn 生成件与它们的子件', () => {
    for (const name of ['Button', 'SelectTrigger', 'SelectValue', 'DropdownMenuContent', 'NumberFieldInput']) {
      expect(isShadcnPrimitive(name), name).toBe(true)
    }
  })

  it('不把本项目自造的布局件算进去', () => {
    for (const name of ['SettingsRow', 'SettingsSection', 'ThemePanel', 'SettingsSchemaField']) {
      expect(isShadcnPrimitive(name), name).toBe(false)
    }
  })

  it('名单非空且没有重复（改名单时手滑写两遍会在这里红）', () => {
    expect(SHADCN_FAMILY_NAMES.length).toBeGreaterThan(10)
    expect(new Set(SHADCN_FAMILY_NAMES).size).toBe(SHADCN_FAMILY_NAMES.length)
  })

  it('登记名就是 shadcn-vue 的导出名，不带 shadcn 前缀', () => {
    expect(SHADCN_COMPONENT_NAMES).toContain('Button')
    expect(SHADCN_COMPONENT_NAMES).toContain('DropdownMenuContent')
    expect(SHADCN_COMPONENT_NAMES.some((name) => name.startsWith('shadcn'))).toBe(false)
  })
})

