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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import { ThumbCache, type ThumbResourcePort, type TierImage } from './thumbCanvas'
import { makeThumbRef, thumbRefParam } from './thumbKey'
import { readThumbTiers, resolveThumbTier, thumbTargetFor, thumbTierKeys, type ThumbTierConfig } from './thumbTier'
import { endEdit, isEditing } from './cropSession'
import { isPainting } from './paintSession'
import { clearImageBroken, isImageBroken, markImageBroken } from './imageStatus'
import { createImageOps } from './imageOps'
import { cardSizePatch, followedCardSizePatch, missingCardSizePatch, type CardSizePatch } from './imageFit'
import { readImageSourceFields, resolveImageSrc } from './imageRefs'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx, flow, visibleNodes } = useCanvasRender()
/** 默认主题的统一空状态（按名取；极简宿主没装主题时回落本组件的一行灰字） */
const NodeEmptyState = useUiComponent('nodeEmptyState')

/**
 * 图片地址：**优先按 resourceId 现取**（本地临时 objectURL / 云端资源路由），
 * 迁移期没有可用引用时才用旧 `imageUrl` 兜底。
 *
 * 解析结果只放在本组件内存里，不写回 data —— 节点数据长期只保存 resourceId。
 */
/**
 * 初值直接用旧地址：SSR / 首帧不能等异步 resolve，否则会闪一下空态。
 * 有 resourceId 时下面那次 resolve 回来再替换（旧地址只是过渡显示）。
 */
const resolvedUrl = ref(readImageSourceFields(props.data).legacyUrl)
/** 作废标记：快速换图时，先发的 resolve 不许盖掉后发的 */
let resolveToken = 0
/** 节点上的引用与旧地址（同步可读，供空态判断） */
const sourceFields = computed(() => readImageSourceFields(props.data))

async function refreshResolvedUrl(): Promise<void> {
  const token = ++resolveToken
  // 先回到“当前已知可用地址”，避免解析期间继续显示上一张图
  resolvedUrl.value = sourceFields.value.legacyUrl
  const url = await resolveImageSrc(ctx, props.data)
  if (token !== resolveToken) return
  resolvedUrl.value = url || sourceFields.value.legacyUrl
}

watch(() => [sourceFields.value.resourceId, sourceFields.value.legacyUrl], refreshResolvedUrl, {
  immediate: true,
})

/** 图片地址（解析中 / 都没有时为空串 → 走空态） */
const imageUrl = computed(() => resolvedUrl.value)
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
/** 绘制态也要 contain：笔迹坐标系按显示区算，cover 裁切会让蒙版与原图错位（复核 3） */
const editing = computed(() => isEditing(props.id) || isPainting(props.id))

// ==================== 分档显示（三档缩略图） ====================
/**
 * 第 1 档 = 原图；第 2 / 3 档 = **本插件用 canvas 现画的小图**（见 thumbCanvas）。
 *
 * 为什么在插件里现画而不是让后台生成：canvas 缩放是浏览器原生能力，
 * 而资源库的 put 本来就"落到当前后端"（没装云→本地 IndexedDB；装了云→画布文件夹）——
 * **一份代码两种后端通吃**，于是不需要后台参与，也不需要为基础包开后门（原则：插件只改自己）。
 *
 * 为什么档位是"渲染期选择"而不是节点属性：它跟当前缩放走；写进节点会让每次缩放都改动画布数据、
 * 还占撤销栈。放在这里 = 不动画布数据、旧节点自动具备三档。
 */
const TIER_PREFIX = 'image'
const tierCfg = ref<ThumbTierConfig>(readThumbTiers(TIER_PREFIX, ctx))
// 设置面板改了档位参数要**实时**生效（与 BaseNode 订阅 titleOffset 是同一套方式）
const tierSettingOff = ctx
  ?.get<{ onChange(cb: (key: string, value: unknown) => void): { dispose(): void } }>('settings')
  ?.onChange((key) => {
    if (!thumbTierKeys(TIER_PREFIX).includes(key)) return
    tierCfg.value = readThumbTiers(TIER_PREFIX, ctx)
  })

const zoom = computed(() => Math.max((flow.viewport.value?.zoom ?? 1) || 1, 0.01))
/**
 * 画布最小缩放（设置里的「最小缩放」）：作为**兜底**传给档位判定 ——
 * 缩到画布能到的最小值时必须进第三档，否则用户把第三档阈值配得比它小就永远只有两档
 * （用户实测踩过这个坑）。
 */
