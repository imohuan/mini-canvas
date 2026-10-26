<script setup lang="ts">
/**
 * NodeCtrlDragOverlay —— 挂在**节点内部**的 Ctrl 拖选择态高亮（over:inset 区域）。
 *
 * 用户口径（2026-10-26）：必须用 overlay 槽组件（节点覆盖层）—— 长在节点里，
 * 跟随节点变换，缩放/平移时边框圆角永远贴合，不做 fixed 屏幕坐标测量。
 *
 * 状态读 globalThis.__miniCanvasCtrlDrag：发起方（底栏）与本组件可能来自不同模块
 * 实例（热重载 UMD 拷贝 vs bundle 拷贝），模块 ref 不共享 —— enter/exit 同步写
 * globalThis 并广播事件；本组件监听事件 + tick 计数驱动重算。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { ctrlDragNodeState, type CtrlDragNodeState } from './ctrlDragMode'
import { nodeMediaOf } from './refSlotDrag'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()

/** 会话开关的全局事件驱动重算（globalThis 不是响应源，没有 tick 触发 computed 永不重算） */
const tick = ref(0)
function onModeChange(): void {
  tick.value += 1
}
onMounted(() => window.addEventListener('mini-canvas:ctrl-drag-mode', onModeChange))
onBeforeUnmount(() => window.removeEventListener('mini-canvas:ctrl-drag-mode', onModeChange))

const state = computed<null | CtrlDragNodeState>(() => {
  void tick.value
  const session = (globalThis as { __miniCanvasCtrlDrag?: { active: boolean; owner: string } }).__miniCanvasCtrlDrag
  if (!session?.active) return null
  const doc = ctx.tryGet<{ getNode(id: string): { type?: string; data?: Record<string, unknown> } | undefined; getEdges(): Array<{ source: string; target: string }> }>('doc')
  const node = doc?.getNode(props.id)
  const connected = !!doc?.getEdges().some((e) => e.source === props.id && e.target === session.owner)
  return ctrlDragNodeState({ isOwner: props.id === session.owner, isMedia: !!nodeMediaOf(node), connected })
})
</script>

<template>
  <div v-if="state" class="cd-node-layer" :class="'is-' + state" data-testid="ctrl-drag-node-layer">
    <span v-if="state === 'selectable' || state === 'connected'" class="cd-badge">
      {{ state === 'connected' ? '✓' : '+' }}
    </span>
    <span v-if="state === 'connected'" class="cd-node-hint">已连接 · 不可重复拖拽</span>
  </div>
</template>

<style scoped>
/* 面孔与参考选择（rs-layer）同构：紫描边/淡紫底/角标/灰罩，走 --ui-* token */
.cd-node-layer {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
}
.cd-node-layer.is-selectable { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.cd-node-layer.is-connected { background: color-mix(in srgb, var(--ui-accent) 10%, transparent); box-shadow: inset 0 0 0 1.5px var(--ui-accent); }
.cd-node-layer.is-owner { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--ui-accent) 40%, transparent); }
.cd-node-layer.is-blocked { background: color-mix(in srgb, var(--ui-scrim) 42%, transparent); }
.cd-badge { position: absolute; left: 6px; top: 6px; display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 999px; background: var(--ui-accent); color: var(--ui-primary-ink, #fff); font-size: 12px; font-weight: 700; line-height: 1; }
.cd-node-hint { position: absolute; left: 50%; top: calc(100% + 6px); transform: translateX(-50%); padding: 4px 10px; border-radius: 8px; background: var(--ui-accent); color: var(--ui-primary-ink, #fff); font-size: 12px; font-weight: 600; white-space: nowrap; }
</style>
