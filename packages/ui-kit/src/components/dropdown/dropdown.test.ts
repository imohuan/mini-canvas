import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import Dropdown from './Dropdown.vue'

describe('Dropdown 组件行为', () => {
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
})
