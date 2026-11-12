<script setup lang="ts">
/**
 * CodeBlockHighlighted —— 官方文档里 Markdown 代码块的那套写法
 * （code-block 的 Highlighted / MarkdownCode 示例）打包成一个可注册件：
 * useHighlightedCode 出 token 行 → CodeBlockLine / CodeBlockToken 渲染。
 *
 * 为什么要包一层：业务插件不直接 import 组件库（依赖方向规矩），
 * 而 useHighlightedCode 是组合式函数、没法通过 useUiComponent 取到；
 * 组件化之后插件只写 <CodeBlockHighlighted :code :language /> 即可。
 */
import type { HTMLAttributes } from 'vue'
import { CodeBlockContent, CodeBlockLine, CodeBlockToken, useHighlightedCode } from '.'

const props = withDefaults(defineProps<{
  code: string
  language?: string
  wrap?: boolean
  lineNumbers?: boolean
  startLine?: number
  class?: HTMLAttributes['class']
}>(), {
  language: 'text',
  wrap: false,
  lineNumbers: false,
  startLine: 1,
})

const lines = useHighlightedCode(() => props.code, () => props.language)
</script>

<template>
  <CodeBlockContent
    :wrap="props.wrap"
    :line-numbers="props.lineNumbers"
    :start-line="props.startLine"
    :class="props.class"
  >
    <CodeBlockLine v-for="(line, index) in lines" :key="index">
      <CodeBlockToken v-for="(token, i) in line" :key="i" :token="token" />
    </CodeBlockLine>
  </CodeBlockContent>
</template>
