<script setup lang="ts">
/**
 * ColorConfigField —— 底色 / 主题色下拉。
 *
 * 两项结构完全一样（色点 + 名称 + 下拉），差别只在数据源与写回字段，
 * 所以合成一个组件，避免两段几乎相同的模板再各改一遍。
 */
import { computed } from 'vue'
import { ChevronDownIcon } from '@lucide/vue'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/previewKit'
import { BASE_COLORS, THEME_COLORS, previewColor, type BaseColor, type ThemeColor } from '../colors'
import type { PreviewThemeConfig } from '../useThemePreview'
import ConfigField from './ConfigField.vue'

const props = defineProps<{
  label: string
  /** 写回哪个字段 */
  field: 'baseColor' | 'theme'
  dark: boolean
  config: PreviewThemeConfig
}>()
const emit = defineEmits<{ 'update:config': [value: PreviewThemeConfig] }>()

interface Option {
  value: string
  label: string
  swatch: string
}

function titleOf(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

const options = computed<Option[]>(() => {
  if (props.field === 'theme') {
    return THEME_COLORS.map((name) => ({
      value: name,
      label: titleOf(name),
      swatch: previewColor(name as ThemeColor, props.dark ? 'dark' : 'light'),
    }))
  }
  // 底色：四档都是"面板底"，用同一套中性色，只区分深浅来源
  return BASE_COLORS.map((name) => ({
    value: name,
    label: titleOf(name),
    swatch: props.dark ? 'oklch(0.145 0 0)' : 'oklch(1 0 0)',
  }))
})

const current = computed(() => props.config[props.field])
const currentSwatch = computed(
  () => options.value.find((o) => o.value === current.value)?.swatch,
)
const currentLabel = computed(
  () => options.value.find((o) => o.value === current.value)?.label ?? current.value,
)

function patch(value: string): void {
  emit('update:config', { ...props.config, [props.field]: value as BaseColor | ThemeColor })
}
</script>

<template>
  <ConfigField :label="label">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="outline" class="w-full min-w-0 justify-between font-normal">
          <span class="flex min-w-0 items-center gap-2">
            <span
              class="size-3 flex-none rounded-full ring-1 ring-black/10 dark:ring-white/20"
              :style="{ background: currentSwatch }"
            />
            <span class="truncate">{{ currentLabel }}</span>
          </span>
          <ChevronDownIcon class="flex-none text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent class="w-52">
        <DropdownMenuRadioGroup :model-value="current" @update:model-value="(v) => patch(String(v))">
          <DropdownMenuRadioItem v-for="o in options" :key="o.value" :value="o.value">
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
  </ConfigField>
</template>
