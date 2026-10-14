/**
 * nodeToolbarHost —— 节点「上/下控制栏」的画布级宿主令牌。
 *
 * 为什么需要它（2026-09-29 实测）：
 * 节点的上/下控制栏原先住在节点壳（BaseNode）内部。而 `.vue-flow__node` 带 `transform`
 * （VueFlow 用它做定位），**必然**创建层叠上下文 —— 于是节点内部的 z-index 再大也出不去，
 * 越不过作为其**兄弟**的边层。用户开了「连线显示在最上层」后，置顶连线就把控制栏整个盖住
 * （实测：边横穿下控制栏，216/3888 个采样点命中边）。
 *
 * 解法：把控制栏的 DOM 挪到画布级的一层（本令牌给出的宿主元素），该层位于置顶连线之上
 * （层值见 contracts/layers.ts 的 LAYERS.nodeToolbar）。节点壳继续持有全部逻辑（区域条目、
 * 能力实例缓存、定位样式），只是把渲染出来的 DOM 传送过去 —— 逻辑不搬家，DOM 换层。
 *
 * 为什么用 provide/inject 而不是"宿主里再写一遍渲染"：控制栏与同节点的其它区域**共享同一份**
 * 能力实例（决策 9 第②条；例如"按钮"与"它打开的面板"）。若由宿主另建一份解析+缓存，
 * 就会造出第二份实例、状态不共享。传送 DOM 则能力 provide/inject 沿**组件树**（不是 DOM 树）
 * 传递，共享关系原样保留。
 *
 * 缺省（没装该宿主，如单测/极简宿主）：注入取不到 → 节点壳原地渲染，行为与改动前一致。
 */
import type { InjectionKey, Ref } from 'vue'

/**
 * 控制栏宿主：值是"flow 坐标系里的容器元素"（已按视口 translate+scale）。
 * 节点壳把控制栏 DOM Teleport 到它里面，并用节点在 flow 里的坐标给自己定位。
 * 元素尚未挂载时为 null（壳等到它出现再传送）。
 */
export const NODE_TOOLBAR_HOST_KEY: InjectionKey<Readonly<Ref<HTMLElement | null>>> =
  Symbol('canvas-node-toolbar-host')

