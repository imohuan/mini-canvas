<script setup lang="ts">
/**
 * PanoramaContent —— 3D 全景预览节点的 content 组件（随插件包发布，经 BaseNode 壳的 content 段渲染）。
 *
 * 对照老版 packages/canvas-core/src/nodes/panorama/PanoramaNode.vue：球体内壁贴一张图（等距柱状全景图），
 * 用相机朝向做"转头"效果。三条能力：
 * - 拖拽转视角（按住画面左右/上下拖动）；
 * - 滚轮缩放（改相机视野角）；
 * - 重置按钮（回到初始朝向）。
 *
 * 两种模式（用户要求："3D 预览节点这个地方也有 2 种模式的，也是双击进入，进入之后可以转动视角，
 * 默认模式下是用来拖拽节点的"）：
 * - **预览模式（默认）**：3D 画面不吃指针事件 → 按住画面拖动 = 拖动节点本身；
 * - **交互模式（双击进入）**：画面接管指针与滚轮 → 拖拽转视角 / 滚轮改视野角 / 重置按钮可用，
 *   且把滚轮拦下来（否则转视角时画布会跟着一起缩放）。Esc 或点画布空白退出，回到可拖节点状态。
 * 判定全在 panoramaMode.ts（纯函数、可单测）；模式会话在 panoramaSession.ts（按 nodeId 记名，
 * **不写 data** —— 写进去会落盘，刷新后一开画布就停在交互模式、连节点都拖不动）。
 *
 * 与老版的差异（v2 分层）：
 * - 不自带顶部工具栏/全屏/下载/上传按钮 —— 工具栏是节点壳的 top-toolbar 段，本包不抢壳的活；
 * - 老版用 data._editing 记"能不能转"（还得靠 sanitizeForSave 手动抠掉才不落盘），v2 换成会话态；
 * - 视角数学挪到 panoramaView.ts（可单测），贴图来源判定挪到 textureSource.ts（可单测）；
 * - 只读渲染上下文经 useCanvasRender() 取（宿主 provide），不反向依赖 demo/宿主。
 *
 * 拆分后的职责（2026-11-03 原样拆分）：
 * - panorama-content/threeState.ts：three 对象与视角状态；
 * - panorama-content/scene.ts：three 初始化、渲染循环、统一资源释放；
 * - panorama-content/useTextureSource.ts：贴图来源与贴图更新；
 * - panorama-content/size.ts：尺寸测量与 ResizeObserver；
 * - panorama-content/events.ts：指针/滚轮/双击/键盘；
 * - panorama-content/fullscreen.ts：全屏时 canvas 搬迁。
 * 入口只做接线，模板、样式与类名保持不变。
 *
 * 资源回收：three 的场景/几何/材质/贴图/渲染器在卸载时逐个 dispose，避免 WebGL 上下文泄漏。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RenderEvents, useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import { isFullscreen, isInteracting, endInteract, resetViewToken } from './panoramaSession'
import { resolvePanoramaSpec } from './panoramaMode'
import { shouldClearTexture, shouldShowTexture } from './textureLifecycle'
import { createPanoramaScene } from './panorama-content/scene'
import { useTextureSource } from './panorama-content/useTextureSource'
import { usePanoramaSize } from './panorama-content/size'
import { usePanoramaEvents } from './panorama-content/events'
import { usePanoramaFullscreen } from './panorama-content/fullscreen'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx, renderEdges, renderNodes } = useCanvasRender()

/**
 * 统一空状态：默认主题登记在 ui 目录的 nodeEmptyState（图片/视频/音频/3D 共用）。
 * 没装主题/极简宿主时为空 → 模板里回落本组件自带的一行提示，不让节点白屏。
 */
const NodeEmptyState = useUiComponent('nodeEmptyState')

/** 画布 DOM 容器（three 的 canvas 挂这里） */
const hostRef = ref<HTMLDivElement | null>(null)
/** 图上屏后置 true，用来收掉"未贴图"的占位与提示 */
const textureLoaded = ref(false)
/** 渲染失败（浏览器不支持 WebGL 等）时降级成文字提示，不让节点白屏 */
const renderError = ref('')
// 交互模式：来自会话（按 nodeId 记名，不写 data —— 写进去会落盘/进历史）
const interacting = computed(() => isInteracting(props.id))
// 全屏查看（f 切换）：同样来自会话
const fullscreen = computed(() => isFullscreen(props.id))
// 当前模式下的行为结论（是否接管指针/滚轮、提示文案、是否显示重置按钮）
const spec = computed(() =>
  resolvePanoramaSpec({
    interactive: interacting.value,
    fullscreen: fullscreen.value,
    hasError: !!renderError.value,
  }),
)

