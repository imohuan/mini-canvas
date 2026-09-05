<script setup lang="ts">
// BaseNode —— 节点"壳"（批次B：对齐主项目 Decoration/BaseNode 外壳，金标准 core-node-contract §2）。
// 职责：
//   1. 消费 NodeRenderer：给 node.type 路由 content/title/top/bottom 段组件渲染（保留 M2 契约）。
//   2. 卡片外观对齐主项目：圆角卡片 + 反向缩放标题条(nodeLabel = data.label ?? type 名)。
//   3. 标题就地重命名：双击标题/F2 进编辑，Enter/blur 提交、Esc 取消（经 NODE_WRITE_KEY 写回内核）。
//   4. 选中环 + hover 端口醒目：.is-selected/.is-pointer-hovered 状态 class 驱动 CSS。
//   5. LOD：zoom < nodeLodLowDetailZoom(0.4) 时简化渲染（去阴影/标题），降低缩放重绘成本。
// 与 v1 差异：读 canvas.state.core.* 的配置改为 props/默认值；连接 3D 反馈/浮动端口(MovingHandle)留批次 C。
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  useVueFlow,
  Position,
  NODE_REGISTRY_KEY,
  NODE_WRITE_KEY,
  CANVAS_PARAMS_KEY,
} from '@mini-canvas/canvas-render'
import type { NodeWrite, CanvasParams } from '@mini-canvas/canvas-render'
import MovingHandle from './MovingHandle.vue'
import { resolveSegment } from '@mini-canvas/canvas-core-v2'

const props = defineProps<{ id: string; type: string; data: Record<string, unknown>; selected?: boolean }>()
// 节点类型都是本组件(VueFlow nodeTypes 全指到 BaseNode)，透传的 selected 等内部 prop 不落到根
defineOptions({ inheritAttrs: false })

const registry = inject(NODE_REGISTRY_KEY)
if (!registry) throw new Error('[BaseNode] 缺少节点注册表（宿主未 provide NODE_REGISTRY_KEY）')
// 写回回调：宿主提供才能就地编辑标题；缺省 null = 标题只读（安全降级）
const nodeWrite = inject(NODE_WRITE_KEY, null)

const vf = useVueFlow()

// —— 缩放 / LOD ——
const zoom = computed(() => Math.max(vf.viewport.value?.zoom || 1, 0.01))
const LOW_DETAIL_ZOOM = 0.4
const TITLE_MIN_ZOOM = 0.5
const TITLE_OFFSET = 6
const lowDetail = computed(() => zoom.value < LOW_DETAIL_ZOOM)
const titleScale = computed(() => 1 / Math.max(zoom.value, TITLE_MIN_ZOOM))

// —— 节点标题 ——
// v2 节点 data 通常无 label（title 段即 type 名展示），标题优先 data.label ?? type
const nodeLabel = computed(() => {
  const label = props.data?.label as string | undefined
  return label || props.type || '节点'
})

// —— 就地重命名状态 ——
const isEditingTitle = ref(false)
const draftTitle = ref('')
const titleInputRef = ref<HTMLInputElement | null>(null)
const skipBlurCommit = ref(false)

watch(
  () => props.selected,
  (sel) => {
    if (sel) document.addEventListener('keydown', onTitleEditKeydown)
    else {
      document.removeEventListener('keydown', onTitleEditKeydown)
      if (isEditingTitle.value) cancelTitleEdit()
    }
  },
  { immediate: true },
)

function onTitleEditKeydown(e: KeyboardEvent) {
  if (e.key !== 'F2' || isEditingTitle.value) return
  const t = e.target as HTMLElement | null
  if (!t) return
  const tag = t.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) return
  if (!nodeWrite) return // 无写回能力则只读，不进入编辑
  startTitleEdit()
}

function startTitleEdit() {
  if (isEditingTitle.value) return
  draftTitle.value = nodeLabel.value
  isEditingTitle.value = true
  nextTick(() => {
    titleInputRef.value?.focus()
    titleInputRef.value?.select()
  })
}

