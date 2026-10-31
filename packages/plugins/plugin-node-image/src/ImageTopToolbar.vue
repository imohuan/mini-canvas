<script setup lang="ts">
/**
 * ImageTopToolbar —— 图片节点顶部操作条（**内容**部分）。
 *
 * 定位不在这里：离卡片多远、怎么居中、怎么反缩放，全由节点壳 BaseNode 的上插槽定位层统一负责。
 * 本组件只负责「放哪些按钮、点了干什么」。
 *
 * 布局走 ImageToolbarShell 通用外壳（用户口径 2026-10-30：所有模式同一种胶囊行）。
 */
import { computed, ref } from 'vue'
import { beginCrop, beginExpand, editDraft, endEdit, isCropping, isEditing, isExpanding, setEditDraft } from './cropSession'
import { useCanvasRender, useSoleNodeSelected, useUiComponent, SlotAnchor } from '@mini-canvas/canvas-render'
import { CROP_RATIO_OPTIONS, DEFAULT_CROP_RATIO_VALUE } from '@mini-canvas/canvas-render'
import { createImageOps, uploadImage } from './imageOps'
import { readImageSourceFields } from './imageRefs'
import ImagePaintEntry from './ImagePaintEntry.vue'
import ImageToolbarShell from './ImageToolbarShell.vue'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()
const NodeToolbarButton = useUiComponent('toolbarButton')
const DropdownButton = useUiComponent('toolbarDropdown')
const selected = useSoleNodeSelected(props.id)

const hasImage = computed(() => {
  const { resourceId, legacyUrl } = readImageSourceFields(props.data)
  return resourceId !== '' || legacyUrl !== ''
})
/** 裁剪中：入口按钮隐藏，避免重复进入 */
const cropping = computed(() => isCropping(props.id))
const expanding = computed(() => isExpanding(props.id))
/** 编辑态（裁剪或扩展）：顶栏换成确认/取消，其余入口全部让位 */
const editing = computed(() => isEditing(props.id))
const visible = computed(() => selected.value)

const featureMode = computed(() => {
  try {
    const svc = ctx.tryGet?.<{ inMode?(nodeId: string): boolean } | undefined>('nodeToolbar')
    return Boolean(svc?.inMode?.(props.id))
  } catch {
    return false
  }
})

const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)

const ratioItems = computed(() => CROP_RATIO_OPTIONS.map((o) => ({ key: o.value, label: o.label })))
const ratioValue = computed(() => (editDraft(props.id)._ratioValue as string) ?? DEFAULT_CROP_RATIO_VALUE)

function onRatioChange(key: string): void {
  setEditDraft(props.id, { ...editDraft(props.id), _ratioValue: key })
}

const ICON_UPLOAD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>'
const ICON_CROP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" /></svg>'
const ICON_EXPAND =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'
const ICON_CONFIRM =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
const ICON_CANCEL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'

const ops = createImageOps(ctx)

function openPicker(): void {
  fileInput.value?.click()
}

async function onFileChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files && input.files[0]
  input.value = ''
  if (!file || busy.value) return
  busy.value = true
  try {
    await uploadImage(ops, props.id, file)
  } finally {
    busy.value = false
  }
}

function onCrop(): void {
  beginCrop(props.id)
}

function onExpand(): void {
  beginExpand(props.id)
}

/** 确认编辑：把会话里的草稿交给命令（命令负责写回 + 退出编辑态） */
function confirmEdit(): void {
  const draft = editDraft(props.id)
  const rect = (expanding.value ? draft._expandRect : draft._cropRect) as
    | { x: number; y: number; width: number; height: number }
    | undefined
  if (!rect) return
  ctx
      .get<{ runCommand(id: string, ...payload: unknown[]): unknown }>('canvas')
    .runCommand(expanding.value ? 'image:expand-confirm' : 'image:crop-confirm', { nodeId: props.id, rect })
}

function cancelEdit(): void {
  endEdit(props.id)
}
</script>

<template>
  <div v-if="visible" class="it-root nodrag nopan">
    <input ref="fileInput" class="it-file" type="file" accept="image/*" @change="onFileChange" />

    <!-- 编辑态：只剩确认 / 取消（布局对齐 liblib：取消在最左、比例下拉居中、确认在最右） -->
    <div v-if="editing" class="ntp-root it-root">
      <NodeToolbarButton title="取消编辑" aria-label="取消编辑" variant="danger" :icon="ICON_CANCEL" @click="cancelEdit" />
      <DropdownButton
        v-if="cropping"
        class="it-ratio"
        :title="'比例：' + (ratioItems.find((o) => o.key === ratioValue)?.label ?? '自由')"
        :items="ratioItems"
        @pick="onRatioChange"
      />
      <NodeToolbarButton title="确认编辑" aria-label="确认编辑" variant="primary" :icon="ICON_CONFIRM" @click="confirmEdit">
        确认
      </NodeToolbarButton>
    </div>

    <!--
      正常态：ImageToolbarShell 通用外壳 + 可排序插槽。内置按钮是带 id 的锚点，
      插件条目与它们一起排。功能模式下内置按钮让位（整排归功能模式自己的 topBar）。
    -->
    <ImageToolbarShell
      v-else
      slot-name="image.topToolbar"
      :node-id="props.id"
      :data="props.data"
    >
      <SlotAnchor id="host/upload" :order="100">
        <NodeToolbarButton v-if="!featureMode" title="上传图片" :icon="ICON_UPLOAD" :disabled="busy" @click="openPicker" />
      </SlotAnchor>
      <SlotAnchor v-if="hasImage" id="host/crop" :order="200">
        <NodeToolbarButton v-if="!featureMode" title="裁剪图片" :icon="ICON_CROP" @click="onCrop" />
      </SlotAnchor>
      <SlotAnchor v-if="hasImage" id="host/expand" :order="300">
        <NodeToolbarButton v-if="!featureMode" title="扩展图片" :icon="ICON_EXPAND" @click="onExpand" />
      </SlotAnchor>
      <SlotAnchor v-if="hasImage" id="host/paint" :order="400">
        <ImagePaintEntry :node-id="props.id" :data="props.data" />
      </SlotAnchor>
    </ImageToolbarShell>
  </div>
</template>

<style scoped>
.it-file {
  display: none;
}
</style>
