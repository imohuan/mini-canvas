<script setup lang="ts">
/**
 * DemoTopEntry —— 图片顶栏插槽里的一条（同一个按钮组内部）。
 *
 * 两种状态，**同一根顶栏**：
 * - 普通：显示「功能演示」下拉按钮（主题 toolbarDropdown，二级菜单是独立浮层）
 *   + 「对齐」下拉（演示 toolbarDropdown 的 align / placement 配置）；
 * - 功能模式：这根顶栏的内容整体换成该功能自己的按钮（名称 / 动作 / 退出）。
 *
 * 为什么用「同一根栏换内容」而不是再加一条 on:top：
 * 用户口径 2026-10-29：「上下显示了 2 套控制栏……我想要的是只显示一个控制栏」——
 * 功能模式必须是替换，不是叠加。
 */
import { computed, ref } from 'vue'
import { useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import { closeDemoMode, demoMode, openDemoMode } from './demoMode'

interface ToolbarMenuNode {
  key: string
  label: string
  children?: ToolbarMenuNode[]
}

const props = defineProps<{
  nodeId?: string
  data?: Record<string, unknown>
}>()

const { ctx } = useCanvasRender()
const DropdownButton = useUiComponent('toolbarDropdown')
const ThemedButton = useUiComponent('button')

const ICON_DEMO =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>'
const ICON_ALIGN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h10M4 18h13"/></svg>'

const items: ToolbarMenuNode[] = [
  { key: 'action-1', label: '动作一' },
  { key: 'action-2', label: '动作二' },
  {
    key: 'more',
    label: '更多',
    children: [
      { key: 'sub-1', label: '子项 1' },
      { key: 'sub-2', label: '子项 2' },
    ],
  },
  { key: 'mode-a', label: '进入功能模式 A' },
  { key: 'mode-b', label: '进入功能模式 B' },
]

const LABEL = { alpha: '演示功能 A', beta: '演示功能 B' } as const

/**
 * 对齐演示：菜单横向贴在按钮的哪条边。
 * 三种取值分别对应 align=center / start / end —— 这就是 toolbarDropdown 的对齐配置。
 */
const align = ref<'center' | 'start' | 'end'>('center')
const ALIGN_LABEL = { center: '居中', start: '左对齐', end: '右对齐' } as const
const alignItems: ToolbarMenuNode[] = [
  { key: 'center', label: '底部居中（默认）' },
  { key: 'start', label: '底部左对齐' },
  { key: 'end', label: '底部右对齐' },
]

function pickAlign(key: string): void {
  if (key === 'center' || key === 'start' || key === 'end') {
    align.value = key
    notify('演示：菜单改为「' + ALIGN_LABEL[key] + '」')
  }
}

/** 本节点当前的功能模式（null = 普通态） */
const kind = computed(() => {
  const m = demoMode.value
  const id = props.nodeId ?? ''
  return m && id && m.nodeId === id ? m.kind : null
})

function notify(text: string): void {
  ctx.tryGet<{ show?(t: string): void }>('tip')?.show?.(text)
}

function onPick(key: string): void {
  if (key === 'mode-a' || key === 'mode-b') {
    const nodeId = props.nodeId
    if (!nodeId) return
    openDemoMode(nodeId, key === 'mode-a' ? 'alpha' : 'beta')
    // 底栏同时切到该功能（nodeBar 会话：底栏与顶栏共用同一份）
    ctx.tryGet<{ selectMode?(nodeId: string, actionId: string): void } | undefined>('nodeBar')
      ?.selectMode?.(nodeId, 'ui-demo:mode')
    return
  }
  notify('演示：点了「' + key + '」（不做业务）')
}

function exit(): void {
  closeDemoMode()
  const nodeId = props.nodeId
  if (nodeId) ctx.tryGet<{ exitMode?(nodeId: string): void } | undefined>('nodeBar')?.exitMode?.(nodeId)
}

function pickFeature(label: string): void {
  notify('演示：功能栏「' + label + '」（不做业务）')
}
</script>

<template>
  <!-- 普通态：下拉按钮（插在图片按钮组内部） -->
  <component
    v-if="!kind && DropdownButton"
    :is="DropdownButton"
    title="功能演示"
    :icon="ICON_DEMO"
    :items="items"
    @pick="onPick"
  />

  <!-- 对齐演示：同一件 toolbarDropdown，只改 align；菜单里切换，立刻能看出差别。
       放在「功能演示」**前面**：它要是排在最右，菜单会被屏幕右边缘夹住，
       三种对齐看起来都差不多，演示就白搭了（回到根因：这是插件顺序，不是组件问题）。 -->
  <component
    v-if="!kind && DropdownButton"
    :is="DropdownButton"
    :title="'对齐：' + ALIGN_LABEL[align]"
    :icon="ICON_ALIGN"
    :items="alignItems"
    :align="align"
    @pick="pickAlign"
  />

  <!-- 功能模式：同一根顶栏，内容换成该功能自己的按钮 -->
  <template v-else-if="kind">
    <span class="dte-feature-name">{{ LABEL[kind] }}</span>
    <span class="dte-feature-sep" aria-hidden="true" />
    <component :is="ThemedButton || 'button'" type="button" title="功能动作一" aria-label="功能动作一"
      @click="pickFeature('动作一')">动作一</component>
    <component :is="ThemedButton || 'button'" type="button" title="功能动作二" aria-label="功能动作二"
      @click="pickFeature('动作二')">动作二</component>
    <span class="dte-feature-sep" aria-hidden="true" />
    <component :is="ThemedButton || 'button'" type="button" variant="danger" title="退出功能模式"
      aria-label="退出功能模式" @click="exit">退出</component>
  </template>
</template>

<style scoped>
/* 与默认工具栏同一条横排、同一套间距与文字样式（不另起面板） */
.dte-feature-name { padding: 0 4px; font-size: var(--text-base, 13px); font-weight: 600; color: var(--ui-ink, #18202b); white-space: nowrap; }
.dte-feature-sep { width: 1px; height: 16px; margin: 0 2px; background: var(--ui-line, #e2e5ea); }
</style>