function commitTitleEdit() {
  if (skipBlurCommit.value) {
    skipBlurCommit.value = false
    return
  }
  const value = draftTitle.value.trim()
  const next = value || undefined
  if (nodeWrite) nodeWrite(props.id, next === undefined ? { label: undefined } : { label: next })
  isEditingTitle.value = false
}

function cancelTitleEdit() {
  skipBlurCommit.value = true
  isEditingTitle.value = false
}

onBeforeUnmount(() => document.removeEventListener('keydown', onTitleEditKeydown))

// —— 该 type 的段组件句柄（未注册段 = undefined → 不渲染该段 / 用默认）——
const content = computed(() => resolveSegment(registry, props.type, 'content'))
const customTitle = computed(() => resolveSegment(registry, props.type, 'title'))
const topToolbar = computed(() => resolveSegment(registry, props.type, 'top-toolbar'))
const bottomToolbar = computed(() => resolveSegment(registry, props.type, 'bottom-toolbar'))
const editable = computed(() => Boolean(nodeWrite))

// —— hover 状态（控制端口醒目与阴影） ——
const isHovered = ref(false)

// —— 浮动端口(MovingHandle)尺寸：宿主注入(CANVAS_PARAMS_KEY) 可调；缺省回落 contract §0 默认 ——
const DEFAULT_HANDLE: CanvasParams = {
  handleRadius: 86,
  handleRestOffset: 36,
  handleCursorGap: 24,
  handleButtonSize: 32,
  handleOverlap: 16,
}
const injectedParams = inject(CANVAS_PARAMS_KEY, null)
const handleParams = computed<CanvasParams>(() => injectedParams ?? DEFAULT_HANDLE)
// 端口可见：非低细节 且 (hover 或 选中) → 圆球浮出（真实连接点始终在，mouse 靠近 zone 即可连）
const shouldShowHandles = computed(() => !lowDetail.value && (isHovered.value || props.selected))

// —— 卡片实测宽度（画布坐标）→ 标题反缩宽度 ——
const cardEl = ref<HTMLElement | null>(null)
const cardClientW = ref(0)
let ro: ResizeObserver | null = null
onMounted(() => {
  if (cardEl.value) {
    const measure = () => (cardClientW.value = cardEl.value!.getBoundingClientRect().width)
    measure()
    ro = new ResizeObserver(measure)
    ro.observe(cardEl.value)
  }
})
onBeforeUnmount(() => ro?.disconnect())

// 卡片画布坐标宽 = DOM 宽 / zoom
const cardCanvasW = computed(() => cardClientW.value / zoom.value)
// 标题反缩后屏幕宽应==卡片屏幕宽：DOM 宽(画布单位) = cardCanvasW * max(zoom,minZoom)
const titleCanvasWidth = computed(() => Math.max(cardCanvasW.value * Math.max(zoom.value, TITLE_MIN_ZOOM), 40))
// 标题定位：卡片上缘外，向右(相对卡片左)缩一点；transform 反缩，origin left bottom
const titleStyle = computed(() => ({
  transform: `scale(${titleScale.value})`,
  transformOrigin: 'left bottom',
  width: `${titleCanvasWidth.value}px`,
  bottom: `calc(100% + ${TITLE_OFFSET * titleScale.value}px)`,
}))
</script>

