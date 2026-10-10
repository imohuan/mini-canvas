<!-- 文件：packages/docs/public/examples/theme/palette/plugin-flow-badge/src/FlowBadge.vue -->
     格式：Vue 单文件组件（title 区域的小徽章）
     位置：插件包内部；由 ctx.nodes.attach('*', { region: 'title' }) 挂到所有节点上 -->
<script setup lang="ts">
// ① SVG 表现属性吃不到 var() —— :fill="color" 是属性，不是 CSS 声明。
//    所以颜色必须经 useThemeColor 取具体色值（JS 通道）。
import { useThemeColor } from '@mini-canvas/canvas-render'

const flow = useThemeColor('edgeFlowColor')   // 可留空 token：清空 = 跟随强调色，这里拿到的就是跟随后的值
const rail = useThemeColor('edgeRailColor')
</script>

<template>
  <!-- ② 静态底色可以走 CSS（在 <style> 里用 token）；
         动态色只喂给 SVG 属性 -->
  <svg class="flow-badge" viewBox="0 0 32 16" aria-hidden="true">
    <defs>
      <linearGradient id="flow-badge-grad" x1="0" y1="0" x2="1" y2="0">
        <!-- ③ stop-color 是表现属性：写 var(--x) 不生效，必须给具体值 -->
        <stop offset="0" :stop-color="flow" />
        <stop offset="1" :stop-color="flow" stop-opacity="0.15" />
      </linearGradient>
    </defs>
    <circle cx="8" cy="8" r="4" :fill="rail" />
    <rect x="16" y="6" width="14" height="4" rx="2" fill="url(#flow-badge-grad)" />
  </svg>
</template>

<style scoped>
.flow-badge {
  width: 32px;
  height: 16px;
  border-radius: 4px;
  background: var(--ui-veil, rgb(0 0 0 / 0.04));   /* ④ 能写 CSS 的地方仍然只用 token */
}
</style>

