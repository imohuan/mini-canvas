<script setup lang="ts">
import { computed } from "vue"
import { Position } from "@vue-flow/core"
import type { NodeProps } from "@vue-flow/core"
import NodeToolbar from "../Decoration/NodeToolbar.vue"
import ToolbarButton from "../Decoration/ToolbarButton.vue"
import { useCanvasRuntime } from "../../runtime/useCanvasRuntime"
import { useCanvasStore } from "../../composables/useCanvasStore"
import type { ToolbarButtonDefinition, CommandContext } from "../../registry/types"

const props = defineProps<
  Partial<NodeProps> & {
    toolbarPosition: "top" | "bottom"
    nodeIds?: string[]
    extraOffset?: number
  }
>()

const runtime = useCanvasRuntime()
const canvas = useCanvasStore()

const nodeType = computed(() => props.data?.nodeType as string | undefined)
const isMultiSelect = computed(() => !!(props.nodeIds && props.nodeIds.length))

const dataSnapshot = computed(() => props.data)

// 当前激活的工具组：仅从 _overlay._toolbarGroup 读取
// _overlay 不存在 → activeGroup 为 undefined → 不做 group 过滤（全部显示）
const activeGroup = computed(() => {
  const overlay = props.data?._overlay
  if (overlay?._toolbarGroup !== undefined) return overlay._toolbarGroup
  return undefined
})

const visibleButtons = computed<ToolbarButtonDefinition[]>(() => {
  void dataSnapshot.value
  const all = runtime.toolbarRegistry.getByPosition(props.toolbarPosition)
  if (isMultiSelect.value) {
    return all.filter((btn) => btn.source === "multi-select")
  }
  return all.filter((btn) => {
    if (btn.source === "multi-select") return false
    if (btn.nodeTypes && btn.nodeTypes.length > 0 && nodeType.value) {
      if (!btn.nodeTypes.includes(nodeType.value)) return false
    }
    // 工具组过滤：标了 group 的按钮，仅在节点设了 _toolbarGroup 且匹配时显示
    // _toolbarGroup 未设（undefined）→ 跳过过滤，全部显示（向后兼容）
    if (btn.group && activeGroup.value !== undefined && btn.group !== activeGroup.value) return false
    return true
  })
})

const toolbarNodeId = computed(() => {
  if (isMultiSelect.value) return props.nodeIds!
  return props.id
})

const nodeToolbarPosition = computed(() =>
  props.toolbarPosition === "top" ? Position.Top : Position.Bottom
)

const nodeToolbarOffset = computed(() => {
  const base =
    props.toolbarPosition === "top"
      ? canvas.state.core.topToolbarOffset
      : canvas.state.core.bottomToolbarOffset
  return base + (props.extraOffset ?? 0)
})

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

function isDisabled(btn: ToolbarButtonDefinition): boolean {
  if (btn.disabled === undefined) return false
  if (typeof btn.disabled === "boolean") return btn.disabled
  try { return btn.disabled(buildContext()) } catch { return true }
}

function isVisible(btn: ToolbarButtonDefinition): boolean {
  if (btn.visible === undefined) return true
  if (typeof btn.visible === "boolean") return btn.visible
  try { return btn.visible(buildContext()) } catch { return true }
}

function onButtonAction(btn: ToolbarButtonDefinition) {
  if (isDisabled(btn)) return
  runtime.commandRegistry.execute(btn.commandId, buildContext())
}

function onDropdownSelect(btn: ToolbarButtonDefinition, itemId: string) {
  const item = btn.dropdown?.find((d) => d.id === itemId)
  if (!item) return
  const itemDisabled =
    typeof item.disabled === "function"
      ? item.disabled(buildContext())
      : item.disabled
  if (itemDisabled) return
  if (item.commandId) {
    runtime.commandRegistry.execute(item.commandId, buildContext(), {
      filter: itemId,
    })
  } else {
    runtime.commandRegistry.execute(btn.commandId, buildContext(), {
      filter: itemId,
    })
  }
}
</script>

<template>
  <NodeToolbar
    v-if="visibleButtons.length > 0"
    :node-id="toolbarNodeId"
    :position="nodeToolbarPosition"
    :offset="nodeToolbarOffset"
    :is-visible="isMultiSelect || undefined"
  >
    <div class="base-toolbar">
      <template v-for="btn in visibleButtons" :key="btn.id">
        <ToolbarButton
          v-show="isVisible(btn)"
          :icon="btn.icon"
          :title="btn.title"
          :tooltip="btn.tooltip"
          :disabled="isDisabled(btn)"
          :dropdown="btn.dropdown"
          :custom-render="btn.customRender"
          @action="onButtonAction(btn)"
          @dropdown-select="(id: string) => onDropdownSelect(btn, id)"
        />
      </template>
    </div>
  </NodeToolbar>
</template>

<style scoped>
.base-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  pointer-events: auto;
}
</style>
