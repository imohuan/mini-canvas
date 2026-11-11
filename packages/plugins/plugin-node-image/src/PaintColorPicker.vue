<script setup lang="ts">
/**
 * PaintColorPicker —— 绘制工具栏的「标记颜色」下拉。
 *
 * 用户口径 2026-10-30：要有颜色下拉，里面能调颜色，也有预置色；
 * 取色器用**上下文里注册的颜色组件**（useUiComponent('color'），换主题跟着换），
 * 不自绘取色面板。
 *
 * 结构：触发器 = 工具栏按钮（色块图标）；菜单 = 预置色网格 + 注册的颜色组件。
 */
import { computed, ref } from 'vue'
import { useUiComponent } from '@plume-canvas/canvas-render'

const props = defineProps<{
  /** 当前颜色（#rrggbb / #rrggbbaa） */
  modelValue: string
}>()

const emit = defineEmits<{
  /** 选色（预置色或取色器都会发） */
  (e: "update:modelValue", value: string): void
}>()

const ColorField = useUiComponent('color')
const Button = useUiComponent('Button')
const Popover = useUiComponent('Popover')
const PopoverContent = useUiComponent('PopoverContent')
const PopoverTrigger = useUiComponent('PopoverTrigger')

/** 面板开关（受控给 Dropdown） */
const open = ref(false)

/** 预置色：白/黑 + 常用标记色（擦除常用白色，重绘常用红/绿/蓝） */
// 主题色白名单: 这十项是「画笔颜色」这个用户可选的**内容**，不是界面配色
const PRESET_COLORS = ['#ffffff', '#000000', '#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'] as const

/** 当前色块（取色器回来可能是空串 = 跟随主题，这里回落白色） */
/* 主题色白名单: 画笔默认颜色（内容），与主题无关 */
const swatch = computed(() => props.modelValue || '#ffffff')

function pick(value: string): void {
  emit('update:modelValue', value)
}

/** 取色器改色：写回会话，不关面板（用户可能还要微调） */
function onColorChange(value: string): void {
  if (!value) return
  emit('update:modelValue', value)
}

</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        type="button"
        class="pcp-trigger"
        variant="ghost"
        size="sm"
        title="标记颜色"
        aria-label="标记颜色"
        aria-haspopup="dialog"
        :aria-expanded="open"
      >
        <span class="pcp-swatch" :style="{ backgroundColor: swatch }" aria-hidden="true" />
      </Button>
    </PopoverTrigger>

    <PopoverContent align="start" :side-offset="6" class="pcp-panel">
      <div class="pcp-title">预置颜色</div>
      <div class="pcp-grid">
        <Button
          v-for="c in PRESET_COLORS"
          :key="c"
          type="button"
          class="pcp-dot"
          variant="ghost"
          size="sm"
          :class="{ 'is-active': swatch.toLowerCase() === c }"
          :style="{ backgroundColor: c }"
          :title="c"
          :aria-label="'颜色 ' + c"
          @click="pick(c)"
        />
      </div>
      <div class="pcp-title">自定义</div>
      <component
        :is="ColorField"
        v-if="ColorField"
        :model-value="swatch"
        aria-label="标记颜色"
        @update:model-value="onColorChange"
      />
      <div v-else class="pcp-missing">主题没有注册颜色组件</div>
    </PopoverContent>
  </Popover>
</template>

<style scoped>
.pcp-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 8px;
  transition: background 0.16s ease, border-color 0.16s ease;
}
.pcp-trigger:hover {
  background: var(--ui-hover-strong, rgba(0, 0, 0, 0.06));
}
.pcp-trigger:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 1px;
}
.pcp-swatch {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.18));
  /* 主题色白名单: 色块内描边要压在任意画笔色上都看得见，需恒定白 */
  box-shadow: inset 0 0 0 1px color-mix(in srgb, #fff 25%, transparent);
}
.pcp-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 232px;
  padding: 12px;
  border-radius: var(--plume-radius, 16px);
  background: var(--ui-overlay-solid, #fff);
}
.pcp-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--ui-ink-dim, #6b7280);
}
.pcp-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
}
.pcp-dot {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  padding: 0;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.pcp-dot:hover {
  transform: scale(1.06);
}
.pcp-dot.is-active {
  box-shadow: 0 0 0 2px var(--ui-accent, #0891b2);
}
.pcp-missing {
  font-size: 11px;
  color: var(--ui-ink-dim, #6b7280);
}
</style>
