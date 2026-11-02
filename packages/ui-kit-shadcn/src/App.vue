<script setup lang="ts">
/**
 * ui-kit-shadcn 预览页。
 *
 * 这一页只做一件事：把 shadcn-vue 的组合件按真实用法摆出来，方便先看交互再决定
 * 哪些件注册进画布的 `ui` 目录。组件本身保持原样，没有在预览里再包一层“适配组件”。
 */
import { computed, onBeforeUnmount, ref, watchEffect } from 'vue'
import {
  CheckIcon,
  ChevronDownIcon,
  SearchIcon,
} from '@lucide/vue'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import ColorPicker from '@/components/color-picker/ColorPicker.vue'
import ThemePanel from '@/components/preview/ThemePanel.vue'
import {
  Combobox,
  ComboboxAnchor,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxViewport,
} from '@/components/ui/combobox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  NumberField,
  NumberFieldContent,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@/components/ui/number-field'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { RADIUS_OPTIONS } from '@/theme/fonts'
import { useThemePreview, type PreviewThemeConfig } from '@/theme/useThemePreview'

const dark = ref(true)
const previewTheme = computed(() => (dark.value ? 'dark' : 'light'))

const themeConfig = ref<PreviewThemeConfig>({
  baseColor: 'neutral',
  theme: 'neutral',
  chartColor: 'neutral',
  font: 'montserrat',
  heading: 'inherit',
  radius: RADIUS_OPTIONS[4]!,
  size: 'default',
})

useThemePreview(themeConfig, dark)

// 浮层（下拉 / 弹窗 / Popover）会 Teleport 到 body，暗色变量必须挂在 <html> 上，
// 只挂在预览根节点上时这些浮层拿不到 .dark 的配色。
watchEffect(() => {
  document.documentElement.classList.toggle('dark', dark.value)
})
onBeforeUnmount(() => {
  document.documentElement.classList.remove('dark')
})

const prompt = ref('一只在窗边打盹的橘猫，午后自然光')
const negative = ref('')
const model = ref('seedream')
const resolution = ref('2k')
const ratio = ref('16:9')
const count = ref<number>(1)
const steps = ref<number[]>([24])
const guidance = ref<number[]>([7.5])
const enabled = ref(true)
const smartPrompt = ref(true)
const paint = ref('solid')
const checked = ref(true)
const detailOpacity = ref<number[]>([80])
const activeTab = ref('menu')
const accentColor = ref('#0d99ff')
const selectedCommand = ref('')
const modelQuery = ref('')
const lastAction = ref('还没有选过菜单项')

interface ChoiceOption {
  value: string
  label: string
  hint?: string
}

const modelOptions: ChoiceOption[] = [
  { value: 'seedream', label: 'Seedream 4.5', hint: '通用图像' },
  { value: 'seedream-pro', label: 'Seedream 5.0 Pro', hint: '细节更稳' },
  { value: 'seedance', label: 'Seedance 2.0', hint: '视频生成' },
  { value: 'seedance-fast', label: 'Seedance 2.0 Fast', hint: '更快，适合草稿' },
]

const ratioOptions: ChoiceOption[] = [
  { value: '1:1', label: '1 : 1 方形' },
  { value: '16:9', label: '16 : 9 横屏' },
  { value: '9:16', label: '9 : 16 竖屏' },
  { value: '4:3', label: '4 : 3 经典' },
]

