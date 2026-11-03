<script setup lang="ts">
/**
 * ShortcutHelpPanel —— 快捷键帮助面板（v2 复刻老版 shortcut-manager ShortcutHelpPanel.vue）。
 *
 * 功能与原版一致：
 * - 分组帮助列表（系统/编辑/画布/视图/插件）；每行：图标 + 命令名 + hover 描述 + 键帽 + 重映射入口；
 * - 系统/浏览器保留键黄色 ⚠ 软提醒；行内展开 RemapPanel 单条重映射；
 * - 头部：导出配置 / 导入配置 / 恢复默认 / 关闭；
 * - 搜索（命令/键位/ID）+ 无结果提示 + 顶部冲突计数徽章。
 *
 * 数据源差异（v2）：老版读 ShortcutManager 单例；v2 用同包共享的适配器（不占服务名），
 * 从命令注册表 keys（宿主统一分发的唯一数据源）现算帮助列表/冲突/重映射，逻辑零 Vue 可单测。
 *
 * 拆分后：入口仍管 Teleport、可见性、Esc 关闭与关闭事件；
 * 面板内容拆到 shortcut-help-panel/，样式和 class 名原样分到对应子组件。
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { useShortcutHelpPanel } from './shortcut-help-panel/useShortcutHelpPanel'
import ShortcutHelpPanelShell from './shortcut-help-panel/ShortcutHelpPanelShell.vue'

/**
 * 本组件根节点是 <Teleport>，Vue 无法把外部传入的 class/data-* 属性自动落到单个真实根元素上，
 * 会产生 "Extraneous non-props attributes" 警告。SlotHost 会把 overlay occupant 的 class(如
 * csurface-overlay-item) 与 data-slot-* 透传进来，故这里显式关闭属性继承，并手动把 $attrs
 * 绑定到 teleport 后真正渲染的浮层根节点上，既消掉警告，也让这些属性语义化地落到实际 DOM。
 */
defineOptions({ inheritAttrs: false })

const emit = defineEmits<{ close: [] }>()

const {
  service,
  searchQuery,
  conflicts,
  remappingId,
  groupLabels,
  filteredHelpList,
  shortcutIcon,
  onSelectRow,
  openRemap,
  closeRemap,
  exportKeymap,
  importKeymap,
  resetDefaults,
  close,
} = useShortcutHelpPanel()

function onClose(): void {
  close()
  emit('close')
}

// Escape 关闭
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') onClose()
}
onMounted(() => document.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="service && service.visible" v-bind="$attrs" class="shortcut-help-layer" @pointerdown.self="onClose" @contextmenu.prevent>
      <ShortcutHelpPanelShell
        v-model="searchQuery"
        :conflicts-count="conflicts.length"
        :groups="filteredHelpList"
        :group-labels="groupLabels"
        :remapping-id="remappingId"
        :shortcut-icon="shortcutIcon"
        :on-select-row="onSelectRow"
        :on-open-remap="openRemap"
        :on-close-remap="closeRemap"
        :on-export="exportKeymap"
        :on-import="importKeymap"
        :on-reset="resetDefaults"
        :on-close="onClose"
      />
    </div>
  </Teleport>
</template>

<style scoped>
/* ============ 外层：与 CanvasMenu 同样的浮层策略 ============ */
.shortcut-help-layer {
  position: fixed;
  inset: 0;
  /* z-index 走画布层叠带变量（--layer-modal，唯一事实源见 canvas-render/contracts/layers.ts） */
  z-index: var(--layer-modal, 100000);
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: var(--ui-scrim-soft, linear-gradient(180deg, rgba(15, 23, 42, 0.06), rgba(15, 23, 42, 0.18)));
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}
</style>
