<script setup lang="ts">
import type { Component, CSSProperties } from 'vue'
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  label?: string
  nodeType?: string
  titleIcon?: Component | string | null
  titleStyle?: CSSProperties
  interactive?: boolean
  editing?: boolean
  placement?: 'absolute' | 'flow'
}>(), {
  placement: 'absolute',
})

const componentTitleIcon = computed(() => {
  if (!props.titleIcon) return null
  return typeof props.titleIcon === 'string' ? null : props.titleIcon
})

const htmlTitleIcon = computed(() => {
  return typeof props.titleIcon === 'string' ? props.titleIcon : ''
})
</script>

<template>
  <div
    class="base-title"
    :class="{
      'base-title--absolute': placement === 'absolute',
      'base-title--flow': placement === 'flow',
      'base-title--interactive': interactive,
      'base-title--editing': editing,
    }"
    :style="titleStyle"
  >
    <slot name="title-icon">
      <component
        v-if="componentTitleIcon"
        :is="componentTitleIcon"
        class="base-title__icon"
      />
      <span
        v-else-if="htmlTitleIcon"
        class="base-title__icon base-title__icon--html"
        v-html="htmlTitleIcon"
      />
      <svg
        v-else-if="nodeType === 'image'"
        class="base-title__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none" />
        <path d="M21 15l-5-5L5 21" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <svg
        v-else-if="nodeType === 'video'"
        class="base-title__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <polygon points="23 7 16 12 23 17" />
        <rect x="1" y="5" width="15" height="14" rx="2" />
      </svg>
      <svg
        v-else
        class="base-title__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <polyline points="4 7 4 4 20 4 20 7" />
        <line x1="9" y1="20" x2="15" y2="20" />
        <line x1="12" y1="4" x2="12" y2="20" />
      </svg>
    </slot>

    <slot name="title-label">
      <span class="base-title__label">{{ label }}</span>
    </slot>

    <slot name="title-extra" />
  </div>
</template>

<style scoped>
.base-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #6b7280;
  font-size: 0.75rem;
  line-height: 1rem;
  pointer-events: none;
}

.base-title--absolute {
  position: absolute;
  left: 0.25rem;
}

.base-title--flow {
  margin-left: 0.25rem;
}

.base-title--interactive {
  pointer-events: auto;
}

.base-title__icon {
  width: 0.875rem;
  height: 0.875rem;
  flex-shrink: 0;
}

.base-title__icon--html {
  display: inline-flex;
  align-items: center;
}

.base-title__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>