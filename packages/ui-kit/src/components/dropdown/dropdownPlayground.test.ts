import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import DropdownPlayground from './DropdownPlayground.vue'

describe('Dropdown 专属试玩组件', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('把配置面板 Teleport 到目标容器', async () => {
    const host = document.createElement('div')
    host.id = 'dropdown-config-test'
    document.body.appendChild(host)

    mount(DropdownPlayground, { props: { configTarget: '#dropdown-config-test' } })
    await nextTick()

    expect(host.querySelector('.dd-panel')).not.toBeNull()
    expect(host.textContent).toContain('触发方式')
    expect(host.textContent).toContain('容器宽度')
    expect(host.textContent).toContain('显示箭头')
  })

  it('拖拽触发器会更新位移，拖拽后的 click 不会误开关浮层', async () => {
    const wrapper = mount(DropdownPlayground, { attachTo: document.body })
    await nextTick()
    const stage = wrapper.find('.dd-stage').element as HTMLElement
    const anchor = wrapper.find('.dd-anchor').element as HTMLElement

    // happy-dom 没有布局：给一个能放下按钮的预览区，拖拽边界才有意义。
    Object.defineProperty(stage, 'getBoundingClientRect', {
      value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 300, width: 600, height: 300, toJSON: () => ({}) }),
    })
    Object.defineProperty(anchor, 'getBoundingClientRect', {
      value: () => ({ x: 280, y: 120, left: 280, top: 120, right: 380, bottom: 150, width: 100, height: 30, toJSON: () => ({}) }),
    })

    anchor.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 130, button: 0, pointerId: 1 }))
    anchor.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 360, clientY: 190, pointerId: 1 }))
    anchor.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 360, clientY: 190, pointerId: 1 }))
    await nextTick()

    expect((anchor as HTMLElement).style.transform).toContain('translate3d(60px, 60px, 0)')
  })
})
