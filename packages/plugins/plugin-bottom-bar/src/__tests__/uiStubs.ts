import { defineComponent, h, type Component } from 'vue'

/**
 * 本插件测试用的 ui 目录替身。
 *
 * 为什么放在这里：组件一律 useUiComponent('X') 按名取件，测试里总得有个能渲染的东西；
 * 但业务插件之间零引用，测试也不能去装主题插件。所以每个插件自己维护**它用到的几个**替身，
 * 形状与真实件同名同标记，只保证「宿主传对了名字、传对了形态」。
 *
 * 具体长什么样（间距、配色、动画）归主题包自己的测试，不在这里复制。
 */

/** 透明容器：attrs 与子节点原样透传 */
function passthrough(name: string, tag = 'div'): Component {
  return defineComponent({
    name,
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(tag, attrs, slots.default?.())
    },
  })
}

/** 菜单/浮层内容：与真实组件在 SSR 下的表现一致（子树会进 HTML） */
function content(name: string, tag = 'div'): Component {
  return defineComponent({
    name,
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(tag, attrs, slots.default?.())
    },
  })
}

/** 弹窗内容：关闭时不挂载子树 */
function whenOpen(name: string, tag = 'div'): Component {
  return defineComponent({
    name,
    inheritAttrs: false,
    props: { open: { type: Boolean, default: false } },
    setup(props, { attrs, slots }) {
      return () => (props.open ? h(tag, attrs, slots.default?.()) : null)
    },
  })
}

/** 表单件：v-model 落成原生 value / checked */
function field(name: string, tag: 'input' | 'textarea' = 'input'): Component {
  return defineComponent({
    name,
    inheritAttrs: false,
    props: { modelValue: { type: [String, Number, Boolean], default: '' } },
    emits: ['update:modelValue'],
    setup(props, { attrs }) {
      return () => {
        const base = { ...attrs } as Record<string, unknown>
        if (tag === 'textarea') {
          return h('textarea', { ...base, value: typeof props.modelValue === 'string' ? props.modelValue : '' })
        }
        if (typeof props.modelValue === 'string') base.value = props.modelValue
        if (typeof props.modelValue === 'boolean') base.checked = props.modelValue
        return h('input', base)
      }
    },
  })
}

const Button = defineComponent({
  name: 'TestButton',
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => h('button', { type: 'button', ...attrs }, slots.default?.())
  },
})

/** 名字 → 替身。名字与主题登记的一致（大小写敏感）。 */
export const UI_STUBS: Record<string, Component> = {
  Button,
  Input: field('TestInput'),
  Textarea: field('TestTextarea', 'textarea'),
  Label: passthrough('TestLabel', 'label'),
  Switch: field('TestSwitch'),
  ScrollArea: passthrough('TestScrollArea'),
  Tabs: passthrough('TestTabs'),
  TabsList: passthrough('TestTabsList'),
  TabsTrigger: passthrough('TestTabsTrigger', 'button'),
  Dialog: passthrough('TestDialog'),
  DialogContent: whenOpen('TestDialogContent'),
  DialogHeader: passthrough('TestDialogHeader'),
  DialogTitle: passthrough('TestDialogTitle'),
  DialogDescription: passthrough('TestDialogDescription'),
  DialogFooter: passthrough('TestDialogFooter'),
  DropdownMenu: passthrough('TestDropdownMenu'),
  DropdownMenuTrigger: passthrough('TestDropdownMenuTrigger'),
  DropdownMenuContent: whenOpen('TestDropdownMenuContent'),
  DropdownMenuItem: passthrough('TestDropdownMenuItem', 'button'),
  Popover: passthrough('TestPopover'),
  PopoverTrigger: passthrough('TestPopoverTrigger'),
  PopoverContent: whenOpen('TestPopoverContent'),
  Tooltip: passthrough('TestTooltip'),
  TooltipTrigger: passthrough('TestTooltipTrigger'),
  TooltipContent: passthrough('TestTooltipContent'),
  TooltipProvider: passthrough('TestTooltipProvider'),
  InputGroup: passthrough('TestInputGroup'),
  InputGroupInput: field('TestInputGroupInput'),
  InputGroupAddon: passthrough('TestInputGroupAddon'),
  InputGroupButton: passthrough('TestInputGroupButton', 'button'),

  // 主题自造件
  mediaViewer: defineComponent({
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
  }),
  /**
   * 参数摘要件：恰好一个普通下拉时铺开（tpg-inline），其余收成摘要（tpg-trigger）。
   * 判据与真实实现同口径，只为了让宿主侧能断言"传下去的是哪种形态"。
   */
  toolParamGroup: defineComponent({
    name: 'TestToolParamGroup',
    inheritAttrs: false,
    props: {
      params: { type: Array, default: () => [] },
      values: { type: Object, default: () => ({}) },
    },
    setup(props, { attrs }) {
      return () => {
        const list = (props.params ?? []) as Array<{ type?: string; kind?: string; key?: string; label?: string }>
        const only = list[0]
        const inline = list.length === 1 && only?.type === 'select' && only?.kind !== 'ratio'
        const values = props.values as Record<string, unknown>
        const text = inline
          ? String(values[only?.key ?? ''] ?? '')
          : list
              .map((p) => {
                const v = values[p.key ?? '']
                return v === undefined || v === '' ? p.label : String(v)
              })
              .filter(Boolean)
              .join(' · ')
        return h('div', { class: inline ? 'tpg-inline' : 'tpg-trigger', ...attrs }, [
          h('span', { class: inline ? 'tpg-inline-value' : 'tpg-summary' }, text),
        ])
      }
    },
  }),
}

/** 把替身放进一个注册场（ctx.registryOf('ui')） */
export function registerUiStubs(field: {
  add(key: string, value: unknown, opts?: { id?: string; order?: number }): unknown
}): void {
  for (const [name, component] of Object.entries(UI_STUBS)) {
    field.add(name, component, { id: 'test-stub' })
  }
}

