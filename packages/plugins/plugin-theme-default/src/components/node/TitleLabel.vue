<script setup lang="ts">
/**
 * TitleLabel —— 节点标题文案（就地改名）。
 *
 * 关键决策一：编辑用 **contenteditable**，不换成 <input>。
 * 换 <input> 会换掉元素并改变行高（实测：普通态标题条 20px，编辑态变 16px 且下移 4px），
 * 卡片会跳一下。这里**始终是同一个元素**，只切 contenteditable 与编辑态样式，高度天然不变。
 *
 * 关键决策二：文本由本组件**命令式写入**，模板里不写文本节点。
 * 若用插值/Vue 持有文本子节点，任何一次重渲染都可能把用户正在打的内容覆盖回旧值
 * （实测被 patch 回旧文案）。模板留空 → Vue 没有文本子节点可 patch → 编辑期间 DOM 完全归用户所有。
 *
 * 关键决策三：编辑中的草稿存 draft，重挂载/重渲染后能原样恢复，不丢用户输入。
 *
 * 状态机（是否在编辑、提交后写哪）由父组件 BaseNode 持有；这里只发 commit / cancel 意图。
 */
import { nextTick, onMounted, ref, watch } from 'vue'
import { normalizeTitleText, resolveTitleText } from './titleEdit'

const props = defineProps<{
  label?: string
  editing?: boolean
}>()

const emit = defineEmits<{
  commit: [value: string]
  cancel: []
}>()

const el = ref<HTMLElement | null>(null)
/** 编辑中的草稿（进入编辑时的原文 → 用户输入实时更新）；Esc 用它还原、重挂载用它恢复 */
const draft = ref('')

/** 把文本写进 DOM（只在真的不同时才写，避免打断输入法/光标） */
function syncText(): void {
  const node = el.value
  if (!node) return
  const next = resolveTitleText(Boolean(props.editing), props.label, draft.value)
  if (node.textContent !== next) node.textContent = next
}

/** 焦点 + 全选：进入编辑即全选，直接打字就是替换原标题 */
function focusAndSelectAll(node: HTMLElement): void {
  node.focus({ preventScroll: true })
  if (typeof window === 'undefined') return
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  range.selectNodeContents(node)
  sel.removeAllRanges()
  sel.addRange(range)
}

/** 用户输入：只记草稿，**不**回写 DOM（回写会导致光标跳到末尾） */
function onInput(): void {
  if (!props.editing) return
  draft.value = el.value?.textContent ?? ''
}

watch(
  () => props.editing,
  (on, was) => {
    if (on) {
      draft.value = props.label ?? ''
      void nextTick(() => {
        syncText()
        const node = el.value
        if (node) focusAndSelectAll(node)
      })
      return
    }
    if (was) void nextTick(syncText) // 退出编辑 → 把（可能已归一化的）label 刷回 DOM
  },
)

// 非编辑态跟随外部 label 变化（如热重载/undo 改了标题），编辑态不动 DOM
watch(
  () => props.label,
  () => {
    if (!props.editing) void nextTick(syncText)
  },
)

// 首次挂载若已处于编辑态（例如重挂载），用草稿恢复，不丢用户输入
onMounted(() => void nextTick(syncText))

function commit(): void {
  if (!props.editing) return
  emit('commit', normalizeTitleText(el.value?.textContent ?? ''))
}

function cancel(): void {
  if (!props.editing) return
  const node = el.value
  if (node) node.textContent = props.label ?? ''
  emit('cancel')
}

function onKeydown(e: KeyboardEvent): void {
  // 回车 = 提交（标题单行，不换行）；Esc = 取消还原
  if (e.key === 'Enter') {
    e.preventDefault()
    commit()
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    cancel()
  }
}

/** 粘贴只取纯文本并收敛成一行，避免多行内容把标题条撑破 */
function onPaste(e: ClipboardEvent): void {
  e.preventDefault()
  if (typeof window === 'undefined') return
  const text = normalizeTitleText(e.clipboardData?.getData('text/plain') ?? '')
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
  onInput()
}
</script>

<template>
  <div
    ref="el"
    class="title-label"
    :class="{ 'is-editing': editing }"
    :contenteditable="editing ? 'true' : 'false'"
    :spellcheck="false"
    @input="onInput"
    @keydown="onKeydown"
    @paste="onPaste"
    @blur="commit"
    @pointerdown.stop
  ></div>
</template>

<style scoped>
.title-label {
  display: block;
  max-width: 100%;
  min-width: 0;
  padding: 0 2px;
  font-size: 12px;
  line-height: 16px;
  color: var(--canvas-node-text-muted, #6b7280);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  outline: none;
}

/*
 * 编辑态下边框用 inset box-shadow 画，不用 border：
 * border 会占布局把标题条顶高 1px，正是"破坏高度"的老问题；box-shadow 不参与布局，高度零影响。
 */
.title-label.is-editing {
  color: var(--canvas-node-text-strong, #111827);
  box-shadow: inset 0 -1px 0 0 var(--canvas-node-border-selected, rgb(17 24 39 / 0.85));
  cursor: text;
  user-select: text;
  -webkit-user-select: text;
}
</style>
