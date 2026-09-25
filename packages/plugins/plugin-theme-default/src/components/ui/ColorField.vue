<script setup lang="ts">
/**
 * ColorField —— 设置面板用的颜色控件：色块预览 + 第三方 Chrome 取色器。
 *
 * 原生 <input type="color"> 只能选 RGB，既看不见透明度，也不能调透明度。
 * 这里用 @ckpack/vue-color 的 Chrome 组件：它自带色相、饱和度、透明度滑杆、棋盘格预览，
 * 输出 hex / hex8 / rgba；本组件只负责把输出收敛成 settings 约定的 #rrggbb / #rrggbbaa 字符串。
 *
 * 这个组件是 UI 目录里的 design-system 原语，不知道任何业务 key；settings 字段仍由上层负责提交。
 */
import { computed, ref } from 'vue'
import { Chrome, type Payload } from '@ckpack/vue-color'
import Dropdown from './Dropdown.vue'
import { colorAlpha, normalizeHexColor } from './colorValue'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    disabled?: boolean
    ariaLabel?: string
    inputId?: string
  }>(),
  {
  // 控件缺省色（调用方总会传真实值）；非主题外观
  modelValue: '#000000', // 主题色白名单: 颜色控件缺省值，调用方始终传真实色
    disabled: false,
    ariaLabel: '选择颜色',
    inputId: '',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

const open = ref(false)

/** 传进来的历史值可能是大写/缩写/8 位；控件内部始终吃确定的规范值。 */
  const normalized = computed(() => normalizeHexColor(props.modelValue, props.modelValue))
const alpha = computed(() => colorAlpha(normalized.value))
const alphaText = computed(() => String(Math.round(alpha.value * 100)) + '%')

function commit(payload: Payload): void {
  // @ckpack/vue-color 始终给 hex（无 alpha）+ hex8（含 alpha）；不透明时保留 6 位，
  // 这样旧存档 / 旧消费方仍看到原来的值形态，只有用户真的调透明才写 8 位。
  const raw = payload.a < 1 ? payload.hex8 : payload.hex
  const value = normalizeHexColor(raw, normalized.value)
  emit('update:modelValue', value)
  emit('change', value)
}

function toggle(): void {
  if (props.disabled) return
  open.value = !open.value
}
</script>

<template>
  <Dropdown
    v-model="open"
    placement="bottom-start"
    :offset="6"
    menu-width="257px"
    menu-role="dialog"
    body-class="cf-menu-body"
  >
    <template #trigger>
      <button
        type="button"
        :id="inputId || undefined"
        class="cf-trigger"
        :class="{ 'is-open': open, 'is-disabled': disabled }"
        :disabled="disabled"
        :aria-label="ariaLabel"
        aria-haspopup="dialog"
        :aria-expanded="open"
        @click.stop="toggle"
      >
        <span class="cf-swatch" aria-hidden="true">
          <span class="cf-swatch-color" :style="{ backgroundColor: normalized }" />
        </span>
        <span class="cf-value">{{ normalized }}</span>
        <span class="cf-alpha">{{ alphaText }}</span>
      </button>
    </template>

    <template #default>
      <Chrome
        :model-value="normalized"
        :disable-fields="false"
        :disable-alpha="false"
        @update:model-value="commit"
      />
    </template>
  </Dropdown>
</template>

<style scoped>
.cf-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  box-sizing: border-box;
  padding: 4px 8px 4px 5px;
  border: 1px solid var(--sf-input-line, rgba(0, 0, 0, 0.08));
  border-radius: 8px;
  background: var(--sf-input-bg, rgba(0, 0, 0, 0.03));
  color: var(--sf-label, #111827);
  font: 600 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-align: left;
  cursor: pointer;
  outline: none;
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}

.cf-trigger:hover:not(:disabled) {
  background: var(--sf-input-bg-hover, rgba(0, 0, 0, 0.05));
}

.cf-trigger.is-open,
.cf-trigger:focus-visible {
  /* 聚焦环走强调色现算：用户改强调色后这里跟着变（写死 rgba 会"主色改了环还是青的"） */
  border-color: color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  background: var(--sf-input-bg-focus, #fff);
  box-shadow: 0 0 0 3px var(--ui-accent-soft, rgba(8, 145, 178, 0.14));
}

.cf-trigger:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 1px;
}

.cf-trigger.is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.cf-swatch {
  position: relative;
  flex: 0 0 auto;
  width: 30px;
  height: 22px;
  overflow: hidden;
  border: 1px solid var(--sf-input-line, rgba(0, 0, 0, 0.08));
  border-radius: 6px;
  /* 棋盘格（透明度预览底）：两色都跟随主题，暗色下不能还是白格 */
  background-color: var(--sf-input-bg-focus, #fff);
  background-image: conic-gradient(
    var(--ui-chip, rgba(0, 0, 0, 0.08)) 25%,
    var(--sf-input-bg-focus, #fff) 0 50%,
    var(--ui-chip, rgba(0, 0, 0, 0.08)) 0 75%,
    var(--sf-input-bg-focus, #fff) 0
  );
  background-size: 8px 8px;
}

.cf-swatch-color {
  position: absolute;
  inset: 0;
}

.cf-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cf-alpha {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--ui-ink-dim, #6b7280);
  font: 600 11px/1 ui-sans-serif, system-ui, sans-serif;
}

:global(.cf-menu-body) {
  padding: 0;
}

@media (prefers-reduced-motion: reduce) {
  .cf-trigger {
    transition: none;
  }
}
</style>
