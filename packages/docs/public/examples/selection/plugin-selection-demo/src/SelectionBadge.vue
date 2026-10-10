<script setup lang="ts">
// 文件：packages/docs/public/examples/packages\docs\public\examples\selection\plugin-selection-demo\src\src/SelectionBadge.vue
// 格式：Vue 单文件组件（setup 语法糖）
// 位置：注册进 overlay 槽的 UI 组件，跟着选中名单显示数量
import { onBeforeUnmount, ref } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'

// ① 组件在 CanvasHost 渲染子树里，用 useCanvasRender() 拿上下文；
//    这里的 ctx 是根 Context，所以要用 ctx.get(...)（没有插件代理糖）
const { ctx } = useCanvasRender()
const selection = ctx.get('selection')

// ② selection 不是 Vue 响应式对象：变化只经 onChange 广播 →
//    自己订阅一次，把数字搬进 ref，模板才会重画
const count = ref(selection.size)
const off = selection.onChange(() => {
  count.value = selection.size
})
onBeforeUnmount(() => off())
</script>

<template>
  <div class="selection-demo-badge">选中 {{ count }} 项</div>
</template>

<style scoped>
.selection-demo-badge {
  position: absolute;
  left: 12px;
  top: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 12px;
}
</style>

