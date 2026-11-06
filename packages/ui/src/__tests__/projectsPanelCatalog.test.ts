/**
 * 项目页面板取件：组件来自根 ctx 的 ui 目录，不是模块级静态兜底。
 *
 * 为什么单独一条：项目页没有 CanvasHost，也没有 RENDER_CONTEXT；如果 SlotHost
 * 或面板组件误用 useCanvasRender，这里会直接抛错。使用根 Provider 的同一份
 * CANVAS_CONTEXT_KEY 来渲染，正好覆盖真实路径。
 */
import { describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { Context, MemoryStorageAdapter, createCanvasAppBasePlugin } from '@mini-canvas/canvas-data'
import {
  CANVAS_CONTEXT_KEY,
  SlotHost,
  uiComponent,
  useCanvasContext,
  useUiComponent,
  type CanvasContext,
} from '@mini-canvas/canvas-render'
import { themeComponentsPlugin } from '@mini-canvas/plugin-theme-components'
import { projectsPanelPlugin } from '../projectsPanelPlugin'

function ctxOnly(ctx: Context): CanvasContext {
  const fail = (name: string): never => {
    throw new Error('项目页没有 ' + name)
  }
  return {
    ctx,
    get host(): never {
      return fail('host')
    },
    get api(): never {
      return fail('api')
    },
    get manager(): never {
      return fail('manager')
    },
  }
}

describe('项目页面板的组件来源', () => {
  it('在项目页上下文里按名取件拿得到 Button（不依赖画布渲染上下文）', async () => {
    const quiet = console.warn
    console.warn = () => {}
    const ctx = new Context()
    ctx.plugin(createCanvasAppBasePlugin({ adapter: new MemoryStorageAdapter(), persistSettings: false }).plugin)
    ctx.plugin(themeComponentsPlugin)
    await ctx.start()

    const Probe = defineComponent({
      setup() {
        const { ctx: injected } = useCanvasContext()
        const atSetup = injected.registryOf<unknown>('ui').top('Button')?.value ? '1' : '0'
        const Button = useUiComponent('Button')
        return () =>
          h('div', {
            'data-has-button': Button.value ? '1' : '0',
            'data-direct': injected.registryOf<unknown>('ui').top('Button')?.value ? '1' : '0',
            'data-at-setup': atSetup,
          })
      },
    })
    const app = createSSRApp({ render: () => h(Probe) })
    app.provide(CANVAS_CONTEXT_KEY, ctxOnly(ctx))
    const html = await renderToString(app)
    expect(html).toContain('data-has-button="1"')
    expect(html).toContain('data-direct="1"')
    expect(html).toMatch(/data-at-setup="1"/)
    ctx.stop()
    // useUiComponent 的订阅随组件作用域回收；停止 ctx 后按设计会提示一次，
    // 这里在恢复 console 前静音，避免测试输出噪音。
    console.warn = quiet
  })

  it('Button 从根 ctx 的 ui 目录取，项目页渲染不依赖画布上下文', async () => {
    const captured: string[] = []
    const original = console.warn
    console.warn = (...args: unknown[]) => {
      captured.push(args.map(String).join(' ') + '\n' + new Error().stack)
    }
    const ctx = new Context()
    ctx.plugin(createCanvasAppBasePlugin({ adapter: new MemoryStorageAdapter(), persistSettings: false }).plugin)
    ctx.plugin(themeComponentsPlugin)
    ctx.plugin(projectsPanelPlugin)
    await ctx.start()

    const registered = ctx.registryOf<unknown>('ui').top('Button')?.value
    expect(registered, 'ui 目录没有 Button').toBeTruthy()
    // 用同一个"按名取件"函数再查一次：把"目录里存着"与"渲染时读得到"分开验。
    expect(uiComponent(ctx, 'Button'), '按名取件拿不到 Button').toBeTruthy()

    const app = createSSRApp({ render: () => h(SlotHost, { slot: 'app.projects.tabs' }) })
    app.provide(CANVAS_CONTEXT_KEY, ctxOnly(ctx))
    const html = await renderToString(app)

    // 渲染阶段不该缺 Button。（卸载插件时目录变空会提示一次，那是另一件事。）
    expect(captured.join('\n')).not.toContain('没有名为 "Button"')
    console.warn = original

    // 项目页的「组件库」页签：用 iframe 打开组件库自己的预览站。
    // 不再把组件直接塞进这个 document —— 两套主题变量会互相覆盖（圆角/字体改不动）。
    expect(html).toContain('<iframe')
    expect(html).toContain('/ui-kit/')
    expect(html).toContain('组件库预览')
    ctx.stop()
    console.warn = original
  })
})
