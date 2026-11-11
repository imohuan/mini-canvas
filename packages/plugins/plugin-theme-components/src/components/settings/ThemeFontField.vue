<script setup lang="ts">
/**
 * ThemeFontField —— 「外观 → 字体」的字体下拉。
 *
 * 和组件库预览页（ui-kit-shadcn 的 App.vue / FontSelect）同一套写法：
 * 菜单按「中文 / 无衬线 / 衬线 / 等宽」分组，每一项都用**它自己的字体**渲染
 * 「设置 画布 Aa 123」，选之前就能看出观感。
 *
 * 为什么不直接复用预览页那个 FontSelect.vue：预览页组件走 `@/previewKit`
 * 和预览页自己的别名，属于组件库内部件；设置面板只从组件库取原始原子件
 * （DropdownMenu / Button），排版与文案归主题插件自己管。
 *
 * 值仍写回设置 store（由 SettingsSchemaField 调 set），这里只管画和选中。
 */
import { computed, ref } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  findFont,
  fontGroup,
  fontStack,
  loadFont,
  type FontGroup,
} from '@plume-canvas/ui-kit-shadcn'
import { useUiComponentOutside } from '../../composables/useUiComponentOutside'
import { THEME_FONT_OPTIONS } from '@plume-canvas/theme-contract'

const props = withDefaults(
  defineProps<{
    /** 当前字体 id；`inherit` 表示跟随（正文=跟随宿主，标题=跟随正文） */
    modelValue: string
    /** 有这一项时，菜单顶部多一档 `inherit` */
    followLabel?: string
    /** 跟随项的说明 */
    followHint?: string
    ariaLabel?: string
  }>(),
  { followLabel: '', followHint: '', ariaLabel: '字体' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

/** 按钮走 ui 目录：全局「控件尺寸」由注册薄层注入，这里不写死高度。 */
const Button = useUiComponentOutside('Button')

const FOLLOW = 'inherit'

const GROUP_LABELS: Array<{ id: FontGroup; label: string }> = [
  { id: 'cjk', label: '中文' },
  { id: 'sans', label: '无衬线 Sans' },
  { id: 'serif', label: '衬线 Serif' },
  { id: 'mono', label: '等宽 Mono' },
]

const groupedOptions = computed(() =>
  GROUP_LABELS.map((group) => ({
    ...group,
    items: THEME_FONT_OPTIONS.filter((font) => fontGroup(font) === group.id),
  })).filter((group) => group.items.length > 0),
)

const currentFont = computed(() => (props.modelValue === FOLLOW ? null : findFont(props.modelValue)))
const currentStack = computed(() => (currentFont.value ? fontStack(currentFont.value) : 'inherit'))

/** 字体样例要自己的字形：第一次打开菜单时插一次 link（浏览器会复用缓存）。 */
const fontsLoaded = ref(false)
function warmFonts(open: boolean): void {
  if (!open || fontsLoaded.value) return
  fontsLoaded.value = true
  for (const font of THEME_FONT_OPTIONS) loadFont(font)
}

function pick(value: string): void {
  emit('update:modelValue', value)
}
</script>

<template>
  <DropdownMenu @update:open="warmFonts">
    <DropdownMenuTrigger as-child>
      <Button variant="outline" class="tff-trigger" :aria-label="ariaLabel">
        <span class="tff-current" :style="{ fontFamily: currentStack }">
          {{ currentFont ? currentFont.label : followLabel || '跟随' }}
        </span>
        <ChevronDown class="tff-chevron" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>

    <DropdownMenuContent
      class="settings-floating-layer"
      :style="{ width: '20rem' }"
    >
      <template v-if="followLabel">
        <DropdownMenuLabel>跟随</DropdownMenuLabel>
        <DropdownMenuItem @select="pick(FOLLOW)">
          <span class="tff-item">
            <span class="tff-item-name">
              <Check v-if="modelValue === FOLLOW" class="tff-check" aria-hidden="true" />
              <span v-else class="tff-check" aria-hidden="true" />
              {{ followLabel }}
            </span>
            <span v-if="followHint" class="tff-hint">{{ followHint }}</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
      </template>

      <template v-for="(group, groupIndex) in groupedOptions" :key="group.id">
        <DropdownMenuSeparator v-if="groupIndex > 0" />
        <DropdownMenuLabel>{{ group.label }}</DropdownMenuLabel>
        <DropdownMenuItem
          v-for="font in group.items"
          :key="font.id"
          @select="pick(font.id)"
        >
          <span class="tff-item">
            <span class="tff-item-name">
              <Check v-if="modelValue === font.id" class="tff-check" aria-hidden="true" />
              <span v-else class="tff-check" aria-hidden="true" />
              {{ font.label }}
            </span>
            <!-- 这一行用该字体自己渲染：选中后的真实观感 -->
            <span class="tff-sample" :style="{ fontFamily: fontStack(font) }">设置 画布 Aa 123</span>
          </span>
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<style scoped>
/* 只排布局；颜色一律用菜单自带的默认样式 */
.tff-trigger {
  width: 100%;
  justify-content: space-between;
  overflow: hidden;
  font-weight: 400;
}

.tff-current {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.tff-chevron {
  width: 14px;
  height: 14px;
  flex: none;
}

/* 每一项两行：字体名 + 该字体的样例 */
.tff-item {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.tff-item-name {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 勾位固定宽：选中与未选中文字对齐，不跳一格 */
.tff-check {
  width: 14px;
  height: 14px;
  flex: none;
}

.tff-hint {
  padding-left: 20px;
  font-size: 11px;
  opacity: 0.7;
}

.tff-sample {
  padding-left: 20px;
  overflow: hidden;
  font-size: 14px;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
