<script setup lang="ts">
/** 生成参数：底栏真实会用到的一组控件（输入、分离式下拉、数字、滑块）。 */
import { ref } from 'vue'
import { ChevronDownIcon } from '@lucide/vue'
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
  Separator,
  Slider,
  Switch,
  Textarea,
} from '@/previewKit'

const emit = defineEmits<{ action: [label: string] }>()

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
const accentColor = ref('#0d99ff')

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
</script>

<template>
  <Card class="min-w-0">
    <CardHeader>
      <CardTitle>生成参数</CardTitle>
      <CardDescription>输入、下拉、数字与滑块。</CardDescription>
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
        <div class="grid min-w-0 gap-2">
          <Label>模型</Label>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" class="w-full min-w-0 justify-between font-normal">
                <span class="truncate">{{ labelOf(modelOptions, model) }}</span>
                <ChevronDownIcon class="flex-none text-muted-foreground" />
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

        <div class="grid min-w-0 gap-2">
          <Label>比例</Label>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" class="w-full min-w-0 justify-between font-normal">
                <span class="truncate">{{ labelOf(ratioOptions, ratio) }}</span>
                <ChevronDownIcon class="flex-none text-muted-foreground" />
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
        <div class="grid min-w-0 gap-2">
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

        <div class="grid min-w-0 gap-2">
          <Label>清晰度</Label>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" class="w-full min-w-0 justify-between font-normal">
                <span class="truncate">{{ labelOf(resolutionOptions, resolution) }}</span>
                <ChevronDownIcon class="flex-none text-muted-foreground" />
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
      <Button @click="emit('action', '生成')">生成</Button>
      <Button variant="secondary" @click="emit('action', '加入队列')">加入队列</Button>
      <Button variant="outline" @click="emit('action', '保存草稿')">保存草稿</Button>
      <Button variant="ghost" @click="emit('action', '重置')">重置</Button>
    </CardFooter>
  </Card>
</template>
