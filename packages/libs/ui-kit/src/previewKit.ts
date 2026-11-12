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

export const Badge = (badge as Record<string, unknown>).Badge as Component

export const Bubble = (bubble as Record<string, unknown>).Bubble as Component
export const BubbleContent = (bubble as Record<string, unknown>).BubbleContent as Component
export const BubbleGroup = (bubble as Record<string, unknown>).BubbleGroup as Component
export const BubbleReactions = (bubble as Record<string, unknown>).BubbleReactions as Component

export const Collapsible = (collapsible as Record<string, unknown>).Collapsible as Component
export const CollapsibleContent = (collapsible as Record<string, unknown>).CollapsibleContent as Component
export const CollapsibleTrigger = (collapsible as Record<string, unknown>).CollapsibleTrigger as Component

export const AlertDialog = (alertDialog as Record<string, unknown>).AlertDialog as Component
export const AlertDialogAction = (alertDialog as Record<string, unknown>).AlertDialogAction as Component
export const AlertDialogCancel = (alertDialog as Record<string, unknown>).AlertDialogCancel as Component
export const AlertDialogContent = (alertDialog as Record<string, unknown>).AlertDialogContent as Component
export const AlertDialogDescription = (alertDialog as Record<string, unknown>).AlertDialogDescription as Component
export const AlertDialogFooter = (alertDialog as Record<string, unknown>).AlertDialogFooter as Component
export const AlertDialogHeader = (alertDialog as Record<string, unknown>).AlertDialogHeader as Component
export const AlertDialogMedia = (alertDialog as Record<string, unknown>).AlertDialogMedia as Component
export const AlertDialogTitle = (alertDialog as Record<string, unknown>).AlertDialogTitle as Component
export const AlertDialogTrigger = (alertDialog as Record<string, unknown>).AlertDialogTrigger as Component

export const Button = (button as Record<string, unknown>).Button as Component

export const Card = (card as Record<string, unknown>).Card as Component
export const CardContent = (card as Record<string, unknown>).CardContent as Component
export const CardDescription = (card as Record<string, unknown>).CardDescription as Component
export const CardFooter = (card as Record<string, unknown>).CardFooter as Component
export const CardHeader = (card as Record<string, unknown>).CardHeader as Component
export const CardTitle = (card as Record<string, unknown>).CardTitle as Component

export const Checkbox = (checkbox as Record<string, unknown>).Checkbox as Component

export const CodeBlock = (codeBlock as Record<string, unknown>).CodeBlock as Component
export const CodeBlockActions = (codeBlock as Record<string, unknown>).CodeBlockActions as Component
export const CodeBlockContent = (codeBlock as Record<string, unknown>).CodeBlockContent as Component
export const CodeBlockCopyButton = (codeBlock as Record<string, unknown>).CodeBlockCopyButton as Component
export const CodeBlockFooter = (codeBlock as Record<string, unknown>).CodeBlockFooter as Component
export const CodeBlockHeader = (codeBlock as Record<string, unknown>).CodeBlockHeader as Component
export const CodeBlockHighlighted = (codeBlock as Record<string, unknown>).CodeBlockHighlighted as Component
export const CodeBlockLine = (codeBlock as Record<string, unknown>).CodeBlockLine as Component
export const CodeBlockTitle = (codeBlock as Record<string, unknown>).CodeBlockTitle as Component
export const CodeBlockToken = (codeBlock as Record<string, unknown>).CodeBlockToken as Component

export const Combobox = (combobox as Record<string, unknown>).Combobox as Component
export const ComboboxAnchor = (combobox as Record<string, unknown>).ComboboxAnchor as Component
export const ComboboxEmpty = (combobox as Record<string, unknown>).ComboboxEmpty as Component
export const ComboboxInput = (combobox as Record<string, unknown>).ComboboxInput as Component
export const ComboboxItem = (combobox as Record<string, unknown>).ComboboxItem as Component
export const ComboboxList = (combobox as Record<string, unknown>).ComboboxList as Component
export const ComboboxViewport = (combobox as Record<string, unknown>).ComboboxViewport as Component

export const Command = (command as Record<string, unknown>).Command as Component
export const CommandDialog = (command as Record<string, unknown>).CommandDialog as Component
export const CommandEmpty = (command as Record<string, unknown>).CommandEmpty as Component
export const CommandGroup = (command as Record<string, unknown>).CommandGroup as Component
export const CommandInput = (command as Record<string, unknown>).CommandInput as Component
export const CommandItem = (command as Record<string, unknown>).CommandItem as Component
export const CommandList = (command as Record<string, unknown>).CommandList as Component
export const CommandSeparator = (command as Record<string, unknown>).CommandSeparator as Component
export const CommandShortcut = (command as Record<string, unknown>).CommandShortcut as Component

