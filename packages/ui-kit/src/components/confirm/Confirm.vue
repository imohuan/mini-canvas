<script setup lang="ts">
import Dialog from '../dialog/Dialog.vue'
import Button from '../button/Button.vue'

defineOptions({ name: 'MckConfirm' })

const props = withDefaults(defineProps<{
  modelValue?: boolean
  title?: string
  description?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  loading?: boolean
}>(), {
  modelValue: false,
  title: '确认操作',
  description: '这个操作会立即生效。',
  confirmText: '确认',
  cancelText: '取消',
  danger: false,
  loading: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: []
  cancel: []
}>()

function close(): void { emit('update:modelValue', false) }
function cancel(): void { emit('cancel'); close() }
function confirm(): void { emit('confirm'); close() }
</script>

<template>
  <Dialog
    :model-value="modelValue"
    :title="title"
    :description="description"
    width="400px"
    @update:model-value="emit('update:modelValue', $event)"
    @close="cancel"
  >
    <slot />
    <template #footer>
      <slot name="footer" :cancel="cancel" :confirm="confirm">
        <Button variant="ghost" :disabled="loading" @click="cancel">{{ cancelText }}</Button>
        <Button :variant="danger ? 'danger' : 'primary'" :loading="loading" @click="confirm">{{ confirmText }}</Button>
      </slot>
    </template>
  </Dialog>
</template>
