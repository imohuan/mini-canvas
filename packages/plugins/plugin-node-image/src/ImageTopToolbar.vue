<script setup lang="ts">
/**
 * ImageTopToolbar —— 图片节点顶部操作条（**内容**部分）。
 *
 * 定位不在这里：离卡片多远、怎么居中、怎么反缩放，全由节点壳 BaseNode 的上插槽定位层统一负责
 * （用户要求"定位交给 BaseNode 而不是单独的组件"）。本组件只负责"放哪些按钮、点了干什么"，
 * 因此它是一段**普通流式内容**，自己不再写 position / transform。
 *
 * 选中态也不在这里：上插槽整体由壳按"框选中/多选收起、否则各段自己看选中态"的规则显隐。
 */
import { computed, ref } from 'vue'
import { useCanvasRender, useSoleNodeSelected } from '@mini-canvas/canvas-render'
import { NodeToolbarButton } from '@mini-canvas/plugin-theme-default'
import { beginCrop, isCropping } from './cropSession'
import { createImageOps, uploadImage } from './imageOps'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()
// 显隐仍归本段自己判断（"恰好选中一个且是我"）：壳负责位置，插件负责"我该不该出现"。
// 壳另外还会在框选手势/多选时整体压掉上插槽。
const selected = useSoleNodeSelected(props.id)

/** 有没有图：没有图时裁剪入口无意义，直接不渲染（而不是渲一个点了没反应的按钮） */
const hasImage = computed(() => typeof props.data?.imageUrl === 'string' && props.data.imageUrl !== '')
/** 裁剪中：入口按钮隐藏，避免重复进入 */
const cropping = computed(() => isCropping(props.id))
const visible = computed(() => selected.value && !cropping.value)

const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)

/* 图标内联 SVG（与节点类型注册的 icon 同源写法；作为常量放脚本里比塞进属性里可读） */
const ICON_UPLOAD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>'
const ICON_CROP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" /></svg>'

/** 读/写句柄：读 nodeStore、写 graph（唯一写入口 → 进历史 + 落盘）；与命令侧同一份接线 */
const ops = createImageOps(ctx)

function openPicker(): void {
  fileInput.value?.click()
}

async function onFileChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files && input.files[0]
  // 先清空 input：同一文件二次选择也要能触发 change
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
</script>

<template>
  <div v-if="visible" class="it-root nodrag nopan">
    <input ref="fileInput" class="it-file" type="file" accept="image/*" @change="onFileChange" />

    <NodeToolbarButton
      title="上传图片"
      :icon="ICON_UPLOAD"
      :disabled="busy"
      @click="openPicker"
    />

    <NodeToolbarButton
      v-if="hasImage"
      title="裁剪图片"
      :icon="ICON_CROP"
      @click="onCrop"
    />
  </div>
</template>

<style scoped>
/* 只管"排一行 + 一个白底小面板"；位置（贴边/居中/反缩放）由壳的上插槽定位层给。 */
.it-root {
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

.it-file {
  display: none;
}
</style>
