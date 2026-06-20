<script setup lang="ts">
import { computed } from 'vue'
import type { NodeProps } from '@vue-flow/core'
import { useCanvasRuntime } from '../../runtime/useCanvasRuntime'
import type { ToolbarButtonDefinition } from '../../registry/types'
import type { CommandContext } from '../../registry/types'

const props = defineProps<NodeProps & {
  /** 显示在上面还是下面 */
  toolbarPosition: 'top' | 'bottom'
}>()

const runtime = useCanvasRuntime()

/** 当前节点类型 */
const nodeType = computed(() => props.data?.nodeType as string | undefined)

/** 该位置的所有按钮，过滤 nodeTypes */
const visibleButtons = computed<ToolbarButtonDefinition[]>(() => {
  const all = runtime.toolbarRegistry.getByPosition(props.toolbarPosition)
  return all.filter((btn) => {
    if (btn.nodeTypes && nodeType.value) {
      if (!btn.nodeTypes.includes(nodeType.value)) return false
    }
    return true
  })
})

/** 构建命令上下文 */
function buildContext(): CommandContext {
  return {
    runtime,
    actions: null,
    selection: null,
    viewport: null,
    store: null,
    logger: console,
    node: props as any,
    nodeType: nodeType.value,
  }
}

/** 按钮是否禁用 */
function isDisabled(btn: ToolbarButtonDefinition): boolean {
  if (btn.disabled === undefined) return false
  if (typeof btn.disabled === 'boolean') return btn.disabled
  try {
    return btn.disabled(buildContext())
  } catch {
    return true
  }
}

/** 点击按钮 -> 执行命令 */
function onClick(btn: ToolbarButtonDefinition) {
  if (isDisabled(btn)) return
  const ctx = buildContext()
  runtime.commandRegistry.execute(btn.commandId, ctx)
}
</script>

<template>
  <div v-if="visibleButtons.length > 0" class="base-toolbar" :class="`base-toolbar--${toolbarPosition}`">
    <button
      v-for="btn in visibleButtons"
      :key="btn.id"
      class="base-toolbar-btn"
      :class="{ 'is-disabled': isDisabled(btn) }"
      :disabled="isDisabled(btn)"
      type="button"
      :title="btn.title"
      @click="onClick(btn)"
    >
      <component v-if="typeof btn.icon !== 'string' && btn.icon" :is="btn.icon" />
      <span v-else-if="typeof btn.icon === 'string'">{{ btn.icon }}</span>
      <span v-if="btn.title" class="base-toolbar-btn-label">{{ btn.title }}</span>
    </button>
  </div>
</template>

<style scoped>
.base-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
}

.base-toolbar--top {
  margin-bottom: 4px;
}

.base-toolbar--bottom {
  margin-top: 4px;
}

.base-toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--canvas-text, #374151);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.base-toolbar-btn:hover:not(.is-disabled) {
  background: rgba(0, 0, 0, 0.06);
}

.base-toolbar-btn.is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.base-toolbar-btn-label {
  white-space: nowrap;
}
</style>




