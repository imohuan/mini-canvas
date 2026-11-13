import { defineComponent, h, type Component } from 'vue'

/**
 * 本插件测试用的 ui 目录替身。
 *
 * 组件一律 useUiComponent('X') 按名取件；测试要能渲染出按钮与空态，
 * 但业务插件之间零引用，测试也不能去装主题插件，所以在这里自备最小实现。
 * 具体外观归主题包自己的测试。
 */

const Button = defineComponent({
  name: 'TestButton',
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => h('button', { type: 'button', ...attrs }, slots.default?.())
  },
})

/** 节点空状态：与主题同名根标记 nes-root */
const NodeEmptyState = defineComponent({
  name: 'TestNodeEmptyState',
  inheritAttrs: false,
  props: {
    text: { type: String, default: '' },
    description: { type: String, default: '' },
  },
  setup(props, { attrs, slots }) {
    return () =>
      h('div', { class: 'nes-root', ...attrs }, [
        h('div', { class: 'nes-text' }, props.text),
        props.description ? h('div', { class: 'nes-desc' }, props.description) : null,
        slots.default?.(),
      ])
  },
})

export const UI_STUBS: Record<string, Component> = {
  Button,
  nodeEmptyState: NodeEmptyState,
}

export function registerUiStubs(field: {
  add(key: string, value: unknown, opts?: { id?: string; order?: number }): unknown
}): void {
  for (const [name, component] of Object.entries(UI_STUBS)) {
    field.add(name, component, { id: 'test-stub' })
  }
}

