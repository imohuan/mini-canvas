<script setup lang="ts">
/**
 * 预览页顶部的「组件配置」条。
 *
 * 这里的每一项都对应真实组件会读的开关，改完立刻生效：
 * - 颜色 / 字体 / 圆角：写 CSS 变量；
 * - 尺寸档位 / 箭头 / 间距 / 偏移 / 二级菜单间距：写 componentConfig。
 *
 * 所以它既是调试面板，也是「这些配置到底有没有用」的活证据。
 */
import { computed } from 'vue'
import { ChevronDownIcon } from '@lucide/vue'
import {
  Button,
  Label,
  Switch,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  NumberField,
  NumberFieldContent,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
  RadioGroup,
} from '../previewKit'
import { BASE_COLORS, THEME_COLORS, previewColor, type BaseColor, type ThemeColor } from './colors'
import { RADIUS_OPTIONS } from './fonts'
import FontSelect from './FontSelect.vue'
import RadiusPreview from './RadiusPreview.vue'
import { COMPONENT_SIZE_CHOICES } from '../componentConfig'
import type { PreviewThemeConfig } from './useThemePreview'

const props = defineProps<{ config: PreviewThemeConfig; dark: boolean }>()
const emit = defineEmits<{ 'update:config': [value: PreviewThemeConfig]; 'update:dark': [value: boolean] }>()

interface Option {
  value: string
  label: string
  swatch?: string
  /** 圆角单选上的短标签（括号里的数值放进 title，胶囊里放不下） */
  short?: string
  /** 尺寸单选里示意高度（px） */
  blockHeight?: number
}

function patch(changes: Partial<PreviewThemeConfig>): void {
  emit('update:config', { ...props.config, ...changes })
}

