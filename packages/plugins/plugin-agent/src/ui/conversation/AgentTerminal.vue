<script setup lang="ts">
/**
 * AgentTerminal —— 命令执行工具的行（Trace 结构照 AI Elements Terminal）。
 *
 * 用户口径（2026-11-07）：
 * 1. 标题用**中文动作**（「执行命令」），不写英文 Ran / Running，也不把整条命令塞进标题；
 * 2. 展开区保留原来的「输入 / 输出」两块（由调用方通过默认插槽传入 ToolViewBody），
 *    不能因为换了 Terminal 外观就把输入输出删掉；
 * 3. 失败由 status="error" 标红，具体错误另由 Stack Trace 展示。
 */
import { computed } from 'vue'
import { Terminal as TerminalIcon } from 'lucide-vue-next'
import {
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger,
  TraceIcon, TraceLine, TraceTitle,
} from '../ai-elements/trace'
import { parseToolFailure } from '../../model/toolFailure.js'
import { terminalLineTitle } from '../../model/toolMeta.js'

const props = defineProps<{
  name: string
  args: string
  output?: string
  settled?: boolean
}>()

const failure = computed(() => parseToolFailure(props.output))
const running = computed(() => !props.settled)

const status = computed<'running' | 'error' | undefined>(() => {
  if (running.value) return 'running'
  return failure.value.failed ? 'error' : undefined
})

/**
 * 标题：图标已经是终端，不再写「执行命令」前缀（用户口径 2026-11-07）。
 * 直接给入参里的 description，没有再退回命令本身；命令原文仍在「输入」里。
 */
const title = computed(() => terminalLineTitle(props.name, props.args))
</script>

<template>
  <Trace>
    <!-- 跑到有输出时展开，结束后用户自己决定（不在代码里强开强关） -->
    <TraceCollapsible :open="running && !!props.output ? true : undefined">
      <TraceCollapsibleTrigger>
        <TraceLine :status="status">
          <TraceIcon>
            <TerminalIcon />
          </TraceIcon>
          <TraceTitle>{{ title }}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <!-- 输入 / 输出两块（用户口径 2026-11-07：不能删） -->
        <slot />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  </Trace>
</template>
