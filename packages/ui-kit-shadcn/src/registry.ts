/**
 * shadcn 组件清单：默认主题按这份表把**原始组件**登记进 `registryOf('ui')`。
 *
 * 这里不做任何包装：值就是各目录 index.ts 导出的那个 Vue 组件。
 * 统一加 `shadcn` 前缀，避免和现有目录名（dropdown / select / slider 等）撞车。
 */
import type { Component } from 'vue'

import * as AlertDialogModule from './components/ui/alert-dialog'
import * as BadgeModule from './components/ui/badge'
import * as ButtonModule from './components/ui/button'
import * as CardModule from './components/ui/card'
import * as CheckboxModule from './components/ui/checkbox'
import * as ColorPickerModule from './components/color-picker'
import * as ComboboxModule from './components/ui/combobox'
import * as CommandModule from './components/ui/command'
import * as ContextMenuModule from './components/ui/context-menu'
import * as DialogModule from './components/ui/dialog'
import * as DropdownMenuModule from './components/ui/dropdown-menu'
import * as InputModule from './components/ui/input'
import * as InputGroupModule from './components/ui/input-group'
import * as LabelModule from './components/ui/label'
import * as MenubarModule from './components/ui/menubar'
import * as NumberFieldModule from './components/ui/number-field'
import * as PopoverModule from './components/ui/popover'
import * as RadioGroupModule from './components/ui/radio-group'
import * as SelectModule from './components/ui/select'
import * as SeparatorModule from './components/ui/separator'
import * as SheetModule from './components/ui/sheet'
import * as SliderModule from './components/ui/slider'
import * as SwitchModule from './components/ui/switch'
import * as TabsModule from './components/ui/tabs'
import * as TextareaModule from './components/ui/textarea'
import * as TooltipModule from './components/ui/tooltip'

const FAMILIES: Record<string, Record<string, unknown>> = {
  AlertDialog: AlertDialogModule,
  Badge: BadgeModule,
  Button: ButtonModule,
  Card: CardModule,
  Checkbox: CheckboxModule,
  ColorPicker: ColorPickerModule,
  Combobox: ComboboxModule,
  Command: CommandModule,
  ContextMenu: ContextMenuModule,
  Dialog: DialogModule,
  DropdownMenu: DropdownMenuModule,
  Input: InputModule,
  InputGroup: InputGroupModule,
  Label: LabelModule,
  Menubar: MenubarModule,
  NumberField: NumberFieldModule,
  Popover: PopoverModule,
  RadioGroup: RadioGroupModule,
  Select: SelectModule,
  Separator: SeparatorModule,
  Sheet: SheetModule,
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
      manifest[`shadcn${name}`] = value as Component
    }
  }
  return manifest
}

/** 组件名 → 原始 shadcn 组件。名字形如 `shadcnDropdownMenuItem`。 */
export const SHADCN_COMPONENTS: Record<string, Component> = buildManifest()

/** 已登记的组件名（诊断 / 文档用）。 */
export const SHADCN_COMPONENT_NAMES: string[] = Object.keys(SHADCN_COMPONENTS)
