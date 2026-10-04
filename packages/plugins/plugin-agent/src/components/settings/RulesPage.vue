<script setup lang="ts">
/**
 * 规则列表页 —— 监听并设置「哪些工具需要经过审批」。
 *
 * 用户点名的第三件事：审批不是针对所有工具，而是按规则来；规则要能在界面上看与改，
 * 并且支持点击操作。所以每行一个开关（点了立刻生效，不用按保存）。
 * 布局：表头在上、内容在下。
 */
import { onMounted, ref } from 'vue'
import { useAgent } from '../../useAgent.js'
import type { ApprovalRuleRow } from '../../agentService.js'
import '../../components/settings/settings.css'

const agent = useAgent()
const s = agent.state
const draft = ref('')
const busy = ref(false)

onMounted(() => void agent.refresh())

async function persist(rules: ApprovalRuleRow[], enabled = s.policy.enabled): Promise<void> {
  busy.value = true
  try {
    await agent.savePolicy({ enabled, rules })
  } finally {
    busy.value = false
  }
}
function toggleEnabled(): void {
  void persist(s.policy.rules, !s.policy.enabled)
}
function toggleRule(rule: ApprovalRuleRow): void {
  void persist(s.policy.rules.map((r) => (r.id === rule.id ? { ...r, ask: !r.ask } : r)))
}
function removeRule(rule: ApprovalRuleRow): void {
  void persist(s.policy.rules.filter((r) => r.id !== rule.id))
}
function addRule(): void {
  const pattern = draft.value.trim()
  if (!pattern) return
  draft.value = ''
  void persist([...s.policy.rules, { id: pattern, pattern, ask: true }])
}
function quickAdd(pattern: string, label?: string): void {
  void persist([...s.policy.rules, { id: pattern, pattern, ask: true, ...(label ? { label } : {}) }])
}
</script>

<template>
  <div class="ap ap-rules">
    <p v-if="s.error" class="ap-error">{{ s.error }}</p>

    <section class="ap-block">
      <div class="ap-block-body">
        <div class="ap-switch-row">
          <div>
            <!-- 文案与输入框左下角那个「授权方式」下拉**逐字对齐**：同一条通道的两个入口，
                 措辞不一致会让人以为是两件事（之前这里叫「启用审批规则」，与下拉读起来对不上）。 -->
            <strong>接受审核</strong>
            <small>打开 = 命中下面规则的工具先问你；关掉 = 完全自动授权，全部放行</small>
          </div>
          <button class="ap-switch" :class="{ on: s.policy.enabled }" role="switch"
            :aria-checked="s.policy.enabled" aria-label="接受审核" @click="toggleEnabled"></button>
        </div>
      </div>
    </section>

    <section class="ap-block">
      <header class="ap-block-head"><h4>需要审批的工具</h4><span class="ap-count">{{ s.policy.rules.length }} 条</span></header>
      <div class="ap-table ap-scroll">
        <div class="ap-tr is-head"><span>匹配模式</span><span>说明</span><span>处理</span></div>
        <div v-for="r in s.policy.rules" :key="r.id" class="ap-tr">
          <span class="ap-td" :title="r.pattern">{{ r.pattern }}</span>
          <span class="ap-td ap-td-meta">{{ r.label || '命中即询问' }}</span>
          <span class="ap-td-act">
            <button class="ap-mini" :class="{ 'is-on': r.ask }" @click="toggleRule(r)">{{ r.ask ? '需要审批' : '直接放行' }}</button>
            <button class="ap-mini danger" @click="removeRule(r)">删除</button>
          </span>
        </div>
        <p v-if="!s.policy.rules.length" class="ap-empty">没有任何规则 —— 一切都会被放行</p>
      </div>
    </section>

    <section class="ap-block">
      <header class="ap-block-head"><h4>添加规则</h4></header>
      <div class="ap-block-body">
        <form class="ap-fields" @submit.prevent="addRule">
          <label class="ap-field">匹配模式（支持 * 通配，例如 mcp__smart__* 或 exec_command）
            <input v-model="draft" placeholder="mcp__smart__*" />
          </label>
          <button class="ap-submit" type="submit" :disabled="busy || !draft.trim()">添加</button>
        </form>
        <div class="ap-quick" style="margin-top:8px">
          <span class="ap-tag">快加：</span>
          <button class="ap-mini" @click="quickAdd('mcp__smart__*', 'smart MCP 全部工具')">smart MCP</button>
          <button class="ap-mini" @click="quickAdd('exec_command', '执行命令')">执行命令</button>
          <button class="ap-mini" @click="quickAdd('write_file', '写文件')">写文件</button>
        </div>
      </div>
    </section>
  </div>
</template>
