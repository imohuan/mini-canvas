<script setup lang="ts">
/**
 * GridSplitPanel —— 切分模式的底栏（nodeToolbar 模式的 bottomBar）。
 *
 * 外观照抄图片绘制模式（用户口径 2026-10-30 "参考我的图片绘制模式"）：
 * 外壳是主题的 `.ntp-root` 胶囊（与节点顶栏同一个 token 套装：白底、1px 线、10px 圆角、
 * 主题阴影、4px 内边距），里面一行按钮全部按名取主题件，不自绘圆角/颜色/高度。
 *
 * 按钮顺序（用户口径 2026-10-30：删除高清放大）：
 *   × 宫格切分 | 已选择 N 项 | 创建分镜组 | 发送到画布
 */
import { computed } from 'vue'
import { useCanvasRender, useUiComponent, ToolbarIcon } from '@mini-canvas/canvas-render'
import { beginPublish, endPublish, endSplit, splitState } from './splitSession'
import { finishSplitPublish, publishCells, publishDepsOf } from './publish'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()
const Button = useUiComponent('Button')
const state = computed(() => splitState(props.id))
const selectedCount = computed(() => state.value?.selected.size ?? 0)
const publishing = computed(() => state.value?.publishing ?? false)

const ICON_EXIT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
const ICON_STORYBOARD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/></svg>'
const ICON_SEND =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h12"/><path d="M12 6l6 6-6 6"/><path d="M18 4h2v16h-2"/></svg>'

function exit(): void {
  endSplit(props.id)
  ctx.tryGet<{ exit?(nodeId: string): void } | undefined>('nodeToolbar')?.exit?.(props.id)
}

async function publish(kind: 'canvas' | 'storyboard'): Promise<void> {
  const s = state.value
  if (!s || publishing.value) return
  // 防双击：真正置 publishing 锁（以前只读 state.publishing，却没人写它）。
  if (!beginPublish(props.id)) return
  const deps = publishDepsOf(ctx)
  if (!deps) {
    endPublish(props.id)
    return
  }
  const ids = [...s.selected].sort((a, b) => a - b)
  if (ids.length === 0) {
    endPublish(props.id)
    return
  }
  let result: Awaited<ReturnType<typeof publishCells>>
  try {
    result = await publishCells(deps, props.id, s.rows, s.cols, ids, kind)
  } catch {
    endPublish(props.id)
    return
  }
  if (!result.ok) {
    endPublish(props.id)
    return
  }
  // 用户口径 2026-11-02：建节点成功就退出切分，恢复默认状态栏。
  // 先解发布锁再退出：退出会清会话，锁要跟着一起消失，不能把“正在发布”带到下一次。
  endPublish(props.id)
  finishSplitPublish(
    { endSplit, toolbar: ctx.tryGet<{ exit?(nodeId: string): void } | undefined>('nodeToolbar') },
    props.id,
    true,
  )
}
</script>

<template>
  <!-- ntp-root = 主题胶囊（与图片顶栏/绘制模式同一个壳），不另画面板 -->
  <div v-if="state" class="ntp-root gsp-root nodrag nopan" data-testid="grid-split-panel">
    <!-- 退出 + 名称 -->
    <Button class="mck-toolbar-btn mck-toolbar-btn--danger is-icon-only" variant="destructive" size="sm" type="button"
      title="退出宫格切分" aria-label="退出宫格切分" @click="exit">
      <ToolbarIcon :icon="ICON_EXIT" />
    </Button>
    <span class="gsp-title">宫格切分</span>

    <span class="gsp-sep" aria-hidden="true" />

    <!-- 已选择计数（参考图：已选择 9 项） -->
    <span class="gsp-count" data-testid="grid-split-count">已选择 {{ selectedCount }} 项</span>

    <span class="gsp-sep" aria-hidden="true" />

    <!-- 创建分镜组 -->
    <Button class="mck-toolbar-btn" variant="ghost" size="sm" type="button"
      :disabled="publishing"
      title="对选中的格子创建分镜组（组内可拖拽排序）"
      aria-label="创建分镜组"
      @click="publish('storyboard')">
      <ToolbarIcon :icon="ICON_STORYBOARD" />
      <span class="mck-toolbar-label">创建分镜组</span>
    </Button>

    <span class="gsp-sep" aria-hidden="true" />

    <!-- 发送到画布（主按钮，最右） -->
    <Button class="mck-toolbar-btn mck-toolbar-btn--primary" variant="default" size="sm" type="button"
      :disabled="publishing"
      title="把选中格子的图片发送到画布，并放进一个分组节点里"
      aria-label="发送到画布"
      @click="publish('canvas')">
      <ToolbarIcon :icon="ICON_SEND" />
      <span class="mck-toolbar-label">发送到画布</span>
    </Button>
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
  font-size: var(--ui-text-base, 13px);
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
  font-size: var(--ui-text-sm, 12px);
  color: var(--ui-ink-dim, #6b7280);
  line-height: 1;
  white-space: nowrap;
  padding: 0 2px;
}
</style>
