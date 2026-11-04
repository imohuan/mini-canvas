/**
 * 抓手工具（hand tool）下压掉端口球 —— 用户要求。
 *
 * 语义：端口的本职是「拖节点用的手柄」。抓手模式下拖动是**平移画布**、节点根本不会被拖走
 * （抓手 = 设置 nodesDraggable=false），端口留着只会误导，所以整体不显示；切回「移动」工具
 * （nodesDraggable=true）照常显示。
 *
 * 唯一事实来源 = 宿主级设置 `nodesDraggable`（分组「常规/画布」）—— 底栏「移动 / 抓手」按钮
 * 与设置面板里的「节点可拖拽」改的都是它。所以这条测试同时锁住两件事：
 * 1. 抓手（nodesDraggable=false）→ 端口不出 is-visible；
 * 2. 移动（nodesDraggable=true 或未声明）→ 端口照常出。
 *
 * 用 SSR 拿真实 HTML 断言（选中态常显是唯一无需 hover 就能看到端口的路径，故用 selected:true）。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { NodeRegistry } from '@mini-canvas/canvas-data'
import { RegistryImpl } from '@mini-canvas/kernel'
import { RENDER_CONTEXT_KEY, useVueFlow, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import BaseNode from '../BaseNode.vue'

// BaseNode setup 会挂/摘 document 键盘监听（F2 改名）；Node 环境给最小桩。
;(globalThis as unknown as { document: unknown }).document = {
  addEventListener() {},
  removeEventListener() {},
}

function renderCtx(settings: Record<string, unknown>): CanvasRenderContext {
  const refOf = (v: unknown) => ({ value: v })
  const services: Record<string, unknown> = {
    doc: { types: new Map(), getNode: () => undefined, updateNode: () => {} },
    settings: { get: (key: string) => settings[key], onChange: () => ({ dispose: () => {} }) },
    selection: { ids: new Set<string>(), has: () => false, onChange: () => () => {} },
  }
  return {
    ctx: {
      get: (name: string) => services[name],
      tryGet: (name: string) => services[name],
      registryOf: () => new RegistryImpl(),
    },
    registry: new NodeRegistry(),
    nodeWrite: () => {},
    handleParams: {
      handleRestOffset: 36, handleCursorGap: 24, handleButtonSize: 32,
      portZoneWidth: 10, portZoneHeightRatio: 0.55, portZoneOffset: 0,
      portZoneShape: 'arc', portZoneArcRatio: 0.8,
    },
    connectionState: {
      isConnecting: refOf(false), hoverNode: refOf(null), aimedTarget: refOf(null),
      suppressHandles: refOf(false), activeConnection: refOf(null),
    },
    interaction: { isNodeDragging: refOf(false), isSelecting: refOf(false) },
    debug: { handleDebug: false, connectionSnapDebugVisible: false },
    snapZone: {},
    visibleRect: refOf(null),
    flow: {
      viewport: refOf({ zoom: 1, x: 0, y: 0 }),
      updateNodeVisualSize: () => {},
      getNodeRenderPosition: () => undefined,
    },
  } as unknown as CanvasRenderContext
}

/** 渲染一个**选中**的图片节点（选中 → 端口本应常显，是无需 hover 的唯一路径） */
function renderSelected(settings: Record<string, unknown>): Promise<string> {
  const app = createSSRApp({
    setup() {
      useVueFlow().viewport.value = { x: 0, y: 0, zoom: 1 }
      return () => h(BaseNode, { id: 'n1', type: 'image', data: {}, selected: true })
    },
  })
  app.provide(RENDER_CONTEXT_KEY, renderCtx(settings))
  return renderToString(app)
}

const isVisible = (html: string): boolean => /class="[^"]*moving-handle-anchor[^"]*is-visible/.test(html)

describe('抓手模式下压掉端口球（nodesDraggable=false）', () => {
  it('移动工具（nodesDraggable=true）：选中节点端口常显', async () => {
    const html = await renderSelected({ nodesDraggable: true })
    expect(isVisible(html)).toBe(true)
  })

  it('未声明 nodesDraggable（宿主没装交互配置）：按可拖默认，端口照常显示', async () => {
    const html = await renderSelected({})
    expect(isVisible(html)).toBe(true)
  })

  it('抓手工具（nodesDraggable=false）：端口不出 is-visible', async () => {
    const html = await renderSelected({ nodesDraggable: false })
    expect(isVisible(html)).toBe(false)
  })
})
