<script setup lang="ts">
import { computed } from 'vue'
import type { CanvasMenuItem, CanvasMenuState } from '../../registry/types'

const props = defineProps<{
  menu: CanvasMenuState
}>()

const emit = defineEmits<{
  select: [item: CanvasMenuItem]
  close: []
}>()

function onSelect(item: CanvasMenuItem) {
  if (item.disabled) return
  emit('select', item)
}

const groupedItems = computed(() => {
  const groups = new Map<string, CanvasMenuItem[]>()
  for (const item of props.menu.items) {
    const group = item.group || 'action'
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(item)
  }
  return [...groups.entries()].map(([name, items]) => ({ name, items }))
})
</script>

<template>
  <Teleport to="body">
    <div v-if="menu.visible" class="canvas-menu-layer" @pointerdown.self="emit('close')" @contextmenu.prevent>
      <Transition name="menu-pop">
        <div class="canvas-menu" :class="`canvas-menu--${menu.mode}`"
          :style="{ left: `${menu.position.x}px`, top: `${menu.position.y}px` }" @pointerdown.stop>
          <div class="canvas-menu-title">{{ menu.title }}</div>

          <template v-for="(group, gIdx) in groupedItems" :key="group.name">
            <div v-if="gIdx > 0" class="canvas-menu-divider" />
            <button v-for="(item, iIdx) in group.items" :key="item.id" class="canvas-menu-item" :class="{
              'is-disabled': item.disabled,
              'is-danger': item.danger,
              hasDescription: item.description
            }" :style="{ '--item-index': iIdx }" :disabled="item.disabled" type="button" @click="onSelect(item)">
              <!-- 图标：Component → component :is, string → v-html, 否则默认文本图标 -->
              <span class="canvas-menu-icon">
                <component v-if="typeof item.icon === 'object' && item.icon" :is="item.icon" />
                <i v-else-if="typeof item.icon === 'string' && item.icon" class="canvas-menu-icon-raw" v-html="item.icon" />
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M4 7h16M4 12h10M4 17h16" stroke-linecap="round" />
                </svg>
              </span>
              <span class="canvas-menu-copy">
                <span class="canvas-menu-label">{{ item.label }}</span>
                <span v-if="item.description" class="canvas-menu-description">{{ item.description }}</span>
              </span>
              <span v-if="item.shortcut" class="canvas-menu-shortcut">{{ item.shortcut }}</span>
              <span v-if="item.badge" class="canvas-menu-badge">{{ item.badge }}</span>
            </button>
          </template>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
.canvas-menu-layer {
  position: fixed;
  inset: 0;
  z-index: 100000;
  pointer-events: auto;
}

.canvas-menu {
  position: fixed;
  min-width: 238px;
  padding: 10px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08);
  color: #374151;
}

.canvas-menu-title {
  padding: 4px 6px 8px;
  color: #9ca3af;
  font-size: 12px;
  font-weight: 700;
}

.canvas-menu-divider {
  height: 1px;
  margin: 6px 4px;
  background: rgba(0, 0, 0, 0.06);
}

.canvas-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 6px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
  animation: menu-item-in 0.2s ease both;
  animation-delay: calc(var(--item-index, 0)*25ms);
}

.canvas-menu-item:hover:not(.is-disabled) {
  background: rgba(0, 0, 0, 0.05);
}

.canvas-menu-item.is-disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.canvas-menu-item.is-danger {
  color: #ef4444;
}

.canvas-menu-item.is-danger:hover:not(.is-disabled) {
  background: rgba(239, 68, 68, 0.1);
}

.canvas-menu-icon {
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

.canvas-menu-icon :deep(svg) {
  width: 16px;
  height: 16px;
}

.canvas-menu-icon-raw {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-style: normal;
}

.canvas-menu-copy {
  min-width: 0;
  flex: 1;
  align-self: stretch;
  position: relative;
  overflow: hidden;
  min-height: 34px;
}

.canvas-menu-label {
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  display: block;
  position: absolute;
  top: 50%;
  left: 0;
  transform: translateY(-50%);
}

.hasDescription .canvas-menu-label {
  transition: top 0.3s ease-out, transform 0.3s ease-out;
}

.hasDescription:hover .canvas-menu-label {
  top: 3px;
  transform: translateY(0);
}

.canvas-menu-description {
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

.hasDescription:hover .canvas-menu-description {
  opacity: 1;
  transform: translateY(0);
}

.canvas-menu-shortcut {
  color: #9ca3af;
  font-size: 11px;
  font-weight: 600;
}

.canvas-menu-badge {
  padding: 2px 6px;
  border-radius: 6px;
  color: #0891b2;
  background: rgba(8, 145, 178, 0.12);
  font-size: 10px;
  font-weight: 700;
}

.menu-pop-enter-active {
  transition: opacity 0.24s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.menu-pop-enter-from {
  opacity: 0;
  transform: scale(0.94) translateY(-4px);
}

@keyframes menu-item-in {
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

  .menu-pop-enter-active,
  .canvas-menu-item {
    animation: none;
    transition: none;
  }

  .canvas-menu-label,
  .canvas-menu-description {
    transition: none;
  }

  .hasDescription:hover .canvas-menu-label {
    top: 3px;
    transform: translateY(0);
  }

  .hasDescription:hover .canvas-menu-description {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>