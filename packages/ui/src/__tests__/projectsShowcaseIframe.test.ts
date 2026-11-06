// @vitest-environment happy-dom
/**
 * 项目页「组件库」用 iframe 打开组件库自己的页面。
 *
 * 为什么要用 iframe（用户 2026-11-06）：内嵌组件时，预览页写 --radius / --font-body，
 * 成品应用的组件读 --mct-radius / --mct-font-body，两套变量在同一个 document 里互相覆盖，
 * 改圆角、改字体都没有反应。iframe 是独立 document，各用各的主题。
 */
import { describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import ProjectsShowcaseTab from '../components/projects/ProjectsShowcaseTab.vue'

async function mount(): Promise<HTMLIFrameElement | null> {
  // happy-dom 默认拒绝加载 iframe 页面（会抛 NotSupportedError）；这条只验 DOM 结构。
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  createApp({ render: () => h(ProjectsShowcaseTab) }).mount(host)
  await new Promise((r) => setTimeout(r, 0))
  quiet.mockRestore()
  return document.querySelector('iframe')
}

describe('组件库 iframe 页签', () => {
  it('渲染 iframe，并指向同源 ui-kit 子路径', async () => {
    const frame = await mount()
    expect(frame).not.toBeNull()
    expect(frame!.getAttribute('src')).toContain('/ui-kit/')
    expect(frame!.getAttribute('title')).toBe('组件库预览')
  })

  it('iframe 撑满主内容区（高度/宽度都 100%）', async () => {
    const frame = await mount()
    expect(frame!.className).toContain('h-full')
    expect(frame!.className).toContain('w-full')
    expect(frame!.parentElement!.className).toContain('h-full')
  })
})
