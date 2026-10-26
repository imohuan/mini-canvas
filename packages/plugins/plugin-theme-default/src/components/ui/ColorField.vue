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
    /** 是否允许清空（设置里能把这个颜色删掉 → 回落主题色）。缺省 false */
    clearable?: boolean
  }>(),
  {
  // 控件缺省色（调用方总会传真实值）；非主题外观
  modelValue: '#000000', // 主题色白名单: 颜色控件缺省值，调用方始终传真实色
    disabled: false,
    clearable: false,
    ariaLabel: '选择颜色',
    inputId: '',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

/** 是否处于"已清空"态（值为空 = 用户删掉了自定义色，走主题色） */
const isEmpty = computed(() => !String(props.modelValue ?? '').trim())
/** 清空 / 恢复：清空写空串（消费方回落主题色），恢复写默认兜底色 */
function clearColor(): void {
  emit('update:modelValue', '')
  emit('change', '')
}

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
    menu-width="225px"
    menu-role="dialog"
    body-class="cf-menu-body"
  >
    <template #trigger>
      <div class="cf-wrap">
        <button
          type="button"
          :id="inputId || undefined"
          class="cf-trigger"
          :class="{ 'is-open': open, 'is-disabled': disabled, 'is-empty': clearable && isEmpty }"
          :disabled="disabled"
          :aria-label="ariaLabel"
          aria-haspopup="dialog"
          :aria-expanded="open"
          @click.stop="toggle"
        >
          <span class="cf-swatch" aria-hidden="true">
            <span v-if="!(clearable && isEmpty)" class="cf-swatch-color" :style="{ backgroundColor: normalized }" />
          </span>
          <span class="cf-value">{{ clearable && isEmpty ? '跟随主题' : normalized }}</span>
          <span v-if="!(clearable && isEmpty)" class="cf-alpha">{{ alphaText }}</span>
        </button>
        <!-- 清除按钮放**触发器右侧**（用户要求：不要塞进取色下拉里）。
             空态 = 已在跟随主题，无需清除；非空态才给清除。 -->
        <button
          v-if="clearable && !isEmpty"
          type="button"
          class="cf-clear-btn"
          title="清除自定义颜色，改用主题色"
          aria-label="清除自定义颜色，改用主题色"
          @click.stop="clearColor"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </template>

    <template #default>
      <div class="cf-pop">
        <Chrome
          :model-value="normalized"
          :disable-fields="false"
          :disable-alpha="false"
          @update:model-value="commit"
        />
      </div>
    </template>
  </Dropdown>
</template>

<style scoped>
.cf-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
}

.cf-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
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

/* 清除按钮（触发器右侧）：X 图标，hover 变红提示"移除自定义色" */
.cf-clear-btn {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.12));
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
  cursor: pointer;
  transition: color 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.cf-clear-btn svg {
  width: 14px;
  height: 14px;
}

.cf-clear-btn:hover {
  border-color: var(--ui-danger, #ef4444);
  color: var(--ui-danger, #ef4444);
  background: var(--ui-danger-veil, rgba(239, 68, 68, 0.08));
}

.cf-clear-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 1px;
}

:global(.cf-menu-body) {
  padding: 0;
}

/*
 * 面板宽度 = 取色器宽度，两个尺寸绑在一起：@ckpack/vue-color 的 Chrome 自带
 * width:225px（box-sizing:initial，含边框阴影恰为 257px 视觉），改成只在菜单
 * 上写 225px、再让 .vc-chrome 撑满菜单，就永远不会出现"面板宽、取色器窄、
 * 右侧空一条"的错位（用户实测：257px 面板 + 225px 取色器右侧空 32px）。
 */
:global(.cf-menu-body .vc-chrome) {
  width: 100%;
  box-shadow: none;
  border-radius: inherit;
}

/* 已清空态：触发器不画色块、文字改「跟随主题」 */
.cf-trigger.is-empty .cf-swatch {
  background-image: none;
}

.cf-trigger.is-empty .cf-value {
  color: var(--ui-ink-dim, #6b7280);
  font-family: inherit;
  font-weight: 600;
}

@media (prefers-reduced-motion: reduce) {
  .cf-trigger {
    transition: none;
  }
}
</style>
