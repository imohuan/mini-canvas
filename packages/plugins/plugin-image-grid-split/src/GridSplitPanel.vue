<script setup lang="ts">
/**
 * GridSplitPanel —— 切分模式的底栏（nodeToolbar 模式的 bottomBar）。
 *
 * 外观照抄图片绘制模式（用户口径 2026-10-30 "参考我的图片绘制模式"）：
 * 外壳是主题的 `.ntp-root` 胶囊（与节点顶栏同一个 token 套装：白底、1px 线、10px 圆角、
 * 主题阴影、4px 内边距），里面一行按钮全部按名取主题件，不自绘圆角/颜色/高度。
 *
 * 按钮顺序照参考图（用户三张截图）：
 *   × 宫格切分 | 已选择 N 项 | 创建分镜组 | HD 高清放大 ▾ | 发送到画布
 */
import { computed } from 'vue'
import { useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import { endSplit, splitState } from './splitSession'
import { publishCells, publishDepsOf } from './publish'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()
const Button = useUiComponent('toolbarButton')
const Dropdown = useUiComponent('toolbarDropdown')

const state = computed(() => splitState(props.id))
const selectedCount = computed(() => state.value?.selected.size ?? 0)
const publishing = computed(() => state.value?.publishing ?? false)

const ICON_EXIT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
const ICON_STORYBOARD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/></svg>'
const ICON_HD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M7 15V9M7 12h3M10 15V9"/><path d="M14 15V9h2a3 3 0 0 1 0 6z"/></svg>'
const ICON_SEND =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h12"/><path d="M12 6l6 6-6 6"/><path d="M18 4h2v16h-2"/></svg>'

/** 高清放大的下拉项（暂未实现，只做入口与说明，点击给提示） */
const hdItems = [
  { key: 'hd:2x', label: '2× 放大（暂未实现）' },
  { key: 'hd:4x', label: '4× 放大（暂未实现）' },
]

function notify(text: string): void {
  ctx.tryGet<{ show?(t: string): void }>('tip')?.show?.(text)
}

function exit(): void {
  endSplit(props.id)
  ctx.tryGet<{ exit?(nodeId: string): void } | undefined>('nodeToolbar')?.exit?.(props.id)
}

function onHdPick(): void {
  notify('高清放大暂未实现')
}

async function publish(kind: 'canvas' | 'storyboard'): Promise<void> {
  const s = state.value
  if (!s || publishing.value) return
  const deps = publishDepsOf(ctx)
  if (!deps) {
    notify('发布不可用：当前宿主缺少数据层服务')
    return
  }
  const ids = [...s.selected].sort((a, b) => a - b)
  if (ids.length === 0) {
    notify('先勾选要发送的格子（点图片上的格子）')
    return
  }
  const result = await publishCells(deps, props.id, s.rows, s.cols, ids, kind)
  if (!result.ok) {
    notify(result.reason || '发送失败')
    return
  }
  notify(kind === 'storyboard'
    ? (result.containerId ? '分镜组已创建（' + result.count + ' 格）' : '已发送 ' + result.count + ' 格，打组失败')
    : '已发送 ' + result.count + ' 格到画布')
}
</script>

<template>
  <!-- ntp-root = 主题胶囊（与图片顶栏/绘制模式同一个壳），不另画面板 -->
  <div v-if="state" class="ntp-root gsp-root nodrag nopan" data-testid="grid-split-panel">
    <!-- 退出 + 名称 -->
    <component :is="Button || 'button'" type="button" variant="danger" :icon="ICON_EXIT" title="退出宫格切分" aria-label="退出宫格切分" @click="exit" />
    <span class="gsp-title">宫格切分</span>

    <span class="gsp-sep" aria-hidden="true" />

    <!-- 已选择计数（参考图：已选择 9 项） -->
    <span class="gsp-count" data-testid="grid-split-count">已选择 {{ selectedCount }} 项</span>

    <span class="gsp-sep" aria-hidden="true" />

    <!-- 创建分镜组 -->
    <component
      :is="Button || 'button'"
      type="button"
      :icon="ICON_STORYBOARD"
      :disabled="publishing"
      title="对选中的格子创建分镜组（组内可拖拽排序）"
      aria-label="创建分镜组"
      @click="publish('storyboard')"
    >创建分镜组</component>

    <!-- 高清放大（下拉，暂未实现） -->
    <component
      v-if="Dropdown"
      :is="Dropdown"
      :icon="ICON_HD"
      title="高清放大"
      aria-label="高清放大"
      :items="hdItems"
      @pick="onHdPick"
    >高清放大</component>
    <component v-else :is="Button || 'button'" type="button" :icon="ICON_HD" title="高清放大（暂未实现）" aria-label="高清放大" disabled>高清放大</component>

    <span class="gsp-sep" aria-hidden="true" />

    <!-- 发送到画布（主按钮，最右） -->
    <component
      :is="Button || 'button'"
      type="button"
      variant="primary"
      :icon="ICON_SEND"
      :disabled="publishing"
      title="把选中格子的图片发送到画布，并放进一个分组节点里"
      aria-label="发送到画布"
      @click="publish('canvas')"
    >发送到画布</component>
  </div>
</template>

<style scoped>
/* 外框由主题 .ntp-root 提供；这里只补"一行排开、不换行"的排布细节 */
.gsp-root {
  width: max-content;
  max-width: min(92vw, 900px);
}

/* 名称：与按钮同高，字号/颜色走 token */
.gsp-title {
  font-size: var(--text-base, 13px);
  font-weight: 600;
  color: var(--ui-ink, #18202b);
  line-height: 1;
  white-space: nowrap;
}

/* 竖分隔线：与参考图里按钮之间的那条细线一致 */
.gsp-sep {
  width: 1px;
  height: 18px;
  background: var(--ui-line, #e2e5ea);
  flex: 0 0 auto;
  margin: 0 2px;
}

/* 计数：弱化色，不抢主按钮 */
.gsp-count {
  font-size: var(--text-sm, 12px);
  color: var(--ui-ink-dim, #6b7280);
  line-height: 1;
  white-space: nowrap;
  padding: 0 2px;
}
</style>
