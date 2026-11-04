<script setup lang="ts">
/**
 * ui-kit-shadcn 预览页。
 *
 * 这一页只做一件事：把 shadcn-vue 的组合件按真实用法摆出来，方便先看交互再决定
 * 哪些件注册进画布的 `ui` 目录。组件本身保持原样，没有在预览里再包一层“适配组件”。
 *
 * 组件统一从 `@/previewKit` 取：它只多套一层和真实应用相同的 `withComponentConfig`，
 * 这样顶部「组件配置」改尺寸/箭头/间距时，页面上的组件会真的跟着变。
 */
import { computed, onBeforeUnmount, ref, watchEffect } from 'vue'
import {
  ChevronDownIcon,
  BanIcon,
  SparklesIcon,
  LoaderCircleIcon,
  SendIcon,
  SaveIcon,
  RotateCcwIcon,
  PlusIcon,
} from '@lucide/vue'

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  ColorPicker,
  Combobox,
  ComboboxAnchor,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxViewport,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Input,
  Label,
  NumberField,
  NumberFieldContent,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
  RadioGroup,
  RadioGroupItem,
  Separator,
  Slider,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@/previewKit'
import ThemeConfigBar from '@/theme/ThemeConfigBar.vue'
import OverlayShowcase from '@/theme/OverlayShowcase.vue'
import { UiToaster } from '@/components/notification'
import { useThemePreview, type PreviewThemeConfig } from '@/theme/useThemePreview'