/** 全屏容器（three 的 canvas 在全屏时被搬到这里，退出时搬回节点内） */
const fullscreenHostRef = ref<HTMLDivElement | null>(null)
/** 是否正在拖拽（拖动时给手柄光标/禁用 canvas 原生手势） */
const dragging = ref(false)

/**
 * 当前 canvas 实际所在的容器（在节点内 / 在全屏层）。
 * 尺寸测量与 ResizeObserver 都必须看**真正装着 canvas 的那个** ——
 * 全屏时 canvas 被搬到全屏层，若还量节点内的壳，就会按节点大小渲染一张铺不满的画面。
 */
function activeHost(): HTMLElement | null {
  return fullscreen.value ? fullscreenHostRef.value : hostRef.value
}

/**
 * 读一个主题变量当前的值（three 的 Color / 材质吃不到 CSS 变量，只能在运行时取一次）。
 * 取不到（无 DOM，如单测 SSR）就回落传入的兜底色 —— 与 CSS 里的兜底值同一套。
 */
function themeColor(varName: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback
}
/* 无 DOM 时的兜底色（= node-theme.css 亮色默认值，与各处 CSS 兜底同值） */
const FALLBACK = { surface: '#f3f4f6', border: '#e5e7eb' } // 主题色白名单: 单测 SSR 无 DOM 读不到 CSS 变量，此处只是同值兜底

const size = usePanoramaSize({
  activeHost,
  three: () => three,
})

const events = usePanoramaEvents({
  id: props.id,
  spec: () => spec.value,
  three: () => three,
  dragging,
})

const fullscreenSurface = usePanoramaFullscreen({
  three: () => three,
  activeHost,
  observeSize: size.observeSize,
  syncSize: size.syncSize,
})

const three = createPanoramaScene({
  hostRef,
  containerSize: size.containerSize,
  bindEvents: events.bindEvents,
  observeSize: size.observeSize,
  disconnectSize: size.disconnectSize,
  get updateTexture() {
    return textureSource.updateTexture
  },
  get textureUrl() {
    return textureSource.textureUrl
  },
  renderError,
  themeColor,
  fallback: FALLBACK,
})

const textureSource = useTextureSource({
  id: props.id,
  data: () => props.data,
  ctx,
  renderEdges,
  renderNodes,
  three,
  textureLoaded,
  renderError,
  themeColor,
  fallback: FALLBACK,
})

const { textureUrl, ownImageUrl, hasUpstream } = textureSource
textureSource.watchTextureSource()

/** 空状态判定：地址为空 / 还没加载完 / 渲染失败，三者任一成立都不算"有画面"。
 *  这是用户实测的"上游撤掉后旧图还挂着"的根因 —— 只看加载回调的布尔会漏掉"url 变空"。 */
const hasTexture = computed(() =>
  shouldShowTexture({ url: textureUrl.value, loaded: textureLoaded.value, error: renderError.value }),
)

onMounted(() => {
  textureUrl.value = ownImageUrl.value
  three.initThree()
  window.addEventListener('keydown', events.onKeydown)
})

// 全屏开关（f 命令改会话 → 这里把 canvas 搬进/搬出全屏层）
watch(fullscreen, async () => {
  await nextTick() // 等全屏容器渲染出来再搬
  fullscreenSurface.relocateSurface()
})

// 「重置视角」命令信号（r 命令 → token +1 → 这里把相机拉回初始朝向）。
// 用 watch 而不是让命令直接调组件：命令与组件互不认识对方，靠会话计数器通信。
watch(
  () => resetViewToken(props.id),
  () => events.onReset(),
)

// 上游/自身图片变化 → 换贴图（画面容器由 textureUrl 同步决定，三处状态一起跟）
watch(ownImageUrl, (url) => {
  // 地址是空态判定的唯一真相，换图时必须同步它，再让 three 去加载。
  // 过去这里只调 updateTexture(url)，textureUrl 永远停在挂载时的那份值上：
  // 图片是异步解析的，挂载时它还是空串 → 球体早就贴上了图，空状态却一直盖在上面。
  const previous = textureUrl.value
  textureUrl.value = url
  // 地址被撤掉时主动清掉旧纹理（这是"上游断开但画面还留着图"的直接修法）。
  if (shouldClearTexture(previous, url)) textureLoaded.value = false
  if (three.renderer.value) textureSource.updateTexture(url)
})


