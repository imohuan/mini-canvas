<script setup lang="ts">
/**
 * AudioTopToolbar —— 音频节点顶部操作条（**内容**部分）。
 *
 * 定位不在这里：离卡片多远、怎么居中、怎么反缩放，全由节点壳 BaseNode 的上插槽定位层统一负责
 * （与图片/视频节点同一份约定）。本组件只负责"放哪些按钮、点了干什么"，
 * 因此它是一段**普通流式内容**，自己不再写 position / transform。
 *
 * 为什么把「上传音频」从卡片空态搬到这条栏上（用户口径 2026-10-14）：
 * 原话「我希望把上传按钮放在顶部菜单栏中。你可以参考一下图片或视频的上传功能」。
 * 图片/视频节点都是**卡片里只显示空态文案（（无图片）/（无视频）），上传入口固定在上控制栏**；
 * 音频节点此前是"空态里长一个带文字的上传按钮"，三者的入口位置不一致。
 * 搬上来之后三种节点同一条规矩：上控制栏负责"放素材"，卡片内部只负责"显示素材"；
 * 顺带也补上了以前没有的能力 —— 已经有音频的节点也能从这里**换**一段（此前只有空态才有入口）。
 *
 * 选中态也不在这里：上插槽整体由壳按"框选中/多选收起、否则各段自己看选中态"的规则显隐。
 */
import { computed, ref } from 'vue'
import { useCanvasRender, useSoleNodeSelected, useUiComponent } from '@mini-canvas/canvas-render'
import { createAudioOps, defaultTransform, uploadAudio } from './audioOps'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()
// 设计系统件按名取（§4.5 目录）：换主题插件时这里一行不改，按钮整体换成新主题的。
// 缺目录（宿主没装登记 ui 的主题）时 undefined + warn（见 useUiComponent）。
const NodeToolbarButton = useUiComponent('toolbarButton')
// 显隐归本段自己判断（"恰好选中一个且是我"）：壳负责位置，插件负责"我该不该出现"。
const selected = useSoleNodeSelected(props.id)

const visible = computed(() => selected.value)

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

/** 图标内联 SVG（与节点类型注册的 icon / 图片·视频顶栏同款写法：viewBox 24、线性、currentColor） */
const ICON_UPLOAD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'

/** 读/写句柄：读 nodeStore、写 graph（唯一写入口 → 进历史 + 落盘）；与命令侧同一份接线 */
const ops = createAudioOps(ctx)

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
    // 资源登记（put → resolve）在 createAudioOps 里接线，节点里写的是资源库地址、不是临时 objectURL
    await uploadAudio(ops, props.id, file, defaultTransform)
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <div v-if="visible" class="ntp-root at-root nodrag nopan">
    <input ref="fileInput" class="at-file" type="file" accept="audio/*" @change="onFileChange" />

    <NodeToolbarButton title="上传音频" :icon="ICON_UPLOAD" :disabled="uploading" @click="openPicker" />
  </div>
</template>

<style scoped>
/* 容器（排一行 + 一块面板）由全局 `.ntp-root` 提供（canvas-render 的 ui-theme.css）——
   位置（贴边/居中/反缩放）由壳的上插槽定位层给，本组件只管内容。 */

.at-file {
  display: none;
}
</style>
