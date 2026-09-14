<script setup lang="ts">
/**
 * ImageTopToolbar —— 图片节点顶部操作条（**仅选中时显示**）。
 *
 * 段组件从 BaseNode 只拿到 `{ id, data }`，选中态经 useSoleNodeSelected（内核 selection）订阅 ——
 * 语义是"**恰好**选中一个节点且就是我"：多选时上控制栏与下控制栏一起收起，不会并排浮出多份。
 *
 * 定位：绝对定位浮在卡片上方 —— 卡片是 overflow:visible，节点根是 flex column，
 * 若不脱离文档流就会把节点撑高、内容被顶下去。这里用 `bottom: calc(100% + Npx)`
 * 贴在卡片上缘之外，不占布局高度。N 由设置面板的「布局/控制栏 → 上控制栏偏移」决定
 * （useToolbarOffsets 读配置并订阅变化，改完立刻生效；读不到回落 6）。
 *
 * 屏幕尺寸恒定：操作条自己 scale(1/zoom) 反缩放，缩小时按钮不会被压成一条缝
 * （与 v1 NodeToolbar 的观感一致）。
 *
 * 数值全部照 docs/design/ui-style-guide.md：图标按钮 32×32 / 圆角 8 / `--fill-subtle` 底 /
 * hover 升 `--fill-active` + 文字转深 / 纯图标按钮带 title + aria-label / focus-visible 青环 /
 * 动效 0.15–0.18s + prefers-reduced-motion 降级。
 */
import { computed, ref } from 'vue'
import {
  useVueFlow,
  useCanvasRender,
  useSoleNodeSelected,
  useToolbarOffsets,
  toolbarOffsetStyle,
} from '@mini-canvas/canvas-render'
import { beginCrop, isCropping } from './cropSession'
import { createImageOps, uploadImage } from './imageOps'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()
const vf = useVueFlow()
// 单选才显示（多选时上下控制栏全部收起）：见文件头说明
const selected = useSoleNodeSelected(props.id)

/** 上控制栏离卡片上边的距离（设置面板可调；改完立即生效，卸载自动退订） */
const offsets = useToolbarOffsets()

/** 有没有图：没有图时裁剪入口无意义，直接不渲染（而不是渲一个点了没反应的按钮） */
const hasImage = computed(() => typeof props.data?.imageUrl === 'string' && props.data.imageUrl !== '')
/** 裁剪中：入口按钮隐藏，避免重复进入 */
const cropping = computed(() => isCropping(props.id))
const visible = computed(() => selected.value && !cropping.value)

/** 反缩放：抵住画布缩放，让操作条在屏幕上大小恒定；同时用 translateX(-50%) 自居中（不依赖按钮个数） */
const zoom = computed(() => Math.max(vf.viewport.value?.zoom || 1, 0.01))
const barStyle = computed(() => ({
  // 贴边距离来自配置（对象展开合并：不能把下面的反缩放 transform 覆盖掉）
  ...toolbarOffsetStyle('top', offsets.value.top),
  transform: 'translateX(-50%) scale(' + (1 / zoom.value) + ')',
  transformOrigin: 'center bottom',
}))

const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)

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
  <div v-if="visible" class="it-root nodrag nopan" :style="barStyle">
    <input ref="fileInput" class="it-file" type="file" accept="image/*" @change="onFileChange" />

    <button
      class="it-btn"
      type="button"
      title="上传图片"
      aria-label="上传图片"
      :disabled="busy"
      @click="openPicker"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    </button>

    <button
      v-if="hasImage"
      class="it-btn"
      type="button"
      title="裁剪图片"
      aria-label="裁剪图片"
      @click="onCrop"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 2v14a2 2 0 0 0 2 2h14" />
        <path d="M18 22V8a2 2 0 0 0-2-2H2" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
/* 浮在卡片上缘之外：不参与节点 flex 布局，所以不会撑高节点。
   贴边距离由内联 style 覆盖（配置驱动），这里只保留一个读不到配置时的兜底值。 */
.it-root {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 6px);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08);
  z-index: 30;
  white-space: nowrap;
}

.it-file {
  display: none;
}

/* 图标按钮：32×32 / 圆角 8 / 灰阶底 / hover 加深并转深色文字 */
.it-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.04);
  color: #6b7280;
  cursor: pointer;
  transition:
    background-color 0.18s cubic-bezier(0.34, 1.56, 0.64, 1),
    color 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.it-btn svg {
  width: 16px;
  height: 16px;
}

.it-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.06);
  color: #111827;
}

.it-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.it-btn:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: 1px;
}

.it-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
  .it-btn {
    transition: none !important;
  }
  .it-btn:active:not(:disabled) {
    transform: none;
  }
}
</style>
