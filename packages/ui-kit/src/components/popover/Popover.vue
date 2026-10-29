<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useFloating } from '../../shared/floating'
import { focusFirst } from '../../shared/dom'
import { useEscape, useOutsideClick } from '../../shared/overlay'
import type { PopoverProps } from './types'
import './popover.css'

defineOptions({ name: 'MckPopover' })

const props = withDefaults(defineProps<PopoverProps>(), {
  modelValue: false,
  placement: 'bottom-start',
  offset: 8,
  title: '',
  description: '',
  width: '320px',
  maxWidth: 'calc(100vw - 24px)',
  disabled: false,
  closeOnOutside: true,
  closeOnEscape: true,
})

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const open = ref(props.modelValue)
const trigger = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const options = computed(() => ({ placement: props.placement, offset: props.offset, maxWidth: props.maxWidth }))
const { position, positioned } = useFloating(trigger, panel, open, options)

function setOpen(value: boolean): void {
  if (props.disabled && value) return
  open.value = value
  emit('update:modelValue', value)
  if (value) nextTick(() => focusFirst(panel.value))
}

function close(): void { setOpen(false) }

useOutsideClick(open, [trigger, panel], () => { if (props.closeOnOutside) close() })
useEscape(open, () => { if (props.closeOnEscape) close() })

watch(() => props.modelValue, (value) => { open.value = value })

const panelStyle = computed<Record<string, string>>(() => ({
  left: position.value.left + 'px',
  top: position.value.top + 'px',
  width: props.width,
  maxWidth: props.maxWidth,
  opacity: positioned.value ? '1' : '0',
}))
</script>

<template>
  <div class="mck-popover">
    <div ref="trigger" class="mck-popover__trigger">
      <slot name="trigger" :open="open" :toggle="() => setOpen(!open)" :close="close" />
    </div>
    <Teleport to="body">
      <Transition name="mck-popover-fade">
        <div
          v-if="open"
          ref="panel"
          class="mck-popover__panel"
          role="dialog"
          :style="panelStyle"
        >
          <header v-if="title || $slots.header" class="mck-popover__head">
            <slot name="header">
              <div>
                <strong class="mck-popover__title">{{ title }}</strong>
                <p v-if="description" class="mck-popover__desc">{{ description }}</p>
              </div>
            </slot>
            <button type="button" class="mck-popover__close" aria-label="关闭" title="关闭" @click="close">×</button>
          </header>
          <div class="mck-popover__body"><slot :close="close" /></div>
          <footer v-if="$slots.footer" class="mck-popover__foot"><slot name="footer" :close="close" /></footer>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
