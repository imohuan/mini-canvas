<script setup lang="ts">
import { useUiComponent, ToolbarIcon } from '@mini-canvas/canvas-render'
import { ICON_CLOSE, ICON_CONFIRM, ICON_KEYBOARD, ICON_LOOP, ICON_MAGNET } from './icons'

defineProps<{
  pending: boolean
  snap: boolean
  loop: boolean
}>()

const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'confirm'): void
  (e: 'toggle-snap'): void
  (e: 'toggle-loop'): void
}>()

const Button = useUiComponent('Button')
const Popover = useUiComponent('Popover')
const PopoverContent = useUiComponent('PopoverContent')
const PopoverTrigger = useUiComponent('PopoverTrigger')

const configOpen = defineModel<boolean>('configOpen', { default: false })
</script>

<template>
  <!-- 外壳 = 主题胶囊 .ntp-root（与图片裁剪/绘制状态栏同一套 token）：
       底色、边框、圆角、阴影都跟着亮/暗主题走；按钮直接用 shadcn Button。 -->
  <div class="ntp-root vclip-dock">
    <Button variant="destructive" size="icon-sm" type="button"
      title="退出剪辑" aria-label="退出剪辑" @click="emit('cancel')">
      <ToolbarIcon :icon="ICON_CLOSE" />
    </Button>

    <!--
      快捷键说明 = shadcn 的 Popover 分离件（向上弹，贴着按钮）。
      为什么用下拉而不是在底栏下方展开一块：用户口径 2026-10-31「下拉菜单显示在它上面」——
      底栏在节点下方，向下展开会压住画布/节点；向上弹才是贴着按钮的说明卡。
      吸附间隔/范围不在这里配置：那是设置面板里的项（节点/视频剪辑），这里只给快捷键说明。
    -->
    <Popover v-model:open="configOpen">
      <PopoverTrigger as-child>
        <Button :variant="configOpen ? 'secondary' : 'ghost'" size="icon-sm" type="button"
          title="快捷键" aria-label="快捷键" :aria-pressed="configOpen ? 'true' : 'false'">
          <ToolbarIcon :icon="ICON_KEYBOARD" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" :side-offset="8" class="vclip-help-popover">
      <div class="vclip-help-body" role="dialog" aria-label="剪辑快捷键">
        <header class="vclip-help-head">
          <span class="vclip-help-title">快捷键</span>
          <button class="vclip-help-close" type="button" aria-label="关闭快捷键" title="关闭" @click="configOpen = false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </header>
        <div class="vclip-help-grid">
          <div class="vclip-help-item">
            <span class="vclip-help-label">移动选区</span>
            <span class="vclip-help-keys"><kbd>←</kbd><kbd>→</kbd></span>
          </div>
          <div class="vclip-help-item">
            <span class="vclip-help-label">精确模式</span>
            <span class="vclip-help-keys"><span class="vclip-help-hint">按住</span><kbd>Shift</kbd></span>
          </div>
          <div class="vclip-help-item">
            <span class="vclip-help-label">扩展/收缩选区</span>
            <span class="vclip-help-keys"><kbd>↑</kbd><kbd>↓</kbd></span>
          </div>
          <div class="vclip-help-item">
            <span class="vclip-help-label">快速调整</span>
            <span class="vclip-help-keys"><kbd>⌘/Ctrl</kbd><span class="vclip-help-hint">+</span><kbd>↑</kbd><kbd>↓</kbd></span>
          </div>
          <div class="vclip-help-item">
            <span class="vclip-help-label">设置出点入点</span>
            <span class="vclip-help-keys"><kbd>I</kbd><kbd>O</kbd></span>
          </div>
          <div class="vclip-help-item">
            <span class="vclip-help-label">播放/暂停</span>
            <span class="vclip-help-keys"><kbd>Space</kbd></span>
          </div>
          <div class="vclip-help-item">
            <span class="vclip-help-label">退出</span>
            <span class="vclip-help-keys"><kbd>Esc</kbd></span>
          </div>
          <div class="vclip-help-item">
            <span class="vclip-help-label">确认剪辑</span>
            <span class="vclip-help-keys"><kbd>Enter</kbd></span>
          </div>
        </div>
      </div>
      </PopoverContent>
    </Popover>

    <slot />

    <Button :variant="snap ? 'secondary' : 'ghost'" size="icon-sm" type="button"
      :title="snap ? '关闭吸附' : '开启吸附'" aria-label="吸附" :aria-pressed="snap ? 'true' : 'false'"
      @click="emit('toggle-snap')">
      <ToolbarIcon :icon="ICON_MAGNET" />
    </Button>

    <Button :variant="loop ? 'secondary' : 'ghost'" size="icon-sm" type="button"
      :title="loop ? '关闭区间循环' : '开启区间循环'" aria-label="区间循环" :aria-pressed="loop ? 'true' : 'false'"
      @click="emit('toggle-loop')">
      <ToolbarIcon :icon="ICON_LOOP" />
    </Button>

    <Button variant="default" size="sm" type="button"
      :title="pending ? '剪辑中…' : '确认剪辑'"
      :aria-label="pending ? '剪辑中' : '确认剪辑'" :disabled="pending" @click="emit('confirm')">
      <ToolbarIcon :icon="ICON_CONFIRM" />
      <span>{{ pending ? '剪辑中…' : '确认' }}</span>
    </Button>
  </div>
