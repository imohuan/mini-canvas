/**
 * Dialog 的 lockScroll 必须真的听 prop。
 *
 * 现状：props 上默认 lockScroll: true，但 useFocusTrap 调用时写死了 `lockScroll: true`——
 * 用户传 :lock-scroll="false"（文档里也写了「不锁滚动适合侧栏临时面板」）没有任何效果，
 * 打开弹窗时 body 仍被锁住。这类「prop 接得上、行为不接」的坑最难看出来：
 * 类型检查通过、不报错，只是设置无效。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Dialog from './Dialog.vue'

afterEach(() => {
  document.body.innerHTML = ''
  document.body.style.overflow = ''
})

describe('Dialog lockScroll', () => {
  it('默认锁住 body 滚动', async () => {
    const wrapper = mount(Dialog, { props: { modelValue: true, title: 't' }, attachTo: document.body })
    await Promise.resolve()
    expect(document.body.style.overflow, '默认应锁滚动').toBe('hidden')
    wrapper.unmount()
  })

  it('传 false 时不锁 body 滚动', async () => {
    const wrapper = mount(Dialog, {
      props: { modelValue: true, title: 't', lockScroll: false },
      attachTo: document.body,
    })
    await Promise.resolve()
    expect(document.body.style.overflow, 'lockScroll=false 被忽略（仍锁住了 body）').not.toBe('hidden')
    wrapper.unmount()
  })
})
