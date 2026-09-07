<script setup lang="ts">
/**
 * ShortcutHelpPanel —— 快捷键帮助面板（overlay 槽 occupant）。
 *
 * 数据源：ctx.get('command').list() 里带 keys 的命令（v2 快捷键唯一数据源）。
 * 显隐：shortcut-manager 服务状态（插件命令 Ctrl+/ 切换同一对象）。
 * 交互：居中弹层，点遮罩/Esc 关闭；搜索框过滤命令标题/键位/分组。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import {
  buildShortcutHelpList,
  toGroupedRows,
  type ShortcutCommand,
  type ShortcutRow,
} from './shortcutGroups'

const { ctx } = useCanvasRender()

const service = ctx.get<{ visible: boolean }>('shortcut-manager')
const visible = computed(() => !!service && service.visible)

const search = ref('')

const rows = computed<ShortcutRow[]>(() => {
  const command = ctx.get<{ list(): ShortcutCommand[] }>('command')
  if (!command) return []
  const all = buildShortcutHelpList(command.list())
  const q = search.value.trim().toLowerCase()
  const filtered = q ? all.filter((i) => i.label.toLowerCase().includes(q) || i.combo.toLowerCase().includes(q) || i.group.toLowerCase().includes(q)) : all
  return toGroupedRows(filtered)
})

function close(): void {
  if (service) service.visible = false
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

/** 把 "mod+shift+z" 拆成键帽（保留 mod 原文，让 CSS 显示为通用修饰） */
function splitCombo(combo: string): string[] {
  return combo.split('+')
}

/** 键帽显示名（别名美化；未知键原样大写首字母） */
function keyLabel(part: string): string {
  const map: Record<string, string> = {
    mod: 'Ctrl/Cmd',
    ctrl: 'Ctrl',
    meta: 'Cmd',
    shift: 'Shift',
    alt: 'Alt',
    escape: 'Esc',
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    backspace: '⌫',
    delete: 'Del',
    enter: 'Enter',
    ' ': 'Space',
  }
  if (map[part.toLowerCase()]) return map[part.toLowerCase()]
  return part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="help-layer" @pointerdown.self="close">
      <div class="help-panel" role="dialog" aria-label="快捷键帮助">
        <div class="help-header">
          <h2>快捷键参考</h2>
          <button class="close-btn" title="关闭 (Esc)" @click="close">✕</button>
        </div>
        <input v-model="search" class="search" placeholder="搜索命令、键位或分组…" autofocus />
        <div class="help-list">
          <template v-for="(row, i) in rows" :key="i">
            <div v-if="row.kind === 'group'" class="group-title">{{ row.group }}</div>
            <div v-else class="help-item">
              <span class="item-label">{{ row.item!.label }}</span>
              <span class="item-keys">
                <template v-for="(part, pi) in splitCombo(row.item!.combo)" :key="pi">
                  <span v-if="pi > 0" class="plus">+</span>
                  <kbd>{{ keyLabel(part) }}</kbd>
                </template>
              </span>
            </div>
          </template>
          <div v-if="rows.length === 0" class="no-result">无匹配结果</div>
        </div>
        <div class="help-footer">按 Ctrl/Cmd + / 或 Esc 关闭</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.help-layer {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.06), rgba(15, 23, 42, 0.18));
  backdrop-filter: blur(2px);
}
.help-panel {
  width: min(620px, 100%);
  max-height: min(80vh, 720px);
  display: flex;
  flex-direction: column;
  padding: 16px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(20px);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.12);
  color: #374151;
}
.help-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 4px 10px;
}
.help-header h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #111827;
}
.close-btn {
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.05);
  color: #6b7280;
  cursor: pointer;
}
.close-btn:hover {
  background: rgba(0, 0, 0, 0.1);
}
.search {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 12px;
  margin-bottom: 10px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  outline: none;
  font-size: 13px;
  background: rgba(0, 0, 0, 0.03);
  color: #111827;
}
.search:focus {
  border-color: rgba(8, 145, 178, 0.5);
}
.help-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.group-title {
  margin: 8px 4px 4px;
  color: #9ca3af;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.03em;
}
.help-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 10px;
  border-radius: 9px;
}
.help-item:hover {
  background: rgba(0, 0, 0, 0.04);
}
.item-label {
  font-size: 13px;
  font-weight: 500;
  color: #111827;
}
.item-keys {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.plus {
  color: #9ca3af;
  font-size: 11px;
}
kbd {
  padding: 2px 7px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-bottom-width: 2px;
  border-radius: 6px;
  background: #fff;
  color: #334155;
  font-size: 11px;
  font-family: inherit;
  font-weight: 600;
}
.no-result {
  padding: 32px 0;
  text-align: center;
  color: #9ca3af;
  font-size: 13px;
}
.help-footer {
  padding-top: 10px;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
  margin-top: 10px;
  color: #9ca3af;
  font-size: 11px;
  text-align: center;
}
</style>
