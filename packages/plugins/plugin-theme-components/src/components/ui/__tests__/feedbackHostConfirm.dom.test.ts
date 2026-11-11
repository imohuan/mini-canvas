// @vitest-environment happy-dom
/**
 * 确认框的「确认」必须真的返回 true。
 *
 * 用户实测 2026-11-07：插件管理点「卸载」→ 确认框 → 再点「卸载」，弹窗关了，
 * 但插件还在。根因是 AlertDialogAction 自带 DialogClose：它先把弹窗关掉，
 * 面板的 open setter 立刻走 service.cancel() 把结果定成 false，轮到我们的
 * 点击处理时请求已经结束。这里用真实内核 + DOM 点击把这条路径钉住。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { Context } from '@plume-canvas/canvas-data'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext, type FeedbackService } from '@plume-canvas/canvas-render'
import { themeComponentsPlugin } from '../../../index'
import FeedbackHost from '../FeedbackHost.vue'

let app: App | undefined
let ctx: Context | undefined

async function flush(): Promise<void> {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

async function boot(): Promise<FeedbackService> {
  ctx = new Context()
  ctx.plugin(themeComponentsPlugin)
  await ctx.start()

  const host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(FeedbackHost) })
  app.provide(RENDER_CONTEXT_KEY, { ctx } as unknown as CanvasRenderContext)
  app.mount(host)
  await flush()
  return ctx.get<FeedbackService>('feedback')
}

function buttonOf(label: string): HTMLButtonElement {
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-slot="alert-dialog-content"] button'),
  )
  const hit = buttons.find((button) => button.textContent?.trim() === label)
  if (!hit) throw new Error('确认框里没找到按钮：' + label + '，现有：' + buttons.map((b) => b.textContent).join(' / '))
  return hit
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  app?.unmount()
  app = undefined
  ctx?.stop()
  ctx = undefined
  document.body.innerHTML = ''
})

describe('确认框按「确认」', () => {
  it('点卸载返回 true，弹窗关闭，请求结束', async () => {
    const feedback = await boot()
    let answer: boolean | undefined
    void feedback.confirm({
      title: '卸载「示例 · 插件演练场」',
      description: '卸载后，它的界面与后台部分会一起停用。',
      confirmText: '卸载',
      cancelText: '取消',
      tone: 'destructive',
    }).then((value) => {
      answer = value
    })
    await flush()

    buttonOf('卸载').click()
    await flush()

    expect(answer, '点确认被当成了取消，调用方拿不到 true').toBe(true)
    expect(document.querySelector('[data-slot="alert-dialog-content"]')).toBeNull()
    expect(feedback.current).toBeNull()
  })

  it('点取消仍然返回 false', async () => {
    const feedback = await boot()
    let answer: boolean | undefined
    void feedback.confirm({ title: '卸载「测试」', confirmText: '卸载', cancelText: '取消' }).then((value) => {
      answer = value
    })
    await flush()

    buttonOf('取消').click()
    await flush()

    expect(answer).toBe(false)
    expect(document.querySelector('[data-slot="alert-dialog-content"]')).toBeNull()
  })
})
