<script setup lang="ts">
// BaseTitle —— 节点标题条（移植自 v1 Decoration/BaseTitle.vue，纯展示组件）。
// 三段布局：title-icon（SVG 字符串或 Vue 组件；未声明则不渲染）→ title-label（默认文本，占 80% 椭圆省略）→ title-extra（≤20%）。
// 无外部依赖，纯 props。BaseNode 把它放卡片内部标题容器里。
import type { Component, CSSProperties } from 'vue'
import { computed } from 'vue'
import { iconRenderMode } from '@mini-canvas/kernel'

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

/*
 * 标签（左）与附加内容（右）的分宽规则：**右侧按自己要的宽度先拿，左侧拿剩下的、超出就省略**。
 *
 * 为什么不是"左 80% / 右 ≤20%"（旧写法）：那个比例在**窄节点**上会把右侧压到只剩几十像素，
 * 尺寸文字被迫省略成 `20...`（用户实测截图，红框里就是它）。而右侧装的是"看一眼就行"的短元信息
 * （分辨率 1280×720 这类，最多 9 个字符），它比左侧的长标题更"缺一个就不能读"；
 * 左侧是名字，省略号截断后仍认得出是谁。所以优先级给右侧。
 *
 * flex: 0 0 auto = 不伸长也不收缩（就用自己的内容宽）；左侧 flex: 1 1 auto + min-width: 0 =
 * 把剩余宽度全吃掉、放不下就缩到 0 并省略 —— 两侧因此不会互相顶出去。
 * 右侧另留一个上限（55%）：右侧内容不该独吞整条标题，左侧至少还看得见一截名字。
 */
.base-title-label {
  /* 块级居中 + 行内块基线修正：
     flex 的 align-items:center 只管到"块"，块内部的行内盒仍按基线对齐，
     会在文字下方多留一段（实测 descender 空隙约 4px，导致文字整体偏上、不居中）。
     display:flex + align-items:center 把行内盒也真正压到中线。 */
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.base-title__extra {
  flex: 0 0 auto;
  min-width: 0;
  max-width: 55%;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  overflow: hidden;
  white-space: nowrap;
}

/* 附加内容自己也不收缩：它只有几个字符，被压缩就变成读不出来的残缺文本 */
.base-title__extra> :deep(span) {
  flex: 0 0 auto;
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
