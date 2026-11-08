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

import * as badgeModule from './components/ui/badge'
import * as alertDialogModule from './components/ui/alert-dialog'
import * as bubbleModule from './components/ui/bubble'
import * as collapsibleModule from './components/ui/collapsible'
import * as buttonModule from './components/ui/button'
import * as cardModule from './components/ui/card'
import * as checkboxModule from './components/ui/checkbox'
import * as codeBlockModule from './components/ui/code-block'
import * as comboboxModule from './components/ui/combobox'
import * as commandModule from './components/ui/command'
import * as contextMenuModule from './components/ui/context-menu'
import * as dialogModule from './components/ui/dialog'
import * as dropdownModule from './components/ui/dropdown-menu'
import * as hoverCardModule from './components/ui/hover-card'
import * as inputModule from './components/ui/input'
import * as inputGroupModule from './components/ui/input-group'
import * as itemModule from './components/ui/item'
import * as labelModule from './components/ui/label'
import * as menubarModule from './components/ui/menubar'
import * as numberFieldModule from './components/ui/number-field'
import * as popoverModule from './components/ui/popover'
import * as progressModule from './components/ui/progress'
import * as radioGroupModule from './components/ui/radio-group'
import * as spinnerModule from './components/ui/spinner'
import * as scrollAreaModule from './components/ui/scroll-area'
import * as separatorModule from './components/ui/separator'
import * as sheetModule from './components/ui/sheet'
import * as sliderModule from './components/ui/slider'
import * as switchModule from './components/ui/switch'
import * as tabsModule from './components/ui/tabs'
import * as textareaModule from './components/ui/textarea'
import * as colorPickerModule from './components/color-picker'
import * as selectModule from './components/ui/select'
import * as tooltipModule from './components/ui/tooltip'

const badge = configure(badgeModule, 'Badge')
const alertDialog = configure(alertDialogModule, 'AlertDialog')
const bubble = configure(bubbleModule, 'Bubble')
const collapsible = configure(collapsibleModule, 'Collapsible')
const button = configure(buttonModule, 'Button')
const card = configure(cardModule, 'Card')
const checkbox = configure(checkboxModule, 'Checkbox')
const codeBlock = configure(codeBlockModule, 'CodeBlock')
const combobox = configure(comboboxModule, 'Combobox')
const command = configure(commandModule, 'Command')
const contextMenu = configure(contextMenuModule, 'ContextMenu')
const dialog = configure(dialogModule, 'Dialog')
const dropdown = configure(dropdownModule, 'DropdownMenu')
const hoverCard = configure(hoverCardModule, 'HoverCard')
const input = configure(inputModule, 'Input')
const inputGroup = configure(inputGroupModule, 'InputGroup')
const item = configure(itemModule, 'Item')
const label = configure(labelModule, 'Label')
const menubar = configure(menubarModule, 'Menubar')
const numberField = configure(numberFieldModule, 'NumberField')
const popover = configure(popoverModule, 'Popover')
const progress = configure(progressModule, 'Progress')
const radioGroup = configure(radioGroupModule, 'RadioGroup')
const scrollArea = configure(scrollAreaModule, 'ScrollArea')
// ScrollBar 与 ScrollArea 同目录、不同家族名；单独过一次薄层，保证尺寸档位也认它。
const scrollBar = configure(scrollAreaModule, 'ScrollBar')
const separator = configure(separatorModule, 'Separator')
const sheet = configure(sheetModule, 'Sheet')
const slider = configure(sliderModule, 'Slider')
const spinner = configure(spinnerModule, 'Spinner')
const switchComponent = configure(switchModule, 'Switch')
const tabs = configure(tabsModule, 'Tabs')
const textarea = configure(textareaModule, 'Textarea')
const colorPicker = configure(colorPickerModule, 'ColorPicker')
const select = configure(selectModule, 'Select')
const tooltip = configure(tooltipModule, 'Tooltip')

export const Badge = badge.Badge

export const Bubble = bubble.Bubble
export const BubbleContent = bubble.BubbleContent
export const BubbleGroup = bubble.BubbleGroup
export const BubbleReactions = bubble.BubbleReactions

export const Collapsible = collapsible.Collapsible
export const CollapsibleContent = collapsible.CollapsibleContent
export const CollapsibleTrigger = collapsible.CollapsibleTrigger

