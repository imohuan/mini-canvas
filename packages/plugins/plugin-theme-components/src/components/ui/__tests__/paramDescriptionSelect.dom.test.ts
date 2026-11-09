// @vitest-environment happy-dom
/**
 * 下拉参数的说明**真的画出来了**（用户 2026-11-09：「参数应该还需要提供描述……
 * 前端 UI 也需要渲染出来」）。
 *
 * 为什么单独一条 DOM 测试：SelectContent 经 Teleport 送到 body，
 * SSR 的字符串里根本看不到选项区 —— 只断言源码会「看起来通过、实际没画」。
 * 这里真的点开下拉，再从 document 里读回那行说明。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import ToolParamField from '../ToolParamField.vue'

let app: App | undefined
let host: HTMLElement | undefined

const HINT = '决定输出的画面比例，影响构图与裁切'

async function flush(): Promise<void> {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

async function mount(param: Record<string, unknown>): Promise<void> {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(ToolParamField, { param, modelValue: '16:9', idPrefix: 'tp' }) })
  app.mount(host)
  await flush()
}

/**
 * 点开下拉：reka 的 Select 用 **PointerDown** 打开，happy-dom 里没有 PointerEvent，
 * 所以用 MouseEvent 顶替（只带 type 与冒泡，够触发器判断用）。
 */
function openSelect(trigger: HTMLElement): void {
  trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
  trigger.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true }))
  trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

afterEach(() => {
  app?.unmount()
  host?.remove()
  document.body.innerHTML = ''
  app = undefined
  host = undefined
})

describe('下拉展开后的说明行', () => {
  it('点开下拉，能看到那行说明', async () => {
    await mount({
      key: 'ratio',
      label: '比例',
      description: HINT,
      type: 'select',
      options: [
        { label: '16:9', value: '16:9' },
        { label: '9:16', value: '9:16' },
      ],
    })
    const trigger = host!.querySelector<HTMLElement>('[data-slot="select-trigger"]')
    expect(trigger, '没渲染出下拉触发器').toBeTruthy()
    openSelect(trigger!)
    await flush()

    const hint = document.querySelector('.tpf-select-hint')
    expect(hint, '下拉展开了但没有说明行').toBeTruthy()
    expect(hint!.textContent).toContain(HINT)
  })

  it('没写 description 时不多出一行', async () => {
    await mount({
      key: 'ratio',
      label: '比例',
      type: 'select',
      options: [{ label: '16:9', value: '16:9' }],
    })
    openSelect(host!.querySelector<HTMLElement>('[data-slot="select-trigger"]')!)
    await flush()
    expect(document.querySelector('.tpf-select-hint')).toBeNull()
  })
})
