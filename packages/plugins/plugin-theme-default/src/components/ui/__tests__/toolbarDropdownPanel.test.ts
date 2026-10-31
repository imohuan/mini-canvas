/**
 * toolbarDropdown 的自定义面板契约（用户 2026-10-31 截图：「自定义」右侧要出宫格面板）。
 *
 * 此前的 items 只能描述「一行文字」或「一串文字二级菜单」，宫格选择器只能另起一个
 * 下拉按钮挂在旁边 —— 用户看到的是一排两个入口，不是「自定义 ›」这一项。
 * 这里锁住新接口：
 * 1. panel.component 能真的渲染出来，并拿到 close / pick；
 * 2. panel.render 也能画（调用方自己组 VNode）；
 * 3. 老写法 children 仍是文字二级菜单，不被改坏；
 * 4. 没给 panel / children 的普通项照旧只是普通菜单行。
 */
import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ToolbarDropdownSubPanel from '../ToolbarDropdownSubPanel.vue'
import type { ToolbarMenuNode, ToolbarMenuPanelContext } from '../types'

const PanelProbe = defineComponent({
  name: 'PanelProbe',
  props: { panel: { type: Object, default: null } },
  setup(props) {
    return () =>
      h('div', { class: 'panel-probe', 'data-panel-key': (props.panel as { key?: string } | null)?.key ?? '' }, [
        h('button', { class: 'panel-confirm', onClick: () => (props.panel as { close?: () => void } | null)?.close?.() }, '确定'),
      ])
  },
})

/** 面板上下文的最小替身：子面板只读 key / label / close / pick */
function contextOf(node: ToolbarMenuNode): ToolbarMenuPanelContext {
  return {
    key: node.key,
    label: node.label,
    path: [node.key],
    node,
    closePanel: () => {},
    close: () => {},
    pick: () => {},
  }
}

function render(node: ToolbarMenuNode): Promise<string> {
  const app = createSSRApp({
    render: () => h(ToolbarDropdownSubPanel, { node, context: contextOf(node) }),
  })
  return renderToString(app)
}

describe('toolbarDropdown：自定义面板', () => {
  it('panel.component 在「自定义」右侧渲染出来（拿到当前项 key）', async () => {
    const html = await render(
      { key: 'custom', label: '自定义', panel: { component: PanelProbe, width: '200px' } },
    )
    expect(html).toContain('panel-probe')
    expect(html).toContain('data-panel-key="custom"')
  })

  it('panel.render 也能画（调用方自己组 VNode）', async () => {
    const html = await render({
      key: 'paint',
      label: '色板',
      panel: { render: (ctx) => h('div', { class: 'render-probe' }, ctx.label) },
    })
    expect(html).toContain('render-probe')
    expect(html).toContain('色板')
  })

  it('老写法 children 仍是文字二级菜单（不因新字段变形）', async () => {
    const html = await render({ key: 'sub', label: '更多', children: [{ key: 'a1', label: '子项一' }] })
    expect(html).toContain('子项一')
    expect(html).not.toContain('panel-probe')
  })

  it('普通项不冒箭头、不冒面板（既有菜单行行为不变）', async () => {
    const html = await render({ key: 'a', label: '动作一' })
    expect(html).not.toContain('tdb-chev')
    expect(html).not.toContain('panel-probe')
  })
})