const canvasMinZoom = computed(() => ctx?.get<{ get(k: string): unknown }>('settings')?.get('minZoom'))
const tier = computed(() => resolveThumbTier(zoom.value, tierCfg.value, canvasMinZoom.value))

/**
 * 本节点的小图缓存 + 当前展示地址。
 *
 * 流程：档位 > 1 且不在编辑态时，向缓存要一张小图（没有就现画一张）。
 * 画好之前 displaySrc 仍是原图 —— 所以**不会出现空白**，只是晚几帧换成更省的那张。
 * 画不出来（环境不支持 / 解码失败）就一直用原图，行为与这次改动之前一致。
 *
 * 缓存**只放内存**：不写节点数据（那是每次缩放都改画布数据），也不登记进资源服务
 * （宿主会回收"没被节点 resourceId 引用"的资源，登记进去会被反复回收）。
 */
const thumbCache = new ThumbCache()
const tierImage = ref<TierImage | null>(null)
const displaySrc = computed(() => (editing.value ? imageUrl.value : tierImage.value?.url || imageUrl.value))

/**
 * 按当前档位取（或生成）小图。
 *
 * 三个刻意的跳过与保护：
 * - **编辑态**（裁剪 / 扩展）不用也不生成：浮层按原图像素算框，垫小图会让框对不上；
 * - **第 1 档**不生成：目标框就是原尺寸，画一张同样大的图纯属浪费内存（thumbTargetFor 返回 null）；
 * - **可视区外**不生成：解码原图（几 MB）很贵，几十个节点同时解码会把主线程堵住 ——
 *   滚进来再生成（与视频侧同一条保护）。
 * - 生成是异步的，落值前要再确认"档位和源都没变"，否则快速缩放时会把过期的档位图挂上去
 *   （表现为卡在某一档不跟着变）。
 */
watch(
  // ★ **尺寸也必须进依赖**：用户改"最大宽高"时档位并没有变（还在第二档），
  // 只盯档位的话这个 watch 根本不重跑，画面会一直停在改之前那张
  // （2026-10-15 用户实测：「重新设置了最大宽高……它依然使用的是之前的图片」）。
  // 质量同理：它变了也得重新编码一份。
  [tier, imageUrl, editing, () => tierCfg.value.tier2Width, () => tierCfg.value.tier2Height,
   () => tierCfg.value.tier3Width, () => tierCfg.value.tier3Height, () => tierCfg.value.quality],
  () => {
    const wantTier = tier.value
    const src = imageUrl.value
    const box = thumbTargetFor(wantTier, tierCfg.value)
    if (editing.value || !src || !box) {
      tierImage.value = null
      return
    }
    // 可视区闸门（外扩一屏）：看不见的节点不急着解码原图
    if (!visibleNodes(800).some((r) => r.id === props.id)) return
    // 名字 = 「源 + 档位 + 尺寸 + 质量」。四样都进名字，改任何一样都会算出一个新名字，
    // 于是资源库与内存两级缓存同时失效、该重算的重算（见 thumbKey.thumbRefParam 的说明）。
    const ref = makeThumbRef(
      'img',
      src,
      thumbRefParam(wantTier, box.width, box.height, tierCfg.value.quality),
    )
    // 先把旧的清掉：让画面立刻回到原图（而不是继续挂着旧缩略图），
    // 等新的算好再换上去 —— 否则改完设置看起来"没反应"。
    tierImage.value = null
    void thumbCache
      .resolveOrCreate({
        src,
        tier: wantTier,
        box,
        quality: tierCfg.value.quality,
        ...(ref ? { ref } : {}),
        ...(thumbResources() ? { resources: thumbResources()! } : {}),
      })
      .then((made) => {
        // 落值前再确认一次"这一整套参数还是当前这一套"，避免把过期的那张挂上去
        if (tier.value !== wantTier || imageUrl.value !== src || editing.value) return
        const nowBox = thumbTargetFor(tier.value, tierCfg.value)
        if (!nowBox || nowBox.width !== box.width || nowBox.height !== box.height) return
        tierImage.value = made
      })
  },
  { immediate: true },
)

/**
 * 资源库端口（ctx 上的 'resources'）。
 *
 * 取不到（极简宿主 / 单测桩）→ 返回 undefined，缩略图退回"只放内存"：
 * 功能照常，只是换会话要重算一遍 —— 与这次改动之前的行为一致。
 */
