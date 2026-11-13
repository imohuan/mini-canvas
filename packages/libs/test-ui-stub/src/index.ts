/**
 * @plume-canvas/test-ui-stub —— 测试专用的 ui 目录替身。
 *
 * 为什么要有它：业务插件的组件一律 useUiComponent('X') 按名取件，测试里若什么都不装，
 * 取到的就是 undefined；若装真实主题插件，测试之间就又出现了插件互相依赖。
 *
 * 这里给出**最小可用**的替身：只保证「渲染得出来、关键标记在」，不参与生产构建，
 * 也不被任何插件列为运行依赖（只出现在各包的 devDependencies / vitest 配置里）。
 *
 * 用法：
 *   import { registerTestUi, stubUiField } from '@plume-canvas/test-ui-stub'
 *   const ctx = new Context()
 *   registerTestUi(ctx.registryOf('ui'))
 *
 * 需要断言具体样式（例如「默认主题的 tpg-inline 长什么样」）时，去主题包自己的测试里验，
 * 不要在这里复制一份主题实现。
 */
import { defineComponent, h, type Component } from 'vue'

/** 通用按钮：保留 class / 事件 / 子节点，样式无关紧要 */
const TestButton = defineComponent({
  name: 'TestButton',
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => h('button', { type: 'button', ...attrs }, slots.default?.())
  },
})

/** 透明容器：把 attrs 与子节点原样透传（用于 DropdownMenu / Popover / Tooltip / Tabs 等） */
function passthrough(name: string, tag = 'div'): Component {
  return defineComponent({
    name,
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(tag, attrs, slots.default?.())
    },
  })
}

/** 下拉菜单内容：与真实组件在 SSR 下的表现一致（子树会渲染进 HTML，便于断言菜单项） */
function alwaysOpen(name: string, tag = 'div'): Component {
  return defineComponent({
    name,
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(tag, attrs, slots.default?.())
    },
  })
}

/**
 * 浮层内容（Popover）：「关闭时不挂载子树」。
 *
 * 与真实组件一致：reka 的 PopoverContent 关闭时不渲染内容，所以「面板不该压在输入框上方」
 * 这类断言在宿主测试里才有意义。
 */
function onlyWhenOpen(name: string, tag = 'div'): Component {
  return defineComponent({
    name,
    inheritAttrs: false,
    props: { open: { type: Boolean, default: false } },
    setup(props, { attrs, slots }) {
      return () => (props.open ? h(tag, attrs, slots.default?.()) : null)
    },
  })
}

/** 表单件：把 v-model 落成原生 value / checked，SSR 里也能断言 */
function field(name: string, tag: 'input' | 'textarea' | 'label' = 'input'): Component {
  return defineComponent({
    name,
    inheritAttrs: false,
    props: { modelValue: { type: [String, Number, Boolean], default: '' } },
    emits: ['update:modelValue'],
    setup(props, { attrs, slots }) {
      return () => {
        const base = { ...attrs } as Record<string, unknown>
        if (tag === 'input') {
          if (typeof props.modelValue === 'string') base.value = props.modelValue
          if (typeof props.modelValue === 'boolean') base.checked = props.modelValue
          return h('input', base)
        }
        if (tag === 'textarea') {
          return h('textarea', { ...base, value: typeof props.modelValue === 'string' ? props.modelValue : '' })
        }
        return h('label', base, slots.default?.())
      }
    },
  })
}

