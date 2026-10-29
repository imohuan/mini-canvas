<script setup lang="ts">
/**
 * NodeModeTopBar —— 「功能模式」的默认顶栏渲染器（主题件）。
 *
 * 职责：读 nodeToolbar 会话；本节点在某个模式里 → 渲染该模式的 topBar 组件；
 * 不在任何模式 → 渲染**默认内容插槽**（宿主 BaseNode 的 out:top 段原样落在这里）。
 *
 * 为什么需要它：BaseNode 的 out:top 段是节点类型注册时写死的（ImageTopToolbar 等）。
 * 模式系统要"整根栏换内容"，就必须在**段与内容之间**加一层渲染器 —— 这层归主题：
 * 它是默认皮的一部分，与 nodeShell 同级。
 */
import { computed } from 'vue'
import type { Component } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { NodeToolbarService } from './nodeToolbarService'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()

/** 主题插件自己的服务（同包内直接构造读取；跨插件按名取是 apply 之外拿不到 ctx 的场景） */
const svc = ctx.tryGet<NodeToolbarService | undefined>('nodeToolbar')

const mode = computed(() => svc?.modeOf(props.id))
const ModeTop = computed(() => (mode.value?.topBar as Component | undefined) ?? null)
</script>

<template>
  <!-- 模式顶栏：整根替换（不带默认内容 —— 模式自己决定里面有什么） -->
  <component :is="ModeTop" v-if="ModeTop" :id="props.id" :data="props.data" />
  <!-- 默认模式：透传宿主内容（BaseNode out:top 段的默认 children） -->
  <slot v-else />
</template>
