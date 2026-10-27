/**
 * CanvasProvider 的启动责任契约。
 *
 * Node 测试环境没有 DOM，挂一个带 onMounted 的 SFC 不稳；这里锁的是“责任归谁”：
 * - 内核只在 Provider 里创建，Host 不再自己创建；
 * - 卸载后必须 stop（且要在子组件卸载之后，用 onUnmounted）；
 * - 启动没返回时组件已卸载，也要把刚建好的宿主停掉；
 * - ready 前只显示 loading，失败只显示 error，默认插槽不提前挂载。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('CanvasProvider 启动责任', () => {
  it('Provider 是唯一启动点，并在卸载后 stop', () => {
    const src = read('../CanvasProvider.vue')
    expect(src).toContain('createMiniCanvasHost')
    expect(src).toContain('exposeToWindow(props.windowKey)')
    expect(src).toContain('onUnmounted')
    expect(src).toContain('host.stop()')
    expect(src).toContain('CANVAS_CONTEXT_KEY')
    expect(src).toContain('disposed')
  })

  it('Provider 只在 ready 后显示默认插槽', () => {
    const src = read('../CanvasProvider.vue')
    expect(src).toContain('v-if="ready"')
    expect(src).toContain('name="loading"')
    expect(src).toContain('name="error"')
  })
})
