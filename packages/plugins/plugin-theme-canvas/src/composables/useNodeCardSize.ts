/**
 * useNodeCardSize —— 卡片固定尺寸 + 右下角拖拽 resize（移植自 v1 Decoration/BaseNode 的内置 resize 逻辑）。
 *
 * 尺寸唯一来源：`node.size`（用户 2026-11-14 拍板）。卡片宽高由外层（VueFlow 投影的 size）
 * 决定，这里只负责 resize 拖拽会话；不再读 data.cardWidth/cardHeight。
 *
 * 尺寸换算（2026-09-28 修）：拖拽中把"指针 + 起手抓点偏移"经 **当前视口**（toFlow）换算成画布坐标，
 * 再与起手画布角点求差 —— **不**用"屏幕位移 ÷ 当前 zoom"（后者只在缩放不变时成立，
 * 拖拽途中缩放一变就与鼠标脱手）。另：滚轮缩放时常没有 pointermove，需要 refreshSize() 补算。
 * 结束经 nodeWrite 写回（触发 nodeStore 订阅 → 渲染态自动刷新，无需手动 updateNode/map）。
 *
 * 拖拽监听（修复）：move/up **绑到全局 document**，而不是手柄元素自己身上。
 * 原实现绑元素 + 依赖 setPointerCapture，但捕获不总成立（实测 hasPointerCapture 恒 false），
 * 指针一离开手柄元素就收不到 move → "拖一半断掉"。会话逻辑见 resizeDragSession.ts（可单测）。
 *
 * 拖柄显示门：**类型级 resizable 能力**(useNodeCapability 读 nodeStore.types[type].resizable；
 * true = 自由拖拽，'width'/'height'/'aspect' = 限定方向) **或** 节点实例 data.resizable === true。
 * 类型声明支持 resize → 该类型所有节点(含存量)自动可拖。
 * 例外：媒体类型（图片 / 视频）的卡片尺寸由内容比例 + 「最短边 / 最长边」算，用户口径 2026-11-07
 * 要求它们**只认类型声明**，存量节点上残留的 data.resizable 不许把拖柄打开。
 *
 * 用法（BaseNode）：
 *   const card = useNodeCardSize({ id, data, type, writeback: nodeWrite, toFlow, grabOffset, cardSize })
 *   :style="{ width: card.cardWidth+'px', height: card.cardHeight+'px', ... }"
 *   <div class="resize-handle" @pointerdown="card.onResizePointerDown" />
 *   watch(zoom, () => card.isResizing.value && card.refreshSize())
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useNodeCapability } from "./useNodeCapability";
import { createResizeDragSession, type PointerEventTargetLike } from "./resizeDragSession";
import { nodeSizePatch } from "@plume-canvas/canvas-data";

export interface NodeCardSizeOptions {
  nodeId: string;
  /**
   * 节点 data 的惰性取值器，返回当前 data 对象。
   * 必须传 getter(而非快照)：VueFlow 每次重渲染都替换 props.data 成新对象，
   * 若在 setup 期捕获对象快照会读到过期引用，导致 resizable/尺寸永远不更新。
   * 传 `() => props.data` 即可让内部 computed/watch 依赖 props.data 响应式。
   */
  data: () => Record<string, unknown>;
  type: string;
  /**
   * 尺寸写回（CanvasHost nodeWrite → nodeStore + 落盘）。
   * patch 同时携带 data.cardWidth/cardHeight（卡片渲染读）与保留 key `size`（内核正式尺寸字段）——
   * 两者一个 patch 原子提交，保证 resize 一次只记一条历史，且两份尺寸不再各说各话。
   */
  writeback?: (id: string, patch: Record<string, unknown>) => void;
  /**
   * 拖拽中把"当前视觉尺寸"同步给渲染层的回调（VueFlow 内部重算端口位置/相连边端点）。
   * 不传则只有卡片自身跟着变、端口与边会停在旧尺寸。
   */
  onVisualSize?: (w: number, h: number) => void;
  /**
   * 屏幕坐标 → 画布坐标（**当前视口**；每帧调用）。BaseNode 传 flow.screenToFlow。
   *
   * 为什么不是"当前 zoom"：只除以 zoom 的话，拖拽途中缩放一变，同一段屏幕位移
   * 对应的画布位移就变了 —— 卡片会与鼠标拉开距离（用户报的"resize 时同时缩放就形成一点距离"）。
   * 每帧用当前视口换算，等价于把鼠标所在的画布点当成卡片角该在的点，缩放怎么变都贴住。
   */
  toFlow: (x: number, y: number) => { x: number; y: number };
  /**
   * 类型级 resizable 能力取值器（useNodeCapability().resizable；true 或 'width'/'height'/'aspect'）。
   * 显示拖柄的门 = 类型声明支持 resize **或** 节点实例 data.resizable === true（后者可单独覆盖）。
   */
  typeResizable?: () => boolean;
  /**
   * 指针到**卡片右下角**的屏幕偏移（px）取值器，在 pointerdown 时调用一次。
   *
   * 用户抓的是拖柄中心，而拖柄中心不在卡片右下角上；不补这段偏移，一按下卡片就会先跳一小段。
   * 缺省 undefined = 抓点即角点（不补偿）。DOM 量测放在调用方（壳），本 composable 不碰 DOM。
   */
  grabOffset?: (e: PointerEvent) => { x: number; y: number } | undefined;
  /**
   * 拖拽起手/结束的对外通知（可选）。BaseNode 用它把"我正在被 resize"写进渲染层的共享活动位
   * （beginNodeResize / endNodeResize），好让**挂在节点之外的**浮层（分组控制栏）也能收起。
   * 缺省 no-op —— 不影响本 composable 独立可用（单测/极简宿主）。
   */
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  /**
   * 当前卡片尺寸（来自 `node.size`；BaseNode 从渲染上下文取）。
   * 缺省时回落到类型默认尺寸 —— 仅用于极简宿主/单测；生产路径必须有值。
   */
  cardSize?: () => { w: number; h: number } | null;
}

