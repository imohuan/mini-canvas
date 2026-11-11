<script setup lang="ts">
/**
 * StyleLibraryContent —— 风格库的**内容本体**（没有外壳）。
 *
 * 为什么单独拆出来（用户口径 2026-11-06）：
 * 内容只该有一份；弹窗与项目页只是两种不同的容器。
 * - StyleLibraryOverlay：遮罩 + 居中面板 + 标题栏，把本组件放进去；
 * - 项目页「风格库」页签：直接把本组件铺满主内容区，没有遮罩、没有圆角卡片、没有展开动画。
 *
 * 这里只管：取服务、收藏、详情、加入画布。显隐由外壳决定。
 */
import { computed, ref, watch } from 'vue'
import { useCanvasContextOrRender, useUiComponent } from '@plume-canvas/canvas-render'
import type { StyleCard } from '../data/types'
import type { LibraryService } from '../data/store'
import { UI_GALLERY, UI_DETAIL } from '../names'
import { useStyleItem } from '../useStyleItem'
import { styleItemDepsOf } from '../useStyleItemPorts'
import { styleItemPlacementOf, focusStyleNode } from '../stylePlacement'
import { useCanvasGate } from '../useCanvasGate'

const emit = defineEmits<{
  /** 某条素材已成功加入画布（弹窗外壳据此关掉自己；项目页页签忽略即可） */
  (e: 'used'): void
}>()

/**
 * 两个状态（用户口径 2026-11-06）：
 * - mode='canvas'：画布模式，素材可以「加入画布」，卡片加号与详情页「使用」都显示；
 * - mode='project'：项目模式，没有画布，这些按钮整颗不渲染（不是置灰）。
 * 外壳是否显示由容器决定：弹窗看 state.open，项目页页签常显。
 */
const props = withDefaults(defineProps<{ mode?: 'canvas' | 'project' }>(), { mode: 'canvas' })
const showCanvasActions = computed(() => props.mode === 'canvas')
/** 项目页整页：画廊不要自带白底，融进页面背景；弹窗里仍用白底做独立面板。 */
const surface = computed(() => (props.mode === 'project' ? 'transparent' : 'panel'))

const { ctx } = useCanvasContextOrRender()
/** 「能不能加入画布」：doc + media 两件都在才行，缺哪件给哪句原因。 */
const gate = useCanvasGate(ctx, '素材')

/** 广场正文 / 详情：按名从 ui 目录取；缺件时退化为不渲染 */
const GalleryComp = useUiComponent(UI_GALLERY)
const DetailComp = useUiComponent(UI_DETAIL)

const svc = ctx.get<LibraryService>('style-library')
const s = svc.state

/** 收藏集合：全局持久化（localStorage）—— 与具体画布无关 */
const STAR_KEY = 'style-library:starred'
const starred = ref<Array<number | string>>(readStars())
function readStars(): Array<number | string> {
  try {
    const raw = localStorage.getItem(STAR_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
function persistStars(): void {
  try {
    localStorage.setItem(STAR_KEY, JSON.stringify(starred.value))
  } catch {
    /* 配额/隐私模式：收藏本次会话仍生效，静默 */
  }
}
function onToggleStar(item: StyleCard): void {
  const i = starred.value.indexOf(item.id)
  if (i >= 0) starred.value.splice(i, 1)
  else starred.value.push(item.id)
  persistStars()
}

/** 详情 */
const detailItem = ref<StyleCard | null>(null)
const detailStarred = computed(() => (detailItem.value ? starred.value.includes(detailItem.value.id) : false))
function onOpenDetail(item: StyleCard): void {
  detailItem.value = item
}

/** 正在提交的素材（防连点重复建节点） */
const using = ref(false)
/** 正在提交的那条素材 id（只让那张卡的按钮变灰，不影响别的卡） */
const usingIds = ref<Array<number | string>>([])
/** 加入失败的原因（显示在面板里 —— 规范 §1.2：只在控制台 warn 不算降级） */
const useError = ref('')

/**
 * 使用：把选中的图**存进画布资源库**（resources.put）再建节点，并用风格名命名。
 *
 * 为什么不直接写风格库地址（2026-10-22 用户口径）：
 * 素材库目录一改 / 插件没装，画布上的图就全裂；且节点本来只该保存持久资源引用。
 * 落进资源库后，图片字节归本画布所有，与素材库是否在线无关。
 */
async function onUse(item: StyleCard, index: number): Promise<void> {
  if (!gate.canUse.value) {
    useError.value = gate.reason.value
    return
  }
  const url = item.images[index] ?? item.cover
  // 落点 = **当前看得见的那块区域**的中心（平移/缩放后跟着走），见 stylePlacement 的门牌
  const position =
    styleItemPlacementOf(ctx) ?? { x: 160 + Math.round(Math.random() * 240), y: 120 + Math.round(Math.random() * 200) }
  // 多图时带序号（第 1 张不加，避免"名 1"这种啰嗦标题）
  const label = item.images.length > 1 && index > 0 ? item.name + ' ' + (index + 1) : item.name
  if (using.value) return
  using.value = true
  usingIds.value = [item.id]
  useError.value = ''
  try {
    const result = await useStyleItem(styleItemDepsOf(ctx), { url, label }, position)
    if (!result.ok) {
      console.warn('[style-library] 加入画布失败：' + result.reason + '（' + url + '）')
      useError.value = result.message
      return
    }
    focusStyleNode(
      {
        selection: ctx.tryGet('selection'),
        view: ctx.tryGet('view'),
      },
      result.nodeId,
    )
    detailItem.value = null
    emit('used')
  } finally {
    using.value = false
    usingIds.value = []
  }
}

/** 关闭 / 重开时收起详情；这里不碰外壳的显隐。 */
watch(
  () => s.open,
  (v) => {
    if (!v) {
      detailItem.value = null
      useError.value = ''
    }
  },
)
</script>

<template>
  <div class="slc">
    <!-- 加入画布失败：必须看得见（规范 §1.2） -->
    <p v-if="useError" class="slc-use-error" role="alert">{{ useError }}</p>

    <div class="slc-body">
      <component
        :is="GalleryComp"
        v-if="GalleryComp"
        :service="svc"
        :starred="starred"
        :columns="s.zoom + 2"
        :using-ids="usingIds"
        :use-disabled="!gate.canUse.value"
        :use-disabled-reason="gate.reason.value"
        :show-canvas-actions="showCanvasActions"
        :surface="surface"
        @toggle-star="onToggleStar"
        @open-detail="onOpenDetail"
        @use="onUse"
      />
    </div>

    <!-- 详情：自己 Teleport 到 body，两种容器下都是同一种浮现 -->
    <component
      :is="DetailComp"
      v-if="DetailComp"
      :item="detailItem"
      :starred="detailStarred"
      :show-canvas-actions="showCanvasActions"
      @close="detailItem = null"
      @toggle-star="onToggleStar"
      @use="onUse"
    />
  </div>
</template>

<style scoped>
/* 铺满交给外层：弹窗给固定高度，项目页给整块主内容区。 */
.slc {
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 0;
}
.slc-body {
  display: flex;
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 0;
}
.slc-use-error {
  flex: none;
  margin: 8px 16px 0;
  padding: 8px 10px;
  border: 1px solid var(--ui-danger, #ef4444);
  border-radius: 8px;
  font-size: 12px;
  color: var(--ui-danger, #ef4444);
}
</style>