function thumbResources(): ThumbResourcePort | undefined {
  const port = ctx?.get<ThumbResourcePort | undefined>('resources')
  return port && typeof port.put === 'function' && typeof port.resolve === 'function' ? port : undefined
}

/** 图片地址一变：旧源的小图全部作废（释放 objectURL），失败标记也清掉 */
watch(imageUrl, (prev) => {
  if (prev) thumbCache.clearSource(prev)
  tierImage.value = null
  clearImageBroken(props.id)
})

/** 读/写句柄：读 nodeStore、写 graph（唯一写入口 → 进历史 + 落盘） */
const ops = createImageOps(ctx)

/**
 * 加载失败：小图是本地现画的、不走网络 —— 能走到这里的一定是原图本身（源地址失效），如实标出来。
 *
 * 之所以不再需要"先判断失败的是不是小图"：画不出来时 displaySrc 压根不会切过去
 * （见上面 watch 里的 made 判空），所以没有"小图 404 被误报成图片失效"这条路。
 */
function onImgError(): void {
  markImageBroken(props.id)
}

function onImgLoad(e: Event): void {
  clearImageBroken(props.id)
  const el = e.target as HTMLImageElement
  if (!el?.naturalWidth || !el?.naturalHeight) return
  // 兜底：卡片尺寸缺失（后台没写 imageWidth/Height 的图，如 MCP/上传加的图）时，
  // 用 `<img>` 量到的真实宽高补一次 —— 需要「量到宽高 + 卡片尺寸」两样一起写，
  // 否则缺了尺寸字段，后面按比例算卡片那步无从下手，卡片会停在 4:3（9:16 竖图被塞成横的）。
  if (positiveNum(props.data?.cardWidth) !== null && positiveNum(props.data?.cardHeight) !== null) return
  const patch = cardSizePatch(el.naturalWidth, el.naturalHeight, ops.fitLimits?.())
  if (!patch) return
  const current = ops.read(props.id) ?? props.data
  // 测量结果不是用户动作：走 measured 写入（落盘、不进撤销栈），否则打开页面就先多一条历史。
  ops.writeMeasured(
    props.id,
    { ...current, imageWidth: el.naturalWidth, imageHeight: el.naturalHeight },
    patch.size,
  )
}

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
  // 只写正式尺寸 size；卡片镜像由 nodeStore 自动补齐（读回当前 data 保留其它字段）
  // 这是按图片比例补算的派生尺寸，不是用户拖拽：走 measured 写入，不占撤销栈。
  ops.writeMeasured(props.id, ops.read(props.id) ?? props.data, patch.size)
}

/** 正有限数才算有值（与 imageFit 内的判断同口径） */
function positiveNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
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
onBeforeUnmount(() => {
  tierSettingOff?.dispose()
  // 本节点的小图全部释放（objectURL 不还回去就是内存泄漏，而这类泄漏从界面上看不出来）
  thumbCache.dispose()
  endEdit(props.id)
  // 「图片已失效」也是模块级共享态：不清的话，同 id 节点重建（撤销删除 / 恢复）
  // 会立刻顶着「图片已失效」的空态，哪怕新图完全正常。
  clearImageBroken(props.id)
})
</script>

<template>
  <div class="image-node">
    <div class="frame">
      <img
        v-if="imageUrl && !broken"
        :src="displaySrc"
        alt="节点图片"
        class="img"
        :class="editing ? 'is-fill-contain' : 'is-fill-cover'"
        draggable="false"
        @error="onImgError"
        @load="onImgLoad"
      />
      <!-- 失效也算空态的一种：只换语义色，布局/图标仍是默认件 -->
      <NodeEmptyState
        v-else-if="broken && NodeEmptyState"
        text="图片已失效"
        description="会话级地址刷新后不可恢复，请重新上传"
        tone="danger"
      />
      <div v-else-if="broken" class="empty is-broken">图片已失效（会话级 URL 刷新后不可恢复）</div>
      <NodeEmptyState
        v-else-if="NodeEmptyState"
        text="（无图片）"
        description="上传一张图片，或把图片节点连进来"
      />
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
  color: var(--canvas-node-text-muted, #9ca3af);
  font-size: 13px;
}

/* 失效提示：警告色小字（12px 下限，符合规范的中文最小字号） */
.empty.is-broken {
  color: var(--ui-warn, #b45309);
  font-size: 12px;
  padding: 8px;
  text-align: center;
}
</style>
