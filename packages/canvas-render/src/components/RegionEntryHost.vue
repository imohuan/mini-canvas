<!--
  RegionEntryHost —— 渲染一条区域条目，并把它 needs 声明的能力包 provide 给它。

  为什么需要这一层：能力包是"每节点一份实例"（决策 9），而"这一条条目声明了哪些 needs"是
  条目的属性（attach 的 needs）。provide/inject 的作用域是**组件树**，所以要在
  "条目组件"外面有一层 setup 才能把袋子递下去 —— 没有这一层，组件就 inject 不到。

  刻意不加任何 DOM：渲染出来的就是 entry.component 本身，因此对既有渲染结果零影响
  （baseNodeSlotsRender 的 HTML 断言照旧：不出现多余包裹元素）。
-->
<script setup lang="ts">
import type { NodeSegmentEntry } from '@mini-canvas/canvas-data'
import { provideCapabilityBag, type CapabilityCache } from '../contracts/capabilities'

const props = defineProps<{
  /** 本区域条目（带 needs/props） */
  entry: NodeSegmentEntry
  /**
   * 本节点那份能力实例缓存（**每节点一份**，见决策 9 第②条）。
   *
   * 为什么收 cache 而不是"节点上下文"：实例必须按节点共享 —— 同一节点上"按钮"与"它打开的面板"
   * 是两条条目，各自拿到的 tools/node 实例必须是同一个，否则状态不共享。cache 由 BaseNode 持有，
   * 本组件只负责"按本条目 needs 取用 + provide"。
   */
  cache: CapabilityCache
  /** 下发给条目组件的节点 id / data（与既有区域渲染的 props 契约一致） */
  nodeId: string
  data: Record<string, unknown>
}>()

// 按本条目的 needs 取袋并 provide（实例的生命周期归 cache 所有者 = BaseNode）
provideCapabilityBag(props.cache, props.entry.needs, props.entry.id)
</script>

<template>
  <component :is="entry.component" :id="nodeId" :data="data" v-bind="entry.props" />
</template>
