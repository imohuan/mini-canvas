<script setup lang="ts">
/**
 * RulesPage —— 审批规则页。
 *
 * 每行一个开关（点了立刻生效），全部控件来自 @mini-canvas/ui-kit-shadcn。
 * 业务规则（哪些工具需要确认）仍由 agent 服务负责，这里只改展示与提交入口。
 */
import { onMounted, ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { Plus, Trash2 } from 'lucide-vue-next'
import { useAgent } from '../../plugin/useAgent.js'
import type { ApprovalRuleRow } from '../../service/agentService.js'
import './settings.css'

const Button = useUiComponent('Button')
const Input = useUiComponent('Input')
const Switch = useUiComponent('Switch')
const ShadcnSettingsRow = useUiComponent('settingsRow')
const ShadcnSettingsSection = useUiComponent('settingsSection')

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

    <ShadcnSettingsSection title="总开关">
      <ShadcnSettingsRow
        label="接受审核"
        description="打开 = 命中下面规则的工具先问你；关掉 = 完全自动授权，全部放行"
      >
        <Switch
          :model-value="s.policy.enabled"
          aria-label="接受审核"
          @update:model-value="toggleEnabled"
        />
      </ShadcnSettingsRow>
    </ShadcnSettingsSection>

    <ShadcnSettingsSection title="需要审批的工具" :description="s.policy.rules.length + ' 条规则'">
      <ShadcnSettingsRow
        v-for="r in s.policy.rules"
        :key="r.id"
        :label="r.pattern"
        :description="r.label || (r.ask ? '命中即询问' : '直接放行')"
      >
        <div class="ap-rule-actions">
          <Switch
            :model-value="r.ask"
            :aria-label="'切换 ' + r.pattern + ' 是否需要审批'"
            @update:model-value="toggleRule(r)"
          />
          <Button
            variant="destructive"
            size="icon-sm"
            type="button"
            :aria-label="'删除规则 ' + r.pattern"
            :disabled="busy"
            @click="removeRule(r)"
          >
            <Trash2 :size="13" aria-hidden="true" />
          </Button>
        </div>
      </ShadcnSettingsRow>
      <p v-if="!s.policy.rules.length" class="ap-empty">没有任何规则 —— 一切都会被放行</p>
    </ShadcnSettingsSection>

    <ShadcnSettingsSection title="添加规则" description="匹配模式支持 * 通配，例如 mcp__smart__* 或 exec_command">
      <form class="ap-form-stack ap-rule-form" @submit.prevent="addRule">
        <div class="ap-form-actions">
          <Input v-model="draft" aria-label="匹配模式" placeholder="例如：mcp__{服务名}__*" />
          <Button type="submit" size="sm" :disabled="busy || !draft.trim()">
            <Plus :size="13" aria-hidden="true" /> 添加
          </Button>
        </div>
        <div class="ap-quick">
          <span class="ap-tag">快加：</span>
          <Button variant="outline" size="xs" type="button" @click="quickAdd('mcp__smart__*', 'smart MCP 全部工具')">smart MCP</Button>
          <Button variant="outline" size="xs" type="button" @click="quickAdd('exec_command', '执行命令')">执行命令</Button>
          <Button variant="outline" size="xs" type="button" @click="quickAdd('write_file', '写文件')">写文件</Button>
        </div>
      </form>
    </ShadcnSettingsSection>
  </div>
</template>

<style scoped>
.ap-rule-form { padding: 10px 0; }
.ap-form-actions { display: flex; align-items: center; gap: 8px; }
.ap-form-actions :deep(input) { flex: 1; }
.ap-rule-actions { display: flex; align-items: center; gap: 8px; }
</style>
