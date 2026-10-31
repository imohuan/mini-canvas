/**
 * SSR 渲染：组件初始状态必须能 renderToString，不因 rAF / observer 缺失而抛。
 *
 * 主题插件在文档站、服务端渲染的预览里会直接引入这些组件；如果只在浏览器环境能跑，
 * 表现是“开发页好好的，SSR 一渲染就 500”，而且错误指向一个与业务无关的动画帧全局。
 *
 * 默认在 happy-dom 下跑；`--environment node` 也能通过（无 window / rAF），
 * 所以这条测试同时守住两种环境。
 */
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import Dropdown from '../components/dropdown/Dropdown.vue'
import Tooltip from '../components/tooltip/Tooltip.vue'
import SplitPane from '../components/split-pane/SplitPane.vue'

describe('ui-kit 无浏览器环境', () => {
  it('Dropdown 初始关闭可 SSR', async () => {
    const app = createSSRApp({
      render: () => h(Dropdown, { modelValue: false }, {
        trigger: () => h('button', '打开'),
        default: () => h('div', '菜单'),
      }),
    })
    const html = await renderToString(app)
    expect(html).toContain('mck-dropdown')
    expect(html).toContain('打开')
    // Teleport 内容在服务端不渲染；至少不能抛错。
    expect(html).not.toContain('mck-dropdown__panel')
  })

  it('Tooltip 初始关闭可 SSR', async () => {
    const app = createSSRApp({
      render: () => h(Tooltip, { content: '提示' }, { default: () => h('button', '触发') }),
    })
    const html = await renderToString(app)
    expect(html).toContain('mck-tooltip-trigger')
    expect(html).toContain('触发')
  })

  it('SplitPane 可 SSR（不直接 new ResizeObserver）', async () => {
    const app = createSSRApp({
      render: () => h(SplitPane, null, {
        left: () => h('div', '左'),
        right: () => h('div', '右'),
      }),
    })
    const html = await renderToString(app)
    expect(html).toContain('mck-split')
  })
})
