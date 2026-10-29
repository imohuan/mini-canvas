<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useFloating } from '../../shared/floating'
import type { TooltipProps } from './types'
import './tooltip.css'

defineOptions({ name: 'MckTooltip' })

const props = withDefaults(defineProps<TooltipProps>(), {
  content: '',
  placement: 'top',
  delay: 180,
  disabled: false,
  focusable: true,
  maxWidth: '280px',
})

const visible = ref(false)
const trigger = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
let timer = 0

const options = computed(() => ({
  placement: props.placement,
  offset: 8,
  maxWidth: props.maxWidth,
}))
const { position, positioned } = useFloating(trigger, panel, visible, options)

function show(): void {
  if (props.disabled || !props.content) return
  window.clearTimeout(timer)
  timer = window.setTimeout(() => { visible.value = true }, Math.max(0, props.delay))
}

function hide(): void {
  window.clearTimeout(timer)
  visible.value = false
}

onBeforeUnmount(() => window.clearTimeout(timer))
</script>

<template>
  <span
    ref="trigger"
    class="mck-tooltip-trigger"
    :tabindex="focusable ? 0 : undefined"
    @mouseenter="show"
    @mouseleave="hide"
    @focusin="show"
    @focusout="hide"
    @keydown.esc="hide"
  >
    <slot />
  </span>
  <Teleport to="body">
    <Transition name="mck-tooltip-fade">
      <div
        v-if="visible && content"
        ref="panel"
        class="mck-tooltip"
        role="tooltip"
        :style="{
          left: position.left + 'px',
          top: position.top + 'px',
          maxWidth,
          opacity: positioned ? 1 : 0,
        }"
      >{{ content }}</div>
    </Transition>
  </Teleport>
</template>
