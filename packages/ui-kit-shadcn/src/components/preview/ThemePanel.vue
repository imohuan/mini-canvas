<script setup lang="ts">
/**
 * 主题配置面板：把 shadcn-vue 的 create 页面那几项做成可视化控件。
 *
 * 配置项与官方一致：Base Color / Theme / Chart Color / Heading / Font / Radius。
 * 全部改动实时写进页面变量，面板本身也立即换色，不用刷新。
 */
import { computed, ref } from 'vue'
import { CheckIcon, ChevronDownIcon, CopyIcon, MoonIcon, SunIcon } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  BASE_COLORS,
  CHART_COLORS,
  THEME_COLORS,
  previewColor,
  type BaseColor,
  type ChartColor,
  type ThemeColor,
} from '@/theme/colors'
import { FONT_OPTIONS, HEADING_OPTIONS, RADIUS_OPTIONS, findFont } from '@/theme/fonts'
import { SIZE_OPTIONS } from '@/theme/sizes'
import { exportThemeCss, type PreviewThemeConfig } from '@/theme/useThemePreview'

const props = defineProps<{
  config: PreviewThemeConfig
  dark: boolean
}>()

const emit = defineEmits<{
  'update:config': [value: PreviewThemeConfig]
  'update:dark': [value: boolean]
}>()

const copied = ref(false)

const scheme = computed(() => (props.dark ? 'dark' : 'light'))

interface ChoiceOption {
  value: string
  label: string
  hint?: string
  swatch?: string
}

type FieldKey = 'baseColor' | 'theme' | 'chartColor' | 'radius' | 'heading' | 'font' | 'size'

interface Field {
  key: FieldKey
  label: string
  value: string
  options: ChoiceOption[]
}

/** 底色下拉：每一项带一个色块，就是它实际选出来的背景色。 */
const baseOptions = computed<ChoiceOption[]>(() =>
  BASE_COLORS.map((name) => ({
    value: name,
    label: titleOf(name),
    swatch: previewColor(name as ThemeColor, scheme.value),
  })),
)

const themeOptions = computed<ChoiceOption[]>(() =>
  THEME_COLORS.map((name) => ({
    value: name,
    label: titleOf(name),
    swatch: previewColor(name, scheme.value),
  })),
)

const chartOptions = computed<ChoiceOption[]>(() =>
  CHART_COLORS.map((name) => ({
    value: name,
    label: titleOf(name),
    swatch: previewColor(name, scheme.value),
  })),
)

const fontOptions = computed<ChoiceOption[]>(() =>
  FONT_OPTIONS.map((f) => ({ value: f.id, label: f.label, hint: 'Aa' })),
)

const headingOptions = computed<ChoiceOption[]>(() =>
  HEADING_OPTIONS.map((f) => ({ value: f.id, label: f.label, hint: f.id === 'inherit' ? '' : 'Aa' })),
)

const radiusOptions = computed<ChoiceOption[]>(() =>
  RADIUS_OPTIONS.map((r) => ({ value: r.id, label: r.label })),
)

/** 尺寸档位：`inherit` 表示各组件按自己的 size prop（升级前的行为） */
const sizeOptions = computed<ChoiceOption[]>(() => [
  { value: 'inherit', label: '跟随组件默认' },
  ...SIZE_OPTIONS.map((s) => ({ value: s.id, label: s.label, hint: s.hint })),
])

