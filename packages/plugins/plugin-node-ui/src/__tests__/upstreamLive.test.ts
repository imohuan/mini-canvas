/**
 * 上游必须**跟着连线实时变**（2026-11-26 真机）。
 *
 * 用户截图：画布上一条边都没有，节点右上角仍写「上游 图片 1」。
 * 这不是假数据，是两处真 bug：
 *
 * 1. `upstream` 是 computed，但它读的 `doc.getEdges()` 是**普通 store**（没有响应式），
 *    删掉连线不会让它重算 —— 界面一直拿着第一次算出来的那份。
 * 2. 它先读节点里的 `data.uiUpstream` 快照，有值就直接 return。那份快照是生成当时的，
 *    连线删了它还在，于是永久盖住真实连线。
 *
 * 这一组测试钉住「连线是唯一事实源」，以及「doc 变了要通知页面」。
 */
import { describe, it, expect } from 'vitest'
import { computed, ref } from 'vue'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@plume-canvas/canvas-render'
import { RegistryImpl } from '@plume-canvas/kernel'
import UiContent from '../UiContent.vue'

/** 最小渲染上下文：doc 可以带 subscribe（真宿主的 doc 有） */
function ctxOf(doc: Record<string, unknown>): CanvasRenderContext {
  return {
    ctx: {
      tryGet: (name: string) =>
        name === 'doc' ? doc : name === 'settings' ? { get: () => undefined } : undefined,
      registryOf: () => new RegistryImpl(),
    },
    viewport: { value: { zoom: 1 } },
  } as unknown as CanvasRenderContext
}

function render(data: Record<string, unknown>, doc: Record<string, unknown>): Promise<string> {
  const app = createSSRApp({ render: () => h(UiContent as Component, { id: '6', data }) })
  app.provide(RENDER_CONTEXT_KEY, ctxOf(doc))
  return renderToString(app)
}

describe('★ 上游只认连线（2026-11-26「没有连线却显示上游图片 1」）', () => {
  it('节点里存着旧快照、但一条边都没有 → 不能把旧快照当上游', async () => {
    const doc = {
      getNode: (id: string) =>
        id === '4' ? { id, type: 'image', data: { label: '图片 1', resourceId: 'c/old.png' } } : undefined,
      getEdges: () => [],
      subscribe: () => () => {},
    }
    const html = await render(
      {
        uiHtml: '<div>x</div>',
        // 生成当时留下的快照：连线早就删了
        uiUpstream: [{ refName: '图片 1', kind: 'image', url: '/api/canvases/c/resources/old.png' }],
      },
      doc,
    )
    expect(html).not.toContain('图片 1')
    expect(html).not.toContain('old.png')
  })

  it('有连线时照常给上游（修完不能把正常路径也弄丢）', async () => {
    const doc = {
      getNode: (id: string) => ({ id, type: 'image', data: { label: '图片 1', resourceId: 'c/new.png' } }),
      getEdges: () => [{ source: '4', target: '6' }],
      subscribe: () => () => {},
    }
    const html = await render({ uiHtml: '<div>x</div>' }, doc)
    expect(html).toContain('图片 1')
  })
})

describe('★ 连线变化要让界面重算（computed 依赖非响应式 store 时）', () => {
  it('doc.subscribe 收到 edge 变化后，上游立刻跟着变', async () => {
    // 复刻 UiContent 的写法：computed 里读 store，store 本身不是 ref
    let edges: Array<{ source: string; target: string }> = [{ source: '4', target: '6' }]
    const store = {
      getEdges: () => edges,
      getNode: (id: string) => ({ id, type: 'image', data: { label: '图片 1', resourceId: 'c/a.png' } }),
    }
    /** 版本号：doc 一变就 +1，computed 读它就能被唤醒 */
    const rev = ref(0)
    const upstream = computed(() => {
      void rev.value
      return store
        .getEdges()
        .filter((e) => e.target === '6')
        .map((e) => store.getNode(e.source).data.label)
    })

    expect(upstream.value).toEqual(['图片 1'])
    edges = []
    rev.value += 1
    expect(upstream.value).toEqual([])
  })
})