// 点画布空白退出交互（与 v1 的 paneClick 收起 _editing 同义）。
// 用内核事件桥而不是自己监听 document：宿主已经把"点空白"归一成 RenderEvents.PaneClick。
// 注意内核 on 返回的是 Disposable（不是取消函数），收尾要调 .dispose()。
const paneClickSub = ctx.on(RenderEvents.PaneClick, () => {
  if (interacting.value) events.exitInteract()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', events.onKeydown)
  paneClickSub.dispose()
  endInteract(props.id)
  three.disposeThree()
})
</script>

<template>
  <div class="pano" :data-mode="spec.mode" @dblclick.stop="events.onDblClick">
    <!-- three 的 canvas 挂这里。
         三个 VueFlow 保留类名把画布手势挡在外面：nodrag 不拖节点、nopan 不拖画布、
         nowheel 不缩放画布（否则滚轮会被 VueFlow 的 d3-zoom 吃掉，本节点的缩放失效）。
         事件里另做了 stopPropagation，与类名形成双保险。

         **两种模式的差别就在这三个类名有没有上**：
         - 预览模式（默认）什么都不加 → 指针事件穿透，按住画面 = 拖节点；
         - 交互模式（双击进入）加齐三个 → 拖拽转视角、滚轮改视野角、不拖节点/不拖画布/不缩画布。
         用类名切换而不是重绑事件，是为了让"模式"这一件事只有一个开关（spec），
         不给"某个监听忘了跟着切"留机会。 -->
    <div
      ref="hostRef"
      class="pano-surface"
      :class="{ 'nodrag nopan nowheel': spec.capturePointer }"
      :style="spec.capturePointer ? { cursor: events.dragging.value ? 'grabbing' : 'grab' } : { pointerEvents: 'none' }"
    />

    <!-- 没贴图时的空状态：默认只显示「空」，不再要求用户输入 URL。
         默认主题装了就复用统一的 NodeEmptyState（与图片/视频/音频同款）；
         极简宿主没装主题时回落一行灰字，保证仍有可读反馈。 -->
    <!-- 空态完全走默认组件的默认 UI：不传自定义图标，不传 tone，观感与图片/视频/音频一致 -->
    <NodeEmptyState
      v-if="!hasTexture && NodeEmptyState"
      text="（无全景图）"
      :description="hasUpstream ? '上游图片暂时不可用' : '把图片节点连进来，就能查看 360° 全景'"
    />
    <div v-else-if="!hasTexture" class="pano-empty">
      <span class="pano-empty-text">{{ hasUpstream ? '上游图片暂时不可用' : '（无全景图）' }}</span>
    </div>

  </div>

  <!-- 全屏查看（f 切换）：three 的 canvas 在进入时被搬进这里，退出时搬回节点内。
       样式刻意保持纯黑无装饰 —— 用户要求删掉常驻提示（"会遮挡视线"），画面之外不放任何东西。 -->
  <Teleport to="body">
    <div v-if="fullscreen" ref="fullscreenHostRef" class="pano-fullscreen nodrag nopan nowheel" @dblclick.stop />
  </Teleport>
</template>

<style scoped>
/* 视觉对齐 docs/design/ui-style-guide.md：灰阶承载层级、圆角 8、图标按钮 28~32、动效 .18s + reduced-motion 降级 */
.pano {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 8px;
  /* 不铺底色：空态/未出图时让壳的内容底透出来（--card-content-surface，亮色白 / 暗色深）。
     这里曾经写 var(--canvas-node-surface)（卡片表面灰），于是 3D 空态比同类节点灰一档 */
}
.pano-surface {
  position: absolute;
  inset: 0;
  touch-action: none;
}

/* 空态（主题没装统一空状态件时的兜底） */
.pano-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  pointer-events: none;
  padding: 12px;
  text-align: center;
}
.pano-empty-text {
  color: var(--canvas-node-text-muted, #9ca3af);
  /* 中文正文最低 12px */
  font-size: 12px;
  line-height: 1.5;
}

/* 全屏层（f 切换）：铺满视口、纯黑无装饰。
   里面不放任何提示/按钮 —— 用户明确要求删掉常驻文案（"会遮挡视线"），
   全屏时唯一的操作入口是键盘（f 切回、r 重置、Esc 退出）。 */
.pano-fullscreen {
  position: fixed;
  inset: 0;
  /* z-index 走画布层叠带变量（--layer-modal） */
  z-index: var(--layer-modal, 100000);
  background: #000; /* 主题色白名单: 全屏查看层刻意纯黑无装饰 */
  touch-action: none;
}

</style>
