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
import { provideCapabilityBag, type CapabilityNodeContext } from '../contracts/capabilities'

const props = defineProps<{
  /** 本区域条目（带 needs/props） */
  entry: NodeSegmentEntry
  /** 本节点的能力上下文（多条目共用同一份，见 BaseNode） */
  node: CapabilityNodeContext
  /** 下发给条目组件的节点 id / data（与既有区域渲染的 props 契约一致） */
  nodeId: string
  data: Record<string, unknown>
}>()

// 造袋 + provide + 随本组件作用域回收（决策 9 的三件事都在这里）
provideCapabilityBag(props.entry, props.node)
</script>

<template>
  <component :is="entry.component" :id="nodeId" :data="data" v-bind="entry.props" />
</template>