export const CARD_MIN_WIDTH = 120;
export const CARD_MIN_HEIGHT = 80;

/**
 * 存量数据里曾有「图片 / 视频节点允许 resize」的实例级开关（v1 老存档、旧版本建出来的节点）。
 * 现在这两个类型一律不许 resize，所以实例级 data.resizable 对它们不生效。
 */
const NO_INSTANCE_RESIZE_TYPES = new Set(['image', 'video']);

export function useNodeCardSize(opts: NodeCardSizeOptions) {
  const capability = useNodeCapability(opts.type);
  /** 当前 data（响应式：依赖 props.data 变化） */
  const data = computed(() => opts.data() ?? {});

  const isResizing = ref(false);

  /** 当前尺寸：只认 node.size（由外层投影）；没有就回落类型默认，保证首帧不塌 */
  const currentSize = (): { w: number; h: number } => {
    const s = opts.cardSize?.();
    if (s && s.w > 0 && s.h > 0) return s;
    const d = capability.defaultSize.value;
    return { w: d.w, h: d.h };
  };

  // 拖拽中保留本地值（视觉跟手）；松手后再跟随 node.size。
  const dragSize = ref<{ w: number; h: number } | null>(null);
  const cardWidth = computed({
    get: () => (isResizing.value && dragSize.value ? dragSize.value.w : currentSize().w),
    set: () => {},
  });
  const cardHeight = computed({
    get: () => (isResizing.value && dragSize.value ? dragSize.value.h : currentSize().h),
    set: () => {},
  });

  // 显示拖柄的门：类型声明支持 resize(capability.resizable) **或** 实例 data.resizable === true（后者单独覆盖）。
  // 类型级优先用调用方传入的 typeResizable 取值器；未传则回退 capability 已读到的类型声明。
  const resizable = computed(
    () =>
      (opts.typeResizable ? opts.typeResizable() : capability.resizable.value) ||
      (data.value?.resizable === true && !NO_INSTANCE_RESIZE_TYPES.has(opts.type)),
  );

  /**
   * 拖拽方式（用户口径 2026-10-30）：true/未声明 = 自由拖拽；'width'/'height'/'aspect' = 限定方向。
   * 实例级 data.resizable 只用于「开/关」覆盖（历史行为），不提供实例级方式覆盖 —— 方式是类型能力，
   * 散到每个节点上会让同类节点行为不一致、设置面板也没法一次改全。
   */
  const resizeMode = computed<'width' | 'height' | 'aspect' | 'free'>(() => capability.resizeMode.value);

  /**
   * 等比例拖拽用的比例（宽/高，> 0）：**按下那一刻**算一次，拖拽全程不变。
   * 优先类型声明的 resizeRatio(data)（内容比例：图片用 imageWidth/Height、视频用裁框/画面尺寸）；
   * 类型没声明或算不出（非法值）→ 退回当前卡片的宽高比 —— 对任何节点都成立，不依赖字段名。
   */
  const aspectRatio = (): number => {
    const fromType = capability.resizeRatio.value?.(data.value ?? {});
    if (typeof fromType === 'number' && Number.isFinite(fromType) && fromType > 0) return fromType;
    const w = cardWidth.value;
    const h = cardHeight.value;
    return w > 0 && h > 0 ? w / h : 1;
  };

  // —— resize 拖拽会话（move/up 绑全局 document，不绑手柄元素）——
  // 关键修复：绑元素 + 依赖 setPointerCapture 时，捕获不成立（实测 hasPointerCapture 恒 false）
  // 就会"鼠标一离开手柄就断"；绑全局后指针走到哪都能继续拖。
  const session = createResizeDragSession({
    minW: CARD_MIN_WIDTH,
    minH: CARD_MIN_HEIGHT,
    toFlow: opts.toFlow,
    // 拖拽方式在 start 时冻结成会话参数（见 resizeDragSession.mode）；onLive/onCommit 收到的已是约束后的尺寸
    mode: () => resizeMode.value,
    aspectRatio,
    onLive(w, h) {
      dragSize.value = { w, h };
    },
    // 拖拽中同步给渲染层：VueFlow 内部重算端口位置与相连边端点（否则停在旧尺寸）
    onVisualSize: opts.onVisualSize,
    onCommit(w, h) {
      isResizing.value = false;
      dragSize.value = null;
      // 先灭共享活动位再落盘：落盘会触发重渲染，控制栏此刻就该恢复（松手即恢复）
      opts.onResizeEnd?.();
      // 只写 node.size（唯一尺寸）。
      if (opts.writeback) {
        opts.writeback(opts.nodeId, nodeSizePatch(w, h));
      }
    },
    eventTarget: () => (typeof document !== 'undefined' ? (document as unknown as PointerEventTargetLike) : null),
  });

  function onResizePointerDown(e: PointerEvent) {
    if (!resizable.value) return;
    isResizing.value = true;
    opts.onResizeStart?.();
    session.start(e, cardWidth.value, cardHeight.value, opts.grabOffset?.(e));
  }

  onBeforeUnmount(() => {
    isResizing.value = false;
    // 卸载时兜底灭位：拖拽中热卸/重挂不会把"正在 resize"永久留在共享活动位上
    opts.onResizeEnd?.();
    session.dispose();
  });

  return {
    cardWidth,
    cardHeight,
    resizable,
    /** 当前类型的拖拽方式（设置面板改「拖拽方式」后立即生效） */
    resizeMode,
    isResizing,
    onResizePointerDown,
    /**
     * 视口变化时重算一次尺寸（拖拽中缩放常用滚轮，**没有 pointermove**）。
     * 不在拖拽中时是空操作；调用方（壳）watch 缩放变化后喊一声即可。
     */
    refreshSize: () => session.refresh(),
  };
}
