<script setup lang="ts">
/**
 * AgentStackTrace —— 工具失败（照 AI Elements 的 Stack Trace 文档原样搭）。
 *
 * 结构（StackTrace.md 的 Usage）：
 *   Trace > TraceCollapsible > Trigger > TraceLine(status="error") >
 *     TraceIcon(CircleX) + TraceTitle(「Failed: <错误>」)
 *   Content > div(flex flex-col gap-2 rounded-md bg-muted p-3 font-mono text-xs)
 *     > p.text-destructive(完整错误) + ol > li(帧，node_modules 的淡化)
 *
 * 标题会截断，所以内容顶部重复一次完整错误（文档专门强调过这一点）。
 */
import { computed } from 'vue'
import { CircleX } from 'lucide-vue-next'
import {
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger,
  TraceIcon, TraceLine, TraceTitle,
} from '../ai-elements/trace'
import type { ToolFailure } from '../../model/toolFailure.js'
import { diagnoseError, layerLabel } from '../../model/errorDiagnosis.js'

const props = defineProps<{
  failure: ToolFailure
  /** 完整错误文本（标题只用第一行） */
  detail?: string
  title?: string
}>()

const error = computed(() => props.failure.message || '工具执行失败')
const frames = computed(() => props.failure.frames)
const full = computed(() => props.detail || error.value)
/**
 * 诊断用的文本：优先完整详情；没有详情时把首行错误 + 帧拼起来。
 * 为什么不用 `full`：工具失败只传了 failure（message + frames），message 只有第一行，
 * 光看它认不出 `/api/...` 路由或业务代码帧，标题就会退化成「未知」。
 */
const diagnosisText = computed(() => {
  if (props.detail) return props.detail
  return [error.value, ...frames.value].join('\n')
})
/**
 * 标题：先说**在哪出错**（后台 / 前端 / 网络），再说 HTTP 状态码，最后才是原因。
 *
 * 用户口径（2026-11-07）：原来只有「Failed: EPERM…」，800 字以内的标题也说不清
 * 「是后台写文件失败，还是接口 504」。所以标题三段式：
 *   [后台写文件失败 EPERM] · Failed: EPERM: operation not permitted, rename '...'
 * 状态码单独带出来（4xx 是请求方问题、5xx 是后台问题），展开区再给完整原因与捕获位置。
 */
const diagnosis = computed(() => diagnoseError(diagnosisText.value))
const heading = computed(() => {
  if (props.title) return props.title
  const d = diagnosis.value
  // 认不出层、也没有状态码：保持原来的「Failed: <错误>」，不硬加结论
  if (d.layer === 'unknown' && d.status === undefined) return 'Failed: ' + error.value
  const badge = d.status !== undefined ? ' · HTTP ' + d.status : ''
  return '[' + d.headline + badge + '] ' + error.value.split('\n')[0]
})
/** 展开区第一行：层 + 捕获位置（比堆栈先看到，才知道是谁的问题） */
const placeLine = computed(() => {
  const d = diagnosis.value
  const parts = [layerLabel(d.layer) + ' · ' + d.headline]
  if (d.where) parts.push('位置：' + d.where)
  if (d.hint) parts.push(d.hint)
  return parts.join('\n')
})
</script>

<template>
  <Trace>
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status="error">
          <TraceIcon>
            <CircleX />
          </TraceIcon>
          <TraceTitle>{{ heading }}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <div class="flex flex-col gap-2 rounded-md bg-muted p-3 font-mono text-xs">
          <p class="text-foreground whitespace-pre-wrap break-words">{{ placeLine }}</p>
          <p class="text-destructive whitespace-pre-wrap break-words">
            {{ full }}
          </p>
          <ol v-if="frames.length">
            <li v-for="(frame, index) in frames" :key="index"
              :class="frame.includes('node_modules') ? undefined : 'text-foreground'">
              {{ frame }}
            </li>
          </ol>
        </div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  </Trace>
</template>
