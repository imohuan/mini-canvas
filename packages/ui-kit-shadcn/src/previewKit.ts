/**
 * 预览页专用的组件出口：与真实应用走**同一条**注入路径。
 *
 * 真实应用里，组件按名从 `registryOf('ui')` 取，登记时包了一层 `withComponentConfig`，
 * 所以「控件尺寸」这类配置会补到每个声明了 `size` 的组件上。
 *
 * 预览页如果是直接 `import { Button } from './components/ui/button'`，就绕过了那层，
 * 于是「顶部改了尺寸，页面上的按钮纹丝不动」——用户读成「这个配置没用」。
 * 这里把预览用到的每个导出都过一遍同一个薄层，结论才和真实应用一致。
 *
 * 不声明 `size` 的组件（Input / Textarea / 各种子件）由薄层原样返回，不会多包一层。
 */
import type { Component } from 'vue'
import { withComponentConfig } from './withComponentConfig'

function configure<T extends Record<string, unknown>>(mod: T, family: string): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(mod)) {
    const isComponent = typeof value === 'function' || (typeof value === 'object' && value !== null)
    out[key] = isComponent ? withComponentConfig(value as Component, `${family}.${key}`) : value
  }
  return out as T
}

import * as alertDialogModule from './components/ui/alert-dialog'
import * as badgeModule from './components/ui/badge'
import * as buttonModule from './components/ui/button'
import * as cardModule from './components/ui/card'
import * as checkboxModule from './components/ui/checkbox'
import * as comboboxModule from './components/ui/combobox'
import * as dialogModule from './components/ui/dialog'
import * as dropdownModule from './components/ui/dropdown-menu'
import * as inputModule from './components/ui/input'
import * as labelModule from './components/ui/label'
import * as numberFieldModule from './components/ui/number-field'
import * as popoverModule from './components/ui/popover'
import * as radioGroupModule from './components/ui/radio-group'
import * as separatorModule from './components/ui/separator'
import * as sliderModule from './components/ui/slider'
import * as switchModule from './components/ui/switch'
import * as tabsModule from './components/ui/tabs'
import * as textareaModule from './components/ui/textarea'
import * as colorPickerModule from './components/color-picker'
import * as selectModule from './components/ui/select'
import * as tooltipModule from './components/ui/tooltip'

const alertDialog = configure(alertDialogModule, 'AlertDialog')
const badge = configure(badgeModule, 'Badge')
const button = configure(buttonModule, 'Button')
const card = configure(cardModule, 'Card')
const checkbox = configure(checkboxModule, 'Checkbox')
const combobox = configure(comboboxModule, 'Combobox')
const dialog = configure(dialogModule, 'Dialog')
const dropdown = configure(dropdownModule, 'DropdownMenu')
const input = configure(inputModule, 'Input')
const label = configure(labelModule, 'Label')
const numberField = configure(numberFieldModule, 'NumberField')
const popover = configure(popoverModule, 'Popover')
const radioGroup = configure(radioGroupModule, 'RadioGroup')
const separator = configure(separatorModule, 'Separator')
const slider = configure(sliderModule, 'Slider')
const switchComponent = configure(switchModule, 'Switch')
const tabs = configure(tabsModule, 'Tabs')
const textarea = configure(textareaModule, 'Textarea')
const colorPicker = configure(colorPickerModule, 'ColorPicker')
const select = configure(selectModule, 'Select')
const tooltip = configure(tooltipModule, 'Tooltip')

export const AlertDialogAction = alertDialog.AlertDialogAction
export const AlertDialogCancel = alertDialog.AlertDialogCancel
export const AlertDialogContent = alertDialog.AlertDialogContent

export const Badge = badge.Badge

export const Button = button.Button

export const Card = card.Card
export const CardAction = card.CardAction
export const CardContent = card.CardContent
export const CardDescription = card.CardDescription
export const CardFooter = card.CardFooter
export const CardHeader = card.CardHeader
export const CardTitle = card.CardTitle

export const Checkbox = checkbox.Checkbox

export const Combobox = combobox.Combobox
export const ComboboxAnchor = combobox.ComboboxAnchor
export const ComboboxEmpty = combobox.ComboboxEmpty
export const ComboboxInput = combobox.ComboboxInput
export const ComboboxItem = combobox.ComboboxItem
export const ComboboxList = combobox.ComboboxList
export const ComboboxViewport = combobox.ComboboxViewport

export const Dialog = dialog.Dialog
export const DialogContent = dialog.DialogContent
export const DialogDescription = dialog.DialogDescription
export const DialogFooter = dialog.DialogFooter
export const DialogHeader = dialog.DialogHeader
export const DialogTitle = dialog.DialogTitle
export const DialogTrigger = dialog.DialogTrigger

export const DropdownMenu = dropdown.DropdownMenu
export const DropdownMenuCheckboxItem = dropdown.DropdownMenuCheckboxItem
export const DropdownMenuContent = dropdown.DropdownMenuContent
export const DropdownMenuGroup = dropdown.DropdownMenuGroup
export const DropdownMenuItem = dropdown.DropdownMenuItem
export const DropdownMenuLabel = dropdown.DropdownMenuLabel
export const DropdownMenuRadioGroup = dropdown.DropdownMenuRadioGroup
export const DropdownMenuRadioItem = dropdown.DropdownMenuRadioItem
export const DropdownMenuSeparator = dropdown.DropdownMenuSeparator
export const DropdownMenuShortcut = dropdown.DropdownMenuShortcut
export const DropdownMenuSub = dropdown.DropdownMenuSub
export const DropdownMenuSubContent = dropdown.DropdownMenuSubContent
export const DropdownMenuSubTrigger = dropdown.DropdownMenuSubTrigger
export const DropdownMenuTrigger = dropdown.DropdownMenuTrigger

export const Input = input.Input
export const Label = label.Label

export const NumberField = numberField.NumberField
export const NumberFieldContent = numberField.NumberFieldContent
export const NumberFieldDecrement = numberField.NumberFieldDecrement
export const NumberFieldIncrement = numberField.NumberFieldIncrement
export const NumberFieldInput = numberField.NumberFieldInput

export const Popover = popover.Popover
export const PopoverContent = popover.PopoverContent
export const PopoverDescription = popover.PopoverDescription
export const PopoverHeader = popover.PopoverHeader
export const PopoverTitle = popover.PopoverTitle
export const PopoverTrigger = popover.PopoverTrigger

export const RadioGroup = radioGroup.RadioGroup
export const RadioGroupItem = radioGroup.RadioGroupItem

export const Separator = separator.Separator
export const Slider = slider.Slider

export const Switch = switchComponent.Switch

export const Tabs = tabs.Tabs
export const TabsContent = tabs.TabsContent
export const TabsList = tabs.TabsList
export const TabsTrigger = tabs.TabsTrigger

export const Textarea = textarea.Textarea

export const ColorPicker = colorPicker.ColorPicker
export const ColorPickerSelect = colorPicker.ColorPickerSelect

export const Select = select.Select
export const SelectContent = select.SelectContent
export const SelectGroup = select.SelectGroup
export const SelectItem = select.SelectItem
export const SelectItemText = select.SelectItemText
export const SelectLabel = select.SelectLabel
export const SelectSeparator = select.SelectSeparator
export const SelectTrigger = select.SelectTrigger
export const SelectValue = select.SelectValue

export const Tooltip = tooltip.Tooltip
export const TooltipContent = tooltip.TooltipContent
export const TooltipProvider = tooltip.TooltipProvider
export const TooltipTrigger = tooltip.TooltipTrigger
