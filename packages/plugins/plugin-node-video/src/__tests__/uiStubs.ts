import { defineComponent, h, type Component } from 'vue'

/** 本插件测试用的 ui 目录替身（只含本插件用到的件；外观归主题自己的测试）。 */

const Button = defineComponent({
  name: 'TestButton',
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => h('button', { type: 'button', ...attrs }, slots.default?.())
  },
})

const passthrough = (name: string, tag = 'div'): Component =>
  defineComponent({
    name,
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(tag, attrs, slots.default?.())
    },
  })

const content = (name: string, tag = 'div'): Component =>
  defineComponent({
    name,
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(tag, attrs, slots.default?.())
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

/** 节点加载态：与主题同名的两种形态标记 */
const NodeLoadingState = defineComponent({
  name: 'TestNodeLoadingState',
  inheritAttrs: false,
  props: {
    variant: { type: String, default: 'fill' },
    label: { type: String, default: '' },
    message: { type: String, default: '' },
  },
  setup(props, { attrs, slots }) {
    return () =>
      h('div', { class: props.variant === 'chip' ? 'nls-root is-chip' : 'nls-root', ...attrs }, [
        props.label ? h('span', { class: 'nls-label' }, props.label) : null,
        props.message ? h('span', { class: 'nls-message' }, props.message) : null,
        slots.action?.(),
      ])
  },
})

/** 媒体预览 */
const MediaViewer = defineComponent({
  name: 'TestMediaViewer',
  inheritAttrs: false,
  props: { item: { type: Object, default: null } },
  setup(props, { attrs, slots }) {
    return () =>
      (props as { item?: unknown }).item == null
        ? null
        : h('div', { class: 'mv-root', 'data-testid': 'media-viewer', ...attrs }, [
            h('span', { class: 'mv-actions' }, [
              h('button', { class: 'mv-remove', type: 'button' }, '删除'),
              h('button', { type: 'button', title: '关闭 (Esc)' }, '关闭'),
            ]),
            slots.default?.(),
          ])
  },
})

export const UI_STUBS: Record<string, Component> = {
  Button,
  nodeEmptyState: NodeEmptyState,
  nodeLoadingState: NodeLoadingState,
  mediaViewer: MediaViewer,
  DropdownMenu: passthrough('TestDropdownMenu'),
  DropdownMenuTrigger: passthrough('TestDropdownMenuTrigger'),
  DropdownMenuContent: content('TestDropdownMenuContent'),
  DropdownMenuItem: passthrough('TestDropdownMenuItem', 'button'),
  Popover: passthrough('TestPopover'),
  PopoverTrigger: passthrough('TestPopoverTrigger'),
  PopoverContent: content('TestPopoverContent'),
}

export function registerUiStubs(field: {
  add(key: string, value: unknown, opts?: { id?: string; order?: number }): unknown
}): void {
  for (const [name, component] of Object.entries(UI_STUBS)) {
    field.add(name, component, { id: 'test-stub' })
  }
}

