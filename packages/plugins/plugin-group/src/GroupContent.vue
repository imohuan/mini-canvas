<script setup lang="ts">
/**
 * GroupContent —— group 节点的 content 组件（随 plugin-group 插件包发布）。
 *
 * 职责（对齐 v2 分层：render 只给数据/能力，UI 与交互全在本插件）：
 * - 整卡铺一层半透明分组底色 + 圆角边框，让 group 视觉上是"容器"；
 * - 标题改名由 BaseNode 壳内置标题条承担（双击 data.label，F2 也行），这里不重复造。
 *
 * 这里**没有按钮**：解组已搬到上控制栏（见 GroupTopToolbar / groupPlugin 的 segments）——
 * 节点上的操作一律走 out:top/out:bottom，与其它节点同源，多选时也才能被壳统一压掉。
 *
 * 尺寸/位置/拖拽/选中环全部由 BaseNode 壳 + VueFlow 处理，本组件不碰 DOM 坐标。
 */
import { computed } from 'vue'
import { resolveGroupBackgroundColor } from './groupEngine'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const backgroundColor = computed(() => resolveGroupBackgroundColor(props.data?.backgroundColor))
</script>

<template>
  <div class="group-content" :style="{ '--group-color': backgroundColor }">
  </div>
</template>

<style scoped>
.group-content {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border-radius: 6px;
  background: color-mix(in srgb, var(--group-color, #334155) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--group-color, #334155) 42%, transparent);
  /* 容器空白区不吃指针（拖组/框选穿透到画布），交互全靠壳与子节点（对齐 v1 group-node__body） */
  pointer-events: none;
}
</style>
