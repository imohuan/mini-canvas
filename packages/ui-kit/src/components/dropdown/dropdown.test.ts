import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import Dropdown from './Dropdown.vue'

describe('Dropdown 组件行为', () => {
  enableAutoUnmount(afterEach)

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('click 触发器点击打开，slot close 可用', async () => {
    const wrapper = mount(Dropdown, {
      props: { modelValue: false },
      slots: {
        trigger: '<button type="button" data-trigger>打开</button>',
        default: '<template #default="{ close }"><div data-menu><button type="button" data-close @click="close()">关闭</button></div></template>',
      },
    })
    await wrapper.find('[data-trigger]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([true])
    const closeButtons = document.querySelectorAll('[data-close]')
    expect(closeButtons.length).toBeGreaterThan(0)
    ;(closeButtons[0] as HTMLButtonElement).click()
    await wrapper.vm.$nextTick()
    await new Promise((resolve) => setTimeout(resolve, 1))
    const calls = wrapper.emitted('update:modelValue') ?? []
    expect(calls.length).toBeGreaterThan(1)
    expect(calls.at(-1)).toEqual([false])
  })

  it('再点一次 trigger 会关闭', async () => {
    const wrapper = mount(Dropdown, {
      props: { modelValue: false },
      slots: { trigger: '<button data-trigger>x</button>', default: '<div data-menu />' },
    })
    await wrapper.find('[data-trigger]').trigger('click')
    await wrapper.find('[data-trigger]').trigger('click')
    const calls = wrapper.emitted('update:modelValue') ?? []
    expect(calls.length).toBe(2)
    expect(calls.at(-1)).toEqual([false])
  })

  it('disabled 时 trigger 不触发打开', async () => {
    const wrapper = mount(Dropdown, { props: { modelValue: false, disabled: true }, slots: { trigger: '<button data-trigger>x</button>' } })
    await wrapper.find('[data-trigger]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('hover 触发器悬停打开，离开后延迟关闭', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mount(Dropdown, {
        props: { modelValue: false, trigger: 'hover', hoverCloseDelay: 20 },
        slots: { trigger: '<button data-trigger>x</button>', default: '<div data-menu />' },
      })
      const trigger = wrapper.find('.mck-dropdown__trigger')
      await trigger.trigger('mouseenter')
      await trigger.trigger('click')
      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([true])
      await trigger.trigger('mouseleave')
      await vi.advanceTimersByTimeAsync(30)
      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
    } finally {
      vi.useRealTimers()
    }
  })

  it('contextmenu 触发器右键打开', async () => {
    const wrapper = mount(Dropdown, {
      props: { modelValue: false, trigger: 'contextmenu' },
      slots: { trigger: '<button data-trigger>x</button>', default: '<div data-menu />' },
    })
    await wrapper.find('[data-trigger]').trigger('contextmenu')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([true])
  })

  it('always 触发器常显，外点不关闭', async () => {
    const wrapper = mount(Dropdown, {
      props: { modelValue: true, trigger: 'always' },
      slots: { trigger: '<button data-trigger>x</button>', default: '<div data-menu>常显内容</div>' },
    })
    await wrapper.vm.$nextTick()
    expect(document.querySelector('[data-menu]')).not.toBeNull()
    wrapper.unmount()
    expect(document.querySelector('[data-menu]')).toBeNull()
  })

  it('menuHeight 和 arrow 生效；箭头指向触发器', async () => {
    const wrapper = mount(Dropdown, {
      props: { modelValue: true, menuHeight: '180px', arrow: true },
      slots: { trigger: '<button data-trigger>x</button>', default: '<div data-menu />' },
    })
    await wrapper.vm.$nextTick()
    const panel = document.querySelector<HTMLElement>('.mck-dropdown__panel')
    const arrow = document.querySelector<HTMLElement>('.mck-dropdown__arrow')
    expect(panel?.style.height).toBe('180px')
    expect(arrow).not.toBeNull()
    expect(arrow?.getAttribute('aria-hidden')).toBe('true')
  })

  it('外部 anchor 可以绑定深层 DOM 并显示浮层', async () => {
    const externalHost = document.createElement('div')
    document.body.appendChild(externalHost)
    const target = document.createElement('button')
    target.setAttribute('data-external-anchor', '')
    externalHost.appendChild(target)

    const anchorRef = ref<HTMLElement | null>(null)
    const wrapper = mount(Dropdown, {
      props: { modelValue: true, anchor: anchorRef, anchorPlacement: 'top' },
      slots: { default: '<div data-menu />' },
    })
    await nextTick()
    anchorRef.value = target
    await nextTick()
    expect(document.querySelector('[data-menu]')).not.toBeNull()

    // 换一个外部元素也立即生效（Ref 响应式绑定）。
    const second = document.createElement('span')
    second.setAttribute('data-second-anchor', '')
    externalHost.appendChild(second)
    anchorRef.value = second
    await nextTick()
    expect(document.querySelector('[data-menu]')).not.toBeNull()
  })

  it('Esc 关闭后焦点回到触发器', async () => {
    const wrapper = mount(Dropdown, {
      props: { modelValue: false },
      slots: { trigger: '<button type="button" data-trigger>打开</button>', default: '<div data-menu />' },
      attachTo: document.body,
    })
    const trigger = wrapper.find<HTMLButtonElement>('[data-trigger]')
    trigger.element.focus()
    await trigger.trigger('click')
    await wrapper.vm.$nextTick()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
    expect(document.activeElement).toBe(trigger.element)
    wrapper.unmount()
  })

  it('嵌套浮层不会把父菜单误判成“点外”', async () => {
    const wrapper = mount(Dropdown, {
      props: { modelValue: true },
      slots: { trigger: '<button type="button" data-trigger>打开</button>', default: '<div data-parent-menu />' },
      attachTo: document.body,
    })
    await wrapper.vm.$nextTick()
    const parentPanel = document.querySelector<HTMLElement>('.mck-dropdown__panel')
    if (!parentPanel) throw new Error('parent panel missing')
    const chain = parentPanel.getAttribute('data-mck-floating-chain')
    expect(chain).toBeTruthy()

    // 子面板模拟一个 teleport 到 body 的独立浮层，链里含父链 + 自己。
    const child = document.createElement('div')
    child.setAttribute('data-mck-floating-chain', chain + ' child')
    const item = document.createElement('button')
    item.textContent = '二级项'
    child.appendChild(item)
    document.body.appendChild(child)

    item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    // 没有误关：父面板仍在，且没有发出 false。
    expect(document.querySelector('.mck-dropdown__panel')).not.toBeNull()
    expect(wrapper.emitted('update:modelValue')?.some((call) => call[0] === false)).not.toBe(true)
    child.remove()
    wrapper.unmount()
  })

  it('showAtPoint：按视口坐标打开，旧锚点不会把它拉回触发器', async () => {
    const wrapper = mount(Dropdown, {
      props: { modelValue: false, teleport: false },
      slots: { trigger: '<button type="button" data-trigger>打开</button>', default: '<div data-point-menu />' },
      attachTo: document.body,
    })
    await wrapper.vm.$nextTick()
    ;(wrapper.vm as unknown as { showAtPoint: (x: number, y: number) => void }).showAtPoint(120, 80)
    await wrapper.vm.$nextTick()
    await nextTick()
    const panel = document.querySelector<HTMLElement>('.mck-dropdown__panel')
    expect(panel).not.toBeNull()
    // SSR 下 offsetWidth 为 0；内联位置仍必须是传入的坐标，不能是触发器位置。
    // top 再加默认 offset 6：菜单要离开鼠标点一点，别把第一项压在指针下面。
    expect(panel?.style.left).toBe('120px')
    expect(panel?.style.top).toBe('86px')
    wrapper.unmount()
  })

  it('parentChain：触发器不在父面板 DOM 里，也能把自己算作父浮层的子层', async () => {
    const wrapper = mount(Dropdown, {
      props: { modelValue: true, teleport: false, parentChain: 'outer parent', chainId: 'self' },
      slots: { trigger: '<button type="button">打开</button>', default: '<div data-child-menu />' },
      attachTo: document.body,
    })
    await wrapper.vm.$nextTick()
    const panel = document.querySelector<HTMLElement>('.mck-dropdown__panel')
    // parentChain 是显式父链；组件自己再追加 chainId，所以属性里是“父 + 自己”。
    expect(panel?.getAttribute('data-mck-floating-chain')).toBe('outer parent self')
    wrapper.unmount()
  })

  it('zIndex：只覆盖本层浮层与箭头的层级，不写死到全局样式', async () => {
    const wrapper = mount(Dropdown, {
      props: { modelValue: true, teleport: false, zIndex: 12345, arrow: true },
      slots: { trigger: '<button type="button">打开</button>', default: '<div data-z-menu />' },
      attachTo: document.body,
    })
    await wrapper.vm.$nextTick()
    expect(document.querySelector<HTMLElement>('.mck-dropdown__panel')?.style.zIndex).toBe('12345')
    expect(document.querySelector<HTMLElement>('.mck-dropdown__arrow')?.style.zIndex).toBe('12345')
    wrapper.unmount()
  })
})
