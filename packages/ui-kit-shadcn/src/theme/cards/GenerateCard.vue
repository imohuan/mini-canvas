<script setup lang="ts">
/**
 * 卡片墙 · 第 1 块：生成参数。
 *
 * 只负责「底栏真实会用到的一组控件」，做成一张竖长的卡片，
 * 和旁边较矮的卡片错落排开（用户口径 2026-11-04：要 shadcn blocks 那种卡片墙）。
 */
import { ref } from 'vue'
import {
  BanIcon,
  ChevronDownIcon,
  LoaderCircleIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  SendIcon,
} from '@lucide/vue'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  ColorPicker,
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
  Slider,
  Switch,
} from '@/previewKit'

interface ChoiceOption {
  value: string
  label: string
  hint?: string
}

const prompt = ref('一只在窗边打盹的橘猫，午后自然光')
const negative = ref('')
const model = ref('seedream')
const ratio = ref('16:9')
const resolution = ref('2k')
const count = ref<number>(1)
const steps = ref<number[]>([24])
const guidance = ref<number[]>([7.5])
const detail = ref(true)
const smartPrompt = ref(true)
const autoSelect = ref(true)
const paint = ref('solid')
const accentColor = ref('#0d99ff')
const generating = ref(false)
const lastAction = ref('还没有操作')

const modelOptions: ChoiceOption[] = [
  { value: 'seedream', label: 'Seedream 4.5', hint: '通用图像' },
  { value: 'seedream-pro', label: 'Seedream 5.0 Pro', hint: '细节更稳' },
  { value: 'seedance', label: 'Seedance 2.0', hint: '视频生成' },
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

/** 点一下进入 1.2 秒加载态，用来看加载按钮长什么样。 */
function runGenerate(): void {
  generating.value = true
  lastAction.value = '正在生成…'
  window.setTimeout(() => {
    generating.value = false
    lastAction.value = '生成完成（演示）'
  }, 1200)
}
</script>

<template>
  <Card class="break-inside-avoid">
    <CardHeader>
      <CardTitle class="text-sm">生成参数</CardTitle>
      <CardDescription class="text-xs">输入、下拉、数字、滑块、开关，底下是真实按钮组</CardDescription>
    </CardHeader>

    <CardContent class="grid gap-3">
      <div class="grid gap-1.5">
        <Label for="prompt" class="text-xs">提示词</Label>
        <Input id="prompt" v-model="prompt" placeholder="描述你想生成的内容" />
      </div>

      <div class="grid gap-1.5">
        <Label for="negative" class="text-xs">反向提示词</Label>
        <!-- 前缀图标：一眼看出这栏是「排除掉什么」 -->
        <div class="relative self-start">
          <BanIcon class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="negative" v-model="negative" class="pl-9" placeholder="不希望出现的元素" />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="grid gap-1.5">
          <Label class="text-xs">模型</Label>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" class="w-full justify-between font-normal">
                <span class="truncate">{{ labelOf(modelOptions, model) }}</span>
                <ChevronDownIcon class="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent class="w-56">
              <DropdownMenuRadioGroup v-model="model">
                <DropdownMenuRadioItem v-for="o in modelOptions" :key="o.value" :value="o.value">
                  {{ o.label }}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div class="grid gap-1.5">
          <Label class="text-xs">比例</Label>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" class="w-full justify-between font-normal">
                <span class="truncate">{{ labelOf(ratioOptions, ratio) }}</span>
                <ChevronDownIcon class="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent class="w-48">
              <DropdownMenuRadioGroup v-model="ratio">
                <DropdownMenuRadioItem v-for="o in ratioOptions" :key="o.value" :value="o.value">
                  {{ o.label }}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div class="grid gap-1.5">
          <Label class="text-xs">数量</Label>
          <NumberField v-model="count" :min="1" :max="8">
            <NumberFieldContent>
              <NumberFieldDecrement />
              <NumberFieldInput />
              <NumberFieldIncrement />
            </NumberFieldContent>
          </NumberField>
        </div>

        <div class="grid gap-1.5">
          <Label class="text-xs">清晰度</Label>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" class="w-full justify-between font-normal">
                <span class="truncate">{{ labelOf(resolutionOptions, resolution) }}</span>
                <ChevronDownIcon class="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent class="w-32">
              <DropdownMenuRadioGroup v-model="resolution">
                <DropdownMenuRadioItem v-for="o in resolutionOptions" :key="o.value" :value="o.value">
                  {{ o.label }}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div class="grid gap-3">
        <div class="grid gap-1.5">
          <div class="flex items-center justify-between gap-4">
            <Label class="text-xs">采样步数</Label>
            <span class="text-xs tabular-nums text-muted-foreground">{{ steps[0] }}</span>
          </div>
          <Slider v-model="steps" :min="1" :max="60" :step="1" />
        </div>
        <div class="grid gap-1.5">
          <div class="flex items-center justify-between gap-4">
            <Label class="text-xs">提示词权重</Label>
            <span class="text-xs tabular-nums text-muted-foreground">{{ guidance[0] }}</span>
          </div>
          <Slider v-model="guidance" :min="1" :max="20" :step="0.5" />
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-4">
        <label class="flex items-center gap-1.5 text-xs"><Checkbox v-model="detail" /> 高细节</label>
        <label class="flex items-center gap-1.5 text-xs"><Switch v-model="smartPrompt" /> 提示词增强</label>
        <label class="flex items-center gap-1.5 text-xs"><Switch v-model="autoSelect" /> 自动选中</label>
      </div>

      <div class="grid gap-1.5">
        <Label class="text-xs">笔刷</Label>
        <RadioGroup v-model="paint" class="flex flex-wrap gap-4">
          <label class="flex items-center gap-1.5 text-xs"><RadioGroupItem value="solid" /> 实心</label>
          <label class="flex items-center gap-1.5 text-xs"><RadioGroupItem value="soft" /> 柔边</label>
          <label class="flex items-center gap-1.5 text-xs"><RadioGroupItem value="eraser" /> 橡皮</label>
        </RadioGroup>
      </div>

      <div class="grid gap-1.5">
        <div class="flex items-center justify-between gap-2">
          <Label class="text-xs">颜色</Label>
          <span class="text-xs tabular-nums text-muted-foreground">{{ accentColor }}</span>
        </div>
        <ColorPicker v-model="accentColor" />
      </div>
    </CardContent>

    <CardFooter class="flex flex-col items-stretch gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <Button :disabled="generating" @click="runGenerate">
          <LoaderCircleIcon v-if="generating" class="animate-spin" />
          <SendIcon v-else />
          {{ generating ? '生成中…' : '生成' }}
        </Button>
        <Button variant="secondary" :disabled="generating" @click="lastAction = '已加入队列'">
          <PlusIcon /> 队列
        </Button>
        <Button variant="outline" @click="lastAction = '草稿已保存'"><SaveIcon /> 草稿</Button>
        <Button variant="ghost" @click="lastAction = '已重置'"><RotateCcwIcon /> 重置</Button>
      </div>
      <p class="rounded-lg bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground">{{ lastAction }}</p>
    </CardFooter>
  </Card>
</template>
