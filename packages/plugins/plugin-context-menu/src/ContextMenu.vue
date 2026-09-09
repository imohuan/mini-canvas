<script setup lang="ts">
/**
 * ContextMenu —— 右键菜单浮层（插件自管 UI，挂 body）。
 *
 * item 视觉对齐快捷键帮助面板（老版 CanvasMenu / ShortcutHelpPanel 同一套母体）：
 * - 左侧 28px 圆角图标托（恒渲染，无图标给默认占位）；
 * - 中间名称 + hover 时名称上移、下方浮现描述（hasDescription 行才动效）；
 * - 右侧键帽 chips 显示快捷键（mod 已按平台译成 Ctrl/⌘）。
 *
 * 其余行为不变：fixed(clientX,clientY) 翻折定位；按 group 连续分组 + 分隔线；
 * 点击 props.onSelect(item)；点外部/按 Esc/滚动关闭由宿主插件负责监听。
 */
import { computed } from 'vue'
import type { ContextMenuItem } from './menuBuilder'
import { splitComboChips } from './shortcutText'

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
  const estimatedH = Math.min(420, props.state.items.length * 44 + 48)
  return {
    left: Math.min(props.state.x, vw - 260),
    top: Math.min(props.state.y, vh - estimatedH),
  }
})

function onItemClick(item: ContextMenuItem): void {
  props.onSelect(item)
}

/** 行是否有 hover 描述（决定 label 上移动效开关） */
function hasDesc(item: ContextMenuItem): boolean {
  return !!item.description
}

/** 每条快捷键组合拆成键帽片段（['mod+z'] → [['Ctrl','Z']]；多键 / 连接） */
function chipsOf(item: ContextMenuItem): Array<{ combo: string[] }> {
  return splitComboChips(item.shortcut)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ctx-pop">
      <div
        v-if="state.visible"
        class="ctx-menu"
        :style="{ left: position.left + 'px', top: position.top + 'px' }"
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
            :class="{ 'is-danger': item.danger, hasDescription: hasDesc(item) }"
            role="menuitem"
            @click.stop="onItemClick(item)"
          >
            <!-- 图标托：恒渲染（无 icon 时给默认占位），与快捷键面板/CanvasMenu 一致 -->
            <span class="ctx-menu-icon">
              <span v-if="item.icon" class="ctx-menu-icon-raw" v-html="item.icon" />
              <svg
                v-else
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              ><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h10"/></svg>
            </span>

            <!-- 名称 + hover 描述 -->
            <span class="ctx-menu-copy">
              <span class="ctx-menu-label">{{ item.label }}</span>
              <span v-if="item.description" class="ctx-menu-description">{{ item.description }}</span>
            </span>

            <!-- 右侧键帽快捷键 -->
            <span v-if="item.shortcut?.length" class="ctx-menu-shortcuts">
              <template v-for="(chip, ci) in chipsOf(item)" :key="ci">
                <span v-if="ci > 0" class="ctx-menu-shortcut-sep">/</span>
                <span class="kbd-chip" v-for="(cap, pi) in chip.combo" :key="pi">{{ cap }}</span>
              </template>
            </span>
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
  min-width: 252px;
  max-width: 340px;
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
}
.ctx-menu-divider {
  height: 1px;
  margin: 5px 6px;
  background: rgba(0, 0, 0, 0.06);
}

/* ===== item（对齐快捷键面板 canvas-menu-item 数值）===== */
.ctx-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 6px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
  animation: ctx-item-in 0.2s ease both;
  animation-delay: calc(var(--item-index, 0) * 18ms);
}
.ctx-menu-item:hover:not(.is-disabled) {
  background: rgba(0, 0, 0, 0.05);
}
.ctx-menu-item.is-disabled {
  cursor: not-allowed;
  opacity: 0.38;
}
.ctx-menu-item.is-danger {
  color: #ef4444;
}
.ctx-menu-item.is-danger:hover:not(.is-disabled) {
  background: rgba(239, 68, 68, 0.1);
}
.ctx-menu-item.is-danger .ctx-menu-icon {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
}

/* 图标托 */
.ctx-menu-icon {
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
.ctx-menu-icon-raw {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-style: normal;
}
.ctx-menu-icon :deep(svg),
.ctx-menu-icon svg {
  width: 16px;
  height: 16px;
}

/* 名称/描述区：label 绝对垂直居中；hover 上移 + 下方浮现描述 */
.ctx-menu-copy {
  min-width: 0;
  flex: 1;
  align-self: stretch;
  position: relative;
  overflow: hidden;
  min-height: 32px;
}
.ctx-menu-label {
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
.hasDescription .ctx-menu-label {
  transition: top 0.3s ease-out, transform 0.3s ease-out;
}
.hasDescription:hover .ctx-menu-label,
.hasDescription:focus-within .ctx-menu-label {
  top: 3px;
  transform: translateY(0);
}
.ctx-menu-description {
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
.hasDescription:hover .ctx-menu-description,
.hasDescription:focus-within .ctx-menu-description {
  opacity: 1;
  transform: translateY(0);
}

/* 右侧键帽快捷键 */
.ctx-menu-shortcuts {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  margin-left: 4px;
}
.ctx-menu-shortcut-sep {
  color: #9ca3af;
  font-size: 10px;
  font-weight: 700;
  margin: 0 1px;
}
.kbd-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-bottom-width: 2px;
  border-radius: 5px;
  background: #ffffff;
  color: #374151;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  font-family: ui-monospace, "JetBrains Mono", monospace;
}

.ctx-pop-enter-active {
  transition: opacity 0.18s ease, transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
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

@keyframes ctx-item-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ctx-menu,
  .ctx-menu-item,
  .ctx-menu-label,
  .ctx-menu-description {
    animation: none !important;
    transition: none !important;
  }
  .hasDescription:hover .ctx-menu-label,
  .hasDescription:focus-within .ctx-menu-label {
    top: 3px;
    transform: translateY(0);
  }
  .hasDescription:hover .ctx-menu-description,
  .hasDescription:focus-within .ctx-menu-description {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
