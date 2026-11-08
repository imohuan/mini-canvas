<script setup lang="ts">
/**
 * NodeTaskOverlay —— 节点卡片上的加载/进度覆盖层（**只用默认主题那一只加载件**）。
 *
 * 数据单一来源 = props.data.runState（插件经 doc.updateNodeRuntime 写，落盘不进撤销栈）。
 * 显隐规则（用户要求：**所有任务消息只在节点这一处**，底栏不再显示任何状态文案）：
 * - running → 整卡加载态（流光百分比）；
 * - error（失败 / 暂停 / 中断 / 取消）→ **同样整卡覆盖**，只是把内容换成失败标记 + 原因，
 *   底下一行小字提示「可重试」（用户报过：失败时只在卡片顶上贴一条，不够醒目）；
 * - done / idle / 缺省 → 渲染空。
 *
 * 版式不再写在本文件里：视觉统一由默认主题的 `nodeLoadingState` 提供
 * （同一个件也用在视频帧图、视频加载、后台裁剪/剪辑）。这里只负责：
 * 1. 把 runState 翻译成加载件的 props；
 * 2. 取消按钮（右下角、小号，只有跑着时给）。
 *
 * 为什么保留 `task-overlay` 这层外壳与类名：e2e / 文档按它定位，换实现不换对外契约。
 */
import { computed } from 'vue'
import { useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'

// over:inset 条目会被 SlotHost/壳下发 class/data-*；fragment 根继承不了，显式关掉防 warn。
defineOptions({ inheritAttrs: false })
import type { NodeRunState } from './runState'
import { readRunState } from './runState'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()
const Button = useUiComponent('Button')
/** 默认主题的通用加载态（按名取；换主题一起换） */
const NodeLoadingState = useUiComponent('nodeLoadingState')

const state = computed<NodeRunState>(() => readRunState(props.data))
const running = computed(() => state.value.status === 'running')
/**
 * 失败 / 暂停 / 中断 / 取消 —— 与 running **同一块整卡覆盖**，只换内容。
 * 文案就是服务端/插件写的那句中文，不再加工。
 */
const failed = computed(() => state.value.status === 'error')
/** 覆盖层是否出现（running 或 error 都盖住整卡） */
const visible = computed(() => running.value || failed.value)

function onCancel(): void {
  ctx.get<{ cancel(nodeId: string): void }>('nodeTask').cancel(props.id)
}
</script>

<template>
  <div v-if="visible" class="task-overlay" :class="{ 'is-error': failed }" :data-testid="failed ? 'task-failed' : 'task-overlay'">
    <!-- 整块加载态：流光底色 + 百分比 + 阶段文案，全部由默认主题那只加载件画 -->
    <NodeLoadingState
      class="task-overlay-state"
      :tone="failed ? 'error' : 'loading'"
      :label="failed ? '执行失败' : '生成中'"
      :percent="failed ? null : state.progress ?? null"
      :message="state.message"
      :hint="failed ? '可再点一次发送重试' : ''"
      :started-at="failed ? 0 : state.startedAt ?? 0"
    >
      <!-- 取消：右下角、小号（只有跑着时才给） -->
      <template #action>
        <Button
          v-if="running"
          variant="ghost"
          size="sm"
          class="task-overlay-cancel"
          type="button"
          title="取消任务"
          @click.stop="onCancel"
        >
          取消
        </Button>
      </template>
    </NodeLoadingState>
  </div>
</template>

<style scoped>
/* 外壳只负责定位：视觉全在 nodeLoadingState 里 */
.task-overlay {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
}

/* 取消按钮：右下角一小格，只有它接指针 */
.task-overlay-cancel {
  position: absolute;
  right: 6px;
  bottom: 6px;
  z-index: 3;
  border-radius: 6px;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  background: var(--ui-overlay-solid, #fff);
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  pointer-events: auto;
  transition: color 0.15s ease-out, background-color 0.15s ease-out;
}
.task-overlay-cancel:hover {
  color: var(--ui-danger, #ef4444);
  background: var(--ui-danger-soft, color-mix(in srgb, var(--ui-danger, #ef4444) 14%, transparent));
}

@media (prefers-reduced-motion: reduce) {
  .task-overlay-cancel {
    transition: none;
  }
}
</style>
