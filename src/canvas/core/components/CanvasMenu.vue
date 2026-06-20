<script setup lang="ts">
import { computed } from 'vue'
import type { CanvasMenuItem, CanvasMenuState } from './CanvasMenu.types'

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
        <div
          class="canvas-menu"
          :class="`canvas-menu--${menu.mode}`"
          :style="{ left: `${menu.position.x}px`, top: `${menu.position.y}px` }"
          @pointerdown.stop
        >
          <div class="canvas-menu-title">{{ menu.title }}</div>

          <template v-for="(group, gIdx) in groupedItems" :key="group.name">
            <div v-if="gIdx > 0" class="canvas-menu-divider" />
            <button
              v-for="(item, iIdx) in group.items"
              :key="item.id"
              class="canvas-menu-item"
              :class="{
                'is-disabled': item.disabled,
                'is-danger': item.danger,
              }"
              :style="{ '--item-index': iIdx }"
              :disabled="item.disabled"
              type="button"
              @click="onSelect(item)"
            >
              <span class="canvas-menu-icon" :class="`canvas-menu-icon--${item.icon || 'text'}`">
                <svg v-if="item.icon === 'image'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <svg v-else-if="item.icon === 'video'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="4" y="5" width="12" height="14" rx="2" />
                  <path d="M16 9l5-3v12l-5-3" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <svg v-else-if="item.icon === 'layers'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 3l9 5-9 5-9-5 9-5Z" stroke-linejoin="round" />
                  <path d="M3 12l9 5 9-5" stroke-linecap="round" stroke-linejoin="round" />
                  <path d="M3 16l9 5 9-5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <svg v-else-if="item.icon === 'link'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M10 13a5 5 0 0 0 7.07 0l2-2a5 5 0 0 0-7.07-7.07l-1.1 1.1" stroke-linecap="round" />
                  <path d="M14 11a5 5 0 0 0-7.07 0l-2 2A5 5 0 0 0 12 20.07l1.1-1.1" stroke-linecap="round" />
                </svg>
                <svg v-else-if="item.icon === 'delete'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M4 7h16" stroke-linecap="round" />
                  <path d="M10 11v6M14 11v6" stroke-linecap="round" />
                  <path d="M6 7l1 14h10l1-14M9 7V4h6v3" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <svg v-else-if="item.icon === 'duplicate'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="8" y="8" width="12" height="12" rx="2" />
                  <path d="M4 16V6a2 2 0 0 1 2-2h10" stroke-linecap="round" />
                </svg>
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
.canvas-menu-layer { position: fixed; inset: 0; z-index: 100000; pointer-events: auto; }
.canvas-menu { position: fixed; min-width: 238px; padding: 10px; border: 1px solid rgba(0,0,0,0.08); border-radius: 16px; background: rgba(255,255,255,0.82); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); box-shadow: 0 20px 40px rgba(0,0,0,0.08); color: #374151; }
.canvas-menu-title { padding: 4px 6px 8px; color: #9ca3af; font-size: 12px; font-weight: 700; }
.canvas-menu-divider { height: 1px; margin: 6px 4px; background: rgba(0,0,0,0.06); }
.canvas-menu-item { width: 100%; display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 6px; border: 0; border-radius: 10px; background: transparent; color: inherit; text-align: left; cursor: pointer; transition: background 0.18s cubic-bezier(0.34,1.56,0.64,1); animation: menu-item-in 0.2s ease both; animation-delay: calc(var(--item-index,0)*25ms); }
.canvas-menu-item:hover:not(.is-disabled) { background: rgba(0,0,0,0.05); }
.canvas-menu-item.is-disabled { cursor: not-allowed; opacity: 0.38; }
.canvas-menu-item.is-danger { color: #ef4444; }
.canvas-menu-item.is-danger:hover:not(.is-disabled) { background: rgba(239,68,68,0.1); }
.canvas-menu-icon { width: 28px; height: 28px; flex: 0 0 28px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; color: #6b7280; background: rgba(0,0,0,0.04); }
.canvas-menu-icon svg { width: 16px; height: 16px; }
.canvas-menu-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px; }
.canvas-menu-label { font-size: 13px; font-weight: 600; line-height: 1.2; }
.canvas-menu-description { color: #9ca3af; font-size: 11px; line-height: 1.2; }
.canvas-menu-shortcut { color: #9ca3af; font-size: 11px; font-weight: 600; }
.canvas-menu-badge { padding: 2px 6px; border-radius: 6px; color: #0891b2; background: rgba(8,145,178,0.12); font-size: 10px; font-weight: 700; }
.menu-pop-enter-active { transition: opacity 0.24s cubic-bezier(0.34,1.56,0.64,1), transform 0.24s cubic-bezier(0.34,1.56,0.64,1); }
.menu-pop-enter-from { opacity: 0; transform: scale(0.94) translateY(-4px); }
@keyframes menu-item-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .menu-pop-enter-active,.canvas-menu-item { animation: none; transition: none; } }
</style>