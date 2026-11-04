<script setup lang="ts">
/**
 * 圆角示意图：画**左上角那一段转角**（直线 → 圆弧 → 直线）。
 *
 * 为什么不用一个带 border-radius 的小方块（用户口径 2026-11-04）：
 * 方块在 16~20px 里最多只能显示出「圆一点 / 没那么圆」，
 * 而真实的圆角是在两条边之间过渡的弧，只有画出这条弧（参考 https:// 你给的
 * SVG path 方案）才能一眼看出 2px / 4px / 6px / 8px / 12px 的差别。
 *
 * path 结构与参考实现一致：
 *   M 0,H  L 0,r  A r,r 0 0,1 r,0  L W,0
 * 其中 r 是圆角半径换算到 viewBox 里的长度。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 真实圆角的像素值 */
    radius: number
    /**
     * 预览框实际显示的边长（px）。viewBox 与它一致，
     * 这样 1 个 viewBox 单位 = 1 个屏幕像素，圆弧才是真实比例。
     */
    box?: number
  }>(),
  { box: 28 },
)

/**
 * 按真实像素画转角。
 *
 * 这里踩过一个坑（2026-11-04 用户反馈「圆角一点效果也没有」）：
 * 之前把 viewBox 固定成 100×100 再整体缩到 20px，12px 的圆弧只剩 2.4 个 viewBox 单位，
 * 渲染出来不到 0.5px，看起来就是直角。现在 viewBox 直接等于显示尺寸，圆弧按像素画。
 */
const path = computed(() => {
  const s = props.box
  // 圆角最多到边长的一半（再多就变成半圆，反而看不出差别）
  const r = Math.max(0, Math.min(props.radius, s / 2))
  if (r === 0) return `M 0,${s} L 0,0 L ${s},0`
  return `M 0,${s} L 0,${r} A ${r},${r} 0 0,1 ${r},0 L ${s},0`
})
</script>

<template>
  <svg
    :viewBox="'0 0 ' + box + ' ' + box"
    :width="box"
    :height="box"
    class="size-full overflow-visible"
    fill="none"
    aria-hidden="true"
  >
    <path
      :d="path"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    />
  </svg>
</template>
