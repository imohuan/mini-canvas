<script setup lang="ts">
/**
 * PromptVariables —— 三种提示词共用的「可用变量」面板。
 *
 * 为什么要共用：Agent 提示词、模式提示词和系统提示词模板最终都会过同一套占位符替换；
 * 各页各写一份清单，改一处就会漏掉另一处。
 *
 * scope=content 用于 Agent / 模式提示词：它们会填进 {{AGENTS_MD}}，自己再写 {{AGENTS_MD}}
 * 不会被展开。scope=template 才显示 {{AGENTS_MD}}。
 * 三种页面都交给 PromptEditor 插到光标处；readonly 只是兼容其它只读展示。
 */
import { computed, ref } from 'vue'
import { useUiComponent } from '@plume-canvas/canvas-render'
import { useAgent } from '../../../plugin/useAgent.js'
import type { ContextPlaceholderView } from '../../../api/agentApi.js'

const props = withDefaults(
  defineProps<{
    scope?: 'content' | 'template'
    readonly?: boolean
  }>(),
  { scope: 'content', readonly: false },
)

const emit = defineEmits<{
  (e: 'insert', token: string): void
}>()

const Button = useUiComponent('Button')
const Input = useUiComponent('Input')

const agent = useAgent()
const s = agent.state
const search = ref('')

const visible = computed<ContextPlaceholderView[]>(() => {
  const q = search.value.trim().toLowerCase()
  return (s.agentContext?.placeholders ?? []).filter((p) => {
    // {{AGENTS_MD}} 只有模板里那一层能展开；写进 AGENTS.md 本身不会再展开一次。
    if (props.scope === 'content' && p.token === '{{AGENTS_MD}}') return false
    if (!q) return true
    return p.token.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
  })
})

const own = computed(() => visible.value.filter((p) => p.source === 'plume-canvas'))
const harness = computed(() => visible.value.filter((p) => p.source === 'harness'))

function pick(p: ContextPlaceholderView): void {
  if (!props.readonly) emit('insert', p.token)
}

function titleOf(p: ContextPlaceholderView): string {
  return p.description + (p.value ? '（当前：' + p.value + '）' : '')
}
</script>

<template>
  <div class="pv">
    <div class="pv-head">
      <div class="pv-head-text">
        <span class="pv-title">可用变量</span>
        <span class="pv-count">{{ visible.length }} 个</span>
      </div>
      <Input v-model="search" class="pv-search" aria-label="筛选提示词变量" placeholder="筛选变量…" />
    </div>
    <p class="pv-hint">点一下插到光标处；每次建会话时换成当时的值。</p>

    <p v-if="!s.agentContext" class="pv-empty">还没连上后台，变量清单稍后出现。</p>
    <template v-else>
      <div v-if="own.length" class="pv-group">
        <span class="pv-group-title">本站运行环境</span>
        <div class="pv-chips">
          <Button
            v-for="p in own"
            :key="p.token"
            variant="outline"
            size="xs"
            type="button"
            class="pv-chip"
            :title="titleOf(p)"
            :aria-label="'插入变量 ' + p.token"
            @click="pick(p)"
          ><code>{{ p.token }}</code></Button>
        </div>
      </div>

      <div v-if="harness.length" class="pv-group">
        <span class="pv-group-title">运行时提供</span>
        <div class="pv-chips">
          <Button
            v-for="p in harness"
            :key="p.token"
            variant="outline"
            size="xs"
            type="button"
            class="pv-chip"
            :title="titleOf(p)"
            :aria-label="'插入变量 ' + p.token"
            @click="pick(p)"
          ><code>{{ p.token }}</code></Button>
        </div>
      </div>

      <p v-if="!visible.length" class="pv-empty">没有匹配的变量</p>
    </template>
  </div>
</template>

<style scoped>
/* 三种提示词共用这一块：内边距、描边、字号都只在这里调一次 */
.pv { display: flex; flex-direction: column; gap: 7px; padding: 9px 10px; border: 1px solid var(--ui-line-soft, #eef0f4); border-radius: var(--radius-control, 8px); background: var(--ui-panel, #fff); }
.pv-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.pv-head-text { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.pv-title { font-size: 11px; font-weight: 600; color: var(--ui-ink, #18202b); }
.pv-count { font-size: 10px; color: var(--ui-ink-dim, #6b7280); }
.pv-search { width: 140px; height: 26px; flex: none; font-size: 11px; }
.pv-hint { margin: 0; font-size: 10px; line-height: 1.5; color: var(--ui-ink-dim, #6b7280); }
.pv-empty { margin: 0; padding: 4px 0; font-size: 11px; color: var(--ui-ink-mute, #8c95a3); }
.pv-group { display: flex; flex-direction: column; gap: 5px; }
.pv-group-title { font-size: 10px; letter-spacing: 0.02em; color: var(--ui-ink-dim, #6b7280); }
.pv-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.pv-chip { height: 22px; padding: 0 8px; font-family: var(--font-mono, ui-monospace, monospace); }
.pv-chip code { font-size: 10px; }
</style>
