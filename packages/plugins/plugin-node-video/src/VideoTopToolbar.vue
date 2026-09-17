<script setup lang="ts">
/**
 * VideoTopToolbar —— 视频节点顶部操作条（**内容**部分）。
 *
 * 定位不在这里：离卡片多远、怎么居中、怎么反缩放，全由节点壳 BaseNode 的上插槽定位层统一负责
 * （与图片节点同约定）。本组件只负责「放哪些按钮、点了干什么」。
 *
 * **两套按钮，按会话态切换**（用户要求「确认按钮应该放在上下控制栏」）：
 * - 平时：上传 / 剪辑 / 裁剪 / 扩展 / 截图 / 下载（以及裁过/剪过后的「恢复」）；
 * - 编辑态（正在裁剪或扩展）：只剩 **取消** 与 **确认** —— 编辑时其它入口都没有意义，
 *   留着反而容易误点（一边调框一边点到下载）。这一条同时解决了「浮层里不该有按钮」的问题：
 *   浮层只负责画框，按钮永远在控制栏这个固定位置上。
 */
import { computed, ref } from 'vue'
import { useCanvasRender, useSoleNodeSelected } from '@mini-canvas/canvas-render'
import { NodeToolbarButton } from '@mini-canvas/plugin-theme-default'
import { beginOverlay, endOverlay, isCropping, isClipping, overlayDraft } from './videoSession'
import { createVideoOps, uploadVideo } from './videoOps'
import type { Rect } from './videoCrop'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()
const selected = useSoleNodeSelected(props.id)

/** 有没有视频：没有就只留「上传」 */
const hasVideo = computed(() => typeof props.data?.videoUrl === 'string' && props.data.videoUrl !== '')
/** 正在裁剪画面：此时顶栏换成确认/取消 */
const editing = computed(() => isCropping(props.id))
const clipping = computed(() => isClipping(props.id))
const visible = computed(() => selected.value && !clipping.value)

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

/* 图标内联 SVG（viewBox 24、线性、currentColor；尺寸由按钮决定） */
const ICON_UPLOAD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'
const ICON_CLIP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M4 17h16"/><path d="M8 4v16"/><path d="M16 4v16"/></svg>'
const ICON_CROP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>'
const ICON_FRAME =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>'
const ICON_DOWNLOAD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
const ICON_RESET =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/></svg>'
const ICON_CONFIRM =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
const ICON_CANCEL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'

/** 读/写句柄：读 nodeStore、写 graph（唯一写入口 → 进历史 + 落盘）；与命令侧同一份接线 */
const ops = createVideoOps(ctx)

const cropped = computed(() => Boolean(props.data?.cropRect))
const clipped = computed(() => props.data?.clipStart !== undefined || props.data?.clipEnd !== undefined)

function run(id: string, payload: Record<string, unknown> = {}): void {
  ctx.get<{ execute(id: string, ...p: unknown[]): unknown }>('command').execute(id, { nodeId: props.id, ...payload })
}

function openPicker(): void {
  fileInput.value?.click()
}

async function onFileChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files && input.files[0]
  // 先清空 input：同一文件二次选择也要能触发 change
  input.value = ''
  if (!file || uploading.value) return
  uploading.value = true
  try {
    await uploadVideo(ops, props.id, file, undefined, (url, blob) => {
      // 视频走 objectURL：登记进宿主资源表，删除节点后由引用扫描延迟回收（与图片同语义）
      const resources = ctx.get<{ register(i: { kind: string; url: string; resource: unknown }): string } | undefined>(
        'resources',
      )
      return resources?.register({ kind: 'video', url, resource: blob })
    })
  } finally {
    uploading.value = false
  }
}

/** 确认编辑：把会话里的草稿交给命令（命令负责写回 + 退出编辑态） */
function confirmEdit(): void {
  // 草稿在会话态里（拖拽期间不写库）
  const draft = overlayDraft(props.id)
  const cropRect = draft._cropRect as Rect | undefined
  if (!cropRect) return
  run('video.cropConfirm', { rect: cropRect })
}

function cancelEdit(): void {
  endOverlay(props.id)
}
</script>

<template>
  <div v-if="visible" class="vt-root nodrag nopan">
    <input ref="fileInput" class="vt-file" type="file" accept="video/*" @change="onFileChange" />

    <!-- 编辑态：只剩确认 / 取消（用户要求「确认按钮应该放在上下控制栏」）。
         取消在前、确认在后，与全项目「左侧取消、右侧青色确认」的顺序一致。 -->
    <template v-if="editing">
      <NodeToolbarButton title="取消编辑" aria-label="取消编辑" variant="danger" :icon="ICON_CANCEL" @click="cancelEdit" />
      <NodeToolbarButton title="确认编辑" aria-label="确认编辑" variant="primary" :icon="ICON_CONFIRM" @click="confirmEdit">
        确认
      </NodeToolbarButton>
    </template>

    <!-- 平时：上传 / 剪辑 / 裁剪 / 扩展 / 截图 / 下载 / 恢复 -->
    <template v-else>
      <NodeToolbarButton title="上传视频" :icon="ICON_UPLOAD" :disabled="uploading" @click="openPicker" />

      <template v-if="hasVideo">
        <NodeToolbarButton title="剪辑时长" :icon="ICON_CLIP" @click="beginOverlay(props.id, 'clip')" />
        <NodeToolbarButton title="裁剪画面" :icon="ICON_CROP" @click="beginOverlay(props.id, 'crop')" />
        <NodeToolbarButton title="截取当前帧" :icon="ICON_FRAME" @click="run('video.captureFrame')" />
        <NodeToolbarButton title="下载视频" :icon="ICON_DOWNLOAD" @click="run('video.download')" />
        <NodeToolbarButton v-if="cropped" title="恢复整幅画面" :icon="ICON_RESET" @click="run('video.resetCrop')" />
        <NodeToolbarButton v-if="clipped" title="恢复整段时长" :icon="ICON_RESET" @click="run('video.resetClip')" />
      </template>
    </template>
  </div>
</template>

<style scoped>
/* 只管「排一行 + 一个白底小面板」；位置（贴边/居中/反缩放）由壳的上插槽定位层给。
   数值照 ui-style-guide：圆角 10（内嵌行档）、发丝边、e2 柔影。 */
.vt-root {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08);
  white-space: nowrap;
}

.vt-file {
  display: none;
}
</style>
