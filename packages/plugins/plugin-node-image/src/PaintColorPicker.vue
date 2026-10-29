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
import { useUiComponent } from '@mini-canvas/canvas-render'

const props = defineProps<{
  /** 当前颜色（#rrggbb / #rrggbbaa） */
  modelValue: string
}>()

const emit = defineEmits<{
  /** 选色（预置色或取色器都会发） */
  (e: "update:modelValue", value: string): void
}>()

const Button = useUiComponent('toolbarButton')
const Dropdown = useUiComponent('dropdown')
const ColorField = useUiComponent('color')

/** 面板开关（受控给 Dropdown） */
const open = ref(false)

/** 预置色：白/黑 + 常用标记色（擦除常用白色，重绘常用红/绿/蓝） */
const PRESET_COLORS = [
  '#ffffff',
  '#000000',
  '#ef4444',
  '#f97316',
  '#facc15',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
] as const

/** 当前色块（取色器回来可能是空串 = 跟随主题，这里回落白色） */
const swatch = computed(() => props.modelValue || '#ffffff')

function pick(value: string): void {
  emit('update:modelValue', value)
}

/** 取色器改色：写回会话，不关面板（用户可能还要微调） */
function onColorChange(value: string): void {
  if (!value) return
  emit('update:modelValue', value)
}

/** 色块图标（透明底 + 填充圆） */
const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>'
</script>

<template>
  <component
    :is="Dropdown || 'div'"
    v-if="Dropdown"
    v-model="open"
    placement="bottom-start"
    :offset="6"
    menu-width="232px"
    menu-role="dialog"
  >
    <template #trigger="{ toggle }">
      <button
        type="button"
        class="pcp-trigger"
        title="标记颜色"
        aria-label="标记颜色"
        aria-haspopup="dialog"
        :aria-expanded="open"
        @click.stop="toggle"
      >
        <span class="pcp-swatch" :style="{ backgroundColor: swatch }" aria-hidden="true" />
      </button>
    </template>

    <div class="pcp-panel">
      <div class="pcp-title">预置颜色</div>
      <div class="pcp-grid">
        <button
          v-for="c in PRESET_COLORS"
          :key="c"
          type="button"
          class="pcp-dot"
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
    </div>
  </component>
  <!-- 主题没注册 dropdown 时：退化成只有色块的静态按钮（不静默消失） -->
  <component :is="Button || 'button'" v-else :title="'标记颜色 ' + swatch" :icon="ICON" />
</template>

<style scoped>
.pcp-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
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
  box-shadow: inset 0 0 0 1px color-mix(in srgb, #fff 25%, transparent);
}
.pcp-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px;
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
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.12));
  cursor: pointer;
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
