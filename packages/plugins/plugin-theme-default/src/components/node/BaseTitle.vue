<script setup lang="ts">
// BaseTitle —— 节点标题条（移植自 v1 Decoration/BaseTitle.vue，纯展示组件）。
// 三段布局：title-icon（SVG 字符串或 Vue 组件；未声明则不渲染）→ title-label（默认文本，占 80% 椭圆省略）→ title-extra（≤20%）。
// 无外部依赖，纯 props。BaseNode 把它放卡片内部标题容器里。
import type { Component, CSSProperties } from 'vue'
import { computed } from 'vue'
import { iconRenderMode } from '@mini-canvas/canvas-core-v2'

/**
 * 图标句柄：SVG 字符串或 Vue 组件（opaque，与节点类型注册的 icon 同源）。
 * 声明为 unknown 是因为来源是内核的 opaque 句柄；渲染前经 iconRenderMode 收窄。
 */
type TitleIcon = unknown

const props = defineProps<{
  label?: string
  titleIcon?: TitleIcon
  titleStyle?: CSSProperties
  interactive?: boolean
  editing?: boolean
}>()

/** 图标形态：'html' 走 v-html、'component' 走 <component :is>、'none' 完全不渲染图标位（不再顶兜底图标） */
const iconMode = computed(() => iconRenderMode(props.titleIcon))
/** 收窄后的 HTML 图标串（iconMode==='html' 时才非空） */
const htmlIcon = computed(() => (iconMode.value === 'html' ? String(props.titleIcon) : ''))
/** 收窄后的组件图标（iconMode==='component' 时才非 null） */
const componentIcon = computed<Component | null>(() =>
  iconMode.value === 'component' ? (props.titleIcon as Component) : null,
)
</script>

<template>
  <div class="base-title" :class="{
    'base-title--interactive': interactive,
    'base-title--editing': editing,
  }" :style="titleStyle">
    <slot v-if="iconMode !== 'none'" name="title-icon">
      <span v-if="iconMode === 'html'" class="base-title__icon base-title__icon--html" v-html="htmlIcon" />
      <component v-else :is="componentIcon" class="base-title__icon" />
    </slot>

    <div class="base-title-label">
      <slot name="title-label">
        <span class="base-title__label">{{ label }}</span>
      </slot>
    </div>

    <div class="base-title__extra">
      <slot name="title-extra" />
    </div>
  </div>
</template>

<style scoped>
.base-title {
  position: relative;
  z-index: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--canvas-node-text-muted, #6b7280);
  font-size: 0.75rem;
  line-height: 1rem;
  pointer-events: none;
  width: 100%;
  overflow: hidden;
}

.base-title--interactive {
  pointer-events: auto;
}

.base-title__icon {
  width: 0.875rem;
  height: 0.875rem;
  flex-shrink: 0;
}

/* 组件图标：作者给的组件不必自带尺寸，外层统一约束到图标槽大小 */
.base-title__icon > :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}

.base-title-label {
  flex: 0 0 80%;
  width: 80%;
  min-width: 0;
  max-width: 80%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.base-title__extra {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 20%;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  overflow: hidden;
  white-space: nowrap;
}

.base-title__extra> :deep(span) {
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.base-title__icon--html {
  display: inline-flex;
  align-items: center;
}
</style>
