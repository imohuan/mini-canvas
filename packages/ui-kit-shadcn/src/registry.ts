/**
 * shadcn 组件清单：默认主题按这份表把**原始组件**登记进 `registryOf('ui')`。
 *
 * 这里不做任何包装：值就是各目录 index.ts 导出的那个 Vue 组件。
 * 注册名 = 源码导出名（Button / DropdownMenuContent …），不再加 `shadcn` 前缀。
 * 消费方直接 "有什么组件就用什么名字"，与 shadcn-vue 的 import 名一致。
 */
import type { Component } from 'vue'

import * as AlertDialogModule from './components/ui/alert-dialog'
import * as BadgeModule from './components/ui/badge'
import * as ButtonModule from './components/ui/button'
import * as BubbleModule from './components/ui/bubble'
import * as CardModule from './components/ui/card'
import * as CheckboxModule from './components/ui/checkbox'
import * as ColorPickerModule from './components/color-picker'
import * as CollapsibleModule from './components/ui/collapsible'
import * as ComboboxModule from './components/ui/combobox'
import * as CommandModule from './components/ui/command'
import * as ContextMenuModule from './components/ui/context-menu'
import * as DialogModule from './components/ui/dialog'
import * as DropdownMenuModule from './components/ui/dropdown-menu'
import * as InputModule from './components/ui/input'
import * as InputGroupModule from './components/ui/input-group'
import * as ItemModule from './components/ui/item'
import * as LabelModule from './components/ui/label'
import * as MenubarModule from './components/ui/menubar'
import * as NumberFieldModule from './components/ui/number-field'
import * as PopoverModule from './components/ui/popover'
import * as RadioGroupModule from './components/ui/radio-group'
import * as ScrollAreaModule from './components/ui/scroll-area'
import * as SelectModule from './components/ui/select'
import * as SeparatorModule from './components/ui/separator'
import * as SheetModule from './components/ui/sheet'
import * as SpinnerModule from './components/ui/spinner'
import * as SliderModule from './components/ui/slider'
import * as SwitchModule from './components/ui/switch'
import * as TabsModule from './components/ui/tabs'
import * as TextareaModule from './components/ui/textarea'
import * as TooltipModule from './components/ui/tooltip'
import { SHADCN_FAMILY_NAMES } from './shadcnFamilies'

const FAMILIES: Record<string, Record<string, unknown>> = {
  AlertDialog: AlertDialogModule,
  Badge: BadgeModule,
  Button: ButtonModule,
  Bubble: BubbleModule,
  Card: CardModule,
  Checkbox: CheckboxModule,
  ColorPicker: ColorPickerModule,
  Collapsible: CollapsibleModule,
  Combobox: ComboboxModule,
  Command: CommandModule,
  ContextMenu: ContextMenuModule,
  Dialog: DialogModule,
  DropdownMenu: DropdownMenuModule,
  Input: InputModule,
  InputGroup: InputGroupModule,
  Item: ItemModule,
  Label: LabelModule,
  Menubar: MenubarModule,
  NumberField: NumberFieldModule,
  Popover: PopoverModule,
  RadioGroup: RadioGroupModule,
  ScrollArea: ScrollAreaModule,
  // ScrollBar 与 ScrollArea 同目录、不同名前缀；单列一项才能被 buildManifest 收进来。
  ScrollBar: ScrollAreaModule,
  Select: SelectModule,
  Separator: SeparatorModule,
  Sheet: SheetModule,
  Spinner: SpinnerModule,
  Slider: SliderModule,
  Switch: SwitchModule,
  Tabs: TabsModule,
  Textarea: TextareaModule,
  Tooltip: TooltipModule,
}

function buildManifest(): Record<string, Component> {
  const manifest: Record<string, Component> = {}
  for (const [family, module] of Object.entries(FAMILIES)) {
    for (const [name, value] of Object.entries(module)) {
      // 只收组件：变体常量（buttonVariants）和 useCommand 这类 helper 都是小写开头。
      if (!name.startsWith(family) || name[0] !== name[0]?.toUpperCase()) continue
      if (typeof value !== 'object' && typeof value !== 'function') continue
      // 名单是唯一真源：FAMILIES 里混进本项目自造件时，这里也一起挡住
      if (!SHADCN_FAMILY_NAMES.includes(family as (typeof SHADCN_FAMILY_NAMES)[number])) continue
      manifest[name] = value as Component
    }
  }
  return manifest
}

/** 组件名 → 原始 shadcn 组件。名字就是源码导出名，如 `DropdownMenuItem`。 */
export const SHADCN_COMPONENTS: Record<string, Component> = buildManifest()

/** 已登记的组件名（诊断 / 文档用）。 */
export const SHADCN_COMPONENT_NAMES: string[] = Object.keys(SHADCN_COMPONENTS)
