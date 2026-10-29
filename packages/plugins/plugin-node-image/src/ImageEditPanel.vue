<script setup lang="ts">
/**
 * ImageEditPanel —— 裁剪 / 扩展模式下的底栏内容（渲染在**同一根默认底栏内部**）。
 *
 * 为什么要它（用户口径 2026-10-29）：
 * 「进入裁剪和扩展的时候也应该进入对应的模式，不然你的底部状态栏会一直存在」。
 *
 * 以前进编辑态只改了**顶栏**（换成 取消 / 比例 / 确认），底栏仍是默认生成 UI ——
 * 一排「参考 / 标记 / 模型下拉 / 大输入框」在看图调框时毫无用处，还挡住画面。
 * 现在裁剪/扩展各是一个带 panel 的底栏动作：一进入就接管底栏，只剩与本模式相关的控件。
 *
 * 外观全部复用默认件：外框（圆角/阴影/宽度/贴边）由 NodeBottomBar 提供，这里只排内容；
 * 按钮按名取 toolbarButton，与画布其它按钮同款。
 */
import { computed } from 'vue'
import { useCanvasRender, useUiComponent, CROP_RATIO_OPTIONS, DEFAULT_CROP_RATIO_VALUE } from '@mini-canvas/canvas-render'
import { editDraft, endEdit, isCropping, isExpanding, setEditDraft } from './cropSession'
import type { Rect } from '@mini-canvas/canvas-render'

const props = defineProps<{
  id: string
  data: Record<string, unknown>
  /** 固定模式（由具体动作传入）：'crop' 裁剪 / 'expand' 扩展；缺省 = 按会话自己判断 */
  mode?: 'crop' | 'expand'
}>()

const { ctx } = useCanvasRender()
const ThemedButton = useUiComponent('toolbarButton')
const Select = useUiComponent('select')

/**
 * 当前在裁剪还是扩展（同一时刻只会有一个）。
 *
 * 判据是**本节点的会话**：底栏面板与顶栏一样只认 props.id。
 * 曾经这里靠 nodeBar 的调用方传的是哪个 actionId 来间接判断 —— 那会在
 * 「先扩展、再对另一个节点裁剪」时把面板标题留在上一个模式上。
 */
const cropping = computed(() => (props.mode ? props.mode === 'crop' : isCropping(props.id)))

/**
 * 会话仍在本节点上（裁剪或扩展任一）。
 *
 * 为什么根元素要拿它当 v-if：本面板可能被底栏挂着而会话已结束（确认/取消后 nodeBar
 * 已退出模式，但 currentId 若仍停在本动作上，currentAction.panel 那条旧路径还会挂它）。
 * 会话不在 → 整个面板渲染成空，与 ui-demo 的 DemoFeaturePanel（v-if="kind"）同款守门。
 */
const stillActive = computed(() => isCropping(props.id) || isExpanding(props.id))
const title = computed(() => (cropping.value ? '裁剪图片' : '扩展图片'))
const hint = computed(() =>
  cropping.value
    ? '拖动方框选择保留范围，确认后按框裁切'
    : '拖动方框向外扩展画布，确认后生成更大的图',
)

/** 比例下拉的选项（只有裁剪用；扩展是往外扩画布，不锁比例） */
const ratioOptions = computed(() => CROP_RATIO_OPTIONS.map((o) => ({ value: o.value, label: o.label })))
const ratioValue = computed(() => (editDraft(props.id)._ratioValue as string) ?? DEFAULT_CROP_RATIO_VALUE)

/**
 * 改比例：只把选择记进会话草稿，**框的调整交给浮层**（它持有当前框）。
 * 与顶栏那份同源 —— 两处改的是同一个草稿字段，不会各存一份。
 */
function onRatioChange(value: string | number): void {
  setEditDraft(props.id, { ...editDraft(props.id), _ratioValue: String(value) })
}

const ICON_CONFIRM =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
const ICON_CANCEL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'

/**
 * 确认：把会话草稿里的框交给命令（命令负责写回 + 退出编辑态 + 退出功能模式）。
 * 与顶栏「确认」同一条命令 —— 谁点的都一样。
 */
function confirmEdit(): void {
  const draft = editDraft(props.id)
  const rect = (cropping.value ? draft._cropRect : draft._expandRect) as Rect | undefined
  if (!rect) return
  ctx
    .get<{ execute(id: string, ...payload: unknown[]): unknown }>('command')
    .execute(cropping.value ? 'image:crop-confirm' : 'image:expand-confirm', { nodeId: props.id, rect })
}

function cancelEdit(): void {
  endEdit(props.id)
}
</script>

<template>
  <div v-if="stillActive" class="iep-root nodrag nopan" data-testid="image-edit-panel">
    <div class="iep-head">
      <span class="iep-name">{{ title }}</span>
      <span class="iep-hint">{{ hint }}</span>
    </div>
    <div class="iep-actions">
      <component :is="ThemedButton || 'button'" type="button" variant="danger" :icon="ICON_CANCEL"
        title="取消编辑" aria-label="取消编辑" @click="cancelEdit">
        取消
      </component>
      <!-- 比例只在裁剪时需要：扩展是往外扩画布，锁比例没有意义 -->
      <div v-if="cropping && Select" class="iep-ratio">
        <component :is="Select" :model-value="ratioValue" :options="ratioOptions"
          dropdown-width="match" placeholder="自由" input-id="image-edit-ratio"
          @update:model-value="onRatioChange" />
      </div>
      <span class="iep-grow" aria-hidden="true" />
      <component :is="ThemedButton || 'button'" type="button" variant="primary" :icon="ICON_CONFIRM"
        title="确认编辑" aria-label="确认编辑" @click="confirmEdit">
        确认
      </component>
    </div>
  </div>
</template>

<style scoped>
/* 只排内容：外框（.nb-root 的圆角/阴影/宽度）由默认底栏提供，这里不另画面板。 */
.iep-root { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.iep-head { display: flex; align-items: baseline; gap: 8px; }
.iep-name { font-size: var(--text-base, 13px); font-weight: 600; color: var(--ui-ink, #18202b); }
.iep-hint { font-size: var(--text-sm, 11px); color: var(--ui-ink-mute, #8c95a3); }
.iep-actions { display: flex; align-items: center; gap: 6px; }
.iep-ratio { width: 120px; }
.iep-grow { flex: 1 1 auto; }
</style>