export const AlertDialog = alertDialog.AlertDialog
export const AlertDialogAction = alertDialog.AlertDialogAction
export const AlertDialogCancel = alertDialog.AlertDialogCancel
export const AlertDialogContent = alertDialog.AlertDialogContent
export const AlertDialogDescription = alertDialog.AlertDialogDescription
export const AlertDialogFooter = alertDialog.AlertDialogFooter
export const AlertDialogHeader = alertDialog.AlertDialogHeader
export const AlertDialogMedia = alertDialog.AlertDialogMedia
export const AlertDialogTitle = alertDialog.AlertDialogTitle
export const AlertDialogTrigger = alertDialog.AlertDialogTrigger

export const Button = button.Button

export const Card = card.Card
export const CardContent = card.CardContent
export const CardDescription = card.CardDescription
export const CardFooter = card.CardFooter
export const CardHeader = card.CardHeader
export const CardTitle = card.CardTitle

export const Checkbox = checkbox.Checkbox

export const CodeBlock = codeBlock.CodeBlock
export const CodeBlockActions = codeBlock.CodeBlockActions
export const CodeBlockContent = codeBlock.CodeBlockContent
export const CodeBlockCopyButton = codeBlock.CodeBlockCopyButton
export const CodeBlockFooter = codeBlock.CodeBlockFooter
export const CodeBlockHeader = codeBlock.CodeBlockHeader
export const CodeBlockHighlighted = codeBlock.CodeBlockHighlighted
export const CodeBlockLine = codeBlock.CodeBlockLine
export const CodeBlockTitle = codeBlock.CodeBlockTitle
export const CodeBlockToken = codeBlock.CodeBlockToken

export const Combobox = combobox.Combobox
export const ComboboxAnchor = combobox.ComboboxAnchor
export const ComboboxEmpty = combobox.ComboboxEmpty
export const ComboboxInput = combobox.ComboboxInput
export const ComboboxItem = combobox.ComboboxItem
export const ComboboxList = combobox.ComboboxList
export const ComboboxViewport = combobox.ComboboxViewport

export const Command = command.Command
export const CommandDialog = command.CommandDialog
export const CommandEmpty = command.CommandEmpty
export const CommandGroup = command.CommandGroup
export const CommandInput = command.CommandInput
export const CommandItem = command.CommandItem
export const CommandList = command.CommandList
export const CommandSeparator = command.CommandSeparator
export const CommandShortcut = command.CommandShortcut

export const ContextMenu = contextMenu.ContextMenu
export const ContextMenuCheckboxItem = contextMenu.ContextMenuCheckboxItem
export const ContextMenuContent = contextMenu.ContextMenuContent
export const ContextMenuGroup = contextMenu.ContextMenuGroup
export const ContextMenuItem = contextMenu.ContextMenuItem
export const ContextMenuLabel = contextMenu.ContextMenuLabel
export const ContextMenuRadioGroup = contextMenu.ContextMenuRadioGroup
export const ContextMenuRadioItem = contextMenu.ContextMenuRadioItem
export const ContextMenuSeparator = contextMenu.ContextMenuSeparator
export const ContextMenuShortcut = contextMenu.ContextMenuShortcut
export const ContextMenuSub = contextMenu.ContextMenuSub
export const ContextMenuSubContent = contextMenu.ContextMenuSubContent
export const ContextMenuSubTrigger = contextMenu.ContextMenuSubTrigger
export const ContextMenuTrigger = contextMenu.ContextMenuTrigger

export const Dialog = dialog.Dialog
export const DialogContent = dialog.DialogContent
export const DialogDescription = dialog.DialogDescription
export const DialogFooter = dialog.DialogFooter
export const DialogHeader = dialog.DialogHeader
export const DialogTitle = dialog.DialogTitle
export const DialogTrigger = dialog.DialogTrigger

export const DropdownMenu = dropdown.DropdownMenu
export const DropdownMenuContent = dropdown.DropdownMenuContent
export const DropdownMenuItem = dropdown.DropdownMenuItem
export const DropdownMenuLabel = dropdown.DropdownMenuLabel
export const DropdownMenuRadioGroup = dropdown.DropdownMenuRadioGroup
export const DropdownMenuRadioItem = dropdown.DropdownMenuRadioItem
export const DropdownMenuSeparator = dropdown.DropdownMenuSeparator
export const DropdownMenuSub = dropdown.DropdownMenuSub
export const DropdownMenuSubContent = dropdown.DropdownMenuSubContent
export const DropdownMenuSubTrigger = dropdown.DropdownMenuSubTrigger
export const DropdownMenuTrigger = dropdown.DropdownMenuTrigger

