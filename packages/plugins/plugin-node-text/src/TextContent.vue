<script setup lang="ts">
// TextContent —— text 节点 content 组件（随 plugin-node-text 插件包发布，经 BaseNode 壳的 content 段渲染）。
// 职责：展示文本（带缩放分级 LOD：full → condensed 首行截断 → icon 缩略占位）；双击进入编辑，
// 失焦/回车把改动经 ctx.text.editText 写回内核并落盘。
// 依赖方向：只 import 渲染层的 useCanvasRender()(收口函数)，不反向依赖 demo-web。
// LOD 阈值从 theme-default 的 Config 单一数据源读（textLodIconZoom / titleScaleMinZoom，对齐 v1 core 同名项），
// 经 onChange 订阅实时生效；读不到时回落默认（0.18 / 0.5）。
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { TextNodeService } from './nodeTextPlugin'

const props = defineProps<{ id: string; data: { text?: string } }>()

// 统一渲染上下文经 useCanvasRender() 取(宿主 provide)；ctx 是裸内核上下文(boot 后已就绪，见 CanvasSurface)。
// 根 Context 没有服务属性 Proxy（declare module 只增强类型）；这里用 ctx.get 取 text 服务，避免 ctx.text 运行时为 undefined。
const { ctx, viewport } = useCanvasRender()
function textService() {
  return ctx.get<TextNodeService>('text')
}

const editing = ref(false)
const draft = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
// 本地展示值：init 自 props.data，编辑后本地回显
const shown = ref(props.data.text ?? '')

// —— 缩放分级 LOD 阈值（theme-default Config，经 ctx.settings 实时读）——
type SettingsLike = { get(key: string): unknown; onChange(cb: (key: string, value: unknown) => void): { dispose(): void } }
const numOf = (key: string, fallback: number): number => {
  const v = ctx?.get<{ get(key: string): unknown }>('settings')?.get(key)
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
const titleScaleMinZoom = ref(numOf('titleScaleMinZoom', 0.5))
const textLodIconZoom = ref(numOf('textLodIconZoom', 0.18))
const textSettingOff = ctx?.get<SettingsLike>('settings')?.onChange((key, value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return
  if (key === 'titleScaleMinZoom') titleScaleMinZoom.value = value
  else if (key === 'textLodIconZoom') textLodIconZoom.value = value
})
onBeforeUnmount(() => textSettingOff?.dispose())

// 当前画布缩放（VueFlow viewport 经渲染上下文暴露，响应式）
const zoom = computed(() => Math.max((viewport.value?.zoom ?? 1) || 1, 0.01))
// 分级边界（对齐 v1：full≥max(titleScaleMinZoom,0.2)；icon<max(textLodIconZoom,0.05)；中间=condensed 首行截断）
const fullZoom = computed(() => Math.max(titleScaleMinZoom.value, 0.2))
const iconZoom = computed(() => Math.max(textLodIconZoom.value, 0.05))
const lod = computed<'full' | 'condensed' | 'icon'>(() => {
  const z = zoom.value
  if (z >= fullZoom.value) return 'full'
  if (z < iconZoom.value) return 'icon'
  return 'condensed'
})

function startEdit(): void {
  if (lod.value === 'icon') return // 极小缩放下不进编辑，避免误操作
  editing.value = true
  draft.value = shown.value
  void nextTick(() => inputEl.value?.focus())
}

function commit(): void {
  if (!editing.value) return
  editing.value = false
  const next = draft.value
  if (next !== shown.value) {
    shown.value = next
    textService().editText(props.id, next)
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    commit()
  } else if (e.key === 'Escape') {
    editing.value = false
  }
}

function stop(e: MouseEvent): void {
  e.stopPropagation()
}
onBeforeUnmount(() => {
  if (editing.value) {
    editing.value = false
    const next = draft.value
    if (next !== shown.value) textService().editText(props.id, next)
  }
})
</script>

<template>
  <div class="text-node">
    <div class="body" @dblclick.stop="startEdit" title="双击编辑">
      <!-- icon：极小缩放只显示灰色扫光缩略占位，零文本重绘 -->
      <div v-if="lod === 'icon'" class="text-node-skel" aria-hidden="true" />

      <!-- 编辑态：textarea（full / condensed 均显示真实文本） -->
      <textarea
        v-else-if="editing"
        ref="inputEl"
        v-model="draft"
        class="editor"
        placeholder="输入文本..."
        @blur="commit"
        @keydown="onKeydown"
        @click.stop="stop"
        @mousedown.stop="stop"
      ></textarea>

      <!-- 只读展示：随画布自然缩放；condensed 只显示首行截断 -->
      <div v-else class="preview" :class="{ 'is-condensed': lod === 'condensed' }">{{ shown || '（空）' }}</div>
    </div>
  </div>
</template>

<style scoped>
.text-node {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.body {
  position: relative;
  flex: 1;
  padding: 8px 10px;
  overflow: hidden;
}
.preview {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  line-height: 1.5;
  cursor: text;
}
/* condensed：只显示首行，减少文字重排/绘制面积 */
.preview.is-condensed {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  white-space: normal;
  overflow: hidden;
}
.editor {
  width: 100%;
  height: 100%;
  min-height: 80px;
  resize: none;
  border: 1px solid #2563eb;
  border-radius: 4px;
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
  padding: 4px 6px;
  outline: none;
}
/* icon 模式：整块灰底扫光占位，几乎零重绘 */
.text-node-skel {
  width: 100%;
  height: 100%;
  background: #eceef1;
  position: relative;
  overflow: hidden;
}
.text-node-skel::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -60%;
  width: 45%;
  background: linear-gradient(105deg, transparent 0%, rgba(255, 255, 255, 0.65) 50%, transparent 100%);
  transform: skewX(-18deg);
  will-change: left, transform;
}
</style>
