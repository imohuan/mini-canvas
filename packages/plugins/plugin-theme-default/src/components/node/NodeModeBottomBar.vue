<script setup lang="ts">
/**
 * NodeModeBottomBar —— 节点**下**状态栏的「解析面板」（主题件，挂在 out:bottom 锚点）。
 *
 * 与 NodeModeTopBar 完全对称：问 nodeToolbar 服务「这个节点的下栏现在该显示什么」。
 * - 组件 → 渲染它；「不显示」→ 留空；「没注册」→ 透传宿主默认内容。
 *
 * 默认底栏（生成输入区）之所以能出现在这里：bottom-bar 插件把它作为 id='default' 的
 * bottomBar 注册进同一个服务 —— 它与裁剪模式完全平等，没有特殊地位。
 */
import { computed } from 'vue'
import type { Component } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { NodeToolbarService } from './nodeToolbarService'

const props = defineProps<{ id: string; data: Record<string, unknown>; type?: string }>()
const { ctx } = useCanvasRender()

const svc = ctx.tryGet<NodeToolbarService | undefined>('nodeToolbar')

const bar = computed(() =>
  svc ? svc.resolveBar(props.id, 'bottom', props.type) : ({ kind: 'inherit' } as const),
)
const BarComponent = computed(() =>
  bar.value.kind === 'component' ? (bar.value.component as Component) : null,
)
</script>

<template>
  <!-- 解析出组件：整格换成它 -->
  <component :is="BarComponent" v-if="BarComponent" :id="props.id" :data="props.data" />
  <!-- 解析出「不显示」：这一格留空 -->
  <template v-else-if="bar.kind === 'none'" />
  <!-- 没注册：透传宿主默认内容 -->
  <slot v-else />
</template>
