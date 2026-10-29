<script setup lang="ts">
import { computed, useSlots } from 'vue'
import { resolveIconOnly, type ButtonProps } from './buttonTypes'
import '../styles/ui-kit.css'

defineOptions({ name: 'MckButton' })

const props = withDefaults(defineProps<ButtonProps>(), {
  variant: 'secondary',
  size: 'md',
  block: false,
  disabled: false,
  loading: false,
  type: 'button',
  ariaLabel: '',
  title: '',
})

const emit = defineEmits<{ click: [event: MouseEvent] }>()
const slots = useSlots()
const hasIcon = computed(() => Boolean(slots.icon))
/** 图标按钮：显式指定优先；否则由模板实际渲染的文案区决定（空文案不会留下一条空按钮）。 */
const onlyIcon = computed(() => props.iconOnly ?? false)

function onClick(event: MouseEvent): void {
  if (props.disabled || props.loading) return
  emit('click', event)
}
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :aria-label="ariaLabel || undefined"
    :aria-busy="loading ? 'true' : undefined"
    :title="title || undefined"
    class="mck-button"
    :class="[
      'mck-button--' + variant,
      'mck-button--' + size,
      {
        'is-block': block,
        'is-icon-only': onlyIcon || (hasIcon && !$slots.default),
        'is-auto-icon-only': onlyIcon || (hasIcon && !$slots.default),
        'is-loading': loading,
      },
    ]"
    @click="onClick"
  >
    <span v-if="loading" class="mck-button__spinner" aria-hidden="true"></span>
    <span v-else-if="$slots.icon" class="mck-button__icon" aria-hidden="true">
      <slot name="icon" />
    </span>
    <span v-if="$slots.default" class="mck-button__label"><slot /></span>
  </button>
</template>

<style scoped>
.mck-button {
  --mck-button-height: 32px;
  --mck-button-padding: 12px;
  --mck-button-font-size: 13px;
  --mck-button-bg: transparent;
  --mck-button-bg-hover: transparent;
  --mck-button-fg: var(--mck-ink);
  --mck-button-border: transparent;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-sizing: border-box;
  height: var(--mck-button-height);
  padding: 0 var(--mck-button-padding);
  border: 1px solid var(--mck-button-border);
  border-radius: var(--mck-radius-control);
  background: var(--mck-button-bg);
  color: var(--mck-button-fg);
  font-family: inherit;
  font-size: var(--mck-button-font-size);
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition:
    background-color var(--mck-duration) ease,
    border-color var(--mck-duration) ease,
    color var(--mck-duration) ease,
    opacity var(--mck-duration) ease,
    transform var(--mck-duration) var(--mck-ease-back);
}

.mck-button:hover:not(:disabled),
.mck-button:focus-visible:not(:disabled) {
  background: var(--mck-button-bg-hover);
}

.mck-button:not(:disabled):active {
  transform: scale(0.97);
}

.mck-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mck-button.is-loading:disabled {
  opacity: 0.72;
  cursor: progress;
}

.mck-button.is-block {
  display: flex;
  width: 100%;
}

.mck-button.is-icon-only {
  width: var(--mck-button-height);
  padding: 0;
}

.mck-button--sm {
  --mck-button-height: 28px;
  --mck-button-padding: 10px;
  --mck-button-font-size: 12px;
}

.mck-button--md {
  --mck-button-height: 32px;
  --mck-button-padding: 12px;
  --mck-button-font-size: 13px;
}

.mck-button--lg {
  --mck-button-height: 40px;
  --mck-button-padding: 16px;
  --mck-button-font-size: 14px;
}

.mck-button--primary {
  --mck-button-bg: var(--mck-accent);
  --mck-button-bg-hover: var(--mck-accent-hover);
  --mck-button-fg: #ffffff;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--mck-accent) 22%, transparent);
}

.mck-button--secondary {
  --mck-button-bg: var(--mck-chip);
  --mck-button-bg-hover: var(--mck-chip-hover);
  --mck-button-fg: var(--mck-ink);
}

.mck-button--ghost {
  --mck-button-bg: transparent;
  --mck-button-bg-hover: var(--mck-hover);
  --mck-button-fg: var(--mck-ink);
}

.mck-button--danger {
  --mck-button-bg: var(--mck-danger-soft);
  --mck-button-bg-hover: var(--mck-danger-soft-hover);
  --mck-button-fg: var(--mck-danger);
}

.mck-button__icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
}

.mck-button__icon :deep(svg) {
  width: 16px;
  height: 16px;
}

.mck-button__label {
  display: inline-flex;
  align-items: center;
}

.mck-button__spinner {
  box-sizing: border-box;
  flex: none;
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 999px;
  animation: mck-button-spin 0.8s linear infinite;
}

@keyframes mck-button-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .mck-button {
    transition: none;
  }

  .mck-button:not(:disabled):active {
    transform: none;
  }

  .mck-button__spinner {
    animation: none;
    opacity: 0.55;
  }
}
</style>