<template>
  <div
    class="v2-node"
    :class="{
      'is-selected': selected,
      'is-pointer-hovered': isHovered,
      'is-low-detail': lowDetail,
    }"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <!-- 顶部工具栏（注册了才渲染） -->
    <div v-if="topToolbar" class="top-toolbar">
      <component :is="topToolbar" :id="id" :data="data" />
    </div>

    <div ref="cardEl" class="v2-card">
      <!-- 浮动端口：MovingHandle(圆球随鼠标浮出)。target 左 / source 右 -->
      <MovingHandle
        id="target"
        type="target"
        :position="Position.Left"
        :visible="shouldShowHandles"
        :radius="handleParams.handleRadius"
        :rest-offset="handleParams.handleRestOffset"
        :cursor-gap="handleParams.handleCursorGap"
        :button-size="handleParams.handleButtonSize"
        :overlap="handleParams.handleOverlap"
        @hover="isHovered = $event"
      />
      <MovingHandle
        id="source"
        type="source"
        :position="Position.Right"
        :visible="shouldShowHandles"
        :radius="handleParams.handleRadius"
        :rest-offset="handleParams.handleRestOffset"
        :cursor-gap="handleParams.handleCursorGap"
        :button-size="handleParams.handleButtonSize"
        :overlap="handleParams.handleOverlap"
        @hover="isHovered = $event"
      />

      <!-- 反向缩放标题条（双击/F2 就地重命名，need writeback；自定义 title 段优先） -->
      <div
        v-if="!lowDetail"
        class="v2-title nodrag nopan"
        :style="titleStyle"
        @dblclick.stop="editable && startTitleEdit()"
        @pointerdown.stop
      >
        <component :is="customTitle" v-if="customTitle" :id="id" :data="data" />
        <template v-else>
          <input
            v-if="isEditingTitle"
            ref="titleInputRef"
            v-model="draftTitle"
            class="v2-title-input"
            type="text"
            @keydown.enter.prevent="commitTitleEdit"
            @keydown.escape.prevent="cancelTitleEdit"
            @blur="commitTitleEdit"
            @pointerdown.stop
            @dblclick.stop
          />
          <span v-else class="v2-title-label">{{ nodeLabel }}</span>
        </template>
      </div>

      <!-- content（核心；未注册给占位） -->
      <div class="v2-content">
        <component :is="content" v-if="content" :id="id" :data="data" />
        <div v-else class="v2-content-missing">（type "{{ type }}" 未注册 content 段）</div>
      </div>
    </div>

    <!-- 底部工具栏（注册了才渲染） -->
    <div v-if="bottomToolbar" class="bottom-toolbar">
      <component :is="bottomToolbar" :id="id" :data="data" />
    </div>
  </div>
</template>

<style scoped>
/* —— 节点根 —— */
.v2-node {
  position: relative;
  display: flex;
  flex-direction: column;
  font-family: system-ui, sans-serif;
}

/* —— 卡片 —— */
.v2-card {
  position: relative;
  box-sizing: border-box;
  min-width: 120px;
  min-height: 40px;
  border: 1px solid rgba(31, 41, 55, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  transition: border-color 160ms ease, box-shadow 160ms ease;
}
.v2-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}
.v2-node.is-low-detail .v2-card {
  transition: none;
  box-shadow: none;
}

/* 选中态：蓝边 + 外侧 2px 环 */
.v2-node.is-selected .v2-card {
  border-color: #3b82f6;
  box-shadow:
    0 0 0 2px rgba(59, 130, 246, 0.35),
    0 2px 10px rgba(59, 130, 246, 0.15);
}

/* —— 端口：浮动圆球由 MovingHandle 自管（锚点 1px 常驻 + 半圆 zone + 圆球） —— */

/* —— 标题条：绝对定位在卡片上缘外，反向缩放 —— */
.v2-title {
  position: absolute;
  z-index: 3;
  left: -1px;
  cursor: text;
  display: flex;
  align-items: center;
}
.v2-title-label {
  display: inline-block;
  max-width: 100%;
  padding: 0 2px;
  font-size: 12px;
  line-height: 16px;
  color: #6b7280;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.v2-node.is-selected .v2-title-label {
  color: #2563eb;
}

/* 标题就地重命名输入框 */
.v2-title-input {
  box-sizing: border-box;
  width: 100%;
  min-width: 40px;
  max-width: 100%;
  height: 16px;
  margin: 0;
  padding: 0 6px;
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  color: #374151;
  background: #fff;
  border: 1px solid rgba(59, 130, 246, 0.8);
  border-radius: 5px;
  outline: none;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
}

/* —— content —— */
.v2-content {
  display: flex;
  align-items: stretch;
  border-radius: inherit;
  overflow: hidden;
}
.v2-content-missing {
  color: #b45309;
  padding: 8px;
  font-size: 12px;
}

/* LOD 时隐标题条 */
.v2-node.is-low-detail .v2-title {
  display: none;
}
</style>
