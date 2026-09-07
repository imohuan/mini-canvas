<script setup lang="ts">
/**
 * GroupContent —— group 节点的 content 组件（随 plugin-group 插件包发布）。
 *
 * 职责（对齐 v2 分层：render 只给数据/能力，UI 与交互全在本插件）：
 * - 整卡铺一层半透明分组底色 + 圆角边框，让 group 视觉上是"容器"；
 * - 右上角"解组"按钮（点击调 ctx.group.ungroup，class=nodrag 防止触发画布拖动）；
 * - 标题改名由 BaseNode 壳内置标题条承担（双击 data.label，F2 也行），这里不重复造。
 *
 * 尺寸/位置/拖拽/选中环全部由 BaseNode 壳 + VueFlow 处理，本组件不碰 DOM 坐标。
 */
import { computed } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { resolveGroupBackgroundColor } from './groupEngine'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()

const backgroundColor = computed(() => resolveGroupBackgroundColor(props.data?.backgroundColor))

function groupService() {
  return ctx.get<{ ungroup(groupId: string): void }>('group')
}

function onUngroup(): void {
  groupService()?.ungroup(props.id)
}
</script>

<template>
  <div class="group-content" :style="{ '--group-color': backgroundColor }">
    <button
      class="group-content__ungroup nodrag nopan"
      type="button"
      title="解散分组"
      aria-label="解散分组"
      @pointerdown.stop
      @click.stop="onUngroup"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 8h8v8H8z" />
        <path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z" />
      </svg>
    </button>
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
  pointer-events: auto;
}
.group-content__ungroup {
  position: absolute;
  top: 4px;
  right: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: color-mix(in srgb, var(--group-color, #334155) 14%, transparent);
  color: color-mix(in srgb, var(--group-color, #334155) 74%, black 10%);
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, background-color 120ms ease;
  pointer-events: auto;
}
.group-content:hover .group-content__ungroup {
  opacity: 1;
}
.group-content__ungroup:hover {
  background: color-mix(in srgb, var(--group-color, #334155) 26%, transparent);
}
.group-content__ungroup svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
}
</style>