function titleOf(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

const fields = computed<Field[]>(() => [
  { key: 'baseColor', label: 'Base Color', value: props.config.baseColor, options: baseOptions.value },
  { key: 'theme', label: 'Theme', value: props.config.theme, options: themeOptions.value },
  { key: 'chartColor', label: 'Chart Color', value: props.config.chartColor, options: chartOptions.value },
  { key: 'radius', label: 'Radius', value: props.config.radius.id, options: radiusOptions.value },
  { key: 'heading', label: 'Heading', value: props.config.heading, options: headingOptions.value },
  { key: 'font', label: 'Font', value: props.config.font, options: fontOptions.value },
  { key: 'size', label: 'Size（控件尺寸）', value: props.config.size, options: sizeOptions.value },
])

function setField(key: FieldKey, value: unknown): void {
  if (typeof value !== 'string') return
  if (key === 'baseColor') onBase(value)
  else if (key === 'theme') onTheme(value)
  else if (key === 'chartColor') onChart(value)
  else if (key === 'radius') onRadius(value)
  else if (key === 'heading') onHeading(value)
  else if (key === 'size') onSize(value)
  else onFont(value)
}

function selectedOption(field: Field): ChoiceOption | undefined {
  return field.options.find((o) => o.value === field.value)
}

function patch(changes: Partial<PreviewThemeConfig>): void {
  emit('update:config', { ...props.config, ...changes })
}

function onBase(value: string): void {
  patch({ baseColor: value as BaseColor })
}
function onTheme(value: string): void {
  patch({ theme: value as ThemeColor })
}
function onChart(value: string): void {
  patch({ chartColor: value as ChartColor })
}
function onFont(value: string): void {
  patch({ font: value })
}
function onHeading(value: string): void {
  patch({ heading: value })
}
function onRadius(value: string): void {
  const radius = RADIUS_OPTIONS.find((r) => r.id === value) ?? RADIUS_OPTIONS[0]!
  patch({ radius })
}
function onSize(value: string): void {
  const size = SIZE_OPTIONS.find((s) => s.id === value)
  patch({ size: size ? size.id : 'inherit' })
}

async function copyCss(): Promise<void> {
  try {
    await navigator.clipboard.writeText(exportThemeCss(props.config))
    copied.value = true
    window.setTimeout(() => (copied.value = false), 1600)
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <Card>
    <CardHeader>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex flex-col gap-1.5">
          <CardTitle>主题配置</CardTitle>
          <CardDescription>和 shadcn-vue 的 create 面板同一组选项，改完立即生效。</CardDescription>
        </div>
        <div class="flex items-center gap-2 rounded-2xl border border-border bg-background px-3 py-1.5">
          <SunIcon class="size-4 text-muted-foreground" />
          <Switch :model-value="dark" aria-label="切换暗色主题" @update:model-value="emit('update:dark', $event)" />
          <MoonIcon class="size-4 text-muted-foreground" />
        </div>
      </div>
    </CardHeader>
    <CardContent class="grid gap-4">
      <div class="grid gap-4 sm:grid-cols-2">
        <!-- 每一项都是 DropdownMenu 的分离件：Trigger 可自定、Content 里可放任意结构。 -->
        <div v-for="field in fields" :key="field.key" class="grid gap-2">
          <Label>{{ field.label }}</Label>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" class="w-full justify-between font-normal">
                <span class="flex min-w-0 items-center gap-2">
                  <span
                    v-if="selectedOption(field)?.swatch"
                    class="size-3 flex-none rounded-full ring-1 ring-black/10 dark:ring-white/20"
                    :style="{ background: selectedOption(field)?.swatch }"
                  />
                  <span class="truncate">{{ selectedOption(field)?.label ?? '请选择' }}</span>
                </span>
                <ChevronDownIcon class="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent class="max-h-72">
              <DropdownMenuRadioGroup
                :model-value="field.value"
                @update:model-value="setField(field.key, $event)"
              >
                <DropdownMenuRadioItem v-for="option in field.options" :key="option.value" :value="option.value">
                  <span class="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      v-if="option.swatch"
                      class="size-3 flex-none rounded-full ring-1 ring-black/10 dark:ring-white/20"
                      :style="{ background: option.swatch }"
                    />
                    <span class="truncate">{{ option.label }}</span>
                    <span v-if="option.hint" class="ml-auto truncate pl-2 text-xs text-muted-foreground">
                      {{ option.hint }}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Separator />

      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{{ titleOf(config.baseColor) }}</Badge>
          <Badge variant="outline">{{ titleOf(config.theme) }}</Badge>
          <Badge variant="outline">{{ titleOf(config.chartColor) }}</Badge>
          <Badge variant="outline">{{ findFont(config.font).label }}</Badge>
          <Badge variant="outline">radius {{ config.radius.value }}</Badge>
          <Badge variant="outline">
            size {{ config.size === 'inherit' ? '组件默认' : config.size }}
          </Badge>
        </div>
        <Button variant="outline" size="sm" @click="copyCss">
          <CheckIcon v-if="copied" />
          <CopyIcon v-else />
          {{ copied ? '已复制' : '复制 CSS' }}
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