export const HoverCard = hoverCard.HoverCard
export const HoverCardContent = hoverCard.HoverCardContent
export const HoverCardTrigger = hoverCard.HoverCardTrigger

export const Input = input.Input

export const InputGroup = inputGroup.InputGroup
export const InputGroupAddon = inputGroup.InputGroupAddon
export const InputGroupButton = inputGroup.InputGroupButton
export const InputGroupInput = inputGroup.InputGroupInput
export const InputGroupText = inputGroup.InputGroupText
export const InputGroupTextarea = inputGroup.InputGroupTextarea

export const Item = item.Item
export const ItemActions = item.ItemActions
export const ItemContent = item.ItemContent
export const ItemDescription = item.ItemDescription
export const ItemFooter = item.ItemFooter
export const ItemGroup = item.ItemGroup
export const ItemHeader = item.ItemHeader
export const ItemMedia = item.ItemMedia
export const ItemSeparator = item.ItemSeparator
export const ItemTitle = item.ItemTitle

export const Label = label.Label

export const Menubar = menubar.Menubar
export const MenubarCheckboxItem = menubar.MenubarCheckboxItem
export const MenubarContent = menubar.MenubarContent
export const MenubarGroup = menubar.MenubarGroup
export const MenubarItem = menubar.MenubarItem
export const MenubarLabel = menubar.MenubarLabel
export const MenubarMenu = menubar.MenubarMenu
export const MenubarRadioGroup = menubar.MenubarRadioGroup
export const MenubarRadioItem = menubar.MenubarRadioItem
export const MenubarSeparator = menubar.MenubarSeparator
export const MenubarShortcut = menubar.MenubarShortcut
export const MenubarSub = menubar.MenubarSub
export const MenubarSubContent = menubar.MenubarSubContent
export const MenubarSubTrigger = menubar.MenubarSubTrigger
export const MenubarTrigger = menubar.MenubarTrigger

export const NumberField = numberField.NumberField
export const NumberFieldContent = numberField.NumberFieldContent
export const NumberFieldDecrement = numberField.NumberFieldDecrement
export const NumberFieldIncrement = numberField.NumberFieldIncrement
export const NumberFieldInput = numberField.NumberFieldInput

export const Popover = popover.Popover
export const Progress = progress.Progress
export const PopoverContent = popover.PopoverContent
export const PopoverDescription = popover.PopoverDescription
export const PopoverHeader = popover.PopoverHeader
export const PopoverTitle = popover.PopoverTitle
export const PopoverTrigger = popover.PopoverTrigger

export const RadioGroup = radioGroup.RadioGroup
export const RadioGroupItem = radioGroup.RadioGroupItem

export const ScrollArea = scrollArea.ScrollArea
export const ScrollBar = scrollBar.ScrollBar

export const Separator = separator.Separator

export const Sheet = sheet.Sheet
export const SheetClose = sheet.SheetClose
export const SheetContent = sheet.SheetContent
export const SheetDescription = sheet.SheetDescription
export const SheetFooter = sheet.SheetFooter
export const SheetHeader = sheet.SheetHeader
export const SheetTitle = sheet.SheetTitle
export const SheetTrigger = sheet.SheetTrigger

export const Slider = slider.Slider

export const Spinner = spinner.Spinner

export const Switch = switchComponent.Switch

export const Tabs = tabs.Tabs
export const TabsContent = tabs.TabsContent
export const TabsList = tabs.TabsList
export const TabsTrigger = tabs.TabsTrigger

export const Textarea = textarea.Textarea

export const ColorPicker = colorPicker.ColorPicker

export const Select = select.Select
export const SelectContent = select.SelectContent
export const SelectGroup = select.SelectGroup
export const SelectItem = select.SelectItem
export const SelectLabel = select.SelectLabel
export const SelectSeparator = select.SelectSeparator
export const SelectTrigger = select.SelectTrigger
export const SelectValue = select.SelectValue

export const Tooltip = tooltip.Tooltip
export const TooltipContent = tooltip.TooltipContent
export const TooltipProvider = tooltip.TooltipProvider
export const TooltipTrigger = tooltip.TooltipTrigger
