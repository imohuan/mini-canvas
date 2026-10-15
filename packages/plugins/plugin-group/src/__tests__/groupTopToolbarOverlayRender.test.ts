/**
 * 分组上控制栏浮层宿主 —— "resize 时收起"的渲染契约（SSR 拿真 HTML 断言）。
 *
 * 用户要求（原话）："节点 resize 的时候（分组节点 ，普通节点）不显示上下的 控制栏"。
 *
 * 普通节点由壳（BaseNode）自己压 —— 它的上下插槽就在节点里，壳读得到自己的局部状态。
 * 分组不同：它的控制栏挂在**画布 overlay 槽**（节点之外的层，见本组件文件头的层叠上下文说明），
 * 读不到壳的局部状态，所以只能读渲染层共享 activity 的 nodeResizeId。
 *
 * 本文件锁两条：
 * 1. 正在被 resize 的就是本分组 → 整条浮层不渲染（松手恢复）；
 * 2. 正在被 resize 的是别人 → 本分组浮层照常（不做全局压制，免得resize A 把 B 的栏也吃掉）。
 *
 * 第三条（用户要求）：「抓手工具」下同样收起 —— 抓手模式下节点不可拖、端口都被压掉，
 * 这条浮在卡片外的操作栏留着只是噪音。判据与 BaseNode / 底栏浮层同源：设置 nodesDraggable=false。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, defineComponent, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import GroupTopToolbarOverlay from '../GroupTopToolbarOverlay.vue'
import { GROUP_NODE_TYPE } from '../groupEngine'

/**
 * dropdown 替身：只摊平触发器插槽（收起态）。本文件不测色板内容，只测"整条浮层在不在"——
 * 真件的菜单是 v-if（收起时不渲染），这里给最小可渲染件，避免缺名组件在 SSR 里炸。
 */
const StubDropdown = defineComponent({
  name: 'StubDropdown',
  setup(_props, { slots }) {
    return () => h('div', { class: 'stub-dropdown' }, [slots.trigger?.()])
  },
})

/**
 * 最小渲染上下文：只桩出本组件真正读到的几项（selection / doc / nodeLayout / flow / interaction）。
 * 刻意给"恰好选中一个分组节点"的常态；本文件测的是 resize 维度的显隐，不是选中语义。
 */
function renderCtx(opts: { resizingId?: string | null; nodesDraggable?: boolean } = {}): CanvasRenderContext {
  const refOf = (v: unknown) => ({ value: v })
  const selectedIds = new Set<string>(['g1'])
  const groupNode = {
    id: 'g1',
    type: GROUP_NODE_TYPE,
    position: { x: 0, y: 0 },
    size: { w: 200, h: 100 },
    data: {},
  }
  const services: Record<string, unknown> = {
    selection: { ids: selectedIds, has: (id: string) => selectedIds.has(id), onChange: () => () => {} },
    doc: {
      getNode: (id: string) => (id === 'g1' ? groupNode : undefined),
      subscribe: () => () => {},
    },
    nodeLayout: { getNodeRect: () => ({ x: 0, y: 0, w: 200, h: 100 }) },
    // 抓手工具判据读它（真机恒有；不传 = 未声明，按"可拖"默认）
    settings: {
      get: (key: string) => (key === 'nodesDraggable' ? opts.nodesDraggable : undefined),
      onChange: () => ({ dispose: () => {} }),
    },
  }
  return {
    ctx: {
      get: (name: string) => services[name],
      tryGet: (name: string) => services[name],
      on: () => ({ dispose: () => {} }),
      // ui 目录（GroupTopToolbar 经 useUiComponent 取按钮/下拉）：本文件不测外观。
      // 按钮缺名时组件会回退到原生标签；dropdown 给一个最小替身（缺名会被渲染成注释，SSR 直接炸）。
      registryOf: () => ({
        top: (name: string) => (name === 'dropdown' ? { value: StubDropdown } : undefined),
        list: () => [],
        subscribe: () => ({ dispose() {} }),
      }),
    },
    flow: { viewport: refOf({ x: 0, y: 0, zoom: 1 }) },
    interaction: {
      isNodeDragging: refOf(false),
      isSelecting: refOf(false),
      nodeResizing: refOf(opts.resizingId != null),
      nodeResizeId: refOf(opts.resizingId ?? null),
    },
  } as unknown as CanvasRenderContext
}

function render(opts: { resizingId?: string | null; nodesDraggable?: boolean } = {}): Promise<string> {
  const app = createSSRApp({ render: () => h(GroupTopToolbarOverlay as Component) })
  app.provide(RENDER_CONTEXT_KEY, renderCtx(opts))
  return renderToString(app)
}

describe('分组上控制栏浮层：resize 时收起（用户要求）', () => {
  it('常态（没人在 resize）→ 浮层照常渲染', async () => {
    const html = await render()
    expect(html).toContain('group-top-toolbar-overlay')
    expect(html).toContain('group-top-toolbar')
  })

  it('正在被 resize 的就是本分组 → 整条浮层不渲染', async () => {
    const html = await render({ resizingId: 'g1' })
    expect(html).not.toContain('group-top-toolbar-overlay')
    expect(html).not.toContain('group-top-toolbar')
  })

  it('正在被 resize 的是别人 → 本分组浮层照常（不做全局压制）', async () => {
    const html = await render({ resizingId: 'other-node' })
    expect(html).toContain('group-top-toolbar')
  })

  it('抓手工具（nodesDraggable=false）→ 整条浮层不渲染', async () => {
    const html = await render({ nodesDraggable: false })
    expect(html).not.toContain('group-top-toolbar-overlay')
    expect(html).not.toContain('group-top-toolbar')
  })

  it('移动工具（nodesDraggable=true）→ 浮层照常（抓手那条不是"永久收起"）', async () => {
    const html = await render({ nodesDraggable: true })
    expect(html).toContain('group-top-toolbar')
  })

  it('未声明 nodesDraggable（宿主没装交互配置）→ 按可拖默认，浮层照常', async () => {
    const html = await render()
    expect(html).toContain('group-top-toolbar')
  })
})
