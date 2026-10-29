import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ContextMenu from './ContextMenu.vue'

describe('ContextMenu 组件行为', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function makeMenu() {
    return mount(ContextMenu, {
      attachTo: document.body,
      props: {
        items: [
          { id: 'copy', label: '复制', shortcut: 'Ctrl+C' },
          { id: 'divider', divider: true, label: '' },
          { id: 'del', label: '删除', danger: true },
        ],
      },
    })
  }

  it('showAt 显示菜单并点选项发出 select', async () => {
    const wrapper = makeMenu()
    const vm = wrapper.vm as unknown as { showAt: (x: number, y: number) => void }
    vm.showAt(30, 40)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const menu = document.querySelector('.mck-context-menu__panel')
    if (!menu) throw new Error('context menu missing')
    const items = menu.querySelectorAll('[role="menuitem"]')
    expect(items.length).toBe(2)
    ;(items[0] as HTMLElement).click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('select')?.at(-1)?.[0]).toMatchObject({ id: 'copy' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  it('危险项样式与禁用项不触发', async () => {
    const wrapper = makeMenu()
    const vm = wrapper.vm as unknown as { showAt: (x: number, y: number) => void }
    vm.showAt(30, 40)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const menu = document.querySelector('.mck-context-menu__panel')
    if (!menu) throw new Error('context menu missing')
    const del = Array.from(menu.querySelectorAll('[role="menuitem"]')).find((el) => el.textContent.includes('删除')) as HTMLButtonElement
    expect(del.className).toContain('is-danger')
    del.setAttribute('disabled', 'disabled')
    del.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('select')).toBeUndefined()
  })
})