const resolutionOptions: ChoiceOption[] = [
  { value: '1k', label: '1K' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
]

function labelOf(options: ChoiceOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value
}

const MODELS = [
  { value: 'seedream', label: 'Seedream 4.5', hint: '通用图像' },
  { value: 'seedream-pro', label: 'Seedream 5.0 Pro', hint: '细节更稳' },
  { value: 'seedance', label: 'Seedance 2.0', hint: '视频生成' },
  { value: 'seedance-fast', label: 'Seedance 2.0 Fast', hint: '更快，适合草稿' },
]

const COMMANDS = [
  { value: 'new-canvas', label: '新建画布', group: '画布', shortcut: '⌘ N' },
  { value: 'new-image', label: '新建图片节点', group: '节点', shortcut: '⌘ ⇧ I' },
  { value: 'export', label: '导出画布', group: '画布', shortcut: '⌘ E' },
  { value: 'settings', label: '打开设置', group: '系统', shortcut: '⌘ ,' },
]

const filteredModels = computed(() => {
  const q = modelQuery.value.trim().toLowerCase()
  return q ? MODELS.filter((m) => m.label.toLowerCase().includes(q)) : MODELS
})

function pick(value: string): void {
  selectedCommand.value = value
  lastAction.value = '选择了：' + (COMMANDS.find((c) => c.value === value)?.label ?? value)
}

function notifyAction(label: string): void {
  lastAction.value = '点了：' + label
}
</script>

<template>
  <div :class="previewTheme" class="min-h-dvh bg-background text-foreground">
    <div class="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <Badge variant="outline">shadcn-vue</Badge>
            <Badge variant="secondary">reka-ui</Badge>
            <Badge>preset a2vfIHS</Badge>
          </div>
          <h1 class="text-2xl font-semibold tracking-tight">mini-canvas · shadcn UI 预览</h1>
          <p class="max-w-2xl text-sm text-muted-foreground">
            这些组件保持 shadcn-vue 的原始组合结构。下拉选择全部由 DropdownMenu 的分离件拼成，
            触发器和菜单内容都能随意替换；上方主题面板可直接改底色、主题色、图表色、字体与圆角。
          </p>
        </div>
      </header>

      <ThemePanel v-model:config="themeConfig" v-model:dark="dark" />

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>生成参数</CardTitle>
            <CardDescription>底栏真实会用到的一组控件：输入、分离式下拉、数字与滑块。</CardDescription>
          </CardHeader>
          <CardContent class="grid gap-4">
            <div class="grid gap-2">
              <Label for="prompt">提示词</Label>
              <Textarea id="prompt" v-model="prompt" class="min-h-24" placeholder="描述你想生成的内容" />
            </div>

            <div class="grid gap-2">
              <Label for="negative">反向提示词</Label>
              <Input id="negative" v-model="negative" placeholder="不希望出现的元素" />
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <div class="grid gap-2">
                <Label>模型</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="outline" class="w-full justify-between font-normal">
                      <span class="truncate">{{ labelOf(modelOptions, model) }}</span>
                      <ChevronDownIcon class="text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent class="w-72">
                    <DropdownMenuRadioGroup v-model="model">
                      <DropdownMenuRadioItem v-for="option in modelOptions" :key="option.value" :value="option.value">
                        <span class="flex min-w-0 flex-1 items-center justify-between gap-2">
                          <span class="truncate">{{ option.label }}</span>
                          <span v-if="option.hint" class="text-xs text-muted-foreground">{{ option.hint }}</span>
                        </span>
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div class="grid gap-2">
                <Label>比例</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="outline" class="w-full justify-between font-normal">
                      <span class="truncate">{{ labelOf(ratioOptions, ratio) }}</span>
                      <ChevronDownIcon class="text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent class="w-64">
                    <DropdownMenuRadioGroup v-model="ratio">
                      <DropdownMenuRadioItem v-for="option in ratioOptions" :key="option.value" :value="option.value">
                        {{ option.label }}
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <div class="grid gap-2">
                <Label>数量</Label>
                <NumberField v-model="count" :min="1" :max="8">
                  <NumberFieldContent>
                    <NumberFieldDecrement />
                    <NumberFieldInput />
                    <NumberFieldIncrement />
                  </NumberFieldContent>
                </NumberField>
                <p class="text-xs text-muted-foreground">当前：{{ count }} 张</p>
              </div>

              <div class="grid gap-2">
                <Label>清晰度</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="outline" class="w-full justify-between font-normal">
                      <span class="truncate">{{ labelOf(resolutionOptions, resolution) }}</span>
                      <ChevronDownIcon class="text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent class="w-40">
                    <DropdownMenuRadioGroup v-model="resolution">
                      <DropdownMenuRadioItem v-for="option in resolutionOptions" :key="option.value" :value="option.value">
                        {{ option.label }}
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <Separator />

            <div class="grid gap-4">
              <div class="flex items-center justify-between gap-4">
                <Label>采样步数</Label>
                <span class="text-sm tabular-nums text-muted-foreground">{{ steps[0] }}</span>
              </div>
              <Slider v-model="steps" :min="1" :max="60" :step="1" />

              <div class="flex items-center justify-between gap-4">
                <Label>提示词权重</Label>
                <span class="text-sm tabular-nums text-muted-foreground">{{ guidance[0] }}</span>
              </div>
              <Slider v-model="guidance" :min="1" :max="20" :step="0.5" />
            </div>

            <div class="flex flex-wrap items-center gap-5">
              <label class="flex items-center gap-2 text-sm">
                <Checkbox v-model="checked" /> 高细节
              </label>
              <label class="flex items-center gap-2 text-sm">
                <Switch v-model="smartPrompt" /> 提示词增强
              </label>
              <label class="flex items-center gap-2 text-sm">
                <Switch v-model="enabled" /> 生成后自动选中
              </label>
            </div>

            <div class="grid gap-2">
              <Label>笔刷</Label>
              <RadioGroup v-model="paint" class="flex flex-wrap gap-4">
                <label class="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="solid" /> 实心
                </label>
                <label class="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="soft" /> 柔边
                </label>
                <label class="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="eraser" /> 橡皮
                </label>
              </RadioGroup>
            </div>

            <div class="grid gap-2">
              <Label>颜色</Label>
              <ColorPicker v-model="accentColor" />
              <p class="text-xs text-muted-foreground">当前：{{ accentColor }}</p>
            </div>
          </CardContent>
          <CardFooter class="flex flex-wrap items-center gap-2">
            <Button @click="notifyAction('生成')">生成</Button>
            <Button variant="secondary" @click="notifyAction('加入队列')">加入队列</Button>
            <Button variant="outline" @click="notifyAction('保存草稿')">保存草稿</Button>
            <Button variant="ghost" @click="notifyAction('重置')">重置</Button>
          </CardFooter>
        </Card>

        <div class="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>菜单：真正能定制内容</CardTitle>
              <CardDescription>普通菜单、二级菜单、勾选、快捷键盘键与自定义面板都在同一个结构里。</CardDescription>
            </CardHeader>
            <CardContent class="flex flex-col gap-4">
              <div class="flex flex-wrap items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="outline">
                      生成动作 <ChevronDownIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent class="w-64" align="start">
                    <DropdownMenuLabel>生成</DropdownMenuLabel>
                    <DropdownMenuGroup>
                      <DropdownMenuItem @select="notifyAction('生成图片')">
                        生成图片 <DropdownMenuShortcut>⌘ ↵</DropdownMenuShortcut>
                      </DropdownMenuItem>
                      <DropdownMenuItem @select="notifyAction('生成视频')">
                        生成视频 <DropdownMenuShortcut>⌘ ⇧ ↵</DropdownMenuShortcut>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>更多模型</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem @select="notifyAction('Seedream 4.5')">Seedream 4.5</DropdownMenuItem>
                        <DropdownMenuItem @select="notifyAction('Seedream 5.0 Pro')">Seedream 5.0 Pro</DropdownMenuItem>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>Seedance</DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuItem @select="notifyAction('Seedance 2.0')">2.0</DropdownMenuItem>
                            <DropdownMenuItem @select="notifyAction('Seedance 2.0 Fast')">2.0 Fast</DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem v-model="smartPrompt">提示词增强</DropdownMenuCheckboxItem>
                    <DropdownMenuItem variant="destructive" @select="notifyAction('清空参数')">清空参数</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Popover>
                  <PopoverTrigger as-child>
                    <Button variant="secondary">参数浮层</Button>
                  </PopoverTrigger>
                  <PopoverContent class="w-80" align="start">
                    <PopoverHeader>
                      <PopoverTitle>自定义参数面板</PopoverTitle>
                      <PopoverDescription>Popover 里可以放任意布局，不受菜单条目限制。</PopoverDescription>
                    </PopoverHeader>
                    <div class="grid gap-3">
                      <div class="flex items-center justify-between gap-3 text-sm">
                        <span>画面细节</span>
                        <span class="tabular-nums text-muted-foreground">{{ detailOpacity[0] }}%</span>
                      </div>
                      <Slider v-model="detailOpacity" :min="0" :max="100" :step="1" />
                      <Button size="sm" @click="notifyAction('应用参数')">应用参数</Button>
                    </div>
                  </PopoverContent>
                </Popover>

                <Dialog>
                  <DialogTrigger as-child>
                    <Button variant="outline">确认弹窗</Button>
                  </DialogTrigger>
                  <DialogContent class="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>开始生成？</DialogTitle>
                      <DialogDescription>这会消耗一次生成额度，生成结果会自动放进当前画布。</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button variant="outline">取消</Button>
                      <Button @click="notifyAction('确认生成')">开始生成</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>

              <p class="rounded-2xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                {{ lastAction }}
              </p>

              <Tabs v-model="activeTab" class="w-full">
                <TabsList class="w-full">
                  <TabsTrigger value="menu">菜单</TabsTrigger>
                  <TabsTrigger value="command">命令面板</TabsTrigger>
                  <TabsTrigger value="combobox">组合框</TabsTrigger>
                  <TabsTrigger value="feedback">反馈</TabsTrigger>
                </TabsList>

                <TabsContent value="menu" class="grid gap-2 pt-3">
                  <div class="flex items-center gap-2 text-sm">
                    <CheckIcon class="size-4" /> 菜单项支持图标、短键、钩选、危险色
                  </div>
                  <div class="flex items-center gap-2 text-sm text-muted-foreground">
                    <SearchIcon class="size-4" /> 子菜单按需展开，不抢主菜单布局
                  </div>
                </TabsContent>

                <TabsContent value="command" class="pt-3">
                  <div class="overflow-hidden rounded-3xl border border-border">
                    <Input v-model="selectedCommand" placeholder="搜动作 / 节点 / 设置（演示）" class="rounded-none border-0 border-b border-border bg-transparent" />
                    <div class="flex flex-col p-2">
                      <button
                        v-for="item in COMMANDS"
                        :key="item.value"
                        class="flex items-center justify-between rounded-2xl px-3 py-2 text-left text-sm hover:bg-muted"
                        @click="pick(item.value)"
                      >
                        <span>{{ item.label }}</span>
                        <span class="text-xs text-muted-foreground">{{ item.shortcut }}</span>
                      </button>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="combobox" class="pt-3">
                  <Combobox v-model="model" :ignore-filter="true">
                    <ComboboxAnchor>
                      <ComboboxInput v-model="modelQuery" placeholder="搜索模型" />
                    </ComboboxAnchor>
                    <ComboboxList>
                      <ComboboxViewport>
                        <ComboboxEmpty>没有匹配的模型</ComboboxEmpty>
                        <ComboboxItem v-for="m in filteredModels" :key="m.value" :value="m.value">
                          <span class="flex flex-1 items-center justify-between gap-2">
                            <span>{{ m.label }}</span>
                            <span class="text-xs text-muted-foreground">{{ m.hint }}</span>
                          </span>
                        </ComboboxItem>
                      </ComboboxViewport>
                    </ComboboxList>
                  </Combobox>
                </TabsContent>

                <TabsContent value="feedback" class="pt-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <Badge>默认</Badge>
                    <Badge variant="secondary">次级</Badge>
                    <Badge variant="outline">描边</Badge>
                    <Badge variant="destructive">危险</Badge>
                    <Button size="sm" variant="outline">轻提示</Button>
                    <Button size="sm" variant="ghost">消息</Button>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>覆盖范围</CardTitle>
              <CardDescription>当前已拉下来的组合件与单件。</CardDescription>
            </CardHeader>
            <CardContent class="flex flex-wrap gap-2">
              <Badge v-for="name in ['Button','Input','Textarea','NumberField','Slider','Switch','Checkbox','RadioGroup','Select','Combobox','DropdownMenu','ContextMenu','Menubar','Popover','Tooltip','Dialog','AlertDialog','Sheet','Tabs','Command','Card','Badge','Separator','InputGroup','ColorPicker']" :key="name" variant="outline">
                {{ name }}
              </Badge>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  </div>
</template>