export const ContextMenu = (contextMenu as Record<string, unknown>).ContextMenu as Component
export const ContextMenuCheckboxItem = (contextMenu as Record<string, unknown>).ContextMenuCheckboxItem as Component
export const ContextMenuContent = (contextMenu as Record<string, unknown>).ContextMenuContent as Component
export const ContextMenuGroup = (contextMenu as Record<string, unknown>).ContextMenuGroup as Component
export const ContextMenuItem = (contextMenu as Record<string, unknown>).ContextMenuItem as Component
export const ContextMenuLabel = (contextMenu as Record<string, unknown>).ContextMenuLabel as Component
export const ContextMenuRadioGroup = (contextMenu as Record<string, unknown>).ContextMenuRadioGroup as Component
export const ContextMenuRadioItem = (contextMenu as Record<string, unknown>).ContextMenuRadioItem as Component
export const ContextMenuSeparator = (contextMenu as Record<string, unknown>).ContextMenuSeparator as Component
export const ContextMenuShortcut = (contextMenu as Record<string, unknown>).ContextMenuShortcut as Component
export const ContextMenuSub = (contextMenu as Record<string, unknown>).ContextMenuSub as Component
export const ContextMenuSubContent = (contextMenu as Record<string, unknown>).ContextMenuSubContent as Component
export const ContextMenuSubTrigger = (contextMenu as Record<string, unknown>).ContextMenuSubTrigger as Component
export const ContextMenuTrigger = (contextMenu as Record<string, unknown>).ContextMenuTrigger as Component

export const Dialog = (dialog as Record<string, unknown>).Dialog as Component
export const DialogContent = (dialog as Record<string, unknown>).DialogContent as Component
export const DialogDescription = (dialog as Record<string, unknown>).DialogDescription as Component
export const DialogFooter = (dialog as Record<string, unknown>).DialogFooter as Component
export const DialogHeader = (dialog as Record<string, unknown>).DialogHeader as Component
export const DialogTitle = (dialog as Record<string, unknown>).DialogTitle as Component
export const DialogTrigger = (dialog as Record<string, unknown>).DialogTrigger as Component

export const DropdownMenu = (dropdown as Record<string, unknown>).DropdownMenu as Component
export const DropdownMenuContent = (dropdown as Record<string, unknown>).DropdownMenuContent as Component
export const DropdownMenuItem = (dropdown as Record<string, unknown>).DropdownMenuItem as Component
export const DropdownMenuLabel = (dropdown as Record<string, unknown>).DropdownMenuLabel as Component
export const DropdownMenuRadioGroup = (dropdown as Record<string, unknown>).DropdownMenuRadioGroup as Component
export const DropdownMenuRadioItem = (dropdown as Record<string, unknown>).DropdownMenuRadioItem as Component
export const DropdownMenuSeparator = (dropdown as Record<string, unknown>).DropdownMenuSeparator as Component
export const DropdownMenuSub = (dropdown as Record<string, unknown>).DropdownMenuSub as Component
export const DropdownMenuSubContent = (dropdown as Record<string, unknown>).DropdownMenuSubContent as Component
export const DropdownMenuSubTrigger = (dropdown as Record<string, unknown>).DropdownMenuSubTrigger as Component
export const DropdownMenuTrigger = (dropdown as Record<string, unknown>).DropdownMenuTrigger as Component

export const HoverCard = (hoverCard as Record<string, unknown>).HoverCard as Component
export const HoverCardContent = (hoverCard as Record<string, unknown>).HoverCardContent as Component
export const HoverCardTrigger = (hoverCard as Record<string, unknown>).HoverCardTrigger as Component

export const Input = (input as Record<string, unknown>).Input as Component

export const InputGroup = (inputGroup as Record<string, unknown>).InputGroup as Component
export const InputGroupAddon = (inputGroup as Record<string, unknown>).InputGroupAddon as Component
export const InputGroupButton = (inputGroup as Record<string, unknown>).InputGroupButton as Component
export const InputGroupInput = (inputGroup as Record<string, unknown>).InputGroupInput as Component
export const InputGroupText = (inputGroup as Record<string, unknown>).InputGroupText as Component
export const InputGroupTextarea = (inputGroup as Record<string, unknown>).InputGroupTextarea as Component

export const Item = (item as Record<string, unknown>).Item as Component
export const ItemActions = (item as Record<string, unknown>).ItemActions as Component
export const ItemContent = (item as Record<string, unknown>).ItemContent as Component
export const ItemDescription = (item as Record<string, unknown>).ItemDescription as Component
export const ItemFooter = (item as Record<string, unknown>).ItemFooter as Component
export const ItemGroup = (item as Record<string, unknown>).ItemGroup as Component
export const ItemHeader = (item as Record<string, unknown>).ItemHeader as Component
export const ItemMedia = (item as Record<string, unknown>).ItemMedia as Component
export const ItemSeparator = (item as Record<string, unknown>).ItemSeparator as Component
export const ItemTitle = (item as Record<string, unknown>).ItemTitle as Component

export const Label = (label as Record<string, unknown>).Label as Component

