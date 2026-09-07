<script setup lang="ts">
/**
 * ContextMenu —— 右键菜单浮层（插件自管 UI，挂 body）。
 *
 * 对齐老版 canvas-core/components/Menu/CanvasMenu.vue 的视觉与交互，但 v2 独立包自包含：
 * - 定位：fixed(clientX, clientY)，超出视口右/下边缘时翻折。
 * - 分组：按 group 连续分组，组间插分隔线（"新建节点"组在最前）。
 * - 点击菜单项 props.onSelect(item)；点外部/按 Esc/滚动关闭由宿主插件负责监听。
 */
import { computed } from 'vue'
import type { ContextMenuItem } from './menuBuilder'

/** 菜单浮层 UI 状态（reactive 对象整体传入；visible/x/y/items 变化自动重渲染） */
export interface ContextMenuUiState {
  visible: boolean
  x: number
  y: number
  items: ContextMenuItem[]
}

const props = defineProps<{
  state: ContextMenuUiState
  onSelect: (item: ContextMenuItem) => void
  onClose: () => void
}>()

/** 分成连续组：遇到 group 变化就新开一组（items 已按组排序好） */
const groups = computed(() => {
  const out: Array<{ group: string; items: ContextMenuItem[] }> = []
  for (const item of props.state.items) {
    const last = out[out.length - 1]
    if (last && last.group === item.group) last.items.push(item)
    else out.push({ group: item.group, items: [item] })
  }
  return out
})

/** 菜单左上角定位：fixed(clientX/clientY)，超出视口右/下边缘时收进视口 */
const position = computed(() => {
  const vw = typeof window === 'undefined' ? 1024 : window.innerWidth
  const vh = typeof window === 'undefined' ? 768 : window.innerHeight
  const estimatedH = Math.min(360, props.state.items.length * 36 + 48)
  return {
    left: Math.min(props.state.x, vw - 240),
    top: Math.min(props.state.y, vh - estimatedH),
  }
})

function onItemClick(item: ContextMenuItem): void {
  props.onSelect(item)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ctx-pop">
      <div
        v-if="state.visible"
        class="ctx-menu"
        :style="{
          left: position.left + 'px',
          top: position.top + 'px',
        }"
        role="menu"
        @contextmenu.prevent
      >
        <template v-for="(group, gi) in groups" :key="group.group">
          <div v-if="gi > 0" class="ctx-menu-divider" />
          <button
            v-for="item in group.items"
            :key="item.id"
            type="button"
            class="ctx-menu-item"
            :class="{ 'is-danger': item.danger }"
            role="menuitem"
            @click.stop="onItemClick(item)"
          >
            <span v-if="item.icon" class="ctx-menu-icon" v-html="item.icon" />
            <span class="ctx-menu-label">{{ item.label }}</span>
            <span v-if="item.shortcut?.length" class="ctx-menu-shortcut">{{ item.shortcut.join(' / ') }}</span>
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 100000;
  min-width: 220px;
  max-width: 300px;
  padding: 6px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.12);
  color: #334155;
  font-size: 13px;
  user-select: none;
}
.ctx-menu-divider {
  height: 1px;
  margin: 5px 8px;
  background: rgba(0, 0, 0, 0.06);
}
.ctx-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease;
}
.ctx-menu-item:hover {
  background: rgba(15, 23, 42, 0.06);
}
.ctx-menu-item.is-danger {
  color: #dc2626;
}
.ctx-menu-item.is-danger:hover {
  background: rgba(220, 38, 38, 0.08);
}
.ctx-menu-icon {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
}
.ctx-menu-icon :deep(svg) {
  width: 16px;
  height: 16px;
}
.ctx-menu-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ctx-menu-shortcut {
  color: #94a3b8;
  font-size: 11px;
  font-weight: 600;
}
.ctx-pop-enter-active {
  transition: opacity 0.16s ease, transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ctx-pop-enter-from {
  opacity: 0;
  transform: scale(0.96) translateY(-4px);
}
.ctx-pop-leave-active {
  transition: opacity 0.1s ease;
}
.ctx-pop-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .ctx-menu,
  .ctx-menu-item {
    transition: none;
  }
}
</style>
