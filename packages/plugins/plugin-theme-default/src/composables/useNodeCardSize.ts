/**
 * useNodeCardSize —— 卡片固定尺寸 + 右下角拖拽 resize（移植自 v1 Decoration/BaseNode 的内置 resize 逻辑）。
 *
 * v2 卡片从"内容自适应"改为"固定可改尺寸框"。尺寸来源：node.data.cardWidth/cardHeight（与 v1 同名，便于存量迁移）
 * ?? nodeStore.types.defaultSize。resize 拖拽屏幕 delta ÷ zoom 还原成画布/内容坐标，
 * 结束经 nodeWrite 写回（触发 nodeStore 订阅 → 渲染态自动刷新，无需手动 updateNode/map）。
 *
 * 拖拽监听（修复）：move/up **绑到全局 document**，而不是手柄元素自己身上。
 * 原实现绑元素 + 依赖 setPointerCapture，但捕获不总成立（实测 hasPointerCapture 恒 false），
 * 指针一离开手柄元素就收不到 move → "拖一半断掉"。会话逻辑见 resizeDragSession.ts（可单测）。
 *
 * 拖柄显示门：**类型级 resizable 能力**(useNodeCapability 读 nodeStore.types[type].resizable) **或** 节点实例 data.resizable === true。
 * 类型声明支持 resize → 该类型所有节点(含存量)自动可拖；实例级 data.resizable 可单独覆盖/关闭。
 *
 * 用法（BaseNode）：
 *   const card = useNodeCardSize({ id, data, type, writeback: nodeWrite, zoom })
 *   :style="{ width: card.cardWidth+'px', height: card.cardHeight+'px', ... }"
 *   <div class="resize-handle" @pointerdown="card.onResizePointerDown" />
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useNodeCapability } from "./useNodeCapability";
import { createResizeDragSession, type PointerEventTargetLike } from "./resizeDragSession";

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
  /** 当前画布缩放（resize 屏幕 delta ÷ zoom 换算） */
  zoom: () => number;
  /**
   * 类型级 resizable 能力取值器（useNodeCapability().resizable）。缺省返回 false。
   * 显示拖柄的门 = 类型声明支持 resize **或** 节点实例 data.resizable === true（后者可单独覆盖）。
   */
  typeResizable?: () => boolean;
}

export const CARD_MIN_WIDTH = 120;
export const CARD_MIN_HEIGHT = 80;

export function useNodeCardSize(opts: NodeCardSizeOptions) {
  const capability = useNodeCapability(opts.type);
  /** 当前 data（响应式：依赖 props.data 变化） */
  const data = computed(() => opts.data() ?? {});

  // 初值：data 显式尺寸 ?? 类型 defaultSize
  const cardWidth = ref<number>(
    (data.value.cardWidth as number) || capability.defaultSize.value.w,
  );
  const cardHeight = ref<number>(
    (data.value.cardHeight as number) || capability.defaultSize.value.h,
  );

  // 外部(data.cardWidth/Height)改动同步进来；拖拽期间不覆盖本地拖拽值
  const isResizing = ref(false);
  watch(
    () => data.value?.cardWidth as number | undefined,
    (w) => {
      if (w !== undefined && !isResizing.value) cardWidth.value = w;
    },
  );
  watch(
    () => data.value?.cardHeight as number | undefined,
    (h) => {
      if (h !== undefined && !isResizing.value) cardHeight.value = h;
    },
  );

  // 显示拖柄的门：类型声明支持 resize(capability.resizable) **或** 实例 data.resizable === true（后者单独覆盖）。
  // 类型级优先用调用方传入的 typeResizable 取值器；未传则回退 capability 已读到的类型声明。
  const resizable = computed(
    () => (opts.typeResizable ? opts.typeResizable() : capability.resizable.value) || data.value?.resizable === true,
  );

  // —— resize 拖拽会话（move/up 绑全局 document，不绑手柄元素）——
  // 关键修复：绑元素 + 依赖 setPointerCapture 时，捕获不成立（实测 hasPointerCapture 恒 false）
  // 就会"鼠标一离开手柄就断"；绑全局后指针走到哪都能继续拖。
  const session = createResizeDragSession({
    minW: CARD_MIN_WIDTH,
    minH: CARD_MIN_HEIGHT,
    zoom: () => opts.zoom() || 1,
    onLive(w, h) {
      cardWidth.value = w;
      cardHeight.value = h;
    },
    // 拖拽中同步给渲染层：VueFlow 内部重算端口位置与相连边端点（否则停在旧尺寸）
    onVisualSize: opts.onVisualSize,
    onCommit(w, h) {
      isResizing.value = false;
      // 一次写回两份尺寸（触发 nodeStore 订阅自动刷新渲染态）：
      //   data.cardWidth/cardHeight → 卡片渲染读它决定多大
      //   size                      → 宿主写进 node.size（正式尺寸字段，布局回退链的中间一环）
      if (opts.writeback) {
        opts.writeback(opts.nodeId, {
          cardWidth: w,
          cardHeight: h,
          size: { w, h },
        });
      }
    },
    eventTarget: () => (typeof document !== 'undefined' ? (document as unknown as PointerEventTargetLike) : null),
  });

  function onResizePointerDown(e: PointerEvent) {
    if (!resizable.value) return;
    isResizing.value = true;
    session.start(e, cardWidth.value, cardHeight.value);
  }

  onBeforeUnmount(() => {
    isResizing.value = false;
    session.dispose();
  });

  return {
    cardWidth,
    cardHeight,
    resizable,
    isResizing,
    onResizePointerDown,
  };
}
