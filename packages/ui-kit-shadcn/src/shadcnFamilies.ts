/**
 * shadcn-vue 生成组件的家族名（**纯数据，唯一事实源**）。
 *
 * 为什么单独一个文件：
 * - `registry.ts` 要 import 各组件目录（含 .vue），只能在浏览器/Vite 里跑；
 * - Vite 开发/构建插件跑在 Node 里，**不能** import 那些 .vue。
 * 两边都需要同一份「哪些名字算 shadcn 原始组件」的判定，所以把这串名字抽出来，
 * 谁都能安全引用。加了新组件家族，只改这里一处。
 *
 * 注意：`SettingsRow` / `SettingsSection` 是本项目在组件库里补的**设置页布局件**，
 * 不属于 shadcn 生成组件，所以不在名单里 —— 组件库使用标记也只认名单内的。
 */
export const SHADCN_FAMILY_NAMES = [
  'AlertDialog',
  'Badge',
  'Bubble',
  'Button',
  'Card',
  'Checkbox',
  'CodeBlock',
  'ColorPicker',
  'Combobox',
  'Command',
  'ContextMenu',
  'Collapsible',
  'Dialog',
  'DropdownMenu',
  'HoverCard',
  'Input',
  'InputGroup',
  'Item',
  'Label',
  'Menubar',
  'NumberField',
  'Popover',
  'Progress',
  'RadioGroup',
  'ScrollArea',
  'ScrollBar',
  'Select',
  'Separator',
  'Sheet',
  'Slider',
  'Spinner',
  'Switch',
  'Tabs',
  'Textarea',
  'Tooltip',
] as const

/** 这个导出名是不是 shadcn 原始组件（`Button` / `SelectTrigger` …；不含本项目自造的布局件） */
export function isShadcnPrimitive(name: string): boolean {
  return SHADCN_FAMILY_NAMES.some((family) => name.startsWith(family))
}

