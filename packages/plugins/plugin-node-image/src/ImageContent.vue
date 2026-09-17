<script setup lang="ts">
/**
 * ImageContent —— image 节点的内容段：只负责展示图片（与两种空态）。
 *
 * 职责边界：
 * - 只画图片与两种空态；端口/标题由 BaseNode 壳负责，这里不碰；
 * - **编辑浮层（裁剪/扩展）不在这里**：它由 overlay 段（ImageFrameOverlay）画在卡片外面。
 *   本组件住在 .v2-content-clip（overflow:hidden）里，浮层挂这儿会被卡片边界裁掉
 *   —— 用户实测报的"裁剪区域被节点切掉"就是这个原因；
 * - 兜底把卡片尺寸对齐到图片（见下方「卡片尺寸兜底」）：每个 image 节点都渲染本组件，
 *   所以"没经我们手"进来的图（旧数据 / 后台 / MCP 建的节点）也能补上正确尺寸；
 * - 加载失败与"正在裁剪"都经同包共享态广播给底部状态栏（不写进 data —— 避免落盘后刷新误报，
 *   也避免纯展示态占据撤销栈）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { endEdit, isEditing } from './cropSession'
import { clearImageBroken, isImageBroken, markImageBroken } from './imageStatus'
import { createImageOps } from './imageOps'
import { followedCardSizePatch, missingCardSizePatch, type CardSizePatch } from './imageFit'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()

/** 图片地址（只认字符串，其余视为无图） */
const imageUrl = computed(() => (typeof props.data?.imageUrl === 'string' ? props.data.imageUrl : ''))
const imageWidth = computed(() => (typeof props.data?.imageWidth === 'number' ? props.data.imageWidth : 0))
const imageHeight = computed(() => (typeof props.data?.imageHeight === 'number' ? props.data.imageHeight : 0))

const broken = computed(() => isImageBroken(props.id))
/**
 * 编辑态（裁剪或扩展）：此时图片必须**完整可见**（contain）。
 *
 * 浮层是按 object-contain 几何算框的（见 mediaFit.computeMediaFit），它底下就是这张图；
 * 若此时仍用平时那套铺满（cover），遮罩会盖错位置、框也会指向错误的像素区域 ——
 * 用户框的这一块与实际算出来的那一块不是同一个地方。
 */
const editing = computed(() => isEditing(props.id))

/** 读/写句柄：读 nodeStore、写 graph（唯一写入口 → 进历史 + 落盘） */
const ops = createImageOps(ctx)

function onImgError(): void {
  markImageBroken(props.id)
}

function onImgLoad(): void {
  clearImageBroken(props.id)
}

// 图片地址一变就重置失败标记（否则换图后状态栏还停在"已失效"）
watch(imageUrl, () => clearImageBroken(props.id))

// ==================== 卡片尺寸兜底 ====================
/**
 * 两张兜底牌，都只在"尺寸确实该改"时才写回，且必须**幂等**：
 * 我们写回尺寸会再触发一次 watch → 若不做"算出来等于当前就不写"的判断，就会自己触发自己转成死循环。
 *
 * 1. 挂载时：卡片尺寸缺失（旧数据 / 后台或 MCP 建的节点 / 加素材新建的节点）→ 按图片补算一次。
 *    尺寸已经在的（含用户手动拖过的）不碰 —— 挂载不该覆盖用户的选择。
 * 2. 图片地址真的变了（别的插件/后台换了图，我们没经手）→ 按新图重算一次。
 *    用户手动拖过尺寸后再换图也照样跟随新图，与 v1 行为一致（不做"手动调过就锁定"）。
 */
function syncCardSize(patch: CardSizePatch | null): void {
  if (!patch) return
  ops.write(
    props.id,
    { ...(ops.read(props.id) ?? props.data), cardWidth: patch.cardWidth, cardHeight: patch.cardHeight },
    patch.size,
  )
}

