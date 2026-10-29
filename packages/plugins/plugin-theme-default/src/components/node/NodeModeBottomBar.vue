<script setup lang="ts">
/**
 * NodeModeBottomBar —— 「功能模式」的默认底栏渲染器（主题件）。
 *
 * 职责与 NodeModeTopBar 对称：本节点在模式里 → 渲染该模式的 bottomBar 组件；
 * 不在 → 透传默认内容（bottom-bar 的宿主 / 节点自带的 out:bottom 段）。
 *
 * 为什么"底栏保持默认"如此重要：bottom-bar 只是**默认模式**的底栏贡献者 ——
 * 它的动作列表 / panel 只应该在没有任何模式接管时出现。以前这个判断住在
 * NodeBottomBar 内部（featureShown），是本末倒置；现在渲染器归主题，判断天然成立。
 */
import { computed } from 'vue'
import type { Component } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { NodeToolbarService } from './nodeToolbarService'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()

const svc = ctx.tryGet<NodeToolbarService | undefined>('nodeToolbar')

const mode = computed(() => svc?.modeOf(props.id))
const ModeBottom = computed(() => (mode.value?.bottomBar as Component | undefined) ?? null)
</script>

<template>
  <!-- 模式底栏：整根替换（不带默认内容） -->
  <component :is="ModeBottom" v-if="ModeBottom" :id="props.id" :data="props.data" />
  <!-- 默认模式：透传宿主内容（bottom-bar 宿主 / 节点自带 out:bottom 段） -->
  <slot v-else />
</template>
