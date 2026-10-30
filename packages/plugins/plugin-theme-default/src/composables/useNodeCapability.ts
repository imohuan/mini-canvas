/**
 * useNodeCapability —— 由节点类型"连接能力"推导端口显隐（替代 v1 的 canReceiveInput/canProduceOutput 布尔）。
 *
 * v2 内核能力模型是"声明了才约束"：nodeStore.types 里某 type 未声明 inputs/outputs 或声明非空 = 默认可连；
 * 只有当显式声明为空数组(或 inputs 只为某个 port)才算限制。见 kernel connection.ts（connection.ts:199-203）：
 *   hasSourcePort = !outputs || outputs.length > 0
 *   hasTargetPort = !inputs  || inputs.length > 0
 *
 * 与 v1 语义对齐：v1 canReceiveInput/canProduceOutput 默认 true；v2 未声明 inputs/outputs 即默认可进可出。
 *
 * 用法（BaseNode）：
 *   const cap = useNodeCapability(props.type)
 *   v-if="cap.hasTarget" 渲染 target 口、v-if="cap.hasSource" 渲染 source 口。
 */
import { computed } from "vue";
import { useCanvasRender } from "@mini-canvas/canvas-render";

export function useNodeCapability(type: string) {
  const { ctx } = useCanvasRender();
  // 5c：nodeStore 老服务名已下线，类型表从 doc 门面读（同一份数据，只读投影）。
  // T05：服务名已在 canvas-data 集中登记类型（T03），不必再手写 ctx.get<DocService>。
  const store = ctx.get("doc");
  const nodeDef = computed(() => store.types.get(type));

  /** 该 type 是否有输入(target)能力（有 inputs 声明且非空才限制输入，否则默认有） */
  const hasTarget = computed(() => {
    const inputs = nodeDef.value?.inputs;
    return !inputs || inputs.length > 0;
  });

  /** 该 type 是否有输出(source)能力 */
  const hasSource = computed(() => {
    const outputs = nodeDef.value?.outputs;
    return !outputs || outputs.length > 0;
  });

  /** 节点类型默认尺寸（resize 初值来源）；缺省 256×128 兜底 */
  const defaultSize = computed(() => {
    const s = nodeDef.value?.defaultSize;
    return s ? { w: s.w, h: s.h } : { w: 256, h: 128 };
  });

  /** 该 type 是否声明支持 resize（含拖拽方式；缺省 false）。BaseNode 据此显示拖柄、useNodeCardSize 据此选拖拽方式。 */
  const resizable = computed(() => nodeDef.value?.resizable === true || typeof nodeDef.value?.resizable === 'string');
  /** 该 type 声明的拖拽方式：true/'free' 之外的三种字符串。没开 resize 时恒 'free'（不消费）。 */
  const resizeMode = computed<'width' | 'height' | 'aspect' | 'free'>(() => {
    const v = nodeDef.value?.resizable;
    return v === 'width' || v === 'height' || v === 'aspect' ? v : 'free';
  });
  /** 该 type 声明的等比例内容比例函数（可选；见 CanvasNodeType.resizeRatio）。 */
  const resizeRatio = computed(() => nodeDef.value?.resizeRatio);

  /**
   * 该 type 是否声明"不要卡片边框"（缺省 false = 用外壳的默认边框）。
   * 给内容铺满整张卡的类型（图片）用：外壳的 1px 边框对它们只是内容边缘多余的一圈缝。
   */
  const frameless = computed(() => nodeDef.value?.frameless === true);

  /**
   * 该 type 是否声明"卡片表面透明"（缺省 false = 不透明卡片底）。
   * 容器型类型（分组）用：外壳不画底色/投影，连接线能从卡片区域透出来。
   */
  const transparent = computed(() => nodeDef.value?.transparent === true);

  /**
   * 该 type 是否声明"加载态用类型默认尺寸"（缺省 false）。
   * 媒体型类型（图片/视频）用它：跑任务时卡片按类型默认宽高显示，不跟着上次那张图的比例变竖。
   * 判定"是否在跑"由消费方读 data.runState 完成（见 canvas-data 的 isNodeRunning），本 composable 只报类型声明。
   */
  const loadingDefaultSize = computed(() => nodeDef.value?.loadingDefaultSize === true);

  /** 该 type 声明的图标（opaque 句柄：SVG 字符串或 Vue 组件；缺省 undefined = 标题不显示图标） */
  const icon = computed(() => nodeDef.value?.icon);

  /**
   * 该 type 声明的"标题右侧附加文本"（字符串或 `(data)=>string`；缺省 undefined = 不显示）。
   * 与 icon 同一条路：类型自己声明，默认壳只按声明渲染，不给节点类型写分支。
   * 取值与回落（空串/未声明不渲染）在壳那一层做 —— 这里只报"类型声明了什么"。
   */
  const titleExtra = computed(() => nodeDef.value?.titleExtra);

  /**
   * 该 type 声明的"标题右侧组件插槽"（Component；缺省 undefined = 不挂载）。
   * 与 titleExtra 同一条路 —— 声明方（业务插件）拿自己的 Vue 副本定义组件，
   * 壳只负责以 nodeId/data 挂载，组件内部自持响应式状态（调试标签等）。
   */
  const titleExtraSlot = computed(() => nodeDef.value?.titleExtraSlot);

  /**
   * 该 type 的中文名（label）。标题条在没有 data.label 时用它兜底 ——
   * 以前回落成英文 type（text/image），界面上看着就不对。
   */
  const label = computed(() => nodeDef.value?.label);

  return { hasTarget, hasSource, defaultSize, resizable, resizeMode, resizeRatio, icon, titleExtra, titleExtraSlot, frameless, transparent, loadingDefaultSize, label };
}
