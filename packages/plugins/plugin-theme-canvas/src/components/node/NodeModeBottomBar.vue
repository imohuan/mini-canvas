<script setup lang="ts">
/**
 * NodeModeBottomBar —— 节点**下**状态栏的「解析面板」（主题件，挂在 out:bottom 锚点）。
 *
 * 与 NodeModeTopBar 同一套机制：问 nodeToolbar 服务「这个节点的下栏现在该显示什么」。
 * - 组件 → 渲染它；「不显示」→ 留空；「没注册」→ 透传宿主默认内容。
 *
 * 为什么这里比上栏多一道「必须单独选中」的判断：
 * 上栏的默认内容（上传/裁剪/扩展）自带 useSoleNodeSelected，未选中时自己渲染空；
 * 而底栏的默认内容（bottom-bar 的生成 UI）**不是**按节点挂的 —— 它原先是画布级浮层、只认单选。
 * 现在它住进每个节点的 out:bottom 锚点，若不加这道判断，未选中的节点也会各长一条生成栏。
 * 判断放在解析层而不是内容组件：内容组件（裁剪面板 / 演示面板）不该知道「选中语义」。
 */
import { computed } from 'vue'
import type { Component } from 'vue'
import { useCanvasRender, useSoleNodeSelected } from '@plume-canvas/canvas-render'
import { NodeToolbarService } from '@plume-canvas/canvas-render'

const props = defineProps<{ id: string; data: Record<string, unknown>; type?: string }>()
const { ctx } = useCanvasRender()

/**
 * 每次求值都现取服务。
 *
 * 不能在 setup 里缓存：nodeToolbar 由宿主注入，而节点壳可能先于它挂载
 * （进画布时先渲染节点、宿主稍后 inject）。缓存到 undefined 之后，
 * 这个节点的下栏就永远解析成 inherit —— 真实运行里「选中节点后底栏整条不出现」。
 */
const bar = computed(() => {
  const svc = ctx.tryGet<NodeToolbarService | undefined>('nodeToolbar')
  // 读版本号建立依赖：模式可能在节点挂载之后才注册（插件装配顺序不定）。
  svc?.revision()
  return svc ? svc.resolveBar(props.id, 'bottom', props.type) : ({ kind: 'inherit' } as const)
})
const BarComponent = computed(() =>
  bar.value.kind === 'component' ? (bar.value.component as Component) : null,
)

/** 下栏只在「恰好选中这一个节点」时出现（与旧的画布级浮层同一条语义） */
const soleSelected = useSoleNodeSelected(props.id)

</script>

<template>
  <!-- 解析出组件：整格换成它；未单独选中时留空（不画空壳） -->
  <component :is="BarComponent" v-if="BarComponent && soleSelected" :id="props.id" :data="props.data" />
  <!-- 解析出「不显示」：这一格留空 -->
  <template v-else-if="bar.kind === 'none'" />
  <!-- 没注册：透传宿主默认内容（自占 out:bottom 段的组件照常工作） -->
  <slot v-else />
</template>
