<script setup lang="ts">
import type { Component, CSSProperties } from 'vue'
import { computed } from 'vue'

type TitleIcon = Component | string | null | false

const props = defineProps<{
  label?: string
  titleIcon?: TitleIcon
  titleStyle?: CSSProperties
  interactive?: boolean
  editing?: boolean
}>()

const shouldRenderIcon = computed(() => props.titleIcon !== null && props.titleIcon !== false)

const componentTitleIcon = computed(() => {
  if (!shouldRenderIcon.value || !props.titleIcon) return null
  return typeof props.titleIcon === 'string' ? null : props.titleIcon
})

const htmlTitleIcon = computed(() => {
  if (!shouldRenderIcon.value) return ''
  return typeof props.titleIcon === 'string' ? props.titleIcon : ''
})
</script>

<template>
  <div
    class="base-title"
    :class="{
      'base-title--interactive': interactive,
      'base-title--editing': editing,
    }"
    :style="titleStyle"
  >
    <slot v-if="shouldRenderIcon" name="title-icon">
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
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>