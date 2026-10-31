<script setup lang="ts">
/**
 * AgentRefToolbar —— **多选框「上控制栏」**里的「引用到 Agent」按钮。
 *
 * 用户口径（2026-10-08）：「向主节点的顶部控制栏注册一个按钮，该按钮的功能就是'添加到 Agent 效果'，
 * 以及右键菜单中的'引用 Agent'效果是一样的」；并指定参考「加入资产库」。
 * 「加入资产库」挂在**多选框（选择集）的上控制栏**（`ctx.selectionRegion.attach({ region:'out:top' })`），
 * 不是节点卡片自己的操作条 —— 本组件照它那套接缝写（注册在 agentPlugin.apply）。
 *
 * 与右键菜单那条「引用到 Agent」**是同一个功能**：同一条命令（agentCommands.ts 的
 * AGENT_REFERENCE_COMMAND_ID）、同一份实现，本组件只负责「画按钮 + 按 id 执行命令」，
 * payload 形状（`{ nodeIds }`）与右键菜单那条同源（那边传一个，这里传整批，命令内部归一）。
 *
 * 多选语义：多选框上站着的是**一批**节点，所以把选中的每一个都引用进去
 * （与「加入资产库」把选中的每一张图都贴进去同构）。
 *
 * 定位不在这里：贴外框上缘 + 居中 + 反缩放由宿主 SelectionFrame 的定位层统一给
 * （与节点控制栏同一个 resolveNodeSlotStyle），本组件只放内容。
 */
import { computed } from 'vue'
import { useCapability, useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import type { SelectionCapability } from '@mini-canvas/canvas-render'
import { AGENT_REFERENCE_COMMAND_ID } from '../agentCommands.js'
import { ICON_NODE } from '../agentResources.js'

const { ctx } = useCanvasRender()
// 设计系统件按名取（§4.5 目录）：换主题插件时这里一行不改。缺件回退原生按钮（降级成「还能点」）。
const ThemedButton = useUiComponent('toolbarButton')

/** 当前选中集（能力包；needs:['selection'] 在 agentPlugin 的 attach 里声明） */
const selection = useCapability<SelectionCapability>('selection')

/** 选中节点数：>=1 就能引用（与右键菜单那条一致 —— 右键也是引一个） */
const count = computed(() => selection?.ids().length ?? 0)
const enabled = computed(() => count.value >= 1)

/** 命令服务（缺宿主/单测桩时拿不到 → 点了不做事，不炸） */
const command = computed(() =>
    ctx.tryGet<{ runCommand(id: string, ...payload: unknown[]): unknown }>('canvas'),
)

/**
 * 点它 = 把选中集整批引用进 Agent 输入框：执行与右键菜单**同一条命令**。
 *
 * 传 `{ nodeIds }`（右键那条传 `{ nodeId }`）；命令内部把两种形状归一到同一份状态，
 * 所以两个入口的行为永远一致（都是「面板打开 + 输入框出现这些节点的标签」）。
 */
function onReference(): void {
  if (!enabled.value) return
  const ids: string[] = selection?.ids() ?? []
  command.value?.runCommand(AGENT_REFERENCE_COMMAND_ID, { nodeIds: ids })
}
</script>

<template>
  <!--
    定位与「整排一个背景块」由宿主的 .selection-frame-slot + .ntp-root 规则统一提供
    （见 plugin-multi-select 的 SelectionFrame 与 packages/ui/src/app.css）——
    与「加入资产库」按钮逐字同形：这里只放按钮本身，不再自套一层 .ntp-root
    （再套一层会画出第二个背景块，用户报过「两个背景」）。
  -->
  <component
    :is="ThemedButton || 'button'"
    class="agent-ref-toolbar__btn"
    type="button"
    title="引用到 Agent"
    aria-label="引用到 Agent"
    :icon="ICON_NODE"
    :disabled="!enabled"
    @click="onReference"
  >
    引用到 Agent
  </component>
</template>

<style scoped>
/* 容器/定位都由宿主给（与「加入资产库」同款：定位层负责贴边 + 居中 + 反缩放）。
   这里只声明「这是一颗按钮」—— 按钮自身的尺寸/圆角/hover/focus 来自 ui 目录的 button 件。 */
</style>
