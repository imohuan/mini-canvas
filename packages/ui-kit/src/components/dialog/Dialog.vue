<script setup lang="ts">
import { ref, watch } from 'vue'
import { useFocusTrap } from '../../shared/overlay'
import type { DialogProps } from './types'
import './dialog.css'

defineOptions({ name: 'MckDialog' })

const props = withDefaults(defineProps<DialogProps>(), {
  modelValue: false,
  title: '',
  description: '',
  width: '480px',
  maxWidth: 'calc(100vw - 32px)',
  maxHeight: 'calc(100vh - 48px)',
  closeOnOverlay: true,
  closeOnEscape: true,
  showClose: true,
  lockScroll: true,
  panelClass: '',
})

const emit = defineEmits<{ 'update:modelValue': [value: boolean]; close: [] }>()
const panel = ref<HTMLElement | null>(null)
const open = ref(props.modelValue)

function close(): void {
  open.value = false
  emit('update:modelValue', false)
  emit('close')
}

useFocusTrap(open, panel, {
  // 听 props：文档里写了「不锁滚动适合侧栏临时面板」，写死 true 会让这个开关彻底失效
  // （类型检查通过、不报错，只是设置无效 —— 这类坑最难被发现）。
  lockScroll: props.lockScroll,
  onEscape: () => { if (props.closeOnEscape) close() },
})

watch(() => props.modelValue, (value) => { open.value = value })
</script>

<template>
  <Teleport to="body">
    <Transition name="mck-dialog-fade">
      <div v-if="open" class="mck-dialog" @pointerdown.self="closeOnOverlay && close()">
        <div class="mck-dialog__overlay" @pointerdown.self="closeOnOverlay && close()" />
        <div
          ref="panel"
          class="mck-dialog__panel"
          :class="panelClass"
          :style="{ width, maxWidth, maxHeight }"
          role="dialog"
          aria-modal="true"
          :aria-label="title || undefined"
          tabindex="-1"
        >
          <header v-if="title || description || showClose" class="mck-dialog__head">
            <div class="mck-dialog__heading">
              <strong v-if="title" class="mck-dialog__title">{{ title }}</strong>
              <p v-if="description" class="mck-dialog__desc">{{ description }}</p>
            </div>
            <button v-if="showClose" type="button" class="mck-dialog__close" aria-label="关闭" title="关闭" @click="close">×</button>
          </header>
          <div class="mck-dialog__body"><slot :close="close" /></div>
          <footer v-if="$slots.footer" class="mck-dialog__foot"><slot name="footer" :close="close" /></footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