/** 节点空状态：与主题同名同 class 根（nes-root），保证「空态是否出现」这类断言仍可写 */
const TestNodeEmptyState = defineComponent({
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

/** 节点加载态：与主题同名的紧凑/铺满两种根标记 */
const TestNodeLoadingState = defineComponent({
  name: 'TestNodeLoadingState',
  inheritAttrs: false,
  props: {
    variant: { type: String, default: 'fill' },
    label: { type: String, default: '' },
    message: { type: String, default: '' },
  },
  setup(props, { attrs, slots }) {
    return () =>
      h(
        'div',
        {
          class: props.variant === 'chip' ? 'nls-root is-chip' : 'nls-root',
          ...attrs,
        },
        [
          props.label ? h('span', { class: 'nls-label' }, props.label) : null,
          props.message ? h('span', { class: 'nls-message' }, props.message) : null,
          slots.action?.(),
        ],
      )
  },
})

/**
 * 参数摘要件：只给两种形态的标记，具体样式归主题自己的测试。
 *
 * 形态判据与真实实现同一口径：**恰好一个参数、并且是普通下拉**时直接铺开（inline），
 * 其余情况收成摘要按钮（trigger）。判据写在这里是为了让宿主（底栏）的调用形态可断言；
 * 「这个判据在哪些边界上成立」由主题包自己的 paramKind 测试负责。
 */
const TestToolParamGroup = defineComponent({
  name: 'TestToolParamGroup',
  inheritAttrs: false,
  props: {
    params: { type: Array, default: () => [] },
    fields: { type: Array, default: () => [] },
    values: { type: Object, default: () => ({}) },
  },
  setup(props, { attrs }) {
    return () => {
      const list = (props.params ?? props.fields ?? []) as Array<{ type?: string; kind?: string }>
      const only = list[0]
      // 与真实判据同口径：恰好一个、普通下拉（select）、不是 ratio 这类专属预设件
      const inline = list.length === 1 && only?.type === 'select' && only?.kind !== 'ratio'
      return h('div', {
        class: inline ? 'tpg-inline' : 'tpg-trigger',
        ...attrs,
      }, [
        h('span', { class: inline ? 'tpg-inline-value' : 'tpg-summary' }, inline
          ? String((props.values as Record<string, unknown>)[(only as { key?: string })?.key ?? ''] ?? '')
          : list
            .map((p) => {
              const v = (props.values as Record<string, unknown>)[(p as { key?: string }).key ?? '']
              return v === undefined || v === '' ? (p as { label?: string }).label : String(v)
            })
            .filter(Boolean)
            .join(' · ')),
      ])
    }
  },
})

/** 媒体预览：按名取的占位件 */
/** 节点端口：与主题同名同结构（锚点 / 按钮 / 跟随区），供多选等插件断言「用的是同一个件」 */
const TestMovingHandle = defineComponent({
  name: 'TestMovingHandle',
  inheritAttrs: false,
  props: {
    preview: { type: Boolean, default: false },
    visible: { type: Boolean, default: true },
    disabled: { type: Boolean, default: false },
    zoneHeight: { type: [Number, String], default: undefined },
    zoneWidth: { type: [Number, String], default: undefined },
  },
  setup(props, { attrs, slots }) {
    return () => {
      if (!props.visible) return null
      const cls = ['moving-handle-anchor', props.preview ? 'is-preview' : '', attrs.class]
        .filter(Boolean)
        .join(' ')
      const rest = { ...attrs }
      delete rest.class
      return h('div', { class: cls, ...rest }, [
        h('div', {
          class: 'port-follow-zone port-follow-zone--target',
          style: props.zoneHeight == null ? undefined : { height: typeof props.zoneHeight === 'number' ? props.zoneHeight + 'px' : props.zoneHeight },
        }, [
          h('div', { class: 'moving-handle-button' }, slots.default?.()),
        ]),
      ])
    }
  },
})

/** 拖线临时线：占位 SVG 路径 */
const TestConnectionLine = defineComponent({
  name: 'TestConnectionLine',
  inheritAttrs: false,
  setup(_props, { attrs }) {
    return () => h('path', { class: 'connection-line-stub', ...attrs })
  },
})

/**
 * 媒体预览：与主题同名同锚点（mv-root / mv-actions / mv-remove）。
 * 宿主（底栏全屏预览）只负责把 item 递进来；缩放手势等交互仍归主题自己的测试。
 */
const TestMediaViewer = defineComponent({
  name: 'TestMediaViewer',
  inheritAttrs: false,
  props: {
    item: { type: Object, default: null },
    removable: { type: Boolean, default: false },
  },
  setup(_props, { attrs, slots }) {
    return () =>
      (_props as { item?: unknown }).item == null
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

/** 设置页布局件：按名取 */
const TestSettingsRow = passthrough('TestSettingsRow')
const TestSettingsSection = passthrough('TestSettingsSection')

/**
 * 名字 → 替身。
 *
 * 名字与主题登记的完全一致（大小写敏感）：shadcn 件用原名（Button / SelectTrigger …），
 * 主题自造的件用他们的登记名（nodeEmptyState / toolParamGroup …）。
 */
export const TEST_UI_COMPONENTS: Record<string, Component> = {
  // shadcn 原件
  Button: TestButton,
  Input: field('TestInput', 'input'),
  Textarea: field('TestTextarea', 'textarea'),
  Label: passthrough('TestLabel', 'label'),
  Badge: passthrough('TestBadge', 'span'),
  Switch: field('TestSwitch', 'input'),
  Slider: passthrough('TestSlider'),
  Progress: passthrough('TestProgress'),
  Separator: passthrough('TestSeparator'),
  Spinner: passthrough('TestSpinner'),
  ScrollArea: passthrough('TestScrollArea'),
  Card: passthrough('TestCard'),
  CardHeader: passthrough('TestCardHeader'),
  CardTitle: passthrough('TestCardTitle'),
  CardContent: passthrough('TestCardContent'),
  CardFooter: passthrough('TestCardFooter'),
  Dialog: alwaysOpen('TestDialog'),
  DialogContent: alwaysOpen('TestDialogContent'),
  DialogHeader: passthrough('TestDialogHeader'),
  DialogTitle: passthrough('TestDialogTitle'),
  DialogDescription: passthrough('TestDialogDescription'),
  DialogFooter: passthrough('TestDialogFooter'),
  DropdownMenu: passthrough('TestDropdownMenu'),
  DropdownMenuTrigger: passthrough('TestDropdownMenuTrigger'),
  DropdownMenuContent: onlyWhenOpen('TestDropdownMenuContent'),
  DropdownMenuItem: passthrough('TestDropdownMenuItem', 'button'),
  DropdownMenuLabel: passthrough('TestDropdownMenuLabel'),
  DropdownMenuSeparator: passthrough('TestDropdownMenuSeparator'),
  DropdownMenuSub: passthrough('TestDropdownMenuSub'),
  DropdownMenuSubContent: onlyWhenOpen('TestDropdownMenuSubContent'),
  DropdownMenuSubTrigger: passthrough('TestDropdownMenuSubTrigger'),
  Popover: passthrough('TestPopover'),
  PopoverTrigger: passthrough('TestPopoverTrigger'),
  PopoverContent: onlyWhenOpen('TestPopoverContent'),
  Tooltip: passthrough('TestTooltip'),
  TooltipTrigger: passthrough('TestTooltipTrigger'),
  TooltipContent: passthrough('TestTooltipContent'),
  TooltipProvider: passthrough('TestTooltipProvider'),
  Select: passthrough('TestSelect'),
  SelectTrigger: passthrough('TestSelectTrigger'),
  SelectContent: onlyWhenOpen('TestSelectContent'),
  SelectItem: passthrough('TestSelectItem', 'button'),
  SelectValue: passthrough('TestSelectValue', 'span'),
  Tabs: alwaysOpen('TestTabs'),
  TabsList: passthrough('TestTabsList'),
  TabsTrigger: passthrough('TestTabsTrigger', 'button'),
  TabsContent: alwaysOpen('TestTabsContent'),
  InputGroup: passthrough('TestInputGroup'),
  InputGroupInput: field('TestInputGroupInput', 'input'),
  InputGroupAddon: passthrough('TestInputGroupAddon'),
  InputGroupButton: passthrough('TestInputGroupButton', 'button'),
  AlertDialog: alwaysOpen('TestAlertDialog'),
  AlertDialogContent: alwaysOpen('TestAlertDialogContent'),
  AlertDialogTitle: passthrough('TestAlertDialogTitle'),
  AlertDialogDescription: passthrough('TestAlertDialogDescription'),
  AlertDialogFooter: passthrough('TestAlertDialogFooter'),
  AlertDialogCancel: passthrough('TestAlertDialogCancel', 'button'),
  AlertDialogAction: passthrough('TestAlertDialogAction', 'button'),
  Collapsible: alwaysOpen('TestCollapsible'),
  CollapsibleContent: alwaysOpen('TestCollapsibleContent'),
  CollapsibleTrigger: passthrough('TestCollapsibleTrigger', 'button'),

  // 主题自造件（登记名）
  nodeEmptyState: TestNodeEmptyState,
  nodeLoadingState: TestNodeLoadingState,
  movingHandle: TestMovingHandle,
  connectionLine: TestConnectionLine,
  toolParamGroup: TestToolParamGroup,
  mediaViewer: TestMediaViewer,
  settingsRow: TestSettingsRow,
  settingsSection: TestSettingsSection,
}

/** 需要一个「有 top/subscribe 的注册场」形状时用 */
export interface UiFieldLike {
  top(name: string): { id: string; value: unknown } | undefined
  subscribe(fn: () => void): { dispose(): void }
}

/** 把替身全部放进一个注册场（ctx.registryOf('ui') 或任何同形对象） */
export function registerTestUi(field: {
  add(key: string, value: unknown, opts?: { id?: string; order?: number }): unknown
}): void {
  for (const [name, component] of Object.entries(TEST_UI_COMPONENTS)) {
    field.add(name, component, { id: 'test-stub' })
  }
}

/** 独立的最小 ui 场（不想起内核时直接用） */
export function stubUiField(only?: string[]): UiFieldLike {
  const byName: Record<string, unknown> = {}
  for (const [name, component] of Object.entries(TEST_UI_COMPONENTS)) {
    if (!only || only.includes(name)) byName[name] = component
  }
  return {
    top: (name: string) => (name in byName ? { id: 'test-stub', value: byName[name] } : undefined),
    subscribe: () => ({ dispose() {} }),
  }
}

