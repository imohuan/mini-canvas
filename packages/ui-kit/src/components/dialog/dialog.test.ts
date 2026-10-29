import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Dialog from './Dialog.vue'

describe('Dialog 组件行为', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('modelValue=true 渲染标题与正文', async () => {
    const wrapper = mount(Dialog, {
      props: { modelValue: true, title: '编辑资料', description: '修改后立即保存' },
      slots: { default: '<p data-body>正文内容</p>' },
    })
    await wrapper.vm.$nextTick()
    const panel = document.querySelector('.mck-dialog__panel')
    if (!panel) throw new Error('dialog panel missing')
    expect(panel.textContent).toContain('编辑资料')
    expect(panel.textContent).toContain('修改后立即保存')
    expect(panel.textContent).toContain('正文内容')
  })

  it('点关闭按钮发出 false 与 close 事件', async () => {
    const wrapper = mount(Dialog, {
      props: { modelValue: true, title: '对话框' },
      slots: { default: '<p>正文</p>' },
    })
    await wrapper.vm.$nextTick()
    ;(document.querySelector('.mck-dialog__close') as HTMLButtonElement).click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('closeOnEscape=false 时不响应 Escape', async () => {
    const wrapper = mount(Dialog, {
      props: { modelValue: true, title: '锁', closeOnEscape: false },
      slots: { default: '<p>正文</p>' },
    })
    await wrapper.vm.$nextTick()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
