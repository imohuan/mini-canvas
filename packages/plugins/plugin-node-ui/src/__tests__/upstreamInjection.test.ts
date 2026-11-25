/**
 * 「注入到底有没有进到 iframe 文档里」——用 SSR 拿真 HTML 断言，而不是看截图猜。
 *
 * 用户 2026-11-25 报的现象：节点明明连着图片，界面右上角却写「无上游图片」。
 * 他怀疑两件事：① 全局变量没被注入；② 节点里没保存上游参数。
 *
 * 这条用例把两者分开钉死：
 *   · 注入确实在：srcdoc 里有 __CANVAS_UPSTREAM__ / __CANVAS_INPUTS__ / CanvasUI；
 *   · 内容要对：上游节点**只有 resourceId**（新节点不存 imageUrl）时，
 *     注入的数据里也必须带一个能直接用的 url，否则界面自己会判「没连素材」。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@plume-canvas/canvas-render'
import { RegistryImpl } from '@plume-canvas/kernel'
import UiContent from '../UiContent.vue'

const CANVAS = '90da8d5cbf06424d'
const NAME = 'c4d62955120799cc.png'

/** 一张真画布：图片节点(4) 只存 resourceId，连到 ui 节点(6) */
function renderCtx(): CanvasRenderContext {
  const nodes = [
    { id: '4', type: 'image', data: { label: '图片 1', resourceId: CANVAS + '/' + NAME } },
    { id: '6', type: 'ui', data: { label: '可视化 1' } },
  ]
  return {
    ctx: {
      tryGet: (name: string) =>
        name === 'doc'
          ? {
              getNode: (id: string) => nodes.find((n) => n.id === id),
              getNodes: () => nodes,
              getEdges: () => [{ source: '4', target: '6' }],
            }
          : name === 'settings'
            ? { get: () => undefined }
            : undefined,
      registryOf: () => new RegistryImpl(),
    },
    viewport: { value: { zoom: 1 } },
  } as unknown as CanvasRenderContext
}

async function renderNode(data: Record<string, unknown>): Promise<string> {
  const app = createSSRApp({
    render: () => h(UiContent as Component, { id: '6', data }),
  })
  app.provide(RENDER_CONTEXT_KEY, renderCtx())
  return renderToString(app)
}

describe('★ 上游素材注入（2026-11-25 无上游图片）', () => {
  it('注入的三个全局变量都在 iframe 文档里', async () => {
    const html = await renderNode({ uiHtml: '<div id="paint">hi</div>' })
    expect(html).toContain('__CANVAS_UPSTREAM__')
    expect(html).toContain('__CANVAS_INPUTS__')
    expect(html).toContain('__CANVAS_UI__')
    expect(html).toContain('CanvasUI')
  })

  it('★ 上游只有 resourceId 时，注入里也要有可用地址（界面才不会显示「无上游图片」）', async () => {
    const html = await renderNode({ uiHtml: '<div id="paint">hi</div>' })
    // srcdoc 里的 JSON 是转义过的，检查路径片段即可
    expect(html).toContain('/api/canvases/' + CANVAS + '/resources/' + NAME)
    expect(html).toContain(CANVAS + '/' + NAME)
  })
})
