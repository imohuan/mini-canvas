<!-- 文件：packages/docs/public/examples/canvas-data/node-types/plugin-stamp-node/src/TopPin.vue -->
     格式：Vue 单文件组件（图片节点上控制栏里的一个按钮）
     位置：插件包内部；由 ctx.nodes.attach('image', { region: 'out:top' }) 挂到 image 类型上
     说明：needs 声明要用哪些能力包 —— 组件按名拿到，不自己 ctx.get 拼 -->
<script setup lang="ts">
// 能力包按名取：needs: ['node'] 在 ctx.nodes.attach 里声明（忘了写会拿到 undefined，dev 有提示）
import { useCapability } from '@mini-canvas/canvas-render'

// NodeCapability 的形状来自渲染层标准能力包（packages/canvas-render/src/contracts/standardCapabilities.ts）
const node = useCapability<{ readonly id: string; readonly type: string }>('node')
</script>

<template>
  <button class="top-pin" type="button" :title="'给节点 ' + (node?.id ?? '') + ' 盖个章'">
    ⭐
  </button>
</template>

<style scoped>
.top-pin {
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ntb-text, #6b7280);
  cursor: pointer;
}
.top-pin:hover { background: var(--ntb-fill-hover, rgb(0 0 0 / 0.06)); color: var(--ntb-text-strong, #111827); }
.top-pin:focus-visible { outline: 2px solid var(--ntb-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }
</style>
