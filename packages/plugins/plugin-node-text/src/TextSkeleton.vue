<script setup lang="ts">
/**
 * TextSkeleton —— 文本节点的「缩略横条（骨架屏）」展示件。
 *
 * 用途：画布缩到一定程度后，文本节点不再画真字，而是用**长短不一的灰色矩形**把这段文字
 * 的版式"画"成剪影（用户口径：图片里那种效果，用不同长度的矩形色块）。
 * 行数与每行长短都由**真实文本**折算（见 textSkeleton.ts），所以缩略形态与大屏形态是
 * 同一份版式的两个尺度，不是两套花样。
 *
 * 尺寸从哪来：横条行数取决于**像素宽高**（几行长、一行能放几个字），而内容盒尺寸随卡片
 * resize 变。所以这里用 ResizeObserver 实测内容盒；实测之前先用调用方给的尺寸估算
 * （首次渲染不闪一下"没有条"），SSR/无 DOM 环境下估不了就退化成一块小色块。
 *
 * 只读、无交互：不绑任何事件（双击进编辑由外层内容组件负责），aria-hidden 隐身。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import {
  buildSkeletonBars,
  drawnBarCount,
  resolveSkeletonMetrics,
  type SkeletonDensity,
} from './textSkeleton'

const props = withDefaults(
  defineProps<{
    /** 文本原文 */
    text?: string
    /** 档位：body（贴近真实文字排布）/ mini（缩得更小时更薄更密） */
    density?: SkeletonDensity
    /** 估算用宽度（px，内容盒；实测到手前用它算，免得首帧空白） */
    widthHint?: number
    /** 估算用高度（px，内容盒） */
    heightHint?: number
  }>(),
  { text: '', density: 'body', widthHint: 0, heightHint: 0 },
)

/** 内容盒（无内边距的那层）——量它的真实像素宽高 */
const boxEl = ref<HTMLElement | null>(null)
const measured = shallowRef<{ w: number; h: number }>({ w: 0, h: 0 })

/** 实测优先，实测不到（首帧 / SSR）用调用方给的估算 */
const box = computed(() =>
  measured.value.w > 0 && measured.value.h > 0
    ? measured.value
    : { w: positive(props.widthHint), h: positive(props.heightHint) },
)

const metrics = computed(() => resolveSkeletonMetrics(props.density))
const bars = computed(() =>
  buildSkeletonBars({
    text: props.text,
    width: box.value.w,
    height: box.value.h,
    density: props.density,
  }),
)
/** 画不出一条够长的条（太矮 / 内容太短）→ 退化成一块小色块，别留一片空白 */
const showBars = computed(() => drawnBarCount(bars.value) > 0)

/**
 * 这一行要不要画条。
 *
 * 宽度 0 = 这一行文字太短（少于内容宽 50%）或本来就是空行 → **不画条，但行位照留**
 * （用户口径："这个换行你依然保留 —— 就相当于这一行它不显示内容，但保留"）。
 * 行位靠 v-for 的下标撑住：条的位置是按**行下标**算的，所以留空的行不会把下面的行往上顶。
 */
function isDrawnBar(bar: { widthPercent: number }): boolean {
  return bar.widthPercent > 0
}

const barStyle = computed(() => ({
  '--tns-bar-h': `${metrics.value.barHeight}px`,
  '--tns-bar-r': `${metrics.value.radius}px`,
  '--tns-pitch': `${metrics.value.pitch}px`,
}))

let ro: ResizeObserver | null = null

function measure(): void {
  const el = boxEl.value
  if (!el) return
  const w = el.clientWidth
  const h = el.clientHeight
  if (w === measured.value.w && h === measured.value.h) return
  measured.value = { w, h }
}

onMounted(() => {
  measure()
  // SSR / 无头：没有 ResizeObserver 就只靠估算，不抛错
  if (typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(() => measure())
  if (boxEl.value) ro.observe(boxEl.value)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
})

function positive(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}
</script>

<template>
  <div ref="boxEl" class="tns-box" :style="barStyle" data-testid="text-skeleton" aria-hidden="true">
    <div v-if="showBars" class="tns-bars" :data-bar-count="bars.length" :data-drawn-count="drawnBarCount(bars)">
      <!-- 每一行都占一个行位；太短/空行只跳过那根条，不跳过行位（换行照样保留） -->
      <template v-for="(bar, index) in bars" :key="index">
        <span
          v-if="isDrawnBar(bar)"
          class="tns-bar"
          :style="{ top: `${index * metrics.pitch}px`, width: `${bar.widthPercent}%` }"
        />
      </template>
    </div>
    <!-- 太矮 / 内容太短：画不出"像字"的横条，退化成一块小色块（不留空白，也不假装有内容） -->
    <span v-else class="tns-chip" />
  </div>
</template>

<style scoped>
/* 量测层：撑满内容区，自己不带内边距（内边距在外层内容组件，两处口径必须一致） */
.tns-box {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.tns-bars {
  position: absolute;
  inset: 0;
}
/* 一条横条：宽度由内联 style 给（按真实文本比例），厚度/圆角走 CSS 变量（按档位） */
.tns-bar {
  position: absolute;
  left: 0;
  display: block;
  height: var(--tns-bar-h, 12px);
  border-radius: var(--tns-bar-r, 4px);
  /* 条的灰阶走节点主题变量：亮色 #d1d5db、暗色 #4a4a4a，两套主题都压在卡片面上看得见 */
  background: var(--canvas-node-border-hover, #d1d5db);
}
/* 退化色块：比横条再实一点，看着像"这里有一块内容"，而不是漏画了横条 */
.tns-chip {
  position: absolute;
  left: 0;
  top: 0;
  display: block;
  width: 42%;
  height: var(--tns-bar-h, 12px);
  border-radius: var(--tns-bar-r, 4px);
  background: var(--canvas-node-panel-surface-active, #e5e7eb);
}
</style>

