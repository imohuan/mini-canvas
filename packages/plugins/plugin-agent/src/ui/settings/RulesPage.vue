<script setup lang="ts">
/**
 * RulesPage —— 审批规则：一条一行，可开关、可编辑、可删除，也能一键恢复出厂。
 *
 * 用户口径（2026-11-11）：
 *   1. 规则要有**编辑**功能（原来只能开关 / 删）；
 *   2. 改坏了要能**恢复默认**（列表整体恢复；内置那几条也能单独恢复）。
 *
 * 交互与其它二级页一致：列表 → 点「编辑」进详情，左上返回。
 * 业务规则仍由 agent 服务负责，这里只改展示与提交入口。
 */
import { computed, onMounted, ref } from 'vue'
import { useCanvasContextOrRender, useUiComponent } from '@mini-canvas/canvas-render'
import type { FeedbackService } from '@mini-canvas/canvas-render'
import { ArrowLeft, Plus, RotateCcw, Save, Trash2 } from 'lucide-vue-next'
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
const feedback = useCanvasContextOrRender().ctx.tryGet<FeedbackService>('feedback')
const draft = ref('')
const busy = ref(false)

/** 出厂规则（与后端 DEFAULT_POLICY 同一份口径：执行命令 / 写入命令 / 写文件 / 改文件都问） */
const DEFAULT_RULES: ApprovalRuleRow[] = [
  { id: 'exec', pattern: 'exec_command', ask: true, label: '执行命令' },
  { id: 'input', pattern: 'input_command', ask: true, label: '向命令写入' },
  { id: 'write', pattern: 'write_file', ask: true, label: '写文件' },
  { id: 'edit', pattern: 'edit_file', ask: true, label: '改文件' },
]

onMounted(() => void agent.refresh())

/** 空串 = 列表；有值 = 正在编辑这条规则 */
const editingId = ref('')
const editForm = ref({ pattern: '', label: '' })
const editing = computed(() => s.policy.rules.find((r) => r.id === editingId.value))
/** 编辑中改成了和原来不一样的值（决定保存是否可点） */
const editDirty = computed(() => {
  const r = editing.value
  if (!r) return false
  return editForm.value.pattern.trim() !== r.pattern || editForm.value.label.trim() !== (r.label ?? '')
})
const defaultOf = (rule: ApprovalRuleRow): ApprovalRuleRow | undefined =>
  DEFAULT_RULES.find((d) => d.id === rule.id || d.pattern === rule.pattern)

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

function openEdit(rule: ApprovalRuleRow): void {
  editingId.value = rule.id
  editForm.value = { pattern: rule.pattern, label: rule.label ?? '' }
  s.error = ''
}

function backToList(): void {
  editingId.value = ''
  s.error = ''
}

async function saveEdit(): Promise<void> {
  const rule = editing.value
  const pattern = editForm.value.pattern.trim()
  if (!rule) return
  if (!pattern) {
    s.error = '匹配模式不能为空'
    return
  }
  await persist(
    s.policy.rules.map((r) =>
      r.id === rule.id
        ? { id: r.id, pattern, ask: r.ask, ...(editForm.value.label.trim() ? { label: editForm.value.label.trim() } : {}) }
        : r,
    ),
  )
  if (!s.error) backToList()
}

/** 单条恢复：内置的换回出厂名字与模式；自建规则没有出厂版，按钮禁用 */
async function restoreOne(rule: ApprovalRuleRow): Promise<void> {
  const d = defaultOf(rule)
  if (!d) return
  const ok = await feedback?.confirm({
    title: '恢复这条规则的默认值？',
    description: '会把匹配模式改成「' + d.pattern + '」，说明改成「' + (d.label ?? '') + '」。',
    confirmText: '恢复默认',
    cancelText: '取消',
  })
  if (!ok) return
  await persist(s.policy.rules.map((r) => (r.id === rule.id ? { ...r, pattern: d.pattern, label: d.label } : r)))
}

