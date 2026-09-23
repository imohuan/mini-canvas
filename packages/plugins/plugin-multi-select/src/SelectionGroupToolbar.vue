<script setup lang="ts">
/**
 * SelectionGroupToolbar —— 多选框「上控制栏」里的打组按钮（当前只这一个功能）。
 *
 * 用户要求："当前的分组节点只提供一个解组分组的功能按钮，然后你的多选的时候，就添加一个打组的功能"。
 *
 * 它是什么：一段**普通流式内容**（自己不写 position/居中/反缩放）—— 定位由宿主
 * SelectionFrame 的"上控制栏定位层"统一负责，与节点那边"定位交给 BaseNode、插件只管放内容"
 * 是同一条规矩。于是同一段内容换个宿主也能用，作者也不必各自抄一份定位。
 *
 * 上下文怎么拿：走能力包（needs:['selection']），不是自己 ctx.get 拼 —— 与节点按钮
 * "needs:['node']" 同一套规则。设置面板/主题换皮时，能力实现可以整体被换掉。
 *
 * 设计系统件按名取（§4.5 目录）：换主题插件时这里一行不改。目录里没有 button 时
 * 回退一个原生按钮 —— 缺件该降级成"还能点"，不该白屏（与 useUiComponent 的缺名策略同调）。
 */
import { computed } from 'vue'
import { useUiComponent, useCanvasRender } from '@mini-canvas/canvas-render'
import type { SelectionCapability } from '@mini-canvas/canvas-render'
import { useCapability } from '@mini-canvas/canvas-render'

const { ctx } = useCanvasRender()
const ThemedButton = useUiComponent('button')

/** 当前选中集（能力包；needs 里声明了才拿得到 —— 见本文件挂载处） */
const selection = useCapability<SelectionCapability>('selection')

/** 打组图标（与 group 节点类型注册的 icon 同源写法：内联 SVG 字符串） */
const ICON_GROUP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 8h8v8H8z"/><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z"/></svg>'

/** 选中节点数：>=2 才谈得上打组（1 个组不起来，0 个更不用） */
const count = computed(() => selection?.ids().length ?? 0)
const canGroup = computed(() => count.value >= 2)

/**
 * 点它打组：走 **group:create 命令**（与 Ctrl+G 快捷键同一条实现），
 * 命令内部自己读 selection、算包围盒、写图 —— 本组件不重复实现打组逻辑。
 */
function onGroup(): void {
  if (!canGroup.value) return
  ctx.get<{ execute(id: string): unknown } | undefined>('command')?.execute('group:create')
}
</script>

<template>
  <!-- 定位由宿主给（selection-frame-slot--top）；这里只声明"这是上控制栏里的一排内容" -->
  <div class="selection-group-toolbar">
    <component
      :is="ThemedButton || 'button'"
      class="selection-group-toolbar__btn"
      type="button"
      title="创建分组"
      aria-label="创建分组"
      :icon="ICON_GROUP"
      :disabled="!canGroup"
      @click="onGroup"
    >
      打组
    </component>
  </div>
</template>

<style scoped>
/* 只管"排一行"；位置（贴外框、居中、反缩放）由宿主那层负责 —— 与节点上插槽同一规矩。
   配色走通用 UI token（--ui-*，由 <html data-canvas-theme> 切换），本组件不带主题配置项。 */
.selection-group-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: var(--ui-panel, #ffffff);
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  border-radius: 10px;
  box-shadow: var(--ui-shadow-md, 0 20px 40px rgba(0, 0, 0, 0.08));
  white-space: nowrap;
}
</style>
