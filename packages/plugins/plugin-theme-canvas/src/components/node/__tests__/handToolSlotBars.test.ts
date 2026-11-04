/**
 * 抓手工具下压掉节点上/下两排状态栏 —— 用户要求。
 *
 * 语义：抓手模式下拖动是**平移画布**、节点根本不会被拖走，那两排「操作这个节点」的栏
 * （out:top / out:bottom）留在卡片外只是噪音，所以整体不显示；切回「移动」工具照常显示。
 *
 * 唯一事实来源 = 宿主级设置 `nodesDraggable`（分组「常规/画布」）—— 与端口球压制、
 * 底栏浮层压制同源（见 handToolPortVisibility.test.ts 与 plugin-bottom-bar 的 bottomBarOverlay.ts）。
 *
 * 边界：只收卡片外面那两排栏。卡片上的编辑浮层（over:inset）与任务进度不是「控制栏」，
 * 抓手模式下照旧要画 —— 收掉它们会让正在跑的生成任务看不见进度，是倒退。
 *
 * 用 SSR 拿真实 HTML 断言（这几条全是"模板有没有真的把那一层画出来"的形态）。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
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

const ContentStub = defineComponent({ name: 'ContentStub', render: () => h('div', { class: 'probe-content' }) })
const TopStub = defineComponent({ name: 'TopStub', render: () => h('button', { class: 'probe-top' }) })
const BottomStub = defineComponent({ name: 'BottomStub', render: () => h('div', { class: 'probe-bottom' }) })
const OverlayStub = defineComponent({ name: 'OverlayStub', render: () => h('div', { class: 'probe-overlay' }) })

function renderCtx(registry: NodeRegistry, settings: Record<string, unknown>): CanvasRenderContext {
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
    registry,
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
    interaction: {
      isNodeDragging: refOf(false), isSelecting: refOf(false),
      nodeResizing: refOf(false), nodeResizeId: refOf(null),
    },
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

/** 渲染一个带 out:top / out:bottom / over:inset 三种段的图片节点 */
function renderNode(settings: Record<string, unknown>): Promise<string> {
  const registry = new NodeRegistry()
  registry.register('image', {
    in: ContentStub,
    'out:top': TopStub,
    'out:bottom': BottomStub,
    'over:inset': OverlayStub,
  })
  const app = createSSRApp({
    setup() {
      useVueFlow().viewport.value = { x: 0, y: 0, zoom: 1 }
      return () => h(BaseNode, { id: 'n1', type: 'image', data: {}, selected: true })
    },
  })
  app.provide(RENDER_CONTEXT_KEY, renderCtx(registry, settings))
  return renderToString(app)
}

describe('抓手工具下压掉上下状态栏（nodesDraggable=false）', () => {
  it('移动工具（nodesDraggable=true）：上/下两排栏照常渲染', async () => {
    const html = await renderNode({ nodesDraggable: true })
    expect(html).toContain('probe-top')
    expect(html).toContain('probe-bottom')
  })

  it('未声明 nodesDraggable（宿主没装交互配置）：按可拖默认，两排栏照常渲染', async () => {
    const html = await renderNode({})
    expect(html).toContain('probe-top')
    expect(html).toContain('probe-bottom')
  })

  it('抓手工具（nodesDraggable=false）：上/下两排栏整层不渲染', async () => {
    const html = await renderNode({ nodesDraggable: false })
    expect(html).not.toContain('probe-top')
    expect(html).not.toContain('probe-bottom')
    expect(html).not.toContain('v2-slot')
  })

  it('抓手工具只收那两排栏：卡片内容照常渲染（不是把节点整个藏掉）', async () => {
    const html = await renderNode({ nodesDraggable: false })
    expect(html).toContain('probe-content')
  })

  it('抓手工具不吃编辑浮层（over:inset）：它不是"控制栏"，收掉会让裁剪框失效', async () => {
    const html = await renderNode({ nodesDraggable: false })
    expect(html).toContain('probe-overlay')
  })
})