/** 整份规则恢复出厂（用户口径：改坏了能直接退回） */
async function restoreAll(): Promise<void> {
  const ok = await feedback?.confirm({
    title: '恢复全部审批规则？',
    description: '会丢掉你自建的规则，并把这 ' + DEFAULT_RULES.length + ' 条出厂规则放回来；总开关也会重新打开。',
    confirmText: '恢复默认',
    cancelText: '取消',
    tone: 'destructive',
  })
  if (!ok) return
  busy.value = true
  try {
    await agent.restorePolicy()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="ap ap-rules">
    <p v-if="s.error" class="ap-error">{{ s.error }}</p>

    <!-- ==================== 编辑一条规则（二级页） ==================== -->
    <template v-if="editing">
      <div class="ap-rule-detail-head">
        <Button variant="ghost" size="xs" type="button" class="ap-rule-back" @click="backToList">
          <ArrowLeft :size="14" aria-hidden="true" /> 返回规则列表
        </Button>
        <span class="ap-rule-detail-actions">
          <Button
            v-if="defaultOf(editing)"
            variant="outline"
            size="sm"
            type="button"
            :disabled="busy"
            aria-label="恢复这条规则的默认值"
            @click="restoreOne(editing)"
          >
            <RotateCcw :size="13" aria-hidden="true" /> 恢复默认
          </Button>
          <Button type="button" size="sm" :disabled="busy || !editDirty" @click="saveEdit">
            <Save :size="13" aria-hidden="true" /> 保存
          </Button>
        </span>
      </div>
      <h3 class="ap-rule-detail-title">编辑规则 · {{ editing.pattern }}</h3>
      <p class="ap-hint">匹配模式支持 * 通配，例如 mcp__smart__* 或 exec_command。</p>

      <ShadcnSettingsSection title="规则" class="ap-flush-card">
        <ShadcnSettingsRow label="匹配模式" description="工具名，或带 * 的通配；例如 mcp__{服务名}__*">
          <Input v-model="editForm.pattern" class="ap-input" aria-label="匹配模式" placeholder="例如：exec_command" />
        </ShadcnSettingsRow>
        <ShadcnSettingsRow label="说明" description="只是给人看的标签，可以留空">
          <Input v-model="editForm.label" class="ap-input" aria-label="规则说明" placeholder="例如：执行命令" />
        </ShadcnSettingsRow>
        <ShadcnSettingsRow label="命中时询问" description="关掉 = 命中这条时直接放行">
          <Switch
            :model-value="editing.ask"
            aria-label="命中时询问"
            @update:model-value="toggleRule(editing)"
          />
        </ShadcnSettingsRow>
      </ShadcnSettingsSection>
    </template>

    <!-- ==================== 列表态 ==================== -->
    <template v-else>
      <div class="ap-rule-toolbar">
        <span class="ap-hint">{{ s.policy.rules.length }} 条规则 · 点「编辑」改模式与说明</span>
        <Button variant="outline" size="sm" type="button" :disabled="busy" @click="restoreAll">
          <RotateCcw :size="13" aria-hidden="true" /> 恢复默认
        </Button>
      </div>

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

      <ShadcnSettingsSection title="需要审批的工具" :description="s.policy.rules.length + ' 条规则'" class="ap-flush-card">
        <div v-for="r in s.policy.rules" :key="r.id" class="ap-rule-row">
          <div class="ap-rule-main">
            <div class="ap-rule-title">
              <span class="ap-rule-pattern">{{ r.pattern }}</span>
              <span v-if="defaultOf(r)" class="ap-rule-badge">出厂</span>
            </div>
            <div class="ap-rule-desc">{{ r.label || (r.ask ? '命中即询问' : '直接放行') }}</div>
          </div>
          <div class="ap-rule-actions">
            <Switch
              :model-value="r.ask"
              :aria-label="'切换 ' + r.pattern + ' 是否需要审批'"
              @update:model-value="toggleRule(r)"
            />
            <Button variant="outline" size="xs" type="button" :aria-label="'编辑规则 ' + r.pattern" @click="openEdit(r)">编辑</Button>
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
        </div>
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
    </template>
  </div>
</template>

<style scoped>
.ap-rule-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ap-rule-form { padding: 10px 0; }
.ap-form-actions { display: flex; align-items: center; gap: 8px; }
.ap-form-actions :deep(input) { flex: 1; }
.ap-rule-actions { display: flex; align-items: center; gap: 6px; flex: none; }
.ap-rule-row { display: flex; align-items: center; gap: 12px; padding: 9px 0; }
.ap-rule-row + .ap-rule-row { border-top: 1px solid var(--ui-line-faint, #eef0f4); }
.ap-rule-main { flex: 1; min-width: 0; }
.ap-rule-title { display: flex; align-items: center; gap: 6px; }
.ap-rule-pattern { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-family: var(--font-mono, ui-monospace, monospace); color: var(--ui-ink, #18202b); }
.ap-rule-badge { flex: none; padding: 1px 6px; border-radius: 999px; background: var(--ui-hover, #f4f6f9); font-size: 10px; color: var(--ui-ink-dim, #6b7280); }
.ap-rule-desc { font-size: 11px; color: var(--ui-ink-dim, #6b7280); }
.ap-rule-detail-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ap-rule-back { margin-left: -8px; padding-inline: 8px; color: var(--ui-ink-dim, #6b7280); }
.ap-rule-detail-actions { display: flex; align-items: center; gap: 8px; }
.ap-rule-detail-title { margin: 6px 0 0; font-size: 14px; font-weight: 700; color: var(--ui-ink, #18202b); }
.ap-input { width: 100%; }
.ap-flush-card :deep(.shadcn-settings-section__body) { border: 0; background: transparent; padding: 0; overflow: visible; }
</style>
