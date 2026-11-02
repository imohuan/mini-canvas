<script setup lang="ts">
/** 截帧按钮与三帧菜单：外观/文案与原 VideoContent 内联块一致 */
import { Camera } from 'lucide-vue-next'
import { useUiComponent } from '@mini-canvas/canvas-render'

defineProps<{
  busy: boolean
  open: boolean
}>()
const emit = defineEmits<{
  (e: 'enter'): void
  (e: 'menu-enter'): void
  (e: 'menu-leave'): void
  (e: 'leave'): void
  (e: 'pick', kind: 'current' | 'first' | 'last'): void
}>()

const Button = useUiComponent('Button')
</script>

<template>
  <Button class="vc-btn" variant="ghost" size="icon-xs" type="button" title="截取画面" aria-label="截取画面" :disabled="busy"
    :aria-expanded="open" :aria-haspopup="'menu'"
    @mouseenter="emit('enter')"
    @mouseleave="open && emit('leave')">
    <Camera class="vc-ico" :size="15" aria-hidden="true" />
  </Button>
  <div v-if="open" class="vc-capture-menu nodrag nopan nowheel" role="menu"
    @mouseenter="emit('menu-enter')" @mouseleave="emit('menu-leave')">
    <Button class="vc-capture-item" variant="ghost" size="sm" role="menuitem" @click.stop="emit('pick', 'current')">截取当前帧</Button>
    <Button class="vc-capture-item" variant="ghost" size="sm" role="menuitem" @click.stop="emit('pick', 'first')">截取首帧</Button>
    <Button class="vc-capture-item" variant="ghost" size="sm" role="menuitem" @click.stop="emit('pick', 'last')">截取尾帧</Button>
  </div>
</template>

<style scoped>
.vc-capture-menu {
  position: absolute;
  right: 0;
  bottom: 30px;
  z-index: 12;
  min-width: 118px;
  padding: 6px;
  border-radius: 12px;
  background: rgba(17, 17, 17, 0.92); /* 主题色白名单: 叠在视频画面上的截图菜单，与主题无关 */
  border: 1px solid rgba(255, 255, 255, 0.08); /* 主题色白名单: 同上 */
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); /* 主题色白名单: 同上 */
  display: flex;
  flex-direction: column;
}
.vc-capture-item {
  display: block;
  width: 100%;
  height: auto;
  padding: 8px 12px;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.92); /* 主题色白名单: 视频覆盖层上的菜单文字 */
  font-size: 13px;
  line-height: 18px;
  text-align: left;
  white-space: nowrap;
}
.vc-capture-item:hover {
  background: rgba(255, 255, 255, 0.12); /* 主题色白名单: 视频覆盖层菜单 hover 底 */
}
.vc-btn {
  flex: none;
  width: 26px;
  height: 26px;
  color: color-mix(in srgb, var(--ui-tip-ink, #fff) 88%, transparent);
  transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.18s ease;
}
.vc-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.18); /* 主题色白名单: 视频覆盖层按钮 hover 底 */
}
.vc-btn:active:not(:disabled) { transform: scale(0.97); }
.vc-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 1px;
}
.vc-btn:disabled { opacity: 0.4; }
.vc-btn svg { width: 15px; height: 15px; }
.vc-btn .vc-ico { stroke-width: 1.75; }
@media (prefers-reduced-motion: reduce) {
  .vc-btn { transition: none !important; }
  .vc-btn:active:not(:disabled) { transform: none; }
}
</style>
