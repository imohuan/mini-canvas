/**
 * nodeTypeIcon.test —— 节点类型图标的整链集成（真实插件装配）。
 *
 * 覆盖"注册 → 消费"这条链上单包测不到的部分：
 *   插件 ctx.nodes.register({ icon }) → nodeStore 类型表 → 内核菜单服务 menuFor('pane') 的新建节点项。
 * 单点判定（字符串/组件/none）由 canvas-data 的 iconKind.test.ts 负责，此处不重复。
 */
import { describe, it, expect } from 'vitest'
import { createMiniCanvasHost } from '../createMiniCanvasHost'
import { MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import { iconRenderMode } from '@mini-canvas/kernel'
import { type MenuService } from '@mini-canvas/canvas-data'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'

describe('节点类型图标整链（插件注册 → 类型表 → 菜单）', () => {
  it('text/image 插件声明的 icon 落到 nodeStore 并被菜单新建节点项带上', async () => {
    const { host } = await createMiniCanvasHost({
      adapter: new MemoryStorageAdapter(),
      coldPlugins: [nodeTextPlugin, nodeImagePlugin],
    })

    // ① 插件注册 → nodeStore 类型表（声明的是 SVG 字符串 = opaque 句柄）
    const textIcon = host.nodeStore.types.get('text')?.icon
    const imageIcon = host.nodeStore.types.get('image')?.icon
    expect(iconRenderMode(textIcon)).toBe('html')
    expect(iconRenderMode(imageIcon)).toBe('html')
    expect(String(textIcon)).toContain('<svg')

    // ② 类型表 → 内核菜单服务（宿主右键 openMenu 的同款调用）
    const menu = host.ctx.get<MenuService>('menu')
    const creatable = [...host.nodeStore.types.values()].map((t) => ({
      type: t.type,
      label: t.label,
      icon: t.icon,
    }))
    const items = menu.menuFor('pane', creatable)
    expect(items.find((i) => i.id === 'create-node:text')?.icon).toBe(textIcon)
    expect(items.find((i) => i.id === 'create-node:image')?.icon).toBe(imageIcon)

    host.stop()
  })

  it('未声明图标的节点类型：类型表字段为空，标题侧据此不渲染图标位', async () => {
    const { host } = await createMiniCanvasHost({
      adapter: new MemoryStorageAdapter(),
      coldPlugins: [nodeTextPlugin, nodeImagePlugin],
    })
    const menu = host.ctx.get<MenuService>('menu')
    // 传一个无 icon 的类型：菜单项不应带 icon 字段（由显示层给占位）
    const items = menu.menuFor('pane', [{ type: 'plain', label: '无图标' }])
    expect(items[0].icon).toBeUndefined()
    expect(iconRenderMode(items[0].icon)).toBe('none')
    host.stop()
  })
})