</template>

<style scoped>
/* 外框/底色/边框/圆角/阴影全部来自 .ntp-root；这里只排一行、定高、收紧内边距 */
.vclip-dock {
  /* 66px = 胶片条 56px + 上下各 4px 内边距 + 1px 边框（用户 2026-10-31：帧图要看清，允许整条撑高） */
  height: 66px;
  width: 100%;
  box-sizing: border-box;
  padding: 4px;
}

/* 快捷键下拉触发器只占内容宽 */
.vclip-help {
  flex: none;
  display: inline-flex;
}

/**
 * 快捷键面板（参考图 2：标题行 + 两列键位表）。
 *
 * 结构照参考图：左边四条「动作 + 键帽」，右边四条把「按住 Shift / 快速调整 / Space / Enter」
 * 放在同一列；中间一条竖分隔线。键帽数值照 ui-style-guide §3.5（22px 高、圆角 6、
 * 2px 底边、等宽字），与参考图里那排灰键帽同一形态。
 */
.vclip-help-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 6px 6px;
  white-space: normal;
}
.vclip-help-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.vclip-help-title {
  color: var(--ui-ink, #18202b);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.2;
}
.vclip-help-close {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  color: var(--ui-ink-dim, #6b7280);
  background: transparent;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.vclip-help-close:hover {
  color: var(--ui-ink, #18202b);
  background: var(--ui-hover, rgb(0 0 0 / 0.06));
}
.vclip-help-close svg {
  width: 14px;
  height: 14px;
}
.vclip-help-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 18px;
  row-gap: 4px;
}
/* 左右两列各自由一条竖线分开（参考图中间那条细线） */
.vclip-help-grid > .vclip-help-item:nth-child(even) {
  position: relative;
  padding-left: 18px;
}
.vclip-help-grid > .vclip-help-item:nth-child(even)::before {
  content: '';
  position: absolute;
  left: 0;
  top: 2px;
  bottom: 2px;
  width: 1px;
  background: var(--ui-line, #e2e5ea);
}
.vclip-help-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 32px;
}
.vclip-help-label {
  color: var(--ui-ink-dim, #6b7280);
  font-size: 12px;
  white-space: nowrap;
}
.vclip-help-keys {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
}
.vclip-help-hint {
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 11px;
}
.vclip-help-keys kbd {
  display: inline-grid;
  place-items: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  box-sizing: border-box;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-bottom-width: 2px;
  border-radius: 6px;
  color: var(--ui-ink, #18202b);
  background: var(--ui-overlay-solid, #fff);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}
</style>
