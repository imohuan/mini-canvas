<script setup lang="ts">
import { ref } from 'vue'
const emit = defineEmits<{ (e: 'action'): void }>()
const fileInputRef = ref<HTMLInputElement | null>(null)
function openPicker() { fileInputRef.value?.click() }
function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.[0]) emit('action')
  input.value = ''
}
</script>
<template>
  <div class="image-upload-btn">
    <input ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="onFileChange" />
    <button class="toolbar-btn-inner" type="button" @click="openPicker">
      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <span>上传图片</span>
    </button>
  </div>
</template>
<style scoped>
.hidden { display: none; }
.toolbar-btn-inner { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border: 0; border-radius: 6px; background: transparent; color: #374151; font-size: 12px; cursor: pointer; }
.toolbar-btn-inner:hover { background: rgba(0,0,0,0.06); }
</style>