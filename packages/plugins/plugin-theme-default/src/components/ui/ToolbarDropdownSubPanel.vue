<script setup lang="ts">
/**
 * ToolbarDropdownSubPanel —— 工具栏下拉右侧那块二级浮层的内容。
 *
 * 三种形态（优先顺序）：
 * 1. node.panel.component：直接渲染调用方给的组件，并把 panel 上下文当 prop 传入；
 * 2. node.panel.render：调用方自己组 VNode（适合需要 close / pick 联动的面板）；
 * 3. node.children：原有的文字二级菜单。
 *
 * 为什么单独拆出来：定位、浮层链、鼠标进出归 ToolbarDropdownButton；
 * 这里只管「内容怎么画」，于是内容本身可以脱离下拉直接 SSR 验证。
 */
import { computed, defineComponent } from 'vue'
import type { ToolbarMenuNode, ToolbarMenuPanelContext } from './types'

const props = defineProps<{
  node: ToolbarMenuNode
  context: ToolbarMenuPanelContext
}>()

const emit = defineEmits<{
  (e: 'pick', key: string, path: string[]): void
}>()

/** 直接传组件时：配置 props + 面板上下文（组件可选消费） */
const componentProps = computed<Record<string, unknown>>(() => ({
  ...(props.node.panel?.props ?? {}),
  panel: props.context,
}))

/** render 写法包成组件：打开期间 state 变化会跟着重绘 */
const PanelView = defineComponent({
  name: 'ToolbarMenuPanelView',
  setup() {
    return () => {
      const render = props.node.panel?.render
      return render ? render(props.context) : null
    }
  },
})
</script>

<template>
  <div class="tdb-sub-body">
    <component
      v-if="node.panel?.component"
      :is="node.panel.component"
      v-bind="componentProps"
    />
    <component v-else-if="node.panel?.render" :is="PanelView" />
    <template v-else-if="node.children">
      <button
        v-for="child in node.children"
        :key="child.key"
        class="tdb-row"
        type="button"
        role="menuitem"
        :disabled="child.disabled"
        @click.stop="emit('pick', child.key, [node.key, child.key])"
      >{{ child.label }}</button>
    </template>
  </div>
</template>

<style scoped>
/* 内容只占自己的自然高度；滚动/限高由外层那块负责（这样测出来的 scrollHeight 就是真内容高） */
.tdb-sub-body { display: flex; flex-direction: column; gap: 2px; }
.tdb-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-badge, 6px);
  background: transparent;
  color: var(--ui-ink, #18202b);
  font-size: var(--text-base, 13px);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.tdb-row:hover:not(:disabled) { background: var(--ui-hover, rgb(0 0 0 / 0.06)); }
.tdb-row:disabled { opacity: 0.38; cursor: not-allowed; }
</style>
