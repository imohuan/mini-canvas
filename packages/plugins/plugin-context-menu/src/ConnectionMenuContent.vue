<script setup lang="ts">
/**
 * ConnectionMenuContent —— 临时菜单节点的 content 段组件（由 BaseNode 壳按 type 路由渲染）。
 *
 * 它只负责"把菜单项画成卡片"；点击经 ctx 事件回传插件（建真节点 + 真边 / 取消）。
 * 外观数值完全对齐右键菜单 ContextMenu.vue（44px 行 / 6px 内边距 / 28×28 图标托 / 16px 圆角 / hover 描述上移）。
 *
 * 因为它是**真节点**（经 nodeStore → VueFlow 渲染），位置/尺寸/缩放全部由画布负责，无需自己算坐标。
 */
import { computed } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { ContextMenuItem } from './menuBuilder'
import { CONNECTION_MENU_PICK_EVENT } from './connectionMenu'

const props = defineProps<{ id: string; data: { items?: ContextMenuItem[] } }>()

const { ctx } = useCanvasRender()

const items = computed<ContextMenuItem[]>(() => (Array.isArray(props.data?.items) ? props.data.items : []))

/** 按 group 连续分块（与右键菜单同款：不同组之间插分隔线） */
const groups = computed(() => {
  const out: Array<{ group: string; items: ContextMenuItem[] }> = []
  for (const item of items.value) {
    const last = out[out.length - 1]
    if (last && last.group === item.group) last.items.push(item)
    else out.push({ group: item.group, items: [item] })
  }
  return out
})

function onPick(item: ContextMenuItem, e: MouseEvent): void {
  // 阻止冒泡：否则 VueFlow 会把它当"点节点"处理
  e.stopPropagation()
  ctx.emit(CONNECTION_MENU_PICK_EVENT, item)
}

</script>

<template>
  <div data-connection-menu class="conn-menu nodrag nopan" @pointerdown.stop @click.stop>
    <template v-for="(group, gi) in groups" :key="group.group">
      <div v-if="gi > 0" class="conn-menu-divider" />
      <button
        v-for="(item, ii) in group.items"
        :key="item.id"
        type="button"
        class="conn-menu-item"
        :class="{ hasDescription: !!item.description }"
        :style="{ '--item-index': gi * 3 + ii }"
        role="menuitem"
        @click="onPick(item, $event)"
      >
        <span class="conn-menu-icon">
          <span v-if="item.icon" class="conn-menu-icon-raw" v-html="item.icon" />
        </span>
        <span class="conn-menu-copy">
          <span class="conn-menu-label">{{ item.label }}</span>
          <span v-if="item.description" class="conn-menu-description">{{ item.description }}</span>
        </span>
      </button>
    </template>
  </div>
</template>

<style scoped>
/* 卡片本体：数值对齐右键菜单 .ctx-menu（位置/尺寸由节点框决定，这里只管外观） */
.conn-menu {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 6px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
  color: #374151;
  font-size: 13px;
  user-select: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.conn-menu-divider {
  height: 1px;
  margin: 5px 6px;
  background: rgba(0, 0, 0, 0.06);
}

/* 行：对齐 .ctx-menu-item */
.conn-menu-item {
  width: 100%;
  height: 44px;
  flex: 0 0 44px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
  animation: conn-item-in 0.2s ease both;
  animation-delay: calc(var(--item-index, 0) * 18ms);
}
.conn-menu-item:hover { background: rgba(0, 0, 0, 0.05); }
.conn-menu-item:focus-visible { outline: 2px solid rgba(8, 145, 178, 0.6); outline-offset: -1px; }

.conn-menu-icon {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: #6b7280;
  background: rgba(0, 0, 0, 0.04);
}
.conn-menu-icon-raw { display: inline-flex; align-items: center; justify-content: center; font-style: normal; }
.conn-menu-icon :deep(svg), .conn-menu-icon svg { width: 16px; height: 16px; }

.conn-menu-copy {
  min-width: 0;
  flex: 1;
  align-self: stretch;
  position: relative;
  overflow: hidden;
  min-height: 32px;
}
.conn-menu-label {
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  display: block;
  position: absolute;
  top: 50%;
  left: 0;
  color: #111827;
  transform: translateY(-50%);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.hasDescription .conn-menu-label { transition: top 0.3s ease-out, transform 0.3s ease-out; }
.hasDescription:hover .conn-menu-label, .hasDescription:focus-within .conn-menu-label { top: 3px; transform: translateY(0); }
.conn-menu-description {
  color: #9ca3af;
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  position: absolute;
  bottom: 3px;
  left: 0;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
}
.hasDescription:hover .conn-menu-description, .hasDescription:focus-within .conn-menu-description { opacity: 1; transform: translateY(0); }

@keyframes conn-item-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .conn-menu-item { animation: none !important; transition: none !important; }
}
</style>
