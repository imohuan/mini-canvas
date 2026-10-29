<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  /** 快捷键字符串，如 "ctrl+shift+z" */
  keys: string
  /** 唯一 key 前缀，避免在同一父节点上 :key 冲突 */
  idPrefix?: string
  /** 自定义外层类名，便于父级场景微调布局（缺省 'shortcut-keys'，与菜单视觉一致） */
  wrapperClass?: string
  /** 渲染尺寸：'sm'（紧凑，用于行/录制按钮内） / 'md'（默认） */
  size?: 'sm' | 'md'
  /** keys 为空时显示的内容；为空则渲染一个空的 wrapper（用于行布局占位） */
  placeholder?: string
}>()

/**
 * 把快捷键字符串拆成片段数组。
 * 示例：splitShortcutKeys('ctrl+shift+z') // ['ctrl', 'shift', 'z']
 * 拆分规则：以 `+` 分割并去除空白，空段自动丢弃。
 */
function splitShortcutKeys(keys: string): string[] {
  if (!keys) return []
  return keys
    .split('+')
    .map(p => p.trim())
    .filter(Boolean)
}

const parts = computed(() => splitShortcutKeys(props.keys))

function uid(idx: number) {
  return `${props.idPrefix ?? 'k'}-${idx}`
}
</script>

<template>
  <span
    :class="[wrapperClass ?? 'shortcut-keys', size === 'sm' ? 'is-sm' : '']"
  >
    <template v-if="parts.length > 0">
      <template v-for="(part, pIdx) in parts" :key="uid(pIdx)">
        <span class="kbd-chip font-mono">{{ part }}</span>
        <span v-if="pIdx < parts.length - 1" class="kbd-plus">+</span>
      </template>
    </template>
    <template v-else-if="placeholder">
      <span class="kbd-chip kbd-chip-placeholder">{{ placeholder }}</span>
    </template>
  </span>
</template>

<style scoped>
.shortcut-keys {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.kbd-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-bottom-width: 2px;
  border-radius: 6px;
  background: #ffffff;
  color: #374151;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.kbd-plus {
  color: #9ca3af;
  font-size: 10px;
  font-weight: 700;
}

/* sm 尺寸：用于行内或录制按钮中，与父按钮字号协调 */
.is-sm .kbd-chip {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  font-size: 10px;
  border-radius: 5px;
  border-bottom-width: 2px;
}

.is-sm .kbd-plus {
  font-size: 9px;
}

.kbd-chip-placeholder {
  border-style: dashed;
  color: #9ca3af;
  background: rgba(0, 0, 0, 0.02);
}
</style>