function titleOf(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

const baseOptions = computed<Option[]>(() =>
  BASE_COLORS.map((name) => ({
    value: name,
    label: titleOf(name),
    swatch: name === 'neutral' ? (props.dark ? 'oklch(0.145 0 0)' : 'oklch(1 0 0)') : name === 'stone' ? (props.dark ? 'oklch(0.147 0.004 49.25)' : 'oklch(1 0 0)') : name === 'zinc' ? (props.dark ? 'oklch(0.141 0.005 285.823)' : 'oklch(1 0 0)') : (props.dark ? 'oklch(0.145 0.008 326)' : 'oklch(1 0 0)'),
  })),
)

const themeOptions = computed<Option[]>(() =>
  THEME_COLORS.map((name) => ({
    value: name,
    label: titleOf(name),
    swatch: previewColor(name as ThemeColor, props.dark ? 'dark' : 'light'),
  })),
)

const radiusOptions = computed<Option[]>(() =>
  RADIUS_OPTIONS
    .map((r) => ({
      value: r.id,
      label: r.label,
      // 标签直接用「无 / 极小 / 小 / 中 / 大 / 特大」，不再出现“默认”
      short: r.label.split('（')[0],
    })),
)

const sizeOptions = computed<Option[]>(() =>
  COMPONENT_SIZE_CHOICES.map((size) => ({
    value: size,
    label: size === 'sm' ? '小' : size === 'lg' ? '大' : '标准',
    // 20×20 框内可显示 4~14px：三档互相差 4px，缩略图能看出层次又不撑高
    blockHeight: size === 'sm' ? 6 : size === 'lg' ? 14 : 10,
  })),
)

/**
 * 圆角档位 id → 真实像素值。
 *
 * 通过档位表换算（不是把 id 当 rem 解析）；认不出的 id 一律当 0。
 * 预览改成 SVG 弧线后（见 RadiusPreview.vue），这里只需要给数值。
 * 认不出的值（旧档位残留）一律当 0。
 */
function radiusPx(id: string): number {
  const option = RADIUS_OPTIONS.find((r) => r.id === id)
  const match = /^([\d.]+)rem$/.exec(option?.value ?? '')
  return match ? Number(match[1]) * 16 : 0
}

/**
 * 两组单选共用的胶囊样式。
 *
 * 为什么必须共用一个常量（2026-11-04 用户截图反馈）：
 * 圆角组和尺寸组原本各写一套，圆角那块写死 `size-5`（20px）+ py-1，整格高 44px；
 * 尺寸组的方块跟着档位在 8~14px 之间变，整格只有 26px。
 * 两行上下并排，高度差肉眼可见，看起来像「两套控件」。
 *
 * 现在两格都固定 h-9（36px）、同样的内边距与字号，视觉方块统一装在 20×20 的框里居中，
 * 只有框**内部**的形状随档位变 —— 行高恒定，内容仍能看出差别。
 */
/**
 * 单选项的排版类 —— 高度不写死。
 *
 * 用户口径 2026-11-04：为什么尺寸选「小」时这格还是 36px 高？
 * 因为这里之前写死了 h-9。现在高度交给 Button 自己的 size 变体（h-8 / h-9 / h-10），
 * 单选选项就是一个 Button，size 走组件配置，与页面其它控件同步变化。
 */
const CHOICE_CHIP =
  'w-auto cursor-pointer justify-start gap-1.5 rounded-lg px-1.5 text-xs transition-colors hover:bg-muted/60'

/**
 * 选中 / 未选中的配色（两组一致）。
 *
 * 用户口径 2026-11-04：选项外面那圈边框不要。
 * 所以这里只用**底色 + 文字色**表达选中：选中铺一层浅主题底、文字加深；
 * 未选中完全透明，靠左边那个圆点（RadioGroupItem 自己带环）表示可点。
 * 不再写 border-*，避免又画出一圈框。
 */
function chipClass(active: boolean): string {
  return active
    ? 'bg-primary/15 font-medium text-foreground'
    : 'text-muted-foreground'
}

function labelOf(options: Option[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value
}

function swatchOf(options: Option[], value: string): string | undefined {
  return options.find((o) => o.value === value)?.swatch
}

/**
 * reka 的 RadioGroup 回传的是 `AcceptableValue`（可能是 string / number / null），
 * 面板里全是字符串档位，这里统一收成 string 再写回配置。
 */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}
</script>

<template>
  <!-- 只画一条细线：配置栏本身不是卡片，别和下面的卡片抢视觉 -->
  <div class="border-t border-border/60 pt-2">
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-baseline gap-2">
        <span class="text-xs font-medium">组件配置</span>
        <span class="text-[11px] text-muted-foreground">改完立刻作用到下面所有卡片（含 Teleport 出去的浮层）</span>
      </div>
      <label class="flex items-center gap-2 text-[11px] text-muted-foreground">
        暗色
        <Switch :model-value="dark" @update:model-value="emit('update:dark', $event)" />
      </label>
    </div>

    <!--
      6 列（用户口径 2026-11-04，反复强调）：
      第一行：底色 / 主题 / 正文字体 / 标题字体 各 1 列，圆角占 2 列 → 正好 6；
      第二行：尺寸 2 列 + 箭头 / 子菜单 / gap / offset 各 1 列 → 正好 6。
      两行装完全部配置，滚动看卡片时吸顶不挡内容。
    -->
    <div class="grid gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-6">
      <!-- 颜色：底色 / 主题色 -->
      <div class="grid gap-1.5">
        <Label class="text-xs">底色 Base Color</Label>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="outline" class="w-full justify-between font-normal">
              <span class="flex min-w-0 items-center gap-2">
                <span class="size-3 flex-none rounded-full ring-1 ring-black/10 dark:ring-white/20" :style="{ background: swatchOf(baseOptions, config.baseColor) }" />
                <span class="truncate">{{ labelOf(baseOptions, config.baseColor) }}</span>
              </span>
              <ChevronDownIcon class="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-52">
            <DropdownMenuRadioGroup :model-value="config.baseColor" @update:model-value="(v) => patch({ baseColor: v as BaseColor })">
              <DropdownMenuRadioItem v-for="o in baseOptions" :key="o.value" :value="o.value">
                <span class="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    class="size-3.5 flex-none rounded-full ring-1 ring-black/15 dark:ring-white/25"
                    :style="{ background: o.swatch }"
                    aria-hidden="true"
                  />
                  <span class="truncate">{{ o.label }}</span>
                </span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div class="grid gap-1.5">
        <Label class="text-xs">主题色 Theme</Label>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="outline" class="w-full justify-between font-normal">
              <span class="flex min-w-0 items-center gap-2">
                <span class="size-3 flex-none rounded-full ring-1 ring-black/10 dark:ring-white/20" :style="{ background: swatchOf(themeOptions, config.theme) }" />
                <span class="truncate">{{ labelOf(themeOptions, config.theme) }}</span>
              </span>
              <ChevronDownIcon class="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-52">
            <DropdownMenuRadioGroup :model-value="config.theme" @update:model-value="(v) => patch({ theme: v as ThemeColor })">
              <DropdownMenuRadioItem v-for="o in themeOptions" :key="o.value" :value="o.value">
                <span class="flex min-w-0 flex-1 items-center gap-2">
                  <!-- 每个选项都画它自己的颜色，选之前就知道会变成什么样 -->
                  <span
                    class="size-3.5 flex-none rounded-full ring-1 ring-black/15 dark:ring-white/25"
                    :style="{ background: o.swatch }"
                    aria-hidden="true"
                  />
                  <span class="truncate">{{ o.label }}</span>
                </span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <!-- 字体：正文 / 标题 -->
      <div class="grid gap-1.5">
        <Label class="text-xs">正文字体 Font</Label>
        <FontSelect :model-value="config.font" @update:model-value="(v) => patch({ font: v })" />
      </div>

      <div class="grid gap-1.5">
        <Label class="text-xs">标题字体 Heading</Label>
        <FontSelect allow-follow :model-value="config.heading" @update:model-value="(v) => patch({ heading: v })" />
      </div>

      <!--
        形状 / 尺寸：两组单选各占半行（sm:col-span-2）。
        只给一格宽度时，尺寸组三项放不下会折成两行，和旁边的圆角组一高一矮
        —— 用户读成「两个单选尺寸差这么多」。占同样宽度后两行高度与排版都一致。
      -->
      <div class="grid gap-1.5 sm:col-span-2">
        <Label class="text-xs">圆角 Radius</Label>
        <!--
          圆角是「一眼能对比」的选项，用独立单选铺开比塞进下拉更好选。
          每一档左边画一个圆角方块，直接看出它有多圆。
        -->
        <RadioGroup
          :model-value="config.radius"
          class="flex flex-wrap gap-1"
          @update:model-value="(v) => patch({ radius: asText(v) })"
        >
          <Button
            v-for="o in radiusOptions"
            :key="o.value"
            :title="o.label"
            type="button"
            variant="ghost"
            :class="[CHOICE_CHIP, chipClass(config.radius === o.value)]"
            @click="patch({ radius: o.value })"
          >
            <span
              class="size-2.5 flex-none rounded-full"
              :class="config.radius === o.value ? 'bg-primary ring-2 ring-primary/30' : 'ring-1 ring-foreground/40'"
              aria-hidden="true"
            />
            <!--
              20×20 的固定框：里面用 SVG 画「直线→圆弧→直线」的转角，
              和真实圆角的过渡一致（参考用户给的 SVG path 方案）。
              框本身尺寸不变，所以每格高度仍然一致。
            -->
            <span
              class="flex size-5 flex-none items-center justify-center text-current"
              aria-hidden="true"
            >
              <!-- 26px 框 + 2px 线：12px 的弧才看得出弯 -->
              <RadiusPreview :radius="radiusPx(o.value)" :box="28" class="size-[26px]" />
            </span>
            <span>{{ o.short }}</span>
          </Button>
        </RadioGroup>
      </div>

      <div class="grid gap-1.5 sm:col-span-2">
        <Label class="text-xs">控件尺寸 Size</Label>
        <!-- 尺寸也是三档单选：每项旁边画一个对应高度的方块，比“小/标准/大”更实在 -->
        <RadioGroup
          :model-value="config.size"
          class="flex flex-wrap gap-1.5"
          @update:model-value="(v) => patch({ size: asText(v) as PreviewThemeConfig['size'] })"
        >
          <Button
            v-for="o in sizeOptions"
            :key="o.value"
            type="button"
            variant="ghost"
            :class="[CHOICE_CHIP, chipClass(config.size === o.value)]"
            @click="patch({ size: o.value as PreviewThemeConfig['size'] })"
          >
            <span
              class="size-2.5 flex-none rounded-full"
              :class="config.size === o.value ? 'bg-primary ring-2 ring-primary/30' : 'ring-1 ring-foreground/40'"
              aria-hidden="true"
            />
            <!-- 和圆角那组同规格的 20×20 框，里面画档位对应的高度 -->
            <span
              class="flex size-5 flex-none items-center justify-center"
              aria-hidden="true"
            >
              <span
                class="w-4 border-2 border-current"
                :style="{ height: o.blockHeight + 'px', borderRadius: '2px' }"
              />
            </span>
            <span>{{ o.label }}</span>
          </Button>
        </RadioGroup>
      </div>

      <!-- 浮层：箭头 / 间距 / 偏移 / 二级菜单间距 -->
      <div class="grid gap-1.5">
        <Label class="text-xs">浮层箭头</Label>
        <label class="flex h-8 items-center gap-2 text-xs text-muted-foreground">
          <Switch
            :model-value="config.arrowVisible"
            @update:model-value="patch({ arrowVisible: $event })"
          />
          {{ config.arrowVisible ? '显示' : '不显示' }}
        </label>
      </div>

      <div class="grid gap-1.5">
        <Label class="text-xs">子菜单间距</Label>
        <NumberField :model-value="config.subGap" :min="0" :max="40" :step="1" @update:model-value="patch({ subGap: $event })">
          <NumberFieldContent>
            <NumberFieldDecrement />
            <NumberFieldInput />
            <NumberFieldIncrement />
          </NumberFieldContent>
        </NumberField>
      </div>

      <div class="grid gap-1.5">
        <Label class="text-xs">触发器间距 gap</Label>
        <NumberField :model-value="config.gap" :min="0" :max="40" :step="1" @update:model-value="patch({ gap: $event })">
          <NumberFieldContent>
            <NumberFieldDecrement />
            <NumberFieldInput />
            <NumberFieldIncrement />
          </NumberFieldContent>
        </NumberField>
      </div>

      <div class="grid gap-1.5">
        <Label class="text-xs">额外偏移 offset</Label>
        <NumberField :model-value="config.offset" :min="0" :max="40" :step="1" @update:model-value="patch({ offset: $event })">
          <NumberFieldContent>
            <NumberFieldDecrement />
            <NumberFieldInput />
            <NumberFieldIncrement />
          </NumberFieldContent>
        </NumberField>
      </div>
    </div>

    <p class="mt-2 text-[11px] text-muted-foreground">
      浮层最终距离 = gap + offset；有箭头时从箭头尖端量起。
    </p>
  </div>
</template>