export const Menubar = (menubar as Record<string, unknown>).Menubar as Component
export const MenubarCheckboxItem = (menubar as Record<string, unknown>).MenubarCheckboxItem as Component
export const MenubarContent = (menubar as Record<string, unknown>).MenubarContent as Component
export const MenubarGroup = (menubar as Record<string, unknown>).MenubarGroup as Component
export const MenubarItem = (menubar as Record<string, unknown>).MenubarItem as Component
export const MenubarLabel = (menubar as Record<string, unknown>).MenubarLabel as Component
export const MenubarMenu = (menubar as Record<string, unknown>).MenubarMenu as Component
export const MenubarRadioGroup = (menubar as Record<string, unknown>).MenubarRadioGroup as Component
export const MenubarRadioItem = (menubar as Record<string, unknown>).MenubarRadioItem as Component
export const MenubarSeparator = (menubar as Record<string, unknown>).MenubarSeparator as Component
export const MenubarShortcut = (menubar as Record<string, unknown>).MenubarShortcut as Component
export const MenubarSub = (menubar as Record<string, unknown>).MenubarSub as Component
export const MenubarSubContent = (menubar as Record<string, unknown>).MenubarSubContent as Component
export const MenubarSubTrigger = (menubar as Record<string, unknown>).MenubarSubTrigger as Component
export const MenubarTrigger = (menubar as Record<string, unknown>).MenubarTrigger as Component

export const NumberField = (numberField as Record<string, unknown>).NumberField as Component
export const NumberFieldContent = (numberField as Record<string, unknown>).NumberFieldContent as Component
export const NumberFieldDecrement = (numberField as Record<string, unknown>).NumberFieldDecrement as Component
export const NumberFieldIncrement = (numberField as Record<string, unknown>).NumberFieldIncrement as Component
export const NumberFieldInput = (numberField as Record<string, unknown>).NumberFieldInput as Component

export const Popover = (popover as Record<string, unknown>).Popover as Component
export const Progress = (progress as Record<string, unknown>).Progress as Component
export const PopoverContent = (popover as Record<string, unknown>).PopoverContent as Component
export const PopoverDescription = (popover as Record<string, unknown>).PopoverDescription as Component
export const PopoverHeader = (popover as Record<string, unknown>).PopoverHeader as Component
export const PopoverTitle = (popover as Record<string, unknown>).PopoverTitle as Component
export const PopoverTrigger = (popover as Record<string, unknown>).PopoverTrigger as Component

export const RadioGroup = (radioGroup as Record<string, unknown>).RadioGroup as Component
export const RadioGroupItem = (radioGroup as Record<string, unknown>).RadioGroupItem as Component

export const ScrollArea = (scrollArea as Record<string, unknown>).ScrollArea as Component
export const ScrollBar = (scrollBar as Record<string, unknown>).ScrollBar as Component

export const Separator = (separator as Record<string, unknown>).Separator as Component

export const Sheet = (sheet as Record<string, unknown>).Sheet as Component
export const SheetClose = (sheet as Record<string, unknown>).SheetClose as Component
export const SheetContent = (sheet as Record<string, unknown>).SheetContent as Component
export const SheetDescription = (sheet as Record<string, unknown>).SheetDescription as Component
export const SheetFooter = (sheet as Record<string, unknown>).SheetFooter as Component
export const SheetHeader = (sheet as Record<string, unknown>).SheetHeader as Component
export const SheetTitle = (sheet as Record<string, unknown>).SheetTitle as Component
export const SheetTrigger = (sheet as Record<string, unknown>).SheetTrigger as Component

export const Slider = (slider as Record<string, unknown>).Slider as Component

export const Spinner = (spinner as Record<string, unknown>).Spinner as Component

export const Switch = (switchComponent as Record<string, unknown>).Switch as Component

export const Tabs = (tabs as Record<string, unknown>).Tabs as Component
export const TabsContent = (tabs as Record<string, unknown>).TabsContent as Component
export const TabsList = (tabs as Record<string, unknown>).TabsList as Component
export const TabsTrigger = (tabs as Record<string, unknown>).TabsTrigger as Component

export const Textarea = (textarea as Record<string, unknown>).Textarea as Component

export const ColorPicker = (colorPicker as Record<string, unknown>).ColorPicker as Component

export const Select = (select as Record<string, unknown>).Select as Component
export const SelectContent = (select as Record<string, unknown>).SelectContent as Component
export const SelectGroup = (select as Record<string, unknown>).SelectGroup as Component
export const SelectItem = (select as Record<string, unknown>).SelectItem as Component
export const SelectLabel = (select as Record<string, unknown>).SelectLabel as Component
export const SelectSeparator = (select as Record<string, unknown>).SelectSeparator as Component
export const SelectTrigger = (select as Record<string, unknown>).SelectTrigger as Component
export const SelectValue = (select as Record<string, unknown>).SelectValue as Component

export const Tooltip = (tooltip as Record<string, unknown>).Tooltip as Component
export const TooltipContent = (tooltip as Record<string, unknown>).TooltipContent as Component
export const TooltipProvider = (tooltip as Record<string, unknown>).TooltipProvider as Component
export const TooltipTrigger = (tooltip as Record<string, unknown>).TooltipTrigger as Component