const dark = ref(true)
const themeConfig = ref<PreviewThemeConfig>({
  baseColor: 'neutral',
  theme: 'neutral',
  font: 'montserrat',
  heading: 'inherit',
  // 新的圆角档位更细：默认落在「大 8px」，不再是一上来就 14px 那种圆
  radius: 'large',
  size: 'default',
  arrowVisible: false,
  gap: 8,
  offset: 0,
  subGap: 8,
  // 每类浮层默认跟随全局 popover（空串）
  surface: {
    Select: '',
    DropdownMenu: '',
    Popover: '',
    Tooltip: '',
    Dialog: '',
    Notify: '',
    Message: '',
  },
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
const activeTab = ref('basics')
const accentColor = ref('#0d99ff')
const selectedCommand = ref('')
const modelQuery = ref('')
const lastAction = ref('还没有选过菜单项')
/** 「生成」按钮的加载态：点一下进入 1.2 秒的进行中，用来看加载按钮长什么样。 */
const generating = ref(false)

function runGenerate(): void {
  generating.value = true
  lastAction.value = '正在生成…'
  window.setTimeout(() => {
    generating.value = false
    lastAction.value = '生成完成（演示）'
  }, 1200)
}

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
  <!-- 暗色变量挂在 <html> 上（见脚本），预览根不需要再加上 .dark 类。 -->
  <div class="min-h-dvh bg-background text-foreground">
    <!--
      全宽铺满：不再用 max-w-6xl 收中间一窄条（用户口径 2026-11-04：
      「全屏状态下左右间距太大，要做展示全部内容的 UI」）。
      左右只留 4 个间隙，卡片墙用 3 列铺开，宽屏下能看到更多内容。
    -->
    <div class="flex w-full flex-col gap-4 px-4 py-4">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <Badge variant="outline">shadcn-vue</Badge>
            <Badge variant="secondary">reka-ui</Badge>
          </div>
          <h1 class="text-2xl font-semibold tracking-tight">mini-canvas · shadcn UI 预览</h1>
          <p class="max-w-2xl text-sm text-muted-foreground">
            这些组件保持 shadcn-vue 的原始组合结构。下面所有下拉都走同一套组件配置，
            顶部改一项，页面上的触发器和浮层就跟着变。
          </p>
        </div>
      </header>

      <!-- 配置栏吸顶：滚动看卡片时随时能改 -->
      <div class="sticky top-0 z-30 -mx-4 bg-background/85 px-4 py-2 backdrop-blur">
        <ThemeConfigBar v-model:config="themeConfig" v-model:dark="dark" />
      </div>

      <!-- 浮层组件案例：Select / DropdownMenu / Popover / Tooltip / Dialog / Notify / Message -->
      <OverlayShowcase />

      <!--
        卡片墙：每块卡片 self-start，避免同行被拉成一样高；
        三列在宽屏铺开，窄屏自动落成两列 / 单列。
      -->
      <div class="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        <!-- 左栏铺满整宽：一块卡片里放生成参数 + 基础组件 Tabs -->
        <Card class="self-start col-span-full">
          <CardHeader>
            <CardTitle>生成参数</CardTitle>
            <CardDescription>底栏真实会用到的一组控件：输入、分离式下拉、数字与滑块。</CardDescription>
          </CardHeader>
          <!-- 宽屏两列：左边提示词/参数，右边开关与颜色，避免一行被拉太长 -->
          <CardContent class="grid gap-4 lg:grid-cols-2 lg:gap-x-6">
            <div class="grid gap-2">
              <Label for="prompt">提示词</Label>
              <!--
                可拉伸输入框：右下角带 resize 手柄。
                Textarea 本身支持 resize，这里补一条可见的手柄样式（`resize-y` 只允许上下拉，
                避免拉宽把卡片布局挤变形），并把最小/最大高度写清楚。
              -->
              <Textarea
                id="prompt"
                v-model="prompt"
                class="min-h-24 max-h-64 resize-y"
                placeholder="描述你想生成的内容"
              />
              <span class="text-[11px] text-muted-foreground">拖动右下角可调高度</span>
            </div>

            <div class="grid gap-2">
              <Label for="negative">反向提示词</Label>
              <!--
                前缀图标：一眼看出这栏是「排除掉什么」。
                注意要 self-start：网格行默认会被拉高到和左边提示词一样，
                那样图标的 top-1/2 会跑到输入框下方（2026-11-04 实测踩到）。
              -->
              <div class="relative self-start">
                <BanIcon class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="negative" v-model="negative" class="pl-9" placeholder="不希望出现的元素" />
              </div>
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

            <!-- 按钮的各种状态：图标 / 文字+图标 / 加载 / 禁用 -->
            <div class="grid gap-2">
              <Label>按钮状态</Label>
              <div class="flex flex-wrap items-center gap-2">
                <Button size="icon-sm" aria-label="新增" title="图标按钮">
                  <PlusIcon />
                </Button>
                <Button variant="outline">
                  <SparklesIcon /> 优化提示词
                </Button>
                <Button disabled>
                  <LoaderCircleIcon class="animate-spin" /> 生成中
                </Button>
                <Button variant="secondary" disabled>已完成</Button>
                <Button variant="ghost" disabled>不可用</Button>
                <Button variant="destructive">
                  <BanIcon /> 清空
                </Button>
              </div>
              <span class="text-[11px] text-muted-foreground">
                图标按钮 / 图标+文字 / 加载中 / 禁用 / 危险操作
              </span>
            </div>
          </CardContent>
          <CardFooter class="flex flex-wrap items-center gap-2">
            <Button :disabled="generating" @click="runGenerate">
              <LoaderCircleIcon v-if="generating" class="animate-spin" />
              <SendIcon v-else />
              {{ generating ? '生成中…' : '生成' }}
            </Button>
            <Button variant="secondary" :disabled="generating" @click="notifyAction('加入队列')">
              <PlusIcon /> 加入队列
            </Button>
            <Button variant="outline" @click="notifyAction('保存草稿')">
              <SaveIcon /> 保存草稿
            </Button>
            <Button variant="ghost" @click="notifyAction('重置')">
              <RotateCcwIcon /> 重置
            </Button>
          </CardFooter>

          <CardFooter class="flex flex-col items-stretch gap-3">
            <p class="rounded-2xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              {{ lastAction }}
            </p>

            <!-- 基础组件：按钮 / 徽标 / 勾选 / 开关 / 滑块 / 输入 / 分隔线 -->
            <Tabs v-model="activeTab" class="w-full">
              <TabsList class="w-full">
                <TabsTrigger value="basics">基础</TabsTrigger>
                <TabsTrigger value="command">命令面板</TabsTrigger>
                <TabsTrigger value="combobox">组合框</TabsTrigger>
                <TabsTrigger value="feedback">反馈</TabsTrigger>
              </TabsList>
              <TabsContent value="basics" class="grid gap-3 pt-3">
                <div class="flex flex-wrap items-center gap-2">
                  <Button>主按钮</Button>
                  <Button variant="secondary">次级</Button>
                  <Button variant="outline">描边</Button>
                  <Button variant="ghost">幽灵</Button>
                  <Button variant="destructive">危险</Button>
                  <Button variant="link">链接</Button>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <Badge>默认</Badge>
                  <Badge variant="secondary">次级</Badge>
                  <Badge variant="outline">描边</Badge>
                  <Badge variant="destructive">危险</Badge>
                </div>
                <div class="flex flex-wrap items-center gap-4">
                  <label class="flex items-center gap-2 text-sm"><Checkbox v-model="checked" /> 勾选</label>
                  <label class="flex items-center gap-2 text-sm"><Switch v-model="enabled" /> 开关</label>
                </div>
                <div class="grid gap-2">
                  <Label class="text-xs">滑块</Label>
                  <Slider v-model="steps" :min="1" :max="60" :step="1" />
                  <span class="text-xs tabular-nums text-muted-foreground">当前 {{ steps[0] }}</span>
                </div>
                <div class="grid gap-2">
                  <Label class="text-xs">输入框 / 文本域</Label>
                  <Input v-model="negative" placeholder="单行输入" />
                  <Textarea v-model="prompt" class="min-h-16 resize-y" placeholder="多行文本" />
                </div>
                <Separator />
                <span class="text-[11px] text-muted-foreground">
                  Tabs / 分隔线 / 徽标 / 勾选 / 开关 / 滑块 / 输入，均跟随上方圆角与尺寸
                </span>
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
                  <Button variant="outline">轻提示</Button>
                  <Button variant="ghost">消息</Button>
                </div>
              </TabsContent>
            </Tabs>
          </CardFooter>
        </Card>
      </div>
    </div>

    <!-- 通知挂载点：Notify 案例（vue-sonner）需要有它才会出现 -->
    <UiToaster />
  </div>
</template>