/**
 * 挂载时补算尺寸 —— **必须等挂载这一帧过去再写**（nextTick），不能同步写在 onMounted 里。
 *
 * 实测（内置浏览器，8/8 稳定复现）：节点**挂载窗口内**发生的 store 写入会被丢掉 ——
 * 内核 data 与宿主渲染态都已经更新成 420×236，但已挂载的那个节点组件收到的 props.data
 * 仍是旧快照（只有 imageUrl/imageWidth/imageHeight，没有 cardWidth），于是卡片读不到尺寸、
 * 停在类型默认的 320×240，16:9 的图被硬塞进 4:3 卡片里左右各裁掉一截。
 * 对照实验：挂载**前**写（建节点时同一次 patch 带上）生效；挂载**后**写也生效；只有正好落在
 * 这次挂载窗口内的写入会丢。
 *
 * 所以这里推迟到 nextTick：让写入落在挂载完成之后，走"挂载后写入"那条能正常传播的路径。
 * 幂等性不受影响：补算函数自己会判断"算出来等于当前就不写"。
 */
onMounted(() => {
  void nextTick(() => syncCardSize(missingCardSizePatch(props.data, ops.fitLimits?.())))
})
watch(imageUrl, () => syncCardSize(followedCardSizePatch(props.data, ops.fitLimits?.())))

// 节点被删/卸载时清掉编辑态，避免共享态留下幽灵 id
onBeforeUnmount(() => endEdit(props.id))
</script>

<template>
  <div class="image-node">
    <div class="frame">
      <img
        v-if="imageUrl && !broken"
        :src="imageUrl"
        alt="节点图片"
        class="img"
        :class="editing ? 'is-fill-contain' : 'is-fill-cover'"
        draggable="false"
        @error="onImgError"
        @load="onImgLoad"
      />
      <div v-else-if="broken" class="empty is-broken">图片已失效（会话级 URL 刷新后不可恢复）</div>
      <div v-else class="empty">（无图片）</div>

    </div>
  </div>
</template>

<style scoped>
.image-node {
  /* 宽高都必须撑满内容区：只给 height:100% 时，作为 flex 子项它会按内容（图片固有比例）收缩 ——
     实测内容区 418 宽而本层只有 416 宽，于是 418 里居中就左右各留 1px
     （用户看到的就是"还有那么一像素的边距"）。垂直方向本来就贴合，所以只有左右能看出来。 */
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 内容区就是裁剪覆盖层的定位基准：position:relative + 尺寸撑满 */
.frame {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.img {
  width: 100%;
  height: 100%;
  display: block;
  /* 卡片选中/拖动时不让浏览器原生拖图打断手势 */
  user-select: none;
  -webkit-user-drag: none;
}

/* 平时：图片铺满节点 —— 卡片尺寸本来就是按图片比例算的，铺满即"节点边界=图片边界"，
   四周不留空隙。用户报的"横屏宽度大几像素 / 竖屏高度大几像素"就是这里用了 contain 造成的：
   卡片是 border-box 且带 1px 边框，边框先吃掉 2px，内容区比算出来的卡片尺寸矮胖一点，
   contain 在比例不吻合的框里必然在某一侧留白。老版 ImageNode 用的也是铺满（object-cover）。 */
.img.is-fill-cover {
  object-fit: cover;
}

/* 裁剪中：切回完整可见（contain）。裁剪覆盖层的遮罩与裁剪框都按 contain 几何计算，
   它底下就是这张图片；此时若仍铺满，遮罩会盖错、裁剪框也会指向错误的像素区域。 */
.img.is-fill-contain {
  object-fit: contain;
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #9ca3af;
  font-size: 13px;
}

/* 失效提示：警告色小字（12px 下限，符合规范的中文最小字号） */
.empty.is-broken {
  color: #b45309;
  font-size: 12px;
  padding: 8px;
  text-align: center;
}
</style>
