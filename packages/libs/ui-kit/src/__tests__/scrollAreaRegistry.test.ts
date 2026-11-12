/**
 * 注册表必须收全 ScrollArea 目录里的两个组件。
 *
 * 用户 2026-11-06 报「模型卡片视图没有滚动条、技能面板有滚动条」：
 * 根因是 buildManifest 用「组件名以 family 开头」做过滤 —— ScrollArea 目录同时导出
 * ScrollArea 与 ScrollBar，而 ScrollBar 不以 ScrollArea 开头，被漏掉了。
 * 主题薄层注入的那份 ScrollArea 于是只剩 viewport：内容能滚，右侧没有条。
 */
import { describe, expect, it } from 'vitest'
import { SHADCN_COMPONENTS, SHADCN_COMPONENT_NAMES } from '../registry'

describe('ScrollArea 组件注册', () => {
  it('ScrollArea 与 ScrollBar 都在注册表里', () => {
    expect(SHADCN_COMPONENT_NAMES).toContain('ScrollArea')
    expect(SHADCN_COMPONENT_NAMES).toContain('ScrollBar')
    expect(SHADCN_COMPONENTS.ScrollBar).toBeTruthy()
  })

  it('注册表里没有小写开头的 helper / 变体常量', () => {
    for (const name of SHADCN_COMPONENT_NAMES) {
      expect(name[0], name).toBe(name[0]?.toUpperCase())
    }
  })
})

