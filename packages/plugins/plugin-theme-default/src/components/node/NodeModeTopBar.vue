<script setup lang="ts">
/**
 * NodeModeTopBar —— 节点**上**状态栏的「解析面板」（主题件，挂在 out:top 锚点）。
 *
 * 它只做一件事：问 nodeToolbar 服务「这个节点的上栏现在该显示什么」，然后渲染那一格。
 * - 解析出组件 → 渲染它（收 { id, data }）；
 * - 解析出「不显示」→ 什么都不渲染；
 * - 解析出「没注册」→ 透传宿主自己的默认内容（兼容老的段注册：图片/视频/音频的上传条）。
 *
 * 位置不在它这里：离卡片多远、居中、反缩放由 BaseNode 的 out:top 定位层负责 ——
 * 所以默认面板、裁剪面板、任何模式面板**共用同一个插槽位**，不可能出现两套栏叠在一起。
 */
import { computed } from 'vue'
import type { Component } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { NodeToolbarService } from './nodeToolbarService'

const props = defineProps<{ id: string; data: Record<string, unknown>; type?: string }>()
const { ctx } = useCanvasRender()

const svc = ctx.tryGet<NodeToolbarService | undefined>('nodeToolbar')

/** 服务缺席（极简宿主/单测）→ 当作「没注册」，透传默认内容 */
const bar = computed(() =>
  svc ? svc.resolveBar(props.id, 'top', props.type) : ({ kind: 'inherit' } as const),
)
const BarComponent = computed(() =>
  bar.value.kind === 'component' ? (bar.value.component as Component) : null,
)
</script>

<template>
  <!-- 解析出组件：整格换成它（不带默认内容 —— 接管方自己决定里面有什么） -->
  <component :is="BarComponent" v-if="BarComponent" :id="props.id" :data="props.data" />
  <!-- 解析出「不显示」：这一格留空 -->
  <template v-else-if="bar.kind === 'none'" />
  <!-- 没注册：透传宿主默认内容 -->
  <slot v-else />
</template>
