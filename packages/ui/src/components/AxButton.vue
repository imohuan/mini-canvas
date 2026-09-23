<script setup lang="ts">
// AxButton —— 基础按钮。四种外观 + 三种尺寸，颜色走画布 token。
// iconOnly 时不渲染默认插槽外的文字间距。
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md' | 'lg' | 'icon'
    block?: boolean
    disabled?: boolean
    type?: 'button' | 'submit' | 'reset'
    /** 用在 Tooltip 里时禁用自身交互 */
    title?: string
  }>(),
  { variant: 'ghost', size: 'md', block: false, disabled: false, type: 'button', title: '' },
)
defineEmits<{ click: [MouseEvent] }>()
</script>

<template>
  <button
    :type="type"
    :title="title || undefined"
    :disabled="disabled"
    class="ax-btn"
    :class="['ax-btn--' + variant, 'ax-btn--' + size, { 'ax-btn--block': block }]"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>

<style scoped>
.ax-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; flex: none; border: 0; border-radius: 8px; background: transparent; color: var(--ui-ink); font-family: inherit; font-size: 13px; cursor: pointer; transition: background .16s ease, color .16s ease, opacity .16s ease; }
.ax-btn--sm { height: 28px; padding: 0 10px; }
.ax-btn--md { height: 32px; padding: 0 12px; }
.ax-btn--lg { height: 40px; padding: 0 16px; }
.ax-btn--icon { width: 32px; height: 32px; padding: 0; }
.ax-btn--block { width: 100%; }
.ax-btn--primary { background: var(--ui-primary-bg); color: var(--ui-primary-ink); }
.ax-btn--primary:hover { background: var(--ui-primary-bg-hover); }
.ax-btn--secondary { background: var(--ui-chip); }
.ax-btn--secondary:hover { background: var(--ui-hover-strong); }
.ax-btn--ghost:hover { background: var(--ui-hover); }
.ax-btn--danger { color: #f87171; }
.ax-btn--danger:hover { background: rgb(248 113 113 / .18); color: #fff; }
.ax-btn:disabled { opacity: .3; cursor: not-allowed; }
</style>
