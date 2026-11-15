<script setup lang="ts">
/**
 * GroupTopToolbar —— 分组节点「上控制栏」里的操作：解组 + 背景颜色。
 *
 * 用户要求："这边的操作都是显示在这个上下控制栏里面，你可以参考节点中上下这个控制栏是如何实现的，
 * 它是悬浮在节点外的"；"这边分组还支持选择这里的背景颜色，放在它的上浮控制栏中"。
 *
 * 为什么从内容区（GroupContent 右上角那个小图标）搬到这里：
 * - 位置语义统一 —— 节点上的操作一律走 out:top / out:bottom，不再是"内容组件里自己绝对定位一个角"；
 * - 显隐统一 —— 壳（BaseNode）按"框选中/多选收起"统一压掉这一层，不必每个组件各判一遍；
 * - 定位统一 —— 贴边距离/居中/反缩放由壳给，本组件只放内容。
 *
 * 与图片节点的 ImageTopToolbar 逐字同形：**定位不在这里**，选中态也不在这里。
 */
import { computed } from 'vue'
import { useCanvasRender, useSoleNodeSelected, useUiComponent, ToolbarIcon } from '@plume-canvas/canvas-render'
import { resolveGroupBackgroundColor, groupServiceOf } from './groupEngine'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()
const Button = useUiComponent('Button')
/**
 * 背景颜色面板：与图片节点「绘制」模式的标记颜色**同一份实现**（用户口径 2026-11-15）。
 * 预置色、自定义取色器、选中环、间距都来自默认主题的 colorSwatchPicker，这里不再自己画色板。
 */
const ColorSwatchPicker = useUiComponent('colorSwatchPicker')
/**
 * 显隐门：**恰好单独选中我**时才出现（与图片/文本节点的上控制栏同一判据）。
 *
 * 为什么必须自己判：壳（BaseNode）只做"压制"（框选中/多选时收起），它**不负责显示** ——
 * 见 BaseNode 的注释"单选时的显隐仍由各段组件自己的 useSoleNodeSelected 决定"。
 * 少了这一句，未选中或选中别人时这条栏也会一直挂在那儿（用户实测报的就是这个）。
 */
const visible = useSoleNodeSelected(props.id)
/** 解组图标（与 GroupContent 里那枚同源写法：内联 SVG 字符串） */
const ICON_UNGROUP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 8h8v8H8z"/><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z"/></svg>'

/**
 * 解组：调 group 服务（唯一写入口在服务里 —— 它自己包历史、还原子节点绝对坐标）。
 * 只读服务名，不 import 任何 group 内部实现，保持「UI 与逻辑同包但职责分开」。
 *
 * ⚠️ 必须用 ctx.get('group')，**不能**写 ctx.group（真 bug，2026-10-08 实测：点了解散分组没反应）。
 * useCanvasRender() 递进来的是**根 Context**，而 `ctx.<服务名>` 这种直访是靠「每个插件自己的
 * scope 代理」实现的（Context.ts 的 new Proxy：属性读命中已上架服务名才转发）——
 * 根 Context 没有那层代理，`ctx.group` 恒为 undefined。写成 ctx.group?.ungroup() 时可选链又把
 * 它吞成静默 no-op：按钮点得动、什么也不发生。同仓其它节点工具栏组件一律走 ctx.get/tryGet，这里对齐。
 */
function onUngroup(): void {
  groupServiceOf(ctx)?.ungroup(props.id)
}

// ====== 背景颜色 ======
/** 当前底色（没设过 = 默认石板灰）。面板自己画色点，这里只在数据层面兜底。 */
const currentColor = computed(() => resolveGroupBackgroundColor(props.data?.backgroundColor))

/**
 * 落色：走 doc.updateNodeData（唯一图写入口 → 自动进历史 + 落盘），
 * 与 GroupContent 读的是同一个字段。面板给的是 hex 字符串（预置色或取色器），
 * 写之前统一过一次 resolveGroupBackgroundColor，空串回落默认色。
 */
function pickColor(color: string): void {
  ctx.get('doc')?.updateNodeData(props.id, {
    ...props.data,
    backgroundColor: resolveGroupBackgroundColor(color),
  })
}

</script>

<template>
  <div v-if="visible" class="ntp-root group-top-toolbar">
    <!-- 背景颜色：与图片「绘制」模式的标记颜色同一套面板（预置色 + 自定义取色）。
         触发器等宽文案「背景颜色」保持原样（用户 2026-10-08：小圆点 + 文字）。 -->
    <ColorSwatchPicker
      v-if="ColorSwatchPicker"
      :model-value="currentColor"
      label="背景颜色"
      trigger="label"
      close-on-pick
      @update:model-value="pickColor"
    />

    <Button variant="destructive" size="sm" type="button"
      title="解散分组" aria-label="解散分组" @click="onUngroup">
      <ToolbarIcon :icon="ICON_UNGROUP" />
      <span>解散分组</span>
    </Button>
  </div>
</template>

<style scoped>
/* 容器（排一行 + 一块面板）由全局 `.ntp-root` 提供（canvas-render 的 ui-theme.css）——
   位置（贴边/居中/反缩放）由壳的上插槽定位层给，本组件只管内容。

   色板外观不再写在这里：背景颜色用的是默认主题的 colorSwatchPicker（与绘制模式的
   标记颜色同一份实现）。原先这 7 个圆块、152px 面板与描边环的规则已全部移走。 */
</style>
