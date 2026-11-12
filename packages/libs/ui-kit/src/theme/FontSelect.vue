<script setup lang="ts">
/**
 * 字体下拉：**单选项**，每一项都用它自己的字体渲染。
 *
 * 为什么不能只写字体名字（用户口径 2026-11-04）：名字都是一行黑体小字，
 * 看不出选中之后界面长什么样，等于让人盲选。
 *
 * 每项给两行：
 * - 小字：字体名（用界面自己的字体，保证可读）；
 * - 大字：中英混排样例「设置 画布 Aa 123」，**用该字体渲染**，中文字体照实显示中文。
 */
import { computed, onMounted } from 'vue'
import { ChevronDownIcon } from '@lucide/vue'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../previewKit'
import { FONT_OPTIONS, findFont, fontGroup, fontStack, loadFont, type FontGroup } from './fonts'

const props = withDefaults(
  defineProps<{
    /** 当前选中的字体 id；标题字体可以是 'inherit' */
    modelValue: string
    /** 标题字体传 true：多一项「跟随正文」 */
    allowFollow?: boolean
  }>(),
  { allowFollow: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

/** 标题字体专用的「跟随正文」档：不是字体，单独放在最上面。 */
const FOLLOW_BODY = 'inherit'

const GROUP_LABELS: Array<{ id: FontGroup; label: string }> = [
  { id: 'cjk', label: '中文' },
  { id: 'sans', label: '无衬线 Sans' },
  { id: 'serif', label: '衬线 Serif' },
  { id: 'mono', label: '等宽 Mono' },
]

const groupedOptions = computed(() =>
  GROUP_LABELS.map((group) => ({
    ...group,
    items: FONT_OPTIONS.filter((font) => fontGroup(font) === group.id),
  })).filter((group) => group.items.length > 0),
)

const currentFont = computed(() => (props.modelValue === FOLLOW_BODY ? null : findFont(props.modelValue)))
const currentStack = computed(() => (currentFont.value ? fontStack(currentFont.value) : 'inherit'))

/** 预览里每一项都要用自己的字形：进页面就把所有字体插一次 link（浏览器会复用缓存）。 */
function loadAllFonts(): void {
  for (const font of FONT_OPTIONS) loadFont(font)
}
onMounted(loadAllFonts)

function pick(value: unknown): void {
  emit('update:modelValue', typeof value === 'string' ? value : String(value ?? ''))
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="outline" class="w-full justify-between overflow-hidden font-normal">
        <span class="flex min-w-0 items-center gap-2">
          <span class="size-2.5 flex-none rounded-full bg-primary" aria-hidden="true" />
          <span class="min-w-0 truncate" :style="{ fontFamily: currentStack }">
            {{ currentFont ? currentFont.label : '跟随正文' }}
          </span>
        </span>
        <ChevronDownIcon class="text-muted-foreground" />
      </Button>
    </DropdownMenuTrigger>

    <!-- 右侧多留一点：菜单内容是长列表，滚动条会压在文字上 -->
    <DropdownMenuContent class="max-h-[26rem] w-80 pr-2">
      <DropdownMenuRadioGroup :model-value="modelValue" @update:model-value="pick">
        <template v-if="allowFollow">
          <DropdownMenuLabel class="text-xs text-muted-foreground">跟随</DropdownMenuLabel>
          <DropdownMenuRadioItem :value="FOLLOW_BODY" class="py-1.5">
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="flex items-center gap-2 text-sm">
                <span
                  class="size-2.5 flex-none rounded-full"
                  :class="modelValue === FOLLOW_BODY ? 'bg-primary ring-2 ring-primary/30' : 'ring-1 ring-foreground/40'"
                  aria-hidden="true"
                />
                跟随正文
              </span>
              <span class="truncate pl-4 text-xs text-muted-foreground">与正文字体保持一致</span>
            </span>
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
        </template>

        <template v-for="(group, groupIndex) in groupedOptions" :key="group.id">
          <DropdownMenuSeparator v-if="groupIndex > 0" />
          <DropdownMenuLabel class="text-xs text-muted-foreground">{{ group.label }}</DropdownMenuLabel>
          <DropdownMenuRadioItem
            v-for="font in group.items"
            :key="font.id"
            :value="font.id"
            :class="['py-1.5', modelValue === font.id ? 'bg-primary/10' : '']"
          >
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  class="size-2.5 flex-none rounded-full"
                  :class="modelValue === font.id ? 'bg-primary ring-2 ring-primary/30' : 'ring-1 ring-foreground/40'"
                  aria-hidden="true"
                />
                <span class="truncate">{{ font.label }}</span>
              </span>
              <!-- 这一行用该字体自己渲染：中文 + 英文 + 数字，才是真实界面观感 -->
              <span
                class="truncate pl-4 text-[15px] leading-6 text-foreground"
                :style="{ fontFamily: fontStack(font) }"
              >设置 画布 Aa 123</span>
            </span>
          </DropdownMenuRadioItem>
        </template>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
